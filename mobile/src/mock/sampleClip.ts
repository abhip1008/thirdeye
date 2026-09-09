/**
 * Facts about the Phase 1 sample clip, with no reference to the file itself.
 *
 * Kept separate from `sampleAsset.ts` so that code which only needs to know the
 * frame rate does not drag a 250 KB binary into its module graph - which, among
 * other things, is what lets the mock vest be unit tested.
 *
 * The clip is synthetic on purpose: 1920x1200 at exactly 60 fps for 900 frames,
 * with a burnt-in frame counter, a marker that advances a fixed distance every
 * single frame, and a ball on a known path. A recording of a real net session
 * cannot tell you whether your frame stepper moved by one frame or by four.
 * This can, at a glance, which is the whole reason the review player can be
 * validated before any hardware exists.
 */
export const MOCK_CLIP = {
  durationSeconds: 15,
  fps: 60,
  frames: 900,
  width: 1920,
  height: 1200,
  bytes: 250_000,
} as const;
