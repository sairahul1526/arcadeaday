// Slurp Pot: the Canvas2D fallback renderer (GDD P1, §13.7). It has the same exported API as render3d.js, so
// game.js swaps it in (use2d) when WebGL can't start or a lost context doesn't come back. ?gl=0 forces it.
//
// The view is top-down: screen y = world z, so +z (the near side) is the bottom of the screen. Height shows only
// as a screen-up offset (LIFT per unit) for gulls, carried food, particles, lamps and the roost post.
// Each level bakes one bitmap with everything that never moves: backdrop, board, ground pattern, surfaces, belt
// frames, truck path, roost and decor. Each frame draws that bitmap, then splats, belt chevrons, gull telegraphs,
// the pot (a hole in the board), item shadows, halos and bodies, belt hoods, rings and padlocks, the pot's face,
// gulls, particles and the steam wipe. Ingredients and bosses use their art/ crops; everything else is a flat
// toy shape in its kind colour.
// It imports only catalog/logic/consts, never three.js or props.js (props imports the three bundle), so the
// colours below are copies of the props.js / render3d.js values.

import { KINDS, KIND_ID } from './catalog.js';
import { edible, createWorld } from './logic.js';
import { DPR_MIN, DPR_STEP, ITEM_MAX, isMilestone } from './consts.js';
import { dressLayout, RUGS } from './dress.js';
import { camW, camWRec, camTitle, CAM_EDGE, CAM_SLACK, CAM_POT_FLOOR, FIN_BEAT, FIN_BIG, finQ, bossBoost } from './camw.js';

const PI = Math.PI, TAU = 2 * PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ek = (dt, tau) => 1 - Math.exp(-dt / tau);
const lerp = (a, b, t) => a + (b - a) * t;
const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const hsh = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(0x2D0F2D);          // render-only RNG (blinks, fx): never Math.random, never the sim

// ------------------------------------------------------------------ colours (copies of props.js / render3d.js)
const LID = { sunny: '#F5B323', cauldron: '#C8743A', wok: '#D9412F', teapot: '#2FB5A5', ricecooker: '#E6D6BA',
  dutch: '#8FE3C8', steamer: '#D9B36B', royal: '#FFD23F', ufo: '#C9D3E0', starladle: '#2B3A8C' };
const GROUND = { picnic: '#F7E9D4', market: '#B8AB93', harbour: '#AB8E6E' };   // props.js GROUND_BASE says why
const BACK = { picnic: '#A99272', market: '#B39D7B', harbour: '#2AA7C9' };   // table / street / sea = clear colour
const SURF_DEFAULT = {
  picnic: { blanket: '#FFF1DC', path: '#EBD3A0', rug: '#FFF1DC', deck: '#C99A63', water: '#2AA7C9' },
  market: { blanket: '#2FB5A5', path: '#A5957B', rug: '#7A4C9E', deck: '#C99A63', water: '#2AA7C9' },
  harbour: { blanket: '#F6ECD6', path: '#8F7355', rug: '#F6ECD6', deck: '#E8FBFF', water: '#2AA7C9' },
};
const HEM = { picnic: '#2FB5A5', market: '#FF7A59', harbour: '#2AA7C9' };
const HOOD = { picnic: '#F5B323', market: '#2FB5A5', harbour: '#E04F4F' };
const SPLAT = { teacups: '#8A5A2B', jarstack: '#C2185B', eggcrate: '#FFC93C', wafflestack: '#C77A1E', platepile: '#FFF6E3' };
const AWNING = ['#E8574A', '#2FB5A5', '#F5B323', '#7A4C9E', '#FF7A59'];
const EV_ALIAS = { courseDone: 'course', tier: 'cakeTier', gullWarn: 'gull' };
const ALIASED = new Set(Object.values(EV_ALIAS));
const BIG_STEPS = new Set([2, 5, 8, 11]);   // D31
const F_ING = 1, F_FRAGILE = 8, F_GATE = 16, F_BOSS = 32, F_HOT = 512;
const LIFT = 0.5, GULL_Y = 3, MARGIN = 3.5, MAX_PX = 3.2e6, MAX_SIDE = 2048, FXN = 160, SPLAT_MAX = 24;
// flat toy shape per kind without art (default: a disc); box, wall and umbrella turn with the item's rot
const SHAPE = {
  plate: 'ring', lifering: 'ring', ropecoil: 'ring', platepile: 'ring', cup: 'cup',
  tree: 'tree', fence: 'wall', hedge: 'wall', ropepost: 'wall',
  chili: 'chili', parasol: 'umbrella', sunshade: 'umbrella', beachball: 'umbrella', pinwheel: 'umbrella',
  juicebox: 'box', crate: 'box', cooler: 'box', aboard: 'box', scooter: 'box', swingset: 'box', crane: 'box', deckchair: 'box',
  bread: 'loaf', pie: 'pie', wafflestack: 'pie', basket: 'basket', eggcrate: 'eggs', bench: 'bench',
  lamp: 'lamp', anchor: 'anchor', bin: 'drum', barrel: 'drum', flowerpot: 'planter', flowerbucket: 'planter',
  teacups: 'cluster', jarstack: 'cluster', stall: 'roof', kiosk: 'roof', shed: 'roof', gazebo: 'roof',
  car: 'vehicle', van: 'vehicle', rowboat: 'boat',
};
const TURNS = new Set(['box', 'wall', 'loaf', 'basket', 'eggs', 'bench', 'anchor', 'roof', 'vehicle', 'boat']);

const rgbOf = (h) => { const n = parseInt(String(h || '#FFFFFF').slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (r, g, b) => '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
const mix = (a, b, t) => { const p = rgbOf(a), q = rgbOf(b); return hex(lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)); };
const shade = (h, t) => mix(h, t > 0 ? '#FFFFFF' : '#3A2418', Math.abs(t));
const rgba = (h, a) => { const c = rgbOf(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
function lum(h) {
  const c = rgbOf(h).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
function rr(g, x, y, w, h, r) {   // rounded-rect path (no roundRect: older phones lack it)
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function disc(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); }

// ------------------------------------------------------------------ state
let canvas = null, ctx = null, REC = false, dpr = 1, cssW = 1, cssH = 1;
let play = { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.6 };
let time = 0, ppu = 50, ops = 0, fpsEma = 0, lastNow = 0, winStart = 0, alphaNow = 1;
const win = [];
let LV = null, BB = null, town = 'picnic', skin = 'sunny', titleOn = false;
let ground = null;                         // { cv, x0, z0, w, h, upx }: the loaded level's baked bitmap
let potCv = null, shadowCv = null, haloCv = null, rimCv = null, padArt = null;
let lostFn = null, ctxH = null;
let W = null, itemCat = null, itemRot = null, prevSt = null, prevHid = null, prevKind = null;
const popT = new Float32Array(ITEM_MAX), wobT = new Float32Array(ITEM_MAX), rattleT = new Float32Array(ITEM_MAX);
const crackT = new Float32Array(ITEM_MAX), rollA = new Float32Array(ITEM_MAX);
const lastX = new Float32Array(ITEM_MAX), lastZ = new Float32Array(ITEM_MAX);
const XS = new Float32Array(ITEM_MAX), ZS = new Float32Array(ITEM_MAX), YS = new Float32Array(ITEM_MAX), RS = new Float32Array(ITEM_MAX);
const KEY = new Float64Array(ITEM_MAX);
const evSeen = new Set();
const pot = { x: 0, z: 0, r: 0.3, rVis: 0.3 };
const cam = { x: 0, z: 0, vx: 0, vz: 0, rCam: 0.3, ax: 0, ay: 0 };
const view = { x: 0, z: 0 };               // drawn camera centre (after shake / reveal); sits at (cam.ax, cam.ay)
const mood = {};
const lid = { on: false, pop: 0, jig: 0 };
let punchT = 0, bossCamT = -1, shakeX = 0, shakeZ = 0, reveal = null, glance = null, bossRing = null;
let truckSq = 0, truckFlip = false, wipeT = -1, look = null, snapCam = false, freshW = false;
// R7: the last bite's finisher (render3d's timing, FIN_BEAT and FIN_BIG in camw.js) and the warm screen flash. hotT: chili flush.
let fin = null, finHold = false, flashA = 0, hotT = 0;
const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const flash = a => { flashA = Math.max(flashA, calm ? a * 0.35 : a); };
const splats = [];
const TOY = [];                            // flat sprite per kind index, built on first use
const ART = new Map();                     // art name → { ok, img, sx, sy, sw, sh, p }

// particles: one pool, CPU sim (same shapes as render3d: 0 crumb, 1 confetti, 2 sparkle, 3 heart, 4 puff)
const fP = new Float32Array(FXN * 3), fV = new Float32Array(FXN * 3), fLife = new Float32Array(FXN), fL0 = new Float32Array(FXN);
const fSz = new Float32Array(FXN), fGrav = new Float32Array(FXN), fGrow = new Float32Array(FXN), fA = new Float32Array(FXN);
const fShape = new Uint8Array(FXN), fCol = new Array(FXN).fill('#FFFFFF');
let fxHead = 0;

// ------------------------------------------------------------------ API
/** Tier for the perf event: the Canvas2D renderer has no tiers. */
export function detectTier() { return '2d'; }

export async function initRender(cv, opts = {}) {
  // DECISION (11-04): the context is opaque ({alpha: false}) and initRender throws when the canvas gives no 2D
  // context: one that ever held a WebGL context can't, so after a 3D attempt Core passes freshCanvas().
  // DECISION (11-04): a 2D 'contextlost' is not cancelled (unlike WebGL, cancelling it stops the restore); on
  // 'contextrestored' the baked bitmaps are rebuilt. lostFn hears true / false as in render3d.
  if (!cv || typeof cv.getContext !== 'function') throw new Error('render2d: no canvas');
  const c = cv.getContext('2d', { alpha: false });
  if (!c) throw new Error('render2d: no 2d context');
  if (canvas) dispose();
  canvas = cv; ctx = c;
  const q = typeof location !== 'undefined' ? location.search : '';
  REC = !!opts.record || /[?&](?:record|og)=1\b|[?&]cover=(?:wide|tall|square)\b/.test(q);
  cssW = Math.max(1, cv.clientWidth || (typeof innerWidth !== 'undefined' ? innerWidth : 1));
  cssH = Math.max(1, cv.clientHeight || (typeof innerHeight !== 'undefined' ? innerHeight : 1));
  play = { x: 0, y: 0, w: cssW, h: cssH, cx: cssW / 2, cy: cssH * 0.6 };
  cam.ax = play.cx; cam.ay = play.cy;
  dpr = REC ? 1 : dprCap();
  applySize();
  makeSprites();
  padArt = art('icon-padlock');
  ctxH = {
    lost: () => { if (lostFn) lostFn(true); },
    restored: () => { makeSprites(); if (LV) buildGround(LV); if (lostFn) lostFn(false); },
  };
  cv.addEventListener('contextlost', ctxH.lost, false);
  cv.addEventListener('contextrestored', ctxH.restored, false);
  resetMood();
  time = 0; fpsEma = 0; lastNow = 0; win.length = 0;
  return { tier: '2d' };
}

/** Waits for the loaded level's art (≤ 1.2 s); there is nothing to compile. */
export async function warmUp() {
  const ps = [];
  for (const e of ART.values()) if (!e.ok && e.p) ps.push(e.p);
  if (ps.length) await Promise.race([Promise.all(ps), new Promise((r) => setTimeout(r, 1200))]);
}

export function loadLevel(L, skinId) {
  // DECISION (11-04): never throws; the camera snaps to the first world's pot after a load, so a mid-level swap
  // from WebGL (giveUpGL) lands on the pot instead of gliding over from the spawn.
  if (!L || !ctx) return;
  LV = L;
  town = GROUND[L.town] ? L.town : 'picnic';
  const hw = (+L.W || 16) / 2, hd = (+L.D || 26) / 2;
  BB = { x0: isFinite(L.x0) ? +L.x0 : -hw, x1: isFinite(L.x1) ? +L.x1 : hw, z0: isFinite(L.z0) ? +L.z0 : -hd, z1: isFinite(L.z1) ? +L.z1 : hd };
  setSkin(skinId || skin);
  const sp = L.spawn || { x: 0, z: 0 }, r0 = +L.r0 || 0.3;
  pot.x = +sp.x || 0; pot.z = +sp.z || 0; pot.r = pot.rVis = r0; cam.rCam = r0;
  cam.x = view.x = pot.x; cam.z = view.z = pot.z; cam.vx = cam.vz = 0; cam.ax = play.cx; cam.ay = play.cy;
  W = null; look = null; splats.length = 0; snapCam = freshW = true;
  lid.on = false; lid.pop = lid.jig = 0;
  reveal = glance = bossRing = null; punchT = 0; bossCamT = -1; shakeX = shakeZ = 0; wipeT = -1; truckSq = 0; fin = null; finHold = false; flashA = 0;
  try { buildGround(L); } catch { ground = null; }   // a bad surface never takes the level down: the clear colour shows
  for (const it of L.items || []) preloadKind(KIND_ID[it.kind]);
}

export function setSkin(id) {
  skin = LID[id] ? id : 'sunny';
  if (ctx) potCv = makePot(LID[skin]);
}

export function resize(w, h, playRect) {
  cssW = Math.max(1, w | 0 || 1); cssH = Math.max(1, h | 0 || 1);
  if (playRect) play = { ...playRect };
  if (!(play.cx >= 0)) play.cx = cssW / 2;
  if (!(play.cy >= 0)) play.cy = cssH * 0.6;
  dpr = REC ? 1 : clamp(dpr, DPR_MIN, dprCap());
  applySize();
}
/** No tiers in 2D: the resolution adapts on its own (draw). */
export function setTier() {}
export function stats() { return { drawCalls: ops, tris: 0, fps: Math.round(fpsEma * 10) / 10, dpr, tier: '2d' }; }
export function pxPerU() { return ppu; }
export function worldToScreen(x, z) {
  const sx = cam.ax + (x - view.x) * ppu, sy = cam.ay + (z - view.z) * ppu;
  return { x: sx, y: sy, on: !!ctx && sx >= 0 && sx <= cssW && sy >= 0 && sy <= cssH };
}
export function onContextLost(fn) { lostFn = typeof fn === 'function' ? fn : null; }
export function title(on) { titleOn = !!on; }
export function steamWipe() { wipeT = 0; }

export function dispose() {
  if (canvas && ctxH) {
    canvas.removeEventListener('contextlost', ctxH.lost, false);
    canvas.removeEventListener('contextrestored', ctxH.restored, false);
  }
  canvas = ctx = null; ctxH = null; ground = null; potCv = shadowCv = haloCv = rimCv = null; TOY.length = 0;
  W = null; LV = null; BB = null; look = null; splats.length = 0; wipeT = -1; lid.on = false; fLife.fill(0);
}

function dprCap() {
  // DECISION (11-04): ≤ 1.5 and ≤ 1.6 MP of canvas pixels (390×844 → 1.5; 1440×900 → 1.11), never below DPR_MIN.
  const dev = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.max(DPR_MIN, Math.min(1.5, dev, Math.sqrt(1.6e6 / Math.max(1, cssW * cssH))));
}
function applySize() {
  if (!canvas) return;
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

// ------------------------------------------------------------------ art and sprites
function art(name) {
  let e = ART.get(name);
  if (e) return e;
  e = { ok: false, img: null, sx: 0, sy: 0, sw: 1, sh: 1, p: null };
  ART.set(name, e);
  if (typeof Image === 'undefined') return e;
  const img = new Image();
  e.p = new Promise((res) => {
    img.onload = () => { e.img = img; measure(e); e.ok = true; res(); };
    img.onerror = () => res();
  });
  img.src = new URL('./art/' + name + '.webp', import.meta.url).href;
  return e;
}
function measure(e) {
  // the art has transparent padding (ingredient content fills ~54–71 %): crop to the opaque box, measured once
  const img = e.img, w0 = img.naturalWidth || img.width || 1, h0 = img.naturalHeight || img.height || 1;
  e.sx = 0; e.sy = 0; e.sw = w0; e.sh = h0;
  try {
    const S = 64, c = mk(S, S), g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    let x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (d[(y * S + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 >= x0) { const kx = w0 / S, ky = h0 / S; e.sx = x0 * kx; e.sy = y0 * ky; e.sw = (x1 - x0 + 1) * kx; e.sh = (y1 - y0 + 1) * ky; }
  } catch { /* keep the whole image */ }
}
function preloadKind(c) { const K = c >= 0 ? KINDS[c] : null; if (K && K.icon) art(K.icon); }

function makeSprites() {
  TOY.length = 0;
  shadowCv = mk(64, 64);
  let g = shadowCv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(40,22,10,0.56)'); gr.addColorStop(0.66, 'rgba(40,22,10,0.48)'); gr.addColorStop(0.86, 'rgba(40,22,10,0.16)'); gr.addColorStop(1, 'rgba(40,22,10,0)');   // R4: a tight core under the foot
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  haloCv = mk(64, 64);
  g = haloCv.getContext('2d'); gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,226,110,0.7)'); gr.addColorStop(0.55, 'rgba(255,205,60,0.3)'); gr.addColorStop(1, 'rgba(255,205,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  // R5: the same gold ring with an ink edge as render3d, so it reads on tan cobbles and planks
  g.lineWidth = 7; g.strokeStyle = 'rgba(58,36,24,0.5)'; g.beginPath(); g.arc(32, 32, 24, 0, TAU); g.stroke();
  g.lineWidth = 4.5; g.strokeStyle = '#FFD34D'; g.beginPath(); g.arc(32, 32, 24, 0, TAU); g.stroke();
  // R9: the warm glow round the rim (the sprite is drawn at 1.7 r, the rim's outer edge is 1.15 r)
  rimCv = mk(64, 64);
  g = rimCv.getContext('2d'); gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,204,97,0.7)'); gr.addColorStop(0.66, 'rgba(255,204,97,0.62)'); gr.addColorStop(1, 'rgba(255,204,97,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  potCv = makePot(LID[skin]);
}

function makePot(col) {
  // DECISION (11-04): the pot is a hole in the board seen from above: a rim ring in the skin's lid colour (outer
  // radius 1.15 r), a dark lip, then the stew (0.9 r) — one 256 px sprite per skin, scaled each frame.
  const S = 256, C = S / 2, u = C / 1.25, c = mk(S, S), g = c.getContext('2d');
  let gr = g.createRadialGradient(C, C, u * 1.05, C, C, u * 1.25);
  gr.addColorStop(0, 'rgba(40,22,10,0.35)'); gr.addColorStop(1, 'rgba(40,22,10,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  gr = g.createRadialGradient(C - 0.35 * u, C - 0.45 * u, 0.1 * u, C, C, 1.15 * u);
  gr.addColorStop(0, shade(col, 0.4)); gr.addColorStop(0.55, col); gr.addColorStop(1, shade(col, -0.3));
  g.fillStyle = gr; disc(g, C, C, 1.15 * u); g.fill();
  g.lineWidth = 3; g.strokeStyle = shade(col, -0.5); disc(g, C, C, 1.15 * u - 1.5); g.stroke();
  g.fillStyle = shade(col, -0.4); disc(g, C, C, 1.02 * u); g.fill();
  g.fillStyle = '#2A1A12'; disc(g, C, C, u); g.fill();
  gr = g.createRadialGradient(C - 0.2 * u, C - 0.25 * u, 0.05 * u, C, C, 0.9 * u);
  gr.addColorStop(0, '#FFC864'); gr.addColorStop(0.6, '#F38C2C'); gr.addColorStop(1, '#C9561C');
  g.fillStyle = gr; disc(g, C, C, 0.9 * u); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.06 * u; g.lineCap = 'round';
  g.beginPath(); g.arc(C, C, 1.085 * u, PI * 1.08, PI * 1.45); g.stroke();
  return c;
}

function toy(c) {
  // DECISION (11-04): kinds without art are flat top-down toy shapes in the kind colour (disc, ring, box, wall,
  // bench, roof, vehicle, boat, lamp, …) with a dark rim and a highlight, so they read at 6 px. The content radius
  // is 0.46 of the sprite; long shapes (wall, bench, vehicle, boat) span the full width and turn with the item.
  if (TOY[c]) return TOY[c];
  const K = KINDS[c], shape = SHAPE[K.id] || 'disc', S = K.a >= 0.3 ? 128 : 64;
  const cv = mk(S, S), g = cv.getContext('2d'), C = S / 2, r = S * 0.46, col = K.color || '#CCCCCC', dark = shade(col, -0.4);
  const LW = Math.max(1.5, S * 0.045);
  g.lineWidth = LW; g.strokeStyle = dark; g.lineJoin = 'round'; g.lineCap = 'round';
  const hi = (x, y, rx, ry) => { g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(x, y, rx, ry, -0.5, 0, TAU); g.fill(); };
  const body = (x, y, w, h, rad, fill) => { rr(g, x, y, w, h, rad); g.fillStyle = fill || col; g.fill(); g.stroke(); };
  const lines = (pts, style, lw) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); for (const [a, b, p, q] of pts) { g.moveTo(a, b); g.lineTo(p, q); } g.stroke(); };
  switch (shape) {
    case 'chili': {   // R7: a fat comma of glossy red, tip up to the right, green cap low left. The flame is drawn live in drawBody.
      g.strokeStyle = '#7A120C'; g.lineWidth = 0.62 * r; g.beginPath(); g.moveTo(C - 0.55 * r, C + 0.42 * r); g.quadraticCurveTo(C + 0.35 * r, C + 0.5 * r, C + 0.5 * r, C - 0.3 * r); g.stroke();
      g.strokeStyle = '#E0261C'; g.lineWidth = 0.46 * r; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.09 * r; g.beginPath(); g.moveTo(C - 0.25 * r, C + 0.3 * r); g.quadraticCurveTo(C + 0.15 * r, C + 0.3 * r, C + 0.28 * r, C - 0.05 * r); g.stroke();
      g.fillStyle = '#3F8A3A'; g.strokeStyle = '#1F4E1E'; g.lineWidth = LW * 0.7; disc(g, C - 0.68 * r, C + 0.42 * r, 0.24 * r); g.fill(); g.stroke();
      g.strokeStyle = '#3F8A3A'; g.lineWidth = 0.14 * r; g.beginPath(); g.moveTo(C - 0.74 * r, C + 0.4 * r); g.lineTo(C - 0.95 * r, C + 0.15 * r); g.stroke();
      break;
    }
    case 'box':
      body(C - 0.86 * r, C - 0.86 * r, 1.72 * r, 1.72 * r, 0.25 * r);
      g.fillStyle = 'rgba(255,255,255,0.25)'; rr(g, C - 0.7 * r, C - 0.7 * r, 1.4 * r, 0.5 * r, 0.15 * r); g.fill();
      if (K.id === 'juicebox') { g.fillStyle = '#FFFFFF'; disc(g, C + 0.45 * r, C - 0.45 * r, 0.16 * r); g.fill(); }
      if (K.id === 'aboard') lines([[C - 0.5 * r, C - 0.1 * r, C + 0.5 * r, C - 0.1 * r], [C - 0.5 * r, C + 0.25 * r, C + 0.3 * r, C + 0.25 * r]], '#FFFFFF', 0.1 * r);
      break;
    case 'wall':
      body(C - r, C - 0.42 * r, 2 * r, 0.84 * r, 0.3 * r);
      lines([-2, -1, 0, 1, 2].map((k) => [C + k * 0.36 * r, C - 0.3 * r, C + k * 0.36 * r, C + 0.3 * r]), shade(col, -0.2), LW);
      break;
    case 'bench':
      body(C - r, C - 0.36 * r, 2 * r, 0.72 * r, 0.12 * r);
      lines([-0.12, 0.12].map((k) => [C - 0.92 * r, C + k * r, C + 0.92 * r, C + k * r]), shade(col, -0.3), LW);
      break;
    case 'loaf':
      body(C - 0.95 * r, C - 0.55 * r, 1.9 * r, 1.1 * r, 0.5 * r);
      lines([-0.4, 0, 0.4].map((k) => [C + (k - 0.12) * r, C - 0.3 * r, C + (k + 0.12) * r, C + 0.3 * r]), shade(col, 0.35), 0.12 * r);
      break;
    case 'basket':
      body(C - 0.9 * r, C - 0.7 * r, 1.8 * r, 1.4 * r, 0.3 * r);
      lines([-0.45, 0, 0.45].flatMap((k) => [[C + k * r, C - 0.6 * r, C + k * r, C + 0.6 * r], [C - 0.8 * r, C + k * 1.1 * r, C + 0.8 * r, C + k * 1.1 * r]]), shade(col, -0.2), LW * 0.8);
      g.strokeStyle = dark; g.lineWidth = 0.14 * r; g.beginPath(); g.moveTo(C - 0.75 * r, C); g.quadraticCurveTo(C, C - 0.25 * r, C + 0.75 * r, C); g.stroke();
      break;
    case 'eggs':
      body(C - 0.9 * r, C - 0.65 * r, 1.8 * r, 1.3 * r, 0.15 * r);
      g.fillStyle = '#FFF6E3'; g.strokeStyle = shade('#FFF6E3', -0.3); g.lineWidth = LW * 0.6;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) { disc(g, C + (a - 1) * 0.56 * r, C + (b - 0.5) * 0.6 * r, 0.24 * r); g.fill(); g.stroke(); }
      break;
    case 'roof':   // hip roof seen from above: four faces meeting at a ridge
      body(C - 0.92 * r, C - 0.92 * r, 1.84 * r, 1.84 * r, 0.12 * r);
      g.fillStyle = shade(col, 0.2); g.beginPath(); g.moveTo(C - 0.92 * r, C - 0.92 * r); g.lineTo(C + 0.92 * r, C - 0.92 * r); g.lineTo(C + 0.35 * r, C); g.lineTo(C - 0.35 * r, C); g.closePath(); g.fill();
      g.fillStyle = shade(col, -0.15); g.beginPath(); g.moveTo(C - 0.92 * r, C + 0.92 * r); g.lineTo(C + 0.92 * r, C + 0.92 * r); g.lineTo(C + 0.35 * r, C); g.lineTo(C - 0.35 * r, C); g.closePath(); g.fill();
      lines([[C - 0.92 * r, C - 0.92 * r, C - 0.35 * r, C], [C + 0.92 * r, C - 0.92 * r, C + 0.35 * r, C], [C - 0.92 * r, C + 0.92 * r, C - 0.35 * r, C], [C + 0.92 * r, C + 0.92 * r, C + 0.35 * r, C], [C - 0.35 * r, C, C + 0.35 * r, C]], dark, LW * 0.8);
      rr(g, C - 0.92 * r, C - 0.92 * r, 1.84 * r, 1.84 * r, 0.12 * r); g.stroke();
      break;
    case 'vehicle':
      body(C - r, C - 0.5 * r, 2 * r, r, 0.3 * r);
      g.fillStyle = 'rgba(40,50,70,0.75)'; rr(g, C + 0.25 * r, C - 0.36 * r, 0.32 * r, 0.72 * r, 0.1 * r); g.fill(); rr(g, C - 0.75 * r, C - 0.34 * r, 0.22 * r, 0.68 * r, 0.08 * r); g.fill();
      g.fillStyle = shade(col, 0.25); rr(g, C - 0.45 * r, C - 0.34 * r, 0.62 * r, 0.68 * r, 0.1 * r); g.fill();
      break;
    case 'boat':
      g.beginPath(); g.moveTo(C - 0.95 * r, C - 0.35 * r); g.lineTo(C + 0.45 * r, C - 0.42 * r); g.quadraticCurveTo(C + r, C - 0.3 * r, C + r, C);
      g.quadraticCurveTo(C + r, C + 0.3 * r, C + 0.45 * r, C + 0.42 * r); g.lineTo(C - 0.95 * r, C + 0.35 * r); g.closePath();
      g.fillStyle = col; g.fill(); g.stroke();
      g.fillStyle = '#E9D8BC'; g.beginPath(); g.moveTo(C - 0.8 * r, C - 0.22 * r); g.lineTo(C + 0.42 * r, C - 0.28 * r); g.quadraticCurveTo(C + 0.8 * r, C, C + 0.42 * r, C + 0.28 * r); g.lineTo(C - 0.8 * r, C + 0.22 * r); g.closePath(); g.fill();
      lines([-0.4, 0.15].map((k) => [C + k * r, C - 0.26 * r, C + k * r, C + 0.26 * r]), '#9A6A45', 0.12 * r);
      break;
    case 'lamp':   // a street lamp from above: a warm glow around the pale globe (no dark ring: that read as an eye)
      g.fillStyle = 'rgba(255,214,110,0.35)'; disc(g, C, C, r); g.fill();
      g.fillStyle = '#FFE9A8'; g.strokeStyle = col; g.lineWidth = LW * 0.8; disc(g, C, C, 0.5 * r); g.fill(); g.stroke();
      g.fillStyle = '#FFF8DC'; disc(g, C - 0.12 * r, C - 0.14 * r, 0.2 * r); g.fill();
      break;
    case 'anchor':
      g.strokeStyle = col; g.lineWidth = 0.2 * r;
      g.beginPath(); g.moveTo(C, C - 0.6 * r); g.lineTo(C, C + 0.75 * r); g.moveTo(C - 0.45 * r, C - 0.3 * r); g.lineTo(C + 0.45 * r, C - 0.3 * r);
      g.moveTo(C - 0.75 * r, C + 0.25 * r); g.quadraticCurveTo(C - 0.6 * r, C + 0.8 * r, C, C + 0.8 * r); g.quadraticCurveTo(C + 0.6 * r, C + 0.8 * r, C + 0.75 * r, C + 0.25 * r); g.stroke();
      g.lineWidth = 0.14 * r; disc(g, C, C - 0.75 * r, 0.18 * r); g.stroke();
      break;
    case 'drum':
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      g.strokeStyle = shade(col, -0.25); disc(g, C, C, 0.72 * r); g.stroke();
      g.fillStyle = shade(col, 0.15); disc(g, C, C, 0.6 * r); g.fill();
      hi(C - 0.25 * r, C - 0.3 * r, 0.25 * r, 0.14 * r);
      break;
    case 'planter':
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      g.fillStyle = '#6B4A2E'; disc(g, C, C, 0.72 * r); g.fill();
      for (let k = 0; k < 5; k++) {
        const a = k * TAU / 5 + 0.4, x = C + Math.cos(a) * 0.38 * r, y = C + Math.sin(a) * 0.38 * r;
        g.fillStyle = '#4CC26A'; disc(g, x, y, 0.24 * r); g.fill();
        g.fillStyle = k % 2 ? '#FFD23F' : '#FF7FB0'; disc(g, x, y, 0.12 * r); g.fill();
      }
      break;
    case 'cluster': {   // teacups / jars: three small rounds on a tray
      const top = K.id === 'jarstack' ? col : '#FFFFFF', inner = K.id === 'jarstack' ? shade(col, 0.3) : '#8A5A2B';
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 - PI / 2, x = C + Math.cos(a) * 0.48 * r, y = C + Math.sin(a) * 0.48 * r;
        g.fillStyle = top; g.strokeStyle = shade(col, -0.45); disc(g, x, y, 0.42 * r); g.fill(); g.stroke();
        g.fillStyle = inner; disc(g, x, y, 0.26 * r); g.fill();
      }
      break;
    }
    case 'pie':
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      g.save(); disc(g, C, C, 0.78 * r); g.clip();
      lines([-0.5, 0, 0.5].flatMap((k) => [[C + k * r, C - r, C + k * r, C + r], [C - r, C + k * r, C + r, C + k * r]]), shade(col, K.id === 'pie' ? 0.3 : -0.25), 0.16 * r);
      g.restore();
      break;
    case 'cup':
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      g.fillStyle = '#FF9EC4'; disc(g, C, C, 0.65 * r); g.fill();
      break;
    case 'umbrella':
      disc(g, C, C, r); g.fillStyle = col; g.fill();
      g.fillStyle = '#FFFFFF';
      for (let k = 0; k < 6; k += 2) { g.beginPath(); g.moveTo(C, C); g.arc(C, C, r, k * TAU / 6, (k + 1) * TAU / 6); g.closePath(); g.fill(); }
      disc(g, C, C, r); g.stroke();
      g.fillStyle = dark; disc(g, C, C, 0.12 * r); g.fill();
      break;
    case 'tree':
      g.fillStyle = col;
      for (const [dx, dy, s] of [[-0.35, 0.2, 0.62], [0.35, 0.2, 0.62], [0, -0.3, 0.66]]) { disc(g, C + dx * r, C + dy * r, s * r); g.fill(); g.stroke(); }
      g.fillStyle = shade(col, 0.25); disc(g, C - 0.1 * r, C - 0.35 * r, 0.3 * r); g.fill();
      break;
    case 'ring':
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      if (K.id === 'lifering') {
        g.strokeStyle = '#FFFFFF'; g.lineWidth = 0.32 * r;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(C, C, 0.72 * r, k * PI / 2, k * PI / 2 + 0.5); g.stroke(); }
        g.fillStyle = shade(col, 0.6);
      } else g.fillStyle = shade(col, -0.08);
      disc(g, C, C, 0.52 * r); g.fill(); g.strokeStyle = dark; g.lineWidth = Math.max(1.5, S * 0.03); g.stroke();
      break;
    default:
      disc(g, C, C, r); g.fillStyle = col; g.fill(); g.stroke();
      hi(C - 0.3 * r, C - 0.35 * r, 0.36 * r, 0.22 * r);
  }
  return (TOY[c] = cv);
}

// ------------------------------------------------------------------ the baked level bitmap
function buildGround(L) {
  // DECISION (11-04): everything static is baked once per level into one bitmap: board + 3.5 u, ≤ 3.2 MP and
  // ≤ 2048 px a side (6–48 px/u); a big canvas (> 1.2 MP, desktop) allows 6.4 MP / 4096 px so it stays sharper. Outside it the clear colour is the backdrop base, and the backdrop fades into
  // it over the last 2 u, so a wide late-game view never shows an edge.
  if (!BB || typeof document === 'undefined') { ground = null; return; }
  const x0 = BB.x0 - MARGIN, x1 = BB.x1 + MARGIN, z0 = BB.z0 - MARGIN, z1 = BB.z1 + MARGIN, sw = x1 - x0, sh = z1 - z0;
  const big = cssW * cssH * dpr * dpr > 1.2e6, mp = big ? 2 * MAX_PX : MAX_PX, side = big ? 2 * MAX_SIDE : MAX_SIDE;
  const upx = clamp(Math.min(Math.floor(Math.sqrt(mp / (sw * sh))), Math.floor(side / Math.max(sw, sh))), 6, 48);
  const cv = mk(Math.ceil(sw * upx), Math.ceil(sh * upx)), g = cv.getContext('2d');
  g.setTransform(upx, 0, 0, upx, -x0 * upx, -z0 * upx);
  g.lineCap = 'round'; g.lineJoin = 'round';
  backdrop(g, x0, x1, z0, z1);
  board(g);
  for (const s of L.surfaces || []) {
    g.save(); g.translate(+s.x || 0, +s.z || 0); g.rotate(-(+s.rot || 0));
    surface(g, s.type, Math.max(0.1, +s.w || 1), Math.max(0.1, +s.d || 1), s.color);
    g.restore();
  }
  for (const d of dressLayout(L, town, false)) dressPiece(g, d);
  truckPath(g, L.truckPath);
  for (const b of L.belts || []) beltFrame(g, b);
  if (L.roost) roost(g, +L.roost.x || 0, +L.roost.z || 0);
  for (const d of L.decor || []) decor(g, d);
  fadeEdges(g, x0, x1, z0, z1);
  ground = { cv, x0, z0, w: sw, h: sh, upx };
}

function backdrop(g, x0, x1, z0, z1) {
  g.fillStyle = BACK[town]; g.fillRect(x0, z0, x1 - x0, z1 - z0);
  if (town === 'picnic') {   // the picnic table: planks along x, 1.1 u wide, staggered ends
    const P = 1.1, k0 = Math.floor(z0 / P), k1 = Math.ceil(z1 / P);
    g.fillStyle = '#9F8868'; g.beginPath();
    for (let k = k0; k < k1; k++) if (((k % 2) + 2) % 2) g.rect(x0, k * P, x1 - x0, P);
    g.fill();
    g.strokeStyle = '#8F7A5E'; g.lineWidth = 0.06; g.beginPath();
    for (let k = k0; k < k1; k++) {
      const z = k * P; g.moveTo(x0, z); g.lineTo(x1, z);
      for (let x = x0 - 3.3 + hsh(k) * 3.3; x < x1; x += 3.3) { g.moveTo(x, z); g.lineTo(x, z + P); }
    }
    g.stroke();
  } else if (town === 'market') {   // the street: stone joints, shops along the far side and the flanks
    const P = 0.55, k0 = Math.floor(z0 / P), k1 = Math.ceil(z1 / P);
    g.strokeStyle = '#9C8664'; g.lineWidth = 0.05; g.beginPath();
    for (let k = k0; k < k1; k++) {
      const z = k * P; g.moveTo(x0, z); g.lineTo(x1, z);
      for (let x = x0 + (k % 2 ? 0.4 : 0); x < x1; x += 0.8) { g.moveTo(x, z); g.lineTo(x, z + P); }
    }
    g.stroke();
    let n = 0;
    for (let x = BB.x0 + 1.6; x < BB.x1 - 1; x += 3.3) shop(g, x, BB.z0 - 1.45, 0, AWNING[n++ % AWNING.length]);
    for (let z = BB.z0 + 1.6; z < BB.z1 - 3; z += 3.3) {
      shop(g, BB.x0 - 1.45, z, -PI / 2, AWNING[n++ % AWNING.length]);
      shop(g, BB.x1 + 1.45, z, PI / 2, AWNING[n++ % AWNING.length]);
    }
  } else {   // the sea: short wave strokes
    g.strokeStyle = '#57C3DE'; g.lineWidth = 0.09; g.beginPath();
    let k = 0;
    for (let z = z0; z < z1; z += 1.3) for (let x = x0; x < x1; x += 1.7, k++) {
      const cx = x + hsh(k) * 1.2, cz = z + hsh(k + 99) * 0.9;
      g.moveTo(cx - 0.3, cz); g.quadraticCurveTo(cx, cz - 0.18, cx + 0.3, cz);
    }
    g.stroke();
  }
}
function shop(g, x, z, ang, col) {   // a market shop front, facing the board (local +y)
  g.save(); g.translate(x, z); g.rotate(ang);
  g.fillStyle = '#E9D8BC'; g.fillRect(-1.5, -1.65, 3, 1.3);
  g.fillStyle = '#7A6A58'; g.fillRect(-1.1, -1.45, 2.2, 0.65);
  const n = 6, sw = 3.1 / n;
  for (let k = 0; k < n; k++) {
    g.fillStyle = k % 2 ? '#FFF6E3' : col; g.fillRect(-1.55 + k * sw, -0.4, sw, 0.7);
    disc(g, -1.55 + (k + 0.5) * sw, 0.3, sw / 2); g.fill();
  }
  g.restore();
}

function board(g) {
  const { x0, x1, z0, z1 } = BB, bw = x1 - x0, bd = z1 - z0;
  if (town === 'harbour') {   // foam around the dock, pilings at its edge
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.35;
    rr(g, x0 - 0.6, z0 - 0.6, bw + 1.2, bd + 1.2, 0.7); g.stroke();
  }
  g.fillStyle = 'rgba(40,22,10,0.28)'; rr(g, x0 - 0.1, z0 + 0.05, bw + 0.7, bd + 0.7, 0.5); g.fill();
  g.fillStyle = '#7E5636'; rr(g, x0 - 0.35, z0 - 0.35, bw + 0.7, bd + 0.7, 0.45); g.fill();
  g.fillStyle = '#9A6A45'; rr(g, x0 - 0.18, z0 - 0.18, bw + 0.36, bd + 0.36, 0.3); g.fill();
  if (town === 'harbour') {
    g.fillStyle = '#7A5230'; g.beginPath();
    for (let x = x0; x <= x1 + 1e-6; x += bw / Math.max(1, Math.round(bw / 2.4))) for (const z of [z0 - 0.45, z1 + 0.45]) { g.moveTo(x + 0.2, z); g.arc(x, z, 0.2, 0, TAU); }
    for (let z = z0; z <= z1 + 1e-6; z += bd / Math.max(1, Math.round(bd / 2.4))) for (const x of [x0 - 0.45, x1 + 0.45]) { g.moveTo(x + 0.2, z); g.arc(x, z, 0.2, 0, TAU); }
    g.fill();
  }
  g.fillStyle = GROUND[town]; g.fillRect(x0, z0, bw, bd);
  g.save(); g.beginPath(); g.rect(x0, z0, bw, bd); g.clip();
  if (town === 'picnic') {   // gingham: period 0.5 u, stripes 0.25 u (cream / stripe / cross = 1/4 · 1/2 · 1/4)
    const P = 0.5, s = 0.25;
    g.fillStyle = '#E4AC9D'; g.beginPath();
    for (let x = x0; x < x1; x += P) g.rect(x, z0, s, bd);
    for (let z = z0; z < z1; z += P) g.rect(x0, z, bw, s);
    g.fill();
    g.fillStyle = '#C9685A'; g.beginPath();
    for (let x = x0; x < x1; x += P) for (let z = z0; z < z1; z += P) g.rect(x, z, s, s);
    g.fill();
  } else if (town === 'market') {   // square tiles with joints and a few lighter stones
    g.fillStyle = shade(GROUND.market, 0.08); g.beginPath();
    let k = 0;
    for (let z = z0; z < z1; z += 0.5) for (let x = x0 + (Math.round((z - z0) / 0.5) % 2 ? 0.3 : 0); x < x1; x += 0.6, k++) if (hsh(k) < 0.12) g.rect(x + 0.03, z + 0.03, 0.54, 0.44);
    g.fill();
    g.strokeStyle = '#A5957B'; g.lineWidth = 0.05; g.beginPath();
    for (let z = z0, r = 0; z < z1; z += 0.5, r++) {
      g.moveTo(x0, z); g.lineTo(x1, z);
      for (let x = x0 + (r % 2 ? 0.3 : 0); x < x1; x += 0.6) { g.moveTo(x, z); g.lineTo(x, z + 0.5); }
    }
    g.stroke();
  } else {   // dock planks along x: rows 0.5 u, staggered ends every 4.68 u (2 × props' 2.34 u plank)
    g.fillStyle = shade(GROUND.harbour, 0.05); g.beginPath();
    for (let z = z0, r = 0; z < z1; z += 0.5, r++) if (r % 2) g.rect(x0, z, bw, 0.5);
    g.fill();
    g.strokeStyle = 'rgba(122,82,48,0.45)'; g.lineWidth = 0.04; g.beginPath();
    for (let z = z0, r = 0; z < z1; z += 0.5, r++) {
      g.moveTo(x0, z); g.lineTo(x1, z);
      for (let x = x0 + hsh(r + 7) * 4.68; x < x1; x += 4.68) { g.moveTo(x, z); g.lineTo(x, z + 0.5); }
    }
    g.stroke();
  }
  g.restore();
}

function surface(g, type, w, d, color) {
  // DECISION (11-04): same rules as props.surfaceGeometry, flat: path = pill + pebbles, water = pool + white frame,
  // deck = planks across d, blanket / rug = body + hem (light cloth → town accent, dark → cream) + inner line,
  // blanket tassels on the short ends.
  const col = color || (SURF_DEFAULT[town] || SURF_DEFAULT.picnic)[type] || '#FFF1DC';
  if (type === 'path') {
    // R6: a square path is a disc (stepping stone or boss pad): a pale stone with a kerb, like props.js, never a stain
    const stone = Math.abs(w - d) < 0.01, rad = Math.min(w, d) / 2;
    rr(g, -w / 2, -d / 2, w, d, rad); g.fillStyle = stone ? mix(col, '#FFF1DC', 0.3) : col; g.fill();
    if (stone) { rr(g, -w / 2 + 0.1, -d / 2 + 0.1, w - 0.2, d - 0.2, rad - 0.1); g.fillStyle = mix(col, '#FFF1DC', 0.74); g.fill(); }
    const n = Math.max(2, Math.round((w * d) / 0.9));
    for (let i = 0; i < n; i++) {
      g.fillStyle = stone ? mix(col, '#FFF1DC', i % 2 ? 0.86 : 0.5) : shade(col, i % 2 ? 0.18 : -0.1);
      g.beginPath(); g.ellipse((hsh(i * 3 + 1) - 0.5) * (w - 0.3), (hsh(i * 3 + 2) - 0.5) * (d - 0.3), 0.065 + 0.065 * hsh(i * 3 + 3), 0.05 + 0.05 * hsh(i * 3 + 3), 0, 0, TAU); g.fill();
    }
  } else if (type === 'water') {
    rr(g, -w / 2, -d / 2, w, d, Math.min(0.4, Math.min(w, d) / 3)); g.fillStyle = col; g.fill();
    g.strokeStyle = '#E8FBFF'; g.lineWidth = 0.07; rr(g, -w / 2 + 0.095, -d / 2 + 0.095, w - 0.19, d - 0.19, 0.3); g.stroke();
  } else if (type === 'deck') {
    const n = Math.max(1, Math.round(d / 0.28)), base = lum(col) > 0.75 ? shade(col, -0.15) : col;   // R4, as props.js
    for (let i = 0; i < n; i++) { g.fillStyle = shade(base, i % 2 ? -0.08 : 0); rr(g, -w / 2, -d / 2 + i * d / n + 0.01, w, d / n - 0.02, 0.012); g.fill(); }
  } else {
    const hem = lum(col) > 0.6 ? HEM[town] || HEM.picnic : '#FFF1DC';
    rr(g, -w / 2, -d / 2, w, d, 0.1); g.fillStyle = col; g.fill();
    g.strokeStyle = hem; g.lineWidth = 0.09; rr(g, -w / 2 + 0.045, -d / 2 + 0.045, w - 0.09, d - 0.09, 0.08); g.stroke();
    g.strokeStyle = shade(col, -0.12); g.lineWidth = 0.03; rr(g, -w / 2 + 0.215, -d / 2 + 0.215, w - 0.43, d - 0.43, 0.05); g.stroke();
    if (type === 'blanket') {
      const long = w >= d, L = long ? d : w, n = Math.max(3, Math.round(L / 0.25));
      g.fillStyle = hem;
      for (let i = 0; i < n; i++) {
        const o = -L / 2 + (i + 0.5) * L / n;
        for (const s of [-1, 1]) {
          if (long) g.fillRect(s * (w / 2 + 0.035) - 0.045, o - 0.025, 0.09, 0.05);
          else g.fillRect(o - 0.025, s * (d / 2 + 0.035) - 0.045, 0.05, 0.09);
        }
      }
    }
  }
}
function truckPath(g, pts) {
  if (!pts || pts.length < 2) return;
  g.save(); g.setLineDash([0.5, 0.4]); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.12;
  g.beginPath();
  pts.forEach((p, k) => (k ? g.lineTo(+p.x, +p.z) : g.moveTo(+p.x, +p.z)));
  if (pts.length > 2) g.closePath();
  g.stroke();
  g.strokeStyle = '#FFD23F'; g.lineWidth = 0.1;
  for (const p of pts) if (p.stop) { disc(g, +p.x, +p.z, 0.8); g.stroke(); }
  g.restore();
}
function beltFrame(g, b) {
  g.save(); g.translate(+b.x || 0, +b.z || 0); g.rotate(-(+b.rot || 0));
  const w = +b.w || 1, d = +b.d || 1;
  g.fillStyle = '#8C95A6'; rr(g, -w / 2 - 0.1, -d / 2 - 0.1, w + 0.2, d + 0.2, 0.1); g.fill();
  g.fillStyle = '#3A3F4B'; g.fillRect(-w / 2, -d / 2, w, d);
  g.restore();
}
function roost(g, x, z) {   // the gulls' post (up to the perch height, drawn as screen-up) and the nest at its foot
  const top = z - 0.3 - GULL_Y * LIFT;
  g.fillStyle = '#8A5A33'; g.fillRect(x - 0.09, top, 0.18, GULL_Y * LIFT);
  g.fillStyle = '#A87A47'; rr(g, x - 0.45, top - 0.06, 0.9, 0.12, 0.05); g.fill();
  g.fillStyle = '#8A5A33'; g.beginPath(); g.ellipse(x, z, 0.62, 0.46, 0, 0, TAU); g.fill();
  g.fillStyle = '#A87A47'; g.beginPath(); g.ellipse(x, z, 0.44, 0.31, 0, 0, TAU); g.fill();
  g.strokeStyle = '#C8A15A'; g.lineWidth = 0.05; g.beginPath();
  for (let k = 0; k < 7; k++) { const a = k * 0.9; g.moveTo(x + Math.cos(a) * 0.62, z + Math.sin(a) * 0.46); g.lineTo(x + Math.cos(a + 0.7) * 0.4, z + Math.sin(a + 0.7) * 0.28); }
  g.stroke();
}
/** R8 in the baked ground: dress.js pieces as flat shapes (props.dressGeometry is the 3D twin). Baked, so no tier thinning. */
function dressPiece(g, d) {
  const c = d.c | 0, k = d.k, bar = (x, z, w, h, col) => { g.fillStyle = col; g.fillRect(x - w / 2, z - h / 2, w, h); };
  g.save(); g.translate(d.x, d.z); g.rotate(-(d.rot || 0));
  if (k === 'mat') {
    // R3: props.dressGeometry's plate, chequered mat and rope-edged canvas, flat.
    const R = d.r;
    if (d.town === 'market' && c % 2 === 0) {
      const col = RUGS[(c + 1) % 4], r0 = R * 0.2, r1 = R * 0.9, dr = (r1 - r0) / 3;
      g.fillStyle = shade(col, -0.2); disc(g, 0, 0, R); g.fill();
      g.fillStyle = '#F4E6CC'; disc(g, 0, 0, r1); g.fill();
      g.fillStyle = col;
      for (let a = 0; a < 3; a++) for (let b = a % 2; b < 12; b += 2) {
        g.beginPath(); g.arc(0, 0, r0 + (a + 1) * dr, b * TAU / 12, (b + 1) * TAU / 12); g.arc(0, 0, r0 + a * dr, (b + 1) * TAU / 12, b * TAU / 12, true); g.closePath(); g.fill();
      }
      disc(g, 0, 0, r0); g.fill();
    } else if (d.town === 'harbour') {
      g.fillStyle = '#2F5F70'; disc(g, 0, 0, R); g.fill();
      g.fillStyle = '#3E7486'; disc(g, 0, 0, R * 0.8); g.fill();
      g.fillStyle = '#477F90'; disc(g, 0, 0, R * 0.5); g.fill();
      g.strokeStyle = '#C9A869'; g.lineWidth = 0.15; disc(g, 0, 0, R * 0.97); g.stroke();
      g.strokeStyle = '#9B7B49'; g.lineWidth = 0.05; g.setLineDash([0.08, 0.3]); disc(g, 0, 0, R * 0.97); g.stroke(); g.setLineDash([]);
    } else {
      g.fillStyle = '#FFFDF7'; disc(g, 0, 0, R); g.fill();
      g.strokeStyle = '#D9CDB8'; g.lineWidth = 0.05; disc(g, 0, 0, R * 0.98); g.stroke();
      g.fillStyle = ['#E5574A', '#3E9BD6', '#5DB04E', '#F2B23A'][c % 4]; disc(g, 0, 0, R * 0.8); g.fill();
      g.fillStyle = '#FFFDF7'; disc(g, 0, 0, R * 0.74); g.fill();
      g.fillStyle = '#F4ECDD'; disc(g, 0, 0, R * 0.66); g.fill();
    }
  } else if (k === 'rug') {
    const col = RUGS[c % 4];
    bar(0, 0, 3, 2, col); bar(0, 0.5, 2.5, 0.16, '#F4E6CC'); bar(0, -0.5, 2.5, 0.16, '#F4E6CC'); bar(0, 0, 2.5, 0.42, shade(col, -0.16));
  } else if (k === 'awning') {
    const col = RUGS[(c + 1) % 4], sw = 2.6 / 6;
    for (let i = 0; i < 6; i++) {
      const x = -1.3 + (i + 0.5) * sw, hex = i % 2 ? '#F4E6CC' : col;
      bar(x, -0.08, sw, 1.2, hex); g.fillStyle = hex; disc(g, x, 0.52, sw / 2); g.fill();
    }
  } else if (k === 'hop') {
    g.strokeStyle = '#F4E6CC'; g.lineWidth = 0.05;
    for (const [x, z] of [[0, 1.25], [0, 0.7], [-0.3, 0.14], [0.3, 0.14], [0, -0.42], [-0.3, -0.98], [0.3, -0.98]]) g.strokeRect(x - 0.28, z - 0.28, 0.56, 0.56);
  } else if (k === 'bars') {
    const hb = d.town === 'harbour', n = hb ? 5 : 6;
    for (let i = 0; i < n; i++) bar(-1.2 + (i + 0.5) * 2.4 / n, 0, 0.24, hb ? 0.9 : 1.5, hb ? '#E8B83A' : '#F4E6CC');
  } else if (k === 'rope') {
    g.lineWidth = 0.13;
    for (let i = 0; i < 4; i++) { g.strokeStyle = i % 2 ? '#C9A869' : '#B6935A'; disc(g, 0, 0, 0.18 + i * 0.15); g.stroke(); }
  } else if (k === 'net') {
    g.strokeStyle = '#3E7F87'; g.lineWidth = 0.04; g.beginPath();
    for (let i = -4; i <= 4; i++) { g.moveTo(-1.2 + i * 0.3, -0.9); g.lineTo(-0.2 + i * 0.3, 0.9); g.moveTo(1.2 + i * 0.3, -0.9); g.lineTo(0.2 + i * 0.3, 0.9); }
    g.stroke();
  } else if (k === 'hatch') {
    bar(0, 0, 1.7, 1.7, '#7A5230');
    for (let i = 0; i < 5; i++) bar(0, -0.58 + i * 0.29, 1.42, 0.23, i % 2 ? '#B08552' : '#C09560');
  } else if (k === 'ring') {
    g.lineWidth = 0.28; g.strokeStyle = '#F4E6CC'; disc(g, 0, 0, 0.42); g.stroke();
    g.strokeStyle = '#D6523F';
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; g.beginPath(); g.arc(0, 0, 0.42, a - 0.36, a + 0.36); g.stroke(); }
  } else if (k === 'crate') {
    g.fillStyle = 'rgba(40,22,10,0.2)'; g.fillRect(-0.34, -0.3, 0.84, 0.84);
    bar(0, 0, 0.84, 0.84, '#8E5C2C'); bar(0, 0, 0.66, 0.66, '#D9A066');
  } else if (k === 'basket') {
    g.fillStyle = 'rgba(40,22,10,0.2)'; disc(g, 0.08, 0.1, 0.46); g.fill();
    g.fillStyle = '#8E6A36'; disc(g, 0, 0, 0.44); g.fill();
    g.fillStyle = '#3E7F87'; disc(g, 0, 0, 0.38); g.fill();
  }
  g.restore();
}
function decor(g, d) {
  const s = +d.s || 1, x = +d.x || 0, z = +d.z || 0;
  if (d.kind === 'tree') {
    g.fillStyle = 'rgba(40,22,10,0.22)'; g.beginPath(); g.ellipse(x + 0.3 * s, z + 0.35 * s, 1.05 * s, 0.85 * s, 0, 0, TAU); g.fill();
    g.fillStyle = '#3F9B4B'; g.strokeStyle = '#2E7A39'; g.lineWidth = 0.06;
    for (const [dx, dz, r] of [[-0.4, 0.15, 0.6], [0.4, 0.2, 0.6], [0, -0.3, 0.68]]) { disc(g, x + dx * s, z + dz * s, r * s); g.fill(); g.stroke(); }
    g.fillStyle = '#5DBB5F'; disc(g, x - 0.1 * s, z - 0.4 * s, 0.3 * s); g.fill();
  } else if (d.kind === 'lamp') {
    const top = z - 2.2 * LIFT * s;
    g.fillStyle = '#4A4F63'; disc(g, x, z, 0.18 * s); g.fill();
    g.strokeStyle = '#4A4F63'; g.lineWidth = 0.1 * s; g.beginPath(); g.moveTo(x, z); g.lineTo(x, top); g.stroke();
    g.fillStyle = 'rgba(255,233,168,0.35)'; disc(g, x, top, 0.5 * s); g.fill();
    g.fillStyle = '#FFE9A8'; disc(g, x, top, 0.22 * s); g.fill(); g.lineWidth = 0.05; g.stroke();
  } else if (d.kind === 'buoy') {
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.1; disc(g, x, z, 0.58 * s); g.stroke();
    g.fillStyle = '#E04F4F'; disc(g, x, z, 0.4 * s); g.fill();
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 0.14 * s; g.beginPath(); g.arc(x, z, 0.27 * s, -0.6, 0.6); g.moveTo(x - 0.27 * s * Math.cos(0.6), z - 0.27 * s * Math.sin(0.6)); g.arc(x, z, 0.27 * s, PI - 0.6, PI + 0.6); g.stroke();
    g.fillStyle = '#FFCF3D'; disc(g, x, z, 0.12 * s); g.fill();
  }
}
function fadeEdges(g, x0, x1, z0, z1) {
  const F = 2, c0 = rgba(BACK[town], 1), c1 = rgba(BACK[town], 0);
  const edge = (ax, az, bx, bz, rx, rz, rw, rh) => {
    const gr = g.createLinearGradient(ax, az, bx, bz); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fillRect(rx, rz, rw, rh);
  };
  edge(x0, 0, x0 + F, 0, x0, z0, F, z1 - z0);
  edge(x1, 0, x1 - F, 0, x1 - F, z0, F, z1 - z0);
  edge(0, z0, 0, z0 + F, x0, z0, x1 - x0, F);
  edge(0, z1, 0, z1 - F, x0, z1 - F, x1 - x0, F);
}

// ------------------------------------------------------------------ camera (render3d's rules, top-down)
function scaleFor(wv) {
  // DECISION (11-04): ppu = cssW / Wv (render3d's follow width), but ≤ playH / (0.8 Wv): a top-down view shows
  // less depth than the 55° perspective, so landscape gets a wider, deeper view instead of a narrow strip.
  const ph = play.h > 1 ? play.h : cssH;
  return Math.max(4, Math.min(cssW / wv, ph / (0.8 * wv)));
}
function clampGoal(gx, gz) {
  // DECISION (11-04): render3d's margins, exact in 2D: ≤ 2 u of table past the far edge and the flanks, 0.6 u past
  // the near edge, measured at the play rect (HUD strips excluded). A view larger than the board keeps following
  // the pot inside the swapped bounds on x and pins the board's near edge to the play-rect bottom on z.
  if (!BB) return [gx, gz];
  const pl = play.w > 1 ? play.x : 0, pr = play.w > 1 ? play.x + play.w : cssW;
  const pt = play.h > 1 ? play.y : 0, pb = play.h > 1 ? play.y + play.h : cssH;
  const left = (cam.ax - pl) / ppu, right = (pr - cam.ax) / ppu, up = (cam.ay - pt) / ppu, down = (pb - cam.ay) / ppu;
  const lo = (a0, a1, m0, m1, g, n0, n1, pinNear) => {
    const L0 = a0 - n0 + m0, L1 = a1 + n1 - m1;
    if (L0 > L1) return pinNear ? L1 : clamp(g, L1, L0);
    return clamp(g, L0, L1);
  };
  return [lo(BB.x0, BB.x1, left, right, gx, 2, 2, false), lo(BB.z0, BB.z1, up, down, gz, 2, 0.6, true)];
}
function springTo(gx, gz, dt) {   // critically damped, ω = 9 (exact step, stable for any dt)
  const w = 9, e = Math.exp(-w * dt);
  let d0 = cam.x - gx, v0 = cam.vx, B = v0 + w * d0;
  cam.x = gx + (d0 + B * dt) * e; cam.vx = (v0 - w * B * dt) * e;
  d0 = cam.z - gz; v0 = cam.vz; B = v0 + w * d0;
  cam.z = gz + (d0 + B * dt) * e; cam.vz = (v0 - w * B * dt) * e;
}
const playEdges = pad => (play.w > 1 && play.h > 1
  ? [play.x + pad, play.x + play.w - pad, play.y + pad, play.y + play.h - pad] : [pad, cssW - pad, pad, cssH - pad]);
/** R6: render3d's keepPot in top-down terms: slide a view centre until the whole pot is inside the play rect. */
function keepPot(gx, gz, pad) {
  const r = Math.max(0.05, pot.rVis) * ppu, [l, R, t, b] = playEdges(pad), px = cam.ax + (pot.x - gx) * ppu, py = cam.ay + (pot.z - gz) * ppu;
  const ox = 2 * r >= R - l ? (l + R) / 2 - px : px - r < l ? l - px + r : px + r > R ? R - px - r : 0;
  const oy = 2 * r >= b - t ? (t + b) / 2 - py : py - r < t ? t - py + r : py + r > b ? b - py - r : 0;
  return [gx - ox / ppu, gz - oy / ppu];
}
/** R6: render3d's revealFit in top-down terms: the level-start boss shot widens only as far as pot and boss need. */
function revealFit(Rv, wv0) {
  const [l, r, t, b] = playEdges(14), rv = Math.max(0.05, pot.rVis);
  const x0 = Math.min(pot.x - rv, Rv.x - Rv.a), x1 = Math.max(pot.x + rv, Rv.x + Rv.a), z0 = Math.min(pot.z - rv, Rv.z - Rv.a), z1 = Math.max(pot.z + rv, Rv.z + Rv.a);
  const need = Math.min((r - l) / Math.max(1e-3, x1 - x0), (b - t) / Math.max(1e-3, z1 - z0));
  const p = Math.max(4, Math.min(scaleFor(Math.max(wv0, Rv.wv)), need));
  return { ppu: p, x: (x0 + x1) / 2 - ((l + r) / 2 - cam.ax) / p, z: (z0 + z1) / 2 - ((t + b) / 2 - cam.ay) / p };
}
function updateCamera(dt) {
  // DECISION (11-04): follow width, anchor ease, SIZE UP punch, boss shake, the levelStart boss reveal and the
  // two-course glance are render3d's; the title centres the board with a slow drift (no orbit in 2D).
  const land = cssW > cssH;
  cam.rCam += (pot.r - cam.rCam) * ek(dt, 0.45);
  let wv = (REC ? camWRec : camW)(cam.rCam) * (land ? 1.35 : 1), ax = play.cx, ay = play.cy;
  if (!REC && BB) {   // R2, render3d's boardCapWv in top-down terms: the board keeps filling the view, the pot grows in frame
    const ph = play.h > 1 ? play.h : cssH, minPpu = Math.max(ph / ((BB.z1 - BB.z0 + CAM_EDGE) * CAM_SLACK), cssW / (BB.x1 - BB.x0 + 4));
    wv = Math.min(wv, Math.max(Math.min(cssW, ph / 0.8) / minPpu, cam.rCam * CAM_POT_FLOOR));
  }
  if (titleOn) { wv = camTitle(cssW, cssH); ay = cssH * 0.5; }
  if (fin || finHold) ay = cssH * 0.72;   // R7: the pot sits under the centred ORDER UP band, as in render3d
  cam.ax += (ax - cam.ax) * ek(dt, 0.25); cam.ay += (ay - cam.ay) * ek(dt, 0.25);
  if (Math.abs(cam.ax - ax) > cssW || !(cam.ax > -1e8) || REC) { cam.ax = ax; cam.ay = ay; }
  if (punchT > 0) { punchT = Math.max(0, punchT - dt); const p = punchT / 0.5; wv *= 1 + 0.08 * p * (2 - p); }
  shakeX = shakeZ = 0;
  if (bossCamT >= 0) {
    bossCamT += dt;
    const t = bossCamT;
    wv *= t < 0.3 ? 1 - 0.1 * sstep(0, 0.3, t) : 0.9 + 0.1 * sstep(0.3, 0.9, t);
    const amp = t < 0.25 ? 0.12 * pot.r * (1 - t / 0.25) : 0;
    shakeX = (rnd() * 2 - 1) * amp; shakeZ = (rnd() * 2 - 1) * amp;
    if (t > 0.9) bossCamT = -1;
  }
  // R7: the last bite punches in on the pot (framing and timing as render3d: pot ≈ 72 % of the width, shake on bite and boom)
  let finK = 0, holdK = finHold ? 1 : 0;   // holdK keeps the goal on the pot until the next level (render3d says why)
  if (fin) {
    fin.t += dt;
    const t = fin.t;
    const B = fin.B, big = B === FIN_BIG;
    if (!fin.boom && t >= B.boom) { fin.boom = true; finBoom(big); }
    finK = calm ? 0 : sstep(0, B.push, t) * (1 - sstep(B.back, B.end, t));   // reduced motion: the camera stays put, the boss still goes in
    holdK = sstep(0, B.push, t);
    wv *= Math.exp(finK * Math.log(Math.min(1, 2 * pot.rVis / 0.72 / wv)));
    if (big && !calm) wv *= 1 - 0.06 * sstep(B.sink, B.hold, t) * (1 - sstep(B.boom, B.back, t));   // the slow creep in on the held frame
    const rum = big && t >= B.sink && t < B.boom ? 0.16 * sstep(B.sink, B.hold, t) : 0;
    const pk = t < 0.2 ? 0.45 * (1 - t / 0.2) : t >= B.boom && t < B.boom + (big ? 0.6 : 0.4) ? (big ? 1.4 : 1) * (1 - (t - B.boom) / (big ? 0.6 : 0.4)) : rum;
    const amp = calm ? 0 : 0.022 * wv * pk;
    shakeX = (rnd() * 2 - 1) * amp; shakeZ = (rnd() * 2 - 1) * amp;
    if (t > B.end) { fin = null; finHold = true; shakeX = shakeZ = 0; }
  }
  let fx0 = pot.x, fz0 = pot.z;
  if (glance && !titleOn) {   // 35 % toward the course-② boss and back over 1.2 s, kept within 70 % of the room
    glance.t += dt;
    const k = glance.t >= 1.2 ? 0 : Math.sin(PI * glance.t / 1.2);
    wv *= 1 + 0.12 * k;
    const dx = (glance.x - pot.x) * 0.35, dz = (glance.z - pot.z) * 0.35, pxu = scaleFor(wv);
    const pb = play.h > 1 ? play.y + play.h : cssH, pt = play.h > 1 ? play.y : 0, pl = play.w > 1 ? play.x : 0, pr = play.w > 1 ? play.x + play.w : cssW;
    const roomX = 0.7 * Math.max(40, Math.min(cam.ax - pl, pr - cam.ax)) / pxu;
    const roomZ = 0.7 * Math.max(40, dz < 0 ? pb - cam.ay : cam.ay - pt) / pxu;
    const s = Math.min(1, roomX / Math.max(1e-3, Math.abs(dx)), roomZ / Math.max(1e-3, Math.abs(dz)));
    fx0 += dx * s * k; fz0 += dz * s * k;
    if (glance.t >= 1.2) glance = null;
  }
  ppu = scaleFor(wv);
  let gx, gz;
  if (titleOn) {
    gx = BB ? (BB.x0 + BB.x1) / 2 + Math.sin(time * 0.11) * 1.2 : pot.x;
    gz = BB ? (BB.z0 + BB.z1) / 2 + Math.sin(time * 0.07) * 1.6 : pot.z;
  } else [gx, gz] = clampGoal(fx0, fz0);
  const keep = !titleOn && !REC && holdK <= 0;   // the finisher frames the pot itself
  if (keep) [gx, gz] = keepPot(gx, gz, 12);
  if (holdK > 0) { gx = lerp(gx, pot.x, holdK); gz = lerp(gz, pot.z, holdK); if (finK > 0) { cam.x = lerp(cam.x, pot.x, finK * 0.35); cam.z = lerp(cam.z, pot.z, finK * 0.35); } }
  if (reveal && !titleOn) {   // hold on the ticket boss 0.7 s, then glide to the pot over 0.6 s
    reveal.t += dt;
    const t = reveal.t;
    if (t >= 1.3) reveal = null;
    else {
      cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0;
      const F = reveal.fit || (reveal.fit = revealFit(reveal, wv));
      const e = t < 0.7 ? 0 : inOut((t - 0.7) / 0.6), p = Math.exp(lerp(Math.log(F.ppu), Math.log(ppu), e)), k = (1 - e) * F.ppu / p;
      view.x = gx + (F.x - gx) * k; view.z = gz + (F.z - gz) * k; ppu = p;
      return;
    }
  }
  if (titleOn || (snapCam && W)) { cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0; snapCam = snapCam && !W; } else springTo(gx, gz, dt);
  if (keep) [cam.x, cam.z] = keepPot(cam.x, cam.z, 3);   // the spring lags a pot at full speed
  view.x = cam.x + shakeX; view.z = cam.z + shakeZ;
}

// ------------------------------------------------------------------ particles
function spawn(x, y, z, vx, vy, vz, life, size, col, shape = 0, grav = 6, grow = 0, a = 1) {
  const i = fxHead; fxHead = (fxHead + 1) % FXN;
  fP[i * 3] = x; fP[i * 3 + 1] = y; fP[i * 3 + 2] = z;
  fV[i * 3] = vx; fV[i * 3 + 1] = vy; fV[i * 3 + 2] = vz;
  fLife[i] = life; fL0[i] = life; fSz[i] = size; fShape[i] = shape; fGrav[i] = grav; fGrow[i] = grow; fA[i] = a; fCol[i] = col;
}
function celebrate() {
  const M = mood;
  M.celebrateT = 0; M.happyT = 1.6; M.worried = false;
  spawn(pot.x, 0.3 + pot.rVis * 0.3, pot.z, 0, 1.0, 0, 1.3, Math.max(0.16, 0.35 * pot.rVis), '#FF6F8E', 3, -0.2, 0.6);
  sparkleRing(10, '#FFE27A', 2.2);
}
function finBoom(big = false) {   // the boss lands in the stew: warm flash, gulp, confetti from the pot, sparkle ring
  const v = camW(pot.rVis), M = mood;
  flash(big ? 0.85 : 0.62); M.biteT = 0.18; M.sizeT = 0.2; M.happyT = 2;
  if (big) bossRing = { t: 0, x: pot.x, z: pot.z, R: 1.5 * pot.rVis };
  burst(pot.x, 0.3, pot.z, big ? 150 : 110, ['#FFD34D', '#E5483B', '#4CC26A', '#FFF6E6', '#FF9EC4', '#4AA8E8'], { speed: 0.8 * v, up: 0.9 * v, size: 0.045 * v, shape: 1, grav: v, life: 1.6 });
  sparkleRing(big ? 22 : 14, '#FFE27A', (big ? 0.55 : 0.4) * v);
  if (fin && fin.win) celebrate();
}
function burst(x, y, z, n, col, opt = {}) {
  const sp = opt.speed || 1.5, up = opt.up ?? 2, life = opt.life || 0.6, size = opt.size || 0.06;
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, s = sp * (0.4 + 0.6 * rnd());
    const c = Array.isArray(col) ? col[(rnd() * col.length) | 0] : col;
    spawn(x, y, z, Math.cos(a) * s, up * (0.5 + 0.5 * rnd()), Math.sin(a) * s, life * (0.7 + 0.6 * rnd()), size * (0.7 + 0.6 * rnd()), c, opt.shape || 0, opt.grav ?? 6, opt.grow || 0, opt.a ?? 1);
  }
}
function sparkleRing(n, col, up = 1.4) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rnd() * 0.3, r = pot.rVis * 1.05;
    spawn(pot.x + Math.cos(a) * r, 0.1, pot.z + Math.sin(a) * r, Math.cos(a) * 0.9, up * (0.6 + 0.6 * rnd()), Math.sin(a) * 0.9, 0.55 + rnd() * 0.25, Math.max(0.05, 0.14 * pot.rVis) * (0.8 + 0.5 * rnd()), col, 2, 2.5);
  }
}
function updateFx(dt) {
  for (let i = 0; i < FXN; i++) {
    if (fLife[i] <= 0) continue;
    fLife[i] -= dt;
    if (fLife[i] <= 0) continue;
    const j = i * 3, sh = fShape[i], dk = Math.exp(-(sh === 1 ? 2.2 : sh === 4 ? 1.5 : 0.6) * dt);
    fV[j + 1] -= fGrav[i] * dt;
    fV[j] *= dk; fV[j + 1] *= sh === 1 ? dk : 1; fV[j + 2] *= dk;
    fP[j] += fV[j] * dt; fP[j + 1] += fV[j + 1] * dt; fP[j + 2] += fV[j + 2] * dt;
    if (fP[j + 1] < 0.02 && sh !== 4 && fV[j + 1] < 0 && !(sh === 0 && fGrav[i] < 0)) { fP[j + 1] = 0.02; fV[j + 1] *= -0.35; fV[j] *= 0.6; fV[j + 2] *= 0.6; }
  }
}

// ------------------------------------------------------------------ fx events (bus → onFx)
function resetMood() {
  Object.assign(mood, { biteT: 0, sizeT: 0, happyT: 0, wideT: 0, squintT: 0, celebrateT: -1, sad: false, worried: false,
    blinkIn: 2 + rnd() * 2, blinkT: -1, lid: 0, happy: 0, wide: 0, worry: 0, dim: 1, lookX: 0, lookY: 0.25 });
  rattleT.fill(0); wobT.fill(0); popT.fill(0);
}
function itemXZ(i) { return W && i >= 0 && i < W.n ? [W.ix[i], W.iz[i]] : [pot.x, pot.z]; }
function catOf(w, i, it) {
  const id = w.kindNames ? w.kindNames[w.kind[i]] : undefined;
  if (id !== undefined && KIND_ID[id] !== undefined) return KIND_ID[id];
  return it && KIND_ID[it.kind] !== undefined ? KIND_ID[it.kind] : -1;
}
function addSplat(i) {
  if (!W) return;
  const id = W.kindNames ? W.kindNames[W.kind[i]] : '';
  splats.push({ x: W.ix[i], z: W.iz[i], r: 0.75 * W.ia[i], col: SPLAT[id] || '#FFE14D', k: i * 7 + splats.length });
  if (splats.length > SPLAT_MAX) splats.shift();
}
/** Bus events → pot face / camera / fx (GDD §7.7). Accepts (ev, data), (data, ev) or ({type, …}). */
export function onFx(ev, data) {
  // DECISION (11-04): render3d's event list and aliases (courseDone/course, tier/cakeTier, gullWarn/gull fire once
  // per frame per item); 2D keeps the same timers and bursts, minus the 3D-only tilt, glow and record pull-up.
  if (ev && typeof ev === 'object') { const d = ev; ev = typeof data === 'string' ? data : d.type; data = d; }
  else if (typeof data === 'string' && typeof ev !== 'string') { const t = data; data = ev; ev = t; }
  if (!ctx || typeof ev !== 'string') return;
  const d = data || {}, M = mood;
  const cn = EV_ALIAS[ev] || (ALIASED.has(ev) ? ev : null);
  if (cn) { const key = cn + ':' + (d.i ?? ''); if (evSeen.has(key)) return; evSeen.add(key); ev = cn; }
  switch (ev) {
    case 'bite': M.biteT = 0.18; if (d.ing) sparkleRing(5, '#FFF3C4', 1.1); break;
    case 'sizeUp':
      M.sizeT = 0.2; M.happyT = Math.max(M.happyT, 0.4);
      sparkleRing(BIG_STEPS.has(d.step | 0) ? 14 : 7, '#FFE27A', 1.8);
      if (BIG_STEPS.has(d.step | 0)) punchT = 0.5;
      break;
    case 'padlock': {
      M.wideT = 0.9;
      const [x, z] = itemXZ(d.i);
      burst(x, 1, z, 18, ['#FFD34D', '#FFF3C4', '#F5B323'], { speed: 1.6, up: 2.4, size: 0.1, shape: 2, grav: 3 });
      if (W && d.i >= 0 && d.i < ITEM_MAX) { popT[d.i] = 0.25; bossRing = { t: 0, x, z, R: 1.5 * W.ia[d.i] }; }   // R4: the unlock lands
      break;
    }
    case 'hot': {   // R7: the pot bit a chili: squint, red flush, steam out of the top
      const v = camW(pot.rVis);
      M.squintT = 0.5; hotT = 0.75;
      burst(pot.x, 0.1, pot.z, 10, ['#FFFFFF', '#FFE3D2'], { speed: 0.07 * v, up: 0.32 * v, size: 0.05 * v, shape: 4, grav: -0.08 * v, grow: 1.6, life: 0.85, a: 0.7 });
      break;
    }
    case 'bossNudge': if (d.i >= 0 && d.i < ITEM_MAX) rattleT[d.i] = 0.4; M.squintT = 0.3; break;
    case 'bump': {
      M.squintT = 0.3;
      const [x, z] = itemXZ(d.i), dx = x - pot.x, dz = z - pot.z, L = Math.hypot(dx, dz) || 1;
      burst(pot.x + (dx / L) * pot.rVis * 1.1, 0.05, pot.z + (dz / L) * pot.rVis * 1.1, 5, '#E9D8BC', { speed: 0.6, up: 0.6, size: 0.05 + 0.05 * pot.rVis, shape: 4, grav: -0.3, grow: 1.2, life: 0.5, a: 0.7 });
      break;
    }
    case 'bossBite': {
      const [x, z] = itemXZ(d.i);
      if (!REC && d.final) { const B = W && W.level && isMilestone(W.level.n) ? FIN_BIG : FIN_BEAT; fin = { t: 0, i: d.i, boom: false, B, ang: Math.atan2(x - pot.x, z - pot.z) }; glance = null; flash(0.28); M.wideT = B.boom; }
      else { bossCamT = 0; M.wideT = 0.8; if (!REC) flash(0.2); }
      burst(x, 0.4 + pot.rVis * 0.5, z, 70, ['#FFD34D', '#E5483B', '#4CC26A', '#FFF6E6'], { speed: 2.6, up: 4.2, size: 0.11, shape: 1, grav: 5, life: 1.6 });
      break;
    }
    case 'win':
      if (fin && !fin.boom) { fin.win = true; M.worried = false; break; }   // mid-way through a milestone's held frame: the party waits for the gulp
      celebrate();
      break;
    case 'fail': M.sad = true; M.worried = false; break;
    case 'lowTime': M.worried = true; break;
    case 'refuse': case 'shove':   // §4.5 Simmer: the lid hat appears on the first refusal of a capped level
      M.squintT = 0.3;
      if (W && W.cap > 0 && !lid.on) { lid.on = true; lid.pop = 0.3; }
      if (lid.on) lid.jig = 0.35;
      break;
    case 'boil':
      M.squintT = 0.3; if (lid.on) lid.jig = 0.35;
      burst(pot.x, 0.1, pot.z, 6, '#FFFFFF', { speed: 0.3, up: 1.2, size: 0.12 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.4, grow: 1.5, life: 0.9, a: 0.6 });
      break;
    case 'crack': {
      const i = d.i;
      if (W && i >= 0 && i < W.n && crackT[i] <= 0) crackT[i] = 0.45;
      const [x, z] = itemXZ(i), id = W && i >= 0 && W.kindNames ? W.kindNames[W.kind[i]] : '';
      burst(x, 0.15, z, 12, ['#FFF6E6', SPLAT[id] || '#FFE14D', '#F4A493'], { speed: 1.2, up: 1.6, size: 0.06, shape: 0, life: 0.7 });
      break;
    }
    case 'wobble': if (d.i >= 0 && d.i < ITEM_MAX) wobT[d.i] = 0.4; break;
    case 'sizzle':
      sparkleRing(8, '#FFB347', 1.6);
      burst(pot.x, 0.1, pot.z, 4, '#FFFFFF', { speed: 0.2, up: 1.0, size: 0.1 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.5, grow: 1.6, life: 1.0, a: 0.55 });
      break;
    case 'chain': if ((d.n | 0) >= 3) sparkleRing(3, '#FFF3C4', 1.0); break;
    case 'start': if (reveal) reveal.t = Math.max(reveal.t, 0.7); break;   // straight into the glide: a cut from the wide shot jars
    case 'levelStart': {
      resetMood();
      lid.on = false; lid.pop = lid.jig = 0; glance = bossRing = null; fin = null; finHold = false; flashA = 0; hotT = 0;
      const w = d.w || W;
      if (!d.retry && w && w.tickets && w.tickets.length) {
        const b = w.tickets[w.ti | 0] && w.tickets[w.ti | 0].boss;
        if (b >= 0 && b < w.n) reveal = { t: 0, x: w.ix[b], z: w.iz[b], a: w.ia[b], wv: (2.2 * w.ia[b]) / 0.6, fit: null };
      }
      break;
    }
    case 'course': {   // two-course boss ② reveal: pop, shock ring, 1.2 s glance (no input lock)
      const w = W;
      if (!w || !w.tickets) break;
      const tk = w.tickets[w.ti | 0], b = tk ? tk.boss : -1;
      if (b >= 0 && b < w.n && w.st[b] === 0) {
        const x = w.ix[b], z = w.iz[b];
        popT[b] = 0.25; bossRing = { t: 0, x, z, R: 1.3 * w.ia[b] }; glance = { t: 0, x, z };
        burst(x, 1, z, 18, ['#FFE27A', '#FFF3C4', '#F5B323'], { speed: 1.5, up: 2.4, size: 0.1, shape: 2, grav: 3 });
      }
      break;
    }
    case 'cakeTier': {
      if (d.i >= 0 && d.i < ITEM_MAX) popT[d.i] = 0.25;
      if (!REC) { bossCamT = 0; flash(0.16); }
      const [x, z] = itemXZ(d.i);
      burst(x, 0.8, z, 22, ['#FFF6E3', '#FF9EC4', '#FFFFFF', '#FFB3C7'], { speed: 1.7, up: 2.6, size: 0.08, shape: 0, life: 0.8 });
      break;
    }
    case 'truckHorn': {
      truckSq = 0.3;
      const i = d.i >= 0 ? d.i : W && W.truck ? W.truck.i : -1;
      if (W && i >= 0 && i < W.n) {
        const a = W.ia[i], ang = +W.truck.ang || 0;
        burst(W.ix[i] - Math.sin(ang) * a * 0.95, 0.18, W.iz[i] - Math.cos(ang) * a * 0.95, 5, '#E9E4DA', { speed: 0.4, up: 0.6, size: 0.14, shape: 4, grav: -0.4, grow: 1.6, life: 0.7, a: 0.7 });
      }
      break;
    }
    case 'steal': {
      const G = W && W.gulls && W.gulls[d.g | 0];
      if (G) burst(G.x, G.y, G.z, 9, ['#FFFFFF', '#E6ECF2', '#C9D3E0'], { speed: 1.0, up: 0.8, size: 0.07, shape: 1, grav: 1.2, life: 1.0 });
      break;
    }
    case 'nest': {
      if (d.i >= 0 && d.i < ITEM_MAX) popT[d.i] = 0.25;
      const [x, z] = itemXZ(d.i);
      burst(x, 0.12, z, 8, ['#C8A15A', '#A87A47', '#E3C27A'], { speed: 0.8, up: 1.2, size: 0.05, shape: 1, grav: 5, life: 0.6 });
      break;
    }
    case 'gullMiss': {
      const G = W && W.gulls && W.gulls[d.g | 0];
      if (G) burst(G.x, G.y, G.z, 6, '#FFF3C4', { speed: 0.8, up: 1.0, size: 0.08, shape: 2, grav: 2, life: 0.5 });
      break;
    }
    case 'feastWipe': wipeT = 0; break;
    case 'spawn':
      if (d.i >= 0 && d.i < ITEM_MAX) {
        popT[d.i] = 0.25;
        const [x, z] = itemXZ(d.i);
        burst(x, 0.1, z, 4, '#FFFFFF', { speed: 0.3, up: 0.9, size: 0.12, shape: 4, grav: -0.4, grow: 1.4, life: 0.6, a: 0.55 });
      }
      break;
    default: break;
  }
}

// ------------------------------------------------------------------ per-frame update (state only; draw paints)
function bindWorld(w) {
  W = w;
  const n = Math.min(w.n | 0, ITEM_MAX);
  itemCat = new Int16Array(n); itemRot = new Float32Array(n); prevSt = new Uint8Array(n); prevHid = new Uint8Array(n); prevKind = new Int16Array(n);
  const items = (w.level && w.level.items) || (LV && LV.items) || [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    itemCat[i] = catOf(w, i, it);
    itemRot[i] = it && typeof it.rot === 'number' ? it.rot : 0;
    prevSt[i] = w.st[i]; prevHid[i] = w.hid ? w.hid[i] : 0; prevKind[i] = w.kind[i];
    rollA[i] = 0; lastX[i] = w.ix[i]; lastZ[i] = w.iz[i]; crackT[i] = 0;
    preloadKind(itemCat[i]);
    const so = w.stackOf && w.stackOf[i];
    if (so) for (const k of so) preloadKind(KIND_ID[k]);
  }
}

export function update(w, dt, alpha = 1) {
  // DECISION (11-04): like render3d, a null world on the title builds an untouched backdrop world of the loaded
  // level once; any other null keeps the last world. Items that jump > 0.8 u in a step (belt wrap, Feast respawn)
  // snap instead of sliding.
  // DECISION (Core 13:2x): after loadLevel the first world goes straight to the live camera on the pot (snapCam);
  // a world already > 0.5 s old (a mid-run swap from 3D) never gets the levelStart reveal pan. Not w.tStart: the
  // bot or a held finger can start the clock before the first paint of a real level start.
  if (!ctx) return;
  evSeen.clear();
  dt = clamp(+dt || 0, 0, 0.1);
  alphaNow = clamp(+alpha || 0, 0, 1);
  time += dt;
  if (w && w !== W) bindWorld(w);
  if (!w && titleOn && LV && (!W || W.level !== LV)) bindWorld(createWorld(LV, { mode: 'level' }));
  if (!w) w = W;
  if (w) {
    const P = w.pot, r = P.pr + (P.r - P.pr) * alphaNow;
    pot.x = P.px + (P.x - P.px) * alphaNow; pot.z = P.pz + (P.z - P.pz) * alphaNow;
    pot.r = r * (P.rEff > P.r ? P.rEff / P.r : 1);
  }
  if (snapCam && w) { cam.rCam = pot.rVis = pot.r; cam.x = pot.x; cam.z = pot.z; }   // first world after loadLevel
  if (freshW && w) { freshW = false; if (+w.t > 0.5) reveal = null; }   // only that first world: a running one
  pot.rVis += ((titleOn ? Math.max(pot.r, 0.8) : pot.r) - pot.rVis) * ek(dt, 0.12);
  updateCamera(dt);
  updateFx(dt);
  look = w && itemCat ? updateItems(w, dt) : null;
  updateMood(dt, w);
  truckSq = Math.max(0, truckSq - dt);
  if (bossRing) { bossRing.t += dt; if (bossRing.t > 0.6) bossRing = null; }
  hotT = Math.max(0, hotT - dt);
  if (wipeT >= 0) { wipeT += dt / 0.6; if (wipeT >= 1) wipeT = -1; }
  flashA *= Math.exp(-dt / 0.13);
}

function itemPos(w, i) {   // interpolated position → XS/ZS (and YS = height for carried food)
  let x = w.ipx[i] + (w.ix[i] - w.ipx[i]) * alphaNow, z = w.ipz[i] + (w.iz[i] - w.ipz[i]) * alphaNow, y = 0;
  if (Math.abs(w.ix[i] - w.ipx[i]) + Math.abs(w.iz[i] - w.ipz[i]) > 0.8) { x = w.ix[i]; z = w.iz[i]; }
  if (w.st[i] === 5 && w.gulls) for (const G of w.gulls) if (G.i === i && G.st === 2) { x = G.x; z = G.z; y = Math.max(0, G.y - 0.35); }
  XS[i] = x; ZS[i] = z; YS[i] = y;
}

const finHeld = (i, s) => !!fin && fin.i === i && (s === 1 || (s === 2 && !fin.boom));
function updateItems(w, dt) {
  const n = itemCat.length, st = w.st;
  let best = null, bestPri = 0, bestD = 1e9;
  for (let i = 0; i < n; i++) {
    if (prevKind[i] !== w.kind[i]) {   // Feast respawn: the slot holds a new kind
      prevKind[i] = w.kind[i]; itemCat[i] = catOf(w, i, null); preloadKind(itemCat[i]);
      rollA[i] = 0; lastX[i] = w.ix[i]; lastZ[i] = w.iz[i]; crackT[i] = 0;
    }
    const s = st[i];
    if (s === 2 && finHeld(i, s)) continue;   // a milestone's boss outlives its sim tip: the crumbs wait for the boom
    if (s === 2) {
      if (prevSt[i] === 1) {   // swallowed: crumbs fly out of the stew in the kind colour
        const K = KINDS[itemCat[i]], tn = K ? K.tier | 0 : 0;
        burst(pot.x, 0.05, pot.z, Math.min(12, 3 + 2 * tn), [K ? K.color : '#FFD36E', '#FFD36E', '#FF8A2A'], { speed: 0.6 + 0.4 * pot.rVis, up: 1.4 + pot.rVis, size: Math.max(0.03, 0.045 * Math.sqrt(pot.rVis) + 0.015 * tn), life: 0.5 });
      }
      prevSt[i] = 2; continue;
    }
    if (w.hid && w.hid[i]) { prevHid[i] = 1; continue; }
    if (prevHid[i]) { prevHid[i] = 0; popT[i] = 0.25; }
    prevSt[i] = s;
    if (popT[i] > 0) popT[i] = Math.max(0, popT[i] - dt);
    if (wobT[i] > 0) wobT[i] = Math.max(0, wobT[i] - dt);
    if (rattleT[i] > 0) rattleT[i] = Math.max(0, rattleT[i] - dt);
    if (crackT[i] > 0) { crackT[i] = Math.max(0, crackT[i] - dt); if (crackT[i] === 0) addSplat(i); }
    itemPos(w, i);
    const x = XS[i], z = ZS[i], K = KINDS[itemCat[i]];
    if (K && K.roll) {
      const mx = x - lastX[i], mz = z - lastZ[i], md = Math.hypot(mx, mz);
      if (md < 1) rollA[i] += (md / Math.max(0.05, w.ia[i])) * (mx + mz >= 0 ? 1 : -1);
    }
    lastX[i] = x; lastZ[i] = z;
    if (titleOn || s === 1 || s === 5) continue;
    // look-at priority: open-line ingredient > open boss > edible item within 3 r
    const fl = w.flags[i], open = w.glow[i] > 0, dist = Math.hypot(x - pot.x, z - pot.z);
    let pri = fl & F_ING && open ? 3 : fl & F_BOSS && open ? 2 : 0;
    if (!pri && dist < 3 * pot.r && !(fl & F_HOT) && edible(w, i)) pri = 1;
    if (pri > 0 && (pri > bestPri || (pri === bestPri && dist < bestD))) { bestPri = pri; bestD = dist; best = [x - pot.x, z - pot.z]; }
  }
  return best;
}

function updateMood(dt, w) {
  const M = mood;
  M.biteT = Math.max(0, M.biteT - dt); M.sizeT = Math.max(0, M.sizeT - dt); M.happyT = Math.max(0, M.happyT - dt);
  M.wideT = Math.max(0, M.wideT - dt); M.squintT = Math.max(0, M.squintT - dt);
  if (M.celebrateT >= 0) { M.celebrateT += dt; if (M.celebrateT >= 0.36) M.celebrateT = -1; }
  M.dim += ((M.sad ? 0.6 : 1) - M.dim) * ek(dt, 0.3);
  lid.pop = Math.max(0, lid.pop - dt); lid.jig = Math.max(0, lid.jig - dt);
  if (lid.on && w && w.boil > 0) lid.jig = Math.max(lid.jig, 0.2);
  M.blinkIn -= dt;
  if (M.blinkIn <= 0 && M.blinkT < 0) { M.blinkT = 0; M.blinkIn = 2.5 + rnd() * 2.5; }
  if (M.blinkT >= 0) { M.blinkT += dt; if (M.blinkT > 0.12) M.blinkT = -1; }
  M.lid += (Math.max(M.squintT > 0 ? 0.5 : 0, M.sad ? 0.35 : 0) - M.lid) * ek(dt, 0.06);
  M.happy += ((M.happyT > 0 ? 1 : 0) - M.happy) * ek(dt, 0.04);
  M.wide += ((M.wideT > 0 ? 1 : 0) - M.wide) * ek(dt, 0.05);
  M.worry += ((M.worried && !M.sad ? 1 : 0) - M.worry) * ek(dt, 0.1);
  let lx = 0, ly = M.sad ? 0.6 : 0.25;
  const P = w && w.pot, v = P ? Math.hypot(P.vx || 0, P.vz || 0) : 0;
  if (look) { const L = Math.hypot(look[0], look[1]) || 1; lx = look[0] / L; ly = look[1] / L; }
  else if (v > 0.3) { lx = P.vx / v; ly = P.vz / v; }
  M.lookX += (lx - M.lookX) * ek(dt, 0.1); M.lookY += (ly - M.lookY) * ek(dt, 0.1);
}

// ------------------------------------------------------------------ draw
export function draw() {
  // DECISION (11-04): resolution adapts like render3d (2-s window of frame times: median > 20 ms → −0.125,
  // < 13 ms → +0.125 up to the cap); record / og runs stay at 1.
  if (!ctx) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (lastNow) {
    const ft = now - lastNow;
    if (ft > 0 && ft < 250) { fpsEma = fpsEma ? fpsEma + (1000 / ft - fpsEma) * 0.1 : 1000 / ft; win.push(ft); }
    if (!REC && now - winStart > 2000) {
      if (win.length >= 20) {
        const s = win.slice().sort((a, b) => a - b), med = s[s.length >> 1];
        let nd = dpr;
        if (med > 20) nd = Math.max(DPR_MIN, dpr - DPR_STEP);
        else if (med < 13) nd = Math.min(dprCap(), dpr + DPR_STEP);
        if (nd !== dpr) { dpr = nd; applySize(); }
      }
      win.length = 0; winStart = now;
    }
  } else winStart = now;
  lastNow = now;

  ops = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  // the clear is a full-screen pass: skip it when the baked ground covers the whole view (the usual case)
  const G = ground, vx0 = view.x - cam.ax / ppu, vz0 = view.z - cam.ay / ppu;
  if (!G || vx0 < G.x0 || vz0 < G.z0 || vx0 + cssW / ppu > G.x0 + G.w || vz0 + cssH / ppu > G.z0 + G.h) {
    ctx.fillStyle = BACK[town]; ctx.fillRect(0, 0, canvas.width, canvas.height); ops++;
  }
  const k = dpr * ppu;
  ctx.setTransform(k, 0, 0, k, dpr * (cam.ax - view.x * ppu), dpr * (cam.ay - view.z * ppu));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawGround();
  drawSplats();
  const w = W, belts = (w && w.belts) || (LV && LV.belts) || [];
  drawBelts(belts);
  if (w && !titleOn) drawTelegraphs(w);
  if (!titleOn) drawPot();
  if (w && itemCat) drawItems(w);
  drawHoods(belts);
  if (!titleOn) drawFace();
  if (w && w.gulls) drawGulls(w);
  drawFx();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (wipeT >= 0) drawWipe();
  if (flashA > 0.004) { ctx.fillStyle = 'rgba(255,226,150,' + flashA.toFixed(3) + ')'; ctx.fillRect(0, 0, cssW, cssH); ops++; }
}

function drawGround() {
  const G = ground;
  if (!G) return;
  const vx0 = view.x - cam.ax / ppu, vz0 = view.z - cam.ay / ppu;
  const ax0 = Math.max(vx0, G.x0), az0 = Math.max(vz0, G.z0);
  const ax1 = Math.min(vx0 + cssW / ppu, G.x0 + G.w), az1 = Math.min(vz0 + cssH / ppu, G.z0 + G.h);
  if (ax1 <= ax0 || az1 <= az0) return;
  ctx.drawImage(G.cv, (ax0 - G.x0) * G.upx, (az0 - G.z0) * G.upx, (ax1 - ax0) * G.upx, (az1 - az0) * G.upx, ax0, az0, ax1 - ax0, az1 - az0);
  ops++;
}
function drawSplats() {
  for (const s of splats) {
    ctx.fillStyle = s.col; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(s.x, s.z, s.r, 0, TAU);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + hsh(s.k + k) * 0.8, d = s.r * (0.85 + 0.35 * hsh(s.k + k + 9)), r = s.r * (0.22 + 0.2 * hsh(s.k + k + 3));
      ctx.moveTo(s.x + Math.cos(a) * d + r, s.z + Math.sin(a) * d); ctx.arc(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, r, 0, TAU);
    }
    ctx.fill(); ops++;
  }
  ctx.globalAlpha = 1;
}
function drawBelts(belts) {   // chevrons scroll at |v| along the travel direction (local +x × sign v)
  for (const b of belts) {
    const w = +b.w || 1, d = +b.d || 1, v = b.v != null ? +b.v : 1.2, sg = v < 0 ? -1 : 1, off = ((time * Math.abs(v)) % 0.5) * sg;
    ctx.save(); ctx.translate(+b.x || 0, +b.z || 0); ctx.rotate(-(+b.rot || 0));
    ctx.beginPath(); ctx.rect(-w / 2, -d / 2, w, d); ctx.clip();
    ctx.beginPath();
    for (let u = -w / 2 - 0.5; u < w / 2 + 0.5; u += 0.5) {
      const cx = u + off;
      ctx.moveTo(cx - 0.12 * sg, -d * 0.32); ctx.lineTo(cx + 0.08 * sg, 0); ctx.lineTo(cx - 0.12 * sg, d * 0.32);
    }
    ctx.strokeStyle = '#6B7385'; ctx.lineWidth = 0.08; ctx.stroke(); ops++;
    ctx.restore();
  }
}
function drawHoods(belts) {   // end hoods over the belt mouths (riders pass under them)
  const col = HOOD[town];
  for (const b of belts) {
    const w = +b.w || 1, d = +b.d || 1;
    ctx.save(); ctx.translate(+b.x || 0, +b.z || 0); ctx.rotate(-(+b.rot || 0));
    ctx.fillStyle = col; ctx.strokeStyle = shade(col, -0.4); ctx.lineWidth = 0.05;
    for (const s of [-1, 1]) { rr(ctx, s * (w / 2 - 0.2) - 0.25, -d / 2 - 0.18, 0.5, d + 0.36, 0.14); ctx.fill(); ctx.stroke(); }
    ops += 2;
    ctx.restore();
  }
}
function drawTelegraphs(w) {   // gull target: a pie that fills over the 1.6 s warning, and its ring
  for (const G of w.gulls || []) {
    if (G.st !== 1 || !(G.i >= 0 && G.i < w.n)) continue;
    const R = Math.max(0.5, 1.3 * w.ia[G.i] + 0.2), wn = clamp(+G.warn || 0, 0, 1);
    ctx.fillStyle = 'rgba(232,87,74,0.16)'; disc(ctx, G.tx, G.tz, R); ctx.fill();
    ctx.fillStyle = 'rgba(232,87,74,0.38)'; ctx.beginPath(); ctx.moveTo(G.tx, G.tz); ctx.arc(G.tx, G.tz, R, -PI / 2, -PI / 2 + wn * TAU); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#E8574A'; ctx.lineWidth = Math.max(0.05, 2 / ppu); disc(ctx, G.tx, G.tz, R); ctx.stroke();
    ops += 3;
  }
}

function drawPot() {
  if (!potCv) return;
  const M = mood, rv = pot.rVis;
  const over = M.sizeT > 0 ? 1 + 0.12 * Math.sin(PI * (1 - M.sizeT / 0.2)) : 1;
  let gulp = 1;
  if (M.biteT > 0) { const t = 0.18 - M.biteT; gulp = t < 0.06 ? lerp(1, 0.94, t / 0.06) : t < 0.12 ? lerp(0.94, 1.03, (t - 0.06) / 0.06) : lerp(1.03, 1, (t - 0.12) / 0.06); }
  const R = rv * 1.25 * over * gulp, G = rv * 1.7 * over;
  if (rimCv) { ctx.drawImage(rimCv, pot.x - G, pot.z - G, 2 * G, 2 * G); ops++; }
  ctx.drawImage(potCv, pot.x - R, pot.z - R, 2 * R, 2 * R); ops++;
  // the stew swirls (two light arcs) and dims when the level is lost
  const sr = rv * 0.9 * over * gulp, a = time * 1.6;
  ctx.strokeStyle = 'rgba(255,240,200,0.35)'; ctx.lineWidth = Math.max(1.2 / ppu, 0.07 * rv);
  ctx.beginPath(); ctx.arc(pot.x, pot.z, sr * 0.62, a, a + 1.6); ctx.moveTo(pot.x + Math.cos(a + PI) * sr * 0.32, pot.z + Math.sin(a + PI) * sr * 0.32); ctx.arc(pot.x, pot.z, sr * 0.32, a + PI, a + PI + 1.8);
  ctx.stroke(); ops++;
  if (hotT > 0) { ctx.fillStyle = 'rgba(232,36,18,' + (0.62 * sstep(0, 0.2, hotT)).toFixed(3) + ')'; disc(ctx, pot.x, pot.z, sr); ctx.fill(); ops++; }
  if (M.dim < 0.98) { ctx.fillStyle = 'rgba(30,18,10,' + (0.6 * (1 - M.dim)).toFixed(3) + ')'; disc(ctx, pot.x, pot.z, sr); ctx.fill(); ops++; }
}

function boostOf(K, a, openIng) {   // render3d's readability boost (§7.4, R3): T0 and open-line food ≥ 11 px, T1 × 1.3, under the rim
  const app = a * ppu;
  let b = 1;
  if ((openIng || K.tier === 0) && app < 11) b = Math.min(3.2, 11 / Math.max(app, 1e-3));
  else if (K.tier === 1 && K.food) b = 1.3;
  return b > 1 ? Math.max(1, Math.min(b, 0.8 * pot.rVis / Math.max(1e-3, a))) : 1;
}
function drawItems(w) {
  // DECISION (11-04): items draw in z order (lower on screen = in front) after the pot, which is a hole in the
  // board; the face and lid draw after them, so food never hides the eyes. Off-screen items are culled.
  const n = itemCat.length, st = w.st, hid = w.hid;
  const vx0 = view.x - cam.ax / ppu, vx1 = vx0 + cssW / ppu, vz0 = view.z - cam.ay / ppu, vz1 = vz0 + cssH / ppu;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const s = st[i];
    if ((s === 2 && !finHeld(i, s)) || (hid && hid[i]) || itemCat[i] < 0) continue;
    itemPos(w, i);
    const pad = w.ia[i] * 2.5 + 0.5, x = XS[i], z = ZS[i] - YS[i] * LIFT;
    if (x + pad < vx0 || x - pad > vx1 || z + pad < vz0 || z - pad > vz1 + pad) continue;
    KEY[m++] = Math.round((ZS[i] + 1000) * 64) * 1024 + i;
  }
  const keys = KEY.subarray(0, m);
  keys.sort();
  const Ck = w.cake, ckI = Ck && Ck.i >= 0 && Ck.n > 0 ? Ck.i : -1, mile = !!w.level && isMilestone(w.level.n);
  // pass 1: radii, shadows and halos (under every body)
  for (let k = 0; k < m; k++) {
    const i = keys[k] % 1024, K = KINDS[itemCat[i]], a = w.ia[i], fl = w.flags[i];
    const openIng = !!(fl & F_ING) && w.glow[i] > 0;
    const boss = fl & F_BOSS;
    let R = a * (boss && mile ? bossBoost(a, XS[i], ZS[i], BB) : boostOf(K, a, openIng));
    if (finHeld(i, st[i])) {   // R7: swells to the pot's size whatever the boss's real size, then shrinks to nothing
      const big = fin.B === FIN_BIG, q = finQ(fin.B, fin.t), pop = 1 + 0.16 * Math.sin(PI * sstep(0.12, big ? 0.6 : 0.42, fin.t));
      R *= lerp(1, Math.max(1.25, (big ? 1.25 : 1.05) * pot.rVis / Math.max(1e-3, R)), sstep(0, big ? 0.42 : 0.28, fin.t)) * pop * (1 - 0.94 * q * q);
      RS[i] = R;
      continue;
    }
    if (st[i] === 1) R *= 1 - 0.75 * sstep(0, 1, w.tp[i]);
    if (popT[i] > 0) R *= 1 + 0.3 * Math.sin(PI * (1 - popT[i] / 0.25));
    RS[i] = R;
    if (st[i] === 5) continue;
    if (boss && st[i] !== 1 && (w.glow[i] > 0 || mile)) {   // R4: the boss stands in a pool of light that breathes
      const H = 4.2 * R; ctx.globalAlpha = (w.glow[i] > 0 ? 1 : 0.6) * (0.62 + 0.3 * Math.sin(time * 3.77));
      ctx.drawImage(haloCv, XS[i] - H / 2, ZS[i] - H / 2, H, H); ctx.globalAlpha = 1; ops++;
    }
    const S = 2.3 * (i === ckI ? (+Ck.tiers[Ck.n - 1] || a) * (R / a) : R);
    if (st[i] !== 1) { ctx.drawImage(shadowCv, XS[i] - S / 2 + 0.08 * R, ZS[i] - S / 2 + 0.12 * R, S, S); ops++; }
    if (openIng && st[i] !== 1) {
      const H = Math.max(4 * R, 30 / ppu) * (1 + 0.08 * Math.sin(time * 4 + i));   // ≥ 30 px across
      ctx.drawImage(haloCv, XS[i] - H / 2, ZS[i] - H / 2, H, H); ops++;
    }
  }
  // pass 2: bodies
  const TR = w.truck, trI = TR && TR.i >= 0 ? TR.i : -1;
  if (trI >= 0) { const sx = Math.sin(+TR.ang || 0); if (sx > 0.1) truckFlip = true; else if (sx < -0.1) truckFlip = false; }
  for (let k = 0; k < m; k++) {
    const i = keys[k] % 1024;
    drawBody(w, i, i === ckI, i === trI);
  }
  if (titleOn) return;
  // pass 3: markers. White ring = edible now (within 3 r); gold ring = open boss; padlock = locked boss;
  // dashed ring = gate.
  ctx.beginPath();
  let nE = 0;
  for (let k = 0; k < m; k++) {
    const i = keys[k] % 1024, s = st[i];
    if (s === 1 || s === 5 || w.flags[i] & (F_BOSS | F_HOT)) continue;   // R7: a chili goes down but is no invitation
    const x = XS[i], z = ZS[i];
    if (Math.hypot(x - pot.x, z - pot.z) >= 3 * pot.r || !edible(w, i)) continue;
    const r = RS[i] + 2.5 / ppu;
    ctx.moveTo(x + r, z); ctx.arc(x, z, r, 0, TAU); nE++;
  }
  if (nE) { ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2 / ppu; ctx.stroke(); ops++; }
  for (let k = 0; k < m; k++) {
    const i = keys[k] % 1024, fl = w.flags[i], s = st[i];
    if (s === 1 || s === 2 || s === 5) continue;
    const x = XS[i], z = ZS[i], a = w.ia[i];
    if (KINDS[itemCat[i]].id === 'chili') {   // R7: a thin warm hazard ring with an ink edge
      const r = Math.max(1.55 * RS[i], 13 / ppu);
      ctx.strokeStyle = 'rgba(58,36,24,0.5)'; ctx.lineWidth = 4.5 / ppu; disc(ctx, x, z, r); ctx.stroke();
      ctx.strokeStyle = '#FF5C1A'; ctx.lineWidth = 2.5 / ppu; disc(ctx, x, z, r); ctx.stroke(); ops += 2;
    }
    if (fl & F_BOSS) {
      if (w.glow[i] > 0) {
        ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = Math.max(3 / ppu, 0.06 * a);
        disc(ctx, x, z, 1.12 * RS[i] * (1 + 0.03 * Math.sin(time * 3.77))); ctx.stroke(); ops++;
      } else drawPadlock(x + (rattleT[i] > 0 ? Math.sin(time * 60) * 0.05 * a : 0), z - 0.25 * a, Math.max(28 / ppu, 0.42 * a));
    } else if (fl & F_GATE) {
      ctx.save(); ctx.setLineDash([0.18, 0.12]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1.5 / ppu, 0.04);
      disc(ctx, x, z, 1.15 * a); ctx.stroke(); ctx.restore(); ops++;
    }
  }
  if (bossRing) {
    const t = bossRing.t / 0.6;
    ctx.strokeStyle = 'rgba(255,226,122,' + (1 - t).toFixed(3) + ')'; ctx.lineWidth = Math.max(3 / ppu, 0.1);
    disc(ctx, bossRing.x, bossRing.z, bossRing.R * (0.6 + 1.2 * t)); ctx.stroke(); ops++;
  }
}

function drawBody(w, i, isCake, isTruck) {
  const K = KINDS[itemCat[i]], a = w.ia[i], s = w.st[i], R = RS[i];
  let x = XS[i], z = ZS[i] - YS[i] * LIFT;
  const finI = finHeld(i, s);
  if (finI) {   // R7: pulled in along a tightening spiral (ctx rotation below spins it)
    const q = finQ(fin.B, fin.t), ang = fin.ang + TAU * 1.6 * q * q, rad = 0.42 * pot.rVis * (1 - q), inP = sstep(0, fin.B === FIN_BIG ? 0.42 : 0.28, fin.t);
    x = lerp(x, pot.x + Math.sin(ang) * rad, inP); z = lerp(z, pot.z + Math.cos(ang) * rad, inP);
    if (fin.B === FIN_BIG && !calm && fin.t > 0.8 && fin.t < fin.B.boom) x += Math.sin(fin.t * 34) * 0.05 * R;   // the pot strains on it
  } else if (s === 1) { const t = 0.8 * sstep(0, 1, w.tp[i]); x = lerp(x, pot.x, t); z = lerp(z, pot.z, t); ctx.globalAlpha = 1 - 0.5 * w.tp[i]; }
  // jitter: boss rattle, wobble, the fragile shiver (a 0.5 s tremble every 2.5 s)
  if (rattleT[i] > 0) x += Math.sin(time * 60) * 0.05 * a * (rattleT[i] / 0.4);
  if (wobT[i] > 0) x += Math.sin(time * 30) * 0.08 * a * (wobT[i] / 0.4);
  if (w.flags[i] & F_FRAGILE && !(w.cracked && w.cracked[i]) && (time + i * 0.37) % 2.5 < 0.5) x += Math.sin(time * 50) * 0.02 * a;
  if (isCake) drawCake(w.cake, x, z, R / Math.max(1e-4, a));
  else {
    const shape = SHAPE[K.id] || 'disc', e = K.icon ? art(K.icon) : null;
    let rot = TURNS.has(shape) && !(e && e.ok) ? itemRot[i] : 0;
    if (K.roll) rot += rollA[i];
    if (finI) { const q = finQ(fin.B, fin.t), sp = fin.B === FIN_BIG ? sstep(0.5, 1, q) : q; rot += TAU * 1.6 * sp * sp; }   // a flat sprite stays upright through the hold
    if (e && e.ok) {
      const L = 2.1 * R, mx = Math.max(e.sw, e.sh), dw = L * e.sw / mx, dh = L * e.sh / mx;
      if (isTruck) {
        const q = truckSq / 0.3;
        ctx.save(); ctx.translate(x, z); ctx.scale((truckFlip ? -1 : 1) * (1 + 0.12 * q), 1 - 0.12 * q);
        ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, -dw / 2, -dh / 2, dw, dh); ctx.restore();
      } else if (rot) {
        ctx.save(); ctx.translate(x, z); ctx.rotate(rot);
        ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, -dw / 2, -dh / 2, dw, dh); ctx.restore();
      } else ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, x - dw / 2, z - dh / 2, dw, dh);
    } else {
      const S = 2 * R / 0.92, cv = toy(itemCat[i]);
      if (rot) { ctx.save(); ctx.translate(x, z); ctx.rotate(-rot); ctx.drawImage(cv, -S / 2, -S / 2, S, S); ctx.restore(); }
      else ctx.drawImage(cv, x - S / 2, z - S / 2, S, S);
    }
    ops++;
    if (K.id === 'chili') {   // R7: the flame at the tip, flickering
      const f = 1 + 0.18 * Math.sin(time * 15 + i * 2.1), fx = x + 0.5 * R + 0.05 * R * Math.sin(time * 21 + i), fz = z - 0.42 * R, h = 0.6 * R * f;
      for (const [c, k] of [['#FF7A1A', 1], ['#FFD23F', 0.58]]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(fx - 0.24 * R * k, fz); ctx.quadraticCurveTo(fx - 0.24 * R * k, fz - 0.45 * h * k, fx, fz - h * k); ctx.quadraticCurveTo(fx + 0.24 * R * k, fz - 0.45 * h * k, fx + 0.24 * R * k, fz); ctx.quadraticCurveTo(fx, fz + 0.2 * R * k, fx - 0.24 * R * k, fz); ctx.fill();
      }
      ops += 2;
    }
    // stack contents ride on top until the stack cracks
    const so = w.stackOf && w.stackOf[i];
    if (so && so.length && !(w.cracked && w.cracked[i])) {
      const nS = Math.min(4, so.length);
      for (let j = 0; j < nS; j++) {
        const c2 = KIND_ID[so[j]], K2 = c2 !== undefined ? KINDS[c2] : null;
        if (!K2) continue;
        const R2 = Math.max(3 / ppu, K2.a * (R / Math.max(1e-4, a))), an = j * TAU / nS + 0.6, rd = nS > 1 ? 0.38 * R : 0;
        const px = x + Math.cos(an) * rd, pz = z + Math.sin(an) * rd - 0.1 * R, e2 = K2.icon ? art(K2.icon) : null;
        if (e2 && e2.ok) { const L = 2.1 * R2, mx = Math.max(e2.sw, e2.sh); ctx.drawImage(e2.img, e2.sx, e2.sy, e2.sw, e2.sh, px - L * e2.sw / mx / 2, pz - L * e2.sh / mx / 2, L * e2.sw / mx, L * e2.sh / mx); }
        else { const S = 2 * R2 / 0.92; ctx.drawImage(toy(c2), px - S / 2, pz - S / 2, S, S); }
        ops++;
      }
    }
  }
  ctx.globalAlpha = 1;
}
function drawCake(C, x, z, k) {
  // DECISION (11-04): the cake draws its remaining tiers as stacked discs (bottom = widest, each tier 0.22 u higher
  // on screen, a dotted frill on each rim) with a cherry on the top one, instead of its art, so eating a tier
  // visibly shrinks it.
  const lw = Math.max(1.5 / ppu, 0.05 * k);
  for (let t = C.n - 1; t >= C.tier; t--) {
    const lv = C.n - 1 - t, r = (+C.tiers[t] || 1) * k * 0.95, cz = z - lv * 0.22 * k, col = lv % 2 ? '#FFB3C7' : '#FFF6E3';
    ctx.fillStyle = 'rgba(40,22,10,0.18)'; disc(ctx, x + 0.04 * r, cz + 0.08 * r, r); ctx.fill();
    ctx.fillStyle = col; disc(ctx, x, cz, r); ctx.fill();
    ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = lw; ctx.stroke();
    const m = Math.max(10, Math.round(r * 9)), fr = Math.max(1.2 / ppu, 0.07 * r);
    ctx.fillStyle = lv % 2 ? '#FFFFFF' : '#FF9EC4'; ctx.beginPath();
    for (let j = 0; j < m; j++) { const a = (j / m) * TAU, px = x + Math.cos(a) * r * 0.9, py = cz + Math.sin(a) * r * 0.9; ctx.moveTo(px + fr, py); ctx.arc(px, py, fr, 0, TAU); }
    ctx.fill();
    ops += 4;
  }
  const top = (+C.tiers[C.tier] || 1) * k, cz = z - (C.n - 1 - C.tier) * 0.22 * k;
  ctx.fillStyle = '#D8263B'; disc(ctx, x, cz, Math.max(3 / ppu, 0.16 * top)); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; disc(ctx, x - 0.05 * top, cz - 0.05 * top, Math.max(1 / ppu, 0.05 * top)); ctx.fill();
  ops += 2;
}
function drawPadlock(x, z, sz) {
  if (padArt && padArt.ok) {
    const e = padArt, mx = Math.max(e.sw, e.sh);
    ctx.drawImage(e.img, e.sx, e.sy, e.sw, e.sh, x - sz * e.sw / mx / 2, z - sz * e.sh / mx / 2, sz * e.sw / mx, sz * e.sh / mx);
  } else {
    ctx.strokeStyle = '#7A5A1A'; ctx.lineWidth = sz * 0.12; ctx.beginPath(); ctx.arc(x, z - sz * 0.1, sz * 0.25, PI, 0); ctx.stroke();
    ctx.fillStyle = '#F5B323'; rr(ctx, x - sz * 0.38, z - sz * 0.1, sz * 0.76, sz * 0.55, sz * 0.1); ctx.fill();
  }
  ops++;
}

function drawFace() {
  // DECISION (11-04): eyes sit on the upper half of the stew (±0.32 r, −0.3 r), sclera radius
  // max(0.2 r, 4.5 px) capped at 0.3 r (render3d's rule, so L1's tiny pot still has a face); pupils look at the
  // render3d look target, else along the pot's motion. Happy = ^^ arcs; squint / sad / blink close the lids.
  const M = mood, rv = pot.rVis;
  let hop = 0.015 * pot.r * Math.sin(TAU * 0.9 * time);
  if (M.celebrateT >= 0) { const t = M.celebrateT; hop += 0.22 * rv * Math.abs(Math.sin(PI * t / 0.12)) * (1 - t / 0.45); }
  const S = Math.min(Math.max(0.2 * rv, 4.5 / ppu), 0.3 * rv) * (1 + 0.2 * M.wide);
  const sep = Math.max(0.32 * rv, 1.08 * S), ey = pot.z - 0.3 * rv - hop * LIFT * 2;
  const jit = M.worry > 0.05 ? 0.06 * M.worry * S : 0;
  const blink = M.blinkT >= 0 ? (M.blinkT < 0.06 ? M.blinkT / 0.06 : 1 - (M.blinkT - 0.06) / 0.06) : 0;
  const shut = Math.min(1, Math.max(M.lid, blink));
  const ink = '#2A1A12';
  for (const side of [-1, 1]) {
    const ex = pot.x + side * sep;
    if (M.happy > 0.5) {
      ctx.strokeStyle = ink; ctx.lineWidth = 0.42 * S;
      ctx.beginPath(); ctx.arc(ex, ey + 0.35 * S, 0.75 * S, PI * 1.15, PI * 1.85); ctx.stroke(); ops++;
      continue;
    }
    const ry = S * (1 - 0.85 * shut);
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1 / ppu, 0.16 * S);
    ctx.beginPath(); ctx.ellipse(ex, ey + (S - ry) * 0.5, S, Math.max(ry, 0.08 * S), 0, 0, TAU); ctx.fill(); ctx.stroke();
    if (ry > 0.3 * S) {
      const pr = S * 0.5 * (1 - 0.3 * M.wide), off = S - pr - 0.12 * S;
      const px = ex + M.lookX * off + (rnd() * 2 - 1) * jit, py = ey + (S - ry) * 0.5 + M.lookY * off * (ry / S) + (rnd() * 2 - 1) * jit;
      ctx.fillStyle = ink; disc(ctx, px, py, pr); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; disc(ctx, px - 0.3 * pr, py - 0.35 * pr, 0.3 * pr); ctx.fill();
    }
    ops += 2;
  }
  if (lid.on) {   // the Simmer lid hat on the back rim: pops on, jiggles on refusals
    const p = 1 - lid.pop / 0.3, ps = lid.pop > 0 ? (p < 0.7 ? (p / 0.7) * 1.15 : 1.15 - 0.15 * ((p - 0.7) / 0.3)) : 1;
    const j = Math.sin(time * 55) * 0.06 * (lid.jig / 0.35), col = shade(LID[skin], -0.15);
    ctx.save(); ctx.translate(pot.x, pot.z - 1.02 * rv - Math.abs(j) * rv); ctx.rotate(j); ctx.scale(ps, ps);
    ctx.fillStyle = col; ctx.strokeStyle = shade(col, -0.45); ctx.lineWidth = Math.max(1 / ppu, 0.05 * rv);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.78 * rv, 0.3 * rv, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = shade(col, 0.3); ctx.beginPath(); ctx.ellipse(0, -0.18 * rv, 0.16 * rv, 0.1 * rv, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore(); ops += 2;
  }
}

function drawGulls(w) {
  // DECISION (11-04): gulls are flat shapes (white body, grey wings with dark tips, orange beak, no eyes: D33),
  // drawn G.y·LIFT up the screen over a ground shadow; wings flap except while perched.
  const sc = Math.max(1, 26 / (0.62 * ppu));   // ≥ 26 px nose to tail
  for (const G of w.gulls) {
    const y = +G.y || 0, x = G.x, z = G.z - y * LIFT, h = +G.h || 0, ang = Math.atan2(Math.cos(h), Math.sin(h));
    ctx.fillStyle = 'rgba(40,22,10,' + (0.22 * clamp(1 - y / 8, 0.3, 1)).toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(G.x, G.z, 0.3 * sc, 0.18 * sc, 0, 0, TAU); ctx.fill();
    const flap = G.st === 0 ? 0.25 : 0.35 + 0.65 * Math.abs(Math.sin(time * 9 + (G.i | 0)));
    ctx.save(); ctx.translate(x, z); ctx.rotate(ang); ctx.scale(sc, sc);
    ctx.lineWidth = 0.03; ctx.strokeStyle = '#8A93A3';
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#E8EDF2'; ctx.beginPath(); ctx.ellipse(-0.02, s * 0.2 * flap, 0.13, 0.24 * flap + 0.02, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4A5160'; ctx.beginPath(); ctx.ellipse(-0.06, s * 0.4 * flap, 0.07, 0.07 * flap + 0.02, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(0, 0, 0.3, 0.12, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.26, 0); ctx.lineTo(-0.4, -0.08); ctx.lineTo(-0.4, 0.08); ctx.closePath(); ctx.fill(); ctx.stroke();
    disc(ctx, 0.25, 0, 0.1); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFB13B'; ctx.beginPath(); ctx.moveTo(0.33, -0.04); ctx.lineTo(0.45, 0); ctx.lineTo(0.33, 0.04); ctx.closePath(); ctx.fill();
    ctx.restore();
    ops += 6;
  }
}

function drawFx() {
  for (let i = 0; i < FXN; i++) {
    if (fLife[i] <= 0) continue;
    const lf = fLife[i] / fL0[i], s = Math.max(2.5 / ppu, fSz[i] * (1 + fGrow[i] * (1 - lf)));
    const x = fP[i * 3], y = fP[i * 3 + 2] - fP[i * 3 + 1] * LIFT, sh = fShape[i];
    ctx.globalAlpha = fA[i] * Math.min(1, lf * 4); ctx.fillStyle = fCol[i];
    if (sh === 4 || sh === 3) { disc(ctx, x, y, sh === 4 ? s : 0.6 * s); ctx.fill(); }
    else if (sh === 2) { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + 0.6 * s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - 0.6 * s, y); ctx.closePath(); ctx.fill(); }
    else ctx.fillRect(x - s / 2, y - s / 2, s, s);
    ops++;
  }
  ctx.globalAlpha = 1;
}
function drawWipe() {   // Feast steam wipe: a cream band sweeps left → right in 0.6 s (render3d's timing)
  const t = wipeT, sx = (c) => ((c + 1) / 2) * cssW;
  const x0 = Math.max(0, sx(-2 + 7.8 * Math.max(t - 0.5, 0))), x1 = Math.min(cssW, sx(-2 + 7.8 * Math.min(t, 0.5)));
  if (x1 <= x0) return;
  const gr = ctx.createLinearGradient(0, 0, 0, cssH);
  gr.addColorStop(0, '#EDE3D6'); gr.addColorStop(1, '#FFFAF2');
  ctx.fillStyle = gr; ctx.fillRect(x0, 0, x1 - x0, cssH);
  const R = 0.07 * Math.max(cssW, cssH);
  ctx.beginPath();
  for (let k = 0; k <= 12; k++) {
    const y = (k / 12) * cssH;
    if (x1 < cssW) { const px = x1 + Math.sin(k * 1.7 + time * 6) * 0.25 * R; ctx.moveTo(px + R, y); ctx.arc(px, y, R, 0, TAU); }
    if (x0 > 0) { const px = x0 + Math.sin(k * 2.3 + time * 5) * 0.25 * R; ctx.moveTo(px + R, y); ctx.arc(px, y, R, 0, TAU); }
  }
  ctx.fill(); ops += 2;
}
