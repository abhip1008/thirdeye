"""Domain models.

The wire types are generated - see `thirdeye/protocol.py`, which comes from
`protocol/schema/protocol.v1.json` and must not be hand-edited. Anything here is
vest-local state that never crosses the link.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .protocol import ClipMeta, ClosedBy, MarkEdge, SessionState

__all__ = [
    "ClipMeta",
    "ClosedBy",
    "MarkEdge",
    "SessionState",
    "ClipRecord",
    "Marker",
    "SessionSnapshot",
]


class ClipRecord(BaseModel):
    """A clip as the vest tracks it, on top of what it tells the phone."""

    model_config = ConfigDict(extra="forbid")

    meta: ClipMeta
    review_path: str
    archive_path: str | None = None
    delivered: bool = False
    """Set when the phone acknowledges the hash. Undelivered clips are not
    purged by the ring until they have been offered at least once."""
    pinned: bool = False
    cut_from_buffer_at: float | None = None
    """When the cut was actually made, as opposed to when the delivery happened.
    A marker replayed after a Wi-Fi outage produces a clip minutes after the
    ball, and the gap between these two timestamps is the only way to tell that
    apart from a fault."""


class Marker(BaseModel):
    """One edge of a delivery, as marked by the umpire in the app.

    Held even when it cannot be acted on immediately, so that a burst of
    markers replayed after an outage is processed in order rather than racing.
    """

    model_config = ConfigDict(extra="forbid")

    seq: int
    edge: MarkEdge
    at: float
    """Vest clock. The phone converts before sending; see `vest_time` on pong."""
    queued: bool = False
    received_at: float


class SessionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: str | None
    state: SessionState
    seq_latest: int
    clips_held: int
    buffer_held_s: float = 0.0
    """How far back the buffer currently reaches. The phone needs this to know
    whether a marker it is holding can still be turned into a clip."""
