import type { WalletStore } from '@/state/store';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { CosmosPayRow } from '@/features/cosmospay/CosmosPayRow';
import { CosmosPayEnvRow } from '@/features/cosmospay/CosmosPayEnvRow';
import { ageFromBirthdate } from '@/lib/greeting';
import { ID_PREVIEW_LEN } from '@/constants/settings';
import '@/styles/features/cosmospay/cosmos-pay.css';

/* Cosmos Pay integration manager: link / unlink the API keys per network (testnet/mainnet)
   and the BlindPay fiat receiver. Cosmos Pay is an integration — not "receiving payments". */

/** Long opaque ids are shown truncated — they only need to be recognisable. */
const preview = (id: string | undefined | null) => (id ? id.slice(0, ID_PREVIEW_LEN) + '…' : '—');

export function CosmosPay({ store }: { store: WalletStore }) {
  const t = store.t;
  const cp = store.cosmosPay;
  const receiverId = store.meta?.cosmosPayReceiverId;
  // While a connect / re-link flow is running, show its card even if some keys already exist.
  const flowActive = !!store.cosmosLink || !!store.cosmosPayPending;
  // Fiat (BlindPay receiver) is 18+ only — minors don't get the option at all.
  const adult = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;

  return (
    <div className="scr screen col pb-104">
      <BackBar title="Cosmos Pay" onBack={store.goBack} />
      <div className="desc cosmospay-margin">{t('cosmospay.integrationDesc')}</div>

      {/* API keys — per network */}
      <div className="cosmospay-section">{t('cosmospay.apiKeys')}</div>
      {!cp || flowActive ? (
        <EnableReceivingCard store={store} />
      ) : (
        <div className="glass cosmospay-card">
          <CosmosPayRow label={t('cosmospay.org')} value={preview(cp.organizationId)} />
          <CosmosPayEnvRow store={store} net="Testnet" env="dev" present={!!cp.keys.dev} />
          <CosmosPayEnvRow store={store} net="Mainnet" env="prod" present={!!cp.keys.prod} />
          <GhostButton onClick={() => store.enableReceiving()} className="cosmospay-reconnect">{t('cosmospay.reconnect')}</GhostButton>
        </div>
      )}

      {/* Receiver (fiat / BlindPay) — hidden entirely for minors (18+ only). */}
      {adult && <div className="cosmospay-section">{t('cosmospay.receiverSection')}</div>}
      {!adult ? null : receiverId ? (
        <div className="glass cosmospay-card">
          <CosmosPayRow label={t('fiat.account')} value={preview(receiverId)} />
          <div className="flexr g10 cosmospay-actions">
            <GhostButton onClick={() => store.setScreen('fiat')} className="f1">{t('cosmospay.manageReceiver')}</GhostButton>
            <GhostButton onClick={() => store.unlinkReceiver()} className="f1 cosmospay-unlink">{t('cosmospay.unlinkReceiver')}</GhostButton>
          </div>
        </div>
      ) : (
        <div className="glass cosmospay-card">
          <div className="cosmospay-noreceiver">{t('cosmospay.noReceiver')}</div>
          <PrimaryButton disabled={!cp} onClick={() => store.setScreen('fiat')}>{t('cosmospay.linkReceiver')}</PrimaryButton>
        </div>
      )}
    </div>
  );
}
