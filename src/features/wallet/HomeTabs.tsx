import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetListRow } from '@/features/wallet/AssetListRow';
import { PerformancePanel } from '@/features/wallet/PerformancePanel';
import { WatchlistPanel } from '@/features/wallet/WatchlistPanel';
import { HistoryRow } from '@/features/money/HistoryRow';
import { GenesisRow } from '@/features/money/GenesisRow';
import { Icon } from '@/ui/Icon';
import { Spinner } from '@/ui/Spinner';
import { useSwipe } from '@/hooks/useSwipe';
import { groupByDay, dayLabel } from '@/lib/activity';
import { rowKey, type AssetRow } from '@/lib/portfolio';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/home-tabs.css';

type HomeTab = 'assets' | 'activity' | 'performance' | 'watchlist';
const TABS: HomeTab[] = ['assets', 'activity', 'performance', 'watchlist'];

/** How many asset rows Home lists before "View all"; the rest are one tap away. */
const ASSET_PREVIEW = 6;
/** How many operations the Activity panel previews; the full list is the History screen. */
const ACTIVITY_PREVIEW = 8;

/**
 * The four panels under the balance, as the design draws them: a row of tab labels over a
 * four-segment track whose active segment is Cosmic Blue, and the page dots at the foot.
 * Swiping the panel sideways moves between tabs, and the panel slides in from the side it
 * was swiped toward.
 */
export function HomeTabs({ store, rows }: { store: WalletStore; rows: AssetRow[] }) {
  const t = store.t;
  const [tab, setTab] = useState<HomeTab>('assets');
  const [dir, setDir] = useState<'left' | 'right'>('left');
  const [showAll, setShowAll] = useState(false);
  const idx = TABS.indexOf(tab);

  const go = (next: HomeTab) => {
    if (next === tab) return;
    setDir(TABS.indexOf(next) > idx ? 'left' : 'right');
    setTab(next);
  };
  const swipe = useSwipe(
    () => idx < TABS.length - 1 && go(TABS[idx + 1]),
    () => idx > 0 && go(TABS[idx - 1]),
  );

  // Activity is read when its panel opens and on every wallet / network change.
  const { loadHistory } = store;
  useEffect(() => {
    if (tab === 'activity') loadHistory();
  }, [tab, loadHistory, store.meta?.id, store.network.id]);

  const visibleRows = showAll ? rows : rows.slice(0, ASSET_PREVIEW);
  const days = useMemo(() => groupByDay(store.history.slice(0, ACTIVITY_PREVIEW)), [store.history]);

  const openRow = (r: AssetRow) => {
    const { chain, asset } = r;
    if (chain && asset) {
      store.setChainAsset({ chain, asset });
      store.setScreen('chain-asset');
    } else {
      store.setSelectedAsset(r.code);
      store.setScreen('asset');
    }
  };

  return (
    <section className="home-tabs">
      <div className="home-tabs-head" role="tablist" aria-label={t('home.tabs')}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => go(k)}
            className={cx('home-tab', tab === k && 'is-on')}
          >
            {t(`home.tab.${k}`)}
          </button>
        ))}
        <span className={cx('home-tabs-track-on', `is-tab-${idx}`)} aria-hidden="true" />
      </div>

      <div
        {...swipe}
        key={tab}
        role="tabpanel"
        className={cx('home-panel', dir === 'left' ? 'is-from-right' : 'is-from-left')}
      >
        {tab === 'assets' && (
          <>
            {visibleRows.map((r, i) => (
              <AssetListRow
                key={rowKey(r)}
                row={r}
                chg={store.prices[r.code]?.change24h}
                index={i}
                network={r.chain ? t(`chains.net.${store.chainNet}.${r.chain}`) : undefined}
                onClick={() => openRow(r)}
              />
            ))}
            <div className="home-panel-foot">
              {rows.length > ASSET_PREVIEW && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="home-link">
                  {showAll ? t('home.showLess') : t('home.viewAll')}
                </button>
              )}
              <button type="button" onClick={() => store.setScreen('add-asset')} className="home-link is-accent">
                <Icon name="plus" size={16} /> {t('addAsset.title')}
              </button>
            </div>
          </>
        )}

        {tab === 'activity' &&
          (store.history.length === 0 && store.historyLoading ? (
            <div className="home-panel-loading">
              <Spinner tone="dim" />
            </div>
          ) : (
            <>
              {days.map((day, d) => (
                <div key={day.date.getTime()} className="home-day">
                  <div className="money-day">
                    {day.relative ? t(`history.${day.relative}`) : dayLabel(day.date, store.locale)}
                  </div>
                  {day.items.map((it, i) => (
                    <HistoryRow key={it.id} item={it} store={store} index={d * 2 + i} />
                  ))}
                </div>
              ))}
              {store.history.length <= ACTIVITY_PREVIEW && <GenesisRow store={store} index={store.history.length} />}
              {store.history.length > 0 && (
                <div className="home-panel-foot">
                  <button type="button" onClick={() => store.setScreen('history')} className="home-link is-accent">
                    {t('home.viewAll')} <Icon name="chevron-right" size={18} />
                  </button>
                </div>
              )}
            </>
          ))}

        {tab === 'performance' && <PerformancePanel store={store} rows={rows} />}
        {tab === 'watchlist' && <WatchlistPanel store={store} />}
      </div>

      {/* The design's page dots: which of the four panels this is. */}
      <div className="home-dots" aria-hidden="true">
        {TABS.map((k) => (
          <span key={k} className={cx('home-dot', tab === k && 'is-on')} />
        ))}
      </div>
    </section>
  );
}
