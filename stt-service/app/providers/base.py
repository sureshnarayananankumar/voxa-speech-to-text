"""Provider interface shared by all speech-to-text engines.

A provider session receives raw PCM16 mono 16 kHz audio chunks and emits events
through an async callback:

    {"type": "partial", "text": "..."}                       # interim hypothesis, may change
    {"type": "final",   "text": "...", "language": "hi", "start": 1.2, "end": 3.4}
"""
from __future__ import annotations

import abc
from typing import Awaitable, Callable, Optional

EmitFn = Callable[[dict], Awaitable[None]]


class STTSession(abc.ABC):
    def __init__(self, emit: EmitFn, language: Optional[str] = None):
        self.emit = emit
        # None / "auto" => let the engine detect; otherwise an ISO code such as "hi" or "en".
        self.language = None if language in (None, "", "auto") else language

    async def start(self) -> None:  # optional hook
        return None

    @abc.abstractmethod
    async def feed(self, pcm16: bytes) -> None:
        """Push a chunk of little-endian int16 PCM audio (16 kHz mono)."""

    @abc.abstractmethod
    async def finish(self) -> None:
        """Flush remaining audio and emit any last final result."""

    async def close(self) -> None:  # optional hook
        return None


class STTProvider(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession: ...
