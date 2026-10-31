import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { CheckIcon, ClipboardIcon, CloseIcon, ScanIcon } from '@/ui/Icons';
import '@/styles/features/money/send.css';

/**
 * The pieces every Send form is made of (features/money/Send.tsx, ChainSend.tsx), so sending on
 * Stellar and on any other network reads the same: a section is a label over its control and a
 * note under it; the recipient is one field with paste and scan inside it; the amount is one
 * field with the asset's code and "Max" inside it.
 */

/** A labelled step of the form; `htmlFor` ties the label to the control inside. */
export function SendSection({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <section className="send-section">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="send-label">
          {label}
        </label>
      ) : (
        <h2 className="send-label">{label}</h2>
      )}
      {children}
    </section>
  );
}

/** What a field says about itself, under it: valid, a problem, or a plain fact. */
export function FieldNote({ tone, children }: { tone: 'ok' | 'bad' | 'plain'; children: ReactNode }) {
  return (
    <p className={cx('send-note', `is-${tone}`)} role={tone === 'bad' ? 'alert' : undefined}>
      {tone === 'ok' && <CheckIcon />}
      {tone === 'bad' && <CloseIcon />}
      <span>{children}</span>
    </p>
  );
}

/** The recipient: one field, paste (and scan, where the network's QR is read) inside its end. */
export function RecipientInput({
  id,
  value,
  onChange,
  placeholder,
  onPaste,
  onScan,
  pasteLabel,
  scanLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onPaste: () => void;
  onScan?: () => void;
  pasteLabel: string;
  scanLabel: string;
}) {
  return (
    <div className={cx('send-box', onScan && 'has-two')}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className="send-box-input is-address"
      />
      <span className="send-box-actions">
        <button type="button" onClick={onPaste} aria-label={pasteLabel} title={pasteLabel} className="send-box-btn">
          <ClipboardIcon />
        </button>
        {onScan && (
          <button type="button" onClick={onScan} aria-label={scanLabel} title={scanLabel} className="send-box-btn">
            <ScanIcon />
          </button>
        )}
      </span>
    </div>
  );
}

/** The amount: one field, the asset's code and "Max" inside its end. */
export function AmountInput({
  id,
  value,
  onChange,
  code,
  onMax,
  maxLabel,
  maxDisabled = false,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (raw: string) => void;
  code: string;
  onMax: () => void;
  maxLabel: string;
  maxDisabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={cx('send-box is-amount', invalid && 'is-invalid')}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        inputMode="decimal"
        placeholder="0"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="send-box-input is-amount"
      />
      <span className="send-box-actions">
        <span className="send-box-code">{code}</span>
        <button type="button" onClick={onMax} disabled={maxDisabled} className="send-max">
          {maxLabel}
        </button>
      </span>
    </div>
  );
}

/** Under the amount: what it is worth on the left, what can be sent on the right. */
export function AmountMeta({ worth, available }: { worth: string | null; available: string }) {
  return (
    <p className="send-meta">
      <span>{worth ?? ''}</span>
      <span>{available}</span>
    </p>
  );
}

export const useFieldId = (name: string) => `${useId()}-${name}`;
