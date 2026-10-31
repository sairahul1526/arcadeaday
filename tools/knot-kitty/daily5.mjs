// Knot Kitty Daily Knot boards v5 (fix round 5, 2026-10-31). Run from the repo root:
//   node tools/knot-kitty/daily5.mjs gen 0-59 [secs] [--part p/of]   one board per index -> tools/knot-kitty/parts-daily5/Dnn.json
//   node tools/knot-kitty/daily5.mjs merge                            write games/knot-kitty/dailies-data.js (all 60 parts needed)
//
// DECISION (fix5, critic r3 mobile-designer: "every daily is knot + lock on the same 8x10 / 21-strand / 4-colour board"):
//   the Daily unlocks after L13, so its mechanics stay knot + lock (lock arrives at L14, the level the player is on
//   when the Daily opens, as before). The variety comes from everything else, in a 10-day cycle of formats: board size
//   (7x8 / 7x9 / 8x9 / 8x10; 7x9 at 18 plain strands packs too rarely, so that format runs on 8x9, and 8x9 at 15 covers too little), strand
//   count (15-21), colour count (3-5), basket cap (4-5) and the knot / lock mix (knots only, locks only, both).
//   Difficulty is a gentle weekly wave (average bot ~0.62-0.80, casual >= 0.30, expert 100 %), 3 stars for 15-40 %
//   of average-bot runs (par = solver optimum, a check.mjs daily gate). The data format is unchanged (the same fields as gen.mjs dailies).
process.argv.push('--lib');
const G = await import('./gen.mjs');
const R = await import('../../games/knot-kitty/rules.js');
const C = await import('./curve5.mjs');
const { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, renameSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..', '..', 'games', 'knot-kitty');
const PARTS = join(HERE, 'parts-daily5');

// 10-day format cycle: [cols, rows, strands, colours, shape, twists]
// No silhouettes: render.js draws any shape with the gilded boss frame, and getDaily's vertical mirror would turn
// a pumpkin / heart / cat head upside down against its upright outline. Plain boards only.
const FORMATS = [
  [8, 10, 21, 4, null, { k: 1, l: 1 }],
  [7, 8, 15, 3, null, { k: 2 }],
  [8, 9, 18, 4, null, { l: 2 }],
  [7, 9, 15, 3, null, { k: 1, l: 1 }],
  [8, 10, 21, 5, null, { k: 2, l: 1 }],
  [8, 9, 18, 3, null, { k: 1, l: 2 }],
  [8, 10, 18, 4, null, { k: 2, l: 1 }],
  [7, 9, 15, 4, null, { l: 1, k: 1 }],
  [8, 10, 21, 5, null, { l: 2, k: 1 }],
  [8, 9, 18, 5, null, { k: 2 }],
];
// weekly wave of average-bot aims (Mon easy ... Sun hardest) shifted per index
const WAVE = [0.80, 0.76, 0.72, 0.70, 0.66, 0.62, 0.74];
const DIL = 0.5, COV_MIN = 0.88;

function pegsFor(cols, rows, shape, dil = DIL) {
  const all = [];
  for (let x = 0; x <= (cols - 1) * 2; x++) for (let y = 0; y <= (rows - 1) * 2; y++) all.push([x / 2, y / 2]);
  if (!shape) return { pegs: all, tgt: all };
  const ins = G.inShape(shape, cols, rows);
  const base = all.filter(p => ins(p[0], p[1]));
  return { pegs: all.filter(p => base.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= dil + 1e-9)), tgt: base };
}
function specFor(i) {
  const [cols, rows, n, ncol, shape, tw] = FORMATS[i % FORMATS.length];
  const s = G.dailySpec(i);
  Object.assign(s, { cols, rows, n, ncol, shape, tw: { ...tw }, minX: G.MINX(n), free0: [2, 4], jitter: 11 });
  s.segs = n >= 12 ? [0.85, 0.15, 0] : s.segs;
  s.aim = WAVE[i % 7];
  return s;
}
function peakHist(puz, runs, seed) { const r = R.rng(seed), hist = new Array(7).fill(0); for (let i = 0; i < runs; i++) { const o = R.botRun(puz, 'average', r); if (o.win) hist[o.peak]++; } return { hist, runs }; }
const share = (h, par) => h.hist.slice(0, par + 1).reduce((a, b) => a + b, 0) / h.runs;
function pickPar(puz, opt, cap, seed) {
  const h1 = peakHist(puz, 1000, seed), hc = peakHist(puz, 300, 11);
  let best = null;
  // check.mjs: a daily's par must equal the solver optimum (getDaily transforms are re-solved against it), so
  // par = opt only; the 3-star share at opt is scored instead of moving par.
  for (let p = opt; p <= opt; p++) {
    const a = share(h1, p), b = share(hc, p);
    const miss = Math.max(0, 0.17 - Math.min(a, b)) + Math.max(0, Math.max(a, b) - 0.38);
    if (!best || miss < best.miss - 1e-9) best = { par: p, miss, g3: b };
  }
  return best;
}
const JITS = [1, 1.5, 2, 0.75, 2.5, 3];
function gen(i, secs) {
  const base = specFor(i);
  const { pegs, tgt } = pegsFor(base.cols, base.rows, base.shape);
  const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
  let best = null, geo = null, tried = 0, geos = 0;
  const fails = {};
  const F = k => { fails[k] = (fails[k] || 0) + 1; };
  for (let k = 0; el() < secs; k++) {
    if (k % 30 === 0) {
      geo = G.genGeometry(base, R.rng((7000003 + i * 100003 + k * 7919 + 5) >>> 0), pegs);
      if (!geo || geo.strands.length !== base.n || geo.cover < (base.shape ? COV_MIN - 0.05 : COV_MIN)) { F('geo'); geo = null; k += 29; continue; }
      geos++;
    }
    const cap = [5, 4][k % 2], jm = JITS[(k >> 1) % JITS.length];
    const seed = ((i * 2654435761 + k * 104729 + 12345) >>> 0);
    tried++;
    const o = G.tryLevel({ ...base, cap, jitter: base.jitter * jm, par: [1, cap - 1] }, seed, null, geo);
    if (o.fail) { F(o.fail); if (o.fail === 'minX' || o.fail === 'pieces') k += 29 - (k % 30); continue; }
    const puz = o.puz;
    const qa = R.botStats(puz, 'average', 100, seed + 3).winRate;
    if (Math.abs(qa - base.aim) > 0.2) { F('screenA'); continue; }
    const qc = R.botStats(puz, 'casual', 100, seed + 2).winRate;
    if (qc < 0.22) { F('screenC'); continue; }
    if (R.botStats(puz, 'expert', 200, seed + 4).winRate < 1) { F('expert'); continue; }
    const d = C.decisions({ ...o.level, id: 1000 + i });
    if (!d) { F('dec'); continue; }
    const opt0 = R.solve(R.buildPuzzle(o.level), null, 600000).peak;
    const pp = pickPar(puz, opt0, cap, seed + 9);
    puz.par = pp.par;
    const a = R.botStats(puz, 'average', 300, 11), c = R.botStats(puz, 'casual', 300, 11), e = R.botStats(puz, 'expert', 300, 11);
    let sc = 12 * Math.max(0, Math.abs(a.winRate - base.aim) - 0.03) + 25 * Math.max(0, 0.30 - c.winRate) + 60 * (1 - e.winRate) + 15 * pp.miss + 1 * Math.max(0, 5 - d.dec) + 4 * Math.max(0, c.winRate - a.winRate - 0.05);
    if (!best || sc < best.sc) { best = { o, sc, pp, a, c, d, seed, jm, cap }; if (sc < 0.02 && el() > secs * 0.3) break; }
  }
  const tag = `D${i} ${base.cols}x${base.rows}${base.shape ? ' ' + base.shape : ''} n${base.n} col${base.ncol} ${JSON.stringify(base.tw)}`;
  if (!best) { console.log(`${tag}: NO BOARD ${JSON.stringify(fails)}`); return null; }
  const L = best.o.level;
  const sol = R.solve(R.buildPuzzle(L), null, 600000);
  L.sol = sol.moves; L.par = sol.peak;
  const puz = R.buildPuzzle(L); puz.par = L.par;
  const f = {}; for (const [k, dd] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4]]) f[k] = R.botStats(puz, k, 1000, best.seed + dd);
  const ap = s => (s.avgPeak == null ? null : +s.avgPeak.toFixed(2));
  L.stats = { v: 5, seed: best.seed, jit: best.jm, crossings: puz.crossings.length, exact: sol.exact, states: sol.states,
    random: +f.random.winRate.toFixed(3), casual: +f.casual.winRate.toFixed(3), average: +f.average.winRate.toFixed(3), expert: +f.expert.winRate.toFixed(3),
    avgPeak: { casual: ap(f.casual), expert: ap(f.expert), average: ap(f.average) }, stars: { casual: f.casual.stars, average: f.average.stars, expert: f.expert.stars },
    runs: 1000, opt: sol.peak, aim: base.aim, dec: +best.d.dec.toFixed(1), fix5: 'daily5' };
  L.id = 0; L.daily = i;
  console.log(`${tag}: cap ${L.cap} opt ${sol.peak} par ${L.par} avg ${(best.a.winRate * 100).toFixed(0)} (aim ${base.aim * 100}) cas ${(best.c.winRate * 100).toFixed(0)} 3* ${(best.pp.g3 * 100).toFixed(0)} dec ${best.d.dec.toFixed(1)} sc ${best.sc.toFixed(2)} [${tried} tried, ${geos} geos]`);
  return L;
}
const ids = a => a.split(',').flatMap(x => { const [p, q] = x.split('-').map(Number); return q ? Array.from({ length: q - p + 1 }, (_, i) => p + i) : [p]; });
const args = process.argv.slice(2).filter(x => x !== '--lib');
const [cmd, a1, a2] = args.filter(x => !x.startsWith('--') && !/^\d+\/\d+$/.test(x));
const part = args.includes('--part') ? args[args.indexOf('--part') + 1].split('/').map(Number) : [0, 1];
if (cmd === 'gen') {
  mkdirSync(PARTS, { recursive: true });
  for (const i of ids(a1)) {
    if (i % part[1] !== part[0]) continue;
    const L = gen(i, +(a2 || 40));
    if (!L) continue;
    const p = join(PARTS, `D${String(i).padStart(2, '0')}.json`), tmp = p + '.' + process.pid + '.tmp';
    writeFileSync(tmp, JSON.stringify(L)); renameSync(tmp, p);
  }
} else if (cmd === 'merge') {
  const D = [];
  for (let i = 0; i < 60; i++) {
    const p = join(PARTS, `D${String(i).padStart(2, '0')}.json`);
    if (!existsSync(p)) { console.error('missing', p); process.exit(1); }
    D.push(JSON.parse(readFileSync(p, 'utf8')));
  }
  const head = '// Generated by tools/knot-kitty/daily5.mjs (fix5: varied boards - size, silhouette, strands, colours, cap, knot / lock mix; was gen.mjs + tune3.mjs). Do not edit by hand; check.mjs re-verifies.\n'
    + '// Level flags for the UI: intro = the one new idea the level brings in; knot = \'mini\' (Hard) | \'boss\' (Super Hard), the TOUGH KNOT banner.\n'
    + '// par = the 3-star line (basket peak <= par). stats.opt is the solver-optimal peak (par may sit above it, below cap).\n';
  const p = join(GAME, 'dailies-data.js'), tmp = p + '.tmp';
  writeFileSync(tmp, head + 'export default [\n' + D.map(l => JSON.stringify(l)).join(',\n') + '\n];\n'); renameSync(tmp, p);
  console.log('merged 60 dailies');
} else console.log('usage: gen <ids> [secs] [--part p/of] | merge');
