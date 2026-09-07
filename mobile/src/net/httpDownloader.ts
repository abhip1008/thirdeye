import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { log } from '@/lib/log';
import { clipFile, ensureMatchDir, partFile } from '@/privacy/storage';

import type { DownloadRequest, DownloadResult, Downloader } from './transport';

/**
 * The real download: fetch the clip, prove it is the clip, then commit it.
 *
 * Three properties matter, and all three exist because of what happens when
 * this goes wrong in front of twenty-two people.
 *
 * **It commits atomically.** Bytes land in a `.part` file, and that file only
 * becomes a `.mp4` after its length and its SHA-256 both match what the vest
 * announced. A crash, a flat battery or a walk out of range can leave a partial
 * file; it can never leave a broken clip that the list shows as ready.
 *
 * **It verifies rather than trusts.** A truncated download is the same size
 * problem as a corrupt one and neither is visible in a thumbnail. The hash is
 * the only thing that separates "we have it" from "we have something".
 *
 * **It resumes.** The transfer has to fit in the gap between deliveries, and
 * restarting nine megabytes because somebody crossed in front of the umpire
 * would not fit.
 */
export class HttpDownloader implements Downloader {
  readonly isMock = false;

  private cancelled = new Set<number>();

  constructor(private readonly host: string) {}

  cancel(seq: number): void {
    this.cancelled.add(seq);
  }

  async fetch(req: DownloadRequest): Promise<DownloadResult> {
    this.cancelled.delete(req.seq);
    ensureMatchDir(req.matchId);

    const part = partFile(req.matchId, req.cameraId, req.seq);
    const final = clipFile(req.matchId, req.cameraId, req.seq);
    const url = `http://${this.host}/clips/${req.seq}.mp4`;

    const already = part.exists ? (part.size ?? 0) : 0;
    if (already >= req.bytes) {
      // Everything arrived last time and only the verify step was missed.
      return this.verifyAndCommit(req, part, final);
    }

    const response = await fetch(url, {
      headers: already > 0 ? { Range: `bytes=${already}-` } : {},
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Vest answered ${response.status}`);
    }

    // A vest that ignored the Range header sends the whole file back, and
    // appending it to what we already have would corrupt the result silently.
    const resuming = already > 0 && response.status === 206;
    if (already > 0 && !resuming) {
      log.warn('download', `clip ${req.seq}: vest ignored the range, starting over`);
      part.delete();
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (this.cancelled.has(req.seq)) throw new Error('Cancelled');

    if (resuming) {
      const head = await part.bytes();
      const joined = new Uint8Array(head.length + body.length);
      joined.set(head, 0);
      joined.set(body, head.length);
      part.write(joined);
      req.onProgress(joined.length);
    } else {
      part.create({ overwrite: true });
      part.write(body);
      req.onProgress(body.length);
    }

    return this.verifyAndCommit(req, part, final);
  }

  private async verifyAndCommit(
    req: DownloadRequest,
    part: File,
    final: File
  ): Promise<DownloadResult> {
    req.onVerifying();

    const bytes = part.size ?? 0;
    if (bytes !== req.bytes) {
      throw new Error(`Wrong size: got ${bytes}, expected ${req.bytes}`);
    }

    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      await part.bytes()
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (hex !== req.sha256) {
      // Do not keep it. A file that failed its hash is not a head start on the
      // next attempt, it is a file whose contents nobody can account for.
      part.delete();
      throw new Error('The clip did not match its hash');
    }

    if (final.exists) final.delete();
    part.move(final);

    log.info('download', `clip ${req.seq} verified and committed`, { bytes });
    return { localPath: final.uri, bytesLocal: bytes };
  }
}
