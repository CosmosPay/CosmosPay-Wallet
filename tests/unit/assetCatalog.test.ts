/**
 * "Add an asset" on every network (src/lib/assetCatalog.ts, src/lib/trackedTokens.ts). What is
 * pinned: every network but Stellar offers its coin and registry tokens as always read; a NEAR
 * Intents token is offered to add only on a network that can read one and only with a contract
 * that is one there; nothing is offered twice; and what storage hands back is checked again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_IDS, NETWORKS } from '@/constants/networks';
import { buildCatalog, shortAsset } from '@/lib/assetCatalog';
import { canTrack, isTokenAsset, readTracked, toTrackedToken, tokensToRead, withToken, withoutToken, writeTracked } from '@/lib/trackedTokens';
import type { CrossChainAsset } from '@/lib/cosmospay';

const intent = (chain: string, symbol: string, contract: string | null, decimals = 18): CrossChainAsset => ({
  chain: chain as CrossChainAsset['chain'],
  symbol,
  assetId: `${chain}:${symbol}`,
  decimals,
  contract,
});

test('every network but Stellar offers its coin, always read', () => {
  const natives = buildCatalog(null).filter((e) => e.kind === 'native');
  assert.equal(natives.length, NETWORK_IDS.length - 1);
  assert.ok(!natives.some((e) => e.network === 'stellar'));
});

test('a listed token is addable only where it can be read, with a real contract, and once', () => {
  const list = [
    intent('base', 'BRETT', '0x532f27101965dd16442E59d40670FaF5eBB142E4'),
    intent('base', 'BRETT', '0x532f27101965dd16442e59d40670faf5ebb142e4'), // the same, other case
    intent('base', 'BAD', 'not-a-contract'),
    intent('ton', 'USDT', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 6), // TON cannot read jettons yet
    intent('near', 'wNEAR', 'wrap.near', 24),
    intent('base', 'USDC', NETWORKS.base.tokens[0]?.asset ?? '0x0', 6), // the registry's own
  ];
  const addable = buildCatalog(list).filter((e) => e.kind === 'addable');
  assert.deepEqual(
    addable.map((e) => `${e.network}:${e.symbol}:${e.asset}`),
    ['base:BRETT:0x532f27101965dd16442e59d40670faf5ebb142e4', 'near:wNEAR:wrap.near'],
  );
  assert.equal(canTrack('ton'), false);
  assert.equal(canTrack('base'), true);
});

test('contracts are checked per network', () => {
  assert.ok(isTokenAsset('eth', '0x' + 'a'.repeat(40)));
  assert.ok(!isTokenAsset('eth', '0x' + 'a'.repeat(39)));
  assert.ok(isTokenAsset('solana', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'));
  assert.ok(isTokenAsset('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));
  assert.ok(isTokenAsset('near', 'token.0xshitzu.near'));
  assert.ok(isTokenAsset('sui', '0xdba3::usdc::USDC'));
  assert.ok(isTokenAsset('aptos', '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b'));
  assert.ok(!isTokenAsset('btc', 'anything'));
  assert.equal(toTrackedToken('eth', { symbol: '<script>', asset: '0x' + 'a'.repeat(40), decimals: 18 }), null);
  assert.equal(toTrackedToken('eth', { symbol: 'X', asset: '0x' + 'a'.repeat(40), decimals: 99 }), null);
});

test('added tokens are read after the registry’s, added once, and removed', () => {
  const tok = { symbol: 'BRETT', asset: '0x532f27101965dd16442e59d40670faf5ebb142e4', decimals: 18 };
  let tracked = withToken({}, 'base', tok);
  tracked = withToken(tracked, 'base', tok);
  assert.equal(tracked.base?.length, 1);
  assert.deepEqual(tokensToRead(tracked, 'base').at(-1), tok);
  assert.equal(tokensToRead(tracked, 'base').length, NETWORKS.base.tokens.length + 1);
  tracked = withoutToken(tracked, 'base', tok.asset.toUpperCase().replace('0X', '0x'));
  assert.equal(tracked.base, undefined);
});

test('storage is read back through the same checks', async () => {
  await writeTracked('w-cat', { base: [{ symbol: 'BRETT', asset: '0x532f27101965dd16442e59d40670faf5ebb142e4', decimals: 18 }] });
  assert.equal((await readTracked('w-cat')).base?.length, 1);
  // a tampered entry is dropped, never read
  await writeTracked('w-cat', { base: [{ symbol: 'X', asset: 'https://evil', decimals: 18 }] } as never);
  assert.deepEqual(await readTracked('w-cat'), {});
});

test('a contract is shortened with both ends kept', () => {
  assert.equal(shortAsset('0x532f27101965dd16442e59d40670faf5ebb142e4'), '0x532f…42e4');
  assert.equal(shortAsset('wrap.near'), 'wrap.near');
  assert.equal(shortAsset('0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'), '0xdba3…00e7');
});

test('an added token is listed and priced only by NEAR Intents, never by its symbol', async () => {
  const { networkRows, intentsPriceOf } = await import('@/lib/portfolio');
  const fake = { symbol: 'USDC', asset: '0x' + 'b'.repeat(40), decimals: 6 };
  const holdings = { base: { native: 0n, [fake.asset]: 5_000_000n } };
  const noPrice = networkRows(holdings, { USDC: { usd: 1, change24h: 0 } } as never, { tracked: { base: [fake] } });
  assert.equal(noPrice.length, 1); // the coin at zero is not a row; the added token is, at any balance
  assert.equal(noPrice[0].price, null, 'a token named USDC is not the registry’s USDC');
  const priced = networkRows(holdings, {}, {
    tracked: { base: [fake] },
    priceOf: intentsPriceOf([{ chain: 'base', symbol: 'USDC', assetId: 'x', decimals: 6, contract: fake.asset.toUpperCase().replace('0X', '0x'), priceUsd: 0.5 }]),
  });
  assert.equal(priced[0].value, 2.5);
  // on Solana and Monad only added tokens come from here; the coin is chainRows'
  const sol = networkRows({ solana: { native: 9n, EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: 3n } }, {}, {
    tracked: { solana: [{ symbol: 'WIF', asset: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6 }] },
  });
  assert.deepEqual(
    sol.map((r) => r.code),
    ['WIF'],
  );
});

test('in a test mode the catalog is each test network’s coin, nothing from a main network', async () => {
  const { hasTestNetwork } = await import('@/lib/testnets');
  const list = [intent('base', 'BRETT', '0x532f27101965dd16442E59d40670FaF5eBB142E4'), intent('near', 'wNEAR', 'wrap.near', 24)];
  const test = buildCatalog(list, 'testnet');
  assert.ok(test.every((e) => e.kind === 'native' && hasTestNetwork(e.network)));
  assert.ok(!test.some((e) => e.network === 'doge' || e.network === 'scroll'));
  assert.ok(test.some((e) => e.network === 'base') && test.some((e) => e.network === 'btc'));
});
