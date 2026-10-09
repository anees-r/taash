/* All 52 cards at several sizes — visual/regression check for the card component.
   Only available outside production, or when TAASH_E2E=1 for end-to-end tests. */
import { notFound } from 'next/navigation';
import { PlayingCard } from '@/components/game/PlayingCard';

export const dynamic = 'force-dynamic';
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

export default async function CardSheet({ searchParams }) {
  if (process.env.NODE_ENV === 'production' && process.env.TAASH_E2E !== '1') notFound();
  const { sizes = '34,48,64,92,120' } = await searchParams;
  const list = String(sizes).split(',').map(Number).filter(n => n >= 20 && n <= 200);
  return (
    <main style={{ padding: 16, display: 'grid', gap: 12, background: 'var(--baize-800)' }} data-testid="card-sheet">
      {list.map(size => ['S', 'H', 'D', 'C'].map(s => (
        <div key={size + s} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANKS.map(r => <PlayingCard key={r + s} card={r + s} size={size} />)}
        </div>
      )))}
      <div style={{ display: 'flex', gap: 6 }}>{['AD', '10D', '10C', 'KH', '2S'].map(id => <PlayingCard key={id} card={id} size={34} mini />)}</div>
    </main>
  );
}
