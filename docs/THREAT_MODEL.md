# Threat model

Scope: one vest and one phone, on a ground with twenty-two players and a
boundary full of spectators. The cloud is out of scope until Phase 7.

The framing that matters: the most valuable thing in this system is footage of
people who did not consent to being filmed, and the most likely adversary is
not a hacker. It is a bored teenager with a phone who notices an open Wi-Fi
network called `thirdeye-vest-01`.

---

## Assets

| Asset | Why it matters |
|---|---|
| Clip video | Footage of identifiable people. The whole privacy story is about this. |
| Decision log | Outlives the video. Says what an umpire decided and when. |
| Vest Wi-Fi passphrase | Grants access to the AP, and from there to every clip |
| Request signing key (`psk`) | The thing that stops an unauthorised client. Shipped: every revealing or changing request is signed with it. |
| The rolling buffer | Five minutes of continuous footage of everyone in frame, held on the vest at all times. Larger than any single clip, and it exists whether or not anyone marked a delivery. |
| Match availability | A vest that stops mid-match is a product failure, not a security one, but the same causes produce both |

---

## Adversaries

| Adversary | Capability | Motivation |
|---|---|---|
| Curious spectator | Joins an open AP with a phone | Idle |
| Aggrieved player | Physical proximity, motivated, may have watched the pairing | Wants a decision changed, or wants footage of themselves gone |
| Opposing team | Same, plus a whole match of opportunity | Competitive |
| Thief | Takes the phone or the vest | The hardware, not the data |
| The operator | Full access by design | Not adversarial, but the design should not require them to be trustworthy |

Explicitly out of scope: a nation-state, a targeted supply-chain attack on the
Radxa image, and anyone willing to spend more than the $400 the hardware costs.

---

## Surface, and where it stands

### The Wi-Fi access point

*Risk:* anyone in range associates and reaches the clip HTTP endpoint.

This was the largest hole, because the WPA2 passphrase is printed on a code on
the vest and every player standing near the umpire can photograph it. Joining
the network was, by itself, the whole of the authorisation check.

**Closed.** Every request that reveals or changes anything carries
`HMAC-SHA256(key, "METHOD\npath\ntimestamp\nnonce")`, and the vest refuses
what it cannot verify. The key is minted on the vest, mode `0600`, on no route
and not in the log; it reaches the phone in the pairing code and lives in the
phone's keystore. Details in `docs/decisions/0006-lan-transport-security.md`.

A captured signature does not help: the vest refuses a timestamp more than 300
seconds from its own clock and remembers the last 4096 nonces, so a replay is
refused, and the method and path are signed, so a signature cannot be moved from
`/api/health` to `/clips/4.mp4`.

*Remaining:* the key is shared, not per-phone. A phone that was legitimately
paired and then should not be any more can only be cut off by re-keying the vest
and re-pairing the phones that should keep working. For one vest and one
umpire's phone that is proportionate; for a fleet it is not.

*Also:* the AP has no route to the internet, so a joined device gains reach to
the vest and nothing else.

### The control channel

*Risk:* a rogue client sends `pin` or `ack` messages and confuses retention.

The worst case is a clip kept that should have been purged, or a clip purged
that the phone had not actually received.

**Closed, at the door rather than per message.** The handshake itself is signed,
in the query string, because neither React Native nor a browser can put headers
on a WebSocket upgrade. The vest verifies before it accepts, so a client without
the key never receives a `clip_ready` and never learns a clip exists - which
matters more than it being unable to send one. Once a channel is open, every
message on it came from a holder of the key, so individual messages are not
signed again.

### Delivery markers

The BLE remote is gone; the umpire marks deliveries in the app. That removes a
radio, a battery and a spoofable unauthenticated link from the system entirely,
which is a straightforward win.

*Risk:* an unauthorised client on the access point sends markers of its own,
producing clips of nothing or fragmenting real deliveries.

The consequence is nuisance rather than exposure - it makes clips worse, it does
not reveal anything. **Closed** by the same signing: a marker arrives on the
control channel, and the control channel is not open to anyone without the key.

*Worth noting:* because the vest records continuously, a hostile marker cannot
destroy footage. It can only cause a bad cut, and the real delivery is still in
the buffer to be grabbed. Gated recording did not have that property.

*Accepted:* the umpire's own phone is now a single point of failure for
recording, not just for review. A flat battery stops the match being recorded.
That is an availability problem, not a security one, and the mitigation is
organisational: a league-owned handset and a power bank.

### The phone

*Risk:* physical access to an unlocked phone reveals the last twelve clips.

The device lock screen is the control, and the app does not add a second one:
an umpire who has to type a PIN during an appeal will stop using the product,
and a product nobody uses protects nobody.

What the app does do: app-private storage that other apps cannot read, blocked
screenshots while a match is open, keystore-backed secrets, and one-tap deletion
of everything. The strongest available mitigation is organisational rather than
technical - a league-owned phone with a passcode, rather than an umpire's
personal device.

### The pairing QR

*Risk:* an umpire scans a hostile QR code and pairs the app to an attacker's AP.

The payload is validated for shape but is not signed, so a fake code could point
the phone at a different host. The consequence is a phone that downloads nothing
useful, not a phone that leaks clips - it uploads nothing, and the key it would
store is the attacker's own.

Still open, still not urgent. What it costs the umpire is a pairing that does
not work, which is visible immediately: the vest is unreachable and the app says
so. Worth fixing when the pairing code gains a version bump for another reason.

### The audit trail

*Risk:* the record of what was deleted is itself sensitive.

It is deliberately thin: a timestamp, an event type, a camera id and a sequence
number. No frames, no names. Secrets are redacted before they are written, not
when they are read, so there is nothing sensitive in the buffer even if the
diagnostics screen is screenshotted.

---

## Failure modes that are not attacks but look like them

| Failure | Effect | Handling |
|---|---|---|
| Silent encoder throttle, 60 fps to 12 | Footage looks wrong, nobody knows why | `encoder_fps` is measured and surfaced in the connection pill; alert on any drop over 5% (Phase 6) |
| A marker that never reaches the vest | A clip with wrong boundaries, or none | The buffer. The footage is not conditional on the message, so the marker is queued and replayed, and a missed press stays recoverable |
| The umpire's phone dies | Recording stops, not just review | League-owned handset and a power bank. This got worse when the remote moved into the app. |
| Phone storage full mid-match | Downloads fail, grey dots | Status dot makes it visible before a review is announced |
| App killed, never reopened | Retention sweep never runs | Open gap; see `docs/SCALING.md` section 2.4 |

---

## Summary of open security items

| Item | Phase | Severity if skipped |
|---|---|---|
| HMAC-signed requests to the vest | 5 | High. Anyone on the AP can pull clips, and send markers. |
| Signed pairing payload | 6 | Low |
| Background retention sweep | 6 | Medium. It is a gap in a stated promise. |
| Vest-side purge of undelivered clips | 4 | Medium |
| Encryption at rest for pinned clips | 6 | Low while Android FBE holds |
