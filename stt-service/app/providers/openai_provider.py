"""Cloud STT using the OpenAI transcription API (gpt-4o-transcribe / whisper-1).

Re-uses the same energy-VAD streaming logic as the Whisper provider, but sends each
utterance to OpenAI instead of running a model locally. That makes it fast on tiny
CPU-only hosts (e.g. free cloud instances) and very accurate for Hindi / Hinglish.
"""
from __future__ import annotations

import io
import logging
import re
import wave
from typing import Optional, Tuple

import numpy as np

from .. import config
from .base import EmitFn, STTProvider, STTSession
from .streaming import BufferedVADSession

log = logging.getLogger(__name__)

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LATIN = re.compile(r"[A-Za-z]")


def detect_language(text: str) -> Optional[str]:
    """Guess hi / en / mixed from the script of the transcript."""
    hi, en = len(_DEVANAGARI.findall(text)), len(_LATIN.findall(text))
    if not hi and not en:
        return None
    if hi and en and min(hi, en) / (hi + en) > 0.15:
        return "mixed"
    return "hi" if hi > en else "en"


def to_wav(audio: np.ndarray) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(config.SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


class OpenAIProvider(STTProvider):
    name = "openai"

    def __init__(self) -> None:
        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set (required for STT_PROVIDER=openai)")
        from openai import OpenAI

        self.client = OpenAI(api_key=config.OPENAI_API_KEY, timeout=30)
        log.info("OpenAI STT ready (final=%s, partial=%s)", config.OPENAI_MODEL, config.OPENAI_PARTIAL_MODEL)

    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession:
        return OpenAISession(self, emit, language)


class OpenAISession(BufferedVADSession):
    def __init__(self, provider: OpenAIProvider, emit: EmitFn, language: Optional[str]):
        super().__init__(emit, language)
        self.provider = provider

    def transcribe(self, audio: np.ndarray, final: bool) -> Tuple[str, Optional[str]]:
        if len(audio) < config.SAMPLE_RATE * 0.3:
            return "", None
        if not final and not config.OPENAI_PARTIAL_MODEL:
            return "", None
        kwargs = dict(
            model=config.OPENAI_MODEL if final else config.OPENAI_PARTIAL_MODEL,
            file=("utterance.wav", to_wav(audio), "audio/wav"),
            prompt=config.WHISPER_INITIAL_PROMPT,
            response_format="text",
        )
        if self.language:
            kwargs["language"] = self.language
        try:
            result = self.provider.client.audio.transcriptions.create(**kwargs)
        except Exception as exc:  # network / quota errors shouldn't kill the session
            log.warning("OpenAI transcription failed: %s", exc)
            if final:
                raise
            return "", None
        text = (result if isinstance(result, str) else getattr(result, "text", "")).strip()
        return text, self.language or detect_language(text)
