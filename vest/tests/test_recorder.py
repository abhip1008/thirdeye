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
    def __init__(self, text: bytes) -> None:
        self._text = text

    async def read(self, *_: int) -> bytes:
        return self._text


async def _until(predicate, timeout: float = 3.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never became true")
