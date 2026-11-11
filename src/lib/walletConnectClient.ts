/**
 * The WalletConnect SDK (WalletKit over the Sign protocol), loaded only when it is used.
 *
 * It is a few hundred kilobytes and opens a WebSocket to the relay, so nothing here is imported
 * statically: the entry chunk and the extension popup's first paint never carry it, and a build
 * with `PUBLIC_WALLETCONNECT_PROJECT_ID=off` (or an id that is not one) never loads it at all —
 * the feature is hidden there (`wcEnabled`), never a broken button. One client per page, as the SDK asks; its sessions live
 * in IndexedDB under the SDK's own prefix and survive a reload.
 *
 * The rules live elsewhere: what may be paired, offered and routed is `src/lib/walletConnect.ts`,
 * what a request asks and whether it may be signed is `src/lib/evmReview.ts`.
 */
import type { WalletKitTypes } from '@reown/walletkit';
import { WC_DEFAULT_PROJECT_ID, WC_METADATA } from '@/constants/walletConnect';
import type { WcError, WcSupported } from '@/lib/walletConnect';

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * The project id WalletConnect's dashboard issues (dashboard.walletconnect.com, a "Wallet"
 * project). Not a secret — it ships in every client — but it is OURS: the relay counts usage
 * against it. Anything that is not 32 hex characters is treated as absent.
 */
export function wcProjectId(): string {
  const id = (ENV.PUBLIC_WALLETCONNECT_PROJECT_ID || WC_DEFAULT_PROJECT_ID).trim();
  return /^[0-9a-f]{32}$/i.test(id) ? id : '';
}

/** Whether this build offers WalletConnect at all. */
export const wcEnabled = (): boolean => wcProjectId() !== '';

type Kit = Awaited<ReturnType<(typeof import('@reown/walletkit'))['WalletKit']['init']>>;

let client: Promise<Kit> | null = null;

/** The one client, initialised on first use. A failed start is forgotten, so the next use retries. */
export function wcClient(): Promise<Kit> {
  const projectId = wcProjectId();
  if (!projectId) return Promise.reject(new Error('WalletConnect is not configured.'));
  client ??= (async () => {
    const [{ Core }, { WalletKit }] = await Promise.all([import('@walletconnect/core'), import('@reown/walletkit')]);
    const core = new Core({ projectId });
    return WalletKit.init({ core, metadata: { ...WC_METADATA, icons: [...WC_METADATA.icons] } });
  })().catch((e: unknown) => {
    client = null;
    throw e;
  });
  return client;
}

export type WcProposalEvent = WalletKitTypes.SessionProposal;
export type WcRequestEvent = WalletKitTypes.SessionRequest;
export type WcSession = ReturnType<Kit['getActiveSessions']>[string];

/** The SDK's own namespace builder (CAIP-25's required/optional rules), from `supported`. */
export async function wcApprovedNamespaces(proposal: WcProposalEvent['params'], supported: WcSupported) {
  const { buildApprovedNamespaces } = await import('@walletconnect/utils');
  return buildApprovedNamespaces({ proposal, supportedNamespaces: { eip155: supported } });
}

/** A JSON-RPC result for request `id`. */
export const wcResult = (id: number, result: unknown) => ({ id, jsonrpc: '2.0' as const, result });

/** A JSON-RPC error for request `id`. */
export const wcErrorResponse = (id: number, error: WcError) => ({ id, jsonrpc: '2.0' as const, error: { code: error.code, message: error.message } });
