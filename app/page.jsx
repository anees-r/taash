/* Home: Taash's front room — who you are, who is around, and what to play. */
import Link from 'next/link';
import { AppShell } from '@/components/platform/AppShell';
import { Avatar } from '@/components/platform/Avatar';
import { Icon } from '@/components/platform/Icon';
import { PlayingCard } from '@/components/game/PlayingCard';
import { MiniTable } from '@/components/platform/MiniTable';
import { CreateTableButton } from '@/components/platform/CreateTable';
import { getViewer } from '@/lib/auth/viewer';
import { getRating, ratingChange30d, listFriends, leaderboard, recentMatches, getUser } from '@/lib/db/social';
import { isOnline } from '@/lib/server/live';
import { catalog } from '@/games/catalog';
import { plural, timeAgo, firstName, monthYear } from '@/lib/client/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Card games with friends' };

function HeroCards() {
  const fan = ['10H', 'JC', 'QD', 'KH', 'AS'];
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-felt" />
      <div className="hero-fan">{fan.map((id, i) => <div key={id} className="hf" style={{ '--i': i, '--n': fan.length }}><PlayingCard card={id} size={112} /></div>)}</div>
      <div className="hero-back"><PlayingCard card="back" size={96} /></div>
    </div>
  );
}

export default async function Home() {
  const viewer = await getViewer();
  const user = viewer.kind === 'user' ? viewer : null;
  const thulla = catalog[0];
  const [r, change, friends, board, recent, me] = user
    ? await Promise.all([getRating(user.userId), ratingChange30d(user.userId), listFriends(user.userId), leaderboard({ scope: 'friends', userId: user.userId }), recentMatches({ userId: user.userId }), getUser(user.userId)])
    : [null, 0, [], await leaderboard({ scope: 'all' }), await recentMatches({}), null];
  const online = friends.filter(f => isOnline(f.id));
  const name = viewer.kind === 'anon' ? 'Welcome' : viewer.name;

  return (
    <AppShell>
      <main className="page home screen-enter">
        <section className="home-hero">
          <div className="hero-copy">
            <p className="eyebrow">Traditional card games, online with friends</p>
            <h1 className="hero-title display">Pull up a chair.</h1>
            <p className="hero-lead">Taash is a card room for the games you learned at family gatherings and on long afternoons. Share a table code, deal in your friends, and play in the browser.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" href="/games/thulla">Play Thulla</Link>
              <Link className="btn btn-lg" href="/join"><Icon id="i-hand" />Join with a code</Link>
            </div>
          </div>
          <HeroCards />
        </section>

        <section className="welcome panel">
          <div className="welcome-me">
            <Avatar person={{ name: viewer.kind === 'anon' ? 'Guest' : viewer.name, guest: !user }} size="lg" status={viewer.kind === 'anon' ? null : 'on'} />
            <div>
              <p className="faint">{user ? 'Welcome back' : viewer.kind === 'guest' ? 'Playing as a guest' : 'Not signed in'}</p>
              <h2 className="welcome-name">{name}</h2>
              {user
                ? <p className="muted">Member since {monthYear(me.createdAt)}</p>
                : <p className="muted">Guests can create and join tables freely. <Link className="link-btn" href="/register">Create an account</Link> or <Link className="link-btn" href="/signin">sign in</Link> to keep a rating and history.</p>}
            </div>
          </div>
          {user ? (
            <dl className="welcome-stats">
              <div><dt>Thulla rating</dt><dd className="num">{r.rating}{change ? <span className={'delta ' + (change >= 0 ? 'up' : 'down')}>{(change >= 0 ? '+' : '') + change}</span> : null}</dd></div>
              <div><dt>Winning streak</dt><dd className="num">{r.winStreak}</dd></div>
              <div><dt>Games played</dt><dd className="num">{r.played}</dd></div>
            </dl>
          ) : <div />}
          <div className="welcome-friends">
            {user ? <>
              <p className="faint">{plural(online.length, 'friend')} online</p>
              <div className="av-stack">{online.slice(0, 5).map(p => <Avatar key={p.id} person={p} size="sm" status="on" />)}</div>
            </> : null}
            <Link className="btn btn-sm" href="/friends"><Icon id="i-users" />Friends</Link>
          </div>
        </section>

        <div className="home-grid">
          <div className="home-main">
            <div className="section-head"><h2 className="section-title">Choose a game</h2><p className="muted">Thulla is open. More tables are on the way.</p></div>
            <article className="game-feature">
              <Link href="/games/thulla" className="gf-art" aria-label="Open Thulla"><MiniTable youName={viewer.kind === 'anon' ? 'You' : viewer.name} /></Link>
              <div className="gf-copy">
                <div className="gf-tags"><span className="chip chip-gold">Now playing</span><span className="chip">Pakistani classic</span></div>
                <h3 className="gf-name"><Link href="/games/thulla" className="display gf-link">Thulla</Link><span className="urdu" lang="ur">{thulla.urdu}</span></h3>
                <p className="gf-tagline">{thulla.tagline}</p>
                <p className="muted">Shed your hand before everyone else. Follow the shape when you can — when you can’t, slap down a Thulla and make the highest card pick up the pile.</p>
                <ul className="gf-facts">
                  <li><Icon id="i-users" />2+ players · 4 is classic</li>
                  <li><Icon id="i-clock" />{thulla.duration}</li>
                  <li><Icon id="taash-mark" />{thulla.deck}</li>
                </ul>
                <div className="gf-actions">
                  <CreateTableButton gameId="thulla" />
                  <Link className="btn" href="/join">Join table</Link>
                  <Link className="btn btn-ghost" href="/games/thulla/rules"><Icon id="i-book" />How to play</Link>
                </div>
              </div>
            </article>
            <section className="workshop">
              <div className="section-head"><h2 className="section-title">In the workshop</h2><p className="muted">More games are being built for Taash. None of these can be played yet, and each will get its own rating when it opens.</p></div>
              <div className="workshop-grid">
                {catalog.filter(g => g.status === 'workshop').map(g => (
                  <article key={g.id} className="ws-card">
                    <div className="ws-glyphs" aria-hidden="true">{['S', 'H', 'D', 'C'].slice(0, 2 + (g.name.length % 3)).map(su => <svg key={su} className="i"><use href={'#suit-' + su} /></svg>)}</div>
                    <h3>{g.name}</h3><p className="muted">{g.tagline}</p>
                    <div className="ws-foot"><span className="chip chip-proto">Not yet playable</span><span className="faint">{g.players.min}+ players</span></div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="home-side">
            <div className="panel panel-pad lb-mini">
              <div className="section-head row"><h2 className="section-title">{user ? 'Friends leaderboard' : 'Leaderboard'}</h2><Link className="btn btn-sm btn-ghost" href="/leaderboard">View all</Link></div>
              <p className="faint small">Thulla · ranked by rating</p>
              {board.length ? (
                <ol className="lbm">{board.slice(0, 4).map(p => (
                  <li key={p.id} className={user && p.id === user.userId ? 'me' : undefined}><span className="rank num">{p.rank}</span><Avatar person={p} size="sm" /><span className="lbm-name">{user && p.id === user.userId ? 'You' : p.name}</span><b className="num">{p.rating}</b></li>
                ))}</ol>
              ) : <p className="muted small" style={{ marginTop: 12 }}>No rated games yet. Finish a game with an account to appear here.</p>}
            </div>
            <div className="panel panel-pad recent">
              <div className="section-head row"><h2 className="section-title">Recent tables</h2>{user ? <Link className="btn btn-sm btn-ghost" href="/profile">History</Link> : null}</div>
              {recent.length ? (
                <ul className="recent-list">{recent.map(t => (
                  <li key={t.id}>
                    <div><b>Thulla · {t.tableCode}</b><span className="faint">{timeAgo(t.endedAt)} · {t.playerCount} players · {plural(t.baaris, 'baari')}</span></div>
                    <div className="recent-res"><span><Icon id="i-trophy" />{t.winner ? (user && t.winner.userId === user.userId ? 'You' : firstName(t.winner.name)) : '—'}</span>{t.loser ? <span className="faint">holding: {user && t.loser.userId === user.userId ? 'You' : firstName(t.loser.name)}</span> : null}</div>
                  </li>
                ))}</ul>
              ) : <p className="muted small">Finished games will appear here.</p>}
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
