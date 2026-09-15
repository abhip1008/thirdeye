import { withPort } from '@/net/address';

/**
 * A missing port is the worst failure mode this link has: the phone dials 80,
 * nothing is listening, so no connection is made rather than refused. The vest
 * logs nothing at all, the app sits on "connecting", and it is indistinguishable
 * from a wrong address, the wrong network, or a vest that is switched off.
 *
 * Found by pointing a phone at a real vest for the first time.
 */
describe('a hand-typed vest address', () => {
  it('gets the port the vest actually serves on', () => {
    expect(withPort('192.168.4.82')).toBe('192.168.4.82:8000');
  });

  it('keeps a port that was typed, for a vest behind something else', () => {
    expect(withPort('192.168.4.82:80')).toBe('192.168.4.82:80');
    expect(withPort('vest.local:9000')).toBe('vest.local:9000');
  });

  it('tolerates what people actually type', () => {
    expect(withPort('  192.168.4.82  ')).toBe('192.168.4.82:8000');
    expect(withPort('http://192.168.4.82')).toBe('192.168.4.82:8000');
    expect(withPort('192.168.4.82/')).toBe('192.168.4.82:8000');
  });
});
