import { Suspense, lazy } from 'react';
import type { Lang } from '@/lib/i18n';
import '@/styles/ui/lang-flag.css';

/**
 * A language's flag, beside its name in every language selector (QuickPrefs, its sheet,
 * Settings). Spanish shows Argentina, English the USA, Portuguese Brazil — the markets the
 * wallet speaks to, as on snap.cosmospay.lat.
 *
 * The SVGs (src/ui/FlagIcon.tsx, ~112 KB of country-flag-icons) load lazily: Welcome and
 * Unlock paint first and must not carry them in the entry chunk. Until they arrive a
 * same-sized placeholder holds the place, so nothing reflows.
 */
const FlagIcon = lazy(() => import('@/ui/FlagIcon'));

export function LangFlag({ code }: { code: Lang }) {
  return (
    <span className="lang-flag" aria-hidden="true">
      <Suspense fallback={null}>
        <FlagIcon code={code} />
      </Suspense>
    </span>
  );
}
