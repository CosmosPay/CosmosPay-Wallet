import '@/styles/screens/settings/settings.css';

/** Tappable settings list row with a chevron (Export phrase, Change password…). */
export function SettingsRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <div onClick={onClick} className={last ? 'tap glass row between settings-item settings-item-last' : 'tap glass row between settings-item'}>
      <span className="settings-item-label">{label}</span>
      <span className="settings-row-chev">›</span>
    </div>
  );
}
