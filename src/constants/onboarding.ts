/** Onboarding flow constants (profile, password and backup screens). */

/** Gender picker options — 'x' = non-binary / prefer not to say. */
export const GENDER_OPTIONS = ['m', 'f', 'x'] as const;

/** Minimum age to use the app: 13 (fiat has its own 18+ gate later). */
export const MIN_AGE = 13;

/** How long the Backup copy button shows the "copied" state. */
export const COPY_FEEDBACK_MS = 1600;

// Input caps + password policy have a single source in lib/validation; re-exported
// here so existing `@/constants/onboarding` imports keep working unchanged.
export { NAME_MAX_LEN, EMAIL_MAX_LEN, PWD_MIN_LEN } from '@/lib/validation';
