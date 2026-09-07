"""The vest's own twelve-clip ring.

The phone has its own retention rules; these are the vest's, and they differ in
one way that matters: the vest will not delete a clip the phone has never
acknowledged, because at that moment it holds the only copy.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from thirdeye.storage.clip_store import ClipStore, sha256_of


@pytest.fixture
def store(tmp_path: Path) -> ClipStore:
    return ClipStore(root=tmp_path, camera_id="vest-01", ring_size=12)


def add(store: ClipStore, seq: int, *, delivered: bool = True, pinned: bool = False):
    path = store.clip_path("m", seq)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(f"clip {seq}".encode())
    clip = store.record(
        match_id="m", seq=seq, path=path,
        started_at=1000.0 + seq, ended_at=1014.0 + seq,
        closed_by="button", preroll_s=5.0,
        resolution="1920x1200", fps=60.0, codec="h264",
    )
    clip.delivered = delivered
    clip.pinned = pinned
    return clip


def test_a_clip_is_hashed_and_gets_a_sidecar(store: ClipStore) -> None:
    clip = add(store, 1)
    assert clip.meta.sha256 == hashlib.sha256(b"clip 1").hexdigest()
    assert clip.meta.duration_s == pytest.approx(14.0)
    sidecar = clip.path.with_suffix(".json")
    assert sidecar.exists() and '"sha256"' in sidecar.read_text()


def test_the_vest_does_not_pretend_to_know_the_score(store: ClipStore) -> None:
    clip = add(store, 1)
    assert clip.meta.over is None and clip.meta.ball_in_over is None


def test_clips_past_the_ring_are_deleted(store: ClipStore) -> None:
    for seq in range(1, 16):
        add(store, seq)
    removed = store.purge()
    assert removed == [1, 2, 3]
    assert store.get(1) is None and store.get(4) is not None
    assert not store.clip_path("m", 1).exists()


def test_an_unacknowledged_clip_survives_the_ring(store: ClipStore) -> None:
    # The phone never confirmed it, so this is the only copy in existence.
    # Losing a delivery to a slow download would be worse than holding a file.
    for seq in range(1, 16):
        add(store, seq, delivered=(seq != 2))
    assert store.purge() == [1, 3]
    assert store.get(2) is not None


def test_a_pinned_clip_survives_the_ring(store: ClipStore) -> None:
    for seq in range(1, 16):
        add(store, seq, pinned=(seq == 1))
    assert 1 not in store.purge()
    assert store.get(1) is not None


def test_an_acknowledgement_with_the_wrong_hash_is_refused(store: ClipStore) -> None:
    add(store, 1, delivered=False)
    assert store.mark_delivered(1, "not-the-hash") is False
    assert store.get(1).delivered is False


def test_an_acknowledgement_with_the_right_hash_is_accepted(store: ClipStore) -> None:
    clip = add(store, 1, delivered=False)
    assert store.mark_delivered(1, clip.meta.sha256) is True
    assert store.get(1).delivered is True


def test_hashing_a_file_matches_hashing_its_bytes(tmp_path: Path) -> None:
    path = tmp_path / "f.bin"
    payload = b"x" * (3 << 20)          # larger than one read block
    path.write_bytes(payload)
    assert sha256_of(path) == hashlib.sha256(payload).hexdigest()
