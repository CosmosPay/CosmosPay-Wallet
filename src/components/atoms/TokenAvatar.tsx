import '@/styles/components/token-avatar.css';

/** Surfaces a token badge can wear — each maps to a .token-avatar--* class. */
export type TokenAvatarTone = 'base' | 'brand' | 'pool';

/** Diameters that have a .token-avatar--<px> class in token-avatar.css.
 *  Widen this union (and add the class) rather than passing a raw number. */
export type TokenAvatarSize = 20 | 24 | 26 | 28 | 34 | 36 | 38 | 64;

/** Coloured circular token badge. */
export function TokenAvatar({
  glyph,
  tone = 'base',
  size = 38,
}: {
  glyph: string;
  tone?: TokenAvatarTone;
  size?: TokenAvatarSize;
}) {
  return (
    <div className={`token-avatar token-avatar--${tone} token-avatar--${size}`}>{glyph}</div>
  );
}
