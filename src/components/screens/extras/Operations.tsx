import type { WalletStore } from '@/components/store';
import { BackBar } from '@/components/parts';
import { readText } from '@/lib/clipboard';
import { OpRow } from '@/components/molecules/extras/OpRow';
import '@/styles/screens/extras/operations.css';

/* --------------------------- OPERATIONS HUB ------------------------- */
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
      <div className="operations-desc">{t('ops.desc')}</div>
      {/* flexShrink 0 (.shrink0): inside a flex-column scroll container the card would
          otherwise COMPRESS to fit (squashed rows, nothing to scroll) instead of overflowing. */}
      <div className="glass col shrink0 operations-card">
        {rows.map((r) => (
          <div key={r.label}>
            <OpRow glyph={r.glyph} label={r.label} sub={r.sub} onClick={r.onClick} />
          </div>
        ))}
      </div>
    </div>
  );
}
