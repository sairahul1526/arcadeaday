// Knot Kitty level checker. Run from the repo root: node tools/knot-kitty/check.mjs [--quick]
// Re-solves every level + daily, re-runs bots (100 runs), asserts schema, strand budget, colour rules,
// twist constraints, geometry gates and par/sol validity. Exits 1 on any failure.
// fix2: also verifies bonus-data.js (Bonus Tangles): same gates as a daily board, exact solve, par/sol replay, geometry
//   distinct from every campaign level, daily board and other bonus board (any mirror), >= 30 boards, and getBonus()
//   serving board i for i < count and the daily remix after it.
// fix3: par may be raised above the solver optimum (tune4.mjs 'par'); then stats.opt holds the optimum, the solver and the
//   sol line must hit stats.opt exactly, and opt <= par < cap.
import LEVELS from '../../games/knot-kitty/levels-data.js';
import DAILIES from '../../games/knot-kitty/dailies-data.js';
import BONUS from '../../games/knot-kitty/bonus-data.js';
import { buildPuzzle, initState, canPull, pull, isWon, solve, botStats, transformLevel } from '../../games/knot-kitty/rules.js';
import { getLevel, getDaily, getBonus, dailyIndex, istDateKey, LEVEL_COUNT, BONUS_COUNT } from '../../games/knot-kitty/levels.js';

const RAINBOW = 6;
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const quick = process.argv.includes('--quick');

function checkLevel(L, where, { daily = false } = {}) {
  for (const k of ['name', 'cols', 'rows', 'cap', 'strands', 'queue', 'par', 'sol', 'stats']) if (L[k] === undefined) fail(where, 'missing ' + k);
  if (!('shape' in L)) fail(where, 'missing shape');
  const n = L.strands.length;
  const boss = L.id % 10 === 0 || daily;
  if (n > 28 || n > (boss ? 26 : 24)) fail(where, `strand budget ${n}`);
  // fix2: campaign bosses (enlarged silhouettes) must hold at least 18 strands
  if (!daily && L.id % 10 === 0 && n < 18) fail(where, `boss holds only ${n} strands (< 18)`);
  if (L.cols < 4 || L.cols > 8 || L.rows < 4 || L.rows > 10) fail(where, `board ${L.cols}x${L.rows}`);
  if (L.cap < 3 || L.cap > 5) fail(where, 'cap ' + L.cap);
  // pegs
  const pegs = [];
  for (const [i, s] of L.strands.entries()) {
    if (s.pegs.length < 2 || s.pegs.length > 4) fail(where, `strand ${i} has ${s.pegs.length} pegs`);
    if (Math.abs(s.bow || 0) > 0.12 + 1e-9) fail(where, `strand ${i} bow ${s.bow}`);
    for (const [x, y] of s.pegs) {
      if (x < 0 || y < 0 || x > L.cols - 1 || y > L.rows - 1 || (x * 2) % 1 || (y * 2) % 1) fail(where, `strand ${i} peg ${x},${y}`);
      pegs.push([x, y]);
    }
  }
  for (let a = 0; a < pegs.length; a++) for (let b = a + 1; b < pegs.length; b++)
    if (Math.hypot(pegs[a][0] - pegs[b][0], pegs[a][1] - pegs[b][1]) < 0.9 - 1e-9) { fail(where, 'pegs closer than 0.9'); a = pegs.length; break; }
  // colours
  const cnt = {};
  for (const s of L.strands) cnt[s.c] = (cnt[s.c] || 0) + 1;
  const colours = Object.keys(cnt).map(Number).filter(c => c !== RAINBOW);
  const rainbow = cnt[RAINBOW] || 0;
  const maxCol = !daily && L.id < 21 ? 4 : 5;
  if (colours.length > maxCol) fail(where, `${colours.length} colours`);
  if (!daily && L.id <= 20 && colours.some(c => c > 3)) fail(where, 'colour outside {0,1,2,3} before L21');
  if (!daily && L.id < 31 && ((cnt[0] && cnt[4]) || (cnt[1] && cnt[5]))) fail(where, 'near colours together before L31');
  const sizes = {};
  for (const e of L.queue) { const c = typeof e === 'number' ? e : e.c, sz = typeof e === 'number' ? 3 : e.n; sizes[c] = (sizes[c] || 0) + sz; }
  let deficit = 0;
  for (const c of new Set([...colours, ...Object.keys(sizes).map(Number)])) {
    const d = (sizes[c] || 0) - (cnt[c] || 0);
    if (d < 0) fail(where, `colour ${c}: ${cnt[c]} strands but spools hold ${sizes[c] || 0}`);
    deficit += Math.max(0, d);
  }
  if (deficit !== rainbow) fail(where, `colour/spool totals off (deficit ${deficit}, rainbow ${rainbow})`);
  // puzzle + geometry
  const puz = buildPuzzle(L);
  const pairSeen = new Set();
  for (const x of puz.crossings) {
    if (x.ang < 38 - 1e-6) fail(where, `crossing angle ${x.ang.toFixed(1)}`);
    const k = Math.min(x.top, x.under) + ',' + Math.max(x.top, x.under);
    if (pairSeen.has(k)) fail(where, `strands ${k} cross twice`);
    pairSeen.add(k);
  }
  if ((daily || L.id >= 6) && puz.crossings.length < Math.round(0.6 * n)) fail(where, `crossings ${puz.crossings.length} < minX`);
  // twists
  for (const [a, b] of L.knots || []) if (!pairSeen.has(Math.min(a, b) + ',' + Math.max(a, b))) fail(where, `knot ${a},${b} does not cross`);
  const myst = L.strands.filter(s => s.m).length;
  if (myst > Math.floor(0.3 * n)) fail(where, `mystery ${myst} > 30%`);
  for (const [i, s] of L.strands.entries()) {
    if (s.paw && (s.paw < 3 || s.paw > Math.max(4, Math.floor(n / 2)))) fail(where, `paw N ${s.paw} on strand ${i}`);
    if (s.lock !== undefined && !L.strands.some(t => t.key === s.lock)) fail(where, `lock ${s.lock} without key`);
  }
  if (L.ice && ![2, 3].includes(L.ice.thaw)) fail(where, 'ice thaw ' + L.ice.thaw);
  // solve
  const r = solve(puz, null, 600000);
  if (!r.exact) fail(where, 'solver aborted');
  // fix3: par is the 3-star line; it may sit above the solver optimum (stats.opt, tune4 'par') but stays below cap
  const opt = L.stats && L.stats.opt != null ? L.stats.opt : L.par;
  if (r.peak !== opt) fail(where, `${opt === L.par ? 'par' : 'stats.opt'} ${opt} but solver says ${r.peak}`);
  if (L.par < opt || (L.par !== opt && L.par >= L.cap)) fail(where, `par ${L.par} outside [opt ${opt}, cap ${L.cap})`);
  // sol replay
  const st = initState(puz);
  for (const id of L.sol) {
    const c = canPull(puz, st, id);
    if (!c.ok) { fail(where, `sol move ${id} illegal (${c.why})`); break; }
    pull(puz, st, id);
  }
  if (!isWon(puz, st)) fail(where, 'sol does not win');
  else if (st.peak !== opt) fail(where, `sol peak ${st.peak} != optimum ${opt}`);
  // bots
  puz.par = L.par;
  const bots = {};
  if (!quick) for (const k of ['random', 'casual', 'average', 'expert']) bots[k] = botStats(puz, k, 100, 4242);
  if (!quick && bots.expert.winRate === 0) fail(where, 'expert bot never wins');
  return { puz, bots };
}

const t0 = Date.now();
const rows = [];
if (LEVELS.length !== LEVEL_COUNT) fail('levels-data', `${LEVELS.length} levels, want ${LEVEL_COUNT}`);
LEVELS.forEach((L, i) => {
  if (L.id !== i + 1) fail('levels-data', `index ${i} has id ${L.id}`);
  const { puz, bots } = checkLevel(L, 'L' + L.id);
  rows.push(['L' + L.id, puz.n, puz.crossings.length, L.par, bots]);
  const g = getLevel(L.id);
  if (!Object.isFrozen(g) || g.par !== L.par) fail('L' + L.id, 'getLevel copy wrong');
});
if (DAILIES.length !== 60) fail('dailies-data', `${DAILIES.length} boards, want 60`);
DAILIES.forEach((D, i) => {
  const { puz, bots } = checkLevel(D, 'D' + i, { daily: true });
  rows.push(['D' + i, puz.n, puz.crossings.length, D.par, bots]);
});
// daily transform keeps par and stays solvable (sample dates)
if (DAILIES.length) {
  const keys = ['2026-10-16', '2026-10-17', '2026-11-02', '2027-01-01', istDateKey()];
  for (const k of keys) {
    const L = getDaily(k), { i } = dailyIndex(k);
    const p = buildPuzzle(L);
    const r = solve(p, null, 600000);
    if (r.peak !== DAILIES[i].par) fail('daily ' + k, `transformed par ${r.peak} != ${DAILIES[i].par}`);
    if (p.crossings.length !== buildPuzzle(DAILIES[i]).crossings.length) fail('daily ' + k, 'transform changed crossings');
    if (L.id !== 0 || L.name !== 'Daily Knot') fail('daily ' + k, 'id/name');
  }
  const b = getBonus(3);
  if (b.name !== 'Bonus Tangle 4') fail('bonus', 'name');
}
// bonus tangles (fix2)
const geoKeys = (L) => { const out = []; for (const mx of [0, 1]) for (const my of [0, 1]) out.push(L.strands.map(s => s.pegs.map(([x, y]) => (mx ? L.cols - 1 - x : x) + ',' + (my ? L.rows - 1 - y : y)).sort().join('|')).sort().join(';')); return out; };
const seenGeo = new Map();
for (const L of LEVELS) for (const k of geoKeys(L)) seenGeo.set(k, 'L' + L.id);
DAILIES.forEach((D, i) => { for (const k of geoKeys(D)) if (!seenGeo.has(k)) seenGeo.set(k, 'D' + i); });
if (BONUS.length < 30 || BONUS.length > 60) fail('bonus-data', `${BONUS.length} boards, want 30..60`);
if (BONUS_COUNT !== BONUS.length) fail('bonus-data', 'BONUS_COUNT mismatch');
BONUS.forEach((B, i) => {
  const where = 'B' + i;
  const { puz, bots } = checkLevel(B, where, { daily: true });
  rows.push([where, puz.n, puz.crossings.length, B.par, bots]);
  const k0 = geoKeys(B)[0];
  if (seenGeo.has(k0)) fail(where, 'geometry repeats ' + seenGeo.get(k0));
  for (const k of geoKeys(B)) if (!seenGeo.has(k)) seenGeo.set(k, where);
  if (!B.stats || !B.stats.exact) fail(where, 'not exactly solved at generation');
  if (i && !(B.bonus > BONUS[i - 1].bonus)) fail(where, 'out of ramp order (generator index not increasing)');
  const g = getBonus(i);
  if (g.par !== B.par || g.name !== 'Bonus Tangle ' + (i + 1) || g.bonus !== i || JSON.stringify(g.strands) !== JSON.stringify(B.strands)) fail(where, 'getBonus copy wrong');
});
{
  const g = getBonus(BONUS.length), P = DAILIES;
  if (g.name !== 'Bonus Tangle ' + (BONUS.length + 1) || !P.length || buildPuzzle(g).n !== P[(BONUS.length % 60) % P.length].strands.length) fail('bonus', 'fallback remix after the generated boards');
}
const pct = x => (x ? String(Math.round(x.winRate * 100)).padStart(3) : '  –');
for (const [id, n, x, par, b] of rows) console.log(`${id.padEnd(4)} n ${String(n).padStart(2)} x ${String(x).padStart(2)} par ${par} | rnd ${pct(b.random)} cas ${pct(b.casual)} avg ${pct(b.average)} exp ${pct(b.expert)}`);
console.log(`\nchecked ${LEVELS.length} levels + ${DAILIES.length} dailies + ${BONUS.length} bonus boards in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (errors.length) { console.error(`\nFAIL (${errors.length}):\n` + errors.join('\n')); process.exit(1); }
console.log('PASS');
