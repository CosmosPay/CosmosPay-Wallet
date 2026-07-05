import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { EMAIL_RE } from '@/constants/validation';
import '@/styles/screens/main/profile.css';

/** Profile email card: shows the wallet's email with inline editing. Cosmos Pay
 *  account creation & linking use this address, so it must be correct/updatable. */
export function EmailRow({ store }: { store: WalletStore }) {
  const t = store.t;
  const current = store.meta?.email ?? '';
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current);
  const valid = EMAIL_RE.test(val.trim());

  const start = () => {
    setVal(current);
    setEditing(true);
  };
  const save = async () => {
    if (!valid) return;
    await store.setWalletEmail(val);
    setEditing(false);
  };

  return (
    <div className="glass card-16 profile-email-card">
      <div className="profile-email-label">{t('setup.emailLabel')}</div>
      {!editing ? (
        <div className="row g10">
          <span className={current ? 'profile-email-value' : 'profile-email-value is-empty'}>{current || '—'}</span>
          <span onClick={start} title={t('profile.editEmail')} className="glass-soft profile-email-edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /><path d="M13.5 6.5l4 4" stroke="currentColor" strokeWidth="1.9" /></svg>
          </span>
        </div>
      ) : (
        <>
          <input
            type="email"
            value={val}
            autoFocus
            placeholder="tu@correo.com"
            onChange={(e) => setVal((e.target as HTMLInputElement).value.trim().slice(0, 80))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="input profile-email-input"
          />
          {val.length > 0 && !valid && (
            <div className="profile-email-err">{t('setup.emailInvalid')}</div>
          )}
          <div className="flexr g8">
            <button onClick={() => setEditing(false)} className="glass-soft profile-email-cancel">
              {t('common.cancel')}
            </button>
            <button onClick={save} disabled={!valid} className="glass-bright profile-email-save">
              {t('common.done')}
            </button>
          </div>
        </>
      )}
      <div className="profile-email-note">{t('profile.emailNote')}</div>
    </div>
  );
}
