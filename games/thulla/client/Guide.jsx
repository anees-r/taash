'use client';
/* How to play Thulla — the prototype's illustrated guide, as React. Rendered
   as a full page from the game landing and inside a drawer at the table. */
import { useEffect, useRef, useState } from 'react';
import { PlayingCard } from '@/components/game/PlayingCard';
import { Icon } from '@/components/platform/Icon';
import { Avatar } from '@/components/platform/Avatar';

const P = { A: 'Asad', B: 'Benish', C: 'Chaand', D: 'Dua' };
const Card = ({ id, size = 58, ...o }) => <PlayingCard card={id} size={size} {...o} />;
const SuitIcon = ({ s }) => <svg className="i" aria-hidden="true"><use href={'#suit-' + s} /></svg>;

/** A baari illustration: [{who, card, tag?, tagClass?, dim?, cls?}] */
function Sequence({ plays, caption }) {
  return (
    <figure className="seq">
      <div className="seq-row">
        {plays.map((p, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i ? <span className="seq-arrow" aria-hidden="true">→</span> : null}
            <div className={'seq-play' + (p.dim ? ' dim' : '')}>
              <Card id={p.card} tag={p.tag} tagClass={p.tagClass} className={p.cls || ''} />
              <span className="seq-who">{p.who}</span>
            </div>
          </span>
        ))}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export const sections = [
  { id: 'objective', title: 'Objective', body: () => <>
    <p className="lead">Get rid of every card in your hand. Players leave the game one by one as they empty their hands. The last player still holding cards loses the game.</p>
    <div className="callout"><Icon id="i-flag" /><p>There are no points to count. Your finishing position is your result: 1st out, 2nd out, and so on.</p></div>
  </> },
  { id: 'deck', title: 'Deck and card ranking', body: () => <>
    <p>Thulla uses one standard 52-card deck with both Jokers removed. Players call the suits <b>shapes</b>: Clubs, Diamonds, Spades and Hearts.</p>
    <div className="rank-strip">{['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S'].map(id => <Card key={id} id={id} size={40} mini />)}</div>
    <p className="muted">Ace is highest, then King, Queen, Jack, 10 down to 2. There is no trump shape — a card only beats cards of its own shape.</p>
  </> },
  { id: 'dealing', title: 'Dealing and the first baari', body: () => <>
    <p>Cards are dealt one at a time, anti-clockwise, until the deck runs out. With four players everyone gets 13 cards; with other counts some players hold one more card than others. Sort your hand however you like.</p>
    <p>A round of play is called a <b>baari</b>. The player holding the <b>Ace of Spades</b> opens the first baari by playing it. Everyone else must play a Spade if they have one.</p>
    <Sequence plays={[{ who: P.A, card: 'AS', tag: 'Opens' }, { who: P.B, card: 'KS' }, { who: P.C, card: '7S' }, { who: P.D, card: 'QD', tag: 'No spades', tagClass: 'muted' }]} caption="Dua has no Spades and plays the Q♦. In the first baari this is NOT a Thulla." />
    <ul className="rule-list">
      <li><b>The first baari always clears.</b> Nobody collects it — all of its cards leave the game for good.</li>
      <li><b>No Thulla in the first baari.</b> Playing another shape here is simply a discard.</li>
      <li><b>No card requests</b> are allowed during the first baari.</li>
      <li>The highest Spade played starts the second baari. That is the A♠ player.</li>
    </ul>
  </> },
  { id: 'normal', title: 'A normal baari', body: () => <>
    <p>From the second baari on, the starting player leads any card. Its shape becomes the <b>required shape</b> for that baari. (Before leading, they may instead request the next player&apos;s hand — see Card requests.)</p>
    <Sequence plays={[{ who: P.C, card: '5D', tag: 'Leads' }, { who: P.D, card: '9D' }, { who: P.A, card: 'JD', tag: 'Highest', cls: 'is-winning' }, { who: P.B, card: '3D' }]} caption="Everyone followed Diamonds, so the baari clears. Asad's J♦ is highest — Asad starts the next baari." />
    <p>When everyone follows the shape, the whole pile is <b>cleared</b> from the game. Nobody picks it up. The highest card of the shape starts the next baari.</p>
  </> },
  { id: 'following', title: 'Following suit', body: () => <>
    <p>If you hold the required shape, you <b>must</b> play it. You choose which card of that shape. Holding a Heart and playing a Club to a Heart lead is not allowed — the table will not let you.</p>
    <div className="callout"><Icon id="i-info" /><p>On the table, cards you cannot play are dimmed with a small lock. Cards you can play have a gold underline.</p></div>
  </> },
  { id: 'thulla', title: 'Giving Thulla', body: () => <>
    <p>If you do <b>not</b> hold the required shape, you may play any card. That is called <b>giving Thulla</b>. Traditionally the card is raised high and slapped down hard on the pile.</p>
    <Sequence plays={[{ who: P.A, card: '4H' }, { who: P.B, card: '6H' }, { who: P.C, card: '9H', tag: 'Highest ♥', cls: 'is-winning' }, { who: P.D, card: 'AC', tag: 'Thulla!', tagClass: 'ember', cls: 'is-thulla' }]} caption="Dua has no Hearts and gives Thulla with the A♣." />
    <ul className="rule-list">
      <li>The first Thulla <b>ends the baari immediately</b>. Anyone who has not played yet keeps their cards, hidden.</li>
      <li>There is never a second Thulla in the same baari.</li>
      <li>Off-shape cards in the first baari are never Thulla.</li>
    </ul>
  </> },
  { id: 'collecting', title: 'Collecting a Thulla pile', body: () => <>
    <p>The player who played the <b>highest card of the required shape</b> (before the Thulla) picks up the whole pile — <b>including the Thulla card</b>. Those cards go back into their hand.</p>
    <div className="collect-demo">
      <div className="collect-pile">{['4H', '6H', '9H', 'AC'].map((id, i) => <span key={id} style={{ '--i': i }}><Card id={id} size={46} mini /></span>)}</div>
      <span className="collect-arrow" aria-hidden="true">→</span>
      <div className="collect-to"><Avatar person={{ name: 'Chaand' }} size="lg" /><b>Chaand collects 4 cards</b><span className="faint">and starts the next baari</span></div>
    </div>
    <p className="muted">Collected cards are not &ldquo;cleared&rdquo; — they are back in play.</p>
  </> },
  { id: 'finishing', title: 'Finishing positions', body: () => <>
    <p>When your last card hits the table, you are not out yet. The baari has to resolve first:</p>
    <ul className="rule-list">
      <li><b>If the baari clears normally</b>, you finish in the next open position (1st, 2nd, 3rd…).</li>
      <li><b>If the baari ends in Thulla and your card was the highest</b>, you collect the pile and stay in the game.</li>
      <li>Finished players leave play. The game ends when only one player still holds cards — that player loses.</li>
    </ul>
    <p className="muted">If the player who should start the next baari has just finished, the next-highest card of that baari starts instead.</p>
  </> },
  { id: 'requests', title: 'Card requests', body: () => <>
    <p>From the second baari on, when you start a baari — <b>before you lead a card</b> — you may ask the <b>next active player</b> (anti-clockwise) for their entire hand. Finished players are skipped.</p>
    <div className="req-demo">
      <div className="req-step"><span className="req-n">1</span><p><b>Request.</b> Asad asks Benish for all her cards.</p></div>
      <div className="req-step"><span className="req-n">2a</span><p><b>Benish gives.</b> All her cards go to Asad — and everyone at the table sees exactly which cards moved. Benish immediately finishes in the next open position.</p></div>
      <div className="req-step"><span className="req-n">2b</span><p><b>Benish keeps.</b> Nothing changes; Asad leads a card as normal.</p></div>
    </div>
    <p className="muted">Requests are never allowed in the first baari, and you can ask once per turn. You do not need a Cross to make a request. If the asked player does not answer in time, they keep their cards.</p>
  </> },
  { id: 'cross', title: 'Cross', body: () => <>
    <p>A <b>Cross</b> is when two players each hold shapes the other does not. Say Asad holds only Hearts and Spades, and Benish (next to him) holds only Diamonds and Clubs.</p>
    <div className="cross-demo">
      <div className="cross-hand"><b>{P.A}</b><div className="card-row">{['KH', '7H', 'QS', '5S'].map(id => <Card key={id} id={id} size={42} mini />)}</div></div>
      <div className="cross-x" aria-hidden="true">×</div>
      <div className="cross-hand"><b>{P.B}</b><div className="card-row">{['JD', '4D', 'AC', '8C'].map(id => <Card key={id} id={id} size={42} mini />)}</div></div>
    </div>
    <p>When Asad leads Hearts, Benish has none and must give Thulla. Lead Spades next time — Thulla again. A Cross lets one player force repeated Thullas onto the other.</p>
    <div className="callout"><Icon id="i-info" /><p>A Cross is a situation to spot, not an action to take. Nothing in the game requires a Cross.</p></div>
  </> },
  { id: 'strategy', title: 'Cleared cards and strategy', body: () => <>
    <p>Hosts can turn on <b>cleared card counts</b>. The table then shows how many of each shape have left the game for good, out of 13.</p>
    <div className="cleared-demo">{[['C', 7], ['D', 4], ['S', 9], ['H', 6]].map(([s, n]) => (
      <div key={s} className={'cd' + (s === 'D' || s === 'H' ? ' red' : '')}><SuitIcon s={s} /><b className="num">{n}/13</b><span className="bar"><span style={{ width: (n / 13 * 100) + '%' }} /></span></div>
    ))}</div>
    <ul className="rule-list">
      <li>Counted: every card from the first baari, and every baari that clears normally.</li>
      <li>Not counted: cards in hands, cards on the table in an unfinished baari, and cards collected after a Thulla.</li>
      <li>Use it to judge which shapes are running out — a shape that is nearly gone is where Thullas are coming.</li>
    </ul>
  </> },
  { id: 'timer', title: 'Turn timer', body: () => <>
    <p>Every turn has a time limit set by the host. When it runs out, the server plays <b>the highest card you are allowed to play</b> for you — if you are out of the shape, that is a Thulla with your highest card.</p>
    <ul className="rule-list">
      <li>An unanswered hand request counts as <b>Keep</b>: no cards move.</li>
      <li>Miss three turns in a row and you are marked <b>away</b>. Your turns are then played straight away until you press <b>I’m back</b> or play a card.</li>
    </ul>
  </> },
];

export function Guide({ compact }) {
  const contentRef = useRef(null);
  const [active, setActive] = useState(sections[0].id);
  useEffect(() => {
    if (!('IntersectionObserver' in window) || !contentRef.current) return;
    const io = new IntersectionObserver(entries => {
      entries.filter(e => e.isIntersecting).forEach(e => setActive(e.target.id.slice(2)));
    }, { rootMargin: '-20% 0px -70% 0px' });
    contentRef.current.querySelectorAll('.guide-sec').forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);
  const go = (e, id) => {
    e.preventDefault();
    const t = contentRef.current.querySelector('#g-' + id);
    t.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };
  return (
    <div className={'guide' + (compact ? ' compact' : '')}>
      <nav className="guide-nav" aria-label="Rules sections">
        <ol>{sections.map((s, i) => <li key={s.id}><a href={'#g-' + s.id} className={active === s.id ? 'active' : undefined} onClick={e => go(e, s.id)}><span className="gnum">{i + 1}</span>{s.title}</a></li>)}</ol>
      </nav>
      <div className="guide-content" ref={contentRef}>
        {sections.map((s, i) => (
          <section key={s.id} className="guide-sec" id={'g-' + s.id} aria-labelledby={'g-' + s.id + '-t'}>
            <h3 id={'g-' + s.id + '-t'}><span className="gnum">{i + 1}</span>{s.title}</h3>
            {s.body()}
          </section>
        ))}
      </div>
    </div>
  );
}
