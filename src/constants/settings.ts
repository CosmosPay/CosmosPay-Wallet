/** Constants for the settings area (Settings / Export) and the Cosmos Pay
 *  integration screen. Label keys resolve through i18n at render time. */

/** Minimum vault password length (mirrors the password-setup rule / `pwd.min` copy). */
export const MIN_PWD_LEN = 8;

/** Theme picker options — Settings appearance section. */
export const THEME_OPTIONS = [
  { id: 'dark', labelKey: 'settings.dark', icon: '🌙' },
  { id: 'light', labelKey: 'settings.light', icon: '☀️' },
] as const;

/** Characters of an ID kept before the ellipsis (Cosmos Pay org / receiver ids). */
export const ID_PREVIEW_LEN = 12;
