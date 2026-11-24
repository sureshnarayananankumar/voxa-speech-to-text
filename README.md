# 🎙️ VOXA: Real-time Multilingual Speech-to-Text

My solution for **Assignment 1: Real-time Transcription**. You speak into the browser in Hindi, English, or a mix of the two (Hinglish), and the words show up on screen while you talk. Each recording session is saved in **PostgreSQL**. A **history dashboard** lets you create, read, update, delete, search, filter and sort saved transcriptions, and play any of them back with **Text-to-Speech**.

| Layer | Tech |
|---|---|
| Frontend | **Angular 19** (standalone components, signals), AudioWorklet mic capture |
| API / gateway | **Node.js 20 + Express**, `ws` WebSocket gateway, `pg` |
| Database | **PostgreSQL 16** |
| Speech-to-Text | **Python 3.11 + FastAPI**: self-hosted open-source **faster-whisper** (default) · **Gemini Live API** (optional) · mock engine |
| Text-to-Speech | Open-source **Piper** (English + Hindi voices), with the browser `speechSynthesis` as a fallback |

---

## UI and interaction design

The UI has a dark theme with glass-style panels and an animated background.

**Live Studio**

- **Audio-reactive orb**: a canvas animation running at 60 fps.
  - 256 frequency bars arranged in a circle, fed by the Web Audio `AnalyserNode`.
  - Rotating rings, orbiting particles and a pulsing core.
  - When the mic is off, it "breathes" gently so the page never looks static.
- **Waveform strip**: a live line drawing of the mic signal.
- **Animated words**: each final word fades in from a blur with a cyan glow. In-progress (partial) text has a shimmer and a blinking cursor.
- **Live stats panel**:
  - word count, which ticks up while you speak
  - words per minute, with a gauge
  - segment count
  - a 16-step mic level meter
  - a Hindi/English mix bar
  - a pipeline tracker: Mic → Gateway → speech engine → database
- **Controls**: language buttons (AUTO / हिंदी / EN / more), an auto-save toggle, and a recording timer. Press `Space` to start or stop and `Esc` to stop.

**Archive**

- **Stat cards**: the numbers count up as they load, and a donut chart shows the language split.
- **Record cards**:
  - Each card shows a decorative waveform generated from the record, which animates on hover.
  - The card border glows in the record's language colour.
  - Cards appear one after another on load, and placeholder cards show while data loads.
- **Detail drawer** (slides in from the right):
  - a colour-coded timeline of the segments
  - click any segment to hear it read aloud
  - edit the record in place
- **Search and navigation**:
  - instant search
  - language filter chips
  - sorting
  - card or table view
- **Feedback**:
  - pop-up notifications for actions
  - a custom delete confirmation dialog
- **Keyboard shortcuts**: `⌘K` or `/` to search, `N` for a new transcription, `Esc` to close.
- **Engine status**: the header checks the backend every 15 s and shows whether the speech engine is online.

![Live Studio](docs/live-studio.png)
![Archive](docs/archive.png)
![Detail drawer](docs/detail-drawer.png)

## Architecture

```
 Browser (Angular)                       Node.js (Express)                     Python (FastAPI)
 ┌─────────────────────┐  WS /ws/stream  ┌──────────────────────┐  WS /ws/transcribe ┌───────────────────────┐
 │ Mic → AudioWorklet  │ ─PCM16 16kHz──▶ │ WS gateway           │ ─────────────────▶ │ Energy VAD + streaming│
 │ (48k→16k downsample)│ ◀─partial/final─│  • relays events     │ ◀───────────────── │  • faster-whisper  or │
 │ Live transcript     │                 │  • saves session ────┼──▶ PostgreSQL      │  • Gemini Live     or │
 │ History dashboard   │ ─REST /api/───▶ │ CRUD /api/transcr... │                    │  • mock               │
 │ 🔊 Read aloud       │ ─POST /api/tts─▶│ TTS proxy ───────────┼──────────────────▶ │ Piper TTS  /tts       │
 └─────────────────────┘                 └──────────────────────┘                    └───────────────────────┘
```

**How the real-time part works**

1. An `AudioWorklet` (`frontend/public/pcm-worklet.js`) downsamples the mic signal to 16 kHz mono PCM16. It sends a 100 ms chunk over the WebSocket every 100 ms.
2. Node relays the audio to the Python service. It doesn't send the audio straight from the browser to Python, for three reasons:
   - The browser only ever talks to one origin.
   - API keys stay on the server.
   - Node can save each session to the database when it ends.
3. Python turns Whisper, which is a batch model, into a streaming recogniser (`app/providers/streaming.py`):
   - A cheap 30 ms energy VAD (voice activity detection) tracks when an utterance starts and stops.
   - While you speak, the current utterance is re-transcribed every 0.8 s and sent as a **partial** result. The UI shows partials in grey italics.
   - After a 0.7 s pause, the utterance is transcribed one last time and sent as a **final** result with its language and timestamps.
4. When you press stop, Node joins the final segments together and works out the dominant language. If a second language makes up ≥ 20 % of the words, it labels the session **`mixed`**. It then inserts one row (including per-segment JSON) and sends back `{type:"saved"}`.

**Multilingual / Hinglish:** Whisper is trained on 99 languages and handles code-switching within a sentence well. The task is always `transcribe`, never `translate`, so mixed speech stays mixed. A bilingual `initial_prompt` biases the model towards Hinglish. The *Language* dropdown in the UI controls the script:

- **Auto**: Whisper detects the language for each utterance.
- **Hindi**: output is in Devanagari.
- **English**: output is romanised Hinglish.

---

## Quick start (Docker)

```bash
docker compose up --build
# open http://localhost:8080
```

The first start downloads the Whisper `small` model (~460 MB) into a cached volume.

You can switch engines with environment variables:

```bash
STT_PROVIDER=gemini GEMINI_API_KEY=xxxx docker compose up      # Gemini Live (free API key from aistudio.google.com)
STT_PROVIDER=mock docker compose up                             # no model needed, for UI testing
WHISPER_MODEL=medium docker compose up                          # better Hindi accuracy (slower on CPU)
```

> Mic access needs `localhost` or HTTPS. Chrome and Edge are recommended.

## Running without Docker

```bash
# 1) PostgreSQL
createdb stt   # or: docker run -p 5432:5432 -e POSTGRES_USER=stt -e POSTGRES_PASSWORD=stt postgres:16

# 2) STT service
cd stt-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PIPER_VOICES_DIR=./models/piper bash scripts/download_voices.sh     # optional, for server-side TTS
STT_PROVIDER=whisper PIPER_VOICES_DIR=./models/piper uvicorn app.main:app --port 8000

# 3) Backend (auto-creates the table on startup)
cd backend && npm install
DATABASE_URL=postgres://stt:stt@localhost:5432/stt STT_URL=http://localhost:8000 npm start

# 4) Frontend (dev server proxies /api and /ws to :3000)
cd frontend && npm install && npx ng serve     # http://localhost:4200
```

---

## REST API (Node, port 3000)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/transcriptions?q=&language=&sort=created_at&order=desc&limit=20&offset=0` | Paginated list with search, language filter and sorting |
| `GET` | `/api/transcriptions/:id` | One transcription, including segments |
| `POST` | `/api/transcriptions` | Create manually: `{title, text, language?}` |
| `PUT` / `PATCH` | `/api/transcriptions/:id` | Full or partial update of `title`, `text`, `language` |
| `DELETE` | `/api/transcriptions/:id` | Delete (returns 204) |
| `GET` | `/api/stats` | Totals plus a breakdown by language for the dashboard |
| `POST` | `/api/tts` | `{text, language?}` returns `audio/wav` (Piper) |
| `GET` | `/api/health` | Backend health plus STT engine status |

**WebSocket `/ws/stream`**

- The client sends `{"type":"start","language":"auto","title":"…","save":true}`, then binary PCM16 frames, then `{"type":"stop"}`.
- The server sends `ready`, then `partial*` and `final*`, then `done`, then `saved` (or `error` if something fails).

## Database schema

```sql
CREATE TABLE transcriptions (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  text         TEXT NOT NULL,
  language     VARCHAR(20),           -- hi | en | mixed | …
  provider     VARCHAR(30),           -- whisper | gemini | mock | manual
  duration_sec NUMERIC(10,2) DEFAULT 0,
  segments     JSONB NOT NULL DEFAULT '[]',   -- [{text, language, start, end}]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Project layout

```
stt-service/   Python FastAPI: providers/{streaming,whisper,gemini,mock}.py, tts.py (Piper)
backend/       Node Express: routes.js (CRUD + TTS proxy), repository.js (SQL), ws-gateway.js
frontend/      Angular: live/ (recorder UI), history/ (dashboard + CRUD modals), services/
docker-compose.yml
```

## Testing

- `cd backend && npm test` runs unit tests for language aggregation and title generation.
- I tested the whole pipeline (Angular → Node → Python → PostgreSQL) end to end in headless Chromium with a fake microphone and the `mock` engine. The test covered:
  - live partial and final results
  - auto-save
  - view, edit and delete from the dashboard

## Trade-offs and next steps

- **Streaming on CPU:** re-transcribing each partial is simple and accurate, but it costs CPU. Next steps:
  - Use a GPU with `WHISPER_MODEL=large-v3`, or a model fine-tuned for Indic speech (for example AI4Bharat IndicWhisper).
  - Replace the energy VAD with Silero VAD.
- **Gemini Live:** model names change often, so set `GEMINI_MODEL` to whichever Live model your key can use. Native-audio models need `GEMINI_RESPONSE_MODALITY=AUDIO`.
- Not included yet: authentication and per-user history, storing the raw audio, and exporting to SRT or TXT.


---

## Cloud deployment (Render)

`render.yaml` is a Render Blueprint that deploys the whole stack on the free tier: Postgres (`voxa-db`), the STT service (`voxa-stt`), the API gateway (`voxa-backend`) and the Angular UI (`voxa`).

1. In Render, choose **New → Blueprint** and pick this repository.
2. When Render asks for env values, `GEMINI_API_KEY` is optional. Set it only if you switch `STT_PROVIDER` to `gemini`.
3. If Render gives a service a different URL than `https://<name>.onrender.com`, update `STT_URL` on `voxa-backend` and `BACKEND_URL` on `voxa` to match.

The free instance has only a fraction of a CPU, which is too slow for local Whisper, so the cloud deployment uses the OpenAI transcription API (`STT_PROVIDER=openai`, `gpt-4o-transcribe` for final text and `gpt-4o-mini-transcribe` for live partials). Set `OPENAI_API_KEY` on `voxa-stt` in the Render dashboard. Free services also sleep when idle, so the first request after a pause can take about a minute.

### No API key? Browser engine

With `STT_PROVIDER=browser` (the default in `render.yaml`) the server loads no model. The app instead uses the speech recognition built into **Chrome or Edge** (Web Speech API, `hi-IN`, which also captures Hinglish), shows live interim text, and saves each session with its segments to PostgreSQL through `POST /api/transcriptions`. Switch to `openai` (or a Groq key with `OPENAI_BASE_URL=https://api.groq.com/openai/v1`) for server-side transcription.
