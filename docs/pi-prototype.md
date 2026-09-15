# Raspberry Pi prototype

A Raspberry Pi 5 with an Arducam OV5647 was brought up separately from this
repository, before the vest service existed in its current form. This is the
record of what was done, what broke, and what is worth keeping.

The Pi is **not the production board**. That is a Radxa ROCK 5C with an AR0234.
The Pi exists so the capture path can be exercised on real hardware without
waiting on the board that has not been bought.

## What works

Hardware:

- Raspberry Pi 5. Identified by the two CAM/DISP connectors, the PCIe ribbon
  connector and the 4-pin fan header.
- Arducam OV5647, M12 interchangeable lens, 5 MP, 2592x1944, rolling shutter.
- The module is 15-pin and the Pi 5 is 22-pin, so it needs a 15-to-22-pin
  camera ribbon.
- Plugged into **CAM1**.

OS is Raspberry Pi OS, not Ubuntu. See the failures below for why.

`/boot/firmware/config.txt`:

```text
camera_auto_detect=0

[all]
dtoverlay=ov5647
```

No `,cam0` suffix. That is only for the CAM0 connector.

Confirmed working after a reboot:

```bash
rpicam-still --list-cameras     # lists ov5647
rpicam-hello -t 0               # live preview, Ctrl+C to stop
rpicam-still -o test.jpg
rpicam-vid -t 10000 --codec libav -o test.mp4
```

Record to MP4 with `--codec libav` rather than raw `.h264`, which needs VLC or
ffplay to watch.

## Modes

Arducam lists 1080p30 and 640x480 at 60 to 67 fps for this sensor. An earlier
assumption of 720p60 was wrong; it is not on Arducam's list for this board.
Run `rpicam-hello --list-cameras` on the Pi to see what the sensor actually
exposes before choosing a capture mode.

The sensor is **rolling shutter**. A cricket ball and bat move fast enough to
smear and skew. That is acceptable for proving the capture, buffer, cut and
transfer path. It is not a verdict on the production sensor, which is global
shutter for exactly this reason.

## How it connects to this repository

The Pi is a source, not a second implementation. `vest/thirdeye/capture/source.py`
already handles it:

```bash
THIRDEYE_SOURCE=libcamera:0 ./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000
```

`libcamera:0` exists because ffmpeg has no libcamera input. `rpicam-vid` owns
the sensor and writes H.264 to stdout, which is piped into ffmpeg. The frames
arrive already encoded, so the segmenter copies rather than re-encodes.

On a Pi 5 that encode is done in software by `rpicam-vid`; the Pi 4 uses a
hardware encoder. Watch CPU on the Pi 5 at the mode you pick. The production
board is expected to use `THIRDEYE_ENCODER=h264_rkmpp`, which does not apply
here.

The capture mode is configuration, not code:

```bash
THIRDEYE_SOURCE=libcamera:0
THIRDEYE_WIDTH=1920
THIRDEYE_HEIGHT=1080
THIRDEYE_FRAMERATE=30
```

Those must name a mode the sensor really has - for this OV5647, 1080p30 rather
than the 1920x1200 at 60 the production sensor will do. `scripts/setup-pi.sh`
installs the service and `scripts/check-hardware.sh` prints the sensor's mode
list; `vest/README.md` has the bring-up in order.

**2026-09-15: this runs on the Pi and records from the camera.** 1296x972 at 30,
software encoding at about half a core, 1.2 Mbps, a full 300-second rolling
buffer. `scripts/check_clip.py` cuts a clip from that footage, serves it, and
passes all sixteen of its checks. The five bugs that stood between here and
there are below.

### Three things fixed in advance of it

Written down because each was found by reading the code against these notes,
not by running it, and each would have looked like a camera problem on the day.

- **The capture geometry was hardcoded** at 1920x1200 at 60 - a mode this sensor
  does not have. It is now `THIRDEYE_WIDTH`/`HEIGHT`/`FRAMERATE`.
- **A restart left the camera held.** `rpicam-vid` owns the sensor exclusively.
  If ffmpeg died, the supervisor started a second `rpicam-vid` while the first
  was still running, so every restart after the first failed with the camera in
  use - a vest that answers health, looks alive, and never records another ball.
  The old process is now stopped first, and `rpicam-vid`'s own stderr is kept,
  so "no cameras available" is reported instead of ffmpeg's complaint about an
  empty stream.
- **The systemd unit bound to 127.0.0.1**, which from the phone is
  indistinguishable from a vest that is switched off.

### And three more found by running it on the Pi

All three were in the camera path, which had never executed before. Each looked
like the one before it - "the vest is up but not recording" - and each had a
different cause.

- **The producer's stdout was handed to ffmpeg as an asyncio StreamReader**,
  where a file descriptor is required: `'StreamReader' object has no attribute
  'fileno'`. Every unit test passed, because they all stub the process spawning.
  There is now one that runs two real processes through one real pipe.
- **libav could not choose an output format for `-`.** With no hardware H.264
  encoder, `--codec h264` goes through libav, which deduces its container from
  the file extension - and stdout has none. Fixed with `--libav-format h264`.
  It is also why recording to `test.mp4` by hand worked while this did not.
- **B-frames meant the stream could never be cut.** The camera recorded happily
  at 1.2 Mbps into a single file that grew forever; the buffer reported 1.4
  seconds after a minute. Reordered frames, read as raw H.264 from a pipe with
  no container timestamps, leave ffmpeg without a clock, and the segment muxer
  needs a clock as well as a keyframe. Eight seconds of camera through the real
  pipeline: **1 segment plain, 8 with `--low-latency 1`**. Setting `bf=0`
  through `--libav-video-codec-opts` did not take - still 1 - which is why that
  was measured rather than assumed.

Worth knowing for the production board: `--libav-video-codec` defaults to
`h264_v4l2m2m`, the hardware encoder. On a Pi 5 that does not exist and it falls
back to libx264 silently, which is where the B-frames came from.

Also, because the Pi has no real-time clock: a signed request refused for clock
skew now comes back carrying the vest's own clock, and the phone adopts it and
retries. Without that, a vest that boots believing it is last Tuesday refuses
every request the phone makes, and there is nothing an umpire in a field can do
about it.

## What was built on the Pi and should be discarded

The Pi runs a hotspot called `UmpireCam` at 10.42.0.1, set up with nmcli, plus
a standalone `websocket_server.py` on port 8765 and a two-button `control.html`
served by `python3 -m http.server 8000`. A phone on the hotspot can send START
and STOP and see them arrive.

That predates knowing this repository's vest service existed. It is a worse
reimplementation of the control channel: no rolling buffer, no marker
semantics, no signing, no clip identity, no protocol version. **Do not merge
it.** The hotspot configuration is the only part worth keeping, and even that
should be replaced by the vest's own AP setup under `vest/deploy/`.

One operational note that does carry over: while the hotspot is up the Pi has
no internet, so `apt` fails with a DNS resolution error. Bring it down, install,
bring it back up:

```bash
sudo nmcli connection down Hotspot
# reconnect to normal Wi-Fi, install what is needed
sudo nmcli connection up Hotspot
```

## Failures already hit, so they are not debugged twice

**Ubuntu on the Pi.** The `rpicam-*` tools and the Raspberry Pi camera stack
are not set up there the way Arducam's instructions assume. Switched to
Raspberry Pi OS. Do not go back.

**"No cameras available" then "Input/output error".** Adding the overlay moved
the failure from the first message to the second, which looks like the driver
now reaching a sensor that will not answer. The usual cause is ribbon
orientation or seating, and reseating both ends with the Pi powered off is the
right first move. It was not the cause here.

**The real cause was a failing microSD card.** Core binaries appeared to vanish
one by one, `sudo`, `grep`, `dmesg`, `which`, and eventually `/bin/ls /` itself
returned `Input/output error`. A partially failing card still boots, because
the boot files stay readable and loaded programs keep running from RAM. Likely
triggered by earlier power instability.

Fixed by flashing a fresh Raspberry Pi OS onto a new high-endurance card. Keep
using the better power supply; repeated brownouts corrupt cards quickly.

The lesson worth carrying: **when basic shell utilities start failing, stop
debugging the peripheral.** The problem is underneath.
