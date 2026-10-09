'use client';
/* Sign-in and registration forms (styled like the prototype's join form). */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { registerAction, signInAction } from '@/app/actions/auth';
import { Icon } from './Icon';
import { HandleField } from './HandleField';

function Field({ id, label, error, hint, ...input }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input className={'input' + (error ? ' invalid' : '')} id={id} name={id} aria-invalid={error ? 'true' : undefined} {...input} />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/** Password input with a show/hide toggle inside the box. */
export function PasswordField({ id, label, error, hint, ...input }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input className={'input' + (error ? ' invalid' : '')} id={id} name={id} type={shown ? 'text' : 'password'} aria-invalid={error ? 'true' : undefined}
          autoCapitalize="off" autoCorrect="off" spellCheck={false} {...input} />
        <button type="button" className="pw-toggle" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} aria-controls={id}
          title={shown ? 'Hide password' : 'Show password'} onClick={() => setShown(v => !v)}>
          <Icon id={shown ? 'i-eye-off' : 'i-eye'} />
        </button>
      </div>
      {typeof hint === 'string' ? <span className="hint">{hint}</span> : hint}
    </div>
  );
}

export function SignInForm({ next, notice }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="join-form panel" noValidate>
      {notice ? <p className="hint" role="status">{notice}</p> : null}
      <input type="hidden" name="next" value={next || '/'} />
      <Field id="login" label="Email or username" autoComplete="username" autoCapitalize="off" spellCheck={false} required defaultValue={state?.values?.login} data-autofocus error={state?.error} />
      <PasswordField id="password" label="Password" autoComplete="current-password" required error={state?.error} />
      <p className="small" style={{ marginTop: -6 }}><Link href="/forgot">Forgot your password?</Link></p>
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
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== pw;
  return (
    <form action={action} className="join-form panel" noValidate>
      <input type="hidden" name="next" value={next || '/'} />
      <Field id="name" label="Display name" autoComplete="nickname" maxLength={24} required defaultValue={v.name} data-autofocus error={err('name')} hint="Shown at tables, in chat and on leaderboards." />
      <HandleField id="handle" defaultValue={v.handle} error={err('handle')} hint="Unique. Friends add you by @username, and you can sign in with it." />
      <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue={v.email} error={err('email')} hint="Used only to sign in." />
      <PasswordField id="password" label="Password" autoComplete="new-password" minLength={8} required error={err('password')} hint="At least 8 characters."
        value={pw} onChange={e => setPw(e.target.value)} />
      <PasswordField id="confirm" label="Re-enter password" autoComplete="new-password" required error={mismatch || err('confirm')}
        value={confirm} onChange={e => setConfirm(e.target.value)}
        hint={mismatch ? <span className="error">Passwords don’t match.</span> : null} />
      {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending || mismatch}>{pending ? 'Creating your account…' : 'Create account'}</button>
      <p className="muted small">Already have an account? <Link href={'/signin' + (next ? '?next=' + encodeURIComponent(next) : '')}>Sign in</Link></p>
    </form>
  );
}
