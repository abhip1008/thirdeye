# Scaling

Third Eye is one vest, one phone, one umpire. This document is about the things
that stop being true after that, which of them Phase 1 has already paid for, and
which one breaks first.

The rule applied throughout: pay for a scaling dimension now only when the cost
of retrofitting it is much larger than the cost of carrying it. Three of those
were worth paying for on day one. The rest are noted and deliberately not built.

---

## 1. Paid for already

### 1.1 A second vest

v1 runs one unit at the bowler's end. v2 adds square leg, and the moment it does
there are two independent streams of `seq` numbers that collide with each other.

Carried now, at close to zero cost:

- `camera_id` is a required field on `ClipMeta`, `clip_ready`, `clip_expired`,
  `session_state` and `status`. It is in the schema, so it is in both the
  TypeScript and the Python types, and neither side can forget it.
- The phone's clip primary key is `(match_id, camera_id, seq)`, not
  `(match_id, seq)`. Discovering the need for that column after a season of
  recorded matches is a data migration; adding it now is one line.
- The route to a clip is `/clip/{camera_id}_{seq}`, so deep links keep working.
- `UmpireEnd` (`bowlers` / `square_leg`) is recorded on the match and carried in
  `hello` and the pairing payload.

What is *not* built: rendering two streams side by side, choosing which camera a
review uses, and clock alignment between two vests. Those are v2 UI problems, and
they are UI problems rather than data problems precisely because of the above.

### 1.2 Protocol change without lockstep deploys

`protocol/schema/protocol.v1.json` is the only definition of the wire format.
`npm run protocol` generates `mobile/src/types/protocol.ts` and
`vest/thirdeye/protocol.py` from it, and `npm run protocol:check` fails CI if
either is stale. A protocol change that only one side was told about is not
possible; it is a build error.

On top of that, three rules make a mixed fleet survivable, which matters as soon
as there is more than one vest and more than one phone in a league:

- Every message carries `v`. Unknown message types are ignored rather than
  treated as errors, so either side can be upgraded independently.
- `hello` carries the vest's `protocol` number. The phone flags a mismatch
  rather than misparsing (`connectionStore.protocolMismatch`).
- `hello` carries `ring_size`. The phone mirrors the vest's retention window
  instead of hardcoding twelve.

### 1.3 Swapping the fake for the real thing

Phase 1 runs entirely against mocks, and the seams are interfaces rather than
`if (isMock)` branches scattered through screens:

| Interface | Phase 1 | Phase 3 |
|---|---|---|
| `Transport` | `MockTransport`, bowls on a timer | `WebSocketTransport` |
| `Downloader` | `MockDownloader`, fakes 3 seconds | ranged HTTP GET with SHA-256 verify |

Nothing above those interfaces knows which implementation is live. The screens,
the stores, the retention rules and the status machine are exercised today
against the fake and do not change when the vest arrives.

---

## 2. What breaks first, in order

### 2.1 One phone per vest, and the phone is a single point of failure

The vest holds twelve clips; the phone holds twelve clips. If the phone dies
mid-innings, the review capability dies with it even though the vest is fine.

*When it matters:* the first time an umpire's battery goes flat in a semi-final.
*Fix:* the resync protocol already exists (`resync` with `since_seq`), so a
second phone joining the AP and asking for everything since zero is a small
change. The blocker is not the protocol, it is that Phase 6's HMAC needs to
authorise more than one client.

### 2.2 The clip list is a full table scan on every change

`listClips` reads every clip for a match and the store re-sorts. At twelve clips
plus pins this is free. At a season of matches on one phone it is not, and
`selectPurgeable` runs a correlated subquery per sweep.

*When it matters:* around a few thousand rows, so roughly a full season without a
wipe. *Fix:* the indexes are already there (`idx_clips_seq`, `idx_clips_status`,
`idx_clips_purge`); paginate the list and scope the sweep to the open match.
Neither is worth doing before there is a season of data to measure.

### 2.3 The audit trail is unbounded per match

Bounded globally at 2000 rows, trimmed on start. A busy match writes roughly
five rows per delivery, so a 40-over innings is around 1200. Two matches without
an app restart and the trim starts eating the older match's history.

*Fix:* trim per match rather than globally, or raise the bound. One line, but it
needs a decision about how much history a league actually wants.

### 2.4 Retention sweeps run in the foreground

`sweep()` runs on app start and after each clip. If the app is killed and never
reopened, nothing expires. The clips are still app-private and still go on
uninstall, but the promise in `docs/PRIVACY.md` says "after seven days", not
"after seven days if you open the app".

*Fix:* a background task (`expo-background-task`) that sweeps on a schedule.
This is the most important item on this list, because unlike the others it is a
gap in a stated guarantee rather than a performance ceiling.

### 2.5 The buffer is sized for one outage, not several

Five minutes covers about an over of markers held through a Wi-Fi drop. A longer
outage - a flat phone battery, an app crash nobody noticed until drinks - loses
the deliveries beyond that window, and the phone abandons those markers rather
than sending requests the vest will refuse.

*When it matters:* the first time somebody's phone dies mid-innings.
*Fix:* the buffer is a config value and the disk has room for half an hour. The
reason not to set it to half an hour today is that nothing has measured
sustained encoder thermals yet, and a longer buffer does not help if the encoder
has quietly throttled.

### 2.6 One league, one hardcoded ball-per-over

`BALLS_PER_OVER` is a constant in `matchStore.ts`. Fine for cricket. It is
mentioned here only so nobody goes looking for a config value that does not
exist.

---

## 3. Deliberately not built

| Not built | Why not, and what it would cost later |
|---|---|
| Multi-tenant cloud | Phase 8, and optional even then. Nothing on match day may depend on it. |
| User accounts | There is no user. The phone is the identity. Adding accounts means adding a data controller, which is a privacy decision before it is an engineering one. |
| Clip thumbnails | `thumb_path` exists in the schema and is always null. Generating them costs CPU on a phone that is already downloading; the ball number is a better index than a 15-pixel-wide picture of grass. |
| Offline queue for cloud sync | Phase 8. The `synced_at` column exists. |
| iOS | Android first, per the spec. iOS needs `NEHotspotConfiguration`, a local network usage description and an ATS exception, and that is a week, not an afternoon. |
| Web build | `expo-sqlite` and `expo-secure-store` both degrade on web, and there is no umpire holding a laptop. |
