import { STELLAR_MARK } from '@/components/assetIcons';
import '@/styles/components/stellar-mark.css';

/** The Stellar wordmark/glyph (monochrome) — used by the network selector. */
export function StellarMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="stellar-mark">
      <path d={STELLAR_MARK} fill="currentColor" />
    </svg>
  );
}
