/**
 * An EVM request a site made, read against the wallet as it is NOW — its mode, its account, the
 * chains it signs on — and what the person must be warned about before approving it. ONE reading
 * for both ways a site reaches the 0x account: the extension's approval window
 * (`src/app/ApprovePopup.tsx`) and WalletConnect (`src/features/walletconnect/WcHost.tsx`).
 * A check added here holds for both; a check added to one screen would be a check the other lacks.
 *
 * Pure, so `tests/unit/evmReview.test.ts` reaches it: the parsing and the decoding are
 * `src/lib/evmDapp.ts`, the send `src/lib/evmDappSend.ts`.
 */
import type { ChainNet } from '@/constants/chains';
import { EVM_APPROVE_TITLE_KEYS, EVM_ERR, type EvmApproveMethod } from '@/constants/evmDapp';
import {
  EvmDappRefused,
  allowanceCoversAll,
  callNeedsAck,
  evmDappChain,
  parseEvmDappRequest,
  reviewCall,
  typedDataGrantFields,
  typedDataGrants,
  typedDataNeedsAck,
  type CallReview,
  type EvmDappChain,
  type EvmDappRequest,
} from '@/lib/evmDapp';
import { networkDefOn } from '@/lib/testnets';

/**
 * An EVM request as the wallet read it: the request itself, the chain it is for, the account it
 * must be signed by, and — when it cannot be approved — why (`refusal`, an i18n key, and the
 * English `refusalMessage` the site gets with `refusalCode`).
 */
export interface EvmReview {
  method: EvmApproveMethod;
  env: ChainNet;
  account: string | null;
  chain: EvmDappChain | null;
  request: EvmDappRequest | null;
  call: CallReview | null;
  refusal: string | null;
  refusalMessage: string;
  refusalCode: number;
}

export interface EvmReviewInput {
  /** The JSON-RPC method the site asked for. */
  method: string;
  params: unknown;
  /** The chain the site had selected (the extension) or named (WalletConnect). */
  chainId: number;
  /** The wallet's 0x account in its current mode; null when it has none yet. */
  account: string | null;
  env: ChainNet;
}

/** Read an EVM request against the wallet as it is now. Never throws: a refusal is a field. */
export function reviewEvmRequest({ method: raw, params, chainId, account, env }: EvmReviewInput): EvmReview {
  const method = raw as EvmApproveMethod;
  const chain = evmDappChain(env, chainId);
  const view: EvmReview = { method, env, account, chain, request: null, call: null, refusal: null, refusalMessage: '', refusalCode: EVM_ERR.invalidParams };
  const refused = (key: string, message: string, code: number = EVM_ERR.invalidParams): EvmReview => ({
    ...view,
    refusal: key,
    refusalMessage: message,
    refusalCode: code,
  });
  if (!Object.hasOwn(EVM_APPROVE_TITLE_KEYS, method)) return refused('approve.evm.err.method', `Unsupported method: ${raw}`, EVM_ERR.unsupported);
  if (!account) return refused('approve.evm.err.noAccount', 'This wallet has no EVM account yet.', EVM_ERR.unauthorized);
  // The chain must be one the wallet signs on in the mode it is in NOW: whoever relayed the
  // request may have an older view of the mode than the person's last switch.
  if (!chain) return refused('approve.evm.err.chain', 'The selected chain is not available in the wallet mode.', EVM_ERR.unknownChain);
  try {
    const request = parseEvmDappRequest(method, params, chain.chainId);
    const signer = request.kind === 'connect' ? account : request.kind === 'sendTransaction' ? request.tx.from : request.address;
    if (signer.toLowerCase() !== account.toLowerCase()) {
      return refused('approve.evm.err.from', 'The request names another account than the connected one.', EVM_ERR.unauthorized);
    }
    const tokens = networkDefOn(chain.network, env)?.tokens ?? [];
    const call = request.kind === 'sendTransaction' ? reviewCall(request.tx.to, request.tx.data, tokens) : null;
    return { ...view, request, call };
  } catch (e) {
    if (e instanceof EvmDappRefused) return refused(e.key, e.message, e.code);
    return refused('approve.evm.err.params', e instanceof Error ? e.message : String(e));
  }
}

/** A warning the approval shows in red: an i18n key and its parameters. */
export interface EvmWarning {
  key: string;
  params?: Record<string, string>;
}

export interface EvmReviewNotes {
  /** The person must tick the acknowledgement before this can be approved. */
  needsAck: boolean;
  /** Everything the approval paints red, in the order it shows them. */
  warnings: EvmWarning[];
  /** An ERC-20 allowance on a registry token. */
  grant: boolean;
  /** That allowance is unlimited, or covers at least the balance read for it. */
  coversAll: boolean;
}

/**
 * What the approval must say about `review` beyond its rows, and whether it needs the explicit
 * acknowledgement: everything but a plain coin payment, a registry token's `transfer` and a text
 * message does (`callNeedsAck`, `typedDataNeedsAck`) — an allowance outlives the transaction, a
 * contract the wallet does not list may answer an ERC-20 selector with anything, and a typed
 * signature may be an order redeemed later. `allowanceBalance` is the account's balance of the
 * token an allowance is for, null when unread.
 */
export function evmReviewNotes(review: EvmReview, allowanceBalance: bigint | null): EvmReviewNotes {
  const call = review.call;
  const typed = review.request?.kind === 'signTypedData' ? review.request.typed : null;
  const grant = call?.kind === 'erc20' && call.grant;
  const coversAll = call?.kind === 'erc20' && call.grant && allowanceCoversAll(call.amount, allowanceBalance);
  const warnings: EvmWarning[] = [];
  if (call?.kind === 'contract') warnings.push({ key: call.erc20 ? 'approve.evm.warnUnknownToken' : 'approve.evm.warnContract' });
  if (grant) warnings.push({ key: coversAll ? 'approve.evm.warnUnlimited' : 'approve.evm.warnAllowance' });
  if (call?.kind === 'erc20' && call.fn === 'transferFrom') warnings.push({ key: 'approve.evm.warnTransferFrom' });
  if (typed) {
    const fields = typedDataGrantFields(typed);
    warnings.push(
      typedDataGrants(typed)
        ? { key: 'approve.evm.warnTypedGrant', params: { fields: fields.join(', ') || typed.primaryType } }
        : { key: 'approve.evm.warnTyped' },
    );
  }
  return {
    needsAck: (!!call && callNeedsAck(call)) || (!!typed && typedDataNeedsAck(typed)),
    warnings,
    grant: !!grant,
    coversAll: !!coversAll,
  };
}

/** What a failed EVM approval tells the site: its EIP-1193 code and an English message. */
export function evmFailure(e: unknown): { code: number; message: string } {
  if (e instanceof EvmDappRefused) return { code: e.code, message: e.message };
  return { code: EVM_ERR.internal, message: e instanceof Error ? e.message : String(e) };
}
