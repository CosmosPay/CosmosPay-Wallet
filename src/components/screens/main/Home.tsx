import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { Spinner, NetworkDropdown, NavMenu, SurfaceToggle, EnableReceivingCard } from '@/components/parts';
import { HistoryRow, GenesisRow } from '@/components/screens/Money';
import { HomeAction } from '@/components/molecules/main/HomeAction';
import { AssetListRow } from '@/components/molecules/main/AssetListRow';
import { ActivateCard } from '@/components/organisms/main/ActivateCard';
import { computePortfolio } from '@/lib/portfolio';
import { fmt, splitMoney, pct } from '@/lib/format';
import { getGreeting, ageFromBirthdate } from '@/lib/greeting';
import { useAnimatedNumber } from './shared';
import '@/styles/screens/main/home.css';

// Stellar-ecosystem assets only (no BTC/ETH/SOL; USDT isn't native to Stellar).

/** Cap a name to `max` chars, cutting back to its last vowel so it reads naturally
 *  (e.g. "Wolfeschlegelstein" -> "Wolfeschlege"). Short names pass through intact. */
function shortName(name: string, max = 12): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const m = cut.match(/^.*[aeiouáéíóúàèìòùâêîôûäëïöü]/i);
  return m ? m[0] : cut;
}

/* ------------------------------- HOME -------------------------------- */
export function Home({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total, rows, changePct, deltaUsd } = computePortfolio(store.account, store.prices);
  // Every portfolio number eases towards its live value, so price fluctuations
  // visibly tick up/down instead of jumping (colors/arrows follow the real target).
  const money = splitMoney(useAnimatedNumber(total));
  const shownPct = useAnimatedNumber(changePct);
  const shownDelta = useAnimatedNumber(deltaUsd);
  const notActivated = store.account && !store.account.exists;
  // Load recent activity for the home preview (refreshes on wallet / network change).
  const loadHistory = store.loadHistory;
  useEffect(() => {
    loadHistory();
  }, [loadHistory, store.meta?.id, store.network.id]);
  // Memoized: getGreeting picks a random salutation — keep it stable across renders
  // (a fresh one only on app open / language change).
  const greeting = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', store.t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, store.t, store.meta?.gender],
  );
  const initial = (store.meta?.name || 'C').slice(0, 1).toUpperCase();
  // Header shows the name big: first word only, and if still too long it's cut at
  // its LAST VOWEL within the limit so the short form reads naturally.
  const firstName = shortName((store.meta?.name || 'astronauta').trim().split(/\s+/)[0]);
  // Fiat on/off-ramp is 18+ only (unknown/missing birthdate counts as not eligible).
  const fiatOk = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;
  // Assets list caps at 5 rows; starred favorites always float to the top so they
  // stay visible among those 5. "Ver todo" expands the full list inline.
  const [showAllAssets, setShowAllAssets] = useState(false);
  const favSet = new Set(store.favorites);
  const sortedRows = [...rows].sort((a, b) => (favSet.has(b.code) ? 1 : 0) - (favSet.has(a.code) ? 1 : 0));
  const visibleRows = showAllAssets ? sortedRows : sortedRows.slice(0, 5);

  return (
    <div className="scr screen pb-110">
      {/* Profile-first header: the avatar (→ profile) replaces the brand at the left,
          with the salutation small on top and the user's first name big below. */}
      <div className="home-head">
        <div className="home-head-left">
          <div onClick={() => store.go('profile', 'profile')} className="tap home-avatar">
            {store.meta?.avatar ? <img src={store.meta.avatar} alt="" className="home-avatar-img" /> : initial}
          </div>
          {/* Sized to sit WITHIN the 42px avatar height — never taller, so the header
              structure holds even in the narrow extension popup. */}
          <div className="home-greet-col">
            <span className="home-salutation">{greeting.salutation}</span>
            <span className="home-firstname">{firstName} 👋</span>
          </div>
        </div>
        <div className="row g10 shrink0">
          {/* Refresh is automatic (silent poll in the store); spinner only while loading. */}
          {store.loading && <Spinner size={15} color="var(--text)" />}
          <NetworkDropdown store={store} align="right" />
          {/* popup <-> sidebar toggle (preference persists across reopenings) */}
          <SurfaceToggle store={store} />
          <NavMenu store={store} />
        </div>
      </div>


      <div className="home-portfolio">
        <div className="home-portfolio-label">
          {t('home.portfolio')}
        </div>
        <div className="home-total">
          {money.whole}<span className="home-cents">{money.cents}</span>
        </div>
        {/* 24h change of the WHOLE portfolio: percentage + USD difference vs yesterday
            (e.g. "↗ +1.00% · +$10.00"), green when up / red when down. */}
        <div className={changePct >= 0 ? 'home-change is-up' : 'home-change is-down'}>
          {changePct >= 0 ? '↗' : '↘'} {pct(shownPct)}
          <span className="home-change-delta">
            · {deltaUsd >= 0 ? '+' : '−'}${fmt(Math.abs(shownDelta), 2)}
          </span>
        </div>
      </div>

      <div className="home-actions">
        <HomeAction label={t('common.send')} onClick={() => store.setScreen('send')}>
          <path d="M12 4v13M6 10l6-6 6 6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </HomeAction>
        <HomeAction label={t('common.receive')} onClick={() => store.setScreen('receive')}>
          <path d="M12 4v13M6 11l6 6 6-6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </HomeAction>
        {/* Central scanner: reads any Stellar QR (address / SEP-7 pay link) and
            auto-routes to the matching flow (prefilled Send, etc.). */}
        <HomeAction label={t('scan.short')} onClick={() => store.setScreen('scan')}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <path d="M14 14h3v3M21 14v.01M21 21v-4M14 21h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </HomeAction>
        <HomeAction label={t('home.swap')} onClick={() => store.setScreen('swap')}>
          <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </HomeAction>
        <HomeAction label={t('home.more')} onClick={() => store.setScreen('operations')}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </HomeAction>
      </div>

      {/* Fiat entry is age-gated: only shown to 18+ users (see fiatOk above). */}
      {fiatOk && (
        <div onClick={() => store.setScreen('fiat')} className="tap glass-soft home-fiat">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="home-fiat-icon"><path d="M3 8h15l-3-3M21 16H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="f1">
            <div className="home-fiat-title">{t('fiat.tab')}</div>
            <div className="home-fiat-desc">{t('fiat.entryDesc')}</div>
          </div>
          <span className="home-fiat-chev">›</span>
        </div>
      )}

      {notActivated && <ActivateCard store={store} />}
      {!store.cosmosPay && !!store.meta?.email && <EnableReceivingCard store={store} />}

      <div className="home-assets">
        <div className="row between home-assets-head">
          <span className="home-assets-title">{t('home.assets')}</span>
          {rows.length > 5 && (
            <span onClick={() => setShowAllAssets((v) => !v)} className="tap home-viewall">
              {showAllAssets ? t('home.showLess') : t('home.viewAll')}
            </span>
          )}
        </div>
        {visibleRows.map((r, i) => (
          <AssetListRow
            key={r.code}
            row={r}
            chg={store.prices[r.code]?.change24h}
            fav={store.favorites.includes(r.code)}
            onFav={() => store.toggleFavorite(r.code)}
            delay={i * 0.05}
            onClick={() => { store.setSelectedAsset(r.code); store.setScreen('asset'); }}
          />
        ))}
        <div onClick={() => store.setScreen('add-asset')} className="tap home-add-asset">
          <div className="home-add-icon">+</div>
          <span className="home-add-label">{t('addAsset.title')}</span>
        </div>
      </div>

      {/* Recent activity — markets has its own dedicated tab, so the home shows history here. */}
      <div className="row between home-history-head">
        <span className="title-20">{t('history.title')}</span>
        {store.history.length > 0 && (
          <span onClick={() => store.setScreen('history')} className="tap home-viewall">{t('home.viewAll')}</span>
        )}
      </div>
      {store.history.length === 0 && store.historyLoading ? (
        <div className="home-history-loading"><Spinner color="var(--text)" /></div>
      ) : (
        <>
          {store.history.slice(0, 5).map((it, i) => <HistoryRow key={it.id} item={it} store={store} delay={i * 0.05} />)}
          {/* The symbolic "started using Cosmos Pay" marker ALWAYS closes the list —
              even right after Friendbot funding adds the first real operation. */}
          <GenesisRow store={store} delay={Math.min(store.history.length, 5) * 0.05} />
        </>
      )}
    </div>
  );
}
