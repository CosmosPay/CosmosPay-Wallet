/**
 * The contract every network family's sender follows (`src/lib/send/*.ts`), dispatched by
 * `lib/networkSend.ts`. A sender builds a plain transfer the wallet itself composes — the coin, or
 * one of the network's registry tokens — signs it with the family's key and hands it to the node
 * of `def`. There is no counterparty envelope, so what a sender must guarantee is that a public
 * node decides nothing:
 *
 * - **The node is the network the signature is for.** Each sender checks the node's identity
 *   (a genesis hash, a chain id, a network id) against a constant before it signs, and binds the
 *   signature to that network wherever the format allows it. A mismatch is `ChainSwapRefused('chain')`.
 * - **The fee is capped.** Whatever the node says fees, gas or energy cost, one send never costs
 *   more than `maxFee` (minor units of the network's coin): `ChainSwapRefused('fee')`.
 * - **Only what the screen offered is paid.** The coin, or an asset listed in `def.tokens`;
 *   anything else is `ChainSwapRefused('address')`, whatever the caller passes.
 * - **Amounts are integers in minor units, all the way to the wire.** No floats.
 * - **Refusals are codes, never copy** (`ChainSwapRefusalCode` in `lib/chainSwap.ts`): the screen
 *   renders `xswap.refused.<code>`.
 *
 * A sender answers the transaction id (hash) once the node has accepted the transaction.
 */
import type { ChainNet } from '@/constants/chains';
import type { NetworkDef, NetworkId } from '@/constants/networks';

export interface FamilyTransfer {
  network: NetworkId;
  /** The wallet's mode. A sender that cannot bind a signature to a test network refuses 'chain' there. */
  env: ChainNet;
  /** The network as it is in `env` (`networkDefOn`): its endpoint, chain id and tokens. */
  def: NetworkDef;
  /**
   * The family's signing key, from `lib/chainKeys.ts` (`networkSecret`), already checked to
   * control `owner`: a 32-byte secp256k1 scalar (UTXO families, XRP, Tron, Hyperliquid), a 32-byte
   * ed25519 seed (TON, NEAR, Sui, Aptos, Movement), a 64-byte BIP32-Ed25519 extended key kL ‖ kR
   * (Cardano's payment key), a 32-byte Stark scalar (Starknet). The caller zeroes it afterwards.
   */
  secret: Uint8Array;
  /** Our address on the network in `env`. */
  owner: string;
  /** `native`, or one of `def.tokens`' assets. */
  asset: string;
  /** The recipient, as the person typed it (trimmed). */
  to: string;
  /** In the asset's minor units; greater than zero. */
  amount: bigint;
  /** XRP's destination tag (decimal digits) or TON's text comment; absent elsewhere. */
  memo?: string;
  /** The most one send may cost, in minor units of the network's coin. */
  maxFee: bigint;
}
