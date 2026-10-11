/**
 * The sound board's sounds: every .mp3 in public/sounds, re-read at most every
 * 10 seconds so new files show up without a restart. No files, no sound board.
 * Node only (the socket server and API routes).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SOUND_ID, GAME_SOUNDS, labelFor } from './sounds.js';

const DIR = join(process.cwd(), 'public', 'sounds');
let cache = null, readAt = 0;

/** @returns {{id:string, label:string, url:string}[]} */
export function soundBoard() {
  if (cache && Date.now() - readAt < 10_000) return cache;
  let files = [];
  try { files = readdirSync(DIR).filter(f => /\.mp3$/i.test(f)); } catch { /* no folder yet */ }
  const fromFiles = files
    .map(f => ({ id: f.replace(/\.mp3$/i, ''), file: f }))
    .filter(x => SOUND_ID.test(x.id) && !GAME_SOUNDS.has(x.id.toLowerCase()))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(x => ({ id: x.id, label: labelFor(x.id), url: '/sounds/' + encodeURIComponent(x.file) }));
  cache = fromFiles;
  readAt = Date.now();
  return cache;
}

export const isSound = id => soundBoard().some(s => s.id === id);
