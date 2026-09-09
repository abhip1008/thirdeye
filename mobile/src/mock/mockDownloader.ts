import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { log } from '@/lib/log';
import type { DownloadRequest, DownloadResult, Downloader } from '@/net/transport';
import { footageForSeq } from '@/privacy/footage';
import { clipFile, ensureMatchDir } from '@/privacy/storage';

/**
 * Pretends to move ~9 MB over Wi-Fi in about three seconds, reporting progress
 * the way the real ranged download will, then hands back the bundled sample.
 *
 * The timing matters more than it looks. The whole product rests on the
 * transfer fitting inside the gap between deliveries, so the UI is built and
 * judged against something that takes a realistic three seconds rather than
 * appearing instantly.
 */
export class MockDownloader implements Downloader {
  readonly isMock = true;

  private cancelled = new Set<number>();

  constructor(
    private readonly transferSeconds = 3,
    private readonly verifySeconds = 0.4,
    private readonly failureRate = 0.06
  ) {}

  cancel(seq: number): void {
    this.cancelled.add(seq);
  }

  async fetch(req: DownloadRequest): Promise<DownloadResult> {
    this.cancelled.delete(req.seq);
    const steps = 12;
    const stepMs = (this.transferSeconds * 1000) / steps;

    for (let i = 1; i <= steps; i++) {
      await sleep(stepMs);
      if (this.cancelled.has(req.seq)) throw new Error('Cancelled');
      req.onProgress(Math.round((req.bytes * i) / steps));
    }

    req.onVerifying();
    await sleep(this.verifySeconds * 1000);

    if (Math.random() < this.failureRate) {
      throw new Error('Connection lost');
    }

    // Copy a real file into the place a real clip would land, rather than
    // handing back a sentinel. The pretend transfer now ends where a real one
    // does - an actual video in app-private storage - so everything downstream
    // is exercised for real: the player opens a file, the thumbnail generator
    // has something to read, and retention deletes bytes rather than a string.
    ensureMatchDir(req.matchId);
    const destination = clipFile(req.matchId, req.cameraId, req.seq);

    const own = footageForSeq(req.seq);
    const sourceUri = own ?? (await bundledSampleUri());
    if (!sourceUri) throw new Error('No footage available to stand in for a clip');

    if (destination.exists) destination.delete();
    await new File(sourceUri).copy(destination);

    return { localPath: destination.uri, bytesLocal: destination.size ?? req.bytes };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The bundled test pattern, resolved to a real file on disk. Cached: the copy
 *  out of the app bundle only has to happen once. */
let bundled: string | null = null;
async function bundledSampleUri(): Promise<string | null> {
  if (bundled) return bundled;
  try {
    const asset = Asset.fromModule(require('../../assets/mock/sample.mp4'));
    await asset.downloadAsync();
    bundled = asset.localUri ?? asset.uri;
    return bundled;
  } catch (e) {
    log.warn('mock', 'could not unpack the bundled sample clip', { error: String(e) });
    return null;
  }
}
