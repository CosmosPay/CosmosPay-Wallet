import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { AccountIcon, WordsIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import '@/styles/features/onboarding/backup-choice.css';

/**
 * Creating a wallet, step two: how to back it up. The wallet is local either way — the
 * key is generated here and stays here — so the two answers are two kinds of BACKUP, not
 * two kinds of wallet, and they carry the same weight. The twelve words come first so the
 * local path never reads as the lesser one.
 *
 * Words: the phrase is generated now and shown next (`startCreate` → `backup`). Account:
 * the sign-in screen, which on a first run creates the wallet and seals its backup — or,
 * if that account already has one, restores it instead, so nobody chooses wrong here.
 */
export function BackupChoice({ store }: { store: WalletStore }) {
  const t = store.t;
  const [busy, setBusy] = useState(false);

  const withWords = async () => {
    setBusy(true);
    try {
      await store.startCreate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('backupChoice.title')} desc={t('backupChoice.desc')} onBack={store.goBack} />
      <div className="col g12">
        <ChoiceCard
          icon={<WordsIcon />}
          title={t('backupChoice.words')}
          desc={t('backupChoice.wordsDesc')}
          onClick={() => void withWords()}
          disabled={busy}
        />
        <ChoiceCard
          icon={<AccountIcon />}
          title={t('backupChoice.account')}
          desc={t('backupChoice.accountDesc')}
          onClick={() => store.setScreen('sign-in')}
          disabled={busy}
        />
      </div>
      <div className="spacer" />
      <Notice className="backup-choice-note">{t('backupChoice.note')}</Notice>
    </div>
  );
}
