// Knot Kitty rules: geometry, puzzle build, move resolution, solver, bots. Pure logic, no DOM.
// Shared by the game (play.js), the offline generator (tools/knot-kitty/gen.mjs) and the checker.
// Extends the prototype logic.js (studio/2026-10-16/proto-knot-kitty/logic.js).
//
// DECISION: the basket's capacity is st.basket.length (initState fills it with puz.cap slots). The +1 Slot
//   booster is applied by the caller with st.basket.push(-1). The ice slot is always index puz.cap-1.
// DECISION: win = every strand removed (removed === full), even if a ball is left in the basket.
// DECISION: botStats().stars[0] holds the number of lost runs; stars[1..3] count wins by stars.
// DECISION: solver forced move = a single non-rainbow strand that winds straight onto an active spool.
//   While a rainbow strand is still on the board, free rainbow pulls are also explored at those states.
// DECISION: legalMoves returns one id per pullable group: the group's first member (the over strand).
// DECISION: casual bot never "sees" a mystery strand fit (GDD §5.2); average/expert do not count covered
//   mystery strands as known colours when they score uncovering moves.
import { ACTIVE, SPOOL_N, RAINBOW } from './consts.js';

// ------------------------------------------------------------------ rng
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ geometry (proto, unchanged)
const SAMPLES_PER_UNIT = 9;

export function strandCurve(pegs, bow = 0) {
  const pts = [];
  if (pegs.length === 2) {
    const [a, b] = pegs;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const cx = (a[0] + b[0]) / 2 - (dy / len) * bow * len, cy = (a[1] + b[1]) / 2 + (dx / len) * bow * len;
    const n = Math.max(8, Math.ceil(len * SAMPLES_PER_UNIT));
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
    }
    return pts;
  }
  const P = pegs.map(p => [p[0], p[1]]);
  const first = [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]];
  const last = [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]];
  const Q = [first, ...P, last];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(6, Math.ceil(seg * SAMPLES_PER_UNIT));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      pts.push(L(B1, B2, t1, t2));
    }
  }
  return pts;
}

export function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

export function intersect(A, sA, B, sB) {
  const out = [];
  for (let i = 0; i < A.length - 1; i++) {
    const a0 = A[i], a1 = A[i + 1];
    const minx = Math.min(a0[0], a1[0]), maxx = Math.max(a0[0], a1[0]);
    const miny = Math.min(a0[1], a1[1]), maxy = Math.max(a0[1], a1[1]);
    for (let j = 0; j < B.length - 1; j++) {
      const b0 = B[j], b1 = B[j + 1];
      if (Math.max(b0[0], b1[0]) < minx || Math.min(b0[0], b1[0]) > maxx) continue;
      if (Math.max(b0[1], b1[1]) < miny || Math.min(b0[1], b1[1]) > maxy) continue;
      const rx = a1[0] - a0[0], ry = a1[1] - a0[1], qx = b1[0] - b0[0], qy = b1[1] - b0[1];
      const den = rx * qy - ry * qx;
      if (Math.abs(den) < 1e-12) continue;
      const wx = b0[0] - a0[0], wy = b0[1] - a0[1];
      const t = (wx * qy - wy * qx) / den, u = (wx * ry - wy * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = a0[0] + rx * t, y = a0[1] + ry * t;
      if (out.some(o => Math.hypot(o.x - x, o.y - y) < 0.15)) continue;
      const cos = Math.abs(rx * qx + ry * qy) / (Math.hypot(rx, ry) * Math.hypot(qx, qy));
      out.push({ x, y, sa: sA[i] + (sA[i + 1] - sA[i]) * t, sb: sB[j] + (sB[j + 1] - sB[j]) * u, ang: (Math.acos(Math.min(1, cos)) * 180) / Math.PI });
    }
  }
  return out;
}

export function distPointSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
}
export function distPointPoly(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distPointSeg(px, py, pts[i], pts[i + 1]));
  return d;
}

export function pointAt(pts, s, at) {
  if (s <= 0) return { x: pts[0][0], y: pts[0][1], i: 0 };
  const L = at[at.length - 1];
  if (s >= L) return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], i: pts.length - 2 };
  let lo = 0, hi = at.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (at[m] <= s) lo = m; else hi = m;
  }
  const f = (s - at[lo]) / (at[hi] - at[lo] || 1);
  return { x: pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, y: pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f, i: lo };
}

// ------------------------------------------------------------------ puzzle build
const bit = i => (1 << i) >>> 0;
function popcount(x) { x >>>= 0; let c = 0; while (x) { x &= x - 1; c++; } return c; }

export function buildPuzzle(level) {
  const strands = level.strands.map((s, id) => {
    const pts = strandCurve(s.pegs, s.bow || 0);
    const o = { id, pegs: s.pegs, bow: s.bow || 0, c: s.c, d: s.d, pts, at: arcLengths(pts) };
    if (s.m) o.m = 1;
    if (s.paw) o.paw = s.paw;
    if (s.lock !== undefined && s.lock !== null) o.lock = s.lock;
    if (s.key !== undefined && s.key !== null) o.key = s.key;
    return o;
  });
  const n = strands.length;
  const crossings = [];
  const blockers = strands.map(() => []);
  const crossOf = strands.map(() => []);
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const X = intersect(strands[a].pts, strands[a].at, strands[b].pts, strands[b].at);
      for (const x of X) {
        const top = strands[a].d > strands[b].d ? a : b, under = top === a ? b : a;
        const k = crossings.length;
        crossings.push({ x: x.x, y: x.y, top, under, ang: x.ang, sTop: top === a ? x.sa : x.sb, sUnder: top === a ? x.sb : x.sa });
        if (!blockers[under].includes(top)) blockers[under].push(top);
        crossOf[a].push(k);
        crossOf[b].push(k);
      }
    }
  const blockMask = blockers.map(bs => bs.reduce((m, b) => (m | bit(b)) >>> 0, 0));
  // knots
  const group = new Array(n).fill(-1);
  for (const [a, b] of level.knots || []) { group[a] = b; group[b] = a; }
  const members = strands.map((s, id) => {
    const p = group[id];
    if (p < 0) return [id];
    return strands[id].d > strands[p].d ? [id, p] : [p, id];
  });
  const gMask = members.map(ms => ms.reduce((m, i) => (m | bit(i)) >>> 0, 0));
  const gBlock = members.map((ms, id) => (ms.reduce((m, i) => (m | blockMask[i]) >>> 0, 0) & ~gMask[id]) >>> 0);
  // locks: strand with lock k needs the strand carrying key k gone
  const keyStrand = {};
  strands.forEach((s, id) => { if (s.key !== undefined) keyStrand[s.key] = id; });
  const lockOf = strands.map(s => (s.lock !== undefined && keyStrand[s.lock] !== undefined ? keyStrand[s.lock] : -1));
  const pawN = strands.map(s => s.paw || 0);
  const gLock = members.map(ms => ms.reduce((m, i) => (lockOf[i] >= 0 ? (m | bit(lockOf[i])) >>> 0 : m), 0));
  const gPaw = members.map(ms => Math.max(...ms.map(i => pawN[i])));
  const spools = (level.queue || []).map(e => (typeof e === 'number' ? { c: e, n: SPOOL_N } : { c: e.c, n: e.n || SPOOL_N }));
  const rainbowMask = strands.reduce((m, s, i) => (s.c === RAINBOW ? (m | bit(i)) >>> 0 : m), 0);
  const ice = level.ice ? level.ice.thaw || 0 : 0;
  return {
    cols: level.cols, rows: level.rows, shape: level.shape || null, strands, crossings, blockers, blockMask, crossOf, n,
    full: n >= 32 ? 0 : (bit(n) - 1) >>> 0,
    group, members, gMask, gBlock, lockOf, gLock, pawN, gPaw, spools, queue: (level.queue || []).slice(),
    cap: level.cap, ice, rainbowMask, par: level.par ?? null,
    hasPaw: pawN.some(x => x > 0), hasLock: lockOf.some(x => x >= 0),
  };
}

// ------------------------------------------------------------------ state
export function initState(puz) {
  const st = { sc: [], sn: [], sk: [], sid: [], next: 0, basket: new Array(puz.cap).fill(-1), bt: 0, peak: 0, removed: 0, count: 0, done: 0, moves: 0, dead: false };
  for (let k = 0; k < ACTIVE; k++) {
    if (st.next < puz.spools.length) { const sp = puz.spools[st.next]; st.sc.push(sp.c); st.sk.push(sp.n); st.sid.push(st.next); st.next++; }
    else { st.sc.push(-1); st.sk.push(0); st.sid.push(-1); }
    st.sn.push(0);
  }
  return st;
}
export function cloneState(s) {
  return { sc: s.sc.slice(), sn: s.sn.slice(), sk: s.sk.slice(), sid: s.sid.slice(), next: s.next, basket: s.basket.slice(), bt: s.bt, peak: s.peak, removed: s.removed, count: s.count, done: s.done, moves: s.moves, dead: s.dead };
}

const frozen = (puz, st) => puz.ice > 0 && st.done < puz.ice;
export function effectiveCap(puz, st) { return st.basket.length - (frozen(puz, st) ? 1 : 0); }
function freeBasketSlot(puz, st) {
  const fz = frozen(puz, st) ? puz.cap - 1 : -1;
  for (let b = 0; b < st.basket.length; b++) if (st.basket[b] === -1 && b !== fz) return b;
  return -1;
}
export function groupOf(puz, id) { return puz.members[id].slice(); }

/** Active slot that takes colour c (rainbow: the fuller spool with room, ties slot 0), or -1. */
export function slotFor(st, c) {
  let best = -1;
  for (let k = 0; k < st.sc.length; k++) {
    if (st.sc[k] < 0 || st.sn[k] >= st.sk[k]) continue;
    if (c !== RAINBOW && st.sc[k] !== c) continue;
    if (best < 0 || st.sn[k] > st.sn[best]) best = k;
  }
  return best;
}

// cover-only freeness (group aware)
function uncovered(puz, removed, id) { return (puz.gBlock[id] & ~removed) === 0; }
function unlocked(puz, removed, id) { return (puz.gLock[id] & ~removed) === 0; }

/** Does pulling the group of id fit (no basket overflow)? */
function fits(puz, st, id) {
  const ms = puz.members[id];
  if (ms.length === 1) return slotFor(st, puz.strands[id].c) >= 0 || freeBasketSlot(puz, st) >= 0;
  const s2 = cloneState(st);
  doPull(puz, s2, id, null);
  return !s2.dead;
}

export function canPull(puz, st, id, opt = {}) {
  if ((st.removed >>> id) & 1) return { ok: false, why: 'removed', blockers: [] };
  const ms = puz.members[id];
  if (!opt.snip) {
    const bm = (puz.gBlock[id] & ~st.removed) >>> 0;
    if (bm) {
      const blockers = [];
      for (const m of ms) for (const b of puz.blockers[m]) if (!((st.removed >>> b) & 1) && !ms.includes(b) && !blockers.includes(b)) blockers.push(b);
      return { ok: false, why: 'covered', blockers };
    }
    const lm = (puz.gLock[id] & ~st.removed) >>> 0;
    if (lm) {
      const blockers = [];
      for (let i = 0; i < puz.n; i++) if ((lm >>> i) & 1) blockers.push(i);
      return { ok: false, why: 'locked', blockers };
    }
    if (puz.gPaw[id] > st.count) return { ok: false, why: 'paw', blockers: [] };
  }
  if (!fits(puz, st, id)) return { ok: false, why: 'full', blockers: [] };
  return { ok: true, why: null, blockers: [] };
}

/** Where each group member would go, for the press preview. */
export function destOf(puz, st, id) {
  const s2 = cloneState(st), ev = [];
  doPull(puz, s2, id, ev);
  const out = [];
  for (const e of ev) {
    if (e.t === 'wind') out.push({ id: e.id, kind: 'spool', slot: e.slot });
    else if (e.t === 'basket') out.push({ id: e.id, kind: 'basket', b: e.b });
  }
  return out;
}

function settle(puz, st, k, ev) {
  while (st.sc[k] >= 0 && st.sn[k] >= st.sk[k]) {
    ev && ev.push({ t: 'complete', slot: k, spool: st.sid[k], n: st.sk[k] });
    st.done++;
    if (puz.ice && st.done <= puz.ice) ev && ev.push({ t: 'thaw', left: puz.ice - st.done });
    if (st.next < puz.spools.length) {
      const sp = puz.spools[st.next];
      st.sc[k] = sp.c; st.sk[k] = sp.n; st.sid[k] = st.next; st.next++; st.sn[k] = 0;
      ev && ev.push({ t: 'enter', slot: k, spool: st.sid[k], c: st.sc[k], n: st.sk[k] });
      for (const want of [RAINBOW, st.sc[k]])
        for (let b = 0; b < st.basket.length && st.sn[k] < st.sk[k]; b++)
          if (st.basket[b] === want) {
            st.basket[b] = -1; st.bt--; st.sn[k]++;
            ev && ev.push({ t: 'unbasket', b, slot: k, spool: st.sid[k], k: st.sn[k] });
          }
    } else { st.sc[k] = -1; st.sk[k] = 0; st.sid[k] = -1; st.sn[k] = 0; }
  }
}

function place(puz, st, id, ev) {
  const c = puz.strands[id].c;
  st.removed = (st.removed | bit(id)) >>> 0;
  st.count++;
  const k = slotFor(st, c);
  if (k >= 0) {
    st.sn[k]++;
    ev && ev.push({ t: 'wind', id, slot: k, spool: st.sid[k], k: st.sn[k], n: st.sk[k] });
    settle(puz, st, k, ev);
  } else {
    const b = freeBasketSlot(puz, st);
    if (b < 0) { st.dead = true; ev && ev.push({ t: 'overflow', id }); return; }
    st.basket[b] = c;
    st.bt++;
    ev && ev.push({ t: 'basket', id, b });
  }
  if (st.bt > st.peak) st.peak = st.bt;
}

function doPull(puz, st, id, ev) {
  const before = st.count, removedBefore = st.removed;
  for (const m of puz.members[id]) {
    place(puz, st, m, ev);
    if (st.dead) return st;
  }
  st.moves++;
  if (ev) {
    if (puz.hasLock)
      for (let x = 0; x < puz.n; x++) {
        const y = puz.lockOf[x];
        if (y >= 0 && !((st.removed >>> x) & 1) && ((st.removed >>> y) & 1) && !((removedBefore >>> y) & 1))
          ev.push({ t: 'unlock', lock: puz.strands[y].key, id: x });
      }
    if (puz.hasPaw)
      for (let x = 0; x < puz.n; x++) {
        const N = puz.pawN[x];
        if (N && !((st.removed >>> x) & 1) && before < N) ev.push({ t: 'paw', id: x, left: Math.max(0, N - st.count) });
      }
  }
  return st;
}

/** Pull the group of id. Mutates st. Precondition: canPull ok (or opt.snip). */
export function pull(puz, st, id, ev = null, opt = {}) { return doPull(puz, st, id, ev); }

function isLeader(puz, id) { return puz.members[id][0] === id; }

export function legalMoves(puz, st) {
  const out = [];
  const rem = st.removed;
  for (let id = 0; id < puz.n; id++) {
    if ((rem >>> id) & 1) continue;
    if (!isLeader(puz, id)) continue;
    if (puz.gBlock[id] & ~rem) continue;
    if (puz.gLock[id] & ~rem) continue;
    if (puz.gPaw[id] > st.count) continue;
    if (!fits(puz, st, id)) continue;
    out.push(id);
  }
  return out;
}
export function isWon(puz, st) { return !st.dead && st.removed === puz.full; }
export function isStuck(puz, st) { return !isWon(puz, st) && legalMoves(puz, st).length === 0; }

/** Strands uncovered (group aware) by the move from a to b, not yet removed: mystery reveal + bob start. */
export function newlyFree(puz, a, b) {
  const out = [];
  for (let id = 0; id < puz.n; id++) {
    if ((b.removed >>> id) & 1) continue;
    if (!uncovered(puz, a.removed, id) && uncovered(puz, b.removed, id)) out.push(id);
  }
  return out;
}

// ------------------------------------------------------------------ solver
function sigKey(st) {
  // removed + spool/basket signature (basket as a sorted multiset; slot order kept for rainbow ties)
  let bk = '';
  const b = st.basket.filter(x => x >= 0).sort((x, y) => x - y);
  for (const x of b) bk += x;
  return st.removed + '|' + st.next + ',' + st.sid[0] + ',' + st.sn[0] + ',' + st.sid[1] + ',' + st.sn[1] + ',' + bk;
}

/** Exact DP over (removed, spool/basket signature) minimising the basket peak. Reusable memo. */
export function makeSolver(puz, limit = 600000) {
  const memo = new Map();
  const S = { memo, aborted: false, limit };
  function cands(st) {
    const legal = legalMoves(puz, st);
    let forced = -1;
    for (const id of legal) {
      if (puz.members[id].length !== 1 || puz.strands[id].c === RAINBOW) continue;
      if (slotFor(st, puz.strands[id].c) >= 0) { forced = id; break; }
    }
    if (forced < 0) return legal;
    const out = [forced];
    if (puz.rainbowMask & ~st.removed) for (const id of legal) if (id !== forced && (puz.rainbowMask >>> id) & 1) out.push(id);
    return out;
  }
  function f(st) {
    if (st.removed === puz.full) return 0;
    const key = sigKey(st);
    const hit = memo.get(key);
    if (hit) return hit[0];
    if (memo.size > S.limit) { S.aborted = true; return Infinity; }
    let best = Infinity, bm = -1;
    for (const id of cands(st)) {
      const s0 = cloneState(st); s0.peak = s0.bt; // in-move peak: a knot pair can basket one ball before a spool completes
      const s2 = doPull(puz, s0, id, null);
      if (s2.dead) continue;
      const v = Math.max(s2.peak, f(s2));
      if (v < best) { best = v; bm = id; if (best <= st.bt) break; }
    }
    memo.set(key, [best, bm]);
    return best;
  }
  S.f = f;
  S.line = start => {
    const moves = [];
    const st = cloneState(start);
    while (st.removed !== puz.full) {
      const h = memo.get(sigKey(st));
      if (!h || h[1] < 0) return null;
      moves.push(h[1]);
      doPull(puz, st, h[1], null);
    }
    return moves;
  };
  return S;
}

export function solve(puz, st0 = null, limit = 600000) {
  const start = st0 ? cloneState(st0) : initState(puz);
  const S = makeSolver(puz, limit);
  const v = S.f(start);
  if (!S.aborted) {
    if (v === Infinity) return { peak: Infinity, moves: null, states: S.memo.size, exact: true };
    return { peak: Math.max(start.peak, v), moves: S.line(start), states: S.memo.size, exact: true };
  }
  const b = beam(puz, start, 3000);
  return b ? { ...b, states: S.memo.size, exact: false } : { peak: Infinity, moves: null, states: S.memo.size, exact: false };
}

export function beam(puz, start, width) {
  let layer = [{ st: cloneState(start), path: [] }];
  while (layer.length) {
    if (layer[0].st.removed === puz.full) return { peak: layer[0].st.peak, moves: layer[0].path };
    const next = new Map();
    for (const node of layer) {
      for (const id of legalMoves(puz, node.st)) {
        const s2 = doPull(puz, cloneState(node.st), id, null);
        if (s2.dead) continue;
        const k = sigKey(s2);
        const old = next.get(k);
        if (!old || s2.peak < old.st.peak || (s2.peak === old.st.peak && s2.bt < old.st.bt)) next.set(k, { st: s2, path: node.path.concat(id) });
      }
    }
    layer = [...next.values()].sort((a, b) => a.st.peak - b.st.peak || a.st.bt - b.st.bt || b.st.count - a.st.count).slice(0, width);
  }
  return null;
}

export function hintMove(puz, st, limit = 150000) {
  if (st.removed === puz.full) return -1;
  const r = solve(puz, st, limit);
  if (r.peak === Infinity || !r.moves || !r.moves.length) return -1;
  return r.moves[0];
}

// ------------------------------------------------------------------ bots
function fitsSpool(puz, st, id) {
  const c = puz.strands[id].c;
  return slotFor(st, c) >= 0;
}
function lookScore(puz, st, id, legalSet, r, wantCols) {
  const rem = (st.removed | puz.gMask[id]) >>> 0;
  let score = 0;
  for (let j = 0; j < puz.n; j++) {
    if ((rem >>> j) & 1) continue;
    if (legalSet.has(j) || !uncovered(puz, rem, j) || uncovered(puz, st.removed, j)) continue;
    const s = puz.strands[j];
    const known = !s.m; // covered mystery strands: colour unknown before the move
    if (known && (wantCols.has(s.c) || s.c === RAINBOW)) score += 2;
    score += 0.5;
  }
  const c = puz.strands[id].c;
  if (st.basket.includes(c)) score += 0.4;
  return score + r() * 0.3;
}

export function botRun(puz, kind, r) {
  const st = initState(puz);
  while (st.removed !== puz.full) {
    const legal = legalMoves(puz, st);
    if (!legal.length) break;
    let pick = -1;
    if (kind === 'random') pick = legal[(r() * legal.length) | 0];
    else if (kind === 'casual') {
      const fit = legal.filter(id => !puz.strands[id].m && fitsSpool(puz, st, id));
      if (fit.length && r() < 0.85) pick = fit[(r() * fit.length) | 0];
      else pick = legal[(r() * legal.length) | 0];
    } else if (kind === 'average') {
      const fit = legal.filter(id => fitsSpool(puz, st, id));
      if (fit.length) {
        // prefer the fuller spool's colour
        let best = -1, bs = -1;
        for (const id of fit) { const k = slotFor(st, puz.strands[id].c); const s = st.sn[k] + r() * 0.5; if (s > bs) { bs = s; best = id; } }
        pick = best;
      } else {
        const nc = st.next < puz.spools.length ? puz.spools[st.next].c : -2;
        const a = legal.filter(id => puz.strands[id].c === nc);
        const b = legal.filter(id => st.basket.includes(puz.strands[id].c));
        const pool = a.length ? a : b.length ? b : legal;
        pick = pool[(r() * pool.length) | 0];
      }
    } else if (kind === 'fit') {
      // fit-first (the critic's policy, fix2): a free strand that winds onto an active spool, else one whose colour
      //   is already in the basket, else any free strand; ties at random. No look-ahead at NEXT.
      const a = legal.filter(id => fitsSpool(puz, st, id));
      const b = a.length ? a : legal.filter(id => st.basket.includes(puz.strands[id].c));
      const pool = b.length ? b : legal;
      pick = pool[(r() * pool.length) | 0];
    } else {
      // expert: look bot + 1-ply safety
      const safe = legal.filter(id => { const s2 = doPull(puz, cloneState(st), id, null); return !s2.dead && (s2.removed === puz.full || legalMoves(puz, s2).length > 0); });
      const pool = safe.length ? safe : legal;
      const fit = pool.filter(id => puz.members[id].length === 1 && puz.strands[id].c !== RAINBOW && fitsSpool(puz, st, id));
      if (fit.length) pick = fit[(r() * fit.length) | 0];
      else {
        const want = new Set(st.sc.filter(c => c >= 0));
        for (let q = st.next; q < Math.min(puz.spools.length, st.next + 2); q++) want.add(puz.spools[q].c);
        const legalSet = new Set(legal);
        let best = -Infinity;
        for (const id of pool) {
          let s = lookScore(puz, st, id, legalSet, r, want);
          if (puz.strands[id].c === RAINBOW && fitsSpool(puz, st, id)) s += 1;
          if (s > best) { best = s; pick = id; }
        }
      }
    }
    doPull(puz, st, pick, null);
    if (st.dead) break;
  }
  return { win: isWon(puz, st), peak: st.peak, moves: st.moves };
}

export function starsFor(peak, par) {
  if (peak <= par) return 3;
  if (peak <= par + 1) return 2;
  return 1;
}

export function botStats(puz, kind, runs = 300, seed = 99) {
  const r = rng(seed);
  let wins = 0, peakSum = 0;
  const stars = [0, 0, 0, 0];
  const par = puz.par ?? 0;
  for (let i = 0; i < runs; i++) {
    const o = botRun(puz, kind, r);
    if (o.win) { wins++; peakSum += o.peak; stars[starsFor(o.peak, par)]++; } else stars[0]++;
  }
  return { winRate: wins / runs, avgPeak: wins ? peakSum / wins : null, stars };
}

// ------------------------------------------------------------------ transforms (dailies / bonus)
export function transformLevel(level, { mx = false, my = false, perm = null } = {}) {
  const L = JSON.parse(JSON.stringify(level));
  const fx = x => (mx ? L.cols - 1 - x : x), fy = y => (my ? L.rows - 1 - y : y);
  const flip = (mx ? 1 : 0) ^ (my ? 1 : 0);
  const pc = c => (perm && c >= 0 && c < RAINBOW ? perm[c] : c);
  for (const s of L.strands) {
    s.pegs = s.pegs.map(([x, y]) => [fx(x), fy(y)]);
    if (flip && s.bow) s.bow = -s.bow;
    s.c = pc(s.c);
  }
  L.queue = L.queue.map(e => (typeof e === 'number' ? pc(e) : { ...e, c: pc(e.c) }));
  return L;
}

export { popcount };
