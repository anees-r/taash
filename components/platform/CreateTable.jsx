'use client';
/**
 * "Create a table" — the prototype's modal: optional guest display name,
 * the game's settings form, then the server creates the table and you land
 * in its lobby.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { useViewer } from './Providers';
import { clientGames } from '@/games/client-registry';
import { gameMeta } from '@/games/catalog';
import { call, resetSocket } from '@/lib/client/socket';
import { setGuestName } from '@/lib/client/guest';
import { toast } from '@/lib/client/toast';

export function CreateTableButton({ gameId = 'thulla', className = 'btn btn-primary', children = 'Create table', autoFocus }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} data-autofocus={autoFocus ? true : undefined} onClick={() => setOpen(true)}>{children}</button>
      {open ? <CreateTableModal gameId={gameId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreateTableModal({ gameId, onClose }) {
  const viewer = useViewer();
  const router = useRouter();
  const game = clientGames[gameId];
  const meta = gameMeta(gameId);
  const [settings, setSettings] = useState(game.defaultSettings());
  const [valid, setValid] = useState(true);
  const [name, setName] = useState(viewer.kind === 'guest' ? viewer.name : '');
  const [nameErr, setNameErr] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsName = viewer.kind !== 'user';

  async function create() {
    setErr(null);
    if (needsName) {
      if (!name.trim()) { setNameErr('Enter a display name so players know who is hosting.'); document.getElementById('ct-name')?.focus(); return; }
      setBusy(true);
      const r = await setGuestName(name.trim());
      if (r.error) { setBusy(false); setNameErr(r.error); return; }
      if (viewer.kind !== 'guest' || viewer.name !== name.trim()) resetSocket();
    }
    setBusy(true);
    const res = await call('table:create', { gameId, settings });
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onClose();
    toast('Table ' + res.code + ' is open');
    router.push('/t/' + res.code);
    router.refresh();
  }

  return (
    <Modal open onClose={onClose} wide eyebrow={meta.name} title="Create a table" subtitle="Set the table, then invite friends or share the code."
      footer={<>
        {err ? <span className="error" role="alert" style={{ marginRight: 'auto', color: 'var(--rose-300)', fontSize: 'var(--fs-xs)', fontWeight: 600, alignSelf: 'center' }}>{err}</span> : null}
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={create}>{busy ? 'Opening…' : 'Create table'}</button>
      </>}>
      {needsName ? (
        <div className="field">
          <label htmlFor="ct-name">Your display name</label>
          <input className={'input' + (nameErr ? ' invalid' : '')} id="ct-name" value={name} placeholder="How friends will see you" maxLength={24} autoComplete="nickname"
            onChange={e => { setName(e.target.value); setNameErr(null); }} />
          <span className="hint">You’re hosting as a guest. No account needed.</span>
          {nameErr ? <span className="error" id="ct-name-err">{nameErr}</span> : null}
        </div>
      ) : (
        <div className="host-line"><Avatar person={{ name: viewer.name }} size="sm" /><span>Hosting as <b>{viewer.name}</b></span><span className="chip chip-gold"><Icon id="i-crown" />Host</span></div>
      )}
      <game.SettingsForm value={settings} onChange={(s, ok) => { setSettings(s); setValid(ok); }} />
    </Modal>
  );
}
