import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { IMPORT_WALLETS, type ImportWallet as Wallet } from '@/constants/importWallet';
import { ChoiceCard } from '@/ui/ChoiceCard';
import { PrimaryButton } from '@/ui/Buttons';
import { ImportIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { cx } from '@/lib/cx';
import '@/styles/features/onboarding/import.css';
import '@/styles/features/onboarding/import-wallet.css';

/**
 * Bring an account from another Stellar wallet: pick it by its logo, follow ITS steps to the
 * phrase or the secret key, paste it here. Two steps, each a stop on the navigation stack
 * (the list, then one wallet's guide), so back returns to the list.
 *
 * No wallet hands a page its secret — that is how they keep it — so this is a guide, and the
 * paste goes through the same import as "Con mis 12 palabras": the key is derived and sealed
 * here, and stays on this device.
 */
export function ImportWallet({ store }: { store: WalletStore }) {
  const t = store.t;
  const wallet = IMPORT_WALLETS.find((w) => w.id === store.navStep);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = (w: Wallet) => (w.id === 'other' ? t('importWallet.other') : w.name);
  const logo = (w: Wallet) =>
    w.logo ? (
      <img className="import-wallet-logo" src={`${import.meta.env.BASE_URL}${w.logo}`} alt="" />
    ) : (
      <ImportIcon />
    );

  if (!wallet) {
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('importWallet.title')} desc={t('importWallet.desc')} onBack={store.goBack} />
        <div className="col g12">
          {IMPORT_WALLETS.map((w) => (
            <ChoiceCard
              key={w.id}
              icon={logo(w)}
              title={nameOf(w)}
              desc={t(w.secret === 'phrase' ? 'importWallet.withPhrase' : w.secret === 'key' ? 'importWallet.withKey' : 'importWallet.withEither')}
              onClick={() => {
                setText('');
                store.goStep(w.id);
              }}
              className={cx('import-wallet-card', w.logo && 'has-logo')}
            />
          ))}
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await store.importFromText(text);
    setBusy(false);
  };
  const paste = wallet.secret === 'phrase' ? 'importWallet.pastePhrase' : wallet.secret === 'key' ? 'importWallet.pasteKey' : 'importWallet.pasteEither';

  return (
    <div className="scr screen col">
      <ScreenHeader title={nameOf(wallet)} desc={t('importWallet.stepsDesc', { wallet: nameOf(wallet) })} onBack={store.goBack} />
      <div className={cx('import-wallet-badge', wallet.logo && 'has-logo')} aria-hidden="true">
        {logo(wallet)}
      </div>
      <ol className="import-wallet-steps">
        {[`importWallet.${wallet.id}.s1`, `importWallet.${wallet.id}.s2`, paste].map((key, i) => (
          <li key={key} className="import-wallet-step">
            <span className="import-wallet-step-n" aria-hidden="true">
              {i + 1}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ol>
      <label className="field">
        <div className="field-label">{t('importWallet.field')}</div>
        <textarea
          value={text}
          onChange={(e) => setText((e.target as HTMLTextAreaElement).value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="import-textarea"
        />
      </label>
      {wallet.secret !== 'key' && <Notice className="import-wallet-notice">{t('importWallet.manyAccounts')}</Notice>}
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!text.trim() || busy} onClick={() => void submit()}>
          {busy ? <Spinner /> : t('importWallet.import')}
        </PrimaryButton>
      </div>
    </div>
  );
}
