/**
 * Sending on the Move networks (`lib/send/aptos.ts`): Aptos and Movement, one key, one address,
 * one transaction format. Every value here was asked of the network's own public node on
 * 2026-10-29 (keyless, CORS-open: GET `/`, `/estimate_gas_price`, `/accounts/…`, POST
 * `/transactions/simulate` and the preflight of POST `/transactions`).
 */
import type { ChainNet } from '@/constants/chains';

export type AptosNetworkId = 'aptos' | 'movement';

/**
 * The `chain_id` each network's ledger info (`GET /`) answers. It is a signed field of every
 * transaction, so a node of another network can neither be mistaken for this one nor replay the
 * signature there. Aptos: mainnet 1, testnet 2. Movement: mainnet 126, Bardock testnet 250.
 */
export const APTOS_CHAIN_ID: Record<AptosNetworkId, Record<ChainNet, number>> = {
  aptos: { mainnet: 1, testnet: 2 },
  movement: { mainnet: 126, testnet: 250 },
};

/** The framework coin whose balance is read and paid (APT on Aptos, MOVE on Movement). */
export const APTOS_NATIVE_COIN = '0x1::aptos_coin::AptosCoin';

/** How long a signed transfer stays valid: long enough to reach a block, short enough not to linger in a mempool. */
export const APTOS_TX_EXPIRATION_SECS = 60;

/**
 * Headroom over the simulated gas: the simulation runs against the state of the moment, and a
 * transaction that runs out of gas still pays for what it used. 150 % keeps an ordinary transfer
 * (6–10 units, a few hundred with a new recipient's storage) well inside any sane fee cap.
 */
export const APTOS_GAS_HEADROOM_PCT = 150n;

/** The protocol's ceiling on `max_gas_amount` (the gas schedule's `maximum_number_of_gas_units`). */
export const APTOS_MAX_GAS_UNITS = 2_000_000n;
