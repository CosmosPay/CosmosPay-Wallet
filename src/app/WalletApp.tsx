import '@/styles/app/wallet-app.css';
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { SPLASH_REVEAL_MS, SPLASH_DONE_MS } from '@/constants/app';
import { NAV_SCREENS, type Screen } from '@/lib/screens';
import { useWalletStore, type WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { Shell } from '@/app/Shell';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Logo } from '@/ui/Logo';
import { Spinner } from '@/ui/Spinner';
import { Welcome } from '@/features/onboarding/Welcome';
import { Unlock } from '@/features/wallet/Unlock';
import { Home } from '@/features/wallet/Home';
import { Earn } from '@/features/wallet/Earn';
import { Markets } from '@/features/wallet/Markets';
import { Profile } from '@/features/wallet/Profile';
import { cx } from '@/lib/cx';
import { tNow } from '@/lib/i18n';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

type ScreenComponent = ComponentType<{ store: WalletStore }> | LazyExoticComponent<ComponentType<{ store: WalletStore }>>;

/**
 * Screen -> component.
 *
 * Typed `Record<Screen, …>`, so adding an id to SCREEN_IDS without wiring a component
 * is a compile error. The old version was a switch with a `default` that silently
 * rendered <Home/> for an unknown screen.
 *
 * EAGER: welcome, unlock and the four tab screens — the only screens a cold start can
 * land on, plus the tabs, which must switch without flashing a loader.
 * LAZY: everything else. The MV3 popup parses its whole bundle on every open, and
 * fiat/KYC, liquidity, the QR scanner (which drags in jsQR) and the settings screens
 * are not on the path to a balance.
 */
const SCREEN_COMPONENTS: Record<Exclude<Screen, 'boot'>, ScreenComponent> = {
  // eager — first paint + tabs
  welcome: Welcome,
  unlock: Unlock,

  // lazy — the rest of onboarding. Reached only after a tap, and `import` pulls in
  // BIP-39 + SLIP-0010 (~240 KB) that a returning user never needs.
  backup: lazy(() => import('@/features/onboarding/Backup').then((m) => ({ default: m.Backup }))),
  verify: lazy(() => import('@/features/onboarding/Verify').then((m) => ({ default: m.Verify }))),
  import: lazy(() => import('@/features/onboarding/Import').then((m) => ({ default: m.Import }))),
  'profile-setup': lazy(() => import('@/features/onboarding/ProfileSetup').then((m) => ({ default: m.ProfileSetup }))),
  password: lazy(() => import('@/features/onboarding/PasswordSetup').then((m) => ({ default: m.PasswordSetup }))),
  'device-auth': lazy(() => import('@/features/onboarding/DeviceAuthSetup').then((m) => ({ default: m.DeviceAuthSetup }))),
  home: Home,
  earn: Earn,
  markets: Markets,
  profile: Profile,

  // lazy — money
  receive: lazy(() => import('@/features/money/Receive').then((m) => ({ default: m.Receive }))),
  send: lazy(() => import('@/features/money/Send').then((m) => ({ default: m.Send }))),
  swap: lazy(() => import('@/features/money/Swap').then((m) => ({ default: m.Swap }))),
  select: lazy(() => import('@/features/money/Send').then((m) => ({ default: m.Send }))),
  confirm: lazy(() => import('@/features/money/Confirm').then((m) => ({ default: m.Confirm }))),
  success: lazy(() => import('@/features/money/Success').then((m) => ({ default: m.Success }))),
  history: lazy(() => import('@/features/money/History').then((m) => ({ default: m.History }))),
  paylink: lazy(() => import('@/features/money/PayLink').then((m) => ({ default: m.PayLink }))),
  asset: lazy(() => import('@/features/wallet/Asset').then((m) => ({ default: m.Asset }))),
  'edit-profile': lazy(() => import('@/features/wallet/EditProfile').then((m) => ({ default: m.EditProfile }))),

  // lazy — liquidity
  liquidity: lazy(() => import('@/features/liquidity/Liquidity').then((m) => ({ default: m.Liquidity }))),
  'lp-deposit': lazy(() => import('@/features/liquidity/Deposit').then((m) => ({ default: m.Deposit }))),
  'lp-withdraw': lazy(() => import('@/features/liquidity/Withdraw').then((m) => ({ default: m.Withdraw }))),

  // lazy — fiat / CosmosPay
  fiat: lazy(() => import('@/features/fiat/Fiat').then((m) => ({ default: m.Fiat }))),
  bankaccount: lazy(() => import('@/features/fiat/BankAccount').then((m) => ({ default: m.BankAccount }))),
  deposit: lazy(() => import('@/features/fiat/Deposit').then((m) => ({ default: m.Deposit }))),
  withdraw: lazy(() => import('@/features/fiat/Withdraw').then((m) => ({ default: m.Withdraw }))),
  cosmospay: lazy(() => import('@/features/cosmospay/CosmosPay').then((m) => ({ default: m.CosmosPay }))),

  // lazy — settings
  settings: lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.Settings }))),
  export: lazy(() => import('@/features/settings/Export').then((m) => ({ default: m.Export }))),
  about: lazy(() => import('@/features/settings/About').then((m) => ({ default: m.About }))),

  // lazy — extras
  operations: lazy(() => import('@/features/extras/Operations').then((m) => ({ default: m.Operations }))),
  'sign-tx': lazy(() => import('@/features/extras/SignTx').then((m) => ({ default: m.SignTx }))),
  'add-network': lazy(() => import('@/features/extras/AddNetwork').then((m) => ({ default: m.AddNetwork }))),
  'add-asset': lazy(() => import('@/features/extras/AddAsset').then((m) => ({ default: m.AddAsset }))),
  scan: lazy(() => import('@/features/extras/ScanQR').then((m) => ({ default: m.ScanQR }))),
};

/**
 * The outer boundary sits ABOVE `useWalletStore()`.
 *
 * The inner one (around the lazy screen, below) catches a screen that fails to load;
 * it cannot catch a throw inside the store hook, the shell, the toast or the signing
 * prompt — which is the original "blank wallet" failure it was added for. It uses
 * `tNow` rather than `store.t` for the same reason: the store is what may have thrown.
 */
export default function WalletApp() {
  return (
    <ErrorBoundary title={tNow('error.appTitle')} message={tNow('error.screenMsg')} reloadLabel={tNow('error.reload')}>
      <WalletAppShell />
    </ErrorBoundary>
  );
}

function WalletAppShell() {
  const store = useWalletStore();
  const { screen } = store;

  // Publishes --kb-h / .kb-open for the whole document, so every screen's footer can
  // stay above the on-screen keyboard instead of being pushed up over its own content.
  useKeyboardInset();

  // Keep a ref to the latest store so the native listener reads current state.
  const storeRef = useRef(store);
  storeRef.current = store;

  // Splash intro: black screen + logo, then fade away revealing the app. Skipped
  // in the browser-extension popup: a full-screen `position: fixed` overlay + a
  // 2s intro is poor UX in a small popup that opens/closes constantly, and keeping
  // fixed-positioned overlays out of the auto-sizing popup avoids layout surprises.
  const isExt = buildKind() === 'ext';
  const [intro, setIntro] = useState<'show' | 'reveal' | 'done'>(isExt ? 'done' : 'show');
  useEffect(() => {
    if (isExt) return;
    const t1 = setTimeout(() => setIntro('reveal'), SPLASH_REVEAL_MS);
    const t2 = setTimeout(() => setIntro('done'), SPLASH_DONE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isExt]);

  // Android hardware back button (native only). One line now: the store owns the
  // navigation stack and the screen table owns the fallbacks, so this handler no
  // longer keeps its own 30-case copy of the same knowledge.
  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        const s = storeRef.current;
        // `welcome` while adding a wallet is the one case with a side effect.
        if (s.screen === 'welcome' && s.addingWallet) return s.cancelAddWallet();
        if (!s.goBack()) void App.exitApp();
      });
      remove = () => handle.remove();
    })();
    return () => remove?.();
  }, []);

  const showNav = NAV_SCREENS.includes(screen) && store.hasSession;
  const Screen = screen === 'boot' ? null : SCREEN_COMPONENTS[screen];

  return (
    <>
      <div className={cx('wallet-app-intro', intro === 'show' && 'is-hidden')}>
        <Shell showNav={showNav} store={store}>
          {!Screen ? (
            <Boot />
          ) : (
            // key={screen} remounts on every navigation so the entrance animation
            // replays — and, since the boundary lives inside it, so that navigating
            // away from a screen that failed clears the error without a reload.
            <div key={screen} className="col f1 wallet-app-screen">
              <ErrorBoundary
                title={store.t('error.screenTitle')}
                message={store.t('error.screenMsg')}
                reloadLabel={store.t('error.reload')}
                homeLabel={store.t('error.goHome')}
                onHome={() => store.setScreen('home')}
              >
                <Suspense fallback={<Boot />}>
                  <Screen store={store} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </Shell>
      </div>

      {intro !== 'done' && <Splash fading={intro !== 'show'} />}
    </>
  );
}

function Splash({ fading }: { fading: boolean }) {
  return (
    <div className={cx('center splash-overlay', fading && 'is-fading')}>
      <div className="splash-logo">
        <Logo size={116} />
      </div>
    </div>
  );
}

function Boot() {
  return (
    <div className="col center f1 boot-screen">
      <Logo size={84} />
      <Spinner tone="text" />
    </div>
  );
}
