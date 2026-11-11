/**
 * The P2P ramp's pure rules (`src/lib/p2pRamp.ts`): what an order may be, the market price and
 * estimate, which networks it may name, and the check that a session the API answered is the
 * order the person confirmed — delivering to, or sending from, this wallet's own account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyCountry,
  marketRate,
  methodLabel,
  orderKey,
  quoteRate,
  rampAmountProblem,
  rampEstimate,
  rampMinIn,
  rampNetworks,
  rampSessionProblem,
  rampWalletNetwork,
  tokenUsd,
  type RampCurrency,
  type RampMarket,
  type RampOrder,
  type RampSession,
  type RampToken,
} from '@/lib/p2pRamp';

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const USDT_ARB = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

// Recorded from the market's shape: 1 USD stablecoin = 1,650.50 ARS; the least order 10,000 ARS
// to buy, 5 USD to sell.
const ars: RampCurrency = {
  id: 'ARS',
  name: 'Argentine Peso',
  price: '1650.5',
  minAmount: '10000',
  paymentMethods: [{ id: 'bank_tx_ar', name: 'CVU/CBU o Alias (ARS)' }],
};
const arsSell: RampCurrency = { ...ars, price: '1600', minAmount: '5' };
const usdt: RampToken = { chainId: 42161, address: USDT_ARB, symbol: 'USDT', decimals: 6, priceUsd: null, main: true };
const eth: RampToken = { chainId: 42161, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, priceUsd: '2500', main: true };
const unpriced: RampToken = { chainId: 42161, address: OTHER, symbol: 'XYZ', decimals: 18, priceUsd: null, main: false };

test('a token is priced by the market, a USD stablecoin at a dollar without one, anything else not at all', () => {
  assert.equal(tokenUsd(usdt), 1);
  assert.equal(tokenUsd(eth), 2500);
  assert.equal(tokenUsd(unpriced), null);
  assert.equal(tokenUsd({ symbol: 'USDC', priceUsd: '0.9998' }), 0.9998);
  assert.equal(tokenUsd(null), null);
});

test('the market rate is the currency per USD times the token in USD', () => {
  assert.equal(marketRate(ars, usdt), 1650.5);
  assert.equal(marketRate(ars, eth), 1650.5 * 2500);
  assert.equal(marketRate(ars, unpriced), null);
});

test('a purchase is local money with at most two decimals, at least the minimum', () => {
  assert.equal(rampAmountProblem('buy', '', ars, usdt), 'empty');
  assert.equal(rampAmountProblem('buy', '0', ars, usdt), 'empty');
  assert.equal(rampAmountProblem('buy', '9999.99', ars, usdt), 'below-min');
  assert.equal(rampAmountProblem('buy', '10000', ars, usdt), null);
  assert.equal(rampAmountProblem('buy', '10000.5', ars, usdt), null);
  assert.equal(rampAmountProblem('buy', '10000.555', ars, usdt), 'format');
  assert.equal(rampAmountProblem('buy', '010000', ars, usdt), 'format');
  assert.equal(rampAmountProblem('buy', '1e5', ars, usdt), 'format');
});

test('a sale is the token within its decimals, its USD minimum at the token price', () => {
  assert.equal(rampMinIn('sell', arsSell, usdt), 5);
  assert.equal(rampMinIn('sell', arsSell, eth), 5 / 2500);
  assert.equal(rampMinIn('sell', arsSell, unpriced), null);
  assert.equal(rampAmountProblem('sell', '4.99', arsSell, usdt), 'below-min');
  assert.equal(rampAmountProblem('sell', '5', arsSell, usdt), null);
  assert.equal(rampAmountProblem('sell', '5.1234567', arsSell, usdt), 'decimals');
  assert.equal(rampAmountProblem('sell', '0.001', arsSell, eth), 'below-min');
  assert.equal(rampAmountProblem('sell', '0.002', arsSell, eth), null);
  // Without a price the API checks the minimum; the form only checks the shape.
  assert.equal(rampAmountProblem('sell', '0.000000000000000001', arsSell, unpriced), null);
});

test('the estimate divides a purchase by the rate and multiplies a sale by it', () => {
  assert.equal(rampEstimate('buy', '16505', ars, usdt), 10);
  assert.equal(rampEstimate('sell', '10', arsSell, usdt), 16000);
  assert.equal(rampEstimate('buy', '16505', ars, unpriced), null);
  assert.equal(rampEstimate('buy', '', ars, usdt), null);
});

test('a firm quote is read as local money per token, fees included', () => {
  const q = { quoteId: 'q', amountIn: '16505', amountOut: '9.8', minAmountOut: '9.7', fee: { amountInToken: '0.2', amountInFiat: '330' }, expiresAt: '' };
  assert.equal(quoteRate('buy', q), 16505 / 9.8);
  assert.equal(quoteRate('sell', { ...q, amountIn: '10', amountOut: '15800' }), 1580);
  assert.equal(quoteRate('buy', { ...q, amountOut: '0' }), null);
});

test('an order only names a network the wallet has in the mode, with an address there', () => {
  assert.equal(rampWalletNetwork(42161, 'mainnet'), 'arb');
  assert.equal(rampWalletNetwork(1, 'mainnet'), 'eth');
  assert.equal(rampWalletNetwork(421614, 'testnet'), 'arb');
  assert.equal(rampWalletNetwork(421614, 'mainnet'), null);
  assert.equal(rampWalletNetwork(42161, 'testnet'), null);
  // Unichain and World Chain are not networks of this wallet.
  assert.equal(rampWalletNetwork(130, 'mainnet'), null);
  assert.equal(rampWalletNetwork(480, 'mainnet'), null);
  const market: RampMarket = {
    currencies: [ars],
    networks: [
      { chainId: 42161, name: 'Arbitrum', tokenCount: 900 },
      { chainId: 130, name: 'Unichain', tokenCount: 80 },
      { chainId: 8453, name: 'Base', tokenCount: 1200 },
    ],
    defaultToken: usdt,
  };
  assert.deepEqual(
    rampNetworks(market, 'mainnet', (id) => id === 'arb').map((n) => n.chainId),
    [42161],
  );
  assert.deepEqual(
    rampNetworks(market, 'mainnet', () => true).map((n) => n.chainId),
    [42161, 8453],
  );
});

test('labels: a method without the appended currency, a currency\'s country', () => {
  assert.equal(methodLabel('Nequi (COP)', 'COP'), 'Nequi');
  assert.equal(methodLabel('Binance Pay (USDT)', 'USD'), 'Binance Pay (USDT)');
  assert.equal(currencyCountry('ars'), 'AR');
});

const order: RampOrder = { currency: 'ARS', paymentMethod: 'bank_tx_ar', chainId: 42161, token: USDT_ARB, amount: '20000', address: ME };
const session = (over: Partial<RampSession> = {}): RampSession => ({
  id: 'p2p_1',
  side: 'buy',
  currency: 'ARS',
  paymentMethod: 'bank_tx_ar',
  amount: '20000',
  token: 'USDT',
  tokenAddress: USDT_ARB.toLowerCase(),
  chainId: 42161,
  address: ME,
  estimatedAmountOut: '12.11',
  reference: 'ref',
  widgetUrl: `https://widget.example/exchange?operation=BUY&address=${ME}`,
  createdAt: '2026-11-11T00:00:00Z',
  ...over,
});

test('a session opens only when it is the order confirmed, for this wallet', () => {
  assert.equal(rampSessionProblem(session(), 'buy', order), null);
  assert.equal(rampSessionProblem(session({ side: 'sell' }), 'buy', order), 'side');
  assert.equal(rampSessionProblem(session({ amount: '200000' }), 'buy', order), 'order');
  assert.equal(rampSessionProblem(session({ tokenAddress: OTHER }), 'buy', order), 'order');
  assert.equal(rampSessionProblem(session({ chainId: 8453 }), 'buy', order), 'order');
  assert.equal(rampSessionProblem(session({ address: OTHER }), 'buy', order), 'address');
  // The window would deliver to another account.
  assert.equal(rampSessionProblem(session({ widgetUrl: `https://widget.example/exchange?address=${OTHER}` }), 'buy', order), 'address');
  assert.equal(rampSessionProblem(session({ widgetUrl: 'https://widget.example/exchange' }), 'buy', order), 'address');
  assert.equal(rampSessionProblem(session({ widgetUrl: `http://widget.example/exchange?address=${ME}` }), 'buy', order), 'url');
  assert.equal(rampSessionProblem(session({ widgetUrl: 'not a url' }), 'buy', order), 'url');
  // A sale names no recipient in the window: the seller connects the wallet that sends.
  assert.equal(rampSessionProblem(session({ side: 'sell', widgetUrl: 'https://widget.example/exchange?operation=SELL' }), 'sell', order), null);
  // The amount compares as a number: the API may normalise "20000.00".
  assert.equal(rampSessionProblem(session({ amount: '20000.00' }), 'buy', order), null);
});

test('the order key changes with every field and ignores address case', () => {
  assert.equal(orderKey(order), orderKey({ ...order, address: ME.toUpperCase().replace('0X', '0x') }));
  assert.notEqual(orderKey(order), orderKey({ ...order, amount: '20001' }));
  assert.notEqual(orderKey(order), orderKey({ ...order, paymentMethod: 'other' }));
});
