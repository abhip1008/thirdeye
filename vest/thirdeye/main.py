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
import json
import logging
import secrets
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .api import files
from .api.hub import Hub, pong
from .capture.buffer import RollingBuffer
from .capture.recorder import Recorder
from .capture.source import Source
from .config import settings
from .protocol import PROTOCOL_VERSION
from .security import Verifier, load_or_create_key, now_stamp
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
store = ClipStore(
    root=settings.data_root, camera_id=settings.camera_id, ring_size=settings.ring_size
)
session = Session(settings, buffer, store, emit=hub.broadcast)
recorder = Recorder(
    source=Source.parse(
        settings.source,
        width=settings.width,
        height=settings.height,
        framerate=settings.framerate,
        extra_args=settings.camera_extra_args,
    ),
    buffer=buffer,
    video_bitrate=settings.video_bitrate,
    encoder=settings.encoder,
)

_started_at = time.monotonic()


def _signing_key() -> str:
    """The vest's key, or an ephemeral one when there is nowhere to keep it.

    On the vest /data is writable and the key survives reboots, which is what
    makes a pairing code worth printing. Anywhere else - a laptop, a test - the
    key lives only as long as the process, and the pairing code changes every
    restart. That is the right behaviour for a machine that is not a vest, and
    it says so rather than failing to start.
    """
    try:
        return load_or_create_key(settings.key_path)
    except OSError as exc:
        ephemeral = secrets.token_hex(32)
        log.warning("cannot keep a key at %s (%s); using one that dies with this process",
                    settings.key_path, exc)
        return ephemeral


signing_key = _signing_key()
verifier = Verifier(signing_key, required=settings.require_signature)


def require_signature(request: Request) -> None:
    """Every route that reveals or changes anything goes through here.

    Health is the exception: it is how you find out whether the thing is alive,
    and it says nothing a passer-by could not learn by looking at the vest.
    """
    reason = verifier.check(
        method=request.method,
        path=request.url.path,
        timestamp=request.headers.get("x-te-timestamp"),
        nonce=request.headers.get("x-te-nonce"),
        signature=request.headers.get("x-te-signature"),
        now=time.time(),
    )
    if reason is not None:
        log.warning("refused %s %s: %s", request.method, request.url.path, reason)
        # The vest's clock goes back with the refusal. A vest has no real-time
        # clock and, at a ground, no internet: it boots believing it is whenever
        # it was last switched off, which can be days ago. The phone's clock is
        # the accurate one, but signing needs agreement rather than accuracy, so
        # the phone adopts this and signs in vest time. Telling an unauthorised
        # caller what time the vest thinks it is costs nothing - health says the
        # same thing to anybody who asks.
        raise HTTPException(
            status_code=401,
            detail=reason,
            headers={"X-TE-Time": now_stamp(time.time())},
        )


def health() -> dict[str, Any]:
    """What the phone shows in the corner, and what a support call starts from."""
    root = settings.data_root.parent if settings.data_root.parent.exists() else Path("/")
    _, _, free = shutil.disk_usage(root)
    return {
        "battery_pct": 100.0,          # No battery gauge off the vest hardware yet.
        "temp_c": 0.0,                 # Same: read from the thermal zone in Phase 2.
        "disk_free_gb": round(free / 1e9, 1),
        # Probed from the last clip written, not read back from config. Zero
        # until the first clip is cut, and zero again if the recorder has died.
        "encoder_fps": store.last_measured_fps if recorder.running else 0.0,
        "clips_held": len(store.all()),
        "buffer_held_s": round(buffer.held_seconds(time.time()), 1),
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_root.mkdir(parents=True, exist_ok=True)
    # Redacted, deliberately. The payload carries the signing key, and a log is
    # the wrong place for it - journald keeps it, a support bundle copies it,
    # and anyone who has ever read a log has then had the key. `python -m
    # thirdeye.pairing` prints the real thing to a terminal on demand.
    log.info("pairing payload (key redacted; run python -m thirdeye.pairing for the real one):")
    log.info("  %s", json.dumps(pairing_payload(redacted=True)))
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
        # The vest's clock, on the one route that is not signed. A phone that
        # has never spoken to this vest signs its first request with this, which
        # is what lets a vest whose clock is days out still be talked to at all.
        # It is not a secret: it is the time.
        "vest_time": time.time(),
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


@app.post("/api/session/start", dependencies=[Depends(require_signature)])
async def api_start(body: StartMatch) -> dict[str, Any]:
    match_id = session.start_match(body.venue)
    await hub.broadcast(_hello_payload())
    return {"match_id": match_id}


@app.post("/api/session/end", dependencies=[Depends(require_signature)])
async def api_end() -> dict[str, Any]:
    session.end_match()
    return {"ok": True}


@app.get("/api/session", dependencies=[Depends(require_signature)])
def api_session() -> dict[str, Any]:
    return {
        "match_id": session.match_id,
        "state": session.state,
        "seq_latest": store.latest_seq(),
        "clips_held": len(store.all()),
        "buffer_held_s": round(buffer.held_seconds(time.time()), 1),
    }


@app.get("/api/clips", dependencies=[Depends(require_signature)])
def api_clips() -> list[dict[str, Any]]:
    return [clip.meta.model_dump() for clip in store.all()]


@app.get("/clips/{seq}.mp4", dependencies=[Depends(require_signature)])
def api_clip_file(seq: int, range: str | None = Header(default=None)):  # noqa: A002
    clip = store.get(seq)
    if clip is None:
        raise HTTPException(status_code=404, detail="no such clip")
    return files.serve(clip.path, range)


# ---------- WebSocket ----------


def pairing_payload(*, redacted: bool = False) -> dict[str, Any]:
    """What goes in the QR code taped to the vest.

    Including the signing key, which is the only place it is ever revealed. It
    does not appear on any route: an endpoint that hands out the key would undo
    the point of having one. `redacted=True` is for anything that gets written
    down - the startup banner, a bug report - and keeps the shape without the
    secret, so you can still see that the code is well formed.
    """
    return {
        "v": PROTOCOL_VERSION,
        "ssid": f"thirdeye-{settings.camera_id}",
        "password": "set-in-hostapd.conf",
        "host": settings.advertise_host,
        "camera_id": settings.camera_id,
        "psk": "<redacted>" if redacted else signing_key,
        "end": "bowlers",
    }


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
        # The phone shows this rather than offering a control of its own. The
        # cut happens here, with this number; a pre-roll dial on the phone was
        # connected to nothing and said otherwise.
        "preroll_seconds": settings.preroll_s_effective,
    }


@app.websocket("/ws")
async def websocket(socket: WebSocket) -> None:
    # The control channel is signed on the query string rather than in headers.
    # A browser and a React Native WebSocket cannot set headers on the opening
    # request, so the one thing every client can carry is the URL.
    reason = verifier.check(
        method="GET",
        path="/ws",
        timestamp=socket.query_params.get("ts"),
        nonce=socket.query_params.get("nonce"),
        signature=socket.query_params.get("sig"),
        now=time.time(),
    )
    if reason is not None:
        log.warning("refused a control channel: %s", reason)
        # 1008 is "policy violation". Closing before accepting means an
        # unsigned client never gets far enough to hear a single clip.
        await socket.close(code=1008, reason=reason)
        return

    await socket.accept()
    await hub.add(socket)
    try:
        await hub.send(socket, _hello_payload())
        await hub.send(
            socket, {"type": "status", "camera_id": settings.camera_id, "health": health()}
        )

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
