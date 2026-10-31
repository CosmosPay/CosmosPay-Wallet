import { useId } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Tabs } from '@/ui/Tabs';
import { MARKET_TOKENS } from '@/constants/markets';
import { MarketRow } from '@/features/wallet/MarketRow';
import '@/styles/features/wallet/markets.css';

type MarketTab = 'all' | 'gainers' | 'losers';

/* ------------------------------ MARKETS ------------------------------ */
/** Every market the wallet prices, from Home's watchlist: all, the ones up, the ones down. */
export function Markets({ store }: { store: WalletStore }) {
  const t = store.t;
  const panelId = useId();
  const tab: MarketTab = store.selectedAsset.startsWith('mkt:') ? (store.selectedAsset.slice(4) as MarketTab) : 'all';
  let list = MARKET_TOKENS.slice();
  if (tab === 'gainers') list = list.filter((c) => (store.prices[c]?.change24h ?? 0) >= 0);
  if (tab === 'losers') list = list.filter((c) => (store.prices[c]?.change24h ?? 0) < 0);

  return (
    <div className="scr screen pb-110">
      <ScreenHeader title={t('markets.title')} onBack={store.goBack} right={store.loading ? <Spinner size={16} tone="text" /> : undefined} />
      <Tabs
        tabs={[
          { key: 'all', label: t('markets.all') },
          { key: 'gainers', label: t('markets.gainers') },
          { key: 'losers', label: t('markets.losers') },
        ]}
        value={tab}
        onChange={(k) => store.setSelectedAsset('mkt:' + k)}
        label={t('markets.title')}
        panelId={panelId}
        className="market-tabs"
      />
      <div id={panelId} role="tabpanel" className="market-list">
        {list.map((code, i) => (
          <MarketRow
            key={code}
            code={code}
            price={store.prices[code]}
            index={i}
            onClick={() => {
              store.setSelectedAsset(code);
              store.setScreen('asset');
            }}
          />
        ))}
        {!Object.keys(store.prices).length && <p className="market-empty">{store.loading ? t('markets.loading') : t('markets.fail')}</p>}
      </div>
    </div>
  );
}
