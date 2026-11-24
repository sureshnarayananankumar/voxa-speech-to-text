""""browser" mode: no server-side model at all.

The Angular client sees provider "browser" in /health and runs the browser's built-in
Web Speech API (Chrome / Edge) instead of streaming audio here. Useful on hosts that
are too small for Whisper when no cloud API key is available.
"""
from __future__ import annotations

from typing import Optional

from .base import EmitFn, STTProvider, STTSession


class _Unsupported(STTSession):
    async def start(self) -> None:
        await self.emit({"type": "error",
                         "message": "Server STT is in browser mode: use Chrome or Edge for speech recognition."})

    async def feed(self, pcm16: bytes) -> None:
        return None

    async def finish(self) -> None:
        return None


class BrowserProvider(STTProvider):
    name = "browser"

    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession:
        return _Unsupported(emit, language)
