import { cx } from '@/lib/cx';
import '@/styles/ui/icon.css';

/**
 * Every icon the app draws, by name. The glyphs are SVG files under `public/icons/ui/`:
 * the ones the Figma design defines are its own exports, byte for byte, and the rest are
 * Lucide (ISC) — the set the design itself is drawn from, so the two read as one family.
 *
 * Rendered as a CSS MASK, not an <img>: the file supplies only the shape and the element's
 * `color` paints it, so an icon follows the theme, a hover state and a disabled state like
 * text does — none of which an <img> of a white stroke can.
 */
export type IconName =
  // from the Figma file
  | 'menu'
  | 'cards'
  | 'wallet'
  | 'home'
  | 'more'
  | 'exchange'
  | 'receive'
  | 'send'
  | 'trend-up'
  | 'chevron-right'
  | 'copy'
  | 'back'
  | 'settings'
  // Lucide
  | 'bell'
  | 'sent'
  | 'arrow-up'
  | 'arrow-down'
  | 'star'
  | 'chart'
  | 'chart-bars'
  | 'trend-down'
  | 'plus'
  | 'check'
  | 'close'
  | 'external'
  | 'share'
  | 'lock'
  | 'shield'
  | 'globe'
  | 'search'
  | 'refresh'
  | 'bank'
  | 'layers'
  | 'link'
  | 'eye'
  | 'eye-off'
  | 'clock'
  | 'sparkles'
  | 'user'
  | 'chevron-down'
  | 'chevron-left'
  | 'qr'
  | 'scan'
  | 'coins'
  | 'earn'
  | 'liquidity'
  | 'info'
  | 'alert'
  | 'fingerprint'
  | 'key'
  | 'logout'
  | 'zap'
  | 'gift'
  | 'dollar'
  | 'wallet-cards'
  | 'swap'
  | 'history'
  | 'sliders'
  | 'network'
  | 'banknote'
  | 'hand-coins'
  | 'verified'
  | 'success'
  | 'rocket'
  | 'flame'
  | 'minus';

/** The sizes the sheet defines — an unsupported size is a compile error, not a missing style. */
export type IconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24 | 28 | 32;

export function Icon({ name, size = 20, className }: { name: IconName; size?: IconSize; className?: string }) {
  return <span aria-hidden="true" className={cx('icon', `icon-${name}`, `icon--${size}`, className)} />;
}
