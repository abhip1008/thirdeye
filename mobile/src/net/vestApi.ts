import { log } from '@/lib/log';

import { signedFetch } from './signedFetch';
import { observeHealth } from './vestClock';

/**
 * The few things the phone asks of the vest over plain HTTP rather than the
 * control channel. Everything ongoing goes over the WebSocket; these are the
 * one-off requests around the edges of a match.
 */

const timeout = (ms: number) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(id) };
};

export interface VestHealth {
  ok: boolean;
  /** The vest's own clock. Unsigned, because this is the route that is. */
  vest_time?: number;
  camera_id: string;
  firmware: string;
  protocol: number;
  recording: boolean;
  buffer_held_s: number;
}

export async function vestHealth(host: string, ms = 4000): Promise<VestHealth | null> {
  const t = timeout(ms);
  try {
    // Health is the one route the vest leaves unsigned: it is what the phone
    // calls to find out whether there is a vest there at all, and it says
    // nothing a stranger on the network could not learn by looking at the vest.
    const response = await fetch(`http://${host}/api/health`, { signal: t.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as VestHealth;
    // The cheapest place to learn the vest's clock, and the only one that works
    // before anything has been signed.
    if (typeof body.vest_time === 'number') observeHealth(body.vest_time);
    return body;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/**
 * Tell the vest a match has begun.
 *
 * Without this the vest refuses markers, because a marker outside a match has
 * nowhere to put a clip. The two sides keep their own match identifiers - the
 * phone's is what its database is keyed on and the vest's is what its file
 * paths use - and neither needs the other's.
 */
export async function startVestSession(host: string, venue: string): Promise<string | null> {
  const t = timeout(6000);
  try {
    const response = await signedFetch(host, '/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue }),
      signal: t.signal,
    });
    if (!response.ok) {
      log.warn('vest', `could not start a session: ${response.status}`);
      return null;
    }
    const body = (await response.json()) as { match_id: string };
    log.info('vest', `vest is recording match ${body.match_id}`);
    return body.match_id;
  } catch (e) {
    log.warn('vest', 'could not reach the vest to start a session', { error: String(e) });
    return null;
  } finally {
    t.done();
  }
}
