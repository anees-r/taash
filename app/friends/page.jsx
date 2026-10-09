import { AppShell } from '@/components/platform/AppShell';
import { FriendsView } from '@/components/platform/FriendsView';
import { getViewer } from '@/lib/auth/viewer';
import { listFriends, pendingRequests } from '@/lib/db/social';
import { isOnline, tableManager } from '@/lib/server/live';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Friends' };

export default async function FriendsPage() {
  const viewer = await getViewer();
  if (viewer.kind !== 'user') {
    return (
      <AppShell>
        <main className="page friends-page screen-enter">
          <div className="page-head"><div><p className="eyebrow">Friends</p><h1 className="page-title">Your card table regulars</h1></div></div>
          <section className="panel panel-pad"><p className="muted">Guests don’t have a friends list. <Link href="/register">Create an account</Link> or <Link href="/signin">sign in</Link> to add friends, invite them to tables and compare ratings.</p></section>
        </main>
      </AppShell>
    );
  }
  const [friends, { incoming, outgoing }] = await Promise.all([listFriends(viewer.userId), pendingRequests(viewer.userId)]);
  // A table you are seated at that isn't mid-game: invites go there.
  let myTable = null;
  const m = tableManager();
  if (m) for (const t of m.tables.values()) if (t.status !== 'playing' && m.seatOf(t, viewer.playerId)) { myTable = t.code; break; }
  return (
    <AppShell>
      <FriendsView friends={friends.map(f => ({ ...f, online: isOnline(f.id) }))} incoming={incoming} outgoing={outgoing} myTable={myTable} />
    </AppShell>
  );
}
