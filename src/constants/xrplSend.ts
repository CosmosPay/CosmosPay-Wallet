/**
 * Paying XRP on the XRP Ledger (`lib/send/xrpl.ts`): the network each mode's node must be, how
 * long a signed payment stays valid, the account flags a payment has to respect and the spelling
 * of an X-address in each mode.
 */
import type { ChainNet } from '@/constants/chains';

/**
 * The `network_id` each mode's node must answer in `server_state` (asked 2026-10-29:
 * xrplcluster.com and s1.ripple.com answer 0, testnet.xrpl-labs.com 1). Networks below 1025 keep
 * the id OUT of the signed transaction (a `NetworkID` field there is `telNETWORK_ID_MAKES_TX_NON_CANONICAL`),
 * so this check is the node's word on which network it serves, and the ledger floor below is
 * what keeps a test payment off the main network.
 */
export const XRPL_NETWORK_ID: Record<ChainNet, number> = { mainnet: 0, testnet: 1 };

/**
 * The main network's validated ledger index on 2026-10-29 (107 984 388). Main-network ledger
 * indexes only grow, so a main-network node must be past it, and a transaction whose
 * `LastLedgerSequence` is below it can never be applied on the main network: a test payment
 * (the test network was at ~21.9M that day, and resets lower) signed by the same key is dead
 * there by construction. A test-network node answering a ledger past the floor is not one.
 */
export const XRPL_MAINNET_LEDGER_FLOOR = 107_984_388;

/**
 * Ledgers after the last validated one a payment may still be applied in (`LastLedgerSequence`).
 * At ~4 s a ledger that is over a minute — time for a queued payment to clear — after which the
 * payment is final either way and can never land late.
 */
export const XRPL_LEDGER_WINDOW = 20;

/** `lsfRequireDestTag`: the account (an exchange's, typically) refuses payments without a destination tag. */
export const XRPL_LSF_REQUIRE_DEST_TAG = 0x0002_0000;

/** `lsfDepositAuth`: the account takes payments only from senders it pre-authorised. */
export const XRPL_LSF_DEPOSIT_AUTH = 0x0100_0000;

/**
 * The two prefix bytes of an X-address (XLS-5d) in each mode: `X…` on the main network, `T…` on
 * a test network. An X-address names its network, so one for the other mode is not a recipient.
 */
export const XRPL_X_ADDRESS_PREFIX: Record<ChainNet, readonly [number, number]> = {
  mainnet: [0x05, 0x44],
  testnet: [0x04, 0x93],
};

/** Every drop that exists (100 billion XRP): the most an XRP `Amount` can carry. */
export const XRPL_MAX_DROPS = 100_000_000_000_000_000n;

/**
 * The `submit` engine results that mean the payment will most likely be in a ledger: applied to
 * the open ledger, or held in the queue for the next ones. Every other result — a `tec` that
 * only burns the fee included — is a failure the person is told about.
 */
export const XRPL_ACCEPTED_RESULTS: readonly string[] = ['tesSUCCESS', 'terQUEUED'];
