import { useState } from 'react';
import type { WalletStore } from '../store';
import { C, PrimaryButton, Spinner, Logo, inputStyle } from '../parts';
import { getGreeting } from '@/lib/greeting';
import { shortAddr } from '@/lib/format';

export function Unlock({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const g = getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t);
  const multi = store.wallets.length > 1;

  const submit = async () => {
    if (!pwd) return;
    const ok = await store.unlock(pwd);
    if (!ok) setPwd('');
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 26px 32px', animation: 'fadeUp .3s ease' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 0 }}>
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
          style={{ ...C.glass, ...inputStyle, fontSize: '16px', textAlign: 'center' }}
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
            <div onClick={() => store.deleteWallet()} className="tap" style={{ color: C.danger, fontWeight: 800, marginTop: '10px', cursor: 'pointer' }}>
              {t('unlock.deleteRestore')}
            </div>
          </div>
        )}

        {/* Multiple wallets: pick which one to unlock, or remove one you can't access. */}
        {multi && (
          <div style={{ marginTop: '6px' }}>
            <div style={{ fontSize: '11px', color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'center', marginBottom: '10px' }}>
              {t('unlock.switchTitle')}
            </div>
            <div style={{ ...C.glass, borderRadius: '16px', overflow: 'hidden' }}>
              {store.wallets.map((w, i) => {
                const active = w.id === store.meta?.id;
                const confirming = deletingId === w.id;
                const border = i < store.wallets.length - 1 ? '1px solid var(--hairline)' : 'none';
                if (confirming) {
                  return (
                    <div key={w.id} style={{ padding: '12px 13px', borderBottom: border }}>
                      <div style={{ fontSize: '12.5px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.45, marginBottom: '10px' }}>
                        {t('unlock.removeConfirm', { name: w.name })}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setDeletingId('')} style={{ flex: 1, height: '42px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.cancel')}</button>
                        <button onClick={() => { store.removeWalletLocked(w.id); setDeletingId(''); }} style={{ flex: 1, height: '42px', background: C.danger, color: '#fff', border: 'none', borderRadius: '999px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.delete')}</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', borderBottom: border }}>
                    <div onClick={() => !active && store.selectWalletForUnlock(w.id)} className="tap" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0, cursor: active ? 'default' : 'pointer' }}>
                      <div style={{ flexShrink: 0, width: '34px', height: '34px', borderRadius: '50%', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '13px' }}>
                        {w.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, textAlign: 'left' }}>
                        <div style={{ fontSize: '14px', fontWeight: 700 }}>{w.name}</div>
                        <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(w.publicKey, 6, 6)}</div>
                      </div>
                    </div>
                    {active ? (
                      <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 800, color: 'var(--on-accent)', background: C.accent, padding: '3px 10px', borderRadius: '999px' }}>{t('unlock.current')}</span>
                    ) : (
                      <span onClick={() => store.selectWalletForUnlock(w.id)} className="tap" style={{ flexShrink: 0, fontSize: '12.5px', fontWeight: 800, color: C.accent, cursor: 'pointer', padding: '4px 6px' }}>{t('unlock.use')}</span>
                    )}
                    <div onClick={() => setDeletingId(w.id)} className="tap" title={t('common.delete')} style={{ flexShrink: 0, width: '30px', height: '30px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
