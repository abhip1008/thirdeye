"""The rolling buffer.

The vest records continuously and never stops. This module owns the window of
footage that is still recoverable: a directory of short segments, an index from
wall-clock time to segment, and a janitor that drops anything past the horizon.

A marker from the phone does not start a recording, it selects part of this. So
the two questions asked of this module are "which segments cover this window"
and "is this window still here at all" - and the second one has to be answered
honestly, because a marker whose footage has been overwritten must be refused
rather than turned into an empty clip.

Segments are short, and that length is the only source of boundary error: a cut
can begin at most one segment early. One second is the trade the spec settled
on, and it is why the pre-roll exists.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

SEGMENT_PATTERN = re.compile(r"^seg_(\d+)_(\d+\.\d+)\.mp4$")


@dataclass(frozen=True, slots=True)
class Segment:
    """One recorded fragment, named for when it started."""

    path: Path
    index: int
    started_at: float
    duration: float

    @property
    def ended_at(self) -> float:
        return self.started_at + self.duration


def segment_name(index: int, run_started_at: float) -> str:
    """`seg_00412_1757193021.220.mp4`.

    The float is when the *recorder run* began. It separates one run from the
    next after a restart, so indices that continue across a restart are not
    mistaken for one continuous stretch of time.

    The name deliberately does not carry the segment's own start. That was tried
    and it was wrong: it required assuming every segment is exactly
    `segment_seconds` long, and ffmpeg cuts on keyframes, so real segments run
    slightly long or short. The error accumulates - after three minutes the
    derived clock had drifted fifteen seconds behind the wall clock, and cuts
    for deliveries that had definitely been recorded were being refused as
    missing. Start times now come from the filesystem instead; see `segments`.
    """
    return f"seg_{index:05d}_{run_started_at:.3f}.mp4"


def parse_name(path: Path) -> tuple[int, float] | None:
    """Returns (index, run start time), or None if this is not a segment."""
    match = SEGMENT_PATTERN.match(path.name)
    if not match:
        return None
    return int(match.group(1)), float(match.group(2))


class RollingBuffer:
    """Indexes the segment directory and answers questions about the window."""

    def __init__(self, directory: Path, segment_seconds: float, horizon_seconds: float) -> None:
        self.directory = directory
        self.segment_seconds = segment_seconds
        self.horizon_seconds = horizon_seconds

    def segments(self, *, include_in_flight: bool = False) -> list[Segment]:
        """Every segment on disk, oldest first, with its true start time.

        The recorder may have been restarted, so files are grouped by the run
        they belong to and each segment's start is its offset within that run.

        The newest segment of each run is still being written, and a half-flushed
        file cut into a clip is a clip that ends mid-frame. It is excluded unless
        asked for, which is the difference between "what exists" and "what can
        be used".
        """
        if not self.directory.exists():
            return []

        runs: dict[float, list[tuple[int, Path, float]]] = {}
        for path in self.directory.iterdir():
            parsed = parse_name(path)
            if parsed is None:
                continue
            try:
                closed_at = path.stat().st_mtime
            except OSError:
                continue  # vanished between listing and stat
            runs.setdefault(parsed[1], []).append((parsed[0], path, closed_at))

        segments: list[Segment] = []
        for members in runs.values():
            members.sort(key=lambda m: m[0])
            for position, (index, path, closed_at) in enumerate(members):
                in_flight = position == len(members) - 1
                if in_flight and not include_in_flight:
                    continue
                # A segment ends when its file was last written, and begins when
                # the previous one ended. The filesystem knows this exactly; the
                # index does not, because segments land on keyframes rather than
                # on a stopwatch.
                started_at = members[position - 1][2] if position > 0 else closed_at - self.segment_seconds
                segments.append(
                    Segment(
                        path=path,
                        index=index,
                        started_at=started_at,
                        duration=max(0.001, closed_at - started_at),
                    )
                )
        return sorted(segments, key=lambda s: s.started_at)

    def earliest(self) -> float | None:
        segs = self.segments(include_in_flight=True)
        return segs[0].started_at if segs else None

    def held_seconds(self, now: float) -> float:
        """How far back the buffer currently reaches, for the health report."""
        first = self.earliest()
        return 0.0 if first is None else max(0.0, now - first)

    def covers(self, start: float, end: float) -> bool:
        """Whether the whole window is still on disk.

        Both ends matter. Missing the start means the run-up is gone, which is
        the half a late marker loses; missing the end means the segment is still
        being written and the cut has to wait.
        """
        segs = self.segments()
        if not segs:
            return False
        return segs[0].started_at <= start and segs[-1].ended_at >= end

    def window(self, start: float, end: float) -> list[Segment]:
        """The segments covering [start, end], in order.

        Inclusive at both ends: a segment that merely overlaps the window is
        needed, because dropping it would clip the very moment being asked for.
        """
        if end <= start:
            return []
        return [s for s in self.segments() if s.ended_at > start and s.started_at < end]

    def prune(self, now: float) -> list[Path]:
        """Delete anything past the horizon. Returns what went.

        Runs on a timer rather than on demand. The buffer is the only copy of a
        delivery until a marker arrives, so it is trimmed on a schedule that does
        not depend on anyone asking for anything.
        """
        cutoff = now - self.horizon_seconds
        removed: list[Path] = []
        for seg in self.segments():  # never the in-flight one
            if seg.ended_at >= cutoff:
                continue
            try:
                seg.path.unlink()
                removed.append(seg.path)
            except OSError:
                # Already gone, or being written. Either way not worth failing a
                # janitor pass over.
                continue
        return removed
