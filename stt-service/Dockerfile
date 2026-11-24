FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
ENV PIPER_VOICES_DIR=/models/piper HF_HOME=/models/hf
# Fetch TTS voices at build time (optional - the service still runs without them).
RUN bash scripts/download_voices.sh || echo "Piper voices not downloaded; /tts will return 503"

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
