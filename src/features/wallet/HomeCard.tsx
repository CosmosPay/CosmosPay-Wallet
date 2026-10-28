import type { ReactNode } from 'react';
import '@/styles/features/wallet/home.css';

/**
 * A card on Home that asks for something (activate the account, protect it): a line around a
 * title, a sentence, and its own actions. Lines, never a fill — the cards sit on the canvas.
 */
export function HomeCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="home-card" aria-label={title}>
      <h2 className="home-card-title">{title}</h2>
      {children}
    </section>
  );
}
