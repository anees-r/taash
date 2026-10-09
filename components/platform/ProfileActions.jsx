'use client';
/* Edit profile (display name, username), change password, sign out everywhere. */
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { HandleField } from './HandleField';
import { updateProfileAction, changePasswordAction, signOutEverywhereAction } from '@/app/actions/auth';
import { resetSocket } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';

export function OwnProfileActions({ name, handle }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link className="btn" href="/friends"><Icon id="i-users" />Friends</Link>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Edit profile</button>
      <EditProfile open={open} name={name} handle={handle} onClose={() => setOpen(false)} />
    </>
  );
}

function EditProfile({ open, name, handle, onClose }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateProfileAction, null);
  const [pw, pwAction, pwPending] = useActionState(changePasswordAction, null);
  useEffect(() => {
    if (!state?.ok) return;
    toast('Profile saved');
    resetSocket();
    if (state.handle && state.handle !== handle && location.pathname.startsWith('/u/')) router.replace('/u/' + state.handle);
    router.refresh(); onClose();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Edit profile" subtitle="Your display name shows at tables, in chat and on leaderboards. Your username is how friends find you, and you can sign in with it.">
      <form action={action} className="profile-form">
        <div className="field">
          <label htmlFor="pf-name">Display name</label>
          <input className={'input' + (state?.field === 'name' ? ' invalid' : '')} id="pf-name" name="name" defaultValue={name} maxLength={24} required data-autofocus />
        </div>
        <HandleField id="pf-handle" defaultValue={handle} current={handle} error={state?.field === 'handle' ? state.error : null}
          hint="Letters, numbers, dots and underscores. Friends add you by @username." />
        {state?.error ? <span className="error" role="alert">{state.error}</span> : null}
        <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button></div>
      </form>
      <hr className="divider" />
      <form action={pwAction} className="field" style={{ gap: 10 }}>
        <span className="field-label">Change password</span>
        <input className="input" type="password" name="current" placeholder="Current password" autoComplete="current-password" aria-label="Current password" required />
        <input className="input" type="password" name="next" placeholder="New password (8+ characters)" autoComplete="new-password" aria-label="New password" minLength={8} required />
        {pw?.error ? <span className="error" role="alert">{pw.error}</span> : null}
        <span className="hint">Changing your password signs you out on every device.</span>
        <div><button className="btn" type="submit" disabled={pwPending}>Change password</button></div>
      </form>
      <hr className="divider" />
      <form action={signOutEverywhereAction} onSubmit={() => resetSocket()}>
        <p className="hint" style={{ marginBottom: 8 }}>Lost a phone or used a shared computer? End every session for this account.</p>
        <button className="btn btn-danger" type="submit">Sign out everywhere</button>
      </form>
    </Modal>
  );
}
