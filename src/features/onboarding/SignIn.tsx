import { useEffect, useRef } from 'react';
import type { SignInPurpose, WalletStore } from '@/state/store';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SignInMethods, type SignInStep } from '@/ui/SignInMethods';
import '@/styles/features/onboarding/sign-in.css';

/**
 * Sign in with Cosmos Pay (Authentik), Google, GitHub or an emailed code — and keep the key
 * on this device. Three steps on one screen: the list, the email, the code. Each is a stop on
 * the navigation stack (`goStep`), so every back — the header's, the browser's, the mouse's,
 * the phone's — walks them one at a time. Leaving the code step ends that sign-in, and
 * leaving the screen stops one still waiting on a provider.
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
  const code = store.signInCode;
  const navStep = store.navStep;
  // The code step needs a code: forward onto it after that sign-in ended shows the email.
  const step: SignInStep = code && navStep === 'code' ? 'code' : navStep === 'email' || navStep === 'code' ? 'email' : 'list';

  // Once per mount: what this deployment offers, and a sign-in a closed popup left open.
  // Leaving the screen, by any way back, stops a sign-in still waiting on a provider; a
  // FINISHED one is the store's draft and is untouched, so forward still reaches it.
  useEffect(() => {
    void store.loadSignInMethods();
    void store.resumeSignIn(purpose);
    return () => store.stopSignIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The emailed code arrived: it is the next stop. Keyed on what identifies the code, not
  // on the object, which is rebuilt on every render of the store.
  const codeKey = code ? `${code.via}:${code.email}` : null;
  useEffect(() => {
    if (codeKey && store.navStep !== 'code') store.goStep('code');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey]);

  // Leaving the code step, by any back, ends that sign-in: the code it waits for is dropped.
  const onCode = useRef(false);
  useEffect(() => {
    if (onCode.current && navStep !== 'code' && store.signInCode) store.stopSignIn();
    onCode.current = navStep === 'code';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navStep]);

  const title = step === 'code' ? t('signin.codeTitle') : step === 'email' ? t('signin.emailTitle') : t('signin.chooseTitle');
  const desc =
    step === 'code' && code
      ? t(code.via === 'email' ? 'signin.codeDesc' : 'signin.codeDescExisting', { email: code.email })
      : step === 'email'
        ? t('signin.emailDesc')
        : t('signin.chooseDesc');
  return (
    <div className="scr screen col">
      {/* Keyed by step, so each step's title and line fade in instead of swapping. */}
      <ScreenHeader key={step} title={title} desc={desc} onBack={store.goBack} />
      <SignInMethods
        t={t}
        step={step}
        offer={store.signInMethods}
        phase={store.signInPhase}
        url={store.signInUrl}
        onProvider={(p, source) => void store.signInWith(p, purpose, source)}
        onEmailStep={() => store.goStep('email')}
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
