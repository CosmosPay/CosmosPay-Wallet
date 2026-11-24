import { PROVIDER_NAMES } from '@/constants/providerNames';

/** Whether `text` names one of the services the copy never names (`constants/providerNames.ts`), in any case. */
export function namesProvider(text: string): boolean {
  const lower = (text ?? '').toLowerCase();
  return PROVIDER_NAMES.some((name) => lower.includes(name.toLowerCase()));
}
