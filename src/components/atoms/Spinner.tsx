export function Spinner({ size = 18, color = 'var(--primary-text)' }: { size?: number; color?: string }) {
  // size/color are the dynamic bits; the shell lives in .spinner (app.css)
  return <span className="spinner" style={{ width: `${size}px`, height: `${size}px`, color }} />;
}
