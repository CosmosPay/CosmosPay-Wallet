import { cx } from '@/lib/cx';
import { Spinner } from '@/ui/Spinner';
import '@/styles/ui/passkey-button.css';

/**
 * "Continue with your passkey" — the button that raises the browser's passkey sheet.
 *
 * In `ui/` because five screens across three features use it: unlocking, the signing gate,
 * revealing the phrase, choosing how a new wallet is protected, and restoring a backup.
 *
 * PRIMARY by default, unlike `DeviceAuthButton`: on a passkey device there is no password
 * to be the main path, so this IS the main path. `quiet` is for the screens where the
 * passkey is the shortcut beside something else.
 *
 * Never raised on mount by any screen. A sheet that appears without a tap is how a person
 * learns to touch the sensor before reading — see the note on `Unlock.tsx`.
 */
function PasskeyIcon() {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="4" {...common} />
      <path d="M3 20c0-3.3 2.7-6 6-6 1.2 0 2.3.3 3.2.9" {...common} />
      <circle cx="17.5" cy="12.5" r="2.5" {...common} />
      <path d="M17.5 15v5l1.5-1-1.5-1.2 1.5-1.1" {...common} />
    </svg>
  );
}

export function PasskeyButton({
  label,
  busy,
  disabled,
  onClick,
  quiet,
  className,
}: {
  label: string;
  /** A sheet is up or the work behind it is running: spinner, and no second tap. */
  busy?: boolean;
  /** Not ready to ask yet (a required field is empty): no spinner, just no tap. */
  disabled?: boolean;
  onClick: () => void;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cx(quiet ? 'glass-soft passkey-btn--quiet' : 'btn-primary', 'row center g10 passkey-btn', className)}
    >
      {busy ? <Spinner /> : <PasskeyIcon />}
      <span className="passkey-btn-label">{label}</span>
    </button>
  );
}
