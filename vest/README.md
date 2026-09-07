# thirdeye-vest

The on-body unit. Python, FastAPI, GStreamer. Runs on a Radxa ROCK 5C in the
umpire's vest.

It records continuously into a five-minute rolling buffer on the SSD, cuts a
clip out of it whenever the phone marks a delivery, and serves the result to the
paired phone over its own access point. It holds twelve clips and deletes the
rest.

**The recording never stops and is never conditional on a message arriving.**
That is the whole point of the buffer: a marker held on the phone through a
Wi-Fi outage still produces a clip when the link returns, because the footage
was there the whole time.

## Status

The service is real: it records, cuts, serves and talks. Everything on the
production path except where the pictures come from.

That last exception is the point. Set `THIRDEYE_SOURCE` to a file or a test
pattern and the whole system - buffer, cut, link, phone - runs on a laptop with
no hardware at all. The camera is the last fake to be removed, not the first.

```bash
# a laptop, with a recording standing in for the camera
THIRDEYE_SOURCE=file:../mobile/assets/mock/sample.mp4 \
  ./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000

# the vest, once there is one
THIRDEYE_SOURCE=camera:/dev/video0 THIRDEYE_ENCODER=h264_rkmpp \
  ./.venv/bin/uvicorn thirdeye.main:app
```

Then point the phone at it: Settings, turn the mock vest off.

## Checking it end to end

```bash
./.venv/bin/python scripts/smoke_test.py
```

Boots the service, waits for the buffer to fill, starts a match, sends the
markers a phone would send, and then does what a phone does with the answer -
fetches the clip with a Range request, checks the hash, and probes the file to
confirm it is a real video rather than the right number of bytes. It also
exercises the three cases that are easy to get quietly wrong: a resumed
download, a missed start marker recovered from the buffer, and a marker so old
its footage has been overwritten, which must be refused rather than turned into
an empty clip.

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

A fourth measurement joins them now that recording is continuous rather than
gated: **sustained thermals**. The encoder previously ran in short bursts around
each delivery; it now runs for three hours without stopping. A pipeline that
quietly drops from 60 fps to 12 without erroring is the worst failure mode in
the system, so measure the encoded frame rate over a full session before
trusting it.

Use the Radxa Debian image, not vanilla Debian: the Rockchip BSP kernel is where
the VPU drivers are.

## Markers, not triggers

The umpire marks the start and end of a delivery in the app. The vest turns a
pair of markers into a clip:

| Markers received | Result |
|---|---|
| start, then end | Normal clip, `closed_by: button` |
| start, no end for 40s | Auto-closed, `closed_by: timeout` |
| end with no preceding start | Cut backwards from the buffer, `closed_by: recovered` |
| start while already open | Close the current clip, open a new one immediately |
| anything within 2s of the last | Ignored as a bounce |

Two properties fall out of recording continuously that did not hold when the
recording was gated by a button:

- **A marker can arrive late.** Anything inside `buffer_seconds` is still
  cuttable, so a phone that was offline for an over replays its markers and gets
  its clips. Reject markers older than `marker_max_age_seconds` honestly rather
  than producing an empty clip.
- **A missed press is recoverable.** Under the old design a lost press meant
  lost footage. Now it means the umpire can grab it afterwards.

That second point matters more than it looks. Missed presses are not randomly
distributed - they cluster around the deliveries where something dramatic
happened, because that is when the umpire's attention is elsewhere, which is
exactly when a review gets called.

## Clock sync

Markers arrive stamped in **vest time**, not phone time. The phone does the
conversion: every `pong` carries the vest's own clock, the phone estimates the
offset from the round trip, and applies it before sending. The vest therefore
never tracks a per-client offset, and a second phone in v2 needs no extra work.
