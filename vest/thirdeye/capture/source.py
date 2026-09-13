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

    width: int = 1920
    height: int = 1200
    framerate: int = 60

    def input_args(self) -> list[str]:
        if self.kind == "camera":
            # A USB camera. UVC is a standard class, so there is no driver to
            # install and it appears as a plain /dev/videoN.
            return ["-f", "v4l2",
                    "-framerate", str(self.framerate),
                    "-video_size", f"{self.width}x{self.height}",
                    "-i", self.target]
        if self.kind == "libcamera":
            # A camera on the ribbon connector of a Raspberry Pi.
            #
            # These do not work through the v4l2 path above. The sensor is
            # driven by libcamera, and ffmpeg has no libcamera input, so the
            # frames come in over a pipe from rpicam-vid instead. `-i -` reads
            # that pipe; the target names the camera index.
            return ["-f", "h264", "-framerate", str(self.framerate), "-i", "-"]
        if self.kind == "file":
            # A recording, looped forever, paced as if it were live. Without
            # -re ffmpeg would consume the file as fast as it can read it and
            # the buffer would hold hours in seconds.
            return ["-stream_loop", "-1", "-re", "-i", self.target]
        if self.kind == "pattern":
            return ["-f", "lavfi", "-re", "-i", self.target]
        raise ValueError(f"unknown source kind: {self.kind}")

    def producer_command(self) -> list[str] | None:
        """The process that feeds ffmpeg, when one is needed.

        Only the Pi ribbon camera needs this. `rpicam-vid` owns the sensor and
        writes an H.264 stream to stdout, which is piped into ffmpeg. On a Pi 5
        that encode is done in software by rpicam-vid itself; on a Pi 4 it uses
        the hardware encoder. Either way ffmpeg receives an encoded stream, so
        the segmenter can copy rather than re-encode - see `Recorder`.
        """
        if self.kind != "libcamera":
            return None
        return [
            "rpicam-vid", "--camera", self.target, "--timeout", "0",
            "--width", str(self.width), "--height", str(self.height),
            "--framerate", str(self.framerate),
            "--codec", "h264", "--inline",  # inline headers: every segment is playable
            "--nopreview", "--output", "-",
        ]

    @property
    def preencoded(self) -> bool:
        """True when frames arrive already compressed, so nothing re-encodes."""
        return self.kind == "libcamera"

    @classmethod
    def parse(cls, spec: str) -> "Source":
        """One of:

        `camera:/dev/video0`     a USB camera
        `libcamera:0`            a camera on a Raspberry Pi ribbon connector
        `file:/path/to.mp4`      a recording, looped, for testing
        `pattern:testsrc=...`    a generated pattern, for testing
        """
        kind, _, target = spec.partition(":")
        if not target:
            raise ValueError(f"source needs a target, got {spec!r}")
        if kind == "file" and not Path(target).exists():
            raise FileNotFoundError(target)
        if kind not in ("camera", "libcamera", "file", "pattern"):
            raise ValueError(f"unknown source kind: {kind!r}")
        return cls(kind=kind, target=target)

    def output_filters(self) -> list[str]:
        """Make presentation timestamps climb, whatever the input does.

        A looping file restarts its timestamps on every pass. Left alone that
        breaks the keyframe expression the segmenter depends on, and segments
        stop landing where they are asked to. Rebuilding timestamps from the
        frame number makes the output monotonic no matter how often the input
        starts over.
        """
        if self.kind == "file":
            return ["-vf", "setpts=N/FRAME_RATE/TB"]
        return []

    @property
    def is_camera(self) -> bool:
        return self.kind in ("camera", "libcamera")
