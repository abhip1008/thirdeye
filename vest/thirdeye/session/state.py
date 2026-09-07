"""Markers in, clips out.

The umpire's taps arrive here as markers with a timestamp in the vest's own
clock. Nothing about recording depends on them - the recorder has been running
since boot - so this module's only job is deciding which windows of the buffer
become clips.

That distinction is what makes the late cases work. A marker held on the phone
through a Wi-Fi outage is not a lost ball, it is a window that has not been cut
yet, and it is still cuttable for as long as the buffer reaches back that far.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date

from ..capture.buffer import RollingBuffer
from ..capture.cutter import BufferMiss, cut
from ..config import Settings
from ..protocol import ClosedBy, MarkEdge, SessionState
from ..storage.clip_store import ClipStore, StoredClip

log = logging.getLogger(__name__)

Emit = Callable[[dict], Awaitable[None]]


@dataclass
class OpenDelivery:
    seq: int
    started_at: float
    received_at: float


class Session:
    """One match, and the deliveries within it."""

    def __init__(
        self,
        settings: Settings,
        buffer: RollingBuffer,
        store: ClipStore,
        emit: Emit,
    ) -> None:
        self.settings = settings
        self.buffer = buffer
        self.store = store
        self.emit = emit

        self.match_id: str | None = None
        self.open: OpenDelivery | None = None
        self._last_marker_at: float = 0.0
        self._lock = asyncio.Lock()

    # ---------- match ----------

    def start_match(self, venue: str | None = None) -> str:
        """Mint a match id from a date and a ground, and nothing else.

        No team names, no player names, no umpire name. This identifier ends up
        in file paths and in the phone's audit trail, and those outlive the
        video.
        """
        slug = "".join(c if c.isalnum() else "-" for c in (venue or "").lower()).strip("-")
        slug = "-".join(part for part in slug.split("-") if part)
        self.match_id = f"{date.today().isoformat()}-{slug}" if slug else date.today().isoformat()
        self.open = None
        log.info("match %s started", self.match_id)
        return self.match_id

    def end_match(self) -> None:
        log.info("match %s ended", self.match_id)
        self.match_id = None
        self.open = None

    @property
    def state(self) -> SessionState:
        return "recording" if self.open is not None else "idle"

    # ---------- markers ----------

    async def on_marker(self, seq: int, edge: MarkEdge, at: float, queued: bool = False) -> None:
        """Handle one edge of a delivery."""
        async with self._lock:
            if self.match_id is None:
                log.warning("marker for delivery %d with no match running", seq)
                return

            age = time.time() - at
            if age > self.settings.marker_max_age_seconds:
                # Refuse honestly. A marker whose footage has been overwritten
                # would otherwise become an empty clip that looks like a fault.
                log.warning("marker %d/%s is %.0fs old, past the buffer", seq, edge, age)
                await self.emit(
                    {"type": "marker_refused", "seq": seq, "edge": edge, "age_s": round(age, 1)}
                )
                return

            # The phone debounces already; this is the second line, for a
            # duplicate replayed twice after an outage.
            if not queued and abs(at - self._last_marker_at) < 0.25:
                log.debug("marker %d/%s ignored as a duplicate", seq, edge)
                return
            self._last_marker_at = at

            if edge == "start":
                await self._on_start(seq, at)
            else:
                await self._on_end(seq, at)

    async def _on_start(self, seq: int, at: float) -> None:
        if self.open is not None:
            # A start while one is open means the end was missed. Close the old
            # delivery where the new one begins rather than discarding it.
            log.info("delivery %d never ended; closing it at the next start", self.open.seq)
            await self._close(self.open, at, "timeout")

        self.open = OpenDelivery(seq=seq, started_at=at, received_at=time.time())
        await self._announce_state(seq, at)

    async def _on_end(self, seq: int, at: float) -> None:
        current = self.open
        self.open = None

        if current is None or current.seq != seq:
            # An end with no start: the umpire missed the first tap. Cut
            # backwards out of the buffer anyway - this is the whole reason the
            # buffer exists, and under the old gated design it was simply lost.
            log.info("delivery %d had no start marker; recovering from the buffer", seq)
            fallback = self.settings.clip_timeout_seconds / 2
            await self._cut_and_store(seq, at - fallback, at, "recovered")
        else:
            await self._cut_and_store(seq, current.started_at, at, "button")

        await self._announce_state(seq, at)

    async def tick(self) -> None:
        """Close a delivery nobody ended. Called on a timer."""
        async with self._lock:
            current = self.open
            if current is None:
                return
            deadline = current.started_at + self.settings.clip_timeout_seconds
            if time.time() < deadline:
                return
            self.open = None
            log.info("delivery %d timed out", current.seq)
            await self._close(current, deadline, "timeout")
            await self._announce_state(current.seq, deadline)

    async def _close(self, delivery: OpenDelivery, end: float, closed_by: ClosedBy) -> None:
        await self._cut_and_store(delivery.seq, delivery.started_at, end, closed_by)

    # ---------- cutting ----------

    async def _cut_and_store(
        self, seq: int, start: float, end: float, closed_by: ClosedBy
    ) -> StoredClip | None:
        assert self.match_id is not None
        # Reach back before the tap, because a press on glass lands late and the
        # run-up is the half that makes a clip worth watching.
        window_start = start - self.settings.preroll_s_effective

        destination = self.store.clip_path(self.match_id, seq)
        try:
            result = await cut(self.buffer, window_start, end, destination)
        except BufferMiss as miss:
            log.warning("delivery %d: %s", seq, miss)
            await self.emit({"type": "marker_refused", "seq": seq, "edge": "end", "reason": str(miss)})
            return None
        except Exception:  # noqa: BLE001 - one failed cut must not stop the match
            log.exception("delivery %d could not be cut", seq)
            return None

        clip = self.store.record(
            match_id=self.match_id,
            seq=seq,
            path=result.path,
            started_at=result.started_at,
            ended_at=result.ended_at,
            closed_by=closed_by,
            preroll_s=self.settings.preroll_s_effective,
            resolution=self.settings.resolution,
            fps=self.settings.fps,
            codec=self.settings.codec,
        )

        await self.emit(
            {
                "type": "clip_ready",
                "seq": seq,
                "camera_id": clip.meta.camera_id,
                "bytes": clip.meta.bytes,
                "sha256": clip.meta.sha256,
                "duration_s": clip.meta.duration_s,
                "closed_by": closed_by,
            }
        )
        for gone in self.store.purge():
            await self.emit({"type": "clip_expired", "seq": gone, "camera_id": self.store.camera_id})
        return clip

    async def _announce_state(self, seq: int, since: float) -> None:
        await self.emit(
            {
                "type": "session_state",
                "camera_id": self.store.camera_id,
                "state": self.state,
                "seq": seq,
                "since": since,
            }
        )
