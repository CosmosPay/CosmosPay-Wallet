import { useState } from 'react';
import { cx } from '@/lib/cx';
import { copyText } from '@/lib/clipboard';
import { isAccessCode, isEmail, normalizeAccessCode } from '@/lib/validate';
import type { TFn } from '@/lib/i18n';
import type { SignInMethod, SignInOffer, SignInPhase, SignInProvider } from '@/constants/signIn';
import { Spinner } from '@/ui/Spinner';
import '@/styles/ui/sign-in-methods.css';

/** Brand names, so not i18n keys — they read the same in every language. */
const PROVIDER_LABEL: Record<SignInProvider, string> = { google: 'Google', github: 'GitHub' };

/**
 * The ways in — Google, GitHub, an emailed code — and the code prompt a sign-in can stop at.
 *
 * In `ui/` because two features show it: onboarding (`features/onboarding/SignIn.tsx`) and
 * moving an old Pollar wallet (`features/wallet/MigratePollar.tsx`). Presentational: every
 * action is a prop, and the caller decides what a finished sign-in turns into.
 *
 * The code prompt REPLACES the buttons rather than sitting beside them: a sign-in started
 * while a code is outstanding would be a second one, racing the first for the same account.
 */
export function SignInMethods({
  t,
  offer,
  phase,
  code,
  url,
  onProvider,
  onEmail,
  onCode,
  onCancel,
}: {
  t: TFn;
  /** Null while the platform has not said what it offers. */
  offer: SignInOffer | null;
  phase: SignInPhase;
  /** An outstanding emailed code: where it went, and how the sign-in began. */
  code: { email: string; via: SignInMethod } | null;
  /** The provider URL, for the copy fallback when the browser could not be opened. */
  url: string | null;
  onProvider: (provider: SignInProvider) => void;
  onEmail: (email: string) => void;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState('');
  const busy = phase !== 'idle' && phase !== 'code';

  if (code) {
    return (
      <div className="glass-soft col g8 sign-in-code">
        <div className="sign-in-code-title">{t('signin.codeTitle')}</div>
        {/* An existing account's provider sign-in ends here too — worth saying why, or the
            code reads like a step the provider should have spared them. */}
        <div className="desc">
          {t(code.via === 'email' ? 'signin.codeDesc' : 'signin.codeDescExisting', { email: code.email })}
        </div>
        <input
          value={digits}
          onChange={(e) => setDigits(normalizeAccessCode((e.target as HTMLInputElement).value))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t('cosmospay.codePlaceholder')}
          className="input sign-in-code-input"
        />
        <button className="btn-primary" disabled={phase === 'verifying' || !isAccessCode(digits)} onClick={() => onCode(digits)}>
          {phase === 'verifying' ? <Spinner /> : t('signin.codeCta')}
        </button>
        <button
          className="sign-in-link"
          onClick={() => {
            setDigits('');
            onCancel();
          }}
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  const phaseCopy =
    phase === 'opening' ? t('signin.opening') : phase === 'waiting' ? t('signin.waiting') : phase === 'claiming' ? t('signin.claiming') : '';

  return (
    <div className="col g8 sign-in-methods">
      {offer === null ? (
        <div className="row g8 sign-in-phase">
          <Spinner tone="text" />
        </div>
      ) : (
        <>
          {offer.providers.map((p) => (
            <button key={p} className={cx('btn-primary', 'sign-in-btn', `is-${p}`)} disabled={busy} onClick={() => onProvider(p)}>
              {t('signin.continueWith', { provider: PROVIDER_LABEL[p] })}
            </button>
          ))}
          {offer.email && (
            <>
              {offer.providers.length > 0 && <div className="sign-in-or">{t('signin.or')}</div>}
              <input
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t('signin.emailPlaceholder')}
                className="input"
              />
              <button className="btn-ghost" disabled={busy || !isEmail(email)} onClick={() => onEmail(email)}>
                {t('signin.emailCta')}
              </button>
            </>
          )}
          {!offer.providers.length && !offer.email && <div className="desc">{t('signin.error.unavailable')}</div>}
        </>
      )}

      {busy && (
        <div className="row g8 sign-in-phase">
          <Spinner tone="text" />
          <span className="f1 min0">{phaseCopy}</span>
          <button className="sign-in-link" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* The opener can fail with no error of its own — a WebView with no handler, a popup
          blocker — and the sign-in is then stuck. Handing over the URL is the recovery that
          does not need a new handshake. */}
      {url && phase === 'waiting' && (
        <button className="sign-in-link sign-in-copy" onClick={() => void copyText(url)}>
          {t('signin.copyLink')}
        </button>
      )}
    </div>
  );
}
