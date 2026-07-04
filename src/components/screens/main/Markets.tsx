import type { WalletStore } from '@/components/store';
import { C, AssetLogo, assetMeta, Spinner, NavMenu } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { fmt, pct } from '@/lib/format';
import type { PriceInfo } from '@/lib/stellar';
import { MARKET_TOKENS } from '@/constants/markets';
import { BackCircle, changeColor, useAnimatedNumber } from './shared';

function MarketRow({ code, price, onClick, delay = 0 }: { code: string; price?: PriceInfo; onClick: () => void; delay?: number }) {
  const m = assetMeta(code);
  const chg = price?.change24h ?? 0;
  const shownPrice = useAnimatedNumber(price?.usd ?? 0);
  const shownChg = useAnimatedNumber(chg);
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 2px', cursor: 'pointer', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div className="row g12">
        <AssetLogo code={code} size={38} />
        <div className="col g2">
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span className="t-dim-12">{code}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {price ? '$' + fmt(shownPrice, price.usd >= 1 ? 2 : 4) : '—'}
        </span>
        <span style={{ fontSize: '12px', color: changeColor(chg), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{price ? pct(shownChg) : ''}</span>
      </div>
    </div>
  );
}

/* ------------------------------ MARKETS ------------------------------ */
export function Markets({ store }: { store: WalletStore }) {
  const t = store.t;
  const tabs: { k: string; l: string }[] = [
    { k: 'all', l: t('markets.all') },
    { k: 'gainers', l: t('markets.gainers') },
    { k: 'losers', l: t('markets.losers') },
  ];
  const tab = store.selectedAsset.startsWith('mkt:') ? store.selectedAsset.slice(4) : 'all';
  let list = MARKET_TOKENS.slice();
  if (tab === 'gainers') list = list.filter((c) => (store.prices[c]?.change24h ?? 0) >= 0);
  if (tab === 'losers') list = list.filter((c) => (store.prices[c]?.change24h ?? 0) < 0);

  return (
    <div className="scr screen pb-110">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 18px' }}>
        <span className="title-30">{t('markets.title')}</span>
        <div className="row g10">
          {store.loading && <Spinner size={16} color="var(--text)" />}
          {buildKind() === 'ext' && <BackCircle store={store} />}
          <NavMenu store={store} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', fontSize: '13px', fontWeight: 700 }}>
        {tabs.map((tb) => {
          const on = tab === tb.k;
          return (
            <span key={tb.k} onClick={() => store.setSelectedAsset('mkt:' + tb.k)} className="tap" style={{ padding: '8px 14px', borderRadius: '11px', background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : C.muted, cursor: 'pointer' }}>{tb.l}</span>
          );
        })}
      </div>
      {list.map((code, i) => (
        <MarketRow key={code} code={code} price={store.prices[code]} delay={i * 0.05} onClick={() => { store.setSelectedAsset(code); store.setScreen('asset'); }} />
      ))}
      {!Object.keys(store.prices).length && (
        <div style={{ textAlign: 'center', color: C.dim, fontSize: '13px', fontWeight: 600, padding: '24px' }}>
          {store.loading ? t('markets.loading') : t('markets.fail')}
        </div>
      )}
    </div>
  );
}
