import type { ReactNode } from 'react';
import '@/styles/screens/settings/settings.css';

/** Labelled settings block: uppercase title + content. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-section">
      <div className="label-up settings-section-title">{title}</div>
      {children}
    </div>
  );
}
