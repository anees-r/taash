'use client';
/**
 * Modal / drawer from the prototype (same markup and CSS), rendered into
 * #layer-modal. Focus is trapped while open and restored on close; Escape
 * closes dismissible dialogs.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export function Modal({ open, onClose, title, subtitle, eyebrow, children, footer, wide, drawer, dismissible = true }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(open);
  const prevFocus = useRef(null);

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); prevFocus.current = document.activeElement; }
    else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => { setMounted(false); setClosing(false); prevFocus.current?.focus?.({ preventScroll: true }); }, 240);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const d = dialogRef.current;
    const f = d.querySelector('[data-autofocus]') || d.querySelector('.modal-body input, .modal-body button, .modal-foot button') || d.querySelector('button');
    requestAnimationFrame(() => f?.focus({ preventScroll: true }));
    const onKey = e => {
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); onClose?.(); }
      if (e.key === 'Tab') {
        const els = Array.from(d.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent !== null);
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!mounted || typeof document === 'undefined') return null;
  const layer = document.getElementById('layer-modal');
  if (!layer) return null;
  return createPortal(
    <div className={'modal-backdrop' + (drawer ? ' drawer-backdrop' : '') + (closing ? ' closing' : '')} onMouseDown={e => { if (e.target === e.currentTarget && dismissible) onClose?.(); }}>
      <div ref={dialogRef} className={'modal' + (wide ? ' wide' : '') + (drawer ? ' drawer' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {dismissible ? <button type="button" className="icon-btn" aria-label="Close" onClick={() => onClose?.()}><Icon id="i-x" /></button> : null}
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    layer,
  );
}

/** Confirmation dialog (prototype's confirmDialog). */
export function Confirm({ open, title, subtitle, message, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel, busy }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} subtitle={subtitle}
      footer={<>
        <button type="button" className="btn btn-ghost" data-autofocus={danger ? true : undefined} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} data-autofocus={danger ? undefined : true} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </>}>
      {children || <p className="muted">{message}</p>}
    </Modal>
  );
}
