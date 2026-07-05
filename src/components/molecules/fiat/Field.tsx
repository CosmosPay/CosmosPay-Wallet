import '@/styles/screens/fiat/shared.css';

/** Labelled pill-input field used across the fiat (on/off-ramp) flow. */
export function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="fiat-field">
      <div className="fiat-field-label">{label}</div>
      <input value={value} type={type} onChange={(e) => onChange((e.target as HTMLInputElement).value)} placeholder={placeholder} className="fiat-input" />
    </label>
  );
}
