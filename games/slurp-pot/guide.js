// guide.js: where should the pot go next? Read-only on the world, no rng, so it can never move a run.
// DECISION (11-07 Sat, r3 critics): a person who steers straight at the nearest food freezes against hedges on L4, L7, L8 and
// L13 and a swing set on L11, and the grandparent lost off-screen targets on L3, L21 and L41. So the hint is a route, not a
// line: a trail drawn through a hedge would say "push the hedge". One BFS flood from the pot over a 0.5 u grid around what is
// solid right now, then the nearest thing worth reaching BY PATH: the open boss, else an order item the pot can get at, else
// plain food to grow on. The bots keep their own router (bots.js): theirs carries tuned habits and every level was timed on it.
import * as L from './logic.js';

const RC = 0.5;
let blk = new Uint8Array(0), par = new Int32Array(0), dist = new Int32Array(0), que = new Int32Array(0);
let zLv = null, zNeed = new Float64Array(1);

/** zNeed[z] = biggest gate radius on the way from zone z to zone 0 (same reading as bots.js). */
function zoneNeeds(w) {
  const lv = w.level;
  if (zLv === lv) return zNeed;
  const zg = lv && lv.zoneGraph;
  let need = new Float64Array(1);
  if (zg && zg.nodes && zg.nodes.length) {
    const N = zg.nodes.length, up = new Int32Array(N).fill(-1), er = new Float64Array(N);
    for (const e of zg.edges || []) if (e.b >= 0 && e.b < N) { up[e.b] = e.a; er[e.b] = +e.r || 0; }
    need = new Float64Array(N);
    for (let z = 1; z < N; z++) { let m = 0, q = z; for (let g = 0; q > 0 && g < N; g++) { if (er[q] > m) m = er[q]; q = up[q]; } need[z] = m; }
  }
  zLv = lv; zNeed = need;
  return need;
}
const zoneOpen = (w, i, r) => { const z = w._.zone[i], nd = zoneNeeds(w); return !(z > 0 && z < nd.length && nd[z] > r + 1e-9); };
/** Does eating i move the current order on (itself, or an intact stack holding what the order wants)? */
function wanted(w, i) {
  const _ = w._, ref = _.lineRef, ti = w.ti, r = ref[w.kind[i]];
  if (r >= 0 && r >> 3 === ti) return true;
  const sk = _.stackK[i];
  if (sk && !_.stackLost[i]) for (let c = 0; c < sk.length; c++) { const q = ref[sk[c]]; if (q >= 0 && q >> 3 === ti) return true; }
  return false;
}
function closeCells(w, nx, nz) {
  const _ = w._, x0 = _.x0, z0 = _.z0, half = 0.5 * w.pot.r + 0.05;
  blk.fill(0, 0, nx * nz);
  for (let j = 0; j < w.n; j++) {
    if (w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const rr = _.a[j] + half, cx = w.ix[j], cz = w.iz[j];
    const i0 = Math.max(0, Math.floor((cx - rr - x0) / RC)), i1 = Math.min(nx - 1, Math.floor((cx + rr - x0) / RC));
    const k0 = Math.max(0, Math.floor((cz - rr - z0) / RC)), k1 = Math.min(nz - 1, Math.floor((cz + rr - z0) / RC));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const ex = x0 + (i + 0.5) * RC - cx, ez = z0 + (k + 0.5) * RC - cz;
      if (ex * ex + ez * ez < rr * rr) blk[k * nx + i] = 1;
    }
  }
}
function flood(s0, nx, nz) {
  const N = nx * nz;
  dist.fill(-1, 0, N);
  let qh = 0, qt = 0;
  que[qt++] = s0; dist[s0] = 0; par[s0] = s0;
  while (qh < qt) {
    const c = que[qh++], ci = c % nx, ck = (c - ci) / nx, dc = dist[c] + 1;
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const i = ci + di, k = ck + dk;
      if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
      const q = k * nx + i;
      if (dist[q] >= 0 || blk[q]) continue;
      if (di && dk && (blk[ck * nx + i] || blk[k * nx + ci])) continue;   // no corner cutting
      dist[q] = dc; par[q] = c; que[qt++] = q;
    }
  }
}
/** Best flooded cell the pot could bite item i from, or -1. Items hug walls, so the item's own cell can be closed. */
function cellFor(w, i, nx, nz) {
  const _ = w._, reach = Math.max(RC, 0.75 * w.pot.rEff), R = Math.ceil(reach / RC);
  const ci = Math.floor((w.ix[i] - _.x0) / RC), ck = Math.floor((w.iz[i] - _.z0) / RC);
  let best = -1, bd = 1 << 30;
  for (let k = ck - R; k <= ck + R; k++) for (let c = ci - R; c <= ci + R; c++) {
    if (c < 0 || k < 0 || c >= nx || k >= nz) continue;
    const q = k * nx + c, d = dist[q];
    if (d < 0 || d >= bd) continue;
    const ex = _.x0 + (c + 0.5) * RC - w.ix[i], ez = _.z0 + (k + 0.5) * RC - w.iz[i];
    if (ex * ex + ez * ez <= reach * reach + 0.5 * RC * RC) { bd = d; best = q; }
  }
  return best;
}
/** First solid item the straight line a→b runs into, or -1. The pot collides at a + 0.5 r. */
function hit(w, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9, half = 0.5 * w.pot.r;
  let best = -1, bt = 2;
  for (let j = 0; j < w.n; j++) {
    if (w.st[j] !== 0 || w.hid[j] || !(w.flags[j] & L.F.SOLID)) continue;
    const ex = w.ix[j] - ax, ez = w.iz[j] - az;
    let t = (ex * dx + ez * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ex - t * dx, pz = ez - t * dz, rr = w._.a[j] + half;
    if (px * px + pz * pz < rr * rr && t < bt) { bt = t; best = j; }
  }
  return best;
}
/**
 * The way to go, or null when there is nothing to go to.
 * { kind: 'boss' | 'need' | 'food', i, pts: [{x, z}, ...] from the pot to the target, blocked, by }.
 * 'food' means the order is out of reach for now and the pot has to grow. blocked: something solid stands on the straight
 * line to the target within 1.5 u of the pot's edge, and by is its item kind.
 */
export function guide(w) {
  if (!w || w.result) return null;
  const _ = w._, P = w.pot, x0 = _.x0, z0 = _.z0;
  const nx = Math.max(1, Math.ceil((_.x1 - x0) / RC)), nz = Math.max(1, Math.ceil((_.z1 - z0) / RC)), N = nx * nz;
  if (blk.length < N) { blk = new Uint8Array(N); par = new Int32Array(N); dist = new Int32Array(N); que = new Int32Array(N); }
  closeCells(w, nx, nz);
  const i0 = Math.min(nx - 1, Math.max(0, Math.floor((P.x - x0) / RC))), k0 = Math.min(nz - 1, Math.max(0, Math.floor((P.z - z0) / RC)));
  blk[k0 * nx + i0] = 0;
  flood(k0 * nx + i0, nx, nz);
  let kind = null, ti = -1, cell = -1, bd = 1 << 30;
  const boss = L.curBoss(w);
  if (boss >= 0 && L.edible(w, boss)) { const c = cellFor(w, boss, nx, nz); if (c >= 0) { kind = 'boss'; ti = boss; cell = c; } }
  if (!kind) for (let pass = 0; pass < 2 && !kind; pass++) {
    for (let i = 0; i < w.n; i++) {
      const s = w.st[i];
      if ((s !== 0 && s !== 3) || w.hid[i] || w.flags[i] & L.F.BOSS || !L.edible(w, i) || !zoneOpen(w, i, P.rEff)) continue;
      if (pass === 0 && !wanted(w, i)) continue;
      const c = cellFor(w, i, nx, nz);
      if (c >= 0 && dist[c] < bd) { bd = dist[c]; ti = i; cell = c; }
    }
    if (ti >= 0) kind = pass === 0 ? 'need' : 'food';
  }
  if (!kind) return null;
  const cells = [];
  for (let c = cell, g = 0; g < N; g++) { cells.push(c); if (par[c] === c) break; c = par[c]; }
  cells.reverse();
  const pts = [{ x: P.x, z: P.z }];
  // string pull: from each corner jump to the farthest cell still in straight sight
  let ax = P.x, az = P.z, k = 0;
  while (k < cells.length - 1) {
    let n = cells.length - 1;
    for (; n > k + 1; n--) {
      const c = cells[n], ci = c % nx, ck = (c - ci) / nx;
      if (hit(w, ax, az, x0 + (ci + 0.5) * RC, z0 + (ck + 0.5) * RC) < 0) break;
    }
    const c = cells[n], ci = c % nx, ck = (c - ci) / nx;
    ax = x0 + (ci + 0.5) * RC; az = z0 + (ck + 0.5) * RC;
    pts.push({ x: ax, z: az });
    k = n;
  }
  pts.push({ x: w.ix[ti], z: w.iz[ti] });
  // blocked reads the line a person would steer: pot straight at the target
  const tx = w.ix[ti], tz = w.iz[ti], dx = tx - P.x, dz = tz - P.z, d = Math.hypot(dx, dz) || 1e-9, near = Math.min(1, (P.rEff + 1.5) / d);
  const b = hit(w, P.x, P.z, P.x + dx * near, P.z + dz * near);
  return { kind, i: ti, pts, blocked: b >= 0 && b !== ti, by: b >= 0 && b !== ti && w.level.items[b] ? w.level.items[b].kind : null };
}
