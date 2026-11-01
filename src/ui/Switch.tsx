import { cx } from '@/lib/cx';
import '@/styles/ui/switch.css';

/**
 * On or off, as a real `role="switch"`: a line track, and on, an ink track with the canvas knob.
 * Named by the row it sits in (`labelledBy`) or by its own `label`.
 */
export function Switch({
  on,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('switch', on && 'is-on')}
    >
      <span className="switch-knob" />
    </button>
  );
}
