/**
 * Paying from the other chains: the balances the swap screen shows, and the things the
 * wallet signs there — a Jupiter swap (Solana), a Kuru Flow swap with its approval (Monad),
 * a deposit into a NEAR Intents address (every chain), and a plain transfer.
 *
 * Every function that signs checks first, and refuses with a `ChainSwapRefused` whose
 * `code` the store turns into a message. Nothing here reaches the gateway: the store
 * fetches what the gateway built and hands back what was signed.
 */
import { base64 } from '@scure/base';
import {
  CHAIN_CONFIRM_POLL_MS,
  CHAIN_CONFIRM_TIMEOUT_MS,
  CHAIN_TOKENS_BY_NET,
  EVM_BASE_FEE_MULTIPLIER,
  EVM_CHAIN_IDS,
  EVM_GAS_HEADROOM_PCT,
  MONAD_CHAIN_ID,
  NATIVE_RESERVE,
  SOLANA_MAX_READ_ACCOUNTS,
  SOLANA_RENT_EXEMPT_LAMPORTS,
  isEvmChain,
  type ChainNet,
  type EvmChain,
  type OtherChain,
} from '@/constants/chains';
import {
  bitcoinBalance,
  bitcoinBroadcast,
  bitcoinFeeRate,
  bitcoinUtxos,
  evmBalance,
  evmChainId,
  evmEstimateGas,
  evmFees,
  evmNonce,
  evmReceipt,
  evmSend,
  evmTokenBalance,
  solanaAccounts,
  solanaBlockhash,
  solanaLamports,
  solanaMintProgram,
  solanaSend,
  solanaSimulate,
  solanaTokenBalances,
} from '@/lib/chainRpc';
import { BitcoinSpendRefused, isBitcoinAddress, signBitcoinPayment } from '@/lib/bitcoinTx';
import { checkMonadSwapCalls, isEvmAddress, signEip1559, transferCalldata, type EvmCall } from '@/lib/evmTx';
import {
  checkSwapEffects,
  isSolanaAddress,
  lookupTableAddresses,
  messageAccounts,
  parseSolanaTx,
  signSolanaTx,
  solTransferTx,
  splTransferTx,
} from '@/lib/solanaTx';

/** Why the wallet would not sign. Each maps to an `xswap.refused.*` message. */
export type ChainSwapRefusalCode =
  | 'authority' // a Solana swap would hand over an account or a token account
  | 'drain' // it would take more than the amount confirmed
  | 'short' // it would deliver less than the quote's minimum
  | 'simulation' // the node could not run it at all
  | 'chain' // an EVM call for another chain, or the node is not the chain it claims
  | 'testnetNode' // the node configured for a test network is not that test network
  | 'rent' // a SOL transfer would open an account with less than rent exemption
  | 'value' // a Monad swap sending more MON than confirmed
  | 'approval' // an approval that is not exactly (router, amount)
  | 'address' // a destination that is not an address on that chain (and network)
  | 'timeout' // the approval did not land in time
  | 'funds' // a Bitcoin payment its outputs cannot cover, fee included
  | 'fee' // a Bitcoin fee rate outside the bounds the wallet will pay
  | 'dust'; // a Bitcoin payment too small to be relayed

export class ChainSwapRefused extends Error {
  readonly code: ChainSwapRefusalCode;
  constructor(code: ChainSwapRefusalCode) {
    super(`chain swap refused: ${code}`);
    this.code = code;
    this.name = 'ChainSwapRefused';
  }
}

/**
 * Base-unit balance of each token offered on `chain`'s `net`, keyed by `asset`. On a
 * test network an EVM node is asked which chain it serves first: an override pointed at
 * mainnet would otherwise show real coins on a card that calls them test coins.
 */
export async function chainBalances(chain: OtherChain, owner: string, net: ChainNet = 'mainnet'): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  const tokens = CHAIN_TOKENS_BY_NET[net][chain];
  if (chain === 'bitcoin') {
    out.native = await bitcoinBalance(owner, net);
    return out;
  }
  if (chain === 'solana') {
    const mints = tokens.filter((t) => t.asset !== 'native').map((t) => t.asset);
    const [lamports, held] = await Promise.all([solanaLamports(owner, net), solanaTokenBalances(owner, mints, net)]);
    for (const t of tokens) out[t.asset] = t.asset === 'native' ? lamports : held[t.asset] ?? 0n;
    return out;
  }
  if (net === 'testnet') await assertEvmNode(chain, net);
  await Promise.all(
    tokens.map(async (t) => {
      out[t.asset] = t.asset === 'native' ? await evmBalance(chain, owner, net) : await evmTokenBalance(chain, t.asset, owner, net);
    }),
  );
  return out;
}

/**
 * Whether `address` is an address on `chain` — the predicate a screen and the signer share.
 * A Bitcoin address is checked for the network it would be paid on: a `tb1…` address is not
 * a mainnet address and a `bc1…` one is not a testnet address.
 */
export function isChainAddress(chain: OtherChain, address: string, net: ChainNet = 'mainnet'): boolean {
  if (chain === 'bitcoin') return isBitcoinAddress(address, net);
  return chain === 'solana' ? isSolanaAddress(address) : isEvmAddress(address);
}

/** What may be sold: the balance, less the fee reserve when it is the native coin. */
export function spendable(chain: OtherChain, asset: string, balance: bigint): bigint {
  if (asset !== 'native') return balance;
  const left = balance - NATIVE_RESERVE[chain];
  return left > 0n ? left : 0n;
}

/* --------------------------------- Solana -------------------------------- */

/**
 * Every account the transaction may write to: its writable static keys plus the
 * writable entries it loads from address lookup tables (read from the chain).
 */
async function writableAccounts(message: Uint8Array): Promise<Set<string>> {
  const { writable, lookups } = messageAccounts(message);
  const out = new Set(writable);
  if (lookups.length) {
    const tables = await solanaAccounts(lookups.map((l) => l.table));
    for (const l of lookups) {
      const table = tables.get(l.table);
      if (!table) throw new ChainSwapRefused('simulation');
      const entries = lookupTableAddresses(table.data);
      for (const i of l.writable) {
        if (i >= entries.length) throw new ChainSwapRefused('simulation');
        out.add(entries[i]);
      }
    }
  }
  return out;
}

/**
 * Check a Jupiter swap by simulating it with every account it may write to in view, then
 * sign it. Every one, not a listing of ours: `checkSwapEffects` keeps the wallet and the
 * token accounts it owns and ignores the pools', so reading them all also covers an account
 * of ours no listing would have named — and needs no `getTokenAccountsByOwner`, which the
 * public mainnet node refuses. An account the transaction cannot write to cannot change. `sell` / `buy` are `native` or a mint; `amount` and `minimum` are base units — the
 * amount typed and the minimum the confirmed QUOTE showed, not the create response's.
 * Answers the signed wire bytes, base64.
 */
export async function signSolanaSwap(p: {
  wire: string;
  secret: Uint8Array;
  owner: string;
  sell: string;
  buy: string;
  amount: bigint;
  minimum: bigint;
}): Promise<string> {
  const wire = base64.decode(p.wire);
  let writable: Set<string>;
  try {
    writable = await writableAccounts(parseSolanaTx(wire).message);
  } catch (e) {
    if (e instanceof ChainSwapRefused) throw e;
    throw new ChainSwapRefused('simulation');
  }
  // The fee payer first; then everything else the transaction may write.
  const list = [p.owner, ...[...writable].filter((a) => a !== p.owner)];
  if (list.length > SOLANA_MAX_READ_ACCOUNTS) throw new ChainSwapRefused('simulation');
  const [pre, sim] = await Promise.all([solanaAccounts(list), solanaSimulate(wire, list)]);
  if (sim.err) throw new ChainSwapRefused('simulation');
  const refusal = checkSwapEffects(
    {
      owner: p.owner,
      sell: { asset: p.sell, amount: p.amount },
      buy: { asset: p.buy, minimum: p.minimum },
      lamportAllowance: NATIVE_RESERVE.solana,
    },
    pre,
    sim.accounts,
  );
  if (refusal) throw new ChainSwapRefused(refusal);
  let signed: Uint8Array;
  try {
    signed = signSolanaTx(wire, p.secret, p.owner).signed;
  } catch {
    throw new ChainSwapRefused('authority');
  }
  return base64.encode(signed);
}

/* ---------------------------------- EVM ---------------------------------- */

/** The node must serve the chain `net` names; the signature is bound to that chain id too. */
async function assertEvmNode(chain: EvmChain, net: ChainNet = 'mainnet'): Promise<void> {
  if ((await evmChainId(chain, net)) !== EVM_CHAIN_IDS[net][chain]) {
    throw new ChainSwapRefused(net === 'mainnet' ? 'chain' : 'testnetNode');
  }
}

/** Sign one call on `chain` as an EIP-1559 transaction at the node's current fees and our nonce. */
async function signEvmCall(
  chain: EvmChain,
  call: { to: string; data: string; value: bigint },
  secret: Uint8Array,
  owner: string,
  net: ChainNet = 'mainnet',
) {
  const [n, fees, gas] = await Promise.all([
    evmNonce(chain, owner, net),
    evmFees(chain, net),
    evmEstimateGas(chain, { from: owner, ...call }, net),
  ]);
  return signEip1559(
    {
      chainId: EVM_CHAIN_IDS[net][chain],
      nonce: n,
      maxPriorityFeePerGas: fees.tip,
      maxFeePerGas: fees.baseFee * EVM_BASE_FEE_MULTIPLIER + fees.tip,
      gasLimit: (gas * EVM_GAS_HEADROOM_PCT) / 100n,
      to: call.to,
      value: call.value,
      data: call.data,
    },
    secret,
  );
}

async function waitForReceipt(chain: EvmChain, hash: string): Promise<void> {
  const deadline = Date.now() + CHAIN_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ok = await evmReceipt(chain, hash);
    if (ok === true) return;
    if (ok === false) throw new ChainSwapRefused('approval');
    await new Promise((r) => setTimeout(r, CHAIN_CONFIRM_POLL_MS));
  }
  throw new ChainSwapRefused('timeout');
}

/**
 * Check a Kuru Flow swap's calls, send its approval (when there is one) and wait for it
 * to land — the swap's gas estimate needs the allowance in place — then sign the swap.
 * Answers the raw signed swap, 0x-hex, for the gateway to relay. Monad only: it is the one
 * EVM chain with a same-chain venue the gateway builds for.
 */
export async function signMonadSwap(p: {
  transaction: EvmCall;
  approval: EvmCall | null;
  secret: Uint8Array;
  owner: string;
  sell: string;
  amount: bigint;
}): Promise<string> {
  const refusal = checkMonadSwapCalls(p.transaction, p.approval, p.sell, p.amount, MONAD_CHAIN_ID);
  if (refusal) throw new ChainSwapRefused(refusal);
  await assertEvmNode('monad');
  if (p.approval) {
    const approve = await signEvmCall('monad', { to: p.approval.to, data: p.approval.data, value: 0n }, p.secret, p.owner);
    await evmSend('monad', approve.raw);
    await waitForReceipt('monad', approve.hash);
  }
  const swap = await signEvmCall(
    'monad',
    { to: p.transaction.to, data: p.transaction.data, value: BigInt(p.transaction.value || '0') },
    p.secret,
    p.owner,
  );
  return swap.raw;
}

/* ------------------------------- transfers ------------------------------- */

export interface TransferParams {
  chain: OtherChain;
  secret: Uint8Array;
  owner: string;
  asset: string;
  decimals: number;
  to: string;
  amount: bigint;
}

/** Spend from the phrase's Bitcoin address; a builder refusal becomes the wallet's own. */
async function sendBitcoin(p: TransferParams & { net: ChainNet }): Promise<string> {
  const [utxos, feeRate] = await Promise.all([bitcoinUtxos(p.owner, p.net), bitcoinFeeRate(p.net)]);
  let signed: { hex: string; txid: string };
  try {
    signed = signBitcoinPayment({ utxos, secret: p.secret, owner: p.owner, to: p.to, amount: p.amount, feeRate, net: p.net });
  } catch (e) {
    if (e instanceof BitcoinSpendRefused) throw new ChainSwapRefused(e.code);
    throw e;
  }
  const txid = await bitcoinBroadcast(signed.hex, p.net);
  // Esplora answers the txid it computed; one that disagrees with ours is not our transaction.
  if (txid.toLowerCase() !== signed.txid.toLowerCase()) throw new ChainSwapRefused('simulation');
  return signed.txid;
}

/**
 * Pay `amount` of `asset` from our address on `chain` to `to`, on `net`, with a
 * transaction this wallet builds itself. Answers the transaction id once the node has
 * accepted it (Solana runs preflight, so a doomed one is refused there).
 */
export async function sendTransfer(p: TransferParams & { net: ChainNet }): Promise<string> {
  if (!isChainAddress(p.chain, p.to, p.net)) throw new ChainSwapRefused('address');
  if (p.chain === 'bitcoin') return sendBitcoin(p);
  if (p.chain === 'solana') {
    // Opening an account with less than rent exemption fails on chain with an error
    // about rent nobody expects from "send 0.0001 SOL"; refuse it here and say why.
    if (p.asset === 'native' && p.amount < SOLANA_RENT_EXEMPT_LAMPORTS && (await solanaLamports(p.to, p.net)) === 0n) {
      throw new ChainSwapRefused('rent');
    }
    const blockhash = await solanaBlockhash(p.net);
    const wire =
      p.asset === 'native'
        ? solTransferTx(p.owner, p.to, p.amount, blockhash)
        : splTransferTx({
            owner: p.owner,
            to: p.to,
            mint: p.asset,
            decimals: p.decimals,
            amount: p.amount,
            tokenProgram: await solanaMintProgram(p.asset, p.net),
            recentBlockhash: blockhash,
          });
    return solanaSend(signSolanaTx(wire, p.secret, p.owner).signed, p.net);
  }
  if (!isEvmChain(p.chain)) throw new ChainSwapRefused('chain');
  const chain = p.chain;
  await assertEvmNode(chain, p.net);
  const call =
    p.asset === 'native'
      ? { to: p.to, data: '0x', value: p.amount }
      : { to: p.asset, data: transferCalldata(p.to, p.amount), value: 0n };
  const signed = await signEvmCall(chain, call, p.secret, p.owner, p.net);
  await evmSend(chain, signed.raw, p.net);
  return signed.hash;
}

/** Pay a NEAR Intents deposit address, on mainnet. Answers the transaction id. */
export function sendDeposit(p: TransferParams): Promise<string> {
  return sendTransfer({ ...p, net: 'mainnet' });
}
