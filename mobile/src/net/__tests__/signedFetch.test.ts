import { signedFetch } from '../signedFetch';
import { resetVestClock, vestOffset } from '../vestClock';

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async () => 'ab'.repeat(32),
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
 * The failure this exists for: a vest that believes it is three days ago
 * refuses every signed request, and an umpire standing in a field has no way to
 * set its clock. One refusal has to be enough to fix it.
 */

interface Attempt {
  url: string;
  headers: Record<string, string>;
}

let attempts: Attempt[] = [];

/** 401 with the vest's clock, then 200 - what a skewed vest actually does. */
const vestWhoseClockIsWrong = (vestTime: number, refusals = 1) => {
  let refused = 0;
  return jest.fn(async (url: string, init: RequestInit) => {
    attempts.push({ url, headers: init.headers as Record<string, string> });
    if (refused++ < refusals) {
      return {
        status: 401,
        ok: false,
        headers: { get: (k: string) => (k === 'X-TE-Time' ? String(vestTime) : null) },
      };
    }
    return { status: 200, ok: true, headers: { get: () => null } };
  });
};

beforeEach(() => {
  attempts = [];
  resetVestClock();
});

describe('a signed request', () => {
  it('retries once against the clock the vest sent back', async () => {
    const vestTime = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    globalThis.fetch = vestWhoseClockIsWrong(vestTime) as unknown as typeof fetch;

    const response = await signedFetch('192.168.43.1', '/api/clips');

    expect(response.status).toBe(200);
    expect(attempts).toHaveLength(2);

    // The second attempt is stamped in the vest's time, not the phone's.
    const stamped = Number(attempts[1]!.headers['X-TE-Timestamp']);
    expect(Math.abs(stamped - vestTime)).toBeLessThan(5);

    // And a fresh nonce, so the vest does not see it as a replay of the first.
    expect(attempts[1]!.headers['X-TE-Nonce']).not.toBe(attempts[0]!.headers['X-TE-Nonce']);
  });

  it('leaves the offset corrected, so the next request is right first time', async () => {
    const vestTime = Math.floor(Date.now() / 1000) + 4000;
    globalThis.fetch = vestWhoseClockIsWrong(vestTime) as unknown as typeof fetch;

    await signedFetch('192.168.43.1', '/api/clips');
    expect(vestOffset()).toBeCloseTo(4000, -1);
  });

  it('gives up after one retry, because a second refusal is not the clock', async () => {
    // A wrong key refuses every time. Retrying in a loop would turn one clear
    // failure into a flood that hides it.
    globalThis.fetch = vestWhoseClockIsWrong(Date.now() / 1000 - 9000, 99) as unknown as typeof fetch;

    const response = await signedFetch('192.168.43.1', '/api/clips');
    expect(response.status).toBe(401);
    expect(attempts).toHaveLength(2);
  });

  it('does not retry a 401 that carries no clock', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      attempts.push({ url, headers: init.headers as Record<string, string> });
      return { status: 401, ok: false, headers: { get: () => null } };
    }) as unknown as typeof fetch;

    await signedFetch('192.168.43.1', '/api/clips');
    expect(attempts).toHaveLength(1);
  });

  it('keeps the caller headers, which is how a resumed download stays resumed', async () => {
    globalThis.fetch = vestWhoseClockIsWrong(Date.now() / 1000 - 9000) as unknown as typeof fetch;

    await signedFetch('192.168.43.1', '/clips/4.mp4', { headers: { Range: 'bytes=900-' } });

    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.headers.Range).toBe('bytes=900-');
  });

  it('signs the path it is actually asking for', async () => {
    globalThis.fetch = vestWhoseClockIsWrong(0, 0) as unknown as typeof fetch;
    await signedFetch('192.168.43.1', '/clips/4.mp4');
    expect(attempts[0]!.url).toBe('http://192.168.43.1/clips/4.mp4');
    expect(attempts[0]!.headers['X-TE-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });
});
