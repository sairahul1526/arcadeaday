export const TITLE = 'Knot Kitty', SLUG = 'knot-kitty', STORE = 'kk_', SAVE_V = 1;
export const LEVELS = 60, PER_WORLD = 10, DAILY_START = '2026-10-16', SEASON_END = '2026-11-02';
export const ACTIVE = 2, SPOOL_N = 3, RAINBOW = 6, MAX_STRANDS = 28;
export const DPR_CAP = 2.5, TAP_SLOP = 24, PEEK_HOLD = 0.35, IDLE_HINT = 15;
export const DUR = { lift: 0.07, flightMin: 0.34, flightMax: 0.75, spoolLeave: 0.45, spoolEnter: 0.30,
  unbasketDelay: 0.28, unbasketDur: 0.38, kittenFree: 1.6, stuckCard: 0.6, callout: 2.2, wiggle: 0.38, ring: 0.7 };
export const BOOSTERS = { undo: { price: 30, unlock: 4, gift: 3 }, hint: { price: 40, unlock: 6, gift: 2 },
  slot: { price: 60, unlock: 9, gift: 1 }, snip: { price: 80, unlock: 16, gift: 1 } };
export const OUTFITS = [['tabby','Plain Tabby',0],['scarf','Cosy Scarf',120],['pumpkin','Pumpkin Sweater',200],
  ['witch','Witch Hat',300],['snow','Snowflake Jumper',400],['bow','Café Bow Tie',500],['crown','Yarn Crown',750],['astro','Star Helmet',1000]];
export const WORLDS = [null, { key: 'den', name: 'Autumn Den' }, { key: 'pumpkin', name: 'Pumpkin Night' },
  { key: 'cabin', name: 'Snowy Cabin' }, { key: 'cafe', name: 'Cat Café' }, { key: 'attic', name: 'Moonlit Attic' }, { key: 'roof', name: 'Starry Rooftop' }];
export const TEACH = { 8: 'knot', 14: 'lock', 21: 'mystery', 28: 'paw', 35: 'rainbow', 42: 'jumbo', 49: 'ice' };
export const worldOf = id => Math.min(6, Math.floor((id - 1) / PER_WORLD) + 1);
export const bus = (() => { const m = new Map(); return {
  on(t, f) { (m.get(t) || m.set(t, []).get(t)).push(f); },
  off(t, f) { const a = m.get(t); if (a) a.splice(a.indexOf(f) >>> 0, 1); },
  emit(t, d) { for (const f of m.get(t) || []) try { f(d); } catch (e) { console.warn(e); } } }; })();
