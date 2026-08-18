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
 */
import { DAPP_MIRROR_KEY } from '@/constants/app';

// No @types/chrome in this project; every entry point guards on `hasStorage()`.
declare const chrome: any;

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.storage?.local;
}

async function readMirror(): Promise<Record<string, unknown>> {
  if (!hasStorage()) return {};
  const cur = (await chrome.storage.local.get(DAPP_MIRROR_KEY))[DAPP_MIRROR_KEY];
  return cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : {};
}

/** Every origin currently allowed to read the public address without a prompt. */
export async function listApprovedOrigins(): Promise<string[]> {
  const cur = await readMirror();
  const list = cur.approvedOrigins;
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string' && !!o) : [];
}

/**
 * Drop `origin` (or, with no argument, every origin) from the grant list and return
 * what is left. The rest of the mirror — address, network — is preserved: the
 * service worker reads it on every request and an empty object would break the
 * connection it is still serving.
 */
export async function revokeApprovedOrigins(origin?: string): Promise<string[]> {
  if (!hasStorage()) return [];
  const cur = await readMirror();
  const before = await listApprovedOrigins();
  const approvedOrigins = origin ? before.filter((o) => o !== origin) : [];
  await chrome.storage.local.set({ [DAPP_MIRROR_KEY]: { ...cur, approvedOrigins } });
  return approvedOrigins;
}
