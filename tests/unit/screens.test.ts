/**
 * The screen table. Navigation used to be four hand-synced mechanisms with no
 * compiler help and no test; extracting it into data is what makes this possible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_SCREENS, SCREENS, SCREEN_IDS, backTarget, type BackContext } from '@/lib/screens';

const ctx = (over: Partial<BackContext> = {}): BackContext => ({
  hasSession: true,
  tab: 'home',
  addingWallet: false,
  hasDraftMnemonic: false,
  ...over,
});

test('every screen id has a row, and every row is a screen id', () => {
  assert.equal(Object.keys(SCREENS).length, SCREEN_IDS.length);
  for (const s of SCREEN_IDS) assert.ok(SCREENS[s], `missing row for ${s}`);
});

test('every back target resolves to a real screen (or exit)', () => {
  const contexts = [
    ctx(),
    ctx({ hasSession: false }),
    ctx({ addingWallet: true }),
    ctx({ hasDraftMnemonic: true }),
    ctx({ tab: 'earn' }),
    ctx({ tab: 'markets' }),
    ctx({ tab: 'profile' }),
  ];
  for (const s of SCREEN_IDS) {
    for (const c of contexts) {
      const target = backTarget(s, c);
      assert.ok(target === 'exit' || SCREEN_IDS.includes(target), `${s} -> ${String(target)} is not a screen`);
    }
  }
});

test('back never points at itself — that would trap the user', () => {
  for (const s of SCREEN_IDS) {
    const target = backTarget(s, ctx());
    assert.notEqual(target, s, `${s} points back at itself`);
  }
});

test('following back repeatedly always terminates at exit', () => {
  for (const start of SCREEN_IDS) {
    let cur: string = start;
    const path = [cur];
    for (let i = 0; i < SCREEN_IDS.length + 1; i++) {
      const next = backTarget(cur as never, ctx());
      if (next === 'exit') break;
      assert.ok(!path.includes(next), `back loop: ${path.join(' -> ')} -> ${next}`);
      path.push(next);
      cur = next;
    }
  }
});

test('the onboarding chain matches the flow the user walked', () => {
  assert.equal(backTarget('backup', ctx()), 'welcome');
  assert.equal(backTarget('verify', ctx()), 'backup');
  assert.equal(backTarget('password', ctx()), 'profile-setup');
  // profile-setup came from `verify` when a phrase was generated, `import` otherwise.
  assert.equal(backTarget('profile-setup', ctx({ hasDraftMnemonic: true })), 'verify');
  assert.equal(backTarget('profile-setup', ctx({ hasDraftMnemonic: false })), 'import');
});

test('session-dependent targets respect the lock state', () => {
  assert.equal(backTarget('settings', ctx({ hasSession: true })), 'profile');
  assert.equal(backTarget('settings', ctx({ hasSession: false })), 'home');
  assert.equal(backTarget('success', ctx({ hasSession: true })), 'home');
  assert.equal(backTarget('success', ctx({ hasSession: false })), 'unlock');
});

test('asset returns to whichever tab opened it', () => {
  assert.equal(backTarget('asset', ctx({ tab: 'home' })), 'home');
  assert.equal(backTarget('asset', ctx({ tab: 'markets' })), 'markets');
});

test('only the true roots exit the app', () => {
  const exits = SCREEN_IDS.filter((s) => backTarget(s, ctx()) === 'exit');
  assert.deepEqual([...exits].sort(), ['boot', 'home', 'unlock', 'welcome'].sort());
  // …and `welcome` while adding a second wallet must NOT exit — it cancels.
  assert.equal(backTarget('welcome', ctx({ addingWallet: true })), 'profile');
});

test('the nav bar is derived from the table, not a second list', () => {
  assert.deepEqual([...NAV_SCREENS].sort(), ['earn', 'home', 'markets', 'profile', 'swap'].sort());
  for (const s of NAV_SCREENS) assert.equal(SCREENS[s].nav, true);
});

test('success is terminal so back cannot re-enter the flow that produced it', () => {
  assert.equal(SCREENS.success.terminal, true);
  assert.ok(!SCREENS.confirm.terminal);
});

/**
 * `device-auth` is offered once, straight after onboarding's success screen, and it is the
 * screen where accepting seals the app password behind the phone's biometrics. Back from it
 * must not walk into the wallet-creation flow that produced it — and because it IS terminal,
 * the hardware back button leaves without running either of its buttons, which is why the
 * one-shot flag is cleared in `leaveSuccess` rather than in those handlers.
 */
test('device-auth is terminal and returns home, not into onboarding', () => {
  assert.equal(SCREENS['device-auth'].terminal, true);
  assert.equal(SCREENS['device-auth'].back, 'home');
});

