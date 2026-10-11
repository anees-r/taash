'use client';
/**
 * React host for the Thulla table. The table itself is the prototype's
 * imperative, animation-heavy view (table-view.js); React supplies the chat
 * (portalled into the table's chat drawer, and passed on so new messages pop
 * up beside the sender's seat) and the rules drawer.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Chat } from '@/components/platform/Chat';
import { Modal } from '@/components/platform/Modal';
import { Avatar } from '@/components/platform/Avatar';
import { AddFriendButton } from '@/components/platform/AddFriendButton';
import { ordinal, plural } from '@/lib/client/format';
import { Guide } from './Guide';
import { mountThullaTable } from './table-view';

export function ThullaTableView({ code, game, settings, chat, you, design, designInfo, controllerRef, onAction, onLeave, onGameOver, onResync, onForfeit, onEmote }) {
  const hostRef = useRef(null);
  const [chatHost, setChatHost] = useState(null);
  const [rules, setRules] = useState(false);
  const [players, setPlayers] = useState(null);       // the Players panel, while open
  const [chatOpen, setChatOpen] = useState(false);
  const ctl = useRef(null);
  const hooks = useRef({});
  hooks.current = { onAction, onLeave, onGameOver, onResync, onForfeit, onEmote };

  useEffect(() => {
    const c = mountThullaTable(hostRef.current, {
      code, seats: game.seats, me: game.you, settings, design, designInfo,
      snapshot: { view: game.view, hand: game.hand, seq: game.seq, now: game.now },
      hooks: {
        send: a => hooks.current.onAction(a),
        leave: () => hooks.current.onLeave(),
        resync: () => hooks.current.onResync(),
        onGameOver: () => hooks.current.onGameOver(),
        openRules: () => setRules(true),
        openPlayers: list => setPlayers(list),
        onChatToggle: open => setChatOpen(open),
        forfeit: () => hooks.current.onForfeit?.(),
        emote: sound => hooks.current.onEmote?.(sound),
      },
    });
    ctl.current = c;
    controllerRef.current = c;
    setChatHost(c.chatHost);
    return () => { c.destroy(); if (controllerRef.current === c) controllerRef.current = null; ctl.current = null; };
    // Mount once per match; later updates arrive as events through the controller.
  }, [game.matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages already on screen when the table mounts are history; only new ones pop up at the seats.
  const seenChat = useRef(null);
  if (seenChat.current === null) seenChat.current = new Set(chat.map(m => m.id));
  useEffect(() => {
    for (const m of chat) {
      if (seenChat.current.has(m.id)) continue;
      seenChat.current.add(m.id);
      if (m.kind === 'msg' && m.from !== you) ctl.current?.chatBubble(m.from, m.text);
    }
  }, [chat, you]);

  // Keep the Players panel current while it's open.
  useEffect(() => {
    if (!players) return;
    const t = setInterval(() => { const l = ctl.current?.playersInfo?.(); if (l) setPlayers(l); }, 2000);
    return () => clearInterval(t);
  }, [players != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUnread = useCallback(k => ctl.current?.setUnread(k), []);
  return (
    <>
      <div ref={hostRef} />
      {chatHost ? createPortal(<Chat code={code} messages={chat} you={you} compact idSuffix="table" open={chatOpen} onUnread={onUnread} />, chatHost) : null}
      <Modal open={rules} onClose={() => setRules(false)} drawer eyebrow="Thulla" title="How to play"><Guide compact /></Modal>
      <Modal open={!!players} onClose={() => setPlayers(null)} drawer eyebrow={'Table ' + code} title="Players" subtitle="Anti-clockwise, in playing order.">
        <ul className="players-list">{(players || []).map(p => (
          <li key={p.id} className={p.turn ? 'is-turn' : undefined}>
            <Avatar person={p} status={p.bot || !p.away ? 'on' : 'away'} />
            <div className="pl-text">
              <b>{p.you ? p.name + ' (you)' : p.name}{p.isHost ? ' · host' : ''}</b>
              <span className="pl-meta">
                <span>{p.bot ? 'Bot' : p.guest ? 'Guest' : p.handle ? '@' + p.handle : 'Member'}</span>
                <span className="num">{p.finished ? 'Finished ' + ordinal(p.place) : plural(p.count, 'card')}</span>
                {p.turn ? <span>Playing now</span> : null}
                {p.away ? <span>Away · auto-play</span> : null}
              </span>
            </div>
            {!p.you && p.handle ? <AddFriendButton handle={p.handle} userId={p.userId} /> : <span />}
          </li>
        ))}</ul>
      </Modal>
    </>
  );
}
