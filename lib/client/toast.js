/** Toasts in the shared #layer-toast stack (used by React screens and the table). */
import { h, icon } from './dom.js';

export function toast(message, opts = {}) {
  const layer = typeof document !== 'undefined' && document.getElementById('layer-toast');
  if (!layer) return null;
  const t = h('div.toast', icon(opts.icon || 'i-check'), h('span', message), opts.action ? h('button.btn.btn-sm', { type: 'button', style: { marginLeft: '6px' }, onclick: () => { opts.action.onClick(); t.remove(); } }, opts.action.label) : null);
  layer.appendChild(t);
  while (layer.children.length > 3) layer.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, opts.duration || 2600);
  return t;
}
