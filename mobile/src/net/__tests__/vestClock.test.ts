import { signRequest } from '../signing';
import {
  correctTo,
  observeHealth,
  observePong,
  resetVestClock,
  vestNow,
  vestOffset,
} from '../vestClock';

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const nodeCrypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_a: string, d: Uint8Array) =>
      new Uint8Array(nodeCrypto.createHash('sha256').update(d).digest()).buffer,
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});


/**
 * A vest has no real-time clock and no internet at a ground. It boots believing
 * it is whenever it was last switched off, and every signed request the phone
 * makes is refused for being minutes - or days - from that. These are the rules
 * that make that survivable without weakening what the timestamp is for.
 */

beforeEach(() => resetVestClock());

const DAYS = 3 * 24 * 3600;

describe('the vest clock', () => {
  it('is the phone clock until the vest has said otherwise', () => {
    expect(vestOffset()).toBe(0);
    expect(Math.abs(vestNow() - Date.now() / 1000)).toBeLessThan(1);
  });

  it('adopts a correction the vest sent back with a refusal', () => {
    const vestThinks = Date.now() / 1000 - DAYS;
    expect(correctTo(vestThinks)).toBe(true);
    expect(vestNow()).toBeCloseTo(vestThinks, 0);
  });

  it('ignores a correction of under a second', () => {
    // Two clocks are never identical. Retrying over a fraction of a second
    // would mean retrying requests that were refused for some other reason.
    expect(correctTo(Date.now() / 1000 + 0.4)).toBe(false);
    expect(vestOffset()).toBe(0);
  });

  it('keeps the pong with the shortest round trip, not the newest', () => {
    const now = Date.now() / 1000;
    observePong(now + 100, now - 0.02, now); // 20ms round trip
    const good = vestOffset();

    observePong(now + 130, now - 2.0, now); // 2s round trip, wilder guess
    expect(vestOffset()).toBeCloseTo(good, 3);
  });

  it('lets health seed the offset before anything has been signed', () => {
    // This is the only source available before the first signed request, which
    // is exactly when the phone first meets a vest whose clock is wrong.
    observeHealth(Date.now() / 1000 - DAYS);
    expect(vestNow()).toBeLessThan(Date.now() / 1000 - DAYS + 5);
  });

  it('does not let health overwrite a measured round trip', () => {
    const now = Date.now() / 1000;
    observePong(now + 100, now - 0.02, now);
    const measured = vestOffset();
    observeHealth(now + 400);
    expect(vestOffset()).toBeCloseTo(measured, 3);
  });

  it('lets a refusal overrule a pong, because it is not an estimate', () => {
    const now = Date.now() / 1000;
    observePong(now + 100, now - 0.02, now);
    correctTo(now + 900);
    expect(vestOffset()).toBeCloseTo(900, 0);
  });

  it('signs in vest time, so a vest days out still gets a usable timestamp', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const vestThinks = 1_800_000_000 - DAYS;
      correctTo(vestThinks);

      // What signFor would stamp, and what the vest would compare it against.
      const stamped = String(Math.floor(vestNow()));
      expect(Number(stamped)).toBeCloseTo(vestThinks, -1);
      expect(Math.abs(Number(stamped) - vestThinks)).toBeLessThan(300);

      // And it is still a real signature over that string.
      await expect(
        signRequest('ab'.repeat(32), 'GET', '/api/clips', stamped, 'n')
      ).resolves.toMatch(/^[0-9a-f]{64}$/);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });
});
