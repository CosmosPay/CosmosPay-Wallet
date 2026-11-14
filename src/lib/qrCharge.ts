/**
 * Charging with a QR in local money: the seller's side of `/v1/onramp/p2p/payment-requests` (calls
 * in `src/lib/cosmospay.ts`, state in `src/state/useQrCharge.ts`, screen
 * `src/features/fiat/Charge.tsx`). The seller asks for an amount of local money; whoever scans the
 * QR opens the hosted page, pays with a local method through the same P2P purchase the ramp opens,
 * and the token is delivered straight to this wallet's own EVM account. Cosmos Pay never holds it.
 *
 * Everything here is pure, so `tests/unit/qrCharge.test.ts` pins it: what a charge may ask for, the
 * check that the request the API answered is the one asked for and pays this wallet, how a charge
 * reads at a given moment, and the rule that turns a rise in the wallet's own balance into
 * "payment received" — the only signal there is until the marketplace can tell the API.
 */
import type { ChainNet } from '@/constants/chains';
import {
  CHARGE_DESCRIPTION_MAX,
  CHARGE_LATE_WATCH_MS,
  CHARGE_PAID_SHARE_BPS,
  CHARGE_STORAGE_PREFIX,
  type ChargeStatus,
} from '@/constants/qrCharge';
import { fromMinorUnits, toMinorUnitsBig } from '@/lib/amount';
import { parseShape } from '@/lib/apiShape';
import { PaymentRequestShape } from '@/lib/cosmospayShapes';
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
  /** Only to the shared public key: reading or cancelling the request again needs it. */
  publicToken?: string;
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

/**
 * Where the QR may send the payer: an https page (plain http only on this machine, for a local
 * server) with no credentials in it, whose path ends in this request's own `/fiat/<id>`. The host
 * is the deployment's payments page and is not pinned: a self-hosted server names its own.
 */
export function chargeUrlOk(url: string, id: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return false;
  if (u.username || u.password) return false;
  return u.pathname.replace(/\/+$/, '').endsWith(`/fiat/${encodeURIComponent(id)}`);
}

export type ChargeProblem = 'order' | 'address' | 'url';

/**
 * Whether a request the API answered is the charge asked for and pays this wallet: the same
 * currency, amount, network and token, this wallet's own account as the recipient, and a page
 * `chargeUrlOk` accepts. Anything else would put a QR on screen that charges another amount or
 * pays someone else, so it is never shown.
 */
export function chargeRequestProblem(req: PaymentRequest, input: PaymentRequestInput): ChargeProblem | null {
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
  return chargeUrlOk(req.url, req.id) ? null : 'url';
}

/** Whether a later answer is about the same charge: the same id, order and recipient. */
export function sameCharge(a: PaymentRequest, b: PaymentRequest): boolean {
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

/** How the wallet learnt the charge was paid, and what arrived (a decimal of the token) when known. */
export interface ChargePaid {
  by: 'api' | 'balance';
  amount: string | null;
  at: number;
}

/**
 * The charge on screen, as the wallet keeps it — in storage, per wallet and mode
 * (`chargeStorageKey`), so a reload or a closed popup comes back to the same QR.
 */
export interface QrCharge {
  /** The request as last answered, without `publicToken` (kept apart) or the API's `qr`. */
  request: PaymentRequest;
  /** Made with the shared public key: reading or cancelling it again takes that key and `publicToken`. */
  shared: boolean;
  publicToken: string | null;
  /** This wallet's balance of the token in base units when the QR was shown (the lowest since); null until read. */
  baseline: string | null;
  paid: ChargePaid | null;
  /** When the wallet first saw it expired or cancelled; null while it is open. */
  closedAt: number | null;
}

/** The fields kept of an answer: not the API's `qr` (the wallet draws its own) nor `publicToken`. */
function keep(req: PaymentRequest): PaymentRequest {
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
  };
}

/** A charge just made. `baseline` is the balance read beside the request, when that read answered. */
export function newCharge(req: PaymentRequest, shared: boolean, baseline: bigint | null): QrCharge {
  return {
    request: keep(req),
    shared,
    publicToken: shared ? req.publicToken ?? null : null,
    baseline: baseline === null || baseline < 0n ? null : baseline.toString(),
    paid: req.status === 'paid' ? { by: 'api', amount: req.paidAmount ?? null, at: Date.parse(req.paidAt ?? '') || 0 } : null,
    closedAt: null,
  };
}

/**
 * What a charge is at `now`: paid as soon as either signal said so; otherwise the request's
 * status, an open one past its expiry being expired (the API reads it the same way).
 */
export function chargeStatus(charge: QrCharge, now: number): ChargeStatus {
  if (charge.paid) return 'paid';
  const { status, expiresAt } = charge.request;
  return status === 'open' && now >= Date.parse(expiresAt) ? 'expired' : status;
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
 * Whether the screen still asks the API and reads the balance: until the charge is paid — while it
 * is open, and for `CHARGE_LATE_WATCH_MS` after it expired or was cancelled, because a payer who
 * started just before is still paying and that money arrives all the same.
 */
export function chargeWatched(charge: QrCharge, now: number): boolean {
  const status = chargeStatus(charge, now);
  if (status === 'paid') return false;
  if (status === 'open') return true;
  const since = status === 'expired' ? Date.parse(charge.request.expiresAt) : charge.closedAt;
  return since === null || !Number.isFinite(since) || now - since < CHARGE_LATE_WATCH_MS;
}

/**
 * A charge after an answer from the API about it. An answer about another charge changes nothing.
 * A paid request settles the charge (`paidAmount` is what arrived, when the API knows it) unless
 * the balance already did — the first signal wins; any other status replaces the one kept.
 */
export function withRequest(charge: QrCharge, req: PaymentRequest, now: number): QrCharge {
  if (!sameCharge(charge.request, req)) return charge;
  const closing = (req.status === 'expired' || req.status === 'cancelled') && charge.closedAt === null;
  return {
    ...charge,
    request: keep(req),
    closedAt: closing ? now : charge.closedAt,
    paid: charge.paid ?? (req.status === 'paid' ? { by: 'api', amount: req.paidAmount ?? null, at: now } : null),
  };
}

export interface BalanceCheck {
  paid: boolean;
  /** What came in since the baseline, in base units. */
  received: bigint;
  /** The baseline to keep: lowered to the balance when money left meanwhile. */
  baseline: bigint;
}

/**
 * The rule that reads a payment off the wallet's own balance. A rise over the baseline counts as
 * the payment when it reaches `CHARGE_PAID_SHARE_BPS` of the estimate (the firm price the payer
 * gets can be a little under the market's), or when there is no estimate, any rise at all. Money
 * that left since the QR was shown lowers the baseline, so a payment counts from the lowest point.
 *
 * It cannot tell whose money it is: anything of that token arriving on that network meanwhile
 * reads as the payment. The API's own answer (`withRequest`) has no such blind spot, and wins
 * whenever it comes first.
 */
export function chargePaidByBalance(baseline: bigint, current: bigint, estimatedAmountOut: string | null, decimals: number): BalanceCheck {
  const base = current < baseline ? current : baseline;
  const received = current - base;
  if (received <= 0n) return { paid: false, received: 0n, baseline: base };
  const estimate = estimatedAmountOut === null ? null : toMinorUnitsBig(estimatedAmountOut, decimals);
  if (estimate === null || estimate <= 0n) return { paid: true, received, baseline: base };
  return { paid: received * 10_000n >= estimate * BigInt(CHARGE_PAID_SHARE_BPS), received, baseline: base };
}

const UNITS = /^\d+$/;

/**
 * A charge after a read of this wallet's balance of the token, in base units. The first read is
 * the baseline — the moment the QR was shown — and each later one goes through
 * `chargePaidByBalance`. A settled charge stays as it is.
 */
export function withBalance(charge: QrCharge, balance: bigint, now: number): QrCharge {
  if (charge.paid || balance < 0n) return charge;
  if (charge.baseline === null || !UNITS.test(charge.baseline)) return { ...charge, baseline: balance.toString() };
  const { tokenDecimals, estimatedAmountOut } = charge.request;
  const check = chargePaidByBalance(BigInt(charge.baseline), balance, estimatedAmountOut, tokenDecimals);
  return {
    ...charge,
    baseline: check.baseline.toString(),
    paid: check.paid ? { by: 'balance', amount: fromMinorUnits(check.received, tokenDecimals), at: now } : null,
  };
}

/* --------------------------------- storage --------------------------------- */

/** Where the charge on screen is kept: one per wallet and mode. */
export function chargeStorageKey(walletId: string, env: ChainNet): string {
  return `${CHARGE_STORAGE_PREFIX}.${walletId}.${env}`;
}

function parsePaid(raw: unknown): ChargePaid | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.by !== 'api' && p.by !== 'balance') return null;
  const amount = typeof p.amount === 'string' && /^\d+(\.\d+)?$/.test(p.amount) ? p.amount : null;
  const at = typeof p.at === 'number' && Number.isFinite(p.at) ? p.at : 0;
  return { by: p.by, amount, at };
}

/**
 * A charge read back from storage, checked like any input: the request against the API's own
 * contract and `chargeUrlOk`, the rest field by field. Whatever does not read is dropped (null),
 * never guessed — the person makes a new charge.
 */
export function parseStoredCharge(raw: unknown): QrCharge | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  let request: PaymentRequest;
  try {
    request = parseShape('storage', PaymentRequestShape, c.request) as PaymentRequest;
  } catch {
    return null;
  }
  if (typeof c.shared !== 'boolean' || !chargeUrlOk(request.url, request.id)) return null;
  return {
    request: keep(request),
    shared: c.shared,
    publicToken: c.shared && typeof c.publicToken === 'string' && c.publicToken ? c.publicToken : null,
    baseline: typeof c.baseline === 'string' && UNITS.test(c.baseline) ? c.baseline : null,
    paid: parsePaid(c.paid),
    closedAt: typeof c.closedAt === 'number' && Number.isFinite(c.closedAt) ? c.closedAt : null,
  };
}
