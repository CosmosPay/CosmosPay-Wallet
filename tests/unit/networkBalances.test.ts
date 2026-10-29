/**
 * Balances on the networks beyond Stellar: one client per source, each fed the body its real
 * API answered when probed on 2026-10-28 (trimmed, the amounts verbatim; the error bodies not
 * provoked live follow each API's own form). What is pinned:
 * the exact bigint read — amounts past 2^53 included, so the bodies are raw JSON text, never a
 * `JSON.stringify` of a number that would already be rounded — the zeros a source states, and
 * that everything else (a rate limit, a 404, a body of the wrong shape, a timeout) throws
 * instead of reading as zero.
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, NETWORK_BALANCE_TIMEOUT_MS, type NetworkId } from '@/constants/networks';
import { NetworkBalanceError, readNetworkBalances, type NetworkBalanceFailure } from '@/lib/networkBalances';

// Public, well-known addresses (exchange hot wallets and the like), as probed.
const EVM = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
const SOL = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const BTC = '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo';
const DOGE = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
const BCH = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
const XRP = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const TRON = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb';
const NEAR = '0f3e8b1c2d4a5b6c7d8e9f00112233445566778899aabbccddeeff0011223344';
const SUI = '0x935029ca5219502a47ac9b69f556ccf6e2198b5e7815cf50f68846f723739cbd';
const MOVE = '0x62cc5a8faf586723d9cf9b45990c91b3cc3f7c0ee690a38e21e92a97f5fba4d3';
const TON = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';

type Call = { url: string; init: RequestInit; body: unknown };
type Answer = { status?: number; body: unknown };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

/** Answer every request with `answer(call)` — a string body goes out verbatim — and record it. */
function stub(answer: (call: Call) => Answer): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const { status = 200, body } = answer(call);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const fails = (p: Promise<unknown>, reason: NetworkBalanceFailure, address?: string) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NetworkBalanceError, String(e));
    assert.equal(e.reason, reason, e.message);
    if (address) assert.ok(!e.message.includes(address), 'the address stays out of the message');
    return true;
  });

const token = (network: NetworkId, symbol: string) => {
  const t = NETWORKS[network].tokens.find((x) => x.symbol === symbol);
  assert.ok(t, `${network} ${symbol}`);
  return t.asset;
};

/* ------------------------------------------------------------------ registry */

test('a network with no source throws "unsupported" and asks nobody', async () => {
  const calls = stub(() => ({ body: {} }));
  for (const id of ['stellar', 'aleo'] as const) {
    assert.equal(NETWORKS[id].balance, null, id);
    await fails(readNetworkBalances(id, EVM), 'unsupported');
  }
  assert.equal(calls.length, 0);
});

test('every request is anonymous: no credentials or cookies, no referrer, nothing cached', async () => {
  const calls = stub(() => ({ body: '{"address":"x","chain_stats":{"funded_txo_sum":1,"spent_txo_sum":0},"mempool_stats":{"funded_txo_sum":0,"spent_txo_sum":0}}' }));
  await readNetworkBalances('btc', BTC);
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers, undefined, 'a GET sends no header at all');
  assert.ok(init.signal instanceof AbortSignal);
});

/* ----------------------------------------------------------------------- EVM */

test('EVM: the coin and every token in one batch, matched by id', async () => {
  const usdc = token('eth', 'USDC');
  const usdt = token('eth', 'USDT');
  const results: Record<string, string> = {
    eth_getBalance: '0x58cf98b6ed4b53d46aa6',
    [usdc]: '0x00000000000000000000000000000000000000000000000000000000087a7a94',
    [usdt]: '0x0000000000000000000000000000000000000000000000000038d7ea4c795650',
  };
  const calls = stub(({ body }) => ({
    // Answered in reverse: the client must go by id, not position.
    body: (body as { id: number; method: string; params: [{ to: string }] }[])
      .map(({ id, method, params }) => ({ jsonrpc: '2.0', id, result: results[method === 'eth_call' ? params[0].to : method] }))
      .reverse(),
  }));
  const out = await readNetworkBalances('eth', EVM);
  assert.deepEqual(out, { native: 0x58cf98b6ed4b53d46aa6n, [usdc]: 0x087a7a94n, [usdt]: 0x38d7ea4c795650n });
  assert.equal(calls.length, 1, 'one POST per network');
  assert.equal(calls[0].url, 'https://ethereum-rpc.publicnode.com');
  const batch = calls[0].body as { method: string; params: unknown[] }[];
  assert.deepEqual(batch.map((c) => c.method), ['eth_getBalance', 'eth_call', 'eth_call']);
  const call = batch[1].params[0] as { to: string; data: string };
  assert.equal(call.to, usdc);
  assert.equal(call.data, `0x70a08231${EVM.slice(2).toLowerCase().padStart(64, '0')}`);
});

test('EVM: a network without tokens asks for the coin alone', async () => {
  const calls = stub(() => ({ body: '[{"jsonrpc":"2.0","result":"0x0","id":0}]' }));
  assert.deepEqual(await readNetworkBalances('abs', EVM), { native: 0n });
  assert.equal((calls[0].body as unknown[]).length, 1);
});

test('EVM: an empty call result, an error item or a refused batch throws', async () => {
  const answer = (item: object) => () => ({
    body: [
      { jsonrpc: '2.0', id: 0, result: '0x1' },
      { jsonrpc: '2.0', id: 1, ...item },
    ],
  });
  stub(answer({ result: '0x' }));
  await fails(readNetworkBalances('base', EVM), 'shape', EVM);
  stub(answer({ error: { code: -32000, message: `execution reverted for ${EVM}` } }));
  await fails(readNetworkBalances('base', EVM), 'refused', EVM);
  stub(() => ({ body: '{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"batch requests are not supported"}}' }));
  await fails(readNetworkBalances('base', EVM), 'refused');
  // An answer missing for one id is not a zero for it.
  stub(() => ({ body: [{ jsonrpc: '2.0', id: 0, result: '0x1' }] }));
  await fails(readNetworkBalances('base', EVM), 'shape');
});

/* ----------------------------------------------------------------------- SVM */

// Two of that wallet's USDC accounts, verbatim from `getTokenAccountsByOwner` (207.3133 + 2,839.940216 USDC).
const USDC_ACCOUNTS = [
  'xvp6877brTo9ZfNqq8l0MbG75MLS9uDkfKYCA0UvXWFIwBtQWQBUVdncsMa87Ny0+1suq8GpqCtXOSuqpA8E5pRZWwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAMGv0gVz6blwBk7j2axSOdwQw2l7gjqu1RAL9cGGRMEB',
  'xvp6877brTo9ZfNqq8l0MbG75MLS9uDkfKYCA0UvXWFIwBtQWQBUVdncsMa87Ny0+1suq8GpqCtXOSuqpA8E5ngMRqkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAFWxhbTTbZHVudY26Z7ugqb2RYw1c7hweFM7NiqTMY7m',
];
const tokenAccount = (data: string, owner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') => ({
  pubkey: '2ocS3orPq3jyszjsJ4NozKWyhdotr3csDjAizmkj65aH',
  account: { lamports: 2039280, data: [data, 'base64'], owner, executable: false, rentEpoch: 0, space: 165 },
});
const rpcOk = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });

test('Solana: lamports, and each token summed over its accounts; a mint with none is zero', async () => {
  const usdc = token('solana', 'USDC');
  const usdt = token('solana', 'USDT');
  const calls = stub(({ body }) => {
    const { id, method, params } = body as { id: number; method: string; params: [string, { mint?: string }] };
    if (method === 'getBalance') {
      return { body: `{"jsonrpc":"2.0","result":{"context":{"apiVersion":"4.3.2","slot":462705291},"value":1555570563258297},"id":${id}}` };
    }
    const value = params[1].mint === usdc ? USDC_ACCOUNTS.map((d) => tokenAccount(d)) : [];
    return { body: rpcOk(id, { context: { slot: 462705295 }, value }) };
  });
  assert.deepEqual(await readNetworkBalances('solana', SOL), {
    native: 1555570563258297n,
    [usdc]: 207313300n + 2839940216n,
    [usdt]: 0n,
  });
  assert.ok(calls.every((c) => c.url === 'https://api.mainnet-beta.solana.com'));
  const filters = calls.filter((c) => (c.body as { method: string }).method === 'getTokenAccountsByOwner');
  assert.deepEqual(filters.map((c) => (c.body as { params: [string, { mint: string }] }).params[1].mint).sort(), [usdc, usdt].sort());
});

test('Fogo: lamports past 2^53 are read to the last digit', async () => {
  // Fogo's largest account (`getLargestAccounts`, …298240) plus one: a double this size holds only
  // multiples of 256, so a value that went through a plain `JSON.parse` would come back off by one.
  stub(() => ({ body: '{"jsonrpc":"2.0","result":{"context":{"apiVersion":"20.0.0","slot":841920194},"value":1431986162493298241},"id":1}' }));
  assert.deepEqual(await readNetworkBalances('fogo', SOL), { native: 1431986162493298241n });
});

test('Solana: an account of another mint or owner, or outside the token programs, or an RPC error throws', async () => {
  const usdc = token('solana', 'USDC');
  const answer = (accounts: unknown[], error?: unknown) => ({ body }: Call) => {
    const { id, method } = body as { id: number; method: string };
    if (method === 'getBalance') return { body: rpcOk(id, { value: 1 }) };
    if (error) return { body: { jsonrpc: '2.0', id, error } };
    return { body: rpcOk(id, { value: (body as { params: [string, { mint: string }] }).params[1].mint === usdc ? accounts : [] }) };
  };
  stub(answer([tokenAccount(USDC_ACCOUNTS[0])]));
  // The same account, asked for as somebody else's: not this owner's money.
  await fails(readNetworkBalances('solana', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'), 'shape');
  stub(answer([tokenAccount(USDC_ACCOUNTS[0], '11111111111111111111111111111111')]));
  await fails(readNetworkBalances('solana', SOL), 'shape');
  stub(answer([tokenAccount('not base64!')]));
  await fails(readNetworkBalances('solana', SOL), 'shape');
  stub(answer([], { code: -32602, message: `Invalid param: could not find account ${SOL}` }));
  await fails(readNetworkBalances('solana', SOL), 'refused', SOL);
});

/* ----------------------------------------------------------- UTXO explorers */

const esplora = (chain: string, mempool: string) =>
  `{"address":"${BTC}","chain_stats":${chain},"mempool_stats":${mempool}}`;

test('Esplora: confirmed plus mempool, funded less spent', async () => {
  const calls = stub(() => ({
    body: esplora(
      '{"funded_txo_count":5566,"funded_txo_sum":119037530222871,"spent_txo_count":451,"spent_txo_sum":94177770926608,"tx_count":5597}',
      '{"funded_txo_count":0,"funded_txo_sum":0,"spent_txo_count":0,"spent_txo_sum":0,"tx_count":0}',
    ),
  }));
  assert.deepEqual(await readNetworkBalances('btc', BTC), { native: 119037530222871n - 94177770926608n });
  assert.equal(calls[0].url, `https://mempool.space/api/address/${BTC}`);
  assert.equal(calls[0].init.method, 'GET');

  // A payment in the mempool counts; so does a spend in flight.
  stub(() => ({
    body: esplora('{"funded_txo_sum":100000,"spent_txo_sum":0}', '{"funded_txo_sum":25000,"spent_txo_sum":100000}'),
  }));
  assert.deepEqual(await readNetworkBalances('ltc', BTC), { native: 25000n });
});

test('Esplora: a negative sum, a missing field or a float throws', async () => {
  stub(() => ({ body: esplora('{"funded_txo_sum":1,"spent_txo_sum":0}', '{"funded_txo_sum":0,"spent_txo_sum":2}') }));
  await fails(readNetworkBalances('btc', BTC), 'shape');
  stub(() => ({ body: `{"address":"${BTC}","chain_stats":{"funded_txo_sum":1,"spent_txo_sum":0}}` }));
  await fails(readNetworkBalances('btc', BTC), 'shape', BTC);
  stub(() => ({ body: esplora('{"funded_txo_sum":1.5,"spent_txo_sum":0}', '{"funded_txo_sum":0,"spent_txo_sum":0}') }));
  await fails(readNetworkBalances('btc', BTC), 'shape');
  stub(() => ({ body: '<html><body>502 Bad Gateway</body></html>' }));
  await fails(readNetworkBalances('btc', BTC), 'shape');
});

test('BlockCypher: final_balance, exact past 2^53; an unknown wallet (404) throws', async () => {
  const calls = stub(() => ({
    body: `{
  "address": "${DOGE}",
  "total_received": 4385334472513834264,
  "total_sent": 4385328250307366598,
  "balance": 6222206467666,
  "unconfirmed_balance": 0,
  "final_balance": 6222206467666,
  "n_tx": 1485,
  "unconfirmed_n_tx": 0,
  "final_n_tx": 1485
}`,
  }));
  assert.deepEqual(await readNetworkBalances('doge', DOGE), { native: 6222206467666n });
  assert.equal(calls[0].url, `https://api.blockcypher.com/v1/doge/main/addrs/${DOGE}/balance`);

  stub(() => ({ body: '{"address":"x","balance":0,"unconfirmed_balance":0,"final_balance":9007199254740993}' }));
  assert.deepEqual(await readNetworkBalances('dash', DOGE), { native: 9007199254740993n });

  stub(() => ({ status: 404, body: `{"error": "Wallet ${DOGE} not found"}` }));
  await fails(readNetworkBalances('doge', DOGE), 'http', DOGE);
});

// Blockchair blocked this IP for the day (430) when probed, so the 200 body follows its documented
// dashboard shape; the 430 body is verbatim.
const blockchair = (key: string, balance: number) =>
  `{"data":{"${key}":{"address":{"type":"pubkeyhash","script_hex":"76a914","balance":${balance},"balance_usd":3.8,"received":${balance},"spent":0,"output_count":2,"unspent_output_count":2,"transaction_count":2},"transactions":["a1"],"utxo":[]}},"context":{"code":200,"source":"D","state":950000,"request_cost":1}}`;

test('Bitcore (Bitcoin Cash): balance, asked without the cashaddr prefix', async () => {
  const calls = stub(() => ({ body: '{"confirmed":1335588000,"unconfirmed":0,"balance":1335588000}' }));
  assert.deepEqual(await readNetworkBalances('bch', `bitcoincash:${BCH}`), { native: 1335588000n });
  assert.equal(calls[0].url, `https://api.bitcore.io/api/BCH/mainnet/address/${BCH}/balance`);
});

test('Blockchair: data[address].address.balance, under the address or its only key', async () => {
  const calls = stub(() => ({ body: blockchair('t1Lwh5NsBLGtcBNA5yLiRp6R4LYc5ZUnwgK', 0) }));
  assert.deepEqual(await readNetworkBalances('zec', 't1Lwh5NsBLGtcBNA5yLiRp6R4LYc5ZUnwgK'), { native: 0n });
  assert.equal(calls[0].url, 'https://api.blockchair.com/zcash/dashboards/address/t1Lwh5NsBLGtcBNA5yLiRp6R4LYc5ZUnwgK');
});

test('Blockchair: its 430 block is a rate limit, and an empty `data` is not a zero', async () => {
  stub(() => ({
    status: 430,
    body: '{"data":null,"context":{"code":430,"error":"Your IP address is temporary blacklisted due to exceeding usage of API resources. Please apply for an API key by contacting us at info@blockchair.com","market_price_usd":284.56,"servers":"API4","request_cost":1}}',
  }));
  await fails(readNetworkBalances('zec', 't1Lwh5NsBLGtcBNA5yLiRp6R4LYc5ZUnwgK'), 'rate-limited', 't1Lwh5NsBLGtcBNA5yLiRp6R4LYc5ZUnwgK');
  stub(() => ({ body: '{"data":null,"context":{"code":200}}' }));
  await fails(readNetworkBalances('zec', BCH), 'shape');
  stub(() => ({ body: '{"data":{},"context":{"code":200}}' }));
  await fails(readNetworkBalances('zec', BCH), 'shape', BCH);
});

/* ---------------------------------------------------------------------- XRPL */

test('XRPL: Balance in drops; an account nobody funded is a known zero', async () => {
  const calls = stub(() => ({
    body: `{"result":{"account_data":{"Account":"${XRP}","Balance":"99999000","Flags":131072,"LedgerEntryType":"AccountRoot","OwnerCount":0,"Sequence":568924},"ledger_index":107970410,"validated":true,"status":"success"}}`,
  }));
  assert.deepEqual(await readNetworkBalances('xrp', XRP), { native: 99999000n });
  assert.deepEqual(calls[0].body, { method: 'account_info', params: [{ account: XRP, ledger_index: 'validated' }] });

  stub(() => ({
    body: `{"result":{"account":"${XRP}","error":"actNotFound","error_code":19,"error_message":"Account not found.","ledger_index":107970430,"validated":true,"request":{"account":"${XRP}","command":"account_info","ledger_index":"validated"},"status":"error"}}`,
  }));
  assert.deepEqual(await readNetworkBalances('xrp', XRP), { native: 0n });
});

test('XRPL: any other error throws, slowDown as a rate limit', async () => {
  stub(() => ({
    body: `{"result":{"error":"actMalformed","error_code":35,"error_message":"Account malformed.","request":{"account":"${XRP}","command":"account_info"},"status":"error"}}`,
  }));
  await fails(readNetworkBalances('xrp', XRP), 'refused', XRP);
  stub(() => ({ body: '{"result":{"error":"slowDown","status":"error"}}' }));
  await fails(readNetworkBalances('xrp', XRP), 'rate-limited');
  // XRP where drops belong: a decimal is never read as base units.
  stub(() => ({ body: '{"result":{"account_data":{"Balance":"99.999"},"status":"success"}}' }));
  await fails(readNetworkBalances('xrp', XRP), 'shape');
});

/* ---------------------------------------------------------------------- Tron */

test('Tron: sun and the USDT entry of trc20; an unactivated account and omitted fields are zeros', async () => {
  const usdt = token('tron', 'USDT');
  const calls = stub(() => ({
    body: `{"data":[{"address":"41e28b3cfd4e0e909077821478e9fcb86b84be786e","create_time":1542274980000,"balance":2141158763544959,"trc20":[{"TSPigbpXYgt8JdgRmKew2SmJx41zymepb1":"100000000000"},{"${usdt}":"6744528896"},{"TYB4VnbKJpbTXbubag4F9LpbTLKyDCm4z1":"50000000000000000000000"}]}],"success":true,"meta":{"at":1793239164584,"page_size":1}}`,
  }));
  assert.deepEqual(await readNetworkBalances('tron', TRON), { native: 2141158763544959n, [usdt]: 6744528896n });
  assert.equal(calls[0].url, `https://api.trongrid.io/v1/accounts/${TRON}`);

  stub(() => ({ body: '{"data":[],"success":true,"meta":{"at":1793239193687,"page_size":1}}' }));
  assert.deepEqual(await readNetworkBalances('tron', TRON), { native: 0n, [usdt]: 0n });
  stub(() => ({ body: '{"data":[{"address":"41e28b","create_time":1542274980000}],"success":true}' }));
  assert.deepEqual(await readNetworkBalances('tron', TRON), { native: 0n, [usdt]: 0n });
});

test('Tron: a rate limit, a failed answer or an unreadable token amount throws', async () => {
  const usdt = token('tron', 'USDT');
  stub(() => ({ status: 429, body: '{"Error":"request rate exceeded the allowed_rps(15)"}' }));
  await fails(readNetworkBalances('tron', TRON), 'rate-limited', TRON);
  stub(() => ({ body: '{"data":[],"success":false}' }));
  await fails(readNetworkBalances('tron', TRON), 'refused');
  stub(() => ({ body: `{"data":[{"balance":1,"trc20":[{"${usdt}":"6744.528896"}]}],"success":true}` }));
  await fails(readNetworkBalances('tron', TRON), 'shape');
});

/* ---------------------------------------------------------------------- NEAR */

test('NEAR: amount in yocto; an account that does not exist is a known zero', async () => {
  const calls = stub(() => ({
    body: '{"jsonrpc":"2.0","result":{"amount":"69275176833803306026668221648","block_hash":"Gcu9G6A8JgyQ3VEbbduoLG1rsrNu6eJpmUMJbkn337qo","block_height":222059688,"locked":"0","storage_paid_at":0,"storage_usage":2263199},"id":1}',
  }));
  assert.deepEqual(await readNetworkBalances('near', NEAR), { native: 69275176833803306026668221648n });
  assert.deepEqual((calls[0].body as { params: unknown }).params, { request_type: 'view_account', finality: 'final', account_id: NEAR });

  stub(() => ({
    body: `{"jsonrpc":"2.0","error":{"name":"HANDLER_ERROR","cause":{"info":{"block_height":222059689,"requested_account_id":"${NEAR}"},"name":"UNKNOWN_ACCOUNT"},"code":-32000,"message":"Server error","data":"account ${NEAR} does not exist while viewing"},"id":1}`,
  }));
  assert.deepEqual(await readNetworkBalances('near', NEAR), { native: 0n });
});

test('NEAR: any other error throws, without the address it echoes', async () => {
  stub(() => ({
    body: `{"jsonrpc":"2.0","error":{"name":"HANDLER_ERROR","cause":{"name":"UNAVAILABLE_SHARD"},"code":-32000,"message":"Server error","data":"shard for ${NEAR} unavailable"},"id":1}`,
  }));
  await fails(readNetworkBalances('near', NEAR), 'refused', NEAR);
});

/* ----------------------------------------------------------------------- Sui */

test('Sui: one GraphQL query, the address and coin types as variables', async () => {
  const usdc = token('sui', 'USDC');
  const calls = stub(() => ({ body: '{"data":{"address":{"c0":{"totalBalance":"12741781530122091"},"c1":{"totalBalance":"0"}}}}' }));
  assert.deepEqual(await readNetworkBalances('sui', SUI), { native: 12741781530122091n, [usdc]: 0n });
  const { query, variables } = calls[0].body as { query: string; variables: Record<string, string> };
  assert.equal(calls[0].url, 'https://graphql.mainnet.sui.io/graphql');
  assert.ok(!query.includes(SUI), 'nothing is spliced into the query');
  assert.deepEqual(variables, { address: SUI, c0: '0x2::sui::SUI', c1: usdc });
});

test('Sui: GraphQL errors or a missing balance throw', async () => {
  stub(() => ({
    body: '{"data":null,"errors":[{"message":"Failed to parse \\"SuiAddress\\": Invalid hexadecimal character at offset 2","locations":[{"line":1,"column":19}],"path":["address"]}]}',
  }));
  await fails(readNetworkBalances('sui', SUI), 'refused');
  stub(() => ({ body: '{"data":{"address":{"c0":{"totalBalance":"1"},"c1":null}}}' }));
  await fails(readNetworkBalances('sui', SUI), 'shape');
});

/* ----------------------------------------------------------- Aptos, Movement */

test('Aptos and Movement: a bare integer per coin; an account that does not exist answers 0', async () => {
  const calls = stub(() => ({ body: '11120868786' }));
  assert.deepEqual(await readNetworkBalances('aptos', MOVE), { native: 11120868786n });
  assert.equal(calls[0].url, `https://fullnode.mainnet.aptoslabs.com/v1/accounts/${MOVE}/balance/0x1::aptos_coin::AptosCoin`);

  const moved = stub(() => ({ body: '0' }));
  assert.deepEqual(await readNetworkBalances('movement', MOVE), { native: 0n });
  assert.ok(moved[0].url.startsWith('https://mainnet.movementnetwork.xyz/v1/accounts/'));
});

test('Aptos: a 404 is unknown, not a zero; nor is a body that is not an integer', async () => {
  stub(() => ({ status: 404, body: '{"message":"Resource not found","error_code":"resource_not_found","vm_error_code":null}' }));
  await fails(readNetworkBalances('aptos', MOVE), 'http', MOVE);
  stub(() => ({ body: '"11120868786.5"' }));
  await fails(readNetworkBalances('aptos', MOVE), 'shape');
});

/* ----------------------------------------------------------------------- TON */

test('TON: nanotons from getAddressBalance; a 429 or ok:false throws', async () => {
  const calls = stub(() => ({ body: '{"ok":true,"result":"1592542221071731","@extra":"1793239208:13:11.498"}' }));
  assert.deepEqual(await readNetworkBalances('ton', TON), { native: 1592542221071731n });
  assert.equal(calls[0].url, `https://toncenter.com/api/v2/getAddressBalance?address=${TON}`);

  stub(() => ({ status: 429, body: '{"ok":false,"error":"Ratelimit exceed","code":429}' }));
  await fails(readNetworkBalances('ton', TON), 'rate-limited', TON);
  stub(() => ({ body: '{"ok":false,"error":"Incorrect address","code":416}' }));
  await fails(readNetworkBalances('ton', TON), 'refused');
});

/* ----------------------------------------------------------------- HyperCore */

test('HyperCore: HYPE and USDC from the spot totals, cut (never rounded up) to their places', async () => {
  const calls = stub(() => ({
    body: '{"balances":[{"coin":"USDC","token":0,"total":"10920.37549928","hold":"9999.218","entryNtl":"0.0"},{"coin":"PURR","token":1,"total":"0.62505","hold":"0.0","entryNtl":"0.05826966"},{"coin":"HYPE","token":150,"total":"48315609.2847392336","hold":"0.0","entryNtl":"1389798741.8764133453"}]}',
  }));
  assert.deepEqual(await readNetworkBalances('hypercore', EVM), { native: 4831560928473923n, USDC: 1092037549928n });
  assert.equal(calls[0].url, 'https://api.hyperliquid.xyz/info');
  assert.deepEqual(calls[0].body, { type: 'spotClearinghouseState', user: EVM });
});

test('HyperCore: a coin the account lacks is zero; a total it reads must be a decimal', async () => {
  stub(() => ({ body: '{"balances":[]}' }));
  assert.deepEqual(await readNetworkBalances('hypercore', EVM), { native: 0n, USDC: 0n });
  // Only the entries read are checked: an odd total on another coin is not this client's business.
  stub(() => ({ body: '{"balances":[{"coin":"PURR","total":1e-8},{"coin":"USDC","total":"5"}]}' }));
  assert.deepEqual(await readNetworkBalances('hypercore', EVM), { native: 0n, USDC: 500000000n });
  stub(() => ({ body: '{"balances":[{"coin":"USDC","total":10920.5}]}' }));
  await fails(readNetworkBalances('hypercore', EVM), 'shape');
  stub(() => ({ body: '{"balances":[{"coin":"HYPE","total":"-1.0"}]}' }));
  await fails(readNetworkBalances('hypercore', EVM), 'shape');
});

/* ----------------------------------------------------------------- transport */

test('a request that outlives the deadline throws "timeout"', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort);
    })) as typeof fetch;
  const read = readNetworkBalances('btc', BTC);
  mock.timers.tick(NETWORK_BALANCE_TIMEOUT_MS);
  await fails(read, 'timeout');
});

test('no answer at all throws "network"; any other status throws "http"', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  await fails(readNetworkBalances('ton', TON), 'network');
  stub(() => ({ status: 503, body: 'Service Unavailable' }));
  await fails(readNetworkBalances('near', NEAR), 'http');
});

test('NEAR: a token is its contract’s ft_balance_of, a JSON string of digits as bytes, read even for an account not opened yet', async () => {
  const bytes = (s: string) => Array.from(new TextEncoder().encode(JSON.stringify(s)));
  const calls = stub(({ body }) => {
    const p = (body as { params: { request_type: string; account_id: string; method_name?: string; args_base64?: string } }).params;
    if (p.request_type === 'view_account') return { body: { jsonrpc: '2.0', id: 1, error: { cause: { name: 'UNKNOWN_ACCOUNT' } } } };
    assert.equal(p.method_name, 'ft_balance_of');
    assert.equal(JSON.parse(Buffer.from(p.args_base64 ?? '', 'base64').toString()).account_id, NEAR);
    return { body: { jsonrpc: '2.0', id: 1, result: { result: bytes(p.account_id === 'wrap.near' ? '1500000000000000000000000' : '0') } } };
  });
  const tokens = [
    { symbol: 'wNEAR', asset: 'wrap.near', decimals: 24 },
    { symbol: 'mpDAO', asset: 'mpdao-token.near', decimals: 6 },
  ];
  assert.deepEqual(await readNetworkBalances('near', NEAR, tokens), { native: 0n, 'wrap.near': 1500000000000000000000000n, 'mpdao-token.near': 0n });
  assert.equal(calls.length, 3);
});

test('added tokens are read with the registry’s (EVM, one batch)', async () => {
  const added = { symbol: 'BRETT', asset: '0x532f27101965dd16442e59d40670faf5ebb142e4', decimals: 18 };
  stub(({ body }) => ({
    body: (body as { id: number; method: string }[]).map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_getBalance' ? '0x0' : '0x' + (c.id === NETWORKS.base.tokens.length + 1 ? '5' : '0').padStart(64, '0') })),
  }));
  const read = await readNetworkBalances('base', EVM, [...NETWORKS.base.tokens, added]);
  assert.equal(read[added.asset], 5n);
});
