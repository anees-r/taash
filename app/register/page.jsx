import { redirect } from 'next/navigation';
import { AppShell } from '@/components/platform/AppShell';
import { RegisterForm } from '@/components/platform/AuthForms';
import { getViewer } from '@/lib/auth/viewer';

export const metadata = { title: 'Create an account' };

export default async function RegisterPage({ searchParams }) {
  const { next = '/' } = await searchParams;
  if ((await getViewer()).kind === 'user') redirect('/');
  return (
    <AppShell>
      <main className="page join-page screen-enter">
        <div className="page-head"><div><p className="eyebrow">Create an account</p><h1 className="page-title">Keep your seat at the table.</h1></div></div>
        <div className="join-grid">
          <RegisterForm next={String(next)} />
          <aside className="join-side">
            <h2 className="section-title">What you get</h2>
            <ul className="rule-list muted">
              <li>A rating for each game, starting at 1500.</li>
              <li>Your finishing history and streaks.</li>
              <li>Friends, invitations and leaderboards.</li>
            </ul>
            <p className="muted small">Your password is stored only as an Argon2 hash.</p>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
