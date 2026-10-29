/**
 * Test mode, network by network (src/lib/testnets.ts, src/constants/testnets.ts). What is pinned:
 * a test network is its own definition — its name, chain id, endpoint, no tokens — never the main
 * one's; it sends only where a signature can be bound to it (an EVM chain id, Fogo's checked
 * genesis); a network with none is absent; and the same key's address is re-encoded where the
 * format names the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_IDS, NETWORKS } from '@/constants/networks';
import { TESTNETS } from '@/constants/testnets';
import { hasTestNetwork, networkDefOn, networkNameOn, sendFeeReserveOn, sendsOn, svmGenesisOn, testnetAddress } from '@/lib/testnets';
import { SEND_FEE_RESERVE, SVM_GENESIS_HASH } from '@/constants/networks';

test('a test network is its own: chain id, endpoint, name; coin only', () => {
  const sepolia = networkDefOn('eth', 'testnet');
  assert.ok(sepolia);
  assert.equal(sepolia.evmChainId, 11155111);
  assert.notEqual(sepolia.evmChainId, NETWORKS.eth.evmChainId);
  assert.deepEqual(sepolia.tokens, []);
  assert.equal(networkNameOn('eth', 'testnet'), 'Ethereum Sepolia');
  assert.equal(networkDefOn('eth', 'mainnet'), NETWORKS.eth);
});

test('a test network sends only where the signature is bound to it', () => {
  // EVM: the test chain id; Fogo: its own genesis, never the main one's
  assert.equal(networkDefOn('eth', 'testnet')?.send, true);
  assert.equal(networkDefOn('hood', 'testnet')?.send, true);
  assert.equal(networkDefOn('fogo', 'testnet')?.send, true);
  assert.ok(svmGenesisOn('fogo', 'testnet'));
  assert.notEqual(svmGenesisOn('fogo', 'testnet'), SVM_GENESIS_HASH.fogo);
  assert.equal(svmGenesisOn('fogo', 'mainnet'), SVM_GENESIS_HASH.fogo);
  // TON's v4R2 transfer would replay on mainnet: it sends there and never in test mode
  assert.equal(sendsOn('ton', 'mainnet'), true);
  assert.equal(sendsOn('ton', 'testnet'), false);
  // a network with no test network here sends nothing in test mode
  for (const id of ['doge', 'bch', 'dash', 'zec'] as const) assert.equal(sendsOn(id, 'testnet'), false, id);
  assert.ok(sendsOn('stellar', 'testnet') && sendsOn('solana', 'testnet') && sendsOn('monad', 'testnet'));
  // every test network that sends has a fee reserve, so no send is refused by a missing one
  for (const id of NETWORK_IDS) {
    if (networkDefOn(id, 'testnet')?.send) assert.ok(sendFeeReserveOn(id, 'testnet') > 0n, id);
  }
  assert.equal(sendFeeReserveOn('eth', 'testnet'), SEND_FEE_RESERVE.eth);
});

test('no test endpoint is a main one', () => {
  for (const [id, t] of Object.entries(TESTNETS)) {
    const main = NETWORKS[id as keyof typeof NETWORKS].balance;
    assert.notDeepEqual(t!.balance, main, id);
    if (t!.evmChainId !== undefined) assert.notEqual(t!.evmChainId, NETWORKS[id as keyof typeof NETWORKS].evmChainId, id);
  }
});

test('a network with no test network here is absent in test mode', () => {
  for (const id of ['doge', 'bch', 'dash', 'zec', 'scroll'] as const) {
    assert.equal(hasTestNetwork(id), false, id);
    assert.equal(networkDefOn(id, 'testnet'), null, id);
    assert.equal(testnetAddress(id, 'anything'), null, id);
  }
  assert.ok(hasTestNetwork('stellar') && hasTestNetwork('solana') && hasTestNetwork('monad'));
  assert.ok(NETWORK_IDS.filter(hasTestNetwork).length >= 27);
});

test('the same key on a test network: re-encoded where the address names its network', () => {
  // BIP-173's test vector: the same witness program on main and test networks
  assert.equal(testnetAddress('btc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
  assert.match(testnetAddress('ltc', 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9') ?? '', /^tltc1q/);
  assert.equal(testnetAddress('btc', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'), null, 'not a main address');
  assert.equal(testnetAddress('eth', '0xabc'), '0xabc');
});
