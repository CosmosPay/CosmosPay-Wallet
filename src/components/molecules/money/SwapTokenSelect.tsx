import { useState } from 'react';
import { AssetLogo } from '@/components/parts';
import { trim } from '@/lib/format';
import '@/styles/screens/money/shared.css';

/** Token dropdown for the swap screen — any trustlined asset (XLM always present).
 *  `open`/`onToggle` make it controllable so the parent can lift the card's stacking
 *  context while open (the glass cards' backdrop-filter would otherwise trap the menu
 *  below the sibling card). Uncontrolled (internal state) when those props are omitted. */
export function SwapTokenSelect({
  assets,
  code,
  onPick,
  open: openProp,
  onToggle,
}: {
  assets: { code: string; issuer: string | null; balance: string; isNative: boolean }[];
  code: string;
  onPick: (code: string) => void;
  open?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (next: boolean) => (onToggle ? onToggle(next) : setOpenLocal(next));
  return (
    <div className="swap-select">
      <button onClick={() => setOpen(!open)} className="glass-soft swap-select-btn">
        <AssetLogo code={code} size={28} />
        {code}
        <span className={open ? 'swap-select-caret is-open' : 'swap-select-caret'}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="swap-select-overlay" />
          <div className="swap-select-menu">
            {assets.map((a) => (
              <div key={a.code + (a.issuer ?? '')} onClick={() => { onPick(a.code); setOpen(false); }} className={a.code === code ? 'tap swap-select-item is-on' : 'tap swap-select-item'}>
                <AssetLogo code={a.code} size={26} />
                <span className="swap-select-item-code">{a.code}</span>
                <span className="t-dim-12">{trim(parseFloat(a.balance) || 0, 4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
