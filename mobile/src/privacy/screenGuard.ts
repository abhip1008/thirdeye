import * as ScreenCapture from 'expo-screen-capture';

import { log } from '@/lib/log';

/**
 * Blocks screenshots and screen recording, and blanks the app in the recent-apps
 * switcher, while a match is open.
 *
 * The reason is not secrecy, it is scope: the retention promise made to players
 * is that footage of them is deleted after twelve balls. A screenshot escapes
 * that promise entirely and lands in a camera roll that syncs to a cloud the
 * league has no relationship with. This is the cheapest way to close that hole.
 *
 * No effect in Expo Go on some platforms, so it is best-effort and never fatal.
 */
export async function enableScreenGuard(): Promise<void> {
  try {
    await ScreenCapture.preventScreenCaptureAsync('thirdeye-match');
    log.debug('privacy', 'screen capture blocked');
  } catch (e) {
    log.warn('privacy', 'could not block screen capture', { error: String(e) });
  }
}

export async function disableScreenGuard(): Promise<void> {
  try {
    await ScreenCapture.allowScreenCaptureAsync('thirdeye-match');
  } catch {
    /* best effort */
  }
}
