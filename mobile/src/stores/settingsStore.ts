import { create } from 'zustand';

import { defaults } from '@/config/appConfig';
import { readAllSettings, writeSetting } from '@/db/settings';
import { log } from '@/lib/log';

export type MockSpeed = 'realistic' | 'fast' | 'frozen';

export interface Settings {
  prerollSeconds: number;
  timeoutSeconds: number;
  ringSize: number;
  pinRetentionDays: number;
  /** The mock vest. Stays in the build until Phase 7, per the spec. */
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
  mockSpeed: 'fast',
  screenGuard: true,
  noticeAcknowledged: false,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export const MOCK_INTERVALS: Record<MockSpeed, number> = {
  realistic: 40,
  fast: 10,
  frozen: 0,
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
