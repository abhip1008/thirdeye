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
import os
import time
from pathlib import Path

from .buffer import RollingBuffer
from .source import Source

log = logging.getLogger(__name__)

STALL_SECONDS = 10.0
"""How long the buffer may stop advancing before the recorder is restarted.

Segments are a second long, so ten seconds of nothing is not a slow disk, it is
a pipeline that has stopped. Observed on a Pi: rpicam-vid encoding at a third of
a core, ffmpeg alive and holding its output file, and not one byte written for
twelve minutes - with health reporting `recording: true` the whole time, because
the only question it asked was whether the process existed."""


class Recorder:
    """Runs the segmenter and keeps the buffer trimmed."""

    def __init__(
        self,
        source: Source,
        buffer: RollingBuffer,
        *,
        video_bitrate: str = "5M",
        encoder: str | None = None,
        ffmpeg: str = "ffmpeg",
        stall_seconds: float = STALL_SECONDS,
    ) -> None:
        self.source = source
        self.buffer = buffer
        self.video_bitrate = video_bitrate
        self.encoder = encoder
        self.ffmpeg = ffmpeg
        self.stall_seconds = stall_seconds

        self._process: asyncio.subprocess.Process | None = None
        self._producer: asyncio.subprocess.Process | None = None
        self._producer_tail = ""
        self._drain: asyncio.Task[None] | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._started_at: float | None = None
        self.restarts = 0
        self.last_error: str | None = None
        self._stalled = False

    # ---------- lifecycle ----------

    async def start(self) -> None:
        if self._tasks:
            return
        self.buffer.directory.mkdir(parents=True, exist_ok=True)
        self._tasks = [
            asyncio.create_task(self._supervise(), name="recorder"),
            asyncio.create_task(self._janitor(), name="buffer-janitor"),
            asyncio.create_task(self._watchdog(), name="recorder-watchdog"),
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
        """Recording, meaning footage is arriving - not merely a live process.

        These came apart on the first vest to run outdoors. Both processes were
        alive and one of them was busy; nothing had been written for twelve
        minutes. A process that exists is not a camera that records, and health
        answered the easy question rather than the true one.
        """
        if self._process is None or self._process.returncode is not None:
            return False
        return self.stalled_for(time.time()) <= self.stall_seconds

    def stalled_for(self, now: float) -> float:
        """Seconds since the buffer last grew. Zero while it is keeping up."""
        if self._started_at is None:
            return 0.0
        newest = max(
            (s.ended_at for s in self.buffer.segments(include_in_flight=True)),
            default=0.0,
        )
        # Before the first segment lands there is nothing to compare against, so
        # the clock runs from when the recorder started instead. Otherwise every
        # start looks like a stall for the first second.
        return max(0.0, now - max(newest, self._started_at))

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
        args = [self.ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostdin", "-y"]
        args += self.source.input_args()

        if self.source.preencoded:
            # The frames are already H.264 - rpicam-vid compressed them on the
            # way in. Re-encoding would spend the CPU twice and lose quality for
            # nothing, so the segmenter copies the stream through. Keyframe
            # spacing is the producer's job in this path, which is why
            # rpicam-vid is asked for inline headers.
            args += ["-an", "-c:v", "copy"]
        else:
            args += self.source.output_filters()
            args += [
                "-an",  # No microphone, ever. See docs/PRIVACY.md.
                "-c:v", self.encoder or "libx264",
                "-b:v", self.video_bitrate,
                "-g", str(int(self.buffer.segment_seconds * 60)),
                "-force_key_frames", f"expr:gte(t,n_forced*{self.buffer.segment_seconds})",
            ]
        args += [
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
            stall_reason = None
            try:
                # Anything still alive from the previous attempt goes first. On
                # the Pi path this is the difference between a restart that
                # works and a vest that never records again: rpicam-vid owns the
                # sensor exclusively, so a leftover one makes every subsequent
                # start fail with the camera in use - and the supervisor would
                # sit there restarting into that forever.
                await self._kill()

                producer = self.source.producer_command(
                    segment_seconds=self.buffer.segment_seconds
                )
                if producer is None:
                    self._process = await asyncio.create_subprocess_exec(
                        *self._command(index, start_time),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                else:
                    # rpicam-vid owns the sensor and writes an encoded stream;
                    # ffmpeg reads it from the pipe and only cuts it into
                    # segments. Two processes, one of which we also have to
                    # clean up - see _kill.
                    #
                    # A real OS pipe, not asyncio's. `stdout=PIPE` hands back a
                    # StreamReader, which is an object in this process, and the
                    # child needs a file descriptor - passing the reader across
                    # fails with "'StreamReader' object has no attribute
                    # 'fileno'" the moment a camera is actually attached. The
                    # two ends are closed here as soon as the children have
                    # them, or the reader never sees EOF when the camera stops
                    # and ffmpeg waits forever for a frame that is not coming.
                    read_fd, write_fd = os.pipe()
                    try:
                        self._producer = await asyncio.create_subprocess_exec(
                            *producer,
                            stdout=write_fd,
                            # Kept, not discarded. When the camera is the thing
                            # that is wrong - a mode the sensor does not have, a
                            # ribbon half seated, another process holding it -
                            # this is the only place that says so. ffmpeg
                            # downstream sees an empty pipe and reports
                            # something about an invalid stream, which sends you
                            # looking in the wrong place.
                            stderr=asyncio.subprocess.PIPE,
                        )
                    finally:
                        os.close(write_fd)

                    self._producer_tail = ""
                    self._drain = asyncio.create_task(self._drain_producer())

                    try:
                        self._process = await asyncio.create_subprocess_exec(
                            *self._command(index, start_time),
                            stdin=read_fd,
                            stdout=asyncio.subprocess.DEVNULL,
                            stderr=asyncio.subprocess.PIPE,
                        )
                    finally:
                        os.close(read_fd)

                self._started_at = start_time

                # Held locally from here down. The watchdog kills through
                # `_kill`, which sets `self._process` to None, and reaching
                # through the attribute afterwards raises inside the supervisor
                # - which restarts anyway, but records "'NoneType' object has no
                # attribute 'wait'" as the reason the camera stopped.
                process = self._process
                stderr = await process.stderr.read() if process.stderr else b""
                stall_reason = self.last_error if self._stalled else None
                code = await process.wait()
                self.last_error = stderr.decode(errors="replace").strip()[-400:] or f"exit {code}"

                # If the camera died first, ffmpeg's complaint is a symptom and
                # the producer's is the cause. Report the cause.
                camera_error = self._producer_error()
                if camera_error:
                    self.last_error = f"camera: {camera_error}"
                if self._stalled:
                    # The watchdog killed it, so what ffmpeg said on its way out
                    # is what a process says when it is killed - the consequence,
                    # not the cause. Keep the reason it was killed instead.
                    #
                    # But keep the camera's own words alongside it, because a
                    # recorder that stalls while producing nothing is usually a
                    # camera that will not start, and that is the sentence
                    # somebody actually needs. Reporting only "the buffer
                    # stopped advancing" answers "what happened" while hiding
                    # "why", which is the same mistake in the other direction.
                    self.last_error = "; ".join(
                        part for part in (stall_reason, f"camera: {camera_error}"
                                          if camera_error else None) if part
                    )
                    self._stalled = False
                log.error("recorder stopped (%s), restarting", self.last_error)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a dead recorder must not kill the API
                self.last_error = str(exc)
                log.exception("recorder failed to start")

            self.restarts += 1

            # A run that actually recorded for a while and then fell over is an
            # accident; come back immediately. A run that produced nothing is a
            # camera that will not start, and retrying every few seconds makes
            # that worse rather than better - each attempt asks libcamera for
            # buffers the failed one may not have given back, which is how
            # "Failed to queue buffer for CFE Image" turns into a loop that
            # cannot recover from itself. Back off properly instead.
            recorded_for = time.time() - start_time
            backoff = 1.0 if recorded_for > self.stall_seconds * 2 else min(backoff * 2, 30.0)
            await asyncio.sleep(backoff)

    async def _drain_producer(self) -> None:
        """Keep reading the camera's stderr, and keep the tail of it.

        Draining rather than reading once at the end, because a pipe nobody
        empties fills up and then the process writing to it blocks. That would
        be a camera that stops producing frames after some hours of chatter,
        with nothing in any log to say why - the exact class of silent stop this
        recorder exists to avoid.
        """
        producer = self._producer
        if producer is None or producer.stderr is None:
            return
        tail = b""
        while True:
            chunk = await producer.stderr.read(4096)
            if not chunk:
                return
            tail = (tail + chunk)[-2000:]
            self._producer_tail = tail.decode(errors="replace").strip()

    def _producer_error(self) -> str | None:
        """The last thing the camera said. Only interesting once it has died."""
        return self._producer_tail[-300:] or None

    def _next_index(self) -> int:
        """Continue numbering across a restart, so the index stays monotonic."""
        segments = self.buffer.segments()
        return segments[-1].index + 1 if segments else 0

    async def _watchdog(self) -> None:
        """Restart a recorder that has stopped recording without stopping.

        The supervisor below watches for the process dying, which is the failure
        that announces itself. This watches for the one that does not: both
        processes alive, the pipe stalled, and nothing reaching the disk. Killing
        it is what makes the supervisor rebuild the whole pipeline, camera
        included.
        """
        while True:
            await asyncio.sleep(max(1.0, self.buffer.segment_seconds))
            try:
                if self._process is None or self._process.returncode is not None:
                    continue
                stalled = self.stalled_for(time.time())
                if stalled <= self.stall_seconds:
                    continue
                self.last_error = f"the buffer stopped advancing {stalled:.0f}s ago"
                self._stalled = True
                log.error("recorder stalled: %s; restarting it", self.last_error)
                await self._kill()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - the watchdog must outlive its own bugs
                log.exception("watchdog pass failed")

    async def _janitor(self) -> None:
        while True:
            try:
                held = len(self.buffer.segments(include_in_flight=True))
                removed = self.buffer.prune(time.time())
                if removed:
                    log.debug("pruned %d segment(s)", len(removed))
                # A pass that takes nearly everything is not ordinary trimming.
                # The clock moving is what does this: a vest has no real-time
                # clock, so it boots believing it is yesterday and NTP corrects
                # it later - and every segment written before that correction is
                # instantly older than the horizon. The buffer is gone either
                # way; saying so is the difference between a known event and a
                # mystery refusal ten minutes afterwards.
                if len(removed) > 10 and len(removed) >= held * 0.9:
                    log.warning(
                        "the janitor removed %d of %d segments in one pass - "
                        "the buffer is now effectively empty. If the clock just "
                        "changed, that is why.", len(removed), held,
                    )
            except Exception:  # noqa: BLE001
                log.exception("janitor pass failed")
            await asyncio.sleep(max(1.0, self.buffer.segment_seconds))

    async def _kill(self) -> None:
        if self._drain is not None:
            self._drain.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._drain
            self._drain = None
        for process in (self._process, self._producer):
            if process is None or process.returncode is not None:
                continue
            process.terminate()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=3)
            if process.returncode is None:
                process.kill()
                # kill() only sends the signal. Without waiting, the next start
                # can still race a process that has not finished letting go of
                # the sensor.
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(process.wait(), timeout=3)
        self._process = None
        self._producer = None
