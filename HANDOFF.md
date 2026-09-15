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

Phase 1 complete. 84 tests, typecheck clean, lint clean, both production
bundles export, iOS project compiles in Xcode. HMAC-SHA256 request signing and
the signed control-channel handshake are in.

Signing is stamped in *vest* time, not phone time, because a vest has no
real-time clock. A request refused for clock skew comes back with the vest's
clock in `X-TE-Time`; the phone adopts it and retries once. `net/vestClock.ts`
owns that offset and `net/signedFetch.ts` is the retry - every signed HTTP call
goes through it.

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
signed requests, pairing code. 67 tests plus a 30-check end-to-end run.

**The camera is no longer a fake.** It runs on a Raspberry Pi 5 with an OV5647
and records continuously - see Hardware. What has still never run against real
footage is everything after the buffer: the cut, the hash, the transfer.

Ready for the Pi as of 2026-09-14: capture geometry is configuration
(`THIRDEYE_WIDTH`/`HEIGHT`/`FRAMERATE`), a recorder restart no longer leaves
`rpicam-vid` holding the sensor, the camera's own stderr is what gets reported
when the camera is what is wrong, the systemd unit binds 0.0.0.0 rather than
loopback, and the address in the pairing code is `THIRDEYE_ADVERTISE_HOST`
rather than a constant. `scripts/setup-pi.sh` installs the lot.

**Next action:** connect the phone to a running vest. Both halves are verified
alone; they have never been connected to each other.

---

## Hardware

Production target is a Radxa ROCK 5C with an AR0234 global-shutter camera.
Nothing has been bought or brought up against that target yet.

Prototyping is on a Raspberry Pi 5 with an Arducam OV5647. Background, and the
failures already paid for, are in `docs/pi-prototype.md`.

**2026-09-14: the vest service runs on the Pi and records from the camera.**
Installed at `/opt/thirdeye` via `scripts/setup-pi.sh`, service enabled, capture
at **1296x972 at 30** - the full-sensor mode, chosen over 1920x1080 because
1080p on this sensor is a centre crop and field of view matters more than pixels
for a chest camera. Health reports `recording: true`, no restarts, no errors,
and the rolling buffer holds its full 300 seconds with the janitor trimming to
the horizon.

Five bugs were found by running it, all in the camera path, all invisible to a
test suite that stubbed process spawning. They are listed in `docs/pi-prototype.md`
and fixed. The load-bearing one: B-frames meant the stream could never be cut,
so the vest recorded one file that grew forever while reporting itself healthy.
`--low-latency 1`, measured 1 segment against 8.

Measured on the board: no hardware encoder (the Pi 5 has none), software
encoding at 1.43x realtime, `rpicam-vid` at about 50% of one core at this mode,
1.2 Mbps. 5 GHz AP was reported unavailable until the WLAN country was set.
`/data` is on the SD card - move it to a USB SSD before any long soak, since a
card has already been lost to this.

**2026-09-15: `check_clip.py` passes on the Pi, against the camera.** All 16
checks - signed requests, a match, a marker pair at both edges in vest time, the
clip announcement, download, length, SHA-256, a resumed download reassembling
byte for byte, and ffprobe confirming real video at the frame rate the review
screen will step through it with.

So the entire vest side is now proven on real footage rather than on a file
standing in for a camera. What has never run against a real vest is the app.

**2026-09-15: the whole loop runs on hardware.** The app, on a simulator on the
same Wi-Fi, paired by hand, opened a signed control channel to the Pi, marked a
delivery, and received a clip cut from the camera's own footage - announced,
downloaded, hash-verified and committed. Reported good to review, including
frame stepping, though that was judged by eye rather than measured.

**The afternoon cost five hours to one loose ribbon.** The camera ran clean for
31 minutes, then failed as the board warmed: first `Failed to queue buffer for
CFE Image`, then after a reboot `no cameras available`, and finally an empty
i2cdetect - nothing on the camera bus at all. It was the 15-pin end at the
camera module, not clipped fully home. `docs/pi-prototype.md` has the sequence,
because the failure changes its story as it worsens and none of the messages
say "connector".

Two software faults were found underneath it and are worth keeping in mind:

- The vest reported `recording: true` for twelve minutes while writing nothing.
  Fixed: `recording` now means footage is arriving, and a watchdog restarts a
  stalled pipeline within ten seconds.
- NTP corrected the clock forward 17 hours mid-session, which made every
  buffered segment look older than the horizon, so the janitor swept all 1,850
  of them in one pass. The buffer really was empty and the refusal that followed
  was honest. Now logged loudly - **the fix is an RTC battery**, which this Pi
  does not have.

**Next action:** an RTC battery, and a soak - leave it recording for an hour and
watch `restarts` and the buffer depth. Then the framing test, which is the gate:
strap it to a chest and umpire two overs.

The access point (`scripts/setup-hotspot.sh`) is still deliberately last, and
now has a clip across ordinary Wi-Fi in front of it.

Older note, kept: pair a phone with it over the home Wi-Fi and get the first clip
across - vest at 192.168.4.82, key from `python -m thirdeye.pairing`, mock
vest off in the app's settings. Nothing in the marker-to-clip path has run
against real footage yet: cutting, hashing and transfer are all still only
proven against a file standing in for a camera. The access point comes after
that, so that only one thing is new at a time.

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
