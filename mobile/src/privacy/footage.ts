import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';

import { log } from '@/lib/log';

import { storageRoot } from './storage';

/**
 * Your own footage, standing in for clips the vest has not been built to
 * record yet.
 *
 * There is no camera and no vest, so the app plays a synthetic test clip. That
 * clip is right for checking frame stepping - it has a marker that advances a
 * fixed distance every frame - and useless for the question that actually
 * decides whether this product works: **is the impact zone even in shot from an
 * umpire's chest?** Only real footage answers that.
 *
 * Imported through the system file picker rather than the photo library, which
 * matters: the picker needs no permission at all, because the person chooses
 * one file and the app is handed that file and nothing else. Asking for
 * blanket photo-library access to read one video would contradict everything in
 * docs/PRIVACY.md.
 *
 * Imports live in the same app-private, backup-excluded place clips do, are
 * deleted by the same "delete all data" action, and never touch the camera roll.
 */

const footageDir = (): Directory => new Directory(storageRoot(), 'footage');

function ensureDir(): Directory {
  const dir = footageDir();
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Videos available to stand in for clips, oldest import first. */
export function listFootage(): File[] {
  try {
    const dir = footageDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Which video stands in for a given delivery.
 *
 * With several imported, deliveries cycle through them so consecutive balls do
 * not look identical. With one, every ball shows it, which is still far more
 * informative than a test pattern.
 */
export function footageForSeq(seq: number): string | null {
  const files = listFootage();
  if (files.length === 0) return null;
  const chosen = files[Math.abs(seq) % files.length];
  return chosen?.uri ?? null;
}

export interface ImportResult {
  imported: number;
  cancelled: boolean;
  error?: string;
}

/** Opens the system file picker. Needs no permission; the person picks. */
export async function importFootage(): Promise<ImportResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return { imported: 0, cancelled: true };

    const dir = ensureDir();
    let imported = 0;
    for (const asset of result.assets) {
      // Prefixed with the import order so the cycle above is stable across
      // launches rather than depending on how the filesystem lists a directory.
      const stamp = String(Date.now() + imported).slice(-10);
      const safe = asset.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const target = new File(dir, `${stamp}_${safe}`);
      await new File(asset.uri).copy(target);
      imported += 1;
    }

    log.info('footage', `imported ${imported} video(s)`);
    return { imported, cancelled: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn('footage', 'import failed', { error });
    return { imported: 0, cancelled: false, error };
  }
}

/** Removes every imported video. Clips already using one keep playing until purged. */
export function clearFootage(): number {
  const files = listFootage();
  for (const f of files) {
    try {
      f.delete();
    } catch {
      /* already gone */
    }
  }
  if (files.length) log.info('footage', `removed ${files.length} imported video(s)`);
  return files.length;
}

export function footageBytes(): number {
  return listFootage().reduce((total, f) => total + (f.size ?? 0), 0);
}
