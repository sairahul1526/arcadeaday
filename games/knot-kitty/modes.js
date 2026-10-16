// Knot Kitty: special page modes (GDD §11 ?qa=1, §12 ?record=1 / ?og=1, §13.9; PLAYBOOK §6).
// Owner: Modes. Receives `api` from game.js; never imports game.js / play.js.
//
// DECISION: sibling modules are imported as namespaces (`import * as R`), so a missing optional export
//   degrades one feature instead of failing the whole module graph at link time.
// DECISION: ?record=1 and ?og=1 never write the player's save: P.save / P.flush become no-ops in those
//   modes, and the showcase save tweaks (L1-19 at 3 stars, Pumpkin Sweater worn, gifts/chests/tutorials
//   marked done so no popup interrupts the take) live only in memory.
// DECISION: L20's par is 2, so a CHAIN x3 (three balls waiting) can't also be a 3-star run. The record
//   planner prefers the CHAIN x3 climax; the win card shows whatever stars the line really earns.
// DECISION: cap2 ("1 slot left") is shown only while the basket really sits at cap-1 (PLAYBOOK lesson:
//   a number caption must agree with the HUD on every frame), between the 3rd basket pull and the key pull.
// DECISION: the scripted hand is drawn for every scripted tap (playable-ad style), not only the first.
// DECISION: the planner scores every winning rollout by simulating the tap schedule with the §3.4 spool hand-over
//   waits (DUR), so it picks the line whose beats actually land: key pull ~15 s, win card ~20.5 s. With 20+ strands
//   that means the CHAIN often comes at move ~15-17 rather than 11-13 (the 3.5-9 s run carries more, faster pulls).
// DECISION: record/OG audio = the logged bus events handed to audio.renderOffline as {t, name: busEvent, args: data},
//   so the soundtrack uses audio.js's own live mapping; unknown events fall back to §8.2 SFX names.
// DECISION: __qaInput finds UI buttons by scanning S.ui for {x,y,w,h}+label objects; when none match it
//   drives the state machine through api (go / next / retry / resume) and returns [] so the checker polls.
// DECISION: __qaBot policies (random / casual / average / expert / solver) are re-implemented here as
//   per-move policies from the current state (rules.botRun only plays whole games from the start).
// DECISION: ?lv=N with ?qa=1 jumps straight to level N after boot (level-select for QA scripts).
import P from '../shared/platform.js';
import { bus, TEACH, LEVELS, DUR } from './consts.js';
import * as R from './rules.js';
import * as Rn from './render.js';
import * as Sc from './scene.js';
import * as M from './meta.js';
import * as Au from './audio.js';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const on = k => Q.get(k) === '1' || Q.get(k) === 'true';
const REC_ON = on('record');
export const active = { record: REC_ON, og: on('og') && !REC_ON, qa: on('qa') || !!P.qa };

const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const LV_PARAM = Q.has('lv') ? int(Q.get('lv'), 20, 1, LEVELS) : null;
const LV = LV_PARAM || 20;
const SEED = int(Q.get('seed'), 1, 0, 1e9);
const HOOK = Q.has('hook') ? Q.get('hook') : 'Pull them in the|RIGHT order 🧶';
const CAP2 = Q.has('cap2') ? Q.get('cap2') : '1 slot left… 😬';
const FPS = 60, END_T = 25, ENDCARD_T = 22.5;
const DURS = { leave: DUR.spoolLeave ?? 0.45, enter: DUR.spoolEnter ?? 0.3, ubDelay: DUR.unbasketDelay ?? 0.28, ubDur: DUR.unbasketDur ?? 0.38 };

// Record and OG takes must never touch the real save.
if (active.record || active.og) { P.save = () => {}; P.flush = () => {}; }

let A = null; // the api object from game.js
const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };

export function init(api) {
  A = api;
  if (active.qa) installQA();
  if (active.record) installRecord();
  else if (active.og) installOG();
}

export function overlay(g, S) {
  if (active.record && REC.ready) drawRecOverlay(g, S);
  else if (active.og && OG.ready && Sc.drawOG) { g.save(); Sc.drawOG(g, S); g.restore(); }
}

export function afterFrame(S) {
  if (BOT) botTick(S);
}

// ------------------------------------------------------------------ shared helpers
function whenBooted(fn) {
  const t0 = Date.now();
  const tick = () => {
    const S = A && A.S;
    if (S && P.data && S.screen && S.screen !== 'loading') return void Promise.resolve().then(fn).catch(e => P.error(e));
    if (Date.now() - t0 > 20000) return void P.error(new Error('modes: boot never finished'));
    setTimeout(tick, 25);
  };
  tick();
}
async function fontsReady() {
  try {
    if (typeof document !== 'undefined' && document.fonts) {
      await Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('800 20px Nunito')]);
      await document.fonts.ready;
    }
  } catch {}
}
const canvasEl = () => (typeof document !== 'undefined' ? document.getElementById('c') || document.querySelector('canvas') : null);
const effCap = (puz, st) => (R.effectiveCap ? R.effectiveCap(puz, st) : puz.cap);
const spoolAt = (puz, i) => {
  const e = puz.spools ? puz.spools[i] : puz.queue && puz.queue[i];
  return e == null ? null : typeof e === 'object' ? { c: e.c, n: e.n || 3 } : { c: e, n: 3 };
};
const colorOf = (puz, id) => puz.strands[id].c;
const legal = (puz, st) => (R.legalMoves ? R.legalMoves(puz, st) : []);
const canPullOk = (puz, st, id) => (R.canPull ? R.canPull(puz, st, id).ok : legal(puz, st).includes(id));
const goesToBasket = (puz, st, id) => {
  const d = R.destOf ? R.destOf(puz, st, id) : null;
  return d ? d.some(x => x.kind === 'basket') : true;
};
const sigOf = st => `${st.removed}|${st.sc}|${st.sn}|${st.next}|${st.basket}|${st.moves}`;
const sessFree = s => s && !s.spoolBusy && s.buffered == null && !s.press;
const levelOver = (s) => !s || !s.st || s.stuck || s.st.dead || safe(() => R.isWon(s.puz, s.st), false) || safe(() => R.isStuck(s.puz, s.st), false);

// Validated solver line from st: the level's stored `sol` from the start, else solve(), else hintMove.
function lineFrom(sess, st, limit = 150000) {
  const { puz, level } = sess;
  const tryLine = ids => {
    if (!ids || !ids.length) return null;
    const s = R.cloneState(st), sigs = [];
    for (const id of ids) {
      if (!canPullOk(puz, s, id)) return null;
      sigs.push(sigOf(s));
      R.pull(puz, s, id);
    }
    return R.isWon(puz, s) ? { line: ids.slice(), sigs } : null;
  };
  let L = st.moves === 0 && level && level.sol ? tryLine(level.sol) : null;
  if (!L) L = tryLine(safe(() => R.solve(puz, st, limit).moves, null));
  if (!L) {
    const h = safe(() => R.hintMove(puz, st, limit), -1);
    const id = h >= 0 ? h : legal(puz, st)[0];
    L = id == null ? { line: [], sigs: [] } : { line: [id], sigs: [sigOf(st)] };
  }
  return L;
}

// Apply this level's showcase save in memory only (saves are disabled in record/og).
function prepShowcaseSave(lv) {
  const d = P.data;
  if (!d) return;
  d.cur = Math.max(d.cur | 0, lv);
  if (Array.isArray(d.stars)) for (let i = 0; i < lv - 1 && i < d.stars.length; i++) d.stars[i] = 3;
  if (Array.isArray(d.kittens)) for (let i = 0; i < lv - 1 && i < d.kittens.length; i++) d.kittens[i] = (i + 1) % 10 === 0 ? 2 : Math.max(1, d.kittens[i] | 0);
  d.outfits = [...new Set([...(Array.isArray(d.outfits) ? d.outfits : ['tabby']), 'pumpkin'])];
  d.wear = 'pumpkin';
  d.gifted = { undo: true, hint: true, slot: true, snip: true };
  d.boost = { undo: 3, hint: 2, slot: 1, snip: 1 };
  d.balls = Math.max(d.balls | 0, 640);
  const total = (d.stars || []).reduce((a, b) => a + (b | 0), 0);
  d.giftsClaimed = Math.floor((total + 3) / 15); // no star-milestone gift pops on the showcase win
  d.chests = (1 << 6) - 1;
  d.tut = { ...(d.tut || {}) };
  for (const k of [...Object.values(TEACH), 'pull', 'over', 'basket', 'next', 'undo', 'hint', 'slot', 'snip', 'idle', 'full', 'b_undo', 'b_hint', 'b_slot', 'b_snip'])
    d.tut[k] = 1;
}

// ================================================================== ?record=1  (GDD §12.1)
const REC = { ready: false, t: 0, frames: 0, items: [], held: null, log: [], plan: null, hand: null, lastTapT: 0,
  keyT: null, cap2On: null, cap2Off: null, pulls0: 0 };

function installRecord() {
  window.__rec = { step: recStep, frame: recFrame, audio: recAudio };
  // Log every bus event against record time for the offline soundtrack.
  const emit0 = bus.emit;
  bus.emit = (t, d) => {
    if (REC.ready) REC.log.push({ t: REC.t, ev: t, data: d == null ? d : { ...d } });
    return emit0.call(bus, t, d);
  };
  whenBooted(async () => {
    await fontsReady();
    prepShowcaseSave(LV);
    A.resize(1080, 1920, 1);
    A.go('play', { kind: 'level', id: LV });
    const s = A.S.sess;
    const t0 = performance.now();
    REC.plan = planShow(s, s.st, SEED, 2000);
    REC.planMs = Math.round(performance.now() - t0);
    REC.items = scheduleShow(REC.plan);
    REC.hand = { x: A.S.W * 0.82, y: A.S.H * 0.97, fx: A.S.W * 0.82, fy: A.S.H * 0.97, tx: A.S.W * 0.82, ty: A.S.H * 0.97, mt: 0 };
    REC.lastTapT = REC.items.length ? REC.items[REC.items.length - 1].t : 0;
    REC.ready = true;
    window.__recPlan = { line: REC.plan.line, key: REC.plan.k, chain: REC.plan.chain, peak: REC.plan.peak, stars: REC.plan.stars,
      ms: REC.planMs, score: Math.round(REC.plan.score), est: REC.plan.est };
    window.__recReady = true;
  });
}

function recState() {
  const S = A.S, s = S.sess;
  const stars = P.data && Array.isArray(P.data.stars) ? P.data.stars.reduce((a, b) => a + (b | 0), 0) : 0;
  return { t: REC.t, mode: REC.t >= END_T ? 'over' : S.screen, score: stars, dead: false,
    pulls: s && s.st ? s.st.moves : 0, basket: s && s.st ? s.st.bt : 0 };
}

function recStep(n = 1) {
  if (!REC.ready) return recState();
  for (let i = 0; i < n; i++) {
    runScript();
    A.step(1 / FPS);
    REC.frames++;
    REC.t = REC.frames / FPS;
  }
  return recState();
}

function recFrame(q = 0.92) {
  const c = canvasEl();
  return c ? c.toDataURL('image/jpeg', q) : '';
}

// Soundtrack: the logged bus events go to audio.renderOffline as {t, name: busEvent, args: data}; audio.js maps
// them with its own live handlers (same sounds as play). Events audio.js doesn't know fall back to §8.2 SFX names.
const SFX_OF = {
  pluck: d => ['pluck', [d.i | 0]], pull: () => ['zip', [0.45]], wind: d => ['wind', [d.k, d.n]],
  spoolDone: () => ['spoolDone', []], chain: d => ['chain', [d.m | 0]], basket: () => ['basket', []],
  blocked: () => ['blocked', []], full: () => ['full', []], basketWarn: () => ['warn', []], stuck: () => ['stuck', []],
  win: () => ['win', [3]], unlock: () => ['unlock', []], reveal: () => ['reveal', []],
  paw: d => [d.left === 0 ? 'pawYawn' : 'pat', []], thaw: d => [d.left === 0 ? 'thaw' : 'iceCrack', []],
  undo: () => ['undo', []], hint: () => ['hint', []], coins: () => ['coin', []], click: () => ['click', []],
  buy: () => ['buy', []], gift: () => ['gift', []],
};
export function recTimeline(log, dur) {
  const known = Array.isArray(Au.BUS_EVENTS) ? new Set(Au.BUS_EVENTS) : null;
  const tl = [];
  for (const e of log) {
    if (e.t > dur) continue;
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    if (known ? known.has(e.ev) : false) { tl.push({ t: e.t, name: e.ev, args: d }); continue; }
    const m = SFX_OF[e.ev] ? safe(() => SFX_OF[e.ev](d), null) : null;
    if (m) tl.push({ t: e.t, name: m[0], args: m[1] });
  }
  return tl;
}
async function recAudio(dur) {
  const world = safe(() => A.S.world, 0) || Math.min(6, Math.floor((LV - 1) / 10) + 1);
  const tl = recTimeline(REC.log, dur);
  tl.world = world;
  if (!Au.renderOffline) return silentWav(dur);
  try {
    const b64 = await Au.renderOffline(tl, dur, world);
    return typeof b64 === 'string' && b64.length ? b64 : silentWav(dur);
  } catch (e) {
    P.error(e);
    return silentWav(dur);
  }
}
function silentWav(dur) {
  const rate = 22050, n = Math.max(1, Math.round(dur * rate)), bytes = 44 + n * 2;
  const u = new Uint8Array(bytes), v = new DataView(u.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) u[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, bytes - 8, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
  let str = '';
  for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(str);
}

// ------------------------------------------------------------------ record planner
// Randomised rollouts (seeded) for a winning line where the basket climbs to cap-1 and one arriving
// spool then sucks >= 3 balls out (CHAIN x3) around move 11-13; the solver finishes each promising
// prefix so the line always wins. Fallback: the best line found by chain size, then the solver line.
function chainOf(ev) {
  const per = {};
  let chain = 0, toBasket = 0, completes = 0, unb = 0;
  for (const e of ev) {
    if (e.t === 'unbasket') { const k = e.slot + ':' + e.spool; per[k] = (per[k] || 0) + 1; chain = Math.max(chain, per[k]); unb++; }
    else if (e.t === 'basket') toBasket++;
    else if (e.t === 'complete') completes++;
  }
  return { chain, toBasket, completes, unb };
}

export function planShow(sess, st0, seed = 1, budgetMs = 2000) {
  const { puz } = sess;
  const par = sess.level && sess.level.par != null ? sess.level.par : puz.par != null ? puz.par : 0;
  const r = R.rng ? R.rng(seed * 7919 + 17) : Math.random;
  const t0 = performance.now();
  let best = null, tries = 0, wins = 0;
  const consider = (line, info) => {
    wins++;
    const sc = scoreLine(line, info, puz, par, st0);
    if (!best || sc.score > best.score) best = { line: line.slice(), info: info.slice(), ...sc };
  };
  while (performance.now() - t0 < budgetMs && tries < 20000) {
    tries++;
    // Policy mix: a third of rollouts are uniform random (they find early chains best), the rest lean on
    // "hoard the colour of the next spools in the basket" and "prefer pulls that fit a spool".
    const uni = r() < 0.35;
    const pol = { hoard: uni ? 0 : 0.2 + 0.7 * r(), fit: uni ? 0 : 0.2 + 0.6 * r() };
    const st = R.cloneState(st0), line = [], info = [];
    let won = false;
    for (let guard = 0; guard < 80; guard++) {
      if (R.isWon(puz, st)) { won = true; break; }
      const moves = legal(puz, st);
      if (!moves.length) break;
      const cap = effCap(puz, st);
      const fit = [], bask = [];
      for (const id of moves) (goesToBasket(puz, st, id) ? bask : fit).push(id);
      const up = new Set();
      for (let j = 0; j < 2; j++) { const sp = spoolAt(puz, st.next + j); if (sp) up.add(sp.c); }
      const hoard = bask.filter(id => up.has(colorOf(puz, id)));
      const pick = arr => arr[(r() * arr.length) | 0];
      let id;
      if (st.bt < cap - 1 && hoard.length && r() < pol.hoard) id = pick(hoard);
      else if (fit.length && (st.bt >= cap - 1 || r() < pol.fit)) id = pick(fit);
      else id = pick(moves);
      const ev = [], bt0 = st.bt;
      R.pull(puz, st, id, ev);
      line.push(id);
      info.push({ ...chainOf(ev), bt0, bt: st.bt });
      if (info[info.length - 1].chain >= 3) {
        // Climax found: finish the line with the solver (min peak from here).
        const sol = safe(() => R.solve(puz, st, 60000), null);
        if (sol && sol.moves && sol.peak !== Infinity) {
          let ok = true;
          for (const m of sol.moves) {
            if (!canPullOk(puz, st, m)) { ok = false; break; }
            const e2 = [], b0 = st.bt;
            R.pull(puz, st, m, e2);
            line.push(m);
            info.push({ ...chainOf(e2), bt0: b0, bt: st.bt });
          }
          won = ok && R.isWon(puz, st);
        }
        break;
      }
    }
    if (won) consider(line, info);
  }
  if (!best) {
    const L = lineFrom(sess, st0, 600000);
    const st = R.cloneState(st0), info = [];
    for (const id of L.line) { const ev = [], b0 = st.bt; R.pull(puz, st, id, ev); info.push({ ...chainOf(ev), bt0: b0, bt: st.bt }); }
    best = { line: L.line, info, ...scoreLine(L.line, info, puz, par, st0) };
  }
  best.tries = tries;
  best.wins = wins;
  return best;
}

function scoreLine(line, info, puz, par, st0) {
  let k = 0;
  for (let i = 1; i < info.length; i++) if (info[i].chain > info[k].chain) k = i;
  const chain = info.length ? info[k].chain : 0;
  const cap = effCap(puz, st0);
  const peak = Math.max(0, ...info.map(x => x.bt));
  let score = chain >= 3 ? 100 + 4 * Math.min(2, chain - 3) : chain * 20;
  if (peak >= cap) score -= 40; // a full basket reads as panic, not planning
  if (info[k] && info[k].bt0 === cap - 1) score += 25; // "1 slot left" right before the key pull
  let run = 0;
  for (let j = k - 1; j >= 0 && j >= k - 3; j--) if (info[j].toBasket > 0 && !info[j].completes) run++; else break;
  score += run * 6; // three pulls into the basket right before the climax
  // Beat sheet fit: simulate the tap schedule with spool hand-over waits and score where the beats land.
  score -= k < 8 ? (8 - k) * 6 : 0; // too few pulls before the climax reads as luck, not planning
  const tm = simSchedule(scheduleShow({ line, k, chain }), line, info);
  score -= 12 * Math.max(0, Math.abs(tm.key - 15.1) - 0.4);
  score -= 15 * Math.max(0, tm.end - 20.6); // win card (kitten freed + 1.6 s) should land by ~20.5 s
  score -= 8 * Math.max(0, 19.9 - tm.end); // ...but not so early that the end is a single pull
  score -= 3 * Math.max(0, k - 4 - 9); // the 3.5-9 s run reads best at ~6-9 pulls, not a blur
  score -= 8 * Math.max(0, tm.cover - 10.4);
  if (line.length - k - 1 < 2) score -= 8;
  if (info.slice(1, Math.min(k, 8)).some(x => x.completes)) score += 8; // a spool rolls off in the 3.5-9 s run
  const stars = R.starsFor ? R.starsFor(peak, par) : 0;
  score += 4 * stars;
  return { score, k, chain, peak, stars, est: tm };
}

// Beat sheet (§12.1) -> tap times. Times are the earliest; a tap waits for spools to land (§3.4).
// Spreads ids from a toward b at `step` (squeezed down to minStep); `fromStart` keeps a fixed and lets a long
// run spill past b instead of starting early (used after the climax, which must not be hurried).
function spread(ids, a, b, step, minStep, fromStart = false) {
  const n = ids.length;
  if (!n) return [];
  let st = n > 1 ? Math.min(step, (b - a) / (n - 1)) : 0;
  if (n > 1 && st < minStep) {
    st = minStep;
    if (!fromStart) a = Math.max(1.4, b - st * (n - 1));
  }
  return ids.map((id, i) => ({ t: +(a + i * st).toFixed(3), id, hold: 0.14 }));
}
export function scheduleShow(plan) {
  const { line, k, chain } = plan;
  const items = [];
  if (!line.length) return items;
  items.push({ t: 0.6, id: line[0], hold: 0.55, first: true });
  if (chain >= 2 && k >= 2) {
    const pre = line.slice(1, k), nLate = Math.min(3, pre.length);
    const early = pre.slice(0, pre.length - nLate), late = pre.slice(pre.length - nLate);
    items.push(...spread(early, 3.6, 8.6, 0.8, 0.36));
    items.push({ t: 9.4, cover: true, hold: 0.16 });
    [10.8, 12.0, 13.2].slice(3 - nLate).forEach((t, i) => items.push({ t, id: late[i], hold: 0.16 }));
    items.push({ t: 15.0, id: line[k], hold: 0.22, key: true });
    items.push(...spread(line.slice(k + 1), 17.2, 18.6, 0.4, 0.22, true));
  } else {
    const rest = line.slice(1), half = Math.ceil(rest.length / 2);
    items.push(...spread(rest.slice(0, half), 3.6, 8.8, 0.8, 0.3));
    items.push({ t: 9.4, cover: true, hold: 0.16 });
    items.push(...spread(rest.slice(half), 10.8, 19.2, 1.0, 0.3));
  }
  return items;
}

// Rough tap times for a schedule: a tap waits for the spool hand-over of the previous pull (§3.4).
function simSchedule(items, line, info) {
  const busyOf = x => (x && x.completes ? DURS.leave + DURS.enter + (x.unb ? DURS.ubDelay + DURS.ubDur * x.unb : 0) : 0);
  let free = 0, key = 0, last = 0, cover = 0;
  for (const it of items) {
    const t = Math.max(it.t, free);
    if (it.cover) { cover = t; free = t + it.hold + 0.05; continue; }
    const j = line.indexOf(it.id);
    if (it.key) key = t;
    last = t + it.hold;
    free = last + 0.05 + busyOf(info[j]);
  }
  return { key, last, cover, end: free + (DUR.kittenFree ?? 1.6) };
}

function pickCovered(sess) {
  const { puz, st } = sess;
  let best = -1, bs = -Infinity;
  for (let id = 0; id < puz.n; id++) {
    if ((st.removed >>> id) & 1) continue;
    const c = R.canPull ? R.canPull(puz, st, id) : null;
    if (!c || c.ok || c.why !== 'covered') continue;
    const nb = (c.blockers || []).length || 1;
    const len = puz.strands[id].at ? puz.strands[id].at[puz.strands[id].at.length - 1] : 1;
    const sc = -Math.abs(nb - 1) * 2 + len * 0.3;
    if (sc > bs) { bs = sc; best = id; }
  }
  return best;
}

function runScript() {
  const S = A.S, s = S.sess;
  if (!s) return;
  if (REC.held) {
    if (REC.t >= REC.held.upAt) { A.pointer('up', REC.held.x, REC.held.y, 1); REC.held = null; }
    return;
  }
  const it = REC.items[0];
  if (!it) return;
  // Glide the hand to the next target a moment before the press.
  if (!it.pt && REC.t >= it.t - 0.42 && S.screen === 'play') {
    if (it.cover) { it.id = pickCovered(s); if (it.id < 0) { REC.items.shift(); return; } }
    const p = A.tapPointFor(it.id);
    if (!p) { REC.items.shift(); return; }
    it.pt = { x: p.x, y: p.y };
    const h = REC.hand, e = handPos();
    h.fx = e.x; h.fy = e.y; h.tx = p.x; h.ty = p.y; h.mt = REC.t;
  }
  if (REC.t < it.t || !it.pt || S.screen !== 'play' || !sessFree(s)) return;
  if (!it.cover && !canPullOk(s.puz, s.st, it.id)) {
    // Rule state diverged from the plan (should not happen): re-plan from here, keep the timing.
    const L = lineFrom(s, s.st).line, rest = REC.items.filter(x => !x.cover);
    REC.items = REC.items.filter(x => x.cover);
    let t = REC.t;
    L.forEach((id, i) => { t = rest[i] ? Math.max(rest[i].t, t) : t + 0.4; REC.items.push({ t, id, hold: 0.14 }); });
    REC.items.sort((a, b) => a.t - b.t);
    return;
  }
  REC.items.shift();
  if (it.key) REC.keyT = REC.t;
  A.pointer('down', it.pt.x, it.pt.y, 1);
  REC.held = { x: it.pt.x, y: it.pt.y, upAt: REC.t + it.hold };
  REC.lastTapT = Math.max(REC.lastTapT, REC.t + it.hold);
}

// ------------------------------------------------------------------ record overlay
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function handPos() {
  const h = REC.hand;
  const k = ease((REC.t - h.mt) / 0.3);
  return { x: h.fx + (h.tx - h.fx) * k, y: h.fy + (h.ty - h.fy) * k };
}
function uOf(S) { return (S.L && S.L.u) || Math.min(S.W / 390, S.H / 700, 2.6); }

function drawRecOverlay(g, S) {
  const t = REC.t, u = uOf(S);
  const s = S.sess;
  // Scripted hand (hidden once the level is over).
  const handOn = t > 0.15 && t < REC.lastTapT + 0.6 && S.screen === 'play' && !(s && s.result);
  if (handOn) {
    const p = handPos();
    const fade = Math.min(1, (t - 0.15) / 0.25, (REC.lastTapT + 0.6 - t) / 0.3);
    g.save();
    g.globalAlpha *= Math.max(0, fade);
    drawHand(g, p.x, p.y, u, !!REC.held);
    g.restore();
  }
  // Captions (one at a time; the HUD hides under the caption band).
  if (t < 3.5 && HOOK) caption(g, S, HOOK, Math.min(1, t / 0.2, (3.5 - t) / 0.3));
  else if (CAP2 && t < ENDCARD_T) {
    const bt = s && s.st ? s.st.bt : 0, cap = s && s.puz ? effCap(s.puz, s.st) : 4;
    if (REC.cap2On == null && t >= 10.5 && bt >= cap - 1) REC.cap2On = t;
    if (REC.cap2On == null && t >= 14.6 && REC.keyT == null) REC.cap2On = t; // never hit cap-1: fall back to the slot
    if (REC.cap2On != null && REC.cap2Off == null && REC.keyT != null) REC.cap2Off = REC.keyT + 0.35;
    if (REC.cap2On != null && REC.cap2Off == null && REC.keyT == null && bt < cap - 1 && t > REC.cap2On + 0.5) REC.cap2Off = t; // HUD no longer says it
    if (REC.cap2On != null && t >= REC.cap2On && (REC.cap2Off == null || t < REC.cap2Off + 0.3) && t < 16.5) {
      const a = Math.min(1, (t - REC.cap2On) / 0.18, REC.cap2Off == null ? 1 : (REC.cap2Off + 0.3 - t) / 0.3);
      caption(g, S, CAP2, a);
    }
  }
  if (t >= ENDCARD_T) endCard(g, S, t);
}

function drawHand(g, x, y, u, press) {
  if (Rn.drawHand) {
    try { Rn.drawHand(g, x, y, u * 1.25, press); return; } catch (e) { P.error(e); }
  }
  // Fallback hand: a cream fingertip with an ink outline and a press ring.
  const s = u * 1.25;
  g.save();
  g.translate(x, y);
  if (press) { g.strokeStyle = 'rgba(255,244,228,.85)'; g.lineWidth = 3 * s; g.beginPath(); g.arc(0, 0, 16 * s, 0, 7); g.stroke(); }
  g.scale(press ? 0.9 : 1, press ? 0.9 : 1);
  g.fillStyle = '#FFF4E4'; g.strokeStyle = '#2B2440'; g.lineWidth = 2.5 * s; g.lineJoin = 'round';
  g.beginPath();
  g.roundRect ? g.roundRect(-6 * s, -2 * s, 12 * s, 26 * s, 6 * s) : g.rect(-6 * s, -2 * s, 12 * s, 26 * s);
  g.roundRect ? g.roundRect(-14 * s, 16 * s, 30 * s, 28 * s, 10 * s) : g.rect(-14 * s, 16 * s, 30 * s, 28 * s);
  g.fill(); g.stroke();
  g.restore();
}

function hudBottom(S) {
  const h = S.L && S.L.hud;
  return h ? h.y + h.h : 52 * uOf(S);
}
function caption(g, S, text, alpha) {
  if (alpha <= 0) return;
  const W = S.W, lines = String(text).split('|').slice(0, 3);
  let fs = 78;
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, alpha));
  const font = n => `${n}px "Lilita One", "Nunito", sans-serif`;
  g.font = font(fs);
  const widest = () => Math.max(...lines.map(l => g.measureText(l).width));
  while (fs > 40 && widest() > W - 96) { fs -= 2; g.font = font(fs); }
  const lh = fs * 1.08, blockH = lines.length * lh;
  const hb = hudBottom(S);
  const top = Math.max(18, Math.min(0.22 * S.H - blockH - 10, hb / 2 - blockH / 2 + 14));
  // Scrim hides the HUD band and keeps the caption readable over the scene.
  const grd = g.createLinearGradient(0, 0, 0, top + blockH + 46);
  grd.addColorStop(0, 'rgba(26,17,40,0.94)');
  grd.addColorStop(Math.min(0.95, (hb + 4) / (top + blockH + 46)), 'rgba(26,17,40,0.90)');
  grd.addColorStop(1, 'rgba(26,17,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, top + blockH + 46);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16; // 8 px stroke outside the glyph
  g.strokeStyle = '#2B2440';
  g.fillStyle = '#FFF4E4';
  lines.forEach((l, i) => {
    const y = top + lh * (i + 0.5);
    g.strokeText(l, W / 2, y);
    g.fillText(l, W / 2, y);
  });
  g.restore();
}

function endCard(g, S, t) {
  const W = S.W, H = S.H, a = Math.min(1, (t - ENDCARD_T) / 0.45), k = W / 1080;
  g.save();
  g.globalAlpha = a;
  let drew = false;
  if (Sc.drawTitleScene) { try { Sc.drawTitleScene(g, W, H, t, 'pumpkin'); drew = true; } catch (e) { P.error(e); } }
  if (!drew) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#2A1F45'); grd.addColorStop(1, '#5B3A6E');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  g.fillStyle = 'rgba(26,17,40,0.38)';
  g.fillRect(0, 0, W, H);
  // Logo.
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const pop = 1 + 0.06 * Math.max(0, 1 - (t - ENDCARD_T) / 0.35);
  const logo = (txt, y, fs) => {
    g.font = `${fs * pop}px "Lilita One", sans-serif`;
    g.lineWidth = 26 * k; g.strokeStyle = '#2B2440'; g.strokeText(txt, W / 2, y);
    g.fillStyle = '#FFF4E4'; g.fillText(txt, W / 2, y);
  };
  logo('Knot', H * 0.17, 210 * k);
  logo('Kitty', H * 0.28, 210 * k);
  // Tomato yarn swoosh under the logo.
  g.strokeStyle = '#2B2440'; g.lineWidth = 22 * k; g.lineCap = 'round';
  const yarn = () => { g.beginPath(); g.moveTo(W * 0.2, H * 0.345); g.bezierCurveTo(W * 0.4, H * 0.375, W * 0.6, H * 0.315, W * 0.8, H * 0.345); g.stroke(); };
  yarn(); g.strokeStyle = '#E8463A'; g.lineWidth = 14 * k; yarn();
  // Heroes.
  const bob = Math.sin(t * 3) * 6 * k;
  if (Rn.drawKitty) { try { Rn.drawKitty(g, W * 0.5, H * 0.56 + bob, 2.6 * k * 1.6, 'celebrate', t, 'pumpkin'); } catch (e) { P.error(e); } }
  // Call to action.
  g.font = `800 ${54 * k}px Nunito, sans-serif`;
  g.lineWidth = 12 * k; g.strokeStyle = '#2B2440'; g.fillStyle = '#FFF4E4';
  g.strokeText('play free, no download →', W / 2, H * 0.75);
  g.fillText('play free, no download →', W / 2, H * 0.75);
  const url = 'arcadeaday.com/knot-kitty';
  g.font = `${66 * k}px "Lilita One", sans-serif`;
  const pw = g.measureText(url).width + 90 * k, ph = 116 * k, px = W / 2 - pw / 2, py = H * 0.82;
  const pill = (y, col) => { g.beginPath(); g.roundRect ? g.roundRect(px, y, pw, ph, ph / 2) : g.rect(px, y, pw, ph); g.fillStyle = col; g.fill(); };
  pill(py + 8 * k, '#B8322A'); pill(py, '#E8463A');
  g.lineWidth = 6 * k; g.strokeStyle = '#2B2440'; g.stroke();
  g.fillStyle = '#FFF4E4'; g.fillText(url, W / 2, py + ph / 2 + 2 * k);
  g.restore();
}

// ================================================================== ?og=1  (GDD §12.2)
const OG = { ready: false };
function installOG() {
  whenBooted(async () => {
    await fontsReady();
    prepShowcaseSave(LV);
    try {
      A.resize(1200, 630, 1);
      A.go('play', { kind: 'level', id: LV });
      const s = A.S.sess;
      if (s && s.puz) {
        // ~40 % cleared along the solver line, through the real input path.
        const L = lineFrom(s, s.st).line;
        const goal = Math.ceil(s.puz.n * 0.4);
        for (const id of L) {
          if (s.st.count != null ? s.st.count >= goal : popcount(s.st.removed) >= goal) break;
          for (let i = 0; i < 240 && !sessFree(A.S.sess); i++) A.step(1 / FPS);
          const p = A.tapPointFor(id);
          if (!p) break;
          A.tapAt(p.x, p.y);
          for (let i = 0; i < 4; i++) A.step(1 / FPS);
        }
        for (let i = 0; i < 90; i++) A.step(1 / FPS);
      }
    } catch (e) { P.error(e); }
    OG.ready = true;
    window.__ogReady = true;
  });
}
const popcount = m => { let c = 0; for (m >>>= 0; m; m &= m - 1) c++; return c; };

// ================================================================== ?qa=1  (GDD §11)
let QI = { sig: '', id: -1, T: -9, btnAt: 0 }, QL = { puz: null, line: [], sigs: [] }, BOT = null;

function installQA() {
  const W = window;
  W.__qa = () => {
    const S = A.S, s = S.sess;
    return {
      t: S.TL != null ? S.TL : S.T, T: S.T, mode: S.screen, // t = loop clock (host pause freezes it); T = gameplay time
      level: s ? (s.kind === 'level' ? s.id : 0) : safe(() => M.cur(), 1),
      progress: safe(() => M.progress(), 0) | 0,
      score: P.data ? P.data.best | 0 : 0,
      env: P.env,
    };
  };
  W.__qaInput = qaInput;
  W.__S = A.S; W.__api = A; // QA-only: state peek + api for test drivers
  W.__qaOldSave = () => (M.qaOldSave ? M.qaOldSave() : { save: '{"v":0,"best":0,"at":3}', progress: 3 });
  W.__qaLevel = (id, kind = 'level') => { A.go('play', { kind, id }); return W.__qa(); };
  W.__qaSolve = () => {
    const s = A.S.sess;
    return s && s.st ? lineFrom(s, s.st, 600000).line.slice() : [];
  };
  W.__qaState = () => {
    const s = A.S.sess;
    if (!s || !s.st) return null;
    const st = s.st;
    return { removed: st.removed, bt: st.bt, peak: st.peak, basket: st.basket.slice(), sc: st.sc.slice(), sn: st.sn.slice(),
      next: st.next, moves: st.moves, stuck: !!s.stuck, doomed: !!s.doomed, spoolBusy: !!s.spoolBusy,
      cap: effCap(s.puz, st), par: s.level ? s.level.par : null, legal: legal(s.puz, st), n: s.puz.n };
  };
  W.__qaTap = id => {
    const p = A.tapPointFor(id);
    if (!p) return null;
    const o = offset();
    return { x: p.x + o.x, y: p.y + o.y };
  };
  W.__qaBot = (kind = 'expert', seed = 7) => new Promise(res => {
    if (BOT) BOT.res({ win: false, aborted: true });
    BOT = { kind, r: R.rng ? R.rng(seed) : Math.random, next: A.S.T + 0.15, res, taps: 0 };
  });
  W.__qaPlan = (seed = SEED, ms = 2000) => {
    const s = A.S.sess;
    if (!s) return null;
    const p = planShow(s, s.st, seed, ms);
    return { line: p.line, k: p.k, chain: p.chain, peak: p.peak, stars: p.stars, score: p.score, tries: p.tries, wins: p.wins,
      items: scheduleShow(p).map(x => ({ t: x.t, id: x.id, cover: !!x.cover, key: !!x.key })) };
  };
  if (LV_PARAM) whenBooted(() => A.go('play', { kind: 'level', id: LV_PARAM }));
}

function offset() {
  const c = canvasEl();
  if (!c || !c.getBoundingClientRect) return { x: 0, y: 0 };
  const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top };
}
const tapAct = (x, y) => { const o = offset(); return { type: 'tap', x: x + o.x, y: y + o.y }; };

// Buttons: scan S.ui for {x,y,w,h} objects with a label (UI owns the shapes; we only read them).
const LABEL_KEYS = ['label', 'text', 'name', 'id', 'key', 'act', 'action', 'kind', 'title', 'icon'];
function findButton(S, re) {
  const seen = new Set(), found = [];
  const rectOf = o => {
    if (['x', 'y', 'w', 'h'].every(k => Number.isFinite(o[k]))) return o;
    for (const k of ['r', 'rect', 'box']) if (o[k] && ['x', 'y', 'w', 'h'].every(j => Number.isFinite(o[k][j]))) return o[k];
    return null;
  };
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || seen.has(o) || d > 5) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    const rc = rectOf(o);
    if (rc && rc.w > 4 && rc.h > 4 && !o.hidden && !o.disabled && o.visible !== false && o.on !== false) {
      const label = LABEL_KEYS.map(k => (typeof o[k] === 'string' ? o[k] : '')).join(' ').trim();
      if (label || o.primary) found.push({ rc, label, primary: !!o.primary });
    }
    for (const k in o) if (k !== 'parent' && typeof o[k] === 'object') walk(o[k], d + 1);
  };
  walk(S.ui, 0);
  const inView = f => f.rc.x + f.rc.w > 0 && f.rc.y + f.rc.h > 0 && f.rc.x < S.W && f.rc.y < S.H;
  const ok = found.filter(inView);
  const hit = re ? ok.filter(f => re.test(f.label)) : [];
  const pick = hit.find(f => f.primary) || hit[0] || (!re ? ok.find(f => f.primary) : null);
  return pick ? pick.rc : null;
}

const BTN = { title: /^\s*play\b/i, map: /^\s*play\b/i, win: /\bnext\b/i, lose: /\bretry\b/i, pause: /\bresume\b/i,
  allbeaten: /\bmap\b/i };
function qaInput() {
  const S = A.S;
  if (!S || !P.data) return [];
  const scr = S.screen;
  if (scr === 'loading') return [];
  if (scr === 'play') return playInput(S);
  // Menus and cards: tap the screen's button, at most every 0.6 s of real time.
  const now = Date.now();
  if (now - QI.btnAt < 600) return [];
  QI.btnAt = now;
  const b = findButton(S, BTN[scr] || null);
  if (b) return [tapAct(b.x + b.w / 2, b.y + b.h / 2)];
  // No readable button: drive the state machine directly.
  try {
    if (scr === 'title') {
      if (safe(() => M.progress(), 0) > 0) A.go('map');
      else A.go('play', { kind: 'level', id: 1 });
    } else if (scr === 'map') A.go('play', { kind: 'level', id: Math.min(LEVELS, safe(() => M.cur(), 1)) });
    else if (scr === 'win') A.next();
    else if (scr === 'lose') A.retry();
    else if (scr === 'pause') A.resume();
    else A.go('map');
  } catch (e) { P.error(e); }
  return [];
}

function playInput(S) {
  const s = S.sess;
  if (!s || !s.st || !sessFree(s) || levelOver(s)) return [];
  const id = nextQaMove(s);
  if (id == null || id < 0) return [];
  const sig = sigOf(s.st);
  if (QI.sig === sig && QI.id === id && S.T - QI.T < 1.0) return []; // already sent; give it a moment
  const p = A.tapPointFor(id);
  if (!p) return [];
  QI.sig = sig; QI.id = id; QI.T = S.T;
  return [tapAct(p.x, p.y)];
}

function nextQaMove(s) {
  const sig = sigOf(s.st);
  let i = QL.puz === s.puz ? QL.sigs.indexOf(sig) : -1;
  if (i < 0) {
    const L = lineFrom(s, s.st);
    QL = { puz: s.puz, line: L.line, sigs: L.sigs };
    i = 0;
  }
  return QL.line[i];
}

// ------------------------------------------------------------------ __qaBot: rules bots through real taps
function botPick(kind, puz, st, r) {
  const moves = legal(puz, st);
  if (!moves.length) return -1;
  const pick = a => a[(r() * a.length) | 0];
  if (kind === 'random') return pick(moves);
  if (kind === 'expert' || kind === 'solver') {
    const h = safe(() => R.hintMove(puz, st, 150000), -1);
    return h >= 0 && moves.includes(h) ? h : pick(moves);
  }
  const fit = moves.filter(id => !goesToBasket(puz, st, id));
  if (kind === 'casual') return fit.length && r() < 0.85 ? pick(fit) : pick(moves);
  // average
  if (fit.length) {
    let best = fit[0], bf = -1;
    for (const id of fit) {
      const d = R.destOf ? R.destOf(puz, st, id) : [];
      const f = d.length && d[0].slot != null ? st.sn[d[0].slot] : 0;
      if (f > bf) { bf = f; best = id; }
    }
    return best;
  }
  const nx = spoolAt(puz, st.next);
  const want = moves.filter(id => nx && colorOf(puz, id) === nx.c);
  if (want.length) return pick(want);
  const pair = moves.filter(id => st.basket.includes(colorOf(puz, id)));
  return pick(pair.length ? pair : moves);
}
function botTick(S) {
  const s = S.sess;
  const done = win => { const b = BOT; BOT = null; b.res({ win, peak: s && s.st ? s.st.peak : null, moves: s && s.st ? s.st.moves : 0, taps: b.taps }); };
  if (S.screen === 'win') return done(true);
  if (S.screen === 'lose' || !s || !s.st) return done(false);
  if (S.screen !== 'play' || S.T < BOT.next || !sessFree(s) || levelOver(s)) return;
  const id = botPick(BOT.kind, s.puz, s.st, BOT.r);
  if (id < 0) return;
  const p = A.tapPointFor(id);
  if (!p) return done(false);
  A.tapAt(p.x, p.y);
  BOT.taps++;
  BOT.next = S.T + 0.15 + BOT.r() * 0.1; // ~human reaction lag, on game time
}
