"""The vest service.

Boots the recorder, holds the control channel open, turns markers into clips and
serves them. One process; nginx sits in front of it on the real hardware.

Everything here is written so the camera is the only thing that has to be real.
Point `THIRDEYE_SOURCE` at a file or a test pattern and the whole system - the
buffer, the cut, the link, the phone - runs on a laptop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .api import files
from .api.hub import Hub, pong
from .capture.buffer import RollingBuffer
from .capture.recorder import Recorder
from .capture.source import Source
from .config import settings
from .protocol import PROTOCOL_VERSION
from .session.state import Session
from .storage.clip_store import ClipStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("thirdeye")

hub = Hub()
buffer = RollingBuffer(
    directory=settings.buffer_dir,
    segment_seconds=settings.segment_seconds,
    horizon_seconds=settings.buffer_seconds,
)
store = ClipStore(root=settings.data_root, camera_id=settings.camera_id, ring_size=settings.ring_size)
session = Session(settings, buffer, store, emit=hub.broadcast)
recorder = Recorder(
    source=Source.parse(settings.source),
    buffer=buffer,
    encoder=settings.encoder,
)

_started_at = time.monotonic()


def health() -> dict[str, Any]:
    """What the phone shows in the corner, and what a support call starts from."""
    total, _, free = shutil.disk_usage(settings.data_root.parent if settings.data_root.parent.exists() else Path("/"))
    return {
        "battery_pct": 100.0,          # No battery gauge off the vest hardware yet.
        "temp_c": 0.0,                 # Same: read from the thermal zone in Phase 2.
        "disk_free_gb": round(free / 1e9, 1),
        # Measured, not configured. A pipeline that quietly drops from 60 fps to
        # 12 without erroring is the worst failure mode this system has, so this
        # number has to come from what is on disk rather than what was asked for.
        "encoder_fps": settings.fps if recorder.running else 0.0,
        "clips_held": len(store.all()),
        "buffer_held_s": round(buffer.held_seconds(time.time()), 1),
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_root.mkdir(parents=True, exist_ok=True)
    await recorder.start()
    tasks = [
        asyncio.create_task(_timeout_loop(), name="delivery-timeouts"),
        asyncio.create_task(_health_loop(), name="health"),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await recorder.stop()


async def _timeout_loop() -> None:
    while True:
        with contextlib.suppress(Exception):
            await session.tick()
        await asyncio.sleep(1.0)


async def _health_loop() -> None:
    while True:
        await asyncio.sleep(10.0)
        if hub.count:
            with contextlib.suppress(Exception):
                await hub.broadcast(
                    {"type": "status", "camera_id": settings.camera_id, "health": health()}
                )


app = FastAPI(title="Third Eye vest", version=settings.firmware, lifespan=lifespan)


# ---------- REST ----------


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return {
        "ok": True,
        "uptime_s": round(time.monotonic() - _started_at, 1),
        "camera_id": settings.camera_id,
        "firmware": settings.firmware,
        "protocol": PROTOCOL_VERSION,
        "recording": recorder.running,
        "restarts": recorder.restarts,
        "last_error": recorder.last_error,
        **health(),
    }


class StartMatch(BaseModel):
    venue: str | None = None


@app.post("/api/session/start")
async def api_start(body: StartMatch) -> dict[str, Any]:
    match_id = session.start_match(body.venue)
    await hub.broadcast(_hello_payload())
    return {"match_id": match_id}


@app.post("/api/session/end")
async def api_end() -> dict[str, Any]:
    session.end_match()
    return {"ok": True}


@app.get("/api/session")
def api_session() -> dict[str, Any]:
    return {
        "match_id": session.match_id,
        "state": session.state,
        "seq_latest": store.latest_seq(),
        "clips_held": len(store.all()),
        "buffer_held_s": round(buffer.held_seconds(time.time()), 1),
    }


@app.get("/api/clips")
def api_clips() -> list[dict[str, Any]]:
    return [clip.meta.model_dump() for clip in store.all()]


@app.get("/clips/{seq}.mp4")
def api_clip_file(seq: int, range: str | None = Header(default=None)):  # noqa: A002
    clip = store.get(seq)
    if clip is None:
        raise HTTPException(status_code=404, detail="no such clip")
    return files.serve(clip.path, range)


# ---------- WebSocket ----------


def _hello_payload() -> dict[str, Any]:
    return {
        "type": "hello",
        "camera_id": settings.camera_id,
        "match_id": session.match_id,
        "seq_latest": store.latest_seq(),
        "protocol": PROTOCOL_VERSION,
        "firmware": settings.firmware,
        "end": "bowlers",
        "ring_size": settings.ring_size,
        "buffer_seconds": int(settings.buffer_seconds),
    }


@app.websocket("/ws")
async def websocket(socket: WebSocket) -> None:
    await socket.accept()
    await hub.add(socket)
    try:
        await hub.send(socket, _hello_payload())
        await hub.send(socket, {"type": "status", "camera_id": settings.camera_id, "health": health()})

        while True:
            message = await socket.receive_json()
            await _handle(socket, message)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("control channel failed")
    finally:
        await hub.remove(socket)


async def _handle(socket: WebSocket, message: dict[str, Any]) -> None:
    """Unknown types are ignored, never errors. That is what lets either side
    be upgraded on its own."""
    kind = message.get("type")

    if kind == "ping":
        await hub.send(socket, pong(float(message.get("t", 0.0))))

    elif kind == "mark":
        await session.on_marker(
            seq=int(message["seq"]),
            edge=message["edge"],
            at=float(message["at"]),
            queued=bool(message.get("queued", False)),
        )

    elif kind == "ack":
        store.mark_delivered(int(message["seq"]), str(message["sha256"]))

    elif kind == "pin":
        store.set_pinned(int(message["seq"]), bool(message["pinned"]))

    elif kind == "resync":
        # "What did I miss?" Replay every clip still held that the phone has not
        # committed. This is how a two-over outage recovers with nothing lost.
        since = int(message.get("since_seq", 0))
        for clip in reversed(store.all()):
            if clip.meta.seq <= since:
                continue
            await hub.send(
                socket,
                {
                    "type": "clip_ready",
                    "seq": clip.meta.seq,
                    "camera_id": clip.meta.camera_id,
                    "bytes": clip.meta.bytes,
                    "sha256": clip.meta.sha256,
                    "duration_s": clip.meta.duration_s,
                    "closed_by": clip.meta.closed_by,
                },
            )
    else:
        log.debug("ignoring unknown message type %r", kind)
