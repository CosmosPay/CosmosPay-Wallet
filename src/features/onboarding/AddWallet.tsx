import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { CheckRow } from '@/ui/CheckRow';
import { Field } from '@/ui/Field';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { ChevronDownIcon, CopyIcon, KeyIcon, PlusIcon } from '@/ui/Icons';
import { WordCell } from '@/features/onboarding/WordCell';
import { Criterion } from '@/features/onboarding/Criterion';
import { useCopied } from '@/hooks/useCopied';
import { readText } from '@/lib/clipboard';
import { isValidMnemonic, isValidSecret } from '@/lib/wallet';
import { cx } from '@/lib/cx';
import { NAME_MAX_LEN } from '@/constants/onboarding';
import { IMPORT_WALLETS, type ImportWallet } from '@/constants/importWallet';
import '@/styles/features/onboarding/add-wallet.css';
import '@/styles/features/onboarding/import.css';

type Step = 'choose' | 'words' | 'paste' | 'name';

/**
 * Another wallet on this device — the user's call: simple, no account to create and no profile
 * to fill, because the password is the one this device already opens with and the person is
 * the same. Choose → (a new phrase to keep | what you paste) → a name → done. Each step is a
 * stop on the way back (`goStep`); the draft never outlives the screen.
 */
export function AddWallet({ store }: { store: WalletStore }) {
  const t = store.t;
  const [saved, setSaved] = useState(false);
  const [text, setText] = useState('');
  const [name, setName] = useState(() => t('addWallet.defaultName', { n: store.wallets.length + 1 }));
  const [guide, setGuide] = useState<ImportWallet['id'] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [copied, copy] = useCopied();

  // A step is shown only once what it needs is there; otherwise the first one.
  const wanted = (store.navStep ?? 'choose') as Step;
  const step: Step =
    wanted === 'words' && store.hasWalletDraft && store.draftMnemonic
      ? 'words'
      : wanted === 'name' && store.hasWalletDraft
        ? 'name'
        : wanted === 'paste'
          ? 'paste'
          : 'choose';
  const { replaceStep } = store;
  useEffect(() => {
    if (step !== wanted && wanted !== 'choose') replaceStep(step === 'choose' ? undefined : step);
  }, [step, wanted, replaceStep]);

  // Leaving the screen takes the draft (a phrase, a key) with it.
  const drop = useRef(store.dropWalletDraft);
  drop.current = store.dropWalletDraft;
  useEffect(() => () => drop.current(), []);

  if (step === 'choose') {
    const create = async () => {
      setPreparing(true);
      try {
        await store.prepareNewWallet();
        setSaved(false);
        store.goStep('words');
      } finally {
        setPreparing(false);
      }
    };
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('addWallet.title')} desc={t('addWallet.desc')} onBack={store.goBack} />
        <div className="col g12">
          <ChoiceCard icon={<PlusIcon />} title={t('addWallet.create')} desc={t('addWallet.createDesc')} onClick={create} disabled={preparing} />
          <ChoiceCard
            icon={<KeyIcon />}
            title={t('addWallet.import')}
            desc={t('addWallet.importDesc')}
            onClick={() => {
              setText('');
              store.goStep('paste');
            }}
          />
        </div>
      </div>
    );
  }

  if (step === 'words') {
    const words = store.draftMnemonic.split(' ');
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('addWallet.wordsTitle')} desc={t('addWallet.wordsDesc')} onBack={store.goBack} />
        <div className="ob-word-grid add-wallet-words">
          {words.map((w, i) => (
            <WordCell key={i} n={i + 1}>
              {w}
            </WordCell>
          ))}
        </div>
        <GhostButton onClick={() => void copy(store.draftMnemonic)} className="add-wallet-copy">
          <CopyIcon />
          {copied ? t('common.copied') : t('backup.copy')}
        </GhostButton>
        <Notice tone="danger" className="add-wallet-note">
          {t('addWallet.wordsWarn')}
        </Notice>
        <CheckRow on={saved} onToggle={() => setSaved((v) => !v)}>
          {t('backup.saved')}
        </CheckRow>
        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton disabled={!saved} onClick={() => store.goStep('name')}>
            {t('common.continue')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  if (step === 'paste') {
    const txt = text.trim();
    const valid = txt.length > 0 && (isValidMnemonic(txt) || isValidSecret(txt));
    const submit = async () => {
      if (!valid || preparing) return;
      setPreparing(true);
      try {
        if (await store.prepareImportedWallet(txt)) {
          setText('');
          store.goStep('name');
        }
      } finally {
        setPreparing(false);
      }
    };
    const open = IMPORT_WALLETS.find((w) => w.id === guide);
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('addWallet.import')} desc={t('import.desc')} onBack={store.goBack} />
        <textarea
          value={text}
          onChange={(e) => setText((e.target as HTMLTextAreaElement).value)}
          aria-label={t('addWallet.import')}
          rows={4}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="import-textarea"
        />
        <div className="import-criterion">
          <Criterion met={valid} bad={txt.length > 0 && !valid}>
            {txt.length > 0 && !valid ? t('import.invalid') : t('import.valid')}
          </Criterion>
        </div>
        <GhostButton onClick={async () => setText(await readText())}>{t('import.paste')}</GhostButton>

        {/* Where the phrase or key is in the wallet it comes from: that wallet's two steps. */}
        <h2 className="add-wallet-guide-title">{t('addWallet.whereTitle')}</h2>
        <div className="add-wallet-guides">
          {IMPORT_WALLETS.filter((w) => w.logo).map((w) => (
            <button
              key={w.id}
              type="button"
              aria-expanded={guide === w.id}
              onClick={() => setGuide((g) => (g === w.id ? null : w.id))}
              className={cx('add-wallet-guide', guide === w.id && 'is-open')}
            >
              <img src={`${import.meta.env.BASE_URL}${w.logo}`} alt="" className="add-wallet-guide-logo" />
              <span>{w.name}</span>
              <ChevronDownIcon className="add-wallet-guide-chev" />
            </button>
          ))}
        </div>
        {open && (
          <ol className="add-wallet-steps">
            <li>{t(`importWallet.${open.id}.s1`)}</li>
            <li>{t(`importWallet.${open.id}.s2`)}</li>
          </ol>
        )}

        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton disabled={!valid || preparing} onClick={submit}>
            {preparing ? <Spinner /> : t('common.continue')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <form
      className="scr screen col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!store.busy) void store.addWalletToDevice(name);
      }}
    >
      <ScreenHeader title={t('addWallet.nameTitle')} desc={t('addWallet.nameDesc')} onBack={store.goBack} />
      <Field label={t('addWallet.nameLabel')} value={name} onChange={(v) => setName(v.slice(0, NAME_MAX_LEN))} />
      {!store.draftHasMnemonic && <Notice className="add-wallet-note">{t('addWallet.keyOnly')}</Notice>}
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={store.busy} onClick={() => void store.addWalletToDevice(name)}>
          {store.busy ? <Spinner /> : t('addWallet.cta')}
        </PrimaryButton>
      </div>
    </form>
  );
}

