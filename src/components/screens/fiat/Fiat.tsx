import { useEffect } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar } from '@/components/parts';
import { CreateReceiver } from '@/components/organisms/fiat/CreateReceiver';
import { ReceiverHub } from '@/components/organisms/fiat/ReceiverHub';
import { ageFromBirthdate } from '@/lib/greeting';
import '@/styles/screens/fiat/fiat.css';

/* BlindPay fiat (on/off-ramp). LatAm-first. Needs a `standard` KYC receiver (photo ID +
   selfie) kept as the wallet's default; once verified, the hub exposes deposit/withdraw. */
export function Fiat({ store }: { store: WalletStore }) {
  const receiverId = store.meta?.cosmosPayReceiverId;
  // 18+ only. The home entry card is already hidden for minors; this guard also
  // covers the other paths into this screen (CosmosPay manage-receiver, back nav…).
  const adult = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;

  useEffect(() => {
    if (adult) store.loadReceivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.meta?.id, store.network.id, adult]);

  if (!adult) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={store.t('fiat.tab')} onBack={() => store.go('home', 'home')} />
        <div className="f1 col center g12 fiat-adult-gate">
          <div className="fiat-adult-emoji">🔞</div>
          <div className="fiat-adult-text">{store.t('fiat.adultOnly')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      {receiverId ? <ReceiverHub store={store} receiverId={receiverId} /> : <CreateReceiver store={store} />}
    </div>
  );
}
