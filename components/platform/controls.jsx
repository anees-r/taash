'use client';
/** Form controls from the prototype: switch, stepper, segmented control, crumbs, notes. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export function Switch({ id, checked, onChange, label }) {
  return (
    <label className="switch" htmlFor={id}>
      <input type="checkbox" id={id} role="switch" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="track" />
      <span className="state">{checked ? 'ON' : 'OFF'}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </label>
  );
}

export function Stepper({ id, value, min, max, onChange, label }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const set = v => {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = min;
    n = Math.max(min, Math.min(max, n));
    setText(String(n));
    onChange(n);
  };
  return (
    <div className="stepper">
      <button type="button" aria-label={'Decrease ' + label} disabled={value <= min} onClick={() => set(value - 1)}><Icon id="i-minus" /></button>
      <input id={id} type="number" inputMode="numeric" value={text} min={min} max={max} aria-label={label}
        onChange={e => setText(e.target.value)} onBlur={e => set(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') set(e.currentTarget.value); }} />
      <button type="button" aria-label={'Increase ' + label} disabled={value >= max} onClick={() => set(value + 1)}><Icon id="i-plus" /></button>
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={String(o.value === value)} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** items: [{label, href?}] */
export function Crumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i ? <span aria-hidden="true">/</span> : null}
          {it.href ? <Link href={it.href} className="crumb-link">{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Note({ children }) {
  return <div className="proto-note"><Icon id="i-info" /><span>{children}</span></div>;
}
