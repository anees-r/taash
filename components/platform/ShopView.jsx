'use client';
/* Shop (coins) and rank rewards (peak rating): preview, buy, equip. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ITEMS, KINDS, TIERS, tierOf, designKey } from '@/lib/cosmetics/catalog';
import { buyItemAction, equipItemAction } from '@/app/actions/shop';
import { PlayingCard } from '@/components/game/PlayingCard';
import { Icon } from './Icon';
import { Segmented } from './controls';
import { Confirm } from './Modal';
import { toast } from '@/lib/client/toast';

function Preview({ item }) {
  const key = designKey(item.id);
  if (item.kind === 'table') return <div className="felt-preview" data-table={key || undefined} aria-hidden="true" />;
  return (
    <div className="deck-preview" aria-hidden="true">
      <PlayingCard card="back" size={58} data-deck={key || undefined} />
      <PlayingCard card="AS" size={58} data-deck={key || undefined} />
    </div>
  );
}

export function ShopView({ state }) {
  const router = useRouter();
  const [tab, setTab] = useState('shop');
  const [busy, setBusy] = useState(null);
  const [buying, setBuying] = useState(null);
  const owned = new Set(state.owned);
  const tier = tierOf(state.peak);
  const nextTier = TIERS.find(t => t.min > state.peak);

  async function run(fn, item, okMsg) {
    setBusy(item.id);
    const r = await fn(item.id).catch(() => ({ error: 'You appear to be offline.' }));
    setBusy(null);
    if (r.error) { toast(r.error, { icon: 'i-info', duration: 4000 }); return false; }
    toast(okMsg, { icon: 'i-check' });
    router.refresh();
    return true;
  }

  const list = ITEMS.filter(i => (tab === 'shop' ? !i.minPeak : i.minPeak));
  return (
    <main className="page shop-page screen-enter">
      <div className="page-head">
        <div><p className="eyebrow">Shop & rank rewards</p><h1 className="page-title">Make the table yours.</h1></div>
        <div className="wallet" aria-label={state.coins + ' coins'}><span className="coin" aria-hidden="true" /><b className="num">{state.coins}</b><span className="faint small">coins</span></div>
      </div>
      <p className="muted small">Win coins in <b>ranked</b> games (1st 40, 2nd 30, 3rd 20, then 10; 5 for holding the cards). Rank rewards unlock with your best rating and can’t be bought. Everyone sees your card fronts when you play and your card backs on your face-down hand; the table in play is the best one anyone at the table brought.</p>
      <div className="shop-tabs"><Segmented options={[{ value: 'shop', label: 'Shop' }, { value: 'rewards', label: 'Rank rewards' }]} value={tab} onChange={setTab} label="Shop or rank rewards" /></div>

      {tab === 'rewards' ? (
        <section className="panel panel-pad rank-card">
          <div><span className="eyebrow">Your best rating</span><p className="rank-peak num display">{state.peak}</p><p className="muted small">{tier ? 'Rank: ' + tier.name : 'No rank yet'}{nextTier ? ' · ' + (nextTier.min - state.peak) + ' to ' + nextTier.name : ' · top rank reached'}</p></div>
          <ol className="tier-track">{TIERS.map(t => <li key={t.min} className={state.peak >= t.min ? 'done' : undefined}><b>{t.name}</b><span className="num faint">{t.min}</span></li>)}</ol>
        </section>
      ) : null}

      {Object.entries(KINDS).map(([kind, k]) => {
        const items = list.filter(i => i.kind === kind);
        if (!items.length) return null;
        return (
          <section key={kind} className="shop-section">
            <div className="section-head"><h2 className="section-title">{k.label}</h2><p className="muted small">{k.hint}</p></div>
            <ul className="shop-grid">{items.map(item => {
              const isOn = state.equipped[kind] === item.id;
              const unlocked = item.free || (item.minPeak ? state.peak >= item.minPeak : owned.has(item.id));
              return (
                <li key={item.id} className={'shop-item' + (isOn ? ' is-on' : '') + (unlocked ? '' : ' is-locked')}>
                  <Preview item={item} />
                  <div className="si-text">
                    <b>{item.name}</b>
                    <span className="faint small">{item.free ? 'Default' : item.minPeak ? 'Reach ' + item.minPeak + ' (' + (TIERS.find(t => t.min === item.minPeak)?.name || 'rank') + ')' : unlocked ? 'Owned' : <><span className="coin" aria-hidden="true" /> {item.price}</>}</span>
                  </div>
                  {isOn ? <span className="chip chip-gold"><Icon id="i-check" />Equipped</span>
                    : unlocked ? <button type="button" className="btn btn-sm" disabled={busy === item.id} onClick={() => run(equipItemAction, item, item.name + ' equipped')}>Equip</button>
                    : item.minPeak ? <span className="chip">Locked</span>
                    : <button type="button" className="btn btn-sm btn-primary" disabled={busy === item.id || state.coins < item.price} title={state.coins < item.price ? 'You need ' + (item.price - state.coins) + ' more coins' : undefined} onClick={() => setBuying(item)}>Buy</button>}
                </li>
              );
            })}</ul>
          </section>
        );
      })}

      <Confirm open={!!buying} title={buying ? 'Buy ' + buying.name + '?' : ''} confirmLabel={buying ? 'Buy for ' + buying.price + ' coins' : ''}
        message={buying ? 'You have ' + state.coins + ' coins; ' + (state.coins - buying.price) + ' left after this. It’s yours to equip any time.' : ''}
        onCancel={() => setBuying(null)}
        onConfirm={async () => { const item = buying; setBuying(null); if (await run(buyItemAction, item, item.name + ' is yours!')) await run(equipItemAction, item, item.name + ' equipped'); }} />
    </main>
  );
}
