'use client';
/**
 * React host for the Thulla table. The table itself is the prototype's
 * imperative, animation-heavy view (table-view.js); React supplies the chat
 * (portalled into the table's chat panel) and the rules drawer.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Chat } from '@/components/platform/Chat';
import { Modal } from '@/components/platform/Modal';
import { Guide } from './Guide';
import { mountThullaTable } from './table-view';

export function ThullaTableView({ code, game, settings, seq, now, chat, you, controllerRef, onAction, onLeave, onGameOver, onResync }) {
  const hostRef = useRef(null);
  const [chatHost, setChatHost] = useState(null);
  const [rules, setRules] = useState(false);
  const [chatOpen, setChatOpen] = useState(typeof window !== 'undefined' && window.innerWidth > 1100);
  const ctl = useRef(null);
  const hooks = useRef({});
  hooks.current = { onAction, onLeave, onGameOver, onResync };

  useEffect(() => {
    const c = mountThullaTable(hostRef.current, {
      code, seats: game.seats, me: game.you, settings,
      snapshot: { view: game.view, hand: game.hand, seq, now },
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

  const onUnread = useCallback(k => ctl.current?.setUnread(k), []);
  return (
    <>
      <div ref={hostRef} />
      {chatHost ? createPortal(<Chat code={code} messages={chat} you={you} compact idSuffix="table" open={chatOpen} onUnread={onUnread} />, chatHost) : null}
      <Modal open={rules} onClose={() => setRules(false)} drawer eyebrow="Thulla" title="How to play"><Guide compact /></Modal>
    </>
  );
}
