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

    # Capture, see spec sections 7.6 and 4
    preroll_seconds: float = 3.0
    """Seconds of run-up pulled from the ring buffer ahead of the START press."""

    clip_timeout_seconds: float = 40.0
    """Auto-close with no END press. 40, not 25: a legitimate live ball with
    three runs and a throw runs to about 29 seconds, and truncating those loses
    exactly the deliveries people argue about."""

    ring_size: int = 12
    """Clips held on disk. Announced to the phone in `hello` so it mirrors this
    rather than hardcoding a number of its own."""

    ring_buffer_seconds: float = 20.0
    """Length of the tmpfs pre-roll ring. Also the reach of a recovered clip."""

    # Storage
    data_root: Path = Path("/data/matches")
    preroll_dir: Path = Path("/dev/shm/preroll")

    # Network
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    """nginx terminates :80 and proxies here. Binding to loopback means the
    FastAPI process is not directly reachable from the access point."""

    heartbeat_seconds: float = 5.0


settings = Settings()
