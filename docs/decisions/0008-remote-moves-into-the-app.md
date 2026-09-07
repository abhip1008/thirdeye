# 8. The remote moves into the app

**Status:** accepted, supersedes the BLE remote in spec sections 5, 6 and 7.5
**Removes:** Phase 5 from the plan, and the `remote` package

## Context

The original design had a two-button ESP32 remote in the umpire's hand, talking
to the vest over Bluetooth. The umpire pressed START as the bowler turned and
END when the ball was dead, with the hand already busy counting deliveries.

That is genuinely good ergonomics, and losing it is the cost of this decision.
A physical button can be pressed blind, while the other arm signals a boundary,
in the rain, without looking at anything. A target on glass does none of that as
well.

What it costs to keep is a second device to charge, a second thing to pair, a
firmware toolchain, a BLE stack on each end, and a whole phase of the build.

## Decision

The control moves into the app, on the screen where the footage is, as a single
large toggle pinned to the bottom of both the clip list and the review player.

One control rather than two. A toggle cannot be pressed in the wrong order;
with two targets on glass a mis-tap produces a marker that says the opposite of
what happened, and nothing downstream can tell.

## The consequence that mattered

Under the old design the **control path and the data path were independent**.
The remote reached the vest over Bluetooth; the vest reached the phone over
Wi-Fi. A Wi-Fi outage cost you the transfer but never the footage - the vest
kept cutting perfect clips and the phone caught up afterwards.

Folding the remote into the app **merges those two paths**. A dropped link would
mean the vest never learns a ball was bowled, so no clip is cut at all: a link
failure stops being a transfer problem and becomes a recording problem. On a
crowded ground with congested 2.4 GHz, that is not a hypothetical.

The fix is [ADR 9](0009-continuous-buffer.md): the vest records continuously and
a press becomes a **marker** rather than a **trigger**. That restores the
independence and improves on it, because a missed press becomes recoverable
rather than gone.

**This decision should not have been taken without that one.** They are one
change.

## What is lost, and what earns it back

| Lost | What replaces it |
|---|---|
| Pressing blind | A control that fills the bottom of the screen, in the same place on every screen it appears on |
| Pressing in the rain | Nothing. This is a real regression and the field trial should test it. |
| Two unambiguous buttons | A toggle plus the 40-second timeout, which recovers a forgotten END |
| Independent control path | Continuous recording, which makes the marker replayable |
| The vest counting deliveries | The phone counts them, and persists the count |

If pressing blind turns out to matter more than expected, an off-the-shelf
Bluetooth shutter button pairs to the *phone* as a keyboard for about $8 - no
firmware, no soldering. Android can capture that cleanly; iOS cannot, reliably.
That would be an accessory, not a return to a custom remote.

## Consequences

- Phase 5 disappears. The plan goes from eight phases to seven.
- The entire control loop becomes testable in Phase 1 with no hardware at all,
  which is a large gain for a project whose hardware does not exist yet.
- The umpire's phone dying now stops the recording, not just the review. That
  strengthens the case for a league-owned handset and a power bank.
- Battery use goes up: screen on for three hours plus Wi-Fi.
- The phone now mints delivery numbers, and has to persist them, because it is
  the only thing counting.
