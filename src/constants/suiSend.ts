/**
 * Sending on Sui (`lib/send/sui.ts`). Every value was asked of Sui's public GraphQL services on
 * 2026-10-29 (graphql.mainnet.sui.io / graphql.testnet.sui.io — keyless,
 * `Access-Control-Allow-Origin: *`, POST preflight allowed; protocol 139 on both): the chain
 * identifier, the epoch's reference gas price, `simulateTransaction` and `executeTransaction`.
 */
import type { ChainNet } from '@/constants/chains';

/**
 * The network's identifier as GraphQL answers it (`chainIdentifier`): base58 of the genesis
 * checkpoint's digest, whose first four bytes are the short ids `35834a8a` (mainnet) and
 * `4c78adac` (testnet). Checked before anything is signed, and written into every transfer the
 * wallet signs (`ValidDuring.chain`), so the signature is void on any other network.
 */
export const SUI_CHAIN_ID: Record<ChainNet, string> = {
  mainnet: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
  testnet: '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',
};

/** The framework's coin, which pays gas; the registry lists only tokens. */
export const SUI_COIN_TYPE = '0x2::sui::SUI';

/**
 * What the simulated budget is padded with, in computation units (× the gas price): the Sui
 * SDK's `GAS_SAFE_OVERHEAD`, the same value as the protocol's fixed base cost
 * (`base_tx_cost_fixed`, 1 000). The budget is the most the transfer can cost; what it does not
 * use is not charged.
 */
export const SUI_GAS_SAFE_OVERHEAD = 1_000n;

/**
 * The least budget a transaction may carry, in computation units (× the gas price): the
 * protocol's `base_tx_cost_fixed`. A node asked to simulate below it refuses outright ("Gas
 * budget: … is lower than min"), so a fee cap or a balance under it is refused before asking.
 */
export const SUI_MIN_BUDGET_UNITS = 1_000n;

/**
 * Coin objects read per page, and at most how many pages: a wallet holding more coin objects
 * than this pays from the largest ones read. The protocol takes up to 256 gas payment objects
 * (`max_gas_payment_objects`) and 2 048 inputs, so the cap keeps every transfer valid.
 */
export const SUI_COIN_PAGE_SIZE = 50;
export const SUI_MAX_COIN_PAGES = 5;

/** One GraphQL request, end to end; executing waits for finality (a few hundred ms on Sui). */
export const SUI_GRAPHQL_TIMEOUT_MS = 15_000;
export const SUI_EXECUTE_TIMEOUT_MS = 30_000;
