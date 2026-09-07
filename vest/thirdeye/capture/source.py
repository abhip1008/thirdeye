"""Where the pictures come from.

Three sources, one interface. The real one is a camera on the vest; the other
two exist so that everything downstream - the buffer, the cutter, the link, the
phone - can be built and tested before any hardware is bought.

That is the same trick the phone app uses with its mock vest, applied one layer
down. The camera is the last fake to be removed, not the first.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Source:
    """A description of an input, and the ffmpeg arguments that open it."""

    kind: str
    target: str

    def input_args(self) -> list[str]:
        if self.kind == "camera":
            # A UVC camera on Linux. No custom driver: the class is standard.
            return ["-f", "v4l2", "-framerate", "60", "-video_size", "1920x1200",
                    "-i", self.target]
        if self.kind == "file":
            # A recording, looped forever, paced as if it were live. Without
            # -re ffmpeg would consume the file as fast as it can read it and
            # the buffer would hold hours in seconds.
            return ["-stream_loop", "-1", "-re", "-i", self.target]
        if self.kind == "pattern":
            return ["-f", "lavfi", "-re", "-i", self.target]
        raise ValueError(f"unknown source kind: {self.kind}")

    @classmethod
    def parse(cls, spec: str) -> "Source":
        """`camera:/dev/video0`, `file:/path/to.mp4`, or `pattern:testsrc=...`."""
        kind, _, target = spec.partition(":")
        if not target:
            raise ValueError(f"source needs a target, got {spec!r}")
        if kind == "file" and not Path(target).exists():
            raise FileNotFoundError(target)
        return cls(kind=kind, target=target)

    @property
    def is_camera(self) -> bool:
        return self.kind == "camera"
