/**
 * Moving a Pollar wallet's funds onto a key this device holds.
 *
 * The wallet no longer creates Pollar wallets (`lib/signIn.ts` has why). The ones it already
 * made still hold money, and Pollar is the only party that can sign for them — so moving
 * out needs Pollar to sign one last time, and the key that receives has to be one this
 * device generated and backed up first.
 *
 * ## The shape of the move
 *
 * Three kinds of transaction, in this order, because each needs the one before on-chain:
 *
 *  1. FUND — signed by Pollar. `createAccount` for a target that does not exist yet, or a
 *     top-up `payment` for one that cannot afford its new trustlines. Skipped when the
 *     target already can.
 *  2. TRUST — signed HERE, by the new key: one `changeTrust` per asset the target does not
 *     hold yet. Only the account that trusts can sign that, which is why the move cannot be
 *     one Pollar-signed transaction.
 *  3. MOVE — signed by Pollar: every asset's free balance, then every free lumen, to the
 *     target.
 *
 * Batched at `MAX_OPS` operations per transaction, the ceiling the guard enforces. None of
 * it is atomic across transactions, and none of it has to be: every step is computed again
 * from what is on-chain NOW (`planMigration` over fresh account records), so an interrupted
 * move resumes where it stopped — funds are only ever in one account or the other.
 *
 * ## What stays behind, and why it is not merged
 *
 * The Pollar account keeps its own minimum balance — 0.5 XLM per base entry and per
 * trustline — and anything tied up in open offers. Recovering the reserve would need
 * `accountMerge` and trustline removals, which are exactly the operations the guard refuses
 * outright (CRITICAL_OPS, `guard.removesTrustline`). Opening an exemption in the signing
 * guard to save about a lumen is the wrong trade, so the plan says how much stays and why.
 *
 * Every amount is integer stroops (`bigint`). A float here would be a rounding error in the
 * direction of "the last payment asks for more than there is" and the whole move bouncing.
 */
import { Account, Asset, Memo, Operation, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';
import { toMinorUnitsBig, fromMinorUnits, STELLAR_DECIMALS } from '@/lib/amount';
import { defaultMemo } from '@/lib/memo';
import { getServer, type NetConfig } from '@/lib/stellar';
import type { AmountBound, AssetBound } from '@/lib/txGuard';
import { MAX_OPS } from '@/constants/txGuard';
import { BASE_RESERVE_STROOPS, MIGRATION_TX_TIMEOUT_S, TARGET_MARGIN_STROOPS } from '@/constants/migration';

/** A credit asset: always a (code, issuer) pair. */
export interface CreditAsset {
  code: string;
  issuer: string;
}

/** What the plan needs to know about one account, read from its Horizon record. */
export interface MigrationAccount {
  address: string;
  /** Native balance, stroops. */
  native: bigint;
  /** Native held for open offers, stroops. */
  nativeLocked: bigint;
  subentries: number;
  numSponsoring: number;
  numSponsored: number;
  assets: (CreditAsset & { balance: bigint; locked: bigint })[];
  /** Holds liquidity-pool shares, which a payment cannot move. */
  poolShares: boolean;
}

export type MigrationProblem =
  | { kind: 'insufficient_xlm'; needed: bigint; available: bigint }
  | { kind: 'nothing_to_move' };

export interface MigrationPlan {
  source: string;
  target: string;
  /** Stroops the FUND step sends, or 0n when the target can already afford its trustlines. */
  fund: bigint;
  /** Whether the FUND step is a `createAccount` (the target does not exist yet). */
  createTarget: boolean;
  /** Trustlines the TRUST step opens on the target. */
  trustlines: CreditAsset[];
  /** Every asset's free balance, moved in full. Stroops. */
  assets: (CreditAsset & { amount: bigint })[];
  /** The native amount the last MOVE payment sends. Stroops; 0n when there is none. */
  xlm: bigint;
  /** What stays in the Pollar account: its own reserve, plus anything in open offers. */
  leftBehind: bigint;
  /** Some balance is tied up in open offers and stays until they are cancelled. */
  lockedInOffers: boolean;
  /** The Pollar account holds pool shares, which stay behind. */
  poolShares: boolean;
  /** Per-operation fee the plan budgeted with, stroops. */
  feePerOp: bigint;
  problem: MigrationProblem | null;
}

const key = (a: CreditAsset) => `${a.code}:${a.issuer}`;

/** 0.5 XLM per base entry and subentry, net of what a sponsor pays for. */
function minimumBalance(a: Pick<MigrationAccount, 'subentries' | 'numSponsoring' | 'numSponsored'>): bigint {
  const entries = 2 + a.subentries + a.numSponsoring - a.numSponsored;
  return BigInt(Math.max(0, entries)) * BASE_RESERVE_STROOPS;
}

/** Stroops, from Horizon's 7-decimal strings. An unreadable amount is 0 — and is refused
 *  later by the guard rather than guessed at here. */
function stroops(v: unknown): bigint {
  return toMinorUnitsBig(v, STELLAR_DECIMALS) ?? 0n;
}

/** A Horizon account record, reduced to what the plan uses. Null when it is not one. */
export function readMigrationAccount(record: unknown): MigrationAccount | null {
  const r = (record ?? {}) as Record<string, unknown>;
  const address = typeof r.account_id === 'string' ? r.account_id : typeof r.id === 'string' ? r.id : null;
  if (!address || !Array.isArray(r.balances)) return null;
  let native = 0n;
  let nativeLocked = 0n;
  let poolShares = false;
  const assets: MigrationAccount['assets'] = [];
  for (const b of r.balances as Record<string, unknown>[]) {
    if (b.asset_type === 'native') {
      native = stroops(b.balance);
      nativeLocked = stroops(b.selling_liabilities ?? '0');
    } else if (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') {
      if (typeof b.asset_code !== 'string' || typeof b.asset_issuer !== 'string') continue;
      assets.push({
        code: b.asset_code,
        issuer: b.asset_issuer,
        balance: stroops(b.balance),
        locked: stroops(b.selling_liabilities ?? '0'),
      });
    } else if (b.asset_type === 'liquidity_pool_shares') {
      poolShares = poolShares || stroops(b.balance) > 0n;
    }
  }
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    address,
    native,
    nativeLocked,
    subentries: int(r.subentry_count),
    numSponsoring: int(r.num_sponsoring),
    numSponsored: int(r.num_sponsored),
    assets,
    poolShares,
  };
}

/** How many transactions `ops` operations take at the guard's per-transaction ceiling. */
const batches = (ops: number) => (ops === 0 ? 0 : Math.ceil(ops / MAX_OPS));

/**
 * Work out the whole move from the two accounts as they are on-chain now.
 *
 * `target` is null when the new address does not exist on this network yet. Run again
 * after every step: the result for a half-finished move is exactly the rest of it.
 */
export function planMigration(source: MigrationAccount, target: MigrationAccount | null, feePerOp: bigint, targetAddress: string): MigrationPlan {
  const assets = source.assets
    .map((a) => ({ code: a.code, issuer: a.issuer, amount: a.balance - a.locked }))
    .filter((a) => a.amount > 0n);
  const held = new Set((target?.assets ?? []).map(key));
  const trustlines = assets.filter((a) => !held.has(key(a))).map(({ code, issuer }) => ({ code, issuer }));
  const lockedInOffers = source.nativeLocked > 0n || source.assets.some((a) => a.locked > 0n);

  // What the target needs before the TRUST step: its reserve after the new trustlines, the
  // fees of that step, and a margin — above whatever it can already spend.
  const trustFees = BigInt(trustlines.length) * feePerOp;
  let fund = 0n;
  const createTarget = target === null;
  if (createTarget) {
    fund = BigInt(2 + trustlines.length) * BASE_RESERVE_STROOPS + trustFees + TARGET_MARGIN_STROOPS;
  } else if (trustlines.length) {
    const free = target.native - target.nativeLocked - minimumBalance(target);
    const needed = BigInt(trustlines.length) * BASE_RESERVE_STROOPS + trustFees + TARGET_MARGIN_STROOPS;
    if (free < needed) fund = needed - free;
  }

  const reserve = minimumBalance(source);
  const available = source.native - source.nativeLocked - reserve;
  const fundFee = fund > 0n ? feePerOp : 0n;

  // The MOVE step's fees depend on whether it carries a native payment, and the native
  // payment is whatever the fees leave — so try with one, and drop it if nothing is left.
  const withXlm = available - fund - fundFee - BigInt(assets.length + 1) * feePerOp;
  const withoutXlm = available - fund - fundFee - BigInt(assets.length) * feePerOp;
  const xlm = withXlm > 0n ? withXlm : 0n;
  // Dust too small to pay its own fee stays, and is counted as staying.
  const spare = withXlm > 0n ? 0n : withoutXlm;
  const leftBehind = reserve + source.nativeLocked + (spare > 0n ? spare : 0n);

  const base = {
    source: source.address,
    target: targetAddress,
    fund,
    createTarget,
    trustlines,
    assets,
    xlm,
    leftBehind,
    lockedInOffers,
    poolShares: source.poolShares,
    feePerOp,
  };

  if (xlm === 0n && spare < 0n) {
    const needed = fund + fundFee + BigInt(assets.length) * feePerOp;
    return { ...base, problem: { kind: 'insufficient_xlm', needed, available: available > 0n ? available : 0n } };
  }
  if (!assets.length && xlm === 0n) return { ...base, problem: { kind: 'nothing_to_move' } };
  return { ...base, problem: null };
}

/**
 * A plan computed mid-move, held to the one the person confirmed on its native payment.
 *
 * The network charges at most the fee a transaction bid, and often less, so a step that
 * landed cheaper than budgeted leaves a few stroops MORE free than the confirmed plan said —
 * and the re-planned native payment would then ask for more than the guard allows, failing
 * the move at its very last step. Those stroops stay behind instead. Assets are not capped:
 * more of an asset than confirmed means someone paid the old address mid-move, and that is
 * for the guard to refuse and the person to confirm again.
 */
export function withinConfirmed(plan: MigrationPlan, confirmed: MigrationPlan): MigrationPlan {
  return plan.xlm > confirmed.xlm ? { ...plan, xlm: confirmed.xlm } : plan;
}

/** Is there anything left to do? False once the move is complete. */
export function migrationPending(plan: MigrationPlan): boolean {
  return plan.fund > 0n || plan.trustlines.length > 0 || plan.assets.length > 0 || plan.xlm > 0n;
}

/**
 * The ceilings the guard holds each Pollar-signed transaction to: per asset, the TOTAL the
 * plan the person confirmed moves. Native covers both the FUND step and the last payment.
 */
export function migrationBounds(plan: MigrationPlan): AmountBound[] {
  const amount = (n: bigint) => fromMinorUnits(n, STELLAR_DECIMALS) ?? '0';
  const xlm: AmountBound = { asset: { code: 'XLM', issuer: null }, amount: amount(plan.fund + plan.xlm) };
  return [xlm, ...plan.assets.map((a) => ({ asset: { code: a.code, issuer: a.issuer }, amount: amount(a.amount) }))];
}

/** The trustlines as the guard's `trustline` intent confirms them. */
export function trustlineBounds(plan: MigrationPlan): AssetBound[] {
  return plan.trustlines.map((a) => ({ code: a.code, issuer: a.issuer }));
}

/* ---------------------------------- build ---------------------------------- */

const lumens = (n: bigint) => fromMinorUnits(n, STELLAR_DECIMALS) ?? '0';

/** An amount in stroops as the move screen shows it: no trailing zeros, no float in between. */
export function amountText(n: bigint): string {
  const s = lumens(n);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** The operations of each step, batched at the guard's ceiling. */
export function fundOps(plan: MigrationPlan): xdr.Operation[] {
  if (plan.fund <= 0n) return [];
  return [
    plan.createTarget
      ? Operation.createAccount({ destination: plan.target, startingBalance: lumens(plan.fund) })
      : Operation.payment({ destination: plan.target, asset: Asset.native(), amount: lumens(plan.fund) }),
  ];
}

export function trustBatches(plan: MigrationPlan): xdr.Operation[][] {
  const ops = plan.trustlines.map((a) => Operation.changeTrust({ asset: new Asset(a.code, a.issuer) }));
  return chunk(ops);
}

export function moveBatches(plan: MigrationPlan): xdr.Operation[][] {
  const ops = plan.assets.map((a) =>
    Operation.payment({ destination: plan.target, asset: new Asset(a.code, a.issuer), amount: lumens(a.amount) }),
  );
  // Last, so every fee before it has already been paid out of what it sends.
  if (plan.xlm > 0n) ops.push(Operation.payment({ destination: plan.target, asset: Asset.native(), amount: lumens(plan.xlm) }));
  return chunk(ops);
}

function chunk(ops: xdr.Operation[]): xdr.Operation[][] {
  const out: xdr.Operation[][] = [];
  for (let i = 0; i < ops.length; i += MAX_OPS) out.push(ops.slice(i, i + MAX_OPS));
  return out;
}

/** How many transactions the whole plan takes — for the progress line. */
export function migrationSteps(plan: MigrationPlan): number {
  return (plan.fund > 0n ? 1 : 0) + batches(plan.trustlines.length) + batches(plan.assets.length + (plan.xlm > 0n ? 1 : 0));
}

/**
 * One transaction from `account` (its CURRENT sequence — load it fresh for every one),
 * bounded in time and carrying the wallet's memo like every transaction it builds.
 */
export function buildMigrationTx(cfg: NetConfig, account: Account, ops: xdr.Operation[], feePerOp: bigint): string {
  const builder = new TransactionBuilder(account, { fee: feePerOp.toString(), networkPassphrase: cfg.passphrase });
  for (const op of ops) builder.addOperation(op);
  const memo = defaultMemo();
  if (memo) builder.addMemo(Memo.text(memo.value));
  return builder.setTimeout(MIGRATION_TX_TIMEOUT_S).build().toXDR();
}

/* ---------------------------------- read ---------------------------------- */

/**
 * An account as the plan and the builder need it: its reduced record, and an `Account` at
 * its CURRENT sequence. Null when it does not exist on this network yet — a target before
 * its FUND step. Anything else Horizon answers is thrown, never read as "not found".
 */
export async function loadMigrationAccount(
  cfg: NetConfig,
  address: string,
): Promise<{ account: Account; state: MigrationAccount } | null> {
  let record: { account_id: string; sequence: string };
  try {
    record = (await getServer(cfg).loadAccount(address)) as unknown as { account_id: string; sequence: string };
  } catch (e) {
    const err = e as { name?: string; response?: { status?: number } };
    if (err?.name === 'NotFoundError' || err?.response?.status === 404) return null;
    throw e;
  }
  const state = readMigrationAccount(record);
  if (!state) throw new Error('Horizon returned an account record the migration cannot read.');
  return { account: new Account(record.account_id, record.sequence), state };
}

/** The network's current per-operation fee, stroops. 100 when Horizon will not say. */
export async function fetchFeePerOp(cfg: NetConfig): Promise<bigint> {
  try {
    return BigInt(await getServer(cfg).fetchBaseFee());
  } catch {
    return 100n;
  }
}
