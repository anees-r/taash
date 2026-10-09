/**
 * Thulla table — presentation + animation, driven by authoritative server events.
 *
 * Ported from the prototype's table.js: same DOM, classes and animations. The
 * difference is where decisions come from: the prototype ran the rules
 * locally; here the server resolves every action first and this view only
 * animates the resulting events, in order, from a queue. Animations never
 * decide outcomes, and if events pile up (slow device, background tab) the
 * queue fast-forwards without animating.
 */
import { h, icon, avatar, animate, reducedMotion } from '@/lib/client/dom';
import { renderCard, suitSvg } from '@/lib/client/cards';
import { playSound, soundEnabled, setSoundEnabled } from '@/lib/client/sound';
import { toast } from '@/lib/client/toast';
import { openModal, confirmDialog } from '@/lib/client/modal';
import { ordinal, plural, clockFormat } from '@/lib/client/format';
import { SUIT_NAMES, SUIT_GLYPH, RED, sortHand, parseCard, shortCard, legalFromView, thullaFromView } from '../engine/rules.js';
import { settingsSummary } from '../settings.js';

const SUIT_ORDER = ['C', 'D', 'S', 'H'];
const sortIds = (ids, mode) => sortHand(ids.map(parseCard), mode).map(c => c.id);

/**
 * @param {HTMLElement} container
 * @param {object} o
 * @param {string} o.code
 * @param {{id:string,name:string,guest:boolean,isHost:boolean}[]} o.seats   game seats, anti-clockwise
 * @param {number} o.me                     my seat index
 * @param {object} o.settings
 * @param {object} o.snapshot               {view, hand, seq, now}
 * @param {object} o.hooks                  {send(action) → Promise<reply>, leave(), openRules(), resync(), onGameOver(), onChatToggle(open)}
 */
export function mountThullaTable(container, o) {
  const { code, seats: seatsMeta, me, settings, hooks } = o;
  const n = seatsMeta.length;
  let destroyed = false;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms); timers.add(id); return id; };
  const wait = ms => new Promise(res => later(res, ms));

  /* ------------------------------------------------------------ client mirror of the public view */
  let V = null;           // public view (no hidden cards)
  let hand = [];          // my card ids
  let lastSeq = 0;
  let lastHandSeq = 0;
  let clockOffset = 0;    // serverNow − Date.now()
  const local = at => at - clockOffset;
  let sortMode = 'suit';
  let selected = null;
  let busy = false;       // an animation is running for the current state
  let sending = false;    // an action is waiting for the server's ack
  let flags = {};         // per-seat transient badges
  let newCards = new Set();
  let answerModal = null;
  let revealTimer = null;
  const history = [];

  /* ------------------------------------------------------------ DOM */
  const sizeClass = n > 8 ? 'n-xl' : n > 6 ? 'n-lg' : '';
  const root = h('div.tt' + (sizeClass ? '.' + sizeClass : ''), { 'data-players': n });
  const fx = document.getElementById('layer-fx');

  const baariChip = h('span.chip.chip-gold.num', 'Dealing');
  const turnLine = h('span.tt-turnline', 'Shuffling…');
  const soundBtn = h('button.icon-btn', { type: 'button', 'aria-pressed': String(soundEnabled()), 'aria-label': 'Sound effects', title: 'Sound effects (off by default)' }, icon(soundEnabled() ? 'i-sound' : 'i-mute'));
  soundBtn.addEventListener('click', () => {
    const on = !soundEnabled(); setSoundEnabled(on);
    soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.replaceChildren(icon(on ? 'i-sound' : 'i-mute'));
    toast(on ? 'Sound on' : 'Sound off', { icon: on ? 'i-sound' : 'i-mute' });
  });
  const chatDot = h('span.dot', { hidden: true }, '0');
  const chatBtn = h('button.icon-btn.tt-chat-toggle', { type: 'button', 'aria-label': 'Open chat', 'aria-expanded': 'false' }, icon('i-chat'), chatDot);
  const bar = h('header.tt-bar',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Leave table', title: 'Leave table', onclick: leave }, icon('i-back')),
    h('div.tt-title', icon('taash-mark', 'tt-mark'), h('div', h('b', 'Thulla'), h('span.faint.num', 'Table ' + code))),
    baariChip,
    h('div.tt-turn', turnLine),
    h('div.tt-tools',
      h('button.icon-btn', { type: 'button', 'aria-label': 'How to play', title: 'How to play', onclick: () => hooks.openRules() }, icon('i-book')),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Table info and baari log', title: 'Table info & baari log', onclick: openInfo }, icon('i-info')),
      soundBtn,
      chatBtn));

  const pileEl = h('div.pile', { 'aria-hidden': 'true' });
  const leadChip = h('div.lead-chip', { 'aria-live': 'polite' });
  const banner = h('div.review-banner', { hidden: true, role: 'status' });
  const stamp = h('div.thulla-stamp', { hidden: true, 'aria-hidden': 'true' }, h('span.display', 'Thulla!'));
  const revealEl = h('section.reveal-panel', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const center = h('div.tt-center', leadChip, h('div.pile-wrap', pileEl, stamp), banner, revealEl);
  const felt = h('div.tt-felt', h('div.felt-inlay'), center);
  const seatLayer = h('div.seat-layer');
  const cleared = settings.showCleared ? clearedPanel() : null;
  const stage = h('div.tt-stage', felt, seatLayer, cleared ? cleared.el : null);

  const handEl = h('div.hand', { role: 'listbox', 'aria-label': 'Your hand', 'aria-orientation': 'horizontal' });
  const hintEl = h('p.hand-hint', { 'aria-live': 'polite' });
  const timerFill = h('span.tbar-fill');
  const timerText = h('span.num', '');
  const timerPill = h('div.tbar', { hidden: true, role: 'timer', 'aria-label': 'Turn time left' }, icon('i-clock'), h('span.tbar-track', timerFill), timerText);
  const playBtn = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Play card');
  const reqBtn = h('button.btn', { type: 'button', hidden: true }, icon('i-hand'), h('span', 'Request hand'));
  const backBtn = h('button.btn.btn-sm.btn-primary', { type: 'button', hidden: true }, 'I’m back');
  const sortSeg = segmented([{ value: 'suit', label: 'By shape' }, { value: 'rank', label: 'By rank' }], sortMode, v => { sortMode = v; renderHand(); }, 'Sort hand');
  const meStatus = h('span.me-status');
  const meCount = h('span.chip.num');
  const dock = h('footer.tt-dock',
    h('div.dock-top',
      h('div.me', avatar({ name: seatsMeta[me]?.name || '?', guest: seatsMeta[me]?.guest }, 'sm'), h('div.me-text', h('b', 'You'), meStatus), meCount),
      hintEl, backBtn, timerPill),
    handEl,
    h('div.dock-actions', sortSeg, h('div.dock-main', reqBtn, playBtn)));
  playBtn.addEventListener('click', () => { if (selected) humanPlay(selected); });
  reqBtn.addEventListener('click', humanRequest);
  backBtn.addEventListener('click', () => sendAction({ type: 'back' }));

  // Chat: React renders the shared chat component into this host.
  const chatHost = h('div.tt-chat-host');
  const chatAside = h('aside.tt-chat', chatHost);
  const chatClose = h('button.icon-btn.tt-chat-close', { type: 'button', 'aria-label': 'Close chat' }, icon('i-x'));
  chatAside.prepend(chatClose);
  function setChat(open) {
    root.classList.toggle('chat-open', open);
    chatBtn.setAttribute('aria-expanded', String(open));
    hooks.onChatToggle?.(open || window.innerWidth > 1100);
  }
  chatBtn.addEventListener('click', () => setChat(!root.classList.contains('chat-open')));
  chatClose.addEventListener('click', () => setChat(false));

  root.append(bar, h('div.tt-main', stage, chatAside), dock);
  container.appendChild(root);

  /* ------------------------------------------------------------ seats */
  const seatEls = [];
  seatsMeta.forEach((p, i) => {
    const ring = svgRing();
    const el = h('div.seat' + (i === me ? '.is-me' : ''), { 'data-seat': i },
      h('div.seat-av', ring.svg, avatar(p, null), p.isHost ? h('span.host-crown', { title: 'Host' }, icon('i-crown')) : null),
      h('div.seat-info',
        h('div.seat-name', h('b', i === me ? 'You' : p.name.split(' ')[0]), p.guest ? h('span.guest-tag', 'guest') : null),
        h('div.seat-meta', h('span.seat-count.num', { title: 'Cards in hand' }, h('span.mini-back'), h('span.cnum', '0')), h('span.seat-status'))),
      h('div.seat-bubble', { hidden: true }));
    el.ring = ring;
    seatEls.push(el);
    seatLayer.appendChild(el);
  });
  function relPos(seat) { return ((seat - (me < 0 ? 0 : me)) + n) % n; }
  function seatAngle(seat) { return (90 - relPos(seat) * 360 / n) * Math.PI / 180; }
  function layoutSeats() {
    const narrow = stage.clientWidth < 620;
    const W = stage.clientWidth, Hh = stage.clientHeight;
    seatsMeta.forEach((p, i) => {
      const a = seatAngle(i);
      const rx = narrow ? 41 : 44, ry = narrow ? 42 : 41;
      let x = 50 + rx * Math.cos(a), y = 50 + ry * Math.sin(a);
      if (i === me) { x = 50; y = 93; }
      const el = seatEls[i];
      // Keep every seat fully inside the stage, whatever the screen size.
      const hw = el.offsetWidth / 2 + 6, hh = el.offsetHeight / 2 + 4;
      el.style.left = Math.max(hw, Math.min(W - hw, x / 100 * W)) + 'px';
      el.style.top = Math.max(hh, Math.min(Hh - hh, y / 100 * Hh)) + 'px';
      el.classList.toggle('side-l', x < 30); el.classList.toggle('side-r', x > 70); el.classList.toggle('side-t', y < 30);
    });
  }
  const ro = new ResizeObserver(() => { layoutSeats(); fitHand(); });
  ro.observe(stage); ro.observe(handEl);

  function svgRing() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
    const bg = document.createElementNS(NS, 'circle'); bg.setAttribute('cx', 50); bg.setAttribute('cy', 50); bg.setAttribute('r', 46); bg.setAttribute('class', 'ring-bg');
    const fg = document.createElementNS(NS, 'circle'); fg.setAttribute('cx', 50); fg.setAttribute('cy', 50); fg.setAttribute('r', 46); fg.setAttribute('class', 'ring-fg');
    fg.setAttribute('pathLength', '100'); fg.style.strokeDasharray = '100'; fg.style.strokeDashoffset = '0';
    svg.append(bg, fg);
    return {
      svg,
      /** Show fraction `f` now, then (optionally) drain to empty over `ms` with a CSS transition. */
      run(f, ms) {
        fg.style.transition = 'none';
        fg.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, f)) * 100);
        if (ms > 0) { void fg.getBoundingClientRect(); fg.style.transition = `stroke-dashoffset ${ms}ms linear, stroke .3s`; fg.style.strokeDashoffset = '100'; }
      },
    };
  }

  const seatInfo = i => (V && V.seats[i]) || { count: 0, finished: false, place: null, away: false };
  function pendingRequest() { return V && V.baari && V.baari.request && V.baari.request.status === 'pending' ? V.baari.request : null; }
  function revealActive() { return V && V.reveal && local(V.reveal.until) > Date.now(); }

  function seatStatus(i) {
    const p = seatInfo(i), f = flags[i] || {};
    if (V.phase === 'over' && V.loser === i) return { text: 'Holding the cards', ic: 'i-hand', cls: 'lost' };
    if (p.finished) return { text: 'Finished ' + ordinal(p.place), ic: 'i-trophy', cls: 'finished' };
    const rq = pendingRequest();
    if (rq && rq.to === i) return { text: 'Considering request…', ic: 'i-hand', cls: 'request' };
    if (rq && rq.from === i) return { text: 'Requested a hand', ic: 'i-hand', cls: 'request' };
    if (f.playing) return { text: 'Playing…', ic: 'i-bolt', cls: 'playing' };
    if (f.thulla) return { text: 'Gave Thulla', ic: 'i-bolt', cls: 'thulla' };
    if (p.away) return { text: 'Away · auto-play', ic: 'i-wifi-off', cls: 'offline' };
    if (V.phase === 'turn' && V.current === i) return { text: i === me ? 'Your turn' : 'Thinking…', ic: 'i-clock', cls: 'turn' };
    if (f.collected) return { text: 'Collected +' + f.collected, ic: 'i-hand', cls: 'collected' };
    if (f.played) return { text: 'Played', ic: 'i-check', cls: 'played' };
    return { text: 'Waiting', ic: null, cls: 'waiting' };
  }

  function renderSeats() {
    if (!V) return;
    seatsMeta.forEach((meta, i) => {
      const el = seatEls[i], p = seatInfo(i), st = seatStatus(i);
      el.querySelector('.cnum').textContent = i === me ? hand.length : p.count;
      const sEl = el.querySelector('.seat-status');
      sEl.className = 'seat-status st-' + st.cls;
      sEl.replaceChildren(st.ic ? icon(st.ic) : '', st.text);
      const turnSeat = timerSeat();
      el.classList.toggle('is-turn', turnSeat === i);
      el.classList.toggle('is-finished', !!p.finished);
      el.classList.toggle('is-offline', !!p.away);
      el.classList.toggle('is-lost', V.phase === 'over' && V.loser === i);
      el.setAttribute('aria-label', (i === me ? 'You' : meta.name) + ', ' + plural(i === me ? hand.length : p.count, 'card') + ', ' + st.text);
    });
    if (me >= 0) {
      meCount.textContent = plural(hand.length, 'card');
      const st = seatStatus(me);
      meStatus.className = 'me-status st-' + st.cls; meStatus.textContent = st.text;
      backBtn.hidden = !seatInfo(me).away || seatInfo(me).finished || V.phase === 'over';
    }
    baariChip.textContent = V.phase === 'over' ? 'Game over' : V.phase === 'deal' ? 'Dealing' : 'Baari ' + (V.baari ? V.baari.number : 1);
    updateTurnLine();
  }

  const nameOf = i => (i === me ? 'You' : seatsMeta[i].name.split(' ')[0]);
  const possessive = i => (i === me ? 'your' : nameOf(i) + '’s');
  const cap = s => s.replace(/^./, c => c.toUpperCase());

  function updateTurnLine() {
    if (V.phase === 'over') { turnLine.textContent = 'Game over'; return; }
    if (V.phase === 'deal') { turnLine.textContent = 'Dealing ' + 52 + ' cards'; return; }
    if (V.phase === 'review') { turnLine.textContent = 'Baari ' + (V.review ? V.review.number : '') + ' finished'; return; }
    if (V.phase === 'reveal') { turnLine.textContent = 'Showing the transferred hand'; return; }
    const rq = pendingRequest();
    if (rq) { turnLine.textContent = (rq.to === me ? 'You were' : nameOf(rq.to) + ' was') + ' asked for ' + (rq.to === me ? 'your' : 'their') + ' hand'; return; }
    turnLine.textContent = V.current === me ? 'Your turn' : nameOf(V.current) + ' is playing';
  }

  function setLead() {
    const b = V && V.baari;
    leadChip.replaceChildren();
    if (!b || V.phase === 'over' || V.phase === 'deal') {
      if (V && V.phase === 'deal') { leadChip.hidden = false; leadChip.append(h('span.lc-label', 'Dealing'), h('span', 'anti-clockwise, one at a time')); }
      else leadChip.hidden = true;
      return;
    }
    leadChip.hidden = false;
    if (b.number === 1 && !b.leadSuit) { leadChip.append(h('span.lc-label', 'First baari'), h('span', 'opens with A♠')); return; }
    if (!b.leadSuit) { leadChip.append(h('span.lc-label', 'Baari ' + b.number), h('span', nameOf(b.leader) + (b.leader === me ? ' lead' : ' leads'))); return; }
    leadChip.append(h('span.lc-label', b.number === 1 ? 'First baari · shape' : 'Shape'), h('span.lc-suit' + (RED[b.leadSuit] ? '.red' : ''), suitSvg(b.leadSuit), SUIT_NAMES[b.leadSuit]));
  }

  /* ------------------------------------------------------------ cleared panel */
  function clearedPanel() {
    const cells = {};
    const el = h('section.cleared', { 'aria-label': 'Cards cleared from play' },
      h('header', h('span.eyebrow', 'Cleared'), h('button.cleared-help', { type: 'button', 'aria-label': 'What counts as cleared?', title: 'What counts as cleared?', onclick: () => openModal({ title: 'Cleared cards', subtitle: 'Cards that have left the game for good.', body: [h('p', 'These counters show, for each shape, how many of its 13 cards are gone from play.'), h('ul.rule-list', h('li', 'Counted: the whole first baari, and every baari that clears normally.'), h('li', 'Not counted: cards in hands, cards on the table right now, Thulla piles and handed-over hands — those cards are still in play.'))] }) }, icon('i-info'))),
      h('div.cleared-grid', SUIT_ORDER.map(s => {
        const num = h('b.num', '0'), fill = h('span.cbar-fill');
        const cell = h('div.ccell' + (RED[s] ? '.red' : ''), { 'data-suit': s, title: SUIT_NAMES[s] }, suitSvg(s), h('span.cval', num, h('span.faint', '/13')), h('span.cbar', fill), h('span.sr-only', SUIT_NAMES[s]));
        cells[s] = { num, fill, cell };
        return cell;
      })));
    return {
      el, cells,
      update(bump) {
        SUIT_ORDER.forEach(s => {
          const v = V.cleared[s];
          if (cells[s].num.textContent !== String(v)) {
            cells[s].num.textContent = v;
            if (bump) animate(cells[s].cell, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .4 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.4,.64,1)' });
          }
          cells[s].fill.style.width = (v / 13 * 100) + '%';
        });
      },
    };
  }

  /* ------------------------------------------------------------ hand */
  function handCardSize() { const w = window.innerWidth; return w < 560 ? 60 : w < 900 ? 76 : 92; }
  function myTurn() { return V && V.phase === 'turn' && V.current === me && !busy && !pendingRequest() && !seatInfo(me).finished; }
  function legalSet() {
    if (!myTurn()) return new Set();
    return new Set(legalFromView({ number: V.baari.number, leadSuit: V.baari.leadSuit, playsCount: V.baari.plays.length }, hand));
  }
  const viewBaari = () => V && V.baari && { number: V.baari.number, leadSuit: V.baari.leadSuit, playsCount: V.baari.plays.length };
  const willThulla = id => thullaFromView(viewBaari(), id);

  function illegalReason(id) {
    if (!V || V.phase !== 'turn') return V && V.phase === 'reveal' ? 'Wait for the cards to be shown.' : 'Wait for the baari to finish.';
    if (pendingRequest()) return 'Waiting for an answer to the request.';
    if (V.current !== me) return 'It is not your turn.';
    if (legalSet().has(id)) return null;
    const b = V.baari;
    if (b.plays.length === 0 && b.number === 1) return 'The first baari opens with the Ace of Spades.';
    return 'You hold ' + SUIT_NAMES[b.leadSuit] + ' — you must follow the ' + SUIT_NAMES[b.leadSuit].toLowerCase().replace(/s$/, '') + '.';
  }

  function renderHand() {
    if (me < 0) return;
    const ids = sortIds(hand, sortMode);
    const turn = myTurn() && !sending;
    const legal = legalSet();
    const cw = handCardSize();
    handEl.replaceChildren();
    handEl.style.setProperty('--hcw', cw + 'px');
    ids.forEach((id, i) => {
      const can = turn && legal.has(id);
      const el = renderCard(id, { size: cw, button: true });
      el.classList.add(turn ? (can ? 'is-playable' : 'is-disabled') : 'is-idle');
      if (selected === id) el.classList.add('is-selected');
      if (selected === id && willThulla(id)) el.classList.add('will-thulla');
      if (newCards.has(id)) el.classList.add('is-new');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(selected === id));
      el.setAttribute('aria-disabled', String(!can));
      el.setAttribute('aria-label', el.getAttribute('aria-label') + (turn ? (can ? (willThulla(id) ? ' — gives Thulla' : ' — playable') : ' — cannot play') : ''));
      el.tabIndex = (selected ? selected === id : i === 0) ? 0 : -1;
      el.style.zIndex = String(i + 1);
      el.addEventListener('click', () => onCardClick(id, el));
      el.addEventListener('dblclick', () => { if (can) humanPlay(id); });
      el.addEventListener('keydown', e => onCardKey(e, i));
      handEl.appendChild(el);
    });
    fitHand();
    playBtn.disabled = !(turn && selected && legal.has(selected));
    const th = !!(selected && turn && willThulla(selected));
    playBtn.textContent = th ? 'Give Thulla' : 'Play card';
    playBtn.classList.toggle('btn-thulla', th);
    const canReq = turn && V.requestTarget != null && V.baari.plays.length === 0 && !V.baari.requestUsed;
    reqBtn.hidden = !canReq;
    if (canReq) reqBtn.querySelector('span').textContent = 'Request ' + possessive(V.requestTarget) + ' hand';
    updateHint(turn);
    dock.classList.toggle('my-turn', !!turn);
  }

  function fitHand() {
    const cards = handEl.children; const k = cards.length; if (!k) return;
    const cw = parseFloat(handEl.style.getPropertyValue('--hcw')) || 90;
    const avail = handEl.clientWidth - 32;
    let step = Math.min(cw * 0.8, (avail - cw) / Math.max(1, k - 1));
    step = Math.max(step, Math.min(cw * 0.36, 26));
    handEl.classList.toggle('overflowing', step * (k - 1) + cw > avail + 2);
    for (let i = 0; i < k; i++) cards[i].style.marginLeft = i ? (step - cw) + 'px' : '0px';
  }

  function updateHint(turn) {
    hintEl.className = 'hand-hint';
    if (!V || me < 0) return;
    if (seatInfo(me).finished) { hintEl.textContent = V.phase === 'over' && V.loser === me ? '' : 'You finished ' + ordinal(seatInfo(me).place) + '. Watch the rest of the table.'; return; }
    if (seatInfo(me).away && V.phase !== 'over') { hintEl.textContent = 'You are marked away — your turns are played for you.'; hintEl.classList.add('warn'); return; }
    if (!turn) {
      const rq = pendingRequest();
      if (rq) hintEl.textContent = rq.to === me ? nameOf(rq.from) + ' asked for your hand.' : rq.from === me ? 'Waiting for ' + nameOf(rq.to) + ' to give or keep their cards…' : nameOf(rq.from) + ' asked ' + nameOf(rq.to) + ' for their hand…';
      else if (V.phase === 'review') hintEl.textContent = 'Baari finished — take a look at the pile.';
      else if (V.phase === 'reveal') hintEl.textContent = 'Everyone can see the cards that changed hands.';
      else if (V.phase === 'turn') hintEl.textContent = 'Waiting for ' + nameOf(V.current) + '…';
      else hintEl.textContent = '';
      return;
    }
    const b = V.baari;
    if (b.plays.length === 0) {
      if (b.number === 1) hintEl.textContent = 'You hold the A♠ — open the first baari with it.';
      else hintEl.textContent = V.requestTarget != null && !b.requestUsed ? 'Lead any card, or request ' + possessive(V.requestTarget) + ' hand first.' : 'Lead any card. Its shape sets the baari.';
      return;
    }
    const has = hand.some(id => id.slice(-1) === b.leadSuit);
    if (has) hintEl.textContent = 'Follow ' + SUIT_NAMES[b.leadSuit] + ' — you hold the shape.';
    else if (b.number === 1) hintEl.textContent = 'No Spades — play any card. It is cleared, not Thulla, in the first baari.';
    else { hintEl.textContent = 'No ' + SUIT_NAMES[b.leadSuit] + ' — any card you play gives Thulla.'; hintEl.classList.add('ember'); }
  }

  function onCardClick(id, el) {
    if (!myTurn() || sending) { nudge(el, V && V.phase === 'turn' && !pendingRequest() ? 'Wait for your turn.' : illegalReason(id) || 'Wait for your turn.'); return; }
    const reason = illegalReason(id);
    if (reason) { nudge(el, reason); return; }
    if (selected === id) { humanPlay(id); return; }
    selected = id; renderHand(); playSound('card');
    const sel = handEl.querySelector('[data-card="' + id + '"]'); if (sel) sel.focus({ preventScroll: true });
  }
  function nudge(el, reason) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    hintEl.textContent = reason; hintEl.className = 'hand-hint warn';
  }
  function onCardKey(e, i) {
    const cards = Array.from(handEl.children);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      cards.forEach(c => { c.tabIndex = -1; }); cards[j].tabIndex = 0; cards[j].focus();
    }
  }

  /* ------------------------------------------------------------ actions → server */
  async function sendAction(action) {
    if (sending) return { error: 'busy' };
    sending = true;
    renderHand();
    const res = await hooks.send(action);
    sending = false;
    if (destroyed) return res;
    if (res && res.error && res.code !== 'rate') {
      hintEl.textContent = res.error; hintEl.className = 'hand-hint warn';
      toast(res.error, { icon: 'i-info' });
    }
    renderHand();
    return res;
  }
  function humanPlay(id) {
    if (!myTurn() || illegalReason(id)) return;
    sendAction({ type: 'play', card: id });
  }

  async function humanRequest() {
    if (!myTurn() || V.requestTarget == null) return;
    const t = V.requestTarget;
    const cnt = seatInfo(t).count;
    const ok = await confirmDialog({
      title: 'Request ' + possessive(t) + ' hand?',
      subtitle: 'Before you lead, you may ask the next active player for every card they hold.',
      body: h('div.req-explain',
        h('div.req-who', avatar(seatsMeta[t], null), h('div', h('b', seatsMeta[t].name), h('span.faint', plural(cnt, 'card') + ' in hand'))),
        h('ul.rule-list',
          h('li', h('b', 'If they give:'), ' all ' + plural(cnt, 'card') + ' join your hand — everyone sees them — and they finish ' + ordinal(V.finishOrder.length + 1) + '.'),
          h('li', h('b', 'If they keep:'), ' nothing changes and you lead as normal.'),
          h('li', 'You can ask once this turn.'))),
      confirmLabel: 'Send request', cancelLabel: 'Not now',
    });
    if (!ok || destroyed || !myTurn()) return;
    sendAction({ type: 'request' });
  }

  function askHuman(from, deadlineAt) {
    closeAnswer();
    const cnt = hand.length;
    const give = h('button.btn.btn-primary', { type: 'button' }, 'Give my ' + cnt + ' cards');
    const keep = h('button.btn', { type: 'button', 'data-autofocus': true }, 'Keep my cards');
    const left = h('span.faint.num.small');
    const m = openModal({
      eyebrow: 'Card request', title: nameOf(from) + ' asks for your hand',
      subtitle: 'You decide. Either choice is fair play. If time runs out, you keep your cards.',
      dismissible: false,
      body: h('div.req-explain',
        h('div.req-who', avatar(seatsMeta[from], null), h('div', h('b', seatsMeta[from].name), h('span.faint', 'is leading this baari'))),
        h('div.req-options',
          h('div.req-opt', h('b', 'Give'), h('p', 'All ' + plural(cnt, 'card') + ' go to ' + nameOf(from) + ', shown to the whole table. You finish ' + ordinal(V.finishOrder.length + 1) + ' right away.')),
          h('div.req-opt', h('b', 'Keep'), h('p', 'You keep your hand and the baari goes on. ' + nameOf(from) + ' leads a card.'))),
        left),
      footer: [keep, give],
    });
    const tick = () => { const s = (local(deadlineAt) - Date.now()) / 1000; left.textContent = s > 0 ? 'Time left: ' + clockFormat(s) + 's' : ''; };
    tick();
    const iv = setInterval(tick, 1000);
    answerModal = { m, iv };
    const answer = async accept => {
      give.disabled = keep.disabled = true;
      const res = await sendAction({ type: 'answer', accept });
      if (res && res.error) { give.disabled = keep.disabled = false; return; }
      closeAnswer();
    };
    give.addEventListener('click', () => answer(true));
    keep.addEventListener('click', () => answer(false));
  }
  function closeAnswer() { if (answerModal) { clearInterval(answerModal.iv); answerModal.m.close(); answerModal = null; } }

  /* ------------------------------------------------------------ deadlines (server-authoritative) */
  let tick = null;
  function timerSeat() {
    if (!V || !V.deadline) return null;
    if (V.deadline.kind === 'turn' || V.deadline.kind === 'auto' || V.deadline.kind === 'request') return V.deadline.seat;
    return null;
  }
  function showDeadline() {
    clearInterval(tick); tick = null;
    seatEls.forEach(el => { el.classList.remove('time-warn'); el.ring.run(1, 0); });
    timerPill.hidden = true; timerPill.classList.remove('warn');
    const seat = timerSeat();
    if (seat == null || !V.deadline) return;
    const end = local(V.deadline.at);
    const startAt = V.deadline.from ? local(V.deadline.from) : Date.now();
    const total = Math.max(1, end - Math.min(startAt, Date.now()));
    const now = Date.now();
    const left = Math.max(0, end - now);
    const startFrac = Math.min(1, left / Math.max(total, settings.turnSeconds * 1000));
    const rm = reducedMotion();
    seatEls[seat].ring.run(startFrac, rm ? 0 : left);
    const warnAt = Math.min(10000, settings.turnSeconds * 1000 * .25);
    const mine = seat === me && V.deadline.kind !== 'auto';
    if (mine) {
      timerPill.hidden = false;
      timerFill.style.transition = 'none'; timerFill.style.width = (startFrac * 100) + '%';
      if (!rm) { void timerFill.offsetWidth; timerFill.style.transition = `width ${left}ms linear`; timerFill.style.width = '0%'; }
    }
    const update = () => {
      const l = end - Date.now();
      const warn = l <= warnAt;
      seatEls[seat].classList.toggle('time-warn', warn);
      if (mine) { timerText.textContent = clockFormat(Math.max(0, l) / 1000); timerPill.classList.toggle('warn', warn); }
      if (rm) { const f = Math.max(0, l) / Math.max(total, 1); seatEls[seat].ring.run(f, 0); if (mine) timerFill.style.width = (f * 100) + '%'; }
      if (l <= 0) { clearInterval(tick); tick = null; }
    };
    update();
    // One cheap 1 s tick for the number and the warning colour; the ring and bar themselves are CSS transitions.
    tick = setInterval(update, 1000);
  }

  /* ------------------------------------------------------------ pile */
  function pileSize() { const w = Math.min(stage.clientWidth, stage.clientHeight * 1.4); let s = w < 520 ? 56 : w < 760 ? 66 : 78; if (n > 6) s *= .86; if (n > 10) s *= .85; return Math.round(s); }
  function slotTransform(seat, index) {
    const a = seatAngle(seat);
    const cw = pileSize();
    const r = cw * (n > 6 ? .42 : .5);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * .75, rot: ((index * 47) % 21) - 10 + Math.cos(a) * 6 };
  }
  function addPileCard(seat, card, index, hidden) {
    const cw = pileSize();
    const t = slotTransform(seat, index);
    const slot = h('div.pslot', { 'data-seat': seat, style: { transform: 'translate(' + t.x + 'px,' + t.y + 'px)', zIndex: String(index + 1) } });
    const c = renderCard(card, { size: cw });
    c.style.transform = 'rotate(' + t.rot + 'deg)';
    slot.appendChild(c);
    slot.style.marginLeft = (-cw / 2) + 'px'; slot.style.marginTop = (-cw * 0.7) + 'px';
    if (hidden) slot.style.visibility = 'hidden';
    pileEl.appendChild(slot);
    return { slot, card: c, rot: t.rot, cw };
  }

  /** Clone into the fx layer and fly it from `fromRect` to the slot's position. */
  async function flyToSlot(target, fromRect, opts = {}) {
    const tr = target.slot.getBoundingClientRect();
    const cw = target.cw, ch = cw * 1.4;
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    const clone = renderCard(target.card.dataset.card, { size: cw, className: 'flying' });
    clone.style.position = 'fixed'; clone.style.left = (tx - cw / 2) + 'px'; clone.style.top = (ty - ch / 2) + 'px';
    fx.appendChild(clone);
    const fx0 = fromRect.left + fromRect.width / 2 - tx, fy0 = fromRect.top + fromRect.height / 2 - ty;
    const s0 = opts.fromScale || (fromRect.width / cw);
    if (opts.thulla) await cardSlap(clone, fx0, fy0, s0, target.rot);
    else await animate(clone, [
      { transform: `translate(${fx0}px,${fy0}px) scale(${s0}) rotate(0deg)`, opacity: opts.fromOpacity != null ? opts.fromOpacity : 1 },
      { transform: `translate(${fx0 * .35}px,${fy0 * .35 - 18}px) scale(${(s0 + 1) / 2 * 1.06}) rotate(${target.rot / 2}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(0,0) scale(1) rotate(${target.rot}deg)`, opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.3,.7,.2,1)' });
    target.slot.style.visibility = '';
    clone.remove();
  }

  /* The Thulla card slap: raise, wind up, slam down. */
  async function cardSlap(clone, fx0, fy0, s0, rot) {
    clone.classList.add('thulla-card');
    if (reducedMotion()) { await animate(clone, [{ opacity: 0 }, { opacity: 1, transform: `rotate(${rot}deg)` }], { duration: 120, essential: true }); return; }
    await animate(clone, [{ transform: `translate(${fx0}px,${fy0}px) scale(${s0}) rotate(0deg)` }, { transform: 'translate(0px,-110px) scale(1.32) rotate(-12deg)' }], { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
    await animate(clone, [{ transform: 'translate(0px,-110px) scale(1.32) rotate(-12deg)' }, { transform: 'translate(4px,-124px) scale(1.36) rotate(-17deg)' }], { duration: 130, easing: 'ease-out' });
    await animate(clone, [{ transform: 'translate(4px,-124px) scale(1.36) rotate(-17deg)' }, { transform: `translate(0,0) scale(.97) rotate(${rot}deg)` }], { duration: 105, easing: 'cubic-bezier(.75,0,.95,.45)' });
  }

  function thullaImpact(giverSeat) {
    playSound('thulla-impact');
    const wrap = pileEl.parentElement;
    animate(pileEl, [
      { transform: 'translate(0,0) scale(1,1)' }, { transform: 'translate(0,3px) scale(1.05,.9)', offset: .18 },
      { transform: 'translate(-4px,-2px) scale(.98,1.04)', offset: .4 }, { transform: 'translate(3px,0) scale(1.01,.99)', offset: .62 },
      { transform: 'translate(0,0) scale(1,1)' },
    ], { duration: 380, easing: 'ease-out', fill: 'none' });
    animate(felt, [{ transform: 'translate(0,0)' }, { transform: 'translate(-3px,2px)', offset: .2 }, { transform: 'translate(3px,-1px)', offset: .45 }, { transform: 'translate(-1px,1px)', offset: .7 }, { transform: 'translate(0,0)' }], { duration: 300, fill: 'none' });
    const ring = h('span.shock'); wrap.appendChild(ring);
    animate(ring, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .85 }, { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0 }], { duration: 560, easing: 'cubic-bezier(.1,.7,.3,1)' }).then(() => ring.remove());
    for (let k = 0; k < 10; k++) {
      const d = h('span.dust'); wrap.appendChild(d);
      const ang = (k / 10) * Math.PI * 2 + Math.random() * .4, dist = 60 + Math.random() * 50;
      animate(d, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: .9 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist * .7}px)) scale(.3)`, opacity: 0 }], { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.1,.8,.3,1)' }).then(() => d.remove());
    }
    stamp.hidden = false;
    animate(stamp, [{ transform: 'translate(-50%,-50%) scale(2.2) rotate(-14deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.94) rotate(-7deg)', opacity: 1, offset: .65 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-7deg)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.2)', essential: true });
    const sEl = seatEls[giverSeat];
    sEl.classList.add('flash-thulla'); later(() => sEl.classList.remove('flash-thulla'), 900);
  }

  function rebuildPile() {
    pileEl.replaceChildren();
    if (!V.baari) return;
    V.baari.plays.forEach((p, i) => addPileCard(p.seat, p.card, i, false));
    if (V.phase === 'review' && V.review) markReview(V.review);
  }

  function markReview(r) {
    const slots = Array.from(pileEl.children);
    if (r.highest) {
      const s = slots.find(x => Number(x.dataset.seat) === r.highest.seat);
      if (s && !s.firstChild.classList.contains('is-winning')) { s.firstChild.classList.add('is-winning'); s.firstChild.appendChild(h('span.tag', 'Highest ' + SUIT_GLYPH[r.rankSuit])); s.style.zIndex = '40'; }
    }
    if (r.kind === 'thulla') {
      const ts = slots[slots.length - 1];
      if (ts && !ts.firstChild.classList.contains('is-thulla')) { ts.firstChild.classList.add('is-thulla'); ts.firstChild.appendChild(h('span.tag.ember', 'Thulla')); }
    }
  }

  function showBanner(r) {
    const secsLeft = Math.max(0, (local(r.until) - Date.now()) / 1000);
    const secs = Math.round(r.pileMs / 100) / 10;
    const fill = h('span.rb-fill');
    let msg;
    if (r.kind === 'first-clear') msg = [h('b', 'First baari clears.'), ' ', h('span', cap(possessive(r.highest.seat)) + ' ' + shortCard(parseCard(r.highest.card)) + ' is the highest Spade.')];
    else if (r.kind === 'clear') msg = [h('b', 'Baari clears.'), ' ', h('span', cap(possessive(r.highest.seat)) + ' ' + shortCard(parseCard(r.highest.card)) + ' is highest.')];
    else msg = [h('b.ember', nameOf(r.thullaBy) + ' gave Thulla.'), ' ', h('span', (r.collector === me ? 'You collect ' : nameOf(r.collector) + ' collects ') + plural(V.baari.plays.length, 'card') + '.')];
    banner.className = 'review-banner rb-' + r.kind;
    banner.replaceChildren(h('p', msg), h('div.rb-foot', h('span.rb-bar', fill), h('span.rb-label.faint', (r.kind === 'thulla' ? 'Collecting in ' : 'Clearing in ') + secs + 's')));
    banner.hidden = false;
    animate(banner, [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 260 });
    fill.style.width = Math.min(100, secsLeft / Math.max(.001, r.pileMs / 1000) * 100) + '%';
    fill.style.transitionDuration = secsLeft + 's';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));
  }

  async function animateClear(slots, fast) {
    if (fast) return;
    playSound('sweep');
    await Promise.all(slots.map((s, i) => {
      const c = s.firstChild, suit = c.dataset.card.slice(-1);
      let dx = 0, dy = -60;
      if (cleared) {
        const tr = cleared.cells[suit].cell.getBoundingClientRect(), sr = s.getBoundingClientRect();
        dx = tr.left + tr.width / 2 - (sr.left + sr.width / 2); dy = tr.top + tr.height / 2 - (sr.top + sr.height / 2);
      }
      return animate(s, [
        { transform: s.style.transform, opacity: 1, filter: 'blur(0)' },
        { transform: s.style.transform + ' translate(0,-10px) scale(1.04)', opacity: 1, offset: .25 },
        { transform: `translate(${dx}px,${dy}px) scale(${cleared ? .25 : .7})`, opacity: 0, filter: cleared ? 'blur(0)' : 'blur(3px)' },
      ], { duration: 620, delay: i * 70, easing: 'cubic-bezier(.5,0,.3,1)' });
    }));
    playSound('chime');
  }

  async function animateCollect(seat, slots, count, fast) {
    if (!fast) {
      await Promise.all(slots.map((s, i) => animate(s, [{ transform: s.style.transform }, { transform: `translate(${i * 2}px, ${-i * 2}px)` }], { duration: 260, delay: i * 50, easing: 'cubic-bezier(.4,0,.2,1)' })));
      playSound('sweep');
      const to = seat === me ? handEl.getBoundingClientRect() : seatEls[seat].querySelector('.seat-av').getBoundingClientRect();
      const pr = pileEl.getBoundingClientRect();
      const dx = to.left + to.width / 2 - pr.left, dy = to.top + to.height / 2 - pr.top;
      await Promise.all(slots.map((s, i) => animate(s, [
        { transform: `translate(${i * 2}px, ${-i * 2}px) scale(1)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${seat === me ? .9 : .35})`, opacity: seat === me ? .9 : .2 },
      ], { duration: 560, delay: i * 45, easing: 'cubic-bezier(.55,0,.25,1)' })));
    }
    const cnt = seatEls[seat].querySelector('.seat-count');
    animate(cnt, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: .35 }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    const plus = h('span.plus-pop', '+' + count);
    seatEls[seat].appendChild(plus);
    animate(plus, [{ opacity: 0, transform: 'translate(-50%,0)' }, { opacity: 1, transform: 'translate(-50%,-18px)', offset: .3 }, { opacity: 0, transform: 'translate(-50%,-34px)' }], { duration: 1300 }).then(() => plus.remove());
  }

  function celebrateFinish(seat, place) {
    playSound('chime');
    const el = seatEls[seat];
    el.classList.add('just-finished'); later(() => el.classList.remove('just-finished'), 1600);
    const medal = h('span.finish-pop', ordinal(place));
    el.appendChild(medal);
    animate(medal, [{ opacity: 0, transform: 'translate(-50%,6px) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-8px) scale(1.1)', offset: .3 }, { opacity: 1, transform: 'translate(-50%,-10px) scale(1)', offset: .8 }, { opacity: 0, transform: 'translate(-50%,-16px) scale(1)' }], { duration: 1800 }).then(() => medal.remove());
    toast((seat === me ? 'You finished ' : nameOf(seat) + ' finished ') + ordinal(place) + '!', { icon: 'i-trophy' });
  }

  function bubble(seat, text, kind) {
    const b = seatEls[seat].querySelector('.seat-bubble');
    b.textContent = text; b.className = 'seat-bubble b-' + kind; b.hidden = false;
    animate(b, [{ opacity: 0, transform: 'translate(-50%, 6px) scale(.9)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 240, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    clearTimeout(b._t); b._t = later(() => { b.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------------ public hand-transfer reveal */
  function showReveal(rv) {
    clearTimeout(revealTimer);
    const left = local(rv.until) - Date.now();
    if (left <= 0) { revealEl.hidden = true; return; }
    const k = rv.cards.length;
    // Size the cards so even a very large hand stays readable in a few rows.
    const w = Math.min(stage.clientWidth * .82, 640);
    const perRow = Math.max(6, Math.min(13, Math.ceil(k / Math.ceil(k / 13))));
    const size = Math.max(34, Math.min(58, Math.floor((w - 24) / perRow) - 4));
    const fill = h('span.rb-fill');
    revealEl.replaceChildren(
      h('header.rv-head',
        h('div.rv-who', avatar(seatsMeta[rv.from], 'sm'), h('span.rv-arrow', { 'aria-hidden': 'true' }, '→'), avatar(seatsMeta[rv.to], 'sm')),
        h('p', h('b', cap(nameOf(rv.from)) + (rv.from === me ? ' gave ' : ' gave ') + (rv.to === me ? 'you' : nameOf(rv.to)) + ' ' + plural(k, 'card')), h('span.faint', ' · shown to everyone'))),
      h('div.rv-cards', { style: { '--rvw': size + 'px' } }, sortIds(rv.cards, 'suit').map(id => renderCard(id, { size, mini: size < 46 }))),
      h('div.rb-foot', h('span.rb-bar', fill), h('span.rb-label.faint', 'Showing for ' + Math.round(rv.revealMs / 100) / 10 + 's')));
    revealEl.hidden = false;
    animate(revealEl, [{ opacity: 0, transform: 'translate(-50%, -46%) scale(.96)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    fill.style.width = Math.min(100, left / rv.revealMs * 100) + '%';
    fill.style.transitionDuration = left + 'ms';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));
    revealTimer = later(hideReveal, left);
  }
  function hideReveal() {
    clearTimeout(revealTimer);
    if (revealEl.hidden) return;
    animate(revealEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => { revealEl.hidden = true; });
  }

  async function animateTransfer(fromSeat, toSeat, cards, fast) {
    if (fast || reducedMotion()) return;
    playSound('sweep');
    const a = fromSeat === me ? handEl.getBoundingClientRect() : seatEls[fromSeat].querySelector('.seat-av').getBoundingClientRect();
    const b = toSeat === me ? handEl.getBoundingClientRect() : seatEls[toSeat].querySelector('.seat-av').getBoundingClientRect();
    const cw = 44;
    // The full hand is listed in the reveal panel; a few cards in flight show the direction.
    await Promise.all(cards.slice(0, 14).map((c, i) => {
      const el = renderCard(c, { size: cw });
      el.style.position = 'fixed'; el.style.left = (a.left + a.width / 2 - cw / 2) + 'px'; el.style.top = (a.top + a.height / 2 - cw * .7) + 'px';
      fx.appendChild(el);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return animate(el, [
        { transform: 'translate(0,0) rotate(0deg) scale(.6)', opacity: 0 },
        { transform: `translate(${dx * .5}px, ${dy * .5 - 40}px) rotate(${(i % 5 - 2) * 8}deg) scale(1)`, opacity: 1, offset: .5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(.7)`, opacity: .2 },
      ], { duration: 700, delay: i * 55, easing: 'cubic-bezier(.45,0,.25,1)' }).then(() => el.remove());
    }));
  }

  /* ------------------------------------------------------------ deal */
  async function animateDeal(order, fast) {
    const counts = new Array(n).fill(0);
    const showCount = () => seatEls.forEach((el, i) => { el.querySelector('.cnum').textContent = counts[i]; });
    showCount();
    setLead(); baariChip.textContent = 'Dealing'; turnLine.textContent = 'Dealing ' + order.length + ' cards';
    handEl.replaceChildren();
    if (fast || reducedMotion()) return;
    const deck = h('div.deal-deck', renderCard('back', { size: pileSize() }), renderCard('back', { size: pileSize() }));
    pileEl.appendChild(deck);
    const dr = deck.getBoundingClientRect();
    const step = Math.max(14, Math.min(34, 1500 / order.length));
    await Promise.all(order.map((seat, k) => new Promise(res => {
      later(() => {
        const to = seat === me ? handEl.getBoundingClientRect() : seatEls[seat].querySelector('.seat-av').getBoundingClientRect();
        const el = renderCard('back', { size: 40 });
        el.style.position = 'fixed'; el.style.left = (dr.left + dr.width / 2 - 20) + 'px'; el.style.top = (dr.top + dr.height / 2 - 28) + 'px';
        fx.appendChild(el);
        const dx = to.left + to.width / 2 - (dr.left + dr.width / 2), dy = to.top + to.height / 2 - (dr.top + dr.height / 2);
        playSound('deal');
        animate(el, [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(${(k % 2 ? 1 : -1) * 180}deg)`, opacity: .3 }], { duration: 300, easing: 'cubic-bezier(.3,.6,.3,1)' })
          .then(() => { el.remove(); counts[seat]++; showCount(); res(); });
      }, k * step);
    })));
    deck.remove();
  }
  function fanInHand() {
    if (reducedMotion()) return;
    Array.from(handEl.children).forEach((c, i) => animate(c, [{ transform: 'translateY(40px) rotate(-6deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: i * 30, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' }));
  }

  /* ------------------------------------------------------------ event handling */
  const queue = [];
  let draining = false;

  function pushEvents(batch) {
    if (destroyed) return;
    if (batch.seq <= lastSeq) return;                       // stale or duplicate delivery
    if (lastSeq && batch.seq > lastSeq + 1) { hooks.resync(); return; }   // missed something: resynchronise
    lastSeq = batch.seq;
    clockOffset = batch.now - Date.now();
    queue.push({ kind: 'events', batch });
    drain();
  }
  function pushHand(msg) {
    if (destroyed || msg.seq < lastHandSeq) return;
    lastHandSeq = msg.seq;
    queue.push({ kind: 'hand', hand: msg.hand });
    drain();
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !destroyed) {
        const item = queue.shift();
        const fast = queue.length > 2 || document.hidden;    // catching up: skip animations
        if (item.kind === 'hand') {
          const before = new Set(hand);
          hand = item.hand.slice();
          if (selected && !hand.includes(selected)) selected = null;
          const added = hand.filter(id => !before.has(id));
          if (added.length && added.length < hand.length) { newCards = new Set(added); later(() => { newCards.clear(); renderHand(); }, 2200); }
          renderHand(); renderSeats();
          continue;
        }
        for (const ev of item.batch.events) {
          try { await handle(ev, fast); } catch (e) { console.error('table event failed', ev.type, e); }
          if (destroyed) return;
        }
      }
    } finally { draining = false; }
  }

  async function handle(ev, fast) {
    switch (ev.type) {
      case 'deal': {
        V.phase = 'deal';
        V.seats = ev.seats;
        busy = true;
        renderSeats();
        await animateDeal(ev.order, fast);
        busy = false;
        renderSeats(); renderHand(); fanInHand();
        break;
      }
      case 'turn': {
        V.phase = 'turn'; V.current = ev.seat; V.baari = ev.baari; V.requestTarget = ev.requestTarget;
        V.deadline = { kind: ev.auto ? 'auto' : 'turn', at: ev.deadline, from: ev.from, seat: ev.seat };
        V.review = null;
        if (V.baari.plays.length === 0) { flags = Object.fromEntries(Object.entries(flags).map(([k, f]) => [k, { collected: f.collected || 0 }])); }
        selected = null;
        if (ev.seat === me) flags[me] = { ...flags[me], collected: 0 };
        renderSeats(); renderHand(); setLead(); showDeadline();
        if (ev.seat === me && !ev.auto && !fast) {
          playSound('turn');
          dock.classList.remove('turn-pop'); void dock.offsetWidth; dock.classList.add('turn-pop');
          const legal = legalSet();
          if (legal.size === 1 && V.baari.number === 1 && V.baari.plays.length === 0) { selected = [...legal][0]; renderHand(); }
        }
        break;
      }
      case 'timeout': {
        if (ev.seat === me) {
          dock.classList.remove('timeout'); void dock.offsetWidth; dock.classList.add('timeout');
          toast('Time’s up — your highest playable card was played.', { icon: 'i-clock', duration: 3600 });
        }
        break;
      }
      case 'away': {
        V.seats[ev.seat] = { ...V.seats[ev.seat], away: ev.away };
        if (ev.seat === me) toast(ev.away ? 'You are marked away. Your turns will be played for you.' : 'Welcome back — you are playing again.', { icon: ev.away ? 'i-wifi-off' : 'i-check', duration: 4000 });
        if (V.deadline && V.deadline.seat === ev.seat && V.deadline.kind === 'turn' && ev.away) V.deadline = { ...V.deadline, kind: 'auto' };
        renderSeats(); renderHand(); showDeadline();
        break;
      }
      case 'play': {
        busy = true;
        V.deadline = null; showDeadline();
        const seat = ev.seat, id = ev.card;
        let fromRect, fromScale;
        if (seat === me) {
          const el = handEl.querySelector('[data-card="' + id + '"]');
          fromRect = el ? el.getBoundingClientRect() : dock.getBoundingClientRect();
          hand = hand.filter(x => x !== id);             // the authoritative hand follows in a moment
          if (ev.auto) toast('Played ' + shortCard(parseCard(id)) + ' for you.', { icon: 'i-clock' });
        } else {
          fromRect = seatEls[seat].querySelector('.seat-av').getBoundingClientRect();
          fromScale = .45;
          V.seats[seat] = { ...V.seats[seat], count: Math.max(0, V.seats[seat].count - 1) };
        }
        if (!V.baari.leadSuit) V.baari.leadSuit = parseCard(id).suit;
        V.baari.plays.push({ seat, card: id, thulla: ev.thulla });
        V.baari.playsCount = V.baari.plays.length;
        V.phase = 'animating';
        flags[seat] = { ...flags[seat], playing: true, collected: 0 };
        selected = null;
        renderHand(); renderSeats(); setLead();
        const target = addPileCard(seat, id, ev.index, !fast);
        if (!ev.thulla && !fast) playSound('card');
        if (!fast) await flyToSlot(target, fromRect, { thulla: ev.thulla, fromScale, fromOpacity: seat === me ? 1 : .2 });
        if (destroyed) return;
        flags[seat] = { ...flags[seat], playing: false, played: true, thulla: ev.thulla };
        if (ev.thulla) {
          target.card.classList.add('is-thulla');
          if (!fast) { thullaImpact(seat); await wait(reducedMotion() ? 150 : 520); }
        }
        busy = false;
        renderSeats(); setLead();
        break;
      }
      case 'review': {
        V.phase = 'review';
        V.review = ev;
        V.deadline = null;
        history.push({ number: ev.number, kind: ev.kind, collector: ev.collector, plays: V.baari.plays.map(p => ({ ...p })) });
        markReview(ev);
        showBanner(ev);
        renderHand(); renderSeats(); setLead(); showDeadline();
        break;
      }
      case 'resolved': {
        busy = true;
        banner.hidden = true;
        if (!stamp.hidden) animate(stamp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => { stamp.hidden = true; });
        const slots = Array.from(pileEl.children);
        V.cleared = ev.clearedCounts;
        if (ev.collected) await animateCollect(ev.collected.seat, slots, ev.collected.cards.length, fast);
        else await animateClear(slots, fast);
        if (destroyed) return;
        pileEl.replaceChildren();
        V.seats = ev.seats;
        V.finishOrder = ev.seats.filter(s => s.finished).sort((a, b) => a.place - b.place).map(s => s.seat);
        if (cleared) cleared.update(!fast);
        flags = Object.fromEntries(Object.entries(flags).map(([k, f]) => [k, { collected: f.collected || 0 }]));
        if (ev.collected) flags[ev.collected.seat] = { collected: ev.collected.cards.length };
        for (const f of ev.finished) celebrateFinish(f.seat, f.place);
        busy = false;
        renderSeats(); renderHand();
        if (ev.finished.length && !fast) await wait(reducedMotion() ? 50 : 650);
        break;
      }
      case 'request': {
        V.baari.request = { from: ev.from, to: ev.to, status: 'pending' };
        V.baari.requestUsed = true;
        V.deadline = { kind: 'request', at: ev.deadline, seat: ev.to };
        if (!fast) {
          bubble(ev.from, ev.from === me ? 'You: may I have your cards?' : 'Asks ' + (ev.to === me ? 'you' : nameOf(ev.to)) + ' for their hand', 'ask');
          if (ev.to !== me) bubble(ev.to, 'Thinking it over…', 'think');
          playSound('turn');
        }
        renderSeats(); renderHand(); showDeadline();
        if (ev.to === me && !seatInfo(me).away) askHuman(ev.from, ev.deadline);
        break;
      }
      case 'request-answer': {
        if (ev.to === me) closeAnswer();
        if (V.baari.request) V.baari.request.status = ev.accepted ? 'accepted' : 'refused';
        V.deadline = null;
        if (!ev.accepted) {
          if (!fast) {
            bubble(ev.to, (ev.to === me ? 'You keep' : 'Keeps') + ' their cards', 'no');
            animate(seatEls[ev.to], [{ transform: 'translate(-50%,-50%)' }, { transform: 'translate(calc(-50% - 5px),-50%)', offset: .25 }, { transform: 'translate(calc(-50% + 5px),-50%)', offset: .5 }, { transform: 'translate(calc(-50% - 2px),-50%)', offset: .75 }, { transform: 'translate(-50%,-50%)' }], { duration: 380, fill: 'none' });
          }
          toast((ev.to === me ? 'You kept' : nameOf(ev.to) + ' kept') + ' their cards' + (ev.auto ? ' (no answer in time)' : '') + '. ' + (ev.from === me ? 'Lead a card.' : nameOf(ev.from) + ' leads.'), { icon: 'i-hand' });
        } else if (!fast) bubble(ev.to, (ev.to === me ? 'You give' : 'Gives') + ' all their cards', 'yes');
        renderSeats(); renderHand(); showDeadline();
        break;
      }
      case 'transfer-reveal': {
        busy = true;
        V.phase = 'reveal';
        V.reveal = ev;
        V.deadline = null; showDeadline();
        V.seats = ev.seats;
        V.finishOrder = ev.seats.filter(s => s.finished).sort((a, b) => a.place - b.place).map(s => s.seat);
        if (ev.from === me) hand = [];
        showReveal(ev);
        renderSeats(); renderHand();
        await animateTransfer(ev.from, ev.to, ev.cards, fast);
        if (destroyed) return;
        celebrateFinish(ev.from, ev.place);
        busy = false;
        renderSeats(); renderHand();
        break;
      }
      case 'over': {
        V.phase = 'over';
        V.loser = ev.loser;
        V.seats = ev.seats;
        V.deadline = null;
        closeAnswer(); hideReveal(); showDeadline();
        renderSeats(); renderHand(); setLead();
        const loser = ev.loser;
        const over = h('div.over-card', { role: 'status' },
          h('span.eyebrow', 'Game over'),
          h('h2.display', loser == null ? 'Everyone got out!' : (loser === me ? 'You are left holding the cards' : nameOf(loser) + ' is left holding the cards')),
          h('p.muted', 'Tallying the finishing order…'));
        center.appendChild(over);
        animate(over, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.92)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.4,.64,1)' });
        await wait(fast ? 300 : 2200);
        if (!destroyed) hooks.onGameOver?.();
        break;
      }
      default: break;
    }
  }

  /** (Re)build everything from a snapshot: first mount, reconnects and resyncs. */
  function applySnapshot(snap) {
    queue.length = 0;
    fx.replaceChildren();
    closeAnswer();
    center.querySelectorAll('.over-card').forEach(e => e.remove());
    banner.hidden = true; stamp.hidden = true;
    V = JSON.parse(JSON.stringify(snap.view));
    hand = snap.hand.slice();
    lastSeq = snap.seq;
    lastHandSeq = snap.seq;
    clockOffset = snap.now - Date.now();
    busy = false;
    if (V.deadline && !V.deadline.from) V.deadline.from = null;
    history.length = 0;
    for (const b of V.history || []) history.push({ number: b.number, kind: b.kind, collector: b.collector, plays: b.plays });
    layoutSeats();
    rebuildPile();
    if (V.phase === 'review' && V.review) showBanner(V.review);
    if (V.reveal) showReveal(V.reveal); else revealEl.hidden = true;
    if (cleared) cleared.update(false);
    renderSeats(); renderHand(); setLead(); showDeadline();
    const rq = pendingRequest();
    if (rq && rq.to === me && V.deadline && !seatInfo(me).away) askHuman(rq.from, V.deadline.at);
    if (V.phase === 'over') hooks.onGameOver?.();
  }

  /* ------------------------------------------------------------ drawers */
  function openInfo() {
    const rows = settingsSummary(settings).map(r => h('div.kv', h('span.faint', r.label), h('b', r.value)));
    const order = h('ol.seat-order', seatsMeta.map((p, i) => h('li', avatar(p, 'sm'), h('span', i === me ? p.name + ' (you)' : p.name), p.isHost ? h('span.chip.chip-gold', icon('i-crown'), 'Host') : null, h('span.faint.num', plural(i === me ? hand.length : seatInfo(i).count, 'card')))));
    const log = h('ol.baari-log', history.slice().reverse().slice(0, 12).map(b => h('li',
      h('div.bl-head', h('b', 'Baari ' + b.number), h('span.chip' + (b.kind === 'thulla' ? '.chip-ember' : '.chip-mist'), b.kind === 'thulla' ? 'Thulla → ' + nameOf(b.collector) : 'Cleared')),
      h('div.card-row', b.plays.map(p => h('div.bl-play', renderCard(p.card, { size: 34, mini: true, className: p.thulla ? 'is-thulla' : '' }), h('span.faint', nameOf(p.seat))))))));
    openModal({ drawer: true, eyebrow: 'Table ' + code, title: 'Table info', body: [
      h('div.kv-grid', rows),
      h('h3.sub', 'Seats, anti-clockwise'), order,
      h('h3.sub', 'Baari log'), history.length ? log : h('p.muted', 'Finished baaris will appear here.'),
    ] });
  }

  async function leave() {
    const ok = await confirmDialog({ title: 'Leave this game?', message: 'The game goes on without you: your turns will be played automatically. You can come back with the table code.', confirmLabel: 'Leave game', danger: true });
    if (ok) hooks.leave();
  }

  function segmented(options, value, onChange, label) {
    const wrap = h('div.seg', { role: 'group', 'aria-label': label });
    options.forEach(op => {
      const b = h('button', { type: 'button', 'aria-pressed': String(op.value === value) }, op.label);
      b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onChange(op.value); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ------------------------------------------------------------ start */
  document.body.classList.add('in-game');
  requestAnimationFrame(() => { if (!destroyed) layoutSeats(); });
  applySnapshot(o.snapshot);

  function destroy() {
    destroyed = true;
    clearInterval(tick);
    timers.forEach(clearTimeout); timers.clear();
    closeAnswer();
    ro.disconnect();
    fx.replaceChildren();
    root.remove();
    document.body.classList.remove('in-game');
  }

  return {
    el: root, chatHost, pushEvents, pushHand, resync: applySnapshot, destroy,
    setUnread(k) { chatDot.hidden = !k; chatDot.textContent = k; },
    setDeadline(dl, now) { if (!V) return; clockOffset = now - Date.now(); V.deadline = { ...(V.deadline || {}), ...dl }; showDeadline(); },
    get lastSeq() { return lastSeq; },
  };
}
