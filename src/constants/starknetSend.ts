/**
 * Paying from the wallet's Starknet account (`lib/send/starknet.ts`): the Argent X account of
 * `lib/addresses/starknet.ts`, its node, the STRK token and the knobs a transfer is signed with.
 */
import type { ChainNet } from '@/constants/chains';

/**
 * Starknet JSON-RPC, public, keyless and open to a browser (CORS `*`, preflight answered), probed
 * 2026-10-29 with an `Origin` header: both answer spec 0.10.3 at the root and take a JSON-RPC
 * batch. PublicNode is the same operator as the EVM test networks' endpoints.
 *
 * Alternatives that answered then: Cartridge (`https://api.cartridge.gg/x/starknet/mainnet`,
 * spec 0.10.2; `…/sepolia`, spec 0.9.0), dRPC (`https://starknet.drpc.org`, which has no
 * `starknet_specVersion`; `https://starknet-sepolia.drpc.org`, 0.10.3) and 1RPC
 * (`https://1rpc.io/starknet`, no `starknet_specVersion`). Gone or closed: Blast (shut down,
 * 403), Lava and Nethermind's free RPC (410), Alchemy's demo key (internal error), OnFinality
 * (429 without a key).
 */
export const STARKNET_RPC: Record<ChainNet, string> = {
  mainnet: 'https://starknet-rpc.publicnode.com',
  testnet: 'https://starknet-sepolia-rpc.publicnode.com',
};

/**
 * What `starknet_chainId` must answer in each mode: the short strings `SN_MAIN` and `SN_SEPOLIA`.
 * The same felt is inside every transaction hash the wallet signs, so a signature for one is
 * never valid on the other — the node is still asked first, so a node for the wrong network is
 * refused before anything is signed.
 */
export const STARKNET_CHAIN_ID: Record<ChainNet, bigint> = {
  mainnet: 0x534e5f4d41494en,
  testnet: 0x534e5f5345504f4c4941n,
};

/** STRK, the fee token and the coin the wallet shows: one contract, the same on mainnet and Sepolia. */
export const STRK_TOKEN = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;

/**
 * Argent's account class v0.4.0 — the class `lib/addresses/starknet.ts` computes the address
 * with, declared on mainnet and Sepolia (Argent's `deployments/account.txt`). A deploy must name
 * exactly this class, or the account lands at another address.
 */
export const ARGENT_ACCOUNT_CLASS_HASH = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927fn;

/** sn_keccak('transfer') — ERC-20 `transfer(recipient, amount: u256)`. */
export const STARKNET_TRANSFER_SELECTOR = 0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12en;
/** sn_keccak('balance_of') — the snake-case ERC-20 read every Cairo 1 token (STRK included) answers. */
export const STARKNET_BALANCE_OF_SELECTOR = 0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33n;

/**
 * Starknet's contract addresses are below 2^251 − 256 (the storage-key bound), and 0x0–0x2 are
 * the protocol's own: 0x1 keeps block hashes and 0x2 the state-diff aliases, so a token sent there
 * is burnt. A recipient must be above `STARKNET_RESERVED_ADDRESS_MAX` and below the bound.
 */
export const STARKNET_ADDRESS_BOUND = 2n ** 251n - 256n;
export const STARKNET_RESERVED_ADDRESS_MAX = 2n;

/**
 * How far above the node's estimate each resource bound goes, in percent of the estimate: the
 * gas a transfer uses barely moves between the estimate and the block, but the L2 and L1 prices
 * do. 150% of each (starknet.js's default overhead) caps a transaction at ~2.25× its estimate;
 * it is charged what it actually uses at the block's price, never the cap.
 */
export const STARKNET_AMOUNT_HEADROOM_PCT = 150n;
export const STARKNET_PRICE_HEADROOM_PCT = 150n;

/**
 * The felts a v3 transaction hash is built from (Starknet's "Transactions" spec): the type prefix
 * (the short strings `invoke` and `deploy_account`), the version, and each resource bound's name
 * (`L1_GAS`, `L2_GAS`, `L1_DATA`) packed as name ‖ max amount (u64) ‖ max price per unit (u128).
 * A fee estimate is sent as the QUERY version (2^128 + 3): the hash it signs is one no sequencer
 * executes, so the node that ran the estimate holds nothing it can broadcast.
 */
export const STARKNET_INVOKE_PREFIX = 0x696e766f6b65n;
export const STARKNET_DEPLOY_ACCOUNT_PREFIX = 0x6465706c6f795f6163636f756e74n;
export const STARKNET_TX_VERSION = 3n;
export const STARKNET_QUERY_VERSION = 2n ** 128n + 3n;
export const STARKNET_L1_GAS = 0x4c315f474153n;
export const STARKNET_L2_GAS = 0x4c325f474153n;
export const STARKNET_L1_DATA_GAS = 0x4c315f44415441n;

/**
 * A first send deploys the account, and the transfer goes once the node shows the deployment
 * executed: polled every `STARKNET_DEPLOY_POLL_MS`, given up after `STARKNET_DEPLOY_TIMEOUT_MS`
 * (a block is a few seconds; the transfer is then left for the next attempt, which finds the
 * account deployed).
 */
export const STARKNET_DEPLOY_POLL_MS = 2_000;
export const STARKNET_DEPLOY_TIMEOUT_MS = 90_000;
