import { create } from 'zustand';

import * as q from '@/db/queries';
import { log } from '@/lib/log';
import { MockDownloader } from '@/mock/mockDownloader';
import type { Downloader } from '@/net/transport';
import { audit } from '@/privacy/audit';
import * as retention from '@/privacy/retention';
import { makeThumbnail } from '@/privacy/thumbnails';
import type { Clip } from '@/types/clip';
import type { ClipReadyMessage, ClipStatus, PinReason } from '@/types/protocol';

import { useMatch } from './matchStore';
import { useSettings } from './settingsStore';

/**
 * The clip list, and the only place a clip changes state.
 *
 * Every mutation writes to SQLite first and then to the store, not the other
 * way round. If the app is killed between the two the database is right and the
 * next hydrate corrects the screen; the reverse would leave the umpire looking
 * at a green dot for a clip that is not there, which is the one failure this
 * product cannot afford.
 */

let downloader: Downloader = new MockDownloader();

/** Phase 3 calls this once with the real ranged HTTP downloader. */
export function setDownloader(next: Downloader) {
  downloader = next;
  log.info('clips', `downloader is now ${next.isMock ? 'mock' : 'real'}`);
}

interface ClipStore {
  clips: Clip[];
  hydrated: boolean;

  hydrate: (matchId: string) => Promise<void>;
  bySeq: (cameraId: string, seq: number) => Clip | undefined;

  onClipReady: (message: ClipReadyMessage) => Promise<void>;
  onClipExpired: (cameraId: string, seq: number) => Promise<void>;
  retry: (cameraId: string, seq: number) => Promise<void>;

  pin: (cameraId: string, seq: number, reason: PinReason) => Promise<void>;
  unpin: (cameraId: string, seq: number) => Promise<void>;
  markReviewed: (cameraId: string, seq: number) => Promise<void>;

  sweep: () => Promise<void>;
  reset: () => void;
}

export const useClips = create<ClipStore>((set, get) => ({
  clips: [],
  hydrated: false,

  hydrate: async (matchId) => {
    // Check the disk before showing anything. A row that outlived its file
    // would otherwise render as a green dot over a clip that will not play.
    await retention.reconcile(matchId);
    const clips = await q.listClips(matchId);
    set({ clips, hydrated: true });
    log.debug('clips', `hydrated ${clips.length}`);
  },

  bySeq: (cameraId, seq) =>
    get().clips.find((c) => c.camera_id === cameraId && c.seq === seq),

  onClipReady: async (m) => {
    const match = useMatch.getState().match;
    if (!match) return;

    const { over, ballInOver } = useMatch.getState();
    const now = Date.now() / 1000;
    const clip: Clip = {
      v: m.v,
      match_id: match.id,
      camera_id: m.camera_id,
      seq: m.seq,
      started_at: now - m.duration_s,
      ended_at: now,
      duration_s: m.duration_s,
      preroll_s: useSettings.getState().prerollSeconds,
      closed_by: m.closed_by,
      resolution: '1920x1200',
      fps: 60,
      codec: 'h265',
      bytes: m.bytes,
      sha256: m.sha256,
      over,
      ball_in_over: ballInOver,
      legal: true,
      status: 'announced',
      bytesLocal: 0,
      localPath: null,
      thumbPath: null,
      pinned: false,
      pinReason: null,
      pinnedAt: null,
      purgeAfter: null,
      reviewed: false,
      downloadedAt: null,
      attempts: 0,
      lastError: null,
    };

    await persist(set, get, clip);
    await audit('clip.announced', match.id, {
      camera_id: clip.camera_id, seq: clip.seq, bytes: clip.bytes, closed_by: clip.closed_by,
    });

    await download(set, get, clip);
    await get().sweep();
  },

  onClipExpired: async (cameraId, seq) => {
    const clip = get().bySeq(cameraId, seq);
    if (!clip) return;
    // The vest no longer holds it. If we already have the bytes that is fine,
    // it just means no retry is possible from here on.
    if (clip.status === 'ready') return;
    await persist(set, get, { ...clip, status: 'expired', lastError: 'No longer on the vest' });
  },

  retry: async (cameraId, seq) => {
    const clip = get().bySeq(cameraId, seq);
    if (!clip || clip.status === 'ready') return;
    if (clip.status === 'expired') return;
    await download(set, get, { ...clip, lastError: null });
  },

  pin: async (cameraId, seq, reason) => {
    const clip = get().bySeq(cameraId, seq);
    if (!clip) return;
    const next = await retention.pin(clip, reason, useSettings.getState().pinRetentionDays);
    replace(set, get, next);
  },

  unpin: async (cameraId, seq) => {
    const clip = get().bySeq(cameraId, seq);
    if (!clip) return;
    replace(set, get, await retention.unpin(clip));
  },

  markReviewed: async (cameraId, seq) => {
    const clip = get().bySeq(cameraId, seq);
    if (!clip || clip.reviewed) return;
    await q.markReviewed(clip.match_id, cameraId, seq);
    await audit('clip.reviewed', clip.match_id, { camera_id: cameraId, seq });
    replace(set, get, { ...clip, reviewed: true });
  },

  sweep: async () => {
    const match = useMatch.getState().match;
    if (!match) return;
    const ringSize = useSettings.getState().ringSize;
    const result = await retention.sweep(match.id, ringSize);
    if (result.deleted > 0) await get().hydrate(match.id);
  },

  reset: () => set({ clips: [], hydrated: false }),
}));

/* ---------- internals ---------- */

type Set = (partial: Partial<ClipStore>) => void;
type Get = () => ClipStore;

/** Newest first, and stable: the list must never reorder under a finger. */
const sorted = (clips: Clip[]) => [...clips].sort((a, b) => b.seq - a.seq);

function replace(set: Set, get: Get, clip: Clip) {
  const rest = get().clips.filter(
    (c) => !(c.camera_id === clip.camera_id && c.seq === clip.seq)
  );
  set({ clips: sorted([...rest, clip]) });
}

async function persist(set: Set, get: Get, clip: Clip) {
  await q.upsertClip(clip);
  replace(set, get, clip);
}

async function setStatus(
  set: Set, get: Get, clip: Clip, status: ClipStatus, patch: Partial<Clip> = {}
) {
  const next = { ...clip, ...patch, status };
  await q.upsertClip(next);
  replace(set, get, next);
  return next;
}

async function download(set: Set, get: Get, clip: Clip) {
  let current = await setStatus(set, get, clip, 'downloading', {
    attempts: clip.attempts + 1,
    bytesLocal: 0,
  });

  try {
    const result = await downloader.fetch({
      matchId: clip.match_id,
      cameraId: clip.camera_id,
      seq: clip.seq,
      bytes: clip.bytes,
      sha256: clip.sha256,
      onProgress: (bytesLocal) => {
        const latest = get().bySeq(clip.camera_id, clip.seq);
        if (latest && latest.status === 'downloading') {
          replace(set, get, { ...latest, bytesLocal });
        }
      },
      onVerifying: () => {
        const latest = get().bySeq(clip.camera_id, clip.seq);
        if (latest) void setStatus(set, get, latest, 'verifying');
      },
    });

    current = get().bySeq(clip.camera_id, clip.seq) ?? current;
    const ready = await setStatus(set, get, current, 'ready', {
      localPath: result.localPath,
      bytesLocal: result.bytesLocal,
      downloadedAt: Date.now() / 1000,
      lastError: null,
    });
    await audit('clip.ready', clip.match_id, { camera_id: clip.camera_id, seq: clip.seq });

    // After the clip is ready, never before. A thumbnail is worth having and
    // worth nothing compared to the clip: the umpire can already watch it while
    // this happens, and if it fails they lose a picture, not a delivery.
    const thumb = await makeThumbnail(
      clip.match_id, clip.camera_id, clip.seq, result.localPath, clip.duration_s
    );
    if (thumb) {
      const latest = get().bySeq(clip.camera_id, clip.seq);
      if (latest) {
        // The generator reports the video's own dimensions, so record those
        // rather than what the vest camera is configured to produce. Test
        // footage shot on a phone is portrait, and a player that assumes
        // otherwise shows it as a strip down the middle.
        await setStatus(set, get, latest, 'ready', {
          thumbPath: thumb.path,
          resolution: `${thumb.width}x${thumb.height}`,
        });
      }
    }
    void ready;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    current = get().bySeq(clip.camera_id, clip.seq) ?? current;
    await setStatus(set, get, current, 'failed', { lastError: message });
    await audit('clip.failed', clip.match_id, {
      camera_id: clip.camera_id, seq: clip.seq, error: message,
    });
    log.warn('clips', `clip ${clip.seq} failed`, { error: message });
  }
}
