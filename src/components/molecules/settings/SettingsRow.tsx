import { cx } from '@/lib/cx';
import '@/styles/screens/settings/settings.css';

/** Tappable settings list row with a chevron (Export phrase, Change password…). */
export function SettingsRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <div onClick={onClick} className={cx('tap glass row between settings-item', last && 'settings-item-last')}>
      <span className="settings-item-label">{label}</span>
      <span className="settings-row-chev">›</span>
    </div>
  );
}
