/** Imperative card renderer for the table's animation layer. Same markup as <PlayingCard>. */
import { h, icon } from './dom.js';
import { PIPS, parseCardId, rankLabel, cardName, isRed } from '../../components/game/card-model.js';

export const suitSvg = (suit, cls) => icon('suit-' + suit, cls);

/** render(card | 'back', { size, mini, tag, tagClass, className, button }) */
export function renderCard(card, opts = {}) {
  const size = opts.size || 84;
  if (card === 'back' || card == null) {
    return h('div.pcard.back-only' + (opts.className ? '.' + opts.className.split(' ').join('.') : ''), { vars: { '--cw': size + 'px' }, 'aria-label': 'Face-down card', role: 'img' },
      h('div.pcard-back', icon('taash-mark', 'mark')));
  }
  const c = parseCardId(card);
  const r = rankLabel(c.rank);
  const el = h((opts.button ? 'button' : 'div') + '.pcard' + (isRed(card) ? '.red' : '') + (opts.mini ? '.mini' : '') + (card === 'AS' ? '.ace-spade' : ''), {
    type: opts.button ? 'button' : null, vars: { '--cw': size + 'px' }, 'data-card': card,
    role: opts.button ? null : 'img', 'aria-label': cardName(card),
  });
  if (opts.className) opts.className.split(' ').forEach(x => x && el.classList.add(x));
  const idx = cls => h('div.idx.' + cls, h('span.r' + (r === '10' ? '.ten' : ''), r), suitSvg(c.suit));
  const face = h('div.pcard-face', idx('tl'), idx('br'));
  if (c.rank <= 10) {
    const pips = h('div.pips');
    PIPS[c.rank].forEach(([x, y]) => {
      const p = suitSvg(c.suit, 'pip' + (y > 50 ? ' flip' : ''));
      p.style.setProperty('--x', x + '%'); p.style.setProperty('--y', y + '%');
      pips.appendChild(p);
    });
    face.appendChild(pips);
  } else if (c.rank === 14) {
    face.appendChild(h('div.ace', suitSvg(c.suit)));
  } else {
    const half = flip => h('div.half' + (flip ? '.flip' : ''), icon('i-crown', 'crown'), h('span.letter', r), suitSvg(c.suit));
    face.appendChild(h('div.court', half(false), half(true)));
  }
  face.appendChild(suitSvg(c.suit, 'big'));
  face.appendChild(h('span.lock', { 'aria-hidden': 'true' }, icon('i-x')));
  el.appendChild(face);
  if (opts.tag) el.appendChild(h('span.tag' + (opts.tagClass ? '.' + opts.tagClass : ''), opts.tag));
  return el;
}
