import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, Spinner, Logo, inputStyle } from '@/components/parts';
import { getGreeting } from '@/lib/greeting';
import { shortAddr } from '@/lib/format';

export function Unlock({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);
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

        {/* Multiple wallets: compact dropdown to pick which one to unlock, or remove one. */}
        {multi && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setWalletOpen((o) => !o)} style={{ width: '100%', height: '48px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>
              {t('unlock.switchTitle')}
              <span style={{ fontSize: '9px', opacity: 0.7, transform: walletOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
            </button>
            {walletOpen && (
              <>
                <div onClick={() => { setWalletOpen(false); setDeletingId(''); }} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
                <div className="scr" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 31, ...C.glass, borderRadius: '16px', padding: '6px', maxHeight: '260px', overflowY: 'auto', animation: 'fadeUp .18s ease' }}>
                  {store.wallets.map((w) => {
                    const active = w.id === store.meta?.id;
                    if (deletingId === w.id) {
                      return (
                        <div key={w.id} style={{ padding: '10px 10px' }}>
                          <div style={{ fontSize: '12px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.4, marginBottom: '9px' }}>{t('unlock.removeConfirm', { name: w.name })}</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => setDeletingId('')} style={{ flex: 1, height: '38px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.cancel')}</button>
                            <button onClick={() => { store.removeWalletLocked(w.id); setDeletingId(''); setWalletOpen(false); }} style={{ flex: 1, height: '38px', background: C.danger, color: '#fff', border: 'none', borderRadius: '999px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.delete')}</button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 9px', borderRadius: '12px', background: active ? 'var(--surface)' : 'transparent' }}>
                        <div onClick={() => { if (!active) store.selectWalletForUnlock(w.id); setWalletOpen(false); }} className="tap" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, cursor: 'pointer' }}>
                          <div style={{ flexShrink: 0, width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12.5px' }}>
                            {w.avatar ? <img src={w.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : w.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontSize: '13.5px', fontWeight: 700 }}>{w.name}</div>
                            <div style={{ fontSize: '11px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(w.publicKey, 5, 5)}</div>
                          </div>
                        </div>
                        {active && <span style={{ flexShrink: 0, color: C.accent, fontWeight: 800, fontSize: '13px' }}>✓</span>}
                        <div onClick={() => setDeletingId(w.id)} className="tap" title={t('common.delete')} style={{ flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
