"""Turns a batch ASR model into a real-time streaming recogniser.

Strategy (a common "local agreement-lite" approach used with Whisper):
  * Audio is split into 30 ms frames and scored with a cheap RMS energy VAD.
  * While the user is speaking, the current utterance buffer is re-transcribed every
    PARTIAL_INTERVAL_SEC and sent as a *partial* result (the UI shows it greyed out).
  * When a pause longer than SILENCE_FINALIZE_SEC is detected (or the utterance gets too
    long) the buffer is transcribed one last time and sent as a *final* result.
Model inference runs in a worker thread so the event loop keeps receiving audio.
"""
from __future__ import annotations

import abc
import asyncio
from typing import Optional, Tuple

import numpy as np

from .. import config
from .base import EmitFn, STTSession

FRAME_SAMPLES = int(config.SAMPLE_RATE * 0.03)  # 30 ms


class BufferedVADSession(STTSession, abc.ABC):
    def __init__(self, emit: EmitFn, language: Optional[str] = None):
        super().__init__(emit, language)
        self._pending = np.zeros(0, dtype=np.float32)   # not yet framed
        self._utterance: list[np.ndarray] = []           # frames of current utterance
        self._utt_samples = 0
        self._in_speech = False
        self._silence_samples = 0
        self._since_partial = 0
        self._stream_pos = 0                              # total samples consumed
        self._utt_start = 0
        self._partial_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()                       # serialises model calls

    # ---- subclass hook -------------------------------------------------------
    @abc.abstractmethod
    def transcribe(self, audio: np.ndarray, final: bool) -> Tuple[str, Optional[str]]:
        """Blocking ASR call: returns (text, detected_language)."""

    # ---- streaming logic -----------------------------------------------------
    async def feed(self, pcm16: bytes) -> None:
        if len(pcm16) % 2:
            pcm16 = pcm16[:-1]
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        self._pending = np.concatenate([self._pending, samples])

        while len(self._pending) >= FRAME_SAMPLES:
            frame, self._pending = self._pending[:FRAME_SAMPLES], self._pending[FRAME_SAMPLES:]
            await self._process_frame(frame)

    async def _process_frame(self, frame: np.ndarray) -> None:
        rms = float(np.sqrt(np.mean(frame ** 2)))
        is_speech = rms >= config.VAD_ENERGY_THRESHOLD
        self._stream_pos += len(frame)

        if not self._in_speech:
            if not is_speech:
                # keep ~300 ms of pre-roll so the first syllable isn't clipped
                self._utterance.append(frame)
                self._utt_samples += len(frame)
                max_pre = int(0.3 * config.SAMPLE_RATE)
                while self._utt_samples > max_pre:
                    self._utt_samples -= len(self._utterance.pop(0))
                return
            self._in_speech = True
            self._utt_start = self._stream_pos - self._utt_samples - len(frame)
            self._silence_samples = 0
            self._since_partial = 0

        self._utterance.append(frame)
        self._utt_samples += len(frame)
        self._since_partial += len(frame)
        self._silence_samples = 0 if is_speech else self._silence_samples + len(frame)

        sr = config.SAMPLE_RATE
        if (self._silence_samples >= config.SILENCE_FINALIZE_SEC * sr
                or self._utt_samples >= config.MAX_UTTERANCE_SEC * sr):
            await self._finalize()
        elif self._since_partial >= config.PARTIAL_INTERVAL_SEC * sr:
            self._since_partial = 0
            # Don't queue partials behind a busy model: skip if one is still running.
            if self._partial_task is None or self._partial_task.done():
                audio = np.concatenate(self._utterance)
                self._partial_task = asyncio.create_task(self._emit_partial(audio))

    async def _emit_partial(self, audio: np.ndarray) -> None:
        async with self._lock:
            if not self._in_speech:      # utterance got finalised meanwhile
                return
            text, _ = await asyncio.to_thread(self.transcribe, audio, False)
        if text and self._in_speech:
            await self.emit({"type": "partial", "text": text})

    async def _finalize(self) -> None:
        if not self._utterance:
            return
        audio = np.concatenate(self._utterance)
        start = self._utt_start / config.SAMPLE_RATE
        end = self._stream_pos / config.SAMPLE_RATE
        self._utterance, self._utt_samples = [], 0
        self._in_speech = False
        self._silence_samples = 0
        async with self._lock:
            text, lang = await asyncio.to_thread(self.transcribe, audio, True)
        if text:
            await self.emit({
                "type": "final",
                "text": text,
                "language": lang or self.language,
                "start": round(start, 2),
                "end": round(end, 2),
            })

    async def finish(self) -> None:
        if self._in_speech:
            if len(self._pending):
                self._utterance.append(self._pending)
                self._pending = np.zeros(0, dtype=np.float32)
            await self._finalize()
