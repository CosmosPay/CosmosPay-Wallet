import { useEffect, useRef, useState } from 'react';
import { useWalletStore, type WalletStore } from './store';
import { Shell, Spinner, Logo } from './parts';
import { Welcome, Backup, Verify, Import, ProfileSetup, PasswordSetup } from './screens/Onboarding';
import { Unlock } from './screens/Unlock';
import { Home, Earn, Markets, Profile, Asset } from './screens/Main';
import { Receive, Send, Confirm, Success, Swap } from './screens/Money';
import { Settings, Export } from './screens/Settings';
import { AddNetwork, AddAsset, ScanQR, Operations, SignTx } from './screens/Extras';

const NAV_SCREENS = ['home', 'earn', 'markets', 'profile', 'swap'];

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
      return store.setScreen(store.draftHasMnemonic && store.draftMnemonic ? 'verify' : 'import');
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
      return store.go(store.session ? 'profile' : 'home', store.session ? 'profile' : 'home');
    case 'operations':
      return store.go('home', 'home');
    case 'sign-tx':
      return store.setScreen('operations');
    case 'add-network':
    case 'add-asset':
      return store.go('home', 'home');
    case 'scan':
      return store.setScreen('send');
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
    case 'operations':
      return <Operations store={store} />;
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

export default function WalletApp() {
  const store = useWalletStore();
  const { screen } = store;

  // Keep a ref to the latest store so the native listener reads current state.
  const storeRef = useRef(store);
  storeRef.current = store;

  // Splash intro: black screen + logo, then fade away revealing the app.
  const [intro, setIntro] = useState<'show' | 'reveal' | 'done'>('show');
  useEffect(() => {
    const t1 = setTimeout(() => setIntro('reveal'), 1300);
    const t2 = setTimeout(() => setIntro('done'), 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

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
        style={{
          opacity: intro === 'show' ? 0 : 1,
          transform: intro === 'show' ? 'scale(1.05)' : 'none',
          transition: 'opacity .8s ease, transform .8s ease',
        }}
      >
        <Shell showGlow showNav={showNav} store={store}>
          {screen === 'boot' ? (
            <Boot />
          ) : (
            // key={screen} remounts on every navigation so the entrance animation replays
            <div key={screen} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {renderScreen(screen, store)}
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity .75s ease',
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '22px' }}>
      <Logo size={84} />
      <Spinner color="var(--text)" />
    </div>
  );
}
