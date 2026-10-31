/**
 * Every network and asset is drawn with its own artwork (src/lib/logos.ts). What is pinned: each
 * network has a mark of its own and its file ships; each coin, registry token and known Stellar
 * asset has a logo, except the few listed below that have no artwork yet; and a coin wears its
 * network's mark everywhere but on its home network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_META } from '@/constants/assets';
import { NETWORK_IDS, NETWORKS } from '@/constants/networks';
import { NETWORK_LOGOS, TOKEN_LOGOS, isHomeCoin, networkLogoUrl, normalizeSymbol, tokenLogoUrl } from '@/lib/logos';

const shipped = (file: string) => existsSync(join(process.cwd(), 'public', 'logos', file));

/** Stellar assets with no official artwork in the set yet: they show their glyph ring. */
const NO_ARTWORK_YET = ['AQUA', 'USDB', 'yXLM'];

test('every network has its own mark, and its file ships', () => {
  for (const id of NETWORK_IDS) {
    assert.ok(NETWORK_LOGOS[id], id);
    assert.ok(shipped(NETWORK_LOGOS[id]), NETWORK_LOGOS[id]);
    assert.equal(networkLogoUrl(id), `/logos/${NETWORK_LOGOS[id]}`);
  }
  // the networks that pay in ETH are not drawn as ETH
  const ethL2s = NETWORK_IDS.filter((id) => NETWORKS[id].coin === 'ETH');
  assert.ok(ethL2s.length > 1);
  assert.equal(new Set(ethL2s.map((id) => NETWORK_LOGOS[id])).size, ethL2s.length);
});

test('every token file in the map ships', () => {
  for (const file of Object.values(TOKEN_LOGOS)) assert.ok(shipped(file), file);
});

test('every coin, registry token and known asset has a logo, but the few without artwork yet', () => {
  const codes = new Set<string>(Object.keys(ASSET_META));
  for (const id of NETWORK_IDS) {
    codes.add(NETWORKS[id].coin);
    for (const t of NETWORKS[id].tokens) codes.add(t.symbol);
  }
  const missing = [...codes].filter((c) => !tokenLogoUrl(c)).sort();
  assert.deepEqual(missing, [...NO_ARTWORK_YET].sort());
});

test('symbols are matched as NEAR Intents writes them', () => {
  assert.equal(normalizeSymbol('xDAI'), 'XDAI');
  assert.equal(normalizeSymbol('USDT0(DEPRECATED)'), 'USDT0');
  assert.equal(normalizeSymbol('$WIF'), 'WIF');
  assert.equal(tokenLogoUrl('xDAI'), '/logos/tokens/xdai.webp');
});

test('a coin wears its network mark everywhere but on its home network', () => {
  assert.equal(isHomeCoin('stellar', 'XLM'), true);
  assert.equal(isHomeCoin('eth', 'ETH'), true);
  assert.equal(isHomeCoin('base', 'ETH'), false);
  assert.equal(isHomeCoin('arb', 'ETH'), false);
  assert.equal(isHomeCoin('stellar', 'USDC'), false);
  assert.equal(isHomeCoin('solana', 'SOL'), true);
  assert.equal(isHomeCoin('fogo', 'FOGO'), true);
});
