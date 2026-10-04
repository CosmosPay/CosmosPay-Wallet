/**
 * The wallet store: a single hook holding all app state + actions.
 * Instantiated once in <WalletApp/> and passed down to every screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// BIP-39 + SLIP-0010 derivation is ~240 KB of the bundle and is ONLY reachable from
// onboarding (create / import). A returning user who unlocks an existing wallet never
// touches it, so it is imported on demand instead of at module load. The type import
// is erased at compile time and costs nothing.
import type { DerivedAccount } from '@/lib/wallet';
const walletLib = () => import('@/lib/wallet');
// Solana + Monad derivation (bip32, secp256k1, keccak): only when an address is first shown.
const chainLib = () => import('@/lib/chainAddresses');
// Signing on Solana / Monad: loaded on the first swap paid from there, not at startup.
const chainKeysLib = () => import('@/lib/chainKeys');
const chainSwapLib = () => import('@/lib/chainSwap');
// Solana devnet / Monad testnet balances and the devnet airdrop: only on a test network.
const chainRpcLib = () => import('@/lib/chainRpc');
import {
  addWallet as vaultAddWallet,
  changePassword,
  PasswordChangeCommitError,
  clearPendingCosmosPay,
  getActiveEntry,
  getCosmosPay,
  getCustomNetworks,
  getNetworkId,
  listWallets,
  migrate,
  removeWallet as vaultRemoveWallet,
  clearCosmosPay,
  clearReceiver,
  saveCosmosPay,
  saveDefaultReceiver,
  updateWalletMeta,
  setActiveId,
  setCustomNetworks as vaultSetCustomNetworks,
  setNetworkId as vaultSetNetworkId,
  unlockSession,
  unlockWallet,
  convergeSeals,
  openWalletBox,
  openVault,
  purgeLegacyPollar,
  takeLegacyPollarNotice,
  verifyPassword,
  verifyVaultKey,
  type CosmosPayAccount,
  type Gender,
  type VaultSecret,
  type WalletEntry,
} from '@/lib/vault';
import { storageGet, storageSet } from '@/lib/storage';
import { beginAttempt, blockSeconds, noteAttemptSuccess, releaseAttempt } from '@/lib/attempts';
import { VaultKeyMismatchError, WrongPasswordError, deriveVaultKey, newKdfParams, wipeVaultKey, type VaultKey } from '@/lib/crypto';
import { assertSafeToSign, reviewTx } from '@/lib/txGuard';
import { MIN_APP_PWD_LEN, appPasswordOk, isAccessCode, isSafeHorizonUrl } from '@/lib/validate';
import { clampMemoText, memoKindFromSep7, type MemoKind } from '@/lib/memo';
import { assetRefFromGateway, codeIsAmbiguous, toPaymentAsset, XLM, type AssetRef } from '@/lib/asset';
import { FIAT_DECIMALS, fromMinorUnits, toMinorUnitsBig } from '@/lib/amount';
import { createExclusiveRunner, type ExclusiveRunner } from '@/lib/exclusive';
import { recoveryShortfall, sendableAssets, spendableCeiling } from '@/lib/balances';
import { AUTO_LOCK_MS, AUTO_LOCK_CHECK_MS } from '@/constants/app';
import { RECOVERY_PROOF_TTL_MS } from '@/constants/recovery';
import { retryOnNetworkError } from '@/lib/retryNetwork';
import { CROSS_CHAIN_SLIPPAGE_BPS } from '@/constants/swap';
import { fileBackupRecovery, newRecoveryKey, takeBackupRecovery } from '@/lib/backupRecovery';
import {
  CHAIN_CONFIRM_POLL_MS,
  CHAIN_CONFIRM_TIMEOUT_MS,
  CHAIN_EXPLORER_TX,
  CHAIN_SWAP_SLIPPAGE_BPS,
  CHAIN_TESTNET_EXPLORER_TX,
  SOLANA_AIRDROP_LAMPORTS,
  type ChainToken,
  type OtherChain,
} from '@/constants/chains';
import { SCREENS, backTarget, type BackContext, type Screen, type Tab } from '@/lib/screens';
import { hydrate, invalidate, run } from '@/lib/query';
import { useQueryValue } from '@/hooks/useQuery';
import { useDeviceAuth } from '@/state/useDeviceAuth';
import { usePasskey } from '@/state/usePasskey';
import { finishSignIn, replaceBackup as storeBackupBox } from '@/lib/signIn';
import {
  BackupPasskeyError,
  backupDoors,
  addRecoveryDoor,
  resetBackupPassword,
  backupNeedsUpgrade,
  openBackup,
  sealBackup,
  type BackupDoors,
  type BackupKey,
} from '@/lib/cloudBackup';
import { addressOn, keyAddressOf, ledgerOfRekey, rekeyOfBackup, type Rekey } from '@/lib/accountAddress';
import { PasskeyError, createPasskey, getPasskeySecrets, wipePasskeySecrets, type PasskeySecrets } from '@/lib/passkey';
import {
  PasskeyUnlockStaleError,
  devicePasswordFrom,
  dropPasskeyUnlock,
  enrolPasskeyUnlock,
  newDevicePassword,
  unlockWithPasskey as openDeviceWithPasskey,
} from '@/lib/passkeyUnlock';
import { PASSKEY_FAILURE_KEYS } from '@/constants/passkey';
import type { SignInProvider } from '@/constants/signIn';
import { useSignIn } from '@/state/useSignIn';
import { normalizeRails } from '@/lib/fiatRails';
import { deviceAuthFailureKey, type DeviceAuthFailure } from '@/lib/deviceAuth';
import {
  ACCOUNT_PREFIX,
  HISTORY_PREFIX,
  PRICES_KEY,
  RECOVERY_PREFIX,
  TTL,
  accountKey,
  historyKey,
  opsKey,
  recoveryKey,
  type OpsDomain,
} from '@/lib/dataKeys';
import {
  buildKeyReplacement,
  buildRecoveryRemoval,
  buildRecoverySetup,
  collectSignatures,
  deviceKeyFor,
  identityRoute,
  identityTokensFromIdToken,
  keysToRevoke,
  ledgerAccountOf,
  activeSignersOf,
  loadRecoveryServers,
  recoverableAccounts,
  recoveryReachable,
  recoveryStateOf,
  registerForRecovery,
  sequenceOf,
  signedRecoverySetup,
  signersToRemove,
  startRecoveryCodes,
  updateRecoveryIdentities,
  verifyRecoveryCode,
  type RecoverableAccount,
  type RecoveryState,
} from '@/lib/recovery';
import {
  addTrustline as stellarAddTrustline,
  allNetworks,
  fundWithFriendbot,
  topUpFromFriendbot,
  getAccountState,
  getHistory,
  getPrices,
  networkEnv,
  ledgerName,
  resolveNetwork,
  sendPayment,
  signXdr,
  submitXdr as stellarSubmitXdr,
  type AccountState,
  type HistoryOp,
  type NetConfig,
  type LedgerName,
  type PriceInfo,
} from '@/lib/stellar';
import {
  addBankAccount as cpAddBankAccount,
  addReceiverWallet as cpAddReceiverWallet,
  authorizePayout as cpAuthorizePayout,
  blindpayNetwork,
  createPayLink as cpCreatePayLink,
  createPayin as cpCreatePayin,
  createPayout as cpCreatePayout,
  createReceiver as cpCreateReceiver,
  createSwap as cpCreateSwap,
  deleteBankAccount as cpDeleteBankAccount,
  depositLiquidity as cpDepositLiquidity,
  extractUnsignedXdr,
  getReceiver as cpGetReceiver,
  listBankAccounts as cpListBankAccounts,
  listLiquidityPools as cpListLiquidityPools,
  liquidityPositions as cpLiquidityPositions,
  listReceivers as cpListReceivers,
  listRails as cpListRails,
  onrampTrustlineTx as cpOnrampTrustlineTx,
  listSwaps as cpListSwaps,
  listPayins as cpListPayins,
  listPayouts as cpListPayouts,
  listLiquidityOps as cpListLiquidityOps,
  listReceiverWallets as cpListReceiverWallets,
  offrampQuote as cpOfframpQuote,
  onrampQuote as cpOnrampQuote,
  quoteSwap as cpQuoteSwap,
  listCrossChainAssets as cpListCrossChainAssets,
  quoteCrossChainSwap as cpQuoteCrossChainSwap,
  createCrossChainSwap as cpCreateCrossChainSwap,
  reportCrossChainDeposit as cpReportCrossChainDeposit,
  createChainSwap as cpCreateChainSwap,
  submitChainSwap as cpSubmitChainSwap,
  signInEmailStart,
  signInEmailVerify,
  submitLiquidity as cpSubmitLiquidity,
  submitSwap as cpSubmitSwap,
  uploadKycDoc as cpUploadKycDoc,
  withdrawLiquidity as cpWithdrawLiquidity,
  DEFAULT_SLIPPAGE_BPS,
  type BankAccount,
  type CreateReceiverInput,
  type FiatToken,
  type ListPoolsInput,
  type LiquidityPool,
  type LiquidityPosition,
  type Payin,
  type PayinQuote,
  type PayinQuoteInput,
  type PayIntent,
  type PayoutQuote,
  type Receiver,
  type SignInReady,
  type SwapQuote,
  type CrossChainAsset,
  type CrossChainQuote,
  type CrossChainSwapInput,
  type CrossChainTarget,
  type CrossChainNetwork,
  recoverySetupSponsored,
} from '@/lib/cosmospay';
import { useToast } from '@/state/useToast';
import { usePreferences, applySavedThemeEarly, savedRequireConfirm } from '@/state/usePreferences';
import { useSigningGate } from '@/state/useSigningGate';
import { parseStellarQr } from '@/lib/sep7';
import { buildKind } from '@/lib/platform';
import { cachedPublicKey, warmPublicKey } from '@/lib/publicKey';
import {
  configureTelemetry,
  hasFreshOwnership,
  report,
  reportError,
  setTelemetryEnabled,
  telemetryEnabled,
  telemetryInstallId,
} from '@/lib/telemetry';
import { signOwnership } from '@/lib/attestation';
import { EVENT } from '@/constants/telemetry';

export type { Theme } from '@/state/usePreferences';

// Applied at module load, before first paint, so there is no flash of the wrong theme.
applySavedThemeEarly();

// The screen list, each screen's fallback "back" target and which ones show the
// bottom nav all live in one typed table now — see src/lib/screens.ts.
// Re-exported here so the 50-odd `import type { Screen } from '@/state/store'`
// call sites keep working unchanged.
export type { Screen, Tab } from '@/lib/screens';

export interface Session {
  publicKey: string;
  /** Which wallet this session opened. `openVault` reads that wallet's box. */
  walletId: string;
  /**
   * The key that opens every box on this device — and the ONLY secret this object holds.
   *
   * It used to hold three: the app password (so a second wallet could be sealed without
   * re-prompting), the Stellar secret and the mnemonic, all three as JS strings, all three
   * for as long as the session lasted. A string cannot be wiped, so anything that could
   * read this object's memory at any point in a five-minute session got the seed AND a
   * password the user may well use elsewhere.
   *
   * What is here now is derived from the password, never the password; it is device-local
   * and `changePassword` replaces it. The seed and the mnemonic are not here at all —
   * `openVault` fetches the seed for one signature at a time, which is affordable precisely
   * because the expensive half (PBKDF2) already happened at unlock.
   */
  vaultKey: VaultKey;
}

/**
 * The wallet's Stellar secret, decrypted for ONE operation.
 *
 * Module level and not a hook: it needs nothing but the session, so no dependency array can
 * forget it.
 *
 * This is the shape the redesign turns on. The secret used to be a field on `Session` — a
 * plain string, resident for the whole five-minute session, next to the mnemonic and the
 * password. Reading it per signature costs one AES-GCM decrypt of a small blob, which is
 * affordable only because the expensive half of the work (PBKDF2) already happened once at
 * unlock. Do not hoist the result into anything that outlives the call that needs it: every
 * use site below fetches it at the point of use, after `guardSession`.
 */
async function secretOf(s: Session): Promise<string> {
  return (await openVault(s.walletId, s.vaultKey)).secret;
}

/**
 * Which screen a sign-in was started from — the only thing that decides what its `ready`
 * turns into. `onboarding`: a first run, no vault yet. `add`: another wallet on an unlocked
 * device.
 */
export type SignInPurpose = 'onboarding' | 'add';

/**
 * A finished sign-in waiting for the one thing the server cannot supply: a password.
 *
 * With a backup, that is the password it was sealed under, and the wallet is RESTORED. With
 * none — or when the person chose to start over — the wallet is CREATED here and its backup
 * sealed under the device's password (a first run chooses one on the password screen).
 *
 * In memory only, deliberately: `ready.sessionToken` is what lets the server create an
 * account and put a backup under it. Closing the wallet here loses the sign-in, and the
 * person signs in again — nothing is spent by that.
 */
export interface SignInDraft {
  ready: SignInReady;
  purpose: SignInPurpose;
  /**
   * The account has a backup and the person asked to REPLACE it with a new wallet instead
   * of restoring it — after the screen showed them what that gives up. The only way
   * `finishSignIn` is ever sent `replaceBackup`.
   */
  replace: boolean;
}

/**
 * The two optional consents an onboarding flow collects, as an answered pair.
 *
 * A pair rather than two loose booleans because they are answered together, on one
 * screen, and written together into the profile — and because `metricsOptIn` alone
 * decides whether the wallet reports anything at all (`lib/telemetry.ts`), which makes
 * "it was never asked" and "it was declined" worth being unable to confuse.
 */
export interface ConsentAnswers {
  metricsOptIn: boolean;
  promoOptIn: boolean;
}

export interface SuccessInfo {
  title: string;
  msg: string;
  rows: { label: string; val: string }[];
  hash?: string;
  /** Explorer link for `hash` when it is not a Stellar transaction (Solana, Monad). */
  explorer?: string;
  kind?: 'ok' | 'err'; // controls the green check / red cross icon
}

/**
 * Outcome of a password check — see `checkPassword`.
 *
 * Three outcomes, not a boolean: a throttled attempt and a wrong password need different
 * sentences, and the screen must not tell someone holding the right password that it is
 * wrong. `message` is resolved copy, because the store has `t` and the caller only has to
 * render it.
 */
export type PasswordCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong' | 'throttled'; message: string };

/**
 * Outcome of an unlock attempt.
 *
 * The reason is not decoration. `unlockWithDevice` deletes the device enrolment when the
 * password it recovered does not decrypt — that password came from the envelope, so it
 * cannot be a typo — and it must NOT do that when the attempt was merely throttled or
 * raced. A boolean could not tell those apart, and the wrong reading costs the user a
 * working enrolment.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong' | 'throttled' | 'busy' | 'other' };

export type { Toast } from '@/state/useToast';

/**
 * Connecting this wallet to Cosmos Pay: `sent` holds the claim token after the community
 * server emailed the sign-in code, until the code is entered.
 */
export type CosmosLink = { stage: 'sent'; claimToken: string; expiresAt: number };

/** Two decimal strings naming the same amount ("1.50" and "1.5"). */
function sameDecimal(a: string, b: string): boolean {
  const norm = (v: string) => {
    const [whole, frac = ''] = v.trim().split('.');
    const f = frac.replace(/0+$/, '');
    return `${whole.replace(/^0+(?=\d)/, '')}${f ? `.${f}` : ''}`;
  };
  return norm(a) === norm(b);
}

/** A swap side: the asset being sold (source) or bought (destination). `issuer` is
 *  null for native XLM. Built from the wallet's trustline balances. */
export interface SwapAsset {
  code: string;
  issuer: string | null;
}

/** What the liquidity deposit/withdraw form is working on. `deposit` may preset the
 *  pair (e.g. picked from the pool explorer); `withdraw` always carries the position. */
export type LpTarget =
  | { mode: 'deposit'; presetA?: SwapAsset; presetB?: SwapAsset }
  | { mode: 'withdraw'; position: LiquidityPosition };

export interface VerifyTarget {
  index: number;
  word: string;
}

export interface SendDraft {
  to: string;
  amount: string;
  memo: string;
  /** 'text' (default) or 'id' — a SEP-7 MEMO_ID must survive to the built tx. */
  memoKind: MemoKind;
  /** Full (code, issuer) identity. A bare code is ambiguous — see lib/asset.ts. */
  asset: AssetRef;
}

const ACCENT = '#ffffff';

/** Stable empty values: returning a fresh [] / {} on every render would make every
 *  consumer see a "changed" value and re-render forever. */
const EMPTY_PRICES: Record<string, PriceInfo> = {};
const EMPTY_HISTORY: HistoryOp[] = [];

/** Read a SEP-7 `web+stellar:` link from the current URL (?uri=, ?sep7=, or hash). */
function readIncomingSep7(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const cand =
      url.searchParams.get('uri') ||
      url.searchParams.get('sep7') ||
      (url.hash.slice(1).toLowerCase().startsWith('web+stellar:') ? url.hash.slice(1) : '');
    if (cand && cand.toLowerCase().startsWith('web+stellar:')) {
      // Clean the URL so a later refresh doesn't re-trigger the same payment.
      window.history.replaceState(null, '', url.origin + url.pathname);
      return cand;
    }
  } catch {
    /* malformed URL — ignore */
  }
  return null;
}

/** Offer this web wallet as the browser handler for `web+stellar:` links (SEP-7). */
function registerStellarHandler(): void {
  // ONLY the web build may register. In the browser-extension popup,
  // navigator.registerProtocolHandler exists (so the typeof check below passes),
  // but calling it from the tiny action-popup surface crashes the renderer
  // ("se ha bloqueado"). On native it's meaningless. Restrict to the web build.
  if (buildKind() !== 'web') return;
  if (typeof navigator === 'undefined' || typeof navigator.registerProtocolHandler !== 'function') return;
  try {
    // BASE_URL already ends with '/', so it works at the domain root ('/') and on
    // a Pages project subpath ('/<repo>/') alike.
    navigator.registerProtocolHandler(
      'web+stellar',
      window.location.origin + import.meta.env.BASE_URL + '?uri=%s',
    );
  } catch {
    /* not permitted here (insecure origin, etc.) — ignore */
  }
}

/**
 * A recovery's identity tokens, when they belong to THIS sign-in and are still fresh — a
 * little under the servers' own half hour, so a token is never presented stale.
 */
function freshProof(
  proof: { key: string; tokens: string[]; at: number } | null,
  sessionToken: string,
): string[] | null {
  if (!proof || proof.key !== sessionToken) return null;
  return Date.now() - proof.at < RECOVERY_PROOF_TTL_MS ? proof.tokens : null;
}

export function useWalletStore() {
  const [screen, setScreen] = useState<Screen>('boot');
  /** The committed screen, readable from an event handler without a state updater —
   *  see `navigate`. Re-synced every render so the raw `setScreen` calls elsewhere in
   *  this file (lock, the success screens) cannot leave it stale. */
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;
  const [tab, setTab] = useState<Tab>('home');
  const [networkId, setNetworkIdState] = useState<string>('testnet');
  const [customNetworks, setCustomNetworksState] = useState<NetConfig[]>([]);
  const networks = useMemo(() => allNetworks(customNetworks), [customNetworks]);
  const network = useMemo(() => resolveNetwork(networkId, customNetworks), [networkId, customNetworks]);
  /** The active wallet as stored: `publicKey` is its canonical ACCOUNT. */
  const [metaEntry, setMetaState] = useState<WalletEntry | null>(null);
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [rawSession, setSession] = useState<Session | null>(null);
  /**
   * The active wallet and session AS THEY ACT ON THIS NETWORK — what every balance, payment
   * and screen reads. Identical to the stored ones except on a wallet SEP-30 re-keyed on
   * another ledger, which acts as its new key's own address here (`addressOn`). Anything
   * that speaks to the sign-in or backup servers reads `metaEntry` instead: a backup is
   * filed under the canonical account, whatever network the device is on.
   */
  const meta = useMemo(
    () => (metaEntry ? { ...metaEntry, publicKey: addressOn(metaEntry, network.passphrase) } : null),
    [metaEntry, network.passphrase],
  );
  const session = useMemo(
    () =>
      rawSession && metaEntry && rawSession.walletId === metaEntry.id
        ? { ...rawSession, publicKey: addressOn(metaEntry, network.passphrase) }
        : rawSession,
    [rawSession, metaEntry, network.passphrase],
  );
  /**
   * The live session, readable from a callback that must not depend on it.
   *
   * `lock()` is one of those: it is in the dependency list of the idle timer, the Android
   * back handler and half the money flows, so taking `session` as a dependency would give
   * it a new identity on every unlock and re-arm all of them. It needs the session only to
   * wipe the key it carries.
   */
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [addingWallet, setAddingWallet] = useState(false);
  /** A just-created wallet has a one-time offer to turn on the phone's lock. */
  const [deviceAuthOffer, setDeviceAuthOffer] = useState(false);
  // Provisioned CosmosPay account for the active wallet (null until enabled /
  // before unlock). Loaded from the sealed store whenever a session opens.
  const [cosmosPay, setCosmosPay] = useState<CosmosPayAccount | null>(null);
  /**
   * Whether a gateway credential is available at all — this account's, or the
   * shared public one once it has loaded.
   *
   * State rather than a derived boolean because the public key arrives from a
   * fetch: the swap screen must enable itself when it lands, and a plain
   * `cachedPublicKey()` read during render would be false on the first pass and
   * never re-run.
   */
  const [publicKeyReady, setPublicKeyReady] = useState(false);
  // Connecting to Cosmos Pay: 'sent' once the sign-in code is emailed, until it is entered.
  // In-memory only — the code lives in the user's email and is short-lived; a reload
  // simply starts over. See enableReceiving / submitLinkCode.
  const [cosmosLink, setCosmosLink] = useState<CosmosLink | null>(null);

  /**
   * Reads that belong to a (network, account) pair are held in the keyed cache
   * (lib/query.ts) rather than in local state. That is what makes switching network
   * safe: an in-flight request for the old scope is discarded by generation, instead
   * of resolving later and overwriting the new network's balance.
   */
  const scope = useMemo(
    () => ({ net: networkId, pub: meta?.publicKey ?? '' }),
    [networkId, meta?.publicKey],
  );
  const accountK = accountKey(scope.net, scope.pub);
  const historyK = historyKey(scope.net, scope.pub);
  const account = useQueryValue<AccountState>(accountK) ?? null;
  const prices = useQueryValue<Record<string, PriceInfo>>(PRICES_KEY) ?? EMPTY_PRICES;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const history = useQueryValue<HistoryOp[]>(historyK) ?? EMPTY_HISTORY;
  const [historyLoading, setHistoryLoading] = useState(false);
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  // Extension hamburger drawer open-state. Lives HERE (not in the component) so it
  // survives navigating to a hub screen and back: leave via a drawer shortcut,
  // press back, and the drawer is still open — no need to reopen it.
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  const { toast, flash } = useToast();

  /** Load the active wallet's recent on-chain activity (payments/swaps) from Horizon. */
  const loadHistory = useCallback(async () => {
    if (!meta) return;
    setHistoryLoading(true);
    try {
      await run({
        key: historyKey(networkId, meta.publicKey),
        fetcher: () => getHistory(network, meta.publicKey, 40),
        ttl: TTL.history,
        retry: 2,
      });
    } finally {
      setHistoryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, network, networkId]);
  const { theme, setTheme, lang, setLang, t, locale, requireConfirm, setRequireConfirm, diagnostics, setDiagnostics } =
    usePreferences(useCallback((msg: string) => flash(msg, 'info'), [flash]));

  // onboarding drafts
  const [draftMnemonic, setDraftMnemonic] = useState<string>('');
  const [draftAccount, setDraftAccount] = useState<DerivedAccount | null>(null);
  const [draftHasMnemonic, setDraftHasMnemonic] = useState(true);
  const [importText, setImportText] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBirthdate, setDraftBirthdate] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftGender, setDraftGender] = useState<Gender | ''>('');
  // Optional consents asked at signup (both default OFF).
  const [draftMetricsOptIn, setDraftMetricsOptIn] = useState(false);
  const [draftPromoOptIn, setDraftPromoOptIn] = useState(false);

  // verify-phrase state
  const [verifyTargets, setVerifyTargets] = useState<VerifyTarget[]>([]);
  const [verifyFilled, setVerifyFilled] = useState<Record<number, string>>({});
  const [verifyBank, setVerifyBank] = useState<string[]>([]);

  // money flows
  const [send, setSend] = useState<SendDraft>({ to: '', amount: '0', memo: '', memoKind: 'text', asset: XLM });
  const [selectedAsset, setSelectedAsset] = useState<string>('XLM');
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);
  // Liquidity-pool form target (deposit preset or the position being withdrawn).
  const [lpTarget, setLpTarget] = useState<LpTarget | null>(null);

  // SEP-7 payment links (web+stellar:pay?…) — pasted, scanned, or arriving via URL.
  const pendingSep7 = useRef<string | null>(null);
  const applySep7 = useCallback((raw: string): boolean => {
    const parsed = parseStellarQr(raw);
    if (!parsed) return false;
    setSend((s) => ({
      ...s,
      to: parsed.destination,
      amount: parsed.amount ?? s.amount,
      // Byte-accurate clamp, and the memo TYPE travels with it: a MEMO_ID request
      // (how exchanges route a deposit) used to arrive as a text memo and land
      // unattributed. An unsupported type (hash/return) drops the memo entirely
      // rather than mislabelling it.
      memo: parsed.memo ? clampMemoText(parsed.memo) : s.memo,
      memoKind: memoKindFromSep7(parsed.memoType) ?? 'text',
      // The link's asset was parsed and then thrown away, so a request for "10 USDC"
      // prefilled 10 XLM. Only accept the pair when both halves are present.
      asset: parsed.assetCode && parsed.assetIssuer ? { code: parsed.assetCode, issuer: parsed.assetIssuer } : s.asset,
    }));
    return true;
  }, []);

  // The signing gate (prompt + queue) lives in its own slice — see useSigningGate.
  const { confirmReq, requestSignature, resolveConfirm, cancelPending } = useSigningGate();

  /**
   * Unlocking with the phone's own biometrics. Keyed on the ACTIVE wallet, because the
   * enrolment is per wallet id: picking a different wallet on the lock screen has to
   * change the answer to "can this one be opened with a fingerprint".
   *
   * Two objects, and only `deviceAuthPublic` reaches the facade — see useDeviceAuth.
   */
  const { deviceAuthPublic, deviceAuthPrivileged } = useDeviceAuth(meta?.id ?? null, t);

  /**
   * Whether this DEVICE opens with a passkey. Device-wide, not per wallet: the passkey door
   * holds the device's app password — see `lib/passkeyUnlock.ts`.
   */
  const passkey = usePasskey();

  // The door is dropped by `lib/vault.ts` when the last wallet goes, on every removal path;
  // re-reading it whenever the count changes is what keeps the lock screen from offering a
  // passkey for a vault the next onboarding writes under a typed password.
  const { refreshPasskey } = passkey;
  useEffect(() => {
    void refreshPasskey();
  }, [wallets.length, refreshPasskey]);

  /** One-at-a-time execution for the money flows — see lib/exclusive.ts for why. */
  const exclusiveRef = useRef<ExclusiveRunner | null>(null);
  exclusiveRef.current ??= createExclusiveRunner();
  const exclusive = exclusiveRef.current;

  /**
   * Session epoch. Incremented by `lock()`.
   *
   * The signing gate resolves BEFORE the network round trip, so cancelling pending
   * prompts is not enough: a flow that already passed the gate keeps `session` alive
   * in its closure across an `await` that can easily outlast the 5-minute auto-lock —
   * waiting on a gateway generates no pointer or key events. It would then sign and
   * broadcast with the wallet showing the unlock screen, and paint its success screen
   * on top. Each flow captures the epoch before its first await and re-checks it
   * immediately before the key is used.
   */
  const sessionEpochRef = useRef(0);
  const guardSession = useCallback(
    (epoch: number) => {
      if (epoch !== sessionEpochRef.current) throw new Error(t('unlock.autoLocked'));
    },
    [t],
  );

  /* --------------------------- signing --------------------------- */

  /**
   * Sign an envelope with this wallet's key, fetched from the vault for this one signature.
   *
   * Deliberately the LAST step of every money flow. Each flow still reads:
   *
   *     assertSafeToSign(network, xdr, { intent, signer, ...bounds });
   *     guardSession(epoch);
   *     const signed = await signEnvelope(xdr);
   *
   * so what the wallet is willing to put its name to is decided in exactly one place.
   */
  const signEnvelope = useCallback(
    async (xdr: string): Promise<string> => {
      if (!session) throw new Error(t('unlock.autoLocked'));
      return signXdr(network, await secretOf(session), xdr);
    },
    [session, network, t],
  );

  /** Toggle manual confirmations — always password-gated (prevents an attacker
   *  silently disabling protection on an unlocked wallet). */
  const toggleConfirm = useCallback(async () => {
    const ok = await requestSignature({ title: t('confirmSig.settingTitle'), message: t('confirmSig.settingMsg') }, true);
    if (ok) setRequireConfirm(!savedRequireConfirm());
  }, [requestSignature, setRequireConfirm, t]);

  /**
   * Write non-sensitive metadata for the active wallet and bring both copies of it —
   * the list and the active entry — back into step.
   *
   * One helper because the two copies must move together: updating the list and leaving
   * `meta` stale shows the old value everywhere until the next switch, and every caller
   * that wrote the pair by hand was one line away from doing exactly that.
   */
  const patchMeta = useCallback(
    async (patch: Parameters<typeof updateWalletMeta>[1]) => {
      if (!meta) return;
      const next = await updateWalletMeta(meta.id, patch);
      setWallets(next);
      const entry = next.find((w) => w.id === meta.id);
      if (entry) setMetaState(entry);
    },
    [meta],
  );

  /** Set the active wallet's profile picture (small data URL). */
  const setWalletAvatar = useCallback(async (dataUrl: string) => patchMeta({ avatar: dataUrl }), [patchMeta]);

  /** Change the active wallet's email — Cosmos Pay registration/linking is tied to it. */
  const setWalletEmail = useCallback(
    async (email: string) => {
      await patchMeta({ email: email.trim() });
      flash(t('profile.emailUpdated'), 'ok');
    },
    [patchMeta, flash, t],
  );

  /** Update the editable profile fields at once (name, email, gender). The birthdate
   *  is deliberately NOT editable — age gates (13+, 18+ fiat) must stay trustworthy. */
  const saveProfile = useCallback(
    async (fields: { name: string; email: string; gender: Gender }) => {
      // `recoveryEmail` is deliberately untouched here. It is what two servers were told,
      // not a profile field, and it only changes when they have been told again —
      // see `updateRecoveryEmail`, which needs the account's key to say so.
      await patchMeta({
        name: fields.name.trim() || 'astronauta',
        email: fields.email.trim(),
        gender: fields.gender,
      });
      flash(t('profile.saved'), 'ok');
    },
    [patchMeta, flash, t],
  );

  /* ----------------------------- boot ----------------------------- */
  useEffect(() => {
    // SEP-7: become the browser handler for web+stellar: links + pick up an incoming one.
    registerStellarHandler();
    const incoming = readIncomingSep7();
    if (incoming) pendingSep7.current = incoming;

    (async () => {
      // Prices persist across a popup close, so the last known quotes are on screen
      // before the network answers. Marked stale on load, so they revalidate.
      void hydrate(PRICES_KEY);
      await migrate();
      // What the old Pollar login left on this device goes before anything reads the list:
      // a Pollar wallet opens nothing and signs nothing now, and its funds were never here.
      await purgeLegacyPollar();
      const removedPollar = await takeLegacyPollarNotice();
      if (removedPollar) flash(t('pollar.removedNotice', { n: removedPollar }), 'info');
      const [list, active, netId, custom] = await Promise.all([
        listWallets(),
        getActiveEntry(),
        getNetworkId(),
        getCustomNetworks(),
      ]);
      setWallets(list);
      setCustomNetworksState(custom);
      setNetworkIdState(netId);
      if (active) setMetaState(active);
      setScreen(list.length > 0 ? 'unlock' : 'welcome');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once unlocked, if a SEP-7 link is waiting, jump straight into a prefilled send.
  useEffect(() => {
    if (session && pendingSep7.current) {
      const uri = pendingSep7.current;
      pendingSep7.current = null;
      if (applySep7(uri)) setScreen('send');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /* ------------------------- data loading ------------------------- */
  const refresh = useCallback(
    async (silent = false) => {
      if (!session) return;
      if (!silent) setLoading(true);
      try {
        await Promise.all([
          // `force` on an explicit (non-silent) refresh; the polling call honours the
          // TTL, so the 30s interval and the visibilitychange handler firing together
          // are one request, not two.
          run(
            {
              key: accountKey(networkId, session.publicKey),
              fetcher: () => getAccountState(network, session.publicKey),
              ttl: TTL.account,
              retry: 2, // idempotent read — safe to retry, unlike anything that signs
            },
            !silent,
          ),
          run({
            key: PRICES_KEY,
            fetcher: async () => {
              const pr = await getPrices();
              // getPrices swallows a 429 and returns {}; keeping the previous map is
              // better than blanking every value in the UI.
              return Object.keys(pr).length ? pr : (prices ?? EMPTY_PRICES);
            },
            ttl: TTL.prices,
            retry: 2,
            persist: true, // a reopened popup paints the last known prices instantly
          }),
        ]);
      } catch (e) {
        flash((e as Error).message || t('home.loadError'), 'err');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, network, networkId, flash],
  );

  // reload whenever the session opens or the network changes
  useEffect(() => {
    if (session) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, network]);

  /* --------------------------- favorite assets -------------------------- */
  // Starred asset codes (always visible among the home top-5). Per wallet,
  // plaintext (non-sensitive), persisted under cosmos.favs.<walletId>.
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      if (!meta?.id) return setFavorites([]);
      const raw = await storageGet(`cosmos.favs.${meta.id}`);
      try {
        setFavorites(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        setFavorites([]);
      }
    })();
  }, [meta?.id]);
  const toggleFavorite = useCallback(
    (code: string) => {
      if (!meta?.id) return;
      setFavorites((f) => {
        const next = f.includes(code) ? f.filter((c) => c !== code) : [...f, code];
        // Explicitly fire-and-forget: a lost favourite is not worth an error path.
        void storageSet(`cosmos.favs.${meta.id}`, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [meta?.id],
  );

  // Auto-refresh: there is no manual reload button — a silent poll keeps balances
  // and prices current, plus an immediate refresh whenever the surface becomes
  // visible again (popup reopened / side panel or tab refocused).
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => refresh(true), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, network]);

  /* --------------------------- onboarding ------------------------- */
  const startCreate = useCallback(async () => {
    const { createMnemonic, accountFromMnemonic } = await walletLib();
    const mnemonic = createMnemonic();
    const acc = await accountFromMnemonic(mnemonic);
    setDraftMnemonic(mnemonic);
    setDraftAccount(acc);
    setDraftHasMnemonic(true);
    setVerifyFilled({});
    setScreen('backup');
  }, []);

  const beginVerify = useCallback(() => {
    const words = draftMnemonic.split(' ');
    const idx: number[] = [];
    while (idx.length < 3) {
      const r = Math.floor(Math.random() * words.length);
      if (!idx.includes(r)) idx.push(r);
    }
    idx.sort((a, b) => a - b);
    const targets = idx.map((i) => ({ index: i, word: words[i] }));
    // distractors from the standard list aren't available here; reuse other seed words
    const others = words.filter((_, i) => !idx.includes(i));
    const distract: string[] = [];
    while (distract.length < 3 && others.length) {
      const w = others[Math.floor(Math.random() * others.length)];
      if (!distract.includes(w)) distract.push(w);
    }
    const bank = [...targets.map((t) => t.word), ...distract].sort(() => Math.random() - 0.5);
    setVerifyTargets(targets);
    setVerifyFilled({});
    setVerifyBank(bank);
    setScreen('verify');
  }, [draftMnemonic]);

  const tapChip = useCallback(
    (word: string) => {
      setVerifyFilled((filled) => {
        const next = verifyTargets.find((t) => !(t.index in filled));
        if (!next) return filled;
        return { ...filled, [next.index]: word };
      });
    },
    [verifyTargets],
  );
  const tapSlot = useCallback((index: number) => {
    setVerifyFilled((filled) => {
      const copy = { ...filled };
      delete copy[index];
      return copy;
    });
  }, []);
  const verifyOk = useMemo(
    () =>
      verifyTargets.length > 0 && verifyTargets.every((t) => verifyFilled[t.index] === t.word),
    [verifyTargets, verifyFilled],
  );

  const submitImport = useCallback(async () => {
    try {
      const { importAccount } = await walletLib();
      const { account: acc, mnemonic } = await importAccount(importText);
      setDraftAccount(acc);
      setDraftMnemonic(mnemonic ?? '');
      setDraftHasMnemonic(!!mnemonic);
      // Reported HERE rather than at the end of onboarding, so an import that parsed but
      // was abandoned at the password screen is still visible — the drop-off between
      // these two events is the thing worth seeing.
      report(EVENT.walletImported, { category: 'lifecycle', props: { hasMnemonic: !!mnemonic } });
      setScreen('profile-setup');
    } catch (e) {
      // The message only ever describes the FORM of what was pasted ("not a valid secret
      // key or recovery phrase"); the text itself is a seed and never leaves the device.
      reportError(EVENT.walletImported, e);
      flash((e as Error).message, 'err');
    }
  }, [importText, flash]);

  /* ----------------------------- signing in ----------------------------- */
  /* Declared up here, not down with the sign-in actions, because `finishOnboarding` is a
     caller: a first-run sign-in with no backup ends at the password screen, and the wallet
     is created from there. */

  /** Where a sign-in is and what this deployment offers — see `state/useSignIn.ts`. */
  const signIn = useSignIn(t, flash, () => warmPublicKey(networkEnv(network)));

  /** See {@link SignInDraft}: a finished sign-in waiting for its password. */
  const [signInDraft, setSignInDraft] = useState<SignInDraft | null>(null);

  /**
   * Put a wallet a sign-in produced on this device: sealed under `vk`, with the account
   * keys that came back, as the active wallet of a session on `vk`.
   *
   * One function for a first run (a key derived from the password just chosen) and another
   * wallet on an unlocked device (the session's own key), because the only real difference
   * is where the key came from. Written twice, one copy is the one that forgets
   * `saveCosmosPay` and leaves a wallet that can sign but cannot swap.
   *
   * `cosmosPay` moves with the active wallet for the reason it always has: leaving the
   * previous wallet's key in state would attribute this one's swaps to another account.
   */
  const landSignedInWallet = useCallback(
    async (input: {
      secret: VaultSecret;
      publicKey: string;
      /** Set when `publicKey` is an account re-keyed on one ledger (`lib/accountAddress.ts`). */
      rekey?: Rekey;
      ready: SignInReady;
      account: CosmosPayAccount;
      vk: VaultKey;
      consents: ConsentAnswers;
      /**
       * The session epoch captured before the first await, when landing on a LIVE session's
       * key. A sign-in spends seconds in PBKDF2 and on the network, long enough for the idle
       * auto-lock to fire underneath it — and without this check the `setSession` below would
       * reopen the session the lock had just closed.
       */
      epoch?: number;
    }): Promise<WalletEntry> => {
      if (input.epoch !== undefined) guardSession(input.epoch);
      const { identity } = input.ready;
      const entry = await vaultAddWallet(
        input.secret,
        {
          publicKey: input.publicKey,
          // The provider's name when it gave one; the email's local part otherwise, which
          // the person can change in Edit profile. Never the provider's avatar URL: the
          // app's CSP loads no remote images, and a URL there would render as a hole.
          name: identity.name?.trim() || identity.email.split('@')[0] || 'astronauta',
          birthdate: '',
          email: identity.email,
          gender: 'x',
          metricsOptIn: input.consents.metricsOptIn,
          promoOptIn: input.consents.promoOptIn,
          cloudBackup: true,
          rekey: input.rekey,
        },
        input.vk,
      );
      // `addWallet` hands an entry back unchanged when this address was already on the
      // device — restoring a wallet it knew — so the flag is written either way.
      if (!entry.cloudBackup) await updateWalletMeta(entry.id, { cloudBackup: true });
      await saveCosmosPay(entry.id, input.account, input.vk);

      const list = await listWallets();
      const landed = list.find((w) => w.id === entry.id) ?? entry;
      setWallets(list);
      setMetaState(landed);
      setSession({ publicKey: landed.publicKey, walletId: landed.id, vaultKey: input.vk });
      setCosmosPay(input.account);
      return landed;
    },
    [meta, guardSession],
  );

  /**
   * Bring back every OTHER wallet the account keeps a backup of, after the newest one
   * landed as the active wallet.
   *
   * Best-effort and additive: each box opens with the same key the person just proved
   * (their password, or the passkey), is added under the session's vault key, and gets the
   * account's API keys. A box sealed under another password — backed up from a device that
   * had a different one — stays closed and is counted, so the person knows to sign in with
   * that password too. Only Stellar boxes: this wallet has no Solana or Monad wallets of
   * its own; those addresses come back with the phrase (see `lib/chainAddresses.ts`).
   *
   * The active wallet is put back afterwards: `addWallet` makes each one it adds active.
   */
  /**
   * File an email-recovery key for one backup (`lib/backupRecovery.ts`), when both recovery
   * servers answer. Best effort: null means the box goes up without that door — the sign-in,
   * restore or password change it rides on carries on either way. The caller seals the box
   * with the key it gets back, uploads it, and zeroes the key.
   */
  const fileRecovery = useCallback(
    async (secret: string, address: string, email: string | null | undefined): Promise<Uint8Array | null> => {
      // Quiet on a build whose two servers are not deployed: nothing to offer, nothing wrong.
      if (!email || !(await recoveryReachable(network))) return null;
      const key = newRecoveryKey();
      try {
        await fileBackupRecovery(network, secret, address, email, key);
        return key;
      } catch (e) {
        key.fill(0);
        reportError(EVENT.backupUpdateFailed, e);
        return null;
      }
    },
    [network],
  );

  /** Record which inbox a wallet's backup halves were filed under — the servers never say. */
  const noteBackupRecovery = useCallback(async (id: string, email: string) => {
    const list = await updateWalletMeta(id, { backupRecoveryEmail: email.trim().toLowerCase() });
    setWallets(list);
    const entry = list.find((w) => w.id === id);
    if (entry) setMetaState((cur) => (cur?.id === id ? entry : cur));
  }, []);

  const restoreOtherBackups = useCallback(
    async (input: {
      ready: SignInReady;
      key: BackupKey;
      vk: VaultKey;
      primary: WalletEntry;
      account: CosmosPayAccount;
      consents: ConsentAnswers;
    }): Promise<void> => {
      const others = (input.ready.backups ?? []).filter(
        (b) => (b.chain ?? 'stellar') === 'stellar' && b.stellarAddress !== input.primary.publicKey,
      );
      if (!others.length) return;
      const { identity } = input.ready;
      const base = identity.name?.trim() || identity.email.split('@')[0] || 'astronauta';
      let restored = 0;
      let closed = 0;
      for (const b of others) {
        try {
          const secret = await openBackup(b.box, input.key, b.stellarAddress);
          const entry = await vaultAddWallet(
            { secret: secret.secret, mnemonic: secret.mnemonic },
            {
              publicKey: b.stellarAddress,
              name: `${base} · ${b.stellarAddress.slice(-4)}`,
              birthdate: '',
              email: identity.email,
              gender: 'x',
              metricsOptIn: input.consents.metricsOptIn,
              promoOptIn: input.consents.promoOptIn,
              cloudBackup: true,
              rekey: rekeyOfBackup(secret),
            },
            input.vk,
          );
          if (!entry.cloudBackup) await updateWalletMeta(entry.id, { cloudBackup: true });
          await saveCosmosPay(entry.id, input.account, input.vk);
          restored += 1;
          // The same Argon2id upgrade the newest box got, best-effort: a failure leaves the
          // old box, which still opens.
          if (typeof input.key === 'string' && backupNeedsUpgrade(b.box)) {
            const password = input.key;
            void (async () => {
              await storeBackupBox({
                secret: secret.secret,
                box: await sealBackup(
                  { secret: secret.secret, mnemonic: secret.mnemonic },
                  password,
                  b.stellarAddress,
                  secret.rekeyedOn,
                ),
                account: b.stellarAddress,
                network: secret.rekeyedOn ? ledgerName(secret.rekeyedOn) : null,
                accessKey: await warmPublicKey(networkEnv(network)),
              });
            })().catch((e) => reportError(EVENT.backupUpdateFailed, e));
          }
        } catch {
          closed += 1;
        }
      }
      await setActiveId(input.primary.id);
      setWallets(await listWallets());
      if (restored) flash(t('backup.restoredMore', { n: restored }), 'ok');
      if (closed) flash(t('backup.otherPassword', { n: closed }), 'info');
    },
    [flash, t, network],
  );

  /**
   * A NEW wallet for a sign-in: the seed is generated here, sealed for the backup under
   * `password`, and only then is the server told — the signature it needs is made by the
   * key that was just generated, which is what binds the account to it.
   *
   * The server is told BEFORE the wallet is written locally, on purpose. If the local
   * write then fails the backup is already safe and a restore brings the wallet back; the
   * other order could leave a funded-to-be wallet on the device that nothing backs up.
   *
   * Returns null on `backup_conflict`: another device backed a wallet up for this account
   * since the sign-in began. Nothing was created, and the person signs in again to restore it.
   */
  const createFromSignIn = useCallback(
    async (
      draft: SignInDraft,
      /** The backup's doors: the password, or a passkey on a passkey device. */
      doors: string | BackupDoors,
      vk: VaultKey,
      consents: ConsentAnswers,
      epoch?: number,
    ): Promise<WalletEntry | null> => {
      // Through `walletLib()` like every other caller: SEP-5 derivation is ~240 KB that an
      // unlock must never load.
      const { createMnemonic, accountFromMnemonic } = await walletLib();
      const mnemonic = createMnemonic();
      const acc = await accountFromMnemonic(mnemonic);
      const secret: VaultSecret = { secret: acc.secret, mnemonic };
      const email = draft.ready.identity.email;
      const recovery = await fileRecovery(acc.secret, acc.publicKey, email);
      const box = await sealBackup(
        secret,
        recovery ? { ...(typeof doors === 'string' ? { password: doors } : doors), recovery } : doors,
      );
      recovery?.fill(0);
      const res = await finishSignIn({
        sessionToken: draft.ready.sessionToken,
        email: draft.ready.identity.email,
        secret: acc.secret,
        backup: box,
        replaceBackup: draft.replace,
        accessKey: await warmPublicKey(networkEnv(network)),
      });
      if (res.status === 'backup_conflict') {
        flash(t('backup.conflict'), 'err');
        return null;
      }
      const entry = await landSignedInWallet({
        secret,
        publicKey: acc.publicKey,
        ready: draft.ready,
        account: { keys: res.keys, organizationId: res.organizationId },
        vk,
        consents,
        epoch,
      });
      if (entry && recovery) await noteBackupRecovery(entry.id, email);
      return entry;
    },
    [landSignedInWallet, fileRecovery, noteBackupRecovery, flash, t],
  );

  /**
   * Final onboarding step. When adding a wallet to an unlocked session the app
   * password is reused (no password screen); for the first wallet `password` is
   * supplied by the PasswordSetup screen — or, on a passkey device, generated by
   * `finishOnboardingWithPasskey`, which passes the passkey that holds it as
   * `passkeyDoor` so the cloud backup gets that door instead of a password nobody knows.
   *
   * Returns whether a wallet was created, so a caller that prepared something for it (a
   * passkey door) can take it back out when it was not.
   */
  const finishOnboarding = useCallback(
    async (password?: string, passkeyDoor?: PasskeySecrets): Promise<boolean> => {
      // A first-run sign-in with nothing to restore, or one that chose to replace its
      // backup. Checked FIRST and on its own terms: this flow never fills `draftAccount` —
      // the onboarding screens that do were skipped — so the guard below would drop it on
      // the floor. The same password seals the vault and the cloud backup, so the person
      // has one password to remember on every device.
      if (signInDraft?.purpose === 'onboarding') {
        // A generated device password is not held to the human rule — it is 32 random bytes.
        if (!password || (!passkeyDoor && !appPasswordOk(password))) return false;
        setBusy(true);
        try {
          const vk = await deriveVaultKey(password, newKdfParams());
          // The consent step that follows the password on this path (PasswordSetup) fills
          // the same two drafts the seed path fills on `profile-setup`. Applied BEFORE the
          // wallet is landed, so the profile records the answer at creation and the very
          // first event this wallet could report is already covered by it.
          const consents = { metricsOptIn: draftMetricsOptIn, promoOptIn: draftPromoOptIn };
          setTelemetryEnabled(consents.metricsOptIn);
          const doors: string | BackupDoors = passkeyDoor
            ? { passkey: { id: passkeyDoor.credentialId, secret: passkeyDoor.backup } }
            : password;
          const entry = await createFromSignIn(signInDraft, doors, vk, consents);
          setSignInDraft(null);
          if (!entry) {
            // Backed up from another device meanwhile: signing in again restores that one.
            setScreen('sign-in');
            return false;
          }
          report(EVENT.walletCreated, { category: 'lifecycle', props: { added: false, signIn: true } });
          setSuccessInfo({
            title: t('success.welcome', { name: entry.name }),
            msg: t('success.protected'),
            rows: [
              { label: t('success.user'), val: entry.name },
              { label: t('success.status'), val: t('success.encrypted') },
            ],
          });
          setDeviceAuthOffer(deviceAuthPublic.deviceAuthPossible && deviceAuthPublic.deviceAuthAvailable);
          setScreen('success');
          return true;
        } catch (e) {
          flash((e as Error).message, 'err');
          return false;
        } finally {
          setBusy(false);
        }
      }

      if (!draftAccount) return false;
      // Adding a wallet to an unlocked session reuses that session's key — which is what
      // "no password screen" means now. The first wallet on a device derives one from the
      // password the setup screen just collected, and that derivation is what makes its
      // parameters the ones every later box converges onto.
      const reuse = addingWallet ? session?.vaultKey : null;
      if (addingWallet ? !reuse : !password) return false;
      setBusy(true);
      try {
        const vk = reuse ?? (await deriveVaultKey(password as string, newKdfParams()));
        const entry = await vaultAddWallet(
          { secret: draftAccount.secret, mnemonic: draftHasMnemonic ? draftMnemonic : null },
          {
            publicKey: draftAccount.publicKey,
            name: draftName.trim() || 'astronauta',
            birthdate: draftBirthdate,
            email: draftEmail.trim(),
            gender: draftGender || 'x',
            metricsOptIn: draftMetricsOptIn,
            promoOptIn: draftPromoOptIn,
          },
          vk,
        );
        setMetaState(entry);
        setWallets(await listWallets());
        setSession({ publicKey: draftAccount.publicKey, walletId: entry.id, vaultKey: vk });
        setCosmosPay(null); // fresh wallet — receiving not enabled yet
          setSuccessInfo({
          title: t(addingWallet ? 'success.added' : 'success.welcome', { name: entry.name }),
          msg: t('success.protected'),
          rows: [
            { label: t('success.user'), val: entry.name },
            { label: t('success.status'), val: t('success.encrypted') },
          ],
        });
        // The signup consent is what decides whether this wallet reports anything at
        // all — `setup.metricsOptIn`, unchecked by default. Applied BEFORE the first
        // report below, so the event that announces the wallet is itself covered by
        // the answer the user just gave. The sign-in branch above does the same with
        // the same drafts; both paths ask, neither assumes. See lib/telemetry.ts.
        setTelemetryEnabled(!!draftMetricsOptIn);
        // That a wallet now exists, and nothing about it: no address, no name, no email.
        // `added` separates a second wallet from a first run — the two have very
        // different completion rates and only one of them is onboarding.
        report(EVENT.walletCreated, {
          category: 'lifecycle',
          props: { added: addingWallet, signIn: false },
        });
        setAddingWallet(false);
        // Offered after the success card, not instead of it. Only when the device can
        // actually do it — otherwise the screen would be a dead end explaining a
        // feature this phone does not have.
        setDeviceAuthOffer(deviceAuthPublic.deviceAuthPossible && deviceAuthPublic.deviceAuthAvailable);
        setScreen('success');
        // wipe drafts from memory
        setDraftMnemonic('');
        setImportText('');
        return true;
      } catch (e) {
        flash((e as Error).message, 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [draftAccount, draftMnemonic, draftHasMnemonic, draftName, draftBirthdate, draftEmail, draftGender, draftMetricsOptIn, draftPromoOptIn, addingWallet, session, deviceAuthPublic, signInDraft, createFromSignIn, t, flash],
  );

  /* ----------------------------- unlock --------------------------- */

  /**
   * CLAIM one password attempt, for every path that turns a typed string into the seed.
   *
   * Not a read: it counts the guess as it checks the ladder, in one step, BEFORE the
   * derivation. Checking first and counting afterwards left the ~250ms of PBKDF2 between
   * the two, so every attempt launched inside that window read a clean record. Returns the
   * message to show, or null when the attempt may proceed — a caller that gets null owes
   * either `noteAttemptSuccess` or `forgetAttempt`. See lib/attempts.ts for the ladder.
   */
  const claimAttempt = useCallback(async (): Promise<string | null> => {
    const ms = await beginAttempt();
    return ms > 0 ? t('pwd.tooManyAttempts', { secs: String(blockSeconds(ms)) }) : null;
  }, [t]);

  /**
   * Undo the reservation `claimAttempt` took, when the attempt was never really made.
   *
   * `beginAttempt` counts the guess UP FRONT — that is what closed the window where every
   * attempt launched during one PBKDF2 run saw a clean record. The cost is that a failure
   * which was not a wrong password (no wallet on the device, a storage fault, an
   * unparseable vault blob) would otherwise walk the owner up the ladder while the screen
   * blames something else entirely. Only `WrongPasswordError` — the GCM tag failing to
   * verify — is a guess.
   */
  const forgetAttempt = useCallback(async (err: unknown) => {
    if (!(err instanceof WrongPasswordError)) await releaseAttempt();
  }, []);

  /**
   * The translated line for an error thrown out of `lib/crypto`.
   *
   * Those two classes carry stable ENGLISH messages on purpose: `lib/crypto.ts` is the
   * crypto core, it stays dependency-free, and its message is an identifier for whoever is
   * reading a stack trace. The rule that follows from that — stated on `WrongPasswordError`
   * itself — is that the SCREEN renders the translated line and branches on `instanceof`,
   * never on the text. Flashing `e.message` skipped that half, so a Spanish-default wallet
   * answered a mistyped password with "Wrong password." and, once the session started
   * carrying a key, a `VaultKeyMismatchError` with a sentence about KDF parameters.
   *
   * Anything else already arrives translated — `lib/` throws through `tNow` — so it is
   * passed through untouched.
   */
  const errLine = useCallback(
    (e: unknown): string => {
      if (e instanceof WrongPasswordError) return t('confirmSig.wrongPwd');
      if (e instanceof VaultKeyMismatchError) return t('vault.keyMismatch');
      return (e as Error).message;
    },
    [t],
  );

  /**
   * Serialises unlock attempts within this document.
   *
   * A ref, not `busy`: `busy` is React state, so two Enter keydowns in the same frame both
   * read the pre-update value and both start a derivation. Holding Enter down with key
   * auto-repeat launched roughly eight per PBKDF2 window, and CPU contention made the
   * window longer, which admitted more — a loop with no ceiling in code. The ladder in
   * `lib/attempts.ts` now reserves before deriving, so those attempts would all be counted;
   * this stops them being started at all, which is what keeps the phone responsive.
   */
  const unlockInFlight = useRef(false);

  /**
   * Everything a session needs once the key is proven, from either door.
   *
   * Shared by `unlock` (a typed password) and `unlockWithKey` (the phone's own lock). They
   * differ only in how the key was obtained; what a session IS must not depend on that, and
   * when it did, the biometric path quietly skipped loading the Cosmos Pay state.
   */
  const openSession = useCallback(async (entry: WalletEntry, vaultKey: VaultKey) => {
    setMetaState(entry);
    setWallets(await listWallets());
    setSession({ publicKey: entry.publicKey, walletId: entry.id, vaultKey });
    setCosmosPay(await getCosmosPay(entry.id, vaultKey));
    // What the retired email-link flow left behind: a claim token for a platform route
    // that no longer exists, plus the email and address in plaintext.
    void clearPendingCosmosPay(entry.id);
    setTab('home');
    setScreen('home');
  }, []);

  /**
   * Prove the live session's key opens `entry` before a session adopts it — switching to
   * it, falling onto it after a removal. A key that does not open it is a hard failure.
   */
  const adoptWallet = useCallback(async (entry: WalletEntry, vaultKey: VaultKey): Promise<void> => {
    await openWalletBox(entry, vaultKey);
  }, []);

  const unlock = useCallback(
    /**
     * `via` says where the password came from. A passkey device's password comes out of the
     * passkey door (`unlockWithPasskey`), and one that does not open the vault is a stale
     * door, not a typo — the line shown has to say which.
     */
    async (password: string, via: 'password' | 'passkey' = 'password'): Promise<UnlockResult> => {
      if (unlockInFlight.current) return { ok: false, reason: 'busy' };
      unlockInFlight.current = true;
      setBusy(true);
      try {
        const blocked = await claimAttempt();
        if (blocked) {
          flash(blocked, 'err');
          return { ok: false, reason: 'throttled' };
        }
        // ONE derivation for the whole session. `unlockSession` finds the active wallet,
        // derives the key from the typed password and proves it against that wallet's box.
        // A throw is not necessarily a wrong password — the blob can be missing or
        // unparseable — and `forgetAttempt` is what keeps that from counting as a guess.
        const opened = await unlockSession(password).catch(async (err: unknown) => {
          await forgetAttempt(err);
          throw err;
        });
        await noteAttemptSuccess();
        // AWAITED, and before the session opens. Every silent path from here on runs on the
        // session's key, so a box left under other parameters would surface as a failure in
        // front of the user instead of as a background chore. A device that has already
        // converged pays one read per box and no crypto at all.
        const vaultKey = await convergeSeals(password, opened.vaultKey);
        await openSession(opened.entry, vaultKey);
        report(EVENT.unlockOk, { category: 'auth', props: { method: via } });
        return { ok: true };
      } catch (e) {
        // By CLASS, never by the rendered line: `errLine` is translated copy, so a feed
        // grouped on it would split one failure across five languages. `reportError`
        // keeps the class name and the gateway's code, which is what groups.
        reportError(EVENT.unlockFailed, e, { method: via, wrong: e instanceof WrongPasswordError });
        flash(via === 'passkey' && e instanceof WrongPasswordError ? t('passkey.err.stale') : errLine(e), 'err');
        // The reason is classified rather than folded into a boolean because the unlock
        // screen says different things about a typo, a throttled attempt and a vault it
        // could not read at all. `unlockWithKey` below makes the same distinction for the
        // same reason, and acts on it harder: there, "wrong" costs the user an enrolment.
        return { ok: false, reason: e instanceof WrongPasswordError ? 'wrong' : 'other' };
      } finally {
        unlockInFlight.current = false;
        setBusy(false);
      }
    },
    [flash, claimAttempt, forgetAttempt, openSession, errLine, t],
  );

  /**
   * The same unlock, entered with a key the phone's lock screen released instead of a
   * password (`unlockWithDevice`).
   *
   * It runs the SAME ladder. A key that does not open the vault is not a typo — an envelope
   * cannot mistype — but it is still an attempt at the vault, and leaving this path
   * unmetered would put an unthrottled oracle beside the metered one.
   *
   * IT CONVERGES NOTHING, and that is a real limitation rather than an oversight: bringing
   * boxes onto new KDF parameters needs the password, and this path deliberately never sees
   * one. The consequence is narrow. An envelope can only have been written by a session
   * that had already converged, so its key fits the boxes as they stand; what it cannot do
   * is carry the device onto a cost this build raised since. A user who unlocks only with
   * their fingerprint therefore stays on the previously shipped cost until they next type
   * their password — which they still do, for `changeAppPassword`, `revealBackup` and every
   * signing prompt when manual confirmation is on. If a future raise is important enough to
   * force, this is the place that has to ask for the password.
   */
  const unlockWithKey = useCallback(
    async (vaultKey: VaultKey): Promise<UnlockResult> => {
      if (unlockInFlight.current) return { ok: false, reason: 'busy' };
      unlockInFlight.current = true;
      setBusy(true);
      try {
        const blocked = await claimAttempt();
        if (blocked) {
          flash(blocked, 'err');
          return { ok: false, reason: 'throttled' };
        }
        const entry = await getActiveEntry();
        if (!entry) {
          await releaseAttempt(); // nothing was guessed — see forgetAttempt
          throw new Error(t('vault.notFound'));
        }
        await openWalletBox(entry, vaultKey).catch(async (err: unknown) => {
          await forgetAttempt(err);
          throw err;
        });
        await noteAttemptSuccess();
        await openSession(entry, vaultKey);
        report(EVENT.unlockOk, { category: 'auth', props: { method: 'device' } });
        return { ok: true };
      } catch (e) {
        reportError(EVENT.unlockFailed, e, { method: 'device' });
        flash(errLine(e), 'err');
        // Both failures mean the same thing here — this key does not open this vault — and
        // the caller turns that into "the enrolment is stale". A storage fault does not,
        // and must not cost the user a working enrolment.
        const dead = e instanceof WrongPasswordError || e instanceof VaultKeyMismatchError;
        return { ok: false, reason: dead ? 'wrong' : 'other' };
      } finally {
        unlockInFlight.current = false;
        setBusy(false);
      }
    },
    [flash, claimAttempt, forgetAttempt, openSession, t, errLine],
  );

  /**
   * Navigation stack. This was a ONE-DEEP slot (`prevScreenRef`) that `back()` reset
   * to 'home' after every use, so any three-level flow lost its origin — and the
   * "where can I return to" question was answered by a hardcoded list of eleven
   * screen names. A real stack answers it exactly, and the table in
   * lib/screens.ts supplies the fallback when the stack is empty.
   *
   * Declared here rather than beside `navigate`/`goBack` because `lock()` below has
   * to be able to empty it.
   */
  const stackRef = useRef<Screen[]>([]);

  /**
   * End the session.
   *
   * Everything the lock screen hides has to actually be gone, not merely covered.
   * Dropping only the session used to leave three ways back into the pre-lock state:
   * the navigation stack still held `confirm`, so one tap of "back" after unlocking
   * repainted the payment form; the `send` draft still held destination, amount and
   * memo; and a signature prompt awaiting an answer resolved into a flow whose
   * closure captured the draft from before the lock.
   */
  const lock = useCallback(() => {
    // Zero the derived bytes on the way out. This is the cleanup the previous design could
    // not do at all: `session.password` was a JS string, and a string cannot be overwritten
    // — it stayed in the heap until the collector felt like it. The `CryptoKey` handle is
    // not affected (it lives in the browser's key store, and is dropped with the object),
    // so this is hygiene rather than a boundary; `sessionEpochRef` is the boundary.
    const ending = sessionRef.current;
    if (ending) wipeVaultKey(ending.vaultKey);
    setSession(null);
    // Anything already past the signing gate is now working for a session that no
    // longer exists; the epoch is how it finds out before it uses the key.
    sessionEpochRef.current += 1;
    exclusive.clear();
    cancelPending();
    // Drop every account-scoped read: a locked wallet must not leave balances or
    // history on screen, and the next unlock should fetch rather than show stale data.
    invalidate(ACCOUNT_PREFIX);
    invalidate(HISTORY_PREFIX);
    setCosmosPay(null);
    setSend({ to: '', amount: '0', memo: '', memoKind: 'text', asset: XLM });
    setSuccessInfo(null);
    // The one-time enrolment offer dies with the session that earned it. Left standing,
    // it outlived onboarding entirely: `success` is terminal with `back: 'home'`, so the
    // hardware back button skipped both the accept and the dismiss, and every LATER
    // success screen — a payment, a swap, an off-ramp — then routed into the enrolment
    // screen, where accepting seals the session's vault key behind whatever finger is
    // presented. The justification for not gating that accept is "the user set this
    // password seconds ago, in this same flow"; clearing the flag here is what keeps that
    // sentence true.
    setDeviceAuthOffer(false);
    stackRef.current = [];
    setScreen('unlock');
    // Which transport carries this is decided when the queue flushes, not here, and by
    // then the effect above has already dropped the key: a lock is reported the same way
    // whether or not the ended session had an account.
    report(EVENT.lock, { category: 'auth' });
  }, [cancelPending, exclusive]);

  /**
   * Idle auto-lock. An open session holds the decrypted secret and the app password
   * in memory; the browser-action popup tears that down when it closes, but the side
   * panel, the web build and the native app keep it alive until the tab dies. So
   * inactivity — not just an explicit tap on "lock" — has to end the session.
   */
  const lastActiveRef = useRef(Date.now());
  useEffect(() => {
    if (!session) return;
    const touch = () => {
      lastActiveRef.current = Date.now();
    };
    touch();
    const onVisible = () => {
      // Coming back into view counts as activity; going away deliberately does not,
      // so a backgrounded panel still expires on schedule.
      if (document.visibilityState === 'visible') touch();
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(() => {
      if (Date.now() - lastActiveRef.current >= AUTO_LOCK_MS) {
        lock();
        flash(t('unlock.autoLocked'), 'info');
      }
    }, AUTO_LOCK_CHECK_MS);
    return () => {
      clearInterval(id);
      for (const e of events) window.removeEventListener(e, touch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session, lock, flash, t]);

  /** Wipe EVERY wallet (used by "forgot password" — nothing can be decrypted). */
  /** Lock screen: choose which wallet to unlock (no decryption — just sets it active). */
  const selectWalletForUnlock = useCallback(
    async (id: string) => {
      const entry = wallets.find((w) => w.id === id);
      if (!entry || id === meta?.id) return;
      await setActiveId(id);
      setMetaState(entry);
    },
    [wallets, meta],
  );

  /** Lock screen: delete one wallet without unlocking (e.g. one you can't access),
   *  keeping the others. Doesn't need the password since deleting only removes data. */
  const removeWalletLocked = useCallback(async (id: string) => {
    const { remaining, newActive } = await vaultRemoveWallet(id);
    setWallets(remaining);
    if (!newActive) {
      setMetaState(null);
      setScreen('welcome');
      return;
    }
    const entry = remaining.find((w) => w.id === newActive) ?? remaining[0];
    setMetaState(entry);
  }, []);

  /* ------------------------- multi-wallet ------------------------- */
  const startAddWallet = useCallback(() => {
    setAddingWallet(true);
    setDraftAccount(null);
    setDraftMnemonic('');
    setImportText('');
    setDraftName('');
    setDraftBirthdate('');
    setDraftEmail('');
    setScreen('welcome');
  }, []);

  const cancelAddWallet = useCallback(() => {
    setAddingWallet(false);
    setScreen('profile');
    setTab('profile');
  }, []);

  /**
   * Make `entry` the active wallet under the live session's key — proven to open it first,
   * so a switch never lands on a wallet this session cannot sign for.
   */
  const activateWallet = useCallback(
    async (entry: WalletEntry, vaultKey: VaultKey) => {
      await adoptWallet(entry, vaultKey);
      await setActiveId(entry.id);
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, walletId: entry.id, vaultKey });
      setCosmosPay(await getCosmosPay(entry.id, vaultKey));
      // What the retired email-link flow left behind: a claim token for a platform route
      // that no longer exists, plus the email and address in plaintext.
      void clearPendingCosmosPay(entry.id);
    },
    [adoptWallet],
  );

  const activeWalletId = meta?.id ?? null;

  const switchWallet = useCallback(
    async (id: string) => {
      if (!session || id === meta?.id) return;
      setBusy(true);
      try {
        const entry = wallets.find((w) => w.id === id);
        if (!entry) return;
        // `activateWallet` proves the session's key opens the target BEFORE anything
        // switches. It costs a GCM decrypt rather than a full PBKDF2 derivation, which is
        // the difference between switching wallets in microseconds and in about a second.
        await activateWallet(entry, session.vaultKey);
        // No clearing needed: the cache key includes the account, so the new wallet
        // simply reads a different (empty) key while the old one stays warm.
        setTab('home');
        setScreen('home');
        flash(t('toast.walletActive', { name: entry.name }), 'info');
      } catch (e) {
        flash(errLine(e), 'err');
      } finally {
        setBusy(false);
      }
    },
    [session, meta, wallets, t, flash, errLine, activateWallet],
  );

  /** Remove the active wallet; switch to another, or fall back to onboarding. */
  const removeActiveWallet = useCallback(async () => {
    if (!meta || !session) return;
    setBusy(true);
    try {
      const { remaining, newActive } = await vaultRemoveWallet(meta.id);
      setWallets(remaining);
      if (!newActive) {
        setSession(null);
        invalidate(ACCOUNT_PREFIX);
        invalidate(HISTORY_PREFIX);
        setCosmosPay(null);
          setMetaState(null);
        setScreen('welcome');
        return;
      }
      const entry = remaining.find((w) => w.id === newActive)!;
      // Same rule as `switchWallet`: prove the key opens it before the session adopts it.
      await adoptWallet(entry, session.vaultKey);
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, walletId: newActive, vaultKey: session.vaultKey });
      setCosmosPay(await getCosmosPay(newActive, session.vaultKey));
      // What the retired email-link flow left behind: a claim token for a platform route
      // that no longer exists, plus the email and address in plaintext.
      void clearPendingCosmosPay(newActive);
      setTab('home');
      setScreen('home');
      flash(t('toast.walletRemoved'), 'ok');
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [meta, session, t, flash, adoptWallet]);

  /* -------------------------- network switch ---------------------- */
  const switchNetwork = useCallback(async (id: string) => {
    // No toast on a real switch — the network label already updates in the dropdown.
    setNetworkIdState(id);
    await vaultSetNetworkId(id);
    // Nothing to clear: the cache key carries the network id, so the new network reads its
    // own key. This is what kills the stale-write race — a request still in flight for the
    // previous network resolves into the key nobody is reading.
  }, []);

  const addNetwork = useCallback(
    async (cfg: Omit<NetConfig, 'id' | 'custom'>) => {
      // Re-check here, not only in the form: this Horizon will receive every signed
      // envelope the wallet submits on that network.
      if (!isSafeHorizonUrl(cfg.horizon)) {
        throw new Error('La URL de Horizon debe usar https:// (o ser local).');
      }
      if (!cfg.passphrase.trim()) throw new Error('Falta la passphrase de la red.');
      // A colliding id would silently resolve to the wrong Horizon *and* the wrong
      // passphrase — i.e. sign for one network and submit to another.
      const taken = new Set(allNetworks(customNetworks).map((n) => n.id));
      let id = 'custom-' + Math.random().toString(36).slice(2, 9);
      while (taken.has(id)) id = 'custom-' + Math.random().toString(36).slice(2, 9);
      const entry: NetConfig = { ...cfg, id, custom: true };
      const next = [...customNetworks, entry];
      setCustomNetworksState(next);
      await vaultSetCustomNetworks(next);
      await switchNetwork(id);
      return entry;
    },
    [customNetworks, switchNetwork],
  );

  const removeNetwork = useCallback(
    async (id: string) => {
      const next = customNetworks.filter((n) => n.id !== id);
      setCustomNetworksState(next);
      await vaultSetCustomNetworks(next);
      if (networkId === id) await switchNetwork('testnet');
    },
    [customNetworks, networkId, switchNetwork],
  );

  /** Add a trustline so the account can hold a new asset. */
  const addAssetTrustline = useCallback(
    async (code: string, issuer: string) => {
      if (!session) return false;
      // Captured before the gate for the same reason the money flows do it: the gate can
      // now be answered by an OS biometric sheet, which generates no input events and can
      // stay open past the 5-minute idle auto-lock. Without this, the session's key was used
      // out of a closure belonging to a session that had already ended.
      const epoch = sessionEpochRef.current;
      const okSig = await requestSignature({
        title: t('confirmSig.trustTitle'),
        message: t('confirmSig.trustMsg', { code: code.trim() }),
      });
      if (!okSig) return false;
      setBusy(true);
      try {
        guardSession(epoch);
        await stellarAddTrustline({ cfg: network, secret: await secretOf(session), account: session.publicKey, code: code.trim(), issuer: issuer.trim() });
        await refresh(true);
        report(EVENT.trustlineAdded, { category: 'transaction', props: { asset: code.trim() } });
        flash(t('toast.assetAdded', { code: code.trim() }), 'ok');
        return true;
      } catch (e) {
        reportError(EVENT.trustlineFailed, e, { asset: code.trim() });
        flash((e as Error).message, 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [session, network, refresh, requestSignature, guardSession, t, flash],
  );

  /* ----------------------------- money ---------------------------- */
  const fund = useCallback(async () => {
    if (!session) return;
    if (!network.friendbot) {
      flash(t('toast.friendbotMainnet'), 'info');
      setScreen('receive');
      return;
    }
    setBusy(true);
    try {
      await fundWithFriendbot(network, session.publicKey);
      flash(t('toast.funded'), 'ok');
      await refresh(true);
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [session, network, refresh, t, flash]);

  /**
   * Testnet only: add free XLM to an account that already exists — for the recovery
   * reserve, chiefly. `fund` cannot: Friendbot only creates accounts.
   */
  const topUpTestnet = useCallback(async () => {
    if (!session || !network.friendbot) return;
    setBusy(true);
    try {
      await topUpFromFriendbot(network, session.publicKey);
      flash(t('toast.funded'), 'ok');
      await refresh(true);
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [session, network, refresh, t, flash]);

  const submitSend = useCallback(async () => {
    if (!session) return;
    await exclusive.run('send', async () => {
      const epoch = sessionEpochRef.current;
      const code = send.asset.code;
      const okSig = await requestSignature({
        title: t('confirmSig.sendTitle'),
        message: t('confirmSig.sendMsg', { amount: send.amount, code }),
      });
      if (!okSig) return;
      setBusy(true);
      try {
        guardSession(epoch);
        // The draft carries the full (code, issuer) identity, so there is nothing left
        // to "resolve" here. It used to look the issuer up by code, which handed the
        // choice to whichever matching trustline Horizon happened to return first.
        const asset = toPaymentAsset(send.asset);
        const { hash } = await sendPayment({
          cfg: network,
          secret: await secretOf(session),
          account: session.publicKey,
          destination: send.to.trim(),
          amount: send.amount,
          memo: send.memo,
          memoKind: send.memoKind,
          asset,
        });
        // The asset and the amount, never the destination and never the memo: a memo
        // is a message to somebody else (and, for an exchange deposit, their routing
        // reference), and the destination is a third party who did not choose to be
        // in anyone's telemetry.
        report(EVENT.paymentSent, {
          category: 'transaction',
          props: { asset: code, amount: send.amount, memoKind: send.memoKind, hasMemo: !!send.memo, txHash: hash },
        });
        setSuccessInfo({
          kind: 'ok',
          title: t('success.sent'),
          msg: t('success.sentMsg'),
          rows: [
            { label: t('confirm.amount'), val: `${send.amount} ${code}` },
            { label: t('confirm.to'), val: `${send.to.slice(0, 6)}…${send.to.slice(-6)}` },
          ],
          hash,
        });
        setScreen('success');
        setSend({ to: '', amount: '0', memo: '', memoKind: 'text', asset: XLM });
        refresh(true);
      } catch (e) {
        reportError(EVENT.paymentFailed, e, { asset: code, amount: send.amount });
        // show a red error confirmation screen instead of a transient toast
        setSuccessInfo({
          kind: 'err',
          title: t('success.failed'),
          msg: (e as Error).message,
          rows: [],
        });
        setScreen('success');
      } finally {
        setBusy(false);
      }
    });
  }, [session, network, send, refresh, requestSignature, exclusive, guardSession, t]);

  /* --------------------------- CosmosPay -------------------------- */
  /**
   * Connect this wallet to a Cosmos Pay account — create it, or join the one its email
   * already has. Step 1: the community server emails a sign-in code to the wallet's email.
   *
   * The same sign-in the onboarding uses (`/v1/wallet/auth/*`, through the gateway), ending
   * in a `finish` WITHOUT a backup: this wallet already exists on the device, so nothing is
   * backed up — it only proves its key and gets the account's API keys back. No developer
   * platform in the path; it used to own a separate email-link flow for exactly this.
   */
  const enableReceiving = useCallback(async () => {
    if (!session || !meta) return;
    if (!meta.email) {
      flash(t('cosmospay.needEmail'), 'info');
      return;
    }
    setBusy(true);
    try {
      const res = await signInEmailStart(meta.email, await warmPublicKey(networkEnv(network)));
      setCosmosLink({
        stage: 'sent',
        claimToken: res.claimToken,
        expiresAt: Date.now() + (res.expiresInSeconds || 0) * 1000,
      });
      flash(t('cosmospay.linkSent'), 'ok');
    } catch (e) {
      flash((e as Error).message || t('cosmospay.error'), 'err');
    } finally {
      setBusy(false);
    }
  }, [session, meta, network, t, flash]);

  /**
   * Step 2: the emailed code. A right code yields a sign-in session; the password then
   * unlocks the key that signs `finish`, and the account's keys are stored sealed. Wrong
   * codes flash the attempts left; an expired or locked one drops back to the start.
   */
  /**
   * `checkPassword`, reached from above its declaration. It is defined with the signing
   * gate, far below; naming it in a dependency list up here would read it before it exists.
   */
  const checkPasswordRef = useRef<((pwd: string) => Promise<PasswordCheck>) | null>(null);

  const submitLinkCode = useCallback(
    async (code: string, password = '') => {
      if (!session || !meta || !metaEntry || !cosmosLink) return;
      // The canonical account, not this network's view of it: the backup and the sign-in are
      // filed under it whatever network the device is on.
      const canonical = metaEntry;
      const epoch = sessionEpochRef.current;
      setBusy(true);
      try {
        const accessKey = await warmPublicKey(networkEnv(network));
        const res = await signInEmailVerify({ claimToken: cosmosLink.claimToken, code }, accessKey);
        if (res.status === 'invalid') {
          flash(t('cosmospay.linkInvalid', { n: res.attemptsLeft }), 'err');
          return;
        }
        if (res.status !== 'ready') {
          setCosmosLink(null);
          flash(t(res.status === 'locked' ? 'cosmospay.linkLocked' : 'cosmospay.linkExpired'), 'err');
          return;
        }
        // With the app password, this wallet is backed up too — sealed under it, so a
        // sign-in on the next device brings it back with the others. Without one (a passkey
        // device runs on a password nobody typed) it connects for keys only, and signing is
        // gated like every signature.
        let box: string | undefined;
        let linkFiled = false;
        if (password) {
          const check = await checkPasswordRef.current!(password);
          if (!check.ok) {
            flash(check.message, 'err');
            return;
          }
          guardSession(epoch);
          const vaulted = await openVault(meta.id, session.vaultKey);
          const recovery = await fileRecovery(vaulted.secret, canonical.publicKey, res.identity.email);
          box = await sealBackup(
            { secret: vaulted.secret, mnemonic: vaulted.mnemonic },
            recovery ? { password, recovery } : password,
            canonical.publicKey,
            canonical.rekey?.passphrase,
          );
          linkFiled = !!recovery;
          recovery?.fill(0);
        } else {
          const ok = await requestSignature({
            title: t('cosmospay.enableTitle'),
            message: t('cosmospay.enableConfirm'),
          });
          if (!ok) return;
        }
        guardSession(epoch);
        const done = await finishSignIn({
          sessionToken: res.sessionToken,
          email: res.identity.email,
          secret: await secretOf(session),
          // The wallet's account, not the key's own address: a recovered wallet signs with
          // the key that replaced its master.
          account: canonical.publicKey,
          network: canonical.rekey ? ledgerName(canonical.rekey.passphrase) : null,
          ...(box ? { backup: box } : {}),
          accessKey,
        });
        guardSession(epoch);
        if (done.status !== 'ready') {
          flash(t('cosmospay.error'), 'err');
          return;
        }
        const account: CosmosPayAccount = { keys: done.keys, organizationId: done.organizationId };
        let list = await saveCosmosPay(meta.id, account, session.vaultKey);
        if (box) {
          list = await updateWalletMeta(meta.id, {
            cloudBackup: true,
            ...(linkFiled ? { backupRecoveryEmail: res.identity.email.trim().toLowerCase() } : {}),
          });
        }
        setWallets(list);
        const entry = list.find((w) => w.id === meta.id);
        if (entry) setMetaState(entry);
        setCosmosPay(account);
        setCosmosLink(null);
        flash(t(box ? 'cosmospay.linkedBackedUp' : 'cosmospay.linked'), 'ok');
      } catch (e) {
        flash((e as Error).message || t('cosmospay.error'), 'err');
      } finally {
        setBusy(false);
      }
    },
    [session, meta, metaEntry, cosmosLink, network, requestSignature, guardSession, fileRecovery, t, flash],
  );

  /**
   * The Solana and Monad addresses of the active wallet's recovery phrase, derived once and
   * kept on its entry. Opens the vault with the session's key — no prompt, nothing leaves the
   * device — and does nothing for a wallet imported from a bare secret key, which has none.
   */
  const ensureChainAddresses = useCallback(async (): Promise<void> => {
    if (!session || !meta || meta.chainAddresses) return;
    const epoch = sessionEpochRef.current;
    try {
      const vaulted = await openVault(meta.id, session.vaultKey);
      if (!vaulted.mnemonic) return;
      const { chainAddressesFromMnemonic } = await chainLib();
      const chainAddresses = await chainAddressesFromMnemonic(vaulted.mnemonic);
      guardSession(epoch);
      const list = await updateWalletMeta(meta.id, { chainAddresses });
      setWallets(list);
      const entry = list.find((w) => w.id === meta.id);
      if (entry) setMetaState(entry);
    } catch {
      /* Shown again next time; a derivation failure costs a line on a screen, not a wallet. */
    }
  }, [session, meta, guardSession]);

  /**
   * A wallet recovered before re-keys were recorded carries an account its key may sign for
   * on only one ledger, and no record of which — so it builds payments on the other one that
   * fail at submit. Once per unlock, while that is the case: find the one built-in ledger
   * that lists the key as a signer and record it. Nothing is signed; a node that answers
   * wrongly can only make the wallet show the wrong address, never spend from one.
   */
  const rekeyHealRef = useRef<string | null>(null);
  useEffect(() => {
    const entry = metaEntry;
    const live = rawSession;
    if (!entry || !live || entry.rekey || live.walletId !== entry.id || rekeyHealRef.current === entry.id) return;
    rekeyHealRef.current = entry.id;
    const epoch = sessionEpochRef.current;
    void (async () => {
      try {
        const keyAddress = keyAddressOf((await openVault(entry.id, live.vaultKey)).secret);
        if (keyAddress === entry.publicKey) return;
        const ledgers = await Promise.all(
          allNetworks([]).map(async (n) => ({
            passphrase: n.passphrase,
            signers: await activeSignersOf(n, entry.publicKey).catch(() => null),
          })),
        );
        const passphrase = ledgerOfRekey(keyAddress, ledgers);
        if (!passphrase) return;
        guardSession(epoch);
        const list = await updateWalletMeta(entry.id, { rekey: { passphrase, keyAddress } });
        setWallets(list);
        const next = list.find((w) => w.id === entry.id);
        if (next) setMetaState((cur) => (cur?.id === entry.id ? next : cur));
      } catch {
        // Tried again on the next unlock.
        rekeyHealRef.current = null;
      }
    })();
  }, [metaEntry, rawSession, guardSession]);

  /** Dismiss the code prompt (user changes their mind). */
  const cancelLink = useCallback(() => setCosmosLink(null), []);

  /**
   * A key for the endpoints that need no account: quotes, envelope builders and
   * on-chain reads.
   *
   * This account's own key when it has one — the plan's commission is lower — and
   * the shared public key otherwise. That fallback is the whole point: swapping
   * used to end at "create an account first", a registration wall in front of the
   * thing the user opened the wallet to do. Now it costs 150 bps instead of
   * nothing, and registering is what lowers it.
   *
   * Returns null only when neither exists, which means the platform was
   * unreachable on a build that shipped no compiled-in key.
   */
  const openAccessKey = useCallback((): string | null => {
    const env = networkEnv(network);
    const own = cosmosPay?.keys[env] ?? null;
    if (own) return own;
    const shared = cachedPublicKey(env);
    if (!shared) flash(t('cosmospay.enableFirst'), 'info');
    return shared;
  }, [cosmosPay, network, t, flash]);

  /**
   * True when the wallet is operating on the shared key rather than its own.
   *
   * Screens read it to show the public commission and the offer to lower it. It is
   * derived from the account, not from the key's text: a wallet that HAS an
   * account is never on the public rate, even in the moment before its key loads.
   */
  const publicAccess = !cosmosPay?.keys[networkEnv(network)];

  /**
   * Whether the quote/build endpoints are reachable — with an account or without.
   *
   * What the swap and liquidity screens gate on now. They used to gate on having a
   * CosmosPay account, which put a registration wall in front of the feature; the
   * account changes the commission, not whether the button works.
   */
  const gatewayAccess = !publicAccess || publicKeyReady;

  /** Fetch a swap quote for `from` -> `to`. Returns null on error / not enabled. */
  const quoteSwap = useCallback(
    async (amount: string, from: SwapAsset, to: SwapAsset): Promise<SwapQuote | null> => {
      // This account's key when it has one, the shared public key otherwise — a
      // quote needs no account, only a commission rate, and the gateway injects
      // that per consumer.
      const apiKey = openAccessKey();
      if (!apiKey) return null;
      try {
        return await cpQuoteSwap(apiKey, {
          amount,
          sourceAssetCode: from.code,
          sourceAssetIssuer: from.issuer ?? undefined,
          destAssetCode: to.code,
          destAssetIssuer: to.issuer ?? undefined,
          slippageBps: DEFAULT_SLIPPAGE_BPS,
        });
      } catch (e) {
        flash((e as Error).message || t('swap.quoteError'), 'err');
        return null;
      }
    },
    [cosmosPay, network, t, flash],
  );

  /**
   * Full swap flow: create (server builds the XDR) -> sign locally -> submit
   * (server sends it to Horizon). Lands on the success screen either way.
   */
  const submitSwap = useCallback(
    async (amount: string, from: SwapAsset, to: SwapAsset, quote: SwapQuote) => {
      if (!session) return;
      const apiKey = openAccessKey();
      if (!apiKey) return;
      await exclusive.run('swap', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.swapTitle'),
          message: t('confirmSig.swapMsg', { amount, code: to.code }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const swap = await cpCreateSwap(apiKey, {
            amount,
            sourceAssetCode: from.code,
            sourceAssetIssuer: from.issuer ?? undefined,
            destAssetCode: to.code,
            destAssetIssuer: to.issuer ?? undefined,
            source: session.publicKey,
            slippageBps: DEFAULT_SLIPPAGE_BPS,
          });
          // The gateway builds this envelope; we sign it. Verify it actually does what
          // was just confirmed — source, destination, operation set, fee, what leaves
          // and what must come back — before handing over a signature. Throws (caught
          // below) on anything unexpected.
          //
          // BOTH bounds come from the user's side of the screen: `amount` is what they
          // typed and `quote.destination.minimum` is the "minimum received" line the
          // quote card rendered. Neither may come from `swap` — that is the same
          // response that carried the XDR, and bounding a gateway's envelope with the
          // gateway's own numbers checks nothing at all. An earlier version used
          // `swap.sendAmount` and `swap.destEstimated`, so a gateway answering
          // `sendAmount: "1000"` to a 10-unit request simply raised its own ceiling.
          // The gateway DOES charge its fee as a separate `payment` to
          // `quote.fee.wallet` — verified against a real envelope: op[0] pays the
          // commission, op[1] is the path payment back to us. So `payment` is in
          // ALLOWED_OPS.swap and that address is named here, which is what the note
          // that used to sit on `destinations: 'self'` asked for before widening it.
          //
          // Both halves come from the QUOTE CARD the user just read — `fee.amount`,
          // `fee.asset`, `fee.wallet` — never from `swap`, which is the same response
          // that carried the XDR. `commission` is what bounds the slice that may leave
          // for the gateway; `maxSend` still bounds the total, and the two together are
          // what make allowing a third-party payment here safe at all.
          const commission = quote.fee?.wallet
            ? {
                amount: quote.fee.amount,
                // Normalized, because the gateway says `"native"` where the decoder
                // says `"XLM"` — an unmapped bound matches nothing and would refuse
                // every XLM commission as the wrong asset.
                asset: assetRefFromGateway(quote.fee.asset, quote.fee.issuer),
                wallet: quote.fee.wallet,
              }
            : null;
          assertSafeToSign(network, swap.xdr, {
            signer: session.publicKey,
            intent: 'swap',
            // Self plus the quoted commission wallet, and nothing else. The guard
            // independently refuses any non-self destination that is not
            // `commission.wallet`, so this list cannot widen anything on its own.
            destinations: commission ? [session.publicKey, commission.wallet] : 'self',
            commission,
            maxSend: { amount, asset: { code: from.code, issuer: from.issuer } },
            minReceive: { amount: quote.destination.minimum, asset: { code: to.code, issuer: to.issuer } },
          });
          guardSession(epoch);
          const signedXdr = await signEnvelope(swap.xdr);
          const res = await cpSubmitSwap(apiKey, swap.id, signedXdr);
          if (res.submitted) {
            report(EVENT.swapSubmitted, {
              category: 'transaction',
              props: {
                from: from.code,
                to: to.code,
                amount: swap.sendAmount,
                received: swap.destEstimated,
                txHash: res.txHash ?? undefined,
              },
            });
            setSuccessInfo({
              kind: 'ok',
              title: t('swap.success'),
              msg: t('swap.successMsg'),
              rows: [
                { label: t('swap.pay'), val: `${swap.sendAmount} ${swap.sendAsset}` },
                { label: t('swap.receiveEst'), val: `${swap.destEstimated} ${swap.destAsset}` },
              ],
              hash: res.txHash ?? undefined,
            });
            setScreen('success');
            refresh(true);
          } else {
            const codes = res.resultCodes ? JSON.stringify(res.resultCodes) : '';
            // A refused submit is not a thrown error: the gateway answered, and its
            // `reason` (or Horizon's result codes) is the only thing that says why.
            // Reported at the same level as a throw because to the user they are the
            // same event — the swap did not happen.
            report(EVENT.swapFailed, {
              level: 'error',
              category: 'error',
              message: res.reason || codes || 'swap not submitted',
              props: { from: from.code, to: to.code, amount, status: res.status },
            });
            setSuccessInfo({
              kind: 'err',
              title: t('swap.failed'),
              msg: res.reason || codes || t('swap.failed'),
              rows: [],
            });
            setScreen('success');
          }
        } catch (e) {
          reportError(EVENT.swapFailed, e, { from: from.code, to: to.code, amount });
          setSuccessInfo({ kind: 'err', title: t('swap.failed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, cosmosPay, network, requestSignature, refresh, exclusive, guardSession, signEnvelope, t, flash],
  );

  /* ------------------------- cross-chain swaps --------------------- */
  // One direction, by design: this wallet signs on Stellar only, so it sells from its
  // Stellar account and receives on its OWN Solana or Monad address — the one its
  // recovery phrase derives (`meta.chainAddresses`). NEAR Intents settles; mainnet only.

  /** What NEAR Intents can swap. Empty on error: the screen just offers nothing. */
  const crossChainAssets = useCallback(async (): Promise<CrossChainAsset[]> => {
    const apiKey = openAccessKey();
    if (!apiKey) return [];
    try {
      return await cpListCrossChainAssets(apiKey);
    } catch {
      return [];
    }
  }, [openAccessKey]);

  /** The request both the quote and the create send. The recipient is always our own. */
  const crossChainInput = useCallback(
    (amount: string, from: SwapAsset, target: CrossChainTarget, dest: CrossChainAsset): CrossChainSwapInput | null => {
      const recipient = meta?.chainAddresses?.[target];
      if (!session || !recipient) return null;
      return {
        originChain: 'stellar',
        originAsset: from.issuer ? `${from.code}:${from.issuer}` : 'XLM',
        destinationChain: target,
        destinationAsset: dest.contract ?? dest.symbol,
        amount,
        recipient,
        refundTo: session.publicKey,
        slippageBps: CROSS_CHAIN_SLIPPAGE_BPS,
      };
    },
    [session, meta],
  );

  const quoteCrossChain = useCallback(
    async (amount: string, from: SwapAsset, target: CrossChainTarget, dest: CrossChainAsset): Promise<CrossChainQuote | null> => {
      const apiKey = openAccessKey();
      const input = crossChainInput(amount, from, target, dest);
      if (!apiKey || !input) return null;
      try {
        return await cpQuoteCrossChainSwap(apiKey, input);
      } catch (e) {
        flash((e as Error).message || t('swap.quoteError'), 'err');
        return null;
      }
    },
    [openAccessKey, crossChainInput, t, flash],
  );

  /**
   * Open the swap, then fund it: a Stellar payment of exactly what was typed to the
   * deposit address NEAR Intents issued, with its memo as a MEMO_TEXT. The wallet builds
   * and signs that payment itself — nothing from the gateway is signed here.
   *
   * What is checked before paying is what the gateway could otherwise redirect: the
   * output must go to OUR address on the target chain, a refund must come back to OUR
   * Stellar account, and the amount must be the one on the screen. The deposit address
   * itself cannot be checked from here — it is NEAR Intents' — which is why the other
   * three must be.
   */
  const submitCrossChain = useCallback(
    async (amount: string, from: SwapAsset, target: CrossChainTarget, dest: CrossChainAsset, quote: CrossChainQuote) => {
      if (!session) return;
      const apiKey = openAccessKey();
      const input = crossChainInput(amount, from, target, dest);
      if (!apiKey || !input) return;
      await exclusive.run('swap', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.swapTitle'),
          message: t('xswap.confirmMsg', { amount, code: from.code, dest: quote.destination.asset, chain: t(`xswap.chain.${target}`) }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const swap = await cpCreateCrossChainSwap(apiKey, input);
          if (
            swap.recipient !== input.recipient ||
            swap.refundTo !== session.publicKey ||
            swap.originChain !== 'stellar' ||
            swap.destinationChain !== target ||
            !sameDecimal(swap.amountIn, amount) ||
            !swap.depositMemo
          ) {
            throw new Error(t('xswap.mismatch'));
          }
          guardSession(epoch);
          const { hash } = await sendPayment({
            cfg: network,
            secret: await secretOf(session),
            account: session.publicKey,
            destination: swap.depositAddress,
            amount,
            memo: swap.depositMemo,
            memoKind: 'text',
            asset: toPaymentAsset({ code: from.code, issuer: from.issuer }),
          });
          // Best effort: NEAR Intents watches the address anyway; this only starts it sooner.
          cpReportCrossChainDeposit(apiKey, swap.id, hash).catch(() => {});
          report(EVENT.swapSubmitted, {
            category: 'transaction',
            props: { from: from.code, to: quote.destination.asset, chain: target, amount, received: swap.amountOutEstimated, txHash: hash, crossChain: true },
          });
          setSuccessInfo({
            kind: 'ok',
            title: t('xswap.success'),
            msg: t('xswap.successMsg', { chain: t(`xswap.chain.${target}`), seconds: String(swap.timeEstimateSeconds) }),
            rows: [
              { label: t('swap.pay'), val: `${amount} ${from.code}` },
              { label: t('swap.receiveEst'), val: `${swap.amountOutEstimated} ${quote.destination.asset}` },
              { label: t('xswap.to'), val: `${input.recipient.slice(0, 6)}…${input.recipient.slice(-6)}` },
            ],
            hash,
          });
          setScreen('success');
          refresh(true);
        } catch (e) {
          reportError(EVENT.swapFailed, e, { from: from.code, to: dest.symbol, amount, crossChain: true });
          setSuccessInfo({ kind: 'err', title: t('swap.failed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, network, openAccessKey, crossChainInput, requestSignature, refresh, exclusive, guardSession, t],
  );

  /* ------------------ paying from Solana / Monad ------------------- */
  // The same phrase derives an address on each; the wallet signs there with keys derived
  // at the moment of signing (`lib/chainKeys.ts`) and checks everything the gateway built
  // before it does (`lib/chainSwap.ts`). Jupiter / Kuru Flow for a swap on one chain,
  // NEAR Intents for one that leaves it. Mainnet only.

  /** Our address on `chain`, or null for a wallet imported from a bare Stellar secret. */
  const chainAddress = useCallback(
    (chain: CrossChainNetwork): string | null =>
      chain === 'stellar' ? session?.publicKey ?? null : meta?.chainAddresses?.[chain] ?? null,
    [session, meta],
  );

  /** Base-unit balances of the tokens offered on `chain`; null when the node cannot be read. */
  const chainBalances = useCallback(
    async (chain: OtherChain): Promise<Record<string, bigint> | null> => {
      const owner = meta?.chainAddresses?.[chain];
      if (!owner) return null;
      try {
        return await (await chainSwapLib()).chainBalances(chain, owner);
      } catch {
        return null;
      }
    },
    [meta],
  );

  /**
   * Base-unit balances of the test tokens (`CHAIN_TESTNET_TOKENS`) at this phrase's
   * address on `chain`'s TEST network — Solana devnet, Monad testnet. Null off a test
   * network, for a wallet with no phrase, or when the node cannot be read.
   */
  const testnetChainBalances = useCallback(
    async (chain: OtherChain): Promise<Record<string, bigint> | null> => {
      const owner = meta?.chainAddresses?.[chain];
      if (!owner || networkEnv(network) !== 'dev') return null;
      try {
        return await (await chainSwapLib()).chainBalances(chain, owner, 'testnet');
      } catch {
        return null;
      }
    },
    [meta, network],
  );

  /** Which chain the test-network send screen opens on; set by the Home card. */
  const [chainSendTarget, setChainSendTarget] = useState<OtherChain>('solana');

  /**
   * Airdrop 1 devnet SOL to this phrase's Solana address and wait for it to confirm, so
   * the balance read straight after already includes it. Devnet rate-limits the airdrop
   * per IP; a refusal says so and points at the web faucet. Nothing is signed.
   */
  const airdropTestnetSol = useCallback(async (): Promise<boolean> => {
    const owner = meta?.chainAddresses?.solana;
    if (!owner || networkEnv(network) !== 'dev') return false;
    try {
      const rpcLib = await chainRpcLib();
      const sig = await rpcLib.solanaDevnetAirdrop(owner, SOLANA_AIRDROP_LAMPORTS);
      const deadline = Date.now() + CHAIN_CONFIRM_TIMEOUT_MS;
      for (;;) {
        const done = await rpcLib.solanaDevnetConfirmed(sig);
        if (done === false) throw new Error('airdrop failed on chain');
        if (done) break;
        if (Date.now() > deadline) {
          // Sent but not seen yet: it usually lands; the next balance read will show it.
          flash(t('testnetChains.airdropPending'), 'info');
          return true;
        }
        await new Promise((r) => setTimeout(r, CHAIN_CONFIRM_POLL_MS));
      }
      flash(t('testnetChains.airdropOk'), 'ok');
      return true;
    } catch {
      flash(t('testnetChains.airdropFailed'), 'err');
      return false;
    }
  }, [meta, network, t, flash]);

  /** The signing key of `chain`, checked against the address on screen. */
  const chainSigner = useCallback(
    async (chain: OtherChain): Promise<{ owner: string; secret: Uint8Array }> => {
      const owner = meta?.chainAddresses?.[chain];
      const missing = () => new Error(t('xswap.noAddress', { chain: t(`xswap.chain.${chain}`) }));
      if (!session || !owner) throw missing();
      const { mnemonic } = await openVault(session.walletId, session.vaultKey);
      if (!mnemonic) throw missing();
      return { owner, secret: await (await chainKeysLib()).chainSecret(mnemonic, chain, owner) };
    },
    [session, meta, t],
  );

  /** A refusal from `lib/chainSwap.ts` as a sentence; anything else as it came. */
  const chainSwapMessage = useCallback(
    (e: unknown): string => {
      const err = e as { name?: string; code?: string; message?: string };
      return err?.name === 'ChainSwapRefused' ? t(`xswap.refused.${err.code}`) : err?.message || t('swap.failed');
    },
    [t],
  );

  /**
   * Send `amount` of `token` on `chain`'s TEST network to `to`, signed with this phrase's
   * key there. Test networks only: mainnet Solana / Monad money moves through the swap
   * screen, behind the checks `lib/chainSwap.ts` runs on what the gateway built.
   */
  const submitTestnetSend = useCallback(
    async (chain: OtherChain, token: ChainToken, to: string, amount: string) => {
      const units = toMinorUnitsBig(amount, token.decimals);
      const destination = to.trim();
      if (!session || !units || units <= 0n || networkEnv(network) !== 'dev') return;
      const net = t(`testnetChains.net.${chain}`);
      const short = `${destination.slice(0, 6)}…${destination.slice(-6)}`;
      await exclusive.run('send', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('chainSend.confirmTitle'),
          message: t('chainSend.confirmMsg', { amount, code: token.symbol, net, to: short }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const lib = await chainSwapLib();
          if (!lib.isChainAddress(chain, destination)) throw new lib.ChainSwapRefused('address');
          const { owner, secret } = await chainSigner(chain);
          guardSession(epoch);
          let hash: string;
          try {
            hash = await lib.sendTransfer({
              chain,
              net: 'testnet',
              secret,
              owner,
              asset: token.asset,
              decimals: token.decimals,
              to: destination,
              amount: units,
            });
          } finally {
            secret.fill(0);
          }
          setSuccessInfo({
            kind: 'ok',
            title: t('chainSend.success'),
            msg: t('chainSend.successMsg', { net }),
            rows: [
              { label: t('chainSend.amount'), val: `${amount} ${token.symbol}` },
              { label: t('chainSend.to'), val: short },
            ],
            hash,
            explorer: CHAIN_TESTNET_EXPLORER_TX[chain](hash),
          });
          setScreen('success');
        } catch (e) {
          setSuccessInfo({ kind: 'err', title: t('chainSend.failed'), msg: chainSwapMessage(e), rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, network, exclusive, requestSignature, chainSigner, guardSession, chainSwapMessage, t],
  );

  const quoteChainSwap = useCallback(
    async (chain: OtherChain, amount: string, from: ChainToken, to: ChainToken): Promise<SwapQuote | null> => {
      const apiKey = openAccessKey();
      if (!apiKey) return null;
      try {
        return await cpQuoteSwap(apiKey, {
          chain,
          amount,
          sourceAssetCode: from.asset,
          destAssetCode: to.asset,
          slippageBps: CHAIN_SWAP_SLIPPAGE_BPS,
        });
      } catch (e) {
        flash((e as Error).message || t('swap.quoteError'), 'err');
        return null;
      }
    },
    [openAccessKey, t, flash],
  );

  /**
   * A swap on Solana (Jupiter) or Monad (Kuru Flow): the gateway builds it, the wallet
   * checks and signs it, the gateway relays it. The bounds are the confirmed card's — the
   * amount typed and the quote's minimum — never the create response's.
   */
  const submitChainSwap = useCallback(
    async (chain: OtherChain, amount: string, from: ChainToken, to: ChainToken, quote: SwapQuote) => {
      const apiKey = openAccessKey();
      const owner = meta?.chainAddresses?.[chain];
      const units = toMinorUnitsBig(amount, from.decimals);
      const minimum = toMinorUnitsBig(quote.destination.minimum, to.decimals);
      if (!session || !apiKey || !owner || !units || minimum === null) return;
      await exclusive.run('swap', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.swapTitle'),
          message: t('xswap.chainConfirmMsg', { amount, code: from.symbol, dest: to.symbol, chain: t(`xswap.chain.${chain}`) }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const same = (a: string, b: string) => (chain === 'monad' ? a.toLowerCase() === b.toLowerCase() : a === b);
          const swap = await cpCreateChainSwap(apiKey, {
            chain,
            source: owner,
            amount,
            sourceAssetCode: from.asset,
            destAssetCode: to.asset,
            slippageBps: CHAIN_SWAP_SLIPPAGE_BPS,
          });
          if (
            swap.chain !== chain ||
            !same(swap.source, owner) ||
            !same(swap.sendAsset, from.asset) ||
            !same(swap.destAsset, to.asset) ||
            !sameDecimal(swap.sendAmount, amount)
          ) {
            throw new Error(t('xswap.mismatch'));
          }
          const lib = await chainSwapLib();
          const { secret } = await chainSigner(chain);
          guardSession(epoch);
          let signed: string;
          try {
            signed =
              chain === 'solana'
                ? await lib.signSolanaSwap({ wire: swap.transaction.data, secret, owner, sell: from.asset, buy: to.asset, amount: units, minimum })
                : await lib.signMonadSwap({
                    transaction: {
                      to: swap.transaction.to ?? '',
                      data: swap.transaction.data,
                      value: swap.transaction.value ?? '0',
                      chainId: swap.transaction.chainId ?? 0,
                    },
                    approval: swap.approval,
                    secret,
                    owner,
                    sell: from.asset,
                    amount: units,
                  });
          } finally {
            secret.fill(0);
          }
          guardSession(epoch);
          const res = await cpSubmitChainSwap(apiKey, swap.id, signed);
          report(EVENT.swapSubmitted, {
            category: 'transaction',
            props: { from: from.symbol, to: to.symbol, chain, amount, received: swap.destEstimated, txHash: res.txHash },
          });
          setSuccessInfo({
            kind: 'ok',
            title: t('xswap.chainSuccess'),
            msg: t('xswap.chainSuccessMsg', { chain: t(`xswap.chain.${chain}`) }),
            rows: [
              { label: t('swap.pay'), val: `${amount} ${from.symbol}` },
              { label: t('swap.receiveEst'), val: `${swap.destEstimated} ${to.symbol}` },
            ],
            hash: res.txHash,
            explorer: CHAIN_EXPLORER_TX[chain](res.txHash),
          });
          setScreen('success');
        } catch (e) {
          reportError(EVENT.swapFailed, e, { from: from.symbol, to: to.symbol, amount, chain });
          setSuccessInfo({ kind: 'err', title: t('swap.failed'), msg: chainSwapMessage(e), rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, meta, openAccessKey, requestSignature, exclusive, guardSession, chainSigner, chainSwapMessage, t],
  );

  /** The request a cross-chain swap from Solana / Monad sends: both ends are our own. */
  const crossChainFromInput = useCallback(
    (origin: OtherChain, amount: string, from: ChainToken, dest: CrossChainAsset): CrossChainSwapInput | null => {
      const refundTo = chainAddress(origin);
      const recipient = chainAddress(dest.chain);
      if (!refundTo || !recipient || dest.chain === origin) return null;
      return {
        originChain: origin,
        originAsset: from.asset === 'native' ? from.symbol : from.asset,
        destinationChain: dest.chain,
        destinationAsset:
          dest.chain === 'stellar' && dest.contract ? `${dest.symbol}:${dest.contract}` : dest.contract ?? dest.symbol,
        amount,
        recipient,
        refundTo,
        slippageBps: CROSS_CHAIN_SLIPPAGE_BPS,
      };
    },
    [chainAddress],
  );

  const quoteCrossChainFrom = useCallback(
    async (origin: OtherChain, amount: string, from: ChainToken, dest: CrossChainAsset): Promise<CrossChainQuote | null> => {
      const apiKey = openAccessKey();
      const input = crossChainFromInput(origin, amount, from, dest);
      if (!apiKey || !input) return null;
      try {
        return await cpQuoteCrossChainSwap(apiKey, input);
      } catch (e) {
        flash((e as Error).message || t('swap.quoteError'), 'err');
        return null;
      }
    },
    [openAccessKey, crossChainFromInput, t, flash],
  );

  /**
   * Open a cross-chain swap from Solana / Monad and fund it with a transfer the wallet
   * builds itself. Checked first, as from Stellar: the output goes to OUR address, a
   * refund comes back to OUR origin address, the amount is the one on screen.
   */
  const submitCrossChainFrom = useCallback(
    async (origin: OtherChain, amount: string, from: ChainToken, dest: CrossChainAsset, quote: CrossChainQuote) => {
      const apiKey = openAccessKey();
      const input = crossChainFromInput(origin, amount, from, dest);
      const units = toMinorUnitsBig(amount, from.decimals);
      if (!session || !apiKey || !input || !units) return;
      await exclusive.run('swap', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.swapTitle'),
          message: t('xswap.confirmMsg', { amount, code: from.symbol, dest: quote.destination.asset, chain: t(`xswap.chain.${dest.chain}`) }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const swap = await cpCreateCrossChainSwap(apiKey, input);
          const same = (a: string, b: string) => (origin === 'monad' ? a.toLowerCase() === b.toLowerCase() : a === b);
          if (
            swap.recipient !== input.recipient ||
            !same(swap.refundTo, input.refundTo) ||
            swap.originChain !== origin ||
            swap.destinationChain !== dest.chain ||
            !sameDecimal(swap.amountIn, amount)
          ) {
            throw new Error(t('xswap.mismatch'));
          }
          const lib = await chainSwapLib();
          const { owner, secret } = await chainSigner(origin);
          guardSession(epoch);
          let hash: string;
          try {
            hash = await lib.sendDeposit({
              chain: origin,
              secret,
              owner,
              asset: from.asset,
              decimals: from.decimals,
              to: swap.depositAddress,
              amount: units,
            });
          } finally {
            secret.fill(0);
          }
          // Best effort: NEAR Intents watches the address anyway; this only starts it sooner.
          cpReportCrossChainDeposit(apiKey, swap.id, hash).catch(() => {});
          report(EVENT.swapSubmitted, {
            category: 'transaction',
            props: {
              from: from.symbol,
              to: quote.destination.asset,
              origin,
              chain: dest.chain,
              amount,
              received: swap.amountOutEstimated,
              txHash: hash,
              crossChain: true,
            },
          });
          setSuccessInfo({
            kind: 'ok',
            title: t('xswap.success'),
            msg: t('xswap.successFromMsg', {
              origin: t(`xswap.chain.${origin}`),
              chain: t(`xswap.chain.${dest.chain}`),
              seconds: String(swap.timeEstimateSeconds),
            }),
            rows: [
              { label: t('swap.pay'), val: `${amount} ${from.symbol}` },
              { label: t('swap.receiveEst'), val: `${swap.amountOutEstimated} ${quote.destination.asset}` },
              { label: t('xswap.to'), val: `${input.recipient.slice(0, 6)}…${input.recipient.slice(-6)}` },
            ],
            hash,
            explorer: CHAIN_EXPLORER_TX[origin](hash),
          });
          setScreen('success');
          if (dest.chain === 'stellar') refresh(true);
        } catch (e) {
          reportError(EVENT.swapFailed, e, { from: from.symbol, to: dest.symbol, amount, origin, crossChain: true });
          setSuccessInfo({ kind: 'err', title: t('swap.failed'), msg: chainSwapMessage(e), rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, openAccessKey, crossChainFromInput, requestSignature, exclusive, guardSession, chainSigner, chainSwapMessage, refresh, t],
  );

  /* ------------------------- liquidity pools ---------------------- */

  /** The CosmosPay key for the wallet's current network, or null (flashes a hint). */
  /**
   * Keep the activity reporter pointed at the account and network in use.
   *
   * The key decides WHERE an event goes, not merely how it is labelled: with one, the
   * wallet reports to the gateway and the events land in that account's own dashboard;
   * without one they go to the platform's anonymous route. So this runs on every change
   * to either — including `lock()`, which clears `cosmosPay` and must therefore stop
   * attributing anything to the account whose session just ended.
   */
  /**
   * Vouch for the reports this wallet sends, in the background, with no prompt.
   *
   * The consent is the diagnostics opt-in itself — the user agreed to send reports about
   * this wallet, and this is what makes such a report checkable rather than merely
   * claimed. So there is deliberately no signing gate here: `requestSignature` exists to
   * confirm something that MOVES VALUE, and asking for a password every twelve hours to
   * label a crash report would train people to approve prompts they did not read.
   *
   * What it signs can never move value, and that is structural rather than promised: it
   * is a domain-separated digest, not a transaction, so no envelope exists for anyone to
   * submit. `lib/attestation.ts` has the whole argument.
   *
   * Five gates, and each one is a way this could otherwise misfire:
   *
   *  - **Diagnostics off** → nothing is minted. An attestation for a wallet that reports
   *    nothing is a signature produced for no reason, and the one thing a privacy setting
   *    must not do is act anyway.
   *  - **No session** → nothing to sign with. This also covers the locked wallet: `lock()`
   *    clears the session, this effect re-runs and passes `ownership: null`, so a locked
   *    wallet stops vouching for anything.
   *  - **Anonymous route** → skipped. Under the shared public key the attestation would be
   *    stripped by `anonymize` anyway (it names an account, so it is in ACCOUNT_PROPS), and
   *    minting one nobody will send is a vault read for nothing.
   *  - **Still fresh** → skipped, so this costs one signature per twelve hours rather than
   *    one per network flick or per re-render.
   *
   * `guardSession` before the key is used, per the session-epoch rule: the vault read is an
   * await, and the idle auto-lock can land inside it.
   */
  useEffect(() => {
    const own = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (!telemetryEnabled() || !session || !own || !meta) {
      configureTelemetry({ ownership: null });
      return;
    }
    if (hasFreshOwnership()) return;

    let alive = true;
    const epoch = sessionEpochRef.current;
    void (async () => {
      try {
        const installId = await telemetryInstallId();
        if (!alive) return;
        guardSession(epoch);
        const secret = await secretOf(session);
        if (!alive) return;
        guardSession(epoch);
        const attestation = await signOwnership({
          secret,
          address: session.publicKey,
          installId,
          networkPassphrase: network.passphrase,
        });
        if (!alive) return;
        configureTelemetry({ ownership: attestation });
      } catch {
        // Never surfaced and never retried on a timer: diagnostics that interrupt the
        // wallet to complain about diagnostics are worse than an unvouched report, and
        // the next network or wallet change re-runs this anyway.
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, meta, cosmosPay, network, guardSession]);

  useEffect(() => {
    const env = networkEnv(network);
    const own = cosmosPay?.keys[env] ?? null;
    if (own) {
      configureTelemetry({ apiKey: own, shared: false, env, network: network.id });
      setPublicKeyReady(true);
      return;
    }
    // No account: report under the shared public key so a wallet nobody registered
    // still delivers its crashes. `shared` is what keeps that honest — the events
    // reach the gateway, but stripped of anything naming an account, because the
    // consumer they authenticate as is every anonymous wallet at once.
    const compiled = cachedPublicKey(env);
    configureTelemetry({ apiKey: compiled, shared: true, env, network: network.id });
    setPublicKeyReady(!!compiled);
    let alive = true;
    void warmPublicKey(env).then((key) => {
      if (!alive || !key) return;
      configureTelemetry({ apiKey: key, shared: true, env, network: network.id });
      setPublicKeyReady(true);
    });
    return () => {
      alive = false;
    };
  }, [cosmosPay, network]);

  /**
   * THIS ACCOUNT's key, or nothing.
   *
   * For the endpoints that read back what a consumer wrote, or that hold one
   * person's identity documents and bank accounts. The shared public key is
   * deliberately not offered here: the gateway refuses it on those routes, and
   * substituting it would turn a clear "connect an account" prompt into a 403
   * from somewhere the user cannot act on.
   */
  const cosmosApiKey = useCallback((): string | null => {
    const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (!apiKey) flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
    return apiKey;
  }, [cosmosPay, network, t, flash]);


  /* ----------------------- gateway operations --------------------- */

  /**
   * What the gateway did with the last things this wallet asked it to do.
   *
   * Read through the keyed cache rather than into component state, for the reason the
   * cache exists: these are scoped to `network x account`, and before it existed a
   * switch of either left the previous scope's rows on screen. `run` deduplicates the
   * four domains too — the operations screen mounts all of them at once, and a remount
   * on navigation would otherwise refetch every one.
   *
   * Failures resolve to an empty page rather than rejecting. This is a history view: a
   * gateway that is down should cost the user the list, not the screen, and the fiat
   * rows are the half most likely to be unavailable independently of the rest.
   */
  const loadOps = useCallback(
    async (domain: OpsDomain): Promise<void> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey || !meta) return;
      await run({
        key: opsKey(networkId, meta.publicKey, domain),
        ttl: TTL.ops,
        fetcher: async () => {
          switch (domain) {
            case 'swaps':
              return (await cpListSwaps(apiKey)).items;
            case 'payins':
              return (await cpListPayins(apiKey)).items;
            case 'payouts':
              return (await cpListPayouts(apiKey)).items;
            case 'liquidity':
              return (await cpListLiquidityOps(apiKey)).items;
          }
        },
      }).catch(() => []);
    },
    [cosmosPay, network, networkId, meta],
  );

  /** The cache key a screen subscribes to. Null until there is an account to scope by. */
  const opsKeyFor = useCallback(
    (domain: OpsDomain): string | null => (meta ? opsKey(networkId, meta.publicKey, domain) : null),
    [meta, networkId],
  );

  /**
   * Which bank rails the platform actually offers, from `GET /v1/kyc/rails`.
   *
   * Cached device-wide and not per account: the answer is a property of the operator's
   * BlindPay configuration, not of whose wallet is open, and re-asking it on every
   * account switch would spend a round trip to learn the same list.
   *
   * Null on any failure — unreachable, unrecognised shape, no key — and null means
   * "use the table we shipped". `availableRails` does that intersection; see the header
   * on `lib/fiatRails.ts` for why this fails open rather than showing an empty picker.
   */
  const [serverRails, setServerRails] = useState<string[] | null>(null);

  const loadRails = useCallback(async (): Promise<void> => {
    const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (!apiKey || serverRails) return;
    try {
      setServerRails(normalizeRails(await cpListRails(apiKey)));
    } catch {
      /* stays null — the local table is the fallback, and it is today's behaviour */
    }
  }, [cosmosPay, network, serverRails]);

  /**
   * Open the trustline the gateway's onramp will pay out into.
   *
   * The wallet can already build a `changeTrust` itself, and for a user adding an asset
   * by hand that is the right path. This one is different in the field that matters:
   * the ISSUER. A deposit is delivered by a specific issuer's asset, the wallet has no
   * way to know which, and a trustline opened to a plausible-looking USDC issuer is a
   * deposit that arrives somewhere the user cannot spend from. Asking the gateway which
   * one is the only way to get it right.
   *
   * Which makes the envelope a counterparty's, so it goes through the guard like every
   * other counterparty envelope. The bound is the interesting part: the wallet cannot
   * pre-declare the asset — not knowing it is why it called — so the bound comes from
   * what the USER was shown. `reviewTx` decodes the envelope, the decoded `(code,
   * issuer)` goes on the confirmation prompt, and the guard is then handed exactly what
   * the user confirmed. Bounding it with the issuer the gateway just sent would be
   * checking the gateway against itself, which is the mistake CLAUDE.md calls out by
   * name in the swap flow.
   */
  const openOnrampTrustline = useCallback(async (): Promise<boolean> => {
    const apiKey = cosmosApiKey();
    if (!apiKey || !session) return false;

    const run = await exclusive.run('trustline', async () => {
      const epoch = sessionEpochRef.current;
      try {
        const { xdr } = await cpOnrampTrustlineTx(apiKey, session.publicKey);
        guardSession(epoch);

        // Decode BEFORE asking, so the prompt names the asset rather than asking the
        // user to approve an opaque envelope.
        const review = reviewTx(network, xdr);
        const line = review.operations.find((o) => o.type === 'changeTrust')?.line ?? null;
        if (!line) {
          flash(t('fiat.trustlineNoAsset'), 'err');
          return false;
        }

        const asset = { code: line.code, issuer: line.issuer ?? null };
        const okToSign = await requestSignature({
          title: t('fiat.trustlineConfirmTitle'),
          message: t('fiat.trustlineConfirmMsg', { asset: asset.code, issuer: asset.issuer ?? '—' }),
        });
        if (!okToSign) return false;
        guardSession(epoch);

        assertSafeToSign(network, xdr, {
          signer: session.publicKey,
          intent: 'trustline',
          // A changeTrust has no destination; stating the policy is still required, and
          // 'self' is the honest one — nothing may leave for anybody.
          destinations: 'self',
          confirmed: [asset],
        });
        guardSession(epoch);

        const signed = await signEnvelope(xdr);
        await stellarSubmitXdr(network, signed);
        invalidate(ACCOUNT_PREFIX);
        flash(t('fiat.trustlineOpened', { asset: asset.code }), 'ok');
        return true;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return false;
      }
    });
    // `ran: false` means another flow held the lock — not a failure, but not a success
    // either, so it reports the same as a refusal rather than a completed trustline.
    return run.ran ? run.value : false;
  }, [cosmosApiKey, session, network, exclusive, guardSession, requestSignature, signEnvelope, t, flash]);

  /* ------------------------ account recovery (SEP-30) ------------------------ */

  /*
   * Opt-in, and it replaces nothing: a wallet that never turns this on is exactly the
   * wallet it was. What it adds is two signers, held by two separate servers, each at half
   * the account's threshold — so the device still signs alone, and if the device is gone
   * the two servers together can put a new key on the account. `lib/recovery.ts` has the
   * arithmetic and `txGuard`'s `recovery` template is what checks the transaction.
   *
   * The identity that will be able to recover is the wallet's own email. Registering it
   * needs the ACCOUNT's key (SEP-10), so only the person holding this device decides who
   * may recover it — an identity that could add itself would be a way in, not a way back.
   */

  /**
   * Send a code to the wallet's own email, for the sponsored path.
   *
   * The operator pays two accounts' worth of reserve, so it asks for a proven email rather
   * than a bare request — the same sign-in every other flow uses, spent here for one
   * narrower thing. It is never asked for on the self-paid path, which needs no identity.
   */
  const startRecoveryCode = useCallback(async (): Promise<boolean> => {
    const email = meta?.email?.trim().toLowerCase();
    if (!email) {
      flash(t('recovery.error.noEmail'), 'err');
      return false;
    }
    return signIn.startEmail(email);
  }, [meta, signIn, flash, t]);

  /** Whether recovery is on for this account, read from the ledger rather than the servers. */
  const recovery = useQueryValue<RecoveryState>(recoveryKey(scope.net, scope.pub)) ?? null;

  const loadRecovery = useCallback(async () => {
    if (!meta) return;
    await run({
      key: recoveryKey(networkId, meta.publicKey),
      fetcher: () => recoveryStateOf(network, meta.publicKey),
      ttl: TTL.recovery,
      retry: 2, // an idempotent read
    });
  }, [meta, network, networkId]);

  /**
   * Turn recovery on.
   *
   * `code` is the one an email sign-in just sent, and passing it chooses the SPONSORED
   * variant: the operator pays the two signer entries' reserve, which is the only way an
   * account with no spare lumens gets recovery at all. Without it the account pays its
   * own, needs no sign-in at all, and is stopped before either server hears of the account
   * when it lacks `RECOVERY_MIN_SPENDABLE_XLM` free. Both end at the same guard with the same template —
   * the sponsorship is a funding arrangement, not a second way of changing an account.
   *
   * The token that the sponsored variant spends never leaves this function, which is why
   * the code is verified HERE rather than by the screen: a screen holding a session token
   * is a screen holding something that provisions.
   */
  const enableRecovery = useCallback(
    async (opts: { code?: string } = {}): Promise<boolean> => {
      if (!session || !meta) return false;

      const outcome = await exclusive.run('recovery', async () => {
        const epoch = sessionEpochRef.current;
        try {
          const address = session.publicKey;
          const email = meta.email?.trim().toLowerCase() ?? '';
          if (!email) {
            flash(t('recovery.error.noEmail'), 'err');
            return false;
          }

          // Both servers, before anything is written to either: a pair that cannot
          // protect the account is a pair to find out about now, not after one of them
          // has been registered.
          const servers = await loadRecoveryServers(network);
          guardSession(epoch);

          const state = await recoveryStateOf(network, address);
          guardSession(epoch);
          if (!state.exists) {
            flash(t('recovery.error.notFunded'), 'err');
            return false;
          }
          // On the self-paid path the account finds out it cannot pay BEFORE either server
          // is told about it. A fresh read, not the cached balance the screen showed. The
          // sponsored path needs nothing free: the operator pays the reserve.
          const missing = opts.code ? 0 : recoveryShortfall(await getAccountState(network, address));
          guardSession(epoch);
          if (missing > 0) {
            flash(t('recovery.needXlm', { amount: missing }), 'err');
            return false;
          }

          // Said plainly before anything happens, because this is the bargain: whoever
          // can prove that inbox — to BOTH servers — can put a new key on this account.
          const okToStart = await requestSignature({
            title: t('recovery.confirmTitle'),
            message: t('recovery.confirmMsg', { email }),
          });
          if (!okToStart) return false;
          guardSession(epoch);

          const secret = await secretOf(session);
          // Before anything is registered: on a recovered account the key that signs is
          // not the master, and the setup must then leave the master at 0.
          const deviceKey = await deviceKeyFor(network, address, secret);
          guardSession(epoch);
          const signers = await registerForRecovery(network, servers, address, secret, email);
          guardSession(epoch);

          let xdr: string;
          if (opts.code) {
            if (!isAccessCode(opts.code)) {
              flash(t('recovery.error.badCode'), 'err');
              return false;
            }
            const ready = await signIn.submitCode(opts.code);
            guardSession(epoch);
            if (!ready) return false; // the slice already said why
            const built = await recoverySetupSponsored(
              ready.sessionToken,
              {
                stellarAddress: address,
                signers,
                ...signedRecoverySetup(secret, address, signers),
                // The ledger to sponsor on: this one, never the operator's default by accident.
                ...(ledgerName(network.passphrase) ? { network: ledgerName(network.passphrase)! } : {}),
              },
              await warmPublicKey(networkEnv(network)),
            );
            guardSession(epoch);
            xdr = built.transaction;
          } else {
            // Only the self-paid variant needs the sequence here: the sponsored one is
            // built by the operator, on the sequence it reads for itself.
            const sequence = await sequenceOf(network, address);
            guardSession(epoch);
            xdr = buildRecoverySetup({ account: address, deviceKey, signers, sequence, networkPassphrase: network.passphrase });
          }

          // The template, on both variants — including the one this wallet built itself.
          // A builder that checked only the other side's envelope would be trusting its
          // own code more than the thing that has to be right. On a recovered account it
          // refuses the operator's envelope, which raises the retired master to 10.
          assertSafeToSign(network, xdr, {
            signer: address,
            deviceKey,
            intent: 'recovery',
            // Nothing leaves. Stating the policy is still required, and this is the
            // honest answer rather than the empty one.
            destinations: 'self',
            signers,
            // The PATH the person chose, not the payer's address: an address here would
            // have come from the same response as the envelope, and the guard would have
            // been checking the operator against itself. See the arm's own note.
            sponsored: !!opts.code,
          });
          guardSession(epoch);

          const signed = await signEnvelope(xdr);
          await stellarSubmitXdr(network, signed);

          // What the servers were actually told, kept because SEP-30 will not tell us
          // again: an identity is write-only, so this is the only record of which inbox
          // can recover this account. Written AFTER the submit — before it, a setup that
          // failed on chain would leave the device claiming a protection it does not have.
          await patchMeta({ recoveryEmail: email });

          invalidate(ACCOUNT_PREFIX);
          invalidate(RECOVERY_PREFIX);
          void loadRecovery();
          flash(t('recovery.enabled'), 'ok');
          return true;
        } catch (e) {
          flash((e as Error).message || t('recovery.error.generic'), 'err');
          return false;
        }
      });
      return outcome.ran ? outcome.value : false;
    },
    [session, meta, network, exclusive, guardSession, requestSignature, signEnvelope, signIn, loadRecovery, t, flash],
  );

  /**
   * Turn it off: both signers back to weight 0, the thresholds back to one signature.
   *
   * Built entirely from what the LEDGER says is on the account, with nothing from either
   * server in it — which is also why it does not go through the guard the way enabling
   * does. There is no counterparty envelope here: the worst a wrong answer from Horizon
   * could produce is an operation that removes a signer the account never had.
   *
   * The servers are told afterwards, and a failure there is not a failure of this: the
   * signer is off the account either way, and a server that still thinks it protects an
   * account it cannot sign for is stale, not dangerous.
   */
  const disableRecovery = useCallback(async (): Promise<boolean> => {
    if (!session || !meta) return false;

    const outcome = await exclusive.run('recovery', async () => {
      const epoch = sessionEpochRef.current;
      try {
        const address = session.publicKey;
        const state = await recoveryStateOf(network, address);
        guardSession(epoch);
        if (!state.enabled || !state.signers.length) {
          flash(t('recovery.error.notOn'), 'err');
          return false;
        }

        const ok = await requestSignature({
          title: t('recovery.offConfirmTitle'),
          message: t('recovery.offConfirmMsg'),
        });
        if (!ok) return false;
        guardSession(epoch);

        // Ask the SERVERS which key each of them holds, rather than removing whatever the
        // ledger carries at their weight: another signer the account happens to have at
        // that weight — a co-signer, a service — is not ours to zero. This also
        // deregisters the account, so neither server is left holding an identity record
        // for an account it can no longer sign for.
        const servers = await loadRecoveryServers(network);
        guardSession(epoch);
        const secret = await secretOf(session);
        // Asked BEFORE the servers are told to forget the account, so a refusal here leaves
        // recovery exactly as it was.
        const deviceKey = await deviceKeyFor(network, address, secret);
        guardSession(epoch);
        const signers = await signersToRemove(network, servers, address, secret);
        guardSession(epoch);
        if (!signers.length) {
          flash(t('recovery.error.notOn'), 'err');
          return false;
        }

        const sequence = await sequenceOf(network, address);
        guardSession(epoch);
        const xdr = buildRecoveryRemoval({ account: address, deviceKey, signers, sequence, networkPassphrase: network.passphrase });
        const signed = await signEnvelope(xdr);
        await stellarSubmitXdr(network, signed);

        // Nothing is registered any more, so a recorded address would be a claim about
        // servers that have already been told to forget this account.
        await patchMeta({ recoveryEmail: undefined });

        invalidate(ACCOUNT_PREFIX);
        invalidate(RECOVERY_PREFIX);
        void loadRecovery();
        flash(t('recovery.disabled'), 'ok');
        return true;
      } catch (e) {
        flash((e as Error).message || t('recovery.error.generic'), 'err');
        return false;
      }
    });
    return outcome.ran ? outcome.value : false;
  }, [session, meta, network, exclusive, guardSession, requestSignature, signEnvelope, loadRecovery, t, flash]);

  /**
   * Point the two servers at the wallet's CURRENT email.
   *
   * SEP-30's `PUT /accounts/<address>`, and the reason it has a screen of its own is that
   * nothing else can notice it is needed: the profile email is editable at any time, an
   * identity cannot be read back, and the two drift apart silently. Until this runs, the
   * inbox that can recover the account is whichever one was registered — which after an
   * address change is the one the person no longer uses, and may no longer control.
   *
   * It touches no ledger: signers, weights and thresholds are exactly as they were, and
   * the account is not re-registered. What changes is who the servers will answer to.
   * Still password-gated, because it needs the account's key for SEP-10 — and because
   * changing who may recover an account is the same decision as granting it.
   *
   * The record is written only after BOTH servers took it. A partial update leaves the
   * account reachable from either address and the old one still live, which is worth
   * reporting as a failure rather than recording as a success.
   */
  const updateRecoveryEmail = useCallback(async (): Promise<boolean> => {
    if (!session || !meta) return false;

    const outcome = await exclusive.run('recovery', async () => {
      const epoch = sessionEpochRef.current;
      try {
        const address = session.publicKey;
        const email = meta.email?.trim().toLowerCase() ?? '';
        if (!email) {
          flash(t('recovery.error.noEmail'), 'err');
          return false;
        }

        const state = await recoveryStateOf(network, address);
        guardSession(epoch);
        if (!state.enabled) {
          flash(t('recovery.error.notOn'), 'err');
          return false;
        }

        const ok = await requestSignature({
          title: t('recovery.emailConfirmTitle'),
          message: t('recovery.emailConfirmMsg', { email }),
        });
        if (!ok) return false;
        guardSession(epoch);

        const servers = await loadRecoveryServers(network);
        guardSession(epoch);
        const secret = await secretOf(session);
        await updateRecoveryIdentities(network, servers, address, secret, email);
        guardSession(epoch);

        await patchMeta({ recoveryEmail: email });
        flash(t('recovery.emailUpdated'), 'ok');
        return true;
      } catch (e) {
        flash((e as Error).message || t('recovery.error.generic'), 'err');
        return false;
      }
    });
    return outcome.ran ? outcome.value : false;
  }, [session, meta, network, exclusive, guardSession, requestSignature, patchMeta, t, flash]);

  /* ---------------------- recovering onto this device ----------------------- */

  /*
   * The other half of SEP-30: someone whose device is gone, and whose password is gone
   * with it — the case the encrypted cloud backup cannot answer, because that box only
   * ever opens with the password.
   *
   * What comes back is the ACCOUNT, not the key. The address, its balances, its
   * trustlines and its history all survive; the key that used to sign for it does not,
   * and a new one generated here takes its place. That is the whole of what the two
   * servers co-sign, and `buildKeyReplacement` is where the transaction is built —
   * HERE, by the device that will use it, and only then handed to them for signatures.
   */

  /** The accounts the finished sign-in can recover, as both servers agree. */
  const [recoverable, setRecoverable] = useState<RecoverableAccount[] | null>(null);

  /**
   * Each server's identity token for THIS sign-in, once proven.
   *
   * Kept for the whole recovery — the listing and the signatures both spend it — because
   * getting it again is not free: a server takes a given Authentik ID token once, so a
   * remounted screen that exchanged it a second time would be refused, and a second round
   * of emailed codes is a second round of email. Keyed by the sign-in it came from, so a
   * new sign-in never reuses an old one's proof. In memory only, like the draft itself.
   */
  const recoveryProofRef = useRef<{ key: string; tokens: string[]; at: number } | null>(null);

  /** The two emailed codes a recovery is waiting on, when that is the route it took. */
  const [recoveryCodes, setRecoveryCodes] = useState<{ key: string; email: string; claims: string[] } | null>(null);

  /**
   * The address whose WHOLE backup the two servers' halves open, once the inbox is proven —
   * the email door (`lib/backupRecovery.ts`). Preferred over SEP-30 on the screen: it keeps
   * the seed, and with it the address on every chain. The key itself stays in a ref, keyed
   * by the sign-in, and is zeroed once used.
   */
  const [backupRecoverable, setBackupRecoverable] = useState<string | null>(null);
  const backupRecoveryKeyRef = useRef<{ key: string; value: Uint8Array } | null>(null);

  const listRecoverable = useCallback(
    async (draft: SignInDraft, tokens: string[]) => {
      const servers = await loadRecoveryServers(network);
      recoveryProofRef.current = { key: draft.ready.sessionToken, tokens, at: Date.now() };
      const backup = draft.ready.backup;
      let backupKey: Uint8Array | null = null;
      if (backup && !draft.replace && backupDoorsOf(backup.box)?.recovery) {
        try {
          backupKey = await takeBackupRecovery(servers, tokens, backup.stellarAddress);
        } catch (e) {
          reportError(EVENT.signInFailed, e, { purpose: draft.purpose, step: 'backup-recovery' });
        }
      }
      if (backupKey) {
        backupRecoveryKeyRef.current?.value.fill(0);
        backupRecoveryKeyRef.current = { key: draft.ready.sessionToken, value: backupKey };
        setBackupRecoverable(backup!.stellarAddress);
      }
      // SEP-30 is the fallback here, so a failure to list it must not hide the backup.
      let accounts: RecoverableAccount[] = [];
      try {
        accounts = await recoverableAccounts(servers, tokens);
      } catch (e) {
        if (!backupKey) throw e;
      }
      setRecoverable(accounts);
    },
    [network],
  );

  /**
   * Prove the inbox to both servers, and list what they will recover.
   *
   * Authentik's ID token when the sign-in carried one — each server verifies it against
   * Authentik's keys on its own. Otherwise each server emails its OWN code and the screen
   * asks for both (`submitRecoveryCodes`); neither server ever takes the other's word, or
   * the sign-in's, for who this is.
   */
  const loadRecoverable = useCallback(async () => {
    const draft = signInDraft;
    if (!draft) return;
    try {
      const cached = freshProof(recoveryProofRef.current, draft.ready.sessionToken);
      if (cached) {
        await listRecoverable(draft, cached);
        return;
      }
      if (recoveryCodes?.key === draft.ready.sessionToken) return; // already waiting on codes

      const servers = await loadRecoveryServers(network);
      const route = identityRoute(servers, draft.ready.idToken);
      if (!route) {
        setRecoverable([]);
        flash(t('recovery.error.noIdentityRoute'), 'err');
        return;
      }
      if (route.kind === 'oidc') {
        await listRecoverable(draft, await identityTokensFromIdToken(servers, draft.ready.idToken as string));
        return;
      }
      const email = draft.ready.identity.email;
      const claims = await startRecoveryCodes(servers, email);
      setRecoveryCodes({ key: draft.ready.sessionToken, email, claims });
    } catch (e) {
      setRecoverable([]);
      flash((e as Error).message || t('recovery.error.generic'), 'err');
    }
  }, [signInDraft, recoveryCodes, network, listRecoverable, flash, t]);

  /**
   * Answer both servers' codes, in role order.
   *
   * Both, or nothing is listed: an identity one server accepted and the other did not is
   * half a threshold, and the list is the intersection of what both will act for anyway.
   * A wrong code keeps the prompt; an expired or locked one starts the round again.
   */
  const submitRecoveryCodes = useCallback(
    async (codes: string[]): Promise<boolean> => {
      const draft = signInDraft;
      const pending = recoveryCodes;
      if (!draft || !pending || pending.key !== draft.ready.sessionToken) return false;
      if (codes.length !== pending.claims.length || !codes.every(isAccessCode)) {
        flash(t('recovery.error.badCode'), 'err');
        return false;
      }
      try {
        setBusy(true);
        const servers = await loadRecoveryServers(network);
        const tokens: string[] = [];
        for (const [i, server] of servers.entries()) {
          const res = await verifyRecoveryCode(server, pending.claims[i], codes[i]);
          if (res.status === 'ready') {
            tokens.push(res.token);
            continue;
          }
          const role = server.role.toUpperCase();
          if (res.status === 'invalid') {
            flash(t('recover.codeInvalid', { role, n: res.attempts_left }), 'err');
          } else {
            setRecoveryCodes(null);
            flash(t('recover.codeExpired', { role }), 'err');
          }
          return false;
        }
        setRecoveryCodes(null);
        await listRecoverable(draft, tokens);
        return true;
      } catch (e) {
        flash((e as Error).message || t('recovery.error.generic'), 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [signInDraft, recoveryCodes, network, listRecoverable, flash, t],
  );

  /**
   * Put a new key on a recovered account and land it as a wallet on this device.
   *
   * The order matters and is the opposite of the intuitive one: the chain first, the
   * vault second. A wallet written before the transaction confirms would be a wallet
   * whose key cannot sign for its own account — indistinguishable, from the inside, from
   * a wallet that works. If the submit fails nothing local has happened and the person
   * can try again; if the vault write fails afterwards the account is already recovered
   * and signing in again finds it.
   *
   * `password` is a NEW one. There is no old password in this flow by definition, which
   * is also why the cloud backup is re-sealed here rather than restored.
   */
  const recoverWallet = useCallback(
    async (address: string, password: string): Promise<boolean> => {
      // Read here rather than taken as an argument, exactly as `finishOnboarding` does:
      // this IS an onboarding path (a first wallet on a fresh device), and the screen asks
      // the same two questions with the same shared component.
      const consents: ConsentAnswers = { metricsOptIn: draftMetricsOptIn, promoOptIn: draftPromoOptIn };
      const draft = signInDraft;
      if (!draft) return false;
      const row = recoverable?.find((r) => r.address === address);
      if (!row) return false;

      const outcome = await exclusive.run('recovery', async () => {
        try {
          setBusy(true);
          const servers = await loadRecoveryServers(network);
          // The proof the listing was built on. Not re-derived: an ID token is spent, and a
          // recovery that outlived its identity tokens starts over rather than guessing.
          const tokens = freshProof(recoveryProofRef.current, draft.ready.sessionToken);
          if (!tokens) {
            setRecoverable(null);
            flash(t('recover.proofExpired'), 'err');
            return false;
          }

          // The key that will replace the lost one. A fresh mnemonic, because the old one
          // is exactly what is missing — and the person is told on the screen that it now
          // restores a KEY, not this account, which keeps its own address.
          const { createMnemonic, accountFromMnemonic } = await walletLib();
          const mnemonic = createMnemonic();
          const fresh = await accountFromMnemonic(mnemonic);

          // Read once, for both the sequence and the keys to retire: a second recovery's
          // lost key is the previous replacement, not the master.
          const ledger = await ledgerAccountOf(network, address);
          if (!ledger) throw new Error(t('recovery.error.notFunded'));
          const sequence = await sequenceOf(network, address);
          const xdr = buildKeyReplacement({
            account: address,
            newKey: fresh.publicKey,
            revoke: keysToRevoke(address, ledger, row.signers, fresh.publicKey),
            sequence,
            networkPassphrase: network.passphrase,
          });
          const signed = await collectSignatures(network, servers, tokens, row.signers, address, xdr);
          await stellarSubmitXdr(network, signed);

          // Only now is the key real. Everything below is local bookkeeping over an
          // account this device can already sign for.
          // The re-key happened on THIS ledger only. Recorded on the entry and in the box, so
          // every other network uses the new key's own address instead (`addressOn`).
          const rekey: Rekey = { passphrase: network.passphrase, keyAddress: fresh.publicKey };
          const vk = await deriveVaultKey(password, newKdfParams());
          setTelemetryEnabled(consents.metricsOptIn);
          // Sealed WITH the account: the new key's own address is not the account any more,
          // and `openBackup` on the next device checks the box against the account address
          // the server hands back. Without it, the backup of a recovered wallet never opens.
          const recovery = await fileRecovery(fresh.secret, address, draft.ready.identity.email);
          const box = await sealBackup(
            { secret: fresh.secret, mnemonic },
            recovery ? { password, recovery } : password,
            address,
            rekey.passphrase,
          );
          recovery?.fill(0);
          const accessKey = await warmPublicKey(networkEnv(network));
          // Retried, unlike every other call that follows a signature, because the key is
          // ALREADY on the ledger and exists nowhere but in this closure: a dropped
          // connection here would throw away the only copy of a key that now controls the
          // account. Only failures that never got an HTTP answer are retried — a refusal
          // is the server's decision and repeating it changes nothing. A repeat cannot
          // duplicate anything either: it replaces the same account's backup with the same
          // box.
          const res = await retryOnNetworkError(() =>
            finishSignIn({
              sessionToken: draft.ready.sessionToken,
              email: draft.ready.identity.email,
              secret: fresh.secret,
              // The ACCOUNT, not the new key's own address: what was recovered is the
              // account, and the server accepts the signature because that key is now one
              // of its signers — see the community server's account-signers module, which
              // is in a separate repository and so is named rather than linked.
              account: address,
              // ...on THIS ledger, the one the re-key just landed on.
              network: ledgerName(network.passphrase),
              backup: box,
              replaceBackup: true,
              accessKey,
            }),
          );
          if (res.status === 'backup_conflict') {
            flash(t('backup.conflict'), 'err');
            return false;
          }

          const landed = await landSignedInWallet({
            secret: { secret: fresh.secret, mnemonic },
            publicKey: address,
            rekey,
            ready: draft.ready,
            account: { keys: res.keys, organizationId: res.organizationId },
            vk,
            consents,
          });
          if (landed && recovery) await noteBackupRecovery(landed.id, draft.ready.identity.email);
          setSignInDraft(null);
          setRecoverable(null);
          recoveryProofRef.current = null;
          flash(t('recovery.recovered'), 'ok');
          return true;
        } catch (e) {
          flash((e as Error).message || t('recovery.error.generic'), 'err');
          return false;
        } finally {
          setBusy(false);
        }
      });
      return outcome.ran ? outcome.value : false;
    },
    [signInDraft, recoverable, network, exclusive, landSignedInWallet, fileRecovery, noteBackupRecovery, draftMetricsOptIn, draftPromoOptIn, flash, t],
  );

  /** Browse on-chain liquidity pools (Horizon proxy). Returns [] on error / not enabled. */
  const listPools = useCallback(
    async (input: ListPoolsInput = {}): Promise<LiquidityPool[]> => {
      const apiKey = openAccessKey();
      if (!apiKey) return [];
      try {
        return (await cpListLiquidityPools(apiKey, input)).data;
      } catch (e) {
        flash((e as Error).message || t('lp.loadError'), 'err');
        return [];
      }
    },
    [openAccessKey, t, flash],
  );

  /** This wallet's pool share positions (with redeemable amounts). [] on error. */
  const liquidityPositions = useCallback(async (): Promise<LiquidityPosition[]> => {
    if (!meta) return [];
    const apiKey = openAccessKey();
    if (!apiKey) return [];
    try {
      return (await cpLiquidityPositions(apiKey, meta.publicKey)).data;
    } catch (e) {
      flash((e as Error).message || t('lp.loadError'), 'err');
      return [];
    }
  }, [meta, openAccessKey, t, flash]);

  /**
   * Full deposit flow: build (server prices it + builds the XDR) -> sign locally
   * -> submit (server relays it to Horizon). Mirrors submitSwap; lands on success.
   */
  const submitDeposit = useCallback(
    async (input: { assetA: SwapAsset; assetB: SwapAsset; maxAmountA: string; maxAmountB?: string }) => {
      if (!session) return;
      const apiKey = openAccessKey();
      if (!apiKey) return;
      await exclusive.run('lp-deposit', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.lpDepositTitle'),
          message: t('confirmSig.lpDepositMsg', { a: input.assetA.code, b: input.assetB.code }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const op = await cpDepositLiquidity(apiKey, {
            source: session.publicKey,
            assetACode: input.assetA.code,
            assetAIssuer: input.assetA.issuer ?? undefined,
            assetBCode: input.assetB.code,
            assetBIssuer: input.assetB.issuer ?? undefined,
            maxAmountA: input.maxAmountA,
            maxAmountB: input.maxAmountB,
            slippageBps: DEFAULT_SLIPPAGE_BPS,
          });
          // Server-built envelope — verify before signing (see lib/txGuard.ts).
          // A pool deposit takes value out and gives shares back to the same account.
          //
          // The B side is optional in the form ("auto" derives it from the pool ratio),
          // and an amount the user did not state cannot be bounded by one. The ceiling
          // is then the spendable balance the screen displays under that field — weaker
          // than a confirmation, but it is a number the user saw, and it stops a hostile
          // gateway depositing a balance the deposit was never about.
          const ceilingB = input.maxAmountB ?? spendableCeiling(account, input.assetB);
          // Each side carries the asset it belongs to, so the guard can derive the only
          // pool those two assets form and bind each amount to its OWN ceiling. Passing
          // the ceilings alone let a hostile gateway swap the sides.
          assertSafeToSign(network, op.xdr, {
            signer: session.publicKey,
            intent: 'lp-deposit',
            destinations: 'self',
            poolSides: [
              { asset: { code: input.assetA.code, issuer: input.assetA.issuer }, max: input.maxAmountA },
              { asset: { code: input.assetB.code, issuer: input.assetB.issuer }, max: ceilingB },
            ],
            trustlines: [
              { code: input.assetA.code, issuer: input.assetA.issuer },
              { code: input.assetB.code, issuer: input.assetB.issuer },
            ],
          });
          guardSession(epoch);
          const signedXdr = await signEnvelope(op.xdr);
          const res = await cpSubmitLiquidity(apiKey, op.id, signedXdr);
          if (res.submitted) {
            report(EVENT.liquidityDeposit, {
              category: 'transaction',
              props: { assetA: input.assetA.code, assetB: input.assetB.code, amount: op.amountA, txHash: res.txHash ?? undefined },
            });
            setSuccessInfo({
              kind: 'ok',
              title: t('lp.depositSuccess'),
              msg: t('lp.depositSuccessMsg'),
              rows: [
                { label: t('lp.assetA'), val: `${op.amountA} ${op.assetA === 'native' ? 'XLM' : op.assetA}` },
                { label: t('lp.assetB'), val: `${op.amountB} ${op.assetB === 'native' ? 'XLM' : op.assetB}` },
              ],
              hash: res.txHash ?? undefined,
            });
            setScreen('success');
            refresh(true);
          } else {
            const codes = res.resultCodes ? JSON.stringify(res.resultCodes) : '';
            report(EVENT.liquidityFailed, {
              level: 'error',
              category: 'error',
              message: res.reason || codes || 'lp deposit not submitted',
              props: { op: 'deposit', assetA: input.assetA.code, assetB: input.assetB.code },
            });
            setSuccessInfo({ kind: 'err', title: t('lp.depositFailed'), msg: res.reason || codes || t('lp.depositFailed'), rows: [] });
            setScreen('success');
          }
        } catch (e) {
          reportError(EVENT.liquidityFailed, e, { op: 'deposit', assetA: input.assetA.code, assetB: input.assetB.code });
          setSuccessInfo({ kind: 'err', title: t('lp.depositFailed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, account, openAccessKey, network, requestSignature, refresh, exclusive, guardSession, signEnvelope, t],
  );

  /** Full withdraw flow: build -> sign locally -> submit. Mirrors submitDeposit. */
  const submitWithdraw = useCallback(
    async (input: { poolId: string; shares: string }) => {
      if (!session) return;
      const apiKey = openAccessKey();
      if (!apiKey) return;
      await exclusive.run('lp-withdraw', async () => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({
          title: t('confirmSig.lpWithdrawTitle'),
          message: t('confirmSig.lpWithdrawMsg', { shares: input.shares }),
        });
        if (!okSig) return;
        setBusy(true);
        try {
          const op = await cpWithdrawLiquidity(apiKey, {
            source: session.publicKey,
            poolId: input.poolId,
            shares: input.shares,
            slippageBps: DEFAULT_SLIPPAGE_BPS,
          });
          // Server-built envelope — verify before signing (see lib/txGuard.ts).
          // Both bounds are the user's own: the pool they opened the form on, and the
          // share count they typed. The guard additionally refuses a withdrawal whose
          // declared minimum out is zero — "burn everything, receive one stroop" passed
          // every other check.
          assertSafeToSign(network, op.xdr, {
            signer: session.publicKey,
            intent: 'lp-withdraw',
            destinations: 'self',
            poolId: input.poolId,
            poolAmounts: [input.shares],
          });
          guardSession(epoch);
          const signedXdr = await signEnvelope(op.xdr);
          const res = await cpSubmitLiquidity(apiKey, op.id, signedXdr);
          if (res.submitted) {
            report(EVENT.liquidityWithdraw, {
              category: 'transaction',
              props: { shares: op.shares ?? input.shares, txHash: res.txHash ?? undefined },
            });
            setSuccessInfo({
              kind: 'ok',
              title: t('lp.withdrawSuccess'),
              msg: t('lp.withdrawSuccessMsg'),
              rows: [
                { label: t('lp.shares'), val: op.shares ?? input.shares },
                { label: t('lp.assetA'), val: `≥ ${op.amountA} ${op.assetA === 'native' ? 'XLM' : op.assetA}` },
                { label: t('lp.assetB'), val: `≥ ${op.amountB} ${op.assetB === 'native' ? 'XLM' : op.assetB}` },
              ],
              hash: res.txHash ?? undefined,
            });
            setScreen('success');
            refresh(true);
          } else {
            const codes = res.resultCodes ? JSON.stringify(res.resultCodes) : '';
            report(EVENT.liquidityFailed, {
              level: 'error',
              category: 'error',
              message: res.reason || codes || 'lp withdraw not submitted',
              props: { op: 'withdraw', shares: input.shares },
            });
            setSuccessInfo({ kind: 'err', title: t('lp.withdrawFailed'), msg: res.reason || codes || t('lp.withdrawFailed'), rows: [] });
            setScreen('success');
          }
        } catch (e) {
          reportError(EVENT.liquidityFailed, e, { op: 'withdraw', shares: input.shares });
          setSuccessInfo({ kind: 'err', title: t('lp.withdrawFailed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, openAccessKey, network, requestSignature, refresh, exclusive, guardSession, signEnvelope, t],
  );

  /** Create a shareable CosmosPay pay link (SEP-7 pay intent) addressed to this wallet. */
  const createPayLink = useCallback(
    async (input: { amount?: string; assetCode?: string; assetIssuer?: string; memo?: string; msg?: string }): Promise<PayIntent | null> => {
      if (!meta) return null;
      // A pay link is built from the request and addressed to this wallet, so it
      // needs no account of its own.
      const apiKey = openAccessKey();
      if (!apiKey) return null;
      try {
        const intent = await cpCreatePayLink(apiKey, { destination: meta.publicKey, ...input });
        report(EVENT.payLinkCreated, {
          category: 'transaction',
          props: { asset: input.assetCode ?? 'XLM', amount: input.amount },
        });
        return intent;
      } catch (e) {
        reportError(EVENT.payLinkFailed, e, { asset: input.assetCode ?? 'XLM' });
        flash((e as Error).message || t('paylink.error'), 'err');
        return null;
      }
    },
    [meta, cosmosPay, network, t, flash],
  );

  /** List the wallet's BlindPay fiat receivers (KYC accounts). */
  const loadReceivers = useCallback(async () => {
    const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (!apiKey) return;
    try {
      setReceivers((await cpListReceivers(apiKey)).items);
    } catch {
      /* best-effort */
    }
  }, [cosmosPay, network]);

  /** Upload a KYC document for the BlindPay flow; returns its file_url (null on error). */
  const uploadKycDoc = useCallback(
    async (file: Blob, bucket?: string): Promise<string | null> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
      try {
        const res = await cpUploadKycDoc(apiKey, file, bucket);
        return res.file_url;
      } catch (e) {
        flash((e as Error).message || t('fiat.uploadError'), 'err');
        return null;
      }
    },
    [cosmosPay, network, t, flash],
  );

  /** Create a fiat receiver (KYC) and set it as this wallet's default. */
  const createFiatReceiver = useCallback(
    async (input: CreateReceiverInput): Promise<Receiver | null> => {
      if (!meta) return null;
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
      setBusy(true);
      try {
        const receiver = await cpCreateReceiver(apiKey, input);
        const list = await saveDefaultReceiver(meta.id, receiver.id);
        setWallets(list);
        const entry = list.find((w) => w.id === meta.id);
        if (entry) setMetaState(entry);
        setReceivers((prev) => [receiver, ...prev.filter((r) => r.id !== receiver.id)]);
        flash(t('fiat.receiverCreated'), 'ok');
        return receiver;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [meta, cosmosPay, network, t, flash],
  );

  /** Unlink the CosmosPay integration from this wallet (removes its stored API keys). */
  const unlinkCosmosPay = useCallback(async () => {
    if (!meta) return;
    const list = await clearCosmosPay(meta.id);
    setWallets(list);
    const entry = list.find((w) => w.id === meta.id);
    if (entry) setMetaState(entry);
    setCosmosPay(null);
    setCosmosLink(null);
    flash(t('cosmospay.unlinked'), 'ok');
  }, [meta, t, flash]);

  /** Unlink just one network's API key (testnet=dev / mainnet=prod), keeping the other. */
  const unlinkCosmosPayEnv = useCallback(
    async (env: 'dev' | 'prod') => {
      if (!session || !meta || !cosmosPay) return;
      const keys = { ...cosmosPay.keys, [env]: null };
      if (!keys.dev && !keys.prod) {
        // nothing left → fully unlink
        const list = await clearCosmosPay(meta.id);
        setWallets(list);
        const entry = list.find((w) => w.id === meta.id);
        if (entry) setMetaState(entry);
        setCosmosPay(null);
      } else {
        const account: CosmosPayAccount = { ...cosmosPay, keys };
        const list = await saveCosmosPay(meta.id, account, session.vaultKey);
        setWallets(list);
        const entry = list.find((w) => w.id === meta.id);
        if (entry) setMetaState(entry);
        setCosmosPay(account);
      }
      flash(t('cosmospay.unlinkedEnv', { net: env === 'prod' ? 'mainnet' : 'testnet' }), 'ok');
    },
    [session, meta, cosmosPay, t, flash],
  );

  /** Refresh a single receiver from BlindPay (the list can be stale — this re-reads KYC status). */
  const loadReceiver = useCallback(
    async (id: string) => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) return;
      try {
        const r = await cpGetReceiver(apiKey, id);
        setReceivers((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
      } catch {
        /* best-effort */
      }
    },
    [cosmosPay, network],
  );

  /** Load the receiver's payout/deposit bank accounts. */
  const loadBankAccounts = useCallback(
    async (receiverId: string) => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) return;
      try {
        setBankAccounts((await cpListBankAccounts(apiKey, receiverId)).items);
      } catch {
        /* best-effort */
      }
    },
    [cosmosPay, network],
  );

  /** Add a deposit/payout bank account (per rail/currency) to the receiver. */
  const addFiatBankAccount = useCallback(
    async (receiverId: string, body: Record<string, unknown>): Promise<boolean> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return false;
      }
      setBusy(true);
      try {
        const acc = await cpAddBankAccount(apiKey, receiverId, body);
        setBankAccounts((prev) => [acc, ...prev]);
        flash(t('fiat.accountAdded'), 'ok');
        return true;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [cosmosPay, network, t, flash],
  );

  /** Delete a deposit/payout bank account from the receiver. */
  const removeFiatBankAccount = useCallback(
    async (receiverId: string, accountId: string): Promise<boolean> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) return false;
      setBusy(true);
      try {
        await cpDeleteBankAccount(apiKey, receiverId, accountId);
        setBankAccounts((prev) => prev.filter((a) => a.id !== accountId));
        flash(t('fiat.accountDeleted'), 'ok');
        return true;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [cosmosPay, network, t, flash],
  );

  /**
   * Ensure this wallet's Stellar address is registered as a blockchain wallet on the
   * receiver and return its LOCAL id (the `blockchain_wallet_id` onramp quotes need).
   * Reuses an existing matching registration; otherwise registers one (non-secure flow).
   */
  const ensureBlockchainWallet = useCallback(
    async (receiverId: string): Promise<string | null> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey || !meta) return null;
      const net = blindpayNetwork(networkEnv(network));
      try {
        const existing = await cpListReceiverWallets(apiKey, receiverId);
        const match = existing.items.find((w) => w.address === meta.publicKey && (!w.network || w.network === net));
        if (match) return match.id;
        const created = await cpAddReceiverWallet(apiKey, receiverId, { name: 'CosmosPay Wallet', network: net, address: meta.publicKey });
        return created.id;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return null;
      }
    },
    [cosmosPay, network, meta, t, flash],
  );

  /** Onramp step 1: price a deposit. `blockchain_wallet_id` comes from ensureBlockchainWallet. */
  const quoteDeposit = useCallback(
    async (input: PayinQuoteInput): Promise<PayinQuote | null> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
      try {
        return await cpOnrampQuote(apiKey, input);
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return null;
      }
    },
    [cosmosPay, network, t, flash],
  );

  /** Onramp step 2: create the payin and return its payment instructions. */
  const confirmDeposit = useCallback(
    async (quoteId: string): Promise<Payin | null> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) return null;
      setBusy(true);
      try {
        const payin = await cpCreatePayin(apiKey, quoteId);
        flash(t('fiat.depositCreated'), 'ok');
        return payin;
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [cosmosPay, network, t, flash],
  );

  /** Offramp step 1: price a withdrawal to a bank account (network injected from the env). */
  const quoteWithdraw = useCallback(
    async (input: { bank_account_id: string; request_amount: number; token: FiatToken; cover_fees: boolean; currency_type?: 'sender' | 'receiver'; description?: string }): Promise<PayoutQuote | null> => {
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
      try {
        return await cpOfframpQuote(apiKey, {
          bank_account_id: input.bank_account_id,
          currency_type: input.currency_type ?? 'sender',
          cover_fees: input.cover_fees,
          request_amount: input.request_amount,
          network: blindpayNetwork(networkEnv(network)),
          token: input.token,
          description: input.description,
        });
      } catch (e) {
        flash((e as Error).message || t('fiat.error'), 'err');
        return null;
      }
    },
    [cosmosPay, network, t, flash],
  );

  /**
   * Offramp step 2: authorize -> sign the returned XDR locally -> create the payout.
   * Mirrors the swap signing flow. Lands on the success screen either way.
   */
  const confirmWithdraw = useCallback(
    async (quote: PayoutQuote, token: FiatToken, fiatCcy?: string): Promise<boolean> => {
      if (!session) return false;
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return false;
      }
      const run = await exclusive.run('offramp', async (): Promise<boolean> => {
        const epoch = sessionEpochRef.current;
        const okSig = await requestSignature({ title: t('confirmSig.withdrawTitle'), message: t('confirmSig.withdrawMsg') });
        if (!okSig) return false;
        setBusy(true);
        try {
          const auth = await cpAuthorizePayout(apiKey, { quote_id: quote.id, sender_wallet_address: session.publicKey, chain: 'stellar' });
          const xdr = extractUnsignedXdr(auth);
          if (!xdr) throw new Error(t('fiat.noXdr'));
          // `sender_amount` is integer minor units. It used to be divided by 100 in a
          // float here — the one number that bounds how much the signature can move,
          // derived by the arithmetic `lib/amount.ts` exists to avoid. And the contract
          // declares it optional, so it can simply be absent: that has to be a refusal.
          // Treating "no bound in the response" as "no bound" is how the guard's own
          // rule ("could not determine" is never "no limit") was broken at the one call
          // site that thought about it.
          const senderAmount = quote.sender_amount != null ? fromMinorUnits(quote.sender_amount, FIAT_DECIMALS) : null;
          if (senderAmount === null) throw new Error(t('fiat.noAmount'));
          // Pin the issuer from the trustline the wallet actually holds. "BlindPay picks
          // the issuer, so we cannot know it" was wrong: the account does. Without it, a
          // wallet holding a real USDC and a look-alike USDC can be quoted against one
          // and made to spend the other — the substitution an asset code alone allows.
          const held = sendableAssets(account);
          if (codeIsAmbiguous(held, token)) throw new Error(t('fiat.ambiguousAsset', { code: token }));
          const tokenAsset = held.find((b) => b.code === token);
          if (!tokenAsset) throw new Error(t('fiat.ambiguousAsset', { code: token }));
          // extractUnsignedXdr probes untyped BlindPay fields and returns the first
          // base64-ish string it finds, so the guard is doing double duty here: it is
          // the only thing that proves the string is a transaction we should sign.
          assertSafeToSign(network, xdr, {
            signer: session.publicKey,
            intent: 'offramp',
            // The payout lands on an address BlindPay picks, which the wallet cannot know
            // in advance — so: exactly one third party, and the amount bound does the rest.
            // That pairing is now enforced by the type: `intent: 'offramp'` requires
            // `maxSend`, so "one unknown destination, unlimited amount" cannot be written.
            destinations: 'counterparty',
            maxSend: { amount: senderAmount, asset: { code: token, issuer: tokenAsset.issuer } },
          });
          guardSession(epoch);
          const signed = await signEnvelope(xdr);
          const payout = await cpCreatePayout(apiKey, { quote_id: quote.id, sender_wallet_address: session.publicKey, chain: 'stellar', signed_transaction: signed });
          const fiatMinor = quote.receiver_local_amount || quote.receiver_amount || 0;
          const sent = payout.senderAmount ?? senderAmount ?? '';
          // Local fiat (e.g. ARS) shown as whole units — no centavos — with its currency suffix.
          const gotAmount = fiatMinor ? Math.round(fiatMinor / 100).toLocaleString('es-AR') : (payout.receiverAmount ?? '');
          const got = gotAmount && fiatCcy ? `${gotAmount} ${fiatCcy}` : gotAmount;
          setSuccessInfo({
            kind: 'ok',
            title: t('fiat.withdrawSuccess'),
            msg: t('fiat.withdrawSuccessMsg'),
            rows: [
              { label: t('fiat.youSend'), val: `${sent} ${token}`.trim() },
              { label: t('fiat.youReceive'), val: got ? String(got) : '—' },
            ],
          });
          setScreen('success');
          refresh(true);
          return true;
        } catch (e) {
          setSuccessInfo({ kind: 'err', title: t('fiat.withdrawFailed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
          return false;
        } finally {
          setBusy(false);
        }
      });
      return run.ran ? run.value : false;
    },
    [session, account, cosmosPay, network, requestSignature, refresh, exclusive, guardSession, signEnvelope, t, flash],
  );

  /** Unlink the default BlindPay fiat receiver (keeps the CosmosPay keys). */
  const unlinkReceiver = useCallback(async () => {
    if (!meta) return;
    const list = await clearReceiver(meta.id);
    setWallets(list);
    const entry = list.find((w) => w.id === meta.id);
    if (entry) setMetaState(entry);
    setReceivers([]);
    flash(t('fiat.receiverUnlinked'), 'ok');
  }, [meta, t, flash]);

  /* ----------------------------- export --------------------------- */

  /**
   * The signing gate's password check. Throttled like `unlock`, because it decrypts the
   * same vault with the same PBKDF2 derivation and is reachable from a prompt a
   * dapp can raise.
   *
   * Returns three outcomes rather than a boolean: "you are being throttled" and "that was
   * the wrong password" are different sentences, and folding the first into `false` would
   * tell a user with the right password that their password is wrong.
   */
  const checkPassword = useCallback(
    async (pwd: string): Promise<PasswordCheck> => {
      const blocked = await claimAttempt();
      if (blocked) return { ok: false, reason: 'throttled', message: blocked };
      const ok = await verifyPassword(pwd);
      if (ok) {
        await noteAttemptSuccess();
        return { ok: true };
      }
      // The guess is already counted — `claimAttempt` reserves it before the derivation.
      // `verifyPassword` folds every cause into `false`, so there is nothing to unwind
      // here; a device with no active wallet cannot reach this prompt.
      return { ok: false, reason: 'wrong', message: t('confirmSig.wrongPwd') };
    },
    [claimAttempt, t],
  );
  checkPasswordRef.current = checkPassword;

  /**
   * The same check, answered by the phone's lock screen instead of a keyboard.
   *
   * On the ladder for the reason `checkPassword` is: it opens the same vault, and a path
   * that skipped the counter would be the cheap one to hammer. What it cannot be is
   * `checkPassword` itself — what the envelope releases is a key, and there is no password
   * anywhere in this flow to hand it.
   */
  const checkKey = useCallback(
    async (vk: VaultKey): Promise<PasswordCheck> => {
      const blocked = await claimAttempt();
      if (blocked) return { ok: false, reason: 'throttled', message: blocked };
      if (await verifyVaultKey(vk)) {
        await noteAttemptSuccess();
        return { ok: true };
      }
      return { ok: false, reason: 'wrong', message: t('confirmSig.wrongPwd') };
    },
    [claimAttempt, t],
  );

  /* ---------------- unlocking with the phone's own lock ---------------- */

  /**
   * Show a device-check failure — except a dismissal. Tapping "cancel" to type the
   * password instead is a choice, and answering it with a red error line reads as
   * though something broke.
   */
  const flashDeviceAuth = useCallback(
    (failure: DeviceAuthFailure, detail: string | null = null) => {
      if (failure === 'cancelled') return;
      // The platform's sentence is appended ONLY for the unclassified bucket. Every
      // other case has copy that already says what to do, and bolting raw native
      // prose onto "no fingerprint is enrolled" would make a clear message worse.
      const base = t(deviceAuthFailureKey(failure));
      flash(failure === 'failed' && detail ? t('devAuth.errDetail', { base, msg: detail }) : base, 'err');
    },
    [flash, t],
  );

  /**
   * Lock screen: open the wallet with the device check instead of typing.
   *
   * The device check produces the vault KEY and then goes through `unlockWithKey`, which
   * still has to decrypt the vault with it and is on the same failed-attempt ladder as the
   * keyboard. Nothing here is a second way in — a stale envelope fails exactly like a typo
   * would, and this path never sees the password at all.
   */
  const unlockWithDevice = useCallback(async () => {
    const res = await deviceAuthPrivileged.deviceAuthUnlock('unlock');
    if (!res.ok) {
      flashDeviceAuth(res.failure, res.detail);
      return false;
    }
    const out = await unlockWithKey(res.vaultKey);
    if (!out.ok && out.reason === 'wrong') {
      // A key the ENVELOPE produced cannot be a typo. It failing to decrypt means the
      // envelope and the vault are out of step — a password change interrupted before the
      // re-enrolment, or storage restored from another device — and nothing about that
      // improves on the next attempt. Left standing, the button walks the owner up the
      // failed-attempt ladder with their own fingerprint until they are locked out for
      // five minutes, with "wrong password" as the only explanation.
      await deviceAuthPrivileged.disableDeviceUnlock();
      flashDeviceAuth('stale');
    }
    return out.ok;
  }, [deviceAuthPrivileged, flashDeviceAuth, unlockWithKey]);

  /**
   * Signing gate: answer the password prompt with the device check.
   *
   * Verifies the recovered KEY rather than resolving the gate outright. The gate's contract
   * is "this person can open the vault", so an envelope that no longer does must FAIL it —
   * resolving on the strength of the OS prompt alone would let a stale enrolment sign.
   *
   * Takes the id of the prompt it is answering, and captures the session epoch, because
   * everything between here and `resolveConfirm` is unbounded wall-clock: an OS sheet can
   * stay open for minutes without generating an input event, so the idle auto-lock fires
   * underneath it. Before both guards existed, the late answer resolved whatever request
   * sat at the head of the queue by then — a signature granted for something the user
   * never saw. `resolveConfirm` returning false means exactly that happened and the answer
   * was discarded.
   */
  const confirmWithDevice = useCallback(
    async (reqId: number) => {
      const epoch = sessionEpochRef.current;
      const res = await deviceAuthPrivileged.deviceAuthUnlock('sign');
      if (!res.ok) {
        flashDeviceAuth(res.failure, res.detail);
        return false;
      }
      // Through `checkKey`, which is on the same ladder as `checkPassword`: leaving this
      // outside it made it the cheap path — and, because it never called
      // `noteAttemptSuccess`, a correct biometric confirmation did not clear a backoff the
      // user had earned by mistyping.
      const check = await checkKey(res.vaultKey);
      if (!check.ok) {
        // A stale envelope, not a wrong password: the key came from the envelope, not from
        // a keyboard. Throttling is reported as itself.
        if (check.reason === 'throttled') flash(check.message, 'err');
        else flashDeviceAuth('stale');
        return false;
      }
      if (epoch !== sessionEpochRef.current) {
        // Auto-locked while the sheet was open. The gate was already answered "no" by
        // cancelPending(); say why rather than failing silently.
        flash(t('unlock.autoLocked'), 'err');
        return false;
      }
      return resolveConfirm(true, reqId);
    },
    [deviceAuthPrivileged, flashDeviceAuth, checkKey, resolveConfirm, flash, t],
  );

  /* ------------------------- opening with a passkey ------------------------- */

  /**
   * Show a passkey failure — except a dismissal, for the reason `flashDeviceAuth` gives:
   * closing the sheet to type a password instead is a choice, not a fault.
   */
  const flashPasskey = useCallback(
    (e: unknown) => {
      if (e instanceof PasskeyError) {
        if (e.reason === 'cancelled') return;
        // The browser cannot do it: say so once, and stop offering it this session.
        if (e.reason === 'unsupported' || e.reason === 'noPrf') passkey.markPasskeyUnavailable();
        flash(t(PASSKEY_FAILURE_KEYS[e.reason]), 'err');
        return;
      }
      if (e instanceof PasskeyUnlockStaleError) flash(t('passkey.err.stale'), 'err');
      else if (e instanceof BackupPasskeyError) flash(t('backup.passkeyMismatch'), 'err');
      else flash(errLine(e), 'err');
    },
    [passkey, flash, errLine, t],
  );

  /**
   * Lock screen: open a passkey device.
   *
   * The passkey produces the device password and `unlock` does the rest — the SAME path a
   * typed password takes, ladder, `convergeSeals` and all. That is the point of keeping a
   * password behind the passkey rather than a key: nothing past this line knows which door
   * was used. Only the line shown on a failure does.
   */
  const unlockWithPasskey = useCallback(async (): Promise<boolean> => {
    let opened: { password: string; secrets: PasskeySecrets };
    try {
      opened = await openDeviceWithPasskey();
    } catch (e) {
      flashPasskey(e);
      return false;
    }
    wipePasskeySecrets(opened.secrets);
    return (await unlock(opened.password, 'passkey')).ok;
  }, [unlock, flashPasskey]);

  /**
   * Signing gate: answer the prompt with the passkey.
   *
   * Through `checkPassword`, on the same ladder a typed answer is on, and with the same two
   * guards `confirmWithDevice` carries: the epoch, because the sheet can outlast the
   * auto-lock, and the prompt id, because a late answer must not grant whatever request is
   * at the head of the queue by then.
   */
  const confirmWithPasskey = useCallback(
    async (reqId: number) => {
      const epoch = sessionEpochRef.current;
      let opened: { password: string; secrets: PasskeySecrets };
      try {
        opened = await openDeviceWithPasskey();
      } catch (e) {
        flashPasskey(e);
        return false;
      }
      wipePasskeySecrets(opened.secrets);
      const check = await checkPassword(opened.password);
      if (!check.ok) {
        // A password out of the door that does not open the vault is a stale door, not a
        // typo. Throttling is reported as itself.
        flash(check.reason === 'throttled' ? check.message : t('passkey.err.stale'), 'err');
        return false;
      }
      if (epoch !== sessionEpochRef.current) {
        flash(t('unlock.autoLocked'), 'err');
        return false;
      }
      return resolveConfirm(true, reqId);
    },
    [flashPasskey, checkPassword, resolveConfirm, flash, t],
  );

  /**
   * Settings: turn the device unlock on or off.
   *
   * Gated with `force` for the same reason the manual-confirmation toggle is — it
   * decides how the wallet can be opened, so an unlocked phone in someone else's
   * hand must not be able to change it silently.
   *
   * Enabling seals the LIVE session's vault key, never anything typed into this screen:
   * that key only ever comes from a successful decrypt, so there is no path that enrols
   * something which opens nothing. It is not the password, and that is the point — the
   * envelope on disk no longer holds a string the user may also use elsewhere.
   *
   * The epoch is captured before the gate and re-checked before the seal, because the OS
   * prompt inside `enableDeviceUnlock` can outlast the auto-lock — sealing afterwards would
   * write a key out of a closure belonging to a session that has ended.
   */
  const toggleDeviceAuth = useCallback(async () => {
    if (!session) return;
    const epoch = sessionEpochRef.current;
    const method = deviceAuthPublic.deviceAuthMethod;
    const ok = await requestSignature(
      { title: t('devAuth.settingLabel'), message: t('devAuth.settingDesc', { method }) },
      true,
    );
    if (!ok) return;
    if (deviceAuthPublic.deviceAuthEnabled) {
      await deviceAuthPrivileged.disableDeviceUnlock();
      flash(t('devAuth.disabled'), 'ok');
      return;
    }
    if (epoch !== sessionEpochRef.current) {
      flash(t('unlock.autoLocked'), 'err');
      return;
    }
    const failed = await deviceAuthPrivileged.enableDeviceUnlock(session.vaultKey);
    if (failed) {
      flashDeviceAuth(failed.failure, failed.detail);
      return;
    }
    // AND AGAIN, AFTER. The check above is not the one that matters: the OS sheet lives
    // INSIDE `enableDeviceUnlock`, and the envelope is committed after it. A biometric
    // sheet generates none of the pointer/key events the idle timer watches, so the
    // 5-minute auto-lock fires underneath it and paints the unlock screen behind the sheet
    // — after which whoever is holding the phone presents THEIR finger and the app password
    // is sealed under a Keystore key bound to it. That is a permanent second door that
    // survives every later lock. Undoing the enrolment is the only correct answer, because
    // by this point it already exists.
    if (epoch !== sessionEpochRef.current) {
      await deviceAuthPrivileged.disableDeviceUnlock();
      flash(t('unlock.autoLocked'), 'err');
      return;
    }
    flash(t('devAuth.enabled', { method }), 'ok');
  }, [session, requestSignature, deviceAuthPublic, deviceAuthPrivileged, flash, flashDeviceAuth, t]);

  /* --------------------------- navigation ------------------------- */
  const navigate = useCallback((s: Screen) => {
    // The stack is pushed HERE, not inside the `setScreen` updater. React requires
    // updaters to be pure and may call one twice (StrictMode, a discarded concurrent
    // render); mutating the stack in there pushed two entries per navigation and made
    // "back" need two taps — with nothing red to show for it.
    const cur = screenRef.current;
    if (cur !== s) {
      // A terminal screen (success) starts a fresh stack: "back" from it must not
      // walk back into the flow that produced it.
      stackRef.current = SCREENS[s].terminal ? [] : [...stackRef.current, cur];
      screenRef.current = s;
      setScreen(s);
    }
    const tab = SCREENS[s].tab;
    if (tab) setTab(tab);
  }, []);

  const go = useCallback(
    (s: Screen, t?: Tab) => {
      navigate(s);
      if (t) setTab(t);
    },
    [navigate],
  );

  /**
   * Where "continue" goes from the success screen.
   *
   * In the store rather than in `Success.tsx` because it is a routing decision and
   * the screen table is the only place routing is described. The success screen is
   * shared with payments, which must keep going straight home.
   */
  const leaveSuccess = useCallback(() => {
    setSuccessInfo(null);
    // Read once, then clear: the offer is spent by LEAVING the success screen, not by the
    // offer screen's own buttons. `device-auth` is terminal with `back: 'home'`, so the
    // hardware back button ran neither button and left the flag standing — after which
    // every later success (a payment, a swap, an off-ramp) routed back into the enrolment
    // screen. Clearing it here is what makes "one-time offer" true.
    const offer = deviceAuthOffer;
    setDeviceAuthOffer(false);
    if (!session) {
      setScreen('unlock');
      return;
    }
    if (offer) {
      navigate('device-auth');
      return;
    }
    go('home', 'home');
  }, [session, deviceAuthOffer, navigate, go]);

  /**
   * Accept the one-time offer.
   *
   * Gated with `force`, exactly like the Settings toggle. This used to be ungated, on the
   * argument that the user set that very password seconds ago in this same flow — which
   * was true of the intended path and false of the one that actually existed: the flag
   * survived onboarding (see `lock()` and `leaveSuccess`), so this could be reached from a
   * payment success screen much later, on a phone somebody handed over. The flag is
   * one-shot now, and the gate stays as well: one uniform rule for "something is about to
   * change how this wallet opens" is worth more than one saved password entry.
   *
   * The epoch is captured before the gate: the OS prompt inside `enableDeviceUnlock` can
   * outlast the 5-minute auto-lock, and sealing after that would write the key out of a
   * closure belonging to a dead session.
   */
  const acceptDeviceAuthOffer = useCallback(async () => {
    setDeviceAuthOffer(false);
    if (session) {
      const epoch = sessionEpochRef.current;
      const method = deviceAuthPublic.deviceAuthMethod;
      const ok = await requestSignature(
        { title: t('devAuth.settingLabel'), message: t('devAuth.settingDesc', { method }) },
        true,
      );
      if (ok && epoch === sessionEpochRef.current) {
        const failed = await deviceAuthPrivileged.enableDeviceUnlock(session.vaultKey);
        if (failed) {
          flashDeviceAuth(failed.failure, failed.detail);
        } else if (epoch !== sessionEpochRef.current) {
          // Same window as `toggleDeviceAuth`: the OS sheet is inside `enableDeviceUnlock`
          // and the envelope commits after it, so the auto-lock can fire while the sheet is
          // up and a stranger's finger completes the enrolment. Undo it.
          await deviceAuthPrivileged.disableDeviceUnlock();
          flash(t('unlock.autoLocked'), 'err');
        } else {
          flash(t('devAuth.enabled', { method }), 'ok');
        }
      }
    }
    go('home', 'home');
  }, [session, requestSignature, deviceAuthPublic, deviceAuthPrivileged, flashDeviceAuth, flash, t, go]);

  const dismissDeviceAuthOffer = useCallback(() => {
    setDeviceAuthOffer(false);
    go('home', 'home');
  }, [go]);

  /**
   * Move this device onto a new app password — the one engine behind changing it, turning a
   * passkey on and turning it off. Each of those is "re-seal everything under a new
   * password", and they differ only in where the new password comes from and which doors
   * the cloud backups get; written three times, one copy is the one that forgets the
   * backups, or the device locks.
   *
   * WHY IT ENDS THE SESSION. `changePassword` re-seals every wallet under a new key, so a
   * patched session field would assert something true of all of them or none, and the
   * honest answer after a successful change is that this session is over: `lock()` bumps
   * the epoch, so every closure still holding the old session fails closed with
   * "auto-locked" instead of signing under a key that no longer opens anything. The person
   * opens the wallet again the new way, which also proves it works.
   *
   * THE BACKUPS FOLLOW THE PASSWORD, or the next device would need the one given up here.
   * Sealed behind the new doors BEFORE anything commits — a failure then leaves the device
   * untouched — and stored only after the commit, best-effort. Each box records its
   * wallet's ACCOUNT: for a wallet SEP-30 recovered, that is not the key's own address, and
   * a box sealed without it would be refused as a mismatch on the next device.
   *
   * `beforeCommit` / `onAbort` are for the passkey door, whose order matters: it must hold
   * the NEW password before the vault moves, or an interruption between the commit and the
   * door would leave a device sealed under a password nobody knows. `onAbort` runs only
   * when nothing was written, and takes the door back out.
   *
   * Inside `exclusive.run`, so it cannot interleave with a money flow that is mid-await
   * holding the old key. The caller has already gated it.
   */
  const rekeyDevice = useCallback(
    async (input: {
      current: string;
      next: string;
      /** The doors each backed-up wallet's new box gets. A bare string is a v2 password box. */
      doors: string | BackupDoors;
      beforeCommit?: () => Promise<void>;
      onAbort?: () => Promise<void>;
      afterCommit?: () => Promise<void>;
      /** The line shown when it worked. */
      done: string;
    }): Promise<boolean> => {
      // `ran: false` means a change is already in flight — a double tap on "save". Not an
      // error to report; the first one is still going.
      const res = await exclusive.run('password', async () => {
        let committed = false;
        try {
          const live = sessionRef.current;
          // A wallet whose backup has an email-recovery door gets a second box with a NEW
          // one beside the plain box: its halves are filed only after the commit, and if
          // that fails the plain box goes up instead — never a door the servers cannot open.
          const backups: {
            id: string;
            name: string;
            secret: string;
            account: string;
            box: string;
            recovery: { email: string; key: Uint8Array; box: string } | null;
            /** The ledger a re-keyed `account` lists this key on — see `lib/accountAddress.ts`. */
            ledger: LedgerName | null;
          }[] = [];
          if (live) {
            for (const w of wallets) {
              if (!w.cloudBackup) continue;
              const secret = await openVault(w.id, live.vaultKey);
              const recoveryKey = w.backupRecoveryEmail ? newRecoveryKey() : null;
              backups.push({
                id: w.id,
                recovery:
                  recoveryKey && w.backupRecoveryEmail
                    ? {
                        email: w.backupRecoveryEmail,
                        key: recoveryKey,
                        box: await sealBackup(
                          secret,
                          { ...(typeof input.doors === 'string' ? { password: input.doors } : input.doors), recovery: recoveryKey },
                          w.publicKey,
                          w.rekey?.passphrase,
                        ),
                      }
                    : null,
                name: w.name,
                secret: secret.secret,
                account: w.publicKey,
                ledger: w.rekey ? ledgerName(w.rekey.passphrase) : null,
                box: await sealBackup(secret, input.doors, w.publicKey, w.rekey?.passphrase),
              });
            }
          }
          await input.beforeCommit?.();
          // The re-wrap closure is injected rather than imported by lib/vault.ts: it needs
          // an OS prompt and the copy that goes on it, neither of which belongs in a vault
          // function. Every enrolled wallet raises its own prompt — they are separate
          // Keystore entries, and there is no batch form.
          const { deviceAuthDropped } = await changePassword(input.current, input.next, {
            reenrolDeviceAuth: deviceAuthPrivileged.reenrolForPasswordChange,
          });
          committed = true;
          await input.afterCommit?.();
          if (deviceAuthDropped.length) {
            flash(t('devAuth.droppedOnPwdChange', { names: deviceAuthDropped.map((w) => w.name).join(', ') }), 'info');
          } else {
            flash(input.done, 'ok');
          }
          // Past the commit, and best-effort: the local change is done and must not be
          // reported as failed because the network was. The toast says which backup still
          // opens the old way — last, so it is the one left on screen.
          const stale: string[] = [];
          for (const b of backups) {
            try {
              let box = b.box;
              if (b.recovery) {
                let filed = false;
                try {
                  if (await recoveryReachable(network)) {
                    await fileBackupRecovery(network, b.secret, b.account, b.recovery.email, b.recovery.key);
                    filed = true;
                  }
                } catch (e) {
                  reportError(EVENT.backupUpdateFailed, e);
                } finally {
                  b.recovery.key.fill(0);
                }
                if (filed) box = b.recovery.box;
                else setWallets(await updateWalletMeta(b.id, { backupRecoveryEmail: undefined }));
              }
              await storeBackupBox({
                secret: b.secret,
                box,
                account: b.account,
                network: b.ledger,
                accessKey: await warmPublicKey(networkEnv(network)),
              });
            } catch (e) {
              stale.push(b.name);
              reportError(EVENT.backupUpdateFailed, e);
            }
          }
          if (stale.length) flash(t('backup.staleAfterPwd', { names: stale.join(', ') }), 'err');
          // Last, and only on success: everything above must have committed before the
          // session it belonged to is torn down.
          lock();
          return true;
        } catch (e) {
          flash(errLine(e), 'err');
          // A failure PAST the commit is not recoverable and not survivable by this
          // session: some wallets are on the new password and the session's key is true of
          // neither set. Carrying on would let `switchWallet` open a wallet with the wrong
          // key, `saveCosmosPay` re-seal a bearer credential under it, and a device
          // enrolment capture it. `lock()` bumps the epoch, so every closure still holding
          // this session fails closed; the person opens it again whichever way works.
          // A failure BEFORE the commit left the device untouched, so the session stands —
          // and whatever `beforeCommit` wrote comes back out.
          if (e instanceof PasswordChangeCommitError || committed) lock();
          else await input.onAbort?.().catch(() => undefined);
          return false;
        }
      });
      await passkey.refreshPasskey();
      return res.ran && res.value;
    },
    [exclusive, deviceAuthPrivileged, wallets, network, passkey, flash, errLine, lock, t],
  );

  /**
   * Change the app password — a password device only; a passkey device has none to change.
   *
   * A store action, not a direct `lib/vault.changePassword` call from the settings form.
   * That call was the one mutation a `.tsx` made that invalidated store state, and nothing
   * put the state back: the session kept the superseded secret, which `switchWallet`,
   * `saveCosmosPay` and `toggleDeviceAuth` all went on using. See `rekeyDevice`.
   *
   * `force`-gated: it changes how the wallet opens.
   */
  const changeAppPassword = useCallback(
    async (current: string, next: string): Promise<boolean> => {
      // Re-checked here, not only in the form. The screen's own rule was length-only while
      // onboarding demanded 8 + upper + lower + digit, so a wallet created under the strict
      // rule could be re-sealed under `aaaaaaaa` — along with every device-lock envelope.
      // A disabled button is a hint; this is the enforcement point.
      if (!appPasswordOk(next)) {
        flash(t('pwd.weak', { n: MIN_APP_PWD_LEN }), 'err');
        return false;
      }
      const ok = await requestSignature(
        { title: t('settings.changePwd'), message: t('settings.changePwdConfirm') },
        true,
      );
      if (!ok) return false;
      return rekeyDevice({ current, next, doors: next, done: t('settings.pwdUpdated') });
    },
    [requestSignature, rekeyDevice, flash, t],
  );

  /**
   * Open this device with a passkey from now on, instead of the password.
   *
   * What changes is the app password: it becomes a generated one nobody types, sealed under
   * the new passkey (see `lib/passkeyUnlock.ts`). ONE sheet — creating the passkey — yields
   * both of its secrets, so the cloud backups get a passkey door in the same pass, and keep
   * a door for the password typed here: the person still knows it, and it is how they
   * restore on a device that cannot use passkeys.
   *
   * The typed password is checked FIRST, on the attempt ladder, before any sheet: a
   * passkey must not be minted for someone who cannot open the wallet. That check is also
   * the gate — a second confirmation here would ask for the same password twice.
   */
  const switchToPasskey = useCallback(
    async (current: string): Promise<boolean> => {
      if (!session || !meta) return false;
      const check = await checkPassword(current);
      if (!check.ok) {
        flash(check.message, 'err');
        return false;
      }
      let secrets: PasskeySecrets;
      try {
        secrets = await createPasskey({ name: meta.email || meta.name, displayName: meta.name });
      } catch (e) {
        flashPasskey(e);
        return false;
      }
      const next = newDevicePassword();
      try {
        return await rekeyDevice({
          current,
          next,
          doors: { password: current, passkey: { id: secrets.credentialId, secret: secrets.backup } },
          beforeCommit: () => enrolPasskeyUnlock(secrets, next),
          onAbort: dropPasskeyUnlock,
          done: t('passkey.enabled'),
        });
      } finally {
        wipePasskeySecrets(secrets);
      }
    },
    [session, meta, checkPassword, rekeyDevice, flashPasskey, flash, t],
  );

  /**
   * Go back to a typed password on this device.
   *
   * The passkey sheet that produces the device password IS the gate: it is the same proof
   * of presence the signing gate would ask for, and a second one on top would be two sheets
   * for one decision. The backups become plain password boxes again — the passkey door goes
   * with the passkey device, so a box never names a door the person has walked away from.
   */
  const switchToPassword = useCallback(
    async (next: string): Promise<boolean> => {
      if (!session) return false;
      if (!appPasswordOk(next)) {
        flash(t('pwd.weak', { n: MIN_APP_PWD_LEN }), 'err');
        return false;
      }
      let opened: { password: string; secrets: PasskeySecrets };
      try {
        opened = await openDeviceWithPasskey();
      } catch (e) {
        flashPasskey(e);
        return false;
      }
      wipePasskeySecrets(opened.secrets);
      return rekeyDevice({
        current: opened.password,
        next,
        doors: next,
        // After the commit: until then the vault is still sealed under the password the
        // door holds, and dropping it first would strand a device that failed mid-change.
        afterCommit: dropPasskeyUnlock,
        done: t('passkey.disabled'),
      });
    },
    [session, rekeyDevice, flashPasskey, flash, t],
  );

  /**
   * Give THIS wallet's backup an email-recovery door, from Settings — for a wallet backed up
   * before the door existed, which gets one otherwise only at its next restore.
   *
   * The box is re-sealed behind this device's doors — the password (or, on a passkey device,
   * the password its passkey holds plus that passkey) and the new recovery door — exactly as
   * a password change re-seals it. The halves are filed first and the box uploaded after, so
   * a box never names a key the servers do not hold.
   */
  const enableBackupRecovery = useCallback(
    async (password?: string): Promise<boolean> => {
      const live = sessionRef.current;
      // The canonical account: a backup is filed under it whatever network is active.
      const canonical = metaEntry;
      if (!live || !canonical?.cloudBackup) return false;
      const email = canonical.email.trim().toLowerCase();
      if (!email) {
        flash(t('recovery.error.noEmail'), 'err');
        return false;
      }
      let doors: BackupDoors;
      let secrets: PasskeySecrets | null = null;
      if (passkey.passkeyUnlock) {
        try {
          const opened = await openDeviceWithPasskey();
          secrets = opened.secrets;
          doors = { password: opened.password, passkey: { id: secrets.credentialId, secret: secrets.backup } };
        } catch (e) {
          flashPasskey(e);
          return false;
        }
      } else {
        const check = await checkPassword(password ?? '');
        if (!check.ok) {
          flash(check.message, 'err');
          return false;
        }
        doors = { password: password as string };
      }
      setBusy(true);
      try {
        if (!(await recoveryReachable(network))) {
          flash(t('recovery.error.unreachable'), 'err');
          return false;
        }
        const vaulted = await openVault(canonical.id, live.vaultKey);
        const recovery = await fileRecovery(vaulted.secret, canonical.publicKey, email);
        if (!recovery) {
          flash(t('backupRecovery.failed'), 'err');
          return false;
        }
        let box: string;
        try {
          box = await sealBackup(vaulted, { ...doors, recovery }, canonical.publicKey, canonical.rekey?.passphrase);
        } finally {
          recovery.fill(0);
        }
        await storeBackupBox({
          secret: vaulted.secret,
          box,
          account: canonical.publicKey,
          network: canonical.rekey ? ledgerName(canonical.rekey.passphrase) : null,
          accessKey: await warmPublicKey(networkEnv(network)),
        });
        await noteBackupRecovery(canonical.id, email);
        flash(t('backupRecovery.enabled', { email }), 'ok');
        return true;
      } catch (e) {
        reportError(EVENT.backupUpdateFailed, e);
        flash(errLine(e), 'err');
        return false;
      } finally {
        if (secrets) wipePasskeySecrets(secrets);
        setBusy(false);
      }
    },
    [metaEntry, passkey, network, checkPassword, fileRecovery, noteBackupRecovery, flashPasskey, errLine, flash, t],
  );

  /** Open the liquidity deposit form, optionally preset with a pair (e.g. from the explorer). */
  const openDeposit = useCallback(
    (presetA?: SwapAsset, presetB?: SwapAsset) => {
      setLpTarget({ mode: 'deposit', presetA, presetB });
      navigate('lp-deposit');
    },
    [navigate],
  );

  /** Open the liquidity withdraw form for a specific position. */
  const openWithdraw = useCallback(
    (position: LiquidityPosition) => {
      setLpTarget({ mode: 'withdraw', position });
      navigate('lp-withdraw');
    },
    [navigate],
  );

  /**
   * Sign a raw XDR the user pasted (the manual "sign transaction" screen).
   *
   * Exists so the secret never has to leave the store: the screen asks for a
   * signature, it does not get handed the key. The envelope is decoded and checked
   * first — a pasted XDR is exactly as untrusted as one from a dapp.
   *
   * The gate is `force`d, and this is the one screen where that is not belt-and-braces.
   * `reviewTx` checks the source account and nothing else: a manual signature is
   * deliberately allowed to carry the operations `assertSafeToSign` refuses, `setOptions`
   * — adding a signer to the account — among them. That makes the human confirmation the
   * ONLY check standing between a pasted envelope and account takeover, and an ungated
   * `requestSignature` resolves instantly whenever manual confirmations are off. It is
   * also reachable from a SEP-7 link, so the envelope need not have been typed by the
   * user at all. The epoch is captured for the same reason every money flow captures it.
   */
  const signRawXdr = useCallback(
    async (xdr: string): Promise<string | null> => {
      if (!session) return null;
      const epoch = sessionEpochRef.current;
      const ok = await requestSignature(
        { title: t('confirmSig.signTitle'), message: t('confirmSig.signMsg') },
        true,
      );
      if (!ok) return null;
      guardSession(epoch);
      // Review only — a manual signature is deliberately allowed to carry operations
      // the automated flows refuse, but it must still be OUR account and decodable.
      const review = reviewTx(network, xdr.trim());
      if (review.source !== session.publicKey) {
        throw new Error(t('sign.foreignSource'));
      }
      return signEnvelope(xdr.trim());
    },
    [session, network, requestSignature, guardSession, signEnvelope, t],
  );

  /**
   * Reveal the backup material, password-gated at the moment of use.
   * The Export screen used to read `store.session.secret` directly, which meant the
   * secret had to be a readable field on an object every screen holds.
   *
   * Throttled, and this is the path where it matters most: a correct guess here returns the
   * SEED PHRASE, so an unthrottled loop over the vault was the cheapest way to turn a
   * borrowed phone into a permanent loss of funds. The wrong-password answer stays `null`,
   * a blocked one flashes the wait — the screen must not read "wrong password" at someone
   * whose password is right.
   */
  const revealBackup = useCallback(
    async (password: string): Promise<{ secret: string; mnemonic: string | null } | null> => {
      if (!meta) return null;
      const blocked = await claimAttempt();
      if (blocked) {
        flash(blocked, 'err');
        return null;
      }
      try {
        const v = await unlockWallet(meta.id, password);
        await noteAttemptSuccess();
        return { secret: v.secret, mnemonic: v.mnemonic };
      } catch (err) {
        // Counted by `claimAttempt` before the derivation; released again when the throw
        // was a missing or corrupt vault rather than a wrong guess.
        await forgetAttempt(err);
        return null;
      }
    },
    [meta, claimAttempt, forgetAttempt, flash],
  );

  /* ----------------------------- sign-in ----------------------------- */
  /* Down here rather than beside `landSignedInWallet` because these navigate, and
     `navigate` and `checkPassword` are declared above this and below that. */

  /**
   * Turn a finished sign-in into the next screen.
   *
   * With a backup, its password restores it. Without one, a first run chooses a password on
   * the password screen (which also seals the new backup), and an unlocked device confirms
   * the one it already has.
   */
  const routeSignIn = useCallback(
    (ready: SignInReady | null, purpose: SignInPurpose): void => {
      if (!ready) return;
      setSignInDraft({ ready, purpose, replace: false });
      navigate(ready.backup || purpose === 'add' ? 'sign-in-password' : 'password');
    },
    [navigate],
  );

  const { startProvider, submitCode, resumeSignIn: resumeSignInRaw, startEmail, cancelSignIn: cancelSignInRaw } = signIn;

  const signInWith = useCallback(
    async (provider: SignInProvider, purpose: SignInPurpose) => routeSignIn(await startProvider(provider), purpose),
    [startProvider, routeSignIn],
  );

  const submitSignInCode = useCallback(
    async (code: string, purpose: SignInPurpose) => {
      if (!isAccessCode(code)) return;
      routeSignIn(await submitCode(code), purpose);
    },
    [submitCode, routeSignIn],
  );

  const resumeSignIn = useCallback(
    async (purpose: SignInPurpose) => routeSignIn(await resumeSignInRaw(), purpose),
    [resumeSignInRaw, routeSignIn],
  );

  /** Drop a finished sign-in and anything still in flight. */
  const cancelSignIn = useCallback(() => {
    cancelSignInRaw();
    setSignInDraft(null);
  }, [cancelSignInRaw]);

  /**
   * What happens once a sign-in has put a wallet on the device, whichever door opened it.
   *
   * One copy for the password and the passkey paths: the screen a finished sign-in lands
   * on is a routing decision about WHY it was started, and has nothing to do with how the
   * backup was opened.
   */
  const settleSignIn = useCallback(
    async (draft: SignInDraft, entry: WalletEntry): Promise<void> => {
      setSignInDraft(null);
      if (draft.purpose === 'onboarding') {
        report(EVENT.walletCreated, { category: 'lifecycle', props: { added: false, signIn: true, restored: true } });
        setSuccessInfo({
          title: t('success.welcome', { name: entry.name }),
          msg: t('success.protected'),
          rows: [
            { label: t('success.user'), val: entry.name },
            { label: t('success.status'), val: t('success.encrypted') },
          ],
        });
        setDeviceAuthOffer(deviceAuthPublic.deviceAuthPossible && deviceAuthPublic.deviceAuthAvailable);
        setScreen('success');
      } else if (draft.purpose === 'add') {
        setAddingWallet(false);
        setTab('home');
        setScreen('home');
        flash(t('toast.walletActive', { name: entry.name }), 'ok');
      }
    },
    [deviceAuthPublic, flash, t],
  );

  /** The consents a sign-in lands with: asked on a first run, already answered otherwise. */
  const signInConsents = useCallback(
    (draft: SignInDraft): ConsentAnswers =>
      draft.purpose === 'onboarding'
        ? { metricsOptIn: draftMetricsOptIn, promoOptIn: draftPromoOptIn }
        : { metricsOptIn: telemetryEnabled(), promoOptIn: meta?.promoOptIn ?? false },
    [draftMetricsOptIn, draftPromoOptIn, meta],
  );

  /**
   * Finish a sign-in with a password: restore its backup, or create a new wallet for it on
   * a device that already has one.
   *
   * `usePasskey` is the one-step upgrade a first-run restore offers: the password opens the
   * backup as always, and then — in the same flow, one more sheet — a new passkey takes the
   * device password's place and the backup gains a passkey door beside the password one.
   * The next device restores with a fingerprint. A dismissed sheet is not a failure: the
   * restore simply finishes the password way.
   *
   * A first run with nothing to restore does not come through here — it chooses its
   * password on the password screen and ends in `finishOnboarding`.
   */
  const completeSignIn = useCallback(
    async (password: string, opts: { usePasskey?: boolean } = {}): Promise<boolean> => {
      const draft = signInDraft;
      if (!draft) return false;
      const restoring = !!draft.ready.backup && !draft.replace;
      if (!restoring && draft.purpose === 'onboarding') return false;
      const live = sessionRef.current;
      if (draft.purpose !== 'onboarding' && !live) return false;
      // Landing on the live session's key: captured now, checked right before the landing.
      const epoch = draft.purpose === 'onboarding' ? undefined : sessionEpochRef.current;
      const consents = signInConsents(draft);

      setBusy(true);
      let door: { secrets: PasskeySecrets; devicePassword: string } | null = null;
      let landed = false;
      try {
        let entry: WalletEntry | null;
        if (restoring) {
          const backup = draft.ready.backup!;
          // On the ladder: this turns a typed string into a seed, like every path that does.
          const blocked = await claimAttempt();
          if (blocked) {
            flash(blocked, 'err');
            return false;
          }
          let secret: Awaited<ReturnType<typeof openBackup>>;
          try {
            secret = await openBackup(backup.box, password, backup.stellarAddress);
          } catch (e) {
            // Only a wrong password is a guess; a box that will not parse, or opens to a
            // different wallet than it was filed as, is nobody's typo.
            await forgetAttempt(e);
            flash(e instanceof WrongPasswordError ? t('backup.wrongPassword') : (e as Error).message, 'err');
            return false;
          }
          await noteAttemptSuccess();

          // The upgrade, AFTER the password proved itself and BEFORE the server is told:
          // the new box goes up with `finishSignIn`, in the same request.
          let upgradedBox: string | undefined;
          if (opts.usePasskey && draft.purpose === 'onboarding') {
            try {
              const secrets = await createPasskey({
                name: draft.ready.identity.email,
                displayName: draft.ready.identity.name?.trim() || draft.ready.identity.email,
              });
              door = { secrets, devicePassword: newDevicePassword() };
              upgradedBox = await sealBackup(
                { secret: secret.secret, mnemonic: secret.mnemonic },
                { password, passkey: { id: secrets.credentialId, secret: secrets.backup } },
                backup.stellarAddress,
                secret.rekeyedOn,
              );
            } catch (e) {
              // Dismissed or unsupported: finish with the password. Only a real failure says so.
              flashPasskey(e);
              if (door) wipePasskeySecrets(door.secrets);
              door = null;
            }
          }

          // A box from before Argon2id (v2/v3, PBKDF2) is re-sealed as v4 on the way through,
          // with the password that just opened it — in the same request, like the passkey
          // upgrade. Never a box with a passkey door: this password cannot reproduce it.
          if (!upgradedBox && backupNeedsUpgrade(backup.box)) {
            upgradedBox = await sealBackup(
              { secret: secret.secret, mnemonic: secret.mnemonic },
              password,
              backup.stellarAddress,
              secret.rekeyedOn,
            );
          }

          // An email-recovery door for a backup that has none, on the SAME data key — so a
          // passkey door another device filed survives. Best effort, like the upgrades above:
          // a box this cannot extend (a v3 one with a passkey door) keeps the doors it has.
          let recoveryFiled = false;
          if (!backupDoors(upgradedBox ?? backup.box).recovery) {
            const recovery = await fileRecovery(secret.secret, backup.stellarAddress, draft.ready.identity.email);
            if (recovery) {
              try {
                upgradedBox = await addRecoveryDoor(upgradedBox ?? backup.box, password, recovery);
                recoveryFiled = true;
              } catch (e) {
                reportError(EVENT.backupUpdateFailed, e);
              } finally {
                recovery.fill(0);
              }
            }
          }

          const res = await finishSignIn({
            sessionToken: draft.ready.sessionToken,
            email: draft.ready.identity.email,
            secret: secret.secret,
            // The address the box was filed under, which for a RECOVERED wallet is not the
            // key's own — see `finishSignIn`. For every other wallet the two are equal and
            // passing it changes nothing.
            account: backup.stellarAddress,
            network: secret.rekeyedOn ? ledgerName(secret.rekeyedOn) : null,
            ...(upgradedBox ? { backup: upgradedBox } : {}),
            accessKey: await warmPublicKey(networkEnv(network)),
          });
          if (res.status !== 'ready') throw new Error(t('backup.conflict'));
          // On a first run the backup's password becomes this device's password too, so the
          // person still has one password — unless they took the passkey, in which case the
          // device runs on a generated one the passkey holds. An unlocked device keeps its own.
          let vk: VaultKey;
          if (draft.purpose !== 'onboarding') vk = live!.vaultKey;
          else if (door) {
            await enrolPasskeyUnlock(door.secrets, door.devicePassword);
            vk = await deriveVaultKey(door.devicePassword, newKdfParams());
          } else vk = await deriveVaultKey(password, newKdfParams());
          if (draft.purpose === 'onboarding') setTelemetryEnabled(consents.metricsOptIn);
          entry = await landSignedInWallet({
            // Only the two fields the vault stores: the box may also carry the account a
            // recovered wallet recorded, and that belongs on the WalletEntry (as its
            // `publicKey`, just below), not inside the sealed secret this device writes.
            secret: { secret: secret.secret, mnemonic: secret.mnemonic },
            publicKey: backup.stellarAddress,
            rekey: rekeyOfBackup(secret),
            ready: draft.ready,
            account: { keys: res.keys, organizationId: res.organizationId },
            vk,
            consents,
            epoch,
          });
          if (entry && recoveryFiled) await noteBackupRecovery(entry.id, draft.ready.identity.email);
          report(EVENT.backupRestored, { category: 'lifecycle', props: { purpose: draft.purpose, passkey: !!door } });
          await restoreOtherBackups({
            ready: draft.ready,
            key: password,
            vk,
            primary: entry,
            account: { keys: res.keys, organizationId: res.organizationId },
            consents,
          });
        } else {
          // A NEW wallet on a device that already has a password: that password seals the
          // backup too, so the person keeps one. Proven first — a typo here would lock them
          // out of their own backup on the next device, with nothing to say why.
          const check = await checkPassword(password);
          if (!check.ok) {
            flash(check.message, 'err');
            return false;
          }
          entry = await createFromSignIn(draft, password, live!.vaultKey, consents, epoch);
          if (!entry) {
            setSignInDraft(null);
            return false;
          }
        }
        landed = true;
        await settleSignIn(draft, entry);
        return true;
      } catch (e) {
        reportError(EVENT.signInFailed, e, { purpose: draft.purpose, step: 'finish' });
        flash(errLine(e), 'err');
        return false;
      } finally {
        if (door) {
          wipePasskeySecrets(door.secrets);
          // A door written for a wallet that never landed opens nothing; take it back out.
          if (!landed) await dropPasskeyUnlock().catch(() => undefined);
        }
        await passkey.refreshPasskey();
        setBusy(false);
      }
    },
    [
      signInDraft,
      network,
      signInConsents,
      claimAttempt,
      forgetAttempt,
      checkPassword,
      landSignedInWallet,
      createFromSignIn,
      settleSignIn,
      fileRecovery,
      noteBackupRecovery,
      flashPasskey,
      passkey,
      errLine,
      flash,
      t,
    ],
  );

  /**
   * Finish a sign-in with a passkey instead of a password.
   *
   * RESTORE — the backup has a passkey door: ONE sheet, restricted to the credentials the
   * box names, yields the backup secret and this device's unlock secret together. On a
   * first run the device then runs on a generated password that same passkey holds, so the
   * person never typed anything. On an unlocked device the wallet lands on the session's
   * key, whatever kind of device it is.
   *
   * PROTECT — a new wallet on an unlocked PASSKEY device: the device's own passkey opens
   * the device (proving the person is here, as the typed password does on a password
   * device) and gives the new backup its passkey door.
   *
   * No attempt ladder on either: nothing is typed, and a passkey that does not match is a
   * `BackupPasskeyError` or a stale door, never a guess.
   */
  /**
   * Restore the signed-in account's backup with the key the two recovery servers returned,
   * and give it a NEW password — the whole point: the old one is forgotten. The seed comes
   * back as it was, so the address (on every chain) is the same one; nothing changes on the
   * ledger. The recovery door stays: its halves still open it next time.
   */
  const recoverBackup = useCallback(
    async (password: string): Promise<boolean> => {
      const draft = signInDraft;
      const backup = draft?.ready.backup;
      const held = backupRecoveryKeyRef.current;
      if (!draft || !backup || !held || held.key !== draft.ready.sessionToken) return false;
      const live = sessionRef.current;
      if (draft.purpose !== 'onboarding' && !live) return false;
      if (!appPasswordOk(password)) {
        flash(t('pwd.weak', { n: MIN_APP_PWD_LEN }), 'err');
        return false;
      }
      const epoch = draft.purpose === 'onboarding' ? undefined : sessionEpochRef.current;
      const consents = signInConsents(draft);

      const outcome = await exclusive.run('recovery', async () => {
        setBusy(true);
        try {
          const secret = await openBackup(backup.box, { recovery: held.value }, backup.stellarAddress);
          const box = await resetBackupPassword(backup.box, held.value, password);
          const res = await finishSignIn({
            sessionToken: draft.ready.sessionToken,
            email: draft.ready.identity.email,
            secret: secret.secret,
            account: backup.stellarAddress,
            network: secret.rekeyedOn ? ledgerName(secret.rekeyedOn) : null,
            backup: box,
            accessKey: await warmPublicKey(networkEnv(network)),
          });
          if (res.status !== 'ready') throw new Error(t('backup.conflict'));
          // On a first run the new password is this device's too, exactly as a restore does.
          const vk = draft.purpose === 'onboarding' ? await deriveVaultKey(password, newKdfParams()) : live!.vaultKey;
          if (draft.purpose === 'onboarding') setTelemetryEnabled(consents.metricsOptIn);
          const entry = await landSignedInWallet({
            secret: { secret: secret.secret, mnemonic: secret.mnemonic },
            publicKey: backup.stellarAddress,
            rekey: rekeyOfBackup(secret),
            ready: draft.ready,
            account: { keys: res.keys, organizationId: res.organizationId },
            vk,
            consents,
            epoch,
          });
          report(EVENT.backupRestored, { category: 'lifecycle', props: { purpose: draft.purpose, emailRecovery: true } });
          held.value.fill(0);
          backupRecoveryKeyRef.current = null;
          setBackupRecoverable(null);
          setRecoverable(null);
          recoveryProofRef.current = null;
          await settleSignIn(draft, entry);
          flash(t('backup.recoveredByEmail'), 'ok');
          return true;
        } catch (e) {
          reportError(EVENT.signInFailed, e, { purpose: draft.purpose, step: 'backup-recovery' });
          flash(errLine(e), 'err');
          return false;
        } finally {
          setBusy(false);
        }
      });
      return outcome.ran ? outcome.value : false;
    },
    [signInDraft, network, exclusive, signInConsents, landSignedInWallet, settleSignIn, errLine, flash, t],
  );

  const completeSignInWithPasskey = useCallback(async (): Promise<boolean> => {
    const draft = signInDraft;
    if (!draft) return false;
    const restoring = !!draft.ready.backup && !draft.replace;
    if (!restoring && draft.purpose === 'onboarding') return false;
    const live = sessionRef.current;
    if (draft.purpose !== 'onboarding' && !live) return false;
    const epoch = draft.purpose === 'onboarding' ? undefined : sessionEpochRef.current;
    const consents = signInConsents(draft);

    setBusy(true);
    let secrets: PasskeySecrets | null = null;
    let enrolled = false;
    try {
      let entry: WalletEntry | null;
      if (restoring) {
        const backup = draft.ready.backup!;
        const ids = backupDoors(backup.box).passkeys;
        if (!ids.length) {
          flash(t('backup.passkeyMismatch'), 'err');
          return false;
        }
        try {
          secrets = await getPasskeySecrets(ids);
        } catch (e) {
          flashPasskey(e);
          return false;
        }
        const secret = await openBackup(
          backup.box,
          { passkey: { id: secrets.credentialId, secret: secrets.backup } },
          backup.stellarAddress,
        );
        // The same email-recovery door the password restore adds, opened with this passkey.
        let passkeyBox: string | undefined;
        if (!backupDoors(backup.box).recovery) {
          const recovery = await fileRecovery(secret.secret, backup.stellarAddress, draft.ready.identity.email);
          if (recovery) {
            try {
              passkeyBox = await addRecoveryDoor(
                backup.box,
                { passkey: { id: secrets.credentialId, secret: secrets.backup } },
                recovery,
              );
            } catch (e) {
              reportError(EVENT.backupUpdateFailed, e);
            } finally {
              recovery.fill(0);
            }
          }
        }
        const res = await finishSignIn({
          sessionToken: draft.ready.sessionToken,
          email: draft.ready.identity.email,
          secret: secret.secret,
          account: backup.stellarAddress,
          network: secret.rekeyedOn ? ledgerName(secret.rekeyedOn) : null,
          ...(passkeyBox ? { backup: passkeyBox } : {}),
          accessKey: await warmPublicKey(networkEnv(network)),
        });
        if (res.status !== 'ready') throw new Error(t('backup.conflict'));
        let vk: VaultKey;
        if (draft.purpose === 'onboarding') {
          // The door BEFORE the vault: a wallet sealed under a generated password with no
          // door beside it is a wallet nobody can open.
          const devicePassword = newDevicePassword();
          await enrolPasskeyUnlock(secrets, devicePassword);
          enrolled = true;
          vk = await deriveVaultKey(devicePassword, newKdfParams());
          setTelemetryEnabled(consents.metricsOptIn);
        } else vk = live!.vaultKey;
        entry = await landSignedInWallet({
          secret: { secret: secret.secret, mnemonic: secret.mnemonic },
          publicKey: backup.stellarAddress,
          rekey: rekeyOfBackup(secret),
          ready: draft.ready,
          account: { keys: res.keys, organizationId: res.organizationId },
          vk,
          consents,
          epoch,
        });
        if (entry && passkeyBox) await noteBackupRecovery(entry.id, draft.ready.identity.email);
        report(EVENT.backupRestored, { category: 'lifecycle', props: { purpose: draft.purpose, passkey: true } });
        await restoreOtherBackups({
          ready: draft.ready,
          key: { passkey: { id: secrets.credentialId, secret: secrets.backup } },
          vk,
          primary: entry,
          account: { keys: res.keys, organizationId: res.organizationId },
          consents,
        });
      } else {
        let opened: { password: string; secrets: PasskeySecrets };
        try {
          opened = await openDeviceWithPasskey();
        } catch (e) {
          flashPasskey(e);
          return false;
        }
        secrets = opened.secrets;
        const check = await checkPassword(opened.password);
        if (!check.ok) {
          flash(check.reason === 'throttled' ? check.message : t('passkey.err.stale'), 'err');
          return false;
        }
        entry = await createFromSignIn(
          draft,
          { passkey: { id: secrets.credentialId, secret: secrets.backup } },
          live!.vaultKey,
          consents,
          epoch,
        );
        if (!entry) {
          setSignInDraft(null);
          return false;
        }
      }
      enrolled = false; // landed: the door stays
      await settleSignIn(draft, entry);
      return true;
    } catch (e) {
      reportError(EVENT.signInFailed, e, { purpose: draft.purpose, step: 'finish', passkey: true });
      flashPasskey(e);
      return false;
    } finally {
      if (secrets) wipePasskeySecrets(secrets);
      if (enrolled) await dropPasskeyUnlock().catch(() => undefined);
      await passkey.refreshPasskey();
      setBusy(false);
    }
  }, [
    signInDraft,
    network,
    signInConsents,
    checkPassword,
    landSignedInWallet,
    createFromSignIn,
    settleSignIn,
    fileRecovery,
    noteBackupRecovery,
    flashPasskey,
    passkey,
    flash,
    t,
  ]);

  /**
   * A first wallet protected by a passkey instead of a password. One sheet.
   *
   * The passkey is created first, because it is the step the person can decline — nothing
   * exists yet, so declining costs nothing. Then the door (the generated device password
   * under the passkey's unlock secret) BEFORE the vault, for the reason
   * `completeSignInWithPasskey` gives; and `finishOnboarding` does the rest exactly as it
   * would for a typed password, except that the cloud backup gets the passkey's door.
   *
   * First run only: on a device that already holds wallets, a new password would split the
   * device between two passwords, and adding a wallet reuses the session's key instead.
   */
  const finishOnboardingWithPasskey = useCallback(async (): Promise<boolean> => {
    if (session || wallets.length > 0) return false;
    const email = signInDraft?.ready.identity.email ?? draftEmail.trim();
    const name = signInDraft?.ready.identity.name?.trim() || draftName.trim() || email.split('@')[0] || 'Cosmos';
    let secrets: PasskeySecrets;
    try {
      secrets = await createPasskey({ name: email || name, displayName: name });
    } catch (e) {
      flashPasskey(e);
      return false;
    }
    const devicePassword = newDevicePassword();
    let ok = false;
    try {
      await enrolPasskeyUnlock(secrets, devicePassword);
      ok = await finishOnboarding(devicePassword, secrets);
      return ok;
    } finally {
      wipePasskeySecrets(secrets);
      if (!ok) await dropPasskeyUnlock().catch(() => undefined);
      await passkey.refreshPasskey();
    }
  }, [session, wallets, signInDraft, draftEmail, draftName, finishOnboarding, flashPasskey, passkey]);

  /** `revealBackup`, answered by the passkey on a passkey device. One sheet. */
  const revealBackupWithPasskey = useCallback(async () => {
    let opened: { password: string; secrets: PasskeySecrets };
    try {
      opened = await openDeviceWithPasskey();
    } catch (e) {
      flashPasskey(e);
      return null;
    }
    wipePasskeySecrets(opened.secrets);
    return revealBackup(opened.password);
  }, [revealBackup, flashPasskey]);

  /**
   * Give up the backup and make a new wallet instead — the person forgot the password that
   * opens it. The screen has already shown them what that costs; this only records the
   * choice. A first run chooses the new password on the password screen; an unlocked device
   * confirms its own where it is.
   */
  const startOverSignIn = useCallback(() => {
    if (!signInDraft) return;
    setSignInDraft({ ...signInDraft, replace: true });
    if (signInDraft.purpose === 'onboarding') navigate('password');
  }, [signInDraft, navigate]);

  /** What a dynamic `back` entry in the screen table may depend on. */
  const backContext = useCallback(
    (): BackContext => ({
      hasSession: !!session,
      tab,
      addingWallet,
      hasDraftMnemonic: draftHasMnemonic && !!draftMnemonic,
      hasSignInDraft: !!signInDraft,
    }),
    [session, tab, addingWallet, draftHasMnemonic, draftMnemonic, signInDraft],
  );

  /**
   * Go back: pop the navigation stack, or fall back to the screen table.
   * Returns `false` when there is nowhere left to go (the shell should exit the app
   * on native — see WalletApp's hardware-button handler).
   */
  const goBack = useCallback((): boolean => {
    // Leaving the success card or the offer screen SPENDS the one-time enrolment offer,
    // however it is left. `leaveSuccess` cleared it, but the hardware back button does not
    // go through `leaveSuccess` — both screens are terminal with `back: 'home'`, so this
    // function resolves them straight to home and the flag stayed standing for the rest of
    // the session. Every later success — a payment, a swap, an off-ramp — then routed back
    // into the enrolment screen, which is how a security prompt ends up appearing after an
    // unrelated transfer on a phone that may have changed hands.
    if (screen === 'success' || screen === 'device-auth') setDeviceAuthOffer(false);
    const popped = stackRef.current.pop();
    if (popped) {
      setScreen(popped);
      const tabOf = SCREENS[popped].tab;
      if (tabOf) setTab(tabOf);
      return true;
    }
    const target = backTarget(screen, backContext());
    if (target === 'exit') return false;
    setScreen(target);
    const tabOf = SCREENS[target].tab;
    if (tabOf) setTab(tabOf);
    return true;
  }, [screen, backContext]);

  return {
    // state
    screen,
    tab,
    network,
    networkId,
    networks,
    meta,
    wallets,
    activeWalletId,
    addingWallet,
    /**
     * SECURITY: the raw session — which holds the decrypted Stellar secret AND the
     * app password — is deliberately NOT returned. It used to be a readable field on
     * the object passed to all 56 components, so every new screen inherited spending
     * authority by default. Screens get `hasSession` / `publicKey`, and anything that
     * needs the key goes through a gated action (`signRawXdr`, `revealBackup`,
     * `submitSend`, …) that lives in here.
     */
    hasSession: !!session,
    publicKey: session?.publicKey ?? null,
    signRawXdr,
    revealBackup,
    cosmosPay,
    // True while the wallet is swapping on the shared public key. Screens read it
    // to show the public commission and the offer to lower it; the fee itself is
    // always the one the gateway returned in the quote, never this.
    publicAccess,
    gatewayAccess,
    cosmosLink,

    loadOps,
    opsKeyFor,
    serverRails,
    loadRails,
    openOnrampTrustline,

    /*
     * The wallet's own sign-in (`lib/signIn.ts`). What a finished sign-in carries that
     * spends — its session token, its backup box — stays in here; screens get a summary.
     */
    signInPhase: signIn.signInPhase,
    signInUrl: signIn.signInUrl,
    /** The email an outstanding code went to, and how the sign-in began. Never the token. */
    signInCode: signIn.signInPendingCode
      ? { email: signIn.signInPendingCode.email, via: signIn.signInPendingCode.via }
      : null,
    signInMethods: signIn.signInMethods,
    loadSignInMethods: signIn.loadSignInMethods,
    signInWith,
    signInWithEmail: startEmail,
    submitSignInCode,
    resumeSignIn,
    cancelSignIn,
    /** True while the password screen is finishing a first-run sign-in rather than a seed. */
    hasSignInDraft: signInDraft?.purpose === 'onboarding',
    signInPending: signInDraft
      ? {
          purpose: signInDraft.purpose,
          email: signInDraft.ready.identity.email,
          name: signInDraft.ready.identity.name,
          account: signInDraft.ready.account,
          backupAddress: signInDraft.ready.backup?.stellarAddress ?? null,
          // Which doors the backup has — never the box. Decides whether the restore screen
          // leads with a passkey button, a password field, or both.
          backupDoors: backupDoorsOf(signInDraft.ready.backup?.box ?? null),
          replace: signInDraft.replace,
        }
      : null,
    completeSignIn,
    completeSignInWithPasskey,
    finishOnboardingWithPasskey,
    startOverSignIn,

    /*
     * SEP-30 account recovery. `recovery` is what the LEDGER says — whether two server
     * signers are on this account — not what either server claims, and it is null until a
     * screen calls `loadRecovery`.
     */
    recovery,
    loadRecovery,
    enableRecovery,
    topUpTestnet,
    startRecoveryCode,
    disableRecovery,
    updateRecoveryEmail,

    /*
     * Recovering an account onto this device. `recoverable` is null until a finished
     * sign-in asks both servers what it may recover, and the identity tokens that answer
     * stays inside the store — a screen holding one holds the right to re-key an account.
     */
    recoverable,
    loadRecoverable,
    recoveryCodes: recoveryCodes && signInDraft && recoveryCodes.key === signInDraft.ready.sessionToken
      ? { email: recoveryCodes.email, count: recoveryCodes.claims.length }
      : null,
    submitRecoveryCodes,
    recoverWallet,

    account,
    prices,
    loading,
    busy,
    history,
    historyLoading,
    loadHistory,
    toast,
    theme,
    setTheme,
    lang,
    setLang,
    requireConfirm,
    setRequireConfirm,
    toggleConfirm,
    // Not password-gated, unlike `toggleConfirm`: turning diagnostics off REMOVES a
    // capability rather than granting one, so an attacker gains nothing by it, and
    // making a privacy opt-out ask for a password is how an opt-out goes unused.
    diagnostics,
    setDiagnostics,
    confirmReq,
    requestSignature,
    resolveConfirm,
    setWalletAvatar,
    t,
    locale,
    accent: ACCENT,
    draftMnemonic,
    draftAccount,
    draftHasMnemonic,
    importText,
    draftName,
    draftBirthdate,
    draftEmail,
    draftGender,
    draftMetricsOptIn,
    draftPromoOptIn,
    favorites,
    verifyTargets,
    verifyFilled,
    verifyBank,
    verifyOk,
    send,
    selectedAsset,
    successInfo,
    // setters used by screens
    setScreen: navigate, // tracked: records the origin so goBack() can return there
    goBack,
    navMenuOpen,
    setNavMenuOpen,
    setTab,
    setImportText,
    setDraftName,
    setDraftBirthdate,
    setDraftEmail,
    setDraftGender,
    setDraftMetricsOptIn,
    setDraftPromoOptIn,
    setWalletEmail,
    saveProfile,
    toggleFavorite,
    setSend,
    setSelectedAsset,
    setSuccessInfo,
    flash,
    applySep7,
    // actions
    go,
    refresh,
    startCreate,
    beginVerify,
    tapChip,
    tapSlot,
    submitImport,
    finishOnboarding,
    unlock,
    lock,
    selectWalletForUnlock,
    removeWalletLocked,
    startAddWallet,
    cancelAddWallet,
    switchWallet,
    removeActiveWallet,
    switchNetwork,
    addNetwork,
    removeNetwork,
    addAssetTrustline,
    fund,
    submitSend,
    enableReceiving,
    submitLinkCode,
    ensureChainAddresses,
    cancelLink,
    quoteSwap,
    submitSwap,
    crossChainAssets,
    quoteCrossChain,
    submitCrossChain,
    backupRecoverable,
    recoverBackup,
    enableBackupRecovery,
    chainAddress,
    chainBalances,
    testnetChainBalances,
    chainSendTarget,
    setChainSendTarget,
    submitTestnetSend,
    airdropTestnetSol,
    quoteChainSwap,
    submitChainSwap,
    quoteCrossChainFrom,
    submitCrossChainFrom,
    // liquidity pools
    lpTarget,
    listPools,
    liquidityPositions,
    submitDeposit,
    submitWithdraw,
    openDeposit,
    openWithdraw,
    createPayLink,
    receivers,
    bankAccounts,
    loadReceivers,
    loadReceiver,
    loadBankAccounts,
    createFiatReceiver,
    addFiatBankAccount,
    removeFiatBankAccount,
    ensureBlockchainWallet,
    quoteDeposit,
    confirmDeposit,
    quoteWithdraw,
    confirmWithdraw,
    uploadKycDoc,
    unlinkCosmosPay,
    unlinkCosmosPayEnv,
    unlinkReceiver,
    checkPassword,
    // Safe to spread: `useDeviceAuth` returns TWO objects, and the one holding
    // `deviceAuthUnlock` — which RETURNS THE APP PASSWORD — is not this one. Handing that
    // to the 56 components holding this object is what "the session is not a field" exists
    // to prevent. This used to be a hand-maintained field-by-field allowlist, which was
    // correct but one `...deviceAuth` away from leaking; there is no flat object to spread
    // by mistake now, so the shape enforces what the comment used to ask for.
    ...deviceAuthPublic,
    leaveSuccess,
    acceptDeviceAuthOffer,
    dismissDeviceAuthOffer,
    unlockWithDevice,
    confirmWithDevice,
    toggleDeviceAuth,
    changeAppPassword,

    /*
     * Passkeys: this device opens with one instead of a typed password when
     * `passkeyUnlock` is true. Every action here raises its own sheet and composes it with a
     * vault operation; none of them hands a secret back to a screen.
     */
    ...passkey,
    unlockWithPasskey,
    confirmWithPasskey,
    revealBackupWithPasskey,
    switchToPasskey,
    switchToPassword,
  };
}

/** A backup's doors, for a screen — null when there is no backup or it will not parse. */
function backupDoorsOf(box: string | null): { password: boolean; passkeys: number; recovery: boolean } | null {
  if (!box) return null;
  try {
    const d = backupDoors(box);
    return { password: d.password, passkeys: d.passkeys.length, recovery: d.recovery };
  } catch {
    return null;
  }
}

export type WalletStore = ReturnType<typeof useWalletStore>;
