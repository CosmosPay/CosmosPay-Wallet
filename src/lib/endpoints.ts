/**
 * Central registry of every external endpoint the wallet talks to, with
 * DEVELOPER-MODE overrides persisted in localStorage:
 *
 *   cosmos.devMode       -> 'on' | (absent)
 *   cosmos.devEndpoints  -> JSON { coingeckoBase?, gatewayUrl?, gatewayEntry?, recoveryAUrl?, recoveryBUrl? }
 *
 * Resolution order: dev-mode override (when dev mode is ON) -> PUBLIC_* env -> default.
 * Getters are read per request, so changes apply immediately — no reload needed.
 * (Horizon/friendbot are NOT here: those are per-network and already configurable
 * via Settings -> custom networks.)
 */

import {
  CHAIN_NODES,
  DEFAULT_GATEWAY_ENTRY,
  DEFAULT_GATEWAY_URL,
  DEFAULT_RECOVERY_A_URL,
  DEFAULT_RECOVERY_B_URL,
} from '@/constants/backends';
import { OTHER_CHAINS, type ChainNet, type OtherChain } from '@/constants/chains';
import type { RecoveryRole } from '@/constants/recovery';
import { buildKind } from '@/lib/platform';

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Same-origin ('') only works in the WEB dev server, where the Vite proxy forwards /api
 * and /cosmos-api. The extension (chrome-extension://) and every Tauri build — mobile and
 * desktop alike, on tauri://localhost — have no proxy, so '' would point nowhere and the
 * `@/constants/backends` defaults answer outside 'web' (env/dev-mode still win).
 *
 * Those origins are also what the backends' CORS policy has to allow: a Tauri window is a
 * cross-origin caller exactly as the extension popup already is, except that nothing
 * exempts it the way `host_permissions` exempts the popup. `.env.example` lists the exact
 * origins each shell presents.
 */
const sameOriginWorks = () => buildKind() === 'web';

const MODE_KEY = 'cosmos.devMode';
const OVERRIDES_KEY = 'cosmos.devEndpoints';

/**
 * The override key of each chain node: `<chain>RpcUrl` for mainnet, `<chain>TestnetRpcUrl`
 * for its test network (on Bitcoin the "RPC" is an Esplora API base). The Solana and Monad
 * keys are the ones this store has always used, so an override saved before the other
 * chains existed still applies.
 */
export type ChainNodeKey = `${OtherChain}RpcUrl` | `${OtherChain}TestnetRpcUrl`;

export const chainNodeKey = (chain: OtherChain, net: ChainNet): ChainNodeKey =>
  net === 'mainnet' ? `${chain}RpcUrl` : `${chain}TestnetRpcUrl`;

export type EndpointOverrides = {
  coingeckoBase?: string; // price feed base, e.g. https://api.coingecko.com
  gatewayUrl?: string; // APISIX gateway base ('' = same-origin proxy)
  gatewayEntry?: string; // gateway entry prefix, e.g. /cosmos-api
  recoveryAUrl?: string; // SEP-30 recovery server A
  recoveryBUrl?: string; // SEP-30 recovery server B — a DIFFERENT deployment, always
} & Partial<Record<ChainNodeKey, string>>;

export function devModeEnabled(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(MODE_KEY, 'on');
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

export function getOverrides(): EndpointOverrides {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as EndpointOverrides) : {};
  } catch {
    return {};
  }
}

export function setOverride(key: keyof EndpointOverrides, value: string): void {
  try {
    const cur = getOverrides();
    const v = value.trim();
    if (v) cur[key] = v;
    else delete cur[key];
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

export function resetOverrides(): void {
  try {
    localStorage.removeItem(OVERRIDES_KEY);
  } catch {
    /* ignore */
  }
}

/** Effective value for one endpoint: override (dev mode on) -> env -> default. */
function resolve(key: keyof EndpointOverrides, envValue: string | undefined, fallback: string): string {
  if (devModeEnabled()) {
    const ov = getOverrides()[key];
    if (ov) return ov;
  }
  return envValue ?? fallback;
}

/* ------------------------------ resolved getters ------------------------------ */

/** CoinGecko (or compatible) price API base. */
export const coingeckoBase = (): string => resolve('coingeckoBase', undefined, 'https://api.coingecko.com');

/** APISIX gateway base ('' = same-origin, dev-proxied — web only). */
export const gatewayUrl = (): string =>
  resolve('gatewayUrl', ENV.PUBLIC_COSMOS_GATEWAY_URL || undefined, sameOriginWorks() ? '' : DEFAULT_GATEWAY_URL);

/** Gateway entry prefix (APISIX strips it before forwarding). */
export const gatewayEntry = (): string => resolve('gatewayEntry', ENV.PUBLIC_COSMOS_GATEWAY_ENTRY || undefined, DEFAULT_GATEWAY_ENTRY);

/** Full gateway API base, e.g. `/cosmos-api` in dev or `https://gw.x.y/cosmos-api`. */
export const gatewayApi = (): string => `${gatewayUrl()}${gatewayEntry()}`;

/**
 * One of the two SEP-30 recovery servers (`lib/recovery.ts`).
 *
 * Never same-origin, even on the web dev server: these are two separate deployments by
 * definition, and a same-origin default would quietly make them the dev platform — which
 * answers 503 there, at the end of a flow rather than the start of one.
 */
export const recoveryUrl = (role: RecoveryRole): string =>
  role === 'a'
    ? resolve('recoveryAUrl', ENV.PUBLIC_COSMOS_RECOVERY_A_URL || undefined, DEFAULT_RECOVERY_A_URL)
    : resolve('recoveryBUrl', ENV.PUBLIC_COSMOS_RECOVERY_B_URL || undefined, DEFAULT_RECOVERY_B_URL);

/**
 * The node for `chain` on `net`: a JSON-RPC endpoint, or on Bitcoin an Esplora API base.
 * Override (dev mode) → `.env` (`CHAIN_NODES[net][chain].env`) → the compiled-in default.
 */
export const chainRpcUrl = (chain: OtherChain, net: ChainNet): string => {
  const node = CHAIN_NODES[net][chain];
  return resolve(chainNodeKey(chain, net), ENV[node.env] || undefined, node.fallback);
};

/** The test network's node for `chain` (test balances, airdrops and test sends). */
export const testnetRpcUrl = (chain: OtherChain): string => chainRpcUrl(chain, 'testnet');

/**
 * Both of them, in role order.
 *
 * Empty when the two resolve to the same origin: two shares held by one server are one
 * share, so the wallet treats a build configured that way as having no recovery at all
 * rather than offering a protection it would not be providing.
 */
export const recoveryServers = (): { role: RecoveryRole; url: string }[] => {
  const a = recoveryUrl('a');
  const b = recoveryUrl('b');
  if (!a || !b || safeOrigin(a) === safeOrigin(b)) return [];
  return [
    { role: 'a', url: a },
    { role: 'b', url: b },
  ];
};

/** Origin of a base URL, or the string itself when it does not parse — never a throw. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * UI metadata for the developer-mode settings form (label keys live in i18n). A chain
 * node's row names its network through `chainKey`, resolved into the label's `{chain}`.
 */
export interface EndpointField {
  key: keyof EndpointOverrides;
  labelKey: string;
  chainKey?: string;
  getDefault: () => string;
}

const CHAIN_NODE_FIELDS: EndpointField[] = (['mainnet', 'testnet'] as const).flatMap((net) =>
  OTHER_CHAINS.map((chain) => ({
    key: chainNodeKey(chain, net),
    labelKey: chain === 'bitcoin' ? 'settings.epChainApi' : 'settings.epChainNode',
    chainKey: `chains.net.${net}.${chain}`,
    getDefault: () => ENV[CHAIN_NODES[net][chain].env] || CHAIN_NODES[net][chain].fallback,
  })),
);

export const ENDPOINT_FIELDS: EndpointField[] = [
  { key: 'coingeckoBase', labelKey: 'settings.epCoingecko', getDefault: () => 'https://api.coingecko.com' },
  {
    key: 'gatewayUrl',
    labelKey: 'settings.epGateway',
    getDefault: () => ENV.PUBLIC_COSMOS_GATEWAY_URL || (sameOriginWorks() ? '' : DEFAULT_GATEWAY_URL),
  },
  { key: 'gatewayEntry', labelKey: 'settings.epGatewayEntry', getDefault: () => ENV.PUBLIC_COSMOS_GATEWAY_ENTRY || DEFAULT_GATEWAY_ENTRY },
  {
    key: 'recoveryAUrl',
    labelKey: 'settings.epRecoveryA',
    getDefault: () => ENV.PUBLIC_COSMOS_RECOVERY_A_URL || DEFAULT_RECOVERY_A_URL,
  },
  {
    key: 'recoveryBUrl',
    labelKey: 'settings.epRecoveryB',
    getDefault: () => ENV.PUBLIC_COSMOS_RECOVERY_B_URL || DEFAULT_RECOVERY_B_URL,
  },
  ...CHAIN_NODE_FIELDS,
];

/* ------------------------------- the sign-in ------------------------------- */

/**
 * The prefix every wallet sign-in route hangs off: `/v1/wallet` on the community server,
 * through the gateway.
 *
 * Only there. The sign-in used to live on the developer platform and then, for a while,
 * on both behind a flag; it is the community server's alone now, because that is the
 * piece that runs as replicas behind APISIX and that a developer can self-host with their
 * own Authentik. The platform issues API keys and shows metrics — the wallet does not
 * call it at all: the public key, the asset catalog and telemetry are the gateway's too.
 */
export const walletApiBase = (): string => `${gatewayApi()}/v1/wallet`;
