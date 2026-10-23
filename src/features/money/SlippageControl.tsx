import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WalletStore } from '@/state/store';
import { Icon } from '@/ui/Icon';
import { cx } from '@/lib/cx';
import { trim } from '@/lib/format';
import { isHighSlippage, stepSlippage } from '@/lib/slippage';
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS, SLIPPAGE_PRESETS_BPS } from '@/constants/swap';
import '@/styles/features/money/slippage-control.css';

const pctOf = (bps: number) => `${trim(bps / 100, 2)}%`;

/**
 * The swap screens' max slippage: a slim row naming the tolerance in force, and the sheet it
 * opens — a stepper, four presets and "auto" — after the max-slippage sheet in the Dribbble
 * "Crypto Wallet UI Kit · Enhanced Swap" shot.
 *
 * `venueDefault` is what "auto" means on this route, so the row always names a number.
 * The sheet is portalled to <body>: a screen is its own stacking context (its entrance
 * animation), so from inside it no z-index can lift the sheet over the bottom navigation.
 * Saving re-prices: the screens key their quote on `store.slippageBps`, and the signature
 * stays bounded by that quote's minimum received, whatever tolerance produced it.
 */
export function SlippageControl({ store, venueDefault }: { store: WalletStore; venueDefault: number }) {
  const t = store.t;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(store.slippageBps);
  const value = draft ?? venueDefault;
  const current = store.slippageBps ?? venueDefault;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openSheet = () => {
    setDraft(store.slippageBps);
    setOpen(true);
  };
  const save = () => {
    store.setSlippageBps(draft);
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="slippage-row" onClick={openSheet}>
        <span className="slippage-row-icon">
          <Icon name="sliders" size={14} />
        </span>
        <span className="slippage-row-label">{t('slippage.title')}</span>
        <span className="slippage-row-val">
          {store.slippageBps === null ? t('slippage.auto', { pct: pctOf(current) }) : pctOf(current)}
        </span>
        <Icon name="chevron-right" size={14} className="slippage-row-chev" />
      </button>

      {open &&
        createPortal(
          <div className="slippage-overlay" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('slippage.title')}
              className="slippage-sheet"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="slippage-grip" />
              <div className="slippage-title">{t('slippage.title')}</div>
              <p className="slippage-desc">{t('slippage.desc')}</p>

              <div className="slippage-stepper">
                <button
                  type="button"
                  className="slippage-step"
                  aria-label={t('slippage.less')}
                  disabled={value <= SLIPPAGE_MIN_BPS}
                  onClick={() => setDraft(stepSlippage(value, -1))}
                >
                  <Icon name="minus" size={20} />
                </button>
                <span key={value} className={cx('slippage-value', isHighSlippage(value) && 'is-high')}>
                  {pctOf(value)}
                </span>
                <button
                  type="button"
                  className="slippage-step"
                  aria-label={t('slippage.more')}
                  disabled={value >= SLIPPAGE_MAX_BPS}
                  onClick={() => setDraft(stepSlippage(value, 1))}
                >
                  <Icon name="plus" size={20} />
                </button>
              </div>

              <div className="slippage-presets">
                <button
                  type="button"
                  className={cx('chip slippage-preset', draft === null && 'is-on')}
                  onClick={() => setDraft(null)}
                >
                  {t('slippage.autoShort')}
                </button>
                {SLIPPAGE_PRESETS_BPS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={cx('chip slippage-preset', draft === p && 'is-on')}
                    onClick={() => setDraft(p)}
                  >
                    {pctOf(p)}
                  </button>
                ))}
              </div>

              {isHighSlippage(value) && (
                <div className="slippage-warn">
                  <Icon name="alert" size={14} /> {t('slippage.high')}
                </div>
              )}

              <button type="button" className="btn-primary slippage-save" onClick={save}>
                {t('common.save')}
              </button>
              <button type="button" className="btn-ghost slippage-cancel" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
