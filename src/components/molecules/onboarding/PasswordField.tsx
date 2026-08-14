import { useState } from 'react';
import { EyeIcon } from '@/components/atoms/EyeIcon';
import { cx } from '@/lib/cx';
import '@/styles/screens/onboarding/password-setup.css';

/** Password input with its OWN eye toggle (each field shows/hides independently).
 *  The eye colour flips via the `is-shown` modifier class. */
export function PasswordField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="ob-field">
      <div className="label-up ob-field-label">{label}</div>
      <div className="pwd-setup-field-wrap">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className="input pwd-setup-input"
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setShow((s) => !s);
          }}
          aria-label={show ? 'Ocultar' : 'Mostrar'}
          className={cx('pwd-setup-eye', show && 'is-shown')}
        >
          <EyeIcon off={show} />
        </button>
      </div>
    </label>
  );
}
