# Third Eye

**An umpire-worn replay system for club cricket.**

The umpire wears a vest with a camera in it and taps their phone once as the
bowler runs in and once when the ball is dead. Every ball becomes a short video
clip that reaches the phone during the thirty-odd seconds before the next ball.
When a review is called, the clip is already there. There is nothing to download
and nothing to wait for.

Clips older than twelve balls are deleted automatically unless someone kept them.

> The umpire's own eyes, on rewind, with nothing kept.

📖 **[EXPLANATION.md](EXPLANATION.md) — start here if you are new.** The whole
system from the top in plain language: the problem, the one idea it rests on, a
ball second by second, and every part explained before it is used. No prior
knowledge assumed.

📖 **[INFO.md](INFO.md) — the build notes.** The whole project explained in plain
language: how it works, the decisions behind it, the bugs found along the way,
and an honest line between what has been proven and what has only been written.

---

## Contents

- [Why this might work](#why-this-might-work)
- [What it will and will not resolve](#what-it-will-and-will-not-resolve)
- [How it works](#how-it-works)
- [Current status](#current-status)
- [Running it](#running-it)
- [A five-minute tour](#a-five-minute-tour)
- [What is in this repository](#what-is-in-this-repository)
- [How the code is put together](#how-the-code-is-put-together)
- [Working on the protocol](#working-on-the-protocol)
- [Tests and checks](#tests-and-checks)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Why this might work

Three properties separate this from pointing a phone at the game.

| Property | Why it matters |
|---|---|
| **Almost no operator burden** | Nobody starts or stops a recording. Two taps per ball, on a control that fills the bottom of the screen and never moves. |
| **Zero wait at review time** | The transfer happens in the gap between deliveries, not while eleven fielders watch a progress bar. |
| **Nothing is kept** | Auto-purge after twelve balls answers the privacy objection, the storage cost, and the "are you filming me" conversation, all at once. |

## What it will and will not resolve

Be honest about this in every pitch. A chest camera at the bowler's end sees the
stumps roughly 19 pixels wide from twenty metres. It will **not** resolve a
marginal LBW. There is no ball tracking, no projection, no snicko, and there
never will be from this position.

What it does resolve well:

- **Front-foot no-balls.** The popping crease is one to two metres from the
  camera - the highest pixel density in the frame, and a fully objective call.
- **Gross LBW errors.** Pitched a foot outside leg. Struck above the knee roll.
  Big inside edge.
- **Run-outs at the bowler's end.**
- **The umpire's own memory.** Half the value is "let me look at that again"
  instead of "I'm fairly sure."

Sell the no-ball and the gross-error case. Do not sell DRS.

## How it works

Four tiers.

```
        ON-BODY UNIT                 LINK              PHONE            AFTER MATCH
                                                                        (offline
                                                                         during play)
  [ ROCK 5C + AR0234 ]  <===Wi-Fi===>  [ iPhone or Android ]  ------>  [ Cloud ]
   - records CONTINUOUSLY  markers -->  - the control          - FastAPI
   - 5-minute buffer       <-- clips    - React Native         - optional
   - cuts on a marker                   - SQLite               - deferred
   - FastAPI + nginx                    - 12 clips, then gone
```

**One delivery:**

```
t=0s     Umpire taps as the bowler runs in. The phone writes a marker
         and sends it. The vest was already recording.
t=12s    Ball is dead. Second tap. The vest cuts the clip out of its
         buffer, reaching 5 seconds back so a late tap still catches
         the run-up.
t=12.4s  Vest announces the clip over the WebSocket.
t=15s    Phone has the 9.5 MB, verifies the hash, commits it.
t=40s    Next ball.
```

The transfer uses 3 of the 30 to 40 available seconds. That is the whole design.

**The vest never stops recording.** A tap is a marker, not a trigger - it only
says which part of the buffer to keep. So a tap that cannot reach the vest is a
late ball, not a lost one: the phone holds it, replays it when the link returns,
and the clip turns up minutes after the delivery instead of never. A missed tap
is recoverable for five minutes too, which matters because missed taps cluster
around the deliveries where something dramatic happened.

**A review:** the umpire opens the app, sees twelve clips with status dots, taps
one, and it plays instantly. Technology consumes about two seconds of the ninety
a review takes. Everything else is the umpire looking at the ball, which is the
part that must not be rushed.

---

## Current status

**It runs on hardware.** A Raspberry Pi 5 with an OV5647 records continuously,
cuts a clip when the phone marks a delivery, and delivers it to the app over a
signed connection. That loop has been done end to end with a real sensor.

The camera was the last fake and it is gone. What remains untested is not the
software: it is whether a camera on someone's chest can actually see the ball.

### What is verified, by running it

| Check | Result |
|---|---|
| **The whole loop on hardware** | Pi records 1296×972 at 30, cuts on a marker, serves it; the app downloads, hash-verifies and commits it |
| **The vest's own side, on real footage** | `check_clip.py`: 17 checks — signed requests, marker pair, download, length, SHA-256, resumed download reassembling byte for byte, ffprobe confirming playable video at the rate the review screen steps with |
| **End to end with a file for a camera** | `smoke_test.py`: 30 checks, including a missed start recovered from the buffer and a marker past the buffer honestly refused |
| **Request signing, against a live vest** | Accepted over HTTP and the control channel; unsigned refused on both; a replay refused; a signature moved to another path refused |
| **Two clocks that disagree** | Signed 9,000s out: refused, the vest's clock came back, the phone adopted it and the retry was accepted — no intervention |
| **Deletion after twelve balls** | 16 clips seeded on a device; the app's own sweep left the 12 newest plus one kept and one reviewed |
| **The rolling buffer** | Fills to its 300-second depth and holds there, janitor trimming one segment a second |
| Tests | 95 mobile, 68 vest |
| TypeScript strict, ESLint | clean |
| Both production bundles | export |
| Built app's permission surface | iOS: camera and local network only. Everything else blocked, and CI asserts it. |
| Protocol generator | TypeScript and Python regenerate byte-identical; golden fixture parses on both sides, three malformed shapes rejected on both |

### What is not verified

Shorter than it was, and the remaining items are the ones that matter most.

- **Whether the camera sees the ball.** The gate. Strap it to a chest, umpire
  two overs, measure how often the impact zone is in frame. Everything above is
  worthless if this fails, and it costs an afternoon to find out.
- **Frame-accurate stepping on real footage.** It was proven against the
  synthetic clip — but until this week the phone was inventing the frame rate, so
  what was measured was a rate that was not the camera's. Worth redoing.
- **A physical phone.** Everything to date is a simulator on the same Wi-Fi,
  which reaches the vest identically. The one thing genuinely different on a
  handset is whether clips survive between launches on iOS, where the cache
  directory can be reclaimed.
- **Anything unattended.** No soak longer than an hour, and the Pi has no
  real-time clock — so it boots believing it is yesterday until NTP corrects it,
  which wipes the buffer. Fit the RTC battery before trusting it alone.
- **QR pairing.** Manual entry is proven; the scanner is not, because a
  simulator has no camera.

---

## Running it

### What you need

- **Node 20 or newer** and npm
- **Xcode** (free, Mac App Store) for iPhone, or **Android Studio** for Android
- **Python 3.11+**, only if you want to run the vest scaffold
- No hardware, no paid developer account

### On your iPhone, once

1. **Settings → Privacy & Security → Developer Mode → on**, then restart the
   phone. Required on iOS 16+, and easy to miss.
2. Plug the phone in and trust the computer.

### Build and run

```bash
git clone https://github.com/abhip1008/thirdeye.git
cd thirdeye/mobile
npm install
npx expo run:ios --device       # or: npx expo run:android
```

The first build takes a few minutes. After that, Metro keeps serving JavaScript,
so edits reload instantly and you only rebuild when native config changes.

To work in Xcode directly, open `ios/ThirdEye.xcworkspace` and hit Run - it is a
real Xcode project, with the real `Info.plist`, breakpoints and Instruments.

> **A free Apple ID is enough.** The app expires after seven days and you
> rebuild. The $99 account is only needed for the Wi-Fi-join entitlement in
> Phase 3, and there's a workaround for that.

### Why not Expo Go

It still works (`npx expo start`), and it is still the fastest way to put the
app in front of someone. But **Expo Go runs the JavaScript inside its own
container**, with its own `Info.plist` and its own permissions - so none of this
app's privacy configuration is active there. Blocked permissions, the iCloud
exclusion, screenshot blocking, the app-private storage path: none of it.

That is not academic. Building for real immediately revealed that the app was
declaring a microphone usage string and a Face ID one, both added by config
plugins, both contradicting what the documentation claimed. See
[ADR 10](docs/decisions/0010-development-builds.md).

### Which platforms it runs on

Phase 1 is one React Native codebase and it runs on both. There is no separate
iOS build and no second app.

| | Phase 1, today | On the field, Phase 3 on |
|---|---|---|
| **Android** | Expo Go | supported, and the primary target |
| **iPhone** | Expo Go | works, but the umpire joins the vest's Wi-Fi by hand |

The only thing iOS genuinely cannot do is join the vest's access point from
inside the app. That needs `NEHotspotConfiguration`, which needs a paid Apple
Developer account, an entitlement, and a custom build - and it does not work in
Expo Go at all. Joining the vest's network once from iOS Settings at the toss
costs nothing and is almost certainly the right answer for a club league.
[ADR 7](docs/decisions/0007-ios-support.md) has the full reasoning.

Everything else on the usual iOS list is already done: the local-network usage
string, an ATS exception scoped to the vest's address and nothing else, file
sharing off, and no microphone usage string so the microphone cannot be
requested at all.

There is no vest, so the app runs against `MockTransport`, a fake vest that
bowls on a timer, occasionally drops a delivery, and produces timeouts and
recovered clips at a realistic rate. **Settings** controls its speed.

### The vest, on a laptop

The vest service is real and runs anywhere. Point it at a video file and it
behaves exactly as it does on a Pi, minus the sensor.

```bash
cd thirdeye/vest
python3 -m venv .venv
./.venv/bin/pip install -e '.[dev]'
./.venv/bin/python -m pytest              # 68 tests

THIRDEYE_SOURCE=file:../footage/vest-source.mp4 \
THIRDEYE_KEY_PATH=/tmp/thirdeye-signing.key \
  ./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000
```

It refuses unsigned requests, so the phone needs the key. Print the pairing
payload and read `psk` out of it:

```bash
THIRDEYE_KEY_PATH=/tmp/thirdeye-signing.key ./.venv/bin/python -m thirdeye.pairing
```

For a real Pi, see [`vest/README.md`](vest/README.md).

---

## A five-minute tour

Do this on a real phone. It is also the Phase 1 acceptance test, and it covers
everything in the *not verified* list above.

**1. Pair.** The first screen asks to scan the code on the vest. There is no
vest, so tap **Continue without scanning**. (The manual-address field next to it
is a day-one feature, not a fallback: scanning a printed QR code in direct
sunlight, at the toss, wearing a hat, does not work as reliably as people
demonstrating it indoors believe.)

**2. Read the notice.** This is the screen an umpire turns around and shows a
player who asks what is going on. It is written to be read out loud in fifteen
seconds. Tap **I understand**.

**3. Start a match.** Type a ground name. Everything else has a default already
filled in, because this screen gets used at the toss with a captain waiting.
Tap **Start match**.

**4. Bowl an over.** This is the part that matters, and the whole point of the
control moving into the app: **tap the big blue button at the bottom** as if a
bowler were running in, wait ten seconds, and tap it again.

It should turn red and say **BALL IN PLAY** with a running clock, then go back
to blue, and a clip row should appear at the top moving through
*Waiting* -> *Getting it* -> **Ready**.

Do that six times. Along the way you should see:

- roughly one delivery in twelve producing no clip at all, or a **Not here** row
- occasional notes like *Ran on to 40 seconds* or *Start was missed*
- **after twelve balls, the oldest clip dropping off the bottom** - deleted, not
  hidden, unless you kept it or reviewed it

Two things worth trying deliberately:

- **Forget to end a ball.** Tap once and leave it. After 40 seconds the delivery
  closes itself, the clip is noted as having run on, and the next tap starts
  cleanly.
- **Turn off Wi-Fi mid-over**, tap through two more deliveries, then turn it
  back on. The bar says how many taps are waiting *and that the footage is
  safe*, and the clips arrive late rather than never. That is the buffer doing
  the job it was added for.

Also try:
- **Open a clip and tap the control from there.** It follows you onto the review
  screen on purpose: if the bowler starts running in while you are looking at
  the last ball, a control that only lived on the list would mean navigating
  back first, and you would miss the start.
- **Long-press a row** for Keep / Try again. Nothing covers the list: no modal
  ever appears on this screen. If an umpire has to dismiss a dialog while a
  captain is arguing with them, the product has failed.
- **Pull down** to force a resync. Umpires do this reflexively when unsure, so
  it does something real.

**5. Use your own footage.** The bundled clip is a synthetic test pattern. It is
exactly right for checking that frame stepping is exact, and useless for the
question that decides whether this product works at all: *is the impact zone
even in shot from an umpire's chest?*

Record something - ideally a phone strapped to your chest through a couple of
overs - then **Settings → Your own footage → Add a video**. Every delivery plays
it from the next ball onward. Import several and consecutive balls cycle through
them.

It goes through the system file picker, not the photo library, so the app never
asks for access to your photos. Imports are stored exactly like clips:
app-private, kept out of iCloud, and removed by "Delete all data".

**On a real iPhone**, save the video to Files first (share sheet → Save to
Files), then pick it in the app.

**In the simulator** the Files app is empty, so there is nothing to pick. Use
the helper instead — it copies into the same folder the picker writes to, and
the app cannot tell the difference:

```bash
# convert recordings once: strips audio, normalises, builds a vest source
./scripts/prepare-footage.sh ~/Downloads/*.MOV

./scripts/add-footage.sh footage/clips/*.mp4   # into the simulator
./scripts/add-footage.sh --clear               # back to the test pattern
```

Nothing under `footage/` is ever committed — see [`footage/README.md`](footage/README.md).
The vest can use the same recordings in place of a camera:

```bash
cd vest
THIRDEYE_SOURCE=file:../footage/vest-source.mp4 \
THIRDEYE_KEY_PATH=/tmp/thirdeye-signing.key \
  ./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000
```

The vest refuses unsigned requests, so a phone that pairs against this needs its
key. Print the pairing payload and read the `psk` out of it:

```bash
THIRDEYE_KEY_PATH=/tmp/thirdeye-signing.key ./.venv/bin/python -m thirdeye.pairing
```

Type that value into **Vest key** on the pairing screen. If you would rather not
bother during development, `THIRDEYE_REQUIRE_SIGNATURE=false` turns the check
off and the vest says so in capitals every time it starts - which is the point.
Never run a real match that way: the Wi-Fi passphrase is printed on the vest, so
without signing, joining the network is the entire authorisation check.

Large videos make the app sluggish. Anything over about 200 MB is worth
shrinking first:

```bash
ffmpeg -i chest-cam.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -an over1.mp4
```

The `-an` drops the audio, which the vest will not record either.

**6. Open a clip.** Tap any **Ready** row. This is the screen that matters most,
and the one thing worth checking carefully:

- Press **+1** and **−1**. The yellow marker in the black bar at the bottom of
  the video should move by exactly one step per press, and the counter in the
  top-right corner should advance by one. **If it jumps several frames or does
  not move, frame stepping is not exact and that is a Phase 1 blocker.** The
  clip is synthetic precisely so this is checkable by eye.
- Hold **+1** to repeat.
- Drag the scrubber. The read-out under it counts frames, not seconds, because
  the only reason to look at it is to confirm a step moved by exactly one.
- Tap the **⤢** in the corner of the video for a closer look. It fills the
  screen sideways, so turn the phone. The frame keys come with it.
- Tap **Full speed** to open the speed options, and try **Quarter** or
  **Eighth**. The panel closes when you pick one.
- Tap **Lines** for the stump line and bail height, then drag them with one
  thumb. They are per clip, not global: two deliveries are filmed from two
  slightly different chest angles, and a line carried over from the last one is
  worse than no line at all.
- Tap **Decide** for Out / Not out / Unclear. This writes to the decision log,
  marks the clip reviewed, and keeps it. Not a formality - the decision log is
  what a league looks at after a season, and it is the only thing that survives
  when the video does not.

Three controls are on screen at rest: step back, play, step forward. Everything
else sits behind one word, because an umpire under pressure should be looking at
the ball rather than reading a toolbar.

**7. Check the privacy panel.** Settings -> the grey box at the top says exactly
what is on the phone right now and for how long. This is the answer to the only
question anyone outside the project ever asks.

**8. End the match.** Tap **End** on the live screen. The summary shows what was
recorded, what was reviewed, and what was kept. The primary action deletes
things, which is unusual and deliberate: the promise made to twenty-two players
comes due the moment the match ends, and it should take one tap.

**9. The real acceptance test.** Hand the phone to someone non-technical and
have them tap through it. If they understand the product, Phase 1 is done.

---

## What is in this repository

Seven directories, each with one job.

```
thirdeye/
├── protocol/   one JSON Schema, and the generator that writes both languages
├── vest/       the on-body recorder            Python, FastAPI, ffmpeg
├── mobile/     the review app                  TypeScript, React Native, Expo
├── scripts/    bring-up and bench tools        bash
├── docs/       design, privacy, and decisions
├── footage/    your own test video             never committed
└── cloud/      post-match sync                 deferred, see below
```

### `protocol/` — the wire format

One `schema/protocol.v1.json` generates `mobile/src/types/protocol.ts` and
`vest/thirdeye/protocol.py`. Neither is hand-edited, and `npm run protocol:check`
fails CI if either has drifted. Both sides parse the same golden fixture in
`fixtures/`, including three malformed shapes that must be rejected, and both
check their HMAC against `fixtures/signing-vectors.json`.

One repository rather than four, because the vest and the phone describe the same
wire format in two languages and the gap between them is where protocol bugs
live — see [ADR 1](docs/decisions/0001-monorepo-with-generated-protocol.md).

### `vest/` — the recorder

Runs on a Raspberry Pi as a systemd service. Records continuously into a
five-minute rolling buffer, cuts a clip when a marker arrives, serves it over
signed HTTP with resume, and announces it over a signed WebSocket.

| Area | What lives there |
|---|---|
| `thirdeye/capture/` | `recorder` (supervised ffmpeg + watchdog), `buffer` (the rolling window), `cutter` (stream-copy concat), `source` (camera, file or pattern) |
| `thirdeye/api/` | the WebSocket hub and ranged file serving |
| `thirdeye/session/` | markers in, clips out, and honest refusals |
| `thirdeye/storage/` | hashing, sidecars, the twelve-clip ring |
| `thirdeye/security.py` | key, signatures, replay window |
| `deploy/` | systemd unit, hostapd and dnsmasq, `thirdeye.env` |
| `scripts/` | `check_clip.py` (be the phone), `pull_clips.py` (copy clips off), `smoke_test.py` |

### `mobile/` — the app

| Area | What lives there |
|---|---|
| `src/app/` | the screens, file-routed by expo-router |
| `src/net/` | transport, downloader, signing, the vest clock |
| `src/stores/` | connection, clips, deliveries, match, pairing, auth |
| `src/privacy/` | retention, secrets, storage, audit, screen guard |
| `src/mock/` | a pretend vest, so the whole loop runs with no hardware |
| `src/db/` | SQLite and ordered migrations |
| `src/auth/`, `src/theme/`, `src/components/`, `src/lib/` | identity, palette, the component kit, pure helpers |

### `scripts/` — bring-up

Run in this order the first time; each is safe to run twice.

| Script | Where | What it does |
|---|---|---|
| `check-hardware.sh` | on the Pi | Measures encoder, CPU, camera modes, radio, disk, clock. Changes nothing. |
| `setup-pi.sh` | on the Pi | Packages, service account, `/data`, venv, systemd unit |
| `setup-hotspot.sh` | on the Pi | The vest's own Wi-Fi, via NetworkManager. **Last**, after a clip has reached a phone. |
| `vest/scripts/check_clip.py` | on the Pi | The app, in a script: sign, mark, download, verify. Separates "the vest cannot cut it" from "the app cannot fetch it". |
| `vest/scripts/pull_clips.py` | anywhere | Copies clips onto a computer, hash-checked, for judging framing on a big screen |
| `prepare-footage.sh` | on a Mac | Turns your recordings into test footage |
| `add-footage.sh` | on a Mac | Pushes that footage into the simulator |

### `footage/` — your own video

Gitignored, entirely. The bundled sample is a synthetic test pattern, right for
proving frame stepping is exact and useless for the question that decides whether
any of this works: **is the impact zone in shot from an umpire's chest?** Put
real recordings here and both the app and the vest can use them in place of a
camera. See [`footage/README.md`](footage/README.md).

### `cloud/` — deferred

A README and a `pyproject.toml`, deliberately nothing else. Blocked on five
policy questions in [`docs/PRIVACY.md`](docs/PRIVACY.md) §8, which are decisions
rather than code. **Nothing on match day may ever depend on it.**

### `docs/`

| File | What it answers |
|---|---|
| [`SPEC.md`](docs/SPEC.md) | The full design and build plan, all eight phases |
| [`PRIVACY.md`](docs/PRIVACY.md) | Every piece of data, where it lives, how long, who enforces it |
| [`THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Assets, adversaries, and what is still open |
| [`AUTH.md`](docs/AUTH.md) | Optional Auth0 sign-in, and why nothing is gated on it |
| [`pi-prototype.md`](docs/pi-prototype.md) | The hardware log: what worked, and every failure already paid for |
| [`SCALING.md`](docs/SCALING.md) | What is already paid for, and what breaks first |
| [`decisions/`](docs/decisions) | Eleven ADRs, including every place this deviates from the spec |

There is no `remote/` package. The Bluetooth button moved into the app; see
[ADR 8](docs/decisions/0008-remote-moves-into-the-app.md) for what that bought
and what it cost.

## How the code is put together

### The parts that carry the product

**`mobile/src/app/live.tsx`** - where the umpire spends the match. Four rules
hold it together and none are negotiable: no modal ever appears; the list never
reorders under a finger; tapping a row navigates instantly; the screen stays
awake.

**`mobile/src/lib/clipStatus.ts`** and **`components/StatusDot.tsx`** - the most
important pixel in the app. Three states, each differing in three ways at once -
hue, fill, and word - so the meaning survives colour blindness and direct
sunlight. Roughly 8% of men cannot separate the greens from the ambers, and this
ships to a cricket league.

**`mobile/src/privacy/rules.ts`** - the retention promise, as pure functions with
no database, no filesystem and no network. If these are wrong, the product's main
argument is a lie.

**`mobile/src/app/clip/[seq].tsx`** - frame stepping is why anyone opens the
player.

**`protocol/schema/protocol.v1.json`** - the only definition of the wire format.

### The seams that Phase 3 swaps

Phase 1 runs entirely against mocks, and the seams are interfaces rather than
`if (isMock)` branches scattered through the screens.

| Interface | Phase 1 | Phase 3 |
|---|---|---|
| `Transport` | `MockTransport` - bowls on a timer | `WebSocketTransport` |
| `Downloader` | `MockDownloader` - fakes a realistic 3 seconds | ranged HTTP GET with SHA-256 verification |

Nothing above those interfaces knows which implementation is live. The stores,
the status machine, the retention rules and every screen are exercised today
against the fake and do not change when hardware arrives - and the failure paths
are exercised *by default*, so the grey dot appears in normal use rather than
only when someone unplugs a cable.

### Mobile layout

```
mobile/src/
├── app/         expo-router screens (8 of them)
├── components/  the visual vocabulary, plus the domain widgets
├── stores/      zustand: connection, clips, match, settings, pairing
├── db/          SQLite, migrations, and the only module that writes SQL
├── net/         Transport and Downloader interfaces
├── mock/        the vest that does not exist
├── privacy/     retention, storage, secrets, audit, screen guard
├── theme/       colours, spacing, type
└── types/       protocol.ts is GENERATED - do not edit
```

### Design constraints

The app is used outdoors, in sunlight, by someone in a wide-brimmed hat, under
time pressure, with one hand. That drives everything: high contrast, 56dp
minimum touch targets, primary actions in the bottom third, no modals, no
confirmation dialogs on the review path, and tabular numerals so the ball
counter does not shift under a thumb as it ticks from 9 to 10.

## Working on the protocol

`protocol/schema/protocol.v1.json` is the source of truth. Everything else is
generated from it.

```bash
npm run protocol          # regenerate TypeScript and Python
npm run protocol:check    # fail if either is stale - this runs in CI
```

To change a message:

1. Edit `protocol/schema/protocol.v1.json`
2. `npm run protocol`
3. Update `protocol/fixtures/protocol.v1.json` if you added a message
4. Run both contract tests - they read the same fixture

Do not hand-edit `mobile/src/types/protocol.ts` or `vest/thirdeye/protocol.py`.
They carry an `@generated` header and the check will fail.

**Compatibility rules.** Every message carries `v`. Unknown message types are
ignored rather than treated as errors, so either side can be upgraded
independently. `hello` carries the vest's protocol number and ring size, and the
phone mirrors both rather than hardcoding them.

## Tests and checks

```bash
npm run protocol:check           # from the repo root

cd mobile
npm run typecheck
npm run lint
npm test                         # 95 tests

cd ../vest
./.venv/bin/python -m pytest     # 68 tests
```

Two more need something running, so they are not in CI:

```bash
# the whole vest, end to end, with a file standing in for the camera
./.venv/bin/python scripts/smoke_test.py            # 30 checks

# the app, in a script, against a vest that is already running
./.venv/bin/python scripts/check_clip.py            # 17 checks
```

All of this runs on every push via `.github/workflows/ci.yml`.

The tests deliberately cover the things that are true whether or not there is a
phone in the room: the retention rules, the status mapping, log redaction, the
protocol contract in both languages, and the mock vest's behaviour under fake
timers. Rendering is not tested, because a snapshot of a component tree does not
tell you whether an umpire can read it in sunlight.

## Privacy

Third Eye points a camera at people who did not ask to be filmed, in order to
settle arguments about them. [`docs/PRIVACY.md`](docs/PRIVACY.md) is what the
system actually does with that footage, and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) is who might get at it.

The short version, all implemented and running:

- **Retention is enforced locally and by default.** The sweep runs on app start
  and after every clip. It needs neither the vest nor a network: if this phone
  never sees a vest again, the clips still expire on schedule.
- **Pinning a clip sets an expiry rather than removing one.** In most systems
  "starred" means "kept forever", and the moment that is true the promise stops
  holding for exactly the clips people care about most.
- **No microphone.** Not a cost saving - it removes an entire legal category,
  and snicko was never possible from twenty metres anyway.
- **App-private storage, never the camera roll**, and deliberately out of reach
  of the platform backup. Both platforms copy app-private files to the user's
  personal cloud by default - iCloud on iOS, Google Drive on Android - and both
  of those doors are now shut. Screenshots are blocked while a match is open,
  because a screenshot escapes every rule above.
- **Audio, location and media-library permissions are blocked outright**, not
  merely unrequested, so a future dependency cannot pull them back in.
- **An append-only audit trail** records what was deleted and when, without
  keeping what was deleted.

- **Every request to the vest is signed.** The Wi-Fi passphrase is printed on
  the vest where players can photograph it, so joining the network proves
  nothing; a request that is not signed with the pairing key is refused, as is a
  replayed one, and the control channel is refused before it opens. See
  `docs/decisions/0006-lan-transport-security.md`.

Two honest gaps, both documented rather than glossed over: **the clip bytes
themselves still cross the link unencrypted**, so signing says who may ask
rather than hiding the answer, and the retention sweep only runs when the app is
opened.

`docs/PRIVACY.md` section 8 lists five questions a league has to answer before
hardware is ordered. They are policy questions, not engineering ones.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Expo Go cannot find the dev server | `npx expo start --tunnel` |
| `npm install` fails on peer dependencies | Already handled by `.npmrc`; if you removed it, use `npm install --legacy-peer-deps` |
| Metro cache weirdness after a dependency change | `npx expo start --clear` |
| iPhone: Expo Go has no scan button | Use the built-in Camera app on the QR code |
| iPhone: clips show **Not here** after reopening the app | Expected. iOS may reclaim the cache directory; the app notices and tells you rather than showing a dot that lies. |
| No clips appear on the live screen | Settings -> check the mock vest is on and the speed is not **Frozen** |
| Clips arrive too slowly to demo | Settings -> mock speed **10s**. 40s is a real over's rhythm. |
| `Cannot find module 'babel-preset-expo'` | `npm install` in `mobile/` - it is a direct devDependency |
| Everything looks stale after editing the schema | `npm run protocol` from the repo root |

## Roadmap

| Phase | Name | Ends when |
|---|---|---|
| **1** | **Foundations and UI** | **Done.** All packages build, the app runs against a mock vest, and the umpire's control works end to end. |
| **2** | **Vest brings up** | **Done on a Pi.** Boots, records continuously, survives restarts. Software encoding, because a Pi 5 has no encoder; its own Wi-Fi is scripted but not yet run. |
| **3** | **The link** | **Done.** The phone reaches a real vest, markers arrive, a real file downloads and verifies. |
| **4** | **Buffer and cutting** | **Done.** A marker produces a correctly bounded clip, a missed start is recovered, and a marker past the buffer is refused rather than faked. |
| **5** | **Hardening** | **Mostly done.** Retry, resume, retention, signed requests, a watchdog for a recorder that stops without stopping. Left: an unattended soak, and an RTC so the clock cannot wipe the buffer. |
| 6 | Field trial | Two overs of a real fixture, measured miss rate. **This is the gate.** |
| 7 | Cloud and consent | Kept clips upload; retention policy decided; opt-in research retention exists |

Seven, not the spec's eight. Phase 5 was the Bluetooth remote, and there isn't
one.

### What is deliberately not on it

Automated decisions. In particular **no LBW trajectory projection**, which the
original spec called optically impossible at this pixel density and which
[ADR 11](docs/decisions/0011-roadmap.md) works through with the arithmetic. The
ball is six pixels at twenty metres, the camera is on a breathing chest, and the
error bars come out wider than the stumps. A wrong verdict would also discredit
the calls that *are* reliable.

Assistance is scoped but unscheduled, and starts with the **front-foot no-ball**
rather than ball tracking: the crease is one to two metres from the lens, the
call is fully objective, and it is the one club umpires get wrong most often.
None of it begins before Phase 6 passes.

One thing to settle before any of it: **the privacy model and model training are
in direct conflict.** "Nothing is kept" is what makes a league say yes, and you
cannot train on footage you deleted. That needs an explicit opt-in research
mode, which is a much larger consent conversation than the notice screen has
today.

### The next thing to do, and it is not code

Strap a phone to your chest and umpire two overs. Watch the footage.

An umpire's *eyes* track the ball; their chest does not. At the moment of impact
the bowler's-end umpire is often leaning, stepping aside, or already turning for
a run-out. If the pads left frame, they left frame, and no amount of software
fixes it. **If the impact zone is in frame 90% of the time, proceed. If it is
60%, this form factor does not work** and the answer is a stump-mounted or
tripod camera instead.

It is a one-afternoon test that either validates or kills the core assumption,
and it costs nothing. Do it before ordering hardware.

Phase 2 is also blocked on five hardware questions in
[`docs/SPEC.md`](docs/SPEC.md) section 11 - chiefly whether the ROCK 5C's radio
does 5 GHz AP mode and which GStreamer hardware encoder exists on the Radxa
image. If neither encoder is there, the entire timing budget collapses.

---

## Licence

All rights reserved for now; see [LICENSE](LICENSE). A licence will be chosen
before the first field trial. The code is published for review, not for reuse.
