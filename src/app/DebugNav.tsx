import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SCREEN_IDS, type Screen } from '@/lib/screens';
import type { WalletStore } from '@/state/store';
import { addWallet, listWallets, unlockSession } from '@/lib/vault';
import { WrongPasswordError, deriveVaultKey, newKdfParams } from '@/lib/crypto';
import { accountFromMnemonic } from '@/lib/wallet';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { DEBUG_NAV_KEY, DEBUG_WALLET_NAME, DEBUG_WALLET_PASSWORD, DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { Sheet } from '@/ui/Sheet';
import { CheckRow } from '@/ui/CheckRow';
import { CloseIcon } from '@/ui/Icons';
import '@/styles/app/debug-nav.css';

/**
 * The debug navigator: every screen one tap away, without the onboarding, the email code or the
 * passkey in front of it. Mounted by WalletApp only in a dev build (`import.meta.env.DEV`), so a
 * production bundle has neither this module nor its test wallet.
 *
 * A screen that needs a session opens one on the test wallet first (`constants/debug.ts`): created
 * on a browser with no wallet, unlocked with its password on one that has it. "Reopen on reload"
 * does the same after a reload and returns to the last screen, so a full reload costs nothing.
 * Copy is English on purpose: this is a developer tool, never end-user UI.
 */

/** The way in: the screens that make sense without a session. Every other one opens one first. */
const ENTRY_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'welcome',
  'backup-choice',
  'restore-choice',
  'backup',
  'verify',
  'import',
  'easy-recovery-receive',
  'import-wallet',
  'profile-setup',
  'password',
  'sign-in',
  'sign-in-password',
  'recover',
  'unlock',
]);

const SCREENS_LISTED = SCREEN_IDS.filter((s) => s !== 'boot');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Screens that show a flow's data get some before arriving, or they would have nothing to show.
 * `true` = the preparation navigated already (the store's own action went there).
 */
const PREPARE: Partial<Record<Screen, (store: () => WalletStore) => Promise<boolean>>> = {
  backup: async (store) => {
    await store().startCreate();
    return true;
  },
  verify: async (store) => {
    await store().startCreate();
    await wait(50); // let the new phrase render before the check reads it
    store().beginVerify();
    return true;
  },
  'profile-setup': async (store) => {
    await store().startCreate();
    await wait(50);
    return false;
  },
  password: async (store) => {
    await store().startCreate();
    await wait(50);
    return false;
  },
  asset: async (store) => {
    store().setSelectedAsset('XLM');
    return false;
  },
  success: async (store) => {
    store().setSuccessInfo({ title: 'Debug', msg: 'A sample success screen.', rows: [{ label: 'Amount', val: '10 XLM' }] });
    return false;
  },
};

interface NavPrefs {
  reopen: boolean;
  last: Screen | null;
}

function readPrefs(): NavPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(DEBUG_NAV_KEY) ?? '{}') as Partial<NavPrefs>;
    const last = p.last && (SCREEN_IDS as readonly string[]).includes(p.last) ? p.last : null;
    return { reopen: p.reopen === true, last };
  } catch {
    return { reopen: false, last: null };
  }
}

function writePrefs(p: NavPrefs): void {
  try {
    localStorage.setItem(DEBUG_NAV_KEY, JSON.stringify(p));
  } catch {
    // private window or blocked storage: the navigator still works, it just forgets
  }
}

/** A session on the test wallet. Null when it opened; otherwise what stopped it. */
async function openTestSession(store: WalletStore): Promise<string | null> {
  if (!store.devOpenSession) return 'Dev builds only.';
  try {
    if ((await listWallets()).length === 0) {
      const vaultKey = await deriveVaultKey(DEBUG_WALLET_PASSWORD, newKdfParams());
      const acc = await accountFromMnemonic(DEBUG_WALLET_PHRASE);
      const entry = await addWallet(
        { secret: acc.secret, mnemonic: DEBUG_WALLET_PHRASE },
        { publicKey: acc.publicKey, name: DEBUG_WALLET_NAME, birthdate: '1990-01-01', email: '', gender: 'x' },
        vaultKey,
      );
      await store.devOpenSession(entry, vaultKey);
      return null;
    }
    // Every wallet on a device is sealed under one key, so the test password opens the device
    // only when the test wallet is what set it.
    const { entry, vaultKey } = await unlockSession(DEBUG_WALLET_PASSWORD);
    await store.devOpenSession(entry, vaultKey);
    return null;
  } catch (e) {
    if (e instanceof WrongPasswordError) {
      return 'This browser already holds a wallet with another password. Unlock it by hand, or open the wallet in a private window.';
    }
    return (e as Error).message || String(e);
  }
}

export function DebugNav({ store }: { store: WalletStore }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const titleId = useId();
  // The store object is replaced on every render; async steps read the latest one.
  const latest = useRef(store);
  latest.current = store;
  const getStore = () => latest.current;

  const updatePrefs = (patch: Partial<NavPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });

  // Remember where the person is, for "reopen on reload". The way in is never remembered: a
  // reload passes through unlock or welcome, and that must not overwrite the screen to return to.
  const { screen } = store;
  useEffect(() => {
    if (screen !== 'boot' && !ENTRY_SCREENS.has(screen)) updatePrefs({ last: screen });
  }, [screen]);

  const arrive = async (s: Screen) => {
    const navigated = await PREPARE[s]?.(getStore);
    if (!navigated) getStore().setScreen(s);
  };

  // After a reload: once per page, when the app lands on its way in with no session.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !prefs.reopen || store.hasSession || (screen !== 'unlock' && screen !== 'welcome')) return;
    reopened.current = true;
    void (async () => {
      const err = await openTestSession(getStore());
      if (err) return setNote(err);
      if (prefs.last) await arrive(prefs.last);
    })();
  }, [screen, store.hasSession, prefs]);

  const jump = async (s: Screen) => {
    setBusy(true);
    setNote(null);
    try {
      if (!ENTRY_SCREENS.has(s) && !getStore().hasSession) {
        const err = await openTestSession(getStore());
        if (err) return setNote(err);
      }
      await arrive(s);
      setOpen(false);
      setQuery('');
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = SCREENS_LISTED.filter((s) => !q || s.includes(q));
    return [
      { title: 'Way in (no session)', screens: shown.filter((s) => ENTRY_SCREENS.has(s)) },
      { title: 'With a session', screens: shown.filter((s) => !ENTRY_SCREENS.has(s)) },
    ].filter((g) => g.screens.length > 0);
  }, [query]);

  const lockNow = () => {
    store.lock();
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="debug-nav-trigger" aria-label="Open the debug navigator" onClick={() => setOpen(true)}>
        Debug
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            Debug navigator
          </h2>
          <button type="button" className="sheet-close ink" aria-label="Close" onClick={() => setOpen(false)} {...inkHandlers}>
            <CloseIcon />
          </button>
        </div>
        <div className="debug-nav-body">
          <div className="debug-nav-session">
            <span className="debug-nav-state">
              {store.hasSession ? `Session open · ${store.meta?.name ?? ''}` : 'No session'}
              <span className="debug-nav-hint">
                Test wallet password: <code>{DEBUG_WALLET_PASSWORD}</code>
              </span>
            </span>
            {store.hasSession ? (
              <button type="button" className="debug-nav-action" onClick={lockNow} disabled={busy}>
                Lock
              </button>
            ) : (
              <button type="button" className="debug-nav-action" onClick={() => void jump('home')} disabled={busy}>
                Open test session
              </button>
            )}
          </div>
          <CheckRow on={prefs.reopen} onToggle={() => updatePrefs({ reopen: !prefs.reopen })} className="debug-nav-reopen">
            Reopen the test session on reload, on the last screen
          </CheckRow>
          {note && (
            <p role="alert" className="debug-nav-note">
              {note}
            </p>
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Search a screen"
            aria-label="Search a screen"
            className="input debug-nav-search"
            data-autofocus
          />
          <div className="debug-nav-list">
            {groups.map((g) => (
              <div key={g.title} role="group" aria-label={g.title} className="debug-nav-group">
                <div className="debug-nav-group-head">{g.title}</div>
                <div className="debug-nav-grid">
                  {g.screens.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      aria-current={s === screen ? 'page' : undefined}
                      onClick={() => void jump(s)}
                      className={cx('debug-nav-item', s === screen && 'is-on')}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}
