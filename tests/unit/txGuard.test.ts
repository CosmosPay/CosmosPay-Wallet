/**
 * The pre-signature guard, exercised against real XDR built with the SDK.
 *
 * These are the cases that used to be signed blind: the wallet handed its key to
 * whatever envelope the gateway (or a dapp) returned, without decoding it. The
 * second wave — destination, the floor on what comes back, the total across
 * operations, asset identity, the validity window — are the holes a review found
 * still open after the first: every check passed while the money left for an
 * attacker's account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, BASE_FEE, Claimant, Keypair, LiquidityPoolAsset, Networks, Operation, TimeoutInfinite, TransactionBuilder } from '@stellar/stellar-sdk';
import { assertSafeToSign, reviewTx, CRITICAL_OPS, TxGuardError } from '@/lib/txGuard';
import type { NetConfig } from '@/lib/stellar';

const CFG: NetConfig = {
  id: 'testnet',
  label: 'Testnet',
  horizon: 'https://horizon-testnet.stellar.org',
  passphrase: Networks.TESTNET,
};

const me = Keypair.fromSecret('SDJHRQF4GCMIIKAAAQ6IHY42X73FQFLHUULAPSKKD4DFDM7UXWWCRHBE');
const ME = me.publicKey();
const OTHER = Keypair.random().publicKey();
const ATTACKER = Keypair.random().publicKey();

const USDC = new Asset('USDC', OTHER);
const FAKE_USDC = new Asset('USDC', ATTACKER);

/** Build an envelope from `ops`, sourced from `source` (defaults to us). */
function envelope(ops: ReturnType<typeof Operation.payment>[], source = ME, timeout = 180): string {
  const builder = new TransactionBuilder(new Account(source, '1'), {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
  });
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(timeout).build().toXDR();
}

const payment = (opts: Partial<Parameters<typeof Operation.payment>[0]> = {}) =>
  Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '10', ...(opts as object) } as Parameters<typeof Operation.payment>[0]);

/** A swap as the gateway builds it: XLM out, USDC back, settling into our account. */
const swapOp = (opts: Record<string, unknown> = {}) =>
  Operation.pathPaymentStrictSend({
    sendAsset: Asset.native(),
    sendAmount: '10',
    destination: ME,
    destAsset: USDC,
    destMin: '9',
    ...opts,
  } as never);

/** The bounds a real swap passes: send ≤ 10 XLM, receive ≥ 9 USDC, settle to self. */
const SWAP_OPTS = {
  signer: ME,
  intent: 'swap',
  destinations: 'self',
  maxSend: { amount: '10', asset: { code: 'XLM', issuer: null } },
  minReceive: { amount: '9', asset: { code: 'USDC', issuer: OTHER } },
} as const;

/** The off-ramp's bounds. `maxSend` is not optional here: the intent's type demands
 *  it, which is what stops "one unknown destination, unlimited amount". */
const CAP_XLM = { amount: '10', asset: { code: 'XLM', issuer: null } } as const;
const OFFRAMP = { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM } as const;

const throws = (fn: () => unknown, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof TxGuardError && re.test((e as Error).message));

/* -------------------------------- baseline -------------------------------- */

test('a legitimate swap envelope passes', () => {
  const review = assertSafeToSign(CFG, envelope([swapOp()]), SWAP_OPTS);
  assert.equal(review.source, ME);
  assert.equal(review.operations.length, 1);
  assert.equal(review.operations[0].type, 'pathPaymentStrictSend');
  assert.ok(!review.hasCritical);
});

/* ------------------------- where the money goes --------------------------- */

test('a swap that pays a third party is refused — every other check passes', () => {
  // The exact quoted amount, the allowed operation type, our own source account, a
  // normal fee. Only the destination is the attacker's, and that used to be enough.
  throws(() => assertSafeToSign(CFG, envelope([swapOp({ destination: ATTACKER })]), SWAP_OPTS), /no a la tuya/);
});

test('a swap that promises dust in return is refused', () => {
  throws(() => assertSafeToSign(CFG, envelope([swapOp({ destMin: '0.0000001' })]), SWAP_OPTS), /menos de lo cotizado/);
});

test('a swap that guarantees no return at all is refused', () => {
  // Sends the quoted amount to us, in the asset we are paying with: nothing comes back.
  const xdr = envelope([swapOp({ destAsset: Asset.native(), destMin: '9' })]);
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /no garantiza que recibas/);
});

test('an off-ramp may pay one counterparty, never two', () => {
  // Cap of 20 so the two 10-XLM payments stay inside it: this test is about where the
  // money goes, and the total-across-operations cap is exercised on its own below.
  const opts = { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: { amount: '20', asset: { code: 'XLM', issuer: null } } } as const;
  assert.doesNotThrow(() => assertSafeToSign(CFG, envelope([payment(), payment()]), opts));
  throws(
    () => assertSafeToSign(CFG, envelope([payment(), payment({ destination: ATTACKER })]), opts),
    /varios destinatarios/,
  );
});

test('a flow that names its destinations refuses any other', () => {
  const base = { signer: ME, intent: 'offramp', maxSend: CAP_XLM } as const;
  assert.doesNotThrow(() => assertSafeToSign(CFG, envelope([payment()]), { ...base, destinations: [OTHER] }));
  throws(() => assertSafeToSign(CFG, envelope([payment()]), { ...base, destinations: [ATTACKER] }), /no confirmaste/);
});

/* ----------------------------- account takeover --------------------------- */

test('setOptions adding a signer is refused', () => {
  const xdr = envelope([Operation.setOptions({ signer: { ed25519PublicKey: ATTACKER, weight: 255 } }) as never]);
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /crítica/);
  // …and it is still rendered, flagged, for the dapp path.
  const review = reviewTx(CFG, xdr);
  assert.ok(review.hasCritical);
  assert.ok(review.operations[0].rows.some((r) => r.value.includes(ATTACKER)));
});

test('accountMerge is refused', () => {
  const xdr = envelope([Operation.accountMerge({ destination: ATTACKER }) as never]);
  assert.throws(
    () => assertSafeToSign(CFG, xdr, { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
    TxGuardError,
  );
  assert.ok(reviewTx(CFG, xdr).hasCritical);
});

test('a Soroban invocation counts as critical', () => {
  // The window decodes a contract id and a function name and nothing else, so it
  // cannot tell a price read from a SAC transfer of the whole balance. It used to
  // render as one empty row with no warning at all.
  assert.ok(CRITICAL_OPS.includes('invokeHostFunction'));
  assert.ok(reviewTx(CFG, envelope([payment()])).operations.every((o) => !o.critical));
});

test('a transaction sourced from another account is refused', () => {
  throws(
    () => assertSafeToSign(CFG, envelope([payment()], OTHER), { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
    /no sale de tu cuenta/,
  );
});

test('an operation acting on another account is refused', () => {
  throws(
    () => assertSafeToSign(CFG, envelope([payment({ source: OTHER })]), { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
    /actúa sobre otra cuenta/,
  );
});

/* ------------------------------- allowlist -------------------------------- */

test('an operation outside the flow allowlist is refused', () => {
  // A plain payment has no business in a liquidity-pool deposit.
  throws(
    () => assertSafeToSign(CFG, envelope([payment()]), { signer: ME, intent: 'lp-deposit', destinations: 'self', poolAmounts: ['10'] }),
    /inesperada/,
  );
  // The same envelope is fine for the flow it belongs to.
  assert.doesNotThrow(() =>
    assertSafeToSign(CFG, envelope([payment()]), { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
  );
});

test('order-book offers are no longer allowed in a swap', () => {
  // Their cost is a price ratio settled against the book, so no bound the user
  // confirmed can be enforced against one. They used to be in ALLOWED_OPS.swap and
  // produced no row the amount cap could read, which made the cap not apply at all.
  const xdr = envelope([
    Operation.manageSellOffer({ selling: Asset.native(), buying: USDC, amount: '1000000', price: '0.0000001' }) as never,
  ]);
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /inesperada/);
  // And the review marks it as moving value it cannot quantify, so any future flow
  // that allowlists it fails closed instead of skipping the cap.
  const op = reviewTx(CFG, xdr).operations[0];
  assert.equal(op.movesValue, true);
  assert.equal(op.sends.length, 0);
});

test('a fee-bump wrapper is refused', () => {
  const inner = TransactionBuilder.fromXDR(envelope([payment()]), CFG.passphrase);
  inner.sign(me); // fee-bump requires a signed inner transaction
  const bump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), String(Number(BASE_FEE) * 4), inner as never, CFG.passphrase);
  throws(
    () => assertSafeToSign(CFG, bump.toXDR(), { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
    /fee-bump/,
  );
});

test('more operations than the flow needs is refused', () => {
  const xdr = envelope(Array.from({ length: 9 }, () => payment()));
  throws(
    () => assertSafeToSign(CFG, xdr, { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: CAP_XLM }),
    /9 operaciones/,
  );
});

/* ----------------------------- amount bounds ------------------------------ */


test('an amount above the confirmed quote is refused', () => {
  throws(
    () => assertSafeToSign(CFG, envelope([payment({ amount: '500' })]), OFFRAMP),
    /más de lo confirmado/,
  );
  // Within the quote (plus the 1% rounding tolerance) it passes.
  assert.doesNotThrow(() => assertSafeToSign(CFG, envelope([payment({ amount: '10' })]), OFFRAMP));
});

test('the cap is on the total, not on each operation', () => {
  // Stellar allows 100 operations per transaction. Comparing them one at a time made
  // the effective ceiling 100 × cap: each payment was exactly the quoted amount.
  const xdr = envelope([payment({ amount: '10' }), payment({ amount: '10' })]);
  throws(() => assertSafeToSign(CFG, xdr, OFFRAMP), /más de lo confirmado/);
});

test('an asset whose code merely starts with the confirmed one is refused', () => {
  // `startsWith` used to accept USDC against a confirmed "USD" — and returning null
  // for a mismatch meant no cap at all, so the impostor moved an unbounded amount.
  const xdr = envelope([payment({ asset: USDC, amount: '1000000' })]);
  throws(
    () => assertSafeToSign(CFG, xdr, { ...OFFRAMP, maxSend: { amount: '10', asset: { code: 'USD' } } }),
    /no es el activo que confirmaste/,
  );
});

test('the same code from another issuer is refused when the flow knows the issuer', () => {
  const xdr = envelope([payment({ asset: FAKE_USDC, amount: '10' })]);
  throws(
    () => assertSafeToSign(CFG, xdr, { ...OFFRAMP, maxSend: { amount: '10', asset: { code: 'USDC', issuer: OTHER } } }),
    /no es el activo que confirmaste/,
  );
  assert.doesNotThrow(() =>
    assertSafeToSign(CFG, envelope([payment({ asset: USDC, amount: '10' })]), {
      ...OFFRAMP,
      maxSend: { amount: '10', asset: { code: 'USDC', issuer: OTHER } },
    }),
  );
});

test('the amount is read from the decoded operation, not from a UI row', () => {
  // The rows are Spanish presentation strings; the cap used to be recovered by
  // finding the one labelled 'Importe'. Translating that label would have removed
  // the cap with the whole suite green — so the decoded value must be there too.
  const op = reviewTx(CFG, envelope([payment({ amount: '42.5' })])).operations[0];
  assert.equal(op.sends.length, 1);
  assert.equal(op.sends[0].amount, '42.5000000');
  assert.deepEqual(op.sends[0].asset, { code: 'XLM', issuer: null });
});

/* ----------------------------- validity window ---------------------------- */

test('an envelope that never expires is refused', () => {
  const xdr = envelope([payment()], ME, TimeoutInfinite);
  assert.equal(reviewTx(CFG, xdr).maxTime, null);
  throws(() => assertSafeToSign(CFG, xdr, OFFRAMP), /no caduca nunca/);
});

test('an expired envelope is refused', () => {
  const xdr = envelope([payment()]);
  const future = Math.floor(Date.now() / 1000) + 3600;
  throws(() => assertSafeToSign(CFG, xdr, { ...OFFRAMP, now: future }), /ya ha caducado/i);
});

test('an envelope valid for longer than a day is refused', () => {
  const xdr = envelope([payment()], ME, 60 * 60 * 48);
  throws(() => assertSafeToSign(CFG, xdr, OFFRAMP), /demasiado tiempo/);
});

test('reviewTx surfaces the validity window for the approval window', () => {
  const review = reviewTx(CFG, envelope([payment()]));
  assert.ok(review.maxTime && Number(review.maxTime) > Math.floor(Date.now() / 1000));
});

/* -------------------------------- trustlines ------------------------------ */

test('a swap may open the trustline it needs, and no other', () => {
  const ok = envelope([Operation.changeTrust({ asset: USDC }) as never, swapOp()]);
  assert.doesNotThrow(() => assertSafeToSign(CFG, ok, SWAP_OPTS));

  const impostor = envelope([Operation.changeTrust({ asset: FAKE_USDC }) as never, swapOp()]);
  throws(() => assertSafeToSign(CFG, impostor, SWAP_OPTS), /que no confirmaste/);
});

test('removing a trustline is refused outside the trustline flow', () => {
  const xdr = envelope([Operation.changeTrust({ asset: USDC, limit: '0' }) as never, swapOp()]);
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /elimina una línea/);
});

/* ------------------------------- liquidity -------------------------------- */

/* Zero pool envelopes existed in this suite while the two liquidity flows were the
   two that passed no bounds at all — the tests covered the guard and not what was
   handed to it. `liquidityPoolDeposit`/`Withdraw` are built by hand because the SDK
   builders want a real 64-hex pool id. */

const POOL = 'a'.repeat(64);
const OTHER_POOL = 'b'.repeat(64);

const poolDeposit = (o: Record<string, unknown> = {}) =>
  Operation.liquidityPoolDeposit({
    liquidityPoolId: POOL,
    maxAmountA: '10',
    maxAmountB: '20',
    minPrice: { n: 1, d: 2 },
    maxPrice: { n: 2, d: 1 },
    ...o,
  } as never);

const poolWithdraw = (o: Record<string, unknown> = {}) =>
  Operation.liquidityPoolWithdraw({
    liquidityPoolId: POOL,
    amount: '5',
    minAmountA: '1',
    minAmountB: '2',
    ...o,
  } as never);

const LP_DEPOSIT = { signer: ME, intent: 'lp-deposit', destinations: 'self', poolAmounts: ['10', '20'] } as const;
const LP_WITHDRAW = { signer: ME, intent: 'lp-withdraw', destinations: 'self', poolId: POOL, poolAmounts: ['5'] } as const;

test('a liquidity deposit within the confirmed ceilings passes', () => {
  const review = assertSafeToSign(CFG, envelope([poolDeposit()]), LP_DEPOSIT);
  assert.equal(review.operations[0].poolId, POOL);
  assert.equal(review.operations[0].sends.length, 2);
});

test('a liquidity deposit above the confirmed ceilings is refused', () => {
  // The whole balance into a pool of the gateway's choosing: allowed operation type,
  // our own account, no destination field for the destination policy to catch.
  throws(() => assertSafeToSign(CFG, envelope([poolDeposit({ maxAmountA: '9999999' })]), LP_DEPOSIT), /más de lo que confirmaste/);
});

test('the pool ceilings match in either canonical order', () => {
  // Stellar orders A/B canonically, which need not match the order of the form.
  assert.doesNotThrow(() =>
    assertSafeToSign(CFG, envelope([poolDeposit({ maxAmountA: '20', maxAmountB: '10' })]), LP_DEPOSIT),
  );
});

test('a withdrawal from a pool the user did not choose is refused', () => {
  throws(
    () => assertSafeToSign(CFG, envelope([poolWithdraw({ liquidityPoolId: OTHER_POOL })]), LP_WITHDRAW),
    /pool distinto/,
  );
});

test('a withdrawal that guarantees nothing back is refused', () => {
  // Burn every share, receive one stroop. The mirror of the swap dust case, and the
  // one the suite had for swap and not here.
  throws(() => assertSafeToSign(CFG, envelope([poolWithdraw({ minAmountA: '0' })]), LP_WITHDRAW), /garantiza recibir cero/);
});

test('burning more shares than confirmed is refused', () => {
  throws(() => assertSafeToSign(CFG, envelope([poolWithdraw({ amount: '500' })]), LP_WITHDRAW), /más de lo que confirmaste/);
});

test('closing a pool position may drop the share trustline', () => {
  // `changeTrust(shares, 0)` recovers the 0.5 XLM reserve and is how a full exit ends.
  // Testing `lineRemoves` before `linePoolShare` refused every one of them.
  const shares = new LiquidityPoolAsset(Asset.native(), USDC, 30);
  const xdr = envelope([poolWithdraw(), Operation.changeTrust({ asset: shares, limit: '0' }) as never]);
  assert.doesNotThrow(() => assertSafeToSign(CFG, xdr, LP_WITHDRAW));
});

/* ------------------------ operations nobody could read ---------------------- */

test('an operation the wallet cannot read counts as moving value', () => {
  // The `default:` branch used to leave `movesValue = false`, so the operations the
  // guard understood least were the ones it bounded least.
  const xdr = envelope([Operation.bumpSequence({ bumpTo: '9223372036854775807' }) as never]);
  const op = reviewTx(CFG, xdr).operations[0];
  assert.equal(op.critical, true); // bricks the account: no later sequence can be reached
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /crítica/);
});

test('createClaimableBalance shows what it moves, and is refused', () => {
  // It rendered as a friendly label with zero rows: a total drain shown as a blank line.
  const xdr = envelope([
    Operation.createClaimableBalance({
      asset: Asset.native(),
      amount: '10000',
      claimants: [new Claimant(ATTACKER)],
    }) as never,
  ]);
  const op = reviewTx(CFG, xdr).operations[0];
  assert.ok(op.rows.some((r) => r.value.includes('10000')));
  assert.ok(op.rows.some((r) => r.label === 'Reclamantes'));
  assert.equal(op.critical, true);
  throws(() => assertSafeToSign(CFG, xdr, SWAP_OPTS), /crítica/);
});

test('a post-dated envelope is refused', () => {
  // The counterparty submits these, so `minTime = now + hours` is a free option on
  // the quote. Only `maxTime` was ever read.
  const now = Math.floor(Date.now() / 1000);
  const tx = new TransactionBuilder(new Account(ME, '1'), { fee: BASE_FEE, networkPassphrase: CFG.passphrase })
    .addOperation(payment())
    .setTimebounds(now + 600, now + 800)
    .build();
  throws(() => assertSafeToSign(CFG, tx.toXDR(), OFFRAMP), /no es válida hasta más tarde/);
});

/* --------------------------------- parsing -------------------------------- */

test('an empty envelope is refused', () => {
  const xdr = new TransactionBuilder(new Account(ME, '1'), { fee: BASE_FEE, networkPassphrase: CFG.passphrase })
    .setTimeout(180)
    .build()
    .toXDR();
  throws(() => assertSafeToSign(CFG, xdr, OFFRAMP), /ninguna operación/);
});

test('garbage that is not an envelope is refused — this is what extractUnsignedXdr could return', () => {
  assert.throws(() => reviewTx(CFG, 'not-a-transaction-but-longer-than-forty-characters'), TxGuardError);
  assert.throws(() => assertSafeToSign(CFG, '', OFFRAMP), TxGuardError);
});

test('reviewTx surfaces destination and amount for the approval window', () => {
  const review = reviewTx(CFG, envelope([payment({ destination: OTHER, amount: '42.5' })]));
  const rows = review.operations[0].rows;
  assert.equal(rows.find((r) => r.label === 'Destino')?.value, OTHER);
  // The SDK pads to Stellar's 7 decimal places — that is the value being signed,
  // so it is the value the window must show.
  assert.equal(rows.find((r) => r.label === 'Importe')?.value, '42.5000000 XLM');
  assert.equal(review.feeXlm, '0.00001');
});
