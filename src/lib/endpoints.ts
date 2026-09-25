/**
 * Central registry of every external endpoint the wallet talks to, with
 * DEVELOPER-MODE overrides persisted in localStorage:
 *
 *   cosmos.devMode       -> 'on' | (absent)
 *   cosmos.devEndpoints  -> JSON { coingeckoBase?, devPlatformUrl?, gatewayUrl?, gatewayEntry? }
 *
 * Resolution order: dev-mode override (when dev mode is ON) -> PUBLIC_* env -> default.
 * Getters are read per request, so changes apply immediately — no reload needed.
 * (Horizon/friendbot are NOT here: those are per-network and already configurable
 * via Settings -> custom networks.)
 */

import {
  DEFAULT_DEV_PLATFORM_URL,
  DEFAULT_GATEWAY_ENTRY,
  DEFAULT_GATEWAY_URL,
  DEFAULT_RECOVERY_A_URL,
  DEFAULT_RECOVERY_B_URL,
} from '@/constants/backends';
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

export interface EndpointOverrides {
  coingeckoBase?: string; // price feed base, e.g. https://api.coingecko.com
  devPlatformUrl?: string; // Cosmos Developer Platform base ('' = same-origin /api proxy)
  gatewayUrl?: string; // APISIX gateway base ('' = same-origin proxy)
  gatewayEntry?: string; // gateway entry prefix, e.g. /cosmos-api
  recoveryAUrl?: string; // SEP-30 recovery server A
  recoveryBUrl?: string; // SEP-30 recovery server B — a DIFFERENT deployment, always
}

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

/** Cosmos Developer Platform base ('' = same-origin `/api/...`, dev-proxied — web only). */
export const devPlatformUrl = (): string =>
  resolve('devPlatformUrl', ENV.PUBLIC_COSMOS_DEV_PLATFORM_URL || undefined, sameOriginWorks() ? '' : DEFAULT_DEV_PLATFORM_URL);

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

/** UI metadata for the developer-mode settings form (label keys live in i18n). */
export const ENDPOINT_FIELDS: { key: keyof EndpointOverrides; labelKey: string; getDefault: () => string }[] = [
  { key: 'coingeckoBase', labelKey: 'settings.epCoingecko', getDefault: () => 'https://api.coingecko.com' },
  {
    key: 'devPlatformUrl',
    labelKey: 'settings.epDevPlatform',
    getDefault: () => ENV.PUBLIC_COSMOS_DEV_PLATFORM_URL || (sameOriginWorks() ? '' : DEFAULT_DEV_PLATFORM_URL),
  },
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
];

/* ------------------------------- the sign-in ------------------------------- */

/**
 * The prefix every wallet sign-in route hangs off: `/v1/wallet` on the community server,
 * through the gateway.
 *
 * Only there. The sign-in used to live on the developer platform and then, for a while,
 * on both behind a flag; it is the community server's alone now, because that is the
 * piece that runs as replicas behind APISIX and that a developer can self-host with their
 * own Authentik. The platform issues API keys and shows metrics — it serves no part of
 * signing in, and a build that pointed at it would find nothing there.
 *
 * What the platform still serves is unaffected: `/api/assets`, `/api/public-key`,
 * `/api/telemetry` and the legacy Pollar routes stay on `devPlatformUrl()`.
 */
export const walletApiBase = (): string => `${gatewayApi()}/v1/wallet`;
