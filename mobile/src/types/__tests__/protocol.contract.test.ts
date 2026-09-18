import fixture from '../../../../protocol/fixtures/protocol.v1.json';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type ClipMeta,
  type MarkMessage,
  type PairingPayload,
} from '../protocol';

/**
 * The phone half of the contract test.
 *
 * `vest/tests/test_protocol_contract.py` reads the same file. Between the two,
 * a protocol change that only one side was told about fails a build rather than
 * a match.
 */
describe('protocol v1 contract', () => {
  it('agrees with the fixture on the version', () => {
    expect(fixture.protocol_version).toBe(PROTOCOL_VERSION);
  });

  it('parses every server message in the fixture', () => {
    const types = fixture.server_messages.map((raw) => {
      const parsed = parseServerMessage(raw);
      expect(parsed).not.toBeNull();
      return parsed!.type;
    });
    expect(new Set(types)).toEqual(
      new Set([
        'hello',
        'clip_ready',
        'clip_expired',
        'session_state',
        'marker_refused',
        'status',
        'pong',
      ])
    );
  });

  it('parses every client message in the fixture', () => {
    const types = fixture.client_messages.map((raw) => {
      const parsed = parseClientMessage(raw);
      expect(parsed).not.toBeNull();
      return parsed!.type;
    });
    expect(new Set(types)).toEqual(new Set(['ack', 'pin', 'mark', 'ping', 'resync']));
  });

  /* The marker replaced the BLE remote, so it is now the only way a delivery is
     ever recorded. It is the one message that cannot be guessed at: without an
     edge the vest does not know which end of the delivery this is, and without a
     vest-clock timestamp it cannot find the footage in its buffer. */
  it('carries an edge and a vest-clock timestamp on every delivery marker', () => {
    const marks = fixture.client_messages.filter(
      (m) => m.type === 'mark'
    ) as unknown as MarkMessage[];
    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((m) => m.edge))).toEqual(new Set(['start', 'end']));
    for (const m of marks) expect(m.at).toBeGreaterThan(0);
    // One is a replay held through an outage; it must parse identically.
    expect(marks.some((m) => 'queued' in m && m.queued)).toBe(true);
  });

  it('rejects a marker with no edge', () => {
    expect(parseClientMessage(fixture.rejected.mark_missing_edge)).toBeNull();
  });

  it('accepts the clip metadata shape, nullable score fields included', () => {
    const clip = fixture.clip_meta as unknown as ClipMeta;
    expect(clip.camera_id).toBe('vest-01');
    expect(clip.closed_by).toBe('button');
    expect(clip.sha256).toHaveLength(64);
  });

  it('accepts the pairing payload with no shared secret yet', () => {
    const payload = fixture.pairing_payload as unknown as PairingPayload;
    expect(payload.host).toBeTruthy();
    expect(payload.psk).toBeNull();
  });

  /* A validator that accepts everything is worse than no validator at all. */
  it.each([
    ['a message missing a required field', 'missing_required_field'],
    ['an unrecognised message type', 'unknown_message_type'],
    ['something that is not an object', 'not_an_object'],
  ])('rejects %s', (_label, key) => {
    const bad = (fixture.rejected as Record<string, unknown>)[key];
    expect(parseServerMessage(bad)).toBeNull();
  });

  it('ignores an unknown type rather than throwing, so either side can upgrade', () => {
    expect(() => parseServerMessage({ v: 2, type: 'from_the_future' })).not.toThrow();
  });
});

describe('what a clip announcement carries', () => {
  /**
   * The phone used to fill these in itself, with constants: 1920x1200, 60fps,
   * h265. Those were the production sensor's mode and nothing else's, and the
   * review screen steps frames with `fps` - so against a camera recording
   * 1296x972 at 30, every press of "one frame" advanced half of one, and
   * nothing anywhere could tell that the number was wrong.
   *
   * The vest measures them from the file it just wrote. It says them now.
   */
  const announcement = {
    v: 1,
    type: 'clip_ready',
    seq: 4,
    camera_id: 'vest-01',
    bytes: 4463293,
    sha256: 'a'.repeat(64),
    duration_s: 10.6,
    closed_by: 'button',
    resolution: '1296x972',
    fps: 30,
    codec: 'h264',
    preroll_s: 5,
  };

  it('carries what the vest measured', () => {
    const parsed = parseServerMessage(announcement);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ resolution: '1296x972', fps: 30, codec: 'h264' });
  });

  it('still accepts an announcement from a vest too old to measure', () => {
    // Unknown is a fine answer. A phone that rejected the message, or filled the
    // gap with a plausible number, would both be worse.
    const older = { ...announcement };
    delete (older as Partial<typeof announcement>).resolution;
    delete (older as Partial<typeof announcement>).fps;
    delete (older as Partial<typeof announcement>).codec;
    delete (older as Partial<typeof announcement>).preroll_s;
    expect(parseServerMessage(older)).not.toBeNull();
  });

  it('carries the pre-roll the vest used, not a number the phone chose', () => {
    // The phone has no say in this: the cut happens on the vest, with the vest's
    // setting. A pre-roll dial on the phone was wired to nothing at all.
    expect(parseServerMessage(announcement)).toMatchObject({ preroll_s: 5 });
  });
});
