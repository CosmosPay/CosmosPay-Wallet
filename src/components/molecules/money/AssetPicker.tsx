import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { AssetLogo } from '@/components/parts';
import { trim } from '@/lib/format';
import { sendableAssets } from '@/components/screens/money/shared';
import '@/styles/screens/money/send.css';

/** Pill dropdown to choose which asset to send (Send screen). */
export function AssetPicker({ store }: { store: WalletStore }) {
  const [open, setOpen] = useState(false);
  const assets = sendableAssets(store);
  const code = store.send.asset || 'XLM';
  return (
    <div className="send-picker">
      <button onClick={() => setOpen((o) => !o)} className="glass-soft send-picker-btn">
        <AssetLogo code={code} size={26} />
        {code}
        <span className={open ? 'send-picker-caret is-open' : 'send-picker-caret'}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="send-picker-overlay" />
          <div className="glass send-picker-menu">
            {assets.map((a) => (
              <div key={a.code + (a.issuer ?? '')} onClick={() => { store.setSend({ ...store.send, asset: a.code, amount: '0' }); setOpen(false); }} className={a.code === code ? 'tap send-picker-item is-on' : 'tap send-picker-item'}>
                <AssetLogo code={a.code} size={26} />
                <span className="send-picker-item-code">{a.code}</span>
                <span className="t-dim-12">{trim(parseFloat(a.balance) || 0, 4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
