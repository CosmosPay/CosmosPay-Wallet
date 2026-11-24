/**
 * Copy a person reads never names the services Cosmos Pay is built on (the product owner's
 * rule); only the terms of service and the privacy text may. Found in an e2e run (2026-11-24):
 * "…procesar swaps y pagos (BlindPay)" in the Cosmos Pay menu and "USDB · Emitido por BlindPay"
 * in Swap and "Add an asset", and the swap's route named its markets and NEAR Intents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from '@/lib/i18n';
import { namesProvider } from '@/lib/providerNames';
import { PROVIDER_NAMES } from '@/constants/providerNames';
import { ASSET_META } from '@/constants/assets';
import { BUNDLED_ASSETS } from '@/constants/assetRegistry';

/** The keys whose text is the terms of service or the privacy text: the one place a name may appear. */
const LEGAL_KEY = /^(terms|privacy)\./;

test('the list holds every name the product owner listed', () => {
  for (const name of ['NEAR Intents', '1Click', 'LayerZero', 'Jupiter', 'Kuru', 'OpenZeppelin', 'BlindPay', 'Trustless Work']) {
    assert.ok((PROVIDER_NAMES as readonly string[]).includes(name), `${name} is missing from PROVIDER_NAMES`);
  }
});

test('no i18n value names a provider, in any language', () => {
  const named: string[] = [];
  for (const [key, row] of Object.entries(T)) {
    if (LEGAL_KEY.test(key)) continue;
    for (const [lang, value] of Object.entries(row as Record<string, string>)) {
      if (namesProvider(value)) named.push(`${key}.${lang}: ${value}`);
    }
  }
  assert.deepEqual(named, [], `user-facing copy names a provider:\n${named.join('\n')}`);
});

test('no asset name or issuer the wallet ships names a provider', () => {
  for (const [code, meta] of Object.entries(ASSET_META)) assert.ok(!namesProvider(meta.name), `${code}: ${meta.name}`);
  for (const asset of Object.values(BUNDLED_ASSETS).flat()) {
    assert.ok(!namesProvider(asset.name) && !namesProvider(asset.issuerName), `${asset.code}: ${asset.name} / ${asset.issuerName}`);
  }
});

test('the match ignores case and finds a name inside a sentence', () => {
  assert.equal(namesProvider('Intercambiar vía near intents'), true);
  assert.equal(namesProvider('Kuru Flow'), true);
  assert.equal(namesProvider('Swap with Cosmos Pay'), false);
});
