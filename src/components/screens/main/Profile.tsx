import { useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { shortAddr } from '@/lib/format';
import { getGreeting } from '@/lib/greeting';
import { copyText } from '@/lib/clipboard';
import { EMAIL_RE } from '@/constants/validation';
import { BackCircle } from './shared';

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

/** Profile email card: shows the wallet's email with inline editing. Cosmos Pay
 *  account creation & linking use this address, so it must be correct/updatable. */
function EmailRow({ store }: { store: WalletStore }) {
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
    <div className="glass card-16" style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '11px', color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '7px' }}>{t('setup.emailLabel')}</div>
      {!editing ? (
        <div className="row g10">
          <span style={{ flex: 1, fontSize: '14px', fontWeight: 700, wordBreak: 'break-all', color: current ? 'var(--text)' : C.dim }}>{current || '—'}</span>
          <span
            onClick={start}
            className="tap"
            title={t('profile.editEmail')}
            className="glass-soft" style={{ width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--text)' }}
          >
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
            className="input" style={{ height: '46px', fontSize: '14px', marginBottom: '8px' }}
          />
          {val.length > 0 && !valid && (
            <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '0 2px 8px' }}>{t('setup.emailInvalid')}</div>
          )}
          <div className="flexr g8">
            <button onClick={() => setEditing(false)} className="glass-soft" style={{ flex: 1, height: '42px', color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
              {t('common.cancel')}
            </button>
            <button
              onClick={save}
              disabled={!valid}
              className="glass-bright" style={{ flex: 1, height: '42px', color: 'var(--primary-text)', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: valid ? 'pointer' : 'default', opacity: valid ? 1 : 0.5 }}
            >
              {t('common.done')}
            </button>
          </div>
        </>
      )}
      <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, marginTop: '9px', lineHeight: 1.5 }}>{t('profile.emailNote')}</div>
    </div>
  );
}

/* ------------------------------ PROFILE ------------------------------ */
export function Profile({ store }: { store: WalletStore }) {
  const t = store.t;
  // Cosmos Pay is an integration (swaps + BlindPay payments) — tap to manage keys/receiver.
  const cosmosPayRow = { icon: '◇', label: t('cosmospay.manage'), onClick: () => store.setScreen('cosmospay') };
  const rows = [
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 22px' }}>
        <span className="title-30">{t('tab.profile')}</span>
        {/* Profile is itself a menu destination, so a hamburger here is pointless —
            in the extension (no bottom bar) the top-right button goes back. */}
        {buildKind() === 'ext' && <BackCircle store={store} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '26px' }}>
        <div onClick={() => fileRef.current?.click()} className="tap" title={t('profile.changePhoto')} style={{ position: 'relative', flexShrink: 0, width: '62px', height: '62px', borderRadius: '50%', background: 'var(--glass-soft-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800, cursor: 'pointer', overflow: 'visible' }}>
          {avatar ? (
            <img src={avatar} alt="" style={{ width: '62px', height: '62px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
          <div style={{ position: 'absolute', right: '-2px', bottom: '-2px', width: '22px', height: '22px', borderRadius: '50%', background: C.accent, color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="2" /></svg>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <span style={{ fontSize: '18px', fontWeight: 800 }}>{name}</span>
          <div className="row g7">
            <span style={{ fontSize: '13px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(pub, 8, 8)}</span>
            <span onClick={copyAddr} className="tap" title={t('profile.copyAddress')} style={{ display: 'flex', color: copied ? C.accent : C.muted, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            </span>
          </div>
          <span style={{ fontSize: '11.5px', color: C.accent, fontWeight: 700 }}>
            {store.network.label}{g.age !== null ? ` · ${g.age} ${t('profile.years')}` : ''}
          </span>
        </div>
      </div>

      {/* Email — editable: Cosmos Pay registration/linking is tied to it. */}
      <EmailRow store={store} />

      <div className="label-up" style={{ marginBottom: '10px' }}>
        {t('profile.myWallets')} ({store.wallets.length})
      </div>
      <div className="glass" style={{ borderRadius: '18px', overflow: 'hidden', marginBottom: '20px' }}>
        {store.wallets.map((w) => {
          const active = w.id === store.meta?.id;
          return (
            <div key={w.id} onClick={() => !active && store.switchWallet(w.id)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: '1px solid var(--hairline)', cursor: active ? 'default' : 'pointer' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px' }}>{w.name.slice(0, 1).toUpperCase()}</div>
              <div className="f1 min0">
                <div style={{ fontSize: '14.5px', fontWeight: 700 }}>{w.name}</div>
                <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(w.publicKey, 6, 6)}</div>
              </div>
              {active ? (
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--on-accent)', background: C.accent, padding: '3px 10px', borderRadius: '999px' }}>{t('profile.active')}</span>
              ) : (
                <span style={{ color: C.muted, fontSize: '13px', fontWeight: 700 }}>{t('profile.switch')}</span>
              )}
            </div>
          );
        })}
        <div onClick={() => store.startAddWallet()} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', color: C.accent }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>+</div>
          <span style={{ fontSize: '14.5px', fontWeight: 800 }}>{t('profile.addWallet')}</span>
        </div>
      </div>

      <div className="glass" style={{ borderRadius: '18px', overflow: 'hidden', marginBottom: '20px' }}>
        {rows.map((r, i) => (
          <div key={i} onClick={r.onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 18px', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none', cursor: 'pointer' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '11px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>{r.icon}</div>
            <span style={{ flex: 1, fontSize: '15px', fontWeight: 700 }}>{r.label}</span>
            <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
          </div>
        ))}
      </div>
      <div onClick={() => store.lock()} className="tap" style={{ textAlign: 'center', color: C.danger, fontSize: '15px', fontWeight: 700, padding: '14px', cursor: 'pointer' }}>{t('profile.lock')}</div>
    </div>
  );
}
