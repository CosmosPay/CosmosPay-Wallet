/**
 * WalletConnect v2 on the wallet side, the parts with no SDK and no network in them (the SDK is
 * `src/lib/walletConnectClient.ts`, the state `src/state/useWalletConnect.ts`): what a pairing
 * URI must be, which chains, methods and events a session is offered, how the Verify API's
 * verdict reads, and whether a request may reach the approval at all. `tests/unit/walletConnect.test.ts`
 * pins each of them.
 *
 * The chains are the extension provider's (`evmDappChains`): the EVM networks the wallet signs on
 * in its current mode. The account is the wallet's own 0x address in that mode. What a request
 * then asks for is read and checked by `src/lib/evmReview.ts`, the same reading the extension's
 * approval window makes.
 */
import type { ChainNet } from '@/constants/chains';
import { EVM_ERR } from '@/constants/evmDapp';
import { WC_EVENTS, WC_METHODS, WC_NAMESPACE, WC_SIGN_METHODS, WC_URI_MAX_CHARS, type WcMethod } from '@/constants/walletConnect';
import { evmDappChains, parseChainId } from '@/lib/evmDapp';

/* ------------------------------------------------------------------ errors */

/**
 * The WalletConnect error codes the wallet answers with (the Sign protocol's, the same values
 * `getSdkError` returns), so this module needs no SDK. A refusal of a request's CONTENT keeps the
 * EIP-1193 code `evmReview` gives it.
 */
export const WC_ERR = {
  userRejected: { code: 5000, message: 'User rejected.' },
  unsupportedChains: { code: 5100, message: 'Unsupported chains.' },
  unsupportedMethods: { code: 5101, message: 'Unsupported methods.' },
  unsupportedEvents: { code: 5102, message: 'Unsupported events.' },
  unsupportedAccounts: { code: 5103, message: 'Unsupported accounts.' },
  unsupportedNamespace: { code: 5104, message: 'Unsupported namespace key.' },
  userDisconnected: { code: 6000, message: 'User disconnected.' },
} as const;

export type WcError = { code: number; message: string };

/* -------------------------------------------------------------------- URI */

/** A WalletConnect v2 pairing URI, read. */
export interface WcPairingUri {
  /** The URI to hand to the SDK, exactly as read. */
  uri: string;
  topic: string;
  symKey: string;
  /** Seconds since the epoch, when the URI says. */
  expiry: number | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * `text` as a v2 pairing URI (`wc:<topic>@2?relay-protocol=irn&symKey=<key>[&expiryTimestamp=<s>]`),
 * or a link that carries one in its `uri` parameter (a site's "open in wallet" link, a QR that
 * wraps it); null for anything else — a v1 URI, a missing or malformed key, another relay
 * protocol, an expired one. Never a best-effort guess: what goes to the SDK is what was checked.
 */
export function parseWcUri(text: string, nowMs: number = Date.now()): WcPairingUri | null {
  const raw = String(text ?? '').trim();
  if (!raw || raw.length > WC_URI_MAX_CHARS) return null;
  if (!/^wc:/i.test(raw)) {
    // A link carrying the URI: read its `uri` parameter once, never recursively.
    let inner: string | null = null;
    try {
      inner = new URL(raw).searchParams.get('uri');
    } catch {
      return null;
    }
    return inner && /^wc:/i.test(inner) ? parseWcUri(inner, nowMs) : null;
  }
  const m = /^wc:([0-9a-fA-F]{64})@(\d+)\?(.*)$/.exec(raw);
  if (!m || m[2] !== '2') return null;
  const topic = m[1].toLowerCase();
  const q = new URLSearchParams(m[3]);
  const symKey = (q.get('symKey') ?? '').toLowerCase();
  if (!HEX64.test(symKey) || q.getAll('symKey').length !== 1) return null;
  if ((q.get('relay-protocol') ?? '') !== 'irn') return null;
  const exp = q.get('expiryTimestamp');
  let expiry: number | null = null;
  if (exp !== null) {
    if (!/^\d{1,12}$/.test(exp)) return null;
    expiry = Number(exp);
    if (expiry * 1000 <= nowMs) return null;
  }
  return { uri: raw, topic, symKey, expiry };
}

/* ------------------------------------------------------------- namespaces */

/** A namespace as a proposal requests it (CAIP-25): its chains, methods and events. */
export interface WcNamespaceRequest {
  chains?: string[];
  methods?: string[];
  events?: string[];
}

/** What the wallet can offer a session in `env` for `account`, in the SDK's `supportedNamespaces` shape. */
export interface WcSupported {
  chains: string[];
  methods: string[];
  events: string[];
  accounts: string[];
}

export const caip2 = (chainId: number): string => `${WC_NAMESPACE}:${chainId}`;

/** The CAIP-2 ids of every chain the wallet signs on in `env`. */
export function wcChains(env: ChainNet): string[] {
  return evmDappChains(env).map((c) => caip2(c.chainId));
}

/** The chain id of a CAIP-2 `eip155:<id>`, or null when it is not one. */
export function chainIdOf(caip: string): number | null {
  const m = /^eip155:([1-9]\d{0,15})$/.exec(String(caip ?? ''));
  return m ? parseChainId(m[1]) : null;
}

export function wcSupported(env: ChainNet, account: string): WcSupported {
  const chains = wcChains(env);
  return {
    chains,
    methods: [...WC_METHODS],
    events: [...WC_EVENTS],
    accounts: chains.map((c) => `${c}:${account}`),
  };
}

/** A namespace's chains, wherever the proposal put them: its `chains`, or its key (`eip155:1`). */
function chainsOf(key: string, ns: WcNamespaceRequest): string[] {
  if (key.includes(':')) return [key];
  return Array.isArray(ns.chains) ? ns.chains : [];
}

export type WcProposalProblem = 'namespace' | 'chains' | 'methods' | 'events' | 'account';

/** The error a proposal is refused with for a problem. */
export const WC_PROPOSAL_ERRORS: Record<WcProposalProblem, WcError> = {
  namespace: WC_ERR.unsupportedNamespace,
  chains: WC_ERR.unsupportedChains,
  methods: WC_ERR.unsupportedMethods,
  events: WC_ERR.unsupportedEvents,
  account: WC_ERR.unsupportedAccounts,
};

/**
 * Whether the wallet can honour a proposal at all: every REQUIRED namespace is EVM, its chains
 * are the wallet's in `env`, its methods and events are ones the wallet answers; and at least one
 * chain, required or optional, is the wallet's. Optional ones it cannot honour are left out of
 * the session, not refused (`offeredChains`). Null when it can.
 */
export function wcProposalProblem(
  required: Record<string, WcNamespaceRequest> | undefined,
  optional: Record<string, WcNamespaceRequest> | undefined,
  env: ChainNet,
  account: string | null,
): WcProposalProblem | null {
  if (!account) return 'account';
  const ours = new Set(wcChains(env));
  for (const [key, ns] of Object.entries(required ?? {})) {
    if (key !== WC_NAMESPACE && !key.startsWith(`${WC_NAMESPACE}:`)) return 'namespace';
    if (chainsOf(key, ns).some((c) => !ours.has(c))) return 'chains';
    if ((ns.methods ?? []).some((m) => !(WC_METHODS as readonly string[]).includes(m))) return 'methods';
    if ((ns.events ?? []).some((e) => !(WC_EVENTS as readonly string[]).includes(e))) return 'events';
  }
  return offeredChains(required, optional, env).length ? null : 'chains';
}

/** The chain ids a session would hold: those the proposal names (required or optional) that are the wallet's in `env`. */
export function offeredChains(
  required: Record<string, WcNamespaceRequest> | undefined,
  optional: Record<string, WcNamespaceRequest> | undefined,
  env: ChainNet,
): number[] {
  const ours = new Set(wcChains(env));
  const named = new Set<string>();
  for (const group of [required ?? {}, optional ?? {}]) {
    for (const [key, ns] of Object.entries(group)) {
      if (key !== WC_NAMESPACE && !key.startsWith(`${WC_NAMESPACE}:`)) continue;
      for (const c of chainsOf(key, ns)) if (ours.has(c)) named.add(c);
    }
  }
  return [...named].map((c) => chainIdOf(c)).filter((n): n is number => n !== null);
}

/* ------------------------------------------------------------------ verify */

/** The Verify API's verdict on the site, as the approval shows it. */
export type WcVerify = 'match' | 'unknown' | 'mismatch' | 'threat';

/**
 * A `verifyContext` read into one of four states (the Verify API's guide): a flagged scam first,
 * whatever else it says; then the domain match; an absent or unreadable context is `unknown`.
 */
export function wcVerifyState(ctx: unknown): WcVerify {
  const v = (ctx as { verified?: { validation?: unknown; isScam?: unknown } } | null | undefined)?.verified;
  if (v?.isScam === true) return 'threat';
  if (v?.validation === 'VALID') return 'match';
  if (v?.validation === 'INVALID') return 'mismatch';
  return 'unknown';
}

/* ----------------------------------------------------------------- requests */

/** The part of a session a request is checked against. */
export interface WcSessionScope {
  namespaces: Record<string, { accounts?: string[]; methods?: string[]; chains?: string[] }>;
}

export type WcRoute =
  | { ok: true; chainId: number; method: WcMethod; params: unknown; sign: boolean }
  | { ok: false; error: WcError; key: string };

const refuse = (error: WcError, key: string): WcRoute => ({ ok: false, error, key });

/**
 * Whether a request may reach the approval: a chain the wallet signs on in `env`, one the session
 * holds for THIS account (a session approved for another wallet, or in the other mode, is refused
 * here — it never signs for whoever is active now), and a method the session and the wallet both
 * carry. `eth_signTypedData` is read as v4. What the request asks is checked next, by `evmReview`.
 */
export function wcRouteRequest(
  session: WcSessionScope,
  chain: string,
  method: string,
  params: unknown,
  env: ChainNet,
  account: string | null,
): WcRoute {
  const chainId = chainIdOf(chain);
  if (chainId === null || !wcChains(env).includes(caip2(chainId))) return refuse(WC_ERR.unsupportedChains, 'wc.err.chain');
  const ns = session.namespaces?.[WC_NAMESPACE];
  if (!account || !ns) return refuse(WC_ERR.unsupportedAccounts, 'wc.err.account');
  const want = `${caip2(chainId)}:${account}`.toLowerCase();
  if (!(ns.accounts ?? []).some((a) => a.toLowerCase() === want)) return refuse(WC_ERR.unsupportedAccounts, 'wc.err.account');
  if (!(WC_METHODS as readonly string[]).includes(method) || !(ns.methods ?? []).includes(method)) {
    return refuse(WC_ERR.unsupportedMethods, 'wc.err.method');
  }
  const m = method as WcMethod;
  return { ok: true, chainId, method: m === 'eth_signTypedData' ? 'eth_signTypedData_v4' : m, params, sign: WC_SIGN_METHODS.includes(m) };
}

/**
 * `wallet_switchEthereumChain`'s target, when it is a chain the session holds; the error otherwise
 * (EIP-3326: 4902 for a chain the wallet does not know).
 */
export function wcSwitchTarget(session: WcSessionScope, params: unknown, env: ChainNet): { chainId: number } | { error: WcError } {
  const raw = Array.isArray(params) && params[0] && typeof params[0] === 'object' ? (params[0] as { chainId?: unknown }).chainId : undefined;
  const chainId = parseChainId(raw);
  const held = new Set((session.namespaces?.[WC_NAMESPACE]?.chains ?? []).map((c) => c.toLowerCase()));
  if (chainId === null || !wcChains(env).includes(caip2(chainId)) || !held.has(caip2(chainId))) {
    return { error: { code: EVM_ERR.unknownChain, message: 'Unrecognized chain.' } };
  }
  return { chainId };
}

/* ----------------------------------------------------------------- bindings */

/** Which wallet, mode and account a session was approved for (kept by the wallet, not the SDK). */
export interface WcBinding {
  walletId: string;
  env: ChainNet;
  account: string;
}

/** Whether a session approved under `binding` belongs to the wallet as it is now. */
export function wcBindingCurrent(binding: WcBinding | undefined, walletId: string | null, env: ChainNet, account: string | null): boolean {
  return !!binding && !!account && binding.walletId === walletId && binding.env === env && binding.account.toLowerCase() === account.toLowerCase();
}
