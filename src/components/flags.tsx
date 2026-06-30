/**
 * Language flags as inline SVG (country-flag-icons) — flag emoji don't render on
 * Windows/Chrome, so we use real SVGs. Per request: Spanish→Argentina,
 * English→USA, Portuguese→Brazil.
 */
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
  return (
    <Flag
      style={{ width: `${size}px`, height: 'auto', borderRadius: '3px', display: 'block', flexShrink: 0, boxShadow: '0 0 0 1px rgba(255,255,255,.12)' }}
    />
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
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: C.cardSolid,
          color: C.ink,
          border: `1px solid ${C.cardBorder}`,
          padding: '7px 12px 7px 9px',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        <LangFlag code={current.code} size={20} />
        <span>{current.name}</span>
        <span
          style={{
            fontSize: '9px',
            opacity: 0.7,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .18s ease',
          }}
        >
          ▼
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            minWidth: '168px',
            padding: '6px',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(22px) saturate(150%)',
            WebkitBackdropFilter: 'blur(22px) saturate(150%)',
            border: `1px solid ${C.cardBorder}`,
            borderRadius: '16px',
            boxShadow: '0 18px 50px rgba(0,0,0,.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            animation: 'fadeUp .16s ease',
          }}
        >
          {LANGUAGES.map((l) => {
            const on = l.code === value;
            return (
              <button
                key={l.code}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  background: on ? C.cardSolid : 'transparent',
                  color: C.ink,
                  border: 'none',
                  padding: '9px 12px',
                  fontSize: '13.5px',
                  fontWeight: on ? 800 : 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <LangFlag code={l.code} size={20} />
                <span style={{ flex: 1 }}>{l.name}</span>
                {on && <span style={{ fontSize: '12px' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
