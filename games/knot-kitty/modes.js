// Knot Kitty: special page modes (GDD §11 ?qa=1, §12 ?record=1 / ?og=1, §13.9; PLAYBOOK §6).
// Owner: Modes. Receives `api` from game.js; never imports game.js / play.js.
//
// DECISION: sibling modules are imported as namespaces (`import * as R`), so a missing optional export
//   degrades one feature instead of failing the whole module graph at link time.
// DECISION: ?record=1 and ?og=1 never write the player's save: P.save / P.flush become no-ops in those
//   modes, and the showcase save tweaks (L1-19 at 3 stars, Pumpkin Sweater worn, gifts/chests/tutorials
//   marked done so no popup interrupts the take) live only in memory.
// DECISION: ?record=1 / ?og=1 (default level only) swap L20's board in memory for SHOWCASE below: an 18-strand
//   pumpkin with par 3, so the CHAIN x3 climax (three balls waiting in a cap-4 basket) is also a clean 3-star win.
//   It is patched onto the levels-data.js object before the session is built; normal play never sees it.
// DECISION: record/og swallow the events that raise UI band callouts (basketWarn, full, doomed, hint...) before they
//   reach listeners (still logged for the soundtrack), so the take shows exactly one caption at a time. In record the
//   chain/coins pops are held back too: the take draws its own full-frame CHAIN xN! pop (see the ?record=1 notes).
// DECISION: cap2 ("1 slot left") is shown only while the basket really sits at cap-1 (PLAYBOOK lesson:
//   a number caption must agree with the HUD on every frame), from the hover right before the key pull.
// DECISION: the scripted hand is drawn for every scripted tap (playable-ad style), not only the first.
// DECISION: the showcase board carries its picked line (SHOWCASE.show); other boards (?lv=) use planShow's seeded
//   search. The take's runtime is adaptive (build pulls spread so the key press lands at KEY_AT), not a fixed schedule.
// DECISION: record/OG audio = the logged bus events handed to audio.js as {t, name: busEvent, args: data},
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
import LVDATA from './levels-data.js';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const on = k => Q.get(k) === '1' || Q.get(k) === 'true';
const REC_ON = on('record');
export const active = { record: REC_ON, og: on('og') && !REC_ON, qa: on('qa') || !!P.qa };

const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const LV_PARAM = Q.has('lv') ? int(Q.get('lv'), 20, 1, LEVELS) : null;
const LV = LV_PARAM || 20;
const SEED = int(Q.get('seed'), 1, 0, 1e9);
const HOOK = Q.has('hook') ? Q.get('hook') : 'Untie her in the|RIGHT order 🧶';
const CAP2 = Q.has('cap2') ? Q.get('cap2') : '1 slot left…|which one? 😬';
const FPS = 60;
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
const sessFree = s => s && !s.spoolBusy && s.buffered == null && !(s.queue && s.queue.length) && !s.press;
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

// ================================================================== showcase board (record / og)
// 18 strands on a 9x10 pumpkin, cap 4, par 3, 6 colours, no knots (tools/knot-kitty generator, picked by planShow:
// CHAIN x3 at peak 3 = 3 stars). Applied only when no ?lv= is given.
export const SHOWCASE = {"cols":9,"rows":10,"cap":4,"shape":"pumpkin","strands":[{"pegs":[[8,5],[6,6]],"bow":-0.072,"c":1,"d":3},{"pegs":[[5,8],[4,6]],"bow":0.06,"c":2,"d":18},{"pegs":[[6.5,7],[4,8]],"bow":0.117,"c":2,"d":19},{"pegs":[[4,7],[5,5]],"bow":0.107,"c":0,"d":4},{"pegs":[[5.5,3],[7.5,6.5]],"bow":-0.105,"c":3,"d":14},{"pegs":[[7.5,4],[4.5,4]],"bow":-0.054,"c":1,"d":2},{"pegs":[[4,5],[6,8.5]],"bow":-0.056,"c":3,"d":5},{"pegs":[[4,0],[3.5,2.5]],"bow":0.109,"c":1,"d":17},{"pegs":[[2,3],[4.5,1]],"bow":-0.051,"c":2,"d":8},{"pegs":[[1.5,2],[3.5,3.5]],"bow":-0.119,"c":2,"d":0},{"pegs":[[1.5,5.5],[0.5,4]],"bow":0.058,"c":2,"d":1},{"pegs":[[2.5,4],[0.5,5.5]],"bow":0.057,"c":0,"d":7},{"pegs":[[1.5,4],[3,6.5]],"bow":-0.105,"c":0,"d":10},{"pegs":[[2,8.5],[3,5]],"bow":-0.116,"c":2,"d":11},{"pegs":[[1.5,7],[3,9]],"bow":-0.081,"c":3,"d":15},{"pegs":[[4.5,3],[6,5]],"bow":-0.07,"c":0,"d":12},{"pegs":[[6.5,3],[5.5,1.5]],"bow":-0.112,"c":3,"d":13},{"pegs":[[6.5,2],[4.5,2]],"bow":-0.084,"c":3,"d":9},{"pegs":[[3,8],[4.5,9]],"bow":0.114,"c":0,"d":16},{"pegs":[[5,0],[2.5,1.5]],"bow":-0.062,"c":0,"d":6}],"queue":[3,2,3,1,2,0,0],"par":3,"sol":[2,1,4,6,14,13,0,7,16,17,8,9,15,5,12,11,10,3,18,19],"show":[16,14,2,13,1,17,7,6,15,4,5,0,8,9,12,11,10,3,18,19]};
const SHOW_ON = (REC_ON || on('og')) && !LV_PARAM && !on('real');
function applyShowcase() {
  if (!SHOW_ON || !SHOWCASE || !Array.isArray(LVDATA)) return false;
  const o = LVDATA.find(l => l && l.id === LV);
  if (!o || Object.isFrozen(o)) return false;
  for (const key of Object.keys(o)) if (!['id', 'name', 'world'].includes(key)) delete o[key]; // no stray knots/locks
  Object.assign(o, JSON.parse(JSON.stringify(SHOWCASE)));
  return true;
}
// Events that make UI raise a band callout. Record/og keep one caption on screen at a time (the take's own), so
// these are logged (soundtrack) but not delivered to listeners. Chain pops (+1 / CHAIN xn!) still come from UI; spoolDone
// is held back too, because its COMBO pop would replace the CHAIN x3 climax pop in the same frame.
const MUTED = new Set(['basketWarn', 'full', 'doomed', 'hint', 'thaw', 'booster', 'boosterRefused', 'stuck', 'spoolDone']);

// ================================================================== ?record=1  (GDD §12.1, PLAYBOOK §6)
// Polish cut (~23 s, loops). Video time REC.t runs at a fixed 60 fps; GAME time runs through a speed curve
// (build 1.6x, slam 2.6x, ball flight 1.5x, hit-stop + slow-mo on the CHAIN, rescue 0.95x, win card 1.25x), so the
// beats land where a Short needs them while the soundtrack (logged against video time) stays in sync:
//   0.0  hook band + a big tied-up kitten with a "Help!" bubble; first pull ~0.1 s, sad meow on frame 0
//   2.1  kitten shrinks back onto her ledge     3.0 stakes caption (mid=)
//   ~7.6 basket at cap-1: "1 slot left" (cap2=) while the hand hesitates over a decoy ("which one?")
//   ~8.2 key pull -> three balls slam the spool in ~0.4 s -> hit-stop, white flash, shake, huge CHAIN x3! (the caption)
//   cap3 over the last pulls while the camera pushes in; kittenFree -> rescue zoom, big hearts, FREE band
//   win card, end card, then the last 0.5 s crossfades into frame 0 so the Short loops cleanly.
// 'over' = end card + END_HOLD; tools/record.mjs keeps a 3.5 s tail after it (TAIL below must match --tail).
// DECISION: the take renders at dpr 1.6 (1728x3072 backing store, under MAX_PIXELS) and recFrame downsamples to
//   1080x1920, so the camera push-ins (raster crops of the finished frame) stay sharp. The kitten and hand are
//   re-drawn as vectors on top of the crop.
// DECISION: 'chain' and 'coins' reach no listeners in record (still logged for the soundtrack): UI's small rack pop
//   would double up with the take's own full-frame CHAIN pop.
// DECISION: the soundtrack is mastered here (audio.renderBuffer -> BS.1770 integrated loudness -> gain to -14 LUFS
//   -> 4 ms look-ahead limiter at -1.5 dBFS), since audio.js's own volumes clamp at 1.0 (~ -27 dBFS raw).
const MID = Q.has('mid') ? Q.get('mid') : 'Basket fills up =|she stays stuck 😿';
const CAP3 = Q.has('cap3') ? Q.get('cap3') : 'Almost free… 🥺';
const FREED = Q.has('free') ? Q.get('free') : 'She’s FREE! 😻';
const num = (k, d, lo, hi) => { const v = parseFloat(Q.get(k)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const KEY_AT = num('key', 8.2, 3, 20); // video time of the key press
const REC_DPR = num('rdpr', 1.6, 1, 2.5);
const SPD = { build: 1.6, slam: 2.6, ball: 1.5, post: 1.45, rescue: 0.85, win: 1.25 };
const HOOK_END = 3.0, HERO_OUT = 2.1, HOVER = 0.75, GAP_MIN = 0.34, GAP_MAX = 0.8, GAP_AFTER = 0.42;
const POP_DUR = 1.35, WIN_HOLD = 4.0, END_HOLD = 2.2, TAIL = 3.5, LOOP_X = 0.5, LUFS = -14, CEIL_DB = -1.5;
const REC_MUTED = new Set(['chain', 'coins']);
const HERO_MEM = {};
const REC = { ready: false, t: 0, frames: 0, log: [], plan: null, line: [], k: -1, i: 0, hand: null, held: null, aim: null,
  lastFire: -9, keyT: null, popT: null, pop: null, chainMax: 0, cap2On: null, hover: null, hov0: null, freeT: null, winT: null,
  endT: null, overT: null, spd: 1, cam: null, camFree: null, snap: null, buf: null, out: null, pulls: [], loud: null };

function installRecord() {
  window.__rec = { step: recStep, frame: recFrame, audio: recAudio };
  window.__recDbg = () => ({ keyT: REC.keyT, popT: REC.popT, cap2On: REC.cap2On, freeT: REC.freeT, winT: REC.winT, endT: REC.endT,
    overT: REC.overT, chainMax: REC.chainMax, pulls: REC.pulls, loud: REC.loud, dpr: A.S.dpr });
  // Log every bus event against record (video) time for the offline soundtrack; callout/pop events stop here.
  const emit0 = bus.emit;
  bus.emit = (t, d) => {
    if (REC.ready) {
      REC.log.push({ t: REC.t, ev: t, data: d == null ? d : { ...d } });
      if (t === 'chain' && d) onChain(d);
      if (t === 'pull') REC.pulls.push(+REC.t.toFixed(2));
      if (t === 'kittenFree' && REC.freeT == null) REC.freeT = REC.t;
      if (MUTED.has(t) || REC_MUTED.has(t)) return;
    }
    return emit0.call(bus, t, d);
  };
  whenBooted(async () => {
    await fontsReady();
    prepShowcaseSave(LV);
    REC.showcase = applyShowcase();
    A.resize(1080, 1920, REC_DPR);
    A.go('play', { kind: 'level', id: LV });
    const s = A.S.sess;
    const t0 = performance.now();
    REC.plan = planShow(s, s.st, SEED, 2500);
    REC.planMs = Math.round(performance.now() - t0);
    REC.line = REC.plan.line.slice();
    REC.k = REC.plan.chain >= 2 ? REC.plan.k : -1;
    const W = A.S.W, H = A.S.H;
    REC.hand = { fx: W * 0.82, fy: H * 0.97, tx: W * 0.82, ty: H * 0.97, mt: -1, dur: 0.25 };
    // Frame 0 already shows the hand resting on the first strand: the press lands on the first stepped frame.
    const p0 = REC.line.length ? A.tapPointFor(REC.line[0]) : null;
    if (p0) { const h = REC.hand; h.fx = h.tx = p0.x; h.fy = h.ty = p0.y; REC.aim = { i: 0, x: p0.x, y: p0.y, at: 0 }; }
    REC.ready = true;
    A.step(0); // draw frame 0 (hook band + hero kitten + board) before the first step
    REC.snap = copyCanvas(REC.snap); // the loop crossfade lands on exactly this frame
    window.__recPlan = { line: REC.plan.line, key: REC.plan.k, chain: REC.plan.chain, peak: REC.plan.peak, stars: REC.plan.stars,
      ms: REC.planMs, score: Math.round(REC.plan.score), showcase: REC.showcase, n: s.puz.n, dpr: A.S.dpr };
    window.__recReady = true;
  });
}
// Contract 1: chain {n, combo} on every ball landing (n = balls absorbed by that spool so far); older play.js sends {m}.
function onChain(d) {
  const n = (d.n != null ? d.n : d.m) | 0;
  REC.chainMax = Math.max(REC.chainMax, n);
  if (n >= 3 && REC.popT == null) { REC.popT = REC.t; REC.pop = { n, t: REC.t }; }
  else if (REC.pop && n > REC.pop.n && REC.t - REC.pop.t < 0.3) REC.pop.n = n; // a 4th ball right behind the 3rd
}

function recState() {
  const S = A.S, s = S.sess;
  const stars = P.data && Array.isArray(P.data.stars) ? P.data.stars.reduce((a, b) => a + (b | 0), 0) : 0;
  return { t: REC.t, mode: REC.overT != null && REC.t >= REC.overT - 1e-6 ? 'over' : S.screen, score: stars, dead: false,
    pulls: s && s.st ? s.st.moves : 0, basket: s && s.st ? s.st.bt : 0 };
}

// Game-time speed for the next frame (video time is always 1/60 s per frame).
function gameSpeed(t) {
  if (REC.endT != null && t >= REC.endT) return 1;
  if (REC.winT != null) return SPD.win;
  if (REC.freeT != null) return SPD.rescue;
  if (REC.popT != null) {
    const a = t - REC.popT;
    if (a < 0.12) return 0.05; // hit-stop on the slam
    if (a < 0.95) return 0.3 + (SPD.post - 0.3) * ease((a - 0.12) / 0.83); // slow-mo ramp back up under the pop
    return SPD.post;
  }
  if (REC.keyT != null) return ballsFlying() ? SPD.ball : SPD.slam;
  return SPD.build;
}
function ballsFlying() {
  const S = A.S, s = S.sess;
  return !!(s && Array.isArray(s.flights) && s.flights.some(f => f && f.kind === 'ball' && !f.wait && S.T >= f.t0 - 0.03));
}
function recStep(n = 1) {
  if (!REC.ready) return recState();
  for (let i = 0; i < n; i++) {
    runScript();
    REC.spd = gameSpeed(REC.t);
    A.step(REC.spd / FPS);
    REC.frames++;
    REC.t = REC.frames / FPS;
    if (REC.winT == null && A.S.screen === 'win') REC.winT = REC.t;
    if (REC.endT == null && (REC.winT != null || REC.t >= 21)) {
      REC.endT = REC.winT != null ? REC.winT + WIN_HOLD : REC.t; // no win by 21 s: cut to the end card anyway
      REC.overT = REC.endT + END_HOLD;
    }
  }
  return recState();
}

function copyCanvas(into) {
  const c = canvasEl();
  if (!c || !c.width || typeof document === 'undefined' || !document.createElement) return null;
  const o = into || document.createElement('canvas');
  if (o.width !== c.width || o.height !== c.height) { o.width = c.width; o.height = c.height; }
  const x = o.getContext && o.getContext('2d');
  if (!x) return null;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(c, 0, 0);
  return o;
}
// Frames go out at the take's logical size (1080x1920), downsampled from the dpr-1.6 backing store.
function recFrame(q = 0.92) {
  const c = canvasEl();
  if (!c) return '';
  const W = A.S.W, H = A.S.H;
  if (c.width && c.width !== W && typeof document !== 'undefined' && document.createElement) {
    const o = REC.out || (REC.out = document.createElement('canvas'));
    if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
    const x = o.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, W, H);
    return o.toDataURL('image/jpeg', q);
  }
  return c.toDataURL('image/jpeg', q);
}

// Soundtrack: the logged bus events go to audio.js as {t, name: busEvent, args: data}; audio.js maps them with its own
// live handlers (same sounds as play). Events audio.js doesn't know fall back to §8.2 SFX names.
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
  tl.unshift({ t: 0, name: 'meow', args: ['sad'] }); // the hook frame speaks: "Help!"
  if (REC.freeT != null) tl.push({ t: REC.freeT + 0.35, name: 'purr', args: [] });
  tl.world = world;
  if (typeof Au.renderBuffer === 'function') {
    try {
      const buf = await Au.renderBuffer(tl, dur, world);
      if (buf && buf.getChannelData) return wavOf(master(buf));
    } catch (e) { P.error(e); }
  }
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
  return b64Of(u);
}
function b64Of(u) {
  let str = '';
  for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(str);
}
function wavOf({ chs, sr }) {
  const ch = chs.length, n = chs[0].length, bytes = 44 + n * ch * 2;
  const u = new Uint8Array(bytes), v = new DataView(u.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) u[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, bytes - 8, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, chs[c][i] || 0));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  return b64Of(u);
}

// ---- mastering: BS.1770-4 integrated loudness (K-weighted, 400 ms blocks, -70 / -10 LU gates), gain, limiter.
function biquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], yi = c[0] * xi + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}
function kWeights(sr) {
  let Q = 0.7071752369554193, fc = 1681.9744509555319, w = 2 * Math.PI * fc / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
  const A = 10 ** (3.99984385397 / 40), sA = Math.sqrt(A);
  let a0 = (A + 1) - (A - 1) * cs + 2 * sA * al;
  const shelf = [A * ((A + 1) + (A - 1) * cs + 2 * sA * al) / a0, -2 * A * ((A - 1) + (A + 1) * cs) / a0,
    A * ((A + 1) + (A - 1) * cs - 2 * sA * al) / a0, 2 * ((A - 1) - (A + 1) * cs) / a0, ((A + 1) - (A - 1) * cs - 2 * sA * al) / a0];
  Q = 0.5003270373253953; fc = 38.13547087613982; w = 2 * Math.PI * fc / sr; cs = Math.cos(w); al = Math.sin(w) / (2 * Q); a0 = 1 + al;
  const hp = [(1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0];
  return [shelf, hp];
}
function loudness(chs, sr) {
  const [sh, hp] = kWeights(sr), n = chs[0].length;
  const pre = chs.map(x => {
    const y = biquad(biquad(x, sh), hp), p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + y[i] * y[i];
    return p;
  });
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), z = [];
  for (let s = 0; s + blk <= n; s += hop) { let m = 0; for (const p of pre) m += (p[s + blk] - p[s]) / blk; z.push(m); }
  const L = m => -0.691 + 10 * Math.log10(Math.max(1e-12, m));
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  let g = z.filter(m => L(m) > -70);
  if (!g.length) return -70;
  const rel = L(mean(g)) - 10;
  g = g.filter(m => L(m) > rel);
  return g.length ? L(mean(g)) : -70;
}
function limiter(chs, sr, ceil) {
  const n = chs[0].length, la = Math.max(1, Math.round(0.004 * sr)), rel = 1 - Math.exp(-1 / (0.06 * sr));
  const g = new Float32Array(n);
  let cur = 1;
  for (let i = n - 1; i >= 0; i--) { // backward: the gain is already down `la` samples before a peak
    let p = 0;
    for (const x of chs) { const a = Math.abs(x[i]); if (a > p) p = a; }
    cur = Math.min(p > ceil ? ceil / p : 1, cur + 1 / la);
    g[i] = cur;
  }
  cur = g[0];
  for (let i = 0; i < n; i++) { cur = Math.min(g[i], cur + (1 - cur) * rel); for (const x of chs) x[i] *= cur; } // forward: 60 ms release
}
function master(buf) {
  const sr = buf.sampleRate, chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(Float32Array.from(buf.getChannelData(c)));
  const ceil = 10 ** (CEIL_DB / 20), L0 = loudness(chs, sr);
  let L = L0;
  for (let it = 0; it < 4 && L > -60 && Math.abs(L - LUFS) > 0.25; it++) {
    const gn = 10 ** (Math.min(30, LUFS - L) / 20);
    for (const x of chs) for (let i = 0; i < x.length; i++) x[i] *= gn;
    limiter(chs, sr, ceil);
    L = loudness(chs, sr);
  }
  let pk = 0;
  for (const x of chs) for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  REC.loud = { inLUFS: +L0.toFixed(1), outLUFS: +L.toFixed(1), peakDb: +(20 * Math.log10(pk || 1e-9)).toFixed(2) };
  return { chs, sr };
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
  // The showcase board carries its picked line, so the take is identical on every machine (the search is time-boxed).
  const fixed = sess.level && Array.isArray(sess.level.show) ? sess.level.show : null;
  if (fixed && !Q.has('seed')) {
    const st = R.cloneState(st0), info = [];
    let ok = true;
    for (const id of fixed) {
      if (!canPullOk(puz, st, id)) { ok = false; break; }
      const ev = [], b0 = st.bt;
      R.pull(puz, st, id, ev);
      info.push({ ...chainOf(ev), bt0: b0, bt: st.bt });
    }
    if (ok && R.isWon(puz, st)) return { line: fixed.slice(), info, ...scoreLine(fixed, info, puz, par, st0), tries: 0, wins: 1, fixed: true };
  }
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

// Beat sheet targets (s). One action at least every ~1.1 s from 0.6 to the win: no dead air.
const BEAT = { first: 0.6, a: 1.5, b: 8.0, cover: 8.8, late: [9.7, 10.5, 11.3], hover: 11.95, hoverDur: 1.1, key: 13.6,
  after: 15.4, lastPull: 17.5, win: 19.8 };

function scoreLine(line, info, puz, par, st0) {
  let k = 0;
  for (let i = 1; i < info.length; i++) if (info[i].chain > info[k].chain) k = i;
  const chain = info.length ? info[k].chain : 0;
  const cap = effCap(puz, st0);
  const peak = Math.max(0, ...info.map(x => x.bt));
  const stars = R.starsFor ? R.starsFor(peak, par) : 0;
  let score = chain >= 3 ? 100 + 4 * Math.min(2, chain - 3) : chain * 20;
  score += stars >= 3 ? 60 : -30 * (3 - stars); // the take ends on a clean 3-star card
  if (peak >= cap) score -= 40; // a full basket reads as panic, not planning
  if (info[k] && info[k].bt0 === cap - 1) score += 25; // "1 slot left" right before the key pull
  let run = 0;
  for (let j = k - 1; j >= 0 && j >= k - 3; j--) if (info[j].toBasket > 0 && !info[j].completes) run++; else break;
  score += run * 6; // three pulls into the basket right before the climax
  if (run === 3 && info[k - 3].bt0 === Math.max(0, cap - 4)) score += 10; // ...climbing from an empty basket
  score -= k < 10 ? (10 - k) * 6 : 0; // too few pulls before the climax reads as luck (and leaves gaps)
  // Simulate the tap schedule with the spool hand-over waits and score where the beats land.
  const tm = simSchedule(scheduleShow({ line, k, chain }), line, info);
  score -= 12 * Math.max(0, Math.abs(tm.key - BEAT.key) - 0.4);
  score -= 15 * Math.max(0, tm.end - (BEAT.win + 0.2)); // win card (kitten freed + 1.6 s) by ~20 s: 3 stars land before 22.5
  score -= 12 * Math.max(0, (BEAT.win - 0.4) - tm.end); // ...but not early: the end card would cut a long win card
  score -= 8 * Math.max(0, tm.cover - 9.3);
  score -= 10 * Math.max(0, tm.gap - 1.15); // dead air
  if (line.length - k - 1 < 2) score -= 8;
  if (info.slice(1, Math.min(k, 8)).some(x => x.completes)) score += 8; // a spool rolls off early
  score += 4 * stars;
  return { score, k, chain, peak, stars, est: tm };
}

// Beat sheet (§12.1) -> tap times. Times are the earliest; a tap waits for spools to land (§3.4).
// Spreads ids evenly from a to b (step capped at maxStep, squeezed down to minStep; a long run spills past b).
function spread(ids, a, b, maxStep, minStep) {
  const n = ids.length;
  if (!n) return [];
  const st = n > 1 ? Math.max(minStep, Math.min(maxStep, (b - a) / (n - 1))) : 0;
  return ids.map((id, i) => ({ t: +(a + i * st).toFixed(3), id, hold: 0.14 }));
}
export function scheduleShow(plan) {
  const { line, k, chain } = plan;
  const items = [];
  if (!line.length) return items;
  items.push({ t: BEAT.first, id: line[0], hold: 0.5, first: true });
  if (chain >= 2 && k >= 2) {
    const pre = line.slice(1, k), nLate = Math.min(3, pre.length);
    const early = pre.slice(0, pre.length - nLate), late = pre.slice(pre.length - nLate);
    items.push(...spread(early, BEAT.a, BEAT.b, 1.0, 0.4));
    items.push({ t: BEAT.cover, cover: true, hold: 0.5 });
    BEAT.late.slice(3 - nLate).forEach((t, i) => items.push({ t, id: late[i], hold: 0.16 }));
    items.push({ t: BEAT.hover, hover: true, dur: BEAT.hoverDur, avoid: line[k] });
    items.push({ t: BEAT.key, id: line[k], hold: 0.24, key: true });
    items.push(...spread(line.slice(k + 1), BEAT.after, BEAT.lastPull, 0.9, 0.3)); // paced so the win card lands ~19.8 s
  } else {
    const rest = line.slice(1), half = Math.ceil(rest.length / 2);
    items.push(...spread(rest.slice(0, half), BEAT.a, BEAT.b, 1.0, 0.3));
    items.push({ t: BEAT.cover, cover: true, hold: 0.5 });
    items.push(...spread(rest.slice(half), 9.7, 17.6, 1.0, 0.3));
  }
  return items;
}

// Rough tap times for a schedule: a tap waits for the spool hand-over of the previous pull (§3.4).
function simSchedule(items, line, info) {
  const busyOf = x => (x && x.completes ? DURS.leave + DURS.enter + (x.unb ? DURS.ubDelay + DURS.ubDur * x.unb : 0) : 0);
  let free = 0, key = 0, last = 0, cover = 0, gap = 0, prev = null;
  for (const it of items) {
    if (it.hover) { prev = it.t + it.dur; continue; }
    const t = Math.max(it.t, free);
    if (prev != null && !it.key && prev !== key) gap = Math.max(gap, t - prev); // the chain after the key is the show
    prev = t;
    if (it.cover) { cover = t; free = t + it.hold + 0.05; continue; }
    const j = line.indexOf(it.id);
    if (it.key) key = t;
    last = t + it.hold;
    free = last + 0.05 + busyOf(info[j]);
  }
  return { key: +key.toFixed(2), last: +last.toFixed(2), cover: +cover.toFixed(2), gap: +gap.toFixed(2),
    end: +(free + (DUR.kittenFree ?? 1.6)).toFixed(2) };
}

// Decoy for the "which one?" hover: a free strand that would land in the basket (filling it) and isn't the key.
function pickDecoy(sess, avoid) {
  const { puz, st } = sess;
  const pt = A.tapPointFor(avoid);
  let best = -1, bs = -Infinity;
  for (const id of legal(puz, st)) {
    if (id === avoid) continue;
    const p = A.tapPointFor(id);
    if (!p) continue;
    const d = pt ? Math.hypot(p.x - pt.x, p.y - pt.y) : 300;
    const sc = (goesToBasket(puz, st, id) ? 10 : 0) - Math.abs(d - 320) / 100; // a visible move between the two
    if (sc > bs) { bs = sc; best = id; }
  }
  return best;
}

function glideTo(x, y, dur = 0.25) {
  const h = REC.hand, e = handPos();
  h.fx = e.x; h.fy = e.y; h.tx = x; h.ty = y; h.mt = REC.t; h.dur = dur;
}
function aimAt(i, id, dur) {
  const p = A.tapPointFor(id);
  if (!p) return false;
  glideTo(p.x, p.y, dur);
  REC.aim = { i, x: p.x, y: p.y, at: REC.t + dur * 0.85 };
  return true;
}
// Build pulls are spread so the key press lands at KEY_AT whatever the spool hand-overs cost on the way.
function buildGap(i) {
  if (REC.k < 0) return 0.45;
  const left = REC.k - i, end = KEY_AT - HOVER - 0.45;
  return left > 0 ? Math.max(GAP_MIN, Math.min(GAP_MAX, (end - REC.lastFire) / left)) : GAP_MIN;
}
function runScript() {
  const S = A.S, s = S.sess;
  if (!s || S.screen !== 'play') return;
  const t = REC.t;
  if (REC.held) {
    if (t >= REC.held.upAt) { A.pointer('up', REC.held.x, REC.held.y, 1); REC.held = null; }
    return;
  }
  const i = REC.i;
  if (i >= REC.line.length) return;
  const id = REC.line[i], key = i === REC.k, free = sessFree(s);
  if (key) {
    // "1 slot left… which one?": the finger circles a wrong strand, then goes for the key.
    if (!REC.hover) {
      if (!free || t < REC.lastFire + 0.3) return;
      const cap = effCap(s.puz, s.st);
      if (s.st.bt === cap - 1) REC.cap2On = t;
      const d = pickDecoy(s, id), p = d >= 0 ? A.tapPointFor(d) : null;
      REC.hover = { t0: t, t1: t + (p ? HOVER : 0.2) };
      REC.hov0 = t;
      if (p) glideTo(p.x + 10, p.y + 10, 0.22);
      return;
    }
    if (t < REC.hover.t1) return;
    if (!REC.aim || REC.aim.i !== i) { if (!aimAt(i, id, 0.2)) REC.i++; return; }
  } else {
    if (!REC.aim || REC.aim.i !== i) { if (!aimAt(i, id, i === 0 ? 0 : 0.22)) { REC.i++; return; } }
    const after = REC.k >= 0 && i > REC.k;
    if (after) {
      if (REC.popT == null && t < REC.keyT + 1.6) return; // let the slam play out
      if (REC.popT != null && t < REC.popT + 0.6) return;
    }
    if (t < REC.lastFire + (i === 0 ? 0 : after ? GAP_AFTER : buildGap(i))) return;
  }
  if (t < REC.aim.at || !free) return;
  if (!canPullOk(s.puz, s.st, id)) {
    // Rule state diverged from the plan (should not happen): finish with the solver from here, no key beat.
    REC.line = REC.line.slice(0, i).concat(lineFrom(s, s.st).line);
    if (REC.k >= i) REC.k = -1;
    REC.aim = null;
    return;
  }
  REC.i++;
  REC.lastFire = t;
  if (key) { REC.keyT = t; REC.hover = null; }
  A.pointer('down', REC.aim.x, REC.aim.y, 1);
  REC.held = { x: REC.aim.x, y: REC.aim.y, upAt: t + (key ? 0.16 : 0.1) };
}

// ------------------------------------------------------------------ record overlay
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = x => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);
function handPos() {
  const h = REC.hand;
  const k = ease((REC.t - h.mt) / (h.dur || 0.25));
  return { x: h.fx + (h.tx - h.fx) * k, y: h.fy + (h.ty - h.fy) * k };
}
function uOf(S) { return (S.L && S.L.u) || Math.min(S.W / 390, S.H / 700, 2.6); }
const kitBox = S => { const B = S.sess && S.sess.B, k = B && B.kitten; return k && k.s ? k : null; };

// Camera (logical px): centre + zoom. Push-in after the pop, rescue zoom on kittenFree, hard cut back for the win card.
function camAt(S, t) {
  const W = S.W, H = S.H, kb = kitBox(S), B = S.sess && S.sess.B;
  const base = { x: W / 2, y: H / 2, z: 1 };
  if (S.screen !== 'play' || REC.winT != null) return base;
  let c = base;
  const bx = B && B.x != null ? B.x + B.w / 2 : W / 2;
  if (REC.popT == null && B && B.y != null) {
    // Build: slow push onto the board so the thinning yarn fills the frame; on the "which one?" hover, punch in on
    // the last strands + kitten + basket; whip back out on the key press so the slam to the rack is in shot.
    const out = REC.keyT != null ? 1 - ease((t - REC.keyT - 0.04) / 0.28) : 1;
    const pb = ease((t - (HOOK_END - 0.4)) / 4.6) * out;
    c = { x: W / 2 + (bx - W / 2) * pb, y: H / 2 + (B.y + B.h * 0.5 + 30 - H / 2) * pb, z: 1 + 0.08 * pb };
    if (REC.hov0 != null) {
      const ph = ease((t - REC.hov0) / 0.32) * out;
      const ty = B.y + B.h * 0.74, tz = 1.24;
      c = { x: c.x + (bx - c.x) * ph, y: c.y + (ty - c.y) * ph, z: c.z + (tz - c.z) * ph };
    }
  }
  if (REC.popT != null) {
    const a = t - REC.popT;
    if (a < 0.4) c = { ...base, z: 1.035 }; // room for the shake
    const p = ease((a - POP_DUR * 0.7) / 1.6);
    if (p > 0) {
      const by = B && B.y != null ? B.y + B.h * 0.66 : H * 0.62;
      c = { x: W / 2 + ((B && B.x != null ? B.x + B.w / 2 : W / 2) - W / 2) * p, y: H / 2 + (by - H / 2) * p, z: 1 + 0.17 * p };
    }
  }
  if (REC.freeT != null && kb) {
    if (!REC.camFree) REC.camFree = c;
    const p = ease((t - REC.freeT) / 0.6), f = REC.camFree;
    const tx = kb.x, ty = kb.y - kb.s * 0.55, tz = 1.85;
    c = { x: f.x + (tx - f.x) * p, y: f.y + (ty - f.y) * p, z: f.z + (tz - f.z) * p };
  }
  return c;
}
// Raster camera: re-draw the finished frame cropped (needs a real canvas; the node harness has none).
function applyCam(g, S, t) {
  const c = camAt(S, t);
  if (c.z <= 1.0005) return null;
  const cv = canvasEl();
  if (!cv || !cv.width || typeof document === 'undefined' || !document.createElement) return null;
  const buf = REC.buf = copyCanvas(REC.buf);
  if (!buf) return null;
  const W = S.W, H = S.H, d = cv.width / W, vw = W / c.z, vh = H / c.z;
  let x0 = Math.max(0, Math.min(W - vw, c.x - vw / 2)), y0 = Math.max(0, Math.min(H - vh, c.y - vh / 2));
  if (REC.popT != null && t - REC.popT < 0.4) { // impact shake
    const a = t - REC.popT, amp = 15 * (1 - a / 0.4);
    x0 = Math.max(0, Math.min(W - vw, x0 + Math.sin(a * 95) * amp));
    y0 = Math.max(0, Math.min(H - vh, y0 + Math.cos(a * 71) * amp));
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(buf, x0 * d, y0 * d, vw * d, vh * d, 0, 0, cv.width, cv.height);
  g.restore();
  return { x0, y0, z: c.z, d };
}

function drawRecOverlay(g, S) {
  const t = REC.t;
  const ending = REC.endT != null && t >= REC.endT + 0.45;
  if (!ending) {
    const cam = applyCam(g, S, t);
    g.save();
    if (cam) g.setTransform(cam.d * cam.z, 0, 0, cam.d * cam.z, -cam.x0 * cam.d * cam.z, -cam.y0 * cam.d * cam.z);
    drawHero(g, S, t);
    drawRecHand(g, S, t);
    g.restore();
    drawRescue(g, S, t, cam);
    drawFlash(g, S, t);
    const cap = captionNow(S, t);
    if (!(cap && cap[0]) && REC.popT != null && t < REC.popT + POP_DUR && REC.freeT == null) caption(g, S, ' ', 1); // bare band: no HUD under the pop
    drawChainPop(g, S, t);
    if (cap && cap[0]) caption(g, S, cap[0], t - cap[1]);
  }
  if (REC.endT != null && t >= REC.endT) endCard(g, S, t, REC.endT);
  drawLoopFade(g, S, t);
}
// One caption at a time, hard cuts; the CHAIN pop is the caption while it's up.
function captionNow(S, t) {
  if (t < HOOK_END) return [HOOK, 0];
  if (REC.winT != null || S.screen !== 'play') return null;
  if (REC.freeT != null) return [FREED, REC.freeT];
  if (REC.popT != null) return t < REC.popT + POP_DUR ? null : [CAP3, REC.popT + POP_DUR];
  if (REC.cap2On != null && CAP2) return [CAP2, REC.cap2On];
  return [MID, HOOK_END];
}

// The trapped kitten as the hero: ~3x on the hook frame (OG composition, "Help!" bubble), shrinking onto her ledge
// at HERO_OUT; again a little bigger for the rescue (under the camera zoom). Same state as the game's kitten.
function drawHero(g, S, t) {
  const s = S.sess, kb = kitBox(S), kit = s && s.kitten;
  if (!kb || !kit || typeof Rn.drawKitten !== 'function' || S.screen !== 'play' || REC.winT != null) return;
  let boost = 1, help = false;
  if (t < HERO_OUT) { boost = 3.1; help = true; }
  else if (t < HERO_OUT + 0.45) boost = 3.1 - 2.1 * ease((t - HERO_OUT) / 0.45);
  if (REC.freeT != null) boost = 1 + 0.3 * easeOut((t - REC.freeT) / 0.5);
  if (boost <= 1.001) return; // identical to the game's own kitten underneath
  const ks = kb.s * boost;
  g.save();
  if (help) { // warm spotlight so the face reads over the board
    const gr = g.createRadialGradient(kb.x, kb.y - ks * 0.5, ks * 0.1, kb.x, kb.y - ks * 0.5, ks * 0.85);
    gr.addColorStop(0, 'rgba(255,226,150,0.55)'); gr.addColorStop(1, 'rgba(255,226,150,0)');
    g.fillStyle = gr; g.fillRect(kb.x - ks, kb.y - ks * 1.4, ks * 2, ks * 1.6);
  }
  g.fillStyle = 'rgba(20,10,24,0.35)';
  g.beginPath(); g.ellipse(kb.x, kb.y - ks * 0.02, ks * 0.36, ks * 0.06, 0, 0, Math.PI * 2); g.fill();
  const id = s.id || 0, lc = [];
  for (const st of s.puz.strands) if (st.c >= 0 && st.c < 6 && !lc.includes(st.c)) lc.push(st.c);
  try {
    Rn.drawKitten(g, kb.x, kb.y, ks, { stage: kit.stage, loops: kit.loops, flinch: 0, freeT: kit.freeT, golden: kit.golden, t: S.T,
      breed: id > 0 ? (id - 1) % 6 : 0, coat: id > 0 ? Math.floor((id - 1) / 6) : 0, loopColors: lc.slice(0, 4), memKey: HERO_MEM });
  } catch (e) { P.error(e); }
  if (help) helpBubble(g, kb.x + ks * 0.43, kb.y - ks * 0.9, 1.75 * (1 + 0.035 * Math.sin(t * 7)));
  g.restore();
}
// The OG's "Help!" bubble (scene.drawOG), tail pointing down-left at the kitten.
function helpBubble(g, x, y, k) {
  g.save();
  g.translate(x, y); g.scale(k, k); g.rotate(0.05);
  g.lineJoin = 'round';
  const body = () => { g.beginPath(); g.roundRect ? g.roundRect(-74, -36, 148, 72, 36) : g.rect(-74, -36, 148, 72); };
  g.fillStyle = '#FFF4E4'; g.strokeStyle = '#2B2440'; g.lineWidth = 5;
  body(); g.fill();
  g.beginPath(); g.moveTo(-52, 22); g.lineTo(-92, 58); g.lineTo(-24, 30); g.closePath(); g.fill();
  body(); g.stroke();
  g.beginPath(); g.moveTo(-50, 34); g.lineTo(-92, 58); g.lineTo(-26, 35); g.stroke();
  g.fillRect(-54, 26, 32, 8);
  g.font = '44px "Lilita One", "Nunito", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#2B2440'; g.strokeText('Help!', 0, 3);
  g.fillStyle = '#E8463A'; g.fillText('Help!', 0, 3);
  g.restore();
}
// Scripted hand (playable-ad style): on from frame 0, gone once the kitten is free.
function drawRecHand(g, S, t) {
  const s = S.sess;
  if (S.screen !== 'play' || REC.freeT != null || (s && s.result)) return;
  const done = REC.i >= REC.line.length && !REC.held;
  const fade = done ? Math.max(0, 1 - (t - REC.lastFire - 0.25) / 0.25) : 1;
  if (fade <= 0) return;
  let p = handPos();
  if (REC.hover && t >= REC.hover.t0 + 0.22) { // hesitation: circles the wrong strand ("this one?") without pressing
    const w = t - REC.hover.t0 - 0.22;
    p = { x: p.x + Math.sin(w * 7) * 16, y: p.y - Math.abs(Math.sin(w * 3.5)) * 20 };
  }
  g.save();
  g.globalAlpha *= fade;
  drawHand(g, p.x, p.y, 150 * (S.W / 1080), !!REC.held);
  g.restore();
}
function drawFlash(g, S, t) {
  if (REC.popT == null) return;
  const a = t - REC.popT;
  if (a < 0 || a > 0.18) return;
  g.save();
  g.globalAlpha = 0.75 * (1 - a / 0.18);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, S.W, S.H);
  g.restore();
}
const YARN = ['#E8463A', '#3A8FE0', '#FFC93C', '#3DBE8B', '#A66BE0', '#FF8FB1'];
// CHAIN xN! climax, full frame: dark backdrop, spinning sunburst, yarn-ball burst, 200 px gold letters with a fat ink edge.
function drawChainPop(g, S, t) {
  const p = REC.pop;
  if (!p) return;
  const a = t - p.t;
  if (a < 0 || a > POP_DUR) return;
  const W = S.W, H = S.H, x = W / 2, y = H * 0.44;
  const out = a > POP_DUR - 0.12 ? 1 - (a - (POP_DUR - 0.12)) / 0.12 : 1; // quick scale-out, then cut
  const sc = (a < 0.13 ? 0.35 + 0.95 * easeOut(a / 0.13) : a < 0.26 ? 1.3 - 0.3 * ease((a - 0.13) / 0.13) : 1 + 0.025 * Math.sin(a * 9)) * out;
  g.save();
  g.fillStyle = `rgba(22,12,34,${0.42 * Math.min(1, a / 0.08) * out})`;
  g.fillRect(0, 0, W, H);
  g.translate(x, y);
  // sunburst
  g.save();
  g.rotate(a * 0.9);
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    g.fillStyle = i % 2 ? 'rgba(255,214,90,0.55)' : 'rgba(255,244,228,0.30)';
    const R = 760 * sc;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-70 * sc, -R); g.lineTo(70 * sc, -R); g.closePath(); g.fill();
  }
  g.restore();
  // yarn balls flying out
  for (let i = 0; i < 18; i++) {
    const ang = i * 0.349 + 0.2, q = easeOut(Math.min(1, a / 0.7)), r = 140 + 470 * q + (i % 3) * 40;
    const br = (22 + (i % 4) * 6) * (1 - 0.5 * q) * out;
    if (br <= 0.5) continue;
    g.fillStyle = YARN[i % YARN.length]; g.strokeStyle = '#2B2440'; g.lineWidth = 5;
    g.beginPath(); g.arc(Math.cos(ang) * r, Math.sin(ang) * r * 0.9, br, 0, 7); g.fill(); g.stroke();
  }
  g.scale(sc, sc);
  g.rotate(-0.06);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const txt = `CHAIN ×${p.n}!`;
  let fs = 210;
  g.font = `${fs}px "Lilita One", "Nunito", sans-serif`;
  while (fs > 90 && g.measureText(txt).width > W - 110) { fs -= 6; g.font = `${fs}px "Lilita One", "Nunito", sans-serif`; }
  g.fillStyle = '#2B2440';
  g.lineWidth = fs * 0.3; g.strokeStyle = '#2B2440';
  g.strokeText(txt, 0, 14); g.fillText(txt, 0, 14); // drop shadow
  g.strokeText(txt, 0, 0);
  const gr = g.createLinearGradient(0, -fs * 0.45, 0, fs * 0.45);
  gr.addColorStop(0, '#FFF2A8'); gr.addColorStop(0.5, '#FFC93C'); gr.addColorStop(1, '#FF9A1F');
  g.fillStyle = gr;
  g.fillText(txt, 0, 0);
  const sub = a > 0.18 ? Math.min(1, (a - 0.18) / 0.1) : 0;
  if (sub > 0) {
    g.save();
    g.translate(0, fs * 0.82);
    g.rotate(0.1);
    g.scale(0.7 + 0.3 * sub, 0.7 + 0.3 * sub);
    g.font = `${Math.round(fs * 0.5)}px "Lilita One", "Nunito", sans-serif`;
    g.lineWidth = fs * 0.16; g.strokeStyle = '#2B2440'; g.strokeText('PERFECT!', 0, 0);
    g.fillStyle = '#FFF4E4'; g.fillText('PERFECT!', 0, 0);
    g.restore();
  }
  g.restore();
}
// Rescue: big hearts rising off the kitten in screen space (the camera is zoomed in on her).
function drawRescue(g, S, t, cam) {
  if (REC.freeT == null || REC.winT != null || S.screen !== 'play' || typeof Rn.drawHeart !== 'function') return;
  const kb = kitBox(S);
  if (!kb) return;
  const a = t - REC.freeT;
  const z = cam ? cam.z : 1, sx = cam ? (kb.x - cam.x0) * z : kb.x, sy = cam ? (kb.y - kb.s * 0.6 - cam.y0) * z : kb.y - kb.s * 0.6;
  for (let i = 0; i < 14; i++) {
    const p = (a - 0.55 - i * 0.06) / 1.25;
    if (p <= 0 || p >= 1) continue;
    const ang = -Math.PI / 2 + ((i * 0.618) % 1 - 0.5) * 2.6, dist = 120 + 520 * easeOut(p);
    try { Rn.drawHeart(g, sx + Math.cos(ang) * dist, sy + Math.sin(ang) * dist * 0.85 - p * 160, (34 + (i % 3) * 12) * (1 - p * 0.35), 1 - p * p); } catch (e) { P.error(e); }
  }
}
// Loop: the last LOOP_X s of the tail crossfade into frame 0.
function drawLoopFade(g, S, t) {
  if (!REC.snap || REC.overT == null) return;
  const t0 = REC.overT + TAIL - LOOP_X;
  if (t < t0) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = ease((t - t0) / LOOP_X);
  g.drawImage(REC.snap, 0, 0);
  g.restore();
}

// sz = hand height in px (render.drawHand's s).
function drawHand(g, x, y, sz, press) {
  if (typeof Rn.drawHand === 'function') {
    try { Rn.drawHand(g, x, y, sz, press); return; } catch (e) { P.error(e); }
  }
  // Fallback hand: a cream fingertip with an ink outline and a press ring.
  const s = sz / 44;
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
// age = seconds since this caption came up: it pops in with a little overshoot and is cut, never faded, so it can't
// ghost over the HUD title. The band behind it is opaque down past the HUD, then fades into the scene.
function caption(g, S, text, age) {
  const W = S.W, lines = String(text).split('|').slice(0, 3);
  let fs = 82;
  g.save();
  const font = n => `${n}px "Lilita One", "Nunito", sans-serif`;
  g.font = font(fs);
  const widest = () => Math.max(...lines.map(l => g.measureText(l).width));
  while (fs > 40 && widest() > W - 96) { fs -= 2; g.font = font(fs); }
  const lh = fs * 1.1, blockH = lines.length * lh;
  const hb = hudBottom(S);
  const top = Math.max(26, Math.min(0.2 * S.H - blockH - 10, hb / 2 - blockH / 2 + 20));
  const solid = Math.max(hb + 10, top + blockH + 14), fadeH = 70;
  g.fillStyle = '#21162F';
  g.fillRect(0, 0, W, solid);
  const grd = g.createLinearGradient(0, solid, 0, solid + fadeH);
  grd.addColorStop(0, 'rgba(33,22,47,1)');
  grd.addColorStop(1, 'rgba(33,22,47,0)');
  g.fillStyle = grd;
  g.fillRect(0, solid, W, fadeH);
  const sc = age >= 0.22 ? 1 : age < 0.14 ? 0.82 + 0.26 * (age / 0.14) : 1.08 - 0.08 * ((age - 0.14) / 0.08);
  g.translate(W / 2, top + blockH / 2);
  g.scale(sc, sc);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16; // 8 px stroke outside the glyph
  g.strokeStyle = '#2B2440';
  lines.forEach((l, i) => {
    const y = lh * (i + 0.5) - blockH / 2;
    g.strokeText(l, 0, y);
    g.fillStyle = i === lines.length - 1 && lines.length > 1 ? '#FFD65A' : '#FFF4E4';
    g.fillText(l, 0, y);
  });
  g.restore();
}

function endCard(g, S, t, t0) {
  const W = S.W, H = S.H, a = Math.min(1, (t - t0) / 0.45), k = W / 1080;
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
  const pop = 1 + 0.06 * Math.max(0, 1 - (t - t0) / 0.35);
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
  if (typeof Rn.drawKitty === 'function') { try { Rn.drawKitty(g, W * 0.5, H * 0.665 + bob, 520 * k, 'celebrate', t, 'pumpkin'); } catch (e) { P.error(e); } } // s = height in px, (x, y) = feet
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
  // No callouts or pops on the still (one caption at a time; the OG card has its own text).
  const emit0 = bus.emit;
  bus.emit = (t, d) => (MUTED.has(t) ? undefined : emit0.call(bus, t, d));
  whenBooted(async () => {
    await fontsReady();
    prepShowcaseSave(LV);
    OG.showcase = applyShowcase();
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
