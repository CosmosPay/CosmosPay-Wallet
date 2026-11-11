/**
 * The flags of the countries whose currency the P2P market trades, loaded lazily by
 * `RampPickers.tsx` (`CurrencyFlag`): they are country-flag-icons artwork, which must not reach
 * the entry chunk (`ui/FlagIcon.tsx` says why). A currency whose country is not here shows its
 * two letters instead; add the country when the market lists a new currency.
 */
import type { ReactNode } from 'react';
import AR from 'country-flag-icons/react/3x2/AR';
import BO from 'country-flag-icons/react/3x2/BO';
import BR from 'country-flag-icons/react/3x2/BR';
import CL from 'country-flag-icons/react/3x2/CL';
import CO from 'country-flag-icons/react/3x2/CO';
import MX from 'country-flag-icons/react/3x2/MX';
import PE from 'country-flag-icons/react/3x2/PE';
import US from 'country-flag-icons/react/3x2/US';
import VE from 'country-flag-icons/react/3x2/VE';

const FLAGS: Record<string, typeof AR> = { AR, BO, BR, CL, CO, MX, PE, US, VE };

export default function CurrencyFlagArt({ country, fallback }: { country: string; fallback: ReactNode }) {
  const Flag = FLAGS[country];
  return Flag ? <Flag className="ramp-flag-img" aria-hidden="true" /> : <>{fallback}</>;
}
