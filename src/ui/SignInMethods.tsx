import { useState, type ReactNode } from 'react';
import { useKeptState } from '@/hooks/useKeptState';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { copyText } from '@/lib/clipboard';
import { inkHandlers } from '@/lib/ink';
import { isAccessCode, isEmail, normalizeAccessCode } from '@/lib/validate';
import type { TFn } from '@/lib/i18n';
import { EMAIL_SOURCE_ID, type SignInOffer, type SignInPhase, type SignInProvider } from '@/constants/signIn';
import { AccountIcon, CosmosMark, GitHubLogo, GoogleLogo, MailIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import '@/styles/ui/sign-in-methods.css';

/**
 * Brand names, so not i18n keys — they read the same in every language. Authentik is shown
 * as the account it signs people into, not as the software that runs it.
 */
const PROVIDER_LABEL: Record<SignInProvider, string> = { authentik: 'Cosmos Pay', google: 'Google', github: 'GitHub' };

/** Each provider's own mark. */
const PROVIDER_MARK: Record<SignInProvider, ReactNode> = {
  authentik: <CosmosMark className="sign-in-mark" />,
  google: <GoogleLogo className="sign-in-mark" />,
  github: <GitHubLogo className="sign-in-mark" />,
};

/** An Authentik source's mark by its id; a source the wallet has no logo for gets a person. */
const SOURCE_MARK: Record<string, ReactNode> = {
  google: <GoogleLogo className="sign-in-mark" />,
  github: <GitHubLogo className="sign-in-mark" />,
  [EMAIL_SOURCE_ID]: <MailIcon className="sign-in-mark" />,
};

export type SignInStep = 'list' | 'email' | 'code';

/**
 * The ways in, one step at a time: the list, then for email its address, then the emailed
 * code a sign-in can stop at.
 *
 * The list is the federated sign-ins Authentik has (Google, GitHub…, from `offer.sources`),
 * each starting at its provider, plus email — all equals, outlined. A deployment that lists
 * no sources gets one Authentik ("Cosmos Pay") button, whose login page offers them instead;
 * one with no Authentik gets the direct Google / GitHub doors.
 *
 * Presentational: every action is a prop, and the caller (`features/onboarding/SignIn.tsx`)
 * owns the step — its header titles each one and its back button walks them — and decides
 * what a finished sign-in turns into.
 *
 * The code step REPLACES the buttons rather than sitting beside them: a sign-in started
 * while a code is outstanding would be a second one, racing the first for the same account.
 */
export function SignInMethods({
  t,
  step,
  offer,
  phase,
  url,
  onProvider,
  onEmailStep,
  onEmail,
  onCode,
  onCancel,
}: {
  t: TFn;
  step: SignInStep;
  /** Null while the platform has not said what it offers. */
  offer: SignInOffer | null;
  phase: SignInPhase;
  /** The provider URL, for the copy fallback when the browser could not be opened. */
  url: string | null;
  /** `source`: one of Authentik's (`offer.sources`), to start the sign-in there. */
  onProvider: (provider: SignInProvider, source?: string) => void;
  /** "Email" in the list: the caller moves to the email step. */
  onEmailStep: () => void;
  onEmail: (email: string) => void;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  // The address survives a step back; the code, single-use, does not.
  const [email, setEmail] = useKeptState(KEPT_INPUT.signInEmail, '');
  const [digits, setDigits] = useState('');
  const busy = phase !== 'idle' && phase !== 'code';

  if (step === 'code') {
    return (
      <div className="col g12">
        <label className="field">
          <div className="field-label">{t('cosmospay.codePlaceholder')}</div>
          <input
            value={digits}
            onChange={(e) => setDigits(normalizeAccessCode((e.target as HTMLInputElement).value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className="input sign-in-code-input"
          />
        </label>
        <button
          type="button"
          className="btn-primary ink"
          disabled={phase === 'verifying' || !isAccessCode(digits)}
          onClick={() => onCode(digits)}
          {...inkHandlers}
        >
          {phase === 'verifying' ? <Spinner /> : t('signin.codeCta')}
        </button>
      </div>
    );
  }

  if (step === 'email') {
    const ok = isEmail(email);
    return (
      <div className="col g12">
        <label className="field">
          <div className="field-label">{t('signin.emailLabel')}</div>
          <input
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && ok && !busy && onEmail(email)}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder={t('signin.emailPlaceholder')}
            className="input"
          />
        </label>
        <button
          type="button"
          className="btn-primary ink"
          disabled={busy || !ok}
          onClick={() => onEmail(email)}
          {...inkHandlers}
        >
          {busy ? <Spinner /> : t('signin.sendCode')}
        </button>
      </div>
    );
  }

  const phaseCopy =
    phase === 'opening' ? t('signin.opening') : phase === 'waiting' ? t('signin.waiting') : phase === 'claiming' ? t('signin.claiming') : '';

  return (
    <div className="col g10">
      {offer === null ? (
        <div className="row center sign-in-loading">
          <Spinner tone="text" />
        </div>
      ) : (
        <>
          {offer.sources.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn-ghost ink sign-in-btn"
              disabled={busy}
              onClick={() => onProvider('authentik', s.id)}
              {...inkHandlers}
            >
              {SOURCE_MARK[s.id] ?? <AccountIcon className="sign-in-mark" />}
              {s.id === EMAIL_SOURCE_ID ? t('signin.emailCta') : t('signin.continueWith', { provider: s.name })}
            </button>
          ))}
          {/* With its sources listed, Authentik needs no button of its own. */}
          {offer.providers
            .filter((p) => !(p === 'authentik' && offer.sources.length))
            .map((p) => (
              <button
                key={p}
                type="button"
                className="btn-ghost ink sign-in-btn"
                disabled={busy}
                onClick={() => onProvider(p)}
                {...inkHandlers}
              >
                {PROVIDER_MARK[p]}
                {t('signin.continueWith', { provider: PROVIDER_LABEL[p] })}
              </button>
            ))}
          {/* The in-app code, only where Authentik's email sign-in is not offered (it replaces it). */}
          {offer.email && !offer.sources.some((s) => s.id === EMAIL_SOURCE_ID) && (
            <button
              type="button"
              className="btn-ghost ink sign-in-btn"
              disabled={busy}
              onClick={onEmailStep}
              {...inkHandlers}
            >
              <MailIcon className="sign-in-mark" />
              {t('signin.emailCta')}
            </button>
          )}
          {!offer.providers.length && !offer.email && <Notice tone="danger">{t('signin.error.unavailable')}</Notice>}
        </>
      )}

      {busy && (
        <div className="row g10 sign-in-phase" role="status">
          <Spinner tone="text" />
          <span className="f1 min0">{phaseCopy}</span>
          <button type="button" className="link-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* The opener can fail with no error of its own — a WebView with no handler, a popup
          blocker — and the sign-in is then stuck. Handing over the URL is the recovery that
          does not need a new handshake. */}
      {url && phase === 'waiting' && (
        <button type="button" className="link-btn sign-in-copy" onClick={() => void copyText(url)}>
          {t('signin.copyLink')}
        </button>
      )}
    </div>
  );
}
