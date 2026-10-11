'use client';
/* Table chat — one component for the lobby, the game table and results.
   Messages are rendered as text (React escapes them); never as HTML. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { clockTime, firstName } from '@/lib/client/format';
import { call } from '@/lib/client/socket';

export function Chat({ code, messages, you, compact, idSuffix = 'main', open = true, onUnread, title = 'Table chat', inputRef }) {
  const listRef = useRef(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [wait, setWait] = useState(0);              // seconds until you may post again (spam protection)
  const seen = useRef(messages.length);
  const unread = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const fresh = messages.slice(seen.current).filter(m => m.kind === 'msg' && m.from !== you);
    seen.current = messages.length;
    if (!open && fresh.length) { unread.current += fresh.length; onUnread?.(unread.current); }
  }, [messages, open, you, onUnread]);
  useEffect(() => { if (open) { unread.current = 0; onUnread?.(0); } }, [open, onUnread]);
  // Count the wait down; the message clears when it reaches zero.
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => { setWait(w => w - 1); if (wait <= 1) setErr(null); }, 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t || wait) return;
    setText('');
    const res = await call('chat:send', { code, text: t });
    if (res.error) {
      setText(t);                                   // keep what they typed
      if (res.wait) { setWait(res.wait); setErr(res.code === 'slow' ? 'slow' : res.error); }
      else { setErr(res.error); setTimeout(() => setErr(null), 3500); }
    }
  }

  return (
    <section className={'chat' + (compact ? ' compact' : '')} aria-label={title}>
      <header className="chat-head"><Icon id="i-chat" /><h3>{title}</h3></header>
      <ol className="chat-list" ref={listRef} aria-live="polite" aria-label="Chat messages">
        {messages.map((m, i) => m.kind === 'system'
          ? <li key={m.id} className={'chat-sys' + (i >= messages.length - 1 ? ' arrive' : '')}><span>{m.text}</span></li>
          : (
            <li key={m.id} className={'chat-msg' + (m.from === you ? ' mine' : '')}>
              {m.from === you ? null : <Avatar person={{ name: m.name }} size="sm" />}
              <div className="bubble"><div className="meta"><b>{m.from === you ? 'You' : firstName(m.name)}</b>{m.bot ? <span className="bot-tag">bot</span> : null}<time dateTime={new Date(m.at).toISOString()}>{clockTime(m.at)}</time></div><p>{m.text}</p></div>
            </li>
          ))}
      </ol>
      {err ? (
        <p className={'chat-warn' + (wait ? ' is-wait' : '')} role="alert">
          <Icon id={wait ? 'i-clock' : 'i-info'} />
          {err === 'slow' ? <span>Slow down. You can send again in <b className="num">{wait}s</b>.</span> : <span>{err}</span>}
        </p>
      ) : null}
      <form className="chat-form" onSubmit={submit}>
        <input ref={inputRef} className="input chat-input" type="text" id={'chat-input-' + idSuffix} placeholder="Message the table…" maxLength={400} autoComplete="off" aria-label="Chat message" value={text} onChange={e => setText(e.target.value)} />
        <button className="icon-btn chat-send" type="submit" aria-label={wait ? 'Wait ' + wait + ' seconds before sending' : 'Send message'} disabled={!!wait}>{wait ? <span className="num chat-wait">{wait}</span> : <Icon id="i-send" />}</button>
      </form>
    </section>
  );
}
