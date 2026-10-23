/** Visual metadata for the assets we know about. */
import type { OtherChain } from '@/constants/chains';

// Monochrome palette: token circles are neutral; the glyph carries the identity.
// `tone` names a .token-avatar--* class instead of a colour string — the app
// keeps every colour in CSS (see CLAUDE.md).

/**
 * Surfaces a token badge can wear — each maps to a `.token-avatar--*` class.
 *
 * Declared here, not in `ui/TokenAvatar`, because the table below is what assigns
 * tones and `constants/` may not import from `ui/`. The component imports it back
 * the other way round, which the layering does allow.
 */
export type TokenAvatarTone = 'base' | 'brand' | 'pool';

export const ASSET_META: Record<string, { name: string; glyph: string; tone: TokenAvatarTone }> = {
  XLM: { name: 'Stellar Lumens', glyph: '✦', tone: 'brand' },
  USDC: { name: 'USD Coin', glyph: '$', tone: 'base' },
  USDB: { name: 'USD BlindPay', glyph: '$', tone: 'base' },
  EURC: { name: 'Euro Coin', glyph: '€', tone: 'base' },
  yXLM: { name: 'yieldXLM', glyph: 'y', tone: 'base' },
  AQUA: { name: 'Aquarius', glyph: 'A', tone: 'base' },
  SOL: { name: 'Solana', glyph: 'S', tone: 'base' },
  MON: { name: 'Monad', glyph: 'M', tone: 'base' },
  USDT: { name: 'Tether USD', glyph: '$', tone: 'base' },
  USDT0: { name: 'USDT0', glyph: '$', tone: 'base' },
  BTC: { name: 'Bitcoin', glyph: '₿', tone: 'base' },
  ETH: { name: 'Ethereum', glyph: 'Ξ', tone: 'base' },
};

/**
 * Colour logos under `public/tokens/`, by asset code. BTC, ETH, SOL and USDT are the Figma
 * design's own exports; the rest are the issuers' marks (cryptocurrency-icons and Trust
 * Wallet's asset repository), resized to 144px. A code with no file falls back to the glyph
 * badge above, so a token the wallet has never heard of still renders as something.
 */
export const TOKEN_LOGO_FILES: Record<string, string> = {
  BTC: 'btc.png',
  ETH: 'eth.png',
  SOL: 'sol.png',
  USDT: 'usdt.png',
  USDT0: 'usdt0.png',
  USDC: 'usdc.png',
  XLM: 'xlm.png',
  MON: 'mon.png',
  EURC: 'eurc.png',
  XRP: 'xrp.png',
};

/**
 * The network badge drawn on a holding's logo, so USDC on Arbitrum and USDC on Solana read
 * as two things at a glance. Keyed by network; Base and Arbitrum carry their own marks
 * because ETH alone would not say which of three chains it is on.
 */
export const CHAIN_LOGO_FILES: Record<'stellar' | OtherChain, string> = {
  stellar: 'xlm.png',
  bitcoin: 'btc.png',
  ethereum: 'eth.png',
  solana: 'sol.png',
  arbitrum: 'arb.png',
  base: 'base.png',
  monad: 'mon.png',
};
