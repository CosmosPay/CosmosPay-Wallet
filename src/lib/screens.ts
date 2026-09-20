/**
 * The screen table — one typed row per screen, and the only place navigation is
 * described.
 *
 * There used to be four independent "back" mechanisms that had to be kept in sync by
 * hand, with no compiler help because both switches had a `default`:
 *   1. a 30-case switch in WalletApp for the Android hardware button,
 *   2. `store.back(fallback)` with a hardcoded 11-entry `containers` list,
 *   3. `store.go(screen, tab)`,
 *   4. bare `store.setScreen(screen)` at the call site.
 * Across 36 `onBack={…}` handlers all four were in use, and several disagreed with
 * the Android switch about the same screen.
 *
 * Now: `SCREEN_IDS` derives the `Screen` union, and `SCREENS` is typed
 * `Record<Screen, ScreenDef>` — so adding an id without a row is a compile error, and
 * `WalletApp`'s render map is exhaustive for the same reason. `back` here is only the
 * FALLBACK: the store keeps a real navigation stack and pops it first, so a screen
 * reachable from several places returns to where the user actually came from.
 */

export type Tab = 'home' | 'earn' | 'markets' | 'profile';

/** Every screen id. Adding one here forces a row in SCREENS below. */
export const SCREEN_IDS = [
  'boot',
  'welcome',
  'backup',
  'verify',
  'import',
  'profile-setup',
  'password',
  'device-auth',
  'sign-in',
  'sign-in-password',
  'recover',
  'migrate',
  'unlock',
  'home',
  'earn',
  'liquidity',
  'lp-deposit',
  'lp-withdraw',
  'markets',
  'profile',
  'asset',
  'receive',
  'send',
  'swap',
  'select',
  'confirm',
  'success',
  'export',
  'settings',
  'about',
  'operations',
  'gateway-ops',
  'history',
  'paylink',
  'fiat',
  'cosmospay',
  'bankaccount',
  'deposit',
  'withdraw',
  'sign-tx',
  'add-network',
  'add-asset',
  'edit-profile',
  'scan',
] as const;

export type Screen = (typeof SCREEN_IDS)[number];

/** What the store knows that a dynamic back target may depend on. Deliberately a
 *  small value object rather than the whole store, so the table stays testable. */
export interface BackContext {
  hasSession: boolean;
  tab: Tab;
  addingWallet: boolean;
  /** True when onboarding created a phrase (so `profile-setup` came from `verify`). */
  hasDraftMnemonic: boolean;
  /** True while a first-run sign-in is waiting for the password its new wallet will be
   *  sealed under — the password screen was then reached from `sign-in`, and there is no
   *  seed draft and no `profile-setup` behind it to go back to. */
  hasSignInDraft: boolean;
}

/** `'exit'` leaves the app on native; on the other shells it simply does nothing. */
export type BackTarget = Screen | 'exit' | ((c: BackContext) => Screen | 'exit');

export interface ScreenDef {
  /** Fallback destination when the navigation stack is empty. */
  back: BackTarget;
  /** The bottom-nav tab this screen activates. */
  tab?: Tab;
  /** Show the bottom navigation bar (only ever with an open session). */
  nav?: boolean;
  /** Terminal screen: arriving here clears the stack, so back cannot re-enter the
   *  flow that produced it (e.g. back from `success` must not return to `confirm`). */
  terminal?: boolean;
}

const profileOrHome = (c: BackContext): Screen => (c.hasSession ? 'profile' : 'home');

export const SCREENS: Record<Screen, ScreenDef> = {
  boot: { back: 'exit' },

  // onboarding
  welcome: { back: (c) => (c.addingWallet ? 'profile' : 'exit') },
  backup: { back: 'welcome' },
  verify: { back: 'backup' },
  // Terminal: it is offered once, after onboarding's success screen, and "back" from
  // it must not walk into the flow that created the wallet.
  'device-auth': { back: 'home', terminal: true },
  import: { back: 'welcome' },
  'profile-setup': { back: (c) => (c.hasDraftMnemonic ? 'verify' : 'import') },
  // Reached from 'welcome' — on a first run, and on the add-wallet path, which starts there
  // too. Back goes wherever the stack says; 'profile' is only the fallback, and on a first
  // run the stack is what answers.
  'sign-in': { back: (c) => (c.hasSession ? 'profile' : 'welcome') },
  // The password a finished sign-in still needs: the backup's to restore it, or this
  // device's to seal a new one. Only ever reached from 'sign-in'.
  'sign-in-password': { back: 'sign-in' },
  // Getting an account back with no device and no password (SEP-30). Reached from the
  // password screen, which is where someone discovers they cannot go on without it.
  recover: { back: 'sign-in-password' },
  // Two flows end here. The seed one arrives from `profile-setup`; a first-run sign-in with
  // nothing to restore arrives straight from `sign-in` with only the password left to
  // collect, and must not be sent back into a profile form it never saw.
  password: { back: (c) => (c.hasSignInDraft ? 'sign-in' : 'profile-setup') },
  unlock: { back: 'exit' },

  // tabs
  home: { back: 'exit', tab: 'home', nav: true },
  earn: { back: 'home', tab: 'earn', nav: true },
  markets: { back: 'home', tab: 'markets', nav: true },
  profile: { back: 'home', tab: 'profile', nav: true },

  // money
  receive: { back: 'home' },
  send: { back: 'home' },
  swap: { back: 'home', nav: true },
  select: { back: 'send' },
  confirm: { back: 'send' },
  success: { back: (c) => (c.hasSession ? 'home' : 'unlock'), terminal: true },
  history: { back: 'home' },
  paylink: { back: 'receive' },
  asset: { back: (c) => c.tab },

  // liquidity
  liquidity: { back: 'earn' },
  'lp-deposit': { back: 'liquidity' },
  'lp-withdraw': { back: 'liquidity' },

  // fiat / CosmosPay
  fiat: { back: 'home' },
  cosmospay: { back: 'profile' },
  bankaccount: { back: 'fiat' },
  deposit: { back: 'fiat' },
  withdraw: { back: 'fiat' },

  // settings
  settings: { back: profileOrHome },
  export: { back: profileOrHome },
  about: { back: profileOrHome },
  'edit-profile': { back: 'profile' },
  // Moving an old Pollar wallet's funds onto a key this device holds. Reached from the
  // banner on Home and from Profile.
  migrate: { back: 'home' },

  // extras
  operations: { back: 'home' },
  'sign-tx': { back: 'operations' },
  'gateway-ops': { back: 'operations' },
  'add-network': { back: 'home' },
  'add-asset': { back: 'home' },
  scan: { back: 'send' },
};

/** Resolve a screen's fallback destination for the given context. */
export function backTarget(screen: Screen, ctx: BackContext): Screen | 'exit' {
  const def = SCREENS[screen].back;
  return typeof def === 'function' ? def(ctx) : def;
}

/** Screens that show the bottom navigation bar (with an open session). */
export const NAV_SCREENS: Screen[] = SCREEN_IDS.filter((s) => SCREENS[s].nav);

// There was an `isScreen()` guard here, documented as protecting against a screen id
// arriving from storage or a URL. Nothing in `src/` ever called it, and no such input
// exists: every navigation goes through `navigate(s: Screen)`. It has been removed
// rather than left as a promise the code does not keep — if a deeplink ever does
// carry a screen id, the guard comes back with the caller that needs it.
