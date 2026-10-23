/**
 * Bitcoin spends from the phrase's BIP-84 address: which outputs to spend, what it costs,
 * and the signed transaction.
 *
 * The wallet signs exactly one kind of Bitcoin transaction — a payment it builds itself
 * from its own P2WPKH outputs to one destination, with change (if any) back to the same
 * address. There is no counterparty envelope to check: the decisions that matter are the
 * ones made here, so they are made conservatively and refused rather than stretched:
 *
 *   - the fee rate comes from the node, bounded by `BITCOIN_MIN_FEE_RATE` /
 *     `BITCOIN_MAX_FEE_RATE` — a broken estimator must not spend a fortune quietly;
 *   - confirmed outputs are spent before unconfirmed ones, largest first, at most
 *     `BITCOIN_MAX_INPUTS` of them;
 *   - change below the dust limit is folded into the fee instead of creating an output
 *     every node would refuse to relay;
 *   - the destination is decoded with its checksum for the network it is sent on, so a
 *     testnet address can never receive mainnet coins and a typo is not an address.
 */
import { Address, NETWORK, OutScript, TEST_NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  BITCOIN_DUST_SATS,
  BITCOIN_MAX_FEE_RATE,
  BITCOIN_MAX_INPUTS,
  BITCOIN_MIN_FEE_RATE,
  type ChainNet,
} from '@/constants/chains';
import type { BitcoinUtxo } from '@/lib/chainRpc';

const networkOf = (net: ChainNet) => (net === 'mainnet' ? NETWORK : TEST_NETWORK);

/** Why a Bitcoin spend was not built. Each maps to an `xswap.refused.*` message. */
export type BitcoinRefusal = 'address' | 'funds' | 'fee' | 'dust';

export class BitcoinSpendRefused extends Error {
  readonly code: BitcoinRefusal;
  constructor(code: BitcoinRefusal) {
    super(`bitcoin spend refused: ${code}`);
    this.code = code;
    this.name = 'BitcoinSpendRefused';
  }
}

/** The output script of `address` on `net`, or null when it is not an address there. */
export function bitcoinOutputScript(address: string, net: ChainNet): Uint8Array | null {
  try {
    return OutScript.encode(Address(networkOf(net)).decode(address.trim()));
  } catch {
    return null;
  }
}

/** Whether `address` is a valid Bitcoin address on `net` — checksum and network included. */
export const isBitcoinAddress = (address: string, net: ChainNet = 'mainnet'): boolean =>
  bitcoinOutputScript(address, net) !== null;

/**
 * Virtual size of a spend of `inputs` P2WPKH outputs to outputs whose scripts are
 * `outputScriptLens` bytes long (BIP-141 weight / 4, rounded up). An input is 41 bytes of
 * base data plus a 108-byte witness (item count, a signature of at most 72 bytes and the
 * key, each length-prefixed), 68 vB; the transaction adds 10.5 vB of version, locktime,
 * counts and the SegWit marker. The signature is counted at its longest so a fee is never
 * short of the rate it was meant to pay.
 */
export function spendVsize(inputs: number, outputScriptLens: number[]): number {
  const outputs = outputScriptLens.reduce((sum, len) => sum + 8 + 1 + len, 0);
  const base = 4 + 4 + 1 + 1 + inputs * 41 + outputs; // version, locktime, in/out counts
  const witness = 2 + inputs * 108; // marker + flag, then one witness per input
  return Math.ceil((base * 4 + witness) / 4);
}

/** What a spend will consume and leave. Amounts in sats. */
export interface SpendPlan {
  inputs: BitcoinUtxo[];
  fee: bigint;
  /** Back to our own address; 0 when it would have been dust (then it is part of `fee`). */
  change: bigint;
  vsize: number;
}

/** A P2WPKH output script is 22 bytes: OP_0, push 20, the key hash. */
const P2WPKH_SCRIPT_LEN = 22;

/**
 * Choose the outputs to spend for `amount` to a destination whose script is `destLen`
 * bytes, at `feeRate` sat/vB. Throws `BitcoinSpendRefused` when the rate is out of bounds,
 * the amount is dust, or the outputs cannot cover the amount and its fee.
 */
export function planSpend(utxos: BitcoinUtxo[], amount: bigint, feeRate: number, destLen: number): SpendPlan {
  if (!Number.isFinite(feeRate) || feeRate > BITCOIN_MAX_FEE_RATE) throw new BitcoinSpendRefused('fee');
  const rate = Math.max(BITCOIN_MIN_FEE_RATE, Math.ceil(feeRate));
  if (amount < BITCOIN_DUST_SATS * 2n) throw new BitcoinSpendRefused('dust');

  // Confirmed first, then largest first: fewer inputs is a smaller fee, and an
  // unconfirmed parent is a spend that can be replaced out from under this one.
  const ordered = [...utxos].sort((a, b) =>
    a.confirmed !== b.confirmed ? (a.confirmed ? -1 : 1) : a.value > b.value ? -1 : a.value < b.value ? 1 : 0,
  );
  const chosen: BitcoinUtxo[] = [];
  let total = 0n;
  for (const u of ordered) {
    if (chosen.length >= BITCOIN_MAX_INPUTS) break;
    chosen.push(u);
    total += u.value;

    const withChange = spendVsize(chosen.length, [destLen, P2WPKH_SCRIPT_LEN]);
    const feeWithChange = BigInt(withChange * rate);
    if (total >= amount + feeWithChange) {
      const change = total - amount - feeWithChange;
      if (change >= BITCOIN_DUST_SATS) return { inputs: chosen, fee: feeWithChange, change, vsize: withChange };
    }
    const noChange = spendVsize(chosen.length, [destLen]);
    const feeNoChange = BigInt(noChange * rate);
    if (total >= amount + feeNoChange) {
      // What is left over is below dust: it goes to the miner rather than to an output
      // no node would relay.
      return { inputs: chosen, fee: total - amount, change: 0n, vsize: noChange };
    }
  }
  throw new BitcoinSpendRefused('funds');
}

/** The most that can be sent from `utxos` at `feeRate` with no change: everything, less its fee. */
export function maxSendable(utxos: BitcoinUtxo[], feeRate: number, destLen = P2WPKH_SCRIPT_LEN): bigint {
  const spendable = [...utxos].sort((a, b) => (a.value > b.value ? -1 : 1)).slice(0, BITCOIN_MAX_INPUTS);
  const total = spendable.reduce((s, u) => s + u.value, 0n);
  const rate = Math.max(BITCOIN_MIN_FEE_RATE, Math.ceil(feeRate));
  const fee = BigInt(spendVsize(spendable.length, [destLen]) * rate);
  return total > fee ? total - fee : 0n;
}

/**
 * Build and sign a payment of `amount` sats from `owner` (our P2WPKH address, whose key is
 * `secret`) to `to`, on `net`. Answers the raw transaction (hex), its txid and the plan it
 * followed.
 */
export function signBitcoinPayment(p: {
  utxos: BitcoinUtxo[];
  secret: Uint8Array;
  owner: string;
  to: string;
  amount: bigint;
  feeRate: number;
  net: ChainNet;
}): { hex: string; txid: string; plan: SpendPlan } {
  const network = networkOf(p.net);
  const destScript = bitcoinOutputScript(p.to, p.net);
  if (!destScript) throw new BitcoinSpendRefused('address');
  const ours = p2wpkh(secp256k1.getPublicKey(p.secret, true), network);
  // The key must be the one behind the address on screen — `chainSecret` checked it, and
  // this is the same check at the point of use.
  if (ours.address !== p.owner) throw new BitcoinSpendRefused('address');

  const plan = planSpend(p.utxos, p.amount, p.feeRate, destScript.length);
  const tx = new Transaction();
  for (const u of plan.inputs) {
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: ours.script, amount: u.value } });
  }
  tx.addOutput({ script: destScript, amount: p.amount });
  if (plan.change > 0n) tx.addOutput({ script: ours.script, amount: plan.change });
  tx.sign(p.secret);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, plan };
}
