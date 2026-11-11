/**
 * What a website may ask of the wallet's 0x account, read and checked before anything is signed:
 * the chains a site may use (the wallet's own EVM networks in its mode), the requests themselves
 * (`eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`), the calldata decoded into
 * plain words where it is an ERC-20 call, EIP-191 and EIP-712 digests, and the fee cap.
 *
 * No network and no key here, so `tests/unit/evmDapp.test.ts` reaches all of it; the send itself
 * is `src/lib/evmDappSend.ts`, the window `src/app/ApprovePopup.tsx`, the transport
 * `extension-src/sw.js`.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId, type NetworkToken } from '@/constants/networks';
import {
  ERC20_SELECTORS,
  EVM_ERR,
  KNOWN_SAFE_TYPED_DATA,
  MAX_EVM_CALLDATA_CHARS,
  MAX_EVM_MESSAGE_CHARS,
  MAX_EVM_TYPED_DATA_CHARS,
  PERMIT_PRIMARY_TYPES,
  TYPED_DATA_AMOUNT_RE,
  TYPED_DATA_GRANT_FIELDS,
  UNLIMITED_ALLOWANCE,
  type Erc20Function,
} from '@/constants/evmDapp';
import { fromMinorUnits } from '@/lib/amount';
import { bytesToHex, hexToBytes, isEvmAddress } from '@/lib/evmTx';
import { networkDefOn, sendFeeReserveOn } from '@/lib/testnets';

/* ------------------------------------------------------------------ chains */

/** A chain a site may use: the wallet network behind it and the public node the worker asks. */
export interface EvmDappChain {
  chainId: number;
  network: NetworkId;
  rpc: string;
}

/**
 * Every EVM network the wallet signs on in `env`, as a site sees it. A network the wallet only
 * reads, one without a test network here, or one without a fee cap (Monad keeps its own path,
 * `lib/chainSwap.ts`) is absent: a site cannot pick a chain the wallet would then refuse to sign
 * for. `extension-src/sw.js` keeps a copy (EVM_CHAINS).
 */
export function evmDappChains(env: ChainNet): EvmDappChain[] {
  const out: EvmDappChain[] = [];
  for (const id of Object.keys(NETWORKS) as NetworkId[]) {
    if (NETWORKS[id].address !== 'evm' || sendFeeReserveOn(id, env) <= 0n) continue;
    const def = networkDefOn(id, env);
    if (!def || !def.send || def.evmChainId === undefined || def.balance?.kind !== 'evm') continue;
    out.push({ chainId: def.evmChainId, network: id, rpc: def.balance.rpc });
  }
  return out;
}

export function evmDappChain(env: ChainNet, chainId: number): EvmDappChain | null {
  return evmDappChains(env).find((c) => c.chainId === chainId) ?? null;
}

/* ---------------------------------------------------------------- refusals */

/**
 * A request the wallet will not sign. `key` is the i18n key the window shows; `message` is the
 * English text the site receives with `code` (EIP-1193), never the translated one.
 */
export class EvmDappRefused extends Error {
  readonly key: string;
  readonly code: number;
  constructor(key: string, message: string, code: number = EVM_ERR.invalidParams) {
    super(message);
    this.name = 'EvmDappRefused';
    this.key = key;
    this.code = code;
  }
}

const refuse = (key: string, message: string, code?: number): never => {
  throw new EvmDappRefused(key, message, code);
};

/* ------------------------------------------------------------------ values */

const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;

/** A JSON-RPC quantity (hex) as a bigint, or null when it is not one. */
export function parseQuantity(raw: unknown): bigint | null {
  if (typeof raw !== 'string' || !HEX_QUANTITY.test(raw)) return null;
  return BigInt(raw);
}

/** A chain id as a site may spell it: a number, a hex quantity or a decimal string. */
export function parseChainId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const n = HEX_QUANTITY.test(raw) ? BigInt(raw) : /^[1-9]\d{0,15}$/.test(raw) ? BigInt(raw) : null;
  return n !== null && n > 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

/** `value` base units as a decimal string without trailing zeros (1.5, not 1.500000000000000000). */
export function formatUnits(value: bigint, decimals: number): string {
  const s = fromMinorUnits(value, decimals) ?? value.toString();
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/* ---------------------------------------------------------------- requests */

/** A transaction as the site asked for it. Nonce and fees are the wallet's to choose. */
export interface DappTx {
  from: string;
  to: string;
  value: bigint;
  data: string;
  /** The gas the site asked for, a floor on top of the node's estimate. */
  gas: bigint | null;
}

export interface TypedField {
  name: string;
  type: string;
}

export interface TypedData {
  types: Record<string, TypedField[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

export type EvmDappRequest =
  | { kind: 'connect' }
  | { kind: 'sendTransaction'; tx: DappTx }
  | { kind: 'personalSign'; address: string; message: Uint8Array }
  | { kind: 'signTypedData'; address: string; typed: TypedData };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A request the approval window was opened for, read strictly: anything that does not fit is a
 * refusal (`invalidParams`), never a best-effort guess. `chainId` is the chain the site had
 * selected when it asked; a transaction naming another is refused.
 */
export function parseEvmDappRequest(method: string, params: unknown, chainId: number): EvmDappRequest {
  const list = Array.isArray(params) ? params : [];
  if (method === 'eth_requestAccounts') return { kind: 'connect' };

  if (method === 'eth_sendTransaction') {
    const p = list[0];
    if (!isObject(p)) return refuse('approve.evm.err.params', 'Expected a transaction object.');
    const from = p.from;
    if (typeof from !== 'string' || !isEvmAddress(from)) return refuse('approve.evm.err.params', 'Invalid "from" address.');
    if (p.to === undefined || p.to === null || p.to === '') {
      return refuse('approve.evm.err.create', 'Contract creation is not supported.', EVM_ERR.unsupported);
    }
    if (typeof p.to !== 'string' || !isEvmAddress(p.to)) return refuse('approve.evm.err.params', 'Invalid "to" address.');
    const value = p.value === undefined || p.value === null ? 0n : parseQuantity(p.value);
    if (value === null) return refuse('approve.evm.err.params', 'Invalid "value".');
    const data = p.data ?? p.input ?? '0x';
    if (p.data !== undefined && p.input !== undefined && String(p.data).toLowerCase() !== String(p.input).toLowerCase()) {
      return refuse('approve.evm.err.params', '"data" and "input" disagree.');
    }
    if (typeof data !== 'string' || !HEX_DATA.test(data) || data.length > MAX_EVM_CALLDATA_CHARS) {
      return refuse('approve.evm.err.params', 'Invalid "data".');
    }
    const gasRaw = p.gas ?? p.gasLimit;
    const gas = gasRaw === undefined || gasRaw === null ? null : parseQuantity(gasRaw);
    if (gasRaw !== undefined && gasRaw !== null && gas === null) return refuse('approve.evm.err.params', 'Invalid "gas".');
    if (p.chainId !== undefined && p.chainId !== null && parseChainId(p.chainId) !== chainId) {
      return refuse('approve.evm.err.txChain', 'The transaction names another chain than the one selected.');
    }
    return { kind: 'sendTransaction', tx: { from, to: p.to, value, data: data.toLowerCase(), gas } };
  }

  if (method === 'personal_sign') {
    // [message, address] by the spec; some sites send [address, message], as MetaMask accepts.
    const [a, b] = list;
    const [message, address] = typeof b === 'string' && isEvmAddress(b) ? [a, b] : typeof a === 'string' && isEvmAddress(a) ? [b, a] : [a, b];
    if (typeof address !== 'string' || !isEvmAddress(address)) return refuse('approve.evm.err.params', 'Invalid address.');
    if (typeof message !== 'string' || message.length > MAX_EVM_MESSAGE_CHARS) return refuse('approve.evm.err.params', 'Invalid message.');
    return { kind: 'personalSign', address, message: personalMessageBytes(message) };
  }

  if (method === 'eth_signTypedData_v4') {
    const [address, raw] = list;
    if (typeof address !== 'string' || !isEvmAddress(address)) return refuse('approve.evm.err.params', 'Invalid address.');
    const typed = parseTypedData(raw);
    const named = typedDataChainId(typed);
    if (named !== null && named !== chainId) {
      return refuse('approve.evm.err.typedChain', 'The typed data names another chain than the one selected.');
    }
    return { kind: 'signTypedData', address, typed };
  }

  return refuse('approve.evm.err.method', `Unsupported method: ${method}`, EVM_ERR.unsupported);
}

/* --------------------------------------------------------------- calldata */

/** The arguments of an ERC-20 call, as its selector and words spell them. */
export interface Erc20Args {
  fn: Erc20Function;
  /** Who is approved (approve, increaseAllowance) or paid (transfer, transferFrom). */
  counterparty: string;
  /** transferFrom's owner. */
  owner: string | null;
  amount: bigint;
  /** approve / increaseAllowance: someone may spend later, without asking again. */
  grant: boolean;
  /** An allowance of 2^128 or more: everything, forever. */
  unlimited: boolean;
}

export type CallReview =
  /** No calldata: the coin moves, and nothing else. */
  | { kind: 'coin' }
  /** An ERC-20 call to a token of the wallet's registry on this chain: put in words. */
  | ({ kind: 'erc20'; token: NetworkToken } & Erc20Args)
  /**
   * Any other call, shown raw behind a warning and the acknowledgement. `erc20` is what its
   * arguments would mean if the contract were an honest ERC-20 — a hint, never a reading: any
   * contract can answer the `approve` or `transfer` selector and do something else entirely.
   */
  | { kind: 'contract'; selector: string; bytes: number; erc20: Erc20Args | null };

/** A 32-byte ABI word holding an address, or null when its top 12 bytes are not zero. */
function wordAddress(word: string): string | null {
  return /^0{24}[0-9a-f]{40}$/.test(word) ? `0x${word.slice(24)}` : null;
}

/** `data` read as an ERC-20 call, or null when its selector or shape is not one. */
function erc20Args(hex: string): Erc20Args | null {
  const selector = hex.slice(0, 10);
  const body = hex.slice(10);
  const fn = (Object.keys(ERC20_SELECTORS) as Erc20Function[]).find((k) => ERC20_SELECTORS[k] === selector);
  if (!fn || body.length % 64) return null;
  const words = body.match(/.{64}/g) ?? [];
  const arity = fn === 'transferFrom' ? 3 : 2;
  if (words.length !== arity) return null;
  const addrs = words.slice(0, arity - 1).map(wordAddress);
  if (addrs.some((a) => a === null)) return null;
  const amount = BigInt(`0x${words[arity - 1]}`);
  const grant = fn === 'approve' || fn === 'increaseAllowance';
  return {
    fn,
    counterparty: (fn === 'transferFrom' ? addrs[1] : addrs[0]) as string,
    owner: fn === 'transferFrom' ? addrs[0] : null,
    amount,
    grant,
    unlimited: grant && amount >= UNLIMITED_ALLOWANCE,
  };
}

/**
 * What `data` sent to `to` does, as far as the wallet can say it in words: only a call to a token
 * of its own registry on this chain (`tokens`) is read as ERC-20; everything else is a contract.
 */
export function reviewCall(to: string, data: string, tokens: readonly NetworkToken[]): CallReview {
  const hex = data.toLowerCase();
  if (hex === '0x') return { kind: 'coin' };
  const args = erc20Args(hex);
  const token = tokens.find((t) => t.asset.toLowerCase() === to.toLowerCase());
  if (args && token) return { kind: 'erc20', token, ...args };
  return { kind: 'contract', selector: hex.slice(0, 10), bytes: (hex.length - 2) / 2, erc20: args };
}

/**
 * Whether the window must have the person tick the acknowledgement before this call: every call
 * but a plain coin payment and a registry token's `transfer` — an allowance (any amount: it
 * outlives the transaction), a `transferFrom` and any contract the wallet cannot read.
 */
export function callNeedsAck(call: CallReview): boolean {
  if (call.kind === 'coin') return false;
  if (call.kind === 'contract') return true;
  return call.fn !== 'transfer';
}

/**
 * Whether an allowance amounts to everything the signer holds: unlimited (2^128 or more), or at
 * least the balance read for it (`balance`, null when it could not be read).
 */
export function allowanceCoversAll(amount: bigint, balance: bigint | null): boolean {
  return amount >= UNLIMITED_ALLOWANCE || (balance !== null && amount >= balance);
}

/* ---------------------------------------------------------- personal_sign */

/** The bytes a `personal_sign` message stands for: hex is decoded, anything else is UTF-8. */
export function personalMessageBytes(raw: string): Uint8Array {
  return HEX_DATA.test(raw) ? hexToBytes(raw) : utf8ToBytes(raw);
}

/** The message as the window shows it: its text when it is readable UTF-8, its hex otherwise. */
export function messagePreview(bytes: Uint8Array): { text: string; hex: boolean } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Control characters other than line breaks and tabs hide what is being signed.
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { text, hex: false };
  } catch {
    /* not UTF-8 */
  }
  return { text: bytesToHex(bytes), hex: true };
}

/** EIP-191 version 0x45: keccak256("\x19Ethereum Signed Message:\n" + len + message). */
export function personalSignDigest(message: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${message.length}`), message));
}

/** A 65-byte `r || s || v` signature over a 32-byte digest, v = 27 or 28, low-s. */
export function signEvmDigest(digest: Uint8Array, secret: Uint8Array): string {
  if (digest.length !== 32) throw new Error('A digest is 32 bytes');
  const sig = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
  return bytesToHex(concatBytes(sig.subarray(1, 65), Uint8Array.of(27 + sig[0])));
}

/* ------------------------------------------------------------ typed data */

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The EIP712Domain fields in their canonical order, when a site leaves the type out. */
const DOMAIN_FIELDS: readonly TypedField[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

/** `eth_signTypedData_v4`'s payload (a JSON string, or the object itself), checked for shape. */
export function parseTypedData(raw: unknown): TypedData {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_EVM_TYPED_DATA_CHARS) return refuse('approve.evm.err.params', 'Typed data is too large.');
    try {
      v = JSON.parse(raw);
    } catch {
      return refuse('approve.evm.err.params', 'Typed data is not JSON.');
    }
  } else if (JSON.stringify(raw ?? null).length > MAX_EVM_TYPED_DATA_CHARS) {
    return refuse('approve.evm.err.params', 'Typed data is too large.');
  }
  if (!isObject(v) || !isObject(v.types) || typeof v.primaryType !== 'string' || !isObject(v.domain) || !isObject(v.message)) {
    return refuse('approve.evm.err.params', 'Typed data needs types, primaryType, domain and message.');
  }
  const types: Record<string, TypedField[]> = {};
  for (const [name, fields] of Object.entries(v.types)) {
    if (!IDENT.test(name) || !Array.isArray(fields)) return refuse('approve.evm.err.params', `Invalid type "${name}".`);
    types[name] = fields.map((f) => {
      if (!isObject(f) || typeof f.name !== 'string' || typeof f.type !== 'string' || !IDENT.test(f.name)) {
        return refuse('approve.evm.err.params', `Invalid field in "${name}".`);
      }
      return { name: f.name, type: f.type };
    });
  }
  const domain = v.domain;
  if (!types.EIP712Domain) types.EIP712Domain = DOMAIN_FIELDS.filter((f) => domain[f.name] !== undefined);
  if (!types[v.primaryType]) return refuse('approve.evm.err.params', `Unknown primaryType "${v.primaryType}".`);
  return { types, primaryType: v.primaryType, domain, message: v.message };
}

/** The chain the typed data's domain is bound to, or null when it names none. */
export function typedDataChainId(td: TypedData): number | null {
  const raw = td.domain.chainId;
  if (raw === undefined || raw === null) return null;
  const n = parseChainId(typeof raw === 'bigint' ? raw.toString() : raw);
  return n ?? refuse('approve.evm.err.params', 'Invalid domain chainId.');
}

const baseType = (type: string): string => type.replace(/(\[\d*\])+$/, '');

/**
 * The fields of `td`'s primary type, at any depth (nested structs and arrays of them), whose name
 * says someone may spend, receive or act for the signer, or that an amount moves — `Order.offer[].
 * startAmount`, `ConsiderationItem.recipient`, `Permit.spender`. Read from the TYPES, so a field
 * is found whether or not the message fills it.
 */
export function typedDataGrantFields(td: TypedData): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (type: string, path: string) => {
    if (seen.has(type)) return;
    seen.add(type);
    for (const f of td.types[type] ?? []) {
      const at = `${path}.${f.name}`;
      if (TYPED_DATA_GRANT_FIELDS.includes(f.name.toLowerCase()) || TYPED_DATA_AMOUNT_RE.test(f.name)) found.push(at);
      const inner = baseType(f.type);
      if (td.types[inner]) walk(inner, f.type.endsWith(']') ? `${at}[]` : at);
    }
    seen.delete(type);
  };
  walk(td.primaryType, td.primaryType);
  return found;
}

/**
 * Whether a signature over `td` may grant something: a permit's primary type (EIP-2612, Permit2)
 * or any grant-like field (`typedDataGrantFields`). The window paints it red and names the fields.
 */
export function typedDataGrants(td: TypedData): boolean {
  return PERMIT_PRIMARY_TYPES.includes(td.primaryType) || typedDataGrantFields(td).length > 0;
}

/** Every typed signature needs the acknowledgement, unless its type is a known-safe one (none yet). */
export function typedDataNeedsAck(td: TypedData): boolean {
  return !KNOWN_SAFE_TYPED_DATA.includes(td.primaryType);
}

function dependencies(type: string, types: Record<string, TypedField[]>, found: Set<string>): Set<string> {
  const base = baseType(type);
  if (found.has(base) || !types[base]) return found;
  found.add(base);
  for (const f of types[base]) dependencies(f.type, types, found);
  return found;
}

/** `Mail(Person from,Person to,string contents)Person(string name,address wallet)` */
export function encodeType(primary: string, types: Record<string, TypedField[]>): string {
  const deps = [...dependencies(primary, types, new Set())].filter((t) => t !== primary).sort();
  return [primary, ...deps].map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(',')})`).join('');
}

const typeHash = (primary: string, types: Record<string, TypedField[]>) => keccak_256(utf8ToBytes(encodeType(primary, types)));

function word32(n: bigint): Uint8Array {
  return hexToBytes(`0x${n.toString(16).padStart(64, '0')}`);
}

function integer(raw: unknown, field: string): bigint {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt(raw);
  if (typeof raw === 'string') {
    if (/^-?\d+$/.test(raw)) return BigInt(raw);
    if (/^0x[0-9a-fA-F]+$/.test(raw)) return BigInt(raw);
  }
  return refuse('approve.evm.err.params', `Invalid integer in "${field}".`);
}

function encodeValue(type: string, value: unknown, types: Record<string, TypedField[]>, field: string): Uint8Array {
  if (value === undefined || value === null) return refuse('approve.evm.err.params', `Missing value for "${field}".`);
  if (types[type]) {
    if (!isObject(value)) return refuse('approve.evm.err.params', `"${field}" must be an object.`);
    return hashStruct(type, value, types);
  }
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    if (!Array.isArray(value)) return refuse('approve.evm.err.params', `"${field}" must be an array.`);
    if (array[2] !== '' && value.length !== Number(array[2])) return refuse('approve.evm.err.params', `"${field}" has the wrong length.`);
    return keccak_256(concatBytes(...value.map((v, i) => encodeValue(array[1], v, types, `${field}[${i}]`))));
  }
  if (type === 'string') {
    if (typeof value !== 'string') return refuse('approve.evm.err.params', `"${field}" must be a string.`);
    return keccak_256(utf8ToBytes(value));
  }
  if (type === 'bytes') {
    if (typeof value !== 'string' || !HEX_DATA.test(value)) return refuse('approve.evm.err.params', `"${field}" must be hex bytes.`);
    return keccak_256(hexToBytes(value));
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') return refuse('approve.evm.err.params', `"${field}" must be a boolean.`);
    return word32(value ? 1n : 0n);
  }
  if (type === 'address') {
    if (typeof value !== 'string' || !isEvmAddress(value)) return refuse('approve.evm.err.params', `"${field}" must be an address.`);
    return word32(BigInt(value));
  }
  const fixed = /^bytes([1-9]|[12]\d|3[0-2])$/.exec(type);
  if (fixed) {
    const size = Number(fixed[1]);
    if (typeof value !== 'string' || !HEX_DATA.test(value) || (value.length - 2) / 2 !== size) {
      return refuse('approve.evm.err.params', `"${field}" must be ${size} bytes.`);
    }
    const out = new Uint8Array(32);
    out.set(hexToBytes(value));
    return out;
  }
  const int = /^(u?)int(\d*)$/.exec(type);
  if (int) {
    const bits = int[2] === '' ? 256 : Number(int[2]);
    if (bits < 8 || bits > 256 || bits % 8) return refuse('approve.evm.err.params', `Unknown type "${type}".`);
    const n = integer(value, field);
    const unsigned = int[1] === 'u';
    const [min, max] = unsigned ? [0n, 2n ** BigInt(bits) - 1n] : [-(2n ** BigInt(bits - 1)), 2n ** BigInt(bits - 1) - 1n];
    if (n < min || n > max) return refuse('approve.evm.err.params', `"${field}" is out of range for ${type}.`);
    return word32(n < 0n ? 2n ** 256n + n : n);
  }
  return refuse('approve.evm.err.params', `Unknown type "${type}".`);
}

/** EIP-712 `hashStruct`: keccak256(typeHash || encodeData). */
export function hashStruct(type: string, data: Record<string, unknown>, types: Record<string, TypedField[]>): Uint8Array {
  const fields = types[type];
  const parts = fields.map((f) => encodeValue(f.type, data[f.name], types, `${type}.${f.name}`));
  return keccak_256(concatBytes(typeHash(type, types), ...parts));
}

/** The EIP-712 digest a v4 signature commits to: keccak256(0x1901 || domainSeparator || hashStruct(message)). */
export function typedDataDigest(td: TypedData): Uint8Array {
  const domain = hashStruct('EIP712Domain', td.domain, td.types);
  if (td.primaryType === 'EIP712Domain') return keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domain));
  return keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domain, hashStruct(td.primaryType, td.message, td.types)));
}

/* ------------------------------------------------------------------- fees */

/**
 * Whether the worst case of a transaction (`maxFeePerGas × gasLimit`) fits the network's cap
 * (`SEND_FEE_RESERVE`). A network without a cap has no allowance at all: refused, not unbounded.
 */
export function feeWithinCap(maxFeePerGas: bigint, gasLimit: bigint, cap: bigint): boolean {
  return cap > 0n && maxFeePerGas >= 0n && gasLimit > 0n && maxFeePerGas * gasLimit <= cap;
}
