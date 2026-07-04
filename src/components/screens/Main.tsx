import { useEffect, useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, AssetLogo, TokenAvatar, assetMeta, Spinner, NetworkDropdown, NavMenu, SurfaceToggle, EnableReceivingCard } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { HistoryRow, GenesisRow } from '@/components/screens/Money';
import { computePortfolio, type AssetRow } from '@/lib/portfolio';
import { fmt, splitMoney, trim, pct, shortAddr } from '@/lib/format';
import { explorerAccountUrl, type PriceInfo } from '@/lib/stellar';
import { getGreeting, ageFromBirthdate } from '@/lib/greeting';
import { copyText } from '@/lib/clipboard';

/** Center-crop + downscale an image file to a small JPEG data URL for the avatar. */
function resizeToDataUrl(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = URL.createObjectURL(file);
  });
}

// Stellar-ecosystem assets only (no BTC/ETH/SOL; USDT isn't native to Stellar).
const MARKET_TOKENS = ['XLM', 'USDC', 'EURC'];

function changeColor(n: number) {
  // green up / red down (tokens --up/--down, theme-aware)
  return n >= 0 ? 'var(--up)' : 'var(--down)';
}

/** Smoothly animates towards `target` (ease-out cubic) so value changes visibly
 *  tick up/down instead of jumping — the auto-refresh makes this run every ~30s. */
function useAnimatedNumber(target: number, ms = 800): number {
  const [val, setVal] = useState(target);
  const valRef = useRef(target);
  useEffect(() => {
    const from = valRef.current;
    if (Math.abs(target - from) < 1e-9) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
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
  // Header shows the name big, capped to the first word.
  const firstName = (store.meta?.name || 'astronauta').trim().split(/\s+/)[0];
  // Fiat on/off-ramp is 18+ only (unknown/missing birthdate counts as not eligible).
  const fiatOk = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;
  // Assets list caps at 5 rows; starred favorites always float to the top so they
  // stay visible among those 5. "Ver todo" expands the full list inline.
  const [showAllAssets, setShowAllAssets] = useState(false);
  const favSet = new Set(store.favorites);
  const sortedRows = [...rows].sort((a, b) => (favSet.has(b.code) ? 1 : 0) - (favSet.has(a.code) ? 1 : 0));
  const visibleRows = showAllAssets ? sortedRows : sortedRows.slice(0, 5);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      {/* Profile-first header: the avatar (→ profile) replaces the brand at the left,
          with the salutation small on top and the user's first name big below. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '6px 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
          <div onClick={() => store.go('profile', 'profile')} className="tap" style={{ width: '42px', height: '42px', borderRadius: '50%', overflow: 'hidden', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}>
            {store.meta?.avatar ? <img src={store.meta.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: '12.5px', color: C.muted, fontWeight: 700 }}>{greeting.salutation}</span>
            <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstName} 👋</span>
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
        <Action label={t('home.swap')} onClick={() => store.setScreen('swap')}>
          <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Action>
        <Action label={t('home.more')} onClick={() => store.setScreen('operations')}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </Action>
      </div>

      {/* Fiat entry is age-gated: only shown to 18+ users (see fiatOk above). */}
      {fiatOk && (
        <div onClick={() => store.setScreen('fiat')} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderRadius: '16px', cursor: 'pointer', ...C.glassSoft, marginBottom: '14px' }}>
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
      {store.history.length === 0 ? (
        // No empty-state box: a fresh wallet shows the visual "started using Cosmos
        // Pay" marker instead (spinner only during the very first load).
        store.historyLoading ? (
          <div style={{ padding: '18px', textAlign: 'center' }}><Spinner color="var(--text)" /></div>
        ) : (
          <GenesisRow store={store} />
        )
      ) : (
        store.history.slice(0, 5).map((it, i) => <HistoryRow key={it.id} item={it} store={store} delay={i * 0.05} />)
      )}
    </div>
  );
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: any }) {
  return (
    <div onClick={onClick} className="tap" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
      <div style={{ width: '58px', height: '58px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{children}</svg>
      </div>
      <span style={{ fontSize: '11.5px', color: C.muted, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = !!store.network.friendbot;
  return (
    <div style={{ ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '22px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{trim(row.amount, 4)} {row.code}</span>
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
            style={{ fontSize: '17px', lineHeight: 1, color: fav ? '#f7c948' : C.dimmer, padding: '4px', cursor: 'pointer' }}
          >
            {fav ? '★' : '☆'}
          </span>
        )}
      </div>
    </div>
  );
}

function MarketRow({ code, price, onClick, delay = 0 }: { code: string; price?: PriceInfo; onClick: () => void; delay?: number }) {
  const m = assetMeta(code);
  const chg = price?.change24h ?? 0;
  const shownPrice = useAnimatedNumber(price?.usd ?? 0);
  const shownChg = useAnimatedNumber(chg);
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 2px', cursor: 'pointer', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <AssetLogo code={code} size={38} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{code}</span>
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

/* ------------------------------- EARN -------------------------------- */
export function Earn({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total } = computePortfolio(store.account, store.prices);
  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 18px' }}>
        <span style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-.8px' }}>{t('earn.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: C.muted }}>?</div>
          <NavMenu store={store} />
        </div>
      </div>
      <div style={{ position: 'relative', borderRadius: '22px', background: 'linear-gradient(135deg, rgba(255,255,255,.12), rgba(18,18,18,.35))', ...C.glass, padding: '20px', overflow: 'hidden', marginBottom: '26px' }}>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '6px' }}>{t('earn.totalAssets')}</div>
        <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>${fmt(total, 2)}</div>
        <div style={{ marginTop: '14px', fontSize: '13px', color: C.muted, fontWeight: 600 }}>{t('earn.network')}</div>
        <div style={{ fontSize: '16px', color: C.accent, fontWeight: 800, marginTop: '2px' }}>{store.network.label}</div>
      </div>

      <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-.4px', marginBottom: '14px' }}>{t('earn.generate')}</div>
      <div style={{ ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={36} />
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>Liquidity Pools (AMM)</div>
            <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{t('earn.lpSub')}</div>
          </div>
        </div>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
          {t('earn.lpDesc')}
        </div>
        <div style={{ display: 'inline-block', marginTop: '12px', fontSize: '12px', fontWeight: 800, color: 'var(--on-accent)', background: C.accent, padding: '5px 11px', borderRadius: '9px' }}>{t('earn.soon')}</div>
      </div>
      <div style={{ fontSize: '12.5px', color: C.dim, fontWeight: 600, lineHeight: 1.5, padding: '4px 4px' }}>
        {t('earn.note')}
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
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 18px' }}>
        <span style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-.8px' }}>{t('markets.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {store.loading && <Spinner size={16} color="var(--text)" />}
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

/* ------------------------------ PROFILE ------------------------------ */
export function Profile({ store }: { store: WalletStore }) {
  const t = store.t;
  // Cosmos Pay is an integration (swaps + BlindPay payments) — tap to manage keys/receiver.
  const cosmosPayRow = { icon: '◇', label: t('cosmospay.manage'), onClick: () => store.setScreen('cosmospay') };
  const rows = [
    ...(store.meta?.email ? [cosmosPayRow] : []),
    { icon: '⚷', label: t('profile.exportKeys'), onClick: () => store.setScreen('export') },
    { icon: '⛁', label: t('profile.receiveAddr'), onClick: () => store.setScreen('receive') },
    { icon: '⚙', label: t('profile.settings'), onClick: () => store.setScreen('settings') },
    { icon: '?', label: t('profile.about'), onClick: () => store.setScreen('about') },
  ];
  const pub = store.meta?.publicKey ?? '';
  const name = store.meta?.name || 'Mi wallet';
  const avatar = store.meta?.avatar;
  // Memoized: the salutation is random — keep it stable across re-renders.
  const g = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, t, store.meta?.gender],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const onFile = async (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        await store.setWalletAvatar(await resizeToDataUrl(f));
      } catch {
        /* ignore bad image */
      }
    }
    e.target.value = '';
  };
  const copyAddr = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 22px' }}>
        <span style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-.8px' }}>{t('tab.profile')}</span>
        {/* Profile is itself a menu destination, so a hamburger here is pointless —
            in the extension (no bottom bar) the top-right button goes back home. */}
        {buildKind() === 'ext' && (
          <div
            onClick={() => store.go('home', 'home')}
            className="tap"
            title={t('tab.home')}
            style={{ width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '26px' }}>
        <div onClick={() => fileRef.current?.click()} className="tap" title={t('profile.changePhoto')} style={{ position: 'relative', flexShrink: 0, width: '62px', height: '62px', borderRadius: '50%', background: 'var(--glass-soft-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800, cursor: 'pointer', overflow: 'visible' }}>
          {avatar ? (
            <img src={avatar} alt="" style={{ width: '62px', height: '62px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
          <div style={{ position: 'absolute', right: '-2px', bottom: '-2px', width: '22px', height: '22px', borderRadius: '50%', background: C.accent, color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="2" /></svg>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <span style={{ fontSize: '18px', fontWeight: 800 }}>{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ fontSize: '13px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(pub, 8, 8)}</span>
            <span onClick={copyAddr} className="tap" title={t('profile.copyAddress')} style={{ display: 'flex', color: copied ? C.accent : C.muted, cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.9" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            </span>
          </div>
          <span style={{ fontSize: '11.5px', color: C.accent, fontWeight: 700 }}>
            {store.network.label}{g.age !== null ? ` · ${g.age} ${t('profile.years')}` : ''}
          </span>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '.5px' }}>
        {t('profile.myWallets')} ({store.wallets.length})
      </div>
      <div style={{ ...C.glass, borderRadius: '18px', overflow: 'hidden', marginBottom: '20px' }}>
        {store.wallets.map((w) => {
          const active = w.id === store.meta?.id;
          return (
            <div key={w.id} onClick={() => !active && store.switchWallet(w.id)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: '1px solid var(--hairline)', cursor: active ? 'default' : 'pointer' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px' }}>{w.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14.5px', fontWeight: 700 }}>{w.name}</div>
                <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(w.publicKey, 6, 6)}</div>
              </div>
              {active ? (
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--on-accent)', background: C.accent, padding: '3px 10px', borderRadius: '999px' }}>{t('profile.active')}</span>
              ) : (
                <span style={{ color: C.muted, fontSize: '13px', fontWeight: 700 }}>{t('profile.switch')}</span>
              )}
            </div>
          );
        })}
        <div onClick={() => store.startAddWallet()} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', color: C.accent }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>+</div>
          <span style={{ fontSize: '14.5px', fontWeight: 800 }}>{t('profile.addWallet')}</span>
        </div>
      </div>

      <div style={{ ...C.glass, borderRadius: '18px', overflow: 'hidden', marginBottom: '20px' }}>
        {rows.map((r, i) => (
          <div key={i} onClick={r.onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 18px', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none', cursor: 'pointer' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '11px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>{r.icon}</div>
            <span style={{ flex: 1, fontSize: '15px', fontWeight: 700 }}>{r.label}</span>
            <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
          </div>
        ))}
      </div>
      <div onClick={() => store.lock()} className="tap" style={{ textAlign: 'center', color: C.danger, fontSize: '15px', fontWeight: 700, padding: '14px', cursor: 'pointer' }}>{t('profile.lock')}</div>
    </div>
  );
}

/* --------------------------- ASSET DETAIL ---------------------------- */
export function Asset({ store }: { store: WalletStore }) {
  const t = store.t;
  const code = store.selectedAsset || 'XLM';
  const m = assetMeta(code);
  const price = store.prices[code];
  const { rows } = computePortfolio(store.account, store.prices);
  const held = rows.find((r) => r.code === code);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 30px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0 18px' }}>
        <div onClick={() => store.go(store.tab, store.tab)} style={{ width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', cursor: 'pointer' }}>‹</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

      <div style={{ ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '6px' }}>{t('asset.balance')}</div>
        <div style={{ fontSize: '26px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{held ? trim(held.amount, 7) : '0'} {code}</div>
        <div style={{ fontSize: '13px', color: C.dim, fontWeight: 600, marginTop: '4px' }}>{held?.value != null ? '≈ $' + fmt(held.value, 2) : '—'}</div>
      </div>

      {code === 'XLM' && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <button onClick={() => store.setScreen('send')} style={{ flex: 1, height: '54px', background: 'var(--primary-bg)', color: 'var(--primary-text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.send')}</button>
          <button onClick={() => store.setScreen('receive')} style={{ flex: 1, height: '54px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.receive')}</button>
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
