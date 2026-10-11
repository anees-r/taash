/**
 * Cosmetics: table designs and card designs. Shared by the
 * server (prices, who may equip what) and the browser (what to draw; the
 * looks themselves live in styles/cosmetics.css, keyed by id).
 *
 * Shop items are bought with coins. Rank rewards are unlocked by a player's
 * best (peak) Thulla rating and can never be bought.
 */
export const KINDS = {
  table: { label: 'Table designs', single: 'Table', hint: 'Every card design as a table: its card back laid across the felt. When several players bring a table, the highest-ranked (then priciest) one is used.' },
  cards: { label: 'Card designs', single: 'Cards', hint: 'Both sides: everyone sees the front of every card you play, and the back on your face-down hand.' },
};

export const ITEMS = [
  // Defaults: everyone has these.
  { id: 'table-classic', kind: 'table', name: 'Classic baize', free: true },
  { id: 'cards-classic', kind: 'cards', name: 'Classic plum', free: true },

  // Shop: tables. One for every card design, drawn like that design's card back.
  { id: 'table-indigo', kind: 'table', name: 'Indigo', price: 200 },
  { id: 'table-rose', kind: 'table', name: 'Rose', price: 200 },
  { id: 'table-jade', kind: 'table', name: 'Jade', price: 300 },
  { id: 'table-chequer', kind: 'table', name: 'Chequer', price: 350 },
  { id: 'table-noir', kind: 'table', name: 'Noir & silver', price: 450 },
  { id: 'table-kite', kind: 'table', name: 'Basant kites', price: 450 },
  { id: 'table-paisley', kind: 'table', name: 'Paisley', price: 500 },
  { id: 'table-truck', kind: 'table', name: 'Truck art', price: 550 },
  { id: 'table-galaxy', kind: 'table', name: 'Night sky', price: 600 },
  // Shop: cards
  { id: 'cards-indigo', kind: 'cards', name: 'Indigo', price: 200 },
  { id: 'cards-rose', kind: 'cards', name: 'Rose', price: 200 },
  { id: 'cards-jade', kind: 'cards', name: 'Jade', price: 300 },
  { id: 'cards-chequer', kind: 'cards', name: 'Chequer', price: 350 },
  { id: 'cards-noir', kind: 'cards', name: 'Noir & silver', price: 450 },
  { id: 'cards-kite', kind: 'cards', name: 'Basant kites', price: 450 },
  { id: 'cards-paisley', kind: 'cards', name: 'Paisley', price: 500 },
  { id: 'cards-truck', kind: 'cards', name: 'Truck art', price: 550 },
  { id: 'cards-galaxy', kind: 'cards', name: 'Night sky', price: 600 },

  // Rank rewards (peak rating), never for sale
  { id: 'cards-silver', kind: 'cards', name: 'Silver line', minPeak: 1550 },
  { id: 'table-silver', kind: 'table', name: 'Silver line', minPeak: 1550 },
  { id: 'cards-gilded', kind: 'cards', name: 'Gilded', minPeak: 1650 },
  { id: 'table-gilded', kind: 'table', name: 'Gilded', minPeak: 1650 },
  { id: 'cards-royal', kind: 'cards', name: 'Royal seal', minPeak: 1850 },
  { id: 'table-royal', kind: 'table', name: 'Royal seal', minPeak: 1850 },
  { id: 'cards-diamond', kind: 'cards', name: 'Diamond', minPeak: 1900 },
  { id: 'table-diamond', kind: 'table', name: 'Diamond', minPeak: 1900 },
];

export const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export const DEFAULTS = { table: 'table-classic', cards: 'cards-classic' };

/** Rank tiers shown on the rewards page (peak rating needed). */
export const TIERS = [
  { min: 1550, name: 'Rising' },
  { min: 1600, name: 'Skilled' },
  { min: 1650, name: 'Expert' },
  { min: 1700, name: 'Master' },
  { min: 1800, name: 'Grandmaster' },
  { min: 1850, name: 'Champion' },
  { min: 1900, name: 'Legend' },
];
export const tierOf = peak => TIERS.filter(t => peak >= t.min).pop() || null;

/** Short design key used in CSS/data attributes: 'table-midnight' → 'midnight'. */
export const designKey = id => (id && BY_ID[id] && !BY_ID[id].free ? id.slice(id.indexOf('-') + 1) : null);

/** Can someone with these owned ids and this peak rating use the item? */
export function canUse(item, owned, peak) {
  if (!item) return false;
  if (item.free) return true;
  if (item.minPeak) return (peak || 0) >= item.minPeak;
  return owned.has(item.id);
}

/** Coins for a ranked game. Unranked games, guests and bots earn nothing. */
export function coinsFor({ place, isLoser, forfeit, forfeitEnded }) {
  if (forfeitEnded) return forfeit ? 0 : 15;
  if (isLoser) return 5;
  return Math.max(10, 40 - (place - 1) * 10);   // 1st 40 · 2nd 30 · 3rd 20 · then 10
}
