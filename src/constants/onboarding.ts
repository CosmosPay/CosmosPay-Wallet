/** Onboarding flow constants (profile, password and backup screens). */

/** Gender picker options — 'x' = non-binary / prefer not to say. Drives gendered
 *  copy ("bienvenido/bienvenida/bienvenidx") so the app never misgenders anyone.
 *  Shared by the onboarding ProfileSetup and the EditProfile screen. */
export const GENDER_OPTIONS = [
  { id: 'm', labelKey: 'setup.genderM' },
  { id: 'f', labelKey: 'setup.genderF' },
  { id: 'x', labelKey: 'setup.genderX' },
] as const;

/** Minimum age to use the app: 13 (fiat has its own 18+ gate later). */
export const MIN_AGE = 13;

/** Input length caps for the profile form. */
export const NAME_MAX_LEN = 24;
export const EMAIL_MAX_LEN = 80;

/** Password policy: minimum length (the live criteria checklist mirrors this). */
export const PWD_MIN_LEN = 8;
