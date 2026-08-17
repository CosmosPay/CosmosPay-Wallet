/**
 * Pre-signature transaction guard.
 *
 * The wallet signs XDR envelopes it did not build: the CosmosPay gateway returns
 * one for every swap / liquidity / offramp operation, and a dapp hands one to the
 * approval window. Signing those blind means a compromised (or merely repointed)
 * server can obtain a signature over `setOptions{ signer: attacker }` or
 * `accountMerge` while the UI says "confirm swap".
 *
 * Two entry points:
 *   reviewTx(cfg, xdr)             -> a structured, renderable summary. Never throws
 *                                     on suspicious content; it reports it.
 *   assertSafeToSign(cfg, xdr, …)  -> reviewTx + hard refusals for the internal
 *                                     server-driven flows. Throws TxGuardError.
 *
 * IMPORTANT — the network passphrase is NEVER taken from the counterparty.
 * `TransactionBuilder.fromXDR` does not verify the passphrase (it isn't in the
 * envelope); it only decides which network's hash gets signed. Letting a dapp
 * choose it is how a "Testnet" approval produces a valid mainnet signature, so
 * `cfg` — the user's configured network — is the only accepted source.
 *
 * IMPORTANT — every check below reads DECODED SDK FIELDS, never `OpReview.rows`.
 * `rows` is presentation: Spanish labels, formatted values. An earlier version
 * recovered the amount by looking for a row labelled `'Importe'`, which meant an
 * i18n pass would have disabled the amount cap with the whole suite green.
 *
 * IMPORTANT — the guard fails CLOSED. An operation that moves value and cannot be
 * quantified, an envelope whose validity window is missing, an asset that does not
 * match what the user confirmed: all refusals. "Could not determine" is never
 * "no limit".
 */
import { FeeBumpTransaction, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import type { NetConfig } from '@/lib/stellar';
import type { AssetRef } from '@/lib/asset';
import { shortIssuer } from '@/lib/asset';
import { STELLAR_DECIMALS, toMinorUnitsBig } from '@/lib/amount';

/**
 * Which wallet flow is asking for a signature. `dapp` is reviewed, not allowlisted.
 *
 * `send` and `trustline` used to be here with their own `ALLOWED_OPS` rows and no
 * call site: the wallet builds both locally (`sendPayment`, `stellarAddTrustline`)
 * and never routes them through the guard. A dead row in a security allowlist reads
 * as coverage that does not exist, so they are gone until a flow needs them.
 */
export type SignIntent = 'swap' | 'lp-deposit' | 'lp-withdraw' | 'offramp' | 'dapp';

/**
 * Operations that can hand over the account itself, or move value in a way this
 * wallet cannot decode. None of the wallet's own flows ever needs one, so they are
 * refused outright; the dapp path renders them behind a red warning instead of
 * refusing, because legitimate dapps do use them.
 */
export const CRITICAL_OPS: readonly string[] = [
  'setOptions', // can add a signer or zero the master weight -> account takeover
  'accountMerge', // sends the whole balance and deletes the account
  'allowTrust',
  'setTrustLineFlags',
  'clawback',
  'clawbackClaimableBalance',
  'beginSponsoringFutureReserves',
  'endSponsoringFutureReserves',
  'revokeSponsorship',
  // Soroban. The wallet decodes the contract id and the function name and nothing
  // else, so it cannot tell "read a price" from "transfer my whole USDC balance"
  // through the asset's SAC. Unknown intent over a value-bearing interface is the
  // same risk class as handing over a signer.
  'invokeHostFunction',
  // Moves the balance out to someone else's claim, and the approval window used to
  // render it as a friendly label with no rows at all — a total drain shown as an
  // empty line.
  'createClaimableBalance',
  // Cannot take funds, but a bump to INT64_MAX makes the account permanently
  // unusable: no later transaction can ever reach a higher sequence number.
  'bumpSequence',
];

/**
 * Operations each internal flow may legitimately contain.
 *
 * `manageSellOffer` / `manageBuyOffer` / `createPassiveSellOffer` were removed from
 * `swap`: the gateway builds swaps as path payments, the wallet has no order-book
 * UI, and an offer's cost is a price ratio rather than a settled amount — so no
 * bound the user confirmed could be enforced against one. If a flow ever needs an
 * offer it gets its own entry with its own bound, not a hole in this one.
 */
const ALLOWED_OPS: Record<Exclude<SignIntent, 'dapp'>, readonly string[]> = {
  swap: ['pathPaymentStrictSend', 'pathPaymentStrictReceive', 'changeTrust'],
  'lp-deposit': ['liquidityPoolDeposit', 'changeTrust'],
  'lp-withdraw': ['liquidityPoolWithdraw', 'changeTrust'],
  offramp: ['payment', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'],
};

/**
 * Fee ceiling for the internal flows, in stroops (1 XLM). Base fee is 100 stroops
 * per operation, so this is ~5 orders of magnitude of headroom — it exists only to
 * stop a fee-drain envelope, not to second-guess congestion pricing.
 */
const MAX_FEE_STROOPS = 10_000_000;

/**
 * Operation ceiling for the internal flows. Stellar allows 100 per transaction; the
 * fattest thing any of these flows builds is a trustline plus a settlement, so this
 * is already generous. Without it the per-asset total below would still hold, but a
 * hundred-operation envelope is by itself evidence the gateway is not doing what the
 * screen said.
 */
const MAX_OPS = 8;

/**
 * How long a server-built envelope may stay signable, in seconds.
 *
 * An envelope with no `maxTime` never expires: the counterparty submits these, so it
 * can hold a valid signature and send it when the market has moved. Stellar's replay
 * protection is the sequence number, which only helps once the account has moved on.
 * These flows broadcast within seconds, so fifteen minutes is already generous — the
 * first version allowed 24 hours, which is 24 hours of free optionality handed to
 * the counterparty on a quote that expired in seconds.
 */
const MAX_VALIDITY_S = 15 * 60;

/**
 * Clock skew tolerated at BOTH ends of the window, in seconds.
 *
 * `Date.now()` on a phone is not NTP-disciplined. Applying the allowance only to the
 * expiry test meant a device running three minutes fast rejected every envelope the
 * gateway ever sent, with a message blaming the server. It is added to the expiry
 * check and to the validity budget alike.
 */
const CLOCK_SKEW_S = 5 * 60;

/**
 * Rounding tolerance on the confirmed bounds, in basis points. Absorbs the server
 * rounding a quote to Stellar's 7 decimal places; nothing wider.
 */
const BOUND_TOLERANCE_BPS = 100n; // 1%

export class TxGuardError extends Error {
  readonly review: TxReview | null;
  constructor(message: string, review: TxReview | null = null) {
    super(message);
    this.name = 'TxGuardError';
    this.review = review;
  }
}

/**
 * One amount an operation moves, decoded from the envelope.
 * `asset` is null when the operation names an amount but not the asset it is
 * denominated in — pool shares, and the two sides of a pool deposit, which are
 * identified by the pool id rather than by a (code, issuer) pair.
 */
export interface OpValue {
  amount: string;
  asset: AssetRef | null;
}

/** One operation, flattened for both checking and rendering. */
export interface OpReview {
  type: string;
  /** Explicit op source, when it differs from the transaction source. */
  source: string | null;
  /** Counterparty account, when the operation has one. */
  destination: string | null;
  /** True when this operation takes value out of the account. */
  movesValue: boolean;
  /**
   * The upper bound on what leaves, per asset, decoded from the SDK. Empty on a
   * `movesValue` operation means the guard could not quantify it — which is a
   * refusal, not an exemption.
   */
  sends: OpValue[];
  /** The floor on what comes back, when the operation guarantees one. */
  receives: OpValue[];
  /** The trustline a `changeTrust` touches: an asset, or null for pool shares. */
  line: AssetRef | null;
  /** True when `changeTrust` opens a liquidity-pool share trustline. */
  linePoolShare: boolean;
  /** True when `changeTrust` sets a limit of 0, i.e. removes the trustline. */
  lineRemoves: boolean;
  /** The pool a liquidity operation acts on, when it names one. */
  poolId: string | null;
  /** Human rows for the approval UI, already formatted. NEVER read by a check. */
  rows: { label: string; value: string }[];
  /** True when this op belongs to CRITICAL_OPS. */
  critical: boolean;
}

export interface TxReview {
  source: string;
  /** Total envelope fee in stroops. */
  fee: string;
  feeXlm: string;
  sequence: string;
  memo: string;
  memoType: string;
  /** Validity window as unix seconds, null when the envelope sets none. */
  minTime: string | null;
  maxTime: string | null;
  operations: OpReview[];
  signatures: number;
  /** Set when the envelope is a fee-bump wrapper; the ops come from the inner tx. */
  feeBumpSource: string | null;
  /** True when any operation is in CRITICAL_OPS. */
  hasCritical: boolean;
  /** The network the signature will be valid on — always the wallet's own. */
  networkLabel: string;
}

/* ------------------------------- formatting ------------------------------- */

const short = (s: string, n = 6) => (s && s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s || '—');

/**
 * `Asset` -> `AssetRef`, or null when the value is not a classic asset (a
 * liquidity-pool share, or something the SDK reshaped between versions).
 */
function assetRefOf(asset: unknown): AssetRef | null {
  if (!asset || typeof asset !== 'object') return null;
  const a = asset as { getCode?: () => string; getIssuer?: () => string; code?: string; issuer?: string };
  let code = '';
  let issuer = '';
  try {
    code = (typeof a.getCode === 'function' ? a.getCode() : a.code) ?? '';
    issuer = (typeof a.getIssuer === 'function' ? a.getIssuer() : a.issuer) ?? '';
  } catch {
    return null; // pool-share assets throw on the classic accessors
  }
  if (!code) return null;
  return { code, issuer: issuer || null };
}

/** True for a liquidity-pool share asset, which has no (code, issuer) identity. */
function isPoolShare(asset: unknown): boolean {
  if (!asset || typeof asset !== 'object') return false;
  const a = asset as { getLiquidityPoolParameters?: unknown; getLiquidityPoolId?: unknown };
  return typeof a.getLiquidityPoolParameters === 'function' || typeof a.getLiquidityPoolId === 'function';
}

/** `AssetRef` -> "XLM" or "USDC (GA1B…X9)". */
function refLabel(ref: AssetRef | null): string {
  if (!ref) return '—';
  return ref.issuer ? `${ref.code} (${shortIssuer(ref.issuer)})` : ref.code;
}

/** Display label for anything the SDK hands us as an asset. */
function assetLabel(asset: unknown): string {
  if (isPoolShare(asset)) return 'Participaciones de pool';
  return refLabel(assetRefOf(asset));
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Best-effort Soroban summary: contract id and function name, or nothing. */
function sorobanRows(o: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  try {
    const fn = o.func as { invokeContract?: () => { contractAddress: () => unknown; functionName: () => unknown } } | undefined;
    const call = typeof fn?.invokeContract === 'function' ? fn.invokeContract() : null;
    if (call) {
      const addr = call.contractAddress?.();
      const name = call.functionName?.();
      const id = typeof addr === 'string' ? addr : String((addr as { toString?: () => string })?.toString?.() ?? '');
      const fname = name instanceof Uint8Array ? new TextDecoder().decode(name) : String(name ?? '');
      if (id) rows.push({ label: 'Contrato', value: short(id, 8) });
      if (fname) rows.push({ label: 'Función', value: fname });
    }
  } catch {
    /* the host-function union reshapes between SDK minors; a missing row is fine */
  }
  return rows;
}

/**
 * Flatten one operation. The SDK types the operation union very loosely across
 * versions, so fields are read defensively rather than via a per-type narrowing
 * that would break on the next minor.
 */
function reviewOp(raw: unknown): OpReview {
  const o = (raw ?? {}) as Record<string, unknown>;
  const type = String(o.type ?? 'unknown');
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value != null && value !== '') rows.push({ label, value });
  };

  let movesValue = false;
  const sends: OpValue[] = [];
  const receives: OpValue[] = [];
  let line: AssetRef | null = null;
  let linePoolShare = false;
  let lineRemoves = false;
  const poolId = str(o.liquidityPoolId);

  /** Record a decoded amount, dropping the entry when the amount is unreadable. */
  const moves = (list: OpValue[], amount: unknown, asset: AssetRef | null) => {
    const a = str(amount);
    if (a) list.push({ amount: a, asset });
  };

  switch (type) {
    case 'payment':
      movesValue = true;
      moves(sends, o.amount, assetRefOf(o.asset));
      push('Destino', str(o.destination));
      push('Importe', `${String(o.amount ?? '')} ${assetLabel(o.asset)}`.trim());
      break;
    case 'createAccount':
      movesValue = true;
      moves(sends, o.startingBalance, { code: 'XLM', issuer: null });
      push('Cuenta nueva', str(o.destination));
      push('Saldo inicial', `${String(o.startingBalance ?? '')} XLM`);
      break;
    case 'pathPaymentStrictSend':
      movesValue = true;
      moves(sends, o.sendAmount, assetRefOf(o.sendAsset));
      moves(receives, o.destMin, assetRefOf(o.destAsset));
      push('Destino', str(o.destination));
      push('Envías', `${String(o.sendAmount ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push('Recibe (mínimo)', `${String(o.destMin ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'pathPaymentStrictReceive':
      movesValue = true;
      moves(sends, o.sendMax, assetRefOf(o.sendAsset));
      moves(receives, o.destAmount, assetRefOf(o.destAsset));
      push('Destino', str(o.destination));
      push('Envías (máximo)', `${String(o.sendMax ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push('Recibe', `${String(o.destAmount ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'changeTrust':
      line = assetRefOf(o.line);
      linePoolShare = isPoolShare(o.line);
      // The SDK pads the limit to 7 decimals, so "delete" arrives as "0.0000000".
      lineRemoves = toMinorUnitsBig(String(o.limit ?? ''), STELLAR_DECIMALS) === 0n;
      push('Activo', assetLabel(o.line));
      push('Límite', lineRemoves ? 'ELIMINAR trustline' : String(o.limit ?? ''));
      break;
    case 'liquidityPoolDeposit':
      // The two sides are identified by the pool id, not by a (code, issuer) pair.
      movesValue = true;
      moves(sends, o.maxAmountA, null);
      moves(sends, o.maxAmountB, null);
      push('Pool', short(String(o.liquidityPoolId ?? ''), 8));
      push('Máximo A', str(o.maxAmountA));
      push('Máximo B', str(o.maxAmountB));
      // The price band decides the execution; it used to be decoded by nobody.
      push('Precio mínimo', priceLabel(o.minPrice));
      push('Precio máximo', priceLabel(o.maxPrice));
      break;
    case 'liquidityPoolWithdraw':
      movesValue = true;
      moves(sends, o.amount, null); // pool shares leave the account
      moves(receives, o.minAmountA, null);
      moves(receives, o.minAmountB, null);
      push('Pool', short(String(o.liquidityPoolId ?? ''), 8));
      push('Participaciones', str(o.amount));
      push('Mínimo A', str(o.minAmountA));
      push('Mínimo B', str(o.minAmountB));
      break;
    case 'createClaimableBalance':
      movesValue = true;
      moves(sends, o.amount, assetRefOf(o.asset));
      push('Importe bloqueado', `${String(o.amount ?? '')} ${assetLabel(o.asset)}`.trim());
      push('Reclamantes', claimantsLabel(o.claimants));
      break;
    case 'claimClaimableBalance':
      push('Saldo reclamado', short(String(o.balanceId ?? ''), 8));
      break;
    case 'bumpSequence':
      push('Nueva secuencia', String(o.bumpTo ?? ''));
      break;
    case 'accountMerge':
      movesValue = true; // the entire balance, unquantifiable from the envelope
      push('Fusiona la cuenta en', str(o.destination));
      break;
    case 'setOptions': {
      const signer = o.signer as { ed25519PublicKey?: string; weight?: number } | undefined;
      if (signer?.ed25519PublicKey) push('Añade firmante', `${signer.ed25519PublicKey} (peso ${signer.weight ?? '?'})`);
      if (o.masterWeight != null) push('Peso de tu clave', String(o.masterWeight));
      if (o.lowThreshold != null) push('Umbral bajo', String(o.lowThreshold));
      if (o.medThreshold != null) push('Umbral medio', String(o.medThreshold));
      if (o.highThreshold != null) push('Umbral alto', String(o.highThreshold));
      if (o.homeDomain != null) push('Dominio', String(o.homeDomain));
      break;
    }
    case 'manageSellOffer':
    case 'manageBuyOffer':
    case 'createPassiveSellOffer':
      // An offer's cost is a price ratio, not a settled amount: what actually leaves
      // depends on the book at execution time. Marked as moving value with nothing
      // quantified, so any flow that reaches one refuses it.
      movesValue = true;
      push('Vende', assetLabel(o.selling));
      push('Compra', assetLabel(o.buying));
      push('Cantidad', str(o.amount) ?? str(o.buyAmount));
      push('Precio', str(o.price));
      break;
    case 'manageData':
      push('Clave', str(o.name));
      push('Valor', o.value == null ? 'BORRAR' : '(binario)');
      break;
    case 'invokeHostFunction': {
      movesValue = true; // may transfer through an asset's SAC; not decodable here
      const soroban = sorobanRows(o);
      if (soroban.length) rows.push(...soroban);
      else push('Contrato', 'Invocación de contrato Soroban (no legible)');
      break;
    }
    default:
      // Fail OPEN was the old behaviour here: an operation type this switch does not
      // know left `movesValue = false`, so every downstream check treated it as
      // harmless. An operation the wallet cannot read is the one most likely to be
      // doing something it should not.
      movesValue = true;
      push('Operación', 'La wallet no sabe leer esta operación');
      break;
  }

  return {
    type,
    source: str(o.source),
    destination: str(o.destination),
    movesValue,
    sends,
    receives,
    line,
    linePoolShare,
    lineRemoves,
    poolId,
    rows,
    critical: CRITICAL_OPS.includes(type),
  };
}

/** Stellar prices arrive as a string or as an `{n, d}` rational. */
function priceLabel(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  const r = v as { n?: unknown; d?: unknown };
  return r.n != null && r.d != null ? `${String(r.n)}/${String(r.d)}` : null;
}

/** "GABC…XYZ +2" — enough to see the money is going somewhere else. */
function claimantsLabel(v: unknown): string | null {
  if (!Array.isArray(v) || !v.length) return null;
  const first = (v[0] as { destination?: unknown })?.destination;
  const head = typeof first === 'string' ? short(first) : '—';
  return v.length > 1 ? `${head} +${v.length - 1}` : head;
}

function memoOf(tx: Transaction): { memo: string; memoType: string } {
  const m = (tx as unknown as { memo?: { type?: string; value?: unknown } }).memo;
  if (!m || m.value == null) return { memo: '', memoType: 'none' };
  const type = String(m.type ?? 'text');
  try {
    const v = m.value;
    // MEMO_HASH / MEMO_RETURN carry raw bytes; show them as hex, not mojibake.
    const memo =
      v instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(v))
        ? Buffer.from(v as Uint8Array).toString('hex')
        : String(v);
    return { memo, memoType: type };
  } catch {
    return { memo: '', memoType: type };
  }
}

/** The envelope's validity window, as unix-second strings. */
function timeBoundsOf(tx: Transaction): { minTime: string | null; maxTime: string | null } {
  const tb = (tx as unknown as { timeBounds?: { minTime?: unknown; maxTime?: unknown } | null }).timeBounds;
  const read = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v);
    // The SDK writes an unset bound as "0"; that is "no bound", not "epoch".
    return /^\d+$/.test(s) && s !== '0' ? s : null;
  };
  return { minTime: read(tb?.minTime), maxTime: read(tb?.maxTime) };
}

/* --------------------------------- review -------------------------------- */

/**
 * Decode `xdr` against the wallet's own network and flatten it for display.
 * Throws only when the envelope cannot be parsed at all.
 */
export function reviewTx(cfg: NetConfig, xdr: string): TxReview {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  } catch {
    throw new TxGuardError('No se pudo decodificar la transacción (XDR inválido).');
  }

  let feeBumpSource: string | null = null;
  let tx: Transaction;
  let fee: string;
  if (parsed instanceof FeeBumpTransaction) {
    feeBumpSource = parsed.feeSource;
    tx = parsed.innerTransaction;
    fee = String(parsed.fee ?? '0');
  } else {
    tx = parsed;
    fee = String(parsed.fee ?? '0');
  }

  const rawOps = (tx as unknown as { operations?: unknown[] }).operations;
  const operations = (Array.isArray(rawOps) ? rawOps : []).map(reviewOp);
  const { memo, memoType } = memoOf(tx);
  const { minTime, maxTime } = timeBoundsOf(tx);
  const feeNum = Number(fee);

  return {
    source: tx.source ?? '',
    fee,
    feeXlm: Number.isFinite(feeNum) ? (feeNum / 1e7).toFixed(7).replace(/\.?0+$/, '') : fee,
    sequence: String((tx as unknown as { sequence?: unknown }).sequence ?? ''),
    memo,
    memoType,
    minTime,
    maxTime,
    operations,
    signatures: Array.isArray(tx.signatures) ? tx.signatures.length : 0,
    feeBumpSource,
    hasCritical: operations.some((o) => o.critical),
    networkLabel: cfg.label,
  };
}

/* --------------------------------- assert -------------------------------- */

/**
 * The asset a confirmed bound is denominated in.
 *
 * `issuer` is deliberately three-valued. `undefined` means the flow cannot know the
 * issuer — the off-ramp gateway picks its own stablecoin — so only the code is
 * matched; `null` means the native asset; a string must match exactly. What is gone
 * is the old prefix match on a bare code, where `USD` validated against `USDC` and
 * any impostor issuer of a real code passed as the genuine one.
 */
export interface AssetBound {
  code: string;
  issuer?: string | null;
}

/**
 * Where value is allowed to land.
 *   'self'         every operation with a destination must target the signer. Swaps
 *                  and liquidity settle back into the same account, so this is the
 *                  right answer for all of them.
 *   'counterparty' exactly one distinct third-party destination is tolerated, for a
 *                  flow that genuinely pays out to an address it cannot know in
 *                  advance (the off-ramp). The amount bound is what limits it.
 *   string[]       the destinations the user actually confirmed.
 */
export type DestinationPolicy = 'self' | 'counterparty' | readonly string[];

/** An amount the user confirmed, with the asset it is denominated in. */
export interface AmountBound {
  amount: string;
  asset: AssetBound;
}

interface GuardBase {
  /** The account that is about to sign. Every op must act on it and nothing else. */
  signer: string;
  /**
   * Required, with no default: the critical hole this guard shipped with was that
   * nothing ever read `op.destination`, so a swap could send the exact quoted amount
   * to an attacker and pass every other check. A new flow has to state its policy.
   */
  destinations: DestinationPolicy;
  /**
   * Extra assets this flow may open a trustline for, beyond the ones named by
   * `maxSend` / `minReceive`.
   */
  trustlines?: readonly AssetBound[];
  /** Unix seconds; injectable so the validity-window checks are testable. */
  now?: number;
}

/**
 * What each flow must state before the guard will let it sign.
 *
 * **A discriminated union, not an object of optionals.** With `maxSend` optional, the
 * guard was only ever as strict as its weakest caller — and of the four real callers,
 * two (liquidity) passed no bound at all and one (off-ramp) chose `undefined` when
 * the quote field was missing, which is the "could not determine means no limit"
 * failure the module header says is impossible. Now the ceilings are part of the
 * intent's type: a liquidity withdrawal with no bounds does not compile.
 *
 * Every amount here must come from what the USER saw and confirmed — the typed
 * amount, the quote the screen rendered — never from the same response that carried
 * the XDR. Bounding a gateway's envelope with the gateway's own numbers checks
 * nothing at all.
 */
export type GuardOptions =
  | (GuardBase & {
      intent: 'swap';
      /** What the user typed. Enforced against the TOTAL leaving, not per operation. */
      maxSend: AmountBound;
      /** The "minimum received" the quote screen showed. */
      minReceive: AmountBound;
    })
  | (GuardBase & {
      intent: 'offramp';
      maxSend: AmountBound;
    })
  | (GuardBase & {
      intent: 'lp-deposit';
      /**
       * The per-side ceilings the user confirmed. Pool amounts are identified by the
       * pool id rather than by an asset, so they are matched as a multiset: each
       * amount leaving must be covered by one of these, order-independent.
       */
      poolAmounts: readonly string[];
    })
  | (GuardBase & {
      intent: 'lp-withdraw';
      /** The pool the user chose. The envelope must act on that one. */
      poolId: string;
      poolAmounts: readonly string[];
    });

/** Does a decoded asset satisfy a confirmed bound? Never a prefix match. */
function assetMatches(ref: AssetRef | null, bound: AssetBound): boolean {
  if (!ref) return false;
  if (ref.code !== bound.code) return false;
  if (bound.issuer === undefined) return true;
  return (ref.issuer ?? null) === (bound.issuer ?? null);
}

/** Stroops, or null when the decimal string is not one the wallet will act on. */
function stroops(amount: string): bigint | null {
  return toMinorUnitsBig(amount, STELLAR_DECIMALS);
}

/**
 * Decode, verify, and either return the review or refuse. Refusals are hard:
 * a transaction the wallet cannot explain is a transaction the wallet does not sign.
 */
export function assertSafeToSign(cfg: NetConfig, xdr: string, opts: GuardOptions): TxReview {
  const review = reviewTx(cfg, xdr);
  // The annotation goes on the VARIABLE, not on the arrow's return position: TypeScript
  // only treats a call as never-returning when the callee's declared type says so, and
  // `const fail = (m: string): never => …` is not that. Written the other way the
  // compiler stopped narrowing after every refusal, which is why this function used to
  // need three `as bigint` casts to compile — casts that would have silently swallowed
  // a `null` the moment `fail` stopped throwing.
  const fail: (msg: string) => never = (msg) => {
    throw new TxGuardError(msg, review);
  };

  // A fee bump lets a third party wrap and re-broadcast; no internal flow builds one.
  if (review.feeBumpSource) {
    fail('La transacción viene envuelta en un fee-bump. La wallet no firma envoltorios de terceros.');
  }

  if (review.source !== opts.signer) {
    fail(`La transacción no sale de tu cuenta (origen: ${short(review.source)}). Firma rechazada.`);
  }

  if (!review.operations.length) {
    fail('La transacción no contiene ninguna operación.');
  }

  if (review.operations.length > MAX_OPS) {
    fail(`La transacción contiene ${review.operations.length} operaciones, más de las que esta acción necesita. Firma rechazada.`);
  }

  const feeNum = Number(review.fee);
  if (!Number.isFinite(feeNum) || feeNum < 0 || feeNum > MAX_FEE_STROOPS) {
    fail(`La comisión de la transacción es anómala (${review.feeXlm} XLM). Firma rechazada.`);
  }

  /* -------- validity window: a signature that never expires is a liability ------- */
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!review.maxTime) {
    fail('La transacción no caduca nunca (sin límite temporal). Una firma sin caducidad puede reenviarse cuando le convenga a la contraparte. Firma rechazada.');
  }
  const maxTime = Number(review.maxTime);
  if (!Number.isFinite(maxTime)) {
    fail('El límite temporal de la transacción no es legible. Firma rechazada.');
  }
  if (maxTime + CLOCK_SKEW_S < now) {
    fail('La transacción ya ha caducado. Vuelve a pedir la cotización.');
  }
  // A post-dated envelope is the same free option as a never-expiring one: the
  // counterparty submits these, so `minTime` in the future hands it the wait. Checked
  // before the width test so the refusal names the actual problem.
  const minTime = review.minTime ? Number(review.minTime) : 0;
  if (Number.isFinite(minTime) && minTime > now + CLOCK_SKEW_S) {
    fail('La transacción no es válida hasta más tarde. Firma rechazada.');
  }
  if (maxTime - now > MAX_VALIDITY_S + CLOCK_SKEW_S) {
    fail('La transacción sigue siendo válida durante demasiado tiempo. Firma rechazada.');
  }

  /* --------------------------- per-operation checks --------------------------- */
  const allowed = ALLOWED_OPS[opts.intent];
  const maxSend = opts.intent === 'swap' || opts.intent === 'offramp' ? opts.maxSend : null;
  const minReceive = opts.intent === 'swap' ? opts.minReceive : null;
  const poolAmounts = opts.intent === 'lp-deposit' || opts.intent === 'lp-withdraw' ? opts.poolAmounts : null;
  const expectedPool = opts.intent === 'lp-withdraw' ? opts.poolId : null;
  const isLiquidity = opts.intent === 'lp-deposit' || opts.intent === 'lp-withdraw';
  const declared: AssetBound[] = [
    ...(maxSend ? [maxSend.asset] : []),
    ...(minReceive ? [minReceive.asset] : []),
    ...(opts.trustlines ?? []),
  ];
  const counterparties = new Set<string>();

  for (const op of review.operations) {
    if (op.critical) {
      fail(`La transacción contiene una operación crítica (${op.type}) que podría dar control de tu cuenta a un tercero. Firma rechazada.`);
    }
    if (!allowed.includes(op.type)) {
      fail(`La transacción contiene una operación inesperada para esta acción (${op.type}). Firma rechazada.`);
    }
    // An op may omit its source (inherits the tx source); if it sets one, it must be us.
    if (op.source && op.source !== opts.signer) {
      fail(`Una operación actúa sobre otra cuenta (${short(op.source)}). Firma rechazada.`);
    }

    /* where the money lands */
    if (op.destination && op.destination !== opts.signer) {
      if (opts.destinations === 'self') {
        fail(`La operación envía el dinero a otra cuenta (${short(op.destination)}), no a la tuya. Firma rechazada.`);
      } else if (opts.destinations === 'counterparty') {
        counterparties.add(op.destination);
        if (counterparties.size > 1) {
          fail('La transacción reparte el dinero entre varios destinatarios. Firma rechazada.');
        }
      } else if (!opts.destinations.includes(op.destination)) {
        fail(`La operación envía el dinero a un destino que no confirmaste (${short(op.destination)}). Firma rechazada.`);
      }
    }

    /* an operation that moves value must say how much, in what */
    if (op.movesValue && !op.sends.length) {
      fail(`La wallet no puede determinar cuánto mueve una de las operaciones (${op.type}). Firma rechazada.`);
    }

    /* a trustline must be one the flow confirmed */
    if (op.type === 'changeTrust') {
      if (op.linePoolShare) {
        // Checked BEFORE `lineRemoves`: closing a pool position legitimately ends with
        // `changeTrust(shares, 0)` to recover the 0.5 XLM reserve, and testing removal
        // first refused every full exit.
        if (!isLiquidity) {
          fail('La transacción abre una línea de participaciones de pool fuera de un flujo de liquidez. Firma rechazada.');
        }
      } else if (op.lineRemoves) {
        fail('La transacción elimina una línea de confianza. Firma rechazada.');
      } else if (!declared.some((b) => assetMatches(op.line, b))) {
        fail(`La transacción abre una línea de confianza para un activo que no confirmaste (${refLabel(op.line)}). Firma rechazada.`);
      }
    }

    /* liquidity: the envelope must act on the pool the user picked */
    if (expectedPool && (op.type === 'liquidityPoolWithdraw' || op.type === 'liquidityPoolDeposit')) {
      if (op.poolId !== expectedPool) {
        fail(`La operación actúa sobre un pool distinto del que elegiste (${short(op.poolId ?? '', 8)}). Firma rechazada.`);
      }
    }

    /* liquidity: a withdrawal that guarantees nothing back is never legitimate */
    if (op.type === 'liquidityPoolWithdraw') {
      if (!op.receives.length) {
        fail('El retiro de liquidez no declara un mínimo a recibir. Firma rechazada.');
      }
      for (const v of op.receives) {
        const n = stroops(v.amount);
        if (n === null || n <= 0n) {
          fail('El retiro de liquidez garantiza recibir cero. Firma rechazada.');
        }
      }
    }
  }

  /* ------------------------------ amount bounds ------------------------------ */
  if (maxSend) {
    const cap = stroops(maxSend.amount);
    if (cap === null || cap <= 0n) {
      fail('El importe confirmado no es legible, así que la wallet no puede acotar la transacción. Firma rechazada.');
    }
    let total = 0n;
    for (const op of review.operations) {
      for (const v of op.sends) {
        if (!assetMatches(v.asset, maxSend.asset)) {
          fail(`La transacción mueve ${refLabel(v.asset)}, que no es el activo que confirmaste (${maxSend.asset.code}). Firma rechazada.`);
        }
        const n = stroops(v.amount);
        if (n === null) {
          fail('Una de las cantidades de la transacción no es legible. Firma rechazada.');
        }
        total += n;
      }
    }
    // Compared as integers, and against the total: `moved > cap * (1 + tolerance)`.
    if (total * 10_000n > cap * (10_000n + BOUND_TOLERANCE_BPS)) {
      fail(`La transacción mueve más de lo confirmado (${maxSend.amount} ${maxSend.asset.code}). Firma rechazada.`);
    }
  }

  if (minReceive) {
    const floor = stroops(minReceive.amount);
    if (floor === null || floor <= 0n) {
      fail('El importe a recibir no es legible, así que la wallet no puede acotar la transacción. Firma rechazada.');
    }
    let total = 0n;
    let seen = false;
    for (const op of review.operations) {
      for (const v of op.receives) {
        if (!assetMatches(v.asset, minReceive.asset)) continue;
        const n = stroops(v.amount);
        if (n === null) {
          fail('Una de las cantidades a recibir no es legible. Firma rechazada.');
        }
        total += n;
        seen = true;
      }
    }
    if (!seen) {
      fail(`La transacción no garantiza que recibas ${minReceive.asset.code}. Firma rechazada.`);
    }
    // `total < floor * (1 - tolerance)`, as integers.
    if (total * 10_000n < floor * (10_000n - BOUND_TOLERANCE_BPS)) {
      fail(`La transacción sólo garantiza recibir menos de lo cotizado (${minReceive.amount} ${minReceive.asset.code}). Firma rechazada.`);
    }
  }

  /* --------------------------- liquidity: pool sides -------------------------- */
  if (poolAmounts) {
    // Pool amounts carry no asset, so they cannot be summed the way `maxSend` sums a
    // single asset: 10 XLM and 5 USDC add up to nothing meaningful. They are matched
    // as a multiset against the ceilings the user confirmed — each amount leaving must
    // be covered by one unused ceiling, whatever order the pool's canonical A/B takes.
    const ceilings: bigint[] = [];
    for (const a of poolAmounts) {
      const n = stroops(a);
      if (n === null || n <= 0n) {
        fail('Los importes de liquidez confirmados no son legibles. Firma rechazada.');
      }
      ceilings.push(n);
    }
    const used = ceilings.map(() => false);
    for (const op of review.operations) {
      for (const v of op.sends) {
        const n = stroops(v.amount);
        if (n === null) {
          fail('Una de las cantidades de la transacción no es legible. Firma rechazada.');
        }
        // Consume the tightest ceiling that still covers this amount.
        let best = -1;
        for (let i = 0; i < ceilings.length; i++) {
          if (used[i] || ceilings[i] * (10_000n + BOUND_TOLERANCE_BPS) < n * 10_000n) continue;
          if (best === -1 || ceilings[i] < ceilings[best]) best = i;
        }
        if (best === -1) {
          fail(`La operación de liquidez mueve ${v.amount}, más de lo que confirmaste. Firma rechazada.`);
        }
        used[best] = true;
      }
    }
  }

  return review;
}
