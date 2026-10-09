import Link from 'next/link';
import { AppShell } from '@/components/platform/AppShell';
import { ResetForm } from '@/components/platform/PasswordResetForms';
import { checkReset } from '@/lib/auth/password-reset';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

export default async function ResetPage({ searchParams }) {
  const { token = '' } = await searchParams;
  const account = await checkReset(String(token));
  return (
    <AppShell>
      <main className="page join-page screen-enter">
        <div className="page-head"><div><p className="eyebrow">Reset password</p><h1 className="page-title">{account ? 'Choose a new password' : 'This link has expired'}</h1></div></div>
        <div className="join-grid">
          {account ? <ResetForm token={String(token)} handle={account.handle} /> : (
            <section className="join-form panel" role="alert">
              <p className="muted">Reset links work once and expire after 30 minutes, and asking for a new one replaces the old one.</p>
              <Link className="btn btn-primary btn-block" href="/forgot">Send a new link</Link>
            </section>
          )}
          <aside className="join-side"><p className="muted small">Keep this page private: anyone with the link can set your password until it’s used.</p></aside>
        </div>
      </main>
    </AppShell>
  );
}
