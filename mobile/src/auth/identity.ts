/**
 * What an identity is, and the two questions asked about one.
 *
 * Kept apart from the store because these are pure functions over strings and
 * numbers, and a test of them should not need a keystore, a browser or an
 * OAuth library to run.
 */

export interface Identity {
  sub: string;
  email: string | null;
  name: string | null;
  /** Seconds since the epoch. Past it the identity is stale, not absent. */
  expiresAt: number;
  signedInAt: number;
}

/**
 * The id token's payload, without pulling in a JWT library for three fields.
 *
 * Not verification - Auth0 already did that, over TLS, before handing it back.
 * This only reads what is inside.
 */
export function claimsOf(idToken: string): Record<string, unknown> | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    // Base64url: '-' and '_' rather than '+' and '/', and the padding omitted.
    // A decoder that handles only standard base64 works on some real tokens and
    // not others, which is the worst available way for this to fail.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(globalThis.atob(padded)) as unknown;
    return typeof decoded === 'object' && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Past its expiry - which means "not checked recently", not "signed out".
 *
 * Nothing stops working when this is true. On a vest's access point there is no
 * way to renew, and an umpire in the middle of an over is not somebody to log
 * out because a clock passed a number.
 */
export function isStale(identity: Identity | null, now: number = Date.now() / 1000): boolean {
  return identity !== null && identity.expiresAt < now;
}
