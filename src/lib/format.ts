/**
 * Short forms for display. Numbers are not here: every figure a person reads goes through
 * `src/lib/numberFormat.ts`, in the app's language (`store.num`).
 */

/** G ABCD…WXYZ — short form for an address. */
export function shortAddr(addr: string, head = 5, tail = 5): string {
  if (!addr || addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
