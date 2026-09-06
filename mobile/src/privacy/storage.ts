import { Directory, File, Paths } from 'expo-file-system';

import { log } from '@/lib/log';

/**
 * Where video lives on the phone, and nowhere else.
 *
 * Everything goes under the app's private document directory. Never the
 * camera roll, never shared storage, never a cache directory the OS might
 * hand to a backup agent. On Android the app-private directory is not
 * readable by other apps and is removed wholesale when the app is uninstalled,
 * which is the behaviour the retention promise depends on.
 *
 * The in-flight suffix is the commit mechanism. A file called `.mp4.part` is
 * partial by definition and the UI never offers it. It becomes a real `.mp4`
 * only after its size and SHA-256 both match what the vest announced, so a
 * crash mid-download can never leave a broken clip that looks fine.
 */

export const PART_SUFFIX = '.part';

const matchesRoot = () => new Directory(Paths.document, 'matches');

export function matchDir(matchId: string): Directory {
  return new Directory(matchesRoot(), matchId);
}

export function ensureMatchDir(matchId: string): Directory {
  const dir = matchDir(matchId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const clipFileName = (cameraId: string, seq: number): string =>
  `${cameraId}_${String(seq).padStart(4, '0')}.mp4`;

export function clipFile(matchId: string, cameraId: string, seq: number): File {
  return new File(matchDir(matchId), clipFileName(cameraId, seq));
}

export function partFile(matchId: string, cameraId: string, seq: number): File {
  return new File(matchDir(matchId), clipFileName(cameraId, seq) + PART_SUFFIX);
}

/** Bytes already on disk for a resumable download, or 0. Drives `Range:`. */
export function partialBytes(matchId: string, cameraId: string, seq: number): number {
  try {
    const f = partFile(matchId, cameraId, seq);
    return f.exists ? (f.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Deletes a clip and anything derived from it. Returns bytes reclaimed.
 * Errors are swallowed and logged: a file that is already gone is a success,
 * and a purge must never be the thing that crashes the app mid-over.
 */
export function deleteClipFiles(matchId: string, cameraId: string, seq: number): number {
  let freed = 0;
  for (const f of [clipFile(matchId, cameraId, seq), partFile(matchId, cameraId, seq)]) {
    try {
      if (f.exists) {
        freed += f.size ?? 0;
        f.delete();
      }
    } catch (e) {
      log.warn('storage', `could not delete ${f.uri}`, { error: String(e) });
    }
  }
  return freed;
}

/** Removes every byte of video the app holds. Used by "Delete all match data". */
export function deleteAllMatchFiles(): void {
  try {
    const root = matchesRoot();
    if (root.exists) root.delete();
    log.warn('storage', 'all local video deleted at user request');
  } catch (e) {
    log.error('storage', 'wipe failed', { error: String(e) });
  }
}

/** Total bytes of video held, for the "what is on this phone" panel. */
export function totalBytesHeld(): number {
  try {
    const root = matchesRoot();
    if (!root.exists) return 0;
    let total = 0;
    const walk = (d: Directory) => {
      for (const entry of d.list()) {
        if (entry instanceof File) total += entry.size ?? 0;
        else walk(entry);
      }
    };
    walk(root);
    return total;
  } catch {
    return 0;
  }
}
