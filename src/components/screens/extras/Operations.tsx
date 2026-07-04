import type { WalletStore } from '@/components/store';
import { C, BackBar } from '@/components/parts';
import { readText } from '@/lib/clipboard';

/* --------------------------- OPERATIONS HUB ------------------------- */
function OpRow({ glyph, label, sub, onClick }: { glyph: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '15px 16px', cursor: 'pointer' }}>
      <div className="glass-soft" style={{ flexShrink: 0, width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>{glyph}</div>
      <div className="f1 min0">
        <div style={{ fontSize: '15px', fontWeight: 700 }}>{label}</div>
        {sub && <div className="t-dim-12">{sub}</div>}
      </div>
      <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
    </div>
  );
}

export function Operations({ store }: { store: WalletStore }) {
  const t = store.t;

  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) store.setScreen('send');
    else store.flash(t('ops.pasteInvalid'), 'err');
  };

  const rows: { glyph: string; label: string; sub?: string; onClick: () => void }[] = [
    { glyph: '✎', label: t('ops.signTx'), sub: t('ops.signTxSub'), onClick: () => store.setScreen('sign-tx') },
    { glyph: '⛓', label: t('ops.pastePay'), sub: t('ops.pastePaySub'), onClick: pastePayUrl },
    { glyph: '⛶', label: t('scan.scanQr'), onClick: () => store.setScreen('scan') },
    { glyph: '＋', label: t('addAsset.title'), onClick: () => store.setScreen('add-asset') },
    { glyph: '⌗', label: t('net.add'), onClick: () => store.setScreen('add-network') },
    { glyph: '⚷', label: t('profile.exportKeys'), onClick: () => store.setScreen('export') },
    { glyph: '⚙', label: t('profile.settings'), onClick: () => store.setScreen('settings') },
  ];

  return (
    <div className="scr screen col">
      <BackBar title={t('ops.title')} onBack={() => store.go('home', 'home')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>{t('ops.desc')}</div>
      {/* flexShrink 0: inside a flex-column scroll container the card would otherwise
          COMPRESS to fit (squashed rows, nothing to scroll) instead of overflowing. */}
      <div className="glass" style={{ borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
            <OpRow glyph={r.glyph} label={r.label} sub={r.sub} onClick={r.onClick} />
          </div>
        ))}
      </div>
    </div>
  );
}
