/**
 * Paying from Solana or Monad: the balances the swap screen shows, and the three things
 * the wallet signs there — a Jupiter swap, a Kuru Flow swap (with its approval), and a
 * deposit into a NEAR Intents address.
 *
 * Every function that signs checks first, and refuses with a `ChainSwapRefused` whose
 * `code` the store turns into a message. Nothing here reaches the gateway: the store
 * fetches what the gateway built and hands back what was signed.
 */
import { base64 } from '@scure/base';
import {
  CHAIN_CONFIRM_POLL_MS,
  CHAIN_CONFIRM_TIMEOUT_MS,
  CHAIN_TOKENS,
  EVM_BASE_FEE_MULTIPLIER,
  EVM_GAS_HEADROOM_PCT,
  MONAD_CHAIN_ID,
  NATIVE_RESERVE,
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

/** Base-unit balance of each token the screen offers on `chain`, keyed by `asset`. */
export async function chainBalances(chain: OtherChain, owner: string): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  if (chain === 'solana') {
    const [lamports, accounts] = await Promise.all([solanaLamports(owner), solanaTokenAccounts(owner)]);
    for (const t of CHAIN_TOKENS.solana) {
      out[t.asset] = t.asset === 'native' ? lamports : accounts.filter((a) => a.mint === t.asset).reduce((s, a) => s + a.amount, 0n);
    }
    return out;
  }
  await Promise.all(
    CHAIN_TOKENS.monad.map(async (t) => {
      out[t.asset] = t.asset === 'native' ? await monadBalance(owner) : await monadTokenBalance(t.asset, owner);
    }),
  );
  return out;
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

async function assertMonadNode(): Promise<void> {
  if ((await monadChainId()) !== MONAD_CHAIN_ID) throw new ChainSwapRefused('chain');
}

/** Sign one call as an EIP-1559 transaction at the node's current fees and our nonce. */
async function signMonadCall(call: { to: string; data: string; value: bigint }, secret: Uint8Array, owner: string, nonce?: bigint) {
  const [n, fees, gas] = await Promise.all([
    nonce === undefined ? monadNonce(owner) : Promise.resolve(nonce),
    monadFees(),
    monadEstimateGas({ from: owner, ...call }),
  ]);
  return signEip1559(
    {
      chainId: MONAD_CHAIN_ID,
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

/* -------------------------------- deposits ------------------------------- */

/**
 * Pay `amount` of `asset` from our address on `chain` to a NEAR Intents deposit address,
 * with a transaction this wallet builds itself. Answers the transaction id.
 */
export async function sendDeposit(p: {
  chain: OtherChain;
  secret: Uint8Array;
  owner: string;
  asset: string;
  decimals: number;
  to: string;
  amount: bigint;
}): Promise<string> {
  if (p.chain === 'solana') {
    if (!isSolanaAddress(p.to)) throw new ChainSwapRefused('address');
    const blockhash = await solanaBlockhash();
    const wire =
      p.asset === 'native'
        ? solTransferTx(p.owner, p.to, p.amount, blockhash)
        : splTransferTx({
            owner: p.owner,
            to: p.to,
            mint: p.asset,
            decimals: p.decimals,
            amount: p.amount,
            tokenProgram: await solanaMintProgram(p.asset),
            recentBlockhash: blockhash,
          });
    return solanaSend(signSolanaTx(wire, p.secret, p.owner).signed);
  }
  if (!isEvmAddress(p.to)) throw new ChainSwapRefused('address');
  await assertMonadNode();
  const call =
    p.asset === 'native'
      ? { to: p.to, data: '0x', value: p.amount }
      : { to: p.asset, data: transferCalldata(p.to, p.amount), value: 0n };
  const signed = await signMonadCall(call, p.secret, p.owner);
  await monadSend(signed.raw);
  return signed.hash;
}
