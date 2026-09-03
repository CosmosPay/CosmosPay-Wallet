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
 * `rows` is presentation: translated labels, formatted values. An earlier version
 * recovered the amount by looking for a row labelled `'Importe'`, which meant an
 * i18n pass would have disabled the amount cap with the whole suite green. That
 * i18n pass has since happened — every label and every refusal below is a `guard.*`
 * key resolved through `tNow`, so the hazard is no longer hypothetical.
 *
 * IMPORTANT — the guard fails CLOSED. An operation that moves value and cannot be
 * quantified, an envelope whose validity window is missing, an asset that does not
 * match what the user confirmed: all refusals. "Could not determine" is never
 * "no limit".
 */
import {
  Asset,
  FeeBumpTransaction,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  TransactionBuilder,
  getLiquidityPoolId,
  type Transaction,
} from '@stellar/stellar-sdk';
import type { NetConfig } from '@/lib/stellar';
import type { AssetRef } from '@/lib/asset';
import { shortIssuer } from '@/lib/asset';
import { STELLAR_DECIMALS, toMinorUnitsBig } from '@/lib/amount';
import { tNow } from '@/lib/i18n';
import {
  ALLOWED_OPS,
  BOUND_TOLERANCE_BPS,
  CLOCK_SKEW_S,
  CRITICAL_OPS,
  MAX_FEE_STROOPS,
  MAX_OPS,
  MAX_VALIDITY_S,
  type SignIntent,
} from '@/constants/txGuard';

/* Re-exported so the guard stays the one import a signing flow needs; the values
   themselves live in constants/, per the rule in CLAUDE.md. */
export { CRITICAL_OPS, CLOCK_SKEW_S, MAX_FEE_STROOPS, MAX_OPS, MAX_VALIDITY_S };
export type { SignIntent };


/**
 * A refusal. `message` is already resolved for the active language, so any caller
 * that only knows how to show `e.message` keeps working; `key` and `params` are kept
 * alongside it for a caller that wants to re-render on a language change, and because
 * a `guard.*` key is what a developer greps for when a refusal reaches them.
 */
export class TxGuardError extends Error {
  readonly review: TxReview | null;
  readonly key: string;
  readonly params: Record<string, string | number> | undefined;
  constructor(
    key: string,
    params?: Record<string, string | number>,
    review: TxReview | null = null,
  ) {
    super(tNow(key, params));
    this.name = 'TxGuardError';
    this.review = review;
    this.key = key;
    this.params = params;
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
      if (id) rows.push({ label: tNow('guard.row.contract'), value: short(id, 8) });
      if (fname) rows.push({ label: tNow('guard.row.function'), value: fname });
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
      push(tNow('guard.row.destination'), str(o.destination));
      push(tNow('guard.row.amount'), `${String(o.amount ?? '')} ${assetLabel(o.asset)}`.trim());
      break;
    case 'createAccount':
      movesValue = true;
      moves(sends, o.startingBalance, { code: 'XLM', issuer: null });
      push(tNow('guard.row.newAccount'), str(o.destination));
      push(tNow('guard.row.startingBalance'), `${String(o.startingBalance ?? '')} XLM`);
      break;
    case 'pathPaymentStrictSend':
      movesValue = true;
      moves(sends, o.sendAmount, assetRefOf(o.sendAsset));
      moves(receives, o.destMin, assetRefOf(o.destAsset));
      push(tNow('guard.row.destination'), str(o.destination));
      push(tNow('guard.row.youSend'), `${String(o.sendAmount ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push(tNow('guard.row.receivesMin'), `${String(o.destMin ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'pathPaymentStrictReceive':
      movesValue = true;
      moves(sends, o.sendMax, assetRefOf(o.sendAsset));
      moves(receives, o.destAmount, assetRefOf(o.destAsset));
      push(tNow('guard.row.destination'), str(o.destination));
      push(tNow('guard.row.youSendMax'), `${String(o.sendMax ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push(tNow('guard.row.receives'), `${String(o.destAmount ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'changeTrust':
      line = assetRefOf(o.line);
      linePoolShare = isPoolShare(o.line);
      // The SDK pads the limit to 7 decimals, so "delete" arrives as "0.0000000".
      lineRemoves = toMinorUnitsBig(String(o.limit ?? ''), STELLAR_DECIMALS) === 0n;
      push(tNow('guard.row.asset'), assetLabel(o.line));
      push(tNow('guard.row.limit'), lineRemoves ? tNow('guard.val.removeTrustline') : String(o.limit ?? ''));
      break;
    case 'liquidityPoolDeposit':
      // The two sides are identified by the pool id, not by a (code, issuer) pair.
      movesValue = true;
      moves(sends, o.maxAmountA, null);
      moves(sends, o.maxAmountB, null);
      push(tNow('guard.row.pool'), short(String(o.liquidityPoolId ?? ''), 8));
      push(tNow('guard.row.maxA'), str(o.maxAmountA));
      push(tNow('guard.row.maxB'), str(o.maxAmountB));
      // The price band decides the execution; it used to be decoded by nobody.
      push(tNow('guard.row.minPrice'), priceLabel(o.minPrice));
      push(tNow('guard.row.maxPrice'), priceLabel(o.maxPrice));
      break;
    case 'liquidityPoolWithdraw':
      movesValue = true;
      moves(sends, o.amount, null); // pool shares leave the account
      moves(receives, o.minAmountA, null);
      moves(receives, o.minAmountB, null);
      push(tNow('guard.row.pool'), short(String(o.liquidityPoolId ?? ''), 8));
      push(tNow('guard.row.shares'), str(o.amount));
      push(tNow('guard.row.minA'), str(o.minAmountA));
      push(tNow('guard.row.minB'), str(o.minAmountB));
      break;
    case 'createClaimableBalance':
      movesValue = true;
      moves(sends, o.amount, assetRefOf(o.asset));
      push(tNow('guard.row.lockedAmount'), `${String(o.amount ?? '')} ${assetLabel(o.asset)}`.trim());
      push(tNow('guard.row.claimants'), claimantsLabel(o.claimants));
      break;
    case 'claimClaimableBalance':
      push(tNow('guard.row.claimedBalance'), short(String(o.balanceId ?? ''), 8));
      break;
    case 'bumpSequence':
      push(tNow('guard.row.newSequence'), String(o.bumpTo ?? ''));
      break;
    case 'accountMerge':
      movesValue = true; // the entire balance, unquantifiable from the envelope
      push(tNow('guard.row.mergeInto'), str(o.destination));
      break;
    case 'setOptions': {
      const signer = o.signer as { ed25519PublicKey?: string; weight?: number } | undefined;
      if (signer?.ed25519PublicKey) push(tNow('guard.row.addsSigner'), tNow('guard.val.signerWeight', { key: signer.ed25519PublicKey, weight: String(signer.weight ?? '?') }));
      if (o.masterWeight != null) push(tNow('guard.row.masterWeight'), String(o.masterWeight));
      if (o.lowThreshold != null) push(tNow('guard.row.lowThreshold'), String(o.lowThreshold));
      if (o.medThreshold != null) push(tNow('guard.row.medThreshold'), String(o.medThreshold));
      if (o.highThreshold != null) push(tNow('guard.row.highThreshold'), String(o.highThreshold));
      if (o.homeDomain != null) push(tNow('guard.row.homeDomain'), String(o.homeDomain));
      break;
    }
    case 'manageSellOffer':
    case 'manageBuyOffer':
    case 'createPassiveSellOffer':
      // An offer's cost is a price ratio, not a settled amount: what actually leaves
      // depends on the book at execution time. Marked as moving value with nothing
      // quantified, so any flow that reaches one refuses it.
      movesValue = true;
      push(tNow('guard.row.selling'), assetLabel(o.selling));
      push(tNow('guard.row.buying'), assetLabel(o.buying));
      push(tNow('guard.row.quantity'), str(o.amount) ?? str(o.buyAmount));
      push(tNow('guard.row.price'), str(o.price));
      break;
    case 'manageData':
      push(tNow('guard.row.dataName'), str(o.name));
      push(tNow('guard.row.dataValue'), o.value == null ? tNow('guard.val.deleteEntry') : tNow('guard.val.binary'));
      break;
    case 'invokeHostFunction': {
      movesValue = true; // may transfer through an asset's SAC; not decodable here
      const soroban = sorobanRows(o);
      if (soroban.length) rows.push(...soroban);
      else push(tNow('guard.row.contract'), tNow('guard.val.sorobanOpaque'));
      break;
    }
    default:
      // Fail OPEN was the old behaviour here: an operation type this switch does not
      // know left `movesValue = false`, so every downstream check treated it as
      // harmless. An operation the wallet cannot read is the one most likely to be
      // doing something it should not.
      movesValue = true;
      push(tNow('guard.row.operation'), tNow('guard.val.unreadableOp'));
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
    throw new TxGuardError('guard.undecodable');
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

/** One side of a pool deposit: the asset confirmed, and the ceiling for that side. */
export interface PoolSide {
  asset: AssetBound;
  /** The maximum of `asset` the user agreed to put in. */
  max: string;
}

/**
 * The pool a deposit is allowed to touch, worked out from the two assets the user
 * confirmed — and never read out of the envelope.
 *
 * A constant-product pool id is a hash of its (assetA, assetB, fee) in CAP-38's
 * canonical order, so the wallet can compute the id of the only pool those two assets
 * can form. That is strictly stronger than asking the caller for a pool id, which for
 * a deposit it does not have: the user picks two assets, not a pool.
 *
 * The canonical order is also what makes the per-side ceilings meaningful. A deposit
 * decodes its two amounts in the pool's A/B order with no asset attached, so returning
 * the ceilings in that same order is what lets each side be bound to its own — instead
 * of the two being interchangeable.
 *
 * Returns null when the pair cannot form a pool at all (the same asset twice, an
 * unparseable issuer). The caller refuses on null; "could not determine" is never
 * "no limit".
 */
function poolPlan(sides: readonly [PoolSide, PoolSide]): { id: string; ceilings: readonly [string, string] } | null {
  try {
    const asset = (b: AssetBound) => (b.issuer ? new Asset(b.code, b.issuer) : Asset.native());
    const first = asset(sides[0].asset);
    const second = asset(sides[1].asset);
    const inOrder = Asset.compare(first, second) <= 0;
    const [a, b] = inOrder ? [sides[0], sides[1]] : [sides[1], sides[0]];
    const pool = new LiquidityPoolAsset(asset(a.asset), asset(b.asset), LiquidityPoolFeeV18);
    const id = getLiquidityPoolId('constant_product', pool.getLiquidityPoolParameters()).toString('hex');
    return { id, ceilings: [a.max, b.max] };
  } catch {
    return null;
  }
}

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
       * The two sides the user confirmed: each asset paired with the ceiling shown
       * under its own field.
       *
       * The pool is NOT a parameter — it is derived from these two assets, so the
       * envelope cannot name a different one. This arm used to carry a bare
       * `poolAmounts: string[]` and no pool at all, which left two holes at once:
       * `expectedPool` was only ever set for `lp-withdraw`, so the "acts on the pool
       * you chose" check never ran on a deposit; and because pool amounts decode with
       * no asset attached, the ceilings were matched as an order-independent multiset.
       * Confirm 1000 XLM / 100 USDC and a hostile gateway returns a deposit of 100 and
       * 1000 with the sides swapped, into a pool of its own: each amount finds a
       * ceiling that covers it, `destinations: 'self'` says nothing because the
       * operation has no destination, and a 10x overspend passes green.
       */
      poolSides: readonly [PoolSide, PoolSide];
    })
  | (GuardBase & {
      intent: 'lp-withdraw';
      /** The pool the user chose. The envelope must act on that one. */
      poolId: string;
      poolAmounts: readonly string[];
    })
  | (GuardBase & {
      intent: 'trustline';
      /**
       * The assets this envelope may open a trustline for — REQUIRED here, unlike the
       * optional `trustlines` on the base, and that difference is the whole arm.
       *
       * The flow that uses this asks the gateway which issuer its onramp pays out in,
       * precisely because the wallet does not know. So the bound cannot come from
       * before the call; it comes from what the user was SHOWN after it. The store
       * decodes the returned envelope with `reviewTx`, puts the decoded `(code,
       * issuer)` in front of the user, and passes back exactly what they confirmed.
       *
       * Naming it separately rather than reusing the optional base field is what makes
       * that non-optional: `trustlines?: []` on the base would let a future caller sign
       * a gateway-chosen trustline having confirmed nothing, which is the shape of every
       * hole this union was introduced to close.
       */
      confirmed: readonly AssetBound[];
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
  const fail: (key: string, params?: Record<string, string | number>) => never = (key, params) => {
    throw new TxGuardError(key, params, review);
  };

  // A fee bump lets a third party wrap and re-broadcast; no internal flow builds one.
  if (review.feeBumpSource) {
    fail('guard.feeBump');
  }

  if (review.source !== opts.signer) {
    fail('guard.foreignSource', { source: short(review.source) });
  }

  if (!review.operations.length) {
    fail('guard.noOps');
  }

  if (review.operations.length > MAX_OPS) {
    fail('guard.tooManyOps', { count: review.operations.length });
  }

  const feeNum = Number(review.fee);
  if (!Number.isFinite(feeNum) || feeNum < 0 || feeNum > MAX_FEE_STROOPS) {
    fail('guard.feeTooHigh', { fee: review.feeXlm });
  }

  /* -------- validity window: a signature that never expires is a liability ------- */
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!review.maxTime) {
    fail('guard.noExpiry');
  }
  const maxTime = Number(review.maxTime);
  if (!Number.isFinite(maxTime)) {
    fail('guard.badMaxTime');
  }
  if (maxTime + CLOCK_SKEW_S < now) {
    fail('guard.expired');
  }
  // A post-dated envelope is the same free option as a never-expiring one: the
  // counterparty submits these, so `minTime` in the future hands it the wait. Checked
  // before the width test so the refusal names the actual problem.
  const minTime = review.minTime ? Number(review.minTime) : 0;
  if (Number.isFinite(minTime) && minTime > now + CLOCK_SKEW_S) {
    fail('guard.notYetValid');
  }
  if (maxTime - now > MAX_VALIDITY_S + CLOCK_SKEW_S) {
    fail('guard.validTooLong');
  }

  /* --------------------------- per-operation checks --------------------------- */
  const allowed = ALLOWED_OPS[opts.intent];
  const maxSend = opts.intent === 'swap' || opts.intent === 'offramp' ? opts.maxSend : null;
  const minReceive = opts.intent === 'swap' ? opts.minReceive : null;
  // Withdraw names its pool; deposit DERIVES it from the two confirmed assets. Either
  // way `expectedPool` is set for every liquidity intent, which is what makes the
  // "acts on the pool you chose" check below reachable on both of them.
  const poolAmounts = opts.intent === 'lp-withdraw' ? opts.poolAmounts : null;
  const deposit = opts.intent === 'lp-deposit' ? poolPlan(opts.poolSides) : null;
  if (opts.intent === 'lp-deposit' && !deposit) {
    fail('guard.poolUncomputable');
  }
  const expectedPool = opts.intent === 'lp-withdraw' ? opts.poolId : (deposit?.id ?? null);
  const isLiquidity = opts.intent === 'lp-deposit' || opts.intent === 'lp-withdraw';
  const declared: AssetBound[] = [
    ...(maxSend ? [maxSend.asset] : []),
    ...(minReceive ? [minReceive.asset] : []),
    ...(opts.trustlines ?? []),
    ...(opts.intent === 'trustline' ? opts.confirmed : []),
  ];

  // A `trustline` intent that confirmed nothing would allow nothing, which reads as a
  // guard that works and is really a flow that can never sign. Refused explicitly so
  // the failure names the caller's mistake rather than surfacing as
  // `guard.unconfirmedTrustline` on a perfectly good envelope.
  if (opts.intent === 'trustline' && !opts.confirmed.length) {
    fail('guard.noConfirmedTrustline');
  }
  const counterparties = new Set<string>();

  for (const op of review.operations) {
    if (op.critical) {
      fail('guard.criticalOp', { op: op.type });
    }
    if (!allowed.includes(op.type)) {
      fail('guard.unexpectedOp', { op: op.type });
    }
    // An op may omit its source (inherits the tx source); if it sets one, it must be us.
    if (op.source && op.source !== opts.signer) {
      fail('guard.foreignOpSource', { source: short(op.source) });
    }

    /* where the money lands */
    if (op.destination && op.destination !== opts.signer) {
      if (opts.destinations === 'self') {
        fail('guard.notSelfDestination', { destination: short(op.destination) });
      } else if (opts.destinations === 'counterparty') {
        counterparties.add(op.destination);
        if (counterparties.size > 1) {
          fail('guard.multipleDestinations');
        }
      } else if (!opts.destinations.includes(op.destination)) {
        fail('guard.unconfirmedDestination', { destination: short(op.destination) });
      }
    }

    /* an operation that moves value must say how much, in what */
    if (op.movesValue && !op.sends.length) {
      fail('guard.unquantifiable', { op: op.type });
    }

    /* a trustline must be one the flow confirmed */
    if (op.type === 'changeTrust') {
      if (op.linePoolShare) {
        // Checked BEFORE `lineRemoves`: closing a pool position legitimately ends with
        // `changeTrust(shares, 0)` to recover the 0.5 XLM reserve, and testing removal
        // first refused every full exit.
        if (!isLiquidity) {
          fail('guard.poolShareOutsideLiquidity');
        }
      } else if (op.lineRemoves) {
        fail('guard.removesTrustline');
      } else if (!declared.some((b) => assetMatches(op.line, b))) {
        fail('guard.unconfirmedTrustline', { asset: refLabel(op.line) });
      }
    }

    /* liquidity: the envelope must act on the pool the user picked */
    if (expectedPool && (op.type === 'liquidityPoolWithdraw' || op.type === 'liquidityPoolDeposit')) {
      if (op.poolId !== expectedPool) {
        fail('guard.wrongPool', { pool: short(op.poolId ?? '', 8) });
      }
    }

    /* liquidity: a withdrawal that guarantees nothing back is never legitimate */
    if (op.type === 'liquidityPoolWithdraw') {
      if (!op.receives.length) {
        fail('guard.withdrawNoMinimum');
      }
      for (const v of op.receives) {
        const n = stroops(v.amount);
        if (n === null || n <= 0n) {
          fail('guard.withdrawZero');
        }
      }
    }
  }

  /* ------------------------------ amount bounds ------------------------------ */
  if (maxSend) {
    const cap = stroops(maxSend.amount);
    if (cap === null || cap <= 0n) {
      fail('guard.maxSendUnreadable');
    }
    let total = 0n;
    for (const op of review.operations) {
      for (const v of op.sends) {
        if (!assetMatches(v.asset, maxSend.asset)) {
          fail('guard.wrongAsset', { moved: refLabel(v.asset), expected: maxSend.asset.code });
        }
        const n = stroops(v.amount);
        if (n === null) {
          fail('guard.amountUnreadable');
        }
        total += n;
      }
    }
    // Compared as integers, and against the total: `moved > cap * (1 + tolerance)`.
    if (total * 10_000n > cap * (10_000n + BOUND_TOLERANCE_BPS)) {
      fail('guard.overMaxSend', { amount: maxSend.amount, code: maxSend.asset.code });
    }
  }

  if (minReceive) {
    const floor = stroops(minReceive.amount);
    if (floor === null || floor <= 0n) {
      fail('guard.minReceiveUnreadable');
    }
    let total = 0n;
    let seen = false;
    for (const op of review.operations) {
      for (const v of op.receives) {
        if (!assetMatches(v.asset, minReceive.asset)) continue;
        const n = stroops(v.amount);
        if (n === null) {
          fail('guard.receiveUnreadable');
        }
        total += n;
        seen = true;
      }
    }
    if (!seen) {
      fail('guard.noGuaranteedAsset', { code: minReceive.asset.code });
    }
    // `total < floor * (1 - tolerance)`, as integers.
    if (total * 10_000n < floor * (10_000n - BOUND_TOLERANCE_BPS)) {
      fail('guard.underMinReceive', { amount: minReceive.amount, code: minReceive.asset.code });
    }
  }

  /* ------------------------ liquidity: deposit, per side ---------------------- */
  if (deposit) {
    // Bound side by side, not as a multiset: `ceilings` is in the pool's canonical
    // order and a deposit decodes `maxAmountA` then `maxAmountB` in that same order,
    // so index i is the ceiling for the amount at index i. Swapping the two sides no
    // longer finds a ceiling that happens to cover it.
    for (const op of review.operations) {
      if (op.type !== 'liquidityPoolDeposit') continue;
      if (op.sends.length !== deposit.ceilings.length) {
        // Defensive, and deliberately untested: a `liquidityPoolDeposit` always decodes
        // both of its sides, so nothing the SDK can build reaches here. It exists
        // because the alternative to refusing is worse than useless — with one side
        // missing the positions below stop lining up, and each amount would be checked
        // against the OTHER side's ceiling.
        fail('guard.poolSideCount');
      }
      for (let i = 0; i < op.sends.length; i++) {
        const moved = stroops(op.sends[i].amount);
        const cap = stroops(deposit.ceilings[i]);
        if (moved === null) {
          fail('guard.amountUnreadable');
        }
        if (cap === null || cap <= 0n) {
          fail('guard.poolAmountsUnreadable');
        }
        if (moved * 10_000n > cap * (10_000n + BOUND_TOLERANCE_BPS)) {
          fail('guard.overPoolSide', { amount: op.sends[i].amount, max: deposit.ceilings[i] });
        }
      }
    }
  }

  /* --------------------------- liquidity: pool shares ------------------------- */
  if (poolAmounts) {
    // Withdraw only. What leaves is pool SHARES, which carry no asset and cannot be
    // summed the way `maxSend` sums a single one, so they are matched as a multiset
    // against the ceilings the user confirmed: each amount leaving must be covered by
    // one unused ceiling. Deposits no longer come through here — they are bound side
    // by side above, against a pool the wallet derived rather than one it was handed.
    const ceilings: bigint[] = [];
    for (const a of poolAmounts) {
      const n = stroops(a);
      if (n === null || n <= 0n) {
        fail('guard.poolAmountsUnreadable');
      }
      ceilings.push(n);
    }
    const used = ceilings.map(() => false);
    for (const op of review.operations) {
      for (const v of op.sends) {
        const n = stroops(v.amount);
        if (n === null) {
          fail('guard.amountUnreadable');
        }
        // Consume the tightest ceiling that still covers this amount.
        let best = -1;
        for (let i = 0; i < ceilings.length; i++) {
          if (used[i] || ceilings[i] * (10_000n + BOUND_TOLERANCE_BPS) < n * 10_000n) continue;
          if (best === -1 || ceilings[i] < ceilings[best]) best = i;
        }
        if (best === -1) {
          fail('guard.overPoolCeiling', { amount: v.amount });
        }
        used[best] = true;
      }
    }
  }

  return review;
}
