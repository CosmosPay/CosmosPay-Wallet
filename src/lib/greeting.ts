/** Friendly, localized greeting built from the user's name + birthdate. */
import type { TFn } from '@/lib/i18n';
import type { Gender } from '@/lib/vault';

export interface Greeting {
  line: string; // e.g. "Good evening, Alex"
  salutation: string; // the line without the name — e.g. "Good evening" (header small print)
  isBirthday: boolean;
  age: number | null;
}

/** Age in full years from an ISO "YYYY-MM-DD" birthdate; null when missing/invalid.
 *  Also used to gate age-restricted features (fiat on/off-ramp requires 18+). */
export function ageFromBirthdate(birthdate: string): number | null {
  if (!birthdate) return null;
  const d = new Date(birthdate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const had =
    now.getMonth() > d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate());
  if (!had) age -= 1;
  return age;
}

/** The time-of-day key for an hour: night until 5, morning until 13, afternoon until 20. */
function dayPart(hour: number): 'greet.morning' | 'greet.afternoon' | 'greet.evening' {
  return hour < 5 ? 'greet.evening' : hour < 13 ? 'greet.morning' : hour < 20 ? 'greet.afternoon' : 'greet.evening';
}

/** Every line `welcomeGreeting` may pick at this hour. */
export function welcomeGreetings(t: TFn, hour: number): string[] {
  const key = dayPart(hour);
  return [t(key), t(`${key}.2`), t(`${key}.3`), t('greet.first.1'), t('greet.first.2'), t('greet.first.3')];
}

/**
 * The Welcome screen's greeting: someone with no wallet here yet, so no name and no
 * "welcome back". Random like Unlock's, from the time-of-day lines plus the first-visit ones,
 * so it varies from one visit to the next and always fits the hour. Callers memoize per
 * mount, so it does not change under the person while they read it.
 */
export function welcomeGreeting(t: TFn, now: Date = new Date(), random: () => number = Math.random): string {
  const pool = welcomeGreetings(t, now.getHours());
  return pool[Math.floor(random() * pool.length)];
}

/** birthdate is ISO "YYYY-MM-DD" or ''. `gender` picks the right gendered copy
 *  (bienvenido/bienvenida/bienvenidx); missing (legacy wallets) falls back to 'x'. */
export function getGreeting(name: string, birthdate: string, t: TFn, gender?: Gender): Greeting {
  const who = name?.trim() || 'astronauta';
  let isBirthday = false;
  const age = ageFromBirthdate(birthdate);

  if (birthdate) {
    const d = new Date(birthdate + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      isBirthday = d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }
  }

  const key = dayPart(new Date().getHours());
  // Random salutation, always coherent with the hour: the time-of-day variants plus
  // the generic "welcome back" lines. Callers memoize per mount so it doesn't
  // flicker between renders (a new one appears on each app open).
  const g: Gender = gender === 'm' || gender === 'f' ? gender : 'x';
  const pool = [t(key), t(`${key}.2`), t(`${key}.3`), t(`greet.back.1.${g}`), t('greet.back.2'), t('greet.back.3'), t(`greet.back.4.${g}`)];
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const line = isBirthday ? t('greet.birthday', { name: who }) : `${picked}, ${who}`;
  // Salutation without the name (the header shows the name separately, big).
  // For birthdays, strip ", <name>" out of the localized line — works in all 5 langs.
  const salutation = isBirthday ? t('greet.birthday', { name: who }).replace(`, ${who}`, '') : picked;
  return { line, salutation, isBirthday, age };
}
