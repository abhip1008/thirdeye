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

    # Defaults only for a Source built directly, in a test. The vest passes
    # THIRDEYE_WIDTH/HEIGHT/FRAMERATE in from settings, and those are the ones
    # that have to match a mode the sensor really has. They agree deliberately:
    # two different defaults in two files is how a camera ends up being asked
    # for a mode nobody chose.
    width: int = 1920
    height: int = 1080
    framerate: int = 30

    extra_args: tuple[str, ...] = ()
    """Anything else to pass the camera, from THIRDEYE_CAMERA_EXTRA_ARGS.

    An escape hatch, and an honest one: this talks to a program whose options
    differ between boards and between versions of rpicam-apps, and the useful
    ones are discovered with a camera in front of you rather than here. Somebody
    on a Pi can try `--shutter 4000` against a real ball without waiting for a
    release."""

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

    def producer_command(self, *, segment_seconds: float = 1.0) -> list[str] | None:
        """The process that feeds ffmpeg, when one is needed.

        Only the Pi ribbon camera needs this. `rpicam-vid` owns the sensor and
        writes an H.264 stream to stdout, which is piped into ffmpeg. On a Pi 5
        that encode is done in software by rpicam-vid itself; on a Pi 4 it uses
        the hardware encoder. Either way ffmpeg receives an encoded stream, so
        the segmenter can copy rather than re-encode - see `Recorder`.

        `--intra` matters more than it looks. The segmenter only cuts on a
        keyframe, and in this path it is not encoding, so it cannot make one -
        it takes what the producer gives it. Left at the default the stream gets
        a keyframe every couple of seconds and every "one-second" segment is
        really two, which doubles the error at both ends of every clip. Asking
        for one keyframe per segment is what keeps a cut landing where the
        umpire tapped.
        """
        if self.kind != "libcamera":
            return None
        intra = max(1, round(self.framerate * segment_seconds))
        return [
            "rpicam-vid", "--camera", self.target, "--timeout", "0",
            "--width", str(self.width), "--height", str(self.height),
            "--framerate", str(self.framerate),
            "--codec", "h264", "--inline",  # inline headers: every segment is playable
            # Name the output format, because the filename cannot imply it.
            # Where there is no hardware H.264 encoder - a Pi 5, which had it
            # removed - rpicam-vid compresses through libav, and libav works out
            # the container from the file extension. Writing to stdout there is
            # no extension, so it gives up with "Unable to choose an output
            # format for '-'". `h264` here is the raw elementary stream, which
            # is exactly what the ffmpeg downstream is told to expect.
            "--libav-format", "h264",
            "--intra", str(intra),
            "--nopreview", "--output", "-",
            *self.extra_args,
        ]

    @property
    def preencoded(self) -> bool:
        """True when frames arrive already compressed, so nothing re-encodes."""
        return self.kind == "libcamera"

    @classmethod
    def parse(
        cls,
        spec: str,
        *,
        width: int | None = None,
        height: int | None = None,
        framerate: int | None = None,
        extra_args: str | None = None,
    ) -> "Source":
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
        geometry: dict[str, object] = {
            k: v
            for k, v in (("width", width), ("height", height), ("framerate", framerate))
            if v is not None
        }
        if extra_args:
            geometry["extra_args"] = tuple(extra_args.split())
        return cls(kind=kind, target=target, **geometry)  # type: ignore[arg-type]

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
