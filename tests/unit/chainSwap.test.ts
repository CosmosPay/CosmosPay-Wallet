/**
 * Paying from Solana and Monad: the keys the wallet signs with, the transactions it
 * builds, and — above all — the checks that decide whether a transaction the gateway
 * built may be signed at all. Each refusal case here is a way the gateway (or anyone
 * between it and the wallet) could otherwise take more than the user confirmed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { chainAddressesFromMnemonic, toChecksumAddress } from '@/lib/chainAddresses';
import { chainSecret } from '@/lib/chainKeys';
import {
  approveCalldata,
  bytesToHex,
  checkMonadSwapCalls,
  evmAddressOf,
  hexToBytes,
  signEip1559,
  transferCalldata,
} from '@/lib/evmTx';
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  WRAPPED_SOL_MINT,
  checkSwapEffects,
  messageAccounts,
  parseSolanaTx,
  signSolanaTx,
  solTransferTx,
  splTransferTx,
  type AccountState,
} from '@/lib/solanaTx';
import { MONAD_CHAIN_ID } from '@/constants/chains';
import { T } from '@/lib/i18n';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOL = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/* ---------------------------------- keys --------------------------------- */

test('the signing keys belong to the addresses the wallet shows', async () => {
  const { solana, monad } = await chainAddressesFromMnemonic(PHRASE);
  const solSecret = await chainSecret(PHRASE, 'solana', solana);
  assert.equal(base58.encode(ed25519.getPublicKey(solSecret)), solana);
  const evmSecret = await chainSecret(PHRASE, 'monad', monad.toLowerCase());
  assert.equal(evmAddressOf(evmSecret), monad);
});

test('a key is refused when it does not control the address on screen', async () => {
  await assert.rejects(chainSecret(PHRASE, 'solana', '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK'));
  await assert.rejects(chainSecret(PHRASE, 'monad', '0x0000000000000000000000000000000000000001'));
});

/* --------------------------------- Solana -------------------------------- */

const OWNER_SECRET = new Uint8Array(32).fill(7);
const OWNER = base58.encode(ed25519.getPublicKey(OWNER_SECRET));
const OTHER = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)));
const BLOCKHASH = base58.encode(new Uint8Array(32).fill(1));

test('the associated token account matches the SPL reference derivation', () => {
  assert.equal(
    associatedTokenAddress('13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK', USDC_SOL, TOKEN_PROGRAM_ID),
    '6Ta6QEER1jvgZ2yYx5iJwXxtzYqMr6xv7gvxW5ZPX1iW',
  );
});

test('a SOL deposit is one System transfer, signed by the wallet alone', () => {
  const wire = solTransferTx(OWNER, OTHER, 1_500_000n, BLOCKHASH);
  const { signed, id } = signSolanaTx(wire, OWNER_SECRET, OWNER);
  const tx = parseSolanaTx(signed);
  assert.deepEqual(tx.signers, [OWNER]);
  assert.ok(ed25519.verify(tx.signatures[0], tx.message, base58.decode(OWNER)));
  assert.equal(id, base58.encode(tx.signatures[0]));
  // header [1 signer, 0 readonly signed, 1 readonly unsigned]: owner, destination, System.
  assert.deepEqual([...tx.message.subarray(0, 4)], [1, 0, 1, 3]);
  // transfer = u32 2 ‖ u64 lamports, little-endian.
  const data = tx.message.subarray(tx.message.length - 12);
  assert.deepEqual([...data.subarray(0, 4)], [2, 0, 0, 0]);
  assert.equal(new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true), 1_500_000n);
});

test('an SPL deposit opens the recipient account idempotently and transfers checked', () => {
  const wire = splTransferTx({
    owner: OWNER,
    to: OTHER,
    mint: USDC_SOL,
    decimals: 6,
    amount: 2_000_000n,
    tokenProgram: TOKEN_PROGRAM_ID,
    recentBlockhash: BLOCKHASH,
  });
  const tx = parseSolanaTx(wire);
  assert.deepEqual(tx.signers, [OWNER]);
  const keys = Array.from({ length: tx.message[3] }, (_, i) => base58.encode(tx.message.subarray(4 + i * 32, 36 + i * 32)));
  assert.ok(keys.includes(associatedTokenAddress(OTHER, USDC_SOL, TOKEN_PROGRAM_ID)));
  assert.ok(keys.includes(associatedTokenAddress(OWNER, USDC_SOL, TOKEN_PROGRAM_ID)));
  // TransferChecked = 12 ‖ u64 amount ‖ u8 decimals, last in the message.
  const tail = tx.message.subarray(tx.message.length - 10);
  assert.equal(tail[0], 12);
  assert.equal(tail[9], 6);
});

test('a transaction with another signer, or another fee payer, is not signed', () => {
  assert.throws(() => signSolanaTx(solTransferTx(OTHER, OWNER, 1n, BLOCKHASH), OWNER_SECRET, OWNER));
});

/** 165 bytes of an SPL token account. */
function tokenData(mint: string, owner: string, amount: bigint, opts: { delegate?: boolean; close?: boolean } = {}): Uint8Array {
  const d = new Uint8Array(165);
  d.set(base58.decode(mint), 0);
  d.set(base58.decode(owner), 32);
  new DataView(d.buffer).setBigUint64(64, amount, true);
  if (opts.delegate) d[72] = 1;
  d[108] = 1; // initialized
  if (opts.close) d[129] = 1;
  return d;
}
const wallet = (lamports: bigint, owner = SYSTEM_PROGRAM_ID): AccountState => ({ lamports, owner, data: new Uint8Array() });
const token = (mint: string, amount: bigint, opts: { delegate?: boolean; close?: boolean; owner?: string } = {}): AccountState => ({
  lamports: 2_039_280n,
  owner: TOKEN_PROGRAM_ID,
  data: tokenData(mint, opts.owner ?? OWNER, amount, opts),
});

const USDC_ACC = 'usdc-account';
const USDT_ACC = 'usdt-account';
const RULES = {
  owner: OWNER,
  sell: { asset: 'native', amount: 1_000_000_000n },
  buy: { asset: USDC_SOL, minimum: 150_000_000n },
  lamportAllowance: 10_000_000n,
};
const PRE = new Map<string, AccountState>([
  [OWNER, wallet(2_000_000_000n)],
  [USDC_ACC, token(USDC_SOL, 5_000_000n)],
  [USDT_ACC, token(USDT_SOL, 9_000_000n)],
]);
const post = (over: Record<string, AccountState>) =>
  new Map<string, AccountState>([
    [OWNER, wallet(999_995_000n)],
    [USDC_ACC, token(USDC_SOL, 160_000_000n)],
    [USDT_ACC, token(USDT_SOL, 9_000_000n)],
    ...Object.entries(over),
  ]);

test('a swap that sells the SOL confirmed and delivers the minimum may be signed', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({})), null);
});

test('a swap that also moves another token is refused', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({ [USDT_ACC]: token(USDT_SOL, 0n) })), 'drain');
});

test('a swap that closes a funded token account is refused', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({ [USDT_ACC]: null })), 'drain');
});

test('a swap that takes more SOL than confirmed plus fees is refused', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({ [OWNER]: wallet(900_000_000n) })), 'drain');
});

test('a swap that delegates, re-owns or reassigns an account is refused', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({ [USDT_ACC]: token(USDT_SOL, 9_000_000n, { delegate: true }) })), 'authority');
  assert.equal(checkSwapEffects(RULES, PRE, post({ [USDT_ACC]: token(USDT_SOL, 9_000_000n, { owner: OTHER }) })), 'authority');
  assert.equal(checkSwapEffects(RULES, PRE, post({ [OWNER]: wallet(999_995_000n, TOKEN_PROGRAM_ID) })), 'authority');
});

test('a swap that delivers less than the quote’s minimum is refused', () => {
  assert.equal(checkSwapEffects(RULES, PRE, post({ [USDC_ACC]: token(USDC_SOL, 100_000_000n) })), 'short');
});

test('the output landing in an account the swap opens counts as received', () => {
  const pre = new Map(PRE);
  pre.delete(USDC_ACC);
  pre.set('new-ata', null);
  const after = post({ 'new-ata': token(USDC_SOL, 155_000_000n) });
  after.delete(USDC_ACC);
  assert.equal(checkSwapEffects(RULES, pre, after), null);
});

test('unwrapping by closing a funded wSOL account into the wallet is not a loss', () => {
  // Found against mainnet: Jupiter unwraps by closing the wSOL account, which moves its
  // lamports to the wallet. Counted as a token loss it refused every honest swap from a
  // wallet that already held wrapped SOL.
  const WSOL_ACC = 'wsol-account';
  const pre = new Map(PRE).set(WSOL_ACC, { ...token(WRAPPED_SOL_MINT, 5_000_000_000n)!, lamports: 5_002_039_280n });
  const rules = { ...RULES, sell: { asset: 'native', amount: 1_000_000_000n } };
  // The wallet ends with its own SOL, minus the 1 SOL sold, plus the unwrapped 5 SOL.
  assert.equal(checkSwapEffects(rules, pre, post({ [WSOL_ACC]: null, [OWNER]: wallet(6_002_034_280n) })), null);
  // Closed into someone else: the 5 SOL is gone from the wallet's side of the ledger.
  assert.equal(checkSwapEffects(rules, pre, post({ [WSOL_ACC]: null })), 'drain');
});

test('the writable accounts of a message are the ones its header marks writable', () => {
  const { writable, lookups } = messageAccounts(parseSolanaTx(solTransferTx(OWNER, OTHER, 1n, BLOCKHASH)).message);
  assert.deepEqual(writable, [OWNER, OTHER]);
  assert.deepEqual(lookups, []);
});

/* --------------------------------- Monad --------------------------------- */

const ROUTER = '0x1111111111111111111111111111111111111111';
const USDC_MON = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const call = (over: Partial<{ to: string; data: string; value: string; chainId: number }> = {}) => ({
  to: ROUTER,
  data: '0xdeadbeef',
  value: '0',
  chainId: MONAD_CHAIN_ID,
  ...over,
});

test('selling MON: value up to the amount, and no approval', () => {
  assert.equal(checkMonadSwapCalls(call({ value: '100' }), null, 'native', 100n, MONAD_CHAIN_ID), null);
  assert.equal(checkMonadSwapCalls(call({ value: '101' }), null, 'native', 100n, MONAD_CHAIN_ID), 'value');
  const approval = call({ to: USDC_MON, data: approveCalldata(ROUTER, 100n) });
  assert.equal(checkMonadSwapCalls(call({ value: '100' }), approval, 'native', 100n, MONAD_CHAIN_ID), 'approval');
});

test('selling a token: no MON attached, and only the exact approval', () => {
  const exact = call({ to: USDC_MON, data: approveCalldata(ROUTER, 100n) });
  assert.equal(checkMonadSwapCalls(call(), exact, USDC_MON, 100n, MONAD_CHAIN_ID), null);
  assert.equal(checkMonadSwapCalls(call(), null, USDC_MON, 100n, MONAD_CHAIN_ID), null);
  assert.equal(checkMonadSwapCalls(call({ value: '1' }), exact, USDC_MON, 100n, MONAD_CHAIN_ID), 'value');
  const unlimited = call({ to: USDC_MON, data: approveCalldata(ROUTER, 2n ** 256n - 1n) });
  assert.equal(checkMonadSwapCalls(call(), unlimited, USDC_MON, 100n, MONAD_CHAIN_ID), 'approval');
  const otherSpender = call({ to: USDC_MON, data: approveCalldata('0x2222222222222222222222222222222222222222', 100n) });
  assert.equal(checkMonadSwapCalls(call(), otherSpender, USDC_MON, 100n, MONAD_CHAIN_ID), 'approval');
  const otherToken = call({ to: '0x3333333333333333333333333333333333333333', data: approveCalldata(ROUTER, 100n) });
  assert.equal(checkMonadSwapCalls(call(), otherToken, USDC_MON, 100n, MONAD_CHAIN_ID), 'approval');
});

test('a call for another chain is refused', () => {
  assert.equal(checkMonadSwapCalls(call({ chainId: 1 }), null, 'native', 0n, MONAD_CHAIN_ID), 'chain');
});

test('a signed EIP-1559 transaction recovers to the wallet’s address', () => {
  const secret = new Uint8Array(32).fill(5);
  const tx = {
    chainId: MONAD_CHAIN_ID,
    nonce: 3n,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 200_000_000_000n,
    gasLimit: 60_000n,
    to: USDC_MON,
    value: 0n,
    data: transferCalldata(ROUTER, 5n),
  };
  const { raw, hash } = signEip1559(tx, secret);
  const bytes = hexToBytes(raw);
  assert.equal(bytes[0], 0x02);
  assert.equal(hash, bytesToHex(keccak_256(bytes)));
  // The last 3 RLP items are yParity, r (32 bytes), s (32 bytes): re-derive the signer.
  const sBytes = bytes.subarray(bytes.length - 32);
  const rBytes = bytes.subarray(bytes.length - 65, bytes.length - 33);
  const yParity = bytes[bytes.length - 67] === 0x80 ? 0 : bytes[bytes.length - 67];
  const sig = new secp256k1.Signature(BigInt(bytesToHex(rBytes)), BigInt(bytesToHex(sBytes)), yParity);
  // Rebuild the unsigned payload from the signed one: drop the three signature items.
  const signedList = bytes.subarray(1);
  const lenOfLen = signedList[0] - 0xf7;
  const body = signedList.subarray(1 + lenOfLen, signedList.length - 67);
  const header = body.length < 56 ? Uint8Array.of(0xc0 + body.length) : Uint8Array.of(0xf8, body.length);
  const payload = new Uint8Array([0x02, ...header, ...body]);
  const pub = sig.recoverPublicKey(keccak_256(payload)).toBytes(false);
  assert.equal(toChecksumAddress(bytesToHex(keccak_256(pub.subarray(1)).subarray(12))), evmAddressOf(secret));
});

test('transfer and approve calldata are the standard ABI encoding', () => {
  assert.equal(
    transferCalldata(ROUTER, 255n),
    '0xa9059cbb' + '1111111111111111111111111111111111111111'.padStart(64, '0') + 'ff'.padStart(64, '0'),
  );
  assert.equal(approveCalldata(ROUTER, 1n).slice(0, 10), '0x095ea7b3');
});

/* ---------------------------------- copy --------------------------------- */

test('every refusal the wallet can raise has a sentence in every language', () => {
  for (const code of ['authority', 'drain', 'short', 'simulation', 'chain', 'value', 'approval', 'address', 'timeout']) {
    const entry = T[`xswap.refused.${code}`];
    assert.ok(entry, `xswap.refused.${code} is missing`);
    for (const lang of ['es', 'en', 'pt', 'de', 'fr'] as const) assert.ok(entry[lang], `xswap.refused.${code}.${lang}`);
  }
});
