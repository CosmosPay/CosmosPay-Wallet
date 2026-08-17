import '@/styles/ui/token-avatar.css';

/** Coloured circular token badge. */
export function TokenAvatar({
  glyph,
  color,
  size = 38,
}: {
  glyph: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="token-avatar"
      style={{
        '--size': `${size}px`,
        '--bg': color,
        '--fsize': `${Math.round(size * 0.46)}px`
      } as React.CSSProperties}
    >
      {glyph}
    </div>
  );
}
