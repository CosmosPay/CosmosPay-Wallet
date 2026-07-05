import { useMemo, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, Spinner, Logo } from '@/components/parts';
import { LangSelect } from '@/components/flags';
import { getGreeting } from '@/lib/greeting';
import { shortAddr } from '@/lib/format';
import '@/styles/screens/unlock.css';

export function Unlock({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);
  // Memoized: the salutation is random — keep it stable while the user types.
  const g = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, t, store.meta?.gender],
  );
  const multi = store.wallets.length > 1;

  const submit = async () => {
    if (!pwd) return;
    const ok = await store.unlock(pwd);
    if (!ok) setPwd('');
  };

  return (
    <div className="scr screen col unlock-screen">
      {/* language switcher, top-right — same control as the Welcome screen */}
      <div className="unlock-langbar">
        <LangSelect value={store.lang} onChange={store.setLang} />
      </div>
      <div className="f1 col center unlock-hero">
        <div className="unlock-logo"><Logo size={92} /></div>
        {g.isBirthday && <div className="unlock-birthday">🎂 {g.age !== null ? t('unlock.yearsOld', { age: g.age }) : t('unlock.happyDay')}</div>}
        <div className="unlock-line">{g.line}</div>
        <div className="unlock-subtitle">
          {t('unlock.subtitle')}
        </div>
        <div className="unlock-pwd-wrap">
          <input
            type={showPwd ? 'text' : 'password'}
            value={pwd}
            autoFocus
            placeholder={t('pwd.label')}
            onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="input unlock-pwd-input"
          />
          {/* per-field eye toggle, same pattern as the password-setup screen */}
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            aria-label={showPwd ? 'Ocultar' : 'Mostrar'}
            className={showPwd ? 'unlock-eye is-shown' : 'unlock-eye'}
          >
            {showPwd ? (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <path d="M2 12s3.5-7 10-7c2.2 0 4.1.8 5.6 1.9M22 12s-3.5 7-10 7c-2.2 0-4.1-.8-5.6-1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="col g12">
        <PrimaryButton disabled={!pwd || store.busy} onClick={submit}>
          {store.busy ? <Spinner /> : t('unlock.unlock')}
        </PrimaryButton>
        {!confirmWipe ? (
          <div onClick={() => setConfirmWipe(true)} className="tap unlock-forgot">
            {t('unlock.forgot')}
          </div>
        ) : (
          <div className="unlock-wipe">
            {t('unlock.forgotDesc')}
            {/* Removes ONLY the active wallet (the one whose password was forgotten) —
                other wallets on this device are untouched. */}
            <div onClick={() => store.meta && store.removeWalletLocked(store.meta.id)} className="tap unlock-wipe-delete">
              {t('unlock.deleteRestore')}
            </div>
          </div>
        )}

        {/* Multiple wallets: compact dropdown to pick which one to unlock, or remove one. */}
        {multi && (
          <div className="unlock-switch">
            <button onClick={() => setWalletOpen((o) => !o)} className="glass-soft unlock-switch-btn">
              {t('unlock.switchTitle')}
              <span className={walletOpen ? 'unlock-switch-caret is-open' : 'unlock-switch-caret'}>▼</span>
            </button>
            {walletOpen && (
              <>
                <div onClick={() => { setWalletOpen(false); setDeletingId(''); }} className="unlock-switch-overlay" />
                <div className="scr glass unlock-switch-menu">
                  {store.wallets.map((w) => {
                    const active = w.id === store.meta?.id;
                    if (deletingId === w.id) {
                      return (
                        <div key={w.id} className="unlock-del">
                          <div className="unlock-del-text">{t('unlock.removeConfirm', { name: w.name })}</div>
                          <div className="flexr g8">
                            <button onClick={() => setDeletingId('')} className="glass-soft unlock-del-btn">{t('common.cancel')}</button>
                            <button onClick={() => { store.removeWalletLocked(w.id); setDeletingId(''); setWalletOpen(false); }} className="unlock-del-btn unlock-del-btn--danger">{t('common.delete')}</button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={w.id} className={active ? 'unlock-wallet-row is-active' : 'unlock-wallet-row'}>
                        <div onClick={() => { if (!active) store.selectWalletForUnlock(w.id); setWalletOpen(false); }} className="tap f1 row g10 min0 unlock-wallet-main">
                          <div className="unlock-wallet-avatar">
                            {w.avatar ? <img src={w.avatar} alt="" className="unlock-wallet-avatar-img" /> : w.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="unlock-wallet-meta">
                            <div className="unlock-wallet-name">{w.name}</div>
                            <div className="unlock-wallet-addr">{shortAddr(w.publicKey, 5, 5)}</div>
                          </div>
                        </div>
                        {active && <span className="unlock-wallet-check">✓</span>}
                        <div onClick={() => setDeletingId(w.id)} className="tap unlock-wallet-del" title={t('common.delete')}>
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
