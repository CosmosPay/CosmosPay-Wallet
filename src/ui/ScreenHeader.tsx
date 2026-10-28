import type { ReactNode } from 'react';
import { inkHandlers } from '@/lib/ink';
import { tNow } from '@/lib/i18n';
import { ArrowLeftIcon } from '@/ui/Icons';
import '@/styles/ui/screen-header.css';

/**
 * The redesign's screen header, from the Figma file: a bar with the way back on the LEFT
 * (and an optional control on the right), then the screen's title as its one `h1`, then a
 * muted line saying what the screen is for. Replaces `BackBar` (back on the right, small
 * title, description as a separate paragraph) screen by screen as each part is redesigned.
 *
 * `desc` takes nodes so a screen can put a link or an emphasis inside its sentence.
 */
export function ScreenHeader({
  title,
  desc,
  onBack,
  right,
}: {
  title: ReactNode;
  desc?: ReactNode;
  /** Absent on a screen there is no going back from (a terminal offer). */
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="screen-header">
      {(onBack || right) && (
        <div className="screen-header-bar">
          {onBack ? (
            <button
              type="button"
              className="screen-header-back ink"
              aria-label={tNow('a11y.back')}
              onClick={onBack}
              {...inkHandlers}
            >
              <ArrowLeftIcon className="screen-header-back-icon" />
            </button>
          ) : (
            <span />
          )}
          {right}
        </div>
      )}
      <h1 className="screen-header-title">{title}</h1>
      {desc && <p className="screen-header-desc">{desc}</p>}
    </header>
  );
}
