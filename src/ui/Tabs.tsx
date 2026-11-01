import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/tabs.css';

/**
 * Tabs under a line, as the Figma's Home draws them (Assets · Activity · Performance ·
 * Watchlist): each tab sits on the line, the chosen one on a stretch of brand blue — the active
 * indicator, the one place the blue goes. Its label is ink: blue type on the dark canvas falls
 * short of AA at this size.
 *
 * A WAI-ARIA tablist: the arrows, Home and End move between tabs and choose as they go, and
 * only the chosen tab is in the tab order. The panel is the caller's, labelled by `panelId`.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  panelId,
  className,
}: {
  tabs: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  /** The tablist's accessible name. */
  label: string;
  /** The id of the panel these tabs control. */
  panelId?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, tabs.findIndex((tb) => tb.key === value));

  const move = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
      : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx('tabs', className)} onKeyDown={move}>
      {tabs.map((tb, i) => {
        const on = i === at;
        return (
          <button
            key={tb.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tb.key)}
            className={cx('tabs-tab', on && 'is-on')}
          >
            {tb.label}
          </button>
        );
      })}
    </div>
  );
}
