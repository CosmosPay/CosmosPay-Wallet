/**
 * The actual flag SVGs.
 *
 * Split out of the old shared flags module because these five imports pull ~112 KB of
 * country-flag-icons, and they were reaching the entry chunk through Welcome and
 * Unlock — the two screens that must paint first. `LangSelect` now lazy-loads this
 * module, so the language picker's markup is there immediately and its artwork
 * arrives a tick later.
 */
import AR from 'country-flag-icons/react/3x2/AR';
import US from 'country-flag-icons/react/3x2/US';
import BR from 'country-flag-icons/react/3x2/BR';
import DE from 'country-flag-icons/react/3x2/DE';
import FR from 'country-flag-icons/react/3x2/FR';
import type { Lang } from '@/lib/i18n';

// Per request: Spanish→Argentina, English→USA, Portuguese→Brazil.
const MAP: Record<Lang, typeof AR> = { es: AR, en: US, pt: BR, de: DE, fr: FR };

/** One size, set by `.flag-img`. There was a `size?: 20 | 22` prop whose default
 *  nothing ever used: all three call sites passed 20. */
export default function FlagIcon({ code }: { code: Lang }) {
  const Flag = MAP[code];
  return <Flag className="shrink0 flag-img" />;
}
