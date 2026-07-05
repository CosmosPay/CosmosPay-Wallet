import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar, Spinner, AssetLogo } from '@/components/parts';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { copyText } from '@/lib/clipboard';
import '@/styles/screens/money/receive.css';

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
      <div className="receive-desc">
        {t('receive.desc')}
      </div>
      <div className="receive-qr">
        {qr ? (
          <img src={qr} width="188" height="188" alt="QR" className="receive-qr-img" />
        ) : (
          <div className="receive-qr-ph"><Spinner color="#0a0c0b" /></div>
        )}
      </div>
      <div className="center receive-chip-wrap">
        <div className="glass-soft receive-chip">
          <AssetLogo code="XLM" size={26} />
          <span className="receive-chip-label">{t('receive.stellarAddress')}</span>
        </div>
      </div>
      <div className="glass row between g12 receive-addr-card">
        <div className="min0">
          <div className="receive-addr-label">{t('receive.addressLabel')}</div>
          <div className="receive-addr-value">{pub}</div>
        </div>
        <div onClick={copy} className={copied ? 'receive-copy is-copied' : 'receive-copy'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </div>
      </div>
      <div className="flexr g10">
        <button onClick={copy} className="glass-soft receive-btn">{copied ? t('common.copied') : t('common.copy')}</button>
        <button onClick={share} className="receive-btn receive-btn--share">{t('common.share')}</button>
      </div>

      <div onClick={() => store.setScreen('paylink')} className="tap glass-soft row between receive-paylink">
        <div className="row g12">
          <div className="receive-paylink-emoji">🔗</div>
          <div>
            <div className="receive-paylink-title">{t('paylink.title')}</div>
            <div className="receive-paylink-desc">{t('paylink.entryDesc')}</div>
          </div>
        </div>
        <span className="receive-paylink-chev">›</span>
      </div>
    </div>
  );
}
