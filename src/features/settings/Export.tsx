import { useId, useState } from 'react';
import type { RevealedBackup, WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { LockIcon, WarningIcon } from '@/ui/Icons';
import { Spinner } from '@/ui/Spinner';
import { Reveal } from '@/features/settings/Reveal';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { useBusy } from '@/hooks/useBusy';
import { useCopied } from '@/hooks/useCopied';
import '@/styles/features/settings/export.css';

/* ------------------------------ EXPORT ------------------------------ */
/**
 * Every key the wallet holds, behind one password check: the phrase (which restores all of
 * them at once), then each chain's own key in the form its reference wallet imports —
 * Stellar's S…, Solana's base58 keypair for Phantom, Monad's 0x key for MetaMask.
 */
export function Export({ store }: { store: WalletStore }) {
  const t = store.t;
  const passwordId = useId();
  const [pwd, setPwd] = useState('');
  // Held only while this screen is open, and only after the password check.
  const [backup, setBackup] = useState<RevealedBackup | null>(null);
  const [busy, run] = useBusy();
  const [copied, copy] = useCopied();

  const unlock = () => {
    if (!pwd || busy) return;
    return run(async () => {
      // Decrypts on demand with the password just entered — the backup material is
      // not a readable field on the store.
      const result = await store.revealBackup(pwd);
      if (result) { setBackup(result); setPwd(''); }
      else store.flash(t('pwd.label') + ' ✗', 'err');
    });
  };

  // A passkey device has no password to type here; the passkey stands in for it. Null means
  // the store already said why (a dismissed sheet says nothing at all).
  const unlockWithPasskey = () =>
    run(async () => {
      const result = await store.revealBackupWithPasskey();
      if (result) setBackup(result);
    });

  const mnemonic = backup?.mnemonic ?? null;
  const secret = backup?.secret ?? '';
  const chainKeys = backup?.chainKeys ?? null;
  const networksPhrase = backup?.networksPhrase ?? null;

  return (
    <form className="scr screen col pb-30 export-screen" onSubmit={(event) => { event.preventDefault(); if (!backup && !store.passkeyUnlock) void unlock(); }}>
      <ScreenHeader title={t('export.title')} onBack={store.goBack} />

      <div className="export-warning">
        <WarningIcon className="export-warning-icon" />
        <span className="export-warning-text">
          {t('export.warning')}
        </span>
      </div>

      {!backup ? (
        <>
          {store.passkeyUnlock ? (
            <>
              <p className="export-hint">{t('passkey.exportHint')}</p>
              <div className="kb-dock">
                <PasskeyButton label={t('export.reveal')} busy={busy} onClick={unlockWithPasskey} />
              </div>
            </>
          ) : (
            <>
              <p className="export-hint" id={`${passwordId}-hint`}>{t('export.enterPwd')}</p>
              <label htmlFor={passwordId} className="export-pwd-label">{t('pwd.label')}</label>
              <input id={passwordId} type="password" value={pwd} autoComplete="current-password"
                aria-describedby={`${passwordId}-hint`} required
                onChange={(event) => setPwd(event.target.value)} className="input export-pwd-input" />
              <div className="kb-dock">
                <button type="submit" className="btn-primary ink" disabled={!pwd || busy} aria-busy={busy}>
                  {busy ? <Spinner /> : <LockIcon />}{t('export.reveal')}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {mnemonic ? (
            <Reveal title={t('export.phraseTitle')} value={mnemonic} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'phrase'} onCopy={() => copy(mnemonic, 'phrase')} grid />
          ) : networksPhrase ? (
            <>
              <Reveal title={t('export.networksPhraseTitle')} value={networksPhrase} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'networks'} onCopy={() => copy(networksPhrase, 'networks')} grid />
              <div className="export-compat">{t('export.networksPhraseDesc')}</div>
            </>
          ) : (
            <div className="export-nophrase">
              {t('export.noPhrase')}
            </div>
          )}
          {mnemonic && <div className="export-compat">{t('export.phraseRestoresAll')}</div>}
          <Reveal title={t('export.secretTitle')} value={secret} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'secret'} onCopy={() => copy(secret, 'secret')} />
          <div className="export-compat">
            {t('export.compat')}
          </div>
          {chainKeys && (
            <>
              <Reveal title={t('export.solanaTitle')} value={chainKeys.solana} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'solana'} onCopy={() => copy(chainKeys.solana, 'solana')} />
              <div className="export-compat">{t('export.solanaCompat')}</div>
              <Reveal title={t('export.monadTitle')} value={chainKeys.monad} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'monad'} onCopy={() => copy(chainKeys.monad, 'monad')} />
              <div className="export-compat">{t('export.monadCompat')}</div>
            </>
          )}
        </>
      )}
    </form>
  );
}

