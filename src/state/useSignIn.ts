/**
 * The sign-in in progress — where a Google/GitHub/email sign-in has got to, and what it
 * ended with. The protocol is `lib/signIn.ts`; this slice holds only its React state.
 *
 * Its own slice because it is a state machine the store must not have to re-derive:
 * `opening` → `waiting` (the consent screen is in another window) → `claiming`, or
 * `code` (an emailed code is outstanding) → `verifying`. Every action RETURNS the finished
 * sign-in (or null) and decides nothing about it: whether a `ready` becomes a new wallet, a
 * restore or the target of a migration is the store's call, because only the store knows
 * which screen asked.
 *
 * The finished sign-in is not kept here, and not anywhere on disk: it carries a session
 * token that can create an account, so it lives in the store's draft for as long as the
 * screen that uses it, and no longer.
 */
import { useCallback, useRef, useState } from 'react';
import { reserveExternalTab } from '@/lib/openExternal';
import {
  SignInError,
  claimSignIn,
  clearSignInHandshake,
  loadSignInHandshake,
  openSignIn,
  saveSignInHandshake,
  waitForSignIn,
  type SignInHandshake,
} from '@/lib/signIn';
import { signInEmailStart, signInEmailVerify, signInProviders, type SignInReady } from '@/lib/cosmospay';
import { report, reportError } from '@/lib/telemetry';
import { EVENT } from '@/constants/telemetry';
import {
  SIGN_IN_PROVIDERS,
  type SignInMethod,
  type SignInOffer,
  type SignInPhase,
  type SignInProvider,
} from '@/constants/signIn';
import type { TFn } from '@/lib/i18n';

/** An emailed code the platform is waiting for. In memory only — see the header. */
export interface PendingCode {
  claimToken: string;
  email: string;
  /** How the email was first offered: typed, or a provider that landed on an account. */
  via: SignInMethod;
}

export function useSignIn(t: TFn, flash: (msg: string, kind?: 'ok' | 'err' | 'info') => void) {
  const [phase, setPhase] = useState<SignInPhase>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<PendingCode | null>(null);
  const [methods, setMethods] = useState<SignInOffer | null>(null);
  const abort = useRef(false);

  /** Ask the platform what it offers. On failure, offer nothing rather than a guess. */
  const loadMethods = useCallback(async () => {
    try {
      const res = await signInProviders();
      setMethods({
        providers: SIGN_IN_PROVIDERS.filter((p) => res.providers.includes(p)),
        email: res.email,
      });
    } catch (e) {
      setMethods({ providers: [], email: false });
      flash((e as Error).message || t('signin.error.unavailable'), 'err');
    }
  }, [flash, t]);

  const fail = useCallback(
    (e: unknown, method: SignInMethod) => {
      // A cancel is the person's own choice and needs no red line.
      if (e instanceof SignInError && e.reason === 'cancelled') return;
      reportError(EVENT.signInFailed, e, { method, reason: e instanceof SignInError ? e.reason : 'error' });
      flash((e as Error).message || t('signin.error.failed'), 'err');
    },
    [flash, t],
  );

  const succeeded = useCallback((ready: SignInReady) => {
    // The method and what exists — never the email, the one field here that names a person.
    report(EVENT.signIn, {
      category: 'auth',
      props: { method: ready.identity.method, account: ready.account, hasBackup: !!ready.backup },
    });
    return ready;
  }, []);

  /**
   * Wait out a handshake and redeem it. Shared by starting and resuming, which on MV3 are
   * the same thing: opening the consent screen closes the popup, so the process that starts
   * a sign-in is rarely the one that finishes it.
   */
  const finishHandshake = useCallback(
    async (hs: SignInHandshake): Promise<SignInReady | null> => {
      try {
        setPhase('waiting');
        await waitForSignIn(hs, () => abort.current);
        setPhase('claiming');
        const claimed = await claimSignIn(hs);
        await clearSignInHandshake();
        if (claimed.status === 'verify_email') {
          setPendingCode({ claimToken: claimed.claimToken, email: claimed.email, via: hs.provider });
          setPhase('code');
          flash(t('signin.codeSentExisting'), 'info');
          return null;
        }
        setPhase('idle');
        return succeeded(claimed);
      } catch (e) {
        await clearSignInHandshake();
        setPhase('idle');
        fail(e, hs.provider);
        return null;
      } finally {
        setUrl(null);
      }
    },
    [fail, flash, succeeded, t],
  );

  /**
   * Start a provider sign-in. The tab is claimed in the first statement, before any
   * `await`, so a popup blocker still sees the click behind it (see `reserveExternalTab`);
   * the handshake is on disk before the browser opens, because on MV3 opening it is what
   * ends this process.
   */
  const startProvider = useCallback(
    async (provider: SignInProvider): Promise<SignInReady | null> => {
      const tab = reserveExternalTab();
      abort.current = false;
      setPendingCode(null);
      setPhase('opening');
      let opened: Awaited<ReturnType<typeof openSignIn>>;
      try {
        opened = await openSignIn(provider);
        await saveSignInHandshake(opened.handshake);
      } catch (e) {
        tab.cancel();
        setPhase('idle');
        fail(e, provider);
        return null;
      }
      setUrl(opened.authorizationUrl);
      if (!(await tab.open(opened.authorizationUrl))) flash(t('signin.openFailed'), 'info');
      return finishHandshake(opened.handshake);
    },
    [fail, finishHandshake, flash, t],
  );

  /** Pick up a sign-in a closed popup left open. Null when there is none. */
  const resume = useCallback(async (): Promise<SignInReady | null> => {
    const hs = await loadSignInHandshake();
    if (!hs) return null;
    abort.current = false;
    return finishHandshake(hs);
  }, [finishHandshake]);

  /** Email a sign-in code. */
  const startEmail = useCallback(
    async (email: string): Promise<boolean> => {
      setPhase('opening');
      try {
        const sent = await signInEmailStart(email.trim().toLowerCase());
        setPendingCode({ claimToken: sent.claimToken, email: email.trim().toLowerCase(), via: 'email' });
        setPhase('code');
        return true;
      } catch (e) {
        setPhase('idle');
        fail(e, 'email');
        return false;
      }
    },
    [fail],
  );

  /** Send the emailed code. `invalid` keeps the prompt; `expired` and `locked` close it. */
  const submitCode = useCallback(
    async (code: string): Promise<SignInReady | null> => {
      if (!pendingCode) return null;
      setPhase('verifying');
      try {
        const res = await signInEmailVerify({ claimToken: pendingCode.claimToken, code });
        if (res.status === 'ready') {
          setPendingCode(null);
          setPhase('idle');
          return succeeded(res);
        }
        if (res.status === 'invalid') {
          setPhase('code');
          flash(t('signin.codeInvalid', { n: res.attemptsLeft }), 'err');
          return null;
        }
        setPendingCode(null);
        setPhase('idle');
        flash(t(res.status === 'locked' ? 'signin.codeLocked' : 'signin.codeExpired'), 'err');
        return null;
      } catch (e) {
        setPhase('code');
        fail(e, pendingCode.via);
        return null;
      }
    },
    [pendingCode, fail, flash, succeeded, t],
  );

  /** Stop waiting, or drop the code prompt. Nothing server-side needs undoing: both expire. */
  const cancel = useCallback(() => {
    abort.current = true;
    setPendingCode(null);
    setUrl(null);
    setPhase('idle');
    void clearSignInHandshake();
  }, []);

  return {
    signInPhase: phase,
    signInUrl: url,
    signInPendingCode: pendingCode,
    signInMethods: methods,
    loadSignInMethods: loadMethods,
    startProvider,
    resumeSignIn: resume,
    startEmail,
    submitCode,
    cancelSignIn: cancel,
  };
}
