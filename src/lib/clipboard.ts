/** Cross-platform clipboard (Tauri's clipboard-manager natively, Web API in a browser). */
import { isTauri } from '@/lib/platform';

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
    if (isTauri()) {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
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
    if (isTauri()) {
      const { readText: read } = await import('@tauri-apps/plugin-clipboard-manager');
      return (await read()) ?? '';
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
 * Only the async Clipboard API can, and only where it is implemented. Deliberately asks
 * the WEB API even under Tauri: the native plugin's `readImage()` exists on desktop but
 * not on Android or iOS, and the answer this gates is whether to render a "paste a QR"
 * button at all. A button whose only possible outcome is "there is no image in the
 * clipboard" reads as a bug in the wallet, so the check has to be the one the paste path
 * will actually take.
 */
export function canReadClipboardImage(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
}
