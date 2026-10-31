import type { ReactNode } from 'react';
import '@/styles/features/settings/settings.css';

/** A titled part of Settings: its name, then its rows between lines. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-label={title}>
      <h2 className="settings-section-title">{title}</h2>
      <div className="settings-list">{children}</div>
    </section>
  );
}
