/**
 * Activity, as the design lays it out: operations grouped under a day heading ("Today",
 * "10 Oct, 2026") with the time on each row. Pure, so the grouping rule is testable without
 * a store; the headings themselves are i18n keys resolved by the screen.
 */
import type { HistoryOp } from '@/lib/stellar';

export interface ActivityDay {
  /** `today` / `yesterday` for the two days that read better as words, else null. */
  relative: 'today' | 'yesterday' | null;
  /** Local midnight of the day, for formatting the heading. */
  date: Date;
  items: HistoryOp[];
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * `ops` (newest first, as Horizon returns them) grouped by LOCAL calendar day, newest day
 * first. An op whose timestamp does not parse is kept, under the day it can least mislead
 * about — the oldest — rather than dropped from a list someone reconciles against.
 */
export function groupByDay(ops: HistoryOp[], now: Date = new Date()): ActivityDay[] {
  const today = dayStart(now).getTime();
  const yesterday = today - 86_400_000;
  const days = new Map<number, ActivityDay>();
  for (const op of ops) {
    const at = new Date(op.createdAt);
    const key = Number.isNaN(at.getTime()) ? 0 : dayStart(at).getTime();
    let day = days.get(key);
    if (!day) {
      day = {
        relative: key === today ? 'today' : key === yesterday ? 'yesterday' : null,
        date: new Date(key),
        items: [],
      };
      days.set(key, day);
    }
    day.items.push(op);
  }
  return [...days.entries()].sort((a, b) => b[0] - a[0]).map(([, d]) => d);
}

/** `15:42` in the user's locale. */
export const timeOf = (iso: string, locale: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
};

/** `10 Oct, 2026` in the user's locale — the design's day heading. */
export const dayLabel = (date: Date, locale: string): string =>
  date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
