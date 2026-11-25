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

/**
 * The keys a returning person may be greeted with at this hour: the time-of-day lines and the
 * "welcome back" ones. Each has a `.named` twin that carries the name in a `{name}` slot, so a
 * line that ends in "!" or "?" puts the name before the mark ("Welcome back, Alex!") in every
 * language, instead of after it ("Welcome back!, Alex").
 */
export function returnGreetingKeys(hour: number, gender: Gender): string[] {
  const key = dayPart(hour);
  return [key, `${key}.2`, `${key}.3`, `greet.back.1.${gender}`, 'greet.back.2', 'greet.back.3', `greet.back.4.${gender}`];
}

/** birthdate is ISO "YYYY-MM-DD" or ''. `gender` picks the right gendered copy
 *  (bienvenido/bienvenida/bienvenidx); missing (legacy wallets) falls back to 'x'. */
export function getGreeting(
  name: string,
  birthdate: string,
  t: TFn,
  gender?: Gender,
  now: Date = new Date(),
  random: () => number = Math.random,
): Greeting {
  const who = name?.trim() || 'astronauta';
  let isBirthday = false;
  const age = ageFromBirthdate(birthdate);

  if (birthdate) {
    const d = new Date(birthdate + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) {
      isBirthday = d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }
  }

  // Random salutation, always coherent with the hour: the time-of-day variants plus
  // the generic "welcome back" lines. Callers memoize per mount so it doesn't
  // flicker between renders (a new one appears on each app open).
  const g: Gender = gender === 'm' || gender === 'f' ? gender : 'x';
  const keys = returnGreetingKeys(now.getHours(), g);
  const pickedKey = keys[Math.floor(random() * keys.length)];
  const picked = t(pickedKey);
  // The line with the name is its own translation (`.named`, a `{name}` slot), never the
  // salutation with ", name" glued on: that put the name after a "!" or a "?".
  const line = isBirthday ? t('greet.birthday', { name: who }) : t(`${pickedKey}.named`, { name: who });
  // Salutation without the name (the header shows the name separately, big).
  // For birthdays, strip ", <name>" out of the localized line — works in all 5 langs.
  const salutation = isBirthday ? t('greet.birthday', { name: who }).replace(`, ${who}`, '') : picked;
  return { line, salutation, isBirthday, age };
}
