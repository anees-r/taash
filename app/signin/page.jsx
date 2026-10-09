import { redirect } from 'next/navigation';
import { AppShell } from '@/components/platform/AppShell';
import { SignInForm } from '@/components/platform/AuthForms';
import { getViewer } from '@/lib/auth/viewer';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }) {
  const { next = '/', changed, reset } = await searchParams;
  if ((await getViewer()).kind === 'user') redirect(typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  return (
    <AppShell>
      <main className="page join-page screen-enter">
        <div className="page-head"><div><p className="eyebrow">Welcome back</p><h1 className="page-title">Sign in to Taash</h1></div></div>
        <div className="join-grid">
          <SignInForm next={String(next)} notice={reset ? 'Your password was reset. Sign in with your new password.' : changed ? 'Your password was changed. Sign in again on this device.' : null} />
          <aside className="join-side">
            <h2 className="section-title">Why an account?</h2>
            <ul className="rule-list muted">
              <li>A Thulla rating and finishing history.</li>
              <li>Winning and losing streaks.</li>
              <li>Friends, invitations and the friends leaderboard.</li>
            </ul>
            <p className="muted small">Guests can always create and join tables without one.</p>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
