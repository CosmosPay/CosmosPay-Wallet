import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner, Logo, inputStyle } from '@/components/parts';
import { LangSelect } from '@/components/flags';
import { copyText, readText } from '@/lib/clipboard';
import { isValidMnemonic, isValidSecret } from '@/lib/wallet';
import { ageFromBirthdate } from '@/lib/greeting';
import { APP_VERSION, TERMS_URL } from '@/lib/config';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 26px 32px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: store.addingWallet ? 'space-between' : 'flex-end', minHeight: '34px', marginBottom: '2px' }}>
        {store.addingWallet && (
          <div onClick={() => store.cancelAddWallet()} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted, fontSize: '14px', fontWeight: 700, cursor: 'pointer', padding: '6px 4px' }}>
            <span style={{ fontSize: '20px' }}>‹</span> {t('common.cancel')}
          </div>
        )}
        <LangSelect value={store.lang} onChange={store.setLang} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ marginBottom: '24px' }}>
          <Logo size={104} />
        </div>
        <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1.2px', marginBottom: '12px' }}>Cosmos Pay</div>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 500, lineHeight: 1.5, maxWidth: '270px' }}>
          {t('welcome.subtitle')}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PrimaryButton onClick={() => store.startCreate()} style={{ padding: '18px' }}>
          {t('welcome.create')}
        </PrimaryButton>
        <GhostButton onClick={() => { store.setImportText(''); store.setScreen('import'); }}>
          {t('welcome.import')}
        </GhostButton>
        <div style={{ textAlign: 'center', fontSize: '11.5px', color: C.dim, fontWeight: 600, marginTop: '8px', letterSpacing: '.2px' }}>
          {t('welcome.producer')} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}

/** Checkbox row in the app's style (used by Backup consents + optional opt-ins). */
function CheckRow({ on, onToggle, children, style }: { on: boolean; onToggle: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <div onClick={onToggle} className="tap" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', padding: '2px', ...style }}>
      <div style={{ width: '24px', height: '24px', borderRadius: '7px', background: on ? C.accent : 'transparent', color: 'var(--on-accent)', border: `2px solid ${on ? C.accent : 'var(--glass-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: on ? 1 : 0 }}>
          <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span style={{ fontSize: '13.5px', fontWeight: 600, color: C.inkSoft, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

export function Backup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [saved, setSaved] = useState(false);
  const [terms, setTerms] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = store.draftMnemonic.split(' ');

  const copy = async () => {
    await copyText(store.draftMnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('backup.title')} onBack={() => store.setScreen('welcome')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 16px' }}>
        {t('backup.desc')}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(255,93,93,.10)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '13px 14px', marginBottom: '20px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
          <path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: '12.5px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.45 }}>
          {t('backup.warning')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
        {words.map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '9px', ...C.glass, borderRadius: '13px', padding: '12px 13px' }}>
            <span style={{ fontSize: '12px', color: C.accent, fontWeight: 700, width: '16px', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px' }}>{w}</span>
          </div>
        ))}
      </div>
      <button
        onClick={copy}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', ...C.glassSoft, border: 'none', borderRadius: '14px', padding: '14px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', color: copied ? C.accent : 'var(--text)', marginBottom: '20px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {copied ? t('common.copied') : t('backup.copy')}
      </button>
      <CheckRow on={saved} onToggle={() => setSaved((s) => !s)} style={{ marginBottom: '12px' }}>
        {t('backup.saved')}
      </CheckRow>
      {/* Sole-responsibility + Terms acceptance — required before continuing.
          The T&C part is a real link (opens in a new tab, doesn't toggle the box). */}
      <CheckRow on={terms} onToggle={() => setTerms((s) => !s)} style={{ marginBottom: '20px' }}>
        {t('backup.terms')}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: C.accent, fontWeight: 800, textDecoration: 'underline' }}
        >
          {t('backup.termsLink')}
        </a>
        .
      </CheckRow>
      <PrimaryButton disabled={!saved || !terms} onClick={() => store.beginVerify()}>
        {t('common.continue')}
      </PrimaryButton>
    </div>
  );
}

export function Verify({ store }: { store: WalletStore }) {
  const t = store.t;
  const words = store.draftMnemonic.split(' ');
  const tIdx = store.verifyTargets.map((tg) => tg.index);
  const used = Object.values(store.verifyFilled);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('verify.title')} onBack={() => store.setScreen('backup')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 18px' }}>
        {t('verify.desc')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '22px' }}>
        {words.map((w, i) => {
          const isT = tIdx.includes(i);
          const filledWord = store.verifyFilled[i];
          let bg = 'var(--surface)';
          let border = '1px solid var(--glass-border)';
          let color = C.inkSoft;
          let content: string = w;
          let onClick = () => {};
          if (isT) {
            if (filledWord) {
              bg = 'var(--avatar-brand)';
              border = `1px solid ${C.accent}`;
              color = C.accent;
              content = filledWord;
              onClick = () => store.tapSlot(i);
            } else {
              bg = 'transparent';
              border = '1px dashed rgba(255,255,255,.22)';
              color = C.dim;
              content = '#' + (i + 1);
            }
          }
          return (
            <div key={i} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '9px', background: bg, border, borderRadius: '13px', padding: '12px 13px', cursor: isT ? 'pointer' : 'default', minHeight: '45px' }}>
              <span style={{ fontSize: '12px', color: C.accent, fontWeight: 700, width: '16px', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
              <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px', color }}>{content}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('verify.tapToSelect')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
        {store.verifyBank.map((w, i) => {
          const u = used.includes(w);
          return (
            <div key={i} onClick={u ? undefined : () => store.tapChip(w)} style={{ background: u ? 'var(--surface-2)' : 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', borderRadius: '12px', padding: '11px 18px', fontSize: '15px', fontWeight: 700, cursor: u ? 'default' : 'pointer', color: u ? C.dim : 'var(--text)' }}>
              {w}
            </div>
          );
        })}
      </div>
      <PrimaryButton disabled={!store.verifyOk} onClick={() => store.setScreen('profile-setup')}>
        {t('verify.confirm')}
      </PrimaryButton>
    </div>
  );
}

export function Import({ store }: { store: WalletStore }) {
  const t = store.t;
  const txt = store.importText.trim();
  const valid = txt.length > 0 && (isValidMnemonic(txt) || isValidSecret(txt));

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('import.title')} onBack={() => store.setScreen('welcome')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 18px' }}>
        {t('import.desc')}
      </div>
      <textarea
        value={store.importText}
        onChange={(e) => store.setImportText((e.target as HTMLTextAreaElement).value)}
        placeholder="ribbon planet silver orbit … &#10;o &#10;SD…"
        rows={4}
        style={{ width: '100%', ...C.glass, borderRadius: '16px', padding: '16px', color: 'var(--text)', fontSize: '15px', fontWeight: 600, resize: 'none', outline: 'none', lineHeight: 1.7, marginBottom: '8px' }}
      />
      {/* Live validity criterion (same pattern as the password checklist):
          grey while empty, green ✓ when valid, red ✗ when invalid. */}
      <div style={{ margin: '2px 2px 12px' }}>
        <Criterion met={valid} bad={txt.length > 0 && !valid}>
          {txt.length > 0 && !valid ? t('import.invalid') : t('import.valid')}
        </Criterion>
      </div>
      <button
        onClick={async () => store.setImportText(await readText())}
        style={{ width: '100%', height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', ...C.glassSoft, border: 'none', borderRadius: '999px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', color: 'var(--text)', marginTop: '6px', marginBottom: '22px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="6" y="4" width="12" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {t('import.paste')}
      </button>
      <PrimaryButton disabled={!valid} onClick={() => store.submitImport()}>
        {t('import.cta')}
      </PrimaryButton>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfileSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const name = store.draftName;
  const email = store.draftEmail;
  const emailOk = EMAIL_RE.test(email.trim());
  // Local-timezone today in ISO — the birthdate can never be in the future.
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dobFuture = !!store.draftBirthdate && store.draftBirthdate > todayIso;
  // Minimum age to use the app: 13 (fiat has its own 18+ gate later).
  const tooYoung = !!store.draftBirthdate && !dobFuture && (ageFromBirthdate(store.draftBirthdate) ?? 0) < 13;
  // Name, email, a valid 13+ birthdate and a gender pick are all required.
  const ok = name.trim().length >= 2 && emailOk && !!store.draftBirthdate && !dobFuture && !tooYoung && !!store.draftGender;
  const back = () =>
    store.setScreen(store.draftHasMnemonic && store.draftMnemonic ? 'verify' : 'import');

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('setup.about')} onBack={back} />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 6px', fontSize: '50px', lineHeight: 1 }}>👋</div>
      <div style={{ fontSize: '22px', fontWeight: 800, textAlign: 'center', letterSpacing: '-.5px', marginBottom: '8px' }}>{t('setup.title')}</div>
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, textAlign: 'center', margin: '0 6px 22px' }}>
        {t('setup.subtitle')}
      </div>

      <Field
        label={t('setup.nameLabel')}
        value={name}
        onChange={(v) => store.setDraftName(v.slice(0, 24))}
        placeholder="p. ej. Alex"
      />
      <Field
        label={t('setup.emailLabel')}
        value={email}
        type="email"
        onChange={(v) => store.setDraftEmail(v.trim().slice(0, 80))}
        placeholder="tu@correo.com"
      />
      {email.length > 0 && !emailOk && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.emailInvalid')}</div>
      )}
      <label style={{ display: 'block', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('setup.dobLabel')}</div>
        <input
          type="date"
          value={store.draftBirthdate}
          max={todayIso}
          onChange={(e) => store.setDraftBirthdate((e.target as HTMLInputElement).value)}
          style={{ ...C.glass, ...inputStyle, colorScheme: store.theme === 'light' ? 'light' : 'dark' }}
        />
      </label>
      {dobFuture && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.dobFuture')}</div>
      )}
      {tooYoung && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.tooYoung')}</div>
      )}

      {/* Gender: drives gendered copy ("bienvenido/bienvenida/bienvenidx") so the
          app never misgenders anyone. 'x' = non-binary / prefer not to say. */}
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('setup.genderLabel')}</div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        {(['m', 'f', 'x'] as const).map((g) => {
          const on = store.draftGender === g;
          return (
            <button
              key={g}
              onClick={() => store.setDraftGender(g)}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '999px',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
                ...(on
                  ? { background: 'var(--primary-bg)', color: 'var(--primary-text)', border: '1px solid var(--primary-border)' }
                  : { ...C.glassSoft, color: 'var(--text)' }),
              }}
            >
              {t(g === 'm' ? 'setup.genderM' : g === 'f' ? 'setup.genderF' : 'setup.genderX')}
            </button>
          );
        })}
      </div>

      {/* Optional consents — both default OFF and never block the flow. */}
      <CheckRow on={store.draftMetricsOptIn} onToggle={() => store.setDraftMetricsOptIn(!store.draftMetricsOptIn)} style={{ marginBottom: '10px' }}>
        {t('setup.metricsOptIn')}
      </CheckRow>
      <CheckRow on={store.draftPromoOptIn} onToggle={() => store.setDraftPromoOptIn(!store.draftPromoOptIn)} style={{ marginBottom: '14px' }}>
        {t('setup.promoOptIn')}
      </CheckRow>

      <div style={{ flex: 1, minHeight: '14px' }} />
      <PrimaryButton
        disabled={!ok || store.busy}
        onClick={() => (store.addingWallet ? store.finishOnboarding() : store.setScreen('password'))}
      >
        {store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}

/** Password input with its OWN eye toggle (each field shows/hides independently). */
function PasswordField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          style={{ ...C.glass, ...inputStyle, paddingRight: '52px' }}
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

/** One live-criterion row: grey until met (green ✓); `bad` shows a red ✗ state. */
function Criterion({ met, bad = false, children }: { met: boolean; bad?: boolean; children: ReactNode }) {
  const color = met ? 'var(--up)' : bad ? 'var(--down)' : C.dim;
  const border = met ? 'var(--up)' : bad ? 'var(--down)' : 'var(--glass-border)';
  const tint = met
    ? 'color-mix(in srgb, var(--up) 18%, transparent)'
    : bad
      ? 'color-mix(in srgb, var(--down) 18%, transparent)'
      : 'transparent';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px', fontWeight: 700, color, transition: 'color .2s ease', lineHeight: 1.4 }}>
      <div style={{ width: '17px', height: '17px', borderRadius: '50%', border: `1.5px solid ${border}`, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s ease', flexShrink: 0 }}>
        {bad && !met ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ opacity: met ? 1 : 0.35 }}>
            <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </div>
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
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
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

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        style={{ ...C.glass, ...inputStyle }}
      />
    </label>
  );
}
