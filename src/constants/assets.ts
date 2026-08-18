/** Visual metadata for the assets we know about. */
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
};
