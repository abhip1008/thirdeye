import { create } from 'zustand';

import { readSetting, writeSetting } from '@/db/settings';
import { log } from '@/lib/log';
import { audit } from '@/privacy/audit';
import { secrets } from '@/privacy/secrets';
import type { PairingPayload, UmpireEnd } from '@/types/protocol';

/**
 * What vest this phone is paired to.
 *
 * The split is deliberate: the host, the camera id and the SSID are not secret
 * and live in the settings table where they can be shown on a diagnostics
 * screen. The Wi-Fi passphrase and the request-signing key never touch SQLite —
 * they go to the platform keystore via privacy/secrets.ts and are read back
 * only at the moment they are used.
 */
interface PairingStore {
  paired: boolean;
  host: string | null;
  cameraId: string | null;
  ssid: string | null;
  umpireEnd: UmpireEnd;

  load: () => Promise<void>;
  savePayload: (payload: PairingPayload) => Promise<void>;
  saveManual: (host: string, cameraId: string) => Promise<void>;
  setUmpireEnd: (end: UmpireEnd) => void;
  forget: () => Promise<void>;
}

const K_HOST = 'pairing.host';
const K_CAMERA = 'pairing.cameraId';
const K_SSID = 'pairing.ssid';

export const usePairing = create<PairingStore>((set, get) => ({
  paired: false,
  host: null,
  cameraId: null,
  ssid: null,
  umpireEnd: 'bowlers',

  load: async () => {
    const [host, cameraId, ssid] = await Promise.all([
      readSetting(K_HOST),
      readSetting(K_CAMERA),
      readSetting(K_SSID),
    ]);
    set({ host, cameraId, ssid, paired: !!host && !!cameraId });
  },

  savePayload: async (payload) => {
    await writeSetting(K_HOST, payload.host);
    await writeSetting(K_CAMERA, payload.camera_id);
    await writeSetting(K_SSID, payload.ssid);
    await secrets.setWifiPassword(payload.password);
    await secrets.setRequestPsk(payload.psk ?? null);
    await audit('pairing.stored', null, { host: payload.host, camera_id: payload.camera_id });
    set({
      host: payload.host,
      cameraId: payload.camera_id,
      ssid: payload.ssid,
      umpireEnd: payload.end ?? get().umpireEnd,
      paired: true,
    });
    log.info('pairing', `paired with ${payload.camera_id}`);
  },

  saveManual: async (host, cameraId) => {
    await writeSetting(K_HOST, host);
    await writeSetting(K_CAMERA, cameraId);
    await audit('pairing.stored', null, { host, camera_id: cameraId, method: 'manual' });
    set({ host, cameraId, paired: true });
  },

  setUmpireEnd: (umpireEnd) => set({ umpireEnd }),

  forget: async () => {
    await writeSetting(K_HOST, '');
    await writeSetting(K_CAMERA, '');
    await writeSetting(K_SSID, '');
    await secrets.clearAll();
    await audit('pairing.forgotten', null);
    set({ paired: false, host: null, cameraId: null, ssid: null });
  },
}));

/**
 * Parses a scanned QR code. Anything that is not a Third Eye pairing payload is
 * rejected rather than guessed at: a phone that pairs itself to a random QR
 * code found on a fence is a support call nobody wants.
 */
export function parsePairingQr(raw: string): PairingPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.ssid !== 'string' || typeof p.host !== 'string' || typeof p.camera_id !== 'string') {
      return null;
    }
    return {
      v: typeof p.v === 'number' ? p.v : 1,
      ssid: p.ssid,
      password: typeof p.password === 'string' ? p.password : '',
      host: p.host,
      camera_id: p.camera_id,
      psk: typeof p.psk === 'string' ? p.psk : null,
      end: p.end === 'square_leg' ? 'square_leg' : 'bowlers',
    };
  } catch {
    return null;
  }
}
