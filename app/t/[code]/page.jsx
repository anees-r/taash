import { TableClient } from '@/components/platform/TableClient';
import { getViewer } from '@/lib/auth/viewer';
import { getRating } from '@/lib/db/social';
import { normalizeCode } from '@/lib/game-engine/table-manager';
import { config } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { code } = await params;
  return { title: 'Table ' + normalizeCode(code), description: 'Join this Thulla table on Taash.' };
}

export default async function TablePage({ params }) {
  const { code: raw } = await params;
  const code = normalizeCode(decodeURIComponent(raw));
  const viewer = await getViewer();
  const rating = viewer.kind === 'user' ? (await getRating(viewer.userId)).rating : null;
  return <TableClient key={code + ':' + (viewer.playerId || 'anon')} code={code} rating={rating} appUrl={config.appUrl} />;
}
