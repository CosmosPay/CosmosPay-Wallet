import type { ReactNode, CSSProperties } from 'react';
import { C } from '@/components/parts';

/** Checkbox row in the app's style (used by Backup consents + optional opt-ins). */
export function CheckRow({ on, onToggle, children, style }: { on: boolean; onToggle: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <div onClick={onToggle} className="tap" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', padding: '2px', ...style }}>
      <div style={{ width: '24px', height: '24px', borderRadius: '7px', background: on ? C.accent : 'transparent', color: 'var(--on-accent)', border: `2px solid ${on ? C.accent : 'var(--glass-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: on ? 1 : 0 }}>
          <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span style={{ fontSize: '13.5px', fontWeight: 600, color: C.inkSoft, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

/** One live-criterion row: grey until met (green ✓); `bad` shows a red ✗ state. */
export function Criterion({ met, bad = false, children }: { met: boolean; bad?: boolean; children: ReactNode }) {
  const color = met ? 'var(--up)' : bad ? 'var(--down)' : C.dim;
  const border = met ? 'var(--up)' : bad ? 'var(--down)' : 'var(--glass-border)';
  const tint = met
    ? 'color-mix(in srgb, var(--up) 18%, transparent)'
    : bad
      ? 'color-mix(in srgb, var(--down) 18%, transparent)'
      : 'transparent';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px', fontWeight: 700, color, transition: 'color .2s ease', lineHeight: 1.4 }}>
      <div style={{ width: '17px', height: '17px', borderRadius: '50%', border: `1.5px solid ${border}`, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s ease', flexShrink: 0 }}>
        {bad && !met ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ opacity: met ? 1 : 0.35 }}>
            <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: '14px' }}>
      <div className="label-up" style={{ marginBottom: '7px' }}>{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        className="input"
      />
    </label>
  );
}
