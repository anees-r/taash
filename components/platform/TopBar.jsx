'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { signOutAction } from '@/app/actions/auth';
import { resetSocket } from '@/lib/client/socket';

function navActive(path) {
  if (path.startsWith('/leaderboard')) return 'leaderboard';
  if (path.startsWith('/friends')) return 'friends';
  if (path.startsWith('/profile') || path.startsWith('/u/')) return 'profile';
  if (path.startsWith('/join')) return 'join';
  return 'home';
}

/** @param {{viewer:any, rating:number|null}} p */
export function TopBar({ viewer, rating }) {
  const path = usePathname() || '/';
  const active = navActive(path);
  const [menu, setMenu] = useState(null);
  const chipRef = useRef(null);
  const name = viewer.kind === 'anon' ? 'Guest' : viewer.name;
  const sub = viewer.kind === 'user' ? (rating != null ? 'Thulla ' + rating : 'Thulla') : viewer.kind === 'guest' ? 'Guest' : 'Not signed in';
  const item = (href, label, ic) => <Link href={href} aria-current={active === label.toLowerCase() || (label === 'Games' && active === 'home') ? 'page' : undefined}><Icon id={ic} />{label}</Link>;
  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Taash home">
        <svg className="i brand-mark" aria-hidden="true"><use href="#taash-mark" /></svg>
        <span className="brand-word">Taash</span>
        <span className="brand-urdu urdu" lang="ur">تاش</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {item('/', 'Games', 'taash-mark')}
        {item('/leaderboard', 'Leaderboard', 'i-trophy')}
        {item('/friends', 'Friends', 'i-users')}
      </nav>
      <div className="topbar-end">
        <Link className="icon-btn" href="/join" aria-label="Join a table with a code" title="Join a table"><Icon id="i-hand" /></Link>
        <button ref={chipRef} type="button" className="account-chip" aria-haspopup="menu" aria-expanded={!!menu} aria-label={'Account: ' + name}
          onClick={() => { if (menu) setMenu(null); else { const r = chipRef.current.getBoundingClientRect(); setMenu({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }); } }}>
          <Avatar person={{ name, guest: viewer.kind !== 'user' }} size="sm" status={viewer.kind === 'anon' ? null : 'on'} />
          <span className="who"><b>{name}</b><span>{sub}</span></span>
        </button>
      </div>
      {menu ? <AccountMenu viewer={viewer} name={name} pos={menu} onClose={() => { setMenu(null); chipRef.current?.focus(); }} /> : null}
    </header>
  );
}

function AccountMenu({ viewer, name, pos, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('a,button')?.focus();
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.account-chip')) onClose(); };
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const item = (href, label, ic) => <Link className="menu-item" role="menuitem" href={href} onClick={onClose}><Icon id={ic} />{label}</Link>;
  return (
    <div ref={ref} className="menu" role="menu" style={{ top: pos.top, right: pos.right }}>
      <div className="menu-head">
        <Avatar person={{ name, guest: viewer.kind !== 'user' }} />
        <div><b>{name}</b><span className="faint">{viewer.kind === 'user' ? '@' + viewer.handle : viewer.kind === 'guest' ? 'Playing as a guest' : 'Not signed in'}</span></div>
      </div>
      {viewer.kind === 'user' ? item('/profile', 'Profile & history', 'i-user') : null}
      {item('/friends', 'Friends', 'i-users')}
      {item('/leaderboard', 'Leaderboard', 'i-trophy')}
      <hr className="divider" />
      {viewer.kind === 'user'
        ? <form action={signOutAction} onSubmit={() => resetSocket()}><button className="menu-item" role="menuitem" type="submit"><Icon id="i-flag" />Sign out</button></form>
        : <>{item('/signin', 'Sign in', 'i-user')}{item('/register', 'Create an account', 'i-plus')}</>}
    </div>
  );
}

export function BottomNav() {
  const path = usePathname() || '/';
  const active = navActive(path);
  const item = (href, key, label, ic) => <Link href={href} aria-current={active === key ? 'page' : undefined}><Icon id={ic} />{label}</Link>;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {item('/', 'home', 'Games', 'taash-mark')}
      {item('/join', 'join', 'Join', 'i-hand')}
      {item('/leaderboard', 'leaderboard', 'Ranks', 'i-trophy')}
      {item('/friends', 'friends', 'Friends', 'i-users')}
      {item('/profile', 'profile', 'Me', 'i-user')}
    </nav>
  );
}
