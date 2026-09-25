import { useEffect } from 'react';
import type { SignInPurpose, WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { SignInMethods } from '@/ui/SignInMethods';
import '@/styles/features/onboarding/sign-in.css';

/**
 * Sign in with Cosmos Pay (Authentik), Google, GitHub or an emailed code — and keep the key
 * on this device.
 *
 * It replaced a screen whose whole job was a custody warning: the old social login handed
 * the key to Pollar. This one never does, so what it states up front is the opposite
 * promise and the one condition that comes with it — the key is generated here, the backup
 * the server keeps only opens with the person's password, and nobody can reset that
 * password for them. Said before the sign-in rather than after, because after it the next
 * screen asks for exactly that password.
 *
 * Where the sign-in leads is the store's call (`routeSignIn`): a backup to restore, a
 * password to choose on a first run, or this device's password to confirm on an unlocked
 * one. On MV3 the provider's consent screen closes this popup, so a sign-in left open is
 * picked up on mount.
 */
export function SignIn({ store }: { store: WalletStore }) {
  const t = store.t;
  const purpose: SignInPurpose = store.hasSession ? 'add' : 'onboarding';

  // Once per mount: what this deployment offers, and a sign-in a closed popup left open.
  useEffect(() => {
    void store.loadSignInMethods();
    void store.resumeSignIn(purpose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scr screen col">
      <BackBar
        title={t('signin.title')}
        onBack={() => {
          store.cancelSignIn();
          store.goBack();
        }}
      />
      <div className="sign-in-desc">{t('signin.desc')}</div>
      <div className="glass-soft sign-in-note">{t('signin.keyNote')}</div>
      <SignInMethods
        t={t}
        offer={store.signInMethods}
        phase={store.signInPhase}
        code={store.signInCode}
        url={store.signInUrl}
        onProvider={(p) => void store.signInWith(p, purpose)}
        onEmail={(email) => void store.signInWithEmail(email)}
        onCode={(code) => void store.submitSignInCode(code, purpose)}
        onCancel={store.cancelSignIn}
      />
    </div>
  );
}
