import { useEffect, useMemo } from 'react';
import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { NetworkDropdown } from '@/features/wallet/NetworkDropdown';
import { SurfaceToggle } from '@/features/wallet/SurfaceToggle';
import { HomeAction } from '@/features/wallet/HomeAction';
import { HomeTabs } from '@/features/wallet/HomeTabs';
import { ActivateCard } from '@/features/wallet/ActivateCard';
import { ProtectAccountCard } from '@/features/wallet/ProtectAccountCard';
import { Icon } from '@/ui/Icon';
import { Spinner } from '@/ui/Spinner';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import { chainRows, computePortfolio } from '@/lib/portfolio';
import { fmt, splitMoney, pct } from '@/lib/format';
import { getGreeting, ageFromBirthdate, salutationLead } from '@/lib/greeting';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { buildKind } from '@/lib/platform';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/home.css';

/** Cap a name to `max` chars, cutting back to its last vowel so it reads naturally
 *  (e.g. "Wolfeschlegelstein" -> "Wolfeschlege"). Short names pass through intact. */
function shortName(name: string, max = 12): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  const m = cut.match(/^.*[aeiouáéíóúàèìòùâêîôûäëïöü]/i);
  return m ? m[0] : cut;
}

/** An operation this recent lights the dot on the bell. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/* ------------------------------- HOME -------------------------------- */
/**
 * The Figma design's Home: the avatar with the greeting and the name, the bell and the
 * settings disc; the current balance with its move; four actions (Send, Receive, Exchange,
 * More); then the Assets / Activity / Performance / Watchlist panels. Every chain the phrase
 * holds is one list and one total.
 */
export function Home({ store }: { store: WalletStore }) {
  const t = store.t;
  const extra = chainRows(store.chainHoldings, store.chainNet, store.prices);
  const { total, rows, changePct, deltaUsd } = computePortfolio(store.account, store.prices, store.network.id, extra);
  // Every portfolio number eases towards its live value, so price fluctuations
  // visibly tick up/down instead of jumping (colors/arrows follow the real target).
  const money = splitMoney(useAnimatedNumber(total));
  const shownPct = useAnimatedNumber(changePct);
  const shownDelta = useAnimatedNumber(deltaUsd);
  const notActivated = store.account && !store.account.exists;
  // Offered only when both recovery servers answer — see `recoveryReachable`.
  const recoveryUp = useRecoveryReachable(store.network) === true;
  // Memoized: getGreeting picks a random salutation — keep it stable across renders
  // (a fresh one only on app open / language change).
  const greeting = useMemo(
    () => getGreeting(store.meta?.name ?? '', store.meta?.birthdate ?? '', store.t, store.meta?.gender),
    [store.meta?.name, store.meta?.birthdate, store.t, store.meta?.gender],
  );
  // Header shows the name: first word only, and if still too long it's cut at
  // its LAST VOWEL within the limit so the short form reads naturally.
  const firstName = shortName((store.meta?.name || 'Cosmos').trim().split(/\s+/)[0]);
  // Fiat on/off-ramp is 18+ only (unknown/missing birthdate counts as not eligible).
  const fiatOk = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;
  const fiatReady = Boolean(store.meta?.cosmosPayReceiverId);
  const openRamp = (screen: 'deposit' | 'withdraw') => {
    // First-time users enter the KYC flow; verified users reach the money flow
    // directly from Home, so BlindPay is no longer hidden behind Settings.
    store.setScreen(fiatReady ? screen : 'fiat');
  };
  // Recent activity feeds the bell's dot and the Activity panel; it follows the wallet and
  // the network.
  const loadHistory = store.loadHistory;
  useEffect(() => {
    loadHistory();
  }, [loadHistory, store.meta?.id, store.network.id]);
  const latest = store.history[0]?.createdAt;
  const recent = !!latest && Date.now() - new Date(latest).getTime() < RECENT_MS;
  const up = changePct >= 0;
  const ext = buildKind() === 'ext';

  return (
    <div className="scr screen home-screen pb-110">
      {/* The ambient glow behind the balance — decoration only. */}
      <div className="aurora" aria-hidden="true" />

      <header className="home-head">
        <button type="button" onClick={() => store.go('profile', 'profile')} className="home-avatar" aria-label={t('tab.profile')}>
          <img
            src={store.meta?.avatar || `${import.meta.env.BASE_URL}brand/cosmos-avatar.png`}
            alt=""
            className={cx('home-avatar-img', !store.meta?.avatar && 'is-brand')}
            draggable={false}
          />
        </button>
        <button type="button" onClick={() => store.go('profile', 'profile')} className="home-greet">
          <span className="home-salutation">{salutationLead(greeting.salutation)}</span>
          <span className="home-firstname">
            {firstName}
            <Icon name="chevron-right" size={24} className="home-firstname-chev" />
          </span>
        </button>
        <span className="f1" />
        {store.loading && <Spinner size={15} tone="dim" />}
        {ext && <SurfaceToggle store={store} />}
        <button type="button" onClick={() => store.setScreen('history')} className="home-disc" aria-label={t('history.title')}>
          <Icon name="bell" size={20} />
          {recent && (
            <span className="home-bell-dot" aria-hidden="true">
              <span className="home-bell-ping" />
            </span>
          )}
        </button>
        {ext ? (
          <NavMenu store={store} />
        ) : (
          <button type="button" onClick={() => store.setScreen('settings')} className="home-disc" aria-label={t('profile.settings')}>
            <Icon name="settings" size={20} />
          </button>
        )}
      </header>

      <section className="home-balance">
        <div className="home-balance-top">
          <span className="home-balance-label">{t('home.currentBalance')}</span>
          <NetworkDropdown store={store} align="right" />
        </div>
        <div className="home-total" aria-live="polite">
          {money.whole}
          <span className="home-cents">{money.cents}</span>
        </div>
        {/* 24h change of the WHOLE portfolio: percentage + USD difference vs yesterday,
            green when up / red when down. */}
        <div className={cx('home-change', up ? 'is-up' : 'is-down')}>
          <Icon name={up ? 'trend-up' : 'trend-down'} size={16} className="home-change-icon" />
          <span className="home-change-pct">{pct(shownPct)}</span>
          <span className="home-change-delta">
            {deltaUsd >= 0 ? '+' : '−'}${fmt(Math.abs(shownDelta), 2)}
          </span>
          <span className="home-change-when">{t('home.today24h')}</span>
        </div>
      </section>

      <div className="home-actions">
        <HomeAction index={0} label={t('common.send')} icon="send" onClick={() => store.setScreen('send')} />
        <HomeAction index={1} label={t('common.receive')} icon="receive" onClick={() => store.setScreen('receive')} />
        <HomeAction index={2} label={t('home.exchange')} icon="exchange" onClick={() => store.setScreen('swap')} />
        <HomeAction index={3} label={t('home.more')} icon="more" onClick={() => store.go('more', 'more')} />
      </div>

      {notActivated && <ActivateCard store={store} />}
      {/* Recovery can only go on a funded account. The card itself decides from the ledger. */}
      {!notActivated && recoveryUp && <ProtectAccountCard store={store} />}
      <HomeTabs store={store} rows={rows} />

      {/* The offers sit under the portfolio, not between the balance and it: the design puts
          the holdings right under the actions. */}
      {/* Fiat entry is age-gated: only shown to 18+ users (see fiatOk above). */}
      {fiatOk && (
        <section className="home-ramp" aria-label={t('fiat.rampTitle')}>
          <div className="home-ramp-head">
            <div>
              <div className="home-ramp-kicker">{t('fiat.rampActive')} · BLINDPAY</div>
              <div className="home-ramp-title">{t('fiat.rampTitle')}</div>
            </div>
            <span className="home-ramp-network">STELLAR</span>
          </div>
          <div className="home-ramp-desc">{t('fiat.entryDesc')}</div>
          <div className="home-ramp-actions">
            <button onClick={() => openRamp('deposit')} className="home-ramp-buy">
              <Icon name="arrow-down" size={16} />
              {t('fiat.buy')}
            </button>
            <button onClick={() => openRamp('withdraw')} className="home-ramp-sell">
              <Icon name="arrow-up" size={16} />
              {t('fiat.cashOut')}
            </button>
          </div>
          {!fiatReady && <div className="home-ramp-note">{t('fiat.rampSetup')}</div>}
        </section>
      )}

      {!store.cosmosPay && !!store.meta?.email && <EnableReceivingCard store={store} />}
    </div>
  );
}
