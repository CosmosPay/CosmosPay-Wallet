import { cx } from '@/lib/cx';
import { Spinner } from '@/ui/Spinner';
import type { DeviceAuthKind } from '@/lib/deviceAuth';
import '@/styles/ui/device-auth-button.css';

/**
 * "Unlock with your fingerprint" — the button that raises the phone's own check.
 *
 * In `ui/` rather than a feature folder because two features import it: the unlock
 * screen and the signing gate in `app/ConfirmSign.tsx`. The icon follows the
 * device's actual method, so a phone that will answer with a PIN pad does not show
 * a fingerprint.
 */

/** Glyph per method. Stroke-only, `currentColor`, so it inherits the button's tone. */
function DeviceAuthIcon({ kind }: { kind: DeviceAuthKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'face' || kind === 'iris') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" {...common} />
        <path d="M9 10.5v.5M15 10.5v.5M9.5 15c.7.7 1.6 1 2.5 1s1.8-.3 2.5-1" {...common} />
      </svg>
    );
  }
  if (kind === 'passcode' || kind === 'generic') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2" {...common} />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" {...common} />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a7 7 0 0 0-7 7v2a9 9 0 0 1-.5 3" {...common} />
      <path d="M12 4a7 7 0 0 1 7 7v2c0 1.4-.2 2.7-.6 4" {...common} />
      <path d="M8.5 11a3.5 3.5 0 0 1 7 0v2c0 1.7-.3 3.4-.8 5" {...common} />
      <path d="M12 11v2.5c0 2.2-.4 4.4-1.2 6.4" {...common} />
    </svg>
  );
}

export function DeviceAuthButton({
  kind,
  label,
  busy,
  onClick,
  className,
}: {
  kind: DeviceAuthKind;
  label: string;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cx('glass-soft row center g10 device-auth-btn', className)}
    >
      {busy ? <Spinner /> : <DeviceAuthIcon kind={kind} />}
      <span className="device-auth-btn-label">{label}</span>
    </button>
  );
}
