"""Turning a window of the buffer into a clip.

Stream copy, never a re-encode. A clip has to be on the phone inside the gap
between deliveries, and re-encoding forty seconds of 1080p would spend the whole
budget on work nobody asked for. Copying is close to instantaneous and the
picture is bit-identical to what was recorded.

The cost of copying is that boundaries land on segment edges rather than exactly
where the marker fell - a cut can begin at most one segment early. That is why
segments are short and why the pre-roll exists, and it is recorded honestly in
the clip's metadata rather than rounded away.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from .buffer import RollingBuffer

log = logging.getLogger(__name__)


class BufferMiss(Exception):
    """The window asked for is no longer on disk.

    Raised rather than returning a short clip. A marker whose footage has been
    overwritten should be refused so the phone can say so, because a clip that
    silently starts late looks exactly like a clip that is fine.
    """


@dataclass(frozen=True, slots=True)
class Cut:
    path: Path
    started_at: float
    ended_at: float

    @property
    def duration(self) -> float:
        return self.ended_at - self.started_at


async def cut(
    buffer: RollingBuffer,
    start: float,
    end: float,
    destination: Path,
    *,
    ffmpeg: str = "ffmpeg",
) -> Cut:
    """Concatenate the segments covering [start, end] into one file."""
    if end <= start:
        raise ValueError("a clip cannot end before it starts")

    segments = buffer.window(start, end)
    if not segments:
        raise BufferMiss(
            f"nothing on disk for {start:.3f}-{end:.3f}; "
            f"buffer holds from {buffer.earliest()}"
        )
    if segments[0].started_at > start + buffer.segment_seconds:
        raise BufferMiss(
            f"buffer starts at {segments[0].started_at:.3f}, after the requested {start:.3f}"
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    listing = destination.with_suffix(".concat.txt")
    listing.write_text("".join(f"file '{s.path}'\n" for s in segments))

    args = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "concat", "-safe", "0", "-i", str(listing),
        "-c", "copy",
        # The index goes up front so the file is playable the instant it is
        # written, which is what lets the phone start downloading immediately.
        "-movflags", "+faststart",
        str(destination),
    ]

    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()
    listing.unlink(missing_ok=True)

    if process.returncode != 0 or not destination.exists():
        raise RuntimeError(f"cut failed: {stderr.decode(errors='replace').strip()[-400:]}")

    return Cut(
        path=destination,
        started_at=segments[0].started_at,
        ended_at=segments[-1].ended_at,
    )
