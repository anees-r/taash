/**
 * The prototype's playing card as a React component. Everything inside is
 * sized in container-query units (see styles/cards.css), so one component
 * scales from a 34px mini card to a 120px hero card. The corner index has its
 * own gutter, so ranks (including "10") never overlap pips at any size.
 */
import { memo } from 'react';
import { PIPS, parseCardId, rankLabel, cardName, isRed } from './card-model.js';

function Suit({ suit, className, style }) {
  return <svg className={'i' + (className ? ' ' + className : '')} aria-hidden="true" style={style}><use href={'#suit-' + suit} /></svg>;
}

function Index({ suit, label, pos }) {
  return (
    <div className={'idx ' + pos}>
      <span className={'r' + (label === '10' ? ' ten' : '')}>{label}</span>
      <Suit suit={suit} />
    </div>
  );
}

/**
 * @param {{card: string|'back', size?: number, mini?: boolean, tag?: string, tagClass?: string, className?: string, as?: 'div'|'button', [k:string]: any}} props
 */
function PlayingCardImpl({ card, size = 84, mini, tag, tagClass, className, as = 'div', ...rest }) {
  const style = { '--cw': size + 'px' };
  if (card === 'back' || card == null) {
    return (
      <div className={'pcard back-only' + (className ? ' ' + className : '')} style={style} role="img" aria-label="Face-down card" {...rest}>
        <div className="pcard-back"><svg className="i mark" aria-hidden="true"><use href="#taash-mark" /></svg></div>
      </div>
    );
  }
  const c = parseCardId(card);
  const label = rankLabel(c.rank);
  const Tag = as;
  const cls = 'pcard' + (isRed(card) ? ' red' : '') + (mini ? ' mini' : '') + (card === 'AS' ? ' ace-spade' : '') + (className ? ' ' + className : '');
  let center;
  if (c.rank <= 10) {
    center = (
      <div className="pips">
        {PIPS[c.rank].map(([x, y], i) => <Suit key={i} suit={c.suit} className={'pip' + (y > 50 ? ' flip' : '')} style={{ '--x': x + '%', '--y': y + '%' }} />)}
      </div>
    );
  } else if (c.rank === 14) {
    center = <div className="ace"><Suit suit={c.suit} /></div>;
  } else {
    const half = flip => (
      <div className={'half' + (flip ? ' flip' : '')}>
        <svg className="i crown" aria-hidden="true"><use href="#i-crown" /></svg>
        <span className="letter">{label}</span>
        <Suit suit={c.suit} />
      </div>
    );
    center = <div className="court">{half(false)}{half(true)}</div>;
  }
  return (
    <Tag className={cls} style={style} data-card={card} role={as === 'button' ? undefined : 'img'} aria-label={cardName(card)} type={as === 'button' ? 'button' : undefined} {...rest}>
      <div className="pcard-face">
        <Index suit={c.suit} label={label} pos="tl" />
        <Index suit={c.suit} label={label} pos="br" />
        {center}
        <Suit suit={c.suit} className="big" />
        <span className="lock" aria-hidden="true"><svg className="i" aria-hidden="true"><use href="#i-x" /></svg></span>
      </div>
      {tag ? <span className={'tag' + (tagClass ? ' ' + tagClass : '')}>{tag}</span> : null}
    </Tag>
  );
}

export const PlayingCard = memo(PlayingCardImpl);
export { Suit };
