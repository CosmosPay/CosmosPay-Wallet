import { useState } from 'react';
import type { WalletStore } from '../store';
import { C, PrimaryButton, Spinner, Logo } from '../parts';
import { getGreeting } from '../../lib/greeting';

export function Unlock({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const g = getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t);

  const submit = async () => {
    if (!pwd) return;
    const ok = await store.unlock(pwd);
    if (!ok) setPwd('');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 26px 32px', animation: 'fadeUp .3s ease' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ marginBottom: '24px' }}><Logo size={92} /></div>
        {g.isBirthday && <div style={{ fontSize: '13px', fontWeight: 800, color: C.accent, marginBottom: '8px', letterSpacing: '.3px' }}>🎂 {g.age !== null ? t('unlock.yearsOld', { age: g.age }) : t('unlock.happyDay')}</div>}
        <div style={{ fontSize: '27px', fontWeight: 800, letterSpacing: '-.7px', marginBottom: '12px', lineHeight: 1.2 }}>{g.line}</div>
        <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, marginBottom: '28px' }}>
          {t('unlock.subtitle')}
        </div>
        <input
          type="password"
          value={pwd}
          autoFocus
          placeholder={t('pwd.label')}
          onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ width: '100%', maxWidth: '320px', ...C.glass, borderRadius: '14px', padding: '16px', color: 'var(--text)', fontSize: '16px', fontWeight: 600, outline: 'none', textAlign: 'center' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <PrimaryButton disabled={!pwd || store.busy} onClick={submit}>
          {store.busy ? <Spinner /> : t('unlock.unlock')}
        </PrimaryButton>
        {!confirmWipe ? (
          <div onClick={() => setConfirmWipe(true)} className="tap" style={{ textAlign: 'center', color: C.dim, fontSize: '13px', fontWeight: 700, padding: '10px', cursor: 'pointer' }}>
            {t('unlock.forgot')}
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, padding: '4px 8px' }}>
            {t('unlock.forgotDesc')}
            <div onClick={() => store.deleteWallet()} style={{ color: C.danger, fontWeight: 800, marginTop: '10px', cursor: 'pointer' }}>
              {t('unlock.deleteRestore')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
