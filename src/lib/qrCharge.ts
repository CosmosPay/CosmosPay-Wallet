/**
 * Charging with a QR in local money: the seller's side of `/v1/onramp/p2p/payment-requests` (calls
 * in `src/lib/cosmospay.ts`, state in `src/state/useQrCharge.ts`, screen
 * `src/features/fiat/Charge.tsx`). The seller asks for an amount of local money; whoever scans the
 * QR opens the hosted page and pays one of the ways the request lists (`methods`): a bank transfer
 * to the deposit account the page shows, which the API converts and sends on (the request reads
 * `processing` meanwhile), or the same P2P purchase the ramp opens, which delivers straight to
 * this wallet's own EVM account. Either way the token lands there.
 *
 * Everything here is pure, so `tests/unit/qrCharge.test.ts` pins it: what a charge may ask for, the
 * check that the request the API answered is the one asked for and pays this wallet, how a charge
 * reads at a given moment, and the rule that reads money arriving off the wallet's own balance.
 * Only the API says a charge is paid: the balance cannot tell whose money it is, so a rise there is
 * at most "money arriving, confirming", and only while the charge is open and has an estimate.
 */
import type { ChainNet } from '@/constants/chains';
import {
  CHARGE_DESCRIPTION_MAX,
  CHARGE_LATE_WATCH_MS,
  CHARGE_LEGACY_METHODS,
  CHARGE_METHODS,
  CHARGE_PAID_SHARE_BPS,
  CHARGE_STORAGE_PREFIX,
  type ChargeMethod,
  type ChargeStatus,
} from '@/constants/qrCharge';
import { fromMinorUnits, toMinorUnitsBig } from '@/lib/amount';
import { parseShape } from '@/lib/apiShape';
import { PaymentRequestShape } from '@/lib/cosmospayShapes';
import { paymentsUrl } from '@/lib/endpoints';
import { fiatAmountProblem, type RampAmountProblem, type RampCurrency } from '@/lib/p2pRamp';

/* ------------------------------ API shapes ------------------------------ */

/** What `POST /v1/onramp/p2p/payment-requests` takes. */
export interface PaymentRequestInput {
  currency: string;
  /** Local money, at most two decimals, at least the currency's purchase minimum. */
  amount: string;
  chainId: number;
  /** The token's contract on `chainId` (the zero address is the chain's own coin). */
  token: string;
  /** This wallet's own EVM account: where the payer's purchase delivers. */
  address: string;
  description?: string;
  expiresInMinutes?: number;
}

/** A charge as the API answers it (`PaymentRequestShape` checks the fields read here). */
export interface PaymentRequest {
  id: string;
  status: ChargeStatus;
  currency: string;
  amount: string;
  chainId: number;
  /** The token's symbol. */
  token: string;
  tokenAddress: string;
  tokenDecimals: number;
  address: string;
  description: string | null;
  /** About what the payer's money buys at the market price when the charge was made; null without a price. */
  estimatedAmountOut: string | null;
  /** The page the QR opens. */
  url: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  /** What was delivered, once the API knows the charge was paid. */
  paidAmount: string | null;
  /**
   * How the payer can pay, in the API's order of preference — as it arrived, unchecked: read it
   * through `chargeMethods` (a server that predates it leaves it out).
   */
  methods?: unknown;
  /** How it was paid once `paid`, as it arrived, unchecked: read it through `chargePaidMethod`. */
  paidMethod?: unknown;
  /** Only to the shared public key: reading or cancelling the request again needs it. */
  publicToken?: string;
}

/** A request as the wallet keeps it: without `publicToken` (kept apart), the ways to pay read. */
export interface ChargeRequest extends Omit<PaymentRequest, 'publicToken' | 'methods' | 'paidMethod'> {
  methods: ChargeMethod[];
  paidMethod: ChargeMethod | null;
}

/** The fields that say which charge a request is: its id, its order and who it pays. */
type ChargeIdentity = Pick<PaymentRequest, 'id' | 'currency' | 'amount' | 'chainId' | 'tokenAddress' | 'tokenDecimals' | 'address'>;

/* ------------------------------ ways to pay ------------------------------ */

const isMethod = (v: unknown): v is ChargeMethod => typeof v === 'string' && (CHARGE_METHODS as readonly string[]).includes(v);

/**
 * The ways the payer can pay, as the API listed them, in its order. A server that predates the
 * field (absent or null) offers only the purchase; a way this release does not know is left
 * out, and so is a repeat. Anything that is not a list says nothing: an empty list.
 */
export function chargeMethods(raw: unknown): ChargeMethod[] {
  if (raw === undefined || raw === null) return [...CHARGE_LEGACY_METHODS];
  if (!Array.isArray(raw)) return [];
  const out: ChargeMethod[] = [];
  for (const m of raw) if (isMethod(m) && !out.includes(m)) out.push(m);
  return out;
}

/** How a request was paid, when the API says so in words this release knows; null otherwise. */
export function chargePaidMethod(raw: unknown): ChargeMethod | null {
  return isMethod(raw) ? raw : null;
}

/**
 * The i18n key of the line that tells the seller how the customer can pay: by bank transfer, by
 * the other ways (the purchase), or either. Null when the API named no way this release knows.
 */
export function chargeMethodsKey(methods: readonly ChargeMethod[]): string | null {
  const transfer = methods.includes('transfer');
  const other = methods.includes('p2p');
  if (transfer && other) return 'charge.methodsBoth';
  if (transfer) return 'charge.methodsTransfer';
  return other ? 'charge.methodsOther' : null;
}

/** The i18n key of the line that says how a charge was paid; null when the API did not say. */
export function chargePaidMethodKey(method: ChargeMethod | null): string | null {
  if (method === 'transfer') return 'charge.paidByTransfer';
  return method === 'p2p' ? 'charge.paidByOther' : null;
}

/* -------------------------------- the form -------------------------------- */

/**
 * Why an amount cannot be charged, or null when it can: the payer's side is a purchase, so the
 * purchase's rule — at most two decimals, at least the currency's minimum (`fiatAmountProblem`).
 */
export function chargeAmountProblem(amount: string, currency: RampCurrency): RampAmountProblem | null {
  return fiatAmountProblem(amount, currency);
}

/** Control characters and the Unicode line and paragraph separators: a description is one line. */
const LINE_BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/**
 * What the description field keeps of a keystroke or a paste: line breaks, tabs and every other
 * control character become a space, and the text stops at `CHARGE_DESCRIPTION_MAX` — counted in
 * UTF-16 units, so no count of it (by character or by unit) passes the cap, and never cutting a
 * character in half.
 */
export function sanitizeChargeDescription(raw: string): string {
  let out = '';
  for (const ch of raw.replace(LINE_BREAKS, ' ')) {
    if (out.length + ch.length > CHARGE_DESCRIPTION_MAX) break;
    out += ch;
  }
  return out;
}

/** The description as sent: one line, trimmed, and absent when nothing is left. */
export function chargeDescription(raw: string): string | undefined {
  return sanitizeChargeDescription(raw).trim() || undefined;
}

/* ------------------------- the request the API answered ------------------------- */

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A URL, or null when it does not parse, is not https (plain http only on this machine) or carries credentials. */
function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return null;
  return u.username || u.password ? null : u;
}

const trimSlashes = (path: string) => path.replace(/\/+$/, '');

/**
 * Where the QR may send the payer: this request's own page on the configured payments site
 * (`paymentsUrl()`, the community server's `PAYMENT_LINK_CHECKOUT_URL`), exactly
 * `<payments>/fiat/<id>`: the same origin, that path and nothing in front of it, no credentials.
 * Any other host is refused, even one whose path ends the same way, so an answer cannot send the
 * payer to a page that only looks like ours. A payments site that is not https (plain http only on
 * this machine, for a local server) accepts nothing.
 */
export function chargeUrlOk(url: string, id: string, payments: string = paymentsUrl()): boolean {
  const base = safeUrl(payments);
  const u = safeUrl(url);
  if (!base || !u || u.origin !== base.origin) return false;
  return trimSlashes(u.pathname) === `${trimSlashes(base.pathname)}/fiat/${encodeURIComponent(id)}`;
}

export type ChargeProblem = 'order' | 'address' | 'url';

/**
 * Whether a request the API answered is the charge asked for and pays this wallet: the same
 * currency, amount, network and token, this wallet's own account as the recipient, and a page
 * `chargeUrlOk` accepts on the payments site. Anything else would put a QR on screen that charges
 * another amount, pays someone else or opens someone else's page, so it is never shown.
 */
export function chargeRequestProblem(req: PaymentRequest, input: PaymentRequestInput, payments: string = paymentsUrl()): ChargeProblem | null {
  if (
    req.currency !== input.currency ||
    Number(req.amount) !== Number(input.amount) ||
    req.chainId !== input.chainId ||
    !sameHex(req.tokenAddress, input.token) ||
    !Number.isInteger(req.tokenDecimals) ||
    req.tokenDecimals < 0 ||
    req.tokenDecimals > 36
  ) {
    return 'order';
  }
  if (!sameHex(req.address, input.address)) return 'address';
  return chargeUrlOk(req.url, req.id, payments) ? null : 'url';
}

/** Whether a later answer is about the same charge: the same id, order and recipient. */
export function sameCharge(a: ChargeIdentity, b: ChargeIdentity): boolean {
  return (
    a.id === b.id &&
    a.currency === b.currency &&
    Number(a.amount) === Number(b.amount) &&
    a.chainId === b.chainId &&
    sameHex(a.tokenAddress, b.tokenAddress) &&
    a.tokenDecimals === b.tokenDecimals &&
    sameHex(a.address, b.address)
  );
}

/* -------------------------------- the charge -------------------------------- */

/** The API said the charge was paid: what it delivered (a decimal of the token) when it knows, and when. */
export interface ChargePaid {
  amount: string | null;
  at: number;
}

/**
 * The wallet's own balance rose by about the estimate while the charge was open: what came in (a
 * decimal of the token) and when. Provisional (it may be anyone's money), so it is never "paid".
 */
export interface ChargeArrival {
  amount: string;
  at: number;
}

/**
 * What the screen shows: the API's status (`chargeStatus`), or `arriving` while an open charge has
 * seen the balance rise by its estimate and the API has not said paid yet.
 */
export type ChargeView = ChargeStatus | 'arriving';

/**
 * The charge on screen, as the wallet keeps it — in storage, per wallet and mode
 * (`chargeStorageKey`), so a reload or a closed popup comes back to the same QR.
 */
export interface QrCharge {
  /** The request as last answered, without `publicToken` (kept apart) or the API's `qr`. */
  request: ChargeRequest;
  /** Made with the shared public key: reading or cancelling it again takes that key and `publicToken`. */
  shared: boolean;
  publicToken: string | null;
  /** This wallet's balance of the token in base units when the QR was shown (the lowest since); null until read. */
  baseline: string | null;
  /** Set only by the API's `paid`. */
  paid: ChargePaid | null;
  /** Set only by the balance, only while open: money arriving, not yet confirmed. */
  arriving: ChargeArrival | null;
  /** When the wallet first saw it expired or cancelled; null while it is open. */
  closedAt: number | null;
}

/**
 * The fields kept of an answer: not the API's `qr` (the wallet draws its own) nor `publicToken`;
 * the ways to pay read through `chargeMethods` and `chargePaidMethod`.
 */
function keep(req: PaymentRequest): ChargeRequest {
  return {
    id: req.id,
    status: req.status,
    currency: req.currency,
    amount: req.amount,
    chainId: req.chainId,
    token: req.token,
    tokenAddress: req.tokenAddress,
    tokenDecimals: req.tokenDecimals,
    address: req.address,
    description: req.description ?? null,
    estimatedAmountOut: req.estimatedAmountOut ?? null,
    url: req.url,
    expiresAt: req.expiresAt,
    createdAt: req.createdAt,
    paidAt: req.paidAt ?? null,
    paidAmount: req.paidAmount ?? null,
    methods: chargeMethods(req.methods),
    paidMethod: chargePaidMethod(req.paidMethod),
  };
}

/** A charge just made. `baseline` is the balance read beside the request, when that read answered. */
export function newCharge(req: PaymentRequest, shared: boolean, baseline: bigint | null): QrCharge {
  return {
    request: keep(req),
    shared,
    publicToken: shared ? req.publicToken ?? null : null,
    baseline: baseline === null || baseline < 0n ? null : baseline.toString(),
    paid: req.status === 'paid' ? { amount: req.paidAmount ?? null, at: Date.parse(req.paidAt ?? '') || 0 } : null,
    arriving: null,
    closedAt: null,
  };
}

/**
 * What a charge is at `now`: paid once the API said so; otherwise the request's status, an open
 * one past its expiry being expired (the API reads it the same way). A `processing` one — the
 * money received, the token on its way — never expires. The balance never makes it paid.
 */
export function chargeStatus(charge: QrCharge, now: number): ChargeStatus {
  if (charge.paid) return 'paid';
  const { status, expiresAt } = charge.request;
  return status === 'open' && now >= Date.parse(expiresAt) ? 'expired' : status;
}

/**
 * What the screen shows at `now`: `chargeStatus`, except an open charge whose balance rose by its
 * estimate reads `arriving`, distinct from paid and gone the moment the charge expires or is
 * cancelled (only the API can still turn those into paid).
 */
export function chargeView(charge: QrCharge, now: number): ChargeView {
  const status = chargeStatus(charge, now);
  return status === 'open' && charge.arriving ? 'arriving' : status;
}

/** Whether the seller may still cancel it: only while it is open (the API refuses anything else). */
export function chargeCancellable(charge: QrCharge, now: number): boolean {
  return chargeStatus(charge, now) === 'open';
}

/** How a paid charge was paid, when the API said so; null while unpaid. */
export function chargePaidVia(charge: QrCharge, now: number): ChargeMethod | null {
  return chargeStatus(charge, now) === 'paid' ? charge.request.paidMethod : null;
}

/** Milliseconds until the charge expires, never below zero. */
export function chargeTimeLeft(charge: QrCharge, now: number): number {
  const end = Date.parse(charge.request.expiresAt);
  return Number.isFinite(end) ? Math.max(0, end - now) : 0;
}

/** A countdown as the screen shows it: `h:mm:ss` from an hour up, `m:ss` below; a started second counts. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Whether the screen still asks the API: until the charge is paid — while it
 * is open or processing (the money received, the token on its way), and for
 * `CHARGE_LATE_WATCH_MS` after it expired or was cancelled, because a payer who started just
 * before is still paying and that money arrives all the same.
 */
export function chargeWatched(charge: QrCharge, now: number): boolean {
  const status = chargeStatus(charge, now);
  if (status === 'paid') return false;
  if (status === 'open' || status === 'processing') return true;
  const since = status === 'expired' ? Date.parse(charge.request.expiresAt) : charge.closedAt;
  return since === null || !Number.isFinite(since) || now - since < CHARGE_LATE_WATCH_MS;
}

/**
 * A charge after an answer from the API about it. An answer about another charge changes nothing.
 * A paid request settles the charge (`paidAmount` is what arrived, when the API knows it); any
 * other status replaces the one kept, so `open` → `processing` → `paid` is three answers in a row.
 * The API is the only signal that settles a charge.
 */
export function withRequest(charge: QrCharge, req: PaymentRequest, now: number): QrCharge {
  if (!sameCharge(charge.request, req)) return charge;
  const closing = (req.status === 'expired' || req.status === 'cancelled') && charge.closedAt === null;
  return {
    ...charge,
    request: keep(req),
    closedAt: closing ? now : charge.closedAt,
    paid: charge.paid ?? (req.status === 'paid' ? { amount: req.paidAmount ?? null, at: now } : null),
  };
}

/** The estimate in the token's base units, or null when there is none worth measuring against. */
function estimateUnits(req: Pick<PaymentRequest, 'estimatedAmountOut' | 'tokenDecimals'>): bigint | null {
  if (req.estimatedAmountOut === null) return null;
  const units = toMinorUnitsBig(req.estimatedAmountOut, req.tokenDecimals);
  return units === null || units <= 0n ? null : units;
}

export interface BalanceCheck {
  /** The rise covers the estimate: money arriving, for the API to confirm. */
  arrived: boolean;
  /** What came in since the baseline, in base units. */
  received: bigint;
  /** The baseline to keep: lowered to the balance when money left meanwhile. */
  baseline: bigint;
}

/**
 * The rule that reads money arriving off the wallet's own balance. A rise over the baseline counts
 * when it reaches `CHARGE_PAID_SHARE_BPS` of the estimate (the firm price the payer gets can be a
 * little under the market's). Without an estimate nothing counts: any rise at all would let a payer
 * send dust and see the charge move. Money that left since the QR was shown lowers the baseline,
 * so a rise counts from the lowest point.
 *
 * It cannot tell whose money it is: anything of that token arriving on that network meanwhile
 * reads the same. That is why it only ever says "arriving", never "paid": only the API's answer
 * (`withRequest`) settles a charge.
 */
export function chargeArrivalByBalance(baseline: bigint, current: bigint, estimatedAmountOut: string | null, decimals: number): BalanceCheck {
  const base = current < baseline ? current : baseline;
  const received = current - base;
  if (received <= 0n) return { arrived: false, received: 0n, baseline: base };
  const estimate = estimateUnits({ estimatedAmountOut, tokenDecimals: decimals });
  if (estimate === null) return { arrived: false, received, baseline: base };
  return { arrived: received * 10_000n >= estimate * BigInt(CHARGE_PAID_SHARE_BPS), received, baseline: base };
}

/**
 * Whether the screen reads the wallet's balance for this charge: only while it is open, has an
 * estimate to measure a rise against, and has not seen money arrive yet. A processing, paid,
 * expired or cancelled charge is the API's to settle.
 */
export function chargeBalanceWatched(charge: QrCharge, now: number): boolean {
  return chargeStatus(charge, now) === 'open' && charge.arriving === null && estimateUnits(charge.request) !== null;
}

const UNITS = /^\d+$/;

/**
 * A charge after a read of this wallet's balance of the token, in base units. The first read is
 * the baseline (the moment the QR was shown) and each later one goes through
 * `chargeArrivalByBalance`, which can mark money arriving and nothing more. Outside
 * `chargeBalanceWatched` the charge stays as it is.
 */
export function withBalance(charge: QrCharge, balance: bigint, now: number): QrCharge {
  if (!chargeBalanceWatched(charge, now) || balance < 0n) return charge;
  if (charge.baseline === null || !UNITS.test(charge.baseline)) return { ...charge, baseline: balance.toString() };
  const { tokenDecimals, estimatedAmountOut } = charge.request;
  const check = chargeArrivalByBalance(BigInt(charge.baseline), balance, estimatedAmountOut, tokenDecimals);
  return {
    ...charge,
    baseline: check.baseline.toString(),
    arriving: check.arrived ? { amount: fromMinorUnits(check.received, tokenDecimals) ?? '0', at: now } : null,
  };
}

/* --------------------------------- storage --------------------------------- */

/** Where the charge on screen is kept: one per wallet and mode. */
export function chargeStorageKey(walletId: string, env: ChainNet): string {
  return `${CHARGE_STORAGE_PREFIX}.${walletId}.${env}`;
}

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * A paid record read back. One an earlier build of this screen wrote from the balance alone
 * (`by: 'balance'`) is not kept: only the API settles a charge, and its next answer says so again.
 */
function parsePaid(raw: unknown): ChargePaid | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.by !== undefined && p.by !== 'api') return null;
  const amount = typeof p.amount === 'string' && DECIMAL.test(p.amount) ? p.amount : null;
  const at = typeof p.at === 'number' && Number.isFinite(p.at) ? p.at : 0;
  return { amount, at };
}

/** Money seen arriving, read back: a decimal amount and a time, or nothing. */
function parseArrival(raw: unknown): ChargeArrival | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.amount !== 'string' || !DECIMAL.test(a.amount) || typeof a.at !== 'number' || !Number.isFinite(a.at)) return null;
  return { amount: a.amount, at: a.at };
}

/**
 * A charge read back from storage, checked like any input: the request against the API's own
 * contract and `chargeUrlOk` (on the payments site configured now), the rest field by field.
 * Whatever does not read is dropped (null), never guessed — the person makes a new charge.
 */
export function parseStoredCharge(raw: unknown, payments: string = paymentsUrl()): QrCharge | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  let request: PaymentRequest;
  try {
    request = parseShape('storage', PaymentRequestShape, c.request) as PaymentRequest;
  } catch {
    return null;
  }
  if (typeof c.shared !== 'boolean' || !chargeUrlOk(request.url, request.id, payments)) return null;
  return {
    request: keep(request),
    shared: c.shared,
    publicToken: c.shared && typeof c.publicToken === 'string' && c.publicToken ? c.publicToken : null,
    baseline: typeof c.baseline === 'string' && UNITS.test(c.baseline) ? c.baseline : null,
    paid: parsePaid(c.paid),
    arriving: parseArrival(c.arriving),
    closedAt: typeof c.closedAt === 'number' && Number.isFinite(c.closedAt) ? c.closedAt : null,
  };
}
