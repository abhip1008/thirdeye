import { dotStateFor } from '@/lib/clipStatus';
import { defaults } from '@/config/appConfig';
import { redact } from '@/lib/log';
import type { Clip } from '@/types/clip';

import { isBeyondRing, isPastExpiry, pinExpiryFrom, purgeReason, shouldPurge } from '../rules';

/**
 * The rules that carry the privacy promise.
 *
 * They are tested as pure functions with no database, no device and no vest,
 * because "footage of people is deleted on schedule" should not be a claim that
 * can only be checked by running a match.
 */

const NOW = 1_757_193_021;

const clip = (over: Partial<Clip> = {}): Clip => ({
  v: 1,
  match_id: 'm',
  camera_id: 'vest-01',
  seq: 1,
  started_at: NOW - 15,
  ended_at: NOW,
  duration_s: 15,
  preroll_s: 3,
  closed_by: 'button',
  resolution: '1920x1200',
  fps: 60,
  codec: 'h265',
  bytes: 9_540_221,
  sha256: 'a'.repeat(64),
  over: 1,
  ball_in_over: 1,
  legal: true,
  status: 'ready',
  bytesLocal: 9_540_221,
  localPath: 'file:///clip.mp4',
  thumbPath: null,
  pinned: false,
  pinReason: null,
  pinnedAt: null,
  purgeAfter: null,
  reviewed: false,
  downloadedAt: NOW,
  attempts: 1,
  lastError: null,
  ...over,
});

describe('the ring', () => {
  it('deletes a clip more than ringSize deliveries behind the newest', () => {
    expect(shouldPurge(clip({ seq: 1 }), 14, 12, NOW)).toBe(true);
    expect(shouldPurge(clip({ seq: 3 }), 14, 12, NOW)).toBe(false);
  });

  it('measures the window in deliveries, not in time', () => {
    const ancient = clip({ seq: 14, started_at: 0, ended_at: 0 });
    expect(isBeyondRing(ancient, 14, 12)).toBe(false);
  });

  it('spares a pinned clip and a reviewed one', () => {
    expect(shouldPurge(clip({ seq: 1, pinned: true }), 99, 12, NOW)).toBe(false);
    expect(shouldPurge(clip({ seq: 1, reviewed: true }), 99, 12, NOW)).toBe(false);
  });
});

describe('expiry', () => {
  it('pinning sets an expiry rather than removing one', () => {
    expect(pinExpiryFrom(NOW, 7)).toBe(NOW + 7 * 86_400);
    expect(defaults.pinRetentionDays).toBeGreaterThan(0);
    expect(Number.isFinite(defaults.pinRetentionDays)).toBe(true);
  });

  it('deletes a pinned clip once its date passes, pin or no pin', () => {
    const stale = clip({ seq: 99, pinned: true, purgeAfter: NOW - 1 });
    expect(isPastExpiry(stale, NOW)).toBe(true);
    expect(shouldPurge(stale, 99, 12, NOW)).toBe(true);
  });

  it('deletes a reviewed clip once its date passes too', () => {
    const stale = clip({ seq: 99, reviewed: true, pinned: true, purgeAfter: NOW - 1 });
    expect(shouldPurge(stale, 99, 12, NOW)).toBe(true);
  });

  it('keeps a pinned clip whose date has not passed', () => {
    const fresh = clip({ seq: 1, pinned: true, purgeAfter: NOW + 86_400 });
    expect(shouldPurge(fresh, 99, 12, NOW)).toBe(false);
  });

  it('records why a clip went, for the audit trail', () => {
    expect(purgeReason(clip({ purgeAfter: NOW - 1 }), NOW)).toBe('clip.purged.expiry');
    expect(purgeReason(clip(), NOW)).toBe('clip.purged.ring');
  });
});

describe('status dot', () => {
  it('only ever calls a clip ready when it actually is', () => {
    expect(dotStateFor('ready')).toBe('ready');
    for (const s of ['announced', 'downloading', 'verifying'] as const) {
      expect(dotStateFor(s)).toBe('pending');
    }
    for (const s of ['failed', 'expired'] as const) {
      expect(dotStateFor(s)).toBe('missing');
    }
  });
});

describe('log redaction', () => {
  it('never lets a secret through', () => {
    const out = redact({
      host: '192.168.43.1',
      password: 'hunter2',
      psk: 'deadbeef'.repeat(8),
      nested: { token: 'abc' },
    }) as Record<string, unknown>;
    expect(out.host).toBe('192.168.43.1');
    expect(out.password).toBe('«redacted»');
    expect(out.psk).toBe('«redacted»');
    expect((out.nested as Record<string, unknown>).token).toBe('«redacted»');
  });

  it('truncates hashes instead of printing 64 characters of noise', () => {
    expect(redact('a'.repeat(64))).toBe(`${'a'.repeat(12)}…`);
  });
});
