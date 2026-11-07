// Slurp Pot level verifier (GDD §5.3, §4.2). Levels role.
// Usage: node tools/slurp-pot/verify.mjs [1-10 | 2,5,7-9] [--runs 100] [--xruns N] [--jobs N] [--write] [--daily 400 [--every K]]
//        [--kindmax] [--quiet] [--report PATH] [--append] | --stats [range]
//   range     levels to check (default 1-10); 'rec' checks the REC level only
//   --runs    casual / average / expert runs per level (GDD: 100)
//   --write   writes spec.stats for the checked levels and kindMax into games/slurp-pot/levels-data.js
//   --daily N also checks N days of the Daily Order, every variant in every town it shows (static gates 5, 6,
//             greedy gate 1, casual ≥ 80 %)
//   --every K with --daily: every K-th day only (spot check)
//   --kindmax recomputes kindMax only (implied by --write)
//   --jobs N  forks N worker processes (RAM rule: 3 at most)
//   --stats   no bot runs: writes the §5.3 report from the stored stats (STALE when the layout or T moved since)
// Exit code 1 when any checked level fails a gate. Report: studio/2026-11-04/levels/levels-report.txt.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import * as LV from '../../games/slurp-pot/levels.js';
import * as L from '../../games/slurp-pot/logic.js';
import * as B from '../../games/slurp-pot/bots.js';
import { KIND, SURF, CONTRAST_MIN } from '../../games/slurp-pot/catalog.js';
import { SPECS, REC, kindMax as KM_OLD } from '../../games/slurp-pot/levels-data.js';
import { K_ING, ITEM_MAX, DAILY_START, STAR3, isMilestone } from '../../games/slurp-pot/consts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_PATH = join(ROOT, 'games/slurp-pot/levels-data.js');
export const REPORT_PATH = join(ROOT, 'studio/2026-11-04/levels/levels-report.txt');
const F = L.F;

/** Writes games/slurp-pot/levels-data.js: one spec per line (JSON is valid JS), then REC and kindMax. */
export function writeLevelsData(path, specs, rec, kindMax) {
  const out = [];
  out.push('// Slurp Pot level specs (GDD §4.4, §5). Levels role. Written by tools/slurp-pot/verify.mjs and tune.mjs');
  out.push('// (writeLevelsData): one spec per line. levels.js expands a spec with genLevel(spec, spec.seed).');
  out.push('// Spec: { n, name, town, arch, W, D, seed, r0, T, items, mix [T0..T4 %], margin [lo, hi], tickets: [{ lines:');
  out.push('// [{ kind, need, place?, spare?, at? }], boss: { kind, a } }], twist: { pens, nested, walls, lanes, islands,');
  out.push('// gulls, cap, cake, truck }, gateR?, timed?, bossDist?, rings?, goal: { T, greedy, casual } (§4.4 table),');
  out.push('// seed0?, marginBand?, grace?, starter?, stats? }. tune.mjs picks seed (seed0 + 7919·bump), T (goal.T ± 15 %) and margin (inside');
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
// DECISION (11-06 Fri, L4 ramp): from L25 the difficulty is a saw-tooth. Critics found no level that made an average
// player sweat: the average bot kept 16-32 s on most of L21+. A peak is the last hard level before a breather or twist
// intro, plus the town finales: L29 33 37 40 44 49 54 57 60. Greedy runs 80-95 % of T there and casual sits at ~52 %
// (45-59), so the average bot still wins but with seconds left, and the average 3-star floor drops to 0: on a peak the
// third star belongs to a fast hand. The every-5th boss levels that §4.4 calls breathers stay breathers (the brief wants
// a breather after each peak). L43, L53 and L59 keep their Thu cliff fixes and are not peaks.
// DECISION (11-06 Fri, round 2, L4): L30 and L50 join the peaks and leave the breathers, so every tenth level is a peak
// (the milestone levels, consts.isMilestone). Levels with snack piles (L21+) are timed by spareBand below, not by greedy.
export const PEAKS = [29, 30, 33, 37, 40, 44, 49, 50, 54, 57, 60];
/** Levels with snack piles (levels.js snackPiles): the piles speed the bots unevenly, so greedy no longer measures pace. */
export const onPiles = spec => spec.n >= LV.PILE_FROM;
const isPeak = n => PEAKS.includes(n) || isMilestone(n);
/**
 * Gate 2 on a pile level: the average bot's spare time, % of the pace clock (T − grace), median of its runs, a loss
 * counting 0. Sizzle and chili seconds are inside it, because the player has them too.
 */
// DECISION (11-06 Fri, round 2, L4, the mobile designer's tension curve): the greedy share gate failed on eight pile levels and
// its fixes pulled T the wrong way: a pile can hand greedy 20 s while the average bot gets 5, so T set from greedy left
// the average bot 2.9 s on L29 and lost it at 82 % on L26. The player's pace is the average bot's, so that is the measure:
// peaks and milestones 8 to 14 % spare, normal levels 20 to 30 %, breathers 35 % or more. The curve is a saw-tooth on purpose.
// Gate 2 keeps the greedy window on L1 to L20. Every other gate stays.
// DECISION (11-06 Fri, round 3, the coordinator's call): that peak band of 8 to 14 % was wrong. Casual is about 20 % slower than
// average, so it left casual 1 to 19 % on a peak, a wall and not tension. Pile levels are a saw-tooth in CASUAL first-try wins:
// peaks about 50, normals about 80, breathers 90 or more. So a peak's T is set by casual (goal.casual 52 within +-7) and the band
// follows it: peaks 16 to 26 % spare, normals 26 to 34, breathers 35 or more.
export function spareBand(spec) {
  if (!onPiles(spec) || spec.timed === false) return null;
  if (isPeak(spec.n)) return [16, 26];
  return BREATHERS.includes(spec.n) ? [35, 100] : [26, 34];
}
export function bandOf(n) {
  if (n <= 3) return { avg: [100, 99, 85][n - 1], exp: 100, plan: null, avg3: null, cas3: null };
  // DECISION (11-07 Sat, r3 critics): the old L4-L20 bands (average 3-star 15 to 45, casual 15 at most) are what left a casual player with 0 to 5 %
  // three-stars from L4 to L20 while winning nearly every time: the kid called L5-L9 stingy and the viral marketer's early win card read
  // "Finish 29s faster". Early stars are a welcome, not a test: L4-L10 an average player mostly three-stars and a casual one mostly two-stars,
  // L11-L20 the third star is about a coin flip for average. The clock did not move for this: seconds went from grace (buys no stars) to pace.
  if (n <= 7) return { avg: 80, exp: 98, plan: 0.88, avg3: [40, 100], cas3: 50 };
  if (n <= 10) return { avg: 75, exp: 97, plan: 0.80, avg3: [40, 100], cas3: 50 };
  if (n <= 20) return { avg: 75, exp: 97, plan: 0.80, avg3: [25, 65], cas3: 15 };
  // DECISION (11-06 Fri, round 2, L4): a breather at 35 % spare or more is a level the average bot three-stars at least half the
  // time (3 stars is left >= 0.35, the same number), so the 3-star ceiling cannot hold there: it is lifted on pile breathers.
  const top = BREATHERS.includes(n) && n >= LV.PILE_FROM ? 100 : n <= 40 ? 35 : 30;
  // DECISION (11-06 Fri, round 3): on pile levels the average 3-star floor is 5 on normals (0 on peaks, ceiling unchanged): at 26 to 34 %
  // spare the third star (left >= .35) sits just past the median run. avg and exp are gate 1 here, see botGates.
  return { avg: 90, exp: 99, plan: n <= 40 ? 0.78 : 0.76, avg3: [isPeak(n) ? 0 : 5, top], cas3: 15 };
}
// DECISION (11-04 Wed, §4.4, L30 and L50 moved to the peaks on 11-06): breathers (6 12 15 25 35 45 52 55) run greedy ≤ 76 % of T and casual ≥ 80 %;
// each twist's first level (4 10 16 22 28 34 41 47 53) greedy ≤ 74 %, casual ≥ 80 %. Both clip the table windows
// (goal.greedy ± 4, goal.casual ± 7); a casual goal under 80 (L55 78) keeps its own value as the floor.
export const BREATHERS = [6, 12, 15, 25, 35, 45, 52, 55], TWIST_FIRST = [4, 10, 16, 22, 28, 34, 41, 47, 53];
// DECISION (11-06 Fri, L1 grace): a level's grace buys no stars, so every pace gate reads the pace T = T − grace. Greedy %
// and the 3★ bands keep their meaning on a grace level; casual has the grace on top, so only its floor stays (see below).
export const paceT = o => o.T - (o.grace > 0 ? o.grace : 0);
/** Greedy share-of-T window (gate 2): table % ± 4; from L10 also inside 70–85 % (bakeoff call); §4.4 caps. */
export function greedyWindow(spec) {
  const g = spec.goal && spec.goal.greedy;
  // DECISION (11-06 Fri, L1 grace): on a grace level the win is never in doubt for greedy, and the pace only prices the stars, so
  // the average 3-star band sets it. Greedy is the slowest fast bot on these boards (L5 greedy 46 s, average 37 s; L10 53 s,
  // 45 s), so a greedy window pulled T the other way from the star band. Gate 1 still needs greedy to win.
  if (!g || spec.grace > 0 || onPiles(spec)) return null;
  let lo = g - 4, hi = g + 4;
  if (PEAKS.includes(spec.n)) return [80, 95];
  if (spec.n >= 10) { lo = Math.max(lo, 70); hi = Math.min(hi, 85); }
  if (BREATHERS.includes(spec.n)) hi = Math.min(hi, 76);
  if (TWIST_FIRST.includes(spec.n)) hi = Math.min(hi, 74);
  return [lo, hi];
}
/** Casual win window (gate 4): goal.casual ± 7; breathers and twist intros at least min(80, goal). Pile levels: see below. */
// DECISION (11-06 Fri, round 3): on pile levels only peaks keep goal.casual ± 7. A normal is casual 60 to 92 and a breather 85 or more,
// instead of the table goals, and a twist intro on the piles is a normal like any other (the old floor of 80 came from the greedy days).
export function casualWindow(spec) {
  const c = spec.goal && spec.goal.casual;
  if (c == null) return null;
  // DECISION (11-07 Sat, r4 critics): the town openers L21-24 and L41-44 carry grace so a slow hand is not dropped off a step at a new town. Same rule as the
  // L1 grace below: grace lifts the slow hand and costs the pace nothing, so a grace level has no ceiling.
  if (onPiles(spec) && !isPeak(spec.n)) return BREATHERS.includes(spec.n) ? [85, 100] : [60, spec.grace > 0 ? 100 : 92];
  let lo = c - 7;
  if (BREATHERS.includes(spec.n) || TWIST_FIRST.includes(spec.n)) lo = Math.max(lo, Math.min(80, c));
  // DECISION (11-06 Fri, L1 grace): grace exists to lift a slow hand over the table's casual goal, so a grace level has no ceiling.
  return [lo, spec.grace > 0 ? 100 : c + 7];
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
/** Contrast of a T0/T1 item where it sits (§4.2 + D33 gingham rule, same as levels.js contrastOK / groundOK):
 *  every surface under its inner square (half 0.6·a, 9 sample points) passes, and the ground passes when a sample
 *  point is on bare ground. */
export function contrastPass(lv, it) {
  const k = KIND[it.kind];
  if (!k || k.tier > 1 || isWall(it) || isBoss(it)) return true;
  const m = it.a * 0.6;
  let bare = false;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const px = it.x + i * m, pz = it.z + j * m;
    let hit = false;
    for (const s of lv.surfaces) {
      if (Math.abs(px - s.x) > s.w / 2 + 1e-6 || Math.abs(pz - s.z) > s.d / 2 + 1e-6) continue;
      hit = true;
      if (Math.abs(k.lum - lumOf(lv.town, s.color)) < CONTRAST_MIN) return false;
    }
    if (!hit) bare = true;
  }
  if (!bare) return true;
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
export const LADDER_MAX = 0.85;
/** Smallest share f (0..∞) of each item's mass that still grows the pot from r0 to needR in fit order. */
export function ladderFrac(lv, needR) {
  const it = lv.items, zs = new Map((lv.zones || []).map(z => [z.id, z]));
  const open = (id, r) => { for (let z = zs.get(id), k = 0; z && z.id > 0 && k < 16; z = zs.get(z.parent), k++) if (z.r && r < 0.97 * z.r - 1e-9) return false; return true; };
  const reach = f => {
    let r = lv.r0, mass = 0;
    const used = new Uint8Array(it.length);
    for (let pass = 0; pass < 400; pass++) {
      let add = 0;
      for (let i = 0; i < it.length; i++) {
        const o = it[i];
        if (used[i] || isBoss(o) || !L.canFit(r, o.a) || !open(o.zone, r)) continue;
        used[i] = 1; add += ((o.flags & F.ING) ? K_ING : o.k) * o.a * o.a;
      }
      if (!add) break;
      mass += f * add; r = Math.sqrt(lv.r0 * lv.r0 + 0.24 * mass);
      if (r >= needR - 1e-9) return true;
    }
    return r >= needR - 1e-9;
  };
  if (!reach(1)) { let lo = 1, hi = 64; while (hi - lo > 0.01 && !reach(hi)) hi *= 2; return reach(hi) ? hi : 99; }
  let lo = 0, hi = 1;
  for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (reach(mid)) hi = mid; else lo = mid; }
  return hi;
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
  // DECISION (11-06 Fri): L2–L10 starter promise. A dense patch of bites (≥ 12 in one 1.6 u circle) and an item of the
  // order's first line, both inside the first portrait screen of spawn (±2.3 by ±5 u at r 0.3).
  if (spec.starter) {
    const view = o => Math.abs(o.x - sp.x) <= 2.3 && Math.abs(o.z - sp.z) <= 5;
    const bites = it.filter(o => !isWall(o) && !isBoss(o) && o.lane < 0 && o.belt < 0 && L.canFit(r0, o.a) && view(o));
    m.patch = Math.max(0, ...(lv.piles || []).map(p => bites.filter(o => Math.hypot(o.x - p.x, o.z - p.z) <= p.r).length));
    if (m.patch < 12) fails.push(`5 starter: ${m.patch} bites in the patch (< 12)`);
    const lead = lv.tickets[0].lines[0];
    if (!it.some(o => o.kind === lead.kind && !isBoss(o) && view(o))) fails.push(`5 starter: no ${lead.kind} (first line) in the first screen`);
  }
  // DECISION (11-06 Fri, L3): the snack-pile promise. At least 5 piles from L21, one of them on the first screen of spawn.
  if (spec.n >= 21) {
    const ps = lv.piles || [];
    if (ps.length < 5) fails.push(`5 piles: ${ps.length} (< 5)`);
    if (!ps.some(p => Math.abs(p.x - sp.x) <= 2.3 + p.r && Math.abs(p.z - sp.z) <= 5 + p.r)) fails.push('5 piles: none in view of spawn');
  }
  // margin (DECISION in levels.js: ingredients at K_ING, walls at their k)
  const bossA = Math.max(...it.filter(isBoss).map(o => o.a));
  const needR = L.needR(lv.cake && lv.cake.tiers ? lv.cake.tiers[lv.cake.tiers.length - 1] : bossA);
  let sup = 0;
  for (const o of it) if (!isBoss(o)) sup += ((o.flags & F.ING) ? K_ING : o.k) * o.a * o.a;
  m.margin = sup / ((needR * needR - r0 * r0) / 0.24);
  // DECISION (11-06 Fri, L3): spec.margin bands the tuned layout; L21+ snack piles sit on top of it and add 0.02–0.03 of T0/T1
  // supply (fixMargin cannot see them, by design: they must not move a draw). The band's top gets 0.05 for them.
  const pileM = spec.n >= 21 ? 0.05 : 0;
  if (spec.margin && (m.margin < spec.margin[0] - 0.005 || m.margin > spec.margin[1] + pileM + 0.005)) fails.push(`5 margin ${m.margin.toFixed(2)} outside [${spec.margin}]${pileM ? ' + piles' : ''}`);
  // DECISION (11-04, no cliffs §4.4): the growth ladder. ladderFrac = the smallest share f of every item's mass
  // with which the pot, eating in fit order (an item counts once it fits and its pen's gate piece fits), still
  // reaches needR(boss). A tier gap (L2 11-04: 0.28 → 0.90 with nothing between, the pot stalls at r 0.94 of 1.44)
  // shows as f > 1. Gate: f ≤ LADDER_MAX (0.85: the pot must not need almost every item; after levels.js
  // bridgeGaps L1–L60 sit at 0.36–0.77).
  m.ladder = ladderFrac(lv, needR);
  if (m.ladder > LADDER_MAX + 1e-9) fails.push(`5 ladder: growth needs ${(100 * m.ladder).toFixed(0)} % of the mass in fit order (max ${(100 * LADDER_MAX).toFixed(0)} %; a size gap)`);
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
  // surfaces never overlap (D33 z-fight, 11-04): all surfaces sit at y 0, so any shared area z-fights in Render
  const S = lv.surfaces || [];
  let sOver = 0;
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const ox = Math.min(S[i].x + S[i].w / 2, S[j].x + S[j].w / 2) - Math.max(S[i].x - S[i].w / 2, S[j].x - S[j].w / 2);
    const oz = Math.min(S[i].z + S[i].d / 2, S[j].z + S[j].d / 2) - Math.max(S[i].z - S[i].d / 2, S[j].z - S[j].d / 2);
    if (ox > 2e-3 && oz > 2e-3) sOver++;
  }
  m.surfOverlap = sOver;
  if (sOver) fails.push(`5 surfaces: ${sOver} overlapping surface pairs (z-fight)`);
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
  const ts = [], lefts = [], hots = [], g = lv.grace > 0 ? lv.grace : 0;
  for (let s = 1; s <= runs; s++) {
    const r = B.runLevel(lv, kind, s, opts);
    lefts.push(r.win ? (100 * (r.tLeft - g)) / (lv.T - g) : 0);
    hots.push(r.hot);
    if (r.win) { win++; ts.push(r.tUsed); if (r.stars === 3) s3++; } else { fails++; if (r.nearMissKind === 'close') close++; }
  }
  const up = (p, q) => p - q;
  ts.sort(up); lefts.sort(up); hots.sort(up);
  return { win: pct(win, runs), s3: pct(s3, runs), near: fails ? close / fails : null, med: ts.length ? ts[ts.length >> 1] : null, runs, left: lefts[lefts.length >> 1], hot: hots[hots.length >> 1], hotMax: hots[hots.length - 1] };
}
/**
 * Bot runs for one expanded level. opts.runs = casual/average/expert runs (GDD 100); noise 20 seeds; planner 1
 * deterministic run (the planner has no noise: 20 seeds give 20 identical runs).
 */
// DECISION (11-04): the expert bot costs ~2.5 s a run on a 60 s level (20× average), so the expert sample may be
// smaller than the casual / average one (xruns; default = runs). Gates read percentages, so nothing else changes.
export function botStats(lv, spec, { runs = 100, xruns = runs, kinds = ['casual', 'average', 'expert'] } = {}) {
  const st = {};
  const g = B.runLevel(lv, 'greedy', 1);
  st.greedy = { win: g.win, t: +g.tUsed.toFixed(2), stars: g.stars, pct: lv.timed === false ? null : +(100 * g.tUsed / paceT(lv)).toFixed(1) };
  let nw = 0;
  for (let s = 1; s <= 20; s++) if (B.runLevel(lv, 'greedy', 100 + s, { noiseDeg: 3 }).win) nw++;
  st.noise = pct(nw, 20);
  const p = B.runLevel(lv, 'planner', 1);
  st.planner = { win: p.win, t: +p.tUsed.toFixed(2), stars: p.stars, ratio: g.win && p.win ? +(p.tUsed / g.tUsed).toFixed(3) : null };
  for (const k of kinds) { const r = many(lv, k, k === 'expert' ? xruns : runs); st[k] = { win: +r.win.toFixed(1), s3: +r.s3.toFixed(1), near: r.near == null ? null : +r.near.toFixed(2), med: r.med == null ? null : +r.med.toFixed(1), left: +r.left.toFixed(1), hot: r.hot, hotMax: r.hotMax }; }
  // bakeoff ratio (reported only): planner 3★ share / greedy 3★ share over the 20 noise seeds is the same as
  // the deterministic runs here, so it is planner 3★ (0/1) over greedy 3★ (0/1).
  st.bakeoff = g.stars === 3 ? (p.stars === 3 ? 1 : 0) : (p.stars === 3 ? Infinity : null);
  return st;
}
/** Gates 1–4 (+ near-miss share on L3 / L7, D32) from botStats. Returns [fail text]. */
export function botGates(spec, lv, st) {
  const fails = [], n = spec.n, band = bandOf(n);
  // DECISION (11-06 Fri, round 3): greedy stops gating on pile levels and stays printed. A pile can hand it 20 s or cost it the level, so it
  // says nothing about the player. Gate 1 there is the average bot at 90 % or more and the expert at 99 % or more (bandOf).
  const piles = onPiles(spec);
  if (!piles && !st.greedy.win) fails.push('1 greedy loses (deterministic)');
  if (!piles && st.noise < 98) fails.push(`1 greedy ±3° noise wins ${st.noise}% (< 98)`);
  const gw = greedyWindow(spec);
  if (gw && st.greedy.win && (st.greedy.pct < gw[0] || st.greedy.pct > gw[1])) fails.push(`2 greedy uses ${st.greedy.pct}% of T, want ${gw[0]}–${gw[1]}`);
  const sb = spareBand(spec);
  if (sb && st.average && (st.average.left == null || st.average.left < sb[0] || st.average.left > sb[1])) fails.push(`2 average spare ${st.average.left}% of T, want ${sb[0]}–${sb[1]}`);
  if (band.plan && lv.timed !== false) {
    // DECISION (11-06 Fri, round 3, the coordinator's call): on piles 3a asks the question the ratio stood for, does a planned route earn the
    // third star. Dividing by greedy's time stopped meaning anything once greedy stopped measuring pace there (see above), and T cannot move it.
    // L52 fails this, and it is a real fail: every bot needs about 55 s, so no route reached 35 % left at T 68.
    // DECISION (11-07 Sat, round 3): the same goes for grace levels. Their greedy window went for this reason on 11-06, and with L6's starter patch
  // greedy eats as fast as any plan (27.6 s, planner 27.0), so the ratio read a tie on a breather where the planner three-stars easily.
  if (piles || spec.grace > 0) { if (!st.planner.win || st.planner.stars < 3) fails.push(`3a planner earns ${st.planner.win ? st.planner.stars : 0} stars, want 3`); }
    else if (st.planner.ratio == null || st.planner.ratio > band.plan) fails.push(`3a planner/greedy ${st.planner.ratio} > ${band.plan}`);
    if (st.average && (st.average.s3 < band.avg3[0] || st.average.s3 > band.avg3[1])) fails.push(`3b average 3★ ${st.average.s3}% outside ${band.avg3[0]}–${band.avg3[1]}`);
    if (st.casual && st.casual.s3 > band.cas3) fails.push(`3b casual 3★ ${st.casual.s3}% > ${band.cas3}`);
  }
  const ct = spec.goal && spec.goal.casual, cw = casualWindow(spec);
  if (st.casual && cw && (st.casual.win < cw[0] - 1e-9 || st.casual.win > cw[1] + 1e-9)) fails.push(`4 casual ${st.casual.win}% vs target ${ct} (window ${cw[0]}–${cw[1]})`);
  const gA = piles ? 1 : 4;
  if (st.average && st.average.win < band.avg) fails.push(`${gA} average ${st.average.win}% < ${band.avg}`);
  if (st.expert && st.expert.win < band.exp) fails.push(`${gA} expert ${st.expert.win}% < ${band.exp}`);
  // DECISION (11-06 Fri, round 2, hot chili): the cap on chili damage is geometry (levels.js hotClear and the gap), and this gate proves
  // it held: a level has enough chilis to matter, and a careful hand pays for at most two (average) or one (expert), median.
  if (lv.hot) {
    if (lv.hot.length < 7) fails.push(`H only ${lv.hot.length} chilis`);
    if (st.average && st.average.hot > 2) fails.push(`H average bot hits ${st.average.hot} chilis`);
    if (st.expert && st.expert.hot > 1) fails.push(`H expert bot hits ${st.expert.hot} chilis`);
  }
  if ((n === 3 || n === 7) && st.casual && st.casual.win < 100 && (st.casual.near == null || st.casual.near < 0.6)) fails.push(`D32 near-miss share ${st.casual.near} < 0.6`);
  return fails;
}

/** Full check of one spec. Returns { n, lv, st, static, fails }. */
export function verifySpec(spec, { runs = 100, xruns = runs, bots = true } = {}) {
  const lv = LV.genLevel(spec, spec.seed);
  const sg = staticGates(lv, spec);
  const fails = sg.fails.slice();
  if (!doomGate(lv)) fails.push('6 doomed at t = 0');
  fails.push(...determinismGate(spec, null));
  let st = null;
  if (bots) { st = botStats(lv, spec, { runs, xruns }); fails.push(...botGates(spec, lv, st)); }
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
  add((await import('../../games/slurp-pot/modes.js')).recPlan(LV.getRecord()).level); // the video's course has its own kinds (gazebo)
  for (const key of dailyKeys(days)) for (const cur of DAILY_CURS) add(LV.getDaily(key, cur));
  // DECISION (11-04, Render): every Feast course counts too (courses 1–6, cur 12 / 30 / 60, 20 seeds a town), stack
  // contents included, since Render sizes its pools from kindMax.
  for (const town of ['picnic', 'market', 'harbour']) for (let sd = 1; sd <= 20; sd++) for (const cur of [12, 30, 60]) for (let cc = 1; cc <= 6; cc++) add(LV.feastCourse(cc, town, sd, { cur }));
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
    `average ${f(st.average && st.average.win)}% (3★ ${f(st.average && st.average.s3)}, spare ${f(st.average && st.average.left)})`, `expert ${f(st.expert && st.expert.win)}%`);
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
export function report(lines, append = false, path = REPORT_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  (append ? appendFileSync : writeFileSync)(path, lines.join('\n') + '\n');
}

/**
 * Report row from a spec's stored stats (no bot runs). The static gates are re-run on the current generator: when
 * margin / items / kinds differ from the stored ones, or the stored greedy % no longer matches spec.T, the row is
 * marked STALE (the stats belong to an older layout or T) and counts as failing.
 */
// DECISION (11-04 Wed): --stats writes levels-report.txt from levels-data.js (the tune confirm runs, 100 casual /
// average runs each) so the §5.3 table costs seconds; a STALE row means that level needs a fresh verify or tune.
export function statsRow(spec) {
  const lv = LV.genLevel(spec, spec.seed), sg = staticGates(lv, spec), m = sg.m, st = spec.stats;
  if (!st) return { row: `L${String(spec.n).padStart(2)} ${spec.arch} T${spec.T} | no stats | FAIL: not verified`, pass: false };
  const stale = [];
  if (Math.abs(m.margin - st.margin) > 0.005 || m.items !== st.items || m.kinds !== st.kinds) stale.push(`layout (margin ${m.margin.toFixed(2)} items ${m.items} now)`);
  if (st.greedy && st.greedy.win && st.greedy.pct != null && Math.abs(st.greedy.pct - (100 * st.greedy.t) / paceT(spec)) > 0.15) stale.push(`T (greedy ${st.greedy.pct}% was at another T)`);
  // bot gates are re-derived from the stored stats (so a gate change shows without a re-run); doom/determinism
  // fails (6, 7) are kept from the stored run
  const fails = (st.fails || []).filter(f => /^[67] /.test(f));
  if (st.greedy && st.planner) for (const f of botGates(spec, lv, st)) if (!fails.includes(f)) fails.push(f);
  for (const f of sg.fails) if (!fails.includes(f)) fails.push(f);
  if (stale.length) fails.push('STALE ' + stale.join(', '));
  const r = { st: { greedy: st.greedy, noise: st.noise, planner: st.planner, casual: st.casual, average: st.average, expert: st.expert }, static: m, fails };
  return { row: rowText(spec, r), pass: !fails.length };
}

// DECISION (11-04 Wed, "no new cliffs"): a cliff is a casual-win drop from one level to the next that is more than
// 10 points steeper than the drop in the §4.4 casual targets. Reported under the --stats table (not a gate: each
// level already sits inside its own window).
function cliffLines(list) {
  const out = [], byN = new Map(list.map(s => [s.n, s]));
  for (const s of list) {
    const p = byN.get(s.n - 1);
    if (!p || !s.stats || !p.stats || !s.stats.casual || !p.stats.casual || !s.goal || !p.goal || s.goal.casual == null || p.goal.casual == null) continue;
    const drop = p.stats.casual.win - s.stats.casual.win, want = p.goal.casual - s.goal.casual;
    if (drop - want > 10) out.push(`L${s.n}`.padEnd(4) + ` casual ${p.stats.casual.win} → ${s.stats.casual.win} (targets ${p.goal.casual} → ${s.goal.casual})`);
  }
  return ['cliffs (casual drop > target drop + 10): ' + (out.length ? out.length : 'none'), ...out.map(t => '  ' + t)];
}

// ------------------------------------------------------------------ CLI
// DECISION (11-04 Wed): --jobs N forks N children (one level, or 12 day-variants, per child) so the full L1–L60 +
// 400-daily check fits the RAM rule (--jobs 3) in wall-clock-capped runs; --write saves each finished level's stats
// to levels-data.js at once (a capped run keeps what it finished) and recomputes kindMax at the end.
const SELF = fileURLToPath(import.meta.url);
function pool(tasks, jobs, argsOf, onMsg) {
  return new Promise(done => {
    let live = 0, next = 0;
    const launch = () => {
      if (next >= tasks.length) { if (!live) done(); return; }
      const t = tasks[next++];
      live++;
      const cp = fork(SELF, argsOf(t));
      cp.on('message', onMsg);
      cp.on('exit', () => { live--; launch(); });
    };
    if (!tasks.length) { done(); return; }
    for (let j = 0; j < Math.min(jobs, tasks.length); j++) launch();
  });
}
function levelRow(s, runs, xruns) {
  const t0 = performance.now();
  const r = verifySpec(s, { runs, xruns });
  return { n: s.n, line: rowText(s, r) + ` (${((performance.now() - t0) / 1000).toFixed(1)}s)`, fails: r.fails, stats: statsFor(r) };
}
const dailyLine = r => `daily ${r.key} cur ${r.cur} ${r.town} ${r.arch} T${r.T} ${JSON.stringify(r.st)} FAIL: ${r.fails.join('; ')}`;
async function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const runs = +(opt('--runs') || 100), xruns = +(opt('--xruns') || runs), jobs = Math.max(1, +(opt('--jobs') || 1));
  if (args[0] === '--vchild') {
    process.on('disconnect', () => process.exit(0));
    const s = SPECS.find(q => q.n === +args[1]);
    const m = levelRow(JSON.parse(JSON.stringify(s)), runs, xruns);
    process.send(m, () => process.exit(0));
    return;
  }
  if (args[0] === '--dvchild') {
    process.on('disconnect', () => process.exit(0));
    const m = JSON.parse(args[1]).map(([key, cur]) => { const r = verifyDaily(key, cur, { runs: Math.min(runs, 20) }); return { key, cur, town: r.town, arch: r.arch, T: r.T, st: r.st, fails: r.fails }; });
    process.send(m, () => process.exit(0));
    return;
  }
  const write = args.includes('--write');
  const quiet = args.includes('--quiet');
  const days = opt('--daily') != null ? +opt('--daily') : 0;
  const rpath = opt('--report') || REPORT_PATH;
  const rangeArg = args.find(a => /^(\d+([-,]\d+)*|rec|none)$/.test(a)) || '1-10';
  const specs = SPECS.map(s => JSON.parse(JSON.stringify(s)));
  const inRange = s => rangeArg.split(',').some(p => { const [a, b] = p.split('-').map(Number); return s.n >= a && s.n <= (b || a); });
  if (args.includes('--stats')) {
    const list = args.some(x => /^\d+([-,]\d+)*$/.test(x)) ? specs.filter(inRange) : specs;
    const rows = list.map(statsRow), np = rows.filter(r => r.pass).length;
    const out = [`verify.mjs ${args.join(' ')} — §5.3 table from the stored stats in levels-data.js (tune confirm / verify runs:`,
      `100 casual + 100 average runs, expert 34 in a tune confirm, greedy + 20 ±3° noise seeds, planner deterministic); static gates re-run now.`,
      `bands: L4–7 avg ≥80 exp ≥98 planner ≤.88 avg3★ 40+ cas3★ ≤50 | L8–10 75/97/.80/40+ cas3★ ≤50 | L11–20 75/97/.80/25–65 | L21–40 72/96/.78/15–35 | L41+ 70/95/.76/15–30;`,
      `casual 3★ ≤15 from L4; casual win within goal.casual ± 7; greedy % of T within goal.greedy ± 4 (70–85 from L10); D32 near ≥.6 on L3/L7;`,
      `§4.4: peaks ${PEAKS.join(' ')} greedy 80–95 casual 45–59 avg3★ floor 0; breathers ${BREATHERS.join(' ')} greedy ≤76 casual ≥80; twist intros ${TWIST_FIRST.join(' ')} greedy ≤74 casual ≥80.`,
      `${np}/${list.length} levels pass every gate`, ...rows.map(r => r.row), ...cliffLines(list)];
    report(out, args.includes('--append'), rpath);
    if (!quiet) console.log(out.join('\n'));
    process.exitCode = np === list.length ? 0 : 1;
    return;
  }
  const out = [`verify.mjs ${args.join(' ')} — runs ${runs} (casual/average), expert ${xruns}, greedy + 20 noise seeds, planner deterministic`];
  let bad = 0;
  if (rangeArg !== 'none') {
    const list = rangeArg === 'rec' ? [] : specs.filter(inRange);
    const res = new Map();
    const got = m => {
      res.set(m.n, m);
      if (!quiet) console.log(m.line);
      if (write) { specs.find(q => q.n === m.n).stats = m.stats; writeLevelsData(DATA_PATH, specs, REC, KM_OLD); }
    };
    if (jobs > 1) await pool(list, jobs, s => ['--vchild', String(s.n), '--runs', String(runs), '--xruns', String(xruns)], got);
    else for (const s of list) got(levelRow(s, runs, xruns));
    let np = 0;
    for (const s of list) { const m = res.get(s.n); if (!m) { out.push(`L${String(s.n).padStart(2)} not finished`); bad++; continue; } out.push(m.line); if (m.fails.length) bad++; else np++; }
    out.push(`levels: ${np}/${list.length} pass every gate`);
    if (list.length) console.log(`levels: ${np}/${list.length} pass every gate`);
    if (rangeArg === 'rec' || rangeArg === '1-60') {
      const lv = LV.genLevel(REC, REC.seed);
      const sg = staticGates(lv, REC);
      const g = B.runLevel(lv, 'greedy', 1);
      const line = `REC items ${lv.items.length} kinds ${sg.m.kinds} margin ${sg.m.margin.toFixed(2)} greedy ${g.win ? g.tUsed.toFixed(1) + 's' : 'LOSS'} ` + (sg.fails.length ? 'static: ' + sg.fails.join('; ') : 'static PASS');
      out.push(line); if (!quiet) console.log(line);
    }
  }
  if (days) {
    // DECISION (11-04 Wed): one check per distinct (day, variant, town) level over DAILY_CURS (B shows Market from
    // cur 21, C shows Harbour from cur 45): 400 days give ~1466 levels, where cur 7 / 15 / 30 never showed Harbour.
    // --every K checks every K-th day only (a spot check).
    const tasks = [], every = Math.max(1, +(opt('--every') || 1));
    dailyKeys(days).forEach((key, d) => {
      if (d % every) return;
      const seen = new Set();
      for (const cur of DAILY_CURS) {
        const v = cur > 22 ? 2 : cur > 10 ? 1 : 0, town = LV.getDaily(key, cur).town;
        if (seen.has(v + town)) continue;
        seen.add(v + town);
        tasks.push([key, cur]);
      }
    });
    // the same layout at the same T (variants A/B/C share it on 6 days in 10) runs once; its copies reuse the result
    const sigOf = (key, cur) => { const lv = LV.getDaily(key, cur); return key + '|' + lv.town + '|' + lv.T + '|' + lv.items.length + ':' + lv.items.reduce((q, o) => q + o.x * 3.1 + o.z * 1.7 + o.a, 0).toFixed(3); };
    const first = new Map(), copies = [], uniq = [];
    for (const t of tasks) { const g = sigOf(t[0], t[1]); if (first.has(g)) copies.push([t, first.get(g)]); else { first.set(g, t); uniq.push(t); } }
    const res = [], byT = new Map();
    const got = r => { res.push(r); byT.set(r.key + '|' + r.cur, r); if (r.fails.length && !quiet) console.log(dailyLine(r)); };
    if (jobs > 1) {
      const chunks = [];
      for (let i = 0; i < uniq.length; i += 8) chunks.push(uniq.slice(i, i + 8));
      await pool(chunks, jobs, c => ['--dvchild', JSON.stringify(c), '--runs', String(runs)], m => { for (const r of m) got(r); });
    } else for (const [key, cur] of uniq) { const r = verifyDaily(key, cur, { runs: Math.min(runs, 20) }); got({ key, cur, town: r.town, arch: r.arch, T: r.T, st: r.st, fails: r.fails }); }
    for (const [[key, cur], src] of copies) { const r = byT.get(src[0] + '|' + src[1]); if (r) res.push({ ...r, key, cur }); }
    res.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.cur - b.cur));
    const dbad = res.filter(r => r.fails.length);
    for (const r of dbad) out.push(dailyLine(r));
    const line = `daily: ${res.length - dbad.length}/${tasks.length} pass (${days} days${every > 1 ? `, every ${every}th day` : ''}: each day × variant × town level, ${uniq.length} distinct layouts run${res.length < tasks.length ? `; ${tasks.length - res.length} not finished` : ''})`;
    out.push(line); console.log(line);
    if (dbad.length || res.length < tasks.length) bad++;
  }
  let km = null;
  if (write || args.includes('--kindmax')) {
    const r = await computeKindMax({ days: 400, specs });
    km = r.kindMax;
    const line = `kindMax: ${Object.keys(km).length} kinds, total ${Object.values(km).reduce((p, q) => p + q, 0)}, feast ${r.feast ? 'from feast.js' : 'pending (+' + FEAST_PAD + ' pad)'}`;
    out.push(line); console.log(line);
  }
  if (write) writeLevelsData(DATA_PATH, specs, REC, km || KM_OLD);
  report(out, args.includes('--append'), rpath);
  console.log(bad ? `${bad} failing` : 'all checked levels pass');
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
