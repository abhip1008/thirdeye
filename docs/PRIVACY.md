# Privacy design

**Status:** current as of Phase 1. Sections marked *Deferred* name the phase
that implements them.

Third Eye points a camera at people who did not ask to be filmed, in order to
settle arguments about them. That is worth being honest about. This document is
what the system actually does with that footage, where the guarantees are
enforced in code, and which questions are still open.

Nothing here is legal advice. Section 8 lists what a league has to decide.

---

## 1. The promise, in one paragraph

The umpire wears a camera. Each delivery becomes a short, silent clip on the
umpire's phone. When the thirteenth ball is bowled the first one is deleted -
not archived, deleted. A clip the umpire marks as significant survives longer,
but it carries its own expiry date and goes on its own. During a match the phone
talks to the vest and to nothing else: no cloud, no analytics, no third party.
No names are recorded anywhere.

The user-facing version of this is `mobile/src/app/notice.tsx`, written to be
read out loud in fifteen seconds to a player who asks what is going on.

---

## 2. Data inventory

Everything the system holds, and for how long.

| Data | Where it lives | Lifetime | Enforced by |
|---|---|---|---|
| Video clip, review copy | Vest disk, then phone app-private storage | 12 deliveries | `privacy/retention.ts`, vest ring (Phase 6) |
| Video clip, archive copy | Vest disk only, never leaves it | Match, then purged | Phase 6 |
| Pre-roll ring buffer | Vest tmpfs (`/dev/shm`), never written to disk | 20 seconds | Phase 4 janitor |
| Pinned clip | Phone | `pinRetentionDays`, default 7 | `purge_after` column |
| Clip metadata (seq, duration, hash, over.ball) | Phone SQLite | With the clip | `clips` table cascade |
| Decision log (out / not out / unclear) | Phone SQLite | Indefinite until wiped | `reviews` table |
| Audit trail (what was purged, when) | Phone SQLite | Last 2000 rows | `trimAuditLog()` |
| Match record (date, ground, camera id) | Phone SQLite | Indefinite until wiped | `matches` table |
| Vest Wi-Fi passphrase, request signing key | Platform keystore | Until "Forget this vest" | `privacy/secrets.ts` |
| Diagnostic log lines | Memory only, never a file | Until the app closes | `lib/log.ts` |

**Not collected at all:** audio, player names, team names, scores, umpire
identity, phone location, contacts, device identifiers, crash reports, analytics
of any kind.

---

## 3. The five design decisions that carry the privacy story

### 3.1 No microphone

The vest records picture only. This is not a cost saving.

Washington State treats the recording of a private conversation without the
consent of all parties as a separate and much more serious matter than filming
in a public place. A chest-mounted microphone twenty metres from the bat picks
up almost nothing useful about the cricket and a great deal that is said between
two players who believe they are talking to each other. Removing the microphone
removes that entire category of problem, and it costs the product nothing
because snicko was never optically or acoustically possible from this position
anyway.

`app.json` blocks `RECORD_AUDIO` explicitly rather than merely not requesting it,
so a future dependency cannot quietly pull the permission back in.

### 3.2 Retention is enforced locally, and by default

The purge does not need the vest, the network, or the cloud. It runs on app
start, after every clip that arrives, and on demand. If this phone never sees a
vest again, the clips still expire on schedule.

Three rules, in `mobile/src/privacy/retention.ts`:

1. A clip past its `purge_after` is deleted. No exception, pinned or not.
2. A clip more than `ringSize` deliveries behind the newest is deleted unless it
   is pinned or has been reviewed.
3. Deleting a clip deletes its file, its partial file, and its database row.
   A row without a file lies to the umpire; a file without a row is data nobody
   can see and nobody will ever delete.

Pinning sets an expiry rather than removing one. This is the important detail:
in most systems "starred" means "kept forever", and the moment that is true the
retention promise stops being true for exactly the clips people care about.

### 3.3 App-private storage, never the camera roll

Clips live under the app's private document directory
(`mobile/src/privacy/storage.ts`). On Android that directory is not readable by
other apps, is not indexed by the gallery, and is removed when the app is
uninstalled. Nothing is ever written to shared storage or `MediaLibrary`, so
nothing syncs to a photo cloud the league has no relationship with.

The `.part` suffix is the commit mechanism: a file without it has been
size-checked and hash-checked. A crash mid-download cannot leave a broken clip
that looks fine.

### 3.4 Screenshots are blocked while a match is open

A screenshot escapes every rule above and lands in a camera roll. `expo-screen-capture`
blocks capture and blanks the app in the recent-apps switcher for as long as a
match is open (`mobile/src/privacy/screenGuard.ts`). It is best-effort - it does
nothing in some Expo Go configurations - and it is not a security control
against a determined person. It is there because the common case is an umpire
grabbing a screenshot to show someone, and that is worth making harder.

### 3.5 Secrets are not in the database

The vest's Wi-Fi passphrase and, from Phase 6, the request-signing key go to the
platform keystore, never to SQLite and never to the Zustand store. They are read
at the moment of use. The logger redacts anything keyed `password`, `psk`,
`secret`, `token` or `authorization`, and truncates long hex strings, so
diagnostics output is safe to screenshot and send.

---

## 4. Access

| Who | Can see | How |
|---|---|---|
| The umpire holding the phone | The last 12 clips, the decision log | The app |
| Another phone on the vest's access point | Nothing, once Phase 6 lands | HMAC-signed requests |
| Anyone with physical access to an unlocked phone | The last 12 clips | Device lock is the control |
| The league | The decision log, if exported | Phase 8, opt-in |
| The project maintainer | Nothing | There is no telemetry |

The gap in that table is the third row, and it is a real one. The mitigation is
a league-owned phone with a device passcode rather than an umpire's personal
phone; see the open questions.

---

## 5. Network exposure

During a match the phone associates with the vest's own access point and talks
to one host. There is no route to the internet through that AP.

Transport security on that link is an open decision, documented in
`docs/decisions/0006-lan-transport-security.md`. The short version: you cannot
get a real TLS certificate for `192.168.43.1`, so the options are plain HTTP
with an Android cleartext exception, a pinned self-signed certificate, or HTTP
plus an HMAC derived from the pairing QR. Phase 3 uses plain HTTP on a
point-to-point link. **Phase 6 adds the HMAC before any real match**, because
without it any phone that joins the AP can enumerate and download clips.

The `psk` field already exists in the pairing payload and the `PairingPayload`
type, unused, so adding it is not a protocol change.

---

## 6. Answering "delete my footage"

Someone will ask. The answer should be short and demonstrable.

- **Within a match:** wait one over. Unless the umpire marked it, the clip is
  already gone. Settings shows exactly how many clips are on the phone right now.
- **A kept clip:** long-press the row, "Stop keeping". It is deleted on the next
  sweep, which is immediate.
- **Everything:** Settings -> Delete all data on this phone. This removes every
  clip, every match, every decision and the vest pairing, and writes one audit
  row recording that it happened.

The audit trail is the part that makes this answerable rather than merely
claimable: it records what was deleted and when, without keeping what was
deleted.

---

## 7. What Phase 1 does and does not implement

**Implemented and running now**

- Local retention sweep with explicit per-clip expiry
- Pin-as-expiry rather than pin-as-forever
- App-private storage, no camera roll, no shared storage
- Blocked Android permissions for audio, location, and media library
- Keystore-backed secrets with a redacting logger
- Append-only audit trail with a size bound
- Screenshot blocking while a match is open
- Player-facing notice screen, shown before the first match and reachable always
- One-tap deletion of everything

**Deferred, with the phase that owns it**

| Item | Phase | Note |
|---|---|---|
| HMAC-signed requests to the vest | 6 | The `psk` field already exists |
| Vest-side ring purge and tmpfs janitor | 4 and 6 | The phone's purge does not depend on it |
| Encryption at rest for pinned clips | 6 | Android FBE covers the common case first |
| Cloud retention policy | 8 | Blocked on section 8 |
| Signed pairing QR | 6 | Stops a phone pairing to a hostile AP |

---

## 8. Open questions a league has to answer

These are not engineering decisions and they should be settled before hardware
is ordered, not after someone asks for footage.

1. **Whose phone?** A league-owned handset changes the consent conversation
   entirely and is the single cheapest privacy control available. An umpire's
   personal phone puts match footage on a device with a photo cloud, a lock
   screen the league does not control, and a lifetime the league cannot end.
2. **Are under-18s playing?** Club cricket usually means yes. Footage of minors
   raises the bar on every answer above, and probably means a written notice to
   parents rather than a screen an umpire can show on request.
3. **Who is the controller of a pinned clip?** The league or the person who
   built the vest? Whoever it is has to be the one who answers a deletion
   request.
4. **What happens when a clip is asked for as disciplinary evidence?** Decide
   before it is asked for. A wicket clip that survives a hearing has outlived
   every promise in section 1, and the retention default has to be chosen with
   that in mind.
5. **Does the league's ground have signage obligations?** Recording in a public
   park is generally permitted; a notice at the ground costs nothing and removes
   the argument.

The honest position on all five: the auto-purge is the answer to most
objections, and it should be led with rather than defended.
