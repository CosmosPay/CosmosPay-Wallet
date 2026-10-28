import type { ReactNode } from 'react';
import '@/styles/features/wallet/home.css';

/** One of Home's four actions (Figma: Send · Receive · Exchange · More): a ringed icon over its name. */
export function HomeAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="home-action">
      <span className="home-action-ring" aria-hidden="true">
        {children}
      </span>
      <span className="home-action-label">{label}</span>
    </button>
  );
}
