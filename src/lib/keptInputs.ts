/**
 * What a person typed or chose on a step of a flow, kept while they walk back and forth
 * through it — the user's call: going back must not mean typing it all again
 * (`hooks/useKeptState.ts`, keys in `constants/keptInputs.ts`).
 *
 * Never a password, a recovery phrase, a secret key or a one-time code: those stay in the
 * screen that uses them and are asked again. Memory only — a reload starts clean — and a
 * finished flow forgets all of it (`forgetKeptInputs`, when a terminal screen is reached).
 */
const kept = new Map<string, unknown>();

export function keptInput<T>(key: string): T | undefined {
  return kept.get(key) as T | undefined;
}

export function keepInput(key: string, value: unknown): void {
  kept.set(key, value);
}

export function forgetKeptInput(key: string): void {
  kept.delete(key);
}

export function forgetKeptInputs(): void {
  kept.clear();
}
