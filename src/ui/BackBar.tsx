import type { ReactNode } from 'react';
import { Icon } from '@/ui/Icon';
import { tNow } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import '@/styles/ui/back-bar.css';

/**
 * A screen's header, as the Figma design draws one ("Conectar wallet"): a back arrow at the
 * top left, an optional action at the top right, and the screen's title set large under
 * them. `compact` keeps the title on the header row instead, for the few screens whose
 * content needs the height (the scanner, a full-bleed QR).
 */
export function BackBar({
  title,
  onBack,
  right,
  closeIcon = false,
  compact = false,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  closeIcon?: boolean;
  compact?: boolean;
}) {
  return (
    <header className={cx('backbar', compact && 'is-compact')}>
      <div className="back-bar-row">
        <button
          type="button"
          onClick={onBack}
          aria-label={tNow(closeIcon ? 'a11y.close' : 'a11y.back')}
          className={cx('back-bar-btn', closeIcon && 'is-close')}
        >
          <Icon name={closeIcon ? 'close' : 'back'} size={24} />
        </button>
        {compact && <span className="f1 back-bar-title is-inline">{title}</span>}
        {!compact && <span className="f1" />}
        {right}
      </div>
      {!compact && <h1 className="title-24 back-bar-title">{title}</h1>}
    </header>
  );
}
