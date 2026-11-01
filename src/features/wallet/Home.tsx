import { useEffect, useId, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { SurfaceToggle } from '@/features/wallet/SurfaceToggle';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { Spinner } from '@/ui/Spinner';
import { Tabs } from '@/ui/Tabs';
import { AssetLogo, NetworkLogo, assetMeta } from '@/ui/AssetLogo';
import {
  ChevronRightIcon,
  CosmosMark,
  DotsIcon,
  ExchangeIcon,
  GearIcon,
  PlusIcon,
  ReceiveIcon,
  SendIcon,
  StarIcon,
  TrendDownIcon,
  TrendUpIcon,
} from '@/ui/Icons';
import { ActivityList } from '@/features/money/ActivityList';
import { HomeAction } from '@/features/wallet/HomeAction';
import { AssetListRow } from '@/features/wallet/AssetListRow';
import { HomeNetworkButton } from '@/features/wallet/HomeNetworkButton';
import { HomeNotifications } from '@/features/wallet/HomeNotifications';
import { AssetToolbar } from '@/features/wallet/AssetToolbar';
import { ProtectAccountCard } from '@/features/wallet/ProtectAccountCard';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import { useKeptState } from '@/hooks/useKeptState';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { chainRows, networkRows, computePortfolio, intentsPriceOf, rowKey, type AssetRow } from '@/lib/portfolio';
import { fmt, splitMoney, pct } from '@/lib/format';
import { getGreeting } from '@/lib/greeting';
import { buildKind } from '@/lib/platform';
import { cx } from '@/lib/cx';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { MARKET_TOKENS } from '@/constants/markets';
import { HOME_ACTIVITY_ROWS, HOME_TABS, type HomeTab, type NetworkFilter } from '@/constants/home';
import { listedRows, networkOfRow, networkSummaries, rowMatches } from '@/lib/assetList';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import '@/styles/features/wallet/home.css';

/** Cap a name to `max` chars, cutting back to its last vowel so it reads naturally
 *  (e.g. "Wolfeschlegelstein" -> "Wolfeschlege"). Short names pass through intact. */
function shortName(name: string, max = 12): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const m = cut.match(/^.*[aeiouáéíóúàèìòùâêîôûäëïöü]/i);
  return m ? m[0] : cut;
}

const networkOf = networkOfRow;

/* ------------------------------- HOME -------------------------------- */
/**
 * The Figma's Home ("Cosmos Wallet", 1:2): who you are, what you hold across every network,
 * four actions, and four tabs — the holdings (filtered by network), the activity in days, how
 * the portfolio splits and moved, and the watchlist.
 */
export function Home({ store }: { store: WalletStore }) {
  const t = store.t;
  // Stellar balances and the same phrase's other networks are one list and one total.
  // Added tokens are read with each network's own, and priced by NEAR Intents when no feed does.
  const priceOf = useMemo(() => intentsPriceOf(store.intentsAssets), [store.intentsAssets]);
  const extra = [
    ...chainRows(store.chainHoldings, store.chainNet, store.prices),
    // Added tokens are main-network contracts: read and listed on the main networks only.
    ...networkRows(store.networkHoldings, store.prices, { tracked: store.chainNet === 'mainnet' ? store.trackedTokens : undefined, priceOf }),
  ];
  const { total, rows, changePct, deltaUsd } = computePortfolio(store.account, store.prices, store.network.id, extra);
  // Every portfolio number eases towards its live value (colours and arrows follow the target).
  const money = splitMoney(useAnimatedNumber(total));
  const shownPct = useAnimatedNumber(changePct);
  const shownDelta = useAnimatedNumber(deltaUsd);
  const notActivated = store.account && !store.account.exists;
  // Offered only when both recovery servers answer — see `recoveryReachable`.
  const recoveryUp = useRecoveryReachable(store.network) === true;

  const [tab, setTab] = useKeptState<HomeTab>(KEPT_INPUT.homeTab, 'assets');
  const [filter, setFilter] = useKeptState<NetworkFilter>(KEPT_INPUT.homeNetwork, 'all');
  const panelId = useId();

  const { loadHistory, ensureChainAddresses, loadIntentsAssets } = store;
  useEffect(() => {
    void loadIntentsAssets();
  }, [loadIntentsAssets]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory, store.meta?.id, store.network.id]);
  // Solana and Monad come from the same phrase; their addresses are derived once.
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses, store.meta?.id]);

  // Memoized: the salutation is picked at random — stable across renders.
  const greeting = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', store.t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, store.t, store.meta?.gender],
  );
  const firstName = shortName((store.meta?.name || 'astronauta').trim().split(/\s+/)[0]);

  // What is held, as it is (lib/assetList.ts): Stellar's rows and, elsewhere, balances above zero.
  // The filter offers every network the wallet has an address on, on Stellar's test network as
  // much as on its main one, each with what it holds or why it is empty.
  const listed = listedRows(rows);
  const offered = NETWORK_IDS.filter((n) => !!store.addressOn(n));
  const known = (n: NetworkId) =>
    n === 'stellar' ? !!store.account : n === 'solana' || n === 'monad' ? !!store.chainHoldings?.[n] : !!store.networkHoldings?.[n];
  const summaries = networkSummaries(listed, offered, known);
  // A network kept from another session that is not offered now reads as all of them.
  const active: NetworkFilter = filter === 'all' || offered.includes(filter) ? filter : 'all';
  const [query, setQuery] = useState('');
  // Each network named in the wallet's mode (store.networkName): on a test network, its test name.
  const networkName = store.networkName;
  const shown = listed.filter(
    (r) =>
      (active === 'all' || networkOf(r) === active) &&
      rowMatches(query, [assetMeta(r.code).name, r.code, networkName(networkOf(r)), NETWORKS[networkOf(r)].name]),
  );
  const activeSummary = active === 'all' ? null : summaries.find((x) => x.id === active) ?? null;

  const openRow = (r: AssetRow) => {
    const { chain, asset } = r;
    if (r.network) {
      // No details screen for these networks yet: their address and QR, where more arrives.
      store.setReceiveNet(r.network);
      store.setScreen('receive');
    } else if (chain && asset) {
      store.setChainAsset({ chain, asset });
      store.setScreen('chain-asset');
    } else {
      store.setSelectedAsset(r.code);
      store.setScreen('asset');
    }
  };

  return (
    <div className="scr screen pb-110 home">
      <header className="home-head">
        <button type="button" onClick={() => store.go('profile', 'profile')} className="home-who">
          <span className="home-avatar" aria-hidden="true">
            {store.meta?.avatar ? <img src={store.meta.avatar} alt="" className="home-avatar-img" /> : <CosmosMark className="home-avatar-mark" />}
          </span>
          <span className="home-who-text">
            <span className="home-salutation">{greeting.salutation}</span>
            <span className="home-name">
              {firstName}
              <ChevronRightIcon className="home-name-chev" />
            </span>
          </span>
        </button>
        <div className="home-head-end">
          {store.loading && <Spinner size={15} tone="text" />}
          {/* The network, always, and the notifications, beside the settings (the user's call;
              the bell is the Figma's). */}
          <HomeNetworkButton store={store} />
          <HomeNotifications store={store} />
          {buildKind() === 'ext' ? (
            <>
              {/* popup ⇄ side panel, the extension's own choice of surface */}
              <SurfaceToggle store={store} />
              <NavMenu store={store} />
            </>
          ) : (
            <button type="button" onClick={() => store.setScreen('settings')} className="home-icon-btn" aria-label={t('profile.settings')}>
              <GearIcon />
            </button>
          )}
        </div>
      </header>

      {/* Two columns on a PC window (home.css): what you have and what you can do on the
          left, the lists on the right. On a phone both wrappers are `display: contents`. */}
      <div className="home-summary">
        <section className="home-balance" aria-label={t('home.balance')}>
          <p className="home-balance-label">{t('home.balance')}</p>
          <p className="home-total">
            {money.whole}
            <span className="home-cents">{money.cents}</span>
          </p>
          <p className={cx('home-change', changePct >= 0 ? 'is-up' : 'is-down')}>
            {changePct >= 0 ? <TrendUpIcon className="home-change-icon" /> : <TrendDownIcon className="home-change-icon" />}
            <span className="home-change-pct">{pct(shownPct)}</span>
            <span className="home-change-delta">
              {deltaUsd >= 0 ? '+' : '−'}${fmt(Math.abs(shownDelta), 2)} · {t('home.in24h')}
            </span>
          </p>
        </section>

        <nav className="home-actions" aria-label={t('home.actions')}>
          <HomeAction label={t('common.send')} onClick={() => store.setScreen('send')}>
            <SendIcon />
          </HomeAction>
          <HomeAction label={t('common.receive')} onClick={() => store.setScreen('receive')}>
            <ReceiveIcon />
          </HomeAction>
          <HomeAction label={t('home.swap')} onClick={() => store.setScreen('swap')}>
            <ExchangeIcon />
          </HomeAction>
          <HomeAction label={t('home.more')} onClick={() => store.setScreen('operations')}>
            <DotsIcon />
          </HomeAction>
        </nav>

        {/* Recovery can only go on a funded account. The card itself decides from the ledger. */}
        {!notActivated && recoveryUp && <ProtectAccountCard store={store} />}
        {!store.cosmosPay && !!store.meta?.email && <EnableReceivingCard store={store} />}
      </div>

      <div className="home-main">
        <Tabs
          tabs={HOME_TABS.map((k) => ({ key: k, label: t(`home.tab.${k}`) }))}
          value={tab}
          onChange={setTab}
          label={t('home.tabs')}
          panelId={panelId}
          className="home-tabs"
        />

        <div id={panelId} role="tabpanel" className="home-panel">
          {tab === 'assets' && (
            <>
              <AssetToolbar
                store={store}
                query={query}
                onQuery={setQuery}
                filter={active}
                onFilter={setFilter}
                summaries={summaries}
                total={total}
                networkName={networkName}
              />
              {shown.length > 0 && (
                <>
                  {/* The table's heading on a PC window (home.css); the rows say it all on a phone. */}
                  <div className="home-asset-head" aria-hidden="true">
                    <span className="home-asset-head-asset">{t('home.col.asset')}</span>
                    <span>{t('home.col.price')}</span>
                    <span>{t('home.in24h')}</span>
                    <span>{t('home.col.balance')}</span>
                    <span>{t('home.col.value')}</span>
                  </div>
                  <div className="home-asset-list">
                    {shown.map((r, i) => (
                      <AssetListRow
                        key={rowKey(r)}
                        row={r}
                        chg={store.prices[r.code]?.change24h}
                        network={networkName(networkOf(r))}
                        index={i}
                        onClick={() => openRow(r)}
                      />
                    ))}
                  </div>
                </>
              )}
              {shown.length === 0 && query.trim() !== '' && (
                <p className="home-asset-none">{t('home.noAssetMatch', { q: query.trim() })}</p>
              )}
              {/* A network with nothing on it: say so, and offer what makes it not empty. */}
              {shown.length === 0 && query.trim() === '' && activeSummary && (
                <div className="home-net-empty">
                  <NetworkLogo network={activeSummary.id} size={44} />
                  <p className="home-net-empty-text">
                    {t(activeSummary.status === 'unknown' ? 'home.netUnreadable' : 'home.netEmpty', { network: networkName(activeSummary.id) })}
                  </p>
                  <button
                    type="button"
                    className="home-net-empty-btn"
                    onClick={() => {
                      store.setReceiveNet(activeSummary.id);
                      store.setScreen('receive');
                    }}
                  >
                    <ReceiveIcon />
                    {t('home.receiveOn', { network: networkName(activeSummary.id) })}
                  </button>
                </div>
              )}
              {/* Any network's asset can be added now (features/extras/AddAsset.tsx). */}
              <button type="button" onClick={() => store.setScreen('add-asset')} className="home-add">
                <span className="home-add-ring" aria-hidden="true">
                  <PlusIcon />
                </span>
                {t('addAsset.title')}
              </button>
            </>
          )}

          {tab === 'activity' && (
            <>
              {store.history.length === 0 && store.historyLoading ? (
                <div className="home-panel-wait">
                  <Spinner tone="text" />
                </div>
              ) : (
                <ActivityList
                  store={store}
                  items={store.history.slice(0, HOME_ACTIVITY_ROWS)}
                  complete={store.history.length <= HOME_ACTIVITY_ROWS}
                />
              )}
              {store.history.length > HOME_ACTIVITY_ROWS && (
                <button type="button" onClick={() => store.setScreen('history')} className="link-btn home-more-link">
                  {t('home.allActivity')}
                </button>
              )}
            </>
          )}

          {tab === 'performance' && <Performance store={store} rows={rows} total={total} networkName={networkName} />}

          {tab === 'watchlist' && <Watchlist store={store} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- PERFORMANCE ---------------------------- */
/** A share of the whole as a line: the track in the line colour, the share in ink. An SVG,
 *  so the length is an attribute rather than a style. */
function ShareLine({ share }: { share: number }) {
  const w = Math.max(0, Math.min(100, share));
  return (
    <svg className="home-share-line" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true">
      <rect className="home-share-track" width="100" height="2" rx="1" />
      <rect className="home-share-fill" width={w} height="2" rx="1" />
    </svg>
  );
}

/**
 * How the portfolio splits — by network, then by holding — and how each holding moved in 24
 * hours. Everything here is computed from what Home already shows; nothing is fetched.
 */
function Performance({
  store,
  rows,
  total,
  networkName,
}: {
  store: WalletStore;
  rows: AssetRow[];
  total: number;
  networkName: (n: NetworkId) => string;
}) {
  const t = store.t;
  const byNetwork = NETWORK_IDS.map((n) => ({ n, value: rows.filter((r) => networkOf(r) === n).reduce((s, r) => s + (r.value ?? 0), 0) }))
    .filter((x) => x.value > 0 || x.n === 'stellar')
    .sort((a, b) => (a.n === 'stellar' ? -1 : b.n === 'stellar' ? 1 : b.value - a.value));
  const held = rows.filter((r) => (r.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <div className="home-perf">
      <h3 className="home-perf-title">{t('home.byNetwork')}</h3>
      {byNetwork.map(({ n, value }) => (
        <div key={n} className="home-perf-row">
          <NetworkLogo network={n} size={28} />
          <div className="home-perf-main">
            <div className="home-perf-line">
              <span className="home-perf-name">{networkName(n)}</span>
              <span className="home-perf-value">${fmt(value, 2)}</span>
            </div>
            <ShareLine share={share(value)} />
          </div>
          <span className="home-perf-pct">{fmt(share(value), 0)}%</span>
        </div>
      ))}

      <h3 className="home-perf-title">{t('home.byAsset')}</h3>
      {held.map((r) => {
        const chg = store.prices[r.code]?.change24h;
        return (
          <div key={rowKey(r)} className="home-perf-row">
            <AssetLogo code={r.code} size={28} />
            <div className="home-perf-main">
              <div className="home-perf-line">
                <span className="home-perf-name">{assetMeta(r.code).name}</span>
                <span className="home-perf-value">${fmt(r.value ?? 0, 2)}</span>
              </div>
              <ShareLine share={share(r.value ?? 0)} />
            </div>
            <span className={cx('home-perf-pct', chg !== undefined && (chg >= 0 ? 'is-up' : 'is-down'))}>
              {chg !== undefined ? pct(chg) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- WATCHLIST ----------------------------- */
/** The prices you follow: starred first, then the rest of the market list. The star toggles. */
function Watchlist({ store }: { store: WalletStore }) {
  const t = store.t;
  const fav = new Set(store.favorites);
  const codes = [...new Set([...store.favorites, ...MARKET_TOKENS])].sort((a, b) => Number(fav.has(b)) - Number(fav.has(a)));
  return (
    <div className="home-watch">
      {codes.map((code) => {
        const p = store.prices[code];
        const starred = fav.has(code);
        return (
          <div key={code} className="home-watch-row">
            <button
              type="button"
              onClick={() => {
                store.setSelectedAsset(code);
                store.setScreen('asset');
              }}
              className="home-watch-open"
            >
              <AssetLogo code={code} size={38} />
              <span className="home-watch-main">
                <span className="home-watch-name">{assetMeta(code).name}</span>
                <span className="home-watch-code">{code}</span>
              </span>
              <span className="home-watch-end">
                <span className="home-watch-price">{p ? '$' + fmt(p.usd, p.usd >= 1 ? 2 : 4) : '—'}</span>
                {p && <span className={cx('home-watch-chg', p.change24h >= 0 ? 'is-up' : 'is-down')}>{pct(p.change24h)}</span>}
              </span>
            </button>
            <button
              type="button"
              onClick={() => store.toggleFavorite(code)}
              aria-pressed={starred}
              aria-label={t(starred ? 'home.unwatch' : 'home.watch', { code })}
              className={cx('home-watch-star', starred && 'is-on')}
            >
              <StarIcon filled={starred} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={() => store.go('markets', 'home')} className="link-btn home-more-link">
        {t('home.allMarkets')}
      </button>
    </div>
  );
}
