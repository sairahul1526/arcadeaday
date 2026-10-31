// Knot Kitty difficulty v5 (fix round 5, 2026-10-31): a deeper, harder late game (L40-L60) and eased teach spikes.
// Run from the repo root:
//   node tools/knot-kitty/tune5.mjs gen 43,44 [secs] [--fresh]   re-dress L40-L60 with the TW5 mechanic mix -> parts-fix5
//   node tools/knot-kitty/tune5.mjs ease 13,28,35                same board, basket cap + 1, par re-picked -> parts-fix5
//   node tools/knot-kitty/tune5.mjs par 40-60                    3-star par pass on parts-fix5 (avg-bot 3* 15-40 %)
//   node tools/knot-kitty/tune5.mjs merge                        levels-data.js = shipped data + parts-fix3 + parts-fix5
//   (curve: node tools/knot-kitty/curve5.mjs)
//
// DECISION (fix5): depth comes from the dressing, not from more strands. 8x10 boards stay at 21 strands (24 rarely
//   passes the crossing / free-at-start gates and gets thin on a 360 px phone) and bosses at 18 on their silhouettes.
//   Every L40-L60 level gets a denser mechanic mix (TW5: 3-6 twists per board, only mechanics already taught), a
//   queue jitter up to 4x the band value (spools arrive out of board order, so more turns have no strand that winds
//   straight onto a spool: the r3 'decision turn'), and basket cap 4 or 5. A candidate is scored against a per-level
//   average-bot aim (AIM5: bands ~0.65 / ~0.62, breathers ~0.8, bosses ~0.42), a casual floor (>= 0.27), expert at
//   100 % (300 runs) and a decision-turn aim (DEC5), and must leave a par in [opt, cap) with 15-40 % avg-bot 3 stars.
// DECISION (fix5): L42 (jumbo) and L49 (ice) keep their teach gate (tw.teach) and an easy aim (0.88 / 0.82).
// DECISION (fix5): merge order is shipped data < parts-fix3 < parts-fix5, so this pass is always the newest step;
//   tune4.mjs merge applies parts-fix5 too, so re-running it does not revert this pass.
process.argv.push('--lib');
const G = await import('./gen.mjs');
const R = await import('../../games/knot-kitty/rules.js');
const C = await import('./curve5.mjs');
const { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, renameSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GAME = join(ROOT, 'games', 'knot-kitty');
const PARTS3 = join(HERE, 'parts-fix3');
const PARTS = process.env.KK5_PARTS || join(HERE, 'parts-fix5');
const LEVELS = (await import('../../games/knot-kitty/levels-data.js')).default;

// mechanics per level: k knots, l locks, m mystery, p paws, r rainbow, j jumbo, i ice thaw (taught: knot 8, lock 14,
//   mystery 21, paw 28, rainbow 35, jumbo 42, ice 49 - no level uses a mechanic before its teach level)
export const TW5 = {
  40: { k: 2, l: 1, p: 1, r: 1 },
  41: { m: 2, l: 1, k: 1 },
  42: { j: 1, teach: 'jumbo' },
  43: { j: 1, k: 1, l: 1 },
  44: { r: 1, p: 1, m: 2, k: 1 },
  45: { j: 1, l: 1, k: 1, m: 2 },
  46: { k: 2, m: 3, p: 1 },
  47: { p: 2, l: 1, r: 1 },
  48: { j: 1, r: 1, k: 1, l: 1 },
  49: { i: 2, teach: 'ice' },
  50: { k: 2, l: 1, i: 2, p: 1, m: 2 },
  51: { i: 3, k: 1, m: 2 },
  52: { i: 2, j: 1, l: 1 },
  53: { r: 1, l: 2, k: 1, i: 2 },
  54: { p: 1, m: 3, j: 1, k: 1 },
  55: { k: 2, j: 1, l: 1, i: 2 },
  56: { i: 2, k: 1, m: 3, r: 1 },
  57: { r: 1, l: 1, p: 1, j: 1, k: 1 },
  58: { j: 1, k: 2, i: 3, l: 1 },
  59: { l: 2, p: 1, m: 3, r: 1, k: 1 },
  60: { k: 2, l: 1, r: 1, i: 2, p: 1, j: 1 },
};
// average-bot win aim (300 runs, seed 11) and decision-turn aim per level
export const AIM5 = { 40: 0.45, 41: 0.85, 42: 0.88, 43: 0.60, 44: 0.57, 45: 0.58, 46: 0.80, 47: 0.55, 48: 0.53, 49: 0.82, 50: 0.42,
  51: 0.82, 52: 0.80, 53: 0.58, 54: 0.56, 55: 0.54, 56: 0.78, 57: 0.55, 58: 0.52, 59: 0.54, 60: 0.42 };
export const DEC5 = { 40: 8, 41: 6, 42: 4.5, 43: 7, 44: 7.5, 45: 7.5, 46: 7, 47: 7.5, 48: 8, 49: 6, 50: 8.5,
  51: 6.5, 52: 6.5, 53: 8, 54: 8, 55: 8, 56: 7, 57: 8, 58: 8.5, 59: 8.5, 60: 9 };
const BOSS = new Set([40, 50, 60]);
const pct = x => Math.round(x * 100);
const JITS = [1, 1.5, 2, 2.5, 3, 4];

const partPath = (dir, id) => join(dir, `L${String(id).padStart(2, '0')}.json`);
const readPart = (dir, id) => (existsSync(partPath(dir, id)) ? JSON.parse(readFileSync(partPath(dir, id), 'utf8')) : null);
const current = id => readPart(PARTS, id) || readPart(PARTS3, id) || LEVELS[id - 1];
function savePart(L) {
  mkdirSync(PARTS, { recursive: true });
  const p = partPath(PARTS, L.id), tmp = p + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(L)); renameSync(tmp, p);
}
const ids = a => a.split(',').flatMap(x => { const [p, q] = x.split('-').map(Number); return q ? Array.from({ length: q - p + 1 }, (_, i) => p + i) : [p]; });
function ordered(L) {
  const { id, name, world, cols, rows, cap, shape, intro, knot, ...rest } = L;
  return { id, name, world, cols, rows, cap, shape, ...(intro ? { intro } : {}), ...(knot ? { knot } : {}), ...rest };
}
const geoOf = L => ({ strands: L.strands.map(s => { const pts = R.strandCurve(s.pegs, s.bow || 0); return { pegs: s.pegs, bow: s.bow || 0, pts, at: R.arcLengths(pts) }; }) });
function plainPegs(cols, rows) { const a = []; for (let x = 0; x <= (cols - 1) * 2; x++) for (let y = 0; y <= (rows - 1) * 2; y++) a.push([x / 2, y / 2]); return a; }

// greedy-bot win peaks (critic setting + a 1000-run sample) -> best par in [opt, cap) for a 15-40 % 3-star share
function peakHist(puz, runs, seed) {
  const r = R.rng(seed), hist = new Array(7).fill(0);
  for (let i = 0; i < runs; i++) { const o = R.botRun(puz, 'average', r); if (o.win) hist[o.peak]++; }
  return { hist, runs };
}
const share = (h, par) => h.hist.slice(0, par + 1).reduce((a, b) => a + b, 0) / h.runs;
function pickPar(puz, opt, cap, seed) {
  const h1 = peakHist(puz, 1000, seed), hc = peakHist(puz, 300, 11);
  let best = null;
  for (let p = opt; p <= cap - 1; p++) {
    const a = share(h1, p), b = share(hc, p);
    const miss = Math.max(0, 0.17 - Math.min(a, b)) + Math.max(0, Math.max(a, b) - 0.38);
    if (!best || miss < best.miss - 1e-9) best = { par: p, miss, g3: b, g3k: a };
  }
  return best;
}

function measure(puz, runs, seed) {
  const o = {};
  for (const [k, d] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4]]) o[k] = R.botStats(puz, k, runs, seed + d);
  return o;
}
function stamp(L, sol, how, extra = {}) {
  const puz = R.buildPuzzle(L); puz.par = L.par;
  const f = measure(puz, 1000, 31337 + L.id * 17);
  const ap = s => (s.avgPeak == null ? null : +s.avgPeak.toFixed(2));
  L.stats = {
    v: 5, ...extra, crossings: puz.crossings.length, exact: sol.exact, states: sol.states,
    random: +f.random.winRate.toFixed(3), casual: +f.casual.winRate.toFixed(3), average: +f.average.winRate.toFixed(3), expert: +f.expert.winRate.toFixed(3),
    avgPeak: { casual: ap(f.casual), expert: ap(f.expert), average: ap(f.average) },
    stars: { casual: f.casual.stars, average: f.average.stars, expert: f.expert.stars }, runs: 1000, opt: sol.peak, fix5: how,
  };
  return L;
}

// ------------------------------------------------------------------ gen: re-dress with the TW5 mix
function score(id, c) {
  const aim = AIM5[id], dec = DEC5[id];
  let s = 12 * Math.max(0, Math.abs(c.avg - aim) - 0.03);
  s += 25 * Math.max(0, 0.28 - c.cas) + 60 * (1 - c.exp);
  s += 1.2 * Math.max(0, dec - c.dec) - 0.15 * Math.min(2, Math.max(0, c.dec - dec));
  s += 4 * Math.max(0, c.cas - c.avg - 0.05);
  s += 15 * c.parMiss;
  if (!BOSS.has(id) && c.avg < 0.5) s += 20 * (0.5 - c.avg);
  if (BOSS.has(id) && c.avg < 0.4) s += 20 * (0.4 - c.avg);
  return s;
}
function gen(id, secs, fresh) {
  const L0 = current(id);
  const tw = TW5[id];
  const base = G.specFor(id);
  base.tw = tw;
  base.n = L0.strands.length;
  base.minX = G.MINX(base.n);
  base.free0 = [1, 99];
  const geo0 = geoOf(L0);
  const pegs = plainPegs(base.cols, base.rows);
  const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
  let best = null, tried = 0, valid = 0, geo = geo0, gk = 0;
  const fails = {};
  const F = k => { fails[k] = (fails[k] || 0) + 1; };
  for (let k = 0; el() < secs; k++) {
    // fresh plain-board geometry every 40 dressings (bosses keep their silhouette geometry)
    if (fresh && !L0.shape && k % 40 === 0) {
      const g = G.genGeometry({ ...base, n: base.n }, R.rng((id * 7919 + gk++ * 104729 + 5) >>> 0), pegs);
      if (!g || g.strands.length !== base.n || g.cover < 0.88) { F('geo'); continue; }
      geo = g;
    }
    const cap = [5, 4][k % 2], jm = JITS[(k >> 1) % JITS.length];
    const seed = ((id * 2246822519 + k * 3266489917 + (fresh ? 17 : 3)) >>> 0);
    tried++;
    const o = G.tryLevel({ ...base, cap, jitter: base.jitter * jm, par: [1, cap - 1] }, seed, null, geo);
    if (o.fail) { F(o.fail); continue; }
    valid++;
    const puz = o.puz;
    const qa = R.botStats(puz, 'average', 100, seed + 3).winRate;
    if (Math.abs(qa - AIM5[id]) > 0.2) { F('screenA'); continue; }
    const qc = R.botStats(puz, 'casual', 100, seed + 2).winRate;
    if (qc < 0.18) { F('screenC'); continue; }
    if (R.botStats(puz, 'expert', 200, seed + 4).winRate < 1) { F('expert'); continue; }
    const L = o.level;
    const d = C.decisions({ ...L, id });
    if (!d) { F('dec'); continue; }
    if (d.dec < DEC5[id] - 2.5) { F('decLow'); continue; }
    const pp = pickPar(puz, L.par, cap, seed + 9);
    puz.par = pp.par;
    const a = R.botStats(puz, 'average', 300, 11), c = R.botStats(puz, 'casual', 300, 11), e = R.botStats(puz, 'expert', 300, 11);
    const cand = { avg: a.winRate, cas: c.winRate, exp: e.winRate, dec: d.dec, parMiss: pp.miss, g3: a.stars[3] / 300, par: pp.par, opt: L.par };
    const sc = score(id, cand);
    if (!best || sc < best.sc) {
      best = { o, cand, sc, seed, cap, jm };
      console.log(`  L${id} [${el().toFixed(0)}s] sc ${sc.toFixed(2)} cap ${cap} opt ${cand.opt} par ${cand.par} avg ${pct(cand.avg)} cas ${pct(cand.cas)} exp ${pct(cand.exp)} 3* ${pct(cand.g3)} dec ${cand.dec.toFixed(1)}`);
      if (sc < 0.02 && el() > secs * 0.3) break;
    }
  }
  console.log(`L${id}: ${valid}/${tried} valid ${JSON.stringify(fails)}`);
  if (!best) return null;
  const L = best.o.level;
  L.id = id; L.name = L0.name; L.world = L0.world;
  if (L0.intro) L.intro = L0.intro; else delete L.intro;
  if (L0.knot) L.knot = L0.knot; else delete L.knot;
  const sol = R.solve(R.buildPuzzle(L), null, 600000);
  if (!sol.exact || sol.peak !== best.cand.opt) { console.log(`L${id}: re-solve mismatch`); return null; }
  L.sol = sol.moves;
  L.par = best.cand.par;
  return { L: stamp(L, sol, (fresh ? 'gen5:fresh' : 'gen5:redress'), { seed: best.seed, jit: best.jm }), best };
}

const [cmd, a1, a2] = process.argv.slice(2).filter(x => x !== '--lib' && x !== '--fresh');
const fresh = process.argv.includes('--fresh');
if (cmd === 'gen') {
  const secs = +(a2 || 90);
  for (const id of ids(a1)) {
    if (!TW5[id]) { console.log(`L${id}: no TW5 entry`); continue; }
    const old = current(id);
    const before = C.row(old);
    const out = gen(id, secs, fresh);
    if (!out) { console.log(`L${id}: MISS`); continue; }
    // keep the better of this run and an existing fix5 part (by the same score)
    const prev = readPart(PARTS, id);
    if (prev && !process.env.KK5_REPLACE) {
      const pr = C.row(prev), ps = score(id, { ...pr, parMiss: 0 });
      if (ps <= out.best.sc) { console.log(`L${id}: kept the existing part (sc ${ps.toFixed(2)} <= ${out.best.sc.toFixed(2)})`); continue; }
    }
    const after = C.row(out.L);
    console.log(`L${id} OK: n ${after.n} cap ${old.cap}->${out.L.cap} par ${old.par}->${out.L.par} avg ${pct(before.avg)}->${pct(after.avg)} cas ${pct(before.cas)}->${pct(after.cas)} 3* ${pct(before.g3)}->${pct(after.g3)} dec ${before.dec.toFixed(1)}->${after.dec.toFixed(1)} | ${after.mech}`);
    savePart(ordered(out.L));
  }
} else if (cmd === 'ease') {
  // teach-spike ease (critic r3): the same board with one more basket slot; par re-picked in [opt, cap)
  for (const id of ids(a1)) {
    const L0 = current(id);
    if (L0.cap >= 5) { console.log(`L${id}: cap already 5`); continue; }
    const L = JSON.parse(JSON.stringify(L0)); L.cap = L0.cap + 1;
    const sol = R.solve(R.buildPuzzle(L), null, 600000);
    if (!sol.exact) { console.log(`L${id}: solver aborted`); continue; }
    L.sol = sol.moves;
    const puz = R.buildPuzzle(L);
    const pp = pickPar(puz, sol.peak, L.cap, 4242 + id);
    L.par = pp.par;
    const b = C.row(L0), a = C.row(L);
    console.log(`L${id} ease: cap ${L0.cap}->${L.cap} opt ${sol.peak} par ${L0.par}->${L.par} avg ${pct(b.avg)}->${pct(a.avg)} cas ${pct(b.cas)}->${pct(a.cas)} 3* ${pct(b.g3)}->${pct(a.g3)} dec ${b.dec.toFixed(1)}->${a.dec.toFixed(1)}`);
    const old = L0.stats || {};
    savePart(ordered(stamp(L, sol, 'ease5:cap+1', { seed: old.seed, jit: old.jit })));
  }
} else if (cmd === 'par') {
  for (const id of ids(a1)) {
    const L = readPart(PARTS, id); if (!L) continue;
    const sol = R.solve(R.buildPuzzle(L), null, 600000);
    const pp = pickPar(R.buildPuzzle(L), sol.peak, L.cap, 4242 + id);
    if (pp.par === L.par) { console.log(`L${id} par ${L.par}: fine (3* ${pct(pp.g3)})`); continue; }
    console.log(`L${id} par ${L.par}->${pp.par} (3* ${pct(pp.g3)})`);
    L.par = pp.par; L.sol = sol.moves;
    savePart(ordered(stamp(L, sol, (L.stats.fix5 || '') + ',par5', { seed: L.stats.seed, jit: L.stats.jit })));
  }
} else if (cmd === 'merge') {
  const over = new Map();
  for (const dir of [PARTS3, PARTS]) if (existsSync(dir)) for (const f of readdirSync(dir).filter(f => /^L\d\d\.json$/.test(f))) { const L = JSON.parse(readFileSync(join(dir, f), 'utf8')); over.set(L.id, L); }
  const lv = LEVELS.map(L => over.get(L.id) || L);
  const head = '// Generated by tools/knot-kitty/gen.mjs, retuned by tools/knot-kitty/tune3.mjs (difficulty v3), tools/knot-kitty/tune4.mjs (fix3: breathers + 3-star par) and tools/knot-kitty/tune5.mjs (fix5: deeper L40-L60, eased teach spikes). Do not edit by hand; check.mjs re-verifies.\n'
    + '// Level flags for the UI: intro = the one new idea the level brings in; knot = \'mini\' (Hard) | \'boss\' (Super Hard), the TOUGH KNOT banner.\n'
    + '// par = the 3-star line (basket peak <= par). stats.opt, when present, is the solver-optimal peak (par may sit above it, below cap).\n';
  const p = join(GAME, 'levels-data.js'), tmp = p + '.tmp';
  writeFileSync(tmp, head + 'export default [\n' + lv.map(l => JSON.stringify(l)).join(',\n') + '\n];\n'); renameSync(tmp, p);
  const f5 = existsSync(PARTS) ? readdirSync(PARTS).filter(f => /^L\d\d\.json$/.test(f)).map(f => +f.slice(1, 3)) : [];
  console.log('merged fix3 + fix5 parts; fix5:', f5.join(','));
} else console.log('usage: gen <ids> [secs] [--fresh] | ease <ids> | par <ids> | merge');
