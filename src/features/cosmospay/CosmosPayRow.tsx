import { KVRow } from '@/ui/KVRow';
import '@/styles/features/cosmospay/cosmos-pay.css';

/** Key/value row inside a Cosmos Pay card (org id, receiver id…).
 *  Kept as a named wrapper so the screen reads in its own vocabulary; the row
 *  itself is the shared KVRow. */
export function CosmosPayRow({ label, value }: { label: string; value: string }) {
  return <KVRow label={label} value={value} className="cosmospay-row" />;
}
