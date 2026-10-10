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
import { Guide } from './Guide';
import { mountThullaTable } from './table-view';

export function ThullaTableView({ code, game, settings, chat, you, controllerRef, onAction, onLeave, onGameOver, onResync }) {
  const hostRef = useRef(null);
  const [chatHost, setChatHost] = useState(null);
  const [rules, setRules] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const ctl = useRef(null);
  const hooks = useRef({});
  hooks.current = { onAction, onLeave, onGameOver, onResync };

  useEffect(() => {
    const c = mountThullaTable(hostRef.current, {
      code, seats: game.seats, me: game.you, settings,
      snapshot: { view: game.view, hand: game.hand, seq: game.seq, now: game.now },
      hooks: {
        send: a => hooks.current.onAction(a),
        leave: () => hooks.current.onLeave(),
        resync: () => hooks.current.onResync(),
        onGameOver: () => hooks.current.onGameOver(),
        openRules: () => setRules(true),
        onChatToggle: open => setChatOpen(open),
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

  const onUnread = useCallback(k => ctl.current?.setUnread(k), []);
  return (
    <>
      <div ref={hostRef} />
      {chatHost ? createPortal(<Chat code={code} messages={chat} you={you} compact idSuffix="table" open={chatOpen} onUnread={onUnread} />, chatHost) : null}
      <Modal open={rules} onClose={() => setRules(false)} drawer eyebrow="Thulla" title="How to play"><Guide compact /></Modal>
    </>
  );
}
