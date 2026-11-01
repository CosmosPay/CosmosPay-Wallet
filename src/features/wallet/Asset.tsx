import type { WalletStore } from '@/state/store';
import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { ExternalLink } from '@/ui/ExternalLink';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { TrendDownIcon, TrendUpIcon } from '@/ui/Icons';
import { computePortfolio } from '@/lib/portfolio';
import { fmt, trim, pct } from '@/lib/format';
import { explorerAccountUrl } from '@/lib/stellar';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/asset.css';

/* --------------------------- ASSET DETAIL ---------------------------- */
/** A Stellar asset: its market price and 24h move, what this wallet holds, and the verbs. */
export function Asset({ store }: { store: WalletStore }) {
  const t = store.t;
  const code = store.selectedAsset || 'XLM';
  const m = assetMeta(code);
  const price = store.prices[code];
  const { rows } = computePortfolio(store.account, store.prices, store.network.id);
  const held = rows.find((r) => r.code === code && !r.chain);

  return (
    <div className="scr screen col pb-30">
      <ScreenHeader title={m.name} desc={`${code} · Stellar`} onBack={store.goBack} />

      <section className="asset-hero" aria-label={t('asset.marketPrice')}>
        <AssetLogo code={code} size={64} />
        <div className="asset-hero-text">
          <p className="asset-price">{price ? '$' + fmt(price.usd, price.usd >= 1 ? 2 : 4) : '—'}</p>
          {price && (
            <p className={cx('asset-change', price.change24h >= 0 ? 'is-up' : 'is-down')}>
              {price.change24h >= 0 ? <TrendUpIcon /> : <TrendDownIcon />}
              {pct(price.change24h)} · {t('home.in24h')}
            </p>
          )}
        </div>
      </section>

      <section className="asset-balance" aria-label={t('asset.balance')}>
        <span className="asset-balance-label">{t('asset.balance')}</span>
        <span className="asset-balance-value">
          {held ? trim(held.amount, 7) : '0'} {code}
        </span>
        <span className="asset-balance-fiat">{held?.value != null ? '≈ $' + fmt(held.value, 2) : '—'}</span>
      </section>

      <div className="asset-actions">
        <PrimaryButton
          onClick={() => {
            store.setSend({ ...store.send, asset: { code, issuer: held?.issuer ?? null } });
            store.setScreen('send');
          }}
        >
          {t('common.send')}
        </PrimaryButton>
        <GhostButton onClick={() => store.setScreen('receive')}>{t('common.receive')}</GhostButton>
      </div>
      {store.publicKey && (
        <ExternalLink href={explorerAccountUrl(store.network, store.publicKey)} className="link-btn asset-explorer">
          {t('asset.explorer')}
        </ExternalLink>
      )}
    </div>
  );
}
