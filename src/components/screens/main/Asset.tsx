import type { WalletStore } from '@/components/store';
import { C, AssetLogo, assetMeta } from '@/components/parts';
import { computePortfolio } from '@/lib/portfolio';
import { fmt, trim, pct } from '@/lib/format';
import { explorerAccountUrl } from '@/lib/stellar';
import { changeColor } from './shared';

/* --------------------------- ASSET DETAIL ---------------------------- */
export function Asset({ store }: { store: WalletStore }) {
  const t = store.t;
  const code = store.selectedAsset || 'XLM';
  const m = assetMeta(code);
  const price = store.prices[code];
  const { rows } = computePortfolio(store.account, store.prices);
  const held = rows.find((r) => r.code === code);

  return (
    <div className="scr screen pb-30">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0 18px' }}>
        <div onClick={() => store.go(store.tab, store.tab)} className="glass-soft" style={{ width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', cursor: 'pointer' }}>‹</div>
        <div className="row g8">
          <AssetLogo code={code} size={24} />
          <span style={{ fontSize: '16px', fontWeight: 700 }}>{m.name} <span style={{ color: C.dim, fontSize: '11px' }}>{code}</span></span>
        </div>
        <div style={{ width: '38px' }} />
      </div>

      <div style={{ margin: '8px 0 6px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <span style={{ fontSize: '38px', fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
          {price ? '$' + fmt(price.usd, price.usd >= 1 ? 2 : 4) : '—'}
        </span>
        {price && <span style={{ color: changeColor(price.change24h), fontSize: '14px', fontWeight: 700 }}>{price.change24h >= 0 ? '↗' : '↘'} {pct(price.change24h)}</span>}
      </div>
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, marginBottom: '22px' }}>{t('asset.marketPrice')}</div>

      <div className="glass card" style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '6px' }}>{t('asset.balance')}</div>
        <div style={{ fontSize: '26px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{held ? trim(held.amount, 7) : '0'} {code}</div>
        <div style={{ fontSize: '13px', color: C.dim, fontWeight: 600, marginTop: '4px' }}>{held?.value != null ? '≈ $' + fmt(held.value, 2) : '—'}</div>
      </div>

      {code === 'XLM' && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <button onClick={() => store.setScreen('send')} style={{ flex: 1, height: '54px', background: 'var(--primary-bg)', color: 'var(--primary-text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.send')}</button>
          <button onClick={() => store.setScreen('receive')} className="glass-soft" style={{ flex: 1, height: '54px', color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.receive')}</button>
        </div>
      )}
      {store.meta && (
        <a href={explorerAccountUrl(store.network, store.meta.publicKey)} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: 700, padding: '12px', textDecoration: 'none' }}>
          {t('asset.explorer')}
        </a>
      )}
    </div>
  );
}
