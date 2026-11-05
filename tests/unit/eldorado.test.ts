/**
 * Buying with local money through the P2P widget (src/lib/eldorado.ts). What is pinned: only
 * a currency with a BUY price, a minimum and a payment method is offered, named in the
 * person's language; the amount is refused under the minimum and the estimate is the price
 * division rounded down; test mode delivers the sandbox's test USDT and mainnet Arbitrum's
 * registry tokens; and the widget URL always fixes the wallet's own 0x address as the
 * recipient, or is not built at all.
 *
 * The fixtures are trimmed copies of the public API's answers on 2026-11-05.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELDORADO_TEST_USDT } from '@/constants/eldorado';
import { NETWORKS } from '@/constants/networks';
import { buildMarket, p2pAmountProblem, p2pEstimate, p2pReference, p2pTokens, p2pWidgetUrl } from '@/lib/eldorado';

const currencies = {
  currencies: [
    { id: 'ARS', type: 'FIAT', description: { es: 'Pesos Argentinos', en: 'Argentine Pesos', pt: 'Pesos Argentinos' } },
    { id: 'BRL', type: 'FIAT', description: { es: 'Reales Brasileños', en: 'Brazilian Reais' } },
    { id: 'BOB', type: 'FIAT', description: { en: 'Bolivian Bolivianos' } },
    { id: 'USDT', type: 'CRYPTO', description: { en: 'Tether' } },
  ],
};
const methods = {
  paymentMethods: [
    { id: 'bank_tx_ar', name: 'Bank Transfer (ARS)', currency: 'ARS' },
    { id: 'app_pix_brl', name: 'PIX', currency: 'BRL' },
  ],
};
const prices = {
  BUY: {
    ARS: { limits: { in: { min: '8389.45' }, out: { min: '5' } }, price: '1677.89' },
    BRL: { limits: { in: { min: '30.015' }, out: { min: '5' } }, price: '6.003' },
    BOB: { limits: { in: { min: '60.4475' }, out: { min: '5' } }, price: '12.0895' },
    USDT: { limits: { in: { min: '5' } }, price: '1' },
  },
};

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';

test('only a buyable fiat currency is offered, named in the person’s language', () => {
  const market = buildMarket(currencies, methods, prices, 'es');
  // BOB has a price but no payment method; USDT is not fiat.
  assert.deepEqual(market.currencies.map((c) => c.id), ['ARS', 'BRL']);
  const ars = market.currencies[0];
  assert.equal(ars.name, 'Pesos Argentinos');
  assert.equal(ars.price, 1677.89);
  assert.equal(ars.minIn, 8389.45);
  assert.deepEqual(ars.methods, [{ id: 'bank_tx_ar', name: 'Bank Transfer (ARS)' }]);
  // A language the API does not carry falls back to English, then to the code.
  assert.equal(buildMarket(currencies, methods, prices, 'de').currencies[1].name, 'Brazilian Reais');
});

test('a currency without a usable price or minimum is left out, not offered and refused later', () => {
  const broken = { BUY: { ARS: { price: '0', limits: { in: { min: '10' } } }, BRL: { price: '6' } } };
  assert.deepEqual(buildMarket(currencies, methods, broken, 'en').currencies, []);
});

test('the amount is refused under the minimum, and the estimate rounds down', () => {
  const ars = buildMarket(currencies, methods, prices, 'en').currencies[0];
  assert.equal(p2pAmountProblem('', ars), 'empty');
  assert.equal(p2pAmountProblem('8000', ars), 'below-min');
  assert.equal(p2pAmountProblem('50000', ars), null);
  // Comma is a decimal separator, as everywhere in the wallet.
  assert.equal(p2pAmountProblem('8389,45', ars), null);
  // 50000 / 1677.89 = 29.799…: an estimate never promises more than the price gives.
  assert.equal(p2pEstimate('50000', ars), 29.79);
  assert.equal(p2pEstimate('', ars), null);
});

test('test mode delivers the sandbox’s test USDT, mainnet Arbitrum’s registry tokens', () => {
  assert.deepEqual(p2pTokens('testnet'), [ELDORADO_TEST_USDT]);
  assert.deepEqual(p2pTokens('mainnet'), NETWORKS.arb.tokens);
  assert.ok(p2pTokens('mainnet').some((x) => x.symbol === 'USDC'));
});

test('the widget URL fixes the wallet’s own address as the recipient', () => {
  const token = NETWORKS.arb.tokens.find((x) => x.symbol === 'USDC')!;
  const url = new URL(
    p2pWidgetUrl({ env: 'mainnet', address: ADDRESS, currency: 'ARS', method: 'bank_tx_ar', token, amount: '50000,5' })!,
  );
  assert.equal(url.origin + url.pathname, 'https://widget.eldorado.io/exchange');
  assert.equal(url.searchParams.get('operation'), 'BUY');
  assert.equal(url.searchParams.get('address'), ADDRESS);
  assert.equal(url.searchParams.get('token'), token.asset);
  assert.equal(url.searchParams.get('chain'), '42161');
  assert.equal(url.searchParams.get('currency'), 'ARS');
  assert.equal(url.searchParams.get('paymentMethod'), 'bank_tx_ar');
  assert.equal(url.searchParams.get('amount'), '50000.5');
  // No integrator ids configured: none are sent.
  assert.equal(url.searchParams.get('clientId'), null);
  assert.equal(url.searchParams.get('externalReferenceId'), null);
});

test('test mode opens the test widget on Arbitrum Sepolia', () => {
  const url = new URL(
    p2pWidgetUrl({ env: 'testnet', address: ADDRESS, currency: 'ARS', method: 'bank_tx_ar', token: ELDORADO_TEST_USDT, amount: '6000' })!,
  );
  assert.equal(url.origin, 'https://widget-testnet.eldorado.io');
  assert.equal(url.searchParams.get('chain'), '421614');
  assert.equal(url.searchParams.get('token'), ELDORADO_TEST_USDT.asset);
});

test('without a 0x address there is no URL: the purchase would land in someone else’s wallet', () => {
  const token = ELDORADO_TEST_USDT;
  const base = { env: 'mainnet' as const, currency: 'ARS', method: 'bank_tx_ar', token, amount: '50000' };
  assert.equal(p2pWidgetUrl({ ...base, address: '' }), null);
  assert.equal(p2pWidgetUrl({ ...base, address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' }), null);
  assert.equal(p2pWidgetUrl({ ...base, address: ADDRESS, amount: '0' }), null);
});

test('integrator ids and the reference ride in the URL when given', () => {
  const url = new URL(
    p2pWidgetUrl({
      env: 'mainnet',
      address: ADDRESS,
      currency: 'BRL',
      method: 'app_pix_brl',
      token: ELDORADO_TEST_USDT,
      amount: '100',
      clientId: 'client-1',
      referralId: 'ref-1',
      reference: p2pReference(() => 'ab12_cd/34'),
    })!,
  );
  assert.equal(url.searchParams.get('clientId'), 'client-1');
  assert.equal(url.searchParams.get('referralId'), 'ref-1');
  // Only letters, digits and hyphens survive: what the API accepts.
  assert.equal(url.searchParams.get('externalReferenceId'), 'cw-ab12cd34');
});
