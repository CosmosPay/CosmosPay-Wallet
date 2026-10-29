/**
 * Paying from every network beyond Stellar, Solana and Monad: the EVM networks of the registry
 * (one key, one 0x address, a chain id per network) and Fogo (the SVM key, Solana's transaction
 * format) here; every other family in its own sender under `lib/send/` — the UTXO chains, Zcash,
 * the XRP Ledger, Tron, TON, NEAR, Sui, Aptos and Movement, Hyperliquid, Cardano, Starknet — all
 * on the one contract of `lib/send/types.ts`. A plain transfer the wallet builds itself — the coin
 * or one of the registry's stablecoins — so there is no counterparty envelope to check beyond the
 * address, the network the node serves, the fee and the amount. In test mode (`env: 'testnet'`)
 * the same transfer pays the coin of the network's test network (`networkDefOn`), where its
 * sender can bind a signature to it.
 *
 * Solana and Monad keep `lib/chainSwap.ts`, which also covers their test networks.
 */
import { SOLANA_RENT_EXEMPT_LAMPORTS, EVM_BASE_FEE_MULTIPLIER, EVM_GAS_HEADROOM_PCT } from '@/constants/chains';
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, SVM_REPLAY_SETTLE_MS, type NetworkId } from '@/constants/networks';
import {
  solanaBlockhashValid,
  svmGenesisAt,
  evmChainIdAt,
  evmEstimateGasAt,
  evmFeesAt,
  evmNonceAt,
  evmSendAt,
  svmBlockhashAt,
  svmBlockhashValidAt,
  svmLamportsAt,
  svmSendAt,
} from '@/lib/chainRpc';
import { ChainSwapRefused } from '@/lib/chainSwap';
import { isEvmAddress, signEip1559, transferCalldata } from '@/lib/evmTx';
import { isSolanaAddress, signSolanaTx, solTransferTx } from '@/lib/solanaTx';
import { networkDefOn, sendFeeReserveOn, svmGenesisOn } from '@/lib/testnets';
import type { FamilyTransfer } from '@/lib/send/types';
import { isUtxoAddress, sendUtxo } from '@/lib/send/utxo';
import { isZcashAddress, sendZcash } from '@/lib/send/zcash';
import { isXrplAddress, sendXrpl } from '@/lib/send/xrpl';
import { isTronAddress, sendTron } from '@/lib/send/tron';
import { isTonAddress, sendTon } from '@/lib/send/ton';
import { isNearAddress, sendNear } from '@/lib/send/near';
import { isSuiAddress, sendSui } from '@/lib/send/sui';
import { isAptosAddress, sendAptos } from '@/lib/send/aptos';
import { isHypercoreAddress, sendHypercore } from '@/lib/send/hypercore';
import { isCardanoAddress, sendCardano } from '@/lib/send/cardano';
import { isStarknetAddress, sendStarknet } from '@/lib/send/starknet';

/** Each family's sender and recipient check, by the network's address family. */
const FAMILIES: Partial<Record<string, { send: (p: FamilyTransfer) => Promise<string>; isAddress: (n: NetworkId, a: string, env: ChainNet) => boolean }>> = {
  btc: { send: sendUtxo, isAddress: isUtxoAddress },
  ltc: { send: sendUtxo, isAddress: isUtxoAddress },
  doge: { send: sendUtxo, isAddress: isUtxoAddress },
  dash: { send: sendUtxo, isAddress: isUtxoAddress },
  bch: { send: sendUtxo, isAddress: isUtxoAddress },
  zec: { send: sendZcash, isAddress: isZcashAddress },
  xrp: { send: sendXrpl, isAddress: isXrplAddress },
  tron: { send: sendTron, isAddress: isTronAddress },
  ton: { send: sendTon, isAddress: isTonAddress },
  near: { send: sendNear, isAddress: isNearAddress },
  sui: { send: sendSui, isAddress: isSuiAddress },
  aptos: { send: sendAptos, isAddress: isAptosAddress },
  cardano: { send: sendCardano, isAddress: isCardanoAddress },
  starknet: { send: sendStarknet, isAddress: isStarknetAddress },
};
/** Hyperliquid's account is the EVM key's, but it is paid through its own API, not a chain. */
const HYPERCORE = { send: sendHypercore, isAddress: isHypercoreAddress };
const familyOf = (network: NetworkId) => (network === 'hypercore' ? HYPERCORE : FAMILIES[NETWORKS[network].address]);

/** Whether `address` is a recipient on `network` in `env` — the predicate the screen and the signer share. */
export function isNetworkAddress(network: NetworkId, address: string, env: ChainNet = 'mainnet'): boolean {
  const family = familyOf(network);
  if (family) return family.isAddress(network, address, env);
  const kind = NETWORKS[network].address;
  return kind === 'evm' ? isEvmAddress(address) : kind === 'svm' ? isSolanaAddress(address) : false;
}

export interface NetworkTransfer {
  network: NetworkId;
  secret: Uint8Array;
  owner: string;
  /** `native`, or one of the network's registry tokens. */
  asset: string;
  to: string;
  amount: bigint;
  /** The wallet's mode; a test network pays its coin only. Mainnet when absent. */
  env?: ChainNet;
  /** XRP's destination tag or TON's comment (`FamilyTransfer.memo`). */
  memo?: string;
}

/**
 * Pay `amount` of `asset` from our address on `network` to `to`. Answers the transaction id
 * once the node has accepted it. `settleMs` is the Fogo replay wait (`SVM_REPLAY_SETTLE_MS`);
 * only a test shortens it.
 */
export async function sendNetworkTransfer(p: NetworkTransfer, settleMs: number = SVM_REPLAY_SETTLE_MS): Promise<string> {
  const env = p.env ?? 'mainnet';
  const def = networkDefOn(p.network, env);
  if (!def || !def.send || !def.balance) throw new ChainSwapRefused('chain');
  if (!isNetworkAddress(p.network, p.to, env)) throw new ChainSwapRefused('address');
  // Only the coin and the registry's own contracts: a token the screen never listed is not one
  // this function pays out, whatever a caller passes.
  if (p.asset !== 'native' && !def.tokens.some((tk) => tk.asset === p.asset)) throw new ChainSwapRefused('address');

  const family = familyOf(p.network);
  if (family) {
    const { network, secret, owner, asset, to, amount, memo } = p;
    return family.send({ network, env, def, secret, owner, asset, to, amount, memo, maxFee: sendFeeReserveOn(network, env) });
  }

  if (def.balance.kind === 'evm' && def.evmChainId !== undefined) {
    const url = def.balance.rpc;
    // The signature is bound to the chain id; a node serving another chain would relay a
    // transaction to nowhere (or, replayed, to somewhere else).
    if ((await evmChainIdAt(url)) !== def.evmChainId) throw new ChainSwapRefused('chain');
    const call =
      p.asset === 'native' ? { to: p.to, data: '0x', value: p.amount } : { to: p.asset, data: transferCalldata(p.to, p.amount), value: 0n };
    const [nonce, fees, gas] = await Promise.all([evmNonceAt(url, p.owner), evmFeesAt(url), evmEstimateGasAt(url, { from: p.owner, ...call })]);
    const maxFeePerGas = fees.baseFee * EVM_BASE_FEE_MULTIPLIER + fees.tip;
    const gasLimit = (gas * EVM_GAS_HEADROOM_PCT) / 100n;
    // The fees and the gas are the node's word. Whatever it says, one send never costs more than
    // the network's fee reserve: a node inflating either is refused, not paid.
    if (maxFeePerGas * gasLimit > sendFeeReserveOn(p.network, env)) throw new ChainSwapRefused('fee');
    const signed = signEip1559(
      {
        chainId: def.evmChainId,
        nonce,
        maxPriorityFeePerGas: fees.tip,
        maxFeePerGas,
        gasLimit,
        to: call.to,
        value: call.value,
        data: call.data,
      },
      p.secret,
    );
    await evmSendAt(url, signed.raw);
    return signed.hash;
  }

  if (def.balance.kind === 'svm') {
    if (p.asset !== 'native') throw new ChainSwapRefused('address');
    const url = def.balance.rpc;
    // The SVM key is Solana's too, and a transfer is bound to its chain only by its blockhash: a
    // node handing over a Solana blockhash would get a signature that also moves SOL. What
    // decides it is Solana's own node, asked AFTER `settleMs`, so a blockhash too fresh for it to
    // have seen yet is seen by then; unknown is a refusal. The genesis hash is only a first filter
    // (a node can lie about it), against a node pointed at the wrong network by mistake.
    const genesis = svmGenesisOn(p.network, env);
    if (!genesis || (await svmGenesisAt(url)) !== genesis) throw new ChainSwapRefused('chain');
    // The same runtime as Solana: an account opened with less than rent exemption is refused.
    if (p.amount < SOLANA_RENT_EXEMPT_LAMPORTS && (await svmLamportsAt(url, p.to)) === 0n) throw new ChainSwapRefused('rent');
    const blockhash = await svmBlockhashAt(url);
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    if (await solanaBlockhashValid(blockhash)) throw new ChainSwapRefused('chain');
    // On a test network the same key holds the main network's coin too: its node must not know
    // the blockhash either.
    const main = NETWORKS[p.network].balance;
    if (env !== 'mainnet' && (main?.kind !== 'svm' || (await svmBlockhashValidAt(main.rpc, blockhash)))) throw new ChainSwapRefused('chain');
    const wire = solTransferTx(p.owner, p.to, p.amount, blockhash);
    return svmSendAt(url, signSolanaTx(wire, p.secret, p.owner).signed);
  }

  throw new ChainSwapRefused('chain');
}
