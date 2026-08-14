import { cx } from '@/lib/cx';

/** Tones a spinner can wear — each maps to a .spinner--* class in app.css.
 *  'on-primary' is the base rule (what sits inside a .btn-primary). */
export type SpinnerTone = 'on-primary' | 'text' | 'dim' | 'white' | 'ink';

/** Diameters that have a .spinner--<px> class; 18 is the base rule. */
export type SpinnerSize = 15 | 16 | 18;

export function Spinner({ size = 18, tone = 'on-primary' }: { size?: SpinnerSize; tone?: SpinnerTone }) {
  // The shell, both sizes and every tone live in .spinner* (app.css); the base
  // rule already is the 18px on-primary variant, so those need no modifier.
  return <span className={cx('spinner', size !== 18 && `spinner--${size}`, tone !== 'on-primary' && `spinner--${tone}`)} />;
}
