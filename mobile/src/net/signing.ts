import * as Crypto from 'expo-crypto';

import { secrets } from '@/privacy/secrets';

import { vestNow } from './vestClock';

/**
 * Proving to the vest that a request came from this phone.
 *
 * The vest's Wi-Fi passphrase is printed on a code taped to the vest, so
 * joining the network proves nothing about who you are. Every request is signed
 * with a key that reaches the phone once, inside the pairing code, and lives in
 * the keystore afterwards - it is never sent over the link and never displayed.
 *
 *     signature = HMAC-SHA256(key, method \n path \n timestamp \n nonce)
 *
 * The same four lines are assembled on the vest. The timestamp is signed as the
 * string that goes on the wire rather than as a number formatted at each end:
 * the first version of this rounded on one side and truncated on the other, and
 * signatures failed or passed depending on the fractional part of the second.
 *
 * It is stamped in *vest* time, not phone time. The vest refuses a timestamp
 * more than five minutes from its own clock, and a vest has no real-time clock
 * and no internet at a ground - it boots believing it is whenever it was last
 * switched off. See `vestClock.ts`.
 */

const BLOCK_SIZE = 64; // SHA-256 operates on 64-byte blocks

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));

const bytes = (length: number): Uint8Array<ArrayBuffer> => new Uint8Array(new ArrayBuffer(length));

const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = bytes(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};

const toHex = (value: Uint8Array): string =>
  Array.from(value)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * HMAC-SHA256, built from the platform's SHA-256.
 *
 * `expo-crypto` hashes but does not do HMAC, and HMAC is a construction over a
 * hash rather than a different primitive - so it is assembled here instead of
 * pulling in a JavaScript implementation of the hash itself, which would be
 * both slower and a dependency holding the one secret this app has.
 */
async function hmacSha256(keyHex: string, message: string): Promise<string> {
  let key = fromHex(keyHex);
  if (key.length > BLOCK_SIZE) key = await sha256(key);

  const padded = bytes(BLOCK_SIZE);
  padded.set(key);

  const inner = bytes(BLOCK_SIZE);
  const outer = bytes(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] = padded[i]! ^ 0x36;
    outer[i] = padded[i]! ^ 0x5c;
  }

  const body = new TextEncoder().encode(message);
  const innerInput = bytes(inner.length + body.length);
  innerInput.set(inner, 0);
  innerInput.set(body, inner.length);
  const innerHash = await sha256(innerInput);

  const outerInput = bytes(outer.length + innerHash.length);
  outerInput.set(outer, 0);
  outerInput.set(innerHash, outer.length);
  return toHex(await sha256(outerInput));
}

export interface Signature {
  timestamp: string;
  nonce: string;
  signature: string;
}

/** Exposed for the contract test, which checks this against the vest's output. */
export async function signRequest(
  keyHex: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string
): Promise<string> {
  return hmacSha256(keyHex, `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`);
}

const newNonce = (): string => toHex(new Uint8Array(Crypto.getRandomBytes(12)));

/**
 * Signs one request, or returns null when this phone has no key.
 *
 * Null is not a failure. A vest running with signature checking off - which is
 * how development works, and only development - accepts unsigned requests, and
 * a phone paired before signing existed has no key to use. The caller sends
 * what it has and the vest decides.
 */
export async function signFor(method: string, path: string): Promise<Signature | null> {
  const key = await secrets.getRequestPsk();
  if (!key) return null;

  const timestamp = String(Math.floor(vestNow()));
  const nonce = newNonce();
  return { timestamp, nonce, signature: await signRequest(key, method, path, timestamp, nonce) };
}

/** Headers for an HTTP request. */
export async function signedHeaders(method: string, path: string): Promise<Record<string, string>> {
  const signed = await signFor(method, path);
  if (!signed) return {};
  return {
    'X-TE-Timestamp': signed.timestamp,
    'X-TE-Nonce': signed.nonce,
    'X-TE-Signature': signed.signature,
  };
}

/**
 * Query string for the control channel.
 *
 * The WebSocket cannot carry headers: neither a browser nor React Native lets
 * you set them on the opening request, so the URL is the only thing every
 * client can sign.
 */
export async function signedQuery(path: string): Promise<string> {
  const signed = await signFor('GET', path);
  if (!signed) return '';
  return `?ts=${signed.timestamp}&nonce=${signed.nonce}&sig=${signed.signature}`;
}
