"""Open-source Text-to-Speech with Piper (https://github.com/rhasspy/piper).

Voices are ONNX files (<name>.onnx + <name>.onnx.json) placed in PIPER_VOICES_DIR.
`scripts/download_voices.sh` fetches an English and a Hindi voice. Text containing
Devanagari is spoken with the Hindi voice, everything else with the English voice.
"""
from __future__ import annotations

import io
import logging
import os
import re
import threading
import wave
from typing import Dict, Optional

from . import config

log = logging.getLogger(__name__)
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


class PiperTTS:
    def __init__(self) -> None:
        self._voices: Dict[str, object] = {}
        self._lock = threading.Lock()

    def _voice_path(self, name: str) -> str:
        return os.path.join(config.PIPER_VOICES_DIR, f"{name}.onnx")

    def available(self) -> Dict[str, bool]:
        return {
            "en": os.path.exists(self._voice_path(config.PIPER_VOICE_EN)),
            "hi": os.path.exists(self._voice_path(config.PIPER_VOICE_HI)),
        }

    def _load(self, name: str):
        if name not in self._voices:
            from piper import PiperVoice
            self._voices[name] = PiperVoice.load(self._voice_path(name))
        return self._voices[name]

    def pick_voice(self, text: str, lang: Optional[str]) -> str:
        avail = self.available()
        want_hi = lang == "hi" or (lang in (None, "", "auto") and _DEVANAGARI.search(text))
        if want_hi and avail["hi"]:
            return config.PIPER_VOICE_HI
        if avail["en"]:
            return config.PIPER_VOICE_EN
        if avail["hi"]:
            return config.PIPER_VOICE_HI
        raise FileNotFoundError("No Piper voices installed (run scripts/download_voices.sh)")

    def synthesize(self, text: str, lang: Optional[str] = None) -> bytes:
        name = self.pick_voice(text, lang)
        with self._lock:
            voice = self._load(name)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav:
                if hasattr(voice, "synthesize_wav"):       # piper-tts >= 1.3
                    voice.synthesize_wav(text, wav)
                else:                                      # older piper-tts
                    voice.synthesize(text, wav)
        return buf.getvalue()


tts = PiperTTS()
