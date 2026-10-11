'use client';
/**
 * Client-side context: who the viewer is (decided on the server from signed
 * cookies), the table they're at (if any), and the realtime connection used
 * for table invites and presence.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket, setSocketIdentity } from '@/lib/client/socket';
import { playSound } from '@/lib/client/sound';
import { InvitePop } from './InvitePop';
import { toast } from '@/lib/client/toast';
import { quickRespondAction } from '@/app/actions/friends';
import { refreshRelations } from './AddFriendButton';

const ViewerCtx = createContext({ kind: 'anon' });
export const useViewer = () => useContext(ViewerCtx);

/** The table this person is seated at or watching, if any (one table at a time). */
const CurrentTableCtx = createContext(null);
export const useCurrentTable = () => useContext(CurrentTableCtx);
export function CurrentTableProvider({ value, children }) {
  return <CurrentTableCtx.Provider value={value}>{children}</CurrentTableCtx.Provider>;
}

let inviteKey = 0;

export function Providers({ viewer, children }) {
  const router = useRouter();
  const [invites, setInvites] = useState([]);
  if (typeof window !== 'undefined') setSocketIdentity(viewer.playerId || 'anon');
  useEffect(() => {
    if (viewer.kind !== 'user') return;                // guests connect only when they sit at a table
    const s = getSocket();
    const onInvite = inv => {
      setInvites(list => [...list.filter(x => x.kind === 'friend' || x.code !== inv.code), { ...inv, kind: 'invite', key: ++inviteKey }].slice(-3));
      playSound('invite');
      try { navigator.vibrate?.([80, 60, 80]); } catch { /* not supported */ }
    };
    const onFriendRequest = req => {
      setInvites(list => [...list.filter(x => x.kind !== 'friend' || x.id !== req.id), { ...req, kind: 'friend', key: ++inviteKey }].slice(-3));
      playSound('invite');
    };
    const onFriendAccepted = d => { refreshRelations(); toast((d.by?.name || 'Someone') + ' accepted your friend request.', { icon: 'i-users', duration: 5000 }); playSound('chime'); router.refresh(); };
    s.on('invite', onInvite);
    s.on('friend:request', onFriendRequest);
    s.on('friend:accepted', onFriendAccepted);
    return () => { s.off('invite', onInvite); s.off('friend:request', onFriendRequest); s.off('friend:accepted', onFriendAccepted); };
  }, [viewer.kind, router]);
  const dismiss = useCallback(key => setInvites(list => list.filter(x => x.key !== key)), []);
  const answerFriend = useCallback(async (req, accept) => {
    const r = await quickRespondAction(req.id, accept).catch(() => ({ error: 'You appear to be offline.' }));
    setInvites(list => list.filter(x => x.key !== req.key));
    if (accept && !r.error) refreshRelations();
    if (r.error) toast(r.error, { icon: 'i-info' });
    else { toast(accept ? 'You and ' + (req.from?.name || 'they') + ' are now friends.' : 'Request declined.', { icon: accept ? 'i-users' : 'i-check' }); router.refresh(); }
  }, [router]);
  const join = useCallback(inv => { setInvites(list => list.filter(x => x.key !== inv.key)); router.push('/t/' + inv.code); }, [router]);
  return (
    <ViewerCtx.Provider value={viewer}>
      {children}
      <InvitePop invites={invites} onJoin={join} onDismiss={dismiss} onFriend={answerFriend} />
    </ViewerCtx.Provider>
  );
}
