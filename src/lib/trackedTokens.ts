/**
 * The tokens a person added to their wallet beyond each network's registry tokens ("Añadir
 * activo" on any network but Stellar, where adding is a trustline on the ledger). Adding one
 * here only makes the wallet READ its balance and list it (lib/networkBalances.ts takes them
 * with the registry's); it never makes it payable — `sendNetworkTransfer` pays out the coin and
 * the registry's own contracts only, whatever is tracked.
 *
 * Kept per wallet, in this device's storage: a list of `{ symbol, asset, decimals }` per network,
 * not a secret. What comes back from storage is checked like any input — a contract that is not
 * one on its network is dropped, never read.
 *
 * Trackable networks are the ones whose balance source reads a token by its contract today: the
 * EVM ones, Solana and Fogo, Tron, NEAR, Sui, Aptos and Movement. TON's jettons, Starknet and
 * the UTXO and account chains with no tokens are not.
 */
import { NETWORKS, type NetworkId, type NetworkToken } from '@/constants/networks';
import { storageGet, storageSet } from '@/lib/storage';

export type TrackedTokens = Partial<Record<NetworkId, NetworkToken[]>>;

const TRACKABLE_SOURCES = new Set(['evm', 'svm', 'trongrid', 'near', 'sui', 'aptos']);

export function canTrack(network: NetworkId): boolean {
  const source = NETWORKS[network].balance;
  return !!source && TRACKABLE_SOURCES.has(source.kind);
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A contract as its network spells one — the only kind a balance source is ever asked about. */
export function isTokenAsset(network: NetworkId, asset: string): boolean {
  switch (NETWORKS[network].balance?.kind) {
    case 'evm':
      return /^0x[0-9a-fA-F]{40}$/.test(asset);
    case 'svm':
      return BASE58.test(asset) && asset.length >= 32 && asset.length <= 44;
    case 'trongrid':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(asset);
    case 'near':
      return asset.length >= 2 && asset.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(asset);
    case 'sui':
      return /^0x[0-9a-fA-F]{1,64}::\w+::\w+$/.test(asset);
    case 'aptos':
      return /^0x[0-9a-fA-F]{1,64}(::\w+::\w+)?$/.test(asset);
    default:
      return false;
  }
}

/** One token, checked; an EVM contract kept lower case so it compares as one. */
export function toTrackedToken(network: NetworkId, raw: { symbol: unknown; asset: unknown; decimals: unknown }): NetworkToken | null {
  const { symbol, asset, decimals } = raw;
  if (typeof symbol !== 'string' || !/^[\p{L}\p{N}$._()-]{1,24}$/u.test(symbol)) return null;
  if (typeof asset !== 'string' || !canTrack(network) || !isTokenAsset(network, asset)) return null;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  return { symbol, asset: NETWORKS[network].balance?.kind === 'evm' ? asset.toLowerCase() : asset, decimals };
}

const sameAsset = (network: NetworkId, a: string, b: string) => (NETWORKS[network].balance?.kind === 'evm' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Already read without being added: the network's registry token. */
export function isRegistryToken(network: NetworkId, asset: string): boolean {
  return NETWORKS[network].tokens.some((t) => sameAsset(network, t.asset, asset));
}

export function isTracked(tracked: TrackedTokens, network: NetworkId, asset: string): boolean {
  return (tracked[network] ?? []).some((t) => sameAsset(network, t.asset, asset));
}

export function withToken(tracked: TrackedTokens, network: NetworkId, token: NetworkToken): TrackedTokens {
  if (isTracked(tracked, network, token.asset) || isRegistryToken(network, token.asset)) return tracked;
  return { ...tracked, [network]: [...(tracked[network] ?? []), token] };
}

export function withoutToken(tracked: TrackedTokens, network: NetworkId, asset: string): TrackedTokens {
  const left = (tracked[network] ?? []).filter((t) => !sameAsset(network, t.asset, asset));
  const next = { ...tracked };
  if (left.length) next[network] = left;
  else delete next[network];
  return next;
}

/** The tokens a balance read asks about on `network`: the registry's, then the added ones. */
export function tokensToRead(tracked: TrackedTokens, network: NetworkId): NetworkToken[] {
  return [...NETWORKS[network].tokens, ...(tracked[network] ?? [])];
}

const keyOf = (walletId: string) => `cosmos.tracked.${walletId}`;

export async function readTracked(walletId: string): Promise<TrackedTokens> {
  let raw: unknown;
  try {
    raw = JSON.parse((await storageGet(keyOf(walletId))) ?? '{}');
  } catch {
    return {};
  }
  const out: TrackedTokens = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [net, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.hasOwn(NETWORKS, net) || !Array.isArray(list)) continue;
    const id = net as NetworkId;
    const tokens = list.map((t) => (t && typeof t === 'object' ? toTrackedToken(id, t as Record<string, unknown> as never) : null)).filter((t): t is NetworkToken => !!t);
    if (tokens.length) out[id] = tokens;
  }
  return out;
}

export async function writeTracked(walletId: string, tracked: TrackedTokens): Promise<void> {
  await storageSet(keyOf(walletId), JSON.stringify(tracked));
}
