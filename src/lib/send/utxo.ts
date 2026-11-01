/**
 * Paying the coin of a Bitcoin-family network — Bitcoin, Litecoin, Dogecoin, Dash, Bitcoin Cash —
 * from the wallet's one address there (`lib/chainAddresses.ts`): Bitcoin and Litecoin a native
 * P2WPKH, the others a P2PKH, each the key at its path in `DERIVATION_PATHS`. The wallet picks the
 * coins, writes the transaction (`lib/send/utxoTx.ts`), signs every input and hands the bytes to
 * a public API to relay. The API is asked for state — which coins the address holds, the fee rate —
 * and to relay; it builds nothing, and what it says is bounded:
 *
 *  - **The network.** A UTXO signature names no network, so the API proves which one it follows
 *    before anything is signed: Esplora's genesis block (Bitcoin, Litecoin and their test
 *    networks), BlockCypher's chain name (Dogecoin, Dash), and Bitcore's block at a height past
 *    every split of Bitcoin Cash. What really binds a send is the coins it spends — an outpoint
 *    exists on one chain — and, on Bitcoin Cash, SIGHASH_FORKID, which Bitcoin's rules refuse.
 *  - **The amounts.** The fee is what the inputs hold minus what the outputs pay, so a coin's
 *    value decides it. Bitcoin, Litecoin and Bitcoin Cash sign each input's value (BIP143 /
 *    FORKID): an API misstating one gets a signature the network rejects, never a fee nobody saw,
 *    so the listed values are used as they come. Dogecoin and Dash sign the legacy digest, which
 *    commits to no value: an API under-reporting a coin would have us sign away the difference
 *    to miners. There, every coin spent is read from its whole previous transaction, whose bytes
 *    must hash to its txid, and its value and script are taken from those bytes — any
 *    disagreement with the listing is a refusal, before anything is signed.
 *  - **The fee** is the API's rate (never below the network's relay floor) times the largest the
 *    transaction can be; above `maxFee` it is refused, not paid.
 *  - **The outputs** are the payment and, when worth more than its dust threshold, the change back
 *    to our own address. Change below dust is left to the fee rather than written as an output no
 *    node relays. A payment below the recipient output's dust threshold is refused ('minimum').
 *
 * Only confirmed coins are spent: an unconfirmed one can still be replaced under us. The balance
 * the wallet shows counts the mempool, so money received moments ago is not spendable yet.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { bech32, bech32m, createBase58check } from '@scure/base';
import type { ChainNet } from '@/constants/chains';
import type { NetworkDef, NetworkId } from '@/constants/networks';
import {
  BCH_BITCORE_API,
  BCH_CHECKPOINT,
  BCH_FEE_TARGET_BLOCKS,
  BCH_UTXO_LIMIT,
  BLOCKCYPHER_API,
  BLOCKCYPHER_CHAIN_NAME,
  BLOCKCYPHER_PACE_MS,
  BLOCKCYPHER_UTXO_LIMIT,
  DOGE_DUST_LIMIT,
  ESPLORA_GENESIS_HASH,
  SIGHASH_ALL,
  SIGHASH_FORKID,
  UTXO_ADDRESS_FORMATS,
  UTXO_DUST_RELAY_PER_KB,
  UTXO_DUST_SPEND_BYTES,
  UTXO_FEE_FLOOR_PER_KB,
  UTXO_MAX_STANDARD_VSIZE,
  UTXO_REQUEST_TIMEOUT_MS,
  UTXO_SEND_NETWORKS,
  UTXO_SEQUENCE,
  UTXO_TX_VERSION,
  type UtxoAddressFormat,
  type UtxoNetworkId,
} from '@/constants/utxoSend';
import { hash160 } from '@/lib/addresses/utxo';
import { ApiShapeError, arrayOf, bool, object, optional, parseShape, str, type Check } from '@/lib/apiShape';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';
import {
  bip143Sighash,
  dsha256,
  isWitnessScript,
  legacySighash,
  maxVsize,
  p2pkhScript,
  p2pkhScriptSig,
  p2sh32Script,
  p2shScript,
  rawTxOutputs,
  serializeTx,
  signDigest,
  txidOf,
  varint,
  witnessScript,
  type Tx,
  type TxOut,
} from '@/lib/send/utxoTx';

const isUtxoNetwork = (network: NetworkId): network is UtxoNetworkId => (UTXO_SEND_NETWORKS as readonly string[]).includes(network);

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/* -------------------------------- addresses ------------------------------- */

const base58check = createBase58check(sha256);

/** A base58check P2PKH or P2SH address under the mode's version bytes. */
function base58Script(text: string, format: UtxoAddressFormat): Uint8Array | null {
  let payload: Uint8Array;
  try {
    payload = base58check.decode(text);
  } catch {
    return null;
  }
  if (payload.length !== 21) return null;
  const hash = payload.subarray(1);
  if (payload[0] === format.p2pkh) return p2pkhScript(hash);
  if (payload[0] === format.p2sh) return p2shScript(hash);
  return null;
}

/**
 * A native segwit address under `hrp`: version 0 in bech32 (P2WPKH, P2WSH), version 1 in bech32m
 * with a 32-byte program (P2TR) — never the other checksum for either (BIP350). Witness versions
 * no soft fork has defined yet are refused: an output nobody can lock today is a loss, whatever
 * BIP350 anticipates.
 */
function segwitScript(text: string, hrp: string): Uint8Array | null {
  for (const [coder, modern] of [
    [bech32, false],
    [bech32m, true],
  ] as const) {
    const decoded = coder.decodeUnsafe(text);
    if (!decoded) continue;
    if (decoded.prefix !== hrp) return null;
    const [version, ...rest] = decoded.words;
    if (version === undefined || version > 16 || (version === 0) === modern) return null;
    const program = coder.fromWordsUnsafe(rest);
    if (!program) return null;
    if (version === 0 && (program.length === 20 || program.length === 32)) return witnessScript(0, program);
    if (version === 1 && program.length === 32) return witnessScript(1, program);
    return null;
  }
  return null;
}

// cashaddr is bech32's alphabet with its own 40-bit checksum (the Bitcoin Cash spec), the same
// polymod `lib/addresses/utxo.ts` encodes with.
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
const CASHADDR_HASH_BYTES = [20, 24, 28, 32, 40, 48, 56, 64];

function cashaddrPolymod(values: readonly number[]): bigint {
  let c = 1n;
  for (const d of values) {
    const top = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    CASHADDR_GENERATORS.forEach((g, i) => {
      if ((top >> BigInt(i)) & 1n) c ^= g;
    });
  }
  return c ^ 1n;
}

/**
 * A cashaddr under `prefix`, written with or without it, all lower or all upper case: P2PKH (`q…`)
 * and P2SH (`p…`, a 20-byte hash or May 2023's 32-byte P2SH32), and their CashTokens-aware forms
 * (`z…`, `r…`), which lock with the very same scripts — a token-aware wallet receives coin too.
 */
function cashaddrScript(text: string, prefix: string): Uint8Array | null {
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return null;
  const colon = lower.indexOf(':');
  const named = colon < 0 ? prefix : lower.slice(0, colon);
  const body = colon < 0 ? lower : lower.slice(colon + 1);
  if (named !== prefix || body.length <= 8) return null;
  const values: number[] = [];
  for (const ch of body) {
    const v = CASHADDR_CHARSET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  const prefixWords = Array.from(prefix, (ch) => ch.charCodeAt(0) & 31);
  if (cashaddrPolymod([...prefixWords, 0, ...values]) !== 0n) return null;
  const payload = bech32.fromWordsUnsafe(values.slice(0, -8));
  if (!payload || payload.length < 1) return null;
  const version = payload[0];
  const hash = payload.subarray(1);
  if (version & 0x80 || hash.length !== CASHADDR_HASH_BYTES[version & 7]) return null;
  const type = version >> 3;
  if ((type === 0 || type === 2) && hash.length === 20) return p2pkhScript(hash);
  if ((type === 1 || type === 3) && hash.length === 20) return p2shScript(hash);
  if ((type === 1 || type === 3) && hash.length === 32) return p2sh32Script(hash);
  return null;
}

/** The locking script `address` names on `network` in `env`, or null when it is not a recipient there. */
export function utxoRecipientScript(network: NetworkId, address: string, env: ChainNet): Uint8Array | null {
  if (!isUtxoNetwork(network)) return null;
  const format = UTXO_ADDRESS_FORMATS[network][env];
  if (!format || !address) return null;
  if (format.cashaddr) {
    const cash = cashaddrScript(address, format.cashaddr);
    if (cash) return cash;
  }
  if (format.hrp) {
    const segwit = segwitScript(address, format.hrp);
    if (segwit) return segwit;
  }
  return base58Script(address, format);
}

/** Whether `address` is a recipient on `network` in `env`, checksum included — the screen and the signer share it. */
export function isUtxoAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  return utxoRecipientScript(network, address, env) !== null;
}

/* -------------------------------- transport ------------------------------- */

const STRING_TOKEN = /"(?:[^"\\]|\\.)*"/y;
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * `JSON.parse` with every number literal kept as the text the API wrote: an amount past 2^53
 * stays exact (Dogecoin's are), and a fee rate written as a fraction is read with string maths.
 */
function parseJsonDigits(text: string): unknown {
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
      out += `${text.slice(copied, i)}"${m[0]}"`;
      copied = i + m[0].length;
      i += m[0].length;
    } else {
      i++;
    }
  }
  return JSON.parse(out + text.slice(copied));
}

interface Post {
  body: string;
  type: string;
}

/**
 * One request to a UTXO API, bounded by `UTXO_REQUEST_TIMEOUT_MS`, carrying nothing about the
 * person beyond the address in its path. Errors name the network and the call, never the URL (it
 * holds the address) nor the API's text (some echo it): a refused relay keeps only its RPC code.
 */
async function request(network: UtxoNetworkId, what: string, url: string, post?: Post): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UTXO_REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: post ? 'POST' : 'GET',
      headers: post ? { 'content-type': post.type } : undefined,
      body: post?.body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    throw new Error(`${network} ${what}: no answer`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const code = /"code"\s*:\s*(-?\d+)/.exec(text)?.[1];
    throw new Error(`${network} ${what}: HTTP ${res.status}${code ? `, code ${code}` : ''}`);
  }
  return text;
}

async function getJson<T>(network: UtxoNetworkId, what: string, url: string, shape: Check<T>): Promise<T> {
  const text = await request(network, what, url);
  let body: unknown;
  try {
    body = parseJsonDigits(text);
  } catch (e) {
    throw new Error(`${network} ${what}: not JSON`, { cause: e });
  }
  return parseShape(`${network} ${what}`, shape, body);
}

/** A non-negative integer as `parseJsonDigits` leaves it. */
const uint: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new ApiShapeError(label, path, 'an unsigned integer', v);
  return v;
};

/** A signed integer (Bitcore's heights, where -1 and -2 are states). */
const int: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) throw new ApiShapeError(label, path, 'an integer', v);
  return v;
};

/** A non-negative decimal, plain or with an exponent. */
const decimal: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) throw new ApiShapeError(label, path, 'a decimal', v);
  return v;
};

const txidHex: Check<string> = (v, path, label) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new ApiShapeError(label, path, 'a txid', v);
  return v;
};

/** `text` × 10^`scale`, rounded UP — a fee rate is never read as less than the API said. */
function decimalToUnits(text: string, scale: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new Error(`not a decimal: ${text}`);
  const exp = Number(m[3] ?? '0') - (m[2]?.length ?? 0) + scale;
  if (Math.abs(exp) > 40) throw new Error('decimal exponent out of range');
  const digits = BigInt(m[1] + (m[2] ?? ''));
  if (exp >= 0) return digits * 10n ** BigInt(exp);
  const div = 10n ** BigInt(-exp);
  return (digits + div - 1n) / div;
}

const vout = (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) throw new Error('output index out of range');
  return n;
};

/* ---------------------------------- nodes --------------------------------- */

/** A confirmed coin of our address: its outpoint and value. */
interface Coin {
  txid: string;
  vout: number;
  value: bigint;
}

/** What a send asks of a network's API. `identify` runs first and alone: nothing else is asked of a node that fails it. */
interface UtxoNode {
  identify(): Promise<void>;
  /** Our confirmed coins; `complete` false when the API may hold more than it listed. */
  coins(): Promise<{ coins: Coin[]; complete: boolean }>;
  /** The API's fee rate, minor units per 1000 (virtual) bytes. */
  feePerKb(): Promise<bigint>;
  /**
   * Refuses unless each coin about to be spent is what it was listed as. Where the signature
   * commits to input values (BIP143, FORKID) a wrong value only voids the signature, so there is
   * nothing to check; under the legacy digest the value is proved from the previous transaction.
   */
  verifyCoins(coins: readonly Coin[]): Promise<void>;
  broadcast(raw: string): Promise<void>;
}

/** The value is in the BIP143 / FORKID digest: an API misstating it gets a signature the network rejects. */
const valueIsSigned = async (): Promise<void> => {};

/** Bitcoin and Litecoin, main and test: an Esplora API (mempool.space's flavour, for its fee estimates). */
function esploraNode(network: 'btc' | 'ltc', env: ChainNet, api: string, owner: string): UtxoNode {
  return {
    async identify() {
      const genesis = (await request(network, 'genesis', `${api}/block-height/0`)).trim();
      if (genesis !== ESPLORA_GENESIS_HASH[network][env]) throw new ChainSwapRefused('chain');
    },
    async coins() {
      const list = await getJson(
        network,
        'coins',
        `${api}/address/${encodeURIComponent(owner)}/utxo`,
        arrayOf(object({ txid: txidHex, vout: uint, value: uint, status: object({ confirmed: bool }) })),
      );
      const coins = list.filter((u) => u.status.confirmed).map((u) => ({ txid: u.txid, vout: vout(u.vout), value: BigInt(u.value) }));
      return { coins, complete: true };
    },
    async feePerKb() {
      // sat/vB, possibly fractional; the half-hour target, never below the node's own minimum.
      const fees = await getJson(network, 'fees', `${api}/v1/fees/recommended`, object({ halfHourFee: decimal, minimumFee: decimal }));
      const half = decimalToUnits(fees.halfHourFee, 3);
      const min = decimalToUnits(fees.minimumFee, 3);
      return half > min ? half : min;
    },
    verifyCoins: valueIsSigned,
    async broadcast(raw) {
      // text/plain keeps this a CORS "simple" request: Esplora answers no preflight on /tx.
      await request(network, 'broadcast', `${api}/tx`, { body: raw, type: 'text/plain' });
    },
  };
}

/**
 * Dogecoin and Dash: BlockCypher, whose chain document names the chain and its fee per kB. Its
 * requests are spaced `paceMs` apart, under its keyless rate.
 */
function blockcypherNode(network: 'doge' | 'dash', owner: string, ownScript: Uint8Array, paceMs: number): UtxoNode {
  const base = `${BLOCKCYPHER_API}/${network}/main`;
  let medium: bigint | null = null;
  const ownHex = bytesToHex(ownScript);
  let last = -Infinity;
  const pace = async () => {
    const wait = last + paceMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
  const get = async <T>(what: string, url: string, shape: Check<T>): Promise<T> => {
    await pace();
    return getJson(network, what, url, shape);
  };
  return {
    async identify() {
      const chain = await get('chain', base, object({ name: str, medium_fee_per_kb: uint }));
      if (chain.name !== BLOCKCYPHER_CHAIN_NAME[network]) throw new ChainSwapRefused('chain');
      medium = BigInt(chain.medium_fee_per_kb);
    },
    async coins() {
      const ref = object({ tx_hash: txidHex, tx_output_n: int, value: uint, confirmations: uint, script: str });
      const body = await get(
        'coins',
        `${base}/addrs/${encodeURIComponent(owner)}?unspentOnly=true&includeScript=true&limit=${BLOCKCYPHER_UTXO_LIMIT}`,
        object({ txrefs: optional(arrayOf(ref)), hasMore: optional(bool) }),
      );
      const seen = new Set<string>();
      const coins: Coin[] = [];
      for (const r of body.txrefs ?? []) {
        const extra = r as { spent?: unknown; double_spend?: unknown };
        // Outputs only (an input ref has tx_output_n -1), confirmed, unspent, ours.
        if (r.tx_output_n.startsWith('-') || r.confirmations === '0' || extra.spent === true || extra.double_spend === true) continue;
        if (r.script !== ownHex) continue;
        const key = `${r.tx_hash}:${r.tx_output_n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coins.push({ txid: r.tx_hash, vout: vout(r.tx_output_n), value: BigInt(r.value) });
      }
      return { coins, complete: body.hasMore !== true };
    },
    async feePerKb() {
      if (medium === null) throw new Error(`${network} fee: the chain was not identified first`);
      return medium;
    },
    async verifyCoins(coins) {
      // One request per previous transaction, one after the other (the pace), each proved by
      // its own hash: the API may list values, it does not get to state them.
      const byTx = new Map<string, Coin[]>();
      for (const c of coins) byTx.set(c.txid, [...(byTx.get(c.txid) ?? []), c]);
      for (const [txid, spent] of byTx) {
        const body = await get('previous transaction', `${base}/txs/${txid}?includeHex=true&limit=1`, object({ hex: str }));
        if (!/^(?:[0-9a-f]{2})+$/.test(body.hex)) throw new ChainSwapRefused('chain');
        const raw = hexToBytes(body.hex);
        if (bytesToHex(dsha256(raw).reverse()) !== txid) throw new ChainSwapRefused('chain');
        let outputs: TxOut[];
        try {
          outputs = rawTxOutputs(raw);
        } catch {
          throw new ChainSwapRefused('chain');
        }
        for (const coin of spent) {
          const out = outputs[coin.vout];
          if (!out || out.value !== coin.value || !sameBytes(out.script, ownScript)) throw new ChainSwapRefused('chain');
        }
      }
    },
    async broadcast(raw) {
      await pace();
      await request(network, 'broadcast', `${base}/txs/push`, { body: JSON.stringify({ tx: raw }), type: 'application/json' });
    },
  };
}

/** Bitcoin Cash: Bitcore, which spells a cashaddr without its prefix. */
function bitcoreNode(owner: string, ownScript: Uint8Array): UtxoNode {
  const network = 'bch' as const;
  const bare = owner.toLowerCase().replace(/^bitcoincash:/, '');
  const ownHex = bytesToHex(ownScript);
  return {
    async identify() {
      const block = await getJson(
        network,
        'checkpoint',
        `${BCH_BITCORE_API}/block/${BCH_CHECKPOINT.height}`,
        object({ chain: str, network: str, hash: str, height: uint }),
      );
      const ok = block.chain === 'BCH' && block.network === 'mainnet' && block.height === String(BCH_CHECKPOINT.height) && block.hash === BCH_CHECKPOINT.hash;
      if (!ok) throw new ChainSwapRefused('chain');
    },
    async coins() {
      const list = await getJson(
        network,
        'coins',
        `${BCH_BITCORE_API}/address/${encodeURIComponent(bare)}/?unspent=true&limit=${BCH_UTXO_LIMIT}`,
        arrayOf(object({ mintTxid: txidHex, mintIndex: uint, value: uint, script: str, mintHeight: int, spentHeight: int })),
      );
      const seen = new Set<string>();
      const coins: Coin[] = [];
      for (const u of list) {
        // Mined (a mint height, not -1's mempool), unspent (-2; -1 is spent in the mempool), ours.
        if (u.mintHeight.startsWith('-') || u.spentHeight !== '-2' || u.script !== ownHex) continue;
        const key = `${u.mintTxid}:${u.mintIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coins.push({ txid: u.mintTxid, vout: vout(u.mintIndex), value: BigInt(u.value) });
      }
      return { coins, complete: list.length < BCH_UTXO_LIMIT };
    },
    async feePerKb() {
      // BCH per kB as a decimal; -1 when the node has no estimate yet, which leaves the floor.
      const body = await getJson(network, 'fees', `${BCH_BITCORE_API}/fee/${BCH_FEE_TARGET_BLOCKS}`, object({ feerate: str }));
      if (body.feerate === '-1') return 0n;
      return decimalToUnits(decimal(body.feerate, 'feerate', `${network} fees`), 8);
    },
    verifyCoins: valueIsSigned,
    async broadcast(raw) {
      await request(network, 'broadcast', `${BCH_BITCORE_API}/tx/send`, { body: JSON.stringify({ rawTx: raw }), type: 'application/json' });
    },
  };
}

/** The API a network is paid through in `env`, from the registry's source where it is the same one. */
function nodeFor(network: UtxoNetworkId, env: ChainNet, def: NetworkDef, owner: string, ownScript: Uint8Array, paceMs: number): UtxoNode {
  const source = def.balance;
  if (network === 'btc' || network === 'ltc') {
    if (source?.kind !== 'esplora') throw new ChainSwapRefused('chain');
    return esploraNode(network, env, source.api, owner);
  }
  if (env !== 'mainnet') throw new ChainSwapRefused('chain');
  if (network === 'doge' || network === 'dash') {
    if (source?.kind !== 'blockcypher' || source.coin !== network) throw new ChainSwapRefused('chain');
    return blockcypherNode(network, owner, ownScript, paceMs);
  }
  return bitcoreNode(owner, ownScript);
}

/* --------------------------------- policy --------------------------------- */

/**
 * The least an output paying to `script` may carry on `network`: Bitcoin Core's dust threshold
 * (what spending it would cost at the dust relay fee — 546 for P2PKH, 294 for P2WPKH, 330 for
 * P2WSH/P2TR), Dogecoin's flat 0.01 DOGE.
 */
export function utxoDustOf(network: UtxoNetworkId, script: Uint8Array): bigint {
  if (network === 'doge') return DOGE_DUST_LIMIT;
  const output = BigInt(8 + varint(script.length).length + script.length);
  const spend = isWitnessScript(script) ? UTXO_DUST_SPEND_BYTES.witness : UTXO_DUST_SPEND_BYTES.legacy;
  return ((output + spend) * UTXO_DUST_RELAY_PER_KB) / 1000n;
}

const feeFor = (vsize: number, perKb: bigint): bigint => (BigInt(vsize) * perKb + 999n) / 1000n;

interface Plan {
  coins: Coin[];
  fee: bigint;
  change: bigint;
}

/**
 * The coins to spend: the largest first, until they cover the amount and the fee of a transaction
 * that size — fewest inputs, so the smallest fee. Change at or above its dust threshold goes back
 * to us; below it, it is left to the fee. Null when the coins cannot cover it in one standard
 * transaction.
 */
function selectCoins(
  network: UtxoNetworkId,
  kind: 'p2wpkh' | 'p2pkh',
  coins: readonly Coin[],
  amount: bigint,
  perKb: bigint,
  to: Uint8Array,
  change: Uint8Array,
): Plan | null {
  const sorted = [...coins].sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));
  const changeDust = utxoDustOf(network, change);
  let total = 0n;
  for (let n = 1; n <= sorted.length; n++) {
    total += sorted[n - 1].value;
    const bare = maxVsize(kind, n, [to]);
    if (bare > UTXO_MAX_STANDARD_VSIZE) return null;
    if (total < amount + feeFor(bare, perKb)) continue;
    const withChange = maxVsize(kind, n, [to, change]);
    const fee = feeFor(withChange, perKb);
    const rest = total - amount - fee;
    if (rest >= changeDust && withChange <= UTXO_MAX_STANDARD_VSIZE) return { coins: sorted.slice(0, n), fee, change: rest };
    return { coins: sorted.slice(0, n), fee: total - amount, change: 0n };
  }
  return null;
}

/* ---------------------------------- send ---------------------------------- */

/**
 * Pay `p.amount` of the coin of `p.network` to `p.to`. Answers the txid once the API accepted the
 * transaction. Refusals (`ChainSwapRefused`): 'chain' (no such network in this mode, or an API
 * serving another chain), 'address' (a token, or a recipient this network does not accept),
 * 'memo' (these transfers carry none), 'minimum' (below the recipient output's dust threshold),
 * 'funds' (the confirmed coins do not cover amount and fee), 'fee' (the fee would pass `maxFee`).
 * `paceMs` spaces BlockCypher's requests (`BLOCKCYPHER_PACE_MS`); only a test shortens it.
 */
export async function sendUtxo(p: FamilyTransfer, paceMs: number = BLOCKCYPHER_PACE_MS): Promise<string> {
  const network = p.network;
  if (!isUtxoNetwork(network) || p.def.id !== network || !UTXO_ADDRESS_FORMATS[network][p.env]) throw new ChainSwapRefused('chain');
  // These networks have their coin only; whatever a caller passes, nothing else is paid.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  if (p.memo) throw new ChainSwapRefused('memo');
  const to = utxoRecipientScript(network, p.to, p.env);
  if (!to) throw new ChainSwapRefused('address');
  if (p.amount <= 0n || p.amount < utxoDustOf(network, to)) throw new ChainSwapRefused('minimum');

  // The coins we spend and the change we keep are locked to this key's own script, and the
  // address the screen shows must be that script: a mismatch is a bug, never a payment.
  const kind = network === 'btc' || network === 'ltc' ? 'p2wpkh' : 'p2pkh';
  const publicKey = secp256k1.getPublicKey(p.secret, true);
  const keyHash = hash160(publicKey);
  const ownScript = kind === 'p2wpkh' ? witnessScript(0, keyHash) : p2pkhScript(keyHash);
  const ownerScript = utxoRecipientScript(network, p.owner, p.env);
  if (!ownerScript || !sameBytes(ownerScript, ownScript)) throw new Error(`${network} send: the key does not control the sending address`);

  const node = nodeFor(network, p.env, p.def, p.owner, ownScript, paceMs);
  await node.identify();
  const [{ coins, complete }, nodeRate] = await Promise.all([node.coins(), node.feePerKb()]);
  const floor = UTXO_FEE_FLOOR_PER_KB[network];
  const perKb = nodeRate > floor ? nodeRate : floor;

  const plan = selectCoins(network, kind, coins, p.amount, perKb, to, ownScript);
  if (!plan) {
    if (!complete) throw new Error(`${network} send: the address holds more coins than one request lists`);
    // When the coins cover the amount and the fee of spending them all is past the cap, the fee
    // is what stops the send, not the balance.
    const held = coins.reduce((sum, c) => sum + c.value, 0n);
    const all = feeFor(maxVsize(kind, coins.length, [to]), perKb);
    throw new ChainSwapRefused(held >= p.amount && all > p.maxFee ? 'fee' : 'funds');
  }
  if (plan.fee > p.maxFee) throw new ChainSwapRefused('fee');
  // The coins the fee and the change were computed from are the coins as signed: refused here
  // when a legacy-digest network's API listed a value its own transaction does not hold.
  await node.verifyCoins(plan.coins);

  const sequence = UTXO_SEQUENCE[network];
  const outputs: TxOut[] = [{ value: p.amount, script: to }];
  if (plan.change > 0n) outputs.push({ value: plan.change, script: ownScript });
  const tx: Tx = {
    version: UTXO_TX_VERSION[network],
    inputs: plan.coins.map((c) => ({ txid: c.txid, vout: c.vout, sequence })),
    outputs,
    locktime: 0,
  };

  const scriptSigs: Uint8Array[] = [];
  const witnesses: Uint8Array[][] = [];
  plan.coins.forEach((coin, i) => {
    if (kind === 'p2wpkh') {
      // BIP143's scriptCode for P2WPKH is the P2PKH script of the key hash.
      const sig = signDigest(bip143Sighash(tx, i, p2pkhScript(keyHash), coin.value, SIGHASH_ALL), p.secret, SIGHASH_ALL);
      scriptSigs.push(new Uint8Array(0));
      witnesses.push([sig, publicKey]);
      return;
    }
    if (network === 'bch') {
      const hashType = SIGHASH_ALL | SIGHASH_FORKID;
      scriptSigs.push(p2pkhScriptSig(signDigest(bip143Sighash(tx, i, ownScript, coin.value, hashType), p.secret, hashType), publicKey));
      return;
    }
    scriptSigs.push(p2pkhScriptSig(signDigest(legacySighash(tx, i, ownScript, SIGHASH_ALL), p.secret, SIGHASH_ALL), publicKey));
  });

  const raw = bytesToHex(serializeTx(tx, scriptSigs, kind === 'p2wpkh' ? witnesses : undefined));
  await node.broadcast(raw);
  // The id is the hash of what was signed; an API's echo of it adds nothing a lying API could not fake.
  return txidOf(tx, scriptSigs);
}
