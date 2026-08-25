import { ExternalLink } from '@/ui/ExternalLink';
import type { WalletStore } from '@/state/store';
import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { computePortfolio } from '@/lib/portfolio';
import { fmt, trim, pct } from '@/lib/format';
import { explorerAccountUrl } from '@/lib/stellar';
import '@/styles/features/wallet/asset.css';
import { cx } from '@/lib/cx';

/* --------------------------- ASSET DETAIL ---------------------------- */
export function Asset({ store }: { store: WalletStore }) {
  const t = store.t;
  const code = store.selectedAsset || 'XLM';
  const m = assetMeta(code);
  const price = store.prices[code];
  const { rows } = computePortfolio(store.account, store.prices, store.network.id);
  const held = rows.find((r) => r.code === code);

  return (
    <div className="scr screen pb-30">
      <div className="asset-head">
        <div onClick={() => store.go(store.tab, store.tab)} className="glass-soft circle-btn asset-back">‹</div>
        <div className="row g8">
          <AssetLogo code={code} size={24} />
          <span className="asset-name">{m.name} <span className="asset-code">{code}</span></span>
        </div>
        <div className="asset-head-pad" />
      </div>

      <div className="asset-price-row">
        <span className="asset-price">
          {price ? '$' + fmt(price.usd, price.usd >= 1 ? 2 : 4) : '—'}
        </span>
        {price && <span className={cx('asset-change', price.change24h >= 0 ? 'is-up' : 'is-down')}>{price.change24h >= 0 ? '↗' : '↘'} {pct(price.change24h)}</span>}
      </div>
      <div className="asset-sub">{t('asset.marketPrice')}</div>

      <div className="glass card asset-bal-card">
        <div className="asset-bal-label">{t('asset.balance')}</div>
        <div className="asset-bal-value">{held ? trim(held.amount, 7) : '0'} {code}</div>
        <div className="asset-bal-fiat">{held?.value != null ? '≈ $' + fmt(held.value, 2) : '—'}</div>
      </div>

      {code === 'XLM' && (
        <div className="flexr g10 asset-actions">
          <button onClick={() => store.setScreen('send')} className="asset-btn asset-btn--send">{t('common.send')}</button>
          <button onClick={() => store.setScreen('receive')} className="glass-soft asset-btn asset-btn--ghost">{t('common.receive')}</button>
        </div>
      )}
      {store.meta && (
        <ExternalLink href={explorerAccountUrl(store.network, store.meta.publicKey)} className="asset-explorer">
          {t('asset.explorer')}
        </ExternalLink>
      )}
    </div>
  );
}
