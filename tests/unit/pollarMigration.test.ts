/**
 * Moving a Pollar wallet onto a key this device holds (src/lib/pollarMigration.ts).
 *
 * The plan decides how much leaves a funded account, so it is tested on the numbers:
 * reserves net of sponsorship, balances locked in offers, fees, and the order the steps
 * need. Then the transactions it builds are put through the real signing guard — the
 * `migrate` intent for the Pollar-signed ones — to prove the plan and the guard agree, and
 * that the guard still refuses what the plan never asked for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildMigrationTx,
  fundOps,
  migrationBounds,
  migrationPending,
  migrationSteps,
  moveBatches,
  planMigration,
  readMigrationAccount,
  trustBatches,
  withinConfirmed,
  type MigrationAccount,
} from '@/lib/pollarMigration';
import { assertSafeToSign, TxGuardError } from '@/lib/txGuard';
import type { NetConfig } from '@/lib/stellar';
import { BASE_RESERVE_STROOPS, TARGET_MARGIN_STROOPS } from '@/constants/migration';
import { MAX_OPS } from '@/constants/txGuard';

const CFG: NetConfig = { id: 'public', label: 'Mainnet', horizon: 'https://horizon.stellar.org', passphrase: Networks.PUBLIC };
const SOURCE = Keypair.random().publicKey();
const TARGET = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const FEE = 100n;
const XLM = 10_000_000n; // one lumen, in stroops

const account = (over: Partial<MigrationAccount> = {}): MigrationAccount => ({
  address: SOURCE,
  native: 0n,
  nativeLocked: 0n,
  subentries: 0,
  numSponsoring: 0,
  numSponsored: 0,
  assets: [],
  poolShares: false,
  ...over,
});

const usdc = (balance: bigint, locked = 0n) => ({ code: 'USDC', issuer: ISSUER, balance, locked });

test('a Horizon record reduces to stroops, liabilities and sponsorship', () => {
  const got = readMigrationAccount({
    account_id: SOURCE,
    subentry_count: 1,
    num_sponsoring: 0,
    num_sponsored: 2,
    balances: [
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER, balance: '12.5000000', selling_liabilities: '2.0000000' },
      { asset_type: 'liquidity_pool_shares', balance: '3.0000000' },
      { asset_type: 'native', balance: '7.1234567', selling_liabilities: '0.0000000' },
    ],
  });
  assert.deepEqual(got, {
    address: SOURCE,
    native: 71_234_567n,
    nativeLocked: 0n,
    subentries: 1,
    numSponsoring: 0,
    numSponsored: 2,
    assets: [{ code: 'USDC', issuer: ISSUER, balance: 125_000_000n, locked: 20_000_000n }],
    poolShares: true,
  });
  assert.equal(readMigrationAccount({ account_id: SOURCE }), null);
});

test('a new target is created with exactly its reserve, its trustline fees and the margin', () => {
  // 1 trustline on the source: its minimum is (2 + 1) * 0.5 XLM.
  const src = account({ native: 20n * XLM, subentries: 1, assets: [usdc(50n * XLM)] });
  const plan = planMigration(src, null, FEE, TARGET);
  assert.equal(plan.problem, null);
  assert.equal(plan.createTarget, true);
  assert.equal(plan.fund, 3n * BASE_RESERVE_STROOPS + FEE + TARGET_MARGIN_STROOPS);
  assert.deepEqual(plan.trustlines, [{ code: 'USDC', issuer: ISSUER }]);
  assert.deepEqual(plan.assets, [{ code: 'USDC', issuer: ISSUER, amount: 50n * XLM }]);
  // Everything free leaves: balance − own reserve − fund − its fee − the MOVE step's fees.
  const reserve = 3n * BASE_RESERVE_STROOPS;
  assert.equal(plan.xlm, 20n * XLM - reserve - plan.fund - FEE - 2n * FEE);
  assert.equal(plan.leftBehind, reserve);
});

test('what open offers hold stays, and the plan says so', () => {
  const src = account({ native: 20n * XLM, nativeLocked: XLM, subentries: 2, assets: [usdc(50n * XLM, 5n * XLM)] });
  const plan = planMigration(src, null, FEE, TARGET);
  assert.equal(plan.assets[0].amount, 45n * XLM);
  assert.equal(plan.lockedInOffers, true);
  assert.equal(plan.leftBehind, 4n * BASE_RESERVE_STROOPS + XLM);
});

test('a sponsored reserve is the sponsor’s, not the account’s to keep', () => {
  // Two entries paid for by Pollar: the account itself only has to hold the rest.
  const sponsored = planMigration(account({ native: 5n * XLM, subentries: 1, numSponsored: 2 }), null, FEE, TARGET);
  const own = planMigration(account({ native: 5n * XLM, subentries: 1 }), null, FEE, TARGET);
  assert.equal(sponsored.leftBehind + 2n * BASE_RESERVE_STROOPS, own.leftBehind);
  assert.equal(sponsored.xlm, own.xlm + 2n * BASE_RESERVE_STROOPS);
});

test('an existing target that can afford its trustlines is not funded again', () => {
  const src = account({ native: 20n * XLM, subentries: 1, assets: [usdc(50n * XLM)] });
  const tgt = account({ address: TARGET, native: 10n * XLM });
  const plan = planMigration(src, tgt, FEE, TARGET);
  assert.equal(plan.fund, 0n);
  assert.equal(plan.createTarget, false);
  // …and one already trusting the asset needs no TRUST step at all.
  const trusting = planMigration(src, account({ address: TARGET, native: 10n * XLM, subentries: 1, assets: [usdc(0n)] }), FEE, TARGET);
  assert.deepEqual(trusting.trustlines, []);
});

test('too little XLM to open the new account is a refusal with the numbers, not a partial move', () => {
  const plan = planMigration(account({ native: 15_000_000n, subentries: 1, assets: [usdc(50n * XLM)] }), null, FEE, TARGET);
  assert.equal(plan.problem?.kind, 'insufficient_xlm');
});

test('a finished move has nothing pending, and says there is nothing to move', () => {
  const src = account({ native: 3n * BASE_RESERVE_STROOPS, subentries: 1, assets: [usdc(0n)] });
  const tgt = account({ address: TARGET, native: 10n * XLM, subentries: 1, assets: [usdc(50n * XLM)] });
  const plan = planMigration(src, tgt, FEE, TARGET);
  assert.equal(migrationPending(plan), false);
  assert.equal(plan.problem?.kind, 'nothing_to_move');
});

test('many assets are batched at the guard’s ceiling, native payment last', () => {
  const assets = Array.from({ length: MAX_OPS + 2 }, (_, i) => ({ code: `T${i}`, issuer: ISSUER, balance: XLM, locked: 0n }));
  const plan = planMigration(account({ native: 100n * XLM, subentries: assets.length, assets }), null, FEE, TARGET);
  const moves = moveBatches(plan);
  assert.equal(moves.length, 2);
  assert.ok(moves.every((b) => b.length <= MAX_OPS));
  assert.equal(trustBatches(plan).length, 2);
  assert.equal(migrationSteps(plan), 1 + 2 + 2);
});

/* --------------------------- the guard agrees with the plan --------------------------- */

const sourceAccount = () => new Account(SOURCE, '100');
const planned = () => planMigration(account({ native: 20n * XLM, subentries: 1, assets: [usdc(50n * XLM)] }), null, FEE, TARGET);

const guard = (xdr: string, bounds = migrationBounds(planned())) =>
  assertSafeToSign(CFG, xdr, { intent: 'migrate', signer: SOURCE, destinations: [TARGET], maxMoves: bounds });

test('every Pollar-signed step of a plan passes the migrate guard', () => {
  const plan = planned();
  guard(buildMigrationTx(CFG, sourceAccount(), fundOps(plan), plan.feePerOp));
  for (const ops of moveBatches(plan)) guard(buildMigrationTx(CFG, sourceAccount(), ops, plan.feePerOp));
});

test('the guard refuses a move to anywhere but the new account', () => {
  const xdr = buildMigrationTx(
    CFG,
    sourceAccount(),
    [Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' })],
    FEE,
  );
  assert.throws(() => guard(xdr), (e: unknown) => e instanceof TxGuardError && e.key === 'guard.unconfirmedDestination');
});

test('the guard refuses more than the confirmed plan, and an asset it did not name', () => {
  const plan = planned();
  const over = buildMigrationTx(
    CFG,
    sourceAccount(),
    [Operation.payment({ destination: TARGET, asset: new Asset('USDC', ISSUER), amount: '50.0000001' })],
    FEE,
  );
  assert.throws(() => guard(over), (e: unknown) => e instanceof TxGuardError && e.key === 'guard.overMaxSend');
  const other = buildMigrationTx(
    CFG,
    sourceAccount(),
    [Operation.payment({ destination: TARGET, asset: new Asset('USDC', Keypair.random().publicKey()), amount: '1' })],
    plan.feePerOp,
  );
  assert.throws(() => guard(other), (e: unknown) => e instanceof TxGuardError && e.key === 'guard.wrongAsset');
});

test('the guard still refuses the merge that would recover the last reserve', () => {
  const merge = new TransactionBuilder(sourceAccount(), { fee: '100', networkPassphrase: CFG.passphrase })
    .addOperation(Operation.accountMerge({ destination: TARGET }))
    .setTimeout(300)
    .build()
    .toXDR();
  assert.throws(() => guard(merge), (e: unknown) => e instanceof TxGuardError && e.key === 'guard.criticalOp');
});

test('the trustline step passes the trustline guard as the new account', () => {
  const plan = planned();
  const [ops] = trustBatches(plan);
  const xdr = buildMigrationTx(CFG, new Account(TARGET, '5'), ops, plan.feePerOp);
  assertSafeToSign(CFG, xdr, {
    intent: 'trustline',
    signer: TARGET,
    destinations: 'self',
    confirmed: plan.trustlines.map((a) => ({ code: a.code, issuer: a.issuer })),
  });
});

test('a step that landed cheaper than budgeted does not push the last payment past the confirmed plan', () => {
  const confirmed = planned();
  // The same account, a few stroops richer: the fees actually charged were below the bid.
  const later = planMigration(account({ native: 20n * XLM + 300n, subentries: 1, assets: [usdc(50n * XLM)] }), null, FEE, TARGET);
  assert.ok(later.xlm > confirmed.xlm);
  const held = withinConfirmed(later, confirmed);
  assert.equal(held.xlm, confirmed.xlm);
  guard(buildMigrationTx(CFG, sourceAccount(), moveBatches(held).at(-1)!, FEE));
  // Assets are not capped: more of one than confirmed is for the guard to refuse.
  const richer = planMigration(account({ native: 20n * XLM, subentries: 1, assets: [usdc(60n * XLM)] }), null, FEE, TARGET);
  assert.equal(withinConfirmed(richer, confirmed).assets[0].amount, 60n * XLM);
});
