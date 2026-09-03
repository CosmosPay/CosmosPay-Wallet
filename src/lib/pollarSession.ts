/**
 * The life of a Pollar session on this device: the handshake while a login is running,
 * and keeping the access token fresh afterwards.
 *
 * Split from `lib/pollar.ts` — which is the wire protocol — because this is the part
 * that has to survive things the protocol knows nothing about: the MV3 popup closing
 * the moment the consent screen opens, a desktop window being backgrounded for the
 * length of a Google login, an idle auto-lock firing while the user is in the browser.
 *
 * ## Two stores, two different secrets
 *
 * The **handshake** (`state` + PKCE verifier) is plaintext, and deliberately so. It is
 * worthless on its own: redeeming needs the bridge code, which never touches this
 * device's storage — it comes back over a request authenticated with the CosmosPay API
 * key, which IS sealed. It also has to be readable before the wallet is unlocked,
 * because a first-ever Pollar login happens when there is no vault key yet. Sealing it
 * would mean the login could not resume until the user typed a password they have not
 * set.
 *
 * The **session** (`refresh_token` above all) is sealed under the app password, by
 * `lib/vault.ts`. That one is a spendable credential: it buys an access token that asks
 * Pollar to sign for a funded account. See `PollarStoredSession` there.
 */
import { storageGet, storageRemove, storageSet } from '@/lib/storage';
import { pollarRefresh, type PollarHandshake, type PollarSession } from '@/lib/pollar';
import { savePollarSession, type PollarStoredSession } from '@/lib/vault';
import type { VaultKey } from '@/lib/crypto';
import { POLL_TIMEOUT_MS, TOKEN_REFRESH_MARGIN_MS } from '@/constants/pollar';

/**
 * One handshake at a time, device-wide — not per wallet.
 *
 * A login that is going to CREATE a wallet has no wallet id to be keyed by, so there is
 * nothing else it could be keyed by. Device-wide also matches the user's model: they
 * are logging in, once, in one browser window.
 */
const HANDSHAKE_KEY = 'cosmos.pollar.handshake';

export async function saveHandshake(hs: PollarHandshake): Promise<void> {
  await storageSet(HANDSHAKE_KEY, JSON.stringify(hs));
}

/**
 * The handshake to resume, or null.
 *
 * A handshake past its polling window is dropped here rather than returned, because
 * every caller would otherwise have to re-derive "is this still worth resuming" and one
 * of them would get it wrong. An expired one resuming looks like the login hanging;
 * dropped, the screen simply offers a fresh login, which is the only thing that can
 * work.
 */
export async function loadHandshake(): Promise<PollarHandshake | null> {
  const raw = await storageGet(HANDSHAKE_KEY);
  if (!raw) return null;
  try {
    const hs = JSON.parse(raw) as PollarHandshake;
    if (!hs.state || !hs.verifier || typeof hs.startedAt !== 'number') return null;
    if (Date.now() - hs.startedAt > POLL_TIMEOUT_MS) {
      await clearHandshake();
      return null;
    }
    return hs;
  } catch {
    return null;
  }
}

export async function clearHandshake(): Promise<void> {
  await storageRemove(HANDSHAKE_KEY);
}

/** Narrow a redeemed session down to what is worth keeping at rest. */
export function toStored(session: PollarSession, provider?: string): PollarStoredSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    expires_at: session.expires_at,
    user_id: session.user_id,
    // Non-null by the time this is called: the caller has already refused a session
    // whose wallet Pollar had not provisioned yet.
    address: session.wallet.address ?? '',
    publishable_key: session.publishable_key,
    api_base_url: session.api_base_url,
    provider,
  };
}

/** Widen a stored session back into the shape the API client takes. */
export function fromStored(stored: PollarStoredSession): PollarSession {
  return {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    token_type: stored.token_type,
    expires_at: stored.expires_at,
    user_id: stored.user_id,
    wallet: { type: 'internal', address: stored.address },
    wallets: [{ type: 'internal', address: stored.address }],
    profile: {},
    publishable_key: stored.publishable_key,
    api_base_url: stored.api_base_url,
  };
}

/** Is this token close enough to expiry that the next call should not use it? */
export function isStale(stored: Pick<PollarStoredSession, 'expires_at'>, now = Date.now()): boolean {
  return stored.expires_at - now <= TOKEN_REFRESH_MARGIN_MS;
}

/**
 * Return a session good for at least one more call, refreshing first if it is not.
 *
 * Refresh-ahead rather than retry-on-401, for a reason specific to what these tokens
 * do. Pollar rotates the refresh token on every use and treats a replay as a
 * compromise — it revokes the whole family. A retry-on-401 design refreshes from
 * whatever token the caller happened to be holding, and two flows racing (a balance
 * poll and a payment, say) would each present the same refresh token; the second is a
 * replay, and the user is logged out of a wallet that was working a second ago. Doing
 * it once, ahead of time, on a single call path is what keeps that from being possible.
 *
 * The rotated pair is written back before it is returned. An unwritten rotation is the
 * same replay: the old token is dead server-side and the device still believes in it.
 */
export async function freshSession(
  walletId: string,
  stored: PollarStoredSession,
  apiKey: string,
  vk: VaultKey,
): Promise<PollarStoredSession> {
  if (!isStale(stored)) return stored;

  const pair = await pollarRefresh(apiKey, stored.refresh_token);
  const next: PollarStoredSession = {
    ...stored,
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    token_type: pair.token_type,
    expires_at: pair.expires_at,
  };
  await savePollarSession(walletId, next, vk);
  return next;
}
