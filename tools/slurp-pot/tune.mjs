// Slurp Pot level tuner (GDD §5.3). Levels role.
// Usage: node tools/slurp-pot/tune.mjs [1-10] [--seeds 8] [--runs 30] [--jobs 4] [--confirm 100] [--write]
//        node tools/slurp-pot/tune.mjs --daily 400 [--jobs 6] [--runs 20] [--write]   (Daily T table + bumps)
// For each level it tries seed bumps (+7919, at most 40) and two margin targets, measures every bot once with the
// timer lifted (T 999), then picks T inside goal.T ± 15 % and the candidate whose predicted §5.3 gates score best.
// The pick is confirmed with verify.mjs (real T, --confirm runs per human bot). --write stores seed, T, margin and
// stats in games/slurp-pot/levels-data.js. Every change is logged to studio/2026-11-03/levels/levels-report.txt.
// DECISION: prediction treats the Sizzle bonus as min(sizzles, 0.10·T) and ignores the bots' last-20 s hurry; the
// confirm run at the real T is what the report and the gates use.
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import * as L from '../../games/slurp-pot/logic.js';
import { SPECS, REC, kindMax } from '../../games/slurp-pot/levels-data.js';
import { STAR3, STAR2, SIZZLE_CAP } from '../../games/slurp-pot/consts.js';
import { writeFileSync } from 'node:fs';
import { staticGates, doomGate, verifySpec, bandOf, greedyWindow, rowText, statsFor, writeLevelsData, report, DATA_PATH, computeKindMax, verifyDaily, dailyKeys } from './verify.mjs';

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
export function sample(lv, goalT, { runs = 30, noise = 10 } = {}) {
  const maxT = Math.max(90, goalT * 2.5);
  const S = { greedy: run(lv, 'greedy', 1, {}, maxT), planner: run(lv, 'planner', 1, {}, maxT), noise: [], casual: [], average: [], expert: [] };
  for (let s = 1; s <= noise; s++) S.noise.push(run(lv, 'greedy', 100 + s, { noiseDeg: 3 }, maxT));
  for (const k of ['casual', 'average', 'expert']) for (let s = 1; s <= runs; s++) S[k].push(k === 'casual' ? runTrace(lv, k, s, maxT) : run(lv, k, s, {}, maxT));
  return S;
}
const winAt = (r, T, timed) => r.win && (!timed || r.t <= T + Math.min(r.sz, SIZZLE_CAP * T) + 1e-9);
const starsAt = (r, T, timed) => {
  if (!winAt(r, T, timed)) return 0;
  if (!timed) return 3;
  const left = (T + Math.min(r.sz, SIZZLE_CAP * T) - r.t) / T;
  return left >= STAR3 ? 3 : left >= STAR2 ? 2 : 1;
};
const pctOf = (arr, f) => (100 * arr.filter(f).length) / arr.length;
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
  if (band.avg3 && timed) s += 0.5 * out(p.average3, band.avg3[0], band.avg3[1]);
  if (band.cas3 && timed) s += 0.5 * Math.max(0, p.casual3 - band.cas3);
  const ct = spec.goal && spec.goal.casual;
  if (ct != null) { const d = Math.abs(p.casual - ct); s += W.casual * Math.max(0, d - 7) + 0.05 * d; }
  s += 1.5 * Math.max(0, band.avg - p.average) + 2 * Math.max(0, band.exp - p.expert);
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
/** Candidate knob sets: as-is, and the upper half of the margin range (more food, a faster greedy). */
function knobs(spec) {
  const m = spec.margin, mid = Math.round(((m[0] + m[1]) / 2) * 100) / 100;
  const base = spec.marginBand || m;
  const ks = [{ margin: base }];
  const hi = [Math.round(((base[0] + base[1]) / 2) * 100) / 100, base[1]];
  if (hi[0] !== base[0]) ks.push({ margin: hi });
  return ks.map(k => ({ ...k, mid }));
}
/** Searches one spec. Returns { best, tried: [{ bump, knob, T, score, p }] }. */
export function tuneSpec(spec, { seeds = 8, runs = 30, noise = 10, log = () => {} } = {}) {
  const base = spec.seed0 != null ? spec.seed0 : spec.seed;
  const tried = [];
  let best = null;
  for (let b = 0; b < Math.min(seeds, SEED_MAX + 1); b++) {
    for (const kn of knobs(spec)) {
      const cand = { ...spec, seed: (base + SEED_STEP * b) >>> 0, margin: kn.margin };
      const lv = LV.genLevel({ ...cand, T: spec.timed === false ? cand.T : BIG }, cand.seed);
      const sg = staticGates(lv, cand);
      if (sg.fails.length || !doomGate(lv)) { log(`  L${spec.n} bump ${b} margin ${kn.margin}: static FAIL ${sg.fails.join('; ')}`); continue; }
      const S = sample(lv, (spec.goal && spec.goal.T) || spec.T, { runs, noise });
      let bt = null;
      for (const T of tRange(spec)) { const p = predict(cand, S, T); const sc = score(cand, p); if (!bt || sc < bt.score) bt = { T, score: sc, p }; }
      const row = { bump: b, seed: cand.seed, margin: kn.margin, ...bt, g: +S.greedy.t.toFixed(1), pl: +S.planner.t.toFixed(1) };
      tried.push(row);
      log(`  L${spec.n} bump ${b} margin ${kn.margin} → T ${bt.T} score ${bt.score.toFixed(1)} greedy ${row.g}s (${bt.p.gPct == null ? '-' : bt.p.gPct.toFixed(0)}%) planner ${row.pl}s ratio ${bt.p.ratio == null ? '-' : bt.p.ratio.toFixed(2)} noise ${bt.p.noise.toFixed(0)} casual ${bt.p.casual.toFixed(0)} (3★ ${bt.p.casual3.toFixed(0)}, near ${bt.p.near == null ? '-' : bt.p.near.toFixed(2)}) average ${bt.p.average.toFixed(0)} (3★ ${bt.p.average3.toFixed(0)}) expert ${bt.p.expert.toFixed(0)}`);
      if (!best || bt.score < best.score) best = row;
      if (best.score === 0) break;
    }
    if (best && best.score === 0) break;
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
async function child(n, o) {
  const spec = SPECS.find(s => s.n === n);
  const lines = [];
  const r = tuneSpec(spec, { ...o, log: t => lines.push(t) });
  return { n, lines, best: r.best };
}
async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
  const o = { seeds: opt('--seeds', 8), runs: opt('--runs', 30), noise: opt('--noise', 10) };
  W.greedy = opt('--wg', W.greedy); W.casual = opt('--wc', W.casual);
  const wArgs = ['--wg', String(W.greedy), '--wc', String(W.casual)];
  if (args[0] === '--child') { process.send(await child(+args[1], o)); return; }
  if (args[0] === '--dchild') { process.send(JSON.parse(args[1]).map(([k, v]) => tuneDaily(k, v, { runs: o.runs === 30 ? 20 : o.runs }))); return; }
  if (args.includes('--daily')) { await mainDaily(args, (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; }); return; }
  // levels: a range '1-10' or a list '3,4,7'
  const sel = args.find(x => /^\d+([-,]\d+)*$/.test(x)) || '1-10';
  const inSel = n => sel.split(',').some(p => { const [a, b] = p.split('-').map(Number); return n >= a && n <= (b || a); });
  const jobs = opt('--jobs', 4), confirm = opt('--confirm', 100), write = args.includes('--write');
  const list = SPECS.filter(s => inSel(s.n)).map(s => s.n);
  const results = {};
  const log = [`tune.mjs ${args.join(' ')} — search: seeds ${o.seeds} × margin knobs, ${o.runs} runs per human bot, ${o.noise} noise seeds (timer lifted)`];
  let next = 0;
  await new Promise(done => {
    let live = 0;
    const launch = () => {
      if (next >= list.length) { if (!live) done(); return; }
      const n = list[next++];
      live++;
      const cp = fork(fileURLToPath(import.meta.url), ['--child', String(n), '--seeds', String(o.seeds), '--runs', String(o.runs), '--noise', String(o.noise), ...wArgs]);
      cp.on('message', m => { results[m.n] = m; console.log(`L${m.n} searched: best bump ${m.best && m.best.bump} T ${m.best && m.best.T} score ${m.best && m.best.score.toFixed(1)}`); });
      cp.on('exit', () => { live--; launch(); });
    };
    for (let j = 0; j < jobs; j++) launch();
  });
  const specs = SPECS.map(s => JSON.parse(JSON.stringify(s)));
  for (const n of list) {
    const r = results[n];
    if (!r) { log.push(`L${n}: search crashed`); continue; }
    log.push(...r.lines);
    const s = specs.find(q => q.n === n);
    if (!r.best) { log.push(`L${n}: no candidate passes the static gates; unchanged`); continue; }
    const old = { seed: s.seed, T: s.T, margin: s.margin };
    if (s.seed0 == null) s.seed0 = s.seed;
    if (!s.marginBand) s.marginBand = s.margin.slice();
    s.seed = r.best.seed; s.T = r.best.T; s.margin = r.best.margin;
    const ch = ['seed', 'T', 'margin'].filter(k => JSON.stringify(old[k]) !== JSON.stringify(s[k])).map(k => `${k} ${JSON.stringify(old[k])} → ${JSON.stringify(s[k])}`);
    log.push(`L${n} CHANGE: ${ch.length ? ch.join(', ') : 'none'} (predicted score ${r.best.score.toFixed(1)})`);
    if (confirm) {
      const v = verifySpec(s, { runs: confirm });
      s.stats = statsFor(v);
      log.push('  confirm: ' + rowText(s, v));
      console.log(rowText(s, v));
    }
  }
  if (write) {
    const km = (await computeKindMax({ days: 400, specs })).kindMax;
    writeLevelsData(DATA_PATH, specs, REC, km);
    log.push(`wrote ${DATA_PATH} (seed, T, margin, stats; kindMax ${Object.keys(km).length} kinds)`);
  }
  report(log, true);
  console.log('log appended to studio/2026-11-03/levels/levels-report.txt');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
