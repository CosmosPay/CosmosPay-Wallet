import { useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { shortAddr } from '@/lib/format';
import { getGreeting } from '@/lib/greeting';
import { copyText } from '@/lib/clipboard';
import { BackCircle } from './shared';
import '@/styles/screens/main/profile.css';

/** Center-crop + downscale an image file to a small JPEG data URL for the avatar. */
function resizeToDataUrl(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = URL.createObjectURL(file);
  });
}

/* ------------------------------ PROFILE ------------------------------ */
export function Profile({ store }: { store: WalletStore }) {
  const t = store.t;
  // Cosmos Pay is an integration (swaps + BlindPay payments) — tap to manage keys/receiver.
  const cosmosPayRow = { icon: '◇', label: t('cosmospay.manage'), onClick: () => store.setScreen('cosmospay') };
  const rows = [
    { icon: '✎', label: t('profile.editProfile'), onClick: () => store.setScreen('edit-profile') },
    ...(store.meta?.email ? [cosmosPayRow] : []),
    { icon: '⚷', label: t('profile.exportKeys'), onClick: () => store.setScreen('export') },
    { icon: '⛁', label: t('profile.receiveAddr'), onClick: () => store.setScreen('receive') },
    { icon: '⚙', label: t('profile.settings'), onClick: () => store.setScreen('settings') },
    { icon: '?', label: t('profile.about'), onClick: () => store.setScreen('about') },
  ];
  const pub = store.meta?.publicKey ?? '';
  const name = store.meta?.name || 'Mi wallet';
  const avatar = store.meta?.avatar;
  // Memoized: the salutation is random — keep it stable across re-renders.
  const g = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, t, store.meta?.gender],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const onFile = async (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        await store.setWalletAvatar(await resizeToDataUrl(f));
      } catch {
        /* ignore bad image */
      }
    }
    e.target.value = '';
  };
  const copyAddr = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr screen pb-110">
      <div className="profile-head">
        <span className="title-30">{t('tab.profile')}</span>
        {/* Profile is itself a menu destination, so a hamburger here is pointless —
            in the extension (no bottom bar) the top-right button goes back. */}
        {buildKind() === 'ext' && <BackCircle store={store} />}
      </div>
      <div className="row g14 profile-id">
        <div onClick={() => fileRef.current?.click()} className="tap profile-avatar" title={t('profile.changePhoto')}>
          {avatar ? (
            <img src={avatar} alt="" className="profile-avatar-img" />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
          <div className="profile-avatar-cam">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="2" /></svg>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden-input" />
        <div className="profile-idcol">
          <span className="profile-name">{name}</span>
          <div className="row g7">
            <span className="profile-addr">{shortAddr(pub, 8, 8)}</span>
            <span onClick={copyAddr} className={copied ? 'tap profile-copy is-copied' : 'tap profile-copy'} title={t('profile.copyAddress')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            </span>
          </div>
          <span className="profile-meta">
            {store.network.label}{g.age !== null ? ` · ${g.age} ${t('profile.years')}` : ''}
          </span>
          {store.meta?.email && <span className="profile-email-line" title={store.meta.email}>{store.meta.email}</span>}
        </div>
      </div>

      <div className="label-up profile-wallets-label">
        {t('profile.myWallets')} ({store.wallets.length})
      </div>
      <div className="glass profile-list">
        {store.wallets.map((w) => {
          const active = w.id === store.meta?.id;
          return (
            <div key={w.id} onClick={() => !active && store.switchWallet(w.id)} className={active ? 'tap profile-wallet-row is-active' : 'tap profile-wallet-row'}>
              <div className="profile-wallet-avatar">{w.name.slice(0, 1).toUpperCase()}</div>
              <div className="f1 min0">
                <div className="profile-wallet-name">{w.name}</div>
                <div className="profile-wallet-addr">{shortAddr(w.publicKey, 6, 6)}</div>
              </div>
              {active ? (
                <span className="profile-wallet-active">{t('profile.active')}</span>
              ) : (
                <span className="profile-wallet-switch">{t('profile.switch')}</span>
              )}
            </div>
          );
        })}
        <div onClick={() => store.startAddWallet()} className="tap profile-add-wallet">
          <div className="profile-add-icon">+</div>
          <span className="profile-add-label">{t('profile.addWallet')}</span>
        </div>
      </div>

      <div className="glass profile-menu">
        {rows.map((r, i) => (
          <div key={i} onClick={r.onClick} className="tap profile-menu-row">
            <div className="profile-menu-icon">{r.icon}</div>
            <span className="profile-menu-label">{r.label}</span>
            <span className="profile-menu-chev">›</span>
          </div>
        ))}
      </div>
      <div onClick={() => store.lock()} className="tap profile-lock">{t('profile.lock')}</div>
    </div>
  );
}
