/**
 * Rail lookups that resolve copy, so they cannot live in `constants/` — that folder is
 * data and may not import the translator at runtime (CLAUDE.md, "Constants live in
 * `constants/`"). The tables stay there; the two functions that read them are here.
 */
import { RAILS, RAIL_CCY } from '@/constants/fiat';
import { tNow } from '@/lib/i18n';

/**
 * Human label for a saved bank account's rail type. Null-safe, and falls back to the
 * upper-cased raw type rather than to an empty string: a rail the tables do not know
 * is still something the user should be able to read off the screen.
 */
export function railLabel(type?: string | null): string {
  if (!type) return '';
  const rail = RAILS.find((r) => r.type === type);
  return rail ? tNow(rail.labelKey) : type.replace(/_/g, ' ').toUpperCase();
}

/** ISO currency for a rail / payin method (used as the fiat amount suffix). */
export function railCurrency(rail?: string | null): string {
  return rail ? RAIL_CCY[rail] ?? '' : '';
}
