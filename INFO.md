# Third Eye — build notes

**A replay system an umpire wears, with a twelve-ball memory that deletes itself.**

The software is finished and running. The only thing still pretending is the camera.

| | |
|---|---|
| Phone app | 7,100 lines of TypeScript |
| Vest service | 1,694 lines of Python |
| Checks passing | 54 phone · 33 vest · 20 end-to-end |
| Decisions recorded | 11 ADRs in [`docs/decisions/`](docs/decisions) |
| Fakes remaining | 1 — the camera |

---

## Contents

1. [The idea](#1-the-idea)
2. [How it actually works](#2-how-it-actually-works)
3. [The pieces](#3-the-pieces)
4. [Six decisions worth knowing](#4-six-decisions-worth-knowing)
5. [Privacy](#5-privacy)
6. [The bugs, and how each was caught](#6-the-bugs-and-how-each-was-caught)
7. [Proven vs. only written](#7-proven-vs-only-written)
8. [Running it](#8-running-it)
9. [What happens next](#9-what-happens-next)

---

## 1. The idea

> **The umpire's own eyes, on rewind, with nothing kept.**

A club cricket umpire decides from one angle, at speed, once. There is no replay.
Professional cricket solves that with a truck full of cameras; club cricket cannot.

So: the umpire wears a vest with a camera in it, and taps their phone twice a
ball — once as the bowler runs in, once when the ball is dead. Each delivery
becomes a short clip that lands on the phone during the thirty-odd seconds
before the next ball. When someone appeals, the clip is **already there**.
Nothing downloads, nothing buffers.

Then it is deleted. Anything older than twelve balls is erased unless the umpire
deliberately kept it.

### What it can and cannot settle

This matters more than the feature list, because it is where a project like this
normally oversells itself out of a league.

From twenty metres, through the chosen lens, the stumps are about **19 pixels
wide** and the ball is about **6**. At that size there is no ball tracking and no
trajectory projection, and there never will be from this position — see
[decision 5](#5-no-lbw-verdict-ever-from-this-camera).

**What it genuinely settles:**

- **Front-foot no-balls** — the crease is one to two metres from the lens, the
  sharpest thing in frame, and a fully objective call
- **Run-outs at the bowler's end**
- **Gross LBW errors** — pitched a foot outside leg, struck above the knee roll
- **The umpire's own memory** — half the value is being able to say "let me look
  again" instead of "I'm fairly sure"

---

## 2. How it actually works

```
   ┌──────────────────────┐                              ┌──────────────────────┐
   │         VEST         │                              │        PHONE         │
   │                      │ ◀───────── markers ───────── │                      │
   │  camera + computer   │      "keep 0:12 to 0:24"     │  the umpire's button │
   │  records NON-STOP    │                              │  the review player   │
   │  5-minute buffer     │                              │                      │
   │  its own Wi-Fi       │ ────────  clip files  ─────▶ │  holds 12 clips      │
   │                      │     ~9 MB, hash checked      │  then deletes them   │
   └──────────────────────┘                              └──────────────────────┘
              └──────────── no internet during a match ───────────┘
```

The vest makes its own Wi-Fi network and the phone joins it. Two channels: a
chat connection that stays open all match carrying tiny messages, and one file
download per ball.

### The idea that makes it robust

**Tapping the button does not start a recording.** The vest has been recording
the whole time, into a five-minute rolling loop that overwrites itself. A tap
just says *keep this bit*.

That one distinction buys three things:

- **Wi-Fi can drop and you lose nothing.** The taps queue on the phone and
  replay when the link returns. The footage was never conditional on the message
  arriving — the clip turns up late instead of never.
- **A missed tap is recoverable.** Forgot to press start? The ball is still in
  the buffer for five minutes. Under a design where the button *triggered*
  recording, it would simply be gone. This matters because missed taps cluster
  around the deliveries where something dramatic happened — which is exactly
  when a review gets called.
- **The pre-roll is free.** Every clip reaches five seconds back before the tap,
  so a late press still catches the run-up.

### One ball, second by second

```
  pre-roll │           ball in play            │ transfer │    nothing happening
 ──────────┼───────────────────────────────────┼──────────┼──────────────────────
    -5s    0s                                 12s        15s                  40s
           tap                                tap    on the phone       next ball
                                                       └──── 25s headroom ────┘
```

The transfer uses three of the roughly thirty available seconds. That margin is
the whole design: it is why the umpire never waits, and why the system can
afford to be slow and careful rather than fast and fragile.

---

## 3. The pieces

### The vest — 1,694 lines of Python

| Module | What it does |
|---|---|
| `capture/recorder.py` | One **ffmpeg** process writing one-second segments, started at boot and never stopped. Supervised: if it dies it restarts, and the fact that it died reaches the health report — a capture pipeline that stops *quietly* is the worst failure this system has. |
| `capture/buffer.py` | Indexes those segments and answers two questions: which cover this window, and **is the window still here at all**. The second is answered honestly — a tap whose footage has been overwritten is *refused*, not turned into a short clip that looks fine. |
| `capture/cutter.py` | Joins the covering segments into one file. A **stream copy, never a re-encode**: re-encoding forty seconds of 1080p would spend the entire between-balls budget. Copying is near-instant and the picture is bit-identical. |
| `storage/clip_store.py` | Hashes each clip with SHA-256, writes a metadata sidecar, keeps twelve. Two exceptions: pinned clips, and clips the phone has never confirmed — at that moment the vest holds the **only** copy. |
| `api/` | A WebSocket for messages, plain HTTP with **resume** for the files. Resume is not a nicety: restarting a nine-megabyte transfer because someone walked behind a sightscreen would not fit in the gap. |

### The phone — 7,100 lines of TypeScript

| Part | What it does |
|---|---|
| `components/DeliveryBar.tsx` | One large toggle pinned to the bottom of the screen, in the same place on the clip list **and** the review player — so a bowler running in while you look at the last ball cannot catch you on the wrong screen. A toggle, not two buttons, because a toggle cannot be pressed in the wrong order. |
| `stores/deliveryStore.ts` | Every tap is written to the phone's database **before** anything is sent. Sending is a separate step that is allowed to fail. This is what makes an outage survivable. |
| `stores/connectionStore.ts` | Taps are stamped in the **vest's** clock, not the phone's, worked out from the heartbeat. It keeps the sample with the shortest round trip rather than the newest — a slow reply means more uncertainty about when the vest read its clock. |
| `net/httpDownloader.ts` | Bytes land in a `.part` file that becomes a real `.mp4` only once its length **and** its hash both match. A crash can leave a partial file; it can never leave a broken clip the list calls ready. |
| `app/live.tsx` | Twelve rows, newest first, each with a status dot. Nothing else — no score, no over count, nothing to correct. |
| `app/clip/[seq].tsx` | Two buttons (step back, step forward); tap the video to play. Speed, reference lines and the decision each sit behind one word. |

### The one fake

There is no camera and no vest hardware yet, so the vest software takes its
pictures from a setting:

```bash
THIRDEYE_SOURCE=file:sample.mp4        # a laptop, today
THIRDEYE_SOURCE=camera:/dev/video0     # the vest, later
```

Everything downstream — buffer, cut, hash, link, download, player — is
production code either way. **The camera is the last fake to be removed, not the
first.**

> [!NOTE]
> **The most important pixel** is the status dot:
> **● filled green** = *Ready* · **◐ half amber** = *Getting it* · **○ hollow grey** = *Not here*
>
> Three signals for one fact — colour, shape and word — so it survives colour
> blindness and direct sunlight. It exists because the umpire must know a clip is
> there **before** announcing a review. Announcing one and then finding nothing,
> while twenty-two people watch, is the worst thing this product can do.

---

## 4. Six decisions worth knowing

All eleven are written up in [`docs/decisions/`](docs/decisions). These shaped
everything else.

### 1. The button moved into the app

The original plan had a Bluetooth remote in the umpire's hand. That is better
ergonomics — you can press it blind, in the rain, while the other arm signals —
and it is gone, along with a firmware toolchain, a second battery and a whole
phase of work.

The catch nearly went unnoticed. The remote reached the vest by *Bluetooth*, and
the vest reached the phone by *Wi-Fi* — two independent paths. Merging them meant
a Wi-Fi drop would stop the vest ever learning a ball was bowled. That is why the
vest now records continuously: it puts the independence back, and improves on it.

→ [ADR 8](docs/decisions/0008-remote-moves-into-the-app.md), [ADR 9](docs/decisions/0009-continuous-buffer.md)

### 2. Keeping a clip sets an expiry, it does not remove one

In most software, starring something means keeping it forever — and the moment
that is true, the retention promise stops holding for exactly the clips people
care about most. Pinning here sets a delete-by date seven days out. It buys the
clip time, not permanence, and lets the app tell a player something specific.

→ [ADR 5](docs/decisions/0005-pin-sets-an-expiry.md)

### 3. One repository, one definition of the messages

The vest speaks Python, the phone speaks TypeScript, and both need the same
message definitions. Writing them twice is where protocol bugs live. Instead
there is **one JSON Schema file**, and a generator writes both languages from it.
A change only one side was told about is now a build error, not a Saturday
afternoon.

→ [ADR 1](docs/decisions/0001-monorepo-with-generated-protocol.md)

### 4. Real builds instead of a preview app

Development used Expo Go, where your JavaScript runs inside *Expo's* app
container with Expo's permissions — which means none of this app's privacy
configuration was ever switched on. Moving to real builds made it testable, and
immediately found two things ([section 6](#6-the-bugs-and-how-each-was-caught)).

→ [ADR 10](docs/decisions/0010-development-builds.md)

### 5. No LBW verdict. Ever, from this camera.

A phase proposing "likely out / likely not out" was cut. The arithmetic:

- the ball is **6 pixels**
- projection needs the camera's position relative to the pitch, and **the camera
  is on a breathing, leaning chest**
- a one-pixel error at twenty metres is several centimetres, and it compounds
- real DRS uses six fixed, calibrated cameras at 340 fps; this is one moving
  camera at 60

**The error bars come out wider than the stumps.**

The second reason costs more than the first: a wrong verdict discredits the calls
that *are* reliable. And it cannot be validated — marginal LBWs have no ground
truth, which is what makes them marginal. Notice that the calls you *can*
validate are the objective ones, which are the same calls this camera can detect.

What replaces it later is an **annotated evidence frame** — impact, stump line,
pad position. Everything measured, nothing projected. The umpire still decides.

→ [ADR 11](docs/decisions/0011-roadmap.md)

### 6. When assistance does come, it starts with the no-ball

Not ball tracking, which is the hardest thing on the list. The crease is one to
two metres from the lens, the foot is hundreds of pixels, the popping crease is a
straight white line. It is fully objective, checkable frame by frame, and the
call club umpires get wrong most often.

> [!WARNING]
> **A conflict to settle first.** The privacy model and any future AI are
> incompatible. "Nothing is kept" is what makes a league say yes — and you cannot
> train a model on footage you deleted. That needs an explicit, opt-in research
> mode, which is a far bigger consent conversation than the app has today. It is
> scheduled as a decision *before* any model work, not halfway through it.

---

## 5. Privacy

This points a camera at people who did not ask to be filmed, in order to settle
arguments about them. "Nothing is kept" is what makes a committee say yes — which
means if it is not *literally* true, the product is dishonest rather than merely
buggy.

Full design in [`docs/PRIVACY.md`](docs/PRIVACY.md). What is actually implemented:

| Control | How |
|---|---|
| **No microphone** | Picture only, and not to save money. Washington State treats recording a private conversation far more seriously than filming in public, and a chest mic twenty metres from the bat catches nothing about the cricket and a lot said between two players. The permission is **blocked outright**, not merely unrequested, so no future dependency can pull it back. |
| **Deletion is local and automatic** | The sweep runs on app start and after every clip. It needs neither the vest nor a network: **if this phone never sees a vest again, the clips still expire on schedule.** |
| **Out of the platform backup** | Both operating systems copy app-private files to the owner's personal cloud by default. Both doors are now shut. |
| **Screenshots blocked** | A screenshot escapes every rule above and lands in a camera roll. Blocked while a match is open, including the app-switcher preview. |
| **Nothing identifies anyone** | A match is a date and a ground. No names, no teams, no scores. |
| **An audit trail** | A system that deletes evidence must be able to say *what* it deleted and when. A timestamp, an event type, a ball number. No frames, no names. |

The built app asks for exactly two things: the **camera**, to read one pairing
code, and the **local network**, to reach the vest. CI asserts that on every
push, because the realistic failure is a library quietly adding a permission back
in a version bump and nobody re-reading a generated file.

> [!WARNING]
> **Two gaps, stated rather than glossed over.**
>
> **The Wi-Fi network is currently the trust boundary.** Any phone that joins the
> vest's network can request clips. Signing every request closes it, and the
> field for that key already exists — so it is an implementation, not a redesign.
>
> **The deletion sweep only runs when the app is opened.** Clips are still
> app-private and still vanish on uninstall, but the promise says "after seven
> days", not "after seven days if you open the app".

---

## 6. The bugs, and how each was caught

Every one of these passed "it compiles". None were caught by a type checker.

### Two that made the documentation false

**iOS was copying match footage to iCloud.** Everything in an app's Documents
folder is backed up automatically. Clips would have synced to the umpire's
personal iCloud with nobody doing anything wrong — quietly contradicting "it
stays on this phone". Clips moved to a folder the system excludes from backup.

**Android was copying them to Google Drive.** The same hole through a different
door; automatic backup defaults to on. Now off.

Both are *defaults*. Neither is exotic. Both were found by asking "where does
this file actually end up?" rather than trusting that "app-private" meant what it
sounded like.

### Two the first real build revealed

Moving off the preview app immediately showed the shipped binary declaring a
**microphone** permission (added by the camera library) and a **Face ID** one
(added by the secure-storage library). The documentation claimed the microphone
was impossible to request. It was not. Both removed; CI now checks.

### One that only appeared when the two halves met

The vest worked. The phone worked. Connected together, the vest started refusing
to cut clips for deliveries it was definitely holding.

The cause: segment start times were calculated as `index × one second`. But
ffmpeg cuts on keyframes, so real segments run slightly long — **and the error
accumulates**. After three minutes the vest's idea of the time had drifted
**fifteen seconds** behind the wall clock.

The failure mode is the ugly kind. Nothing errored, the health check looked
healthy, and the unit tests passed *because they wrote perfect one-second
segments*. Segment times now come from what the filesystem actually recorded.
Drift went from fifteen seconds to under one, and the tests use varying lengths,
because uniform ones are precisely what hid it.

### And three smaller ones

- **Resume was broken while downloading worked.** Partial-content requests built
  the wrong kind of response object. Only a real transfer would have shown it.
- **A repeat-on-hold timer** lived in a plain variable that reset on every
  redraw, so it leaked and could keep firing after your finger lifted.
- **A stale build killed the entire app** rather than one feature, because a
  library was imported at the top of a file everything else depends on. It now
  loads at the point of use.

---

## 7. Proven vs. only written

"It compiles" and "it works" are different claims. This is the line between them.

### ● Proven, by running it

| Check | Result |
|---|---|
| **The whole loop, end to end** | Vest recorded, cut 15.0s on a marker, served it; app downloaded, hash-verified and committed it — **byte-for-byte identical**, probing as real 1920×1200 60fps video |
| Resumed download | Two partial requests reassemble exactly |
| A missed start tap | Recovered from the buffer |
| A tap older than the buffer | Refused, not turned into an empty clip |
| **Deletion after twelve balls** | 16 clips seeded on a device; the app's own sweep left the 12 newest plus one kept and one reviewed |
| Database migration on a device | Correct schema and version |
| The app runs on iOS | Real build, launches, screens render |
| Permissions of the shipped app | Camera and local network only |
| Tests | 54 phone, 33 vest, 20 end-to-end checks |

### ○ Not proven — and honestly so

| What | Why it matters |
|---|---|
| **Frame-accurate stepping** | The library documents exact seeking and the sample clip is built to prove it by eye. Ten seconds of tapping settles it. |
| **Tapping the button** | Taps could not be simulated, so markers were sent over the wire exactly as the app sends them. Receive and download are proven; the send path is verified by code only. |
| **Whether the camera sees the ball** | The one that can invalidate everything. See [section 9](#9-what-happens-next). |
| Any real hardware | No vest exists. The software is written for it and runs against a file. |

---

## 8. Running it

No hardware, no paid accounts.

```bash
# terminal 1 — the vest, with a video file for a camera
cd vest
THIRDEYE_SOURCE=file:../mobile/assets/mock/sample.mp4 \
  ./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000

# terminal 2 — the app
cd mobile
npx expo run:ios          # or --device for a real iPhone
```

Then in **Settings**, turn the mock vest *off* to talk to the real service. Leave
it on and the app fakes the vest entirely, which needs nothing running at all.

### Your own footage

The bundled clip is a test pattern — right for checking frame stepping, useless
for judging whether the camera angle works.

```bash
./scripts/add-footage.sh over1.mp4     # into the simulator
./scripts/add-footage.sh --clear       # back to the test pattern
```

On a real phone: **Settings → Your own footage → Add a video**. It goes through
the system file picker, not your photo library, so the app never asks for access
to your photos.

Large videos make the app sluggish; shrink anything over ~200 MB first:

```bash
ffmpeg -i chest-cam.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -an over1.mp4
```

### Worth trying deliberately

- **Forget to end a ball.** Tap once and leave it. After forty seconds the
  delivery closes itself and the next tap starts cleanly.
- **Turn Wi-Fi off mid-over**, tap through two more deliveries, then turn it back
  on. The bar says how many taps are waiting *and that the footage is safe*, and
  the clips arrive late rather than never.

---

## 9. What happens next

Seven phases. Three are done. One of the remaining ones is not code.

| | Phase | State |
|---|---|---|
| ● | Foundations and the app | Done |
| ○ | Vest hardware brings up | **The only one needing hardware** |
| ● | The link | Built and proven with a file for a camera |
| ● | Buffer and cutting | Built and proven |
| ○ | Hardening — signed requests, retry | Next |
| ○ | Field trial | **The gate** |
| ○ | Cloud and consent | After the gate, deliberately |

> [!IMPORTANT]
> **Do this before ordering hardware.**
>
> Strap a phone to your chest and umpire two overs. Watch it back.
>
> An umpire's *eyes* track the ball. Their chest does not. At the moment of
> impact the bowler's-end umpire is often leaning, stepping aside, or already
> turning for a run-out — and if the pads left the frame, they left the frame. No
> amount of software fixes that.
>
> **If the impact zone is in frame 90% of the time, everything above is worth
> continuing. If it is 60%, this form factor does not work** and the answer is a
> stump-mounted camera. One afternoon, costs nothing, and it either validates or
> kills the core assumption.

You can now drop that footage straight into the app and review it through the
real player — which is exactly the workflow the test needs.

Phase 2 is also blocked on two hardware measurements: whether the board's radio
can host its own 5 GHz network, and whether a hardware video encoder exists on
its operating system image. If the second one is missing, encoding falls to the
processor and the entire timing budget collapses.

---

## Where to look in the code

| | |
|---|---|
| [`mobile/src/app/live.tsx`](mobile/src/app/live.tsx) | Where the umpire spends the match, and the four rules that hold it together |
| [`mobile/src/lib/delivery.ts`](mobile/src/lib/delivery.ts) | The delivery state machine, as pure functions |
| [`mobile/src/privacy/rules.ts`](mobile/src/privacy/rules.ts) | The retention promise, as pure functions. If these are wrong, the product's main argument is a lie. |
| [`vest/thirdeye/capture/buffer.py`](vest/thirdeye/capture/buffer.py) | Whether a delivery still exists |
| [`protocol/schema/protocol.v1.json`](protocol/schema/protocol.v1.json) | The only definition of the wire format |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | What happens to footage of people who did not ask to be filmed |
