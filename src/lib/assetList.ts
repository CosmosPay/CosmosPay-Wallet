/**
 * Home's asset list as it is: which rows are listed, which networks the filter offers and what
 * each holds, and the search. Pure, so it is unit-tested (tests/unit/assetList.test.ts).
 *
 * What is listed is what the wallet holds: every Stellar row (XLM and the trustlines the person
 * added, which they chose to keep even at zero), a token the person added on any other network
 * (the same choice), and otherwise only a balance above zero — a native coin at 0 is not a
 * holding, on Solana and Monad no more than on the thirty others. The filter offers every network the wallet has an address on, with what it holds: the
 * ones with assets first, by value, then the rest — whose balance is either read as nothing or
 * could not be read, and says which.
 */
import { NETWORK_IDS, type NetworkId } from '@/constants/networks';
import type { AssetRow } from '@/lib/portfolio';

export const networkOfRow = (r: AssetRow): NetworkId => r.network ?? r.chain ?? 'stellar';

export function listedRows(rows: readonly AssetRow[]): AssetRow[] {
  return rows.filter((r) => networkOfRow(r) === 'stellar' || r.amount > 0 || r.added === true);
}

export interface NetworkSummary {
  id: NetworkId;
  /** Assets listed on it. */
  count: number;
  /** Their value in dollars; null while any of them has no price. */
  value: number | null;
  /** held: something there · empty: read, nothing there · unknown: not read (yet, or it failed). */
  status: 'held' | 'empty' | 'unknown';
}

/**
 * One summary per network offered — `offered` in registry order, `known` saying whether its
 * balance was actually read — the held ones first by value, the rest after in registry order.
 */
export function networkSummaries(rows: readonly AssetRow[], offered: readonly NetworkId[], known: (id: NetworkId) => boolean): NetworkSummary[] {
  const byNet = new Map<NetworkId, AssetRow[]>();
  for (const r of rows) {
    const n = networkOfRow(r);
    byNet.set(n, [...(byNet.get(n) ?? []), r]);
  }
  const order = (id: NetworkId) => NETWORK_IDS.indexOf(id);
  const all = offered.map((id): NetworkSummary => {
    const held = byNet.get(id) ?? [];
    const value = held.some((r) => r.value === null) ? null : held.reduce((s, r) => s + (r.value ?? 0), 0);
    return { id, count: held.length, value, status: held.length > 0 ? 'held' : known(id) ? 'empty' : 'unknown' };
  });
  const held = all.filter((s) => s.status === 'held').sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || order(a.id) - order(b.id));
  const rest = all.filter((s) => s.status !== 'held').sort((a, b) => order(a.id) - order(b.id));
  return [...held, ...rest];
}

/** Lower case and without accents: "Pública" is found by "publica". */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Every word of the query is in the asset's name, its symbol or its network's name. */
export function rowMatches(query: string, fields: readonly string[]): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.map(foldText).join(' ');
  return words.every((w) => hay.includes(w));
}
