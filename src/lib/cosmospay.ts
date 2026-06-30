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

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Cosmos Developer Platform base (provisioning). EMPTY by default so requests
 * are same-origin (`/api/...`) and handled by the Vite dev proxy — no CORS.
 * Set PUBLIC_COSMOS_DEV_PLATFORM_URL to an absolute URL for prod / native.
 */
const DEV_PLATFORM_URL = ENV.PUBLIC_COSMOS_DEV_PLATFORM_URL || '';
/**
 * APISIX gateway base that fronts the payments API. EMPTY by default so
 * requests are same-origin and proxied in dev (see above).
 */
const COSMOS_GATEWAY_URL = ENV.PUBLIC_COSMOS_GATEWAY_URL || '';
/**
 * APISIX exposes the payments API behind an entry prefix (default `/cosmos-api`),
 * which the gateway route strips before forwarding to the community-server. So the
 * real swap paths are `/cosmos-api/v1/swaps/...` — hitting `/v1/...` directly 404s at
 * the gateway. Override the prefix via PUBLIC_COSMOS_GATEWAY_ENTRY if your route differs.
 */
const GATEWAY_ENTRY = ENV.PUBLIC_COSMOS_GATEWAY_ENTRY || '/cosmos-api';
/** Full gateway API base, e.g. `/cosmos-api` in dev (proxied to APISIX). */
const GATEWAY_API = `${COSMOS_GATEWAY_URL}${GATEWAY_ENTRY}`;

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
 */
async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  unwrap: boolean,
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
    const env = (json ?? {}) as Envelope & { error?: string };
    const msg = env.message || env.error || `La solicitud falló (${res.status}).`;
    throw new Error(msg);
  }

  if (unwrap && json && typeof json === 'object' && 'data' in (json as Envelope)) {
    return (json as Envelope).data as T;
  }
  return json as T;
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
    `${DEV_PLATFORM_URL}/api/wallet/register`,
    {
      email: input.email,
      name: input.name,
      stellarAddress: input.stellarAddress,
      nonce,
      signature,
    },
    {},
    true,
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
    `${DEV_PLATFORM_URL}/api/wallet/claim`,
    { stellarAddress: input.stellarAddress, claimToken: input.claimToken },
    {},
    true,
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
    `${DEV_PLATFORM_URL}/api/wallet/link`,
    {
      email: input.email,
      name: input.name,
      stellarAddress: input.stellarAddress,
      nonce,
      signature,
    },
    {},
    true,
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
    `${DEV_PLATFORM_URL}/api/wallet/link/verify`,
    { stellarAddress: input.stellarAddress, claimToken: input.claimToken, code: input.code },
    {},
    true,
  );
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Quote a swap. The commission is enforced server-side by the org's plan. */
export async function quoteSwap(apiKey: string, input: QuoteSwapInput): Promise<SwapQuote> {
  return postJson<SwapQuote>(
    `${GATEWAY_API}/v1/swaps/quote`,
    input,
    authHeaders(apiKey),
    false,
  );
}

/** Create a swap. The returned Swap carries the unsigned `xdr` to sign locally. */
export async function createSwap(apiKey: string, input: CreateSwapInput): Promise<Swap> {
  return postJson<Swap>(`${GATEWAY_API}/v1/swaps`, input, authHeaders(apiKey), false);
}

/** Submit a locally signed XDR for an existing swap. */
export async function submitSwap(
  apiKey: string,
  id: string,
  signedXdr: string,
): Promise<SubmitResult> {
  return postJson<SubmitResult>(
    `${GATEWAY_API}/v1/swaps/${encodeURIComponent(id)}/submit`,
    { signedXdr },
    authHeaders(apiKey),
    false,
  );
}
