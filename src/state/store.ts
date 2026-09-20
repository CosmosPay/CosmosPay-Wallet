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
import {
  addWallet as vaultAddWallet,
  changePassword,
  PasswordChangeCommitError,
  clearPendingCosmosPay,
  getActiveEntry,
  getCosmosPay,
  getPendingCosmosPay,
  getCustomNetworks,
  getNetworkId,
  listWallets,
  migrate,
  removeWallet as vaultRemoveWallet,
  clearCosmosPay,
  clearReceiver,
  saveCosmosPay,
  saveDefaultReceiver,
  savePendingCosmosPay,
  updateWalletMeta,
  setActiveId,
  setCustomNetworks as vaultSetCustomNetworks,
  setNetworkId as vaultSetNetworkId,
  unlockSession,
  unlockWallet,
  convergeSeals,
  openPrimaryBox,
  openVault,
  verifyPassword,
  verifyVaultKey,
  getPollarSession,
  savePollarSession,
  entryForNetwork,
  identityOf,
  isPollar,
  type CosmosPayAccount,
  type CosmosPayPending,
  type Gender,
  type PollarStoredSession,
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
import { FIAT_DECIMALS, fromMinorUnits } from '@/lib/amount';
import { createExclusiveRunner, type ExclusiveRunner } from '@/lib/exclusive';
import { sendableAssets, spendableCeiling } from '@/lib/balances';
import { AUTO_LOCK_MS, AUTO_LOCK_CHECK_MS } from '@/constants/app';
import { SCREENS, backTarget, type BackContext, type Screen, type Tab } from '@/lib/screens';
import { hydrate, invalidate, run } from '@/lib/query';
import { useQueryValue } from '@/hooks/useQuery';
import { useDeviceAuth } from '@/state/useDeviceAuth';
import { identityRefusalKey, pollarLogout, waitForCode, type PollarHandshake } from '@/lib/pollar';
// The legacy Pollar login, kept for ONE caller: reconnecting an old Pollar wallet whose
// session expired, so its funds can still be moved out (`lib/pollarMigration.ts`). New
// wallets sign in through `lib/signIn.ts` and never reach it.
import { SOCIAL_LOGIN_ENV, socialLoginClaim, socialLoginStart, socialLoginVerify, socialPoller } from '@/lib/socialLogin';
import type { PollarProvider } from '@/constants/pollar';
import { isAuthFailure, pollarSign } from '@/lib/pollarApi';
import { clearHandshake, freshSession, fromStored, loadHandshake, saveHandshake, toStored } from '@/lib/pollarSession';
import { reserveExternalTab } from '@/lib/openExternal';
import { finishSignIn, replaceBackup as storeBackupBox } from '@/lib/signIn';
import { openBackup, sealBackup } from '@/lib/cloudBackup';
import type { SignInProvider } from '@/constants/signIn';
import {
  buildMigrationTx,
  fetchFeePerOp,
  fundOps,
  loadMigrationAccount,
  migrationBounds,
  migrationPending,
  migrationSteps,
  moveBatches,
  planMigration,
  trustBatches,
  trustlineBounds,
  withinConfirmed,
  type MigrationPlan,
} from '@/lib/pollarMigration';
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
  identityTokens,
  loadRecoveryServers,
  recoverableAccounts,
  recoveryStateOf,
  registerForRecovery,
  sequenceOf,
  signedRecoverySetup,
  signersToRemove,
  type RecoverableAccount,
  type RecoveryState,
} from '@/lib/recovery';
import {
  addTrustline as stellarAddTrustline,
  allNetworks,
  fundWithFriendbot,
  getAccountState,
  getHistory,
  getPrices,
  MAINNET_ID,
  networkEnv,
  resolveNetwork,
  sendPayment,
  signXdr,
  submitXdr as stellarSubmitXdr,
  type AccountState,
  type HistoryOp,
  type NetConfig,
  type PriceInfo,
} from '@/lib/stellar';
import {
  addBankAccount as cpAddBankAccount,
  addReceiverWallet as cpAddReceiverWallet,
  authorizePayout as cpAuthorizePayout,
  blindpayNetwork,
  claimCosmosAccount,
  createPayLink as cpCreatePayLink,
  createPayin as cpCreatePayin,
  createPayout as cpCreatePayout,
  createReceiver as cpCreateReceiver,
  createSwap as cpCreateSwap,
  deleteBankAccount as cpDeleteBankAccount,
  depositLiquidity as cpDepositLiquidity,
  extractUnsignedXdr,
  getReceiver as cpGetReceiver,
  linkCosmosAccount,
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
  registerCosmosAccount,
  submitLiquidity as cpSubmitLiquidity,
  submitSwap as cpSubmitSwap,
  uploadKycDoc as cpUploadKycDoc,
  verifyCosmosLink,
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
  type SocialLoginReady,
  type SwapQuote,
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
 * device. `migrate`: the key an old Pollar wallet's funds are about to move to.
 */
export type SignInPurpose = 'onboarding' | 'add' | 'migrate';

/**
 * A finished sign-in waiting for the one thing the platform cannot supply: a password.
 *
 * With a backup, that is the password it was sealed under, and the wallet is RESTORED. With
 * none — or when the person chose to start over — the wallet is CREATED here and its backup
 * sealed under the device's password (a first run chooses one on the password screen).
 *
 * In memory only, deliberately: `ready.sessionToken` is what lets the platform create an
 * account and put a backup under it. Closing the wallet here loses the sign-in, and the
 * person signs in again — nothing is spent by that, unlike the Pollar code it replaced.
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
 * Account-linking UI state. `offer` is shown when registration found the email already
 * has an account; `sent` holds the claim token after the access code is emailed.
 */
export type CosmosLink =
  | { stage: 'offer' }
  | { stage: 'sent'; claimToken: string; expiresAt: number };

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
  const [meta, setMetaState] = useState<WalletEntry | null>(null);
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
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
   * The active wallet's Pollar session, when it has one.
   *
   * A REF and not state, which is unusual here and deliberate. `signEnvelope` reads it
   * inside a flow that may have started several awaits ago, and React state read there
   * is the value from the render that opened the flow — after a token rotation, that is
   * a refresh token Pollar has already retired, and Pollar treats a replayed refresh
   * token as a compromise and revokes the whole family. A ref is always the current one.
   *
   * Nothing renders from it, so there is no state copy to keep in step: screens branch
   * on `isPollarWallet`, which is derived from the WalletEntry. That distinction matters
   * on its own — a Pollar wallet whose session box failed to open is still a Pollar
   * wallet, and must not render as a local one with an export button.
   */
  const pollarRef = useRef<PollarStoredSession | null>(null);
  const setPollar = useCallback((next: PollarStoredSession | null) => {
    pollarRef.current = next;
  }, []);
  // A registration awaiting email confirmation (set after enableReceiving until
  // claimReceiving succeeds). Plaintext-persisted so it survives a reload.
  const [cosmosPayPending, setCosmosPayPending] = useState<CosmosPayPending | null>(null);
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
  // Account-linking flow, shown when registration reports the email already has an
  // account: 'offer' (prompt to link) → 'sent' (access code emailed, awaiting the code).
  // In-memory only — the code lives in the user's email and is short-lived; a reload
  // simply restarts the offer. See linkReceiving / submitLinkCode.
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
   * Sign an envelope with whatever holds this wallet's key.
   *
   * The one place the two account kinds differ, and it is deliberately the LAST step of
   * every money flow rather than a fork near the top. Each flow still reads:
   *
   *     assertSafeToSign(network, xdr, { intent, signer, ...bounds });
   *     guardSession(epoch);
   *     const signed = await signEnvelope(xdr);
   *
   * so what the wallet is willing to put its name to is decided in exactly the same
   * place, by exactly the same guard, for a key in a local vault and a key in Pollar's
   * KMS. A branch higher up — "if Pollar, call Pollar's build-sign-submit" — would have
   * given a custodial account its own set of rules, and the rules are the product.
   *
   * `pollarRef`, not the `pollar` state: this runs after awaits, and a rotated token
   * written by a concurrent `freshSession` must not be shadowed by the value this
   * closure captured. Rotation matters here specifically because Pollar treats a
   * replayed refresh token as a compromise and revokes the family.
   */
  const signEnvelope = useCallback(
    async (xdr: string): Promise<string> => {
      if (!session) throw new Error(t('unlock.autoLocked'));
      const stored = pollarRef.current;
      if (!stored) return signXdr(network, await secretOf(session), xdr);

      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      // Refreshing is a bridge call, so it needs the CosmosPay key. Without one the
      // token still works until it expires — refusing here would break a signature that
      // was about to succeed, so the stale token is used and Pollar decides.
      const live = apiKey ? await freshSession(session.walletId, stored, apiKey, session.vaultKey) : stored;
      if (live !== stored) setPollar(live);
      return pollarSign(network, fromStored(live), xdr);
    },
    [session, network, cosmosPay, t, setPollar],
  );


  /** Toggle manual confirmations — always password-gated (prevents an attacker
   *  silently disabling protection on an unlocked wallet). */
  const toggleConfirm = useCallback(async () => {
    const ok = await requestSignature({ title: t('confirmSig.settingTitle'), message: t('confirmSig.settingMsg') }, true);
    if (ok) setRequireConfirm(!savedRequireConfirm());
  }, [requestSignature, setRequireConfirm, t]);

  /** Set the active wallet's profile picture (small data URL). */
  const setWalletAvatar = useCallback(
    async (dataUrl: string) => {
      if (!meta) return;
      const next = await updateWalletMeta(meta.id, { avatar: dataUrl });
      setWallets(next);
      const entry = next.find((w) => w.id === meta.id);
      if (entry) setMetaState(entry);
    },
    [meta],
  );

  /** Change the active wallet's email — Cosmos Pay registration/linking is tied to it. */
  const setWalletEmail = useCallback(
    async (email: string) => {
      if (!meta) return;
      const next = await updateWalletMeta(meta.id, { email: email.trim() });
      setWallets(next);
      const entry = next.find((w) => w.id === meta.id);
      if (entry) setMetaState(entry);
      flash(t('profile.emailUpdated'), 'ok');
    },
    [meta, flash, t],
  );

  /** Update the editable profile fields at once (name, email, gender). The birthdate
   *  is deliberately NOT editable — age gates (13+, 18+ fiat) must stay trustworthy. */
  const saveProfile = useCallback(
    async (fields: { name: string; email: string; gender: Gender }) => {
      if (!meta) return;
      const next = await updateWalletMeta(meta.id, {
        name: fields.name.trim() || 'astronauta',
        email: fields.email.trim(),
        gender: fields.gender,
      });
      setWallets(next);
      const entry = next.find((w) => w.id === meta.id);
      if (entry) setMetaState(entry);
      flash(t('profile.saved'), 'ok');
    },
    [meta, flash, t],
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

  /**
   * Move the app to mainnet, because the wallet being adopted only exists there.
   *
   * Not a preference and not a convenience: a Pollar wallet's address is a mainnet
   * account, so every read for it on another network asks Horizon about an address that
   * was never created there. Horizon answers 404, `getAccountState` reports `exists:
   * false`, and the screen says the account is not active while Pollar's own SDK shows it
   * funded — which is exactly the state this exists to prevent.
   *
   * Written as a bare pair rather than through `switchNetwork` because that one is
   * declared far below this and does the same two statements; the cache needs no clearing
   * either way, since its keys carry the network id.
   */
  const goMainnet = useCallback(async () => {
    setNetworkIdState(MAINNET_ID);
    await vaultSetNetworkId(MAINNET_ID);
  }, []);

  /** Where a sign-in is and what this deployment offers — see `state/useSignIn.ts`. */
  const signIn = useSignIn(t, flash);

  /** See {@link SignInDraft}: a finished sign-in waiting for its password. */
  const [signInDraft, setSignInDraft] = useState<SignInDraft | null>(null);

  /**
   * Put a wallet a sign-in produced on this device: sealed under `vk`, with the account
   * keys that came back, and — unless it is a migration target — as the active wallet of a
   * session on `vk`.
   *
   * One function for a first run (a key derived from the password just chosen), another
   * wallet on an unlocked device (the session's own key) and a migration target (the same,
   * left inactive), because the only real difference is where the key came from. Written
   * three times, one copy is the one that forgets `saveCosmosPay` and leaves a wallet that
   * can sign but cannot swap.
   *
   * `cosmosPay` moves with the active wallet for the reason it always has: leaving the
   * previous wallet's key in state would attribute this one's swaps to another account.
   */
  const landSignedInWallet = useCallback(
    async (input: {
      secret: VaultSecret;
      publicKey: string;
      ready: SignInReady;
      account: CosmosPayAccount;
      vk: VaultKey;
      consents: ConsentAnswers;
      activate: boolean;
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
      const previous = meta?.id ?? null;
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
        },
        input.vk,
      );
      // `addWallet` hands an entry back unchanged when this address was already on the
      // device — restoring a wallet it knew — so the flag is written either way.
      if (!entry.cloudBackup) await updateWalletMeta(entry.id, { cloudBackup: true });
      await saveCosmosPay(entry.id, input.account, input.vk);

      if (!input.activate) {
        // `addWallet` made it active on disk; a migration keeps the Pollar wallet in front
        // until the move is done, so the choice is put back.
        if (previous) await setActiveId(previous);
        setWallets(await listWallets());
        return entry;
      }

      const list = await listWallets();
      const landed = list.find((w) => w.id === entry.id) ?? entry;
      setWallets(list);
      setMetaState(landed);
      setSession({ publicKey: landed.publicKey, walletId: landed.id, vaultKey: input.vk });
      setPollar(null);
      setCosmosPay(input.account);
      setCosmosPayPending(null);
      return landed;
    },
    [meta, setPollar, guardSession],
  );

  /**
   * A NEW wallet for a sign-in: the seed is generated here, sealed for the backup under
   * `password`, and only then is the platform told — the signature it needs is made by the
   * key that was just generated, which is what binds the account to it.
   *
   * The platform is told BEFORE the wallet is written locally, on purpose. If the local
   * write then fails the backup is already safe and a restore brings the wallet back; the
   * other order could leave a funded-to-be wallet on the device that nothing backs up.
   *
   * Returns null on `backup_conflict`: another device backed a wallet up for this account
   * since the sign-in began. Nothing was created, and the person signs in again to restore it.
   */
  const createFromSignIn = useCallback(
    async (
      draft: SignInDraft,
      password: string,
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
      const box = await sealBackup(secret, password);
      const res = await finishSignIn({
        sessionToken: draft.ready.sessionToken,
        email: draft.ready.identity.email,
        secret: acc.secret,
        backup: box,
        replaceBackup: draft.replace,
      });
      if (res.status === 'backup_conflict') {
        flash(t('backup.conflict'), 'err');
        return null;
      }
      return landSignedInWallet({
        secret,
        publicKey: acc.publicKey,
        ready: draft.ready,
        account: { keys: res.keys, organizationId: res.organizationId },
        vk,
        consents,
        activate: draft.purpose !== 'migrate',
        epoch,
      });
    },
    [landSignedInWallet, flash, t],
  );

  /**
   * Final onboarding step. When adding a wallet to an unlocked session the app
   * password is reused (no password screen); for the first wallet `password` is
   * supplied by the PasswordSetup screen.
   */
  const finishOnboarding = useCallback(
    async (password?: string) => {
      // A first-run sign-in with nothing to restore, or one that chose to replace its
      // backup. Checked FIRST and on its own terms: this flow never fills `draftAccount` —
      // the onboarding screens that do were skipped — so the guard below would drop it on
      // the floor. The same password seals the vault and the cloud backup, so the person
      // has one password to remember on every device.
      if (signInDraft?.purpose === 'onboarding') {
        if (!password || !appPasswordOk(password)) return;
        setBusy(true);
        try {
          const vk = await deriveVaultKey(password, newKdfParams());
          // The consent step that follows the password on this path (PasswordSetup) fills
          // the same two drafts the seed path fills on `profile-setup`. Applied BEFORE the
          // wallet is landed, so the profile records the answer at creation and the very
          // first event this wallet could report is already covered by it.
          const consents = { metricsOptIn: draftMetricsOptIn, promoOptIn: draftPromoOptIn };
          setTelemetryEnabled(consents.metricsOptIn);
          const entry = await createFromSignIn(signInDraft, password, vk, consents);
          setSignInDraft(null);
          if (!entry) {
            // Backed up from another device meanwhile: signing in again restores that one.
            setScreen('sign-in');
            return;
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
        } catch (e) {
          flash((e as Error).message, 'err');
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!draftAccount) return;
      // Adding a wallet to an unlocked session reuses that session's key — which is what
      // "no password screen" means now. The first wallet on a device derives one from the
      // password the setup screen just collected, and that derivation is what makes its
      // parameters the ones every later box converges onto.
      const reuse = addingWallet ? session?.vaultKey : null;
      if (addingWallet ? !reuse : !password) return;
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
        setCosmosPayPending(null);
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
      } catch (e) {
        flash((e as Error).message, 'err');
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
   * when it did, the biometric path quietly skipped `setCosmosPayPending`.
   */
  const openSession = useCallback(async (entry: WalletEntry, vaultKey: VaultKey) => {
    setMetaState(entry);
    setWallets(await listWallets());
    setSession({ publicKey: entry.publicKey, walletId: entry.id, vaultKey });
    setCosmosPay(await getCosmosPay(entry.id, vaultKey));
    setCosmosPayPending(await getPendingCosmosPay(entry.id));
    // Only a Pollar wallet has one, and for that wallet this box is also what the
    // password was just proven against — so a null here on a Pollar entry means the
    // session opened on a key that cannot read it, which `convergeSeals` treats as the
    // broken state it is. Reading it eagerly keeps that from first surfacing mid-payment.
    setPollar(isPollar(entry) ? await getPollarSession(entry.id, vaultKey) : null);
    // Every unlock funnels through here — the password screen, the device prompt, the
    // boot path restoring a saved session — and each of them restores the network id that
    // was saved, which for an install predating this rule can be testnet with a custodied
    // wallet active. That combination has no address to read, so correct it on the way in
    // rather than leave the user looking at a funded account reported as empty.
    if (isPollar(entry)) await goMainnet();
    setTab('home');
    setScreen('home');
  }, [goMainnet, setPollar]);

  /**
   * Prove the live session's key opens `entry`, and return the Pollar session it holds.
   *
   * The proof has to open the box that wallet ACTUALLY HAS, and the two kinds do not have
   * the same one. A local wallet has a secret box. A Pollar wallet has none — its sealed
   * session is both its credential and the box the app password is proven against, which
   * is what `createPollarWallet` means by "the session box IS this wallet's box". Asking
   * `openVault` for a secret box that was never written is how switching to a social
   * wallet failed: it threw, the caller showed the error, and the wallet never changed.
   *
   * Returning the session rather than only proving it is the other half. `signEnvelope`
   * decides where an envelope goes by whether `pollarRef` holds one, so a switch that
   * left it alone would either strand a Pollar wallet with no token, or — switching the
   * other way — hand a LOCAL wallet's envelope to a custodian that has never heard of its
   * address. Every caller sets it from this return value, including the null.
   *
   * A Pollar entry whose box will not open is a hard failure, never a null: the key that
   * is meant to open it is the one this session is already running on.
   */
  const adoptWallet = useCallback(
    async (entry: WalletEntry, vaultKey: VaultKey): Promise<PollarStoredSession | null> => {
      await openPrimaryBox(entry, vaultKey);
      if (!isPollar(entry)) return null;
      // The proof above already opened this box, so a null here is not a wrong key — it
      // is a session box holding something that is no longer a session.
      const stored = await getPollarSession(entry.id, vaultKey);
      if (!stored) throw new Error(t('pollar.sessionExpired'));
      return stored;
    },
    [t],
  );

  const unlock = useCallback(
    async (password: string): Promise<UnlockResult> => {
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
        report(EVENT.unlockOk, { category: 'auth', props: { method: 'password' } });
        return { ok: true };
      } catch (e) {
        // By CLASS, never by the rendered line: `errLine` is translated copy, so a feed
        // grouped on it would split one failure across five languages. `reportError`
        // keeps the class name and the gateway's code, which is what groups.
        reportError(EVENT.unlockFailed, e, { method: 'password', wrong: e instanceof WrongPasswordError });
        flash(errLine(e), 'err');
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
    [flash, claimAttempt, forgetAttempt, openSession, errLine],
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
        // The proving box, not the secret one — a Pollar wallet has no secret box, and
        // asking for it turned a good enrolment into a failed unlock the user could only
        // escape by typing their password.
        await openPrimaryBox(entry, vaultKey).catch(async (err: unknown) => {
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
    setCosmosPayPending(null);
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
   * Make `entry` the active wallet under the live session's key.
   *
   * The shared half of switching WALLET and switching NETWORK, because for a social login
   * those are the same operation seen from two angles: one identity, two addresses, and
   * either control can be the one that moves between them. Written twice, the second copy
   * is the one that forgets `setPollar` and routes a seed wallet's envelope to a
   * custodian — which is exactly what the third copy of this used to do.
   */
  const activateWallet = useCallback(
    async (entry: WalletEntry, vaultKey: VaultKey) => {
      const stored = await adoptWallet(entry, vaultKey);
      await setActiveId(entry.id);
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, walletId: entry.id, vaultKey });
      setPollar(stored);
      setCosmosPay(await getCosmosPay(entry.id, vaultKey));
      setCosmosPayPending(await getPendingCosmosPay(entry.id));
    },
    [adoptWallet, setPollar],
  );

  /**
   * The wallets a PICKER may show, and which of them is current.
   *
   * A social login writes two entries and the user has one account, so the seeded testnet
   * half never appears as a row of its own — it is reached by changing network, and
   * `entryForNetwork` is what does that. Both pickers read these instead of the raw list:
   * `wallets` still holds every entry, because switching, deleting and resolving all need
   * the hidden one, and filtering the list they work from would have quietly broken them.
   *
   * `activeWalletId` is the IDENTITY's id, never the seeded half's. Standing on testnet
   * with a social wallet, the row to highlight is still the account the user knows about.
   */
  const visibleWallets = useMemo(() => wallets.filter((w) => !w.testnetFor), [wallets]);
  const activeWalletId = useMemo(
    () => (meta ? identityOf(meta, wallets).id : null),
    [meta, wallets],
  );

  const switchWallet = useCallback(
    async (id: string) => {
      if (!session || id === meta?.id) return;
      setBusy(true);
      try {
        const picked = wallets.find((w) => w.id === id);
        if (!picked) return;
        // The row the user tapped names an IDENTITY; which of its addresses they get is
        // the network's business, not theirs. On testnet a social login resolves to its
        // seeded half, which is why nothing here has to force the network any more.
        const entry = entryForNetwork(picked, wallets, networkEnv(network) === 'prod');
        if (entry.id === meta?.id) return;
        // `activateWallet` proves the session's key opens the target BEFORE anything
        // switches — the check the old code got for free by decrypting to build the new
        // session. It costs a GCM decrypt now rather than a full PBKDF2 derivation, which
        // is the difference between switching wallets in microseconds and in about a
        // second.
        await activateWallet(entry, session.vaultKey);
        // Only when the resolution above had nowhere else to go: a custodied wallet with
        // no seeded half is a mainnet-only account, and reading it anywhere else asks
        // Horizon about an address that was never created there.
        if (isPollar(entry)) await goMainnet();
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
    [session, meta, wallets, network, t, flash, errLine, activateWallet, goMainnet],
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
        setCosmosPayPending(null);
        setPollar(null);
        setMetaState(null);
        setScreen('welcome');
        return;
      }
      const entry = remaining.find((w) => w.id === newActive)!;
      // Same rule as `switchWallet`: the wallet being adopted decides which box proves
      // the key, and the session it hands back is what routes the next signature.
      const stored = await adoptWallet(entry, session.vaultKey);
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, walletId: newActive, vaultKey: session.vaultKey });
      setPollar(stored);
      setCosmosPay(await getCosmosPay(newActive, session.vaultKey));
      setCosmosPayPending(await getPendingCosmosPay(newActive));
      setTab('home');
      setScreen('home');
      flash(t('toast.walletRemoved'), 'ok');
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [meta, session, t, flash, adoptWallet, setPollar]);

  /* -------------------------- network switch ---------------------- */
  const switchNetwork = useCallback(
    async (id: string) => {
      // For a social login the network selector is ALSO the wallet selector: one identity
      // with an address per network, and this is the control that moves between them. The
      // seeded half is not a row anybody can pick, so if this did not swap it, it would be
      // a wallet the user owns and has no way to reach.
      if (meta && session) {
        const next = entryForNetwork(meta, wallets, networkEnv(resolveNetwork(id, customNetworks)) === 'prod');
        if (next.id !== meta.id) {
          try {
            await activateWallet(next, session.vaultKey);
          } catch (e) {
            // The network does NOT move when its wallet could not be opened — leaving it
            // on a network whose key never loaded is the state that reads as "my funded
            // account is empty".
            flash(errLine(e), 'err');
            return;
          }
        } else if (isPollar(meta) && id !== MAINNET_ID) {
          // A custodied wallet whose seeded half is gone. Not a view the user could have
          // wanted — a funded account reported as not active, every balance zero, nothing
          // on screen able to say why — so it is refused with the sentence that makes it
          // actionable rather than entered.
          flash(t('net.pollarMainnetOnly'), 'info');
          return;
        }
      }
      // No toast on a real switch — the network label already updates in the dropdown.
      setNetworkIdState(id);
      await vaultSetNetworkId(id);
      // Nothing to clear: the cache key carries the network id, so the new network
      // reads its own key. This is what kills the stale-write race — a request still
      // in flight for the previous network resolves into the key nobody is reading.
    },
    [meta, session, wallets, customNetworks, t, flash, errLine, activateWallet],
  );

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
        await stellarAddTrustline({ cfg: network, secret: await secretOf(session), code: code.trim(), issuer: issuer.trim() });
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
   * Begin provisioning a CosmosPay account so this wallet can receive payments.
   * No client secret is used: the wallet signs a nonce with its Stellar secret
   * (proving account control) and the dev platform emails a confirmation link.
   * The API key is minted only after the user confirms — see claimReceiving.
   */
  const enableReceiving = useCallback(async () => {
    if (!session || !meta) return;
    if (!meta.email) {
      flash(t('cosmospay.needEmail'), 'info');
      return;
    }
    // Signing the registration needs the secret, so always password-gate it.
    const epoch = sessionEpochRef.current;
    const ok = await requestSignature({
      title: t('cosmospay.enableTitle'),
      message: t('cosmospay.enableConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      guardSession(epoch);
      const res = await registerCosmosAccount({
        email: meta.email,
        name: meta.name,
        stellarAddress: meta.publicKey,
        secret: await secretOf(session),
      });
      if (res.status === 'exists') {
        // Email already has an account — offer to link this wallet via an access code.
        setCosmosLink({ stage: 'offer' });
        flash(t('cosmospay.exists'), 'info');
        return;
      }
      // pending — persist the claim token so the claim survives a reload.
      const pending: CosmosPayPending = {
        claimToken: res.claimToken,
        stellarAddress: meta.publicKey,
        expiresAt: Date.now() + (res.expiresInSeconds || 0) * 1000,
        email: meta.email, // remember where it went, to flag mismatches later
      };
      await savePendingCosmosPay(meta.id, pending);
      setCosmosPayPending(pending);
      flash(t('cosmospay.checkEmail'), 'ok');
    } catch (e) {
      flash((e as Error).message || t('cosmospay.error'), 'err');
    } finally {
      setBusy(false);
    }
  }, [session, meta, requestSignature, guardSession, t, flash]);

  /**
   * Re-send the confirmation email: drops the stale pending registration (e.g. it
   * was created with a previous/incorrect email) and registers again using the
   * wallet's CURRENT email — so a fresh confirmation lands in the right inbox.
   */
  const resendReceiving = useCallback(async () => {
    if (!meta) return;
    await clearPendingCosmosPay(meta.id);
    setCosmosPayPending(null);
    await enableReceiving();
  }, [meta, enableReceiving]);

  /**
   * Claim the API key for a pending registration once the user confirmed by
   * email. `silent` is used by the background poller (no spinner, no "not
   * confirmed yet" toast). Persists the key sealed (saveCosmosPay) on success.
   */
  const claimReceiving = useCallback(
    async (silent = false) => {
      if (!session || !meta || !cosmosPayPending) return;
      const pending = cosmosPayPending;
      // A background poller drives this every few seconds, so its closure routinely
      // outlives the session it captured — and it re-seals the CosmosPay bearer key with
      // that session's vault key. After a password change that key is superseded: the write
      // would succeed, `getCosmosPay` would swallow the decrypt failure as "none", and the
      // wallet would show receiving as enabled with a credential nothing can open.
      const epoch = sessionEpochRef.current;
      if (!silent) setBusy(true);
      try {
        const res = await claimCosmosAccount({
          stellarAddress: pending.stellarAddress,
          claimToken: pending.claimToken,
        });
        guardSession(epoch);
        if (res.status === 'ready') {
          const account: CosmosPayAccount = {
            keys: res.keys,
            organizationId: res.organizationId,
          };
          const list = await saveCosmosPay(meta.id, account, session.vaultKey);
          setWallets(list);
          const entry = list.find((w) => w.id === meta.id);
          if (entry) setMetaState(entry);
          setCosmosPay(account);
          await clearPendingCosmosPay(meta.id);
          setCosmosPayPending(null);
          flash(t('cosmospay.created'), 'ok');
        } else if (res.status === 'claimed') {
          await clearPendingCosmosPay(meta.id);
          setCosmosPayPending(null);
          flash(t('cosmospay.already'), 'info');
        } else if (res.status === 'expired') {
          await clearPendingCosmosPay(meta.id);
          setCosmosPayPending(null);
          flash(t('cosmospay.expired'), 'err');
        } else if (!silent) {
          flash(t('cosmospay.notConfirmed'), 'info');
        }
      } catch (e) {
        if (!silent) flash((e as Error).message || t('cosmospay.error'), 'err');
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [session, meta, cosmosPayPending, guardSession, t, flash],
  );

  /**
   * Start linking this wallet to an EXISTING account (the email already had one — see the
   * `exists` branch of enableReceiving). Password-gates the Stellar signature, then asks the
   * server to email a one-time access code. On success we move to the 'sent' stage.
   */
  const linkReceiving = useCallback(async () => {
    if (!session || !meta || !meta.email) return;
    const epoch = sessionEpochRef.current;
    const ok = await requestSignature({
      title: t('cosmospay.linkTitle'),
      message: t('cosmospay.linkConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      guardSession(epoch);
      const res = await linkCosmosAccount({
        email: meta.email,
        name: meta.name,
        stellarAddress: meta.publicKey,
        secret: await secretOf(session),
      });
      if (res.status === 'not_found') {
        // No account after all — drop back so the user can use the normal create flow.
        setCosmosLink(null);
        flash(t('cosmospay.linkNotFound'), 'info');
        return;
      }
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
  }, [session, meta, requestSignature, guardSession, t, flash]);

  /**
   * Verify the emailed access code. On success, store the linked account's API key sealed
   * (same as a claim) so receiving/swaps light up. Wrong/expired/locked codes flash and,
   * for expired/locked, drop back to the 'offer' stage so the user can request a new code.
   */
  const submitLinkCode = useCallback(
    async (code: string) => {
      if (!session || !meta || !cosmosLink || cosmosLink.stage !== 'sent') return;
      setBusy(true);
      try {
        const res = await verifyCosmosLink({
          stellarAddress: meta.publicKey,
          claimToken: cosmosLink.claimToken,
          code,
        });
        if (res.status === 'ready') {
          const account: CosmosPayAccount = {
            keys: res.keys,
            organizationId: res.organizationId,
          };
          const list = await saveCosmosPay(meta.id, account, session.vaultKey);
          setWallets(list);
          const entry = list.find((w) => w.id === meta.id);
          if (entry) setMetaState(entry);
          setCosmosPay(account);
          setCosmosLink(null);
          flash(t('cosmospay.linked'), 'ok');
        } else if (res.status === 'invalid') {
          flash(t('cosmospay.linkInvalid', { n: res.attemptsLeft }), 'err');
        } else if (res.status === 'locked') {
          setCosmosLink({ stage: 'offer' });
          flash(t('cosmospay.linkLocked'), 'err');
        } else {
          setCosmosLink({ stage: 'offer' });
          flash(t('cosmospay.linkExpired'), 'err');
        }
      } catch (e) {
        flash((e as Error).message || t('cosmospay.error'), 'err');
      } finally {
        setBusy(false);
      }
    },
    [session, meta, cosmosLink, t, flash],
  );

  /** Dismiss the link prompt (user changes their mind). */
  const cancelLink = useCallback(() => setCosmosLink(null), []);

  // Background auto-poll: while a registration is pending (and not yet claimed),
  // try to claim every 4s for ~1 minute. The user can also click "I've confirmed"
  // manually (claimReceiving) — we never rely solely on polling.
  const claimRef = useRef(claimReceiving);
  claimRef.current = claimReceiving;
  useEffect(() => {
    if (!cosmosPayPending || cosmosPay) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      claimRef.current(true);
      if (n >= 15) clearInterval(id);
    }, 4000);
    return () => clearInterval(id);
  }, [cosmosPayPending, cosmosPay]);

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
   *  - **Pollar wallet** → skipped. Its key is in Pollar's KMS, so `secretOf` has nothing
   *    to open; proving ownership there would mean spending an access token on a round
   *    trip, which is a different feature and not this one.
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
    if (!telemetryEnabled() || !session || !own || !meta || isPollar(meta)) {
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
   * own, and needs no sign-in at all. Both end at the same guard with the same template —
   * the sponsorship is a funding arrangement, not a second way of changing an account.
   *
   * The token that the sponsored variant spends never leaves this function, which is why
   * the code is verified HERE rather than by the screen: a screen holding a session token
   * is a screen holding something that provisions.
   */
  const enableRecovery = useCallback(
    async (opts: { code?: string } = {}): Promise<boolean> => {
      if (!session || !meta) return false;
      if (isPollar(meta)) {
        // A Pollar wallet's key is not on this device and not on the account either;
        // there is no device key for two servers to replace.
        flash(t('recovery.error.pollar'), 'err');
        return false;
      }

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

          // Said plainly before anything happens, because this is the bargain: whoever
          // can prove that inbox — to BOTH servers — can put a new key on this account.
          const okToStart = await requestSignature({
            title: t('recovery.confirmTitle'),
            message: t('recovery.confirmMsg', { email }),
          });
          if (!okToStart) return false;
          guardSession(epoch);

          const secret = await secretOf(session);
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
            const built = await recoverySetupSponsored(ready.sessionToken, {
              stellarAddress: address,
              signers,
              ...signedRecoverySetup(secret, address, signers),
            });
            guardSession(epoch);
            xdr = built.transaction;
          } else {
            // Only the self-paid variant needs the sequence here: the sponsored one is
            // built by the operator, on the sequence it reads for itself.
            const sequence = await sequenceOf(network, address);
            guardSession(epoch);
            xdr = buildRecoverySetup({ account: address, signers, sequence, networkPassphrase: network.passphrase });
          }

          // The template, on both variants — including the one this wallet built itself.
          // A builder that checked only the other side's envelope would be trusting its
          // own code more than the thing that has to be right.
          assertSafeToSign(network, xdr, {
            signer: address,
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
        const signers = await signersToRemove(network, servers, address, secret);
        guardSession(epoch);
        if (!signers.length) {
          flash(t('recovery.error.notOn'), 'err');
          return false;
        }

        const sequence = await sequenceOf(network, address);
        guardSession(epoch);
        const xdr = buildRecoveryRemoval({ account: address, signers, sequence, networkPassphrase: network.passphrase });
        const signed = await signEnvelope(xdr);
        await stellarSubmitXdr(network, signed);

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

  const loadRecoverable = useCallback(async () => {
    if (!signInDraft) return;
    try {
      const servers = await loadRecoveryServers(network);
      const tokens = await identityTokens(servers, signInDraft.ready.sessionToken);
      setRecoverable(await recoverableAccounts(servers, tokens));
    } catch (e) {
      setRecoverable([]);
      flash((e as Error).message || t('recovery.error.generic'), 'err');
    }
  }, [signInDraft, network, flash, t]);

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
          const tokens = await identityTokens(servers, draft.ready.sessionToken);

          // The key that will replace the lost one. A fresh mnemonic, because the old one
          // is exactly what is missing — and the person is told on the screen that it now
          // restores a KEY, not this account, which keeps its own address.
          const { createMnemonic, accountFromMnemonic } = await walletLib();
          const mnemonic = createMnemonic();
          const fresh = await accountFromMnemonic(mnemonic);

          const sequence = await sequenceOf(network, address);
          const xdr = buildKeyReplacement({
            account: address,
            newKey: fresh.publicKey,
            sequence,
            networkPassphrase: network.passphrase,
          });
          const signed = await collectSignatures(network, servers, tokens, row.signers, address, xdr);
          await stellarSubmitXdr(network, signed);

          // Only now is the key real. Everything below is local bookkeeping over an
          // account this device can already sign for.
          const vk = await deriveVaultKey(password, newKdfParams());
          setTelemetryEnabled(consents.metricsOptIn);
          const box = await sealBackup({ secret: fresh.secret, mnemonic }, password);
          const res = await finishSignIn({
            sessionToken: draft.ready.sessionToken,
            email: draft.ready.identity.email,
            secret: fresh.secret,
            // The ACCOUNT, not the new key's own address: what was recovered is the
            // account, and the platform accepts the signature because that key is now one
            // of its signers — see the dev platform's account-signers module, which is in
            // a separate repository and so is named rather than linked.
            account: address,
            backup: box,
            replaceBackup: true,
          });
          if (res.status === 'backup_conflict') {
            flash(t('backup.conflict'), 'err');
            return false;
          }

          await landSignedInWallet({
            secret: { secret: fresh.secret, mnemonic },
            publicKey: address,
            ready: draft.ready,
            account: { keys: res.keys, organizationId: res.organizationId },
            vk,
            consents,
            activate: true,
          });
          setSignInDraft(null);
          setRecoverable(null);
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
    [signInDraft, recoverable, network, exclusive, landSignedInWallet, draftMetricsOptIn, draftPromoOptIn, flash, t],
  );

  /* ---------------------------- Pollar ---------------------------- */

  /*
   * What is left of Pollar here is what its existing wallets still need: signing (the
   * Pollar branch of `signEnvelope`), signing out, and moving their funds onto a key this
   * device holds. New wallets sign in through `lib/signIn.ts` and never become Pollar ones.
   */

  /**
   * Renewing an old Pollar wallet's session, so its funds can still be moved out.
   *
   * A Pollar session that expired while the app sat unused can only be renewed by logging
   * in to Pollar again — through the dev platform's legacy broker, which for an email that
   * already has an account (every Pollar user's) ends in an emailed code. The result is only
   * accepted when it is the SAME Stellar address as the wallet on screen: a login that
   * resolved some other Pollar account must not have its session filed under this one.
   */
  const [pollarReconnect, setPollarReconnect] = useState<
    { phase: 'idle' | 'waiting' | 'verifying' } | { phase: 'code'; claimToken: string }
  >({ phase: 'idle' });
  const reconnectAbort = useRef(false);

  const adoptReconnected = useCallback(
    async (claimed: SocialLoginReady, provider: PollarProvider): Promise<void> => {
      if (!session || !meta || !isPollar(meta)) return;
      if (claimed.session.wallet.address !== meta.publicKey) {
        flash(t('migrate.reconnectOtherAccount'), 'err');
        return;
      }
      const stored = toStored(claimed.session, provider);
      await savePollarSession(meta.id, stored, session.vaultKey);
      setPollar(stored);
      flash(t('migrate.reconnected'), 'ok');
    },
    [session, meta, t, flash, setPollar],
  );

  /** Wait out a legacy handshake and redeem it. Shared by starting and resuming. */
  const finishReconnect = useCallback(
    async (hs: PollarHandshake): Promise<void> => {
      try {
        setPollarReconnect({ phase: 'waiting' });
        const code = await waitForCode(socialPoller(SOCIAL_LOGIN_ENV), hs, () => reconnectAbort.current);
        setPollarReconnect({ phase: 'verifying' });
        const claimed = await socialLoginClaim(SOCIAL_LOGIN_ENV, hs, code, meta?.name);
        await clearHandshake();
        if (claimed.status === 'verify_email') {
          setPollarReconnect({ phase: 'code', claimToken: claimed.claimToken });
          flash(t('pollar.verifySent'), 'info');
          return;
        }
        await adoptReconnected(claimed, hs.provider);
        setPollarReconnect({ phase: 'idle' });
      } catch (e) {
        await clearHandshake();
        setPollarReconnect({ phase: 'idle' });
        reportError(EVENT.socialLoginFailed, e, { provider: hs.provider, brokered: true, reconnect: true });
        const identity = identityRefusalKey(e);
        flash(identity ? t(identity) : (e as Error).message || t('pollar.status.failed'), 'err');
      }
    },
    [meta, t, flash, adoptReconnected],
  );

  /**
   * Log in to Pollar again for the wallet on screen. The tab is claimed before the first
   * `await` (see `reserveExternalTab`) and the handshake is on disk before the browser
   * opens, because on MV3 opening it is what closes this popup.
   */
  const reconnectPollar = useCallback(async (): Promise<void> => {
    if (!meta || !isPollar(meta)) return;
    const provider: PollarProvider = meta.pollarProvider === 'github' ? 'github' : 'google';
    const tab = reserveExternalTab();
    reconnectAbort.current = false;
    setPollarReconnect({ phase: 'waiting' });
    let opened: Awaited<ReturnType<typeof socialLoginStart>>;
    try {
      opened = await socialLoginStart(SOCIAL_LOGIN_ENV, provider);
      await saveHandshake(opened.handshake);
    } catch (e) {
      tab.cancel();
      setPollarReconnect({ phase: 'idle' });
      flash((e as Error).message || t('pollar.status.failed'), 'err');
      return;
    }
    if (!(await tab.open(opened.authorizationUrl))) flash(t('signin.openFailed'), 'info');
    await finishReconnect(opened.handshake);
  }, [meta, t, flash, finishReconnect]);

  /** Pick up a reconnect a closed popup left open. No-op when there is none. */
  const resumePollarReconnect = useCallback(async (): Promise<void> => {
    if (!meta || !isPollar(meta)) return;
    const hs = await loadHandshake();
    if (!hs || !hs.brokered) return;
    reconnectAbort.current = false;
    await finishReconnect(hs);
  }, [meta, finishReconnect]);

  /** The code Pollar's broker emailed. `invalid` keeps the prompt; the rest close it. */
  const submitReconnectCode = useCallback(
    async (code: string): Promise<void> => {
      if (pollarReconnect.phase !== 'code' || !isAccessCode(code) || !meta) return;
      const { claimToken } = pollarReconnect;
      const provider: PollarProvider = meta.pollarProvider === 'github' ? 'github' : 'google';
      setPollarReconnect({ phase: 'verifying' });
      try {
        const res = await socialLoginVerify(claimToken, code);
        if (res.status === 'ready') {
          await adoptReconnected(res, provider);
          setPollarReconnect({ phase: 'idle' });
        } else if (res.status === 'invalid') {
          setPollarReconnect({ phase: 'code', claimToken });
          flash(t('pollar.verifyInvalid', { n: res.attemptsLeft }), 'err');
        } else {
          setPollarReconnect({ phase: 'idle' });
          flash(t(res.status === 'locked' ? 'pollar.verifyLocked' : 'pollar.verifyExpired'), 'err');
        }
      } catch (e) {
        setPollarReconnect({ phase: 'code', claimToken });
        flash((e as Error).message || t('pollar.status.failed'), 'err');
      }
    },
    [pollarReconnect, meta, t, flash, adoptReconnected],
  );

  const cancelPollarReconnect = useCallback(() => {
    reconnectAbort.current = true;
    setPollarReconnect({ phase: 'idle' });
    void clearHandshake();
  }, []);

  /**
   * Moving an old Pollar wallet's funds onto a key this device holds — see
   * `lib/pollarMigration.ts` for the shape of the move and why it takes several transactions.
   *
   * `migrationPlan` is what the move screen SHOWS, and it is also the bound: every
   * Pollar-signed transaction is held by the guard to the totals of the plan the person
   * confirmed. A step computed afterwards that wants to move more — someone paid the old
   * address in the meantime — is refused rather than signed, and the screen loads a new
   * plan to confirm.
   */
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [migrationPhase, setMigrationPhase] = useState<'idle' | 'loading' | 'running' | 'done'>('idle');
  const [migrationProgress, setMigrationProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  /** The last move stopped on Pollar refusing the session: the screen offers a reconnect. */
  const [migrationNeedsReconnect, setMigrationNeedsReconnect] = useState(false);

  /** The wallet the active Pollar wallet's funds are moving to, when one was made. */
  const migrationTarget = useMemo(
    () => (meta && isPollar(meta) && meta.migratedTo ? (wallets.find((w) => w.id === meta.migratedTo) ?? null) : null),
    [meta, wallets],
  );

  /** Work out the move from what is on-chain now. Pollar wallets live on mainnet only. */
  const freshMigrationPlan = useCallback(
    async (sourceAddress: string, targetAddress: string): Promise<MigrationPlan> => {
      const [source, target, fee] = await Promise.all([
        loadMigrationAccount(network, sourceAddress),
        loadMigrationAccount(network, targetAddress),
        fetchFeePerOp(network),
      ]);
      if (!source) throw new Error(t('migrate.sourceMissing'));
      return planMigration(source.state, target?.state ?? null, fee, targetAddress);
    },
    [network, t],
  );

  const loadMigrationPlan = useCallback(async (): Promise<void> => {
    if (!meta || !isPollar(meta) || !migrationTarget) {
      setMigrationPlan(null);
      return;
    }
    setMigrationPhase('loading');
    try {
      const plan = await freshMigrationPlan(meta.publicKey, migrationTarget.publicKey);
      setMigrationPlan(plan);
      setMigrationPhase(migrationPending(plan) ? 'idle' : 'done');
    } catch (e) {
      setMigrationPhase('idle');
      flash((e as Error).message, 'err');
    }
  }, [meta, migrationTarget, freshMigrationPlan, flash]);

  /**
   * Run the move to the end, one transaction at a time.
   *
   * Every step is planned again from the chain right before it is built, so an interrupted
   * move resumes where it stopped and a step that already landed is never repeated. The
   * Pollar-signed ones go through `signEnvelope` — the wallet on screen IS the Pollar one —
   * after the guard's `migrate` intent; the trustlines are signed here, by the new key,
   * after its `trustline` intent. Each key is fetched after `guardSession`, like every
   * other flow's.
   */
  const runMigration = useCallback(async (): Promise<void> => {
    if (!session || !meta || !isPollar(meta) || !migrationTarget || !migrationPlan) return;
    const confirmed = migrationPlan;
    if (confirmed.problem) return;
    const target = migrationTarget;
    const source = meta.publicKey;

    await exclusive.run('migrate', async () => {
      const epoch = sessionEpochRef.current;
      // Force-gated: this signs away the whole balance of a wallet.
      const ok = await requestSignature({ title: t('migrate.confirmTitle'), message: t('migrate.confirmMsg') }, true);
      if (!ok) return;
      const bounds = migrationBounds(confirmed);
      const total = migrationSteps(confirmed);
      let done = 0;
      setMigrationNeedsReconnect(false);
      setMigrationPhase('running');
      setMigrationProgress({ done, total });
      try {
        // A bound on the loop, not on the move: each pass either lands one transaction or
        // throws, and a plan can never need more passes than it has steps.
        for (let pass = 0; pass <= total; pass++) {
          const plan = withinConfirmed(await freshMigrationPlan(source, target.publicKey), confirmed);
          if (plan.problem?.kind === 'insufficient_xlm') throw new Error(t('migrate.insufficient'));
          if (!migrationPending(plan)) break;

          if (plan.fund > 0n || !plan.trustlines.length) {
            const ops = plan.fund > 0n ? fundOps(plan) : moveBatches(plan)[0];
            const acct = await loadMigrationAccount(network, source);
            if (!acct) throw new Error(t('migrate.sourceMissing'));
            const xdr = buildMigrationTx(network, acct.account, ops, plan.feePerOp);
            assertSafeToSign(network, xdr, {
              intent: 'migrate',
              signer: source,
              destinations: [target.publicKey],
              maxMoves: bounds,
            });
            guardSession(epoch);
            await stellarSubmitXdr(network, await signEnvelope(xdr));
          } else {
            const acct = await loadMigrationAccount(network, target.publicKey);
            if (!acct) throw new Error(t('migrate.targetMissing'));
            const xdr = buildMigrationTx(network, acct.account, trustBatches(plan)[0], plan.feePerOp);
            assertSafeToSign(network, xdr, {
              intent: 'trustline',
              signer: target.publicKey,
              destinations: 'self',
              confirmed: trustlineBounds(confirmed),
            });
            guardSession(epoch);
            const secret = (await openVault(target.id, session.vaultKey)).secret;
            await stellarSubmitXdr(network, signXdr(network, secret, xdr));
          }
          done = Math.min(done + 1, total);
          setMigrationProgress({ done, total });
        }
        // What moved, by kind — never an address or an amount: those are ACCOUNT_PROPS.
        report(EVENT.pollarMigrated, {
          category: 'transaction',
          props: { assets: confirmed.assets.length, created: confirmed.createTarget },
        });
        setMigrationPhase('done');
        invalidate(ACCOUNT_PREFIX);
        flash(t('migrate.done'), 'ok');
      } catch (e) {
        reportError(EVENT.pollarMigrationFailed, e, { step: done });
        setMigrationPhase('idle');
        if (isAuthFailure(e)) {
          setMigrationNeedsReconnect(true);
          flash(t('migrate.reconnectNeeded'), 'err');
        } else {
          flash(errLine(e), 'err');
        }
      } finally {
        // Whatever happened, the screen shows what is on-chain now.
        void freshMigrationPlan(source, target.publicKey).then(setMigrationPlan, () => {});
      }
    });
  }, [
    session,
    meta,
    migrationTarget,
    migrationPlan,
    exclusive,
    requestSignature,
    freshMigrationPlan,
    network,
    guardSession,
    signEnvelope,
    errLine,
    t,
    flash,
  ]);

  /** Leave the old wallet for the new one, once the move is done. */
  const openMigratedWallet = useCallback(async (): Promise<void> => {
    if (!migrationTarget) return;
    setMigrationPlan(null);
    setMigrationPhase('idle');
    await switchWallet(migrationTarget.id);
  }, [migrationTarget, switchWallet]);

  /**
   * Revoke the Pollar session for the active wallet.
   *
   * Pollar is told first and the device drops it second, never the other way round: a
   * local drop that ran first would leave a live refresh token on Pollar's side with
   * nothing left here able to revoke it. A failed revoke is still followed by the local
   * drop — the user asked to be signed out, and a token they can no longer reach is
   * strictly better than one they can.
   *
   * Then `lock()`, because for a Pollar wallet the session box IS the box the app
   * password was proven against: with the credential gone there is nothing left for this
   * session to act with, and leaving the wallet on screen would be showing an account it
   * can no longer sign for.
   */
  const pollarSignOut = useCallback(async (): Promise<boolean> => {
    if (!session || !meta || !isPollar(meta)) return false;

    // Force-gated, like everything that changes how the wallet opens (CLAUDE.md:
    // `toggleDeviceAuth`, `changeAppPassword`, `signRawXdr`). This one removes the
    // wallet from the device, so it is squarely in that set — and unlike the others it
    // cannot be undone from Settings, only by logging in again.
    const confirmed = await requestSignature(
      { title: t('pollar.signOut'), message: t('pollar.signOutMsg') },
      true,
    );
    if (!confirmed) return false;

    const stored = pollarRef.current;
    const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (stored && apiKey) {
      try {
        await pollarLogout(apiKey, stored.access_token);
      } catch {
        /* revoked already, or unreachable — the local removal below is the user's intent */
      }
    }

    // The WHOLE ENTRY, not just the session box.
    //
    // Dropping only the box would brick the wallet: for a Pollar entry that box is also
    // what `unlockSession` opens to prove the app password (`primaryBoxKey`), so the
    // entry would survive in the list as something that can never be unlocked again —
    // and nothing on screen would say why.
    //
    // Removing it is also what sign-out MEANS for a custodial account. The device holds
    // no key and no seed for it; without the session there is nothing left here at all.
    // Nothing is lost: logging in with the same provider account resolves the same
    // Stellar wallet, funds included.
    setPollar(null);
    const { remaining, newActive } = await vaultRemoveWallet(session.walletId);
    setWallets(remaining);
    lock();
    if (!newActive) setScreen('welcome');
    return true;
  }, [cosmosPay, network, session, meta, requestSignature, setPollar, lock, t]);

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
    setCosmosPayPending(null);
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
   * Change the app password.
   *
   * A store action, not a direct `lib/vault.changePassword` call from the settings form.
   * That call was the one mutation a `.tsx` made that invalidated store state, and nothing
   * put the state back: the session kept the superseded secret — the app password then, the
   * vault key now — which `switchWallet` used to open another wallet, `saveCosmosPay` used
   * to re-seal a bearer API key, and, once device auth shipped, `toggleDeviceAuth` sealed
   * into the device envelope. The last one is the sharpest: it wrote something superseded
   * into the Keychain, so the user's own fingerprint would answer "wrong password", which
   * is precisely the failure the re-wrap exists to prevent, arriving through another door.
   *
   * The fix is not to patch the field. `changePassword` re-seals every wallet under a new
   * key, so a patched field would assert something true of all of them or none, and the
   * honest answer after a successful change is that this session is over: `lock()` bumps
   * the epoch, so every closure still holding the old session fails closed with
   * "auto-locked" instead of signing under a key that no longer opens anything. The user
   * signs back in with the password they just chose, which also proves it works.
   *
   * `force`-gated (it changes how the wallet opens) and inside `exclusive.run`, so it
   * cannot interleave with a money flow that is mid-await holding the old password.
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
      // `ran: false` means a change is already in flight — a double tap on "save". Not an
      // error to report; the first one is still going.
      const res = await exclusive.run('password', async () => {
        try {
          // The cloud backups follow the password, or the next device would need the one
          // given up here. Sealed under the NEW password now, before anything commits — a
          // failure then leaves the device untouched — and stored only after the commit.
          const live = sessionRef.current;
          const backups: { name: string; secret: string; box: string }[] = [];
          if (live) {
            for (const w of wallets) {
              if (!w.cloudBackup || isPollar(w)) continue;
              const secret = await openVault(w.id, live.vaultKey);
              backups.push({ name: w.name, secret: secret.secret, box: await sealBackup(secret, next) });
            }
          }
          // The re-wrap closure is injected rather than imported by lib/vault.ts: it needs
          // an OS prompt and the copy that goes on it, neither of which belongs in a vault
          // function. Every enrolled wallet raises its own prompt — they are separate
          // Keystore entries, and there is no batch form.
          const { deviceAuthDropped } = await changePassword(current, next, {
            reenrolDeviceAuth: deviceAuthPrivileged.reenrolForPasswordChange,
          });
          if (deviceAuthDropped.length) {
            flash(t('devAuth.droppedOnPwdChange', { names: deviceAuthDropped.map((w) => w.name).join(', ') }), 'info');
          } else {
            flash(t('settings.pwdUpdated'), 'ok');
          }
          // Past the commit, and best-effort: the local change is done and must not be
          // reported as failed because the network was. The toast says which backup still
          // opens with the old password — last, so it is the one left on screen.
          const stale: string[] = [];
          for (const b of backups) {
            try {
              await storeBackupBox({ secret: b.secret, box: b.box });
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
          flash((e as Error).message, 'err');
          // A failure PAST the commit is not recoverable and not survivable by this
          // session: some wallets are on the new password and the session's key is true of
          // neither set. Carrying on would let `switchWallet` open a wallet with the wrong
          // key, `saveCosmosPay` re-seal a bearer credential under it, and a device
          // enrolment capture it. `lock()` bumps the epoch, so every closure still holding
          // this session fails closed; the user signs back in with whichever password works.
          // A failure BEFORE the commit left the device untouched, so the session stands.
          if (e instanceof PasswordChangeCommitError) lock();
          return false;
        }
      });
      return res.ran && res.value;
    },
    [requestSignature, exclusive, deviceAuthPrivileged, wallets, flash, lock, t],
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
   * the one it already has. The migration screen asks in place, so it only keeps the draft.
   */
  const routeSignIn = useCallback(
    (ready: SignInReady | null, purpose: SignInPurpose): void => {
      if (!ready) return;
      setSignInDraft({ ready, purpose, replace: false });
      if (purpose === 'migrate') return;
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
   * Finish a sign-in with a password: restore its backup, or create a new wallet for it on
   * a device that already has one.
   *
   * A first run with nothing to restore does not come through here — it chooses its
   * password on the password screen and ends in `finishOnboarding`.
   */
  const completeSignIn = useCallback(
    async (password: string): Promise<boolean> => {
      const draft = signInDraft;
      if (!draft) return false;
      const restoring = !!draft.ready.backup && !draft.replace;
      if (!restoring && draft.purpose === 'onboarding') return false;
      const live = sessionRef.current;
      if (draft.purpose !== 'onboarding' && !live) return false;
      // Landing on the live session's key: captured now, checked right before the landing.
      const epoch = draft.purpose === 'onboarding' ? undefined : sessionEpochRef.current;
      // An unlocked device already agreed to its consents; a first run asks on this screen.
      const consents: ConsentAnswers =
        draft.purpose === 'onboarding'
          ? { metricsOptIn: draftMetricsOptIn, promoOptIn: draftPromoOptIn }
          : { metricsOptIn: telemetryEnabled(), promoOptIn: meta?.promoOptIn ?? false };

      setBusy(true);
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
          let secret: VaultSecret;
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
          const res = await finishSignIn({
            sessionToken: draft.ready.sessionToken,
            email: draft.ready.identity.email,
            secret: secret.secret,
            // The address the box was filed under, which for a RECOVERED wallet is not the
            // key's own — see `finishSignIn`. For every other wallet the two are equal and
            // passing it changes nothing.
            account: backup.stellarAddress,
          });
          if (res.status !== 'ready') throw new Error(t('backup.conflict'));
          // On a first run the backup's password becomes this device's password too, so the
          // person still has one password; an unlocked device keeps its own.
          const vk = draft.purpose === 'onboarding' ? await deriveVaultKey(password, newKdfParams()) : live!.vaultKey;
          if (draft.purpose === 'onboarding') setTelemetryEnabled(consents.metricsOptIn);
          entry = await landSignedInWallet({
            // Only the two fields the vault stores: the box may also carry the account a
            // recovered wallet recorded, and that belongs on the WalletEntry (as its
            // `publicKey`, just below), not inside the sealed secret this device writes.
            secret: { secret: secret.secret, mnemonic: secret.mnemonic },
            publicKey: backup.stellarAddress,
            ready: draft.ready,
            account: { keys: res.keys, organizationId: res.organizationId },
            vk,
            consents,
            activate: draft.purpose !== 'migrate',
            epoch,
          });
          report(EVENT.backupRestored, { category: 'lifecycle', props: { purpose: draft.purpose } });
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
        } else if (meta && isPollar(meta)) {
          // The Pollar wallet stays in front; its funds now have somewhere to go. Recorded
          // before anything moves, so an interrupted move resumes into this same key.
          const list = await updateWalletMeta(meta.id, { migratedTo: entry.id });
          setWallets(list);
          setMetaState(list.find((w) => w.id === meta.id) ?? meta);
        }
        return true;
      } catch (e) {
        reportError(EVENT.signInFailed, e, { purpose: draft.purpose, step: 'finish' });
        flash(errLine(e), 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      signInDraft,
      draftMetricsOptIn,
      draftPromoOptIn,
      meta,
      claimAttempt,
      forgetAttempt,
      checkPassword,
      landSignedInWallet,
      createFromSignIn,
      deviceAuthPublic,
      errLine,
      flash,
      t,
    ],
  );

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
      hasSignInDraft: !!signInDraft && signInDraft.purpose !== 'migrate',
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
    wallets: visibleWallets,
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
    cosmosPayPending,
    // True while the wallet is swapping on the shared public key. Screens read it
    // to show the public commission and the offer to lower it; the fee itself is
    // always the one the gateway returned in the quote, never this.
    publicAccess,
    gatewayAccess,
    cosmosLink,

    /*
     * Pollar (social login, Pollar-custodied key).
     *
     * `isPollarWallet` is derived from the WalletEntry, never from the session being
     * loaded — see the note on `pollarRef`.
     *
     * The session itself is not exposed, for the same reason `session` is not: it holds
     * a refresh token, which is spending authority. Screens get the phase and the
     * actions; the credential stays in here.
     */
    isPollarWallet: isPollar(meta ?? {}),
    pollarProvider: meta?.pollarProvider ?? null,
    loadOps,
    opsKeyFor,
    serverRails,
    loadRails,
    openOnrampTrustline,
    pollarSignOut,

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
          replace: signInDraft.replace,
        }
      : null,
    completeSignIn,
    startOverSignIn,

    /*
     * SEP-30 account recovery. `recovery` is what the LEDGER says — whether two server
     * signers are on this account — not what either server claims, and it is null until a
     * screen calls `loadRecovery`.
     */
    recovery,
    loadRecovery,
    startRecoveryCode,
    enableRecovery,
    disableRecovery,

    /*
     * Recovering an account onto this device. `recoverable` is null until a finished
     * sign-in asks both servers what it may recover, and the identity tokens that answer
     * stays inside the store — a screen holding one holds the right to re-key an account.
     */
    recoverable,
    loadRecoverable,
    recoverWallet,

    /* Moving an old Pollar wallet onto a key this device holds (`lib/pollarMigration.ts`). */
    migrationPlan,
    migrationPhase,
    migrationProgress,
    migrationNeedsReconnect,
    migrationTarget,
    loadMigrationPlan,
    runMigration,
    openMigratedWallet,
    pollarReconnectPhase: pollarReconnect.phase,
    reconnectPollar,
    resumePollarReconnect,
    submitReconnectCode,
    cancelPollarReconnect,
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
    resendReceiving,
    claimReceiving,
    linkReceiving,
    submitLinkCode,
    cancelLink,
    quoteSwap,
    submitSwap,
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
  };
}

export type WalletStore = ReturnType<typeof useWalletStore>;
