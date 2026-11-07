/**
 * Buying a stablecoin with local money through El Dorado's P2P widget
 * (`src/constants/eldorado.ts`, screen `src/features/fiat/P2pBuy.tsx`).
 *
 * The wallet does two things and nothing else:
 *
 *  1. Reads the public market: the fiat currencies, the payment methods per currency and the
 *     BUY price and minimum of each. Those three endpoints are keyless and answer CORS from
 *     any origin (checked 2026-11-05), so the popup, a Tauri window and a web page reach
 *     them alike. A firm quote is NOT one of them: `/quote/buy` requires the integrator's
 *     ClientID and ReferralID, so the screen shows an estimate from the price and the widget
 *     shows the quote, fees included, before anything is paid.
 *  2. Builds the widget URL with the order filled in and the wallet's own Arbitrum address
 *     fixed as the recipient. The person signs in to El Dorado and passes its KYC there.
 *
 * It opens outside the wallet (`src/lib/openExternal.ts`): the widget is a whole app with
 * its own login, an identity check that wants the camera and a payment step that can last
 * longer than the popup stays open. In a tab or the OS browser it keeps all of that; in an
 * iframe inside the popup, a Tauri window or an Android WebView it would not.
 *
 * No key and no signature are involved: buying only ever delivers TO the wallet.
 */
import {
  ELDORADO_ADDRESS_PARAM,
  ELDORADO_ENV,
  ELDORADO_REFERENCE_PREFIX,
  ELDORADO_TEST_USDT,
  ELDORADO_TIMEOUT_MS,
} from '@/constants/eldorado';
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkToken } from '@/constants/networks';
import { parseDecimal } from '@/lib/amount';
import { ApiShapeError, arrayOf, object, optional, parseShape, str, unchecked, type Check } from '@/lib/apiShape';
import { isEvmAddress } from '@/lib/evmTx';

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Tracking ids El Dorado issues to an integrator (api@eldorado.io). Optional: the widget
 * opens without them; with them it attributes the order to Cosmos and sends its webhooks.
 * Not secrets, they ride in the URL. `PUBLIC_ELDORADO_CLIENT_ID` / `_REFERRAL_ID` in `.env`.
 */
export const ELDORADO_CLIENT_ID = (ENV.PUBLIC_ELDORADO_CLIENT_ID ?? '').trim();
export const ELDORADO_REFERRAL_ID = (ENV.PUBLIC_ELDORADO_REFERRAL_ID ?? '').trim();

export interface P2pMethod {
  id: string;
  name: string;
}

export interface P2pCurrency {
  id: string;
  /** In the person's language when the API has it, else English, else the code. */
  name: string;
  /** Local money per stablecoin, the BUY side. */
  price: number;
  /** Least local money one order takes. */
  minIn: number;
  methods: P2pMethod[];
}

export interface P2pMarket {
  currencies: P2pCurrency[];
}

/* ---- response contracts: only the fields the screen acts on ---- */

const CurrenciesShape = object({
  currencies: arrayOf(object({ id: str, type: str, description: optional(unchecked) })),
});
const MethodsShape = object({
  paymentMethods: arrayOf(object({ id: str, name: str, currency: str })),
});
/** `BUY` is keyed by currency id; each entry is read defensively in `buildMarket`. */
const record: Check<Record<string, unknown>> = (v, path, url) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiShapeError(url, path, 'an object', v);
  return v as Record<string, unknown>;
};
const PricesShape = object({ BUY: record });

type Currencies = ReturnType<typeof CurrenciesShape>;
type Methods = ReturnType<typeof MethodsShape>;

/** A positive decimal from the API (they send strings), or null. */
function positive(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseDecimal(raw);
  return n !== null && Number.isFinite(n) && n > 0 ? n : null;
}

function localName(description: unknown, lang: string, fallback: string): string {
  if (!description || typeof description !== 'object') return fallback;
  const d = description as Record<string, unknown>;
  const pick = d[lang] ?? d.en;
  return typeof pick === 'string' && pick.trim() ? pick.trim() : fallback;
}

/**
 * The currencies a person can actually buy with: fiat, with a BUY price, a minimum and at
 * least one payment method. Anything missing one of those is left out rather than offered
 * and refused later. Pure, so `tests/unit/eldorado.test.ts` can pin it on recorded answers.
 */
export function buildMarket(currencies: Currencies, methods: Methods, prices: { BUY: Record<string, unknown> }, lang: string): P2pMarket {
  const out: P2pCurrency[] = [];
  for (const c of currencies.currencies) {
    if (c.type !== 'FIAT') continue;
    const side = prices.BUY[c.id] as { price?: unknown; limits?: { in?: { min?: unknown } } } | undefined;
    const price = positive(side?.price);
    const minIn = positive(side?.limits?.in?.min);
    const list = methods.paymentMethods.filter((m) => m.currency === c.id).map((m) => ({ id: m.id, name: m.name }));
    if (price === null || minIn === null || list.length === 0) continue;
    out.push({ id: c.id, name: localName(c.description, lang, c.id), price, minIn, methods: list });
  }
  return { currencies: out };
}

async function getJson<T>(url: string, shape: Check<T>, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return parseShape(url, shape, await res.json());
}

/** The market in `env`, read fresh. Throws on a timeout, an HTTP error or an unexpected shape. */
export async function loadP2pMarket(env: ChainNet, lang: string): Promise<P2pMarket> {
  const base = ELDORADO_ENV[env].api;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ELDORADO_TIMEOUT_MS);
  try {
    const [currencies, methods, prices] = await Promise.all([
      getJson(`${base}/currencies`, CurrenciesShape, ctrl.signal),
      getJson(`${base}/payment-methods`, MethodsShape, ctrl.signal),
      getJson(`${base}/prices`, PricesShape, ctrl.signal),
    ]);
    return buildMarket(currencies, methods, prices, lang);
  } finally {
    clearTimeout(timer);
  }
}

/** The stablecoins a buy can deliver in `env`: Arbitrum's registry tokens, or the sandbox's one. */
export function p2pTokens(env: ChainNet): readonly NetworkToken[] {
  return env === 'mainnet' ? NETWORKS.arb.tokens : [ELDORADO_TEST_USDT];
}

export type P2pAmountProblem = 'empty' | 'below-min';

/** Why `amount` cannot be bought in `currency`, or null when it can. */
export function p2pAmountProblem(amount: string, currency: P2pCurrency): P2pAmountProblem | null {
  const n = parseDecimal(amount);
  if (n === null || n <= 0) return 'empty';
  return n < currency.minIn ? 'below-min' : null;
}

/** About how much stablecoin `amount` of local money buys, before the widget's own quote. */
export function p2pEstimate(amount: string, currency: P2pCurrency): number | null {
  const n = parseDecimal(amount);
  if (n === null || n <= 0) return null;
  return Math.floor((n / currency.price) * 100) / 100;
}

/** A reference El Dorado accepts (letters, digits, hyphens) that names this wallet's order. */
export function p2pReference(random: () => string = () => crypto.randomUUID()): string {
  return `${ELDORADO_REFERENCE_PREFIX}-${random().replace(/[^A-Za-z0-9-]/g, '')}`;
}

export interface P2pOrder {
  env: ChainNet;
  /** The wallet's own 0x address; refused when it is not one. */
  address: string;
  currency: string;
  method: string;
  token: NetworkToken;
  amount: string;
  clientId?: string;
  referralId?: string;
  reference?: string;
}

/**
 * The widget URL for a BUY of `order`, or null when the address is not a 0x account: a
 * widget opened without a fixed recipient asks the person to connect some other wallet,
 * and whatever they bought would land there instead of here.
 */
export function p2pWidgetUrl(order: P2pOrder): string | null {
  if (!isEvmAddress(order.address)) return null;
  const amount = parseDecimal(order.amount);
  if (amount === null || amount <= 0) return null;
  const env = ELDORADO_ENV[order.env];
  const url = new URL('/exchange', env.widget);
  const q = url.searchParams;
  q.set('operation', 'BUY');
  q.set('token', order.token.asset);
  q.set('chain', String(env.chainId));
  q.set('currency', order.currency);
  q.set('paymentMethod', order.method);
  q.set('amount', String(amount));
  q.set(ELDORADO_ADDRESS_PARAM, order.address);
  if (order.clientId) q.set('clientId', order.clientId);
  if (order.referralId) q.set('referralId', order.referralId);
  if (order.reference) q.set('externalReferenceId', order.reference);
  return url.toString();
}
