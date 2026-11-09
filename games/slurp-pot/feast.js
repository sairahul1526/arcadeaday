// Slurp Pot Feast mode (GDD §3.12, D23, §13.3). Sim role.
// Pure and deterministic like logic.js: no Math.random, no Date, no DOM, no three. Course maps come from
// levels.js (feastCourse when Levels exports it, else genLevel with the spec built here); the course
// roll-over and the spawner write the same world in place through logic.loadCourse / logic.spawnItem.
//
// Contract (studio/2026-11-04/sim/notes.txt):
//   fs = createFeast(town, seed, { cur }); lvl = feastLevel(fs); w = logic.createWorld(lvl, { mode: 'feast' })
//   every step: logic.step(w, inp, DT); feastStep(fs, w, DT)
//   events (pushed into w.events): feastTicket {k, n, t, add}, feastWipe {c}, feastCourse {c, level}, spawn {i, kind}
//   the run ends with logic's fail {why: 'timeout'}; feastResult(fs) -> { tickets, times, bites, chainBest, courses }
//
// DECISION: a course is one generated map with ONE spec ticket holding all 8 lines (genLevel places every line's
// ingredients and the mini boss); feast.js then splits it into 4 tickets of 2 lines, tickets 1-3 without a boss
// and ticket 4 with the mini boss. Ingredient kinds are 8 distinct town ingredients sorted by size, so ticket 1
// asks for the smallest and ticket 4 for the largest (the pea-to-giant montage on every course).
import { FEAST, R0, ITEM_MAX } from './consts.js';
import * as L from './logic.js';
import * as LV from './levels.js';
import { kindsForTown, F } from './catalog.js';
import * as B from './bots.js';

const WIPE = 0.6, SWAP_AT = 0.3, REUSE_AFTER = 1.0;
const BOSS_A0 = 1.4, BOSS_A_STEP = 0.15, BOSS_A_MAX = 2.0;
const ROLLERS = { picnic: 'apple', market: 'orange', harbour: 'coconut' };
const NO_SPAWN = F.BOSS | F.WALL | F.GATE | F.ROLL | F.BELT | F.STACK | F.FRAGILE;

/** Seconds a finished ticket adds on course c (D23): 14 s for c <= 4, then -1 s per course, floor 6 s. */
export function addOf(c) { return c <= 4 ? FEAST.add0 : Math.max(FEAST.addMin, FEAST.add0 - (c - 4)); }

/** Need range of course c: [2, 3] for c <= 4, then [2 + (c - 4), 3 + (c - 4)] capped at FEAST.needMax. */
export function needRange(c) {
  const up = c <= 4 ? 0 : c - 4;
  return [Math.min(FEAST.needMax, 2 + up), Math.min(FEAST.needMax, 3 + up)];
}

/** Which twists course c uses (§3.12): pens from c2, rolling from c3 (L10 beaten), belts from c4 (L22 beaten). */
export function twistsOf(c, cur) {
  const roll = cur > 10, belt = cur > 22;
  if (c <= 1) return { pens: 0, roll: false, belt: false };
  if (c === 2) return { pens: 1, roll: false, belt: false };
  if (c === 3) return roll ? { pens: 1, roll: true, belt: false } : { pens: 2, roll: false, belt: false };
  return { pens: roll ? 1 : 2, roll, belt };
}

/**
 * Feast run state. DECISION: seed is any integer (game.js passes a fresh one per run, the same one on Restart);
 * cur = the player's current level (decides rolling / belts); town defaults to picnic if unknown.
 */
export function createFeast(town, seed, opt = {}) {
  const t = ['picnic', 'market', 'harbour'].indexOf(town) >= 0 ? town : 'picnic';
  const fs = {
    town: t, seed: seed >>> 0, cur: opt.cur | 0 || 1, course: 1, served: 0, inCourse: 0, times: [], tStart: null,
    level: null, w: null, lastTi: 0, wipe: -1, swapped: false, goneAt: new Float64Array(ITEM_MAX).fill(-1),
    tmpl: null, rng: LV.mulberry32((seed >>> 0) ^ 0x9e3779b9), started: false, courses: 0, spawns: 0,
    fitK: opt.fitK ?? 0, reuse: opt.reuse ?? REUSE_AFTER,
  };
  fs.level = courseLevel(fs, 1);
  return fs;
}

/** The current course map (an expanded level for logic.createWorld / render3d.loadLevel). */
export function feastLevel(fs) { return fs.level; }

/** Ticket k (0..3) of the current course: { lines: [{kind, need, place}], boss }. */
export function feastTicket(fs, k) { return fs.level.tickets[k] || null; }

// DECISION: course c's map = levels.feastCourse(c, town, seed, {cur}) when Levels exports it (Feast archetype);
// otherwise this fallback spec (board 22 x 32-34, 185 items, Daily mix, margin 1.9-2.3) through genLevel.
// Either way a single-ticket result is split into 4 tickets of 2 lines (normTickets).
function courseLevel(fs, c) {
  const seed = (fs.seed + c * 7919) >>> 0;
  let lvl = null;
  if (typeof LV.feastCourse === 'function') {
    try { lvl = LV.feastCourse(c, fs.town, seed, { cur: fs.cur }); } catch (e) { lvl = null; }
  }
  if (!lvl || !lvl.items || !lvl.tickets) lvl = LV.genLevel(courseSpec(fs, c, seed), seed);
  lvl = Object.assign({}, lvl);
  lvl.name = lvl.name || 'Feast';
  lvl.feast = { c };
  lvl.T = FEAST.start; lvl.timed = true;
  lvl.tickets = normTickets(lvl.tickets);
  fs.tmpl = templates(lvl);
  return lvl;
}

// DECISION (fallback spec): 8 distinct town ingredients (two random ones dropped, the roller kept when rolling is
// on), sorted by a; ticket k takes pair k. Pen line = ticket 3 line 1 (and ticket 4 line 1 for a second pen),
// roll line = the roller's own line, belt line = ticket 2 line 2. Archetype: c1 BP, pens only PG, rolling HL.
// Mini boss a = 1.4 + 0.15 (c - 1), max 2.0, kind cycled from the town's plain bosses.
function courseSpec(fs, c, seed) {
  const rng = LV.mulberry32(seed ^ 0x51ed27);
  const town = fs.town, tw = twistsOf(c, fs.cur), roller = ROLLERS[town];
  const ks = kindsForTown(town);
  let ings = ks.filter(k => k.ing).map(k => k.id);
  while (ings.length > 8) {
    const j = Math.floor(rng() * ings.length);
    if (tw.roll && ings[j] === roller) continue;
    ings.splice(j, 1);
  }
  const A = {}; for (const k of ks) A[k.id] = k.a;
  ings.sort((p, q) => A[p] - A[q] || (p < q ? -1 : 1));
  const [lo, hi] = needRange(c);
  const lines = ings.map(kind => ({ kind, need: lo + Math.floor(rng() * (hi - lo + 1)) }));
  if (tw.roll) { const li = lines.findIndex(l => l.kind === roller); if (li >= 0) lines[li].place = 'roll'; }
  const free = k => lines[k] && !lines[k].place;
  if (tw.pens >= 1) { if (free(4)) lines[4].place = 'pen'; else if (free(5)) lines[5].place = 'pen'; }
  if (tw.pens >= 2) { if (free(6)) lines[6].place = 'pen'; else if (free(7)) lines[7].place = 'pen'; }
  if (tw.belt) { if (free(3)) lines[3].place = 'belt'; else if (free(2)) lines[2].place = 'belt'; }
  const bosses = ks.filter(k => k.boss && !/cake|truck|lighthouse|oven|van|boat/.test(k.id)).map(k => k.id);
  const bkind = bosses.length ? bosses[(c - 1 + Math.floor(rng() * bosses.length)) % bosses.length] : 'boss-table';
  const bossA = Math.min(BOSS_A_MAX, BOSS_A0 + BOSS_A_STEP * (c - 1));
  const arch = c <= 1 ? 'BP' : tw.roll ? 'HL' : 'PG';
  const twist = {};
  if (arch === 'PG') twist.pens = Math.max(1, tw.pens);
  if (arch === 'HL') twist.lanes = 2;
  if (tw.belt) twist.belts = 1;
  const D = 32 + 2 * Math.floor(rng() * 2);
  return {
    n: 0, name: 'Feast', town, arch, W: 22, D, seed, r0: R0, T: FEAST.start, items: 185, mix: [34, 30, 18, 14, 4],
    margin: [1.9, 2.3], tickets: [{ lines: lines.map(l => (l.place ? l : { kind: l.kind, need: l.need })), boss: { kind: bkind, a: bossA } }],
    twist,
  };
}

// DECISION: tickets already split (feastCourse may do it) pass through; one ticket with > 2 lines becomes
// ceil(lines / 2) tickets of 2 lines in order, and only the last keeps the boss (boss -1 = no boss: logic
// serves it the moment its lines are done).
function normTickets(tks) {
  if (!tks || tks.length !== 1 || tks[0].lines.length <= 2) return tks;
  const t0 = tks[0], out = [];
  for (let k = 0; k < t0.lines.length; k += 2) out.push({ lines: t0.lines.slice(k, k + 2), boss: -1 });
  out[out.length - 1].boss = t0.boss;
  return out;
}

// Spawner templates: the course's own plain items (its growth curve and its legal spots).
function templates(lvl) {
  const all = [], byKind = {};
  lvl.items.forEach((it, i) => {
    if (it.flags & NO_SPAWN || (it.lane != null && it.lane >= 0) || (it.belt != null && it.belt >= 0)) return;
    const t = { kind: it.kind, ki: it.ki, x: it.x, z: it.z, a: it.a, h: it.h, k: it.k, flags: it.flags & (F.ING | F.WALL), zone: it.zone | 0, i };
    if (!(it.zone > 0) && !(it.flags & F.ING)) all.push(t);
    (byKind[it.kind] || (byKind[it.kind] = [])).push(t);
  });
  return { all, byKind };
}

/**
 * Per-step Feast rules after logic.step: served tickets bank time, the course wipe + in-place roll-over, the
 * slot spawner. DECISION: the sizzle cap is w._.sizzleCap = w.sizzle + 3 at the start of every ticket.
 */
export function feastStep(fs, w, dt) {
  const _ = w._, ev = w.events;
  fs.w = w;
  if (!fs.started) { fs.started = true; _.sizzleCap = w.sizzle + FEAST.sizzleCap; fs.lastTi = w.ti; }
  if (fs.tStart === null && w.tStart !== null) fs.tStart = w.tStart;
  if (w.result) return;
  // wipe in progress (logic holds the sim while w._.hold > 0)
  if (fs.wipe >= 0) {
    fs.wipe += dt;
    if (!fs.swapped && fs.wipe >= SWAP_AT - 1e-9) {
      fs.swapped = true;
      fs.course++; fs.courses++; fs.inCourse = 0;
      fs.level = courseLevel(fs, fs.course);
      L.loadCourse(w, fs.level);
      fs.lastTi = 0; fs.goneAt.fill(-1);
      w.events.push({ type: 'feastCourse', c: fs.course, level: fs.level });
    }
    if (fs.wipe >= WIPE - 1e-9) fs.wipe = -1;
    return;
  }
  // served tickets: ti advanced (course event) or the course's last ticket ended
  while (fs.lastTi < w.ti) { fs.lastTi++; served(fs, w); }
  if (_.courseEnd && !fs.swapped) {
    served(fs, w);
    fs.wipe = 0; _.hold = WIPE;
    ev.push({ type: 'feastWipe', c: fs.course });
    return;
  }
  fs.swapped = false;
  spawner(fs, w);
}

function served(fs, w) {
  const add = addOf(fs.course), t = fs.tStart === null ? 0 : w.t - fs.tStart;
  fs.served++; fs.inCourse++;
  if (fs.times.length < 99) fs.times.push(Math.round(t * 100) / 100);
  w.tLeft += add;
  w._.sizzleCap = w.sizzle + FEAST.sizzleCap;
  w.events.push({ type: 'feastTicket', k: fs.inCourse - 1, n: fs.served, t, add });
}

// DECISION (spawner, §3.12): a slot gone (st 2) for >= 1 s is reused, at most one per step. First the current
// ticket's ingredient shortfall (alive + tipping < still needed) from that kind's own spots, else a plain item
// sampled uniformly from the course's own templates, i.e. its growth curve (§3.12). DECISION (Wed): Tuesday's
// filter "only items that fit within 1.3 r" fed the pot a stream of edible food and let the expert serve a
// median 25 tickets (414 s runs; target 14–20); the plain course mix gives 21. fs.fitK > 0 restores the filter.
// Spot = a template's spot at distance >= 1.2 VIEW_R(r) from the pot that no alive item overlaps (else the
// farthest clear one tried).
function spawner(fs, w) {
  const st = w.st, n = w.n, goneAt = fs.goneAt, t = w.t;
  let slot = -1;
  for (let i = 0; i < n; i++) {
    if (st[i] === 2) {
      if (goneAt[i] < 0) goneAt[i] = t;
      else if (slot < 0 && t - goneAt[i] >= fs.reuse - 1e-9 && w._.mover[i] === 0 && w._.bossT[i] < 0) slot = i;
    } else goneAt[i] = -1;
  }
  if (slot < 0) return;
  const T = fs.tmpl, r = w.pot.r;
  let pool = null;
  const tk = w.tickets[w.ti];
  if (tk) for (const l of tk.lines) {
    if (l.got >= l.need || !T.byKind[l.kind]) continue;
    let alive = 0;
    for (let i = 0; i < n; i++) if ((st[i] === 0 || st[i] === 1) && w.kindNames[w.kind[i]] === l.kind) alive++;
    if (alive < l.need - l.got) { pool = T.byKind[l.kind]; break; }
  }
  let cand = pool;
  if (!cand) {
    const fit = fs.fitK > 0 ? T.all.filter(o => L.canFit(fs.fitK * r, o.a)) : T.all;
    cand = fit.length ? fit : T.all;
  }
  if (!cand || !cand.length) return;
  const tm = cand[Math.floor(fs.rng() * cand.length)];
  const spots = pool || T.all;
  const dMin = 1.2 * L.VIEW_R(r), px = w.pot.x, pz = w.pot.z;
  let best = null, bestD = -1;
  for (let k = 0; k < 10; k++) {
    const s = spots[Math.floor(fs.rng() * spots.length)];
    const dx = s.x - px, dz = s.z - pz, d = Math.sqrt(dx * dx + dz * dz);
    if (d < r + tm.a + 1 || !clear(w, s.x, s.z, tm.a)) continue;
    if (d >= dMin) { best = s; break; }
    if (d > bestD) { bestD = d; best = s; }
  }
  if (!best) return;
  if (L.spawnItem(w, slot, { kind: tm.kind, ki: tm.ki, x: best.x, z: best.z, a: tm.a, h: tm.h, k: tm.k, flags: tm.flags })) {
    goneAt[slot] = -1; fs.spawns++;
  }
}

function clear(w, x, z, a) {
  const st = w.st, ix = w.ix, iz = w.iz, A = w._.a;
  for (let i = 0; i < w.n; i++) {
    if (st[i] === 2 || st[i] === 5) continue;
    const dx = ix[i] - x, dz = iz[i] - z, m = A[i] + a + 0.05;
    if (dx * dx + dz * dz < m * m) return false;
  }
  return true;
}

/** End-of-run summary for meta.feastResult and the Feast end card. */
export function feastResult(fs) {
  const w = fs.w;
  const chainBest = w ? Math.max(w.chain.best, w.chain.g | 0) : 0;
  return { tickets: fs.served, times: fs.times.slice(0, 99), bites: w ? w.stats.bites : 0, chainBest, courses: fs.course };
}

/**
 * Headless Feast run for the sweep (§3.12 "expert median 14–20 tickets, casual median 5–9") and tools.
 * DECISION: maxT caps game time (default 900 s, far beyond any banked run); returns
 * { tickets, tEnd (game seconds from the first input to the end), courses, times, why }.
 */
export function runFeast(town, kind = 'expert', seed = 1, { cur = 30, maxT = 900, fitK, reuse } = {}) {
  const fs = createFeast(town, seed, { cur, fitK, reuse });
  const w = L.createWorld(feastLevel(fs), { mode: 'feast' });
  const bot = B.createBot(kind, seed);
  const steps = Math.ceil(maxT / L.DT);
  for (let s = 0; s < steps && !w.result; s++) {
    L.step(w, B.decide(bot, w, L.DT), L.DT);
    feastStep(fs, w, L.DT);
    w.events.length = 0;
  }
  return { tickets: fs.served, tEnd: w.tStart === null ? 0 : w.t - w.tStart, courses: fs.course, times: fs.times.slice(), why: w.result || 'maxT' };
}
