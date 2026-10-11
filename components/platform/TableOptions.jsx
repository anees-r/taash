'use client';
/* Platform options every table has: ranked or unranked, public or private, guests, spectators. */
import { Segmented, Stepper, Switch } from './controls';

export const defaultOptions = () => ({ ranked: true, visibility: 'private', allowGuests: true, spectators: 4 });

/** @param {{value:object, onChange:Function, guestHost?:boolean, minSpectators?:number}} p  guestHost: a guest is hosting, so guests are always allowed */
export function TableOptions({ value: o, onChange, guestHost, minSpectators = 0 }) {
  return (
    <div className="settings table-options">
      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="opt-ranked">Ranked game</label>
          <p className="hint">{o.ranked
            ? 'Results change Thulla ratings and earn coins for players with an account. Going out early wins more; only the player left holding the cards loses points.'
            : 'Just for fun: games are saved to history, but ratings and coins don’t change. You can fill empty seats with bots.'}{guestHost ? ' Guests are never rated.' : ''}</p></div>
        <div className="setting-control"><Switch id="opt-ranked" checked={o.ranked} onChange={v => onChange({ ...o, ranked: v })} label="Ranked game" /></div>
      </div>
      <div className="setting">
        <div className="setting-text"><span className="field-label">Who can find it</span>
          <p className="hint">{o.visibility === 'public'
            ? 'Listed under Open rooms for everyone online. Anyone can take a free seat or watch.'
            : 'Only people with the code, the link or an invite can join.'}</p></div>
        <div className="setting-control">
          <Segmented options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} value={o.visibility} onChange={v => onChange({ ...o, visibility: v })} label="Who can find it" />
        </div>
      </div>
      {guestHost ? null : (
        <div className="setting">
          <div className="setting-text"><label className="field-label" htmlFor="opt-guests">Allow guests</label>
            <p className="hint">{o.allowGuests ? 'Anyone can join with just a display name.' : 'Only players with a Taash account can sit or watch.'}</p></div>
          <div className="setting-control"><Switch id="opt-guests" checked={o.allowGuests !== false} onChange={v => onChange({ ...o, allowGuests: v })} label="Allow guests" /></div>
        </div>
      )}
      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="opt-spectators">Spectators</label>
          <p className="hint">{o.spectators ? 'Up to ' + o.spectators + ' people can watch. They see every card played, never anyone’s hand.' : 'Nobody can watch this table.'}</p></div>
        <div className="setting-control">
          <Stepper id="opt-spectators" value={o.spectators ?? 4} min={minSpectators} max={20} onChange={v => onChange({ ...o, spectators: v })} label="number of spectators" />
        </div>
      </div>
    </div>
  );
}

/** Small chips for headers and lists. */
export function OptionChips({ options }) {
  if (!options) return null;
  return (
    <>
      <span className={'chip' + (options.ranked ? ' chip-gold' : '')}>{options.ranked ? 'Ranked' : 'Unranked'}</span>
      <span className="chip">{options.visibility === 'public' ? 'Public' : 'Private'}</span>
      {options.allowGuests === false ? <span className="chip">Accounts only</span> : null}
      {options.spectators ? <span className="chip">Up to {options.spectators} watching</span> : null}
    </>
  );
}
