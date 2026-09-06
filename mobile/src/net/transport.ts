import type { ClientMessage, ConnectionState, ServerMessage } from '@/types/protocol';

/**
 * The control channel, as an interface.
 *
 * Phase 1 runs `MockTransport`. Phase 3 adds `WebSocketTransport` speaking to
 * the real vest. Nothing above this line knows the difference, which is the
 * point: the screens, the stores and the retention rules are all exercised
 * today against a fake, and the swap in Phase 3 is one line in `attach()`.
 */
export interface Transport {
  /** Shown on the diagnostics screen so it is never a mystery which one is live. */
  readonly name: string;
  readonly isMock: boolean;

  connect(): void;
  disconnect(): void;
  send(message: ClientMessage): void;

  /** Returns an unsubscribe function. */
  subscribe(handlers: TransportHandlers): () => void;
}

export interface TransportHandlers {
  onMessage: (message: ServerMessage) => void;
  onState: (state: ConnectionState) => void;
}

/**
 * Moves clip bytes from wherever they are to app-private storage.
 *
 * Phase 1 fakes the transfer and points at a bundled sample. Phase 3 replaces
 * this with a resumable ranged HTTP GET plus SHA-256 verification, and the
 * `.part` to `.mp4` rename becomes the real commit. The contract stays: it
 * reports progress, and it only resolves once the bytes are verified.
 */
export interface Downloader {
  readonly isMock: boolean;
  fetch(request: DownloadRequest): Promise<DownloadResult>;
  cancel(seq: number): void;
}

export interface DownloadRequest {
  matchId: string;
  cameraId: string;
  seq: number;
  bytes: number;
  sha256: string;
  /** Called with bytes transferred so far. */
  onProgress: (bytesLocal: number) => void;
  /** Called when the clip moves from transferring to hash-checking. */
  onVerifying: () => void;
}

export interface DownloadResult {
  localPath: string;
  bytesLocal: number;
}
