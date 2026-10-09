'use client';
/* Table lobby: the code is the hero; seats, readiness, host controls, settings, chat. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { Modal, Confirm } from './Modal';
import { Crumbs, Segmented, Note } from './controls';
import { Chat } from './Chat';
import { Guide } from '@/games/thulla/client/Guide';
import { clientGames } from '@/games/client-registry';
import { gameMeta } from '@/games/catalog';
import { call } from '@/lib/client/socket';
import { copyText } from '@/lib/client/dom';
import { toast } from '@/lib/client/toast';
import { plural, firstName } from '@/lib/client/format';

export function LobbyView({ table, you, viewerKind, chat, appUrl, onLeft, onShowResults }) {
  const game = clientGames[table.gameId];
  const meta = gameMeta(table.gameId);
  const isHost = table.hostId === you;
  const host = table.players.find(p => p.id === table.hostId);
  const me = table.players.find(p => p.id === you);
  const seats = table.settings.players;
  const nonHostNotReady = table.players.filter(p => p.id !== table.hostId && !p.ready);
  const canStart = isHost && table.players.length >= 2 && nonHostNotReady.length === 0;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [rules, setRules] = useState(false);
  const [kick, setKick] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const link = appUrl + '/t/' + table.code;

  let note;
  if (!isHost) note = 'Only the host, ' + firstName(host?.name) + ', can start the game.' + (table.players.length < 2 ? ' Waiting for at least one more player.' : '');
  else if (table.players.length < 2) note = 'Waiting for at least one more player — share the code.';
  else if (nonHostNotReady.length) note = 'Waiting for ' + nonHostNotReady.map(p => firstName(p.name)).join(', ') + ' to get ready.';
  else note = table.players.length < seats ? 'Ready to start with ' + table.players.length + ' players — or wait for ' + plural(seats - table.players.length, 'more seat') + ' to fill.' : 'Everyone is here and ready.';

  async function act(event, payload, okMsg) {
    setBusy(true);
    const r = await call(event, { code: table.code, ...payload });
    setBusy(false);
    if (r.error) toast(r.error, { icon: 'i-info' }); else if (okMsg) toast(okMsg);
    return r;
  }

  const grid = [];
  for (let i = 0; i < Math.max(seats, table.players.length); i++) {
    const p = table.players[i];
    if (!p) {
      grid.push(
        <li key={'e' + i} className="seat-card empty">
          <span className="seat-no num">Seat {i + 1}</span>
          <div className="empty-ring"><Icon id="i-plus" /></div>
          <b>Open seat</b><span className="faint">Waiting for a player</span>
          {viewerKind === 'user' ? <button type="button" className="btn btn-sm" onClick={() => setInviting(true)}>Invite</button> : <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>Share</button>}
        </li>);
      continue;
    }
    const isHostP = p.id === table.hostId, isMe = p.id === you;
    const st = isHostP ? { t: 'Host', c: 'host', ic: 'i-crown' } : p.ready ? { t: 'Ready', c: 'ready', ic: 'i-check' } : { t: 'Not ready yet', c: 'waiting', ic: 'i-clock' };
    grid.push(
      <li key={p.id} className={'seat-card' + (isHostP ? ' is-host' : '') + (isMe ? ' is-me' : '')} data-player={p.id}>
        <span className="seat-no num">Seat {i + 1}</span>
        <Avatar person={p} size="lg" status={p.connected ? 'on' : 'away'} />
        <b className="seat-pname">{isMe ? p.name + ' (you)' : p.name}</b>
        <div className="seat-tags"><span className="chip">{p.guest ? 'Guest' : 'Member'}</span><span className={'chip st-' + st.c}><Icon id={st.ic} />{st.t}</span></div>
        {isHost && !isHostP ? <button type="button" className="icon-btn seat-x" aria-label={'Remove ' + p.name + ' from the table'} title="Remove from table" onClick={() => setKick(p)}><Icon id="i-x" /></button> : null}
      </li>);
  }

  return (
    <main className="page lobby-page screen-enter">
      <section className="lobby-head">
        <div className="lh-left">
          <Crumbs items={[{ label: 'Games', href: '/' }, { label: meta.name, href: '/games/' + meta.id }, { label: 'Lobby' }]} />
          <h1 className="page-title">{meta.name} table</h1>
          <p className="muted">Hosted by <b className="host-name">{isHost ? 'you' : host?.name}</b> · <span className="seat-sum num">{table.players.length} of {seats} seats taken</span></p>
        </div>
        <div className="code-card">
          <span className="eyebrow">Table code</span>
          <div className="code-big num" aria-label={'Table code ' + table.code.split('').join(' ')}>{table.code.split('').map((ch, i) => <span key={i} className={ch === '-' ? 'dash' : undefined}>{ch}</span>)}</div>
          <div className="code-actions">
            <button type="button" className="btn" onClick={async () => { const ok = await copyText(table.code); toast(ok ? 'Table code ' + table.code + ' copied' : 'Copy blocked — select the code to copy it', { icon: 'i-copy' }); }}><Icon id="i-copy" />Copy code</button>
            <button type="button" className="btn" onClick={() => setSharing(true)}><Icon id="i-share" />Share link</button>
          </div>
        </div>
      </section>

      <div className="lobby-grid">
        <div className="lobby-main">
          <section className="panel panel-pad seats-panel">
            <div className="section-head row"><h2 className="section-title">At the table</h2><div className="row-gap">{viewerKind === 'user' ? <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><Icon id="i-users" />Invite friends</button> : null}</div></div>
            <ol className="seat-grid" aria-label="Seats">{grid}</ol>
          </section>
          <section className="start-panel">
            <div><p className={'start-note' + (canStart ? ' ok' : '')} aria-live="polite">{note}</p></div>
            <div className="row-gap">
              <button type="button" className="btn btn-ghost" onClick={() => setLeaving(true)}>Leave table</button>
              {table.status === 'finished' ? <button type="button" className="btn" onClick={onShowResults}>Last results</button> : null}
              {!isHost && me ? <button type="button" className={'btn' + (me.ready ? '' : ' btn-primary')} disabled={busy} onClick={() => act('table:ready', { ready: !me.ready })}><Icon id={me.ready ? 'i-check' : 'i-clock'} />{me.ready ? 'Ready' : 'I’m ready'}</button> : null}
              {isHost ? <button type="button" className="btn btn-primary btn-lg" disabled={!canStart || busy} onClick={() => act('table:start', testDeal())}>Start game</button> : null}
            </div>
          </section>
        </div>
        <div className="lobby-side">
          <section className="panel panel-pad settings-panel">
            <div className="section-head row"><h2 className="section-title">Table rules</h2>{isHost ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Icon id="i-sliders" />Edit</button> : null}</div>
            <div className="kv-grid">{game.settingsSummary(table.settings).map(r => <div key={r.label} className="kv"><span className="faint">{r.label}</span><b>{r.value}</b></div>)}</div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRules(true)}><Icon id="i-book" />How to play</button>
          </section>
          <section className="panel lobby-chat"><Chat code={table.code} messages={chat} you={you} idSuffix="lobby" /></section>
        </div>
      </div>

      {editing ? <EditSettings table={table} onClose={() => setEditing(false)} /> : null}
      <ShareDialog open={sharing} onClose={() => setSharing(false)} code={table.code} link={link} gameName={meta.name} />
      {inviting ? <InviteDialog table={table} onClose={() => setInviting(false)} /> : null}
      <Modal open={rules} onClose={() => setRules(false)} drawer eyebrow={meta.name} title="How to play"><Guide compact /></Modal>
      <Confirm open={!!kick} title={kick ? 'Remove ' + kick.name + '?' : ''} message="They lose their seat and the seat opens for someone else. They can rejoin with the code." confirmLabel="Remove player" danger
        onCancel={() => setKick(null)} onConfirm={async () => { const p = kick; setKick(null); const r = await act('table:kick', { playerId: p.id }); if (!r.error) toast(p.name + ' was removed. Seat open.'); }} />
      <Confirm open={leaving} title="Leave this table?" message={isHost ? 'Hosting passes to the next player. You can rejoin with the code while the table is open.' : 'Your seat opens for someone else. You can rejoin with the code while there is room.'} confirmLabel="Leave table" danger
        onCancel={() => setLeaving(false)} onConfirm={async () => { setLeaving(false); await act('table:leave', {}); onLeft(); }} />
    </main>
  );
}

/** End-to-end tests can ask for a short deal; the server ignores this unless TAASH_E2E=1. */
function testDeal() {
  try { const k = Number(sessionStorage.getItem('taash:e2eCards')); return k ? { testCardsEach: k } : {}; } catch { return {}; }
}

function EditSettings({ table, onClose }) {
  const game = clientGames[table.gameId];
  const [s, setS] = useState({ ...table.settings });
  const [valid, setValid] = useState(true);
  const [err, setErr] = useState(null);
  async function save() {
    if (s.players < table.players.length) { setErr(plural(table.players.length, 'player is', 'players are') + ' already seated. Remove players before lowering the seat count to ' + s.players + '.'); return; }
    const r = await call('table:settings', { code: table.code, settings: s });
    if (r.error) { setErr(r.error); return; }
    toast('Settings saved'); onClose();
  }
  return (
    <Modal open onClose={onClose} wide eyebrow={'Table ' + table.code} title="Table settings"
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!valid} onClick={save}>Save settings</button></>}>
      <game.SettingsForm value={s} minPlayers={table.players.length} onChange={(next, ok) => { setS(next); setValid(ok); setErr(null); }} />
      {err ? <p className="error" role="alert" style={{ color: 'var(--rose-300)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>{err}</p> : null}
    </Modal>
  );
}

function ShareDialog({ open, onClose, code, link, gameName }) {
  const msg = 'Join my ' + gameName + ' table on Taash — code ' + code + '\n' + link;
  const enc = encodeURIComponent(msg);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  return (
    <Modal open={open} onClose={onClose} title="Share this table" subtitle="Anyone with the code can take an open seat — guests included."
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="field"><label htmlFor="share-link">Invitation link</label>
        <div className="row-gap"><input className="input" id="share-link" value={link} readOnly onFocus={e => e.target.select()} />
          <button type="button" className="btn" onClick={async () => { const ok = await copyText(link); toast(ok ? 'Link copied' : 'Copy blocked — select the link to copy it'); }}><Icon id="i-copy" />Copy</button></div></div>
      <div className="field"><span className="field-label">Message preview</span><pre className="share-msg">{msg}</pre></div>
      <div className="share-targets">
        <a className="btn btn-sm" href={'https://wa.me/?text=' + enc} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a className="btn btn-sm" href={'sms:?&body=' + enc}>Messages</a>
        <a className="btn btn-sm" href={'mailto:?subject=' + encodeURIComponent('Join my ' + gameName + ' table') + '&body=' + enc}>Email</a>
        {canShare ? <button type="button" className="btn btn-sm" onClick={() => navigator.share({ title: 'Taash', text: msg }).catch(() => {})}>More…</button> : null}
      </div>
    </Modal>
  );
}

function InviteDialog({ table, onClose }) {
  const [friends, setFriends] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [sent, setSent] = useState(new Set());
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => { fetch('/api/friends').then(r => r.json()).then(j => setFriends(j.friends || [])).catch(() => setFriends([])); }, []);
  const seated = new Set(table.players.map(p => p.id));
  const open = table.settings.players - table.players.length;
  const rows = (friends || []).filter(f => filter === 'all' || f.online).filter(f => !q || f.name.toLowerCase().includes(q) || f.handle.includes(q)).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  async function send() {
    const ids = [...selected];
    const r = await call('table:invite', { code: table.code, userIds: ids });
    if (r.error) { toast(r.error, { icon: 'i-info' }); return; }
    setSent(new Set([...sent, ...ids])); setSelected(new Set());
    toast('Invites sent', { icon: 'i-send' });
  }
  return (
    <Modal open onClose={onClose} eyebrow={'Table ' + table.code} title="Invite friends" subtitle="Online friends get a notification with a Join button."
      footer={<><span className="faint small">{selected.size ? plural(selected.size, 'friend') + ' selected · ' : ''}{plural(open, 'open seat')}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-ghost" onClick={onClose}>Done</button><button type="button" className="btn btn-primary" disabled={!selected.size} onClick={send}>{selected.size ? 'Invite ' + plural(selected.size, 'friend') : 'Send invites'}</button></>}>
      <div className="invite-tools">
        <input className="input" id="invite-search" type="search" placeholder="Search friends by name" autoComplete="off" data-autofocus onChange={e => setQ(e.target.value.trim().toLowerCase())} />
        <Segmented options={[{ value: 'all', label: 'All friends' }, { value: 'online', label: 'Online' }]} value={filter} onChange={setFilter} label="Filter friends" />
      </div>
      <ul className="invite-list" role="listbox" aria-multiselectable="true" aria-label="Friends">
        {friends == null ? <li className="invite-empty"><p className="muted">Loading friends…</p></li> : null}
        {friends && !rows.length ? <li className="invite-empty"><p className="muted">{!friends.length ? <>No friends yet. <Link href="/friends">Add friends</Link> by their @handle.</> : q ? 'No friends match “' + q + '”.' : 'None of your friends are online right now.'}</p></li> : null}
        {rows.map(f => {
          const atTable = seated.has('u:' + f.id), wasSent = sent.has(f.id), sel = selected.has(f.id), locked = atTable || wasSent;
          const toggle = () => { if (locked) return; const s = new Set(selected); if (sel) s.delete(f.id); else s.add(f.id); setSelected(s); };
          return (
            <li key={f.id} className={'invite-row' + (sel ? ' selected' : '') + (locked ? ' locked' : '')} role="option" aria-selected={String(sel)} aria-disabled={String(locked)} tabIndex={locked ? -1 : 0}
              onClick={toggle} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}>
              <span className="check">{sel ? <Icon id="i-check" /> : null}</span>
              <Avatar person={f} status={f.online ? 'on' : null} />
              <div className="ir-text"><b>{f.name}</b><span className="faint">@{f.handle} · Thulla {f.rating}</span></div>
              <span className={'ir-status' + (f.online ? ' on' : '') + (wasSent ? ' sent' : '')}>{wasSent ? <Icon id="i-check" /> : null}{atTable ? 'At this table' : wasSent ? 'Invite sent' : f.online ? 'Online' : 'Offline'}</span>
            </li>
          );
        })}
      </ul>
      <Note>Invites reach friends who are online on Taash. You can also share the table link.</Note>
    </Modal>
  );
}
