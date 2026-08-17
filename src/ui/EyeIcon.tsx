/** Eye / eye-off glyph for the password reveal toggles (PasswordField, Unlock).
 *  `off` draws the struck-through eye shown while the password IS visible. */
export function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      {off ? (
        <path d="M2 12s3.5-7 10-7c2.2 0 4.1.8 5.6 1.9M22 12s-3.5 7-10 7c-2.2 0-4.1-.8-5.6-1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      )}
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      {off && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}
