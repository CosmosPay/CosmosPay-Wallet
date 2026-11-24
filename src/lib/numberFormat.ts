/**
 * Every number a person reads, written the way the app's language writes it.
 *
 * Each screen used to format on its own: Home and Send in fixed US English ("$1,252.54",
 * "9,983.99995 XLM") whatever the language, the notifications in the language's locale
 * ("6,5237488 USDC"), the ramp in plain `es` ("Mínimo 4954,30 ARS", no thousands
 * separator). So a Spanish screen could show "1,252.54" and "4954,30" side by side.
 * Now one formatter, built from the language the person chose (`usePreferences` → `store.num`,
 * `numberFormat(savedLang())` where there is no store) — never the device's locale, for
 * the same reason the language itself never reads it (src/constants/i18n.ts).
 *
 * Only the separators follow the language. Each call site keeps its own decimals and
 * rounding, and the currency signs stay exactly as they were: "$" before the figure, "%"
 * right after it.
 *
 * DISPLAY ONLY. Nothing here may reach a machine: an amount put into an input, sent to an
 * API, written into a transaction, a SEP-7 link or a memo, or copied for pasting elsewhere
 * stays the plain decimal `src/lib/amount.ts` reads (`plainDecimal` writes one). "1.000"
 * is a thousand in Spanish and one in English; a parser must never see either.
 */
import type { Lang } from '@/lib/i18n';
import { NUMBER_LOCALES } from '@/constants/i18n';

/** The formatter for one language. Its methods are plain functions: destructure freely. */
export interface NumberFormat {
  readonly lang: Lang;
  /** Exactly `dp` decimals: a fiat value, "1.252,54". */
  fixed(n: number, dp?: number): string;
  /** Up to `dp` decimals, trailing zeros dropped: a token amount, "9.983,99995". */
  amount(n: number, dp?: number): string;
  /** At most `digits` significant digits: a tiny rate or amount, "0,002231". */
  significant(n: number, digits: number): string;
  /** A dollar value: "$" and exactly `dp` decimals, "$1.252,54". */
  usd(n: number, dp?: number): string;
  /** A dollar value split for the two-tone balance: `{ whole: '$1.252', cents: ',54' }`. */
  money(n: number): { whole: string; cents: string };
  /** A signed change: "+1,23%", "-0,50%". */
  pct(n: number, dp?: number): string;
  /**
   * A decimal STRING (as typed, as an API or a ledger returns it: "1234.5", "1,5", "-0.0000001")
   * in this language with every digit kept — no float on the way, so an 18-decimal amount
   * reads exactly as it will move. Anything that is not a plain decimal comes back untouched.
   */
  decimal(s: string): string;
}

/** A plain decimal, optionally signed: either separator, as `lib/amount.ts` reads one. */
const PLAIN_DECIMAL = /^(-?)(\d*)(?:[.,](\d*))?$/;

const formatters = new Map<string, Intl.NumberFormat>();

function intl(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${opts.minimumFractionDigits ?? ''}|${opts.maximumFractionDigits ?? ''}|${opts.maximumSignificantDigits ?? ''}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    formatters.set(key, f);
  }
  return f;
}

/** The locale's own decimal mark and thousands separator, read from Intl itself. */
function separatorsOf(locale: string): { decimal: string; group: string } {
  const parts = intl(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).formatToParts(12345.6);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

const built = new Map<Lang, NumberFormat>();

/** The formatter for `lang`, built once per language. */
export function numberFormat(lang: Lang): NumberFormat {
  const cached = built.get(lang);
  if (cached) return cached;

  const locale = NUMBER_LOCALES[lang];
  const sep = separatorsOf(locale);

  const fixed = (n: number, dp = 2) => intl(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
  const amount = (n: number, dp = 7) => intl(locale, { maximumFractionDigits: dp }).format(n);
  const significant = (n: number, digits: number) => intl(locale, { maximumSignificantDigits: digits }).format(n);
  const usd = (n: number, dp = 2) => `$${fixed(n, dp)}`;
  const money = (n: number) => {
    const s = fixed(n, 2);
    const at = s.lastIndexOf(sep.decimal);
    return at < 0 ? { whole: `$${s}`, cents: '' } : { whole: `$${s.slice(0, at)}`, cents: s.slice(at) };
  };
  const pct = (n: number, dp = 2) => `${n >= 0 ? '+' : ''}${fixed(n, dp)}%`;
  const decimal = (s: string) => {
    const m = PLAIN_DECIMAL.exec(s.trim());
    if (!m || (!m[2] && !m[3])) return s;
    const [, sign, int, frac] = m;
    const whole = (int.replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
    return `${sign}${whole}${frac ? `${sep.decimal}${frac}` : ''}`;
  };

  const f: NumberFormat = { lang, fixed, amount, significant, usd, money, pct, decimal };
  built.set(lang, f);
  return f;
}
