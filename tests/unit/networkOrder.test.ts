/**
 * The neutral network order (src/lib/networkOrder.ts): what Home's network filter and Send's
 * asset picker fall back on when what is held does not decide. Never the registry's order,
 * whose first three are Stellar, Solana and Monad.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import { NETWORKS_BY_NAME, byHolding, networkRank } from '@/lib/networkOrder';

const LEGACY_THREE: NetworkId[] = ['stellar', 'solana', 'monad'];

test('every network is in the neutral order once, A to Z by name', () => {
  assert.equal(NETWORKS_BY_NAME.length, NETWORK_IDS.length);
  assert.deepEqual([...NETWORKS_BY_NAME].sort(), [...NETWORK_IDS].sort());
  const names = NETWORKS_BY_NAME.map((id) => NETWORKS[id].name.toLowerCase());
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
  for (const id of NETWORK_IDS) assert.equal(NETWORKS_BY_NAME[networkRank(id)], id);
});

test('the neutral order does not start with Stellar, Solana and Monad', () => {
  for (const id of NETWORKS_BY_NAME.slice(0, 3)) assert.ok(!LEGACY_THREE.includes(id), id);
  // Nor does any run of them lead: the first of the three sits past the first few networks.
  assert.ok(Math.min(...LEGACY_THREE.map(networkRank)) >= 3);
});

test('held first by value, an unpriced holding after the priced ones, then the rest by name', () => {
  const row = (network: NetworkId, held: boolean, value: number | null, code: string = network) => ({ network, held, value, code });
  const list = [
    row('stellar', false, null),
    row('solana', false, null),
    row('monad', false, null),
    row('eth', false, null),
    row('base', true, 20),
    row('stellar', true, 5, 'XLM'),
    row('arb', true, null),
    row('btc', true, 500),
  ];
  assert.deepEqual(
    byHolding(list).map((r) => `${r.code}${r.held ? '*' : ''}`),
    ['btc*', 'base*', 'XLM*', 'arb*', 'eth', 'monad', 'solana', 'stellar'],
  );
  // A network's own rows keep the order they came in (the coin ahead of its tokens).
  const tokens = byHolding([row('base', false, null, 'ETH'), row('base', false, null, 'USDC'), row('abs', false, null, 'ETH')]);
  assert.deepEqual(tokens.map((r) => `${r.network}:${r.code}`), ['abs:ETH', 'base:ETH', 'base:USDC']);
});
