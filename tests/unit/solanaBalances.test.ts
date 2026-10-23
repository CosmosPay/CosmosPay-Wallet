/**
 * Solana mainnet balances. The public node that answers a browser refuses
 * `getTokenAccountsByOwner` (`DEFAULT_SOLANA_RPC_URL`), so the wallet reads each listed
 * token's associated accounts with `getMultipleAccounts` — and must not believe an account
 * that is not a token account of OURS for THAT mint, whatever address it sits at.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { base58, base64 } from '@scure/base';
import { chainBalances } from '@/lib/chainSwap';
import { associatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solanaTx';
import { CHAIN_TOKENS } from '@/constants/chains';
import { DEFAULT_SOLANA_RPC_URL } from '@/constants/backends';

const OWNER = 'EfMyugvKBr7JPsxFTUE7Z67sBNJj9NWCRbyt9p7fojBN';
const STRANGER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const SYSTEM = '11111111111111111111111111111111';
const usdc = CHAIN_TOKENS.solana.find((t) => t.symbol === 'USDC')!.asset;
const usdt = CHAIN_TOKENS.solana.find((t) => t.symbol === 'USDT')!.asset;

/** A 165-byte SPL token account: mint, token owner, amount. */
function tokenAccount(mint: string, owner: string, amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(base58.decode(mint), 0);
  data.set(base58.decode(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return base64.encode(data);
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('balances come from the associated accounts, and only a token account of ours for that mint counts', async () => {
  const accounts = new Map<string, { owner: string; data: string }>([
    // ours, real: counted
    [associatedTokenAddress(OWNER, usdc, TOKEN_PROGRAM_ID), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(usdc, OWNER, 7_000_000n) }],
    // at our USDT address but holding someone else's tokens: ignored
    [associatedTokenAddress(OWNER, usdt, TOKEN_PROGRAM_ID), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(usdt, STRANGER, 9_000_000n) }],
    // at our Token-2022 USDC address but not owned by a token program: ignored
    [associatedTokenAddress(OWNER, usdc, TOKEN_2022_PROGRAM_ID), { owner: SYSTEM, data: tokenAccount(usdc, OWNER, 5_000_000n) }],
  ]);
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const { method, params, id } = JSON.parse(init.body);
    calls.push({ url, method });
    const result =
      method === 'getBalance'
        ? { value: 2_000_000 }
        : method === 'getMultipleAccounts'
          ? {
              value: (params[0] as string[]).map((a) => {
                const acc = accounts.get(a);
                return acc ? { lamports: 2_039_280, owner: acc.owner, data: [acc.data, 'base64'], executable: false } : null;
              }),
            }
          : (() => {
              throw new Error(`unexpected ${method}`);
            })();
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  }) as typeof fetch;

  const out = await chainBalances('solana', OWNER, 'mainnet');
  assert.equal(out.native, 2_000_000n);
  assert.equal(out[usdc], 7_000_000n);
  assert.equal(out[usdt], 0n);
  assert.ok(calls.every((c) => c.url === DEFAULT_SOLANA_RPC_URL));
  assert.deepEqual([...new Set(calls.map((c) => c.method))].sort(), ['getBalance', 'getMultipleAccounts']);
});

test('the mainnet default is a node a browser can reach', () => {
  // api.mainnet-beta.solana.com answers 403 to any request with an Origin header.
  assert.ok(!DEFAULT_SOLANA_RPC_URL.includes('api.mainnet-beta.solana.com'));
});
