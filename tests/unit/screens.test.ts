/**
 * The screen table. Navigation used to be four hand-synced mechanisms with no
 * compiler help and no test; extracting it into data is what makes this possible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EARN_ENABLED } from '@/constants/features';
import { EARN_SCREENS, NAV_SCREENS, SCREENS, SCREEN_IDS, TAB_SCREEN, backTarget, canEnter, isScreenOn, type BackContext } from '@/lib/screens';

const ctx = (over: Partial<BackContext> = {}): BackContext => ({
  hasSession: true,
  tab: 'home',
  addingWallet: false,
  hasDraftMnemonic: false,
  hasSignInDraft: false,
  hasDraftAccount: false,
  hasWallets: true,
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
  // Welcome -> how to back it up -> the words; Welcome -> which backup -> the import.
  assert.equal(backTarget('backup-choice', ctx()), 'welcome');
  assert.equal(backTarget('restore-choice', ctx()), 'welcome');
  assert.equal(backTarget('backup', ctx()), 'backup-choice');
  assert.equal(backTarget('import', ctx()), 'restore-choice');
  assert.equal(backTarget('verify', ctx()), 'backup');
  assert.equal(backTarget('password', ctx()), 'profile-setup');
  // profile-setup came from `verify` when a phrase was generated, `import` otherwise.
  assert.equal(backTarget('profile-setup', ctx({ hasDraftMnemonic: true })), 'verify');
  assert.equal(backTarget('profile-setup', ctx({ hasDraftMnemonic: false })), 'import');
});

test('a sign-in reaches the password screen from its own flow, not the seed one', () => {
  // The email is already proven by the time the password is asked for, and there is no
  // seed and no profile form behind it — sending "back" to `profile-setup` would drop the
  // user into a form for a wallet that does not exist.
  assert.equal(backTarget('password', ctx({ hasSignInDraft: true })), 'sign-in');
  assert.equal(backTarget('password', ctx({ hasSignInDraft: false })), 'profile-setup');
  // The backup's password is only ever asked for after a sign-in.
  assert.equal(backTarget('sign-in-password', ctx()), 'sign-in');
  // And the sign-in screen itself: a first run has no session and came from `welcome`.
  assert.equal(backTarget('sign-in', ctx({ hasSession: false })), 'welcome');
  assert.equal(backTarget('sign-in', ctx({ hasSession: true })), 'profile');
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
  assert.deepEqual([...NAV_SCREENS].sort(), ['earn', 'home', 'markets', 'profile', 'wallets'].sort());
  for (const s of NAV_SCREENS) assert.equal(SCREENS[s].nav, true);
});

test('a switched-off section has no way in: history cannot reach any of its screens', () => {
  for (const s of EARN_SCREENS) {
    assert.equal(isScreenOn(s), EARN_ENABLED, s);
    if (!EARN_ENABLED) assert.equal(canEnter(s, ctx()), false, s);
  }
  // only the section itself: every other screen stays reachable
  for (const s of SCREEN_IDS.filter((id) => !EARN_SCREENS.includes(id))) assert.equal(isScreenOn(s), true, s);
});

test('every tab opens a screen that activates it', () => {
  for (const [tab, screen] of Object.entries(TAB_SCREEN)) {
    if (tab === 'markets') continue; // a tab of Home now (its watchlist), not of the bar
    assert.equal(SCREENS[screen].tab, tab, screen);
  }
  assert.equal(TAB_SCREEN.wallet, 'wallets');
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


/**
 * The browser's back and forward buttons lead to screens by history, not by the flow. A step
 * whose input is gone must refuse, or it renders empty: the words after a lock, the backup's
 * password after the sign-in was dropped.
 */
test('history only re-enters a step whose input still exists', () => {
  const first = ctx({ hasSession: false });
  assert.equal(canEnter('backup', first), false);
  assert.equal(canEnter('backup', ctx({ hasSession: false, hasDraftMnemonic: true })), true);
  assert.equal(canEnter('verify', first), false);
  assert.equal(canEnter('profile-setup', first), false);
  assert.equal(canEnter('profile-setup', ctx({ hasSession: false, hasDraftAccount: true })), true);
  assert.equal(canEnter('password', first), false);
  assert.equal(canEnter('password', ctx({ hasSession: false, hasSignInDraft: true })), true);
  assert.equal(canEnter('sign-in-password', first), false);
  assert.equal(canEnter('sign-in-password', ctx({ hasSession: false, hasSignInDraft: true })), true);
  assert.equal(canEnter('welcome', first), true);
  assert.equal(canEnter('backup-choice', first), true);
});

test('history never re-enters a finished flow or crosses the lock', () => {
  for (const s of SCREEN_IDS) if (SCREENS[s].terminal) assert.equal(canEnter(s, ctx()), false, s);
  assert.equal(canEnter('boot', ctx()), false);
  // Locked: the wallet's screens are behind the password.
  assert.equal(canEnter('home', ctx({ hasSession: false })), false);
  assert.equal(canEnter('send', ctx({ hasSession: false })), false);
  // Unlocked: the onboarding is not walked back into, except to add a wallet.
  assert.equal(canEnter('backup-choice', ctx()), false);
  assert.equal(canEnter('backup-choice', ctx({ addingWallet: true })), true);
  assert.equal(canEnter('unlock', ctx()), false);
  assert.equal(canEnter('unlock', ctx({ hasSession: false, hasWallets: false })), false);
});
