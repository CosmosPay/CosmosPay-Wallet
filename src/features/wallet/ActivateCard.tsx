import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { PrimaryButton } from '@/ui/Buttons';
import { useBusy } from '@/hooks/useBusy';
import { HomeCard } from '@/features/wallet/HomeCard';

/** Not-yet-activated account: fund via Friendbot (testnet) or show the address (mainnet).
 *  Uses a LOCAL busy so funding doesn't spin an unrelated card's button. */
export function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = !!store.network.friendbot;
  const [busy, run] = useBusy();
  return (
    <HomeCard title={t('home.activate')}>
      <p className="home-card-desc">
        {t('home.activateDesc')}
        {testnet ? t('home.activateTestnet') : t('home.activateMainnet')}
      </p>
      {testnet ? (
        <PrimaryButton disabled={busy} onClick={() => void run(() => store.fund())}>
          {busy ? <Spinner /> : t('home.getTestXlm')}
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={() => store.setScreen('receive')}>{t('home.viewAddress')}</PrimaryButton>
      )}
    </HomeCard>
  );
}
