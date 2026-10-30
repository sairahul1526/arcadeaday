// Knot Kitty difficulty v4 (fix round 3): sawtooth relief + reachable 3 stars. Run from the repo root:
//   node tools/knot-kitty/tune4.mjs table                      bot table for L11-L60 (300 runs, seed 11: the critics' setting)
//   node tools/knot-kitty/tune4.mjs relief 11,12,16 [secs]     breathers -> parts in $KK4_PARTS (default tools/knot-kitty/parts-fix3)
//   node tools/knot-kitty/tune4.mjs keep 37,55 [secs]          same-difficulty re-dress where no par < cap can give 3 stars
//   node tools/knot-kitty/tune4.mjs par 23-60                  3-star par pass -> parts
//   node tools/knot-kitty/tune4.mjs merge                      write the parts into games/knot-kitty/levels-data.js
//
// DECISION (fix3, relief): every n in 11..59 with n % 10 in {1, 2, 6} is a breather: greedy ('average') bot win >= 0.85
//   and casual >= 0.6. Smallest change first: the same board with basket cap + 1 (cap <= 5, check.mjs); else re-dress
//   the kept geometry with gen.mjs tryLevel() exactly as tune3 'run' does (same pegs, bows, strand count, twists, intro
//   teach gate), with caps {cap, cap + 1}; else a fresh geometry from the same spec (same world / twists / strand count).
//   Knot levels (mini / boss, L8, every n % 10 == 0) and L1-L10 are never re-dressed: they are the spikes.
// DECISION (fix3, par): par is the 3-star line (rules.js starsFor: 3 stars iff basket peak <= par). Up to fix2 par was
//   always the solver-optimal peak, which left the greedy bot 0-8 % 3-star on most of L23-L60. For L23-L60 levels whose
//   greedy 3-star share is < 0.10, par is raised to the smallest value in [opt, cap - 1] that gives the greedy bot
//   >= 0.15 3-star share (aim 0.15-0.35); bosses only need >= 0.08 (stricter line). par stays below cap so the gold
//   3-star line still shows and a plain win is never automatically 3 stars. The optimum is kept in stats.opt and
//   check.mjs verifies opt (solver), the sol line (peak == opt) and opt <= par < cap.
process.argv.push('--lib');
const G = await import('./gen.mjs');
const R = await import('../../games/knot-kitty/rules.js');
const { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, renameSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GAME = join(ROOT, 'games', 'knot-kitty');
const PARTS = process.env.KK4_PARTS || join(HERE, 'parts-fix3');
const LEVELS = (await import('../../games/knot-kitty/levels-data.js')).default;

export const MINI = new Set([8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58]);
export const BOSS = new Set([10, 20, 30, 40, 50, 60]);
export const BREATHER = new Set([...Array(49).keys()].map(i => i + 11).filter(n => [1, 2, 6].includes(n % 10)));
const isKnot = L => !!L.knot || MINI.has(L.id) || BOSS.has(L.id) || L.id === 8;
const RELIEF = { average: 0.85, casual: 0.6 };
const pct = x => Math.round(x * 100);

// ------------------------------------------------------------------ measuring (same bots / fields as tune3 measure)
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
const tapStats = (puz, runs, seed) => { const r = R.rng(seed); let w = 0; for (let i = 0; i < runs; i++) if (tapRun(puz, r)) w++; return w / runs; };
function measure(puz, seed, runs) {
  const f = {};
  for (const [k, d] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4]]) f[k + 'S'] = R.botStats(puz, k, runs, seed + d);
  return { random: f.randomS.winRate, casual: f.casualS.winRate, average: f.averageS.winRate, expert: f.expertS.winRate, tap: tapStats(puz, runs, seed + 5), g3: f.averageS.stars[3] / runs, full: f, runs };
}
// the critics' setting (r2 depth.mjs): 300 runs, seed 11 per bot
function critic(L, par = L.par) {
  const puz = R.buildPuzzle(L); puz.par = par;
  const a = R.botStats(puz, 'average', 300, 11), c = R.botStats(puz, 'casual', 300, 11);
  return { average: a.winRate, casual: c.winRate, g3: a.stars[3] / 300 };
}
// greedy-bot peak histogram over wins (for the par pass): hist[p] = wins with peak p
function peakHist(puz, runs, seed) {
  const r = R.rng(seed), hist = new Array(6).fill(0);
  let wins = 0;
  for (let i = 0; i < runs; i++) { const o = R.botRun(puz, 'average', r); if (o.win) { wins++; hist[o.peak]++; } }
  return { hist, wins, runs };
}
const share = (h, par) => h.hist.slice(0, par + 1).reduce((a, b) => a + b, 0) / h.runs;

// ------------------------------------------------------------------ re-dress (tune3 spec3 / candidate, kept geometry)
function spec4(L) {
  const s = G.specFor(L.id);
  s.n = L.strands.length;
  s.free0 = [1, 99];
  s.minX = G.MINX(s.n);
  return s;
}
const geoOf = L => ({ strands: L.strands.map(s => { const pts = R.strandCurve(s.pegs, s.bow || 0); return { pegs: s.pegs, bow: s.bow || 0, pts, at: R.arcLengths(pts) }; }) });
const JITS = [0.5, 1, 1.5, 2, 2.5, 3, 4];
function reliefScore(b, cap0, cap) {
  // breather: clear the win floors with margin (the 300-run critic sample re-samples), keep expert at 100 %,
  //   keep skill order (casual <= average + 5), keep a third star that needs some care (greedy 3* 0.15-0.45 at opt par).
  let s = 20 * Math.max(0, 0.9 - b.average) + 20 * Math.max(0, 0.66 - b.casual) + 60 * (1 - b.expert);
  s += 3 * Math.max(0, b.casual - b.average - 0.05);
  s += 2 * Math.max(0, 0.15 - b.g3) + 1 * Math.max(0, b.g3 - 0.45);
  s += 0.3 * (cap - cap0); // prefer the original basket
  s += 0.5 * Math.max(0, b.average - 0.97); // a breather, not a gimme
  return s;
}
function redress(L, secs, freshGeo = false) {
  const base = spec4(L);
  const geo = freshGeo ? null : geoOf(L);
  const caps = [L.cap, Math.min(5, L.cap + 1)].filter((c, i, a) => a.indexOf(c) === i);
  const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
  let best = null, tried = 0, valid = 0;
  const fails = {};
  for (let k = 0; el() < secs; k++) {
    const cap = caps[k % caps.length], jm = JITS[(k >> 1) % JITS.length];
    const seed = ((L.id * 15485863 + k * 104729 + (freshGeo ? 7777 : 41)) >>> 0);
    tried++;
    const spec = { ...base, cap, jitter: base.jitter * jm, par: [1, Math.min(cap - 1, 3)] };
    const o = G.tryLevel(spec, seed, null, geo);
    if (o.fail) { fails[o.fail] = (fails[o.fail] || 0) + 1; continue; }
    if (freshGeo && o.level.strands.length !== L.strands.length) { fails.n = (fails.n || 0) + 1; continue; }
    valid++;
    const q = R.botStats(o.puz, 'average', 120, seed + 3).winRate;
    if (q < 0.78) { fails.screen = (fails.screen || 0) + 1; continue; }
    const qc = R.botStats(o.puz, 'casual', 120, seed + 2).winRate;
    if (qc < 0.5) { fails.screenC = (fails.screenC || 0) + 1; continue; }
    const ex = R.botStats(o.puz, 'expert', 150, seed + 4).winRate;
    if (ex < 1) { fails.expert = (fails.expert || 0) + 1; continue; }
    o.puz.par = o.level.par;
    const b = measure(o.puz, seed, 300);
    const sc = reliefScore(b, L.cap, cap);
    if (!best || sc < best.sc) { best = { o, b, sc, seed, cap, jm }; if (sc < 0.05 && el() > secs * 0.3) break; }
  }
  return { best, tried, valid, fails, secs: el() };
}

// ------------------------------------------------------------------ stats stamp (tune3 field set + v4 provenance)
function stamp(L, { seed, jit, how, sol }) {
  const puz = R.buildPuzzle(L); puz.par = L.par;
  const fin = measure(puz, 31337 + L.id * 17, 1000), f = fin.full;
  const old = L.stats || {};
  L.stats = {
    v: 4, seed: seed ?? old.seed, jit: jit ?? old.jit, crossings: puz.crossings.length, exact: sol.exact, states: sol.states,
    random: +fin.random.toFixed(3), tap: +fin.tap.toFixed(3), casual: +fin.casual.toFixed(3), average: +fin.average.toFixed(3), expert: +fin.expert.toFixed(3),
    avgPeak: { casual: f.casualS.avgPeak == null ? null : +f.casualS.avgPeak.toFixed(2), expert: f.expertS.avgPeak == null ? null : +f.expertS.avgPeak.toFixed(2), average: f.averageS.avgPeak == null ? null : +f.averageS.avgPeak.toFixed(2) },
    stars: { casual: f.casualS.stars, average: f.averageS.stars, expert: f.expertS.stars }, runs: 1000, free0: old.free0,
    opt: sol.peak, fix3: how, ...(old.aim != null ? { aim: old.aim } : {}),
  };
  return L;
}
function solveOf(L) { const r = R.solve(R.buildPuzzle(L), null, 600000); return r; }

function savePart(L) {
  mkdirSync(PARTS, { recursive: true });
  const p = join(PARTS, `L${String(L.id).padStart(2, '0')}.json`);
  const tmp = p + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(L)); renameSync(tmp, p);
}
const partOf = id => { const p = join(PARTS, `L${String(id).padStart(2, '0')}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const ids = a => a.split(',').flatMap(x => { const [p, q] = x.split('-').map(Number); return q ? Array.from({ length: q - p + 1 }, (_, i) => p + i) : [p]; });
const okRelief = c => c.average >= RELIEF.average && c.casual >= RELIEF.casual;

// key order as tune3 flag(): id, name, world, cols, rows, cap, shape, intro, knot, then the rest
function ordered(L) {
  const { id, name, world, cols, rows, cap, shape, intro, knot, ...rest } = L;
  return { id, name, world, cols, rows, cap, shape, ...(intro ? { intro } : {}), ...(knot ? { knot } : {}), ...rest };
}

const [cmd, a1, a2] = process.argv.slice(2).filter(x => x !== '--lib');
if (cmd === 'table') {
  const src = a1 === 'parts' ? LEVELS.map(L => partOf(L.id) || L) : LEVELS;
  const bands = {};
  for (const L of src) {
    if (L.id < 11) continue;
    const c = critic(L);
    console.log(`L${L.id} cap ${L.cap} par ${L.par} avg ${c.average.toFixed(2)} cas ${c.casual.toFixed(2)} g3 ${c.g3.toFixed(2)}${BREATHER.has(L.id) ? ' [breather]' : ''}${isKnot(L) ? ' [knot]' : ''}`);
    const b = Math.floor((L.id - 1) / 10); (bands[b] = bands[b] || []).push(c);
  }
  for (const [b, rs] of Object.entries(bands)) console.log(`band L${b * 10 + 1}-${b * 10 + 10}: avg ${(rs.reduce((s, r) => s + r.average, 0) / rs.length).toFixed(3)} g3 ${(rs.reduce((s, r) => s + r.g3, 0) / rs.length).toFixed(3)}`);
} else if (cmd === 'relief') {
  const secs = +(a2 || 60);
  for (const id of ids(a1)) {
    const L0 = LEVELS[id - 1];
    if (!BREATHER.has(id) || isKnot(L0)) { console.log(`L${id}: not a breather, skipped`); continue; }
    const before = critic(L0);
    let out = null;
    // 1) same board, cap + 1
    if (L0.cap < 5) {
      const L = JSON.parse(JSON.stringify(L0)); L.cap = L0.cap + 1;
      const sol = solveOf(L);
      const c = critic(L);
      const puz = R.buildPuzzle(L); puz.par = L.par;
      const m = measure(puz, 777 + id, 1000);
      console.log(`  L${id} cap+1: opt ${sol.peak} (par ${L0.par}) critic avg ${pct(c.average)} cas ${pct(c.casual)} | 1000: avg ${pct(m.average)} cas ${pct(m.casual)} exp ${pct(m.expert)}`);
      if (sol.exact && sol.peak === L0.par && okRelief(c) && m.average >= 0.86 && m.casual >= 0.61 && m.expert >= 0.999) out = stamp(L, { how: 'relief:cap+1', sol });
    }
    // 2) re-dress the kept geometry; 3) fresh geometry from the same spec
    for (const fresh of [false, true]) {
      if (out) break;
      const res = redress(L0, fresh ? secs * 1.5 : secs, fresh);
      if (!res.best) { console.log(`  L${id} ${fresh ? 'fresh' : 'redress'}: no candidate`, res.tried, JSON.stringify(res.fails)); continue; }
      const L = res.best.o.level;
      // keep the shipped identity / flags / name / world
      L.id = id; L.name = L0.name; L.world = L0.world; if (L0.intro) L.intro = L0.intro; delete L.knot;
      const sol = solveOf(L);
      if (!sol.exact || sol.peak !== L.par) { console.log(`  L${id}: re-solve mismatch`, sol.peak, L.par); continue; }
      const c = critic(L);
      const puz = R.buildPuzzle(L); puz.par = L.par;
      const m = measure(puz, 777 + id, 1000);
      console.log(`  L${id} ${fresh ? 'fresh' : 'redress'} cap ${L.cap} par ${L.par} sc ${res.best.sc.toFixed(3)}: critic avg ${pct(c.average)} cas ${pct(c.casual)} g3 ${pct(c.g3)} | 1000: avg ${pct(m.average)} cas ${pct(m.casual)} exp ${(m.expert * 100).toFixed(1)} [${res.valid}/${res.tried} ${res.secs.toFixed(0)}s] ${JSON.stringify(res.fails)}`);
      if (okRelief(c) && m.average >= 0.85 && m.casual >= 0.6 && m.expert >= 0.999) out = stamp(L, { seed: res.best.seed, jit: res.best.jm, how: fresh ? 'relief:fresh' : 'relief:redress', sol });
    }
    if (!out) { console.log(`L${id}: MISS (kept as is)`); continue; }
    const after = critic(out);
    console.log(`L${id} OK ${out.stats.fix3}: cap ${L0.cap}->${out.cap} par ${L0.par}->${out.par} avg ${pct(before.average)}->${pct(after.average)} cas ${pct(before.casual)}->${pct(after.casual)} g3 ${pct(before.g3)}->${pct(after.g3)}`);
    savePart(ordered(out));
  }
} else if (cmd === 'par') {
  for (const id of ids(a1)) {
    if (id < 23) continue;
    const L = JSON.parse(JSON.stringify(partOf(id) || LEVELS[id - 1]));
    const sol = solveOf(L);
    const opt = sol.peak;
    const puz = R.buildPuzzle(L);
    const h = peakHist(puz, 1000, 4242 + id), hc = (() => { const r = R.rng(11), hist = new Array(6).fill(0); for (let i = 0; i < 300; i++) { const o = R.botRun(puz, 'average', r); if (o.win) hist[o.peak]++; } return { hist, runs: 300 }; })();
    const cur = share(hc, L.par);
    // a 'keep' re-dress was made for this pass, so it is held to the 0.15 aim rather than the 0.10 trigger
    const kept = L.stats && /^keep/.test(L.stats.fix3 || '');
    if (cur >= (kept ? 0.15 : 0.10)) { console.log(`L${id} par ${L.par} g3 ${pct(cur)}: fine`); continue; }
    const boss = BOSS.has(id), want = boss ? 0.08 : 0.15;
    let pick = null;
    for (let p = Math.max(opt, L.par); p <= L.cap - 1; p++) if (share(h, p) >= want && share(hc, p) >= want) { pick = p; break; }
    // fallback: the largest par below cap that clears the 0.10 trigger floor on the 1000-run sample (and 0.08 on the
    //   300-run critic sample); non-boss only. Lands L35 (rainbow intro) and L38 (mini knot) at ~0.11-0.13.
    if (pick == null && !boss) for (let p = L.cap - 1; p >= Math.max(opt, L.par); p--) if (share(h, p) >= 0.10 && share(hc, p) >= 0.08) { pick = p; break; }
    const row = [...Array(L.cap).keys()].map(p => `${p}:${pct(share(h, p))}`).join(' ');
    if (pick == null) { console.log(`L${id} par ${L.par} (opt ${opt}, cap ${L.cap}) g3 ${pct(cur)}: NO PAR < cap reaches ${pct(want)} [${row}]`); continue; }
    console.log(`L${id} par ${L.par}->${pick} (opt ${opt}, cap ${L.cap}) g3 ${pct(cur)}->${pct(share(hc, pick))} (1000-run ${pct(share(h, pick))}) [${row}]`);
    L.par = pick;
    const how = (L.stats && L.stats.fix3 ? L.stats.fix3 + ',' : '') + 'par:+' + (pick - opt);
    savePart(ordered(stamp(L, { how, sol })));
  }
} else if (cmd === 'keep') {
  // DECISION (fix3): a non-knot L23-L60 level whose greedy bot ends every win at a full basket (no par below cap can
  //   reach 3 stars) is re-dressed on its kept geometry at the SAME difficulty (greedy / casual / random win rates held
  //   near the shipped values) so that a par below cap gives the greedy bot 0.15-0.35 3-star share; run 'par' after.
  const secs = +(a2 || 60);
  for (const id of ids(a1)) {
    const L0 = LEVELS[id - 1];
    // KK4_KNOT=1 allows a boss / mini (an experiment: write those parts to a separate KK4_PARTS dir; not merged in fix3)
    if ((isKnot(L0) && !process.env.KK4_KNOT) || BREATHER.has(id) || id < 23) { console.log(`L${id}: skipped (knot / breather / early)`); continue; }
    const p0 = R.buildPuzzle(L0); p0.par = L0.par;
    const b0 = measure(p0, 999 + id, 1000);
    const base = spec4(L0), geo = geoOf(L0);
    const t0 = Date.now(), el = () => (Date.now() - t0) / 1000;
    let best = null, tried = 0;
    for (let k = 0; el() < secs; k++) {
      const jm = JITS[(k >> 1) % JITS.length], seed = ((id * 2654435761 + k * 104729 + 99) >>> 0);
      tried++;
      const o = G.tryLevel({ ...base, cap: L0.cap, jitter: base.jitter * jm, par: [1, Math.min(L0.cap - 1, 4)] }, seed, null, geo);
      if (o.fail) continue;
      const q = R.botStats(o.puz, 'average', 120, seed + 3).winRate;
      if (Math.abs(q - b0.average) > 0.15) continue;
      if (R.botStats(o.puz, 'expert', 150, seed + 4).winRate < 1) continue;
      o.puz.par = o.level.par;
      const b = measure(o.puz, seed, 300), h = peakHist(o.puz, 300, seed + 9);
      let g3 = 0;
      for (let p = o.level.par; p <= L0.cap - 1; p++) { const v = share(h, p); if (v <= 0.35) g3 = Math.max(g3, v); }
      const band = x => Math.max(0, Math.abs(x) - 0.04);
      const sc = 16 * band(b.average - b0.average) + 8 * Math.max(0, Math.abs(b.casual - b0.casual) - 0.08) + 4 * band(b.random - b0.random) + 60 * (1 - b.expert) + 10 * Math.max(0, 0.18 - g3);
      if (!best || sc < best.sc) { best = { o, b, sc, seed, jm, g3 }; if (sc < 0.05 && el() > secs * 0.3) break; }
    }
    if (!best) { console.log(`L${id}: keep: no candidate`); continue; }
    const L = best.o.level;
    L.id = id; L.name = L0.name; L.world = L0.world; if (L0.intro) L.intro = L0.intro; delete L.knot;
    const sol = solveOf(L);
    const c0 = critic(L0), c = critic(L);
    console.log(`L${id} keep sc ${best.sc.toFixed(3)} par ${L0.par}->${L.par} (opt) | avg ${pct(b0.average)}->${pct(best.b.average)} cas ${pct(b0.casual)}->${pct(best.b.casual)} rnd ${pct(b0.random)}->${pct(best.b.random)} best-par g3 ${pct(best.g3)} | critic avg ${pct(c0.average)}->${pct(c.average)} cas ${pct(c0.casual)}->${pct(c.casual)} [${tried} tried]`);
    if (best.sc > 1.5) { console.log(`L${id}: keep MISS (score), not saved`); continue; }
    savePart(ordered(stamp(L, { seed: best.seed, jit: best.jm, how: 'keep:redress', sol })));
  }
} else if (cmd === 'merge') {
  const parts = existsSync(PARTS) ? readdirSync(PARTS).filter(f => /^L\d\d\.json$/.test(f)) : [];
  const byId = new Map(parts.map(f => { const L = JSON.parse(readFileSync(join(PARTS, f), 'utf8')); return [L.id, L]; }));
  const lv = LEVELS.map(L => byId.get(L.id) || L);
  const head = '// Generated by tools/knot-kitty/gen.mjs, retuned by tools/knot-kitty/tune3.mjs (difficulty v3) and tools/knot-kitty/tune4.mjs (fix3: breathers + 3-star par). Do not edit by hand; check.mjs re-verifies.\n'
    + '// Level flags for the UI: intro = the one new idea the level brings in; knot = \'mini\' (Hard) | \'boss\' (Super Hard), the TOUGH KNOT banner.\n'
    + '// par = the 3-star line (basket peak <= par). stats.opt, when present, is the solver-optimal peak (par may sit above it, below cap).\n';
  const p = join(GAME, 'levels-data.js'), tmp = p + '.tmp';
  writeFileSync(tmp, head + 'export default [\n' + lv.map(l => JSON.stringify(l)).join(',\n') + '\n];\n'); renameSync(tmp, p);
  console.log('merged', byId.size, 'parts:', [...byId.keys()].sort((a, b) => a - b).join(','));
} else console.log('usage: table [parts] | relief <ids> [secs] | keep <ids> [secs] | par <ids> | merge');
