/**
 * Paying ADA on Cardano (`lib/send/cardano.ts`): where each mode reads and submits, what each
 * mode's network must prove it is, and the protocol constants a transfer is built with.
 *
 * Two keyless services, both open to a browser (CORS), probed 2026-10-29 from a page in Chromium:
 *
 * - **Koios' Ogmios pass-through** (`/api/v1/ogmios`, JSON-RPC 2.0, Ogmios v6): the network's
 *   genesis (its magic), the tip, the protocol parameters, and `submitTransaction`. Koios' REST
 *   endpoints (`/tip`, `/genesis`, `/address_info`, `/address_utxos`, `/epoch_params`) are NOT
 *   usable from a page: their answers carry no `Access-Control-Allow-Origin` (only the preflight
 *   does), so the browser blocks every one. The pass-through's answers do carry it. Koios drops
 *   `queryLedgerState/utxo` there ("not supported off public tier"), hence the second service.
 * - **EMURGO's Yoroi backend** (`/api`, the one the Yoroi wallets use): an address's UTXOs and
 *   its balance, and a reference-block check for which network it indexes. It reflects any
 *   origin. It has no protocol parameters and its preprod instance does not take submissions.
 */
import type { ChainNet } from '@/constants/chains';

export interface CardanoEndpoints {
  /** Koios' Ogmios pass-through: genesis, tip, protocol parameters, submission. */
  ogmios: string;
  /** The Yoroi backend's API root: UTXOs and balances. */
  yoroi: string;
}

/** Each mode's services. The test network is Preprod, the long-lived public one (magic 1). */
export const CARDANO_ENDPOINTS: Record<ChainNet, CardanoEndpoints> = {
  mainnet: { ogmios: 'https://api.koios.rest/api/v1/ogmios', yoroi: 'https://api.yoroiwallet.com/api' },
  testnet: { ogmios: 'https://preprod.koios.rest/api/v1/ogmios', yoroi: 'https://preprod-backend.yoroiwallet.com/api' },
};

/**
 * The network magic each mode's node must answer in its Shelley genesis
 * (`queryNetwork/genesisConfiguration`, asked 2026-10-29: 764824073 on mainnet, 1 on Preprod).
 */
export const CARDANO_NETWORK_MAGIC: Record<ChainNet, number> = { mainnet: 764_824_073, testnet: 1 };

/**
 * The network id an address's header carries (CIP-19) and a transaction body's field 15 states:
 * 1 on mainnet, 0 on every test network. The ledger refuses a body whose id is not its own
 * (`WrongNetworkInTxBody`), so stating it binds the signature to mainnet or to the test networks.
 */
export const CARDANO_NETWORK_ID: Record<ChainNet, number> = { mainnet: 1, testnet: 0 };

/** The bech32 prefix of a payment address in each mode (CIP-5). */
export const CARDANO_ADDRESS_HRP: Record<ChainNet, string> = { mainnet: 'addr', testnet: 'addr_test' };

/**
 * The first Shelley block of each network (mainnet height 4 490 511, slot 4 492 800; Preprod
 * height 46, slot 86 400 — read 2026-10-29). The Yoroi backend is asked whether this block is on
 * the chain it indexes (`v2/tipStatus` with it as the reference); a backend of another network
 * answers `REFERENCE_POINT_BLOCK_NOT_FOUND`, as both did for each other's block that day.
 */
export const CARDANO_REFERENCE_BLOCK: Record<ChainNet, string> = {
  mainnet: 'aa83acbf5904c0edfe4d79b3689d3d00fcfc553cf360fd2229b98d464c28e9de',
  testnet: 'c971bfb21d2732457f9febf79d9b02b20b9a3bef12c561a78b818bcb8b35a574',
};

/**
 * The Byron protocol magic a Byron address names in each mode. A mainnet Byron address carries
 * none (attribute 2 absent); a test network's carries its magic, Preprod's being 1.
 */
export const CARDANO_BYRON_MAGIC: Record<ChainNet, number | null> = { mainnet: null, testnet: 1 };

/**
 * How long a signed transfer stays valid: its `ttl` is the tip's slot plus this. Slots are one
 * second on both networks, so two hours — time for a congested mempool — after which the
 * transfer is final either way and can never land late.
 */
export const CARDANO_TTL_SLOTS = 7_200;

/**
 * The bytes the ledger adds to an output's own size when it prices the minimum ADA it must hold
 * (Babbage onwards: `coinsPerUTxOByte × (160 + size)`). A ledger constant, not a parameter.
 */
export const CARDANO_UTXO_OVERHEAD_BYTES = 160n;

/** One request to either service, end to end. */
export const CARDANO_REQUEST_TIMEOUT_MS = 15_000;
