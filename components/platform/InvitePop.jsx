'use client';
/* Live notifications that need an answer (table invites, friend requests): cards that drop in at the top and glow. */
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

const SHOW_MS = 30_000;

export function InvitePop({ invites, onJoin, onDismiss, onFriend }) {
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!invites.length) return;
    const latest = invites[invites.length - 1];
    const t = setTimeout(() => onDismiss(latest.key), SHOW_MS);
    return () => clearTimeout(t);
  }, [invites, onDismiss]);
  if (!invites.length) return null;
  return (
    <div className="invite-pops" role="region" aria-label="Notifications">
      {invites.map(inv => (
        <section key={inv.key} className={'invite-pop' + (inv.kind === 'friend' ? ' is-friend' : '')} role="alertdialog" aria-labelledby={'inv-' + inv.key}>
          <span className="ip-glow" aria-hidden="true" />
          <Avatar person={{ name: inv.from?.name || 'Friend' }} size="lg" status="on" />
          {inv.kind === 'friend' ? (
            <div className="ip-text">
              <span className="eyebrow">Friend request</span>
              <b id={'inv-' + inv.key}>{inv.from?.name || 'Someone'} wants to be friends</b>
              {inv.from?.handle ? <span className="faint">@{inv.from.handle}</span> : null}
            </div>
          ) : (
            <div className="ip-text">
              <span className="eyebrow">Table invite</span>
              <b id={'inv-' + inv.key}>{inv.from?.name || 'A friend'} invited you to play Thulla</b>
              <span className="faint num">Table {inv.code}</span>
            </div>
          )}
          <div className="ip-actions">
            {inv.kind === 'friend' ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy === inv.key} onClick={async () => { setBusy(inv.key); await onFriend(inv, true); setBusy(null); }} data-autofocus><Icon id="i-check" />Accept</button>
                <button type="button" className="btn btn-ghost" disabled={busy === inv.key} onClick={async () => { setBusy(inv.key); await onFriend(inv, false); setBusy(null); }}>Decline</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => onJoin(inv)} data-autofocus><Icon id="i-hand" />Join</button>
                <button type="button" className="btn btn-ghost" onClick={() => onDismiss(inv.key)}>Not now</button>
              </>
            )}
          </div>
          <span className="ip-timer" aria-hidden="true" style={{ animationDuration: SHOW_MS + 'ms' }} />
        </section>
      ))}
    </div>
  );
}
