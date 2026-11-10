// Slurp Pot meta: save schema v2, migrate, deep fill, two-tab merge, coins, boosters, skins, daily + streak ladder + lids,
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
// DECISION (11-06 Fri, critics: the first session's reward loop was lean): stars pay 5 / 10 / 20, so the third star is worth
//   twice the second (scaled by level since round 2, see below). A coin chest rides the
//   first win of L1 (the first-win gift, 30), L5 (40), L10 (50), L15 (60), so a chest lands about every 5 levels up to the L20
//   town chest. It rides `first`, so it needs no save field and cannot pay twice, and it goes out in `chests` as { coins } with
//   no town or boost, which the chest card already draws. Start 50 + L1 32 + gift 30 = 112 coins on L2: the 60-coin continue
//   is there from L2 on, and still after one early booster. Every other price stays, so the shop keeps its pull.
// DECISION (11-06 Fri, round 2, late economy): pay rises with the level: a first win pays 10 + n plus the star pay scaled by
//   1 + n / 30 (rounded), replays pay 3 + the scaled star pay gained, x2 on L20/40/60 as before. L1 stays about where it was
//   (3 stars 32, was 30), L30 pays 50 / 60 / 80, L59 pays 84 / 99 / 128. The flat 15 to 30 made every skin past the
//   second a 25 win grind. Coins by level for average play are in GDD §3.9. Round 3 cut Royal Gold to 1000 and UFO to 1300 (consts.js):
//   the shop and the 60 coin continue are still real choices at about one win each, and all the skins cost 5,000 of the 7,100 or so
//   an average run of the campaign pays, about 8.7 wins a pot at the top of the shop.
// DECISION: levelResult pays only the win payout (see above). In-level coin
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
// DECISION: feastResult(r): pb only when tickets > feast.best (strict). Pays FEAST.coins (5) per ticket + FEAST.pbCoins (50) on a PB (11-07, was 2 + 25); the PB run's ticket
//   finish times become feast.ghost (<= 99 entries). Needs r = { tickets, times, bites, chainBest }.
// DECISION: buySkin also wears the new skin (like Knot Kitty). The Star Ladle Pot (price -1) is never buyable.
// DECISION: nextSkin(within) = the cheapest unowned buyable skin as { id, price, need } when need = price - coins <= within
//   (default Infinity); the win card asks for 100 (need 0 = affordable now).
// DECISION (11-07 Sat, mobile-designer r5: "You can buy the Cauldron!" still showed at L60 with 1,387 coins): when one or more
//   pots are affordable it names the priciest of them, so the nudge climbs with the bank. With every pot owned, and coins for
//   GILD_PRICE, it names a pot to gild ({ ..., gild: true }: the worn pot first); a gild it cannot pay for is not shown.
// DECISION: buyBooster('lid') needs the daily unlocked (cur > DAILY_UNLOCK) and lids < LID_MAX; in-level boosters need
//   their unlock level reached (or an earlier gift) and are capped at 99 held.
// DECISION (v2, Wed): the save gains three TOP-LEVEL keys: seen (string flags: 'alldone', UI 'stuck:<id>' callouts, ...),
//   dailyLines ({ key: star-line mask }) and feastTown. Top level on purpose: a v1 build's sanitize keeps unknown top-level
//   keys but rebuilds nested objects from its own defaults, so an old tab open next to a new one cannot erase them.
//   SAVE_V = 2; migrate turns v0 (proto), v1 and version-less saves into v2; merge unions seen/dailyLines, feastTown is a
//   preference (newer ts).
// DECISION: a town chest pays when its chapter is COMPLETE (all 20 levels >= 1 star, GDD §3.12), checked for every town
//   on every level win, so a migrated or merged save that already completed a chapter gets its chest on the next win.

import { PRICES, GILD_PRICE, LID_MAX, BOOST_UNLOCK, BOOST_GIFT, DAILY_UNLOCK, FEAST_UNLOCK, DAILY_START, FEAST, LADDER, SKINS, TOWNS, LEVELS } from './consts.js';

let P = null; // the platform layer, set by initMeta(P)

// ---------- constants ----------
export const SAVE_V = 2;
export const BOOSTS = ['magnet', 'freeze', 'mega'];
export const TOWN_LEVELS = 20;
export const MILESTONE_EVERY = 15, MILESTONE_COINS = 60;
export const MAX_SCORE = LEVELS * 3 * 100 + LEVELS * 10 + 99; // 18,699
export const TUT = { drag: 1, recipe: 2, padlock: 4, stars: 8, pens: 16, rolling: 32, fragile: 64, belt: 128, twocourse: 256, simmer: 512, gulls: 1024, truck: 2048, layered: 4096, freeze: 8192 };
const WIN_A = 10, STAR_PAY = [0, 5, 10, 20], REPLAY_A = 3, DAILY_A = 40, DAILY_B = 10;
// DECISION (11-10, C2): a replay that first reaches 3 stars pays a flat named bonus on top of the star gain, so the
//   replay has a payoff the card can name ("3-star bonus"), not only a bigger number.
const FIRST3_A = 15;
const starPay = (n, st) => Math.round(STAR_PAY[st] * (1 + n / 30));
const SMALL_CHEST = { 1: 30, 5: 40, 10: 50, 15: 60 };
const CHEST_COINS = [150, 150, 300], CHEST_BOOST = 2;
const HELP_MAX = 2; // carryAfterWin(MERCY_MAX) in mercy.js: a win always takes one step off, so 3 never carries
const MAX_COINS = 9999999, MAX_BOOST = 99, DAILY_KEEP = 30, GHOST_MAX = 99, FEAST_MAX = 9999;
const IST_MS = 5.5 * 3600e3, DAY_MS = 86400e3;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIN_IDS = SKINS.map(s => s[0]);
const STAT_KEYS = ['bites', 'bosses', 'plays', 'fails', 'ms', 'bestChain'];
const SEEN_RE = /^[a-z0-9:_.-]{1,32}$/i, SEEN_MAX = 64;
const popcount = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
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
    skins: ['sunny'], wear: 'sunny', gilded: [],
    daily: { won: {}, streak: 0, last: '', ladder: 0, bestStreak: 0, starPot: false, lids: 0, lidCard: false },
    feast: { best: 0, bestBites: 0, plays: 0, ghost: [] },
    giftsClaimed: 0,
    chests: [],
    set: { music: 0.7, sfx: 0.9, haptics: true, stick: null, mute: false },
    tut: 0,
    stats: { bites: 0, bosses: 0, plays: 0, fails: 0, ms: 0, bestChain: 0 },
    seen: [],          // v2: one-time flags ('alldone', 'stuck:<id>', ...)
    dailyLines: {},    // v2: { 'YYYY-MM-DD': mask } star lines met that day (bit0 serve, bit1 line 2, bit2 line 3), last 30
    feastTown: '',     // v2: the Feast town last chosen ('' = the town of the current level)
    help: 0,           // v2: mercy step carried to the next level (mercy.js), 0 to 2. Top level so an older tab keeps it
    calm: 0,           // v2 (11-09): levels left with no first-try cut after a time-out (mercy.js CALM_LEVELS), 0 to 2
  };
}
export const DEFAULT_SAVE = defaults();

/** Normalises any value into a valid v2 save: every key present (deep fill), numbers clamped, unknown keys kept. */
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
  o.gilded = Array.isArray(s.gilded) ? SKIN_IDS.filter(id => s.gilded.includes(id) && o.skins.includes(id)) : [];   // old saves: none; only owned pots
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
  // v2 keys
  if (Array.isArray(s.seen)) o.seen = [...new Set(s.seen.filter(x => typeof x === 'string' && SEEN_RE.test(x)))].slice(-SEEN_MAX);
  if (isObj(s.dailyLines)) {
    for (const k of Object.keys(s.dailyLines).filter(isKey).sort().slice(-DAILY_KEEP)) {
      const m = int(s.dailyLines[k], 0, 7, 0) | 1;
      o.dailyLines[k] = m;
      if (o.daily.won[k] !== undefined) o.daily.won[k] = Math.max(o.daily.won[k], popcount(m)); // stars >= lines met
    }
  }
  o.feastTown = TOWNS.includes(s.feastTown) ? s.feastTown : '';
  o.help = int(s.help, 0, HELP_MAX, 0);
  o.calm = int(s.calm, 0, 2, 0);
  return o;
}

/**
 * P.init calls this only when the stored v < version. Prototype save { v:0, best, lv } -> levels 1..lv-1 beaten with 1 star;
 * v1 (and any other object) -> sanitize, which deep-fills the v2 keys (seen [], dailyLines {}, feastTown '').
 */
export function migrate(old) {
  // DECISION: one path for every older version: v0/version-less proto -> stars; v1 -> sanitize (fills v2 keys, keeps
  //   unknown keys); the result is always stamped SAVE_V. initMeta repeats the sanitize, so a v1 save passed through a
  //   P.init that still says version 1 ends up identical.
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
  m.gilded = SKIN_IDS.filter(id => m.skins.includes(id) && (A.gilded.includes(id) || B.gilded.includes(id)));
  m.chests = TOWNS.filter(t => A.chests.includes(t) || B.chests.includes(t));
  m.giftsClaimed = Math.max(A.giftsClaimed, B.giftsClaimed);
  m.tut = A.tut | B.tut;
  m.seen = [...new Set([...A.seen, ...B.seen])];
  m.dailyLines = {};
  for (const k of new Set([...Object.keys(A.dailyLines), ...Object.keys(B.dailyLines)])) m.dailyLines[k] = (A.dailyLines[k] | 0) | (B.dailyLines[k] | 0);
  for (const k of STAT_KEYS) m.stats[k] = Math.max(A.stats[k], B.stats[k]);
  const won = {};
  for (const k of new Set([...Object.keys(A.daily.won), ...Object.keys(B.daily.won)])) won[k] = Math.max(A.daily.won[k] | 0, B.daily.won[k] | 0);
  m.daily.won = {};
  for (const k of Object.keys(won).sort().slice(-DAILY_KEEP)) m.daily.won[k] = won[k];
  m.daily.bestStreak = Math.max(A.daily.bestStreak, B.daily.bestStreak);
  m.daily.starPot = A.daily.starPot || B.daily.starPot;
  const fb = B.feast.best > A.feast.best || (B.feast.best === A.feast.best && nw === B) ? B.feast : A.feast;
  m.feast = { best: fb.best, bestBites: fb.bestBites, plays: Math.max(A.feast.plays, B.feast.plays), ghost: fb.ghost.slice() };
  // help is not merged: m starts from the newer save, so the last result wins. save() merges with the stored copy on every write, so a
  //   min here would pin help at 0 for good. It is set, never added to, so two tabs can't stack it.
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
  // DECISION (chaos lane 11-05): fold the local copy in at boot too. Facebook loads its server save first, and after a
  //   failed setDataAsync that copy is behind this device; no-op on the web, where the two copies are the same save.
  mergeStored();
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
/** The next chest ahead of the player for the teasers: { n, left } (left = wins to get there), or null. Reads only. */
export function nextChest() {
  const d = D();
  if (!d) return null;
  const at = Object.keys(SMALL_CHEST).map(Number);
  TOWNS.forEach((t, ti) => { if (!d.chests.includes(t)) at.push((ti + 1) * TOWN_LEVELS); });
  const n = Math.min(...at.filter(v => v >= d.cur));
  return Number.isFinite(n) ? { n, left: n - d.cur + 1 } : null;
}
export const qaOldSave = () => ({ save: '{"v":0,"best":120,"lv":3}', progress: 2 });
/** true when all 60 levels have at least one star. */
export const allDone = () => !!D() && D().stars.every(v => v > 0);

// ---------- one-time flags ----------
/**
 * seen(name) -> bool; seen(name, true) marks it and returns true only when it was not set before (so a caller can do
 * `if (meta.seen('stuck:boss', true)) showCallout()`). Names match /^[a-z0-9:_.-]{1,32}$/i; at most 64 are kept.
 */
export function seen(name, set) {
  // DECISION: flags are a de-duplicated string list (union on merge), not more tut bits: UI can add callout ids without
  //   asking Meta for a bit, and an unknown name costs nothing. The 65th name drops the oldest.
  const d = D();
  if (!d || typeof name !== 'string' || !SEEN_RE.test(name)) return false;
  const has = d.seen.includes(name);
  if (!set) return has;
  if (has) return false;
  d.seen.push(name);
  if (d.seen.length > SEEN_MAX) d.seen.splice(0, d.seen.length - SEEN_MAX);
  save();
  return true;
}
/** All 60 done and the All-done screen not shown yet (Core marks it with seen('alldone', true)). */
export const allDoneFresh = () => allDone() && !seen('alldone');

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
export const skins = () => SKINS.map(([id, price]) => ({ id, price, owned: !!D() && D().skins.includes(id), gilded: !!D() && D().gilded.includes(id), worn: !!D() && D().wear === id, buyable: price > 0 }));
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
export const gilded = id => !!D() && D().gilded.includes(id);
/** Gilds an owned pot for GILD_PRICE coins, once per pot. false when unknown, not owned, already gilded or too poor. */
export function buyGild(id) {
  const d = D();
  if (!d || !SKIN_IDS.includes(id) || !d.skins.includes(id) || d.gilded.includes(id) || !spend(GILD_PRICE)) return false;
  d.gilded = SKIN_IDS.filter(x => x === id || d.gilded.includes(x));
  save(true);
  return true;
}
/** Cheapest unowned buyable skin as { id, price, need } when need = price - coins <= within; else null. */
export function nextSkin(within = Infinity) {
  const d = D();
  if (!d) return null;
  const left = SKINS.filter(([id, price]) => price > 0 && !d.skins.includes(id)).sort((a, b) => a[1] - b[1]);
  if (!left.length) {
    const g = [d.wear, ...SKIN_IDS].find(id => d.skins.includes(id) && !d.gilded.includes(id));
    return g && d.coins >= GILD_PRICE ? { id: g, price: GILD_PRICE, need: 0, gild: true } : null;
  }
  const can = left.filter(([, p]) => p <= d.coins);
  const [id, price] = can.length ? can[can.length - 1] : left[0];
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
const townComplete = (d, ti) => { for (let i = 0; i < TOWN_LEVELS; i++) if (!(d.stars[ti * TOWN_LEVELS + i] > 0)) return false; return true; };
/** Pays every complete chapter whose chest is unclaimed (GDD §3.12). Returns [{ town, coins, boost }]. */
function claimChests() {
  const d = D(), out = [];
  TOWNS.forEach((town, ti) => {
    if (d.chests.includes(town) || !townComplete(d, ti)) return;
    d.chests = TOWNS.filter(t => d.chests.includes(t) || t === town);
    const coinsN = CHEST_COINS[ti];
    d.coins = Math.min(MAX_COINS, d.coins + coinsN);
    const boost = {};
    for (const k of BOOSTS) { addBoost(d, k, CHEST_BOOST); boost[k] = CHEST_BOOST; }
    out.push({ town, coins: coinsN, boost });
  });
  return out;
}
/**
 * Records a level win (n = 1..60) and pays it. r = { stars (1..3), tLeft, chainBest }.
 * Returns { coins, newStars, first, first3 (the 3-star replay bonus inside coins, 0 if none), stars, gifts:[{kind:'booster',k,n}], chest:{town,coins,boost}|null (the first one;
 *           `chests` lists all), milestone:{n,coins,boost}|null (the first one; `milestones` lists all), nextSkin,
 *           allDone (true only on the win that completed all 60) }.
 * Everything returned is already credited; flushes the save at once.
 */
export function levelResult(n, r = {}) {
  const d = D();
  n = int(n, 1, LEVELS, 0);
  const none = { coins: 0, newStars: 0, first: false, first3: 0, stars: 0, gifts: [], chest: null, chests: [], milestone: null, milestones: [], nextSkin: null, allDone: false };
  if (!d || !n) return none;
  const st = int(r.stars, 1, 3, 1);
  const wasDone = allDone();
  const prev = d.stars[n - 1] | 0;
  const first = prev === 0;
  const newStars = Math.max(0, st - prev);
  let pay = first ? WIN_A + n + starPay(n, st) : REPLAY_A + starPay(n, Math.max(st, prev)) - starPay(n, prev);
  const first3 = !first && st === 3 && prev < 3 ? FIRST3_A : 0;
  pay += first3;
  if (isFinale(n)) pay *= 2;
  d.stars[n - 1] = Math.max(prev, st);
  d.cur = Math.max(d.cur, Math.min(LEVELS + 1, n + 1));
  d.coins = Math.min(MAX_COINS, d.coins + pay);
  d.stats.bosses = Math.min(1e12, d.stats.bosses + 1);
  d.stats.bestChain = Math.max(d.stats.bestChain, int(r.chainBest, 0, 1e6, 0));
  const gifts = unlockGifts();
  const milestones = claimMilestones();
  const chests = claimChests();
  if (first && SMALL_CHEST[n]) { d.coins = Math.min(MAX_COINS, d.coins + SMALL_CHEST[n]); chests.push({ coins: SMALL_CHEST[n] }); }
  d.cur = Math.min(LEVELS + 1, d.stars.reduce((hi, v, i) => (v > 0 ? i + 1 : hi), 0) + 1);
  save(true);
  reportScore();
  return { coins: pay, newStars, first, first3: isFinale(n) ? first3 * 2 : first3, stars: st, gifts, chest: chests[0] || null, chests, milestone: milestones[0] || null, milestones, nextSkin: nextSkin(100), allDone: !wasDone && allDone() };
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
/** Today's daily state: { key, day, done, stars, mask (lines met today, union of runs, or null), streak, bestStreak, ladder:[7], tomorrow:{day,reward}, msToNext, unlocked, lids, lidCard, starPot }. */
export function dailyStatus(key = dailyKey()) {
  const d = D();
  const now = Date.now();
  if (!d) return { key, day: 1, done: false, stars: 0, mask: null, streak: 0, bestStreak: 0, ladder: [], tomorrow: null, msToNext: msToNext(now), unlocked: false, lids: 0, lidCard: false, starPot: false };
  const done = claimed(d, key);
  const streak = aliveStreak(d, key);
  const todayIdx = done ? (d.daily.ladder + 6) % 7 : streak > 0 ? d.daily.ladder : 0;
  const nextIdx = done ? d.daily.ladder : (todayIdx + 1) % 7;
  const filled = done ? todayIdx + 1 : todayIdx;
  const ladder = LADDER.map((_, i) => ({ day: i + 1, reward: rewardOf(i, d), state: i < filled ? 'done' : i === filled ? (done ? 'next' : 'today') : 'future' }));
  return {
    key, day: todayIdx + 1, done, stars: d.daily.won[key] | 0, mask: d.dailyLines[key] !== undefined ? d.dailyLines[key] : null, streak, bestStreak: Math.max(d.daily.bestStreak, d.daily.streak),
    ladder, tomorrow: { day: nextIdx + 1, reward: rewardOf(nextIdx, d) }, msToNext: msToNext(now),
    unlocked: dailyUnlocked(), lids: d.daily.lids, lidCard: d.daily.lidCard, starPot: d.daily.starPot,
  };
}
/**
 * PURE. Which of the Daily's 3 star lines a run met (GDD §3.12). lines = level.daily.lines from levels.getDaily:
 * [{type:'win'}, {type:'eat',kind,n}|{type:'chain',n}|{type:'big',n}, {type:'left',share}|{type:'noBumps'}|{type:'noBoost'}|
 * {type:'sizzle',n}]. run = { win, eaten:{ kind: n }, chainBest, big, left (share of T left, 0..1), bumps, boosts, sizzles }.
 * Returns { mask (bit i = line i met), stars (= lines met), met:[b, b, b] }.
 */
export function dailyStars(lines, run = {}) {
  // DECISION: nothing counts without the win (stars 0, mask 0); a missing run field counts as not met, except bumps/boosts
  //   which must be explicitly 0 (undefined = unknown = not met), so a caller that forgets to count can never give free stars.
  const L = Array.isArray(lines) ? lines.slice(0, 3) : [{ type: 'win' }];
  const r = isObj(run) ? run : {};
  const n0 = v => (Number.isFinite(+v) ? +v : -1);
  const ok = l => {
    if (!isObj(l)) return false;
    switch (l.type) {
      case 'win': return r.win !== false;
      case 'eat': return isObj(r.eaten) && n0(r.eaten[l.kind]) >= (l.n | 0);
      case 'chain': return n0(r.chainBest) >= (l.n | 0);
      case 'big': return n0(r.big) >= (l.n | 0);
      case 'left': return n0(r.left) >= (+l.share || 0) - 1e-9;
      case 'noBumps': return r.bumps === 0;
      case 'noBoost': return r.boosts === 0;
      case 'sizzle': return n0(r.sizzles) >= (l.n | 0);
      default: return false;
    }
  };
  if (r.win === false) return { mask: 0, stars: 0, met: [false, false, false] };
  const met = [0, 1, 2].map(i => (i === 0 ? true : ok(L[i])));
  const mask = met.reduce((m, b, i) => m | (b ? 1 << i : 0), 0);
  return { mask, stars: popcount(mask), met };
}
const trimKeys = o => { for (const k of Object.keys(o).sort().slice(0, -DAILY_KEEP)) delete o[k]; };
/**
 * Pays a daily win once per IST key: 40 + 10 x stars + the ladder reward. mask (optional) = the star lines met (bit0
 * serve, bit1 line 2, bit2 line 3); when given, stars = popcount(mask | 1). Returns { key, stars, mask, coins (the
 * 40 + 10*stars part), reward (ladder descriptor, its coins credited too), streak, day, total, paid, replay }.
 */
export function dailyResult(key, stars, mask) {
  // DECISION: dailyLines[key] is the UNION of the lines met over the day's runs, and the stamp's stars (daily.won[key])
  //   = max(best run, lines in the union): a replay that meets the missing line completes the receipt (no coins, the day
  //   already paid). Union keeps the merge rule monotone (two tabs can only add ticks).
  const d = D();
  if (!isKey(key)) key = dailyKey();
  const m = Number.isFinite(+mask) && mask !== null && mask !== '' && typeof mask !== 'boolean' ? ((mask | 0) & 7) | 1 : null;
  const s = m !== null ? popcount(m) : int(stars, 1, 3, 1);
  const out = { key, stars: s, mask: m, coins: 0, reward: null, streak: 0, day: 0, total: 0, paid: false, replay: false };
  if (!d) return out;
  out.streak = aliveStreak(d, key);
  if (!dailyUnlocked()) return out;
  const keep = () => {
    if (m !== null) { d.dailyLines[key] = (d.dailyLines[key] | 0) | m; trimKeys(d.dailyLines); }
    d.daily.won[key] = Math.max(d.daily.won[key] | 0, s, m !== null ? popcount(d.dailyLines[key]) : 0);
  };
  if (claimed(d, key)) { // replay for fun: no coins, but a better result is kept
    out.replay = true;
    out.streak = d.daily.streak;
    const before = JSON.stringify([d.daily.won[key], d.dailyLines[key]]);
    if (d.daily.won[key] !== undefined) keep();
    if (JSON.stringify([d.daily.won[key], d.dailyLines[key]]) !== before) save(true);
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
  keep();
  trimKeys(d.daily.won);
  save(true);
  return { ...out, coins: base, reward, streak, day: idx + 1, total: base + (reward.coins || 0), paid: true };
}

// ---------- feast ----------
export const feastBest = () => (D() ? D().feast.best : 0);
export const feastGhost = () => (D() ? D().feast.ghost.slice() : []);
const townOpen = (d, ti) => d.cur > ti * TOWN_LEVELS; // town ti's first level is playable
/**
 * feastTown() -> the Feast town id; feastTown(t) stores t when it is an unlocked town (saved) and returns the town in use.
 */
export function feastTown(t) {
  // DECISION: the default (nothing chosen, or the choice is no longer unlocked after a reset) is the town of the last
  //   beaten level, the same rule game.js used before this API (cur 21 -> picnic until a Market level is beaten).
  const d = D();
  if (!d) return TOWNS[0];
  if (t !== undefined) {
    const ti = TOWNS.indexOf(t);
    if (ti >= 0 && townOpen(d, ti) && d.feastTown !== t) { d.feastTown = t; save(); }
  }
  const fi = TOWNS.indexOf(d.feastTown);
  if (fi >= 0 && townOpen(d, fi)) return d.feastTown;
  return townOf(Math.max(1, Math.min(LEVELS, d.cur - 1)));
}
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
 *   beaten, complete, chest:boolean (claimed) }], stamps:[{key,stars,mask}] (last 14 daily results, newest last), total, milestone }.
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
  const stamps = d ? Object.keys(d.daily.won).sort().slice(-14).map(key => ({ key, stars: d.daily.won[key], mask: d.dailyLines[key] !== undefined ? d.dailyLines[key] : null })) : [];
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
