/**
 * Paying from Solana or Monad: the balances the swap screen shows, and the things the
 * wallet signs there — a Jupiter swap, a Kuru Flow swap (with its approval), a deposit
 * into a NEAR Intents address, and a plain transfer on a test network.
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
  EVM_GAS_HEADROOM_PCT,
  MONAD_CHAIN_ID,
  MONAD_CHAIN_IDS,
  NATIVE_RESERVE,
  SOLANA_RENT_EXEMPT_LAMPORTS,
  type ChainNet,
  type OtherChain,
} from '@/constants/chains';
import {
  monadBalance,
  monadChainId,
  monadEstimateGas,
  monadFees,
  monadNonce,
  monadReceipt,
  monadSend,
  monadTokenBalance,
  solanaAccounts,
  solanaBlockhash,
  solanaLamports,
  solanaMintProgram,
  solanaSend,
  solanaSimulate,
  solanaTokenAccounts,
} from '@/lib/chainRpc';
import { checkMonadSwapCalls, isEvmAddress, signEip1559, transferCalldata, type EvmCall } from '@/lib/evmTx';
import {
  associatedTokenAddress,
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
  | 'chain' // a Monad call for another chain, or the node is not Monad mainnet
  | 'testnetNode' // the node configured for Monad testnet is not Monad testnet
  | 'rent' // a SOL transfer would open an account with less than rent exemption
  | 'value' // a Monad swap sending more MON than confirmed
  | 'approval' // an approval that is not exactly (router, amount)
  | 'address' // a deposit address that is not an address on that chain
  | 'timeout'; // the approval did not land in time

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
 * test network the Monad node is asked which chain it serves first: an override pointed
 * at mainnet would otherwise show real MON on a card that calls it test MON.
 */
export async function chainBalances(chain: OtherChain, owner: string, net: ChainNet = 'mainnet'): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  const tokens = CHAIN_TOKENS_BY_NET[net][chain];
  if (chain === 'solana') {
    const [lamports, accounts] = await Promise.all([solanaLamports(owner, net), solanaTokenAccounts(owner, net)]);
    for (const t of tokens) {
      out[t.asset] = t.asset === 'native' ? lamports : accounts.filter((a) => a.mint === t.asset).reduce((s, a) => s + a.amount, 0n);
    }
    return out;
  }
  if (net === 'testnet') await assertMonadNode(net);
  await Promise.all(
    tokens.map(async (t) => {
      out[t.asset] = t.asset === 'native' ? await monadBalance(owner, net) : await monadTokenBalance(t.asset, owner, net);
    }),
  );
  return out;
}

/** Whether `address` is an address on `chain` — the predicate a screen and the signer share. */
export function isChainAddress(chain: OtherChain, address: string): boolean {
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
 * Check a Jupiter swap by simulating it with every account of ours it may write to in
 * view, then sign it. Only those: an account the transaction cannot write to cannot
 * change, and a node takes no more accounts than the transaction names. `sell` / `buy` are `native` or a mint; `amount` and `minimum` are base units — the
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
  const tokens = await solanaTokenAccounts(p.owner);
  const ours = new Set([p.owner, ...tokens.map((t) => t.address)]);
  if (p.buy !== 'native') ours.add(associatedTokenAddress(p.owner, p.buy, await solanaMintProgram(p.buy)));
  let writable: Set<string>;
  try {
    writable = await writableAccounts(parseSolanaTx(wire).message);
  } catch (e) {
    if (e instanceof ChainSwapRefused) throw e;
    throw new ChainSwapRefused('simulation');
  }
  // The fee payer is always writable; the rest of ours only where the transaction says so.
  const list = [p.owner, ...[...ours].filter((a) => a !== p.owner && writable.has(a))];
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

/* --------------------------------- Monad --------------------------------- */

/** The node must serve the chain `net` names; the signature is bound to that chain id too. */
async function assertMonadNode(net: ChainNet = 'mainnet'): Promise<void> {
  if ((await monadChainId(net)) !== MONAD_CHAIN_IDS[net]) throw new ChainSwapRefused(net === 'mainnet' ? 'chain' : 'testnetNode');
}

/** Sign one call as an EIP-1559 transaction at the node's current fees and our nonce. */
async function signMonadCall(
  call: { to: string; data: string; value: bigint },
  secret: Uint8Array,
  owner: string,
  net: ChainNet = 'mainnet',
) {
  const [n, fees, gas] = await Promise.all([monadNonce(owner, net), monadFees(net), monadEstimateGas({ from: owner, ...call }, net)]);
  return signEip1559(
    {
      chainId: MONAD_CHAIN_IDS[net],
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

async function waitForReceipt(hash: string): Promise<void> {
  const deadline = Date.now() + CHAIN_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ok = await monadReceipt(hash);
    if (ok === true) return;
    if (ok === false) throw new ChainSwapRefused('approval');
    await new Promise((r) => setTimeout(r, CHAIN_CONFIRM_POLL_MS));
  }
  throw new ChainSwapRefused('timeout');
}

/**
 * Check a Kuru Flow swap's calls, send its approval (when there is one) and wait for it
 * to land — the swap's gas estimate needs the allowance in place — then sign the swap.
 * Answers the raw signed swap, 0x-hex, for the gateway to relay.
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
  await assertMonadNode();
  if (p.approval) {
    const approve = await signMonadCall({ to: p.approval.to, data: p.approval.data, value: 0n }, p.secret, p.owner);
    await monadSend(approve.raw);
    await waitForReceipt(approve.hash);
  }
  const swap = await signMonadCall(
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

/**
 * Pay `amount` of `asset` from our address on `chain` to `to`, on `net`, with a
 * transaction this wallet builds itself. Answers the transaction id once the node has
 * accepted it (Solana runs preflight, so a doomed one is refused there).
 */
export async function sendTransfer(p: TransferParams & { net: ChainNet }): Promise<string> {
  if (!isChainAddress(p.chain, p.to)) throw new ChainSwapRefused('address');
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
  await assertMonadNode(p.net);
  const call =
    p.asset === 'native'
      ? { to: p.to, data: '0x', value: p.amount }
      : { to: p.asset, data: transferCalldata(p.to, p.amount), value: 0n };
  const signed = await signMonadCall(call, p.secret, p.owner, p.net);
  await monadSend(signed.raw, p.net);
  return signed.hash;
}

/** Pay a NEAR Intents deposit address, on mainnet. Answers the transaction id. */
export function sendDeposit(p: TransferParams): Promise<string> {
  return sendTransfer({ ...p, net: 'mainnet' });
}
