import { useId } from 'react';
import { Switch } from '@/ui/Switch';
import '@/styles/features/settings/settings.css';

/** A setting that is on or off: its name (and why), and a switch — a real `role="switch"`. */
export function ToggleRow({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="settings-item is-static">
      <div className="settings-item-text">
        <span id={`${id}-label`} className="settings-item-label">
          {label}
        </span>
        {desc && (
          <span id={`${id}-desc`} className="settings-item-desc">
            {desc}
          </span>
        )}
      </div>
      <Switch on={on} onChange={onChange} labelledBy={`${id}-label`} describedBy={desc ? `${id}-desc` : undefined} />
    </div>
  );
}
