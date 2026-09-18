# thirdeye-vest

The on-body unit. Python, FastAPI, ffmpeg. Runs on a Raspberry Pi today and a Radxa ROCK 5C in the
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

## Putting it on a Raspberry Pi

Two things are new at once here - a camera and a network - so bring them up one
at a time. The camera first, on the Wi-Fi the Pi is already on. The access point
only after a phone has downloaded a clip.

```bash
git clone <this repo> ~/thirdeye && cd ~/thirdeye

./scripts/check-hardware.sh     # measure the board before trusting any of it
sudo ./scripts/setup-pi.sh      # packages, service account, /data, systemd
sudoedit /etc/thirdeye.env      # the camera and the capture mode
sudo systemctl start thirdeye
```

`setup-pi.sh` is safe to run twice and never touches an existing signing key.
It deliberately does not configure the access point.

Three values in `/etc/thirdeye.env` have to be right or nothing works:

| Setting | What it must be |
|---|---|
| `THIRDEYE_SOURCE` | `libcamera:0` for a camera on the ribbon connector, `camera:/dev/video0` for USB. `check-hardware.sh` says which you have. |
| `THIRDEYE_WIDTH` / `HEIGHT` / `FRAMERATE` | **A mode the sensor really has.** Not a mode you would like it to have. `check-hardware.sh` prints the list. Asked for a mode it lacks, a camera either refuses to start or quietly gives you something else, and the second wastes an afternoon. |
| `THIRDEYE_ADVERTISE_HOST` | The address the phone should dial. `192.168.43.1` on the vest's own AP, `10.42.0.1` on an nmcli hotspot, or whatever DHCP gave the Pi while it is still on your home network. Get it wrong and the pairing code scans perfectly and points the phone at nothing. |

Then the access point, once a clip has actually reached a phone:

```bash
sudo ./scripts/setup-hotspot.sh 'a-passphrase-you-choose'
```

That uses NetworkManager, which is what Raspberry Pi OS runs, and it updates
`THIRDEYE_ADVERTISE_HOST` for you. The `hostapd.conf` and `dnsmasq.conf` in
`deploy/` are for the production image, which does not run NetworkManager -
running both on a Pi is a fight rather than a configuration.

Two things that catch people:

- **Set the Wi-Fi country first** (`sudo raspi-config` → Localisation →  WLAN
  Country) or the radio will not transmit on 5 GHz at all. The script refuses to
  continue without one, because the failure otherwise is a hotspot that silently
  appears on 2.4 GHz.
- **The Pi has one radio.** When the hotspot comes up the Pi leaves your home
  network, and an SSH session over Wi-Fi dies with it. Use Ethernet, or a
  keyboard and monitor, or reconnect by joining the hotspot.

> **While a hotspot is up the Pi has no route to the internet**, so `apt` fails
> with a DNS error. Bring it down, install, bring it back up.

### Proving it works, without a phone

```bash
sudo -u thirdeye /opt/thirdeye/vest/.venv/bin/python \
  /opt/thirdeye/vest/scripts/check_clip.py
```

This is the app, in a script, against the vest that is already running. It signs
its requests with the real key, starts a match, marks a delivery, waits for the
announcement, downloads the clip, checks the length and the SHA-256 against what
was announced, resumes a half-finished download, and probes that the result is
real video at the frame rate the review screen will step through it with.

Run it before pairing a phone for the first time. When a first clip fails to
appear on a phone it is not obvious whether the vest could not cut it or the app
could not fetch it, and finding out which, in a car park, with a net session
waiting, is how an afternoon goes. Everything this touches is the vest's side.

### Getting clips onto a computer

```bash
./.venv/bin/python scripts/pull_clips.py --host 192.168.4.82:8000 \
  --key <the psk> --out ~/Downloads/over1
```

Runs from anywhere that can reach the vest. Downloads every clip it is holding,
checks each against the hash the vest announced, and refuses to write one that
does not match - the same path the app uses, so a file that lands here is
byte-identical to the one the vest cut.

The app is how an umpire watches a clip. This is for judging framing and motion
blur on a large screen, keeping a session to compare two camera settings, or
handing footage to somebody who is not holding the phone. `--seq` takes just one
delivery, repeatably.

## Unattended: what happens when you switch it on

Once `setup-pi.sh` and `setup-hotspot.sh` have each been run **once**, there is
nothing to type on the vest again. Sealed into a vest, on a battery, with no
keyboard and no screen, this is the whole sequence:

| # | What | Needs |
|---|---|---|
| 1 | Pi boots | power |
| 2 | NetworkManager brings up `thirdeye-vest-01` — `autoconnect yes`, so it returns on every boot | the radio |
| 3 | systemd starts `thirdeye.service` — enabled, so no command | nothing |
| 4 | The recorder starts, the buffer begins filling | the camera |
| 5 | The phone joins the vest's Wi-Fi, which it remembers after the first time | — |
| 6 | The app reconnects with its stored key, and `hello` tells it the vest has no match, so **the app starts one itself** | — |
| 7 | Tap. Clip. | — |

Steps 3 and 4 do not wait for step 2. The unit is ordered `After=network.target`
rather than `network-online.target` on purpose: waiting for connectivity a vest
does not have would keep the camera off for up to a minute after power-on, and
that is a minute of cricket nobody recorded.

### When something goes wrong, with nobody able to log in

The phone is the only diagnostic an umpire has, so every failure has to reach it.

| What fails | What the umpire sees | What the vest does |
|---|---|---|
| The camera does not start, or stops | **Red banner: "The vest is not recording"** | Watchdog restarts the pipeline, backing off to 30s while it keeps failing. Never gives up. |
| The service crashes | Link dot goes amber, then green again | systemd restarts it in 2s, forever - `StartLimitIntervalSec=0` means it cannot decide to stay down |
| The vest loses power, or goes out of range | Link dot amber within 15s, taps queue to disk | Nothing. The taps are sent when it returns. |
| A tap lands outside the buffer | "made no clip - the vest had already recorded over it" | Refuses honestly rather than cutting the wrong ten seconds |
| The camera runs but the buffer stalls | Red banner within 10s | Same watchdog. This is the failure that used to be invisible. |

Nothing in that table needs a terminal.

### What is still on a person

- **Battery.** There is no gauge on this hardware, so the app shows none - better
  than the confident 100% it used to invent. Use a power bank with its own
  indicator, and charge it between matches.
- **The clock.** No RTC battery means the Pi boots believing it is whenever it
  was last switched off. With no internet that is self-consistent and harmless
  apart from the date on a folder name. Give it internet mid-match and NTP will
  jump the clock, which empties the buffer in one janitor pass. Fit the battery.
- **Storage.** The buffer is bounded and the clip ring is twelve, but match
  folders accumulate. Worth a look between seasons.

### The clock

A Pi has no real-time clock unless you fit the battery, and at a ground it has
no internet either, so it boots believing it is whenever it was last switched
off. The phone handles this: a request the vest refuses for clock skew comes
back carrying the vest's own clock, and the phone signs in vest time from then
on. Nothing to configure.

What it does not fix: the vest names match folders after the date, so a vest
that thinks it is last Tuesday files Saturday's cricket under last Tuesday.
Worth setting the clock, or fitting the battery, before a match that matters.

### The pairing code

The vest mints a signing key on first boot and keeps it at `/data/signing.key`,
owner-readable only. Every request from the phone is signed with it; an unsigned
one is refused, which is what stops the next person who photographs the Wi-Fi
code from downloading footage of people.

Print the code to tape to the vest:

```bash
sudo -u thirdeye /opt/thirdeye/vest/.venv/bin/python -m thirdeye.pairing \
  | qrencode -o pairing.png -s 8
```

That command is the only place the key is ever revealed. It is on no route, and
the startup log prints the payload with it redacted - a log ends up in a bug
report, and a key in a bug report is not a key any more. If the vest is re-keyed
(delete the file and restart), every paired phone has to scan the new code.

> **Run `check-hardware.sh` before ordering anything.** The design assumed a
> board with a video encoder on the chip. **A Raspberry Pi 5 has none** - the
> encoder was removed - so every frame is compressed by the CPU, continuously,
> for three hours, while that same CPU serves clips over Wi-Fi. A Pi 4 has an
> H.264 encoder but tops out around 1080p30.
>
> A camera on the ribbon connector sidesteps a good deal of this: `rpicam-vid`
> produces an encoded stream, and the recorder copies it through rather than
> compressing it again. That path is already built.

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
