---
paths:
  - "vest/**"
---

# Vest rules

Python, FastAPI, GStreamer. Target board is a Radxa ROCK 5C. A Raspberry Pi is
a supported prototyping path, not the production board.

## The one invariant

**Recording never stops and is never conditional on a message arriving.** A
marker says which part of the buffer to keep; it is not a trigger. A tap that
cannot reach the vest is a late ball, not a lost one. Any change that makes
capture depend on the link is wrong.

## Sources

`THIRDEYE_SOURCE` selects where frames come from:

- `camera:/dev/videoN` — USB or CSI camera through v4l2
- `libcamera:0` — Raspberry Pi ribbon camera, piped in from `rpicam-vid`
  because ffmpeg has no libcamera input
- `file:path` — a recording standing in for the camera
- `pattern:` — synthetic test pattern

`file:` and `pattern:` are how the whole system runs on a laptop. Keep them
working.

## Security

Every request is signed. The Wi-Fi passphrase is printed on the vest where
players can photograph it, so joining the network proves nothing. Unsigned and
replayed requests are refused, and the control channel is refused before it
opens. See `docs/decisions/0006-lan-transport-security.md`.

`THIRDEYE_REQUIRE_SIGNATURE=false` exists for development only and announces
itself in capitals on every start. Do not remove that warning and do not make
it the default.

## Checking a change

```bash
./.venv/bin/python -m pytest
./.venv/bin/python scripts/smoke_test.py
```

The smoke test is the one that matters: it boots the service, fills the buffer,
sends the markers a phone would send, then fetches the clip with a Range
request and verifies the hash.
