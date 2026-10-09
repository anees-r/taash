/* Thulla landing: hero with an animated table, the three moves, your stats, recent tables. */
import Link from 'next/link';
import { AppShell } from '@/components/platform/AppShell';
import { Icon } from '@/components/platform/Icon';
import { Crumbs } from '@/components/platform/controls';
import { TablePreview } from '@/components/platform/TablePreview';
import { CreateTableButton } from '@/components/platform/CreateTable';
import { getViewer } from '@/lib/auth/viewer';
import { getRating, recentMatches } from '@/lib/db/social';
import { catalog } from '@/games/catalog';
import { plural, timeAgo, firstName } from '@/lib/client/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Thulla' };

export default async function ThullaLanding() {
  const viewer = await getViewer();
  const user = viewer.kind === 'user' ? viewer : null;
  const meta = catalog[0];
  const [r, recent] = await Promise.all([user ? getRating(user.userId) : null, recentMatches({ limit: 3 })]);
  return (
    <AppShell>
      <main className="page game-page screen-enter">
        <section className="game-hero">
          <div className="gh-copy">
            <Crumbs items={[{ label: 'Games', href: '/' }, { label: meta.name }]} />
            <h1 className="gh-title"><span className="display">{meta.name}</span><span className="urdu" lang="ur">{meta.urdu}</span></h1>
            <p className="gh-lead">A shedding game from Pakistani homes. Follow the shape while you can. When you can’t, slap down a Thulla — and whoever played highest picks up the whole pile.</p>
            <ul className="gh-facts">
              <li><b className="num">2+</b><span>players</span></li>
              <li><b className="num">4</b><span>recommended</span></li>
              <li><b className="num">13</b><span>cards each at 4</span></li>
              <li><b className="num">15–30</b><span>minutes</span></li>
            </ul>
            <div className="gh-actions">
              <CreateTableButton gameId="thulla" className="btn btn-primary btn-lg" autoFocus />
              <Link className="btn btn-lg" href="/join"><Icon id="i-hand" />Join table</Link>
              <Link className="btn btn-lg btn-ghost" href="/games/thulla/rules"><Icon id="i-book" />How to play</Link>
            </div>
            <p className="faint small">{user ? 'Invite friends from your list, or share the table code with anyone.' : 'Playing as a guest — no account needed to create or join.'}</p>
          </div>
          <TablePreview youName={viewer.kind === 'anon' ? 'You' : viewer.name} />
        </section>

        <section className="moves">
          <article className="move"><span className="move-k"><svg className="i" aria-hidden="true"><use href="#suit-H" /></svg></span><h3>Follow the shape</h3><p className="muted">The first card of a baari sets its shape. If you hold that shape, you must play it. When everyone follows, the baari clears for good.</p></article>
          <article className="move ember"><span className="move-k"><Icon id="i-bolt" /></span><h3>Give Thulla</h3><p className="muted">Out of the shape? Play anything. The baari stops dead and the highest card of the shape collects every card on the table.</p></article>
          <article className="move"><span className="move-k"><Icon id="i-hand" /></span><h3>Ask for a hand</h3><p className="muted">From the second baari, before you lead, ask the next player for their whole hand. If they give, they are out — and you hold it all.</p></article>
        </section>

        <div className="two-col">
          {user ? (
            <div className="panel panel-pad my-stats">
              <div className="section-head row"><h2 className="section-title">Your Thulla</h2><Link className="btn btn-sm btn-ghost" href="/profile">Profile</Link></div>
              <dl className="stat-grid">
                <div><dt>Rating</dt><dd className="num">{r.rating}</dd></div>
                <div><dt>Played</dt><dd className="num">{r.played}</dd></div>
                <div><dt>Finished 1st</dt><dd className="num">{r.firsts}</dd></div>
                <div><dt>Winning streak</dt><dd className="num">{r.winStreak}</dd></div>
                <div><dt>Losing streak</dt><dd className="num">{r.loseStreak}</dd></div>
                <div><dt>Peak</dt><dd className="num">{r.peak}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="panel panel-pad my-stats">
              <h2 className="section-title">Your Thulla</h2>
              <p className="muted">Guests play without a rating. Create an account to keep a Thulla rating and history.</p>
              <div className="row-gap" style={{ marginTop: 12 }}><Link className="btn btn-sm btn-primary" href="/register">Create an account</Link><Link className="btn btn-sm" href="/signin">Sign in</Link></div>
            </div>
          )}
          <div className="panel panel-pad">
            <h2 className="section-title">Recently at Thulla tables</h2>
            {recent.length ? (
              <ul className="recent-list">{recent.map(t => (
                <li key={t.id}>
                  <div><b>Table {t.tableCode}</b><span className="faint">{timeAgo(t.endedAt)} · {plural(t.baaris, 'baari')}</span></div>
                  <div className="recent-res"><span><Icon id="i-trophy" />{t.winner ? firstName(t.winner.name) : '—'}</span>{t.loser ? <span className="faint">holding: {firstName(t.loser.name)}</span> : null}</div>
                </li>
              ))}</ul>
            ) : <p className="muted small" style={{ marginTop: 12 }}>No games finished yet. Yours could be the first.</p>}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
