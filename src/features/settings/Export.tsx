import { useState } from 'react';
import type { RevealedBackup, WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
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
  const [pwd, setPwd] = useState('');
  // Held only while this screen is open, and only after the password check.
  const [backup, setBackup] = useState<RevealedBackup | null>(null);
  const [busy, run] = useBusy();
  const [copied, copy] = useCopied();

  const unlock = () =>
    run(async () => {
      // Decrypts on demand with the password just entered — the backup material is
      // not a readable field on the store.
      const result = await store.revealBackup(pwd);
      if (result) setBackup(result);
      else store.flash(t('pwd.label') + ' ✗', 'err');
    });

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

  return (
    <div className="scr screen col pb-30">
      <BackBar title={t('export.title')} onBack={store.goBack} />

      <div className="export-warning">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="export-warning-icon"><path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span className="export-warning-text">
          {t('export.warning')}
        </span>
      </div>

      {!backup ? (
        <>
          {store.passkeyUnlock ? (
            <>
              <div className="export-hint">{t('passkey.exportHint')}</div>
              <div className="kb-dock">
                <PasskeyButton label={t('export.reveal')} busy={busy} onClick={unlockWithPasskey} />
              </div>
            </>
          ) : (
            <>
              <div className="export-hint">
                {t('export.enterPwd')}
              </div>
              <input type="password" value={pwd} placeholder={t('pwd.label')} onChange={(e) => setPwd((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} className="input export-pwd-input" />
              <div className="kb-dock">
                <PrimaryButton disabled={!pwd || busy} onClick={unlock}>{busy ? <Spinner /> : t('export.reveal')}</PrimaryButton>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {mnemonic ? (
            <Reveal title={t('export.phraseTitle')} value={mnemonic} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'phrase'} onCopy={() => copy(mnemonic, 'phrase')} grid />
          ) : (
            <div className="glass export-nophrase">
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
    </div>
  );
}

