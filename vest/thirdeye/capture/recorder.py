"""The recorder: one ffmpeg process, writing segments, forever.

Started once when the vest boots and not stopped between deliveries. That is the
whole point of the rolling buffer - footage is never conditional on a marker
arriving, so a marker that turns up two overs late still finds its delivery.

The process is supervised rather than trusted. If it dies it is restarted, and
the fact that it died is surfaced in health, because a capture pipeline that
stops quietly is the worst failure this system has.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from pathlib import Path

from .buffer import RollingBuffer
from .source import Source

log = logging.getLogger(__name__)


class Recorder:
    """Runs the segmenter and keeps the buffer trimmed."""

    def __init__(
        self,
        source: Source,
        buffer: RollingBuffer,
        *,
        video_bitrate: str = "15M",
        encoder: str | None = None,
        ffmpeg: str = "ffmpeg",
    ) -> None:
        self.source = source
        self.buffer = buffer
        self.video_bitrate = video_bitrate
        self.encoder = encoder
        self.ffmpeg = ffmpeg

        self._process: asyncio.subprocess.Process | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._started_at: float | None = None
        self.restarts = 0
        self.last_error: str | None = None

    # ---------- lifecycle ----------

    async def start(self) -> None:
        if self._tasks:
            return
        self.buffer.directory.mkdir(parents=True, exist_ok=True)
        self._tasks = [
            asyncio.create_task(self._supervise(), name="recorder"),
            asyncio.create_task(self._janitor(), name="buffer-janitor"),
        ]
        log.info("recorder starting from %s:%s", self.source.kind, self.source.target)

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []
        await self._kill()

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def uptime(self) -> float:
        return 0.0 if self._started_at is None else time.time() - self._started_at

    # ---------- internals ----------

    def _command(self, first_index: int, start_time: float) -> list[str]:
        """ffmpeg arguments for a segmenter that names files by start time.

        `-strftime` is not used: it has one-second resolution and the buffer
        index needs milliseconds to line a cut up with a marker. Instead the
        segment number is the counter and the wall clock at launch is folded in
        by the naming below, which stays accurate because segment length is
        fixed.
        """
        codec = self.encoder or "libx264"
        args = [self.ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostdin", "-y"]
        args += self.source.input_args()
        args += self.source.output_filters()
        args += [
            "-an",  # No microphone, ever. See docs/PRIVACY.md.
            "-c:v", codec,
            "-b:v", self.video_bitrate,
            "-g", str(int(self.buffer.segment_seconds * 60)),
            "-force_key_frames", f"expr:gte(t,n_forced*{self.buffer.segment_seconds})",
            "-f", "segment",
            "-segment_time", str(self.buffer.segment_seconds),
            "-segment_start_number", str(first_index),
            "-reset_timestamps", "1",
            "-segment_format", "mp4",
            "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
            str(self.buffer.directory / f"seg_%05d_{start_time:.3f}.mp4"),
        ]
        return args

    async def _supervise(self) -> None:
        """Restart the encoder if it stops. It should never stop."""
        backoff = 1.0
        while True:
            start_time = time.time()
            index = self._next_index()
            try:
                self._process = await asyncio.create_subprocess_exec(
                    *self._command(index, start_time),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                self._started_at = start_time
                stderr = await self._process.stderr.read() if self._process.stderr else b""
                code = await self._process.wait()
                self.last_error = stderr.decode(errors="replace").strip()[-400:] or f"exit {code}"
                log.error("recorder stopped (%s), restarting", self.last_error)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a dead recorder must not kill the API
                self.last_error = str(exc)
                log.exception("recorder failed to start")

            self.restarts += 1
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 10.0)

    def _next_index(self) -> int:
        """Continue numbering across a restart, so the index stays monotonic."""
        segments = self.buffer.segments()
        return segments[-1].index + 1 if segments else 0

    async def _janitor(self) -> None:
        while True:
            try:
                removed = self.buffer.prune(time.time())
                if removed:
                    log.debug("pruned %d segment(s)", len(removed))
            except Exception:  # noqa: BLE001
                log.exception("janitor pass failed")
            await asyncio.sleep(max(1.0, self.buffer.segment_seconds))

    async def _kill(self) -> None:
        if self._process is None or self._process.returncode is not None:
            return
        self._process.terminate()
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self._process.wait(), timeout=3)
        if self._process.returncode is None:
            self._process.kill()
