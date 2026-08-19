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
    } catch (err) {
      // A DISMISSED sheet was handled — the user said no, and copying behind their back
      // would be worse than doing nothing. Anything else means no sheet ever appeared (no
      // Activity to receive the intent, a permission refusal), and reporting that as
      // "handled" is what made the button do nothing at all: the caller skipped its
      // clipboard fallback because this said the share had happened.
      if (!wasCancelled(err)) return false;
    }
    return true;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share(title ? { title, text } : { text });
      return true;
    }
  } catch (err) {
    // A cancelled Web Share rejects with AbortError; same reasoning as above.
    return wasCancelled(err);
  }
  return false;
}

/**
 * Did the user dismiss the sheet, as opposed to the sheet never opening?
 *
 * `AbortError` is the standard name for a dismissed Web Share and is what Capacitor's iOS
 * bridge forwards. Android's plugin has no code for it and rejects with the message
 * "Share canceled", so the string is checked as a fallback only — never as the primary
 * signal, and never for anything the caller branches on beyond this one boolean.
 */
function wasCancelled(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null;
  if (e?.name === 'AbortError') return true;
  return typeof e?.message === 'string' && /cancel/i.test(e.message);
}
