/**
 * Token balances at the associated token accounts (`src/lib/solanaTokenBalances.ts`), with the
 * node replaced by a reader that answers from a table. What is pinned: which addresses are
 * read (both programs, each once, in calls of at most 100), that no account is a zero and a
 * System account with no data too, and that anything else that is not this owner's account of
 * that mint refuses the whole read instead of counting as zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { SOLANA_MULTIPLE_ACCOUNTS_MAX } from '@/constants/chains';
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
} from '@/lib/solanaTx';
import {
  AssociatedReadRefused,
  accountBatches,
  associatedTokenSlots,
  readAssociatedBalances,
  type AssociatedReadProblem,
  type SlotAccount,
} from '@/lib/solanaTokenBalances';

const OWNER = '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK';
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';

function tokenData(mint: string, owner: string, amount: bigint): Uint8Array {
  const d = new Uint8Array(165);
  d.set(base58.decode(mint), 0);
  d.set(base58.decode(owner), 32);
  new DataView(d.buffer).setBigUint64(64, amount, true);
  d[108] = 1; // initialized
  return d;
}
const token = (mint: string, amount: bigint, opts: { owner?: string; program?: string } = {}): SlotAccount => ({
  owner: opts.program ?? TOKEN_PROGRAM_ID,
  data: tokenData(mint, opts.owner ?? OWNER, amount),
});

/** A reader answering each address from `accounts` (none: null), recording every call. */
function node(accounts: Record<string, SlotAccount>) {
  const calls: string[][] = [];
  const read = async (addresses: string[]) => {
    calls.push(addresses);
    return addresses.map((a) => accounts[a] ?? null);
  };
  return { calls, read };
}

const refuses = (p: Promise<unknown>, problem: AssociatedReadProblem) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof AssociatedReadRefused, String(e));
    assert.equal(e.problem, problem);
    assert.ok(!e.message.includes(OWNER), 'no address in the message');
    return true;
  });

test('each mint is read at its associated account under SPL Token and under Token-2022, once', () => {
  const slots = associatedTokenSlots(OWNER, [USDC, USDT, USDC]);
  assert.deepEqual(slots, [
    { address: associatedTokenAddress(OWNER, USDC, TOKEN_PROGRAM_ID), mint: USDC },
    { address: associatedTokenAddress(OWNER, USDC, TOKEN_2022_PROGRAM_ID), mint: USDC },
    { address: associatedTokenAddress(OWNER, USDT, TOKEN_PROGRAM_ID), mint: USDT },
    { address: associatedTokenAddress(OWNER, USDT, TOKEN_2022_PROGRAM_ID), mint: USDT },
  ]);
  // The SPL reference derivation (also pinned in chainSwap.test.ts).
  assert.equal(slots[0].address, '6Ta6QEER1jvgZ2yYx5iJwXxtzYqMr6xv7gvxW5ZPX1iW');
  assert.notEqual(slots[0].address, slots[1].address);
});

test('a long list is cut in order into calls of at most 100', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const batches = accountBatches(items);
  assert.equal(SOLANA_MULTIPLE_ACCOUNTS_MAX, 100);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
  assert.deepEqual(batches.flat(), items);
  assert.deepEqual(accountBatches([]), []);
  assert.throws(() => accountBatches(items, 0), RangeError);
});

test('no account is zero; an account under either program is counted, and both add up', async () => {
  const { calls, read } = node({
    [associatedTokenAddress(OWNER, USDC, TOKEN_PROGRAM_ID)]: token(USDC, 7_000_000n),
    [associatedTokenAddress(OWNER, USDC, TOKEN_2022_PROGRAM_ID)]: token(USDC, 5n, { program: TOKEN_2022_PROGRAM_ID }),
    [associatedTokenAddress(OWNER, PYUSD, TOKEN_2022_PROGRAM_ID)]: token(PYUSD, 12_340_000n, { program: TOKEN_2022_PROGRAM_ID }),
  });
  assert.deepEqual(await readAssociatedBalances(OWNER, [USDC, USDT, PYUSD], read), { [USDC]: 7_000_005n, [USDT]: 0n, [PYUSD]: 12_340_000n });
  assert.equal(calls.length, 1, 'six addresses, one call');
  assert.equal(calls[0].length, 6);
});

test('lamports alone at an associated address (a System account with no data) are no tokens', async () => {
  const { read } = node({ [associatedTokenAddress(OWNER, USDC, TOKEN_2022_PROGRAM_ID)]: { owner: SYSTEM_PROGRAM_ID, data: new Uint8Array() } });
  assert.deepEqual(await readAssociatedBalances(OWNER, [USDC], read), { [USDC]: 0n });
});

test('an account that is not this owner’s account of that mint refuses the whole read', async () => {
  const ata = associatedTokenAddress(OWNER, USDC, TOKEN_PROGRAM_ID);
  await refuses(readAssociatedBalances(OWNER, [USDC], node({ [ata]: token(USDC, 1n, { owner: OTHER }) }).read), 'account');
  await refuses(readAssociatedBalances(OWNER, [USDC], node({ [ata]: token(USDT, 1n) }).read), 'account');
  await refuses(readAssociatedBalances(OWNER, [USDC], node({ [ata]: { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) } }).read), 'account');
  await refuses(readAssociatedBalances(OWNER, [USDC], node({ [ata]: { ...token(USDC, 1n)!, owner: OTHER } }).read), 'program');
  await refuses(readAssociatedBalances(OWNER, [USDC], node({ [ata]: { owner: SYSTEM_PROGRAM_ID, data: new Uint8Array(1) } }).read), 'program');
});

test('an answer with an entry missing or extra is refused, not read as no account', async () => {
  await refuses(readAssociatedBalances(OWNER, [USDC], async (a) => a.slice(1).map(() => null)), 'answer');
  await refuses(readAssociatedBalances(OWNER, [USDC], async (a) => [...a.map(() => null), null]), 'answer');
});

test('the reader’s own failure comes back unchanged, and nothing to read asks nobody', async () => {
  const boom = new Error('HTTP 429');
  await assert.rejects(readAssociatedBalances(OWNER, [USDC], async () => Promise.reject(boom)), (e) => e === boom);
  const { calls, read } = node({});
  assert.deepEqual(await readAssociatedBalances(OWNER, [], read), {});
  assert.equal(calls.length, 0);
});

test('more slots than one call takes: calls of 100, every address once, balances still per mint', async () => {
  const mints = Array.from({ length: 120 }, (_, i) => base58.encode(new Uint8Array(32).fill(i + 1)));
  const last = mints[mints.length - 1];
  const { calls, read } = node({ [associatedTokenAddress(OWNER, last, TOKEN_2022_PROGRAM_ID)]: token(last, 9n, { program: TOKEN_2022_PROGRAM_ID }) });
  const out = await readAssociatedBalances(OWNER, mints, read);
  assert.deepEqual(calls.map((c) => c.length), [100, 100, 40]);
  assert.equal(new Set(calls.flat()).size, 240);
  assert.equal(out[last], 9n);
  assert.equal(Object.values(out).reduce((s, v) => s + v, 0n), 9n);
});
