from .. import config
from .base import STTProvider


def build_provider() -> STTProvider:
    name = config.STT_PROVIDER
    if name == "whisper":
        from .whisper_provider import WhisperProvider
        return WhisperProvider()
    if name == "gemini":
        from .gemini_provider import GeminiProvider
        return GeminiProvider()
    if name == "mock":
        from .mock_provider import MockProvider
        return MockProvider()
    raise ValueError(f"Unknown STT_PROVIDER '{name}' (expected whisper | gemini | mock)")
