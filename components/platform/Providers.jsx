'use client';
/**
 * Client-side context: who the viewer is (decided on the server from signed
 * cookies) and the realtime connection used for table invites and presence.
 */
import { createContext, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/client/socket';
import { toast } from '@/lib/client/toast';

const ViewerCtx = createContext({ kind: 'anon' });
export const useViewer = () => useContext(ViewerCtx);

export function Providers({ viewer, children }) {
  const router = useRouter();
  useEffect(() => {
    if (viewer.kind !== 'user') return;                // guests connect only when they sit at a table
    const s = getSocket();
    const onInvite = inv => toast((inv.from?.name || 'A friend') + ' invited you to a Thulla table', {
      icon: 'i-users', duration: 9000, action: { label: 'Join', onClick: () => router.push('/t/' + inv.code) },
    });
    s.on('invite', onInvite);
    return () => { s.off('invite', onInvite); };
  }, [viewer.kind, router]);
  return <ViewerCtx.Provider value={viewer}>{children}</ViewerCtx.Provider>;
}
