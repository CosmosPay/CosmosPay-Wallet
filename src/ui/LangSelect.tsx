/**
 * Language flags as inline SVG (country-flag-icons) — flag emoji don't render on
 * Windows/Chrome, so we use real SVGs.
 *
 * The SVGs themselves live in src/ui/FlagIcon.tsx and are loaded lazily: ~112 KB
 * and this module is used by Welcome and Unlock, so they used to sit in the entry
 * chunk. The picker renders immediately; each flag fades in a tick later behind a
 * same-sized placeholder, so nothing reflows.
 */
import '@/styles/ui/flags.css';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { LANGUAGES, type Lang } from '@/lib/i18n';
import { cx } from '@/lib/cx';

const FlagIcon = lazy(() => import('@/ui/FlagIcon'));

/** One size — see FlagIcon. The placeholder carries the same class so nothing reflows. */
export function LangFlag({ code }: { code: Lang }) {
  return (
    <Suspense fallback={<span className="shrink0 flag-img" />}>
      <FlagIcon code={code} />
    </Suspense>
  );
}

/**
 * Compact language dropdown: a pill showing the active flag + name that opens a
 * menu of every language. Closes on outside-click or selection. Used at the
 * onboarding screen where a flat row of flags looked cramped.
 */
export function LangSelect({
  value,
  onChange,
}: {
  value: Lang;
  onChange: (l: Lang) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === value) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="flag-select">
      <button onClick={() => setOpen((o) => !o)} className="row g8 flag-select-btn">
        <LangFlag code={current.code} />
        <span>{current.name}</span>
        <span className={cx('flag-select-caret', open && 'is-open')}>▼</span>
      </button>
      {open && (
        <div className="col g2 flag-select-menu">
          {LANGUAGES.map((l) => {
            const on = l.code === value;
            return (
              <button
                key={l.code}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                }}
                className={cx('row g10 flag-select-opt', on && 'is-on')}
              >
                <LangFlag code={l.code} />
                <span className="f1">{l.name}</span>
                {on && <span className="flag-select-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
