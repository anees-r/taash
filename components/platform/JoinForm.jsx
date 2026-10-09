'use client';
/* Join a table by code, with an account or as a guest (display name only). */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Avatar } from './Avatar';
import { useViewer } from './Providers';
import { call, resetSocket } from '@/lib/client/socket';
import { setGuestName } from '@/lib/client/guest';
import { animate } from '@/lib/client/dom';
import { toast } from '@/lib/client/toast';

export function formatCode(v) {
  const raw = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return raw.length > 3 ? raw.slice(0, 3) + '-' + raw.slice(3) : raw;
}

/** @param {{initialCode?: string, onJoined?: (code:string) => void, codeLocked?: boolean}} p */
export function JoinForm({ initialCode = '', onJoined, codeLocked }) {
  const viewer = useViewer();
  const router = useRouter();
  const formRef = useRef(null);
  const [code, setCode] = useState(formatCode(initialCode));
  const [name, setName] = useState(viewer.kind === 'guest' ? viewer.name : '');
  const [codeErr, setCodeErr] = useState(null);
  const [nameErr, setNameErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const asGuest = viewer.kind !== 'user';

  async function submit(e) {
    e.preventDefault();
    let ok = true;
    if (asGuest && !name.trim()) { setNameErr('Enter a display name — it’s how the table will know you.'); ok = false; }
    if (!code.trim()) { setCodeErr('Enter the table code your host shared.'); ok = false; }
    if (!ok) { (asGuest && !name.trim() && code.trim() ? document.getElementById('join-name') : document.getElementById('join-code'))?.focus(); return; }
    setBusy(true);
    if (asGuest && (viewer.kind !== 'guest' || viewer.name !== name.trim())) {
      const r = await setGuestName(name.trim());
      if (r.error) { setBusy(false); setNameErr(r.error); return; }
      resetSocket();
    }
    const res = await call('table:join', { code });
    setBusy(false);
    if (res.error) {
      setCodeErr(res.error);
      document.getElementById(res.code === 'name-taken' ? 'join-name' : 'join-code')?.focus();
      if (res.code === 'name-taken') { setNameErr(res.error); setCodeErr(null); }
      animate(formRef.current, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 300, fill: 'none' });
      return;
    }
    const joined = res.snapshot.code;
    if (onJoined) onJoined(joined, res.snapshot);
    else { toast('You joined table ' + joined); router.push('/t/' + joined); router.refresh(); }
  }

  return (
    <form ref={formRef} className="join-form panel" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="join-code">Table code</label>
        <input className={'input code' + (codeErr ? ' invalid' : '')} id="join-code" placeholder="ABC-123" maxLength={8} autoComplete="off" autoCapitalize="characters" spellCheck="false"
          aria-describedby="join-code-hint join-code-err" data-autofocus={!codeLocked ? true : undefined} readOnly={codeLocked}
          value={code} onChange={e => { setCode(formatCode(e.target.value)); setCodeErr(null); }} />
        <span className="hint" id="join-code-hint">Ask the host for the six-character code, like QAF-7R2.</span>
        {codeErr ? <p className="error" id="join-code-err" role="alert">{codeErr}</p> : null}
      </div>
      <div className="join-as">
        <Avatar person={{ name: asGuest ? (name || 'Guest') : viewer.name, guest: asGuest }} size="sm" />
        <div>
          <b>{asGuest ? 'Joining as a guest' : 'Joining as ' + viewer.name}</b>
          <span className="faint">{asGuest ? 'Guests play the full game. Ratings need an account.' : 'Your result counts toward your Thulla rating.'}</span>
        </div>
        {asGuest ? <Link className="btn btn-sm btn-ghost" href={'/signin?next=' + encodeURIComponent(code ? '/t/' + code : '/join')}>Sign in instead</Link> : null}
      </div>
      {asGuest ? (
        <div className="field">
          <label htmlFor="join-name">Display name</label>
          <input className={'input' + (nameErr ? ' invalid' : '')} id="join-name" placeholder="e.g. Rimsha" maxLength={24} autoComplete="nickname" aria-describedby="join-name-err"
            data-autofocus={codeLocked ? true : undefined} value={name} onChange={e => { setName(e.target.value); setNameErr(null); }} />
          <span className="hint">Shown at the table and in chat. No account or email needed.</span>
          {nameErr ? <p className="error" id="join-name-err" role="alert">{nameErr}</p> : null}
        </div>
      ) : null}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join table'}</button>
    </form>
  );
}
