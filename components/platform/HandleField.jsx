'use client';
/* Username input with a live "available / taken" check while typing. The server checks again on save. */
import { useEffect, useRef, useState } from 'react';
import { checkHandleAction } from '@/app/actions/auth';
import { Icon } from './Icon';

export function HandleField({ id = 'handle', label = 'Username', defaultValue = '', current = null, error, hint, autoFocus }) {
  const [value, setValue] = useState(defaultValue || '');
  const [status, setStatus] = useState(null);     // null | {checking} | {available, handle} | {error}
  const seq = useRef(0);

  useEffect(() => {
    const v = value.trim().replace(/^@/, '');
    if (!v || (current && v.toLowerCase() === current.toLowerCase())) { setStatus(null); return; }
    const n = ++seq.current;
    setStatus({ checking: true });
    const t = setTimeout(async () => {
      const r = await checkHandleAction(v).catch(() => null);
      if (n !== seq.current) return;                      // a newer keystroke won
      setStatus(!r ? null : r.ok ? { available: r.available, handle: r.handle } : { error: r.error });
    }, 400);
    return () => clearTimeout(t);
  }, [value, current]);

  const bad = error || status?.error || (status && status.available === false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="handle-wrap">
        <span className="handle-at" aria-hidden="true">@</span>
        <input className={'input' + (bad ? ' invalid' : '')} id={id} name="handle" value={value} onChange={e => setValue(e.target.value.replace(/\s/g, '').replace(/^@+/, ''))}
          autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={21} required data-autofocus={autoFocus || undefined}
          aria-invalid={bad ? 'true' : undefined} aria-describedby={id + '-status'} />
      </div>
      <span id={id + '-status'} className="handle-status" aria-live="polite">
        {status?.checking ? <span className="faint">Checking…</span>
          : status?.error ? <span className="error">{status.error}</span>
          : status?.available === true ? <span className="ok"><Icon id="i-check" />@{status.handle} is available</span>
          : status?.available === false ? <span className="error">@{status.handle} is taken. Try another.</span>
          : hint ? <span className="hint">{hint}</span> : null}
      </span>
    </div>
  );
}
