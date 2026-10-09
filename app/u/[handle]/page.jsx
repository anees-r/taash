/* Public profile: rating, streaks and history. Private fields (email) never leave the server. */
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/platform/AppShell';
import { ProfileView } from '@/components/platform/ProfileView';
import { getViewer } from '@/lib/auth/viewer';
import { findUserByHandle, getRating, ratingChange30d, matchHistory } from '@/lib/db/social';
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
  const [rating, change, history, trend] = await Promise.all([getRating(user.id), ratingChange30d(user.id), matchHistory(user.id), ratingTrend(user.id)]);
  return <AppShell><ProfileView user={{ ...user, online: isOnline(user.id) }} rating={rating} change={change} history={history} trend={trend} friendsCount={null} own={false} /></AppShell>;
}
