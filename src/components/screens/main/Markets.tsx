import type { WalletStore } from '@/components/store';
import { Spinner, NavMenu } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { MARKET_TOKENS } from '@/constants/markets';
import { MarketRow } from '@/components/molecules/main/MarketRow';
import { BackCircle } from './shared';
import '@/styles/screens/main/shared.css';
import '@/styles/screens/main/markets.css';

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
      <div className="main-head">
        <span className="title-30">{t('markets.title')}</span>
        <div className="row g10">
          {store.loading && <Spinner size={16} color="var(--text)" />}
          {buildKind() === 'ext' && <BackCircle store={store} />}
          <NavMenu store={store} />
        </div>
      </div>
      <div className="flexr g8 market-tabs">
        {tabs.map((tb) => (
          <span key={tb.k} onClick={() => store.setSelectedAsset('mkt:' + tb.k)} className={tab === tb.k ? 'tap market-tab is-on' : 'tap market-tab'}>{tb.l}</span>
        ))}
      </div>
      {list.map((code, i) => (
        <MarketRow key={code} code={code} price={store.prices[code]} delay={i * 0.05} onClick={() => { store.setSelectedAsset(code); store.setScreen('asset'); }} />
      ))}
      {!Object.keys(store.prices).length && (
        <div className="market-empty">
          {store.loading ? t('markets.loading') : t('markets.fail')}
        </div>
      )}
    </div>
  );
}
