import fixture from '../../../../protocol/fixtures/protocol.v1.json';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  type ClipMeta,
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
      new Set(['hello', 'clip_ready', 'clip_expired', 'session_state', 'status', 'pong'])
    );
  });

  it('parses every client message in the fixture', () => {
    const types = fixture.client_messages.map((raw) => {
      const parsed = parseClientMessage(raw);
      expect(parsed).not.toBeNull();
      return parsed!.type;
    });
    expect(new Set(types)).toEqual(new Set(['ack', 'pin', 'ping', 'resync']));
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
