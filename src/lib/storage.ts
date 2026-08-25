/**
 * Platform storage abstraction.
 *
 * Under Tauri — desktop and mobile alike — this persists through `tauri-plugin-store`,
 * which writes a JSON file under the OS application-data directory. In a browser tab and
 * in the extension it falls back to localStorage.
 *
 * WHY NOT localStorage EVERYWHERE, now that every native build is a WebView we control:
 * because two of those WebViews are allowed to throw it away. WKWebView's local storage is
 * evictable under storage pressure and Android's is cleared by "clear cache" tooling, and
 * what this module holds is the encrypted vault — the only copy of the user's keys on the
 * device. A file in the app-data directory has the lifetime of the app itself.
 *
 * NOTE: this store only ever holds *encrypted* blobs + public metadata. The sensitive
 * payload is sealed with AES-GCM in vault.ts before it ever reaches here, so the
 * underlying store does not need to be encrypted itself.
 */
import { isTauri } from '@/lib/platform';

type StoreModule = typeof import('@tauri-apps/plugin-store');
type Store = Awaited<ReturnType<StoreModule['load']>>;

/** One file, named after the app rather than the feature: everything here shares a scope. */
const STORE_FILE = 'cosmos-wallet.json';

/**
 * The store handle, memoised as a PROMISE rather than a value.
 *
 * `load()` reads and parses the file, and the boot path fires several reads at once (the
 * wallet list, the preferences, the attempt ladder). Caching the settled handle would let
 * all of them start their own `load()` before the first resolved; caching the promise means
 * the second caller awaits the first one's work. A rejection is not cached — the slot is
 * cleared so a later call retries rather than inheriting a failure the disk may have
 * recovered from.
 */
let handle: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!handle) {
    handle = (async () => {
      const { load } = await import('@tauri-apps/plugin-store');
      // `autoSave: false` — every write below calls `save()` itself. The plugin's autosave
      // is a debounce timer, so it reports success from `set()` and writes some
      // milliseconds later; a vault write that returns before it is durable is exactly the
      // failure `storageSet` exists to surface.
      return load(STORE_FILE, { autoSave: false });
    })().catch((err) => {
      handle = null;
      throw err;
    });
  }
  return handle;
}

export async function storageGet(key: string): Promise<string | null> {
  if (isTauri()) {
    const store = await getStore();
    return (await store.get<string>(key)) ?? null;
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
 * the OLD password, and the user was locked out by their own password change.
 *
 * A quota or security error is genuinely exceptional here: this stores a vault, not a
 * cache. The two callers that really are fire-and-forget (the query cache and the
 * favourites list) say so at their own call site with an explicit catch, which is
 * where that decision belongs — not here, on behalf of everyone.
 */
export async function storageSet(key: string, value: string): Promise<void> {
  if (isTauri()) {
    const store = await getStore();
    await store.set(key, value);
    // Not fire-and-forget: `save()` is what makes the write durable, and its rejection is
    // the only signal that the disk refused.
    await store.save();
    return;
  }
  const store = globalThis.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  store.setItem(key, value);
}

/** Also throws: silently failing to delete a vault on "remove wallet" is worse. */
export async function storageRemove(key: string): Promise<void> {
  if (isTauri()) {
    const store = await getStore();
    await store.delete(key);
    await store.save();
    return;
  }
  const store = globalThis.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  store.removeItem(key);
}
