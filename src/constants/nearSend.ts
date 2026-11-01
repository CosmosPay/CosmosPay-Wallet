/**
 * Sending NEAR (`lib/send/near.ts`). Every value was asked of the networks' own public nodes on
 * 2026-10-29 (`status`, `EXPERIMENTAL_protocol_config`, `gas_price` against
 * free.rpc.fastnear.com and rpc.testnet.fastnear.com — keyless, `Access-Control-Allow-Origin: *`)
 * and read against nearcore's fee code (`calculate_tx_cost` in its core primitives' fees module).
 */
import type { ChainNet } from '@/constants/chains';

/**
 * Who a node must say it is (`status`). A NEAR transaction names no network: it is bound to one
 * only by the block hash it carries, so the node handing that hash over must be the right one.
 * The genesis hash is checked with the chain id because a fork or a localnet can reuse the name.
 */
export const NEAR_CHAIN: Record<ChainNet, { chainId: string; genesisHash: string }> = {
  mainnet: { chainId: 'mainnet', genesisHash: 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H' },
  testnet: { chainId: 'testnet', genesisHash: 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b' },
};

/**
 * The gas a one-action transfer costs, from the runtime config both networks answered (protocol
 * 86 on mainnet, 88 on testnet: identical). `send` is burnt when the transaction becomes a
 * receipt, `exec` when the receipt runs; `send_sir` and `send_not_sir` are equal for every fee
 * used here, so whether the recipient is the signer does not matter. A transfer to an implicit
 * account pays account creation on top, by the recipient's TYPE (an existing one pays it too and
 * is refunded the unused execution gas): `create_account` for an ETH-implicit `0x…` account,
 * `create_account` + `add_full_access_key` for a 64-hex one.
 */
export const NEAR_GAS = {
  receipt: { send: 108_059_500_000n, exec: 108_059_500_000n },
  transfer: { send: 115_123_062_500n, exec: 115_123_062_500n },
  createAccount: { send: 500_000_000_000n, exec: 7_200_000_000_000n },
  addFullAccessKey: { send: 101_765_125_000n, exec: 101_765_125_000n },
} as const;

/**
 * The least a transaction's execution gas is bought at (`min_gas_purchase_price`, yoctoNEAR per
 * gas), ten times today's 1e8 gas price: the signer must HOLD that much up front and is refunded
 * the difference once the receipt runs — except when the transfer creates an account, which
 * keeps up to `account_creation_charge` (0.007 NEAR) of it. So the up-front cost is also the most
 * a send can ever cost, and it is what `maxFee` caps.
 */
export const NEAR_MIN_GAS_PURCHASE_PRICE = 1_000_000_000n;

/** yoctoNEAR an account must hold per byte of state it uses (`storage_amount_per_byte`, unchanged since genesis). */
export const NEAR_STORAGE_PRICE_PER_BYTE = 10_000_000_000_000_000_000n;

/**
 * NEP-448: an account using no more than this many bytes (`ZERO_BALANCE_ACCOUNT_STORAGE_LIMIT`
 * in nearcore's verifier) needs no balance for its storage. An implicit account with its one
 * full-access key uses 182, so the wallet's own account can be emptied; one that grew past the
 * limit (more keys, a contract) must keep `storage_usage × NEAR_STORAGE_PRICE_PER_BYTE`.
 */
export const NEAR_ZERO_BALANCE_STORAGE_LIMIT = 770n;

/**
 * How long a test-network send waits before asking the MAIN network's node whether it knows the
 * block hash it is about to sign over. The same key controls the same implicit account on both
 * networks, and a transaction is valid on whichever chain knows its block hash; a hash too fresh
 * for the main node to have seen yet is seen by then (blocks are ~0.6 s, finality ~1.2 s).
 */
export const NEAR_REPLAY_SETTLE_MS = 3_000;

/**
 * `send_tx` waits until the transfer's receipt has run (`EXECUTED_OPTIMISTIC`, ~2 s), so a
 * transfer that failed on chain (a named recipient that does not exist) is reported, not shown
 * as sent. The node stops waiting after about 10 s with `TIMEOUT_ERROR` — the transaction was accepted and is
 * on its way — so the client waits longer than that and reads the node's own answer.
 */
export const NEAR_SEND_WAIT_UNTIL = 'EXECUTED_OPTIMISTIC';
export const NEAR_SEND_TIMEOUT_MS = 30_000;
