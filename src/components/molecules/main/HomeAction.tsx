import type { ReactNode } from 'react';
import '@/styles/screens/main/home.css';

/** Home quick-action: round glass icon + label (Send / Receive / Scan / Swap / More). */
export function HomeAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <div onClick={onClick} className="tap home-action">
      <div className="glass-soft home-action-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{children}</svg>
      </div>
      <span className="home-action-label">{label}</span>
    </div>
  );
}
