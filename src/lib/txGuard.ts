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
 */
import { FeeBumpTransaction, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import type { NetConfig } from '@/lib/stellar';

/** Which wallet flow is asking for a signature. `dapp` is reviewed, not allowlisted. */
export type SignIntent = 'send' | 'swap' | 'lp-deposit' | 'lp-withdraw' | 'offramp' | 'trustline' | 'dapp';

/**
 * Operations that can hand over the account itself. None of the wallet's own
 * flows ever needs one, so they are refused outright; the dapp path renders them
 * behind a red warning instead of refusing, because legitimate dapps do use them.
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
];

/** Operations each internal flow may legitimately contain. */
const ALLOWED_OPS: Record<Exclude<SignIntent, 'dapp'>, readonly string[]> = {
  send: ['payment', 'createAccount', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'],
  swap: [
    'pathPaymentStrictSend',
    'pathPaymentStrictReceive',
    'manageSellOffer',
    'manageBuyOffer',
    'createPassiveSellOffer',
    'changeTrust',
  ],
  'lp-deposit': ['liquidityPoolDeposit', 'changeTrust'],
  'lp-withdraw': ['liquidityPoolWithdraw', 'changeTrust'],
  offramp: ['payment', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'],
  trustline: ['changeTrust'],
};

/**
 * Fee ceiling for the internal flows, in stroops (1 XLM). Base fee is 100 stroops
 * per operation, so this is ~5 orders of magnitude of headroom — it exists only to
 * stop a fee-drain envelope, not to second-guess congestion pricing.
 */
const MAX_FEE_STROOPS = 10_000_000;

export class TxGuardError extends Error {
  readonly review: TxReview | null;
  constructor(message: string, review: TxReview | null = null) {
    super(message);
    this.name = 'TxGuardError';
    this.review = review;
  }
}

/** One operation, flattened for both checking and rendering. */
export interface OpReview {
  type: string;
  /** Explicit op source, when it differs from the transaction source. */
  source: string | null;
  /** Counterparty account, when the operation has one. */
  destination: string | null;
  /** Human rows for the approval UI, already formatted. */
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

/** `Asset` -> "XLM" or "USDC (GA1B…X9)". Tolerates the SDK's changing shapes. */
function assetLabel(asset: unknown): string {
  if (!asset || typeof asset !== 'object') return '—';
  const a = asset as { isNative?: () => boolean; getCode?: () => string; getIssuer?: () => string; code?: string; issuer?: string };
  try {
    if (typeof a.isNative === 'function' && a.isNative()) return 'XLM';
  } catch {
    /* liquidity-pool assets have no isNative() */
  }
  const code = (typeof a.getCode === 'function' ? a.getCode() : a.code) ?? '';
  const issuer = (typeof a.getIssuer === 'function' ? a.getIssuer() : a.issuer) ?? '';
  if (!code) return '—';
  return issuer ? `${code} (${short(issuer, 4)})` : code;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
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

  switch (type) {
    case 'payment':
      push('Destino', str(o.destination));
      push('Importe', `${String(o.amount ?? '')} ${assetLabel(o.asset)}`.trim());
      break;
    case 'createAccount':
      push('Cuenta nueva', str(o.destination));
      push('Saldo inicial', `${String(o.startingBalance ?? '')} XLM`);
      break;
    case 'pathPaymentStrictSend':
      push('Destino', str(o.destination));
      push('Envías', `${String(o.sendAmount ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push('Recibe (mínimo)', `${String(o.destMin ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'pathPaymentStrictReceive':
      push('Destino', str(o.destination));
      push('Envías (máximo)', `${String(o.sendMax ?? '')} ${assetLabel(o.sendAsset)}`.trim());
      push('Recibe', `${String(o.destAmount ?? '')} ${assetLabel(o.destAsset)}`.trim());
      break;
    case 'changeTrust':
      push('Activo', assetLabel(o.line));
      push('Límite', o.limit === '0' ? 'ELIMINAR trustline' : String(o.limit ?? ''));
      break;
    case 'liquidityPoolDeposit':
      push('Pool', short(String(o.liquidityPoolId ?? ''), 8));
      push('Máximo A', str(o.maxAmountA));
      push('Máximo B', str(o.maxAmountB));
      break;
    case 'liquidityPoolWithdraw':
      push('Pool', short(String(o.liquidityPoolId ?? ''), 8));
      push('Participaciones', str(o.amount));
      push('Mínimo A', str(o.minAmountA));
      push('Mínimo B', str(o.minAmountB));
      break;
    case 'accountMerge':
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
      push('Vende', assetLabel(o.selling));
      push('Compra', assetLabel(o.buying));
      push('Cantidad', str(o.amount) ?? str(o.buyAmount));
      break;
    case 'manageData':
      push('Clave', str(o.name));
      push('Valor', o.value == null ? 'BORRAR' : '(binario)');
      break;
    case 'invokeHostFunction':
      push('Contrato', 'Invocación de contrato Soroban');
      break;
    default:
      break;
  }

  return {
    type,
    source: str(o.source),
    destination: str(o.destination),
    rows,
    critical: CRITICAL_OPS.includes(type),
  };
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
  const feeNum = Number(fee);

  return {
    source: tx.source ?? '',
    fee,
    feeXlm: Number.isFinite(feeNum) ? (feeNum / 1e7).toFixed(7).replace(/\.?0+$/, '') : fee,
    sequence: String((tx as unknown as { sequence?: unknown }).sequence ?? ''),
    memo,
    memoType,
    operations,
    signatures: Array.isArray(tx.signatures) ? tx.signatures.length : 0,
    feeBumpSource,
    hasCritical: operations.some((o) => o.critical),
    networkLabel: cfg.label,
  };
}

/* --------------------------------- assert -------------------------------- */

export interface GuardOptions {
  /** The account that is about to sign. Every op must act on it and nothing else. */
  signer: string;
  intent: Exclude<SignIntent, 'dapp'>;
  /**
   * Upper bound the caller already showed the user, when it has one — e.g. the
   * swap's `sendAmount`. Any single op moving more of that asset than this is
   * refused. Omitted when the flow has no single headline amount.
   */
  maxSend?: { amount: string; assetCode: string };
}

/**
 * Decode, verify, and either return the review or refuse. Refusals are hard:
 * a transaction the wallet cannot explain is a transaction the wallet does not sign.
 */
export function assertSafeToSign(cfg: NetConfig, xdr: string, opts: GuardOptions): TxReview {
  const review = reviewTx(cfg, xdr);
  const fail = (msg: string): never => {
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

  const feeNum = Number(review.fee);
  if (!Number.isFinite(feeNum) || feeNum < 0 || feeNum > MAX_FEE_STROOPS) {
    fail(`La comisión de la transacción es anómala (${review.feeXlm} XLM). Firma rechazada.`);
  }

  const allowed = ALLOWED_OPS[opts.intent];
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
  }

  if (opts.maxSend) {
    const cap = Number(opts.maxSend.amount);
    if (Number.isFinite(cap) && cap > 0) {
      for (const op of review.operations) {
        const moved = sentAmountOf(op, opts.maxSend.assetCode);
        // 1% tolerance absorbs the server rounding the quote to 7 decimals.
        if (moved != null && moved > cap * 1.01) {
          fail(`La transacción mueve ${moved} ${opts.maxSend.assetCode}, más de lo confirmado (${opts.maxSend.amount}). Firma rechazada.`);
        }
      }
    }
  }

  return review;
}

/** How much of `assetCode` this op sends, when that is determinable. */
function sentAmountOf(op: OpReview, assetCode: string): number | null {
  const row = op.rows.find((r) => r.label === 'Importe' || r.label === 'Envías' || r.label === 'Envías (máximo)');
  if (!row) return null;
  const [amount, code] = row.value.split(/\s+/);
  if (!code || !code.startsWith(assetCode)) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}
