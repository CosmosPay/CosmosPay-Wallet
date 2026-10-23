/**
 * The installable web app: the service worker that makes the wallet open offline and
 * install from the browser, and the launch shortcuts the web manifest declares.
 *
 * Web build only. The extension has its own worker (`extension-src/sw.js`), a Tauri window
 * serves the bundle from its own scheme, and in `astro dev` a worker would cache files Vite
 * is still rewriting — so `buildKind()` and a production build both have to agree first.
 */
import { buildKind } from '@/lib/platform';

/** The worker under `public/`, served next to the page whatever the base path is. */
const WORKER = 'sw-web.js';

/**
 * Register the app-shell worker. Best effort: a browser without service workers, a private
 * window that refuses one, or a host serving the page over plain http simply keeps working
 * online, which is how it worked before this existed.
 */
export function registerWebServiceWorker(): void {
  if (buildKind() !== 'web' || !import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const url = `${import.meta.env.BASE_URL}${WORKER}`;
  navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch(() => {});
}

/** The screens a manifest shortcut (`?go=…`) may open. Anything else is ignored. */
export type LaunchTarget = 'receive' | 'swap' | 'send' | 'scan';
const TARGETS: readonly LaunchTarget[] = ['receive', 'swap', 'send', 'scan'];

/**
 * The screen a launch shortcut asked for, read ONCE: the parameter is removed from the
 * address bar as it is read, so a reload or a back navigation does not open it again.
 */
export function takeLaunchTarget(): LaunchTarget | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const go = url.searchParams.get('go');
  if (!go) return null;
  url.searchParams.delete('go');
  window.history.replaceState(window.history.state, '', url.toString());
  return (TARGETS as readonly string[]).includes(go) ? (go as LaunchTarget) : null;
}
