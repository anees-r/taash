'use server';
/** Friend actions. The acting user always comes from the session; ids in the form are only targets. */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/viewer';
import { sendFriendRequest, respondFriendRequest, removeFriendship, cancelFriendRequest } from '@/lib/db/social';
import { createLimiter } from '@/lib/rate-limit';

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
  return res.ok ? { ok: true, message: res.status === 'accepted' ? 'You and ' + res.name + ' are now friends.' : 'Request sent to ' + res.name + '.' } : res;
}

export async function respondAction(formData) {
  const me = await requireUser();
  if (!me) return;
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) return;
  await respondFriendRequest(me.userId, id.data, formData.get('accept') === '1');
  revalidatePath('/friends');
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
