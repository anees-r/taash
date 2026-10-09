/** Server-component / server-action helper: the current viewer from Next's request cookies. */
import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { auth } from './auth.js';
import { decodeGuest, GUEST_COOKIE } from './guest.js';
import { userViewer, guestViewer } from './identity.js';

/** @returns {Promise<import('./identity.js').Viewer>} */
export const getViewer = cache(async () => {
  const session = await auth();
  if (session?.user?.id) return userViewer(session.user.id, session.user.name, session.user.handle);
  const jar = await cookies();
  return guestViewer(decodeGuest(jar.get(GUEST_COOKIE)?.value));
});

/** For pages that need an account. */
export async function requireUser() {
  const v = await getViewer();
  return v.kind === 'user' ? v : null;
}
