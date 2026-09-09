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
import { DAPP_MIRROR_KEY, DAPP_ORIGINS_KEY } from '@/constants/dapp';
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

/**
 * Remember `origin` as connected. Called only from the explicit "Connect" approval —
 * signing once is not consent to be recognised forever, which is why the signing paths
 * refresh the mirror without ever coming through here.
 */
export async function grantApprovedOrigin(origin: string): Promise<void> {
  if (!origin) return;
  const before = await listApprovedOrigins();
  if (before.includes(origin)) return;
  const next = [...before, origin];
  if (!hasMirror()) {
    await storageSet(DAPP_ORIGINS_KEY, JSON.stringify(next));
    return;
  }
  const cur = await readMirror();
  await chrome.storage.local.set({ [DAPP_MIRROR_KEY]: { ...cur, approvedOrigins: next } });
}

/**
 * Drop `origin` (or, with no argument, every origin) from the grant list and return
 * what is left. On the extension the rest of the mirror — address, network — is
 * preserved: the service worker reads it on every request and an empty object would
 * break the connection it is still serving.
 */
export async function revokeApprovedOrigins(origin?: string): Promise<string[]> {
  const before = await listApprovedOrigins();
  const approvedOrigins = origin ? before.filter((o) => o !== origin) : [];
  if (!hasMirror()) {
    await storageSet(DAPP_ORIGINS_KEY, JSON.stringify(approvedOrigins));
    return approvedOrigins;
  }
  const cur = await readMirror();
  await chrome.storage.local.set({ [DAPP_MIRROR_KEY]: { ...cur, approvedOrigins } });
  return approvedOrigins;
}
