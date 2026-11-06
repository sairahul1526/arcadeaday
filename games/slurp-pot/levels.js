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
// DECISION (11-04): all ten archetypes are built (MR, CK, PF, PS today) plus FE, the Feast course map (feastCourse).

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
// ---------- Feast (§3.12 Feast, D23) ----------
// DECISION (11-04 Wed, Sim relay): market Feast pens are built of crates (FEAST_WALL), not cars. Car walls (a 1.3,
// wall.a 1.3 vs 1.0 for picnic hedges / harbour posts) made each pen cost ~1.7x the supply of a picnic pen, so the
// margin left too little food under the boss: from course 2 the expert stalled (one c2 map stopped at r 1.42 of 1.50)
// and market served a median 9 tickets vs picnic 17 / harbour 18. With crates alone market went to 21 (24 seeds), so
// its course margin is [1.8, 2.2] (others [1.9, 2.3]): market expert median 17 (24 seeds), casual 5 (16 seeds).
// Picnic and harbour are unchanged (same maps).
const FEAST_WALL = { market: 'crate' }, FEAST_MARGIN = { market: [1.8, 2.2] };
const FEAST_BOSS = { picnic: ['boss-hamper', 'boss-table', 'boss-bigsandwich', 'boss-watermelon'], market: ['boss-pizza', 'boss-fruitstall', 'boss-bakerycart'],
  harbour: ['boss-popcorncart', 'boss-icecreamkiosk', 'boss-snackboat'] };
/**
 * Feast course `c` (1, 2, …) for `town` and the run `seed`: an expanded level (arch FE, r0 0.30) with 4 tickets of 2
 * lines; tickets 1–3 have no boss (tickets[k].boss = −1), ticket 4 a mini boss with a = 1.4 + 0.1·(c − 1) (max 2.0).
 * o.cur = the player's current level (rolling needs L10 beaten, i.e. cur > 10; belts cur > 22; default all).
 * Escalation (D23): c1 open, needs 2–3; c2 ticket 2's second line in a pen; c3 ticket 3's first line rolling (else a
 * second pen: ticket 3's second line); c4 ticket 4's first line on a belt (else rolling if the roller is still free,
 * else a pen); c ≥ 5 needs [2 + (c − 4), 3 + (c − 4)] capped at 6. Same (c, town, seed, cur band) → same level.
 */
// DECISION (11-04): ticket k takes 2 distinct ingredients from the k-th quarter of the town's ingredients sorted by
// size (small first, so ticket 1 fits a fresh pot), the roller kind is swapped in for a rolling line; the course seed
// is fnv1a('feast|town|seed|c'). The level carries lvl.feast = { course, need: [lo, hi], cur }.
// DECISION (11-04 Wed): market courses carry spec.wallKind 'crate' and margin [1.8, 2.2] (FEAST_WALL / FEAST_MARGIN
// above; penAt reads spec.wallKind).
export function feastCourse(c, town, seed, o = {}) {
  c = Math.max(1, c | 0);
  if (TOWNS.indexOf(town) < 0) town = 'picnic';
  const cur = o.cur != null ? o.cur | 0 : LEVELS;
  const rolling = cur > 10, belts = cur > 22;
  const cs = fnv1a('feast|' + town + '|' + (seed >>> 0) + '|' + c) >>> 0;
  const ck = 'feast|' + cs + '|' + (belts ? 2 : rolling ? 1 : 0);
  if (cache.has(ck)) return cache.get(ck);
  const rng = mulberry32(cs ^ 0x2545f491);
  const lo = c >= 5 ? Math.min(6, c - 2) : 2, hi = c >= 5 ? Math.min(6, c - 1) : 3;
  const roller = ROLLERS[town];
  const ings = kindsForTown(town).filter(k => k.ing && (k.id !== roller || !rolling)).sort((p, q) => p.a - q.a || (p.id < q.id ? -1 : 1));
  const used = new Set(), tickets = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.floor((k * ings.length) / 4), b = Math.max(a + 2, Math.floor(((k + 1) * ings.length) / 4));
    const pool = ings.slice(a, b).filter(q => !used.has(q.id));
    const lines = [];
    for (let j = 0; j < 2; j++) {
      const src = pool.length ? pool : ings.filter(q => !used.has(q.id));
      const q = src.splice(Math.floor(rng() * src.length), 1)[0];
      used.add(q.id);
      lines.push({ kind: q.id, need: lo + Math.floor(rng() * (hi - lo + 1)) });
    }
    tickets.push({ lines, boss: null });
  }
  let rollUsed = false;
  if (c >= 2) tickets[1].lines[1].place = 'pen';
  if (c >= 3) { if (rolling) { tickets[2].lines[0] = { kind: roller, need: tickets[2].lines[0].need, place: 'roll' }; rollUsed = true; } else tickets[2].lines[1].place = 'pen'; }
  if (c >= 4) {
    if (belts) tickets[3].lines[0].place = 'belt';
    else if (rolling && !rollUsed) tickets[3].lines[0] = { kind: roller, need: tickets[3].lines[0].need, place: 'roll' };
    else tickets[3].lines[1].place = 'pen';
  }
  const bl = FEAST_BOSS[town];
  tickets[3].boss = { kind: bl[(c - 1) % bl.length], a: r3(Math.min(2.0, 1.4 + 0.1 * (c - 1))) };
  const spec = {
    n: 0, name: 'Feast', town, arch: 'FE', W: 24, D: 34, seed: cs, r0: R0, T: 45, items: 200, mix: [32, 30, 18, 15, 5], margin: FEAST_MARGIN[town] || [1.9, 2.3],
    tickets, twist: {}, feast: true, wallKind: FEAST_WALL[town],
  };
  const lvl = genLevel(spec, cs);
  lvl.feast = { course: c, need: [lo, hi], cur };
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
// DECISION (11-04, §4.5): each town has two fragile stack kinds, alternating per stack in a level.
const STACK_KIND = { picnic: ['teacups', 'platepile'], market: ['jarstack', 'eggcrate'], harbour: ['wafflestack', 'platepile'] };
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
    beltFill: [], progFn: null,
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
// DECISION (11-04): an archetype may set c.progFn (PS: the spiral parameter) to replace distance-from-spawn progress.
function progAt(c, x, z) {
  const p = c.progFn ? c.progFn(x, z) : clamp(hyp(x - c.spawn.x, z - c.spawn.z) / c.progL, 0, 1);
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
// DECISION (11-04): surfaces no longer overlap, so a road corner or a split blanket is two touching rectangles. An
// item's contrast is judged on its inner square (half-size 0.6·a, 9 sample points): every surface under a sample
// point must pass, and when a sample point is on bare ground the ground rule must pass too. On one surface this is
// Tuesday's rule. It runs on 3-decimal coordinates, exactly as verify.mjs contrastPass sees the expanded level.
function contrastOK(c, k, x, z) {
  if (k.tier > 1) return true;
  x = r3(x); z = r3(z);
  const m = k.a * 0.6;
  let bare = false;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const px = x + i * m, pz = z + j * m;
    let hit = false;
    for (const s of c.surfaces) {
      if (Math.abs(px - s.x) > s.w / 2 + 1e-6 || Math.abs(pz - s.z) > s.d / 2 + 1e-6) continue;
      hit = true;
      if (Math.abs(k.lum - s.lum) < CONTRAST_MIN) return false;
    }
    if (!hit) bare = true;
  }
  return !bare || groundOK(c, k);
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
// DECISION (D33 z-fight, 11-04): surfaces never overlap (they all sit at y 0, so two overlapping ones z-fight).
// A new surface is clipped against every earlier one (the largest side remainder survives, preferring the one that
// still holds opt.anchor); a priority surface (opt.prio: lane bed, belt bed, spawn pad, ingredient patch) instead
// splits the earlier non-priority surfaces it overlaps into up to 4 pieces (pieces under SURF_MIN are dropped).
const SURF_MIN = 0.6;
const rectOf = s => ({ xa: s.x - s.w / 2, xb: s.x + s.w / 2, za: s.z - s.d / 2, zb: s.z + s.d / 2 });
const rectHit = (r, q, gap) => r.xa < q.xb + gap - 1e-4 && r.xb > q.xa - gap + 1e-4 && r.za < q.zb + gap - 1e-4 && r.zb > q.za - gap + 1e-4;
function cutRect(r, q, anchor) {
  if (!rectHit(r, q, 0)) return r;
  const cand = [
    { xa: r.xa, xb: Math.min(r.xb, q.xa), za: r.za, zb: r.zb }, { xa: Math.max(r.xa, q.xb), xb: r.xb, za: r.za, zb: r.zb },
    { xa: r.xa, xb: r.xb, za: r.za, zb: Math.min(r.zb, q.za) }, { xa: r.xa, xb: r.xb, za: Math.max(r.za, q.zb), zb: r.zb },
  ];
  let best = null, bs = -1;
  for (const e of cand) {
    const w = e.xb - e.xa, d = e.zb - e.za;
    if (w < SURF_MIN || d < SURF_MIN) continue;
    const held = anchor && anchor[0] > e.xa && anchor[0] < e.xb && anchor[1] > e.za && anchor[1] < e.zb ? 1e6 : 0;
    if (w * d + held > bs + 1e-9) { bs = w * d + held; best = e; }
  }
  return best;
}
const g2 = v => Math.floor(v * 500 + 0.5) / 500;
function setRect(o, q) {
  // edges on a 0.002 grid, so the centre is an exact 3-decimal value and x -> -x mirroring keeps edges shared
  const xa = g2(q.xa), xb = g2(q.xb), za = g2(q.za), zb = g2(q.zb);
  o.x = r3((xa + xb) / 2); o.z = r3((za + zb) / 2); o.w = r3(xb - xa); o.d = r3(zb - za);
}
/** e minus q as up to 4 disjoint rectangles (full-depth left/right, then the middle strips), each >= SURF_MIN. */
function splitRect(e, q) {
  const mx0 = Math.max(e.xa, q.xa), mx1 = Math.min(e.xb, q.xb);
  const out = [
    { xa: e.xa, xb: q.xa, za: e.za, zb: e.zb }, { xa: q.xb, xb: e.xb, za: e.za, zb: e.zb },
    { xa: mx0, xb: mx1, za: e.za, zb: q.za }, { xa: mx0, xb: mx1, za: q.zb, zb: e.zb },
  ];
  return out.filter(r => r.xb - r.xa >= SURF_MIN && r.zb - r.za >= SURF_MIN);
}
/** Does the rectangle (x, z, w, d), grown by gap, overlap any surface? */
function surfHit(c, x, z, w, d, gap) {
  const r = { xa: x - w / 2, xb: x + w / 2, za: z - d / 2, zb: z + d / 2 };
  for (const s of c.surfaces) if (rectHit(r, rectOf(s), gap)) return true;
  return false;
}
/** Town surface style: { type, s: {color, lum}, col } for addSurf. */
function surfStyle(c, type, color) {
  const pal = SURF[c.town];
  if (type === 'path') return pal.path;
  if (type === 'rug') return pal.rug || pal.blanket[0];
  if (type === 'deck') return pal.deck || pal.blanket[0];
  if (type === 'water') return pal.water || pal.blanket[1];
  return color != null ? (typeof color === 'number' ? pal.blanket[color] : color) : pal.blanket[0];
}
function addSurf(c, type, x, z, w, d, color, opt = {}) {
  const s = surfStyle(c, type, color);
  // clip to the board
  let q = { xa: Math.max(c.x0, x - w / 2), xb: Math.min(c.x1, x + w / 2), za: Math.max(c.z0, z - d / 2), zb: Math.min(c.z1, z + d / 2) };
  if (q.xb - q.xa < 0.4 || q.zb - q.za < 0.4) return null;
  if (opt.prio) {
    for (let i = c.surfaces.length - 1; i >= 0; i--) {
      const e = c.surfaces[i];
      if (e.prio || !rectHit(q, rectOf(e), 0)) continue;
      const parts = splitRect(rectOf(e), q).map(r => { const o = Object.assign({}, e); setRect(o, r); return o; });
      c.surfaces.splice(i, 1, ...parts);
    }
  }
  for (const e of c.surfaces) { if (!q) break; q = cutRect(q, rectOf(e), opt.anchor || [x, z]); }
  if (!q) return null;
  const o = { type, x: 0, z: 0, w: 0, d: 0, rot: 0, color: s.color, lum: s.lum, prio: !!opt.prio };
  setRect(o, q);
  c.surfaces.push(o);
  return o;
}
function restyle(c, o, b) { const s = surfStyle(c, b.type, b.col != null ? b.col : null); o.type = b.type; o.color = s.color; o.lum = s.lum; }
/** Town surface (blanket colours, path, rug, deck) with the best contrast for a kind; `prefer` wins when it passes. */
// DECISION (11-04): rug and deck join the options (Market's plum rug and Harbour's white deck are the darkest /
// lightest cloth there); a preferred type (lane and belt beds prefer 'path') is used whenever it passes.
function bestSurfFor(c, k, prefer) {
  const pal = SURF[c.town];
  const opts = [{ type: 'blanket', s: pal.blanket[0], col: 0 }, { type: 'blanket', s: pal.blanket[1], col: 1 }, { type: 'path', s: pal.path }];
  if (pal.rug && pal.rug.color !== pal.blanket[0].color) opts.push({ type: 'rug', s: pal.rug });
  if (pal.deck) opts.push({ type: 'deck', s: pal.deck });
  if (prefer) { const p = opts.find(o => o.type === prefer); if (p && Math.abs(p.s.lum - k.lum) >= CONTRAST_MIN) return p; }
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
// DECISION (11-04, §4.2 margin vs the gate rule): wall pieces count in the margin at K_WALL, and a full-width wall
// costs ≈ K_WALL·wall.a²·W/(1.16·wall.a) ≈ 0.52·W·wall.a of supply (0.8–1.1 of the margin per late wall at W 26–34),
// so the three walls of L19/L25/L34/L37/L39/L58 overshot their bands before any junk (walls alone 2.0–2.5). CG and MR
// keep full-width walls for their earliest gates while all walls stay inside (margin hi − 0.35)·needMass, and turn
// the later gates into POCKETS: pens against the board boundary (a quarter ring around a far corner, else a half
// ring on a side edge), which need ¼–½ of a free ring's pieces. End pieces sit like lineWall's (centre 0.3 + 0.5·wall.a
// from the edge); the gate hole is ringWall's (rPass).
const POCKET_RESERVE = 0.35;
function gateSize(rG, kind) { const g = 0.97 * FIT * rG; return { gateA: g, wallA: Math.max(KIND[kind].a, 1.25 * g) }; }
function lineCost(c, rG, kind) {
  const { gateA, wallA } = gateSize(rG, kind);
  const len = c.W - 2 * (0.3 + 0.5 * wallA) - rPassFor(gateA, wallA) - 2 * wallA;
  return K_WALL * (wallA * wallA * (Math.ceil(len / (1.16 * wallA)) + 3) + gateA * gateA);
}
/** Smallest pocket (corner: quarter ring, else half ring) with room for the gate hole and an inner radius ≥ rIn. */
function pocketGeom(rG, kind, corner, rIn) {
  const { gateA, wallA } = gateSize(rG, kind);
  const cnn = 2 * wallA + rPassFor(gateA, wallA), e = 0.3 + 0.5 * wallA;
  const span = corner ? HPI : PI;
  for (let R = Math.max(rIn + wallA + 0.3, cnn / 1.8); R < 16; R += 0.25) {
    const arc = span - 2 * asinp(Math.min(1, e / R)), Phi = 2 * asinp(Math.min(1, cnn / (2 * R)));
    if (arc - Phi < 0.12) continue;
    const dMax = 2 * asinp(Math.min(1, (1.16 * wallA) / (2 * R)));
    const m = Math.max(1, Math.ceil((arc - Phi) / 2 / dMax - 1e-9));
    return { R, gateA, wallA, corner, cost: K_WALL * (2 * (m + 1) * wallA * wallA + gateA * gateA) };
  }
  return null;
}
/** Pocket pen: the arc of ring (an.x, an.z, g.R) between angles an.a0..an.a1 that lies inside the board. */
function pocketWall(c, an, g, kind, zone, parent) {
  const { R, gateA, wallA } = g;
  const cnn = 2 * wallA + rPassFor(gateA, wallA), e = 0.3 + 0.5 * wallA;
  const s0 = an.a0 + asinp(Math.min(1, e / R)), s1 = an.a1 - asinp(Math.min(1, e / R));
  const th = (s0 + s1) / 2, Phi = 2 * asinp(Math.min(1, cnn / (2 * R)));
  const dMax = 2 * asinp(Math.min(1, (1.16 * wallA) / (2 * R)));
  const gi = addItem(c, kind, an.x + R * cosp(th), an.z + R * sinp(th), { a: gateA, role: 'gate', zone: parent, rot: th + HPI, edgeOk: true });
  for (const [u0, u1] of [[s0, th - Phi / 2], [th + Phi / 2, s1]]) {
    const m = Math.max(1, Math.ceil((u1 - u0) / dMax - 1e-9));
    for (let j = 0; j <= m; j++) {
      const a = u0 + ((u1 - u0) * j) / m;
      addItem(c, kind, an.x + R * cosp(a), an.z + R * sinp(a), { a: wallA, role: 'wall', zone: parent, rot: a + HPI, edgeOk: true });
    }
  }
  c.rings.push({ x: an.x, z: an.z, R, zone, depth: 1, wallA });
  const zn = c.zones[zone]; zn.gate = gi; zn.r = r3(needR(gateA));
  const Ri = R - wallA - 0.3, mid = (an.a0 + an.a1) / 2;
  const cx = an.x + 0.55 * Ri * cosp(mid), cz = an.z + 0.55 * Ri * sinp(mid);
  zn.x = r3(cx); zn.z = r3(cz);
  // interior region: the quarter (corner) or half (edge) square inside the arc; zoneAt drops what lies outside it
  const rx = g.corner ? an.x + Math.sign(cosp(mid)) * Ri / 2 : an.x + Math.sign(cosp(mid)) * Ri / 2;
  const rz = g.corner ? an.z + Math.sign(sinp(mid)) * Ri / 2 : an.z;
  c.regions.push({ t: 'rect', x: rx, z: rz, w: Ri, d: g.corner ? Ri : 2 * Ri, zone, dens: 1.6, mask: [1, 1, 1, 1, 0] });
  return { x: an.x, z: an.z, R, gateA, wallA, gate: gi, zone, Ri, cx, cz, pocket: true };
}
/**
 * Gate plan for CG / MR: the gate radii (fracs(nw), in order) and how many of them stay full-width walls; the rest
 * become pockets (DECISION above). Pockets go to the far corners, then to side edges, inside the band beyond the last
 * full wall (zLast = that wall's z), clear of the bosses.
 */
function gatePlan(c, nw, kind, rIn) {
  const rGs = fracs(nw).map(f => gateR(c, f));
  const budget = (c.spec.margin[1] - POCKET_RESERVE) * needMassOf(c);
  let pick = null;
  for (let nFull = nw; nFull >= 1 && !pick; nFull--) {
    let cost = 0;
    const geo = [];
    for (let i = 0; i < nw; i++) {
      if (i < nFull) { cost += lineCost(c, rGs[i], kind); continue; }
      const g = pocketGeom(rGs[i], kind, i - nFull < 2, rIn) || pocketGeom(rGs[i], kind, false, rIn);
      geo.push(g); cost += g ? g.cost : 1e9;
    }
    if (cost <= budget || nFull === 1) pick = { rGs, nFull, geo, cost };
  }
  return pick;
}
/** Places the pocket gates of a plan beyond the wall at zLast (zone `parent`); returns the pockets placed. */
function placePockets(c, plan, kind, zLast, wallALast, parent) {
  const out = [];
  const bosses = c.bossPos.map(i => c.items[i]);
  const clearOf = (x, z, ext) => bosses.every(b => hyp(b.x - x, b.z - z) > ext + b.a + 0.5) &&
    out.every(p => hyp(p.x - x, p.z - z) > ext + p.R + p.wallA + 0.6);
  const zTop = zLast - wallALast - 0.6;
  for (let i = 0; i < plan.geo.length; i++) {
    let g = plan.geo[i];
    if (!g) continue;
    const zone = addZone(c, 0, 0, parent, 0.9);
    const cands = [];
    const ext = gg => gg.R + gg.wallA;
    if (g.corner) for (const an of [{ x: c.x0, z: c.z0, a0: 0, a1: HPI }, { x: c.x1, z: c.z0, a0: HPI, a1: PI }]) cands.push([an, g]);
    const ge = g.corner ? pocketGeom(plan.rGs[plan.nFull + i], kind, false, g.R - g.wallA - 0.3) : g;
    for (const sd of [-1, 1]) {
      const zc = Math.min(zTop - ext(ge), (zTop + c.z0) / 2);
      cands.push([{ x: sd < 0 ? c.x0 : c.x1, z: zc, a0: sd < 0 ? -HPI : HPI, a1: sd < 0 ? HPI : PI + HPI }, ge]);
    }
    let done = null;
    for (const [an, gg] of cands) {
      if (!gg) continue;
      const zMax = gg.corner ? an.z + ext(gg) : an.z + ext(gg), zMin = gg.corner ? an.z : an.z - ext(gg);
      if (zMax > zTop || zMin < c.z0 - 1e-6) continue;
      const cx = gg.corner ? an.x + Math.sign(cosp((an.a0 + an.a1) / 2)) * ext(gg) / 2 : an.x;
      const cz = gg.corner ? an.z + ext(gg) / 2 : an.z;
      if (!clearOf(cx, cz, ext(gg) * (gg.corner ? 0.75 : 1))) continue;
      done = pocketWall(c, an, gg, kind, zone, parent);
      break;
    }
    if (done) out.push(done);
    else { c.zones.pop(); }
  }
  return out;
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
  addSurf(c, 'blanket', c.spawn.x, c.spawn.z, 3.6, 3.6, col, { prio: true });
}
// DECISION (11-04): a scattered blanket never overlaps another surface (0.3 u gap); a candidate that would is redrawn.
function scatterBlankets(c, n, zLo, zHi, size, dens) {
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const w = rr(c, size * 0.8, size * 1.25), d = rr(c, size * 0.8, size * 1.25);
      const x = rr(c, c.x0 + w / 2, c.x1 - w / 2), z = rr(c, zLo, zHi);
      if (zoneAt(c, x, z) !== 0) continue;
      let ok = true;
      for (const g of c.rings) if (hyp(x - g.x, z - g.z) < g.R + g.wallA + Math.max(w, d) / 2) ok = false;
      if (!ok || surfHit(c, x, z, w, d, 0.3)) continue;
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
    // DECISION (11-04): belts and lane / truck segments count as obstacles too (L26's pen sat across a cross belt).
    let best = null, bs = -1e9;
    const zA = Math.min(zLo + ext, (zLo + zHi) / 2), zB = Math.max(zHi - ext, (zLo + zHi) / 2);
    for (let t = 0; t < 160; t++) {
      const x = rr(c, c.x0 + ext + 0.9, c.x1 - ext - 0.9), z = rr(c, zA, zB);
      let s = 99;
      for (const q of placed) s = Math.min(s, hyp(x - q.x, z - q.z) - (ext + q.ext) - 1.8);
      for (const b of c.bossPos) { const o = c.items[b]; s = Math.min(s, hyp(x - o.x, z - o.z) - (ext + o.a) - 1.8); }
      s = Math.min(s, hyp(x - c.spawn.x, z - c.spawn.z) - ext - 4);
      for (const b of c.belts) s = Math.min(s, beltDist(b, x, z) - ext - 0.6);
      for (const g of c.segs) s = Math.min(s, segDist(x, z, g) - g.w - ext - 0.6);
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
/** Distance from (x, z) to belt b's rectangle (w along travel, d across; rot 0 or ±π/2 as levels.js writes them). */
function beltDist(b, x, z) {
  const vert = Math.abs(Math.abs(b.rot) - HPI) < 0.1, hw = (vert ? b.d : b.w) / 2, hd = (vert ? b.w : b.d) / 2;
  return hyp(Math.max(Math.abs(x - b.x) - hw, 0), Math.max(Math.abs(z - b.z) - hd, 0));
}
function penFloors(c) {
  // a cloth floor under pen ingredient spots that need contrast is added by ingredient patches (ingPatches)
}
// DECISION (11-04, §4.2 placement): a gated archetype (CG, MR) whose recipe marks no pen line puts its last open line
// behind the first gate (the line keeps place 'open', so its count keeps the open-line spare rule).
function promoteLine(penL, openL) {
  if (penL.length) return;
  for (let j = openL.length - 1; j >= 0; j--) if (openL[j].place === 'open') { penL.push(openL.splice(j, 1)[0]); return; }
}
/** Does the rect (x, z, w, d) touch any ring wall's disc (pens, pockets)? */
function ringHit(c, x, z, w, d) {
  return c.rings.some(g => {
    const dx = Math.max(Math.abs(x - g.x) - w / 2, 0), dz = Math.max(Math.abs(z - g.z) - d / 2, 0);
    return dx * dx + dz * dz < (g.R + g.wallA + 0.2) ** 2;
  });
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
    const tR = Rb + wallA + 2.0;
    if (tw.truck) truck(c, 0, zc, tR);
    const road = Rb + wallA + 1.7, rw2 = 2.0;
    addSurf(c, 'path', -road, zc, rw2, 2 * road + rw2, null);
    addSurf(c, 'path', road, zc, rw2, 2 * road + rw2, null);
    addSurf(c, 'path', 0, zc - road, 2 * road + rw2, rw2, null);
    addSurf(c, 'path', 0, zc + road, 2 * road + rw2, rw2, null);
    for (const sf of c.surfaces) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: 0, dens: 1.1 });
    boardRegion(c, 0.6);
    c.progL = hyp(sp.x, sp.z - zc) + road * 0.8;
    // DECISION (11-04, §4.2 placement): the far spot sits at least 0.6·D + 1.6 from spawn (the road's far side when
    // that is farther), beyond the truck's far side on a truck level (the truck loop runs on the road); place-bound
    // lines (stack / belt / roll) keep their own geometry before the n ≥ 4 split, and a split line does not use up
    // the far slot, so the next open line takes it (L47 / L56 had no far or gated line).
    const fz = tw.truck ? zc - tR - fb - 1.6 : zc - road;
    const farZ = Math.max(c.z0 + 1.6, Math.min(fz, sp.z - 0.6 * c.D - 1.6));
    const pts = { far: [0, farZ], left: [-road, zc], right: [road, zc], near: [0, zc + road + 1.4] };
    const order = ['far', 'left', 'right'];
    const penLines = [];
    let k = 0;
    for (const L of linesOf(c)) {
      if (L.place === 'pen') { penLines.push(L); continue; }
      const key = L.spot || (k === 1 && linesOf(c).length > 1 && c.spec.n <= 3 ? 'near' : order[k % 3]);
      const n = countOf(c, L);
      if (L.place === 'stack') stackLine(c, L, [pts[key]]);
      else if (L.place === 'belt') beltLine(c, L, zc + road + 2.6);
      else if (L.place === 'roll') laneLine(c, L, 1);
      else if (n >= 4 && !L.spot && c.spec.n > 3) { splitSpots(c, L, [[...pts.left, 0.9], [...pts.right, 0.9], [0, zc - road, 0.9]], 0); continue; }
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
    promoteLine(penL, openL);
    const nw = Math.max(1, tw.walls || penL.length || 1);
    const bz = bossZ(c, c.bossFinal);
    placeBoss(c, c.nT - 1, 0, bz);
    c.progL = sp.z - bz;
    const wk = c.town === 'market' ? 'car' : WALL_KIND[c.town];
    // DECISION (11-04): the full-width walls are the plan's first nFull gates; the later gates are pockets.
    const plan = gatePlan(c, nw, wk, 2.4);
    const nf = plan.nFull;
    const zFar = bz + c.bossFinal + 2.6, zNear = sp.z - 6;
    const walls = [];
    let parent = 0;
    for (let i = 0; i < nf; i++) {
      const p = nf === 1 ? 0.55 : 0.38 + (0.3 * i) / (nf - 1);
      const zw = clamp(sp.z - p * (sp.z - bz), zFar, zNear);
      const zone = addZone(c, 0, zw - 2, parent, p);
      walls.push(lineWall(c, zw, rr(c, -c.W * 0.22, c.W * 0.22), plan.rGs[i], wk, zone, parent));
      parent = zone;
    }
    if (c.nT > 1) placeBoss(c, 0, c.x0 + c.spec.tickets[0].boss.a + 1.5, walls[0].z + 3.5);
    // the boss sits beyond the last wall
    c.items[c.bossPos[c.nT - 1]].zone = zoneAt(c, 0, bz);
    const lw = walls[walls.length - 1];
    const gates = walls.concat(placePockets(c, plan, wk, lw.z, lw.wallA, parent));
    const nw2 = walls.length;
    // centre path and band blankets
    addSurf(c, 'path', 0, (sp.z + bz) / 2, 2.6, sp.z - bz, null);
    boardRegion(c, 0.6);
    c.regions.push({ t: 'rect', x: 0, z: (sp.z + bz) / 2, w: 2.6, d: sp.z - bz, zone: 0, dens: 1.0 });
    for (let i = 0; i <= nw2; i++) {
      const zt = i === 0 ? sp.z - 2 : walls[i - 1].z - walls[i - 1].wallA - 0.6;
      const zb = i === nw2 ? bz + c.bossFinal + 1.0 : walls[i].z + walls[i].wallA + 0.6;
      if (zt - zb < 2.5) continue;
      const zone = zoneAt(c, 0, (zt + zb) / 2);
      for (const side of [-1, 1]) {
        const bw = c.W * 0.3, bd = Math.min(4.5, (zt - zb) * 0.7), bx = side * c.W * 0.27, bzc = (zt + zb) / 2;
        if (ringHit(c, bx, bzc, bw, bd)) continue;
        const sf = addSurf(c, 'blanket', bx, bzc, bw, bd, (i + (side > 0 ? 1 : 0)) % 2);
        if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone, dens: 1.2 });
      }
      if (i > 0) c.regions.push({ t: 'rect', x: 0, z: (zt + zb) / 2, w: c.W, d: zt - zb, zone, dens: 0.6 });
    }
    // pen lines go beyond gates in order (walls, then pockets); extra lines share the last gate
    penL.forEach((L, k) => {
      const gi = Math.min(gates.length - 1, k), g = gates[gi];
      if (g.pocket) { spot(c, L, g.cx, g.cz, Math.min(1.0, 0.3 * g.Ri), g.zone, countOf(c, L)); return; }
      const zEnd = gi + 1 < walls.length ? walls[gi + 1].z + walls[gi + 1].wallA + 1.2 : bz + c.bossFinal + 1.5;
      const z = (g.z - g.wallA - 1.0 + zEnd) / 2;
      spot(c, L, (k % 2 ? 1 : -1) * c.W * 0.25, z, 1.0, g.zone, countOf(c, L));
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
      let b = { type: 'blanket', col: i % 2 };
      if (L && KIND[L.kind].tier <= 1) b = bestSurfFor(c, KIND[L.kind]);
      const w = rr(c, 3.8, 5.0), d = rr(c, 3.6, 4.6);
      isl.push(addSurf(c, b.type, x, z, w, d, b.col));
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
    c.lanes.forEach((ln, li) => laneBed(c, li, null));
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

/** Non-nested pen (ring wall) at about (x, z) holding `lines`; the gate faces `face` (default the spawn). */
// DECISION (11-04): archetypes that know where a pen belongs (pier ends, spiral stops, kitchen corners) use penAt;
// the size rule is buildPens' (inner clear radius ≈ 1.25 + 0.12·load + 1.2·largest ingredient a), and the centre is
// pulled inside the board so the whole ring fits. DECISION (11-04 Wed): spec.wallKind overrides the town's wall kind
// (market Feast courses: crates, see FEAST_WALL).
function penAt(c, lines, x, z, frac, load, face) {
  const wallK = c.spec.wallKind || WALL_KIND[c.town];
  const rG = gateR(c, frac);
  const gateA = 0.97 * FIT * rG, wallA = Math.max(KIND[wallK].a, 1.25 * gateA);
  let maxA = 0.15;
  for (const L of lines) maxA = Math.max(maxA, KIND[L.kind].a);
  const R = clamp(1.25 + 0.12 * load + 1.2 * maxA + wallA, 1.8, 3.8);
  const ext = R + wallA + 0.4;
  x = clamp(x, c.x0 + ext, c.x1 - ext); z = clamp(z, c.z0 + ext, c.z1 - ext - 2);
  // DECISION (11-04, §4.2 spawn density): a pen keeps ext + 1.8 from spawn (pushed straight away from it), so its gate
  // never sits in the 1.2 u spawn sectors (L29's spiral-end pen put a car gate 1.8 u from spawn: 6/8 sectors).
  const sp = c.spawn, dS = hyp(x - sp.x, z - sp.z), dMin = ext + 1.8;
  if (dS < dMin) {
    const ux = dS > 1e-6 ? (x - sp.x) / dS : 0, uz = dS > 1e-6 ? (z - sp.z) / dS : -1;
    x = clamp(sp.x + ux * dMin, c.x0 + ext, c.x1 - ext); z = clamp(sp.z + uz * dMin, c.z0 + ext, c.z1 - ext - 2);
  }
  const f = face || c.spawn;
  const th = atan2p(f.z - z, f.x - x);
  const zone = addZone(c, x, z, 0, Math.min(0.95, frac + 0.1));
  const st = ringWall(c, x, z, R, rG, wallK, zone, 0, th, 1);
  st.ext = ext;
  const inner = R - wallA - 0.15;
  for (const L of lines) splitSpots(c, L, [[x, z, Math.max(0.5, inner * 0.6)]], zone);
  c.regions.push({ t: 'disc', x, z, r: Math.max(0.4, inner), zone, dens: lines.length ? 0.9 : 2.2, mask: [1, 1, 1, 0, 0] });
  return st;
}
/** A non-pen line at (x, z) by its place: stack, belt (across the board at z), roll (lanes) or an open spot. */
function putLine(c, L, x, z, r) {
  if (L.place === 'stack') stackLine(c, L, [[x, z]]);
  else if (L.place === 'belt') beltLine(c, L, z, c.belts.length % 2 ? -1.2 : 1.2);
  else if (L.place === 'roll') laneLine(c, L, Math.max(1, c.lanes.length));
  else spot(c, L, x, z, r || 1.0, 0, countOf(c, L));
}
/** Market-style stall blocks: rug strips at the row centres xs, split into blocks with cross alleys; returns alley z. */
function stallRows(c, xs, rw, zTop, zBot, avoid) {
  const alleys = [];
  const blk = 4.6, gap = 1.8;
  for (let z = zTop; z - blk > zBot - 0.01; z -= blk + gap) {
    const za = z - blk;
    if (avoid.some(w => z > w.z - w.wallA - 0.9 && za < w.z + w.wallA + 0.9)) continue;
    for (const x of xs) {
      if (Math.abs(x - c.spawn.x) < rw / 2 + 2.2 && z > c.spawn.z - 5.5) continue;
      if (ringHit(c, x, z - blk / 2, rw, blk)) continue;
      const sf = addSurf(c, 'rug', x, z - blk / 2, rw, blk, null);
      if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: zoneAt(c, sf.x, sf.z), dens: 2.4 });
    }
    alleys.push(za - gap / 2);
  }
  return alleys;
}
/** A belt with no line on it: geometry + bed now, its riders (junk of `tiers`, fitting fitR if set) after the palette. */
function junkBelt(c, x, z, len, vert, v, n, tiers, fitR) {
  const bi = c.belts.length, d = 1.4;
  // DECISION (11-04, Sim contract): a vertical belt runs along z with rot −π/2 (travel (cos rot, −sin rot) = +z,
  // toward the spawn edge); its bed is the axis-aligned d × len rectangle. Horizontal belts keep rot 0.
  c.belts.push({ x: r3(x), z: r3(z), w: r3(len), d, rot: vert ? -HPI : 0, v });
  if (vert) c.segs.push({ ax: x, az: z - len / 2, bx: x, bz: z + len / 2, w: d / 2 + 0.1 });
  else c.segs.push({ ax: x - len / 2, az: z, bx: x + len / 2, bz: z, w: d / 2 + 0.1 });
  const bed = addSurf(c, 'path', x, z, vert ? d : len, vert ? len : d, null, { prio: true });
  if (bed) bed.belt = bi;
  c.beltFill.push({ bi, n, tiers, fitR });
  return bi;
}
/** Riders for junk belts (after buildPalette): T-tier junk spread evenly along the belt, passing contrast. */
// DECISION (11-04): belt riders take role 'crumb' so the margin / food / gate passes never swap or move them (a
// swapped rider would lose its belt); they still count in the supply and the tier totals.
function fillBelts(c) {
  for (const f of c.beltFill) {
    const b = c.belts[f.bi], vert = b.rot !== 0;
    for (let j = 0; j < f.n; j++) {
      const u = -b.w / 2 + (b.w * (j + 0.5)) / f.n;
      const x = vert ? b.x : b.x + u, z = vert ? b.z + u : b.z;
      let ks = [];
      for (const t of f.tiers) for (const k of c.pal[t]) if ((!f.fitR || canFit(f.fitR, k.a)) && (k.tier > 1 || contrastOK(c, k, x, z))) ks.push(k);
      if (!ks.length) continue;
      const k = ks[ri(c, ks.length)];
      addItem(c, k.id, x, z, { role: 'crumb', belt: f.bi, zone: 0, edgeOk: true });
    }
  }
}
/** Spiral progress for PS: s in [0, 1] of the nearest spiral turn (elliptical coordinates around (0, zc)). */
function spiralS(sp, x, z) {
  const u = x / sp.ax, v = (z - sp.zc) / sp.az;
  const rho = hyp(u, v);
  if (rho <= sp.rIn) return 1;
  let d0 = sp.th0 - atan2p(v, u);
  d0 -= TAU * Math.floor(d0 / TAU);
  let best = 0, bd = 1e9;
  for (let k = 0; k < 3; k++) {
    const s = (d0 + k * TAU) / sp.Th;
    if (s > 1.0001) break;
    const e = Math.abs(1 - (1 - sp.rIn) * s - rho);
    if (e < bd) { bd = e; best = s; }
  }
  return clamp(best, 0, 1);
}
function spiralPt(sp, s) {
  const th = sp.th0 - s * sp.Th, rho = 1 - (1 - sp.rIn) * s;
  return [sp.ax * rho * cosp(th), sp.zc + sp.az * rho * sinp(th)];
}

// DECISION (11-04, §4.1 MR): Market Rows = 2–3 stall rows running spawn → boss (plum rug under dense stall junk) with
// slate path aisles between them and cross alleys every 6.4 u; the parked-car rows are the late gates (a car lineWall
// at p 0.70, or p 0.46 / 0.62 / 0.78 for three); open lines sit at alley ends by the board edge (before the first car
// row), pen lines in the band beyond their car row, as in CG.
ARCH_FN.MR = function MR(c) {
  const s = c.spec, sp = c.spawn, tw = s.twist || {};
  const lines = linesOf(c);
  const penL = lines.filter(L => L.place === 'pen'), openL = lines.filter(L => L.place !== 'pen');
  promoteLine(penL, openL);
  const nw = Math.max(1, tw.walls || penL.length || 1);
  const bz = bossZ(c, c.bossFinal);
  placeBoss(c, c.nT - 1, 0, bz);
  c.progL = sp.z - bz;
  // DECISION (11-04): car rows are the plan's first nFull gates (gatePlan); the later gates are car-park pockets.
  const wk = WALL_KIND[c.town];
  const plan = gatePlan(c, nw, wk, 2.4);
  const nf = plan.nFull;
  const zFar = bz + c.bossFinal + 2.6, zNear = sp.z - 7;
  const walls = [];
  let parent = 0;
  for (let i = 0; i < nf; i++) {
    const p = nf === 1 ? 0.6 : 0.46 + (0.26 * i) / (nf - 1);
    const zw = clamp(sp.z - p * (sp.z - bz), zFar, zNear);
    const zone = addZone(c, 0, zw - 2, parent, p);
    walls.push(lineWall(c, zw, rr(c, -c.W * 0.2, c.W * 0.2), plan.rGs[i], wk, zone, parent));
    parent = zone;
  }
  if (c.nT > 1) placeBoss(c, 0, c.x0 + s.tickets[0].boss.a + 1.5, walls[0].z + 3.5);
  c.items[c.bossPos[c.nT - 1]].zone = zoneAt(c, 0, bz);
  const lw = walls[walls.length - 1];
  const gates = walls.concat(placePockets(c, plan, wk, lw.z, lw.wallA, parent));
  const nw2 = walls.length;
  const nR = c.W >= 28 ? 3 : 2;
  const xs = (nR === 2 ? [-0.21, 0.21] : [-0.29, 0, 0.29]).map(f => f * c.W);
  const rw = c.W * (nR === 2 ? 0.15 : 0.12);
  const alleys = stallRows(c, xs, rw, sp.z - 3.4, bz + c.bossFinal + 1.4, walls);
  // aisles between the rows
  const ax = nR === 2 ? [0] : [-0.145 * c.W, 0.145 * c.W];
  for (const x of ax) addSurf(c, 'path', x, (sp.z - 2 + bz) / 2, 1.6, sp.z - 2 - bz, null);
  boardRegion(c, 0.45);
  for (let i = 1; i <= nw2; i++) {
    const zt = walls[i - 1].z - walls[i - 1].wallA - 0.6, zb = i === nw2 ? bz + c.bossFinal + 1.0 : walls[i].z + walls[i].wallA + 0.6;
    if (zt - zb > 1.5) c.regions.push({ t: 'rect', x: 0, z: (zt + zb) / 2, w: c.W, d: zt - zb, zone: zoneAt(c, 0, (zt + zb) / 2), dens: 0.7 });
  }
  penL.forEach((L, k) => {
    const gi = Math.min(gates.length - 1, k), g = gates[gi];
    if (g.pocket) { spot(c, L, g.cx, g.cz, Math.min(1.0, 0.3 * g.Ri), g.zone, countOf(c, L)); return; }
    const zEnd = gi + 1 < walls.length ? walls[gi + 1].z + walls[gi + 1].wallA + 1.2 : bz + c.bossFinal + 1.5;
    spot(c, L, (k % 2 ? 1 : -1) * c.W * 0.4, (g.z - g.wallA - 1.0 + zEnd) / 2, 1.0, g.zone, countOf(c, L));
  });
  const z0w = walls[0].z + walls[0].wallA + 1.4;
  const front = alleys.filter(z => z > z0w + 0.6 && z < sp.z - 4);
  openL.forEach((L, k) => {
    const n = openL.length;
    const want = sp.z - (0.28 + (0.4 * k) / Math.max(1, n - 1)) * (sp.z - z0w);
    let z = front.length ? front.reduce((p, q) => (Math.abs(q - want) < Math.abs(p - want) ? q : p)) : want;
    if (L.place === 'belt') z = want;
    putLine(c, L, (k % 2 ? 1 : -1) * c.W * 0.41, z, 1.0);
  });
};

// DECISION (11-04, §4.1 CK): Conveyor Kitchen = a feeder belt beside the spawn bringing fitting crumbs toward the pot
// (vertical, travel +z), then a cross belt per belt line at p 0.42 / 0.66 with alternating direction (a junk belt
// of T1–T2 takes the second slot when there is one belt line); dense T2+ counter junk flanks both ends of every
// cross belt, so the early pot crosses through the middle (the choke points). Pens via buildPens.
ARCH_FN.CK = function CK(c) {
  const s = c.spec, sp = c.spawn;
  const bz = bossZ(c, c.bossFinal);
  placeBoss(c, c.nT - 1, 0, bz);
  if (c.nT > 1) placeBoss(c, c.x1 - c.bossFinal - 1.4, (bz + sp.z) / 2);
  c.progL = sp.z - bz;
  const lines = linesOf(c);
  const beltL = lines.filter(L => L.place === 'belt'), penL = lines.filter(L => L.place === 'pen');
  const rest = lines.filter(L => L.place !== 'belt' && L.place !== 'pen');
  const side = ri(c, 2) ? 1 : -1;
  junkBelt(c, sp.x + side * 3.2, sp.z - 6.2, 9, true, 1.2, 6, [0], c.r0);
  const bzs = [0.42, 0.66].map(p => sp.z - p * (sp.z - bz));
  const bw = c.W * 0.6;
  for (let i = 0; i < 2; i++) {
    const v = i % 2 ? -1.2 : 1.2;
    if (beltL[i]) beltLine(c, beltL[i], bzs[i], v);
    else if (i === 1 || !beltL.length) junkBelt(c, 0, bzs[i], bw, false, v, 5, [1, 2], 0);
    for (const sd of [-1, 1]) c.regions.push({ t: 'rect', x: sd * (bw / 2 + (c.W / 2 - bw / 2) / 2), z: bzs[i], w: c.W / 2 - bw / 2 - 0.3, d: 2.6, zone: 0, dens: 3.2, mask: [0, 0, 1, 1, 1] });
  }
  for (let i = 2; i < beltL.length; i++) beltLine(c, beltL[i], sp.z - (0.54 + 0.1 * i) * (sp.z - bz), i % 2 ? -1.2 : 1.2);
  boardRegion(c, 0.55);
  scatterBlankets(c, 4, bz + 1, sp.z - 3, 2.4, 1.2);
  const ps = [0.28, 0.82, 0.55];
  rest.forEach((L, k) => putLine(c, L, (k % 2 ? 1 : -1) * c.W * 0.3, sp.z - ps[k % 3] * (sp.z - bz), 1.0));
  if (penL.length) buildPens(c, penL.map(L => ({ lines: [L], frac: 0.42, load: 3 })), bz + c.bossFinal + 0.5, sp.z - 0.5 * (sp.z - bz));
};

// DECISION (11-04, §4.1 PF): Pier Fingers = a deck boardwalk along the spawn edge (z1) and 3–4 deck piers reaching
// toward z0 over the sand, of lengths 1 / 0.8 / 0.62 / 0.48 of the board; the final boss stands on a deck platform at
// the end of the longest pier, ticket 1's boss (two-course) at the end of the second longest; pen lines get pens at
// pier ends, open lines the other pier ends (one-course) or the pier middles and boardwalk ends (ticket 1 of two),
// roll lines lanes down the piers toward the boardwalk, the gull roost (nest) is the shortest pier's end, and a
// truck boss drives the longest pier (parks at both ends). Junk is dense on deck, sparse on sand. No water areas:
// the pot walks everywhere, so sea would read as walkable water.
ARCH_FN.PF = function PF(c) {
  const s = c.spec, sp = c.spawn, tw = s.twist || {};
  const nP = c.W >= 30 ? 4 : 3, bwD = 4.2, pw = 3.0;
  const zS = c.z1 - bwD;
  addSurf(c, 'deck', 0, c.z1 - bwD / 2, c.W, bwD, null);
  c.regions.push({ t: 'rect', x: 0, z: c.z1 - bwD / 2, w: c.W, d: bwD, zone: 0, dens: 1.6 });
  const xs = [];
  for (let i = 0; i < nP; i++) xs.push(c.x0 + (c.W * (i + 0.5)) / nP);
  const rank = shuffled(c, xs.map((_, i) => i));
  const LEN = [1, 0.8, 0.62, 0.48];
  const full = zS - (c.z0 + 0.4);
  const piers = rank.map((pi, r) => ({ x: xs[pi], len: full * LEN[r], r, end: zS - full * LEN[r] }));
  const fb = c.bossFinal, P0 = piers[0];
  const bz = bossZ(c, fb);
  const plat = 2 * fb + 1.6;
  addSurf(c, 'deck', P0.x, bz, plat, plat, null);
  placeBoss(c, c.nT - 1, P0.x, bz);
  c.keeps.push({ x: P0.x, z: bz, r: fb + 1.6, maxA: 0.25 });
  c.progL = hyp(P0.x - sp.x, bz - sp.z);
  const two = c.nT > 1;
  if (two) {
    const P1 = piers[1], a0 = s.tickets[0].boss.a, z1 = P1.end + a0 + 0.9;
    addSurf(c, 'deck', P1.x, z1, 2 * a0 + 1.4, 2 * a0 + 1.4, null);
    placeBoss(c, 0, P1.x, z1);
  }
  for (const P of piers) {
    const sf = addSurf(c, 'deck', P.x, zS - P.len / 2, pw, P.len, null);
    if (sf) c.regions.push({ t: 'rect', x: sf.x, z: sf.z, w: sf.w, d: sf.d, zone: 0, dens: 2.4 });
  }
  boardRegion(c, 0.3);
  if (tw.truck) {
    c.truckPath = [{ x: r3(P0.x), z: r3(bz), stop: true }, { x: r3(P0.x), z: r3(zS - fb - 0.6), stop: true }];
    c.segs.push({ ax: P0.x, az: bz, bx: P0.x, bz: zS - fb - 0.6, w: fb });
  }
  const shortest = piers[piers.length - 1];
  if (tw.gulls) c.roost = { x: r3(shortest.x), z: r3(shortest.end + 0.9) };
  const lines = linesOf(c);
  if (lines.some(L => L.place === 'roll')) {
    for (const P of piers.slice(1, 1 + clamp(tw.lanes || 2, 1, nP - 1))) addLane(c, P.x, P.end + 0.6, P.x, zS + 1.2, 1.1);
  }
  const ends = piers.slice(two ? 2 : 1).map(P => [P.x, P.end + 1.4]);
  if (tw.gulls) { const k = ends.findIndex(e => e[0] === shortest.x); if (k >= 0) ends[k][1] += 1.6; }
  const near = [[P0.x, zS - P0.len * 0.45], [c.x0 + 2.2, zS + bwD / 2], [c.x1 - 2.2, zS + bwD / 2]];
  for (const P of piers.slice(1)) near.push([P.x, zS - P.len * 0.5]);
  const late = L => !two || L.ti === c.nT - 1;
  const penL = lines.filter(L => L.place === 'pen');
  for (const L of penL) {
    const e = (late(L) ? ends.shift() : near.shift()) || near.shift() || [0, 0];
    penAt(c, [L], e[0], e[1] - 1.2, 0.42, 3, { x: e[0], z: zS });
  }
  for (const L of lines) {
    if (L.place === 'pen') continue;
    const e = (late(L) ? ends.shift() || near.shift() : near.shift() || ends.shift()) || [0, (zS + c.z0) / 2];
    putLine(c, L, e[0], e[1], 1.0);
  }
};

// DECISION (11-04, §4.1 PS): Plaza Spiral = the final boss on a central plaza behind a ring of gate pieces (gate at
// r0 + 0.5·(needR − r0), as RR) facing the spiral's end; an elliptical spiral of 1.25 turns runs from the spawn
// inward to that gate, marked by path stepping stones every 3.4 u, and junk grows along it: progress for the tier
// windows is the spiral parameter s (c.progFn), and the regions along it allow T0–T2 on the first third, T0–T3 on
// the middle, T1–T4 on the last. Lines sit at spiral stops spread over s 0.16–0.8 in ticket order (pens pushed
// outward to the board edge); ticket 1's boss (two-course) sits just outside the spiral at s 0.5.
/** Supply (K_WALL·a²) of ringWall's pieces for a ring of centre-line radius R (same piece count rule). */
function ringCost(R, rG, kind) {
  const { gateA, wallA } = gateSize(rG, kind);
  const cnn = 2 * wallA + rPassFor(gateA, wallA);
  if (cnn > 1.8 * R) R = cnn / 1.8;
  const Phi = 2 * asinp(cnn / (2 * R)), dMax = 2 * asinp(Math.min(1, (1.16 * wallA) / (2 * R)));
  const m = Math.ceil((TAU - Phi) / dMax - 1e-9);
  return K_WALL * ((m + 1) * wallA * wallA + gateA * gateA);
}
// DECISION (11-04, §4.2 margin): the plaza ring's gate frac steps down from 0.5 (by 0.05, to 0.3) until the ring's
// pieces, its pens' pieces (pens share the plaza's gate size) and the front food the gate needs
// (gateM·(rG² − r0²)/G) fit inside (margin hi − 0.25)·needMass: market's 1.30 cars made L29's ring + pen 1.66 of a
// 1.6–2.0 band. A spec gateR override still wins. Returns the frac.
function plazaFrac(c, fb, kind, penA) {
  const g = c.spec.gateR;
  if (g && g[c.gi] != null) return 0.5;
  const nr = needR(c.bossFinal), need = (nr * nr - c.r0 * c.r0) / G, hi = c.spec.margin[1];
  let f = 0.5;
  for (; f > 0.3 + 1e-9; f -= 0.05) {
    const rG = c.r0 + f * (nr - c.r0), { wallA } = gateSize(rG, kind);
    let cost = ringCost(fb + wallA + 0.7, rG, kind) + (gateM(c) * (rG * rG - c.r0 * c.r0)) / G;
    for (const a of penA) cost += ringCost(clamp(1.25 + 0.36 + 1.2 * Math.max(0.15, a) + wallA, 1.8, 3.8), rG, kind);
    if (cost <= (hi - 0.25) * need) break;
  }
  return f;
}
ARCH_FN.PS = function PS(c) {
  const s = c.spec, sp = c.spawn;
  const fb = c.bossFinal;
  const pf = plazaFrac(c, fb, WALL_KIND[c.town], linesOf(c).filter(L => L.place === 'pen').map(L => KIND[L.kind].a));
  const rG = gateR(c, pf);
  const gateA = 0.97 * FIT * rG, wallA = Math.max(KIND[WALL_KIND[c.town]].a, 1.25 * gateA);
  const Rb = fb + wallA + 0.7;
  const zc = (sp.z + c.z0 + 1.4) / 2;
  const S = { ax: c.W / 2 - 1.6, az: sp.z - zc, zc, th0: HPI, Th: 2.5 * PI, rIn: 0 };
  S.rIn = clamp((Rb + wallA + 1.3) / Math.min(S.ax, S.az), 0.3, 0.75);
  const zone = addZone(c, 0, zc, 0, 0.75);
  placeBoss(c, c.nT - 1, 0, zc);
  c.items[c.bossPos[c.nT - 1]].zone = zone;
  const thEnd = S.th0 - S.Th;
  ringWall(c, 0, zc, Rb, rG, WALL_KIND[c.town], zone, 0, atan2p(S.az * sinp(thEnd), S.ax * cosp(thEnd)), 1);
  c.progFn = (x, z) => spiralS(S, x, z);
  c.progL = hyp(sp.x, sp.z - zc) + Rb;
  addSurf(c, 'path', 0, zc, 1.5 * (Rb - wallA), 1.5 * (Rb - wallA), null);
  // stepping stones along the spiral
  let acc = 0, [px, pz] = spiralPt(S, 0);
  for (let i = 1; i <= 240; i++) {
    const [x, z] = spiralPt(S, i / 240);
    acc += hyp(x - px, z - pz); px = x; pz = z;
    if (acc < 3.4) continue;
    acc = 0;
    if (hyp(x - sp.x, z - sp.z) < 3.2 || surfHit(c, x, z, 1.7, 1.7, 0.15)) continue;
    addSurf(c, 'path', x, z, 1.7, 1.7, null);
  }
  boardRegion(c, 0.5);
  for (let k = 0; k < 12; k++) {
    const t = (k + 0.5) / 12, [x, z] = spiralPt(S, t);
    c.regions.push({ t: 'disc', x, z, r: 2.3, zone: 0, dens: 2.2, mask: t < 0.34 ? [1, 1, 1, 0, 0] : t < 0.67 ? [1, 1, 1, 1, 0] : [0, 1, 1, 1, 1] });
  }
  const outward = (t, d) => { const [x, z] = spiralPt(S, t); const u = x / S.ax, v = (z - zc) / S.az, n = hyp(u, v) || 1; return [x + (u / n) * d, z + (v / n) * d]; };
  if (c.nT > 1) { const a0 = s.tickets[0].boss.a, [x, z] = outward(0.5, a0 + 1.2); placeBoss(c, 0, clamp(x, c.x0 + a0 + 0.6, c.x1 - a0 - 0.6), clamp(z, c.z0 + a0 + 0.6, c.z1 - a0 - 0.6)); }
  const lines = linesOf(c);
  const ts = lines.map((L, k) => (lines.length < 2 ? 0.45 : 0.16 + (0.64 * k) / (lines.length - 1)));
  // DECISION (11-04, §4.2 placement): with no pen / stack / belt / roll line, the slot nearest the spiral's far apex
  // moves onto the farthest spiral stop from spawn (s 0.16–0.8), which lies ≥ 0.6·D away; slots stay in ticket order.
  const farD = t => { const [x, z] = spiralPt(S, t); return hyp(x - sp.x, z - sp.z); };
  if (s.n >= 4 && !lines.some(L => L.place && L.place !== 'open') && !ts.some(t => farD(t) >= 0.6 * c.D + 1.6)) {
    let tf = 0.16;
    for (let t = 0.16; t <= 0.8 + 1e-9; t += 0.02) if (farD(t) > farD(tf)) tf = t;
    let j = 0;
    for (let q = 1; q < ts.length; q++) if (Math.abs(ts[q] - tf) < Math.abs(ts[j] - tf)) j = q;
    ts[j] = clamp(tf, j > 0 ? ts[j - 1] + 0.05 : 0, j + 1 < ts.length ? ts[j + 1] - 0.05 : 1);
  }
  lines.forEach((L, k) => {
    const t = ts[k];
    if (L.place === 'pen') { const [x, z] = outward(t, 3.2); penAt(c, [L], x, z, Math.min(pf, t), 3); return; }
    const [x, z] = spiralPt(S, t);
    putLine(c, L, x, z, 1.0);
  });
};

// DECISION (11-04, §3.12 Feast, D23): the Feast course map (arch FE) is an open board with the Blanket Path's cloth;
// ticket k's lines sit around progress 0.2 + 0.19·k on alternating sides (pens via penAt, rollers on two cross lanes,
// belt lines a cross belt there), and ticket 4's mini boss stands open at the far end. Tickets 1–3 have no boss.
ARCH_FN.FE = function FE(c) {
  const sp = c.spawn;
  const bz = bossZ(c, c.bossFinal);
  placeBoss(c, c.nT - 1, 0, bz);
  c.progL = sp.z - bz;
  const ging = !!SURF[c.town].gingham;
  const rw = (ging ? 0.3 : 0.4) * c.W, tile = 3.2, td = ging ? 2.4 : tile;
  const n = Math.max(1, Math.ceil((sp.z + 1.6 - bz) / tile));
  for (let i = 0; i < n; i++) addSurf(c, 'blanket', 0, sp.z + 1.6 - tile * (i + 0.5), rw, td, i % 2);
  boardRegion(c, 0.6);
  c.regions.push({ t: 'rect', x: 0, z: (sp.z + bz) / 2, w: rw, d: sp.z - bz, zone: 0, dens: 1.3 });
  scatterBlankets(c, ging ? 2 : 4, bz, sp.z - 2, ging ? 2.0 : 2.4, 1.2);
  const lines = linesOf(c);
  if (lines.some(L => L.place === 'roll')) {
    const z1 = sp.z - 0.5 * (sp.z - bz), z2 = sp.z - 0.74 * (sp.z - bz);
    addLane(c, c.x0 + 0.8, z1, c.x1 - 0.8, z1, 1.1);
    addLane(c, c.x1 - 0.8, z2, c.x0 + 0.8, z2, 1.3);
  }
  lines.forEach((L, k) => {
    const p = 0.2 + 0.19 * L.ti + 0.06 * L.li;
    const x = (k % 2 ? 1 : -1) * c.W * 0.27, z = sp.z - p * (sp.z - bz);
    if (L.place === 'pen') penAt(c, [L], x * 1.25, z, Math.min(0.5, p), 3);
    else putLine(c, L, x, z, 1.0);
  });
};

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
    if (m > 0) laneBed(c, li, k);
  });
}
/** The strip under lane li (1.2 u wide): a priority surface tagged s.lane. With a T0/T1 roller kind k it is styled
 *  so k passes the contrast rule anywhere along the lane. */
// DECISION (11-04, contrast §4.2): every lane has a bed (Tuesday's default lane had none, so orange/apple rollers
// failed contrast on Market ground / Picnic gingham); the bed prefers the town path and switches to the best
// contrasting cloth when the roller fails on it.
function laneBed(c, li, k) {
  const ln = c.lanes[li];
  const b = k && k.tier <= 1 ? bestSurfFor(c, k, 'path') : { type: 'path' };
  const bed = c.surfaces.find(s => s.lane === li);
  if (bed) { if (k && k.tier <= 1 && Math.abs(bed.lum - k.lum) < CONTRAST_MIN) restyle(c, bed, b); return; }
  const horiz = Math.abs(ln.bx - ln.ax) >= Math.abs(ln.bz - ln.az);
  const w = horiz ? Math.abs(ln.bx - ln.ax) + 1.2 : 1.2, d = horiz ? 1.2 : Math.abs(ln.bz - ln.az) + 1.2;
  const s = addSurf(c, b.type, (ln.ax + ln.bx) / 2, (ln.az + ln.bz) / 2, w, d, b.col, { prio: true });
  if (s) s.lane = li;
}
function beltLine(c, L, z, v = 1.2) {
  const w = c.W * 0.6, d = 1.4;
  const bi = c.belts.length;
  c.belts.push({ x: 0, z: r3(z), w: r3(w), d, rot: 0, v });
  c.segs.push({ ax: -w / 2, az: z, bx: w / 2, bz: z, w: d / 2 + 0.1 });
  // DECISION (11-04, contrast §4.2): the belt bed is a priority surface styled for the belt kind (path when it passes).
  const b = bestSurfFor(c, KIND[L.kind], 'path');
  const bed = addSurf(c, b.type, 0, z, w, d, b.col, { prio: true });
  if (bed) bed.belt = bi;
  const n = countOf(c, L);
  for (let j = 0; j < n; j++) addItem(c, L.kind, -w / 2 + w * ((j + 0.5) / n), z, { role: 'ing', belt: bi, zone: 0, line: L });
}
function stackLine(c, L, pts) {
  const n = Math.max(L.need + 1, countOf(c, L));
  for (let j = 0; j < n; j++) {
    const sks = STACK_KIND[c.town], sk = sks[(c.nStack || 0) % sks.length];
    c.nStack = (c.nStack || 0) + 1;
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
  for (const t of tk) { if (t.boss) req.add(t.boss.kind); for (const l of t.lines) { recipe.add(l.kind); req.add(l.kind); } }
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
  bridgeGaps(pal, byT);
  c.pal = pal;
}
// DECISION (11-04, no cliffs §4.4): the junk palette is a growth ladder. Walking its sizes upward, a step bigger
// than LADDER_GAP× (L2 11-04: pinwheel 0.26 / sandwich 0.28 then bench 0.90, so the pot stalled at r 0.94 of the
// 1.44 the hamper needs) is bridged: the tier above the gap swaps its largest pick for the largest unused kind of
// its own tier that sits inside the step (else the tier below the gap swaps its smallest pick for one); a tier
// keeps its pick count. Ladders without a gap are untouched (same layout, same rng draws).
const LADDER_GAP = 1.8;
function bridgeGaps(pal, byT) {
  for (let pass = 0; pass < 8; pass++) {
    const rungs = [];
    for (let t = 0; t < 5; t++) for (const k of pal[t]) rungs.push({ t, k });
    rungs.sort((p, q) => p.k.a - q.k.a);
    let gap = -1;
    for (let i = 0; i + 1 < rungs.length; i++) if (rungs[i + 1].k.a > LADDER_GAP * rungs[i].k.a + 1e-9) { gap = i; break; }
    if (gap < 0) return;
    const lo = rungs[gap].k.a, hi = rungs[gap + 1].k.a;
    const inStep = t => byT[t].filter(k => !pal[t].includes(k) && k.a > lo + 1e-9 && k.a < hi - 1e-9 && k.a <= LADDER_GAP * lo + 1e-9);
    let done = false;
    for (const t of [rungs[gap + 1].t, rungs[gap].t]) {
      const opts = inStep(t);
      if (!opts.length || !pal[t].length) continue;
      const pick = opts.reduce((p, q) => (q.a > p.a ? q : p));
      // the tier above drops its largest pick; the tier below drops its smallest (the ladder keeps both ends)
      const mine = pal[t].slice().sort((p, q) => p.a - q.a);
      const drop = t === rungs[gap + 1].t && mine.length > 1 ? mine[mine.length - 1] : mine[0];
      if (t === rungs[gap].t && mine.length < 2) continue;
      pal[t][pal[t].indexOf(drop)] = pick;
      done = true;
      break;
    }
    if (!done) return;
  }
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
// DECISION (11-04): a patch is a priority surface: it splits the blanket/path it lands on instead of overlapping it.
function ingPatches(c) {
  for (const s of c.spots) {
    const k = KIND[s.L.kind];
    if (k.tier > 1 || contrastOK(c, k, s.x, s.z)) continue;
    const b = bestSurfFor(c, k);
    const sz = 2 * s.r + 1.2;
    const sf = addSurf(c, b.type, s.x, s.z, sz, sz, b.col, { prio: true, anchor: [s.x, s.z] });
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
      // DECISION (11-04): a down-swap is undone only when it deepens a gate's front shortfall (fixGates); the old
      // "any gate short → undo" froze the margin of levels whose fronts were already short (L4 3.87 vs 2.7–3.0).
      const d0 = gateDeficit(c);
      c.items[i] = Object.assign({}, o, { kind: k.id, ki: KIND_ID[k.id], a: k.a, h: k.h, k: k.k, tier: k.tier, flags: k.fragile ? F.FRAGILE : 0 });
      if (gateDeficit(c) > d0 + 1e-9) c.items[i] = o;
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
// DECISION (11-04): wall and gate pieces of an EARLIER gate count in a later gate's front at K_WALL (they fit before
// it and are edible on the way, §4.2 counts them); a gate's own walls never fit before it (wall.a ≥ 1.25·gate.a).
function frontSupply(c, rG) {
  let s = 0;
  for (const o of c.items) {
    if (o.role === 'boss' || o.a > FIT * rG + 1e-9 || reachR(c, o.zone) >= rG - 1e-9) continue;
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
function gateDeficit(c) {
  let d = 0;
  for (const zn of c.zones) if (zn.id > 0 && zn.r > c.r0) d += Math.max(0, (gateM(c) * (zn.r * zn.r - c.r0 * c.r0)) / G - frontSupply(c, zn.r));
  return d;
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
// DECISION (11-06 Fri, L2 starter patch): L2–L10 (spec.starter) open with a dense bite-sized patch in the first portrait
// screen, and one item of the leading order line in that screen (critics: L2 stood still for 12 s with nothing to eat, the
// first order item sat 7–19 u off). Existing zone-0 T0/T1 junk moves into the patch from the far board and one ingredient
// moves next to it, so supply, margin, counts and every kind stay as they were. Items move in place: bossPos and other
// indices hold, and nothing here touches c.rng, so decor and the rest of the level keep their draws. A pen line cannot
// lead (pulling a pen's apple out would undo the pen): the first line with an open item leads the order on the card.
const SCREEN_HX = 2.3, SCREEN_HZ = 5, PATCH_R = 1.6, PATCH_N = 14, SLOT = 0.5;
/** Hex grid of slots inside radius rad of (x, z), centre first. */
function hexSlots(x, z, rad, step) {
  const out = [];
  const nz = Math.ceil(rad / (step * 0.866));
  for (let j = -nz; j <= nz; j++) for (let i = -nz - 1; i <= nz + 1; i++) {
    const px = (i + (j & 1 ? 0.5 : 0)) * step, pz = j * step * 0.866, d = hyp(px, pz);
    if (d <= rad) out.push({ x: x + px, z: z + pz, d });
  }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
}
/** canPlace for an item already on the board: it must not block itself, so it parks off-board while asked. */
function canMove(c, o, x, z) {
  const ox = o.x, oz = o.z;
  o.x = 1e6; o.z = 1e6;
  const ok = canPlace(c, x, z, o.a, o.tier, { zone: 0 }) && contrastOK(c, KIND[o.kind], x, z);
  o.x = ox; o.z = oz;
  return ok;
}
function starterPatch(c) {
  const sp = c.spawn, biteA = FIT * c.r0;
  const free = (x, z) => canPlace(c, x, z, 0.24, 1, { zone: 0 });
  let best = null, bs = -1;
  for (const d of [3.4, 3, 3.8, 2.6]) for (const dx of [0, 0.7, -0.7]) {
    const x = sp.x + dx, z = sp.z - d;
    const n = hexSlots(x, z, PATCH_R, SLOT).filter(q => free(q.x, q.z)).length;
    if (n > bs) { bs = n; best = { x, z }; }
  }
  const bite = o => o.role !== 'wall' && o.role !== 'gate' && o.role !== 'boss' && o.lane < 0 && o.belt < 0 && canFit(c.r0, o.a);
  const inPatch = o => bite(o) && hyp(o.x - best.x, o.z - best.z) <= PATCH_R;
  // the leading line's item goes first, so it takes the patch's best slot
  const lines = c.spec.tickets[0].lines;
  const openOf = l => c.items.filter(o => o.kind === l.kind && o.role === 'ing' && o.zone === 0 && o.lane < 0 && o.belt < 0 && !o.stack);
  const inView = (o) => Math.abs(o.x - sp.x) <= SCREEN_HX && Math.abs(o.z - sp.z) <= SCREEN_HZ;
  let li = lines.findIndex(l => l.place === 'roll' || openOf(l).length);
  if (li < 0) li = 0;
  c.leadLine = li;
  const L = lines[li];
  if (L.place !== 'roll' && !c.items.some(o => o.kind === L.kind && inView(o))) {
    const os = openOf(L).sort((a, b) => hyp(a.x - sp.x, a.z - sp.z) - hyp(b.x - sp.x, b.z - sp.z));
    const slots = hexSlots(best.x, best.z, 4, 0.25).filter(q => Math.abs(q.x - sp.x) <= SCREEN_HX - 0.3 && Math.abs(q.z - sp.z) <= SCREEN_HZ - 0.3);
    if (os.length) for (const q of slots) if (canMove(c, os[0], q.x, q.z)) { os[0].x = r3(q.x); os[0].z = r3(q.z); break; }
  }
  // far junk moves in, biggest bites first (T1 feeds a real step of growth), spread over the far board
  const pool = c.items.filter(o => o.role === 'junk' && o.tier <= 1 && o.zone === 0 && bite(o) && !o.stack && hyp(o.x - sp.x, o.z - sp.z) > SCREEN_HZ + 1.5)
    .sort((a, b) => b.a - a.a || hyp(b.x - sp.x, b.z - sp.z) - hyp(a.x - sp.x, a.z - sp.z));
  let have = c.items.filter(inPatch).length;
  for (const q of hexSlots(best.x, best.z, PATCH_R, SLOT)) {
    if (have >= PATCH_N) break;
    const i = pool.findIndex(o => canMove(c, o, q.x, q.z));
    if (i < 0) continue;
    const o = pool.splice(i, 1)[0];
    o.x = r3(q.x); o.z = r3(q.z);
    have++;
  }
  c.piles.push({ x: r3(best.x), z: r3(best.z), r: PATCH_R });
}
// DECISION (11-06 Fri, L3 snack piles): L21–L60 get 5 to 12 tight piles of T0/T1 food on top of the tuned layout (critics:
// wide boards with sparse food from L30 on), one of them in view of spawn. A post-pass with its own rng: it appends items
// after everything else, so a level keeps every item and draw it had, and Daily and Feast (n 0) never get here. A pile uses
// only T0/T1 food kinds the level already has, so the kind cap holds and the ingredient counts do not move.
const PILE_FROM = 21, PILE_R = 0.95, PILE_STEP = 0.4, PILE_MIN = 6;
function snackPiles(c, spec, seed) {
  const pc = Object.create(c);
  pc.rng = mulberry32((seed ^ 0x51ac4b1e) >>> 0);
  const ids = [...new Set(c.items.filter(o => o.role === 'junk' && o.tier <= 1 && KIND[o.kind].food).map(o => o.kind))].sort();
  if (!ids.length) return;
  const want = Math.round(5 + (7 * (spec.n - PILE_FROM)) / (LEVELS - PILE_FROM));
  const sp = c.spawn, slotsAt = (x, z) => hexSlots(x, z, PILE_R, PILE_STEP);
  const open = (x, z, zone) => slotsAt(x, z).filter(q => canPlace(c, q.x, q.z, 0.2, 1, { zone })).length;
  const fill = (x, z, zone, n) => {
    const kinds = [ids[ri(pc, ids.length)], ids[ri(pc, ids.length)], ids[ri(pc, ids.length)]];
    let done = 0;
    for (const q of slotsAt(x, z)) {
      if (done >= n || c.items.length >= ITEM_MAX) break;
      for (let j = 0; j < 3; j++) {
        const k = KIND[kinds[(done + j) % 3]];
        if (!canPlace(c, q.x, q.z, k.a, k.tier, { zone }) || !contrastOK(c, k, q.x, q.z)) continue;
        addItem(pc, k.id, q.x, q.z, { zone }); done++;
        break;
      }
    }
    if (done < PILE_MIN) { c.items.length -= done; return false; }
    c.piles.push({ x: r3(x), z: r3(z), r: r3(PILE_R + 0.15) });
    return true;
  };
  // the pile in view of spawn: the first screen is ±2.3 by ±5 u
  let best = null, bs = 0;
  for (const d of [3.2, 2.8, 3.6, 2.4]) for (const dx of [0, 0.8, -0.8, 1.2, -1.2]) {
    const x = sp.x + dx, z = sp.z - d, zone = zoneAt(c, x, z), n = open(x, z, zone);
    if (n > bs) { bs = n; best = { x, z, zone }; }
  }
  if (best) fill(best.x, best.z, best.zone, 10);
  // DECISION (11-06 Fri, L3 snack piles): busy starts (L26, L32, L36, L45, L53, L55, L59, L60 on the first run) have no room
  // straight ahead, so the first pile takes the roomiest spot anywhere on the first screen. A level that placed one above skips this.
  if (!c.piles.length) {
    const spots = [];
    for (let dz = -4; dz <= 4; dz += 0.5) for (let dx = -1.25; dx <= 1.25; dx += 0.25) {
      if (hyp(dx, dz) < 1.8) continue;
      const x = sp.x + dx, z = sp.z + dz, zone = zoneAt(c, x, z);
      spots.push({ x, z, zone, n: open(x, z, zone), d: hyp(dx, dz) });
    }
    spots.sort((a, b) => b.n - a.n || a.d - b.d);
    for (const q of spots) if (q.n < PILE_MIN || fill(q.x, q.z, q.zone, 10)) break;
  }
  for (let tr = 0; tr < want * 60 && c.piles.length < want && c.items.length < ITEM_MAX - PILE_MIN; tr++) {
    const g = pickRegion(pc, 1), [x, z] = sampleIn(pc, g), zone = g.zone;
    if (zone > 0 && tr < want * 30) continue;
    if (hyp(x - sp.x, z - sp.z) < 6 || c.piles.some(p => hyp(x - p.x, z - p.z) < 5)) continue;
    if (open(x, z, zone) < 12) continue;
    fill(x, z, zone, 8 + ri(pc, 3));
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
  // DECISION (11-04): an archetype's own roost (PF: the shortest pier's end) wins over the far-corner default.
  if (tw.gulls) { c.gullEvery = tw.gulls.every || 16; c.gulls = tw.gulls.n || 1; c.roost = c.roost || { x: r3(c.x1 - 1.5), z: r3(c.z0 + 1.5) }; }
  if (tw.cake) c.cake = { tiers: tw.cake.slice() };
  if (tw.truck && !c.truckPath.length) truck(c, 0, 0, Math.min(c.W, c.D) * 0.28);
  settleSpots(c);
  ingPatches(c);
  buildPalette(c);
  // spawn keep-outs: non-fitting T2 ≥ 2 u, T3+ ≥ 4 u (§4.2 spacing from spawn)
  c.keeps.push({ x: c.spawn.x, z: c.spawn.z, r: 2.0, maxA: FIT * c.r0 }, { x: c.spawn.x, z: c.spawn.z, r: 4.0, maxA: 0.5 });
  placeSpots(c);
  spawnRing(c);
  fillBelts(c);
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
  c.piles = [];
  if (spec.starter) starterPatch(c);
  addDecor(c);
  if (spec.n >= PILE_FROM) snackPiles(c, spec, seed);
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
  if (c.leadLine > 0) tickets[0].lines.unshift(tickets[0].lines.splice(c.leadLine, 1)[0]);
  const tw = spec.twist || {};
  return {
    n: spec.n, name: spec.name, town: spec.town, arch: spec.arch, W: c.W, D: c.D, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1,
    spawn: { x: mx(c.spawn.x), z: c.spawn.z }, r0: spec.r0, T: spec.T, timed: spec.timed !== false, cap: tw.cap || R_MAX,
    items,
    surfaces: c.surfaces.map(s => ({ type: s.type, x: mx(s.x), z: s.z, w: s.w, d: s.d, rot: 0, color: s.color })),
    decor: c.decor.map(d => ({ kind: d.kind, x: mx(d.x), z: d.z, rot: mr(d.rot), s: d.s })),
    lanes: c.lanes.map(l => ({ ax: mx(l.ax), az: l.az, bx: mx(l.bx), bz: l.bz, v: l.v })),
    // DECISION (11-04): mirroring flips a horizontal belt's v; a vertical belt (rot −π/2, travel +z) is unchanged.
    belts: c.belts.map(b => ({ x: mx(b.x), z: b.z, w: b.w, d: b.d, rot: b.rot || 0, v: mir && !b.rot ? -b.v : b.v })),
    roost: c.roost ? { x: mx(c.roost.x), z: c.roost.z } : null, gullEvery: c.gullEvery, gulls: c.gulls,
    truckPath: c.truckPath.map(p => ({ x: mx(p.x), z: p.z, stop: p.stop })), cake: c.cake,
    tickets, zones, seed: seed >>> 0,
    // Only levels that have them carry these two, so a Daily or Feast level's expansion stays byte for byte the same.
    ...(spec.grace > 0 ? { grace: spec.grace } : null),
    ...(c.piles.length ? { piles: c.piles.map(p => ({ x: mx(p.x), z: p.z, r: p.r })) } : null),
  };
}
