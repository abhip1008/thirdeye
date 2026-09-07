import { create } from 'zustand';

import { defaults } from '@/config/appConfig';
import { readAllSettings, writeSetting } from '@/db/settings';
import { log } from '@/lib/log';

export type MockSpeed = 'manual' | 'fast' | 'realistic';

export interface Settings {
  prerollSeconds: number;
  timeoutSeconds: number;
  ringSize: number;
  pinRetentionDays: number;
  /** The mock vest. Stays in the build until field trials. */
  mockEnabled: boolean;
  mockSpeed: MockSpeed;
  /** Blocks screenshots while a match is open. See privacy/screenGuard.ts. */
  screenGuard: boolean;
  /** Whether the first-run privacy notice has been acknowledged. */
  noticeAcknowledged: boolean;
}

const INITIAL: Settings = {
  prerollSeconds: defaults.prerollSeconds,
  timeoutSeconds: defaults.timeoutSeconds,
  ringSize: defaults.ringSize,
  pinRetentionDays: defaults.pinRetentionDays,
  mockEnabled: true,
  mockSpeed: 'manual',
  screenGuard: true,
  noticeAcknowledged: false,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

/**
 * Seconds between auto-bowled deliveries. Zero means the mock vest waits for
 * the umpire, which is now the default: the control is in the app, so you drive
 * it. The auto modes exist for demonstrating a full over without standing there
 * tapping.
 */
export const MOCK_INTERVALS: Record<MockSpeed, number> = {
  manual: 0,
  fast: 10,
  realistic: 40,
};

export const useSettings = create<SettingsStore>((set, get) => ({
  ...INITIAL,
  loaded: false,

  load: async () => {
    try {
      const raw = await readAllSettings();
      const next: Partial<Settings> = {};
      for (const key of Object.keys(INITIAL) as (keyof Settings)[]) {
        const value = raw[key];
        if (value === undefined) continue;
        const initial = INITIAL[key];
        (next as Record<string, unknown>)[key] =
          typeof initial === 'number'
            ? Number(value)
            : typeof initial === 'boolean'
              ? value === 'true'
              : value;
      }
      set({ ...next, loaded: true });
    } catch (e) {
      log.warn('settings', 'could not load, using defaults', { error: String(e) });
      set({ loaded: true });
    }
  },

  set: async (key, value) => {
    set({ [key]: value } as unknown as Partial<SettingsStore>);
    await writeSetting(key, String(value));
    log.debug('settings', `${key} = ${String(value)}`);
    void get;
  },
}));
