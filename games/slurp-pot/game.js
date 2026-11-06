// Slurp Pot entry (Core, GDD §13.3 / §13.5 / §13.6 / §11.1). No exports.
//   boot (§13.6): #ui loading frame drawn synchronously -> P.firstFrame() before any await -> P.init + meta ->
//   render3d.initRender (render2d.js on failure or ?gl=0) + loadLevel -> warmUp raced against 2.5 s -> title + audio
//   graph -> modes.install(api) -> P.ready().
//   loop (§13.5): fixed DT sim with an accumulator, MAX_STEPS cap, slow-mo (slowT owned here), interpolation alpha,
//   events drained onto the bus every frame, then render3d.update/draw and ui.draw.
//   state machine: title | map | play | win | fail | pause | daily | feast | shop | cookbook | settings | alldone |
//   gift | ladder | lid | feastend  (screen names and cmds are listed in studio/2026-11-04/core/notes.txt).
//
// DECISION: the other roles' modules are loaded with dynamic import() after P.firstFrame(), so the loading frame is
//   on screen before the ~600 KB three bundle parses, and a module that fails to load shows the friendly paper card
//   instead of a blank page. meta.js is awaited first (P.init needs DEFAULT_SAVE/migrate); the rest load in parallel.
// DECISION: UI asks game for actions through the bus ('cmd' {cmd, ...}) or by calling the api object, which is
//   passed to ui.initUI as an extra field (initUI(canvas, { meta, audio, layout, render, bus, input, api })).
// DECISION: the win card shows WIN_CARD_S (1.6 s + the 1.2 s slow-mo) after the logic `win` event, or FIN_CARD_S after
//   it when a final boss bite ran the finisher (the stamp already landed on the boom), and the fail card
//   FAIL_CARD_S after `fail`, counted in real frame time (paused time does not count); qa forceResult shows at once.
// DECISION: a host pause opens the Pause card only on the web when the tab is actually hidden (P.env === 'web' and
//   document.hidden), never on yt or a portal's own pause (§11.1).
// DECISION: record/og modes (?record=1, ?og=1) never start the rAF loop; modes.js drives api.tick(1/60) itself.
import P from '../shared/platform.js';
import * as C from './consts.js';
import * as bus from './bus.js';
import { withMercy, mercySecs, mercyGrow, carryAfterWin } from './mercy.js';
import { createInput } from './input.js';

const PAPER = '#FFF6E3', PAPER_SHADE = '#EBD9B8', INK = '#3A2418', GOLD = '#F5B323', GOLD_SHADE = '#B9770E', STAMP = '#E5483B';
const WIN_CARD_S = 1.2 + 1.6;   // slow-mo (real s) + the ORDER UP stamp hold
const WIN_STRIP_MAX = 20;        // up to here NEXT goes straight on and rewards ride on the win card (see next())
const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const FIN_CARD_S = 0.8;          // after a final boss bite: `win` lands ~1.3 s in, the finisher ends at 1.9, so the card comes at ~2.1 s
const FIN_BIG_CARD_S = 2.0;      // milestones (L10 ... L60): the render lane holds the close-up 0.5 s longer, so the card comes at ~3.3 s
const FIN_L60_CARD_S = 3.0;      // the finale: one more second so the L60 fireworks play out in front of the card, ~4.3 s
// DECISION (11-06 Fri, mercy, see mercy.js): a fixed long clock took the sweat away from everyone (casual 100 % on L4 to L15), so the
//   help follows the player instead. Each time-out on a level or Daily makes the next try easier, a win carries one step less to the
//   next one (save.help), and the seconds are grace, so stars keep the old pace. Spoiled orders get none because time cannot help.
//   Feast never gets it. Tuning and verify read the base level, so no stored stat moves.
const FAIL_CARD_S = 0.8;
const PERF_AFTER_S = 20;
const SCREENS = ['title', 'map', 'play', 'win', 'fail', 'pause', 'daily', 'feast', 'shop', 'cookbook', 'settings', 'alldone', 'gift',
  'ladder', 'lid', 'feastend'];
const CHIP_SCREENS = new Set(['loading', 'title', 'map']); // site chips (web) visible only here
const BOOSTERS = ['magnet', 'freeze', 'mega'];

const $stage = document.getElementById('stage');
let $c = document.getElementById('c'); // the scene canvas; the Canvas2D fallback swaps in a fresh one (freshCanvas)
const $ui = document.getElementById('ui');
const g2 = $ui.getContext('2d');

// ------------------------------------------------------------------ errors
let lastErr = '', lastErrT = 0;
function report(e) {
  const msg = String((e && e.message) || e);
  const t = performance.now();
  if (msg === lastErr && t - lastErrT < 2000) return;
  lastErr = msg; lastErrT = t;
  try { P.error(e); } catch {}
}
const safe = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (e) { report(e); } };
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const has = (m, k) => !!m && typeof m[k] === 'function';
addEventListener('error', e => report(e.error || e.message));
addEventListener('unhandledrejection', e => report(e.reason));
bus.setReporter(e => report(e));

// ------------------------------------------------------------------ modules (filled in boot)
// render3d is the ACTIVE scene renderer: render3d.js, or render2d.js (same API) once use2d has swapped it in.
let logic = null, levels = null, render3d = null, ui = null, layout = null, audio = null, meta = null;
let modes = null, bots = null, feast = null;
let M = {}; // parsed modes

// ------------------------------------------------------------------ state
const S = {
  screen: 'loading', data: null, paused: false,
  kind: 'level', n: 1, lvl: null, w: null, fs: null,
  bot: null, botKind: 'greedy', qaBot: null,
  driver: null, recLevel: null, // REC run: modes' director decide(w, dt) and REC course (api.startRecord opts)
  started: false, resultDone: false, cardFreezeUsed: false,
  pend: null,            // { t, screen, data } card waiting for its real-time delay
  W: 390, H: 844, dpr: 1, L: null,
  ready: false, fatal: '', glLost: false, glLostAt: [],
  gfx: '',               // active scene renderer: '3d' (render3d.js) or '2d' (render2d.js Canvas2D fallback)
  tutStep: 0, userMuted: false, gestured: false, playT: 0,
  live: false,           // a level is in progress (play, its Pause card, Settings opened from Pause)
  stack: [],             // Back targets for overlay screens
  queue: null,           // NEXT chain { list: [[screen, data]], n: next level }
  run: null,             // Daily star-line counters of the current attempt { eaten: {kind: n}, big, boosts }
  feastOk: false,        // feast.js answers createFeast (a throwing stub keeps Feast on its card)
  fsTown: '', fsSeed: 0, skin: '',
};
let input = null;
let realT = 0;
let raf = 0, running = false, last = 0, acc = 0, slowT = 0; // loop state (§13.5); declared before boot step 1 uses it
let tensionOn = false; // last value sent to audio.setTension

const hostPaused = () => !!P.paused;
const save = () => (meta && has(meta, 'get') ? meta.get() : P.data) || {};
const levelId = () => (S.kind === 'level' ? S.n : S.kind);
const r1 = x => Math.round((+x || 0) * 10) / 10;
const r2 = x => Math.round((+x || 0) * 100) / 100;
const secsOf = w => (w && w.tStart != null ? Math.max(0, Math.round(w.t - w.tStart)) : 0);

// ------------------------------------------------------------------ sizing
function fit() {
  const r = $stage.getBoundingClientRect();
  const W = Math.max(1, Math.round(r.width || innerWidth || 390));
  const H = Math.max(1, Math.round(r.height || innerHeight || 844));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const changed = W !== S.W || H !== S.H || dpr !== S.dpr || !S.L;
  S.W = W; S.H = H; S.dpr = dpr;
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if ($ui.width !== bw) $ui.width = bw;
  if ($ui.height !== bh) $ui.height = bh;
  if (!changed) return false;
  if (layout && has(layout, 'computeLayout')) {
    S.L = safe(layout.computeLayout, W, H, has(layout, 'insets') ? safe(layout.insets) : undefined) || S.L;
  }
  if (render3d && S.ready !== 'pre' && has(render3d, 'resize')) safe(render3d.resize, W, H, S.L ? S.L.play : { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 });
  if (ui && has(ui, 'resize')) safe(ui.resize, W, H, S.L);
  return true;
}
function onResize() {
  if (M.record || M.og) return; // record/og pin their own capture size
  if (!fit()) return;
  // Paused or not looping: the canvases were cleared by the resize, so paint one frame now.
  if (!running || S.paused || hostPaused()) paint(0, true);
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 120));

// ------------------------------------------------------------------ 2D frames drawn by Core (loading, fatal, GL lost)
function begin2d() {
  g2.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  return g2;
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const DISPLAY = '"Lilita One", "Arial Rounded MT Bold", "Arial Black", system-ui, sans-serif';
const BODY = 'Nunito, system-ui, -apple-system, sans-serif';
function drawPot(g, cx, cy, s, t) {
  // pot silhouette: body, rim, handles, three steam wisps
  g.save();
  g.translate(cx, cy);
  g.fillStyle = INK;
  g.beginPath(); g.ellipse(-s * 1.08, -s * 0.18, s * 0.22, s * 0.12, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(s * 1.08, -s * 0.18, s * 0.22, s * 0.12, 0, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(-s, -s * 0.3);
  g.bezierCurveTo(-s, s * 0.75, -s * 0.55, s * 0.82, 0, s * 0.82);
  g.bezierCurveTo(s * 0.55, s * 0.82, s, s * 0.75, s, -s * 0.3);
  g.closePath(); g.fill();
  g.fillStyle = GOLD;
  g.strokeStyle = INK; g.lineWidth = Math.max(2, s * 0.08);
  g.beginPath(); g.ellipse(0, -s * 0.3, s * 1.06, s * 0.3, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#7A3E1E';
  g.beginPath(); g.ellipse(0, -s * 0.28, s * 0.86, s * 0.2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(58,36,24,0.35)'; g.lineWidth = Math.max(2, s * 0.07); g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const ph = t * 1.6 + i * 1.3, x0 = i * s * 0.42, a = 0.5 + 0.5 * Math.sin(ph);
    g.globalAlpha = 0.35 + 0.5 * a;
    g.beginPath();
    g.moveTo(x0, -s * 0.62);
    g.bezierCurveTo(x0 - s * 0.18, -s * 0.85, x0 + s * 0.18, -s * 1.0, x0 + s * 0.02 * Math.sin(ph), -s * (1.2 + 0.08 * a));
    g.stroke();
  }
  g.restore();
}
function drawLoading() {
  const g = begin2d(), W = S.W, H = S.H, m = Math.min(W, H);
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  const s = Math.max(40, Math.min(110, m * 0.17));
  const cy = H * 0.46;
  drawPot(g, W / 2, cy, s, realT);
  const fs = Math.max(30, Math.min(84, m * 0.13));
  g.font = `${fs}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = GOLD_SHADE; g.fillText('SLURP POT', W / 2, cy - s * 1.55 + fs * 0.08);
  g.fillStyle = INK; g.fillText('SLURP POT', W / 2, cy - s * 1.55);
  // three bouncing dots under the pot
  for (let i = 0; i < 3; i++) {
    const a = Math.max(0, Math.sin(realT * 5 - i * 0.7));
    g.fillStyle = i === 1 ? STAMP : GOLD;
    g.beginPath(); g.arc(W / 2 + (i - 1) * 18, cy + s * 1.25 - a * 7, 5, 0, Math.PI * 2); g.fill();
  }
}
let fatalBtn = null;
// Splits text into at most 2 lines that fit maxW at the current font, then shrinks the font until they do (min px).
function fitLines(g, text, maxW, px, font, min = 14) {
  for (; px >= min; px--) {
    g.font = font(px);
    if (g.measureText(text).width <= maxW) return { lines: [text], px };
    const words = String(text).split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const wmax = Math.max(g.measureText(a).width, g.measureText(b).width);
      if (wmax <= maxW && (!best || wmax < best.w)) best = { lines: [a, b], w: wmax };
    }
    if (best) return { lines: best.lines, px };
  }
  g.font = font(min);
  return { lines: [text], px: min };
}
function drawCard(title, sub, btn) {
  // DECISION: the title wraps to two lines and then shrinks (min 14 px) so the WebGL-fail card never clips at 320 px.
  const g = begin2d(), W = S.W, H = S.H;
  const cw = Math.min(W - 32, 420), x = (W - cw) / 2;
  const T = fitLines(g, title, cw - 40, cw < 340 ? 21 : 24, px => `${px}px ${DISPLAY}`), lh = Math.round(T.px * 1.15);
  const extra = (T.lines.length - 1) * lh, chh = (btn ? 250 : 190) + extra, y = (H - chh) / 2;
  g.fillStyle = 'rgba(58,36,24,0.45)'; g.fillRect(0, 0, W, H);
  g.fillStyle = PAPER_SHADE; rrect(g, x, y + 6, cw, chh, 22); g.fill();
  g.fillStyle = PAPER; rrect(g, x, y, cw, chh, 22); g.fill();
  g.strokeStyle = INK; g.lineWidth = 3; rrect(g, x, y, cw, chh, 22); g.stroke();
  drawPot(g, W / 2, y + 58, 26, realT);
  g.textAlign = 'center'; g.fillStyle = INK;
  g.font = `${T.px}px ${DISPLAY}`;
  T.lines.forEach((l, i) => g.fillText(l, W / 2, y + 128 + i * lh));
  let sp = 16; g.font = `700 ${sp}px ${BODY}`;
  while (sp > 11 && g.measureText(sub).width > cw - 40) g.font = `700 ${--sp}px ${BODY}`;
  g.fillText(sub, W / 2, y + 156 + extra);
  fatalBtn = null;
  if (btn) {
    const bw = 180, bh = 52, bx = W / 2 - bw / 2, by = y + chh - bh - 22;
    g.fillStyle = GOLD_SHADE; rrect(g, bx, by + 5, bw, bh, 16); g.fill();
    g.fillStyle = GOLD; rrect(g, bx, by, bw, bh, 16); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3; rrect(g, bx, by, bw, bh, 16); g.stroke();
    g.fillStyle = INK; g.font = `24px ${DISPLAY}`; g.textBaseline = 'middle';
    g.fillText(btn, W / 2, by + bh / 2 + 1);
    g.textBaseline = 'alphabetic';
    fatalBtn = { x: bx, y: by, w: bw, h: bh };
  }
}
function drawFatal() {
  const g = begin2d();
  g.fillStyle = PAPER; g.fillRect(0, 0, S.W, S.H);
  drawCard(S.fatal === 'gl' ? "Your browser can't draw 3D right now." : 'Something went wrong.', 'Try reloading.', 'Reload');
}
function fatal(kind, e) {
  if (e) report(e);
  S.fatal = kind || 'boot';
  stopLoop();
  S.paused = true;
  if (input) input.enable(false);
  safe(P.gameplayStop);
  if (audio) safe(audio.suspend);
  document.body.classList.remove('sp-play');
  drawFatal();
  safe(P.ready); // the host must not wait forever on a game that cannot draw
}
$ui.addEventListener('pointerup', e => {
  if (!S.fatal || !fatalBtn) return;
  const r = $ui.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (x >= fatalBtn.x && x <= fatalBtn.x + fatalBtn.w && y >= fatalBtn.y && y <= fatalBtn.y + fatalBtn.h) location.reload();
});

// ------------------------------------------------------------------ boot step 1 (synchronous)
fit();
drawLoading();
P.firstFrame();
startLoop();

// ------------------------------------------------------------------ loop (§13.5)
function startLoop() {
  if (running || hostPaused() || S.fatal || M.record || M.og) return;
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
  const dtReal = Math.min(C.DTREAL_MAX, Math.max(0, (now - last) / 1000));
  last = now;
  tick(dtReal);
  perfSample(dtReal);
}

/** One full frame: sim steps for dtReal of real time, event drain, render, UI. Record mode calls it with 1/60. */
function tick(dtReal) {
  realT += dtReal;
  if (S.fatal) { drawFatal(); return; }
  if (S.ready !== true) { drawLoading(); return; }
  if (S.paused || S.glLost) { paint(dtReal, false); return; }
  simAdvance(dtReal);
  paint(dtReal, true);
}
/** §13.5 sim half of a frame: slow-mo, fixed steps, bus drain, delayed result card. No drawing (api.advance uses it alone). */
function simAdvance(dtReal) {
  const w = S.w;
  if (slowT > 0) slowT -= dtReal;
  const scale = slowT > 0 ? C.SLOWMO : 1;
  if (S.screen === 'play' && w) {
    acc += dtReal * scale;
    let steps = 0;
    // DECISION: booster buttons (soft) let a drag of >= 8 px become the stick; other HUD buttons never start a drag.
    if (ui && has(ui, 'rects')) input.setBlockRects((safe(ui.rects) || []).map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, drag: !!r.soft })));
    while (acc >= C.DT && steps < C.MAX_STEPS) {
      let inp;
      if (S.driver && S.kind === 'record') { try { inp = S.driver(w, C.DT); } catch (e) { report(e); S.driver = null; } }
      if (inp) { /* REC: modes' director */ } else if (S.bot) inp = bots.decide(S.bot, w, C.DT);
      else {
        inp = input.sample();
        if (S.qaBot) safe(bots.decide, S.qaBot, w, C.DT); // keeps api.botDir() current for __qaInput
      }
      logic.step(w, inp, C.DT);
      if (S.fs) { try { feast.feastStep(S.fs, w, C.DT); } catch (e) { report(e); } }
      acc -= C.DT; steps++;
    }
    if (steps === C.MAX_STEPS) acc = 0;
    drain();
  } else if (w && w.events && w.events.length) drain();
  syncTension();
  if (S.pend) {
    S.pend.t -= dtReal;
    if (S.pend.t <= 0) { const p = S.pend; S.pend = null; go(p.screen, p.data); }
  }
}
/** Audio tension for the last LOW_TIME s of a timed run. */
function syncTension() {
  // DECISION: Core sends audio.setTension exactly (play screen, started, no result, 0 < tLeft <= LOW_TIME), so a Freeze
  //   continue (+time) or the result card drops the tension at once instead of waiting out audio's lowTime hold.
  const w = S.w;
  const on = !!(S.screen === 'play' && w && w.timed && !w.result && w.tStart !== null && w.tLeft > 0 && w.tLeft <= num(C.LOW_TIME, 10));
  if (on === tensionOn) return;
  tensionOn = on;
  if (audio && has(audio, 'setTension')) safe(audio.setTension, on);
}
function drain() {
  const w = S.w;
  if (!w || !w.events || !w.events.length) return;
  const evs = w.events.splice(0);
  for (const ev of evs) {
    if (!ev || !ev.type) continue;
    if (ev.type === 'win' && S.kind === 'record') ev.stars = 3;
    bus.emit(ev.type, ev);
    if (S.w !== w) break; // a listener started another level; the rest belong to the old world
  }
}
function paint(dtReal, with3d) {
  // DECISION (Render request 14:11): render3d.update runs every 3D frame, world or not (null on a world-less screen),
  //   so the title orbit and camera keep moving; render3d builds its own backdrop world when it gets null.
  const w = S.w;
  if (with3d && render3d) {
    const alpha = S.screen === 'play' ? Math.min(1, acc / C.DT) : 1;
    try {
      render3d.update(w || null, dtReal, alpha);
      render3d.draw();
    } catch (e) { report(e); }
  }
  if (ui) {
    try { ui.draw(view(), w, dtReal); } catch (e) { report(e); }
    syncLayout();
  }
  if (S.glLost) drawCard('Reloading graphics…', 'One moment.', null);
}

// ui.js owns the live layout (it knows the ticket line count); keep S.L, input RAD and the render play rect on it.
function syncLayout() {
  if (!has(ui, 'layoutNow')) return;
  let L = null;
  try { L = ui.layoutNow(); } catch {}
  if (!L || L === S.L) return;
  S.L = L;
  if (render3d && S.ready === true && L.play) safe(render3d.resize, S.W, S.H, L.play);
}
// The object ui.draw gets every frame (kept in one place; extra fields are free for ui.js to use).
const V = {};
function view() {
  V.screen = S.screen; V.mode = S.kind; V.kind = S.kind; V.paused = S.paused; V.level = S.n; V.n = S.n;
  V.data = S.data; V.L = S.L; V.W = S.W; V.H = S.H; V.dpr = S.dpr; V.t = realT;
  V.started = S.started; V.pending = S.pend ? S.pend.screen : ''; V.refused = S.refused || '';
  V.stick = input ? input.stick() : null; V.held = input ? input.held : false; V.pointer = input ? input.type : '';
  V.muted = isMuted(); V.userMuted = S.userMuted; V.env = P.env; V.showMute = P.showMute; V.portal = P.portal;
  V.tutStep = S.tutStep; V.slow = slowT > 0; V.lvl = S.lvl; V.bot = !!S.bot;
  V.record = !!M.record; V.og = !!M.og; V.qa = !!M.qa;
  V.boosters = save().boost || null; V.live = S.live;
  return V;
}

// ------------------------------------------------------------------ perf event (§11.1): once per session after 20 s of play
const perfIv = [];
let perfPlay = 0, perfSent = false;
function perfSample(dtReal) {
  if (perfSent || S.screen !== 'play' || S.paused || !S.started || !S.w || S.w.result) return;
  perfIv.push(dtReal);
  perfPlay += dtReal;
  if (perfPlay < PERF_AFTER_S) return;
  perfSent = true;
  const a = perfIv.slice().sort((x, y) => x - y), med = a[a.length >> 1] || 1 / 60;
  const st = (render3d && has(render3d, 'stats') && safe(render3d.stats)) || {};
  P.event('perf', { fps: Math.round(1 / Math.max(1e-3, med)), tier: st.tier || '', dpr: r2(st.dpr || 0) });
  perfIv.length = 0;
}

// ------------------------------------------------------------------ state machine
function setChips() {
  document.body.classList.toggle('sp-play', !CHIP_SCREENS.has(S.screen));
}
// Screens that Back returns from (a small stack, so title -> map -> settings -> back -> back lands on title).
// audio.setMode per screen: the loop plays full in play/map, melody-only on the title, -6 dB under every card.
const AUDIO_MODE = { play: 'play', map: 'map', title: 'title' };
const OVERLAYS = new Set(['settings', 'shop', 'cookbook', 'daily', 'feast', 'map', 'gift', 'alldone', 'ladder', 'lid', 'feastend']);
/**
 * Switches screen (never starts a level: startLevel does that). Leaving a live level for anything but the Pause card
 * (or Settings opened from it) sends quit_level.
 * DECISION: Settings opened from Pause keeps the level paused (no sim, audio held) and Back returns to Pause.
 */
function go(screen, data, returning) {
  if (!SCREENS.includes(screen)) screen = 'title';
  const prev = S.screen;
  if (S.live && screen !== 'play' && screen !== 'pause' && !(screen === 'settings' && prev === 'pause')) quitLevel();
  if (screen === 'title' || screen === 'map') S.resumeN = 0;
  if (screen === 'title' || screen === 'play') S.stack.length = 0;
  else if (OVERLAYS.has(screen) && prev !== screen && !returning && prev !== 'loading') S.stack.push(prev);
  S.pend = null;
  S.screen = screen;
  S.data = data || null;
  S.paused = screen === 'pause' || (screen === 'settings' && S.live);
  if (screen !== 'play') {
    if (input) input.enable(false);
    safe(P.gameplayStop);
  } else if (input) input.enable(true);
  if (prev === 'shop' || prev === 'settings') syncSkin(); // ui.js may have called meta.wear / meta.reset itself
  if (render3d && has(render3d, 'title')) safe(render3d.title, screen === 'title');
  if (ui) safe(ui.show, screen, data);
  if (audio && has(audio, 'setMode')) safe(audio.setMode, AUDIO_MODE[screen] || 'card');
  setChips();
  if (S.paused) { if (audio) safe(audio.suspend); safe(P.flush); }
  else audioOn();
  bus.emit('screen', { screen, prev, data });
}
/** Back / Esc on a card: the gift chain first, else the screen we came from (Pause only while the level is live). */
function back() {
  if (S.queue) return advance();
  if (S.screen === 'lid') safe(meta.lidCard, true);
  if (S.screen === 'ladder' && S.resumeN) { const n = S.resumeN; S.resumeN = 0; S.stack.length = 0; return n > C.LEVELS ? toAllDone() : startLevel(n); }
  if (S.screen === 'ladder' || S.screen === 'feastend') { S.stack.length = 0; go('title'); return true; }
  let to = S.stack.pop() || 'title';
  while (to === S.screen || (to === 'pause' && !S.live) || to === 'loading' || to === 'play' || to === 'win' || to === 'fail') {
    if (to === 'pause' && !S.live) { to = 'title'; break; }
    to = S.stack.pop() || 'title';
    if (to === 'title') break;
  }
  go(to, null, true);
  return true;
}

/** Booster k is unlocked: meta's rule (cur >= unlock level or gifted), or a campaign level at/after its unlock (qa jumps). */
function boosterOk(k, kind = S.kind, n = S.n) {
  if (kind === 'feast' || kind === 'record') return false;
  if (kind === 'level' && n >= C.BOOST_UNLOCK[k]) return true;
  if (has(meta, 'boosterUnlocked')) return !!safe(meta.boosterUnlocked, k);
  return (save().cur || 1) >= C.BOOST_UNLOCK[k];
}
/**
 * Owned counts handed to createWorld (bots read them; logic itself only enforces one use per kind per attempt).
 * DECISION: Daily uses the player's own unlocks (Tuesday's reach 99 gave Mega-rim to a cur-7 Daily); Feast gets none.
 */
function boostersFor(n, kind = 'level') {
  const b = save().boost || {};
  const o = {};
  for (const k of BOOSTERS) o[k] = boosterOk(k, kind, n) ? (b[k] | 0) : 0;
  return o;
}

/** Builds and enters a level. kind = 'level' | 'daily' | 'feast' | 'record'. retry skips the goal reveal. */
function startLevel(n, opt = {}) {
  if (!S.ready || S.fatal) { S.refused = S.fatal ? 'fatal' : 'not ready'; return false; }
  const kind = opt.kind || 'level';
  if (kind === 'level') {
    n = Math.max(1, Math.min(C.LEVELS, n | 0 || 1));
    S.resumeN = 0;                                  // back in the campaign, whichever way
  }
  let lvl = null, fs = null;
  // DECISION: a Feast "Restart" (pause card) replays the same seed; a new run (Start Feast, Again) gets a fresh one.
  //   The town is remembered through meta.feastTown(town) so the Feast card and title PLAY reopen it.
  if (kind === 'feast' && !S.feastOk) return false; // feast.js not built yet: stay on the Feast card, no error
  try {
    if (kind === 'daily') lvl = levels.getDaily(meta.dailyKey(), save().cur || 1);
    else if (kind === 'record') lvl = S.recLevel || levels.getRecord();
    else if (kind === 'feast') {
      const town = opt.town || S.fsTown || feastTown();
      const same = opt.retry && S.fs && S.fsTown === town;
      fs = feast.createFeast(town, same ? S.fsSeed : ((Date.now() / 1000) | 0), { cur: save().cur || 1 });
      S.fsTown = town; S.fsSeed = fs && fs.seed != null ? fs.seed : S.fsSeed;
      if (has(meta, 'feastTown')) safe(meta.feastTown, town);
      lvl = feast.feastLevel(fs);
    } else lvl = levels.getLevel(n);
  } catch (e) { report(e); S.refused = 'build: ' + (e && e.message); return false; }
  if (!lvl) { S.refused = 'no level'; return false; }
  if (kind === 'level' || kind === 'daily') {
    // The step follows the player: fails on this level or Daily raise it, and a new one starts from the carried step.
    const key = kind === 'daily' ? 'daily' : n;
    if (S.mercyN !== key) { S.mercyN = key; S.mercy = save().help | 0; }
    S.mercyBase = lvl;
    lvl = withMercy(lvl, S.mercy | 0);
  }
  const town = lvl.town;
  let w = null;
  const wopt = kind === 'record' ? { mode: 'record', boosters: {}, recordPath: lvl.path || null } : { mode: kind, boosters: boostersFor(n, kind) };
  try { w = logic.createWorld(lvl, wopt); } catch (e) { report(e); S.refused = 'world: ' + (e && e.message); return false; }
  const sameLevel = S.lvl === lvl || (S.lvl && S.lvl.n === lvl.n && S.kind === kind && kind === 'level');
  S.kind = kind; S.n = kind === 'level' ? n : 0; S.lvl = lvl; S.w = w; S.fs = fs;
  if (kind !== 'record') { S.driver = null; S.recLevel = null; }
  S.started = false; S.resultDone = false; S.cardFreezeUsed = false; S.queue = null;
  S.run = { eaten: {}, big: 0, boosts: 0 };
  S.retry = !!opt.retry && sameLevel;
  acc = 0; slowT = 0; S.finBite = false;
  if (render3d) safe(render3d.loadLevel, lvl, save().wear || 'sunny');
  if (audio) { safe(audio.setTown, town); if (has(audio, 'setFeast')) safe(audio.setFeast, kind === 'feast'); }
  S.bot = (S.botOn && bots && safe(bots.createBot, S.botKind, (lvl.seed | 0) + 1)) || null;
  S.qaBot = (M.qa && bots && !S.bot && qaSteerBot((lvl.seed | 0) + 7)) || null;
  if (input) input.reset();
  bus.emit('levelStart', { n: S.n, kind, retry: S.retry, town, level: lvl, w });
  S.live = false; // the old level (if any) was quit by the caller; go('play') must not send quit_level
  go('play', { n: S.n, kind, retry: S.retry, town, level: lvl });
  S.live = true;
  return true;
}
/** The bot behind __qaInput. SLOW_HAND is the slow-hand model of tools/slurp-pot/slow-hand.mjs; keep the two the same. */
const SLOW_HAND = { m: 0.55, lag: 0.7, sigma: 35 * Math.PI / 180, every: 0.5 };
function qaSteerBot(seed) {
  const k = S.qaKind || 'greedy';
  return safe(bots.createBot, k, seed, k === 'greedy' ? {} : { P: SLOW_HAND });
}
function retry() {
  if (S.kind === 'feast') return startLevel(0, { kind: 'feast', town: S.fsTown, retry: S.screen !== 'feastend' });
  return startLevel(S.n, { kind: S.kind, retry: true });
}
/**
 * Title PLAY.
 * DECISION: after L60 (cur > 60) PLAY shows the All-done screen once if the L60 NEXT never got there
 *   (meta.allDoneFresh), then starts today's Daily Order if it is unlocked and not done, else a Feast run in the last
 *   Feast town, else the All-done screen (GDD §3.12 "After L60", WED-BRIEF Core).
 */
function playCur() {
  const cur = save().cur || 1;
  if (cur <= C.LEVELS) return startLevel(cur);
  if (has(meta, 'allDoneFresh') && safe(meta.allDoneFresh)) return toAllDone();
  if (dailyOpen() && startLevel(0, { kind: 'daily' })) return true;
  if (feastOpen() && startLevel(0, { kind: 'feast', town: feastTown() })) return true;
  return toAllDone();
}
function toAllDone() {
  if (has(meta, 'seen')) safe(meta.seen, 'alldone', true);
  go('alldone', { daily: dailyStatus(), dailyOpen: dailyOpen(), feastOpen: feastOpen() });
  return true;
}

// ---- sim events -> state
bus.on('start', () => {
  if (S.started) return;
  S.started = true;
  if (M.record || M.og || S.kind === 'record') return; // capture runs: no host gameplay calls, stats or analytics
  safe(P.gameplayStart);
  safe(meta.stat, 'plays', 1);
  P.event('level_start', { id: levelId(), town: S.lvl ? S.lvl.town : '', mode: S.kind });
});
// DECISION (Sim request 12:32): a Feast bossBite (final false, feast true) is a mini boss: no slow-mo, never a win
//   (feastStep owns the course roll-over); a non-final cake tier (cakeTier {tier, i}) gets the boss bite's slow-mo
//   for CAKE_SLOWMO_REAL s. P.happyTime stays on the winning bite only (one host signal per level).
bus.on('bossBite', ev => {
  if (ev && ev.final && !ev.feast && S.kind !== 'feast') { slowT = C.SLOWMO_REAL; S.finBite = true; safe(P.happyTime); }
});
bus.on('cakeTier', () => { if (S.screen === 'play') slowT = Math.max(slowT, num(C.CAKE_SLOWMO_REAL, 0.6)); });
// §3.9 in-level coins (meta.levelResult pays only the win): +1 on every 10th bite, +2 per sizzle. Not in record/og.
bus.on('bite', ev => {
  const w = S.w;
  if (!w || M.record || M.og) return;
  const b = (w.stats && w.stats.bites) | 0;
  if (b > 0 && b % 10 === 0 && S.kind !== 'feast') safe(meta.addCoins, 1, 'bite');
  if (S.run && ev) {
    S.run.eaten[ev.kind] = (S.run.eaten[ev.kind] | 0) + 1;
    if ((ev.tier | 0) >= 3) S.run.big++;
  }
});
bus.on('boost', () => { if (S.run) S.run.boosts++; });
// DECISION: Feast pays only its end card (+2 per ticket, +25 PB, D23), so in-run bite/sizzle coins are campaign/Daily only.
bus.on('sizzle', () => { if (!M.record && !M.og && S.kind !== 'feast') safe(meta.addCoins, 2, 'sizzle'); });
// Gull miss (target eaten inside the 1.6 s telegraph): +1 coin pop (Sim contract; meta credits through addCoins).
bus.on('gullMiss', () => { if (!M.record && !M.og && S.kind !== 'feast' && S.kind !== 'record') safe(meta.addCoins, 1, 'gull'); });
bus.on('feastCourse', ev => onFeastCourse(ev || {}));
bus.on('win', ev => onWin(ev || {}));
bus.on('fail', ev => onFail(ev || {}));

/**
 * Feast course roll-over (Sim contract 10:25): feastStep rewrites the same world in place and sends feastCourse
 * {c, level} halfway through the 0.6 s steam wipe; Core swaps S.lvl and reloads the scene. The run, clock, analytics
 * and S.started carry on (no level_start, no levelStart bus event).
 * DECISION: Core is the only caller of render3d.loadLevel for a course change (Render's onFx sees feastCourse too
 *   and should only draw the wipe), so the scene is rebuilt exactly once.
 */
function onFeastCourse(ev) {
  if (S.kind !== 'feast' || !ev.level) return;
  S.lvl = ev.level;
  if (render3d) safe(render3d.loadLevel, ev.level, save().wear || 'sunny');
}

function onWin(ev, now) {
  // DECISION (Meta request 11:07): a REC win shows no win card; play stays under modes' end card, and the win
  //   event carries 3 stars (drain sets them) for the ORDER UP stamp beat (§12.2 19.5-21.5).
  if (S.resultDone) return;
  if (S.kind === 'feast') return; // Sim 12:32: the Feast never wins; feastStep rolls courses and the clock ends it
  S.resultDone = true; S.live = false;
  if (!quietResult(ev) && (S.kind === 'level' || S.kind === 'daily')) { save().help = carryAfterWin(S.mercy | 0); safe(meta.save); }
  S.mercy = 0; S.mercyN = null;
  const w = S.w;
  if (input) input.enable(false);
  safe(P.gameplayStop);
  let stars = ev.stars | 0 || (w && w.stars) || 1;
  const tLeft = +ev.tLeft || 0, chainBest = ev.chainBest | 0;
  let res = {}, daily = null;
  if (S.kind === 'daily') {
    daily = dailyStarsOf(w, ev);
    if (daily) stars = daily.stars;
  }
  if (!quietResult(ev)) {
    try {
      if (S.kind === 'level') res = meta.levelResult(S.n, { stars, tLeft, chainBest }) || {};
      else if (S.kind === 'daily') res = meta.dailyResult(dailyKeyOf(), stars, daily ? daily.mask : undefined) || {};
    } catch (e) { report(e); }
    saveStats(w, false);
    safe(P.best, safe(meta.score) | 0);
    safe(P.flush);
    P.event('level_complete', { id: levelId(), stars, tLeft: r1(tLeft), chainBest, secs: secsOf(w) });
  }
  const data = { n: S.n, kind: S.kind, stars, tLeft, chainBest, coins: 0, newStars: 0, gifts: [], chest: null, milestone: null, nextSkin: null, ...res, ...(ev.data || {}) };
  const st = w && safe(logic.starTimes, w);
  data.t3Left = st && stars < 3 ? Math.max(0, Math.ceil(st.t3 - (tLeft - ((w && w.freezeAdded) || 0)))) : 0;
  data.bigBoss = S.kind === 'level' && S.n > 0 && S.n % 10 === 0;
  data.strip = S.kind === 'level' && S.n <= WIN_STRIP_MAX;
  if (daily) { data.mask = daily.mask; data.met = daily.met; data.lines = daily.lines; data.stars = stars; }
  if (S.kind === 'record') return;
  if (now) go('win', data);
  else S.pend = { t: S.finBite ? (S.kind === 'level' && C.isMilestone(S.n) ? (S.n === 60 ? FIN_L60_CARD_S : FIN_BIG_CARD_S) : FIN_CARD_S) : WIN_CARD_S, screen: 'win', data };
}
/** The Daily level's own IST key (a run started before midnight still pays that day), else today's. */
function dailyKeyOf() {
  const k = S.lvl && S.lvl.daily && S.lvl.daily.key;
  return k || (has(meta, 'dailyKey') ? meta.dailyKey() : '');
}
/**
 * Daily stars = star lines met (§3.12), via meta.dailyStars(lines, run). null when meta or the level has no lines
 * (then the logic's time stars stand).
 * DECISION: run.big counts bites of tier >= 3 (T3, T4 and bosses); run.left is §3.8's left share (time left at the
 *   final bite minus Freeze seconds, over T); run.boosts counts in-play boosters and the fail-card Freeze.
 */
function dailyStarsOf(w, ev) {
  const lines = S.lvl && S.lvl.daily && S.lvl.daily.lines;
  if (!w || !lines || !has(meta, 'dailyStars')) return null;
  const st = w.stats || {}, g = S.lvl.grace > 0 ? +S.lvl.grace : 0, T = (w.T || 1) - g; // grace seconds never count as time left
  const tl = (typeof ev.tLeft === 'number' ? ev.tLeft : (w.tLeft || 0)) - g;
  const run = {
    win: true, eaten: { ...((S.run && S.run.eaten) || {}) }, chainBest: ev.chainBest | 0, big: (S.run && S.run.big) | 0,
    left: Math.max(0, (tl - (w.freezeAdded || 0)) / T), bumps: st.bumps | 0, boosts: (S.run && S.run.boosts) | 0, sizzles: st.sizzles | 0,
  };
  const r = safe(meta.dailyStars, lines, run);
  if (!r || !(r.stars >= 1)) return null;
  return { stars: Math.max(1, Math.min(3, r.stars | 0)), mask: r.mask, met: r.met || null, lines, run };
}
/** qa forced results, record/og runs and the REC level never touch the save or analytics. */
function quietResult(ev) { return !!(ev && ev.forced) || !!M.record || !!M.og || S.kind === 'record'; }
/** meta stats for one finished attempt (bites, play time, fails). */
function saveStats(w, failed) {
  if (!w || M.record || M.og || !has(meta, 'stat')) return;
  safe(meta.stat, 'bites', (w.stats && w.stats.bites) | 0);
  safe(meta.stat, 'ms', Math.round(secsOf(w) * 1000));
  if (failed) safe(meta.stat, 'fails', 1);
}
function canFreeze(why) {
  if (why !== 'timeout' || S.kind === 'feast' || S.kind === 'record' || S.cardFreezeUsed) return false;
  if (!boosterOk('freeze')) return false;
  const sv = save();
  return ((sv.boost && sv.boost.freeze) | 0) > 0 || (sv.coins | 0) >= C.PRICES.freeze;
}
function onFail(ev, now) {
  if (S.resultDone) return;
  if (S.kind === 'feast') return endFeast(now, ev);
  S.resultDone = true; S.live = false;
  const w = S.w;
  if (input) input.enable(false);
  safe(P.gameplayStop);
  const why = ev.why === 'spoiled' ? 'spoiled' : 'timeout';
  if (!quietResult(ev)) {
    P.event('level_fail', { id: levelId(), why, progress: r2(safe(logic.progress, w)), secs: secsOf(w) });
    saveStats(w, true);
    safe(P.flush);
  }
  const data = { n: S.n, kind: S.kind, why, progress: w ? (safe(logic.sizeBar, w) || 0) : 0, missing: ev.missing || [], canFreeze: canFreeze(why), ...(ev.data || {}) };
  if ((S.kind === 'level' || S.kind === 'daily') && why === 'timeout' && S.mercyBase) {
    S.mercy = (S.mercy | 0) + 1;
    data.mercy = mercySecs(S.mercyBase, S.mercy); data.grow = mercyGrow(S.mercy) > 1; data.fails = S.mercy;
    data.growPct = Math.round((mercyGrow(S.mercy) - 1) * 100);
  }
  if (now) go('fail', data);
  else S.pend = { t: FAIL_CARD_S, screen: 'fail', data };
}
/**
 * The Feast clock hit 0: feast.feastResult -> meta.feastResult (pays, PB ghost) -> the Feast end card.
 * DECISION: a Feast run always ends on the clock, so it reports level_complete {id:'feast', stars:0, ..., tickets, pb}
 *   (a level_fail would make Feast read as a 100 % fail rate in the report); quiet results (qa forced) skip it.
 */
function endFeast(now, ev = {}) {
  S.resultDone = true; S.live = false;
  if (input) input.enable(false);
  safe(P.gameplayStop);
  let r = {}, res = {};
  const quiet = quietResult(ev);
  try { r = (S.fs && feast.feastResult(S.fs)) || {}; } catch (e) { report(e); }
  if (!quiet) {
    try { res = meta.feastResult(r) || {}; } catch (e) { report(e); }
    saveStats(S.w, false);
    safe(P.best, safe(meta.score) | 0);
    safe(P.flush);
    if (res.pb) safe(P.happyTime);
    P.event('level_complete', { id: 'feast', stars: 0, tLeft: 0, chainBest: r.chainBest | 0, secs: secsOf(S.w), tickets: r.tickets | 0, pb: !!res.pb });
  }
  const data = {
    n: 0, kind: 'feast', town: S.fsTown, stars: 0, tLeft: 0, chainBest: r.chainBest | 0, tickets: r.tickets | 0, secs: secsOf(S.w),
    coins: res.coins | 0, pb: !!res.pb, best: res.best != null ? res.best : (has(meta, 'feastBest') ? safe(meta.feastBest) | 0 : 0),
    newStars: 0, gifts: [], ...r, ...res, ...(ev.data || {}),
  };
  if (now) go('feastend', data); else S.pend = { t: FAIL_CARD_S, screen: 'feastend', data };
}

// ---- actions (UI buttons, keys, qa)
function pause() {
  if (S.screen !== 'play' || !S.w || S.resultDone) return false;
  if (input) input.reset();
  go('pause');
  return true;
}
function resume() {
  if (S.screen !== 'pause') return false;
  last = performance.now(); acc = 0;
  go('play', S.data && S.data.kind ? S.data : { n: S.n, kind: S.kind, retry: true, resumed: true });
  if (S.started) safe(P.gameplayStart);
  return true;
}
function quitLevel() {
  if (S.live && S.w && S.started && !S.resultDone) P.event('quit_level', { id: levelId(), progress: r2(safe(logic.progress, S.w)), secs: secsOf(S.w) });
  S.live = false;
}
/** In-play booster (UI already bought one when the stock was 0). Logic refuses a kind used this attempt. */
function useBooster(kind) {
  if (S.screen !== 'play' || !S.w || S.resultDone || !BOOSTERS.includes(kind) || !boosterOk(kind)) return false;
  const sv = save();
  if (((sv.boost && sv.boost[kind]) | 0) <= 0) { bus.emit('boostEmpty', { kind }); return false; }
  if (!safe(logic.useBooster, S.w, kind)) return false;
  safe(meta.takeBooster, kind);
  return true;
}
function freezeContinue() {
  if (S.screen !== 'fail' || !S.w || !canFreeze(S.data && S.data.why)) return false;
  const sv = save();
  let ok = ((sv.boost && sv.boost.freeze) | 0) > 0 ? !!safe(meta.takeBooster, 'freeze') : false;
  if (!ok && (sv.coins | 0) >= C.PRICES.freeze) ok = !!safe(meta.buyBooster, 'freeze') && !!safe(meta.takeBooster, 'freeze');
  if (!ok || !safe(logic.freezeContinue, S.w)) return false;
  S.cardFreezeUsed = true; S.resultDone = false; S.live = true;
  if (S.run) S.run.boosts++;
  safe(P.flush);
  last = performance.now(); acc = 0;
  go('play', { n: S.n, kind: S.kind, retry: true, freeze: true });
  if (S.started) safe(P.gameplayStart);
  bus.emit('freezeContinue', {});
  return true;
}
/**
 * Win card NEXT (§9.5): P.breakpoint(), then the gift / milestone / chest cards, then (first L6 win only) the Daily
 * card, then the next level (or All-done after L60). Daily and Feast results go back to the title.
 * DECISION (11-07 Sat, U6): up to L20 NEXT goes straight on. Everything is already paid inside meta.levelResult, so the
 *   full-screen cards only cost taps in the stretch where players leave; the win card shows the same rewards as a strip.
 *   From L21 the cards stay: by then they are rare, and a town chest deserves its moment.
 */
function next() {
  if (S.screen === 'ladder' || S.screen === 'feastend') return back(); // "Nice!" / a stray NEXT on an end card
  if (S.screen !== 'win') return false;
  safe(P.breakpoint);
  const d = S.data || {};
  // DECISION: Daily win NEXT -> the Ladder card (streak stamp + tomorrow's reward), "Nice!" -> title (§9.5).
  if (S.kind === 'daily') return go('ladder', { ...d, status: dailyStatus() });
  if (S.kind === 'feast') return go('title');
  const q = [];
  if (S.n > WIN_STRIP_MAX) {
    for (const g of d.gifts || []) q.push(['gift', { kind: g.k, count: g.n, gift: g }]);
    for (const m of d.milestones || (d.milestone ? [d.milestone] : [])) q.push(['gift', { kind: m.boost, count: 1, coins: m.coins, milestone: m }]);
    for (const c of d.chests || (d.chest ? [d.chest] : [])) q.push(['gift', { chest: c, coins: c.coins, town: c.town, boost: c.boost }]);
  }
  // DECISION: a player who is struggling is not pushed into a Daily at L6. The card waits for a calm win, L10 at the latest.
  const calm = !(save().help > 0) || S.n >= 10;
  if (S.n >= 6 && d.first && calm && (!has(meta, 'seen') || safe(meta.seen, 'dailyIntro', true))) q.push(['daily', { intro: true, status: dailyStatus() }]);
  S.queue = { list: q, n: S.n + 1 };
  return advance();
}
/** Next card of the NEXT chain (Collect / Later), or the next level once it is empty (All-done after L60). */
function advance() {
  const Q = S.queue;
  if (!Q) return go('title');
  const c = Q.list.shift();
  if (c) { go(c[0], c[1]); return true; }
  S.queue = null;
  if (Q.n > C.LEVELS) return toAllDone();
  return startLevel(Q.n);
}
const dailyStatus = () => (has(meta, 'dailyStatus') ? safe(meta.dailyStatus) || null : null);
/** Daily Order can start only once unlocked (after the L6 win, §3.12) and not already played today. */
function dailyOpen() {
  const st = dailyStatus();
  return !st || (st.unlocked !== false && !st.done);
}
/** Feast can start: feast.js is real and the player is past L12 (§3.12). */
function feastOpen() {
  return S.feastOk && (!has(meta, 'feastUnlocked') || !!safe(meta.feastUnlocked));
}
/** The Feast town: the last one picked (meta.feastTown), else the town of the last level beaten. */
function feastTown() {
  const t = has(meta, 'feastTown') ? safe(meta.feastTown) : '';
  if (t && C.TOWNS.includes(t)) return t;
  const n = Math.max(1, Math.min(C.LEVELS, (save().cur || 1) - 1));
  return (levels && has(levels, 'townOf') && safe(levels.townOf, n)) || 'picnic';
}
/** Daily is unlocked (a done day can still be replayed for fun: "Play again", no coins, §3.12). */
function dailyUnlocked() {
  const st = dailyStatus();
  return !st || st.unlocked !== false;
}
function startDaily() { return dailyUnlocked() || M.qa ? startLevel(0, { kind: 'daily' }) : false; }
function startFeast(town) { return feastOpen() || M.qa ? startLevel(0, { kind: 'feast', town: town || feastTown() }) : false; }
function toScreen(name, data) {
  if (name === 'play') return playCur();
  if (name === 'daily' && data && data.go && dailyUnlocked()) return startDaily();
  if (name === 'feast' && data && (data.town || data.go) && feastOpen()) return startFeast(data.town);
  if (name === 'alldone') return toAllDone();
  if (name === 'daily') data = { status: dailyStatus(), ...(data || {}) };
  if (name === 'feast') data = { town: feastTown(), open: feastOpen(), best: has(meta, 'feastBest') ? safe(meta.feastBest) | 0 : 0, ...(data || {}) };
  go(name, data);
  return true;
}
/** Applies the worn skin to the pot when it changed outside a level load (Shop wear/buy, Settings reset). */
function syncSkin() {
  const id = save().wear || 'sunny';
  if (id === S.skin) return;
  S.skin = id;
  if (render3d && has(render3d, 'setSkin')) safe(render3d.setSkin, id);
}
/** After Settings > Reset progress (ui.js already called meta.reset()): fresh L1 world behind a fresh title. */
function afterReset() {
  S.queue = null; S.live = false; S.stack.length = 0;
  try {
    S.kind = 'level'; S.n = 1; S.fs = null;
    S.lvl = levels.getLevel(1);
    S.w = logic.createWorld(S.lvl, { mode: 'level', boosters: boostersFor(1) });
    if (render3d) safe(render3d.loadLevel, S.lvl, save().wear || 'sunny');
  } catch (e) { report(e); }
  safe(P.best, safe(meta.score) | 0);
  safe(P.flush);
  go('title');
  return true;
}
function setMuted(on) {
  S.userMuted = !!on;
  if (has(meta, 'setting')) safe(meta.setting, 'mute', S.userMuted); // kept only if meta knows a 'mute' key
  if (audio) safe(audio.setMuted, isMuted());
  if (isMuted()) { if (audio) safe(audio.suspend); } else audioOn();
}
function isMuted() { return !P.audioOn || S.userMuted; }
function audioOn() {
  if (!audio || isMuted() || hostPaused() || S.paused || !S.gestured) return;
  safe(audio.setMuted, false);
  safe(audio.resume);
}
function gesture() {
  if (!S.ready || !audio) return;
  if (!S.gestured) { S.gestured = true; if (!isMuted() && !hostPaused()) safe(audio.unlock); }
  if (!isMuted() && !hostPaused() && !S.paused) safe(audio.resume);
}

/**
 * One entry point for every UI action: ui.js calls api.cmd(act, data) (or bus 'cmd' {cmd, ...}).
 * ui.js acts: play next retry replay map level{n} resume restart pause settings freeze booster{kind} daily feast
 * screen{name} back mute{on} reset collect. On the Daily / Feast card, 'daily' / 'feast' starts the run; anywhere
 * else it opens that card.
 */
function command(name, d) {
  d = d || {};
  switch (name) {
    case 'play': case 'continue': return playCur();
    case 'level': case 'startLevel': {
      // DECISION: a UI level tap (map node, Cookbook "Play") is refused for a locked level; qa jumps use api.startLevel.
      const n = d.n | 0 || 1;
      if (has(meta, 'unlocked') && !safe(meta.unlocked, n)) return false;
      return startLevel(n);
    }
    case 'next': return next();
    case 'nice': case 'later': case 'phew': return back();
    case 'retry': case 'again': case 'replay': return retry();
    case 'restart': quitLevel(); return retry();
    case 'freeze': return freezeContinue();
    case 'pause': return pause();
    case 'resume': return resume();
    case 'togglePause': return S.screen === 'pause' ? resume() : pause();
    case 'booster': case 'boost': return useBooster(d.kind);
    case 'magnet': case 'mega': return useBooster(name);
    case 'daily': {
      // U6: a Daily taken from the win-chain intro comes back to the campaign, at the level the chain was heading to.
      if (S.screen === 'daily' && S.queue && S.data && S.data.intro) S.resumeN = S.queue.n;
      return ((S.screen === 'daily' || d.go) && dailyUnlocked() && startDaily()) || (S.screen === 'daily' ? false : toScreen('daily', d));
    }
    case 'startDaily': return startDaily();
    case 'feast': return ((S.screen === 'feast' || d.go || d.town) && feastOpen() && startFeast(d.town)) || (S.screen === 'feast' ? false : toScreen('feast', d));
    case 'startFeast': return startFeast(d.town);
    case 'wear': case 'buySkin': {
      const ok = !!safe(name === 'wear' ? meta.wear : meta.buySkin, d.id);
      if (ok) { syncSkin(); safe(P.flush); }
      return ok;
    }
    case 'buy': case 'buyBooster': { const ok = !!safe(meta.buyBooster, d.kind || d.id); if (ok) safe(P.flush); return ok; } // UI notes say {id}, ui.js sends {kind}
    case 'mute': return setMuted(typeof d.on === 'boolean' ? d.on : !S.userMuted);
    case 'back': return back();
    case 'collect': return advance();
    case 'reset': return afterReset();
    case 'title': case 'home': S.queue = null; go('title'); return true;
    case 'map': case 'shop': case 'cookbook': case 'settings': case 'alldone': return toScreen(name, d);
    case 'screen': case 'go': return toScreen(d.name || d.screen || d.to || 'title', d);
    case 'tut': S.tutStep = d.step | 0; return true;
    case 'reload': location.reload(); return true;
    default: return false;
  }
}
bus.on('cmd', d => { if (d) command(d.cmd || d.name || d.type, d); });

// ------------------------------------------------------------------ api (modes.install, ui)
const api = {
  state() {
    const sv = save();
    let daily = null;
    if (meta && has(meta, 'dailyStatus')) { try { daily = meta.dailyStatus(); } catch (e) { report(e); } }
    return {
      screen: S.screen, mode: S.kind, paused: S.paused || hostPaused(), level: S.n, daily,
      boosters: { magnet: (sv.boost && sv.boost.magnet) | 0, freeze: (sv.boost && sv.boost.freeze) | 0, mega: (sv.boost && sv.boost.mega) | 0 },
      tutStep: S.tutStep, live: S.live, stack: S.stack.slice(), queue: S.queue ? S.queue.list.length : -1,
      feastOk: S.feastOk, town: S.lvl ? S.lvl.town : '', course: S.fs ? S.fs.course | 0 : 0, gfx: S.gfx,
    };
  },
  world: () => S.w,
  feast: () => S.fs,
  startLevel: n => startLevel(n),
  startDaily: () => startLevel(0, { kind: 'daily' }),
  startFeast: town => startLevel(0, { kind: 'feast', town: town || feastTown() }),
  retry,
  next,
  pause, resume, useBooster, freezeContinue,
  toScreen,
  cmd: command,
  setBot(on, kind = 'greedy') {
    S.botOn = !!on; S.botKind = kind || 'greedy';
    S.bot = on && bots && S.lvl ? bots.createBot(S.botKind, (S.lvl.seed | 0) + 1) : null;
    if (S.bot && input) input.reset();
    return !!S.bot;
  },
  /** QA (U17): what __qaInput steers from. 'greedy' is the default; any other kind plays as a slow first-time hand. */
  setQaSteer(kind) {
    S.qaKind = kind || 'greedy';
    S.qaBot = M.qa && bots && !S.bot && S.lvl ? qaSteerBot((S.lvl.seed | 0) + 7) : null;
    return !!S.qaBot;
  },
  botPush: () => { const b = S.bot || S.qaBot; return b && b.out ? num(b.out.m, 0) : 0; },
  setTime(s) { if (S.w) { S.w.tLeft = +s; return true; } return false; },
  botDir() {
    const b = S.bot || S.qaBot;
    if (!b || !bots || !has(bots, 'screenDir') || S.screen !== 'play') return null;
    return safe(bots.screenDir, b) || null;
  },
  forceResult(kind, data = {}) {
    if (!S.w) startLevel(save().cur || 1);
    if (S.screen !== 'play' && S.screen !== 'pause' && S.screen !== 'win' && S.screen !== 'fail') startLevel(S.n || 1);
    S.resultDone = false; S.pend = null;
    if (kind === 'win') onWin({ stars: data.stars || 3, tLeft: data.tLeft != null ? data.tLeft : 21.4, chainBest: data.chainBest || 12, forced: true, data }, true);
    else onFail({ why: data.why || 'timeout', missing: data.missing || [], forced: true, data }, true);
    return true;
  },
  /** One frame with dtReal seconds (record/og: modes drives this with 1/60, no rAF). */
  tick(dtReal = 1 / 60) { tick(dtReal); },
  /** Sim only (fixed steps, bus, delayed cards), no drawing: og/cover fast-forward. */
  advance(dtReal = 1 / 60) { if (S.ready === true && !S.fatal && !S.paused) simAdvance(dtReal); },
  /**
   * §12.1 REC run: opts.level (modes' REC course) or levels.getRecord(), driven by opts.decide(w, dt) (modes'
   * director) or else the bots.js director; no boosters, recordPath, then the 0.4 s preroll pose.
   * DECISION: the preroll is 24 sim steps run here with the bus live (audio is never started in record mode and
   * results/analytics are quiet), so the record tool's frame 0 already has the chain going.
   */
  startRecord(opts = {}) {
    if (!levels || !has(levels, 'getRecord') || !bots) return false;
    S.driver = opts && typeof opts.decide === 'function' ? opts.decide : null;
    S.recLevel = (opts && opts.level) || null;
    S.botOn = !S.driver; S.botKind = 'director';
    if (!startLevel(0, { kind: 'record' })) return false;
    for (let i = 0; i < 24; i++) simAdvance(C.DT);
    acc = 0;
    return true;
  },
  loop(on) { if (on) startLoop(); else stopLoop(); },
  get acc() { return acc; },
  get slowT() { return slowT; },
  get ready() { return S.ready === true; },
  input: null,
  get render() { return render3d; },
  get ui() { return ui; },
  get layout() { return layout; },
  get meta() { return meta; },
  get audio() { return audio; },
  get logic() { return logic; },
  get levels() { return levels; },
  get bots() { return bots; },
  get L() { return S.L; },
  bus,
  P,
};

// ------------------------------------------------------------------ host pause / audio (§11.1, D26)
P.onPause(() => {
  stopLoop();
  if (input) input.reset();
  if (audio) safe(audio.suspend);
  safe(P.gameplayStop);
  if (P.env === 'web' && document.hidden && S.screen === 'play' && !S.resultDone) pause();
});
P.onResume(() => {
  if (hostPaused()) return;
  last = performance.now(); acc = 0;
  startLoop();
  audioOn();
  if (S.screen === 'play' && S.started && !S.resultDone) safe(P.gameplayStart);
});
P.onAudio(on => {
  if (!audio) return;
  safe(audio.setMuted, isMuted());
  if (!on) safe(audio.suspend);
  else audioOn();
});

// ------------------------------------------------------------------ input routing (#ui pointer -> ui first, keys)
function uiPos(e) { const r = $ui.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
for (const [type, name] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']]) {
  $ui.addEventListener(type, e => {
    if (name === 'down') gesture();
    if (!S.ready || S.fatal || !ui || hostPaused()) return;
    const [x, y] = uiPos(e);
    try { if (e.isPrimary) ui.pointer(name, x, y, e); else ui.pointer2(name, x, y, e.pointerId); } catch (err) { report(err); }
  });
}
// Map wheel (UI relay 12:2x): ui.wheel(dy in CSS px) scrolls the town map; true = consumed, so the page stays put.
$ui.addEventListener('wheel', e => {
  if (S.ready !== true || S.fatal || !ui || !has(ui, 'wheel') || hostPaused() || e.ctrlKey) return;
  let used = false;
  try { used = ui.wheel(e.deltaY * (e.deltaMode ? 40 : 1)); } catch (err) { report(err); }
  if (used) e.preventDefault();
}, { passive: false });
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Enter', 'NumpadEnter', 'KeyP', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3', 'KeyM']);
const MAP_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']); // game keys only while the map is open
const MAP_REPEAT = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);
// DECISION (UI relay 12:2x): PageUp/PageDown/Home/End are game keys only on the map (elsewhere the page keeps
//   them); on the map a held arrow or page key repeats (it scrolls), every other key still ignores repeats.
function keyIsOurs(e, onMap) {
  return (GAME_KEYS.has(e.code) || (onMap && MAP_KEYS.has(e.code))) && !e.ctrlKey && !e.metaKey && !e.altKey;
}
// DECISION (11-07 Sat, U7): Enter was never broken. A press inside the boot warm-up was dropped here, so a first key at 2.5 s did
//   nothing and the second one looked like the only key that worked. A start key during boot now waits for the title.
function keyBeforeReady(e) {
  if (S.fatal) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); location.reload(); } return true; }
  if (S.ready !== true) { if (START_KEYS.has(e.code)) S.startKey = true; return true; }
  return false;
}
addEventListener('keydown', e => {
  const onMap = S.screen === 'map';
  if (!keyIsOurs(e, onMap) || keyBeforeReady(e) || hostPaused()) return;
  if (S.screen !== 'play' && scrollY > 40) return;
  if (e.code !== 'Escape') e.preventDefault();
  if (e.repeat && !(onMap && MAP_REPEAT.has(e.code))) return;
  gesture();
  try {
    if (ui && has(ui, 'key') && ui.key(e)) return;
    coreKey(e.code);
  } catch (err) { report(err); }
});
function coreKey(code) {
  if (code === 'KeyP' || code === 'Escape') {
    // DECISION: on YouTube the host owns Esc (it leaves fullscreen), so there Esc only closes the pause card
    //   (PLAYBOOK: Esc closes dialogs) and P is the pause key. On the web Esc also opens Pause.
    if (S.screen === 'play' && (code === 'KeyP' || P.env !== 'yt')) return pause();
    if (S.screen === 'pause') return resume();
    return;
  }
  if (S.screen === 'play') {
    const i = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1, Digit3: 2, Numpad3: 2 }[code];
    if (i != null) useBooster(BOOSTERS[i]);
    if (code === 'KeyM' && P.showMute) setMuted(!S.userMuted);
  }
}

// ------------------------------------------------------------------ WebGL context loss (§13.7) + Canvas2D fallback
const GL0 = /[?&]gl=0(&|$)/.test(location.search); // force the Canvas2D renderer (testing)
const GL_RESTORE_MS = 5000; // a lost context not restored by then counts as gone for good
let glTimer = 0;
const $c3d = $c; // the WebGL canvas; its listeners stay on it even after a swap
$c3d.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  if (S.gfx !== '3d' || S.fatal) return;
  const t = performance.now();
  S.glLostAt = S.glLostAt.filter(x => t - x < 30000);
  S.glLostAt.push(t);
  if (S.screen === 'play' && !S.resultDone) pause();
  S.glLost = true;
  if (input) input.reset();
  if (audio) safe(audio.suspend);
  paint(0, false);
  clearTimeout(glTimer);
  if (S.glLostAt.length >= 2) { giveUpGL(); return; }
  glTimer = setTimeout(() => { if (S.glLost && S.gfx === '3d') giveUpGL(); }, GL_RESTORE_MS);
}, false);
$c3d.addEventListener('webglcontextrestored', () => {
  // DECISION: the refill + redraw waits one task: this listener is added before three's own restore listener, so
  //   drawing here (seen 13:58) ran on a not-yet-restored renderer and left the 3D blank behind the Pause card.
  clearTimeout(glTimer);
  setTimeout(() => {
    if (S.fatal || S.gfx !== '3d') return;
    S.glLost = false;
    // render3d rebuilds its GPU objects from its own restore handler (onContextLost); refill the current level.
    if (render3d && S.lvl) safe(render3d.loadLevel, S.lvl, save().wear || 'sunny');
    paint(0, true);
  }, 0);
}, false);

/** A clean scene canvas in place of #c: one that ever held a WebGL context can never give a 2D one. */
function freshCanvas() {
  const n = document.createElement('canvas');
  n.id = 'c';
  $c.replaceWith(n);
  $c = n;
  return n;
}
/**
 * Make render2d.js (same API as render3d.js) the active renderer. Resolves false when it is missing or fails.
 * DECISION (Orchestrator 12:0x): the Canvas2D renderer replaces fatal('gl') whenever 3D can't run: render3d.js fails
 *   to load or its initRender throws (boot), or a lost context is lost twice in 30 s or isn't restored within
 *   GL_RESTORE_MS (play); ?gl=0 forces it from boot. The import is guarded (load, not required), so without the
 *   file the game keeps today's "can't draw 3D" card. UI holds a proxy (rproxy), so its worldToScreen/pxPerU
 *   follow the swap.
 */
async function use2d(opts, untouched) {
  const r2d = await load('./render2d.js', false);
  if (!has(r2d, 'initRender')) return false;
  try { await r2d.initRender(untouched ? $c : freshCanvas(), opts || {}); } catch (e) { report(e); return false; }
  render3d = r2d;
  S.gfx = '2d';
  return true;
}
/** Mid-run: the WebGL context is gone for good; carry on in Canvas2D (or show the gl card without it). */
async function giveUpGL() {
  if (S.gfx !== '3d' || S.fatal) return;
  S.gfx = 'swap';
  const prev = render3d;
  if (!(await use2d(M.tier ? { tier: M.tier } : {}, false))) return fatal('gl');
  try { if (prev && typeof prev.dispose === 'function') prev.dispose(); } catch {} // best effort on a dead context
  S.glLost = false; S.glLostAt.length = 0;
  safe(render3d.resize, S.W, S.H, S.L && S.L.play ? S.L.play : { x: 0, y: 0, w: S.W, h: S.H, cx: S.W / 2, cy: S.H / 2 });
  if (S.lvl) safe(render3d.loadLevel, S.lvl, save().wear || 'sunny');
  if (has(render3d, 'title')) safe(render3d.title, S.screen === 'title');
  paint(0, true);
}
// What ui.js gets as `render`: always the active renderer, so a mid-run swap reaches it too.
const rproxy = new Proxy({}, { get: (_, k) => (render3d ? render3d[k] : undefined), has: (_, k) => !!render3d && k in render3d });

// ------------------------------------------------------------------ boot steps 2-5 (§13.6)
const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * DECISION: feast.js is probed once at boot with a silent createFeast call: until Sim's real module lands it throws,
 *   and Feast then stays on its card (title PLAY after L60 falls back to All-done) instead of reporting an error.
 */
function probeFeast() {
  if (!feast || !has(feast, 'createFeast') || !has(feast, 'feastLevel') || !has(feast, 'feastResult')) return false;
  try { return !!feast.createFeast('picnic', 1); } catch { return false; }
}
async function load(path, required) {
  try { return await import(path); } catch (e) {
    report(new Error(`load ${path}: ${(e && e.message) || e}`));
    if (required) throw e;
    return null;
  }
}
async function boot() {
  const fonts = (async () => {
    try { if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load('64px "Lilita One"'), sleep(1500)]); } catch {}
  })();
  // Start every download now; meta first (P.init needs it).
  const pMeta = load('./meta.js', true);
  const pRest = Promise.all([
    load('./logic.js', true), load('./levels.js', true), load('./render3d.js', false), load('./ui.js', true),
    load('./layout.js', true), load('./audio.js', false), load('./modes.js', false), load('./bots.js', false), load('./feast.js', false),
  ]);
  pRest.catch(() => {}); // handled below
  meta = await pMeta;
  // Meta request 10:20: the save version is meta.SAVE_V (2 since Wednesday), so P runs migrate for older saves.
  await P.init({ store: 'sp_', version: num(meta.SAVE_V, 1), defaults: meta.DEFAULT_SAVE, migrate: meta.migrate });
  await meta.initMeta(P);
  [logic, levels, render3d, ui, layout, audio, modes, bots, feast] = await pRest;
  M = (modes && has(modes, 'parseModes') && safe(modes.parseModes, location.search)) || {};
  if (M.record || M.og) stopLoop();
  S.feastOk = probeFeast();
  if (has(meta, 'useLids')) safe(meta.useLids); // §13.3: on boot, spend Streak Lids for missed days
  S.userMuted = !!(has(meta, 'setting') && safe(meta.setting, 'mute')); // undefined until meta has a 'mute' key
  safe(P.best, safe(meta.score) | 0);

  // step 3: renderer + every pool, then the level the player will start on
  S.ready = 'pre';
  S.L = null; fit();
  const ropts = M.tier ? { tier: M.tier } : {};
  if (!GL0 && has(render3d, 'initRender')) {
    try { await render3d.initRender($c, ropts); S.gfx = '3d'; } catch (e) { report(e); }
  }
  if (S.gfx !== '3d' && !(await use2d(ropts, GL0 || !render3d))) return fatal('gl');
  if (S.gfx === '3d' && has(render3d, 'onContextLost')) safe(render3d.onContextLost, lost => { if (lost === false) S.glLost = false; });
  S.ready = 'render';
  fit();
  safe(render3d.resize, S.W, S.H, S.L ? S.L.play : { x: 0, y: 0, w: S.W, h: S.H, cx: S.W / 2, cy: S.H / 2 });
  const cur = Math.max(1, Math.min(C.LEVELS, save().cur || 1));
  S.n = cur; S.kind = 'level';
  try {
    S.lvl = levels.getLevel(cur);
    S.w = logic.createWorld(S.lvl, { mode: 'level', boosters: boostersFor(cur) });
    render3d.loadLevel(S.lvl, save().wear || 'sunny');
  } catch (e) { return fatal('boot', e); }

  // step 4: warm-up raced against 2.5 s (keeps compiling behind the title if it loses)
  await Promise.race([Promise.resolve(has(render3d, 'warmUp') ? render3d.warmUp() : null).catch(report), sleep(2500)]);
  await fonts;

  // step 5: UI + title, audio graph, qa/record hooks, ready
  input = createInput($ui, () => S.L);
  input.enable(false);
  api.input = input;
  try { ui.initUI($ui, { meta, audio, layout, render: rproxy, bus, input, api, P }); } catch (e) { return fatal('boot', e); }
  if (audio) {
    safe(audio.initAudio);
    if (has(audio, 'bindBus')) safe(audio.bindBus, bus);
    safe(audio.setMuted, isMuted());
    // §8.4: the music loop is on (its level is the Settings slider); record mode leaves music out (added in the edit).
    if (has(audio, 'setVolumes')) safe(audio.setVolumes, num(safe(meta.setting, 'music'), 0.7), num(safe(meta.setting, 'sfx'), 0.9));
    if (has(audio, 'music')) safe(audio.music, !M.record && !M.og);
  }
  bus.on('*', (d, ev) => { if (has(render3d, 'onFx')) render3d.onFx(ev, d); }); // the active renderer at emit time
  S.ready = true;
  S.skin = save().wear || 'sunny';
  fit();
  go('title');
  // §9.4 "Saved by a lid!": the first visit after a missed day that used a Streak Lid (never in capture runs).
  if (!M.record && !M.og && has(meta, 'lidCard') && safe(meta.lidCard)) go('lid', dailyStatus());
  paint(0, true);
  if (S.startKey && S.screen === 'title' && !M.record && !M.og && ui && has(ui, 'key')) { S.startKey = false; try { ui.key({ key: 'Enter' }); } catch (e) { report(e); } }
  // DECISION: under ?qa=1 only, the Core api is also window.__spApi so test tools can find live buttons
  //   (ui.primaryButton) and the bot's direction without going through modes.js.
  if (P.qa) try { window.__spApi = api; } catch {}
  if (modes && has(modes, 'install')) { try { modes.install(api); } catch (e) { report(e); } }
  P.ready();
  if (!M.record && !M.og) startLoop();
}
boot().catch(e => fatal('boot', e));
