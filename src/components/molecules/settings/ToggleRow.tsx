import '@/styles/screens/settings/settings.css';

/** Glass card with a label (+ optional description) and a pill switch on the right.
 *  The switch on/off look is driven by the `.is-on` modifier class. */
export function ToggleRow({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="glass row g12 settings-item">
      <div className="f1 min0">
        <div className="settings-item-label">{label}</div>
        {desc && <div className="settings-item-desc">{desc}</div>}
      </div>
      <div onClick={() => onChange(!on)} className={on ? 'tap settings-switch is-on' : 'tap settings-switch'}>
        <div className="settings-switch-knob" />
      </div>
    </div>
  );
}
