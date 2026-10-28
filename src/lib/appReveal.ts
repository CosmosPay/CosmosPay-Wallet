/**
 * When the boot splash lets the app show.
 *
 * `WalletApp` covers the first ~1.3s of a cold start with the splash (`SPLASH_REVEAL_MS`),
 * and the screen under it has already mounted. Anything that plays once on arrival — the
 * Welcome hero's intro — waits for this, or it runs behind the splash and the person sees
 * only its end. The extension popup has no splash and marks the app revealed at once.
 */
let revealed = false;
const waiting = new Set<() => void>();

export function markAppRevealed(): void {
  if (revealed) return;
  revealed = true;
  for (const run of waiting) run();
  waiting.clear();
}

/** Runs `run` once the app is visible (now, if it already is). Returns a cancel. */
export function whenAppRevealed(run: () => void): () => void {
  if (revealed) {
    run();
    return () => {};
  }
  waiting.add(run);
  return () => {
    waiting.delete(run);
  };
}
