import { useId } from 'react';
import { CheckIcon, CopyIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import '@/styles/features/settings/export.css';

/** A revealed secret block: title + (seed grid | mono value box) + copy button.
 *  The copied colour flips via the `.is-copied` modifier class. */
export function Reveal({ title, value, mono, copied, onCopy, grid, copyLabel, copiedLabel }: { title: string; value: string; mono: boolean; copied: boolean; onCopy: () => void; grid?: boolean; copyLabel: string; copiedLabel: string }) {
  const titleId = useId();
  return (
    <section className="export-reveal" aria-labelledby={titleId}>
      <h2 id={titleId} className="export-reveal-title">{title}</h2>
      {grid ? (
        <ol className="export-word-grid">
          {value.split(' ').map((w, i) => (
            <li key={i} className="export-word">
              <span className="export-word-num" aria-hidden="true">{i + 1}</span>
              <span className="export-word-text">{w}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={cx('export-value-box', mono && 'export-mono')}>{value}</div>
      )}
      <button type="button" onClick={onCopy} className={cx('export-copy-btn', copied && 'is-copied')} aria-label={`${copied ? copiedLabel : copyLabel}: ${title}`}>
        {copied ? <CheckIcon /> : <CopyIcon />}{copied ? copiedLabel : copyLabel}
      </button>
      <span className="sr-only" role="status">{copied ? copiedLabel : ''}</span>
    </section>
  );
}
