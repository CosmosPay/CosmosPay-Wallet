import { useState } from 'react';
import { AssetLogo } from '@/ui/AssetLogo';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { assetKey, codeIsAmbiguous, isSameAsset, shortIssuer, type AssetRef } from '@/lib/asset';
import '@/styles/features/money/asset-select.css';

/** The shape every caller already has: a Horizon balance row. */
export type SelectableAsset = { code: string; issuer: string | null; balance: string };

/**
 * Token dropdown shared by Send, Swap, Pay-link and the LP deposit — any
 * trustlined asset (XLM always present).
 *
 * Selection is by (code, issuer), not by code: this used to report `a.code` only,
 * so two trustlines with the same code were indistinguishable to the caller and the
 * issuer was resolved later by first-match. When the account does hold the same code
 * from two issuers, each row also shows its issuer so the user can tell them apart.
 *
 * `open`/`onToggle` make it controllable so the parent can lift the card's
 * stacking context while the menu is open (the glass cards' backdrop-filter
 * would otherwise trap the menu below its sibling card). Uncontrolled (internal
 * state) when those props are omitted.
 *
 * `variant` only picks the dressing: 'swap' is the default opaque menu that has
 * to stay legible over the glass cards; 'send' is the compact, right-aligned
 * glass menu that sits in the Send amount row.
 */
export function AssetSelect({
  assets,
  value,
  onPick,
  variant = 'swap',
  open: openProp,
  onToggle,
}: {
  assets: SelectableAsset[];
  value: AssetRef;
  onPick: (asset: SelectableAsset) => void;
  variant?: 'swap' | 'send';
  open?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (next: boolean) => (onToggle ? onToggle(next) : setOpenLocal(next));
  const send = variant === 'send';

  return (
    <div className={cx('asset-select', send && 'is-send')}>
      <button onClick={() => setOpen(!open)} className="glass-soft asset-select-btn">
        <AssetLogo code={value.code} size={send ? 26 : 28} />
        {value.code}
        <span className={cx('asset-select-caret', open && 'is-open')}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="asset-select-overlay" />
          <div className={cx('asset-select-menu', send ? 'glass' : 'is-solid')}>
            {assets.map((a) => (
              <div
                key={assetKey(a)}
                onClick={() => {
                  onPick(a);
                  setOpen(false);
                }}
                className={cx('tap asset-select-item', isSameAsset(a, value) && 'is-on')}
              >
                <AssetLogo code={a.code} size={26} />
                <span className="asset-select-code">
                  {a.code}
                  {/* Only shown when the code alone would be ambiguous — otherwise it
                      is noise on every row and stops meaning "look at this". */}
                  {codeIsAmbiguous(assets, a.code) && a.issuer && (
                    <span className="asset-select-issuer">{shortIssuer(a.issuer)}</span>
                  )}
                </span>
                <span className="t-dim-12">{trim(parseFloat(a.balance) || 0, 4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
