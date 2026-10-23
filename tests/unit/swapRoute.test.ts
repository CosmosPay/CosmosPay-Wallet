/**
 * The swap route table: native venue first, NEAR Intents for the rest. A route picked wrong
 * is a swap signed through the wrong path — a Jupiter swap sent to NEAR, or a Base swap
 * sent to a gateway that has no venue for it — so the whole table is pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWAP_NETWORKS, intentsListsToken, intentsTargets, swapRoute, swapTargets, venueFallback, type IntentsAsset } from '@/lib/swapRoute';
import { CHAIN_TOKENS, OTHER_CHAINS } from '@/constants/chains';

test('a swap that stays on a chain with a venue uses the venue', () => {
  assert.equal(swapRoute('stellar', 'stellar'), 'stellar-dex');
  assert.equal(swapRoute('solana', 'solana'), 'jupiter');
  assert.equal(swapRoute('monad', 'monad'), 'kuru');
});

test('a swap that stays on Ethereum, Arbitrum or Base goes through NEAR Intents', () => {
  for (const c of ['ethereum', 'arbitrum', 'base'] as const) assert.equal(swapRoute(c, c), 'intents');
});

test('Bitcoin has no same-chain swap, and every bridge is NEAR Intents', () => {
  assert.equal(swapRoute('bitcoin', 'bitcoin'), null);
  for (const a of SWAP_NETWORKS) {
    for (const b of SWAP_NETWORKS) if (a !== b) assert.equal(swapRoute(a, b), 'intents', `${a} → ${b}`);
  }
});

test('the targets offered are exactly the routes that exist', () => {
  for (const origin of SWAP_NETWORKS) {
    const targets = swapTargets(origin);
    for (const target of SWAP_NETWORKS) {
      assert.equal(targets.includes(target), swapRoute(origin, target) !== null, `${origin} → ${target}`);
    }
  }
  assert.ok(!swapTargets('bitcoin').includes('bitcoin'));
  assert.equal(swapTargets('solana')[0], 'solana', 'a chain with a venue offers itself first');
});

/* A slice of the live 1Click catalogue, look-alikes included. */
const CATALOGUE: IntentsAsset[] = [
  { chain: 'arbitrum', symbol: 'ETH', assetId: 'nep141:arb.omft.near', decimals: 18, contract: null },
  { chain: 'arbitrum', symbol: 'WETH', assetId: 'nep141:arb-weth', decimals: 18, contract: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' },
  { chain: 'arbitrum', symbol: 'USDC', assetId: 'nep141:arb-usdc', decimals: 6, contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
  { chain: 'arbitrum', symbol: 'USDT0', assetId: 'nep141:arb-usdt0', decimals: 6, contract: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
  // A token NAMED USDC at another contract — a symbol is not an identifier.
  { chain: 'base', symbol: 'USDC', assetId: 'nep141:base-fake', decimals: 6, contract: '0x0000000000000000000000000000000000000bad' },
  { chain: 'base', symbol: 'USDC', assetId: 'nep141:base-usdc', decimals: 6, contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { chain: 'base', symbol: 'ETH', assetId: 'nep141:base.omft.near', decimals: 18, contract: null },
  { chain: 'bitcoin', symbol: 'BTC', assetId: 'nep141:btc.omft.near', decimals: 8, contract: null },
  { chain: 'stellar', symbol: 'XLM', assetId: 'nep141:stellar.omft.near', decimals: 7, contract: null },
];

test('NEAR targets are the wallet’s own tokens, matched by contract, never by symbol', () => {
  const arb = intentsTargets('arbitrum', CATALOGUE).map((a) => a.assetId);
  assert.deepEqual(arb, ['nep141:arb.omft.near', 'nep141:arb-usdc', 'nep141:arb-usdt0'], 'WETH is not offered');
  const base = intentsTargets('base', CATALOGUE).map((a) => a.assetId);
  assert.deepEqual(base, ['nep141:base.omft.near', 'nep141:base-usdc'], 'the look-alike USDC is not offered');
  assert.deepEqual(intentsTargets('bitcoin', CATALOGUE).map((a) => a.symbol), ['BTC']);
  assert.deepEqual(intentsTargets('stellar', CATALOGUE).map((a) => a.symbol), ['XLM']);
});

test('a token NEAR does not list on a chain cannot pay for a NEAR swap', () => {
  const [eth, usdc] = CHAIN_TOKENS.base;
  assert.ok(intentsListsToken('base', eth, CATALOGUE));
  assert.ok(intentsListsToken('base', usdc, CATALOGUE));
  assert.ok(!intentsListsToken('ethereum', CHAIN_TOKENS.ethereum[0], CATALOGUE), 'nothing listed on ethereum here');
});

test('every chain the wallet holds has a route out', () => {
  for (const c of OTHER_CHAINS) assert.ok(swapTargets(c).length > 0, c);
});

test('a down venue falls back to NEAR Intents on Solana and Monad, and nowhere else', () => {
  assert.equal(venueFallback(swapRoute('solana', 'solana')), 'intents');
  assert.equal(venueFallback(swapRoute('monad', 'monad')), 'intents');
  assert.equal(venueFallback(swapRoute('stellar', 'stellar')), null);
  assert.equal(venueFallback(swapRoute('base', 'base')), null);
  assert.equal(venueFallback(swapRoute('solana', 'arbitrum')), null);
  assert.equal(venueFallback(null), null);
});
