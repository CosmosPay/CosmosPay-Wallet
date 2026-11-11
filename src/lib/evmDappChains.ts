/**
 * The EVM chains a site may use and how a site spells a chain id or a quantity — the part of
 * `src/lib/evmDapp.ts` with no cryptography in it. Its own module so that what is loaded at boot
 * (the store's WalletConnect slice, the scanner reading a `wc:` QR) does not pull the secp256k1
 * curve and Keccak with it; `evmDapp.ts` re-exports all of it, and its callers did not change.
 */
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import { networkDefOn, sendFeeReserveOn } from '@/lib/testnets';

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
