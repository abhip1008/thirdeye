# Third Eye

**An umpire-worn replay system for club cricket.**

The umpire wears a vest with a camera in it. A two-button remote in their hand
marks the start and end of each delivery. Every ball becomes a short video clip
that is pushed to the umpire's phone during the thirty-odd seconds before the
next ball. When a review is called, the clip is already on the phone. There is
nothing to download and nothing to wait for.

Clips older than twelve balls are deleted automatically unless someone kept them.

> The umpire's own eyes, on rewind, with nothing kept.

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
| **Zero operator burden** | Nobody starts or stops a recording. Two button presses per ball, with the hand that is already counting. |
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
  UMPIRE          ON-BODY UNIT              LINK             REVIEW APP        AFTER MATCH
    |                                                                          (offline
    |                                                                           during play)
 [Remote] --BLE--> [ ROCK 5C + AR0234 ] ==Wi-Fi==> [ Android phone ] ------> [ Cloud ]
                    - GStreamer capture  CONTROL    - React Native           - FastAPI
                    - Pre-roll ring      (WebSocket)- SQLite                 - optional
                    - Clip cutter        FILES      - 12-clip store          - deferred
                    - FastAPI + nginx    (HTTP)     - Review player
```

**One delivery:**

```
t=0s     Umpire presses START as the bowler turns.
         The clip opens, reaching 3 seconds back into the pre-roll ring,
         so a late press still catches the run-up.
t=12s    Ball is dead. Umpire presses END. The file is already valid.
t=12.4s  Vest announces the clip over the WebSocket.
t=15s    Phone has the 9.5 MB, verifies the hash, commits it.
t=40s    Next ball.
```

The transfer uses 3 of the 30 to 40 available seconds. That is the whole design.

**A review:** the umpire opens the app, sees twelve clips with status dots, taps
one, and it plays instantly. Technology consumes about two seconds of the ninety
a review takes. Everything else is the umpire looking at the ball, which is the
part that must not be rushed.

---

## Current status

**Phase 1 of 8 is complete.** Every package exists and builds, and the app runs
on a phone with every screen working against a mock vest. There is no hardware
yet, and none is needed to use the entire product.

### What is verified

| Check | Result |
|---|---|
| TypeScript, strict mode, unused locals and params on | 0 errors |
| ESLint | clean |
| Tests | 30 mobile, 10 vest, all passing |
| Android production bundle | exports, 4.3 MB, sample clip included |
| Expo Router route discovery | all 8 routes found under `src/app` |
| Protocol generator | TypeScript and Python regenerate byte-identical |
| Golden fixture | parses on both sides; three malformed shapes rejected on both sides |
| Sample clip | exactly 900 frames, 60 fps, 1920x1200 |
| Vest `/api/health` | responds with the expected shape |

### What is *not* verified, and needs a phone

This is the honest list. None of it is known-broken; none of it has been run on
a device.

- **On-device rendering.** Layout was written to the constraints, not measured
  on a screen.
- **The SQLite migration actually running.** `expo-sqlite` is native, so the
  migration path has never executed. This is the most likely thing to bite.
- **Frame-accurate stepping in practice.** `expo-video` documents exact seeking
  by default, and the sample clip is built to prove it by eye - but it has not
  been proven yet. This is the single most important thing to check first.
- **The native privacy controls.** SecureStore, screen-capture blocking and
  keep-awake are all best-effort wrappers that have not been exercised.
- **QR scanning** in the pairing flow.
- **Expo Go compatibility** for `expo-video` and `expo-secure-store`. Both ship
  in the Expo Go client for SDK 57, so this should be fine, but it is an
  assumption rather than an observation.

Everything above is a Phase 1 acceptance item. Work through
[the tour](#a-five-minute-tour) on a real device and you will have covered it.

---

## Running it

### What you need

- **Node 20 or newer** and npm
- **Python 3.11+**, only if you want to run the vest scaffold
- **An Android phone** with the free **Expo Go** app from the Play Store, and
  the phone on the same Wi-Fi as your computer

You do **not** need Android Studio, the Android SDK, or any hardware.

### The app

```bash
git clone https://github.com/abhip1008/thirdeye.git
cd thirdeye/mobile
npm install
npx expo start
```

A QR code appears in the terminal. Open **Expo Go** on the phone and scan it.
The app builds and opens in about thirty seconds.

> **If the phone cannot reach your computer** (guest Wi-Fi, VPN, corporate
> network), run `npx expo start --tunnel` instead. It is slower but routes
> around the network.

There is no vest, so the app runs against `MockTransport`, a fake vest that
bowls on a timer, occasionally drops a delivery, and produces timeouts and
recovered clips at a realistic rate. **Settings** controls its speed.

### The vest scaffold

Phase 1 is a health endpoint and the generated protocol models - enough to prove
the toolchain and give Phase 3 something to point at.

```bash
cd thirdeye/vest
python3 -m venv .venv
./.venv/bin/pip install -e '.[dev]'
./.venv/bin/python -m pytest              # 10 tests
./.venv/bin/uvicorn thirdeye.main:app --reload
curl -s localhost:8000/api/health
```

### The remote firmware

Nothing to run. `remote/include/protocol.h` defines the seven-byte BLE event
format and is the only file Phase 1 needed. Firmware is Phase 5.

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

**4. Watch the live screen fill.** This is where the umpire spends the match.
Within a few seconds you should see:

- **RECORDING** appear and disappear as the mock vest bowls
- the over.ball counter tick up
- clip rows arriving at the top, each moving through
  *Waiting* -> *Getting it* -> *Checking* -> **Ready**
- roughly one delivery in twelve producing no clip at all, or a **Not here** row
- badges for *Timed out*, *Recovered* and *Grabbed*
- after twelve balls, the oldest clip dropping off the bottom

The **status dot** is the point of the whole screen, not decoration. An umpire
must be able to see that a clip exists *before* announcing a review. Announcing
a review and then discovering a grey dot is the worst thing that can happen to
this product on a field.

Also try:
- **Pull down** to force a resync. Umpires do this reflexively when unsure, so it
  does something real.
- **Tap the counter** to correct the over and ball inline. It will drift - the
  phone counts button presses and the vest has no idea what a wide is.
- **Long-press a row** for Keep / Try again. Note that nothing covers the list:
  no modal ever appears on this screen. If an umpire has to dismiss a dialog
  while a captain is arguing with them, the product has failed.

**5. Open a clip.** Tap any **Ready** row. This is the screen that matters most,
and the one thing worth checking carefully:

- Press **+1** and **−1**. The yellow marker in the black bar at the bottom of
  the video should move by exactly one step per press, and the counter in the
  top-right corner should advance by one. **If it jumps several frames or does
  not move, frame stepping is not exact and that is a Phase 1 blocker.** The
  clip is synthetic precisely so this is checkable by eye.
- Hold **+1** to repeat.
- Drag the scrubber. The frame readout under it tells you where you are.
- Try **1/4x** and **1/8x**.
- Toggle **Stump line** and **Bail height** and drag them with one thumb. They
  are per clip, not global: two deliveries are filmed from two slightly
  different chest angles, and a line carried over from the last one is worse
  than no line at all.
- Tap **Out**, **Not out** or **Unclear**. This writes to the decision log,
  marks the clip reviewed, and keeps it. This is not a formality - the decision
  log is what a league looks at after a season, and it is the only thing that
  survives when the video does not.

**6. Check the privacy panel.** Settings -> the grey box at the top says exactly
what is on the phone right now and for how long. This is the answer to the only
question anyone outside the project ever asks.

**7. End the match.** Tap **End** on the live screen. The summary shows what was
recorded, what was reviewed, and what was kept. The primary action deletes
things, which is unusual and deliberate: the promise made to twenty-two players
comes due the moment the match ends, and it should take one tap.

**8. The real acceptance test.** Hand the phone to someone non-technical and
have them tap through it. If they understand the product, Phase 1 is done.

---

## What is in this repository

```
thirdeye/
├── protocol/   the wire format, and the generator that keeps both sides honest
├── mobile/     the review app - React Native, Expo, TypeScript, Android first
├── vest/       on-body capture unit - Python, FastAPI, GStreamer      (scaffold)
├── remote/     BLE button remote - C++, PlatformIO, ESP32-C3          (scaffold)
├── cloud/      optional post-match sync - FastAPI                     (deferred)
└── docs/
    ├── SPEC.md          the full design and build plan, all 8 phases
    ├── PRIVACY.md       data inventory, retention, the open questions
    ├── THREAT_MODEL.md  assets, adversaries, and the one real hole
    ├── SCALING.md       what is already paid for, and what breaks first
    └── decisions/       six ADRs, including every place this deviates from the spec
```

One repository rather than four, because the vest and the phone describe the
same wire format in two languages and the gap between them is where protocol
bugs live. See [ADR 1](docs/decisions/0001-monorepo-with-generated-protocol.md).

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
npm test                         # 30 tests

cd ../vest
./.venv/bin/python -m pytest     # 10 tests
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
- **App-private storage, never the camera roll.** Screenshots are blocked while
  a match is open, because a screenshot escapes every rule above.
- **Audio, location and media-library permissions are blocked outright**, not
  merely unrequested, so a future dependency cannot pull them back in.
- **An append-only audit trail** records what was deleted and when, without
  keeping what was deleted.

Two honest gaps, both documented rather than glossed over: **the access point is
currently the trust boundary** until the Phase 6 request signing lands, and the
retention sweep only runs when the app is opened.

`docs/PRIVACY.md` section 8 lists five questions a league has to answer before
hardware is ordered. They are policy questions, not engineering ones.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Expo Go cannot find the dev server | `npx expo start --tunnel` |
| `npm install` fails on peer dependencies | Already handled by `.npmrc`; if you removed it, use `npm install --legacy-peer-deps` |
| Metro cache weirdness after a dependency change | `npx expo start --clear` |
| No clips appear on the live screen | Settings -> check the mock vest is on and the speed is not **Frozen** |
| Clips arrive too slowly to demo | Settings -> mock speed **10s**. 40s is a real over's rhythm. |
| `Cannot find module 'babel-preset-expo'` | `npm install` in `mobile/` - it is a direct devDependency |
| Everything looks stale after editing the schema | `npm run protocol` from the repo root |

## Roadmap

| Phase | Name | Ends when |
|---|---|---|
| **1** | **Foundations and UI** | **Done.** All packages build; the app runs on a device against mock data. |
| 2 | Vest brings up | ROCK boots, makes its own Wi-Fi, records with hardware encoding |
| 3 | The link | Phone connects to a real vest, WebSocket stays open, downloads a real file |
| 4 | Clipping and pre-roll | A button press produces a correctly bounded clip with 3s of pre-roll |
| 5 | The remote | Real ESP32, real buttons, both recovery paths |
| 6 | Hardening | Retry, resume, retention, health, request signing, survives a pulled cable |
| 7 | Field trial | Two overs of a real fixture, measured miss rate |
| 8 | Cloud | Pinned clips upload after the match |

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
