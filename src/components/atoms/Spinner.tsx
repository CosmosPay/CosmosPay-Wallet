/** Tones a spinner can wear — each maps to a .spinner--* class in app.css.
 *  'on-primary' is the base rule (what sits inside a .btn-primary). */
export type SpinnerTone = 'on-primary' | 'text' | 'dim' | 'white' | 'ink';

/** Diameters that have a .spinner--<px> class; 18 is the base rule. */
export type SpinnerSize = 15 | 16 | 18;

export function Spinner({ size = 18, tone = 'on-primary' }: { size?: SpinnerSize; tone?: SpinnerTone }) {
  // The shell, both sizes and every tone live in .spinner* (app.css).
  const cls = ['spinner'];
  if (size !== 18) cls.push(`spinner--${size}`);
  if (tone !== 'on-primary') cls.push(`spinner--${tone}`);
  return <span className={cls.join(' ')} />;
}
