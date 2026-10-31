import type { PointerEvent, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/features/onboarding/atoms.css';

/** The pointer handlers a draggable cell takes (`useWordDrag`) — and nothing else. */
export interface WordCellDrag {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

/** Numbered seed-word cell (Backup grid + Verify slots). State-driven looks come from
 *  modifier classes the caller passes via `className`. A cell the person can act on
 *  (`onClick`) is a button; a cell that only shows a word is not. `drop` marks a gap a
 *  dragged word can land in (`data-word-drop`); `drag` makes the cell's word draggable. */
export function WordCell({
  n,
  children,
  className,
  onClick,
  label,
  drop,
  drag,
}: {
  n: number;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Accessible name when the visible content is not the whole story (an empty slot). */
  label?: string;
  drop?: string;
  drag?: WordCellDrag;
}) {
  const content = (
    <>
      <span className="ob-word-num">{n}</span>
      <span className="ob-word-text">{children}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-word-drop={drop}
      className={cx('ob-word-cell', className)}
      {...drag}
    >
      {content}
    </button>
  ) : (
    <div data-word-drop={drop} className={cx('ob-word-cell', className)}>
      {content}
    </div>
  );
}
