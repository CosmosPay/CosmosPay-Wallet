/** Constants for the settings area (Settings / Export) and the Cosmos Pay
 *  integration screen. Label keys resolve through i18n at render time. */

// `MIN_PWD_LEN` lived here and is gone on purpose. It was the change-password form's whole
// rule while onboarding independently demanded 8 + upper + lower + digit, so the two screens
// disagreed about what may seal a vault and the weaker one won. The rule is now
// `appPasswordOk` / `MIN_APP_PWD_LEN` in `src/lib/validate.ts`, next to the other predicates
// and re-checked by the store — a length constant sitting alone here is what invited a
// screen to treat length as the whole rule.

/** Theme picker options — Settings appearance section. `system` (the default) follows
 *  the device; the icon names a `ThemeIcon` kind (src/ui/Icons.tsx). */
export const THEME_OPTIONS = [
  { id: 'system', labelKey: 'settings.system', icon: 'system' },
  { id: 'light', labelKey: 'settings.light', icon: 'sun' },
  { id: 'dark', labelKey: 'settings.dark', icon: 'moon' },
] as const;

/** Idle auto-lock choices — Settings security section (`AUTO_LOCK_CHOICES_MS`, same order). */
export const AUTO_LOCK_OPTIONS = [
  { ms: 15 * 60_000, labelKey: 'settings.autoLock15m' },
  { ms: 60 * 60_000, labelKey: 'settings.autoLock1h' },
  { ms: 24 * 60 * 60_000, labelKey: 'settings.autoLock1d' },
  { ms: 7 * 24 * 60 * 60_000, labelKey: 'settings.autoLock7d' },
] as const;

/** Characters of an ID kept before the ellipsis (Cosmos Pay org / receiver ids). */
export const ID_PREVIEW_LEN = 12;
