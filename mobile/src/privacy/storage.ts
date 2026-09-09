import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { log } from '@/lib/log';

/**
 * Where video lives on the phone, and nowhere else.
 *
 * App-private on both platforms: never the camera roll, never shared storage,
 * never a directory another app can read. Removed wholesale when the app is
 * uninstalled, which is the behaviour the retention promise depends on.
 *
 * The directory differs by platform, and the reason is backup rather than
 * convention.
 *
 * On iOS everything in the app's Documents directory is copied to iCloud
 * automatically. Match footage landing in a player's umpire's iCloud account
 * would break the central promise - that it stays on this phone - without
 * anyone doing anything wrong. `Library/Caches` is excluded from backup by the
 * operating system, so that is where clips go. The trade is that iOS may evict
 * the directory under storage pressure. For a twelve-ball rolling buffer that
 * is an acceptable failure and arguably a feature: the bytes are re-requestable
 * from the vest, and `reconcile()` below makes sure the status dot never claims
 * a clip is ready when its file has gone.
 *
 * On Android the document directory is not backed up, because `allowBackup` is
 * set to false in app.json. Left at its default of true, Android's auto-backup
 * would copy app-private files to the user's Google Drive - the same hole in
 * the same promise, through a different door.
 *
 * The in-flight suffix is the commit mechanism. A file called `.mp4.part` is
 * partial by definition and the UI never offers it. It becomes a real `.mp4`
 * only after its size and SHA-256 both match what the vest announced, so a
 * crash mid-download can never leave a broken clip that looks fine.
 */

export const PART_SUFFIX = '.part';

/** See the note above: iOS Documents is backed up to iCloud, Caches is not. */
export const storageRoot = (): Directory => (Platform.OS === 'ios' ? Paths.cache : Paths.document);

const matchesRoot = () => new Directory(storageRoot(), 'matches');

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

/**
 * Whether a committed clip's bytes are actually still on disk.
 *
 * Not paranoia. On iOS the operating system may reclaim the cache directory
 * whenever it likes, so a row can outlive its file. A green dot over a clip
 * that will not play is the single worst thing this product can do on a field,
 * so the row is checked rather than trusted.
 *
 * The mock sentinel is not a real path and is always considered present.
 */
export function clipFileExists(localPath: string | null): boolean {
  if (!localPath) return false;
  if (!localPath.startsWith('file:')) return true; // bundled or mock asset
  try {
    return new File(localPath).exists;
  } catch {
    return false;
  }
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
  // The thumbnail goes with the clip. A still frame outliving the video would be
  // a picture of somebody surviving the retention promise.
  const thumb = new File(matchDir(matchId), `${cameraId}_${String(seq).padStart(4, '0')}.jpg`);
  for (const f of [clipFile(matchId, cameraId, seq), partFile(matchId, cameraId, seq), thumb]) {
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
