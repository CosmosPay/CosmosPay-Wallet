import { useState } from 'react';
import type { WalletStore } from '../store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner, Logo, inputStyle } from '../parts';
import { copyText, readText } from '@/lib/clipboard';
import { isValidMnemonic, isValidSecret } from '@/lib/wallet';
import { APP_VERSION } from '@/lib/config';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 26px 32px', animation: 'fadeUp .3s ease' }}>
      {store.addingWallet && (
        <div onClick={() => store.cancelAddWallet()} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start', color: C.muted, fontSize: '14px', fontWeight: 700, cursor: 'pointer', padding: '6px 4px' }}>
          <span style={{ fontSize: '20px' }}>‹</span> {t('common.cancel')}
        </div>
      )}
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

export function Backup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [saved, setSaved] = useState(false);
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
      <div onClick={() => setSaved((s) => !s)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', marginBottom: '20px', padding: '2px' }}>
        <div style={{ width: '24px', height: '24px', borderRadius: '7px', background: saved ? C.accent : 'transparent', color: 'var(--on-accent)', border: `2px solid ${saved ? C.accent : 'var(--glass-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: saved ? 1 : 0 }}>
            <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span style={{ fontSize: '14px', fontWeight: 600, color: C.inkSoft, lineHeight: 1.4 }}>{t('backup.saved')}</span>
      </div>
      <PrimaryButton disabled={!saved} onClick={() => store.beginVerify()}>
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
  const hint = txt.length === 0 ? '' : valid ? t('import.valid') : t('import.invalid');

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
      {hint && (
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: valid ? C.accent : C.dim, marginBottom: '12px' }}>{hint}</div>
      )}
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
  // Name, email and birthdate are all required.
  const ok = name.trim().length >= 2 && emailOk && !!store.draftBirthdate;
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
          max="2099-12-31"
          onChange={(e) => store.setDraftBirthdate((e.target as HTMLInputElement).value)}
          style={{ ...C.glass, ...inputStyle, colorScheme: store.theme === 'light' ? 'light' : 'dark' }}
        />
      </label>

      <div style={{ flex: 1 }} />
      <PrimaryButton
        disabled={!ok || store.busy}
        onClick={() => (store.addingWallet ? store.finishOnboarding() : store.setScreen('password'))}
      >
        {store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}

export function PasswordSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const strong = pwd.length >= 8;
  const match = pwd === confirm && confirm.length > 0;
  const ok = strong && match && !store.busy;

  const back = () => store.setScreen('profile-setup');

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('pwd.title')} onBack={back} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 22px' }}>
        {t('pwd.desc')}
      </div>

      <Field label={t('pwd.label')} value={pwd} onChange={setPwd} type={show ? 'text' : 'password'} placeholder={t('pwd.min')} />
      <Field label={t('pwd.repeat')} value={confirm} onChange={setConfirm} type={show ? 'text' : 'password'} placeholder={t('pwd.repeat')} />

      <div onClick={() => setShow((s) => !s)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: '4px 0 8px', fontSize: '13px', color: C.muted, fontWeight: 600 }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: show ? C.accent : 'transparent', border: `2px solid ${show ? C.accent : 'var(--glass-border)'}` }} />
        {t('pwd.show')}
      </div>

      <div style={{ fontSize: '12.5px', fontWeight: 700, marginTop: '6px', color: !pwd ? C.dim : strong ? C.accent : C.danger }}>
        {!pwd ? '' : strong ? t('pwd.lenOk') : t('pwd.lenErr')}
      </div>
      {confirm.length > 0 && !match && (
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: C.danger, marginTop: '4px' }}>{t('pwd.mismatch')}</div>
      )}

      <div style={{ flex: 1 }} />
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
