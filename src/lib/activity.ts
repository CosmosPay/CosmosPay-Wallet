/**
 * The activity list in days, as the Figma groups it ("Today", "10 Oct, 2026"). Pure, so the
 * grouping and the day labels are testable without a store.
 */

/** A day's items, in the order they came. `day` is the local calendar day, `YYYY-MM-DD`. */
export interface ActivityDay<T> {
  day: string;
  items: T[];
}

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function localDay(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Items (newest first, as Horizon lists them) in runs of one local day each. */
export function groupByDay<T extends { createdAt: string }>(items: readonly T[]): ActivityDay<T>[] {
  const days: ActivityDay<T>[] = [];
  for (const item of items) {
    const day = localDay(new Date(item.createdAt));
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

/** "today", "yesterday", or null for any other day (the caller formats the date). */
export function relativeDay(day: string, now: Date): 'today' | 'yesterday' | null {
  if (day === localDay(now)) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return day === localDay(y) ? 'yesterday' : null;
}
