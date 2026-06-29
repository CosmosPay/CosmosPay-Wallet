/** Cross-platform clipboard (Capacitor on native, Web API on the browser). */
import { Capacitor } from '@capacitor/core';

export async function copyText(text: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return;
    }
  } catch {
    /* fall through to web */
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard blocked — ignore, UI just won't show "copied" */
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
