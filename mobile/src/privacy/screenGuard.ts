import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import { log } from '@/lib/log';

/**
 * Blocks screenshots and screen recording, and blanks the app in the app
 * switcher, while a match is open.
 *
 * The reason is not secrecy, it is scope: the retention promise made to players
 * is that footage of them is deleted after twelve balls. A screenshot escapes
 * that promise entirely and lands in a camera roll that syncs to a cloud the
 * league has no relationship with. This is the cheapest way to close that hole.
 *
 * The two platforms need different amounts of asking. Android's FLAG_SECURE
 * covers capture and the recent-apps thumbnail in one call. iOS blocks capture
 * with the same call (recordings on 11+, screenshots on 13+) but leaves the app
 * switcher snapshot alone, so the blur overlay has to be turned on separately -
 * and that snapshot is exactly the frame of a batter that ends up on someone's
 * screen while they flick between apps.
 *
 * Best-effort throughout: no effect in some Expo Go configurations, and never
 * fatal. A privacy control that crashes the app mid-over protects nobody.
 */
export async function enableScreenGuard(): Promise<void> {
  try {
    await ScreenCapture.preventScreenCaptureAsync('thirdeye-match');
    log.debug('privacy', 'screen capture blocked');
  } catch (e) {
    log.warn('privacy', 'could not block screen capture', { error: String(e) });
  }

  if (Platform.OS !== 'ios') return;
  try {
    await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
    log.debug('privacy', 'app switcher snapshot blurred');
  } catch (e) {
    log.warn('privacy', 'could not blur the app switcher snapshot', { error: String(e) });
  }
}

export async function disableScreenGuard(): Promise<void> {
  try {
    await ScreenCapture.allowScreenCaptureAsync('thirdeye-match');
  } catch {
    /* best effort */
  }
  if (Platform.OS !== 'ios') return;
  try {
    await ScreenCapture.disableAppSwitcherProtectionAsync();
  } catch {
    /* best effort */
  }
}
