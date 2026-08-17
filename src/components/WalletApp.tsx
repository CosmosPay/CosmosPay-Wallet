import '@/styles/components/wallet-app.css';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NAV_SCREENS, SPLASH_REVEAL_MS, SPLASH_DONE_MS } from '@/constants/app';
import { useWalletStore, type WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { Shell, Spinner, Logo } from '@/components/parts';
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary';

// ---------------------------------------------------------------------------
// Eager imports (Onboarding, Unlock, and Home/Balance)
// ---------------------------------------------------------------------------
import {
  Welcome,
  Backup,
  Verify,
  Import,
  ProfileSetup,
  PasswordSetup,
} from '@/components/screens/Onboarding';
import { Unlock } from '@/components/screens/Unlock';
import { Home } from '@/components/screens/main/Home';

// ---------------------------------------------------------------------------
// Lazy-loaded screen chunks
// ---------------------------------------------------------------------------
const Earn = lazy(() =>
  import('@/components/screens/main/Earn').then((m) => ({ default: m.Earn }))
);
const Markets = lazy(() =>
  import('@/components/screens/main/Markets').then((m) => ({ default: m.Markets }))
);
const Profile = lazy(() =>
  import('@/components/screens/main/Profile').then((m) => ({ default: m.Profile }))
);
const Asset = lazy(() =>
  import('@/components/screens/main/Asset').then((m) => ({ default: m.Asset }))
);
const EditProfile = lazy(() =>
  import('@/components/screens/main/EditProfile').then((m) => ({
    default: m.EditProfile,
  }))
);

const Receive = lazy(() =>
  import('@/components/screens/money/Receive').then((m) => ({ default: m.Receive }))
);
const Send = lazy(() =>
  import('@/components/screens/money/Send').then((m) => ({ default: m.Send }))
);
const Confirm = lazy(() =>
  import('@/components/screens/money/Confirm').then((m) => ({ default: m.Confirm }))
);
const Success = lazy(() =>
  import('@/components/screens/money/Success').then((m) => ({ default: m.Success }))
);
const Swap = lazy(() =>
  import('@/components/screens/money/Swap').then((m) => ({ default: m.Swap }))
);
const History = lazy(() =>
  import('@/components/screens/money/History').then((m) => ({ default: m.History }))
);
const PayLink = lazy(() =>
  import('@/components/screens/money/PayLink').then((m) => ({ default: m.PayLink }))
);

const Settings = lazy(() =>
  import('@/components/screens/settings/Settings').then((m) => ({
    default: m.Settings,
  }))
);
const Export = lazy(() =>
  import('@/components/screens/settings/Export').then((m) => ({ default: m.Export }))
);
const About = lazy(() =>
  import('@/components/screens/settings/About').then((m) => ({ default: m.About }))
);

const AddNetwork = lazy(() =>
  import('@/components/screens/extras/AddNetwork').then((m) => ({
    default: m.AddNetwork,
  }))
);
const AddAsset = lazy(() =>
  import('@/components/screens/extras/AddAsset').then((m) => ({
    default: m.AddAsset,
  }))
);
const ScanQR = lazy(() =>
  import('@/components/screens/extras/ScanQR').then((m) => ({ default: m.ScanQR }))
);
const Operations = lazy(() =>
  import('@/components/screens/extras/Operations').then((m) => ({
    default: m.Operations,
  }))
);
const SignTx = lazy(() =>
  import('@/components/screens/extras/SignTx').then((m) => ({ default: m.SignTx }))
);

const Fiat = lazy(() =>
  import('@/components/screens/fiat/Fiat').then((m) => ({ default: m.Fiat }))
);
const BankAccount = lazy(() =>
  import('@/components/screens/fiat/BankAccount').then((m) => ({
    default: m.BankAccount,
  }))
);
const Deposit = lazy(() =>
  import('@/components/screens/fiat/Deposit').then((m) => ({ default: m.Deposit }))
);
const Withdraw = lazy(() =>
  import('@/components/screens/fiat/Withdraw').then((m) => ({ default: m.Withdraw }))
);

const Liquidity = lazy(() =>
  import('@/components/screens/liquidity/Liquidity').then((m) => ({
    default: m.Liquidity,
  }))
);
const LpDeposit = lazy(() =>
  import('@/components/screens/liquidity/Deposit').then((m) => ({
    default: m.LpDeposit,
  }))
);
const LpWithdraw = lazy(() =>
  import('@/components/screens/liquidity/Withdraw').then((m) => ({
    default: m.LpWithdraw,
  }))
);

const CosmosPay = lazy(() =>
  import('@/components/screens/CosmosPay').then((m) => ({ default: m.CosmosPay }))
);

/** Map the Android hardware back button to a sensible in-app navigation. */
function handleBack(store: WalletStore, exitApp: () => void) {
  switch (store.screen) {
    case 'welcome':
      if (store.addingWallet) return store.cancelAddWallet();
      return exitApp();
    case 'backup':
      return store.setScreen('welcome');
    case 'verify':
      return store.setScreen('backup');
    case 'import':
      return store.setScreen('welcome');
    case 'profile-setup':
      return store.setScreen(
        store.draftHasMnemonic && store.draftMnemonic ? 'verify' : 'import'
      );
    case 'password':
      return store.setScreen('profile-setup');
    case 'confirm':
      return store.setScreen('send');
    case 'asset':
      return store.go(store.tab, store.tab);
    case 'receive':
    case 'send':
    case 'swap':
      return store.go('home', 'home');
    case 'settings':
    case 'export':
    case 'about':
      return store.go(
        store.session ? 'profile' : 'home',
        store.session ? 'profile' : 'home'
      );
    case 'operations':
      return store.go('home', 'home');
    case 'history':
      return store.go('home', 'home');
    case 'paylink':
      return store.setScreen('receive');
    case 'fiat':
      return store.go('home', 'home');
    case 'cosmospay':
    case 'edit-profile':
      return store.go('profile', 'profile');
    case 'bankaccount':
    case 'deposit':
    case 'withdraw':
      return store.setScreen('fiat');
    case 'sign-tx':
      return store.setScreen('operations');
    case 'add-network':
    case 'add-asset':
      return store.go('home', 'home');
    case 'scan':
      return store.setScreen('send');
    case 'liquidity':
      return store.go('earn', 'earn');
    case 'lp-deposit':
    case 'lp-withdraw':
      return store.setScreen('liquidity');
    case 'success':
      return store.session ? store.go('home', 'home') : store.setScreen('unlock');
    case 'earn':
    case 'markets':
    case 'profile':
      return store.go('home', 'home');
    default:
      // home / welcome / unlock / boot -> leave the app
      exitApp();
  }
}

function renderScreen(screen: WalletStore['screen'], store: WalletStore) {
  switch (screen) {
    case 'welcome':
      return <Welcome store={store} />;
    case 'backup':
      return <Backup store={store} />;
    case 'verify':
      return <Verify store={store} />;
    case 'import':
      return <Import store={store} />;
    case 'profile-setup':
      return <ProfileSetup store={store} />;
    case 'password':
      return <PasswordSetup store={store} />;
    case 'unlock':
      return <Unlock store={store} />;
    case 'home':
      return <Home store={store} />;
    case 'earn':
      return <Earn store={store} />;
    case 'liquidity':
      return <Liquidity store={store} />;
    case 'lp-deposit':
      return <LpDeposit store={store} />;
    case 'lp-withdraw':
      return <LpWithdraw store={store} />;
    case 'markets':
      return <Markets store={store} />;
    case 'profile':
      return <Profile store={store} />;
    case 'asset':
      return <Asset store={store} />;
    case 'receive':
      return <Receive store={store} />;
    case 'send':
      return <Send store={store} />;
    case 'swap':
      return <Swap store={store} />;
    case 'confirm':
      return <Confirm store={store} />;
    case 'success':
      return <Success store={store} />;
    case 'settings':
      return <Settings store={store} />;
    case 'export':
      return <Export store={store} />;
    case 'about':
      return <About store={store} />;
    case 'operations':
      return <Operations store={store} />;
    case 'history':
      return <History store={store} />;
    case 'paylink':
      return <PayLink store={store} />;
    case 'fiat':
      return <Fiat store={store} />;
    case 'cosmospay':
      return <CosmosPay store={store} />;
    case 'edit-profile':
      return <EditProfile store={store} />;
    case 'bankaccount':
      return <BankAccount store={store} />;
    case 'deposit':
      return <Deposit store={store} />;
    case 'withdraw':
      return <Withdraw store={store} />;
    case 'sign-tx':
      return <SignTx store={store} />;
    case 'add-network':
      return <AddNetwork store={store} />;
    case 'add-asset':
      return <AddAsset store={store} />;
    case 'scan':
      return <ScanQR store={store} />;
    default:
      return <Home store={store} />;
  }
}

function ScreenFallback() {
  return (
    <div
      className="col center f1"
      style={{
        minHeight: '240px',
        padding: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spinner color="var(--text)" />
    </div>
  );
}

function WalletAppInner() {
  const store = useWalletStore();
  const { screen } = store;

  // Keep a ref to the latest store so the native listener reads current state.
  const storeRef = useRef(store);
  storeRef.current = store;

  // Splash intro: black screen + logo, then fade away revealing the app.
  const isExt = buildKind() === 'ext';
  const [intro, setIntro] = useState<'show' | 'reveal' | 'done'>(
    isExt ? 'done' : 'show'
  );

  useEffect(() => {
    if (isExt) return;
    const t1 = setTimeout(() => setIntro('reveal'), SPLASH_REVEAL_MS);
    const t2 = setTimeout(() => setIntro('done'), SPLASH_DONE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isExt]);

  // Android hardware back button (native only).
  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        handleBack(storeRef.current, () => App.exitApp());
      });
      remove = () => handle.remove();
    })();
    return () => remove?.();
  }, []);

  const showNav = NAV_SCREENS.includes(screen) && !!store.session;

  return (
    <>
      <div
        className="wallet-app-intro"
        style={{
          opacity: intro === 'show' ? 0 : 1,
          transform: intro === 'show' ? 'scale(1.05)' : 'none',
        }}
      >
        <Shell showNav={showNav} store={store}>
          {screen === 'boot' ? (
            <Boot />
          ) : (
            <div className="col f1 wallet-app-screen">
              <Suspense fallback={<ScreenFallback />}>
                {renderScreen(screen, store)}
              </Suspense>
            </div>
          )}
        </Shell>
      </div>

      {intro !== 'done' && <Splash fading={intro !== 'show'} />}
    </>
  );
}

export default function WalletApp() {
  return (
    <GlobalErrorBoundary>
      <WalletAppInner />
    </GlobalErrorBoundary>
  );
}

function Splash({ fading }: { fading: boolean }) {
  return (
    <div
      className="center splash-overlay"
      style={{
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
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
      <Spinner color="var(--text)" />
    </div>
  );
}
