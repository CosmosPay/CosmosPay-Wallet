import { NUMPAD_KEYS } from '@/constants/parts';

/** Numeric keypad shared by Send / Swap amount entry. */
export function NumberPad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="numpad">
      {NUMPAD_KEYS.map((k) => (
        <div key={k} onClick={() => onKey(k)} className="glass-soft">
          {k === 'back' ? '⌫' : k}
        </div>
      ))}
    </div>
  );
}
