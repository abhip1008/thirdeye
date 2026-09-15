"""What the camera is asked for.

These are cheap tests of command construction, which is exactly the code that
cannot be checked any other way until there is a camera on a bench. Every one of
them encodes something that was wrong once or would be silent if it were.
"""

from __future__ import annotations

import pytest

from thirdeye.capture.source import Source


def test_a_pi_camera_is_asked_for_a_mode_that_is_configured() -> None:
    """The old default was 1920x1200 at 60, which the prototype's sensor does
    not have. A camera asked for a mode it lacks either refuses to start or
    quietly gives something else, and the second is worse."""
    source = Source.parse("libcamera:0", width=1920, height=1080, framerate=30)
    command = source.producer_command()
    assert command is not None
    assert command[command.index("--width") + 1] == "1920"
    assert command[command.index("--height") + 1] == "1080"
    assert command[command.index("--framerate") + 1] == "30"
    assert command[command.index("--camera") + 1] == "0"


def test_one_keyframe_per_segment() -> None:
    """The segmenter cuts on keyframes and, in this path, cannot make one - it
    copies what the camera produces. Left at the default, every "one second"
    segment is really two, and the error at both ends of a clip doubles."""
    source = Source.parse("libcamera:0", framerate=30)
    assert source.producer_command(segment_seconds=1.0)[-5:-3] == ["--intra", "30"]
    assert source.producer_command(segment_seconds=0.5)[-5:-3] == ["--intra", "15"]


def test_a_pi_camera_never_asks_for_zero_keyframes() -> None:
    source = Source.parse("libcamera:0", framerate=30)
    command = source.producer_command(segment_seconds=0.001)
    assert command[command.index("--intra") + 1] == "1"


def test_frames_from_a_pi_camera_are_already_encoded() -> None:
    # This is what makes the recorder copy rather than re-encode. Re-encoding
    # here would spend the CPU twice on a board that has none to spare.
    assert Source.parse("libcamera:0").preencoded is True
    assert Source.parse("camera:/dev/video0").preencoded is False


def test_a_usb_camera_goes_through_v4l2() -> None:
    args = Source.parse("camera:/dev/video0", width=1280, height=720, framerate=30).input_args()
    assert args[:2] == ["-f", "v4l2"]
    assert args[args.index("-video_size") + 1] == "1280x720"
    assert args[-1] == "/dev/video0"


def test_only_a_pi_camera_needs_a_producer() -> None:
    assert Source.parse("camera:/dev/video0").producer_command() is None
    assert Source.parse("pattern:testsrc=size=320x240:rate=5").producer_command() is None


def test_a_file_is_paced_and_looped(tmp_path) -> None:
    path = tmp_path / "over.mp4"
    path.write_bytes(b"not really a video")
    args = Source.parse(f"file:{path}").input_args()
    # Without -re ffmpeg reads the file as fast as the disk allows and the
    # buffer holds hours within seconds.
    assert "-re" in args and "-stream_loop" in args


def test_a_missing_file_is_refused_at_startup(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        Source.parse(f"file:{tmp_path / 'nope.mp4'}")


def test_an_unknown_source_is_refused(tmp_path) -> None:
    with pytest.raises(ValueError):
        Source.parse("rtsp://camera/stream")
    with pytest.raises(ValueError):
        Source.parse("libcamera")


def test_geometry_falls_back_to_the_defaults() -> None:
    plain = Source.parse("libcamera:0")
    assert (plain.width, plain.height, plain.framerate) == (1920, 1080, 30)


def test_the_output_format_is_named_because_stdout_has_no_extension() -> None:
    """Where there is no hardware H.264 encoder - a Pi 5 - rpicam-vid goes
    through libav, which infers its container from the file extension. Writing
    to stdout there is none, and it refuses to guess: "Unable to choose an
    output format for '-'". Found on a Pi, at the first start with a camera."""
    command = Source.parse("libcamera:0").producer_command()
    assert command[command.index("--libav-format") + 1] == "h264"
    # And it has to be the raw elementary stream, because that is what the
    # ffmpeg reading the other end of the pipe is told to expect.
    assert Source.parse("libcamera:0").input_args()[:2] == ["-f", "h264"]


def test_extra_camera_arguments_are_passed_through() -> None:
    # The escape hatch: options differ between boards and between versions of
    # rpicam-apps, and the useful ones are found with a camera in front of you.
    source = Source.parse("libcamera:0", extra_args="--shutter 4000 --gain 2")
    assert source.producer_command()[-4:] == ["--shutter", "4000", "--gain", "2"]


def test_no_extra_arguments_means_no_extra_arguments() -> None:
    assert Source.parse("libcamera:0").producer_command()[-1] == "-"


def test_the_camera_is_asked_for_a_stream_that_can_be_cut() -> None:
    """B-frames are why the first Pi bring-up recorded one endless file.

    Reordered frames, read as raw H.264 from a pipe with no container
    timestamps, leave ffmpeg without a clock - and the segment muxer needs a
    clock as well as a keyframe before it will cut. Measured: 1 segment in eight
    seconds without this flag, 8 with it.
    """
    command = Source.parse("libcamera:0").producer_command()
    assert command[command.index("--low-latency") + 1] == "1"
