/* Synthesised sound effects (no audio files). Off by default; the player turns
   sound on from the table's sound button, so nothing plays unexpectedly. */
import { storage } from './dom.js';

let on = null;
export function soundEnabled() { if (on === null) on = !!storage.get('sound', false); return on; }

let ctx = null;
function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(c, dur) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  const src = c.createBufferSource(); src.buffer = buf; return src;
}
function env(c, g, t, a, peak, dec) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

const fx = {
  /** Thulla impact: a sharp card slap over a low thump. */
  'thulla-impact'() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const n = noise(c, .18), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = .7;
    n.connect(bp).connect(g).connect(c.destination); env(c, g, t, .002, .9, .14); n.start(t);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + .18);
    o.connect(og).connect(c.destination); env(c, og, t, .003, .8, .2); o.start(t); o.stop(t + .25);
  },
  card() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const n = noise(c, .06), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2400;
    n.connect(hp).connect(g).connect(c.destination); env(c, g, t, .002, .22, .05); n.start(t);
  },
  deal() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const n = noise(c, .04), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3200;
    n.connect(hp).connect(g).connect(c.destination); env(c, g, t, .001, .1, .03); n.start(t);
  },
  sweep() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const n = noise(c, .45), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'bandpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(3000, t + .4);
    n.connect(lp).connect(g).connect(c.destination); env(c, g, t, .08, .16, .35); n.start(t);
  },
  chime() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    [660, 990].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(g).connect(c.destination); env(c, g, t + i * .07, .01, .08, .5); o.start(t + i * .07); o.stop(t + 1);
    });
  },
  turn() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    o.connect(g).connect(c.destination); env(c, g, t, .005, .06, .15); o.start(t); o.stop(t + .2);
  },
  /** Clock tick for your last seconds: a dry woodblock click… */
  tick() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(700, t + .05);
    o.connect(g).connect(c.destination); env(c, g, t, .002, .05, .06); o.start(t); o.stop(t + .1);
  },
  /** …and a sharper, louder one for the final three. */
  'tick-hi'() {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(1000, t + .07);
    o.connect(g).connect(c.destination); env(c, g, t, .002, .1, .09); o.start(t); o.stop(t + .14);
  },
};


export function playSound(name) { if (soundEnabled() && fx[name]) { try { fx[name](); } catch { /* audio unavailable */ } } }
export function setSoundEnabled(v) { on = !!v; storage.set('sound', on); if (on) { ac(); playSound('card'); } }
