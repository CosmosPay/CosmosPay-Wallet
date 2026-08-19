/** Cross-platform clipboard (Capacitor on native, Web API on the browser). */
import { Capacitor } from '@capacitor/core';

/**
 * Copy, and REPORT whether it worked.
 *
 * It used to return `void` and swallow both failures, with a comment claiming "the UI just
 * won't show 'copied'". The UI showed it anyway — `useCopied` raised the flag
 * unconditionally — so a blocked clipboard produced a button that said "Copied!" over an
 * unchanged clipboard. On the receive screen that means the user pastes whatever was there
 * before into a withdrawal field, which is the one place a silent no-op costs money.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return true;
    }
  } catch {
    /* fall through to web */
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readText(): Promise<string> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      const { value } = await Clipboard.read();
      return value ?? '';
    }
  } catch {
    /* fall through */
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/**
 * Can this platform hand us an IMAGE off the clipboard?
 *
 * Only the async Clipboard API can, and only where it is implemented: an Android WebView does
 * not expose `read()` at all, and Capacitor's Clipboard plugin is no substitute — its Android
 * `read()` coerces whatever is on the clipboard to text, so an image comes back as a `content://`
 * string. The scanner asks before it offers the button, because a button whose only possible
 * outcome is "there is no image in the clipboard" reads as a bug in the wallet.
 */
export function canReadClipboardImage(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
}
