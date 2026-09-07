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
 * `ui/ExternalLink.tsx` calls this ONLY under Tauri — a browser tab opens its own tabs, and
 * taking that over would lose middle-click and "copy link address". The `window.open` half
 * below therefore serves exactly one caller: the Pollar login in `state/store.ts`, which
 * has no anchor to click because its URL does not exist until a handshake has been opened.
 * That is also why `reserveExternalTab` exists — see its own header.
 *
 * `features/extras/ScanQR.tsx` deliberately does NOT come through here. Its `window.open`
 * targets `chrome.runtime.getURL('camera.html')` — an extension page, on a build that has
 * no Tauri runtime and no OS opener, and a scheme the https rule below would refuse anyway.
 */
import { isExtension, isTauri } from '@/lib/platform';

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

/**
 * Sever `opener` on a tab we opened, so the page cannot reach back into the document
 * holding the session. Setting it to null disowns the browsing context permanently, which
 * survives the navigation that follows.
 *
 * This is done by hand rather than through the `noopener` window feature because that
 * feature makes `window.open` return null BY SPEC — the same answer a blocked popup gives.
 * With both meaning null there is no way to tell an opened tab from a refused one, and the
 * login reported every successful open as a failure, told the user to copy the link, and
 * meant the one signal that a popup blocker had fired could never be trusted.
 */
function disown(win: Window): void {
  try {
    win.opener = null;
  } catch {
    /* Already navigated cross-origin: the handle is opaque and reaches nothing anyway. */
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
    const win = window.open(url, '_blank');
    if (!win) return false;
    disown(win);
    return true;
  } catch {
    return false;
  }
}

/** A tab claimed before its URL was known. `open` points it somewhere; `cancel` gives it back. */
export interface ExternalTab {
  /** Send the reserved tab to `url`. False when nothing could be opened at all. */
  open(url: string): Promise<boolean>;
  /** Close the tab unused — the flow that reserved it failed before it had a URL. */
  cancel(): void;
}

/**
 * Claim a tab NOW, for a URL that is still a network round trip away.
 *
 * A popup blocker asks one question: did THIS `window.open` have a user gesture behind it?
 * The Pollar login cannot answer it at the point where it has a URL — the authorization URL
 * only exists once the bridge has opened a handshake — and the gesture does not wait for
 * the round trip: Chrome keeps it for about five seconds, WebKit and Gecko spend it on the
 * first `await`. The login therefore worked on one engine and silently opened nothing on
 * the others, leaving the wallet polling for a browser the user was never sent to.
 *
 * So the tab is taken while the click is still on the stack and pointed at the URL when it
 * arrives. **Call this before the first `await` of the handler**, or it reserves nothing —
 * the point of the whole function is which task it runs in.
 */
export function reserveExternalTab(): ExternalTab {
  // Tauri hands the URL to the OS: no popup blocker, no gesture to spend, no tab to hold.
  //
  // The extension opts out for the opposite reason — opening a tab is what DISMISSES an
  // MV3 popup, and the popup is the process. Reserving one up front would tear the
  // document down before the authorization came back, losing the handshake that is the
  // only handle on the login: strictly worse than a refused popup, which at least leaves
  // a copyable link behind. There it stays what it was, opened last, after the handshake
  // is on disk — and an extension page is not what a popup blocker is aimed at anyway.
  if (isTauri() || isExtension()) return { open: openExternal, cancel: () => {} };

  let win: Window | null = null;
  try {
    win = window.open('', '_blank');
  } catch {
    win = null;
  }
  if (win) disown(win);

  const cancel = (): void => {
    try {
      win?.close();
    } catch {
      /* The user closed it first. */
    }
    win = null;
  };

  return {
    open: async (url) => {
      if (!isSafeUrl(url)) {
        cancel();
        return false;
      }
      // Nothing was reserved, or the user closed the blank tab: one late attempt, which a
      // browser still inside its activation window will honour and the others will refuse
      // — and a refusal is now reported as one, which is what the copy-link fallback needs.
      if (!win || win.closed) return openExternal(url);
      try {
        // `replace`, so the blank page is not a history entry the user has to walk back
        // through to leave the login.
        win.location.replace(url);
        return true;
      } catch {
        return openExternal(url);
      }
    },
    cancel,
  };
}
