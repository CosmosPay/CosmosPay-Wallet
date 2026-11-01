import type { WalletStore } from '@/state/store';
import type { HistoryOp } from '@/lib/stellar';
import { groupByDay, relativeDay } from '@/lib/activity';
import { HistoryRow } from '@/features/money/HistoryRow';
import { GenesisRow } from '@/features/money/GenesisRow';
import '@/styles/features/money/rows.css';

/**
 * Operations in days, newest first ("Hoy", "Ayer", then the date), closed by the day the
 * wallet started when the list reaches it (`complete`). Home's Activity tab and the History
 * screen show the same list.
 */
export function ActivityList({
  store,
  items,
  complete,
  dense = false,
}: {
  store: WalletStore;
  items: readonly HistoryOp[];
  /** The list is the whole history, so its first day is the wallet's first. */
  complete: boolean;
  dense?: boolean;
}) {
  const t = store.t;
  const now = new Date();
  const label = (day: string) => {
    const rel = relativeDay(day, now);
    if (rel) return t(`history.${rel}`);
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  let i = 0;
  return (
    <div className="activity-list">
      {groupByDay(items).map((g) => (
        <section key={g.day} className="activity-day" aria-label={label(g.day)}>
          <h3 className="activity-day-label">{label(g.day)}</h3>
          {g.items.map((it) => (
            <HistoryRow key={it.id} item={it} store={store} index={i++} dense={dense} />
          ))}
        </section>
      ))}
      {complete && <GenesisRow store={store} index={i} dense={dense} />}
    </div>
  );
}
