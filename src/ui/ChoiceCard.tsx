import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { ChevronRightIcon } from '@/ui/Icons';
import '@/styles/ui/choice-card.css';

/**
 * One option of a "pick one and go" screen: an icon, a title, one line of what it means,
 * and a chevron saying it leads somewhere. The whole card is the button. Cards on the
 * same screen are equals — none is styled as the primary — because choosing between them
 * is the screen's whole job.
 */
export function ChoiceCard({
  icon,
  title,
  desc,
  onClick,
  disabled,
  className,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx('choice-card ink', className)}
      {...inkHandlers}
    >
      <span className="choice-card-icon">{icon}</span>
      <span className="choice-card-body">
        <span className="choice-card-title">{title}</span>
        <span className="choice-card-desc">{desc}</span>
      </span>
      <ChevronRightIcon className="choice-card-chev" />
    </button>
  );
}
