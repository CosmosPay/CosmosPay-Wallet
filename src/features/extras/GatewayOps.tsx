import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import type { LiquidityOpRow, PayinRow, PayoutRow, SwapRow } from '@/lib/cosmospay';
import type { OpsDomain } from '@/lib/dataKeys';
import { BackBar } from '@/ui/BackBar';
import { Spinner } from '@/ui/Spinner';
import { useQueryValue } from '@/hooks/useQuery';
import { cx } from '@/lib/cx';
import { staggerClass } from '@/lib/stagger';
import { FIAT_DECIMALS, fromMinorUnits } from '@/lib/amount';
import { railCurrency, railLabel } from '@/lib/fiatRails';
import '@/styles/features/extras/gateway-ops.css';

/**
 * What the gateway did — swaps, fiat deposits, fiat withdrawals, liquidity moves.
 *
 * The gap this closes: every money flow in this wallet has been write-only. It creates
 * a swap, submits it, paints a success screen and forgets. Anything that resolves LATER
 * — a payin waiting on a bank transfer, a payout in compliance review, a swap the
 * network has not confirmed — simply disappeared, and the only place the user could
 * look was a block explorer that knows nothing about the fiat half of the transaction.
 *
 * Deliberately separate from `features/money/History.tsx`, which reads Horizon. That one
 * answers "what happened on the ledger"; this one answers "what did I ask CosmosPay to
 * do, and where has it got to". A pending payin has no ledger entry at all yet, which is
 * exactly when a user most wants to see it.
 */

type Tab = { id: OpsDomain; labelKey: string };

const TABS: Tab[] = [
  { id: 'swaps', labelKey: 'ops.tabSwaps' },
  { id: 'payins', labelKey: 'ops.tabDeposits' },
  { id: 'payouts', labelKey: 'ops.tabWithdrawals' },
  { id: 'liquidity', labelKey: 'ops.tabLiquidity' },
];

/**
 * A status the screen can colour. The gateway's own vocabulary passes through
 * untouched as the label; only the TONE is mapped, and an unrecognised status gets the
 * neutral tone rather than a guess. Statuses are English machine values, never copy —
 * branching on them is branching on API surface, which is the allowed kind.
 */
function toneOf(status?: string | null): 'ok' | 'bad' | 'wait' {
  const s = (status ?? '').toLowerCase();
  if (s.includes('fail') || s.includes('error') || s.includes('cancel') || s.includes('refus')) return 'bad';
  if (s.includes('complete') || s.includes('success') || s.includes('settled') || s.includes('paid')) return 'ok';
  return 'wait';
}

function Row({ index, title, sub, right, status }: { index: number; title: string; sub: string; right: string; status?: string | null }) {
  return (
    <div className={cx('row g8 gateway-ops-row', staggerClass(index))}>
      <div className="f1 min0 col">
        <span className="gateway-ops-title">{title}</span>
        <span className="gateway-ops-sub">{sub}</span>
      </div>
      <div className="col gateway-ops-right">
        <span className="gateway-ops-amount">{right}</span>
        {status && <span className={cx('gateway-ops-status', `is-${toneOf(status)}`)}>{status}</span>}
      </div>
    </div>
  );
}

export function GatewayOps({ store }: { store: WalletStore }) {
  const t = store.t;
  const [tab, setTab] = useState<OpsDomain>('swaps');
  const [loading, setLoading] = useState(false);

  const key = store.opsKeyFor(tab);
  const rows = useQueryValue<unknown[]>(key ?? '');

  // One fetch per tab, and the cache's TTL decides whether it is a network call at all.
  useEffect(() => {
    let live = true;
    setLoading(true);
    void store.loadOps(tab).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [tab, store]);

  const empty = !loading && (!rows || rows.length === 0);

  return (
    <div className="scr screen col">
      <BackBar title={t('ops.gatewayTitle')} onBack={store.goBack} />

      <div className="row g8 gateway-ops-tabs">
        {TABS.map((x) => (
          <button key={x.id} className={cx('gateway-ops-tab', tab === x.id && 'is-on')} onClick={() => setTab(x.id)}>
            {t(x.labelKey)}
          </button>
        ))}
      </div>

      {loading && !rows && (
        <div className="row g8 gateway-ops-loading">
          <Spinner tone="text" />
        </div>
      )}

      {empty && <div className="gateway-ops-empty">{t('ops.gatewayEmpty')}</div>}

      <div className="glass col gateway-ops-card">
        {tab === 'swaps' &&
          (rows as SwapRow[] | undefined)?.map((r, i) => (
            <Row
              key={r.id}
              index={i}
              title={`${r.sendAsset} → ${r.destAsset}`}
              sub={r.txHash ? `${r.txHash.slice(0, 10)}…` : r.id.slice(0, 10)}
              right={`${r.sendAmount} ${r.sendAsset}`}
              status={r.status}
            />
          ))}

        {tab === 'payins' &&
          (rows as PayinRow[] | undefined)?.map((r, i) => (
            <Row
              key={r.id}
              index={i}
              title={railLabel(r.paymentMethod) || t('ops.tabDeposits')}
              sub={r.token ?? ''}
              // Minor units, as BlindPay reports them — `fromMinorUnits` does the
              // string arithmetic so a cent never rounds through a float.
              // `fromMinorUnits` returns null for a non-integer, which is the one thing
              // a float amount could be — rendering '' beats rendering 'null'.
              right={
                r.senderAmount != null
                  ? `${fromMinorUnits(r.senderAmount, FIAT_DECIMALS) ?? ''} ${railCurrency(r.paymentMethod)}`.trim()
                  : ''
              }
              status={r.status}
            />
          ))}

        {tab === 'payouts' &&
          (rows as PayoutRow[] | undefined)?.map((r, i) => (
            <Row
              key={r.id}
              index={i}
              title={railLabel(r.rail) || t('ops.tabWithdrawals')}
              sub={r.token ?? ''}
              right={r.senderAmount ? `${r.senderAmount} ${r.token ?? ''}` : ''}
              status={r.status}
            />
          ))}

        {tab === 'liquidity' &&
          (rows as LiquidityOpRow[] | undefined)?.map((r, i) => (
            <Row
              key={r.id}
              index={i}
              title={`${r.assetA} / ${r.assetB}`}
              sub={r.kind}
              right={`${r.amountA} / ${r.amountB}`}
              status={r.status}
            />
          ))}
      </div>
    </div>
  );
}
