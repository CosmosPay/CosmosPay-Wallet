/** Onboarding flow constants (profile, password and backup screens). */

/** Gender picker options — 'x' = non-binary / prefer not to say. */
export const GENDER_OPTIONS = ['m', 'f', 'x'] as const;

/** Minimum age to use the app: 13 (fiat has its own 18+ gate later). */
export const MIN_AGE = 13;

/** Input length caps for the profile form. */
export const NAME_MAX_LEN = 24;
export const EMAIL_MAX_LEN = 80;

/** How long the Backup copy button shows the "copied" state. */
export const COPY_FEEDBACK_MS = 1600;

/** Password policy: minimum length (the live criteria checklist mirrors this). */
export const PWD_MIN_LEN = 8;
