/* Public profile: rating, streaks and history. Private fields (email) never leave the server. */
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/platform/AppShell';
import { ProfileView } from '@/components/platform/ProfileView';
import { getViewer } from '@/lib/auth/viewer';
import { findUserByHandle, getRating, ratingChange30d, matchHistory, relationsOf } from '@/lib/db/social';
import { AddFriendButton } from '@/components/platform/AddFriendButton';
import { ratingTrend } from '@/lib/db/rating-trend';
import { isOnline } from '@/lib/server/live';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { handle } = await params;
  return { title: '@' + handle };
}

export default async function PublicProfile({ params }) {
  const { handle } = await params;
  const user = await findUserByHandle(handle);
  if (!user) notFound();
  const viewer = await getViewer();
  if (viewer.kind === 'user' && viewer.userId === user.id) redirect('/profile');
  const [rating, change, history, trend, rel] = await Promise.all([getRating(user.id), ratingChange30d(user.id), matchHistory(user.id), ratingTrend(user.id), viewer.kind === 'user' ? relationsOf(viewer.userId) : null]);
  const relation = !rel ? undefined : rel.friends.includes(user.id) ? 'friend' : rel.sent.includes(user.id) ? 'sent' : rel.received.includes(user.id) ? 'received' : 'none';
  const actions = rel ? (relation === 'friend' ? <span className="chip chip-mist">Friends</span> : <AddFriendButton handle={user.handle} userId={user.id} relation={relation} className="btn btn-primary" />) : null;
  return <AppShell><ProfileView user={{ ...user, online: isOnline(user.id) }} rating={rating} change={change} history={history} trend={trend} friendsCount={null} own={false} actions={actions} /></AppShell>;
}
