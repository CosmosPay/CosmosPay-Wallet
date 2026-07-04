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

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const MODE_KEY = 'cosmos.devMode';
const OVERRIDES_KEY = 'cosmos.devEndpoints';

export interface EndpointOverrides {
  coingeckoBase?: string; // price feed base, e.g. https://api.coingecko.com
  devPlatformUrl?: string; // Cosmos Developer Platform base ('' = same-origin /api proxy)
  gatewayUrl?: string; // APISIX gateway base ('' = same-origin proxy)
  gatewayEntry?: string; // gateway entry prefix, e.g. /cosmos-api
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

/** Cosmos Developer Platform base ('' = same-origin `/api/...`, dev-proxied). */
export const devPlatformUrl = (): string => resolve('devPlatformUrl', ENV.PUBLIC_COSMOS_DEV_PLATFORM_URL, '');

/** APISIX gateway base ('' = same-origin, dev-proxied). */
export const gatewayUrl = (): string => resolve('gatewayUrl', ENV.PUBLIC_COSMOS_GATEWAY_URL, '');

/** Gateway entry prefix (APISIX strips it before forwarding). */
export const gatewayEntry = (): string => resolve('gatewayEntry', ENV.PUBLIC_COSMOS_GATEWAY_ENTRY, '/cosmos-api');

/** Full gateway API base, e.g. `/cosmos-api` in dev or `https://gw.x.y/cosmos-api`. */
export const gatewayApi = (): string => `${gatewayUrl()}${gatewayEntry()}`;

/** UI metadata for the developer-mode settings form (label keys live in i18n). */
export const ENDPOINT_FIELDS: { key: keyof EndpointOverrides; labelKey: string; getDefault: () => string }[] = [
  { key: 'coingeckoBase', labelKey: 'settings.epCoingecko', getDefault: () => 'https://api.coingecko.com' },
  { key: 'devPlatformUrl', labelKey: 'settings.epDevPlatform', getDefault: () => ENV.PUBLIC_COSMOS_DEV_PLATFORM_URL ?? '' },
  { key: 'gatewayUrl', labelKey: 'settings.epGateway', getDefault: () => ENV.PUBLIC_COSMOS_GATEWAY_URL ?? '' },
  { key: 'gatewayEntry', labelKey: 'settings.epGatewayEntry', getDefault: () => ENV.PUBLIC_COSMOS_GATEWAY_ENTRY ?? '/cosmos-api' },
];
