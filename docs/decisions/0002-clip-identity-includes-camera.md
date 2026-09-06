# 2. A clip is identified by (match, camera, seq)

**Status:** accepted, Phase 1
**Amends:** spec section 7.7, which keys the clips table on `(match_id, seq)`

## Context

v1 runs one vest at the bowler's end. The spec puts a second unit at square leg
in v2 and says "the architecture supports it". `seq` is a per-vest monotonic
counter, so two vests in one match produce two streams of sequence numbers that
collide from the first delivery.

## Decision

`camera_id` is a required field on `ClipMeta` and on every clip-bearing
message. The phone's primary key is `(match_id, camera_id, seq)`. Routes are
`/clip/{camera_id}_{seq}`.

## Consequences

- v2 is additive rather than a migration of recorded data.
- Costs one column, one path segment, and a `lastIndexOf('_')` in the route
  parser, today.
- The alternative - discovering it after a season of matches - is a data
  migration on devices in umpires' pockets, which is the expensive version of
  the same work.
