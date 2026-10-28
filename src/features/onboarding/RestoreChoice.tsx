import type { WalletStore } from '@/state/store';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { AccountIcon, WordsIcon } from '@/ui/Icons';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * "I already have a wallet": which backup it has. The same two kinds as BackupChoice,
 * account first here — it is the one that needs nothing typed.
 *
 * Account: the sign-in screen, which finds the backup and asks for what opens it. Words:
 * the import screen, which also takes a Stellar secret key.
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
      </div>
    </div>
  );
}
