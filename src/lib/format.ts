/** Display formatting helpers. */

export function fmt(n: number, dp = 2): string {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function trim(n: number, dp = 7): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
}

export function usd(n: number): string {
  return '$' + fmt(n, 2);
}

/** Split a money string into whole + cents for the big two-tone balance. */
export function splitMoney(n: number): { whole: string; cents: string } {
  const s = fmt(n, 2);
  const dot = s.lastIndexOf('.');
  return { whole: '$' + s.slice(0, dot), cents: s.slice(dot) };
}

/** G ABCD…WXYZ — short form for an address. */
export function shortAddr(addr: string, head = 5, tail = 5): string {
  if (!addr || addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function pct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
