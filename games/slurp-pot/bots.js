// Slurp Pot bots (GDD §5.2, §13.3). Sim role. Pure and deterministic: every bot acts only through
// inp = {x, z, m} on game time, seeded with mulberry32; it reads w and never writes it.
// Kinds: greedy, casual, average, planner, expert. director (Wednesday) falls back to expert for now.
import { DT, G, K_ING } from './consts.js';
import * as L from './logic.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DEG = Math.PI / 180;
// redecide s, second-best chance, lag s, OU sigma, OU theta (1/s), m, idle at start s, sight, sidestep chance, planner
const KINDS = {
  greedy:  { precise: false, every: 0.1,  second: 0,    lag: 0,    sigma: 0,       theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: false, look: false },
  casual:  { precise: true, every: 0.35, second: 0.2,  lag: 0.30, sigma: 25 * DEG, theta: 3, m: 0.85, idle: 1.0, sight: true,  side: 0.5, plan: false, look: false },
  average: { precise: true, every: 0.2,  second: 0.1,  lag: 0.20, sigma: 15 * DEG, theta: 3, m: 0.92, idle: 0.6, sight: false, side: 1,   plan: false, look: true },
  planner: { precise: false, every: 15 * DT, second: 0, lag: 0,    sigma: 0,       theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: true,  look: false },
  expert:  { precise: true, every: 15 * DT, second: 0, lag: 0.12, sigma: 6 * DEG,  theta: 3, m: 1,    idle: 0,   sight: false, side: 1,   plan: true,  look: false },
};

const STUCK_T = 0.5, BAN_T = 1.5, ESCAPE_T = 0.6, KEEP_T = 0.25;

/**
 * DECISION: 'director' (Wednesday) uses expert settings until it is built; bot.fallback says so.
 * opts.noiseDeg adds a fixed-sigma heading noise to any kind (verify gate: greedy + 20 seeds at ±3°).
 */
export function createBot(kind = 'greedy', seed = 1, opts = {}) {
  const k = KINDS[kind] ? kind : 'expert';
  const P = Object.assign({}, KINDS[k]);
  if (opts.noiseDeg) { P.sigma = opts.noiseDeg * DEG; }
  if (opts.P) Object.assign(P, opts.P);             // tuning overrides (sim tools only)
  return {
    kind, base: k, fallback: !KINDS[kind], P, rand: rng(seed), seed,
    t: 0, nextDecide: 0, target: -1, targetT: -9, ban: new Float32Array(256), sideOn: true,
    stuckX: 0, stuckZ: 0, stuckT: 0, escapeT: 0, escapeSign: 1, skip: -1, skipT: 0, ox: 0, oz: 0, rTgt: -1, rT: -1, rWp: null,
    noise: 0, queue: [], out: { x: 0, z: 0, m: 0 }, dir: { x: 0, z: -1 }, plan: [], planT: -9, w: null,
  };
}

function gauss(R) { const u = R() || 1e-9, v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ------------------------------------------------------------------ scoring helpers
function wantKinds(w) {
  const tk = w.tickets[w.ti];
  return tk ? tk.lines.some(l => l.got < l.need) : false;
}

/** Value of eating item i now (growth, with counted ingredients and the open boss weighted up). */
function valueOf(w, i, look) {
  const fl = w.flags[i];
  if (fl & L.F.BOSS) return L.bossState(w, i) === 'open' ? 1e3 : 0;
  const a = w._.a[i];
  if (L.lineOf(w, i) >= 0) return 3 * a * a + 0.02;
  let v = L.growthOf(w, i);
  if (look) {
    // 1-step recipe lookahead: an item whose growth lets a needed ingredient or the boss fit is worth more.
    const P = w.pot, r1 = Math.min(P.cap, Math.sqrt(P.r0 * P.r0 + G * (P.mass + v)));
    const b = L.curBoss(w);
    if (b >= 0 && w.tickets[w.ti].done && !L.canFit(P.r, w._.a[b]) && L.canFit(r1, w._.a[b])) v *= 3;
  }
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

function candidates(bot, w) {
  const P = w.pot, out = [], t = bot.t, ox = bot.ox, oz = bot.oz;
  let sight = 1e9;
  if (bot.P.sight) sight = L.SEE_R(P.r);
  for (let pass = 0; pass < 3 && !out.length; pass++) {
    const s2 = sight * sight;
    for (let i = 0; i < w.n; i++) {
      if (!L.edible(w, i) || bot.ban[i] > t || i === bot.skip) continue;
      const dx = w.ix[i] - ox, dz = w.iz[i] - oz, d2 = dx * dx + dz * dz;
      if (d2 > s2) continue;
      out.push(i);
    }
    sight = pass === 0 ? L.VIEW_R(P.r) : 1e9;
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
    const v = valueOf(w, i, bot.P.look);
    if (v <= 0) continue;
    const d = Math.hypot(w.ix[i] - bot.ox, w.iz[i] - bot.oz);
    let s = v / Math.pow(d + 0.6, 1.5);
    if (!(w.flags[i] & L.F.BOSS) && pathBlocked(w, w.ix[i], w.iz[i], i)) {
      const wp = i === bot.target && bot.sideOn ? routeTo(bot, w, i, w.ix[i], w.iz[i]) : null;
      if (wp) s = v / Math.pow(Math.hypot(wp.x - bot.ox, wp.z - bot.oz) + Math.hypot(w.ix[i] - wp.x, w.iz[i] - wp.z) + 0.6, 1.5);
      else s *= 0.02;
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
function route(w, tgt, tx, tz) {
  const _ = w._, x0 = _.x0, z0 = _.z0;
  const nx = Math.max(1, Math.ceil((_.x1 - x0) / RC)), nz = Math.max(1, Math.ceil((_.z1 - z0) / RC)), N = nx * nz;
  if (rBlk.length < N) { rBlk = new Uint8Array(N); rPar = new Int32Array(N); rQ = new Int32Array(N); }
  rBlk.fill(0, 0, N);
  const P = w.pot, half = 0.5 * P.r + 0.05;
  for (let j = 0; j < w.n; j++) {
    if (j === tgt || w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const rr = _.a[j] + half, cx = w.ix[j], cz = w.iz[j];
    let i0 = Math.floor((cx - rr - x0) / RC), i1 = Math.floor((cx + rr - x0) / RC);
    let k0 = Math.floor((cz - rr - z0) / RC), k1 = Math.floor((cz + rr - z0) / RC);
    if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= nx) i1 = nx - 1; if (k1 >= nz) k1 = nz - 1;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const ex = x0 + (i + 0.5) * RC - cx, ez = z0 + (k + 0.5) * RC - cz;
      if (ex * ex + ez * ez < rr * rr) rBlk[k * nx + i] = 1;
    }
  }
  const cell = (x, z) => {
    let i = Math.floor((x - x0) / RC), k = Math.floor((z - z0) / RC);
    if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
    if (k < 0) k = 0; else if (k >= nz) k = nz - 1;
    return k * nx + i;
  };
  const s0 = cell(P.x, P.z), g = cell(tx, tz);
  rBlk[s0] = 0; rBlk[g] = 0;
  rPar.fill(-1, 0, N);
  let qh = 0, qt = 0;
  rQ[qt++] = s0; rPar[s0] = s0;
  let found = false;
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
  const wp = route(w, tgt, tx, tz);
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
 * (13/32 layouts <= 0.88). Knobs for A/B: P.bd/bw/bc/bp/bh/bg. Does not read levels.zoneGraph yet.
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
  const hurry = w.timed && w.tStart !== null && tk && tk.done && w.tLeft < 20;
  let beam = [{ x: P.x, z: P.z, mass: P.mass, r: P.r, time: 0, score: 0, eaten: [], need: lineNeed.slice() }];
  let best = null;
  const BD = bot.P.bd || 4, BW = bot.P.bw || 6, BC = bot.P.bc || 10, BX = bot.P.bp || 1.5, BH = bot.P.bh || 1.15, BG = bot.P.bg ?? 1;
  for (let depth = 0; depth < BD; depth++) {
    const next = [];
    for (const nd of beam) {
      const done = nd.need.every(v => v <= 0);
      const sc = [];
      for (const i of pool) {
        if (nd.eaten.includes(i)) continue;
        const a = A[i], boss = !!(w.flags[i] & L.F.BOSS);
        let val, li = -1;
        if (boss) {
          if (!(depth === 0 ? L.bossState(w, i) === 'open' : done && L.canFit(nd.r, bossA))) continue;
          val = 1e3;
        } else {
          if (!L.canFit(nd.r, a)) continue;
          li = nd.need.findIndex((v, k) => v > 0 && lineKid[k] === w.kind[i]);
          if (li < 0 && depth === 0 && L.refused(w, i)) continue;
          if (li >= 0) val = 3 * a * a + 0.02;
          else { val = w.ik[i] * a * a; if (hurry && bossA > 0 && nd.r < L.needR(bossA)) val *= 2; }
        }
        const d = Math.hypot(w.ix[i] - nd.x, w.iz[i] - nd.z);
        const tt = d / L.speedOf(nd.r);
        let s = val / Math.pow((nd.time + tt) * v0 + 0.6, BX) * Math.pow(BG, depth);
        if (!boss && pathBlocked(w, w.ix[i], w.iz[i], i) && depth === 0) s *= 0.02;
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
  const sc = scoreList(bot, w, candidates(bot, w));
  if (!sc.length) return -1;
  const cur = bot.target;
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

export function decide(bot, w, dt = DT) {
  const P = bot.P, R = bot.rand, pot = w.pot;
  bot.w = w;
  bot.t += dt;
  const t = bot.t;
  if (w.result) { bot.out = { x: 0, z: 0, m: 0 }; return bot.out; }
  if (t <= P.idle + 1e-9) { bot.out = { x: 0, z: 0, m: 0 }; return bot.out; }
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
  if (P.lag > 0 && !P.plan && bot.target >= 0 && L.edible(w, bot.target) && !(w.flags[bot.target] & L.F.BOSS)) {
    const a = w._.a[bot.target], lim = pot.rEff - 0.25 * a, dx = w.ix[bot.target] - pr.x, dz = w.iz[bot.target] - pr.z;
    if (lim > 0 && dx * dx + dz * dz < lim * lim) { bot.skip = bot.target; bot.skipT = t + P.lag + 0.3; bot.target = -1; bot.nextDecide = 0; }
  }
  if (t >= bot.nextDecide - 1e-9 || (bot.target >= 0 && !L.edible(w, bot.target))) {
    bot.nextDecide = t + P.every;
    const nt = pickTarget(bot, w);
    if (nt !== bot.target) { bot.target = nt; bot.targetT = t; }
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
  if (aim >= 0) {
    let tx = w.ix[aim], tz = w.iz[aim];
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
  if (bot.escapeT > 0) {
    bot.escapeT -= dt;
    const c = Math.cos(0.9 * bot.escapeSign), s = Math.sin(0.9 * bot.escapeSign);
    const ex = -x, ez = -z;                       // back off and turn ±0.9 rad
    x = ex * c - ez * s; z = ex * s + ez * c;
  }
  // heading noise (Ornstein–Uhlenbeck)
  if (P.sigma > 0) {
    bot.noise += -P.theta * bot.noise * dt + P.sigma * Math.sqrt(2 * P.theta * dt) * gauss(R);
    const c = Math.cos(bot.noise), s = Math.sin(bot.noise);
    const nx = x * c - z * s, nz = x * s + z * c; x = nx; z = nz;
  }
  const m = want.near && P.precise ? Math.min(P.m, 0.4) : P.m;
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
