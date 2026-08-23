/**
 * Open a URL OUTSIDE the wallet.
 *
 * `target="_blank"` is not a way out of a Tauri window: there is no browser chrome to open
 * a tab in, so the engine either ignores the click or — on WebKitGTK and in the Android
 * WebView — follows it IN PLACE. That last one is the reason this module exists rather than
 * an `<a>`: the wallet would navigate itself to a block explorer, and the document holding
 * the unlocked session would be replaced by a remote page. The session dies with it, so it
 * is not a key-disclosure bug; it is still an app that vanishes when you tap a link.
 *
 * Every outbound link goes through `ui/ExternalLink.tsx`, which is what actually calls
 * this: the explorer links on `features/money/Success.tsx` and `features/wallet/Asset.tsx`,
 * and the terms link on `features/onboarding/Backup.tsx`.
 *
 * `features/extras/ScanQR.tsx` deliberately does NOT come through here. Its `window.open`
 * targets `chrome.runtime.getURL('camera.html')` — an extension page, on a build that has
 * no Tauri runtime and no OS opener, and a scheme the https rule below would refuse anyway.
 */
import { isTauri } from '@/lib/platform';

/**
 * Only `https:` leaves the app, and the scheme is checked HERE rather than at the call
 * sites because this is the boundary the URL crosses.
 *
 * Two of the three callers build their URL from network configuration the user can edit
 * (a custom Horizon entry carries its own explorer base), so "the app wrote it" is not the
 * same as "the app chose it". Handing an arbitrary scheme to the OS opener is how a
 * `file:` or a platform-specific scheme becomes a launched program; an unopenable link is
 * a far better outcome than that.
 */
function isSafeUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<boolean> {
  if (!isSafeUrl(url)) return false;
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return true;
    } catch {
      return false;
    }
  }
  try {
    // `noopener` matters even here: without it the opened page gets a live `window.opener`
    // handle on the document holding the session.
    return window.open(url, '_blank', 'noopener,noreferrer') !== null;
  } catch {
    return false;
  }
}
