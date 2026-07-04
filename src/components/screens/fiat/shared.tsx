import type { CSSProperties, ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { C, inputStyle } from '@/components/parts';
import { STABLES } from '@/constants/fiat';

/* ---- onramp/offramp helpers ---- */
/** Minor units (cents) -> "12.34". */
export const fmtMinor = (n?: number | null) => (n == null ? '—' : (n / 100).toFixed(2));
/** Local fiat (minor units) -> whole units, grouped, no centavos (e.g. ARS "15.615"). */
export const fmtFiat = (n?: number | null) => (n == null ? '—' : Math.round(n / 100).toLocaleString('es-AR'));
/** "12.34" -> 1234 minor units (the API takes integer cents). */
export const toMinor = (s: string) => Math.round((parseFloat(s) || 0) * 100);

/** Trusted stablecoins on the wallet.  keeps only those with a spendable balance. */
export function stableTokens(store: WalletStore, withBalance = false): { code: string; balance: number }[] {
  return (store.account?.balances ?? [])
    .filter((b) => !b.isNative && STABLES.includes(b.code))
    .map((b) => ({ code: b.code, balance: parseFloat(b.balance) || 0 }))
    .filter((b) => (withBalance ? b.balance > 0 : true));
}

const fieldLabel: CSSProperties = { fontSize: '12px', color: 'var(--muted)', fontWeight: 700, margin: '0 2px 6px' };
const fieldInput: CSSProperties = { ...inputStyle, background: C.cardSolid, border: '1px solid var(--glass-border)' };

export function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: '12px' }}>
      <div style={fieldLabel}>{label}</div>
      <input value={value} type={type} onChange={(e) => onChange((e.target as HTMLInputElement).value)} placeholder={placeholder} style={fieldInput} />
    </label>
  );
}

/** Native <select> styled to match the app's pill inputs (glass + chevron). Keeps the
 *  OS picker (best for mobile) while looking on-brand. `style` is merged onto the label
 *  so it can flex inside a row. */
export function Select({ label, value, onChange, children, style }: { label?: string; value: string; onChange: (v: string) => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <label style={{ display: 'block', marginBottom: '12px', ...style }}>
      {label && <div style={fieldLabel}>{label}</div>}
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
          style={{ ...fieldInput, appearance: 'none', WebkitAppearance: 'none', paddingRight: '42px', cursor: 'pointer' }}
        >
          {children}
        </select>
        <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '10px', color: C.muted, opacity: 0.85 }}>▼</span>
      </div>
    </label>
  );
}

/* ----------------------- deposit / withdraw (onramp / offramp) ----------------------- */

export const SCR_STYLE: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' };
export const quoteCardStyle: CSSProperties = { ...C.glass, borderRadius: '16px', padding: '4px 16px', marginTop: '14px' };

export function QuoteRow({ label, val, last }: { label: string; val: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--hairline)' }}>
      <span style={{ color: C.muted, fontSize: '13px', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  );
}
