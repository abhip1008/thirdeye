#!/usr/bin/env python
"""Copy clips off a vest onto this computer.

    ./.venv/bin/python scripts/pull_clips.py --host 192.168.4.82:8000 \
        --key <the psk> --out ~/Downloads/over1

The app is how an umpire watches a clip. This is for the other times: judging
framing and motion blur on a big screen, keeping a session to compare two camera
settings, or getting footage to somebody who is not holding the phone.

It is the same signed, hash-verified path the app uses - a clip that arrives here
is byte-identical to the one the vest cut, and a clip that is not is reported
rather than written.

The key comes from `python -m thirdeye.pairing` on the vest. Pass it with --key,
or point --key-path at the file if you are running this on the vest itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdeye.security import sign  # noqa: E402


def request(host: str, key: str, path: str) -> bytes:
    timestamp = str(int(vest_time(host)))
    nonce = secrets.token_hex(8)
    req = urllib.request.Request(
        f"http://{host}{path}",
        headers={
            "X-TE-Timestamp": timestamp,
            "X-TE-Nonce": nonce,
            "X-TE-Signature": sign(key, "GET", path, timestamp, nonce),
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


_clock: dict[str, float] = {}


def vest_time(host: str) -> float:
    """The vest's clock, which is what its signatures are checked against.

    A vest has no real-time clock, so its idea of the time can be days from this
    computer's. Signing with the wrong one gets every request refused for skew.
    Read once and reused, because it does not move relative to us.
    """
    if host not in _clock:
        with urllib.request.urlopen(f"http://{host}/api/health", timeout=15) as response:
            body = json.load(response)
        _clock[host] = float(body.get("vest_time", 0)) or 0.0
        if not _clock[host]:
            import time
            _clock[host] = time.time()
    return _clock[host]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="192.168.43.1:8000", help="vest address, with port")
    parser.add_argument("--key", help="signing key; from `python -m thirdeye.pairing`")
    parser.add_argument("--key-path", type=Path, help="read the key from a file instead")
    parser.add_argument("--out", type=Path, default=Path("clips"), help="where to write")
    parser.add_argument("--seq", type=int, action="append",
                        help="only this delivery; repeatable. Default is everything held.")
    args = parser.parse_args()

    key = args.key
    if not key and args.key_path:
        try:
            key = args.key_path.read_text().strip()
        except OSError as exc:
            # On the vest the key is owner-only, so this is usually "run it as
            # the thirdeye user". Anywhere else it is the wrong path.
            print(f"cannot read the key at {args.key_path}: {exc}")
            return 2
    if not key:
        print("need --key or --key-path; get it with `python -m thirdeye.pairing` on the vest")
        return 2

    try:
        listing = json.loads(request(args.host, key, "/api/clips"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:200]
        print(f"the vest refused the request: {exc.code} {detail}")
        print("a 401 usually means the key is wrong; re-read it from the vest")
        return 1
    except OSError as exc:
        print(f"could not reach {args.host}: {exc}")
        return 1

    wanted = set(args.seq or [])
    clips = [c for c in listing if not wanted or c["seq"] in wanted]
    if not clips:
        print("the vest is holding no clips" if not listing else "no clip matched --seq")
        return 0

    args.out.mkdir(parents=True, exist_ok=True)
    failures = 0

    for clip in sorted(clips, key=lambda c: c["seq"]):
        seq = clip["seq"]
        destination = args.out / f"{clip['camera_id']}_{seq:04d}.mp4"
        print(f"  {seq:>3}  {clip['duration_s']:>5.1f}s  {clip['bytes'] / 1e6:>5.1f} MB  "
              f"{clip.get('resolution') or '?'}  {clip.get('fps') or '?'} fps  ", end="", flush=True)
        try:
            data = request(args.host, key, f"/clips/{seq}.mp4")
        except OSError as exc:
            print(f"failed: {exc}")
            failures += 1
            continue

        # The same check the phone makes. A clip that does not match its hash is
        # not written at all: a file on disk that nobody can account for is worse
        # than a download that plainly failed.
        if hashlib.sha256(data).hexdigest() != clip["sha256"]:
            print("FAILED its hash - not written")
            failures += 1
            continue

        destination.write_bytes(data)
        print(f"-> {destination.name}")

    print(f"\n{len(clips) - failures} of {len(clips)} written to {args.out}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
