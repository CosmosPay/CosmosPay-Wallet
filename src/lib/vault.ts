/**
 * Multi-wallet encrypted vault.
 *
 * Storage layout:
 *   cosmos.wallets  -> WalletEntry[]            (public metadata for each wallet)
 *   cosmos.active   -> active wallet id
 *   cosmos.network  -> 'testnet' | 'public'     (global, shared by all wallets)
 *   cosmos.w.<id>   -> SealedBox(AES-GCM) of { secret, mnemonic }   (one per wallet)
 *
 * Every box on the device is sealed under ONE key, derived from the app password once at
 * unlock (`unlockSession`) and brought over the whole device by `convergeSeals`. That is
 * what lets the session hold a key instead of the password — see `VaultKey` in
 * `lib/crypto.ts`. Secrets are only decrypted after a successful unlock, and per operation
 * rather than for the length of the session. The wallet list + names are plaintext
 * (non-sensitive) so the user can be greeted while still locked and can see how many
 * wallets exist.
 */
import {
  deriveVaultKey,
  kdfIsCurrent,
  kdfOf,
  newKdfParams,
  open,
  openWithKey,
  sameKdf,
  sealWithKey,
  WrongPasswordError,
  type SealedBox,
  type VaultKey,
} from '@/lib/crypto';
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
// A Pollar (social-login) wallet's session: the bearer + refresh token, the wallet
// Pollar resolved, and where to reach it. Sealed under the SAME app password as every
// other box, because a refresh token is a spendable credential for a funded account —
// it is what lets a stranger with the device file ask Pollar to sign.
//
// It also stands in for the secret box on a Pollar wallet, which has none: the app
// password is proven by opening THIS box instead. See `primaryBoxKey`.
const pollarKey = (id: string) => `cosmos.pollar.${id}`;

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

/**
 * How the wallet's key is held.
 *
 * `local` (the default, and what every entry written before this existed is) means the
 * seed is in `cosmos.w.<id>` on this device and the wallet signs for itself. `pollar`
 * means the key lives in Pollar's KMS: there is no secret box, `secretOf` has nothing
 * to return, and signing goes out to Pollar through `lib/pollarApi.ts`.
 *
 * Absent rather than `'local'` on existing entries on purpose — a migration that
 * rewrites every WalletEntry to add a field whose absence already means the right
 * thing is a write that can fail for no gain. `isPollar` reads it, nothing else does.
 */
export type WalletKind = 'local' | 'pollar';

export interface WalletEntry {
  id: string;
  kind?: WalletKind; // absent = 'local'
  /** Pollar's own user id, for display on the account screen. Pollar wallets only. */
  pollarUserId?: string | null;
  /** Which provider the user logged in with ('google' | 'github'). Pollar wallets only. */
  pollarProvider?: string;
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

/**
 * Seal a new wallet under the session's key, append it, and make it active.
 *
 * The KEY, not a password, and it must be the live session's: a wallet added mid-session
 * under fresh parameters would be one the session that created it could not read back.
 */
export async function addWallet(
  secret: VaultSecret,
  info: { publicKey: string; name: string; birthdate: string; email: string; gender?: Gender; metricsOptIn?: boolean; promoOptIn?: boolean },
  vk: VaultKey,
): Promise<WalletEntry> {
  const list = await listWallets();
  const dup = list.find((w) => w.publicKey === info.publicKey);
  if (dup) {
    // already imported — just make it active (and refresh its seal)
    await storageSet(vaultKey(dup.id), JSON.stringify(await sealWithKey(JSON.stringify(secret), vk)));
    await setActiveId(dup.id);
    return dup;
  }
  const id = genId();
  await storageSet(vaultKey(id), JSON.stringify(await sealWithKey(JSON.stringify(secret), vk)));
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

/** Is this a Pollar (social-login, KMS-custodied) wallet? Absent `kind` means local. */
export function isPollar(entry: Pick<WalletEntry, 'kind'>): boolean {
  return entry.kind === 'pollar';
}

/**
 * The box that PROVES the app password for a wallet.
 *
 * For a local wallet that is the secret box, as it always was. A Pollar wallet has no
 * secret box — the key is in Pollar's KMS — so its session box takes the role: it is
 * sealed under the same vault key, so opening it establishes exactly what opening the
 * secret box established, and a Pollar-only device still has something to unlock
 * against. Without this, `unlockSession` on such a device would throw `vault.notFound`
 * and the user would be locked out of a wallet that is perfectly intact.
 */
function primaryBoxKey(entry: Pick<WalletEntry, 'id' | 'kind'>): string {
  return isPollar(entry) ? pollarKey(entry.id) : vaultKey(entry.id);
}

/**
 * Thrown when something asks a Pollar wallet for a local secret.
 *
 * Its own type rather than `vault.notFound`, because the two are opposite situations:
 * "this wallet is damaged" versus "this wallet works and its key is somewhere else".
 * A caller that catches this can route to Pollar; one that saw `notFound` could only
 * tell the user their wallet is missing.
 */
export class NoLocalKeyError extends Error {
  constructor() {
    super(tNow('vault.noLocalKey'));
    this.name = 'NoLocalKeyError';
  }
}

/**
 * The SECRET box — the seed. Every caller of this wants a key to sign with.
 *
 * A Pollar wallet has no such box, and the honest answer for it is not "that wallet was
 * not found on this device": the wallet is intact and working, its key is simply in
 * Pollar's KMS. Told apart by the presence of the session box, so the distinction is
 * made from what is actually on disk rather than from a flag that could disagree with
 * it. `revealBackup` and the export screen are the callers this matters to — both would
 * otherwise tell a Pollar user their wallet is missing.
 */
async function readBox(id: string): Promise<SealedBox> {
  const raw = await storageGet(vaultKey(id));
  if (!raw) {
    if (await storageGet(pollarKey(id))) throw new NoLocalKeyError();
    throw new Error(tNow('vault.notFound'));
  }
  return JSON.parse(raw) as SealedBox;
}

/** The password-proving box for an entry, whichever kind it is. */
async function readPrimaryBox(entry: Pick<WalletEntry, 'id' | 'kind'>): Promise<SealedBox> {
  const raw = await storageGet(primaryBoxKey(entry));
  if (!raw) throw new Error(tNow('vault.notFound'));
  return JSON.parse(raw) as SealedBox;
}

/**
 * Decrypt a wallet with a typed password. Throws `WrongPasswordError` on a bad one.
 *
 * The password door, kept for the three paths where a human is proving they are present:
 * the unlock screen, the signing gate and `revealBackup`. Everything a SESSION does goes
 * through `openVault` instead — see `unlockSession`.
 */
export async function unlockWallet(id: string, password: string): Promise<VaultSecret> {
  return JSON.parse(await open(await readBox(id), password)) as VaultSecret;
}

/**
 * Decrypt a wallet with the session's key — no password, no derivation.
 *
 * This is what makes it possible for the store to stop holding the password: switching
 * wallets, reading a credential and fetching the secret for one signature all used to need
 * the string the user typed, so it had to be kept for the whole session. AES-GCM over a key
 * already in hand costs microseconds, which is also why the secret no longer has to be held
 * either — it can be fetched per signature instead of living in memory between them.
 *
 * Throws `VaultKeyMismatchError` if this box is not covered by that key. That is a broken
 * state, not a wrong password; see `convergeSeals`.
 */
export async function openVault(id: string, vk: VaultKey): Promise<VaultSecret> {
  return JSON.parse(await openWithKey(await readBox(id), vk)) as VaultSecret;
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

/**
 * Verify a key the way `verifyPassword` verifies a string.
 *
 * The signing gate can be answered by the phone's own biometrics instead of by typing, and
 * what that hands back is now a key rather than a password (`lib/deviceAuth.ts`). It still
 * has to be PROVEN before it counts as an answer — an envelope can survive the vault it
 * was built beside — and proving it means opening the active wallet with it.
 */
export async function verifyVaultKey(vk: VaultKey): Promise<boolean> {
  const id = await getActiveId();
  if (!id) return false;
  try {
    await openVault(id, vk);
    return true;
  } catch {
    return false;
  }
}

/** What a successful unlock produces: the wallet it opened, and the key that opens the rest. */
export interface UnlockedVault {
  entry: WalletEntry;
  vaultKey: VaultKey;
}

/**
 * Open the active wallet with a typed password and hand back a session key.
 *
 * ONE derivation, and the session runs on what it produced. It replaces a design where the
 * password was kept and re-derived per operation: switching to a second wallet cost a full
 * PBKDF2 run, which at the current cost is about a second, and every one of those was a
 * reason to keep the number low. The key is derived for the ACTIVE wallet's parameters
 * because those are the ones that had to be right to prove the password; `convergeSeals`
 * moves everything else onto them.
 */
export async function unlockSession(password: string): Promise<UnlockedVault> {
  const entry = await getActiveEntry();
  if (!entry) throw new Error(tNow('vault.notFound'));
  // For a Pollar wallet this is the session box, not a secret box — see `primaryBoxKey`.
  const box = await readPrimaryBox(entry);
  const vaultKey = await deriveVaultKey(password, kdfOf(box));
  await openWithKey(box, vaultKey); // throws WrongPasswordError — this is the guess
  return { entry, vaultKey };
}

/**
 * Bring every box on the device under ONE key, and return the key that covers them.
 *
 * Two jobs that are really one. The first is the iteration count: it is a number this
 * project has to be able to RAISE, and a raise is worth nothing to the wallets already
 * installed, because nothing rewrites a vault except creation, import and
 * `changePassword`. The second is the salt: a session holds a single derived key, and a
 * key only opens boxes sealed under the parameters it was derived for. Both are the same
 * operation — open with the password, re-seal onto the target — so they are one pass.
 *
 * AWAITED BY THE CALLER, unlike the fire-and-forget version this replaces. It stopped being
 * hygiene when the session key started depending on it: a box left on other parameters is
 * one `switchWallet` away from a `VaultKeyMismatchError` in front of the user. It runs
 * before the session opens, and once a device has converged it does no crypto at all — it
 * reads each box, sees the parameters already match, and returns.
 *
 * Best effort per box, with ONE exception: the active wallet. A failure elsewhere — a
 * storage fault, a box this build cannot parse — leaves that box on its old seal, which
 * still opens with the password, and the next unlock converges it. The active wallet
 * cannot be left behind that way, because the key returned here is the one the whole
 * session runs on: `secretOf` reads that wallet's box for every signature. A session
 * holding a key its own wallet does not match is not a degraded session, it is a broken
 * one — every send, swap and payout fails with `VaultKeyMismatchError`, and `getCosmosPay`
 * swallows the same failure as "no credential", so receiving quietly reads as unlinked.
 * That was the shape of it: the pass caught its own failure, returned the target anyway,
 * and handed the store a key that opened nothing it was about to use.
 *
 * So the active wallet goes first and decides the pass. If it did not land on the target,
 * nothing else is moved either and the ORIGINAL key is returned — the one `unlockSession`
 * derived from that wallet's own box, which by construction opens it. Aborting rather than
 * carrying on is what keeps the device from splitting in half: some boxes on the new
 * parameters, some on the old, and no single key covering the wallet in front of the user.
 * The whole pass runs again on the next unlock.
 *
 * COMPARE-AND-SWAP on the write. Another document of the same extension can be running
 * `changePassword` while this is mid-pass; writing blind would put a box sealed under the
 * OLD password on top of the new one, which is a wallet its owner can no longer open. If
 * the stored bytes moved between the read and the write, this pass drops its result — and
 * on the active wallet that lost race is one of the ways the abort above is reached.
 */
export async function convergeSeals(password: string, vk: VaultKey): Promise<VaultKey> {
  // A key derived for out-of-date parameters cannot be the target: everything would
  // converge onto the cost we are trying to leave behind.
  const target = kdfIsCurrent(vk.kdf) ? vk : await deriveVaultKey(password, newKdfParams());
  // `getActiveEntry`, not `getActiveId`: it falls back to the first wallet exactly as
  // `unlockSession` does, so both agree on which box the session key came from.
  const active = await getActiveEntry();
  if (active) {
    // `primaryBoxKey`, not `vaultKey`: on a Pollar wallet the box the session key has to
    // cover is the session box. Checking the secret box there would test something that
    // does not exist, find it uncovered, and abort every pass forever.
    const box = primaryBoxKey(active);
    await resealOnto(box, password, target);
    if (!(await coveredBy(box, target))) return vk;
  }
  for (const w of await listWallets()) {
    await resealOnto(vaultKey(w.id), password, target);
    await resealOnto(cosmosPayKey(w.id), password, target);
    // A Pollar wallet has no secret box, so this IS its box — leaving it behind would
    // hand the session a key that cannot read the credential it is about to sign with.
    await resealOnto(pollarKey(w.id), password, target);
  }
  return target;
}

/**
 * Does the box stored under `key` carry the parameters this key was derived for?
 *
 * Read back from storage rather than inferred from `resealOnto` returning: that function
 * swallows its failures on purpose, and the three ways it can decline — the write throwing,
 * the compare-and-swap losing, the box refusing to open — are indistinguishable from the
 * outside. The only honest question is what is on disk now.
 */
async function coveredBy(key: string, vk: VaultKey): Promise<boolean> {
  try {
    const raw = await storageGet(key);
    return !!raw && sameKdf(kdfOf(JSON.parse(raw) as SealedBox), vk.kdf);
  } catch {
    return false;
  }
}

async function resealOnto(key: string, password: string, target: VaultKey): Promise<void> {
  try {
    const raw = await storageGet(key);
    if (!raw) return;
    const box = JSON.parse(raw) as SealedBox;
    if (sameKdf(kdfOf(box), target.kdf)) return; // already covered by this key
    const plain = await open(box, password); // whatever parameters it carries
    const next = JSON.stringify(await sealWithKey(plain, target));
    if ((await storageGet(key)) !== raw) return; // something else rewrote it — leave it alone
    await storageSet(key, next);
  } catch {
    /* the old seal still works; try again on the next unlock */
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
 * Persist a provisioned CosmosPay account: the credential is sealed under the session's
 * vault key (encrypted at rest, same scheme and the same key as the wallet secret) while
 * the org id / environment are mirrored onto the plaintext WalletEntry so the
 * "receiving enabled" state survives restarts without needing the password.
 * Returns the updated wallet list.
 */
export async function saveCosmosPay(
  id: string,
  data: CosmosPayAccount,
  vk: VaultKey,
): Promise<WalletEntry[]> {
  await storageSet(cosmosPayKey(id), JSON.stringify(await sealWithKey(JSON.stringify(data), vk)));
  const list = await listWallets();
  const next = list.map((w) =>
    w.id === id ? { ...w, cosmosPayEnabled: true, cosmosPayOrgId: data.organizationId } : w,
  );
  await writeWallets(next);
  return next;
}

/* ----------------------------- Pollar session ---------------------------- */

/**
 * A Pollar session at rest: the tokens, the wallet Pollar resolved, and where to reach
 * Pollar directly.
 *
 * Stored sealed, under the same key as everything else. The refresh token is the part
 * that matters: it is single-use but long-lived, and it buys an access token that can
 * ask Pollar to sign for a funded account. Plaintext here would mean the device file is
 * the account.
 *
 * `expires_at` travels with it so a resumed session knows whether to refresh before its
 * first call rather than discovering it with a 401 in the middle of a payment.
 */
export interface PollarStoredSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  user_id: string | null;
  address: string;
  publishable_key: string;
  api_base_url: string;
  provider?: string;
}

export async function savePollarSession(id: string, data: PollarStoredSession, vk: VaultKey): Promise<void> {
  await storageSet(pollarKey(id), JSON.stringify(await sealWithKey(JSON.stringify(data), vk)));
}

export async function getPollarSession(id: string, vk: VaultKey): Promise<PollarStoredSession | null> {
  const raw = await storageGet(pollarKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(await openWithKey(JSON.parse(raw) as SealedBox, vk)) as PollarStoredSession;
  } catch {
    return null;
  }
}

/** The same read through the password door, for `changePassword`. See its CosmosPay twin. */
async function readPollarWithPassword(id: string, password: string): Promise<PollarStoredSession | null> {
  const raw = await storageGet(pollarKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(await open(JSON.parse(raw) as SealedBox, password)) as PollarStoredSession;
  } catch {
    return null;
  }
}

/**
 * Create a wallet whose key Pollar custodies.
 *
 * No secret box is written, because there is no secret: the session box IS this
 * wallet's box, which is what `primaryBoxKey` encodes and what lets the app password be
 * proven on a device that has never held a seed.
 *
 * The vault key is derived here with fresh parameters when the caller has none — a
 * first-ever wallet on this device — and passed in when there is already a session, so
 * the new entry lands under the key the rest of the device is already on. Deriving a
 * second key for it would leave a device `convergeSeals` has to walk on the next
 * unlock, and until then a session key that opens some wallets and not others.
 */
export async function createPollarWallet(
  profile: Omit<WalletEntry, 'id' | 'createdAt' | 'kind' | 'publicKey'> & { publicKey: string },
  session: PollarStoredSession,
  vk: VaultKey,
): Promise<{ entry: WalletEntry; wallets: WalletEntry[] }> {
  const entry: WalletEntry = {
    ...profile,
    id: genId(),
    kind: 'pollar',
    pollarUserId: session.user_id,
    pollarProvider: session.provider,
    createdAt: Date.now(),
  };
  await savePollarSession(entry.id, session, vk);
  const wallets = [...(await listWallets()), entry];
  await writeWallets(wallets);
  await setActiveId(entry.id);
  return { entry, wallets };
}

// There was a `clearPollarSession(id)` here that dropped the session box and left the
// entry. It is gone, and it must not come back in that shape: for a Pollar wallet the
// session box is ALSO the box `unlockSession` opens to prove the app password
// (`primaryBoxKey`), so removing it leaves the entry in the wallet list as something
// that can never be unlocked again — with nothing on screen able to say why.
//
// Signing out of a Pollar wallet removes the whole entry, via `removeWallet`. That is
// what sign-out means for an account whose key this device never held, and it costs the
// user nothing: logging in with the same provider account resolves the same Stellar
// wallet, funds included.

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

/**
 * Read the decrypted JSON back into an account.
 *
 * Split out from `getCosmosPay` because `changePassword` opens the same box through the
 * password door rather than the key one, and the legacy-shape migration below has to
 * happen on both paths or the re-seal would write back a shape the next read migrates
 * again — forever.
 */
function parseCosmosPay(json: string): CosmosPayAccount {
  const parsed = JSON.parse(json) as
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
}

/** Decrypt the stored CosmosPay account for a wallet (null if none / not covered by this key). */
export async function getCosmosPay(id: string, vk: VaultKey): Promise<CosmosPayAccount | null> {
  const raw = await storageGet(cosmosPayKey(id));
  if (!raw) return null;
  try {
    return parseCosmosPay(await openWithKey(JSON.parse(raw) as SealedBox, vk));
  } catch {
    return null;
  }
}

/**
 * The same read through the password door, for `changePassword`.
 *
 * It cannot use the session's key: the boxes it is about to re-seal are the ones that still
 * carry the OLD password's parameters, which is exactly what the key does not cover.
 */
async function readCosmosPayWithPassword(id: string, password: string): Promise<CosmosPayAccount | null> {
  const raw = await storageGet(cosmosPayKey(id));
  if (!raw) return null;
  try {
    return parseCosmosPay(await open(JSON.parse(raw) as SealedBox, password));
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
  // The vault key sealed behind the phone's lock screen outlives the vault it opens
  // unless it is dropped here. Ids come from crypto.randomUUID(), so a later wallet
  // will not collide with the orphan — it would simply sit in the Keychain for the
  // life of the install, holding a key to a wallet the user believes they deleted.
  await disableDeviceAuth(id);
  await storageRemove(cosmosPayKey(id));
  await storageRemove(cosmosPayPendingKey(id));
  // The Pollar session outlives the entry unless it goes here — and unlike an orphaned
  // Keystore key it is a live bearer credential for an account that still holds funds.
  await storageRemove(pollarKey(id));
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
  reenrolDeviceAuth: (walletId: string, newVaultKey: VaultKey) => Promise<boolean>;
}

/**
 * Thrown when a password change fails AFTER the first byte was written.
 *
 * The header below promises the device is left exactly as it was on failure, and that is
 * true only up to the commit. Past it there is no rollback: some wallets are on the new
 * password and some on the old, and the key the caller's session holds is true of neither.
 * A plain `Error` there let `changeAppPassword` flash a message and carry on with a
 * session whose key no longer opens what it thinks it opens — so the class exists to
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
 * The device-lock enrolment holds the vault key sealed under a key in the Keychain, so it
 * has to move in the same pass — the new password derives a different vault key, and the
 * enrolled one stops opening anything. It is dropped BEFORE the commit and re-created
 * after — not re-wrapped afterwards, which was the original design and had no safe
 * interruption: an envelope left holding the OLD key hands `unlock()` something that no
 * longer decrypts, so the user meets "wrong password" coming from their own fingerprint
 * and the failed-attempt ladder counts it against them.
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
  //    `WrongPasswordError` on any wallet leaves the device untouched.
  const opened = [];
  for (const w of wallets) {
    // A Pollar wallet has no secret box; its session box is what the password opens, and
    // `open` there throws `WrongPasswordError` exactly as `unlockWallet` would. Calling
    // `unlockWallet` on one would throw `vault.notFound` and abort a password change
    // that has nothing wrong with it.
    const secret = isPollar(w) ? null : await unlockWallet(w.id, oldPassword);
    const cosmosPay = await readCosmosPayWithPassword(w.id, oldPassword);
    const pollar = await readPollarWithPassword(w.id, oldPassword);
    if (isPollar(w) && !pollar) throw new WrongPasswordError();
    opened.push({ entry: w, secret, cosmosPay, pollar });
  }

  // 2. Seal everything under the new password, still writing nothing. This is pure crypto
  //    over data already in hand: it either all succeeds or throws before any commit.
  //
  //    ONE key for the whole device, derived once. Not only 2N-1 derivations saved on a
  //    slow phone: the session that opens after this has to be able to reach every wallet
  //    with a single key, so sealing each box under its own salt would leave a device that
  //    `convergeSeals` has to walk on the very next unlock.
  const newVaultKey = await deriveVaultKey(newPassword, newKdfParams());
  const sealed = [];
  for (const o of opened) {
    sealed.push({
      entry: o.entry,
      vault: o.secret ? JSON.stringify(await sealWithKey(JSON.stringify(o.secret), newVaultKey)) : null,
      // Re-seal the CosmosPay credential too, otherwise it would be undecryptable.
      cosmosPay: o.cosmosPay ? JSON.stringify(await sealWithKey(JSON.stringify(o.cosmosPay), newVaultKey)) : null,
      // And the Pollar session, for the same reason with a sharper edge: on a Pollar
      // wallet this box is also what the next unlock opens to prove the password, so
      // leaving it on the old key locks the user out of the wallet entirely.
      pollar: o.pollar ? JSON.stringify(await sealWithKey(JSON.stringify(o.pollar), newVaultKey)) : null,
    });
  }

  // 3. Turn every device-lock enrolment OFF, BEFORE the vault moves.
  //
  //    This used to run last, after the commit, and that ordering had no safe failure. An
  //    envelope holds the vault key sealed under a Keystore key; re-wrapping it raises an
  //    OS sheet per wallet, and anything that interrupts the pass — the process dying, the
  //    user walking away, iOS reclaiming the app — left the envelope holding the PRE-CHANGE
  //    key with a still-valid wrapping key beside it. Both halves consistent, so nothing
  //    detects it: `deviceAuthVaultKey` returns that key happily, `unlock()` answers "wrong
  //    password", and the ladder counts the user's own fingerprint as a guess until they
  //    are locked out for five minutes.
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
      if (s.vault) await storageSet(vaultKey(s.entry.id), s.vault);
      if (s.cosmosPay) await storageSet(cosmosPayKey(s.entry.id), s.cosmosPay);
      if (s.pollar) await storageSet(pollarKey(s.entry.id), s.pollar);
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
      back = await deps.reenrolDeviceAuth(entry.id, newVaultKey);
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
    await storageRemove(pollarKey(w.id));
  }
  await storageRemove(WALLETS_KEY);
  await storageRemove(ACTIVE_KEY);
}
