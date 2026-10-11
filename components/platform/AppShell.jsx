/** Page chrome (top bar, current-table banner, footer, phone bottom nav) around every platform screen. Server component. */
import Link from 'next/link';
import { getViewer } from '@/lib/auth/viewer';
import { getRating } from '@/lib/db/social';
import { coinBalance } from '@/lib/db/cosmetics';
import { tableOf } from '@/lib/server/live';
import { TopBar, BottomNav } from './TopBar';
import { SiteFooter } from './SiteFooter';
import { CurrentTableProvider } from './Providers';
import { Icon } from './Icon';

export async function AppShell({ children }) {
  const viewer = await getViewer();
  const [rating, coins] = viewer.kind === 'user' ? await Promise.all([getRating(viewer.userId).then(r => r.rating), coinBalance(viewer.userId)]) : [null, null];
  const v = viewer.kind === 'anon' ? { kind: 'anon' } : { kind: viewer.kind, name: viewer.name, handle: viewer.handle };
  const current = viewer.kind === 'anon' ? null : tableOf(viewer.playerId);
  return (
    <CurrentTableProvider value={current}>
      <div className="app has-bottom-nav">
        <TopBar viewer={v} rating={rating} coins={coins} />
        {current ? <CurrentTableBanner t={current} /> : null}
        {children}
        <SiteFooter />
        <BottomNav />
      </div>
    </CurrentTableProvider>
  );
}

function CurrentTableBanner({ t }) {
  const text = t.status === 'playing'
    ? (t.role === 'spectator' ? 'You’re watching a game at table ' : 'You’re in a game at table ')
    : (t.role === 'spectator' ? 'You’re watching table ' : t.host ? 'You’re hosting table ' : 'You’re seated at table ');
  return (
    <div className={'current-table' + (t.status === 'playing' ? ' live' : '')} role="status">
      <span className="ct-dot" aria-hidden="true" />
      <span>{text}<b className="num">{t.code}</b>{t.status === 'playing' ? '' : ' · ' + t.seated + ' of ' + t.seats + ' seats'}</span>
      <Link className="btn btn-sm btn-primary" href={'/t/' + t.code}><Icon id="i-hand" />{t.status === 'playing' ? 'Return to game' : 'Return to table'}</Link>
    </div>
  );
}
