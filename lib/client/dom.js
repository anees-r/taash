/**
 * Tiny DOM helpers for the imperative, animation-heavy parts of the UI (the
 * game table and its effects), ported from the prototype's util.js.
 */
import { hueFor, initials } from './format.js';

/** h('div.cls#id', {attrs}, ...children) — hyperscript. Text children are escaped. */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class' || k === 'className') String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') { for (const p in v) { if (p.startsWith('--')) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'vars') for (const p in v) el.style.setProperty(p, v[p]);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** <svg class="i"><use href="#id"/></svg> */
export function icon(id, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#' + id);
  s.appendChild(u);
  return s;
}

export function avatar(person, size, extra) {
  const el = h('span.avatar' + (size ? '.' + size : ''), { vars: { '--hue': hueFor(person.name) }, 'aria-hidden': 'true' }, initials(person.name));
  if (person.guest) el.classList.add('guest');
  if (extra && extra.status) el.appendChild(h('span.status-dot.' + extra.status));
  return el;
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate with WAAPI; resolves when done (near-instantly under reduced motion). */
export function animate(el, keyframes, opts) {
  if (!el || !el.animate) return Promise.resolve();
  const o = Object.assign({ duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }, opts);
  if (reducedMotion() && !o.essential) o.duration = Math.min(o.duration, 1);
  const a = el.animate(keyframes, o);
  return a.finished.catch(() => {}).then(() => a);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

export const storage = {
  get(k, d) { try { const v = localStorage.getItem('taash:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('taash:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
