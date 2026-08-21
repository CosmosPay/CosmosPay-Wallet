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
  unlockWallet,
  verifyPassword,
  type CosmosPayAccount,
  type CosmosPayPending,
  type Gender,
  type WalletEntry,
} from '@/lib/vault';
import { storageGet, storageSet } from '@/lib/storage';
import { beginAttempt, blockSeconds, noteAttemptSuccess, releaseAttempt } from '@/lib/attempts';
import { WrongPasswordError } from '@/lib/crypto';
import { assertSafeToSign, reviewTx } from '@/lib/txGuard';
import { appPasswordOk, isSafeHorizonUrl } from '@/lib/validate';
import { clampMemoText, memoKindFromSep7, type MemoKind } from '@/lib/memo';
import { codeIsAmbiguous, toPaymentAsset, XLM, type AssetRef } from '@/lib/asset';
import { FIAT_DECIMALS, fromMinorUnits } from '@/lib/amount';
import { createExclusiveRunner, type ExclusiveRunner } from '@/lib/exclusive';
import { sendableAssets, spendableCeiling } from '@/lib/balances';
import { AUTO_LOCK_MS, AUTO_LOCK_CHECK_MS } from '@/constants/app';
import { SCREENS, backTarget, type BackContext, type Screen, type Tab } from '@/lib/screens';
import { hydrate, invalidate, run } from '@/lib/query';
import { useQueryValue } from '@/hooks/useQuery';
import { useDeviceAuth } from '@/state/useDeviceAuth';
import { deviceAuthFailureKey, type DeviceAuthFailure } from '@/lib/deviceAuth';
import { ACCOUNT_PREFIX, HISTORY_PREFIX, PRICES_KEY, TTL, accountKey, historyKey } from '@/lib/dataKeys';
import {
  addTrustline as stellarAddTrustline,
  allNetworks,
  fundWithFriendbot,
  getAccountState,
  getHistory,
  getPrices,
  networkEnv,
  resolveNetwork,
  sendPayment,
  signXdr,
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
  type SwapQuote,
} from '@/lib/cosmospay';
import { useToast } from '@/state/useToast';
import { usePreferences, applySavedThemeEarly, savedRequireConfirm } from '@/state/usePreferences';
import { useSigningGate } from '@/state/useSigningGate';
import { parseStellarQr } from '@/lib/sep7';
import { buildKind } from '@/lib/platform';

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
  secret: string;
  mnemonic: string | null;
  password: string; // kept in memory so new wallets can be sealed without re-prompting
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
  const [addingWallet, setAddingWallet] = useState(false);
  /** A just-created wallet has a one-time offer to turn on the phone's lock. */
  const [deviceAuthOffer, setDeviceAuthOffer] = useState(false);
  // Provisioned CosmosPay account for the active wallet (null until enabled /
  // before unlock). Loaded from the sealed store whenever a session opens.
  const [cosmosPay, setCosmosPay] = useState<CosmosPayAccount | null>(null);
  // A registration awaiting email confirmation (set after enableReceiving until
  // claimReceiving succeeds). Plaintext-persisted so it survives a reload.
  const [cosmosPayPending, setCosmosPayPending] = useState<CosmosPayPending | null>(null);
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
  const { theme, setTheme, lang, setLang, t, locale, requireConfirm, setRequireConfirm } =
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
        flash((e as Error).message || 'No se pudieron cargar los datos.', 'err');
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
      setScreen('profile-setup');
    } catch (e) {
      flash((e as Error).message, 'err');
    }
  }, [importText, flash]);

  /**
   * Final onboarding step. When adding a wallet to an unlocked session the app
   * password is reused (no password screen); for the first wallet `password` is
   * supplied by the PasswordSetup screen.
   */
  const finishOnboarding = useCallback(
    async (password?: string) => {
      if (!draftAccount) return;
      const pwd = addingWallet ? session?.password : password;
      if (!pwd) return;
      setBusy(true);
      try {
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
          pwd,
        );
        setMetaState(entry);
        setWallets(await listWallets());
        setSession({
          publicKey: draftAccount.publicKey,
          secret: draftAccount.secret,
          mnemonic: draftHasMnemonic ? draftMnemonic : null,
          password: pwd,
        });
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
    [draftAccount, draftMnemonic, draftHasMnemonic, draftName, draftBirthdate, draftEmail, draftGender, draftMetricsOptIn, draftPromoOptIn, addingWallet, session, deviceAuthPublic, t, flash],
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
        const active = await getActiveEntry();
        if (!active) {
          await releaseAttempt(); // nothing was guessed — see forgetAttempt
          throw new Error('No hay ninguna wallet guardada en este dispositivo.');
        }
        // `getActiveEntry` checks neither that the vault blob exists nor that it parses —
        // it falls back to `list[0]`. So a throw here is NOT necessarily a wrong password,
        // and `forgetAttempt` is what keeps a corrupt blob from counting as a guess.
        const secret = await unlockWallet(active.id, password).catch(async (err: unknown) => {
          await forgetAttempt(err);
          throw err;
        });
        await noteAttemptSuccess();
        setMetaState(active);
        setWallets(await listWallets());
        setSession({ publicKey: active.publicKey, secret: secret.secret, mnemonic: secret.mnemonic, password });
        setCosmosPay(await getCosmosPay(active.id, password));
        setCosmosPayPending(await getPendingCosmosPay(active.id));
        setTab('home');
        setScreen('home');
        return { ok: true };
      } catch (e) {
        flash((e as Error).message, 'err');
        // The reason travels back because `unlockWithDevice` acts on it: a password the
        // envelope produced and that does not decrypt means the enrolment is stale, but a
        // THROTTLED attempt says nothing about the envelope, and treating the two alike
        // would delete a working enrolment over a backoff the user triggered by typing.
        return { ok: false, reason: e instanceof WrongPasswordError ? 'wrong' : 'other' };
      } finally {
        unlockInFlight.current = false;
        setBusy(false);
      }
    },
    [flash, claimAttempt, forgetAttempt],
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
    // screen, where accepting seals the session password behind whatever finger is
    // presented. The justification for not gating that accept is "the user set this
    // password seconds ago, in this same flow"; clearing the flag here is what keeps that
    // sentence true.
    setDeviceAuthOffer(false);
    stackRef.current = [];
    setScreen('unlock');
  }, [cancelPending, exclusive]);

  /**
   * Idle auto-lock. An open session holds the decrypted secret and the app password
   * in memory; the browser-action popup tears that down when it closes, but the side
   * panel, the web build and the Capacitor app keep it alive until the tab dies. So
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

  const switchWallet = useCallback(
    async (id: string) => {
      if (!session || id === meta?.id) return;
      setBusy(true);
      try {
        const secret = await unlockWallet(id, session.password);
        await setActiveId(id);
        const entry = wallets.find((w) => w.id === id);
        if (!entry) return;
        setMetaState(entry);
        setSession({ publicKey: entry.publicKey, secret: secret.secret, mnemonic: secret.mnemonic, password: session.password });
        setCosmosPay(await getCosmosPay(id, session.password));
        setCosmosPayPending(await getPendingCosmosPay(id));
        // No clearing needed: the cache key includes the account, so the new wallet
        // simply reads a different (empty) key while the old one stays warm.
        setTab('home');
        setScreen('home');
        flash(t('toast.walletActive', { name: entry.name }), 'info');
      } catch (e) {
        flash((e as Error).message, 'err');
      } finally {
        setBusy(false);
      }
    },
    [session, meta, wallets, t, flash],
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
        setMetaState(null);
        setScreen('welcome');
        return;
      }
      const secret = await unlockWallet(newActive, session.password);
      const entry = remaining.find((w) => w.id === newActive)!;
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, secret: secret.secret, mnemonic: secret.mnemonic, password: session.password });
      setCosmosPay(await getCosmosPay(newActive, session.password));
      setCosmosPayPending(await getPendingCosmosPay(newActive));
      setTab('home');
      setScreen('home');
      flash(t('toast.walletRemoved'), 'ok');
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [meta, session, t, flash]);

  /* -------------------------- network switch ---------------------- */
  const switchNetwork = useCallback(
    async (id: string) => {
      // No toast on switch — the network label already updates in the dropdown.
      setNetworkIdState(id);
      await vaultSetNetworkId(id);
      // Nothing to clear: the cache key carries the network id, so the new network
      // reads its own key. This is what kills the stale-write race — a request still
      // in flight for the previous network resolves into the key nobody is reading.
    },
    [],
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
      // stay open past the 5-minute idle auto-lock. Without this, `session.secret` was used
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
        await stellarAddTrustline({ cfg: network, secret: session.secret, code: code.trim(), issuer: issuer.trim() });
        await refresh(true);
        flash(t('toast.assetAdded', { code: code.trim() }), 'ok');
        return true;
      } catch (e) {
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
          secret: session.secret,
          destination: send.to.trim(),
          amount: send.amount,
          memo: send.memo,
          memoKind: send.memoKind,
          asset,
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
        secret: session.secret,
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
      // `session.password`. After a password change that string is superseded: the write
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
          const list = await saveCosmosPay(meta.id, account, session.password);
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
        secret: session.secret,
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
          const list = await saveCosmosPay(meta.id, account, session.password);
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

  /** Fetch a swap quote for `from` -> `to`. Returns null on error / not enabled. */
  const quoteSwap = useCallback(
    async (amount: string, from: SwapAsset, to: SwapAsset): Promise<SwapQuote | null> => {
      // Pick the key for the wallet's current network (testnet -> dev, mainnet -> prod).
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
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
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return;
      }
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
          assertSafeToSign(network, swap.xdr, {
            signer: session.publicKey,
            intent: 'swap',
            // A swap settles back into the same account: nothing may leave for a third
            // party. If the gateway ever charges its fee as a separate `payment` to
            // `quote.fee.wallet`, this refuses it — deliberately. Verify the envelope
            // shape first, then add `payment` to ALLOWED_OPS.swap and list that address
            // here; do not widen either one on a guess.
            destinations: 'self',
            maxSend: { amount, asset: { code: from.code, issuer: from.issuer } },
            minReceive: { amount: quote.destination.minimum, asset: { code: to.code, issuer: to.issuer } },
          });
          guardSession(epoch);
          const signedXdr = signXdr(network, session.secret, swap.xdr);
          const res = await cpSubmitSwap(apiKey, swap.id, signedXdr);
          if (res.submitted) {
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
            setSuccessInfo({
              kind: 'err',
              title: t('swap.failed'),
              msg: res.reason || codes || t('swap.failed'),
              rows: [],
            });
            setScreen('success');
          }
        } catch (e) {
          setSuccessInfo({ kind: 'err', title: t('swap.failed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, cosmosPay, network, requestSignature, refresh, exclusive, guardSession, t, flash],
  );

  /* ------------------------- liquidity pools ---------------------- */

  /** The CosmosPay key for the wallet's current network, or null (flashes a hint). */
  const cosmosApiKey = useCallback((): string | null => {
    const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
    if (!apiKey) flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
    return apiKey;
  }, [cosmosPay, network, t, flash]);

  /** Browse on-chain liquidity pools (Horizon proxy). Returns [] on error / not enabled. */
  const listPools = useCallback(
    async (input: ListPoolsInput = {}): Promise<LiquidityPool[]> => {
      const apiKey = cosmosApiKey();
      if (!apiKey) return [];
      try {
        return (await cpListLiquidityPools(apiKey, input)).data;
      } catch (e) {
        flash((e as Error).message || t('lp.loadError'), 'err');
        return [];
      }
    },
    [cosmosApiKey, t, flash],
  );

  /** This wallet's pool share positions (with redeemable amounts). [] on error. */
  const liquidityPositions = useCallback(async (): Promise<LiquidityPosition[]> => {
    if (!meta) return [];
    const apiKey = cosmosApiKey();
    if (!apiKey) return [];
    try {
      return (await cpLiquidityPositions(apiKey, meta.publicKey)).data;
    } catch (e) {
      flash((e as Error).message || t('lp.loadError'), 'err');
      return [];
    }
  }, [meta, cosmosApiKey, t, flash]);

  /**
   * Full deposit flow: build (server prices it + builds the XDR) -> sign locally
   * -> submit (server relays it to Horizon). Mirrors submitSwap; lands on success.
   */
  const submitDeposit = useCallback(
    async (input: { assetA: SwapAsset; assetB: SwapAsset; maxAmountA: string; maxAmountB?: string }) => {
      if (!session) return;
      const apiKey = cosmosApiKey();
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
          const signedXdr = signXdr(network, session.secret, op.xdr);
          const res = await cpSubmitLiquidity(apiKey, op.id, signedXdr);
          if (res.submitted) {
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
            setSuccessInfo({ kind: 'err', title: t('lp.depositFailed'), msg: res.reason || codes || t('lp.depositFailed'), rows: [] });
            setScreen('success');
          }
        } catch (e) {
          setSuccessInfo({ kind: 'err', title: t('lp.depositFailed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, account, cosmosApiKey, network, requestSignature, refresh, exclusive, guardSession, t],
  );

  /** Full withdraw flow: build -> sign locally -> submit. Mirrors submitDeposit. */
  const submitWithdraw = useCallback(
    async (input: { poolId: string; shares: string }) => {
      if (!session) return;
      const apiKey = cosmosApiKey();
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
          const signedXdr = signXdr(network, session.secret, op.xdr);
          const res = await cpSubmitLiquidity(apiKey, op.id, signedXdr);
          if (res.submitted) {
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
            setSuccessInfo({ kind: 'err', title: t('lp.withdrawFailed'), msg: res.reason || codes || t('lp.withdrawFailed'), rows: [] });
            setScreen('success');
          }
        } catch (e) {
          setSuccessInfo({ kind: 'err', title: t('lp.withdrawFailed'), msg: (e as Error).message, rows: [] });
          setScreen('success');
        } finally {
          setBusy(false);
        }
      });
    },
    [session, cosmosApiKey, network, requestSignature, refresh, exclusive, guardSession, t],
  );

  /** Create a shareable CosmosPay pay link (SEP-7 pay intent) addressed to this wallet. */
  const createPayLink = useCallback(
    async (input: { amount?: string; assetCode?: string; assetIssuer?: string; memo?: string; msg?: string }): Promise<PayIntent | null> => {
      if (!meta) return null;
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return null;
      }
      try {
        return await cpCreatePayLink(apiKey, { destination: meta.publicKey, ...input });
      } catch (e) {
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
      setReceivers(await cpListReceivers(apiKey));
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
        const list = await saveCosmosPay(meta.id, account, session.password);
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
        setBankAccounts(await cpListBankAccounts(apiKey, receiverId));
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
        const match = existing.find((w) => w.address === meta.publicKey && (!w.network || w.network === net));
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
          const signed = signXdr(network, session.secret, xdr);
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
    [session, account, cosmosPay, network, requestSignature, refresh, exclusive, guardSession, t, flash],
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
   * same vault with the same 210k-iteration derivation and is reachable from a prompt a
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
   * The device check produces the PASSWORD and then goes through the ordinary
   * `unlock()`, which still has to decrypt the vault with it. Nothing here is a
   * second way in — a wrong or stale envelope fails exactly like a typo would.
   */
  const unlockWithDevice = useCallback(async () => {
    const res = await deviceAuthPrivileged.deviceAuthUnlock('unlock');
    if (!res.ok) {
      flashDeviceAuth(res.failure, res.detail);
      return false;
    }
    const out = await unlock(res.password);
    if (!out.ok && out.reason === 'wrong') {
      // A password the ENVELOPE produced cannot be a typo. It failing to decrypt means the
      // envelope and the vault are out of step — a password change interrupted before the
      // re-enrolment, or storage restored from another device — and nothing about that
      // improves on the next attempt. Left standing, the button walks the owner up the
      // failed-attempt ladder with their own fingerprint until they are locked out for
      // five minutes, with "wrong password" as the only explanation.
      await deviceAuthPrivileged.disableDeviceUnlock();
      flashDeviceAuth('stale');
    }
    return out.ok;
  }, [deviceAuthPrivileged, flashDeviceAuth, unlock]);

  /**
   * Signing gate: answer the password prompt with the device check.
   *
   * Verifies the recovered password rather than resolving the gate outright. The gate's
   * contract is "this person can produce the password", so an envelope that no longer
   * decrypts must FAIL it — resolving on the strength of the OS prompt alone would let a
   * stale enrolment sign.
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
      // Through `checkPassword`, not a bare `verifyPassword`: this runs the same 210k
      // derivation as every other password path, so leaving it outside the ladder made it
      // the cheap one — and, because it never called `noteAttemptSuccess`, a correct
      // biometric confirmation did not clear a backoff the user had earned by mistyping.
      const check = await checkPassword(res.password);
      if (!check.ok) {
        // A stale envelope, not a wrong password: the string came from the envelope, not
        // from a keyboard. Throttling is reported as itself.
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
    [deviceAuthPrivileged, flashDeviceAuth, checkPassword, resolveConfirm, flash, t],
  );

  /**
   * Settings: turn the device unlock on or off.
   *
   * Gated with `force` for the same reason the manual-confirmation toggle is — it
   * decides how the wallet can be opened, so an unlocked phone in someone else's
   * hand must not be able to change it silently.
   *
   * Enabling seals the LIVE session password, never a string typed into this screen:
   * the session's copy is only ever set by a successful decrypt, so there is no path
   * that enrols a password which opens nothing.
   *
   * The epoch is captured before the gate and re-checked before the seal, because the OS
   * prompt inside `enableDeviceUnlock` can outlast the auto-lock — sealing afterwards would
   * write a password out of a closure belonging to a session that has ended.
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
    const failed = await deviceAuthPrivileged.enableDeviceUnlock(session.password);
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
   * outlast the 5-minute auto-lock, and sealing after that would write the password out of
   * a closure belonging to a dead session.
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
        const failed = await deviceAuthPrivileged.enableDeviceUnlock(session.password);
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
   * put the state back: `session.password` kept the OLD string, which `switchWallet` then
   * used to open another wallet, `saveCosmosPay` used to re-seal a bearer API key, and —
   * once device auth shipped — `toggleDeviceAuth` used to seal into the device envelope.
   * The last one is the sharpest: it wrote a superseded password into the Keychain, so the
   * user's own fingerprint would answer "wrong password", which is precisely the failure
   * the re-wrap exists to prevent, arriving through a different door.
   *
   * The fix is not to patch the field. `changePassword` re-seals every wallet, so a patched
   * field would assert a password that is true of all of them or none, and the honest
   * answer after a successful change is that this session is over: `lock()` bumps the
   * epoch, so every closure still holding the old session fails closed with "auto-locked"
   * instead of signing under a password that no longer opens anything. The user signs back
   * in with the password they just chose, which also proves it works.
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
        flash(t('pwd.weak'), 'err');
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
          // Last, and only on success: everything above must have committed before the
          // session it belonged to is torn down.
          lock();
          return true;
        } catch (e) {
          flash((e as Error).message, 'err');
          // A failure PAST the commit is not recoverable and not survivable by this
          // session: some wallets are on the new password and `session.password` is true of
          // neither set. Carrying on would let `switchWallet` open a wallet with the wrong
          // string, `saveCosmosPay` re-seal a bearer key under it, and a device enrolment
          // capture it. `lock()` bumps the epoch, so every closure still holding this
          // session fails closed; the user signs back in with whichever password works.
          // A failure BEFORE the commit left the device untouched, so the session stands.
          if (e instanceof PasswordChangeCommitError) lock();
          return false;
        }
      });
      return res.ran && res.value;
    },
    [requestSignature, exclusive, deviceAuthPrivileged, flash, lock, t],
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
   * Exists so `session.secret` never has to leave the store: the screen asks for a
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
      return signXdr(network, session.secret, xdr.trim());
    },
    [session, network, requestSignature, guardSession, t],
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

  /** What a dynamic `back` entry in the screen table may depend on. */
  const backContext = useCallback(
    (): BackContext => ({
      hasSession: !!session,
      tab,
      addingWallet,
      hasDraftMnemonic: draftHasMnemonic && !!draftMnemonic,
    }),
    [session, tab, addingWallet, draftHasMnemonic, draftMnemonic],
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
    cosmosLink,
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
