/* Join a table by code. Friends' open tables are listed for signed-in players. */
import { AppShell } from '@/components/platform/AppShell';
import { Avatar } from '@/components/platform/Avatar';
import { Note } from '@/components/platform/controls';
import { JoinForm } from '@/components/platform/JoinForm';
import { UseCodeButton } from '@/components/platform/UseCodeButton';
import { getViewer } from '@/lib/auth/viewer';
import { friendIds } from '@/lib/db/social';
import { openTablesOf, publicTables } from '@/lib/server/live';
import { OpenRooms } from '@/components/platform/OpenRooms';
import { firstName } from '@/lib/client/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Join a table' };

export default async function JoinPage({ searchParams }) {
  const { code = '' } = await searchParams;
  const viewer = await getViewer();
  const open = viewer.kind === 'user' ? openTablesOf(await friendIds(viewer.userId)) : [];
  return (
    <AppShell>
      <main className="page join-page screen-enter">
        <div className="page-head"><div><p className="eyebrow">Join a table</p><h1 className="page-title">Got a code? Take a seat.</h1></div></div>
        <div className="join-grid">
          <JoinForm initialCode={String(code)} />
          <aside className="join-side">
            <h2 className="section-title">Friends’ open tables</h2>
            <p className="muted small">Tables your friends are hosting right now.</p>
            {open.length ? (
              <ul className="ft-list">{open.map(t => (
                <li key={t.code} className="ft">
                  <Avatar person={{ name: t.host.name }} status="on" />
                  <div><b>{firstName(t.host.name)}’s Thulla table</b><span className="faint num">{t.seated} of {t.seats} seats · code {t.code}</span></div>
                  <UseCodeButton code={t.code} />
                </li>
              ))}</ul>
            ) : <Note>{viewer.kind === 'user' ? 'None of your friends are hosting an open table right now.' : 'Sign in to see tables your friends are hosting.'}</Note>}
            <OpenRooms initial={publicTables()} compact />
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
