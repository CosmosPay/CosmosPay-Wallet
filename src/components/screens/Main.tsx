import type { WalletStore } from '../store';
import { C, TokenAvatar, assetMeta, Spinner, Logo } from '../parts';
import { computePortfolio, type AssetRow } from '../../lib/portfolio';
import { fmt, splitMoney, trim, pct, shortAddr } from '../../lib/format';
import { NETWORKS, explorerAccountUrl, type PriceInfo } from '../../lib/stellar';
import { getGreeting } from '../../lib/greeting';

const MARKET_TOKENS = ['XLM', 'BTC', 'ETH', 'SOL', 'USDC', 'USDT'];

function changeColor(n: number) {
  // monochrome: up = text colour, down = muted grey (direction shown by the ↗/↘ arrow)
  return n >= 0 ? 'var(--up)' : 'var(--down)';
}

/* ------------------------------- HOME -------------------------------- */
export function Home({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total, rows, xlmChange } = computePortfolio(store.account, store.prices);
  const money = splitMoney(total);
  const notActivated = store.account && !store.account.exists;
  const greeting = getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', store.t);
  const initial = (store.meta?.name || 'C').slice(0, 1).toUpperCase();

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '19px', fontWeight: 800, letterSpacing: '-.4px' }}>
          <Logo size={24} />Cosmos Pay
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div onClick={() => store.refresh()} title="Actualizar" className="tap" style={{ width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            {store.loading ? <Spinner size={15} color="var(--text)" /> : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 11A8 8 0 1 0 18 16M20 5v6h-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
          <div onClick={() => store.go('profile', 'profile')} className="tap" style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}>
            {initial}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 700, margin: '0 2px 2px' }}>{greeting.line} 👋</div>

      <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: C.muted, fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
          {t('home.portfolio')} <span style={{ opacity: 0.6 }}>ⓘ</span>
        </div>
        <div style={{ fontSize: '46px', fontWeight: 800, letterSpacing: '-1.5px', fontVariantNumeric: 'tabular-nums' }}>
          {money.whole}<span style={{ color: C.dimmer }}>{money.cents}</span>
        </div>
        <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '5px', color: changeColor(xlmChange), fontSize: '14px', fontWeight: 700 }}>
          {xlmChange >= 0 ? '↗' : '↘'} {pct(xlmChange)} <span style={{ color: C.dim, fontWeight: 600 }}>· XLM 24h</span>
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
        <Action label={t('home.more')} onClick={() => store.setScreen('settings')}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </Action>
      </div>

      {notActivated && <ActivateCard store={store} />}

      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-.3px', margin: '6px 2px 12px' }}>{t('home.assets')}</div>
        {store.account?.exists && rows.length ? (
          rows.map((r, i) => <AssetListRow key={r.code} row={r} delay={i * 0.05} onClick={() => { store.setSelectedAsset(r.code); store.setScreen('asset'); }} />)
        ) : !notActivated ? (
          <div style={{ textAlign: 'center', color: C.dim, fontSize: '13px', fontWeight: 600, padding: '20px' }}>
            {store.loading ? t('home.loading') : t('home.noAssets')}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-.4px' }}>{t('home.markets')}</span>
        <span onClick={() => store.go('markets', 'markets')} style={{ fontSize: '13px', color: C.muted, fontWeight: 700, cursor: 'pointer' }}>{t('home.viewAll')}</span>
      </div>
      {MARKET_TOKENS.slice(0, 3).map((code, i) => (
        <MarketRow key={code} code={code} price={store.prices[code]} delay={i * 0.06} onClick={() => { store.setSelectedAsset(code); store.setScreen('asset'); }} />
      ))}
    </div>
  );
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: any }) {
  return (
    <div onClick={onClick} className="tap" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
      <div style={{ width: '58px', height: '58px', borderRadius: '20px', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{children}</svg>
      </div>
      <span style={{ fontSize: '11.5px', color: C.muted, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = store.network === 'testnet';
  return (
    <div style={{ ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '22px' }}>
      <div style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>{t('home.activate')}</div>
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '14px' }}>
        {t('home.activateDesc')}
        {testnet ? t('home.activateTestnet') : t('home.activateMainnet')}
      </div>
      {testnet ? (
        <button onClick={() => store.fund()} disabled={store.busy} style={{ width: '100%', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {store.busy ? <Spinner /> : t('home.getTestXlm')}
        </button>
      ) : (
        <button onClick={() => store.setScreen('receive')} style={{ width: '100%', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          {t('home.viewAddress')}
        </button>
      )}
    </div>
  );
}

function AssetListRow({ row, onClick, delay = 0 }: { row: AssetRow; onClick: () => void; delay?: number }) {
  const m = assetMeta(row.code);
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 12px', borderRadius: '16px', cursor: 'pointer', marginBottom: '2px', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <TokenAvatar glyph={m.glyph} color={m.color} size={34} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{trim(row.amount, 4)} {row.code}</span>
        </div>
      </div>
      <span style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {row.value !== null ? '$' + fmt(row.value, 2) : '—'}
      </span>
    </div>
  );
}

function MarketRow({ code, price, onClick, delay = 0 }: { code: string; price?: PriceInfo; onClick: () => void; delay?: number }) {
  const m = assetMeta(code);
  const chg = price?.change24h ?? 0;
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 2px', cursor: 'pointer', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <TokenAvatar glyph={m.glyph} color={m.color} size={38} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{m.name}</span>
          <span style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{code}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {price ? '$' + fmt(price.usd, price.usd >= 1 ? 2 : 4) : '—'}
        </span>
        <span style={{ fontSize: '12px', color: changeColor(chg), fontWeight: 700 }}>{price ? pct(chg) : ''}</span>
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
        <div style={{ width: '34px', height: '34px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: C.muted }}>?</div>
      </div>
      <div style={{ position: 'relative', borderRadius: '22px', background: 'linear-gradient(135deg, rgba(255,255,255,.12), rgba(18,18,18,.35))', ...C.glass, padding: '20px', overflow: 'hidden', marginBottom: '26px' }}>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '6px' }}>{t('earn.totalAssets')}</div>
        <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>${fmt(total, 2)}</div>
        <div style={{ marginTop: '14px', fontSize: '13px', color: C.muted, fontWeight: 600 }}>{t('earn.network')}</div>
        <div style={{ fontSize: '16px', color: C.accent, fontWeight: 800, marginTop: '2px' }}>{NETWORKS[store.network].label}</div>
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
        {store.loading && <Spinner size={16} color="var(--text)" />}
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
  const rows = [
    { icon: '◈', label: t('profile.accountDetails'), onClick: () => store.setScreen('settings') },
    { icon: '⚷', label: t('profile.exportKeys'), onClick: () => store.setScreen('export') },
    { icon: '⛁', label: t('profile.receiveAddr'), onClick: () => store.setScreen('receive') },
    { icon: '⚙', label: t('profile.settings'), onClick: () => store.setScreen('settings') },
    { icon: '?', label: t('profile.about'), onClick: () => store.flash(t('profile.aboutToast'), 'info') },
  ];
  const pub = store.meta?.publicKey ?? '';
  const name = store.meta?.name || 'Mi wallet';
  const g = getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', t);
  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 110px', animation: 'fadeUp .3s ease' }}>
      <div style={{ padding: '8px 0 22px' }}><span style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-.8px' }}>{t('tab.profile')}</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '26px' }}>
        <div style={{ width: '62px', height: '62px', borderRadius: '50%', background: 'var(--glass-soft-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800 }}>{name.slice(0, 1).toUpperCase()}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <span style={{ fontSize: '18px', fontWeight: 800 }}>{name}</span>
          <span style={{ fontSize: '13px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(pub, 8, 8)}</span>
          <span style={{ fontSize: '11.5px', color: C.accent, fontWeight: 700 }}>
            {NETWORKS[store.network].label}{g.age !== null ? ` · ${g.age} ${t('profile.years')}` : ''}
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
          <TokenAvatar glyph={m.glyph} color={m.color} size={24} />
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
          <button onClick={() => store.setScreen('send')} style={{ flex: 1, background: 'var(--primary-bg)', color: 'var(--primary-text)', border: 'none', borderRadius: '16px', padding: '16px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.send')}</button>
          <button onClick={() => store.setScreen('receive')} style={{ flex: 1, ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '16px', padding: '16px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.receive')}</button>
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
