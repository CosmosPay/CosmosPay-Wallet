/**
 * One identity, an address per network (`entryForNetwork` in `src/lib/vault.ts`).
 *
 * A social login writes TWO entries — the mainnet account whose key Pollar custodies, and
 * a seeded testnet half this device generated — and the user has one account. So the
 * seeded half is hidden from every picker and reached by changing network instead, which
 * makes this resolver the only thing standing between "the network selector switches my
 * wallet" and "I own a wallet nothing on screen can reach".
 *
 * Worth a test because two controls now share it. The wallet switcher resolves the row the
 * user tapped against the CURRENT network; the network selector resolves the CURRENT
 * identity against the network being picked. Those have to land on the same entry for the
 * same pair, and nothing in the type system says so — both halves are a `WalletEntry`, and
 * the difference is one optional string.
 *
 * The last test is the one that is easy to forget: the halves are hidden, so an orphan
 * would be a wallet holding a seed that no screen can name, reach or delete — belonging to
 * an account the user believes they already deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVaultKey, newKdfParams } from '@/lib/crypto';
import {
  addWallet,
  createPollarWallet,
  createSocialLocalWallet,
  entryForNetwork,
  identityOf,
  listWallets,
  removeWallet,
  type PollarStoredSession,
  type WalletEntry,
} from '@/lib/vault';

const PUB_A = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const PUB_B = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SEED = { secret: 'SBUVRVHRLHVJVJKZ5FJ5NLXHNBHDXUEXSGFLXAWNIGT4IEB5NLPMWNQE', mnemonic: 'x y z' };

const session: PollarStoredSession = {
  access_token: 'at',
  refresh_token: 'rt',
  token_type: 'Bearer',
  expires_at: Date.now() + 3_600_000,
  user_id: 'u1',
  address: PUB_A,
  publishable_key: 'pk',
  api_base_url: 'https://example.invalid',
  provider: 'google',
};

const profile = (publicKey: string, name: string) => ({ publicKey, name, birthdate: '', email: '' });

/** The pair a social login lands: the custodied identity plus its hidden seeded half. */
async function landPair(): Promise<{ custodied: WalletEntry; seeded: WalletEntry; all: WalletEntry[] }> {
  localStorage.clear();
  const vk = await deriveVaultKey('Test-pass-123', newKdfParams());
  const { entry: custodied } = await createPollarWallet(profile(PUB_A, 'Ada'), session, vk);
  const { entry: seeded } = await createSocialLocalWallet(
    { ...profile(PUB_B, 'Ada'), testnetFor: custodied.id },
    SEED,
    vk,
  );
  return { custodied, seeded, all: await listWallets() };
}

test('a plain seed wallet is not paired, and no network moves it', async () => {
  localStorage.clear();
  const vk = await deriveVaultKey('Test-pass-123', newKdfParams());
  const solo = await addWallet(SEED, profile(PUB_A, 'Solo'), vk);
  const all = await listWallets();

  // The rule must not reach wallets it was not written for: a seed is valid everywhere.
  assert.equal(entryForNetwork(solo, all, true).id, solo.id);
  assert.equal(entryForNetwork(solo, all, false).id, solo.id);
  assert.equal(identityOf(solo, all).id, solo.id);
});

test('both controls resolve the same pair to the same entry', async () => {
  const { custodied, seeded, all } = await landPair();

  // The switcher's angle: the user taps the identity, the network decides which half.
  assert.equal(entryForNetwork(custodied, all, true).id, custodied.id);
  assert.equal(entryForNetwork(custodied, all, false).id, seeded.id);

  // The network selector's angle: already standing on one half, pick the other network.
  assert.equal(entryForNetwork(seeded, all, true).id, custodied.id);
  assert.equal(entryForNetwork(seeded, all, false).id, seeded.id);
});

test('the identity is what a picker highlights, from either half', async () => {
  const { custodied, seeded, all } = await landPair();
  assert.equal(identityOf(seeded, all).id, custodied.id);
  assert.equal(identityOf(custodied, all).id, custodied.id);
});

test('a custodied wallet with no seeded half resolves to itself, so the caller can refuse', async () => {
  localStorage.clear();
  const vk = await deriveVaultKey('Test-pass-123', newKdfParams());
  const { entry } = await createPollarWallet(profile(PUB_A, 'Ada'), session, vk);
  const all = await listWallets();

  // Never null and never someone else's wallet: the store checks `isPollar` on the result
  // and shows the "your Google account lives on mainnet" line instead of switching.
  assert.equal(entryForNetwork(entry, all, false).id, entry.id);
});

test('deleting the account deletes its hidden half — no unreachable wallet is left', async () => {
  const { custodied, seeded } = await landPair();

  const { remaining, newActive } = await removeWallet(custodied.id);
  assert.deepEqual(remaining, [], 'both halves go, or the survivor is unreachable');
  assert.equal(newActive, null);
  assert.equal(localStorage.getItem(`cosmos.w.${seeded.id}`), null, 'the seed box goes too');
  assert.equal(localStorage.getItem(`cosmos.pollar.${custodied.id}`), null);
});
