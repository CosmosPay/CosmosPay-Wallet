import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, AssetLogo, assetMeta, Spinner, NetworkDropdown, NavMenu, SurfaceToggle, EnableReceivingCard } from '@/components/parts';
import { HistoryRow, GenesisRow } from '@/components/screens/Money';
import { computePortfolio, type AssetRow } from '@/lib/portfolio';
import { fmt, splitMoney, trim, pct } from '@/lib/format';
import { getGreeting, ageFromBirthdate } from '@/lib/greeting';
import { changeColor, useAnimatedNumber } from './shared';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '6px 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
          <div onClick={() => store.go('profile', 'profile')} className="tap" style={{ width: '42px', height: '42px', borderRadius: '50%', overflow: 'hidden', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}>
            {store.meta?.avatar ? <img src={store.meta.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
          </div>
          {/* Sized to sit WITHIN the 42px avatar height — never taller, so the header
              structure holds even in the narrow extension popup. */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, height: '42px', gap: '2px' }}>
            <span style={{ fontSize: '11.5px', color: C.muted, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{greeting.salutation}</span>
            <span style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-.4px', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstName} 👋</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {/* Refresh is automatic (silent poll in the store); spinner only while loading. */}
          {store.loading && <Spinner size={15} color="var(--text)" />}
          <NetworkDropdown store={store} align="right" />
          {/* popup <-> sidebar toggle (preference persists across reopenings) */}
          <SurfaceToggle store={store} />
          <NavMenu store={store} />
        </div>
      </div>


      <div style={{ textAlign: 'center', padding: '8px 0 6px' }}>
        <div style={{ color: C.muted, fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
          {t('home.portfolio')}
        </div>
        <div style={{ fontSize: '46px', fontWeight: 800, letterSpacing: '-1.5px', fontVariantNumeric: 'tabular-nums' }}>
          {money.whole}<span style={{ color: C.dimmer }}>{money.cents}</span>
        </div>
        {/* 24h change of the WHOLE portfolio: percentage + USD difference vs yesterday
            (e.g. "↗ +1.00% · +$10.00"), green when up / red when down. */}
        <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '5px', color: changeColor(changePct), fontSize: '14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {changePct >= 0 ? '↗' : '↘'} {pct(shownPct)}
          <span style={{ fontWeight: 600, opacity: 0.85 }}>
            · {deltaUsd >= 0 ? '+' : '−'}${fmt(Math.abs(shownDelta), 2)}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', margin: '22px 0 26px' }}>
        <Action label={t('common.send')} onClick={() => store.setScreen('send')}>
          <path d="M12 4v13M6 10l6-6 6 6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Action>
        <Action label={t('common.receive')} onClick={() => store.setScreen('receive')}>
          <path d="M12 4v13M6 11l6 6 6-6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Action>
        {/* Central scanner: reads any Stellar QR (address / SEP-7 pay link) and
            auto-routes to the matching flow (prefilled Send, etc.). */}
        <Action label={t('scan.short')} onClick={() => store.setScreen('scan')}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <path d="M14 14h3v3M21 14v.01M21 21v-4M14 21h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </Action>
        <Action label={t('home.swap')} onClick={() => store.setScreen('swap')}>
          <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Action>
        <Action label={t('home.more')} onClick={() => store.setScreen('operations')}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </Action>
      </div>

      {/* Fiat entry is age-gated: only shown to 18+ users (see fiatOk above). */}
      {fiatOk && (
        <div onClick={() => store.setScreen('fiat')} className="tap glass-soft" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderRadius: '16px', cursor: 'pointer', marginBottom: '14px' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--text)' }}><path d="M3 8h15l-3-3M21 16H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>{t('fiat.tab')}</div>
            <div style={{ fontSize: '12px', color: C.muted, fontWeight: 600 }}>{t('fiat.entryDesc')}</div>
          </div>
          <span style={{ color: C.dim, fontSize: '18px' }}>›</span>
        </div>
      )}

      {notActivated && <ActivateCard store={store} />}
      {!store.cosmosPay && !!store.meta?.email && <EnableReceivingCard store={store} />}

      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 2px 12px' }}>
          <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-.3px' }}>{t('home.assets')}</span>
          {rows.length > 5 && (
            <span onClick={() => setShowAllAssets((v) => !v)} className="tap" style={{ fontSize: '13px', color: C.muted, fontWeight: 700, cursor: 'pointer' }}>
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
        <div onClick={() => store.setScreen('add-asset')} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '16px', cursor: 'pointer', color: C.accent, marginTop: '2px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>+</div>
          <span style={{ fontSize: '14.5px', fontWeight: 800 }}>{t('addAsset.title')}</span>
        </div>
      </div>

      {/* Recent activity — markets has its own dedicated tab, so the home shows history here. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 6px' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-.4px' }}>{t('history.title')}</span>
        {store.history.length > 0 && (
          <span onClick={() => store.setScreen('history')} style={{ fontSize: '13px', color: C.muted, fontWeight: 700, cursor: 'pointer' }}>{t('home.viewAll')}</span>
        )}
      </div>
      {store.history.length === 0 && store.historyLoading ? (
        <div style={{ padding: '18px', textAlign: 'center' }}><Spinner color="var(--text)" /></div>
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

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: any }) {
  return (
    <div onClick={onClick} className="tap" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
      <div className="glass-soft" style={{ width: '58px', height: '58px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{children}</svg>
      </div>
      <span style={{ fontSize: '11.5px', color: C.muted, fontWeight: 600, textAlign: 'center', lineHeight: 1.25 }}>{label}</span>
    </div>
  );
}

function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = !!store.network.friendbot;
  return (
    <div className="glass card" style={{ marginBottom: '22px' }}>
      <div style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>{t('home.activate')}</div>
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '14px' }}>
        {t('home.activateDesc')}
        {testnet ? t('home.activateTestnet') : t('home.activateMainnet')}
      </div>
      {testnet ? (
        <button onClick={() => store.fund()} disabled={store.busy} style={{ width: '100%', height: '54px', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {store.busy ? <Spinner /> : t('home.getTestXlm')}
        </button>
      ) : (
        <button onClick={() => store.setScreen('receive')} style={{ width: '100%', height: '54px', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {t('home.viewAddress')}
        </button>
      )}
    </div>
  );
}

function AssetListRow({ row, chg, fav, onFav, onClick, delay = 0 }: { row: AssetRow; chg?: number; fav?: boolean; onFav?: () => void; onClick: () => void; delay?: number }) {
  const m = assetMeta(row.code);
  const shownValue = useAnimatedNumber(row.value ?? 0);
  const shownChg = useAnimatedNumber(chg ?? 0);
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '13px 12px', borderRadius: '16px', cursor: 'pointer', marginBottom: '2px', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <AssetLogo code={row.code} size={34} />
        <div className="col g2">
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span className="t-dim-12">{trim(row.amount, 4)} {row.code}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {row.value !== null ? '$' + fmt(shownValue, 2) : '—'}
          </span>
          {/* 24h price change of the asset — green up / red down */}
          {chg !== undefined && (
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: changeColor(chg), fontVariantNumeric: 'tabular-nums' }}>{pct(shownChg)}</span>
          )}
        </div>
        {onFav && (
          <span
            onClick={(e) => { e.stopPropagation(); onFav(); }}
            className="tap"
            title="Favorito"
            // generous 36px hit area — a tiny star is too fiddly to tap
            style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '23px', lineHeight: 1, color: fav ? '#f7c948' : C.dimmer, cursor: 'pointer', flexShrink: 0, marginRight: '-6px' }}
          >
            {fav ? '★' : '☆'}
          </span>
        )}
      </div>
    </div>
  );
}
