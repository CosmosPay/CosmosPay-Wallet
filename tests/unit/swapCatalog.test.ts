/**
 * The swap catalogue and its routes (src/lib/swapCatalog.ts). What is pinned: a test network
 * offers Stellar's market only; on mainnet every network NEAR Intents trades is there, retiring
 * listings are not; a pair on Stellar, Solana or Monad goes through that market and anything else
 * through NEAR Intents; the wallet pays only from networks it signs on, and off the three markets
 * only with the coin or a registry token; and an estimate uses the listed prices.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_TOKENS } from '@/constants/chains';
import { NETWORKS } from '@/constants/networks';
import type { CrossChainAsset } from '@/lib/cosmospay';
import { buildSwapCatalog, canPayWith, estimateOut, receivableFrom, routeFor, tradesOnNear } from '@/lib/swapCatalog';

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const listing = (chain: string, symbol: string, contract: string | null, priceUsd = 1, decimals = 6): CrossChainAsset => ({
  chain: chain as CrossChainAsset['chain'],
  symbol,
  assetId: `${chain}:${symbol}`,
  decimals,
  contract,
  priceUsd,
});
const intents = [
  listing('stellar', 'XLM', null, 0.17, 7),
  listing('stellar', 'USDC', USDC_ISSUER, 1, 7),
  listing('solana', 'SOL', null, 150, 9),
  listing('solana', 'WIF', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 0.5),
  listing('base', 'ETH', null, 2300, 18),
  listing('base', 'USDC', NETWORKS.base.tokens[0].asset, 1),
  listing('base', 'BRETT', '0x532f27101965dd16442e59d40670faf5ebb142e4', 0.02, 18),
  listing('arb', 'USDT0(DEPRECATED)', '0x' + '1'.repeat(40), 1),
  listing('btc', 'BTC', null, 80000, 8),
];
const stellar = [
  { code: 'XLM', issuer: null, issuerName: null },
  { code: 'USDC', issuer: USDC_ISSUER, issuerName: 'Circle' },
];
const catalog = (env: 'mainnet' | 'testnet') => buildSwapCatalog({ intents, env, stellar, chainTokens: CHAIN_TOKENS });
const find = (cat: ReturnType<typeof catalog>, chain: string, symbol: string) => cat.find((t) => t.chain === chain && t.symbol === symbol)!;

test('a test network offers Stellar’s market and nothing else', () => {
  const cat = catalog('testnet');
  assert.ok(cat.every((t) => t.chain === 'stellar' && t.dex && !t.near));
  assert.equal(routeFor(find(cat, 'stellar', 'XLM'), find(cat, 'stellar', 'USDC'), 'testnet').kind, 'dex');
});

test('on mainnet every network NEAR Intents trades is there, a retiring listing is not', () => {
  const cat = catalog('mainnet');
  for (const [chain, symbol] of [['stellar', 'XLM'], ['solana', 'WIF'], ['base', 'BRETT'], ['btc', 'BTC'], ['monad', 'MON']]) assert.ok(find(cat, chain, symbol), `${chain} ${symbol}`);
  assert.ok(!cat.some((t) => t.symbol.includes('DEPRECATED')));
  assert.equal(tradesOnNear(listing('x', 'A', null, 0)), false);
  assert.equal(find(cat, 'stellar', 'USDC').issuerName, 'Circle');
});

test('routes: the chain’s market within Stellar, Solana or Monad; NEAR Intents otherwise', () => {
  const cat = catalog('mainnet');
  assert.deepEqual(routeFor(find(cat, 'solana', 'SOL'), find(cat, 'solana', 'WIF'), 'mainnet'), { kind: 'dex', chain: 'solana' });
  assert.deepEqual(routeFor(find(cat, 'stellar', 'XLM'), find(cat, 'base', 'ETH'), 'mainnet'), { kind: 'near' });
  assert.deepEqual(routeFor(find(cat, 'base', 'ETH'), find(cat, 'base', 'BRETT'), 'mainnet'), { kind: 'near' });
  assert.deepEqual(routeFor(find(cat, 'base', 'ETH'), find(cat, 'base', 'ETH'), 'mainnet'), { kind: 'none', reason: 'same-token' });
});

test('the wallet pays from networks it signs on, and off the markets with the coin or a registry token', () => {
  const cat = catalog('mainnet');
  const signs = (c: string) => c === 'stellar' || c === 'solana' || c === 'monad' || NETWORKS[c as keyof typeof NETWORKS].send;
  assert.ok(canPayWith(find(cat, 'base', 'ETH'), signs));
  assert.ok(canPayWith(find(cat, 'base', 'USDC'), signs));
  assert.equal(canPayWith(find(cat, 'base', 'BRETT'), signs), false, 'not a registry token: never paid out');
  assert.ok(canPayWith(find(cat, 'btc', 'BTC'), signs), 'the wallet signs on Bitcoin: its coin pays a NEAR Intents deposit');
  assert.equal(canPayWith(find(cat, 'btc', 'BTC'), (c) => c !== 'btc'), false, 'a network it does not sign on pays nothing');
  const recv = receivableFrom(find(cat, 'stellar', 'XLM'), cat, 'mainnet', (c) => c !== 'btc');
  assert.ok(!recv.some((t) => t.chain === 'btc'), 'no address there: not offered');
  assert.ok(recv.some((t) => t.chain === 'base' && t.symbol === 'BRETT'));
});

test('before a quote, the estimate uses the listed prices', () => {
  const cat = catalog('mainnet');
  assert.equal(estimateOut(10, find(cat, 'stellar', 'XLM'), find(cat, 'stellar', 'USDC')), 1.7000000000000002);
  assert.equal(estimateOut(0, find(cat, 'stellar', 'XLM'), find(cat, 'stellar', 'USDC')), null);
});

/* ---------------------------- USDT0's bridge ---------------------------- */

const USDT0_ISSUER = 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q';
const usdt0Routes = [
  { chain: 'eth', name: 'Ethereum', eid: 30101, receives: 'USDT' as const },
  { chain: 'arb', name: 'Arbitrum', eid: 30110, receives: 'USDT0' as const },
  { chain: 'unknownchain', name: 'Nowhere', eid: 1, receives: 'USDT0' as const },
];
const withUsdt0 = (env: 'mainnet' | 'testnet') =>
  buildSwapCatalog({
    intents: [...intents, listing('eth', 'USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 1)],
    env,
    stellar: [...stellar, { code: 'USDT0', issuer: USDT0_ISSUER, issuerName: 'Tether' }],
    chainTokens: CHAIN_TOKENS,
    usdt0Routes,
  });

test('Stellar’s USDT0 goes out through the bridge, ahead of NEAR Intents, on mainnet only', () => {
  const cat = withUsdt0('mainnet');
  const usdt0 = cat.find((t) => t.chain === 'stellar' && t.symbol === 'USDT0' && t.contract === USDT0_ISSUER)!;
  // A network NEAR Intents lists USDT on: that token, now reachable both ways.
  const ethUsdt = find(cat, 'eth', 'USDT');
  assert.ok(ethUsdt.usdt0 && ethUsdt.near, 'the listed token is marked, not duplicated');
  assert.deepEqual(routeFor(usdt0, ethUsdt, 'mainnet'), { kind: 'usdt0', chain: 'eth' });
  // A network where nothing lists it: a token only the bridge reaches, never the network's coin.
  const arb = cat.filter((t) => t.chain === 'arb' && t.usdt0);
  assert.equal(arb.length, 1);
  assert.equal(arb[0].symbol, 'USDT0');
  assert.notEqual(arb[0].contract, null, 'null is the coin everywhere in the catalogue');
  assert.deepEqual(routeFor(usdt0, arb[0], 'mainnet'), { kind: 'usdt0', chain: 'arb' });
  // A route to a network the wallet does not know adds nothing.
  assert.ok(!cat.some((t) => t.chain === ('unknownchain' as never)));
  // A destination, never a source: nothing to pay with, and no route back.
  assert.equal(canPayWith(arb[0], () => true), false);
  assert.notEqual(routeFor(arb[0], usdt0, 'mainnet').kind, 'usdt0');
  // Any other Stellar token keeps NEAR Intents.
  assert.deepEqual(routeFor(find(cat, 'stellar', 'XLM'), ethUsdt, 'mainnet'), { kind: 'near' });
  // An impostor USDT0 (same code, other issuer) is not Tether's and gets no bridge.
  const fake = { ...usdt0, key: 'stellar:USDT0:GFAKE', contract: 'G' + 'A'.repeat(55) };
  assert.notEqual(routeFor(fake, ethUsdt, 'mainnet').kind, 'usdt0');
  // A test network has no bridge at all.
  assert.ok(!withUsdt0('testnet').some((t) => t.usdt0));
});
