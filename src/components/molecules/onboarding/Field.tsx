import '@/styles/screens/onboarding/shared.css';

/** Labelled pill-input field used across the onboarding flow. */
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
    <label className="ob-field">
      <div className="label-up ob-field-label">{label}</div>
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
