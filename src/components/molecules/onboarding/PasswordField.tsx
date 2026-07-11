import { useState } from 'react';
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
          className={show ? 'pwd-setup-eye is-shown' : 'pwd-setup-eye'}
        >
          {show ? (
            // eye-off: hidden again on tap
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s3.5-7 10-7c2.2 0 4.1.8 5.6 1.9M22 12s-3.5 7-10 7c-2.2 0-4.1-.8-5.6-1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            // eye: tap to reveal
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
