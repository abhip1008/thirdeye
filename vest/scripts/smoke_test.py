#!/usr/bin/env python
"""End-to-end check of the vest, with a file standing in for the camera.

Boots the real service, lets the buffer fill, starts a match, sends the markers
a phone would send, and then does what the phone does with the answer: fetch the
clip over HTTP with a Range request and verify the hash.

Everything here is the production path except the source of the pictures. Run it
from vest/:

    ./.venv/bin/python scripts/smoke_test.py
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

WORK = Path(tempfile.mkdtemp(prefix="thirdeye-smoke-"))
SAMPLE = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "mock" / "sample.mp4"

os.environ.setdefault("THIRDEYE_SOURCE", f"file:{SAMPLE}")
os.environ["THIRDEYE_BUFFER_DIR"] = str(WORK / "buffer")
os.environ["THIRDEYE_DATA_ROOT"] = str(WORK / "matches")
os.environ["THIRDEYE_BUFFER_SECONDS"] = "60"
os.environ["THIRDEYE_PREROLL_SECONDS"] = "2"
os.environ["THIRDEYE_SEGMENT_SECONDS"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from thirdeye.main import app, buffer, recorder  # noqa: E402

FAIL = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global FAIL
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAIL += 1


def main() -> int:
    print(f"\nworking in {WORK}\nsource: {os.environ['THIRDEYE_SOURCE']}\n")

    with TestClient(app) as client:
    # Wait on buffer *depth*, not segment count. The delivery below reaches
    # fourteen seconds back, and asking for a window the buffer does not hold
    # yet is correctly refused - which is a real behaviour, just not the one
    # under test here.
        need = 20.0
        print(f"waiting for the buffer to hold {need:.0f}s...")
        deadline = time.time() + 90
        while time.time() < deadline and buffer.held_seconds(time.time()) < need:
            time.sleep(1)
        held = buffer.held_seconds(time.time())
        segments = buffer.segments()
        check("the recorder is producing segments", len(segments) >= 8, f"{len(segments)} on disk")
        check("the buffer reaches back far enough to cut from", held >= need, f"{held:.1f}s")
        if not segments:
            return 1

        health = client.get("/api/health").json()
        check("health reports recording", health["recording"] is True)
        check("buffer depth is reported", health["buffer_held_s"] > 0, f"{health['buffer_held_s']}s")

        match_id = client.post("/api/session/start", json={"venue": "Marymoor"}).json()["match_id"]
        check("a match starts", bool(match_id), match_id)

        with client.websocket_connect("/ws") as ws:
            hello = ws.receive_json()
            check("hello arrives first", hello["type"] == "hello")
            check("hello advertises the buffer", hello.get("buffer_seconds", 0) > 0)
            ws.receive_json()  # opening status

            # The clock handshake the phone uses to stamp markers in vest time.
            sent = time.time()
            ws.send_json({"v": 1, "type": "ping", "t": sent})
            reply = ws.receive_json()
            check("pong echoes and carries the vest clock",
                  reply["type"] == "pong" and reply["t"] == sent and reply["vest_time"] > 0)

            # A delivery: two markers, twelve seconds apart, both in the past so
            # they land inside footage that has already been recorded.
            now = time.time()
            start_at, end_at = now - 12.0, now - 1.5
            ws.send_json({"v": 1, "type": "mark", "seq": 1, "edge": "start", "at": start_at})
            state = ws.receive_json()
            check("the vest goes to recording", state.get("state") == "recording")

            ws.send_json({"v": 1, "type": "mark", "seq": 1, "edge": "end", "at": end_at})

            clip = None
            deadline = time.time() + 25
            while time.time() < deadline:
                message = ws.receive_json()
                if message["type"] == "clip_ready":
                    clip = message
                    break
            check("a clip is announced", clip is not None)
            if clip is None:
                return 1

            print(f"\n  clip: seq {clip['seq']}, {clip['duration_s']}s, "
                  f"{clip['bytes'] / 1e6:.1f} MB, closed_by {clip['closed_by']}")

            expected = (end_at - start_at) + float(os.environ["THIRDEYE_PREROLL_SECONDS"])
            check("duration covers the delivery plus pre-roll",
                  clip["duration_s"] >= expected - 2.0,
                  f"{clip['duration_s']}s vs {expected:.1f}s asked for")

            # What the phone does next: fetch it, resuming part way.
            whole = client.get(f"/clips/{clip['seq']}.mp4")
            check("the clip downloads", whole.status_code == 200)
            check("the size matches what was announced", len(whole.content) == clip["bytes"])
            check("the hash matches what was announced",
                  hashlib.sha256(whole.content).hexdigest() == clip["sha256"])

            half = clip["bytes"] // 2
            head = client.get(f"/clips/{clip['seq']}.mp4", headers={"Range": f"bytes=0-{half - 1}"})
            tail = client.get(f"/clips/{clip['seq']}.mp4", headers={"Range": f"bytes={half}-"})
            check("a ranged request answers 206", head.status_code == 206 and tail.status_code == 206)
            check("a resumed download reassembles byte-for-byte",
                  hashlib.sha256(head.content + tail.content).hexdigest() == clip["sha256"])

            # And it has to be a real video, not merely the right number of bytes.
            path = WORK / "downloaded.mp4"
            path.write_bytes(whole.content)
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries",
                 "stream=codec_name,width,height,nb_read_packets",
                 "-count_packets", "-select_streams", "v", "-of", "json", str(path)],
                capture_output=True, text=True,
            )
            ok = probe.returncode == 0
            frames = 0
            if ok:
                stream = json.loads(probe.stdout)["streams"][0]
                frames = int(stream.get("nb_read_packets", 0))
                print(f"  probe: {stream['codec_name']} {stream['width']}x{stream['height']}, "
                      f"{frames} frames")
            check("the downloaded file is a playable video", ok and frames > 30)

            # Acknowledge it, the way the phone does before anything may be purged.
            ws.send_json({"v": 1, "type": "ack", "seq": clip["seq"], "sha256": clip["sha256"]})
            time.sleep(0.4)

            # A reconnecting phone asking what it missed.
            ws.send_json({"v": 1, "type": "resync", "since_seq": 0})
            replay = None
            deadline = time.time() + 8
            while time.time() < deadline:
                message = ws.receive_json()
                if message["type"] == "clip_ready":
                    replay = message
                    break
            check("resync replays clips the phone has not committed",
                  replay is not None and replay["seq"] == clip["seq"])

            print(f"\n  buffer now holds {buffer.held_seconds(time.time()):.1f}s across "
                  f"{len(buffer.segments())} segments; recorder restarts: {recorder.restarts}")
            if recorder.last_error:
                print(f"  recorder last error: {recorder.last_error[:160]}")

            # An end marker with no start: the umpire missed the first tap. A
            # recovered clip reaches back half the timeout, so the buffer has to
            # be at least that deep before this is a fair test - otherwise the
            # vest refuses, correctly, and it looks like a failure.
            need_recovery = 20.0 + 2.0 + 4.0
            deadline = time.time() + 90
            while time.time() < deadline and buffer.held_seconds(time.time()) < need_recovery:
                time.sleep(1)
            print(f"  waited for {buffer.held_seconds(time.time()):.1f}s of buffer "
                  f"before testing recovery")

            ws.send_json({"v": 1, "type": "mark", "seq": 2, "edge": "end", "at": time.time() - 1.5})
            recovered = None
            deadline = time.time() + 25
            while time.time() < deadline:
                message = ws.receive_json()
                if message["type"] == "clip_ready" and message["seq"] == 2:
                    recovered = message
                    break
            check("a missed start is recovered from the buffer",
                  recovered is not None and recovered["closed_by"] == "recovered",
                  recovered["closed_by"] if recovered else "no clip")

            # A marker older than the buffer must be refused, not turned into an
            # empty clip that looks fine.
            ws.send_json({"v": 1, "type": "mark", "seq": 3, "edge": "end", "at": time.time() - 9999})
            refusal = None
            deadline = time.time() + 6
            while time.time() < deadline:
                message = ws.receive_json()
                if message["type"] in ("marker_refused", "clip_ready"):
                    refusal = message
                    break
            check("a marker past the buffer is refused",
                  refusal is not None and refusal["type"] == "marker_refused")

    print(f"\n{'ALL CHECKS PASSED' if FAIL == 0 else f'{FAIL} CHECK(S) FAILED'}\n")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
