/** Page chrome (top bar + phone bottom nav) around every platform screen. Server component. */
import { getViewer } from '@/lib/auth/viewer';
import { getRating } from '@/lib/db/social';
import { TopBar, BottomNav } from './TopBar';
import { SiteFooter } from './SiteFooter';

export async function AppShell({ children }) {
  const viewer = await getViewer();
  const rating = viewer.kind === 'user' ? (await getRating(viewer.userId)).rating : null;
  const v = viewer.kind === 'anon' ? { kind: 'anon' } : { kind: viewer.kind, name: viewer.name, handle: viewer.handle };
  return (
    <div className="app has-bottom-nav">
      <TopBar viewer={v} rating={rating} />
      {children}
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
