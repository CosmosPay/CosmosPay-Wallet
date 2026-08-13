import { AssetLogo, assetMeta } from '@/components/parts';
import { fmt, pct } from '@/lib/format';
import type { PriceInfo } from '@/lib/stellar';
import { useAnimatedNumber } from '@/components/screens/main/shared';
import { staggerClass } from '@/constants/parts';
import '@/styles/screens/main/markets.css';

/** One market list row: logo + name/code and animated price + 24h change.
 *  Every variant is a modifier class; `index` picks the entrance-delay rung. */
export function MarketRow({ code, price, onClick, index = 0 }: { code: string; price?: PriceInfo; onClick: () => void; index?: number }) {
  const m = assetMeta(code);
  const chg = price?.change24h ?? 0;
  const shownPrice = useAnimatedNumber(price?.usd ?? 0);
  const shownChg = useAnimatedNumber(chg);
  return (
    <div onClick={onClick} className={`tap row between market-row ${staggerClass(index)}`}>
      <div className="row g12">
        <AssetLogo code={code} size={38} />
        <div className="col g2">
          <span className="market-name">{m.name}</span>
          <span className="t-dim-12">{code}</span>
        </div>
      </div>
      <div className="col g2 market-right">
        <span className="market-price">
          {price ? '$' + fmt(shownPrice, price.usd >= 1 ? 2 : 4) : '—'}
        </span>
        <span className={chg >= 0 ? 'market-chg is-up' : 'market-chg is-down'}>{price ? pct(shownChg) : ''}</span>
      </div>
    </div>
  );
}
