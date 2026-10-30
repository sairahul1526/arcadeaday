// Knot Kitty difficulty v3 tuner (polish round). Run from the repo root:
//   node tools/knot-kitty/tune3.mjs probe 20 [secs]        spread of bot rates over re-dressings of L20
//   node tools/knot-kitty/tune3.mjs run 4,5,6 [secs]        tune levels into studio/2026-10-16/polish/parts-v3/
//   node tools/knot-kitty/tune3.mjs daily 0/6 [secs]        tune a slice of the 60 daily boards
//   node tools/knot-kitty/tune3.mjs merge                   write levels-data.js / dailies-data.js from parts-v3
//   node tools/knot-kitty/tune3.mjs table                   re-measure everything (1000 runs) -> polish/levels-v3.md
//
// DECISION (v3): the existing geometry of every level is kept (same pegs, bows, strand count, crossings), so
//   readability at 320x480 and the 18-strand boss silhouettes are untouched. Only the dressing changes, with the
//   levers the design already has: basket size (cap) / par, strand layering (depth), colour distribution and
//   spool order (queue jitter). gen.mjs tryLevel() does the dressing, so every twist / palette / teach gate holds.
// DECISION (v3): the tuning target is the random-legal-tap win rate (rules.js botRun 'random'), on a per-level
//   sawtooth (AIM3). Hard gates: exact solve, expert bot 100 % on the screen runs, greedy ('average') bot above a
//   per-level floor (a sensible player still wins most mid levels). 'tap' is a second random bot: it taps a
//   uniformly random strand that is on top (strand-weighted, so a knot pair is twice as likely), and a refused tap
//   (basket full, lock, paw) is simply tapped again, as in the game; it is reported next to 'random'.
process.argv.push('--lib');
const G = await import('./gen.mjs');
const R = await import('../../games/knot-kitty/rules.js');
const { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, renameSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GAME = join(ROOT, 'games', 'knot-kitty');
const POL = join(ROOT, 'studio', '2026-10-16', 'polish');
const PARTS = process.env.KK3_PARTS || join(POL, 'parts-v3');
const LEVELS = (await import('../../games/knot-kitty/levels-data.js')).default;
const DAILIES = (await import('../../games/knot-kitty/dailies-data.js')).default;
// base geometry: the shipped levels (v2 / fix2), kept as-is
const baseOf = id => (id >= 1000 ? DAILIES[id - 1000] : LEVELS[id - 1]);

// ------------------------------------------------------------------ targets
// Mini-boss knots every 5th level from L8 (L8, L13, ... L58); big bosses every 10th.
export const MINI = new Set([8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58]);
export const BOSS = new Set([10, 20, 30, 40, 50, 60]);
// random-legal-tap aim per level (sawtooth; breather after each boss and mini)
export const AIM3 = [0,
  1, 1, 1, 0.85, 0.80, 0.76, 0.70, 0.16, 0.66, 0.27,
  0.50, 0.42, 0.15, 0.40, 0.34, 0.31, 0.28, 0.14, 0.26, 0.11,
  0.30, 0.25, 0.13, 0.24, 0.22, 0.21, 0.20, 0.13, 0.19, 0.09,
  0.25, 0.22, 0.12, 0.20, 0.22, 0.19, 0.18, 0.11, 0.16, 0.08,
  0.18, 0.17, 0.10, 0.15, 0.14, 0.13, 0.12, 0.09, 0.14, 0.07,
  0.17, 0.15, 0.09, 0.13, 0.12, 0.11, 0.10, 0.08, 0.09, 0.06];
// hard caps (curator / kid / grandparent targets)
export function band3(id) {
  if (id <= 3) return [0.85, 1];
  if (id <= 6) return [0.70, 1];
  if (MINI.has(id)) return [0, 0.20];
  if (id <= 9) return [0.60, 0.80];
  if (id === 10) return [0, 0.35];
  if (id === 20) return [0, 0.15];
  if (BOSS.has(id)) return [0, 0.12];
  if (id <= 19) return [0.18, 0.55];
  if (id <= 40) return [0.15, 0.25];
  return [0.08, 0.18];
}
// greedy ('average') bot band: a sensible player wins most mid levels, but greedy colour-matching is no longer
//   a guaranteed win late on (the expert bot, which looks ahead, still wins 100 %).
export function greedy3(id) {
  if (id <= 6) return [0.95, 1];
  if (id <= 9 && !MINI.has(id)) return [0.85, 1];
  if (MINI.has(id)) return [0.6, 0.8];
  if (id === 10) return [0.55, 0.85];
  if (BOSS.has(id)) return [0.35, 0.6];
  if (id <= 20) return [0.75, 0.95];
  if (id <= 40) return [0.6, 0.85];
  return [0.45, 0.75];
}
const DAILY_AIM = 0.27, DAILY_BAND = [0.2, 0.35], DAILY_GREEDY = [0.65, 0.9];

// ------------------------------------------------------------------ bots
export function tapRun(puz, r) {
  const st = R.initState(puz);
  while (st.removed !== puz.full) {
    const legal = R.legalMoves(puz, st);
    if (!legal.length) break;
    // strands on top, strand-weighted; refused taps retried == uniform over the legal strands' members
    const pool = [];
    for (const id of legal) for (const m of puz.members[id]) pool.push(id);
    R.pull(puz, st, pool[(r() * pool.length) | 0]);
    if (st.dead) break;
  }
  return R.isWon(puz, st);
}
export function tapStats(puz, runs, seed) { const r = R.rng(seed); let w = 0; for (let i = 0; i < runs; i++) if (tapRun(puz, r)) w++; return w / runs; }

// ------------------------------------------------------------------ specs
function spec3(id) {
  const s = id >= 1000 ? G.dailySpec(id - 1000) : G.specFor(id);
  const L = baseOf(id);
  s.n = L.strands.length; // keep the shipped geometry's strand count
  if (id === 4) s.ncol = 3; // L4 teaches NEXT only (3 colours, as L3); the 4th colour arrives at L5
  s.free0 = [1, 99]; // free-at-start is a property of the kept geometry + depth; no extra gate
  if (id > 5) s.minX = G.MINX(s.n); // same gate as check.mjs, on the kept (sometimes reduced) strand count
  if (id >= 1000) {
    // designer: dailies only use mechanics taught by L15 (knot L8, lock L14) and L15's 4 colours; getDaily() is date-only and can't see progress
    const i = id - 1000;
    s.tw = { k: 1 + (i % 2), l: 1 + ((i >> 1) % 2) };
    s.ncol = 4;
  }
  return s;
}
function capOptions(id) {
  if (id >= 1000) return [4, 5];
  if (id <= 3) return [3];
  if (id <= 7) return [4];
  if (id === 8 || id === 9) return [3, 4];
  if (id <= 29) return [3, 4];
  return [4, 5];
}
function parRange(id, cap) {
  if (id <= 3) return [id === 3 ? 1 : 0, 1];
  if (id <= 7) return [1, 1];
  if (id <= 9) return [1, 2];
  return [1, Math.min(cap, id >= 1000 ? 4 : id < 30 ? 3 : 4)];
}
const JITS = [0.5, 1, 1.5, 2, 2.5, 3, 4];

function geoOf(L) { return { strands: L.strands.map(s => { const pts = R.strandCurve(s.pegs, s.bow || 0); return { pegs: s.pegs, bow: s.bow || 0, pts, at: R.arcLengths(pts) }; }) }; }

function targetsOf(id) {
  if (id >= 1000) return { aim: DAILY_AIM, band: DAILY_BAND, greedy: DAILY_GREEDY };
  return { aim: AIM3[id], band: band3(id), greedy: greedy3(id) };
}
const dist = (v, [a, b]) => (v < a ? a - v : v > b ? v - b : 0);

function score(id, b, par) {
  const T = targetsOf(id);
  const hi = Math.max(b.random, b.tap), lo = Math.min(b.random, b.tap), mid = (b.random + b.tap) / 2;
  const gm = (T.greedy[0] + T.greedy[1]) / 2;
  let s = 10 * Math.abs(mid - T.aim) + 30 * (Math.max(0, hi - T.band[1]) + Math.max(0, T.band[0] - lo)) + 8 * dist(b.average, T.greedy) + 1 * Math.abs(b.average - gm) + 60 * (1 - b.expert);
  // keep skill order: casual <= average + 5
  s += 3 * Math.max(0, b.casual - b.average - 0.05);
  // stars should still separate skill: expert mostly 3*
  if (b.e3 < 0.5) s += 4 * (0.5 - b.e3);
  // designer: after L10 a greedy match-the-active-spool player should mostly end on <= 1* (3* needs look-ahead)
  if (id > 10) s += 4 * Math.max(0, 0.65 - b.g1);
  return s;
}

function candidate(id, seed, cap, jm, geo) {
  const base = spec3(id);
  const spec = { ...base, cap, jitter: base.jitter * jm, par: parRange(id, cap) };
  const o = G.tryLevel(spec, seed, null, geo);
  return o;
}

function quick(puz, seed, runs) {
  const rnd = R.botStats(puz, 'random', runs, seed + 1).winRate;
  return rnd;
}

function measure(puz, seed, runs) {
  const out = {};
  for (const [k, d] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4]]) out[k + 'S'] = R.botStats(puz, k, runs, seed + d);
  const b = { random: out.randomS.winRate, casual: out.casualS.winRate, average: out.averageS.winRate, expert: out.expertS.winRate };
  b.tap = tapStats(puz, runs, seed + 5);
  b.e3 = out.expertS.stars[3] / runs;
  b.g1 = (out.averageS.stars[0] + out.averageS.stars[1]) / runs; // greedy runs ending lost or 1*
  b.full = out;
  return b;
}

function tune(id, secs) {
  const L0 = baseOf(id);
  const geo = geoOf(L0);
  const T = targetsOf(id);
  const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
  let best = null, tried = 0, valid = 0;
  const fails = {};
  const caps = capOptions(id);
  for (let k = 0; el() < secs; k++) {
    const cap = caps[k % caps.length], jm = JITS[(k >> 1) % JITS.length];
    const seed = ((id * 7919 + k * 104729 + 17) >>> 0);
    tried++;
    const o = candidate(id, seed, cap, jm, geo);
    if (o.fail) { fails[o.fail] = (fails[o.fail] || 0) + 1; continue; }
    valid++;
    const q = quick(o.puz, seed, 120);
    if (Math.abs(q - T.aim) > 0.15 && dist(q, T.band) > 0.04) { fails.screen = (fails.screen || 0) + 1; continue; }
    const ex = R.botStats(o.puz, 'expert', 150, seed + 4).winRate;
    if (ex < 1) { fails.expert = (fails.expert || 0) + 1; continue; }
    const b = measure(o.puz, seed, 300);
    const sc = score(id, b, o.level.par);
    if (!best || sc < best.sc) {
      best = { o, b, sc, seed, cap, jm };
      if (sc < 0.25 && el() > secs * 0.3) break;
    }
  }
  if (!best) { console.log(`L${id}: NO CANDIDATE`, tried, JSON.stringify(fails)); return null; }
  // confirm with 1000 runs
  const fin = measure(best.o.puz, best.seed + 1000, 1000);
  const L = best.o.level;
  return { L, fin, best, tried, valid, fails, secs: el() };
}

const pct = x => Math.round(x * 100);
function stamp(id, res) {
  const { L, fin, best } = res;
  const f = fin.full;
  L.stats = {
    v: 3, seed: best.seed, jit: best.jm, crossings: best.o.puz.crossings.length, exact: best.o.sol.exact, states: best.o.sol.states,
    random: +fin.random.toFixed(3), tap: +fin.tap.toFixed(3), casual: +fin.casual.toFixed(3), average: +fin.average.toFixed(3), expert: +fin.expert.toFixed(3),
    avgPeak: { casual: f.casualS.avgPeak == null ? null : +f.casualS.avgPeak.toFixed(2), expert: f.expertS.avgPeak == null ? null : +f.expertS.avgPeak.toFixed(2) },
    stars: { casual: f.casualS.stars, average: f.averageS.stars, expert: f.expertS.stars }, runs: 1000, free0: res.best.o.free0,
    aim: targetsOf(id).aim, score: +best.sc.toFixed(3),
  };
  return L;
}

function savePart(id, L) {
  mkdirSync(PARTS, { recursive: true });
  const name = id >= 1000 ? `D${String(id - 1000).padStart(2, '0')}.json` : `L${String(id).padStart(2, '0')}.json`;
  const p = join(PARTS, name);
  if (existsSync(p) && process.argv.includes('--keep-better')) {
    const old = JSON.parse(readFileSync(p, 'utf8'));
    if (old.stats && old.stats.score <= L.stats.score) { console.log(name, 'kept old', old.stats.score, '<=', L.stats.score); return; }
  }
  const tmp = p + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(L)); renameSync(tmp, p);
}

// ------------------------------------------------------------------ level flags for the UI
// intro: the one new idea a level brings in (ui.js / modes.js first-time hints); knot: 'mini' (Hard) | 'boss' (Super Hard) banner.
const INTRO = { 1: 'tap', 2: 'spool', 3: 'basket', 4: 'next', 5: 'colors4', 8: 'knot', 14: 'lock', 21: 'mystery', 28: 'paw', 35: 'rainbow', 42: 'jumbo', 49: 'ice' };
export function flag(L) {
  const out = { ...L };
  delete out.intro; delete out.tough; delete out.knot;
  if (INTRO[L.id]) out.intro = INTRO[L.id];
  if (BOSS.has(L.id)) out.knot = 'boss'; else if (MINI.has(L.id)) out.knot = 'mini';
  // keep key order stable: id, name, world, ..., intro, knot before strands
  const { id, name, world, cols, rows, cap, shape, ...rest } = out;
  return { id, name, world, cols, rows, cap, shape, ...(out.intro ? { intro: out.intro } : {}), ...(out.knot ? { knot: out.knot } : {}), ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'intro' && k !== 'tough' && k !== 'knot')) };
}

function merge() {
  const parts = existsSync(PARTS) ? new Set(readdirSync(PARTS)) : new Set();
  const lv = LEVELS.map(L => { const f = `L${String(L.id).padStart(2, '0')}.json`; return flag(parts.has(f) ? JSON.parse(readFileSync(join(PARTS, f), 'utf8')) : L); });
  const dl = DAILIES.map((D, i) => { const f = `D${String(i).padStart(2, '0')}.json`; const X = parts.has(f) ? JSON.parse(readFileSync(join(PARTS, f), 'utf8')) : D; X.id = 0; X.daily = i; return X; });
  const head = '// Generated by tools/knot-kitty/gen.mjs, retuned by tools/knot-kitty/tune3.mjs (difficulty v3). Do not edit by hand; check.mjs re-verifies.\n'
    + '// Level flags for the UI: intro = the one new idea the level brings in; knot = \'mini\' (Hard) | \'boss\' (Super Hard), the TOUGH KNOT banner.\n';
  const w = (p, t) => { const tmp = p + '.tmp'; writeFileSync(tmp, t); renameSync(tmp, p); };
  w(join(GAME, 'levels-data.js'), head + 'export default [\n' + lv.map(l => JSON.stringify(l)).join(',\n') + '\n];\n');
  w(join(GAME, 'dailies-data.js'), head + 'export default [\n' + dl.map(l => JSON.stringify(l)).join(',\n') + '\n];\n');
  console.log('merged', [...parts].filter(f => f.endsWith('.json')).length, 'parts');
}

// ------------------------------------------------------------------ cli
const [cmd, a1, a2] = process.argv.slice(2).filter(x => x !== '--lib' && x !== '--keep-better');
if (cmd === 'probe') {
  const id = +a1, secs = +(a2 || 30);
  const geo = geoOf(baseOf(id)), t0 = Date.now(), rows = [];
  for (let k = 0; Date.now() - t0 < secs * 1000; k++) {
    const caps = capOptions(id), cap = caps[k % caps.length], jm = JITS[(k >> 1) % JITS.length];
    const o = candidate(id, 9000 + k, cap, jm, geo);
    if (o.fail) continue;
    const b = measure(o.puz, k, 150);
    rows.push([cap, o.level.par, jm, pct(b.random), pct(b.tap), pct(b.casual), pct(b.average), pct(b.expert)]);
  }
  rows.sort((x, y) => x[3] - y[3]);
  for (const r of rows) console.log(`cap ${r[0]} par ${r[1]} jm ${r[2]} | rnd ${r[3]} tap ${r[4]} cas ${r[5]} avg ${r[6]} exp ${r[7]}`);
  console.log(rows.length, 'valid');
} else if (cmd === 'run' || cmd === 'daily') {
  const secs = +(a2 || 60);
  let ids = [];
  if (cmd === 'run') ids = a1.split(',').flatMap(x => { const [p, q] = x.split('-').map(Number); return q ? Array.from({ length: q - p + 1 }, (_, i) => p + i) : [p]; });
  else { const [p, of] = a1.split('/').map(Number); for (let i = 0; i < 60; i++) if (i % of === p) ids.push(1000 + i); }
  for (const id of ids) {
    const res = tune(id, BOSS.has(id) ? secs * 1.5 : secs);
    if (!res) continue;
    const L = stamp(id, res), s = L.stats, T = targetsOf(id);
    const ok = dist(s.random, T.band) <= 0.01 && dist(s.tap, T.band) <= 0.02 && s.expert >= 0.999 && dist(s.average, T.greedy) <= 0.05;
    console.log(`${id >= 1000 ? 'D' + (id - 1000) : 'L' + id} cap ${L.cap} par ${L.par} x ${s.crossings} | rnd ${pct(s.random)} (aim ${pct(T.aim)}) tap ${pct(s.tap)} cas ${pct(s.casual)} avg ${pct(s.average)} exp ${(s.expert * 100).toFixed(1)} | sc ${s.score} ${ok ? 'OK' : 'MISS'} [${res.valid}/${res.tried}, ${res.secs.toFixed(0)}s] ${JSON.stringify(res.fails)}`);
    if (id >= 1000) L.id = id; // part naming
    savePart(id, L);
  }
} else if (cmd === 'merge') merge();
else if (cmd === 'table') {
  const { default: LV } = await import('../../games/knot-kitty/levels-data.js?' + Date.now());
  const { default: DL } = await import('../../games/knot-kitty/dailies-data.js?' + Date.now());
  const runs = +(a1 || 1000);
  const rows = [];
  for (const L of LV) {
    const puz = R.buildPuzzle(L); puz.par = L.par;
    const b = measure(puz, 31337 + L.id, runs);
    const T = targetsOf(L.id);
    rows.push({ id: L.id, L, b, T, x: puz.crossings.length });
    console.log(`L${L.id} rnd ${pct(b.random)} tap ${pct(b.tap)} avg ${pct(b.average)} exp ${(b.expert * 100).toFixed(1)}`);
  }
  const drows = [];
  for (const [i, D] of DL.entries()) {
    const puz = R.buildPuzzle(D); puz.par = D.par;
    const b = measure(puz, 4242 + i, Math.min(runs, 500));
    drows.push({ i, D, b, x: puz.crossings.length });
  }
  writeFileSync(join(POL, 'table-v3.json'), JSON.stringify({ rows: rows.map(r => ({ id: r.id, cap: r.L.cap, par: r.L.par, n: r.L.strands.length, x: r.x, intro: r.L.intro || null, knot: r.L.knot || null, random: r.b.random, tap: r.b.tap, casual: r.b.casual, average: r.b.average, gstars: r.b.full.averageS.stars, expert: r.b.expert, aim: r.T.aim, band: r.T.band, greedy: r.T.greedy })),
    dailies: drows.map(r => ({ i: r.i, cap: r.D.cap, par: r.D.par, n: r.D.strands.length, x: r.x, random: r.b.random, tap: r.b.tap, casual: r.b.casual, average: r.b.average, gstars: r.b.full.averageS.stars, expert: r.b.expert })) }, null, 1));
  console.log('wrote', join(POL, 'table-v3.json'));
} else console.log('usage: probe <id> [secs] | run <ids> [secs] | daily p/of [secs] | merge | table [runs]');
