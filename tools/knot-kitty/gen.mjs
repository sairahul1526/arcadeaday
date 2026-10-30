// Knot Kitty offline level generator + curator (GDD §4, §5). Run from the repo root:
//   node tools/knot-kitty/gen.mjs --band C [--secs 90]     one band (levels run in sequence)
//   node tools/knot-kitty/gen.mjs --level 14 [--secs 90]   one level
//   node tools/knot-kitty/gen.mjs --daily [--part 0/6]     daily boards (a slice of 0..59)
//   node tools/knot-kitty/gen.mjs --merge                  rebuild data files + report from parts
// Each finished level is saved to studio/2026-10-16/prod-levels/parts/ and the data files are rebuilt
// (merged by id) after every level, so parallel band processes never lose each other's work.
//
// DECISION: strand counts are multiples of 3 (every colour count is a multiple of its spool size).
// DECISION: L21–30 use 4 colours, not 5: with tomato/plum and teal/lime banned together before L31,
//   any 5 of the 6 colours would break that rule. 5 colours start at L31.
// DECISION: bot targets are soft (curation score), not hard rejects; misses are flagged in the report.
//   Hard gates: geometry, free0, minX, acyclic twists, exact solve, par range, teach-level constraints.
// DECISION: gapCasual in the curation score = 1.2 (the §5.3 casual star-separation line).
import { writeFileSync, readFileSync, mkdirSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, strandCurve, arcLengths, intersect, distPointPoly, buildPuzzle, initState, cloneState, legalMoves, pull,
  solve, makeSolver, botStats, starsFor } from '../../games/knot-kitty/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GAME = join(ROOT, 'games', 'knot-kitty');
const OUT = join(ROOT, 'studio', '2026-10-16', 'prod-levels');
// KK_PARTS: alternate parts dir (v2 work dir); KK_NOMERGE=1: don't rebuild the game data files after each level.
const PARTS = process.env.KK_PARTS || join(OUT, 'parts');

const MIN_ANG = 38, END_CLEAR = 0.5, X_SEP = 0.62, NEAR = 0.5, PEG_CLEAR = 0.45;
const RAINBOW = 6;
export const MINX = n => Math.round(0.6 * n);
// DECISION: free0 may exceed the band's upper bound by 2 (sparser weaves leave a few uncrossed strands free).
const FREE_SLACK = 2;
// DECISION (v2): denser boards are mostly 2-peg strands, which cross ~0.65x their count, so a board may start with
//   up to PIECE_SLACK free strands beyond its crossing-graph piece count, and at most MAX_EXTRA_FREE over the band's free0 + slack.
const PIECE_SLACK = 1, MAX_EXTRA_FREE = 3;
// segment lengths (proto: 2.2–4.6 for 2-peg strands, 1.7–3.2 per segment otherwise)
// DECISION: shorter segments (2-peg 1.6–3.6, else 1.4–2.6 per segment) and a length penalty in placement
//   so strands pack; the proto lengths could not fit even 12 strands on 6×7 under the §3.1 geometry rules.
// DECISION (v2): placement score favours crossings (xW 3, −4 for a strand crossing nothing) over shortness, with
//   2-peg strands up to 4.2 long, so dense boards still weave (~0.6–0.7 crossings per strand).
export const GEO = { min2: 1.6, max2: 4.2, minS: 1.4, maxS: 2.6, lenW: 0.1, bt: 200, xW: 3, zeroPen: 4, tries: 300, early: 100, over: 3, btOver: 60, covW: 0.15, covUntil: 0.4 };
const COV_R = 0.6, COV_MIN = 0.88; // share of board (or silhouette) grid points within COV_R of a strand

// ------------------------------------------------------------------ level plan
const NAMES = [null,
  'First Pull', 'Over & Under', 'The Basket', 'Spool Order', 'Next in Line', 'Cosy Corner', 'Leaf Pile', 'Tied Up', 'Double Zip', 'Cat Head',
  'Pumpkin Spice', 'Candle Glow', 'Twin Knots', 'Lock & Key', 'Hidden Key', 'Sharp Scissors', 'Trick or Treat', 'Bat Wings', 'Locked Pantry', 'Pumpkin Patch',
  'Mystery Yarn', 'Snowfall', 'Frosty Lock', 'Grey Mittens', 'Fireside', 'Sledge Ride', 'Icicle Knots', 'Cat Nap', 'Sleepy Toes', 'Heartstrings',
  'Latte Art', 'Muffin Tin', 'Tea for Two', 'Lazy Paws', 'Rainbow', 'Sprinkles', 'Saucer Snooze', 'Painted Cups', 'Barista Knot', 'Moon Knot',
  'Dusty Trunk', 'Big Spool', 'Old Lantern', 'Owl Feathers', 'Moth Wings', 'Cobweb Lace', 'Rocking Chair', 'Hatbox', 'Cold Snap', 'Star Tangle',
  'Chimney Pots', 'Comet Tail', 'Night Lock', 'Owl Watch', 'Milky Way', 'Satellite', 'Aurora', 'Meteor Shower', 'Last Light', 'Kitten Knot'];

// DECISION (v2): strand counts back up to the GDD §4.2 bands (rounded to multiples of 3), made packable by a
//   mostly 2-peg strand mix (see GEO / segsFor). Teach levels −3 vs their band (§5.1). Bosses and 8×10 caps below.
//   genOne still drops 3 strands if a level finds no valid level in 30 % of its budget.
// DECISION (v2): boss masks (even widened by one grid step) hold 18 strands at most under §3.1, so bosses get 18
//   and are made peaks by the dressing (tighter basket, deeper stacks, harder queues), not by size. 8×10 levels
//   cap at 21: 24 packs on ~60 % of seeds but then fails the crossings / free-at-start gates almost always.
// DECISION (fix2): with the enlarged moon / star / heart / kitten silhouettes every boss holds 18 strands (L40 / L50
//   were 15, L10 15). 21 was tried: it packs on the silhouettes only with a 1.0 halo on ~1 seed in 4, mostly with
//   10–11 crossings (under minX 13), and the few valid 21-strand bosses played off-curve (L30: expert 77 %; L60:
//   casual 34 %, above L59), so bosses are made peaks by dressing, not size.
const STRANDS = [0, 3, 6, 9, 12, 12, 15, 15, 12, 15, 18,
  15, 15, 15, 12, 15, 18, 18, 18, 18, 18,
  15, 18, 18, 18, 18, 18, 21, 18, 21, 18,
  18, 21, 21, 21, 18, 21, 21, 21, 21, 18,
  21, 18, 21, 21, 21, 21, 21, 21, 21, 18,
  21, 21, 21, 21, 21, 21, 21, 21, 21, 18];
// DECISION (v2): per-level casual first-try win-rate aim: a smooth ramp inside each GDD band, teach levels and
//   post-boss breathers above the band middle, every boss below both neighbours, L60 the lowest.
// DECISION (fix2): band B pulled toward 60–70 % (L4 0.86→0.76, L5 0.80→0.71, L8 0.80→0.68), still a smooth ramp; L10 boss 0.55.
const AIM = [0, 1, 1, 0.92, 0.76, 0.71, 0.70, 0.66, 0.68, 0.63, 0.55,
  0.74, 0.68, 0.64, 0.72, 0.60, 0.62, 0.58, 0.56, 0.53, 0.47,
  0.64, 0.56, 0.53, 0.50, 0.47, 0.52, 0.48, 0.55, 0.45, 0.39,
  0.52, 0.47, 0.44, 0.42, 0.50, 0.44, 0.42, 0.40, 0.38, 0.33,
  0.50, 0.48, 0.42, 0.40, 0.38, 0.40, 0.38, 0.36, 0.42, 0.31,
  0.44, 0.38, 0.36, 0.34, 0.33, 0.36, 0.34, 0.32, 0.31, 0.26];

// twists per level: k knots, l locks, m mystery, p paws, r rainbow, j jumbo, i ice thaw
const TW = {
  8: { k: 1, teach: 'knot' }, 9: { k: 1 }, 10: { k: 1 }, 12: { k: 1 }, 13: { k: 2 },
  14: { l: 1, teach: 'lock' }, 15: { l: 1, k: 1 }, 16: { l: 1 }, 17: { l: 1, k: 1 }, 18: { k: 2 }, 19: { l: 2 }, 20: { k: 1, l: 1 },
  21: { m: 2, teach: 'mystery' }, 22: { m: 2, k: 1 }, 23: { l: 1 }, 24: { m: 3 }, 25: { k: 1, l: 1 }, 26: { m: 2, l: 1 }, 27: { k: 2 },
  28: { p: 1, pn: 4, teach: 'paw' }, 29: { p: 1, k: 1 }, 30: { p: 1, l: 1, k: 1 },
  31: { p: 2 }, 32: { m: 3, k: 1 }, 33: { l: 2 }, 34: { p: 1, m: 2 }, 35: { r: 1, teach: 'rainbow' }, 36: { r: 1, k: 2 }, 37: { l: 1, p: 1 },
  38: { r: 1, m: 3 }, 39: { k: 2, l: 1 }, 40: { k: 2, p: 1, r: 1 },
  41: { m: 2, l: 1 }, 42: { j: 1, teach: 'jumbo' }, 43: { j: 1, k: 1 }, 44: { r: 1, p: 1 }, 45: { j: 1, l: 1 },
  46: { k: 2, m: 3 }, 47: { p: 2, l: 1 }, 48: { j: 1, r: 1 }, 49: { i: 2, teach: 'ice' }, 50: { k: 2, l: 1, i: 2 },
  51: { i: 3, k: 1 }, 52: { i: 2, j: 1 }, 53: { r: 1, l: 2 }, 54: { p: 1, m: 3 }, 55: { k: 2, j: 1 },
  56: { i: 2, k: 1, m: 3 }, 57: { r: 1, l: 1, p: 1 }, 58: { j: 1, k: 2, i: 3 }, 59: { l: 2, p: 1, m: 3 }, 60: { k: 2, l: 1, r: 1 },
};

const BANDS = { A: [1, 5], B: [6, 10], C: [11, 15], D: [16, 20], E: [21, 25], F: [26, 30], G: [31, 35], H: [36, 40], I: [41, 45], J: [46, 50], K: [51, 55], L: [56, 60], M: [56, 60] };

function specFor(id) {
  const n = STRANDS[id];
  const s = { id, name: NAMES[id], n, tw: TW[id] || {}, shape: null, minChoice: id === 3 ? 1 : id <= 10 ? 2 : 3 };
  const row = (cols, rows, ncol, cap, jitter, segs, free0, par, cas, avg, exp) => Object.assign(s, { cols, rows, ncol, cap, jitter, segs, free0, par, tgt: { casual: cas, average: [avg, 1], expert: [exp, 1] } });
  s.aim = AIM[id];
  if (id === 1) row(4, 4, 1, 3, 0, [1, 0, 0], [1, 1], [0, 0], [1, 1], 1, 1);
  else if (id === 2) row(5, 5, 2, 3, 0, [0.5, 0.5, 0], [1, 1], [0, 0], [1, 1], 1, 1);
  else if (id === 3) row(6, 6, 3, 3, 9, [0.5, 0.5, 0], [2, 2], [1, 1], [0.85, 1], 0.95, 1);
  else if (id <= 5) row(6, 7, 4, 4, 9, [0.5, 0.4, 0.1], [2, 3], [1, 1], [0.68, 0.82], 0.9, 1);
  else if (id === 30) { row(8, 10, 4, 5, 12, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.35, 0.55], 0.65, 0.88); s.shape = 'heart'; }
  else if (id <= 9) row(7, 8, 4, 4, 9, [0.45, 0.4, 0.15], [2, 3], [1, 1], [0.6, 0.72], 0.85, 0.95);
  else if (id === 10) { row(7, 9, 4, 4, 10, [0.4, 0.4, 0.2], [2, 3], [1, 2], [0.5, 0.62], 0.8, 0.95); s.shape = 'cathead'; }
  else if (id <= 15) row(7, 8, 4, 4, 10, [0.4, 0.4, 0.2], [2, 3], [1, 2], [0.55, 0.75], 0.8, 0.92);
  else if (id <= 19) row(7, 9, 4, 4, 10, [0.4, 0.4, 0.2], [2, 3], [1, 2], [0.5, 0.7], 0.75, 0.9);
  else if (id === 20) { row(8, 9, 4, 4, 11, [0.35, 0.45, 0.2], [2, 3], [2, 2], [0.45, 0.6], 0.7, 0.9); s.shape = 'pumpkin'; }
  else if (id <= 25) row(7, 9, 4, 4, 11, [0.35, 0.45, 0.2], [2, 4], [1, 2], [0.45, 0.65], 0.72, 0.9);
  else if (id <= 29) row(8, 9, 4, 4, 11, [0.35, 0.45, 0.2], [2, 4], [2, 2], [0.4, 0.6], 0.7, 0.88);
  else if (id <= 35) row(8, 9, 5, 4, 12, [0.3, 0.5, 0.2], [2, 4], [2, 2], [0.38, 0.55], 0.65, 0.88);
  else if (id <= 39) row(8, 10, 5, 5, 12, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.35, 0.5], 0.62, 0.85);
  else if (id === 40) { row(8, 10, 5, 5, 12, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.3, 0.45], 0.6, 0.85); s.shape = 'moon'; }
  else if (id <= 45) row(8, 10, 5, 5, 12, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.33, 0.5], 0.6, 0.85);
  else if (id <= 49) row(8, 10, 5, 5, 13, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.3, 0.45], 0.58, 0.85);
  else if (id === 50) { row(8, 10, 5, 5, 13, [0.3, 0.5, 0.2], [3, 4], [3, 3], [0.28, 0.42], 0.55, 0.82); s.shape = 'star'; }
  else if (id <= 55) row(8, 10, 5, 5, 13, [0.3, 0.5, 0.2], [3, 4], [2, 3], [0.28, 0.45], 0.55, 0.82);
  else if (id <= 59) row(8, 10, 5, 5, 13, [0.3, 0.5, 0.2], [3, 4], [3, 3], [0.25, 0.4], 0.52, 0.8);
  else { row(8, 10, 5, 5, 13, [0.3, 0.5, 0.2], [3, 4], [3, 3], [0.25, 0.38], 0.5, 0.8); s.shape = 'kitten'; }
  // breather after each boss: casual target +10
  if ([11, 21, 31, 41, 51].includes(id)) s.tgt.casual = s.tgt.casual.map(x => Math.min(1, x + 0.1));
  if (id <= 30 && s.ncol > 4) s.ncol = 4;
  s.segs = segsFor(s.n, s.segs);
  s.boss = id % 10 === 0;
  // DECISION (v2): late bosses may need a peak of 4 in the 5-slot basket; that tightness is what makes them peaks.
  if (id === 20) s.par = [2, 3];
  if (id === 40) s.par = [2, 4];
  if (id >= 50 && s.boss) s.par = [3, 4];
  // DECISION: minX = round(0.6 × strands) (L3: 5, L4–5: 7), not 1.1 ×: measured on the GDD boards under the
  //   §3.1 geometry rules, 12 strands on 7×8 give a median of 7–8 crossings and 1.1 × was never reached.
  s.minX = id <= 2 ? (id === 2 ? 5 : 2) : id === 3 ? 5 : id <= 5 ? 7 : MINX(n);
  if (s.n % 3) throw new Error('strand count not a multiple of 3 for L' + id);
  return s;
}

// DECISION (v2): boards with 12+ strands use a mostly 2-peg mix (GDD .3/.5/.2 packs ~20 % fewer strands under §3.1).
function segsFor(n, gdd) { return n >= 12 ? [0.85, 0.15, 0] : gdd; }

const DAILY_TW = ['k', 'l', 'm', 'p', 'r'];
function dailySpec(i) {
  const r = rng(777 + i * 31);
  // DECISION (v2): 24 strands on 8×10 pass the crossing / free-start gates too rarely; dailies use 21 (r() still drawn so twists keep their seeds).
  const n = r() < 0.5 ? 21 : 21;
  const a = DAILY_TW[(r() * 5) | 0];
  let b = a; while (b === a) b = DAILY_TW[(r() * 5) | 0];
  const tw = {};
  for (const t of [a, b]) {
    if (t === 'k') tw.k = 1 + ((r() * 2) | 0);
    if (t === 'l') tw.l = 1 + ((r() * 2) | 0);
    if (t === 'm') tw.m = 2 + ((r() * 2) | 0);
    if (t === 'p') tw.p = 1;
    if (t === 'r') tw.r = 1;
  }
  return { id: 1000 + i, daily: i, name: 'Daily Knot', n, tw, shape: null, minChoice: 3, cols: 8, rows: 10, ncol: 5, cap: 5, jitter: 12,
    segs: segsFor(n, [0.3, 0.5, 0.2]), free0: [3, 4], par: [2, 3], aim: 0.45, tgt: { casual: [0.35, 0.55], average: [0.55, 1], expert: [0.85, 1] }, minX: MINX(n) };
}

// ------------------------------------------------------------------ shapes (§4.4)
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
}
// DECISION: star inner radius 0.72 (not 0.55): thinner points left no room for 12+ strands at 38°+ crossings on 8x10.
const STAR = Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 5, R = k % 2 ? 0.72 : 1.15; return [Math.cos(a) * R, Math.sin(a) * R + 0.08]; });
export const SHAPES = {
  pumpkin: (X, Y) => (X / 0.92) ** 2 + ((Y - 0.12) / 0.8) ** 2 <= 1 || (Math.abs(X) < 0.16 && Y < -0.55),
  cathead: (X, Y) => X * X + (Y - 0.15) ** 2 <= 0.85 ** 2 || inPoly(X, Y, [[-0.9, -0.15], [-0.8, -1.05], [-0.2, -0.62]]) || inPoly(X, Y, [[0.9, -0.15], [0.8, -1.05], [0.2, -0.62]]),
  heart: (X, Y) => { const x = X * 1.14, y = 0.125 - Y * 1.125; return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0; },
  moon: (X, Y) => X * X + Y * Y <= 1.0 && (X - 0.7) ** 2 + (Y + 0.25) ** 2 >= 0.62 ** 2,
  star: (X, Y) => inPoly(X, Y, STAR),
  kitten: (X, Y) => X * X + (Y + 0.45) ** 2 <= 0.52 ** 2 || (X / 0.88) ** 2 + ((Y - 0.42) / 0.58) ** 2 <= 1 || inPoly(X, Y, [[-0.5, -0.6], [-0.42, -1.05], [-0.12, -0.9]]) || inPoly(X, Y, [[0.5, -0.6], [0.42, -1.05], [0.12, -0.9]]),
};
// DECISION (v2, render review): boss masks now trace the exact silhouette render.js shapePath() paints on the
//   felt (same circles / beziers / polygons, in peg units), so the strand cloud fills the drawn patch instead of
//   the old board-stretched ellipse masks (which left parts of the patch bare and spilled strands off it).
const TAU = Math.PI * 2;
function arcPts(cx, cy, r, a0, a1, ccw = false, k = 48, ry = r) {
  let d = a1 - a0;
  if (!ccw && d <= 0) d += TAU;
  if (ccw && d >= 0) d -= TAU;
  return Array.from({ length: k + 1 }, (_, i) => { const a = a0 + (d * i) / k; return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry]; });
}
function bez(p0, p1, p2, p3, k = 24) {
  return Array.from({ length: k + 1 }, (_, i) => { const t = i / k, u = 1 - t; return [0, 1].map(j => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]); });
}
// DECISION (fix2): moon / star / heart / kitten silhouettes enlarged in render.js (moon ~60 %, star ~56 %, heart ~62 %,
//   kitten ~65 % of the board, were 36 / 32 / 49 / 60 %) so bosses hold 18–21 strands; MOON matches render.js.
const MOON = (() => {
  const bx = 1.0, by = -0.25, q = 0.78, d = Math.hypot(bx, by), phi = Math.atan2(by, bx), al = Math.acos((1 + d * d - q * q) / (2 * d));
  const P1 = [Math.cos(phi + al), Math.sin(phi + al)], P2 = [Math.cos(phi - al), Math.sin(phi - al)];
  return { bx, by, q, o0: phi + al, o1: phi - al, b0: Math.atan2(P2[1] - by, P2[0] - bx), b1: Math.atan2(P1[1] - by, P1[0] - bx) };
})();
export function silhouette(shape, cols, rows) {
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2, rx = (cols - 1 + 0.7) / 2, ry = (rows - 1 + 0.7) / 2;
  const P = [];
  if (shape === 'pumpkin') {
    const ex = rx * 0.98, ey = ry * 0.84, oy = cy + ry * 0.1;
    P.push(arcPts(cx, oy, ex, 0, TAU, false, 64, ey));
    P.push([[cx - 0.35, oy - ey + 0.1], [cx - 0.25, cy - ry], [cx + 0.3, cy - ry - 0.1], [cx + 0.35, oy - ey + 0.1]]);
  } else if (shape === 'cathead') {
    const r = Math.min(rx, ry * 0.85), oy = cy + ry - r;
    P.push(arcPts(cx, oy, r, 0, TAU, false, 64));
    P.push([[cx - r * 0.95, oy - r * 0.2], [cx - r * 0.8, cy - ry], [cx - r * 0.2, oy - r * 0.92]]);
    P.push([[cx + r * 0.95, oy - r * 0.2], [cx + r * 0.8, cy - ry], [cx + r * 0.2, oy - r * 0.92]]);
  } else if (shape === 'heart') {
    P.push([...bez([cx, cy + ry], [cx - rx * 1.38, cy], [cx - rx * 1.16, cy - ry * 1.5], [cx, cy - ry * 0.62]),
      ...bez([cx, cy - ry * 0.62], [cx + rx * 1.16, cy - ry * 1.5], [cx + rx * 1.38, cy], [cx, cy + ry])]);
  } else if (shape === 'moon') {
    const m = MOON;
    P.push([...arcPts(cx, cy, rx, m.o0, m.o1, false, 64, ry), ...arcPts(cx + m.bx * rx, cy + m.by * ry, m.q * rx, m.b0, m.b1, true, 48, m.q * ry)]);
  } else if (shape === 'star') {
    const Rx = rx / Math.cos(Math.PI / 10), Ry = (2 * ry) / (1 + Math.cos(Math.PI / 5)), oy = cy - ry + Ry;
    P.push(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? 0.65 : 1; return [cx + Math.cos(a) * q * Rx, oy + Math.sin(a) * q * Ry]; }));
  } else if (shape === 'kitten') {
    const hr = Math.min(rx * 0.74, ry * 0.44), hy = cy - ry + hr * 1.35;
    P.push(arcPts(cx, hy, hr, 0, TAU, false, 64));
    P.push([[cx - hr * 0.95, hy - hr * 0.2], [cx - hr * 0.8, hy - hr * 1.3], [cx - hr * 0.2, hy - hr * 0.92]]);
    P.push([[cx + hr * 0.95, hy - hr * 0.2], [cx + hr * 0.8, hy - hr * 1.3], [cx + hr * 0.2, hy - hr * 0.92]]);
    P.push(arcPts(cx, cy + ry * 0.34, rx * 0.98, 0, TAU, false, 64, ry * 0.64));
  } else return null;
  return P;
}
export const inShape = (shape, cols, rows) => { const P = silhouette(shape, cols, rows); return (x, y) => P.some(poly => inPoly(x, y, poly)); };
function pegSet(spec, dil = 0) {
  const all = [];
  for (let x = 0; x <= (spec.cols - 1) * 2; x++) for (let y = 0; y <= (spec.rows - 1) * 2; y++) all.push([x / 2, y / 2]);
  if (!spec.shape) return all;
  const ins = inShape(spec.shape, spec.cols, spec.rows);
  const base = all.filter(p => ins(p[0], p[1]));
  if (!dil) return base;
  return all.filter(p => base.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= dil + 1e-9));
}

// ------------------------------------------------------------------ geometry (proto, + mask + segs probs)
// DECISION (v2): geometry aims for n + GEO.over strands and keeps the best set reached; if it holds >= n strands
//   the least-crossed strands are dropped down to n. Dropping uncrossed filler strands raises crossings per strand
//   and lowers the free-at-start floor (crossing-graph pieces).
function genGeometry(spec, r, pegs) {
  const n = spec.n, want = n + (n >= 12 ? GEO.over : 0);
  const strands = [], xsOf = [];
  let backtracks = 0, bestSet = null;
  genGeometry.max = 0;
  // DECISION (v2, render review): strands spread over the whole board (or the boss silhouette). A candidate
  //   earns GEO.covW per target point within COV_R of it that no strand covers yet.
//   Weight 0.15 on plain boards for the first 40 % of strands (a spread skeleton; the rest pack around it). Also
//   lifts crossings to ~0.75–0.9 × n (longer, spread strands cross more). Weighting every strand packed too few.
  //   0 on boss silhouettes, which their own mask already spreads (90–95 % covered).
  const covW = spec.shape ? 0 : GEO.covW;
  const tgt = pegSet(spec, 0), cov = new Uint8Array(tgt.length);
  const covers = (c, i) => { const p = tgt[i]; const b = c._bb || (c._bb = bbox(c)); return p[0] > b[0] - COV_R && p[0] < b[2] + COV_R && p[1] > b[1] - COV_R && p[1] < b[3] + COV_R && distPointPoly(p[0], p[1], c.pts) < COV_R; };
  const recover = () => { cov.fill(0); for (const st of strands) for (let i = 0; i < tgt.length; i++) if (!cov[i] && covers(st, i)) cov[i] = 1; };
  const gain = c => { let g = 0; for (let i = 0; i < tgt.length; i++) if (!cov[i] && covers(c, i)) g++; return g; };
  while (strands.length < want) {
    if (strands.length > genGeometry.max) genGeometry.max = strands.length;
    if (strands.length >= n && (!bestSet || strands.length > bestSet.s.length)) bestSet = { s: strands.slice(), x: xsOf.slice() };
    const allX = xsOf.flat();
    const avail = [];
    for (const [px, py] of pegs) {
      if (strands.some(s => s.pegs.some(q => Math.hypot(q[0] - px, q[1] - py) < 0.9))) continue;
      if (strands.some(s => distPointPoly(px, py, s.pts) < PEG_CLEAR + 0.02)) continue;
      avail.push([px, py]);
    }
    const u = r();
    const segCount = u < spec.segs[0] ? 1 : u < spec.segs[0] + spec.segs[1] ? 2 : 3;
    let best = null;
    for (let tries = 0; tries < GEO.tries; tries++) {
      const cand = makeCandidate(spec, r, avail, tries > GEO.tries / 2 ? Math.max(1, segCount - 1) : segCount);
      if (!cand) continue;
      const ok = check(cand, strands, allX);
      if (!ok) continue;
      const score = GEO.xW * ok.length - (ok.length ? 0 : strands.length >= 2 ? GEO.zeroPen : 0) - GEO.lenW * cand.at[cand.at.length - 1] + (strands.length < GEO.covUntil * n ? covW * gain(cand) : 0) + r() * 0.8;
      if (!best || score > best.score) best = { cand, xs: ok, score };
      if (tries > GEO.early && best) break;
    }
    if (!best) {
      if (++backtracks > (bestSet ? GEO.btOver : GEO.bt)) break;
      const drop = Math.min(strands.length, 1 + ((r() * 3) | 0));
      strands.splice(strands.length - drop, drop);
      xsOf.splice(xsOf.length - drop, drop);
      recover();
      continue;
    }
    strands.push(best.cand);
    xsOf.push(best.xs);
    for (let i = 0; i < tgt.length; i++) if (!cov[i] && covers(best.cand, i)) cov[i] = 1;
  }
  if (strands.length >= want) bestSet = { s: strands, x: xsOf };
  if (!bestSet) return null;
  genGeometry.max = Math.max(genGeometry.max, bestSet.s.length);
  // prune to n: drop the strand with the fewest crossings (ties: shortest), repeat
  let S = bestSet.s.slice();
  let P = [];
  bestSet.s.forEach((s, i) => bestSet.x[i].forEach(x => P.push([s, x.o])));
  const len = s => s.at[s.at.length - 1];
  while (S.length > n) {
    const cnt = new Map(S.map(s => [s, 0]));
    for (const [a, b] of P) { cnt.set(a, cnt.get(a) + 1); cnt.set(b, cnt.get(b) + 1); }
    let w = S[0];
    for (const s of S) if (cnt.get(s) < cnt.get(w) || (cnt.get(s) === cnt.get(w) && len(s) < len(w))) w = s;
    S = S.filter(s => s !== w);
    P = P.filter(([a, b]) => a !== w && b !== w);
  }
  const X = P;
  const cv = new Uint8Array(tgt.length);
  for (const st of S) for (let i = 0; i < tgt.length; i++) if (!cv[i] && covers(st, i)) cv[i] = 1;
  return { strands: S, xCount: X.length, cover: cv.reduce((a, b) => a + b, 0) / tgt.length };
}

function makeCandidate(spec, r, free, segs) {
  if (free.length < segs + 1) return null;
  const pegs = [free[(r() * free.length) | 0]];
  for (let s = 0; s < segs; s++) {
    const last = pegs[pegs.length - 1];
    const minD = segs === 1 ? GEO.min2 : GEO.minS, maxD = segs === 1 ? GEO.max2 : GEO.maxS;
    const opts = free.filter(p => {
      if (pegs.some(q => q[0] === p[0] && q[1] === p[1])) return false;
      const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      if (d < minD || d > maxD) return false;
      if (pegs.length >= 2) {
        const prev = pegs[pegs.length - 2];
        const ax = last[0] - prev[0], ay = last[1] - prev[1], bx = p[0] - last[0], by = p[1] - last[1];
        const turn = (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))))) * 180) / Math.PI;
        if (turn > 100 || turn < 25) return false;
      }
      return true;
    });
    if (!opts.length) return null;
    pegs.push(opts[(r() * opts.length) | 0]);
  }
  const bow = segs === 1 ? (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.07) : 0;
  const pts = strandCurve(pegs, bow);
  for (const p of pts) if (p[0] < -0.35 || p[1] < -0.35 || p[0] > spec.cols - 0.65 || p[1] > spec.rows - 0.65) return null;
  return { pegs, bow, pts, at: arcLengths(pts) };
}

function bbox(c) {
  if (c.bb) return c.bb;
  let a = Infinity, b = Infinity, d = -Infinity, e = -Infinity;
  for (const p of c.pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[0]); e = Math.max(e, p[1]); }
  return (c.bb = [a, b, d, e]);
}
function check(c, strands, allX) {
  const mine = [];
  const cb = bbox(c), m = NEAR + 0.05;
  for (const o of strands) {
    const ob = bbox(o);
    if (ob[0] > cb[2] + m || ob[2] < cb[0] - m || ob[1] > cb[3] + m || ob[3] < cb[1] - m) { o._skip = true; continue; }
    o._skip = false;
    for (const p of c.pegs) if (distPointPoly(p[0], p[1], o.pts) < PEG_CLEAR) return null;
    for (const p of o.pegs) if (distPointPoly(p[0], p[1], c.pts) < PEG_CLEAR) return null;
  }
  for (const o of strands) {
    if (o._skip) continue;
    const X = intersect(c.pts, c.at, o.pts, o.at);
    if (X.length > 1) return null;
    for (const x of X) {
      if (x.ang < MIN_ANG) return null;
      if (x.sa < END_CLEAR || x.sa > c.at[c.at.length - 1] - END_CLEAR) return null;
      if (x.sb < END_CLEAR || x.sb > o.at[o.at.length - 1] - END_CLEAR) return null;
      for (const y of allX) if (Math.hypot(x.x - y.x, x.y - y.y) < X_SEP) return null;
      for (const y of mine) if (Math.hypot(x.x - y.x, x.y - y.y) < X_SEP) return null;
      x.o = o;
      mine.push(x);
    }
    const near = (P, Q) => {
      for (let i = 0; i < P.length; i += 2) {
        const p = P[i];
        if (X.length && Math.hypot(p[0] - X[0].x, p[1] - X[0].y) < 0.75) continue;
        if (distPointPoly(p[0], p[1], Q) < NEAR) return true;
      }
      return false;
    };
    if (near(c.pts, o.pts) || near(o.pts, c.pts)) return null;
  }
  return mine;
}

// ------------------------------------------------------------------ helpers
const bit = i => (1 << i) >>> 0;
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Palette subset for a level (§7.2). */
function palette(spec, r) {
  const k = spec.ncol;
  if (spec.id <= 20) return shuffle([0, 1, 2, 3], r).slice(0, k);
  if (spec.id <= 30 && !spec.daily && spec.daily !== 0) {
    const set = [r() < 0.5 ? 0 : 4, r() < 0.5 ? 1 : 5, 2, 3];
    return shuffle(set, r).slice(0, k);
  }
  return shuffle([0, 1, 2, 3, 4, 5], r).slice(0, k);
}
/** Colour counts: n/3 spool units spread over the colours, as balanced as possible. */
function colourCounts(spec, cols, r, needSix) {
  const units = spec.n / 3, k = cols.length;
  const u = new Array(k).fill(Math.floor(units / k));
  let left = units - u.reduce((a, b) => a + b, 0);
  const order = shuffle([...Array(k).keys()], r);
  for (const i of order) if (left > 0) { u[i]++; left--; }
  if (needSix && !u.some(x => x >= 2)) return null;
  return u.map(x => x * 3);
}

/** Greedy order check (cover + lock + paw, ignoring spools): every strand can be removed. */
function orderable(puz) {
  let removed = 0, count = 0;
  for (;;) {
    if (removed === puz.full) return true;
    let moved = false;
    for (let id = 0; id < puz.n; id++) {
      if ((removed >>> id) & 1 || puz.members[id][0] !== id) continue;
      if (puz.gBlock[id] & ~removed || puz.gLock[id] & ~removed || puz.gPaw[id] > count) continue;
      removed = (removed | puz.gMask[id]) >>> 0; count += puz.members[id].length; moved = true;
    }
    if (!moved) return false;
  }
}
function topoOrder(puz, r) {
  const order = [];
  let removed = 0, count = 0;
  while (removed !== puz.full) {
    const f = [];
    for (let id = 0; id < puz.n; id++) {
      if ((removed >>> id) & 1 || puz.members[id][0] !== id) continue;
      if (puz.gBlock[id] & ~removed || puz.gLock[id] & ~removed || puz.gPaw[id] > count) continue;
      f.push(id);
    }
    if (!f.length) return null;
    const id = f[(r() * f.length) | 0];
    for (const m of puz.members[id]) order.push(m);
    removed = (removed | puz.gMask[id]) >>> 0; count += puz.members[id].length;
  }
  return order;
}
function freeGroups(puz, removed = 0) {
  const out = [];
  for (let id = 0; id < puz.n; id++) if (!((removed >>> id) & 1) && puz.members[id][0] === id && !(puz.gBlock[id] & ~removed)) out.push(id);
  return out;
}
/** Ancestors (must-go-before set) of strand i, as a bitmask. */
function ancestors(puz, i) {
  let seen = 0;
  const stack = [i];
  while (stack.length) {
    const x = stack.pop();
    let deps = puz.gBlock[x] | puz.gLock[x];
    for (let j = 0; j < puz.n; j++) if ((deps >>> j) & 1 && !((seen >>> j) & 1)) { seen = (seen | bit(j)) >>> 0; stack.push(j); }
  }
  return seen >>> 0;
}

function makeQueue(puz, colorsOf, r, jitter) {
  const order = topoOrder(puz, r);
  if (!order) return null;
  const seen = {}, spools = [];
  order.forEach((id, idx) => {
    const c = colorsOf[id];
    if (c === RAINBOW) return;
    seen[c] = (seen[c] || 0) + 1;
    if (seen[c] % 3 === 1) spools.push({ c, at: idx + (r() - 0.5) * jitter });
  });
  spools.sort((a, b) => a.at - b.at);
  return spools.map(s => s.c);
}

// ------------------------------------------------------------------ one candidate
function tryLevel(spec, seed, pegs, geoIn = null) {
  const r = rng(seed);
  const tw = spec.tw;
  const geo = geoIn || genGeometry(spec, r, pegs);
  if (!geo) return { fail: 'geo' };
  const n = geo.strands.length;
  const base = buildPuzzle({ cols: spec.cols, rows: spec.rows, cap: spec.cap, queue: [0], strands: geo.strands.map(s => ({ pegs: s.pegs, bow: s.bow, c: 0, d: 0 })) });
  if (base.crossings.length < spec.minX) return { fail: 'minX', x: base.crossings.length };
  // depth: keep the stacking maximising 2*longestChain - free (proto), within free0
  let depth = null, bestD = -Infinity;
  const pairs = base.crossings.map(x => [x.top, x.under]);
  // every connected piece of the crossing graph keeps >= 1 free strand, so free0 can't go below the piece count
  const comp = [...Array(n).keys()];
  const root = i => (comp[i] === i ? i : (comp[i] = root(comp[i])));
  for (const [a, b] of pairs) comp[root(a)] = root(b);
  const pieces = new Set([...Array(n).keys()].map(root)).size;
  const freeHi = Math.max(spec.free0[1] + FREE_SLACK, pieces + PIECE_SLACK) + (tw.k ? 1 : 0);
  if (pieces > spec.free0[1] + FREE_SLACK + MAX_EXTRA_FREE) return { fail: 'pieces' };
  for (let t = 0; t < (spec.id === 1 ? 40 : 150); t++) {
    const dp = shuffle([...Array(n).keys()], r);
    const under = Array.from({ length: n }, () => []);
    for (const [a, b] of pairs) { if (dp[a] > dp[b]) under[b].push(a); else under[a].push(b); }
    const free = under.filter(u => u.length === 0).length;
    if (free < spec.free0[0] || free > freeHi) continue;
    const memo = new Array(n).fill(-1);
    const height = i => (memo[i] >= 0 ? memo[i] : (memo[i] = 1 + Math.max(0, ...under[i].map(height))));
    const longest = Math.max(...[...Array(n).keys()].map(height));
    const sc = longest * 2 - free;
    if (sc > bestD) { bestD = sc; depth = dp; }
  }
  if (!depth) return { fail: 'depth' };
  // colours
  const cols = palette(spec, r);
  const counts = colourCounts(spec, cols, r, !!tw.j);
  if (!counts) return { fail: 'colours' };
  const colList = [];
  counts.forEach((cnt, i) => { for (let k = 0; k < cnt; k++) colList.push(cols[i]); });
  shuffle(colList, r);
  const level = {
    id: spec.id, name: spec.name, world: spec.daily !== undefined ? 0 : Math.min(6, Math.floor((spec.id - 1) / 10) + 1),
    cols: spec.cols, rows: spec.rows, cap: spec.cap, shape: spec.shape,
    strands: geo.strands.map((s, i) => ({ pegs: s.pegs, bow: +s.bow.toFixed(3), c: colList[i], d: depth[i] })),
    queue: [],
  };
  let puz = buildPuzzle({ ...level, queue: [0] });
  const S = level.strands;
  const free0 = freeGroups(puz);
  if (spec.id === 1) {
    if (free0.length !== 1 || !puz.blockers.every((b, i) => b.length === (i === free0[0] ? 0 : 1))) return { fail: 'chain' };
  }
  // ---- twists
  const used = new Set();
  if (tw.k) {
    const knots = [];
    const cands = shuffle(base.crossings.map(x => [x.top, x.under]), r);
    for (const [a0, b0] of cands) {
      if (knots.length >= tw.k) break;
      const a = puz.strands[a0].d > puz.strands[b0].d ? a0 : b0, b = a === a0 ? b0 : a0;
      if (used.has(a) || used.has(b)) continue;
      if (tw.teach === 'knot' && !(puz.blockers[a].length === 0 && puz.blockers[b].every(x => x === a))) continue;
      const trial = buildPuzzle({ ...level, queue: [0], knots: [...knots, [a, b]] });
      if (!orderable(trial)) continue;
      knots.push([a, b]); used.add(a); used.add(b);
    }
    if (knots.length < tw.k) return { fail: 'knot' };
    level.knots = knots;
    puz = buildPuzzle({ ...level, queue: [0] });
  }
  if (tw.r) {
    // one strand becomes rainbow: its colour loses one strand
    const pool = [...Array(n).keys()].filter(i => !used.has(i) && (tw.teach !== 'rainbow' || puz.gBlock[i] === 0));
    if (!pool.length) return { fail: 'rainbow' };
    const i = pool[(r() * pool.length) | 0];
    S[i].c = RAINBOW; used.add(i);
  }
  if (tw.l) {
    let lid = 0;
    for (let tries = 0; tries < 200 && lid < tw.l; tries++) {
      const x = (r() * n) | 0, y = (r() * n) | 0;
      if (x === y || used.has(x) || used.has(y) || S[x].key !== undefined || S[y].key !== undefined) continue;
      if (puz.blockers[x].length > 1) continue; // the lock should be what holds x back
      if (tw.teach === 'lock' && puz.gBlock[y] !== 0) continue; // teach: key strand free at start
      const anc = ancestors(puz, y);
      if ((anc >>> x) & 1) continue;
      S[x].lock = lid; S[y].key = lid;
      const trial = buildPuzzle({ ...level, queue: [0] });
      if (!orderable(trial)) { delete S[x].lock; delete S[y].key; continue; }
      used.add(x); lid++;
      puz = trial;
    }
    if (lid < tw.l) return { fail: 'lock' };
  }
  if (tw.p) {
    let np = 0;
    for (let tries = 0; tries < 200 && np < tw.p; tries++) {
      const x = (r() * n) | 0;
      if (used.has(x) || S[x].key !== undefined || S[x].lock !== undefined) continue;
      if (puz.blockers[x].length > (tw.teach === 'paw' ? 0 : 1)) continue;
      const N = tw.pn || 3 + ((r() * (Math.floor(n / 2) - 2)) | 0);
      S[x].paw = N;
      const trial = buildPuzzle({ ...level, queue: [0] });
      if (!orderable(trial)) { delete S[x].paw; continue; }
      used.add(x); np++; puz = trial;
    }
    if (np < tw.p) return { fail: 'paw' };
  }
  if (tw.m) {
    const covered = shuffle([...Array(n).keys()].filter(i => puz.gBlock[i] !== 0 && S[i].c !== RAINBOW), r);
    const cnt = Math.min(tw.m, Math.floor(0.3 * n));
    if (covered.length < cnt) return { fail: 'myst' };
    let chosen = covered.slice(0, cnt);
    if (tw.teach === 'mystery') {
      // one mystery strand must be uncovered by a single pull of a start-free strand
      const f0 = new Set(freeGroups(puz));
      const easy = covered.filter(i => puz.blockers[i].length === 1 && f0.has(puz.blockers[i][0]));
      if (!easy.length) return { fail: 'myst-teach' };
      chosen = [easy[0], ...covered.filter(i => i !== easy[0]).slice(0, cnt - 1)];
    }
    for (const i of chosen) S[i].m = 1;
  }
  if (tw.i) level.ice = { thaw: tw.i };
  // ---- queue
  puz = buildPuzzle({ ...level, queue: [0] });
  if (!orderable(puz)) return { fail: 'order' };
  const colorsOf = S.map(s => s.c);
  if (spec.id === 2) {
    level.queue = cols.slice(0, 2);
  } else {
    const q = makeQueue(puz, colorsOf, r, spec.jitter);
    if (!q) return { fail: 'queue' };
    level.queue = q;
  }
  if (tw.j) {
    // merge two spools of one colour (>= 6 strands) into a jumbo; teach: the first queue entry
    const cnt = {};
    for (const c of colorsOf) if (c !== RAINBOW) cnt[c] = (cnt[c] || 0) + 1;
    const q = level.queue;
    let at = -1;
    if (tw.teach === 'jumbo') { if (cnt[q[0]] >= 6) at = 0; }
    else { const opts = q.map((c, i) => i).filter(i => cnt[q[i]] >= 6 && q.indexOf(q[i], i + 1) > 0); if (opts.length) at = opts[(r() * opts.length) | 0]; }
    if (at < 0) return { fail: 'jumbo' };
    const c = q[at], j2 = q.indexOf(c, at + 1);
    if (j2 < 0) return { fail: 'jumbo' };
    q.splice(j2, 1);
    q[at] = { c, n: 6 };
  }
  if (!level.knots) delete level.knots;
  puz = buildPuzzle(level);
  const f0 = freeGroups(puz).length;
  if (f0 < spec.free0[0] || f0 > freeHi) return { fail: 'free0' };
  if (tw.teach === 'knot') {
    const fg = freeGroups(puz);
    if (fg.length > 2 || !fg.some(id => puz.members[id].length === 2)) return { fail: 'knot-teach' };
  }
  const sol = solve(puz, null, 600000);
  if (!sol.exact || sol.peak === Infinity) return { fail: 'solve' };
  if (sol.peak < spec.par[0] || sol.peak > spec.par[1]) return { fail: 'par' };
  level.par = sol.peak;
  level.sol = sol.moves;
  puz.par = sol.peak;
  return { level, puz, sol, free0: f0 };
}

function band(v, [a, b]) { return v < a ? a - v : v > b ? v - b : 0; }

// DECISION (v2): curation score adds a pull toward the level's casual aim (smooth ramp), keeps bot skill order
//   (casual <= average + 5 %), keeps boss average-bot rates near their band floor (bosses are peaks for every
//   skill level), and weights crossings a little more. 'pen' is the score without the crossing bonus.
function evaluate(spec, o, seed) {
  const { puz } = o;
  const st = {};
  st.random = botStats(puz, 'random', 300, seed + 1);
  st.casual = botStats(puz, 'casual', 300, seed + 2);
  st.average = botStats(puz, 'average', 300, seed + 3);
  st.expert = botStats(puz, 'expert', 300, seed + 4);
  const par = o.level.par;
  let s = 10 * (band(st.casual.winRate, spec.tgt.casual) + band(st.average.winRate, spec.tgt.average) + band(st.expert.winRate, spec.tgt.expert));
  if (spec.aim !== undefined) s += 8 * Math.abs(st.casual.winRate - spec.aim);
  s += 5 * Math.max(0, st.casual.winRate - st.average.winRate - 0.05);
  if (spec.boss) s += 4 * Math.max(0, st.average.winRate - spec.tgt.average[0] - 0.12);
  const cp = st.casual.avgPeak ?? par;
  if (spec.id >= 6) {
    s += 4 * Math.abs(cp - par - 1.2);
    const ep = st.expert.avgPeak ?? par + 2;
    if (ep > par + 0.6) s += 4 * (ep - par - 0.6);
    const c3 = st.casual.stars[3] / 300, e3 = st.expert.stars[3] / 300;
    if (c3 > 0.25) s += 4 * (c3 - 0.25);
    if (e3 < 0.6) s += 4 * (0.6 - e3);
  }
  return { s: s - 0.05 * puz.crossings.length, pen: s, bots: st };
}

/** Real decisions on the solver line: states with >= 2 legal moves where one of them raises the optimal peak. */
function choiceCount(puz, level, want) {
  const S = makeSolver(puz, 300000);
  const st = initState(puz);
  let choices = 0;
  for (const m of level.sol) {
    const legal = legalMoves(puz, st);
    if (legal.length >= 2) {
      let raise = false;
      for (const id of legal) {
        if (id === m) continue;
        const s0 = cloneState(st); s0.peak = s0.bt;
        const s2 = pull(puz, s0, id);
        if (s2.dead) continue;
        const v = Math.max(st.peak, s2.peak, S.f(s2));
        if (v > level.par) { raise = true; break; }
      }
      if (raise && ++choices >= want + 3) break;
    }
    pull(puz, st, m);
  }
  return choices;
}

// ------------------------------------------------------------------ search one level
// DECISION (v2): geometry is the slow part (0.1–2 s) and the dressing (depth, colours, twists, queue) decides
//   difficulty, so each geometry gets up to DRESS dressings (~50 ms each). Dressings also vary the queue jitter
//   (JIT × band jitter) to widen the difficulty spread; a quick 80-run casual screen skips far-off candidates.
//   Search stops early once a candidate's score without the crossing bonus is under GOOD (after 40 % budget).
const DRESS = 48, JIT = [1, 0.5, 1.5, 2, 0.75, 1.25], JIT_HARD = [1, 1.5, 2, 2.5, 3, 1.25], GOOD = 0.6, SCREEN = 0.2;
// DECISION (v2, render review): pegs may sit up to this far outside the painted boss silhouette (a thin halo), the
//   least that packs the boss's strand count: pumpkin / kitten / cathead 0.5, heart / moon / star 1.0 (moon and
//   star patches are small: render.js draws them inside min(rx, ry) circles, ~35 % of the board).
// DECISION (fix2): enlarged heart / moon / star start at a 0.5 halo like the others (genOne widens to 1.0 if needed).
const BOSS_DIL = { cathead: 0.5, pumpkin: 0.5, heart: 0.5, moon: 0.5, star: 0.5, kitten: 0.5 };
const GEO_FAILS = new Set(['minX', 'pieces']);
function genOne(spec, secs) {
  const t0 = Date.now();
  if (spec.boss) secs *= spec.id === 60 ? 2.5 : 1.5;
  const jits = spec.aim < 0.4 ? JIT_HARD : JIT;
  const tag = spec.daily !== undefined ? 'D' + spec.daily : 'L' + spec.id;
  let best = null, valid = 0, tried = 0, geos = 0;
  const fails = {};
  const F = k => { fails[k] = (fails[k] || 0) + 1; };
  const baseSeed = (spec.daily !== undefined ? 7000003 + spec.daily * 100003 : spec.id * 100003) + OFF * 50021;
  let dil = spec.shape ? BOSS_DIL[spec.shape] : 0, pegs = pegSet(spec, dil), reduced = 0;
  const el = () => (Date.now() - t0) / 1000;
  for (let k = 0; ; k++) {
    if (el() > secs) break;
    if (best && best.pen < GOOD && el() > secs * 0.4) break;
    if (spec.shape && !geos && dil < 1 && el() > secs * 0.2) { dil = Math.min(1, dil + 0.5); pegs = pegSet(spec, dil); }
    if (!valid && el() > secs * 0.3 * (1 + reduced) && spec.n > 9 && reduced < 2) {
      reduced++; spec = { ...spec, n: spec.n - 3, minX: MINX(spec.n - 3) };
      console.log(`${tag}: no valid level yet, strands -> ${spec.n}`);
    }
    const gseed = (baseSeed + k) >>> 0;
    const geo = spec.id <= 2 ? null : genGeometry(spec, rng(gseed), pegs);
    if (spec.id > 2 && !geo) { F('geo'); continue; }
    if (geo && geo.cover < (spec.n >= 15 ? COV_MIN : COV_MIN - 0.13)) { F('cover'); continue; } // sparse teach boards: 75 %
    geos++;
    let okHere = 0;
    for (let d = 0; d < (spec.id <= 2 ? 1 : DRESS); d++) {
      if (el() > secs) break;
      const seed = spec.id <= 2 ? gseed : (Math.imul(gseed, 97) + d * 7919 + 1) >>> 0;
      const jm = spec.id <= 2 ? 1 : jits[d % jits.length];
      tried++;
      const o = tryLevel(jm === 1 ? spec : { ...spec, jitter: spec.jitter * jm }, seed, pegs, geo);
      if (o.fail) { F(o.fail); if (GEO_FAILS.has(o.fail) || (d >= 8 && !okHere)) break; continue; }
      okHere++; valid++;
      if (spec.aim < 1) {
        const q = botStats(o.puz, 'casual', 80, seed + 9);
        if (Math.abs(q.winRate - spec.aim) > SCREEN) { F('screen'); continue; }
      }
      const ev = evaluate(spec, o, seed);
      if (ev.bots.expert.winRate === 0) { F('expert0'); continue; } // check.mjs hard gate
      let sc = ev.s, pen = ev.pen;
      if (best && sc - 3 >= best.sc) continue;
      const ch = choiceCount(o.puz, o.level, spec.minChoice);
      if (ch < spec.minChoice) { sc += 3; pen += 3; }
      if (!best || sc < best.sc) best = { ...o, ...ev, sc, pen, seed, gseed, jm, choices: ch, dil, n: spec.n };
    }
  }
  if (!best) { console.error(`${tag} ${spec.name}: NO LEVEL (${tried} tried)`, fails); return null; }
  const b = best, L = b.level, bt = b.bots;
  const pct = x => Math.round(x * 100);
  L.stats = {
    seed: b.seed, gseed: b.gseed, jit: b.jm, crossings: b.puz.crossings.length, states: b.sol.states, exact: b.sol.exact,
    random: +bt.random.winRate.toFixed(3), casual: +bt.casual.winRate.toFixed(3), average: +bt.average.winRate.toFixed(3), expert: +bt.expert.winRate.toFixed(3),
    avgPeak: { casual: bt.casual.avgPeak == null ? null : +bt.casual.avgPeak.toFixed(2), expert: bt.expert.avgPeak == null ? null : +bt.expert.avgPeak.toFixed(2) },
    stars: { casual: bt.casual.stars, average: bt.average.stars, expert: bt.expert.stars },
    choices: b.choices, free0: b.free0, reduced, aim: spec.aim, score: +b.sc.toFixed(2), valid, tried, geos, dil: b.dil,
    miss: [['casual', spec.tgt.casual], ['average', spec.tgt.average], ['expert', spec.tgt.expert]].filter(([k, t]) => band(bt[k].winRate, t) > 0).map(([k]) => k),
  };
  console.log(`${tag} ${spec.name}: n ${b.puz.n} x ${b.puz.crossings.length} par ${L.par} free0 ${b.free0} ch ${b.choices} | rnd ${pct(bt.random.winRate)} cas ${pct(bt.casual.winRate)} (aim ${pct(spec.aim)}) avg ${pct(bt.average.winRate)} exp ${pct(bt.expert.winRate)} | pk cas ${L.stats.avgPeak.casual} exp ${L.stats.avgPeak.expert} 3* c/e ${bt.casual.stars[3]}/${bt.expert.stars[3]} sc ${b.sc.toFixed(2)} [${valid}/${tried} g${geos}, ${el().toFixed(0)}s] ${JSON.stringify(fails)}`);
  return L;
}

// ------------------------------------------------------------------ output
function writeAtomic(path, text) { const tmp = path + '.' + process.pid + '.tmp'; writeFileSync(tmp, text); renameSync(tmp, path); }
function savePart(L) {
  mkdirSync(PARTS, { recursive: true });
  const name = L.id >= 1000 ? `D${String(L.id - 1000).padStart(2, '0')}.json` : `L${String(L.id).padStart(2, '0')}.json`;
  // --keep-better: a redo only replaces the part when its curation score is lower (better)
  if (args.includes('--keep-better') && existsSync(join(PARTS, name))) {
    const old = JSON.parse(readFileSync(join(PARTS, name), 'utf8'));
    if (old.stats && old.stats.score <= L.stats.score) { console.log(name, 'kept old', old.stats.score, '<=', L.stats.score); return; }
    console.log(name, 'replaced', old.stats && old.stats.score, '->', L.stats.score);
  }
  writeAtomic(join(PARTS, name), JSON.stringify(L));
}
export function merge() {
  mkdirSync(PARTS, { recursive: true });
  const files = readdirSync(PARTS).filter(f => f.endsWith('.json')).sort();
  const levels = [], dailies = [];
  for (const f of files) {
    const L = JSON.parse(readFileSync(join(PARTS, f), 'utf8'));
    if (f[0] === 'L') levels.push(L); else { L.id = 0; L.daily = +f.slice(1, 3); dailies.push(L); }
  }
  levels.sort((a, b) => a.id - b.id);
  dailies.sort((a, b) => a.daily - b.daily);
  const head = '// Generated by tools/knot-kitty/gen.mjs. Do not edit by hand (L1/L2 may be hand-tuned; check.mjs re-verifies).\n';
  writeAtomic(join(GAME, 'levels-data.js'), head + 'export default [\n' + levels.map(l => JSON.stringify(l)).join(',\n') + '\n];\n');
  writeAtomic(join(GAME, 'dailies-data.js'), head + 'export default [\n' + dailies.map(l => JSON.stringify(l)).join(',\n') + '\n];\n');
  writeReport(levels, dailies);
  return { levels: levels.length, dailies: dailies.length };
}
function twistStr(L) {
  const t = [];
  if (L.knots) t.push(`knot×${L.knots.length}`);
  const locks = L.strands.filter(s => s.lock !== undefined).length; if (locks) t.push(`lock×${locks}`);
  const m = L.strands.filter(s => s.m).length; if (m) t.push(`myst×${m}`);
  const p = L.strands.filter(s => s.paw).map(s => s.paw); if (p.length) t.push(`paw(${p.join(',')})`);
  if (L.strands.some(s => s.c === RAINBOW)) t.push('rainbow');
  if (L.queue.some(e => typeof e === 'object')) t.push('jumbo');
  if (L.ice) t.push(`ice${L.ice.thaw}`);
  return t.join(' ') || '–';
}
function writeReport(levels, dailies) {
  const pct = x => (x == null ? '–' : Math.round(x * 100));
  const st = a => (a ? `${a[1]}/${a[2]}/${a[3]}` : '–');
  const row = L => {
    const s = L.stats;
    return `| ${L.id || 'D' + L.daily} | ${L.name} | ${L.cols}×${L.rows}${L.shape ? ' ' + L.shape : ''} | ${L.strands.length} | ${s.crossings} | ${L.cap} | ${L.par} | ${s.free0} | ${s.choices} | ${twistStr(L)} | ${pct(s.random)} / ${pct(s.casual)} / ${pct(s.average)} / ${pct(s.expert)} | ${s.avgPeak.casual ?? '–'} / ${s.avgPeak.expert ?? '–'} | ${st(s.stars.casual)} | ${st(s.stars.expert)} | ${s.seed} | ${s.miss.length ? s.miss.join(',') : 'ok'} |`;
  };
  const hdr = '| id | name | board | strands | crossings | cap | par | free0 | choices | twists | win % rnd / cas / avg / exp | avg peak cas / exp | casual ★ 1/2/3 | expert ★ 1/2/3 | seed | targets |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const miss = levels.filter(l => l.stats.miss.length);
  const txt = `# Knot Kitty levels report (generated ${new Date().toISOString()})

Generated by \`node tools/knot-kitty/gen.mjs\`; verified by \`node tools/knot-kitty/check.mjs\`.
Win rates are first-try rates over 300 seeded bot games (GDD §5.2). Par = exact solver minimum basket peak.
Stars columns count bot wins by stars out of 300 runs (★ = par+2 or worse, ★★ = par+1, ★★★ = par).

Levels: ${levels.length}/60. Dailies: ${dailies.length}/60. Bot-target misses: ${miss.length ? miss.map(l => 'L' + l.id + ' (' + l.stats.miss.join(',') + ')').join(', ') : 'none'}.

## Campaign
${hdr}
${levels.map(row).join('\n')}

## Daily Knot boards
${hdr}
${dailies.map(row).join('\n')}
`;
  writeAtomic(join(OUT, 'levels-report.md'), txt);
}

// ------------------------------------------------------------------ cli
const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OFF = +(arg('--off') || 0);
if (args.includes('--lib')) { /* imported */ }
else if (args.includes('--merge')) console.log(merge());
else if (args.includes('--repar')) {
  // Re-solve every part with the current rules.js (par + sol), re-run bots when par/sol changed, then merge.
  for (const f of readdirSync(PARTS).filter(f => f.endsWith('.json')).sort()) {
    const L = JSON.parse(readFileSync(join(PARTS, f), 'utf8'));
    const puz = buildPuzzle(L);
    const r = solve(puz, null, 600000);
    if (!r.exact || r.peak === Infinity) { console.log(f, 'UNSOLVED'); continue; }
    if (r.peak === L.par && JSON.stringify(r.moves) === JSON.stringify(L.sol)) continue;
    const old = L.par;
    L.par = r.peak; L.sol = r.moves; puz.par = r.peak;
    const spec = f[0] === 'L' ? specFor(L.id) : dailySpec(+f.slice(1, 3));
    const seed = L.stats.seed, bt = {};
    for (const [k, d] of [['random', 1], ['casual', 2], ['average', 3], ['expert', 4]]) bt[k] = botStats(puz, k, 300, seed + d);
    Object.assign(L.stats, {
      random: +bt.random.winRate.toFixed(3), casual: +bt.casual.winRate.toFixed(3), average: +bt.average.winRate.toFixed(3), expert: +bt.expert.winRate.toFixed(3),
      avgPeak: { casual: bt.casual.avgPeak == null ? null : +bt.casual.avgPeak.toFixed(2), expert: bt.expert.avgPeak == null ? null : +bt.expert.avgPeak.toFixed(2) },
      stars: { casual: bt.casual.stars, average: bt.average.stars, expert: bt.expert.stars },
      miss: [['casual', spec.tgt.casual], ['average', spec.tgt.average], ['expert', spec.tgt.expert]].filter(([k, t]) => band(bt[k].winRate, t) > 0).map(([k]) => k),
    });
    savePart(L.id === 0 || f[0] === 'D' ? { ...L, id: 1000 + +f.slice(1, 3) } : L);
    console.log(f, 'par', old, '->', L.par, 'exp', L.stats.expert);
  }
  console.log(merge());
}
else {
  const secs = +(arg('--secs') || 90);
  let specs = [];
  if (arg('--band')) { const [a, b] = BANDS[arg('--band').toUpperCase()]; for (let i = a; i <= b; i++) specs.push(specFor(i)); }
  if (arg('--level')) for (const x of arg('--level').split(',')) specs.push(specFor(+x));
  if (args.includes('--daily')) {
    const [p, of] = (arg('--part') || '0/1').split('/').map(Number);
    for (let i = 0; i < 60; i++) if (i % of === p) specs.push(dailySpec(i));
  }
  if (args.includes('--missing')) {
    // regenerate anything without a part file (or listed in --redo), split over --part p/of
    const [p, of] = (arg('--part') || '0/1').split('/').map(Number);
    const have = new Set(existsSync(PARTS) ? readdirSync(PARTS) : []);
    const redo = new Set((arg('--redo') || '').split(',').filter(Boolean));
    const todo = [];
    for (let i = 1; i <= 60; i++) if (!have.has(`L${String(i).padStart(2, '0')}.json`) || redo.has('L' + i)) todo.push(specFor(i));
    for (let i = 0; i < 60; i++) if (!have.has(`D${String(i).padStart(2, '0')}.json`) || redo.has('D' + i)) todo.push(dailySpec(i));
    const only = arg('--only');
    todo.filter(s => !only || (only === 'D') === (s.daily !== undefined)).forEach((s, k) => { if (k % of === p) specs.push(s); });
  }
  for (const spec of specs) {
    const L = genOne(spec, spec.id <= 2 ? Math.min(secs, 20) : secs);
    if (L) { savePart(L); if (!process.env.KK_NOMERGE) merge(); }
  }
}
export { specFor, dailySpec, tryLevel, genGeometry };
