// Knot Kitty meta: save schema v1, migrate, economy, boosters, shop, kittens, daily, score (GDD §3.8, §4.5, §6, §11, §13.8).
// Every write mutates P.data and then calls P.save(). Score = totalStars*100 + levelsBeaten, reported via P.best.
//
// DECISION: recordWin's `chain` is the chain bonus already earned in the attempt (Σ (m−1) over arriving spools that
//   absorbed m ≥ 2 basket balls). An array of per-spool absorb counts [m, …] is also accepted. Optional `jumbo` = number
//   of jumbo spools completed (+5 each, §4.3.6). Both are paid only on a win, inside recordWin (Core shows the pops only).
// DECISION: the boss ×2 applies to the first win only (replays of a boss pay like any level).
// DECISION: `balls` returned by recordWin is the level reward (incl. chain/jumbo); gift and chest balls are inside
//   `gifts[]` (each already credited) so the win card can count up the level reward and the popups show their own.
// DECISION: recordWin also grants booster unlock gifts (unlockGifts(cur)) and returns them as { kind: 'booster', k, n },
//   processed before milestones/chests so a chest includes a booster unlocked by the same win (L9 → Slot, then L10 chest).
// DECISION: a booster is unlocked once the player has reached its level (cur ≥ unlock) or it was ever gifted.
// DECISION: the star-milestone booster is a deterministic "random" pick from the unlocked boosters, keyed by the milestone
//   number, so a reload never re-rolls it. If none is unlocked yet the gift is balls only.
// DECISION: golden kitten = boss level won with 3★ (also upgrades on a later 3★ replay). kittenId = id when the kitten is
//   newly rescued or newly golden, else 0.
// DECISION: daily unlocked = L6 beaten (cur ≥ 7). stamps = the 7 IST days ending today (index 6 = today).
//   A streak shown/continued only if the last daily win was today or yesterday; otherwise it reads 0.
//   recordDailyWin/daily take an optional dateKey (defaults to istDateKey()) so Core can pass the session's date.
// DECISION: buyOutfit also wears it. resetAll keeps settings and `best` (the score only rises; yt already has it).
// DECISION: saved `best` is clamped to [0, MAX_SCORE]; a v0 (prototype) save's `best` is dropped (different metric) and
//   rebuilt by P.best(score()) in initMeta.
// Extras beyond §13.8 (read-only helpers for the map): totalStars(), nextGift(), chestClaimed(w), MAX_SCORE.
// DECISION (fix1): daily.last is a monotonic high-water mark (max won key). A win with key ≤ last pays 0 and leaves
//   the streak alone, so a clock set backwards can neither re-pay a daily (even one trimmed out of the 14-key `won`
//   list) nor break or reset the streak. daily(key) with key ≤ last reads won = true (already claimed) and the current
//   streak. Daily replays are allowed and pay 0 (GDD §3: "Replays allowed, reward once").
// DECISION (fix1): a daily recorded while the daily is locked (cur ≤ 6, api only; the UI gates it) pays 0 and does
//   not touch the streak. A paying daily or first bonus win also pays the chain/jumbo bonus like a level does.
// DECISION (fix1): bonus tangles: only a win of index === d.bonus pays 10 + 5×stars (+chain/jumbo) and advances
//   d.bonus; a replay of an earlier index pays 3 (as a level replay) and does not advance, so NEXT never skips one.
//   The index comes from recordWin's `bonusId` (or recordBonusWin's 2nd arg), else the last recordAttempt('bonus', i),
//   else d.bonus (legacy callers).
// DECISION (fix1): sanitize derives cur from the stars (cur = highest beaten + 1); the chain bonus is capped per
//   spool (m ≤ CHAIN_M) and per win (≤ MAX_STRANDS), since a level has at most MAX_STRANDS strands to basket.
// DECISION (fix1): kittenName(i) (i = 0-based kitten index, the same as kittens()[i]; a recordWin kittenId is i + 1)
//   gives each of the 60 kittens a fixed, unique name. Bosses (every 10th) get the grand names.

import P from '../shared/platform.js';
import { LEVELS, PER_WORLD, SAVE_V, BOOSTERS, OUTFITS, MAX_STRANDS, bus } from './consts.js';
import { dailyIndex, istDateKey } from './levels.js';

const BK = ['undo', 'hint', 'slot', 'snip'];
const GIFT_EVERY = 15, GIFT_BALLS = 60, CHEST_BALLS = 150, START_BALLS = 50;
const MAX_BALLS = 9999999, MAX_BOOST = 999, DAILY_KEEP = 14, REPLAY_BALLS = 3, CHAIN_M = 12;
const CHAIN_MAX = MAX_STRANDS || 28;
export const MAX_SCORE = LEVELS * 3 * 100 + LEVELS;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OUTFIT_IDS = OUTFITS.map(o => o[0]);

// ---------- small helpers ----------
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const int = (v, lo, hi, dflt = lo) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const num01 = (v, dflt) => { const n = +v; return typeof v !== 'boolean' && v !== null && v !== '' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt; };
const arr60 = (a, hi) => Array.from({ length: LEVELS }, (_, i) => int(Array.isArray(a) ? a[i] : 0, 0, hi, 0));
const isBoss = id => id % PER_WORLD === 0;
const validId = id => Number.isInteger(id) && id >= 1 && id <= LEVELS;
const D = () => P.data;
const save = () => P.save();

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------- schema ----------
export function defaults() {
  return {
    v: SAVE_V, best: 0,
    stars: Array(LEVELS).fill(0),
    cur: 1,
    balls: START_BALLS,
    boost: { undo: 0, hint: 0, slot: 0, snip: 0 },
    gifted: { undo: false, hint: false, slot: false, snip: false },
    outfits: ['tabby'], wear: 'tabby',
    kittens: Array(LEVELS).fill(0),
    daily: { won: [], streak: 0, last: '' },
    bonus: 0,
    giftsClaimed: 0,
    chests: 0,
    set: { music: 0.7, sfx: 0.9, haptics: true },
    tut: {},
    stats: { plays: 0, wins: 0, pulls: 0 },
  };
}

/** Normalises any object into a valid v1 save (unknown fields dropped, arrays 60 long, numbers clamped). */
function sanitize(src) {
  const s = isObj(src) ? src : {};
  const o = defaults();
  o.best = int(s.best, 0, MAX_SCORE, 0);
  o.stars = arr60(s.stars, 3);
  const k = arr60(s.kittens, 2);
  // A rescued kitten means the level was beaten and vice versa; golden only exists on bosses.
  o.kittens = k.map((v, i) => (o.stars[i] > 0 ? Math.max(1, v === 2 && !isBoss(i + 1) ? 1 : v) : 0));
  let hi = 0;
  o.stars.forEach((v, i) => { if (v > 0) hi = i + 1; });
  // cur only ever moves to (highest beaten + 1), so derive it: a hand-edited cur 61 with 0 stars boots at L1.
  o.cur = Math.min(LEVELS + 1, hi + 1);
  o.balls = int(s.balls, 0, MAX_BALLS, START_BALLS);
  if (isObj(s.boost)) for (const b of BK) o.boost[b] = int(s.boost[b], 0, MAX_BOOST, 0);
  if (isObj(s.gifted)) for (const b of BK) o.gifted[b] = s.gifted[b] === true;
  if (Array.isArray(s.outfits)) o.outfits = OUTFIT_IDS.filter(id => id === 'tabby' || s.outfits.includes(id));
  o.wear = o.outfits.includes(s.wear) ? s.wear : 'tabby';
  if (isObj(s.daily)) {
    const won = Array.isArray(s.daily.won) ? s.daily.won.filter(x => typeof x === 'string' && KEY_RE.test(x)) : [];
    o.daily.won = [...new Set(won)].sort().slice(-DAILY_KEEP);
    o.daily.last = typeof s.daily.last === 'string' && KEY_RE.test(s.daily.last) ? s.daily.last : '';
    o.daily.streak = o.daily.last ? int(s.daily.streak, 0, 99999, 0) : 0;
  }
  o.bonus = int(s.bonus, 0, 1e7, 0);
  o.giftsClaimed = int(s.giftsClaimed, 0, Math.floor((LEVELS * 3) / GIFT_EVERY), 0);
  o.chests = int(s.chests, 0, (1 << Math.ceil(LEVELS / PER_WORLD)) - 1, 0);
  if (isObj(s.set)) {
    o.set.music = num01(s.set.music, o.set.music);
    o.set.sfx = num01(s.set.sfx, o.set.sfx);
    if (typeof s.set.haptics === 'boolean') o.set.haptics = s.set.haptics;
  }
  if (isObj(s.tut)) for (const t of Object.keys(s.tut).slice(0, 64)) if (s.tut[t] && t.length <= 32) o.tut[t] = 1;
  if (isObj(s.stats)) for (const t of ['plays', 'wins', 'pulls']) o.stats[t] = int(s.stats[t], 0, 1e9, 0);
  return o;
}

/** Upgrades any older or unknown shape to v1. Prototype saves {at:n} / {v:0, at:n}: levels 1..n beaten with 1★. */
export function migrate(old) {
  const s = isObj(old) ? old : {};
  const o = sanitize(s);
  if ((+s.v | 0) < 1) o.best = 0; // the prototype's best was a different metric; initMeta re-reports score()
  const at = int(s.at, 0, LEVELS, 0);
  for (let i = 0; i < at; i++) { o.stars[i] = Math.max(1, o.stars[i]); o.kittens[i] = Math.max(1, o.kittens[i]); }
  o.cur = Math.max(o.cur, Math.min(LEVELS + 1, at + 1));
  o.v = SAVE_V;
  return o;
}

let wired = false;
/** After P.init: sanitise P.data in place, wire stats, report the score. */
export function initMeta() {
  const d = D();
  if (!d) return null;
  const clean = sanitize(d);
  clean.v = Math.max(SAVE_V, int(d.v, 0, 1e6, SAVE_V));
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, clean);
  save();
  if (!wired) {
    wired = true;
    bus.on('pull', () => { if (D()) { D().stats.pulls++; save(); } });
  }
  P.best(score());
  return d;
}

// ---------- progress and score ----------
export const stars = id => (validId(id) && D() ? D().stars[id - 1] : 0);
export const totalStars = () => (D() ? D().stars.reduce((a, b) => a + b, 0) : 0);
export const progress = () => (D() ? D().stars.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) : 0);
export const score = () => totalStars() * 100 + progress();
export const cur = () => (D() ? D().cur : 1);
export const unlocked = id => validId(id) && id <= cur();
export const chestClaimed = w => !!(D() && D().chests & (1 << (w - 1)));
/** Star bar to the next gift box on the map: { have, need } (need = next multiple of 15, or the max when all claimed). */
export function nextGift() {
  const have = totalStars(), max = LEVELS * 3;
  return { have, need: Math.min(max, (Math.floor(have / GIFT_EVERY) + 1) * GIFT_EVERY) };
}

// ---------- balls ----------
export const balance = () => (D() ? D().balls : 0);
export function addBalls(n) {
  n = Math.floor(+n || 0);
  if (!D() || n <= 0) return balance();
  D().balls = Math.min(MAX_BALLS, D().balls + n);
  save();
  return D().balls;
}
export function spend(n) {
  n = Math.floor(+n || 0);
  if (!D() || n < 0 || D().balls < n) return false;
  D().balls -= n;
  save();
  return true;
}

// ---------- boosters ----------
export const booster = k => (D() && BK.includes(k) ? D().boost[k] : 0);
export const boosterUnlocked = k => !!(D() && BOOSTERS[k] && (D().cur >= BOOSTERS[k].unlock || D().gifted[k]));
export function useBooster(k) {
  if (!booster(k)) return false;
  D().boost[k]--;
  save();
  return true; // Core emits bus 'booster'
}
export function buyBooster(k) {
  if (!boosterUnlocked(k) || D().boost[k] >= MAX_BOOST || !spend(BOOSTERS[k].price)) return false;
  D().boost[k]++;
  save();
  return true;
}
/** Grants each booster's one-time unlock gift for every booster whose unlock level ≤ levelIdReached. */
export function unlockGifts(levelIdReached) {
  const d = D(), got = [];
  if (!d) return got;
  for (const k of BK) {
    if (d.gifted[k] || BOOSTERS[k].unlock > levelIdReached) continue;
    d.gifted[k] = true;
    d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + BOOSTERS[k].gift);
    got.push(k);
  }
  if (got.length) save();
  return got;
}
const unlockedList = () => BK.filter(boosterUnlocked);

// ---------- wins ----------
function chainBonus(chain) {
  if (Array.isArray(chain)) return Math.min(CHAIN_MAX, chain.slice(0, 64).reduce((a, m) => a + int(m, 1, CHAIN_M, 1) - 1, 0));
  return int(chain, 0, CHAIN_MAX, 0);
}
const extraBonus = (chain, jumbo) => chainBonus(chain) + 5 * int(jumbo, 0, 99, 0);

function grantGifts(gifts) {
  const d = D();
  // Star milestones: every 15 total stars → 60 balls + 1 booster.
  const reached = Math.floor(totalStars() / GIFT_EVERY);
  while (d.giftsClaimed < reached) {
    const m = ++d.giftsClaimed, list = unlockedList();
    const k = list.length ? list[((m * 2654435761) >>> 0) % list.length] : null;
    d.balls = Math.min(MAX_BALLS, d.balls + GIFT_BALLS);
    if (k) d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + 1);
    gifts.push({ kind: 'stars', at: m * GIFT_EVERY, balls: GIFT_BALLS, booster: k });
  }
}

/**
 * Records a won attempt. kind 'level' (id 1..60); 'daily'/'bonus' delegate to recordDailyWin/recordBonusWin.
 * Returns { balls, firstWin, newStars, kittenId, golden, gifts, newBest }. Calls P.best(score()).
 */
export function recordWin({ kind = 'level', id = 0, stars: st = 1, peak = 0, capped = false, chain = 0, jumbo = 0, dateKey, bonusId } = {}) {
  const res = { balls: 0, firstWin: false, newStars: 0, kittenId: 0, golden: false, gifts: [], newBest: false };
  const d = D();
  if (!d) return res;
  let s = int(st, 1, 3, 1);
  if (capped) s = Math.min(2, s);
  if (kind === 'daily' || kind === 'bonus') {
    const extra = extraBonus(chain, jumbo);
    res.balls = kind === 'daily' ? payDaily(s, dateKey, extra) : payBonus(s, bonusId, extra);
    res.newBest = P.best(score());
    return res;
  }
  if (!validId(id)) return res;
  const i = id - 1, prev = d.stars[i];
  res.firstWin = prev === 0;
  res.newStars = Math.max(0, s - prev);
  let b = res.firstWin ? 10 + 5 * s : res.newStars > 0 ? 5 * res.newStars : 3;
  if (res.firstWin && isBoss(id)) b *= 2;
  b += extraBonus(chain, jumbo);
  res.balls = b;
  d.balls = Math.min(MAX_BALLS, d.balls + b);
  d.stars[i] = Math.max(prev, s);

  const kPrev = d.kittens[i];
  const kNew = isBoss(id) && s === 3 ? 2 : Math.max(1, kPrev);
  d.kittens[i] = Math.max(kPrev, kNew);
  res.golden = d.kittens[i] === 2;
  if (d.kittens[i] !== kPrev) res.kittenId = id;

  d.cur = Math.max(d.cur, Math.min(LEVELS + 1, id + 1));
  d.stats.wins++;

  for (const k of unlockGifts(d.cur)) res.gifts.push({ kind: 'booster', k, n: BOOSTERS[k].gift });
  grantGifts(res.gifts);
  if (res.firstWin && isBoss(id)) {
    const w = id / PER_WORLD, bit = 1 << (w - 1);
    if (!(d.chests & bit)) {
      d.chests |= bit;
      d.balls = Math.min(MAX_BALLS, d.balls + CHEST_BALLS);
      const boosters = unlockedList();
      for (const k of boosters) d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + 1);
      res.gifts.push({ kind: 'chest', world: w, balls: CHEST_BALLS, boosters });
    }
  }
  save();
  for (const g of res.gifts) bus.emit('gift', g);
  res.newBest = P.best(score());
  return res;
}

let attempt = null; // { kind, id } of the last started attempt (module memory: tells a bonus replay from a new one)
export function recordAttempt(kind, id) {
  attempt = { kind, id };
  if (!D()) return;
  D().stats.plays++;
  save();
}

// ---------- outfits / kittens ----------
export function outfits() {
  const d = D();
  return OUTFITS.map(([id, name, price]) => ({ id, name, price, owned: !!d && d.outfits.includes(id), worn: !!d && d.wear === id }));
}
export function buyOutfit(id) {
  const o = OUTFITS.find(x => x[0] === id);
  if (!o || !D() || D().outfits.includes(id) || !spend(o[2])) return false;
  D().outfits = OUTFIT_IDS.filter(x => x === id || D().outfits.includes(x));
  D().wear = id;
  save();
  return true;
}
export function wear(id) {
  if (!D() || !D().outfits.includes(id)) return false;
  D().wear = id;
  save();
  return true;
}
export const kittens = () => (D() ? D().kittens.slice() : Array(LEVELS).fill(0));

// 60 unique names; index i = kitten i (level i + 1). Every 10th is a boss kitten with a grand name.
const KITTEN_NAMES = [
  'Mochi', 'Biscuit', 'Pip', 'Noodle', 'Waffles', 'Bean', 'Toffee', 'Pickles', 'Button', 'Duchess Marmalade',
  'Nutmeg', 'Pumpkin', 'Sprout', 'Hazel', 'Crumpet', 'Fig', 'Bramble', 'Clove', 'Squash', 'Count Whiskerton',
  'Snowdrop', 'Pebble', 'Flurry', 'Cocoa', 'Mitten', 'Juniper', 'Frost', 'Tinsel', 'Dumpling', 'Lady Snowpaw',
  'Latte', 'Sugar', 'Macaron', 'Truffle', 'Scone', 'Caramel', 'Bagel', 'Espresso', 'Brioche', 'Baron Von Purr',
  'Dusty', 'Willow', 'Moth', 'Lantern', 'Pocket', 'Thimble', 'Shadow', 'Velvet', 'Acorn', 'Princess Moonbeam',
  'Comet', 'Twinkle', 'Nova', 'Pixel', 'Orbit', 'Luna', 'Stardust', 'Cosmo', 'Sparkle', 'Queen Yarnabelle',
];
/** Deterministic cute name for kitten i (0-based, as kittens()[i]; level id = i + 1). */
export function kittenName(i) {
  i = Math.floor(+i);
  if (!Number.isFinite(i)) return 'Kitten';
  return KITTEN_NAMES[((i % LEVELS) + LEVELS) % LEVELS] || 'Kitten';
}

// ---------- daily knot ----------
// A key at or before the high-water `last` is a clock set backwards (or today): the streak stands.
const streakOn = (d, key) => (d.daily.last && (key <= d.daily.last || d.daily.last === addDays(key, -1)) ? d.daily.streak : 0);
const claimed = (d, key) => d.daily.won.includes(key) || (!!d.daily.last && key <= d.daily.last);

export function daily(key = istDateKey()) {
  const d = D();
  const won = !!d && claimed(d, key);
  return {
    key,
    i: dailyIndex(key).i,
    won,
    streak: d ? streakOn(d, key) : 0,
    unlocked: !!d && d.cur > 6,
    stamps: Array.from({ length: 7 }, (_, j) => !!d && d.daily.won.includes(addDays(key, j - 6))),
  };
}

/**
 * Rewards a daily once: 40 + 10×stars + 10×min(streak, 7). Returns the balls granted. Pays 0 on a replay, on any key
 * at or before the high-water daily.last (clock set backwards), and while the daily is locked.
 */
export function recordDailyWin(st, key = istDateKey()) { return payDaily(st, key, 0); }
function payDaily(st, key, extra) {
  const d = D();
  if (key === undefined || key === null) key = istDateKey();
  if (!d || typeof key !== 'string' || !KEY_RE.test(key)) return 0;
  const s = int(st, 1, 3, 1);
  d.stats.wins++;
  if (d.cur <= 6 || claimed(d, key)) { save(); return 0; }
  d.daily.streak = d.daily.last === addDays(key, -1) ? d.daily.streak + 1 : 1;
  d.daily.last = key;
  d.daily.won = [...new Set([...d.daily.won, key])].sort().slice(-DAILY_KEEP);
  const b = 40 + 10 * s + 10 * Math.min(d.daily.streak, 7) + extra;
  d.balls = Math.min(MAX_BALLS, d.balls + b);
  save();
  return b;
}

export const bonusNext = () => (D() ? D().bonus : 0);
/** Bonus tangle i won: 10 + 5×stars and d.bonus++ only when i is the next one (d.bonus); a replay pays 3. */
export function recordBonusWin(st, i) { return payBonus(st, i, 0); }
function payBonus(st, i, extra) {
  const d = D();
  if (!d) return 0;
  if (!Number.isInteger(i)) i = attempt && attempt.kind === 'bonus' && Number.isInteger(attempt.id) ? attempt.id : d.bonus;
  d.stats.wins++;
  let b = REPLAY_BALLS;
  if (i === d.bonus) { b = 10 + 5 * int(st, 1, 3, 1) + extra; d.bonus = Math.min(1e7, d.bonus + 1); }
  d.balls = Math.min(MAX_BALLS, d.balls + b);
  save();
  return b;
}

// ---------- settings / tutorial ----------
export const settings = () => (D() ? { ...D().set } : { music: 0.7, sfx: 0.9, haptics: true });
export function setSetting(k, v) {
  const d = D();
  if (!d) return;
  if (k === 'music' || k === 'sfx') d.set[k] = num01(v, d.set[k]);
  else if (k === 'haptics') d.set.haptics = !!v;
  else return;
  save();
}
export const tutSeen = key => !!(D() && D().tut[key]);
export function markTut(key) {
  if (!D() || D().tut[key]) return;
  D().tut[key] = 1;
  save();
}

/** Wipes progress, balls, boosters, outfits, kittens, daily and tutorial flags. Keeps settings and best. */
export function resetAll() {
  const d = D();
  if (!d) return;
  const keep = { best: d.best, set: { ...d.set } };
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, defaults(), keep);
  save();
}

export const qaOldSave = () => ({ save: '{"v":0,"best":0,"at":3}', progress: 3 });
