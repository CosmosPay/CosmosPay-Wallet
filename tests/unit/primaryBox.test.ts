/**
 * Which box proves a vault key, per wallet kind (`src/lib/vault.ts`).
 *
 * Worth a test because the failure it guards was silent, shipped, and reachable from three
 * separate places. A local wallet keeps its seed in a secret box; a Pollar wallet has no
 * secret box at all — its sealed session is both the credential and the box the app
 * password is proven against. Three paths where a LIVE session adopts another wallet
 * (`switchWallet`, the fallback after `removeActiveWallet`, and the device unlock) all
 * proved the key with `openVault`, which asks for the secret box. Every one of them failed
 * on a social wallet: switching refused with an error and left the user on the wallet they
 * were trying to leave, and the biometric unlock refused an enrolment that was perfectly
 * good.
 *
 * Nothing in the type system could catch that — both kinds are a `WalletEntry`, and the
 * difference is which key exists in storage. So what is asserted here is the property the
 * bug violated: `openPrimaryBox` opens EITHER kind under the session's key, `openVault`
 * still refuses a Pollar wallet (which is correct — its caller wants a seed to sign with),
 * and neither opens under a key that is not the one they were sealed with.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVaultKey, newKdfParams, VaultKeyMismatchError, WrongPasswordError } from '@/lib/crypto';
import {
  NoLocalKeyError,
  addWallet,
  createPollarWallet,
  openPrimaryBox,
  openVault,
  type PollarStoredSession,
} from '@/lib/vault';

const SEED = { secret: 'SBUVRVHRLHVJVJKZ5FJ5NLXHNBHDXUEXSGFLXAWNIGT4IEB5NLPMWNQE', mnemonic: null };
const PUB = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

const session: PollarStoredSession = {
  access_token: 'at',
  refresh_token: 'rt',
  token_type: 'Bearer',
  expires_at: Date.now() + 3_600_000,
  user_id: 'u1',
  address: PUB,
  publishable_key: 'pk',
  api_base_url: 'https://example.invalid',
  provider: 'google',
};

test('a live session opens either kind of wallet through its proving box', async () => {
  localStorage.clear();
  const vk = await deriveVaultKey('Test-pass-123', newKdfParams());

  const local = await addWallet(SEED, { publicKey: PUB, name: 'Local', birthdate: '', email: '' }, vk);
  const { entry: social } = await createPollarWallet({ publicKey: PUB, name: 'Social', birthdate: '', email: '' }, session, vk);

  // The assertion the three adopt-a-wallet paths depend on. Before `openPrimaryBox` the
  // second of these threw, and switching to a social wallet was impossible.
  await openPrimaryBox(local, vk);
  await openPrimaryBox(social, vk);
});

test('the secret box still refuses a Pollar wallet, and says why', async () => {
  localStorage.clear();
  const vk = await deriveVaultKey('Test-pass-123', newKdfParams());
  const { entry: social } = await createPollarWallet({ publicKey: PUB, name: 'Social', birthdate: '', email: '' }, session, vk);

  // Not a regression to fix: `openVault`'s callers want a seed to SIGN with, and the honest
  // answer for this wallet is that its key is somewhere else — never "wallet not found".
  await assert.rejects(() => openVault(social.id, vk), NoLocalKeyError);
});

/**
 * The proof has to stay a proof, and it has to fail with the RIGHT error — the two
 * failures mean opposite things to the failed-attempt ladder. A key derived from another
 * password under the same parameters is a decrypt that did not work: `WrongPasswordError`.
 * A key whose parameters do not even match the box was never a candidate, and nobody typed
 * anything, so counting it as a guess would spend the user's attempts on a bookkeeping
 * error: `VaultKeyMismatchError`.
 */
test('the proving box is still a proof, and fails the same way for both kinds', async () => {
  localStorage.clear();
  const kdf = newKdfParams();
  const vk = await deriveVaultKey('Test-pass-123', kdf);
  const wrongPassword = await deriveVaultKey('Other-pass-456', kdf);
  const wrongParams = await deriveVaultKey('Test-pass-123', newKdfParams());

  const local = await addWallet(SEED, { publicKey: PUB, name: 'Local', birthdate: '', email: '' }, vk);
  const { entry: social } = await createPollarWallet({ publicKey: PUB, name: 'Social', birthdate: '', email: '' }, session, vk);

  for (const entry of [local, social]) {
    await assert.rejects(() => openPrimaryBox(entry, wrongPassword), WrongPasswordError);
    await assert.rejects(() => openPrimaryBox(entry, wrongParams), VaultKeyMismatchError);
  }
});
