/* Leaderboards per game: friends or everyone, by rating or 1st places. Indexed, 50 per page. */
import Link from 'next/link';
import { Suspense } from 'react';
import { AppShell } from '@/components/platform/AppShell';
import { Avatar } from '@/components/platform/Avatar';
import { LeaderboardControls } from '@/components/platform/LeaderboardControls';
import { getViewer } from '@/lib/auth/viewer';
import { leaderboard, PAGE } from '@/lib/db/social';
import { isOnline } from '@/lib/server/live';
import { catalog } from '@/games/catalog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leaderboard' };

export default async function LeaderboardPage({ searchParams }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  const user = viewer.kind === 'user' ? viewer : null;
  const scope = user && sp.scope !== 'all' ? 'friends' : 'all';
  const sort = sp.sort === 'firsts' ? 'firsts' : 'rating';
  const page = Math.max(0, Math.min(1000, parseInt(sp.page, 10) || 0));
  const rows = await leaderboard({ scope, sort, page, userId: user?.userId });
  const expl = sort === 'rating'
    ? 'Ranked by Thulla rating. Rating rises when you finish ahead of other players and falls when you finish behind them, weighted by their ratings and the table size.'
    : 'Ranked by the number of games finished in 1st place. Ties go to the higher rating.';
  const qs = p => '/leaderboard?' + new URLSearchParams({ scope, sort, page: String(p) }).toString();
  return (
    <AppShell>
      <main className="page lb-page screen-enter">
        <div className="page-head">
          <div><p className="eyebrow">{scope === 'friends' ? 'Friends leaderboard' : 'Leaderboard'}</p><h1 className="page-title">Who rules the Thulla table</h1></div>
          <Suspense><LeaderboardControls scope={scope} sort={sort} canFriends={!!user} /></Suspense>
        </div>
        <div className="tabs" role="tablist" aria-label="Game">
          {catalog.map(g => <button key={g.id} type="button" role="tab" aria-selected={String(g.id === 'thulla')} disabled={g.status !== 'playable'} title={g.status !== 'playable' ? 'Not playable yet — no ratings exist' : undefined}>{g.name}{g.status !== 'playable' ? <span className="tab-soon"> · soon</span> : null}</button>)}
        </div>
        <p className="muted small">{expl}</p>
        <section className="panel lb-panel">
          {rows.length ? (
            <div className="table-scroll"><table className="lb-table">
              <thead><tr><th>Rank</th><th>Player</th><th className="r">Rating</th><th className="r">1st places</th><th className="r hide-sm">Played</th><th className="r hide-sm">1st rate</th></tr></thead>
              <tbody>{rows.map(r => {
                const me = user && r.id === user.userId;
                return (
                  <tr key={r.id} className={me ? 'me' : undefined}>
                    <td className="rank-cell">{r.rank <= 3 ? <span className={'medal m' + r.rank}>{r.rank}</span> : <span className="num">{r.rank}</span>}</td>
                    <td><div className="lb-person"><Avatar person={r} size="sm" status={isOnline(r.id) ? 'on' : null} /><Link href={'/u/' + r.handle}><b>{me ? r.name + ' (you)' : r.name}</b></Link></div></td>
                    <td className={'r num' + (sort === 'rating' ? ' sorted' : '')}>{r.rating}</td>
                    <td className={'r num' + (sort === 'firsts' ? ' sorted' : '')}>{r.firsts}</td>
                    <td className="r num hide-sm">{r.played}</td>
                    <td className="r num hide-sm">{r.played ? Math.round(r.firsts / r.played * 100) + '%' : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <p className="muted" style={{ padding: 16 }}>{scope === 'friends' ? 'Add friends and play a few games to fill this board.' : 'No rated games yet. Finish a game with an account to appear here.'}</p>}
        </section>
        {scope === 'all' && (page > 0 || rows.length === PAGE) ? (
          <div className="row-gap">{page > 0 ? <Link className="btn btn-sm" href={qs(page - 1)}>Previous</Link> : null}{rows.length === PAGE ? <Link className="btn btn-sm" href={qs(page + 1)}>Next</Link> : null}</div>
        ) : null}
      </main>
    </AppShell>
  );
}
