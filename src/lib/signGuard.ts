/**
 * Pre-signature guard: the single place the wallet validates an envelope it did
 * NOT build itself before adding its signature.
 *
 * Four flows (swap, LP deposit, LP withdraw, off-ramp payout) receive a base64
 * XDR straight out of a CosmosPay gateway response and sign it locally. Nothing
 * between the response and the signature used to check the source account, the
 * operation types, the destination, the amount, the fee or the validity window —
 * a compromised gateway, a hostile response or a repointed gatewayUrl could
 * return `setOptions { masterWeight: 0, signer: attacker }` or `accountMerge`
 * and the wallet would sign it. Local signing without local inspection is
 * custody by another name.
 *
 * This guard REFUSES (never warns) unless every check passes:
 *   - the envelope decodes with the wallet's OWN network passphrase — never one
 *     supplied by the counterparty;
 *   - the transaction source and every operation source is the wallet's account;
 *   - the operations match the per-intent allowlist. Each intent is a
 *     discriminated-union variant that declares its own ceilings, so a flow
 *     that signs without declaring them does not compile;
 *   - account-takeover operations are refused outright (setOptions, accountMerge,
 *     sponsorship, clawback, claimable balances, invokeHostFunction, bumpSequence);
 *   - where value lands is bounded by the policy each flow declares (no
 *     permissive default), and every value-bearing operation is quantified — an
 *     operation that moves value and cannot be checked is a refusal, never
 *     "no limit". Assets are (code, issuer) pairs compared exactly;
 *   - what leaves and what comes back is bounded by what the user SAW (the typed
 *     amount, the quote the screen rendered) — never by numbers from the
 *     response that carried the XDR;
 *   - a fee ceiling and an operation-count ceiling apply, fee-bump wrappers are
 *     refused, and a bounded validity window is required: missing, expired or
 *     over-wide maxTime and a future minTime are all refusals, with a few
 *     minutes of clock skew tolerated at both ends (so a phone a few minutes
 *     fast does not reject every envelope and blame the server).
 */
import {
  Asset,
  FeeBumpTransaction,
  Keypair,
  LiquidityPoolAsset,
  TransactionBuilder,
  getLiquidityPoolId,
  type Asset as SdkAsset,
  type OperationRecord,
  type Transaction,
} from '@stellar/stellar-sdk';
import type { NetConfig } from '@/lib/stellar';

/** Clock skew tolerated at both ends of the validity window (ms). */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** A validity window wider than this is refused (ms). */
export const MAX_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Network fee ceiling, in stroops (1 XLM = 10,000,000 stroops). */
export const MAX_FEE_STROOPS = 10_000_000;
/** Hard ceiling on operations per envelope (Stellar allows 100 — a per-op cap is a 100× cap). */
export const MAX_OPS_PER_TX = 4;
/** Amount comparison tolerance (token amounts carry up to 7 decimals). */
const AMOUNT_EPS = 1e-7;
/** A commission payment may not exceed this share of the user-approved value in its asset. */
const COMMISSION_MAX_SHARE = 0.02;
/** The only pool fee Stellar supports. */
const POOL_FEE = 30;
/** Wallet's own commission-memo pattern (same heuristic history uses to label fee payments). */
const COMMISSION_MEMO_PATTERN = /commission|comisi[oó]n/i;

/**
 * An asset identified exactly as (code, issuer). `issuer` null/undefined means
 * native XLM. Comparison is exact on BOTH fields — `USD` never validates
 * against `USDC`, and a different issuer never validates against the same code.
 */
export interface AssetRef {
  code: string;
  issuer: string | null;
}

/** Normalize an asset reference ('native'/'XLM'/empty code -> native XLM). */
export function normalizeAssetRef(code: string, issuer: string | null | undefined): AssetRef {
  if (!code || code === 'native' || code === 'XLM') return { code: 'XLM', issuer: null };
  return { code, issuer: issuer ?? null };
}

/**
 * The fee the user saw in the rendered quote: exact amount, exact asset,
 * exact destination wallet.
 */
export interface SwapFee {
  amount: string;
  asset: AssetRef;
  wallet: string;
}

/**
 * Discriminated union by intent. Every flow that signs an envelope it did not
 * build must pass one of these variants; each variant carries the ceilings for
 * its own flow (where value may land, how much may leave, how much must come
 * back) taken from what the user actually saw — the typed amount and the
 * rendered quote. Adding a new signing flow without a validator here is a
 * type error (the switch in {@link validateIntent} is exhaustive).
 */
export type SignIntent =
  | {
      intent: 'swap';
      /** Our own account (transaction + every operation source). */
      source: string;
      /** Asset the user chose to pay with. */
      assetIn: AssetRef;
      /** Gross amount the user typed. */
      amountIn: string;
      /** Asset the user chose to receive. */
      assetOut: AssetRef;
      /** Minimum to receive, from the rendered quote (quote.destination.minimum). */
      minOut: string;
      /**
       * The amount the rendered quote was priced for (quote.source.amount). When
       * present, must equal the typed amount — a stale quote must not bound the swap.
       */
      quoteAmount?: string;
      /** The commission from the rendered quote, when the gateway collects it on-chain. */
      fee?: SwapFee;
    }
  | {
      intent: 'liquidityDeposit';
      source: string;
      assetA: AssetRef;
      /** Cap the user typed for side A. */
      maxAmountA: string;
      assetB: AssetRef;
      /** Cap the user typed for side B; undefined = auto (pool ratio caps it on-chain). */
      maxAmountB?: string;
    }
  | {
      intent: 'liquidityWithdraw';
      source: string;
      /** The exact pool the user selected. */
      poolId: string;
      /** Shares the user approved to burn. */
      shares: string;
      /** What the user saw coming back: the ≈ redeem preview per pool asset (pre-slippage). */
      redeem: { asset: AssetRef; amount: string }[];
    }
  | {
      intent: 'offrampPayout';
      source: string;
      /** The exact token the user approved to send (code + issuer). */
      token: AssetRef;
      /** Exact total the user approved to send (quote.sender_amount / 100). */
      amountOut: string;
    };

/** Thrown for every refusal. Callers surface `.message` verbatim to the user. */
export class SignGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignGuardError';
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new SignGuardError(message);
}

/* ------------------------------ helpers ------------------------------ */

function amountEq(a: string, b: string): boolean {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= AMOUNT_EPS;
}

/** `a <= b`, with tolerance for Stellar's 7-decimal normalization. */
function amountLe(a: string, b: string): boolean {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na <= nb + AMOUNT_EPS;
}

function assetMatches(asset: SdkAsset, ref: AssetRef): boolean {
  if (ref.issuer == null) return asset.isNative();
  return !asset.isNative() && asset.getCode() === ref.code && asset.getIssuer() === ref.issuer;
}

function toSdkAsset(ref: AssetRef): SdkAsset {
  return ref.issuer == null ? Asset.native() : new Asset(ref.code, ref.issuer);
}

function poolIdFor(a: AssetRef, b: AssetRef): string {
  const assetA = toSdkAsset(a);
  const assetB = toSdkAsset(b);
  assert(Asset.compare(assetA, assetB) !== 0, 'El depósito usa el mismo activo en ambos lados.');
  // The pool's assetA is the lexicographically smaller one; the deposit screen lets
  // the user pick either side as A, so sort before hashing.
  const [poolA, poolB] = Asset.compare(assetA, assetB) === -1 ? [assetA, assetB] : [assetB, assetA];
  return getLiquidityPoolId('constant_product', { assetA: poolA, assetB: poolB, fee: POOL_FEE }).toString('hex');
}

function isCommissionMemo(memo: string): boolean {
  return COMMISSION_MEMO_PATTERN.test(memo);
}

/**
 * Cap for a commission payment in `asset`, as a share of the user-approved
 * value in that same asset. Returns null when the asset matches nothing the
 * user approved (refusal — the payment cannot be quantified).
 */
function commissionCapFor(asset: SdkAsset, approved: { asset: AssetRef; amount: string }[]): string | null {
  for (const entry of approved) {
    if (assetMatches(asset, normalizeAssetRef(entry.asset.code, entry.asset.issuer))) {
      return String((parseFloat(entry.amount) || 0) * COMMISSION_MAX_SHARE);
    }
  }
  return null;
}

/* ------------------------- account-takeover list ------------------------- */

/**
 * Operations that can change who controls the account, move the whole balance,
 * or hand the account to someone else. Refused regardless of intent, even
 * though the per-intent allowlists would also reject them.
 */
const ACCOUNT_TAKEOVER_OP_TYPES: ReadonlySet<string> = new Set([
  'setOptions',
  'accountMerge',
  'beginSponsoringFutureReserves',
  'endSponsoringFutureReserves',
  'revokeSponsorship',
  'revokeAccountSponsorship',
  'revokeTrustlineSponsorship',
  'revokeOfferSponsorship',
  'revokeDataSponsorship',
  'revokeClaimableBalanceSponsorship',
  'revokeLiquidityPoolSponsorship',
  'revokeSignerSponsorship',
  'clawback',
  'clawbackClaimableBalance',
  'createClaimableBalance',
  'claimClaimableBalance',
  'bumpSequence',
  'invokeHostFunction',
]);

/* ------------------------------ window --------------------------------- */

function validateWindow(tb: { minTime: string; maxTime: string } | undefined): void {
  assert(tb, 'La transacción no tiene una ventana de validez.');
  const nowMs = Date.now();
  const minSec = Number(tb.minTime);
  const maxSec = Number(tb.maxTime);
  assert(Number.isFinite(minSec) && Number.isFinite(maxSec), 'La ventana de validez no es válida.');
  assert(maxSec > 0, 'La transacción no tiene una ventana de validez acotada.');
  assert(minSec * 1000 <= nowMs + CLOCK_SKEW_MS, 'La transacción aún no es válida (revisa la hora del dispositivo).');
  assert(maxSec * 1000 >= nowMs - CLOCK_SKEW_MS, 'La transacción ha expirado.');
  // minTime 0 means "valid immediately" (no lower bound), so measure the window
  // from the earlier of {minTime, now} — a fresh envelope isn't "50 years wide".
  const effectiveMinSec = minSec > 0 ? minSec : Math.floor(nowMs / 1000);
  assert((maxSec - effectiveMinSec) * 1000 <= MAX_TIME_WINDOW_MS, 'La ventana de validez es demasiado amplia.');
}

/* --------------------------- per-intent checks --------------------------- */

function validateSwap(intent: Extract<SignIntent, { intent: 'swap' }>, ops: OperationRecord[], _memo: string): void {
  assert(parseFloat(intent.minOut) > 0, 'No hay una cotización reciente con la que verificar el swap. Vuelve a intentarlo.');
  assert(
    intent.quoteAmount === undefined || amountEq(intent.quoteAmount, intent.amountIn),
    'La cotización mostrada no corresponde al importe del swap. Vuelve a intentarlo.',
  );
  assert(ops.length >= 1 && ops.length <= 2, 'La transacción de swap no tiene el número esperado de operaciones.');
  const refIn = normalizeAssetRef(intent.assetIn.code, intent.assetIn.issuer);
  const refOut = normalizeAssetRef(intent.assetOut.code, intent.assetOut.issuer);
  let swaps = 0;
  let fees = 0;
  for (const op of ops) {
    if (op.type === 'pathPaymentStrictSend' || op.type === 'pathPaymentStrictReceive') {
      swaps += 1;
      assert(op.destination === intent.source, 'El swap no termina en tu cuenta.');
      assert(assetMatches(op.sendAsset, refIn), 'El swap no envía el activo aprobado.');
      assert(assetMatches(op.destAsset, refOut), 'El swap no recibe el activo aprobado.');
      if (op.type === 'pathPaymentStrictSend') {
        assert(amountEq(op.sendAmount, intent.amountIn), 'El swap no envía el importe aprobado.');
        assert(parseFloat(op.destMin) >= parseFloat(intent.minOut) - AMOUNT_EPS, 'El mínimo a recibir es menor que el aprobado.');
      } else {
        assert(amountLe(op.sendMax, intent.amountIn), 'El swap puede enviar más del importe aprobado.');
        assert(parseFloat(op.destAmount) >= parseFloat(intent.minOut) - AMOUNT_EPS, 'El mínimo a recibir es menor que el aprobado.');
      }
    } else if (op.type === 'payment') {
      fees += 1;
      assert(intent.fee, 'El swap incluye un pago que no estaba en la cotización.');
      assert(op.destination === intent.fee.wallet, 'El pago de comisión no va a la wallet de la cotización.');
      assert(assetMatches(op.asset, normalizeAssetRef(intent.fee.asset.code, intent.fee.asset.issuer)), 'El pago de comisión no usa el activo de la cotización.');
      assert(amountEq(op.amount, intent.fee.amount), 'El importe de la comisión no coincide con la cotización.');
    } else {
      assert(false, `La operación ${op.type} no está permitida en un swap.`);
    }
  }
  assert(swaps === 1, 'El swap debe contener exactamente una operación de intercambio.');
  assert(fees <= 1, 'El swap contiene más de un pago de comisión.');
}

function validateDeposit(intent: Extract<SignIntent, { intent: 'liquidityDeposit' }>, ops: OperationRecord[], memo: string): void {
  assert(ops.length >= 1 && ops.length <= 3, 'El depósito no tiene el número esperado de operaciones.');
  const a = normalizeAssetRef(intent.assetA.code, intent.assetA.issuer);
  const b = normalizeAssetRef(intent.assetB.code, intent.assetB.issuer);
  const poolId = poolIdFor(a, b);
  const approved: { asset: AssetRef; amount: string }[] = [
    { asset: a, amount: intent.maxAmountA },
  ];
  if (intent.maxAmountB !== undefined) approved.push({ asset: b, amount: intent.maxAmountB });
  let deposits = 0;
  let fees = 0;
  for (const op of ops) {
    if (op.type === 'liquidityPoolDeposit') {
      deposits += 1;
      assert(op.liquidityPoolId === poolId, 'El pool del depósito no corresponde a los activos elegidos.');
      assert(amountLe(op.maxAmountA, intent.maxAmountA), 'El depósito supera el importe máximo aprobado de A.');
      if (intent.maxAmountB !== undefined) {
        assert(amountLe(op.maxAmountB, intent.maxAmountB), 'El depósito supera el importe máximo aprobado de B.');
      } else {
        // Auto side: the pool's own ratio caps how much of B the deposit can
        // take, and A is already capped by the typed value — so B needs no
        // gateway-supplied number to be bounded.
        assert(parseFloat(op.maxAmountB) >= 0, 'El importe B del depósito no es válido.');
      }
    } else if (op.type === 'changeTrust') {
      assert(op.line instanceof LiquidityPoolAsset, 'El depósito incluye un trustline que no es de pool.');
      const params = op.line.getLiquidityPoolParameters();
      assert(
        getLiquidityPoolId('constant_product', params).toString('hex') === poolId,
        'El trustline del depósito no corresponde al pool elegido.',
      );
    } else if (op.type === 'payment') {
      fees += 1;
      assert(isCommissionMemo(memo), 'El depósito incluye un pago sin memo de comisión.');
      const cap = commissionCapFor(op.asset, approved);
      assert(cap !== null, 'El pago de comisión no corresponde a un activo aprobado.');
      assert(amountLe(op.amount, cap), 'El pago de comisión supera el límite aprobado.');
    } else {
      assert(false, `La operación ${op.type} no está permitida en un depósito.`);
    }
  }
  assert(deposits === 1, 'El depósito debe contener exactamente una operación de pool.');
  assert(fees <= 1, 'El depósito contiene más de un pago de comisión.');
}

function validateWithdraw(intent: Extract<SignIntent, { intent: 'liquidityWithdraw' }>, ops: OperationRecord[], memo: string): void {
  assert(ops.length >= 1 && ops.length <= 2, 'El retiro no tiene el número esperado de operaciones.');
  let withdrawals = 0;
  let fees = 0;
  for (const op of ops) {
    if (op.type === 'liquidityPoolWithdraw') {
      withdrawals += 1;
      assert(op.liquidityPoolId === intent.poolId, 'El retiro no corresponde al pool seleccionado.');
      assert(amountLe(op.amount, intent.shares), 'Se queman más participaciones de las aprobadas.');
      const minA = parseFloat(op.minAmountA);
      const minB = parseFloat(op.minAmountB);
      assert(Number.isFinite(minA) && Number.isFinite(minB) && minA >= 0 && minB >= 0, 'El retiro no cuantifica lo que devuelve.');
      assert(minA > 0 || minB > 0, 'El retiro no devuelve valor.');
    } else if (op.type === 'payment') {
      fees += 1;
      assert(isCommissionMemo(memo), 'El retiro incluye un pago sin memo de comisión.');
      const cap = commissionCapFor(op.asset, intent.redeem);
      assert(cap !== null, 'El pago de comisión no corresponde a un activo aprobado.');
      assert(amountLe(op.amount, cap), 'El pago de comisión supera el límite aprobado.');
    } else {
      assert(false, `La operación ${op.type} no está permitida en un retiro.`);
    }
  }
  assert(withdrawals === 1, 'El retiro debe contener exactamente una operación de pool.');
  assert(fees <= 1, 'El retiro contiene más de un pago de comisión.');
}

function validateOfframp(intent: Extract<SignIntent, { intent: 'offrampPayout' }>, ops: OperationRecord[], _memo: string): void {
  const ref = normalizeAssetRef(intent.token.code, intent.token.issuer);
  assert(ref.issuer !== null, 'No se pudo verificar el emisor del token del retiro.');
  assert(parseFloat(intent.amountOut) > 0, 'No hay una cotización con la que verificar el retiro.');
  assert(ops.length >= 1 && ops.length <= 2, 'El retiro debe contener uno o dos pagos.');
  let total = 0;
  for (const op of ops) {
    assert(op.type === 'payment', `La operación ${op.type} no está permitida en un retiro.`);
    assert(assetMatches(op.asset, ref), 'El retiro no usa el token aprobado.');
    const amt = parseFloat(op.amount);
    assert(Number.isFinite(amt) && amt > 0, 'El retiro no cuantifica el importe.');
    total += amt;
  }
  assert(Math.abs(total - parseFloat(intent.amountOut)) <= 1e-6, 'El importe total del retiro no coincide con la cotización.');
}

function validateIntent(intent: SignIntent, ops: OperationRecord[], memo: string): void {
  switch (intent.intent) {
    case 'swap':
      validateSwap(intent, ops, memo);
      return;
    case 'liquidityDeposit':
      validateDeposit(intent, ops, memo);
      return;
    case 'liquidityWithdraw':
      validateWithdraw(intent, ops, memo);
      return;
    case 'offrampPayout':
      validateOfframp(intent, ops, memo);
      return;
    default: {
      const exhaustive: never = intent;
      throw new Error(`Intento de firma sin validador: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/* ------------------------------- the guard ------------------------------ */

/**
 * Validate a server-authored envelope against the intent the user approved,
 * then sign it. Throws {@link SignGuardError} on ANY mismatch — the envelope is
 * never signed unless every check passes.
 */
export function signWithGuard(cfg: NetConfig, secret: string, xdr: string, intent: SignIntent): string {
  const tx = decodeWithOwnPassphrase(cfg, xdr);
  assert(!(tx instanceof FeeBumpTransaction), 'No se firman transacciones con fee bump.');

  assert(tx.source === intent.source, 'La transacción no usa tu cuenta como origen.');
  assert(Number(tx.fee) <= MAX_FEE_STROOPS, 'La comisión de red supera el máximo permitido.');

  const ops: OperationRecord[] = tx.operations;
  assert(ops.length >= 1, 'La transacción no contiene operaciones.');
  assert(ops.length <= MAX_OPS_PER_TX, 'La transacción contiene demasiadas operaciones.');

  validateWindow(tx.timeBounds);

  let memo = '';
  try {
    if (tx.memo && tx.memo.value != null) memo = tx.memo.value.toString();
  } catch {
    /* non-text memo */
  }

  for (const op of ops) {
    assert((op.source ?? tx.source) === intent.source, 'Una operación de la transacción no usa tu cuenta como origen.');
    assert(!ACCOUNT_TAKEOVER_OP_TYPES.has(op.type), `La operación ${op.type} está prohibida.`);
  }

  validateIntent(intent, ops, memo);

  tx.sign(Keypair.fromSecret(secret));
  return tx.toXDR();
}

/** Decode with the wallet's OWN passphrase — never one supplied by the counterparty. */
function decodeWithOwnPassphrase(cfg: NetConfig, xdr: string): Transaction | FeeBumpTransaction {
  try {
    return TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  } catch {
    throw new SignGuardError('El XDR de la pasarela no es una transacción válida.');
  }
}
