/** Friends of the signed-in user, with online status — for the lobby's invite dialog. */
import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { listFriends, relationsOf } from '@/lib/db/social';
import { isOnline } from '@/lib/server/live';

export const dynamic = 'force-dynamic';

export async function GET() {
  const v = await getViewer();
  if (v.kind !== 'user') return NextResponse.json({ error: 'Sign in to see friends.' }, { status: 401 });
  const [friends, rel] = await Promise.all([listFriends(v.userId), relationsOf(v.userId)]);
  return NextResponse.json({
    friends: friends.map(f => ({ id: f.id, name: f.name, handle: f.handle, rating: f.rating, online: isOnline(f.id) })),
    sent: rel.sent, received: rel.received,
  }, { headers: { 'cache-control': 'no-store' } });
}
