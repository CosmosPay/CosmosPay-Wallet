/**
 * The wallet store: a single hook holding all app state + actions.
 * Instantiated once in <WalletApp/> and passed down to every screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  accountFromMnemonic,
  createMnemonic,
  importAccount,
  type DerivedAccount,
} from '@/lib/wallet';
import {
  addWallet as vaultAddWallet,
  clearPendingCosmosPay,
  destroyAll,
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
  type WalletEntry,
} from '@/lib/vault';
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
  extractUnsignedXdr,
  getReceiver as cpGetReceiver,
  linkCosmosAccount,
  listBankAccounts as cpListBankAccounts,
  listReceivers as cpListReceivers,
  listReceiverWallets as cpListReceiverWallets,
  offrampQuote as cpOfframpQuote,
  onrampQuote as cpOnrampQuote,
  quoteSwap as cpQuoteSwap,
  registerCosmosAccount,
  submitSwap as cpSubmitSwap,
  uploadKycDoc as cpUploadKycDoc,
  verifyCosmosLink,
  DEFAULT_SLIPPAGE_BPS,
  type BankAccount,
  type CreateReceiverInput,
  type FiatToken,
  type Payin,
  type PayinQuote,
  type PayinQuoteInput,
  type PayIntent,
  type PayoutQuote,
  type Receiver,
  type SwapQuote,
} from '@/lib/cosmospay';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '@/lib/i18n';
import { parseStellarQr } from '@/lib/sep7';

export type Theme = 'dark' | 'light';

function savedTheme(): Theme {
  try {
    return localStorage.getItem('cosmos.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Manual signing confirmations (password prompt before any signing action). Default ON. */
function savedRequireConfirm(): boolean {
  try {
    return localStorage.getItem('cosmos.confirm') !== 'off';
  } catch {
    return true;
  }
}

// Apply the persisted theme to <html> as early as possible (module load, before
// first paint) so there's no flash of the wrong theme.
try {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', savedTheme());
  }
} catch {
  /* non-browser context */
}

export type Screen =
  | 'boot'
  | 'welcome'
  | 'backup'
  | 'verify'
  | 'import'
  | 'profile-setup'
  | 'password'
  | 'unlock'
  | 'home'
  | 'earn'
  | 'markets'
  | 'profile'
  | 'asset'
  | 'receive'
  | 'send'
  | 'swap'
  | 'select'
  | 'confirm'
  | 'success'
  | 'export'
  | 'settings'
  | 'about'
  | 'operations'
  | 'history'
  | 'paylink'
  | 'fiat'
  | 'cosmospay'
  | 'bankaccount'
  | 'deposit'
  | 'withdraw'
  | 'sign-tx'
  | 'add-network'
  | 'add-asset'
  | 'scan';

export type Tab = 'home' | 'earn' | 'markets' | 'profile';

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

export interface Toast {
  msg: string;
  kind: 'ok' | 'err' | 'info';
}

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

export interface VerifyTarget {
  index: number;
  word: string;
}

export interface SendDraft {
  to: string;
  amount: string;
  memo: string;
  asset: string;
}

const ACCENT = '#ffffff';

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
  if (typeof navigator === 'undefined' || typeof navigator.registerProtocolHandler !== 'function') return;
  try {
    navigator.registerProtocolHandler('web+stellar', window.location.origin + '/?uri=%s');
  } catch {
    /* not permitted here (native app / extension / insecure origin) — ignore */
  }
}

export function useWalletStore() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [tab, setTab] = useState<Tab>('home');
  const [networkId, setNetworkIdState] = useState<string>('testnet');
  const [customNetworks, setCustomNetworksState] = useState<NetConfig[]>([]);
  const networks = useMemo(() => allNetworks(customNetworks), [customNetworks]);
  const network = useMemo(() => resolveNetwork(networkId, customNetworks), [networkId, customNetworks]);
  const [meta, setMetaState] = useState<WalletEntry | null>(null);
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [addingWallet, setAddingWallet] = useState(false);
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

  const [account, setAccount] = useState<AccountState | null>(null);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryOp[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /** Load the active wallet's recent on-chain activity (payments/swaps) from Horizon. */
  const loadHistory = useCallback(async () => {
    if (!meta) return;
    setHistoryLoading(true);
    try {
      setHistory(await getHistory(network, meta.publicKey, 40));
    } finally {
      setHistoryLoading(false);
    }
  }, [meta, network]);
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const [lang, setLangState] = useState<Lang>(savedLang);
  const [requireConfirm, setRequireConfirmState] = useState<boolean>(savedRequireConfirm);
  const t = useMemo(() => makeT(lang), [lang]);
  const locale = useMemo(() => localeOf(lang), [lang]);

  const setRequireConfirm = useCallback((on: boolean) => {
    setRequireConfirmState(on);
    try {
      localStorage.setItem('cosmos.confirm', on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    try {
      document.documentElement.setAttribute('data-theme', th);
      localStorage.setItem('cosmos.theme', th);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', th === 'light' ? '#eceef1' : '#080808');
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
    try {
      document.documentElement.setAttribute('lang', l);
    } catch {
      /* ignore */
    }
    const name = LANGUAGES.find((x) => x.code === l)?.name ?? l;
    // Use flash (not raw setToast) so the notification auto-dismisses.
    flash(makeT(l)('toast.langChanged', { lang: name }), 'info');
  }, [flash]);

  // onboarding drafts
  const [draftMnemonic, setDraftMnemonic] = useState<string>('');
  const [draftAccount, setDraftAccount] = useState<DerivedAccount | null>(null);
  const [draftHasMnemonic, setDraftHasMnemonic] = useState(true);
  const [importText, setImportText] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBirthdate, setDraftBirthdate] = useState('');
  const [draftEmail, setDraftEmail] = useState('');

  // verify-phrase state
  const [verifyTargets, setVerifyTargets] = useState<VerifyTarget[]>([]);
  const [verifyFilled, setVerifyFilled] = useState<Record<number, string>>({});
  const [verifyBank, setVerifyBank] = useState<string[]>([]);

  // money flows
  const [send, setSend] = useState<SendDraft>({ to: '', amount: '0', memo: '', asset: 'XLM' });
  const [selectedAsset, setSelectedAsset] = useState<string>('XLM');
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  // SEP-7 payment links (web+stellar:pay?…) — pasted, scanned, or arriving via URL.
  const pendingSep7 = useRef<string | null>(null);
  const applySep7 = useCallback((raw: string): boolean => {
    const parsed = parseStellarQr(raw);
    if (!parsed) return false;
    setSend((s) => ({
      ...s,
      to: parsed.destination,
      amount: parsed.amount ?? s.amount,
      memo: parsed.memo ? parsed.memo.slice(0, 28) : s.memo,
    }));
    return true;
  }, []);

  // Signing-confirmation gate: every signing action runs through requestSignature,
  // which (when manual confirmations are on) shows a password prompt and only
  // resolves true once the password is verified. Toggle lives in Settings.
  const [confirmReq, setConfirmReq] = useState<{ title: string; message?: string } | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);

  const requestSignature = useCallback(
    (opts: { title: string; message?: string }, force = false): Promise<boolean> => {
      // `force` ignores the toggle — used to gate the toggle itself (and other
      // security-critical actions) so they always require the password.
      if (!force && !savedRequireConfirm()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        confirmResolver.current = resolve;
        setConfirmReq(opts);
      });
    },
    [],
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

  const resolveConfirm = useCallback((okSig: boolean) => {
    setConfirmReq(null);
    const r = confirmResolver.current;
    confirmResolver.current = null;
    r?.(okSig);
  }, []);

  /* ----------------------------- boot ----------------------------- */
  useEffect(() => {
    // SEP-7: become the browser handler for web+stellar: links + pick up an incoming one.
    registerStellarHandler();
    const incoming = readIncomingSep7();
    if (incoming) pendingSep7.current = incoming;

    (async () => {
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
        const [acc, pr] = await Promise.all([
          getAccountState(network, session.publicKey),
          getPrices(),
        ]);
        setAccount(acc);
        if (Object.keys(pr).length) setPrices(pr);
      } catch (e) {
        flash((e as Error).message || 'No se pudieron cargar los datos.', 'err');
      } finally {
        setLoading(false);
      }
    },
    [session, network, flash],
  );

  // reload whenever the session opens or the network changes
  useEffect(() => {
    if (session) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, network]);

  /* --------------------------- onboarding ------------------------- */
  const startCreate = useCallback(async () => {
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
          { publicKey: draftAccount.publicKey, name: draftName.trim() || 'astronauta', birthdate: draftBirthdate, email: draftEmail.trim() },
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
    [draftAccount, draftMnemonic, draftHasMnemonic, draftName, draftBirthdate, draftEmail, addingWallet, session, t, flash],
  );

  /* ----------------------------- unlock --------------------------- */
  const unlock = useCallback(
    async (password: string) => {
      setBusy(true);
      try {
        const active = await getActiveEntry();
        if (!active) throw new Error('No hay ninguna wallet guardada en este dispositivo.');
        const secret = await unlockWallet(active.id, password);
        setMetaState(active);
        setWallets(await listWallets());
        setSession({ publicKey: active.publicKey, secret: secret.secret, mnemonic: secret.mnemonic, password });
        setCosmosPay(await getCosmosPay(active.id, password));
        setCosmosPayPending(await getPendingCosmosPay(active.id));
        setTab('home');
        setScreen('home');
        return true;
      } catch (e) {
        flash((e as Error).message, 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flash],
  );

  const lock = useCallback(() => {
    setSession(null);
    setAccount(null);
    setCosmosPay(null);
    setCosmosPayPending(null);
    setScreen('unlock');
  }, []);

  /** Wipe EVERY wallet (used by "forgot password" — nothing can be decrypted). */
  const deleteWallet = useCallback(async () => {
    await destroyAll();
    setSession(null);
    setAccount(null);
    setCosmosPay(null);
    setCosmosPayPending(null);
    setMetaState(null);
    setWallets([]);
    setDraftAccount(null);
    setDraftMnemonic('');
    setScreen('welcome');
  }, []);

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
        setAccount(null);
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
        setAccount(null);
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
      setAccount(null);
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
      setAccount(null);
    },
    [],
  );

  const addNetwork = useCallback(
    async (cfg: Omit<NetConfig, 'id' | 'custom'>) => {
      const id = 'custom-' + Math.random().toString(36).slice(2, 9);
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
      const okSig = await requestSignature({
        title: t('confirmSig.trustTitle'),
        message: t('confirmSig.trustMsg', { code: code.trim() }),
      });
      if (!okSig) return false;
      setBusy(true);
      try {
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
    [session, network, refresh, requestSignature, t, flash],
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
    const code0 = send.asset || 'XLM';
    const okSig = await requestSignature({
      title: t('confirmSig.sendTitle'),
      message: t('confirmSig.sendMsg', { amount: send.amount, code: code0 }),
    });
    if (!okSig) return;
    setBusy(true);
    try {
      // Resolve the selected asset's issuer from the held balances (XLM = native).
      const code = send.asset || 'XLM';
      const bal = account?.balances.find((b) => b.code === code && !b.isNative);
      const asset = code === 'XLM' || !bal?.issuer ? null : { code, issuer: bal.issuer };
      const { hash } = await sendPayment({
        cfg: network,
        secret: session.secret,
        destination: send.to.trim(),
        amount: send.amount,
        memo: send.memo,
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
      setSend({ to: '', amount: '0', memo: '', asset: 'XLM' });
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
  }, [session, network, send, account, refresh, requestSignature, t, flash]);

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
    const ok = await requestSignature({
      title: t('cosmospay.enableTitle'),
      message: t('cosmospay.enableConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
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
      };
      await savePendingCosmosPay(meta.id, pending);
      setCosmosPayPending(pending);
      flash(t('cosmospay.checkEmail'), 'ok');
    } catch (e) {
      flash((e as Error).message || t('cosmospay.error'), 'err');
    } finally {
      setBusy(false);
    }
  }, [session, meta, requestSignature, t, flash]);

  /**
   * Claim the API key for a pending registration once the user confirmed by
   * email. `silent` is used by the background poller (no spinner, no "not
   * confirmed yet" toast). Persists the key sealed (saveCosmosPay) on success.
   */
  const claimReceiving = useCallback(
    async (silent = false) => {
      if (!session || !meta || !cosmosPayPending) return;
      const pending = cosmosPayPending;
      if (!silent) setBusy(true);
      try {
        const res = await claimCosmosAccount({
          stellarAddress: pending.stellarAddress,
          claimToken: pending.claimToken,
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
    [session, meta, cosmosPayPending, t, flash],
  );

  /**
   * Start linking this wallet to an EXISTING account (the email already had one — see the
   * `exists` branch of enableReceiving). Password-gates the Stellar signature, then asks the
   * server to email a one-time access code. On success we move to the 'sent' stage.
   */
  const linkReceiving = useCallback(async () => {
    if (!session || !meta || !meta.email) return;
    const ok = await requestSignature({
      title: t('cosmospay.linkTitle'),
      message: t('cosmospay.linkConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
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
  }, [session, meta, requestSignature, t, flash]);

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
    async (amount: string, from: SwapAsset, to: SwapAsset) => {
      if (!session) return;
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return;
      }
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
    },
    [session, cosmosPay, network, requestSignature, refresh, t, flash],
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
    async (quote: PayoutQuote, token: FiatToken): Promise<boolean> => {
      if (!session) return false;
      const apiKey = cosmosPay?.keys[networkEnv(network)] ?? null;
      if (!apiKey) {
        flash(t(cosmosPay ? 'cosmospay.noKeyForNetwork' : 'cosmospay.enableFirst'), 'info');
        return false;
      }
      const okSig = await requestSignature({ title: t('confirmSig.withdrawTitle'), message: t('confirmSig.withdrawMsg') });
      if (!okSig) return false;
      setBusy(true);
      try {
        const auth = await cpAuthorizePayout(apiKey, { quote_id: quote.id, sender_wallet_address: session.publicKey, chain: 'stellar' });
        const xdr = extractUnsignedXdr(auth);
        if (!xdr) throw new Error(t('fiat.noXdr'));
        const signed = signXdr(network, session.secret, xdr);
        const payout = await cpCreatePayout(apiKey, { quote_id: quote.id, sender_wallet_address: session.publicKey, chain: 'stellar', signed_transaction: signed });
        const fiatMinor = quote.receiver_local_amount || quote.receiver_amount || 0;
        const sent = payout.senderAmount ?? (quote.sender_amount != null ? (quote.sender_amount / 100).toFixed(2) : '');
        const got = payout.receiverAmount ?? (fiatMinor ? (fiatMinor / 100).toFixed(2) : '');
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
    },
    [session, cosmosPay, network, requestSignature, refresh, t, flash],
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
  const checkPassword = useCallback((pwd: string) => verifyPassword(pwd), []);

  /* --------------------------- navigation ------------------------- */
  const go = useCallback((s: Screen, t?: Tab) => {
    setScreen(s);
    if (t) setTab(t);
  }, []);

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
    session,
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
    verifyTargets,
    verifyFilled,
    verifyBank,
    verifyOk,
    send,
    selectedAsset,
    successInfo,
    // setters used by screens
    setScreen,
    setTab,
    setImportText,
    setDraftName,
    setDraftBirthdate,
    setDraftEmail,
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
    deleteWallet,
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
    claimReceiving,
    linkReceiving,
    submitLinkCode,
    cancelLink,
    quoteSwap,
    submitSwap,
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
  };
}

export type WalletStore = ReturnType<typeof useWalletStore>;
