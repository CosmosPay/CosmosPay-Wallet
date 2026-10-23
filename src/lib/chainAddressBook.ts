/**
 * Reading the other chains' addresses a wallet entry stores — the light half of
 * `lib/chainAddresses.ts`, which derives them and pulls in BIP-39, BIP-32 and every curve.
 * Screens and the store read addresses on every render; deriving them happens once per
 * wallet, behind a dynamic import, so the popup does not parse the derivation to show a
 * balance.
 */
import { isEvmChain, type ChainNet, type OtherChain } from '@/constants/chains';

export interface ChainAddresses {
  /** Base58, as Phantom shows it. Devnet and mainnet share it. */
  solana: string;
  /** EIP-55 checksummed 0x address — the same on Ethereum, Arbitrum, Base and Monad. */
  evm: string;
  /** BIP-84 P2WPKH on mainnet (bc1q…). */
  bitcoin: string;
  /** BIP-84 P2WPKH on testnet4 (tb1q…), from coin type 1. */
  bitcoinTestnet: string;
}

/**
 * What a wallet entry may hold. Entries written before Bitcoin and the other EVM chains
 * carry `{ solana, monad }` — `monad` being the EVM address under its old name — and are
 * re-derived to the full set the next time the wallet is unlocked (`ensureChainAddresses`).
 */
export type StoredChainAddresses = Partial<ChainAddresses> & { monad?: string };

/** Whether a stored set is the current shape — anything older is re-derived. */
export const isCompleteChainAddresses = (a: StoredChainAddresses | undefined): a is ChainAddresses =>
  !!a?.solana && !!a.evm && !!a.bitcoin && !!a.bitcoinTestnet;

/**
 * Our address on `chain` for `net`, from a stored set of either shape. Only Bitcoin has a
 * different address on its test network; Solana and the EVM chains reuse the same one.
 */
export function chainAddressOf(addrs: StoredChainAddresses | undefined, chain: OtherChain, net: ChainNet): string | null {
  if (!addrs) return null;
  if (chain === 'solana') return addrs.solana ?? null;
  if (chain === 'bitcoin') return (net === 'mainnet' ? addrs.bitcoin : addrs.bitcoinTestnet) ?? null;
  if (isEvmChain(chain)) return addrs.evm ?? addrs.monad ?? null;
  return null;
}
