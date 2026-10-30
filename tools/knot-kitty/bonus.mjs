// Knot Kitty Bonus Tangles generator (fix2, 2026-10-30). Run from the repo root:
//   node tools/knot-kitty/bonus.mjs run 0/6 [secsPerBoard]   generate a slice of the 60 bonus boards into PARTS
//   node tools/knot-kitty/bonus.mjs merge                    write games/knot-kitty/bonus-data.js from PARTS (ramp order)
//   node tools/knot-kitty/bonus.mjs stats                    print the shipped bonus-data.js bot rates
//
// DECISION: Bonus Tangles are post-L60 content (ui.js shows them on the all-beaten screen), so every mechanic is fair
//   game. Each board gets fresh geometry (gen.mjs genGeometry on a plain 8x10 board, 21 strands, the daily geometry
//   gates), so it is distinct from both the campaign and the 60 Daily Knot boards (check.mjs verifies this).
// DECISION: difficulty ramps by index from about L30 (random-tap win ~0.22, greedy ~0.72) to beyond L60 (random ~0.04,
//   greedy ~0.35) with a mild sawtooth (every 5th board a little harder, the board after it a little easier).
//   Hard gates: tryLevel's (exact solve, par range, colour / twist rules) + expert bot floor (0.9 early -> 0.55 late:
//   the last boards need real planning or a booster; the exact solver still clears them at par).
process.argv.push('--lib');
const G = await import('./gen.mjs');
const R = await import('../../games/knot-kitty/rules.js');
const { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, renameSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GAME = join(ROOT, 'games', 'knot-kitty');
const PARTS = process.env.KKB_PARTS || join(ROOT, 'studio', '2026-10-30', 'fix2', 'bonus-parts');
export const BONUS_N = 60;

const lerp = (a, b, t) => a + (b - a) * t;
export function bonusTargets(i) {
  const t = i / (BONUS_N - 1);
  let aim = lerp(0.22, 0.04, Math.pow(t, 0.85));
  let g = lerp(0.74, 0.36, t);
  if (i % 5 === 4) { aim *= 0.7; g -= 0.06; } else if (i % 5 === 0 && i) { aim *= 1.15; g += 0.04; }
  return { aim, band: [aim * 0.6, aim * 1.45 + 0.01], greedy: [g - 0.12, g + 0.12], expert: lerp(0.9, 0.55, t) };
}

// twists: late-campaign combinations (no teach flags); from board 24 on two combinations are merged
const POOL = [31, 32, 33, 34, 36, 37, 38, 39, 41, 43, 44, 45, 46, 47, 48, 51, 52, 53, 54, 55, 56, 57, 58, 59];
const TWS = {
  31: { p: 2 }, 32: { m: 3, k: 1 }, 33: { l: 2 }, 34: { p: 1, m: 2 }, 36: { r: 1, k: 2 }, 37: { l: 1, p: 1 }, 38: { r: 1, m: 3 },
  39: { k: 2, l: 1 }, 41: { m: 2, l: 1 }, 43: { j: 1, k: 1 }, 44: { r: 1, p: 1 }, 45: { j: 1, l: 1 }, 46: { k: 2, m: 3 }, 47: { p: 2, l: 1 },
  48: { j: 1, r: 1 }, 51: { i: 3, k: 1 }, 52: { i: 2, j: 1 }, 53: { r: 1, l: 2 }, 54: { p: 1, m: 3 }, 55: { k: 2, j: 1 },
  56: { i: 2, k: 1, m: 3 }, 57: { r: 1, l: 1, p: 1 }, 58: { j: 1, k: 2, i: 3 }, 59: { l: 2, p: 1, m: 3 },
};
function twistsFor(i) {
  const a = { ...TWS[POOL[i % POOL.length]] };
  if (i < 24) return a;
  const b = TWS[POOL[(i * 7 + 3) % POOL.length]];
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'k' || k === 'l' || k === 'p') out[k] = Math.min(2, (out[k] || 0) + v);
    else if (k === 'm') out.m = Math.min(3, Math.max(out.m || 0, v));
    else if (k === 'i') out.i = Math.max(out.i || 0, v);
    else out[k] = 1;
  }
  // at most 3 twist kinds (readability)
  const keys = Object.keys(out);
  while (keys.length > 3) delete out[keys.pop()];
  return out;
}

export function bonusSpec(i) {
  const n = 21;
  return { id: 2000 + i, bonus: i, name: 'Bonus Tangle ' + (i + 1), n, tw: twistsFor(i), shape: null, minChoice: 3, cols: 8, rows: 10, ncol: 5, cap: 5,
    jitter: 12, segs: [0.85, 0.15, 0], free0: [2, 4], par: [2, 4], minX: G.MINX(n) };
}

function allPegs(spec) { const a = []; for (let x = 0; x <= (spec.cols - 1) * 2; x++) for (let y = 0; y <= (spec.rows - 1) * 2; y++) a.push([x / 2, y / 2]); return a; }
// 'tap' random bot (same as tune3.mjs tapRun; tune3 is not imported because its CLI runs on import)
function tapRun(puz, r) {
  const st = R.initState(puz);
  while (st.removed !== puz.full) {
    const legal = R.legalMoves(puz, st);
    if (!legal.length) break;
    const pool = [];
    for (const id of legal) for (const m of puz.members[id]) pool.push(id);
    R.pull(puz, st, pool[(r() * pool.length) | 0]);
    if (st.dead) break;
  }
  return R.isWon(puz, st);
}
function tapStats(puz, runs, seed) { const r = R.rng(seed); let w = 0; for (let i = 0; i < runs; i++) if (tapRun(puz, r)) w++; return w / runs; }
const dist = (v, [a, b]) => (v < a ? a - v : v > b ? v - b : 0);

function measure(puz, seed, runs) {
  const o = {};
  for (const [k, d] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4], ['fit', 6]]) o[k] = R.botStats(puz, k, runs, seed + d);
  return { random: o.random.winRate, casual: o.casual.winRate, average: o.average.winRate, expert: o.expert.winRate, fit: o.fit.winRate,
    tap: tapStats(puz, runs, seed + 5), e3: o.expert.stars[3] / runs, full: o };
}
function score(T, b, x) {
  const mid = (b.random + b.tap) / 2, hi = Math.max(b.random, b.tap), lo = Math.min(b.random, b.tap);
  let s = 10 * Math.abs(mid - T.aim) + 20 * (Math.max(0, hi - T.band[1]) + Math.max(0, T.band[0] - lo)) + 8 * dist(b.average, T.greedy);
  s += 30 * Math.max(0, T.expert - b.expert) + 2 * Math.max(0, 0.5 - b.e3);
  s += 3 * Math.max(0, b.casual - b.average - 0.05);
  return s - 0.02 * x;
}

const JM = [1, 1.5, 2, 2.5, 3, 0.75];
function genBoard(i, secs) {
  const spec = bonusSpec(i), T = bonusTargets(i), pegs = allPegs(spec);
  const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
  let best = null, tried = 0, valid = 0, geos = 0;
  const fails = {}, F = k => { fails[k] = (fails[k] || 0) + 1; };
  for (let k = 0; el() < secs; k++) {
    if (best && best.sc < 0.3 && el() > secs * 0.4) break;
    const gseed = (9100003 + i * 100003 + k) >>> 0;
    const geo = G.genGeometry(spec, R.rng(gseed), pegs);
    if (!geo) { F('geo'); continue; }
    if (geo.cover < 0.88) { F('cover'); continue; }
    geos++;
    let okHere = 0;
    for (let d = 0; d < 40 && el() < secs; d++) {
      const cap = d % 3 === 2 ? 5 : 4;
      const s2 = { ...spec, cap, jitter: spec.jitter * JM[(d >> 1) % JM.length], par: [2, Math.min(cap, 4)] };
      const seed = (Math.imul(gseed, 97) + d * 7919 + 1) >>> 0;
      tried++;
      const o = G.tryLevel(s2, seed, pegs, geo);
      if (o.fail) { F(o.fail); if (o.fail === 'minX' || o.fail === 'pieces' || (d >= 8 && !okHere)) break; continue; }
      okHere++; valid++;
      const q = R.botStats(o.puz, 'random', 120, seed + 1).winRate;
      if (Math.abs(q - T.aim) > 0.12 && dist(q, T.band) > 0.03) { F('screen'); continue; }
      const ex = R.botStats(o.puz, 'expert', 100, seed + 4).winRate;
      if (ex < T.expert - 0.15) { F('expert'); continue; }
      const b = measure(o.puz, seed, 250);
      const sc = score(T, b, o.puz.crossings.length);
      if (!best || sc < best.sc) best = { o, b, sc, seed, gseed, cap };
    }
  }
  if (!best) { console.log(`B${i}: NO BOARD [${valid}/${tried} g${geos}]`, JSON.stringify(fails)); return null; }
  const fin = measure(best.o.puz, best.seed + 1000, 600);
  const L = best.o.level, f = fin.full;
  L.id = 0; L.name = spec.name; L.bonus = i; L.world = 0;
  const pr = x => +x.toFixed(3);
  L.stats = { v: 'bonus1', seed: best.seed, gseed: best.gseed, crossings: best.o.puz.crossings.length, exact: best.o.sol.exact, states: best.o.sol.states,
    random: pr(fin.random), tap: pr(fin.tap), casual: pr(fin.casual), average: pr(fin.average), fit: pr(fin.fit), expert: pr(fin.expert),
    stars: { average: f.average.stars, fit: f.fit.stars, expert: f.expert.stars }, runs: 600, free0: best.o.free0, aim: +T.aim.toFixed(3), score: +best.sc.toFixed(3) };
  const pct = x => Math.round(x * 100);
  console.log(`B${i} cap ${L.cap} par ${L.par} x ${L.stats.crossings} tw ${JSON.stringify(spec.tw)} | rnd ${pct(fin.random)} tap ${pct(fin.tap)} (aim ${pct(T.aim)}) avg ${pct(fin.average)} fit ${pct(fin.fit)} exp ${pct(fin.expert)} | sc ${best.sc.toFixed(2)} [${valid}/${tried} g${geos} ${el().toFixed(0)}s] ${JSON.stringify(fails)}`);
  return L;
}

function merge() {
  const files = existsSync(PARTS) ? readdirSync(PARTS).filter(f => /^B\d\d\.json$/.test(f)).sort() : [];
  const boards = files.map(f => JSON.parse(readFileSync(join(PARTS, f), 'utf8'))).sort((a, b) => a.bonus - b.bonus);
  const head = '// Generated by tools/knot-kitty/bonus.mjs (fix2): Bonus Tangles, fresh geometry, ramp order (about L30 -> beyond L60).\n'
    + '// Do not edit by hand; check.mjs re-verifies (exact solve, par, sol, gates). getBonus(i) plays board i, then falls back to a daily remix.\n';
  const body = head + 'export default [\n' + boards.map(b => JSON.stringify(b)).join(',\n') + '\n];\n';
  const p = join(GAME, 'bonus-data.js'), tmp = p + '.tmp';
  writeFileSync(tmp, body); renameSync(tmp, p);
  console.log('bonus-data.js:', boards.length, 'boards,', Buffer.byteLength(body), 'bytes; indices', boards.map(b => b.bonus).join(','));
}

const [cmd, a1, a2] = process.argv.slice(2).filter(x => x !== '--lib');
if (cmd === 'run') {
  const [p, of] = a1.split('/').map(Number), secs = +(a2 || 150);
  mkdirSync(PARTS, { recursive: true });
  for (let i = 0; i < BONUS_N; i++) {
    if (i % of !== p) continue;
    const name = `B${String(i).padStart(2, '0')}.json`;
    if (existsSync(join(PARTS, name)) && !process.argv.includes('--redo')) continue;
    const L = genBoard(i, secs);
    if (L) { const f = join(PARTS, name), tmp = f + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(L)); renameSync(tmp, f); }
  }
} else if (cmd === 'merge') merge();
else if (cmd === 'stats') {
  const { default: B } = await import('../../games/knot-kitty/bonus-data.js');
  for (const L of B) { const puz = R.buildPuzzle(L); puz.par = L.par; const b = measure(puz, 777 + L.bonus, 300); console.log(`B${L.bonus} par ${L.par} cap ${L.cap} rnd ${Math.round(b.random * 100)} avg ${Math.round(b.average * 100)} fit ${Math.round(b.fit * 100)} exp ${Math.round(b.expert * 100)}`); }
} else if (cmd) console.log('usage: run p/of [secs] | merge | stats');
