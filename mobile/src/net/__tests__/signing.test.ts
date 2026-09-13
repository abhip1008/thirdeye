import vectors from '../../../../protocol/fixtures/signing-vectors.json';
import { signRequest } from '../signing';

/**
 * The phone builds HMAC-SHA256 itself, on top of the platform's SHA-256,
 * because the crypto library it has hashes but does not do HMAC.
 *
 * That means two independent implementations of the same function have to agree
 * exactly, forever, or a vest will refuse a phone in a car park with nothing to
 * look at but a 401. Both sides check against the same vector file.
 */

// expo-crypto is native. Here it stands in with Node's implementation of the
// same primitive - which is the point: if the construction above it is right,
// any correct SHA-256 underneath produces the same answer.
// The keystore is native too, and signRequest does not touch it - but
// signing.ts imports the module that wraps it, so it has to resolve.
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
}));

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const nodeCrypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_algorithm: string, data: Uint8Array) =>
      new Uint8Array(nodeCrypto.createHash('sha256').update(data).digest()).buffer,
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});

describe('request signing', () => {
  it.each(vectors)(
    'matches the vest on $method $path',
    async ({ key, method, path, timestamp, nonce, expected }) => {
      await expect(signRequest(key, method, path, timestamp, nonce)).resolves.toBe(expected);
    }
  );

  it('signs the timestamp as the exact string that goes on the wire', async () => {
    /* The bug this guards: one side rounded the seconds and the other
       truncated them, so roughly half of all requests failed for no visible
       reason. These two must differ, which they only do if the string is what
       is signed. */
    const key = 'ab'.repeat(32);
    const a = await signRequest(key, 'GET', '/x', '1800000000', 'n');
    const b = await signRequest(key, 'GET', '/x', '1800000001', 'n');
    expect(a).not.toBe(b);
  });

  it('produces a different signature for a different path', async () => {
    const key = 'ab'.repeat(32);
    const a = await signRequest(key, 'GET', '/clips/9.mp4', '1800000000', 'n');
    const b = await signRequest(key, 'GET', '/clips/8.mp4', '1800000000', 'n');
    expect(a).not.toBe(b);
  });

  it('produces a different signature for a different method', async () => {
    const key = 'ab'.repeat(32);
    const get = await signRequest(key, 'GET', '/x', '1800000000', 'n');
    const post = await signRequest(key, 'POST', '/x', '1800000000', 'n');
    expect(get).not.toBe(post);
  });

  it('handles a key longer than one hash block', async () => {
    // HMAC hashes an over-long key before use. Getting that branch wrong is
    // silent until someone configures a long key.
    const long = 'cd'.repeat(80);
    await expect(signRequest(long, 'GET', '/x', '1', 'n')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});
