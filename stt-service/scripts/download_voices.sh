#!/usr/bin/env bash
# Downloads open-source Piper voices (English + Hindi) used by the /tts endpoint.
set -euo pipefail
DIR="${PIPER_VOICES_DIR:-./models/piper}"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"
mkdir -p "$DIR"

fetch () {  # $1 = path inside repo, $2 = voice name
  for ext in onnx onnx.json; do
    [ -f "$DIR/$2.$ext" ] || curl -fL "$BASE/$1/$2.$ext" -o "$DIR/$2.$ext"
  done
}

fetch en/en_US/lessac/medium en_US-lessac-medium
fetch hi/hi_IN/pratham/medium hi_IN-pratham-medium
echo "Voices saved in $DIR"
