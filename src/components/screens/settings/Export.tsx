import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { copyText } from '@/lib/clipboard';

/* ------------------------------ EXPORT ------------------------------ */
export function Export({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  const unlock = async () => {
    setBusy(true);
    const ok = await store.checkPassword(pwd);
    setBusy(false);
    if (ok) setRevealed(true);
    else store.flash(t('pwd.label') + ' ✗', 'err');
  };

  const copy = async (label: string, value: string) => {
    await copyText(value);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(''), 1500);
  };

  const mnemonic = store.session?.mnemonic ?? null;
  const secret = store.session?.secret ?? '';

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 30px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('export.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(255,93,93,.10)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '14px', margin: '14px 0 20px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}><path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span style={{ fontSize: '12.5px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.45 }}>
          {t('export.warning')}
        </span>
      </div>

      {!revealed ? (
        <>
          <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '18px' }}>
            {t('export.enterPwd')}
          </div>
          <input type="password" value={pwd} placeholder={t('pwd.label')} onChange={(e) => setPwd((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} className="input" style={{ marginBottom: '18px' }} />
          <PrimaryButton disabled={!pwd || busy} onClick={unlock}>{busy ? <Spinner /> : t('export.reveal')}</PrimaryButton>
        </>
      ) : (
        <>
          {mnemonic ? (
            <Reveal title={t('export.phraseTitle')} value={mnemonic} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copiedKey === 'phrase'} onCopy={() => copy('phrase', mnemonic)} grid />
          ) : (
            <div className="glass" style={{ borderRadius: '14px', padding: '14px', fontSize: '12.5px', color: C.muted, fontWeight: 600, marginBottom: '16px', lineHeight: 1.5 }}>
              {t('export.noPhrase')}
            </div>
          )}
          <Reveal title={t('export.secretTitle')} value={secret} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copiedKey === 'secret'} onCopy={() => copy('secret', secret)} />
          <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, lineHeight: 1.5, marginTop: '4px' }}>
            {t('export.compat')}
          </div>
        </>
      )}
    </div>
  );
}

function Reveal({ title, value, mono, copied, onCopy, grid, copyLabel, copiedLabel }: { title: string; value: string; mono: boolean; copied: boolean; onCopy: () => void; grid?: boolean; copyLabel: string; copiedLabel: string }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</div>
      {grid ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          {value.split(' ').map((w, i) => (
            <div key={i} className="glass" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '11px', padding: '10px 12px' }}>
              <span style={{ fontSize: '11px', color: C.accent, fontWeight: 700, width: '14px' }}>{i + 1}</span>
              <span style={{ fontSize: '14px', fontWeight: 700 }}>{w}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass" style={{ borderRadius: '14px', padding: '14px', fontSize: '13px', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.5, fontFamily: mono ? 'monospace' : 'inherit', marginBottom: '10px' }}>{value}</div>
      )}
      <button onClick={onCopy} className="glass-soft" style={{ width: '100%', color: copied ? C.accent : 'var(--text)', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>{copied ? copiedLabel : copyLabel}</button>
    </div>
  );
}
