# thirdeye-vest

The on-body unit. Python, FastAPI, GStreamer. Runs on a Radxa ROCK 5C in the
umpire's vest.

It captures continuously into a 20-second ring buffer in tmpfs, cuts a clip
around each delivery when the remote says so, and serves the result to the
paired phone over its own access point. It holds twelve clips and deletes the
rest.

## Status

Phase 1 is scaffolding: the generated protocol models and a health endpoint,
enough to prove the toolchain and give Phase 3 something to point at.

Capture arrives in Phase 2, the link in Phase 3, clipping and pre-roll in Phase 4.

## Run

```bash
python3 -m venv .venv
./.venv/bin/pip install -e '.[dev]'
./.venv/bin/python -m pytest
./.venv/bin/uvicorn thirdeye.main:app --reload
curl -s localhost:8000/api/health
```

## Protocol

`thirdeye/protocol.py` is **generated** from `../protocol/schema/protocol.v1.json`.
Do not edit it. Run `npm run protocol` at the repo root.

`tests/test_protocol_contract.py` parses the same golden fixture the phone's
test does, including three shapes that must be rejected.

## Before Phase 2

Three things have to be measured on the actual hardware, and the timing budget
collapses if any of them comes back wrong:

```bash
gst-inspect-1.0 | grep -iE "mpp|rkmpp|v4l2h26"   # is there a hardware encoder?
v4l2-ctl -d /dev/video0 --list-formats-ext        # UYVY at 60, or MJPEG at 120?
iw list | grep -A 20 "Supported interface modes"  # does the radio do 5 GHz AP?
```

Use the Radxa Debian image, not vanilla Debian: the Rockchip BSP kernel is where
the VPU drivers are.

## The state machine

Section 7.6 of `../docs/SPEC.md`. Both recovery paths are built from day one,
not bolted on later:

| Event | State | Action |
|---|---|---|
| START | Recording | END was missed. Close now, open a new clip immediately. |
| END | Idle | START was missed. Cut from the ring, flag `recovered`. |
| 40s elapsed | Recording | Auto-close, flag `timeout`. |

Missed presses will not be randomly distributed. They cluster around the
deliveries where something dramatic happened, because that is when the umpire's
attention is elsewhere - which is exactly when a review gets called.
