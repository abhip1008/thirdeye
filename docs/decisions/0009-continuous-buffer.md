# 9. The vest records continuously; a press is a marker, not a trigger

**Status:** accepted
**Required by:** [ADR 8](0008-remote-moves-into-the-app.md)

## Context

The original vest gated its recording: it kept a 20-second ring buffer in RAM
for pre-roll, and cut a clip when the remote told it to. A press *caused* a
recording.

Moving the control into the app merges the control path and the data path onto
one Wi-Fi link. Under gated recording, a dropped link means the vest never hears
that a ball was bowled, and no footage of that delivery exists at all.

## Decision

The vest records continuously into a **five-minute rolling buffer on the SSD**.
A marker from the phone does not start anything; it says which part of the
buffer to keep.

Two properties fall out of that, and both are improvements on the design being
replaced:

**A marker can arrive late.** Anything inside the buffer is still cuttable, so a
phone that was offline for an over replays its markers and gets its clips. The
footage was never conditional on the message arriving.

**A missed press is recoverable.** Under the old design a lost Bluetooth
notification meant lost footage. Now it means the umpire can grab it afterwards.
That matters more than it sounds: missed presses are not randomly distributed,
they cluster around the deliveries where something dramatic happened, which is
exactly when a review gets called.

## Numbers

- Five minutes at 15 Mbps is about 560 MB, on a 256 GB drive. Not a constraint.
- The buffer moves from tmpfs to the SSD. Five minutes does not fit in RAM on
  this board, and unlike the old pre-roll ring this buffer is load-bearing: it
  is the only copy of a delivery until a marker arrives.
- Pre-roll goes from 3 seconds to 5. A physical button had a fixed, tiny
  latency; a press on glass goes through the touch system, JavaScript and a
  network hop, and the *variance* matters more than the mean. Pre-roll absorbs
  it.
- Markers older than 280 seconds are refused. That stays under the buffer with
  room to spare, so a marker whose footage has been overwritten is rejected
  honestly rather than turned into an empty clip.

## Clock sync

Markers are stamped in **vest time**, not phone time. The phone does the
conversion: every `pong` carries the vest's own clock, the phone estimates the
offset from the round trip, and applies it before sending.

The phone keeps the sample with the **shortest round trip** rather than the most
recent one. A long round trip means more uncertainty about when the vest read
its clock, and the offset drifts far more slowly than the network varies.

Doing it phone-side means the vest never tracks a per-client offset, so the
second unit in v2 needs no extra work.

## Consequences

- **Sustained thermals become a real Phase 2 question.** The encoder used to run
  in bursts around each delivery; it now runs for three hours without stopping.
  A pipeline that quietly drops from 60 fps to 12 without erroring is the worst
  failure mode in the system, so the encoded frame rate has to be measured over
  a full session before any of this is trusted.
- Disk write endurance over a season is worth a glance, though 20 GB per match
  on a modern NVMe drive is not close to a concern.
- "Grab the last twenty seconds" becomes much more useful: with five minutes
  behind you, any ball in the last over is recoverable, not just the last one.
- The vest is simpler, not more complex. There is no start/stop state machine in
  the capture pipeline any more - just a writer and a cutter.
