/**
 * Thulla table — presentation + animation, driven by authoritative server events.
 *
 * Ported from the prototype's table.js and redrawn as a round room: a tilted 3D
 * table with players around its rim. Decisions come from the server: the prototype ran the rules
 * locally; here the server resolves every action first and this view only
 * animates the resulting events, in order, from a queue. Animations never
 * decide outcomes, and if events pile up (slow device, background tab) the
 * queue fast-forwards without animating.
 */
import { h, icon, avatar, animate, reducedMotion, storage } from '@/lib/client/dom';
import { renderCard, suitSvg } from '@/lib/client/cards';
import { playSound, soundEnabled, setSoundEnabled } from '@/lib/client/sound';
import { toast } from '@/lib/client/toast';
import { openModal, confirmDialog } from '@/lib/client/modal';
import { ordinal, plural, clockFormat } from '@/lib/client/format';
import { SUIT_NAMES, SUIT_GLYPH, RED, sortHand, parseCard, shortCard, legalFromView, thullaFromView } from '../engine/rules.js';
import { settingsSummary } from '../settings.js';
import { labelFor } from '@/lib/sounds';

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
  const spectating = me < 0;
  /** A seat's card design (null = classic): their card backs and the edge of every card they play. */
  const deckOf = seat => (seat != null && seatsMeta[seat] && seatsMeta[seat].cosmetics && seatsMeta[seat].cosmetics.cards) || null;
  const withDeck = (el, seat) => { const d = deckOf(seat); if (d) el.dataset.deck = d; return el; };
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

  /* ------------------------------------------------------------ DOM
     The round room: the table is seen from your chair, tilted away in 3D, with the
     other players around its rim and your hand held in an arc at the bottom. Game
     state runs down the left; chat lives in a drawer and pops up beside whoever spoke. */
  // Seats step down in size as the table fills up: plates, then compact plates, then avatars with a badge.
  const tier = n <= 4 ? 't-s' : n <= 6 ? 't-m' : n <= 12 ? 't-l' : n <= 20 ? 't-xl' : 't-xxl';
  const root = h('div.tt.' + tier + (spectating ? '.spectating' : ''), { 'data-players': n });
  if (o.design) root.dataset.table = o.design;                 // the host's table design
  const fx = document.getElementById('layer-fx');

  /** Whose table we're playing on, when someone brought a design. */
  const designWhose = () => { const d = o.designInfo; return d ? d.name + ' · ' + (d.byId === seatsMeta[me]?.id ? 'your' : d.by.split(' ')[0] + '’s') + ' table' : null; };
  function designTag() { const t = designWhose(); return t ? h('span.tt-design', { title: 'The table design in play. When several people bring one, the highest-ranked or priciest is used.' }, t) : null; }
  const tool = (label, ic, onclick) => h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick }, icon(ic));
  const soundBtn = h('button.icon-btn.tt-opt', { type: 'button', 'aria-pressed': String(soundEnabled()), 'aria-label': 'Sound effects', title: 'Sound effects' }, icon(soundEnabled() ? 'i-sound' : 'i-mute'));
  function toggleSound() {
    const on = !soundEnabled(); setSoundEnabled(on);
    soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.replaceChildren(icon(on ? 'i-sound' : 'i-mute'));
    toast(on ? 'Sound on' : 'Sound off', { icon: on ? 'i-sound' : 'i-mute' });
    return on;
  }
  soundBtn.addEventListener('click', toggleSound);
  const chatDot = h('span.dot', { hidden: true }, '0');
  const chatBtn = h('button.icon-btn.tt-chat-toggle', { type: 'button', 'aria-label': 'Table chat', title: 'Table chat', 'aria-expanded': 'false' }, icon('i-chat'), chatDot);
  const cornerL = h('div.tt-corner.tt-corner-l',
    tool('Leave table', 'i-back', leave),
    h('div.tt-title', h('b.display', 'Thulla'), h('span.faint.num', 'Table ' + code), designTag()));
  const rulesBtn = tool('How to play', 'i-book', () => hooks.openRules());
  rulesBtn.classList.add('tt-opt');
  // Players only: step away (auto-play now), the sound board, and giving up.
  const awayBtn = h('button.icon-btn.tt-opt', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Mark me away', title: 'Away: your turns are played for you until you come back' }, icon('i-wifi-off'));
  awayBtn.addEventListener('click', toggleAway);
  // The sound board stays in reach on phones too; its sounds come from /api/sounds.
  const boardBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Sound board', title: 'Sound board', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, icon('i-megaphone'));
  // Players get the sounds; everyone (spectators too) gets the volume mixer.
  const boardSounds = h('div.sb-sounds', h('p.sb-empty', 'Loading sounds…'));
  const boardMix = h('div.sb-mix');
  const board = h('div.sound-board', { hidden: true, role: 'dialog', 'aria-label': 'Sound board' }, ...(spectating ? [boardMix] : [boardSounds, boardMix]));
  // Who played what, as it happens.
  const sbFeed = h('div.sb-feed', { 'aria-live': 'polite' });
  boardBtn.addEventListener('click', () => toggleBoard(board.hidden));
  const forfeitBtn = h('button.icon-btn.tt-opt.forfeit-btn', { type: 'button', 'aria-label': 'Forfeit the game', title: 'Forfeit: the game ends now and you lose' }, icon('i-flag'));
  forfeitBtn.addEventListener('click', forfeit);
  // Shown once there are sounds in public/sounds.
  const boardWrap = h('div.board-wrap', { hidden: true }, boardBtn, board);
  // One job per button on wide screens; on phones they all live in the menu.
  const optTool = (label, ic, fn) => { const b = tool(label, ic, fn); b.classList.add('tt-opt'); return b; };
  const menuBtn = h('button.icon-btn.tt-menu', { type: 'button', 'aria-label': 'Menu', title: 'Menu', 'aria-haspopup': 'dialog' }, icon('i-menu'));
  menuBtn.addEventListener('click', openMenu);
  const cornerR = h('div.tt-corner.tt-corner-r',
    rulesBtn, optTool('Table info', 'i-sliders', openInfo), optTool('Baari log', 'i-list', openLog), optTool('Players', 'i-users', openPlayers),
    ...(spectating ? [boardWrap] : [awayBtn, boardWrap, forfeitBtn]),
    soundBtn, menuBtn, chatBtn);

  // Game state: a column down the left on wide screens, a strip along the top on smaller ones.
  const baariLabel = h('span.hud-label', 'Baari');
  const baariNum = h('span.hud-num.display.num');
  const leadChip = h('div.lead-chip', { 'aria-live': 'polite' });
  const turnLine = h('p.hud-line', 'Shuffling…');
  const cleared = settings.showCleared ? clearedPanel() : null;
  const playsList = h('ol.hud-plays');
  const playsBlock = h('section.hud-block.hud-baari', { hidden: true }, h('h2.hud-title', 'This baari'), playsList);
  const lastEl = h('p.hud-last', { hidden: true });
  // Cleared cards go face down onto a pile in the state column, off the table, so a big
  // table never mistakes it for someone's hand.
  const discardStack = h('div.dc-stack', { 'aria-hidden': 'true' });
  const discardNum = h('b.num', '0');
  const discard = h('div.hud-discard', { hidden: true }, discardStack, h('span.dc-text', discardNum, h('span', ' cleared')));
  const hud = h('aside.tt-hud', { 'aria-label': 'Game state' },
    h('div.hud-head', baariLabel, baariNum),
    h('div.hud-lead', leadChip, turnLine),
    cleared ? cleared.el : null,
    playsBlock, lastEl, discard);

  // The table plane. Everything inside the felt lies flat on it (pile, face-down hands, your spot).
  const pileEl = h('div.pile', { 'aria-hidden': 'true' });
  const mySlot = h('div.my-slot', { hidden: true, 'aria-hidden': 'true' });
  const fans = h('div.fans', { 'aria-hidden': 'true' });
  // The felt's own markings: the house emblem in the middle, arrows for the direction of play
  // (anti-clockwise), and a soft light that leans towards whoever is to play.
  const emblem = h('div.felt-emblem', { 'aria-hidden': 'true' }, icon('taash-mark'), h('span.urdu', 'ٹھلا'));
  const arrows = [0, 1, 2, 3].map(() => h('span.felt-arrow', { 'aria-hidden': 'true' }, icon('i-back')));
  const spot = h('div.turn-spot', { 'aria-hidden': 'true' });
  const pileWrap = h('div.pile-wrap', mySlot, pileEl);
  const felt = h('div.tt-felt', h('div.felt-inlay'), spot, emblem, ...arrows, fans, pileWrap);
  // Upright things over the table's centre: the Thulla stamp, the hand reveal, the game-over card.
  const stampBy = h('span.ts-by');
  const stampShame = h('span.ts-shame', { hidden: true });
  const stamp = h('div.thulla-stamp', { hidden: true, 'aria-hidden': 'true' }, h('span.ts-word.display', 'Thulla!'), stampBy, stampShame);
  const flash = h('div.thulla-flash', { 'aria-hidden': 'true' });
  // Your clock running out: the screen edges glow and pulse, and your avatar becomes a countdown.
  const urgencyEdge = h('div.urgency-edge', { 'aria-hidden': 'true' });
  const urgentSr = h('p.sr-only', { 'aria-live': 'assertive' });
  const myClock = h('span.my-clock.num', { 'aria-hidden': 'true' });
  const revealEl = h('section.reveal-panel', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const overlay = h('div.tt-overlay', h('div.ov-center', stamp), revealEl);
  const seatLayer = h('div.seat-layer');
  const stage = h('div.tt-stage', felt, seatLayer, overlay);

  const handEl = h('div.hand', { role: 'listbox', 'aria-label': 'Your hand', 'aria-orientation': 'horizontal' });
  // Cards per shape; tapping one lifts that shape for a moment.
  const tallyEls = {};
  const tally = h('div.suit-tally', { role: 'group', 'aria-label': 'Cards in your hand by shape' }, SUIT_ORDER.map(s => {
    const num = h('b.num', '0');
    const b = h('button.st-suit' + (RED[s] ? '.red' : ''), { type: 'button', 'data-suit': s }, suitSvg(s), num);
    b.addEventListener('click', () => showSuit(s));
    tallyEls[s] = { b, num };
    return b;
  }));
  const hintEl = h('p.hand-hint', { 'aria-live': 'polite' });
  const banner = h('div.review-banner', { hidden: true, role: 'status' });
  const timerFill = h('span.tbar-fill');
  const timerText = h('span.num', '');
  const timerPill = h('div.tbar', { hidden: true, role: 'timer', 'aria-label': 'Turn time left' }, h('span.tbar-track', timerFill), timerText);
  const playBtn = h('button.btn.btn-primary.btn-lg', { type: 'button', disabled: true }, 'Play card');
  const reqBtn = h('button.btn', { type: 'button', hidden: true }, icon('i-hand'), h('span', 'Request hand'));
  const backBtn = h('button.btn.btn-sm.btn-primary', { type: 'button', hidden: true }, 'I’m back');
  const sortLabel = h('span');
  const sortBtn = h('button.btn.btn-sm.sort-btn', { type: 'button' }, icon('i-sliders'), sortLabel);
  function syncSort() {
    sortLabel.textContent = sortMode === 'suit' ? 'By shape' : 'By rank';
    sortBtn.setAttribute('aria-label', 'Hand sorted ' + sortLabel.textContent.toLowerCase() + '. Sort ' + (sortMode === 'suit' ? 'by rank' : 'by shape') + ' instead');
    sortBtn.title = 'Sort ' + (sortMode === 'suit' ? 'by rank' : 'by shape');
  }
  syncSort();
  sortBtn.addEventListener('click', () => { sortMode = sortMode === 'suit' ? 'rank' : 'suit'; syncSort(); renderHand(); });
  const meStatus = h('span.me-status');
  const meCount = h('span.me-count.num');
  const mePlate = me >= 0
    ? h('div.me-plate', avatar(seatsMeta[me], 'sm'), h('div.me-text', h('b', seatsMeta[me].name), meCount))
    : null;
  // The prompt floats just above your hand: whose turn, what to do, the clock. A finished
  // baari's summary takes its place while the pile is on show.
  const prompt = h('div.tt-prompt', h('div.prompt-row', meStatus, hintEl, backBtn, timerPill), banner);
  const dock = h('footer.tt-dock',
    prompt,
    h('div.dock-tools', h('div.dock-meta', mePlate, sortBtn), tally),
    handEl,
    h('div.dock-main', h('span.dock-tip', 'or double-click a card'), reqBtn, playBtn));
  if (spectating) {
    dock.replaceChildren(h('div.spectate-bar',
      h('span.chip.chip-mist', icon('i-info'), 'Watching'),
      h('p', 'You see every card that’s played, never anyone’s hand.'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => hooks.leave() }, 'Stop watching')));
  }
  playBtn.addEventListener('click', () => { if (selected) humanPlay(selected); });
  reqBtn.addEventListener('click', humanRequest);
  backBtn.addEventListener('click', () => sendAction({ type: 'back' }));

  // Chat: on wide screens a column on the right, mirroring the state column (it can be tucked
  // away); on smaller ones a small card that pops up under the chat button. React renders the
  // shared chat component into chatHost.
  const chatHost = h('div.tt-chat-host');
  const chatClose = h('button.icon-btn.tt-chat-close', { type: 'button', 'aria-label': 'Hide chat', title: 'Hide chat' }, icon('i-x'));
  const chatAside = h('aside.tt-chat', { 'aria-label': 'Table chat' }, chatClose, chatHost);
  const wideQuery = window.matchMedia('(min-width: 1100px)');
  let chatWide = readPref('taash:tableChat', '1') === '1';         // remembered: shown or tucked away
  let chatPop = false;
  const chatShown = () => (wideQuery.matches ? chatWide : chatPop);
  function syncChat(focus) {
    const open = chatShown();
    root.classList.toggle('chat-open', open);
    chatBtn.setAttribute('aria-expanded', String(open));
    hooks.onChatToggle?.(open);
    if (open && focus) later(() => chatHost.querySelector('input')?.focus({ preventScroll: true }), 120);
    else if (!open && chatAside.contains(document.activeElement)) chatBtn.focus();
  }
  function setChat(open) {
    if (wideQuery.matches) { chatWide = open; writePref('taash:tableChat', open ? '1' : '0'); layoutSeats(); } else chatPop = open;
    syncChat(open);
  }
  chatBtn.addEventListener('click', () => setChat(!chatShown()));
  chatClose.addEventListener('click', () => setChat(false));
  chatAside.addEventListener('keydown', e => { if (e.key === 'Escape') setChat(false); });
  // The pop-up closes when you tap anywhere else.
  const onDocDown = e => { if (chatPop && !wideQuery.matches && !chatAside.contains(e.target) && !chatBtn.contains(e.target)) setChat(false); };
  document.addEventListener('pointerdown', onDocDown);

  root.append(stage, dock, cornerL, cornerR, sbFeed, hud, chatAside, flash, urgencyEdge, urgentSr);
  container.appendChild(root);

  /* ------------------------------------------------------------ seats */
  const seatEls = [];
  seatsMeta.forEach((p, i) => {
    const ring = svgRing();
    const el = h('div.seat' + (i === me ? '.is-me' : ''), { 'data-seat': i, title: i === me ? 'You' : p.name },
      h('div.seat-av', ring.svg, avatar(p, null), p.isHost ? h('span.host-crown', { title: 'Host' }, icon('i-crown')) : null, h('span.seat-badge.num', { 'aria-hidden': 'true' }, '0')),
      h('div.seat-info',
        h('div.seat-name', h('b', i === me ? 'You' : p.name.split(' ')[0]), p.bot ? h('span.guest-tag.bot', 'bot') : p.guest ? h('span.guest-tag', 'guest') : null),
        h('div.seat-meta', h('span.seat-count.num', { title: 'Cards in hand' }, h('span.mini-back'), h('span.cnum', '0')), h('span.seat-status'))),
      h('div.seat-bubble', { hidden: true }));
    el.ring = ring;
    if (i === me) el.querySelector('.seat-av').appendChild(myClock);
    seatEls.push(el);
    seatLayer.appendChild(el);
  });
  function setCount(i, k) {
    seatEls[i].querySelector('.cnum').textContent = k;
    seatEls[i].querySelector('.seat-badge').textContent = k;
    renderFan(i, k);
  }
  // Opponents' hands lie face down in front of them, while there is room on the table for them.
  // One back per card they hold, so the fan grows and shrinks with every play and pickup.
  const fanEls = seatsMeta.map((p, i) => (i === me || n > 12 ? null : fans.appendChild(withDeck(h('div.fan', { 'data-k': '-1' }), i))));
  function renderFan(i, count) {
    const f = fanEls[i];
    if (!f) return;
    const k = Math.max(0, count);
    if (f.dataset.k === String(k)) return;
    const was = Number(f.dataset.k);
    f.dataset.k = String(k);
    const step = k > 1 ? Math.min(9, 76 / (k - 1)) : 0;               // a wider fan for more cards, never past ~76°
    f.replaceChildren(...Array.from({ length: k }, (_, j) => h('span.fb', { style: { transform: 'rotate(' + ((j - (k - 1) / 2) * step) + 'deg)' } })));
    if (was >= 0 && k !== was && !reducedMotion()) animate(f, [{ scale: k > was ? '1.12' : '.94' }, { scale: '1' }], { duration: 320, easing: 'cubic-bezier(.34,1.4,.64,1)', fill: 'none' });
  }

  function relPos(seat) { return ((seat - (me < 0 ? 0 : me)) + n) % n; }
  function seatAngle(seat) { return (90 - relPos(seat) * 360 / n) * Math.PI / 180; }

  /**
   * Size the table to the room and seat everyone around it. The felt is an ellipse
   * tilted back in 3D; its rim is projected with the same perspective the browser
   * uses, so seats sit just outside it at any size and any number of players.
   */
  let geo = null;
  function layoutSeats() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const phone = W < 640;
    root.classList.toggle('is-phone', phone);
    const hudSide = wideQuery.matches;
    // Big screens scale the whole interface up (seats, columns, controls, cards), so a 1080p or
    // 1440p display gets a bigger room, not a laptop layout floating in empty space.
    const sc = hudSide ? Math.max(1, Math.min(1.6, window.innerWidth / 1440, window.innerHeight / 900)) : 1;
    root.style.setProperty('--s', sc.toFixed(3));
    let sw = 0, sh = 0;
    seatEls.forEach((el, i) => { if (i !== me) { sw = Math.max(sw, el.offsetWidth * sc); sh = Math.max(sh, el.offsetHeight * sc); } });
    sw = sw || 60; sh = sh || 60;
    // Room the columns take: game state on the left, chat on the right (or just the corner tools).
    const colL = hudSide ? (28 + 184 + 20) * sc : 0;
    const colR = hudSide ? (chatWide ? (24 + 300 + 20) * sc : 60 * sc) : 0;
    const topBar = hudSide ? 22 * sc : 60 + (cleared ? 30 : 0);
    const top = topBar + sh + 6;                                          // the far seats
    const bottom = liftRoom() + (phone ? 96 : 88 * sc);                   // your avatar and the prompt
    const seatX = phone ? sw * .55 : sw * .62 + 10;                       // the side seats (they overlap the rim a little)
    const boxW = Math.max(160, W - colL - colR - seatX * 2), boxH = Math.max(120, H - top - bottom);
    const tilt = (phone ? 40 : 48) * Math.PI / 180, sinT = Math.sin(tilt), cosT = Math.cos(tilt);
    let a = boxW / 2, b = Math.min(a * (boxH > boxW ? 1.9 : 1.5), Math.max(a * .55, boxH / 2 / cosT));   // portrait rooms get a longer table
    let P = 1, minY = 0, maxY = 0, maxX = 0;
    const proj = (u, v) => { const k = P / (P - v * sinT); return { x: u * k, y: v * cosT * k }; };
    const measure = () => {
      P = Math.max(a, b) * 2.6; minY = Infinity; maxY = -Infinity; maxX = 0;
      for (let k = 0; k < 72; k++) {
        const t = k / 72 * Math.PI * 2, q = proj(a * Math.cos(t), b * Math.sin(t));
        minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); maxX = Math.max(maxX, Math.abs(q.x));
      }
    };
    // Fit width and depth separately so the table fills the room both ways, within sane proportions.
    for (let it = 0; it < 6; it++) {
      measure();
      a *= boxW / (2 * maxX); b *= boxH / (maxY - minY);
      b = Math.max(a * .55, Math.min(b, a * (boxH > boxW ? 1.9 : 1.35)));
    }
    measure();
    { const k = Math.min(1, boxW / (2 * maxX), boxH / (maxY - minY)); a *= k; b *= k; }
    const cap = Math.min(1, 1100 / a, 760 / b); a *= cap; b *= cap; measure();
    const cx = colL + seatX + boxW / 2, cy = top + (boxH - (maxY - minY)) / 2 - minY;
    geo = { a, b, cx, cy, P, sinT, cosT, tilt };

    stage.style.perspective = P + 'px';
    stage.style.perspectiveOrigin = cx + 'px ' + cy + 'px';
    stage.style.setProperty('--tcx', cx + 'px');
    stage.style.setProperty('--tcy', cy + 'px');
    Object.assign(felt.style, { left: (cx - a) + 'px', top: (cy - b) + 'px', width: a * 2 + 'px', height: b * 2 + 'px', transform: 'rotateX(' + (tilt * 180 / Math.PI) + 'deg)' });
    felt.style.setProperty('--rail', Math.round(Math.max(10, Math.min(30, a * .045))) + 'px');
    felt.style.setProperty('--fbw', Math.round(Math.max(22, Math.min(64, a * .1))) + 'px');
    felt.style.setProperty('--emb', Math.round(Math.min(a, b) * .42) + 'px');
    // Direction-of-play arrows on the inlay ring, pointing the way turns pass (anti-clockwise).
    arrows.forEach((el, k) => {
      const t = (45 + 90 * k) * Math.PI / 180;
      el.style.left = (a + a * .84 * Math.cos(t)) + 'px';
      el.style.top = (b + b * .84 * Math.sin(t)) + 'px';
      el.style.transform = 'translate(-50%, -50%) rotate(' + (Math.atan2(-b * Math.cos(t), a * Math.sin(t)) * 180 / Math.PI + 180) + 'deg)';
    });

    const minTop = hudSide ? 18 * sc : 56;                               // never against the top of the window
    seatsMeta.forEach((p, i) => {
      const t = seatAngle(i), c = Math.cos(t), s = Math.sin(t);
      const el = seatEls[i], hw = el.offsetWidth * sc / 2, hh = el.offsetHeight * sc / 2;
      const q = proj(a * c, b * s);
      let x = cx + q.x, y = cy + q.y;
      if (i !== me) {
        // Push the seat out from the rim, along the line from the table's centre.
        const len = Math.hypot(q.x, q.y) || 1, dx = q.x / len, dy = q.y / len;
        const out = phone ? Math.abs(dx) * hw * .3 + Math.abs(dy) * hh * .75 + 2 : Math.abs(dx) * hw * .55 + Math.abs(dy) * hh * .85 + 6;
        x += dx * out; y += dy * out;
      }
      el.style.left = Math.max(colL + hw + 4, Math.min(W - colR - hw - 4, x)) + 'px';
      el.style.top = Math.max(minTop + hh, Math.min(H - hh, y)) + 'px';
      el.classList.toggle('side-l', c < -.5); el.classList.toggle('side-r', c > .5); el.classList.toggle('side-t', s < -.5);
      const f = fanEls[i];
      if (f) {
        f.style.left = (a + c * a * .8) + 'px'; f.style.top = (b + s * b * .8) + 'px';
        f.style.transform = 'translate(-50%, -50%) rotate(' + (t * 180 / Math.PI - 90) + 'deg)';
      }
    });
    if (V && !busy) rebuildPile();
    renderMySlot();
    renderSpot();
    renderDiscard();
  }
  /** How many cards have left the game for good, shown as a face-down pile that grows. */
  function renderDiscard(bump) {
    const k = V && V.cleared ? Object.values(V.cleared).reduce((x, y) => x + y, 0) : 0;
    discard.hidden = !k;
    discardNum.textContent = k;
    discard.setAttribute('title', k + ' cards have left the game for good');
    const layers = Math.min(7, Math.ceil(k / 4));
    if (discardStack.childElementCount !== layers) {
      discardStack.replaceChildren(...Array.from({ length: layers }, (_, i) => {
        const c = renderCard('back', { size: 26 });
        c.style.transform = 'translate(' + (i * .6) + 'px,' + (-i * 1.4) + 'px) rotate(' + (((i * 37) % 11) - 5) + 'deg)';
        return c;
      }));
    }
    if (bump && !reducedMotion()) animate(discard, [{ scale: '1' }, { scale: '1.12' }, { scale: '1' }], { duration: 320, easing: 'cubic-bezier(.34,1.4,.64,1)', fill: 'none' });
  }
  /** The light on the felt leans towards whoever is to play (or answer). */
  function renderSpot() {
    const seat = V && V.phase !== 'over' ? timerSeat() ?? (V.phase === 'turn' ? V.current : null) : null;
    spot.classList.toggle('on', seat != null && !!geo);
    if (seat == null || !geo) return;
    const t = seatAngle(seat);
    spot.style.left = (geo.a + Math.cos(t) * geo.a * .5) + 'px';
    spot.style.top = (geo.b + Math.sin(t) * geo.b * .5) + 'px';
  }
  const ro = new ResizeObserver(() => { layoutSeats(); fitHand(); });
  ro.observe(stage); ro.observe(handEl);
  // The state column changes height with the room: keep the latest play (and "now") in view.
  const playsRo = new ResizeObserver(() => { playsList.scrollTop = playsList.scrollHeight; });
  playsRo.observe(playsList);
  const onWide = () => { syncChat(false); layoutSeats(); renderHud(); };
  wideQuery.addEventListener('change', onWide);

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
      setCount(i, i === me ? hand.length : p.count);
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
      const away = !!seatInfo(me).away;
      awayBtn.setAttribute('aria-pressed', String(away));
      awayBtn.setAttribute('aria-label', away ? 'I’m back' : 'Mark me away');
      awayBtn.classList.toggle('is-on', away);
      const out = seatInfo(me).finished || V.phase === 'over';
      forfeitBtn.hidden = out;
      awayBtn.hidden = out;
    }
    renderHud();
    renderSpot();
    updateTurnLine();
  }

  const nameOf = i => (i === me ? 'You' : seatsMeta[i].name.split(' ')[0]);

  /* ------------------------------------------------------------ game state column */
  function setHead(label, num) { baariLabel.textContent = label; baariNum.textContent = num; baariNum.hidden = num === ''; }
  function renderHud() {
    if (!V) return;
    const b = V.baari;
    if (V.phase === 'deal') setHead('Dealing', '');
    else if (V.phase === 'over') setHead('Game over', '');
    else setHead('Baari', b ? b.number : 1);
    // This baari: who played what, in order, then whoever is up.
    const rows = [];
    if (b && V.phase !== 'deal' && V.phase !== 'over') {
      const review = V.phase === 'review' ? V.review : null;
      for (const p of b.plays) {
        rows.push(h('li' + (p.thulla ? '.is-thulla' : ''),
          avatar(seatsMeta[p.seat], 'sm'), h('span.hp-name', nameOf(p.seat)),
          p.thulla ? h('span.ts-tag.ember', 'Thulla') : review && review.highest && review.highest.seat === p.seat ? h('span.ts-tag', 'Highest') : null,
          renderCard(p.card, { size: 22, mini: true })));
      }
      if (V.phase === 'turn' && V.current != null && !b.plays.some(p => p.seat === V.current)) {
        rows.push(h('li.is-now', avatar(seatsMeta[V.current], 'sm'), h('span.hp-name', nameOf(V.current)), h('span.hp-now', 'now')));
      }
    }
    playsList.replaceChildren(...rows);
    playsBlock.hidden = !rows.length;
    playsList.scrollTop = playsList.scrollHeight;
    const prev = b ? history.slice().reverse().find(x => x.number < b.number) : history[history.length - 1];
    lastEl.hidden = !prev;
    if (prev) {
      const giver = prev.plays.find(p => p.thulla);
      lastEl.replaceChildren(h('b', 'Baari ' + prev.number + ': '), prev.kind === 'thulla'
        ? h('span', h('span.ember', (giver ? nameOf(giver.seat) : 'Someone') + ' gave Thulla'), ', ' + (prev.collector === me ? 'you' : nameOf(prev.collector)) + ' picked up ' + prev.plays.length + '.')
        : h('span', 'cleared.'));
    }
  }
  const possessive = i => (i === me ? 'your' : nameOf(i) + '’s');
  const cap = s => s.replace(/^./, c => c.toUpperCase());

  function updateTurnLine() {
    if (V.phase === 'over') { turnLine.textContent = 'Tallying the finishing order.'; return; }
    if (V.phase === 'deal') { turnLine.textContent = 'Cards go out anti-clockwise, one at a time.'; return; }
    if (V.phase === 'review') { turnLine.textContent = 'Baari ' + (V.review ? V.review.number : '') + ' is finished.'; return; }
    if (V.phase === 'reveal') { turnLine.textContent = 'Showing the cards that changed hands.'; return; }
    const rq = pendingRequest();
    if (rq) { turnLine.textContent = (rq.to === me ? 'You were' : nameOf(rq.to) + ' was') + ' asked for ' + (rq.to === me ? 'your' : 'their') + ' hand.'; return; }
    const b = V.baari;
    const now = V.phase !== 'turn' ? '' : V.current === me ? 'Your turn.' : nameOf(V.current) + ' is playing.';   // not mid-animation
    if (b && b.leadSuit && b.plays.length) turnLine.textContent = (cap(nameOf(b.plays[0].seat)) + ' led. ' + now).trim();
    else turnLine.textContent = V.current === me ? 'Your lead.' : nameOf(V.current) + ' to lead.';
  }

  function setLead() {
    const b = V && V.baari;
    leadChip.replaceChildren();
    if (!V || !b || V.phase === 'deal' || V.phase === 'over') return;     // the heading already says so
    if (b.number === 1 && !b.leadSuit) { leadChip.append(h('span.lc-open', 'Opens with A♠')); return; }
    if (!b.leadSuit) { leadChip.append(h('span.lc-open', 'Any shape')); return; }
    leadChip.append(h('span.lc-suit' + (RED[b.leadSuit] ? '.red' : ''), { title: 'The shape to follow' }, suitSvg(b.leadSuit), SUIT_NAMES[b.leadSuit]));
  }

  /* ------------------------------------------------------------ cleared panel */
  function clearedPanel() {
    const cells = {};
    const el = h('section.cleared', { 'aria-label': 'Cards cleared from play' },
      h('header', h('h2.hud-title', 'Cleared for good'), h('button.cleared-help', { type: 'button', 'aria-label': 'What counts as cleared?', title: 'What counts as cleared?', onclick: () => openModal({ title: 'Cleared cards', subtitle: 'Cards that have left the game for good.', body: [h('p', 'These counters show, for each shape, how many of its 13 cards are gone from play.'), h('ul.rule-list', h('li', 'Counted: the whole first baari, and every baari that clears normally.'), h('li', 'Not counted: cards in hands, cards on the table right now, Thulla piles and handed-over hands — those cards are still in play.'))] }) }, icon('i-info'))),
      h('div.cleared-grid', SUIT_ORDER.map(s => {
        const num = h('b.num', '0'), fill = h('span.cbar-fill');
        const cell = h('div.ccell' + (RED[s] ? '.red' : ''), { 'data-suit': s, title: SUIT_NAMES[s] }, h('span.cbar', fill), suitSvg(s), h('span.cval', num), h('span.sr-only', SUIT_NAMES[s] + ' of 13'));
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
          cells[s].fill.style.setProperty('--f', String(v / 13));
        });
      },
    };
  }

  /* ------------------------------------------------------------ hand */
  function handCardSize() {
    const w = window.innerWidth, hh = window.innerHeight;
    const byWidth = w < 560 ? 68 : w < 900 ? 84 : 170;
    return Math.round(Math.min(byWidth, hh < 640 ? 64 : hh < 760 ? 80 : Math.max(92, hh * .118)));   // grows with tall screens
  }
  const liftRoom = () => (root.classList.contains('is-phone') ? 24 : 32);            // space above the hand for a lifted card
  const handCards = () => Array.from(handEl.querySelectorAll(':scope > .pcard'));
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
    // Cards are kept by id and only updated, never rebuilt: rebuilding restarts every
    // card's transitions, so the whole hand would pulse whenever anything changed.
    const old = new Map(handCards().map(c => [c.dataset.card, c]));
    const fresh = [];
    const els = ids.map((id, i) => {
      let el = old.get(id);
      if (el) old.delete(id);
      else {
        el = withDeck(renderCard(id, { size: lay.cw || handCardSize(), button: true }), me);
        el.setAttribute('role', 'option');
        el.dataset.label = el.getAttribute('aria-label');
        el.classList.add('no-trans');                                // appears in place, no slide-in
        el.addEventListener('click', () => onCardClick(id, el));
        el.addEventListener('dblclick', () => humanPlay(id));
        el.addEventListener('keydown', e => onCardKey(e, handCards().indexOf(el)));
        fresh.push(el);
      }
      const can = turn && legal.has(id);
      el.classList.remove('is-playable', 'is-disabled', 'is-idle', 'is-selected', 'will-thulla');
      el.classList.add(turn ? (can ? 'is-playable' : 'is-disabled') : 'is-idle');
      el.classList.toggle('is-selected', selected === id);
      el.classList.toggle('will-thulla', selected === id && willThulla(id));
      el.classList.toggle('is-new', newCards.has(id));
      el.setAttribute('aria-selected', String(selected === id));
      el.setAttribute('aria-disabled', String(!can));
      el.setAttribute('aria-label', el.dataset.label + (turn ? (can ? (willThulla(id) ? ' — gives Thulla' : ' — playable') : ' — cannot play') : ''));
      el.tabIndex = (selected ? selected === id : i === 0) ? 0 : -1;
      el.style.zIndex = String(selected === id ? 300 : i + 1);     // a lifted card sits above its neighbours
      return el;
    });
    old.forEach(el => el.remove());
    // Put each card before its right-hand neighbour, touching only cards that are out of place.
    let next = null;
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].parentNode !== handEl || els[i].nextElementSibling !== next) handEl.insertBefore(els[i], next);
      next = els[i];
    }
    fitHand();
    if (fresh.length) requestAnimationFrame(() => requestAnimationFrame(() => fresh.forEach(el => el.classList.remove('no-trans'))));
    updateTally();
    playBtn.disabled = !(turn && selected && legal.has(selected));
    const th = !!(selected && turn && willThulla(selected));
    playBtn.textContent = th ? 'Give Thulla' : selected && turn && legal.has(selected) ? 'Play ' + shortCard(parseCard(selected)) : 'Play card';
    playBtn.classList.toggle('btn-thulla', th);
    const canReq = turn && V.requestTarget != null && V.baari.plays.length === 0 && !V.baari.requestUsed;
    reqBtn.hidden = !canReq;
    if (canReq) reqBtn.querySelector('span').textContent = 'Request ' + possessive(V.requestTarget) + ' hand';
    updateHint(turn);
    dock.classList.toggle('my-turn', !!turn);
    renderMySlot();
  }

  let lay = { cw: 0, rows: 1, k: 0 };
  /**
   * Hold the hand in an arc. A bigger hand overlaps more, then the cards shrink a
   * little, then it splits into rows (back rows higher, behind) — it never scrolls,
   * so every card is always in reach. Each card keeps its corner index showing.
   */
  function fitHand() {
    const cards = handCards(), k = cards.length;
    const W = handEl.clientWidth;
    if (!W) return;
    const phone = root.classList.contains('is-phone');
    const L = liftRoom();
    const minStep = .3;                                              // share of a covered card left showing
    let cw = handCardSize();
    const minCw = phone ? 50 : 70;
    const perRow = c => Math.max(1, Math.floor((W - 8 - c) / (c * minStep)) + 1);
    while (cw > minCw && perRow(cw) < k) cw -= 2;
    const rows = Math.max(1, Math.ceil(k / perRow(cw)));
    const per = Math.ceil(k / rows);
    const ch = cw * 1.4;
    const R = Math.max(W * 1.8, 700);                                // arc radius: a gentle curve
    // The end cards lean outwards, so their top corners need room inside the edges too.
    const pitchOf = m => {
      if (m < 2) return 0;
      let p = Math.min(cw * .62, (W - 8 - cw) / (m - 1));
      const lean = ch * Math.sin(((m - 1) / 2) * p / R);
      return Math.min(cw * .62, (W - 8 - cw - 2 * lean) / (m - 1));
    };
    const sag = m => R * (1 - Math.cos(((m - 1) / 2) * pitchOf(m) / R));
    const rowStep = ch * .42;
    handEl.style.height = Math.ceil(L + ch + (rows - 1) * rowStep + sag(Math.min(per, k)) + (phone ? 6 : 10)) + 'px';
    for (let r = 0; r < rows; r++) {
      const row = cards.slice(r * per, (r + 1) * per), m = row.length, pitch = pitchOf(m);
      row.forEach((c, j) => {
        const th = (j - (m - 1) / 2) * pitch / R;
        c.style.setProperty('--cw', cw + 'px');
        c.style.left = (W / 2 + R * Math.sin(th) - cw / 2) + 'px';
        c.style.top = (L + r * rowStep + R * (1 - Math.cos(th))) + 'px';
        c.style.setProperty('--rot', (th * 180 / Math.PI).toFixed(2) + 'deg');
      });
    }
    lay = { cw, rows, k };
    dock.style.setProperty('--lift-room', L + 'px');
    root.style.setProperty('--dock-h', dock.offsetHeight + 'px');
  }

  function updateTally(cards = hand) {
    const lead = myTurn() && V.baari && V.baari.leadSuit;
    SUIT_ORDER.forEach(s => {
      const k = cards.reduce((a, id) => a + (id.slice(-1) === s ? 1 : 0), 0);
      const t = tallyEls[s];
      t.num.textContent = k;
      t.b.disabled = !k;
      t.b.classList.toggle('is-lead', lead === s);
      t.b.title = plural(k, SUIT_NAMES[s].replace(/s$/, '')) + (k ? ' — show them' : '');
      t.b.setAttribute('aria-label', k + ' ' + SUIT_NAMES[s] + (lead === s ? ', the shape to follow' : ''));
    });
  }

  /** Tally tap: briefly lift that shape's cards. */
  function showSuit(s) {
    const all = handCards();
    const idx = all.map((c, i) => (c.dataset.card && c.dataset.card.slice(-1) === s ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return;
    const cards = idx.map(i => all[i]);
    cards.forEach(c => { c.classList.remove('suit-flash'); void c.offsetWidth; c.classList.add('suit-flash'); });
    later(() => cards.forEach(c => c.classList.remove('suit-flash')), 1200);
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
    const cards = handCards();
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
  /*
   * When it is your move and your clock is low — the last 10 s (the last 40% of a short
   * turn) — the whole room says so: the screen edges glow and pulse, your avatar turns
   * into a big ticking countdown, the timer reads "Hurry", playable cards and the play
   * button throb, the browser tab shows the seconds, and (with sound on) a clock ticks.
   * The last three seconds go harder still.
   */
  const lowAt = () => (settings.turnSeconds > 16 ? 10000 : Math.max(3000, settings.turnSeconds * 1000 * .4));
  const baseTitle = document.title;
  let lowSec = null;
  function setUrgency(sec) {
    const on = sec != null;
    root.classList.toggle('time-low', on);
    root.classList.toggle('time-crit', on && sec <= 3);
    if (!on) { lowSec = null; urgentSr.textContent = ''; if (document.title !== baseTitle) document.title = baseTitle; return; }
    if (sec === lowSec) return;
    const first = lowSec == null;
    lowSec = sec;
    myClock.textContent = sec;
    document.title = '(' + sec + 's) Your turn! · ' + baseTitle;
    if (first || sec === 5) urgentSr.textContent = sec + ' seconds left. If time runs out, a card is played for you.';
    if (!reducedMotion()) {
      animate(myClock, [{ transform: 'scale(1.7)', opacity: .4 }, { transform: 'scale(.92)', opacity: 1, offset: .45 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.34,1.5,.64,1)', fill: 'none' });
      if (sec <= 3) animate(dock.querySelector('.prompt-row'), [{ translate: '0 0' }, { translate: '-5px 0', offset: .2 }, { translate: '5px 0', offset: .4 }, { translate: '-3px 0', offset: .6 }, { translate: '2px 0', offset: .8 }, { translate: '0 0' }], { duration: 360, fill: 'none' });
    }
    playSound(sec <= 3 ? 'tick-hi' : 'tick');
    if ((first || sec <= 3) && navigator.vibrate) { try { navigator.vibrate(sec <= 3 ? 90 : 50); } catch { /* not allowed */ } }
  }

  function showDeadline() {
    clearInterval(tick); tick = null;
    setUrgency(null);
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
    const low = lowAt();
    const update = () => {
      const l = end - Date.now();
      const urgent = mine && l <= low && l > 0;
      const warn = l <= warnAt || urgent;
      seatEls[seat].classList.toggle('time-warn', warn);
      if (mine) {
        timerText.textContent = urgent ? 'Hurry! ' + Math.ceil(l / 1000) + 's' : clockFormat(Math.max(0, l) / 1000);
        timerPill.classList.toggle('warn', warn);
        setUrgency(urgent ? Math.ceil(l / 1000) : null);
      }
      if (rm) { const f = Math.max(0, l) / Math.max(total, 1); seatEls[seat].ring.run(f, 0); if (mine) timerFill.style.width = (f * 100) + '%'; }
      if (l <= 0) { clearInterval(tick); tick = null; }
    };
    update();
    // A cheap tick for the number and the warning state (4× a second on your own clock, so the
    // countdown changes on the second); the ring and bar themselves are CSS transitions.
    tick = setInterval(update, mine ? 250 : 1000);
  }

  /* ------------------------------------------------------------ pile
     The pile lies on the felt, so it is drawn in the table's plane: each card
     sits on the side of whoever played it, further out and smaller on a full table. */
  function pileSize() {
    const g = geo || { a: 400, b: 280 };
    const k = Math.min(g.a * (g.a < 200 ? .38 : .27), g.b * .4) * (n <= 4 ? 1 : n <= 6 ? .9 : n <= 8 ? .76 : n <= 12 ? .64 : n <= 20 ? .52 : .44);
    return Math.round(Math.max(n > 12 ? 34 : 44, Math.min(200, k)));
  }
  /** Where a seat's card lies: just in front of the middle, leaning towards that player. */
  function slotTransform(seat, index) {
    const g = geo || { a: 400, b: 280 };
    const t = seatAngle(seat), rf = n <= 4 ? .25 : n <= 6 ? .28 : n <= 8 ? .32 : n <= 12 ? .38 : .52;
    return { x: Math.cos(t) * g.a * rf, y: Math.sin(t) * g.b * rf * 1.15, rot: ((index * 47) % 15) - 7 + Math.cos(t) * 9 };
  }
  /** How big a flat card looks where it lands on the tilted table (x, y scale). */
  function planeScale(y) {
    if (!geo) return [1, 1];
    const s = geo.P / (geo.P - y * geo.sinT);
    return [s, s * geo.cosT];
  }
  function addPileCard(seat, card, index, hidden) {
    const cw = pileSize();
    const t = slotTransform(seat, index);
    const slot = h('div.pslot', { 'data-seat': seat, 'data-y': t.y, 'data-rot': t.rot, style: { transform: 'translate(' + t.x + 'px,' + t.y + 'px)', zIndex: String(index + 1) } });
    const c = withDeck(renderCard(card, { size: cw }), seat);
    c.style.transform = 'rotate(' + t.rot + 'deg)';
    slot.appendChild(c);
    slot.style.marginLeft = (-cw / 2) + 'px'; slot.style.marginTop = (-cw * 0.7) + 'px';
    // Who played it: a name tab on the edge facing that player, so the next card rarely covers it.
    const above = Math.sin(seatAngle(seat)) < -0.3;
    slot.appendChild(h('span.pc-who' + (seat === me ? '.me' : ''), { style: { left: cw / 2 + 'px', top: (above ? -8 : cw * 1.4 - 8) + 'px' } }, nameOf(seat)));
    if (hidden) slot.style.visibility = 'hidden';
    pileEl.appendChild(slot);
    return { slot, card: c, rot: t.rot, cw, y: t.y };
  }

  /** Your empty spot on the table, while it is your turn — showing the card you have picked. */
  function renderMySlot() {
    const show = me >= 0 && !!V && V.phase === 'turn' && V.current === me && !busy && !pendingRequest() && !seatInfo(me).finished;
    mySlot.hidden = !show;
    if (!show) return;
    const cw = pileSize(), t = slotTransform(me, 0);
    mySlot.style.width = cw + 'px'; mySlot.style.height = cw * 1.4 + 'px';
    mySlot.style.transform = 'translate(' + (t.x - cw / 2) + 'px,' + (t.y - cw * .7) + 'px)';
    const key = (selected || '') + ':' + cw;
    if (mySlot.dataset.key !== key) {
      mySlot.dataset.key = key;
      mySlot.replaceChildren(selected ? withDeck(renderCard(selected, { size: cw, className: 'ghost' }), me) : h('span.ms-label', 'Your card'));
    }
  }

  /** Screen point (relative to the stage) → the matching point on the table's plane, from its centre. */
  function screenToPlane(sx, sy) {
    const g = geo, ys = sy - g.cy, xs = sx - g.cx;
    const den = g.P * g.cosT + ys * g.sinT;
    const v = den > 1 ? ys * g.P / den : -g.b * 3;
    return { u: xs * (g.P - v * g.sinT) / g.P, v, k: g.P / (g.P - v * g.sinT) };
  }
  /**
   * Play a card onto the table. The card travels on the table itself (in 3D): it starts
   * upright where it was — your hand, or the player's seat — lifts in an arc, tips over and
   * settles flat on its spot, so there is no jump between a flat flight and the tilted table.
   */
  async function flyToSlot(target, fromRect, opts = {}) {
    const slot = target.slot;
    const end = slot.style.transform;
    if (!geo) { slot.style.visibility = ''; return; }
    const sr = stage.getBoundingClientRect();
    const p = screenToPlane(fromRect.left + fromRect.width / 2 - sr.left, fromRect.top + fromRect.height / 2 - sr.top);
    const lim = Math.max(geo.a, geo.b) * 2.4;
    const u0 = Math.max(-lim, Math.min(lim, p.u)), v0 = Math.max(-lim, Math.min(lim, p.v));
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(end) || [0, 0, 0];
    const x = Number(m[1]), y = Number(m[2]);
    const up = -geo.tilt * 180 / Math.PI;                         // undoes the table's tilt: the card faces you
    const s0 = Math.max(.35, Math.min(1.6, (opts.fromScale ? opts.fromScale : fromRect.width / target.cw) / p.k));
    const arc = Math.max(40, geo.b * .35);
    slot.style.visibility = '';
    if (opts.thulla) {
      await slapInPlane(slot, end, { u0, v0, x, y, up, s0 });
      return;
    }
    await animate(slot, [
      { transform: `translate3d(${u0}px,${v0}px,0px) rotateX(${up}deg) scale(${s0})`, opacity: opts.fromOpacity != null ? opts.fromOpacity : 1 },
      { transform: `translate3d(${(u0 + x) / 2}px,${(v0 + y) / 2}px,${arc}px) rotateX(${up * .45}deg) scale(${(s0 + 1) / 2})`, opacity: 1, offset: .5 },
      { transform: `translate3d(${x}px,${y}px,0px) rotateX(0deg) scale(1)`, opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'none' });
  }

  /* The Thulla card slap: raised high over the table, a wind-up, then slammed flat. */
  async function slapInPlane(slot, end, { u0, v0, x, y, up, s0 }) {
    slot.firstChild.classList.add('thulla-card');
    later(() => slot.firstChild && slot.firstChild.classList.remove('thulla-card'), 1400);
    if (reducedMotion()) { await animate(slot, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, essential: true, fill: 'none' }); return; }
    // Every keyframe lists the same transform functions, so the browser blends them smoothly.
    const hi = Math.max(70, geo.b * .42);
    const at = (u, v, z, rx, rz, k) => `translate3d(${u}px,${v}px,${z}px) rotateX(${rx}deg) rotate(${rz}deg) scale(${k})`;
    const raised = at(x, y, hi, up * .7, -12, 1.15), wound = at(x + 4, y, hi * 1.15, up * .7, -17, 1.18);
    await animate(slot, [{ transform: at(u0, v0, 0, up, 0, s0) }, { transform: raised }], { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'none' });
    await animate(slot, [{ transform: raised }, { transform: wound }], { duration: 130, easing: 'ease-out', fill: 'none' });
    await animate(slot, [{ transform: wound }, { transform: at(x, y, 0, 0, 0, .97) }, { transform: at(x, y, 0, 0, 0, 1) }], { duration: 160, easing: 'cubic-bezier(.75,0,.95,.45)', fill: 'none' });
  }

  /*
   * Thulla is the moment of the game, so it lands hard: the card slams, the room jolts,
   * a red flash, shockwaves and debris on the felt, and a huge stamp naming who did it.
   * Then (on review) whoever has to pick up the pile gets publicly shamed.
   */
  function thullaImpact(giverSeat) {
    playSound('thulla-impact');
    const rm = reducedMotion();
    const wrap = pileWrap;
    animate(pileEl, [
      { transform: 'translate(0,0) scale(1,1)' }, { transform: 'translate(0,6px) scale(1.1,.8)', offset: .15 },
      { transform: 'translate(-6px,-3px) scale(.96,1.07)', offset: .38 }, { transform: 'translate(4px,0) scale(1.02,.98)', offset: .6 },
      { transform: 'translate(0,0) scale(1,1)' },
    ], { duration: 460, easing: 'ease-out', fill: 'none' });
    if (!rm) {
      // The whole room jolts. (Separate translate property: the felt's transform is its tilt.)
      animate(root, [
        { translate: '0 0' }, { translate: '-16px 10px', offset: .07 }, { translate: '14px -8px', offset: .18 }, { translate: '-10px 6px', offset: .3 },
        { translate: '7px -4px', offset: .45 }, { translate: '-4px 2px', offset: .62 }, { translate: '2px -1px', offset: .8 }, { translate: '0 0' },
      ], { duration: 700, easing: 'ease-out', fill: 'none' });
      animate(felt, [{ translate: '0 0' }, { translate: '-6px 4px', offset: .15 }, { translate: '6px -3px', offset: .35 }, { translate: '-2px 2px', offset: .6 }, { translate: '0 0' }], { duration: 420, fill: 'none' });
    }
    animate(flash, [{ opacity: 0 }, { opacity: 1, offset: .06 }, { opacity: .35, offset: .3 }, { opacity: 0 }], { duration: rm ? 300 : 900, fill: 'none', essential: true });
    for (let k = 0; k < 3; k++) {
      const ring = h('span.shock'); wrap.appendChild(ring);
      animate(ring, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .95 }, { transform: `translate(-50%,-50%) scale(${3.2 + k * 1.2})`, opacity: 0 }], { duration: 760, delay: k * 120, easing: 'cubic-bezier(.1,.7,.3,1)' }).then(() => ring.remove());
    }
    for (let k = 0; k < 26; k++) {
      const d = h('span.dust' + (k % 3 ? '' : '.ember')); wrap.appendChild(d);
      const ang = (k / 26) * Math.PI * 2 + Math.random() * .5, dist = 90 + Math.random() * 150;
      animate(d, [{ transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist * .7}px)) scale(.2)`, opacity: 0 }], { duration: 620 + Math.random() * 360, easing: 'cubic-bezier(.1,.8,.3,1)' }).then(() => d.remove());
    }
    stampBy.textContent = (giverSeat === me ? 'You' : nameOf(giverSeat)) + ' slammed it down';
    stampShame.hidden = true;
    stamp.hidden = false;
    animate(stamp, [
      { transform: 'translate(-50%,-50%) scale(4.5) rotate(-24deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.82) rotate(-5deg)', opacity: 1, offset: .5 },
      { transform: 'translate(-50%,-50%) scale(1.12) rotate(-9deg)', offset: .72 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-7deg)', opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.2,.9,.3,1.2)', essential: true });
    const sEl = seatEls[giverSeat];
    sEl.classList.add('flash-thulla'); later(() => sEl.classList.remove('flash-thulla'), 900);
  }

  const pick = a => a[Math.floor(Math.random() * a.length)];
  const TAUNTS = [
    (c, k) => 'Pick up all ' + k + ', ' + c + '!', (c, k) => c + ' eats the whole pile. +' + k,
    c => 'Oye hoye, ' + c + '!', c => c + ' is starting a collection.', (c, k) => 'Shabash ' + c + ', all ' + k + ' are yours!',
  ];
  const SELF_TAUNTS = [k => 'All ' + k + ' cards are yours. Ouch.', k => 'You eat the pile. +' + k, k => 'Collect your shame: +' + k];
  const LAUGHS = ['Hahaha!', 'Oye hoye!', 'Gaya!', 'Wah ji wah!', 'Le lo!', 'Uff!', 'Shabash!', 'Pakra gaya!', 'Hahahaha!'];
  /** Whoever has to pick up the Thulla pile is named on the stamp, marked, and laughed at. */
  function shameCollector(seat, k) {
    stampShame.textContent = seat === me ? pick(SELF_TAUNTS)(k) : pick(TAUNTS)(nameOf(seat), k);
    stampShame.hidden = false;
    stamp.hidden = false;
    animate(stampShame, [{ opacity: 0, transform: 'translateY(14px) scale(.6)' }, { opacity: 1, transform: 'translateY(-4px) scale(1.08)', offset: .6 }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.4,.64,1)', essential: true });
    seatEls[seat].classList.add('is-shamed');
    if (!reducedMotion()) animate(seatEls[seat].querySelector('.seat-av'), [{ rotate: '0deg' }, { rotate: '-14deg', offset: .2 }, { rotate: '12deg', offset: .4 }, { rotate: '-8deg', offset: .6 }, { rotate: '4deg', offset: .8 }, { rotate: '0deg' }], { duration: 700, fill: 'none' });
    // The rest of the table has a laugh.
    const others = seatsMeta.map((_, i) => i).filter(i => i !== seat && i !== me && !seatInfo(i).finished).sort(() => Math.random() - .5).slice(0, 4);
    const lines = LAUGHS.slice().sort(() => Math.random() - .5);      // everyone laughs differently
    others.forEach((i, j) => later(() => bubble(i, lines[j % lines.length], 'laugh', 2600), 260 + j * 230));
    playSound('turn');
  }
  function unshame() { seatEls.forEach(el => el.classList.remove('is-shamed')); }

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
    animate(banner, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, fill: 'none' });
    fill.style.width = Math.min(100, secsLeft / Math.max(.001, r.pileMs / 1000) * 100) + '%';
    fill.style.transitionDuration = secsLeft + 's';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));
  }

  /** Swap pile cards for flat copies in the fx layer, so they can fly anywhere on screen. */
  function liftPile(slots) {
    return slots.map(s => {
      const c = s.firstChild, r = c.getBoundingClientRect();
      const cw = parseFloat(c.style.getPropertyValue('--cw')) || pileSize();
      const [kx, ky] = planeScale(Number(s.dataset.y) || 0);
      const el = renderCard(c.dataset.card, { size: cw, className: 'flying' });
      if (c.dataset.deck) el.dataset.deck = c.dataset.deck;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      el.style.position = 'fixed'; el.style.left = (x - cw / 2) + 'px'; el.style.top = (y - cw * .7) + 'px';
      const t0 = `scale(${kx},${ky}) rotate(${Number(s.dataset.rot) || 0}deg)`;
      el.style.transform = t0;
      fx.appendChild(el);
      s.style.visibility = 'hidden';
      return { el, t0, x, y };
    });
  }

  /**
   * A cleared baari, in three beats: the cards slide together into a neat stack in
   * the middle, the stack flips face down, then the cards sail one by one in an arc
   * onto the discard pile, which ticks and bumps as each one lands.
   */
  async function animateClear(slots, fast) {
    if (fast || !slots.length) return;
    playSound('sweep');
    discard.hidden = false;
    const fl = liftPile(slots);
    const pr = pileWrap.getBoundingClientRect();
    const cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
    // Aim at the little stack itself (not the label beside it), so cards land exactly on it.
    const dr = discardStack.getBoundingClientRect();
    const tx = dr.left + dr.width / 2, ty = dr.top + dr.height / 2;
    // Every card gets a back, so it can really turn over.
    fl.forEach(f => f.el.appendChild(h('div.pcard-back', icon('taash-mark', 'mark'))));
    const at = (f, x, y, flip, rot, k) => `perspective(800px) translate(${x - f.x}px,${y - f.y}px) rotateY(${flip}deg) rotate(${rot}deg) scale(${k})`;
    const k0 = .9, n = fl.length;
    const stackXY = i => [cx + (i - (n - 1) / 2) * 1.2, cy - i * 1.6];
    // 1. Gather.
    await Promise.all(fl.map((f, i) => {
      const [x, y] = stackXY(i);
      return animate(f.el, [{ transform: f.t0 }, { transform: at(f, x, y, 0, (i % 3) - 1, k0) }], { duration: 280, delay: i * 35, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    }));
    if (destroyed) return;
    // 2. Flip the stack over, lifting it a little.
    await Promise.all(fl.map((f, i) => {
      const [x, y] = stackXY(i);
      return animate(f.el, [
        { transform: at(f, x, y, 0, (i % 3) - 1, k0) },
        { transform: at(f, x, y - 26, 90, 0, k0 * 1.08), offset: .5 },
        { transform: at(f, x, y, 180, (i % 3) - 1, k0) },
      ], { duration: 360, delay: i * 25, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' });
    }));
    if (destroyed) return;
    playSound('deal');
    // 3. Sail onto the pile, top card first, shrinking steadily all the way until each
    //    card is exactly the size of the pile's cards, then settle with a small bump.
    const cw = parseFloat(fl[0].el.style.getPropertyValue('--cw')) || 60;
    const ks = Math.max(.12, (dr.width || 26) / cw);                   // the pile card's size, as a scale
    const lerp = (a, b, t) => a + (b - a) * t;
    await Promise.all(fl.slice().reverse().map((f, j) => {
      const i = n - 1 - j, [x, y] = stackXY(i);
      const lift = 50 + j * 3;
      const pt = t => [lerp(x, tx, t), lerp(y, ty, t) - Math.sin(t * Math.PI) * lift];   // a gentle arc
      const k = t => lerp(k0, ks, 1 - Math.pow(1 - t, 1.6));                         // shrinks the whole way
      const spin = (j * 23) % 30 - 15;
      const frames = [0, .25, .5, .75, .92].map(t => ({ transform: at(f, ...pt(t), 180, lerp((i % 3) - 1, spin, t), k(t)), offset: t }));
      frames.push({ transform: at(f, tx, ty, 180, 0, ks * .9), offset: .97 });
      frames.push({ transform: at(f, tx, ty, 180, 0, ks), offset: 1 });
      return animate(f.el, frames, { duration: 560, delay: j * 75, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' }).then(() => {
        f.el.remove();
        playSound('deal');
        discardNum.textContent = String((parseInt(discardNum.textContent, 10) || 0) + 1);   // the count ticks up as each card lands
        if (!reducedMotion()) animate(discardStack, [{ scale: '1' }, { scale: '1.18' }, { scale: '1' }], { duration: 220, easing: 'cubic-bezier(.34,1.4,.64,1)', fill: 'none' });
      });
    }));
    playSound('chime');
  }

  async function animateCollect(seat, slots, count, fast) {
    if (!fast) {
      const fl = liftPile(slots);
      const pr = pileEl.getBoundingClientRect();
      const px = pr.left + pr.width / 2, py = pr.top + pr.height / 2;
      const gather = fl.map((f, i) => `translate(${px - f.x + i * 2}px, ${py - f.y - i * 2}px) scale(.9)`);
      await Promise.all(fl.map((f, i) => animate(f.el, [{ transform: f.t0 }, { transform: gather[i] }], { duration: 260, delay: i * 50, easing: 'cubic-bezier(.4,0,.2,1)' })));
      playSound('sweep');
      const to = seat === me ? handEl.getBoundingClientRect() : seatEls[seat].querySelector('.seat-av').getBoundingClientRect();
      const tx = to.left + to.width / 2, ty = to.top + to.height / 2;
      await Promise.all(fl.map((f, i) => animate(f.el, [
        { transform: gather[i], opacity: 1 },
        { transform: `translate(${tx - f.x}px, ${ty - f.y}px) scale(${seat === me ? .9 : .35})`, opacity: seat === me ? .9 : .2 },
      ], { duration: 560, delay: i * 45, easing: 'cubic-bezier(.55,0,.25,1)' }).then(() => f.el.remove())));
    }
    const cnt = seatEls[seat].querySelector(seatEls[seat].querySelector('.seat-count').offsetParent ? '.seat-count' : '.seat-badge');
    animate(cnt, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: .35 }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    if (!fast && !reducedMotion()) animate(seatEls[seat].querySelector('.seat-av'), [{ scale: '1' }, { scale: '1.35 .7', offset: .25 }, { scale: '.9 1.15', offset: .55 }, { scale: '1' }], { duration: 520, easing: 'ease-out', fill: 'none' });
    const plus = h('span.plus-pop', '+' + count);
    seatEls[seat].appendChild(plus);
    animate(plus, [
      { opacity: 0, transform: 'translate(-50%,0) scale(2.6) rotate(-10deg)' },
      { opacity: 1, transform: 'translate(-50%,-14px) scale(.9) rotate(4deg)', offset: .18 },
      { opacity: 1, transform: 'translate(-50%,-20px) scale(1.05) rotate(-3deg)', offset: .3 },
      { opacity: 1, transform: 'translate(-50%,-26px) scale(1) rotate(-3deg)', offset: .75 },
      { opacity: 0, transform: 'translate(-50%,-44px) scale(1) rotate(-3deg)' },
    ], { duration: 1800 }).then(() => plus.remove());
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

  function bubble(seat, text, kind, ms = 2600) {
    const b = seatEls[seat].querySelector('.seat-bubble');
    b.textContent = text; b.className = 'seat-bubble b-' + kind; b.hidden = false;
    // Centred on the avatar; near an edge the box slides in to stay on screen while its
    // tail keeps pointing at the avatar.
    b.style.marginLeft = '0px'; b.style.removeProperty('--tail');
    const rr = root.getBoundingClientRect(), r = b.getBoundingClientRect();
    const dx = r.left < rr.left + 8 ? rr.left + 8 - r.left : r.right > rr.right - 8 ? rr.right - 8 - r.right : 0;
    const k = parseFloat(root.style.getPropertyValue('--s')) || 1;
    if (dx) {
      b.style.marginLeft = dx / k + 'px';
      b.style.setProperty('--tail', 'clamp(14px, calc(50% - ' + (dx / k) + 'px), calc(100% - 14px))');
    }
    // Scale/translate properties, not transform: side seats position their bubbles with transform.
    animate(b, [{ opacity: 0, translate: '0 6px', scale: '.9' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 240, easing: 'cubic-bezier(.34,1.4,.64,1)', fill: 'none' });
    clearTimeout(b._t); b._t = later(() => { b.hidden = true; }, ms);
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
    // Counts (and your shape tally) climb as the cards land.
    const showCount = () => {
      seatEls.forEach((el, i) => setCount(i, counts[i]));
      if (me >= 0) { meCount.textContent = plural(counts[me], 'card'); updateTally(hand.slice(0, counts[me])); }
    };
    showCount();
    setLead(); setHead('Dealing', ''); turnLine.textContent = 'Dealing ' + order.length + ' cards.';
    handEl.replaceChildren();
    if (fast || reducedMotion()) return;
    const cw = pileSize();
    turnLine.textContent = 'Shuffling…';
    const { deck, cards } = await animateShuffle(cw);
    if (destroyed) return;
    turnLine.textContent = 'Dealing ' + order.length + ' cards.';
    const dr = deck.getBoundingClientRect();       // zero-size box at the deck's centre
    const fw = 40, s0 = cw / fw;
    const step = Math.max(10, Math.min(24, 1200 / order.length));
    await Promise.all(order.map((seat, k) => new Promise(res => {
      later(() => {
        const mine = seat === me;
        const to = mine ? handEl.getBoundingClientRect() : seatEls[seat].querySelector('.seat-av').getBoundingClientRect();
        const el = withDeck(renderCard('back', { size: fw, className: 'flying' }), seat);
        el.style.position = 'fixed'; el.style.left = (dr.left - fw / 2) + 'px'; el.style.top = (dr.top - fw * .7) + 'px';
        fx.appendChild(el);
        // The deck thins out as it is dealt.
        const left = Math.ceil((order.length - k - 1) / order.length * cards.length);
        cards.forEach((c, i) => { c.style.visibility = i < Math.max(left, k < order.length - 1 ? 1 : 0) ? '' : 'hidden'; });
        const dx = to.left + to.width / 2 - dr.left, dy = to.top + to.height / 2 - dr.top;
        const spin = (k % 2 ? 1 : -1) * (mine ? 0 : 200);
        playSound('deal');
        animate(el, [
          { transform: `translate(0,0) rotate(0deg) scale(${s0})`, opacity: 1 },
          { transform: `translate(${dx * .55}px,${dy * .55 - 26}px) rotate(${spin * .6}deg) scale(${(s0 + 1) / 2})`, opacity: 1, offset: .5 },
          { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(${mine ? 1.1 : .7})`, opacity: mine ? .7 : .25 },
        ], { duration: 320, easing: 'cubic-bezier(.3,.6,.3,1)' })
          .then(() => {
            el.remove(); counts[seat]++; showCount();
            if (!mine) animate(seatEls[seat].querySelector('.seat-av'), [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 160, fill: 'none' });
            res();
          });
      }, k * step);
    })));
    deck.remove();
  }

  /* Shuffle on the felt: the deck lands, is riffled twice, then squared up. Visual
     only: the server has already shuffled and dealt. */
  const DECK_CARDS = 14;
  const stackAt = (i, dx = 0, rot = 0, lift = 0) => `translate(${dx - i * .35}px, ${-i * .55 - lift}px) rotate(${rot}deg)`;
  /** Move to `to`, setting the end state first so nothing flashes when the animation ends. */
  function slide(el, to, opts) {
    const from = el.style.transform || 'none';
    el.style.transform = to;
    return animate(el, [{ transform: from }, { transform: to }], { fill: 'none', ...opts });
  }
  async function animateShuffle(cw) {
    let cards = Array.from({ length: DECK_CARDS }, (_, i) => {
      const c = renderCard('back', { size: cw });
      c.style.transform = stackAt(i); c.style.zIndex = String(i + 1);
      return c;
    });
    const deck = h('div.deal-deck', cards);
    pileEl.appendChild(deck);
    await animate(deck, [{ opacity: 0, transform: 'translateY(-28px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1.2)', fill: 'none' });
    const spread = cw * .6, half = DECK_CARDS / 2;
    for (let round = 0; round < 2 && !destroyed; round++) {
      const a = cards.slice(0, half), b = cards.slice(half);
      // Cut: the halves slide apart and bend up, as if under the thumbs.
      await Promise.all([
        ...a.map((c, i) => slide(c, stackAt(i, -spread, -10, 6), { duration: 200, easing: 'cubic-bezier(.3,.7,.3,1)' })),
        ...b.map((c, i) => slide(c, stackAt(i, spread, 10, 6), { duration: 200, easing: 'cubic-bezier(.3,.7,.3,1)' })),
      ]);
      // Riffle: cards drop alternately from each half into one interleaved stack.
      const order = [];
      for (let i = 0; i < half; i++) round % 2 ? order.push(b[i], a[i]) : order.push(a[i], b[i]);
      await Promise.all(order.map((c, j) => new Promise(res => later(() => {
        c.style.zIndex = String(j + 1);
        if (j % 2 === 0) playSound('deal');
        slide(c, stackAt(j), { duration: 140, easing: 'cubic-bezier(.5,0,.6,1)' }).then(res);
      }, j * 22))));
      cards = order;
    }
    // Square the deck with a tap.
    await animate(deck, [{ transform: 'none' }, { transform: 'translateY(-5px) scale(1.03)' }, { transform: 'none' }], { duration: 220, fill: 'none' });
    return { deck, cards };
  }
  function fanInHand() {
    if (reducedMotion()) return;
    handCards().forEach((c, i) => animate(c, [{ transform: 'translateY(40px) rotate(-6deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: i * 30, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' }));
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
          toast('Time’s up, so a card was played for you.', { icon: 'i-clock', duration: 3600 });
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
        if (ev.kind === 'thulla' && ev.collector != null && !fast) shameCollector(ev.collector, V.baari.plays.length);
        renderHand(); renderSeats(); setLead(); showDeadline();
        break;
      }
      case 'resolved': {
        busy = true;
        banner.hidden = true;
        if (!stamp.hidden) animate(stamp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => { stamp.hidden = true; });
        const slots = Array.from(pileEl.children);
        V.cleared = ev.clearedCounts;
        if (ev.collected) { await animateCollect(ev.collected.seat, slots, ev.collected.cards.length, fast); later(unshame, 1300); }
        else await animateClear(slots, fast);
        if (destroyed) return;
        pileEl.replaceChildren();
        V.seats = ev.seats;
        V.finishOrder = ev.seats.filter(s => s.finished).sort((a, b) => a.place - b.place).map(s => s.seat);
        if (cleared) cleared.update(!fast);
        renderDiscard(!fast && !ev.collected);
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
        overlay.appendChild(over);
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
    overlay.querySelectorAll('.over-card').forEach(e => e.remove());
    banner.hidden = true; stamp.hidden = true; unshame();
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
    renderDiscard();
    renderSeats(); renderHand(); setLead(); showDeadline();
    const rq = pendingRequest();
    if (rq && rq.to === me && V.deadline && !seatInfo(me).away) askHuman(rq.from, V.deadline.at);
    if (V.phase === 'over') hooks.onGameOver?.();
  }

  /* ------------------------------------------------------------ drawers */
  function openInfo() {
    const rows = settingsSummary(settings).map(r => h('div.kv', h('span.faint', r.label), h('b', r.value)));
    rows.unshift(h('div.kv', h('span.faint', 'Table design'), h('b', designWhose() || 'Classic baize')));
    const order = h('ol.seat-order', seatsMeta.map((p, i) => h('li', avatar(p, 'sm'), h('span', i === me ? p.name + ' (you)' : p.name), p.isHost ? h('span.chip.chip-gold', icon('i-crown'), 'Host') : null, h('span.faint.num', plural(i === me ? hand.length : seatInfo(i).count, 'card')))));
    openModal({ drawer: true, eyebrow: 'Table ' + code, title: 'Table info', body: [
      h('div.kv-grid', rows),
      h('h3.sub', 'Seats, anti-clockwise'), order,
    ] });
  }

  /** Every baari so far, newest first. */
  function openLog() {
    const log = h('ol.baari-log', history.slice().reverse().map(b => h('li',
      h('div.bl-head', h('b', 'Baari ' + b.number), h('span.chip' + (b.kind === 'thulla' ? '.chip-ember' : '.chip-mist'), b.kind === 'thulla' ? 'Thulla → ' + nameOf(b.collector) : 'Cleared')),
      h('div.card-row', b.plays.map(p => h('div.bl-play', withDeck(renderCard(p.card, { size: 34, mini: true, className: p.thulla ? 'is-thulla' : '' }), p.seat), h('span.faint', nameOf(p.seat))))))));
    openModal({ drawer: true, eyebrow: 'Table ' + code, title: 'Baari log', subtitle: history.length ? plural(history.length, 'baari') + ' played so far' : null,
      body: [history.length ? log : h('p.muted', 'Finished baaris will appear here.')] });
  }

  /** Who's at the table (React draws it, so it can offer Add friend). */
  function playersInfo() {
    return seatsMeta.map((p, i) => {
      const st = V ? seatInfo(i) : {};
      return {
        id: p.id, name: p.name, handle: p.handle || null, userId: p.userId || null, guest: !!p.guest, bot: p.bot || null, isHost: !!p.isHost,
        you: i === me, count: i === me ? hand.length : st.count ?? 0, finished: !!st.finished, place: st.place ?? null, away: !!st.away,
        turn: !!V && V.phase === 'turn' && V.current === i,
      };
    });
  }
  function openPlayers() { hooks.openPlayers?.(playersInfo()); }

  /** Phones: everything the corner holds on a big screen, in one sheet. */
  function openMenu() {
    const playing = !spectating && V && V.phase !== 'over' && !seatInfo(me).finished;
    const item = (ic, label, fn, cls = '') => h('button.menu-row' + cls, { type: 'button', onclick: () => { m.close(); fn(); } }, icon(ic), h('span', label));
    const m = openModal({ drawer: true, eyebrow: 'Table ' + code, title: 'Menu', body: [h('div.menu-rows',
      item('i-book', 'How to play', () => hooks.openRules()),
      item('i-sliders', 'Table info', openInfo),
      item('i-list', 'Baari log', openLog),
      item('i-users', 'Players', openPlayers),
      item(soundEnabled() ? 'i-sound' : 'i-mute', soundEnabled() ? 'Sound: on' : 'Sound: off', toggleSound),
      playing ? item('i-wifi-off', seatInfo(me).away ? 'I’m back' : 'Mark me away', toggleAway) : null,
      playing ? item('i-flag', 'Forfeit the game', forfeit, '.danger') : null,
      item('i-back', spectating ? 'Stop watching' : 'Leave the game', leave),
    )] });
  }

  /** Step away: auto-play takes your turns at once (instead of after three timeouts). */
  function toggleAway() {
    if (spectating || !V) return;
    sendAction({ type: seatInfo(me).away ? 'back' : 'away' });
  }

  function toggleBoard(open) {
    board.hidden = !open;
    boardBtn.setAttribute('aria-expanded', String(open));
    if (open) { renderMix(); later(() => board.querySelector('button, input')?.focus(), 30); }
  }
  const onBoardOutside = e => { if (!board.hidden && !board.contains(e.target) && !boardBtn.contains(e.target)) toggleBoard(false); };
  document.addEventListener('pointerdown', onBoardOutside);
  let sounds = [];
  fetch('/api/sounds', { cache: 'no-store' }).then(r => r.json()).then(j => { sounds = j.sounds || []; renderBoard(); }).catch(() => renderBoard());
  function renderBoard() {
    if (destroyed) return;
    boardWrap.hidden = !sounds.length;
    boardSounds.replaceChildren(h('p.sb-head', 'Play a sound'), h('div.sb-grid', sounds.map(snd => h('button.sb-play', { type: 'button', onclick: () => { emote(snd.id); toggleBoard(false); } },
      icon('i-sound'), h('span', snd.label)))));
    renderMix();
  }

  // Sound-board volume, on this device only: one slider for all of it, one per player.
  const volKey = p => 'sb-vol:' + (p.userId ? 'u' + p.userId : 'p' + p.id);
  const lastSound = new Map();                        // player id → label of the last sound they played
  let boardVol = storage.get('sb-vol', 85);
  const playerVol = p => storage.get(volKey(p), 100);
  const pct = v => v + '%';
  function volSlider(label, value, onInput) {
    const out = h('output.sb-val.num', pct(value));
    const muteBtn = h('button.icon-btn.sb-mute', { type: 'button' });
    const range = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(value), 'aria-label': label + ' volume' });
    let before = value || 100;
    const show = v => {
      range.value = String(v); out.textContent = pct(v); range.setAttribute('aria-valuetext', pct(v));
      range.style.setProperty('--fill', v + '%');
      muteBtn.replaceChildren(icon(v ? 'i-sound' : 'i-mute'));
      muteBtn.setAttribute('aria-label', (v ? 'Mute ' : 'Unmute ') + label); muteBtn.title = v ? 'Mute' : 'Unmute';
    };
    const set = v => { show(v); onInput(v); };
    show(value);
    range.addEventListener('input', () => { const v = +range.value; if (v) before = v; set(v); });
    muteBtn.addEventListener('click', () => set(+range.value ? 0 : before));
    return [muteBtn, range, out];
  }
  function renderMix() {
    if (destroyed) return;
    const people = seatsMeta.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== me && !p.bot);
    boardMix.replaceChildren(
      h('p.sb-head', 'Volume', h('span.faint', ' · this device only')),
      h('div.sb-row.sb-all', h('span.sb-who', h('b', 'All sounds')), ...volSlider('Sound board', boardVol, v => { boardVol = v; storage.set('sb-vol', v); })),
      ...people.map(({ p }) => h('div.sb-row' + (lastSound.has(p.id) ? '.has-last' : ''), { 'data-player': p.id },
        h('span.sb-who', avatar(p, 'sm'), h('span.sb-name', h('b', p.name), h('span.sb-last', lastSound.has(p.id) ? '♪ ' + lastSound.get(p.id) : 'No sounds yet'))),
        ...volSlider(p.name, playerVol(p), v => storage.set(volKey(p), v)))),
      ...(people.length ? [] : [h('p.sb-empty', 'No other players to adjust.')]),
    );
  }
  const audio = new Map();
  /** Play a sound-board file at this listener's volume. Respects the sound switch. */
  function playBoardSound(snd, volume) {
    if (!soundEnabled() || !snd.url || volume <= 0) return;
    let a = audio.get(snd.url);
    if (!a) { a = new Audio(snd.url); a.preload = 'auto'; audio.set(snd.url, a); }
    try { a.currentTime = 0; a.volume = Math.min(1, volume); a.play().catch(() => {}); } catch { /* audio unavailable */ }
  }
  async function emote(sound) {
    const r = await hooks.emote?.(sound);
    if (r && r.error) toast(r.error, { icon: 'i-info' });
  }
  /** Someone used the sound board: everyone hears it, and it pops up by their seat. */
  function onEmote(d) {
    const snd = sounds.find(x => x.id === d.sound)
      || { id: d.sound, label: labelFor(d.sound), url: '/sounds/' + encodeURIComponent(d.sound) + '.mp3' };
    const seat = seatsMeta.findIndex(p => p.id === d.from);
    const p = seatsMeta[seat];
    const volume = (boardVol / 100) * (p && seat !== me ? playerVol(p) / 100 : 1);
    playBoardSound(snd, volume);
    if (seat >= 0) bubble(seat, '♪ ' + snd.label, 'emote', 2200);
    // Name who played it, and keep it on their row in the mixer.
    lastSound.set(d.from, snd.label);
    const row = boardMix.querySelector('.sb-row[data-player="' + CSS.escape(d.from) + '"]');
    if (row) {
      row.classList.add('has-last');
      row.querySelector('.sb-last').textContent = '♪ ' + snd.label;
      row.classList.remove('is-playing'); void row.offsetWidth; row.classList.add('is-playing');
    }
    const who = seat === me ? 'You' : (d.name || (p && p.name) || 'Someone');
    const muted = !soundEnabled() || volume <= 0;
    const item = h('div.sb-feed-item' + (muted ? '.is-muted' : ''), p ? avatar(p, 'sm') : null,
      h('span.sb-feed-text', h('b', who), ' played ', h('b.sb-feed-snd', snd.label)), icon(muted ? 'i-mute' : 'i-sound'));
    sbFeed.prepend(item);
    while (sbFeed.children.length > 3) sbFeed.lastChild.remove();
    later(() => { item.classList.add('is-out'); later(() => item.remove(), 400); }, 3600);
  }

  async function forfeit() {
    if (spectating || !V || V.phase === 'over') return;
    const ok = await confirmDialog({
      title: 'Forfeit this game?',
      message: 'The game ends right now. You finish last and lose rating; everyone else shares the win. This can’t be undone.',
      confirmLabel: 'Forfeit the game', cancelLabel: 'Keep playing', danger: true,
    });
    if (!ok || destroyed) return;
    const r = await hooks.forfeit?.();
    if (r && r.error) toast(r.error, { icon: 'i-info' });
  }

  /**
   * Someone forfeited: the game stops, their seat goes grey and wobbles under a
   * white flag, a "boo" goes round the table, then everyone sees the results.
   */
  let forfeited = false;
  function onForfeit(d) {
    if (forfeited || destroyed) return;
    forfeited = true;
    queue.length = 0;
    clearInterval(tick); tick = null;
    setUrgency(null); closeAnswer(); hideReveal();
    const seat = d.seat;
    const el = seatEls[seat];
    if (el) {
      el.classList.add('is-forfeit');
      if (!reducedMotion()) animate(el.querySelector('.seat-av'), [{ rotate: '0deg' }, { rotate: '-18deg', offset: .2 }, { rotate: '14deg', offset: .45 }, { rotate: '-8deg', offset: .7 }, { rotate: '0deg' }], { duration: 900, fill: 'none' });
      const flag = h('span.forfeit-flag', { 'aria-hidden': 'true' }, '🏳️');
      el.appendChild(flag);
    }
    const card = h('div.over-card.forfeit-card', { role: 'status' },
      h('span.ff-flag', { 'aria-hidden': 'true' }, '🏳️'),
      h('h2.display', seat === me ? 'You forfeited' : nameOf(seat) + ' forfeited!'),
      h('p.muted', seat === me ? 'Everyone else shares the win.' : 'They waved the white flag. Everyone else wins.'));
    overlay.appendChild(card);
    animate(card, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(1.6) rotate(-6deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(.95) rotate(2deg)', offset: .6 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0)' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.2)', essential: true });
    const boos = ['Booo!', 'Darr gaya!', 'Bhaag gaya!', 'Shame, shame!', 'Itni jaldi?', 'Uff!'];
    seatsMeta.forEach((_, i) => { if (i !== seat && i !== me) later(() => bubble(i, boos[(i * 7 + seat) % boos.length], 'laugh', 2200), 200 + i * 160); });
    if (!reducedMotion()) {
      for (let k = 0; k < 14; k++) {
        const t = h('span.boo-bit', { 'aria-hidden': 'true' }, k % 3 ? '👎' : '🍅');
        const r = el ? el.getBoundingClientRect() : root.getBoundingClientRect();
        Object.assign(t.style, { left: (r.left + r.width / 2) + 'px', top: (r.top + r.height / 2) + 'px' });
        fx.appendChild(t);
        const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 90;
        animate(t, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(1.2)`, opacity: 1, offset: .5 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist * 1.3}px), calc(-50% + ${Math.sin(ang) * dist * 1.3 + 40}px)) scale(.8)`, opacity: 0 }], { duration: 1200 + Math.random() * 500, delay: k * 50 }).then(() => t.remove());
      }
    }
    later(() => hooks.onGameOver?.(), 3200);
  }

  async function leave() {
    if (spectating) { hooks.leave(); return; }
    const ok = await confirmDialog({ title: 'Leave this game?', message: 'The game goes on without you: your turns are played automatically and your result still counts. Come back with the table code any time. To give up instead, use Forfeit.', confirmLabel: 'Leave game', danger: true });
    if (ok) hooks.leave();
  }

  function readPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
  function writePref(key, v) { try { localStorage.setItem(key, v); } catch { /* storage blocked */ } }

  /** A chat message from another player pops up beside their seat for a few seconds. */
  function chatBubble(playerId, text) {
    const seat = seatsMeta.findIndex(p => p.id === playerId);
    if (destroyed || seat < 0 || seat === me) return;
    bubble(seat, text.length > 90 ? text.slice(0, 88).trimEnd() + '…' : text, 'chat', 5200);
  }

  /* ------------------------------------------------------------ start */
  document.body.classList.add('in-game');
  requestAnimationFrame(() => { if (!destroyed) layoutSeats(); });
  syncChat(false);
  applySnapshot(o.snapshot);

  function destroy() {
    destroyed = true;
    clearInterval(tick);
    setUrgency(null);
    timers.forEach(clearTimeout); timers.clear();
    closeAnswer();
    ro.disconnect(); playsRo.disconnect();
    wideQuery.removeEventListener('change', onWide);
    document.removeEventListener('pointerdown', onDocDown);
    document.removeEventListener('pointerdown', onBoardOutside);
    fx.replaceChildren();
    root.remove();
    document.body.classList.remove('in-game');
  }

  return {
    el: root, chatHost, pushEvents, pushHand, resync: applySnapshot, destroy, chatBubble, emote: onEmote, forfeit: onForfeit, playersInfo,
    setUnread(k) { chatDot.hidden = !k; chatDot.textContent = k; },
    setDeadline(dl, now) { if (!V) return; clockOffset = now - Date.now(); V.deadline = { ...(V.deadline || {}), ...dl }; showDeadline(); },
    get lastSeq() { return lastSeq; },
  };
}
