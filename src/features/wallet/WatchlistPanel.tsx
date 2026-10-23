import type { WalletStore } from '@/state/store';
import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { Icon } from '@/ui/Icon';
import { fmt, pct } from '@/lib/format';
import { MARKET_TOKENS } from '@/constants/markets';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/watchlist.css';

/** What the empty watchlist suggests starring first. */
const SUGGESTED = ['BTC', 'ETH', 'SOL', 'XLM'];

/**
 * The coins the user starred (`store.favorites`), with their live price and 24h move. A
 * star toggles a coin off in place; an empty list offers the four most-watched coins to
 * star in one tap rather than a dead end.
 */
export function WatchlistPanel({ store }: { store: WalletStore }) {
  const t = store.t;
  const watched = store.favorites.filter((c) => MARKET_TOKENS.includes(c) || store.prices[c]);

  if (watched.length === 0) {
    return (
      <div className="watch-empty">
        <span className="watch-empty-icon">
          <Icon name="star" size={24} />
        </span>
        <div className="watch-empty-title">{t('watch.emptyTitle')}</div>
        <div className="desc">{t('watch.emptyDesc')}</div>
        <div className="watch-suggest">
          {SUGGESTED.map((code) => (
            <button key={code} type="button" onClick={() => store.toggleFavorite(code)} className="chip">
              <AssetLogo code={code} size={20} /> {code} <Icon name="plus" size={14} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {watched.map((code, i) => {
        const p = store.prices[code];
        const chg = p?.change24h ?? 0;
        return (
          <div key={code} className={cx('watch-row', staggerClass(i))}>
            <AssetLogo code={code} size={48} />
            <span className="watch-main">
              <span className="watch-name">{assetMeta(code).name}</span>
              <span className="watch-code">{code}</span>
            </span>
            <span className="watch-values">
              <span className="watch-price">{p ? `$ ${fmt(p.usd, p.usd >= 1 ? 2 : 4)}` : '—'}</span>
              {p && <span className={cx('watch-chg', chg >= 0 ? 't-up' : 't-down')}>{pct(chg)}</span>}
            </span>
            <button
              type="button"
              onClick={() => store.toggleFavorite(code)}
              aria-label={t('watch.unstar')}
              className="watch-star"
            >
              <Icon name="star" size={18} />
            </button>
          </div>
        );
      })}
      <div className="home-panel-foot">
        <button type="button" onClick={() => store.go('markets', 'markets')} className="home-link is-accent">
          <Icon name="plus" size={16} /> {t('watch.add')}
        </button>
      </div>
    </>
  );
}
