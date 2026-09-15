/** The port the vest serves on. Not 80, which is what a bare address means. */
const VEST_PORT = '8000';

/**
 * A hand-typed vest address, with a port whether or not one was typed.
 *
 * Somebody reading an address off the side of a vest types an address, not a
 * socket. Without a port the app dials 80, where nothing is listening, and that
 * is the worst failure this link has available: no connection is made rather
 * than refused, so the vest's log stays completely empty, the app sits on
 * "connecting" forever, and it looks identical to a wrong address, the wrong
 * network, or a vest that is switched off.
 *
 * A port that was typed is kept, so a vest behind something else still works.
 */
export function withPort(host: string): string {
  const trimmed = host.trim().replace(/^\w+:\/\//, '').replace(/\/+$/, '');
  return /:\d+$/.test(trimmed) ? trimmed : `${trimmed}:${VEST_PORT}`;
}
