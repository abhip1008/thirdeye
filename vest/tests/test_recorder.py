"""The recorder is supervised rather than trusted, and this is that part.

A capture pipeline that stops quietly is the worst failure this system has, so
the tests that matter are about what happens after something has already gone
wrong.
"""

from __future__ import annotations

import asyncio

from thirdeye.capture.buffer import RollingBuffer
from thirdeye.capture.recorder import Recorder
from thirdeye.capture.source import Source


class FakeProcess:
    """Stands in for ffmpeg or rpicam-vid. Exits when told to, not before."""

    def __init__(self) -> None:
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False
        self.stdout = None
        self.stderr = _EmptyReader()
        self._exited = asyncio.Event()

    async def wait(self) -> int:
        await self._exited.wait()
        return self.returncode or 0

    def finish(self, code: int = 1) -> None:
        self.returncode = code
        self._exited.set()

    def terminate(self) -> None:
        self.terminated = True
        self.finish(code=-15)

    def kill(self) -> None:
        self.killed = True
        self.finish(code=-9)


class _EmptyReader:
    async def read(self, *_: int) -> bytes:
        return b""


def test_a_restart_does_not_leave_the_camera_held(tmp_path) -> None:
    # asyncio.run rather than a plugin: one dependency fewer, and these tests
    # each own their loop from start to finish anyway.
    asyncio.run(_restart_does_not_leave_the_camera_held(tmp_path))


async def _restart_does_not_leave_the_camera_held(tmp_path) -> None:
    """The one that would end a match.

    rpicam-vid owns the sensor exclusively. If ffmpeg dies and the supervisor
    starts a second rpicam-vid while the first is still running, that second one
    fails with the camera in use - and so does every one after it. The vest
    looks alive, answers health, and never records another ball.
    """
    spawned: list[FakeProcess] = []

    async def fake_exec(*args, **kwargs):
        process = FakeProcess()
        process.argv = args  # type: ignore[attr-defined]
        spawned.append(process)
        return process

    buffer = RollingBuffer(directory=tmp_path / "buffer", segment_seconds=1.0, horizon_seconds=10)
    recorder = Recorder(source=Source.parse("libcamera:0"), buffer=buffer)

    import thirdeye.capture.recorder as module

    original = asyncio.create_subprocess_exec
    module.asyncio.create_subprocess_exec = fake_exec  # type: ignore[assignment]
    try:
        await recorder.start()
        # First attempt: a producer and an ffmpeg.
        await _until(lambda: len(spawned) == 2)
        producer, ffmpeg = spawned[0], spawned[1]

        # ffmpeg falls over. The producer is still holding the camera.
        ffmpeg.finish(code=1)
        await _until(lambda: len(spawned) == 4, timeout=6)

        assert producer.terminated or producer.killed, (
            "the previous rpicam-vid was left holding the sensor"
        )
    finally:
        module.asyncio.create_subprocess_exec = original  # type: ignore[assignment]
        await recorder.stop()


def test_what_the_camera_said_is_what_gets_reported(tmp_path) -> None:
    asyncio.run(_what_the_camera_said_is_what_gets_reported(tmp_path))


async def _what_the_camera_said_is_what_gets_reported(tmp_path) -> None:
    """ffmpeg downstream of a dead camera complains about the stream, which
    sends you looking at the wrong process. The cause wins over the symptom."""

    class TalkativeProducer(FakeProcess):
        def __init__(self) -> None:
            super().__init__()
            self.stderr = _Says(b"ERROR: *** no cameras available ***")

    made: list[FakeProcess] = []

    async def fake_exec(*args, **kwargs):
        process = TalkativeProducer() if "rpicam-vid" in args[0] else FakeProcess()
        made.append(process)
        return process

    buffer = RollingBuffer(directory=tmp_path / "buffer", segment_seconds=1.0, horizon_seconds=10)
    recorder = Recorder(source=Source.parse("libcamera:0"), buffer=buffer)

    import thirdeye.capture.recorder as module

    original = asyncio.create_subprocess_exec
    module.asyncio.create_subprocess_exec = fake_exec  # type: ignore[assignment]
    try:
        await recorder.start()
        await _until(lambda: len(made) == 2)
        made[1].finish(code=1)  # ffmpeg gives up on an empty pipe
        await _until(lambda: (recorder.last_error or "").startswith("camera:"), timeout=6)
        assert "no cameras available" in (recorder.last_error or "")
    finally:
        module.asyncio.create_subprocess_exec = original  # type: ignore[assignment]
        await recorder.stop()


class _Says(_EmptyReader):
    """Says its piece once, then reports end of stream, like a real pipe."""

    def __init__(self, text: bytes) -> None:
        self._text: bytes | None = text

    async def read(self, *_: int) -> bytes:
        text, self._text = self._text, None
        return text or b""


async def _until(predicate, timeout: float = 3.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never became true")


class FakeCameraSource:
    """A stand-in for the Pi ribbon camera that runs on any machine.

    Same shape as a `libcamera:` Source - a producer process that writes an
    encoded H.264 stream to stdout, and an ffmpeg that copies it into segments -
    with ffmpeg generating the pictures instead of a sensor.
    """

    kind = "libcamera"
    target = "0"
    preencoded = True

    def input_args(self) -> list[str]:
        return ["-f", "h264", "-framerate", "30", "-i", "-"]

    def producer_command(self, *, segment_seconds: float = 1.0) -> list[str]:
        return [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-g", str(int(30 * segment_seconds)),
            "-f", "h264", "-",
        ]

    def output_filters(self) -> list[str]:
        return []


def test_the_camera_pipeline_actually_produces_segments(tmp_path) -> None:
    """Two real processes, one real pipe.

    The tests above fake `create_subprocess_exec`, which is why they all passed
    while the camera path could not start at all: the producer's stdout was
    handed to ffmpeg as asyncio's StreamReader, an object in this process, where
    a file descriptor was needed. Nothing that stubs the spawning can see that.
    It failed the first time a camera was attached, with "'StreamReader' object
    has no attribute 'fileno'".
    """
    asyncio.run(_the_camera_pipeline_actually_produces_segments(tmp_path))


async def _the_camera_pipeline_actually_produces_segments(tmp_path) -> None:
    buffer = RollingBuffer(directory=tmp_path / "buffer", segment_seconds=1.0, horizon_seconds=30)
    recorder = Recorder(source=FakeCameraSource(), buffer=buffer)  # type: ignore[arg-type]

    await recorder.start()
    try:
        await _until(lambda: len(list((tmp_path / "buffer").glob("seg_*.mp4"))) >= 2, timeout=25)
        assert recorder.running
        # Restarts here would mean the pipeline fell over and was rebuilt, which
        # is exactly what a broken pipe looks like from the outside.
        assert recorder.restarts == 0, recorder.last_error
    finally:
        await recorder.stop()
