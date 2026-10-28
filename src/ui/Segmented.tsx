import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Keys that move the choice, as an offset from the chosen segment or an absolute place. */
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A segmented control: two or three equal answers to one question, one of them always
 * chosen. The chosen segment is a thumb that slides to its new place (--ease-in-out), so a
 * change reads as one move rather than two colours swapping.
 *
 * To assistive technology and the keyboard it is a radio group (the WAI-ARIA pattern): one
 * tab stop, the chosen segment; the arrows move the choice and Home/End jump to the ends.
 * `controls` names the element the choice fills, when there is one.
 *
 * The thumb's place is written as custom properties at runtime, the way src/lib/ink.ts
 * does — no `style` prop in JSX, and the paint itself stays in CSS.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  controls,
  className,
}: {
  /** The question, for assistive technology; on screen the heading above says it. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  controls?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    ref.current?.style.setProperty('--seg-count', String(options.length));
    ref.current?.style.setProperty('--seg-index', String(index));
  }, [index, options.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const step = STEP[event.key];
    const next =
      step !== undefined ? (index + step + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cx('segmented', className)} onKeyDown={onKeyDown}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={i === index}
          aria-controls={controls}
          tabIndex={i === index ? 0 : -1}
          className="segmented-option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
