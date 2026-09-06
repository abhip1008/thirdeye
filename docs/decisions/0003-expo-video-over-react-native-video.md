# 3. expo-video, not react-native-video

**Status:** accepted, Phase 1
**Amends:** spec section 5, tier 3

## Context

The spec picks `react-native-video` v6 and flags frame-accurate stepping as the
hard part, with a `MediaCodec` native module as the fallback. It also warns not
to discover the problem on match day.

The build target for Phase 1 is Expo Go, which cannot load `react-native-video`.

## Decision

Use `expo-video`. Both wrap Media3 / ExoPlayer on Android and AVPlayer on iOS.

`expo-video` exposes `seekTolerance`, which defaults to exact, so setting
`player.currentTime = t ± 1/fps` lands on the requested frame rather than the
nearest sync frame. That is the behaviour the spec was worried about not having.

The bundled sample clip is synthetic: 900 frames at exactly 60 fps with a marker
that advances a fixed distance every single frame. Frame stepping is therefore
verifiable by eye, in Phase 1, without hardware.

## Consequences

- The spec's biggest Phase 1 risk is closed with a library choice rather than a
  native module.
- Verified by inspection today, not by measurement. Confirm on a real device
  before Phase 7, and keep the `MediaCodec` fallback in mind if a real H.265
  clip from the vest behaves differently from the H.264 sample.
