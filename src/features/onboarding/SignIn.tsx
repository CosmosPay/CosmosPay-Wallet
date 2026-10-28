import { useEffect, useState } from 'react';
import type { SignInPurpose, WalletStore } from '@/state/store';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SignInMethods, type SignInStep } from '@/ui/SignInMethods';
import '@/styles/features/onboarding/sign-in.css';

/**
 * Sign in with Cosmos Pay (Authentik), Google, GitHub or an emailed code — and keep the key
 * on this device. Three steps on one screen: the list, the email, the code. The header names
 * each and its back button walks them backwards (the code step back cancels that sign-in).
 *
 * What it states up front is the promise: the key is generated here, and the backup the
 * server keeps is one it cannot open.
 *
 * Where the sign-in leads is the store's call (`routeSignIn`): a backup to restore, a
 * password to choose on a first run, or this device's password to confirm on an unlocked
 * one. On MV3 the provider's consent screen closes this popup, so a sign-in left open is
 * picked up on mount.
 */
export function SignIn({ store }: { store: WalletStore }) {
  const t = store.t;
  const purpose: SignInPurpose = store.hasSession ? 'add' : 'onboarding';
  const [emailStep, setEmailStep] = useState(false);
  const code = store.signInCode;
  const step: SignInStep = code ? 'code' : emailStep ? 'email' : 'list';

  // Once per mount: what this deployment offers, and a sign-in a closed popup left open.
  useEffect(() => {
    void store.loadSignInMethods();
    void store.resumeSignIn(purpose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = step === 'code' ? t('signin.codeTitle') : step === 'email' ? t('signin.emailTitle') : t('signin.chooseTitle');
  const desc =
    step === 'code' && code
      ? t(code.via === 'email' ? 'signin.codeDesc' : 'signin.codeDescExisting', { email: code.email })
      : step === 'email'
        ? t('signin.emailDesc')
        : t('signin.chooseDesc');
  const back =
    step === 'code'
      ? store.cancelSignIn
      : step === 'email'
        ? () => setEmailStep(false)
        : () => {
            store.cancelSignIn();
            store.goBack();
          };

  return (
    <div className="scr screen col">
      {/* Keyed by step, so each step's title and line fade in instead of swapping. */}
      <ScreenHeader key={step} title={title} desc={desc} onBack={back} />
      <SignInMethods
        t={t}
        step={step}
        offer={store.signInMethods}
        phase={store.signInPhase}
        url={store.signInUrl}
        onProvider={(p) => void store.signInWith(p, purpose)}
        onEmailStep={() => setEmailStep(true)}
        onEmail={(email) => void store.signInWithEmail(email)}
        onCode={(c) => void store.submitSignInCode(c, purpose)}
        onCancel={store.cancelSignIn}
      />
      {step === 'list' && (
        <>
          <div className="spacer" />
          <Notice className="sign-in-note">{t('signin.keyNotice')}</Notice>
        </>
      )}
    </div>
  );
}
