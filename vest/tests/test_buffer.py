"""The rolling buffer decides whether a delivery still exists.

Every one of these is a question the vest has to answer honestly when a marker
arrives late: is the footage still here, which parts of it, and what should be
deleted. Getting them wrong produces clips that are silently short, which is
worse than no clip because it looks fine.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from thirdeye.capture.buffer import RollingBuffer, segment_name

BASE = 1_000_000.0


@pytest.fixture
def buffer(tmp_path: Path) -> RollingBuffer:
    return RollingBuffer(tmp_path, segment_seconds=1.0, horizon_seconds=10.0)


def write(buf: RollingBuffer, indices, run: float = BASE) -> None:
    for i in indices:
        (buf.directory / segment_name(i, run)).write_bytes(b"x")


def test_a_segments_start_is_derived_from_its_place_in_the_run(buffer: RollingBuffer) -> None:
    write(buffer, range(5))
    # The filename carries the run's start, not the segment's; ffmpeg cannot
    # stamp each file with a millisecond clock, so position does the work.
    assert [s.started_at - BASE for s in buffer.segments(include_in_flight=True)] == [0, 1, 2, 3, 4]


def test_the_newest_segment_is_held_back_because_it_is_still_being_written(buffer) -> None:
    write(buffer, range(5))
    assert len(buffer.segments()) == 4
    assert len(buffer.segments(include_in_flight=True)) == 5


def test_a_restart_starts_a_new_run_without_corrupting_the_old_one(buffer) -> None:
    write(buffer, range(3), run=BASE)
    write(buffer, range(10, 13), run=BASE + 60)
    starts = [s.started_at for s in buffer.segments(include_in_flight=True)]
    # Indices continue across a restart but times restart from the new run,
    # so the second batch must not be placed sixty seconds further out again.
    assert starts == [BASE, BASE + 1, BASE + 2, BASE + 60, BASE + 61, BASE + 62]


def test_the_window_includes_segments_that_merely_overlap(buffer) -> None:
    write(buffer, range(6))
    # A segment clipped by the window is still needed: dropping it would cut
    # off the very moment being asked for.
    assert [s.index for s in buffer.window(BASE + 1.5, BASE + 3.5)] == [1, 2, 3]


def test_an_empty_window_yields_nothing(buffer) -> None:
    write(buffer, range(6))
    assert buffer.window(BASE + 2, BASE + 2) == []


def test_coverage_needs_both_ends(buffer) -> None:
    write(buffer, range(6))          # complete: 0-4, in-flight: 5
    assert buffer.covers(BASE + 1, BASE + 4) is True
    assert buffer.covers(BASE - 5, BASE + 3) is False   # starts before the buffer
    assert buffer.covers(BASE + 1, BASE + 30) is False  # ends after it


def test_nothing_is_covered_by_an_empty_buffer(buffer) -> None:
    assert buffer.covers(BASE, BASE + 1) is False
    assert buffer.held_seconds(BASE + 5) == 0.0


def test_held_seconds_measures_how_far_back_a_marker_can_reach(buffer) -> None:
    write(buffer, range(8))
    assert buffer.held_seconds(BASE + 8) == pytest.approx(8.0)


def test_the_janitor_drops_what_is_past_the_horizon(buffer) -> None:
    write(buffer, range(20))
    removed = buffer.prune(BASE + 20)          # horizon is 10s
    assert len(removed) > 0
    remaining = [s.index for s in buffer.segments(include_in_flight=True)]
    assert min(remaining) >= 9
    assert 19 in remaining


def test_the_janitor_never_deletes_the_segment_being_written(buffer) -> None:
    write(buffer, range(20))
    buffer.prune(BASE + 1_000)  # horizon long past for every segment
    assert [s.index for s in buffer.segments(include_in_flight=True)] == [19]


def test_files_that_are_not_segments_are_ignored(buffer) -> None:
    write(buffer, range(3))
    (buffer.directory / "notes.txt").write_text("hello")
    (buffer.directory / "seg_bad.mp4").write_bytes(b"x")
    assert len(buffer.segments(include_in_flight=True)) == 3
