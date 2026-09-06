"""Domain models.

The wire types are generated - see `thirdeye/protocol.py`, which comes from
`protocol/schema/protocol.v1.json` and must not be hand-edited. Anything here is
vest-local state that never crosses the link.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .protocol import ClipMeta, ClosedBy, SessionState

__all__ = ["ClipMeta", "ClosedBy", "SessionState", "ClipRecord", "SessionSnapshot"]


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


class SessionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: str | None
    state: SessionState
    seq_latest: int
    clips_held: int
