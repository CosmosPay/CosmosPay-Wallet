import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import { TERMS_URL } from '@/lib/config';
import { CheckRow } from './shared';

export function Backup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [saved, setSaved] = useState(false);
  const [terms, setTerms] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = store.draftMnemonic.split(' ');

  const copy = async () => {
    await copyText(store.draftMnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="scr screen">
      <BackBar title={t('backup.title')} onBack={() => store.setScreen('welcome')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 16px' }}>
        {t('backup.desc')}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(255,93,93,.10)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '13px 14px', marginBottom: '20px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
          <path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: '12.5px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.45 }}>
          {t('backup.warning')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
        {words.map((w, i) => (
          <div key={i} className="glass" style={{ display: 'flex', alignItems: 'center', gap: '9px', borderRadius: '13px', padding: '12px 13px' }}>
            <span style={{ fontSize: '12px', color: C.accent, fontWeight: 700, width: '16px', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px' }}>{w}</span>
          </div>
        ))}
      </div>
      <button
        onClick={copy}
        className="glass-soft" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', color: copied ? C.accent : 'var(--text)', marginBottom: '20px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {copied ? t('common.copied') : t('backup.copy')}
      </button>
      <CheckRow on={saved} onToggle={() => setSaved((s) => !s)} style={{ marginBottom: '12px' }}>
        {t('backup.saved')}
      </CheckRow>
      {/* Sole-responsibility + Terms acceptance — required before continuing.
          The T&C part is a real link (opens in a new tab, doesn't toggle the box). */}
      <CheckRow on={terms} onToggle={() => setTerms((s) => !s)} style={{ marginBottom: '20px' }}>
        {t('backup.terms')}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: C.accent, fontWeight: 800, textDecoration: 'underline' }}
        >
          {t('backup.termsLink')}
        </a>
        .
      </CheckRow>
      <PrimaryButton disabled={!saved || !terms} onClick={() => store.beginVerify()}>
        {t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
