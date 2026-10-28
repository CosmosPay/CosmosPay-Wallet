import type { WalletStore } from '@/state/store';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { AccountIcon, ImportIcon, QrIcon, WordsIcon } from '@/ui/Icons';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * "I already have a wallet": where it is now. The same two backups as BackupChoice, account
 * first — it is the one that needs nothing typed — then the two ways to bring a wallet that
 * lives somewhere else.
 *
 * Account: the sign-in screen, which finds the backup and asks for what opens it. Words: the
 * import screen, which also takes a Stellar secret key. Another Cosmos Wallet: easy recovery,
 * a QR and a code (src/lib/easyRecovery.ts). Another wallet: each wallet's own steps to its
 * phrase or key, picked by its logo.
 */
export function RestoreChoice({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="scr screen col">
      <ScreenHeader title={t('restoreChoice.title')} desc={t('restoreChoice.desc')} onBack={store.goBack} />
      <div className="col g12">
        <ChoiceCard
          icon={<AccountIcon />}
          title={t('backupChoice.account')}
          desc={t('restoreChoice.accountDesc')}
          onClick={() => store.setScreen('sign-in')}
        />
        <ChoiceCard
          icon={<WordsIcon />}
          title={t('restoreChoice.words')}
          desc={t('restoreChoice.wordsDesc')}
          onClick={() => {
            store.setImportText('');
            store.setScreen('import');
          }}
        />
        <ChoiceCard
          icon={<QrIcon />}
          title={t('restoreChoice.easy')}
          desc={t('restoreChoice.easyDesc')}
          onClick={() => store.setScreen('easy-recovery-receive')}
        />
        <ChoiceCard
          icon={<ImportIcon />}
          title={t('restoreChoice.other')}
          desc={t('restoreChoice.otherDesc')}
          onClick={() => store.setScreen('import-wallet')}
        />
      </div>
    </div>
  );
}
