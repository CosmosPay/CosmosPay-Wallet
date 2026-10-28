import { SCREEN_IDS, type Screen } from '@/lib/screens';

/**
 * The flow as browser history.
 *
 * The wallet is a PWA, so the browser's back and forward buttons, the mouse's side buttons,
 * Alt+arrows and the phone's system back must walk it exactly like the app's own back
 * button: one step at a time, and only ever onto a step that can still be shown. The app's
 * navigation stack stays the source of truth (`navigate`, `goBack` in the store); every
 * history entry carries the WHOLE path to its place, so a traversal of any distance —
 * back, forward, or a jump from the browser's history menu — is answered by adopting that
 * path rather than by replaying moves.
 *
 * A place is a screen plus, for a screen with steps of its own (the sign-in's email and
 * code, the password's consents), the step. Only names travel: nothing typed, nothing
 * secret, and the URL is never touched.
 */
export interface NavPlace {
  screen: Screen;
  step?: string;
}

export interface NavHistoryState {
  /** This page load's id: entries left by an earlier load are not this app's to adopt. */
  cosmosNav: string;
  path: NavPlace[];
}

const SCREENS_KNOWN: ReadonlySet<string> = new Set(SCREEN_IDS);

/** This page load's id, written into every entry. Not a secret: it only tells this load's
 *  entries from an earlier one's, whose in-memory steps are gone. */
export const NAV_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function navState(session: string, path: readonly NavPlace[]): NavHistoryState {
  return { cosmosNav: session, path: path.map((p) => (p.step === undefined ? { screen: p.screen } : { ...p })) };
}

/** The path an entry carries, or null when the entry is not one this page load wrote. */
export function readNavState(value: unknown, session: string): NavPlace[] | null {
  if (!value || typeof value !== 'object') return null;
  const { cosmosNav, path } = value as Partial<NavHistoryState>;
  if (cosmosNav !== session || !Array.isArray(path) || path.length === 0) return null;
  const places: NavPlace[] = [];
  for (const p of path) {
    if (!p || typeof p !== 'object' || !SCREENS_KNOWN.has((p as NavPlace).screen)) return null;
    const { screen, step } = p as NavPlace;
    if (step !== undefined && typeof step !== 'string') return null;
    places.push(step === undefined ? { screen } : { screen, step });
  }
  return places;
}

export function samePlace(a: NavPlace, b: NavPlace): boolean {
  return a.screen === b.screen && a.step === b.step;
}

export function samePath(a: readonly NavPlace[], b: readonly NavPlace[]): boolean {
  return a.length === b.length && a.every((p, i) => samePlace(p, b[i]));
}

/**
 * What bringing the browser in line with the app's path takes, from the depth of the entry
 * the browser is on (0 = the first entry this load wrote):
 * - `replace`: same depth — the place changed without a step forward (a redirect, a lock).
 * - `push`: deeper — one entry per new step, so each is a stop on the way back.
 * - `rewind`: shallower — the app went back (its own back button) or started over (a lock,
 *   a finished flow); the browser goes back too, keeping what was ahead for "forward".
 */
export type HistorySync = { kind: 'replace' } | { kind: 'push'; from: number } | { kind: 'rewind'; delta: number };

export function planSync(depth: number, path: readonly NavPlace[]): HistorySync {
  const want = path.length - 1;
  if (want === depth) return { kind: 'replace' };
  if (want > depth) return { kind: 'push', from: depth + 1 };
  return { kind: 'rewind', delta: want - depth };
}
