/**
 * The session outlives the page: a reload, a closed popup, a browser restart — and comes back
 * on the screen it was on (the user's call, 2026-10-29). Until then the vault key lived in
 * memory only, and each of those asked for the password or the passkey again.
 *
 * What is kept, in IndexedDB (the one browser store that can hold a `CryptoKey`):
 *
 *   wrap     -> a random AES-256-GCM key generated here, NON-EXTRACTABLE
 *   session  -> { walletId, kdf, iv, vault key sealed under `wrap`, lastActive, lockMs, place }
 *
 * WHAT THIS PROTECTS, AND WHAT IT DOES NOT. The vault key is never stored as bytes a script
 * can read back: it is sealed under a key the page can use and never export, bound to its
 * wallet id (AES-GCM additional data), so localStorage, a synced setting or an exported backup
 * carries nothing that opens the vault. It is NOT a lock against whoever uses this browser
 * profile — reopening the wallet for them is the point — nor against malware that copies the
 * profile off the disk, where the browser keeps the wrapping key's material. That is the trade
 * the user chose. What bounds it is the idle auto-lock (`AUTO_LOCK_CHOICES_MS`, a day by
 * default), enforced here at restore as well as by the store while open; and every signature
 * still asks for the password or passkey while "confirm signatures" is on.
 *
 * Fail closed: a record that is expired, malformed, sealed for another wallet, or whose key
 * no longer opens the wallet's box (the store checks that) is dropped, and the lock screen
 * shows. A lock drops the record and the wrapping key with it.
 */
import { AUTO_LOCK_CHOICES_MS } from '@/constants/app';
import { importVaultKey, type KdfParams, type VaultKey } from '@/lib/crypto';
import { AUTH_SCREENS, TAB_SCREEN, isScreen, isScreenOn, isTab, type Screen, type Tab } from '@/lib/screens';

/** Where the person was: the screen, and the tab it belongs to. */
export interface KeptPlace {
  screen: Screen;
  tab: Tab;
}

export interface KeptSession {
  walletId: string;
  vaultKey: VaultKey;
  place: KeptPlace | null;
}

interface KeptRecord {
  v: 1;
  walletId: string;
  kdf: KdfParams;
  iv: Uint8Array;
  sealed: ArrayBuffer;
  lastActive: number;
  lockMs: number;
  place: KeptPlace | null;
}

/** Where the record and the wrapping key live: IndexedDB in the app, anything in a test. */
export interface KeepBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const DB_NAME = 'cosmos-session';
const DB_STORE = 'keep';
const RECORD = 'session';
const WRAP = 'wrap';
/** The longest a record may name, whatever it says: the longest choice there is. */
const MAX_LOCK_MS = Math.max(...AUTO_LOCK_CHOICES_MS);
/** A `lastActive` this far in the future is a clock that moved, or a forged record. */
const FUTURE_SLACK_MS = 60_000;

function indexedDbBackend(): KeepBackend {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async (mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<unknown> => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const req = op(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    put: async (key, value) => void (await run('readwrite', (s) => s.put(value, key))),
    del: async (key) => void (await run('readwrite', (s) => s.delete(key))),
  };
}

let backend: KeepBackend | null = null;
const kv = (): KeepBackend => (backend ??= indexedDbBackend());

/** Tests only: a backend that is not IndexedDB (`null` goes back to it). */
export function setKeepBackend(b: KeepBackend | null): void {
  backend = b;
}

/**
 * One operation at a time, in call order. A lock right after an unlock must drop what the
 * unlock kept, not race it and lose.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
}

const subtle = () => globalThis.crypto.subtle;
const boundTo = (walletId: string) => new TextEncoder().encode(`cosmos-session/v1:${walletId}`);

async function wrapKey(create: boolean): Promise<CryptoKey | null> {
  const existing = await kv().get(WRAP);
  if (existing instanceof CryptoKey) return existing;
  if (!create) return null;
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await kv().put(WRAP, key);
  return key;
}

function asRecord(value: unknown): KeptRecord | null {
  const r = value as Partial<KeptRecord> | undefined;
  if (!r || r.v !== 1 || typeof r.walletId !== 'string' || !(r.iv instanceof Uint8Array) || !(r.sealed instanceof ArrayBuffer)) return null;
  if (typeof r.lastActive !== 'number' || typeof r.lockMs !== 'number' || !r.kdf || typeof r.kdf.salt !== 'string') return null;
  const place = r.place && isScreen(r.place.screen) && isTab(r.place.tab) ? r.place : null;
  return { ...(r as KeptRecord), place };
}

/** Still inside its auto-lock window — with the window capped and the clock checked. */
export function isLive(lastActive: number, lockMs: number, now: number): boolean {
  if (lastActive > now + FUTURE_SLACK_MS) return false;
  return now - lastActive < Math.min(lockMs, MAX_LOCK_MS);
}

async function dropAll(): Promise<void> {
  await kv().del(RECORD);
  await kv().del(WRAP);
}

/** Keep the session that just opened (or changed key): sealed, with where the person is. */
export function keepSession(walletId: string, vk: VaultKey, lockMs: number, place: KeptPlace | null, now = Date.now()): Promise<void> {
  // Copied NOW: `lock()` zeroes the session's bytes, and this may run after earlier writes.
  const raw = vk.raw.slice();
  const kdf = vk.kdf;
  return serial(async () => {
    try {
      const wrap = (await wrapKey(true)) as CryptoKey;
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const sealed = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: boundTo(walletId) }, wrap, raw);
      const record: KeptRecord = { v: 1, walletId, kdf, iv, sealed, lastActive: now, lockMs, place };
      await kv().put(RECORD, record);
    } finally {
      raw.fill(0);
    }
  });
}

/** Note activity, a new place or a new auto-lock on the kept session. Nothing kept: nothing to do. */
export function touchKeptSession(patch: { lastActive?: number; place?: KeptPlace; lockMs?: number }): Promise<void> {
  return serial(async () => {
    const r = asRecord(await kv().get(RECORD));
    if (!r) return;
    await kv().put(RECORD, {
      ...r,
      lastActive: patch.lastActive ?? r.lastActive,
      place: patch.place ?? r.place,
      lockMs: patch.lockMs ?? r.lockMs,
    });
  });
}

/** The kept session, when there is a live one; otherwise whatever is there is dropped. */
export function restoreKeptSession(now = Date.now()): Promise<KeptSession | null> {
  return serial(async () => {
    const r = asRecord(await kv().get(RECORD));
    const wrap = r && isLive(r.lastActive, r.lockMs, now) ? await wrapKey(false) : null;
    if (!r || !wrap) {
      await dropAll();
      return null;
    }
    try {
      const raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource, additionalData: boundTo(r.walletId) }, wrap, r.sealed));
      return { walletId: r.walletId, vaultKey: await importVaultKey(raw, r.kdf), place: r.place };
    } catch {
      await dropAll();
      return null;
    }
  });
}

/** Forget the kept session and the key that sealed it (a lock, a reset, a key that failed). */
export function dropKeptSession(): Promise<void> {
  return serial(dropAll);
}

/**
 * Screens that come back as their tab instead: each reads a flow's passing data (a draft, a
 * pending request, a result, a chosen asset), opens the camera, or shows secrets.
 */
const NOT_RESTORED: ReadonlySet<Screen> = new Set<Screen>([
  'select',
  'confirm',
  'success',
  'sign-tx',
  'device-auth',
  'asset',
  'chain-asset',
  'chain-send',
  'lp-deposit',
  'lp-withdraw',
  'easy-recovery-send',
  'add-wallet',
  'scan',
  'export',
  'bankaccount',
  'deposit',
  'withdraw',
]);

/** Where a restored session lands: the kept screen when it stands on its own, else its tab. */
export function landingScreen(place: KeptPlace | null): Screen {
  if (!place) return 'home';
  if (place.screen === 'boot' || AUTH_SCREENS.includes(place.screen)) return 'home';
  const land = NOT_RESTORED.has(place.screen) ? TAB_SCREEN[place.tab] : place.screen;
  // A place kept before its section was switched off is no longer a way in.
  return isScreenOn(land) ? land : 'home';
}
