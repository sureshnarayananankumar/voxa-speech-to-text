"""Self-hosted open-source STT using faster-whisper (CTranslate2 port of OpenAI Whisper).

Whisper is multilingual and copes well with Hindi-English code-switching ("Hinglish").
Tip: language=None auto-detects per utterance; language="hi" yields Devanagari output,
language="en" tends to yield romanised Hinglish.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional, Tuple

import numpy as np

from .. import config
from .base import EmitFn, STTProvider, STTSession
from .streaming import BufferedVADSession

log = logging.getLogger(__name__)


class WhisperProvider(STTProvider):
    name = "whisper"

    def __init__(self) -> None:
        from faster_whisper import WhisperModel  # imported lazily so other providers don't need it

        log.info("Loading faster-whisper model '%s' on %s (%s)…",
                 config.WHISPER_MODEL, config.WHISPER_DEVICE, config.WHISPER_COMPUTE_TYPE)
        self.model = WhisperModel(
            config.WHISPER_MODEL,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE_TYPE,
        )
        # CTranslate2 models are thread-safe for inference, but on CPU we serialise
        # to avoid oversubscribing cores when many sessions are open.
        self.infer_lock = threading.Lock()
        log.info("Whisper model ready.")

    def create_session(self, emit: EmitFn, language: Optional[str] = None) -> STTSession:
        return WhisperSession(self, emit, language)


class WhisperSession(BufferedVADSession):
    def __init__(self, provider: WhisperProvider, emit: EmitFn, language: Optional[str]):
        super().__init__(emit, language)
        self.provider = provider

    def transcribe(self, audio: np.ndarray, final: bool) -> Tuple[str, Optional[str]]:
        if len(audio) < config.SAMPLE_RATE * 0.25:  # too short to be meaningful
            return "", None
        with self.provider.infer_lock:
            segments, info = self.provider.model.transcribe(
                audio,
                language=self.language,
                task="transcribe",                       # never translate - keep the mixed language
                beam_size=config.WHISPER_BEAM_SIZE if final else 1,
                vad_filter=final,                        # cleaner finals, faster partials
                condition_on_previous_text=False,
                initial_prompt=config.WHISPER_INITIAL_PROMPT,
                without_timestamps=True,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        return text, info.language
