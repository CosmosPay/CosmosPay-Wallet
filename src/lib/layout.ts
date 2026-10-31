/**
 * True while the window is in desktop mode (src/styles/app/shell.css): a desktop-capable
 * build (`.has-desktop-mode`, never the extension) at or past `--desk-min`.
 *
 * Read at the moment of an interaction — which kind of popup a tap opens: a dropdown under
 * its trigger on a desktop, a bottom sheet on a phone column. Layout itself is never
 * switched from JS (see "The desktop mode is chrome" in CLAUDE.md); this only answers a
 * question CSS cannot, at the instant it is asked.
 */
export function isDesktopLayout(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!document.querySelector('.shell-root.has-desktop-mode')) return false;
  const min = getComputedStyle(document.documentElement).getPropertyValue('--desk-min').trim() || '1024px';
  return window.matchMedia(`(min-width: ${min})`).matches;
}
