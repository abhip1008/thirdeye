import { log } from '@/lib/log';

/**
 * What time the vest thinks it is.
 *
 * A vest has no real-time clock and, at a ground, no route to the internet. It
 * boots believing it is whenever it was last switched off - which can be days
 * ago - and nothing on the vest will ever correct that. The phone's clock is
 * the accurate one.
 *
 * Accuracy is not what any of this needs, though. Two things need *agreement*:
 *
 * - **Markers.** Every tap is stamped in vest time, so the vest never has to
 *   track a per-client offset and a second phone later needs no extra work.
 * - **Signatures.** A signed request carries a timestamp, and the vest refuses
 *   one more than five minutes from its own clock. Sign in phone time against a
 *   vest that booted last Tuesday and every request is refused, for a reason
 *   that looks from the umpire's side exactly like the vest being switched off.
 *
 * So the offset lives here, one copy, learned from whatever the vest has said
 * most recently and trusted in this order: a correction the vest sent back with
 * a refusal, then the round-trip estimate from the heartbeat, then the coarse
 * reading from an unsigned health check. It is deliberately not persisted - the
 * vest's clock can jump the moment somebody gives it internet, and a remembered
 * offset would then be wrong with confidence.
 */

/** How good a sample is. Higher wins; an equal one replaces, being newer. */
const enum Quality {
  Health = 1, // one-way, no round trip measured
  Pong = 2, // round trip measured, halved
  Correction = 3, // the vest told us directly, in a refusal
}

let offsetSeconds = 0;
let quality = 0;
let bestRttMs: number | null = null;

/** Vest-clock seconds. Phone time until the vest has said otherwise. */
export function vestNow(): number {
  return Date.now() / 1000 + offsetSeconds;
}

/** Seconds to add to this phone's clock. Shown on the diagnostics screen. */
export function vestOffset(): number {
  return offsetSeconds;
}

/** Round trip of the sample the offset came from, when one was measured. */
export function vestOffsetRttMs(): number | null {
  return bestRttMs;
}

function adopt(next: number, level: Quality, rttMs: number | null): void {
  const moved = Math.abs(next - offsetSeconds);
  offsetSeconds = next;
  quality = level;
  bestRttMs = rttMs;
  if (moved > 1) {
    log.info('clock', `vest clock is ${next >= 0 ? '+' : ''}${next.toFixed(1)}s from this phone`);
  }
}

/**
 * The vest answered a request by saying what time it is.
 *
 * This beats every estimate: it is not inferred from anything. It arrives on a
 * refusal, which is the one moment the offset is definitely wrong.
 */
export function correctTo(vestTime: number): boolean {
  const next = vestTime - Date.now() / 1000;
  // Under a second is the ordinary difference between two clocks and a request
  // is not refused over it. Reacting to it would mean retrying requests that
  // failed for some entirely different reason.
  const worthIt = Math.abs(next - offsetSeconds) > 1;
  if (worthIt) adopt(next, Quality.Correction, null);
  return worthIt;
}

/**
 * A pong came back. The vest read its clock somewhere inside the round trip;
 * the middle is the best guess, and a short trip makes it a better one.
 *
 * Keeps the shortest round trip rather than the newest sample: the offset
 * drifts far more slowly than the network varies.
 */
export function observePong(vestTime: number, sentAt: number, receivedAt: number): void {
  const rttMs = Math.round((receivedAt - sentAt) * 1000);
  if (quality > Quality.Pong) return;
  if (quality === Quality.Pong && bestRttMs !== null && rttMs > bestRttMs) return;
  adopt(vestTime - (sentAt + (receivedAt - sentAt) / 2), Quality.Pong, rttMs);
}

/**
 * Health said what time it is. One-way and unsigned, so it is the weakest
 * source - and the only one available before anything has been signed, which is
 * exactly when a phone first meets a vest whose clock is wrong.
 */
export function observeHealth(vestTime: number): void {
  if (quality > Quality.Health) return;
  adopt(vestTime - Date.now() / 1000, Quality.Health, null);
}

/** Forget it. A different vest has a different clock. */
export function resetVestClock(): void {
  offsetSeconds = 0;
  quality = 0;
  bestRttMs = null;
}
