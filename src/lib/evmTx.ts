/**
 * EIP-1559 (type 2) transactions on Monad: build, sign, and read back the calls the
 * gateway hands out for a Kuru Flow swap.
 *
 * The wallet signs exactly two kinds of call on Monad, and this module is where both are
 * checked before a signature exists:
 *
 *   - a swap the gateway built (`to`, `data`, `value`), whose `value` may be at most the
 *     MON the user typed, and zero when selling a token;
 *   - the ERC-20 `approve` that may precede it, which must name the swap's own router as
 *     spender and exactly the amount being sold — never an unlimited allowance, which
 *     would outlive the swap.
 *
 * Plus the transfers it builds itself for a cross-chain deposit (MON or `transfer`).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex as rawHex, concatBytes, hexToBytes as rawBytes } from '@noble/hashes/utils.js';
import { toChecksumAddress } from '@/lib/chainAddresses';

/** `approve(address,uint256)` */
export const ERC20_APPROVE_SELECTOR = '0x095ea7b3';
/** `transfer(address,uint256)` */
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';
/** `balanceOf(address)` */
export const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isEvmAddress = (v: string): boolean => EVM_ADDRESS_RE.test(v);

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.replace(/^0x/, '');
  if (body.length % 2 || /[^0-9a-fA-F]/.test(body)) throw new Error(`"${hex}" is not even-length hex`);
  return rawBytes(body);
}

export const bytesToHex = (bytes: Uint8Array): string => `0x${rawHex(bytes)}`;

/** A non-negative integer as minimal big-endian bytes; zero is empty (RLP's rule). */
function intBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('negative integer');
  if (value === 0n) return new Uint8Array();
  const hex = value.toString(16);
  return rawBytes(hex.length % 2 ? `0${hex}` : hex);
}

type RlpItem = Uint8Array | RlpItem[];

function lengthPrefix(length: number, base: number): Uint8Array {
  if (length < 56) return Uint8Array.of(base + length);
  const len = intBytes(BigInt(length));
  return concatBytes(Uint8Array.of(base + 55 + len.length), len);
}

function rlp(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < 0x80) return item;
    return concatBytes(lengthPrefix(item.length, 0x80), item);
  }
  const body = concatBytes(...item.map(rlp));
  return concatBytes(lengthPrefix(body.length, 0xc0), body);
}

/** The EIP-55 address of a secp256k1 secret. */
export function evmAddressOf(secret: Uint8Array): string {
  const pub = secp256k1.getPublicKey(secret, false);
  return toChecksumAddress(rawHex(keccak_256(pub.subarray(1)).subarray(12)));
}

/** A call as the gateway hands it out (`transaction` / `approval` of a Monad swap). */
export interface EvmCall {
  to: string;
  data: string;
  /** Wei, decimal. */
  value: string;
  chainId: number;
}

export interface Eip1559Tx {
  chainId: number;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
}

function fields(tx: Eip1559Tx): RlpItem[] {
  return [
    intBytes(BigInt(tx.chainId)),
    intBytes(tx.nonce),
    intBytes(tx.maxPriorityFeePerGas),
    intBytes(tx.maxFeePerGas),
    intBytes(tx.gasLimit),
    hexToBytes(tx.to),
    intBytes(tx.value),
    hexToBytes(tx.data),
    [],
  ];
}

/**
 * Sign a type-2 transaction: keccak over `0x02 || rlp(fields)`, low-s, then
 * `0x02 || rlp(fields ++ [yParity, r, s])`. The chain id is a signed field, so the
 * signature is worthless on any other chain.
 */
export function signEip1559(tx: Eip1559Tx, secret: Uint8Array): { raw: string; hash: string } {
  const digest = keccak_256(concatBytes(Uint8Array.of(0x02), rlp(fields(tx))));
  const sig = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
  const r = BigInt(bytesToHex(sig.subarray(1, 33)));
  const s = BigInt(bytesToHex(sig.subarray(33, 65)));
  const raw = concatBytes(Uint8Array.of(0x02), rlp([...fields(tx), intBytes(BigInt(sig[0])), intBytes(r), intBytes(s)]));
  return { raw: bytesToHex(raw), hash: bytesToHex(keccak_256(raw)) };
}

/** A 32-byte ABI word. */
function word(value: string | bigint): string {
  const hex = typeof value === 'bigint' ? value.toString(16) : value.toLowerCase().replace(/^0x/, '');
  return hex.padStart(64, '0');
}

export const approveCalldata = (spender: string, amount: bigint): string =>
  ERC20_APPROVE_SELECTOR + word(spender) + word(amount);

export const transferCalldata = (to: string, amount: bigint): string =>
  ERC20_TRANSFER_SELECTOR + word(to) + word(amount);

export const balanceOfCalldata = (owner: string): string => ERC20_BALANCE_OF_SELECTOR + word(owner);

/** Why a Monad swap was refused before signing (an i18n-free code the store maps). */
export type EvmSwapRefusal = 'chain' | 'value' | 'approval';

/**
 * Check the calls of a Monad swap against what the user confirmed. Returns null when
 * they may be signed, or why not.
 *
 * `sendAsset` is `native` or the ERC-20 being sold; `amount` is the base units typed.
 */
export function checkMonadSwapCalls(
  swap: EvmCall,
  approval: EvmCall | null,
  sendAsset: string,
  amount: bigint,
  chainId: number,
): EvmSwapRefusal | null {
  if (swap.chainId !== chainId || (approval && approval.chainId !== chainId)) return 'chain';
  if (!isEvmAddress(swap.to)) return 'value';
  let value: bigint;
  try {
    value = BigInt(swap.value || '0');
  } catch {
    return 'value';
  }
  if (sendAsset === 'native') {
    if (approval) return 'approval';
    return value > amount ? 'value' : null;
  }
  if (value !== 0n) return 'value';
  if (!approval) return null;
  const exact = approveCalldata(swap.to, amount).toLowerCase();
  if (
    approval.to.toLowerCase() !== sendAsset.toLowerCase() ||
    approval.data.toLowerCase() !== exact ||
    BigInt(approval.value || '0') !== 0n
  ) {
    return 'approval';
  }
  return null;
}
