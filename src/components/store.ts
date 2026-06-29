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
  getNetwork,
  listWallets,
  migrate,
  removeWallet as vaultRemoveWallet,
  setActiveId,
  setNetwork as vaultSetNetwork,
  unlockWallet,
  verifyPassword,
  type WalletEntry,
} from '../lib/vault';
import {
  fundWithFriendbot,
  getAccountState,
  getPrices,
  NETWORKS,
  sendXlm,
  type AccountState,
  type PriceInfo,
  type StellarNetwork,
} from '../lib/stellar';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '../lib/i18n';

export type Theme = 'dark' | 'light';

function savedTheme(): Theme {
  try {
    return localStorage.getItem('cosmos.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
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
  | 'settings';

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

export function useWalletStore() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [tab, setTab] = useState<Tab>('home');
  const [network, setNetwork] = useState<StellarNetwork>('testnet');
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
  const t = useMemo(() => makeT(lang), [lang]);
  const locale = useMemo(() => localeOf(lang), [lang]);

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

  /* ----------------------------- boot ----------------------------- */
  useEffect(() => {
    (async () => {
      await migrate();
      const [list, active, net] = await Promise.all([listWallets(), getActiveEntry(), getNetwork()]);
      setWallets(list);
      setNetwork(net);
      if (active) setMetaState(active);
      setScreen(list.length > 0 ? 'unlock' : 'welcome');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          { publicKey: draftAccount.publicKey, name: draftName.trim() || 'astronauta', birthdate: draftBirthdate },
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
    [draftAccount, draftMnemonic, draftHasMnemonic, draftName, draftBirthdate, addingWallet, session, t, flash],
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

  /* ------------------------- multi-wallet ------------------------- */
  const startAddWallet = useCallback(() => {
    setAddingWallet(true);
    setDraftAccount(null);
    setDraftMnemonic('');
    setImportText('');
    setDraftName('');
    setDraftBirthdate('');
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
    async (net: StellarNetwork) => {
      setNetwork(net);
      await vaultSetNetwork(net);
      flash(t('toast.network', { net: NETWORKS[net].label }), 'info');
    },
    [t, flash],
  );

  /* ----------------------------- money ---------------------------- */
  const fund = useCallback(async () => {
    if (!session) return;
    if (network !== 'testnet') {
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
    setBusy(true);
    try {
      const { hash } = await sendXlm({
        network,
        secret: session.secret,
        destination: send.to.trim(),
        amount: send.amount,
        memo: send.memo,
      });
      setSuccessInfo({
        title: t('success.sent'),
        msg: t('success.sentMsg'),
        rows: [
          { label: t('confirm.amount'), val: `${send.amount} XLM` },
          { label: t('confirm.to'), val: `${send.to.slice(0, 6)}…${send.to.slice(-6)}` },
        ],
        hash,
      });
      setScreen('success');
      setSend({ to: '', amount: '0', memo: '', asset: 'XLM' });
      refresh(true);
    } catch (e) {
      flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }, [session, network, send, refresh, t, flash]);

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
    t,
    locale,
    accent: ACCENT,
    draftMnemonic,
    draftAccount,
    draftHasMnemonic,
    importText,
    draftName,
    draftBirthdate,
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
    setSend,
    setSelectedAsset,
    setSuccessInfo,
    flash,
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
    startAddWallet,
    cancelAddWallet,
    switchWallet,
    removeActiveWallet,
    switchNetwork,
    fund,
    submitSend,
    checkPassword,
  };
}

export type WalletStore = ReturnType<typeof useWalletStore>;
