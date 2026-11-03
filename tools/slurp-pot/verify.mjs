// Slurp Pot level verifier (GDD §5.3, §4.2). Levels role.
// Usage: node tools/slurp-pot/verify.mjs [1-10] [--runs 100] [--write] [--daily 400] [--kindmax] [--quiet]
//   range     levels to check (default 1-10); 'rec' checks the REC level only
//   --runs    casual / average / expert runs per level (GDD: 100)
//   --write   writes spec.stats for the checked levels and kindMax into games/slurp-pot/levels-data.js
//   --daily N also checks N days × 3 variants of the Daily Order (static gates 5, 6, greedy gate 1, casual ≥ 80 %)
//   --kindmax recomputes kindMax only (implied by --write)
// Exit code 1 when any checked level fails a gate. Report: studio/2026-11-03/levels/levels-report.txt.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as L from '../../games/slurp-pot/logic.js';
import * as B from '../../games/slurp-pot/bots.js';
import { KIND, SURF, CONTRAST_MIN } from '../../games/slurp-pot/catalog.js';
import { SPECS, REC, kindMax as KM_OLD } from '../../games/slurp-pot/levels-data.js';
import { K_ING, ITEM_MAX, DAILY_START, STAR3 } from '../../games/slurp-pot/consts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_PATH = join(ROOT, 'games/slurp-pot/levels-data.js');
export const REPORT_PATH = join(ROOT, 'studio/2026-11-03/levels/levels-report.txt');
const F = L.F;

/** Writes games/slurp-pot/levels-data.js: one spec per line (JSON is valid JS), then REC and kindMax. */
export function writeLevelsData(path, specs, rec, kindMax) {
  const out = [];
  out.push('// Slurp Pot level specs (GDD §4.4, §5). Levels role. Written by tools/slurp-pot/verify.mjs and tune.mjs');
  out.push('// (writeLevelsData): one spec per line. levels.js expands a spec with genLevel(spec, spec.seed).');
  out.push('// Spec: { n, name, town, arch, W, D, seed, r0, T, items, mix [T0..T4 %], margin [lo, hi], tickets: [{ lines:');
  out.push('// [{ kind, need, place?, spare?, at? }], boss: { kind, a } }], twist: { pens, nested, walls, lanes, islands,');
  out.push('// gulls, cap, cake, truck }, gateR?, timed?, bossDist?, rings?, goal: { T, greedy, casual } (§4.4 table),');
  out.push('// seed0?, marginBand?, stats? }. tune.mjs picks seed (seed0 + 7919·bump), T (goal.T ± 15 %) and margin (inside');
  out.push('// the §4.2 band kept in marginBand); stats = the confirm run (verify.mjs, 100 runs per human bot) at that T.');
  out.push('export const SPECS = [');
  for (const s of specs) out.push('  ' + JSON.stringify(s) + ',');
  out.push('];');
  out.push('');
  out.push('// The REC level (§12.1): Picnic Blanket Path, r0 0.14, Birthday Cake boss, timer hidden.');
  out.push('export const REC = ' + JSON.stringify(rec) + ';');
  out.push('');
  out.push('// Render pool sizes (D25): per kind, the max count over L1–L60, the dailies, REC and the Feast cap.');
  out.push('export const kindMax = ' + JSON.stringify(kindMax) + ';');
  out.push('');
  writeFileSync(path, out.join('\n'));
}

// ------------------------------------------------------------------ targets (§5.1, §4.4)
/** Band rules for level n: floors and ranges used by gates 2–4. */
export function bandOf(n) {
  if (n <= 3) return { avg: [100, 99, 85][n - 1], exp: 100, plan: null, avg3: null, cas3: null };
  if (n <= 7) return { avg: 80, exp: 98, plan: 0.88, avg3: [20, 45], cas3: 15 };
  if (n <= 20) return { avg: 75, exp: 97, plan: 0.80, avg3: [15, 40], cas3: 15 };
  if (n <= 40) return { avg: 72, exp: 96, plan: 0.78, avg3: [15, 35], cas3: 15 };
  return { avg: 70, exp: 95, plan: 0.76, avg3: [15, 30], cas3: 15 };
}
/** Greedy share-of-T window (gate 2): table % ± 4; from L10 also inside 70–85 % (bakeoff call). */
export function greedyWindow(spec) {
  const g = spec.goal && spec.goal.greedy;
  if (!g) return null;
  let lo = g - 4, hi = g + 4;
  if (spec.n >= 10) { lo = Math.max(lo, 70); hi = Math.min(hi, 85); }
  return [lo, hi];
}

// ------------------------------------------------------------------ static gates (§4.2) on an expanded level
const isWall = it => (it.flags & (F.WALL | F.GATE)) !== 0;
const isBoss = it => (it.flags & F.BOSS) !== 0;
// Expanded surfaces carry only `color`; their luminance comes from the town palette (catalog SURF).
function lumOf(town, color) {
  const P = SURF[town], all = [P.ground, P.path, P.rug, P.deck, P.water, ...(P.blanket || []), ...(P.gingham || [])].filter(Boolean);
  const e = all.find(q => q.color.toLowerCase() === String(color).toLowerCase());
  return e ? e.lum : NaN;
}
function surfUnder(lv, it) {
  const m = it.a * 0.6;
  for (let i = lv.surfaces.length - 1; i >= 0; i--) {
    const s = lv.surfaces[i];
    if (Math.abs(it.x - s.x) <= s.w / 2 - m + 2e-3 && Math.abs(it.z - s.z) <= s.d / 2 - m + 2e-3) return s;   // + output rounding
  }
  return null;
}
/** Contrast of a T0/T1 item where it sits (§4.2 + D33 gingham rule, same as levels.js groundOK). */
export function contrastPass(lv, it) {
  const k = KIND[it.kind];
  if (!k || k.tier > 1 || isWall(it) || isBoss(it)) return true;
  const s = surfUnder(lv, it);
  if (s) return Math.abs(k.lum - lumOf(lv.town, s.color)) >= CONTRAST_MIN;
  const g = SURF[lv.town].gingham;
  if (!g) return Math.abs(k.lum - SURF[lv.town].ground.lum) >= CONTRAST_MIN;
  if (k.hue <= 30 || k.hue >= 340) return false;
  const W = [0.25, 0.5, 0.25];
  let w = 0;
  for (let i = 0; i < g.length; i++) if (Math.abs(k.lum - g[i].lum) >= CONTRAST_MIN) w += W[i];
  return w >= 0.5 - 1e-9;
}
// Same rule as levels.js countOf: 1 spare, except none for open/belt lines from L20 (pens, stacks, rollers keep 1).
function spareRule(spec, line) {
  if (line.spare != null) return line.spare;
  const n = spec.n || 0, gated = line.place === 'pen' || line.place === 'stack';
  return n > 0 && n >= 20 && !gated && line.place !== 'roll' ? 0 : 1;
}
/** Gate 5 (§4.2): returns { ok, fails: [text], m: { margin, food, kinds, items, decor, contrastBad, ... } }. */
export function staticGates(lv, spec) {
  const fails = [], m = {};
  const it = lv.items, sp = lv.spawn, r0 = lv.r0;
  // spawn density: ≥ 8 fitting within 2.5 u; ≥ 1 within 1.2 u in each 45° sector
  let near = 0;
  const sec = new Array(8).fill(0);
  for (const o of it) {
    if (isWall(o) || isBoss(o) || o.lane >= 0 || !L.canFit(r0, o.a)) continue;
    const dx = o.x - sp.x, dz = o.z - sp.z, d = Math.hypot(dx, dz);
    if (d <= 2.5) near++;
    if (d <= 1.2) { let ang = Math.atan2(dz, dx); if (ang < 0) ang += 2 * Math.PI; sec[Math.min(7, Math.floor(ang / (Math.PI / 4)))]++; }
  }
  m.spawnNear = near; m.spawnSectors = sec.filter(v => v > 0).length;
  if (near < 8) fails.push(`5 spawn: ${near} fitting items within 2.5 u (< 8)`);
  if (m.spawnSectors < 8) fails.push(`5 spawn: only ${m.spawnSectors}/8 sectors have a bite within 1.2 u`);
  // ingredient counts and placement
  const need = {}, spare = {};
  const lines = [];
  for (const tk of spec.tickets) for (const l of tk.lines) { need[l.kind] = (need[l.kind] || 0) + l.need; spare[l.kind] = (spare[l.kind] || 0) + spareRule(spec, l); lines.push(l); }
  const have = {};
  for (const o of it) {
    if (need[o.kind] && !isBoss(o)) have[o.kind] = (have[o.kind] || 0) + 1;
    if (o.stack) for (const k of o.stack) if (need[k]) have[k] = (have[k] || 0) + 1;
  }
  for (const k of Object.keys(need)) {
    const want = need[k] + spare[k];
    if ((have[k] || 0) !== want) fails.push(`5 ingredients: ${k} ${have[k] || 0} placed, want ${want} (need ${need[k]} + spare ${spare[k]})`);
  }
  if (spec.n >= 4) {
    let gated = false;
    for (const l of lines) {
      if (l.place === 'stack') { gated = true; continue; }
      const os = it.filter(o => o.kind === l.kind && !isBoss(o));
      if (!os.length) continue;
      const behind = os.every(o => o.zone > 0 || o.lane >= 0 || o.belt >= 0);
      const far = os.every(o => Math.hypot(o.x - sp.x, o.z - sp.z) >= 0.6 * lv.D);
      if (behind || far) gated = true;
    }
    if (!gated) fails.push('5 placement: no line is gated or ≥ 60 % of D from spawn');
  }
  // margin (DECISION in levels.js: ingredients at K_ING, walls at their k)
  const bossA = Math.max(...it.filter(isBoss).map(o => o.a));
  const needR = L.needR(lv.cake && lv.cake.tiers ? lv.cake.tiers[lv.cake.tiers.length - 1] : bossA);
  let sup = 0;
  for (const o of it) if (!isBoss(o)) sup += ((o.flags & F.ING) ? K_ING : o.k) * o.a * o.a;
  m.margin = sup / ((needR * needR - r0 * r0) / 0.24);
  if (spec.margin && (m.margin < spec.margin[0] - 0.005 || m.margin > spec.margin[1] + 0.005)) fails.push(`5 margin ${m.margin.toFixed(2)} outside [${spec.margin}]`);
  // edible before the boss: every non-wall item fits at needR(boss) (else it is a fake supply)
  const tooBig = it.filter(o => !isWall(o) && !isBoss(o) && !L.canFit(needR, o.a)).length;
  if (tooBig) fails.push(`5 supply: ${tooBig} junk items never fit before the boss`);
  // contrast
  const bad = it.filter(o => !contrastPass(lv, o));
  m.contrastBad = bad.length;
  if (bad.length) fails.push(`5 contrast: ${bad.length} T0/T1 items (${[...new Set(bad.map(o => o.kind))].join(',')})`);
  // perf caps
  const kinds = new Set(it.map(o => o.kind));
  for (const o of it) if (o.stack) for (const k of o.stack) kinds.add(k);
  m.items = it.length; m.kinds = kinds.size; m.decor = (lv.decor || []).length;
  if (it.length > ITEM_MAX) fails.push(`5 perf: ${it.length} items > ${ITEM_MAX}`);
  if (kinds.size > 18) fails.push(`5 perf: ${kinds.size} kinds > 18`);
  if (m.decor > 40) fails.push(`5 perf: ${m.decor} decor > 40`);
  // spacing (walls among themselves, stacks, belts and lanes excepted) and board edge
  let overlaps = 0, edge = 0;
  for (let i = 0; i < it.length; i++) {
    const a = it[i];
    const skipA = a.belt >= 0 || a.lane >= 0;
    if (!isWall(a) && !skipA) {
      if (a.x - a.a < lv.x0 + 0.3 - 1e-6 || a.x + a.a > lv.x1 - 0.3 + 1e-6 || a.z - a.a < lv.z0 + 0.3 - 1e-6 || a.z + a.a > lv.z1 - 0.3 + 1e-6) edge++;
    }
    if (skipA) continue;
    for (let j = i + 1; j < it.length; j++) {
      const b = it[j];
      if (b.belt >= 0 || b.lane >= 0 || (isWall(a) && isWall(b))) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 0.9 * (a.a + b.a) - 1e-3) overlaps++;
    }
  }
  m.overlaps = overlaps; m.edge = edge;
  if (overlaps) fails.push(`5 spacing: ${overlaps} pairs closer than 0.9·(ai+aj)`);
  if (edge) fails.push(`5 edge: ${edge} items within 0.3 u of the board edge`);
  // gate pieces vs their wall pieces: gate.a × 1.2 ≤ the nearest two wall pieces
  let gateBad = 0;
  for (const g of it) {
    if (!(g.flags & F.GATE)) continue;
    const ws = it.filter(o => (o.flags & F.WALL) && !(o.flags & F.GATE)).map(o => [Math.hypot(o.x - g.x, o.z - g.z), o.a]).sort((p, q) => p[0] - q[0]).slice(0, 2);
    if (ws.some(([, a]) => g.a * 1.2 > a + 1e-6)) gateBad++;
  }
  if (gateBad) fails.push(`5 gates: ${gateBad} gate pieces with gate.a·1.2 > wall.a`);
  // food share
  m.food = it.filter(o => KIND[o.kind] && KIND[o.kind].food).length / it.length;
  if (m.food < 0.40) fails.push(`5 food share ${m.food.toFixed(2)} < 0.40`);
  return { ok: !fails.length, fails, m };
}

/** Gate 6 (t = 0 part): doomed() is false on a fresh world. */
export function doomGate(lv) {
  const w = L.createWorld(lv, { mode: 'level' });
  return !L.doomed(w);
}

/** Gate 7: byte-identical re-expand, greedy replay reproduces tEnd to 1 ms. */
export function determinismGate(spec, lv) {
  const fails = [];
  const a = JSON.stringify(LV.genLevel(spec, spec.seed)), b = JSON.stringify(LV.genLevel(spec, spec.seed));
  if (a !== b) fails.push('7 re-expand is not byte-identical');
  if (lv && JSON.stringify(lv) !== a && !lv.daily) fails.push('7 cached level differs from a fresh expand');
  const g = B.runLevel(JSON.parse(a), 'greedy', 1, { record: true });
  const w = L.createWorld(JSON.parse(a), { mode: 'level' });
  for (const inp of g.inputs) { if (w.result) break; L.step(w, inp, L.DT); w.events.length = 0; }
  if (Math.abs(w.t - g.tEnd) > 1e-3 || (w.result || 'maxT') !== g.why) fails.push(`7 replay tEnd ${w.t.toFixed(4)} vs ${g.tEnd.toFixed(4)}`);
  return fails;
}

// ------------------------------------------------------------------ bot gates
const pct = (k, n) => (n ? (100 * k) / n : 0);
function many(lv, kind, runs, opts = {}) {
  let win = 0, s3 = 0, close = 0, fails = 0;
  const ts = [];
  for (let s = 1; s <= runs; s++) {
    const r = B.runLevel(lv, kind, s, opts);
    if (r.win) { win++; ts.push(r.tUsed); if (r.stars === 3) s3++; } else { fails++; if (r.nearMissKind === 'close') close++; }
  }
  ts.sort((p, q) => p - q);
  return { win: pct(win, runs), s3: pct(s3, runs), near: fails ? close / fails : null, med: ts.length ? ts[ts.length >> 1] : null, runs };
}
/**
 * Bot runs for one expanded level. opts.runs = casual/average/expert runs (GDD 100); noise 20 seeds; planner 1
 * deterministic run (the planner has no noise: 20 seeds give 20 identical runs).
 */
export function botStats(lv, spec, { runs = 100, kinds = ['casual', 'average', 'expert'] } = {}) {
  const st = {};
  const g = B.runLevel(lv, 'greedy', 1);
  st.greedy = { win: g.win, t: +g.tUsed.toFixed(2), stars: g.stars, pct: lv.timed === false ? null : +(100 * g.tUsed / lv.T).toFixed(1) };
  let nw = 0;
  for (let s = 1; s <= 20; s++) if (B.runLevel(lv, 'greedy', 100 + s, { noiseDeg: 3 }).win) nw++;
  st.noise = pct(nw, 20);
  const p = B.runLevel(lv, 'planner', 1);
  st.planner = { win: p.win, t: +p.tUsed.toFixed(2), stars: p.stars, ratio: g.win && p.win ? +(p.tUsed / g.tUsed).toFixed(3) : null };
  for (const k of kinds) { const r = many(lv, k, runs); st[k] = { win: +r.win.toFixed(1), s3: +r.s3.toFixed(1), near: r.near == null ? null : +r.near.toFixed(2), med: r.med == null ? null : +r.med.toFixed(1) }; }
  // bakeoff ratio (reported only): planner 3★ share / greedy 3★ share over the 20 noise seeds is the same as
  // the deterministic runs here, so it is planner 3★ (0/1) over greedy 3★ (0/1).
  st.bakeoff = g.stars === 3 ? (p.stars === 3 ? 1 : 0) : (p.stars === 3 ? Infinity : null);
  return st;
}
/** Gates 1–4 (+ near-miss share on L3 / L7, D32) from botStats. Returns [fail text]. */
export function botGates(spec, lv, st) {
  const fails = [], n = spec.n, band = bandOf(n);
  if (!st.greedy.win) fails.push('1 greedy loses (deterministic)');
  if (st.noise < 98) fails.push(`1 greedy ±3° noise wins ${st.noise}% (< 98)`);
  const gw = greedyWindow(spec);
  if (gw && st.greedy.win && (st.greedy.pct < gw[0] || st.greedy.pct > gw[1])) fails.push(`2 greedy uses ${st.greedy.pct}% of T, want ${gw[0]}–${gw[1]}`);
  if (band.plan && lv.timed !== false) {
    if (st.planner.ratio == null || st.planner.ratio > band.plan) fails.push(`3a planner/greedy ${st.planner.ratio} > ${band.plan}`);
    if (st.average && (st.average.s3 < band.avg3[0] || st.average.s3 > band.avg3[1])) fails.push(`3b average 3★ ${st.average.s3}% outside ${band.avg3[0]}–${band.avg3[1]}`);
    if (st.casual && st.casual.s3 > band.cas3) fails.push(`3b casual 3★ ${st.casual.s3}% > ${band.cas3}`);
  }
  const ct = spec.goal && spec.goal.casual;
  if (st.casual && ct != null && Math.abs(st.casual.win - ct) > 7 + 1e-9) fails.push(`4 casual ${st.casual.win}% vs target ${ct} ± 7`);
  if (st.average && st.average.win < band.avg) fails.push(`4 average ${st.average.win}% < ${band.avg}`);
  if (st.expert && st.expert.win < band.exp) fails.push(`4 expert ${st.expert.win}% < ${band.exp}`);
  if ((n === 3 || n === 7) && st.casual && st.casual.win < 100 && (st.casual.near == null || st.casual.near < 0.6)) fails.push(`D32 near-miss share ${st.casual.near} < 0.6`);
  return fails;
}

/** Full check of one spec. Returns { n, lv, st, static, fails }. */
export function verifySpec(spec, { runs = 100, bots = true } = {}) {
  const lv = LV.genLevel(spec, spec.seed);
  const sg = staticGates(lv, spec);
  const fails = sg.fails.slice();
  if (!doomGate(lv)) fails.push('6 doomed at t = 0');
  fails.push(...determinismGate(spec, null));
  let st = null;
  if (bots) { st = botStats(lv, spec, { runs }); fails.push(...botGates(spec, lv, st)); }
  return { n: spec.n, lv, st, static: sg.m, fails };
}

// ------------------------------------------------------------------ daily
export const DAILY_CURS = [7, 15, 21, 30, 45];          // one per (variant, unlocked-towns) combination
function addDays(key, d) {
  // civil date arithmetic on integers (no Date): key 'YYYY-MM-DD' + d days
  let [y, m, dd] = key.split('-').map(Number);
  dd += d;
  const dim = (yy, mm) => [31, (yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
  while (dd > dim(y, m)) { dd -= dim(y, m); m++; if (m > 12) { m = 1; y++; } }
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
export function dailyKeys(days) { const out = []; for (let d = 0; d < days; d++) out.push(addDays(DAILY_START, d)); return out; }
/** Daily gates (§5.3 gate 6 daily clause): static 5, doom 6, greedy 1, casual ≥ 80 % (runs). */
export function verifyDaily(key, cur, { runs = 20, bots = true, bump, T } = {}) {
  const lv = LV.getDaily(key, cur, { bump, T });
  const spec = { n: 0, tickets: lv.tickets.map(t => ({ lines: t.lines.map(l => ({ kind: l.kind, need: l.need, place: l.place })) })), margin: [1.9, 2.3] };
  const sg = staticGates(lv, spec);
  const fails = sg.fails.slice();
  if (!doomGate(lv)) fails.push('6 doomed at t = 0');
  let st = null;
  if (bots) {
    const g = B.runLevel(lv, 'greedy', 1);
    let nw = 0;
    for (let s = 1; s <= 20; s++) if (B.runLevel(lv, 'greedy', 100 + s, { noiseDeg: 3 }).win) nw++;
    const c = many(lv, 'casual', runs);
    st = { greedy: g.win, gPct: +(100 * g.tUsed / lv.T).toFixed(1), noise: pct(nw, 20), casual: +c.win.toFixed(1) };
    if (!g.win) fails.push('1 greedy loses');
    if (st.noise < 98) fails.push(`1 noise ${st.noise}%`);
    if (c.win < 80) fails.push(`4 casual ${c.win.toFixed(0)}% < 80`);
  }
  return { key, cur, town: lv.town, arch: lv.arch, T: lv.T, st, fails };
}

// ------------------------------------------------------------------ kindMax (D25)
/**
 * Per kind, the max instance count over L1–L60, REC, every Daily variant for `days` days, and the Feast cap.
 * DECISION: stack contents count as instances of their kind; the Feast cap is taken from feast.js
 * (feastLevel over 20 seeds per town) once it exports createFeast/feastLevel, and until then every kind
 * gets +FEAST_PAD headroom (the Feast spawner reuses slots, so its counts stay near a normal level's).
 */
const FEAST_PAD = 4;
export async function computeKindMax({ days = 400, specs = SPECS } = {}) {
  const km = {};
  const add = lv => {
    const c = {};
    for (const o of lv.items) { c[o.kind] = (c[o.kind] || 0) + 1; if (o.stack) for (const k of o.stack) c[k] = (c[k] || 0) + 1; }
    for (const [k, v] of Object.entries(c)) if (!(km[k] >= v)) km[k] = v;
  };
  for (const s of specs) add(LV.genLevel(s, s.seed));
  add(LV.genLevel(REC, REC.seed));
  for (const key of dailyKeys(days)) for (const cur of DAILY_CURS) add(LV.getDaily(key, cur));
  let feast = false;
  try {
    const FE = await import('../../games/slurp-pot/feast.js');
    if (typeof FE.createFeast === 'function' && typeof FE.feastLevel === 'function') {
      for (const town of ['picnic', 'market', 'harbour']) for (let s = 1; s <= 20; s++) add(FE.feastLevel(FE.createFeast(town, s)));
      feast = true;
    }
  } catch (e) { feast = false; }
  const out = {};
  for (const k of Object.keys(km).sort()) out[k] = km[k] + (feast ? 0 : FEAST_PAD);
  return { kindMax: out, feast };
}

// ------------------------------------------------------------------ report
export function rowText(spec, r) {
  const st = r.st, m = r.static;
  const f = v => (v == null ? '-' : v);
  const parts = [`L${String(spec.n).padStart(2)} ${spec.arch} T${spec.T}`];
  if (st) parts.push(`greedy ${st.greedy.win ? st.greedy.t + 's' : 'LOSS'} ${f(st.greedy.pct)}% ${st.greedy.stars}★ noise ${st.noise}%`,
    `planner ${st.planner.win ? st.planner.t + 's' : 'LOSS'} ratio ${f(st.planner.ratio)}`,
    `casual ${f(st.casual && st.casual.win)}% (3★ ${f(st.casual && st.casual.s3)}, near ${f(st.casual && st.casual.near)})`,
    `average ${f(st.average && st.average.win)}% (3★ ${f(st.average && st.average.s3)})`, `expert ${f(st.expert && st.expert.win)}%`);
  parts.push(`margin ${m.margin.toFixed(2)} food ${m.food.toFixed(2)} items ${m.items} kinds ${m.kinds}`);
  parts.push(r.fails.length ? 'FAIL: ' + r.fails.join('; ') : 'PASS');
  return parts.join(' | ');
}
export function statsFor(r) {
  const st = r.st || {};
  return {
    greedy: st.greedy || null, noise: st.noise, planner: st.planner || null, casual: st.casual || null, average: st.average || null,
    expert: st.expert || null, margin: +r.static.margin.toFixed(3), food: +r.static.food.toFixed(3), items: r.static.items, kinds: r.static.kinds,
    pass: !r.fails.length, fails: r.fails,
  };
}
export function report(lines, append = false) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  (append ? appendFileSync : writeFileSync)(REPORT_PATH, lines.join('\n') + '\n');
}

// ------------------------------------------------------------------ CLI
async function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const runs = +(opt('--runs') || 100);
  const write = args.includes('--write');
  const quiet = args.includes('--quiet');
  const days = opt('--daily') != null ? +opt('--daily') : 0;
  const rangeArg = args.find(a => /^(\d+(-\d+)?|rec|none)$/.test(a)) || '1-10';
  const out = [`verify.mjs ${args.join(' ')} — runs ${runs} (casual/average/expert), greedy + 20 noise seeds, planner deterministic`];
  let bad = 0;
  const specs = SPECS.map(s => JSON.parse(JSON.stringify(s)));
  if (rangeArg !== 'none') {
    let list;
    if (rangeArg === 'rec') list = [];
    else { const [a, b] = rangeArg.split('-').map(Number); list = specs.filter(s => s.n >= a && s.n <= (b || a)); }
    for (const s of list) {
      const t0 = performance.now();
      const r = verifySpec(s, { runs });
      const line = rowText(s, r) + ` (${((performance.now() - t0) / 1000).toFixed(1)}s)`;
      out.push(line);
      if (!quiet) console.log(line);
      if (r.fails.length) bad++;
      if (write) s.stats = statsFor(r);
    }
    if (rangeArg === 'rec' || rangeArg === '1-60') {
      const lv = LV.genLevel(REC, REC.seed);
      const sg = staticGates(lv, REC);
      const g = B.runLevel(lv, 'greedy', 1);
      const line = `REC items ${lv.items.length} kinds ${sg.m.kinds} margin ${sg.m.margin.toFixed(2)} greedy ${g.win ? g.tUsed.toFixed(1) + 's' : 'LOSS'} ` + (sg.fails.length ? 'static: ' + sg.fails.join('; ') : 'static PASS');
      out.push(line); if (!quiet) console.log(line);
    }
  }
  if (days) {
    let dbad = 0, n = 0;
    for (const key of dailyKeys(days)) for (const cur of [7, 15, 30]) {
      const r = verifyDaily(key, cur, { runs: Math.min(runs, 20) });
      n++;
      if (r.fails.length) { dbad++; const line = `daily ${key} cur ${cur} ${r.town} ${r.arch} T${r.T} ${JSON.stringify(r.st)} FAIL: ${r.fails.join('; ')}`; out.push(line); if (!quiet) console.log(line); }
    }
    const line = `daily: ${n - dbad}/${n} pass (${days} days × 3 variants)`;
    out.push(line); console.log(line);
    if (dbad) bad++;
  }
  let km = null;
  if (write || args.includes('--kindmax')) {
    const r = await computeKindMax({ days: 400, specs });
    km = r.kindMax;
    const line = `kindMax: ${Object.keys(km).length} kinds, total ${Object.values(km).reduce((p, q) => p + q, 0)}, feast ${r.feast ? 'from feast.js' : 'pending (+' + FEAST_PAD + ' pad)'}`;
    out.push(line); console.log(line);
  }
  if (write) writeLevelsData(DATA_PATH, specs, REC, km || KM_OLD);
  report(out, args.includes('--append'));
  console.log(bad ? `${bad} failing` : 'all checked levels pass');
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
