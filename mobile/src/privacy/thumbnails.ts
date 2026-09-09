import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';

import { log } from '@/lib/log';

import { matchDir } from './storage';

/**
 * A still from a clip, for the list.
 *
 * Two reasons this earns its place on a screen otherwise stripped of
 * decoration. A row of identical text is slow to scan under pressure, and a
 * picture of the delivery is the fastest way to find the one you mean. And a
 * thumbnail that renders is independent evidence the clip is playable - the
 * status dot says the bytes verified, the picture says they decode.
 *
 * Written beside the clip it came from, so it is deleted by the same sweep. A
 * thumbnail outliving its clip would be a frame of somebody surviving the
 * retention promise, which is the whole thing this system claims not to do.
 */

const FRACTION = 0.45;
/** Small enough to be cheap, large enough to tell two deliveries apart. */
const WIDTH = 240;

export function thumbFile(matchId: string, cameraId: string, seq: number): File {
  return new File(matchDir(matchId), `${cameraId}_${String(seq).padStart(4, '0')}.jpg`);
}

/**
 * Grabs a frame from partway through, not from the start.
 *
 * The first frames of a delivery are the run-up, and every run-up looks alike.
 * Just under halfway is usually around the ball being bowled, which is the part
 * that distinguishes one row from the next.
 */
export interface Thumbnail {
  path: string;
  /** The video's own dimensions, which the generator reports for free. */
  width: number;
  height: number;
}

export async function makeThumbnail(
  matchId: string,
  cameraId: string,
  seq: number,
  videoUri: string,
  durationSeconds: number
): Promise<Thumbnail | null> {
  try {
    const at = Math.max(0, Math.round(durationSeconds * FRACTION * 1000));
    const { uri, width, height } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: at,
      quality: 0.6,
    });

    // The generator writes to a cache directory the OS may clear at any time.
    // Move it beside the clip so it lives and dies with it.
    const destination = thumbFile(matchId, cameraId, seq);
    if (destination.exists) destination.delete();
    await new File(uri).move(destination);
    return { path: destination.uri, width, height };
  } catch (e) {
    // A missing thumbnail costs a nicer list. It must never cost a clip.
    log.debug('thumbnail', `could not make one for ball ${seq}`, { error: String(e) });
    return null;
  }
}

export const THUMB_WIDTH = WIDTH;
