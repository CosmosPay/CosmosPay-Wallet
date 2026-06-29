/** Friendly, localized greeting built from the user's name + birthdate. */
import type { TFn } from './i18n';

export interface Greeting {
  line: string; // e.g. "Good evening, Alex"
  isBirthday: boolean;
  age: number | null;
}

/** birthdate is ISO "YYYY-MM-DD" or ''. */
export function getGreeting(name: string, birthdate: string, t: TFn): Greeting {
  const who = name?.trim() || 'astronauta';
  let isBirthday = false;
  let age: number | null = null;

  if (birthdate) {
    const d = new Date(birthdate + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      isBirthday = d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      age = now.getFullYear() - d.getFullYear();
      const had =
        now.getMonth() > d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate());
      if (!had) age -= 1;
    }
  }

  const h = new Date().getHours();
  const key = h < 5 ? 'greet.evening' : h < 13 ? 'greet.morning' : h < 20 ? 'greet.afternoon' : 'greet.evening';
  const line = isBirthday ? t('greet.birthday', { name: who }) : `${t(key)}, ${who}`;
  return { line, isBirthday, age };
}
