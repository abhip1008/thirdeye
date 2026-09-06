import type {
  AppealType,
  ClipMeta,
  ClipStatus,
  Decision,
  PinReason,
  UmpireEnd,
} from './protocol';

/**
 * A clip as the phone knows it: everything the vest said about it, plus the
 * local state the vest has no opinion on.
 *
 * `ClipMeta` is generated from the wire schema and must not be edited here.
 * Anything added below is phone-only and never sent back.
 */
export interface Clip extends ClipMeta {
  status: ClipStatus;
  bytesLocal: number;
  localPath: string | null;
  thumbPath: string | null;
  pinned: boolean;
  pinReason: PinReason | null;
  pinnedAt: number | null;
  /** Unix seconds after which this clip is deleted regardless of pin state. */
  purgeAfter: number | null;
  reviewed: boolean;
  downloadedAt: number | null;
  attempts: number;
  lastError: string | null;
}

export interface Match {
  id: string;
  name: string;
  venue: string | null;
  cameraId: string;
  umpireEnd: UmpireEnd | null;
  ringSize: number;
  startedAt: number;
  endedAt: number | null;
  syncedAt: number | null;
}

export interface Review {
  id: number;
  matchId: string;
  cameraId: string;
  seq: number;
  calledAt: number;
  appealType: AppealType | null;
  decision: Decision | null;
  notes: string | null;
}

/** Identity of a clip. Three parts, because v2 adds a second camera. */
export interface ClipKey {
  matchId: string;
  cameraId: string;
  seq: number;
}
