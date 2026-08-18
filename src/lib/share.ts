/** Cross-platform share sheet (Capacitor on native, Web Share on the browser). */
import { Capacitor } from '@capacitor/core';

/**
 * Hand `text` to the OS share sheet. Returns false when there is none, so the caller can fall
 * back to copying — every call site here does.
 *
 * The web check is not redundant with the native one: an Android WebView does **not** implement
 * `navigator.share`, so the phone — the one platform with a real share sheet — was the platform
 * that silently fell back to the clipboard. `Share` is imported dynamically, like the clipboard
 * and preferences plugins, so the extension and web bundles never pay for the native path.
 */
export async function shareText(text: string, title?: string): Promise<boolean> {
  // `isPluginAvailable` first, and not merely `isNativePlatform`: a build synced before the
  // plugin was installed still runs the native path, and there the rejection means "no share
  // sheet exists" rather than "the user closed it" — the one case that must still fall back.
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share')) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text });
    } catch {
      // Dismissing the sheet rejects ("Share canceled") rather than resolving. Reporting that
      // as a failure would copy behind the user's back; it was handled, they said no.
    }
    return true;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share(title ? { title, text } : { text });
      return true;
    }
  } catch {
    // A cancelled Web Share rejects with AbortError; same reasoning as above.
    return true;
  }
  return false;
}
