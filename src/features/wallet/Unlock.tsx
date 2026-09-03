import { useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Logo } from '@/ui/Logo';
import { Spinner } from '@/ui/Spinner';
import { DeviceAuthButton } from '@/ui/DeviceAuthButton';
import { EyeIcon } from '@/ui/EyeIcon';
import { LangSelect } from '@/ui/LangSelect';
import { getGreeting } from '@/lib/greeting';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/unlock.css';

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

  /**
   * `store.busy` as well as the empty check — and the store holds a ref guard behind it.
   *
   * This fired on every Enter keydown with no re-entry guard at all, so key auto-repeat
   * (~30/s held down) launched a fresh PBKDF2 derivation every frame. Each one is
   * a password attempt; the backoff ladder only bounds attempts it gets to see finish.
   */
  const submit = async () => {
    if (!pwd || store.busy) return;
    const res = await store.unlock(pwd);
    // Cleared only on a real rejection: wiping the field because the attempt was throttled
    // or raced makes the user retype a password that was never judged.
    if (!res.ok && res.reason === 'wrong') setPwd('');
  };

  /**
   * NO AUTO-PROMPT. The biometric sheet is raised by the button below, never by mounting.
   *
   * It used to fire on mount, guarded by a ref — but the guard was per MOUNT, and `lock()`
   * sets the screen to `unlock`, so this component remounts on every auto-lock and the
   * sheet came back unbidden several times a day. On a passive-face device that makes the
   * 5-minute idle auto-lock decorative: the session ends and re-opens the moment the owner
   * glances at the screen, which is not a lock.
   *
   * It also worked against `ConfirmSign`, which deliberately refuses to auto-prompt on the
   * grounds that "a signing sheet that appears without a tap is how a user approves
   * something they never read". That reasoning does not stop being true one screen away:
   * a user trained by dozens of unprompted unlock sheets is exactly the user who touches
   * the sensor before reading the signing sheet.
   */
  const [deviceBusy, setDeviceBusy] = useState(false);
  const deviceSubmit = async () => {
    setDeviceBusy(true);
    try {
      await store.unlockWithDevice();
    } finally {
      setDeviceBusy(false);
    }
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

        {/* The field and everything that acts on it, as ONE group.
            The unlock button used to sit at the bottom of the screen. That put most of a
            screen between it and the field, so when the keyboard came up the button had to
            travel that whole distance while the field travelled a fraction of it — the same
            movement, on the same clock, but not the same distance, which is what reads as
            the two of them coming apart. Together they translate as one block.
            `data-kb-group` is what tells src/lib/viewport.ts to bring the WHOLE group back
            above the keyboard, not just the field it happens to be scrolling to. */}
        <div className="col g12 unlock-controls" data-kb-group>
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
              className={cx('unlock-eye', showPwd && 'is-shown')}
            >
              <EyeIcon off={showPwd} />
            </button>
          </div>
          <PrimaryButton disabled={!pwd || store.busy} onClick={submit}>
            {store.busy ? <Spinner /> : t('unlock.unlock')}
          </PrimaryButton>
          {/* Only when this wallet actually enrolled AND the device can still answer —
              a button that can only fail is worse than no button. */}
          {store.deviceAuthReady && (
            <DeviceAuthButton
              kind={store.deviceAuthKind}
              label={t('devAuth.unlockWith', { method: store.deviceAuthMethod })}
              busy={deviceBusy || store.busy}
              onClick={deviceSubmit}
            />
          )}
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
                <span className={cx('unlock-switch-caret', walletOpen && 'is-open')}>▼</span>
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
                        <div key={w.id} className={cx('unlock-wallet-row', active && 'is-active')}>
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
    </div>
  );
}
