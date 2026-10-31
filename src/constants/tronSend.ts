/**
 * Paying TRX and Tron's USDT (`lib/send/tron.ts`): the network each mode's node must be, how long
 * a signed transaction stays valid, and the resource prices the wallet will not believe a node
 * below.
 */
import type { ChainNet } from '@/constants/chains';

/**
 * Block 0's id on each mode's network, as `/wallet/getblock` answers it for `id_or_num: "0"`
 * (asked 2026-10-29: api.trongrid.io for the main network, nile.trongrid.io for Nile). A node
 * serving another chain fails the check before anything is signed; the reference block every
 * transaction carries is what binds the signature to the chain itself.
 */
export const TRON_GENESIS_BLOCK_ID: Record<ChainNet, string> = {
  mainnet: '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc',
  testnet: '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc',
};

/**
 * How long after its reference block a transaction may still be included, in milliseconds —
 * what java-tron's own builder gives one (60 s, twenty 3-second blocks). Past it the transaction
 * can never land.
 */
export const TRON_EXPIRATION_MS = 60_000;

/**
 * The chain parameters a cost is computed with, in sun, never taken lower than these (both
 * networks answered exactly these in `/wallet/getchainparameters` on 2026-10-29). Bandwidth and an
 * account's activation are not capped by `fee_limit`; a node under-reporting their price would
 * let a transaction past the `maxFee` check that the chain then charges more for. A governance
 * raise is taken from the node as it comes.
 */
export const TRON_MIN_CHAIN_PARAMS = {
  /** `getTransactionFee`: sun burned per byte when the account has no bandwidth left. */
  transactionFee: 1_000n,
  /** `getEnergyFee`: sun per unit of energy. */
  energyFee: 100n,
  /** `getCreateAccountFee`: burned for a new recipient when no staked bandwidth pays for it. */
  createAccountFee: 100_000n,
  /** `getCreateNewAccountFeeInSystemContract`: what activating a recipient by a TRX transfer costs on top. */
  createNewAccountFeeInSystemContract: 1_000_000n,
} as const;

/**
 * Energy a token transfer is given over the node's estimate (`triggerconstantcontract`), in
 * percent. The estimate is exact for the state it ran on, but USDT's dynamic-energy factor moves
 * every maintenance cycle and the recipient's balance can change before inclusion; a transfer
 * that runs out of energy fails and still burns what it used.
 */
export const TRON_ENERGY_HEADROOM_PCT = 120n;

/**
 * Bytes java-tron adds to a transaction's size per contract when it charges bandwidth
 * (`MAX_RESULT_SIZE_IN_TX`): room for the result it stores with the transaction.
 */
export const TRON_RESULT_BYTES = 64;

/**
 * TronGrid without an API key answers 3 requests a second per caller and, past that, refuses the
 * caller for 4 s with a 429 ("allowed_rps(3) … suspended for 4 s", 2026-10-29). A send's 7–8
 * requests start at least this far apart, which keeps it under that rate by itself.
 */
export const TRON_REQUEST_GAP_MS = 400;

/** After a 429 — the balance reader shares the rate — a request waits out the suspension, then is asked again. */
export const TRON_RATE_LIMITED_WAIT_MS = 4_500;

/** How many times one request is asked again after a 429 before the send gives up. */
export const TRON_RATE_LIMIT_RETRIES = 2;
