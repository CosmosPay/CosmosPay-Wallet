/**
 * The `usdt0` intent of the signing guard (src/lib/txGuard.ts): USDT0 out of Stellar through the
 * bridge's OFT, checked as a template. The envelopes are built here exactly as a mainnet
 * simulation of `send` recorded them (2026-11-09): the call, and the tree of authorizations the
 * account gives with it — directly through the OFT, or through the fee wrapper when a commission
 * is charged. Each refusal below is one way an envelope can look like a transfer and be another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Address, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { assertSafeToSign, TxGuardError, type GuardOptions } from '@/lib/txGuard';
import type { NetConfig } from '@/lib/stellar';
import { USDT0_FEE_COLLECTOR, USDT0_FEE_WRAPPERS, USDT0_OFT, USDT0_SAC, XLM_SAC_MAINNET } from '@/constants/usdt0';
import { bridgedAmount, evmAddressToBytes32 } from '@/lib/usdt0';

const MAIN: NetConfig = { id: 'public', label: 'Mainnet', horizon: 'https://horizon.stellar.org', passphrase: Networks.PUBLIC };
const ME = Keypair.fromSecret('SDJHRQF4GCMIIKAAAQ6IHY42X73FQFLHUULAPSKKD4DFDM7UXWWCRHBE').publicKey();
const ATTACKER = Keypair.random().publicKey();
const FEE_WALLET = 'GARMB7W3FCR3GKIM3FLWVJASC2PUZ4VHUJZTNJVWWKNTCJNKO6TBCT76';
const WRAPPER = USDT0_FEE_WRAPPERS[0];
const EVM = '0x02f35c5EC1A3706620B6c03586B0666d6812D4c4';
const OTHER_EVM = '0x' + 'ab'.repeat(20);

const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });
const addr = (a: string) => new Address(a).toScVal();
const bytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));
const struct = (o: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(o)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: o[k] })),
  );
const inv = (contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
    ),
    subInvocations: subs,
  });

interface Shape {
  /** USDT0 the OFT sends, in stroops (1 USDT0 = 10_000_000). */
  amount?: bigint;
  min?: bigint;
  native?: bigint;
  zro?: bigint;
  eid?: number;
  to?: string;
  extraOptions?: number;
  /** A commission through the wrapper; 0 sends straight through the OFT. */
  commission?: bigint;
  feeWallet?: string;
  refund?: string;
  root?: string;
  burn?: bigint;
  collector?: string;
  extraSub?: boolean;
  credentials?: 'source' | 'address';
  authArgsDiffer?: boolean;
  entries?: number;
  extraOp?: boolean;
}

/** An envelope shaped as the gateway builds one, with `s` bending one thing about it. */
function envelope(s: Shape = {}): string {
  const amount = s.amount ?? 10_000_000n;
  const native = s.native ?? 46_226_804n;
  const param = struct({
    amount_ld: i128(amount),
    compose_msg: bytes(new Uint8Array()),
    dst_eid: xdr.ScVal.scvU32(s.eid ?? 30101),
    extra_options: bytes(new Uint8Array(s.extraOptions ?? 0)),
    min_amount_ld: i128(s.min ?? amount),
    oft_cmd: bytes(new Uint8Array()),
    to: bytes(evmAddressToBytes32(s.to ?? EVM)!),
  });
  const fee = struct({ native_fee: i128(native), zro_fee: i128(s.zro ?? 0n) });
  const refund = addr(s.refund ?? ME);
  const sendArgs = [addr(ME), param, fee, refund];
  const sendSubs = [
    inv(USDT0_SAC, 'burn', [addr(ME), i128(s.burn ?? amount)]),
    inv(XLM_SAC_MAINNET, 'transfer', [addr(ME), addr(s.collector ?? USDT0_FEE_COLLECTOR), i128(native)]),
    ...(s.extraSub ? [inv(USDT0_SAC, 'transfer', [addr(ME), addr(ATTACKER), i128(1n)])] : []),
  ];
  const commission = s.commission ?? 0n;
  const wallet = s.feeWallet ?? FEE_WALLET;
  const fees = xdr.ScVal.scvVec([struct({ amount: i128(commission), wallet: addr(wallet) })]);
  const rootContract = s.root ?? (commission ? WRAPPER : USDT0_OFT);
  const callArgs = commission ? [addr(ME), fees, ...sendArgs.slice(1)] : sendArgs;
  const root = commission
    ? inv(rootContract, 'send', callArgs, [inv(USDT0_SAC, 'transfer', [addr(ME), addr(wallet), i128(commission)]), inv(USDT0_OFT, 'send', sendArgs, sendSubs)])
    : inv(rootContract, 'send', s.authArgsDiffer ? [addr(ME), param, struct({ native_fee: i128(native + 1n), zro_fee: i128(0n) }), refund] : callArgs, sendSubs);
  const credentials =
    s.credentials === 'address'
      ? xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({ address: new Address(ATTACKER).toScAddress(), nonce: 1n as never, signatureExpirationLedger: 100, signature: xdr.ScVal.scvVoid() }),
        )
      : xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: root });
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({ contractAddress: new Address(rootContract).toScAddress(), functionName: 'send', args: callArgs }),
    ),
    auth: Array.from({ length: s.entries ?? 1 }, () => entry),
  });
  const builder = new TransactionBuilder(new Account(ME, '1'), { fee: BASE_FEE, networkPassphrase: MAIN.passphrase }).addOperation(op);
  if (s.extraOp) builder.addOperation(Operation.bumpSequence({ bumpTo: '2' }));
  return builder.setTimeout(180).build().toXDR();
}

/** What the screen confirmed: send 1 USDT0, 1 arrives, the fee capped at the quote's ceiling. */
const OPTS: Extract<GuardOptions, { intent: 'usdt0' }> = {
  signer: ME,
  intent: 'usdt0',
  destinations: 'self',
  maxSend: '1',
  minReceive: '1',
  maxNativeFee: '5.5472165',
  maxCommission: '0',
  dstEid: 30101,
  recipient: EVM,
};
/** The same with the plan's 0.65% commission, as the quote declares it. */
const WITH_FEE = { ...OPTS, minReceive: '0.9935', maxCommission: '0.0065' };
const FEE_SHAPE: Shape = { commission: 65_000n, amount: 9_935_000n };

const refuses = (xdrText: string, opts: GuardOptions, key: string) =>
  assert.throws(
    () => assertSafeToSign(MAIN, xdrText, opts),
    (e: unknown) => {
      assert.ok(e instanceof TxGuardError, `expected a TxGuardError, got ${String(e)}`);
      assert.equal((e as TxGuardError).key, key);
      return true;
    },
  );

test('a transfer straight through the OFT, as the gateway builds it, passes', () => {
  const review = assertSafeToSign(MAIN, envelope(), OPTS);
  assert.equal(review.operations[0].type, 'invokeHostFunction');
});

test('a transfer through the fee wrapper with the quoted commission passes', () => {
  assertSafeToSign(MAIN, envelope(FEE_SHAPE), WITH_FEE);
});

test('a commission the quote did not declare is refused', () => {
  refuses(envelope(FEE_SHAPE), { ...OPTS, minReceive: '0.9935' }, 'guard.usdt0Commission');
  refuses(envelope({ commission: 650_000n, amount: 9_350_000n }), WITH_FEE, 'guard.usdt0Commission');
});

test('the USDT may only arrive at this wallet’s own address, on the network chosen', () => {
  refuses(envelope({ to: OTHER_EVM }), OPTS, 'guard.usdt0Recipient');
  refuses(envelope({ eid: 30110 }), OPTS, 'guard.usdt0Network');
});

test('what leaves is bounded by what was typed, and the floor by the quote', () => {
  refuses(envelope({ amount: 20_000_000n }), OPTS, 'guard.usdt0Amount');
  refuses(envelope({ min: 5_000_000n }), OPTS, 'guard.usdt0Floor');
  refuses(envelope({ native: 60_000_000n }), OPTS, 'guard.usdt0NativeFee');
});

test('every authorization is the exact tree a send records — nothing more, nothing elsewhere', () => {
  refuses(envelope({ collector: ATTACKER }), OPTS, 'guard.usdt0Tree');
  refuses(envelope({ burn: 9_000_000n }), OPTS, 'guard.usdt0Tree');
  refuses(envelope({ extraSub: true }), OPTS, 'guard.usdt0Tree');
  refuses(envelope({ root: 'CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK' }), OPTS, 'guard.usdt0Contract');
});

test('the authorization is the account’s own, given once, for the call the transaction makes', () => {
  refuses(envelope({ credentials: 'address' }), OPTS, 'guard.usdt0Credentials');
  refuses(envelope({ entries: 2 }), OPTS, 'guard.usdt0Auth');
  refuses(envelope({ authArgsDiffer: true }), OPTS, 'guard.usdt0AuthMismatch');
});

test('the unused fee comes back to us, and nothing extra rides along', () => {
  refuses(envelope({ refund: ATTACKER }), OPTS, 'guard.usdt0From');
  refuses(envelope({ extraOptions: 4 }), OPTS, 'guard.usdt0Options');
  refuses(envelope({ zro: 1n }), OPTS, 'guard.usdt0Options');
  refuses(envelope({ ...FEE_SHAPE, feeWallet: ME }), WITH_FEE, 'guard.usdt0Fees');
  refuses(envelope({ extraOp: true }), OPTS, 'guard.usdt0Shape');
});

test('the same contract call under any other intent is still refused as critical', () => {
  refuses(
    envelope(),
    { signer: ME, intent: 'offramp', destinations: 'counterparty', maxSend: { amount: '1', asset: { code: 'XLM', issuer: null } } },
    'guard.criticalOp',
  );
});

test('an amount crosses at six decimals, and only an EVM address is a recipient', () => {
  assert.equal(bridgedAmount('10.1234567'), '10.123456');
  assert.equal(bridgedAmount('5'), '5');
  assert.equal(bridgedAmount('0.0000009'), null);
  assert.equal(bridgedAmount('abc'), null);
  assert.equal(evmAddressToBytes32('0x123'), null);
  const b = evmAddressToBytes32(EVM)!;
  assert.equal(b.length, 32);
  assert.ok(b.slice(0, 12).every((x) => x === 0));
  assert.equal(b[12], 0x02);
});
