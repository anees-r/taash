'use client';
/* Match results: podium, loser card, summary, rating change, host actions, chat. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { Modal, Confirm } from './Modal';
import { Chat } from './Chat';
import { AddFriendButton } from './AddFriendButton';
import { EditSettings } from './LobbyView';
import { PlayingCard } from '@/components/game/PlayingCard';
import { gameMeta } from '@/games/catalog';
import { call } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';
import { playFile } from '@/lib/client/sound';
import { ordinal, plural, firstName } from '@/lib/client/format';

const loserLines = [
  'is left holding the cards. Chai is on them.',
  'kept the cards warm for everyone.',
  'is holding the cards — shuffle duty next game.',
  'held on the longest. There is always a next game.',
];

export function ResultsView({ table, result, you, viewerKind, chat, onBackToLobby }) {
  const meta = gameMeta(table.gameId);
  const isHost = table.hostId === you;
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pageRef = useRef(null);
  const ordered = result.players.slice().sort((a, b) => a.place - b.place || a.seat - b.seat);
  const quitter = result.forfeit ? result.players.find(p => p.forfeit) : null;
  const finishers = ordered.filter(p => !p.isLoser && !p.forfeit);
  const loser = ordered.find(p => p.isLoser) || null;
  const mine = result.players.find(p => p.id === you);
  const myRating = result.ratings ? result.ratings[you] : null;
  const myCoins = result.coins ? result.coins[you] : null;
  const s = result.summary;
  const nameIn = p => (p.id === you ? 'You' : p.name);
  const bySeat = seat => result.players.find(p => p.seat === seat);
  const ranked = result.ranked !== false;
  const deltaOf = p => (result.ratings && result.ratings[p.id] ? result.ratings[p.id].delta : null);
  const person = id => [...table.players, ...(table.spectators || [])].find(x => x.id === id);
  const shame = p => (p.forfeit ? <span className="chip chip-shame" title="Forfeited: ranked last, lost rating">🏳️ Forfeited</span> : null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !pageRef.current) return;
    const layer = document.createElement('div');
    layer.className = 'confetti'; layer.setAttribute('aria-hidden', 'true');
    const colors = ['var(--gold-300)', 'var(--gold-400)', 'var(--lavender-300)', 'var(--ivory-50)', 'var(--card-red)'];
    for (let i = 0; i < 46; i++) {
      const sp = document.createElement('span');
      Object.assign(sp.style, { left: (Math.random() * 100) + '%', background: colors[i % colors.length], animationDelay: (Math.random() * .6) + 's', animationDuration: (2.2 + Math.random() * 1.6) + 's' });
      sp.style.setProperty('--rx', (Math.random() * 720 - 360) + 'deg'); sp.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      layer.appendChild(sp);
    }
    pageRef.current.appendChild(layer);
    const t = setTimeout(() => layer.remove(), 4500);
    return () => { clearTimeout(t); layer.remove(); };
  }, [result.matchId]);

  // Victory for everyone who got rid of their cards, defeat for whoever was left holding them
  // (or forfeited). Players only, once per game: a reload of the results stays quiet.
  useEffect(() => {
    if (!mine) return;
    const key = 'taash:end-sound:' + result.matchId;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
    playFile('/sounds/' + (mine.isLoser || mine.forfeit ? 'defeat' : 'victory') + '.mp3');
  }, [result.matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function playAgain() {
    setBusy(true);
    let extra = {};
    try { const k = Number(sessionStorage.getItem('taash:e2eCards')); if (k) extra = { testCardsEach: k }; } catch { /* storage blocked */ }
    const r = await call('table:start', { code: table.code, ...extra });
    setBusy(false);
    if (r.error) toast(r.error, { icon: 'i-info' });
  }

  const winner = finishers[0];
  const sharedWin = !!quitter && finishers.filter(p => p.place === 1).length > 1;
  return (
    <main ref={pageRef} className="page results-page screen-enter">
      <div className="results-head">
        <p className="eyebrow">{meta.name} · table {table.code} · game {result.gameNo}</p>
        <h1 className="page-title">{quitter ? (quitter.id === you ? 'You forfeited the game' : firstName(quitter.name) + ' forfeited. Everyone else wins!') : winner ? (winner.id === you ? 'You finished first!' : firstName(winner.name) + ' finished first') : 'Game over'}</h1>
      </div>
      <div className="results-grid">
        <div className="results-main">
          <ol className="podium" aria-label="Top finishers">{finishers.slice(0, sharedWin ? 6 : 3).map(p => (
            <li key={p.id} className={'pod p' + Math.min(p.place, 3)}>
              <div className="pod-medal display">{ordinal(p.place)}</div>
              <Avatar person={p} size={p.place === 1 ? 'xl' : 'lg'} />
              <b>{nameIn(p)}</b>
              <span className="faint num">{plural(p.stats.thullasGiven || 0, 'Thulla')} given</span>
              <div className="pod-step" aria-hidden="true" />
            </li>
          ))}</ol>
          {!sharedWin && finishers.length > 3 ? <ol className="rest-list" start={4}>{finishers.slice(3).map(p => <li key={p.id}><span className="num rank">{ordinal(p.place)}</span><Avatar person={p} size="sm" /><span>{nameIn(p)}</span></li>)}</ol> : null}
          {quitter ? (
            <section className="loser-card shame-card">
              <div className="shame-flag" aria-hidden="true">🏳️</div>
              <div>
                <span className="eyebrow">Forfeited</span>
                <p className="lc-line"><b>{nameIn(quitter)}</b> {quitter.id === you ? 'gave up the game. Everyone else shares the win.' : 'waved the white flag. Everyone else shares the win.'}</p>
                <span className="faint num">Walked away with {plural(quitter.stats.cardsLeft || 0, 'card')} still in hand</span>
              </div>
            </section>
          ) : loser ? (
            <section className="loser-card">
              <div className="lc-cards" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} style={{ '--i': i }}><PlayingCard card="back" size={54} /></span>)}</div>
              <div>
                <span className="eyebrow">{ordinal(loser.place)} · last with cards</span>
                <p className="lc-line"><b>{nameIn(loser)}</b> {loser.id === you ? 'are left holding the cards. Chai is on you.' : loserLines[(s.baaris + s.thullas) % loserLines.length]}</p>
                <span className="faint num">Finished the game with {plural(loser.stats.cardsLeft || 0, 'card')} in hand</span>
              </div>
            </section>
          ) : <section className="loser-card"><p>Everyone emptied their hand together — nobody is left holding the cards.</p></section>}
          {!ranked ? <div className="rating-change"><Icon id="i-info" /><span className="faint">Unranked game: ratings and coins don’t change.</span></div>
          : mine && viewerKind === 'user' ? (
            <div className="rating-change"><Icon id="i-trophy" />
              {myRating ? <span>Thulla rating <b className="num">{myRating.after}</b> <span className={'delta num ' + (myRating.delta >= 0 ? 'up' : 'down')}>{(myRating.delta >= 0 ? '+' : '') + myRating.delta}</span></span> : <span className="faint">Updating your rating…</span>}
              {myCoins ? <span className="coin-gain num"><span className="coin" aria-hidden="true" />+{myCoins} coins</span> : null}
            </div>
          ) : mine ? <div className="rating-change"><Icon id="i-info" /><span className="faint">Guests aren’t rated and don’t earn coins. Create an account to keep both.</span></div> : null}
          <section className="panel panel-pad"><h2 className="section-title">How the game went</h2>
            <dl className="summary-grid">
              <div><dt>Baaris played</dt><dd className="num">{s.baaris}</dd></div>
              <div><dt>Thullas given</dt><dd className="num">{s.thullas}</dd></div>
              <div><dt>Biggest pile collected</dt><dd className="num">{s.biggestPile ? s.biggestPile + ' cards' : '—'}</dd>{s.biggestPileBy != null && bySeat(s.biggestPileBy) ? <span className="faint">by {firstName(nameIn(bySeat(s.biggestPileBy)))}</span> : null}</div>
              <div><dt>Hand requests</dt><dd className="num">{s.requests ? s.requestsAccepted + ' of ' + s.requests + ' given' : 'None'}</dd></div>
              {s.mostThullas && bySeat(s.mostThullas.seat) ? <div><dt>Most Thullas</dt><dd>{firstName(nameIn(bySeat(s.mostThullas.seat)))}</dd><span className="faint num">{plural(s.mostThullas.count, 'time')}</span></div> : null}
              <div><dt>Cleared for good</dt><dd className="num">{Object.values(s.cleared).reduce((a, b) => a + b, 0)} / 52</dd></div>
            </dl>
          </section>
          <section className="result-actions">
            <p className="muted">{isHost ? 'You’re the host. Start a rematch, change the table settings, or take everyone back to the lobby.' : 'Waiting for the host to start the next game or go back to the lobby.'}</p>
            <div className="row-gap wrap">
              <button type="button" className="btn btn-primary btn-lg" disabled={!isHost || busy || table.players.length < 2} onClick={playAgain}>Play again</button>
              {isHost ? <button type="button" className="btn btn-lg" onClick={() => setEditing(true)}><Icon id="i-sliders" />Table settings</button> : null}
              <button type="button" className="btn btn-lg" disabled={!isHost} onClick={() => setManaging(true)}><Icon id="i-users" />Manage players</button>
              <button type="button" className="btn btn-lg btn-ghost" onClick={onBackToLobby}>{isHost ? 'Everyone back to the lobby' : 'View the lobby'}</button>
            </div>
          </section>
        </div>
        <aside className="results-side">
          <section className="panel panel-pad"><h2 className="section-title">Finishing order</h2>
            <ol className="order-list">{ordered.map(p => {
              const who = person(p.id);
              return (
                <li key={p.id} className={p.isLoser || p.forfeit ? 'lost' : undefined}>
                  <span className="num rank">{ordinal(p.place)}</span><Avatar person={p} size="sm" /><span>{nameIn(p)}</span>
                  {p.isLoser ? <span className="chip">Holding the cards</span> : null}{shame(p)}
                  {deltaOf(p) != null ? <span className={'delta num ' + (deltaOf(p) >= 0 ? 'up' : 'down')}>{(deltaOf(p) >= 0 ? '+' : '') + deltaOf(p)}</span> : null}
                  {p.id !== you && who?.handle ? <AddFriendButton handle={who.handle} userId={who.userId} compact className="icon-btn" /> : null}
                </li>
              );
            })}</ol>
          </section>
          <section className="panel lobby-chat"><Chat code={table.code} messages={chat} you={you} idSuffix="results" /></section>
        </aside>
      </div>
      {managing ? <ManagePlayers table={table} you={you} onClose={() => setManaging(false)} onRemoved={onBackToLobby} /> : null}
      {editing ? <EditSettings table={table} onClose={() => setEditing(false)} /> : null}
    </main>
  );
}

function ManagePlayers({ table, you, onClose, onRemoved }) {
  const [confirm, setConfirm] = useState(null);
  return (
    <>
      <Modal open onClose={onClose} title="Manage players" subtitle="Remove a player to free their seat. You’ll go back to the lobby to fill it." footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}>
        <ul className="manage-list">{table.players.map(p => (
          <li key={p.id}><Avatar person={p} /><div><b>{p.name}{p.id === you ? ' (you)' : ''}</b><span className="faint">{p.id === table.hostId ? 'Host' : p.guest ? 'Guest' : 'Member'}</span></div>
            {p.id === table.hostId ? <span className="chip chip-gold"><Icon id="i-crown" />Host</span> : <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirm(p)}>Remove</button>}</li>
        ))}</ul>
      </Modal>
      <Confirm open={!!confirm} title={confirm ? 'Remove ' + confirm.name + ' from the table?' : ''} message="Their seat opens up for someone new. Everyone else stays at the table." confirmLabel={confirm ? 'Remove ' + firstName(confirm.name) : ''} danger
        onCancel={() => setConfirm(null)} onConfirm={async () => {
          const p = confirm; setConfirm(null);
          const r = await call('table:kick', { code: table.code, playerId: p.id });
          if (r.error) { toast(r.error, { icon: 'i-info' }); return; }
          toast(p.name + ' was removed. One seat is open.'); onClose(); onRemoved();
        }} />
    </>
  );
}
