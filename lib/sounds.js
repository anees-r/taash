/**
 * Sound board: the MP3 files in public/sounds, nothing else. drum-roll.mp3
 * shows as "Drum Roll". Shared by the server (which sounds exist) and the browser.
 */

/** 'drum-roll' → 'Drum Roll' */
export const labelFor = id => id.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export const SOUND_ID = /^[a-z0-9][a-z0-9_-]{0,58}$/i;

/** Files in public/sounds the game itself plays (end of game), kept off the sound board. */
export const GAME_SOUNDS = new Set(['victory', 'defeat']);
