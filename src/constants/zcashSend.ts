/**
 * Sending on Zcash (`lib/send/zcash.ts`), transparent only: what the node must prove it is, the
 * network upgrades a signature is bound to, where the coins are listed, and the policy numbers
 * Zcash nodes relay by — read here as a set, so no limit is a literal in the middle of the signer.
 *
 * Every endpoint is public, keyless and answers a browser (CORS), probed 2026-10-29:
 *  - The node: Tatum's anonymous Zcash gateway, a Zebra node (it lists NU7 as pending, so it
 *    follows the network past that upgrade). `getblockchaininfo`, `getblockhash` and
 *    `sendrawtransaction`; its preflight answers 204 and reflects the origin, extension pages
 *    included. Anonymous use is 5 requests a minute per IP and no batches: a send asks it 3 times.
 *    It does NOT serve the address index (`getaddressutxos` is "method not found"), so the coins
 *    are listed elsewhere.
 *  - The coins: Blockchair's address dashboard (the balance's source, `NETWORKS.zec.balance`),
 *    and, when Blockchair refuses (its per-IP 430 blacklist, seen on the probing IP that day), the
 *    Zelcore Insight explorer's `/addr/{a}/utxo` (`Access-Control-Allow-Origin: *`). Neither is
 *    trusted for anything: a v5 signature commits to every spent coin's amount and script
 *    (ZIP-244), so a list that lies yields a transaction no node accepts, never a different fee.
 */

/** The Zebra node a send is checked against and relayed through (JSON-RPC over POST). */
export const ZCASH_NODE_RPC = 'https://zcash-mainnet.gateway.tatum.io';

/** Blockchair's Zcash API root; the coins are `{root}/dashboards/address/{a}` (`utxo`). */
export const ZCASH_BLOCKCHAIR_API = 'https://api.blockchair.com/zcash';

/** The Insight API the coins are listed from when Blockchair will not answer. */
export const ZCASH_INSIGHT_API = 'https://explorer.zec.zelcore.io/api';

/** One request to any of the above, end to end. */
export const ZCASH_REQUEST_TIMEOUT_MS = 20_000;

/** `getblockhash 0` of Zcash Mainnet: its genesis block, asked of the node before anything is signed. */
export const ZCASH_GENESIS_HASH = '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08';

/** `getblockchaininfo.chain` of Zcash Mainnet. */
export const ZCASH_CHAIN_NAME = 'main';

/** One network upgrade a v5 transaction can be signed for (ZIP-200). */
export interface ZcashUpgrade {
  name: string;
  /** Mainnet activation height: the first block the upgrade's rules apply to. */
  height: number;
  /** CONSENSUS_BRANCH_ID: signed into every v5 transaction mined at or past `height`. */
  branchId: number;
  /** Blocks from the target height to the default nExpiryHeight (ZIP-203; ZIP-218 from NU7). */
  expiryDelta: number;
}

/**
 * Every Mainnet upgrade since NU5, where version 5 transactions begin (ZIP-225), oldest first:
 * NU5 (ZIP-252), NU6 (ZIP-253), NU6.1 (ZIP-255), NU6.2 (ZIP-257), NU6.3 (ZIP-258), NU7 (ZIP-259,
 * scheduled by Zebra 7.0.0). The same numbers as Zebra's `network_upgrade.rs`/`constants.rs`.
 * Version 5 stays valid through all of them, NU7 included (only v4 ends there).
 *
 * A signature commits to the branch id of the block it is mined in, so a send at a height past an
 * upgrade this table lacks would never be valid: the signer refuses when the node's
 * `consensus.nextblock` is not this table's branch for that height. Add each new upgrade here
 * (height and branch id from its deployment ZIP) before it activates.
 */
export const ZCASH_UPGRADES: readonly ZcashUpgrade[] = [
  { name: 'NU5', height: 1_687_104, branchId: 0xc2d6d0b4, expiryDelta: 40 },
  { name: 'NU6', height: 2_726_400, branchId: 0xc8e71055, expiryDelta: 40 },
  { name: 'NU6.1', height: 3_146_400, branchId: 0x4dec4df0, expiryDelta: 40 },
  { name: 'NU6.2', height: 3_364_600, branchId: 0x5437f330, expiryDelta: 40 },
  { name: 'NU6.3', height: 3_428_143, branchId: 0x37a5165b, expiryDelta: 40 },
  // Blocks every 25 s instead of 75 s: ZIP-218 triples the default delta to keep ~50 minutes.
  { name: 'NU7', height: 3_543_405, branchId: 0x77190ad9, expiryDelta: 120 },
];

/**
 * zcashd's TX_EXPIRING_SOON_THRESHOLD (unchanged by ZIP-218): a node refuses a transaction that
 * expires within this many blocks of the next one, so one capped just before an upgrade's
 * activation must still leave at least this much room.
 */
export const ZCASH_EXPIRING_SOON_THRESHOLD = 3;

/** The v5 header (ZIP-225): fOverwintered ‖ nVersion 5, and its nVersionGroupId. */
export const ZCASH_V5_HEADER = 0x80000005;
export const ZCASH_V5_VERSION_GROUP_ID = 0x26a7270a;

/**
 * Every input's nSequence: final. Zcash has no replace-by-fee to signal and no relative locks,
 * and nLockTime is 0, so the transaction is valid from the next block until its expiry height.
 */
export const ZCASH_SEQUENCE = 0xffffffff;

/**
 * ZIP-317's conventional fee: `marginal_fee × max(grace_actions, logical_actions)`, where a
 * transparent logical action is each started 150 bytes of inputs or 34 bytes of outputs. Paying it
 * leaves no "unpaid action", which both zcashd and Zebra require to relay. (zcash/zips#1352
 * proposes a marginal fee of 1000, and Zebra 7 already relays at that; the ZIP still says 5000,
 * which every node relays, so 5000 it is until the ZIP changes.)
 */
export const ZIP317_MARGINAL_FEE = 5_000n;
export const ZIP317_GRACE_ACTIONS = 2;
export const ZIP317_P2PKH_STANDARD_INPUT_SIZE = 150;
export const ZIP317_P2PKH_STANDARD_OUTPUT_SIZE = 34;

/**
 * The most a signed P2PKH input serializes to: outpoint 36 + script length 1 + scriptSig
 * (push 72: a low-S DER signature of at most 71 bytes and its sighash byte; push 33: the
 * compressed key) 107 + nSequence 4. The fee is counted on this before signing, so it never
 * comes out below ZIP-317's figure for the bytes actually signed.
 */
export const ZCASH_P2PKH_INPUT_MAX_SIZE = 148;

/**
 * The dust rule zcashd and Zebra relay by (`CTxOut::GetDustThreshold`, Zebra's
 * `Output::is_dust`): an output is dust below `3 × (100 × (its size + 148) / 1000)` zatoshis, in
 * integer arithmetic — 54 for both a P2PKH (34-byte) and a P2SH (32-byte) output.
 */
export const ZCASH_DUST_RATE_PER_KB = 100;

/** A coinbase output is spendable once it has this many confirmations (protocol § 7.1). */
export const ZCASH_COINBASE_MATURITY = 100;

/**
 * The most inputs one send spends: 500 × 148 bytes stays under zcashd's 100 000-byte standard
 * transaction size. The fee cap usually binds far earlier (each input is a logical action).
 */
export const ZCASH_MAX_INPUTS = 500;

/** base58check version bytes of a Mainnet transparent address: P2PKH `t1…`, P2SH `t3…`. */
export const ZEC_P2SH_VERSION = [0x1c, 0xbd] as const;

/** ZIP-320's Mainnet TEX address (a P2PKH key hash in bech32m), which exchanges ask deposits to. */
export const ZCASH_TEX_HRP = 'tex';
