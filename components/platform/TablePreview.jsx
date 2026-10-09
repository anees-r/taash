'use client';
/* Animated table preview from the prototype: a baari plays out on a loop —
   three Hearts, then the Thulla slap, then Hira collects. Stops when unmounted
   or when the tab is hidden; static under reduced motion. */
import { useEffect, useRef } from 'react';

import { renderCard } from '@/lib/client/cards';
import { Avatar } from './Avatar';

const SEQ = [['4H', 3, 'bottom'], ['6H', 0, 'right'], ['9H', 1, 'top'], ['AC', 2, 'left']];
const POS = { bottom: [0, 26], right: [34, 0], top: [0, -26], left: [-34, 0] };

export function TablePreview({ youName }) {
  const root = useRef(null);
  const seats = [{ name: 'Sana', pos: 'right' }, { name: 'Bilal', pos: 'top' }, { name: 'Hira', pos: 'left' }, { name: youName || 'You', pos: 'bottom', me: true }];
  useEffect(() => {
    const el = root.current;
    const pile = el.querySelector('.tp-pile'), stamp = el.querySelector('.tp-stamp'), felt = el.querySelector('.tp-felt');
    const seatEls = Array.from(el.querySelectorAll('.tp-seat'));
    const place = (id, i, p, cls) => { const c = renderCard(id, { size: 56 }); const [x, y] = POS[p]; c.style.setProperty('--x', x + 'px'); c.style.setProperty('--y', y + 'px'); c.style.setProperty('--r', ((i * 37) % 17 - 8) + 'deg'); c.classList.add(cls); pile.appendChild(c); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      SEQ.forEach(([id, , p], i) => place(id, i, p, 'tp-static'));
      stamp.classList.add('show');
      return () => pile.replaceChildren();
    }
    let step = 0, t;
    function tick() {
      if (document.hidden) { t = setTimeout(tick, 1000); return; }
      if (step < SEQ.length) {
        const [id, seat, p] = SEQ[step];
        place(id, step, p, step === 3 ? 'tp-slam' : 'tp-in');
        if (step === 3) { felt.classList.remove('jolt'); void felt.offsetWidth; felt.classList.add('jolt'); stamp.classList.add('show'); }
        seatEls[seat].querySelector('.tp-count').textContent = '12';
        step++;
        t = setTimeout(tick, step === 4 ? 1700 : 850);
      } else {
        stamp.classList.remove('show');
        pile.classList.add('tp-collect');
        seatEls[1].querySelector('.tp-count').textContent = '16';
        seatEls[1].classList.add('got');
        t = setTimeout(() => {
          pile.classList.remove('tp-collect'); pile.replaceChildren(); seatEls[1].classList.remove('got');
          seatEls.forEach(s => { s.querySelector('.tp-count').textContent = '13'; });
          step = 0; t = setTimeout(tick, 700);
        }, 1100);
      }
    }
    t = setTimeout(tick, 600);
    return () => { clearTimeout(t); pile.replaceChildren(); };
  }, []);
  return (
    <div ref={root} className="table-preview" aria-label="Animated preview of a Thulla baari" role="img">
      <div className="tp-felt"><div className="felt-inlay" /><div className="tp-pile" /><span className="tp-stamp display">Thulla!</span></div>
      {seats.map(s => <div key={s.pos} className={'tp-seat ' + s.pos}><Avatar person={{ name: s.name }} size="sm" /><span>{s.me ? 'You' : s.name}</span><span className="tp-count num">13</span></div>)}
    </div>
  );
}
