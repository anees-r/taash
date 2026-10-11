'use client';
/**
 * A table's live page: lobby → game → results, all over one Socket.IO
 * connection. Every state change comes from the server; this component only
 * routes events to the right view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import { TopBar, BottomNav } from './TopBar';
import { JoinForm } from './JoinForm';
import { LobbyView } from './LobbyView';
import { ResultsView } from './ResultsView';
import { useViewer } from './Providers';
import { clientGames } from '@/games/client-registry';
import { getSocket, call, actionId } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';
import { Icon } from './Icon';

/** The lobby part of a snapshot or table:state message. */
const lobbyOf = d => ({
  code: d.code, gameId: d.gameId, hostId: d.hostId, status: d.status, settings: d.settings, options: d.options,
  players: d.players, spectators: d.spectators || [], cosmetics: d.cosmetics || null, gamesPlayed: d.gamesPlayed,
});

export function TableClient({ code, rating, coins, appUrl }) {
  const viewer = useViewer();
  const router = useRouter();
  const [phase, setPhase] = useState(viewer.kind === 'anon' ? 'join' : 'connecting');   // connecting | join | ready | error
  const [error, setError] = useState(null);         // {message, code?, canWatch?, table?}
  const [table, setTable] = useState(null);       // lobby view
  const [you, setYou] = useState(null);
  const [chat, setChat] = useState([]);
  const [game, setGame] = useState(null);         // {snapshot game part, seq, now}
  const [result, setResult] = useState(null);
  const [view, setView] = useState('lobby');      // lobby | game | results
  const controllerRef = useRef(null);
  // Every game event since the last snapshot. A freshly mounted view replays them all and skips
  // what it has seen (by seq), so a remount (React Strict Mode in dev) still animates the deal.
  const buffer = useRef([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const applySnapshot = useCallback(snap => {
    setTable(lobbyOf(snap));
    setYou(snap.you);
    setChat(snap.chat);
    setResult(snap.result);
    buffer.current = [];
    if (snap.game && snap.status === 'playing') {
      const g = { ...snap.game, seq: snap.seq, now: snap.now };
      if (controllerRef.current && controllerRef.current.matchId === g.matchId) controllerRef.current.resync({ view: g.view, hand: g.hand, seq: g.seq, now: g.now });
      else setGame(g);
      setView('game');
    } else {
      setGame(null);
      setView(snap.status === 'finished' && snap.result ? 'results' : 'lobby');
    }
    setPhase('ready');
  }, []);

  const join = useCallback(async (as) => {
    const res = await call('table:join', { code, as });
    if (res.error) {
      if (res.code === 'timeout') { setTimeout(() => join(as), 1500); return; }
      setError({ message: res.error, code: res.code, canWatch: res.canWatch, table: res.table }); setPhase('error'); return;
    }
    if (as === 'spectator') toast('You’re watching table ' + code + '. You’ll see every card played, never anyone’s hand.', { icon: 'i-info', duration: 4000 });
    applySnapshot(res.snapshot);
  }, [code, applySnapshot]);

  const resync = useCallback(async () => {
    const res = await call('table:sync', { code });
    if (res.error) { if (res.code === 'not-found') { setError({ message: 'This table has closed.' }); setPhase('error'); } return; }
    applySnapshot(res.snapshot);
  }, [code, applySnapshot]);

  useEffect(() => {
    if (viewer.kind === 'anon') return;
    const s = getSocket();
    const mine = d => d && d.code === code;
    const toController = item => {
      buffer.current.push(item);
      if (buffer.current.length > 400) buffer.current.shift();   // a view that misses one resyncs
      if (controllerRef.current) item.kind === 'events' ? controllerRef.current.pushEvents(item.data) : controllerRef.current.pushHand(item.data);
    };
    const handlers = {
      'table:state': d => { if (!mine(d)) return; setTable(t => (t ? lobbyOf(d) : t)); },
      // The host took everyone back to the lobby after a game.
      'table:lobby': d => { if (mine(d) && viewRef.current === 'results') { setView('lobby'); toast('The host took everyone back to the lobby.', { icon: 'i-users' }); } },
      'table:moved': d => { if (mine(d)) toast(d.to === 'spectator' ? 'The host moved you to the spectators. You’ll watch the next game.' : 'The host gave you a seat. Get ready!', { icon: 'i-users', duration: 4000 }); },
      'table:emote': d => { if (mine(d)) controllerRef.current?.emote?.(d); },
      'table:forfeit': d => { if (mine(d)) controllerRef.current?.forfeit?.(d); },
      'chat:msg': d => { if (!mine(d)) return; setChat(c => (c.some(m => m.id === d.msg.id) ? c : [...c.slice(-149), d.msg])); },
      'game:snapshot': d => { if (!mine(d)) return; const sn = d.snapshot; buffer.current = []; controllerRef.current = null; setResult(null); setGame({ ...sn.game, seq: sn.seq, now: sn.now }); setView('game'); },
      'game:events': d => { if (mine(d)) toController({ kind: 'events', data: d }); },
      'game:hand': d => { if (mine(d)) toController({ kind: 'hand', data: d }); },
      'game:deadline': d => { if (mine(d)) controllerRef.current?.setDeadline(d.deadline, d.now); },
      'table:result': d => { if (!mine(d)) return; setResult(d.result); if (viewRef.current !== 'game') setView('results'); },
      'table:closed': d => { if (!mine(d)) return; setError({ message: d.reason === 'restart' ? 'The server restarted, so this table closed. Open a new table to keep playing.' : 'This table has closed.' }); setPhase('error'); },
      'table:kicked': d => { if (!mine(d)) return; setError({ message: 'The host removed you from this table.' }); setPhase('error'); },
      connect: () => { if (phaseRef.current === 'ready') resync(); },
    };
    for (const [ev, fn] of Object.entries(handlers)) s.on(ev, fn);
    if (phaseRef.current === 'connecting') join();
    return () => {
      for (const [ev, fn] of Object.entries(handlers)) s.off(ev, fn);
      call('table:unwatch', { code }, 2000);
    };
  }, [viewer.kind, viewer.playerId, code, join, resync]);

  const onMounted = useCallback(c => {
    c.matchId = game?.matchId;
    for (const it of buffer.current) it.kind === 'events' ? c.pushEvents(it.data) : c.pushHand(it.data);
  }, [game?.matchId]);

  const onAction = useCallback(a => call('game:action', { code, actionId: actionId(), action: a }), [code]);
  const onLeave = useCallback(async () => { await call('table:leave', { code }); router.push('/'); }, [code, router]);
  const onGameOver = useCallback(() => { setView(v => (v === 'game' ? 'results' : v)); }, []);
  const onForfeit = useCallback(() => call('table:forfeit', { code }), [code]);
  const onEmote = useCallback(sound => call('table:emote', { code, sound }), [code]);

  if (phase === 'join') {
    return (
      <Chrome rating={rating} coins={coins}>
        <main className="page join-page screen-enter">
          <div className="page-head"><div><p className="eyebrow">Join table {code}</p><h1 className="page-title">Got a code? Take a seat.</h1></div></div>
          <div className="join-grid">
            <JoinForm initialCode={code} codeLocked onJoined={(_, snap) => { router.refresh(); applySnapshot(snap); }} />
            <aside className="join-side"><h2 className="section-title">Playing as a guest</h2><p className="muted small">Guests play the full game with just a display name. Create an account any time to keep a rating and history.</p></aside>
          </div>
        </main>
      </Chrome>
    );
  }
  if (phase === 'error') {
    return (
      <Chrome rating={rating} coins={coins}>
        <main className="page join-page screen-enter">
          <div className="page-head"><div><p className="eyebrow">Table {code}</p><h1 className="page-title">{error?.canWatch ? 'No seat right now, but you can watch.' : error?.code === 'elsewhere' ? 'You’re already at a table.' : 'This seat isn’t available.'}</h1></div></div>
          <section className="panel panel-pad" style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
            <p className="muted" role="alert">{error?.message}</p>
            <div className="row-gap wrap">
              {error?.canWatch ? <button type="button" className="btn btn-primary" onClick={() => { setPhase('connecting'); join('spectator'); }}><Icon id="i-info" />Watch instead</button> : null}
              {error?.code === 'elsewhere' && error.table ? <Link className="btn btn-primary" href={'/t/' + error.table}>Go to table {error.table}</Link> : null}
              {error?.code === 'no-guests' ? <><Link className="btn btn-primary" href={'/signin?next=' + encodeURIComponent('/t/' + code)}>Sign in</Link><Link className="btn" href={'/register?next=' + encodeURIComponent('/t/' + code)}>Create a free account</Link></> : null}
              {!error?.canWatch && error?.code !== 'elsewhere' && error?.code !== 'no-guests' ? <><Link className="btn btn-primary" href="/join">Join another table</Link><Link className="btn" href="/games/thulla">Open a new table</Link></> : <Link className="btn btn-ghost" href="/">Home</Link>}
            </div>
          </section>
        </main>
      </Chrome>
    );
  }
  if (phase !== 'ready' || !table) {
    return <Chrome rating={rating} coins={coins}><main className="page"><p className="muted" role="status">Taking your seat at {code}…</p></main></Chrome>;
  }

  const TableView = clientGames[table.gameId].TableView;
  if (view === 'game' && game) {
    return (
      <div className="app no-chrome">
        <GameHost key={game.matchId} TableView={TableView} code={code} game={game} settings={table.settings} chat={chat} you={you} design={table.cosmetics?.table?.key || null} designInfo={table.cosmetics?.table || null}
          controllerRef={controllerRef} onMounted={onMounted} onAction={onAction} onLeave={onLeave} onGameOver={onGameOver} onResync={resync} onForfeit={onForfeit} onEmote={onEmote} />
      </div>
    );
  }
  return (
    <Chrome rating={rating} coins={coins}>
      {view === 'results' && result
        ? <ResultsView table={table} result={result} you={you} viewerKind={viewer.kind} chat={chat}
            onBackToLobby={async () => {
              // The host takes everyone; anyone else just looks at the lobby.
              if (table.hostId === you) { const r = await call('table:lobby', { code }); if (r.error) toast(r.error, { icon: 'i-info' }); }
              setView('lobby');
            }} />
        : <LobbyView table={table} you={you} viewerKind={viewer.kind} chat={chat} appUrl={appUrl} onLeft={() => { toast('You left table ' + code); router.push('/'); }} onShowResults={() => setView('results')} />}
    </Chrome>
  );
}

/** Mount the game view, then replay the events since its snapshot. */
function GameHost({ TableView, onMounted, controllerRef, ...props }) {
  const local = useRef({ current: null });
  const proxy = useRef(null);
  if (!proxy.current) {
    proxy.current = {
      get current() { return local.current.current; },
      set current(c) { local.current.current = c; controllerRef.current = c; if (c) onMounted(c); },
    };
  }
  return <TableView {...props} controllerRef={proxy.current} />;
}

function Chrome({ rating, coins, children }) {
  const viewer = useViewer();
  return (
    <div className="app has-bottom-nav">
      <TopBar viewer={viewer} rating={rating} coins={coins} />
      {children}
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
