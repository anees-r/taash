/**
 * Set or rename the guest identity (signed httpOnly cookie). The guest id is
 * kept across renames so a guest keeps their seat when reconnecting.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { GUEST_COOKIE, decodeGuest, encodeGuest, newGuestId, guestCookieOptions } from '@/lib/auth/guest';
import { createLimiter } from '@/lib/rate-limit';
import { config } from '@/lib/env';

const g = globalThis;
const limit = g.__taashGuestLimiter || (g.__taashGuestLimiter = createLimiter({ capacity: 10, perSecond: 0.1 }));
const Name = z.string().trim().min(1, 'Enter a display name — it’s how the table will know you.').max(24, 'Keep it to 24 characters.').regex(/^[^<>\u0000-\u001F]+$/, 'Use letters, numbers and spaces.');

/**
 * Same-site check that works behind a reverse proxy: the browser's Origin must
 * match APP_URL or the host the request was addressed to (the proxy forwards
 * it), not the internal address the app itself listens on.
 */
function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  if (origin === config.appUrl) return true;
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
  try { return new URL(origin).host === host; } catch { return false; }
}
const FOREIGN = 'This request came from another website, so it was blocked. Open Taash directly and try again.';

export async function POST(req) {
  if (!sameOrigin(req)) return NextResponse.json({ error: FOREIGN }, { status: 403 });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
  if (!limit(ip)) return NextResponse.json({ error: 'Too many attempts. Wait a moment.' }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Something was wrong with that request. Refresh the page and try again.' }, { status: 400 }); }
  const parsed = Name.safeParse(body?.name);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const jar = await cookies();
  const existing = decodeGuest(jar.get(GUEST_COOKIE)?.value);
  const guest = { id: existing?.id || newGuestId(), name: parsed.data };
  const res = NextResponse.json({ ok: true, name: guest.name });
  res.cookies.set(GUEST_COOKIE, encodeGuest(guest), guestCookieOptions());
  return res;
}

export async function DELETE(req) {
  if (!sameOrigin(req)) return NextResponse.json({ error: FOREIGN }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GUEST_COOKIE, '', { ...guestCookieOptions(), maxAge: 0 });
  return res;
}
