import { PlayingCard } from '@/components/game/PlayingCard';
import { Avatar } from './Avatar';

/** A small Thulla table mid-baari: three Hearts then a Thulla slap (pure CSS animation). */
export function MiniTable({ youName }) {
  const seats = [['Sana', 'right'], ['Bilal', 'top'], ['Hira', 'left'], ['You', 'bottom']];
  return (
    <div className="mini-table" aria-hidden="true">
      <div className="mt-felt">
        <div className="mt-pile">
          {['4H', '6H', '9H', 'AC'].map((id, i) => <span key={id} className="mt-c" style={{ '--i': i }}><PlayingCard card={id} size={58} className={i === 3 ? 'is-thulla' : ''} /></span>)}
        </div>
        <span className="mt-stamp display">Thulla!</span>
      </div>
      {seats.map(([name, pos]) => (
        <div key={pos} className={'mt-seat ' + pos}><Avatar person={{ name: name === 'You' ? (youName || 'You') : name }} size="sm" /><span>{name}</span></div>
      ))}
    </div>
  );
}
