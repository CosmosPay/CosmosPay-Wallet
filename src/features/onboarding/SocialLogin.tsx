import { useEffect } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { Spinner } from '@/ui/Spinner';
import { cx } from '@/lib/cx';
import { networkEnv } from '@/lib/stellar';
import { copyText } from '@/lib/clipboard';
import { POLLAR_PROVIDERS, type PollarProvider } from '@/constants/pollar';
import '@/styles/features/onboarding/social-login.css';

/** Display name per provider. Brand names, so not i18n keys — they read the same
 *  in every language, and translating them would be inventing a product. */
const PROVIDER_LABEL: Record<PollarProvider, string> = { google: 'Google', github: 'GitHub' };

/**
 * Sign in with Google or GitHub and get a Stellar account.
 *
 * The screen exists to make one thing unmissable before the user commits: WHO HOLDS THE
 * KEY, which is not the same answer on both networks. On mainnet the account is custodial
 * — a key in Pollar's KMS, no recovery phrase to lose and none to hold, unlike every
 * other wallet in this app. On testnet the wallet generates the seed here and Pollar
 * custodies nothing, because activating a custodied wallet spends the operator's XLM and
 * a faucet network is not worth real lumens. The notice is not a disclaimer pushed to the
 * bottom — it sits above the buttons, because after the consent screen the decision is
 * made, and it says which of the two is happening.
 *
 * The network is the ONLY input to that difference, and the branch that acts on it lives
 * in `state/store.ts`'s `finishSocialLogin`. This screen reads the same `networkEnv` so
 * the promise it makes and the wallet it produces cannot disagree.
 *
 * The flow it drives is the poll flow: the wallet opens Pollar's hosted login in the
 * system browser and asks whether the user has come back. On MV3 that first step closes
 * this popup, which is why `resumePollarLogin` runs on mount — reopening the wallet lands
 * here and picks the same handshake back up rather than starting over.
 *
 * Who is asked depends on what the device holds, and the screen deliberately does not
 * show the difference: a wallet with a CosmosPay key polls the gateway itself, and one
 * without goes through the dev platform, which also creates the account this login will
 * need. There is no longer a state in which this screen can only explain why it cannot
 * proceed — that gate is gone, and with it the copy that described it.
 */
export function SocialLogin({ store }: { store: WalletStore }) {
  const t = store.t;
  const { pollarPhase, pollarUrl, resumePollarLogin } = store;
  const busy = pollarPhase !== 'idle';

  // What the login produces differs by network, so the warning above the buttons has to
  // as well: on mainnet Pollar custodies the key, on testnet the wallet generates one
  // here. Saying "custodial" on both would be a promise the testnet arm does not keep,
  // and this notice is the last thing the user reads before consenting.
  const custodial = networkEnv(store.network) === 'prod';

  // Resume a handshake the popup was closed in the middle of. Runs once per mount and
  // no-ops when there is none, so arriving here fresh costs a storage read.
  useEffect(() => {
    void resumePollarLogin();
  }, [resumePollarLogin]);

  const phaseCopy =
    pollarPhase === 'opening'
      ? t('pollar.opening')
      : pollarPhase === 'waiting'
        ? t('pollar.waiting')
        : pollarPhase === 'redeeming'
          ? t('pollar.redeeming')
          : '';

  return (
    <div className="scr screen col">
      <BackBar title={t('pollar.title')} onBack={store.goBack} />

      <div className="social-login-desc">{t(custodial ? 'pollar.desc' : 'pollar.localDesc')}</div>

      {/* Above the buttons on purpose: after the consent screen the choice is made. */}
      <div className="glass-soft social-login-warning">
        <span className="social-login-warning-badge">
          {t(custodial ? 'pollar.custodialBadge' : 'pollar.localBadge')}
        </span>
        {t(custodial ? 'pollar.custodialWarning' : 'pollar.localWarning')}
      </div>

      <div className="col g8 social-login-actions">
        {POLLAR_PROVIDERS.map((p) => (
          <button
            key={p}
            className={cx('btn-primary', `social-login-btn is-${p}`)}
            disabled={busy}
            onClick={() => void store.pollarLogin(p)}
          >
            {t('pollar.continueWith', { provider: PROVIDER_LABEL[p] })}
          </button>
        ))}
      </div>

      {busy && (
        <div className="row g8 social-login-phase">
          <Spinner tone="text" />
          <span className="f1 min0">{phaseCopy}</span>
          <button className="social-login-cancel" onClick={store.cancelPollarLogin}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* The opener can fail with no error of its own — a WebView with no OS handler,
          a popup blocker on the web build — and the login is then stuck with no way
          forward. Handing over the URL is the only recovery that does not need a new
          handshake, and the handshake is the rate-limited half. */}
      {pollarUrl && pollarPhase === 'waiting' && (
        <button className="social-login-copy" onClick={() => void copyText(pollarUrl)}>
          {t('pollar.copyLink')}
        </button>
      )}
    </div>
  );
}
