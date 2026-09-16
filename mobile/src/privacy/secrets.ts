import * as SecureStore from 'expo-secure-store';

import { log } from '@/lib/log';

/**
 * The pairing payload contains the vest's Wi-Fi passphrase and a request-signing
 * key, and signing in adds an identity. Those are the only real secrets the app holds
 * and they live in the platform keystore, not in SQLite and not in the Zustand
 * store, so they are not in a database backup and not in a state dump.
 *
 * SecureStore is unavailable on web; every call degrades to a no-op with a
 * warning rather than throwing, because losing a stored passphrase must not
 * take the app down with it.
 */

const KEY_WIFI_PASSWORD = 'thirdeye.vest.wifi_password';
const KEY_REQUEST_PSK = 'thirdeye.vest.request_psk';
const KEY_IDENTITY = 'thirdeye.identity';

const available = async (): Promise<boolean> => {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
};

async function put(key: string, value: string | null): Promise<void> {
  if (!(await available())) {
    log.warn('secrets', 'secure storage unavailable, secret not persisted');
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

async function get(key: string): Promise<string | null> {
  if (!(await available())) return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export const secrets = {
  setWifiPassword: (v: string | null) => put(KEY_WIFI_PASSWORD, v),
  getWifiPassword: () => get(KEY_WIFI_PASSWORD),
  setRequestPsk: (v: string | null) => put(KEY_REQUEST_PSK, v),
  getRequestPsk: () => get(KEY_REQUEST_PSK),
  /** The signed-in identity, as JSON. In the keystore because it holds a name
   *  and an email address, which is the only personal data this app has ever
   *  stored - and it must not appear in a database backup or a state dump. */
  setIdentity: (v: string | null) => put(KEY_IDENTITY, v),
  getIdentity: () => get(KEY_IDENTITY),
  /**
   * Called by "Forget this vest". Deliberately leaves the identity alone:
   * forgetting a vest and signing out are different intentions, and coupling
   * them means an umpire who re-pairs at a new ground is quietly signed out too.
   */
  clearPairing: async () => {
    await put(KEY_WIFI_PASSWORD, null);
    await put(KEY_REQUEST_PSK, null);
    log.warn('secrets', 'pairing secrets cleared');
  },

  /** Called by "Delete everything". Leaves nothing, identity included. */
  clearAll: async () => {
    await put(KEY_WIFI_PASSWORD, null);
    await put(KEY_REQUEST_PSK, null);
    await put(KEY_IDENTITY, null);
    log.warn('secrets', 'all secrets cleared');
  },
};
