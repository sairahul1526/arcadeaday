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
//   through api.resize. The backing store is also capped at ~16.7 M px so a 4K window stays cheap.
// DECISION: S.world: title = 2 (Pumpkin Night) until SEASON_END (IST), else 1; map = world of meta.cur();
//   play = world of the level (daily/bonus: world of meta.cur()). audio.playWorld(0) on title/map, (world) in play.
// DECISION: go('play') with {kind, id} starts a level; without data it returns to the current session (to its win
//   or lose card if the session is over or stuck). go('win'/'lose') also calls ui.showCard. Every transition emits
//   'screen'. The session is dropped on title/map/daily/allbeaten; shop/kittens/settings keep it.
// DECISION: next(): level < 60 → next level, after 60 → 'allbeaten'; daily → 'daily'; bonus → next bonus index.
// DECISION: api.useBooster from the Out of Room card returns to 'play' when the booster un-sticks the level.
// DECISION: S.noHaptics = record || og || qa (haptics never fire for bots / capture).
// DECISION: ui.init(api) runs before the title is built; modes.init(api) runs after it so ?lv / ?record / ?og can
//   redirect the first screen. Font loads are raced against a 2.5 s timeout so a blocked font never stalls boot.
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

const cvs = document.getElementById('c');
const g = cvs.getContext('2d');
const SESSION_SCREENS = new Set(['play', 'pause', 'win', 'lose']);
const KEEP_SESSION = new Set(['play', 'pause', 'win', 'lose', 'shop', 'kittens', 'settings']);
const MAX_PIXELS = 4096 * 4096;

const S = { W: 1, H: 1, dpr: 1, T: 0, screen: 'loading', L: null, world: 1, sess: null, ui: {}, noHaptics: false };

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
  dpr = Math.max(0.5, Math.min(DPR_CAP, dpr || 1, Math.sqrt(MAX_PIXELS / (W * H))));
  S.W = W; S.H = H; S.dpr = dpr;
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cvs.width !== bw) cvs.width = bw;
  if (cvs.height !== bh) cvs.height = bh;
  cvs.style.width = W + 'px';
  cvs.style.height = H + 'px';
  S.L = computeLayout(W, H);
  if (S.sess) play.onResize(S);
  safe(render.invalidate);
  if (!running || P.paused) draw();
}
function fitWindow() {
  if (modeOn('record') || modeOn('og')) return;
  const W = window.innerWidth || document.documentElement.clientWidth || 390;
  const H = window.innerHeight || document.documentElement.clientHeight || 844;
  const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  if (W === S.W && H === S.H && dpr === S.dpr) return;
  resize(W, H, dpr);
}

// ------------------------------------------------------------------ loop
let raf = 0, running = false, last = 0;
function startLoop() {
  if (running || P.paused) return;
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
  if (P.paused) { running = false; return; }
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (modeOn('record')) return; // record mode drives api.step(1/60) itself
  try {
    advance(dt);
    draw();
    modes.afterFrame(S);
  } catch (e) { report(e); }
}

function advance(dt) {
  if (S.screen === 'loading') { S.T += dt; return; }
  S.outfit = (P.data && P.data.wear) || 'tabby'; // render reads the worn outfit from S
  if (S.screen !== 'pause') {
    S.T += dt;
    if (S.sess && (S.screen === 'play' || S.screen === 'win' || S.screen === 'lose')) {
      const r = play.update(dt, S);
      if (r === 'win' && S.screen === 'play') go('win');
      else if (r === 'lose' && S.screen === 'play') go('lose');
    }
  }
  ui.update(dt, S);
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
  if (!KEEP_SESSION.has(screen)) S.sess = null;
  if (S.sess && S.sess.press) S.sess.press = null;
  S.screen = screen;
  if (screen === 'title') { S.world = seasonWorld(); safe(audio.playWorld, 0); }
  else if (screen === 'map' || screen === 'daily' || screen === 'allbeaten') { S.world = curWorld(); safe(audio.playWorld, 0); }
  if (screen === 'win' && S.sess) ui.showCard('win', S.sess.result);
  if (screen === 'lose' && S.sess) ui.showCard('lose', { stuck: true, kind: S.sess.kind, id: S.sess.id });
  safe(render.invalidate);
  emitScreen();
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

function useBooster(kind) {
  const s = S.sess;
  if (!s || s.result) return false;
  const ok = play.applyBooster(kind, S);
  if (ok && S.screen === 'lose' && !s.stuck) { S.screen = 'play'; emitScreen(); }
  return ok;
}

function pause() {
  if (S.screen !== 'play') return;
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
  if (type === 'down') {
    if (ptr && ptr.id !== id && performance.now() - ptr.t < 8000) return; // second simultaneous pointer
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
    if (!P.audioOn || P.paused) audio.suspend();
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
      if (!e.isPrimary) return;
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
cvs.addEventListener('wheel', e => {
  if (S.screen === 'play' || S.screen === 'loading') return;
  const [x, y] = xy(e);
  if (ui.wheel && ui.wheel(e.deltaY, x, y, S)) e.preventDefault();
}, { passive: false });

const GAME_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'Escape', 'KeyP', 'KeyU', 'KeyH', 'KeyR',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', e => {
  if (!GAME_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || S.screen === 'loading') return;
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

// ------------------------------------------------------------------ platform hooks
P.onPause(() => {
  stopLoop();
  safe(audio.suspend);
  if (P.env === 'web' && S.screen === 'play') pause();
});
P.onResume(() => {
  last = performance.now();
  startLoop();
  if (P.audioOn) safe(audio.resume);
});
P.onAudio(on => { if (on && !P.paused) safe(audio.resume); else safe(audio.suspend); });

// ------------------------------------------------------------------ boot (§11)
async function boot() {
  fitWindow();
  drawLoading();
  P.firstFrame();
  startLoop();
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
