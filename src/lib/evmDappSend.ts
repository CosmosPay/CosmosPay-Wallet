/**
 * Sending a transaction a website asked for (`eth_sendTransaction`), once the person approved it
 * in `src/app/ApprovePopup.tsx`. The site proposes `to`, `value`, `data` and at most a gas floor;
 * the wallet picks the nonce and the fees, and bounds them:
 *
 *   - the node must serve the chain the site selected, asked BEFORE anything is signed — the
 *     chain id is a signed field, and a node serving another chain would relay it nowhere, or
 *     somewhere else;
 *   - the key must spell the account the site was granted (`from`);
 *   - the worst case (`maxFeePerGas × gasLimit`) must fit the network's `SEND_FEE_RESERVE`,
 *     whatever the node or the site says about gas.
 */
import { EVM_BASE_FEE_MULTIPLIER, EVM_GAS_HEADROOM_PCT, type ChainNet } from '@/constants/chains';
import { EVM_ERR } from '@/constants/evmDapp';
import { evmChainIdAt, evmEstimateGasAt, evmFeesAt, evmNonceAt, evmSendAt } from '@/lib/chainRpc';
import { EvmDappRefused, feeWithinCap, type DappTx, type EvmDappChain } from '@/lib/evmDapp';
import { evmAddressOf, signEip1559 } from '@/lib/evmTx';
import { sendFeeReserveOn } from '@/lib/testnets';

export interface DappSend {
  chain: EvmDappChain;
  env: ChainNet;
  secret: Uint8Array;
  tx: DappTx;
}

/** Sign and broadcast `tx` on `chain`; answers the transaction hash once the node accepted it. */
export async function sendDappTransaction({ chain, env, secret, tx }: DappSend): Promise<string> {
  if (evmAddressOf(secret).toLowerCase() !== tx.from.toLowerCase()) {
    throw new EvmDappRefused('approve.evm.err.key', 'The key does not match the account.', EVM_ERR.unauthorized);
  }
  const url = chain.rpc;
  if ((await evmChainIdAt(url)) !== chain.chainId) {
    throw new EvmDappRefused('approve.evm.err.nodeChain', 'The node serves another chain.', EVM_ERR.internal);
  }
  const call = { from: tx.from, to: tx.to, data: tx.data, value: tx.value };
  const [nonce, fees, estimate] = await Promise.all([evmNonceAt(url, tx.from), evmFeesAt(url), evmEstimateGasAt(url, call)]);
  const headroom = (estimate * EVM_GAS_HEADROOM_PCT) / 100n;
  const gasLimit = tx.gas !== null && tx.gas > headroom ? tx.gas : headroom;
  const maxFeePerGas = fees.baseFee * EVM_BASE_FEE_MULTIPLIER + fees.tip;
  if (!feeWithinCap(maxFeePerGas, gasLimit, sendFeeReserveOn(chain.network, env))) {
    throw new EvmDappRefused('approve.evm.err.fee', 'The network fee is above the wallet cap.', EVM_ERR.internal);
  }
  const signed = signEip1559(
    { chainId: chain.chainId, nonce, maxPriorityFeePerGas: fees.tip, maxFeePerGas, gasLimit, to: tx.to, value: tx.value, data: tx.data },
    secret,
  );
  await evmSendAt(url, signed.raw);
  return signed.hash;
}
