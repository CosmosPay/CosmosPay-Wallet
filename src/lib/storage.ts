/**
 * Platform storage abstraction.
 *
 * On a native Capacitor build we persist through @capacitor/preferences
 * (SharedPreferences / UserDefaults). On the web we fall back to localStorage.
 *
 * NOTE: this store only ever holds *encrypted* blobs + public metadata.
 * The sensitive payload is sealed with AES-GCM in vault.ts before it ever
 * reaches here, so the underlying store does not need to be encrypted itself.
 */
import { Capacitor } from '@capacitor/core';

let prefs: typeof import('@capacitor/preferences').Preferences | null = null;

async function getPrefs() {
  if (prefs) return prefs;
  const mod = await import('@capacitor/preferences');
  prefs = mod.Preferences;
  return prefs;
}

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export async function storageGet(key: string): Promise<string | null> {
  if (isNative()) {
    const p = await getPrefs();
    const { value } = await p.get({ key });
    return value ?? null;
  }
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    const p = await getPrefs();
    await p.set({ key, value });
    return;
  }
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — fail soft */
  }
}

export async function storageRemove(key: string): Promise<void> {
  if (isNative()) {
    const p = await getPrefs();
    await p.remove({ key });
    return;
  }
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}
