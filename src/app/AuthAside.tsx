import type { WalletStore } from '@/state/store';
import { QuickPrefs } from '@/ui/QuickPrefs';
import { WelcomeHero } from '@/features/onboarding/WelcomeHero';
import '@/styles/app/auth-aside.css';

/**
 * The right half of the pre-session screens on a desktop window: the brand motion, with the
 * language and theme controls in its corner. The flow itself (Welcome's doors, the steps,
 * Unlock) is the left half.
 *
 * Chrome, like the nav rail: `Shell` renders it for `AUTH_SCREENS` without a session and
 * CSS shows it only in desktop mode, so no screen decides it. It lives in the shell rather
 * than in a screen, so the motion keeps looping across the steps instead of restarting on
 * every navigation. The screens mark what it replaces with `.auth-chrome` (their own hero
 * and controls), which the split hides.
 */
export function AuthAside({ store }: { store: WalletStore }) {
  return (
    <aside className="auth-aside">
      <div className="auth-aside-bar">
        <QuickPrefs
          t={store.t}
          lang={store.lang}
          onLang={store.setLang}
          theme={store.theme}
          onTheme={store.setThemePref}
        />
      </div>
      <WelcomeHero theme={store.theme} className="auth-aside-hero" />
    </aside>
  );
}
