'use client';
/* Public tables with a free seat, refreshed every few seconds while the page is visible. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { CreateTableButton } from './CreateTable';
import { plural, firstName } from '@/lib/client/format';
import { formatDuration } from '@/games/thulla/settings';

const EVERY_MS = 5000;

export function OpenRooms({ initial = [], compact }) {
  const [rooms, setRooms] = useState(initial);
  useEffect(() => {
    let alive = true, t = null;
    const load = async () => {
      if (document.hidden) { t = setTimeout(load, EVERY_MS); return; }
      try { const r = await fetch('/api/rooms', { cache: 'no-store' }); const j = await r.json(); if (alive) setRooms(j.rooms || []); } catch { /* keep the last list */ }
      if (alive) t = setTimeout(load, EVERY_MS);
    };
    load();
    const onVis = () => { if (!document.hidden) { clearTimeout(t); load(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return (
    <section className={'panel panel-pad open-rooms' + (compact ? ' compact' : '')} aria-labelledby="open-rooms-title">
      <div className="section-head row">
        <div><h2 className="section-title" id="open-rooms-title">Open rooms</h2><p className="faint small">Public tables with a free seat. Updates live.</p></div>
        <span className="chip num" aria-live="polite"><span className="live-dot" aria-hidden="true" />{plural(rooms.length, 'room')}</span>
      </div>
      {rooms.length ? (
        <ul className="room-list">{rooms.map(r => (
          <li key={r.code} className="room">
            <div className="room-seats" aria-hidden="true">
              {Array.from({ length: Math.min(r.seats, 8) }, (_, i) => r.players[i]
                ? <Avatar key={i} person={r.players[i]} size="sm" />
                : <span key={i} className="room-open" />)}
              {r.seats > 8 ? <span className="faint small num">+{r.seats - 8}</span> : null}
            </div>
            <div className="room-text">
              <b>{r.host ? firstName(r.host.name) + '’s table' : 'Thulla table'}</b>
              <span className="faint num">{r.seated} of {r.seats} seats · {formatDuration(r.turnSeconds)} turns</span>
            </div>
            <span className={'chip' + (r.ranked ? ' chip-gold' : '')}>{r.ranked ? 'Ranked' : 'Unranked'}</span>
            <Link className="btn btn-sm btn-primary" href={'/t/' + r.code}>Join</Link>
          </li>
        ))}</ul>
      ) : (
        <div className="room-empty">
          <p className="muted small">No public rooms are open right now. Open one and players online will see it here.</p>
          <CreateTableButton className="btn btn-sm" visibility="public"><Icon id="i-plus" />Open a public room</CreateTableButton>
        </div>
      )}
    </section>
  );
}
