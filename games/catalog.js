/**
 * Game catalogue shown on the platform (safe for server and browser).
 * Only games with status 'playable' have a module; the rest are listed as
 * "in the workshop" exactly as the prototype showed them.
 */
export const catalog = [
  { id: 'thulla', name: 'Thulla', urdu: 'تھلا', status: 'playable', tagline: 'Follow the shape, or slap down a Thulla.',
    players: { min: 2, ideal: 4 }, duration: '15–30 min', deck: '52 cards, no Jokers' },
  { id: 'rung', name: 'Rung', status: 'workshop', tagline: 'Partnership tricks with a trump called at the table.', players: { min: 4, ideal: 4 } },
  { id: 'bluff', name: 'Bluff', status: 'workshop', tagline: 'Lay cards face down, claim anything, call the lie.', players: { min: 3, ideal: 5 } },
  { id: 'seep', name: 'Seep', status: 'workshop', tagline: 'Build houses on the floor and sweep them clean.', players: { min: 2, ideal: 4 } },
];
export const gameMeta = id => catalog.find(g => g.id === id) || null;
