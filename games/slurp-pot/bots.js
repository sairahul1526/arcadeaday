// Slurp Pot bots (GDD §5.2, §13.3). Sim role. Pure and deterministic: every bot acts only through
// inp = {x, z, m} on game time, seeded with mulberry32; it reads w and never writes it.
// Kinds: greedy, casual, average, planner, expert, director.
import { DT, G, K_ING, GULL, CRACK_V, WOBBLE_V } from './consts.js';
import * as L from './logic.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DEG = Math.PI / 180;
// redecide s, second-best chance, lag s, OU sigma, OU theta (1/s), m, idle at start s, sight, sidestep chance, planner,
// focus (ticket focus once the boss fits, see focusOf), turn (max heading rate rad/s, 0 = none)
const KINDS = {
  greedy:  { precise: false, every: 0.1,  second: 0,    lag: 0,    sigma: 0,       theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: false, look: false, focus: false, turn: 0 },
  // DECISION (Wed pm, casual pacing): casual lag 0.40 s (GDD §5.2: 0.30) and side 1 (GDD: 0.5), with target memory
  // (memo, see pickTarget) and the edge-arrow fix (candidates). side 0.5 skipped the router on half the decisions and
  // the arrow bug flip-flopped it at gates, so casual stalled behind fences (L4/L18/L23 under goal.casual) while it
  // ran 10-25 points over goal on open levels; the extra lag slows it evenly instead. L4-L23 at today's T, seeds
  // 101-120: within goal.casual +-7 on 4 -> 12 levels, mean delta +9.1 -> +2.8; seeds 1-40 (verify's): 7 -> 7, +6.4 ->
  // +2.2, and levels where some T in the greedy window meets goal.casual 8 -> 14 of 20. Tried and dropped: sigma as the
  // stationary error (25 deg: L4 42 %, L23 17 %), a 0.25 s hesitation per new target (L4 8 %), a ticket-focus delay.
  casual:  { precise: true, every: 0.35, second: 0.2,  lag: 0.40, sigma: 25 * DEG, theta: 3, m: 0.85, idle: 1.0, sight: true,  side: 1,   plan: false, look: false, focus: true,  turn: 0, memo: true },
  average: { precise: true, every: 0.2,  second: 0.1,  lag: 0.20, sigma: 15 * DEG, theta: 3, m: 0.92, idle: 0.6, sight: false, side: 1,   plan: false, look: true,  focus: true,  turn: 0 },
  // DECISION (Wed): the planner gets ticket focus too (it is verify's "best route" reference for gate 3a). On the
  // frozen L4–L9 its time / greedy drops to 0.59–0.86 (from 0.80–0.97); L8 0.96 and L10 0.85 are unchanged (layout).
  planner: { precise: false, every: 15 * DT, second: 0, lag: 0,    sigma: 0,       theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: true,  look: false, focus: true,  turn: 0 },
  expert:  { precise: true, every: 15 * DT, second: 0, lag: 0.12, sigma: 6 * DEG,  theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: true,  look: false, focus: true,  turn: 0, hold: 3 },
  // DECISION (Wed): director = the record/showcase bot: expert's planner and ticket focus, no lag or noise, and
  // a turn-rate limit (7 rad/s) so the camera path reads smooth on video; follows level.recordPath when present.
  director: { precise: true, every: 15 * DT, second: 0, lag: 0,   sigma: 0,       theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: true,  look: false, focus: true,  turn: 7 },
};

const STUCK_T = 0.5, BAN_T = 1.5, ESCAPE_T = 0.6, KEEP_T = 0.25;

/**
 * DECISION: an unknown kind falls back to expert (bot.fallback = true).
 * opts.noiseDeg adds heading noise with a stationary error of noiseDeg to any kind (verify gate: greedy + 20 seeds
 * at ±3°).
 */
export function createBot(kind = 'greedy', seed = 1, opts = {}) {
  const k = KINDS[kind] ? kind : 'expert';
  const P = Object.assign({}, KINDS[k]);
  if (opts.noiseDeg) { P.sigma = opts.noiseDeg * DEG * Math.sqrt(2 * P.theta); }   // ±noiseDeg stationary
  if (opts.P) Object.assign(P, opts.P);             // tuning overrides (sim tools only)
  return {
    kind, base: k, fallback: !KINDS[kind], P, rand: rng(seed), seed,
    t: 0, nextDecide: 0, target: -1, targetT: -9, ban: new Float32Array(256), sideOn: true,
    stuckX: 0, stuckZ: 0, stuckT: 0, escapeT: 0, escapeSign: 1, skip: -1, skipT: 0, ox: 0, oz: 0, rTgt: -1, rT: -1, rWp: null,
    noise: 0, queue: [], out: { x: 0, z: 0, m: 0 }, dir: { x: 0, z: -1 }, plan: [], planT: -9, w: null,
    lv: null, zNeed: null, foc: false, prevTgt: -1, gullT: null, wp: 0,
  };
}

function gauss(R) { const u = R() || 1e-9, v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ------------------------------------------------------------------ scoring helpers
/**
 * DECISION (Wed, zoneGraph): bots read level.zoneGraph (levels.js puts it on every expanded level) instead of a
 * zone pass of their own: zNeed[z] = the largest gate radius (edge r = needR(gate a)) on the way from zone z to
 * zone 0, so an item in zone z is reachable once rEff >= zNeed[z]. Recomputed when w.level changes (Feast course).
 */
function zNeedOf(bot, w) {
  const lv = w.level;
  if (bot.lv === lv && bot.zNeed) return bot.zNeed;
  const zg = lv && lv.zoneGraph;
  let need = new Float64Array(1);
  if (zg && zg.nodes && zg.nodes.length) {
    const N = zg.nodes.length, par = new Int32Array(N).fill(-1), er = new Float64Array(N);
    for (const e of zg.edges || []) if (e.b >= 0 && e.b < N) { par[e.b] = e.a; er[e.b] = +e.r || 0; }
    need = new Float64Array(N);
    for (let z = 1; z < N; z++) { let m = 0, q = z; for (let g = 0; q > 0 && g < N; g++) { if (er[q] > m) m = er[q]; q = par[q]; } need[z] = m; }
  }
  bot.lv = lv; bot.zNeed = need;
  return need;
}
function zoneOK(bot, w, i, r) {
  const z = w._.zone[i], nd = zNeedOf(bot, w);
  return !(z > 0 && z < nd.length && nd[z] > r + 1e-9);
}
/** Open lines of the CURRENT ticket item i would count toward (itself + an intact fragile stack's contents). */
function ingHits(w, i) {
  const _ = w._, ref = _.lineRef, ti = w.ti;
  let h = 0;
  const r = ref[w.kind[i]];
  if (r >= 0 && (r >> 3) === ti) h++;
  const sk = _.stackK[i];
  if (sk && !_.stackLost[i]) for (let c = 0; c < sk.length; c++) { const r2 = ref[sk[c]]; if (r2 >= 0 && (r2 >> 3) === ti) h++; }
  return h;
}
/**
 * DECISION (Wed, pacing): ticket focus. Humans read the ticket: once the pot fits the boss (the meter passes the
 * boss mark) and lines are still open, they stop growing and go get the missing ingredients. focus-kind bots
 * (casual, average, expert, director) then value a reachable current-ticket ingredient (or a stack holding one) at
 * FOC_V per line hit and other food at x FOC_JUNK, so they only take junk that is right on the way. Every bot
 * (greedy too) focuses on a boss-less ticket (Feast tickets 1-3), where growth alone never serves it.
 * greedy and planner keep the GDD rule in normal levels (they anchor T and the route gate). Before the boss
 * fits nothing changes: lines are 3a^2 + 0.02 as before.
 */
const FOC_V = 1, FOC_JUNK = 0.1, STACK_ING = 0.1;
function focusOf(bot, w) {
  const tk = w.tickets[w.ti];
  if (!tk || tk.done || !tk.lines.some(l => l.got < l.need)) return false;
  const b = tk.boss;
  if (b < 0) return true;
  return !!bot.P.focus && L.canFit(w.pot.r, w._.a[b]);
}
/**
 * DECISION (Wed, gulls): a bot beats a gull when it can: an item under a swoop telegraph (gull st 1) that the pot
 * can reach before the 1.6 s run out (dist / vMax <= time left + 0.15 s) is worth max(v, 1) x 4.
 * Returns a per-decision Map item -> 1 (or null when no gull is swooping).
 */
function gullTargets(w) {
  const Gs = w.gulls;
  if (!Gs || !Gs.length) return null;
  let m = null;
  const v = L.speedOf(w.pot.r);
  for (let g = 0; g < Gs.length; g++) {
    const q = Gs[g];
    if (q.st !== 1 || q.i < 0) continue;
    const d = Math.hypot(w.ix[q.i] - w.pot.x, w.iz[q.i] - w.pot.z) - w.pot.rEff;
    if (d / v <= GULL.warn - q.t + 0.15) { if (!m) m = new Map(); m.set(q.i, 1); }
  }
  return m;
}

/** Value of eating item i now (growth, with counted ingredients and the open boss weighted up). */
function valueOf(bot, w, i, look) {
  const fl = w.flags[i];
  if (fl & L.F.BOSS) return L.bossState(w, i) === 'open' ? 1e3 : 0;
  const a = w._.a[i];
  const h = ingHits(w, i);
  let v;
  if (L.lineOf(w, i) >= 0) v = 3 * a * a + 0.02;
  else {
    v = L.growthOf(w, i) + STACK_ING * h;
    if (look) {
      // 1-step recipe lookahead: an item whose growth lets a needed ingredient or the boss fit is worth more.
      const P = w.pot, r1 = Math.min(P.cap, Math.sqrt(P.r0 * P.r0 + G * (P.mass + v)));
      const b = L.curBoss(w);
      if (b >= 0 && w.tickets[w.ti].done && !L.canFit(P.r, w._.a[b]) && L.canFit(r1, w._.a[b])) v *= 3;
    }
  }
  if (bot.foc) {
    if (h > 0 && zoneOK(bot, w, i, w.pot.rEff)) v = Math.max(v, FOC_V * h);
    else v *= FOC_JUNK;
  }
  if (bot.gullT && bot.gullT.has(i)) v = Math.max(v, 1) * 4;
  return v;
}

/** True when a solid item sits on the segment pot → (tx, tz) (closer than its block distance). */
function pathBlocked(w, tx, tz, skip) {
  const P = w.pot, x0 = P.x, z0 = P.z, dx = tx - x0, dz = tz - z0, l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return false;
  const half = 0.5 * P.r;
  for (let j = 0; j < w.n; j++) {
    if (j === skip || w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const ex = w.ix[j] - x0, ez = w.iz[j] - z0;
    let u = (ex * dx + ez * dz) / l2;
    if (u <= 0) continue;
    if (u > 1) u = 1;
    const cx = ex - dx * u, cz = ez - dz * u, rr = (w._.a[j] + half) * 0.95;
    if (cx * cx + cz * cz < rr * rr) return true;
  }
  return false;
}

// DECISION (Wed, lag): a lagged non-planner bot treats every item the pot will already have swallowed when its next
// command lands (predicted spot within rEff − 0.25·a, the swallow rule) as eaten, not only the current target.
// With one skip slot it re-picked those items (80 re-picks a run on L8) and steered at a point inside its own
// mouth, so the heading flipped every few frames: 5–12 % of the casual run on L8/L10.
function candidates(bot, w) {
  const P = w.pot, out = [], t = bot.t, ox = bot.ox, oz = bot.oz;
  const lagged = bot.P.lag > 0 && !bot.P.plan && !bot.P.noskip, re = P.rEff;
  let sight = 1e9;
  if (bot.P.sight) sight = L.SEE_R(P.r);
  for (let pass = 0; pass < 3 && !out.length; pass++) {
    const s2 = sight * sight;
    for (let i = 0; i < w.n; i++) {
      if (!L.edible(w, i) || bot.ban[i] > t || i === bot.skip) continue;
      const dx = w.ix[i] - ox, dz = w.iz[i] - oz, d2 = dx * dx + dz * dz;
      if (d2 > s2) continue;
      if (lagged && !(w.flags[i] & L.F.BOSS)) {
        const a = w._.a[i], lim = re - 0.25 * a;
        if (lim > 0 && d2 < lim * lim && L.canFit(re, a)) continue;
      }
      out.push(i);
    }
    sight = pass === 0 ? L.VIEW_R(P.r) : 1e9;
  }
  // DECISION (Wed, §7.6 edge arrows): a sight-limited bot (casual) still follows the arrows a player sees: the open
  // boss (padlock pop + arrow) and, when no current-ticket ingredient is in sight, the nearest reachable one.
  if (bot.P.sight) {
    const b = L.curBoss(w);
    if (b >= 0 && L.edible(w, b) && !out.includes(b)) out.push(b);
    let has = false;
    // DECISION (Wed pm): only a REACHABLE ingredient in sight (zone open, fits) cancels the arrow. An unreachable one
    // (L4: a zone-1 cheese behind the pen) used to cancel it, so the arrow target came and went with the view and
    // casual flip-flopped for up to 18 s (L4 casual tail 1.4-1.5 T -> 1.2 T).
    for (let k = 0; k < out.length && !has; k++) { const i = out[k]; if (ingHits(w, i) > 0 && zoneOK(bot, w, i, P.rEff) && L.canFit(P.rEff, w._.a[i])) has = true; }
    if (!has) {
      let bi = -1, bd = 1e18;
      for (let i = 0; i < w.n; i++) {
        if (!L.edible(w, i) || bot.ban[i] > t || i === bot.skip || !ingHits(w, i) || !zoneOK(bot, w, i, P.rEff)) continue;
        const dx = w.ix[i] - ox, dz = w.iz[i] - oz, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      if (bi >= 0 && !out.includes(bi)) out.push(bi);
    }
  }
  return out;
}

// DECISION: a blocked straight path costs x0.02 (proto rule), except for the current target when the bot
// sidesteps and the router has a way round: that one is scored by the detour length (pot -> waypoint -> target).
// Without it greedy flip-flopped at the edge of a blocker's shadow (L3: 20 s between a grape and a cooler behind
// a bench, then timeout).
function scoreList(bot, w, list) {
  const res = [];
  for (const i of list) {
    const v = valueOf(bot, w, i, bot.P.look);
    if (v <= 0) continue;
    const d = Math.hypot(w.ix[i] - bot.ox, w.iz[i] - bot.oz);
    let s = v / Math.pow(d + 0.6, 1.5);
    if (!(w.flags[i] & L.F.BOSS) && pathBlocked(w, w.ix[i], w.iz[i], i)) {
      const wp = i === bot.target && bot.sideOn ? routeTo(bot, w, i, w.ix[i], w.iz[i]) : null;
      if (wp) s = v / Math.pow(Math.hypot(wp.x - bot.ox, wp.z - bot.oz) + Math.hypot(w.ix[i] - wp.x, w.iz[i] - wp.z) + 0.6, 1.5);
      else {
        const pl = bot.P.precise ? pathLen(w, i) : -1;      // pens: see pathLen (greedy keeps ×0.02)
        s = pl > 0 ? v / Math.pow(penD(d, pl) + 0.6, 1.5) : s * 0.02;
      }
    }
    res.push([s, i]);
  }
  res.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  return res;
}

/** True when a solid item (other than skip) sits on the segment (x0, z0) → (x1, z1) for the pot's size. */
function segBlocked(w, x0, z0, x1, z1, skip) {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return false;
  const half = 0.5 * w.pot.r;
  for (let j = 0; j < w.n; j++) {
    if (j === skip || w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const ex = w.ix[j] - x0, ez = w.iz[j] - z0;
    let u = (ex * dx + ez * dz) / l2;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    const cx = ex - dx * u, cz = ez - dz * u, rr = (w._.a[j] + half) * 0.95;
    if (cx * cx + cz * cz < rr * rr) return true;
  }
  return false;
}

// ------------------------------------------------------------------ router (coarse grid BFS around solids)
/**
 * DECISION: bots route around walls: when the straight path to the target is blocked, they search a 0.5 u grid
 * (cells closer than a + 0.5·r + 0.05 to a solid item are closed; 8-neighbour BFS) and steer at the farthest
 * path cell in straight sight. No path → the target is unreachable for now (non-boss targets are banned 3 s).
 * Pens open by themselves: a gate piece the pot fits is no longer solid. The route is cached 0.3 s per target.
 * casual skips routing whenever it skips sidestepping (bumps blockers 50 % of the time, §5.2).
 */
const RC = 0.5;
let rBlk = new Uint8Array(0), rPar = new Int32Array(0), rQ = new Int32Array(0);
/** Fills blk (closed cells of the router grid for the pot's current size, item skip left open); returns nx. */
function blockGrid(w, blk, skip, slack = 0) {
  const _ = w._, x0 = _.x0, z0 = _.z0;
  const nx = Math.max(1, Math.ceil((_.x1 - x0) / RC)), nz = Math.max(1, Math.ceil((_.z1 - z0) / RC));
  blk.fill(0, 0, nx * nz);
  const half = 0.5 * w.pot.r + 0.05 - slack;
  for (let j = 0; j < w.n; j++) {
    if (j === skip || w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const rr = _.a[j] + half, cx = w.ix[j], cz = w.iz[j];
    let i0 = Math.floor((cx - rr - x0) / RC), i1 = Math.floor((cx + rr - x0) / RC);
    let k0 = Math.floor((cz - rr - z0) / RC), k1 = Math.floor((cz + rr - z0) / RC);
    if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= nx) i1 = nx - 1; if (k1 >= nz) k1 = nz - 1;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const ex = x0 + (i + 0.5) * RC - cx, ez = z0 + (k + 0.5) * RC - cz;
      if (ex * ex + ez * ez < rr * rr) blk[k * nx + i] = 1;
    }
  }
  // DECISION (Fri, wall corridor): the pot's centre is clamped 0.5 r inside the arena (logic.js step 6), so cells closer
  // to the edge do not exist for it. Left open they made a phantom corridor between the wall and any big item standing
  // 2.7 u off it: L57 casual and L44 average pressed into that gap at r 1.5 for the last 45 s of the run, with the fries
  // or tacos 10-25 u behind them ("timeout at bar 0.5-0.8"). Exact geometry, so the routing slack above does not apply.
  const edge = 0.5 * w.pot.r, eC = Math.ceil(edge / RC - 0.5 - 1e-9);
  if (eC > 0) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (i < eC || k < eC || i >= nx - eC || k >= nz - eC) blk[k * nx + i] = 1;
  }
  return nx;
}
function gridN(w) {
  const _ = w._;
  return Math.max(1, Math.ceil((_.x1 - _.x0) / RC)) * Math.max(1, Math.ceil((_.z1 - _.z0) / RC));
}

/**
 * DECISION (Wed, pens): bots know the way into a pen. When a straight first leg is blocked, the leg is the
 * router-grid path length from the pot (one 8-neighbour BFS flood per decision, steps × RC × 1.08 for the
 * diagonal mix, read at the best open cell within 0.75·rEff of the item) instead of the blocked ×0.02 penalty,
 * which stays when no path exists. Every bot but greedy uses it; greedy keeps ×0.02 (it is the T reference
 * every level was tuned on). Without it the planner and expert never entered L34's
 * pen (gate car at its west end, the eggplant line inside) and timed out at r 1.43 with the line 0/3; L22/L53
 * casual timeouts had the same cause. The steering already routes (routeTo) once the item is the target.
 * The leg costs the straight distance plus TWICE the detour (pl − d: in, then back out; penD). Measured on
 * 8 seeds (L4/5/6/8/10/22/34/53) against "max(d, pl) × 1.6 + 0.6", "×1.25", "×1.0", "ingredients only" and
 * "keep ×0.02 behind a wall the pot fits at 1.4 r": in+out wins L34 (planner 60 s 3★ vs 63 / timeout before,
 * expert and average 75 % vs 38 % / 13 %), L8 (planner 0.74 × greedy vs 0.80; average 3★ 38 % vs 13 %) and L22
 * / L4 average 3★ (25 % vs 0 %). Cost: the L4 expert flip-flops between two coolers behind the pen and enters it
 * small: 40/40 wins but median 42 s of T 46 (32 s before), 3★ 5 %. A commit bonus in the beam did not fix it.
 */
const DETOUR = 2;
/** Leg length (u) to a pen item: straight distance d plus the detour (path pl − d), paid going in and coming out. */
const penD = (d, pl) => d + Math.max(0, pl - d) * DETOUR;
let fBlk = new Uint8Array(0), fD = new Int32Array(0), fQ = new Int32Array(0), fW = null, fT = -1, fX = 0, fZ = 0, fR = 0, fNx = 1;
function pathField(w) {
  const P = w.pot;
  if (fW === w && fT === w.t && fX === P.x && fZ === P.z && fR === P.r) return;
  const N = gridN(w);
  if (fBlk.length < N) { fBlk = new Uint8Array(N); fD = new Int32Array(N); fQ = new Int32Array(N); }
  const nx = blockGrid(w, fBlk, -1), nz = N / nx, _ = w._;
  fD.fill(-1, 0, N);
  let i0 = Math.floor((P.x - _.x0) / RC), k0 = Math.floor((P.z - _.z0) / RC);
  if (i0 < 0) i0 = 0; else if (i0 >= nx) i0 = nx - 1;
  if (k0 < 0) k0 = 0; else if (k0 >= nz) k0 = nz - 1;
  const s0 = k0 * nx + i0;
  let qh = 0, qt = 0;
  fQ[qt++] = s0; fD[s0] = 0;
  while (qh < qt) {
    const c = fQ[qh++], ci = c % nx, ck = (c - ci) / nx, dc = fD[c] + 1;
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const i = ci + di, k = ck + dk;
      if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
      const q = k * nx + i;
      if (fD[q] >= 0 || fBlk[q]) continue;
      if (di && dk && (fBlk[ck * nx + i] || fBlk[k * nx + ci])) continue;
      fD[q] = dc; fQ[qt++] = q;
    }
  }
  fW = w; fT = w.t; fX = P.x; fZ = P.z; fR = P.r; fNx = nx;
}
/** Grid path length from the pot to item i (u), or -1 when no open cell near it is reachable. */
function pathLen(w, i) {
  pathField(w);
  const _ = w._, nx = fNx, nz = gridN(w) / nx, x = w.ix[i], z = w.iz[i];
  const reach = Math.max(RC, 0.75 * w.pot.rEff), R = Math.ceil(reach / RC);
  const ci = Math.floor((x - _.x0) / RC), ck = Math.floor((z - _.z0) / RC);
  let best = -1;
  for (let k = ck - R; k <= ck + R; k++) for (let j = ci - R; j <= ci + R; j++) {
    if (j < 0 || k < 0 || j >= nx || k >= nz) continue;
    const d = fD[k * nx + j];
    if (d < 0) continue;
    const ex = _.x0 + (j + 0.5) * RC - x, ez = _.z0 + (k + 0.5) * RC - z, e2 = ex * ex + ez * ez;
    if (e2 > reach * reach + 0.5 * RC * RC) continue;
    const len = d * RC * 1.08 + Math.sqrt(e2);
    if (best < 0 || len < best) best = len;
  }
  return best;
}

function route(w, tgt, tx, tz, tight = false) {
  const _ = w._, x0 = _.x0, z0 = _.z0;
  const N = gridN(w);
  if (rBlk.length < N) { rBlk = new Uint8Array(N); rPar = new Int32Array(N); rQ = new Int32Array(N); }
  const nx = Math.max(1, Math.ceil((_.x1 - x0) / RC)), nz = N / nx;
  const P = w.pot;
  const cell = (x, z) => {
    let i = Math.floor((x - x0) / RC), k = Math.floor((z - z0) / RC);
    if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
    if (k < 0) k = 0; else if (k >= nz) k = nz - 1;
    return k * nx + i;
  };
  // the goal cell is read where the pot can stand: an item on the wall is swallowed from inside the clamp (see blockGrid)
  const eh = 0.5 * P.r;
  const s0 = cell(P.x, P.z), g = cell(Math.min(_.x1 - eh, Math.max(x0 + eh, tx)), Math.min(_.z1 - eh, Math.max(z0 + eh, tz)));
  // DECISION (Thu, gate stall): a closed grid is not always a closed gap. The pot collides at a + 0.5·r, but cells are
  // 0.5 u and sampled at their centres, so a grown pot's corridor back through an eaten gate can miss every cell centre.
  // L25 expert 1005 (r 1.39) got no path to the pineapples, banned them, and wandered until time out, while a
  // force-steered pot took them in 8 s. No path at full clearance now retries with 0.35 u less (0.7 of a cell), but only
  // when the pot is big enough for the target's zone (tight, see routeTo), so a closed pen still reads as closed.
  // L25 at T 82: expert 70.6 -> 100 %, average 85 -> 99 %. L4: average 3-star 27 -> 54 % (no more stall), casual unchanged.
  let found = false;
  for (const slack of tight ? [0, 0.3 * RC, 0.7 * RC] : [0]) {
    blockGrid(w, rBlk, tgt, slack);
    rBlk[s0] = 0; rBlk[g] = 0;
    rPar.fill(-1, 0, N);
    let qh = 0, qt = 0;
    rQ[qt++] = s0; rPar[s0] = s0;
    while (qh < qt) {
      const c = rQ[qh++];
      if (c === g) { found = true; break; }
      const ci = c % nx, ck = (c - ci) / nx;
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
        if (!di && !dk) continue;
        const i = ci + di, k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
        const q = k * nx + i;
        if (rPar[q] >= 0 || rBlk[q]) continue;
        if (di && dk && (rBlk[ck * nx + i] || rBlk[k * nx + ci])) continue;   // no corner cutting
        rPar[q] = c; rQ[qt++] = q;
      }
    }
    if (found) break;
  }
  if (!found) return null;
  const path = [];
  for (let c = g; c !== s0; c = rPar[c]) path.push(c);
  path.reverse();                                   // pot → target
  for (let k = path.length - 1; k >= 0; k--) {
    const c = path[k], ci = c % nx, ck = (c - ci) / nx;
    const px = x0 + (ci + 0.5) * RC, pz = z0 + (ck + 0.5) * RC;
    if (k === 0 || !segBlocked(w, P.x, P.z, px, pz, tgt)) return k === path.length - 1 ? { x: tx, z: tz } : { x: px, z: pz };
  }
  return { x: tx, z: tz };
}

function routeTo(bot, w, tgt, tx, tz) {
  if (bot.rT > bot.t && bot.rTgt === tgt && bot.rWp) {
    // reuse while the cached waypoint is still ahead and visible
    if (!segBlocked(w, w.pot.x, w.pot.z, bot.rWp.x, bot.rWp.z, tgt)) return bot.rWp;
  }
  const wp = route(w, tgt, tx, tz, tgt >= 0 && zoneOK(bot, w, tgt, w.pot.r));
  bot.rTgt = tgt; bot.rT = bot.t + 0.3; bot.rWp = wp;
  return wp;
}

// ------------------------------------------------------------------ planner (rollouts, straight-line model)
/**
 * Alternative planner (P.roll; the default is planBeam below): one-step policy improvement over greedy in a
 * straight-line model (no logic.step rollouts). In A/B on 35 layouts it was ~1.0x greedy time, worse than the beam.
 * It scores each of the K = 8 best first targets (greedy metric,
 * + the open boss) by a model rollout: eat it, then follow greedy in the model for up to H = 10 bites / 8 s
 * (leg time = dist / vMax(r), r grown along the way, later items become edible). Each rollout ends with an
 * estimate of the time still needed to bite the boss:
 *   est = rollout time + missing boss mass / reference mass rate + per open line (nearest item of that kind / v
 *         + 0.5 s per extra unit) + distance to the boss / v,
 * with the reference rate taken from greedy's own rollout, so the choices are compared on equal terms. The
 * planner picks the lowest est (greedy's own choice is one of the candidates, so in the model it is never worse
 * than greedy), with 10 % hysteresis on the current target. A blocked first leg costs ×1.6 time + 0.6 s.
 * Knows the timer only through est (it never gambles). Does not read levels.zoneGraph yet.
 */
const PK = 8, PH = 10, PT = 8;
let mark = new Uint32Array(256), stamp = 1;
function plan(bot, w) {
  const P = w.pot, n = w.n, t = bot.t, A = w._.a, X = w.ix, Z = w.iz, K = w.kind, IK = w.ik, FL = w.flags;
  const tk = w.tickets[w.ti];
  if (mark.length < n) mark = new Uint32Array(n + 64);
  const pool = [];
  const bossI = L.curBoss(w), bossA = bossI >= 0 ? A[bossI] : 0;
  for (let i = 0; i < n; i++) {
    const s = w.st[i];
    if ((s !== 0 && s !== 3) || w.hid[i] || bot.ban[i] > t || i === bot.skip) continue;
    if (FL[i] & L.F.BOSS) continue;
    if (A[i] <= 0.9 * P.cap + 1e-9 && L.refused(w, i) === false) pool.push(i);
  }
  const lines = tk ? tk.lines.map(l => ({ kid: l.kid, rem: l.need - l.got })) : [];
  const bossNeedR = bossI >= 0 ? L.needR(bossA) : 0;
  const r0sq = P.r0 * P.r0;
  const mStar = bossI >= 0 ? (bossNeedR * bossNeedR - r0sq) / G : 0;     // total mass the boss needs
  const bx = bossI >= 0 ? X[bossI] : P.x, bz = bossI >= 0 ? Z[bossI] : P.z;
  const lineOfKind = k => { for (let j = 0; j < lines.length; j++) if (lines[j].kid === k) return j; return -1; };

  // model rollout from (x, z, mass, r) after eating `first` (or greedy's pick when first < 0)
  function rollout(first, rem, refRate) {
    stamp++; if (stamp >= 0xFFFFFFF0) { mark.fill(0); stamp = 1; }
    let x = P.x, z = P.z, mass = P.mass, r = P.r, time = 0, mass0 = P.mass;
    const seq = [];
    let bossDone = false;
    const PHk = bot.P.ph || PH, PTk = bot.P.pt || PT;
    for (let h = 0; h < PHk && time < PTk; h++) {
      const done = rem.every(v => v <= 0);
      const open = bossI >= 0 && done && L.canFit(r, bossA);
      let pick = -1, bs = -1;
      if (h === 0 && first >= 0) pick = first;
      else {
        if (open) { pick = bossI; }
        else for (let q = 0; q < pool.length; q++) {
          const i = pool[q];
          if (mark[i] === stamp) continue;
          const a = A[i];
          if (!L.canFit(r, a)) continue;
          const li = lineOfKind(K[i]);
          const v = li >= 0 && rem[li] > 0 ? 3 * a * a + 0.02 : IK[i] * a * a;
          const d = Math.hypot(X[i] - x, Z[i] - z);
          const sc = v / Math.pow(d + 0.6, 1.5);
          if (sc > bs) { bs = sc; pick = i; }
        }
      }
      if (pick < 0) break;
      const d = Math.hypot(X[pick] - x, Z[pick] - z);
      let tt = d / L.speedOf(r);
      if (h === 0 && pick !== bossI && pathBlocked(w, X[pick], Z[pick], pick)) tt = tt * 1.6 + 0.6;
      time += tt; x = X[pick]; z = Z[pick];
      seq.push(pick);
      if (pick === bossI) { bossDone = true; break; }
      mark[pick] = stamp;
      const a = A[pick], li = lineOfKind(K[pick]);
      if (li >= 0 && rem[li] > 0) { rem[li]--; mass += K_ING * a * a; } else mass += IK[pick] * a * a;
      const rn = Math.sqrt(r0sq + G * mass);
      r = Math.min(P.cap, Math.max(r, rn));
    }
    if (bossDone) return { est: time, seq, rate: (mass - mass0) / Math.max(time, 1e-3) };
    const rate = (mass - mass0) / Math.max(time, 1e-3);
    const rr = refRate > 0 ? refRate : rate;
    let est = time + Math.max(0, mStar - mass) / Math.max(rr, 1e-3);
    const v = L.speedOf(r);
    for (let j = 0; j < rem.length; j++) {
      if (rem[j] <= 0) continue;
      let best = 1e9;
      for (let q = 0; q < pool.length; q++) {
        const i = pool[q];
        if (mark[i] === stamp || K[i] !== lines[j].kid) continue;
        const d = Math.hypot(X[i] - x, Z[i] - z);
        if (d < best) best = d;
      }
      est += (best < 1e9 ? best / v : 30) + 0.5 * (rem[j] - 1);
    }
    if (bossI >= 0) est += Math.hypot(bx - x, bz - z) / v;
    return { est, seq, rate };
  }

  // the open boss short-circuits everything
  if (bossI >= 0 && L.bossState(w, bossI) === 'open') return [bossI];
  if (!pool.length) return [];
  // candidates: K best by greedy metric
  const sc = [];
  for (const i of pool) {
    const a = A[i];
    if (!L.canFit(P.rEff, a)) continue;
    const li = lineOfKind(K[i]);
    const v = li >= 0 && lines[li].rem > 0 ? 3 * a * a + 0.02 : IK[i] * a * a;
    const d = Math.hypot(X[i] - P.x, Z[i] - P.z);
    let s = v / Math.pow(d + 0.6, 1.5);
    if (pathBlocked(w, X[i], Z[i], i)) s *= 0.02;
    sc.push([s, i]);
  }
  if (!sc.length) return [];
  sc.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  const rem0 = lines.map(l => l.rem);
  const base = rollout(sc[0][1], rem0.slice(), 0);
  const refRate = base.rate;
  let best = rollout(sc[0][1], rem0.slice(), refRate), cur = null;
  const cands = sc.slice(0, bot.P.pk || PK).map(p => p[1]);
  if (bot.target >= 0 && !cands.includes(bot.target) && L.edible(w, bot.target) && !(FL[bot.target] & L.F.BOSS)) cands.push(bot.target);
  for (const c of cands) {
    const r = c === sc[0][1] ? best : rollout(c, rem0.slice(), refRate);
    if (c === bot.target) cur = r;
    if (r.est < best.est - 1e-9) best = r;
  }
  if (cur && cur !== best && cur.est <= best.est * 1.1) return cur.seq;
  return best.seq;
}

/**
 * Planner (default): beam search over bite sequences in a straight-line model (leg time = dist / vMax(r), r grown
 * along the sequence, later items become edible).
 * DECISION: depth 4 (GDD says 3) x width 6, 10 children per node. Sequence score = sum_k value_k / (D_k + 0.6)^1.5,
 * D_k = cumulative time x vMax (greedy's metric summed along the sequence, so depth 1 = greedy); blocked first leg
 * x0.02; hysteresis 1.15 on the current first target; growth x2 when the ticket is done and < 20 s remain. It is a
 * rate objective, not literally "time to boss": an explicit time-to-boss rollout planner (plan(), P.roll) lost to it.
 * A/B, 30 genLevel variants + 5 proto layouts, same run: depth 3 geo-mean time 0.868 x greedy, depth 4 0.854
 * (13/32 layouts <= 0.88). Knobs for A/B: P.bd/bw/bc/bp/bh/bg.
 * DECISION (Wed): items in a zone whose gate the node's r cannot pass yet (level.zoneGraph) are skipped; focus
 * kinds (expert, director) and every bot on a boss-less ticket apply the ticket focus per node (focusOf).
 */
function planBeam(bot, w) {
  const P = w.pot, n = w.n, t = bot.t, A = w._.a;
  const pool = [];
  for (let i = 0; i < n; i++) {
    const s = w.st[i];
    if ((s !== 0 && s !== 3) || w.hid[i] || bot.ban[i] > t) continue;
    if (w.flags[i] & L.F.BOSS) { if (i === L.curBoss(w)) pool.push(i); continue; }
    if (A[i] <= 0.9 * P.cap + 1e-9 && A[i] <= 0.9 * P.r * 1.6) pool.push(i);
  }
  if (!pool.length) return [];
  const tk = w.tickets[w.ti];
  const lineNeed = tk ? tk.lines.map(l => l.need - l.got) : [];
  const lineKid = tk ? tk.lines.map(l => l.kid) : [];
  const bossI = L.curBoss(w), bossA = bossI >= 0 ? A[bossI] : 0;
  const v0 = L.speedOf(P.r);
  const hurry = w.timed && w.tStart !== null && tk && tk.done && w.tLeft - (w.level && w.level.grace > 0 ? w.level.grace : 0) < 20;   // grace buys no stars, so the rush keeps the pace
  let beam = [{ x: P.x, z: P.z, mass: P.mass, r: P.r, time: 0, score: 0, eaten: [], need: lineNeed.slice() }];
  let best = null;
  const BD = bot.P.bd || 4, BW = bot.P.bw || 6, BC = bot.P.bc || 10, BX = bot.P.bp || 1.5, BH = bot.P.bh || 1.15, BG = bot.P.bg ?? 1;
  const FOC = !!bot.P.focus, BI = bot.P.bi ?? 3;
  for (let depth = 0; depth < BD; depth++) {
    const next = [];
    for (const nd of beam) {
      const done = nd.need.every(v => v <= 0);
      const foc = !done && (bossI < 0 || (FOC && L.canFit(nd.r, bossA)));
      const sc = [];
      for (const i of pool) {
        if (nd.eaten.includes(i)) continue;
        const a = A[i], boss = !!(w.flags[i] & L.F.BOSS);
        let val, li = -1;
        if (boss) {
          if (!(depth === 0 ? L.bossState(w, i) === 'open' : done && L.canFit(nd.r, bossA))) continue;
          val = 1e3;
        } else {
          if (!L.canFit(nd.r, a) || (!bot.P.nozone && !zoneOK(bot, w, i, nd.r))) continue;
          li = nd.need.findIndex((v, k) => v > 0 && lineKid[k] === w.kind[i]);
          if (li < 0 && depth === 0 && L.refused(w, i)) continue;
          const h = li >= 0 ? 1 : (w._.stackK[i] ? ingHits(w, i) : 0);
          if (li >= 0) val = BI * a * a + 0.02;
          else { val = w.ik[i] * a * a + STACK_ING * h; if (hurry && bossA > 0 && nd.r < L.needR(bossA)) val *= 2; }
          if (foc) val = h > 0 ? Math.max(val, FOC_V * h) : val * FOC_JUNK;
          if (depth === 0 && bot.gullT && bot.gullT.has(i)) val = Math.max(val, 1) * 4;
        }
        let d = Math.hypot(w.ix[i] - nd.x, w.iz[i] - nd.z), blocked = false;
        if (!boss && depth === 0 && pathBlocked(w, w.ix[i], w.iz[i], i)) {
          blocked = true;
          const pl = pathLen(w, i);
          if (pl > 0) { d = penD(d, pl); blocked = false; }
        }
        const tt = d / L.speedOf(nd.r);
        let s = val / Math.pow((nd.time + tt) * v0 + 0.6, BX) * Math.pow(BG, depth);
        if (blocked) s *= 0.02;
        sc.push([s, i, tt, li, a, boss]);
      }
      sc.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
      for (let c = 0; c < sc.length && c < BC; c++) {
        const [s, i, tt, li, a, boss] = sc[c];
        const mass = nd.mass + (boss ? 0 : (li >= 0 ? K_ING : w.ik[i]) * a * a);
        const r = Math.min(P.cap, Math.max(nd.r, Math.sqrt(P.r0 * P.r0 + G * mass)));
        const need = nd.need.slice(); if (li >= 0) need[li]--;
        next.push({ x: w.ix[i], z: w.iz[i], mass, r, time: nd.time + tt, score: nd.score + s, eaten: nd.eaten.concat(i), need });
      }
    }
    if (!next.length) break;
    next.sort((p, q) => q.score - p.score || p.eaten[0] - q.eaten[0]);
    beam = next.slice(0, BW);
    best = beam[0];
  }
  if (best && bot.target >= 0 && best.eaten[0] !== bot.target && L.edible(w, bot.target)) {
    const keep = beam.find(nd => nd.eaten[0] === bot.target);
    if (keep && keep.score * BH >= best.score) return keep.eaten;
    // DECISION (Wed pm, L4 flip-flop): P.hold (expert, s) = no switching BACK to the previous target for hold s after
    // a switch. Twin targets (the two coolers behind the L4 pen) pushed each other out of the beam's top 6 in turn,
    // so the keep test above never saw the current one and the expert switched every 0.25-0.5 s for 3 s, then gave
    // both up. (Re-planning with the current target forced first fixed L4 but lost 4 s on L8: the forced beam's
    // score is not comparable with the pruned one.) Expert median, 10 seeds: L4 41.9 -> 40.8 s (max 44.8 -> 41.4),
    // L8 45.1 -> 42.2, L10 36.9 -> 35.8, L34 66.9 -> 57.7. The planner (gate 3a reference) and the director are unchanged.
    if (bot.P.hold > 0 && best.eaten[0] === bot.prevTgt && bot.t - bot.targetT < bot.P.hold) {
      return [bot.target].concat(best.eaten.filter(i => i !== bot.target));
    }
  }
  return best ? best.eaten : [];
}

// ------------------------------------------------------------------ decide
function pickTarget(bot, w) {
  const P = bot.P, R = bot.rand;
  if (P.plan) {
    const seq = P.roll ? plan(bot, w) : planBeam(bot, w);
    bot.plan = seq;
    return seq.length ? seq[0] : -1;
  }
  // DECISION (Wed pm): memo (casual) = target memory: a still-edible, unbanned current target stays in the scored list
  // when it drops out of sight (a player remembers what they were going for), so sight changes alone never flip it.
  const cur = bot.target, cl = candidates(bot, w);
  if (P.memo && P.precise && cur >= 0 && cur !== bot.skip && L.edible(w, cur) && !(bot.ban[cur] > bot.t) && !cl.includes(cur)) cl.push(cur);
  const sc = scoreList(bot, w, cl);
  if (!sc.length) return -1;
  // DECISION: human-like bots (casual/average/expert) commit: on a re-decide they keep a still-edible target unless
  // the best one scores 1.3× more; the 2nd-best roll (P.second) only applies when they pick a new target.
  // greedy keeps the proto rule (hysteresis only within KEEP_T).
  if (P.precise && cur >= 0 && L.edible(w, cur) && cur !== bot.skip) {
    const cs = sc.find(p => p[1] === cur);
    if (cs && cs[0] * 1.3 > sc[0][0]) return cur;
  }
  let pick = sc[0][1];
  if (P.second > 0 && sc.length > 1 && R() < P.second) pick = sc[1][1];
  // keep the current target for KEEP_T unless it is gone or clearly beaten
  if (cur >= 0 && cur !== pick && L.edible(w, cur) && bot.t - bot.targetT < KEEP_T) {
    const cs = sc.find(p => p[1] === cur);
    if (cs && cs[0] * 1.3 > sc[0][0]) pick = cur;
  }
  return pick;
}

/**
 * Where the pot will be when a command decided now lands: pos + the moves already queued (lag bots).
 * DECISION: a bot with reaction lag steers from that predicted spot (a player reads the pot's momentum and
 * leads it); the queue holds exactly the commands the pot will run before this one, so the prediction is
 * pos + Σ vMax(r)·m·dir·DT over the queue. Without it a lagged bot orbits small targets.
 */
function predict(bot, w) {
  const P = w.pot, q = bot.queue;
  if (!(bot.P.lag > 0) || !q.length) return { x: P.x, z: P.z };
  const v = L.speedOf(P.r) * DT;
  let x = P.x, z = P.z;
  for (let k = 0; k < q.length; k++) {
    const c = q[k][1];
    if (!(c.m > 0)) continue;
    const l = Math.hypot(c.x, c.z) || 1;
    x += v * c.m * c.x / l; z += v * c.m * c.z / l;
  }
  return { x, z };
}

/** Steering toward (tx, tz) from the predicted pot spot, with lateral push around solid blockers ahead. */
function steer(bot, w, tx, tz, target) {
  const P = w.pot, pr = predict(bot, w);
  const px = pr.x, pz = pr.z;
  let dx = tx - px, dz = tz - pz;
  const d = Math.hypot(dx, dz) || 1e-6;
  dx /= d; dz /= d;
  let near = false;
  if (bot.sideOn) {
    let sx = 0, sz = 0;
    const half = 0.5 * P.r;
    for (let j = 0; j < w.n; j++) {
      if (j === target || w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
      const ex = w.ix[j] - px, ez = w.iz[j] - pz;
      const ahead = ex * dx + ez * dz;
      if (ahead <= 0 || ahead > d + w._.a[j]) continue;
      const reach = w._.a[j] + half + 0.9;
      const lat = ex * -dz + ez * dx;                 // signed lateral offset of the blocker
      const od = Math.abs(lat);
      if (od >= reach || ahead > reach + 1.2) continue;
      const k = (1 - od / reach) * 2.2 * (1 - ahead / (reach + 1.2 + 1e-6));
      const sgn = lat > 0 ? -1 : lat < 0 ? 1 : (j & 1 ? 1 : -1);
      sx += -dz * sgn * k; sz += dx * sgn * k;
      if (ahead < w._.a[j] + half + 0.5 && od < w._.a[j] + half + 0.3) near = true;
    }
    dx += sx; dz += sz;
    const l = Math.hypot(dx, dz) || 1e-6; dx /= l; dz /= l;
  }
  return { x: dx, z: dz, near: near && d < 1.5 };
}

// ------------------------------------------------------------------ twist helpers (movers, belts, stacks)
/** Ground velocity [vx, vz, lane|null] of a moving item (roller, belt item, driving truck), or null. */
function velOf(w, i) {
  const _ = w._, m = _.mover[i];
  if (!m) return null;
  if (m === 1) {
    const ln = w.lanes[_.rollLane[i]];
    if (!ln) return null;
    const dx = ln.bx - ln.ax, dz = ln.bz - ln.az, l = Math.hypot(dx, dz) || 1;
    return [dx / l * ln.v, dz / l * ln.v, ln];
  }
  if (m === 2) {
    const k = _.beltOf[i], b = w.belts[k], d = L.beltDir(w, k);
    return b && d ? [d[0] * b.v, d[1] * b.v, null] : null;
  }
  if (m === 3) {
    const T = w.truck, p = _.path;
    if (T.stop || w.st[i] !== 0 || !p || p.length < 2) return [0, 0, null];
    const a = p[T.seg], q = p[(T.seg + 1) % p.length], dx = q.x - a.x, dz = q.z - a.z, l = Math.hypot(dx, dz) || 1;
    return [dx / l * _.truckV, dz / l * _.truckV, null];
  }
  return null;
}
/**
 * DECISION (Wed, movers): bots lead moving targets (rollers on lanes, belt items, the driving truck): they aim at
 * pos + vel * t, t = dist / vMax iterated twice (cap 3 s); a roller's lead stops at its lane end.
 */
function leadOf(w, i, px, pz) {
  const vv = velOf(w, i);
  let x = w.ix[i], z = w.iz[i];
  if (!vv || (!vv[0] && !vv[1])) return { x, z };
  const sp = L.speedOf(w.pot.r);
  for (let k = 0; k < 2; k++) {
    const t = Math.min(3, Math.hypot(x - px, z - pz) / sp);
    x = w.ix[i] + vv[0] * t; z = w.iz[i] + vv[1] * t;
  }
  const ln = vv[2];
  if (ln) {
    const dx = ln.bx - ln.ax, dz = ln.bz - ln.az, l2 = dx * dx + dz * dz || 1;
    if (((x - ln.ax) * dx + (z - ln.az) * dz) / l2 > 1) { x = ln.bx; z = ln.bz; }
  }
  return { x, z };
}
/**
 * DECISION (Wed, belts): bots ride belts: on a belt the command c (|c| = 1) is solved so that vMax*m*c + vBelt
 * points along the wanted direction, so a belt going their way speeds them up and they cross one in a straight line.
 */
function beltComp(w, x, z, m) {
  if (!w.belts.length) return null;
  const P = w.pot, k = L.beltAt(w, P.x, P.z);
  if (k < 0) return null;
  const d = L.beltDir(w, k), bx = d[0] * w.belts[k].v, bz = d[1] * w.belts[k].v, v = L.speedOf(P.r) * m;
  const l = Math.hypot(x, z);
  if (!(l > 1e-9) || !(v > 1e-9)) return null;
  const ux = x / l, uz = z / l, db = ux * bx + uz * bz, disc = db * db - (bx * bx + bz * bz) + v * v;
  if (disc <= 0) return null;
  const lam = db + Math.sqrt(disc);
  return { x: (lam * ux - bx) / v, z: (lam * uz - bz) / v };
}
/**
 * DECISION (Wed, fragile D22): bots slow down near an intact fragile stack the pot cannot swallow yet: when the gap
 * to it is < 1.6 u and the pot is heading at it, speed is capped at 0.8 u/s (below WOBBLE_V, gap < 0.6) or 1.7 u/s
 * (below CRACK_V). casual only does it on decisions where it sidesteps (its 50 % "bumps blockers" roll), so it
 * still cracks a stack now and then like a player.
 */
function stackCap(w, x, z) {
  const P = w.pot, A = w._.a, lost = w._.stackLost, l = Math.hypot(x, z);
  if (!(l > 1e-9)) return Infinity;
  let cap = Infinity;
  for (let j = 0; j < w.n; j++) {
    if (!(w.flags[j] & L.F.FRAGILE) || lost[j] || w.st[j] !== 0 || L.canFit(P.rEff, A[j])) continue;
    const ex = w.ix[j] - P.x, ez = w.iz[j] - P.z, d = Math.hypot(ex, ez) || 1e-6;
    const gap = d - A[j] - 0.5 * P.r;
    if (gap > 1.6) continue;
    const toward = Math.max((x * ex + z * ez) / (l * d), (P.vx * ex + P.vz * ez) / ((Math.hypot(P.vx, P.vz) || 1e9) * d));
    if (toward < 0.2) continue;
    const c = gap < 0.6 ? WOBBLE_V * 0.9 : CRACK_V * 0.85;
    if (c < cap) cap = c;
  }
  return cap;
}

export function decide(bot, w, dt = DT) {
  const P = bot.P, R = bot.rand, pot = w.pot;
  bot.w = w;
  bot.t += dt;
  const t = bot.t;
  if (w.result) { bot.out = { x: 0, z: 0, m: 0 }; return bot.out; }
  if (t <= P.idle + 1e-9) { bot.out = { x: 0, z: 0, m: 0 }; return bot.out; }
  bot.foc = focusOf(bot, w);
  bot.gullT = gullTargets(w);
  // stuck detection: barely moved for STUCK_T while pushing → ban target, escape sideways
  if (t - bot.stuckT >= STUCK_T) {
    const moved = Math.hypot(pot.x - bot.stuckX, pot.z - bot.stuckZ);
    if (bot.target >= 0 && moved < 0.08 * L.speedOf(pot.r) * STUCK_T && bot.escapeT <= 0) {
      bot.ban[bot.target] = t + BAN_T; bot.escapeT = ESCAPE_T; bot.escapeSign = R() < 0.5 ? -1 : 1; bot.target = -1; bot.nextDecide = 0;
    }
    bot.stuckX = pot.x; bot.stuckZ = pot.z; bot.stuckT = t;
  }
  // DECISION: lagged non-planner bots read ahead like players: targets are scored from the predicted spot, and once
  // the pot will already have swallowed the target when a new command lands (predicted spot within rEff − 0.25·a)
  // they pick the next one now (the current one is skipped until eaten, at most lag + 0.3 s).
  const pr = predict(bot, w);
  bot.ox = pr.x; bot.oz = pr.z;
  if (bot.skip >= 0 && (!L.edible(w, bot.skip) || t > bot.skipT)) bot.skip = -1;
  if (P.lag > 0 && !P.plan && !P.noskip && bot.target >= 0 && L.edible(w, bot.target) && !(w.flags[bot.target] & L.F.BOSS)) {
    const a = w._.a[bot.target], lim = pot.rEff - 0.25 * a, dx = w.ix[bot.target] - pr.x, dz = w.iz[bot.target] - pr.z;
    if (lim > 0 && dx * dx + dz * dz < lim * lim) { bot.skip = bot.target; bot.skipT = t + P.lag + 0.3; bot.target = -1; bot.nextDecide = 0; }
  }
  if (t >= bot.nextDecide - 1e-9 || (bot.target >= 0 && !L.edible(w, bot.target))) {
    bot.nextDecide = t + P.every;
    const nt = pickTarget(bot, w);
    if (nt !== bot.target) { bot.prevTgt = bot.target; bot.target = nt; bot.targetT = t; }
    bot.sideOn = P.side >= 1 || R() < P.side;
  }
  let want, aim = bot.target;
  // DECISION: planners with reaction lag (expert) anticipate: when the target will already be swallowed by the
  // time the command lands, they steer at the next item of the plan.
  if (aim >= 0 && P.plan && P.lag > 0 && bot.plan.length > 1) {
    const pr = predict(bot, w), px = pr.x, pz = pr.z, a = w._.a[aim];
    const lim = (w.flags[aim] & L.F.BOSS ? pot.r : pot.rEff) - 0.25 * a;
    const nx = bot.plan[1];
    if (lim > 0 && (w.ix[aim] - px) ** 2 + (w.iz[aim] - pz) ** 2 < lim * lim && nx >= 0 && w.st[nx] === 0) aim = nx;
  }
  if (aim < 0) { const b = L.curBoss(w); if (b >= 0 && L.edible(w, b)) aim = b; }
  // DECISION (Wed, cake): between tiers (the 0.6 s reopen) a bot whose pot fits the next tier stays on the cake.
  {
    const b = L.curBoss(w), tk = w.tickets[w.ti];
    if (b >= 0 && b === w.cake.i && tk && tk.open && w._.cakeCd > 0 && L.canFit(pot.r, w._.a[b])) aim = b;
  }
  // director: follow level.recordPath waypoints (when present) unless the target is close
  const rp = P.turn > 0 && w.level && w.level.recordPath;
  let wpAim = null;
  if (rp && bot.wp < rp.length) {
    const q = rp[bot.wp];
    if (Math.hypot(q.x - pot.x, q.z - pot.z) < pot.r + 0.6) bot.wp++;
    else if (!(aim >= 0 && Math.hypot(w.ix[aim] - pot.x, w.iz[aim] - pot.z) < 2)) wpAim = q;
  }
  if (wpAim) {
    want = steer(bot, w, wpAim.x, wpAim.z, -1);
  } else if (aim >= 0) {
    const ld = leadOf(w, aim, pot.x, pot.z);
    let tx = ld.x, tz = ld.z;
    if (bot.sideOn && pathBlocked(w, tx, tz, aim)) {
      const wp = routeTo(bot, w, aim, tx, tz);
      if (wp) { tx = wp.x; tz = wp.z; }
      else if (!(w.flags[aim] & L.F.BOSS) && aim === bot.target) { bot.ban[aim] = t + 3; bot.target = -1; bot.nextDecide = 0; }
    }
    want = steer(bot, w, tx, tz, aim);
  } else {
    const b = L.curBoss(w);
    want = b >= 0 ? steer(bot, w, w.ix[b], w.iz[b], b) : { x: -pot.x, z: -pot.z, near: false };
  }
  let x = want.x, z = want.z;
  {
    const bc = beltComp(w, x, z, P.m);
    if (bc) { x = bc.x; z = bc.z; }
  }
  if (bot.escapeT > 0) {
    bot.escapeT -= dt;
    const c = Math.cos(0.9 * bot.escapeSign), s = Math.sin(0.9 * bot.escapeSign);
    const ex = -x, ez = -z;                       // back off and turn ±0.9 rad
    x = ex * c - ez * s; z = ex * s + ez * c;
  }
  // heading noise (Ornstein–Uhlenbeck). DECISION (Wed): the GDD's σ is read in the standard SDE form
  // dX = −θ·X·dt + σ·dW (σ = the diffusion), so the stationary heading error is σ/√(2θ): casual 10.2°, average 6.1°,
  // expert 2.4°. Tuesday used σ as the stationary error (25° casual), which alone made casual 10–18 % slower than
  // the same bot without noise and 17–35 % with the 0.30 s lag (it kept missing small targets and circling back).
  if (P.sigma > 0) {
    bot.noise += -P.theta * bot.noise * dt + P.sigma * Math.sqrt(dt) * gauss(R);
    const c = Math.cos(bot.noise), s = Math.sin(bot.noise);
    const nx = x * c - z * s, nz = x * s + z * c; x = nx; z = nz;
  }
  // director: turn-rate limit (smooth camera path)
  if (P.turn > 0) {
    const ox = bot.dir.x, oz = bot.dir.z, lo = Math.hypot(ox, oz), ln = Math.hypot(x, z);
    if (lo > 1e-6 && ln > 1e-6) {
      const c = (ox * x + oz * z) / (lo * ln), mx = P.turn * dt;
      if (c < Math.cos(mx)) {
        const sg = ox * z - oz * x >= 0 ? 1 : -1, cs = Math.cos(mx), sn = Math.sin(mx) * sg;
        x = (ox * cs - oz * sn) / lo; z = (ox * sn + oz * cs) / lo;
      }
    }
  }
  let m = want.near && P.precise ? Math.min(P.m, 0.4) : P.m;
  if (bot.sideOn) {
    const cap = stackCap(w, x, z);
    if (cap < Infinity) { const v = L.speedOf(pot.r); if (m * v > cap) m = cap / v; }
  }
  const cmd = { x, z, m: Math.hypot(x, z) > 1e-6 ? m : 0 };
  bot.dir = { x, z };
  // reaction lag: output the command decided `lag` seconds ago
  if (P.lag > 0) {
    bot.queue.push([t, cmd]);
    let out = null;
    while (bot.queue.length && bot.queue[0][0] <= t - P.lag + 1e-9) out = bot.queue.shift()[1];
    if (out) bot.out = out;
    else if (!bot.out) bot.out = { x: 0, z: 0, m: 0 };
    return bot.out;
  }
  bot.out = cmd;
  return cmd;
}

/** Screen-space unit direction of the bot's last command (screen x = world x, screen y = world z). */
export function screenDir(bot) {
  const o = bot && bot.out;
  if (!o || !(o.m > 0)) return null;
  const l = Math.hypot(o.x, o.z);
  return l > 1e-6 ? { dx: o.x / l, dy: o.z / l } : null;
}

// ------------------------------------------------------------------ runLevel
/**
 * Plays one attempt headless. maxT caps game time (default T + 30). Returns
 * {win, why, tUsed, tLeft, stars, progress, nearMiss, nearMissKind, chainBest, tEnd, inputs?}.
 * DECISION: tUsed = clock time from the first input to the final bite (or to the end); tEnd = w.t at the
 * result (replay check); nearMiss = the fail met the SO CLOSE rule (nearMissShare), nearMissKind =
 * 'close' | 'almost' | null.
 */
export function runLevel(level, kind = 'greedy', seed = 1, { maxT, record = false, noiseDeg = 0, boosters = {}, P = null } = {}) {
  const w = L.createWorld(level, { mode: 'level', boosters });
  const bot = createBot(kind, seed, { noiseDeg, P });
  const cap = maxT || ((level.T || 120) * 1.1 + 30);
  const inputs = record ? [] : null;
  let chainBest = 0;
  const steps = Math.ceil(cap / DT);
  for (let s = 0; s < steps && !w.result; s++) {
    const inp = decide(bot, w, DT);
    const ci = { x: inp.x, z: inp.z, m: inp.m };
    if (inputs) inputs.push(ci);
    L.step(w, ci, DT);
    for (const e of w.events) if (e.type === 'win' || e.type === 'fail') chainBest = e.chainBest || w.chain.best;
    w.events.length = 0;
  }
  const win = w.result === 'win';
  const res = {
    win, why: w.result || 'maxT', tUsed: w.tStart === null ? 0 : (w._.biteT >= 0 ? w._.biteT : w.t) - w.tStart, tLeft: w.tLeft, stars: win ? w.stars : 0,
    progress: L.progress(w), nearMiss: !win && L.nearMiss(w) === 'close', nearMissKind: win ? null : L.nearMiss(w), chainBest: Math.max(chainBest, w.chain.best), tEnd: w.t,
  };
  if (inputs) res.inputs = inputs;
  return res;
}

export { KINDS };
