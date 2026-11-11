import type { WalletStore } from '@/state/store';
import type { RampSide } from '@/constants/ramp';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { keepInput } from '@/lib/keptInputs';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { ReceiveIcon, SendIcon } from '@/ui/Icons';
import '@/styles/features/fiat/ramp-entries.css';

/**
 * The fiat screens' way into the P2P ramp (`Ramp.tsx`): buy with local money, or sell for it.
 * Neither needs the receiver and KYC form those screens hold — the hosted window verifies the
 * person itself — so both screens show these first.
 */
export function RampEntries({ store }: { store: WalletStore }) {
  const t = store.t;
  const go = (side: RampSide) => {
    keepInput(KEPT_INPUT.rampSide, side);
    store.setScreen('ramp');
  };
  return (
    <div className="ramp-entries col g8">
      <ChoiceCard icon={<ReceiveIcon />} title={t('ramp.entryBuy')} desc={t('ramp.entryBuyDesc')} onClick={() => go('buy')} />
      <ChoiceCard icon={<SendIcon />} title={t('ramp.entrySell')} desc={t('ramp.entrySellDesc')} onClick={() => go('sell')} />
    </div>
  );
}
