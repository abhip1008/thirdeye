import type { ConnectionState, ServerMessage } from '@/types/protocol';
import { PROTOCOL_VERSION, parseServerMessage } from '@/types/protocol';

import { MockTransport } from '../mockTransport';

/**
 * The mock vest is what the entire Phase 1 app is judged against, so it has to
 * behave like a vest rather than like a convenient fiction. If it emits a
 * message the real protocol would reject, every screen above it is being
 * developed against something that cannot happen.
 *
 * Since the remote moved into the app it also has to behave like a vest that
 * takes orders: it no longer bowls on its own, it waits for markers.
 */

function harness(options: Partial<ConstructorParameters<typeof MockTransport>[0]> = {}) {
  const messages: ServerMessage[] = [];
  const states: ConnectionState[] = [];
  const transport = new MockTransport({
    matchId: '2026-09-07-marymoor',
    cameraId: 'vest-01',
    failureRate: 0,
    ...options,
  });
  transport.subscribe({
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
  });
  transport.connect();
  jest.advanceTimersByTime(500);
  return { transport, messages, states };
}

const mark = (t: MockTransport, seq: number, edge: 'start' | 'end', at: number) =>
  t.send({ v: PROTOCOL_VERSION, type: 'mark', seq, edge, at });

const clips = (messages: ServerMessage[]) => messages.filter((m) => m.type === 'clip_ready');
const sessions = (messages: ServerMessage[]) =>
  messages.filter((m) => m.type === 'session_state').map((m) => (m.type === 'session_state' ? m.state : ''));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const T = 1_757_193_000;

describe('coming up', () => {
  it('goes through connecting into connected', () => {
    const { transport, states } = harness();
    expect(states).toEqual(['connecting', 'connected']);
    transport.disconnect();
  });

  it('advertises its buffer depth, so the phone knows how long a marker stays usable', () => {
    const { transport, messages } = harness({ bufferSeconds: 300 });
    const hello = messages.find((m) => m.type === 'hello');
    if (hello?.type !== 'hello') throw new Error('no hello');
    expect(hello.buffer_seconds).toBe(300);
    expect(hello.ring_size).toBe(12);
    expect(hello.protocol).toBe(PROTOCOL_VERSION);
    transport.disconnect();
  });

  it('waits for the umpire rather than bowling on its own', () => {
    const { transport, messages } = harness();
    jest.advanceTimersByTime(120_000);
    expect(clips(messages)).toHaveLength(0);
    expect(sessions(messages)).toHaveLength(0);
    transport.disconnect();
  });

  it('emits nothing the real protocol parser would reject', () => {
    const { transport, messages } = harness();
    mark(transport, 1, 'start', T);
    mark(transport, 1, 'end', T + 14);
    jest.advanceTimersByTime(2_000);
    expect(messages.length).toBeGreaterThan(4);
    for (const m of messages) {
      expect(parseServerMessage(m)).not.toBeNull();
      expect(m.v).toBe(PROTOCOL_VERSION);
    }
    transport.disconnect();
  });
});

describe('markers', () => {
  it('opens on a start marker and closes on an end marker', () => {
    const { transport, messages } = harness();
    mark(transport, 1, 'start', T);
    expect(sessions(messages)).toEqual(['recording']);

    mark(transport, 1, 'end', T + 14);
    jest.advanceTimersByTime(500);
    expect(sessions(messages)).toEqual(['recording', 'idle']);

    const [clip] = clips(messages);
    if (clip?.type !== 'clip_ready') throw new Error('no clip');
    expect(clip.seq).toBe(1);
    expect(clip.duration_s).toBe(14);
    expect(clip.closed_by).toBe('button');
    transport.disconnect();
  });

  /* The reason the buffer exists: a missed first tap is recoverable, because
     the footage was never conditional on the marker arriving. */
  it('cuts backwards from the buffer when the start marker was missed', () => {
    const { transport, messages } = harness();
    mark(transport, 4, 'end', T + 14);
    jest.advanceTimersByTime(500);

    const [clip] = clips(messages);
    if (clip?.type !== 'clip_ready') throw new Error('no clip');
    expect(clip.seq).toBe(4);
    expect(clip.closed_by).toBe('recovered');
    transport.disconnect();
  });

  it('flags a delivery nobody ended as a timeout', () => {
    const { transport, messages } = harness();
    mark(transport, 1, 'start', T);
    mark(transport, 1, 'end', T + 40);
    jest.advanceTimersByTime(500);

    const [clip] = clips(messages);
    if (clip?.type !== 'clip_ready') throw new Error('no clip');
    expect(clip.closed_by).toBe('timeout');
    transport.disconnect();
  });

  /* An over's worth of markers held through a Wi-Fi outage, replayed at once.
     Every one of them must still produce a clip. */
  it('accepts a burst replayed after an outage', () => {
    const { transport, messages } = harness();
    for (let seq = 1; seq <= 6; seq++) {
      mark(transport, seq, 'start', T + seq * 40);
      mark(transport, seq, 'end', T + seq * 40 + 13);
    }
    jest.advanceTimersByTime(2_000);

    const seqs = clips(messages).map((m) => (m.type === 'clip_ready' ? m.seq : 0));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    transport.disconnect();
  });

  it('produces no clip at all for some deliveries, on purpose', () => {
    const { transport, messages } = harness({ failureRate: 1 });
    mark(transport, 1, 'start', T);
    mark(transport, 1, 'end', T + 14);
    jest.advanceTimersByTime(2_000);
    expect(clips(messages)).toHaveLength(0);
    // The state still came back to idle, so the app is not left thinking a ball
    // is live just because the clip went missing.
    expect(sessions(messages)).toEqual(['recording', 'idle']);
    transport.disconnect();
  });
});

describe('the clock', () => {
  it('answers a ping with its own time, so the phone can measure the offset', () => {
    const { transport, messages } = harness();
    transport.send({ v: PROTOCOL_VERSION, type: 'ping', t: 1_757_193_045.1 });
    jest.advanceTimersByTime(100);

    const pong = messages.find((m) => m.type === 'pong');
    if (pong?.type !== 'pong') throw new Error('no pong');
    expect(pong.t).toBe(1_757_193_045.1);
    expect(pong.vest_time).toBeGreaterThan(0);
    transport.disconnect();
  });
});

describe('grabbing one that got away', () => {
  it('cuts straight from the buffer and flags it manual', () => {
    const { transport, messages } = harness();
    transport.grabLastSeconds(20);
    const [clip] = clips(messages);
    if (clip?.type !== 'clip_ready') throw new Error('no clip');
    expect(clip.closed_by).toBe('manual');
    expect(clip.duration_s).toBe(20);
    transport.disconnect();
  });
});

describe('demo mode', () => {
  it('bowls on a timer when asked, for showing a whole over', () => {
    const { transport, messages } = harness({ ballIntervalSeconds: 10, recordingSeconds: 4 });
    jest.advanceTimersByTime(45_000);
    expect(clips(messages).length).toBeGreaterThan(2);
    transport.disconnect();
  });

  it('stops emitting once disconnected', () => {
    const { transport, messages } = harness({ ballIntervalSeconds: 10 });
    jest.advanceTimersByTime(11_000);
    transport.disconnect();
    const before = messages.length;
    jest.advanceTimersByTime(120_000);
    expect(messages).toHaveLength(before);
  });
});
