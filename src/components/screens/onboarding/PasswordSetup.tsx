import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Criterion } from './shared';

/** Password input with its OWN eye toggle (each field shows/hides independently). */
function PasswordField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div className="label-up" style={{ marginBottom: '7px' }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className="input" style={{ paddingRight: '52px' }}
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setShow((s) => !s);
          }}
          aria-label={show ? 'Ocultar' : 'Mostrar'}
          style={{ position: 'absolute', right: '7px', top: '50%', transform: 'translateY(-50%)', width: '40px', height: '40px', border: 'none', background: 'transparent', color: show ? 'var(--text)' : 'var(--dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {show ? (
            // eye-off: hidden again on tap
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s3.5-7 10-7c2.2 0 4.1.8 5.6 1.9M22 12s-3.5 7-10 7c-2.2 0-4.1-.8-5.6-1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            // eye: tap to reveal
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}

export function PasswordSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  // Live criteria — each row below flips to green as it's satisfied.
  const lenOk = pwd.length >= 8;
  const upperOk = /[A-Z]/.test(pwd);
  const digitOk = /\d/.test(pwd);
  const lowerOk = /[a-z]/.test(pwd);
  const match = pwd === confirm && confirm.length > 0;
  const ok = lenOk && upperOk && digitOk && lowerOk && match && !store.busy;

  const back = () => store.setScreen('profile-setup');

  return (
    <div className="scr screen col">
      <BackBar title={t('pwd.title')} onBack={back} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 22px' }}>
        {t('pwd.desc')}
      </div>

      <PasswordField label={t('pwd.label')} value={pwd} onChange={setPwd} placeholder={t('pwd.min')} />
      <PasswordField label={t('pwd.repeat')} value={confirm} onChange={setConfirm} placeholder={t('pwd.repeat')} />

      {/* criteria checklist — states update live as the user types */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '6px 2px 12px' }}>
        <Criterion met={lenOk}>{t('pwd.critLen')}</Criterion>
        <Criterion met={upperOk}>{t('pwd.critUpper')}</Criterion>
        <Criterion met={digitOk}>{t('pwd.critDigit')}</Criterion>
        <Criterion met={lowerOk}>{t('pwd.critLower')}</Criterion>
        <Criterion met={match}>{t('pwd.critMatch')}</Criterion>
      </div>

      <div style={{ flex: 1, minHeight: '14px' }} />
      <PrimaryButton disabled={!ok} onClick={() => store.finishOnboarding(pwd)}>
        {store.busy ? <Spinner /> : t('pwd.create')}
      </PrimaryButton>
    </div>
  );
}
