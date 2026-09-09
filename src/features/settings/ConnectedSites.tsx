import { useCallback, useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { listApprovedOrigins, revokeApprovedOrigins } from '@/lib/dappOrigins';
import { buildKind } from '@/lib/platform';
import { cx } from '@/lib/cx';
import '@/styles/features/settings/connected-sites.css';

/**
 * Sites allowed to read the wallet's public address without asking again.
 *
 * The approval window grants an origin on "Connect" and never had anything to take
 * it back, so the grant list only grew.
 *
 * Shown on the two builds a website can actually reach — the extension, and the hosted
 * web build now that `src/lib/webSigner.ts` gives a page a way to ask. It stays hidden
 * in the Tauri windows, which no origin can address, so the section is absent rather
 * than permanently empty.
 */
export function ConnectedSites({ store }: { store: WalletStore }) {
  const t = store.t;
  const kind = buildKind();
  const grantable = kind === 'ext' || kind === 'web';
  const [origins, setOrigins] = useState<string[] | null>(null);

  useEffect(() => {
    if (!grantable) return;
    void listApprovedOrigins().then(setOrigins);
  }, [grantable]);

  const flash = store.flash;
  const revoke = useCallback(
    async (origin?: string) => {
      setOrigins(await revokeApprovedOrigins(origin));
      flash(t('settings.sitesRevoked'), 'ok');
    },
    [flash, t],
  );

  if (!grantable || origins === null) return null;

  return (
    <SettingsSection title={t('settings.sites')}>
      <p className="desc connected-sites-desc">{t('settings.sitesDesc')}</p>
      {!origins.length ? (
        <div className="glass connected-sites-empty">{t('settings.sitesNone')}</div>
      ) : (
        <>
          {origins.map((o, i) => (
            <div key={o} className={cx('glass row between connected-sites-row', i === origins.length - 1 && 'is-last')}>
              <span className="min0 connected-sites-host">{o}</span>
              <button type="button" onClick={() => void revoke(o)} className="connected-sites-revoke">
                {t('settings.revoke')}
              </button>
            </div>
          ))}
          {origins.length > 1 && (
            <button type="button" onClick={() => void revoke()} className="connected-sites-revoke-all">
              {t('settings.revokeAll')}
            </button>
          )}
        </>
      )}
    </SettingsSection>
  );
}
