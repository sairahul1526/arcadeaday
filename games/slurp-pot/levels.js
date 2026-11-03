// Slurp Pot level generator (GDD §4). Levels role.
// Pure and deterministic: no DOM, no three, no Math.random, no Date. The generator only uses + − × ÷, floor, sqrt,
// min/max/abs, mulberry32, fnv1a and the 64-entry DIRS literal table (D7). Node expands every level headless.
//
// Expanded level (input of logic.createWorld and render3d.loadLevel, §13.3):
//   { n, name, town, arch, W, D, x0, x1, z0, z1, spawn: {x, z}, r0, T, timed, cap,
//     items: [{ kind, ki, x, z, a, h, k, flags, rot, lane, lu, belt, stack, zone }],
//     surfaces: [{ type, x, z, w, d, rot, color }], decor: [{ kind, x, z, rot, s }],
//     lanes: [{ ax, az, bx, bz, v }], belts: [{ x, z, w, d, rot, v }], roost, gullEvery, gulls, truckPath, cake,
//     tickets: [{ lines: [{ kind, need, place }], boss: itemIndex }], zones: [{ id, x, z, parent, gate, r }], seed }
// Item fields: `kind` = catalog id string, `ki` = KIND_ID number (logic's Uint8Array kind), `flags` = catalog F bits
// (ING 1, ROLL 4, FRAGILE 8, GATE 16, BOSS 32, STACK 64, BELT 128, WALL 256; SOLID is never written, solid is
// dynamic), `lane` = lane index or −1, `lu` = distance along the lane from A at level time 0 (rollers move
// A→B at lane.v, vanish at B and reappear at A 0.6 s later), `belt` = belt index or −1, `stack` = contents (kind
// ids) or null, `zone` = zone id (zoneGraph). Wall and gate pieces belong to the zone they face (the parent).
// Surfaces are axis-aligned rectangles (rot is always 0; a rotated look is a render choice).
//
// DECISION: angles for rings and pens use polynomial sin/cos/atan/asin built from + − × ÷ only (sinp, cosp,
// atanp, asinp below). D7 bans the transcendental Math calls because engines round them differently; these
// polynomials are plain arithmetic, so every engine produces identical bits. Random directions still come from DIRS.
// DECISION: levels.js mirrors FIT = 0.9 locally (logic.js owns the fit rule; verify.mjs asserts logic.FIT === 0.9)
// so levels.js stays importable without logic.js.
// DECISION: growth supply for the margin counts ingredients at K_ING (0.25) and wall/gate pieces at K_WALL (0.6).
// DECISION: the spawn pad is a cream (light) cloth, not red gingham: peas and blueberries fail the 0.25 contrast
// rule on red (#E8574A, lum 0.245). Red cloth hosts the yellow and pink T1 food instead.
// DECISION: L1 has no timer: T 60 with timed false (keeps T > 0 for any divide in logic/ui).
// DECISION: T0 may sit on the bare ground in every town (Picnic ground is gingham cloth per D33; see groundOK).
// DECISION: archetypes PS, MR, CK, PF fall back to RR, CG, BP, BP layouts (with their twists: belts, gulls,
// truck, car walls) until they are built; L11–L60 are rough placeholders that expand without errors.

import { R0, R0_REC, R_MAX, G, K_ING, K_WALL, LEVELS, TOWNS, DAILY_START, ITEM_MAX } from './consts.js';
import { KINDS, KIND_ID, KIND, kindsForTown, F, SURF, CONTRAST_MIN } from './catalog.js';
import { SPECS, REC } from './levels-data.js';
import { BUMPS, DAILY_T } from './dailies-data.js';

export const LEVEL_COUNT = LEVELS;
export const ARCH = {
  BP: 'Blanket Path', RR: 'Ring Road', PG: 'Pens Garden', CG: 'Corridor of Gates', IS: 'Islands',
  MR: 'Market Rows', CK: 'Conveyor Kitchen', PF: 'Pier Fingers', HL: 'Hill Lanes', PS: 'Plaza Spiral',
};
export const DAILY_ARCH = ['RR', 'PG', 'HL', 'CG', 'IS', 'CK', 'PG', 'RR', 'HL', 'IS'];

// 64 unit vectors [cos(2πk/64), sin(2πk/64)], literal (D7).
export const DIRS = [
  [1, 0], [0.995184726672, 0.09801714033], [0.980785280403, 0.195090322016], [0.956940335732, 0.290284677254],
  [0.923879532511, 0.382683432365], [0.881921264348, 0.471396736826], [0.831469612303, 0.55557023302], [0.773010453363, 0.634393284164],
  [0.707106781187, 0.707106781187], [0.634393284164, 0.773010453363], [0.55557023302, 0.831469612303], [0.471396736826, 0.881921264348],
  [0.382683432365, 0.923879532511], [0.290284677254, 0.956940335732], [0.195090322016, 0.980785280403], [0.09801714033, 0.995184726672],
  [0, 1], [-0.09801714033, 0.995184726672], [-0.195090322016, 0.980785280403], [-0.290284677254, 0.956940335732],
  [-0.382683432365, 0.923879532511], [-0.471396736826, 0.881921264348], [-0.55557023302, 0.831469612303], [-0.634393284164, 0.773010453363],
  [-0.707106781187, 0.707106781187], [-0.773010453363, 0.634393284164], [-0.831469612303, 0.55557023302], [-0.881921264348, 0.471396736826],
  [-0.923879532511, 0.382683432365], [-0.956940335732, 0.290284677254], [-0.980785280403, 0.195090322016], [-0.995184726672, 0.09801714033],
  [-1, 0], [-0.995184726672, -0.09801714033], [-0.980785280403, -0.195090322016], [-0.956940335732, -0.290284677254],
  [-0.923879532511, -0.382683432365], [-0.881921264348, -0.471396736826], [-0.831469612303, -0.55557023302], [-0.773010453363, -0.634393284164],
  [-0.707106781187, -0.707106781187], [-0.634393284164, -0.773010453363], [-0.55557023302, -0.831469612303], [-0.471396736826, -0.881921264348],
  [-0.382683432365, -0.923879532511], [-0.290284677254, -0.956940335732], [-0.195090322016, -0.980785280403], [-0.09801714033, -0.995184726672],
  [0, -1], [0.09801714033, -0.995184726672], [0.195090322016, -0.980785280403], [0.290284677254, -0.956940335732],
  [0.382683432365, -0.923879532511], [0.471396736826, -0.881921264348], [0.55557023302, -0.831469612303], [0.634393284164, -0.773010453363],
  [0.707106781187, -0.707106781187], [0.773010453363, -0.634393284164], [0.831469612303, -0.55557023302], [0.881921264348, -0.471396736826],
  [0.923879532511, -0.382683432365], [0.956940335732, -0.290284677254], [0.980785280403, -0.195090322016], [0.995184726672, -0.09801714033],
];

// ---------- deterministic math ----------
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const PI = 3.141592653589793, TAU = 6.283185307179586, HPI = 1.5707963267948966, QPI = 0.7853981633974483;
/** sin by range reduction + Taylor series to x^17 (|err| < 1e-12 on [−π/2, π/2]); + − × ÷ floor only. */
export function sinp(x) {
  x = x - TAU * Math.floor((x + PI) / TAU);
  if (x > HPI) x = PI - x; else if (x < -HPI) x = -PI - x;
  const x2 = x * x; let term = x, s = x;
  for (let n = 1; n <= 8; n++) { term = -term * x2 / ((2 * n) * (2 * n + 1)); s += term; }
  return s;
}
export const cosp = x => sinp(x + HPI);
/** atan by reduction (|t| > 1 → π/2 − atan(1/t); t > tan(π/8) → π/4 + atan((t−1)/(t+1))) + series to t^25. */
export function atanp(t) {
  let sg = 1; if (t < 0) { t = -t; sg = -1; }
  let inv = false, off = 0;
  if (t > 1) { t = 1 / t; inv = true; }
  if (t > 0.41421356237309503) { t = (t - 1) / (t + 1); off = QPI; }
  const t2 = t * t; let p = t, s = t;
  for (let n = 1; n <= 12; n++) { p = -p * t2; s += p / (2 * n + 1); }
  s += off;
  if (inv) s = HPI - s;
  return sg * s;
}
export function atan2p(y, x) {
  if (x > 0) return atanp(y / x);
  if (x < 0) return y >= 0 ? atanp(y / x) + PI : atanp(y / x) - PI;
  return y > 0 ? HPI : y < 0 ? -HPI : 0;
}
export function asinp(y) {
  if (y >= 1) return HPI; if (y <= -1) return -HPI;
  return atanp(y / Math.sqrt(1 - y * y));
}
const FIT = 0.9;
const needR = a => a / FIT;
const canFit = (r, a) => a <= FIT * r + 1e-9;
const r3 = x => Math.floor(x * 1000 + 0.5) / 1000;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const hyp = (dx, dz) => Math.sqrt(dx * dx + dz * dz);
const tierOf = a => (a < 0.12 ? 0 : a < 0.25 ? 1 : a < 0.5 ? 2 : a < 1.1 ? 3 : 4);

// ---------- spec access ----------
export function townOf(n) { return n <= 20 ? 'picnic' : n <= 40 ? 'market' : 'harbour'; }
export function getSpec(n) {
  const s = SPECS[(n | 0) - 1];
  if (!s) throw new Error('no level ' + n);
  return s;
}
const cache = new Map();
export function getLevel(n) {
  n = n | 0;
  if (cache.has(n)) return cache.get(n);
  const s = getSpec(n);
  const lvl = genLevel(s, s.seed);
  cache.set(n, lvl);
  return lvl;
}
export function getRecord() {
  if (cache.has('rec')) return cache.get('rec');
  const lvl = genLevel(REC, REC.seed);
  cache.set('rec', lvl);
  return lvl;
}

// ---------- daily (§3.12) ----------
// Days from civil (Howard Hinnant's algorithm), integers only, so no Date object is needed.
function civilDays(key) {
  let y = +key.slice(0, 4), m = +key.slice(5, 7); const d = +key.slice(8, 10);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function daysBetween(a, b) { return civilDays(b) - civilDays(a); }
const DAILY_REC = {
  picnic: [['strawberry', 'cheese', 'boss-hamper'], ['tomato', 'cupcake', 'boss-table'], ['lemon', 'banana', 'boss-bigsandwich'],
    ['corn', 'sandwich', 'boss-watermelon'], ['apple', 'cheese', 'boss-table']],
  market: [['orange', 'baguette', 'boss-fruitstall'], ['croissant', 'donut', 'boss-bakerycart'], ['pizzaslice', 'broccoli', 'boss-pizza'],
    ['pretzel', 'pineapple', 'boss-cheesetower'], ['eggplant', 'orange', 'boss-fruitstall']],
  harbour: [['icecream', 'waffle', 'boss-popcorncart'], ['hotdog', 'fries', 'boss-icecreamkiosk'], ['taco', 'burger', 'boss-popcorncart'],
    ['lollipop', 'cottoncandy', 'boss-icecreamkiosk'], ['popcorn', 'icecream', 'boss-popcorncart']],
};
const ROLLERS = { picnic: 'apple', market: 'orange', harbour: 'coconut' };
/**
 * The Daily Order for date key 'YYYY-MM-DD' and the player's current level `cur`.
 * Variant = number of taught twists − 1 (A pens, B + rolling, C + rolling + belts); same date + band → same level.
 * `o` = { bump, T } overrides for tools/slurp-pot/tune.mjs only (the game passes key and cur).
 * DECISION: the cache key carries the bump and T, so a tool trying bumps never gets a stale level.
 */
export function getDaily(key, cur, o = {}) {
  cur = cur | 0;
  const day = Math.max(0, daysBetween(DAILY_START, key));
  const tw = cur > 22 ? ['pens', 'rolling', 'belts'] : cur > 10 ? ['pens', 'rolling'] : ['pens'];
  const variant = tw.length - 1;
  const unlocked = cur > 40 ? 3 : cur > 20 ? 2 : 1;
  const ti = day % 3;
  const town = ti < unlocked ? TOWNS[ti] : 'picnic';
  const bump = o.bump != null ? o.bump | 0 : (BUMPS[key] && BUMPS[key][variant]) | 0;
  const T = o.T || (DAILY_T[key] && DAILY_T[key][variant]) || 65;
  const ck = key + '|' + variant + '|' + town + '|' + bump + '|' + T;
  if (cache.has(ck)) return cache.get(ck);
  let arch = DAILY_ARCH[day % 10];
  if (arch === 'HL' && tw.indexOf('rolling') < 0) arch = 'PG';
  if (arch === 'CK' && tw.indexOf('belts') < 0) arch = tw.indexOf('rolling') >= 0 ? 'HL' : 'CG';
  const seed = (fnv1a(key + '|slurp') + bump) >>> 0;
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const recs = DAILY_REC[town];
  const rec = recs[Math.floor(rng() * recs.length)];
  const bossA = r3(1.7 + Math.floor(rng() * 5) * 0.05);
  const pen = arch === 'PG' || arch === 'CG' || arch === 'RR';
  const lines = [{ kind: rec[0], need: 3 + Math.floor(rng() * 2) }, { kind: rec[1], need: 2 + Math.floor(rng() * 2), place: pen ? 'pen' : undefined }];
  const twist = {};
  if (arch === 'PG') twist.pens = 2;
  if (arch === 'CG') twist.walls = 1;
  if (arch === 'HL') { twist.lanes = 2; lines[0] = { kind: ROLLERS[town], need: 3, place: 'roll' }; }
  if (arch === 'CK') { twist.belts = 1; lines[0].place = 'belt'; }
  const W = 22, D = 32 + 2 * Math.floor(rng() * 2);
  const spec = {
    n: 0, name: 'Daily Order', town, arch, W, D, seed, r0: R0, T, items: 185, mix: [34, 30, 18, 14, 4], margin: [1.9, 2.3],
    tickets: [{ lines: lines.map(l => (l.place ? l : { kind: l.kind, need: l.need })), boss: { kind: rec[2], a: bossA } }], twist,
  };
  const lvl = genLevel(spec, seed);
  lvl.daily = dailyLines(lvl, day, key, variant);
  cache.set(ck, lvl);
  return lvl;
}
// Star lines (§3.12): line 1 win; line 2 pool A index (day*7) % len; line 3 pool B index (day*11) % len.
function dailyLines(lvl, day, key, variant) {
  const count = {};
  for (const it of lvl.items) if (!(it.flags & (F.ING | F.BOSS | F.WALL | F.GATE))) count[it.kind] = (count[it.kind] || 0) + 1;
  let best = null, bn = 0;
  for (const k in count) if (KIND[k].food && count[k] > bn) { bn = count[k]; best = k; }
  const poolA = [];
  if (best && bn - 4 >= 12) poolA.push({ type: 'eat', kind: best, n: Math.min(20, bn - 4) });
  poolA.push({ type: 'chain', n: 12 + (day % 7) });
  poolA.push({ type: 'big', n: 6 + (day % 5) });
  const poolB = [{ type: 'left', share: 0.3 }, { type: 'noBumps' }, { type: 'noBoost' }, { type: 'sizzle', n: 2 }];
  return { key, day, variant, lines: [{ type: 'win' }, poolA[(day * 7) % poolA.length], poolB[(day * 11) % poolB.length]] };
}

// ---------- zone graph (planner bot) ----------
/** { nodes: [{ id, x, z, items: [i] }], edges: [{ a: parentZone, b: zone, gate: itemIndex, r: needR(gate.a) }] } */
export function zoneGraph(level) {
  const nodes = level.zones.map(z => ({ id: z.id, x: z.x, z: z.z, items: [] }));
  level.items.forEach((it, i) => { if (!(it.flags & (F.WALL | F.GATE)) && nodes[it.zone]) nodes[it.zone].items.push(i); });
  const edges = [];
  for (const z of level.zones) if (z.parent >= 0) edges.push({ a: z.parent, b: z.id, gate: z.gate, r: z.gate >= 0 ? r3(needR(level.items[z.gate].a) + 0.0005) : 0 });
  return { nodes, edges };
}

// ---------- generator ----------
const WALL_KIND = { picnic: 'hedge', market: 'car', harbour: 'ropepost' };
const FENCE_KIND = { picnic: 'fence', market: 'car', harbour: 'ropepost' };
const STACK_KIND = { picnic: 'teacups', market: 'jarstack', harbour: 'wafflestack' };
const DECOR_KIND = { picnic: 'tree', market: 'lamp', harbour: 'buoy' };
// Tier windows over progress p (0 at spawn, 1 at the boss): items of tier t prefer p in [lo, hi].
const WIN = [[0, 0.55], [0, 0.75], [0.12, 0.9], [0.32, 1.0], [0.5, 1.0]];

function ctxFor(spec, seed) {
  const W = spec.W, D = spec.D;
  const tk = spec.tickets;
  const bossFinal = finalBossA(spec);
  return {
    spec, seed, rng: mulberry32(seed), W, D, x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2,
    town: spec.town, r0: spec.r0, spawn: { x: 0, z: D / 2 - 2 }, bossFinal, nT: tk.length,
    items: [], surfaces: [], decor: [], zones: [{ id: 0, x: 0, z: 0, parent: -1, gate: -1, r: 0, prog: 0 }],
    rings: [], bands: [], regions: [], keeps: [], segs: [], spots: [], lanes: [], belts: [],
    roost: null, gullEvery: 0, gulls: 0, truckPath: [], cake: null, bossPos: [], gi: 0, progL: D * 0.8, pal: null,
  };
}
function finalBossA(spec) {
  const tw = spec.twist || {};
  if (tw.cake) return tw.cake[tw.cake.length - 1];
  const t = spec.tickets[spec.tickets.length - 1];
  return t.boss.a;
}
const rr = (c, a, b) => a + (b - a) * c.rng();
const ri = (c, n) => Math.floor(c.rng() * n);
const pick = (c, arr) => arr[Math.floor(c.rng() * arr.length)];
function shuffled(c, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(c, i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

function zoneAt(c, x, z) {
  let best = -1, depth = -1;
  for (const g of c.rings) { const dx = x - g.x, dz = z - g.z; if (dx * dx + dz * dz < g.R * g.R && g.depth > depth) { best = g.zone; depth = g.depth; } }
  if (best >= 0) return best;
  let zone = 0;
  for (const b of c.bands) if (z < b.z) zone = b.zone;
  return zone;
}
function progAt(c, x, z) {
  const p = clamp(hyp(x - c.spawn.x, z - c.spawn.z) / c.progL, 0, 1);
  const zn = c.zones[zoneAt(c, x, z)];
  return p > zn.prog ? p : zn.prog;
}
function surfAt(c, x, z, a) {
  const m = a * 0.6;
  for (let i = c.surfaces.length - 1; i >= 0; i--) {
    const s = c.surfaces[i];
    if (Math.abs(x - s.x) <= s.w / 2 - m && Math.abs(z - s.z) <= s.d / 2 - m) return s;
  }
  return null;
}
/** Contrast rule (§4.2): T0/T1 items need |lum − surface lum| ≥ 0.25 (gingham ground: groundOK). */
// DECISION (D33, Art 11-03): the Picnic ground is red/cream gingham, i.e. cloth, so T0 may sit on it. Its tones
// (cream .893 / stripe .479 / cross .245) cover 1/4, 1/2, 1/4 of the area: a T0/T1 item on bare gingham passes when
// it differs by >= CONTRAST_MIN from tones covering >= 1/2 of the area, and red-hued kinds (hue <= 30 or >= 340,
// the cloth red is 5) never sit on bare gingham: they go on cream blankets/rugs or the path.
const GING_W = [0.25, 0.5, 0.25];
const redHue = k => k.hue <= 30 || k.hue >= 340;
function groundOK(c, k) {
  const g = SURF[c.town].gingham;
  if (!g) return Math.abs(k.lum - SURF[c.town].ground.lum) >= CONTRAST_MIN;
  if (redHue(k)) return false;
  let w = 0;
  for (let i = 0; i < g.length; i++) if (Math.abs(k.lum - g[i].lum) >= CONTRAST_MIN) w += GING_W[i];
  return w >= 0.5 - 1e-9;
}
function contrastOK(c, k, x, z) {
  if (k.tier > 1) return true;
  const s = surfAt(c, x, z, k.a);
  if (!s) return groundOK(c, k);
  return Math.abs(k.lum - s.lum) >= CONTRAST_MIN;
}
function segDist(px, pz, s) {
  const vx = s.bx - s.ax, vz = s.bz - s.az, L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - s.ax) * vx + (pz - s.az) * vz) / L2 : 0; t = clamp(t, 0, 1);
  return hyp(px - (s.ax + t * vx), pz - (s.az + t * vz));
}
/** Can an item of footprint a and tier t sit at (x, z)? opt: { zone, role, lane, edgeOk } */
function canPlace(c, x, z, a, t, opt) {
  const role = opt.role || 'junk';
  const isWall = role === 'wall' || role === 'gate';
  if (!opt.edgeOk) { const m = 0.3 + a; if (x < c.x0 + m || x > c.x1 - m || z < c.z0 + m || z > c.z1 - m) return false; }
  if (!isWall) {
    if (opt.zone != null && zoneAt(c, x, z) !== opt.zone) return false;
    for (const b of c.bands) if (Math.abs(z - b.z) < b.wallA + a + 0.15) return false;
    for (const g of c.rings) { const d = hyp(x - g.x, z - g.z); if (Math.abs(d - g.R) < g.wallA + a + 0.15) return false; }
    for (const k of c.keeps) if (a > k.maxA && hyp(x - k.x, z - k.z) < k.r + a) return false;
    if (!opt.lane) for (const s of c.segs) if (segDist(x, z, s) < s.w + a) return false;
  }
  for (let j = 0; j < c.items.length; j++) {
    const o = c.items[j];
    const oWall = o.role === 'wall' || o.role === 'gate';
    if (isWall && oWall) continue;
    if (opt.lane && o.lane >= 0) continue;
    let sep = 0.9 * (a + o.a);
    if (oWall || isWall) { const tt = isWall ? o.tier : t; sep = a + o.a + (tt >= 3 ? 1.0 : tt >= 2 ? 0.4 : 0.1); }
    else if (o.role !== 'boss' && role !== 'boss') {
      const lo = t < o.tier ? t : o.tier, hi = t > o.tier ? t : o.tier;
      if (lo >= 3) sep = a + o.a + 0.9; else if (lo >= 2 && hi >= 3) sep = a + o.a + 0.5;
    }
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz < sep * sep) return false;
  }
  return true;
}
function addItem(c, kindId, x, z, opt = {}) {
  const k = KIND[kindId];
  if (!k) throw new Error('unknown kind ' + kindId);
  const a = opt.a != null ? opt.a : k.a;
  const role = opt.role || 'junk';
  let flags = opt.flags || 0;
  if (role === 'ing') flags |= F.ING;
  if (role === 'boss') flags |= F.BOSS;
  if (role === 'gate') flags |= F.GATE | F.WALL;
  if (role === 'wall') flags |= F.WALL;
  if (opt.stack) flags |= F.STACK | F.FRAGILE;
  else if (k.fragile) flags |= F.FRAGILE;
  if (opt.lane >= 0) flags |= F.ROLL;
  if (opt.belt >= 0) flags |= F.BELT;
  const it = {
    kind: kindId, ki: KIND_ID[kindId], x: r3(x), z: r3(z), a: r3(a), h: r3(k.h * a / k.a),
    k: role === 'boss' ? 0 : (role === 'wall' || role === 'gate') ? K_WALL : k.k, flags,
    rot: opt.rot != null ? r3(opt.rot) : r3((ri(c, 64) * TAU) / 64 - PI), lane: opt.lane >= 0 ? opt.lane : -1, lu: opt.lu != null ? r3(opt.lu) : 0,
    belt: opt.belt >= 0 ? opt.belt : -1, stack: opt.stack || null,
    zone: opt.zone != null ? opt.zone : zoneAt(c, x, z), tier: role === 'boss' ? 5 : tierOf(a), role, line: opt.line || null,
  };
  c.items.push(it);
  return c.items.length - 1;
}
function addSurf(c, type, x, z, w, d, color) {
  const pal = SURF[c.town];
  let s = null;
  if (type === 'path') s = pal.path; else if (type === 'rug') s = pal.rug || pal.blanket[0]; else if (type === 'deck') s = pal.deck || pal.blanket[0];
  else if (type === 'water') s = pal.water || pal.blanket[1];
  else s = color != null ? (typeof color === 'number' ? pal.blanket[color] : color) : pal.blanket[0];
  // clip to the board
  const xa = Math.max(c.x0, x - w / 2), xb = Math.min(c.x1, x + w / 2), za = Math.max(c.z0, z - d / 2), zb = Math.min(c.z1, z + d / 2);
  if (xb - xa < 0.4 || zb - za < 0.4) return null;
  const o = { type, x: r3((xa + xb) / 2), z: r3((za + zb) / 2), w: r3(xb - xa), d: r3(zb - za), rot: 0, color: s.color, lum: s.lum };
  c.surfaces.push(o);
  return o;
}
/** Town surface (blanket colour or path) with the best contrast for a kind. */
function bestSurfFor(c, k) {
  const pal = SURF[c.town];
  const opts = [{ type: 'blanket', s: pal.blanket[0], col: 0 }, { type: 'blanket', s: pal.blanket[1], col: 1 }, { type: 'path', s: pal.path }];
  let best = opts[0], bd = -1;
  for (const o of opts) { const d = Math.abs(o.s.lum - k.lum); if (d > bd) { bd = d; best = o; } }
  return best;
}
function gateR(c, frac) {
  const g = c.spec.gateR;
  const i = c.gi++;
  if (g && g[i] != null) return g[i];
  return c.r0 + frac * (needR(c.bossFinal) - c.r0);
}
function addZone(c, x, z, parent, prog) {
  const id = c.zones.length;
  c.zones.push({ id, x: r3(x), z: r3(z), parent, gate: -1, r: 0, prog });
  return id;
}
function rPassFor(gateA, wallA) { return Math.max(1.28 * gateA, Math.min(needR(wallA), 1.9 * gateA)); }

/**
 * Closed ring of wall pieces around (x, z) with centre-line radius R; the gate piece faces direction `th`.
 * Gate rule (§4.2): gate.a = 0.97·FIT·rGate; wall.a = max(catalog.a, 1.25·gate.a); spacing ≤ 0.58·2·wall.a.
 */
// DECISION: the two gate neighbours sit so the hole left by the eaten gate passes a pot up to
// rPass = max(1.28·gate.a, min(needR(wall.a), 1.9·gate.a)) (≥ 1.15·needR(gate.a), so the pen opens the moment
// the gate is eaten), while the closed gap stays below gate.a + wall.a (nothing slips past a closed gate).
function ringWall(c, x, z, R, rG, wallKind, zone, parent, th, depth) {
  const cat = KIND[wallKind];
  const gateA = 0.97 * FIT * rG, wallA = Math.max(cat.a, 1.25 * gateA);
  const cnn = 2 * wallA + rPassFor(gateA, wallA);
  if (cnn > 1.8 * R) R = cnn / 1.8;
  const Phi = 2 * asinp(cnn / (2 * R));
  const dMax = 2 * asinp(Math.min(1, (1.16 * wallA) / (2 * R)));
  const arc = TAU - Phi, m = Math.ceil(arc / dMax - 1e-9), dl = arc / m;
  const gi = addItem(c, wallKind, x + R * cosp(th), z + R * sinp(th), { a: gateA, role: 'gate', zone: parent, rot: th + HPI });
  for (let j = 0; j <= m; j++) {
    const a = th + Phi / 2 + j * dl;
    addItem(c, wallKind, x + R * cosp(a), z + R * sinp(a), { a: wallA, role: 'wall', zone: parent, rot: a + HPI });
  }
  c.rings.push({ x, z, R, zone, depth, wallA });
  const zn = c.zones[zone]; zn.gate = gi; zn.r = r3(needR(gateA));
  return { x, z, R, gateA, wallA, gate: gi, zone };
}
/** Straight wall across the board at z = zw with its gate at x = gx; zone `zone` lies beyond (z < zw). */
function lineWall(c, zw, gx, rG, wallKind, zone, parent) {
  const cat = KIND[wallKind];
  const gateA = 0.97 * FIT * rG, wallA = Math.max(cat.a, 1.25 * gateA);
  const half = wallA + rPassFor(gateA, wallA) / 2;
  // DECISION: wall end pieces sit with their centre 0.3 + 0.5·wall.a from the board edge (the footprint may
  // overhang the 0.3 u edge margin); the pot is clamped to x0 + 0.5r, so no pot slips past the end.
  const e = 0.3 + 0.5 * wallA;
  gx = clamp(gx, c.x0 + e + half + 1.2 * wallA, c.x1 - e - half - 1.2 * wallA);
  const gi = addItem(c, wallKind, gx, zw, { a: gateA, role: 'gate', zone: parent, rot: 0, edgeOk: true });
  for (const side of [-1, 1]) {
    const xn = gx + side * half, xe = side < 0 ? c.x0 + e : c.x1 - e;
    const L = Math.abs(xe - xn), m = Math.max(1, Math.ceil(L / (1.16 * wallA) - 1e-9));
    for (let j = 0; j <= m; j++) addItem(c, wallKind, xn + (xe - xn) * (j / m), zw, { a: wallA, role: 'wall', zone: parent, rot: 0 });
  }
  c.bands.push({ z: zw, zone, wallA });
  c.bands.sort((p, q) => q.z - p.z);
  const zn = c.zones[zone]; zn.gate = gi; zn.r = r3(needR(gateA));
  return { z: zw, gateA, wallA, gate: gi, zone, gx };
}
function placeBoss(c, ti, x, z) {
  const b = c.spec.tickets[ti].boss;
  const tw = c.spec.twist || {};
  const a = tw.cake && ti === c.nT - 1 ? tw.cake[tw.cake.length - 1] : b.a;
  const i = addItem(c, b.kind, x, z, { a, role: 'boss', rot: 0 });
  c.bossPos[ti] = i;
  c.keeps.push({ x, z, r: a + 1.3, maxA: 0.25 });
  return i;
}
function bossZ(c, a) { return c.z0 + a + 1.4; }

// ---------- archetypes: each lays out surfaces, structures, zones, regions, bosses and ingredient spots ----------
// A spot = { li: [ticket, line], x, z, r (spread), zone, n (items) }. Regions = { t: 'rect'|'disc', ..., zone, dens, mask? }.
function linesOf(c) {
  const out = [];
  c.spec.tickets.forEach((t, ti) => t.lines.forEach((l, li) => out.push({ ti, li, kind: l.kind, need: l.need, place: l.place || 'open', spare: l.spare, at: l.at })));
  return out;
}
function countOf(c, L) {
  if (L.spare != null) return L.need + L.spare;
  const n = c.spec.n || 0;
  const gated = L.place === 'pen' || L.place === 'stack';
  const spare = n > 0 && n >= 20 && !gated && L.place !== 'roll' ? 0 : 1;
  return L.need + spare;
}
function spot(c, L, x, z, r, zone, n) { c.spots.push({ L, x, z, r, zone, n }); }
function splitSpots(c, L, pts, zone) {
  const n = countOf(c, L), per = Math.ceil(n / pts.length);
  let left = n;
  for (const p of pts) { const k = Math.min(per, left); if (k > 0) spot(c, L, p[0], p[1], p[2] || 0.9, p[3] != null ? p[3] : zone, k); left -= k; }
}
function boardRegion(c, dens) { c.regions.push({ t: 'rect', x: 0, z: 0, w: c.W, d: c.D, zone: 0, dens }); }
function spawnPad(c) {
  const pal = SURF[c.town];
  const col = pal.blanket[0].lum > pal.blanket[1].lum ? 0 : 1;
  addSurf(c, 'blanket', c.spawn.x, c.spawn.z, 3.6, 3.6, col);
}
function scatterBlankets(c, n, zLo, zHi, size, dens) {
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const w = rr(c, size * 0.8, size * 1.25), d = rr(c, size * 0.8, size * 1.25);
      const x = rr(c, c.x0 + w / 2, c.x1 - w / 2), z = rr(c, zLo, zHi);
      if (zoneAt(c, x, z) !== 0) continue;
      let ok = true;
      for (const g of c.rings) if (hyp(x - g.x, z - g.z) < g.R + g.wallA + Math.max(w, d) / 2) ok = false;
      if (!ok) continue;
      const s = addSurf(c, ri(c, 3) === 2 ? 'path' : 'blanket', x, z, w, d, ri(c, 2));
      if (s) c.regions.push({ t: 'rect', x: s.x, z: s.z, w: s.w, d: s.d, zone: 0, dens });
      break;
    }
  }
}
/** Pens for lines; returns structures. pens = [{ lines: [L], frac, R?, nested? }] */
function buildPens(c, pens, zLo, zHi) {
  const out = [];
  const placed = [];
  for (const p of pens) {
    const wallK = p.nested ? FENCE_KIND[c.town] : WALL_KIND[c.town];
    const rG = gateR(c, p.frac);
    const gateA = 0.97 * FIT * rG, wallA = Math.max(KIND[wallK].a, 1.25 * gateA);
    let rI = 0, gateAi = 0, wallAi = 0, wallKi = WALL_KIND[c.town];
    // DECISION: pen size grows with the footprint of what it holds: inner clear radius ≈ 1.25 + 0.12·load +
    // 1.2·(largest ingredient a), so 3–4 ingredients plus a little junk always fit.
    let maxA = 0.15;
    for (const L of p.lines) maxA = Math.max(maxA, KIND[L.kind].a);
    let R = clamp(1.25 + 0.12 * p.load + 1.2 * maxA + wallA, 1.8, 3.8);
    let delta = 0, Ri = 0;
    if (p.nested) {
      rI = gateR(c, p.fracIn);
      gateAi = 0.97 * FIT * rI; wallAi = Math.max(KIND[wallKi].a, 1.25 * gateAi);
      Ri = 0.9 + 1.2 * maxA + wallAi;
      const gNear = wallA + wallAi + 1.1 * needR(gateA), gFar = 0.6 * (wallA + wallAi);
      R = Ri + (gNear + gFar) / 2; delta = (gNear - gFar) / 2;
    }
    const ext = R + wallA;
    // DECISION: pen centres come from 160 random candidates scored by clearance to other pens, bosses and
    // spawn (clearance capped at 6 u) plus a pull toward the side lanes; the best one wins even if cramped.
    let best = null, bs = -1e9;
    const zA = Math.min(zLo + ext, (zLo + zHi) / 2), zB = Math.max(zHi - ext, (zLo + zHi) / 2);
    for (let t = 0; t < 160; t++) {
      const x = rr(c, c.x0 + ext + 0.9, c.x1 - ext - 0.9), z = rr(c, zA, zB);
      let s = 99;
      for (const q of placed) s = Math.min(s, hyp(x - q.x, z - q.z) - (ext + q.ext) - 1.8);
      for (const b of c.bossPos) { const o = c.items[b]; s = Math.min(s, hyp(x - o.x, z - o.z) - (ext + o.a) - 1.8); }
      s = Math.min(s, hyp(x - c.spawn.x, z - c.spawn.z) - ext - 4);
      const sc = (s < 0 ? s * 4 : Math.min(s, 6)) + (1.5 * Math.abs(x)) / c.W + 0.3 * c.rng();
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    const th = atan2p(c.spawn.z - best.z, c.spawn.x - best.x);
    const zone = addZone(c, best.x, best.z, 0, Math.min(0.95, p.frac + 0.1));
    const st = ringWall(c, best.x, best.z, R, rG, wallK, zone, 0, th, 1);
    st.ext = ext;
    placed.push({ x: best.x, z: best.z, ext });
    const pen = { st, lines: p.lines, inner: null, R };
    if (p.nested) {
      const ux = -cosp(th), uz = -sinp(th);
      const xi = best.x + ux * delta, zi = best.z + uz * delta;
      const zi2 = addZone(c, xi, zi, zone, Math.min(0.95, p.fracIn + 0.1));
      const sti = ringWall(c, xi, zi, Ri, rI, wallKi, zi2, zone, th, 2);
      pen.inner = sti;
      // inner pen holds the lines; the outer channel holds a little bonus food
      for (const L of p.lines) splitSpots(c, L, [[xi, zi, Math.max(0.5, (Ri - wallAi) * 0.6)]], zi2);
      const cx = best.x - ux * (R - (R - Ri - delta) / 2 - 0.2), cz = best.z - uz * (R - (R - Ri - delta) / 2 - 0.2);
      c.regions.push({ t: 'disc', x: cx, z: cz, r: 0.9, zone, dens: 2.5, mask: [1, 1, 1, 0, 0] });
    } else {
      const inner = R - wallA - 0.15;
      for (const L of p.lines) splitSpots(c, L, [[best.x, best.z, Math.max(0.5, inner * 0.6)]], zone);
      c.regions.push({ t: 'disc', x: best.x, z: best.z, r: Math.max(0.4, inner), zone, dens: p.lines.length ? 0.9 : 2.2, mask: [1, 1, 1, 0, 0] });
    }
    out.push(pen);
  }
  return out;
}
function penFloors(c) {
  // a cloth floor under pen ingredient spots that need contrast is added by ingredient patches (ingPatches)
}
function fracs(n) { return n <= 1 ? [0.42] : n === 2 ? [0.32, 0.55] : n === 3 ? [0.26, 0.42, 0.58] : [0.24, 0.36, 0.48, 0.6]; }

const ARCH_FN = {
  BP(c) {
    const s = c.spec, sp = c.spawn;
    const bz = s.bossDist ? sp.z - s.bossDist : bossZ(c, c.bossFinal);
    const two = c.nT > 1;
    if (two) placeBoss(c, 0, c.x0 * 0.45, sp.z - (sp.z - bz) * 0.5);
    placeBoss(c, c.nT - 1, 0, bz);
    c.progL = sp.z - bz;
    // DECISION (D33, Render 11-03): on the gingham town the path is stepping-stone blankets (0.3·W wide, 2.4 deep
    // every 3.2 u) and only 2 extra blankets, so cloth covers ~20–25 % and the red gingham dominates; elsewhere the
    // path is a solid 0.45·W strip plus 4 blankets.
    const ging = !!SURF[c.town].gingham;
    const rw = (ging ? 0.3 : 0.45) * c.W, tile = 3.2, td = ging ? 2.4 : tile;
    const n = Math.max(1, Math.ceil((sp.z + 1.6 - bz) / tile));
    for (let i = 0; i < n; i++) {
      const z = sp.z + 1.6 - tile * (i + 0.5);
      addSurf(c, 'blanket', 0, z, rw, td, i % 2);
    }
    boardRegion(c, 0.55);
    c.regions.push({ t: 'rect', x: 0, z: (sp.z + bz) / 2, w: rw, d: sp.z - bz, zone: 0, dens: 1.3 });
    scatterBlankets(c, ging ? 2 : 4, bz, sp.z - 2, ging ? 2.0 : 2.4, 1.2);
    const lines = linesOf(c);
    lines.forEach((L, k) => {
      if (L.at) {
        const n = countOf(c, L);
        for (let j = 0; j < n; j++) {
          const di = 40 + Math.floor(((j + 0.5) / n) * 16) % 64, rad = L.at[0] + (L.at[1] - L.at[0]) * (0.25 + 0.5 * c.rng());
          spot(c, L, sp.x + DIRS[di][0] * rad, sp.z + DIRS[di][1] * rad, 0.35, 0, 1);
        }
        return;
      }
      const p = 0.35 + (0.4 * k) / Math.max(1, lines.length - 1 || 1);
      const z = sp.z - p * (sp.z - bz), x = (k % 2 ? 1 : -1) * rw * 0.22;
      if (L.place === 'belt') beltLine(c, L, z); else if (L.place === 'stack') stackLine(c, L, [[x, z]]);
      else spot(c, L, x, z, 1.0, 0, countOf(c, L));
    });
  },
  RR(c) {
    const s = c.spec, sp = c.spawn, tw = s.twist || {};
    const fb = c.bossFinal;
    // DECISION: the boss ring's gate opens at r0 + 0.5·(needR(boss) − r0) (was 0.6): its hedge pieces count in the
    // §4.2 margin at K_WALL, and at 0.6 the ring + pen walls alone gave 1.74 of L8's 1.8–2.4 band (margin stuck at 2.45).
    const rG = gateR(c, 0.5);
    const gateA = 0.97 * FIT * rG, wallA = Math.max(KIND[WALL_KIND[c.town]].a, 1.25 * gateA);
    const Rb = fb + wallA + 0.7;
    const zc = (c.z0 + sp.z) / 2 - c.D * 0.05;
    const zone = addZone(c, 0, zc, 0, 0.7);
    placeBoss(c, c.nT - 1, 0, zc);
    c.items[c.bossPos[c.nT - 1]].zone = zone;
    ringWall(c, 0, zc, Rb, rG, WALL_KIND[c.town], zone, 0, -HPI, 1);
    if (c.nT > 1) placeBoss(c, 0, c.x1 - fb - 1.4, c.z0 + fb + 1.4);
    if (tw.truck) truck(c, 0, zc, Rb + wallA + 2.0);
    const road = Rb + wallA + 1.7, rw2 = 2.0;
    addSurf(c, 'path', -road, zc, rw2, 2 * road + rw2, null);
    addSurf(c, 'path', road, zc, rw2, 2 * road + rw2, null);
    addSurf(c, 'path', 0, zc - road, 2 * road + rw2, rw2, null);
    addSurf(c, 'path', 0, zc + road, 2 * road + rw2, rw2, null);
    for (const sf of c.surfaces) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: 0, dens: 1.1 });
    boardRegion(c, 0.6);
    c.progL = hyp(sp.x, sp.z - zc) + road * 0.8;
    const pts = { far: [0, zc - road], left: [-road, zc], right: [road, zc], near: [0, zc + road + 1.4] };
    const order = ['far', 'left', 'right'];
    const penLines = [];
    let k = 0;
    for (const L of linesOf(c)) {
      if (L.place === 'pen') { penLines.push(L); continue; }
      const key = L.spot || (k === 1 && linesOf(c).length > 1 && c.spec.n <= 3 ? 'near' : order[k % 3]);
      const n = countOf(c, L);
      if (n >= 4 && !L.spot && c.spec.n > 3) splitSpots(c, L, [[...pts.left, 0.9], [...pts.right, 0.9], [...pts.far, 0.9]], 0);
      else if (L.place === 'stack') stackLine(c, L, [pts[key]]);
      else if (L.place === 'belt') beltLine(c, L, zc + road + 2.6);
      else if (L.place === 'roll') laneLine(c, L, 1);
      else spot(c, L, pts[key][0], pts[key][1], 1.0, 0, n);
      k++;
    }
    if (penLines.length) {
      // corner pen beside the far road
      const fr = fracs(1)[0];
      buildPens(c, [{ lines: penLines, frac: Math.min(fr, 0.5), load: 3 }], c.z0 + 0.5, zc + road * 0.5);
    }
    scatterBlankets(c, 3, c.z0 + 1, sp.z - 2, 2.2, 1.2);
  },
  PG(c) {
    const s = c.spec, sp = c.spawn, tw = s.twist || {};
    const bz = bossZ(c, c.bossFinal);
    placeBoss(c, c.nT - 1, (ri(c, 2) ? 1 : -1) * c.W * 0.12, bz);
    if (c.nT > 1) placeBoss(c, 0, c.x0 + c.bossFinal + 1.6, (bz + sp.z) / 2);
    c.progL = sp.z - bz;
    const lines = linesOf(c);
    const penL = lines.filter(L => L.place === 'pen'), openL = lines.filter(L => L.place !== 'pen');
    const nPens = Math.max(penL.length, tw.pens || 2);
    const fr = fracs(nPens + (tw.nested ? 1 : 0));
    const pens = [];
    let fi = 0;
    for (let i = 0; i < nPens; i++) {
      const nested = tw.nested && i === 0;
      const ls = penL[i] ? [penL[i]] : [];
      if (nested) { pens.push({ lines: ls, frac: fr[0], fracIn: fr[fr.length - 1], nested: true, load: 2 }); fi = 1; }
      else pens.push({ lines: ls, frac: fr[Math.min(fr.length - 1, fi++)], load: ls.length ? 3 : 4 });
    }
    boardRegion(c, 0.6);
    buildPens(c, pens, bz + c.bossFinal + 0.5, sp.z - 2.5);
    scatterBlankets(c, 5, bz, sp.z - 2.5, 2.4, 1.3);
    openL.forEach((L, k) => {
      const p = 0.5 + 0.25 * (k % 2);
      const z = sp.z - p * (sp.z - bz), x = (k % 2 ? 1 : -1) * c.W * 0.28;
      if (L.place === 'stack') stackLine(c, L, [[x, z], [-x, z + 2]]);
      else if (L.place === 'belt') beltLine(c, L, z);
      else if (L.place === 'roll') laneLine(c, L, 1);
      else spot(c, L, x, z, 1.0, 0, countOf(c, L));
    });
  },
  CG(c) {
    const s = c.spec, sp = c.spawn, tw = s.twist || {};
    const lines = linesOf(c);
    const penL = lines.filter(L => L.place === 'pen'), openL = lines.filter(L => L.place !== 'pen');
    const nw = Math.max(1, tw.walls || penL.length || 1);
    const bz = bossZ(c, c.bossFinal);
    placeBoss(c, c.nT - 1, 0, bz);
    c.progL = sp.z - bz;
    const fr = fracs(nw);
    const wk = c.town === 'market' ? 'car' : WALL_KIND[c.town];
    const zFar = bz + c.bossFinal + 2.6, zNear = sp.z - 6;
    const walls = [];
    let parent = 0;
    for (let i = 0; i < nw; i++) {
      const p = nw === 1 ? 0.62 : 0.38 + (0.34 * i) / (nw - 1);
      const zw = clamp(sp.z - p * (sp.z - bz), zFar, zNear);
      const zone = addZone(c, 0, zw - 2, parent, p);
      walls.push(lineWall(c, zw, rr(c, -c.W * 0.22, c.W * 0.22), gateR(c, fr[i]), wk, zone, parent));
      parent = zone;
    }
    if (c.nT > 1) placeBoss(c, 0, c.x0 + c.spec.tickets[0].boss.a + 1.5, walls[0].z + 3.5);
    // the boss sits beyond the last wall
    c.items[c.bossPos[c.nT - 1]].zone = zoneAt(c, 0, bz);
    // centre path and band blankets
    addSurf(c, 'path', 0, (sp.z + bz) / 2, 2.6, sp.z - bz, null);
    boardRegion(c, 0.6);
    c.regions.push({ t: 'rect', x: 0, z: (sp.z + bz) / 2, w: 2.6, d: sp.z - bz, zone: 0, dens: 1.0 });
    for (let i = 0; i <= nw; i++) {
      const zt = i === 0 ? sp.z - 2 : walls[i - 1].z - walls[i - 1].wallA - 0.6;
      const zb = i === nw ? bz + c.bossFinal + 1.0 : walls[i].z + walls[i].wallA + 0.6;
      if (zt - zb < 2.5) continue;
      const zone = zoneAt(c, 0, (zt + zb) / 2);
      for (const side of [-1, 1]) {
        const sf = addSurf(c, 'blanket', side * c.W * 0.27, (zt + zb) / 2, c.W * 0.3, Math.min(4.5, (zt - zb) * 0.7), (i + (side > 0 ? 1 : 0)) % 2);
        if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone, dens: 1.2 });
      }
      if (i > 0) c.regions.push({ t: 'rect', x: 0, z: (zt + zb) / 2, w: c.W, d: zt - zb, zone, dens: 0.6 });
    }
    // pen lines go beyond gates (last pen line in the last band)
    penL.forEach((L, k) => {
      const w = walls[Math.min(walls.length - 1, k)];
      const zEnd = k + 1 < walls.length ? walls[k + 1].z + walls[k + 1].wallA + 1.2 : bz + c.bossFinal + 1.5;
      const z = (w.z - w.wallA - 1.0 + zEnd) / 2;
      spot(c, L, (k % 2 ? 1 : -1) * c.W * 0.25, z, 1.0, w.zone, countOf(c, L));
    });
    openL.forEach((L, k) => {
      const zEnd = walls[0].z + walls[0].wallA + 1.6;
      const z = k === 0 && openL.length > 1 ? sp.z - 0.45 * (sp.z - zEnd) : zEnd + 0.8;
      const x = (k % 2 ? -1 : 1) * c.W * 0.3;
      if (L.place === 'stack') stackLine(c, L, [[x, z]]);
      else if (L.place === 'belt') beltLine(c, L, z);
      else if (L.place === 'roll') laneLine(c, L, 1);
      else spot(c, L, x, z, 1.0, 0, countOf(c, L));
    });
  },
  IS(c) {
    const s = c.spec, sp = c.spawn, tw = s.twist || {};
    const bz = bossZ(c, c.bossFinal);
    placeBoss(c, c.nT - 1, 0, bz);
    if (c.nT > 1) placeBoss(c, c.x1 - c.bossFinal - 1.4, (bz + sp.z) / 2);
    c.progL = sp.z - bz;
    boardRegion(c, 0.28);
    const lines = linesOf(c);
    const nI = clamp(tw.islands || 5, 4, 6);
    // island 0 = spawn island; others alternate sides, from mid to far
    const isl = [];
    const sz = 4.4;
    isl.push(addSurf(c, 'blanket', sp.x, sp.z - 0.6, sz, sz, 0));
    const progs = nI === 4 ? [0.38, 0.68, 0.82] : nI === 5 ? [0.32, 0.5, 0.7, 0.86] : [0.3, 0.45, 0.6, 0.74, 0.88];
    // the far islands take the lines: choose colours that suit them
    const far = progs.length - lines.length;
    progs.forEach((p, i) => {
      const side = i % 2 ? 1 : -1;
      const z = sp.z - p * (sp.z - bz), x = side * c.W * rr(c, 0.18, 0.27);
      const L = i >= far ? lines[i - far] : null;
      let col = i % 2;
      if (L && KIND[L.kind].tier <= 1) { const b = bestSurfFor(c, KIND[L.kind]); col = b.col != null ? b.col : col; }
      const w = rr(c, 3.8, 5.0), d = rr(c, 3.6, 4.6);
      isl.push(addSurf(c, 'blanket', x, z, w, d, col));
      if (L) {
        if (L.place === 'roll') laneLine(c, L, 1);
        else if (L.place === 'stack') stackLine(c, L, [[x, z]]);
        else if (L.place === 'belt') beltLine(c, L, z);
        else spot(c, L, x, z, 1.1, 0, countOf(c, L));
      }
    });
    // more lines than islands: extra lines share the far islands
    for (let i = progs.length; i < lines.length + far && i - far < lines.length; i++) {}
    if (far < 0) for (let k = 0; k < -far; k++) { const L = lines[k + progs.length]; const s2 = isl[isl.length - 1 - k]; if (L && s2) spot(c, L, s2.x, s2.z, 1.1, 0, countOf(c, L)); }
    for (const sf of isl) if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: 0, dens: 3.2 });
  },
  HL(c) {
    const s = c.spec, sp = c.spawn, tw = s.twist || {};
    const bz = bossZ(c, c.bossFinal);
    placeBoss(c, c.nT - 1, 0, bz);
    if (c.nT > 1) placeBoss(c, c.x1 - c.bossFinal - 1.4, (bz + sp.z) / 2);
    c.progL = sp.z - bz;
    const nl = clamp(tw.lanes || 2, 1, 3);
    const roller = ROLLERS[c.town];
    // lane 0: straight down past the spawn (first roller arrives by itself)
    // DECISION: lane 0 runs 1.6 u beside the spawn, not through it, so the spawn ring keeps a bite in every sector.
    addLane(c, sp.x + 1.6, sp.z - 9.5, sp.x + 1.6, c.z1 - 0.7, 1.2);
    for (let i = 1; i < nl; i++) {
      const z = sp.z - (0.42 + 0.3 * (i - 1)) * (sp.z - bz);
      if (i % 2) addLane(c, c.x0 + 0.8, z, c.x1 - 0.8, z, 1.0 + 0.2 * i);
      else addLane(c, c.x1 - 0.8, z, c.x0 + 0.8, z, 1.0 + 0.2 * i);
    }
    for (const ln of c.lanes) {
      const w = Math.abs(ln.bx - ln.ax) + 1.2, d = Math.abs(ln.bz - ln.az) + 1.2;
      addSurf(c, 'path', (ln.ax + ln.bx) / 2, (ln.az + ln.bz) / 2, w > d ? w : 1.2, w > d ? 1.2 : d, null);
    }
    boardRegion(c, 0.6);
    scatterBlankets(c, 5, bz + 1, sp.z - 3, 2.4, 1.3);
    const lines = linesOf(c);
    const penL = lines.filter(L => L.place === 'pen');
    let k = 0;
    for (const L of lines) {
      if (L.place === 'pen') continue;
      if (L.place === 'roll' || (L.kind === roller && k === 0)) { laneLine(c, L, nl); continue; }
      const p = 0.7 + 0.12 * (k % 2);
      const z = sp.z - p * (sp.z - bz), x = (k % 2 ? 1 : -1) * c.W * 0.28;
      if (L.place === 'stack') stackLine(c, L, [[x, z]]);
      else if (L.place === 'belt') beltLine(c, L, z);
      else spot(c, L, x, z, 1.0, 0, countOf(c, L));
      k++;
    }
    if (penL.length) buildPens(c, penL.map(L => ({ lines: [L], frac: 0.42, load: 3 })), bz + c.bossFinal + 0.5, sp.z - 0.6 * (sp.z - bz));
  },
};
ARCH_FN.PS = ARCH_FN.RR;
ARCH_FN.MR = ARCH_FN.CG;
ARCH_FN.CK = ARCH_FN.BP;
ARCH_FN.PF = ARCH_FN.BP;

function addLane(c, ax, az, bx, bz, v) {
  const i = c.lanes.length;
  c.lanes.push({ ax: r3(ax), az: r3(az), bx: r3(bx), bz: r3(bz), v: r3(v) });
  c.segs.push({ ax, az, bx, bz, w: 0.45 });
  return i;
}
/** Rollers for a line spread over the lanes. Lane 0 gets ≤ 2 rollers that fit r0, first one arriving at ~2.5 s. */
function laneLine(c, L, nl) {
  if (!c.lanes.length) addLane(c, c.x0 + 0.8, 0, c.x1 - 0.8, 0, 1.2);
  const n = countOf(c, L);
  const k = KIND[L.kind];
  const fits0 = canFit(c.r0, k.a);
  const per = [];
  for (let i = 0; i < c.lanes.length; i++) per.push(0);
  let left = n;
  if (fits0 && c.lanes.length > 1) { per[0] = Math.min(2, left); left -= per[0]; }
  for (let i = c.lanes.length > 1 ? 1 : 0; left > 0; i = i + 1 >= c.lanes.length ? (c.lanes.length > 1 ? 1 : 0) : i + 1) { per[i]++; left--; }
  per.forEach((m, li) => {
    const ln = c.lanes[li];
    const len = hyp(ln.bx - ln.ax, ln.bz - ln.az);
    for (let j = 0; j < m; j++) {
      let u;
      if (li === 0 && fits0 && c.lanes.length > 1) {
        const us = clamp(hyp(c.spawn.x - ln.ax, c.spawn.z - ln.az), 0, len);
        u = us - ln.v * (2.5 + j * 4.0);
        if (u < 0) u += len;
      } else u = len * ((j + 0.5) / m);
      const t = u / len;
      addItem(c, L.kind, ln.ax + (ln.bx - ln.ax) * t, ln.az + (ln.bz - ln.az) * t, { role: 'ing', lane: li, lu: u, zone: 0, line: L, edgeOk: true });
    }
  });
}
function beltLine(c, L, z) {
  const w = c.W * 0.6, d = 1.4;
  const bi = c.belts.length;
  c.belts.push({ x: 0, z: r3(z), w: r3(w), d, rot: 0, v: 1.2 });
  c.segs.push({ ax: -w / 2, az: z, bx: w / 2, bz: z, w: d / 2 + 0.1 });
  addSurf(c, 'path', 0, z, w, d, null);
  const n = countOf(c, L);
  for (let j = 0; j < n; j++) addItem(c, L.kind, -w / 2 + w * ((j + 0.5) / n), z, { role: 'ing', belt: bi, zone: 0, line: L });
}
function stackLine(c, L, pts) {
  const n = Math.max(L.need + 1, countOf(c, L));
  const sk = STACK_KIND[c.town];
  for (let j = 0; j < n; j++) {
    const p = pts[j % pts.length];
    for (let t = 0; t < 160; t++) {
      const sp = 2.5 + t / 40;
      const x = p[0] + rr(c, -sp, sp), z = p[1] + rr(c, -sp, sp);
      if (canPlace(c, x, z, KIND[sk].a, 2, { zone: 0, role: 'stack' })) { addItem(c, sk, x, z, { role: 'stack', stack: [L.kind], zone: 0, line: L }); break; }
    }
  }
}
function truck(c, x, z, R) {
  const pts = [[x - R, z + R, 1], [x + R, z + R, 0], [x + R, z - R, 1], [x - R, z - R, 1]];
  c.truckPath = pts.map(p => ({ x: r3(clamp(p[0], c.x0 + 2.5, c.x1 - 2.5)), z: r3(clamp(p[1], c.z0 + 2.5, c.z1 - 4)), stop: !!p[2] }));
}

// ---------- filling ----------
// DECISION: junk of T3+ must be edible before the final boss (a <= 0.85 * bossFinal.a); a bigger kind would sit in
// the supply sum (§4.2 margin) as food nobody can eat. A tier left empty hands its count to the tier below.
const JUNK_TOP = 0.85;
function buildPalette(c) {
  const tk = c.spec.tickets;
  const recipe = new Set();
  const req = new Set();
  for (const t of tk) { req.add(t.boss.kind); for (const l of t.lines) { recipe.add(l.kind); req.add(l.kind); } }
  for (const it of c.items) req.add(it.kind);
  const pool = kindsForTown(c.town).filter(k => !k.boss && !k.wall && !k.fragile && !recipe.has(k.id) && (k.tier < 3 || k.a <= JUNK_TOP * c.bossFinal + 1e-9));
  const byT = [[], [], [], [], []];
  for (const k of shuffled(c, pool)) byT[k.tier].push(k);
  const alloc = [3, 4, 3, 2, 1];
  const room = 18 - req.size;
  let tot = alloc.reduce((p, q) => p + q, 0);
  const cut = [1, 0, 2, 1, 0, 3, 2];
  for (let i = 0; tot > room && i < 40; i++) { const t = cut[i % cut.length]; if (alloc[t] > 1) { alloc[t]--; tot--; } else if (i > 20) break; }
  const lumsFor = t => {
    const s = new Set();
    for (const sf of c.surfaces) s.add(sf.lum);
    s.add(SURF[c.town].ground.lum);
    return [...s];
  };
  const pal = [[], [], [], [], []];
  for (let t = 0; t < 5; t++) {
    const cand = byT[t].slice();
    if (t <= 1) {
      let need = lumsFor(t);
      while (pal[t].length < alloc[t] && need.length && cand.length) {
        let bi = -1, bn = 0;
        cand.forEach((k, i) => { const n = need.filter(l => Math.abs(k.lum - l) >= CONTRAST_MIN).length; if (n > bn) { bn = n; bi = i; } });
        if (bi < 0) break;
        const k = cand.splice(bi, 1)[0];
        pal[t].push(k);
        need = need.filter(l => Math.abs(k.lum - l) < CONTRAST_MIN);
      }
    }
    while (pal[t].length < alloc[t] && cand.length) pal[t].push(cand.shift());
  }
  c.pal = pal;
}
function pickRegion(c, t) {
  let tot = 0;
  for (const g of c.regions) { if (g.mask && !g.mask[t]) continue; tot += areaOf(g) * g.dens; }
  let u = c.rng() * tot;
  for (const g of c.regions) { if (g.mask && !g.mask[t]) continue; u -= areaOf(g) * g.dens; if (u <= 0) return g; }
  return c.regions[c.regions.length - 1];
}
function areaOf(g) { return g.t === 'rect' ? g.w * g.d : 3.14159 * g.r * g.r; }
function sampleIn(c, g) {
  if (g.t === 'rect') return [g.x + (c.rng() - 0.5) * g.w, g.z + (c.rng() - 0.5) * g.d];
  for (let i = 0; i < 20; i++) { const x = (c.rng() * 2 - 1) * g.r, z = (c.rng() * 2 - 1) * g.r; if (x * x + z * z <= g.r * g.r) return [g.x + x, g.z + z]; }
  return [g.x, g.z];
}
function winOK(c, t, p, relax) {
  if (relax) return true;
  const w = WIN[t];
  const d = p < w[0] ? w[0] - p : p > w[1] ? p - w[1] : 0;
  return d <= 0 || c.rng() > d / 0.2;
}
function kindFor(c, t, x, z, fitR) {
  let ks = c.pal[t];
  if (!ks.length) return null;
  if (fitR) ks = ks.filter(k => canFit(fitR, k.a));
  if (t <= 1) ks = ks.filter(k => contrastOK(c, k, x, z));
  if (!ks.length) return null;
  return ks[Math.floor(c.rng() * ks.length)];
}
// DECISION: Picnic T0 samples straight from the blanket/path rectangles 85 % of the time (dense crumbs on cloth).
function placeJunk(c, t) {
  const onCloth = t === 0 && c.town === 'picnic' && c.surfaces.length;
  let sArea = 0;
  if (onCloth) for (const s of c.surfaces) sArea += s.w * s.d;
  for (let tr = 0; tr < 160; tr++) {
    let x, z, zone;
    if (onCloth && c.rng() < 0.85) {
      let u = c.rng() * sArea, s = c.surfaces[0];
      for (const q of c.surfaces) { u -= q.w * q.d; if (u <= 0) { s = q; break; } }
      x = s.x + (c.rng() - 0.5) * s.w; z = s.z + (c.rng() - 0.5) * s.d; zone = zoneAt(c, x, z);
    } else {
      const g = pickRegion(c, t);
      [x, z] = sampleIn(c, g); zone = g.zone;
    }
    if (!winOK(c, t, progAt(c, x, z), tr > 100)) continue;
    const k = kindFor(c, t, x, z, 0);
    if (!k) continue;
    if (canPlace(c, x, z, k.a, t, { zone })) { addItem(c, k.id, x, z, { zone }); return true; }
  }
  return false;
}
function spawnRing(c) {
  const sp = c.spawn;
  const fitTiers = [0, 1, 2].filter(t => c.pal[t].some(k => canFit(c.r0, k.a)));
  for (let s = 0; s < 8; s++) {
    for (let tr = 0; tr < 60; tr++) {
      const di = s * 8 + 1 + ri(c, 6), rad = rr(c, 0.45, tr > 30 ? 1.15 : 0.8);   // off the sector edges (rounding)
      const x = sp.x + DIRS[di][0] * rad, z = sp.z + DIRS[di][1] * rad;
      const t = c.spec.spawnTier != null ? c.spec.spawnTier : fitTiers[ri(c, Math.min(2, fitTiers.length))];
      const k = kindFor(c, t, x, z, c.r0) || kindFor(c, fitTiers[0], x, z, c.r0);
      if (!k) continue;
      if (canPlace(c, x, z, k.a, k.tier, { zone: 0 })) { addItem(c, k.id, x, z, { zone: 0 }); break; }
    }
  }
  let extra = 0;
  for (let tr = 0; tr < 200 && extra < 6; tr++) {
    const di = ri(c, 64), rad = rr(c, 1.2, 2.4);
    const x = sp.x + DIRS[di][0] * rad, z = sp.z + DIRS[di][1] * rad;
    const t = fitTiers[ri(c, fitTiers.length)];
    const k = kindFor(c, t, x, z, c.r0);
    if (k && canPlace(c, x, z, k.a, k.tier, { zone: 0 })) { addItem(c, k.id, x, z, { zone: 0 }); extra++; }
  }
}
function placeRings(c, rings, counts) {
  const sp = c.spawn;
  for (const [ra, rb, t, n0] of rings) {
    const n = n0 < 0 ? counts[t] : Math.min(n0, counts[t]);
    let done = 0;
    for (let tr = 0; tr < n * 80 && done < n; tr++) {
      const di = ri(c, 64), rad = rr(c, ra, rb);
      const x = sp.x + DIRS[di][0] * rad, z = sp.z + DIRS[di][1] * rad;
      const k = kindFor(c, t, x, z, 0);
      if (k && canPlace(c, x, z, k.a, t, { zone: 0 })) { addItem(c, k.id, x, z, { zone: 0 }); done++; }
    }
    counts[t] -= done;
  }
}
/** Moves each ingredient spot to the nearest point (DIRS spiral) where a 0.6 u probe fits in its zone. */
// DECISION: archetypes name spots loosely; this pass keeps clusters off walls, pens, lanes and bosses.
function settleSpots(c) {
  for (const s of c.spots) {
    const ok = (x, z) => canPlace(c, x, z, Math.max(0.6, s.r * 0.8), 2, { zone: s.zone, role: 'ing' });
    if (ok(s.x, s.z)) continue;
    let done = false;
    for (let rad = 0.5; rad <= 8 && !done; rad += 0.5) {
      for (let k = 0; k < 64; k += 4) {
        const x = s.x + DIRS[k][0] * rad, z = s.z + DIRS[k][1] * rad;
        if (ok(x, z)) { s.x = x; s.z = z; done = true; break; }
      }
    }
  }
}
function placeSpots(c) {
  for (const s of c.spots) {
    const k = KIND[s.L.kind];
    let done = 0;
    for (let tr = 0; tr < 200 && done < s.n; tr++) {
      const r = s.r * (1 + tr / 60);
      const x = s.x + (c.rng() * 2 - 1) * r, z = s.z + (c.rng() * 2 - 1) * r;
      if (hyp(x - s.x, z - s.z) > r) continue;
      if (!contrastOK(c, k, x, z) && tr < 150) continue;
      if (canPlace(c, x, z, k.a, k.tier, { zone: s.zone, role: 'ing' })) { addItem(c, k.id, x, z, { role: 'ing', zone: s.zone, line: s.L }); done++; }
    }
  }
}
/** Cloth patches under ingredient spots that would fail the contrast rule. */
function ingPatches(c) {
  for (const s of c.spots) {
    const k = KIND[s.L.kind];
    if (k.tier > 1 || contrastOK(c, k, s.x, s.z)) continue;
    const b = bestSurfFor(c, k);
    const sz = 2 * s.r + 1.2;
    const sf = addSurf(c, b.type, s.x, s.z, sz, sz, b.col != null ? b.col : null);
    if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: s.zone, dens: 0.6, mask: [1, 1, 0, 0, 0] });
  }
}
function supplyOf(c) {
  let s = 0;
  for (const it of c.items) { if (it.role === 'boss') continue; const k = it.role === 'ing' ? K_ING : it.k; s += k * it.a * it.a; }
  return s;
}
function needMassOf(c) { const r = needR(c.bossFinal); return (r * r - c.r0 * c.r0) / G; }
/** Moves the growth margin (supply / needMass) into the spec range by swapping junk kinds. */
// DECISION: the margin is fixed by swapping far junk to a bigger or smaller kind of the palette (same tier first,
// then a neighbour tier); counts stay at spec.items.
function fixMargin(c) {
  const [lo, hi] = c.spec.margin;
  const need = needMassOf(c);
  const mid = (lo + hi) / 2;
  const all = [];
  for (let t = 0; t < 5; t++) for (const k of c.pal[t]) all.push(k);
  for (let it = 0; it < 400; it++) {
    const m = supplyOf(c) / need;
    if (m >= lo && m <= hi && (it > 30 || Math.abs(m - mid) < (hi - lo) * 0.25)) return;
    const up = m < mid;
    // DECISION: up-swaps skip junk within 2.6 u of spawn, so the spawn ring and the §4.2 spawn density keep their bites.
    const cand = c.items.map((o, i) => i).filter(i => { const o = c.items[i];
      return o.role === 'junk' && (up ? o.tier >= 1 && (o.x - c.spawn.x) ** 2 + (o.z - c.spawn.z) ** 2 > 2.6 * 2.6 : o.tier >= 2); });
    if (!cand.length) return;
    const i = cand[ri(c, cand.length)];
    const o = c.items[i];
    const opts = all.filter(k => (up ? k.a > o.a : k.a < o.a) && Math.abs(k.tier - o.tier) <= 1 && (k.tier > 1 || contrastOK(c, k, o.x, o.z)));
    if (!opts.length) { if (up) relocateUp(c); continue; }
    const k = opts[ri(c, opts.length)];
    if (up) {
      const p = progAt(c, o.x, o.z);
      if (k.tier >= 2 && p < WIN[k.tier][0]) { relocateUp(c); continue; }
      c.items.splice(i, 1);
      if (canPlace(c, o.x, o.z, k.a, k.tier, { zone: o.zone })) addItem(c, k.id, o.x, o.z, { zone: o.zone, rot: o.rot });
      else { c.items.splice(i, 0, o); relocateUp(c); }
    } else {
      c.items[i] = Object.assign({}, o, { kind: k.id, ki: KIND_ID[k.id], a: k.a, h: k.h, k: k.k, tier: k.tier, flags: k.fragile ? F.FRAGILE : 0 });
      if (!gatesOK(c)) c.items[i] = o;   // a down-swap never starves the front of a gate (fixGates)
    }
  }
}
// DECISION: when an in-place swap has no room, the margin goes up by trading one far T0/T1 junk (≥ 3.5 u from
// spawn, so the spawn ring keeps its bites) for a fresh T3 (else T2) junk placed by the normal junk rules.
function relocateUp(c) {
  const cand = c.items.map((o, i) => i).filter(i => {
    const o = c.items[i];
    return o.role === 'junk' && o.tier <= 1 && (o.x - c.spawn.x) ** 2 + (o.z - c.spawn.z) ** 2 > 3.5 * 3.5;
  });
  if (!cand.length) return false;
  const i = cand[ri(c, cand.length)];
  const o = c.items.splice(i, 1)[0];
  if (placeJunk(c, 3) || placeJunk(c, 2)) return true;
  c.items.splice(i, 0, o);
  return false;
}
// DECISION: the §4.2 margin is board-wide; a gated level also needs food in front of each gate. The supply that is
// reachable below a gate's radius (zones whose gates all open below it, items that fit before it) must be ≥
// gateM × the mass to grow from r0 to that radius (gateM = the level's own minimum margin, spec.margin[0]). A short
// front takes junk from behind the gate (else far T0/T1 junk in front, ≥ 3.5 u from spawn) and re-places it in
// front as T2/T3 junk that fits before the gate.
const gateM = c => c.spec.margin[0];
function reachR(c, id) { let r = 0; for (let z = c.zones[id]; z && z.id > 0; z = c.zones[z.parent]) if (z.r > r) r = z.r; return r; }
function frontSupply(c, rG) {
  let s = 0;
  for (const o of c.items) {
    if ((o.role !== 'junk' && o.role !== 'ing') || o.a > FIT * rG + 1e-9 || reachR(c, o.zone) >= rG - 1e-9) continue;
    s += (o.role === 'ing' ? K_ING : o.k) * o.a * o.a;
  }
  return s;
}
function fixGates(c) {
  const gz = c.zones.filter(z => z.id > 0 && z.r > c.r0).sort((p, q) => p.r - q.r);
  for (const zn of gz) {
    const rG = zn.r, need = (gateM(c) * (rG * rG - c.r0 * c.r0)) / G;
    const regs = c.regions.filter(g => reachR(c, g.zone) < rG - 1e-9);
    const ks = c.pal[3].concat(c.pal[2]).filter(k => k.a <= 0.95 * FIT * rG && k.a >= 0.25);
    if (!regs.length || !ks.length) continue;
    for (let it = 0; it < 150 && frontSupply(c, rG) < need; it++) {
      let src = c.items.map((o, i) => i).filter(i => { const o = c.items[i]; return o.role === 'junk' && reachR(c, o.zone) >= rG - 1e-9; });
      if (!src.length) src = c.items.map((o, i) => i).filter(i => { const o = c.items[i];
        return o.role === 'junk' && o.tier <= 1 && reachR(c, o.zone) < rG - 1e-9 && (o.x - c.spawn.x) ** 2 + (o.z - c.spawn.z) ** 2 > 3.5 * 3.5; });
      if (!src.length) break;
      const i = src[ri(c, src.length)];
      const o = c.items.splice(i, 1)[0];
      if (!placeFront(c, regs, ks)) c.items.splice(i, 0, o);
    }
  }
}
function gatesOK(c) {
  for (const zn of c.zones) if (zn.id > 0 && zn.r > c.r0 && frontSupply(c, zn.r) < (gateM(c) * (zn.r * zn.r - c.r0 * c.r0)) / G - 1e-9) return false;
  return true;
}
function placeFront(c, regs, ks) {
  let tot = 0;
  for (const g of regs) tot += areaOf(g) * g.dens;
  for (let tr = 0; tr < 120; tr++) {
    let u = c.rng() * tot, g = regs[regs.length - 1];
    for (const q of regs) { u -= areaOf(q) * q.dens; if (u <= 0) { g = q; break; } }
    const [x, z] = sampleIn(c, g);
    const zone = zoneAt(c, x, z);
    if (reachR(c, zone) >= reachR(c, g.zone) + 1e-9 && zone !== g.zone) continue;
    const k = ks[ri(c, ks.length)];
    if (!winOK(c, k.tier, progAt(c, x, z), tr > 80)) continue;
    if (canPlace(c, x, z, k.a, k.tier, { zone })) { addItem(c, k.id, x, z, { zone }); return true; }
  }
  return false;
}
function fixFood(c) {
  for (let it = 0; it < 200; it++) {
    const n = c.items.length;
    const food = c.items.filter(o => KIND[o.kind].food).length;
    if (food / n >= 0.42) return;
    const cand = c.items.map((o, i) => i).filter(i => c.items[i].role === 'junk' && !KIND[c.items[i].kind].food);
    if (!cand.length) return;
    const i = cand[ri(c, cand.length)];
    const o = c.items[i];
    const opts = c.pal[o.tier].filter(k => k.food && k.a <= o.a + 0.02 && contrastOK(c, k, o.x, o.z));
    if (!opts.length) continue;
    const k = opts[ri(c, opts.length)];
    c.items[i] = Object.assign({}, o, { kind: k.id, ki: KIND_ID[k.id], a: k.a, h: k.h, k: k.k, tier: k.tier });
  }
}
function addDecor(c) {
  const dk = DECOR_KIND[c.town];
  const n = 10 + ri(c, 8);
  for (let i = 0; i < n; i++) {
    const side = i % 4;
    let x, z;
    if (side < 2) { x = (side ? c.x1 : c.x0) + (side ? 1 : -1) * rr(c, 1.4, 3.2); z = rr(c, c.z0, c.z1); }
    else { z = (side === 3 ? c.z1 : c.z0) + (side === 3 ? 1 : -1) * rr(c, 1.4, 3.2); x = rr(c, c.x0, c.x1); }
    c.decor.push({ kind: dk, x: r3(x), z: r3(z), rot: r3((ri(c, 64) * TAU) / 64 - PI), s: r3(rr(c, 0.8, 1.25)) });
  }
}
function largestRemainder(mix, M) {
  const raw = mix.map(p => (p * M) / 100);
  const out = raw.map(Math.floor);
  let left = M - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; left > 0; j++, left--) out[order[j % 5][1]]++;
  return out;
}

/** Expands a spec into a playable level (deterministic per (spec, seed)). */
export function genLevel(spec, seed) {
  const c = ctxFor(spec, seed >>> 0);
  const fn = ARCH_FN[spec.arch] || ARCH_FN.BP;
  const tw = spec.twist || {};
  fn(c);
  if (!surfAt(c, c.spawn.x, c.spawn.z, 0.5)) spawnPad(c);
  if (tw.gulls) { c.gullEvery = tw.gulls.every || 16; c.gulls = tw.gulls.n || 1; c.roost = { x: r3(c.x1 - 1.5), z: r3(c.z0 + 1.5) }; }
  if (tw.cake) c.cake = { tiers: tw.cake.slice() };
  if (tw.truck && !c.truckPath.length) truck(c, 0, 0, Math.min(c.W, c.D) * 0.28);
  settleSpots(c);
  ingPatches(c);
  buildPalette(c);
  // spawn keep-outs: non-fitting T2 ≥ 2 u, T3+ ≥ 4 u (§4.2 spacing from spawn)
  c.keeps.push({ x: c.spawn.x, z: c.spawn.z, r: 2.0, maxA: FIT * c.r0 }, { x: c.spawn.x, z: c.spawn.z, r: 4.0, maxA: 0.5 });
  placeSpots(c);
  spawnRing(c);
  const walls = c.items.filter(o => o.role === 'wall' || o.role === 'gate').length;
  const bosses = c.items.filter(o => o.role === 'boss').length;
  const M = Math.max(0, Math.min(ITEM_MAX, spec.items) - walls - bosses);
  const tgt = largestRemainder(spec.mix, M);
  const counts = tgt.slice();
  for (const o of c.items) if (o.role !== 'wall' && o.role !== 'gate' && o.role !== 'boss') counts[o.tier] = Math.max(0, counts[o.tier] - 1);
  if (spec.rings) placeRings(c, spec.rings, counts);
  // DECISION: a slot that finds no room after 160 tries moves to the neighbour tier (T0↔T1, T2+ → one down);
  // a tier stops after 6 straight misses.
  const NB = [1, 0, 1, 2, 3];
  for (let t = 4; t >= 0; t--) {
    if (!c.pal[t].length && NB[t] < t) { counts[NB[t]] += counts[t]; counts[t] = 0; continue; }
    let miss = 0;
    for (let j = 0; j < counts[t] && miss < 6; j++) {
      if (placeJunk(c, t)) { miss = 0; continue; }
      miss++;
      if (t > 0 || counts[1] >= 0) { if (NB[t] < t) counts[NB[t]]++; else if (placeJunk(c, NB[t])) miss = 0; }
    }
  }
  fixGates(c);
  fixMargin(c);
  fixFood(c);
  fixGates(c);
  fixMargin(c);   // DECISION: a second pass, since fixFood / fixGates swaps can move the margin
  addDecor(c);
  // DECISION (Sim 11-03): the expanded level carries its zone graph (level.zoneGraph) so bots need not import levels.js.
  const lv = finish(c, spec, seed);
  lv.zoneGraph = zoneGraph(lv);
  return lv;
}

function finish(c, spec, seed) {
  const mir = (seed & 1) === 1;
  const mx = x => (mir ? r3(-x) : x);
  const mr = r => (mir ? r3(-r) : r);
  const mrot = r => (mir ? r3(PI - r > PI ? -PI - r : PI - r) : r);
  // DECISION: mirroring maps x → −x; item rot (yaw about the up axis) maps to −rot for round props, and wall
  // pieces keep their tangent alignment (rot → π − rot). Both are written to 3 decimals.
  const items = c.items.map(o => ({
    kind: o.kind, ki: o.ki, x: mx(o.x), z: o.z, a: o.a, h: o.h, k: o.k, flags: o.flags,
    rot: o.role === 'wall' || o.role === 'gate' ? mrot(o.rot) : mr(o.rot), lane: o.lane, lu: o.lu, belt: o.belt, stack: o.stack, zone: o.zone,
  }));
  // zone centroids from their items (pens keep their centre)
  const zones = c.zones.map(z => ({ id: z.id, x: mx(z.x), z: z.z, parent: z.parent, gate: z.gate, r: z.r }));
  const tickets = spec.tickets.map((t, ti) => ({
    lines: t.lines.map(l => ({ kind: l.kind, need: l.need, place: l.place || 'open' })),
    boss: c.bossPos[ti] != null ? c.bossPos[ti] : -1,
  }));
  const tw = spec.twist || {};
  return {
    n: spec.n, name: spec.name, town: spec.town, arch: spec.arch, W: c.W, D: c.D, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1,
    spawn: { x: mx(c.spawn.x), z: c.spawn.z }, r0: spec.r0, T: spec.T, timed: spec.timed !== false, cap: tw.cap || R_MAX,
    items,
    surfaces: c.surfaces.map(s => ({ type: s.type, x: mx(s.x), z: s.z, w: s.w, d: s.d, rot: 0, color: s.color })),
    decor: c.decor.map(d => ({ kind: d.kind, x: mx(d.x), z: d.z, rot: mr(d.rot), s: d.s })),
    lanes: c.lanes.map(l => ({ ax: mx(l.ax), az: l.az, bx: mx(l.bx), bz: l.bz, v: l.v })),
    belts: c.belts.map(b => ({ x: mx(b.x), z: b.z, w: b.w, d: b.d, rot: 0, v: mir ? -b.v : b.v })),
    roost: c.roost ? { x: mx(c.roost.x), z: c.roost.z } : null, gullEvery: c.gullEvery, gulls: c.gulls,
    truckPath: c.truckPath.map(p => ({ x: mx(p.x), z: p.z, stop: p.stop })), cake: c.cake,
    tickets, zones, seed: seed >>> 0,
  };
}
