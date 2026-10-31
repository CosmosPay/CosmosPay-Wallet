import { useRef } from 'react';
import { cx } from '@/lib/cx';
import { CloseIcon, SearchIcon } from '@/ui/Icons';
import '@/styles/ui/search-field.css';

/**
 * A search box, drawn one way everywhere: the glass on the left, a clear button on the right
 * once something is typed, Escape clears (before it closes the panel around it). `autoFocus`
 * marks it for the panel that opens it (Dropdown / Sheet focus `data-autofocus`): give it on a
 * PC window only — on a phone it would raise the keyboard over the very list it searches.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  autoFocus = false,
  compact = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The accessible name (the placeholder is not one). */
  label: string;
  clearLabel: string;
  autoFocus?: boolean;
  /** 40px instead of 44px: inside a panel. */
  compact?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label className={cx('search-field', compact && 'is-compact', className)}>
      <SearchIcon className="search-field-icon" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="search-field-input"
        data-autofocus={autoFocus || undefined}
      />
      {value && (
        <button
          type="button"
          className="search-field-clear"
          aria-label={clearLabel}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      )}
    </label>
  );
}
