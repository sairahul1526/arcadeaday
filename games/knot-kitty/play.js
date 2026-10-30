// play.js: one level session. Rule state (rules.js) resolves instantly, visuals lag behind it (GDD §3.3–3.7, §13.4).
// Owner: Core. Only game.js imports this file.
//
// DECISION: play.js imports render.buildGeo (sess.geo is "render.buildGeo" output per §13.4). render.js never imports
//   play.js, so the import graph stays acyclic.
// DECISION: daily id = IST date key ('YYYY-MM-DD', default today); bonus id = bonus index (default meta.bonusNext()).
// DECISION: extra sess fields beyond §13.4 (all read-only for other roles):
//   par, dateKey, visNext (queue index of the first spool not yet on the rack), moreN (the "+N" chip count),
//   spoolVis (Map queue index → Spool), flash (Map id → t0: blocker white rim, 0.3 s), basketShake (t0 or -1),
//   iceLeft (frozen slot thaw counter as shown), snipFx [{id, t0}], slotUsed, lastTapT, stuckT, doomCheck,
//   chainLog/jumboLog (for recordWin; trimmed by Undo), rng (seeded particles), lose (true once 'lose' was returned).
//   Spool also carries { done, enterT, thaw }. slots[k] also carries pend: [Spool] (spools waiting to roll in).
//   Flights also carry { path: {pts, at, Ls, Ltot} (CSS px, head end last), tgt: {x, y}, lift }. Ball flights carry
//   { b, from: {x, y}, wait } and dest {kind:'spool', slot, spool}. Strand flight dest = {kind:'spool', slot, spool} |
//   {kind:'basket', b}. f.p = eased-free progress 0..1 (render applies ease p·p·(1.6−0.6p) like the proto).
//   Rings carry k (crossing index) so a resize can re-place them. Particles carry r and vr; c = yarn index or -1 (cream/gold).
//   unlockFx / pawFx entries: { id, t0, kind } with kind 'jiggle' | 'open' (lock) and 'twitch' | 'wake' (paw).
// DECISION: nextQ holds at most the 2 visible upcoming spools; the rest is sess.moreN.
// DECISION: events that describe something arriving (wind, basket, chain, spoolDone, spoolEnter, thaw) fire on
//   visual arrival so audio matches the picture; pull / unlock / paw / reveal fire on the tap. pull also carries dur.
// DECISION: taps are queued (sess.queue, FIFO, max QUEUE_MAX) while spoolBusy, which also covers a spool that is full
//   in the rules but still waiting for its last strand to land (it is about to roll off). A tap is queued when it is
//   legal at its turn, i.e. after the taps already queued (checked on a scratch copy of the rule state), so a burst
//   A then B (B under A) is kept. Queued ids are mirrored in S.pending (Set) for render's pending pulse, and
//   sess.buffered = queue[0] ?? null stays for older readers (modes.sessFree). The queue drains one tap per
//   QUEUE_GAP s once nothing is busy; a queued tap that is no longer legal gets the normal blocked feedback.
// DECISION: combo = spools completed back to back (a pull that completes no spool resets it). Each completed spool
//   remembers the combo it reached; 'spoolDone' {i, combo} and 'chain' {n, combo} carry it at visual arrival.
//   'chain' fires on every ball that lands on a spool (n = balls that spool has absorbed so far, ≥ 1; m = n kept for
//   older listeners). combo ≥ 2 calls render.shake / render.hitStop when RENDER provides them.
// DECISION (polish): combo bonus yarn (contract: bus 'bonus' {amt, combo}, sess.bonusYarn). A spool completed at
//   combo 2 / 3 / ≥4 earns +1 / +2 / +3 (comboAmt), limited per attempt by meta.comboCap(kind, id) (8, or 1 on a 3★
//   level replay, 0 on a claimed daily / replayed tangle). The amount is decided in the rules step (doPull) and kept in
//   sess.bonusLog [{mv, amt}] (sess.bonusDue = its sum, trimmed by Undo like chainLog). 'bonus' {amt, combo, total, i,
//   slot, c} fires with that spool's 'spoolDone' at visual arrival and adds amt to sess.bonusYarn (the HUD total; never
//   above bonusDue, and Undo sets it to bonusDue). win() hands bonusDue to meta.recordWin as `combo`, which credits it
//   once with the base payout; sess.result.bonus = the credited amount (< bonusDue only on a replay that adds no
//   stars). A lost or restarted attempt never calls recordWin, so its bonus is never paid.
// DECISION: canUseBooster(S, key) → {ok, reason} is the single check; applyBooster calls it first and returns false
//   with no side effects (no charge, no state change, no events) when it says no.
// DECISION: a press on a covered/locked/pawed strand shows the blocker rings right away (§3.6); the release then adds
//   the wiggle, flinch and 'blocked' event (§3.3) unless the hold became a peek (≥ 0.35 s), which does nothing.
// DECISION: Snip arms on the booster tap and is consumed (meta.useBooster) only when a snipped pull happens.
// DECISION: Hint runs hintMove first (cached per rule state); −1 (doomed) makes canUseBooster refuse, so nothing is
//   consumed. game.js turns a refused Hint into hint {id:-1} (pulses Undo) for the keyboard path.
// DECISION: the doomed check runs once flights have landed (or 0.8 s after the pull), so its main-thread cost never
//   lands mid-flight. It is solve(puz, st, 40000)'s exact DP (rules.makeSolver) without solve's beam fallback, since
//   only an exact "no win" may pulse Undo and the beam can cost far more than the 40000-state budget.
// DECISION: the win is recorded (meta.recordWin) the frame it is detected; the kitten is freed once no strand is
//   still flying; update() returns 'win' DUR.kittenFree later. Stuck returns 'lose' when flights land or after
//   DUR.stuckCard. game.js performs the screen change.
// DECISION: Undo restores the previous rule state with peak = max(old, current) (Undo never lowers peak), keeps a
//   +1 Slot basket length, and snaps every visual (flights cleared, spools/basket rebuilt from the state).
// DECISION: lifted = un-pulled strands that nothing covers (locked/pawed strands on top still look lifted).
// DECISION: bakeKey = removed|lifted|WxH|dpr|wiggling ids (the bake must change when the wiggle set changes, §7.3).

import P from '../shared/platform.js';
import { ACTIVE, DUR, TAP_SLOP, PEEK_HOLD, LEVELS, bus } from './consts.js';
import * as R from './rules.js';
import * as levels from './levels.js';
import * as meta from './meta.js';
import { fitBoard, rackSlots, basketSlots } from './layout.js';
import { buildGeo } from './render.js';
import * as RN from './render.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bit = i => (1 << i) >>> 0;
const has = (mask, i) => ((mask >>> i) & 1) === 1;
const ease = p => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (1.6 - 0.6 * p));
const QUEUE_MAX = 3, QUEUE_GAP = 0.09;
/** Bonus yarn for a spool completed at this combo (back-to-back spools): ×2 → 1, ×3 → 2, ×4+ → 3. */
export const comboAmt = c => (c < 2 ? 0 : c === 2 ? 1 : c === 3 ? 2 : 3);

// ------------------------------------------------------------------ session
export function createSession(kind, id, S) {
  let level, dateKey = null;
  if (kind === 'daily') {
    dateKey = typeof id === 'string' ? id : levels.istDateKey();
    level = levels.getDaily(dateKey);
    id = dateKey;
  } else if (kind === 'bonus') {
    id = Number.isInteger(id) && id >= 0 ? id : meta.bonusNext();
    level = levels.getBonus(id);
  } else {
    kind = 'level';
    id = clamp(Math.floor(+id || 1), 1, LEVELS);
    level = levels.getLevel(id);
  }
  const puz = R.buildPuzzle(level);
  const st = R.initState(puz);
  const sess = {
    kind, id, level, puz, st, hist: [], dateKey,
    par: puz.par ?? level.par ?? 0,
    B: null, geo: [],
    slots: [], nextQ: [], visNext: st.next, moreN: 0, spoolVis: new Map(),
    basket: st.basket.map(() => null),
    flights: [], parts: [], rings: [], wiggles: new Map(), lifted: new Set(), flash: new Map(),
    press: null, buffered: null, queue: [], queueT: -9, spoolBusy: false, combo: 0,
    kitten: { stage: 0, loops: 4, flinch: 0, freeT: -1, golden: false },
    kitty: { anim: 'idle', t0: S.T },
    revealT: new Map(), unlockFx: [], pawFx: [], snipFx: [],
    stuck: false, doomed: false, capped: false, boosterArm: null, hint: null,
    result: null, shake: 0, bakeKey: '',
    basketShake: -1, iceLeft: puz.ice, slotUsed: false, lastTapT: S.T, stuckT: -1, doomCheck: null,
    chainLog: [], jumboLog: [], lose: false, winT: -1,
    bonusLog: [], bonusDue: 0, bonusYarn: 0, bonusCap: 0,
    rng: R.rng((kind === 'level' ? id : 7919) * 2654435761),
  };
  try { sess.bonusCap = typeof meta.comboCap === 'function' ? meta.comboCap(kind, id) | 0 : 0; } catch (e) { sess.bonusCap = 0; }
  for (let k = 0; k < ACTIVE; k++) sess.slots.push({ cur: null, leaving: null, leaveT: -9, enterT: -9, pend: [] });
  S.pending = new Set();
  snapVisuals(sess, S);
  // mystery strands already on top at the start show their colour from frame one
  for (let i = 0; i < puz.n; i++) if (puz.strands[i].m && sess.lifted.has(i)) sess.revealT.set(i, S.T - 1);
  onResize(S, sess);
  meta.unlockGifts(kind === 'level' ? id : 0);
  meta.recordAttempt(kind, id);
  return sess;
}

function spoolOf(sess, q) {
  let sv = sess.spoolVis.get(q);
  if (!sv) {
    const sp = sess.puz.spools[q];
    sv = { c: sp.c, n: sp.n, shown: 0, spin: 0, bounce: 0, id: q, done: false, enterT: -9, thaw: null, combo: 0, bonus: 0 };
    sess.spoolVis.set(q, sv);
  }
  return sv;
}

/** Rebuild every visual (spools, basket, queue, lift set, kitten) from the rule state. Used at start and by Undo. */
function snapVisuals(sess, S) {
  const { puz, st } = sess;
  sess.spoolVis.clear();
  for (let k = 0; k < ACTIVE; k++) {
    const s = sess.slots[k];
    s.leaving = null; s.pend.length = 0; s.leaveT = -9; s.enterT = S.T - 1;
    if (st.sid[k] >= 0) {
      const sv = spoolOf(sess, st.sid[k]);
      sv.shown = st.sn[k]; sv.enterT = S.T - 1;
      s.cur = sv;
    } else s.cur = null;
  }
  sess.visNext = st.next;
  refreshQueue(sess);
  sess.basket = st.basket.map(c => (c >= 0 ? { c, arrived: true, bounce: 0 } : null));
  sess.flights.length = 0;
  sess.iceLeft = puz.ice ? Math.max(0, puz.ice - st.done) : 0;
  refreshLift(sess);
  setKitten(sess, S, false);
  sess.spoolBusy = false;
}

function refreshQueue(sess) {
  const sp = sess.puz.spools;
  sess.nextQ = sp.slice(sess.visNext, sess.visNext + 2).map(s => ({ c: s.c, n: s.n }));
  sess.moreN = Math.max(0, sp.length - sess.visNext - 2);
}

function refreshLift(sess) {
  const { puz, st } = sess;
  sess.lifted = new Set();
  for (let i = 0; i < puz.n; i++) if (!has(st.removed, i) && !(puz.gBlock[i] & ~st.removed)) sess.lifted.add(i);
}

function setKitten(sess, S, emit) {
  const { st, puz } = sess;
  const prog = puz.n ? st.count / puz.n : 1;
  const stage = prog >= 1 ? 4 : Math.min(3, Math.floor(prog * 4));
  if (stage !== sess.kitten.stage) {
    sess.kitten.stage = stage;
    sess.kitten.loops = 4 - stage;
    if (emit) bus.emit('kittenStage', { stage });
  }
}

// ------------------------------------------------------------------ geometry helpers
function slotPoint(S, slot) {
  const a = rackSlots(S.L).active[slot] || rackSlots(S.L).active[0];
  return { x: a.x, y: a.y };
}
function basketPoint(S, sess, b) {
  const bs = basketSlots(S.L, sess.st.basket.length);
  const p = bs[b] || bs[bs.length - 1];
  return { x: p.x, y: p.y };
}
function destPoint(S, sess, dest) {
  return dest.kind === 'basket' ? basketPoint(S, sess, dest.b) : slotPoint(S, dest.slot);
}
function pegPx(B, p) { return [B.ox + p[0] * B.unit, B.oy + p[1] * B.unit]; }

/** Flight path: the strand's own polyline (head = end nearest the target, last) + a quadratic arc to the target. */
function buildFlightPath(S, sess, f) {
  const gp = sess.geo[f.id];
  const tgt = destPoint(S, sess, f.dest);
  const a = gp.pts[0], b = gp.pts[gp.pts.length - 1];
  const rev = Math.hypot(a[0] - tgt.x, a[1] - tgt.y) < Math.hypot(b[0] - tgt.x, b[1] - tgt.y);
  const pts = rev ? gp.pts.slice().reverse() : gp.pts.slice();
  const h = pts[pts.length - 1];
  const dist = Math.hypot(tgt.x - h[0], tgt.y - h[1]);
  const u = S.L.u;
  const cx = (h[0] + tgt.x) / 2, cy = Math.min(h[1], tgt.y) - dist * 0.25 - 20 * u;
  for (let k = 1; k <= 22; k++) {
    const t = k / 22, w = 1 - t;
    pts.push([w * w * h[0] + 2 * w * t * cx + t * t * tgt.x, w * w * h[1] + 2 * w * t * cy + t * t * tgt.y]);
  }
  const at = R.arcLengths(pts);
  const Ls = gp.at[gp.at.length - 1];
  f.rev = rev;
  f.tgt = tgt;
  f.path = { pts, at, Ls, Ltot: at[at.length - 1] };
  // arc positions of the pegs measured from the tail (pluck as the tail passes each)
  f.pegS = sess.puz.strands[f.id].pegs.map(p => {
    const q = pegPx(sess.B, p);
    let bi = 0, bd = Infinity;
    gp.pts.forEach((r, i) => { const d = Math.hypot(r[0] - q[0], r[1] - q[1]); if (d < bd) { bd = d; bi = i; } });
    return rev ? Ls - gp.at[bi] : gp.at[bi];
  }).sort((x, y) => x - y);
  return dist;
}

// ------------------------------------------------------------------ particles
function burst(sess, kind, x, y, n, c, S) {
  const r = sess.rng, u = S.L ? S.L.u : 1;
  for (let i = 0; i < n; i++) {
    const cc = Array.isArray(c) ? c[i % c.length] : c;
    if (kind === 'fluff') {
      const a = r() * Math.PI * 2, v = (40 + r() * 90) * u;
      sess.parts.push({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * u, t: 0, life: 0.5 + r() * 0.3, c: cc, rot: 0, vr: 0, r: (1.5 + r() * 2.5) * u });
    } else if (kind === 'conf') {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4, v = (120 + r() * 260) * u;
      sess.parts.push({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.9 + r() * 0.6, c: cc, rot: r() * 6, vr: (r() - 0.5) * 12, r: (3 + r() * 3) * u });
    } else if (kind === 'heart') {
      sess.parts.push({ kind, x: x + (r() - 0.5) * 40 * u, y, vx: (r() - 0.5) * 60 * u, vy: -(80 + r() * 120) * u, t: 0, life: 1.2 + r() * 0.6, c: -1, rot: 0, vr: 0, r: (6 + r() * 6) * u });
    } else {
      const a = r() * Math.PI * 2, v = (60 + r() * 140) * u;
      sess.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + r() * 0.3, c: cc, rot: r() * 6, vr: 0, r: (2 + r() * 2) * u });
    }
  }
  if (sess.parts.length > 260) sess.parts.splice(0, sess.parts.length - 260);
}

function haptic(S, pattern) {
  if (S.noHaptics || P.env !== 'web') return;
  try { if (meta.settings().haptics && navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

function kittyAnim(sess, S, anim) { sess.kitty.anim = anim; sess.kitty.t0 = S.T; }

/** Combo escalation (back-to-back spools): screen shake + hit-stop from RENDER's helpers, when present. */
function comboFx(S, combo) {
  if (combo < 2) return;
  const k = Math.min(combo, 6);
  try {
    if (typeof RN.shake === 'function') RN.shake(S, 2 + 1.5 * k, 0.16 + 0.03 * k);
    if (typeof RN.hitStop === 'function') RN.hitStop(S, 35 + 12 * k);
  } catch (e) { console.warn(e); }
}

// ------------------------------------------------------------------ input (§3.6, §3.7)
export function pickStrand(x, y, S) {
  const sess = S.sess;
  if (!sess || !sess.geo.length) return -1;
  const { puz, st, geo, B } = sess;
  let dmin = Infinity;
  const ds = new Array(puz.n).fill(Infinity);
  for (let i = 0; i < puz.n; i++) {
    if (has(st.removed, i) || !geo[i]) continue;
    ds[i] = R.distPointPoly(x, y, geo[i].pts);
    if (ds[i] < dmin) dmin = ds[i];
  }
  const reach = Math.max(18, 2.4 * B.sw);
  if (dmin > reach) return -1;
  const lim = Math.min(reach, dmin + 0.9 * B.sw);
  let best = -1;
  for (let i = 0; i < puz.n; i++) if (ds[i] <= lim && (best < 0 || puz.strands[i].d > puz.strands[best].d)) best = i;
  return best;
}

/** CSS px point that picks strand id, as far as possible from every other un-pulled strand (so ≥ 0.6 unit from crossings when possible). */
export function tapPointFor(id, S) {
  const sess = S.sess;
  if (!sess || !sess.geo[id]) return { x: S.W / 2, y: S.H / 2 };
  const { puz, st, geo } = sess;
  const pts = geo[id].pts, n = pts.length;
  const cand = [];
  for (let k = Math.floor(n * 0.12); k <= Math.min(n - 1, Math.ceil(n * 0.88)); k++) {
    const p = pts[k];
    let clear = Infinity;
    for (let j = 0; j < puz.n; j++) if (j !== id && !has(st.removed, j) && geo[j]) clear = Math.min(clear, R.distPointPoly(p[0], p[1], geo[j].pts));
    cand.push({ x: p[0], y: p[1], clear });
  }
  cand.sort((a, b) => b.clear - a.clear);
  for (const c of cand) if (pickStrand(c.x, c.y, S) === id) return { x: c.x, y: c.y };
  return cand.length ? { x: cand[0].x, y: cand[0].y } : { x: pts[0][0], y: pts[0][1] };
}

function canPlay(sess) { return sess && !sess.result && !sess.stuck; }

export function press(x, y, S) {
  const sess = S.sess;
  if (!canPlay(sess)) { if (sess) sess.press = null; return; }
  const id = pickStrand(x, y, S);
  sess.lastTapT = S.T;
  if (id < 0) { sess.press = { id: -1, x0: x, y0: y, t0: S.T, ok: false, why: null, dest: null }; return; }
  const r = R.canPull(sess.puz, sess.st, id, { snip: sess.boosterArm === 'snip' });
  const dest = r.ok ? R.destOf(sess.puz, sess.st, id) : null;
  sess.press = { id, x0: x, y0: y, t0: S.T, ok: r.ok, why: r.why, dest, blockers: r.blockers, peek: false };
  if (!r.ok && r.why !== 'removed' && r.why !== 'full') ringBlockers(sess, S, id, r);
  bus.emit('press', { id, ok: r.ok, why: r.why });
}

export function move(x, y, S) {
  const sess = S.sess;
  if (!sess || !sess.press) return;
  if (Math.hypot(x - sess.press.x0, y - sess.press.y0) > TAP_SLOP) sess.press = null; // slide = cancel
}

export function release(x, y, S) {
  const sess = S.sess;
  if (!sess || !sess.press) return;
  const p = sess.press;
  sess.press = null;
  if (p.id < 0 || Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) return;
  if (p.peek) return; // a peek never pulls
  commit(p.id, S, true);
}

/** A committed tap on strand id. Queued (FIFO, max QUEUE_MAX) while a spool is rolling or earlier taps wait (§3.4). */
export function commit(id, S, fromPress = false) {
  const sess = S.sess;
  if (!canPlay(sess) || id < 0 || id >= sess.puz.n) return;
  sess.lastTapT = S.T;
  if (sess.spoolBusy || sess.queue.length) {
    if (sess.queue.includes(id)) return; // a double tap on a queued strand is the same pull
    // legal at its turn = legal once the taps ahead of it have been pulled (scratch copy of the rule state)
    const snip = sess.boosterArm === 'snip' && !sess.queue.length;
    let st = sess.st;
    if (sess.queue.length) {
      st = R.cloneState(sess.st);
      for (const q of sess.queue) if (R.canPull(sess.puz, st, q, {}).ok) R.pull(sess.puz, st, q, [], {});
    }
    const r = R.canPull(sess.puz, st, id, { snip });
    if (r.ok) {
      if (sess.queue.length >= QUEUE_MAX) return;
      sess.queue.push(id);
      syncPending(sess, S);
      bus.emit('queued', { id, n: sess.queue.length });
      haptic(S, 8);
      return;
    }
    // not legal at its turn: feedback only (covered etc.), never a pull that jumps the queue
    if (r.why !== 'removed') feedback(sess, S, id, r, fromPress);
    return;
  }
  resolve(id, S, fromPress);
}

function syncPending(sess, S) {
  sess.buffered = sess.queue.length ? sess.queue[0] : null;
  if (S.sess === sess || !S.sess) S.pending = new Set(sess.queue);
}
function clearQueue(sess, S) {
  if (!sess.queue.length && !(S.pending && S.pending.size)) return;
  sess.queue.length = 0;
  syncPending(sess, S);
}
function slotsBusy(sess, T) {
  for (const s of sess.slots)
    if (s.leaving || s.pend.length || (s.cur && T - s.cur.enterT < DUR.spoolEnter) || (s.cur && s.cur.done)) return true;
  return false;
}

function ringBlockers(sess, S, id, r) {
  const { puz, st, B } = sess;
  if (r.why === 'covered') {
    const ms = puz.members[id];
    for (let k = 0; k < puz.crossings.length; k++) {
      const x = puz.crossings[k];
      if (ms.includes(x.under) && !ms.includes(x.top) && !has(st.removed, x.top))
        sess.rings.push({ x: B.ox + x.x * B.unit, y: B.oy + x.y * B.unit, t0: S.T, k });
    }
  }
  for (const b of r.blockers || []) sess.flash.set(b, S.T);
}

function resolve(id, S, fromPress) {
  const sess = S.sess;
  const { puz } = sess;
  const snip = sess.boosterArm === 'snip';
  const r = R.canPull(puz, sess.st, id, { snip });
  if (!r.ok) {
    if (r.why !== 'removed') feedback(sess, S, id, r, fromPress);
    return;
  }
  if (snip && !meta.useBooster('snip')) { sess.boosterArm = null; return resolve(id, S, fromPress); }
  doPull(sess, S, id, snip);
}

/** Blocked / full feedback for a tap that cannot pull (§3.3, §3.6). */
function feedback(sess, S, id, r, fromPress) {
  sess.wiggles.set(id, S.T);
  if (r.why === 'full') {
    sess.basketShake = S.T;
    bus.emit('full', {});
    return;
  }
  // a press already ringed the blockers (§3.6); a tap without a press (bots, queued) rings them now
  if (fromPress) for (const b of r.blockers || []) sess.flash.set(b, S.T);
  else ringBlockers(sess, S, id, r);
  sess.kitten.flinch = 1;
  if (r.why === 'locked') sess.unlockFx.push({ id, t0: S.T, kind: 'jiggle' });
  if (r.why === 'paw') sess.pawFx.push({ id, t0: S.T, kind: 'twitch' });
  bus.emit('blocked', { id, why: r.why, blockers: (r.blockers || []).slice() });
}

function doPull(sess, S, id, snip) {
  const { puz } = sess;
  const before = R.cloneState(sess.st);
  sess.hist.push(before);
  const ev = [];
  R.pull(puz, sess.st, id, ev, { snip });
  const st = sess.st;
  if (snip) {
    sess.boosterArm = null;
    sess.capped = true;
    sess.snipFx.push({ id, t0: S.T });
  }
  sess.hint = null;
  sess.press = null;
  const dest = [];
  let lastDur = 0, lastComplete = null, completes = 0;
  for (const e of ev) {
    if (e.t === 'wind' || e.t === 'basket') {
      const d = e.t === 'wind' ? { kind: 'spool', slot: e.slot, spool: e.spool } : { kind: 'basket', b: e.b };
      dest.push({ id: e.id, ...d });
      if (e.t === 'basket') sess.basket[e.b] = forceBasket(sess, S, e.b, puz.strands[e.id].c);
      lastDur = Math.max(lastDur, startFlight(sess, S, e.id, d));
    } else if (e.t === 'complete') {
      const sv = spoolOf(sess, e.spool);
      sv.done = true;
      sv.combo = ++sess.combo;
      sv.bonus = Math.max(0, Math.min(comboAmt(sv.combo), sess.bonusCap - sess.bonusDue));
      if (sv.bonus) { sess.bonusDue += sv.bonus; sess.bonusLog.push({ mv: st.moves, amt: sv.bonus }); }
      completes++;
      lastComplete = sv;
      if (e.n > 3) sess.jumboLog.push(st.moves);
    } else if (e.t === 'thaw') {
      if (lastComplete) lastComplete.thaw = e.left; else { sess.iceLeft = e.left; bus.emit('thaw', { left: e.left }); }
    } else if (e.t === 'enter') {
      const sv = spoolOf(sess, e.spool);
      sv.shown = 0; sv.done = false;
      sess.slots[e.slot].pend.push(sv);
    } else if (e.t === 'unbasket') {
      startBall(sess, S, e);
    } else if (e.t === 'unlock') {
      sess.unlockFx.push({ id: e.id, t0: S.T, kind: 'open' });
      bus.emit('unlock', { id: e.id });
    } else if (e.t === 'paw') {
      sess.pawFx.push({ id: e.id, t0: S.T, kind: e.left === 0 ? 'wake' : 'twitch' });
      bus.emit('paw', { id: e.id, left: e.left });
    }
  }
  if (!completes) sess.combo = 0;
  // ball flights remember the combo of the pull that sent them (for 'chain' at arrival)
  for (const f of sess.flights) if (f.kind === 'ball' && f.combo == null) f.combo = sess.combo;
  // chain bookkeeping: balls absorbed per arriving spool (paid by meta.recordWin on a win)
  const absorbed = new Map();
  for (const e of ev) if (e.t === 'unbasket') absorbed.set(e.spool, (absorbed.get(e.spool) || 0) + 1);
  for (const m of absorbed.values()) if (m >= 2) sess.chainLog.push({ mv: st.moves, m });

  bus.emit('pull', { id, c: puz.strands[id].c, dest, group: R.groupOf(puz, id), dur: lastDur });
  haptic(S, 12);

  // reveal + lift
  for (const i of R.newlyFree(puz, before, st)) {
    if (puz.strands[i].m && !sess.revealT.has(i)) { sess.revealT.set(i, S.T); bus.emit('reveal', { id: i }); }
  }
  refreshLift(sess);
  setKitten(sess, S, true);

  const cap = R.effectiveCap(puz, st);
  if (st.bt > before.bt && cap >= 2 && st.bt === cap - 1) bus.emit('basketWarn', {});

  if (R.isWon(puz, st)) { clearQueue(sess, S); win(sess, S); }
  else if (R.isStuck(puz, st)) {
    clearQueue(sess, S);
    sess.stuck = true;
    sess.stuckT = S.T;
    kittyAnim(sess, S, 'sad');
    bus.emit('stuck', {});
    haptic(S, [20, 40, 20]);
  } else {
    sess.doomCheck = { key: st.removed + ':' + st.moves, at: S.T };
  }
}

/** A new ball goes into basket slot b; a ball still sitting there visually (already absorbed in the rules) leaves now. */
function forceBasket(sess, S, b, c) {
  for (const f of sess.flights) if (f.kind === 'ball' && f.b === b && f.wait) launchBall(sess, S, f, S.T);
  return { c, arrived: false, bounce: 0 };
}

function startFlight(sess, S, id, dest) {
  const f = { kind: 'strand', id, c: sess.puz.strands[id].c, dest, t0: S.T, dur: DUR.flightMin, p: 0, rev: false, pegS: [], plucked: 1, lift: DUR.lift, fluffed: 0 };
  const dist = buildFlightPath(S, sess, f);
  f.dur = clamp(DUR.flightMin + (f.path.Ls + dist) / (2600 * S.L.u), DUR.flightMin, DUR.flightMax);
  sess.flights.push(f);
  bus.emit('pluck', { i: 0 });
  const tail = f.path.pts[0];
  burst(sess, 'fluff', tail[0], tail[1], 5, f.c, S);
  return f.dur;
}

function startBall(sess, S, e) {
  const bv = sess.basket[e.b];
  const sv = spoolOf(sess, e.spool);
  const order = sess.flights.filter(f => f.kind === 'ball' && f.dest.spool === e.spool).length;
  sess.flights.push({
    kind: 'ball', id: -1, b: e.b, c: bv ? bv.c : sv.c, dest: { kind: 'spool', slot: e.slot, spool: e.spool },
    t0: Infinity, dur: DUR.unbasketDur, p: 0, wait: true, order, ball: bv, from: basketPoint(S, sess, e.b), k: e.k,
  });
}

function launchBall(sess, S, f, at) {
  f.wait = false;
  f.t0 = at;
  f.from = basketPoint(S, sess, f.b);
}

function win(sess, S) {
  const { st } = sess;
  let stars = R.starsFor(st.peak, sess.par);
  if (sess.capped) stars = Math.min(2, stars);
  const chain = sess.chainLog.map(x => x.m);
  const res = meta.recordWin({
    kind: sess.kind, id: sess.kind === 'level' ? sess.id : 0, stars, peak: st.peak, capped: sess.capped,
    chain, jumbo: sess.jumboLog.length, combo: sess.bonusDue, dateKey: sess.dateKey || undefined,
  }) || {};
  sess.kitten.golden = !!res.golden;
  sess.result = {
    stars, peak: st.peak, par: sess.par, balls: res.balls | 0, firstWin: !!res.firstWin, newBest: !!res.newBest,
    kittenId: res.kittenId | 0, gifts: res.gifts || [], golden: !!res.golden, newStars: res.newStars | 0,
    kind: sess.kind, id: sess.id, bonus: res.combo | 0,
  };
  sess.winT = S.T;
  sess.hint = null;
  sess.boosterArm = null;
  sess.doomed = false;
}

// ------------------------------------------------------------------ boosters
export function undo(S) {
  const sess = S.sess;
  if (!sess || sess.result || !sess.hist.length) return false;
  const prev = sess.hist.pop();
  const cur = sess.st;
  prev.peak = Math.max(prev.peak, cur.peak);
  while (prev.basket.length < cur.basket.length) prev.basket.push(-1);
  sess.st = prev;
  sess.chainLog = sess.chainLog.filter(x => x.mv <= prev.moves);
  sess.jumboLog = sess.jumboLog.filter(mv => mv <= prev.moves);
  sess.bonusLog = sess.bonusLog.filter(x => x.mv <= prev.moves);
  sess.bonusDue = sess.bonusLog.reduce((a, x) => a + x.amt, 0);
  sess.bonusYarn = sess.bonusDue; // snapVisuals drops any pop still waiting, so the HUD total matches what a win pays
  sess.press = null; sess.hint = null; sess.combo = 0;
  clearQueue(sess, S);
  sess.stuck = false; sess.stuckT = -1; sess.lose = false; sess.doomed = false;
  sess.wiggles.clear(); sess.rings.length = 0; sess.flash.clear();
  snapVisuals(sess, S);
  for (const id of [...sess.revealT.keys()]) if (!sess.lifted.has(id) && !has(prev.removed, id)) sess.revealT.delete(id);
  sess.kitten.flinch = 0;
  kittyAnim(sess, S, 'idle');
  sess.doomCheck = { key: prev.removed + ':' + prev.moves, at: S.T };
  bus.emit('undo', {});
  return true;
}

/** Can booster key be used right now? → {ok, reason}. Pure apart from caching the hint search for this state. */
export function canUseBooster(S, key) {
  const sess = S && S.sess;
  if (!sess || !sess.st) return { ok: false, reason: 'Not in a level' };
  if (sess.result) return { ok: false, reason: 'Level already solved' };
  if (key === 'undo') {
    if (!sess.hist.length) return { ok: false, reason: 'Nothing to undo yet' };
  } else if (key === 'hint') {
    if (sess.stuck) return { ok: false, reason: 'No moves left. Try Undo' };
    if (sess.hint && S.T < sess.hint.until) return { ok: false, reason: 'Hint is already showing' };
    if (hintFor(sess) < 0) return { ok: false, reason: 'No way out from here. Try Undo', doomed: true };
  } else if (key === 'slot') {
    if (sess.slotUsed) return { ok: false, reason: '+1 Slot already used this level' };
  } else if (key === 'snip') {
    if (sess.boosterArm === 'snip') return { ok: true, reason: '' }; // tap again = disarm
    if (sess.stuck) return { ok: false, reason: 'No room to snip into. Try Undo' };
  } else return { ok: false, reason: 'Unknown booster' };
  return { ok: true, reason: '' };
}

/** hintMove for the current rule state, cached so canUseBooster + applyBooster search once. */
function hintFor(sess) {
  const st = sess.st;
  const key = st.removed + ':' + st.moves + ':' + st.basket.join(',') + ':' + st.next;
  if (sess.hintCache && sess.hintCache.key === key) return sess.hintCache.h;
  if (sess.doomed) { sess.hintCache = { key, h: -1 }; return -1; }
  const h = R.hintMove(sess.puz, st, 150000);
  sess.hintCache = { key, h };
  return h;
}

export function applyBooster(kind, S) {
  const sess = S.sess;
  if (!canUseBooster(S, kind).ok) return false; // refuse with no side effects: nothing charged, nothing changed
  if (kind === 'undo') {
    if (!meta.useBooster('undo')) return false;
    undo(S);
  } else if (kind === 'hint') {
    const h = hintFor(sess);
    if (h < 0 || !meta.useBooster('hint')) return false;
    sess.hint = { id: h, until: S.T + 4 };
    bus.emit('hint', { id: h });
  } else if (kind === 'slot') {
    if (!meta.useBooster('slot')) return false;
    sess.slotUsed = true;
    sess.capped = true;
    sess.st.basket.push(-1);
    sess.basket.push(null);
    for (const f of sess.flights) if (f.kind === 'strand') buildFlightPath(S, sess, f); // basket slots moved
    if (sess.stuck && !R.isStuck(sess.puz, sess.st)) { sess.stuck = false; sess.stuckT = -1; sess.lose = false; kittyAnim(sess, S, 'idle'); }
    sess.doomed = false;
    sess.hintCache = null;
    sess.doomCheck = { key: sess.st.removed + ':' + sess.st.moves + ':s', at: S.T };
  } else if (kind === 'snip') {
    if (sess.boosterArm === 'snip') { sess.boosterArm = null; return false; } // tap again = disarm (nothing spent)
    if (meta.booster('snip') <= 0) return false;
    sess.boosterArm = 'snip';
  } else return false;
  bus.emit('booster', { kind });
  return true;
}

/** Fix r2 (lose card Hint): when stuck or doomed a plain Hint has no move to show, so this rewinds to the latest
 *  earlier state that still has a way out (fewest undos, searching at most 14 back), then shows the hint there.
 *  Charges one Hint from stock unless `free` (the caller buys first when stock is 0); undos it makes are part of
 *  the hint and cost nothing. Returns false with nothing charged or changed when no solvable state is found. */
export function rescueHint(S, free = false) {
  const sess = S && S.sess;
  if (!sess || !sess.st || sess.result || sess.boosterArm) return false;
  const cur = sess.st, H = sess.hist, back = Math.min(H.length, 14);
  let steps = -1, move = -1;
  for (let k = 0; k <= back; k++) {
    const st = k === 0 ? cur : H[H.length - k];
    const cand = st.basket.length < cur.basket.length ? { ...st, basket: st.basket.concat(Array(cur.basket.length - st.basket.length).fill(-1)) } : st;
    if (R.isStuck(sess.puz, cand)) continue;
    const h = k === 0 && !sess.doomed ? hintFor(sess) : R.hintMove(sess.puz, cand, 60000);
    if (h >= 0) { steps = k; move = h; break; }
  }
  if (steps < 0) return false;
  if (!free && !meta.useBooster('hint')) return false;
  for (let k = 0; k < steps; k++) undo(S);
  sess.hint = { id: move, until: S.T + 4 };
  bus.emit('hint', { id: move });
  bus.emit('booster', { kind: 'hint' });
  return true;
}

/** True while a win is recorded but its card has not been shown yet (strands landing + the kitten-free beat). */
export function winPending(S) {
  const sess = S && S.sess;
  return !!(sess && sess.result && !sess.winShown);
}

/** Cut the kitten-free beat short (the player is leaving): free the kitten now and emit 'win'. Returns true if it
 *  did, and game.js then shows the win card so the stars and gifts are always seen. */
export function finishWinNow(S) {
  const sess = S.sess;
  if (!winPending(S)) return false;
  if (sess.kitten.freeT < 0) freeKitten(sess, S);
  sess.winShown = true;
  bus.emit('win', { result: sess.result });
  return true;
}

const WIN_HOLD = 0.6; // fix 9: s the empty board holds (sparkling) after the kitten-free beat, before the win card
function freeKitten(sess, S) {
  sess.kitten.freeT = S.T;
  sess.kitten.stage = 4; sess.kitten.loops = 0;
  kittyAnim(sess, S, 'celebrate');
  const B = sess.B, k = B.kitten;
  burst(sess, 'heart', k.x, k.y - k.s * 0.6, 12, -1, S);
  burst(sess, 'conf', B.x + B.w / 2, B.y + B.h / 2, 40, [0, 1, 2, 3, 4, 5], S);
  sess.shake = 0.4;
  bus.emit('kittenFree', {});
}

// ------------------------------------------------------------------ resize
export function onResize(S, sess = S.sess) {
  if (!sess || !S.L) return;
  sess.B = fitBoard(sess.puz, S.L.board);
  sess.geo = buildGeo(sess.puz, sess.B);
  for (const f of sess.flights) {
    if (f.kind === 'strand') buildFlightPath(S, sess, f);
    else f.from = basketPoint(S, sess, f.b);
  }
  const B = sess.B;
  for (const r of sess.rings) { const x = sess.puz.crossings[r.k]; if (x) { r.x = B.ox + x.x * B.unit; r.y = B.oy + x.y * B.unit; } }
  sess.press = null;
  sess.bakeKey = '';
}

// ------------------------------------------------------------------ update
/** Advances the session visuals by dt. Returns 'win' | 'lose' | null (game.js changes the screen). */
export function update(dt, S) {
  const sess = S.sess;
  if (!sess) return null;
  const T = S.T, u = S.L ? S.L.u : 1;

  // peek: hold on a covered strand keeps its blockers ringed
  const pr = sess.press;
  if (pr && pr.id >= 0 && !pr.ok && pr.why !== 'full' && pr.why !== 'removed' && T - pr.t0 >= PEEK_HOLD) {
    pr.peek = true;
    if (!sess.rings.some(r => T - r.t0 < DUR.ring * 0.5)) ringBlockers(sess, S, pr.id, { why: pr.why, blockers: pr.blockers });
  }

  // flights
  for (const f of sess.flights) {
    if (f.kind === 'strand') {
      f.p = clamp((T - f.t0 - f.lift) / f.dur, 0, 1);
      const s = ease(f.p) * f.path.Ltot;
      while (f.plucked < f.pegS.length && s >= f.pegS[f.plucked] + 0.5) { bus.emit('pluck', { i: f.plucked }); f.plucked++; }
      while (f.fluffed < 4 && f.p >= (f.fluffed + 1) * 0.2) {
        f.fluffed++;
        const hp = R.pointAt(f.path.pts, Math.min(f.path.Ltot, s + f.path.Ls), f.path.at);
        burst(sess, 'fluff', hp.x, hp.y, 1, f.c, S);
      }
      if (f.p >= 1) { f.done = true; arrive(sess, S, f); }
    } else {
      if (f.wait) {
        const sv = sess.spoolVis.get(f.dest.spool);
        const slot = sess.slots[f.dest.slot];
        if (sv && slot.cur === sv && T - sv.enterT >= DUR.spoolEnter) launchBall(sess, S, f, T + DUR.unbasketDelay + f.order * 0.12);
      }
      if (!f.wait) {
        if (T >= f.t0 && f.ball && sess.basket[f.b] === f.ball) sess.basket[f.b] = null;
        f.p = clamp((T - f.t0) / f.dur, 0, 1);
        if (f.p >= 1) { f.done = true; arrive(sess, S, f); }
      }
    }
  }
  if (sess.flights.some(f => f.done)) sess.flights = sess.flights.filter(f => !f.done);

  // spool slots
  let busy = false;
  for (let k = 0; k < sess.slots.length; k++) {
    const s = sess.slots[k];
    if (s.cur) { s.cur.spin = Math.max(0, s.cur.spin - dt * 2.2); s.cur.bounce = Math.max(0, s.cur.bounce - dt * 5); }
    if (s.cur && s.cur.done && s.cur.shown >= s.cur.n && !sess.flights.some(f => f.dest.kind === 'spool' && f.dest.spool === s.cur.id)) {
      const sv = s.cur;
      s.leaving = sv; s.leaveT = T; s.cur = null;
      const p = slotPoint(S, k);
      burst(sess, 'conf', p.x, p.y, 16, [sv.c, -1], S);
      bus.emit('spoolDone', { i: sv.id, combo: sv.combo | 0, slot: k, c: sv.c, n: sv.n });
      if (sv.bonus > 0) {
        const amt = Math.min(sv.bonus, sess.bonusDue - sess.bonusYarn);
        sv.bonus = 0;
        if (amt > 0) {
          sess.bonusYarn += amt;
          bus.emit('bonus', { amt, combo: sv.combo | 0, total: sess.bonusYarn, i: sv.id, slot: k, c: sv.c });
        }
      }
      comboFx(S, sv.combo | 0);
      if (sv.n > 3) bus.emit('coins', { n: 5 });
      if (sv.thaw !== null) { sess.iceLeft = sv.thaw; bus.emit('thaw', { left: sv.thaw }); }
      haptic(S, 30);
      if (!sess.stuck && (!sess.result || sess.kitten.freeT < 0)) kittyAnim(sess, S, 'cheer');
    }
    if (s.leaving && T - s.leaveT >= DUR.spoolLeave) s.leaving = null;
    if (!s.cur && s.pend.length && (!s.leaving || T - s.leaveT >= 0.15)) {
      const sv = s.pend.shift();
      sv.enterT = T; s.enterT = T; s.cur = sv;
      sess.visNext = Math.max(sess.visNext, sv.id + 1);
      refreshQueue(sess);
      bus.emit('spoolEnter', { slot: k, c: sv.c, n: sv.n });
    }
    if (s.leaving || s.pend.length || (s.cur && T - s.cur.enterT < DUR.spoolEnter) || (s.cur && s.cur.done)) busy = true;
  }
  sess.spoolBusy = busy;

  // queued taps resolve in order once the incoming spool has landed (§3.4), one per QUEUE_GAP
  if (sess.queue.length && !canPlay(sess)) clearQueue(sess, S);
  while (sess.queue.length && !sess.spoolBusy && T - sess.queueT >= QUEUE_GAP && canPlay(sess)) {
    const id = sess.queue.shift();
    syncPending(sess, S);
    sess.queueT = T;
    resolve(id, S, false);
    sess.spoolBusy = slotsBusy(sess, T);
  }

  // decays and timers
  for (const b of sess.basket) if (b) b.bounce = Math.max(0, b.bounce - dt * 5);
  for (const [id, t0] of sess.wiggles) if (T - t0 > DUR.wiggle) sess.wiggles.delete(id);
  for (const [id, t0] of sess.flash) if (T - t0 > 0.3) sess.flash.delete(id);
  if (sess.rings.length) sess.rings = sess.rings.filter(r => T - r.t0 < DUR.ring);
  if (sess.unlockFx.length) sess.unlockFx = sess.unlockFx.filter(f => T - f.t0 < 1);
  if (sess.pawFx.length) sess.pawFx = sess.pawFx.filter(f => T - f.t0 < 1);
  if (sess.snipFx.length) sess.snipFx = sess.snipFx.filter(f => T - f.t0 < 0.6);
  if (sess.basketShake >= 0 && T - sess.basketShake > 0.5) sess.basketShake = -1;
  sess.kitten.flinch = Math.max(0, sess.kitten.flinch - dt * 4);
  sess.shake = Math.max(0, sess.shake - dt * 2.5);
  if (sess.hint && T > sess.hint.until) sess.hint = null;
  for (const p of sess.parts) {
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'conf') { p.vy += 520 * u * dt; p.vx *= 0.99; p.rot += p.vr * dt; }
    else if (p.kind === 'fluff') { p.vy += 120 * u * dt; p.vx *= 0.96; }
    else if (p.kind === 'heart') { p.vy *= 0.985; p.x += Math.sin(p.t * 6) * 0.4; }
    else { p.vx *= 0.92; p.vy *= 0.92; }
  }
  if (sess.parts.length && sess.parts.some(p => p.t >= p.life)) sess.parts = sess.parts.filter(p => p.t < p.life);

  // Kitty's base pose
  const ka = sess.kitty.anim, kt = T - sess.kitty.t0;
  if (!sess.result && !sess.stuck) {
    const worried = sess.st.bt >= R.effectiveCap(sess.puz, sess.st) - 1 && sess.st.bt > 0;
    if ((ka === 'swat' && kt > 0.25) || (ka === 'cheer' && kt > 0.7) || ka === 'idle' || ka === 'worried' || ka === 'sad') {
      const want = worried ? 'worried' : 'idle';
      if (ka !== want) kittyAnim(sess, S, want);
    }
  }

  // doomed check (deferred so the solver never runs mid-flight)
  const dc = sess.doomCheck;
  if (dc && !sess.result && !sess.stuck && (!sess.flights.length || T - dc.at > 0.8)) {
    sess.doomCheck = null;
    // = solve(puz, st, 40000) without its beam fallback: only an exact 'no win' counts as doomed
    const sv = R.makeSolver(sess.puz, 40000);
    const doomed = sv.f(R.cloneState(sess.st)) === Infinity && !sv.aborted;
    if (doomed && !sess.doomed) bus.emit('doomed', {});
    sess.doomed = doomed;
  }

  // bake key
  let wk = '';
  for (const id of sess.wiggles.keys()) wk += id + ',';
  sess.bakeKey = sess.st.removed + '|' + [...sess.lifted].join(',') + '|' + S.W + 'x' + S.H + '|' + S.dpr + '|' + wk;

  // end states
  if (sess.result) {
    if (sess.kitten.freeT < 0 && !sess.flights.some(f => f.kind === 'strand')) freeKitten(sess, S);
    // fix 9: after the kitten-free beat the cleared board holds WIN_HOLD s with a twinkle of sparkles before the
    //   win card covers it (the satisfying empty board is the frame clips and players remember)
    if (sess.kitten.freeT >= 0 && !sess.holdFx && T - sess.kitten.freeT >= DUR.kittenFree - 0.15) {
      sess.holdFx = true;
      const B = sess.B, r = sess.rng;
      if (B) for (let i = 0; i < 7; i++) burst(sess, 'spark', B.x + B.w * (0.12 + 0.76 * r()), B.y + B.h * (0.12 + 0.7 * r()), 5, 0, S);
    }
    if (sess.kitten.freeT >= 0 && T - sess.kitten.freeT >= DUR.kittenFree + WIN_HOLD && !sess.winShown) {
      sess.winShown = true;
      bus.emit('win', { result: sess.result });
      return 'win';
    }
    return null;
  }
  if (sess.stuck && !sess.lose && (!sess.flights.length || T - sess.stuckT >= DUR.stuckCard)) {
    sess.lose = true;
    kittyAnim(sess, S, 'sad');
    return 'lose';
  }
  return null;
}

function arrive(sess, S, f) {
  if (f.dest.kind === 'spool') {
    const sv = spoolOf(sess, f.dest.spool);
    sv.shown = Math.min(sv.n, sv.shown + 1);
    sv.spin = 1; sv.bounce = 1;
    const p = slotPoint(S, f.dest.slot);
    burst(sess, 'fluff', p.x, p.y, 6, sv.c, S);
    bus.emit('wind', { slot: f.dest.slot, k: sv.shown, n: sv.n, c: sv.c });
    if (f.kind === 'ball') {
      const a = (sv.balls = (sv.balls || 0) + 1);
      bus.emit('chain', { n: a, m: a, combo: f.combo | 0, slot: f.dest.slot, c: sv.c });
      if (a >= 2) bus.emit('coins', { n: 1 });
    }
    if (!sess.result && !sess.stuck) kittyAnim(sess, S, 'swat');
  } else {
    const b = sess.basket[f.dest.b];
    if (b) { b.arrived = true; b.bounce = 1; }
    const p = basketPoint(S, sess, f.dest.b);
    burst(sess, 'fluff', p.x, p.y, 4, f.c, S);
    bus.emit('basket', { b: f.dest.b, c: f.c });
  }
}

