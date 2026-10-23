import { Icon, type IconName } from '@/ui/Icon';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/home.css';

/** Home quick-action, as the design draws it: a dark disc with a 20px glyph and its label
 *  under it (Send / Receive / Exchange / More). `index` picks its entrance rung. */
export function HomeAction({ label, icon, onClick, index = 0 }: { label: string; icon: IconName; onClick: () => void; index?: number }) {
  return (
    <button type="button" onClick={onClick} className={cx('home-action', `home-action--${index}`)}>
      <span className="home-action-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="home-action-label">{label}</span>
    </button>
  );
}
