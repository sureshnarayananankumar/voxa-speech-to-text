"""Mock provider: exercises the full streaming pipeline (VAD, partials, finals) without a
model. Handy for UI development, CI and machines that can't download Whisper weights."""
from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

from .. import config
from .base import EmitFn, STTProvider, STTSession
from .streaming import BufferedVADSession


class MockProvider(STTProvider):
    name = "mock"

    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession:
        return MockSession(emit, language)


class MockSession(BufferedVADSession):
    WORDS = ["namaste", "hello", "aaj", "ka", "weather", "bahut", "accha", "hai", "let's", "go"]

    def transcribe(self, audio: np.ndarray, final: bool) -> Tuple[str, Optional[str]]:
        n = max(1, int(len(audio) / config.SAMPLE_RATE * 2.5))  # ~2.5 words per second
        words = [self.WORDS[i % len(self.WORDS)] for i in range(n)]
        return " ".join(words), self.language or "hi"
