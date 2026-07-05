import '@/styles/screens/cosmos-pay.css';

/** Key/value row inside a Cosmos Pay card (org id, receiver id…). */
export function CosmosPayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="cosmospay-row">
      <span className="t-muted-13">{label}</span>
      <span className="cosmospay-row-val">{value}</span>
    </div>
  );
}
