/**
 * Imperative modal/drawer for the game table (same markup and CSS as the
 * React <Modal>), ported from the prototype's ui.js.
 */
import { h, icon, reducedMotion } from './dom.js';

const stack = [];
let keyBound = false;

/** openModal({ title, subtitle, eyebrow, body, footer, wide, drawer, dismissible, onClose }) → { el, close } */
export function openModal(opts) {
  const layer = document.getElementById('layer-modal');
  const prevFocus = document.activeElement;
  const titleId = 'm' + Math.random().toString(36).slice(2, 8);
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close' }, icon('i-x'));
  const dialog = h('div.modal' + (opts.wide ? '.wide' : '') + (opts.drawer ? '.drawer' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div.modal-head', h('div', opts.eyebrow ? h('div.eyebrow', opts.eyebrow) : null, h('h2', { id: titleId }, opts.title), opts.subtitle ? h('p', opts.subtitle) : null), opts.dismissible === false ? null : closeBtn),
    h('div.modal-body', opts.body),
    opts.footer ? h('div.modal-foot', opts.footer) : null);
  const backdrop = h('div.modal-backdrop' + (opts.drawer ? '.drawer-backdrop' : ''), dialog);
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    backdrop.classList.add('closing');
    const idx = stack.indexOf(api); if (idx >= 0) stack.splice(idx, 1);
    setTimeout(() => backdrop.remove(), reducedMotion() ? 0 : 240);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    if (opts.onClose) opts.onClose(result);
  }
  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop && opts.dismissible !== false) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Tab') trapFocus(e, dialog); });
  layer.appendChild(backdrop);
  const api = { el: dialog, close, dismissible: opts.dismissible !== false };
  stack.push(api);
  if (!keyBound) {
    keyBound = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !stack.length) return;
      const top = stack[stack.length - 1];
      if (top.dismissible) { e.preventDefault(); top.close(); }
    });
  }
  requestAnimationFrame(() => {
    const f = dialog.querySelector('[data-autofocus]') || dialog.querySelector('.modal-body input, .modal-body button, .modal-foot button') || closeBtn;
    f.focus({ preventScroll: true });
  });
  return api;
}

function trapFocus(e, root) {
  const f = Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function closeAllModals() { stack.slice().forEach(m => m.close()); }

/** In-page confirmation. Resolves true/false. */
export function confirmDialog(opts) {
  return new Promise(resolve => {
    let result = false;
    const ok = h('button.btn' + (opts.danger ? '.btn-danger' : '.btn-primary'), { type: 'button', 'data-autofocus': opts.danger ? null : true }, opts.confirmLabel || 'Confirm');
    const cancel = h('button.btn.btn-ghost', { type: 'button', 'data-autofocus': opts.danger ? true : null }, opts.cancelLabel || 'Cancel');
    const m = openModal({ title: opts.title, subtitle: opts.subtitle, body: opts.body || h('p.muted', opts.message || ''), footer: [cancel, ok], onClose: () => resolve(result) });
    ok.addEventListener('click', () => { result = true; m.close(); });
    cancel.addEventListener('click', () => m.close());
  });
}
