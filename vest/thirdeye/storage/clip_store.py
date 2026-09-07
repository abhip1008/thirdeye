"""Clips on the vest: writing them, hashing them, and letting them go.

Every clip gets a sidecar of metadata and a SHA-256. The hash is not
bookkeeping - it is what the phone checks before it will call a clip ready, and
it is the reason a half-transferred file can never be shown to an umpire as
something they can review.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..protocol import ClipMeta, ClosedBy, PROTOCOL_VERSION

log = logging.getLogger(__name__)


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


@dataclass
class StoredClip:
    meta: ClipMeta
    path: Path
    delivered: bool = False
    pinned: bool = False
    cut_at: float = field(default_factory=time.time)


class ClipStore:
    """The vest's twelve-clip ring."""

    def __init__(self, root: Path, camera_id: str, ring_size: int) -> None:
        self.root = root
        self.camera_id = camera_id
        self.ring_size = ring_size
        self._clips: dict[int, StoredClip] = {}

    # ---------- paths ----------

    def match_dir(self, match_id: str) -> Path:
        return self.root / match_id / "clips"

    def clip_path(self, match_id: str, seq: int) -> Path:
        return self.match_dir(match_id) / f"clip_{seq:04d}.mp4"

    # ---------- writing ----------

    def record(
        self,
        *,
        match_id: str,
        seq: int,
        path: Path,
        started_at: float,
        ended_at: float,
        closed_by: ClosedBy,
        preroll_s: float,
        resolution: str,
        fps: float,
        codec: str,
    ) -> StoredClip:
        """Hash the file, write the sidecar, and put it in the ring."""
        meta = ClipMeta(
            v=PROTOCOL_VERSION,
            match_id=match_id,
            camera_id=self.camera_id,
            seq=seq,
            started_at=started_at,
            ended_at=ended_at,
            duration_s=round(ended_at - started_at, 3),
            preroll_s=preroll_s,
            closed_by=closed_by,
            resolution=resolution,
            fps=fps,
            codec=codec,
            bytes=path.stat().st_size,
            sha256=sha256_of(path),
            # The vest does not know the score, and deliberately does not try to.
            over=None,
            ball_in_over=None,
            legal=True,
        )
        path.with_suffix(".json").write_text(meta.model_dump_json(indent=2))

        stored = StoredClip(meta=meta, path=path)
        self._clips[seq] = stored
        log.info("clip %d stored: %.1fs, %d bytes", seq, meta.duration_s, meta.bytes)
        return stored

    # ---------- reading ----------

    def get(self, seq: int) -> StoredClip | None:
        return self._clips.get(seq)

    def all(self) -> list[StoredClip]:
        return [self._clips[k] for k in sorted(self._clips, reverse=True)]

    def latest_seq(self) -> int:
        return max(self._clips, default=0)

    def mark_delivered(self, seq: int, sha256: str) -> bool:
        """The phone has it and the hash agrees. Only then may it be purged."""
        clip = self._clips.get(seq)
        if clip is None:
            return False
        if clip.meta.sha256 != sha256:
            log.warning("clip %d acknowledged with the wrong hash; ignoring", seq)
            return False
        clip.delivered = True
        return True

    def set_pinned(self, seq: int, pinned: bool) -> bool:
        clip = self._clips.get(seq)
        if clip is None:
            return False
        clip.pinned = pinned
        return True

    # ---------- retention ----------

    def purge(self) -> list[int]:
        """Drop clips past the ring. Returns what went.

        A clip the phone has not acknowledged is kept even when it is past the
        ring: it is the only copy, and deleting it because a download was slow
        would lose a delivery to a network hiccup. Pinned clips are kept for the
        same reason the phone keeps them.
        """
        newest = self.latest_seq()
        removed: list[int] = []
        for seq in sorted(self._clips):
            clip = self._clips[seq]
            if seq > newest - self.ring_size:
                continue
            if clip.pinned or not clip.delivered:
                continue
            clip.path.unlink(missing_ok=True)
            clip.path.with_suffix(".json").unlink(missing_ok=True)
            del self._clips[seq]
            removed.append(seq)
        if removed:
            log.info("purged clips %s", removed)
        return removed
