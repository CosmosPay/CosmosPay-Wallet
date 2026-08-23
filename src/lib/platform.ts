/**
 * Detect how this build is running: web page, browser extension, desktop app or mobile app.
 *
 * Three of those four are Tauri or nothing: the wallet ships one `astro build` output that
 * is served as a web page, packed into an MV3 extension, and embedded by Tauri on the five
 * OSes. Nothing here asks a bundler flag — the same bundle has to answer correctly in every
 * host it is dropped into, so every answer comes from the host itself.
 */

export type BuildKind =
  | 'web' // a browser tab, including the dev server
  | 'ext' // MV3 popup / side panel
  | 'app' // Tauri on Android or iOS
  | 'desktop'; // Tauri on Windows, macOS or Linux

/** Every value `tauri-plugin-os` reports. `platformName()` narrows this for display. */
export type OsName =
  | 'android'
  | 'ios'
  | 'linux'
  | 'macos'
  | 'windows'
  | 'freebsd'
  | 'dragonfly'
  | 'netbsd'
  | 'openbsd'
  | 'solaris';

const MOBILE: readonly OsName[] = ['android', 'ios'];

/**
 * The two globals Tauri v2 injects before the page's first script runs.
 *
 * `__TAURI_INTERNALS__` is the IPC entry point and exists in every Tauri window;
 * `__TAURI_OS_PLUGIN_INTERNALS__` is written by `tauri-plugin-os` at startup and carries
 * the OS the Rust side compiled for.
 *
 * Both are read directly rather than through `@tauri-apps/api` / `@tauri-apps/plugin-os`,
 * for the reason `lib/deviceAuth.ts` mirrors the biometric enums as plain numbers: an
 * import would put a Tauri module in the web and extension bundles, which have no host to
 * answer it, and `platform()` from the official package is nothing but this property read.
 * It is the plugin's documented wire contract, not an internal detail — its own JS binding
 * is generated from it.
 */
interface TauriGlobals {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: unknown };
}

const tauriGlobals = (): TauriGlobals => (typeof window === 'undefined' ? {} : (window as unknown as TauriGlobals));

/** Is a Tauri runtime hosting this document? */
export function isTauri(): boolean {
  return tauriGlobals().__TAURI_INTERNALS__ != null;
}

/**
 * The OS, as the RUNTIME reports it — never inferred from the user agent.
 *
 * `null` off Tauri, and null is the honest answer there: a WebView's user agent is a
 * string the page is handed, and every security decision in this app that depends on the
 * platform (`deviceAuthPossible`) has to fail closed on "I do not know" rather than on a
 * guess. See the header on `lib/deviceAuth.ts` for what that gate is protecting.
 */
export function osName(): OsName | null {
  const raw = tauriGlobals().__TAURI_OS_PLUGIN_INTERNALS__?.platform;
  return typeof raw === 'string' ? (raw as OsName) : null;
}

export function buildKind(): BuildKind {
  if (typeof window === 'undefined') return 'web';
  const proto = window.location.protocol;
  if (proto === 'chrome-extension:' || proto === 'moz-extension:' || proto === 'extension:') return 'ext';
  if (!isTauri()) return 'web';
  const os = osName();
  // A Tauri window whose OS plugin did not answer is still a Tauri window, and calling it
  // 'web' would hand it the same-origin API paths that only the dev proxy serves. Desktop
  // is the safe reading: it is the kind with no extra capability attached to it.
  return os && MOBILE.includes(os) ? 'app' : 'desktop';
}

/** Running on a phone or tablet — the only build with a lock screen in reach. */
export const isMobileApp = (): boolean => buildKind() === 'app';

/** Running in a desktop window: Windows, macOS or Linux. */
export const isDesktopApp = (): boolean => buildKind() === 'desktop';

/**
 * Platform name for display (the About screen). Never a decision — `buildKind()` and
 * `osName()` are what code branches on.
 */
export function platformName(): string {
  return osName() ?? 'web';
}
