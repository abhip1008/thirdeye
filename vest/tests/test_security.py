"""Signatures are what stop a stranger on the vest's Wi-Fi taking footage.

The password is printed on a code taped to the vest, so joining the network
proves nothing about who you are. These are the checks that do.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from thirdeye.security import (
    KEY_BYTES,
    MAX_SKEW_SECONDS,
    SKEW_REASON,
    Verifier,
    load_or_create_key,
    now_stamp,
    sign,
)

KEY = "ab" * KEY_BYTES


@pytest.fixture
def verifier() -> Verifier:
    return Verifier(KEY)


def signed(now: float, nonce: str = "n1", method: str = "GET", path: str = "/clips/9.mp4"):
    stamp = now_stamp(now)
    return {
        "method": method, "path": path,
        "timestamp": stamp, "nonce": nonce,
        "signature": sign(KEY, method, path, stamp, nonce),
        "now": now,
    }


def test_a_properly_signed_request_is_accepted(verifier: Verifier) -> None:
    assert verifier.check(**signed(time.time())) is None


def test_an_unsigned_request_is_refused(verifier: Verifier) -> None:
    assert verifier.check(
        method="GET", path="/clips/9.mp4",
        timestamp=None, nonce=None, signature=None, now=time.time(),
    ) == "unsigned"


def test_a_signature_cannot_be_moved_to_another_clip(verifier: Verifier) -> None:
    """The path is inside the signature, so a capture of one download does not
    become permission to fetch every other clip on the vest."""
    now = time.time()
    request = signed(now)
    request["path"] = "/clips/8.mp4"
    assert verifier.check(**request) == "signature does not match"


def test_a_read_signature_cannot_be_used_to_write(verifier: Verifier) -> None:
    now = time.time()
    request = signed(now)
    request["method"] = "POST"
    assert verifier.check(**request) == "signature does not match"


def test_the_same_request_cannot_be_replayed(verifier: Verifier) -> None:
    now = time.time()
    request = signed(now)
    assert verifier.check(**request) is None
    assert verifier.check(**request) == "nonce already used"


def test_an_old_request_is_refused(verifier: Verifier) -> None:
    now = time.time()
    request = signed(now - MAX_SKEW_SECONDS - 60)
    request["now"] = now
    assert verifier.check(**request) == SKEW_REASON


def test_a_request_from_the_future_is_refused_too(verifier: Verifier) -> None:
    """A clock ahead is as suspicious as one behind, and allowing it would let a
    captured request be held and used later."""
    now = time.time()
    request = signed(now + MAX_SKEW_SECONDS + 60)
    request["now"] = now
    assert verifier.check(**request) == SKEW_REASON


def test_the_wrong_key_does_not_work(verifier: Verifier) -> None:
    now = time.time()
    request = signed(now)
    request["signature"] = sign("cd" * KEY_BYTES, "GET", "/clips/9.mp4", now_stamp(now), "n1")
    assert verifier.check(**request) == "signature does not match"


def test_nonce_memory_is_bounded(verifier: Verifier) -> None:
    """A flood of requests must not be able to exhaust memory."""
    now = time.time()
    for i in range(5000):
        verifier.check(**signed(now, nonce=f"n{i}"))
    assert len(verifier._seen) <= 4096


def test_turning_it_off_accepts_anything() -> None:
    """There is an off switch for development, and it does what it says."""
    off = Verifier(KEY, required=False)
    assert off.check(
        method="GET", path="/clips/9.mp4",
        timestamp=None, nonce=None, signature=None, now=time.time(),
    ) is None


def test_a_key_is_minted_once_and_kept(tmp_path: Path) -> None:
    path = tmp_path / "signing.key"
    first = load_or_create_key(path)
    assert len(first) == KEY_BYTES * 2
    assert load_or_create_key(path) == first, "a restart must not change the pairing code"


def test_the_key_is_not_readable_by_other_users(tmp_path: Path) -> None:
    path = tmp_path / "signing.key"
    load_or_create_key(path)
    assert oct(path.stat().st_mode)[-3:] == "600"


def test_a_fractional_second_cannot_change_the_answer() -> None:
    """The bug this replaced: the sender truncated the timestamp and the
    verifier rounded it, so a request signed at x.6 seconds failed and the same
    request at x.4 passed. Intermittent, and invisible in any single test."""
    verifier = Verifier(KEY)
    for fraction in (0.0, 0.1, 0.49, 0.5, 0.51, 0.9, 0.999):
        now = 1_800_000_000 + fraction
        assert verifier.check(**signed(now, nonce=f"n{fraction}")) is None, fraction


def test_the_shared_vectors_still_produce_these_signatures() -> None:
    """The phone computes HMAC itself, out of the platform's SHA-256, because
    the crypto library it has hashes but does not do HMAC. Both sides check
    against this one file, so an implementation that drifts fails here rather
    than in a car park with a vest that will not talk to a phone."""
    vectors = json.loads(
        (Path(__file__).resolve().parents[2] / "protocol/fixtures/signing-vectors.json").read_text()
    )
    assert vectors, "the vector file is empty"
    for case in vectors:
        assert sign(
            case["key"], case["method"], case["path"], case["timestamp"], case["nonce"]
        ) == case["expected"], case["path"]


def test_a_corrupt_key_file_is_replaced(tmp_path: Path) -> None:
    path = tmp_path / "signing.key"
    path.write_text("not a key")
    assert len(load_or_create_key(path)) == KEY_BYTES * 2
