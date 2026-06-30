/** Detect how this build is running: web app, browser extension, or native mobile app. */
export type BuildKind = 'web' | 'ext' | 'app';

export function buildKind(): BuildKind {
  if (typeof window === 'undefined') return 'web';
  const proto = window.location.protocol;
  if (proto === 'chrome-extension:' || proto === 'moz-extension:' || proto === 'extension:') return 'ext';
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.() || proto === 'capacitor:' || proto === 'ionic:') return 'app';
  return 'web';
}

/** Native platform name (android/ios/web) when running under Capacitor. */
export function platformName(): string {
  try {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    if (cap?.getPlatform) return cap.getPlatform();
  } catch {
    /* ignore */
  }
  return 'web';
}
