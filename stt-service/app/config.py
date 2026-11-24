"""Runtime configuration, read from environment variables."""
import os


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


# Which speech-to-text engine to use: "whisper" (self-hosted, default), "openai", "gemini" or "mock".
STT_PROVIDER = _env("STT_PROVIDER", "whisper").lower()

# --- faster-whisper (open source, self-hosted) ---
WHISPER_MODEL = _env("WHISPER_MODEL", "small")          # tiny | base | small | medium | large-v3
WHISPER_DEVICE = _env("WHISPER_DEVICE", "cpu")          # cpu | cuda
WHISPER_COMPUTE_TYPE = _env("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_BEAM_SIZE = int(_env("WHISPER_BEAM_SIZE", "1"))
# Nudges Whisper towards code-mixed Hindi/English output.
WHISPER_INITIAL_PROMPT = _env(
    "WHISPER_INITIAL_PROMPT",
    "Hello, aap kaise ho? Main theek hoon. Let's start the meeting. नमस्ते, कैसे हैं आप?",
)

# --- OpenAI transcription API (cloud) ---
OPENAI_API_KEY = _env("OPENAI_API_KEY", "")
OPENAI_MODEL = _env("OPENAI_MODEL", "gpt-4o-transcribe")                # used for final results
OPENAI_PARTIAL_MODEL = _env("OPENAI_PARTIAL_MODEL", "gpt-4o-mini-transcribe")  # live partials; "" disables

# --- Gemini Live (Google, free tier API) ---
GEMINI_API_KEY = _env("GEMINI_API_KEY", "")
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-live-2.5-flash-preview")
GEMINI_RESPONSE_MODALITY = _env("GEMINI_RESPONSE_MODALITY", "TEXT")  # native-audio models need AUDIO

# --- Streaming / VAD tuning ---
SAMPLE_RATE = 16000
PARTIAL_INTERVAL_SEC = float(_env("PARTIAL_INTERVAL_SEC", "0.8"))  # how often to emit partial results
SILENCE_FINALIZE_SEC = float(_env("SILENCE_FINALIZE_SEC", "0.7"))  # pause that ends an utterance
MAX_UTTERANCE_SEC = float(_env("MAX_UTTERANCE_SEC", "15"))         # force-finalize long utterances
VAD_ENERGY_THRESHOLD = float(_env("VAD_ENERGY_THRESHOLD", "0.012"))  # RMS on [-1, 1] audio

# --- Piper TTS (open source) ---
PIPER_VOICES_DIR = _env("PIPER_VOICES_DIR", "/models/piper")
PIPER_VOICE_EN = _env("PIPER_VOICE_EN", "en_US-lessac-medium")
PIPER_VOICE_HI = _env("PIPER_VOICE_HI", "hi_IN-pratham-medium")
