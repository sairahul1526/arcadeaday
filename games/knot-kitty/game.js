// game.js: Knot Kitty entry. Boot (§11), canvas + DPR sizing, rAF loop, input routing, screen state machine, api (§13.4).
// Owner: Core. No exports.
//
// DECISION: the screens that show a level session are play, pause, win and lose. play.update runs on play/win/lose.
// DECISION: the in-game pause screen stops time: S.T and play.update are frozen while S.screen === 'pause'
//   (ui.update still gets dt so the panel can animate on its own clock). A host pause (P.onPause) stops the rAF
//   loop altogether; on resume `last = now` so there is no dt jump.
// DECISION: gesture ownership is decided on pointerdown (ui.pointer → true = UI owns it); move/up/cancel go to that
//   owner only. Primary pointer only: a second simultaneous pointer is ignored. Hover moves (no gesture) go to ui.
// DECISION: audio.init() runs on the first pointerdown/keydown; it is then suspended if !P.audioOn or P.paused, and
//   gets the saved music/SFX volumes.
// DECISION: the canvas follows the window (resize + ResizeObserver) except in record/og mode, where modes.js sizes it
//   through api.resize. The backing store is capped at MAX_PIXELS = 6.0 M px: in software-rendered Chromium (no GPU)
//   a canvas over ~24 MiB (≈ 6.25 M px) used as a drawImage source (scene.js full-screen bake) is re-copied every
//   frame (measured: draw 1 ms → 45–85 ms at 6.27 M px), so 2560×1440 runs at dpr 1.28 instead of 2. dpr is never
//   pushed below 1 (crisp) unless the window itself is bigger than 4K (HARD_PIXELS).
//   fix2: scene.js now tiles its bake (≤ 2048² per source) and blits it 1:1, so the cliff no longer applies to the
//   backdrop; MAX_PIXELS stays as the fill-cost budget for the board/UI, which draw straight to this canvas.
// DECISION (fix2): frame governor. Fill cost scales with backing pixels, and a slow device (or a 4× CPU-throttled
//   phone profile) can't fill 975×2110 @ dpr 2.5 at 60 fps. If, over a window of GOV_N frames, the median rAF
//   interval is > 22 ms AND the median in-callback work is > GOV_WORK ms (so a 30 Hz display / iOS Low Power Mode,
//   where frames are slow but work is tiny, never triggers it), the dpr cap steps down (×0.5–0.85, by how slow)
//   and the canvas is re-sized. Floor GOV_FLOOR = 1 (only a device that cannot hold ~45 fps ever gets there).
//   It only ever steps down within a page load (no oscillation); S.gov exposes {cap, px, med, work, steps} for QA.
//   QA 10-30: the cap is a backing-pixel budget (GOV.px), not a dpr, so a step taken at 2560×1440 doesn't blur a
//   later 390×844; and every window resize clears the window and skips 30 frames, because the re-bakes after a
//   resize are slow by design and a resize storm used to ratchet a fast device down to dpr 1.
// DECISION: S.world: title = 2 (Pumpkin Night) until SEASON_END (IST), else 1; map = world of meta.cur();
//   play = world of the level (daily/bonus: world of meta.cur()). audio.playWorld(0) on title/map, (world) in play.
//   The daily screen keeps the world it was opened over (title → daily does not swap the background).
// DECISION: host pause: game.js subscribes to ytgame.system.onPause/onResume itself at module load (before P.init
//   awaits loadData, where platform.js wires its own), so a pause during load is not lost; hostPaused() = that flag
//   || P.paused. While host-paused, pointer and key input are ignored and any gesture in progress is dropped.
// DECISION: a win is never left unseen: pause / retry / leaving the session while play.winPending (strands landing +
//   the 1.6 s kitten-free beat) finishes the win flow at once (play.finishWinNow → win card with stars and gifts).
//   The player then leaves from the card. api.startLevel / go('play', {kind,id}) (bots, modes) are not redirected.
// DECISION: api.canUseBooster(key) = play.canUseBooster; useBooster refuses (charges nothing) when it says no and
//   emits 'boosterRefused' {kind, reason}; a refused Hint on a doomed board also emits hint {id:-1} (pulses Undo).
// DECISION: go('play') with {kind, id} starts a level; without data it returns to the current session (to its win
//   or lose card if the session is over or stuck). go('win'/'lose') also calls ui.showCard. Every transition emits
//   'screen'. The session is dropped on title/map/daily/allbeaten; shop/kittens/settings keep it.
// DECISION: next(): level < 60 → next level, after 60 → 'allbeaten'; daily → 'daily'; bonus → next bonus index.
// DECISION: api.useBooster from the Out of Room card returns to 'play' when the booster un-sticks the level.
// DECISION: S.noHaptics = record || og || qa (haptics never fire for bots / capture).
// DECISION: ui.init(api) runs before the title is built; modes.init(api) runs after it so ?lv / ?record / ?og can
//   redirect the first screen. Font loads are raced against a 2.5 s timeout so a blocked font never stalls boot.
// DECISION: S.T is gameplay time (frozen on the in-game pause card); S.TL is the loop clock (frozen only while the
//   host pauses us). __qa().t reports S.TL so a host resume is visible even when Esc had opened the pause card.
// DECISION: a throwing frame is reported once per message through P.error (console.warn) and the loop keeps going.

import P from '../shared/platform.js';
import { STORE, SAVE_V, DPR_CAP, SEASON_END, LEVELS, worldOf, bus } from './consts.js';
import { computeLayout } from './layout.js';
import * as play from './play.js';
import * as render from './render.js';
import * as scene from './scene.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import * as meta from './meta.js';
import * as modes from './modes.js';
import { loadArt, FIRST } from './art.js';

const cvs = document.getElementById('c');
const g = cvs.getContext('2d');
const SESSION_SCREENS = new Set(['play', 'pause', 'win', 'lose']);
const KEEP_SESSION = new Set(['play', 'pause', 'win', 'lose', 'shop', 'kittens', 'settings']);
const MAX_PIXELS = 6.0e6, HARD_PIXELS = 3840 * 2160;
const GOV_N = 16, GOV_SLOW = 22, GOV_WORK = 1.5, GOV_FLOOR = 1;

const S = { W: 1, H: 1, dpr: 1, T: 0, TL: 0, screen: 'loading', L: null, world: 1, sess: null, ui: {}, noHaptics: false, pending: new Set() };
const GOV = { cap: Infinity, px: Infinity, iv: [], wk: [], skip: 30, steps: 0, med: 0, work: 0 };
S.gov = GOV;

// host pause, wired at module load (before P.init awaits the save; see DECISION above)
const YT = typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV ? ytgame : null; // eslint-disable-line no-undef
let earlyPaused = false;
const hostPaused = () => earlyPaused || P.paused;

const istKey = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const seasonWorld = () => (istKey() < SEASON_END ? 2 : 1);
const curWorld = () => worldOf(Math.max(1, Math.min(LEVELS, meta.cur())));
const modeOn = k => { try { return !!(modes.active && modes.active[k]); } catch (e) { return false; } };
const safe = (f, ...a) => { try { return f && f(...a); } catch (e) { report(e); } };

const seen = new Set();
function report(e) {
  const m = String((e && e.stack) || e);
  if (seen.has(m)) return;
  seen.add(m);
  P.error(e);
  try { console.warn(e); } catch (x) {}
}

// ------------------------------------------------------------------ sizing
function resize(W, H, dpr) {
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
  GOV.cap = Math.sqrt(GOV.px / (W * H));
  const want = Math.min(DPR_CAP, dpr || 1, GOV.cap);
  dpr = Math.max(Math.min(1, want), Math.min(want, Math.sqrt(MAX_PIXELS / (W * H)))); // budget, but not below 1
  dpr = Math.max(0.5, Math.min(dpr, Math.sqrt(HARD_PIXELS / (W * H))));
  S.W = W; S.H = H; S.dpr = dpr;
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cvs.width !== bw) cvs.width = bw;
  if (cvs.height !== bh) cvs.height = bh;
  cvs.style.width = W + 'px';
  cvs.style.height = H + 'px';
  S.L = computeLayout(W, H);
  if (S.sess) play.onResize(S);
  safe(render.invalidate);
  if (!running || hostPaused()) draw();
}
function fitWindow() {
  if (modeOn('record') || modeOn('og')) return;
  const W = window.innerWidth || document.documentElement.clientWidth || 390;
  const H = window.innerHeight || document.documentElement.clientHeight || 844;
  const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  if (W === S.W && H === S.H && dpr === S.dpr) return;
  GOV.iv = []; GOV.wk = []; GOV.skip = Math.max(GOV.skip, 30);
  resize(W, H, dpr);
}

// frame governor (see DECISION above)
function govern(iv, work) {
  if (GOV.skip > 0) { GOV.skip--; return; }
  if (S.screen === 'loading' || modeOn('record') || modeOn('og') || (typeof document !== 'undefined' && document.hidden)) return;
  GOV.iv.push(iv); GOV.wk.push(work);
  if (GOV.iv.length < GOV_N) return;
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  GOV.med = med(GOV.iv); GOV.work = med(GOV.wk);
  GOV.iv = []; GOV.wk = [];
  const floor = Math.min(GOV_FLOOR, S.dpr);
  if (GOV.med > GOV_SLOW && GOV.work > GOV_WORK && S.dpr > floor + 0.01) {
    const f = Math.max(0.5, Math.min(0.85, Math.sqrt(14 / GOV.med)));
    const d2 = Math.max(floor, S.dpr * f);
    GOV.px = S.W * S.H * d2 * d2;
    GOV.steps++;
    GOV.skip = 8; // let the re-bakes settle before judging again
    resize(S.W, S.H, Math.min(DPR_CAP, window.devicePixelRatio || 1));
  }
}

// ------------------------------------------------------------------ loop
let raf = 0, running = false, last = 0;
function startLoop() {
  if (running || hostPaused()) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
function frame(now) {
  raf = 0;
  if (!running) return;
  if (hostPaused()) { running = false; return; }
  raf = requestAnimationFrame(frame);
  const iv = now - last;
  const dt = Math.min(0.05, Math.max(0, iv / 1000));
  last = now;
  if (modeOn('record')) return; // record mode drives api.step(1/60) itself
  const w0 = performance.now();
  try {
    advance(dt);
    draw();
    modes.afterFrame(S);
  } catch (e) { report(e); }
  try { govern(iv, performance.now() - w0); } catch (e) { report(e); }
}

function advance(dt) {
  S.TL += dt; // loop clock: runs whenever the rAF loop runs (also on the pause card); stops only on a host pause
  if (S.screen === 'loading') { S.T += dt; return; }
  S.outfit = (P.data && P.data.wear) || 'tabby'; // render reads the worn outfit from S
  if (S.screen !== 'pause' && !hitStopped(dt)) {
    S.T += dt;
    if (S.sess && (S.screen === 'play' || S.screen === 'win' || S.screen === 'lose')) {
      const r = play.update(dt, S);
      if (r === 'win' && S.screen === 'play') go('win');
      else if (r === 'lose' && S.screen === 'play') go('lose');
    }
  }
  ui.update(dt, S);
}

/** Hit-stop (combo juice): RENDER's hitStop(S, ms) stores it in S.fx; gameplay time holds still while it runs.
 *  Accepts S.fx.stop (s left), S.fx.hitStop (ms left) or S.fx.stopUntil (on the S.TL loop clock). Capped at 0.2 s. */
function hitStopped(dt) {
  const fx = S.fx;
  if (!fx || S.screen !== 'play') return false;
  if (typeof fx.stopUntil === 'number' && fx.stopUntil > S.TL) {
    if (fx.stopUntil - S.TL > 0.2) fx.stopUntil = S.TL + 0.2;
    return true;
  }
  if (typeof fx.stop === 'number' && fx.stop > 0) { fx.stop = Math.min(0.2, fx.stop) - dt; return true; }
  if (typeof fx.hitStop === 'number' && fx.hitStop > 0) { fx.hitStop = Math.min(200, fx.hitStop) - dt * 1000; return true; }
  return false;
}

function draw() {
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  if (S.screen === 'loading' || !S.L) { drawLoading(); return; }
  scene.drawScene(g, S);
  if (S.sess && SESSION_SCREENS.has(S.screen)) render.drawPlay(g, S);
  ui.draw(g, S);
  modes.overlay(g, S);
}

/** Cream background + a spinning yarn ball (drawn before any font or module asset is ready). */
function drawLoading() {
  const { W, H } = S, t = S.T;
  g.fillStyle = '#F6E7D2';
  g.fillRect(0, 0, W, H);
  const r = Math.max(14, Math.min(W, H) * 0.06), x = W / 2, y = H / 2;
  g.save();
  g.translate(x, y);
  g.rotate(t * 3);
  g.fillStyle = '#E8574A';
  g.strokeStyle = '#2B2440';
  g.lineWidth = Math.max(2, r * 0.1);
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(43,36,64,0.45)';
  g.lineWidth = Math.max(1.5, r * 0.07);
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.ellipse(0, 0, r * 0.92, r * (0.25 + 0.15 * Math.abs(i)), (i * Math.PI) / 5, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#E8574A';
  g.lineWidth = Math.max(2, r * 0.12);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x + r * 0.7, y + r * 0.7);
  g.quadraticCurveTo(x + r * 1.6, y + r * 1.6, x + r * 2.4, y + r * 1.1 + Math.sin(t * 4) * r * 0.2);
  g.stroke();
}

// ------------------------------------------------------------------ state machine
function emitScreen() { bus.emit('screen', { name: S.screen }); }

function go(screen, data) {
  if (screen === 'play') {
    if (data && data.kind) { startLevel(data.kind, data.id); return; }
    if (!S.sess) { startLevel('level', meta.cur()); return; }
    if (S.sess.result && S.sess.winShown) { go('win'); return; }
    if (S.sess.stuck && S.sess.lose) { go('lose'); return; }
    S.screen = 'play';
    safe(audio.playWorld, S.world);
    emitScreen();
    return;
  }
  // leaving the session (or opening another screen over it) during the kitten-free beat: show the win card first
  if (screen !== 'win' && screen !== 'play' && showPendingWin()) return;
  if (!KEEP_SESSION.has(screen)) { S.sess = null; S.pending = new Set(); }
  if (S.sess && S.sess.press) S.sess.press = null;
  const from = S.screen;
  S.screen = screen;
  if (screen === 'title') { S.world = seasonWorld(); safe(audio.playWorld, 0); }
  else if (screen === 'daily' && from === 'title') safe(audio.playWorld, 0); // keep the title's world behind the daily card
  else if (screen === 'map' || screen === 'daily' || screen === 'allbeaten') { S.world = curWorld(); safe(audio.playWorld, 0); }
  if (screen === 'win' && S.sess) ui.showCard('win', S.sess.result);
  if (screen === 'lose' && S.sess) ui.showCard('lose', { stuck: true, kind: S.sess.kind, id: S.sess.id });
  safe(render.invalidate);
  emitScreen();
}

/** If a win is waiting for its card (strands landing / kitten-free beat), finish it now and show the card. */
function showPendingWin() {
  if (!play.winPending(S) || !SESSION_SCREENS.has(S.screen)) return false;
  if (!play.finishWinNow(S)) return false;
  go('win');
  return true;
}

function startLevel(kind, id) {
  if (kind === 'level' && !(id >= 1)) id = meta.cur();
  const sess = play.createSession(kind, id, S);
  S.sess = sess;
  S.world = sess.kind === 'level' ? worldOf(sess.id) : curWorld();
  S.screen = 'play';
  safe(render.invalidate);
  safe(audio.playWorld, S.world);
  bus.emit('levelStart', { kind: sess.kind, id: sess.id });
  emitScreen();
}

function retry() {
  const s = S.sess;
  if (!s) return startLevel('level', meta.cur());
  if (showPendingWin()) return; // R / Restart during the kitten-free beat: see the win card (Replay is on it)
  startLevel(s.kind, s.id);
}

function next() {
  const s = S.sess;
  if (!s) return go('map');
  if (s.kind === 'daily') return go('daily');
  if (s.kind === 'bonus') return startLevel('bonus', meta.bonusNext());
  if (s.id >= LEVELS) return go('allbeaten');
  startLevel('level', s.id + 1);
}

function canUseBooster(kind) {
  try { return play.canUseBooster(S, kind); } catch (e) { report(e); return { ok: false, reason: '' }; }
}
function useBooster(kind) {
  const s = S.sess;
  if (!s || s.result) return false;
  const can = canUseBooster(kind);
  if (!can.ok) {
    bus.emit('boosterRefused', { kind, reason: can.reason });
    if (kind === 'hint' && can.doomed) {
      if (!s.doomed) { s.doomed = true; bus.emit('doomed', {}); }
      bus.emit('hint', { id: -1 });
    }
    return false;
  }
  const ok = play.applyBooster(kind, S);
  if (ok && S.screen === 'lose' && !s.stuck) { S.screen = 'play'; emitScreen(); }
  return ok;
}

function pause() {
  if (S.screen !== 'play') return;
  if (showPendingWin()) return; // nothing to pause during the win beat: jump to the card
  if (S.sess) S.sess.press = null;
  S.screen = 'pause';
  emitScreen();
}
function resume() {
  if (S.screen !== 'pause') return;
  S.screen = 'play';
  emitScreen();
}

// ------------------------------------------------------------------ input
let ptr = null; // { id, owner: 'ui' | 'core', t }
function pointer(type, x, y, id = -1) {
  if (S.screen === 'loading') return;
  if (hostPaused()) { dropGesture(); return; } // the host has paused us: no input until it resumes
  if (type === 'down') {
    if (ptr && ptr.id !== id && performance.now() - ptr.t < 2000) return; // second simultaneous pointer (a lost pointerup frees input after 2 s, QA 10-30)
    const owner = ui.pointer('down', x, y, S) ? 'ui' : 'core';
    ptr = { id, owner, t: performance.now() };
    if (owner === 'core' && S.screen === 'play' && S.sess) play.press(x, y, S);
    return;
  }
  if (!ptr) { if (type === 'move') ui.pointer('move', x, y, S); return; }
  if (ptr.id !== id) return;
  const owner = ptr.owner;
  if (type === 'up' || type === 'cancel') ptr = null;
  if (owner === 'ui') { ui.pointer(type, x, y, S); return; }
  if (!S.sess) return;
  if (S.screen !== 'play') { S.sess.press = null; return; }
  if (type === 'move') play.move(x, y, S);
  else if (type === 'up') play.release(x, y, S);
  else S.sess.press = null;
}
function dropGesture() {
  ptr = null;
  if (S.sess) S.sess.press = null;
}
function tapAt(x, y) {
  pointer('down', x, y, 'tap');
  pointer('up', x, y, 'tap');
}

let audioReady = false;
function audioInit() {
  if (audioReady) return;
  audioReady = true;
  try {
    audio.init();
    const set = meta.settings();
    safe(audio.setMusic, set.music);
    safe(audio.setSfx, set.sfx);
    if (!P.audioOn || hostPaused()) audio.suspend();
    else safe(audio.playWorld, SESSION_SCREENS.has(S.screen) ? S.world : 0);
  } catch (e) { report(e); }
}

function xy(e) {
  const r = cvs.getBoundingClientRect();
  return [(e.clientX - r.left) * (S.W / (r.width || S.W)), (e.clientY - r.top) * (S.H / (r.height || S.H))];
}
function onPointer(type) {
  return e => {
    if (type === 'down') {
      if (!e.isPrimary || hostPaused()) return;
      audioInit();
      try { cvs.setPointerCapture(e.pointerId); } catch (x) {}
    }
    if (type !== 'move') e.preventDefault();
    const [x, y] = xy(e);
    try { pointer(type, x, y, e.pointerId); } catch (err) { report(err); }
  };
}
cvs.addEventListener('pointerdown', onPointer('down'));
cvs.addEventListener('pointermove', onPointer('move'));
cvs.addEventListener('pointerup', onPointer('up'));
cvs.addEventListener('pointercancel', onPointer('cancel'));
cvs.addEventListener('lostpointercapture', e => { if (ptr && ptr.id === e.pointerId) { const [x, y] = xy(e); pointer('cancel', x, y, e.pointerId); } });
cvs.addEventListener('contextmenu', e => e.preventDefault());
// fix r2 (critic panel r1): the site's "how to play" chip used to scroll to the SEO sheet and leave the game; it now
//   opens the in-game How to play card (from the map it goes back to the title first). "more games" is untouched.
//   The chips get more room between them (they read as one pill at 8 px apart); index.html is generated, so the gap
//   is set here.
try {
  const how = document.querySelector('nav.back a[href="#how"]');
  if (how) how.addEventListener('click', e => {
    const sc = S.screen;
    if (sc !== 'title' && sc !== 'map' && sc !== 'allbeaten') return;
    e.preventDefault();
    if (sc !== 'title') go('title');
    if (ui.openHow) ui.openHow();
  });
  const st = document.createElement('style');
  st.textContent = 'nav.back{gap:18px}@media (min-width:900px) and (min-height:600px){nav.back{gap:22px}}';
  document.head.appendChild(st);
} catch (e) { /* no DOM */ }
cvs.addEventListener('wheel', e => {
  if (S.screen === 'play' || S.screen === 'loading') return;
  const [x, y] = xy(e);
  if (ui.wheel && ui.wheel(e.deltaY, x, y, S)) e.preventDefault();
}, { passive: false });

const GAME_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'Escape', 'KeyP', 'KeyU', 'KeyH', 'KeyR',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', e => {
  if (!GAME_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || S.screen === 'loading') return;
  if (hostPaused()) return;
  if (S.screen !== 'play' && scrollY > 40) return;
  if (e.code !== 'Escape') e.preventDefault();
  if (e.repeat) return;
  audioInit();
  try {
    if (ui.key(e, S)) return;
    coreKey(e.code);
  } catch (err) { report(err); }
});
function coreKey(code) {
  const sc = S.screen;
  if (code === 'KeyU' && (sc === 'play' || sc === 'lose')) useBooster('undo');
  else if (code === 'KeyH' && sc === 'play') useBooster('hint');
  else if (code === 'KeyR' && (sc === 'play' || sc === 'pause' || sc === 'lose')) retry();
  else if (code === 'KeyP' || code === 'Escape') { if (sc === 'play') pause(); else if (sc === 'pause') resume(); }
}

// ------------------------------------------------------------------ api
const api = {
  S,
  go, startLevel, retry, next,
  undo: () => useBooster('undo'),
  useBooster,
  rescueHint(free) {
    const s = S.sess;
    if (!s || s.result) return false;
    let ok = false;
    try { ok = play.rescueHint(S, !!free); } catch (e) { report(e); }
    if (ok && S.screen === 'lose' && !s.stuck) { S.screen = 'play'; emitScreen(); }
    return ok;
  },
  canUseBooster,
  pause, resume,
  pointer, tapAt,
  tapPointFor: id => play.tapPointFor(id, S),
  pickStrand: (x, y) => play.pickStrand(x, y, S),
  step(dt) {
    try {
      advance(dt);
      draw();
      modes.afterFrame(S);
    } catch (e) { report(e); }
  },
  resize,
};

// ------------------------------------------------------------------ analytics + portal lifecycle
// One tracker derived from bus events: level_start / level_complete / level_fail / quit_level / session_end,
// and gameplayStart/Stop (true only while a level is on screen, unpaused and unfinished). Never gates gameplay.
const sessionT0 = performance.now();
let lvl = null; // { id, kind, t0 (S.T), moves, done, failed }
let playingNow = false;
const secsOf = l => Math.max(0, Math.round((S.T - l.t0) * 10) / 10);
function setPlaying(on) {
  if (on === playingNow) return;
  playingNow = on;
  safe(on ? P.gameplayStart : P.gameplayStop);
}
function endLevelQuit() {
  if (lvl && !lvl.done && !lvl.failed) P.event('quit_level', { id: lvl.id, kind: lvl.kind, secs: secsOf(lvl) });
  lvl = null;
}
bus.on('levelStart', d => {
  endLevelQuit();
  lvl = { id: d.id, kind: d.kind, t0: S.T, moves: 0, done: false, failed: false };
  P.event('level_start', { id: d.id, kind: d.kind });
});
bus.on('press', d => { if (lvl && d && d.ok) lvl.moves++; });
// the Music / Sounds sliders take effect at once, not on the next load (QA 10-30)
bus.on('settings', d => {
  if (!d) return;
  if (d.k === 'music') safe(audio.setMusic, d.v);
  else if (d.k === 'sfx') safe(audio.setSfx, d.v);
});
bus.on('win', d => {
  if (!lvl || lvl.done) return;
  lvl.done = true;
  const r = (d && d.result) || {};
  P.event('level_complete', { id: lvl.id, kind: lvl.kind, stars: r.stars | 0, secs: secsOf(lvl), moves: lvl.moves });
  setPlaying(false);
  if ((r.stars | 0) >= 3) safe(P.happyTime);
});
bus.on('screen', d => {
  const sc = d.name;
  if (lvl && !lvl.done) {
    if (sc === 'lose' && !lvl.failed) { lvl.failed = true; P.event('level_fail', { id: lvl.id, kind: lvl.kind, secs: secsOf(lvl) }); }
    else if (sc === 'play') lvl.failed = false; // undo / booster rescued a stuck board
  }
  if (!SESSION_SCREENS.has(sc) && !KEEP_SESSION.has(sc)) { endLevelQuit(); }
  setPlaying(sc === 'play' && !!lvl && !lvl.done && !lvl.failed);
});

// ------------------------------------------------------------------ platform hooks
function onHostPause() {
  safe(P.event, 'session_end', { secs: Math.round((performance.now() - sessionT0) / 1000) });
  setPlaying(false);
  stopLoop();
  dropGesture();
  safe(audio.suspend);
  if (P.env === 'web' && S.screen === 'play' && !play.winPending(S)) pause();
}
function onHostResume() {
  if (hostPaused()) return; // the other source still says paused
  last = performance.now();
  startLoop();
  if (P.audioOn) safe(audio.resume);
  setPlaying(S.screen === 'play' && !!lvl && !lvl.done && !lvl.failed);
}
if (YT) {
  try { YT.system.onPause(() => { earlyPaused = true; onHostPause(); }); } catch (e) { report(e); }
  try { YT.system.onResume(() => { earlyPaused = false; onHostResume(); }); } catch (e) { report(e); }
}
P.onPause(onHostPause);
P.onResume(onHostResume);
P.onAudio(on => { if (on && !hostPaused()) safe(audio.resume); else safe(audio.suspend); });

// ------------------------------------------------------------------ boot (§11)
async function boot() {
  fitWindow();
  drawLoading();
  try { await Promise.race([loadArt(FIRST), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
  P.firstFrame();
  startLoop();
  loadArt().catch(() => {}); // the rest of the illustrations, in the background
  await P.init({ store: STORE, version: SAVE_V, defaults: meta.defaults(), migrate: meta.migrate });
  meta.initMeta();
  P.best(meta.score());
  const timeout = new Promise(r => setTimeout(r, 2500));
  try {
    await Promise.race([Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('800 20px Nunito')]), timeout]);
  } catch (e) {}
  ui.init(api);
  go('title');
  modes.init(api);
  S.noHaptics = modeOn('record') || modeOn('og') || modeOn('qa');
  fitWindow();
  P.ready();
  if (!running) startLoop();
  if (!running || modeOn('record')) draw();
}

addEventListener('resize', fitWindow);
try { new ResizeObserver(fitWindow).observe(document.documentElement); } catch (e) {}

boot().catch(e => { report(e); });
