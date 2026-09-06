# 4. Mocks behind interfaces, not behind flags

**Status:** accepted, Phase 1

## Context

Phase 1 has no vest, no network and no camera, and its acceptance test is that a
stranger can be handed the phone and understand the product. That requires the
whole app to run against something.

The cheap version is `if (__DEV__ || mockEnabled)` sprinkled through the screens.
It works, and then Phase 3 is a search-and-replace across the codebase with the
real behaviour never having been exercised.

## Decision

Two interfaces in `mobile/src/net/transport.ts`:

- `Transport` - the control channel. Phase 1: `MockTransport`, which bowls on a
  timer, occasionally drops a delivery, and produces timeout and recovered clips
  at a realistic rate. Phase 3: `WebSocketTransport`.
- `Downloader` - moves clip bytes. Phase 1: `MockDownloader`, which takes a
  realistic three seconds and fails about one time in sixteen. Phase 3: a
  resumable ranged HTTP GET with SHA-256 verification.

Nothing above these interfaces knows which implementation is live. `setDownloader()`
and `attach()` are the only two places that do.

## Consequences

- The stores, the status machine, the retention rules and every screen are
  exercised today against a fake and do not change when hardware arrives.
- The failure paths are exercised *by default*, which is the part that matters:
  the grey dot appears in normal use rather than only when someone unplugs a
  cable.
- The mock stays in the build until Phase 7, per the spec, behind a settings
  toggle with three speeds.
