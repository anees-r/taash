/* Shop and rank rewards: table designs and card designs. */
import Link from 'next/link';
import { AppShell } from '@/components/platform/AppShell';
import { ShopView } from '@/components/platform/ShopView';
import { getViewer } from '@/lib/auth/viewer';
import { cosmeticsState } from '@/lib/db/cosmetics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shop & rank rewards' };

export default async function ShopPage() {
  const viewer = await getViewer();
  if (viewer.kind !== 'user') {
    return (
      <AppShell>
        <main className="page shop-page screen-enter">
          <div className="page-head"><div><p className="eyebrow">Shop & rank rewards</p><h1 className="page-title">Make the table yours.</h1></div></div>
          <section className="panel panel-pad" style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
            <p className="muted">Table designs and card designs. Earn coins in ranked games to buy them, and unlock rank rewards as your rating climbs. Everyone at your table sees them.</p>
            <div className="row-gap wrap"><Link className="btn btn-primary" href="/register?next=/shop">Create a free account</Link><Link className="btn" href="/signin?next=/shop">Sign in</Link></div>
          </section>
        </main>
      </AppShell>
    );
  }
  const state = await cosmeticsState(viewer.userId);
  return <AppShell><ShopView state={state} /></AppShell>;
}
