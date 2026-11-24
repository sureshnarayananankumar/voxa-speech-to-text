"""Speech-to-Text microservice.

WebSocket protocol  (ws://host:8000/ws/transcribe)
  client -> {"type": "start", "language": "auto" | "hi" | "en" | ...}   (text frame)
  client -> <binary PCM16 LE, mono, 16 kHz>                              (many frames)
  client -> {"type": "stop"}                                             (text frame)
  server -> {"type": "ready", "provider": "whisper"}
  server -> {"type": "partial", "text": "..."}
  server -> {"type": "final", "text": "...", "language": "hi", "start": 0.4, "end": 2.1}
  server -> {"type": "done"}  |  {"type": "error", "message": "..."}

REST
  GET  /health
  POST /tts  {"text": "...", "language": "auto"}  -> audio/wav   (Piper, open source)
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import config
from .providers import build_provider
from .tts import tts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("stt")

state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the model once at startup (can take a while the first time: weights download).
    state["provider"] = await asyncio.to_thread(build_provider)
    yield


app = FastAPI(title="Speech-to-Text service", lifespan=lifespan)


@app.get("/health")
async def health():
    p = state.get("provider")
    return {"status": "ok" if p else "loading", "provider": p.name if p else None, "tts": tts.available()}


@app.websocket("/ws/transcribe")
async def transcribe(ws: WebSocket):
    await ws.accept()
    provider = state["provider"]
    session = None
    send_lock = asyncio.Lock()

    async def emit(event: dict) -> None:
        async with send_lock:
            try:
                await ws.send_text(json.dumps(event, ensure_ascii=False))
            except Exception:  # client went away
                pass

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                if session is None:  # audio before "start": auto-start with auto language
                    session = provider.create_session(emit, None)
                    await session.start()
                await session.feed(msg["bytes"])
                continue

            data = json.loads(msg.get("text") or "{}")
            kind = data.get("type")
            if kind == "start":
                if session:
                    await session.close()
                session = provider.create_session(emit, data.get("language"))
                await session.start()
                await emit({"type": "ready", "provider": provider.name})
            elif kind == "stop":
                if session:
                    await session.finish()
                    await session.close()
                    session = None
                await emit({"type": "done"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("transcription session failed")
        await emit({"type": "error", "message": str(exc)})
    finally:
        if session:
            await session.close()


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    language: Optional[str] = "auto"


@app.post("/tts")
async def synthesize(req: TTSRequest):
    try:
        wav = await asyncio.to_thread(tts.synthesize, req.text, req.language)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(content=wav, media_type="audio/wav")
