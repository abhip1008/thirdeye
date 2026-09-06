import type { DownloadRequest, DownloadResult, Downloader } from '@/net/transport';

import { MOCK_CLIP_PATH } from './sampleClip';

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

    return { localPath: MOCK_CLIP_PATH, bytesLocal: req.bytes };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
