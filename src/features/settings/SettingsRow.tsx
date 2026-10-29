import { ChevronRightIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import '@/styles/features/settings/settings.css';

/** A row that opens something (export the phrase, change the password…): its name and a chevron. */
export function SettingsRow({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('settings-item', last && 'settings-item-last')}>
      <span className="settings-item-label">{label}</span>
      <ChevronRightIcon className="settings-row-chev" />
    </button>
  );
}
