/**
 * Paying from Solana and Monad: the keys the wallet signs with, the transactions it
 * builds, and — above all — the checks that decide whether a transaction the gateway
 * built may be signed at all. Each refusal case here is a way the gateway (or anyone
 * between it and the wallet) could otherwise take more than the user confirmed.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { chainAddressesFromMnemonic, toChecksumAddress } from '@/lib/chainAddresses';
import { chainSecret } from '@/lib/chainKeys';
import { ChainSwapRefused, chainBalances, signSolanaSwap } from '@/lib/chainSwap';
import { AssociatedReadRefused } from '@/lib/solanaTokenBalances';
import { DEFAULT_SOLANA_RPC_URL } from '@/constants/backends';
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
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  WRAPPED_SOL_MINT,
  checkSwapEffects,
  compileLegacyTx,
  messageAccounts,
  ownTokenAccounts,
  parseSolanaTx,
  signSolanaTx,
  solTransferTx,
  splTransferTx,
  type AccountState,
} from '@/lib/solanaTx';
import { MONAD_CHAIN_ID } from '@/constants/chains';
import { T } from '@/lib/i18n';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

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

/* ------------------------- which accounts are ours ------------------------ */

test('ours: every account under a token program that names the owner, associated or not, and nothing else', () => {
  const accounts = new Map<string, AccountState>([
    [OWNER, wallet(1n)],
    ['owner-usdc-not-associated', token(USDC_SOL, 5n)],
    ['owner-usdt-2022', { ...token(USDT_SOL, 5n)!, owner: TOKEN_2022_PROGRAM_ID }],
    ['others-usdc', token(USDC_SOL, 5n, { owner: OTHER })],
    // The owner's bytes under a program that is not a token program: not a token account.
    ['look-alike', { ...token(USDC_SOL, 5n)!, owner: 'BPFLoaderUpgradeab1e11111111111111111111111' }],
    ['a-mint', { lamports: 1n, owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) }],
    ['missing', null],
  ]);
  assert.deepEqual([...ownTokenAccounts(OWNER, accounts)].sort(), ['owner-usdc-not-associated', 'owner-usdt-2022']);
});

/** The node a swap is checked against: accounts before (`getMultipleAccounts`) and after (`simulateTransaction`). */
function swapNode(before: Record<string, AccountState>, after: Record<string, AccountState>) {
  const raw = (s: AccountState) => (s ? { lamports: Number(s.lamports), owner: s.owner, data: [Buffer.from(s.data).toString('base64'), 'base64'] } : null);
  const calls: { url: string; method: string; params: unknown[] }[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const { id, method, params } = JSON.parse(init.body);
    calls.push({ url, method, params });
    const result =
      method === 'getBalance'
        ? { context: { slot: 1 }, value: 7 }
        : method === 'getAccountInfo'
        ? { value: { lamports: 1, owner: TOKEN_PROGRAM_ID, data: [Buffer.alloc(82).toString('base64'), 'base64'] } }
        : method === 'getMultipleAccounts'
          ? { value: (params[0] as string[]).map((a) => raw(before[a] ?? null)) }
          : method === 'simulateTransaction'
            ? { value: { err: null, accounts: (params[1] as { accounts: { addresses: string[] } }).accounts.addresses.map((a) => raw(after[a] ?? null)) } }
            : undefined;
    if (result === undefined) throw new Error(`unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  }) as typeof fetch;
  const simulated = () => {
    const sim = calls.find((c) => c.method === 'simulateTransaction');
    return sim ? (sim.params[1] as { accounts: { addresses: string[] } }).accounts.addresses : null;
  };
  return { calls, simulated };
}

// A swap selling 1 SOL for USDC, as a route writes it: the wallet, a token account of the
// wallet's that is NOT its associated one, a token account of somebody else's (a pool's
// vault, say), and the wallet's USDC associated account, which the swap opens. A token
// account of the wallet's that the route only reads cannot change, so it is never asked for.
const OWN_TOKEN = base58.encode(new Uint8Array(32).fill(21));
const POOL_VAULT = base58.encode(new Uint8Array(32).fill(22));
const READ_ONLY_OWN = base58.encode(new Uint8Array(32).fill(23));
const ROUTE = base58.encode(new Uint8Array(32).fill(24));
const BUY_ATA = associatedTokenAddress(OWNER, USDC_SOL, TOKEN_PROGRAM_ID);
const SWAP_WIRE = Buffer.from(
  compileLegacyTx(OWNER, BLOCKHASH, [
    {
      program: ROUTE,
      accounts: [
        { key: OWNER, signer: true, writable: true },
        { key: OWN_TOKEN, signer: false, writable: true },
        { key: POOL_VAULT, signer: false, writable: true },
        { key: BUY_ATA, signer: false, writable: true },
        { key: READ_ONLY_OWN, signer: false, writable: false },
      ],
      data: Uint8Array.of(1),
    },
  ]),
).toString('base64');
const SWAP = {
  wire: SWAP_WIRE,
  secret: OWNER_SECRET,
  owner: OWNER,
  sell: 'native',
  buy: USDC_SOL,
  amount: 1_000_000_000n,
  minimum: 150_000_000n,
};
const SWAP_BEFORE = (ownProgram = TOKEN_PROGRAM_ID): Record<string, AccountState> => ({
  [OWNER]: wallet(2_000_000_000n),
  [OWN_TOKEN]: { ...token(USDT_SOL, 9_000_000n)!, owner: ownProgram },
  [POOL_VAULT]: token(USDT_SOL, 50_000_000n, { owner: OTHER }),
  [READ_ONLY_OWN]: token(USDT_SOL, 1_000_000n),
});
const SWAP_AFTER = (over: Record<string, AccountState> = {}, ownProgram = TOKEN_PROGRAM_ID): Record<string, AccountState> => ({
  [OWNER]: wallet(999_995_000n),
  [OWN_TOKEN]: { ...token(USDT_SOL, 9_000_000n)!, owner: ownProgram },
  [POOL_VAULT]: token(USDT_SOL, 50_000_000n, { owner: OTHER }),
  [BUY_ATA]: token(USDC_SOL, 160_000_000n),
  ...over,
});
const refusedWith = (code: string) => (e: unknown) => e instanceof ChainSwapRefused && e.code === code;

test('a swap that only does what was confirmed is signed; ours were found by reading the writable accounts', async () => {
  const { calls, simulated } = swapNode(SWAP_BEFORE(), SWAP_AFTER());
  const signed = await signSolanaSwap(SWAP);
  const tx = parseSolanaTx(Buffer.from(signed, 'base64'));
  assert.ok(ed25519.verify(tx.signatures[0], tx.message, base58.decode(OWNER)));
  assert.ok(calls.every((c) => c.url === DEFAULT_SOLANA_RPC_URL));
  assert.ok(!calls.some((c) => c.method === 'getTokenAccountsByOwner'), 'no indexed query');
  // Every writable account was read, its fixed part only; nothing the route only reads.
  const read = calls.find((c) => c.method === 'getMultipleAccounts')!;
  assert.deepEqual(new Set(read.params[0] as string[]), new Set([OWNER, OWN_TOKEN, POOL_VAULT, BUY_ATA]));
  assert.deepEqual((read.params[1] as { dataSlice: unknown }).dataSlice, { offset: 0, length: 165 });
  assert.deepEqual(new Set(simulated()), new Set([OWNER, OWN_TOKEN, BUY_ATA]));
});

test('a writable token account of the owner that is not its associated one is ours: draining it is refused', async () => {
  const { simulated } = swapNode(SWAP_BEFORE(), SWAP_AFTER({ [OWN_TOKEN]: token(USDT_SOL, 0n) }));
  await assert.rejects(signSolanaSwap(SWAP), refusedWith('drain'));
  assert.ok(simulated()!.includes(OWN_TOKEN));
  // The same under Token-2022.
  swapNode(SWAP_BEFORE(TOKEN_2022_PROGRAM_ID), SWAP_AFTER({ [OWN_TOKEN]: { ...token(USDT_SOL, 0n)!, owner: TOKEN_2022_PROGRAM_ID } }, TOKEN_2022_PROGRAM_ID));
  await assert.rejects(signSolanaSwap(SWAP), refusedWith('drain'));
  // Delegated or handed to somebody else: still ours, still refused.
  swapNode(SWAP_BEFORE(), SWAP_AFTER({ [OWN_TOKEN]: token(USDT_SOL, 9_000_000n, { delegate: true }) }));
  await assert.rejects(signSolanaSwap(SWAP), refusedWith('authority'));
  swapNode(SWAP_BEFORE(), SWAP_AFTER({ [OWN_TOKEN]: token(USDT_SOL, 9_000_000n, { owner: OTHER }) }));
  await assert.rejects(signSolanaSwap(SWAP), refusedWith('authority'));
});

test('a writable token account of somebody else is not ours: what it loses is the counterparty’s', async () => {
  const { simulated } = swapNode(SWAP_BEFORE(), SWAP_AFTER({ [POOL_VAULT]: token(USDT_SOL, 0n, { owner: OTHER }) }));
  assert.equal(typeof (await signSolanaSwap(SWAP)), 'string');
  assert.ok(!simulated()!.includes(POOL_VAULT));
});

test('a writable account the node cannot answer for refuses the swap before it is simulated', async () => {
  const unreadable = (answer: (addresses: string[]) => unknown) => {
    const calls: string[] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const { id, method, params } = JSON.parse(init.body);
      calls.push(method);
      const result =
        method === 'getAccountInfo' ? { value: { lamports: 1, owner: TOKEN_PROGRAM_ID, data: ['', 'base64'] } } : { value: answer(params[0]) };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    }) as typeof fetch;
    return calls;
  };
  // One entry short: the missing account is not one that does not exist.
  let calls = unreadable((addresses) => addresses.slice(1).map(() => null));
  await assert.rejects(signSolanaSwap(SWAP), /getMultipleAccounts: the answer does not match/);
  assert.ok(!calls.includes('simulateTransaction'));
  // An entry that is not an account.
  calls = unreadable((addresses) => addresses.map(() => ({ lamports: 1, owner: TOKEN_PROGRAM_ID, data: ['not base64!', 'base64'] })));
  await assert.rejects(signSolanaSwap(SWAP), /could not be read/);
  assert.ok(!calls.includes('simulateTransaction'));
  calls = unreadable((addresses) => addresses.map(() => ({ owner: TOKEN_PROGRAM_ID })));
  await assert.rejects(signSolanaSwap(SWAP), /could not be read/);
  assert.ok(!calls.includes('simulateTransaction'));
});

test('the swap screen’s Solana balances: SOL, and USDC and USDT at their associated accounts, from the wallet’s node', async () => {
  const usdc2022 = associatedTokenAddress(OWNER, USDC_SOL, TOKEN_2022_PROGRAM_ID);
  const { calls } = swapNode({ [BUY_ATA]: token(USDC_SOL, 42_000_000n), [usdc2022]: { ...token(USDC_SOL, 1n)!, owner: TOKEN_2022_PROGRAM_ID } }, {});
  assert.deepEqual(await chainBalances('solana', OWNER), { native: 7n, [USDC_SOL]: 42_000_001n, [USDT_SOL]: 0n });
  assert.ok(calls.every((c) => c.url === DEFAULT_SOLANA_RPC_URL));
  assert.deepEqual(calls.map((c) => c.method).sort(), ['getBalance', 'getMultipleAccounts']);
  assert.deepEqual(calls.find((c) => c.method === 'getMultipleAccounts')!.params[0], [
    BUY_ATA,
    usdc2022,
    associatedTokenAddress(OWNER, USDT_SOL, TOKEN_PROGRAM_ID),
    associatedTokenAddress(OWNER, USDT_SOL, TOKEN_2022_PROGRAM_ID),
  ]);
  // Somebody else's account where the wallet's belongs: unknown, never a zero.
  swapNode({ [BUY_ATA]: token(USDC_SOL, 42_000_000n, { owner: OTHER }) }, {});
  await assert.rejects(chainBalances('solana', OWNER), (e: unknown) => e instanceof AssociatedReadRefused && e.problem === 'account');
});

test('a simulation that answers for fewer accounts than asked is refused, not read as accounts it deleted', async () => {
  swapNode(SWAP_BEFORE(), SWAP_AFTER());
  const answer = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const res = await answer(url, init as RequestInit);
    if (JSON.parse(init.body).method !== 'simulateTransaction') return res;
    const body = await res.json();
    body.result.value.accounts.pop();
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(signSolanaSwap(SWAP), /simulateTransaction: the answer does not match/);
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
