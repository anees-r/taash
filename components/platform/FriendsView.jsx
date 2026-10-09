'use client';
/* Friends list (online first), requests, add by handle, invite to your open table. */
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Confirm, Modal } from './Modal';
import { Segmented } from './controls';
import { CreateTableButton } from './CreateTable';
import { addFriendAction, respondAction, cancelAction, removeFriendAction } from '@/app/actions/friends';
import { call } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';
import { firstName } from '@/lib/client/format';

export function FriendsView({ friends, incoming, outgoing, myTable }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  // Kept after closing so the dialog text doesn't blank out during the exit animation.
  const [removing, setRemoving] = useState({ open: false, friend: null, busy: false });
  const rows = friends
    .filter(f => (filter === 'all' || f.online) && (!q || f.name.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q)))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));

  async function invite(f) {
    if (!myTable) return;
    const res = await call('table:invite', { code: myTable, userIds: [f.id] });
    toast(res.error || (res.sent ? 'Invite sent to ' + firstName(f.name) : firstName(f.name) + ' could not be invited.'), { icon: res.error ? 'i-info' : 'i-send' });
  }

  async function confirmRemove() {
    const f = removing.friend;
    setRemoving(r => ({ ...r, busy: true }));
    const fd = new FormData();
    fd.set('userId', f.id);
    try {
      await removeFriendAction(fd);
      toast(f.name + ' is no longer your friend.', { icon: 'i-users' });
    } catch {
      toast('Could not remove ' + firstName(f.name) + '. Try again.', { icon: 'i-info' });
    }
    setRemoving(r => ({ ...r, open: false, busy: false }));
  }

  return (
    <main className="page friends-page screen-enter">
      <div className="page-head">
        <div><p className="eyebrow">Friends</p><h1 className="page-title">Your card table regulars</h1></div>
        <button type="button" className="btn" onClick={() => setAdding(true)}><Icon id="i-plus" />Add friend</button>
      </div>

      {incoming.length ? (
        <section className="panel friends-panel" style={{ marginBottom: 16 }} aria-label="Friend requests">
          <ul className="friend-list">{incoming.map(r => (
            <li key={r.id} className="friend">
              <Avatar person={r.user} />
              <div><b>{r.user.name}</b><span className="faint">@{r.user.handle} wants to be friends</span></div>
              <form action={respondAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="accept" value="1" /><button className="btn btn-sm btn-primary" type="submit">Accept</button></form>
              <form action={respondAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="accept" value="0" /><button className="btn btn-sm btn-ghost" type="submit">Decline</button></form>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <div className="invite-tools">
        <input className="input" id="friend-search" type="search" placeholder="Search friends" autoComplete="off" value={q} onChange={e => setQ(e.target.value.trim().toLowerCase())} aria-label="Search friends" />
        <Segmented options={[{ value: 'all', label: 'All' }, { value: 'online', label: 'Online' }]} value={filter} onChange={setFilter} label="Filter" />
      </div>
      <section className="panel friends-panel">
        <ul className="friend-list">
          {rows.map(f => (
            <li key={f.id} className="friend">
              <Avatar person={f} status={f.online ? 'on' : null} />
              <div><Link href={'/u/' + f.handle}><b>{f.name}</b></Link><span className="faint">{f.online ? 'Online' : '@' + f.handle}</span></div>
              <span className="chip num">Thulla {f.rating}</span>
              {myTable
                ? <button type="button" className="btn btn-sm" onClick={() => invite(f)}>Invite to {myTable}</button>
                : <CreateTableButton className="btn btn-sm">Invite to a table</CreateTableButton>}
              <button className="icon-btn" type="button" onClick={() => setRemoving({ open: true, friend: f, busy: false })} aria-label={'Remove ' + f.name + ' from friends'} title="Remove friend"><Icon id="i-x" /></button>
            </li>
          ))}
          {!rows.length ? <li className="invite-empty"><p className="muted">{friends.length ? 'No friends match.' : 'No friends yet. Add someone by their @handle.'}</p></li> : null}
        </ul>
      </section>

      {outgoing.length ? (
        <section style={{ marginTop: 16 }}>
          <h2 className="sub">Waiting for an answer</h2>
          <ul className="friend-list panel" style={{ marginTop: 8 }}>{outgoing.map(r => (
            <li key={r.id} className="friend">
              <Avatar person={r.user} size="sm" /><div><b>{r.user.name}</b><span className="faint">@{r.user.handle}</span></div>
              <form action={cancelAction}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm btn-ghost" type="submit">Cancel request</button></form>
            </li>
          ))}</ul>
        </section>
      ) : null}
      <AddFriend open={adding} onClose={() => setAdding(false)} />
      <Confirm open={removing.open} danger busy={removing.busy}
        title={removing.friend ? 'Remove ' + removing.friend.name + '?' : ''}
        confirmLabel={removing.busy ? 'Removing…' : 'Remove friend'} cancelLabel="Keep"
        onCancel={() => { if (!removing.busy) setRemoving(r => ({ ...r, open: false })); }} onConfirm={confirmRemove}>
        {removing.friend ? (
          <div className="friend" style={{ marginBottom: 12 }}>
            <Avatar person={removing.friend} />
            <div><b>{removing.friend.name}</b><span className="faint">@{removing.friend.handle}</span></div>
          </div>
        ) : null}
        <p className="muted">You’ll be removed from each other’s friends lists, and you won’t be able to invite each other to tables. You can send a new friend request any time.</p>
      </Confirm>
    </main>
  );
}

function AddFriend({ open, onClose }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addFriendAction, null);
  useEffect(() => { if (state?.ok) { toast(state.message, { icon: 'i-users' }); router.refresh(); onClose(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Add a friend" subtitle="Friends can invite each other to tables and share a leaderboard.">
      <form action={action} className="field">
        <label htmlFor="add-handle">Their handle</label>
        <input className={'input' + (state?.error ? ' invalid' : '')} id="add-handle" name="handle" placeholder="@handle" autoComplete="off" data-autofocus required />
        {state?.error ? <span className="error" role="alert">{state.error}</span> : null}
        <div style={{ marginTop: 8 }}><button className="btn btn-primary" type="submit" disabled={pending}>Send request</button></div>
      </form>
    </Modal>
  );
}
