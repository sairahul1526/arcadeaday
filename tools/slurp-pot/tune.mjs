// Slurp Pot level tuner (GDD §5.3). Levels role.
// Usage: node tools/slurp-pot/tune.mjs [1-10] [--seeds 8] [--runs 30] [--jobs 4] [--confirm 100] [--write]
//        node tools/slurp-pot/tune.mjs --daily 400 [--jobs 6] [--runs 20] [--write]   (Daily T table + bumps)
//        node tools/slurp-pot/tune.mjs --retime 400 [--jobs 3] [--fresh] [--out PATH] [--write] [--partial]  (Daily T re-measure)
//        --recheck: confirm the stored spec first and skip the search when it passes every gate
//        --from B: start the seed bumps at B, for a level whose first bumps an earlier run already screened
// For each level it tries seed bumps (+7919, at most 40) and two margin targets, measures every bot once with the
// timer lifted (T 999), then picks T inside goal.T ± 15 % and the candidate whose predicted §5.3 gates score best.
// The pick is confirmed with verify.mjs (real T, --confirm runs per human bot). --write stores seed, T, margin and
// stats in games/slurp-pot/levels-data.js. Every change is logged to studio/2026-11-04/levels/levels-report.txt.
// DECISION: prediction treats the Sizzle bonus as min(sizzles, 0.10·T) and ignores the bots' last-20 s hurry; the
// confirm run at the real T is what the report and the gates use.
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import * as L from '../../games/slurp-pot/logic.js';
import { SPECS, REC, kindMax } from '../../games/slurp-pot/levels-data.js';
import { STAR3, STAR2, SIZZLE_CAP } from '../../games/slurp-pot/consts.js';
import { writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { BUMPS as OLD_BUMPS, DAILY_T as OLD_T } from '../../games/slurp-pot/dailies-data.js';
import { staticGates, doomGate, verifySpec, bandOf, greedyWindow, casualWindow, rowText, statsFor, writeLevelsData, report, DATA_PATH, computeKindMax, verifyDaily, dailyKeys } from './verify.mjs';

const BIG = 999;
// Score weights per point outside a gate: greedy % window and casual target (--wg / --wc).
const W = { greedy: 2, casual: 1 };
const DAILIES_PATH = fileURLToPath(new URL('../../games/slurp-pot/dailies-data.js', import.meta.url));
const SEED_STEP = 7919, SEED_MAX = 40;

/** One bot run with the timer lifted: { win, t, sz } (sz = Sizzle adds). */
function run(lv, kind, seed, opts, maxT) {
  const r = B.runLevel(lv, kind, seed, { ...opts, maxT });
  const win = r.win;
  return { win, t: r.tUsed, sz: win ? Math.max(0, Math.round(r.tLeft - BIG + r.tUsed)) : 0 };
}
/**
 * Same loop as bots.runLevel, plus a trace every 0.5 s of play: [Sizzle adds so far, near-miss 'close' then?],
 * so predict() can tell what the fail card would say at any T (D32 near-miss share).
 */
function runTrace(lv, kind, seed, maxT) {
  const w = L.createWorld(lv, { mode: 'level' });
  const bot = B.createBot(kind, seed, {});
  const steps = Math.ceil(maxT / L.DT), tr = [];
  let next = 0;
  for (let s = 0; s < steps && !w.result; s++) {
    const inp = B.decide(bot, w, L.DT);
    L.step(w, { x: inp.x, z: inp.z, m: inp.m }, L.DT);
    w.events.length = 0;
    if (w.tStart !== null && w.t - w.tStart >= next) {
      const el = w.t - w.tStart;
      tr.push([Math.max(0, Math.round(w.tLeft - BIG + el)), L.nearMiss(w) === 'close' ? 1 : 0]);
      next += 0.5;
    }
  }
  const win = w.result === 'win';
  const t = w.tStart === null ? 0 : (w._.biteT >= 0 ? w._.biteT : w.t) - w.tStart;
  return { win, t, sz: win ? Math.max(0, Math.round(w.tLeft - BIG + t)) : 0, tr };
}
/** Is this run's fail card 'close' when the timer of length T runs out? */
function closeAt(r, T) {
  if (!r.tr || !r.tr.length) return false;
  let i = Math.min(r.tr.length - 1, Math.floor(T / 0.5));
  // the timer ends at elapsed e where e = T + adds(e): walk forward while the adds push the end later
  for (let k = 0; k < 8; k++) { const e = T + Math.min(r.tr[i][0], SIZZLE_CAP * T), j = Math.min(r.tr.length - 1, Math.floor(e / 0.5)); if (j === i) break; i = j; }
  return r.tr[i][1] === 1;
}
/** Bot sample for a candidate level (timer lifted). */
// DECISION (11-04): the expert sample in the search is xruns (default 8): an expert run costs ~2.5 s on a 60 s level,
// 20× an average run, and the search only ranks candidates; the confirm run measures the expert floor properly.
export function sample(lv, goalT, { runs = 30, noise = 10, xruns = 8 } = {}) {
  const maxT = Math.max(90, goalT * 2.5);
  const S = { greedy: run(lv, 'greedy', 1, {}, maxT), planner: run(lv, 'planner', 1, {}, maxT), noise: [], casual: [], average: [], expert: [] };
  for (let s = 1; s <= noise; s++) S.noise.push(run(lv, 'greedy', 100 + s, { noiseDeg: 3 }, maxT));
  for (const k of ['casual', 'average', 'expert']) for (let s = 1; s <= (k === 'expert' ? xruns : runs); s++) S[k].push(k === 'casual' ? runTrace(lv, k, s, maxT) : run(lv, k, s, {}, maxT));
  return S;
}
const winAt = (r, T, timed) => r.win && (!timed || r.t <= T + Math.min(r.sz, SIZZLE_CAP * T) + 1e-9);
const starsAt = (r, T, timed) => {
  if (!winAt(r, T, timed)) return 0;
  if (!timed) return 3;
  const left = (T + Math.min(r.sz, SIZZLE_CAP * T) - r.t) / T;
  return left >= STAR3 ? 3 : left >= STAR2 ? 2 : 1;
};
const pctOf = (arr, f) => (arr.length ? (100 * arr.filter(f).length) / arr.length : null);
/** Predicted gate numbers at T. */
export function predict(spec, S, T) {
  const timed = spec.timed !== false;
  const p = {
    T, gWin: winAt(S.greedy, T, timed), gPct: timed ? (100 * S.greedy.t) / T : null, noise: pctOf(S.noise, r => winAt(r, T, timed)),
    ratio: S.greedy.win && S.planner.win ? S.planner.t / S.greedy.t : null,
  };
  for (const k of ['casual', 'average', 'expert']) { p[k] = pctOf(S[k], r => winAt(r, T, timed)); p[k + '3'] = pctOf(S[k], r => starsAt(r, T, timed) === 3); }
  const lost = S.casual.filter(r => !winAt(r, T, timed));
  p.near = lost.length ? lost.filter(r => closeAt(r, T)).length / lost.length : null;
  return p;
}
/** Lower is better; 0 = every predicted gate passes. */
export function score(spec, p) {
  const band = bandOf(spec.n), gw = greedyWindow(spec), timed = spec.timed !== false;
  let s = 0;
  const out = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  if (!p.gWin) s += 100;
  s += ((100 - p.noise) / 5) * 4;
  if (gw && timed) s += W.greedy * out(p.gPct, gw[0], gw[1]);
  if (band.plan && timed) s += p.ratio == null ? 30 : 100 * Math.max(0, p.ratio - band.plan);
  if (band.avg3 && timed && p.average3 != null) s += 0.5 * out(p.average3, band.avg3[0], band.avg3[1]);
  if (band.cas3 && timed) s += 0.5 * Math.max(0, p.casual3 - band.cas3);
  const ct = spec.goal && spec.goal.casual, cw = casualWindow(spec);
  if (cw) s += W.casual * out(p.casual, cw[0], cw[1]) + 0.05 * Math.abs(p.casual - ct);
  if (p.average != null) s += 1.5 * Math.max(0, band.avg - p.average);
  if (p.expert != null) s += 2 * Math.max(0, band.exp - p.expert);
  if ((spec.n === 3 || spec.n === 7) && p.near != null && timed) s += 40 * Math.max(0, 0.6 - p.near);
  return s;
}
/** T range: goal.T ± 15 %, integer seconds. */
function tRange(spec) {
  const g = (spec.goal && spec.goal.T) || spec.T;
  if (spec.timed === false) return [spec.T];
  const out = [];
  for (let T = Math.ceil(g * 0.85); T <= Math.floor(g * 1.15); T++) out.push(T);
  return out;
}
/** Candidate knob sets: as-is, the upper half of the margin range (more food, a faster greedy) and the lower half. */
// DECISION (11-04): the lower half [lo, mid] joins the knobs: fixMargin lands near the top of a wide band, and a
// leaner board costs a wandering casual bot more than greedy (casual ran 10–15 points over target on L5–L11).
function knobs(spec) {
  const m = spec.margin, mid = Math.round(((m[0] + m[1]) / 2) * 100) / 100;
  const base = spec.marginBand || m;
  const bm = Math.round(((base[0] + base[1]) / 2) * 100) / 100;
  const ks = [{ margin: base }];
  if (bm !== base[0]) ks.push({ margin: [bm, base[1]] }, { margin: [base[0], bm] });
  return ks.map(k => ({ ...k, mid }));
}
/** Searches one spec. Returns { best, tried: [{ bump, knob, T, score, p }] }. */
// DECISION (11-04): a staged search. The planner and expert bots cost ~2–2.5 s a run, so a candidate first runs
// greedy alone (dropped when no T in goal.T ± 15 % puts it within 3 points of the greedy window), then one planner
// run (dropped when planner/greedy is over the band's ratio + 0.02), then noise + casual (scored with the average /
// expert terms left out); only the best `full` survivors get the average + expert sample. Up to `seeds` seed bumps
// are screened; screening stops once 6 survivors have a partial score under 0.5. If nothing survives, the 3
// candidates closest to the screens go on. Identical layouts (a margin knob that changes nothing) run once.
export function tuneSpec(spec, { seeds = 24, from = 0, runs = 20, noise = 10, xruns = 6, full = 3, log = () => {} } = {}) {
  const base = spec.seed0 != null ? spec.seed0 : spec.seed;
  const band = bandOf(spec.n), gw = greedyWindow(spec), timed = spec.timed !== false, Ts = tRange(spec);
  const goalT = (spec.goal && spec.goal.T) || spec.T, maxT = Math.max(90, goalT * 2.5);
  const out = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const tried = [], pool = [], near = [], seen = new Set();
  const bestT = (cand, S) => { let bt = null; for (const T of Ts) { const p = predict(cand, S, T); const sc = score(cand, p); if (!bt || sc < bt.score) bt = { T, score: sc, p }; } return bt; };
  const stageC = c => {
    for (let s = 1; s <= noise; s++) c.S.noise.push(run(c.lv, 'greedy', 100 + s, { noiseDeg: 3 }, maxT));
    for (let s = 1; s <= runs; s++) c.S.casual.push(runTrace(c.lv, 'casual', s, maxT));
    c.bt = bestT(c.cand, c.S);
  };
  const rowOf = c => ({ bump: c.b, seed: c.cand.seed, margin: c.cand.margin, ...c.bt, g: +c.S.greedy.t.toFixed(1), pl: +c.S.planner.t.toFixed(1) });
  screen: for (let b = from; b < Math.min(seeds, SEED_MAX + 1); b++) {
    for (const kn of knobs(spec)) {
      const cand = { ...spec, seed: (base + SEED_STEP * b) >>> 0, margin: kn.margin };
      const lv = LV.genLevel({ ...cand, T: timed ? BIG : cand.T }, cand.seed);
      const sig = lv.items.length + ':' + lv.items.reduce((q, o) => q + o.x * 3.1 + o.z * 1.7 + o.a, 0).toFixed(3);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const sg = staticGates(lv, cand);
      if (sg.fails.length || !doomGate(lv)) { log(`  L${spec.n} bump ${b} margin ${kn.margin}: static FAIL ${sg.fails.join('; ')}`); continue; }
      const S = { greedy: run(lv, 'greedy', 1, {}, maxT), planner: null, noise: [], casual: [], average: [], expert: [] };
      if (!S.greedy.win) { log(`  L${spec.n} bump ${b} margin ${kn.margin}: greedy loses`); continue; }
      const gMiss = timed && gw ? Math.min(...Ts.map(T => out((100 * S.greedy.t) / T, gw[0], gw[1]))) : 0;
      const c = { b, cand, lv, S, pen: W.greedy * gMiss };
      if (gMiss > 3) { near.push(c); log(`  L${spec.n} bump ${b} margin ${kn.margin}: screen greedy ${S.greedy.t.toFixed(1)}s`); continue; }
      S.planner = run(lv, 'planner', 1, {}, maxT);
      const ratio = S.planner.win ? S.planner.t / S.greedy.t : null;
      if (band.plan && timed) c.pen += ratio == null ? 30 : 100 * Math.max(0, ratio - band.plan);
      if (band.plan && timed && (ratio == null || ratio > band.plan + 0.02)) { near.push(c); log(`  L${spec.n} bump ${b} margin ${kn.margin}: screen planner ratio ${ratio == null ? '-' : ratio.toFixed(2)}`); continue; }
      stageC(c);
      pool.push(c);
      log(`  L${spec.n} bump ${b} margin ${kn.margin}: survivor, partial score ${c.bt.score.toFixed(1)} (T ${c.bt.T}, greedy ${S.greedy.t.toFixed(1)}s, ratio ${ratio == null ? '-' : ratio.toFixed(2)}, casual ${c.bt.p.casual.toFixed(0)})`);
      if (pool.filter(q => q.bt.score < 0.5).length >= 6) break screen;
    }
  }
  if (!pool.length) {
    near.sort((x, y) => x.pen - y.pen);
    for (const c of near.slice(0, 3)) { if (!c.S.planner) c.S.planner = run(c.lv, 'planner', 1, {}, maxT); stageC(c); pool.push(c); }
    log(`  L${spec.n}: no candidate passed the screens; the ${pool.length} closest go on`);
  }
  pool.sort((x, y) => x.bt.score - y.bt.score);
  let best = null;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (i >= full && (!best || best.score === 0 || c.bt.score >= best.score)) break;
    for (let s = 1; s <= runs; s++) c.S.average.push(run(c.lv, 'average', s, {}, maxT));
    for (let s = 1; s <= xruns; s++) c.S.expert.push(run(c.lv, 'expert', s, {}, maxT));
    c.bt = bestT(c.cand, c.S);
    const row = rowOf(c), p = c.bt.p;
    tried.push(row);
    log(`  L${spec.n} bump ${c.b} margin ${c.cand.margin} → T ${row.T} score ${row.score.toFixed(1)} greedy ${row.g}s (${p.gPct == null ? '-' : p.gPct.toFixed(0)}%) planner ${row.pl}s ratio ${p.ratio == null ? '-' : p.ratio.toFixed(2)} noise ${p.noise.toFixed(0)} casual ${p.casual.toFixed(0)} (3★ ${p.casual3.toFixed(0)}, near ${p.near == null ? '-' : p.near.toFixed(2)}) average ${p.average.toFixed(0)} (3★ ${p.average3.toFixed(0)}) expert ${p.expert.toFixed(0)}`);
    if (!best || row.score < best.score) best = row;
  }
  return { best, tried };
}

// ------------------------------------------------------------------ daily (§3.12: T from the offline table)
// DECISION: a daily's T is the smallest whole second (40–120) at which, with the timer lifted, greedy wins, all 20
// ±3° noise seeds win and casual (seeds 1..20, the same seeds verify uses) wins >= DAILY_TARGET %, plus 1 s; it
// must hold for every town the variant can show that day (B and C change town when Market/Harbour unlock). Seed
// bumps 1..8 (dailies-data BUMPS) are tried when the static gates fail or T > 85 s; the lowest T found wins. The
// confirm at the real T adds 3 s (at most 3 times) when casual dips under 80 %.
const VAR_CURS = [[7], [15, 21], [30, 45]];
const DAILY_TARGET = 85, DAILY_TMIN = 40, DAILY_TMAX = 120, DAILY_SOFT = 85;
export function tuneDaily(key, variant, { runs = 20, maxBump = 8 } = {}) {
  let why = '', best = null;
  const confirm = (b, T) => {
    for (let k = 0; k < 4; k++) {
      const fails = [], seen = new Set();
      for (const cur of VAR_CURS[variant]) {
        const v = verifyDaily(key, cur, { runs, bump: b, T });
        if (seen.has(v.town)) continue;
        seen.add(v.town);
        fails.push(...v.fails);
      }
      if (!fails.length) return { key, variant, bump: b, T, ok: true };
      why = fails.join('; ');
      if (k < 3 && fails.every(f => f.startsWith('4 casual') || f.startsWith('1 noise'))) T += 3; else break;
    }
    return null;
  };
  for (let b = 0; b <= maxBump; b++) {
    const towns = new Set();
    let T = 0, ok = true;
    for (const cur of VAR_CURS[variant]) {
      const lv = LV.getDaily(key, cur, { bump: b, T: BIG });
      if (towns.has(lv.town)) continue;
      towns.add(lv.town);
      const v = verifyDaily(key, cur, { bots: false, bump: b, T: BIG });
      if (v.fails.length) { ok = false; why = v.fails.join('; '); break; }
      const maxT = 150;
      const S = { greedy: run(lv, 'greedy', 1, {}, maxT), noise: [], casual: [] };
      for (let s = 1; s <= 20; s++) S.noise.push(run(lv, 'greedy', 100 + s, { noiseDeg: 3 }, maxT));
      for (let s = 1; s <= runs; s++) S.casual.push(run(lv, 'casual', s, {}, maxT));
      let need = 0;
      for (let t = DAILY_TMIN; t <= DAILY_TMAX; t++) {
        if (winAt(S.greedy, t, true) && S.noise.every(r => winAt(r, t, true)) && pctOf(S.casual, r => winAt(r, t, true)) >= DAILY_TARGET) { need = t; break; }
      }
      if (!need) { ok = false; why = `no T <= ${DAILY_TMAX} (greedy ${S.greedy.t.toFixed(1)} s)`; break; }
      T = Math.max(T, need + 1);
    }
    if (!ok) continue;
    if (T <= DAILY_SOFT) { const r = confirm(b, T); if (r) return r; continue; }
    if (!best || T < best.T) best = { b, T };
  }
  if (best) { const r = confirm(best.b, best.T); if (r) return r; }
  return { key, variant, bump: 0, T: 65, ok: false, why };
}
// DECISION (11-04 Wed, daily retime): after a bot change only T should move, so --retime keeps a variant's stored
// bump while its static gates pass and its new T is <= DAILY_SOFT (otherwise it searches bumps 0..8 as tuneDaily
// does, lowest T wins). One lifted sample per (day, variant, town): greedy + 20 ±3° noise seeds + casual seeds
// 1..20 (the seeds verify.mjs uses); T = the smallest whole second (40–120) at which all of them meet the daily
// gates (greedy and every noise seed win, casual >= DAILY_TARGET %) in every town the variant shows, + 1. The
// gate numbers at that T are kept in daily-retime.jsonl; a timed verify.mjs --daily spot check backs them up.
// ~41 runs per town instead of tuneDaily's ~82 (search + timed confirm), so 400 days fit the RAM rule in ~1.5 h.
let RETIME_PATH = fileURLToPath(new URL('../../studio/2026-11-04/levels/daily-retime.jsonl', import.meta.url));
// Variants A/B/C of a day are the same layout unless the archetype uses rollers or belts (6 days in 10), so a
// child measures each distinct layout once (826 layouts for 1466 day-variant-towns at bump 0; chunks are per day).
const mCache = new Map();
const dsig = lv => lv.town + ':' + lv.items.length + ':' + lv.items.reduce((q, o) => q + o.x * 3.1 + o.z * 1.7 + o.a, 0).toFixed(3);
function measureDaily(key, variant, b) {
  const towns = new Map();
  for (const cur of VAR_CURS[variant]) {
    const lv = LV.getDaily(key, cur, { bump: b, T: BIG });
    if (towns.has(lv.town)) continue;
    const ck = key + '|' + dsig(lv);
    let S = mCache.get(ck);
    if (!S) {
      const v = verifyDaily(key, cur, { bots: false, bump: b, T: BIG });
      if (v.fails.length) S = { why: `bump ${b}: ${v.fails.join('; ')}` };
      else {
        const maxT = 150;
        S = { greedy: run(lv, 'greedy', 1, {}, maxT), noise: [], casual: [] };
        if (!S.greedy.win) S.why = `bump ${b}: greedy loses`;
        else {
          for (let s = 1; s <= 20; s++) S.noise.push(run(lv, 'greedy', 100 + s, { noiseDeg: 3 }, maxT));
          for (let s = 1; s <= 20; s++) S.casual.push(run(lv, 'casual', s, {}, maxT));
        }
      }
      mCache.set(ck, S);
    }
    if (S.why) return { ok: false, why: S.why };
    towns.set(lv.town, { cur, arch: lv.arch, S });
  }
  const okAt = t => [...towns.values()].every(({ S }) => winAt(S.greedy, t, true) && S.noise.every(r => winAt(r, t, true)) && pctOf(S.casual, r => winAt(r, t, true)) >= DAILY_TARGET);
  let need = 0;
  for (let t = DAILY_TMIN; t <= DAILY_TMAX; t++) if (okAt(t)) { need = t; break; }
  if (!need) return { ok: false, why: `bump ${b}: no T <= ${DAILY_TMAX}` };
  const T = need + 1;
  const per = [...towns].map(([town, { cur, arch, S }]) => ({ town, cur, arch, g: +S.greedy.t.toFixed(1), gPct: +((100 * S.greedy.t) / T).toFixed(1),
    noise: pctOf(S.noise, r => winAt(r, T, true)), casual: pctOf(S.casual, r => winAt(r, T, true)) }));
  return { ok: true, T, per };
}
export function retimeDaily(key, variant) {
  const old = (OLD_BUMPS[key] && OLD_BUMPS[key][variant]) | 0;
  let best = null, why = '';
  for (const b of [old, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].filter(q => q !== old)]) {
    const m = measureDaily(key, variant, b);
    if (!m.ok) { why = m.why; continue; }
    if (m.T <= DAILY_SOFT) return { key, variant, bump: b, T: m.T, ok: true, per: m.per, oldT: (OLD_T[key] || [])[variant] || 65, oldBump: old };
    if (!best || m.T < best.T) best = { ...m, b };
  }
  if (best) return { key, variant, bump: best.b, T: best.T, ok: true, per: best.per, oldT: (OLD_T[key] || [])[variant] || 65, oldBump: old };
  return { key, variant, bump: old, T: (OLD_T[key] || [])[variant] || 65, ok: false, why, oldBump: old };
}
/** Daily table rows from daily-retime.jsonl (later lines win), over the old table. */
function retimeRows(keys) {
  const got = new Map();
  if (existsSync(RETIME_PATH)) for (const ln of readFileSync(RETIME_PATH, 'utf8').split('\n')) if (ln.trim()) { const r = JSON.parse(ln); got.set(r.key + '|' + r.variant, r); }
  const rows = [];
  for (const key of keys) for (let v = 0; v < 3; v++) {
    const r = got.get(key + '|' + v);
    rows.push(r || { key, variant: v, bump: (OLD_BUMPS[key] && OLD_BUMPS[key][v]) | 0, T: (OLD_T[key] || [])[v] || 65, ok: null });
  }
  return { rows, got };
}
// DECISION (11-04 Wed): --retime is resumable under a wall-clock cap: each child sends every day-variant as it
// finishes, the parent appends it to daily-retime.jsonl at once, and a rerun skips what the file already holds
// (--fresh starts over). --write rewrites dailies-data.js from the file merged over the old table at the end.
async function mainRetime(args, opt) {
  const days = opt('--retime', 400), jobs = opt('--jobs', 3);
  { const i = args.indexOf('--out'); if (i >= 0) RETIME_PATH = args[i + 1]; }
  const keys = dailyKeys(days);
  if (args.includes('--fresh') && existsSync(RETIME_PATH)) writeFileSync(RETIME_PATH, '');
  const { got } = retimeRows(keys);
  const tasks = [];
  for (const key of keys) for (let v = 0; v < 3; v++) if (!got.has(key + '|' + v)) tasks.push([key, v]);
  console.log(`retime: ${tasks.length} day-variants to measure (${keys.length * 3 - tasks.length} already in ${RETIME_PATH})`);
  const chunks = [];
  for (const t of tasks) { const c = chunks[chunks.length - 1]; if (c && c[0][0] === t[0]) c.push(t); else chunks.push([t]); }
  let done = 0, next = 0;
  await new Promise(fin => {
    let live = 0;
    const launch = () => {
      if (next >= chunks.length) { if (!live) fin(); return; }
      const part = chunks[next++];
      live++;
      const cp = fork(fileURLToPath(import.meta.url), ['--rchild', JSON.stringify(part)]);
      cp.on('message', r => { appendFileSync(RETIME_PATH, JSON.stringify(r) + '\n'); if (++done % 60 === 0) console.log(`retime: ${done}/${tasks.length}`); });
      cp.on('exit', () => { live--; launch(); });
    };
    if (!chunks.length) { fin(); return; }
    for (let j = 0; j < Math.min(jobs, chunks.length); j++) launch();
  });
  const { rows, got: g2 } = retimeRows(keys);
  const meas = rows.filter(r => r.ok != null), bad = meas.filter(r => !r.ok);
  const Ts = meas.filter(r => r.ok).map(r => r.T).sort((a, b) => a - b);
  const moved = meas.filter(r => r.ok && r.T !== r.oldT).length, rebump = meas.filter(r => r.ok && r.bump !== r.oldBump).length;
  const log = [`tune.mjs ${args.join(' ')} — daily retime: ${meas.length}/${rows.length} day-variants measured, ${bad.length} failing, ${moved} T changed, ${rebump} re-bumped`];
  if (Ts.length) log.push(`  T range ${Ts[0]}–${Ts[Ts.length - 1]} s, median ${Ts[Ts.length >> 1]} s`);
  for (const r of bad) log.push(`  daily ${r.key} variant ${'ABC'[r.variant]} FAIL: ${r.why}`);
  // --partial writes whatever is measured over the old table. Days run in date order, so a capped retime still fixes the nearest days.
  if (args.includes('--write') && (meas.length === rows.length || args.includes('--partial'))) { writeDailies(rows); log.push(`wrote ${DAILIES_PATH} (${meas.length}/${rows.length} measured)`); }
  else if (args.includes('--write')) log.push(`not written: ${rows.length - meas.length} day-variants still to measure`);
  report(log, true);
  console.log(log.slice(0, 2).concat(bad.slice(0, 5).map(r => `  daily ${r.key} ${'ABC'[r.variant]} FAIL: ${r.why}`)).join('\n'));
}
function writeDailies(res) {
  const bumps = {}, ts = {};
  for (const r of res.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.variant - b.variant))) {
    (ts[r.key] = ts[r.key] || [65, 65, 65])[r.variant] = r.T;
    if (r.bump) (bumps[r.key] = bumps[r.key] || [0, 0, 0])[r.variant] = r.bump;
  }
  const lines = [
    '// Slurp Pot Daily Order data (GDD §3.12). Levels role. Written by tools/slurp-pot/tune.mjs --daily; do not edit by hand.',
    "// BUMPS: per date key 'YYYY-MM-DD', the seed bumps [variantA, variantB, variantC] that tune.mjs found so that",
    '// day\'s level passes its gates (missing = 0). DAILY_T: per date key, T in seconds per variant (missing = 65).',
    'export const BUMPS = {',
    ...Object.keys(bumps).map(k => `  '${k}': [${bumps[k].join(', ')}],`),
    '};',
    'export const DAILY_T = {',
    ...Object.keys(ts).map(k => `  '${k}': [${ts[k].join(', ')}],`),
    '};',
    '',
  ];
  writeFileSync(DAILIES_PATH, lines.join('\n'));
}
async function mainDaily(args, opt) {
  const days = opt('--daily', 400), jobs = opt('--jobs', 6), runs = opt('--runs', 20);
  const keys = dailyKeys(days);
  const tasks = [];
  for (const key of keys) for (let v = 0; v < 3; v++) tasks.push([key, v]);
  const res = [];
  let next = 0;
  const chunk = 12;
  await new Promise(done => {
    let live = 0;
    const launch = () => {
      if (next >= tasks.length) { if (!live) done(); return; }
      const part = tasks.slice(next, next + chunk);
      next += chunk;
      live++;
      const cp = fork(fileURLToPath(import.meta.url), ['--dchild', JSON.stringify(part), '--runs', String(runs)]);
      cp.on('message', m => { res.push(...m); });
      cp.on('exit', () => { live--; if (res.length % 120 < chunk) console.log(`daily: ${res.length}/${tasks.length}`); launch(); });
    };
    for (let j = 0; j < jobs; j++) launch();
  });
  const bad = res.filter(r => !r.ok);
  const log = [`tune.mjs ${args.join(' ')} — daily T table: ${res.length} day-variants, ${bad.length} still failing, ${res.filter(r => r.bump).length} bumped`];
  const Ts = res.filter(r => r.ok).map(r => r.T).sort((a, b) => a - b);
  if (Ts.length) log.push(`  T range ${Ts[0]}–${Ts[Ts.length - 1]} s, median ${Ts[Ts.length >> 1]} s`);
  for (const r of bad) log.push(`  daily ${r.key} variant ${'ABC'[r.variant]} FAIL: ${r.why}`);
  if (args.includes('--write')) { writeDailies(res); log.push(`wrote ${DAILIES_PATH}`); }
  report(log, true);
  console.log(log.slice(0, 3).join('\n'));
}

// ------------------------------------------------------------------ CLI
// DECISION (11-04, RAM/CPU etiquette): each child searches AND confirms its level, then the parent writes
// levels-data.js at once, so a wall-clock-capped run keeps every finished level; a child exits when its parent goes.
// DECISION (11-04 Wed, --recheck): after a bot change the stored spec is confirmed first (same runs as the final
// confirm); when it passes every gate it is kept with fresh stats and the search is skipped (about half the cost
// of a level). When it fails, the search runs and this confirm stands in for the "old spec re-confirm" below.
async function child(n, o) {
  process.on('disconnect', () => process.exit(0));
  const spec = SPECS.find(s => s.n === n);
  const lines = [];
  let v0 = null;
  if (o.recheck && o.confirm) {
    const s0 = JSON.parse(JSON.stringify(spec));
    v0 = verifySpec(s0, { runs: o.confirm, xruns: o.xconfirm });
    s0.stats = statsFor(v0);
    lines.push(`L${n} recheck: ` + rowText(s0, v0));
    if (!v0.fails.length) {
      if (s0.seed0 == null) s0.seed0 = s0.seed;
      if (!s0.marginBand) s0.marginBand = s0.margin.slice();
      lines.push(`L${n}: recheck passes every gate; kept (no search)`);
      return { n, lines, best: { seed: s0.seed, T: s0.T, margin: s0.margin, score: 0 }, spec: { seed0: s0.seed0, marginBand: s0.marginBand, seed: s0.seed, T: s0.T, margin: s0.margin, stats: s0.stats }, row: rowText(s0, v0), fails: [] };
    }
  }
  const r = tuneSpec(spec, { ...o, log: t => lines.push(t) });
  if (!r.best) return { n, lines, best: null };
  const s = JSON.parse(JSON.stringify(spec));
  const old = { seed: s.seed, T: s.T, margin: s.margin };
  if (s.seed0 == null) s.seed0 = s.seed;
  if (!s.marginBand) s.marginBand = s.margin.slice();
  s.seed = r.best.seed; s.T = r.best.T; s.margin = r.best.margin;
  const ch = ['seed', 'T', 'margin'].filter(k => JSON.stringify(old[k]) !== JSON.stringify(s[k])).map(k => `${k} ${JSON.stringify(old[k])} → ${JSON.stringify(s[k])}`);
  lines.push(`L${n} CHANGE: ${ch.length ? ch.join(', ') : 'none'} (predicted score ${r.best.score.toFixed(1)})`);
  let row = null, fails = null;
  let out = s;
  if (o.confirm) {
    const v = verifySpec(s, { runs: o.confirm, xruns: o.xconfirm });
    s.stats = statsFor(v);
    row = rowText(s, v); fails = v.fails;
    lines.push('  confirm: ' + row);
    // DECISION (11-04): a search result that fails its confirm never replaces a spec whose last confirm passed
    // unless the old spec fails too (re-verified now, since the generator or the bots may have moved under it).
    if (fails.length && ((spec.stats && spec.stats.pass) || v0) && ch.length) {
      const o2 = JSON.parse(JSON.stringify(spec)), v2 = v0 || verifySpec(o2, { runs: o.confirm, xruns: o.xconfirm });
      o2.stats = statsFor(v2);
      lines.push('  old spec re-confirm: ' + rowText(o2, v2));
      if (v2.fails.length <= fails.length) { out = o2; if (out.seed0 == null) out.seed0 = out.seed; if (!out.marginBand) out.marginBand = out.margin.slice(); row = rowText(o2, v2); fails = v2.fails; lines.push(`L${n}: kept the old spec`); }
    }
  }
  return { n, lines, best: r.best, spec: { seed0: out.seed0, marginBand: out.marginBand, seed: out.seed, T: out.T, margin: out.margin, stats: out.stats }, row, fails };
}
async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
  const o = { seeds: opt('--seeds', 8), from: opt('--from', 0), runs: opt('--runs', 30), noise: opt('--noise', 10), xruns: opt('--xruns', 8),
    confirm: opt('--confirm', 100), xconfirm: opt('--xconfirm', 50), recheck: args.includes('--recheck') };
  W.greedy = opt('--wg', W.greedy); W.casual = opt('--wc', W.casual);
  const wArgs = ['--wg', String(W.greedy), '--wc', String(W.casual)];
  // a 'disconnect' listener refs the IPC channel, so a child exits explicitly once its message is flushed
  if (args[0] === '--child') { const m = await child(+args[1], o); process.send(m, () => process.exit(0)); return; }
  if (args[0] === '--dchild') { process.on('disconnect', () => process.exit(0)); const m = JSON.parse(args[1]).map(([k, v]) => tuneDaily(k, v, { runs: o.runs === 30 ? 20 : o.runs })); process.send(m, () => process.exit(0)); return; }
  if (args[0] === '--rchild') { process.on('disconnect', () => process.exit(0)); for (const [k, v] of JSON.parse(args[1])) { const r = retimeDaily(k, v); await new Promise(res => process.send(r, res)); } process.exit(0); }
  if (args.includes('--retime')) { await mainRetime(args, (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; }); return; }
  if (args.includes('--daily')) { await mainDaily(args, (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; }); return; }
  // levels: a range '1-10' or a list '3,4,7'
  const sel = args.find(x => /^\d+([-,]\d+)*$/.test(x)) || '1-10';
  const inSel = n => sel.split(',').some(p => { const [a, b] = p.split('-').map(Number); return n >= a && n <= (b || a); });
  const jobs = opt('--jobs', 3), write = args.includes('--write');
  const list = SPECS.filter(s => inSel(s.n)).map(s => s.n);
  const specs = SPECS.map(s => JSON.parse(JSON.stringify(s)));
  report([`tune.mjs ${args.join(' ')} — search: seeds ${o.seeds} × margin knobs, ${o.runs} runs per casual/average bot, ${o.xruns} expert, ${o.noise} noise seeds (timer lifted); confirm ${o.confirm} (${o.xconfirm} expert)`], true);
  // DECISION (11-04): kindMax is recomputed only at the end of a run (it needs every level and 400 dailies); the
  // per-level writes keep the previous kindMax.
  const save = async final => {
    const km = final ? (await computeKindMax({ days: 400, specs })).kindMax : kindMax;
    writeLevelsData(DATA_PATH, specs, REC, km);
    return km;
  };
  const cliArgs = n => ['--child', String(n), ...['--seeds', '--from', '--runs', '--noise', '--xruns', '--confirm', '--xconfirm'].flatMap(k => [k, String(o[k.slice(2)])]), ...wArgs, ...(o.recheck ? ['--recheck'] : [])];
  let next = 0;
  await new Promise(done => {
    let live = 0;
    const launch = () => {
      if (next >= list.length) { if (!live) done(); return; }
      const n = list[next++];
      live++;
      const cp = fork(fileURLToPath(import.meta.url), cliArgs(n));
      cp.on('message', async m => {
        const s = specs.find(q => q.n === m.n), log = m.lines.slice();
        if (!m.best) log.push(`L${m.n}: no candidate passes the static gates; unchanged`);
        else { Object.assign(s, m.spec); if (write) { await save(false); log.push(`  wrote ${DATA_PATH} (L${m.n})`); } }
        report(log, true);
        console.log(m.row || `L${m.n}: ${m.best ? 'searched, best score ' + m.best.score.toFixed(1) : 'no candidate'}`);
      });
      cp.on('exit', () => { live--; launch(); });
    };
    for (let j = 0; j < jobs; j++) launch();
  });
  if (write) { const km = await save(true); report([`wrote ${DATA_PATH} (kindMax ${Object.keys(km).length} kinds)`], true); }
  console.log('log appended to studio/2026-11-04/levels/levels-report.txt');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
