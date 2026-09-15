/**
 * The brokered social login's two response contracts.
 *
 * When the provider's email already has an account, the platform answers the claim with
 * `verify_email` and NO session: the code emailed to that account is what releases it. The
 * contracts are what stop a body of one kind being read as the other — a `verify_email`
 * taken for a login would hand the store a session that is not there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiShapeError, parseShape } from '@/lib/apiShape';
import { SocialClaimShape, SocialVerifyResultShape } from '@/lib/pollarShapes';

const URL_ = 'https://dev.example/api/wallet/social/claim';
const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const SESSION = {
  access_token: 'at',
  refresh_token: 'rt',
  token_type: 'Bearer',
  expires_at: 1893456000000,
  user_id: 'u_1',
  wallet: { type: 'internal', address: G },
  wallets: [{ type: 'internal', address: G }],
  profile: {},
  publishable_key: 'pub_mainnet_x',
  api_base_url: 'https://sdk.api.pollar.xyz/v2',
};

const READY = {
  status: 'ready',
  session: SESSION,
  account: 'linked',
  organizationId: 'org_1',
  keys: { dev: 'dv_1', prod: 'prod_1' },
};

test('a claim is either a finished login or a request for the emailed code', () => {
  assert.equal(parseShape(URL_, SocialClaimShape, READY), READY);
  const proof = { status: 'verify_email', claimToken: 'a'.repeat(64), expiresInSeconds: 900 };
  assert.equal(parseShape(URL_, SocialClaimShape, proof), proof);
});

test('a request for the code needs its claim token, and a login needs its session', () => {
  assert.throws(() => parseShape(URL_, SocialClaimShape, { status: 'verify_email', expiresInSeconds: 900 }), ApiShapeError);
  assert.throws(
    () => parseShape(URL_, SocialClaimShape, { status: 'ready', account: 'linked', organizationId: null, keys: null }),
    ApiShapeError,
  );
  // A status the contract does not know is refused, not read as either kind.
  assert.throws(() => parseShape(URL_, SocialClaimShape, { ...READY, status: 'linked' }), ApiShapeError);
});

test('the verify result carries a session only when ready', () => {
  assert.equal(parseShape(URL_, SocialVerifyResultShape, READY), READY);
  assert.deepEqual(parseShape(URL_, SocialVerifyResultShape, { status: 'invalid', attemptsLeft: 3 }), {
    status: 'invalid',
    attemptsLeft: 3,
  });
  for (const status of ['expired', 'locked']) {
    assert.deepEqual(parseShape(URL_, SocialVerifyResultShape, { status }), { status });
  }
  assert.throws(() => parseShape(URL_, SocialVerifyResultShape, { status: 'invalid' }), ApiShapeError);
});
