'use client';
/* One-tap "Add friend" for leaderboards, profiles and tables. Hidden for guests, yourself and existing friends. */
import { useEffect, useState } from 'react';
import { quickAddFriendAction } from '@/app/actions/friends';
import { useViewer } from './Providers';
import { Icon } from './Icon';
import { toast } from '@/lib/client/toast';

let cache = null;          // one /api/friends fetch per page load, shared by every button
let pending = null;
const listeners = new Set();
function loadRelations() {
  if (cache) return Promise.resolve(cache);
  pending ||= fetch('/api/friends', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => {
    cache = j ? { friends: new Set((j.friends || []).map(f => f.id)), sent: new Set(j.sent || []), received: new Set(j.received || []) } : { friends: new Set(), sent: new Set(), received: new Set() };
    return cache;
  }).catch(() => ({ friends: new Set(), sent: new Set(), received: new Set() }));
  return pending;
}

/** Friendships changed (a request was accepted, here or elsewhere): look them up again. */
export function refreshRelations() {
  cache = null; pending = null;
  listeners.forEach(fn => fn());
}

/** Server pages can pass `relation` directly; client screens let the button look it up. */
export function AddFriendButton({ handle, userId, relation, className = 'btn btn-sm btn-ghost', compact }) {
  const viewer = useViewer();
  const [state, setState] = useState(relation ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (relation !== undefined || viewer.kind !== 'user' || !userId) return;
    let alive = true;
    const sync = () => loadRelations().then(r => { if (alive) setState(r.friends.has(userId) ? 'friend' : r.sent.has(userId) ? 'sent' : r.received.has(userId) ? 'received' : 'none'); });
    sync();
    listeners.add(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, [relation, userId, viewer.kind]);

  if (viewer.kind !== 'user' || !handle || viewer.handle?.toLowerCase() === handle.toLowerCase() || state === 'friend' || state == null) return null;
  if (state === 'sent') return <span className="chip friend-sent" title="Friend request sent"><Icon id="i-check" />{compact ? '' : 'Requested'}</span>;

  async function add() {
    setBusy(true);
    const r = await quickAddFriendAction(handle).catch(() => ({ error: 'You appear to be offline.' }));
    setBusy(false);
    if (r.error) { toast(r.error, { icon: 'i-info' }); return; }
    toast(r.message, { icon: 'i-users' });
    const next = r.status === 'accepted' ? 'friend' : 'sent';
    setState(next);
    if (cache && userId) (next === 'friend' ? cache.friends : cache.sent).add(userId);
    listeners.forEach(fn => fn());
  }
  return (
    <button type="button" className={className + ' add-friend'} disabled={busy} onClick={add} title={state === 'received' ? 'Accept their friend request' : 'Send a friend request to @' + handle}
      aria-label={(state === 'received' ? 'Accept friend request from @' : 'Add @') + handle + (state === 'received' ? '' : ' as a friend')}>
      <Icon id={state === 'received' ? 'i-check' : 'i-plus'} />{compact ? null : state === 'received' ? 'Accept' : 'Add friend'}
    </button>
  );
}
