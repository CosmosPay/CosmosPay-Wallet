import { useId, useState, type ReactNode } from 'react';
import { useKeptState } from '@/hooks/useKeptState';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { cx } from '@/lib/cx';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { AccountIcon, CheckIcon, WarningIcon, WordsIcon } from '@/ui/Icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Segmented } from '@/ui/Segmented';
import '@/styles/features/onboarding/backup-choice.css';

type Backup = 'account' | 'words';

/** The account comes first and starts chosen — the user's call (2026-10-28). */
const BACKUPS: readonly Backup[] = ['account', 'words'];

interface Point {
  key: string;
  /** What this backup costs, as opposed to what it gives. */
  risk?: boolean;
}

interface Panel {
  icon: ReactNode;
  title: string;
  desc: string;
  points: Point[];
  cta: string;
}

/**
 * Creating a wallet, step two: how to back it up. The wallet is local either way — the
 * key is generated here and stays here — so the two answers are two kinds of BACKUP, not
 * two kinds of wallet.
 *
 * The question is a segmented control and the card under it says what the chosen answer
 * means, including what it costs; the button then takes it. Choosing and going are two
 * taps on purpose: losing the twelve words loses the wallet, and that line is on the card
 * before anyone commits to it.
 *
 * Account: the sign-in screen, which on a first run creates the wallet and seals its
 * backup — or, if that account already has one, restores it instead, so nobody chooses
 * wrong here. Words: the phrase is generated now and shown next (`startCreate` → `backup`).
 */
export function BackupChoice({ store }: { store: WalletStore }) {
  const t = store.t;
  const [choice, setChoice] = useKeptState<Backup>(KEPT_INPUT.backupChoice, BACKUPS[0]);
  const [busy, setBusy] = useState(false);
  const panelId = useId();

  const panels: Record<Backup, Panel> = {
    account: {
      icon: <AccountIcon />,
      title: t('backupChoice.account'),
      desc: t('backupChoice.accountDesc'),
      points: [{ key: 'backupChoice.accountAnyPhone' }, { key: 'backupChoice.accountDoors' }, { key: 'backupChoice.accountSealed' }],
      cta: t('backupChoice.continueAccount'),
    },
    words: {
      icon: <WordsIcon />,
      title: t('backupChoice.words'),
      desc: t('backupChoice.wordsDesc'),
      points: [{ key: 'backupChoice.wordsNoAccount' }, { key: 'backupChoice.wordsOtherPhone' }, { key: 'backupChoice.wordsLost', risk: true }],
      cta: t('backupChoice.continueWords'),
    },
  };

  const proceed = async () => {
    if (choice === 'account') {
      store.setScreen('sign-in');
      return;
    }
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
      <Segmented
        label={t('backupChoice.title')}
        options={BACKUPS.map((value) => ({ value, label: t(value === 'account' ? 'backupChoice.segAccount' : 'backupChoice.segWords') }))}
        value={choice}
        onChange={setChoice}
        controls={panelId}
      />
      {/* Both answers are in the card at once, in one grid cell: the card is as tall as the
          longer one, so it never jumps when the choice changes. Only the chosen one shows. */}
      <div id={panelId} className="backup-choice-card">
        {BACKUPS.map((backup) => {
          const panel = panels[backup];
          return (
            <section key={backup} className={cx('backup-choice-panel', backup === choice && 'is-on')}>
              <span className="backup-choice-icon">{panel.icon}</span>
              <div className="col backup-choice-head">
                <h2 className="backup-choice-title">{panel.title}</h2>
                <p className="backup-choice-desc">{panel.desc}</p>
              </div>
              <ul className="backup-choice-points">
                {panel.points.map((point) => (
                  <li key={point.key} className="backup-choice-point">
                    {point.risk ? <WarningIcon className="backup-choice-mark" /> : <CheckIcon className="backup-choice-mark" />}
                    <span>{t(point.key)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="spacer" />
      <PrimaryButton onClick={() => void proceed()} disabled={busy}>
        {panels[choice].cta}
      </PrimaryButton>
      <p className="backup-choice-note">{t('backupChoice.note')}</p>
    </div>
  );
}
