import type { ReactNode } from 'react';
import { ChevronRightIcon } from '@/ui/Icons';
import '@/styles/ui/list-row.css';

/**
 * One row of a list in the redesign: a ringed line icon, the name (and a line under it), and a
 * chevron — rows sit between lines, never in a grey box. A button; `end` replaces the chevron.
 */
export function ListRow({
  icon,
  title,
  desc,
  onClick,
  end,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
  end?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="list-row">
      {icon && (
        <span className="list-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {desc && <span className="list-row-desc">{desc}</span>}
      </span>
      {end ?? <ChevronRightIcon className="list-row-chev" />}
    </button>
  );
}
