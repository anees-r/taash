/** The sound board's sounds: the MP3s in public/sounds. */
import { NextResponse } from 'next/server';
import { soundBoard } from '@/lib/sound-files';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ sounds: soundBoard() }, { headers: { 'cache-control': 'no-store' } });
}
