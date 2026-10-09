'use client';
/**
 * Thulla table settings form — the prototype's form, plus the hand-reveal
 * duration, and the agreed timeout rule in place of the old placeholder.
 * `value` is the settings object; `onChange(next, valid)` on every edit.
 * Values are re-validated on the server.
 */
import { useState } from 'react';
import { Icon } from '@/components/platform/Icon';
import { Stepper, Segmented, Switch } from '@/components/platform/controls';
import { LIMITS, dealHint, formatDuration } from '../settings.js';

export function SettingsForm({ value: s, onChange, minPlayers = LIMITS.playersMin }) {
  const [turnText, setTurnText] = useState(() => String(s.turnUnit === 'm' ? +(s.turnSeconds / 60).toFixed(2) : s.turnSeconds));
  const [turnErr, setTurnErr] = useState(null);
  const set = (patch, valid = !turnErr) => onChange({ ...s, ...patch }, valid);

  function onTurnInput(text, unit = s.turnUnit) {
    setTurnText(text);
    const raw = parseFloat(text);
    const secs = unit === 'm' ? Math.round(raw * 60) : Math.round(raw);
    if (!Number.isFinite(raw) || secs < LIMITS.turnMin || secs > LIMITS.turnMax) {
      setTurnErr('Choose between 5 seconds and 10 minutes.');
      onChange({ ...s, turnUnit: unit }, false);
    } else {
      setTurnErr(null);
      onChange({ ...s, turnSeconds: secs, turnUnit: unit }, true);
    }
  }
  function onUnit(unit) {
    if (!turnErr) {
      setTurnText(String(unit === 'm' ? +(s.turnSeconds / 60).toFixed(2) : s.turnSeconds));
      onChange({ ...s, turnUnit: unit }, true);   // the duration itself is kept; only the display unit converts
    } else onTurnInput(turnText, unit);
  }

  return (
    <div className="settings">
      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="set-players">Seats</label><p className="hint">Four is the classic Thulla table. The host can start once two or more players are seated; the whole deck is always dealt.</p></div>
        <div className="setting-control">
          <div className="row-gap">
            <Stepper id="set-players" value={s.players} min={Math.max(LIMITS.playersMin, minPlayers)} max={LIMITS.playersMax} onChange={v => set({ players: v })} label="number of seats" />
            {s.players === 4 ? <span className="chip chip-gold"><Icon id="i-check" />Recommended</span> : null}
          </div>
          <span className="hint num">{dealHint(s.players)} when full</span>
          {s.players > 8 ? <span className="hint">Large tables work: seats get compact and hands get short.</span> : null}
        </div>
      </div>

      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="set-turn">Turn time limit</label><p className="hint">How long each player has to request or play. Shown as a countdown on the table.</p></div>
        <div className="setting-control">
          <div className="row-gap">
            <input className={'input num' + (turnErr ? ' invalid' : '')} id="set-turn" type="number" inputMode="decimal" style={{ width: 96 }}
              step={s.turnUnit === 'm' ? '0.25' : '1'} min={s.turnUnit === 'm' ? LIMITS.turnMin / 60 : LIMITS.turnMin} max={s.turnUnit === 'm' ? LIMITS.turnMax / 60 : LIMITS.turnMax}
              aria-describedby="set-turn-read set-turn-err" value={turnText} onChange={e => onTurnInput(e.target.value)} />
            <Segmented options={[{ value: 's', label: 'Seconds' }, { value: 'm', label: 'Minutes' }]} value={s.turnUnit} onChange={onUnit} label="Turn time unit" />
          </div>
          <span className="hint num" id="set-turn-read">{turnErr ? '' : 'Each turn: ' + formatDuration(s.turnSeconds)}</span>
          {turnErr ? <span className="error" id="set-turn-err">{turnErr}</span> : null}
        </div>
      </div>

      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="set-pile">Baari pile display</label><p className="hint">How long a finished baari stays on the table before it is cleared or collected. Separate from turn time.</p></div>
        <div className="setting-control">
          <div className="row-gap range-row">
            <input id="set-pile" type="range" min={LIMITS.pileMin} max={LIMITS.pileMax} step={0.5} value={s.pileSeconds} aria-valuetext={s.pileSeconds + ' seconds'} onChange={e => set({ pileSeconds: parseFloat(e.target.value) })} />
            <output className="num pile-out" htmlFor="set-pile">{s.pileSeconds}s</output>
          </div>
          <span className="hint">1–10 seconds · default 3</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="set-reveal">Hand reveal</label><p className="hint">When a player gives their hand to a request, everyone sees the cards that change hands for this long.</p></div>
        <div className="setting-control">
          <div className="row-gap range-row">
            <input id="set-reveal" type="range" min={LIMITS.revealMin} max={LIMITS.revealMax} step={0.5} value={s.revealSeconds} aria-valuetext={s.revealSeconds + ' seconds'} onChange={e => set({ revealSeconds: parseFloat(e.target.value) })} />
            <output className="num pile-out" htmlFor="set-reveal">{s.revealSeconds}s</output>
          </div>
          <span className="hint">2–20 seconds · default 5</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="set-cleared">Show cleared card counts</label>
          <p className="hint">Everyone sees how many of each shape have left the game for good. Thulla pickups go back into a hand, so they never count as cleared.</p></div>
        <div className="setting-control">
          <Switch id="set-cleared" checked={s.showCleared} onChange={v => set({ showCleared: v })} label="Show cleared card counts" />
          <div className="cleared-preview">
            {['C', 'D', 'S', 'H'].map(k => <span key={k} className={'cp' + (k === 'D' || k === 'H' ? ' red' : '')}><svg className="i" aria-hidden="true"><use href={'#suit-' + k} /></svg><span className="num">0/13</span></span>)}
          </div>
        </div>
      </div>

      <div className="setting">
        <div className="setting-text"><span className="field-label">When a turn runs out</span><p className="hint">The same rule for everyone, applied by the server.</p></div>
        <div className="setting-control">
          <span className="hint">The highest card you are allowed to play is played for you — a Thulla with your highest card if you are out of the shape. An unanswered hand request counts as <b>Keep</b>. Miss three turns in a row and you are marked away; your turns are then played straight away until you come back.</span>
        </div>
      </div>
    </div>
  );
}
