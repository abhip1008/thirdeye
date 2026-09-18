#!/usr/bin/env python
"""Be the phone, without the phone.

Run this ON the vest, against the service that is already running:

    sudo -u thirdeye /opt/thirdeye/vest/.venv/bin/python scripts/check_clip.py

It does exactly what the app does - signs its requests with the pairing key,
starts a match, sends a start marker, waits, sends an end marker, listens for the
clip announcement, downloads the file, checks its length and its SHA-256 against
what was announced, and probes that the result is real video.

The point is to separate two questions that are otherwise asked at the same
time. When a first clip fails to appear on a phone, it is not obvious whether
the vest could not cut it or the app could not fetch it, and debugging both at
once in a car park is how an afternoon goes. Everything here is the vest's side.

It is safe to run against a live vest: it starts a match, which is what a phone
does, and leaves one clip behind.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdeye.security import sign  # noqa: E402

try:
    from websockets.asyncio.client import connect
except ImportError:  # older websockets
    from websockets.client import connect  # type: ignore[no-redef]

FAIL = 0


def check(label: str, ok: bool, detail: str = "") -> bool:
    global FAIL
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAIL += 1
    return ok


def signed(key: str, method: str, path: str, now: float) -> dict[str, str]:
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    return {
        "X-TE-Timestamp": timestamp,
        "X-TE-Nonce": nonce,
        "X-TE-Signature": sign(key, method, path, timestamp, nonce),
    }


def http(
    host: str, key: str, path: str, now: float, *, method: str = "GET",
    body: bytes | None = None, extra: dict[str, str] | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    request = urllib.request.Request(
        f"http://{host}{path}", data=body, method=method,
        headers={**signed(key, method, path, now), **(extra or {})},
    )
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def vest_clock(host: str) -> float:
    """The vest's own clock, from the one route that is not signed.

    Markers are stamped in vest time, and a vest has no real-time clock - so
    this is not a formality. Sign with this phone's idea of the time against a
    vest that booted believing it was last Tuesday and every request is refused.
    """
    with urllib.request.urlopen(f"http://{host}/api/health", timeout=10) as response:
        return float(json.load(response)["vest_time"])


async def run(host: str, key: str, hold: float) -> int:
    offset = vest_clock(host) - time.time()
    now = lambda: time.time() + offset  # noqa: E731 - vest time, everywhere below

    print(f"\ntalking to {host}, vest clock {offset:+.1f}s from this one\n")

    status, body, _ = http(host, key, "/api/health", now())
    health = json.loads(body)
    check("the vest is recording", health.get("recording") is True)
    check("the buffer has depth", health.get("buffer_held_s", 0) > 5,
          f"{health.get('buffer_held_s')}s")
    if not health.get("recording"):
        print("\n  nothing below can work while the camera is down.\n")
        return 1

    status, body, _ = http(host, key, "/api/session/start", now(),
                           method="POST", body=json.dumps({"venue": "check"}).encode())
    check("a match starts", status == 200, body.decode()[:120])
    if status != 200:
        return 1

    query = signed(key, "GET", "/ws", now())
    url = (f"ws://{host}/ws?ts={query['X-TE-Timestamp']}"
           f"&nonce={query['X-TE-Nonce']}&sig={query['X-TE-Signature']}")

    async with connect(url, max_size=None) as ws:
        hello = json.loads(await ws.recv())
        check("the control channel opens and says hello", hello.get("type") == "hello",
              f"camera {hello.get('camera_id')}, protocol {hello.get('protocol')}")

        seq = (hello.get("seq_latest") or 0) + 1

        # A delivery, marked the way the app marks one: both edges in vest time,
        # the end at the moment of the tap rather than safely in the past.
        await ws.send(json.dumps({"v": 1, "type": "mark", "seq": seq, "edge": "start",
                                  "at": now()}))
        print(f"  ... marked the start of delivery {seq}, holding {hold:.0f}s")
        await asyncio.sleep(hold)
        await ws.send(json.dumps({"v": 1, "type": "mark", "seq": seq, "edge": "end",
                                  "at": now()}))

        clip = None
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                message = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            except TimeoutError:
                continue
            if message.get("type") == "clip_ready" and message.get("seq") == seq:
                clip = message
                break
            if message.get("type") == "marker_refused" and message.get("seq") == seq:
                check("a clip is cut from the camera's own footage", False,
                      f"refused: {message.get('reason')} {message.get('detail', '')}")
                return 1

        if not check("a clip is cut from the camera's own footage", clip is not None):
            return 1

        print(f"\n  clip {clip['seq']}: {clip['duration_s']}s, {clip['bytes'] / 1e6:.1f} MB, "
              f"closed_by {clip['closed_by']}, "
              f"{clip['bytes'] * 8 / max(clip['duration_s'], 0.1) / 1e6:.1f} Mbps")

        # clip_ready carries only what is needed to fetch and verify. The
        # picture's shape lives in the clip metadata, which the phone reads
        # separately - and steps frames with, so it had better be right.
        status, listing, _ = http(host, key, "/api/clips", now())
        check("the clip list is served", status == 200, f"HTTP {status}")
        meta = next((c for c in json.loads(listing) if c["seq"] == clip["seq"]), None)
        check("the new clip is in it", meta is not None)
        if meta:
            print(f"  metadata: {meta.get('resolution')}, {meta.get('fps')} fps, "
                  f"{meta.get('codec')}\n")

        path = f"/clips/{clip['seq']}.mp4"
        status, data, _ = http(host, key, path, now())
        check("it downloads", status == 200, f"HTTP {status}")
        check("the length matches what was announced", len(data) == clip["bytes"],
              f"{len(data)} vs {clip['bytes']}")
        check("the hash matches what was announced",
              hashlib.sha256(data).hexdigest() == clip["sha256"])

        half = clip["bytes"] // 2
        s1, head, _ = http(host, key, path, now(), extra={"Range": f"bytes=0-{half - 1}"})
        s2, tail, _ = http(host, key, path, now(), extra={"Range": f"bytes={half}-"})
        check("a resumed download answers 206", s1 == 206 and s2 == 206, f"{s1}/{s2}")
        check("and reassembles byte for byte",
              hashlib.sha256(head + tail).hexdigest() == clip["sha256"])

        out = Path("/tmp/thirdeye-check.mp4")
        out.write_bytes(data)
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v",
             "-show_entries", "stream=codec_name,width,height,nb_read_packets,avg_frame_rate",
             "-show_entries", "format=duration", "-of", "json", str(out)],
            capture_output=True, text=True,
        )
        frames, seconds, stream = 0, 0.0, {"width": 0, "height": 0}
        if probe.returncode == 0:
            info = json.loads(probe.stdout)
            stream = info["streams"][0]
            frames = int(stream.get("nb_read_packets", 0))
            seconds = float(info["format"]["duration"])
            print(f"\n  probe: {stream['codec_name']} {stream['width']}x{stream['height']}, "
                  f"{frames} frames over {seconds:.1f}s "
                  f"({frames / max(seconds, 0.1):.1f} fps measured)")
        check("the downloaded file is playable video", probe.returncode == 0 and frames > 10,
              probe.stderr.strip()[:150])

        # The number the review screen steps frames with, against the number the
        # file actually has. A clip that plays but whose rate is wrong looks
        # fine and steps wrong, which is worse than a clip that does not open.
        if meta and frames:
            measured = frames / max(seconds, 0.1)
            claimed = float(meta.get("fps") or 0)
            check("the frame rate the phone will step with matches the file",
                  claimed > 0 and abs(claimed - measured) < 2.0,
                  f"metadata says {claimed:.1f}, file measures {measured:.1f}")
            check("the resolution matches the file",
                  meta.get("resolution") == f"{stream['width']}x{stream['height']}",
                  f"metadata says {meta.get('resolution')}, "
                  f"file is {stream['width']}x{stream['height']}")
        # Frame-stepping is the whole review screen, and it needs frames rather
        # than a file that merely opens.
        check("it has enough frames to step through", frames >= hold * 10, f"{frames} frames")

        await ws.send(json.dumps({"v": 1, "type": "ack", "seq": clip["seq"],
                                  "sha256": clip["sha256"]}))
        await asyncio.sleep(0.5)
        print(f"\n  kept at {out}")

    return 1 if FAIL else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1:8000")
    parser.add_argument("--key", help="signing key; read from --key-path if omitted")
    parser.add_argument("--key-path", default="/data/signing.key", type=Path)
    parser.add_argument("--hold", type=float, default=8.0,
                        help="seconds between the two markers")
    args = parser.parse_args()

    key = args.key
    if not key:
        try:
            key = args.key_path.read_text().strip()
        except OSError as exc:
            print(f"cannot read the signing key at {args.key_path}: {exc}")
            print("run this as the thirdeye user, or pass --key")
            return 2

    code = asyncio.run(run(args.host, key, args.hold))
    print(f"\n{'ALL CHECKS PASSED' if code == 0 else f'{FAIL} CHECK(S) FAILED'}\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
