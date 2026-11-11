import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { ScanIcon } from '@/ui/Icons';
import { parseWcUri } from '@/lib/walletConnect';
import '@/styles/features/walletconnect/wc-pair.css';

/**
 * Connect a site with WalletConnect (screen `wc-pair`): its `wc:` link pasted here, or its QR
 * scanned with the wallet's scanner. The site's proposal then opens over this screen
 * (`WcHost.tsx`), with what it asks and the Verify API's verdict on it.
 */
export function WcPair({ store }: { store: WalletStore }) {
  const t = store.t;
  const [uri, setUri] = useState('');
  const valid = parseWcUri(uri) !== null;
  const waiting = store.wcPairing;

  const connect = async () => {
    if (!valid || waiting) return;
    if (await store.wcPair(uri)) setUri('');
  };

  return (
    <form
      className="scr screen col pb-24 wc-pair"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <ScreenHeader title={t('wc.pairTitle')} desc={t('wc.pairDesc')} onBack={store.goBack} />
      <GhostButton onClick={() => store.setScreen('scan')} className="wc-pair-scan">
        <ScanIcon />
        {t('wc.scan')}
      </GhostButton>
      <Field
        label={t('wc.pasteLabel')}
        value={uri}
        onChange={setUri}
        placeholder="wc:…"
        error={uri.trim() && !valid ? t('wc.badUri') : undefined}
      />
      {waiting && (
        <div className="row g8 wc-pair-waiting" role="status">
          <Spinner size={16} tone="text" />
          <span>{t('wc.waiting')}</span>
        </div>
      )}
      <Notice className="wc-pair-note">{t('wc.pairNote')}</Notice>
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton type="submit" disabled={!valid || waiting}>
          {waiting ? <Spinner /> : t('wc.connect')}
        </PrimaryButton>
      </div>
    </form>
  );
}
