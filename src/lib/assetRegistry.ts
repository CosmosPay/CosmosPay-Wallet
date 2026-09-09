/**
 * Which asset is this, and who issues it.
 *
 * On Stellar an asset is a (code, issuer) PAIR; the code alone is not an
 * identifier. Mainnet carries twenty-odd accounts issuing `USDC` and eight
 * issuing `USDT0`, and on testnet not one issuer publishes a home domain — so
 * "show the user a token called USDC" is a question with a wrong answer, and this
 * module is where the right one comes from.
 *
 * Three sources, in order, each covering the one before it:
 *
 *   1. **Our API** — the maintained list, fetched from the platform's public
 *      mirror. No API key: the catalog holds no tenant data and a first-run
 *      wallet has no credential yet, so requiring one would mean the token picker
 *      cannot name anything until after registration.
 *   2. **The bundled table** (`@/constants/assetRegistry`) — compiled into the
 *      build. What answers on a plane, in a popup opening while the gateway is
 *      down, or before the first fetch resolves.
 *   3. **The user's own Horizon** — `resolveAssetIssuer`, which ranks the
 *      candidates for a code by trustline count. Whatever neither list names,
 *      including everything on a custom network pointed at a private indexer.
 *
 * Source 3 is a heuristic and is treated as one: what it returns is never marked
 * verified, because "the most-held issuer of this code" is a popularity contest,
 * not an identity check, and the whole point of the registry is that those two
 * differ. It is a starting point for the user, not an endorsement by us.
 *
 * The fetched list wins over the bundled one only when its `version` is at least
 * as high. An installed wallet can be newer than a stale CDN edge, and silently
 * replacing a newer bundled list with an older fetched one would be a downgrade
 * nobody could see.
 */
import { arrayOf, bool, nullable, num, object, parseShape, str, type Check } from '@/lib/apiShape';
import {
  ASSET_REGISTRY_KEY,
  ASSET_REGISTRY_TTL_MS,
  BUNDLED_ASSETS,
  BUNDLED_ASSETS_VERSION,
  type RegistryAsset,
} from '@/constants/assetRegistry';
import { assetKey, type AssetRef } from '@/lib/asset';
import { devPlatformUrl } from '@/lib/endpoints';
import { storageGet, storageSet } from '@/lib/storage';

export type { RegistryAsset } from '@/constants/assetRegistry';

/* ------------------------------- contract ------------------------------- */

/**
 * Asserted fields only, and every one of them is load-bearing.
 *
 * `issuer` decides which account a trustline is created to, and `verified`
 * decides whether the wallet vouches for it — a response that omitted either
 * would otherwise read as `undefined`, and `undefined` is falsy, which would
 * quietly demote every asset to unverified rather than failing. Unknown keys pass
 * through as everywhere else: this wallet ships through app stores and runs weeks
 * behind the server.
 */
const RegistryAssetShape: Check<unknown> = object({
  code: str,
  issuer: nullable(str),
  name: str,
  issuerName: str,
  issuerDomain: str,
  verified: bool,
  flags: object({ authRevocable: bool, clawback: bool }),
});

const RegistryShape: Check<unknown> = object({
  version: num,
  data: arrayOf(RegistryAssetShape),
});

interface RegistryPayload {
  version: number;
  data: RegistryAsset[];
}

/* -------------------------------- cache --------------------------------- */

interface CachedRegistry {
  version: number;
  at: number;
  data: RegistryAsset[];
}

/**
 * Per-network, in memory for this session.
 *
 * A separate layer from persistent storage on purpose: `storageGet` is async and
 * every row of the token picker asks for the registry, so a synchronous hit here
 * is what keeps a list render from queueing one storage read per row.
 */
const memory = new Map<string, CachedRegistry>();

/** In-flight fetches, so a screen mounting three pickers makes one request. */
const inFlight = new Map<string, Promise<RegistryAsset[]>>();

const storageKey = (networkId: string) => `${ASSET_REGISTRY_KEY}.${networkId}`;

async function readCache(networkId: string): Promise<CachedRegistry | null> {
  const hit = memory.get(networkId);
  if (hit) return hit;
  try {
    const raw = await storageGet(storageKey(networkId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRegistry;
    if (!Array.isArray(parsed?.data) || typeof parsed.version !== 'number') return null;
    memory.set(networkId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(networkId: string, payload: RegistryPayload): Promise<void> {
  const entry: CachedRegistry = { version: payload.version, at: Date.now(), data: payload.data };
  memory.set(networkId, entry);
  try {
    await storageSet(storageKey(networkId), JSON.stringify(entry));
  } catch {
    /* A wallet that cannot persist still works; it just refetches next launch. */
  }
}

/* -------------------------------- fetch --------------------------------- */

/**
 * The platform's public asset catalog.
 *
 * Deliberately NOT routed through `lib/cosmospay.ts`: every helper there takes an
 * API key, and the entire point of this read is that it works without one. It
 * also must not report through that module's failure telemetry — a wallet
 * offline at launch would report an error for a call whose failure is fully
 * expected and fully handled by the bundled fallback.
 */
async function fetchRegistry(networkId: string): Promise<RegistryPayload | null> {
  const url = `${devPlatformUrl()}/api/assets?network=${encodeURIComponent(networkId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    // The dev platform wraps responses in `{ data, code, status, message }`.
    const payload =
      json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)
        ? (json as { data: unknown }).data
        : json;
    parseShape(url, RegistryShape, payload);
    return payload as RegistryPayload;
  } catch {
    // Offline, blocked, or a shape the contract refused. All three mean the same
    // thing to the caller: use what we shipped.
    return null;
  }
}

/* ------------------------------- loading -------------------------------- */

/** What the build shipped for this network. Empty for a custom network. */
export function bundledAssets(networkId: string): RegistryAsset[] {
  return BUNDLED_ASSETS[networkId] ?? [];
}

/**
 * The registry for a network: freshest of the three sources, sorted verified
 * first.
 *
 * Never throws and never leaves the caller with nothing — the worst case is the
 * bundled table, and for a custom network an empty list, which is the honest
 * answer since we vouch for nothing there.
 */
export async function loadRegistry(networkId: string): Promise<RegistryAsset[]> {
  const cached = await readCache(networkId);
  const fresh = cached && Date.now() - cached.at < ASSET_REGISTRY_TTL_MS;
  if (cached && fresh) return merge(networkId, cached);

  const pending = inFlight.get(networkId);
  if (pending) return pending;

  const run = (async () => {
    const payload = await fetchRegistry(networkId);
    if (payload) await writeCache(networkId, payload);
    const entry = payload
      ? { version: payload.version, at: Date.now(), data: payload.data }
      : cached;
    return merge(networkId, entry);
  })().finally(() => inFlight.delete(networkId));

  inFlight.set(networkId, run);
  return run;
}

/**
 * Whichever of the fetched and bundled lists is newer.
 *
 * Not a union of the two. A merge would resurrect an entry the server deliberately
 * dropped — an issuer that turned out to be an impostor, say — and that entry
 * would come back marked exactly as it was the day we vouched for it. A registry
 * has to be able to shrink.
 */
function merge(networkId: string, cached: CachedRegistry | null): RegistryAsset[] {
  const bundled = bundledAssets(networkId);
  if (!cached) return sortVerifiedFirst(bundled);
  if (cached.version < BUNDLED_ASSETS_VERSION) return sortVerifiedFirst(bundled);
  return sortVerifiedFirst(cached.data);
}

/** Verified first; the source order is kept within each group. */
function sortVerifiedFirst(list: readonly RegistryAsset[]): RegistryAsset[] {
  return [...list].sort((a, b) => Number(b.verified) - Number(a.verified));
}

/* -------------------------------- lookup -------------------------------- */

/**
 * The registry entry for an exact (code, issuer) pair, or null.
 *
 * Matched on the full key, never on the code. A lookup by code is the bug this
 * whole module exists to prevent: it would answer "Circle" for any of the twenty
 * accounts issuing `USDC`, and the answer would be shown to a user deciding
 * whether to trust one of them.
 */
export function findRegistryAsset(
  list: readonly RegistryAsset[],
  ref: AssetRef | null | undefined,
): RegistryAsset | null {
  if (!ref) return null;
  const key = assetKey(ref);
  return list.find((a) => assetKey(a) === key) ?? null;
}

/** True when the pair is one we vouch for. Unknown pairs are not verified. */
export function isVerifiedAsset(
  list: readonly RegistryAsset[],
  ref: AssetRef | null | undefined,
): boolean {
  return findRegistryAsset(list, ref)?.verified ?? false;
}

/**
 * Who issues this asset, for display — `Circle`, `Tether`, or empty when we do
 * not know.
 *
 * Empty rather than a guess: a screen showing nothing prompts the user to look at
 * the issuer address, while a screen showing a plausible-looking name they cannot
 * check is worse than one showing none.
 */
export function issuerLabel(
  list: readonly RegistryAsset[],
  ref: AssetRef | null | undefined,
): string {
  return findRegistryAsset(list, ref)?.issuerName ?? '';
}
