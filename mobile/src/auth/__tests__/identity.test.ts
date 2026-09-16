import { claimsOf, isStale } from '../identity';

/** base64url, by hand, so the test needs no Node types. */
const encode = (value: unknown): string =>
  globalThis
    .btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * The rules that keep signing in from breaking a match.
 *
 * During a match the phone is on the vest's own access point, which has no
 * route to the internet at all. Auth0 is on the internet. So every rule here
 * exists to make sure that an identity, once given, keeps working somewhere it
 * can never be revalidated.
 */

describe('an identity', () => {
  it('reads the claims out of an id token without a JWT library', () => {
    const payload = { sub: 'auth0|123', email: 'umpire@example.com', name: 'A Umpire', exp: 111 };
    const token = `header.${encode(payload)}.sig`;
    expect(claimsOf(token)).toEqual(payload);
  });

  it('survives a token it cannot read, rather than throwing at boot', () => {
    // A corrupt keystore entry must not be the reason the app will not start.
    expect(claimsOf('not-a-jwt')).toBeNull();
    expect(claimsOf('')).toBeNull();
    expect(claimsOf('a.!!!!.c')).toBeNull();
  });

  it('handles base64url padding, which is what real tokens use', () => {
    // '-' and '_' instead of '+' and '/', and no '=' padding. A decoder that
    // only handles standard base64 works on some tokens and not others, which
    // is the worst way for this to fail.
    const payload = { sub: 'auth0|?????>>>>', exp: 1 };
    const token = `h.${encode(payload)}.s`;
    expect(claimsOf(token)).toEqual(payload);
  });

  it('calls an expired session stale, not absent', () => {
    // The distinction is the whole design. An umpire whose token expired on
    // Saturday morning still knows who they are on Saturday afternoon, on a
    // network with no way to ask anybody.
    const hourAgo = Date.now() / 1000 - 3600;
    expect(isStale({ sub: 'x', email: null, name: null, expiresAt: hourAgo, signedInAt: 0 })).toBe(true);
    const hourAway = Date.now() / 1000 + 3600;
    expect(isStale({ sub: 'x', email: null, name: null, expiresAt: hourAway, signedInAt: 0 })).toBe(false);
  });

  it('treats no identity as not stale', () => {
    expect(isStale(null)).toBe(false);
  });
});
