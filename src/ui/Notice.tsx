import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { InfoIcon, WarningIcon } from '@/ui/Icons';
import '@/styles/ui/notice.css';

export type NoticeTone = 'info' | 'danger';

/**
 * A condition the person should read before acting, as a component rather than a loose
 * paragraph: a mark, then the text. `info` is a plain fact ("the key stays on this
 * device"); `danger` is what can cost them the wallet. Content can carry its own controls
 * (a checkbox to acknowledge, a button to act).
 */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('notice', `is-${tone}`, className)}>
      {tone === 'danger' ? <WarningIcon className="notice-icon" /> : <InfoIcon className="notice-icon" />}
      <div className="notice-body">{children}</div>
    </div>
  );
}
