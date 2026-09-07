/**
 * Platform storage abstraction.
 *
 * Three backends, because the four builds do not offer the same guarantees:
 *
 *   Tauri (desktop + mobile)  `tauri-plugin-store` — a JSON file in the OS app-data dir
 *   extension (MV3)           `storage.local` — the extension storage area
 *   web page                  localStorage
 *
 * WHY NOT localStorage EVERYWHERE, now that every native build is a WebView we control:
 * because two of those WebViews are allowed to throw it away. WKWebView's local storage is
 * evictable under storage pressure and Android's is cleared by "clear cache" tooling, and
 * what this module holds is the encrypted vault — the only copy of the user's keys on the
 * device. A file in the app-data directory has the lifetime of the app itself.
 *
 * THE EXTENSION IS THE SAME ARGUMENT, and it used to be missed. An extension page has a
 * localStorage, so it fell through to the web branch — but MDN's own guidance is to use
 * `storage.local` instead precisely because localStorage is web-page data: Firefox clears
 * it when the user clears cookies and site data, which for this wallet means clearing the
 * vault. Freighter and MetaMask both keep their vault in `storage.local` for that reason.
 * Reads still fall back to localStorage for anything not yet moved, so the migration below
 * is a tidy-up rather than a thing that can fail and lose a wallet.
 *
 * NOTE: this store only ever holds *encrypted* blobs + public metadata. The sensitive
 * payload is sealed with AES-GCM in vault.ts before it ever reaches here, so the
 * underlying store does not need to be encrypted itself.
 */
import { isExtension, isTauri, osName } from '@/lib/platform';
import { nativeInvoke } from '@/lib/nativeBridge';

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
      // BEFORE the file is created, so the flag is already on the directory the plugin is
      // about to write into. See `excludeFromDeviceBackup`.
      await excludeFromDeviceBackup();
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

/**
 * Keep the app-data directory out of the device's own backups. iOS only, once per launch.
 *
 * Android is covered without any code running: `scripts/native-permissions.ts` writes
 * `allowBackup="false"` plus the `dataExtractionRules` that govern device-to-device
 * transfer. iOS has no manifest equivalent — `NSURLIsExcludedFromBackupKey` is an attribute
 * set on the URL at runtime — and without it iCloud carries `cosmos-wallet.json` onto
 * whatever device the user restores to next: the sealed vault, and the plaintext wallet
 * list beside it (name, email, birthdate, avatar). The device-unlock envelope is useless
 * there, because its key is `.biometryCurrentSet` and does not travel; the vault is not,
 * because a password is all it needs, offline, at the attacker's own pace.
 *
 * The DIRECTORY rather than the file, and that is not a shortcut: the store rewrites its
 * file, and an attribute set on an inode does not survive the file being replaced. Set on
 * the directory it covers everything written inside it, including the next rewrite.
 *
 * Never throws. A build whose plugin predates the command answers "unknown command", and
 * that must not be the reason a wallet cannot reach its own vault.
 */
async function excludeFromDeviceBackup(): Promise<void> {
  if (osName() !== 'ios') return;
  try {
    await nativeInvoke<void>('exclude_from_backup');
  } catch (err) {
    console.warn('storage: the app-data directory is not excluded from iCloud backup —', err);
  }
}

/* ------------------------------ extension area ------------------------------ */

// No @types/chrome in this project; `extArea()` is the guard, as in `lib/dappOrigins.ts`.
declare const chrome: any;
declare const browser: any;

/**
 * The extension storage area, or null when this is not an extension page.
 *
 * `browser` first: Firefox defines both, and its `browser.*` namespace is the one that has
 * always been promise-based. Chrome's `chrome.storage` has returned promises since MV3 and
 * is what the rest of the extension code already assumes.
 */
function extArea(): any | null {
  if (typeof browser !== 'undefined' && browser?.storage?.local) return browser.storage.local;
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chrome.storage.local;
  return null;
}

/**
 * Keys that live in localStorage on purpose and must not be moved.
 *
 * Every one of them is read SYNCHRONOUSLY, during a render or at module load, by code that
 * cannot await: the theme before the first paint, the language by `tNow`, the developer
 * endpoint overrides by the API client. Migrating them would not break a build — it would
 * silently reset a preference on the next launch, because the module reading it would still
 * be reading the place it was moved out of.
 *
 * None of them is a secret, and none of them is the vault. That is the line: this module's
 * own keys move, these do not.
 */
const KEEP_IN_LOCAL_STORAGE = new Set([
  'cosmos.theme',
  'cosmos.confirm',
  'cosmos.lang',
  'cosmos.devMode',
  'cosmos.devEndpoints',
  'cosmos.surface',
]);

/**
 * Copy this module's keys out of localStorage and into `storage.local`, once.
 *
 * Idempotent by construction: a key already present in `storage.local` is never overwritten,
 * so an interrupted pass cannot put a stale value back on top of a newer one, and the
 * localStorage copy is dropped only after it has been read back from the new home. A key
 * that fails is simply left where it is — reads fall back to localStorage, so nothing
 * depends on this having finished.
 */
async function migrateToExtensionArea(area: any): Promise<void> {
  const local = globalThis.localStorage;
  if (!local) return;
  const keys: string[] = [];
  for (let i = 0; i < local.length; i++) {
    const key = local.key(i);
    if (key && key.startsWith('cosmos.') && !KEEP_IN_LOCAL_STORAGE.has(key)) keys.push(key);
  }
  if (!keys.length) return;
  const existing = (await area.get(keys)) ?? {};
  for (const key of keys) {
    try {
      const value = local.getItem(key);
      if (value === null) continue;
      if (existing[key] === undefined) {
        await area.set({ [key]: value });
        // Read back BEFORE dropping what is still the only other copy of it.
        const check = (await area.get(key)) ?? {};
        if (check[key] !== value) continue;
      }
      local.removeItem(key);
    } catch {
      /* leave this key where it is; the next launch tries again */
    }
  }
}

let extReady: Promise<any> | null = null;

function getExtArea(): Promise<any> {
  if (!extReady) {
    const area = extArea();
    if (!area) return Promise.reject(new Error('extension storage is unavailable'));
    // The migration's failure is not the area's failure — swallowed here so a bad pass
    // cannot make every later read reject.
    extReady = migrateToExtensionArea(area).catch(() => {}).then(() => area);
  }
  return extReady;
}

/* --------------------------------- the API --------------------------------- */

export async function storageGet(key: string): Promise<string | null> {
  if (isTauri()) {
    const store = await getStore();
    return (await store.get<string>(key)) ?? null;
  }
  if (isExtension() && extArea()) {
    const area = await getExtArea();
    const got = (await area.get(key)) ?? {};
    const value = got[key];
    if (typeof value === 'string') return value;
    // Not moved yet, or the move failed: the pre-migration copy is still the real one.
    // This fallback is what makes the migration above safe to fail.
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
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
  if (isExtension() && extArea()) {
    const area = await getExtArea();
    await area.set({ [key]: value });
    dropLocalStorageCopy(key);
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
  if (isExtension() && extArea()) {
    const area = await getExtArea();
    await area.remove(key);
    dropLocalStorageCopy(key);
    return;
  }
  const store = globalThis.localStorage;
  if (!store) throw new Error('localStorage is unavailable');
  store.removeItem(key);
}

/**
 * Drop a pre-migration copy after the extension area has taken the write.
 *
 * Not tidiness. Two copies of a vault is one copy that `changePassword` re-seals and one
 * that keeps the OLD password working — and the read fallback above would find the stale
 * one for any key the new area happens not to hold. Best effort: the write that matters has
 * already succeeded by the time this runs, and a private-mode localStorage that throws on
 * access must not turn a completed write into a failure.
 */
function dropLocalStorageCopy(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* nothing to clean up, or nothing that can be */
  }
}
