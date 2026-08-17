/**
 * Unit tests for the pre-signature guard (src/lib/signGuard.ts).
 *
 *   npm run test:guard
 *
 * Builds legitimate envelopes per intent (swap, LP deposit, LP withdraw,
 * off-ramp payout) and asserts they sign; then builds MALICIOUS variants —
 * wrong destination, dust destMin, extra operation, mismatched asset/issuer,
 * over-the-cap amounts, expired/absent/over-wide validity windows, future
 * minTime, fee-bump wrappers, account-takeover operations (setOptions,
 * accountMerge), wrong source, wrong passphrase network — and asserts the
 * guard REFUSES every one. Also checks clock-skew tolerance at both ends so a
 * phone a few minutes fast/slow does not reject fresh envelopes.
 */
import {
  Account,
  Asset,
  Keypair,
  LiquidityPoolAsset,
  Memo,
  Operation,
  TransactionBuilder,
  getLiquidityPoolId,
} from '@stellar/stellar-sdk';
import { SignGuardError, signWithGuard } from '../src/lib/signGuard.ts';

const PASS = 'Test Network Passphrase';
const cfg = { id: 'testnet', label: 'Testnet', horizon: 'https://horizon-testnet.stellar.org', passphrase: PASS };
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdc = () => new Asset('USDC', USDC_ISSUER);
const xlm = () => Asset.native();

const user = Keypair.random();
const pub = user.publicKey();
const attacker = Keypair.random().publicKey();
const feeWallet = Keypair.random().publicKey();
const account = new Account(pub, '1');

const nowSec = () => Math.floor(Date.now() / 1000);

interface BuildOpts {
  minTime?: number;
  maxTime?: number;
  fee?: string;
  memo?: string;
}

function build(ops: any[], opts: BuildOpts = {}) {
  const builder = new TransactionBuilder(account, {
    fee: opts.fee ?? '100',
    networkPassphrase: PASS,
    timebounds: {
      minTime: opts.minTime ?? 0,
      maxTime: opts.maxTime ?? nowSec() + 300,
    },
  });
  for (const op of ops) builder.addOperation(op);
  if (opts.memo) builder.addMemo(Memo.text(opts.memo));
  return builder.build();
}

const xdr = (tx: any) => tx.toXDR();

/* ------------------------------ harness ------------------------------ */

const fails: string[] = [];
function ok(cond: unknown, msg: string) {
  if (cond) {
    console.log('✓ ' + msg);
  } else {
    fails.push(msg);
    console.log('✗ ' + msg);
  }
}

function signs(fn: () => unknown, msg: string) {
  try {
    fn();
    ok(true, msg);
  } catch (e) {
    ok(false, `${msg} — NO firmó (${(e as Error).message})`);
  }
}

function refuses(fn: () => unknown, msg: string) {
  try {
    fn();
    ok(false, `${msg} — ¡NO SE RECHAZÓ!`);
  } catch (e) {
    if (e instanceof SignGuardError) ok(true, msg);
    else ok(false, `${msg} — error inesperado: ${(e as Error).message}`);
  }
}

const secret = user.secret();

/* ------------------------------ intents ------------------------------ */

const swapIntent = (over: Record<string, unknown> = {}) => ({
  intent: 'swap' as const,
  source: pub,
  assetIn: { code: 'XLM', issuer: null },
  amountIn: '10',
  assetOut: { code: 'USDC', issuer: USDC_ISSUER },
  minOut: '9.5',
  quoteAmount: '10',
  fee: { amount: '0.05', asset: { code: 'USDC', issuer: USDC_ISSUER }, wallet: feeWallet },
  ...over,
});

const swapOps = [
  Operation.pathPaymentStrictSend({
    sendAsset: xlm(),
    sendAmount: '10',
    destination: pub,
    destAsset: usdc(),
    destMin: '9.5',
    path: [usdc()],
  }),
  Operation.payment({ destination: feeWallet, asset: usdc(), amount: '0.05' }),
];

const depositIntent = (over: Record<string, unknown> = {}) => ({
  intent: 'liquidityDeposit' as const,
  source: pub,
  assetA: { code: 'XLM', issuer: null },
  maxAmountA: '5',
  assetB: { code: 'USDC', issuer: USDC_ISSUER },
  maxAmountB: '10',
  ...over,
});

const poolId = () => getLiquidityPoolId('constant_product', { assetA: xlm(), assetB: usdc(), fee: 30 }).toString('hex');
const poolShare = () => new LiquidityPoolAsset(xlm(), usdc(), 30);

const depositOps = [
  Operation.changeTrust({ asset: poolShare() }),
  Operation.liquidityPoolDeposit({ liquidityPoolId: poolId(), maxAmountA: '5', maxAmountB: '10', minPrice: '0.5', maxPrice: '2' }),
];

const withdrawIntent = (over: Record<string, unknown> = {}) => ({
  intent: 'liquidityWithdraw' as const,
  source: pub,
  poolId: poolId(),
  shares: '50',
  redeem: [
    { asset: { code: 'XLM', issuer: null }, amount: '4.5' },
    { asset: { code: 'USDC', issuer: USDC_ISSUER }, amount: '9' },
  ],
  ...over,
});

const withdrawOps = [
  Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId(), amount: '50', minAmountA: '4.5', minAmountB: '9' }),
];

const offrampIntent = (over: Record<string, unknown> = {}) => ({
  intent: 'offrampPayout' as const,
  source: pub,
  token: { code: 'USDC', issuer: USDC_ISSUER },
  amountOut: '12.34',
  ...over,
});

const offrampOps = [Operation.payment({ destination: attacker, asset: usdc(), amount: '12.34' })];

/* ================================ SWAP ================================= */

signs(() => signWithGuard(cfg, secret, xdr(build(swapOps, { memo: 'Cosmos Swap Commission' })), swapIntent()), 'swap: legit envelope signs');

signs(() => signWithGuard(cfg, secret, xdr(build([swapOps[0]])), swapIntent()), 'swap: no fee payment in envelope still signs (fee is optional)');

refuses(() => signWithGuard(cfg, secret, xdr(build([swapOps[0], Operation.payment({ destination: feeWallet, asset: usdc(), amount: '0.05' })])), swapIntent({ fee: undefined })), 'swap: payment without a declared quote fee is refused');

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.pathPaymentStrictSend({ sendAsset: xlm(), sendAmount: '10', destination: attacker, destAsset: usdc(), destMin: '9.5', path: [usdc()] })])), swapIntent()),
  'swap: wrong destination (attacker) refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.pathPaymentStrictSend({ sendAsset: xlm(), sendAmount: '10', destination: pub, destAsset: usdc(), destMin: '0.1', path: [usdc()] })])), swapIntent()),
  'swap: dust destMin (< quote minimum) refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ assetOut: { code: 'USD', issuer: USDC_ISSUER } })),
  'swap: asset mismatch (USD vs USDC — startsWith would pass, exact compare refuses)',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ assetOut: { code: 'USDC', issuer: attacker } })),
  'swap: same code, different issuer refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ amountIn: '1' })),
  'swap: envelope sends more than the typed amount refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ minOut: '10' })),
  'swap: destMin below the approved minimum refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ quoteAmount: '1' })),
  'swap: stale quote (priced for a different amount) refused',
);

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ minOut: '' })), 'swap: no quote on screen refused');

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...swapOps, Operation.payment({ destination: attacker, asset: xlm(), amount: '1' })])), swapIntent()),
  'swap: extra payment (attacker) refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ fee: { amount: '9', asset: { code: 'USDC', issuer: USDC_ISSUER }, wallet: feeWallet } })),
  'swap: fee amount mismatch refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ fee: { amount: '0.05', asset: { code: 'USDC', issuer: USDC_ISSUER }, wallet: attacker } })),
  'swap: fee sent to wrong wallet refused',
);

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps)), swapIntent({ source: attacker })), 'swap: wrong source account refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { maxTime: nowSec() - 400 })), swapIntent()), 'swap: expired maxTime refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { maxTime: 0 })), swapIntent()), 'swap: absent maxTime (0) refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { minTime: nowSec() - 200, maxTime: nowSec() + 30 * 24 * 3600 })), swapIntent()), 'swap: over-wide validity window refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { minTime: nowSec() + 400, maxTime: nowSec() + 700 })), swapIntent()), 'swap: future minTime (beyond skew) refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { fee: '20000000' })), swapIntent()), 'swap: fee above ceiling refused');

/* ------------------- account-takeover operations ------------------- */

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(build([...swapOps, Operation.setOptions({ masterWeight: 0, signer: { ed25519PublicKey: attacker, weight: 1 } })])),
      swapIntent(),
    ),
  'swap: setOptions { masterWeight: 0, signer: attacker } refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...swapOps, Operation.accountMerge({ destination: attacker })])), swapIntent()),
  'swap: accountMerge refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...swapOps, Operation.bumpSequence({ bumpTo: '999' })])), swapIntent()),
  'swap: bumpSequence refused',
);

/* --------------------------- fee-bump wrapper --------------------------- */

refuses(() => {
  const inner = build(swapOps);
  const fb = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), '100', inner, PASS);
  return signWithGuard(cfg, secret, xdr(fb), swapIntent());
}, 'fee-bump wrapper refused');

/* ------------------------- own-passphrase decode ------------------------- */

// The guard never accepts a counterparty-supplied passphrase (it has no such
// parameter) and always signs with the wallet's own — so the produced signature
// must verify against the hash computed with the wallet's passphrase.
signs(() => {
  const signed = signWithGuard(cfg, secret, xdr(build([swapOps[0]])), swapIntent());
  const decoded = TransactionBuilder.fromXDR(signed, PASS);
  const sig = decoded.signatures[0];
  if (!sig || !user.verify(decoded.hash(), sig.signature())) throw new Error('signature does not verify with wallet passphrase');
  return signed;
}, 'signature verifies with the wallet’s own passphrase');

/* ============================ LP DEPOSIT ============================= */

signs(() => signWithGuard(cfg, secret, xdr(build(depositOps)), depositIntent()), 'deposit: legit envelope (changeTrust + pool deposit) signs');

signs(
  () => signWithGuard(cfg, secret, xdr(build(depositOps, { memo: 'Cosmos Liquidity Commission' })), depositIntent()),
  'deposit: legit envelope with commission memo still signs',
);

signs(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(
        build([
          Operation.changeTrust({ asset: poolShare() }),
          Operation.liquidityPoolDeposit({ liquidityPoolId: poolId(), maxAmountA: '5', maxAmountB: '10', minPrice: '0.5', maxPrice: '2' }),
          Operation.payment({ destination: feeWallet, asset: xlm(), amount: '0.05' }),
        ], { memo: 'Cosmos Liquidity Commission' }),
      ),
      depositIntent(),
    ),
  'deposit: commission payment within 2% cap signs',
);

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(build([...depositOps, Operation.payment({ destination: feeWallet, asset: xlm(), amount: '3' })], { memo: 'Cosmos Liquidity Commission' })),
      depositIntent(),
    ),
  'deposit: commission payment over the 2% cap refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...depositOps, Operation.payment({ destination: feeWallet, asset: xlm(), amount: '0.05' })])), depositIntent()),
  'deposit: payment without commission memo refused',
);

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(
        build([
          Operation.changeTrust({ asset: poolShare() }),
          Operation.liquidityPoolDeposit({ liquidityPoolId: poolId(), maxAmountA: '8', maxAmountB: '10', minPrice: '0.5', maxPrice: '2' }),
        ]),
      ),
      depositIntent(),
    ),
  'deposit: maxAmountA above typed cap refused',
);

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(
        build([
          Operation.changeTrust({ asset: poolShare() }),
          Operation.liquidityPoolDeposit({ liquidityPoolId: poolId(), maxAmountA: '5', maxAmountB: '20', minPrice: '0.5', maxPrice: '2' }),
        ]),
      ),
      depositIntent(),
    ),
  'deposit: maxAmountB above typed cap refused',
);

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(
        build([
          Operation.changeTrust({ asset: poolShare() }),
          Operation.liquidityPoolDeposit({ liquidityPoolId: 'a'.repeat(64), maxAmountA: '5', maxAmountB: '10', minPrice: '0.5', maxPrice: '2' }),
        ]),
      ),
      depositIntent(),
    ),
  'deposit: wrong pool id refused',
);

signs(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(
        build([
          Operation.changeTrust({ asset: poolShare() }),
          Operation.liquidityPoolDeposit({ liquidityPoolId: poolId(), maxAmountA: '5', maxAmountB: '10', minPrice: '0.5', maxPrice: '2' }),
        ]),
      ),
      depositIntent({ maxAmountB: undefined }),
    ),
  'deposit: auto-B envelope signs (auto side bounded by the pool ratio, A capped by user)',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...depositOps, Operation.setOptions({ masterWeight: 0, signer: { ed25519PublicKey: attacker, weight: 1 } })])), depositIntent()),
  'deposit: setOptions refused',
);

/* ============================ LP WITHDRAW ============================ */

signs(() => signWithGuard(cfg, secret, xdr(build(withdrawOps)), withdrawIntent()), 'withdraw: legit envelope signs');

signs(
  () => signWithGuard(cfg, secret, xdr(build([...withdrawOps, Operation.payment({ destination: feeWallet, asset: usdc(), amount: '0.1' })], { memo: 'Cosmos Liquidity Commission' })), withdrawIntent()),
  'withdraw: commission payment within 2% of redeem preview signs',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.liquidityPoolWithdraw({ liquidityPoolId: 'b'.repeat(64), amount: '50', minAmountA: '4.5', minAmountB: '9' })])), withdrawIntent()),
  'withdraw: wrong pool refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId(), amount: '60', minAmountA: '4.5', minAmountB: '9' })])), withdrawIntent()),
  'withdraw: burning more shares than approved refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId(), amount: '50', minAmountA: '0', minAmountB: '0' })])), withdrawIntent()),
  'withdraw: redemption returning zero value refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([...withdrawOps, Operation.setOptions({ masterWeight: 0, signer: { ed25519PublicKey: attacker, weight: 1 } })])), withdrawIntent()),
  'withdraw: setOptions refused',
);

/* ============================ OFFRAMP PAYOUT ============================ */

signs(() => signWithGuard(cfg, secret, xdr(build(offrampOps)), offrampIntent()), 'offramp: legit payout signs');

signs(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(build([Operation.payment({ destination: attacker, asset: usdc(), amount: '12' }), Operation.payment({ destination: attacker, asset: usdc(), amount: '0.34' })])),
      offrampIntent(),
    ),
  'offramp: split payments summing to the approved total sign',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.payment({ destination: attacker, asset: usdc(), amount: '12.35' })])), offrampIntent()),
  'offramp: amount above the approved total refused',
);

refuses(
  () => signWithGuard(cfg, secret, xdr(build([Operation.payment({ destination: attacker, asset: xlm(), amount: '12.34' })])), offrampIntent()),
  'offramp: wrong token (XLM instead of USDC) refused',
);

refuses(
  () =>
    signWithGuard(
      cfg,
      secret,
      xdr(build([...offrampOps, Operation.bumpSequence({ bumpTo: '999' })])),
      offrampIntent(),
    ),
  'offramp: non-payment operation refused',
);

refuses(() => signWithGuard(cfg, secret, xdr(build(offrampOps)), offrampIntent({ token: { code: 'USDC', issuer: null } })), 'offramp: token without verifiable issuer refused');

refuses(() => signWithGuard(cfg, secret, xdr(build(offrampOps)), offrampIntent({ amountOut: '0' })), 'offramp: no quote (amountOut 0) refused');

/* ============================ CLOCK SKEW ============================ */

// A phone a few minutes fast must not reject a fresh envelope...
signs(() => signWithGuard(cfg, secret, xdr(build(swapOps, { minTime: nowSec() + 120 })), swapIntent()), 'clock: minTime 2min in the future still signs (5-min skew)');
signs(() => signWithGuard(cfg, secret, xdr(build(swapOps, { maxTime: nowSec() - 120 })), swapIntent()), 'clock: maxTime 2min in the past still signs (5-min skew)');
// ...but a phone 10 minutes off must refuse rather than sign blind.
refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { minTime: nowSec() + 600, maxTime: nowSec() + 900 })), swapIntent()), 'clock: minTime 10min in the future refused');
refuses(() => signWithGuard(cfg, secret, xdr(build(swapOps, { maxTime: nowSec() - 600 })), swapIntent()), 'clock: maxTime 10min in the past refused');

/* ============================ SIGNED OUTPUT ============================ */

signs(() => {
  const signed = signWithGuard(cfg, secret, xdr(build(swapOps, { memo: 'Cosmos Swap Commission' })), swapIntent());
  const decoded = TransactionBuilder.fromXDR(signed, PASS);
  if (decoded.signatures.length < 1) throw new Error('no signature in signed output');
  return signed;
}, 'signed output carries the wallet signature');

/* ------------------------------- summary ------------------------------- */

console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
