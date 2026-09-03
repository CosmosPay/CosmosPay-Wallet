/**
 * CosmosPay HTTP client.
 *
 * Two backends are involved:
 *   - The Cosmos Developer Platform (DEV_PLATFORM_URL) provisions a payments
 *     account for a wallet. Its responses are wrapped in an envelope
 *     `{ data, code, status, message }` — we unwrap `.data`.
 *   - The APISIX gateway (COSMOS_GATEWAY_URL) fronts the payments API. Swap
 *     calls go here authenticated with the org's CosmosPay API key
 *     (`Authorization: Bearer <apiKey>`). Paths are URI-versioned (`/v1/...`)
 *     and the responses are the raw shapes documented below (no envelope).
 *
 * SECURITY — provisioning carries NO client secret. This wallet is open source,
 * so any embedded credential would be readable by everyone and let attackers
 * mint accounts/API keys. Instead provisioning is gated by two factors the
 * legitimate user controls: a signature from the wallet's Stellar secret key
 * (proves control of the account) plus email verification. The API key is
 * minted only after the user clicks an emailed confirmation link, and is
 * returned only to the wallet that initiated the request — via a one-time
 * claim token handed back at registration. No `X-Provisioning-Key` exists.
 *
 * The wallet stays non-custodial: createSwap returns an unsigned XDR which we
 * sign locally (see signXdr in stellar.ts) and hand back via submitSwap — the
 * CosmosPay API submits it to Horizon, the wallet never does.
 *
 * Configuration is read from `import.meta.env.PUBLIC_*`. When unset (the dev
 * default) the base URLs are empty, so requests go same-origin (`/api`, `/v1`)
 * and the Vite dev proxy (astro.config.ts) forwards them to the local backends
 * server-side — which sidesteps CORS. Set absolute URLs via a `.env` file for
 * production / native builds. See `.env.example`. Never put secrets in PUBLIC_*
 * vars — they ship to the client.
 */
import { Keypair } from '@stellar/stellar-sdk';
// Endpoint bases (dev-platform + APISIX gateway) live in lib/endpoints: resolved
// per request as developer-mode override -> PUBLIC_* env -> same-origin default,
// so a dev can repoint them live from Settings without rebuilding. The gateway
// still exposes the payments API behind an entry prefix (default `/cosmos-api`).
import { devPlatformUrl, gatewayApi } from '@/lib/endpoints';

/** Default slippage tolerance for swaps (0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Circle USDC issuers per Stellar network. `destAssetIssuer` is optional on the
 * API (the gateway can resolve it from the org's plan) but we pass it explicitly
 * for determinism. Unknown networks resolve to `undefined` (let the server pick).
 */
export const USDC_ISSUER: Record<string, string> = {
  public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

export function usdcIssuer(networkId: string): string | undefined {
  return USDC_ISSUER[networkId];
}

/* ------------------------------- types --------------------------------- */

/**
 * Result of a registration request. `pending` means an email was sent and the
 * caller must poll `claimCosmosAccount` with the one-time `claimToken` after
 * the user confirms; `exists` means an account already exists for that email.
 */
export type RegisterResult =
  | { status: 'pending'; claimToken: string; expiresInSeconds: number }
  | { status: 'exists' };

/** Both swap keys for an account: dev (testnet) + prod (mainnet). The wallet uses the one
 *  matching its current network. Either can be null if that environment's mint failed. */
export interface CosmosKeys {
  dev: string | null;
  prod: string | null;
}

/** Result of a claim attempt against a pending registration. */
export type ClaimResult =
  | { status: 'pending' } // email not confirmed yet
  | { status: 'ready'; organizationId: string; keys: CosmosKeys }
  | { status: 'claimed' } // already claimed (token spent)
  | { status: 'expired' }; // token / registration expired

/**
 * Result of starting an account LINK — used when registration reported `exists`. The
 * server emails a one-time access code and returns a claim token the wallet keeps.
 */
export type LinkStartResult =
  | { status: 'sent'; claimToken: string; expiresInSeconds: number }
  | { status: 'not_found' }; // no account for this email after all — register instead

/** Result of verifying the emailed access code to finish linking. */
export type LinkVerifyResult =
  | { status: 'ready'; organizationId: string; keys: CosmosKeys }
  | { status: 'invalid'; attemptsLeft: number } // wrong code
  | { status: 'expired' } // code expired / unknown
  | { status: 'locked' }; // too many wrong attempts — request a new code

export interface PathHop {
  code: string;
  issuer: string | null;
}

export interface SwapQuote {
  network: string;
  source: { asset: string; issuer: string | null; amount: string };
  fee: { asset: string; issuer: string | null; amount: string; bps: number; wallet: string };
  swap: { asset: string; issuer: string | null; amount: string };
  destination: {
    asset: string;
    issuer: string | null;
    estimated: string;
    minimum: string;
    slippageBps: number;
  };
  path: PathHop[];
}

export interface Swap {
  id: string;
  status: string;
  network: string;
  source: string;
  destination: string;
  sendAsset: string;
  sendAssetIssuer: string | null;
  sendAmount: string;
  feeAmount: string;
  feeBps: number;
  swapAmount: string;
  destAsset: string;
  destAssetIssuer: string | null;
  destEstimated: string;
  destMin: string;
  slippageBps: number;
  path: PathHop[];
  memo: string | null;
  xdr: string;
  uri: string | null;
  txHash: string | null;
  qr: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitResult {
  submitted: boolean;
  status: string;
  txHash: string | null;
  reason: string | null;
  resultCodes: unknown;
  swap: Swap;
}

export interface QuoteSwapInput {
  amount: string;
  sourceAssetCode?: string;
  sourceAssetIssuer?: string;
  destAssetCode: string;
  destAssetIssuer?: string;
  slippageBps?: number;
}

export interface CreateSwapInput extends QuoteSwapInput {
  source: string;
  destination?: string;
  memo?: string;
}

import { parseShape, type Check } from '@/lib/apiShape';
import { apiError } from '@/lib/apiError';
import { PAGE_SIZE, RETRY_AFTER_CAP_S } from '@/constants/api';
import {
  AuthorizePayoutShape,
  BankAccountListShape,
  BankAccountShape,
  ClaimResultShape,
  LinkStartResultShape,
  LinkVerifyResultShape,
  LiquidityOpListShape,
  LiquidityOperationShape,
  LiquidityPoolListShape,
  LiquidityPoolShape,
  LiquidityPositionListShape,
  LiquiditySubmitResultShape,
  PayIntentShape,
  PayinListShape,
  PayinQuoteShape,
  PayinShape,
  PayoutListShape,
  PayoutQuoteShape,
  PayoutShape,
  RailsShape,
  ReceiverListShape,
  ReceiverShape,
  RegisterResultShape,
  RegisteredWalletListShape,
  RegisteredWalletShape,
  SignMessageShape,
  SubmitResultShape,
  SwapListShape,
  SwapQuoteShape,
  SwapShape,
  TosShape,
  TrustlineTxShape,
  VirtualAccountListShape,
  VirtualAccountShape,
} from '@/lib/cosmospayShapes';
import { tNow } from '@/lib/i18n';

/* ------------------------------ transport ------------------------------ */

interface Envelope {
  data?: unknown;
  code?: number;
  status?: string;
  message?: string;
}

/**
 * POST JSON and parse the response. When `unwrap` is set, the dev-platform
 * envelope is unwrapped to `.data`. Throws a clear Error on a non-2xx response,
 * preferring the envelope's `.message`.
 *
 * `shape` is REQUIRED: it asserts, at runtime, the fields the caller is about to act
 * on. The `as T` below is what it always was — but now it is a cast over a value
 * whose load-bearing fields have actually been checked, instead of a bare promise to
 * the compiler. See lib/cosmospayShapes.ts.
 */
async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  unwrap: boolean,
  shape: Check<unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    throw apiError(url, res, json, RETRY_AFTER_CAP_S);
  }

  const payload =
    unwrap && json && typeof json === 'object' && 'data' in (json as Envelope) ? (json as Envelope).data : json;
  parseShape(url, shape, payload);
  return payload as T;
}

/* --------------------------- provisioning ------------------------------ */

/** Cryptographically-random hex nonce (NOT Math.random) to bind a registration. */
export function makeNonce(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign the canonical registration message with the wallet's Stellar secret key,
 * proving control of `stellarAddress`. The server verifies this signature
 * against the public key before emailing a confirmation link. Returns the
 * base64 signature. The message format is fixed and must match the server.
 */
export function signRegistrationMessage(
  secret: string,
  email: string,
  stellarAddress: string,
  nonce: string,
): string {
  const message = `Cosmos Pay Wallet account registration\nemail: ${email.trim().toLowerCase()}\naccount: ${stellarAddress}\nnonce: ${nonce}`;
  return Keypair.fromSecret(secret).sign(Buffer.from(message, 'utf8')).toString('base64');
}

/**
 * Begin provisioning: prove control of the Stellar account by signing a nonce,
 * then ask the dev platform to email a confirmation link. No client secret is
 * sent. Returns `pending` (with a one-time claim token) or `exists`.
 */
export async function registerCosmosAccount(input: {
  email: string;
  name: string;
  stellarAddress: string;
  secret: string;
}): Promise<RegisterResult> {
  const nonce = makeNonce();
  const signature = signRegistrationMessage(input.secret, input.email, input.stellarAddress, nonce);
  return postJson<RegisterResult>(
    `${devPlatformUrl()}/api/wallet/register`,
    {
      email: input.email,
      name: input.name,
      stellarAddress: input.stellarAddress,
      nonce,
      signature,
    },
    {},
    true,
    RegisterResultShape,
  );
}

/**
 * Claim the API key for a pending registration once the user has confirmed via
 * email. The claim token is single-use and bound to `stellarAddress`, so the
 * key is only ever returned to the wallet that initiated the registration.
 */
export async function claimCosmosAccount(input: {
  stellarAddress: string;
  claimToken: string;
}): Promise<ClaimResult> {
  return postJson<ClaimResult>(
    `${devPlatformUrl()}/api/wallet/claim`,
    { stellarAddress: input.stellarAddress, claimToken: input.claimToken },
    {},
    true,
    ClaimResultShape,
  );
}

/**
 * Sign the canonical account-LINK message. Distinct prefix from the registration message
 * so a signature for one flow can't be replayed in the other — must match the server's
 * linkMessage() byte-for-byte. Returns the base64 signature.
 */
export function signLinkMessage(
  secret: string,
  email: string,
  stellarAddress: string,
  nonce: string,
): string {
  const message = `Cosmos Pay Wallet account link\nemail: ${email.trim().toLowerCase()}\naccount: ${stellarAddress}\nnonce: ${nonce}`;
  return Keypair.fromSecret(secret).sign(Buffer.from(message, 'utf8')).toString('base64');
}

/**
 * Begin linking the wallet to an EXISTING account (the email already has one). Proves
 * control of the Stellar account by signing a nonce; the server emails a one-time access
 * code. Returns `sent` (with a claim token to keep) or `not_found`.
 */
export async function linkCosmosAccount(input: {
  email: string;
  name: string;
  stellarAddress: string;
  secret: string;
}): Promise<LinkStartResult> {
  const nonce = makeNonce();
  const signature = signLinkMessage(input.secret, input.email, input.stellarAddress, nonce);
  return postJson<LinkStartResult>(
    `${devPlatformUrl()}/api/wallet/link`,
    {
      email: input.email,
      name: input.name,
      stellarAddress: input.stellarAddress,
      nonce,
      signature,
    },
    {},
    true,
    LinkStartResultShape,
  );
}

/**
 * Finish linking: exchange the emailed access code (+ the claim token from linkCosmosAccount)
 * for the existing account's API key. Returns `ready` with the key, or a failure status.
 */
export async function verifyCosmosLink(input: {
  stellarAddress: string;
  claimToken: string;
  code: string;
}): Promise<LinkVerifyResult> {
  return postJson<LinkVerifyResult>(
    `${devPlatformUrl()}/api/wallet/link/verify`,
    { stellarAddress: input.stellarAddress, claimToken: input.claimToken, code: input.code },
    {},
    true,
    LinkVerifyResultShape,
  );
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Quote a swap. The commission is enforced server-side by the org's plan. */
export async function quoteSwap(apiKey: string, input: QuoteSwapInput): Promise<SwapQuote> {
  return postJson<SwapQuote>(
    `${gatewayApi()}/v1/swaps/quote`,
    input,
    authHeaders(apiKey),
    false,
    SwapQuoteShape,
  );
}

/** Create a swap. The returned Swap carries the unsigned `xdr` to sign locally. */
export async function createSwap(apiKey: string, input: CreateSwapInput): Promise<Swap> {
  return postJson<Swap>(`${gatewayApi()}/v1/swaps`, input, authHeaders(apiKey), false, SwapShape);
}

/** Submit a locally signed XDR for an existing swap. */
export async function submitSwap(
  apiKey: string,
  id: string,
  signedXdr: string,
): Promise<SubmitResult> {
  return postJson<SubmitResult>(
    `${gatewayApi()}/v1/swaps/${encodeURIComponent(id)}/submit`,
    { signedXdr },
    authHeaders(apiKey),
    false,
    SubmitResultShape,
  );
}

/* --------------------------- liquidity pools --------------------------- */
/*
 * Stellar AMM liquidity pools — the non-custodial twin of swaps. The gateway
 * prices a deposit/withdraw against the pool's on-chain reserves and returns an
 * unsigned XDR; the wallet signs it locally (signXdr) and hands it back via
 * submitLiquidity, which relays it to Horizon (hash-verified). Funds never pass
 * through Cosmos Pay. The plan commission is enforced server-side (the org's
 * plan), never a request field — same as swaps. Endpoints: `/v1/liquidity-pools`.
 */

/** One side of a pool (or a holder's stake): an asset and its amount. */
export interface LiquidityReserve {
  asset: string; // asset code, or "native"
  issuer: string | null;
  amount: string;
}

/** An on-chain liquidity pool (proxied from Horizon; nothing persisted). */
export interface LiquidityPool {
  id: string;
  network: string;
  feeBp: number; // pool fee in basis points (30 = 0.3%)
  totalTrustlines: string;
  totalShares: string;
  reserves: LiquidityReserve[];
}

export interface LiquidityPoolList {
  data: LiquidityPool[];
  cursor: string | null;
}

/** An account's stake in one pool, with its proportionally redeemable amounts. */
export interface LiquidityPosition {
  poolId: string;
  shares: string;
  totalShares: string;
  shareOfPoolBps: number; // 112 = 1.12%
  reserves: LiquidityReserve[];
  redeemable: LiquidityReserve[]; // what the shares redeem to (pre-slippage)
}

export interface LiquidityPositionList {
  account: string;
  network: string;
  data: LiquidityPosition[];
}

/** A persisted liquidity pool operation (deposit/withdraw) + its derived QR. */
export interface LiquidityOperation {
  id: string;
  kind: 'DEPOSIT' | 'WITHDRAW';
  status: string;
  network: string;
  source: string;
  poolId: string;
  assetA: string;
  assetAIssuer: string | null;
  assetB: string;
  assetBIssuer: string | null;
  amountA: string; // deposit: maxAmountA cap · withdraw: min received of A
  amountB: string;
  shares: string | null; // shares burned (withdraw only)
  minPrice: string | null;
  maxPrice: string | null;
  slippageBps: number;
  feeBps: number;
  feeAmountA: string;
  feeAmountB: string;
  feeWallet: string | null;
  commissionMemo: string | null;
  xdr: string; // unsigned envelope to sign locally
  uri: string;
  txHash: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiquiditySubmitResult {
  submitted: boolean;
  status: string;
  txHash?: string;
  reason?: string;
  resultCodes?: string[];
  operation: LiquidityOperation;
}

/** Query for browsing pools. Any filter is optional; omit for the newest pools. */
export interface ListPoolsInput {
  assetACode?: string;
  assetAIssuer?: string;
  assetBCode?: string;
  assetBIssuer?: string;
  account?: string;
  cursor?: string;
  limit?: number;
}

export interface DepositLiquidityInput {
  source: string;
  assetACode?: string;
  assetAIssuer?: string;
  assetBCode?: string;
  assetBIssuer?: string;
  maxAmountA: string;
  maxAmountB?: string; // derived from the pool ratio when omitted (funded pools)
  slippageBps?: number;
  memo?: string;
}

export interface WithdrawLiquidityInput {
  source: string;
  poolId: string;
  shares: string;
  slippageBps?: number;
  memo?: string;
}

/** Append the defined entries of `params` to a URL's query string. */
function withQuery(url: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/** Browse on-chain liquidity pools (Horizon proxy). */
export async function listLiquidityPools(apiKey: string, input: ListPoolsInput = {}): Promise<LiquidityPoolList> {
  return getJson<LiquidityPoolList>(withQuery(`${gatewayApi()}/v1/liquidity-pools`, { ...input }), apiKey, LiquidityPoolListShape);
}

/** Get a single liquidity pool by its 64-char hex id. */
export async function getLiquidityPool(apiKey: string, poolId: string): Promise<LiquidityPool> {
  return getJson<LiquidityPool>(`${gatewayApi()}/v1/liquidity-pools/${encodeURIComponent(poolId)}`, apiKey, LiquidityPoolShape);
}

/** An account's pool share positions with redeemable amounts. */
export async function liquidityPositions(apiKey: string, account: string): Promise<LiquidityPositionList> {
  return getJson<LiquidityPositionList>(withQuery(`${gatewayApi()}/v1/liquidity-pools/positions`, { account }), apiKey, LiquidityPositionListShape);
}

/** Build a pool deposit. The returned operation carries the unsigned `xdr` to sign. */
export async function depositLiquidity(apiKey: string, input: DepositLiquidityInput): Promise<LiquidityOperation> {
  return postJson<LiquidityOperation>(`${gatewayApi()}/v1/liquidity-pools/deposit`, input, authHeaders(apiKey), false, LiquidityOperationShape);
}

/** Build a pool withdrawal (burn shares). Returns the unsigned `xdr` to sign. */
export async function withdrawLiquidity(apiKey: string, input: WithdrawLiquidityInput): Promise<LiquidityOperation> {
  return postJson<LiquidityOperation>(`${gatewayApi()}/v1/liquidity-pools/withdraw`, input, authHeaders(apiKey), false, LiquidityOperationShape);
}

/** Submit a locally signed XDR for an existing liquidity operation. */
export async function submitLiquidity(apiKey: string, id: string, signedXdr: string): Promise<LiquiditySubmitResult> {
  return postJson<LiquiditySubmitResult>(
    `${gatewayApi()}/v1/liquidity-pools/operations/${encodeURIComponent(id)}/submit`,
    { signedXdr },
    authHeaders(apiKey),
    false,
    LiquiditySubmitResultShape,
  );
}

/* ----------------------------- pay links ------------------------------- */

export interface PayLinkInput {
  destination: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  msg?: string;
}

/** A CosmosPay "pay" intent: a shareable SEP-7 pay URI + QR so anyone can pay you. */
export interface PayIntent {
  id: string;
  status: string;
  network: string;
  destination: string;
  amount: string | null;
  asset: string;
  assetIssuer: string | null;
  memo: string;
  msg: string | null;
  uri: string; // web+stellar:pay?...
  qr: string; // PNG data URL
}

/**
 * Create a shareable pay link (SEP-7 `pay` intent). The server tracks it (status/memo) so
 * the payment reconciles, and returns the URI + QR to hand to a friend. Needs `payments:write`.
 */
export async function createPayLink(apiKey: string, input: PayLinkInput): Promise<PayIntent> {
  return postJson<PayIntent>(`${gatewayApi()}/v1/payment-intents/pay`, input, authHeaders(apiKey), false, PayIntentShape);
}

/* --------------------------- fiat (BlindPay) --------------------------- */
/*
 * Fiat on/off-ramp via BlindPay. Flow: create a KYC `receiver` (kept as the wallet's
 * default) → accept ToS + register the Stellar wallet → then onramp (fiat→crypto) and
 * offramp (crypto→fiat, needs a bank account). All endpoints need the matching scope
 * (kyc / onramp / offramp), which the wallet keys now carry. LatAm-first (PIX/PSE).
 */

/** GET helper for the gateway (the payments API returns raw shapes, no envelope).
 *  `shape` is required for the same reason it is on postJson. */
async function getJson<T>(url: string, apiKey: string, shape: Check<unknown>): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(apiKey) });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON */
  }
  if (!res.ok) {
    throw apiError(url, res, json, RETRY_AFTER_CAP_S);
  }
  parseShape(url, shape, json);
  return json as T;
}

/**
 * Read one page of a list endpoint and return its rows plus the matching-row count.
 *
 * Every list under `/v1` now answers `{ data, total, take, skip }`; several used to
 * answer a bare array, and the wallet's readers still accept both because an installed
 * copy can be pointed at an older gateway. What they cannot keep doing is ignoring
 * `total`: the page is clamped at {@link PAGE_SIZE}, so a bare `.data` read is a silent
 * truncation — the user simply stops seeing their eleventh bank account, with nothing
 * on screen or in the console saying a page boundary was involved.
 *
 * So `total` comes back to the caller, which is what lets a screen say "showing 100 of
 * 137" instead of quietly lying. `total` is the number of MATCHING rows, never
 * `data.length`: on a full page those are equal, which is exactly why paginating on
 * `data.length` can never detect the last page.
 */
async function getPage<T>(
  url: string,
  apiKey: string,
  shape: Check<unknown>,
  take = PAGE_SIZE,
): Promise<{ items: T[]; total: number }> {
  const res = await getJson<T[] | { data?: T[]; total?: number }>(withQuery(url, { take }), apiKey, shape);
  if (Array.isArray(res)) return { items: res, total: res.length };
  const items = res.data ?? [];
  return { items, total: typeof res.total === 'number' ? res.total : items.length };
}

export type ReceiverKycType = 'light' | 'standard' | 'enhanced';

/**
 * A KYC receiver (BlindPay). The community-server returns camelCase
 * (`kycStatus`, `disabled`, `name`); we also tolerate snake_case (`kyc_status`,
 * `status`) so older/raw shapes still map. `disabled` gates approval: an
 * approved-but-disabled receiver is not usable.
 */
export interface Receiver {
  id: string;
  type: 'individual' | 'business';
  email: string;
  country: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  kycStatus?: string | null;
  kyc_status?: string | null;
  status?: string | null;
  disabled?: boolean;
}

export interface CreateReceiverInput {
  type?: 'individual' | 'business';
  kyc_type?: ReceiverKycType;
  email: string;
  country: string; // ISO-2, e.g. 'BR', 'CO', 'AR'
  first_name?: string;
  last_name?: string;
  date_of_birth?: string; // ISO
  tax_id?: string;
  address_line_1?: string;
  city?: string;
  state_province_region?: string;
  postal_code?: string;
  // Standard KYC documents — each is a `file_url` from uploadKycDoc().
  id_doc_country?: string;
  id_doc_type?: string; // 'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE'
  id_doc_front_file?: string;
  id_doc_back_file?: string;
  selfie_file?: string;
}

/** Create a receiver (starts KYC). Defaults to an individual `standard` KYC (needs a photo
 *  ID + selfie — upload them first with uploadKycDoc and pass the returned file_urls). */
export async function createReceiver(apiKey: string, input: CreateReceiverInput): Promise<Receiver> {
  const body = { type: 'individual', kyc_type: 'standard', ...input };
  return postJson<Receiver>(`${gatewayApi()}/v1/kyc/receivers`, body, authHeaders(apiKey), false, ReceiverShape);
}

/** Upload a KYC document (multipart) and return its `file_url`. Needs `kyc:write`. */
export async function uploadKycDoc(apiKey: string, file: Blob, bucket = 'onboarding'): Promise<{ file_url: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);
  // Note: no Content-Type header — the browser sets the multipart boundary itself.
  const res = await fetch(`${gatewayApi()}/v1/kyc/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const env = (json ?? {}) as { message?: string; error?: string };
    throw new Error(env.message || env.error || tNow('api.uploadFailed', { status: res.status }));
  }
  return json as { file_url: string };
}

export async function listReceivers(apiKey: string): Promise<{ items: Receiver[]; total: number }> {
  return getPage<Receiver>(`${gatewayApi()}/v1/kyc/receivers`, apiKey, ReceiverListShape);
}

export async function getReceiver(apiKey: string, id: string): Promise<Receiver> {
  return getJson<Receiver>(`${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(id)}`, apiKey, ReceiverShape);
}

/** Message the wallet must sign to prove ownership when registering its Stellar address. */
export async function receiverSignMessage(apiKey: string, receiverId: string): Promise<{ message: string }> {
  return getJson<{ message: string }>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/wallets/sign-message`,
    apiKey,
    SignMessageShape,
  );
}

/** A blockchain wallet registered to a receiver. `id` is the LOCAL cuid used as
 *  `blockchain_wallet_id` in onramp quotes (NOT the BlindPay `bw_...`). */
export interface RegisteredWallet {
  id: string;
  blindpayId?: string;
  name?: string | null;
  network: string;
  address?: string | null;
}

export async function addReceiverWallet(
  apiKey: string,
  receiverId: string,
  body: { name: string; network: string; address: string; signature_tx_hash?: string },
): Promise<RegisteredWallet> {
  return postJson<RegisteredWallet>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/wallets`,
    body,
    authHeaders(apiKey),
    false,
    RegisteredWalletShape,
  );
}

/** List the Stellar/blockchain wallets registered to a receiver. */
export async function listReceiverWallets(
  apiKey: string,
  receiverId: string,
): Promise<{ items: RegisteredWallet[]; total: number }> {
  return getPage<RegisteredWallet>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/wallets`,
    apiKey,
    RegisteredWalletListShape,
  );
}

export async function requestTos(apiKey: string, receiverId: string, redirectUrl: string): Promise<{ url?: string }> {
  return postJson<{ url?: string }>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/tos`,
    { redirect_url: redirectUrl, channel: 'email' },
    authHeaders(apiKey),
    false,
    TosShape,
  );
}

export async function enableReceiver(apiKey: string, receiverId: string, tosId: string): Promise<Receiver> {
  return postJson<Receiver>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/enable`,
    { tos_id: tosId },
    authHeaders(apiKey),
    false,
    ReceiverShape,
  );
}

/** Cosmos-Pay view of a BlindPay bank account. The server returns the rail under
 *  `rail` (camelCase mirror); `type` is tolerated for older/alternate shapes. */
export interface BankAccount {
  id: string;
  blindpayId?: string;
  name?: string | null;
  rail?: string | null;
  type?: string | null;
  country?: string | null;
  createdAt?: string;
}

/** Add a payout bank account to a receiver (e.g. PIX in Brazil). */
export async function addBankAccount(apiKey: string, receiverId: string, body: Record<string, unknown>): Promise<BankAccount> {
  return postJson<BankAccount>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/bank-accounts`,
    body,
    authHeaders(apiKey),
    false,
    BankAccountShape,
  );
}

export async function listBankAccounts(
  apiKey: string,
  receiverId: string,
): Promise<{ items: BankAccount[]; total: number }> {
  return getPage<BankAccount>(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/bank-accounts`,
    apiKey,
    BankAccountListShape,
  );
}

/** Delete a payout/deposit bank account from a receiver. */
export async function deleteBankAccount(apiKey: string, receiverId: string, accountId: string): Promise<void> {
  const res = await fetch(
    `${gatewayApi()}/v1/kyc/receivers/${encodeURIComponent(receiverId)}/bank-accounts/${encodeURIComponent(accountId)}`,
    { method: 'DELETE', headers: authHeaders(apiKey) },
  );
  if (!res.ok) {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty / non-JSON body */
    }
    // Was a Spanish literal, which meant a French user reading a German UI got told in
    // Spanish that their bank account could not be deleted. `apiError` carries the
    // status and the gateway's own machine code, and translates the fallback copy.
    throw apiError(res.url, res, json, RETRY_AFTER_CAP_S);
  }
}

export type FiatToken = 'USDC' | 'USDT' | 'USDB';
/** BlindPay payin (onramp) payment methods. */
export type PayinMethod = 'ach' | 'wire' | 'pix' | 'ted' | 'spei' | 'transfers' | 'pse' | 'international_swift' | 'rtp';

/** BlindPay network string for a Stellar environment (dev = testnet, prod = mainnet). */
export function blindpayNetwork(env: 'dev' | 'prod'): 'stellar' | 'stellar_testnet' {
  return env === 'prod' ? 'stellar' : 'stellar_testnet';
}

/**
 * The offramp `authorize` response is forwarded verbatim from BlindPay and isn't typed
 * by the community-server, so the unsigned-XDR field name isn't fixed. Probe the common
 * candidates (and one level of nesting) and return the first base64-ish transaction string.
 */
export function extractUnsignedXdr(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  // `transaction_hash` is BlindPay's (misnamed) field carrying the unsigned XDR.
  const keys = ['unsigned_transaction', 'unsignedTransaction', 'transaction_hash', 'transaction', 'xdr', 'tx', 'raw_transaction', 'serialized_transaction', 'unsigned_tx'];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 40) return v;
  }
  for (const nest of ['data', 'result', 'payout', 'authorization']) {
    const found = extractUnsignedXdr(o[nest]);
    if (found) return found;
  }
  return null;
}

/* ---- onramp (fiat -> crypto) ---- */
/** Per-method payer constraints. PIX is optional; Transfers (AR) and PSE (CO) need theirs. */
export interface PayerRules {
  pix_allowed_tax_ids?: string[];
  transfers_allowed_tax_id?: string;
  pse_allowed_tax_ids?: string[];
  pse_full_name?: string;
  pse_document_type?: 'CC' | 'NIT';
  pse_document_number?: string;
  pse_email?: string;
  pse_phone?: string;
  pse_bank_code?: string;
}

export interface PayinQuoteInput {
  blockchain_wallet_id: string; // LOCAL wallet cuid (from listReceiverWallets / addReceiverWallet)
  currency_type: 'sender' | 'receiver';
  payment_method: PayinMethod;
  token: FiatToken;
  request_amount: number; // minor units (cents)
  cover_fees?: boolean;
  payer_rules?: PayerRules;
}

export interface PayinQuote {
  id: string;
  expires_at?: number;
  sender_amount?: number; // minor units
  receiver_amount?: number; // minor units
  commercial_quotation?: number;
}

export async function onrampQuote(apiKey: string, input: PayinQuoteInput): Promise<PayinQuote> {
  return postJson<PayinQuote>(`${gatewayApi()}/v1/onramp/quotes`, input, authHeaders(apiKey), false, PayinQuoteShape);
}

/** Payment instructions returned to the payer (only the keys for that rail are present). */
export interface PayinInstructions {
  memo_code?: string;
  blindpay_bank_details?: Record<string, unknown>;
  pix_code?: string;
  clabe?: string;
  cbu?: string;
  pse_payment_link?: string;
  pse_full_name?: string;
  pse_tax_id?: string;
  pse_document_type?: string;
  virtual_account?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Payin {
  id: string;
  blindpayId?: string;
  status?: string | null;
  token?: string | null;
  network?: string | null;
  paymentMethod?: string | null;
  senderAmount?: string | null;
  receiverAmount?: string | null;
  instructions?: PayinInstructions | null;
  createdAt?: string;
}

export async function createPayin(apiKey: string, payinQuoteId: string): Promise<Payin> {
  return postJson<Payin>(`${gatewayApi()}/v1/onramp/payins`, { payin_quote_id: payinQuoteId }, authHeaders(apiKey), false, PayinShape);
}

/* ---- offramp (crypto -> fiat) ---- */
export interface PayoutQuoteInput {
  bank_account_id: string; // LOCAL bank-account cuid
  currency_type: 'sender' | 'receiver';
  cover_fees: boolean;
  request_amount: number; // minor units
  network: string; // 'stellar' | 'stellar_testnet'
  token: FiatToken;
  description?: string;
}

export interface PayoutQuote {
  id: string;
  expires_at?: number;
  sender_amount?: number; // minor units (crypto sent)
  receiver_local_amount?: number; // minor units (local fiat received) — normalized by the gateway
  receiver_amount?: number; // BlindPay's raw local-fiat field (fallback when receiver_local_amount is 0)
}

export async function offrampQuote(apiKey: string, input: PayoutQuoteInput): Promise<PayoutQuote> {
  return postJson<PayoutQuote>(`${gatewayApi()}/v1/offramp/quotes`, input, authHeaders(apiKey), false, PayoutQuoteShape);
}

/** Build the unsigned Stellar tx for a payout. Pass-through from BlindPay — see extractUnsignedXdr. */
export async function authorizePayout(
  apiKey: string,
  body: { quote_id: string; sender_wallet_address: string; chain: 'stellar' | 'solana' },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(`${gatewayApi()}/v1/offramp/payouts/authorize`, body, authHeaders(apiKey), false, AuthorizePayoutShape);
}

export interface Payout {
  id: string;
  blindpayId?: string;
  status?: string | null;
  token?: string | null;
  network?: string | null;
  rail?: string | null;
  senderAmount?: string | null;
  receiverAmount?: string | null;
  senderWalletAddress?: string | null;
  createdAt?: string;
}

/** Submit the payout with the signed Stellar XDR (`signed_transaction`). */
export async function createPayout(
  apiKey: string,
  body: { quote_id: string; sender_wallet_address: string; chain: 'stellar' | 'solana'; signed_transaction: string },
): Promise<Payout> {
  return postJson<Payout>(`${gatewayApi()}/v1/offramp/payouts`, body, authHeaders(apiKey), false, PayoutShape);
}


/* ======================= operation history ============================== */

/**
 * What the gateway did, after the wallet asked it to.
 *
 * Every money flow in this client is currently write-only: `createSwap` returns an
 * envelope, `submitSwap` says whether it landed, and then the wallet forgets. Anything
 * that resolves later — a payin waiting on a bank transfer, a payout in compliance
 * review, a swap the network is still confirming — simply vanishes from the user's
 * view, and the only place they can look is a block explorer that knows nothing about
 * the fiat half.
 *
 * These reads are scoped to the API key's organization server-side, so there is no
 * account parameter: the key already says whose rows these are.
 */

export interface SwapRow {
  id: string;
  status: string;
  sendAsset: string;
  sendAmount: string;
  destAsset: string;
  destEstimated: string;
  txHash?: string | null;
  createdAt?: string;
}

/** `status` narrows server-side, so an unfinished-only view costs no client filtering. */
export async function listSwaps(apiKey: string, status?: string): Promise<{ items: SwapRow[]; total: number }> {
  return getPage<SwapRow>(withQuery(`${gatewayApi()}/v1/swaps`, { status }), apiKey, SwapListShape);
}

export interface PayinRow {
  id: string;
  status?: string | null;
  token?: string | null;
  paymentMethod?: string | null;
  /** Minor units — see `fromMinorUnits` in lib/amount.ts. */
  senderAmount?: number | null;
  receiverAmount?: number | null;
  createdAt?: string;
}

export async function listPayins(apiKey: string): Promise<{ items: PayinRow[]; total: number }> {
  return getPage<PayinRow>(`${gatewayApi()}/v1/onramp/payins`, apiKey, PayinListShape);
}

export interface PayoutRow {
  id: string;
  status?: string | null;
  token?: string | null;
  rail?: string | null;
  senderAmount?: string | null;
  receiverAmount?: number | null;
  createdAt?: string;
}

export async function listPayouts(apiKey: string): Promise<{ items: PayoutRow[]; total: number }> {
  return getPage<PayoutRow>(`${gatewayApi()}/v1/offramp/payouts`, apiKey, PayoutListShape);
}

export interface LiquidityOpRow {
  id: string;
  kind: string;
  status: string;
  poolId: string;
  assetA: string;
  assetB: string;
  amountA: string;
  amountB: string;
  txHash?: string | null;
  createdAt?: string;
}

export async function listLiquidityOps(apiKey: string, kind?: 'deposit' | 'withdraw'): Promise<{ items: LiquidityOpRow[]; total: number }> {
  return getPage<LiquidityOpRow>(withQuery(`${gatewayApi()}/v1/liquidity-pools/operations`, { kind }), apiKey, LiquidityOpListShape);
}

/* ===================== deposits: trustline + virtual accounts ============ */

/**
 * An unsigned trustline envelope for the asset the onramp is about to deliver.
 *
 * The wallet can build a `changeTrust` itself — `stellarAddTrustline` does — and for a
 * user adding an asset by hand that is the right thing. This one is different: it is
 * the gateway naming the exact `(code, issuer)` its own onramp will pay out in. A
 * hand-built trustline to a plausible-looking USDC issuer is a deposit that arrives
 * nowhere, and the issuer is the one field a user cannot check by eye.
 *
 * Still signed locally, and still through `assertSafeToSign` — the envelope comes from
 * the gateway, which by this wallet's rules makes it a counterparty like any other.
 */
export async function onrampTrustlineTx(apiKey: string, address: string): Promise<{ xdr: string }> {
  return postJson<{ xdr: string }>(`${gatewayApi()}/v1/onramp/trustline`, { address }, authHeaders(apiKey), false, TrustlineTxShape);
}

/**
 * A virtual account: permanent bank details a receiver can be paid into repeatedly.
 *
 * The difference from a payin is who initiates. A payin is quoted, then funded once,
 * against instructions that expire; a virtual account is an account number the user can
 * save and their employer can pay into every month, with the conversion happening on
 * arrival. For a payroll or remittance user that is the whole product, and the wallet
 * currently makes them re-quote every time.
 *
 * Fields vary by rail and country, so only `id` is contracted — the rest is rendered as
 * whatever came back, the same treatment the bank-account forms already give BlindPay.
 */
export type VirtualAccount = { id: string } & Record<string, unknown>;

export async function listVirtualAccounts(apiKey: string, receiverId: string): Promise<{ items: VirtualAccount[]; total: number }> {
  return getPage<VirtualAccount>(
    `${gatewayApi()}/v1/onramp/receivers/${encodeURIComponent(receiverId)}/virtual-accounts`,
    apiKey,
    VirtualAccountListShape,
  );
}

export async function createVirtualAccount(apiKey: string, receiverId: string, body: Record<string, unknown>): Promise<VirtualAccount> {
  return postJson<VirtualAccount>(
    `${gatewayApi()}/v1/onramp/receivers/${encodeURIComponent(receiverId)}/virtual-accounts`,
    body,
    authHeaders(apiKey),
    false,
    VirtualAccountShape,
  );
}

/* ============================== rail catalogue =========================== */

/**
 * The rails the platform actually offers, and the fields one of them needs.
 *
 * `src/constants/fiat.ts` has carried both as hardcoded tables, which means adding a
 * country or a rail has been a wallet release — shipped through two app stores and MV3
 * review, for a change the operator made in a dashboard. These two reads move that to
 * configuration.
 *
 * Both are BlindPay passthroughs and BlindPay does not publish their content shape, so
 * the contract is `unchecked` and the interpreting happens in `lib/fiatRails.ts`, in
 * one function, with the local table as the fallback. Guessing a schema in a contract
 * would turn an unfamiliar response into a thrown ApiShapeError that takes the deposit
 * screen down; guessing it in a normaliser turns it into "use the table we shipped".
 */
export async function listRails(apiKey: string): Promise<unknown> {
  return getJson<unknown>(`${gatewayApi()}/v1/kyc/rails`, apiKey, RailsShape);
}

export async function railBankDetails(apiKey: string, rail: string): Promise<unknown> {
  return getJson<unknown>(withQuery(`${gatewayApi()}/v1/kyc/bank-details`, { rail }), apiKey, RailsShape);
}
