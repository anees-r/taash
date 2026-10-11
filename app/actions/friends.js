'use server';
/** Friend actions. The acting user always comes from the session; ids in the form are only targets. */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/viewer';
import { sendFriendRequest, respondFriendRequest, removeFriendship, cancelFriendRequest } from '@/lib/db/social';
import { createLimiter } from '@/lib/rate-limit';
import { notifyUser } from '@/lib/server/live';

/** Tell the other person straight away (every tab they have open). */
function announce(me, res) {
  if (!res.ok || !res.toId) return;
  const from = { name: me.name, handle: me.handle };
  if (res.status === 'accepted') notifyUser(res.toId, 'friend:accepted', { by: from });
  else notifyUser(res.toId, 'friend:request', { id: res.requestId, from });
}

const g = globalThis;
const limit = g.__taashFriendLimiter || (g.__taashFriendLimiter = createLimiter({ capacity: 10, perSecond: 0.1 }));
const Id = z.string().min(1).max(80);

export async function addFriendAction(_prev, formData) {
  const me = await requireUser();
  if (!me) return { error: 'Sign in to add friends.' };
  if (!limit(me.userId)) return { error: 'Too many requests. Try again in a minute.' };
  const handle = String(formData.get('handle') || '').trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._]{3,20}$/.test(handle)) return { error: 'Enter a handle like @sanamir.' };
  const res = await sendFriendRequest(me.userId, handle);
  if (res.ok) revalidatePath('/friends');
  announce(me, res);
  return res.ok ? { ok: true, message: res.status === 'accepted' ? 'You and ' + res.name + ' are now friends.' : 'Request sent to ' + res.name + '.' } : res;
}

export async function respondAction(formData) {
  const me = await requireUser();
  if (!me) return;
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) return;
  const accept = formData.get('accept') === '1';
  const res = await respondFriendRequest(me.userId, id.data, accept);
  if (res.ok && accept) notifyUser(res.requesterId, 'friend:accepted', { by: { name: me.name, handle: me.handle } });
  revalidatePath('/friends');
}

/** Accept or decline from the pop-up notification. */
export async function quickRespondAction(requestId, accept) {
  const me = await requireUser();
  if (!me) return { error: 'Sign in first.' };
  const id = Id.safeParse(requestId);
  if (!id.success) return { error: 'That request is no longer waiting for you.' };
  const res = await respondFriendRequest(me.userId, id.data, !!accept);
  if (res.ok && accept) notifyUser(res.requesterId, 'friend:accepted', { by: { name: me.name, handle: me.handle } });
  revalidatePath('/friends');
  return res;
}

export async function cancelAction(formData) {
  const me = await requireUser();
  if (!me) return;
  const id = Id.safeParse(formData.get('id'));
  if (id.success) await cancelFriendRequest(me.userId, id.data);
  revalidatePath('/friends');
}

export async function removeFriendAction(formData) {
  const me = await requireUser();
  if (!me) return;
  const id = Id.safeParse(formData.get('userId'));
  if (id.success) await removeFriendship(me.userId, id.data);
  revalidatePath('/friends');
}

/** One-tap "Add friend" from leaderboards, profiles and tables. */
export async function quickAddFriendAction(handle) {
  const me = await requireUser();
  if (!me) return { error: 'Sign in to add friends.' };
  if (!limit(me.userId)) return { error: 'You’ve sent a lot of requests. Try again in a minute.' };
  const h = String(handle || '').trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._]{3,20}$/.test(h)) return { error: 'That player can’t be added.' };
  const res = await sendFriendRequest(me.userId, h);
  if (!res.ok) return res;
  announce(me, res);
  revalidatePath('/friends');
  return { ok: true, status: res.status, message: res.status === 'accepted' ? 'You and ' + res.name + ' are now friends.' : 'Friend request sent to ' + res.name + '.' };
}
