/**
 * The dapp origins this wallet answers `getAddress` for.
 *
 * `ApprovePopup.writeMirror` only ever pushed to this list, and nothing in `src/`
 * ever read it back: a site approved once was recognised forever, with no way to
 * take the grant away short of clearing extension storage. These functions are what
 * makes it revocable — see `features/settings/ConnectedSites.tsx`.
 *
 * In `lib/` rather than in the screen because it is storage access with no React in
 * it, and because the service worker's mirror is the same shape either way.
 *
 * TWO BACKENDS, one list. The extension keeps its grants inside the service worker's
 * mirror, because the SW is what answers a read without opening a window and it cannot
 * see anything else. The web build has no service worker: its approval window IS the
 * only reader, so the list goes through `lib/storage.ts` with everything else that
 * build persists. The branch is on whether `chrome.storage` is there at all — the same
 * test every other extension-only path in this repo makes.
 */
import { DAPP_MIRROR_KEY, DAPP_MIRROR_LOCK, DAPP_ORIGINS_KEY } from '@/constants/dapp';
import { storageGet, storageSet } from '@/lib/storage';

// No @types/chrome in this project; every entry point guards on `hasMirror()`.
declare const chrome: any;

function hasMirror(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.storage?.local;
}

async function readMirror(): Promise<Record<string, unknown>> {
  if (!hasMirror()) return {};
  const cur = (await chrome.storage.local.get(DAPP_MIRROR_KEY))[DAPP_MIRROR_KEY];
  return cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : {};
}

/** Only the strings, only the non-empty ones — whatever shape the store hands back. */
function originList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string' && !!o) : [];
}

async function readWeb(): Promise<string[]> {
  try {
    return originList(JSON.parse((await storageGet(DAPP_ORIGINS_KEY)) ?? '[]'));
  } catch {
    // A corrupt list is an empty list: the failure mode of guessing is a site that
    // gets the address without asking.
    return [];
  }
}

/** Every origin currently allowed to read the public address without a prompt. */
export async function listApprovedOrigins(): Promise<string[]> {
  if (!hasMirror()) return readWeb();
  return originList((await readMirror()).approvedOrigins);
}

/** This context's queue, for a runtime without Web Locks: one writer at a time here at least. */
let localQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` holding the mirror's lock (`DAPP_MIRROR_LOCK`). Web Locks are shared by the service
 * worker and every extension page, so a revoke in Settings, a grant in the approval window and a
 * site's `wallet_revokePermissions` in the worker never interleave their read and their write.
 */
export function withMirrorLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } } }).navigator?.locks;
  if (locks) return locks.request(DAPP_MIRROR_LOCK, fn);
  const run = localQueue.then(fn, fn);
  localQueue = run.catch(() => undefined);
  return run;
}

/**
 * Read-modify-write the extension's mirror: under the lock, from a copy read INSIDE it, so a
 * writer never puts back a mirror older than the one another writer just stored.
 */
export async function updateMirror(change: (cur: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  if (!hasMirror()) return;
  await withMirrorLock(async () => {
    const next = change(await readMirror());
    await chrome.storage.local.set({ [DAPP_MIRROR_KEY]: next });
  });
}

/**
 * Remember `origin` as connected. Called only from the explicit "Connect" approval —
 * signing once is not consent to be recognised forever, which is why the signing paths
 * refresh the mirror without ever coming through here.
 */
export async function grantApprovedOrigin(origin: string): Promise<void> {
  if (!origin) return;
  if (!hasMirror()) {
    const before = await readWeb();
    if (!before.includes(origin)) await storageSet(DAPP_ORIGINS_KEY, JSON.stringify([...before, origin]));
    return;
  }
  await updateMirror((cur) => {
    const before = originList(cur.approvedOrigins);
    return before.includes(origin) ? cur : { ...cur, approvedOrigins: [...before, origin] };
  });
}

/**
 * Drop `origin` (or, with no argument, every origin) from the grant list and return
 * what is left. On the extension the rest of the mirror — address, network — is
 * preserved: the service worker reads it on every request and an empty object would
 * break the connection it is still serving.
 */
export async function revokeApprovedOrigins(origin?: string): Promise<string[]> {
  if (!hasMirror()) {
    const before = await readWeb();
    const approvedOrigins = origin ? before.filter((o) => o !== origin) : [];
    await storageSet(DAPP_ORIGINS_KEY, JSON.stringify(approvedOrigins));
    return approvedOrigins;
  }
  let approvedOrigins: string[] = [];
  await updateMirror((cur) => {
    approvedOrigins = origin ? originList(cur.approvedOrigins).filter((o) => o !== origin) : [];
    return { ...cur, approvedOrigins };
  });
  return approvedOrigins;
}
