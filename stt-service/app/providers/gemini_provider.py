"""Gemini Live API provider (free-tier API key from Google AI Studio).

Audio is streamed straight into a Live session with `input_audio_transcription` enabled;
Gemini returns incremental transcripts of what the user said. We only use those
transcripts and ignore the model's own reply.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Optional

from .. import config
from .base import EmitFn, STTProvider, STTSession

log = logging.getLogger(__name__)


class GeminiProvider(STTProvider):
    name = "gemini"

    def __init__(self) -> None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is required when STT_PROVIDER=gemini")
        from google import genai

        self.client = genai.Client(api_key=config.GEMINI_API_KEY)

    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession:
        return GeminiSession(self, emit, language)


class GeminiSession(STTSession):
    def __init__(self, provider: GeminiProvider, emit: EmitFn, language: Optional[str]):
        super().__init__(emit, language)
        self.provider = provider
        self._cm = None
        self._session = None
        self._reader: Optional[asyncio.Task] = None
        self._buffer = ""                 # text of the utterance being spoken
        self._utt_start: Optional[float] = None
        self._t0 = time.monotonic()

    async def start(self) -> None:
        from google.genai import types

        transcription_cfg = types.AudioTranscriptionConfig()
        cfg = types.LiveConnectConfig(
            response_modalities=[config.GEMINI_RESPONSE_MODALITY],
            input_audio_transcription=transcription_cfg,
            system_instruction=(
                "You are a silent transcription relay. Do not answer the user; reply with a single '.'"
            ),
        )
        self._cm = self.provider.client.aio.live.connect(model=config.GEMINI_MODEL, config=cfg)
        self._session = await self._cm.__aenter__()
        self._reader = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            async for msg in self._session.receive():
                sc = getattr(msg, "server_content", None)
                if not sc:
                    continue
                tr = sc.input_transcription or getattr(sc, "interim_input_transcription", None)
                if tr and tr.text:
                    if self._utt_start is None:
                        self._utt_start = time.monotonic() - self._t0
                    self._buffer += tr.text
                    await self.emit({"type": "partial", "text": self._buffer.strip()})
                    if getattr(tr, "finished", False):
                        await self._flush(getattr(tr, "language_code", None))
                if sc.turn_complete or sc.generation_complete:
                    await self._flush()
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # surface API errors to the client
            log.exception("Gemini live session failed")
            await self.emit({"type": "error", "message": f"Gemini: {exc}"})

    async def _flush(self, lang: Optional[str] = None) -> None:
        text = self._buffer.strip()
        if text:
            await self.emit({
                "type": "final",
                "text": text,
                "language": lang or self.language,
                "start": round(self._utt_start or 0, 2),
                "end": round(time.monotonic() - self._t0, 2),
            })
        self._buffer, self._utt_start = "", None

    async def feed(self, pcm16: bytes) -> None:
        from google.genai import types

        await self._session.send_realtime_input(
            audio=types.Blob(data=pcm16, mime_type=f"audio/pcm;rate={config.SAMPLE_RATE}")
        )

    async def finish(self) -> None:
        with contextlib.suppress(Exception):
            await self._session.send_realtime_input(audio_stream_end=True)
        await asyncio.sleep(1.5)  # give Gemini a moment to deliver the trailing transcript
        await self._flush()

    async def close(self) -> None:
        if self._reader:
            self._reader.cancel()
        if self._cm:
            with contextlib.suppress(Exception):
                await self._cm.__aexit__(None, None, None)
