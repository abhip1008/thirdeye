"""FastAPI entrypoint.

Phase 1 is one endpoint. It exists to prove the toolchain and to give Phase 3
something to point the phone at; the capture pipeline, the WebSocket hub and the
clip store arrive in Phases 2 to 4.
"""

from __future__ import annotations

import time

from fastapi import FastAPI

from .config import settings
from .protocol import PROTOCOL_VERSION

app = FastAPI(title="Third Eye vest", version=settings.firmware)

_STARTED_AT = time.monotonic()


@app.get("/api/health")
def health() -> dict[str, object]:
    """Liveness. Deliberately cheap: systemd polls it and so does the phone."""
    return {
        "ok": True,
        "uptime_s": round(time.monotonic() - _STARTED_AT, 1),
        "camera_id": settings.camera_id,
        "firmware": settings.firmware,
        "protocol": PROTOCOL_VERSION,
    }
