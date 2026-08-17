import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAmount,
  allNetworks,
  resolveNetwork,
  networkEnv,
  BUILTIN_NETWORKS,
  explorerTxUrl,
  explorerAccountUrl,
} from '@/lib/stellar';

test('normalizeAmount validates and normalizes to 7 decimals', () => {
  assert.equal(normalizeAmount('1'), '1');
  assert.equal(normalizeAmount('1.5'), '1.5');
  assert.equal(normalizeAmount('0.1234567'), '0.1234567');
  assert.equal(normalizeAmount('1.123456789'), '1.1234568'); // rounded to 7
  assert.throws(() => normalizeAmount('0'));
  assert.throws(() => normalizeAmount('-1'));
  assert.throws(() => normalizeAmount('abc'));
  assert.throws(() => normalizeAmount(''));
});

test('network tables resolve ids and fall back to testnet', () => {
  assert.equal(BUILTIN_NETWORKS.length, 2);
  const custom = [{ id: 'custom-1', label: 'C', horizon: 'https://h', passphrase: 'p', custom: true }];
  assert.equal(allNetworks(custom).length, 3);
  assert.equal(resolveNetwork('public', []).id, 'public');
  assert.equal(resolveNetwork('custom-1', custom).id, 'custom-1');
  assert.equal(resolveNetwork('nope', []).id, 'testnet'); // fallback
});

test('networkEnv maps public passphrase to prod, everything else to dev', () => {
  assert.equal(networkEnv(resolveNetwork('public', [])), 'prod');
  assert.equal(networkEnv(resolveNetwork('testnet', [])), 'dev');
  // a custom mainnet node still resolves to prod by passphrase
  assert.equal(networkEnv({ id: 'x', label: 'X', horizon: 'h', passphrase: BUILTIN_NETWORKS[1].passphrase }), 'prod');
});

test('explorer URLs only exist for the built-in networks', () => {
  const testnet = resolveNetwork('testnet', []);
  const publicNet = resolveNetwork('public', []);
  const custom = { id: 'custom-1', label: 'C', horizon: 'https://h', passphrase: 'p', custom: true };
  assert.ok(explorerTxUrl(testnet, 'abc').includes('/explorer/testnet/tx/abc'));
  assert.ok(explorerTxUrl(publicNet, 'abc').includes('/explorer/public/tx/abc'));
  assert.equal(explorerTxUrl(custom, 'abc'), ''); // custom networks have no explorer
  assert.ok(explorerAccountUrl(testnet, 'G...').includes('/explorer/testnet/account/G...'));
});
