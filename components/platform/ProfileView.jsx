/* Profile (rating card, streaks, totals, finishing history) — the prototype's layout with real data. */
import Link from 'next/link';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { catalog } from '@/games/catalog';
import { ordinal, plural, timeAgo, monthYear } from '@/lib/client/format';

function Sparkline({ pts }) {
  if (pts.length < 2) return null;
  const W = 200, Hh = 64, pad = 6;
  const min = Math.min(...pts) - 5, max = Math.max(...pts) + 5;
  const x = i => pad + i * (W - pad * 2) / (pts.length - 1), y = v => Hh - pad - (v - min) / (max - min) * (Hh - pad * 2);
  const d = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = d + ` L ${x(pts.length - 1)} ${Hh} L ${x(0)} ${Hh} Z`;
  return (
    <div className="spark-wrap">
      <svg viewBox={`0 0 ${W} ${Hh}`} className="spark" role="img" aria-label={`Rating trend over the last ${pts.length - 1} games, from ${pts[0]} to ${pts[pts.length - 1]}`}>
        <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d6b06a" stopOpacity=".35" /><stop offset="1" stopColor="#d6b06a" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#spk)" /><path d={d} fill="none" stroke="#d6b06a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill="#ead197" />
      </svg>
    </div>
  );
}

/** @param {{user:any, rating:any, change:number, history:any[], trend:number[], friendsCount:number, own:boolean, actions?:any}} p */
export function ProfileView({ user, rating: r, change, history, trend, friendsCount, own, actions }) {
  return (
    <main className="page profile-page screen-enter">
      <section className="profile-head">
        <Avatar person={{ name: user.name }} size="xl" status={user.online ? 'on' : null} />
        <div className="ph-text"><h1 className="page-title">{user.name}</h1><p className="muted">@{user.handle} · member since {monthYear(user.createdAt)}{friendsCount != null ? ' · ' + plural(friendsCount, 'friend') : ''}</p></div>
        <div className="row-gap">{actions}</div>
      </section>
      <div className="tabs" role="tablist" aria-label="Game">
        {catalog.map(g => <button key={g.id} type="button" role="tab" aria-selected={String(g.id === 'thulla')} disabled={g.status !== 'playable'} title={g.status !== 'playable' ? g.name + ' is not playable yet — no rating exists' : undefined}>{g.name}{g.status !== 'playable' ? <span className="tab-soon"> · soon</span> : null}</button>)}
      </div>
      <div className="profile-grid">
        <section className="panel panel-pad rating-card">
          <div className="rc-top">
            <div><p className="eyebrow">Thulla rating</p><div className="rc-num display num">{r.rating}</div><p className="faint small">Peak {r.peak} · {(change >= 0 ? '+' : '') + change} in 30 days</p></div>
            <Sparkline pts={trend} />
          </div>
          <p className="faint small">Each game keeps its own rating. A Thulla rating will not carry over to Rung, Bluff or Seep when they open.</p>
        </section>
        <section className="panel panel-pad streaks">
          <div className="streak win"><span className="eyebrow">Current winning streak</span><b className="display num">{r.winStreak}</b><span className="faint">{r.winStreak === 1 ? 'game finished 1st in a row' : 'games finished 1st in a row'}</span></div>
          <div className="streak lose"><span className="eyebrow">Current losing streak</span><b className="display num">{r.loseStreak}</b><span className="faint">{r.loseStreak === 1 ? 'game left holding the cards' : 'games left holding the cards'}</span></div>
        </section>
        <section className="panel panel-pad totals">
          <dl className="stat-grid">
            <div><dt>Games played</dt><dd className="num">{r.played}</dd></div>
            <div><dt>Finished 1st</dt><dd className="num">{r.firsts}</dd></div>
            <div><dt>Held the cards</dt><dd className="num">{r.losses}</dd></div>
            <div><dt>1st-place rate</dt><dd className="num">{r.played ? Math.round(r.firsts / r.played * 100) + '%' : '—'}</dd></div>
          </dl>
        </section>
      </div>
      <section className="panel panel-pad history">
        <div className="section-head row"><h2 className="section-title">Finishing history</h2><span className="faint small">Most recent first</span></div>
        {history.length ? (
          <div className="table-scroll"><table className="hist-table">
            <thead><tr><th>When</th><th>Finish</th><th>Table</th><th>Played with</th><th className="r">Baaris</th><th className="r">Rating</th></tr></thead>
            <tbody>{history.map(g => (
              <tr key={g.matchId} className={g.isLoser ? 'lost' : g.place === 1 ? 'won' : undefined}>
                <td>{timeAgo(g.endedAt)}</td>
                <td><span className={'place-pill' + (g.place === 1 ? ' gold' : g.isLoser ? ' held' : '')}>{g.isLoser ? 'Held cards' : ordinal(g.place)}</span><span className="faint"> of {g.playerCount}</span></td>
                <td className="num">{g.tableCode}</td>
                <td><div className="av-stack sm" title={g.with.map(w => w.name).join(', ')}>{g.with.slice(0, 5).map((w, i) => <Avatar key={i} person={w} size="sm" />)}</div></td>
                <td className="r num">{g.baaris ?? '—'}</td>
                <td className="r num">{g.delta != null ? <span className={'delta ' + (g.delta >= 0 ? 'up' : 'down')}>{(g.delta >= 0 ? '+' : '') + g.delta}</span> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">{own ? 'Your finished games will appear here.' : 'No finished games yet.'} {own ? <Link href="/games/thulla">Start a table</Link> : null}</p>}
      </section>
    </main>
  );
}

export function GuestProfile({ name }) {
  return (
    <main className="page profile-page screen-enter">
      <section className="panel panel-pad guest-profile">
        <Avatar person={{ name: name || 'Guest', guest: true }} size="xl" />
        <div>
          <p className="eyebrow">Guest</p><h1 className="page-title">{name || 'Guest'}</h1>
          <p className="muted">You can create tables, join with a code, chat and play every game as a guest. An account adds friends, a rating for each game, and your finishing history.</p>
          <div className="row-gap wrap"><Link className="btn btn-primary" href="/register">Create an account</Link><Link className="btn" href="/signin"><Icon id="i-user" />Sign in</Link></div>
        </div>
      </section>
    </main>
  );
}
