"""The control channel.

One always-open WebSocket per phone, carrying about eighty bytes a message. It
stays up for the length of a match, so everything here is written for a link
that will drop and come back rather than one that works.

Unknown message types are ignored rather than treated as errors. That rule is
what lets a vest and a phone on different versions keep working, and it is
cheaper to honour here than to negotiate later.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    """Every connected phone, and the fan-out to them."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def add(self, socket: WebSocket) -> None:
        async with self._lock:
            self._clients.add(socket)
        log.info("phone connected (%d attached)", len(self._clients))

    async def remove(self, socket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(socket)
        log.info("phone disconnected (%d attached)", len(self._clients))

    @property
    def count(self) -> int:
        return len(self._clients)

    async def send(self, socket: WebSocket, message: dict[str, Any]) -> None:
        await socket.send_text(json.dumps({"v": 1, **message}))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send to everyone still listening; drop anyone who has gone.

        A failed send is not an error worth propagating - the phone walked out
        of range, and the next reconnect will resync.
        """
        payload = json.dumps({"v": 1, **message})
        async with self._lock:
            targets = list(self._clients)
        for socket in targets:
            try:
                await socket.send_text(payload)
            except Exception:  # noqa: BLE001
                await self.remove(socket)


def pong(t: float) -> dict[str, Any]:
    """Echo the phone's timestamp and add ours.

    The second number is what lets the phone work out the offset between the two
    clocks and stamp its markers in vest time - so the vest never has to track a
    per-client offset, and a second phone needs no extra work.
    """
    return {"type": "pong", "t": t, "vest_time": time.time()}
