/**
 * What each network the wallet holds an address on says it holds there: one small client per
 * `BalanceSource.kind` (`constants/networks.ts`), all against public, keyless, CORS-enabled APIs.
 *
 * The rule the callers build on: **a balance this module cannot read is an error, never a
 * zero.** A rate limit, a timeout, an answer of the wrong shape all throw `NetworkBalanceError`,
 * and the screen says "unknown" — a zero there would tell the person their money is gone. The
 * zeros it does return are the ones a source states, each named at its client: an XRPL account
 * the ledger never funded, a Tron account never activated, a NEAR account that does not exist,
 * a coin missing from a HyperCore account's spot balances, a mint the owner has no account of.
 *
 * Three more:
 *  - Amounts are exact. Every JSON integer is read as its digits (`parseJsonExact`): Fogo's
 *    largest accounts hold ~1.4e18 lamports, far past the 2^53 a JSON number keeps (BlockCypher's
 *    Dogecoin totals pass it too), so `JSON.parse` alone would round them before any check saw
 *    them. Decimal strings (HyperCore) go through string maths. No float ever holds an amount.
 *  - A request carries the address and nothing else about the person: no credentials, no
 *    cookies (Movement's node sets one), no referrer. Errors never repeat the address — several
 *    of these APIs echo it in theirs, so their messages are not passed on, only their codes.
 *  - A read is bounded by `NETWORK_BALANCE_TIMEOUT_MS` end to end, however many requests the
 *    network takes, and a failed one cancels its siblings.
 */
import { base64 } from '@scure/base';
import {
  NETWORKS,
  NETWORK_BALANCE_TIMEOUT_MS,
  type BalanceSource,
  type NetworkDef,
  type NetworkId,
} from '@/constants/networks';
import { toMinorUnitsBig } from '@/lib/amount';
import { ApiShapeError, arrayOf, bool, object, parseShape, str, type Check } from '@/lib/apiShape';
import { balanceOfCalldata } from '@/lib/evmTx';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, decodeTokenAccount } from '@/lib/solanaTx';

/** Why a balance could not be read. Each one means "unknown" to the caller — none is a zero. */
export type NetworkBalanceFailure =
  /** The registry names no source for the network (`balance: null`). */
  | 'unsupported'
  /** HTTP 429, or Blockchair's 430 (its per-IP block), or XRPL's `slowDown`. */
  | 'rate-limited'
  /** Any other status outside 2xx. */
  | 'http'
  /** `NETWORK_BALANCE_TIMEOUT_MS` passed. */
  | 'timeout'
  /** No answer at all: offline, DNS, CORS. */
  | 'network'
  /** The source answered with an error of its own (JSON-RPC, GraphQL, `ok: false`). */
  | 'refused'
  /** The answer is not what this client reads. */
  | 'shape';

export class NetworkBalanceError extends Error {
  // Plain fields, not parameter properties: node:test runs this file with type stripping.
  readonly network: NetworkId;
  readonly reason: NetworkBalanceFailure;
  constructor(network: NetworkId, reason: NetworkBalanceFailure, detail?: string, options?: { cause?: unknown }) {
    super(`${network} balance: ${reason}${detail ? ` (${detail})` : ''}`, options);
    this.name = 'NetworkBalanceError';
    this.network = network;
    this.reason = reason;
  }
}

/* ------------------------------- transport ------------------------------- */

const STRING_TOKEN = /"(?:[^"\\]|\\.)*"/y;
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/**
 * `JSON.parse`, except that every integer literal arrives as its digit string, so an amount past
 * 2^53 is the amount the source wrote. Fractions and exponents stay numbers: no client reads one.
 * Text that is not JSON is left for `JSON.parse` to refuse.
 */
function parseJsonExact(text: string): unknown {
  let out = '';
  let copied = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      STRING_TOKEN.lastIndex = i;
      if (!STRING_TOKEN.test(text)) break;
      i = STRING_TOKEN.lastIndex;
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER_TOKEN.lastIndex = i;
      const m = NUMBER_TOKEN.exec(text);
      if (!m) break;
      if (m[1] === undefined && m[2] === undefined) {
        out += `${text.slice(copied, i)}"${m[0]}"`;
        copied = i + m[0].length;
      }
      i += m[0].length;
    } else {
      i++;
    }
  }
  return JSON.parse(out + text.slice(copied));
}

/** One network's read: its requests share one deadline and are cancelled together. */
interface Io {
  network: NetworkId;
  /** Names the source in a shape error — never the URL, which may hold the address. */
  label: string;
  get(url: string): Promise<unknown>;
  post(url: string, body: unknown): Promise<unknown>;
  fail(reason: NetworkBalanceFailure, detail?: string, cause?: unknown): never;
}

function openIo(network: NetworkId, label: string): Io & { close(): void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, NETWORK_BALANCE_TIMEOUT_MS);

  const fail = (reason: NetworkBalanceFailure, detail?: string, cause?: unknown): never => {
    throw new NetworkBalanceError(network, reason, detail, cause === undefined ? undefined : { cause });
  };

  async function request(url: string, body?: unknown): Promise<unknown> {
    let text: string;
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 430) fail('rate-limited', `HTTP ${res.status}`);
      if (!res.ok) fail('http', `HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      if (e instanceof NetworkBalanceError) throw e;
      return fail(timedOut ? 'timeout' : 'network', undefined, e);
    }
    try {
      return parseJsonExact(text);
    } catch (e) {
      return fail('shape', 'not JSON', e);
    }
  }

  return {
    network,
    label,
    get: (url) => request(url),
    post: (url, body) => request(url, body),
    fail,
    close() {
      clearTimeout(timer);
      ctrl.abort();
    },
  };
}

/** A JSON-RPC 2.0 call's envelope; the caller reads `result` or decides what `error` means. */
async function jsonRpc(io: Io, url: string, method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }> {
  const body = await io.post(url, { jsonrpc: '2.0', id: 1, method, params });
  return parseShape(io.label, object({}), body);
}

/** A source's own error. Only its numeric code goes into the message: the text may echo the address. */
function refused(io: Io, what: string, error: unknown): never {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return io.fail('refused', typeof code === 'string' && /^-?\d+$/.test(code) ? `${what}, code ${code}` : what);
}

const enc = encodeURIComponent;

/* --------------------------------- shapes -------------------------------- */

/** A non-negative integer: the digits `parseJsonExact` makes of a JSON integer, or a source's own string. */
const uint: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new ApiShapeError(label, path, 'an unsigned integer', v);
  return v;
};

/** An Ethereum JSON-RPC quantity (`eth_getBalance`). */
const hexQuantity: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new ApiShapeError(label, path, 'a hex quantity', v);
  return v;
};

/** One 32-byte ABI word: what `balanceOf` returns, and nothing else is. */
const hexWord: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new ApiShapeError(label, path, 'one 32-byte word', v);
  return v;
};

/** A plain decimal string, as HyperCore writes amounts ("10920.37549928"). */
const decimal: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v)) throw new ApiShapeError(label, path, 'a decimal amount', v);
  return v;
};

/**
 * A decimal in base units, rounded DOWN: HyperCore writes more places than a token has (HYPE
 * answered ten for its eight), and a balance is never shown above what is held — which is why
 * the extra places are cut before `toMinorUnitsBig`, whose rounding is half-up.
 */
function decimalToBase(value: string, decimals: number): bigint {
  const [whole, frac = ''] = value.split('.');
  const n = toMinorUnitsBig(`${whole}.${frac.slice(0, decimals)}`, decimals);
  if (n === null) throw new Error('unreadable decimal');
  return n;
}

/** `native` first, then every registry token in order. */
const balances = (native: bigint, def: NetworkDef, token: (asset: string, decimals: number, i: number) => bigint) => {
  const out: Record<string, bigint> = { native };
  def.tokens.forEach((t, i) => {
    out[t.asset] = token(t.asset, t.decimals, i);
  });
  return out;
};

/* -------------------------------- clients -------------------------------- */

/**
 * EVM: `eth_getBalance`, and an ERC-20 `balanceOf` per token, in ONE JSON-RPC batch — every node
 * in the registry took one on 2026-10-28, and one POST per network is what keeps sixteen of them
 * inside a public node's limits. Answers are matched by id, not position. A token call must
 * return one 32-byte word: an empty `0x` means no contract at that address on this chain, a
 * broken registry entry rather than a zero.
 */
async function readEvm(io: Io, rpc: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const calls = [
    { method: 'eth_getBalance', params: [address, 'latest'] },
    ...def.tokens.map((t) => ({ method: 'eth_call', params: [{ to: t.asset, data: balanceOfCalldata(address) }, 'latest'] })),
  ];
  const body = await io.post(rpc, calls.map((c, id) => ({ jsonrpc: '2.0', id, ...c })));
  // A node that refuses the batch itself answers a single error object instead of the array.
  if (!Array.isArray(body)) refused(io, 'batch', body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined);
  const answers = parseShape(io.label, arrayOf(object({})), body) as { id?: unknown; result?: unknown; error?: unknown }[];
  const byId = new Map(answers.map((a) => [String(a.id), a]));
  const read = (id: number, check: Check<string>): bigint => {
    const a = byId.get(String(id));
    if (!a) throw new ApiShapeError(io.label, `[id ${id}]`, 'an answer', undefined);
    if (a.error !== undefined && a.error !== null) refused(io, calls[id].method, a.error);
    return BigInt(check(a.result, `[id ${id}].result`, io.label));
  };
  return balances(read(0, hexQuantity), def, (_asset, _decimals, i) => read(i + 1, hexWord));
}

/**
 * Solana and Fogo: `getBalance` in lamports, and each token by `getTokenAccountsByOwner`
 * filtered on its mint — a mint filter matches under both token programs, and asks for that one
 * mint instead of every account a busy wallet holds. No account is a known zero; several add
 * up. Each is decoded here (base64, not the node's `jsonParsed` rendering) and must be under a
 * token program, of that mint and of this owner.
 */
async function readSvm(io: Io, rpc: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const lamports = async () => {
    const env = await jsonRpc(io, rpc, 'getBalance', [address, { commitment: 'confirmed' }]);
    if (env.error !== undefined) refused(io, 'getBalance', env.error);
    return BigInt(parseShape(io.label, object({ value: uint }), env.result).value);
  };
  const tokenAmount = async (mint: string) => {
    const env = await jsonRpc(io, rpc, 'getTokenAccountsByOwner', [address, { mint }, { encoding: 'base64', commitment: 'confirmed' }]);
    if (env.error !== undefined) refused(io, 'getTokenAccountsByOwner', env.error);
    const accounts = parseShape(
      io.label,
      object({ value: arrayOf(object({ account: object({ owner: str, data: arrayOf(str) }) })) }),
      env.result,
    );
    let sum = 0n;
    for (const { account } of accounts.value) {
      if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID) io.fail('shape', 'an account outside the token programs');
      let token: ReturnType<typeof decodeTokenAccount> = null;
      try {
        token = decodeTokenAccount(base64.decode(account.data[0]));
      } catch {
        // Not base64: refused just below, like any other account that does not decode.
      }
      if (!token || token.mint !== mint || token.owner !== address) io.fail('shape', 'a token account of another mint or owner');
      sum += token.amount;
    }
    return sum;
  };
  const [native, ...tokens] = await Promise.all([lamports(), ...def.tokens.map((t) => tokenAmount(t.asset))]);
  return balances(native, def, (_asset, _decimals, i) => tokens[i]);
}

/**
 * Bitcoin and Litecoin (mempool.space, litecoinspace.org): what the address was paid less what
 * it spent, confirmed PLUS mempool — the figure their explorers show. A payment counts from the
 * moment it is broadcast, as its sender sees it, and a spend in flight is already gone. A sum
 * below zero would be the API contradicting itself, and is refused.
 */
async function readEsplora(io: Io, api: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const stats = object({ funded_txo_sum: uint, spent_txo_sum: uint });
  const body = parseShape(io.label, object({ chain_stats: stats, mempool_stats: stats }), await io.get(`${api}/address/${enc(address)}`));
  const net = (s: { funded_txo_sum: string; spent_txo_sum: string }) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  const sats = net(body.chain_stats) + net(body.mempool_stats);
  if (sats < 0n) io.fail('shape', 'spent more than funded');
  return balances(sats, def, () => 0n);
}

/** Dogecoin and Dash (BlockCypher): `final_balance`, confirmed plus unconfirmed — the Esplora choice. */
async function readBlockcypher(io: Io, coin: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const url = `https://api.blockcypher.com/v1/${coin}/main/addrs/${enc(address)}/balance`;
  const body = parseShape(io.label, object({ final_balance: uint }), await io.get(url));
  return balances(BigInt(body.final_balance), def, () => 0n);
}

/**
 * Bitcoin Cash and Zcash (Blockchair): `data[address].address.balance`, which counts the mempool
 * unless asked not to — the Esplora choice again. Blockchair keys `data` by the address as it
 * reads it, which need not be the spelling sent (a cashaddr with or without its prefix), so a
 * lone entry is taken when the key does not match. It blocks an IP that asks too often with a
 * 430 (2026-10-28): a rate limit, never an empty balance.
 */
async function readBlockchair(io: Io, coin: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const body = parseShape(io.label, object({ data: object({}) }), await io.get(`https://api.blockchair.com/${coin}/dashboards/address/${enc(address)}`));
  const data = body.data as Record<string, unknown>;
  const keys = Object.keys(data);
  const entry = address in data ? data[address] : keys.length === 1 ? data[keys[0]] : undefined;
  const dashboard = object({ address: object({ balance: uint }) })(entry, 'data.<address>', io.label);
  return balances(BigInt(dashboard.address.balance), def, () => 0n);
}

/**
 * XRP Ledger: `account_info` on the last validated ledger, `Balance` in drops (the reserve
 * included, as explorers show it). `actNotFound` is a known zero: an XRPL account exists only
 * once a payment has funded it, so an address nobody paid yet holds nothing.
 */
async function readXrpl(io: Io, rpc: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const body = await io.post(rpc, { method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] });
  const { result } = parseShape(io.label, object({ result: object({ status: str }) }), body);
  const error = (result as { error?: unknown }).error;
  if (error === 'actNotFound') return balances(0n, def, () => 0n);
  if (error === 'slowDown') io.fail('rate-limited', 'slowDown');
  if (result.status !== 'success') io.fail('refused', typeof error === 'string' && /^\w+$/.test(error) ? error : 'account_info');
  const info = parseShape(io.label, object({ account_data: object({ Balance: uint }) }), result);
  return balances(BigInt(info.account_data.Balance), def, () => 0n);
}

/**
 * Tron (TronGrid): `data[0].balance` in sun and the account's `trc20` list, one `{contract:
 * amount}` object per token. Known zeros: an empty `data` (an address never activated), and a
 * `balance` or token entry the account lacks — TronGrid omits zero fields rather than writing 0.
 */
async function readTrongrid(io: Io, api: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const body = parseShape(io.label, object({ success: bool, data: arrayOf(object({})) }), await io.get(`${api}/v1/accounts/${enc(address)}`));
  if (!body.success) io.fail('refused', 'accounts');
  const account = body.data[0] as Record<string, unknown> | undefined;
  if (!account) return balances(0n, def, () => 0n);
  const native = account.balance === undefined ? 0n : BigInt(uint(account.balance, 'data[0].balance', io.label));
  const trc20 = account.trc20 === undefined ? [] : arrayOf(object({}))(account.trc20, 'data[0].trc20', io.label);
  return balances(native, def, (asset) => {
    const entry = trc20.find((t) => Object.prototype.hasOwnProperty.call(t, asset)) as Record<string, unknown> | undefined;
    return entry ? BigInt(uint(entry[asset], `data[0].trc20.${asset}`, io.label)) : 0n;
  });
}

/**
 * NEAR: `view_account` at final finality, `amount` in yoctoNEAR (liquid; staked `locked` is not
 * spendable and not counted). `UNKNOWN_ACCOUNT` is a known zero: an implicit account exists only
 * once something has been sent to it.
 */
async function readNear(io: Io, rpc: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const env = await jsonRpc(io, rpc, 'query', { request_type: 'view_account', finality: 'final', account_id: address });
  if (env.error !== undefined) {
    const cause = env.error && typeof env.error === 'object' ? (env.error as { cause?: { name?: unknown } }).cause : undefined;
    if (cause?.name === 'UNKNOWN_ACCOUNT') return balances(0n, def, () => 0n);
    refused(io, 'view_account', env.error);
  }
  return balances(BigInt(parseShape(io.label, object({ amount: uint }), env.result).amount), def, () => 0n);
}

/** Sui's coin type. The registry keeps tokens; the native coin is the framework's. */
const SUI_COIN = '0x2::sui::SUI';

/**
 * Sui (GraphQL; the public JSON-RPC is deprecated): one query, the coin and every token aliased
 * `c0…cN`, address and coin types passed as variables rather than spliced into the query.
 * `totalBalance` sums every coin object of the type; an address holding none answers "0".
 */
async function readSui(io: Io, graphql: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const coins = [SUI_COIN, ...def.tokens.map((t) => t.asset)];
  const query = `query ($address: SuiAddress!, ${coins.map((_, i) => `$c${i}: String!`).join(', ')}) { address(address: $address) { ${coins
    .map((_, i) => `c${i}: balance(coinType: $c${i}) { totalBalance }`)
    .join(' ')} } }`;
  const variables: Record<string, string> = { address };
  coins.forEach((c, i) => {
    variables[`c${i}`] = c;
  });
  const body = parseShape(io.label, object({}), await io.post(graphql, { query, variables })) as { data?: unknown; errors?: unknown };
  if (Array.isArray(body.errors) && body.errors.length > 0) io.fail('refused', 'graphql');
  const shape: Record<string, Check<unknown>> = {};
  coins.forEach((_, i) => {
    shape[`c${i}`] = object({ totalBalance: uint });
  });
  const { data } = parseShape(io.label, object({ data: object({ address: object(shape) }) }), body);
  const held = data.address as Record<string, { totalBalance: string }>;
  return balances(BigInt(held.c0.totalBalance), def, (_asset, _decimals, i) => BigInt(held[`c${i + 1}`].totalBalance));
}

/** The Move framework's coin, on Aptos and on Movement alike (both answered for it, 2026-10-28). */
const MOVE_NATIVE_COIN = '0x1::aptos_coin::AptosCoin';

/**
 * Aptos and Movement: `/accounts/{address}/balance/{coin}`, a bare integer. An account that does
 * not exist answers 200 and `0` (probed 2026-10-28), so no status is read as a zero — a 404
 * would be a node without the endpoint, which is unknown.
 */
async function readAptos(io: Io, api: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const read = async (coin: string) => BigInt(parseShape(io.label, uint, await io.get(`${api}/accounts/${enc(address)}/balance/${coin}`)));
  const [native, ...tokens] = await Promise.all([read(MOVE_NATIVE_COIN), ...def.tokens.map((t) => read(t.asset))]);
  return balances(native, def, (_asset, _decimals, i) => tokens[i]);
}

/** TON (toncenter v2): `getAddressBalance`, nanotons. Keyless clients get ~1 request a second; a 429 throws. */
async function readToncenter(io: Io, api: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const body = parseShape(io.label, object({}), await io.get(`${api}/getAddressBalance?address=${enc(address)}`)) as { ok?: unknown };
  if (body.ok !== true) io.fail('refused', 'getAddressBalance');
  return balances(BigInt(parseShape(io.label, object({ result: uint }), body).result), def, () => 0n);
}

/**
 * Hyperliquid (HyperCore spot): `spotClearinghouseState`, one `{coin, total}` per coin held, the
 * total a decimal string. The coin is found by its ticker (`HYPE`), a token by its registry asset
 * (`USDC`); a coin the list lacks is a known zero. Only the entries read are checked.
 */
async function readHypercore(io: Io, api: string, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  const state = parseShape(
    io.label,
    object({ balances: arrayOf(object({ coin: str })) }),
    await io.post(api, { type: 'spotClearinghouseState', user: address }),
  );
  const held = (coin: string, decimals: number): bigint => {
    const i = state.balances.findIndex((b) => b.coin === coin);
    if (i < 0) return 0n;
    return decimalToBase(decimal((state.balances[i] as { total?: unknown }).total, `balances[${i}].total`, io.label), decimals);
  };
  return balances(held(def.coin, def.decimals), def, (asset, decimals) => held(asset, decimals));
}

function readSource(io: Io, source: BalanceSource, def: NetworkDef, address: string): Promise<Record<string, bigint>> {
  switch (source.kind) {
    case 'evm':
      return readEvm(io, source.rpc, def, address);
    case 'svm':
      return readSvm(io, source.rpc, def, address);
    case 'esplora':
      return readEsplora(io, source.api, def, address);
    case 'blockcypher':
      return readBlockcypher(io, source.coin, def, address);
    case 'blockchair':
      return readBlockchair(io, source.coin, def, address);
    case 'xrpl':
      return readXrpl(io, source.rpc, def, address);
    case 'trongrid':
      return readTrongrid(io, source.api, def, address);
    case 'near':
      return readNear(io, source.rpc, def, address);
    case 'sui':
      return readSui(io, source.graphql, def, address);
    case 'aptos':
      return readAptos(io, source.api, def, address);
    case 'toncenter':
      return readToncenter(io, source.api, def, address);
    case 'hypercore':
      return readHypercore(io, source.api, def, address);
  }
}

/**
 * Base-unit balances of `address` on `network`: `native` for the coin, and each of the network's
 * `tokens` by its `asset`. Throws (a typed error) when the source cannot be read — the caller
 * treats that as "unknown", never as zero.
 */
export async function readNetworkBalances(network: NetworkId, address: string): Promise<Record<string, bigint>> {
  const def = NETWORKS[network];
  const source = def.balance;
  if (!source) throw new NetworkBalanceError(network, 'unsupported');
  const io = openIo(network, source.kind);
  try {
    return await readSource(io, source, def, address);
  } catch (e) {
    if (e instanceof NetworkBalanceError) throw e;
    // A shape error names the field, never the value; anything else that escaped a client is
    // still an answer it could not read, and still typed for the caller.
    throw new NetworkBalanceError(network, 'shape', e instanceof ApiShapeError ? e.message : undefined, { cause: e });
  } finally {
    io.close();
  }
}
