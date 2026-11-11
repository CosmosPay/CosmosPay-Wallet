import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import type { RampSide } from '@/constants/ramp';
import { currencyLabel, methodLabel, rampWalletNetwork, type RampMarket, type RampSession } from '@/lib/p2pRamp';
import { openExternal } from '@/lib/openExternal';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import { LinkIcon } from '@/ui/Icons';
import { CurrencyFlag } from '@/features/fiat/RampPickers';
import { NetworkLogo } from '@/ui/AssetLogo';
import '@/styles/features/fiat/ramp-orders.css';

/**
 * The orders this account opened on one side, newest first (the developer platform's sessions
 * table, as a list): what was paid and what it gives, the method, when; a tap opens its window
 * again, where the order goes on. The window, not this list, knows how an order ended.
 */
export function RampOrders({ store, side, market, rev }: { store: WalletStore; side: RampSide; market: RampMarket; rev: number }) {
  const t = store.t;
  const lang = store.lang;
  const { rampSessions } = store;
  // undefined while it loads, null when it could not be read.
  const [rows, setRows] = useState<RampSession[] | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    rampSessions(side)
      .then((list) => alive && setRows(list))
      .catch(() => alive && setRows(null));
    return () => {
      alive = false;
    };
  }, [rampSessions, side, rev]);

  if (!rows || rows.length === 0) return null;

  const num = (v: string, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? new Intl.NumberFormat(lang, { maximumFractionDigits: max }).format(n) : v;
  };
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const methodOf = (x: RampSession) => {
    const m = market.currencies.find((c) => c.id === x.currency)?.paymentMethods.find((p) => p.id === x.paymentMethod);
    return m ? methodLabel(m.name, x.currency) : x.paymentMethod;
  };

  return (
    <section className="ramp-orders" aria-labelledby="ramp-orders-title">
      <h2 id="ramp-orders-title" className="ramp-orders-title">
        {t('ramp.orders')}
      </h2>
      <ul className="ramp-orders-list">
        {rows.map((x, i) => {
          const net = rampWalletNetwork(x.chainId, store.chainNet);
          const paid = side === 'buy' ? `${num(x.amount, 2)} ${x.currency}` : `${num(x.amount, 6)} ${x.token}`;
          const out = x.estimatedAmountOut === null ? '' : side === 'buy' ? `≈ ${num(x.estimatedAmountOut, 6)} ${x.token}` : `≈ ${num(x.estimatedAmountOut, 2)} ${x.currency}`;
          return (
            <li key={x.id} className={staggerClass(i, true)}>
              <button
                type="button"
                className="ramp-order"
                onClick={() => void openExternal(x.widgetUrl)}
                aria-label={t('ramp.orderOpen', { order: `${paid} → ${out || x.token}` })}
              >
                <span className="ramp-order-mark" aria-hidden="true">
                  <CurrencyFlag id={x.currency} size="row" />
                  {net && (
                    <span className="ramp-order-net">
                      <NetworkLogo network={net} size={20} />
                    </span>
                  )}
                </span>
                <span className="ramp-order-text">
                  <span className="ramp-order-main">
                    {paid}
                    {out && <span className="ramp-order-arrow"> → </span>}
                    {out}
                  </span>
                  <span className="ramp-order-sub">
                    {[methodOf(x), currencyLabel(x.currency, lang), when(x.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <LinkIcon className={cx('ramp-order-go')} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
