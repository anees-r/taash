'use client';
/* Sign-in and registration forms (styled like the prototype's join form). */
import Link from 'next/link';
import { useActionState } from 'react';
import { registerAction, signInAction } from '@/app/actions/auth';

function Field({ id, label, error, hint, ...input }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input className={'input' + (error ? ' invalid' : '')} id={id} name={id} aria-invalid={error ? 'true' : undefined} {...input} />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function SignInForm({ next, notice }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="join-form panel" noValidate>
      {notice ? <p className="hint" role="status">{notice}</p> : null}
      <input type="hidden" name="next" value={next || '/'} />
      <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue={state?.values?.email} data-autofocus error={state?.error} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required error={state?.error} />
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      <p className="muted small">New here? <Link href={'/register' + (next ? '?next=' + encodeURIComponent(next) : '')}>Create an account</Link> — or just <Link href="/join">join a table as a guest</Link>.</p>
    </form>
  );
}

export function RegisterForm({ next }) {
  const [state, action, pending] = useActionState(registerAction, null);
  const v = state?.values || {};
  const err = f => (state?.field === f ? state.error : null);
  return (
    <form action={action} className="join-form panel" noValidate>
      <input type="hidden" name="next" value={next || '/'} />
      <Field id="name" label="Display name" autoComplete="nickname" maxLength={24} required defaultValue={v.name} data-autofocus error={err('name')} hint="Shown at tables, in chat and on leaderboards." />
      <Field id="handle" label="Handle" autoComplete="username" maxLength={20} required defaultValue={v.handle} error={err('handle')} hint="Friends add you by @handle. Letters, numbers, dots and underscores." />
      <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue={v.email} error={err('email')} hint="Used only to sign in." />
      <Field id="password" label="Password" type="password" autoComplete="new-password" minLength={8} required error={err('password')} hint="At least 8 characters." />
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>{pending ? 'Creating your account…' : 'Create account'}</button>
      <p className="muted small">Already have an account? <Link href={'/signin' + (next ? '?next=' + encodeURIComponent(next) : '')}>Sign in</Link></p>
    </form>
  );
}
