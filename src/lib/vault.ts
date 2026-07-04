/**
 * Multi-wallet encrypted vault.
 *
 * Storage layout:
 *   cosmos.wallets  -> WalletEntry[]            (public metadata for each wallet)
 *   cosmos.active   -> active wallet id
 *   cosmos.network  -> 'testnet' | 'public'     (global, shared by all wallets)
 *   cosmos.w.<id>   -> SealedBox(AES-GCM) of { secret, mnemonic }   (one per wallet)
 *
 * All wallets are sealed with the SAME app password (entered once at unlock).
 * Secrets are only decrypted into memory after a successful unlock. The wallet
 * list + names are plaintext (non-sensitive) so the user can be greeted while
 * still locked and can see how many wallets exist.
 */
import { open, seal, type SealedBox } from '@/lib/crypto';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';
import type { NetConfig } from '@/lib/stellar';

const WALLETS_KEY = 'cosmos.wallets';
const ACTIVE_KEY = 'cosmos.active';
const NETWORK_KEY = 'cosmos.network';
const vaultKey = (id: string) => `cosmos.w.${id}`;
// CosmosPay account (provisioned via the dev platform). The API key is a bearer
// credential, so it's sealed at rest with the SAME app password as the wallet
// secret (see crypto.ts) — i.e. encrypted, never plaintext in storage. Only the
// non-sensitive org id / environment flags live on the plaintext WalletEntry.
const cosmosPayKey = (id: string) => `cosmos.pay.${id}`;
// Pending registration (awaiting email confirmation). Stored in PLAINTEXT: the
// claim token is single-use, expires server-side, and is useless without (a)
// the user confirming via the emailed link and (b) the matching stellarAddress.
// It is not a long-lived secret and needs no password to survive a reload.
const cosmosPayPendingKey = (id: string) => `cosmos.pay.pending.${id}`;

// legacy single-wallet keys (migrated on first run)
const OLD_VAULT = 'cosmos.vault';
const OLD_META = 'cosmos.meta';

export interface VaultSecret {
  secret: string; // S...
  mnemonic: string | null; // 12 words, or null when imported from a raw secret
}

/** Self-reported gender — drives gendered copy ("bienvenido/bienvenida/bienvenidx").
 *  'x' covers non-binary and prefer-not-to-say. */
export type Gender = 'm' | 'f' | 'x';

export interface WalletEntry {
  id: string;
  publicKey: string; // G...
  name: string; // user name / nickname
  birthdate: string; // ISO "YYYY-MM-DD" (required at signup)
  email: string; // for opt-in linking to Cosmos products (required at signup)
  gender?: Gender; // asked at signup; missing on legacy wallets -> treated as 'x'
  metricsOptIn?: boolean; // optional consent: anonymous usage metrics
  promoOptIn?: boolean; // optional consent: promotional news & offers
  avatar?: string; // optional profile picture (small data URL)
  createdAt: number;
  // CosmosPay (non-sensitive flags; the API keys themselves are sealed separately).
  cosmosPayEnabled?: boolean;
  cosmosPayOrgId?: string;
  // Default BlindPay fiat receiver (KYC account) used for on/off-ramp.
  cosmosPayReceiverId?: string;
}

/**
 * Provisioned CosmosPay account (keys sealed at rest). The account carries BOTH keys —
 * `dev` for testnet and `prod` for mainnet — and the wallet uses whichever matches its
 * current network. Either may be null if that environment's key wasn't minted.
 */
export interface CosmosPayAccount {
  keys: { dev: string | null; prod: string | null };
  organizationId: string;
}

/** A registration awaiting email confirmation (one-time claim token + address). */
export interface CosmosPayPending {
  claimToken: string;
  stellarAddress: string;
  expiresAt: number; // epoch ms (best-effort; server enforces expiry)
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

/* ----------------------------- list / active ---------------------------- */

export async function listWallets(): Promise<WalletEntry[]> {
  const raw = await storageGet(WALLETS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as WalletEntry[];
  } catch {
    return [];
  }
}

async function writeWallets(list: WalletEntry[]): Promise<void> {
  await storageSet(WALLETS_KEY, JSON.stringify(list));
}

export async function hasAnyWallet(): Promise<boolean> {
  return (await listWallets()).length > 0;
}

export async function getActiveId(): Promise<string | null> {
  return (await storageGet(ACTIVE_KEY)) || null;
}

export async function setActiveId(id: string): Promise<void> {
  await storageSet(ACTIVE_KEY, id);
}

export async function getActiveEntry(): Promise<WalletEntry | null> {
  const id = await getActiveId();
  const list = await listWallets();
  return list.find((w) => w.id === id) ?? list[0] ?? null;
}

/* ------------------------------- network -------------------------------- */

const CUSTOM_NETWORKS_KEY = 'cosmos.networks';

/** Active network id ('testnet' | 'public' | a custom id). */
export async function getNetworkId(): Promise<string> {
  return (await storageGet(NETWORK_KEY)) || 'testnet';
}

export async function setNetworkId(id: string): Promise<void> {
  await storageSet(NETWORK_KEY, id);
}

export async function getCustomNetworks(): Promise<NetConfig[]> {
  const raw = await storageGet(CUSTOM_NETWORKS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as NetConfig[];
  } catch {
    return [];
  }
}

export async function setCustomNetworks(list: NetConfig[]): Promise<void> {
  await storageSet(CUSTOM_NETWORKS_KEY, JSON.stringify(list));
}

/* ------------------------------- migration ------------------------------ */

/** One-time migration from the old single-wallet format to the wallet list. */
export async function migrate(): Promise<void> {
  if (await storageGet(WALLETS_KEY)) return; // already on the new format
  const oldVault = await storageGet(OLD_VAULT);
  const oldMeta = await storageGet(OLD_META);
  if (!oldVault || !oldMeta) return;
  try {
    const meta = JSON.parse(oldMeta);
    const id = genId();
    await storageSet(vaultKey(id), oldVault);
    await writeWallets([
      {
        id,
        publicKey: meta.publicKey,
        name: meta.name ?? 'astronauta',
        birthdate: meta.birthdate ?? '',
        email: meta.email ?? '',
        createdAt: meta.createdAt ?? Date.now(),
      },
    ]);
    await setActiveId(id);
    if (meta.network) await setNetworkId(meta.network);
    await storageRemove(OLD_VAULT);
    await storageRemove(OLD_META);
  } catch {
    /* leave old data untouched on parse failure */
  }
}

/* ---------------------------- create / unlock --------------------------- */

/** Seal a new wallet under `password`, append it, and make it active. */
export async function addWallet(
  secret: VaultSecret,
  info: { publicKey: string; name: string; birthdate: string; email: string; gender?: Gender; metricsOptIn?: boolean; promoOptIn?: boolean },
  password: string,
): Promise<WalletEntry> {
  const list = await listWallets();
  const dup = list.find((w) => w.publicKey === info.publicKey);
  if (dup) {
    // already imported — just make it active (and refresh its seal)
    await storageSet(vaultKey(dup.id), JSON.stringify(await seal(JSON.stringify(secret), password)));
    await setActiveId(dup.id);
    return dup;
  }
  const id = genId();
  await storageSet(vaultKey(id), JSON.stringify(await seal(JSON.stringify(secret), password)));
  const entry: WalletEntry = {
    id,
    publicKey: info.publicKey,
    name: info.name,
    birthdate: info.birthdate,
    email: info.email,
    gender: info.gender,
    metricsOptIn: info.metricsOptIn,
    promoOptIn: info.promoOptIn,
    createdAt: Date.now(),
  };
  await writeWallets([...list, entry]);
  await setActiveId(id);
  return entry;
}

/** Update non-sensitive metadata (name / avatar) for a wallet in the plaintext list. */
export async function updateWalletMeta(
  id: string,
  patch: Partial<Pick<WalletEntry, 'name' | 'avatar'>>,
): Promise<WalletEntry[]> {
  const list = await listWallets();
  const next = list.map((w) => (w.id === id ? { ...w, ...patch } : w));
  await writeWallets(next);
  return next;
}

/** Decrypt a wallet. Throws "Contraseña incorrecta." on a bad password. */
export async function unlockWallet(id: string, password: string): Promise<VaultSecret> {
  const raw = await storageGet(vaultKey(id));
  if (!raw) throw new Error('No se encontró la wallet en este dispositivo.');
  const box = JSON.parse(raw) as SealedBox;
  return JSON.parse(await open(box, password)) as VaultSecret;
}

/** Verify the app password by decrypting the active wallet. */
export async function verifyPassword(password: string): Promise<boolean> {
  const id = await getActiveId();
  if (!id) return false;
  try {
    await unlockWallet(id, password);
    return true;
  } catch {
    return false;
  }
}

export async function updateWallet(
  id: string,
  partial: Partial<Pick<WalletEntry, 'name' | 'birthdate'>>,
): Promise<void> {
  await writeWallets((await listWallets()).map((w) => (w.id === id ? { ...w, ...partial } : w)));
}

/* ----------------------------- CosmosPay -------------------------------- */

/**
 * Persist a provisioned CosmosPay account: the credential is sealed under the
 * app `password` (encrypted at rest, same scheme as the wallet secret) while
 * the org id / environment are mirrored onto the plaintext WalletEntry so the
 * "receiving enabled" state survives restarts without needing the password.
 * Returns the updated wallet list.
 */
export async function saveCosmosPay(
  id: string,
  data: CosmosPayAccount,
  password: string,
): Promise<WalletEntry[]> {
  await storageSet(cosmosPayKey(id), JSON.stringify(await seal(JSON.stringify(data), password)));
  const list = await listWallets();
  const next = list.map((w) =>
    w.id === id ? { ...w, cosmosPayEnabled: true, cosmosPayOrgId: data.organizationId } : w,
  );
  await writeWallets(next);
  return next;
}

/** Mark a receiver as the wallet's default BlindPay fiat account. */
export async function saveDefaultReceiver(id: string, receiverId: string): Promise<WalletEntry[]> {
  const list = await listWallets();
  const next = list.map((w) => (w.id === id ? { ...w, cosmosPayReceiverId: receiverId } : w));
  await writeWallets(next);
  return next;
}

/** Unlink CosmosPay from a wallet: drop the sealed API keys + pending + the plaintext flags. */
export async function clearCosmosPay(id: string): Promise<WalletEntry[]> {
  await storageRemove(cosmosPayKey(id));
  await storageRemove(cosmosPayPendingKey(id));
  const list = await listWallets();
  const next = list.map((w) =>
    w.id === id ? { ...w, cosmosPayEnabled: false, cosmosPayOrgId: undefined } : w,
  );
  await writeWallets(next);
  return next;
}

/** Unlink the default BlindPay receiver from a wallet (keeps the CosmosPay keys). */
export async function clearReceiver(id: string): Promise<WalletEntry[]> {
  const list = await listWallets();
  const next = list.map((w) => (w.id === id ? { ...w, cosmosPayReceiverId: undefined } : w));
  await writeWallets(next);
  return next;
}

/** Decrypt the stored CosmosPay account for a wallet (null if none / bad password). */
export async function getCosmosPay(id: string, password: string): Promise<CosmosPayAccount | null> {
  const raw = await storageGet(cosmosPayKey(id));
  if (!raw) return null;
  try {
    const box = JSON.parse(raw) as SealedBox;
    const parsed = JSON.parse(await open(box, password)) as
      | CosmosPayAccount
      | { apiKey: string | null; organizationId: string; environment: 'dev' | 'prod' };
    // Migrate the legacy single-key shape ({ apiKey, environment }) to the dual-key shape,
    // keeping the existing key for its environment (the other side is filled on re-link).
    if (!('keys' in parsed) && 'apiKey' in parsed) {
      const env = parsed.environment === 'prod' ? 'prod' : 'dev';
      return {
        organizationId: parsed.organizationId,
        keys: { dev: env === 'dev' ? parsed.apiKey : null, prod: env === 'prod' ? parsed.apiKey : null },
      };
    }
    return parsed as CosmosPayAccount;
  } catch {
    return null;
  }
}

/** Persist a pending registration (plaintext — see note on cosmosPayPendingKey). */
export async function savePendingCosmosPay(id: string, pending: CosmosPayPending): Promise<void> {
  await storageSet(cosmosPayPendingKey(id), JSON.stringify(pending));
}

/** Read a pending registration (null if none / malformed). */
export async function getPendingCosmosPay(id: string): Promise<CosmosPayPending | null> {
  const raw = await storageGet(cosmosPayPendingKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CosmosPayPending;
  } catch {
    return null;
  }
}

/** Drop a pending registration (after claim, expiry, or removal). */
export async function clearPendingCosmosPay(id: string): Promise<void> {
  await storageRemove(cosmosPayPendingKey(id));
}

/** Remove a wallet. Returns the remaining list + the new active id (or null). */
export async function removeWallet(
  id: string,
): Promise<{ remaining: WalletEntry[]; newActive: string | null }> {
  await storageRemove(vaultKey(id));
  await storageRemove(cosmosPayKey(id));
  await storageRemove(cosmosPayPendingKey(id));
  const remaining = (await listWallets()).filter((w) => w.id !== id);
  await writeWallets(remaining);
  let active = await getActiveId();
  if (active === id) {
    active = remaining[0]?.id ?? null;
    if (active) await setActiveId(active);
    else await storageRemove(ACTIVE_KEY);
  }
  return { remaining, newActive: active };
}

/** Re-seal every wallet under a new password (the old one must be correct). */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  for (const w of await listWallets()) {
    const secret = await unlockWallet(w.id, oldPassword); // throws on wrong password
    await storageSet(vaultKey(w.id), JSON.stringify(await seal(JSON.stringify(secret), newPassword)));
    // Re-seal the CosmosPay credential too, otherwise it would be undecryptable.
    const cp = await getCosmosPay(w.id, oldPassword);
    if (cp) await storageSet(cosmosPayKey(w.id), JSON.stringify(await seal(JSON.stringify(cp), newPassword)));
  }
}

/** Wipe every wallet from this device. */
export async function destroyAll(): Promise<void> {
  for (const w of await listWallets()) {
    await storageRemove(vaultKey(w.id));
    await storageRemove(cosmosPayKey(w.id));
    await storageRemove(cosmosPayPendingKey(w.id));
  }
  await storageRemove(WALLETS_KEY);
  await storageRemove(ACTIVE_KEY);
}
