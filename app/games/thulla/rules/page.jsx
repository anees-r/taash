import { AppShell } from '@/components/platform/AppShell';
import { Crumbs } from '@/components/platform/controls';
import { CreateTableButton } from '@/components/platform/CreateTable';
import { Guide } from '@/games/thulla/client/Guide';

export const metadata = { title: 'How to play Thulla' };

export default function RulesPage() {
  return (
    <AppShell>
      <main className="page guide-page screen-enter">
        <Crumbs items={[{ label: 'Games', href: '/' }, { label: 'Thulla', href: '/games/thulla' }, { label: 'How to play' }]} />
        <div className="page-head">
          <div><h1 className="page-title">How to play Thulla</h1><p className="muted">Twelve short sections. Ten minutes to read, one game to learn.</p></div>
          <CreateTableButton gameId="thulla" className="btn btn-primary">Create a table</CreateTableButton>
        </div>
        <Guide />
      </main>
    </AppShell>
  );
}
