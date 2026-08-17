import { useState } from 'react';
import { EyeIcon } from '@/ui/EyeIcon';
import { sanitizeDecimalInput, FIAT_DECIMALS } from '@/lib/amount';
import { tNow } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import '@/styles/ui/field.css';

/**
 * The labelled pill input, for every form in the app.
 *
 * Replaces three components that were the same control wearing different class
 * names: `molecules/onboarding/Field` (uppercase label on the glass surface),
 * `molecules/fiat/Field` (sentence-case label on the soft surface) and
 * `molecules/onboarding/PasswordField` (the same field plus an eye toggle).
 *
 * The two looks are kept as enumerated variants rather than averaged away, so this
 * merge changes no pixels — `tone` and `kind` map to classes, per CLAUDE.md, and an
 * unsupported value is a compile error rather than a silently missing style.
 */
export type FieldTone = 'glass' | 'soft';
export type FieldKind = 'text' | 'amount';

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  tone = 'glass',
  kind = 'text',
  password = false,
  error,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** 'glass' = onboarding/settings surface; 'soft' = the fiat forms. */
  tone?: FieldTone;
  /** 'amount' opens the numeric keypad and filters keystrokes through the shared
   *  decimal parser, so the value always reads back the way the user typed it. */
  kind?: FieldKind;
  /** Renders the show/hide eye and forces the input type. */
  password?: boolean;
  error?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const isAmount = kind === 'amount';

  const handle = (raw: string) => {
    if (!isAmount) return onChange(raw);
    const next = sanitizeDecimalInput(raw, FIAT_DECIMALS);
    if (next !== null) onChange(next);
  };

  const input = (
    <input
      type={password ? (show ? 'text' : 'password') : type}
      value={value}
      placeholder={placeholder}
      inputMode={isAmount ? 'decimal' : undefined}
      onChange={(e) => handle((e.target as HTMLInputElement).value)}
      className={cx('input', tone === 'soft' && 'is-soft', error && 'has-err')}
    />
  );

  return (
    <label className={cx('field', tone === 'soft' && 'is-soft', className)}>
      {label && <div className={cx('field-label', tone === 'glass' && 'label-up')}>{label}</div>}
      {password ? (
        <div className="field-eye-wrap">
          {input}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setShow((s) => !s);
            }}
            aria-label={tNow(show ? 'a11y.hide' : 'a11y.show')}
            className={cx('field-eye', show && 'is-shown')}
          >
            <EyeIcon off={show} />
          </button>
        </div>
      ) : (
        input
      )}
      {error && <div className="err-line">{error}</div>}
    </label>
  );
}
