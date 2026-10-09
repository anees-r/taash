'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Segmented } from './controls';

export function LeaderboardControls({ scope, sort, canFriends }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = patch => { const p = new URLSearchParams(sp); for (const k in patch) p.set(k, patch[k]); p.delete('page'); router.push('/leaderboard?' + p.toString()); };
  return (
    <div className="row-gap wrap">
      {canFriends ? <Segmented options={[{ value: 'friends', label: 'Friends' }, { value: 'all', label: 'Everyone' }]} value={scope} onChange={v => go({ scope: v })} label="Who" /> : null}
      <Segmented options={[{ value: 'rating', label: 'Rating' }, { value: 'firsts', label: '1st-place finishes' }]} value={sort} onChange={v => go({ sort: v })} label="Rank by" />
    </div>
  );
}
