// Slurp Pot sim (GDD §2.2–§3, §4.5, §13.3). Sim role.
// Pure and deterministic: imports only consts.js; no randomness source, no clock, no DOM, no renderer.
// step() uses only + − × ÷ sqrt floor ceil (no exp/log/pow); fixed dt = DT.
//
// DECISION (createWorld): w.kind[i] = the item's catalog number `ki` (KIND_ID, from the expanded level) when
// given; items without `ki` (hand-built test levels) and ticket kinds no item has get free local ids. logic
// may import nothing but consts.js, so w.kindNames[id] maps any id back to the string kind id.
// DECISION: three extra fields beside the §13.3 shape: w.kindNames (above), w.hid (Uint8Array, 1 = a
// roller in its 0.6 s respawn gap: draw nothing, not swallowable, not solid) and w._ (private sim state;
// nobody else reads it). Tickets carry three extra fields: lines[].kid (local kind id), open (padlock
// popped, one-way) and bossKind (string id of the boss item).
import {
  DT, R0, R_MAX, SIZEUP_MUL, G, K_ING, BLOCK_K, TIP_T, CHAIN_WIN, SIZZLE_AT, SIZZLE_EVERY, SIZZLE_CAP,
  STAR3, STAR2, V_BASE, V_PER_R, V_CAP, A_ACC, A_BRAKE, BUMP_V, BUMP_CD, DOOM_EVERY, DOOM_GRACE, LOW_TIME,
  CRACK_V, WOBBLE_V, WOBBLE_D, SIMMER, MAGNET, FREEZE_ADD, MEGA, ITEM_MAX,
} from './consts.js';

// ------------------------------------------------------------------ the fit rule (§3.2; the only definition)
export const FIT = 0.9;
export const canFit = (rimR, a) => a <= FIT * rimR + 1e-9;
export const needR = a => a / FIT;
export const speedOf = r => { const v = V_BASE + V_PER_R * r; return v < V_CAP ? v : V_CAP; };
export const VIEW_R = r => 1.4 * (3.6 + 7.2 * r);
export const SEE_R = r => 0.6 * (3.6 + 7.2 * r);

/** HUD meter position of radius r, log scale, clamped 0..1 (§9.3). Not used by step. */
export function meterX(r, r0, rMaxShown) {
  if (!(r > 0) || !(r0 > 0) || !(rMaxShown > r0)) return 0;
  const x = (Math.log(r) - Math.log(r0)) / (Math.log(rMaxShown) - Math.log(r0));
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Item flag bits: same values as catalog.js F (§13.3 order ING SOLID ROLL FRAGILE GATE BOSS STACK BELT, + WALL).
export const FLAG = Object.freeze({ ING: 1, SOLID: 2, ROLL: 4, FRAGILE: 8, GATE: 16, BOSS: 32, STACK: 64, BELT: 128, WALL: 256 });
export const F = FLAG;
const F_SOLID = 2, F_ROLL = 4, F_FRAGILE = 8, F_BOSS = 32, F_BELT = 128;

const GRID = 2;            // spatial hash cell (u), §3.4
const ROLL_GAP = 0.6;      // roller respawn gap at B (s), §4.5
const WOBBLE_CD = 0.6;     // near-wobble repeat (s)

/** Footprint tier (§4.3): 0..4, 5 = boss. */
export function tierOf(a, boss) {
  if (boss) return 5;
  return a < 0.12 ? 0 : a < 0.25 ? 1 : a < 0.5 ? 2 : a < 1.1 ? 3 : 4;
}

// ------------------------------------------------------------------ createWorld
export function createWorld(level, { mode = 'level', boosters = {}, recordPath = null } = {}) {
  const L = level || {};
  const items = L.items || [];
  const n = items.length < ITEM_MAX ? items.length : ITEM_MAX;
  const T = L.T > 0 ? +L.T : 0;
  const timed = L.timed !== false && T > 0;
  const r0 = L.r0 > 0 ? +L.r0 : R0;
  let cap = L.cap > 0 ? +L.cap : R_MAX;
  if (cap > R_MAX) cap = R_MAX;
  if (cap < r0) cap = r0;
  const x0 = num(L.x0, -(L.W || 16) / 2), x1 = num(L.x1, (L.W || 16) / 2);
  const z0 = num(L.z0, -(L.D || 18) / 2), z1 = num(L.z1, (L.D || 18) / 2);
  const sp = L.spawn || { x: (x0 + x1) / 2, z: z1 - 3 };

  // SIZE UP radii r0 × 1.25^k by repeated multiplication (§3.3); [0] = r0.
  const sizeUpR = [r0];
  for (let s = r0 * SIZEUP_MUL; s <= cap + 1e-9; s *= SIZEUP_MUL) sizeUpR.push(s);

  const kindNames = [], kindIdx = new Map();
  for (let i = 0; i < Math.min(items.length, ITEM_MAX); i++) {
    const ki = items[i].ki, key = String(items[i].kind);
    if (typeof ki === 'number' && ki >= 0 && ki < 256 && !kindIdx.has(key)) { kindIdx.set(key, ki); kindNames[ki] = key; }
  }
  let nextId = 0;
  const kid = name => {
    const key = String(name);
    let id = kindIdx.get(key);
    if (id === undefined) {
      while (kindNames[nextId] !== undefined) nextId++;
      id = nextId; kindNames[id] = key; kindIdx.set(key, id);
    }
    return id;
  };

  const f32 = () => new Float32Array(ITEM_MAX);
  const ix = f32(), iz = f32(), ia = f32(), ih = f32(), ik = f32(), ipx = f32(), ipz = f32(), tp = f32(), glow = f32();
  const kind = new Uint8Array(ITEM_MAX), st = new Uint8Array(ITEM_MAX), fits = new Uint8Array(ITEM_MAX), hid = new Uint8Array(ITEM_MAX);
  const flags = new Uint16Array(ITEM_MAX);
  // DECISION: w.ia is Float32 (render); the fit rule and growth use exact doubles in w._.a, so an item made
  // exactly FIT·r fits (0.27 at r 0.30) despite float32 rounding.
  const A = new Float64Array(ITEM_MAX);
  const lanes = (L.lanes || []).map(l => ({ ax: +l.ax, az: +l.az, bx: +l.bx, bz: +l.bz, v: +l.v || 1 }));
  const belts = (L.belts || []).map(b => ({ x: +b.x, z: +b.z, w: +b.w, d: +b.d, rot: +b.rot || 0, v: +b.v || 1.2 }));

  const mover = new Uint8Array(ITEM_MAX);          // 1 roller, 2 belt item
  const rollLane = new Int16Array(ITEM_MAX).fill(-1), rollPhase = new Float32Array(ITEM_MAX);
  const beltOf = new Int16Array(ITEM_MAX).fill(-1);
  const stackK = new Array(ITEM_MAX).fill(null);    // fragile stack contents (local kind ids)
  const rolls = [], belted = [], fragile = [];

  for (let i = 0; i < n; i++) {
    const it = items[i];
    ix[i] = +it.x || 0; iz[i] = +it.z || 0; A[i] = +it.a || 0.1; ia[i] = A[i]; ih[i] = +it.h || 0.2;
    ik[i] = it.k != null ? +it.k : 1;
    kind[i] = kid(it.kind);
    flags[i] = (it.flags | 0) & ~F_SOLID;
    if (flags[i] & F_ROLL && typeof it.lane === 'number' && it.lane >= 0) {
      const ln = typeof it.lane === 'number' ? lanes[it.lane] : null;
      if (ln) {
        rollLane[i] = it.lane; mover[i] = 1; rolls.push(i);
        const dx = ln.bx - ln.ax, dz = ln.bz - ln.az, len2 = dx * dx + dz * dz || 1, len = Math.sqrt(len2);
        let u = typeof it.lu === 'number' ? it.lu / len : ((ix[i] - ln.ax) * dx + (iz[i] - ln.az) * dz) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        rollPhase[i] = u * len / ln.v;           // lu = distance from A at level time 0 (levels.js)
      }
    }
    if (flags[i] & F_BELT && typeof it.belt === 'number' && belts[it.belt]) { beltOf[i] = it.belt; mover[i] = 2; belted.push(i); }
    if (flags[i] & F_FRAGILE) {
      fragile.push(i);
      if (Array.isArray(it.stack) && it.stack.length) stackK[i] = it.stack.map(kid);
    }
  }

  // Tickets: boss given as an item index, or {i|index|item}, or found as the k-th BOSS item (§13.3).
  const bossItems = [];
  for (let i = 0; i < n; i++) if (flags[i] & F_BOSS || /^boss/.test(String(items[i].kind))) bossItems.push(i);
  const bossT = new Int16Array(ITEM_MAX).fill(-1);
  const tickets = (L.tickets || []).map((tk, k) => {
    let b = -1;
    const B = tk.boss;
    if (typeof B === 'number') b = B;
    else if (typeof tk.bossI === 'number') b = tk.bossI;
    else if (typeof tk.bossIndex === 'number') b = tk.bossIndex;
    else if (B && typeof B === 'object') b = typeof B.i === 'number' ? B.i : typeof B.index === 'number' ? B.index : typeof B.item === 'number' ? B.item : -1;
    if (!(b >= 0 && b < n)) {
      b = -1;
      const want = B && B.kind ? String(B.kind) : null;
      for (const j of bossItems) if (bossT[j] < 0 && (!want || String(items[j].kind) === want)) { b = j; break; }
    }
    if (b >= 0) { flags[b] |= F_BOSS; ik[b] = 0; bossT[b] = k; }
    return {
      lines: (tk.lines || []).map(l => ({ kind: String(l.kind), kid: kid(l.kind), need: l.need | 0, got: 0 })),
      done: false, boss: b, open: false, bossKind: b >= 0 ? String(items[b].kind) : null,
    };
  });

  // DECISION: a ticket with no unmet lines (boss-only course) starts done, with no ticketDone event.
  for (const tk of tickets) if (tk.lines.every(l => l.need <= 0)) tk.done = true;

  // Spatial hash over the board (cell 2 u).
  const cols = Math.max(1, Math.ceil((x1 - x0) / GRID)), rows = Math.max(1, Math.ceil((z1 - z0) / GRID));
  const grid = { x0, z0, cols, rows, start: new Int32Array(cols * rows + 1), cur: new Int32Array(cols * rows), items: new Int16Array(1024), dirty: true };

  const w = {
    t: 0, tStart: null, T, tLeft: T, timed, mode, level: L,
    pot: { x: +sp.x, z: +sp.z, vx: 0, vz: 0, r: r0, mass: 0, r0, cap, rEff: r0, megaT: 0, magnetT: 0, step: 0, boilT: 0,
      px: +sp.x, pz: +sp.z, pr: r0, sizeUpR },
    n, ix, iz, ia, ih, ik, ipx, ipz, kind, st, tp, flags, fits, glow,
    tickets, ti: 0,
    chain: { n: 0, last: -9, best: 0 }, sizzle: 0,
    lanes, belts, gulls: [], nest: { x: L.roost ? +L.roost.x : 0, z: L.roost ? +L.roost.z : 0, slots: [] },
    truck: { seg: 0, u: 0, wait: 0 }, cake: { tier: 0 },
    boost: { magnet: false, freeze: false, mega: false }, freezeAdded: 0,
    result: null, stars: 0,
    stats: { bites: 0, bumps: 0, bossNudges: 0, sizzles: 0, steals: 0, cracks: 0, boils: 0 },
    events: [],
    kindNames, hid,
    _: {
      a: A, x0, x1, z0, z1, simmer: cap < R_MAX - 1e-9, avail: Object.assign({}, boosters), recordPath,
      sx: f32(), sz: f32(), lineRef: new Int16Array(256).fill(-1), bossT,
      mover, rolls, rollLane, rollPhase, belted, beltOf, fragile, stackK, stackLost: new Uint8Array(ITEM_MAX),
      wobCd: f32(), contact: new Uint8Array(ITEM_MAX), shoveLeft: f32(),
      grid, mark: new Uint32Array(ITEM_MAX), stamp: 0, cand: new Int16Array(ITEM_MAX),
      kcnt: new Int16Array(256), kneed: new Int16Array(256),
      bumpCd: 0, doomNext: DOOM_EVERY, doomAt: -1, finalBite: false, biteT: -1, biteTLeft: 0, cardFreeze: false,
      lowSent: false, lastTick: 99, sizzleCap: SIZZLE_CAP * T, onBelt: -1,
      beltDir: belts.map(b => [Math.sin(b.rot), Math.cos(b.rot)]),
    },
  };
  for (let i = 0; i < n; i++) { ipx[i] = ix[i]; ipz[i] = iz[i]; }
  updateLineRef(w);
  placeRollers(w);
  for (let i = 0; i < n; i++) fits[i] = canFit(r0, A[i]) ? 1 : 0;
  return w;
}

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

// lineRef[kid] = (ticket << 3) | line of the first open line (current ticket first) that still needs that kind.
// DECISION: an ingredient of a later ticket's line eaten early is banked into that line (two-course, L28+),
// so eating it never spoils the level.
function updateLineRef(w) {
  const ref = w._.lineRef, T = w.tickets;
  ref.fill(-1);
  for (let k = T.length - 1; k >= w.ti; k--) {
    const ls = T[k].lines;
    for (let li = ls.length - 1; li >= 0; li--) if (ls[li].got < ls[li].need) ref[ls[li].kid] = (k << 3) | li;
  }
}

// ------------------------------------------------------------------ read helpers (bots, UI)
/** Index of the current ticket's boss item, or -1. */
export function curBoss(w) { const tk = w.tickets[w.ti]; return tk ? tk.boss : -1; }
/** >= 0 when eating item i would count toward an open recipe line. */
export function lineOf(w, i) { return w._.lineRef[w.kind[i]]; }
/** Simmer refusal: junk that would push r above the cap (§4.5). Ingredients are always eaten. */
export function refused(w, i) {
  const _ = w._;
  if (!_.simmer || w.flags[i] & F_BOSS || _.lineRef[w.kind[i]] >= 0) return false;
  const P = w.pot, a = w._.a[i];
  return P.r0 * P.r0 + G * (P.mass + w.ik[i] * a * a) > P.cap * P.cap + 1e-9;
}
/** Solid now (blocks the pot): non-fitting items (vs rEff; boss vs r), locked bosses, big refused junk. */
export function isSolid(w, i) {
  if (w.flags[i] & F_BOSS) return !bossOpen(w, i);
  const a = w._.a[i];
  if (!canFit(w.pot.rEff, a)) return true;
  return refused(w, i) && a >= SIMMER.shoveA * w.pot.r;
}
/** Swallowable now if close enough (ignores distance). */
export function edible(w, i) {
  const s = w.st[i];
  if ((s !== 0 && s !== 3) || w.hid[i]) return false;
  if (w.flags[i] & F_BOSS) return bossOpen(w, i);
  return canFit(w.pot.rEff, w._.a[i]) && !refused(w, i);
}
/** Mass a swallow of i would add (k·a², with K_ING for a counted ingredient). */
export function growthOf(w, i) {
  if (w.flags[i] & F_BOSS) return 0;
  const a = w._.a[i];
  return (w._.lineRef[w.kind[i]] >= 0 ? K_ING : w.ik[i]) * a * a;
}
/** Marks the spatial hash stale (feast.js after reusing a slot). */
export function touch(w) { w._.grid.dirty = true; }

// DECISION: the current boss opens only when the padlock pops (step 13, after ticketDone and the size check),
// so a swallow can never come before its padlock event; bossState reads the same flag.
function bossOpen(w, i) {
  const k = w._.bossT[i];
  if (k < 0 || k < w.ti) return true;
  if (k > w.ti) return false;
  return w.tickets[k].open;
}

export function bossState(w, i) {
  const k = w._.bossT[i];
  if (k < 0 || k < w.ti) return 'open';
  if (k > w.ti) return 'recipe';
  const tk = w.tickets[k];
  return tk.open ? 'open' : tk.done ? 'size' : 'recipe';
}

// ------------------------------------------------------------------ spatial hash
function gridBuild(w) {
  const _ = w._, g = _.grid, n = w.n, st = w.st, ix = w.ix, iz = w.iz, ia = _.a, mover = _.mover;
  const cols = g.cols, rows = g.rows, start = g.start, cells = cols * rows;
  start.fill(0);
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      for (let c = 1; c <= cells; c++) start[c] += start[c - 1];
      if (g.items.length < start[cells]) g.items = new Int16Array(start[cells] * 2);
      g.cur.set(start.subarray(0, cells));
    }
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if ((s !== 0 && s !== 3) || mover[i]) continue;
      const a = ia[i];
      let cx0 = Math.floor((ix[i] - a - g.x0) / GRID), cx1 = Math.floor((ix[i] + a - g.x0) / GRID);
      let cz0 = Math.floor((iz[i] - a - g.z0) / GRID), cz1 = Math.floor((iz[i] + a - g.z0) / GRID);
      if (cx0 < 0) cx0 = 0; if (cz0 < 0) cz0 = 0; if (cx1 >= cols) cx1 = cols - 1; if (cz1 >= rows) cz1 = rows - 1;
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        if (pass === 0) start[cz * cols + cx + 1]++;
        else g.items[g.cur[cz * cols + cx]++] = i;
      }
    }
  }
  g.dirty = false;
}

// Candidates near (x, z) within rad (bbox), deduped; movers appended. Returns the count in _.cand.
function gridQuery(w, x, z, rad) {
  const _ = w._, g = _.grid, out = _.cand, mark = _.mark, start = g.start, its = g.items, cols = g.cols, rows = g.rows;
  const stamp = ++_.stamp;
  let cnt = 0;
  let cx0 = Math.floor((x - rad - g.x0) / GRID), cx1 = Math.floor((x + rad - g.x0) / GRID);
  let cz0 = Math.floor((z - rad - g.z0) / GRID), cz1 = Math.floor((z + rad - g.z0) / GRID);
  if (cx0 < 0) cx0 = 0; if (cz0 < 0) cz0 = 0; if (cx1 >= cols) cx1 = cols - 1; if (cz1 >= rows) cz1 = rows - 1;
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    const c = cz * cols + cx;
    for (let k = start[c], e = start[c + 1]; k < e; k++) {
      const i = its[k];
      if (mark[i] !== stamp) { mark[i] = stamp; out[cnt++] = i; }
    }
  }
  const R = _.rolls; for (let k = 0; k < R.length; k++) out[cnt++] = R[k];
  const B = _.belted; for (let k = 0; k < B.length; k++) out[cnt++] = B[k];
  return cnt;
}

// ------------------------------------------------------------------ movers
function placeRollers(w) {
  const _ = w._, R = _.rolls;
  for (let k = 0; k < R.length; k++) {
    const i = R[k];
    if (w.st[i] !== 0) continue;
    const ln = w.lanes[_.rollLane[i]];
    const dx = ln.bx - ln.ax, dz = ln.bz - ln.az, len = Math.sqrt(dx * dx + dz * dz) || 1;
    const travel = len / ln.v, period = travel + ROLL_GAP;
    let s = _.rollPhase[i] + w.t;
    s -= Math.floor(s / period) * period;
    if (s < travel) {
      const u = s / travel;
      w.ix[i] = ln.ax + dx * u; w.iz[i] = ln.az + dz * u; w.hid[i] = 0;
    } else { w.ix[i] = ln.ax; w.iz[i] = ln.az; w.hid[i] = 1; }
  }
}

// DECISION: belt travel direction is local +z of the belt rectangle rotated by rot about y, i.e.
// (sin rot, cos rot) in world x/z (three.js rotation.y convention); `d` is the length along travel.
function moveBelts(w, dt) {
  const _ = w._, B = _.belted;
  for (let k = 0; k < B.length; k++) {
    const i = B[k];
    if (w.st[i] !== 0) continue;
    const b = w.belts[_.beltOf[i]], dir = _.beltDir[_.beltOf[i]];
    let x = w.ix[i] + dir[0] * b.v * dt, z = w.iz[i] + dir[1] * b.v * dt;
    const lz = (x - b.x) * dir[0] + (z - b.z) * dir[1];
    if (lz > b.d / 2) { x -= dir[0] * b.d; z -= dir[1] * b.d; }
    else if (lz < -b.d / 2) { x += dir[0] * b.d; z += dir[1] * b.d; }
    w.ix[i] = x; w.iz[i] = z;
  }
}

function beltAt(w, x, z) {
  const bs = w.belts, D = w._.beltDir;
  for (let k = 0; k < bs.length; k++) {
    const b = bs[k], dx = x - b.x, dz = z - b.z;
    const along = dx * D[k][0] + dz * D[k][1], across = dx * D[k][1] - dz * D[k][0];
    if (along <= b.d / 2 && along >= -b.d / 2 && across <= b.w / 2 && across >= -b.w / 2) return k;
  }
  return -1;
}

// ------------------------------------------------------------------ step (§13.3 order)
export function step(w, inp, dt) {
  const P = w.pot, _ = w._, n = w.n, st = w.st, ix = w.ix, iz = w.iz, ia = _.a, fl = w.flags, ev = w.events;
  // 0 previous-step copies (render interpolation)
  P.px = P.x; P.pz = P.z; P.pr = P.r;
  w.ipx.set(ix); w.ipz.set(iz);
  // 1
  if (w.result) return;
  w.t += dt;
  const t = w.t;
  // 2 timer
  const m0 = inp ? +inp.m || 0 : 0;
  if (w.tStart === null && m0 > 0) { w.tStart = t - dt; ev.push({ type: 'start' }); }
  if (w.timed && w.tStart !== null && !_.finalBite) w.tLeft -= dt;
  // 3 booster timers
  if (P.megaT > 0) { P.megaT -= dt; if (P.megaT < 0) P.megaT = 0; }
  if (P.magnetT > 0) { P.magnetT -= dt; if (P.magnetT < 0) P.magnetT = 0; }
  if (P.boilT > 0) { P.boilT -= dt; if (P.boilT < 0) P.boilT = 0; }
  if (_.bumpCd > 0) _.bumpCd -= dt;
  P.rEff = P.megaT > 0 ? P.r * MEGA.mul : P.r;
  // 4 movement (§2.2) + belt velocity
  {
    let m = m0 < 0 ? 0 : m0 > 1 ? 1 : m0;
    const dx = inp ? +inp.x || 0 : 0, dz = inp ? +inp.z || 0 : 0, l2 = dx * dx + dz * dz;
    let tx = 0, tz = 0;
    if (m > 0 && l2 > 1e-12) {
      const s = m * speedOf(P.r) * (P.boilT > 0 ? SIMMER.boilV : 1) / Math.sqrt(l2);
      tx = dx * s; tz = dz * s;
    }
    const A = tx * tx + tz * tz < P.vx * P.vx + P.vz * P.vz ? A_BRAKE : A_ACC;
    P.vx += (tx - P.vx) * A; P.vz += (tz - P.vz) * A;
    let bvx = 0, bvz = 0;
    if (w.belts.length) {
      const b = beltAt(w, P.x, P.z);
      if (b !== _.onBelt) { _.onBelt = b; ev.push({ type: 'belt', on: b >= 0 }); }
      if (b >= 0) { bvx = _.beltDir[b][0] * w.belts[b].v; bvz = _.beltDir[b][1] * w.belts[b].v; }
    }
    P.x += (P.vx + bvx) * dt; P.z += (P.vz + bvz) * dt;
  }
  // 5 block resolve (2 passes over the hash) + bump / bossNudge
  if (_.grid.dirty) gridBuild(w);
  {
    const half = BLOCK_K * P.r;
    const nc = gridQuery(w, P.x, P.z, half + 0.25);
    const cand = _.cand;
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < nc; c++) {
        const i = cand[c];
        if (st[i] !== 0 || w.hid[i] || !isSolid(w, i)) continue;
        const minD = ia[i] + half;
        let dx = P.x - ix[i], dz = P.z - iz[i];
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        let nx = 0, nz = 1;
        if (d2 > 1e-12) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; }
        P.x = ix[i] + nx * minD; P.z = iz[i] + nz * minD;
        const vn = P.vx * nx + P.vz * nz;
        if (vn < 0) {
          P.vx -= vn * nx; P.vz -= vn * nz;
          contact(w, i, -vn);
        }
      }
    }
  }
  // 6 bounds clamp
  {
    const h = 0.5 * P.r;
    const lo = _.x0 + h, hi = _.x1 - h, lz = _.z0 + h, hz = _.z1 - h;
    if (P.x < lo) { P.x = lo; if (P.vx < 0) P.vx = 0; } else if (P.x > hi) { P.x = hi; if (P.vx > 0) P.vx = 0; }
    if (P.z < lz) { P.z = lz; if (P.vz < 0) P.vz = 0; } else if (P.z > hz) { P.z = hz; if (P.vz > 0) P.vz = 0; }
  }
  // 7 movers: rollers (deterministic from level time), belt items. (Truck L47, gulls L41: not built yet.)
  if (_.rolls.length) placeRollers(w);
  if (_.belted.length) moveBelts(w, dt);
  // 8 fragile near-wobble (contact wobble/crack is judged in contact())
  if (_.fragile.length) {
    const F = _.fragile, sp = P.vx * P.vx + P.vz * P.vz;
    for (let k = 0; k < F.length; k++) {
      const i = F[k];
      if (_.wobCd[i] > 0) _.wobCd[i] -= dt;
      if (st[i] !== 0 || canFit(P.rEff, ia[i]) || _.wobCd[i] > 0 || sp < WOBBLE_V * WOBBLE_V) continue;
      const dx = ix[i] - P.x, dz = iz[i] - P.z, d = Math.sqrt(dx * dx + dz * dz) || 1e-6;
      if (d - ia[i] - P.r < WOBBLE_D && (P.vx * dx + P.vz * dz) / d > WOBBLE_V) {
        _.wobCd[i] = WOBBLE_CD; ev.push({ type: 'wobble', i });
      }
    }
  }
  // 9 magnet pull (fitting items within 2.5·r slide toward the pot at 3 u/s; bosses excluded)
  if (P.magnetT > 0) {
    const R = MAGNET.range * P.r, R2 = R * R, mv = MAGNET.v * dt;
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if ((s !== 0 && s !== 3) || !w.fits[i] || fl[i] & F_BOSS || _.mover[i]) continue;
      const dx = P.x - ix[i], dz = P.z - iz[i], d2 = dx * dx + dz * dz;
      if (d2 >= R2 || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), s2 = d < mv ? 1 : mv / d;
      ix[i] += dx * s2; iz[i] += dz * s2; _.grid.dirty = true;
    }
  }
  // 10 fits for every alive item (+ SOLID bit and ingredient glow for render)
  {
    const r = P.r, lim = FIT * r + 1e-9, ref = _.lineRef, kd = w.kind, fits = w.fits, glow = w.glow, ti = w.ti;
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if (s !== 0 && s !== 3) { fits[i] = 0; glow[i] = 0; continue; }
      const f = ia[i] <= lim ? 1 : 0;
      fits[i] = f;
      const solid = isSolid(w, i);
      fl[i] = solid ? fl[i] | F_SOLID : fl[i] & ~F_SOLID;
      const rf = ref[kd[i]];
      glow[i] = fl[i] & F_BOSS ? (solid ? 0 : 1) : rf >= 0 && rf >> 3 === ti ? 1 : 0;
    }
  }
  // 11 swallow starts (growth, ingredients, chain, sizzle, sizeUp, Simmer refusal/shove/boil)
  if (w.chain.n > 0 && t - w.chain.last > CHAIN_WIN + 1e-9) {
    if (w.chain.n > w.chain.best) w.chain.best = w.chain.n;
    ev.push({ type: 'chainEnd', n: w.chain.n }); w.chain.n = 0;
  }
  for (let i = 0; i < n; i++) {
    const s = st[i];
    if ((s !== 0 && s !== 3) || w.hid[i]) continue;
    const a = ia[i], dx = ix[i] - P.x, dz = iz[i] - P.z, d2 = dx * dx + dz * dz;
    const re = P.rEff;
    if (d2 >= re * re) {
      if (_.contact[i] && d2 > (re + a) * (re + a)) _.contact[i] = 0;
      continue;
    }
    if (fl[i] & F_BOSS) {
      const lim = P.r - 0.25 * a;
      if (lim <= 0 || d2 >= lim * lim || !bossOpen(w, i)) continue;
      swallow(w, i, true);
      continue;
    }
    if (!canFit(re, a)) continue;
    const lim = re - 0.25 * a;
    if (lim <= 0 || d2 >= lim * lim) continue;
    if (refused(w, i)) { if (a < SIMMER.shoveA * P.r) shove(w, i, dx, dz, d2, lim); continue; }
    swallow(w, i, false);
  }
  // 12 tip progress → despawn
  let bossDone = -1;
  {
    const inc = dt / TIP_T, sx = _.sx, sz = _.sz, tp = w.tp;
    for (let i = 0; i < n; i++) {
      if (st[i] !== 1) continue;
      let p = tp[i] + inc;
      if (p >= 1) { p = 1; st[i] = 2; if (fl[i] & F_BOSS) bossDone = i; }
      tp[i] = p;
      const e = p * p;
      ix[i] = sx[i] + (P.x - sx[i]) * e; iz[i] = sz[i] + (P.z - sz[i]) * e;
    }
  }
  // 13 ticket / boss state → padlock
  const tk = w.tickets[w.ti];
  if (tk) {
    if (!tk.done) {
      let all = true;
      for (let li = 0; li < tk.lines.length; li++) if (tk.lines[li].got < tk.lines[li].need) { all = false; break; }
      if (all) { tk.done = true; ev.push({ type: 'ticketDone', ti: w.ti }); }
    }
    if (tk.done && !tk.open && tk.boss >= 0 && canFit(P.r, ia[tk.boss])) { tk.open = true; ev.push({ type: 'padlock', i: tk.boss }); }
    // DECISION: a ticket without a boss item is served the moment its lines are done (same win/courseDone path).
    if (tk.done && tk.boss < 0 && bossDone < 0) {
      if (w.ti >= w.tickets.length - 1) {
        _.finalBite = true; _.biteT = t; _.biteTLeft = w.timed ? w.tLeft : 0; w.stars = starsFor(w);
        if (w.chain.n > w.chain.best) w.chain.best = w.chain.n;
        w.result = 'win';
        ev.push({ type: 'win', stars: w.stars, tLeft: _.biteTLeft, chainBest: w.chain.best });
        return;
      }
      ev.push({ type: 'courseDone', ti: w.ti });
      w.ti++; updateLineRef(w);
    }
  }
  // 14 boss tip complete → win or next course
  if (bossDone >= 0) {
    const k = _.bossT[bossDone];
    if (k >= w.tickets.length - 1) {
      if (w.chain.n > w.chain.best) w.chain.best = w.chain.n;
      w.result = 'win';
      if (!w.stars) w.stars = starsFor(w);
      ev.push({ type: 'win', stars: w.stars, tLeft: _.biteTLeft, chainBest: w.chain.best });
      return;
    }
    ev.push({ type: 'courseDone', ti: w.ti });
    w.ti = k + 1;
    updateLineRef(w);
  }
  if (!w.timed || _.finalBite) return;     // L1 / untimed: unfailable; nothing can fail after the final bite
  // 15 spoiled (doom check every 0.25 s, 0.6 s grace) and time-out
  if (t >= _.doomNext - 1e-9) {
    _.doomNext += DOOM_EVERY;
    if (doomed(w)) { if (_.doomAt < 0) _.doomAt = t; } else _.doomAt = -1;
  }
  if (_.doomAt >= 0 && t - _.doomAt >= DOOM_GRACE - 1e-9) { fail(w, 'spoiled'); return; }
  if (w.tStart !== null && w.tLeft <= 0) { fail(w, 'timeout'); return; }
  // 16 lowTime / tick
  if (w.tStart !== null) {
    if (w.tLeft <= LOW_TIME) { if (!_.lowSent) { _.lowSent = true; ev.push({ type: 'lowTime' }); } } else _.lowSent = false;
    const s = Math.ceil(w.tLeft);
    if (s <= 5) { if (s >= 1 && s < _.lastTick) ev.push({ type: 'tick', s }); _.lastTick = s; } else _.lastTick = 99;
  }
}

// A block contact with approach speed v: bump / bossNudge / fragile wobble or crack / Simmer refuse.
function contact(w, i, v) {
  const _ = w._, ev = w.events, fl = w.flags[i];
  if (fl & F_FRAGILE && _.stackK[i] && !_.stackLost[i]) {
    if (v > CRACK_V) {
      _.stackLost[i] = 1; w.stats.cracks++; ev.push({ type: 'crack', i });
      updateLineRef(w);
    } else if (v > WOBBLE_V && _.wobCd[i] <= 0) { _.wobCd[i] = WOBBLE_CD; ev.push({ type: 'wobble', i }); }
  }
  if (v <= BUMP_V || _.bumpCd > 0) return;
  _.bumpCd = BUMP_CD;
  w.stats.bumps++;
  ev.push({ type: 'bump', i, v });
  if (fl & F_BOSS) {
    w.stats.bossNudges++;
    ev.push({ type: 'bossNudge', i, why: bossState(w, i) === 'recipe' ? 'recipe' : 'size' });
  } else if (_.simmer && canFit(w.pot.rEff, w._.a[i]) && refused(w, i)) ev.push({ type: 'refuse', i });
}

// Simmer: refused small junk slides away along the contact normal (≤ 0.8 u per contact); pot boils 0.3 s.
function shove(w, i, dx, dz, d2, lim) {
  const _ = w._, P = w.pot, ev = w.events;
  if (!_.contact[i]) {
    _.contact[i] = 1; _.shoveLeft[i] = SIMMER.shoveMax;
    P.boilT = SIMMER.boilT; w.stats.boils++;
    ev.push({ type: 'refuse', i }); ev.push({ type: 'shove', i }); ev.push({ type: 'boil' });
  }
  if (_.shoveLeft[i] <= 0) return;
  let nx = 0, nz = -1;
  const d = Math.sqrt(d2);
  if (d > 1e-6) { nx = dx / d; nz = dz / d; }
  let push = lim + 0.01 - d;
  if (push > _.shoveLeft[i]) push = _.shoveLeft[i];
  if (push <= 0) return;
  _.shoveLeft[i] -= push;
  const a = w._.a[i];
  let x = w.ix[i] + nx * push, z = w.iz[i] + nz * push;
  if (x < _.x0 + a) x = _.x0 + a; else if (x > _.x1 - a) x = _.x1 - a;
  if (z < _.z0 + a) z = _.z0 + a; else if (z > _.z1 - a) z = _.z1 - a;
  w.ix[i] = x; w.iz[i] = z; _.grid.dirty = true;
}

// Swallow start (§3.4): st = 1, growth credited now, ingredients, chain, sizzle, sizeUp.
function swallow(w, i, boss) {
  const _ = w._, P = w.pot, ev = w.events, t = w.t;
  w.st[i] = 1; w.tp[i] = 0; _.sx[i] = w.ix[i]; _.sz[i] = w.iz[i];
  w.fits[i] = 0; w.glow[i] = 0;
  w.stats.bites++;
  // chain
  const C = w.chain;
  C.n = C.n > 0 && t - C.last <= CHAIN_WIN + 1e-9 ? C.n + 1 : 1;
  C.last = t;
  if (C.n > C.best) C.best = C.n;
  if (boss) {
    const k = _.bossT[i], final = k >= w.tickets.length - 1;
    if (final) {
      _.finalBite = true; _.biteT = t; _.biteTLeft = w.timed ? w.tLeft : 0;
      w.stars = starsFor(w);
    }
    ev.push({ type: 'bite', i, kind: w.kindNames[w.kind[i]], tier: 5, n: C.n, ing: false });
    ev.push({ type: 'bossBite', i, final });
    chainBeats(w);
    return;
  }
  // ingredient lines (this item, then a fragile stack's contents)
  let ing = false, k = w.ik[i];
  const lines = [];
  const ref = _.lineRef[w.kind[i]];
  if (ref >= 0) { ing = true; k = K_ING; credit(w, ref, lines); }
  const sk = _.stackK[i];
  if (sk && !_.stackLost[i]) for (let c = 0; c < sk.length; c++) { const r2 = _.lineRef[sk[c]]; if (r2 >= 0) credit(w, r2, lines); }
  // growth (instant logic radius, capped)
  const a = w._.a[i];
  P.mass += k * a * a;
  const rn = Math.sqrt(P.r0 * P.r0 + G * P.mass);
  const r = rn < P.cap ? rn : P.cap;
  if (r > P.r) P.r = r;
  P.rEff = P.megaT > 0 ? P.r * MEGA.mul : P.r;
  ev.push({ type: 'bite', i, kind: w.kindNames[w.kind[i]], tier: tierOf(a, false), n: C.n, ing });
  const S = P.sizeUpR;
  while (P.step + 1 < S.length && P.r >= S[P.step + 1]) { P.step++; ev.push({ type: 'sizeUp', step: P.step, r: P.r }); }
  for (let c = 0; c < lines.length; c++) ev.push(lines[c]);
  chainBeats(w);
}

function credit(w, ref, out) {
  const k = ref >> 3, li = ref & 7, ln = w.tickets[k].lines[li];
  ln.got++;
  if (ln.got >= ln.need) { out.push({ type: 'line', ti: k, li }); updateLineRef(w); }
}

function chainBeats(w) {
  const C = w.chain, ev = w.events, _ = w._;
  if (C.n % 5 === 0) ev.push({ type: 'chain', n: C.n });
  if (w.timed && !_.finalBite && (C.n === SIZZLE_AT || (C.n > SIZZLE_AT && (C.n - SIZZLE_AT) % SIZZLE_EVERY === 0))) {
    let add = _.sizzleCap - w.sizzle;
    if (add > 1) add = 1;
    if (add > 1e-9) { w.tLeft += add; w.sizzle += add; w.stats.sizzles++; ev.push({ type: 'sizzle', add }); }
  }
}

function fail(w, why) {
  w.result = why; w.stars = 0;
  if (w.chain.n > w.chain.best) w.chain.best = w.chain.n;
  w.events.push({ type: 'fail', why, progress: progress(w), missing: missing(w) });
}

/** Missing ingredients of the current ticket: [{kind, n}] (fail card). */
export function missing(w) {
  const out = [], tk = w.tickets[w.ti];
  if (tk) for (const l of tk.lines) if (l.got < l.need) out.push({ kind: l.kind, n: l.need - l.got });
  return out;
}

// ------------------------------------------------------------------ doom, stars, progress
/**
 * Soft-lock test (§3.8): (a) an open line needs more than the reachable items of its kind (st 0/1/3, rollers
 * included, intact fragile-stack contents included; lost items never count; no geometry test), or (b) the
 * optimistic reachable radius sqrt(r² + G·Σ k·a² over alive non-boss items) is below needR(boss.a).
 * DECISION: (b) uses each item's own k (1 for ingredients) as an upper bound and is skipped once the padlock
 * is open; needs are summed per kind over the current and later tickets.
 */
export function doomed(w) {
  if (w.result) return false;
  const _ = w._, cnt = _.kcnt, need = _.kneed, n = w.n, st = w.st, kd = w.kind, fl = w.flags, ia = _.a, ik = w.ik;
  cnt.fill(0); need.fill(0);
  let any = false;
  for (let k = w.ti; k < w.tickets.length; k++) for (const l of w.tickets[k].lines) if (l.got < l.need) { need[l.kid] += l.need - l.got; any = true; }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = st[i];
    if (s !== 0 && s !== 1 && s !== 3) continue;
    cnt[kd[i]]++;
    const sk = _.stackK[i];
    if (sk && !_.stackLost[i]) for (let c = 0; c < sk.length; c++) cnt[sk[c]]++;
    if (s !== 1 && !(fl[i] & F_BOSS)) sum += ik[i] * ia[i] * ia[i];
  }
  if (any) for (let k = 0; k < 256; k++) if (need[k] > cnt[k]) return true;
  const tk = w.tickets[w.ti];
  if (tk && tk.boss >= 0 && !tk.open) {
    const P = w.pot;
    let rUp = Math.sqrt(P.r * P.r + G * sum);
    if (rUp > P.cap) rUp = P.cap;
    if (rUp < needR(ia[tk.boss]) - 1e-9) return true;
  }
  return false;
}

export function starsFor(w) {
  if (!w.timed || (w.level && w.level.n === 1)) return 3;
  if (w._.cardFreeze) return 1;
  const tl = w._.finalBite ? w._.biteTLeft : w.tLeft;
  const left = (tl - w.freezeAdded) / w.T;
  return left >= STAR3 ? 3 : left >= STAR2 ? 2 : 1;
}

/** rMaxShown of the HUD meter: needR(final boss a) × 1.15 (§9.3). */
export function rMaxShown(w) {
  const tk = w.tickets[w.tickets.length - 1];
  const a = tk && tk.boss >= 0 ? w._.a[tk.boss] : FIT * w.pot.cap;
  return needR(a) * 1.15;
}

/** Fail-card bar, size only: meterX(r) / meterX(needR(boss.a)) (§5.4). */
export function sizeBar(w) {
  const b = curBoss(w);
  if (b < 0) return 0;
  const P = w.pot, rm = rMaxShown(w), need = needR(w._.a[b]);
  const den = meterX(need, P.r0, rm);
  if (den <= 0) return P.r >= need ? 1 : 0;
  const v = meterX(P.r, P.r0, rm) / den;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Analytics only: 0.7 size + 0.3 ticket blend. */
export function progress(w) {
  if (w.result === 'win') return 1;
  let need = 0, got = 0;
  for (const tk of w.tickets) for (const l of tk.lines) { need += l.need; got += l.got < l.need ? l.got : l.need; }
  const v = 0.7 * sizeBar(w) + 0.3 * (need > 0 ? got / need : 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fail-card copy rule (§5.4): 'close' (SO CLOSE!), 'almost' (Almost!) or null (Out of time!). */
export function nearMiss(w) {
  const s = sizeBar(w);
  let miss = 0;
  for (const m of missing(w)) miss += m.n;
  if (s >= 0.9 && miss <= 1) return 'close';
  if (s >= 0.7 || miss <= 2) return 'almost';
  return null;
}

// ------------------------------------------------------------------ boosters
/**
 * DECISION: logic refuses only a booster already used this attempt, any booster in Feast, Freeze on an
 * untimed level, and anything after a result; owned counts are game.js/meta's job (a booster bought
 * mid-level must work), so the createWorld `boosters` counts are kept in w._.avail for bots only.
 */
export function useBooster(w, kind) {
  if (w.result || w.mode === 'feast' || !(kind in w.boost) || w.boost[kind]) return false;
  const P = w.pot;
  if (kind === 'freeze') { if (!w.timed) return false; w.tLeft += FREEZE_ADD; w.freezeAdded += FREEZE_ADD; }
  else if (kind === 'magnet') P.magnetT = MAGNET.t;
  else if (kind === 'mega') { P.megaT = MEGA.t; P.rEff = P.r * MEGA.mul; }
  w.boost[kind] = true;
  w.events.push({ type: 'boost', kind });
  return true;
}

/**
 * Fail-card "+10 s, keep cooking": only after a time-out, once per attempt. Clears the result and resumes
 * in place; any later win is 1★. DECISION: independent of an in-play Freeze (game.js gates the card).
 */
export function freezeContinue(w) {
  if (w.result !== 'timeout' || w._.cardFreeze) return false;
  const _ = w._;
  w.result = null; w.stars = 0;
  w.tLeft = (w.tLeft > 0 ? w.tLeft : 0) + FREEZE_ADD;
  w.freezeAdded += FREEZE_ADD;
  w.boost.freeze = true;
  _.cardFreeze = true; _.lowSent = false; _.lastTick = 99; _.doomAt = -1;
  return true;
}

// ------------------------------------------------------------------ snapshot (__qa)
export function snapshot(w) {
  const P = w.pot, b = curBoss(w);
  let alive = 0, tipping = 0;
  for (let i = 0; i < w.n; i++) { const s = w.st[i]; if (s === 0 || s === 3) alive++; else if (s === 1) tipping++; }
  return {
    t: w.t, tStart: w.tStart, T: w.T, tLeft: w.tLeft, timed: w.timed, mode: w.mode, result: w.result, stars: w.stars,
    r: P.r, rEff: P.rEff, cap: P.cap, r0: P.r0, x: P.x, z: P.z, vx: P.vx, vz: P.vz, step: P.step,
    needR: b >= 0 ? needR(w._.a[b]) : 0, bossState: b >= 0 ? bossState(w, b) : 'open',
    ti: w.ti, tickets: w.tickets.map(tk => ({ done: tk.done, open: tk.open, boss: tk.boss, lines: tk.lines.map(l => ({ kind: l.kind, need: l.need, got: l.got })) })),
    chain: { n: w.chain.n, best: w.chain.best }, sizzle: w.sizzle, freezeAdded: w.freezeAdded,
    boost: { ...w.boost }, megaT: P.megaT, magnetT: P.magnetT, boilT: P.boilT,
    items: w.n, alive, tipping, progress: progress(w), bar: sizeBar(w), doomed: doomed(w), stats: { ...w.stats },
  };
}

export { DT };
