# Third Eye, explained

Everything about this project, from the top, in plain language.

No prior knowledge assumed. If you know what cricket is and roughly what a phone
app does, this will make sense. Where something is technical, it is explained
before it is used.

> **How this differs from the other documents.** [`README.md`](README.md) is how
> to run it. [`INFO.md`](INFO.md) is the build notes — what was done and why.
> This one is how the whole thing actually works.

---

## Contents

1. [The problem](#1-the-problem)
2. [What Third Eye is](#2-what-third-eye-is)
3. [The one idea that makes it work](#3-the-one-idea-that-makes-it-work)
4. [One ball, second by second](#4-one-ball-second-by-second)
5. [The hardware](#5-the-hardware)
6. [The vest software](#6-the-vest-software)
7. [The phone app](#7-the-phone-app)
8. [The language between them](#8-the-language-between-them)
9. [Proving who you are](#9-proving-who-you-are)
10. [Time, and why it is hard](#10-time-and-why-it-is-hard)
11. [When things go wrong](#11-when-things-go-wrong)
12. [Privacy](#12-privacy)
13. [The test footage](#13-the-test-footage)
14. [Setting it up](#14-setting-it-up)
15. [What is proven, and what is not](#15-what-is-proven-and-what-is-not)
16. [What is left](#16-what-is-left)

---

## 1. The problem

In professional cricket, a disputed decision goes to a third umpire who watches
a replay. In club cricket there is no replay. There is one umpire, standing
twenty metres away, who saw the ball for about a tenth of a second and now has
twenty-two people waiting for an answer.

Most of those arguments are not about difficult judgement calls. They are about
**whether the ball carried to the fielder**, **whether the bat touched it**, or
**whether the bowler's foot was behind the line**. Those are things a camera
settles instantly and an unaided eye often cannot.

The obstacle has never been cameras. Phones have good cameras. The obstacle is
that reviewing footage normally means: stop the game, find the phone, find the
file, scrub through it, and eventually give up because the next ball is due.

**Third Eye's goal is that the clip is already on the umpire's phone before
anyone asks for it.**

---

## 2. What Third Eye is

Three things:

1. **A vest** the umpire wears, with a small camera in the chest and a computer
   the size of a deck of cards.
2. **An app** on the umpire's phone.
3. **A private Wi-Fi network** the vest creates, which only the phone joins.

The umpire taps their phone once as the bowler runs in, and once when the ball is
dead. Within a few seconds a video clip of that delivery appears on the phone,
ready to watch and step through frame by frame.

Clips older than twelve balls delete themselves automatically.

There is no internet involved. There is no cloud. During a match the phone talks
to the vest and to nothing else in the world.

---

## 3. The one idea that makes it work

This is the part worth understanding properly, because everything else follows
from it.

**The camera never stops recording.** From the moment the vest is switched on it
is filming continuously, whether or not anyone taps anything.

It keeps the **last five minutes** on disk and throws away everything older,
continuously. Think of a whiteboard five minutes wide: new video is written on
the right-hand edge, and the left-hand edge is being wiped at exactly the same
speed.

So when you tap **Start the ball**, the vest does not start recording. It
**writes down the time**. And when you tap again, it writes down that time too.
Then it goes back into video it *already has* and cuts out that stretch.

If you have used live TV that can be paused and rewound, it is exactly that. The
box is always recording; pressing "record" only decides what to keep.

**Three things fall straight out of this, and none of them are possible any
other way:**

**You get the run-up.** The clip starts five seconds *before* your tap. You could
never have that if recording began when you tapped, because you cannot tap before
you have seen the bowler move — and by then the run-up has already happened.

**Losing the connection does not lose the ball.** If the Wi-Fi drops for an over,
your taps are saved on the phone and sent when it comes back. The footage is
still there, because recording was never conditional on the message arriving.

**Forgetting to tap is recoverable.** Miss the start? The vest reaches backwards
into the five minutes and cuts anyway.

The cost is a real one and worth stating: **the camera is filming everyone in
front of it the whole time the vest is on**, not only during deliveries. That is
why [privacy](#12-privacy) is a section rather than a footnote.

---

## 4. One ball, second by second

A single delivery, all the way through.

| Time | What happens |
|---|---|
| **−300s to now** | The vest has been recording continuously. The last five minutes sit on its disk as ~300 one-second files. Every second, one new file is written and the oldest is deleted. |
| **0s** | The bowler starts walking back. The umpire taps **Start the ball**. |
| | The phone writes the tap into its own database **first** — before trying to send it. If everything else fails, the tap is not lost. |
| | The phone sends the tap to the vest. The vest notes the time and does nothing else. It was already recording. |
| **+13s** | The ball is dead. The umpire taps again. |
| **+13.1s** | The vest works out the window: from **five seconds before the first tap** to the second tap. About eighteen seconds. |
| | It finds the ~18 one-second files covering that window and **joins them together**. It does not re-compress anything — it copies the video across, which takes a fraction of a second rather than a minute. |
| **+13.5s** | The vest calculates a **fingerprint** of the finished file (a SHA-256 hash — a short string that changes completely if even one byte of the file differs). |
| | It announces to the phone: *clip 4 is ready, it is 9.5 MB, here is its fingerprint.* |
| **+14s** | The phone starts downloading. It writes the bytes into a temporary file, deliberately not named like a real clip. |
| **+17s** | Download finishes. The phone calculates the fingerprint of what it received and compares. |
| | **Match** → the temporary file is renamed to a real clip and appears in the list as **Ready**. **No match** → the file is deleted and the download is retried. A file that failed its fingerprint is not a head start; it is a file nobody can account for. |
| **+17s** | The clip is on the phone, playable instantly. The next ball is still fifteen seconds away. |

The whole transfer uses about three of the thirty-odd seconds between balls.
That margin is the entire design budget.

---

## 5. The hardware

### What is in the vest today

- **A Raspberry Pi 5** — a small computer, roughly the size of a deck of cards.
- **An Arducam OV5647 camera** — a small sensor on a ribbon cable, mounted at
  chest height.
- **A battery pack** to run it.

### What it records

**1296 × 972 at 30 frames a second.** That is a deliberate choice over the
seemingly better 1920 × 1080, and the reason is worth knowing: on this particular
sensor, 1080p is not the full picture — it is a **crop from the middle**. You get
more pixels over a narrower view.

For a camera strapped to someone's chest, trying to keep the ball in shot, **field
of view is worth more than pixel count**. The wider mode also allows a higher
frame rate, and for reviewing a fast ball, more frames per second matters more
than more pixels per frame.

### The thing that limits quality

Not resolution. **Frame rate and motion blur.**

At 30 frames a second there is a 33-millisecond gap between frames, and a cricket
ball travels about a metre in that time. If you need to know whether the ball
touched the bat, the moment of contact may simply fall between two frames.
Television settles those arguments by shooting at 300+ frames a second with a
very fast shutter — not because it is higher resolution.

### The production plan

The Pi is a prototype. The intended final board is a **Radxa ROCK 5C with an
AR0234 sensor**, for two reasons:

- The AR0234 is a **global shutter** sensor. The Pi's camera is **rolling
  shutter**, which reads the image line by line, so fast motion comes out skewed.
  Fine for proving the system works; not fine for judging a ball.
- The ROCK 5C has a **hardware video encoder**. A Pi 5 does not — Raspberry Pi
  removed it — so every frame is compressed by the main processor, which uses
  roughly a third of a core continuously and generates heat in an insulated vest.

---

## 6. The vest software

Written in Python. Runs automatically when the vest is switched on, with nothing
to type. Five parts:

### The recorder

Runs the video-capture program and never stops it. Its important property is that
it is **supervised rather than trusted**:

- If the capture process dies, it is restarted.
- If the capture process is *alive but has stopped producing video* — which
  really happens — a **watchdog** notices within ten seconds and rebuilds the
  whole pipeline.

That second one is the interesting case. Early on, the vest reported itself as
"recording" for twelve minutes while writing nothing at all, because the only
question it asked was whether the program was still running. **A process that
exists is not a camera that records.** It now measures whether video is actually
arriving on disk.

### The buffer

Manages the five-minute window. Answers two questions:

1. *Which files cover this stretch of time?*
2. *Is that stretch still here at all?*

The second one is answered honestly. If a tap arrives too late and the footage
has been overwritten, the vest **refuses** and says so, rather than handing back
an empty or approximate clip. An umpire reviewing the wrong ten seconds is worse
than an umpire told "that one's gone".

### The cutter

Joins the files covering a delivery into one video. It **copies** the compressed
video rather than re-compressing it, which is why a clip is ready in under a
second instead of taking a minute.

### The clip store

Hashes each finished clip, records what was measured from the file (resolution,
frame rate, codec — measured, not assumed), and keeps the most recent twelve.

Two exceptions to the twelve: a clip the umpire **kept**, and a clip the phone
has **not yet confirmed receiving** — because at that moment the vest holds the
only copy in existence.

### The server

Two ways to talk to the vest, on the same connection:

- **A WebSocket** — an open two-way channel, used for short messages: *a clip is
  ready*, *I am marking a delivery*, *are you still there*.
- **Plain HTTP** — used for the video files themselves, and **resumable**: if a
  download is interrupted at 60%, it continues from 60% rather than starting
  over. That is not a nicety. Restarting nine megabytes because someone walked in
  front of the umpire would not fit in the gap between balls.

---

## 7. The phone app

Written in TypeScript with React Native, which means one codebase runs on both
iPhone and Android.

### The screens

| Screen | What it is for |
|---|---|
| **Pair** | Connect to a vest, once per season. Scan a code, or type the address and key. |
| **Notice** | What Third Eye records, written to be read aloud in fifteen seconds to a player who asks. |
| **Setup** | Name the ground, start a match. |
| **Live** | Where the umpire spends the match: the list of clips, and one large button. |
| **Review** | Watch a clip, step through it frame by frame, record a decision. |
| **Settings** | Retention, the vest, developer tools, and deleting everything. |
| **Diagnostics** | Link detail, the message log, the audit trail. |

### The one button

The delivery control is a **toggle**, not two separate buttons, pinned to the
bottom of the screen in the same place always. A toggle cannot be pressed in the
wrong order. It is deliberately **absent from the review screen** — a large button
underneath a video someone is studying is a button they will eventually hit by
accident, which would start a delivery that is not happening and end the one that
is.

### The rule the app is built on

**Every tap is written to the phone's own database before anything is sent.**
Sending is a separate step that is allowed to fail.

This is what makes an outage survivable. The tap exists the instant your finger
leaves the glass; whether the vest heard about it is a different question with a
different answer.

### Downloading

Bytes land in a temporary file that only becomes a real clip once its **length
and its fingerprint both match** what the vest announced. A crash can leave a
partial file behind; it can never leave a broken clip the list calls ready.

### Deleting

The deletion sweep runs when the app opens and after every clip. It needs neither
the vest nor a network: **if this phone never sees a vest again, the clips still
expire on schedule.**

---

## 8. The language between them

The vest speaks Python. The phone speaks TypeScript. They have to agree exactly
on what a message looks like, and the gap between two hand-written definitions is
where protocol bugs live.

So neither side is hand-written. There is **one file** —
`protocol/schema/protocol.v1.json` — describing every message, and a generator
writes both the Python and the TypeScript from it.

The build fails if either generated file has been edited or has drifted. Both
sides also parse the same **golden fixture**: a file of example messages,
including three deliberately malformed ones that both sides must reject.

### The messages

**From the vest:** `hello` (who I am, what I hold), `clip_ready`, `clip_expired`,
`session_state`, `marker_refused`, `status` (health), `pong`.

**From the phone:** `mark` (a tap), `ack` (I have the clip safely), `pin` (keep
this one), `ping`, `resync` (what did I miss?).

---

## 9. Proving who you are

### The problem

The vest's Wi-Fi password is printed on a label taped to the vest, so that the
umpire can join. Which means **every player standing nearby can photograph it**.

If joining the network were enough to download footage, then the network password
would be the only thing protecting video of identifiable people — often at
amateur grounds, sometimes of children. That is not good enough.

### The solution

The pairing label carries a second value, never displayed anywhere else: **a key**
— 32 random bytes the vest generates the first time it boots.

Every request the phone makes carries a fingerprint computed from that key *and
from the request itself*:

```
signature = HMAC-SHA256(key, "GET" + "/clips/4.mp4" + timestamp + random-number)
```

The vest recomputes the same fingerprint and compares. Each of those four pieces
does a specific job:

| Part | What it stops |
|---|---|
| What you're doing (`GET`) and to what (`/clips/4.mp4`) | Capturing a signature from a harmless request and reusing it to fetch footage |
| The timestamp | Using a signature captured last week — more than five minutes out and it is refused |
| The random number, used once | Replaying the same request inside those five minutes |

The key **never travels over the network**. It reaches the phone on the pairing
label and lives in the phone's secure keystore. The vest will not print it in a
log, and no web address will hand it over — an endpoint that gives out the key
would undo the point of having one.

**The live channel is protected the same way**, and checked *before* the
connection is accepted. An unauthorised device is never even told that a clip
exists, which matters more than it being unable to download one: *"clip 4, 9.5
MB, fifteen seconds, just now"* is itself information about what happened.

### What this does not do

Signing proves **who is asking**. It does not hide the answer. The video itself
still crosses the Wi-Fi unencrypted, so somebody capturing raw radio traffic, who
*also* has the network password, could reconstruct a clip they watched being
transferred.

That is a far harder attack than joining a network and pressing download — which
is the one that is now closed — and it is written down rather than glossed over.

---

## 10. Time, and why it is hard

This deserves a section because it caused two real failures.

**The vest has no clock battery.** A phone or laptop keeps time when switched off;
this computer does not. When it boots it believes it is **whenever it was last
switched off** — which can be days ago.

That matters twice:

**For signatures.** A signed request carries a timestamp, and the vest refuses one
more than five minutes from its own clock. If the phone signed with *its* clock —
which is correct — against a vest that thinks it is last Tuesday, every single
request would be refused, and an umpire standing in a field could do nothing
about it.

The fix: when the vest refuses for this reason, **it sends back its own clock**.
The phone adopts it and signs in vest time from then on. Accuracy is not what
signing needs; agreement is.

**For the buffer.** Every video file is dated by the filesystem. If the clock
suddenly jumps forward — which happens the moment the Pi gets internet and
corrects itself — every file on disk instantly looks hours old, and the cleanup
deletes the entire buffer in one pass.

That happened during testing: the clock jumped seventeen hours mid-session and the
buffer vanished. The refusal that followed was honest — the footage genuinely was
gone. The cleanup now says so loudly when it happens, but **the real fix is a
£3 clock battery**, and no amount of code replaces it.

---

## 11. When things go wrong

Sealed into a vest, the Pi has no screen and nobody can log into it. So every
failure has to reach the phone.

| What fails | What the umpire sees | What happens |
|---|---|---|
| The camera stops | **Red banner: "The vest is not recording"** | Watchdog rebuilds the pipeline within 10s, backing off to 30s while it keeps failing. Never gives up. |
| The vest software crashes | Link dot amber, then green | Restarted in 2 seconds, forever. It cannot decide to stay down. |
| Power lost, or out of range | Link dot amber within 15s; taps queue to disk | Taps are sent when it returns |
| A tap lands outside the five minutes | *"made no clip — the vest had already recorded over it"* | Refused honestly rather than cutting the wrong footage |
| A download is corrupted | Retried | The fingerprint check catches it; a bad file is never kept |
| The vest restarts mid-match | Recovers by itself | The vest says it has no match; the app notices and starts one |

**A recurring principle:** the system is built to prefer a loud failure to a quiet
wrong answer. A refused tap is better than a clip of the wrong ten seconds. A
missing clip is better than a corrupted one. "Not recording" in red is better than
a green dot that lies.

---

## 12. Privacy

This points a camera at people who did not ask to be filmed, in order to settle
arguments about them. So "nothing is kept" has to be **literally true**, not
approximately true.

### What is kept, and for how long

| What | Where | How long |
|---|---|---|
| The rolling buffer | Vest disk | 5 minutes, always |
| A clip | Vest, then the phone | 12 balls, then deleted |
| A kept clip | Phone | 7 days by default, then deleted |
| The decision log | Phone | Until wiped |
| The audit trail | Phone | Last 2000 entries |
| Umpire's name and email | Phone keystore | **Only if they chose to sign in** |

### What is not recorded at all

**No sound.** Picture only — and the microphone permission is **blocked outright**
in the built app, not merely unrequested, so no future software update can quietly
turn it on. Washington State treats recording a private conversation far more
seriously than filming in public, and a chest microphone twenty metres from the
bat catches nothing about the cricket and a great deal said between two players.

**Nobody is named.** A clip is a date, a ground and a ball number. No player
names, no teams, no scores.

**Nothing is uploaded.** During a match the phone talks to the vest and nothing
else. No analytics, no crash reporting, no cloud.

### Deletion

Automatic, local, and not dependent on anything. Both phone operating systems copy
app files to the owner's personal cloud by default — **both of those doors are
shut**. Screenshots are blocked while a match is open, because a screenshot
escapes every rule above.

A system that deletes evidence must be able to say *what* it deleted and when, so
there is an audit trail: a timestamp, an event type, a ball number. No video, no
names.

### Signing in

There is an optional account. **Nothing is gated behind it** — every screen works
signed out — because during a match the phone is on a network with no internet,
and an app that demanded a login at the toss would be an app that stops working
at a ground.

Today it unlocks no features. It exists so that things which genuinely need an
account later have something to build on. The screen says exactly that, rather
than implying an upgrade.

---

## 13. The test footage

You cannot test a cricket system by playing cricket every afternoon, so there are
two kinds of stand-in footage.

**The synthetic clip** bundled with the app is a generated test pattern with
exactly 900 frames. It is deliberately artificial, because its job is to prove
that **stepping one frame actually advances exactly one frame** — something you
can verify by eye on a counter, and cannot verify on real footage.

**Your own recordings** can be dropped in and used by both halves. `prepare-footage.sh`
converts them (strips audio, normalises) and `add-footage.sh` pushes them into the
app. The vest can use the same files in place of a camera by pointing one setting
at a video file — which is how the entire system was built and tested before any
hardware was bought.

Real footage is gitignored entirely. It never enters version control.

**The question test footage cannot answer** is the one that decides whether any of
this works: *is the impact zone actually in shot from an umpire's chest?* That
needs a real camera on a real chest, and it is the project's gate.

---

## 14. Setting it up

### On the Pi, once

```bash
sudo git clone https://github.com/abhip1008/thirdeye.git /opt/thirdeye
cd /opt/thirdeye
./scripts/check-hardware.sh       # measures; changes nothing
sudo ./scripts/setup-pi.sh        # packages, service, storage
sudoedit /etc/thirdeye.env        # camera and capture mode
sudo systemctl start thirdeye
```

Then confirm the vest's own side works, with no phone involved:

```bash
sudo -u thirdeye /opt/thirdeye/vest/.venv/bin/python \
  /opt/thirdeye/vest/scripts/check_clip.py
```

That runs seventeen checks — sign a request, mark a delivery, download the clip,
verify its fingerprint, confirm it is real video at the right frame rate. If those
pass, the vest works and anything that fails afterwards is the app.

### The vest's own Wi-Fi, once

**Last**, after a clip has already reached the phone over ordinary Wi-Fi. One new
thing at a time.

```bash
sudo raspi-config nonint do_wifi_country US
sudo /opt/thirdeye/scripts/setup-hotspot.sh 'a-passphrase'
```

### The phone

Settings → mock vest off. Pair with the address and key. Start a match. Tap.

### After that

**Nothing.** Switching the vest on is the whole procedure: it boots, brings up its
Wi-Fi, starts recording, and the phone reconnects and starts a match by itself.

---

## 15. What is proven, and what is not

### Proven by running it

- **The whole loop on real hardware.** A Pi with a real camera recorded, cut a
  clip on a tap, and delivered it to the app over a signed connection.
- **Byte-identical transfer.** Clips arrive on the phone exactly as they left the
  vest, verified by fingerprint.
- **Resumable downloads** reassemble perfectly from two halves.
- **A missed start tap** recovered from the buffer.
- **A tap past the buffer** refused rather than faked.
- **Deletion after twelve balls**, run on a device with 16 clips seeded.
- **Signing**, against a live vest: unsigned refused, replays refused, a signature
  moved to another address refused.
- **Two clocks seventeen hours apart** recovering by themselves.
- 95 phone tests, 68 vest tests, 30 end-to-end checks, 17 against a real camera.

### Not proven

- **Whether the camera sees the ball.** The gate. Everything above is worthless if
  a chest-mounted camera cannot keep the impact zone in frame, and one afternoon
  answers it.
- **Frame stepping on real footage.** Proven on the synthetic clip. Until recently
  the phone was guessing the frame rate, so it is worth redoing.
- **A physical phone.** Everything so far is a simulator on the same network,
  which reaches the vest identically.
- **Anything unattended.** No soak test longer than an hour.

---

## 16. What is left

**Before a real match:**

1. **The framing test** — strap it on, umpire two overs, measure how often the ball
   is in shot. This decides whether the project continues.
2. **A clock battery** for the Pi.
3. **An SSD** for storage instead of the memory card, which wears out under
   continuous writing.
4. **A long soak** — leave it recording and confirm it is still going hours later.

**Known gaps, written down rather than hidden:**

- No battery gauge exists on this hardware, so the app shows none rather than
  inventing a number.
- Video crosses the link unencrypted; signing controls *who may ask*, not what
  comes back.
- The pairing code is not itself signed, so a fake code could point the phone at
  the wrong address — the consequence being a pairing that visibly does not work.
- Deletion runs when the app opens, not on a timer.

**Deliberately not built yet:** cloud upload (blocked on policy questions that are
decisions, not code) and any automated assistance — which is scoped out for now,
with room left to add it.

---

## The shortest version

A camera that never stops recording, five minutes of memory, and a button that
does not start anything — it only decides what to keep.

Everything else is making that reliable when the network drops, the clock is
wrong, the camera fails silently, or somebody photographs the Wi-Fi password.
