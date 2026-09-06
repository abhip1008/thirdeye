import type { ConnectionState, ServerMessage } from '@/types/protocol';
import { PROTOCOL_VERSION, parseServerMessage } from '@/types/protocol';

import { MockTransport } from '../mockTransport';

/**
 * The mock vest is what the entire Phase 1 app is judged against, so it has to
 * behave like a vest rather than like a convenient fiction. If it emits a
 * message the real protocol would reject, every screen above it is being
 * developed against something that cannot happen.
 */

function harness(options: Partial<ConstructorParameters<typeof MockTransport>[0]> = {}) {
  const messages: ServerMessage[] = [];
  const states: ConnectionState[] = [];
  const transport = new MockTransport({
    matchId: '2026-09-06-marymoor',
    cameraId: 'vest-01',
    failureRate: 0,
    ballIntervalSeconds: 10,
    recordingSeconds: 4,
    ...options,
  });
  transport.subscribe({
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
  });
  return { transport, messages, states };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('the vest that does not exist', () => {
  it('comes up through connecting into connected', () => {
    const { transport, states } = harness();
    transport.connect();
    expect(states).toEqual(['connecting']);
    jest.advanceTimersByTime(500);
    expect(states).toEqual(['connecting', 'connected']);
    transport.disconnect();
  });

  it('introduces itself with a version and a ring size the phone can mirror', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(500);

    const hello = messages.find((m) => m.type === 'hello');
    expect(hello).toBeDefined();
    if (hello?.type !== 'hello') throw new Error('unreachable');
    expect(hello.protocol).toBe(PROTOCOL_VERSION);
    expect(hello.ring_size).toBe(12);
    expect(hello.camera_id).toBe('vest-01');
    transport.disconnect();
  });

  it('emits nothing the real protocol parser would reject', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(60_000);

    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) {
      expect(parseServerMessage(m)).not.toBeNull();
      expect(m.v).toBe(PROTOCOL_VERSION);
    }
    transport.disconnect();
  });

  it('bowls: recording, then idle, then a clip', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(500);

    const order = messages
      .filter((m) => m.type === 'session_state' || m.type === 'clip_ready')
      .map((m) => (m.type === 'session_state' ? m.state : 'clip'));
    expect(order).toEqual(['recording']);

    jest.advanceTimersByTime(4_100);
    const after = messages
      .filter((m) => m.type === 'session_state' || m.type === 'clip_ready')
      .map((m) => (m.type === 'session_state' ? m.state : 'clip'));
    expect(after).toEqual(['recording', 'idle', 'clip']);
    transport.disconnect();
  });

  it('numbers deliveries monotonically, wides and all', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(45_000);

    const seqs = messages.filter((m) => m.type === 'clip_ready').map((m) => m.seq);
    expect(seqs.length).toBeGreaterThan(2);
    expect([...seqs]).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    transport.disconnect();
  });

  it('answers a ping so the heartbeat can measure a round trip', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(500);

    transport.send({ v: PROTOCOL_VERSION, type: 'ping', t: 1_757_193_045.1 });
    jest.advanceTimersByTime(100);

    const pong = messages.find((m) => m.type === 'pong');
    if (pong?.type !== 'pong') throw new Error('no pong');
    expect(pong.t).toBe(1_757_193_045.1);
    transport.disconnect();
  });

  it('holds the list still when frozen, without dropping the link', () => {
    const { transport, messages, states } = harness({ ballIntervalSeconds: 0 });
    transport.connect();
    jest.advanceTimersByTime(120_000);

    expect(states).toContain('connected');
    expect(messages.filter((m) => m.type === 'clip_ready')).toHaveLength(0);
    // Still alive: health keeps arriving, which is what "frozen" has to mean.
    expect(messages.filter((m) => m.type === 'status').length).toBeGreaterThan(1);
    transport.disconnect();
  });

  it('grabs the last twenty seconds on demand, flagged as a manual cut', () => {
    const { transport, messages } = harness({ ballIntervalSeconds: 0 });
    transport.connect();
    jest.advanceTimersByTime(500);

    transport.grabLastSeconds();
    const clip = messages.find((m) => m.type === 'clip_ready');
    if (clip?.type !== 'clip_ready') throw new Error('no clip');
    expect(clip.closed_by).toBe('manual');
    expect(clip.duration_s).toBe(20);
    transport.disconnect();
  });

  it('stops emitting once disconnected', () => {
    const { transport, messages } = harness();
    transport.connect();
    jest.advanceTimersByTime(500);
    transport.disconnect();

    const before = messages.length;
    jest.advanceTimersByTime(120_000);
    expect(messages).toHaveLength(before);
  });

  it('reports the failure path by default, so grey dots are seen in development', () => {
    const { transport, messages } = harness({ failureRate: 1 });
    transport.connect();
    jest.advanceTimersByTime(45_000);

    expect(messages.filter((m) => m.type === 'session_state').length).toBeGreaterThan(2);
    expect(messages.filter((m) => m.type === 'clip_ready')).toHaveLength(0);
    transport.disconnect();
  });
});
