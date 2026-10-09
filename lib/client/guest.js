'use client';
/** Ask the server to set (or rename) the signed guest cookie. */
export async function setGuestName(name) {
  try {
    const r = await fetch('/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || 'Could not save your name. Try again.' };
  } catch { return { error: 'You appear to be offline.' }; }
}
