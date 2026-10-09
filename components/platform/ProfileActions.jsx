'use client';
/* Edit profile (display name), change password, sign out everywhere. */
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { updateProfileAction, changePasswordAction, signOutEverywhereAction } from '@/app/actions/auth';
import { resetSocket } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';

export function OwnProfileActions({ name }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link className="btn" href="/friends"><Icon id="i-users" />Friends</Link>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Edit profile</button>
      <EditProfile open={open} name={name} onClose={() => setOpen(false)} />
    </>
  );
}

function EditProfile({ open, name, onClose }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateProfileAction, null);
  const [pw, pwAction, pwPending] = useActionState(changePasswordAction, null);
  useEffect(() => { if (state?.ok) { toast('Profile saved'); resetSocket(); router.refresh(); onClose(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Edit profile" subtitle="Your display name shows at tables, in chat and on leaderboards.">
      <form action={action} className="field" style={{ gap: 10 }}>
        <label htmlFor="pf-name">Display name</label>
        <input className={'input' + (state?.error ? ' invalid' : '')} id="pf-name" name="name" defaultValue={name} maxLength={24} required data-autofocus />
        {state?.error ? <span className="error" role="alert">{state.error}</span> : null}
        <div><button className="btn btn-primary" type="submit" disabled={pending}>Save name</button></div>
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
