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
import { open, seal, type SealedBox } from './crypto';
import { storageGet, storageRemove, storageSet } from './storage';
import type { StellarNetwork } from './stellar';

const WALLETS_KEY = 'cosmos.wallets';
const ACTIVE_KEY = 'cosmos.active';
const NETWORK_KEY = 'cosmos.network';
const vaultKey = (id: string) => `cosmos.w.${id}`;

// legacy single-wallet keys (migrated on first run)
const OLD_VAULT = 'cosmos.vault';
const OLD_META = 'cosmos.meta';

export interface VaultSecret {
  secret: string; // S...
  mnemonic: string | null; // 12 words, or null when imported from a raw secret
}

export interface WalletEntry {
  id: string;
  publicKey: string; // G...
  name: string; // user name / nickname
  birthdate: string; // ISO "YYYY-MM-DD" or ''
  createdAt: number;
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

export async function getNetwork(): Promise<StellarNetwork> {
  return (await storageGet(NETWORK_KEY)) === 'public' ? 'public' : 'testnet';
}

export async function setNetwork(net: StellarNetwork): Promise<void> {
  await storageSet(NETWORK_KEY, net);
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
        createdAt: meta.createdAt ?? Date.now(),
      },
    ]);
    await setActiveId(id);
    if (meta.network) await setNetwork(meta.network);
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
  info: { publicKey: string; name: string; birthdate: string },
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
    createdAt: Date.now(),
  };
  await writeWallets([...list, entry]);
  await setActiveId(id);
  return entry;
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

/** Remove a wallet. Returns the remaining list + the new active id (or null). */
export async function removeWallet(
  id: string,
): Promise<{ remaining: WalletEntry[]; newActive: string | null }> {
  await storageRemove(vaultKey(id));
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
  }
}

/** Wipe every wallet from this device. */
export async function destroyAll(): Promise<void> {
  for (const w of await listWallets()) await storageRemove(vaultKey(w.id));
  await storageRemove(WALLETS_KEY);
  await storageRemove(ACTIVE_KEY);
}
