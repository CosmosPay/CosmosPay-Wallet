/**
 * Language flags as inline SVG (country-flag-icons) — flag emoji don't render on
 * Windows/Chrome, so we use real SVGs. Per request: Spanish→Argentina,
 * English→USA, Portuguese→Brazil.
 */
import '@/styles/components/flags.css';
import { useEffect, useRef, useState } from 'react';
import AR from 'country-flag-icons/react/3x2/AR';
import US from 'country-flag-icons/react/3x2/US';
import BR from 'country-flag-icons/react/3x2/BR';
import DE from 'country-flag-icons/react/3x2/DE';
import FR from 'country-flag-icons/react/3x2/FR';
import { LANGUAGES, type Lang } from '@/lib/i18n';
import { C } from '@/components/parts';

const MAP: Record<Lang, typeof AR> = { es: AR, en: US, pt: BR, de: DE, fr: FR };

export function LangFlag({ code, size = 22 }: { code: Lang; size?: number }) {
  const Flag = MAP[code];
  return <Flag className="shrink0 flag-img" style={{ width: `${size}px` }} />;
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
        <LangFlag code={current.code} size={20} />
        <span>{current.name}</span>
        <span
          className="flag-select-caret"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▼
        </span>
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
                className="row g10 flag-select-opt"
                style={{ background: on ? C.cardSolid : 'transparent', fontWeight: on ? 800 : 600 }}
              >
                <LangFlag code={l.code} size={20} />
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
