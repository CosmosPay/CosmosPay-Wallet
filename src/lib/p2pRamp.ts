/**
 * Buying and selling with local money through P2P counterparts, over the Cosmos Pay API
 * (`/v1/onramp/p2p` buys, `/v1/offramp/p2p` sells; the calls are in `src/lib/cosmospay.ts`,
 * the screen is `src/features/fiat/Ramp.tsx`). The same API and the same order the developer
 * platform's Fiat views use: every local currency with its payment methods, every network and
 * token the market lists that this wallet holds an address on, a firm quote when the
 * deployment can ask for one, and a session whose hosted window takes the order.
 *
 * Everything here is pure, so `tests/unit/p2pRamp.test.ts` pins it: what an order may be, the
 * market price and estimate, and the check that a session the API answered is the order the
 * person confirmed, delivering to (or sending from) this wallet's own account.
 */
import type { ChainNet } from '@/constants/chains';
import { NETWORK_GROUPS, type NetworkId } from '@/constants/networks';
import {
  RAMP_DEFAULT_CURRENCY,
  RAMP_FIAT_DECIMALS,
  RAMP_FIAT_MAX_DIGITS,
  RAMP_TOKEN_MAX_DIGITS,
  RAMP_USD_STABLES,
  RAMP_WINDOW_ADDRESS_PARAM,
  RAMP_WINDOW_ORIGINS,
  type RampSide,
} from '@/constants/ramp';
import { networkDefOn } from '@/lib/testnets';

/* ------------------------------ API shapes ------------------------------ */

export interface RampMethod {
  id: string;
  name: string;
}

export interface RampCurrency {
  id: string;
  /** English name; the screen prefers the reader's language (`currencyLabel`). */
  name: string;
  /** Local money per USD stablecoin on this side, a decimal string. */
  price: string;
  /** Least an order puts in: local money for a purchase, USD worth of the token for a sale. */
  minAmount: string;
  paymentMethods: RampMethod[];
}

export interface RampNetwork {
  chainId: number;
  name: string;
  tokenCount: number;
}

export interface RampToken {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  /** USD per token; null when the market lists no price (only the token lists carry it). */
  priceUsd?: string | null;
  logoUrl?: string | null;
  /** One of its network's main assets, matched by address. */
  main?: boolean;
}

export interface RampMarket {
  currencies: RampCurrency[];
  networks: RampNetwork[];
  defaultToken: RampToken;
}

export interface RampTokenPage {
  data: RampToken[];
  total: number;
}

/** What `POST .../p2p/quotes` and `.../p2p/sessions` take. */
export interface RampOrder {
  currency: string;
  paymentMethod: string;
  chainId: number;
  /** The token's contract address on `chainId`. */
  token: string;
  /** Local money for a purchase, the token for a sale. */
  amount: string;
  /** This wallet's own EVM account: where a purchase delivers, or where a sale sends from. */
  address: string;
}

export interface RampQuote {
  quoteId: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  fee: { amountInToken: string; amountInFiat: string };
  expiresAt: string;
}

export interface RampSession {
  id: string;
  side: RampSide;
  currency: string;
  paymentMethod: string;
  amount: string;
  token: string;
  tokenAddress: string;
  chainId: number;
  address: string;
  estimatedAmountOut: string | null;
  reference: string;
  widgetUrl: string;
  createdAt: string;
}

/* ------------------------------- networks ------------------------------- */

const EVM_NETWORKS: readonly NetworkId[] = NETWORK_GROUPS.find((g) => g.kind === 'evm')?.networks ?? [];

/**
 * The wallet's network for an EIP-155 id in `env`, or null when the wallet has no such network
 * there. An order only ever names a network the wallet can show and spend on: a purchase
 * delivered to a chain the wallet does not read would be money it cannot see.
 */
export function rampWalletNetwork(chainId: number, env: ChainNet): NetworkId | null {
  for (const id of EVM_NETWORKS) {
    if (networkDefOn(id, env)?.evmChainId === chainId) return id;
  }
  return null;
}

/** The market's networks this wallet holds an address on, in the market's order. */
export function rampNetworks(
  market: RampMarket,
  env: ChainNet,
  hasAddress: (id: NetworkId) => boolean,
): RampNetwork[] {
  return market.networks.filter((n) => {
    const id = rampWalletNetwork(n.chainId, env);
    return id !== null && hasAddress(id);
  });
}

/* -------------------------------- defaults -------------------------------- */

/** The currency a form starts on: pesos when the market trades them, else its first; '' with none. */
export function rampDefaultCurrency(ids: readonly string[]): string {
  return ids.includes(RAMP_DEFAULT_CURRENCY) ? RAMP_DEFAULT_CURRENCY : ids[0] ?? '';
}

/**
 * Where a form's token starts, given the networks it may use (`rampNetworks`): the market's own
 * default token when its network is one of them, else the first of them with no token in mind
 * yet (`rampTokenPick` chooses one from that network's list). Null with no network at all.
 */
export function rampTokenStart(market: RampMarket, chainIds: readonly number[]): { chainId: number; token: RampToken | null } | null {
  const d = market.defaultToken;
  if (chainIds.includes(d.chainId)) return { chainId: d.chainId, token: d };
  return chainIds.length ? { chainId: chainIds[0], token: null } : null;
}

/**
 * The token a start lands on, from the first page of its network's list (read from the list so
 * it carries its price): the start's own token when listed, else the first USD stablecoin, else
 * the first token. A start's token that is missing from the page is kept as it came.
 */
export function rampTokenPick(page: readonly RampToken[], start: RampToken | null): RampToken | null {
  if (start) return page.find((x) => x.address.toLowerCase() === start.address.toLowerCase()) ?? start;
  return page.find((x) => RAMP_USD_STABLES.includes(x.symbol)) ?? page[0] ?? null;
}

/* -------------------------------- amounts -------------------------------- */

/** A token's USD price, or null when the market lists none and it is not a USD stablecoin. */
export function tokenUsd(token: Pick<RampToken, 'symbol' | 'priceUsd'> | null): number | null {
  if (!token) return null;
  const n = Number(token.priceUsd);
  if (token.priceUsd != null && Number.isFinite(n) && n > 0) return n;
  return RAMP_USD_STABLES.includes(token.symbol) ? 1 : null;
}

/** Local money per token at the market price, or null without a USD price for the token. */
export function marketRate(currency: RampCurrency, token: RampToken): number | null {
  const usd = tokenUsd(token);
  const price = Number(currency.price);
  return usd && Number.isFinite(price) && price > 0 ? price * usd : null;
}

/**
 * The least an order puts in, in what it is entered in: local money for a purchase, the token
 * for a sale (its USD minimum at the token's price). Null for a sale of a token with no price:
 * the API checks it then.
 */
export function rampMinIn(side: RampSide, currency: RampCurrency, token: RampToken): number | null {
  const min = Number(currency.minAmount);
  if (!Number.isFinite(min) || min < 0) return null;
  if (side === 'buy') return min;
  const usd = tokenUsd(token);
  return usd ? min / usd : null;
}

export type RampAmountProblem = 'empty' | 'format' | 'decimals' | 'below-min';

const fiatAmountRe = new RegExp(`^(0|[1-9]\\d{0,${RAMP_FIAT_MAX_DIGITS - 1}})(\\.\\d{1,${RAMP_FIAT_DECIMALS}})?$`);
const tokenAmountRe = new RegExp(`^(0|[1-9]\\d{0,${RAMP_TOKEN_MAX_DIGITS - 1}})(\\.\\d+)?$`);

/**
 * Why an amount of local money cannot be asked for, or null when it can: at most two decimals and
 * at least the currency's purchase minimum — what a purchase puts in, and what a QR charge asks
 * the payer for (`src/lib/qrCharge.ts`), since the payer's side of a charge is a purchase.
 */
export function fiatAmountProblem(amount: string, currency: RampCurrency): RampAmountProblem | null {
  const a = amount.trim();
  if (!a || Number(a) === 0) return 'empty';
  if (!fiatAmountRe.test(a)) return 'format';
  if (!(Number(a) > 0)) return 'empty';
  const min = Number(currency.minAmount);
  // A hair under the minimum from float maths is not under it.
  return Number.isFinite(min) && min >= 0 && Number(a) < min - 1e-12 ? 'below-min' : null;
}

/** Why `amount` cannot be ordered, or null when it can. */
export function rampAmountProblem(
  side: RampSide,
  amount: string,
  currency: RampCurrency,
  token: RampToken,
): RampAmountProblem | null {
  if (side === 'buy') return fiatAmountProblem(amount, currency);
  const a = amount.trim();
  if (!a || Number(a) === 0) return 'empty';
  if (!tokenAmountRe.test(a)) return 'format';
  if ((a.split('.')[1] ?? '').length > token.decimals) return 'decimals';
  if (!(Number(a) > 0)) return 'empty';
  const min = rampMinIn(side, currency, token);
  // A hair under the minimum from float division is not under it.
  return min !== null && Number(a) < min - 1e-12 ? 'below-min' : null;
}

/** What `amount` gives at the market price, before the firm quote; null without one. */
export function rampEstimate(side: RampSide, amount: string, currency: RampCurrency, token: RampToken): number | null {
  const rate = marketRate(currency, token);
  const n = Number(amount);
  if (rate === null || !Number.isFinite(n) || n <= 0) return null;
  return side === 'buy' ? n / rate : n * rate;
}

/** Local money per token in a firm quote, fees included (what the person actually gets). */
export function quoteRate(side: RampSide, quote: RampQuote): number | null {
  const inN = Number(quote.amountIn);
  const outN = Number(quote.amountOut);
  if (!(inN > 0) || !(outN > 0)) return null;
  return side === 'buy' ? inN / outN : outN / inN;
}

/* --------------------------------- labels -------------------------------- */

/** A payment method's name without the currency the market appends ("Nequi (COP)" → "Nequi"). */
export function methodLabel(name: string, currency: string): string {
  const suffix = ` (${currency})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** A currency's name in the reader's language, else the market's English one, else its code. */
export function currencyLabel(id: string, lang: string, fallback?: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'currency' }).of(id);
    if (name && name !== id) return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
  } catch {
    /* an engine without DisplayNames, or a code it refuses */
  }
  return fallback || id;
}

/** The country a currency's ISO code starts with, for its flag ("ARS" → "AR"). */
export function currencyCountry(id: string): string {
  return id.slice(0, 2).toUpperCase();
}

/* -------------------------------- orders --------------------------------- */

/** One string per order, for the quote's debounce and to drop an answer for an order since changed. */
export function orderKey(order: RampOrder): string {
  return [order.currency, order.paymentMethod, order.chainId, order.token.toLowerCase(), order.amount, order.address.toLowerCase()].join('|');
}

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type RampSessionProblem = 'side' | 'order' | 'address' | 'url';

/**
 * Whether a session's window is safe to open for this wallet: the side asked for, this wallet's
 * own account, an https window on the marketplace's origin for the mode, and — for a purchase —
 * exactly one fixed recipient, ours (two `address` parameters could be read differently by the
 * window than here). A sale names none: the person connects the wallet that sends. Checked both
 * when an order is opened and before an order in the list is opened again.
 */
export function rampWindowProblem(session: RampSession, side: RampSide, own: string, env: ChainNet): RampSessionProblem | null {
  if (session.side !== side) return 'side';
  if (!sameHex(session.address, own)) return 'address';
  let url: URL;
  try {
    url = new URL(session.widgetUrl);
  } catch {
    return 'url';
  }
  if (url.protocol !== 'https:' || !RAMP_WINDOW_ORIGINS[env].includes(url.origin)) return 'url';
  const fixed = url.searchParams.getAll(RAMP_WINDOW_ADDRESS_PARAM);
  if (side === 'buy') {
    // The window treats this account as the connected wallet: whatever is bought lands there.
    if (fixed.length !== 1 || !sameHex(fixed[0], own)) return 'address';
  } else if (fixed.length > 0) {
    return 'address';
  }
  return null;
}

/**
 * Whether a session the API answered is the order the person confirmed, and safe to open: the
 * same currency, method, network, token and amount, and a window `rampWindowProblem` accepts for
 * the order's own address. Opening anything else would take the person to an order they did not make.
 */
export function rampSessionProblem(session: RampSession, side: RampSide, order: RampOrder, env: ChainNet): RampSessionProblem | null {
  if (session.side !== side) return 'side';
  if (
    session.currency !== order.currency ||
    session.paymentMethod !== order.paymentMethod ||
    session.chainId !== order.chainId ||
    !sameHex(session.tokenAddress, order.token) ||
    Number(session.amount) !== Number(order.amount)
  ) {
    return 'order';
  }
  return rampWindowProblem(session, side, order.address, env);
}
