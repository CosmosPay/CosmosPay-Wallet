import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, BackBar, Spinner, AssetLogo } from '@/components/parts';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { copyText } from '@/lib/clipboard';

/* ----------------------------- RECEIVE ------------------------------ */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const pub = store.meta?.publicKey ?? '';

  useEffect(() => {
    // Encode a SEP-0007 payment request so other Stellar wallets can pre-fill the send.
    if (pub) qrDataUrl(buildSep7Pay({ destination: pub })).then(setQr).catch(() => {});
  }, [pub]);

  const copy = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('receive.stellarAddress'), text: pub });
      else copy();
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="scr screen pb-30">
      <BackBar title={t('receive.title')} onBack={() => store.back('home')} />
      <div style={{ textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: 600, margin: '18px 0 22px' }}>
        {t('receive.desc')}
      </div>
      <div style={{ background: '#fff', borderRadius: '24px', padding: '18px', width: '224px', margin: '0 auto 24px' }}>
        {qr ? (
          <img src={qr} width="188" height="188" alt="QR" style={{ display: 'block', width: '188px', height: '188px', margin: '0 auto' }} />
        ) : (
          <div style={{ width: '188px', height: '188px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner color="#0a0c0b" /></div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        <div className="glass-soft" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px 8px 9px', borderRadius: '30px' }}>
          <AssetLogo code="XLM" size={26} />
          <span style={{ fontSize: '14px', fontWeight: 700 }}>{t('receive.stellarAddress')}</span>
        </div>
      </div>
      <div className="glass" style={{ borderRadius: '16px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, marginBottom: '5px' }}>{t('receive.addressLabel')}</div>
          <div style={{ fontSize: '12.5px', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.4, fontFamily: 'monospace' }}>{pub}</div>
        </div>
        <div onClick={copy} style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: '12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: copied ? C.accent : C.muted }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </div>
      </div>
      <div className="flexr g10">
        <button onClick={copy} className="glass-soft" style={{ flex: 1, height: '54px', color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{copied ? t('common.copied') : t('common.copy')}</button>
        <button onClick={share} style={{ flex: 1, height: '54px', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.share')}</button>
      </div>

      <div onClick={() => store.setScreen('paylink')} className="tap glass-soft" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '16px', cursor: 'pointer', marginTop: '14px' }}>
        <div className="row g12">
          <div style={{ fontSize: '18px' }}>🔗</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>{t('paylink.title')}</div>
            <div style={{ fontSize: '12px', color: C.muted, fontWeight: 600 }}>{t('paylink.entryDesc')}</div>
          </div>
        </div>
        <span style={{ color: C.dim, fontSize: '18px' }}>›</span>
      </div>
    </div>
  );
}
