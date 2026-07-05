import '@/styles/components/logo.css';

/** Brand logo (white asset; CSS inverts it to black in light mode). No frame. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <img
      src="/logo-white.png"
      className="brand-logo logo-img"
      width={size}
      height={size}
      alt="Cosmos"
      draggable={false}
    />
  );
}
