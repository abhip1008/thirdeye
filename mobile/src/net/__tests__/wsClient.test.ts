import { WebSocketTransport } from '../wsClient';

/**
 * Signing made opening the channel asynchronous, and asynchronous opening is
 * where a reconnecting client grows a second socket nobody is listening to.
 * These tests are about that gap, not about the signature arithmetic - that is
 * in signing.test.ts.
 */

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

/** Records every socket anyone opens, and opens none of them. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
}

/** Lets every pending promise run, so the async open finishes. */
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

beforeEach(() => {
  FakeSocket.opened = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});

describe('the control channel', () => {
  it('signs the handshake in the URL', async () => {
    const transport = new WebSocketTransport('192.168.43.1');
    transport.connect();
    await settle();

    expect(FakeSocket.opened).toHaveLength(1);
    expect(FakeSocket.opened[0]!.url).toMatch(
      /^ws:\/\/192\.168\.43\.1\/ws\?ts=\d+&nonce=[0-9a-f]{24}&sig=[0-9a-f]{64}$/
    );
    transport.disconnect();
  });

  it('opens exactly one socket when connect is called twice in the gap', async () => {
    // Two calls before the first signature comes back. Without the guard, both
    // reach `new WebSocket` and one of the two sockets is then unreachable -
    // still connected to the vest, delivering messages to nobody.
    const transport = new WebSocketTransport('vest');
    transport.connect();
    transport.connect();
    await settle();

    expect(FakeSocket.opened).toHaveLength(1);
    transport.disconnect();
  });

  it('does not open a socket when disconnect lands while it is signing', async () => {
    const transport = new WebSocketTransport('vest');
    transport.connect();
    transport.disconnect(); // before the await inside open() resolves
    await settle();

    expect(FakeSocket.opened).toHaveLength(0);
  });

  it('reports connected only once the vest accepts', async () => {
    const states: string[] = [];
    const transport = new WebSocketTransport('vest');
    transport.subscribe({ onMessage: () => {}, onState: (s) => states.push(s) });
    transport.connect();
    await settle();

    expect(states).toEqual(['connecting']);
    FakeSocket.opened[0]!.accept();
    expect(states).toEqual(['connecting', 'connected']);
    transport.disconnect();
  });

  it('refuses to send while the channel is not open', async () => {
    const transport = new WebSocketTransport('vest');
    transport.connect();
    await settle();

    // A marker must never be dropped silently: the caller queues it to disk.
    expect(() => transport.send({ v: 1, type: 'ping', t: 1 })).toThrow(/not open/);
    transport.disconnect();
  });

  it('reconnects after the vest goes away', async () => {
    // setImmediate stays real: it is how these tests let the signing promise
    // finish, and a faked one would never run.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const transport = new WebSocketTransport('vest', [10]);
      transport.connect();
      await settle();
      FakeSocket.opened[0]!.accept();

      FakeSocket.opened[0]!.onclose?.({ code: 1006 });
      jest.advanceTimersByTime(20);
      await settle();

      expect(FakeSocket.opened).toHaveLength(2);
      transport.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps trying after the vest rejects the signature', async () => {
    // 1008 means the key is wrong, which retrying will not fix - but stopping
    // would leave a phone that merely looks offline, which is worse.
    // setImmediate stays real: it is how these tests let the signing promise
    // finish, and a faked one would never run.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const transport = new WebSocketTransport('vest', [10]);
      transport.connect();
      await settle();

      FakeSocket.opened[0]!.onclose?.({ code: 1008 });
      jest.advanceTimersByTime(20);
      await settle();

      expect(FakeSocket.opened).toHaveLength(2);
      transport.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });
});
