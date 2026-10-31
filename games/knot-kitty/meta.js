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
// DECISION: daily unlocked = L13 beaten (cur ≥ 14; fix3, critic r2: every Daily board has key/lock pairs, taught at L14). stamps = the 7 IST days ending today (index 6 = today).
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
// DECISION (fix1, v2 numbers): bonus tangles: only a win of index === d.bonus pays 2 + 4×stars (+chain/jumbo/combo)
//   and advances d.bonus; a replay of an earlier index pays 1 (as a level replay) and does not advance.
//   The index comes from recordWin's `bonusId` (or recordBonusWin's 2nd arg), else the last recordAttempt('bonus', i),
//   else d.bonus (legacy callers).
// DECISION (fix1): sanitize derives cur from the stars (cur = highest beaten + 1); the chain bonus is capped per
//   spool (m ≤ CHAIN_M) and per win (≤ MAX_STRANDS), since a level has at most MAX_STRANDS strands to basket.
// DECISION (polish): combo bonus yarn. play.js pays +1/+2/+3 for a spool completed at combo ×2/×3/×4+ (combo =
//   spools completed back to back) and hands the attempt's total to recordWin as `combo`. It is credited once, inside
//   recordWin, in the same balls += b / save() as the base payout; a lost or restarted attempt never reaches recordWin.
//   Caps follow the base payout's replay rules: a first win or a win that adds stars (level), a paying daily and the
//   next bonus tangle pay up to COMBO_CAP (8); a level replay that adds no stars pays at most COMBO_REPLAY (1), like
//   its flat 3; a daily replay or a bonus-tangle replay pays 0 (those replays already ignore chain/jumbo extras).
//   Bosses do not double it. comboCap(kind, id) is the most a win of that attempt can pay (play.js caps its pops with
//   it); recordWin returns the credited amount as res.combo (inside res.balls).
// DECISION (polish): economy v2 (designer critic: 651–668 yarn by L13, a 300 outfit at L10). Was first win 10 + 5×s,
//   replay 5×new★ / 3, gifts 60, chests 150, daily 40 + 10×s + 10×streak. Now first win 2 + 4×s (boss ×2), replay
//   4×new★ / 1, a plain replay's chain/jumbo extras capped at 1, gifts 15 (+ booster), chests 25 (+ boosters), daily
//   15 + 4×s + 4×min(streak, 7). Start stays 50; shop prices unchanged. Projection (rules.js bots, no spending, no
//   dailies): a typical ≈1.9★ player ('average' bot) has 120 by L6, 300 by L14, 1000 by L49; a 3★ combo planner by
//   L5 / L12 / L39, earning 30% more by L50. Table in studio/2026-10-16/polish/meta.md.
// DECISION (fix1): kittenName(i) (i = 0-based kitten index, the same as kittens()[i]; a recordWin kittenId is i + 1)
//   gives each of the 60 kittens a fixed, unique name. Bosses (every 10th) get the grand names.

import P from '../shared/platform.js';
import { LEVELS, PER_WORLD, BOOSTERS, OUTFITS, MAX_STRANDS, RAINBOW, TEACH, bus } from './consts.js';
import { dailyIndex, istDateKey } from './levels.js';
import BONUS from './bonus-data.js';

// DECISION (meta v2, 2026-10-31): save schema v2 adds `sets` { claimed, gold } (world bitmasks: the Kitten Corner set
//   rewards claimed) and `daily.shields` (0..2 Streak Shields). SAVE_V lives here now (consts.js is shared with the
//   level tools and stays at its old value). v0 and v1 saves migrate with every bit of progress kept.
//   Merge: set bitmasks OR together (progress); shields are spendable, so they come from the newest write like yarn.
// DECISION (meta v2): daily streak ladder. The 7-day ladder day = ((streak − 1) mod 7) + 1; a paying daily pays
//   15 + 4×stars + LADDER[day − 1] (+chain/jumbo/combo) and day 7 also gives 1 of every unlocked booster, then loops.
//   Streak Shield (shop, 150 yarn, hold 2): when the next paying daily finds a gap of g missed days and g ≤ shields,
//   g shields are spent and the streak carries on (P.event 'shield_used'). streakOn shows a covered streak as alive.
// DECISION (meta v2): Bonus Tangles. A first win of the next tangle pays 20 + 6×stars (+extras) and every 5th first
//   win also gives 1 booster (rotating over the unlocked ones). Progressive unlock: 10 tangles per world boss beaten
//   from World 3 (L30 → 10, L40 → 20, L50 → 30), every tangle after L60; and the next tangle waits until every
//   mechanic on its board has been taught (its TEACH level beaten), so a mid-campaign player never meets an untaught one.
// DECISION (meta v2): Kitten Corner sets, one per world. All 10 kittens rescued → claim 80 yarn + 1 Hint; all 10
//   levels at 3★ → the Golden set: 200 yarn + 1 of every unlocked booster (P.event 'set_claim').
export const SAVE_V = 2;

const BK = ['undo', 'hint', 'slot', 'snip'];
// Economy v2 (polish): see the DECISION above. First win WIN_A + WIN_B×stars (boss ×2), a star-improving replay
// WIN_B per new star, a plain replay REPLAY_BALLS (+ at most 1 chain/jumbo extra, + at most COMBO_REPLAY combo).
const GIFT_EVERY = 15, GIFT_BALLS = 15, CHEST_BALLS = 25, START_BALLS = 50, WIN_A = 2, WIN_B = 4, REPLAY_EXTRA = 1;
const DAILY_A = 15, DAILY_B = 4, DAILY_AFTER = 13;
export const LADDER = [4, 8, 12, 16, 20, 28, 50];
export const SHIELD_PRICE = 150, SHIELD_MAX = 2;
const BONUS_A = 20, BONUS_B = 6, BONUS_GIFT_EVERY = 5;
export const SET_BALLS = 80, GOLD_BALLS = 200;
const WORLDS_N = Math.ceil(LEVELS / PER_WORLD);
const MAX_BALLS = 9999999, MAX_BOOST = 999, DAILY_KEEP = 14, REPLAY_BALLS = 1, CHAIN_M = 12;
export const COMBO_CAP = 8, COMBO_REPLAY = 1;
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
const save = () => { mergeStored(); P.save(); };
const safe = fn => { try { return fn(); } catch { return undefined; } };

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
    daily: { won: [], streak: 0, last: '', shields: 0 },
    bonus: 0,
    sets: { claimed: 0, gold: 0 },
    giftsClaimed: 0,
    chests: 0,
    set: { music: 0.7, sfx: 0.9, haptics: true },
    tut: {},
    stats: { plays: 0, wins: 0, pulls: 0 },
  };
}

/** Normalises any object into a valid v2 save (unknown fields dropped, arrays 60 long, numbers clamped). */
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
    o.daily.shields = int(s.daily.shields, 0, SHIELD_MAX, 0);
  }
  if (isObj(s.sets)) {
    const full = (1 << WORLDS_N) - 1;
    o.sets.claimed = int(s.sets.claimed, 0, full, 0);
    o.sets.gold = int(s.sets.gold, 0, full, 0);
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

/** Upgrades any older or unknown shape to v2 (v1 → v2 only adds fields: sanitize fills them). Prototype saves {at:n} / {v:0, at:n}: levels 1..n beaten with 1★. */
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

// ---------- multi-tab safety (ui2 S1) ----------
// DECISION (ui2 S1): two tabs of the game on the web each hold the whole save in memory and each write it whole, so the
//   last writer used to erase the other tab's progress. Now (web only, never in ?record / ?og, which never save):
//   1. every meta save() first merges the stored save (P.readStored) into P.data (this tab's write is the newest);
//   2. a 'storage' listener merges another tab's write as it lands (that write is the newest).
//   Merge rule: progress only grows (max of stars, kittens, cur, best, bonus, giftsClaimed, stats; OR of chests and
//   gifted; union of outfits, tut and daily wins, the later daily.last carrying its streak). Currency, boosters,
//   settings and the worn outfit come together from the newest write, so a cross-tab merge can never duplicate yarn.
//   The stored value is only trusted when it parses to a v ≥ 1 object with a stars array; anything else (corrupt,
//   truncated, foreign) is ignored and never lowers this tab's data. Save format and SAVE_V are unchanged.
//   resetAll writes through at once (no merge), and another tab adopts a reset (a valid save with no stars and no
//   wins) instead of merging its old progress back in.
const Qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const qOn = k => !!Qs && (Qs.get(k) === '1' || Qs.get(k) === 'true');
const SYNC = P.env === 'web' && !qOn('record') && !qOn('og');
function lsRead() { try { return P.readStored ? P.readStored() : null; } catch { return null; } }
function parseStored(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let o = null;
  try { o = JSON.parse(raw); } catch { return null; }
  return isObj(o) && (+o.v | 0) >= 1 && Array.isArray(o.stars) ? o : null;
}
const isResetSave = o => o.stars.every(v => !(+v > 0)) && !(isObj(o.stats) && +o.stats.wins > 0);
/** Merges the stored save `o` into d in place; `theirsNewer` picks whose yarn/boosters/settings/outfit win. */
function mergeInto(d, o, theirsNewer) {
  const t = sanitize(o);
  d.best = Math.max(int(d.best, 0, MAX_SCORE, 0), t.best);
  for (let i = 0; i < LEVELS; i++) {
    d.stars[i] = Math.max(d.stars[i] | 0, t.stars[i]);
    d.kittens[i] = Math.max(d.kittens[i] | 0, t.kittens[i]);
  }
  d.cur = Math.max(d.cur | 0, t.cur);
  for (const k of BK) d.gifted[k] = d.gifted[k] === true || t.gifted[k];
  d.outfits = OUTFIT_IDS.filter(id => id === 'tabby' || d.outfits.includes(id) || t.outfits.includes(id));
  for (const k of Object.keys(t.tut)) d.tut[k] = 1;
  for (const k of ['plays', 'wins', 'pulls']) d.stats[k] = Math.max(d.stats[k] | 0, t.stats[k]);
  const dl = d.daily, tl = t.daily;
  dl.won = [...new Set([...dl.won, ...tl.won])].sort().slice(-DAILY_KEEP);
  if (tl.last > dl.last) { dl.last = tl.last; dl.streak = tl.streak; } else if (tl.last === dl.last) dl.streak = Math.max(dl.streak, tl.streak);
  d.bonus = Math.max(d.bonus | 0, t.bonus);
  d.giftsClaimed = Math.max(d.giftsClaimed | 0, t.giftsClaimed);
  d.chests = (d.chests | 0) | t.chests;
  if (!isObj(d.sets)) d.sets = { claimed: 0, gold: 0 };
  d.sets.claimed = (d.sets.claimed | 0) | t.sets.claimed;
  d.sets.gold = (d.sets.gold | 0) | t.sets.gold;
  if (theirsNewer) {
    d.balls = t.balls;
    d.daily.shields = t.daily.shields;
    for (const k of BK) d.boost[k] = t.boost[k];
    d.set = { ...t.set };
    d.wear = t.wear;
  }
  if (!d.outfits.includes(d.wear)) d.wear = 'tabby';
}
/** Before this tab writes: fold in what another tab may have stored since. Never throws. */
function mergeStored() {
  const d = D();
  if (!syncWired || !d) return; // only once initMeta has sanitised P.data
  try { const o = parseStored(lsRead()); if (o && !isResetSave(o)) mergeInto(d, o, false); } catch (e) { P.error && P.error(e); }
}
function onStorage(raw) {
  const d = D();
  if (!d) return;
  try {
    const o = parseStored(raw);
    if (!o) return; // removed, corrupt or foreign: keep this tab's data, never lose progress
    const before = JSON.stringify(d);
    if (isResetSave(o) && d.stars.some(v => v > 0)) { // the other tab reset progress: adopt it, do not resurrect
      const clean = sanitize(o);
      clean.v = d.v;
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, clean);
      bus.emit && bus.emit('saveSync', { reset: true });
      return;
    }
    mergeInto(d, o, true);
    const after = JSON.stringify(d);
    if (after === before) return;
    bus.emit && bus.emit('saveSync', { reset: false });
    // this tab held progress the other did not: write the union back (no merge: the other write is already in)
    if (after !== JSON.stringify({ ...sanitize(o), v: d.v })) P.save();
  } catch (err) { P.error && P.error(err); }
}
let syncWired = false;
function wireSync() {
  if (syncWired || !SYNC || !P.onStoredChange) return;
  syncWired = true;
  P.onStoredChange(onStorage);
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
  wireSync();
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
export function recordWin({ kind = 'level', id = 0, stars: st = 1, peak = 0, capped = false, chain = 0, jumbo = 0, combo = 0, dateKey, bonusId } = {}) {
  const res = { balls: 0, firstWin: false, newStars: 0, kittenId: 0, golden: false, gifts: [], newBest: false, combo: 0 };
  const d = D();
  if (!d) return res;
  let s = int(st, 1, 3, 1);
  if (capped) s = Math.min(2, s);
  const cb = int(combo, 0, COMBO_CAP, 0);
  if (kind === 'daily' || kind === 'bonus') {
    const extra = extraBonus(chain, jumbo);
    const o = { combo: 0 };
    res.balls = kind === 'daily' ? payDaily(s, dateKey, extra, cb, o) : payBonus(s, bonusId, extra, cb, o);
    res.combo = o.combo;
    if (o.shield) res.gifts.push({ kind: 'shield', n: o.shield });
    if (o.boosters && o.boosters.length) res.gifts.push({ kind: 'ladder', day: o.day, boosters: o.boosters });
    if (o.booster) res.gifts.push({ kind: 'bonusGift', k: o.booster, at: D().bonus });
    if (kind === 'daily' && o.day) res.day = o.day;
    res.newBest = P.best(score());
    return res;
  }
  if (!validId(id)) return res;
  const i = id - 1, prev = d.stars[i];
  res.firstWin = prev === 0;
  res.newStars = Math.max(0, s - prev);
  const full = res.firstWin || res.newStars > 0;
  let b = res.firstWin ? WIN_A + WIN_B * s : res.newStars > 0 ? WIN_B * res.newStars : REPLAY_BALLS;
  if (res.firstWin && isBoss(id)) b *= 2;
  b += full ? extraBonus(chain, jumbo) : Math.min(REPLAY_EXTRA, extraBonus(chain, jumbo));
  res.combo = Math.min(cb, full ? COMBO_CAP : COMBO_REPLAY);
  b += res.combo;
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
  { // a Kitten Corner set this win just completed (either tier): the UI points the player at the claim
    const w = Math.ceil(id / PER_WORLD), si = setInfo(w);
    if ((si.claimable && res.firstWin) || (si.goldClaimable && res.newStars > 0 && s === 3)) {
      res.setReady = w;
      res.gifts.push({ kind: 'setReady', w, gold: !!(si.goldClaimable && s === 3 && res.newStars > 0 && !si.claimable) });
    }
  }

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

/** Most combo-bonus yarn a win of this attempt can pay (see the polish DECISION). id: level id / date key / bonus index. */
export function comboCap(kind = 'level', id = 0) {
  const d = D();
  if (!d) return 0;
  if (kind === 'daily') {
    const key = typeof id === 'string' && KEY_RE.test(id) ? id : istDateKey();
    return d.cur > DAILY_AFTER && !claimed(d, key) ? COMBO_CAP : 0;
  }
  if (kind === 'bonus') return (Number.isInteger(id) ? id : d.bonus) === d.bonus ? COMBO_CAP : 0;
  return validId(id) && d.stars[id - 1] >= 3 ? COMBO_REPLAY : COMBO_CAP;
}

let attempt = null; // { kind, id } of the last started attempt (module memory: tells a bonus replay from a new one)
export function recordAttempt(kind, id) {
  // QA r1: spam-tapping a play button started the same attempt once per tap; a repeat of the same kind/id within
  //   1.5 s is the same session start and counts once
  const now = Date.now(), dup = attempt && attempt.kind === kind && attempt.id === id && now - (attempt.at || 0) < 1500;
  attempt = { kind, id, at: now };
  if (!D() || dup) return;
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
const dayN = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const gapDays = (a, b) => Math.round(dayN(b) - dayN(a)); // whole IST days from key a to key b
/** Missed days between the last daily win and `key` (0 when key is the next day or earlier). */
const missedBefore = (d, key) => (d.daily.last && key > d.daily.last ? Math.max(0, gapDays(d.daily.last, key) - 1) : 0);
// A key at or before the high-water `last` is a clock set backwards (or today): the streak stands. A gap of missed days
//   that the held Streak Shields cover also keeps it alive (they are spent on the next paying daily).
const streakOn = (d, key) => {
  if (!d.daily.last) return 0;
  if (key <= d.daily.last) return d.daily.streak;
  const miss = missedBefore(d, key);
  return miss <= (d.daily.shields | 0) ? d.daily.streak : 0;
};
const claimed = (d, key) => d.daily.won.includes(key) || (!!d.daily.last && key <= d.daily.last);
/** Ladder day (1..7) a streak of n days sits on; 0 for no streak. */
export const ladderDay = n => (n > 0 ? ((n - 1) % 7) + 1 : 0);
/** Yarn a paying daily pays at ladder day `day` with `st` stars (no chain/jumbo/combo extras). */
export const dailyPay = (day, st = 3) => DAILY_A + DAILY_B * int(st, 1, 3, 1) + LADDER[int(day, 1, 7, 1) - 1];

export function daily(key = istDateKey()) {
  const d = D();
  const won = !!d && claimed(d, key);
  const streak = d ? streakOn(d, key) : 0;
  // the ladder day today's win pays (or paid): the next day when today is still open, else the current one
  const today = won ? ladderDay(streak) : ladderDay(streak + 1);
  return {
    key,
    i: dailyIndex(key).i,
    won,
    streak,
    day: today,
    reward: dailyPay(today, 3),
    shields: d ? d.daily.shields | 0 : 0,
    // missed days today's win will spend shields on (shown as shield stamps)
    shieldNeed: d && !won && streak > 0 ? missedBefore(d, key) : 0,
    unlocked: !!d && d.cur > DAILY_AFTER,
    stamps: Array.from({ length: 7 }, (_, j) => !!d && d.daily.won.includes(addDays(key, j - 6))),
  };
}

/** Streak Shield: SHIELD_PRICE yarn, hold at most SHIELD_MAX. Returns true when bought. */
export const shields = () => (D() ? D().daily.shields | 0 : 0);
export function buyShield() {
  const d = D();
  if (!d || d.cur <= DAILY_AFTER || (d.daily.shields | 0) >= SHIELD_MAX || !spend(SHIELD_PRICE)) return false;
  d.daily.shields = (d.daily.shields | 0) + 1;
  save();
  return true;
}

/**
 * Rewards a daily once: 15 + 4×stars + LADDER[day] (+chain/jumbo/combo; day 7 adds 1 of each unlocked booster).
 * Returns the balls granted. Pays 0 on a replay, on any key at or before the high-water daily.last (clock set
 * backwards), and while the daily is locked.
 */
export function recordDailyWin(st, key = istDateKey()) { return payDaily(st, key, 0); }
function payDaily(st, key, extra, combo = 0, out = null) {
  const d = D();
  if (key === undefined || key === null) key = istDateKey();
  if (!d || typeof key !== 'string' || !KEY_RE.test(key)) return 0;
  const s = int(st, 1, 3, 1);
  d.stats.wins++;
  if (d.cur <= 6 || claimed(d, key)) { save(); return 0; }
  const miss = missedBefore(d, key);
  if (d.daily.last && miss === 0) d.daily.streak++;
  else if (d.daily.last && miss <= (d.daily.shields | 0)) {
    d.daily.shields -= miss;
    d.daily.streak++;
    if (out) out.shield = miss;
    safe(() => P.event && P.event('shield_used', { n: miss, streak: d.daily.streak }));
  } else d.daily.streak = 1;
  d.daily.last = key;
  d.daily.won = [...new Set([...d.daily.won, key])].sort().slice(-DAILY_KEEP);
  const day = ladderDay(d.daily.streak);
  const b = DAILY_A + DAILY_B * s + LADDER[day - 1] + extra + combo;
  if (out) { out.combo = combo; out.day = day; }
  d.balls = Math.min(MAX_BALLS, d.balls + b);
  if (day === 7) {
    const list = unlockedList();
    for (const k of list) d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + 1);
    if (out) out.boosters = list;
  }
  save();
  return b;
}

// ---------- bonus tangles ----------
// Level whose win teaches every mechanic on bonus board i (0 = nothing special; beyond the data: none).
const TEACH_AT = Object.fromEntries(Object.entries(TEACH).map(([lv, m]) => [m, +lv]));
const needCache = new Map();
export function bonusNeed(i) {
  if (needCache.has(i)) return needCache.get(i);
  const b = Array.isArray(BONUS) ? BONUS[i] : null;
  let n = 0;
  if (b) {
    const up = m => { n = Math.max(n, TEACH_AT[m] || 0); };
    if (b.knot || (Array.isArray(b.knots) && b.knots.length)) up('knot');
    if (b.ice) up('ice');
    if (Array.isArray(b.queue) && b.queue.some(q => isObj(q))) up('jumbo');
    for (const st of b.strands || []) {
      if (st.lock !== undefined || st.key !== undefined) up('lock');
      if (st.m) up('mystery');
      if (st.paw) up('paw');
      if (st.c === RAINBOW) up('rainbow');
      if (st.jumbo) up('jumbo');
      if (st.ice) up('ice');
    }
  }
  needCache.set(i, n);
  return n;
}
/** How many new bonus tangles the campaign has opened: 10 per world boss from World 3, all after L60. */
export function bonusCap() {
  const d = D();
  if (!d) return 0;
  if (d.cur > LEVELS) return Infinity;
  return PER_WORLD * Math.max(0, Math.floor((d.cur - 1) / PER_WORLD) - 2);
}
/**
 * The bonus tangle state for the title / map: { next (index of the next new tangle), open (it can be played now),
 * need (level to beat to open it, 0 when open), any (bonus tangles are part of this player's game yet) }.
 */
export function bonusState() {
  const d = D();
  if (!d) return { next: 0, open: false, need: 0, any: false, cap: 0 };
  const next = d.bonus, cap = bonusCap(), teach = bonusNeed(next);
  let need = 0;
  if (next >= cap) need = PER_WORLD * (Math.floor((d.cur - 1) / PER_WORLD) + 1);
  else if (d.cur <= teach) need = teach;
  need = Math.min(LEVELS, Math.max(need, 0));
  const open = need === 0 || d.cur > LEVELS;
  return { next, open, need: open ? 0 : need, any: cap > 0 || next > 0, cap };
}
export const bonusNext = () => (D() ? D().bonus : 0);
/** Bonus tangle i won: 20 + 6×stars (+extras) and d.bonus++ only when i is the next one (d.bonus); a replay pays 1. */
export function recordBonusWin(st, i) { return payBonus(st, i, 0); }
function payBonus(st, i, extra, combo = 0, out = null) {
  const d = D();
  if (!d) return 0;
  if (!Number.isInteger(i)) i = attempt && attempt.kind === 'bonus' && Number.isInteger(attempt.id) ? attempt.id : d.bonus;
  d.stats.wins++;
  let b = REPLAY_BALLS;
  if (i === d.bonus) {
    b = BONUS_A + BONUS_B * int(st, 1, 3, 1) + extra + combo;
    if (out) out.combo = combo;
    d.bonus = Math.min(1e7, d.bonus + 1);
    if (d.bonus % BONUS_GIFT_EVERY === 0) {
      const list = unlockedList(), k = list.length ? list[(d.bonus / BONUS_GIFT_EVERY - 1) % list.length] : null;
      if (k) { d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + 1); if (out) out.booster = k; }
    }
  }
  d.balls = Math.min(MAX_BALLS, d.balls + b);
  save();
  return b;
}

// ---------- Kitten Corner sets ----------
/** World w (1..6) set progress: { w, got, gold3, full, golden, claimed, goldClaimed, claimable, goldClaimable }. */
export function setInfo(w) {
  const d = D(), o = { w, got: 0, gold3: 0, full: false, golden: false, claimed: false, goldClaimed: false, claimable: false, goldClaimable: false };
  if (!d || !(w >= 1 && w <= WORLDS_N)) return o;
  for (let i = (w - 1) * PER_WORLD; i < w * PER_WORLD; i++) { if (d.kittens[i] > 0) o.got++; if (d.stars[i] >= 3) o.gold3++; }
  o.full = o.got >= PER_WORLD; o.golden = o.gold3 >= PER_WORLD;
  o.claimed = !!(d.sets.claimed & (1 << (w - 1))); o.goldClaimed = !!(d.sets.gold & (1 << (w - 1)));
  o.claimable = o.full && !o.claimed; o.goldClaimable = o.golden && !o.goldClaimed;
  return o;
}
/** Worlds with a set reward waiting (either tier). */
export const setsClaimable = () => Array.from({ length: WORLDS_N }, (_, i) => setInfo(i + 1)).filter(s => s.claimable || s.goldClaimable).map(s => s.w);
/** Reward a set claim would pay: { balls, boosters: [k…] }. */
export function setReward(gold) {
  return gold ? { balls: GOLD_BALLS, boosters: unlockedList() } : { balls: SET_BALLS, boosters: boosterUnlocked('hint') ? ['hint'] : unlockedList().slice(0, 1) };
}
/** Claims world w's set (gold = the Golden set). Returns { balls, boosters, w, gold } or null when not claimable. */
export function claimSet(w, gold = false) {
  const d = D(), s = setInfo(w);
  if (!d || !(gold ? s.goldClaimable : s.claimable)) return null;
  const r = setReward(gold);
  d.balls = Math.min(MAX_BALLS, d.balls + r.balls);
  for (const k of r.boosters) d.boost[k] = Math.min(MAX_BOOST, d.boost[k] + 1);
  if (gold) d.sets.gold |= 1 << (w - 1); else d.sets.claimed |= 1 << (w - 1);
  save();
  safe(() => P.event && P.event('set_claim', { w, gold: !!gold }));
  return { ...r, w, gold: !!gold };
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
  // ui2 S1: write the reset through now and without the multi-tab merge, which would bring the old progress back
  P.save(); P.flush();
}

export const qaOldSave = () => ({ save: '{"v":0,"best":0,"at":3}', progress: 3 });
