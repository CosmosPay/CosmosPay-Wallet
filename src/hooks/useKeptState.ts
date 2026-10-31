import { useCallback, useState, type SetStateAction } from 'react';
import { keepInput, keptInput } from '@/lib/keptInputs';

/**
 * `useState` whose value outlives the screen: a step left and come back to shows what was
 * typed or chosen there (`lib/keptInputs.ts`). Only for what is not a secret — a password,
 * a phrase, a key or a code keeps plain `useState`.
 */
export function useKeptState<T>(key: string, initial: T): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const was = keptInput<T>(key);
    return was === undefined ? initial : was;
  });
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue((prev) => {
        const value = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        keepInput(key, value);
        return value;
      }),
    [key],
  );
  return [value, set];
}
