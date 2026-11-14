import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { ListRow } from '@/ui/ListRow';
import { ActivityIcon, GearIcon, GlobeIcon, KeyIcon, LinkIcon, PenIcon, PlusIcon, QrIcon, ReceiveIcon, ScanIcon, SendIcon } from '@/ui/Icons';
import { readText } from '@/lib/clipboard';
import { keepInput } from '@/lib/keptInputs';
import { KEPT_INPUT } from '@/constants/keptInputs';
import type { RampSide } from '@/constants/ramp';
import '@/styles/features/extras/operations.css';

/* --------------------------- OPERATIONS HUB ------------------------- */
/** Home's "More": the tools that are not a daily action, as one list. Buying and selling with
 *  local money head it, so the ramp is two taps from Home rather than behind the fiat screens,
 *  and charging with a QR in local money follows them. */
export function Operations({ store }: { store: WalletStore }) {
  const t = store.t;

  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) store.setScreen('send');
    else store.flash(t('ops.pasteInvalid'), 'err');
  };

  const openRamp = (side: RampSide) => {
    keepInput(KEPT_INPUT.rampSide, side);
    store.setScreen('ramp');
  };

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('ops.title')} desc={t('ops.desc')} onBack={store.goBack} />
      <div className="operations-list">
        <ListRow icon={<ReceiveIcon />} title={t('ramp.entryBuy')} desc={t('ramp.entryBuyDesc')} onClick={() => openRamp('buy')} />
        <ListRow icon={<SendIcon />} title={t('ramp.entrySell')} desc={t('ramp.entrySellDesc')} onClick={() => openRamp('sell')} />
        <ListRow icon={<QrIcon />} title={t('charge.title')} desc={t('charge.entryDesc')} onClick={() => store.setScreen('charge')} />
        <ListRow icon={<ActivityIcon />} title={t('ops.gatewayTitle')} desc={t('ops.gatewaySub')} onClick={() => store.setScreen('gateway-ops')} />
        <ListRow icon={<PenIcon />} title={t('ops.signTx')} desc={t('ops.signTxSub')} onClick={() => store.setScreen('sign-tx')} />
        <ListRow icon={<LinkIcon />} title={t('ops.pastePay')} desc={t('ops.pastePaySub')} onClick={() => void pastePayUrl()} />
        <ListRow icon={<ScanIcon />} title={t('scan.scanQr')} onClick={() => store.setScreen('scan')} />
        <ListRow icon={<PlusIcon />} title={t('addAsset.title')} onClick={() => store.setScreen('add-asset')} />
        <ListRow icon={<GlobeIcon />} title={t('net.add')} onClick={() => store.setScreen('add-network')} />
        <ListRow icon={<KeyIcon />} title={t('profile.exportKeys')} onClick={() => store.setScreen('export')} />
        <ListRow icon={<GearIcon />} title={t('profile.settings')} onClick={() => store.setScreen('settings')} />
      </div>
    </div>
  );
}
