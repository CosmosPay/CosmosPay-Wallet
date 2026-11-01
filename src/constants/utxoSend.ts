/**
 * Sending on the Bitcoin-family networks (`lib/send/utxo.ts`): Bitcoin, Litecoin, Dogecoin, Dash
 * and Bitcoin Cash. What each network's node must prove it is, where its coins are listed and
 * relayed, how its addresses are spelled, and the policy numbers its nodes relay by — all read
 * here as a set, so a limit is never a literal in the middle of the signer.
 *
 * Every endpoint is public, keyless and answers a browser (CORS), probed 2026-10-29:
 *  - Bitcoin and Litecoin: the Esplora API of `def.balance` (mempool.space, litecoinspace.org and
 *    their test networks) — `/block-height/0`, `/address/{a}/utxo`, `/v1/fees/recommended`, and
 *    `POST /tx` sent as `text/plain` (a CORS "simple" request: their `OPTIONS /tx` answers 404,
 *    so a preflighted POST would never leave the browser).
 *  - Dogecoin and Dash: BlockCypher — the chain's own document (its name and fee per kB),
 *    `addrs/{a}?unspentOnly&includeScript`, and `POST txs/push` (preflight answered 200).
 *  - Bitcoin Cash: BitPay's Bitcore API. Blockchair, which reads the balance, blacklisted the
 *    probing IP with HTTP 430 after a handful of keyless requests and asks for a key to go on,
 *    so its keyless push is not one a send can count on; Bitcore lists the coins with their
 *    scripts and relays (`POST /tx/send`, preflight answered 204) with no key.
 */
import type { ChainNet } from '@/constants/chains';

/** The networks `lib/send/utxo.ts` pays on (Zcash has its own sender). */
export const UTXO_SEND_NETWORKS = ['btc', 'ltc', 'doge', 'dash', 'bch'] as const;
export type UtxoNetworkId = (typeof UTXO_SEND_NETWORKS)[number];

/** How a recipient is written on a network in one mode: base58check versions, and segwit's HRP. */
export interface UtxoAddressFormat {
  /** base58check version byte of a P2PKH address. */
  p2pkh: number;
  /** base58check version byte of a P2SH address. */
  p2sh: number;
  /** The bech32/bech32m human-readable part, where the network has native segwit. */
  hrp?: string;
  /** The cashaddr prefix, where the network writes cashaddr (Bitcoin Cash). */
  cashaddr?: string;
}

/**
 * Each network's address formats per mode; a mode missing here has no test network to pay on.
 * Litecoin's P2SH is its own `M…` (`Q…` on its test network): Litecoin Core still decodes the
 * `3…` version it shared with Bitcoin until 2017, but a `3…` typed into a Litecoin send is far
 * more likely a Bitcoin address pasted on the wrong network than a Litecoin one, and Trust
 * Wallet (whose paths these are) refuses it too. Bitcoin Cash keeps Bitcoin's legacy versions
 * beside cashaddr: both name the same scripts there.
 */
export const UTXO_ADDRESS_FORMATS: Record<UtxoNetworkId, Partial<Record<ChainNet, UtxoAddressFormat>>> = {
  btc: {
    mainnet: { p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' },
    testnet: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
  },
  ltc: {
    mainnet: { p2pkh: 0x30, p2sh: 0x32, hrp: 'ltc' },
    testnet: { p2pkh: 0x6f, p2sh: 0x3a, hrp: 'tltc' },
  },
  doge: { mainnet: { p2pkh: 0x1e, p2sh: 0x16 } },
  dash: { mainnet: { p2pkh: 0x4c, p2sh: 0x10 } },
  bch: { mainnet: { p2pkh: 0x00, p2sh: 0x05, cashaddr: 'bitcoincash' } },
};

/**
 * The hash Esplora answers at `/block-height/0`: the network's genesis block, asked of the node
 * before anything is signed (asked 2026-10-29: Bitcoin, Bitcoin Testnet4, Litecoin, Litecoin's
 * testnet4 — each the value its own chain parameters hard-code).
 */
export const ESPLORA_GENESIS_HASH: Record<'btc' | 'ltc', Record<ChainNet, string>> = {
  btc: {
    mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    testnet: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  },
  ltc: {
    mainnet: '12a765e31ffd4059bada1e25190f6e98c99d9714d334efa41a195a7e7e04bfe2',
    testnet: '4966625a4b2851d9fdee139e56211a0d88575f59ed816ff5e6a63deb4e3e29a0',
  },
};

/** BlockCypher's API root; a chain is `{root}/{coin}/main`. */
export const BLOCKCYPHER_API = 'https://api.blockcypher.com/v1';

/** The `name` BlockCypher's chain document must carry before anything is signed. */
export const BLOCKCYPHER_CHAIN_NAME: Record<'doge' | 'dash', string> = {
  doge: 'DOGE.main',
  dash: 'DASH.main',
};

/** The most unspent outputs one BlockCypher address request returns (its documented ceiling). */
export const BLOCKCYPHER_UTXO_LIMIT = 2000;

/**
 * The least time between two BlockCypher requests of one send: its keyless tier takes 3 requests
 * a second (and 100 an hour), and a Dogecoin or Dash send makes one per distinct transaction it
 * spends from, besides the chain, the coins and the relay.
 */
export const BLOCKCYPHER_PACE_MS = 400;

/** Bitcore's Bitcoin Cash API (`chain: 'BCH'`, `network: 'mainnet'` on every answer). */
export const BCH_BITCORE_API = 'https://api.bitcore.io/api/BCH/mainnet';

/**
 * A Bitcoin Cash block past every split of its chain — from Bitcoin (478 559, 2017), Bitcoin SV
 * (556 767, 2018) and eCash (661 648, 2020): this is BCHN's block at the last of them, so only a
 * node following Bitcoin Cash itself answers it (asked of Bitcore 2026-10-29).
 */
export const BCH_CHECKPOINT = {
  height: 661_648,
  hash: '0000000000000000029e471c41818d24b8b74c911071c4ef0b4a0509f9b5a8ce',
} as const;

/** Bitcore's fee estimate target, in blocks. */
export const BCH_FEE_TARGET_BLOCKS = 2;

/** The most unspent outputs one Bitcore address request asks for. */
export const BCH_UTXO_LIMIT = 1000;

/** One request to a UTXO network's API, end to end. */
export const UTXO_REQUEST_TIMEOUT_MS = 20_000;

/**
 * The transaction version each network's wallets write. Version 2 where BIP68 is part of the
 * rules (it changes nothing at a final sequence); Dogecoin stays on 1, what Dogecoin Core writes.
 */
export const UTXO_TX_VERSION: Record<UtxoNetworkId, number> = { btc: 2, ltc: 2, doge: 1, dash: 2, bch: 2 };

/**
 * Each input's nSequence. Bitcoin and Litecoin signal replace-by-fee (BIP125), so a send stuck at
 * a low rate can be bumped by any wallet holding the phrase; the others have no RBF to signal.
 */
export const UTXO_SEQUENCE: Record<UtxoNetworkId, number> = {
  btc: 0xfffffffd,
  ltc: 0xfffffffd,
  doge: 0xffffffff,
  dash: 0xffffffff,
  bch: 0xffffffff,
};

/**
 * The largest transaction these networks' nodes relay, in (virtual) bytes: Bitcoin Core's
 * 400 000 weight units, and the 100 000-byte standard size of Litecoin, Dogecoin, Dash and BCHN.
 */
export const UTXO_MAX_STANDARD_VSIZE = 100_000;

/** SIGHASH_ALL: every input and every output signed. */
export const SIGHASH_ALL = 0x01;
/** Bitcoin Cash's SIGHASH_FORKID bit: the BIP143-style digest, which Bitcoin's rules reject. */
export const SIGHASH_FORKID = 0x40;

/**
 * The lowest fee rate a send pays, in minor units per 1000 (virtual) bytes, whatever the node
 * estimates: each network's default minimum relay fee, so the transaction propagates beyond the
 * node that took it. Dogecoin's is its recommended 0.01 DOGE/kB (Dogecoin Core 1.14.4+), the
 * rate its nodes and miners actually take.
 */
export const UTXO_FEE_FLOOR_PER_KB: Record<UtxoNetworkId, bigint> = {
  btc: 1_000n,
  ltc: 1_000n,
  doge: 1_000_000n,
  dash: 1_000n,
  bch: 1_000n,
};

/**
 * The dust relay fee (minor units per 1000 bytes) a node prices an output's dust threshold with:
 * an output worth less than spending it would cost at this rate is non-standard and not relayed
 * (Bitcoin Core `GetDustThreshold`; Litecoin, Dash and BCHN keep the same 3000).
 */
export const UTXO_DUST_RELAY_PER_KB = 3_000n;

/** The bytes spending an output adds, as `GetDustThreshold` counts them: a legacy input, a witness one. */
export const UTXO_DUST_SPEND_BYTES = { legacy: 148n, witness: 67n } as const;

/**
 * Dogecoin's dust limit is a flat amount instead (0.01 DOGE, Dogecoin Core 1.14.5+): an output
 * below it costs an extra 0.01 DOGE of fee, one below 0.001 DOGE is refused. A send never writes
 * one — neither the payment nor the change.
 */
export const DOGE_DUST_LIMIT = 1_000_000n;
