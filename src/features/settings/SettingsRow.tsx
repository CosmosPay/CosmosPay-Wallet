import { cx } from '@/lib/cx';
import { Icon } from '@/ui/Icon';
import '@/styles/features/settings/settings.css';

/** Tappable settings list row with a chevron (Export phrase, Change password…). */
export function SettingsRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <div onClick={onClick} className={cx('tap glass row between settings-item', last && 'settings-item-last')}>
      <span className="settings-item-label">{label}</span>
      <Icon name="chevron-right" size={20} className="settings-row-chev" />
    </div>
  );
}
