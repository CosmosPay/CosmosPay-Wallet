/**
 * The EVM half of the dapp surface: what a website may ask of the wallet's 0x account through the
 * extension's EIP-1193 provider (`extension-src/inpage.js`), routed by the service worker
 * (`extension-src/sw.js`) and approved in `src/app/ApprovePopup.tsx`. Pure logic lives in
 * `src/lib/evmDapp.ts`.
 *
 * The service worker is plain JavaScript with no imports, so it keeps its own copies of the
 * method lists and the chain table below; `tests/unit/evmDapp.test.ts` holds them equal.
 */
import type { ChainNet } from '@/constants/chains';

/** The provider's EIP-6963 identity (`eip6963:announceProvider`). */
export const EVM_PROVIDER_NAME = 'Cosmos Wallet';
export const EVM_PROVIDER_RDNS = 'lat.cosmospay.wallet';

/**
 * The method a page sends to the service worker for every EVM call; the JSON-RPC method and its
 * params ride inside. One namespace keeps the EVM calls out of the Stellar provider's
 * (`getAddress`, `signTransaction`…), and keeps them out of the web transport, which accepts
 * `DAPP_METHODS` only.
 */
export const EVM_DAPP_METHOD = 'evm';

/** Read-only JSON-RPC calls the worker forwards to the selected chain's public node. */
export const EVM_READ_METHODS = [
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
] as const;

/** The calls that open the approval window once the site is connected. */
export const EVM_SIGN_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'] as const;

export type EvmSignMethod = (typeof EVM_SIGN_METHODS)[number];

/** Every method the approval window may be opened for: the connect plus the three above. */
export type EvmApproveMethod = 'eth_requestAccounts' | EvmSignMethod;

/** The chain a site starts on before it asks for another, per wallet mode. */
export const EVM_DEFAULT_CHAIN: Record<ChainNet, number> = { mainnet: 1, testnet: 11155111 };

/** chrome.storage.session key prefix of a site's selected chain (`<prefix><mode> <origin>`). */
export const EVM_CHAIN_SESSION_PREFIX = 'cosmos.evmchain.';

/** EIP-1193 / EIP-1474 error codes the provider answers with. */
export const EVM_ERR = {
  rejected: 4001,
  unauthorized: 4100,
  unsupported: 4200,
  unknownChain: 4902,
  pending: -32002,
  invalidParams: -32602,
  internal: -32603,
} as const;

/** i18n keys of the approval window's title, per method. */
export const EVM_APPROVE_TITLE_KEYS: Record<EvmApproveMethod, string> = {
  eth_requestAccounts: 'approve.evm.title.connect',
  eth_sendTransaction: 'approve.evm.title.sendTransaction',
  personal_sign: 'approve.evm.title.personalSign',
  eth_signTypedData_v4: 'approve.evm.title.signTypedData',
};

/** ERC-20 calls the window decodes into plain words; every other selector is shown raw. */
export const ERC20_SELECTORS = {
  approve: '0x095ea7b3',
  transfer: '0xa9059cbb',
  transferFrom: '0x23b872dd',
  increaseAllowance: '0x39509351',
} as const;

export type Erc20Function = keyof typeof ERC20_SELECTORS;

/** i18n keys naming each decoded ERC-20 call in the approval window. */
export const ERC20_FN_KEYS: Record<Erc20Function, string> = {
  approve: 'approve.evm.fn.approve',
  transfer: 'approve.evm.fn.transfer',
  transferFrom: 'approve.evm.fn.transferFrom',
  increaseAllowance: 'approve.evm.fn.increaseAllowance',
};

/**
 * An allowance at or above this is "unlimited" in practice: no token has 2^128 base units in
 * circulation, so the number only ever means "everything, forever". An allowance at or above the
 * holder's balance means the same for today, and the window reads the balance to say so.
 */
export const UNLIMITED_ALLOWANCE = 2n ** 128n;

/**
 * EIP-712 primary types a signature may be given for without the explicit acknowledgement.
 * Empty on purpose: a typed signature can be an order, a permit or a delegation that a site
 * redeems later without asking again, and the wallet cannot tell them apart by their shape.
 */
export const KNOWN_SAFE_TYPED_DATA: readonly string[] = [];

/**
 * Field names that make typed data a grant — someone who may spend, receive or act for the
 * signer, or an amount that moves — matched case-insensitively anywhere in the structure
 * (Seaport's `offerer` and `recipient` sit in nested items). `TYPED_DATA_AMOUNT_RE` adds the
 * amount-like names.
 */
/** How deep typed data may nest (structs and arrays); deeper is refused, not walked. */
export const TYPED_DATA_MAX_DEPTH = 32;

/** The most grant-like fields the window names for one typed signature; past it the list is cut (it is red anyway). */
export const TYPED_DATA_MAX_GRANT_FIELDS = 24;

export const TYPED_DATA_GRANT_FIELDS: readonly string[] = ['spender', 'operator', 'offerer', 'recipient', 'receiver', 'to', 'delegate', 'delegatee', 'approved'];
export const TYPED_DATA_AMOUNT_RE = /amount|allowance|value/i;

/**
 * EIP-712 primary types that grant a spender: EIP-2612 `Permit`, DAI's, and Uniswap's Permit2.
 * A signature over one of these moves tokens without a transaction: always red.
 */
export const PERMIT_PRIMARY_TYPES: readonly string[] = [
  'Permit',
  'PermitSingle',
  'PermitBatch',
  'PermitTransferFrom',
  'PermitBatchTransferFrom',
  'PermitWitnessTransferFrom',
  'PermitBatchWitnessTransferFrom',
];

/** Size caps on what a page may hand over (rendered in full, so a megabyte cannot be judged). */
export const MAX_EVM_CALLDATA_CHARS = 256 * 1024;
export const MAX_EVM_MESSAGE_CHARS = 8192;
export const MAX_EVM_TYPED_DATA_CHARS = 64 * 1024;
