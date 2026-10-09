/** Formatting helpers shared by React components and the imperative table view. */
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ''))).toUpperCase();
}
/** Avatar hue from the name, kept in the room's palette (plums, teals, ambers, roses). */
export function hueFor(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [262, 285, 310, 335, 12, 32, 168, 190, 220, 245];
  return hues[x % hues.length];
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm ' + r + 's' : m + ' min';
}
export function clockFormat(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return String(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function timeAgo(date, now = Date.now()) {
  const d = (now - new Date(date).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}
export function clockTime(date) { return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export function firstName(name) { return String(name || '').split(' ')[0]; }
export function monthYear(date) { return new Date(date).toLocaleDateString('en', { month: 'long', year: 'numeric' }); }
