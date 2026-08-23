/** Cross-platform share sheet (the native plugin on mobile, Web Share in a browser). */
import { isMobileApp } from '@/lib/platform';
import { nativeInvoke } from '@/lib/nativeBridge';

/**
 * Hand `text` to the OS share sheet. Returns false when there is none, so the caller can fall
 * back to copying — every call site here does.
 *
 * Three hosts, three answers. Android and iOS get the real sheet through the wallet's own
 * plugin (`ACTION_SEND` / `UIActivityViewController`); a browser tab gets Web Share where the
 * engine has it; a DESKTOP window gets neither, and `false` is the correct answer there — no
 * desktop OS has a share sheet a WebView can raise, and the caller copying to the clipboard
 * instead is the behaviour a desktop user expects anyway.
 *
 * The mobile branch is not redundant with the web one: a WebView does **not** implement
 * `navigator.share`, so the phone — the one platform with a real share sheet — was the
 * platform that silently fell back to the clipboard before the plugin existed.
 */
export async function shareText(text: string, title?: string): Promise<boolean> {
  if (isMobileApp()) {
    try {
      await nativeInvoke<void>('share_text', { payload: { text, title: title ?? null } });
      return true;
    } catch {
      // The plugin resolves as soon as the sheet is on screen, so a user who opens it and
      // then changes their mind has already been reported as a success — deliberately, and
      // for the same reason the cancelled branch below exists: copying behind their back
      // would be worse than doing nothing.
      //
      // Reaching here therefore means no sheet ever appeared: nothing on the device accepts
      // `text/plain`, or the plugin is missing from a stale build. `false` is what sends the
      // caller to its clipboard fallback, and reporting it as handled is what once made the
      // button do nothing at all.
      return false;
    }
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
 * WEB SHARE ONLY. The native path above never needs this — it cannot tell the two apart
 * and does not try — so `AbortError` is the whole contract here: it is the standard name
 * for a dismissed Web Share, and it is a `name`, not prose. Never matched on a message.
 */
function wasCancelled(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}
