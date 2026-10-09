import { AppShell } from '@/components/platform/AppShell';
import { ProfileView, GuestProfile } from '@/components/platform/ProfileView';
import { OwnProfileActions } from '@/components/platform/ProfileActions';
import { getViewer } from '@/lib/auth/viewer';
import { getUser, getRating, ratingChange30d, matchHistory, friendIds } from '@/lib/db/social';
import { ratingTrend } from '@/lib/db/rating-trend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (viewer.kind !== 'user') return <AppShell><GuestProfile name={viewer.kind === 'guest' ? viewer.name : null} /></AppShell>;
  const [user, rating, change, history, trend, friends] = await Promise.all([
    getUser(viewer.userId), getRating(viewer.userId), ratingChange30d(viewer.userId), matchHistory(viewer.userId), ratingTrend(viewer.userId), friendIds(viewer.userId),
  ]);
  return (
    <AppShell>
      <ProfileView user={{ ...user, online: true }} rating={rating} change={change} history={history} trend={trend} friendsCount={friends.length} own actions={<OwnProfileActions name={user.name} handle={user.handle} />} />
    </AppShell>
  );
}
