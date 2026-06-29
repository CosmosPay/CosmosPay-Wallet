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
} from '../lib/wallet';
import {
  addWallet as vaultAddWallet,
  destroyAll,
  getActiveEntry,
  getCustomNetworks,
  getNetworkId,
  listWallets,
  migrate,
  removeWallet as vaultRemoveWallet,
  setActiveId,
  setCustomNetworks as vaultSetCustomNetworks,
  setNetworkId as vaultSetNetworkId,
  unlockWallet,
  verifyPassword,
  type WalletEntry,
} from '../lib/vault';
import {
  addTrustline as stellarAddTrustline,
  allNetworks,
  fundWithFriendbot,
  getAccountState,
  getPrices,
  resolveNetwork,
  sendPayment,
  type AccountState,
  type NetConfig,
  type PriceInfo,
} from '../lib/stellar';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '../lib/i18n';
import { parseStellarQr } from '../lib/sep7';

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
  | 'operations'
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

  const [account, setAccount] = useState<AccountState | null>(null);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);
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
    setToast({ msg: makeT(l)('toast.langChanged', { lang: name }), kind: 'info' });
  }, []);

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

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

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
    (opts: { title: string; message?: string }): Promise<boolean> => {
      if (!savedRequireConfirm()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        confirmResolver.current = resolve;
        setConfirmReq(opts);
      });
    },
    [],
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
    setScreen('unlock');
  }, []);

  /** Wipe EVERY wallet (used by "forgot password" — nothing can be decrypted). */
  const deleteWallet = useCallback(async () => {
    await destroyAll();
    setSession(null);
    setAccount(null);
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
        setMetaState(null);
        setScreen('welcome');
        return;
      }
      const secret = await unlockWallet(newActive, session.password);
      const entry = remaining.find((w) => w.id === newActive)!;
      setMetaState(entry);
      setSession({ publicKey: entry.publicKey, secret: secret.secret, mnemonic: secret.mnemonic, password: session.password });
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
    account,
    prices,
    loading,
    busy,
    toast,
    theme,
    setTheme,
    lang,
    setLang,
    requireConfirm,
    setRequireConfirm,
    confirmReq,
    requestSignature,
    resolveConfirm,
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
    checkPassword,
  };
}

export type WalletStore = ReturnType<typeof useWalletStore>;
