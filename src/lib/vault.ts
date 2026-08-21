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
// Only the prompt-free cleanup call. Re-wrapping needs an OS prompt and the copy that
// goes on it, so `changePassword` takes it as an injected closure instead — see
// `ChangePasswordDeps`. That is what keeps this module's own logic reachable from
// node:test, and what stops a vault function owning UI strings.
import { deviceAuthEnabled, disableDeviceAuth } from '@/lib/deviceAuth';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';
import type { NetConfig } from '@/lib/stellar';
import { tNow } from '@/lib/i18n';

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
  email?: string; // where the confirmation went — lets the UI flag a mismatch vs the current email
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

/** Update non-sensitive metadata (name / avatar / email) for a wallet in the plaintext list. */
export async function updateWalletMeta(
  id: string,
  patch: Partial<Pick<WalletEntry, 'name' | 'avatar' | 'email' | 'gender'>>,
): Promise<WalletEntry[]> {
  const list = await listWallets();
  const next = list.map((w) => (w.id === id ? { ...w, ...patch } : w));
  await writeWallets(next);
  return next;
}

/** Decrypt a wallet. Throws "Contraseña incorrecta." on a bad password. */
export async function unlockWallet(id: string, password: string): Promise<VaultSecret> {
  const raw = await storageGet(vaultKey(id));
  if (!raw) throw new Error(tNow('vault.notFound'));
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
  // The password sealed behind the phone's lock screen outlives the vault it opens
  // unless it is dropped here. Ids come from crypto.randomUUID(), so a later wallet
  // will not collide with the orphan — it would simply sit in the Keychain for the
  // life of the install, holding a password the user believes they deleted.
  await disableDeviceAuth(id);
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

/**
 * What `changePassword` needs from outside `lib/`.
 *
 * `reenrolDeviceAuth` is REQUIRED, not optional. An optional dependency makes a function
 * only as careful as its laziest caller — the same reason `GuardOptions` in `lib/txGuard.ts`
 * is a discriminated union rather than a bag of optionals. A caller that cannot re-enrol
 * the device locks must not be able to change the password and leave them holding the old
 * one. It returns whether the enrolment came back; it must not throw.
 */
export interface ChangePasswordDeps {
  reenrolDeviceAuth: (walletId: string, newPassword: string) => Promise<boolean>;
}

/**
 * Thrown when a password change fails AFTER the first byte was written.
 *
 * The header below promises the device is left exactly as it was on failure, and that is
 * true only up to the commit. Past it there is no rollback: some wallets are on the new
 * password and some on the old, and the caller's `session.password` is true of neither.
 * A plain `Error` there let `changeAppPassword` flash a message and carry on with a
 * session whose password no longer opens what it thinks it opens — so the class exists to
 * make "you must end this session" a fact the caller can branch on rather than guess.
 */
export class PasswordChangeCommitError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super((cause as Error)?.message ?? tNow('vault.passwordChangeFailed'));
    this.name = 'PasswordChangeCommitError';
    this.cause = cause;
  }
}

/** What a password change did to the device-lock enrolments it had to touch. */
export interface PasswordChangeResult {
  /**
   * Wallets whose device-lock enrolment could not be re-sealed and was turned off.
   * Carries the id as well as the name: the name is for the sentence shown to the user,
   * and two wallets may share one, so the id is what a caller acts on.
   */
  deviceAuthDropped: { id: string; name: string }[];
}

/**
 * Re-seal every wallet under a new password (the old one must be correct).
 *
 * ATOMIC UP TO THE FIRST COMMIT — and no further, which is why the failure past it has its
 * own error class. This used to decrypt-and-write wallet by wallet, so a failure on wallet
 * 3 left wallets 1 and 2 sealed under the NEW password and wallet 3 under the old one, with
 * no rollback and no way for the caller to know. Every wallet is now opened and re-sealed
 * in memory first; the first byte is not committed until all of them have succeeded, so a
 * wrong password, a missing vault or a corrupt box aborts with the device exactly as it
 * was. A failure DURING the commit loop cannot be undone, and raises
 * `PasswordChangeCommitError` so the caller ends the session instead of carrying on with a
 * password that is now true of only some wallets.
 *
 * The device-lock enrolment holds a copy of the password sealed under a key in the
 * Keychain, so it has to move in the same pass. It is dropped BEFORE the commit and
 * re-created after — not re-wrapped afterwards, which was the original design and had no
 * safe interruption: an envelope left holding the OLD password hands `unlock()` a string
 * that no longer decrypts, so the user meets "wrong password" coming from their own
 * fingerprint and the failed-attempt ladder counts it against them.
 *
 * Re-enrolling needs a device prompt, which the user can dismiss. That is not a failure of
 * the password change — the vault is already re-sealed by then — so the enrolment stays off
 * and is reported, and the caller tells the user to turn it back on. Fail closed: no
 * enrolment beats one that opens nothing.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  deps: ChangePasswordDeps,
): Promise<PasswordChangeResult> {
  const wallets = await listWallets();

  // 1. Open everything. Nothing is written in this pass, so `unlockWallet` throwing
  //    "Contraseña incorrecta." on any wallet leaves the device untouched.
  const opened = [];
  for (const w of wallets) {
    const secret = await unlockWallet(w.id, oldPassword); // throws on wrong password
    const cosmosPay = await getCosmosPay(w.id, oldPassword);
    opened.push({ entry: w, secret, cosmosPay });
  }

  // 2. Seal everything under the new password, still writing nothing. This is pure crypto
  //    over data already in hand: it either all succeeds or throws before any commit.
  const sealed = [];
  for (const o of opened) {
    sealed.push({
      entry: o.entry,
      vault: JSON.stringify(await seal(JSON.stringify(o.secret), newPassword)),
      // Re-seal the CosmosPay credential too, otherwise it would be undecryptable.
      cosmosPay: o.cosmosPay ? JSON.stringify(await seal(JSON.stringify(o.cosmosPay), newPassword)) : null,
    });
  }

  // 3. Turn every device-lock enrolment OFF, BEFORE the vault moves.
  //
  //    This used to run last, after the commit, and that ordering had no safe failure. An
  //    envelope holds a copy of the password sealed under a Keystore key; re-wrapping it
  //    raises an OS sheet per wallet, and anything that interrupts the pass — the process
  //    dying, the user walking away, iOS reclaiming the app — left the envelope holding the
  //    PRE-CHANGE password with a still-valid key beside it. Both halves consistent, so
  //    nothing detects it: `deviceAuthPassword` returns that password happily, `unlock()`
  //    answers "wrong password", and the ladder counts the user's own fingerprint as a
  //    guess until they are locked out for five minutes.
  //
  //    Dropping first inverts that. `disableDeviceAuth` needs no prompt and cannot fail
  //    meaningfully, so the worst interruption now leaves the feature OFF — recoverable
  //    from Settings, with the password working throughout. Fail closed: no enrolment beats
  //    one that opens nothing.
  const enrolled: WalletEntry[] = [];
  for (const s of sealed) {
    if (await deviceAuthEnabled(s.entry.id)) enrolled.push(s.entry);
    await disableDeviceAuth(s.entry.id);
  }

  // 4. Commit. Past this line the device is in a state no rollback can undo, so any
  //    failure is reported as a commit failure and the caller must end the session.
  try {
    for (const s of sealed) {
      await storageSet(vaultKey(s.entry.id), s.vault);
      if (s.cosmosPay) await storageSet(cosmosPayKey(s.entry.id), s.cosmosPay);
    }
  } catch (err) {
    throw new PasswordChangeCommitError(err);
  }

  // 5. Re-enrol whatever was on, under the new password. A dismissed prompt is not a
  //    failure of the password change — the vault is already re-sealed — so it is reported
  //    and the wallet simply stays off.
  const deviceAuthDropped: { id: string; name: string }[] = [];
  for (const entry of enrolled) {
    let back = false;
    try {
      back = await deps.reenrolDeviceAuth(entry.id, newPassword);
    } catch {
      // The contract says it does not throw, and it does not — but its cleanup path touches
      // storage, and storage can reject. An escape here would abort a change that has
      // already committed, which is the one outcome step 4 exists to make impossible.
      back = false;
    }
    if (!back) deviceAuthDropped.push({ id: entry.id, name: entry.name });
  }
  return { deviceAuthDropped };
}

/** Wipe every wallet from this device. */
export async function destroyAll(): Promise<void> {
  for (const w of await listWallets()) {
    await storageRemove(vaultKey(w.id));
    await disableDeviceAuth(w.id);
    await storageRemove(cosmosPayKey(w.id));
    await storageRemove(cosmosPayPendingKey(w.id));
  }
  await storageRemove(WALLETS_KEY);
  await storageRemove(ACTIVE_KEY);
}
