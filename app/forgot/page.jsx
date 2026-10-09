import { redirect } from 'next/navigation';
import { AppShell } from '@/components/platform/AppShell';
import { ForgotForm } from '@/components/platform/PasswordResetForms';
import { getViewer } from '@/lib/auth/viewer';

export const metadata = { title: 'Forgot password' };

export default async function ForgotPage() {
  if ((await getViewer()).kind === 'user') redirect('/profile');
  return (
    <AppShell>
      <main className="page join-page screen-enter">
        <div className="page-head"><div><p className="eyebrow">Forgot password</p><h1 className="page-title">Locked out? It happens.</h1></div></div>
        <div className="join-grid">
          <ForgotForm />
          <aside className="join-side">
            <h2 className="section-title">How it works</h2>
            <ul className="rule-list muted">
              <li>We email a link to the address on your account.</li>
              <li>The link works once and expires in 30 minutes.</li>
              <li>Setting a new password signs you out everywhere.</li>
            </ul>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
