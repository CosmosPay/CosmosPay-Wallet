/**
 * The network registry (src/constants/networks.ts) and the cross-chain helpers that read it
 * (src/lib/crossChainDest.ts): every network is listed once, the ids are the community server's,
 * what the wallet signs on has what signing needs, and addresses compare the way the server
 * normalizes them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_KINDS, NETWORKS, NETWORK_GROUPS, NETWORK_IDS, SEND_FEE_RESERVE } from '@/constants/networks';
import { crossChainDestinations, isKnownNetwork, sameNetworkAddress } from '@/lib/crossChainDest';
import { networkRows } from '@/lib/portfolio';
import type { CrossChainAsset } from '@/lib/cosmospay';

// The community server's `CROSS_CHAIN_NETWORK_IDS` (cross-chain-swaps.constants.ts), 2026-10-28:
// a swap names a network the way both sides spell it.
const SERVER_IDS = [
  'stellar', 'solana', 'monad', 'eth', 'base', 'arb', 'op', 'bsc', 'pol', 'avax', 'gnosis', 'bera', 'scroll', 'xlayer',
  'abs', 'plasma', 'hood', 'hypercore', 'btc', 'ltc', 'doge', 'bch', 'dash', 'zec', 'xrp', 'tron', 'ton', 'near', 'sui',
  'aptos', 'movement', 'starknet', 'cardano', 'aleo', 'fogo',
];

test('the registry names exactly the networks the server settles, each under its own id', () => {
  assert.deepEqual([...NETWORK_IDS].sort(), [...SERVER_IDS].sort());
  for (const id of NETWORK_IDS) assert.equal(NETWORKS[id].id, id);
});

test('every network is in exactly one address group, under the address it uses', () => {
  const seen = NETWORK_GROUPS.flatMap((g) => g.networks);
  assert.equal(seen.length, NETWORK_IDS.length);
  assert.deepEqual([...seen].sort(), [...NETWORK_IDS].sort());
  for (const g of NETWORK_GROUPS) for (const id of g.networks) assert.equal(NETWORKS[id].address, g.kind, id);
  for (const id of NETWORK_IDS) {
    const kind = NETWORKS[id].address;
    assert.ok(kind === 'stellar' || (ADDRESS_KINDS as readonly string[]).includes(kind), id);
  }
});

test('a network the wallet signs on has a node and, on EVM, the chain id a signature is bound to', () => {
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    if (!n.send || id === 'stellar') continue;
    assert.ok(n.balance, `${id} signs with no node`);
    // Hyperliquid's account is the EVM key's, paid through its own API rather than a chain.
    if (n.address === 'evm' && id !== 'hypercore') {
      assert.equal(n.balance?.kind, 'evm', id);
      assert.ok(Number.isInteger(n.evmChainId) && (n.evmChainId ?? 0) > 0, `${id} has no chain id`);
    }
    // Solana and Monad keep their own reserves (constants/chains.ts); every other network caps its fee here.
    if (id !== 'solana' && id !== 'monad') assert.ok((SEND_FEE_RESERVE[id] ?? 0n) > 0n, `${id} sends with no fee reserve`);
  }
  // The chain ids checked against chainlist and each node's own eth_chainId (2026-10-28).
  assert.deepEqual(
    Object.fromEntries(NETWORK_IDS.filter((id) => NETWORKS[id].evmChainId !== undefined).map((id) => [id, NETWORKS[id].evmChainId])),
    { monad: 143, eth: 1, base: 8453, arb: 42161, op: 10, bsc: 56, pol: 137, avax: 43114, gnosis: 100, bera: 80094, scroll: 534352, xlayer: 196, abs: 2741, plasma: 9745, hood: 4663 },
  );
});

test('EVM token contracts are 20-byte hex, lowercase, never a guessed checksum', () => {
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    if (n.address !== 'evm' || id === 'hypercore') continue;
    for (const tk of n.tokens) assert.match(tk.asset, /^0x[0-9a-f]{40}$/, `${id} ${tk.symbol}`);
  }
});

test('explorer links carry the slot they fill', () => {
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    if (n.explorerAddress) assert.ok(n.explorerAddress.includes('{address}'), id);
    if (n.explorerTx) assert.ok(n.explorerTx.includes('{tx}'), id);
    if (n.explorerAddress || n.explorerTx) assert.ok((n.explorerAddress ?? n.explorerTx ?? '').startsWith('https://'), id);
  }
});

test('addresses compare the way the server normalizes them, and no further', () => {
  const evm = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  assert.ok(sameNetworkAddress('base', evm, evm.toLowerCase()));
  assert.ok(sameNetworkAddress('btc', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU'));
  assert.ok(sameNetworkAddress('bch', 'bitcoincash:qqfx3wcg8ts09mt5l3zey06wenapyfqq2qrcyj5x0s', 'qqfx3wcg8ts09mt5l3zey06wenapyfqq2qrcyj5x0s'));
  // base58 is case-sensitive: a different spelling is a different account
  assert.ok(!sameNetworkAddress('solana', 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', 'hagk14jpmqlgt6rvgv7cbqfjwfto5dqxi472ut3dkpqk'));
  assert.ok(!sameNetworkAddress('tron', 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', 'tuezsdksodhqmezwihtdobin46zxhgwydh'));
  assert.ok(!sameNetworkAddress('eth', evm, '0x0000000000000000000000000000000000000001'));
});

test('a wallet receives the coin and the dollar stablecoins, coin first, and only known networks', () => {
  const asset = (chain: string, symbol: string, contract: string | null): CrossChainAsset =>
    ({ chain, symbol, contract, assetId: `${chain}:${symbol}`, decimals: 6 }) as CrossChainAsset;
  const list = [
    asset('eth', 'USDC', '0xa0b8'),
    asset('eth', 'PEPE', '0x6982'),
    asset('eth', 'ETH', null),
    asset('eth', 'USDT', '0xdac1'),
    asset('ton', 'GRAM', null),
    asset('adi', 'ADI', null),
  ];
  assert.deepEqual(crossChainDestinations(list, 'eth').map((a) => a.symbol), ['ETH', 'USDC', 'USDT']);
  // NEAR Intents' own name for a coin does not matter: no contract is the coin
  assert.deepEqual(crossChainDestinations(list, 'ton').map((a) => a.symbol), ['GRAM']);
  assert.ok(isKnownNetwork('eth'));
  assert.ok(!isKnownNetwork('adi'));
});

test('other networks show what is held, priced only where the price is known or the coin is a dollar', () => {
  const rows = networkRows(
    {
      base: { native: 2_000_000_000_000_000n, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 5_000_000n },
      btc: { native: 0n },
      tron: null,
    },
    { ETH: { usd: 3000, change24h: 0 } } as never,
  );
  assert.deepEqual(
    rows.map((r) => [r.network, r.code, r.amount, r.value]),
    [
      ['base', 'ETH', 0.002, 6],
      ['base', 'USDC', 5, 5],
    ],
  );
});

test('an endpoint both the registry and a sender name is the same one', async () => {
  const { STARKNET_RPC } = await import('@/constants/starknetSend');
  const { BCH_BITCORE_API } = await import('@/constants/utxoSend');
  const { CARDANO_ENDPOINTS } = await import('@/constants/cardanoSend');
  const { TON_KEEP_ALIVE } = await import('@/constants/tonSend');
  const { TESTNETS } = await import('@/constants/testnets');
  const { ACCOUNT_KEEP } = await import('@/constants/networks');
  assert.deepEqual(NETWORKS.starknet.balance, { kind: 'starknet', rpc: STARKNET_RPC.mainnet });
  assert.deepEqual(TESTNETS.starknet?.balance, { kind: 'starknet', rpc: STARKNET_RPC.testnet });
  assert.deepEqual(NETWORKS.bch.balance, { kind: 'bitcore', api: BCH_BITCORE_API });
  assert.deepEqual(NETWORKS.cardano.balance, { kind: 'yoroi', api: CARDANO_ENDPOINTS.mainnet.yoroi });
  assert.deepEqual(TESTNETS.cardano?.balance, { kind: 'yoroi', api: CARDANO_ENDPOINTS.testnet.yoroi });
  assert.equal(ACCOUNT_KEEP.ton, TON_KEEP_ALIVE);
});
