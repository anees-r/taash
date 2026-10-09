/** Public tables with an open seat, for the "Open rooms" list. Read from the live table manager. */
import { NextResponse } from 'next/server';
import { publicTables } from '@/lib/server/live';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ rooms: publicTables() }, { headers: { 'cache-control': 'no-store' } });
}
