import { log } from '@/lib/log';

import { signedHeaders } from './signing';
import { correctTo } from './vestClock';

/**
 * Every signed request the phone makes to the vest goes through here.
 *
 * It exists for one failure that is otherwise unrecoverable in the field. A
 * signature carries a timestamp and the vest refuses one more than five minutes
 * from its own clock. The vest has no real-time clock and no internet, so on the
 * first morning of a season it can easily believe it is several days ago - and
 * then every request the phone makes is refused, the app shows a vest that will
 * not talk, and there is nothing an umpire standing in a field can do about it.
 *
 * So a refusal comes back with the vest's own clock in `X-TE-Time`, the phone
 * adopts it, and the request is sent again. One retry: if the second attempt is
 * refused too, the problem is the key, not the clock, and trying repeatedly
 * would only make that harder to see in a log.
 */
export async function signedFetch(
  host: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const method = init.method ?? 'GET';

  const send = async (): Promise<Response> =>
    fetch(`http://${host}${path}`, {
      ...init,
      headers: {
        ...((init.headers as Record<string, string> | undefined) ?? {}),
        ...(await signedHeaders(method, path)),
      },
    });

  const response = await send();
  if (response.status !== 401) return response;

  const vestTime = Number(response.headers.get('X-TE-Time'));
  if (!Number.isFinite(vestTime) || vestTime <= 0) return response;

  // correctTo returns false when the offset barely moves, which means the clock
  // was not the problem and a second identical attempt would fail identically.
  if (!correctTo(vestTime)) return response;

  log.info('link', `the vest's clock is elsewhere; signing in its time and retrying ${path}`);
  return send();
}
