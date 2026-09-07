"""Settings, environment driven.

Every value here has an operational reason, and every one of them is a knob
someone will want to turn on a wet Saturday without editing Python.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="THIRDEYE_", env_file=".env")

    # Identity
    camera_id: str = "vest-01"
    firmware: str = "0.1.0"

    # Capture
    buffer_seconds: float = 300.0
    """Depth of the rolling capture buffer.

    The vest records continuously and never stops. A marker from the phone does
    not start a recording; it says which five-ish minutes of footage to keep a
    piece of. That is what makes a marker queued during a Wi-Fi outage still
    produce a clip once the link returns - the footage was never conditional on
    the message arriving.

    Five minutes at 15 Mbps is about 560 MB, which is nothing on a 256 GB drive,
    and covers roughly an over of markers held through an outage."""

    preroll_seconds: float = 5.0
    """Seconds of run-up kept ahead of the START marker.

    Five, not the three in the original plan. A physical button press had a
    fixed, tiny latency. A press on a phone screen goes through the touch
    system, JavaScript, and a network hop, and the variance matters more than
    the mean. Pre-roll is what absorbs it."""

    clip_timeout_seconds: float = 40.0
    """Auto-close with no END marker. 40, not 25: a legitimate live ball with
    three runs and a throw runs to about 29 seconds, and truncating those loses
    exactly the deliveries people argue about."""

    marker_max_age_seconds: float = 280.0
    """Refuse a marker older than this. It must stay under `buffer_seconds` with
    room to spare, because a marker whose footage has already been overwritten
    should be rejected honestly rather than turned into an empty clip."""

    ring_size: int = 12
    """Clips held on disk. Announced to the phone in `hello` so it mirrors this
    rather than hardcoding a number of its own."""

    # Storage
    data_root: Path = Path("/data/matches")
    buffer_dir: Path = Path("/data/buffer")
    """On the SSD, not in tmpfs. Five minutes of video does not fit in RAM on
    this board, and unlike the old 20-second pre-roll ring this buffer is now
    load-bearing: it is the only copy of a delivery until a marker arrives."""

    # Network
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    """nginx terminates :80 and proxies here. Binding to loopback means the
    FastAPI process is not directly reachable from the access point."""

    # What the encoder is actually producing. Reported in clip metadata so the
    # phone can step exactly one frame without guessing the rate.
    resolution: str = "1920x1200"
    fps: float = 60.0
    codec: str = "h264"

    segment_seconds: float = 1.0
    """Length of one buffer fragment, and therefore the largest error a cut can
    have at its edges. Short segments cost more files and buy more precision."""

    source: str = "pattern:testsrc=size=1280x800:rate=30"
    """Where pictures come from: `camera:/dev/video0` on the vest, or a file or
    test pattern anywhere else. The camera is the last fake to be removed."""

    encoder: str | None = None
    """Force a specific ffmpeg encoder. On the vest this is the hardware one;
    left unset it falls back to libx264, which is right everywhere else."""

    heartbeat_seconds: float = 5.0
    """Also carries the clock sync. Every pong reports the vest's own time, and
    the phone uses it to stamp markers in vest time rather than phone time."""


    @property
    def preroll_s_effective(self) -> float:
        """Pre-roll can never exceed what the buffer holds."""
        return min(self.preroll_seconds, self.buffer_seconds / 2)


settings = Settings()
