// Knot Kitty curve report (fix round 5). Run from the repo root:
//   node tools/knot-kitty/curve5.mjs [levels-data.js path] [--runs 300] [--json out.json] [--ids 40-60]
// Per level: average / casual / expert bot win (botStats, seed 11 = the critics' setting), average-bot 3-star share,
// decision turns per level (the r3 mobile-designer metric: turns with no single non-rainbow strand that winds straight
// onto an active spool, averaged over 25 random win-safe paths on the exact solver), strands, cap, par, mechanics.
import * as R from '../../games/knot-kitty/rules.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const file = args.find(a => /\.m?js$/.test(a)) || 'games/knot-kitty/levels-data.js';
const RUNS = +(arg('--runs') || 300);
const LEVELS = (await import(pathToFileURL(resolve(file)).href)).default;
const idf = arg('--ids');
const want = idf ? new Set(idf.split(',').flatMap(x => { const [p, q] = x.split('-').map(Number); return q ? Array.from({ length: q - p + 1 }, (_, i) => p + i) : [p]; })) : null;
const RAINBOW = 6;
export function decisions(L, reps = 25) {
  const puz = R.buildPuzzle(L); puz.par = L.par;
  const S = R.makeSolver(puz, 1500000);
  const v = S.f(R.initState(puz));
  if (S.aborted) return null;
  const r = R.rng(L.id * 7 + 1);
  let turns = 0, d = 0, runs = 0, trap = 0, opts = 0;
  for (let rep = 0; rep < reps; rep++) {
    const st = R.initState(puz); let g = 0;
    while (st.removed !== puz.full && g++ < 100) {
      const lg = R.legalMoves(puz, st); if (!lg.length) break;
      const fit = lg.filter(id => puz.members[id].length === 1 && puz.strands[id].c !== RAINBOW && R.slotFor(st, puz.strands[id].c) >= 0);
      turns++;
      if (fit.length) { R.pull(puz, st, fit[0]); continue; }
      const os = lg.map(id => { const s0 = R.cloneState(st); s0.peak = s0.bt; const s2 = R.pull(puz, s0, id); if (s2.dead) return { w: false, s2 }; return { w: Math.max(s2.peak, S.f(s2)) < Infinity, s2 }; });
      d++; opts += lg.length;
      const good = os.filter(o => o.w); if (good.length < lg.length) trap++;
      if (!good.length) break;
      const pick = good[(r() * good.length) | 0];
      const pk = Math.max(st.peak, pick.s2.peak); Object.assign(st, R.cloneState(pick.s2)); st.peak = pk;
    }
    runs++;
  }
  return { dec: d / runs, opts: d ? opts / d : 0, trap: d ? trap / d : 0, opt: v };
}
export function mech(L) {
  const m = [];
  if (L.knots && L.knots.length) m.push('knot' + L.knots.length);
  const lk = L.strands.filter(s => s.lock !== undefined).length; if (lk) m.push('lock' + lk);
  const my = L.strands.filter(s => s.m).length; if (my) m.push('myst' + my);
  const pw = L.strands.filter(s => s.paw).length; if (pw) m.push('paw' + pw);
  if (L.strands.some(s => s.c === RAINBOW)) m.push('rainbow');
  if (L.queue.some(e => typeof e === 'object')) m.push('jumbo');
  if (L.ice) m.push('ice' + L.ice.thaw);
  return m;
}
export function row(L, runs = RUNS) {
  const puz = R.buildPuzzle(L); puz.par = L.par;
  const a = R.botStats(puz, 'average', runs, 11), c = R.botStats(puz, 'casual', runs, 11), e = R.botStats(puz, 'expert', runs, 11);
  const dd = decisions(L);
  return { id: L.id, n: L.strands.length, cap: L.cap, par: L.par, avg: a.winRate, cas: c.winRate, exp: e.winRate, g3: a.stars[3] / runs, dec: dd ? dd.dec : null, opts: dd ? dd.opts : null, trap: dd ? dd.trap : null, mech: mech(L).join('+'), cols: new Set(L.strands.map(s => s.c).filter(c => c !== RAINBOW)).size };
}
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const rows = [];
  const f2 = x => (x == null ? ' –  ' : x.toFixed(2));
  for (const L of LEVELS) {
    if (want && !want.has(L.id)) continue;
    const o = row(L); rows.push(o);
    console.log(`L${String(o.id).padStart(2)} n ${String(o.n).padStart(2)} col ${o.cols} cap ${o.cap} par ${o.par} | avg ${f2(o.avg)} cas ${f2(o.cas)} exp ${f2(o.exp)} 3* ${f2(o.g3)} | dec ${o.dec == null ? '–' : o.dec.toFixed(1)} opts ${o.opts == null ? '–' : o.opts.toFixed(1)} trap ${o.trap == null ? '–' : o.trap.toFixed(2)} | ${o.mech}`);
  }
  const bands = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]];
  console.log('\nband    avg   cas   exp   3*    dec   strands  min-avg(non-boss)');
  for (const [p, q] of bands) {
    const rs = rows.filter(o => o.id >= p && o.id <= q); if (!rs.length) continue;
    const m = k => rs.reduce((s, o) => s + (o[k] ?? 0), 0) / rs.length;
    const nb = rs.filter(o => o.id % 10); const mn = nb.length ? Math.min(...nb.map(o => o.avg)) : NaN;
    console.log(`L${p}-${q}`.padEnd(8), [m('avg'), m('cas'), m('exp'), m('g3')].map(x => x.toFixed(2)).join('  '), ' ', m('dec').toFixed(1), '  ', m('n').toFixed(1), '   ', mn.toFixed(2));
  }
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(rows));
}
