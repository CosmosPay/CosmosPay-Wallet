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

type PreferencesPlugin = typeof import('@capacitor/preferences').Preferences;

/**
 * The plugin, kept inside a box — and it has to stay in one.
 *
 * A Capacitor plugin is a Proxy that turns ANY property read into a native call: its `get`
 * trap special-cases `$$typeof`, `toJSON` and the listener pair, and nothing else. `then` is
 * therefore a "method", so the moment the proxy becomes a promise's resolution value the
 * runtime probes it for thenability, calls `Preferences.then()` over the bridge, and gets
 * back `"Preferences.then()" is not implemented on android` — while the await that started
 * it never settles. Returning the proxy from this `async function` did exactly that, so on
 * Android every storage read hung and the app sat on its boot spinner forever.
 *
 * A plain object is not thenable, so the proxy travels inside one. Do not unwrap it here and
 * return the plugin directly; the bug leaves no stack trace, only a screen that never moves.
 */
let boxed: { plugin: PreferencesPlugin } | null = null;

async function getPrefs(): Promise<{ plugin: PreferencesPlugin }> {
  if (!boxed) boxed = { plugin: (await import('@capacitor/preferences')).Preferences };
  return boxed;
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
    const { plugin } = await getPrefs();
    const { value } = await plugin.get({ key });
    return value ?? null;
  }
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * A WRITE THAT FAILS THROWS. Reads still fail soft — a missing value is a legitimate
 * answer — but a write that did not happen is never one.
 *
 * This used to swallow the failure on the non-native path, which quietly disarmed the
 * one place in the app that depends on knowing: `changePassword` re-seals every wallet
 * in memory and only then commits, and its commit `try/catch` — the entire reason
 * `PasswordChangeCommitError` exists — could not fire on web or in the extension.
 * A blocked or quota-exceeded write there returned success while the vault stayed on
 * the OLD password, and the user was locked out by their own password change. Native
 * threw; the other three runtimes did not. Same function, opposite behaviour.
 *
 * A quota or security error is genuinely exceptional here: this stores a vault, not a
 * cache. The two callers that really are fire-and-forget (the query cache and the
 * favourites list) say so at their own call site with an explicit catch, which is
 * where that decision belongs — not here, on behalf of everyone.
 */
export async function storageSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    const { plugin } = await getPrefs();
    await plugin.set({ key, value });
    return;
  }
  const store = globalThis.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  store.setItem(key, value);
}

/** Also throws: silently failing to delete a vault on "remove wallet" is worse. */
export async function storageRemove(key: string): Promise<void> {
  if (isNative()) {
    const { plugin } = await getPrefs();
    await plugin.remove({ key });
    return;
  }
  const store = globalThis.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  store.removeItem(key);
}
