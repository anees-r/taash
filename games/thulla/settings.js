/**
 * Thulla table settings: defaults, limits and server-side normalisation.
 * Pure module shared by the server (authoritative) and the settings form.
 */

export const LIMITS = {
  playersMin: 2, playersMax: 52,
  turnMin: 5, turnMax: 600,          // seconds
  pileMin: 1, pileMax: 10,           // seconds, 0.5 steps
  revealMin: 2, revealMax: 20,       // seconds, 0.5 steps
};

/**
 * @typedef {object} ThullaSettings
 * @property {number} players       maximum seats at the table (game starts with 2+ seated)
 * @property {number} turnSeconds   time to request or play
 * @property {'s'|'m'} turnUnit     display unit only
 * @property {number} pileSeconds   how long a finished baari stays on the table
 * @property {number} revealSeconds how long a transferred hand is shown to everyone
 * @property {boolean} showCleared  show cleared-card counters
 */

/** @returns {ThullaSettings} */
export function defaultSettings() {
  return { players: 4, turnSeconds: 30, turnUnit: 's', pileSeconds: 3, revealSeconds: 5, showCleared: false };
}

const half = v => Math.round(v * 2) / 2;

/**
 * Validate and normalise untrusted settings.
 * @param {any} raw
 * @param {{minPlayers?: number}} [ctx] e.g. players already seated
 * @returns {{ok: true, settings: ThullaSettings} | {ok: false, errors: Record<string,string>}}
 */
export function normalizeSettings(raw, ctx = {}) {
  const d = defaultSettings();
  const errors = {};
  if (raw == null || typeof raw !== 'object') return { ok: false, errors: { _: 'Settings are missing.' } };
  const num = (k, v) => { const n = Number(v); if (!Number.isFinite(n)) { errors[k] = 'Enter a number.'; return null; } return n; };

  const s = { ...d };
  const players = num('players', raw.players ?? d.players);
  if (players != null) {
    const p = Math.round(players);
    const min = Math.max(LIMITS.playersMin, ctx.minPlayers || 0);
    if (p < LIMITS.playersMin || p > LIMITS.playersMax) errors.players = `Choose between ${LIMITS.playersMin} and ${LIMITS.playersMax} players.`;
    else if (p < min) errors.players = `${min} players are already seated. Remove players before lowering the seat count.`;
    else s.players = p;
  }
  const turn = num('turnSeconds', raw.turnSeconds ?? d.turnSeconds);
  if (turn != null) {
    const t = Math.round(turn);
    if (t < LIMITS.turnMin || t > LIMITS.turnMax) errors.turnSeconds = 'Choose between 5 seconds and 10 minutes.';
    else s.turnSeconds = t;
  }
  s.turnUnit = raw.turnUnit === 'm' ? 'm' : 's';
  const pile = num('pileSeconds', raw.pileSeconds ?? d.pileSeconds);
  if (pile != null) {
    const v = half(pile);
    if (v < LIMITS.pileMin || v > LIMITS.pileMax) errors.pileSeconds = `Choose between ${LIMITS.pileMin} and ${LIMITS.pileMax} seconds.`;
    else s.pileSeconds = v;
  }
  const reveal = num('revealSeconds', raw.revealSeconds ?? d.revealSeconds);
  if (reveal != null) {
    const v = half(reveal);
    if (v < LIMITS.revealMin || v > LIMITS.revealMax) errors.revealSeconds = `Choose between ${LIMITS.revealMin} and ${LIMITS.revealMax} seconds.`;
    else s.revealSeconds = v;
  }
  s.showCleared = raw.showCleared === true;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: s };
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm ' + r + 's' : m + ' min';
}

export function dealHint(n) {
  const base = Math.floor(52 / n), extra = 52 % n;
  if (!extra) return n + ' players · ' + base + ' cards each';
  return n + ' players · ' + extra + ' get ' + (base + 1) + ', ' + (n - extra) + ' get ' + base;
}

export function settingsSummary(s) {
  return [
    { label: 'Seats', value: s.players + (s.players === 4 ? ' (classic)' : '') },
    { label: 'Turn time', value: formatDuration(s.turnSeconds) },
    { label: 'Pile display', value: s.pileSeconds + 's' },
    { label: 'Hand reveal', value: s.revealSeconds + 's' },
    { label: 'Cleared counts', value: s.showCleared ? 'Shown' : 'Hidden' },
  ];
}
