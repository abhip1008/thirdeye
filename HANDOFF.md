# Handoff

Current working state, kept short. `README.md` is the narrative and
`INFO.md` is the build notes; neither belongs here.

Update the affected section at the end of any session that changed the state of
a subsystem, whichever tool the session was in. One line per change, newest
first, with a date.

---

## Protocol

Stable. TypeScript and Python regenerate byte-identical, golden fixture parses
on both sides, three malformed shapes rejected on both sides.

No open work.

---

## Mobile

Phase 1 complete. 55 tests, typecheck clean, lint clean, both production
bundles export, iOS project compiles in Xcode. HMAC-SHA256 request signing and
the signed control-channel handshake are in.

Not yet run on a physical device. The unverified list is in `README.md` under
"What is not verified, and needs a phone". Highest risk in order:

1. The SQLite migration actually executing, since `expo-sqlite` is native.
2. Frame-accurate stepping proving exact by eye on the synthetic clip.
3. Clips surviving between launches on iOS, where the cache directory can be
   reclaimed.

**Next action:** work the five-minute tour in `README.md` on a real phone.

---

## Vest

Service is real: continuous buffer, cut on marker, HTTP serve with resume,
signed requests, pairing code. Runs on a laptop with `THIRDEYE_SOURCE=file:`
or `pattern:`. 34 tests plus a 20-check end-to-end run.

The camera is the only remaining fake.

**Next action:** connect the phone to a running vest. Both halves are verified
alone; they have never been connected to each other.

---

## Hardware

Production target is a Radxa ROCK 5C with an AR0234 global-shutter camera.
Nothing has been bought or brought up against that target yet.

Separate prototyping is happening on a Raspberry Pi 5 with an Arducam OV5647,
outside this repo. State as of 2026-09-14:

- Camera works. `camera_auto_detect=0` and `dtoverlay=ov5647` in
  `/boot/firmware/config.txt`, plugged into CAM1, no `,cam0` suffix.
  `rpicam-hello`, `rpicam-still` and `rpicam-vid` all confirmed.
- An earlier microSD failed mid-bring-up and corrupted the OS. Reflashed onto a
  high-endurance card. Keep the better power supply; brownouts caused it.
- Pi broadcasts a `UmpireCam` hotspot at 10.42.0.1 via nmcli. A WebSocket
  server on port 8765 accepts START and STOP from a phone browser.
- That WebSocket work predates knowing this repo's vest service exists and
  duplicates it. It should be discarded rather than merged; the Pi is a
  `libcamera:0` source for `thirdeye.main`, not a second implementation.

**Next action:** run the real vest service on the Pi with
`THIRDEYE_SOURCE=libcamera:0` and point the phone at it.

---

## Open questions

- The chest-camera framing test. Strap a phone to your chest for two overs and
  measure how often the impact zone is in frame. Above 90%, proceed. Around
  60%, the form factor does not work. This gates hardware spending and costs an
  afternoon.
- Whether the ROCK 5C radio does 5 GHz AP mode, and which GStreamer hardware
  encoder exists on the Radxa image. If neither encoder is there the timing
  budget collapses. `docs/SPEC.md` section 11 has the full list.
- The five policy questions in `docs/PRIVACY.md` section 8. Not engineering.
- Rolling shutter on the Pi prototype distorts fast motion. Acceptable for
  pipeline work, not a verdict on the production sensor choice.
