/**
 * Not part of the suite: this one needs a vest on the other end.
 *
 *     THIRDEYE_KEY_PATH=... python -m thirdeye.pairing   # on the vest, for the key
 *     TE_KEY=<that key> TE_HOST=192.168.43.1 npm run test:live
 *
 * The unit tests prove the phone and the vest compute the same signature. This
 * proves the rest of it: that the headers the app actually builds are the
 * headers the running service accepts, that the query string opens a real
 * control channel, and that without either one the vest says no. Those are
 * three different things and only the first is arithmetic.
 */
import { signedFetch } from '../signedFetch';
import { signedHeaders, signedQuery } from '../signing';
import { correctTo, resetVestClock, vestOffset } from '../vestClock';

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async () => process.env.TE_KEY ?? null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
}));
jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_a: string, d: Uint8Array) =>
      new Uint8Array(nodeCrypto.createHash('sha256').update(d).digest()).buffer,
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});

const HOST = process.env.TE_HOST ?? '127.0.0.1:8000';

describe('against the live vest', () => {
  it('is refused without a signature', async () => {
    const r = await fetch(`http://${HOST}/api/clips`);
    expect(r.status).toBe(401);
  });

  it('is accepted with headers the app itself produced', async () => {
    const r = await fetch(`http://${HOST}/api/clips`, {
      headers: await signedHeaders('GET', '/api/clips'),
    });
    expect(r.status).toBe(200);
  });

  it('opens the control channel with the query the app itself produced', async () => {
    const query = await signedQuery('/ws');
    expect(query).toMatch(/^\?ts=\d+&nonce=[0-9a-f]{24}&sig=[0-9a-f]{64}$/);
    const hello = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}/ws${query}`);
      ws.onmessage = (e) => { resolve(String(e.data)); ws.close(); };
      ws.onclose = (e) => reject(new Error(`closed ${e.code}`));
      setTimeout(() => reject(new Error('timed out')), 5000);
    });
    expect(JSON.parse(hello).type).toBe('hello');
  });

  it('recovers from two clocks that disagree, without anyone touching the vest', async () => {
    // The field failure this exists for: a vest has no real-time clock and no
    // internet, so it boots believing it is whenever it was last switched off.
    // Here the phone is the one that is wrong, which is the same problem from
    // the other side - what matters is that they disagree by more than the
    // window, and that one refusal is enough to fix it.
    resetVestClock();
    correctTo(Date.now() / 1000 + 9000);
    expect(vestOffset()).toBeGreaterThan(8000);

    const r = await signedFetch(HOST, '/api/clips');

    expect(r.status).toBe(200);
    expect(Math.abs(vestOffset())).toBeLessThan(5); // corrected to the vest's own clock
    resetVestClock();
  });

  it('refuses the control channel with no signature', async () => {
    // The vest closes before it accepts, so the handshake itself fails and a
    // client never sees a close code. What matters is that nothing arrives.
    const opened = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}/ws`);
      ws.onclose = () => resolve(false);
      ws.onerror = () => resolve(false);
      ws.onmessage = () => { ws.close(); resolve(true); };
      setTimeout(() => reject(new Error('timed out')), 5000);
    });
    expect(opened).toBe(false);
  });
});
