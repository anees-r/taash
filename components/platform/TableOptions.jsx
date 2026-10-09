'use client';
/* Platform options every table has: ranked or unranked, public or private. */
import { Segmented, Switch } from './controls';

export const defaultOptions = () => ({ ranked: true, visibility: 'private' });

export function TableOptions({ value: o, onChange, guestHost }) {
  return (
    <div className="settings table-options">
      <div className="setting">
        <div className="setting-text"><label className="field-label" htmlFor="opt-ranked">Ranked game</label>
          <p className="hint">{o.ranked
            ? 'Results change Thulla ratings for players with an account. Going out early wins more; leaving a game loses the most.'
            : 'Just for fun: games are saved to history, but nobody’s rating changes. You can fill empty seats with bots.'}{guestHost ? ' Guests are never rated.' : ''}</p></div>
        <div className="setting-control"><Switch id="opt-ranked" checked={o.ranked} onChange={v => onChange({ ...o, ranked: v })} label="Ranked game" /></div>
      </div>
      <div className="setting">
        <div className="setting-text"><span className="field-label" id="opt-vis-label">Who can join</span>
          <p className="hint">{o.visibility === 'public'
            ? 'Listed under Open rooms for everyone online. Anyone can take a free seat.'
            : 'Only people with the code or an invite can join.'}</p></div>
        <div className="setting-control">
          <Segmented options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} value={o.visibility} onChange={v => onChange({ ...o, visibility: v })} label="Who can join" />
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
    </>
  );
}
