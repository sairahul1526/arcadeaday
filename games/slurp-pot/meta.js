// Slurp Pot meta: save schema v1, migrate, deep fill, two-tab merge, coins, boosters, skins, daily + streak ladder + lids,
// Feast results, cookbook, score (GDD §3.9-§3.12, §6, §11.3, §13.3). Owner: Meta/QA role.
// No storage API is touched here: everything goes through P (P.data, P.save, P.flush, P.best, P.readStored, P.onStoredChange).
// meta.js never imports platform.js; game.js hands P to initMeta(P), so Node can import this file for tests.
//
// DECISION: initMeta(P) is async only in the signature (GDD: Promise<save>); all work runs synchronously before it returns.
//   It deep-fills P.data IN PLACE (same object identity, so any cached get() stays valid), drops nothing it does not know
//   (unknown keys survive: forward-tolerant), and reports P.best(score()).
// DECISION: sanitize derives `cur` from the stars (cur = highest beaten level + 1, max 61), so a hand-edited cur never skips
//   levels, and derives daily.ladder = streak % 7 (the ladder restarts after day 7 keeping the streak number), so the two
//   can never drift apart. v0 migrate (lv 3 -> stars[0..1] = 1, cur 3) is consistent with both rules.
// DECISION: migrate treats {v:0,...} AND a version-less object that has `lv` but no `stars` array as the prototype save
//   (P.init sends every v < 1 save through migrate, including ones without a v field).
// DECISION: every write goes through save(): it stamps ts, folds in what another tab stored (P.readStored) and then calls
//   P.save(). Win, purchase, daily, feast and reset results also P.flush() at once. SYNC (merge + P.onStoredChange) is web-only
//   and off in ?record / ?og. reset() writes through without a merge, and another tab adopts a reset instead of resurrecting.
// DECISION: merge(a, b) is pure and returns a NEW sanitized save. Progress takes max/union; coins, boosters, worn skin,
//   settings and daily.streak/last/ladder/lids/lidCard come together from the newer ts (a tie keeps `a`). So a merge can never
//   duplicate coins; the cost is that coins earned in an older-ts tab are dropped (spendables are last-writer-wins by design).
//   Known limit: a skin bought in tab A is kept by the union but its price is not deducted if tab B (newer ts, unaware) wins.
// DECISION: levelResult pays only the win payout (first win 10+5*stars, replay 3+5*newStars, x2 on L20/40/60). In-level coin
//   pops (bites, sizzle, gull miss) are credited by game.js through addCoins(n, why). `coins` returned is the win payout only;
//   gifts/milestone/chest carry their own already-credited amounts.
// DECISION: a booster unlock gift is granted when cur REACHES the unlock level (win L5 -> arrive L6 -> Magnet x2), so the
//   button exists in the level it is unlocked for; gifts are returned as { kind:'booster', k, n }. A migrated save with cur
//   past an unlock level gets the gift on its next level win (pendingGifts() lists them for the UI).
// DECISION: star milestone n (1-based, every 15 stars) pays 60 coins + booster BK[(n-1) % 3] (magnet, freeze, mega), regardless
//   of unlock state. Town chest: first win of the finale level (L20/40/60) when the town is not in `chests`: 150/150/300 coins +
//   2 of each booster. Order inside one win: unlock gifts -> milestone -> chest.
// DECISION: Daily pays at most once per IST key; `daily.last` is a high-water mark, so a key <= last (clock set backwards, or a
//   key trimmed out of `won`) counts as claimed and cannot re-pay. Replays pay 0 (a better star count is still stored).
//   Locked daily (cur <= DAILY_UNLOCK) pays 0 and leaves the streak alone (API only; the UI gates it).
// DECISION: Streak Lids (useLids): a gap of g missed IST days between daily.last and today is covered only when the streak is
//   alive and g <= lids: the lids are spent, daily.last moves to yesterday (the missed days add nothing to the streak number)
//   and lidCard is set. Otherwise the streak is lost: streak 0, ladder 0, bestStreak kept. Lids are never partly spent.
// DECISION: a Streak Lid reward (ladder day 3) while already holding LID_MAX converts to PRICES.lid coins.
// DECISION: dailyStatus().ladder is an array of 7 { day, reward, state:'done'|'today'|'next'|'future' }; `tomorrow` is
//   { day, reward } of the next stamp; `day` is the ladder day (1..7) of today's stamp (or the one just paid).
// DECISION: feastResult(r): pb only when tickets > feast.best (strict). Pays 2 per ticket + 25 on a PB; the PB run's ticket
//   finish times become feast.ghost (<= 99 entries). Needs r = { tickets, times, bites, chainBest }.
// DECISION: buySkin also wears the new skin (like Knot Kitty). The Star Ladle Pot (price -1) is never buyable.
// DECISION: nextSkin(within) = the cheapest unowned buyable skin as { id, price, need } when need = price - coins <= within
//   (default Infinity); the win card asks for 100 (need 0 = affordable now).
// DECISION: buyBooster('lid') needs the daily unlocked (cur > DAILY_UNLOCK) and lids < LID_MAX; in-level boosters need
//   their unlock level reached (or an earlier gift) and are capped at 99 held.

import { PRICES, LID_MAX, BOOST_UNLOCK, BOOST_GIFT, DAILY_UNLOCK, FEAST_UNLOCK, DAILY_START, FEAST, LADDER, SKINS, TOWNS, LEVELS } from './consts.js';

let P = null; // the platform layer, set by initMeta(P)

// ---------- constants ----------
export const SAVE_V = 1;
export const BOOSTS = ['magnet', 'freeze', 'mega'];
export const TOWN_LEVELS = 20;
export const MILESTONE_EVERY = 15, MILESTONE_COINS = 60;
export const MAX_SCORE = LEVELS * 3 * 100 + LEVELS * 10 + 99; // 18,699
export const TUT = { drag: 1, recipe: 2, padlock: 4, stars: 8, pens: 16, rolling: 32, fragile: 64, belt: 128, twocourse: 256, simmer: 512, gulls: 1024, truck: 2048, layered: 4096, freeze: 8192 };
const WIN_A = 10, WIN_B = 5, REPLAY_A = 3, DAILY_A = 40, DAILY_B = 10;
const CHEST_COINS = [150, 150, 300], CHEST_BOOST = 2;
const MAX_COINS = 9999999, MAX_BOOST = 99, DAILY_KEEP = 30, GHOST_MAX = 99, FEAST_MAX = 9999;
const IST_MS = 5.5 * 3600e3, DAY_MS = 86400e3;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIN_IDS = SKINS.map(s => s[0]);
const STAT_KEYS = ['bites', 'bosses', 'plays', 'fails', 'ms', 'bestChain'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------- helpers ----------
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const clone = o => JSON.parse(JSON.stringify(o));
const int = (v, lo, hi, dflt = lo) => {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return dflt;
  const n = Math.floor(+v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const num01 = (v, dflt) => { const n = +v; return typeof v !== 'boolean' && v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt; };
const D = () => (P && P.data) || null;
const townOf = n => TOWNS[Math.min(TOWNS.length - 1, Math.floor((n - 1) / TOWN_LEVELS))];
const isFinale = n => n % TOWN_LEVELS === 0;

const dayN = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
const gapDays = (a, b) => Math.round(dayN(b) - dayN(a));
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const isKey = k => typeof k === 'string' && KEY_RE.test(k) && Number.isFinite(Date.parse(k + 'T00:00:00Z')) && addDays(k, 0) === k;

// ---------- schema ----------
function defaults() {
  return {
    v: SAVE_V, ts: 0,
    best: 0,
    stars: Array(LEVELS).fill(0),
    cur: 1,
    coins: 50,
    boost: { magnet: 0, freeze: 0, mega: 0 },
    gifted: [],
    skins: ['sunny'], wear: 'sunny',
    daily: { won: {}, streak: 0, last: '', ladder: 0, bestStreak: 0, starPot: false, lids: 0, lidCard: false },
    feast: { best: 0, bestBites: 0, plays: 0, ghost: [] },
    giftsClaimed: 0,
    chests: [],
    set: { music: 0.7, sfx: 0.9, haptics: true, stick: null, mute: false },
    tut: 0,
    stats: { bites: 0, bosses: 0, plays: 0, fails: 0, ms: 0, bestChain: 0 },
  };
}
export const DEFAULT_SAVE = defaults();

/** Normalises any value into a valid v1 save: every key present (deep fill), numbers clamped, unknown keys kept. */
function sanitize(src) {
  const s = isObj(src) ? src : {};
  const o = defaults();
  for (const k of Object.keys(s)) {
    if (k in o || BAD_KEYS.has(k)) continue;
    try { o[k] = clone(s[k]); } catch { /* unclonable: dropped */ }
  }
  o.v = int(s.v, SAVE_V, 1e6, SAVE_V);
  o.ts = int(s.ts, 0, 1e14, 0);
  o.best = int(s.best, 0, MAX_SCORE, 0);
  o.stars = Array.from({ length: LEVELS }, (_, i) => int(Array.isArray(s.stars) ? s.stars[i] : 0, 0, 3, 0));
  let hi = 0;
  o.stars.forEach((v, i) => { if (v > 0) hi = i + 1; });
  o.cur = Math.min(LEVELS + 1, hi + 1);
  o.coins = int(s.coins, 0, MAX_COINS, 50);
  if (isObj(s.boost)) for (const k of BOOSTS) o.boost[k] = int(s.boost[k], 0, MAX_BOOST, 0);
  if (Array.isArray(s.gifted)) o.gifted = BOOSTS.filter(k => s.gifted.includes(k));
  const dSrc = isObj(s.daily) ? s.daily : {};
  if (Array.isArray(s.skins)) o.skins = SKIN_IDS.filter(id => id === 'sunny' || s.skins.includes(id));
  if (dSrc.starPot === true && !o.skins.includes('starladle')) o.skins.push('starladle');
  o.wear = o.skins.includes(s.wear) ? s.wear : 'sunny';
  // daily
  const dl = o.daily;
  if (isObj(dSrc.won)) {
    const keys = Object.keys(dSrc.won).filter(isKey).sort().slice(-DAILY_KEEP);
    for (const k of keys) dl.won[k] = int(dSrc.won[k], 1, 3, 1);
  }
  dl.last = isKey(dSrc.last) ? dSrc.last : '';
  dl.streak = dl.last ? int(dSrc.streak, 0, 99999, 0) : 0;
  dl.ladder = dl.streak % 7;
  dl.bestStreak = Math.max(int(dSrc.bestStreak, 0, 99999, 0), dl.streak);
  dl.starPot = dSrc.starPot === true || o.skins.includes('starladle');
  dl.lids = int(dSrc.lids, 0, LID_MAX, 0);
  dl.lidCard = dSrc.lidCard === true;
  if (dl.starPot && !o.skins.includes('starladle')) o.skins.push('starladle');
  // feast
  const fSrc = isObj(s.feast) ? s.feast : {};
  o.feast.best = int(fSrc.best, 0, FEAST_MAX, 0);
  o.feast.bestBites = int(fSrc.bestBites, 0, 1e6, 0);
  o.feast.plays = int(fSrc.plays, 0, 1e9, 0);
  if (Array.isArray(fSrc.ghost)) {
    o.feast.ghost = fSrc.ghost.slice(0, GHOST_MAX).map(x => +x).filter(x => Number.isFinite(x) && x >= 0 && x < 1e5).map(x => Math.round(x * 100) / 100);
  }
  o.giftsClaimed = int(s.giftsClaimed, 0, Math.floor((LEVELS * 3) / MILESTONE_EVERY), 0);
  if (Array.isArray(s.chests)) o.chests = TOWNS.filter(t => s.chests.includes(t));
  if (isObj(s.set)) {
    o.set.music = num01(s.set.music, o.set.music);
    o.set.sfx = num01(s.set.sfx, o.set.sfx);
    if (typeof s.set.haptics === 'boolean') o.set.haptics = s.set.haptics;
    if (typeof s.set.mute === 'boolean') o.set.mute = s.set.mute;
    const st = s.set.stick;
    if (st === null || typeof st === 'boolean' || (typeof st === 'string' && st.length <= 12)) o.set.stick = st === undefined ? null : st;
  }
  o.tut = int(s.tut, 0, 2 ** 30 - 1, 0);
  if (isObj(s.stats)) for (const k of STAT_KEYS) o.stats[k] = int(s.stats[k], 0, 1e12, 0);
  return o;
}

/** P.init calls this only when the stored v < 1. Prototype save { v:0, best, lv } -> levels 1..lv-1 beaten with 1 star. */
export function migrate(old) {
  if (!isObj(old)) return sanitize(null);
  const proto = old.v === 0 || (old.v === undefined && 'lv' in old && !Array.isArray(old.stars));
  if (proto) {
    const s = sanitize(null);
    const lv = Math.max(1, Math.min(LEVELS, int(old.lv, 0, 1e6, 0)));
    for (let i = 0; i < lv - 1; i++) s.stars[i] = 1;
    s.cur = lv;
    s.best = int(old.best, 0, MAX_SCORE, 0);
    s.v = SAVE_V;
    return s;
  }
  const s = sanitize(old);
  s.v = Math.max(SAVE_V, s.v);
  return s;
}

/** Replaces d's content with `next` keeping d's identity (cached get() references stay valid). */
function replaceIn(d, next) {
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, next);
  return d;
}

// ---------- merge (two tabs) ----------
/** Pure. Progress = max/union; spendables and settings come together from the newer ts (tie keeps a). Returns a new save. */
export function merge(a, b) {
  const A = sanitize(a), B = sanitize(b);
  const nw = B.ts > A.ts ? B : A, od = nw === A ? B : A;
  const m = sanitize(nw);
  for (const k of Object.keys(od)) if (!(k in m) && !BAD_KEYS.has(k)) m[k] = clone(od[k]); // unknown keys: older fills gaps
  m.ts = Math.max(A.ts, B.ts);
  m.best = Math.max(A.best, B.best);
  m.stars = A.stars.map((v, i) => Math.max(v, B.stars[i]));
  m.gifted = BOOSTS.filter(k => A.gifted.includes(k) || B.gifted.includes(k));
  m.skins = SKIN_IDS.filter(id => id === 'sunny' || A.skins.includes(id) || B.skins.includes(id));
  m.chests = TOWNS.filter(t => A.chests.includes(t) || B.chests.includes(t));
  m.giftsClaimed = Math.max(A.giftsClaimed, B.giftsClaimed);
  m.tut = A.tut | B.tut;
  for (const k of STAT_KEYS) m.stats[k] = Math.max(A.stats[k], B.stats[k]);
  const won = {};
  for (const k of new Set([...Object.keys(A.daily.won), ...Object.keys(B.daily.won)])) won[k] = Math.max(A.daily.won[k] | 0, B.daily.won[k] | 0);
  m.daily.won = {};
  for (const k of Object.keys(won).sort().slice(-DAILY_KEEP)) m.daily.won[k] = won[k];
  m.daily.bestStreak = Math.max(A.daily.bestStreak, B.daily.bestStreak);
  m.daily.starPot = A.daily.starPot || B.daily.starPot;
  const fb = B.feast.best > A.feast.best || (B.feast.best === A.feast.best && nw === B) ? B.feast : A.feast;
  m.feast = { best: fb.best, bestBites: fb.bestBites, plays: Math.max(A.feast.plays, B.feast.plays), ghost: fb.ghost.slice() };
  return sanitize(m);
}

// ---------- multi-tab sync (web only) ----------
const Qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const qOn = k => !!Qs && (Qs.get(k) === '1' || Qs.get(k) === 'true');
let syncOn = false, syncWired = null; // syncWired = the P whose onStoredChange is hooked
const syncListeners = [];
/** cb({ reset }) after another tab's write changed this tab's save (refresh coins/stars on screen). */
export function onSync(cb) { if (typeof cb === 'function') syncListeners.push(cb); }
const fire = info => { for (const cb of syncListeners) { try { cb(info); } catch (e) { err(e); } } };
const err = e => { try { P && P.error && P.error(e); } catch { /* ignore */ } };

function parseStored(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let o = null;
  try { o = JSON.parse(raw); } catch { return null; }
  return isObj(o) && (+o.v | 0) >= 1 && Array.isArray(o.stars) ? o : null;
}
const hasProgress = o => o.stars.some(v => +v > 0) || (isObj(o.stats) && +o.stats.bosses > 0);
const isResetSave = o => !hasProgress(o);

function mergeStored() {
  const d = D();
  if (!syncOn || !d) return;
  try {
    const o = parseStored(P.readStored && P.readStored());
    if (o && !isResetSave(o)) replaceIn(d, merge(d, o));
  } catch (e) { err(e); }
}
function onStorage(raw) {
  const d = D();
  if (!d) return;
  try {
    const o = parseStored(raw);
    if (!o) return; // removed, corrupt or foreign: keep this tab's data, never lose progress
    if (isResetSave(o) && hasProgress(d)) { // the other tab reset: adopt it, do not resurrect old progress
      const clean = sanitize(o);
      clean.set = { ...d.set };
      clean.best = d.best;
      replaceIn(d, clean);
      fire({ reset: true });
      return;
    }
    const before = JSON.stringify(d);
    replaceIn(d, merge(d, o));
    if (JSON.stringify(d) === before) return;
    fire({ reset: false });
    // this tab held progress the other did not: write the union back (ts unchanged, so the other tab converges silently)
    if (JSON.stringify(d) !== JSON.stringify(sanitize(o))) P.save();
    reportScore();
  } catch (e) { err(e); }
}
function wireSync() {
  if (syncWired === P || !syncOn || !P.onStoredChange) return;
  syncWired = P;
  P.onStoredChange(onStorage);
}

// ---------- save / init ----------
/** Stamps ts, folds in what another tab stored, then P.save(). `flush` writes at once. Call after changing get() directly. */
export function save(flush = false) {
  const d = D();
  if (!d) return;
  d.ts = Math.max(Date.now(), d.ts | 0);
  mergeStored();
  P.save();
  if (flush && P.flush) P.flush();
}
/** P.data itself (never a copy). */
export const get = () => D();

/** After P.init: deep-fill P.data in place, wire the two-tab sync, report the score. Resolves with the save. */
export async function initMeta(Pin) {
  if (Pin) P = Pin;
  const d = D();
  if (!P || !d) return null;
  const before = JSON.stringify(d);
  const clean = sanitize(d);
  clean.v = Math.max(SAVE_V, int(d.v, 0, 1e6, SAVE_V));
  replaceIn(d, clean);
  syncOn = P.env === 'web' && !qOn('record') && !qOn('og');
  wireSync();
  if (JSON.stringify(d) !== before) P.save();
  reportScore();
  return d;
}

// ---------- progress and score ----------
export const stars = n => (D() && n >= 1 && n <= LEVELS ? D().stars[n - 1] | 0 : 0);
export const totalStars = () => (D() ? D().stars.reduce((a, b) => a + b, 0) : 0);
/** Levels beaten (stars > 0). */
export const beaten = () => (D() ? D().stars.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) : 0);
export const cur = () => (D() ? D().cur : 1);
/** The qa `progress` number: levels beaten = cur - 1. */
export const progress = () => (D() ? D().cur - 1 : 0);
export const unlocked = n => n >= 1 && n <= LEVELS && n <= cur();
export const dailyUnlocked = () => !!D() && D().cur > DAILY_UNLOCK;
export const feastUnlocked = () => !!D() && D().cur > FEAST_UNLOCK;
/** GDD §6: 100 x totalStars + 10 x levelsBeaten + min(99, feastBest). Each term only rises. */
export const score = () => (D() ? 100 * totalStars() + 10 * beaten() + Math.min(99, D().feast.best | 0) : 0);
function reportScore() { if (P && P.data && P.best) P.best(score()); }
/** { have, need } for "★ 41 / 45" on the map: need = the next multiple of 15 (max 180 once all are earned). */
export function nextMilestone() {
  const have = totalStars(), max = LEVELS * 3;
  return { have, need: Math.min(max, (Math.floor(have / MILESTONE_EVERY) + 1) * MILESTONE_EVERY) };
}
export const qaOldSave = () => ({ save: '{"v":0,"best":120,"lv":3}', progress: 2 });

// ---------- coins ----------
export const coins = () => (D() ? D().coins : 0);
/** Credits coins (n > 0). `why` is a free label ('bite', 'sizzle', 'gull', ...) kept for call-site clarity. Returns the balance. */
export function addCoins(n, why) { // eslint-disable-line no-unused-vars
  n = Math.floor(+n || 0);
  const d = D();
  if (!d || n <= 0) return coins();
  d.coins = Math.min(MAX_COINS, d.coins + n);
  save();
  return d.coins;
}
export function spend(n) {
  n = Math.floor(+n || 0);
  const d = D();
  if (!d || n < 0 || d.coins < n) return false;
  d.coins -= n;
  save();
  return true;
}
/** Bumps a stats counter by n (bestChain keeps the max). Keys: bites, bosses, plays, fails, ms, bestChain. */
export function stat(k, n = 1) {
  const d = D();
  if (!d || !STAT_KEYS.includes(k)) return;
  n = Math.floor(+n || 0);
  if (k === 'bestChain') d.stats[k] = Math.max(d.stats[k], n);
  else d.stats[k] = Math.min(1e12, d.stats[k] + Math.max(0, n));
  save();
}

// ---------- boosters ----------
export const booster = k => (D() && BOOSTS.includes(k) ? D().boost[k] : k === 'lid' && D() ? D().daily.lids : 0);
export const boosters = () => (D() ? { ...D().boost } : { magnet: 0, freeze: 0, mega: 0 });
export const lids = () => (D() ? D().daily.lids : 0);
export const boosterUnlocked = k => !!D() && BOOSTS.includes(k) && (D().cur >= BOOST_UNLOCK[k] || D().gifted.includes(k));
/** Spends one booster of `kind` (magnet|freeze|mega). Streak Lids are automatic, never taken. */
export function takeBooster(kind) {
  const d = D();
  if (!d || !BOOSTS.includes(kind) || d.boost[kind] <= 0) return false;
  d.boost[kind]--;
  save();
  return true;
}
/** Buys one booster ('magnet'|'freeze'|'mega'|'lid') with coins. false when locked, full or too poor. */
export function buyBooster(kind) {
  const d = D();
  if (!d) return false;
  if (kind === 'lid') {
    if (!dailyUnlocked() || d.daily.lids >= LID_MAX || !spend(PRICES.lid)) return false;
    d.daily.lids++;
  } else {
    if (!boosterUnlocked(kind) || d.boost[kind] >= MAX_BOOST || !spend(PRICES[kind])) return false;
    d.boost[kind]++;
  }
  save(true);
  return true;
}
/** Unlock gifts not yet given: booster kinds whose unlock level has been reached (cur >= unlock) and were never gifted. */
export const pendingGifts = () => (D() ? BOOSTS.filter(k => !D().gifted.includes(k) && D().cur >= BOOST_UNLOCK[k]) : []);
function unlockGifts() {
  const d = D(), got = [];
  for (const k of pendingGifts()) {
    d.gifted.push(k);
    d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + BOOST_GIFT[k]);
    got.push({ kind: 'booster', k, n: BOOST_GIFT[k] });
  }
  d.gifted = BOOSTS.filter(k => d.gifted.includes(k));
  return got;
}
const addBoost = (d, k, n) => { d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + n); };

// ---------- skins ----------
export const skins = () => SKINS.map(([id, price]) => ({ id, price, owned: !!D() && D().skins.includes(id), worn: !!D() && D().wear === id, buyable: price > 0 }));
export const owns = id => !!D() && D().skins.includes(id);
export function wear(id) {
  const d = D();
  if (!d || !d.skins.includes(id)) return false;
  if (d.wear !== id) { d.wear = id; save(); }
  return true;
}
/** Buys a skin with coins and wears it. false when unknown, free/streak-only, owned or too poor. */
export function buySkin(id) {
  const d = D();
  const row = SKINS.find(s => s[0] === id);
  if (!d || !row || row[1] <= 0 || d.skins.includes(id) || !spend(row[1])) return false;
  d.skins = SKIN_IDS.filter(x => x === 'sunny' || d.skins.includes(x) || x === id);
  d.wear = id;
  save(true);
  return true;
}
/** Cheapest unowned buyable skin as { id, price, need } when need = price - coins <= within; else null. */
export function nextSkin(within = Infinity) {
  const d = D();
  if (!d) return null;
  const left = SKINS.filter(([id, price]) => price > 0 && !d.skins.includes(id)).sort((a, b) => a[1] - b[1]);
  if (!left.length) return null;
  const [id, price] = left[0];
  const need = Math.max(0, price - d.coins);
  return need <= within ? { id, price, need } : null;
}

// ---------- wins ----------
function claimMilestones() {
  const d = D(), out = [];
  const due = Math.floor(totalStars() / MILESTONE_EVERY);
  while (d.giftsClaimed < due && d.giftsClaimed < Math.floor((LEVELS * 3) / MILESTONE_EVERY)) {
    const n = ++d.giftsClaimed, k = BOOSTS[(n - 1) % BOOSTS.length];
    d.coins = Math.min(MAX_COINS, d.coins + MILESTONE_COINS);
    addBoost(d, k, 1);
    out.push({ n, coins: MILESTONE_COINS, boost: k });
  }
  return out;
}
function claimChest(n) {
  const d = D();
  const town = townOf(n);
  if (!isFinale(n) || d.chests.includes(town)) return null;
  d.chests = TOWNS.filter(t => d.chests.includes(t) || t === town);
  const coinsN = CHEST_COINS[TOWNS.indexOf(town)];
  d.coins = Math.min(MAX_COINS, d.coins + coinsN);
  const boost = {};
  for (const k of BOOSTS) { addBoost(d, k, CHEST_BOOST); boost[k] = CHEST_BOOST; }
  return { town, coins: coinsN, boost };
}
/**
 * Records a level win (n = 1..60) and pays it. r = { stars (1..3), tLeft, chainBest }.
 * Returns { coins, newStars, first, stars, gifts:[{kind:'booster',k,n}], chest:{town,coins,boost}|null,
 *           milestone:{n,coins,boost}|null (the first one; `milestones` lists all), nextSkin }.
 * Everything returned is already credited; flushes the save at once.
 */
export function levelResult(n, r = {}) {
  const d = D();
  n = int(n, 1, LEVELS, 0);
  const none = { coins: 0, newStars: 0, first: false, stars: 0, gifts: [], chest: null, milestone: null, milestones: [], nextSkin: null };
  if (!d || !n) return none;
  const st = int(r.stars, 1, 3, 1);
  const prev = d.stars[n - 1] | 0;
  const first = prev === 0;
  const newStars = Math.max(0, st - prev);
  let pay = first ? WIN_A + WIN_B * st : REPLAY_A + WIN_B * newStars;
  if (isFinale(n)) pay *= 2;
  d.stars[n - 1] = Math.max(prev, st);
  d.cur = Math.max(d.cur, Math.min(LEVELS + 1, n + 1));
  d.coins = Math.min(MAX_COINS, d.coins + pay);
  d.stats.bosses = Math.min(1e12, d.stats.bosses + 1);
  d.stats.bestChain = Math.max(d.stats.bestChain, int(r.chainBest, 0, 1e6, 0));
  const gifts = unlockGifts();
  const milestones = claimMilestones();
  const chest = claimChest(n);
  d.cur = Math.min(LEVELS + 1, d.stars.reduce((hi, v, i) => (v > 0 ? i + 1 : hi), 0) + 1);
  save(true);
  reportScore();
  return { coins: pay, newStars, first, stars: st, gifts, chest, milestone: milestones[0] || null, milestones, nextSkin: nextSkin(100) };
}

// ---------- daily order ----------
/** IST date key (YYYY-MM-DD) of the instant `ms` (default now). */
export const dailyKey = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** Milliseconds until the next IST midnight. */
export const msToNext = (ms = Date.now()) => DAY_MS - ((((ms + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS);
/** Days since DAILY_START (negative before launch; callers wrap with ((x % m) + m) % m). */
export const dailyDay = key => gapDays(DAILY_START, key);

const claimed = (d, key) => d.daily.won[key] !== undefined || (!!d.daily.last && key <= d.daily.last);
const missedBefore = (d, key) => (d.daily.last && key > d.daily.last ? Math.max(0, gapDays(d.daily.last, key) - 1) : 0);
/** The streak as the player would see it on `key`: alive when nothing was missed or lids cover every missed day. */
function aliveStreak(d, key) {
  if (!d.daily.last || d.daily.streak <= 0) return 0;
  if (key <= d.daily.last) return d.daily.streak;
  const miss = missedBefore(d, key);
  return miss === 0 || miss <= d.daily.lids ? d.daily.streak : 0;
}
function normReward(e) {
  const r = {};
  if (e.coins) r.coins = e.coins;
  if (e.chest) { r.chest = true; r.coins = (r.coins || 0) + e.chest.coins; r.boost = {}; for (const k of [].concat(e.chest.boost)) r.boost[k] = 1; }
  if (e.boost) {
    r.boost = r.boost || {};
    const list = e.boost === 'all' ? BOOSTS : [].concat(e.boost);
    for (const k of list) r.boost[k] = (r.boost[k] || 0) + 1;
  }
  if (e.lid) r.lid = e.lid;
  return r;
}
/** The reward descriptor of ladder index i (0..6) for save d: { day, coins?, boost?, lid?, skin?, chest?, icon }. */
function rewardOf(i, d) {
  const e = LADDER[((i % 7) + 7) % 7];
  const r = { day: (((i % 7) + 7) % 7) + 1 };
  if (e.skin && !(d && d.daily.starPot)) r.skin = e.skin;
  else Object.assign(r, normReward(e.skin ? e.else : e));
  r.icon = r.skin ? 'skin' : r.chest ? 'chest' : r.lid ? 'lid' : r.boost && !r.coins ? 'boosters' : r.boost ? 'chest' : 'coins';
  return r;
}
function applyReward(d, i) {
  const r = rewardOf(i, d);
  if (r.lid) {
    if (d.daily.lids + r.lid <= LID_MAX) d.daily.lids += r.lid;
    else { r.coins = (r.coins || 0) + PRICES.lid; r.lidConverted = true; delete r.lid; r.icon = 'coins'; }
  }
  if (r.boost) for (const k of Object.keys(r.boost)) addBoost(d, k, r.boost[k]);
  if (r.skin) { d.daily.starPot = true; if (!d.skins.includes(r.skin)) d.skins = SKIN_IDS.filter(x => x === 'sunny' || d.skins.includes(x) || x === r.skin); }
  if (r.coins) d.coins = Math.min(MAX_COINS, d.coins + r.coins);
  return r;
}
/** Applies missed-day rules for `key`: lids cover a fully missed gap, otherwise the streak is lost. Returns missed days saved. */
function reconcile(d, key) {
  if (!d.daily.last || key <= d.daily.last || d.daily.streak <= 0) return 0;
  const miss = missedBefore(d, key);
  if (miss === 0) return 0;
  if (miss <= d.daily.lids) {
    d.daily.lids -= miss;
    d.daily.last = addDays(key, -1);
    d.daily.lidCard = true;
    return miss;
  }
  d.daily.bestStreak = Math.max(d.daily.bestStreak, d.daily.streak);
  d.daily.streak = 0;
  d.daily.ladder = 0;
  return 0;
}
/** Boot (and each new day): spends Streak Lids for missed days. true when at least one lid was spent (lidCard is set). */
export function useLids(key = dailyKey()) {
  const d = D();
  if (!d || !isKey(key)) return false;
  const snap = JSON.stringify(d.daily);
  const saved = reconcile(d, key);
  if (JSON.stringify(d.daily) !== snap) save(true);
  return saved > 0;
}
/** "Saved by a lid!" card pending? ack = true clears it. */
export function lidCard(ack = false) {
  const d = D();
  if (!d) return false;
  const was = d.daily.lidCard;
  if (ack && was) { d.daily.lidCard = false; save(); }
  return was;
}
/** Today's daily state: { key, day, done, stars, streak, bestStreak, ladder:[7], tomorrow:{day,reward}, msToNext, unlocked, lids, lidCard, starPot }. */
export function dailyStatus(key = dailyKey()) {
  const d = D();
  const now = Date.now();
  if (!d) return { key, day: 1, done: false, stars: 0, streak: 0, bestStreak: 0, ladder: [], tomorrow: null, msToNext: msToNext(now), unlocked: false, lids: 0, lidCard: false, starPot: false };
  const done = claimed(d, key);
  const streak = aliveStreak(d, key);
  const todayIdx = done ? (d.daily.ladder + 6) % 7 : streak > 0 ? d.daily.ladder : 0;
  const nextIdx = done ? d.daily.ladder : (todayIdx + 1) % 7;
  const filled = done ? todayIdx + 1 : todayIdx;
  const ladder = LADDER.map((_, i) => ({ day: i + 1, reward: rewardOf(i, d), state: i < filled ? 'done' : i === filled ? (done ? 'next' : 'today') : 'future' }));
  return {
    key, day: todayIdx + 1, done, stars: d.daily.won[key] | 0, streak, bestStreak: Math.max(d.daily.bestStreak, d.daily.streak),
    ladder, tomorrow: { day: nextIdx + 1, reward: rewardOf(nextIdx, d) }, msToNext: msToNext(now),
    unlocked: dailyUnlocked(), lids: d.daily.lids, lidCard: d.daily.lidCard, starPot: d.daily.starPot,
  };
}
/**
 * Pays a daily win once per IST key: 40 + 10 x stars + the ladder reward. Returns
 * { coins (the 40 + 10*stars part), reward (ladder descriptor, its coins credited too), streak, day, total, paid, replay }.
 */
export function dailyResult(key, stars) {
  const d = D();
  if (!isKey(key)) key = dailyKey();
  const s = int(stars, 1, 3, 1);
  const out = { key, stars: s, coins: 0, reward: null, streak: 0, day: 0, total: 0, paid: false, replay: false };
  if (!d) return out;
  out.streak = aliveStreak(d, key);
  if (!dailyUnlocked()) return out;
  if (claimed(d, key)) { // replay for fun: no coins, but a better star count is kept
    out.replay = true;
    out.streak = d.daily.streak;
    if ((d.daily.won[key] | 0) < s) { d.daily.won[key] = s; save(true); }
    return out;
  }
  reconcile(d, key);
  const cont = d.daily.streak > 0 && !!d.daily.last && gapDays(d.daily.last, key) === 1;
  const streak = cont ? d.daily.streak + 1 : 1;
  const idx = (streak - 1) % 7;
  const base = DAILY_A + DAILY_B * s;
  d.coins = Math.min(MAX_COINS, d.coins + base);
  const reward = applyReward(d, idx);
  d.daily.streak = streak;
  d.daily.ladder = streak % 7;
  d.daily.last = key;
  d.daily.bestStreak = Math.max(d.daily.bestStreak, streak);
  d.daily.won[key] = s;
  for (const k of Object.keys(d.daily.won).sort().slice(0, -DAILY_KEEP)) delete d.daily.won[k];
  save(true);
  return { ...out, coins: base, reward, streak, day: idx + 1, total: base + (reward.coins || 0), paid: true };
}

// ---------- feast ----------
export const feastBest = () => (D() ? D().feast.best : 0);
export const feastGhost = () => (D() ? D().feast.ghost.slice() : []);
/** r = { tickets, times, bites, chainBest } from the Feast run. Returns { coins, pb, tickets, best, base, bonus }. */
export function feastResult(r = {}) {
  const d = D();
  const tickets = int(r.tickets, 0, FEAST_MAX, 0);
  const none = { coins: 0, pb: false, tickets, best: 0, base: 0, bonus: 0 };
  if (!d) return none;
  const pb = tickets > d.feast.best;
  const base = FEAST.coins * tickets, bonus = pb ? FEAST.pbCoins : 0;
  d.feast.plays = Math.min(1e9, d.feast.plays + 1);
  d.stats.bestChain = Math.max(d.stats.bestChain, int(r.chainBest, 0, 1e6, 0));
  if (pb) {
    d.feast.best = tickets;
    d.feast.bestBites = int(r.bites, 0, 1e6, 0);
    d.feast.ghost = (Array.isArray(r.times) ? r.times : []).slice(0, GHOST_MAX).map(x => +x).filter(x => Number.isFinite(x) && x >= 0 && x < 1e5).map(x => Math.round(x * 100) / 100);
  }
  d.coins = Math.min(MAX_COINS, d.coins + base + bonus);
  save(true);
  reportScore();
  return { coins: base + bonus, pb, tickets, best: d.feast.best, base, bonus };
}

// ---------- cookbook ----------
/**
 * { chapters:[{ town, index, mode:'current'|'done'|'tease'|'sealed', cards:[{ n, stars, state:'done'|'open'|'locked' }],
 *   beaten, complete, chest:boolean (claimed) }], stamps:[{key,stars}] (last 14 daily results, newest last), total, milestone }.
 * mode: 'done' = every card beaten, 'current' = the town the player is in, 'tease' = the next town (silhouettes on blank
 * pages), 'sealed' = further away.
 */
export function cookbook() {
  const d = D();
  const here = d ? Math.min(TOWNS.length - 1, Math.floor((Math.min(d.cur, LEVELS) - 1) / TOWN_LEVELS)) : 0;
  const chapters = TOWNS.map((town, index) => {
    const cards = [];
    let got = 0;
    for (let i = 0; i < TOWN_LEVELS; i++) {
      const n = index * TOWN_LEVELS + i + 1;
      const s = d ? d.stars[n - 1] | 0 : 0;
      if (s > 0) got++;
      cards.push({ n, stars: s, state: s > 0 ? 'done' : d && n === d.cur ? 'open' : 'locked' });
    }
    const complete = got === TOWN_LEVELS;
    const mode = complete ? 'done' : index === here ? 'current' : index === here + 1 ? 'tease' : index < here ? 'done' : 'sealed';
    return { town, index, mode, cards, beaten: got, complete, chest: !!d && d.chests.includes(town) };
  });
  const stamps = d ? Object.keys(d.daily.won).sort().slice(-14).map(key => ({ key, stars: d.daily.won[key] })) : [];
  return { chapters, stamps, total: totalStars(), milestone: nextMilestone() };
}

// ---------- settings / tutorial / reset ----------
const SETTING_KEYS = ['music', 'sfx', 'haptics', 'stick', 'mute'];
/** setting(k) reads; setting(k, v) validates, stores, saves and returns the stored value. Keys: music, sfx, haptics, stick, mute. */
export function setting(k, v) {
  // DECISION: 'mute' (boolean, default false) is the web mute toggle; Core asked for it so the choice survives a reload (not in the GDD).
  const d = D();
  const fallback = { music: 0.7, sfx: 0.9, haptics: true, stick: null, mute: false };
  if (!SETTING_KEYS.includes(k)) return undefined;
  if (!d) return fallback[k];
  if (arguments.length < 2) return d.set[k];
  if (k === 'music' || k === 'sfx') d.set[k] = num01(v, d.set[k]);
  else if (k === 'haptics' || k === 'mute') d.set[k] = !!v;
  else d.set.stick = v === null || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 12) ? v : null;
  save();
  return d.set[k];
}
const tutBit = f => (typeof f === 'string' ? TUT[f] | 0 : int(f, 0, 2 ** 30 - 1, 0));
/** tut(flag) -> seen?; tut(flag, true) marks it seen (saved). flag = bit number (1, 2, 4, ...) or a TUT name ('drag'). */
export function tut(flag, set) {
  const d = D();
  const bit = tutBit(flag);
  if (!d || !bit) return false;
  const seen = (d.tut & bit) === bit;
  if (set && !seen) { d.tut |= bit; save(); return true; }
  return seen;
}
/** QA only: marks every tutorial flag seen. */
export function tutAll() { const d = D(); if (!d) return; d.tut = Object.values(TUT).reduce((a, b) => a | b, 0); save(); }

/** Wipes progress, coins, boosters, skins, daily, feast and tutorial flags. Keeps settings and best. Writes through at once. */
export function reset() {
  const d = D();
  if (!d) return;
  const keep = { best: d.best, set: { ...d.set } };
  replaceIn(d, { ...sanitize(null), ...keep, ts: Math.max(Date.now(), d.ts | 0) });
  P.save();
  if (P.flush) P.flush();
}
