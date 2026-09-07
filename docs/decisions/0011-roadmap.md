# 11. The roadmap, and what is deliberately not on it

**Status:** accepted
**Supersedes:** the eight-phase plan in spec section 8

## Context

A three-phase plan was proposed: a video-review MVP, then AI assistance, then an
experimental LBW recommendation with trajectory projection.

The sequencing instinct behind it is right - build the unglamorous thing, earn
the right to the clever thing. What follows changes the contents of the phases,
and removes one of them.

## The plan

| Phase | Ends when |
|---|---|
| **1 — Foundations and UI** | **Done.** Every package builds; the app runs on a device against a mock vest, and the umpire's control works end to end. |
| **2 — Vest brings up** | The board boots, makes its own Wi-Fi, and records continuously with hardware encoding. |
| **3 — The link** | The phone reaches a real vest, markers arrive, a real file downloads. |
| **4 — Buffer and cutting** | A marker produces a correctly bounded clip, including one replayed after an outage. |
| **5 — Hardening** | Retry, resume, retention, health, signed requests. Survives a pulled cable. |
| **6 — Field trial** | Two overs of a real fixture, with a measured miss rate. **This is the gate.** |
| **7 — Cloud and consent** | Kept clips upload after the match; the retention policy is decided; opt-in research retention exists. |
| *later* | No-ball detection, then evidence assistance. Not scheduled, and not started before Phase 6 passes. |

Two orderings in that table are deliberate and both differ from the proposal.

**Cloud comes after the field trial, not in the MVP.** Nothing on match day
depends on the cloud today, and that is a property worth protecting rather than
spending. Uploading brings authentication, storage cost, a retention policy and
a "who is the data controller" question - none of which should be answered
before anyone knows whether the camera points at the right thing.

**The field trial is a gate, not a milestone.** Everything after it is
conditional on the miss rate it produces.

## What is not on the roadmap: trajectory projection

The proposal's third phase was an LBW recommendation - pitching location, impact
location, estimated trajectory, and a verdict of likely out, likely not out or
inconclusive.

This is removed. The original spec was right the first time: *"Optically
impossible at this pixel density. Do not sell DRS."*

The arithmetic has not changed since:

- The ball is about **6 pixels** at twenty metres through the 66-degree lens.
- Projection needs accurate 3D ball position across several frames, plus camera
  pose relative to the pitch. **The camera is on a breathing, leaning, turning
  chest**, so that pose changes every frame and is not measured.
- A ±1 pixel position error at twenty metres is several centimetres, and it
  compounds through the projection. The error bars come out wider than the
  stumps.
- Real DRS uses six or more fixed, calibrated cameras at 340 fps. This is one
  moving uncalibrated camera at 60.

That is not "medium feasibility, accuracy to be proven." It is low, and the
proving would fail.

There is a second reason, and it costs more than the first. **A wrong verdict
discredits the parts that work.** The spec already makes this argument about
reliability: a 98% system feels broken because nobody remembers the 98%. An app
that says "likely out" and is wrong twice gets the whole system thrown out of a
league, including the front-foot no-ball call that was right every time.

### And the validation cannot be done

"Validate against expert-labelled matches" assumes labels exist. Marginal LBWs
have no ground truth - that is what makes them marginal. Two experienced umpires
disagreeing is the normal case, not an error to be measured against.

Note which calls *can* be validated: the objective ones. Those are the same
calls this camera can actually detect. That is not a coincidence, it is the same
property seen twice.

## What replaces it, when the time comes

Not a verdict. **An annotated evidence frame**: the moment of impact, with the
stump line drawn, the pad position marked, and the pitching point shown if the
bounce is detectable. Everything measured, nothing projected. The umpire still
makes the call, which is also the only version a league committee will accept.

## When AI does happen, it starts with the no-ball

The proposal opened its AI phase with ball detection. That is the hardest thing
on the list and should be last.

| Candidate | Feasibility | Why |
|---|---|---|
| **Front-foot no-ball** | **High** | The crease is one to two metres from the lens. The foot is hundreds of pixels and the popping crease is a straight white line. |
| Quality checks - was the ball even in frame | High | Cheap, and it is what keeps everything above it honest. |
| Player and pose detection | Medium-High | Person detection at this scale is solved. Finding the knee roll from pose is realistic. |
| Impact-frame selection | Medium | With no microphone it has to be inferred from bat and body pose, not from the ball. |
| Ball detection | Low-Medium | Six pixels, moving ~30 px per frame, on a moving mount, with **no dataset for this viewpoint**. |

The no-ball is also the call club umpires get wrong most often, it is fully
objective, and it is checkable frame by frame. It would be a working feature
long before ball tracking produced anything.

## The tension that has to be resolved first

**The privacy model and any future model training are in direct conflict.**

Phase 1's entire argument is that nothing is kept - deleted after twelve balls.
That is what makes players and committees say yes. You cannot train or validate
on footage you deleted.

Any of the work above needs hundreds of labelled deliveries, which means an
explicit, opt-in **research retention mode** - a different consent conversation
from the one the notice screen has today, probably requiring written agreement,
and a much larger ask than "nothing is kept."

That decision belongs in Phase 7, before any model work starts, not halfway
through it. It is also a further argument for the no-ball being first:
front-foot footage is close, high resolution, and shows a bowler's foot rather
than identifiable faces.

## Where the work would attach

Recorded here so nobody has to go looking, and so no speculative code is written
in the meantime:

- **Retention exception:** `mobile/src/privacy/rules.ts`, `shouldPurge`. It is
  the single chokepoint; a research-mode exemption is one branch there and
  nowhere else.
- **Labels already exist.** The `reviews` table records what the umpire decided
  and on which delivery. That is a labelled dataset accumulating from day one,
  minus the footage. `appeal_type` is already a column and is deliberately unset
  by the UI today.
- **Higher-quality source:** the vest's archive copy, which never leaves the
  vest, is the training-grade footage. The review copy sent to the phone is not.
- **Protocol:** unknown message types are ignored rather than treated as errors,
  so a vest that one day reports an analysis result needs no protocol break -
  only a new message type.
- **Player:** annotations would ride on the clip record as a nullable column and
  draw through `OverlayCanvas`, which already renders reference geometry over
  the video.

## Consequences

- Phases 2 through 7 are engineering with known unknowns. Nothing on the
  schedule depends on a research result.
- The product's honest claim stays what it has been: front-foot no-balls,
  run-outs at the bowler's end, gross errors, and the umpire's own memory.
- If the field trial in Phase 6 shows the impact zone is out of frame too often,
  none of the later work is worth starting, and the answer is a different camera
  position rather than a better model.
