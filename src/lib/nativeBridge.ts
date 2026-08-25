/**
 * The single door to `tauri-plugin-cosmos`, the wallet's own native plugin.
 *
 * Two unrelated capabilities live behind that one plugin — the biometric secure store and
 * the mobile share sheet — because a Tauri mobile plugin carries a Gradle module and a
 * Swift package with it, and doubling that boilerplate to separate two commands buys
 * nothing. They share a crate and NOTHING else: separate Rust modules, separate Kotlin and
 * Swift classes, no shared state.
 *
 * Every command name in the app is spelled once, here. A typo in an `invoke` string is a
 * runtime rejection with a message about an unknown command, which reads like a broken
 * install rather than a typo — and it would be found on a phone, not in CI.
 */
import { isMobileApp, isTauri } from '@/lib/platform';

/** Must match `tauri::plugin::Builder::new("cosmos")` in the plugin's `lib.rs`. */
const PLUGIN = 'cosmos';

export type NativeCommand =
  // device-auth: see src/lib/deviceAuth.ts
  | 'auth_status'
  | 'auth_store'
  | 'auth_read'
  | 'auth_delete'
  // share sheet: see src/lib/share.ts
  | 'share_text'
  // hardware back button with an empty stack: see src/app/WalletApp.tsx
  | 'app_exit';

/**
 * Events the plugin pushes at the frontend, rather than answering.
 *
 * Delivered as a plain DOM event on `window`, NOT through `addPluginListener`. That is not
 * the idiomatic route and the reason is concrete: `addPluginListener` invokes
 * `plugin:<name>|register_listener`, a command Tauri implements in the Android and iOS
 * `Plugin` base classes but does NOT forward to from Rust — a custom plugin has to hold the
 * `Channel` and route it itself. That is real plumbing on the signing path's own crate to
 * deliver one zero-argument notification.
 *
 * The plugin calls `evaluateJavascript` instead. Namespaced, because `window` is a shared
 * bus and a bare `backPressed` is a name any library could take.
 */
export type NativeEvent = 'cosmos:backPressed';

/**
 * Call a plugin command.
 *
 * REJECTS off Tauri rather than resolving to a stub, and that direction is deliberate.
 * `astro build` emits one bundle for five hosts, so this module is present in the web page
 * and the MV3 popup, where no plugin is registered. The failure mode this avoids is the one
 * `lib/deviceAuth.ts` documents at length: a stub that answers "available" and stores the
 * wrapping key in a `Map` would make the web build report a password as hardware-protected.
 * A rejection cannot be mistaken for a success.
 */
export async function nativeInvoke<T>(command: NativeCommand, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(`native plugin unavailable: ${command}`);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(`plugin:${PLUGIN}|${command}`, args);
}

/**
 * Subscribe to a plugin event. Returns an unsubscribe function.
 *
 * Synchronous, and off the MOBILE build it is a no-op. The asymmetry with `nativeInvoke` —
 * which rejects — is deliberate: a command that silently did nothing would be mistaken for
 * one that worked, while a listener that never fires is indistinguishable from a listener
 * for an event that never happens, which is exactly the truth in a browser tab and in a
 * desktop window.
 */
export function nativeListen(event: NativeEvent, handler: () => void): () => void {
  if (!isMobileApp() || typeof window === 'undefined') return () => {};
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}
