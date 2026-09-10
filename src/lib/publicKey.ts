/**
 * The shared API key that lets a wallet with no CosmosPay account still swap,
 * add liquidity, create a pay link and report its own crashes.
 *
 * Before this existed, every one of those screens ended at "create an account
 * first" — a registration wall in front of the thing the user opened the app to
 * do. Now the wallet always has a credential: its own if the user registered, and
 * this one otherwise. What differs is the price, not the capability. The public
 * key is attributed to the `community` plan, whose swap commission is 150 bps —
 * the highest rate on the board — and the gateway injects that rate per consumer,
 * so it can be neither passed as a parameter nor undercut. Registering is what
 * buys a lower one, which makes the account an offer rather than a toll gate.
 *
 * **It is not a secret, and nothing here pretends otherwise.** It ships inside an
 * open-source binary on public app stores. What keeps it safe is on the server:
 * it is minted with `role: 'public'`, and the gateway confines that role to
 * handlers that return no per-consumer rows — quotes, envelope builders, on-chain
 * reads, telemetry ingest. Every endpoint that replays what a consumer previously
 * wrote refuses it, because all anonymous wallets are that one consumer. And it
 * signs nothing: the gateway hands back an unsigned envelope and the device holds
 * the key that signs it, so the wallet stays non-custodial either way.
 *
 * Fetched rather than only compiled in, so a rotation takes effect without an
 * app-store review. The build-time value is the fallback for a wallet that cannot
 * reach the platform — which is also why a failed fetch is not an error worth
 * showing anyone.
 */
import { PUBLIC_KEY_TTL_MS } from '@/constants/api';
import { devPlatformUrl } from '@/lib/endpoints';
import { object, parseShape, str, type Check } from '@/lib/apiShape';

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Compiled-in fallbacks. Empty by default: a build that sets neither simply has
 * no public access until it can reach the platform, which is the honest state
 * rather than a placeholder that produces a 401 somewhere far from here.
 */
const BUILT_IN: Record<'dev' | 'prod', string> = {
  dev: ENV.PUBLIC_COSMOS_PUBLIC_KEY_DEV ?? '',
  prod: ENV.PUBLIC_COSMOS_PUBLIC_KEY_PROD ?? '',
};

/**
 * `apiKey` is nullable in the contract because the platform answers with an
 * explicit null when an environment has no key provisioned. That is a real state
 * and reads better than an empty string, which would look like a usable key right
 * up until the gateway refused it.
 */
const PublicKeyShape: Check<unknown> = object({ env: str });

interface Cached {
  at: number;
  key: string;
}

const cache = new Map<'dev' | 'prod', Cached>();
const inFlight = new Map<'dev' | 'prod', Promise<string>>();

/**
 * The public key for an environment, without waiting.
 *
 * Synchronous because the call sites are synchronous: the store resolves an API
 * key inside `useCallback`s that a button press runs, and making those async
 * would turn "the user tapped swap" into a round trip. {@link warmPublicKey}
 * fills this in the background, and until it lands the compiled-in value answers.
 */
export function cachedPublicKey(env: 'dev' | 'prod'): string | null {
  return cache.get(env)?.key || BUILT_IN[env] || null;
}

/**
 * Fetch the public key for an environment and cache it.
 *
 * Never throws and never reports: failing means the user falls back to the
 * compiled-in key, or — if the build shipped none — to the same "create an
 * account" path that existed before. Both are handled states, not errors.
 */
export async function warmPublicKey(env: 'dev' | 'prod'): Promise<string | null> {
  const hit = cache.get(env);
  if (hit && Date.now() - hit.at < PUBLIC_KEY_TTL_MS) return hit.key;

  const pending = inFlight.get(env);
  if (pending) return pending;

  const url = `${devPlatformUrl()}/api/public-key?env=${env}`;
  const run = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return '';
      const json: unknown = await res.json();
      // The dev platform wraps responses in `{ data, code, status, message }`.
      const payload =
        json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)
          ? (json as { data: unknown }).data
          : json;
      parseShape(url, PublicKeyShape, payload);
      const key = (payload as { apiKey?: unknown }).apiKey;
      if (typeof key !== 'string' || !key) return '';
      cache.set(env, { at: Date.now(), key });
      return key;
    } catch {
      return '';
    }
  })().finally(() => inFlight.delete(env));

  inFlight.set(env, run);
  const key = await run;
  return key || cachedPublicKey(env);
}

/**
 * True when `key` is the shared public one rather than an account's own.
 *
 * Callers use this to decide what a key MEANS, not whether it works: telemetry
 * strips account-identifying props under it, and the swap screen shows the public
 * commission with the offer to lower it. Compared by value against what we
 * handed out, because nothing in the key's text marks it as shared — a wallet
 * cannot tell by looking, and guessing from a prefix would be wrong the day the
 * format changes.
 */
export function isPublicKey(key: string | null | undefined): boolean {
  if (!key) return false;
  for (const env of ['dev', 'prod'] as const) {
    if (key === cache.get(env)?.key || (BUILT_IN[env] && key === BUILT_IN[env])) return true;
  }
  return false;
}
