/**
 * Charging with a QR in local money (`src/lib/qrCharge.ts`): what a charge may ask for, the
 * response contract, the ways a customer can pay and how they paid, the check that the request
 * the API answered is the one asked for and pays this wallet, how a charge reads over time (a
 * bank transfer being processed included), the rule that reads a payment off the wallet's own
 * balance, and what comes back from storage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiShapeError, parseShape } from '@/lib/apiShape';
import { PaymentRequestShape } from '@/lib/cosmospayShapes';
import { CHARGE_DESCRIPTION_MAX, CHARGE_LATE_WATCH_MS } from '@/constants/qrCharge';
import { T } from '@/lib/i18n';
import type { RampCurrency } from '@/lib/p2pRamp';
import {
  chargeAmountProblem,
  chargeCancellable,
  chargeDescription,
  chargeMethods,
  chargeMethodsKey,
  chargePaidByBalance,
  chargePaidMethod,
  chargePaidMethodKey,
  chargePaidVia,
  chargeRequestProblem,
  chargeStatus,
  chargeStorageKey,
  chargeTimeLeft,
  chargeUrlOk,
  chargeWatched,
  formatCountdown,
  newCharge,
  parseStoredCharge,
  sameCharge,
  sanitizeChargeDescription,
  withBalance,
  withRequest,
  type PaymentRequest,
  type PaymentRequestInput,
} from '@/lib/qrCharge';

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const USDT0_ARB = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const T0 = Date.parse('2026-11-12T12:00:00.000Z');
const HOUR = 3_600_000;

const ars: RampCurrency = {
  id: 'ARS',
  name: 'Argentine Peso',
  price: '1650.5',
  minAmount: '10000',
  paymentMethods: [{ id: 'bank_tx_ar', name: 'CVU/CBU o Alias (ARS)' }],
};

const input: PaymentRequestInput = {
  currency: 'ARS',
  amount: '15000',
  chainId: 42161,
  token: USDT0_ARB.toLowerCase(),
  address: ME,
  description: 'Table 4',
  expiresInMinutes: 1440,
};

/** The contract's own example, as the API answers a create made with the shared key. */
const answer = (over: Partial<PaymentRequest> & Record<string, unknown> = {}): PaymentRequest =>
  ({
    id: 'cm3charge01',
    network: 'public',
    status: 'open',
    currency: 'ARS',
    amount: '15000',
    chainId: 42161,
    token: 'USDT0',
    tokenAddress: USDT0_ARB,
    tokenDecimals: 6,
    address: ME.toUpperCase().replace('0X', '0x'),
    description: 'Table 4',
    estimatedAmountOut: '8.94',
    url: 'https://payments.cosmospay.lat/fiat/cm3charge01',
    qr: 'data:image/png;base64,AAAA',
    expiresAt: new Date(T0 + 24 * HOUR).toISOString(),
    createdAt: new Date(T0).toISOString(),
    paidAt: null,
    paidAmount: null,
    paidTxHash: null,
    publicToken: 'q3Zx0r8vH6c1yJ2bN5mT4kW9sD7fL0aE1gP3uR6iO2w',
    ...over,
  }) as PaymentRequest;

/* -------------------------------- the form -------------------------------- */

test('an amount is local money with at most two decimals, at least the currency minimum', () => {
  assert.equal(chargeAmountProblem('15000', ars), null);
  assert.equal(chargeAmountProblem('10000', ars), null);
  assert.equal(chargeAmountProblem('15000.5', ars), null);
  assert.equal(chargeAmountProblem('15000.55', ars), null);
  assert.equal(chargeAmountProblem('15000.555', ars), 'format');
  assert.equal(chargeAmountProblem('9999.99', ars), 'below-min');
  assert.equal(chargeAmountProblem('', ars), 'empty');
  assert.equal(chargeAmountProblem('0', ars), 'empty');
  assert.equal(chargeAmountProblem('0.00', ars), 'empty');
  assert.equal(chargeAmountProblem('1e5', ars), 'format');
  assert.equal(chargeAmountProblem('-15000', ars), 'format');
  assert.equal(chargeAmountProblem('015000', ars), 'format');
  // A currency without a sensible minimum takes any positive amount.
  assert.equal(chargeAmountProblem('1', { ...ars, minAmount: 'n/a' }), null);
});

test('a description is one line, at most 140 characters, never cut through a character', () => {
  assert.equal(sanitizeChargeDescription('Table\n4\tby the\r\nwindow'), 'Table 4 by the window');
  // The line and paragraph separators and a bell, spelled by code so the source shows them.
  const [ls, ps, bell] = [0x2028, 0x2029, 0x07].map((c) => String.fromCharCode(c));
  assert.equal(sanitizeChargeDescription(`a${ls}b${ps}c${bell}d`), 'a b c d');
  assert.equal(sanitizeChargeDescription('x'.repeat(200)).length, CHARGE_DESCRIPTION_MAX);
  // 139 units then an emoji (two units): it does not fit whole, so it is left out.
  const cut = sanitizeChargeDescription(`${'x'.repeat(139)}🍕🍕`);
  assert.equal(cut, 'x'.repeat(139));
  assert.equal(sanitizeChargeDescription(`${'x'.repeat(138)}🍕`).length, 140);
  assert.equal(chargeDescription('   '), undefined);
  assert.equal(chargeDescription('  Table 4 \n'), 'Table 4');
});

/* ------------------------------- the contract ------------------------------- */

test('the response contract reads every status and refuses one it does not know', () => {
  for (const status of ['open', 'processing', 'paid', 'expired', 'cancelled']) {
    assert.doesNotThrow(() => parseShape('u', PaymentRequestShape, answer({ status } as never)));
  }
  assert.throws(() => parseShape('u', PaymentRequestShape, answer({ status: 'pending' } as never)), ApiShapeError);
});

test('the response contract asserts what the wallet acts on, and lets the rest through', () => {
  // Without a description, an estimate or a public token (an account's own request).
  assert.doesNotThrow(() => parseShape('u', PaymentRequestShape, answer({ description: null, estimatedAmountOut: null, publicToken: undefined })));
  // A field added later passes untouched.
  const extra = parseShape('u', PaymentRequestShape, answer({ paymentMethods: [] } as never)) as Record<string, unknown>;
  assert.deepEqual(extra.paymentMethods, []);
  for (const broken of [
    { id: '' },
    { amount: 15000 },
    { amount: '15.000,00' },
    { chainId: '42161' },
    { tokenDecimals: undefined },
    { url: undefined },
    { estimatedAmountOut: '≈ 8.94' },
    { paidAmount: 'soon' },
    { address: null },
  ]) {
    assert.throws(() => parseShape('u', PaymentRequestShape, answer(broken as never)), ApiShapeError, JSON.stringify(broken));
  }
});

test('the ways to pay pass the contract unasserted: a new or unknown one never hides a charge', () => {
  // A server that predates them, the contract's own lists, and words this release does not know.
  for (const over of [
    {},
    { methods: ['transfer', 'p2p'], paidMethod: null },
    { methods: ['card'], paidMethod: 'card' },
    { methods: 'transfer', paidMethod: 7 },
    { status: 'processing', methods: ['transfer'] },
    { status: 'paid', paidAmount: '8.91', paidMethod: 'transfer' },
  ]) {
    assert.doesNotThrow(() => parseShape('u', PaymentRequestShape, answer(over as never)), JSON.stringify(over));
  }
});

/* -------------------------------- ways to pay -------------------------------- */

test('the ways to pay are read in the API\'s order; a server without them offers the purchase', () => {
  assert.deepEqual(chargeMethods(['transfer', 'p2p']), ['transfer', 'p2p']);
  assert.deepEqual(chargeMethods(['p2p', 'transfer']), ['p2p', 'transfer']);
  assert.deepEqual(chargeMethods(['transfer']), ['transfer']);
  assert.deepEqual(chargeMethods(['p2p']), ['p2p']);
  // Older servers leave the field out (or null): the purchase was the only way.
  assert.deepEqual(chargeMethods(undefined), ['p2p']);
  assert.deepEqual(chargeMethods(null), ['p2p']);
  // A way this release does not know is left out, and so is a repeat.
  assert.deepEqual(chargeMethods(['card', 'transfer', 'TRANSFER', 'transfer', 'p2p', 3]), ['transfer', 'p2p']);
  assert.deepEqual(chargeMethods(['card']), []);
  assert.deepEqual(chargeMethods([]), []);
  // Something that is not a list says nothing.
  assert.deepEqual(chargeMethods('transfer'), []);
  assert.deepEqual(chargeMethods({ transfer: true }), []);
});

test('how a request was paid is read only in words this release knows', () => {
  assert.equal(chargePaidMethod('transfer'), 'transfer');
  assert.equal(chargePaidMethod('p2p'), 'p2p');
  for (const raw of [null, undefined, '', 'card', 'Transfer', 1, ['transfer'], {}]) {
    assert.equal(chargePaidMethod(raw), null, JSON.stringify(raw));
  }
});

test('the seller is told how the customer can pay, and how they paid, in keys every language has', () => {
  assert.equal(chargeMethodsKey(['transfer', 'p2p']), 'charge.methodsBoth');
  assert.equal(chargeMethodsKey(['p2p', 'transfer']), 'charge.methodsBoth');
  assert.equal(chargeMethodsKey(['transfer']), 'charge.methodsTransfer');
  assert.equal(chargeMethodsKey(['p2p']), 'charge.methodsOther');
  assert.equal(chargeMethodsKey([]), null);
  assert.equal(chargePaidMethodKey('transfer'), 'charge.paidByTransfer');
  assert.equal(chargePaidMethodKey('p2p'), 'charge.paidByOther');
  assert.equal(chargePaidMethodKey(null), null);
  const keys = [
    chargeMethodsKey(['transfer', 'p2p']),
    chargeMethodsKey(['transfer']),
    chargeMethodsKey(['p2p']),
    chargePaidMethodKey('transfer'),
    chargePaidMethodKey('p2p'),
  ];
  for (const key of keys) assert.ok(key && T[key], `${key} is an i18n key`);
});

test('a charge keeps the ways to pay as read, never the raw answer', () => {
  assert.deepEqual(newCharge(answer(), false, null).request.methods, ['p2p']);
  const both = newCharge(answer({ methods: ['transfer', 'card', 'p2p'] }), false, null);
  assert.deepEqual(both.request.methods, ['transfer', 'p2p']);
  assert.equal(both.request.paidMethod, null);
  const paid = newCharge(answer({ status: 'paid', paidAmount: '8.91', paidMethod: 'transfer' }), false, null);
  assert.equal(paid.request.paidMethod, 'transfer');
  assert.equal(newCharge(answer({ status: 'paid', paidAmount: '8.91', paidMethod: 'card' }), false, null).request.paidMethod, null);
});

/* ------------------------- the request the API answered ------------------------- */

test('the page a QR opens is https, without credentials, on this request\'s own path', () => {
  assert.equal(chargeUrlOk('https://payments.cosmospay.lat/fiat/cm3charge01', 'cm3charge01'), true);
  assert.equal(chargeUrlOk('https://pay.example.org/base/fiat/cm3charge01/', 'cm3charge01'), true);
  assert.equal(chargeUrlOk('http://localhost:4321/fiat/cm3charge01', 'cm3charge01'), true);
  assert.equal(chargeUrlOk('http://payments.cosmospay.lat/fiat/cm3charge01', 'cm3charge01'), false);
  assert.equal(chargeUrlOk('https://payments.cosmospay.lat/fiat/other', 'cm3charge01'), false);
  assert.equal(chargeUrlOk('https://payments.cosmospay.lat/fiat/cm3charge01x', 'cm3charge01'), false);
  assert.equal(chargeUrlOk('https://user:pw@payments.cosmospay.lat/fiat/cm3charge01', 'cm3charge01'), false);
  assert.equal(chargeUrlOk('javascript:alert(1)//fiat/cm3charge01', 'cm3charge01'), false);
  assert.equal(chargeUrlOk('not a url', 'cm3charge01'), false);
});

test('a request is shown only when it is the charge asked for, paying this wallet', () => {
  assert.equal(chargeRequestProblem(answer(), input), null);
  // The amount compares as a number: the API may write it back with its decimals.
  assert.equal(chargeRequestProblem(answer({ amount: '15000.00' }), input), null);
  assert.equal(chargeRequestProblem(answer({ amount: '1500' }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ currency: 'BRL' }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ chainId: 8453 }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ tokenAddress: OTHER }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ tokenDecimals: 6.5 }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ tokenDecimals: 77 }), input), 'order');
  assert.equal(chargeRequestProblem(answer({ address: OTHER }), input), 'address');
  assert.equal(chargeRequestProblem(answer({ url: 'https://evil.example/fiat/somebody-else' }), input), 'url');
});

test('a later answer counts only for the same charge', () => {
  assert.equal(sameCharge(answer(), answer({ status: 'paid', paidAmount: '8.91' })), true);
  assert.equal(sameCharge(answer(), answer({ id: 'cm3other' })), false);
  assert.equal(sameCharge(answer(), answer({ address: OTHER })), false);
  assert.equal(sameCharge(answer(), answer({ amount: '16000' })), false);
});

/* -------------------------------- over time -------------------------------- */

test('a new charge keeps the public token only for the shared key, and never the API\'s picture', () => {
  const shared = newCharge(answer(), true, 5_000_000n);
  assert.equal(shared.publicToken, answer().publicToken);
  assert.equal(shared.baseline, '5000000');
  assert.equal('qr' in shared.request, false);
  assert.equal('publicToken' in shared.request, false);
  const own = newCharge(answer(), false, null);
  assert.equal(own.publicToken, null);
  assert.equal(own.baseline, null);
  assert.equal(own.paid, null);
});

test('an open charge reads as expired past its expiry, with a countdown to it', () => {
  const c = newCharge(answer(), false, 0n);
  assert.equal(chargeStatus(c, T0), 'open');
  assert.equal(chargeStatus(c, T0 + 24 * HOUR - 1), 'open');
  assert.equal(chargeStatus(c, T0 + 24 * HOUR), 'expired');
  assert.equal(chargeTimeLeft(c, T0), 24 * HOUR);
  assert.equal(chargeTimeLeft(c, T0 + 25 * HOUR), 0);
  assert.equal(formatCountdown(24 * HOUR), '24:00:00');
  assert.equal(formatCountdown(HOUR + 61_000), '1:01:01');
  assert.equal(formatCountdown(65_000), '1:05');
  assert.equal(formatCountdown(500), '0:01');
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(-5), '0:00');
});

test('a closed charge is still watched for a while, for a payer who had already started', () => {
  const c = newCharge(answer(), false, 0n);
  const end = T0 + 24 * HOUR;
  assert.equal(chargeWatched(c, T0), true);
  assert.equal(chargeWatched(c, end + CHARGE_LATE_WATCH_MS - 1), true);
  assert.equal(chargeWatched(c, end + CHARGE_LATE_WATCH_MS), false);
  const cancelled = withRequest(c, answer({ status: 'cancelled' }), T0 + HOUR);
  assert.equal(chargeStatus(cancelled, T0 + HOUR), 'cancelled');
  assert.equal(cancelled.closedAt, T0 + HOUR);
  assert.equal(chargeWatched(cancelled, T0 + HOUR + CHARGE_LATE_WATCH_MS - 1), true);
  assert.equal(chargeWatched(cancelled, T0 + HOUR + CHARGE_LATE_WATCH_MS), false);
  // A paid charge is done.
  assert.equal(chargeWatched(withRequest(c, answer({ status: 'paid', paidAmount: '8.91' }), T0), T0), false);
});

test('the API saying paid settles the charge with what it delivered', () => {
  const c = newCharge(answer(), true, 0n);
  const paid = withRequest(c, answer({ status: 'paid', paidAt: new Date(T0 + HOUR).toISOString(), paidAmount: '8.91' }), T0 + HOUR);
  assert.deepEqual(paid.paid, { by: 'api', amount: '8.91', at: T0 + HOUR });
  assert.equal(chargeStatus(paid, T0 + 30 * HOUR), 'paid');
  // Paid even after it expired or was cancelled: the money arrived.
  const late = withRequest(withRequest(c, answer({ status: 'cancelled' }), T0), answer({ status: 'paid', paidAmount: '8.9' }), T0 + 2 * HOUR);
  assert.equal(chargeStatus(late, T0 + 2 * HOUR), 'paid');
  // An answer about another charge changes nothing.
  assert.equal(withRequest(c, answer({ id: 'cm3other', status: 'paid' }), T0), c);
  // The public token stays with the charge, not with the request kept.
  assert.equal(paid.publicToken, c.publicToken);
});

test('only an open charge can be cancelled', () => {
  const c = newCharge(answer(), false, 0n);
  assert.equal(chargeCancellable(c, T0), true);
  assert.equal(chargeCancellable(c, T0 + 24 * HOUR), false);
  assert.equal(chargeCancellable(withRequest(c, answer({ status: 'processing' }), T0), T0), false);
  assert.equal(chargeCancellable(withRequest(c, answer({ status: 'cancelled' }), T0), T0), false);
  assert.equal(chargeCancellable(withRequest(c, answer({ status: 'paid', paidAmount: '8.91' }), T0), T0), false);
});

test('a bank transfer received reads processing until paid: never expired, never cancellable, always watched', () => {
  const methods = ['transfer', 'p2p'];
  let c = newCharge(answer({ methods }), false, 0n);
  c = withRequest(c, answer({ methods, status: 'processing' }), T0 + HOUR);
  assert.equal(chargeStatus(c, T0 + HOUR), 'processing');
  assert.equal(c.closedAt, null);
  assert.equal(c.paid, null);
  // Past the request's expiry, and long after: still processing, still watched.
  for (const at of [T0 + 24 * HOUR, T0 + 24 * HOUR + CHARGE_LATE_WATCH_MS, T0 + 72 * HOUR]) {
    assert.equal(chargeStatus(c, at), 'processing');
    assert.equal(chargeWatched(c, at), true);
    assert.equal(chargeCancellable(c, at), false);
  }
  assert.equal(chargePaidVia(c, T0 + HOUR), null);
  // Then the API says paid, and how.
  const paid = withRequest(c, answer({ methods, status: 'paid', paidAt: new Date(T0 + 2 * HOUR).toISOString(), paidAmount: '9.02', paidMethod: 'transfer' }), T0 + 2 * HOUR);
  assert.equal(chargeStatus(paid, T0 + 2 * HOUR), 'paid');
  assert.deepEqual(paid.paid, { by: 'api', amount: '9.02', at: T0 + 2 * HOUR });
  assert.equal(chargePaidVia(paid, T0 + 2 * HOUR), 'transfer');
  assert.equal(chargeWatched(paid, T0 + 2 * HOUR), false);
});

test('the balance still settles a charge, also one being processed, and says nothing of how', () => {
  let c = newCharge(answer({ methods: ['transfer'] }), false, 1_000_000n);
  c = withRequest(c, answer({ methods: ['transfer'], status: 'processing' }), T0 + HOUR);
  c = withBalance(c, 1_000_000n + 8_940_000n, T0 + HOUR + 60_000);
  assert.equal(chargeStatus(c, T0 + HOUR + 60_000), 'paid');
  assert.equal(c.paid?.by, 'balance');
  assert.equal(chargePaidVia(c, T0 + HOUR + 60_000), null);
  // An answer that lands after it may still say how; the balance stays the signal that won.
  const told = withRequest(c, answer({ methods: ['transfer'], status: 'paid', paidAmount: '8.94', paidMethod: 'transfer' }), T0 + 2 * HOUR);
  assert.equal(told.paid?.by, 'balance');
  assert.equal(chargePaidVia(told, T0 + 2 * HOUR), 'transfer');
});

test('a purchase paid while a transfer was being processed is paid with the other method', () => {
  const c = withRequest(newCharge(answer({ methods: ['transfer', 'p2p'] }), false, 0n), answer({ status: 'processing' }), T0);
  const paid = withRequest(c, answer({ status: 'paid', paidAmount: '8.9', paidMethod: 'p2p' }), T0 + HOUR);
  assert.equal(chargePaidVia(paid, T0 + HOUR), 'p2p');
  assert.equal(chargePaidMethodKey(chargePaidVia(paid, T0 + HOUR)), 'charge.paidByOther');
});

/* ------------------------- the balance as the signal ------------------------- */

test('a rise of at least 95% of the estimate is the payment', () => {
  // 8.94 USDT0 (6 decimals) estimated; 95% of it is 8.493.
  const base = 2_000_000n;
  assert.equal(chargePaidByBalance(base, base + 8_940_000n, '8.94', 6).paid, true);
  assert.equal(chargePaidByBalance(base, base + 8_493_000n, '8.94', 6).paid, true);
  assert.equal(chargePaidByBalance(base, base + 8_492_999n, '8.94', 6).paid, false);
  assert.equal(chargePaidByBalance(base, base + 20_000_000n, '8.94', 6).paid, true);
  assert.equal(chargePaidByBalance(base, base, '8.94', 6).paid, false);
  assert.equal(chargePaidByBalance(base, base + 8_940_000n, '8.94', 6).received, 8_940_000n);
});

test('without an estimate, any rise is the payment; no rise never is', () => {
  assert.equal(chargePaidByBalance(10n, 11n, null, 18).paid, true);
  assert.equal(chargePaidByBalance(10n, 10n, null, 18).paid, false);
  assert.equal(chargePaidByBalance(10n, 11n, '0', 18).paid, true);
});

test('money that left meanwhile lowers the baseline, so the payment counts from the lowest point', () => {
  const spent = chargePaidByBalance(10_000_000n, 4_000_000n, '8.94', 6);
  assert.deepEqual(spent, { paid: false, received: 0n, baseline: 4_000_000n });
  assert.equal(chargePaidByBalance(spent.baseline, 4_000_000n + 8_940_000n, '8.94', 6).paid, true);
});

test('the first balance read is the baseline; a later rise settles the charge with the amount', () => {
  let c = newCharge(answer(), false, null);
  c = withBalance(c, 1_500_000n, T0);
  assert.equal(c.baseline, '1500000');
  assert.equal(c.paid, null);
  c = withBalance(c, 1_500_000n, T0 + 10_000);
  assert.equal(c.paid, null);
  c = withBalance(c, 1_500_000n + 8_910_000n, T0 + 20_000);
  assert.deepEqual(c.paid, { by: 'balance', amount: '8.910000', at: T0 + 20_000 });
  // The first signal wins: the API's later answer does not replace it.
  const after = withRequest(c, answer({ status: 'paid', paidAmount: '8.91' }), T0 + 30_000);
  assert.equal(after.paid?.by, 'balance');
  // And a settled charge ignores the balance from then on.
  assert.equal(withBalance(after, 0n, T0 + 40_000), after);
});

/* --------------------------------- storage --------------------------------- */

test('a charge is kept per wallet and mode, and read back checked', () => {
  assert.equal(chargeStorageKey('w1', 'testnet'), 'cosmos.charge.w1.testnet');
  const c = withBalance(newCharge(answer(), true, 7n), 7n, T0);
  assert.deepEqual(parseStoredCharge(JSON.parse(JSON.stringify(c))), c);
  const paid = withRequest(c, answer({ status: 'paid', paidAmount: '8.91' }), T0);
  assert.deepEqual(parseStoredCharge(JSON.parse(JSON.stringify(paid))), paid);
  // The ways to pay and the status in between survive a reload.
  const processing = withRequest(newCharge(answer({ methods: ['transfer', 'p2p'] }), true, 7n), answer({ methods: ['transfer', 'p2p'], status: 'processing' }), T0);
  const back = parseStoredCharge(JSON.parse(JSON.stringify(processing)));
  assert.deepEqual(back, processing);
  assert.equal(back && chargeStatus(back, T0 + 48 * HOUR), 'processing');
  const viaTransfer = withRequest(processing, answer({ methods: ['transfer', 'p2p'], status: 'paid', paidAmount: '8.91', paidMethod: 'transfer' }), T0);
  assert.equal(parseStoredCharge(JSON.parse(JSON.stringify(viaTransfer)))?.request.paidMethod, 'transfer');
});

test('a charge kept by a build before the ways to pay reads as the purchase, paid how nobody said', () => {
  const c = newCharge(answer(), true, 7n);
  const older: Record<string, unknown> = { ...c.request };
  delete older.methods;
  delete older.paidMethod;
  const back = parseStoredCharge({ ...c, request: older });
  assert.deepEqual(back?.request.methods, ['p2p']);
  assert.equal(back?.request.paidMethod, null);
  // And one kept with words this release does not know keeps only the ones it does.
  const odd = parseStoredCharge({ ...c, request: { ...c.request, methods: ['card', 'transfer'], paidMethod: 'card' } });
  assert.deepEqual(odd?.request.methods, ['transfer']);
  assert.equal(odd?.request.paidMethod, null);
});

test('a stored charge that does not read is dropped, never guessed', () => {
  const c = newCharge(answer(), true, 7n);
  assert.equal(parseStoredCharge(null), null);
  assert.equal(parseStoredCharge('x'), null);
  assert.equal(parseStoredCharge({ ...c, request: { ...c.request, status: 'weird' } }), null);
  assert.equal(parseStoredCharge({ ...c, request: { ...c.request, url: 'https://evil.example/x' } }), null);
  assert.equal(parseStoredCharge({ ...c, shared: 'yes' }), null);
  // Loose fields fall back rather than sink the charge.
  const loose = parseStoredCharge({ ...c, baseline: '-5', paid: { by: 'magic' }, closedAt: 'later' });
  assert.equal(loose?.baseline, null);
  assert.equal(loose?.paid, null);
  assert.equal(loose?.closedAt, null);
  // A public token is only ever kept for a shared-key charge.
  assert.equal(parseStoredCharge({ ...c, shared: false })?.publicToken, null);
});
