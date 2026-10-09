'use client';
/* "Forgot password" request form and the "choose a new password" form behind the emailed link. */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { requestPasswordResetAction, resetPasswordAction } from '@/app/actions/password-reset';
import { PasswordField } from './AuthForms';
import { Icon } from './Icon';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, null);
  if (state?.ok) {
    return (
      <section className="join-form panel" role="status">
        <span className="sent-icon" aria-hidden="true"><Icon id="i-send" /></span>
        <h2 className="section-title">Check your email</h2>
        <p className="muted">If that matches a Taash account, we’ve sent a link to choose a new password. It works once and expires in 30 minutes.</p>
        <p className="muted small">Nothing arrived? Check spam, or <button type="button" className="link-btn" onClick={() => location.reload()}>try again</button> in a few minutes.</p>
        <Link className="btn btn-block" href="/signin">Back to sign in</Link>
      </section>
    );
  }
  return (
    <form action={action} className="join-form panel" noValidate>
      <p className="muted">Enter the email or username on your account and we’ll email you a link to choose a new password.</p>
      <div className="field">
        <label htmlFor="login">Email or username</label>
        <input className={'input' + (state?.error ? ' invalid' : '')} id="login" name="login" autoComplete="username" autoCapitalize="off" spellCheck={false}
          defaultValue={state?.values?.login} required data-autofocus />
      </div>
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Email me a link'}</button>
      <p className="muted small">Remembered it? <Link href="/signin">Sign in</Link></p>
    </form>
  );
}

export function ResetForm({ token, handle }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== pw;
  if (state?.expired) {
    return (
      <section className="join-form panel" role="alert">
        <h2 className="section-title">This link has expired</h2>
        <p className="muted">{state.error}</p>
        <Link className="btn btn-primary btn-block" href="/forgot">Send a new link</Link>
      </section>
    );
  }
  return (
    <form action={action} className="join-form panel" noValidate>
      <input type="hidden" name="token" value={token} />
      <p className="muted">Choose a new password for <b>@{handle}</b>. This signs you out on every device.</p>
      <PasswordField id="password" label="New password" autoComplete="new-password" minLength={8} required data-autofocus hint="At least 8 characters."
        error={state?.field === 'password'} value={pw} onChange={e => setPw(e.target.value)} />
      <PasswordField id="confirm" label="Re-enter new password" autoComplete="new-password" required error={mismatch || state?.field === 'confirm'}
        value={confirm} onChange={e => setConfirm(e.target.value)} hint={mismatch ? <span className="error">Passwords don’t match.</span> : null} />
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending || mismatch}>{pending ? 'Saving…' : 'Set new password'}</button>
    </form>
  );
}
