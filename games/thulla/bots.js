/**
 * Thulla bots: who they are and what they say. Personalities change how
 * boldly they play (see engine/strategy.js) and how chatty they are. Every
 * line is written here by hand; nothing is generated.
 */
import { PERSONALITIES } from './engine/strategy.js';

export const BOTS = [
  {
    id: 'bashir', name: 'Bashir Chacha', persona: 'cautious', chatty: 0.55, think: [1100, 2100],
    lines: {
      start: ['Chai is ready? Then deal me in.', 'Slowly, slowly. Cards don’t run away.', 'Bismillah. Let’s play.'],
      thulla: ['Sorry beta, I had no choice.', 'Thulla! Don’t look at me like that.', 'Rules are rules.'],
      collect: ['Arre, why always me?', 'My hand was getting lonely anyway.', 'Hmph. Patience, patience.'],
      finish: ['Alhamdulillah, I’m out. Carry on, children.', 'Done! Someone bring me another chai.'],
      lose: ['Next game, next game.', 'I let you win. Respect your elders.'],
      greet: ['Wa alaikum assalam!', 'Jeetay raho! Welcome.'],
    },
  },
  {
    id: 'rani', name: 'Rani Apa', persona: 'sharp', chatty: 0.45, think: [800, 1600],
    lines: {
      start: ['I’m counting every card. Just so you know.', 'Good luck. You’ll need it.'],
      thulla: ['Thulla. Pick it up, please.', 'Out of that shape since baari two. Were you not watching?'],
      collect: ['Fine. I’ll be out before you blink.', 'Noted. Revenge is coming.'],
      finish: ['Out. Nicely played, everyone. Mostly.', 'And that is how it’s done.'],
      lose: ['That should not have happened.', 'The cards were against me. Only today.'],
      greet: ['Hello! Ready to lose?', 'Salam! Sit, sit.'],
    },
  },
  {
    id: 'pappu', name: 'Pappu', persona: 'reckless', chatty: 0.7, think: [600, 1300],
    lines: {
      start: ['Aaj toh main hi jeetunga!', 'Shuffle faster yaar!', 'Let’s goooo!'],
      thulla: ['THULLA! Hahaha!', 'Boom! Take that!', 'Oops. Not sorry.'],
      collect: ['Yaar seriously?!', 'Why do I always do this…', 'Okay okay, I have a plan. Maybe.'],
      finish: ['I’M OUT! Told you!', 'Champion! Write it down!'],
      lose: ['Rematch. Right now.', 'It was the shuffle, I swear.'],
      greet: ['Heyyy!', 'Salam bhai! Let’s play!'],
    },
  },
  {
    id: 'nano', name: 'Nano', persona: 'steady', chatty: 0.35, think: [900, 1800],
    lines: {
      start: ['Play nicely, everyone.', 'Who’s dealing? Ah, already done.'],
      thulla: ['Sorry, sweetheart.', 'Thulla, I’m afraid.'],
      collect: ['Oh dear, more cards.', 'That’s alright, I’m not in a hurry.'],
      finish: ['There, I’m out. Well played.', 'All done. I’ll watch now.'],
      lose: ['Oh well. Another round?', 'You all played wonderfully.'],
      greet: ['Hello dear!', 'Wa alaikum assalam, beta.'],
    },
  },
];

export const BOT_BY_ID = Object.fromEntries(BOTS.map(b => [b.id, b]));
export const personaOf = botId => PERSONALITIES[BOT_BY_ID[botId]?.persona] || PERSONALITIES.steady;

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

/**
 * Lines the bots say in response to a batch of game events.
 * @param {object[]} events
 * @param {(seat:number) => string|null} botAt   bot id seated at `seat`, or null
 * @param {() => number} rng
 * @returns {{seat:number, text:string}[]}
 */
export function chatterFor(events, botAt, rng) {
  const out = [];
  const say = (seat, kind, boost = 1) => {
    const id = botAt(seat); if (!id) return;
    const b = BOT_BY_ID[id];
    if (rng() < b.chatty * boost) out.push({ seat, text: pick(b.lines[kind], rng) });
  };
  for (const ev of events) {
    if (ev.type === 'deal') {
      const bots = ev.seats.map(s => s.seat).filter(s => botAt(s));
      if (bots.length) say(pick(bots, rng), 'start', 1.4);
    } else if (ev.type === 'play' && ev.thulla) say(ev.seat, 'thulla');
    else if (ev.type === 'resolved') {
      if (ev.collected) say(ev.collected.seat, 'collect', 1.2);
      for (const f of ev.finished || []) say(f.seat, 'finish', 1.5);
    } else if (ev.type === 'over' && ev.loser != null) say(ev.loser, 'lose', 1.5);
  }
  return out;
}

/** A human said hello: one bot answers. */
export function greetingReply(text, botSeats, botAt, rng) {
  if (!botSeats.length || !/\b(salam|assalam|aoa|hi|hello|hey|hiya)\b/i.test(text)) return null;
  const seat = pick(botSeats, rng);
  return { seat, text: pick(BOT_BY_ID[botAt(seat)].lines.greet, rng) };
}
