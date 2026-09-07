/**
 * What the reporter must never do, in the order the harm runs:
 *
 *  1. Report at all when the user turned diagnostics off.
 *  2. Carry an account-identifying field on the ANONYMOUS route — a wallet with no
 *     Cosmos Pay account has no credential, so those events land in a shared feed,
 *     and an address or a transaction hash there ties an install to a Stellar
 *     account nobody asked to publish.
 *  3. Send the account's data to the keyed route without the key that authorizes it.
 *
 * Each is a decision that a later edit could reverse while every type still checks,
 * and none of them fails loudly in production — a leak looks exactly like a working
 * feature.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureTelemetry, flushTelemetry, report, setTelemetryEnabled, telemetryEnabled } from '@/lib/telemetry';
import { EVENT } from '@/constants/telemetry';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { events: { type: string; props?: Record<string, unknown> }[]; env?: string };
}

const sent: Sent[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Sent['body'],
    });
    return { status: 202 } as Response;
  }) as typeof fetch;
  setTelemetryEnabled(true);
  configureTelemetry({ apiKey: null, env: 'dev', network: 'testnet' });
});

afterEach(async () => {
  // Leave nothing queued for the next test to flush into its own assertions.
  await flushTelemetry();
  sent.length = 0;
  globalThis.fetch = realFetch;
  setTelemetryEnabled(true);
});

/**
 * The gateway validates `type` against this and refuses the WHOLE batch that carries a
 * name it does not match — so one camelCase entry in the table would silently take
 * every event queued beside it, with nothing failing on this side to say so. Three of
 * them were in the first draft.
 */
test('every event name matches the pattern the gateway accepts', () => {
  const accepted = /^[a-z0-9][a-z0-9._:-]*$/;
  for (const name of Object.values(EVENT)) {
    assert.match(name, accepted, `${name} would be refused, taking its batch with it`);
  }
});

test('reporting is off until the user opts in', () => {
  // Onboarding asks (`setup.metricsOptIn`, unchecked) and STORE_LISTING.md discloses
  // metrics as "optional, off by default". A default of on would make both false.
  localStorage.removeItem('cosmos.telemetry');
  assert.equal(telemetryEnabled(), false);
  setTelemetryEnabled(true);
  assert.equal(telemetryEnabled(), true);
});

test('an opt-out stops reporting, and drops what was already queued', async () => {
  report('payment.sent', { props: { asset: 'XLM' } });
  setTelemetryEnabled(false);

  assert.equal(telemetryEnabled(), false);
  await flushTelemetry();
  // Not merely "no new events": the queue that existed at the moment of the opt-out
  // is gone too. An opt-out that still sent the last few minutes is not one.
  assert.equal(sent.length, 0);
});

test('the anonymous route carries no account-identifying field', async () => {
  report('payment.sent', {
    props: {
      asset: 'XLM',
      amount: '12.5',
      received: '11.9',
      shares: '3',
      account: 'GABC',
      destination: 'GDEF',
      txHash: 'abc123',
      memoKind: 'text',
    },
  });
  await flushTelemetry();

  assert.equal(sent.length, 1);
  assert.ok(sent[0].url.endsWith('/api/telemetry'));
  assert.equal(sent[0].headers.Authorization, undefined);
  const props = sent[0].body.events[0].props ?? {};
  for (const gone of ['amount', 'received', 'shares', 'account', 'destination', 'txHash']) {
    assert.equal(props[gone], undefined, `${gone} must not travel anonymously`);
  }
  // What is left is what the event is FOR: which asset, and how it was built.
  assert.equal(props.asset, 'XLM');
  assert.equal(props.memoKind, 'text');
  // The environment decides which consumer the platform files it under.
  assert.equal(sent[0].body.env, 'dev');
});

test('a wallet with a key reports to the gateway, with it, and keeps its own data', async () => {
  configureTelemetry({ apiKey: 'dv_test_key', env: 'dev', network: 'testnet' });
  report('payment.sent', { props: { asset: 'XLM', amount: '12.5', txHash: 'abc123' } });
  await flushTelemetry();

  assert.equal(sent.length, 1);
  assert.ok(sent[0].url.endsWith('/v1/activity/events'));
  assert.equal(sent[0].headers.Authorization, 'Bearer dv_test_key');
  // Attributed to the account that owns the wallet, so its own amounts and hashes are
  // its own to read back in its dashboard.
  assert.equal(sent[0].body.events[0].props?.amount, '12.5');
  assert.equal(sent[0].body.events[0].props?.txHash, 'abc123');
});

test('a key that predates the activity scope falls back instead of going silent', async () => {
  configureTelemetry({ apiKey: 'dv_old_key', env: 'dev' });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Sent['body'],
    });
    // What every key minted before `activity:write` existed answers.
    return { status: 403 } as Response;
  }) as typeof fetch;

  report('app.open', {});
  await flushTelemetry();
  assert.ok(sent[0].url.endsWith('/v1/activity/events'), 'the first attempt uses the key');

  // The refusal is remembered: the retry takes the anonymous route rather than
  // walking into the same 403 forever, which is how an error stream dies quietly.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Sent['body'],
    });
    return { status: 202 } as Response;
  }) as typeof fetch;
  await flushTelemetry();
  assert.ok(sent[1].url.endsWith('/api/telemetry'));
  assert.equal(sent[1].headers.Authorization, undefined);
});

test('a failed flush keeps the events for the next one', async () => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  report('app.open', {});
  await flushTelemetry();

  // An offline wallet is the normal case, not an error case: the popup that closed
  // mid-request is the one whose events matter on the next open.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Sent['body'],
    });
    return { status: 202 } as Response;
  }) as typeof fetch;
  await flushTelemetry();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.events[0].type, 'app.open');
});
