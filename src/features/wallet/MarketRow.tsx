import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { fmt, pct } from '@/lib/format';
import type { PriceInfo } from '@/lib/stellar';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/markets.css';

/** One market: logo, name over code, and the animated price over its 24h change. A button. */
export function MarketRow({ code, price, onClick, index = 0 }: { code: string; price?: PriceInfo; onClick: () => void; index?: number }) {
  const m = assetMeta(code);
  const chg = price?.change24h ?? 0;
  const shownPrice = useAnimatedNumber(price?.usd ?? 0);
  const shownChg = useAnimatedNumber(chg);
  return (
    <button type="button" onClick={onClick} className={cx('market-row', staggerClass(index))}>
      <AssetLogo code={code} size={38} />
      <span className="market-main">
        <span className="market-name">{m.name}</span>
        <span className="market-code">{code}</span>
      </span>
      <span className="market-right">
        <span className="market-price">{price ? '$' + fmt(shownPrice, price.usd >= 1 ? 2 : 4) : '—'}</span>
        <span className={cx('market-chg', chg >= 0 ? 'is-up' : 'is-down')}>{price ? pct(shownChg) : ''}</span>
      </span>
    </button>
  );
}
