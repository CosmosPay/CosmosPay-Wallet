import { useState, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { copyText } from '@/lib/clipboard';
import { inkHandlers } from '@/lib/ink';
import { isAccessCode, isEmail, normalizeAccessCode } from '@/lib/validate';
import type { TFn } from '@/lib/i18n';
import type { SignInMethod, SignInOffer, SignInPhase, SignInProvider } from '@/constants/signIn';
import { CosmosMark, GitHubLogo, GoogleLogo, MailIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import '@/styles/ui/sign-in-methods.css';

/**
 * Brand names, so not i18n keys — they read the same in every language. Authentik is shown
 * as the account it signs people into, not as the software that runs it.
 */
const PROVIDER_LABEL: Record<SignInProvider, string> = { authentik: 'Cosmos Pay', google: 'Google', github: 'GitHub' };

/** Each provider's own mark. Cosmos Pay is the preferred door (`SIGN_IN_PROVIDERS[0]`), so
 *  it is the one solid button; the rest are outlined equals. */
const PROVIDER_MARK: Record<SignInProvider, ReactNode> = {
  authentik: <CosmosMark className="sign-in-mark" />,
  google: <GoogleLogo className="sign-in-mark" />,
  github: <GitHubLogo className="sign-in-mark" />,
};

export type SignInStep = 'list' | 'email' | 'code';

/**
 * The ways in, one step at a time: the list (Cosmos Pay, Google, GitHub, Email), then for
 * email its address, then the emailed code a sign-in can stop at.
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
  onProvider: (provider: SignInProvider) => void;
  /** "Email" in the list: the caller moves to the email step. */
  onEmailStep: () => void;
  onEmail: (email: string) => void;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
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
          {offer.providers.map((p, i) => (
            <button
              key={p}
              type="button"
              className={cx(i === 0 ? 'btn-primary' : 'btn-ghost', 'ink sign-in-btn')}
              disabled={busy}
              onClick={() => onProvider(p)}
              {...inkHandlers}
            >
              {PROVIDER_MARK[p]}
              {t('signin.continueWith', { provider: PROVIDER_LABEL[p] })}
            </button>
          ))}
          {offer.email && (
            <button
              type="button"
              className={cx(offer.providers.length ? 'btn-ghost' : 'btn-primary', 'ink sign-in-btn')}
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
