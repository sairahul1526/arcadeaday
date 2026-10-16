// ui.js: Knot Kitty UI (GDD §9, §10, §11, §13.6). Owner: UI role.
// HUD, booster buttons, the one callout slot, every §9.4 screen and card, the map, and the tutorial director (hand,
// ghost move, attention rings, booster fly-ins). All canvas-drawn. Reads meta getters, calls api + meta actions, owns
// S.ui, never mutates S.sess.
//
// DECISION: immediate-mode buttons. Each frame's draw registers {id,x,y,w,h,label,primary,disabled,act} and S.ui.btns
//   is that list (modes.js __qaInput scans it). Hit rects grow to ≥ 44×44 CSS px around the drawn shape (§7.6).
// DECISION: menu unit du = clamp(portrait/square: min(W/390, H/700); landscape: min(W/700, H/520), 0.55, 2.6). Every
//   text is fitted (shrinks to its box, then wraps to 2 lines) and each stack of rows shrinks as a whole when the screen
//   is short, so nothing overlaps or clips from 320×480 to 3840×2160.
// DECISION: shop / kittens / settings / daily are dialogs drawn over the screen they were opened from (title, map or
//   allbeaten); ✕ / CLOSE / Esc go back there with api.go(prev).
// DECISION: win card (portrait/square) spans from the rack top down to just above the freed kitten's head, so the happy
//   kitten stays visible ("bottom 55 %" in §9.4 would cover it); landscape uses the right column. Out of Room card:
//   portrait starts at the callout band (compact) so the HUD, rack (spool colours) and basket stay visible; landscape sits
//   in the right column between the rack and the basket row.
// DECISION: Win / Out of Room cards open from showCard (Core), or by themselves when S.screen becomes 'win'/'lose', or
//   DUR.kittenFree / DUR.stuckCard after bus 'win'/'stuck' (fallback). showCard is idempotent.
// DECISION: gift / chest / booster-unlock cards come from result.gifts (plus any showCard calls, de-duplicated) and play
//   one at a time after a win-card button; that button's action (next / replay / map) runs after the last card.
// DECISION: boosters: tap with stock → api.useBooster(k); with 0 stock → meta.buyBooster(k) (+ bus 'buy') then
//   api.useBooster(k); too few balls → callout "Not enough yarn balls". Out of Room Undo / +1 Slot use the same path,
//   then api.resume() if the screen is still 'lose'.
// DECISION: each booster is introduced once per save (tut flag 'b_<k>'): at the first level start after it unlocks its
//   gift icons fly into its button, then one callout (L4: "Undo takes back a pull").
// DECISION: the NEXT-spool "bounce" (L3, L4) is a gold attention ring UI draws at rackSlots().next[0].
// DECISION: celebratory pops (CHAIN ×m!, +n) draw at the spool and hide the band callout while they show (0.9 s).
// DECISION: L3 "CHAIN!" pops on the first spool that arrives while a ball of its colour waits in the basket.
// DECISION: map: the yarn-ball count opens the shop; ↑/↓ keys move the selection; the wheel listener calls
//   preventDefault only while the map can still scroll that way. Locked nodes say "Beat level N first".
// DECISION: settings sliders/toggle emit bus 'settings' {k, v} (meta.setSetting has no event) so Audio can apply them
//   live; win-card stars emit bus 'star' {i} as each one pops.
// DECISION: the locked Daily dialog shows "Beat level 6 to unlock" with an OK primary. Reset progress = two taps within 3 s.
// DECISION: Esc in play opens pause; Esc on win/lose (and their gift cards) does nothing; Enter/Space press the screen's
//   primary button. ui.key never calls preventDefault.
// DECISION: art helpers are called through guarded wrappers; a missing or throwing export falls back to a simple local
//   drawing (warned once) so the UI never breaks the frame.
import P from '../shared/platform.js';
import { bus, LEVELS, PER_WORLD, BOOSTERS, OUTFITS, WORLDS, TEACH, IDLE_HINT, DUR, worldOf } from './consts.js';
import { computeLayout, rackSlots, basketSlots, boosterRects } from './layout.js';
import * as R from './render.js';
import * as SC from './scene.js';
import * as M from './meta.js';
import * as LV from './levels.js';

// ---------- style ----------
const INK = '#2B2440', CREAM = '#FFF4E4', STITCH = '#E9D3B5', SHADE = '#D9BF9C', TOMATO = '#E8463A', TOMATO_D = '#B8322A';
const TEAL = '#1FB0A0', TEAL_D = '#167C71', GOLD = '#FFC93C', GOLD_D = '#B9811A', AMBER = '#FFB23F', GREY = '#B9B2AE';
const FT = '"Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
const FB = 'Nunito, system-ui, sans-serif';
const YCOL = ['#E8463A', '#1FB0A0', '#F5B82E', '#3D86EE', '#8C55D3', '#86C440', '#E8463A'];
const BK = ['undo', 'hint', 'slot', 'snip'];
const BNAME = { undo: 'Undo', hint: 'Hint', slot: '+1 Slot', snip: 'Snip' };
const BDESC = { undo: 'Takes back your last pull', hint: 'Shows a good next move', slot: 'One more basket space (max 2★)',
  snip: 'Pull any strand, even covered (max 2★)' };
const BTEACH = { undo: 'Undo takes back a pull', hint: 'Hint shows a good move', slot: '+1 Slot adds a basket space',
  snip: 'Snip pulls any strand' };
const TEACH_LINE = { knot: 'Tied together: they go as one', lock: 'Pull the key strand to unlock',
  mystery: 'Grey yarn shows its colour on top', paw: 'Wait for the paw: pull N others first', rainbow: 'Rainbow fits any spool',
  jumbo: 'Big spool: 6 strands', ice: 'Ice slot thaws after 2 spools' };
const BOSS_SHAPE = { 10: 'cathead', 20: 'pumpkin', 30: 'heart', 40: 'moon', 50: 'star', 60: 'kitten' };
const DIALOGS = ['shop', 'kittens', 'settings', 'daily'];
const HOMES = ['title', 'map', 'allbeaten'];

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const e3 = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const eBack = t => { t = clamp(t, 0, 1) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };
const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
const breedOf = id => (id - 1) % 6, coatOf = id => Math.floor((id - 1) / 6);
const hasVibrate = () => P.env === 'web' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function setFont(g, size, f = FT, w = '') { g.font = (w ? w + ' ' : '') + Math.max(1, size).toFixed(2) + 'px ' + f; }
function tw(g, s, size, f = FT, w = '') { setFont(g, size, f, w); return g.measureText(s).width; }
function fitSize(g, s, maxW, size, f = FT, w = '', strokeK = 0) {
  if (maxW <= 0) return 1;
  for (let i = 0; i < 3; i++) {
    const m = tw(g, s, size, f, w) + size * strokeK;
    if (m <= maxW) break;
    size *= maxW / m;
  }
  return size;
}
/** Text drawn centred on (x, y). o: { f, w, col, stroke, sk (stroke width / size), align, maxW, base }. Returns size. */
function txt(g, s, x, y, size, o = {}) {
  const f = o.f || FT, w = o.w || '', sk = o.stroke ? (o.sk || 0.2) : 0;
  if (o.maxW) size = fitSize(g, s, o.maxW, size, f, w, sk);
  setFont(g, size, f, w);
  g.textAlign = o.align || 'center';
  g.textBaseline = o.base || 'middle';
  if (o.stroke) {
    g.lineJoin = 'round'; g.miterLimit = 2;
    g.lineWidth = size * sk;
    g.strokeStyle = o.stroke;
    g.strokeText(s, x, y);
  }
  g.fillStyle = o.col || INK;
  g.fillText(s, x, y);
  return size;
}
/** One line if it fits at ≥ min, else the best 2-line split; never clips (shrinks below min as a last resort). */
function wrapFit(g, s, maxW, maxH, size, min, f = FB, w = '800', lh = 1.14) {
  const s1 = Math.min(fitSize(g, s, maxW, size, f, w), maxH / lh);
  if (s1 >= min || !s.includes(' ')) return { lines: [s], size: s1 };
  const words = s.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const m = Math.max(tw(g, a, size, f, w), tw(g, b, size, f, w));
    if (!best || m < best.m) best = { a, b, m };
  }
  const s2 = Math.min(size, size * maxW / best.m, maxH / (2 * lh));
  return s2 > s1 ? { lines: [best.a, best.b], size: s2 } : { lines: [s], size: s1 };
}
function lines(g, wf, x, cy, o = {}) {
  const lh = wf.size * 1.14, y0 = cy - (wf.lines.length - 1) * lh / 2;
  wf.lines.forEach((l, i) => txt(g, l, x, y0 + i * lh, wf.size, { f: FB, w: '800', ...o }));
}
/** Felt-patch panel (§7.7). */
function panel(g, x, y, w, h, d, o = {}) {
  const r = Math.min(18 * d, w / 2, h / 2);
  g.fillStyle = 'rgba(43,36,64,0.28)';
  rr(g, x + 2 * d, y + 5 * d, w, h, r); g.fill();
  rr(g, x, y, w, h, r);
  g.fillStyle = o.fill || CREAM; g.fill();
  g.lineWidth = Math.max(1.5, 3 * d); g.strokeStyle = o.line || INK; g.stroke();
  const ins = 7 * d;
  if (w > 5 * ins && h > 5 * ins) {
    g.save();
    g.setLineDash([6 * d, 5 * d]);
    g.lineWidth = Math.max(1, 1.6 * d);
    g.strokeStyle = o.stitch || STITCH;
    rr(g, x + ins, y + ins, w - 2 * ins, h - 2 * ins, Math.max(2, r - ins)); g.stroke();
    g.restore();
  }
}
function dim(g, S, a) { g.fillStyle = `rgba(43,36,64,${a})`; g.fillRect(0, 0, S.W, S.H); }

// ---------- guarded art helpers (render.js / scene.js), with local fallbacks ----------
const bad = new Set();
function art(mod, name, fb) {
  return (g, ...a) => {
    const f = mod && mod[name];
    if (typeof f === 'function' && !bad.has(name)) {
      g.save();
      try { return f(g, ...a); } catch (e) { bad.add(name); console.warn('[ui] ' + name + ' failed; using a fallback', e); } finally { g.restore(); }
    }
    g.save();
    try { return fb(g, ...a); } finally { g.restore(); }
  };
}
function fbStar(g, x, y, r, on, rot = 0) {
  g.translate(x, y); g.rotate(rot);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.5 : r;
    g.lineTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  g.closePath();
  g.fillStyle = on ? GOLD : 'rgba(43,36,64,0.18)'; g.fill();
  g.lineJoin = 'round'; g.lineWidth = Math.max(1.2, r * 0.16); g.strokeStyle = on ? GOLD_D : 'rgba(43,36,64,0.45)'; g.stroke();
  if (on) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(-r * 0.2, -r * 0.22, r * 0.17, 0, 7); g.fill(); }
}
function fbHand(g, x, y, s, press) {
  g.translate(x, y); g.rotate(-0.35);
  const p = press ? 0.88 : 1; g.scale(p, p);
  if (press) { g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, s * 0.55, 0, 7); g.stroke(); }
  g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = Math.max(2, s * 0.08); g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-s * 0.12, 0); g.lineTo(-s * 0.12, s * 0.75);
  g.quadraticCurveTo(-s * 0.4, s * 0.62, -s * 0.42, s * 0.85);
  g.quadraticCurveTo(-s * 0.3, s * 1.25, s * 0.05, s * 1.45);
  g.lineTo(s * 0.48, s * 1.45);
  g.quadraticCurveTo(s * 0.62, s * 1.1, s * 0.6, s * 0.78);
  g.lineTo(s * 0.6, s * 0.62);
  g.quadraticCurveTo(s * 0.45, s * 0.5, s * 0.3, s * 0.6);
  g.quadraticCurveTo(s * 0.22, s * 0.46, s * 0.1, s * 0.55);
  g.lineTo(s * 0.12, 0);
  g.quadraticCurveTo(0, -s * 0.12, -s * 0.12, 0);
  g.closePath(); g.fill(); g.stroke();
}
function fbIcon(g, name, x, y, s, col = INK) {
  g.translate(x, y);
  const k = s / 2;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1.5, s * 0.12); g.lineCap = 'round'; g.lineJoin = 'round';
  const tri = (ax, ay, bx, by, cx, cy) => { g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.closePath(); g.fill(); };
  g.beginPath();
  switch (name) {
    case 'pause': rr(g, -k * 0.55, -k * 0.62, k * 0.38, k * 1.24, k * 0.1); g.fill(); rr(g, k * 0.17, -k * 0.62, k * 0.38, k * 1.24, k * 0.1); g.fill(); break;
    case 'retry': g.arc(0, 0, k * 0.58, -Math.PI * 0.25, Math.PI * 1.35); g.stroke();
      tri(k * 0.62, -k * 0.62, k * 0.66, -k * 0.05, k * 0.1, -k * 0.3); break;
    case 'undo': g.moveTo(k * 0.62, k * 0.6); g.quadraticCurveTo(k * 0.66, -k * 0.22, -k * 0.2, -k * 0.22); g.stroke();
      tri(-k * 0.72, -k * 0.22, -k * 0.18, -k * 0.62, -k * 0.18, k * 0.18); break;
    case 'hint': g.arc(0, -k * 0.18, k * 0.48, 0, 7); g.fillStyle = GOLD; g.fill(); g.stroke();
      g.fillStyle = col; rr(g, -k * 0.24, k * 0.34, k * 0.48, k * 0.36, k * 0.08); g.fill(); break;
    case 'slot': g.moveTo(-k * 0.7, -k * 0.05); g.lineTo(k * 0.7, -k * 0.05); g.lineTo(k * 0.5, k * 0.65); g.lineTo(-k * 0.5, k * 0.65); g.closePath();
      g.fillStyle = '#C98B4E'; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(0, -k * 0.85); g.lineTo(0, -k * 0.3); g.moveTo(-k * 0.28, -k * 0.58); g.lineTo(k * 0.28, -k * 0.58); g.stroke(); break;
    case 'snip': g.arc(-k * 0.38, k * 0.42, k * 0.24, 0, 7); g.moveTo(k * 0.62, k * 0.42); g.arc(k * 0.38, k * 0.42, k * 0.24, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(-k * 0.22, k * 0.22); g.lineTo(k * 0.5, -k * 0.7); g.moveTo(k * 0.22, k * 0.22); g.lineTo(-k * 0.5, -k * 0.7); g.stroke(); break;
    case 'star': fbStar(g, 0, 0, k * 0.85, true); break;
    case 'ball': g.arc(0, 0, k * 0.72, 0, 7); g.fillStyle = TOMATO; g.fill(); g.lineWidth = Math.max(1.2, s * 0.08); g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = Math.max(1, s * 0.06);
      g.arc(-k * 0.3, k * 0.1, k * 0.6, -1.2, 0.6); g.moveTo(k * 0.55, -k * 0.2); g.arc(k * 0.1, k * 0.25, k * 0.55, -0.9, -2.4, true); g.stroke(); break;
    case 'gear': for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); rr(g, -k * 0.14, -k * 0.82, k * 0.28, k * 0.4, k * 0.06); g.fill(); g.restore(); }
      g.beginPath(); g.arc(0, 0, k * 0.56, 0, 7); g.fill(); g.beginPath(); g.fillStyle = CREAM; g.arc(0, 0, k * 0.22, 0, 7); g.fill(); break;
    case 'cart': g.moveTo(-k * 0.8, -k * 0.6); g.lineTo(-k * 0.5, -k * 0.6); g.lineTo(-k * 0.3, k * 0.3); g.lineTo(k * 0.6, k * 0.3); g.lineTo(k * 0.75, -k * 0.35); g.lineTo(-k * 0.42, -k * 0.35); g.stroke();
      g.beginPath(); g.arc(-k * 0.2, k * 0.6, k * 0.14, 0, 7); g.arc(k * 0.48, k * 0.6, k * 0.14, 0, 7); g.fill(); break;
    case 'paw': g.ellipse(0, k * 0.25, k * 0.38, k * 0.32, 0, 0, 7); g.fill();
      for (const [px, py] of [[-0.55, -0.15], [-0.2, -0.5], [0.2, -0.5], [0.55, -0.15]]) { g.beginPath(); g.ellipse(px * k, py * k, k * 0.15, k * 0.19, 0, 0, 7); g.fill(); } break;
    case 'calendar': rr(g, -k * 0.7, -k * 0.55, k * 1.4, k * 1.25, k * 0.18); g.stroke(); g.fillRect(-k * 0.7, -k * 0.55, k * 1.4, k * 0.38);
      g.beginPath(); g.moveTo(-k * 0.35, -k * 0.85); g.lineTo(-k * 0.35, -k * 0.45); g.moveTo(k * 0.35, -k * 0.85); g.lineTo(k * 0.35, -k * 0.45); g.stroke();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.fillRect(-k * 0.45 + i * k * 0.35, k * 0.05 + j * k * 0.3, k * 0.18, k * 0.16); break;
    case 'share': { const p = [[k * 0.45, -k * 0.5], [-k * 0.45, 0], [k * 0.45, k * 0.5]]; g.moveTo(...p[0]); g.lineTo(...p[1]); g.lineTo(...p[2]); g.stroke();
      for (const q of p) { g.beginPath(); g.arc(q[0], q[1], k * 0.22, 0, 7); g.fill(); } break; }
    case 'lock': rr(g, -k * 0.55, -k * 0.1, k * 1.1, k * 0.85, k * 0.15); g.fill();
      g.beginPath(); g.arc(0, -k * 0.12, k * 0.34, Math.PI, 0); g.lineTo(k * 0.34, 0); g.moveTo(-k * 0.34, 0); g.lineTo(-k * 0.34, -k * 0.12); g.stroke(); break;
    case 'close': g.moveTo(-k * 0.5, -k * 0.5); g.lineTo(k * 0.5, k * 0.5); g.moveTo(k * 0.5, -k * 0.5); g.lineTo(-k * 0.5, k * 0.5); g.stroke(); break;
    case 'home': g.moveTo(-k * 0.75, -k * 0.02); g.lineTo(0, -k * 0.72); g.lineTo(k * 0.75, -k * 0.02); g.stroke();
      g.beginPath(); g.moveTo(-k * 0.5, -k * 0.15); g.lineTo(-k * 0.5, k * 0.65); g.lineTo(k * 0.5, k * 0.65); g.lineTo(k * 0.5, -k * 0.15); g.stroke(); break;
    default: g.arc(0, 0, k * 0.5, 0, 7); g.fill();
  }
}
function fbMiniBoard(g, rect, level, t) {
  const cols = (level && level.cols) || 5, rows = (level && level.rows) || 5;
  const un = Math.min(rect.w / (cols - 1 + 1.2), rect.h / (rows - 1 + 1.2));
  const w = (cols - 1 + 1.2) * un, h = (rows - 1 + 1.2) * un, x = rect.x + (rect.w - w) / 2, y = rect.y + (rect.h - h) / 2;
  rr(g, x, y, w, h, un * 0.3); g.fillStyle = '#6B4329'; g.fill(); g.lineWidth = Math.max(1, un * 0.06); g.strokeStyle = INK; g.stroke();
  rr(g, x + un * 0.22, y + un * 0.22, w - un * 0.44, h - un * 0.44, un * 0.18); g.fillStyle = '#E8D5BC'; g.fill();
  const ss = ((level && level.strands) || []).slice().sort((a, b) => (a.d || 0) - (b.d || 0));
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of ss) {
    g.beginPath();
    s.pegs.forEach(([px, py], i) => { const X = x + 0.6 * un + px * un, Y = y + 0.6 * un + py * un; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.lineWidth = Math.max(2.5, un * 0.3); g.strokeStyle = INK; g.stroke();
    g.lineWidth = Math.max(1.5, un * 0.22); g.strokeStyle = YCOL[s.c] || '#999'; g.stroke();
  }
}
const KCOAT = ['#C98B5A', '#3A3346', '#F2E3CC', '#EFE1CC', '#2A2633', '#E8873A'];
function fbCat(g, x, y, s, col, o = {}) {
  g.translate(x, y);
  g.lineWidth = Math.max(1, s * 0.04); g.strokeStyle = INK; g.fillStyle = col;
  g.beginPath(); g.ellipse(0, -s * 0.27, s * 0.3, s * 0.27, 0, 0, 7); g.fill(); g.stroke();
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * s * 0.21, -s * 0.72); g.lineTo(sx * s * 0.2, -s * 0.98); g.lineTo(sx * s * 0.04, -s * 0.84); g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(0, -s * 0.66, s * 0.23, 0, 7); g.fill(); g.stroke();
  g.fillStyle = INK;
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * s * 0.085, -s * 0.68, s * 0.032, 0, 7); g.fill(); }
  if (o.loops) {
    g.lineWidth = Math.max(1.5, s * 0.06);
    for (let i = 0; i < o.loops; i++) { g.strokeStyle = YCOL[(o.loopColors && o.loopColors[i]) ?? i] || TOMATO; g.beginPath(); g.ellipse(0, -s * (0.18 + i * 0.13), s * 0.33, s * 0.07, 0.15 * (i % 2 ? 1 : -1), 0, 7); g.stroke(); }
  }
}
function fbKitten(g, x, y, s, o = {}) { fbCat(g, x, y, s, o.golden ? '#F5C542' : KCOAT[(o.breed || 0) % 6], { loops: (o.stage || 0) < 4 ? o.loops || 0 : 0, loopColors: o.loopColors }); }
function fbKitty(g, x, y, s, anim, t, outfit) {
  fbCat(g, x, y, s, '#F29B4B');
  const i = OUTFITS.findIndex(o => o[0] === outfit);
  if (i > 0) { g.fillStyle = YCOL[i % 6]; g.fillRect(-s * 0.22, -s * 0.47, s * 0.44, s * 0.08); }
}
function fbStrand(g, geo, c, sw) {
  if (!geo || !geo.path) return;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = sw + 2.5; g.strokeStyle = INK; g.stroke(geo.path);
  g.lineWidth = sw; g.strokeStyle = YCOL[c] || '#999'; g.stroke(geo.path);
}
const VIG = [null, ['#F3D9B8', '#D9A877'], ['#5B3A6E', '#2A1F45'], ['#24345C', '#8A5A3C'], ['#CDEBDD', '#9CCFB9'], ['#5A4636', '#2E241C'], ['#3A2B6B', '#141C3F']];
function fbVignette(g, rect, world) {
  const c = VIG[world] || VIG[1];
  const gr = g.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  gr.addColorStop(0, c[0]); gr.addColorStop(1, c[1]);
  g.fillStyle = gr; g.fillRect(rect.x, rect.y, rect.w, rect.h);
}
const aIcon = art(R, 'drawIcon', fbIcon);
const aStar = art(R, 'drawStar', fbStar);
const aHand = art(R, 'drawHand', fbHand);
const aMini = art(R, 'drawMiniBoard', fbMiniBoard);
const aKitten = art(R, 'drawKitten', fbKitten);
const aKitty = art(R, 'drawKitty', fbKitty);
const aStrand = art(R, 'drawStrand', fbStrand);
const aVignette = art(SC, 'drawRoomVignette', fbVignette);

// ---------- state ----------
let api = null;
const U = {
  t: 0, du: 1, scr: '', ret: 'title', S: null, L: null, Lkey: '',
  btns: [], sliders: [], reg: true, press: null, drag: null,
  callout: null, queue: [], pop: null,
  card: null, cards: [], extra: [], after: null, giftKeys: new Set(), winDone: false, loseDone: false, winAt: 0, loseAt: 0,
  sessRef: null, tut: null, tutOn: false, idle: 0, hand: null, ghost: null, attn: [], fly: [], intro: null,
  rate: {}, undoPulse: 0, shakes: {},
  map: { scroll: 0, v: 0, target: null, down: null, drag: false, sel: 1, nodes: [], last: 0, lastY: 0 },
  shop: { tab: 'outfits', sel: 'tabby', bsel: 'undo' }, reset: 0, toast: null,
  kc: { key: '', cv: null }, dailyLv: { key: '', lv: null }, sil: new Map(),
};

function layoutOf(S) {
  if (S.L) return S.L;
  const k = S.W + 'x' + S.H;
  if (U.Lkey !== k) { U.L = computeLayout(S.W, S.H); U.Lkey = k; }
  return U.L;
}
const isLand = S => S.W / S.H >= 1.15;

// ---------- buttons ----------
function reg(b) { if (U.reg) U.btns.push(b); return b; }
function hitOf(b) {
  const r = b.hit || b;
  const w = Math.max(r.w, 44), h = Math.max(r.h, 44);
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}
const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const isDown = b => !!(U.press && U.press.id === b.id && U.press.over);
function shakeX(id, d) { const t0 = U.shakes[id]; if (t0 == null) return 0; const t = U.t - t0; return t > 0.35 ? 0 : Math.sin(t * 50) * 5 * d * (1 - t / 0.35); }

/** Pill button. b: { id, x, y, w, h, label, kind: 'primary'|'secondary'|'cream', disabled, sub, icon, badge, act, d } */
function pill(g, b) {
  b.primary = b.kind === 'primary';
  reg(b);
  const d = b.d || U.du;
  const down = isDown(b) && !b.disabled;
  const lip = Math.max(2, Math.min(4 * d, b.h * 0.12));
  const h = b.h - lip, push = down ? Math.min(3 * d, lip) : 0;
  const x = b.x + shakeX(b.id, d), y = b.y + push, lv = lip - push;
  const [top, bot, fg] = b.kind === 'primary' ? [TOMATO, TOMATO_D, '#fff'] : b.kind === 'secondary' ? [TEAL, TEAL_D, '#fff'] : [CREAM, SHADE, INK];
  g.save();
  if (b.disabled) g.globalAlpha *= 0.45;
  if (down) { const cx = x + b.w / 2, cy = y + h / 2; g.translate(cx, cy); g.scale(1.03, 0.95); g.translate(-cx, -cy); }
  const r = h / 2;
  rr(g, x, y, b.w, h + lv, r); g.fillStyle = bot; g.fill();
  rr(g, x, y, b.w, h, r); g.fillStyle = top; g.fill();
  rr(g, x, y, b.w, h + lv, r); g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
  rr(g, x + r * 0.6, y + h * 0.12, Math.max(0, b.w - r * 1.2), h * 0.28, h * 0.14); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill();
  const cy = y + h / 2;
  let ix = 0, iw = 0;
  const pad = r * 0.7;
  if (b.icon) iw = h * 0.5;
  const avail = b.w - 2 * pad - (iw ? iw + h * 0.12 : 0) - (b.badge ? h * 0.3 : 0);
  const stroke = fg === '#fff' ? INK : null;
  if (b.sub) {
    const s1 = fitSize(g, b.label, avail, h * 0.46, FT, '', 0.2), s2 = fitSize(g, b.sub, avail, h * 0.19, FB, '900');
    txt(g, b.label, x + b.w / 2, cy - h * 0.1, s1, { col: fg, stroke, sk: 0.2 });
    txt(g, b.sub, x + b.w / 2, cy + h * 0.27, s2, { f: FB, w: '900', col: fg === '#fff' ? CREAM : INK });
  } else {
    const size = fitSize(g, b.label, avail, h * 0.46, FT, '', stroke ? 0.2 : 0);
    const lw = tw(g, b.label, size, FT);
    const total = lw + (iw ? iw + h * 0.12 : 0);
    ix = x + b.w / 2 - total / 2;
    if (iw) aIcon(g, b.icon, ix + iw / 2, cy, iw, fg === '#fff' ? '#fff' : INK);
    txt(g, b.label, ix + (iw ? iw + h * 0.12 : 0) + lw / 2, cy + h * 0.02, size, { col: fg, stroke, sk: 0.2 });
  }
  g.restore();
  if (b.badge) badge(g, b.x + b.w - h * 0.12, b.y + h * 0.05, h * 0.3, b.badge, d);
}
/** Count badge (ink circle) or price chip (gold, with a yarn ball). */
function badge(g, x, y, r, bd, d) {
  g.save();
  if (bd.n != null) {
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = INK; g.fill(); g.lineWidth = Math.max(1, r * 0.16); g.strokeStyle = CREAM; g.stroke();
    txt(g, String(bd.n), x, y + r * 0.06, r * 1.15, { col: '#fff', maxW: r * 1.6 });
  } else if (bd.price != null) {
    const s = r * 1.05, label = String(bd.price);
    const w = tw(g, label, s, FT) + s * 1.5;
    rr(g, x - w / 2, y - r * 0.75, w, r * 1.5, r * 0.75); g.fillStyle = GOLD; g.fill(); g.lineWidth = Math.max(1, r * 0.14); g.strokeStyle = GOLD_D; g.stroke();
    aIcon(g, 'ball', x - w / 2 + s * 0.62, y, s * 0.95);
    txt(g, label, x - w / 2 + s * 1.2 + (w - s * 1.5) / 2, y + r * 0.05, s, { col: INK });
  }
  g.restore();
}
/** Round icon button. b: { id, x, y, w, h (bounding square), icon, label, sub, badge, dot, ring, disabled, act, hit } */
function iconBtn(g, b) {
  reg(b);
  const d = b.d || U.du;
  const R0 = Math.min(b.w, b.h) / 2, cx = b.x + b.w / 2 + shakeX(b.id, d), cy0 = b.y + b.h / 2;
  const down = isDown(b) && !b.disabled;
  const lip = Math.max(1.5, R0 * 0.1), cy = cy0 - lip / 2 + (down ? lip * 0.8 : 0);
  g.save();
  if (b.disabled) g.globalAlpha *= 0.45;
  if (b.ring) {
    const p = 0.5 + 0.5 * Math.sin(U.t * 7);
    g.beginPath(); g.arc(cx, cy0, R0 + (2 + 3 * p) * d, 0, 7); g.lineWidth = Math.max(2, 3.5 * d); g.strokeStyle = b.ring; g.globalAlpha *= 0.6 + 0.4 * p; g.stroke();
    g.globalAlpha = b.disabled ? 0.45 : 1;
  }
  g.beginPath(); g.arc(cx, cy0 + lip / 2, R0 - lip / 2, 0, 7); g.fillStyle = SHADE; g.fill();
  g.beginPath(); g.arc(cx, cy, R0 - lip / 2, 0, 7); g.fillStyle = b.fill || CREAM; g.fill();
  g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
  aIcon(g, b.icon, cx, cy, R0 * 1.05, b.iconCol || INK);
  g.restore();
  if (b.dot) { g.beginPath(); g.arc(cx + R0 * 0.72, cy0 - R0 * 0.72, Math.max(4, R0 * 0.24), 0, 7); g.fillStyle = TOMATO; g.fill(); g.lineWidth = Math.max(1, 2 * d); g.strokeStyle = '#fff'; g.stroke(); }
  if (b.badge) badge(g, cx + R0 * 0.72, cy0 + R0 * 0.62, Math.max(7, R0 * 0.36), b.badge, d);
}
function slider(g, s) {
  if (U.reg) U.sliders.push(s);
  const d = s.d, kr = Math.min(s.h * 0.42, 13 * d);
  const lw = Math.min(s.w * 0.34, 96 * d);
  txt(g, s.label, s.x, s.y + s.h / 2, 16 * d, { f: FB, w: '800', align: 'left', maxW: lw - 6 * d });
  const tx = s.x + lw + kr, tw2 = s.w - lw - 2 * kr, ty = s.y + s.h / 2;
  s.tx = tx; s.tw = tw2;
  rr(g, tx - 4 * d, ty - 5 * d, tw2 + 8 * d, 10 * d, 5 * d); g.fillStyle = STITCH; g.fill(); g.lineWidth = Math.max(1, 2 * d); g.strokeStyle = INK; g.stroke();
  rr(g, tx - 4 * d, ty - 5 * d, (tw2 + 8 * d) * clamp(s.v, 0, 1) + 0.01, 10 * d, 5 * d); g.fillStyle = TEAL; g.fill();
  g.beginPath(); g.arc(tx + tw2 * clamp(s.v, 0, 1), ty, kr, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
}
function toggle(g, b) {
  reg(b);
  const d = b.d, on = !!b.on;
  txt(g, b.label, b.x, b.y + b.h / 2, 16 * d, { f: FB, w: '800', align: 'left', maxW: b.w - 70 * d });
  const sw = Math.min(56 * d, b.w * 0.3), sh = Math.min(30 * d, b.h * 0.8), sx = b.x + b.w - sw, sy = b.y + (b.h - sh) / 2;
  rr(g, sx, sy, sw, sh, sh / 2); g.fillStyle = on ? TEAL : STITCH; g.fill(); g.lineWidth = Math.max(1.5, 2.2 * d); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(on ? sx + sw - sh / 2 : sx + sh / 2, sy + sh / 2, sh * 0.36, 0, 7); g.fillStyle = '#fff'; g.fill(); g.stroke();
}
function closeX(g, x, y, d, act) { iconBtn(g, { id: 'close', label: 'Close', x: x - 21 * d, y: y - 21 * d, w: 42 * d, h: 42 * d, icon: 'close', act }); }

/** Rows of fixed du heights, shrunk together when space is short. rows: [{ h, fn(y, hPx, e) }] */
function rows(list, d, availH) {
  const need = list.reduce((a, r) => a + r.h, 0) * d;
  const k = need > 0 ? Math.min(1, availH / need) : 1;
  return { k, h: need * k, e: d * k, run(y0) { let y = y0; for (const r of list) { const hh = r.h * d * k; if (r.fn) r.fn(y, hh, d * k); y += hh; } } };
}

// ---------- callouts (§9.2) ----------
const suppressed = () => !!U.card || (U.S && U.S.screen && U.S.screen !== 'play');
export function say(text, { pri = 1, dur = DUR.callout } = {}) {
  if (!text || suppressed()) return;
  const c = { text: String(text), pri, dur, t: 0, wait: 0 };
  const cur = U.callout;
  if (!cur || (cur.t >= 0.15 && pri >= cur.pri)) { U.callout = c; return; }
  U.queue.push(c);
  if (U.queue.length > 2) U.queue.shift();
}
function forceSay(text, pri = 3, dur = 600) { if (suppressed()) return; U.callout = { text, pri, dur, t: 0.2, wait: 0 }; }
function clearSay(text) {
  const c = U.callout;
  if (c && (!text || c.text === text)) c.dur = Math.min(c.dur, c.t + 0.2);
  U.queue = U.queue.filter(q => text && q.text !== text);
}
function clearCallouts() { U.callout = null; U.queue = []; U.pop = null; }
function popAt(text, slot) { U.pop = { text, slot: slot == null ? -1 : slot, t: 0, dur: 0.9 }; }
function rateOk(key, gap) { const t = U.rate[key]; if (t != null && U.t - t < gap) return false; U.rate[key] = U.t; return true; }

// ---------- strand helpers for the director ----------
function isRemoved(st, id) {
  const r = st && st.removed;
  if (typeof r === 'bigint') return ((r >> BigInt(id)) & 1n) === 1n;
  if (typeof r === 'number') return ((r / Math.pow(2, id)) | 0) % 2 === 1;
  return false;
}
function freeList(S) {
  const s = S && S.sess;
  if (!s || !s.lifted) return [];
  const out = [];
  for (const id of s.lifted) if (!isRemoved(s.st, id)) out.push(id);
  return out.sort((a, b) => a - b);
}
function strandOf(S, id) { const p = S.sess && S.sess.puz; return p && p.strands ? p.strands[id] : null; }
function fitsSpool(S, id) {
  const st = S.sess && S.sess.st, s = strandOf(S, id);
  if (!st || !s || !st.sc) return false;
  for (let i = 0; i < st.sc.length; i++) if (st.sc[i] >= 0 && st.sn[i] < st.sk[i] && (s.c === 6 || st.sc[i] === s.c)) return true;
  return false;
}
function pickMove(S, filter = null) {
  let f = freeList(S);
  if (filter) { const g2 = f.filter(filter); if (g2.length) f = g2; }
  const fit = f.filter(id => fitsSpool(S, id));
  return fit.length ? fit[0] : f.length ? f[0] : -1;
}
function basketRoom(S) {
  const b = S.sess && S.sess.basket;
  if (!b) return -1;
  for (let i = 0; i < b.length; i++) if (!b[i]) return i;
  return -1;
}

// ---------- hand, ghost, attention, fly-ins ----------
function setHand(id, src = 'tut', delay = 0) { if (id == null || id < 0) return; U.hand = { id, src, t0: U.t + delay }; }
function clearHand(src) { if (U.hand && (!src || U.hand.src === src)) U.hand = null; }
function tapPoint(id) { return safe(() => api.tapPointFor(id), null); }
function attnNext(S, delay = 0) {
  const L = layoutOf(S), rs = safe(() => rackSlots(L), null);
  if (!rs || !rs.next || !rs.next[0]) return;
  const n = rs.next[0];
  U.attn.push({ x: n.x, y: n.y, r: n.h * 0.75, t0: U.t + delay, dur: 1.4 });
}
function startGhost(S, id) {
  const i = basketRoom(S);
  if (i < 0) return;
  U.ghost = { id, slot: i, t0: U.t, loops: 2 };
}
function startFly(S, k, delay) {
  const n = Math.min(3, BOOSTERS[k].gift || 1);
  for (let i = 0; i < n; i++) U.fly.push({ k, t0: U.t + delay + i * 0.14, dur: 0.75 });
}

// ---------- tutorial director (§10) ----------
export function tutorialFor(levelId) {
  if (levelId === 1) return dirL1();
  if (levelId === 2) return dirL2();
  if (levelId === 3) return dirL3();
  if (levelId === 4) return dirL4();
  const key = TEACH[levelId];
  if (key && !safe(() => M.tutSeen(key), true)) return dirTeach(key);
  return null;
}
function dirL1() {
  const LINE = 'Tap the yarn on top';
  let wait = -1;
  return {
    start(S) { forceSay(LINE); setHand(pickMove(S), 'tut', 0.8); },
    on(type, d, S) { if (type === 'pull') { clearSay(LINE); clearHand('tut'); wait = 1.0; } },
    tick(dt, S) {
      if (wait >= 0) {
        wait -= dt;
        if (wait < 0) { const id = pickMove(S); if (id >= 0) setHand(id, 'tut'); else if (!S.sess.result) wait = 0.25; }
      }
    },
  };
}
function dirL2() {
  const L1 = 'Only yarn on top can move', L2 = 'Pull the top one first';
  let pulled = false, blocked = false;
  return {
    start() { forceSay(L1); },
    on(type, d, S) {
      if (type === 'blocked' && !pulled && !blocked && d && d.why === 'covered') {
        blocked = true;
        const bl = (d.blockers || []).slice();
        const free = new Set(freeList(S));
        const pick = bl.find(b => free.has(b)) ?? bl[0];
        if (pick != null) setHand(pick, 'tut');
        forceSay(L2);
      }
      if (type === 'pull' && !pulled) { pulled = true; clearSay(L1); clearSay(L2); clearHand('tut'); }
    },
    tick(dt, S) { if (!U.hand && U.idle >= 3 && !S.sess.result) setHand(pickMove(S), 'idle'); },
  };
}
function dirL3() {
  const LINE = 'No spool yet? It waits in the basket';
  let ghosted = false, chained = false, attn = false;
  return {
    start() {},
    on(type, d, S) {
      if ((type === 'basket' || (type === 'pull' && d && d.dest && d.dest.kind === 'basket')) && !attn) { attn = true; attnNext(S, 0.5); }
      if (type === 'spoolEnter' && !chained && d && (S.sess.basket || []).some(b => b && b.c === d.c)) { chained = true; popAt('CHAIN!', d.slot); }
      if (type === 'chain' && !chained) { chained = true; if (!(d && d.m >= 2)) popAt('CHAIN!', d && d.slot); }
      if (type === 'pull') { if (U.ghost) U.ghost.loops = 0; clearSay(LINE); }
    },
    tick(dt, S) {
      const s = S.sess;
      if (s.result || s.stuck) return;
      if (!U.hand && !U.ghost && U.idle >= 3) { const fit = freeList(S).filter(id => fitsSpool(S, id)); if (fit.length) setHand(fit[0], 'idle'); }
      if (!ghosted && !s.spoolBusy && !(s.flights && s.flights.length)) {
        const free = freeList(S);
        if (free.length && !free.some(id => fitsSpool(S, id)) && basketRoom(S) >= 0) {
          ghosted = true; clearHand(); startGhost(S, free[0]); forceSay(LINE, 3, 4);
        }
      }
    },
  };
}
function dirL4() {
  return {
    start(S) { forceSay('Watch the NEXT spool', 3, 3); attnNext(S, 0.3); },
    on() {}, tick() {},
  };
}
function dirTeach(key) {
  let off = false, pulls = 0;
  const target = S => {
    const pz = S.sess.puz || {}, ss = pz.strands || [];
    if (key === 'knot') return pickMove(S, id => (pz.group && pz.group[id] >= 0) || (ss[id] && ss[id].knot != null));
    if (key === 'lock') return pickMove(S, id => ss[id] && ss[id].key != null);
    if (key === 'mystery') return pickMove(S, id => ss[id] && ss[id].m);
    if (key === 'rainbow') return pickMove(S, id => ss[id] && ss[id].c === 6);
    if (key === 'paw') return pickMove(S, id => !(ss[id] && ss[id].paw));
    return pickMove(S);
  };
  return {
    start(S) {
      if (safe(() => M.tutSeen(key), false)) { off = true; return; }
      safe(() => M.markTut(key));
      let line = TEACH_LINE[key];
      if (key === 'paw') {
        const ss = (S.sess.puz && S.sess.puz.strands) || [];
        const n = (ss.find(s => s && s.paw) || {}).paw || (S.sess.puz && S.sess.puz.pawN && Math.max(...S.sess.puz.pawN)) || 4;
        line = line.replace('N', String(n));
      }
      forceSay(line, 3, 5);
    },
    on(type, d, S) {
      if (off) return;
      if (key === 'lock' && type === 'blocked' && d && d.why === 'locked') setHand(target(S), 'tut');
      if (key === 'mystery' && type === 'reveal' && d && d.id != null && pulls < 2) setHand(d.id, 'tut');
      if (type === 'pull') { pulls++; clearHand('tut'); }
    },
    tick(dt, S) {
      if (off || pulls >= (key === 'paw' || key === 'jumbo' || key === 'ice' ? 2 : 1) || S.sess.result) return;
      if (!U.hand && U.idle >= 3) setHand(target(S), 'idle');
    },
  };
}

// ---------- bus wiring ----------
function onBus(type, d) {
  const S = U.S;
  if (!S) return;
  if (type === 'win') { U.winAt = U.t + DUR.kittenFree; clearHand(); U.ghost = null; }
  if (type === 'stuck') { U.loseAt = U.t + DUR.stuckCard; clearHand(); U.ghost = null; }
  if (type === 'kittenFree') { clearHand(); clearSay(); }
  if (type === 'pull' || type === 'press') U.idle = 0;
  if (!S.sess || S.screen !== 'play') return;
  if (U.tut && U.tutOn) safe(() => U.tut.on(type, d, S));
  if (type === 'pull') clearHand('idle');
  switch (type) {
    case 'chain': if (d && d.m >= 2) popAt(`CHAIN ×${d.m}!`, d.slot); break;
    case 'coins': if (d && d.n > 0) popAt(`+${d.n}`, U.pop ? U.pop.slot : -1); break;
    case 'full': if (rateOk('full', 3)) say('Basket full: pick yarn that fits a spool', { pri: 1, dur: 2 }); break;
    case 'basketWarn': if (rateOk('warn', 4)) say('Basket almost full!', { pri: 1, dur: 1.6 }); break;
    case 'blocked':
      if (!d) break;
      if (d.why === 'locked' && rateOk('lock', 4)) say('Locked: pull its key strand first', { pri: 1, dur: 2 });
      if (d.why === 'paw' && rateOk('paw', 4)) {
        const pz = S.sess.puz || {}, need = (pz.pawN && pz.pawN[d.id]) || ((strandOf(S, d.id) || {}).paw) || 0;
        const left = Math.max(1, need - ((S.sess.st && S.sess.st.count) || 0));
        say(`Sleepy paw: pull ${left} more first`, { pri: 1, dur: 2 });
      }
      break;
    case 'thaw': if (d && d.left === 0) say('Ice slot open!', { pri: 1, dur: 1.6 }); break;
    case 'booster':
      if (d && d.kind === 'snip') say('Tap any strand to snip it', { pri: 2, dur: 2.6 });
      if (d && d.kind === 'slot') say('Basket +1 slot!', { pri: 2, dur: 1.6 });
      break;
    case 'hint': if (d && d.id != null && d.id < 0) { U.undoPulse = U.t + 4; say('Undo a pull first', { pri: 2, dur: 2.2 }); } break;
    case 'doomed':
      if (safe(() => M.boosterUnlocked('undo'), false) && rateOk('doomed', 8)) say('Tight spot! Undo can help', { pri: 1, dur: 2.2 });
      break;
  }
}
const BUS = ['press', 'pull', 'blocked', 'full', 'basketWarn', 'chain', 'coins', 'spoolEnter', 'basket', 'reveal', 'unlock',
  'paw', 'thaw', 'kittenFree', 'win', 'stuck', 'doomed', 'undo', 'booster', 'hint'];

// ---------- init ----------
export function init(a) {
  api = a;
  U.S = a && a.S;
  for (const t of BUS) bus.on(t, d => onBus(t, d));
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('wheel', e => {
      const S = U.S;
      if (!S || S.screen !== 'map' || U.card) return;
      const mm = mapM(S);
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      const can = dy > 0 ? U.map.scroll > 0.5 : U.map.scroll < mm.maxScroll - 0.5;
      if (!can) return;
      e.preventDefault();
      U.map.target = null; U.map.v = 0;
      U.map.scroll = clamp(U.map.scroll - dy, 0, mm.maxScroll);
    }, { passive: false });
  }
}

// ---------- update ----------
export function update(dt, S) {
  if (!S) return;
  U.S = S;
  U.t += dt;
  U.du = clamp(isLand(S) ? Math.min(S.W / 700, S.H / 520) : Math.min(S.W / 390, S.H / 700), 0.55, 2.6);
  if (S.screen !== U.scr) onScreen(U.scr, S.screen, S);
  if (S.sess !== U.sessRef) onSession(S);
  const playing = S.screen === 'play' && !U.card;

  // director starts once the level is on screen
  if (S.sess && playing && !U.tutOn) {
    U.tutOn = true;
    if (U.tut) safe(() => U.tut.start(S));
    scheduleIntro(S);
  }
  if (playing && S.sess) {
    U.idle += dt;
    if (U.tut) safe(() => U.tut.tick(dt, S));
    const sess = S.sess;
    const idleOk = sess.kind === 'bonus' || (sess.kind === 'level' && sess.id >= 4);
    if (idleOk && !U.hand && U.idle >= IDLE_HINT && !sess.stuck && !sess.result) setHand(pickMove(S), 'idle');
    if (U.hand && (sess.result || sess.stuck)) U.hand = null;
    if (U.intro && U.t >= U.intro.at) runIntro(S);
  }
  // callouts
  if (U.pop) { U.pop.t += dt; if (U.pop.t >= U.pop.dur) U.pop = null; }
  if (U.callout && !U.pop) { U.callout.t += dt; if (U.callout.t >= U.callout.dur) U.callout = null; }
  for (const q of U.queue) q.wait += dt;
  U.queue = U.queue.filter(q => q.wait < 2.5 || q.pri >= 3);
  if (!U.callout && U.queue.length) { U.callout = U.queue.shift(); U.callout.t = 0; }
  if (U.ghost && U.t - U.ghost.t0 > 1.5) { if (U.ghost.loops-- > 0 && U.idle > 1) U.ghost.t0 = U.t; else if (U.ghost.loops < 0) U.ghost = null; }
  U.attn = U.attn.filter(a => U.t < a.t0 + a.dur);
  U.fly = U.fly.filter(f => U.t < f.t0 + f.dur + 0.3);
  if (U.toast && U.t > U.toast.t0 + 2) U.toast = null;
  if (U.reset && U.t > U.reset) U.reset = 0;

  // cards
  const sess = S.sess;
  if (S.screen === 'win' && !U.card && !U.winDone && !U.after && !U.cards.length) showCard('win', sess && sess.result);
  if (S.screen === 'lose' && !U.card && !U.loseDone) showCard('lose', {});
  if (U.winAt && U.t >= U.winAt) { U.winAt = 0; if (!U.card && !U.winDone && sess && sess.result && (S.screen === 'play' || S.screen === 'win')) showCard('win', sess.result); }
  if (U.loseAt && U.t >= U.loseAt) { U.loseAt = 0; if (!U.card && !U.loseDone && sess && sess.stuck && (S.screen === 'play' || S.screen === 'lose')) showCard('lose', {}); }
  if (U.card && U.card.type === 'lose' && sess && !sess.stuck && S.screen !== 'lose' && U.t - U.card.t0 > 0.1) U.card = null;
  if (U.card && U.card.type === 'win') {
    const c = U.card, st = (c.data && c.data.stars) || 0;
    for (let i = 0; i < 3; i++) if (i < st && !c.emitted[i] && U.t >= c.t0 + 0.35 + i * 0.25) { c.emitted[i] = true; bus.emit('star', { i }); }
  }
  // map physics
  if (S.screen === 'map' || (DIALOGS.includes(S.screen) && U.ret === 'map')) mapUpdate(dt, S);
}

function onScreen(prev, next, S) {
  U.scr = next;
  if (DIALOGS.includes(next) && !DIALOGS.includes(prev)) U.ret = HOMES.includes(prev) ? prev : (safe(() => M.cur(), 1) > LEVELS ? 'allbeaten' : 'title');
  if (next === 'map' && !DIALOGS.includes(prev)) mapFocus(S, true);
  if ((prev === 'win' || prev === 'lose') && next !== 'win' && next !== 'lose') {
    if (U.card && (U.card.type === 'win' || U.card.type === 'lose' || U.after)) U.card = null;
    if (U.after) { U.after = null; U.cards = []; }
    U.winDone = U.loseDone = false;
  }
  if (next !== 'play') { clearCallouts(); U.hand = null; U.ghost = null; }
  if (next === 'shop') { U.shop.tab = 'outfits'; U.shop.sel = (safe(() => M.outfits(), []).find(o => o.worn) || { id: 'tabby' }).id; U.shop.bsel = BK.find(k => safe(() => M.boosterUnlocked(k), false)) || 'undo'; }
  U.reset = 0;
  U.press = null; U.drag = null;
}
function onSession(S) {
  U.sessRef = S.sess;
  clearCallouts();
  U.hand = null; U.ghost = null; U.attn = []; U.idle = 0; U.tutOn = false; U.intro = null; U.fly = [];
  U.winAt = U.loseAt = 0; U.winDone = U.loseDone = false;
  if (U.card && (U.card.type === 'win' || U.card.type === 'lose')) U.card = null;
  const s = S.sess;
  U.tut = s && s.kind === 'level' ? safe(() => tutorialFor(s.id), null) : null;
}
function scheduleIntro(S) {
  const pend = BK.filter(k => safe(() => M.boosterUnlocked(k), false) && !safe(() => M.tutSeen('b_' + k), true));
  if (!pend.length) return;
  const sess = S.sess;
  U.intro = { k: pend[0], at: U.t + (sess && sess.kind === 'level' && sess.id === 4 ? 3.2 : 1.0) };
}
function runIntro(S) {
  const k = U.intro.k;
  U.intro = null;
  safe(() => M.markTut('b_' + k));
  startFly(S, k, 0);
  setTimeoutUI(() => { say(BTEACH[k], { pri: 3, dur: 2.8 }); scheduleIntro(S); if (U.intro) U.intro.at = U.t + 3.2; }, 1.0);
}
const timers = [];
function setTimeoutUI(fn, delay) { timers.push({ fn, at: U.t + delay }); }
function runTimers() {
  for (let i = timers.length - 1; i >= 0; i--) if (U.t >= timers[i].at) { const t = timers.splice(i, 1)[0]; safe(t.fn); }
}

// ---------- cards ----------
export function showCard(type, data) {
  if (type === 'win' || type === 'lose') {
    if (U.card && U.card.type === type) return;
    if (type === 'win' && (U.winDone || U.after || U.cards.length)) return;
    if (type === 'lose' && U.loseDone) return;
    const S = U.S;
    U.card = { type, data: data || (S && S.sess && S.sess.result) || {}, t0: U.t, emitted: [] };
    if (type === 'win') { U.giftKeys = new Set(); U.extra = []; }
    clearCallouts(); U.hand = null; U.ghost = null; U.press = null;
    return;
  }
  const c = giftCard(type, data);
  if (!c) return;
  if (U.giftKeys.has(c.key)) return;
  U.giftKeys.add(c.key);
  if (U.card && U.card.type === 'win') U.extra.push(c);
  else if (U.card) U.cards.push(c);
  else { c.t0 = U.t; U.card = c; clearCallouts(); }
}
function giftCard(type, data) {
  data = data || {};
  if (type === 'booster') type = 'unlockBooster';
  if (type === 'stars') type = 'gift';
  if (!['gift', 'chest', 'unlockBooster'].includes(type)) return null;
  const key = type + '|' + (data.k || '') + '|' + (data.at || '') + '|' + (data.world || '');
  return { type, data, key, t0: U.t, emitted: [] };
}
function finishWin(fn) {
  const data = (U.card && U.card.data) || {};
  U.winDone = true;
  const list = [];
  for (const g2 of data.gifts || []) {
    const c = giftCard(g2.kind, g2);
    if (c && !list.some(x => x.key === c.key)) list.push(c);
  }
  for (const c of U.extra) if (!list.some(x => x.key === c.key)) list.push(c);
  U.extra = [];
  U.card = null;
  if (!list.length) { fn(); return; }
  U.cards = list; U.after = fn;
  nextCard();
}
function nextCard() {
  U.card = null;
  if (U.cards.length) { U.card = U.cards.shift(); U.card.t0 = U.t; return; }
  const fn = U.after; U.after = null;
  if (fn) fn();
}
function loseBooster(k) {
  if (!tapBooster(k)) return;
  U.loseDone = true; U.card = null;
  const S = U.S;
  if (S && S.screen === 'lose') safe(() => api.resume());
}

// ---------- boosters ----------
function tapBooster(k) {
  if (!safe(() => M.boosterUnlocked(k), false)) return false;
  if (safe(() => M.booster(k), 0) <= 0) {
    if (safe(() => M.balance(), 0) < BOOSTERS[k].price) {
      U.shakes['b-' + k] = U.t; U.shakes['l-' + k] = U.t;
      say('Not enough yarn balls', { pri: 2, dur: 1.6 });
      if (U.card) toast('Not enough yarn balls');
      return false;
    }
    if (!safe(() => M.buyBooster(k), false)) return false;
    bus.emit('buy', { item: k });
  }
  const ok = safe(() => api.useBooster(k), false);
  if (!ok) {
    const S = U.S, msg = k === 'slot' ? 'Only one +1 Slot per try' : k === 'undo' ? 'Nothing to undo yet' : k === 'hint' && S && S.sess && S.sess.hint ? 'Hint is showing' : '';
    if (msg) say(msg, { pri: 2, dur: 1.6 });
  }
  return !!ok;
}
function toast(text) { U.toast = { text, t0: U.t }; }

// ---------- draw ----------
export function draw(g, S) {
  if (!S) return;
  U.S = S;
  U.btns = []; U.sliders = []; U.reg = true;
  runTimers();
  g.save();
  try {
    const scr = S.screen;
    if (scr === 'loading') drawLoading(g, S);
    else if (scr === 'title') drawTitle(g, S);
    else if (scr === 'map') drawMap(g, S);
    else if (scr === 'allbeaten') drawAllBeaten(g, S);
    else if (scr === 'play' || scr === 'pause' || scr === 'win' || scr === 'lose') drawPlayUI(g, S);
    else if (DIALOGS.includes(scr)) {
      U.reg = false;
      g.save();
      if (U.ret === 'map') drawMap(g, S); else if (U.ret === 'allbeaten') drawAllBeaten(g, S); else drawTitle(g, S);
      g.restore();
      U.reg = true;
      dim(g, S, 0.42);
      if (scr === 'shop') drawShop(g, S);
      else if (scr === 'kittens') drawKittens(g, S);
      else if (scr === 'settings') drawSettings(g, S);
      else drawDaily(g, S);
    }
    if (U.card) { U.reg = true; drawCard(g, S); }
    if (U.toast) drawToast(g, S);
  } finally { g.restore(); }
  if (!S.ui || typeof S.ui !== 'object') S.ui = {};
  S.ui.btns = U.btns;
  S.ui.card = U.card ? U.card.type : null;
  S.ui.callout = U.callout && !U.pop ? U.callout.text : null;
  S.ui.pop = U.pop ? U.pop.text : null;
  S.ui.hand = U.hand ? U.hand.id : null;
}

// ---------- logo ----------
function drawLogo(g, cx, cy, maxW, maxH) {
  let s1 = Math.min(maxH / 2.05, 220);
  const w1 = tw(g, 'Knot', s1), w2 = tw(g, 'Kitty', s1 * 1.12);
  s1 = Math.min(s1, s1 * (maxW * 0.9) / Math.max(w1, w2));
  const s2 = s1 * 1.12, y1 = cy - s1 * 0.46, y2 = cy + s2 * 0.5;
  const W1 = tw(g, 'Knot', s1), x1 = cx - W1 / 2;
  const kn = tw(g, 'Kn', s1), ow = tw(g, 'o', s1);
  const ox = x1 + kn + ow / 2, oy = y1 + s1 * 0.1;
  g.save();
  g.translate(cx, cy); g.rotate(-0.035); g.translate(-cx, -cy);
  // yarn strand behind the "o"
  const yarn = () => {
    g.beginPath();
    g.moveTo(x1 - s1 * 0.35, y1 + s1 * 0.42);
    g.bezierCurveTo(x1 + s1 * 0.2, y1 + s1 * 0.5, ox - ow * 0.6, oy + s1 * 0.25, ox, oy);
    g.bezierCurveTo(ox + ow * 0.6, oy - s1 * 0.25, x1 + W1 + s1 * 0.05, y1 - s1 * 0.5, x1 + W1 + s1 * 0.32, y1 - s1 * 0.22);
    g.lineCap = 'round';
    g.lineWidth = s1 * 0.14; g.strokeStyle = INK; g.stroke();
    g.lineWidth = s1 * 0.09; g.strokeStyle = TOMATO; g.stroke();
  };
  yarn();
  g.beginPath(); g.arc(x1 + W1 + s1 * 0.36, y1 - s1 * 0.2, s1 * 0.15, 0, 7); g.fillStyle = TOMATO; g.fill(); g.lineWidth = s1 * 0.04; g.strokeStyle = INK; g.stroke();
  const word = (s, x, y, size) => {
    txt(g, s, x + size * 0.03, y + size * 0.06, size, { col: 'rgba(43,36,64,0.45)' });
    txt(g, s, x, y, size, { col: CREAM, stroke: INK, sk: 0.16 });
  };
  word('Knot', cx, y1, s1);
  // the yarn passes in front of the right half of the "o"
  g.save(); g.beginPath(); g.rect(ox, oy - s1 * 0.4, ow * 0.7, s1 * 0.8); g.clip(); yarn(); g.restore();
  // ear notch on the K of Kitty
  const W2 = tw(g, 'Kitty', s2), kx = cx - W2 / 2 + s2 * 0.13, top = y2 - s2 * 0.36;
  g.beginPath(); g.moveTo(kx - s2 * 0.1, top + s2 * 0.04); g.lineTo(kx - s2 * 0.02, top - s2 * 0.24); g.lineTo(kx + s2 * 0.12, top + s2 * 0.04); g.closePath();
  g.fillStyle = CREAM; g.fill(); g.lineJoin = 'round'; g.lineWidth = s2 * 0.08; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(kx - s2 * 0.045, top + s2 * 0.01); g.lineTo(kx - s2 * 0.015, top - s2 * 0.12); g.lineTo(kx + s2 * 0.05, top + s2 * 0.01); g.closePath(); g.fillStyle = '#F4A7A0'; g.fill();
  word('Kitty', cx, y2, s2);
  g.restore();
}

// ---------- loading ----------
function drawLoading(g, S) {
  const d = U.du;
  g.fillStyle = CREAM; g.fillRect(0, 0, S.W, S.H);
  const cx = S.W / 2, cy = S.H * 0.42;
  drawLogo(g, cx, cy, Math.min(S.W * 0.8, 420 * d), Math.min(S.H * 0.3, 190 * d));
  const r = 22 * d, by = cy + Math.min(S.H * 0.15, 110 * d) + r * 2;
  g.save(); g.translate(cx, by); g.rotate(U.t * 4);
  aIcon(g, 'ball', 0, 0, r * 2.4);
  g.restore();
}

// ---------- title ----------
function drawTitle(g, S) {
  const d = U.du, W = S.W, inset = layoutOf(S).inset || 0, H = S.H - inset;
  const land = isLand(S), canLink = !!P.canLink;
  const cur = safe(() => M.cur(), 1), prog = safe(() => M.progress(), 0);
  const dl = safe(() => M.daily(), { unlocked: false, won: true });
  const lv2 = safe(() => LV.getLevel(2), null);
  const playSub = prog > 0 ? (cur > LEVELS ? 'ALL 60 BEATEN' : `LEVEL ${cur}`) : '';
  const playAct = () => { if (prog === 0) api.go('play', { kind: 'level', id: 1 }); else api.go('map'); };
  const iconsRow = (cx, y, e, maxW) => {
    const items = [['daily', 'calendar', 'Daily', () => api.go('daily'), dl.unlocked && !dl.won], ['kittens', 'paw', 'Kittens', () => api.go('kittens')],
      ['shop', 'cart', 'Shop', () => api.go('shop')], ['settings', 'gear', 'Settings', () => api.go('settings')]];
    const r = 23 * e, gapX = Math.min(28 * e, (maxW - 8 * r) / 3), total = 8 * r + 3 * gapX;
    items.forEach(([id, ic, label, act, dot], i) => {
      const x = cx - total / 2 + i * (2 * r + gapX);
      iconBtn(g, { id: 't-' + id, label, x, y, w: 2 * r, h: 2 * r, icon: ic, act, dot, d: e });
      txt(g, label, x + r, y + 2 * r + 9 * e, 12 * e, { f: FB, w: '800', col: '#fff', stroke: INK, sk: 0.3, maxW: 2 * r + gapX * 0.9 });
    });
  };
  const playBtn = (cx, y, w, e) => pill(g, { id: 'title-play', label: 'PLAY', sub: playSub || null, kind: 'primary', x: cx - w / 2, y, w, h: 72 * e, act: playAct, d: e });
  const link = (y, e) => {
    if (!canLink) return;
    const s = 13 * e, x = Math.max(12 * e, 10), label = 'more games', w = tw(g, label, s, FB, '800');
    reg({ id: 'more', label: 'more games', x: x - 4, y: y - 11 * e, w: w + 8, h: 22 * e, act: () => P.link('../') });
    txt(g, label, x, y, s, { f: FB, w: '800', align: 'left', col: '#fff', stroke: INK, sk: 0.3 });
    g.fillStyle = '#fff'; g.fillRect(x, y + s * 0.62, w, Math.max(1, s * 0.08));
  };
  const boardBlock = (bx, by, bw, bh) => {
    if (bw < 20 || bh < 20) return;
    const ks = Math.min(bh * 0.5, bw * 0.3);
    const ledge = Math.min(bh, bw) * 0.12;
    const side = Math.min(bh - ledge, (bw - ks * 0.8) * 0.98);
    const total = side + ks * 0.8;
    const x0 = bx + (bw - total) / 2, y0 = by + (bh - side - ledge) / 2;
    const rect = { x: x0, y: y0, w: side, h: side };
    aMini(g, rect, lv2, U.t);
    const kn = side * 0.26;
    aKitten(g, x0 + side / 2, y0 + side + kn * 0.18, kn, { stage: 0, loops: 4, flinch: 0, freeT: -1, breed: 0, coat: 0, golden: false, t: U.t, loopColors: [0, 3, 1, 2] });
    const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
    aKitty(g, x0 + side + ks * 0.42, y0 + side + ledge * 0.6, ks, 'idle', U.t, wear);
  };
  if (!land) {
    const logoH0 = Math.min(H * 0.24, 170 * d);
    const fixed = (14 + 8 + 12 + 72 + 16 + 64 + 8 + (canLink ? 22 : 0) + 10) * d;
    const k = Math.min(1, H / (fixed + 90 * d + logoH0));
    const e = d * k, logoH = logoH0 * k;
    let y = 14 * e;
    drawLogo(g, W / 2, y + logoH / 2, Math.min(W - 24 * e, 460 * e), logoH);
    y += logoH + 8 * e;
    const bh = H - fixed * k - logoH;
    boardBlock(12 * e, y, W - 24 * e, bh);
    y += bh + 12 * e;
    playBtn(W / 2, y, Math.min(W - 48 * e, 280 * e), e);
    y += 72 * e + 16 * e;
    iconsRow(W / 2, y, e, W - 24 * e);
    y += 64 * e + 8 * e;
    link(y + 11 * e, e);
  } else {
    const colW = W * 0.5;
    const logoH0 = Math.min(H * 0.32, 180 * d);
    const fixed = (72 + 18 + 64 + 18 + (canLink ? 26 : 0) + 24) * d;
    const k = Math.min(1, (H - 16 * d) / (fixed + logoH0));
    const e = d * k, logoH = logoH0 * k;
    let y = (H - (fixed * k + logoH)) / 2 + 8 * e;
    const cx = colW / 2 + 8 * e;
    drawLogo(g, cx, y + logoH / 2, Math.min(colW - 32 * e, 440 * e), logoH);
    y += logoH + 18 * e;
    playBtn(cx, y, Math.min(colW - 48 * e, 280 * e), e);
    y += 72 * e + 18 * e;
    iconsRow(cx, y, e, colW - 32 * e);
    link(H - 16 * e, e);
    boardBlock(colW + 8 * e, H * 0.1, W - colW - 24 * e, H * 0.8);
  }
}

// ---------- map ----------
function mapM(S) {
  const d = U.du, W = S.W, H = S.H, inset = layoutOf(S).inset || 0;
  const topH = 60 * d, playH = 52 * d, botH = playH + 24 * d + inset;
  const dy = 66 * d, gap = 90 * d;
  const yc = i => (i - 1) * dy + (worldOf(Math.min(LEVELS, i)) - 1) * gap;
  const baseY = H - botH - 56 * d;
  const topY = yc(LEVELS) + 150 * d;
  const maxScroll = Math.max(0, topY - (baseY - topH - 20 * d));
  const amp = Math.min(W * 0.27, 120 * d);
  return { d, W, H, topH, playH, botH, dy, gap, yc, baseY, maxScroll, amp, cx: W / 2, inset };
}
const nY = (mm, Y) => mm.baseY - Y + U.map.scroll;
const nX = (mm, i) => mm.cx + Math.sin(i * 0.95) * mm.amp;
function mapFocus(S, snap) {
  const mm = mapM(S), cur = Math.min(LEVELS, safe(() => M.cur(), 1));
  U.map.sel = cur;
  const s = clamp(mm.yc(cur) - mm.baseY + mm.topH + (mm.H - mm.topH - mm.botH) * 0.55, 0, mm.maxScroll);
  if (snap) { U.map.scroll = s; U.map.v = 0; U.map.target = null; } else U.map.target = s;
}
function mapUpdate(dt, S) {
  const mm = mapM(S), m = U.map;
  if (m.target != null) { m.scroll = lerp(m.scroll, m.target, 1 - Math.exp(-8 * dt)); if (Math.abs(m.scroll - m.target) < 0.5) m.target = null; }
  else if (!m.drag && Math.abs(m.v) > 1) { m.scroll += m.v * dt; m.v *= Math.exp(-3.5 * dt); }
  if (m.scroll < 0 || m.scroll > mm.maxScroll) { m.scroll = clamp(m.scroll, 0, mm.maxScroll); m.v = 0; }
}
function mapSelect(id) {
  const S = U.S, mm = mapM(S);
  U.map.sel = id;
  const y = nY(mm, mm.yc(id));
  if (y < mm.topH + 40 * mm.d || y > mm.H - mm.botH - 30 * mm.d) U.map.target = clamp(mm.yc(id) - mm.baseY + mm.topH + (mm.H - mm.topH - mm.botH) * 0.55, 0, mm.maxScroll);
}
function shapeIcon(g, shape, x, y, s, col) {
  g.save(); g.translate(x, y); g.fillStyle = col; g.beginPath();
  const k = s / 2;
  if (shape === 'heart') { g.moveTo(0, k * 0.7); g.bezierCurveTo(-k * 1.1, -k * 0.1, -k * 0.5, -k * 0.95, 0, -k * 0.35); g.bezierCurveTo(k * 0.5, -k * 0.95, k * 1.1, -k * 0.1, 0, k * 0.7); }
  else if (shape === 'moon') { g.arc(0, 0, k * 0.75, 0.6, Math.PI * 2 - 0.6); g.arc(k * 0.35, -k * 0.1, k * 0.55, Math.PI * 2 - 0.9, 0.9, true); }
  else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? k * 0.4 : k * 0.85; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } }
  else if (shape === 'pumpkin') { g.ellipse(0, k * 0.1, k * 0.85, k * 0.65, 0, 0, 7); g.rect(-k * 0.1, -k * 0.8, k * 0.2, k * 0.35); }
  else { g.arc(0, k * 0.1, k * 0.62, 0, 7); g.moveTo(-k * 0.6, -k * 0.1); g.lineTo(-k * 0.5, -k * 0.85); g.lineTo(-k * 0.1, -k * 0.45); g.moveTo(k * 0.6, -k * 0.1); g.lineTo(k * 0.5, -k * 0.85); g.lineTo(k * 0.1, -k * 0.45); }
  g.closePath(); g.fill(); g.restore();
}
function chestIcon(g, x, y, s, open) {
  g.save(); g.translate(x, y);
  const w = s, h = s * 0.62, lw = Math.max(1.5, s * 0.07);
  g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = INK;
  rr(g, -w / 2, -h * 0.2, w, h * 0.7, s * 0.08); g.fillStyle = '#9A6A45'; g.fill(); g.stroke();
  if (open) {
    g.beginPath(); g.moveTo(-w / 2, -h * 0.2); g.lineTo(-w * 0.42, -h * 0.85); g.lineTo(w * 0.42, -h * 0.85); g.lineTo(w / 2, -h * 0.2); g.closePath(); g.fillStyle = '#6B4329'; g.fill(); g.stroke();
    g.fillStyle = GOLD; g.beginPath(); g.arc(-w * 0.15, -h * 0.25, s * 0.1, 0, 7); g.arc(w * 0.12, -h * 0.28, s * 0.1, 0, 7); g.fill();
  } else {
    g.beginPath(); g.moveTo(-w / 2, -h * 0.2); g.quadraticCurveTo(0, -h * 0.95, w / 2, -h * 0.2); g.closePath(); g.fillStyle = '#6B4329'; g.fill(); g.stroke();
  }
  g.fillStyle = '#E0A93B'; g.fillRect(-w * 0.08, -h * 0.35, w * 0.16, h * 0.4); g.strokeRect(-w * 0.08, -h * 0.35, w * 0.16, h * 0.4);
  g.restore();
}
function trophy(g, x, y, s) {
  g.save(); g.translate(x, y); g.lineWidth = Math.max(1.5, s * 0.06); g.strokeStyle = INK; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-s * 0.35, -s * 0.5); g.lineTo(s * 0.35, -s * 0.5); g.quadraticCurveTo(s * 0.35, s * 0.05, 0, s * 0.12); g.quadraticCurveTo(-s * 0.35, s * 0.05, -s * 0.35, -s * 0.5);
  g.fillStyle = GOLD; g.fill(); g.stroke();
  g.beginPath(); g.arc(-s * 0.38, -s * 0.3, s * 0.13, Math.PI * 0.5, Math.PI * 1.5); g.moveTo(s * 0.38, -s * 0.43); g.arc(s * 0.38, -s * 0.3, s * 0.13, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
  g.fillStyle = GOLD_D; g.fillRect(-s * 0.07, s * 0.1, s * 0.14, s * 0.2); g.strokeRect(-s * 0.07, s * 0.1, s * 0.14, s * 0.2);
  rr(g, -s * 0.25, s * 0.3, s * 0.5, s * 0.14, s * 0.04); g.fillStyle = '#6B4329'; g.fill(); g.stroke();
  g.restore();
}
function drawMap(g, S) {
  const mm = mapM(S), d = mm.d, W = mm.W, H = mm.H;
  const cur = safe(() => M.cur(), 1), sel = clamp(U.map.sel || 1, 1, Math.min(cur, LEVELS));
  U.map.sel = sel;
  const span = mm.dy + mm.gap;
  // world bands
  for (let w = 1; w <= 6; w++) {
    const lo = w === 1 ? mm.yc(1) - 420 * d : mm.yc(10 * (w - 1)) + 0.62 * span;
    const hi = w === 6 ? mm.yc(LEVELS) + 420 * d : mm.yc(10 * w) + 0.62 * span;
    const top = nY(mm, hi), bot = nY(mm, lo);
    if (bot < 0 || top > H) continue;
    const rect = { x: 0, y: top, w: W, h: bot - top };
    aVignette(g, rect, w, U.t);
    if (cur < (w - 1) * PER_WORLD + 1) { g.fillStyle = 'rgba(43,36,64,0.38)'; g.fillRect(0, Math.max(0, top), W, Math.min(H, bot) - Math.max(0, top)); }
  }
  // path
  const vis = i => { const y = nY(mm, mm.yc(i)); return y > -mm.dy * 2 && y < H + mm.dy * 2; };
  const pts = [];
  for (let i = 1; i <= LEVELS; i++) pts.push([nX(mm, i), nY(mm, mm.yc(i))]);
  const strokePath = (from, to, casing, body, width, dash) => {
    if (to < from) return;
    g.beginPath();
    g.moveTo(pts[from - 1][0], pts[from - 1][1]);
    for (let i = from; i < to; i++) {
      const a = pts[i - 1], b = pts[i];
      g.bezierCurveTo(a[0], a[1] - (a[1] - b[1]) * 0.5, b[0], b[1] + (a[1] - b[1]) * 0.5, b[0], b[1]);
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (dash) g.setLineDash(dash);
    g.lineWidth = width + 4 * d; g.strokeStyle = casing; g.stroke();
    g.lineWidth = width; g.strokeStyle = body; g.stroke();
    g.setLineDash([]);
  };
  let f = 1; while (f < LEVELS && !vis(f) && !vis(f + 1)) f++;
  let l = LEVELS; while (l > 1 && !vis(l) && !vis(l - 1)) l--;
  f = Math.max(1, f - 1); l = Math.min(LEVELS, l + 1);
  const reach = Math.min(cur, LEVELS);
  strokePath(Math.max(f, reach), l, 'rgba(43,36,64,0.45)', '#CFC6BE', 5 * d, [10 * d, 8 * d]);
  strokePath(f, Math.min(l, reach), INK, TOMATO, 7 * d, null);
  if (reach >= f) { g.save(); g.setLineDash([3 * d, 7 * d]); strokePath(f, Math.min(l, reach), 'rgba(0,0,0,0)', TOMATO_D, 2 * d, [3 * d, 7 * d]); g.restore(); }
  // chests + world labels
  for (let w = 1; w <= 6; w++) {
    const cy = nY(mm, mm.yc(10 * w) + (w < 6 ? 0.4 * span : 70 * d));
    const cx = w < 6 ? lerp(nX(mm, 10 * w), nX(mm, 10 * w + 1), 0.42) : mm.cx + mm.amp * 0.65;
    if (cy > -40 * d && cy < H + 40 * d) chestIcon(g, cx, cy, 34 * d, safe(() => M.chestClaimed(w), false));
    const ly = w === 1 ? nY(mm, mm.yc(1) - 50 * d) : nY(mm, mm.yc(10 * (w - 1)) + 0.78 * span);
    if (ly > -30 * d && ly < H + 30 * d) {
      const locked = cur < (w - 1) * PER_WORLD + 1;
      const label = `World ${w} · ${WORLDS[w].name}`;
      const s = fitSize(g, label, Math.min(W - 40 * d, 300 * d), 15 * d, FT, '', 0.25);
      const lw = tw(g, label, s) + 28 * d, lh = s * 1.7;
      rr(g, mm.cx - lw / 2, ly - lh / 2, lw, lh, lh / 2); g.fillStyle = locked ? '#8F8580' : TEAL; g.fill(); g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
      txt(g, label, mm.cx, ly + s * 0.04, s, { col: '#fff', stroke: INK, sk: 0.22 });
    }
  }
  // trophy
  const ty = nY(mm, mm.yc(LEVELS) + 130 * d);
  if (ty > -60 * d && ty < H + 60 * d) trophy(g, mm.cx - mm.amp * 0.3, ty, 54 * d);
  // nodes
  U.map.nodes = [];
  const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
  for (let i = f; i <= l; i++) {
    const x = pts[i - 1][0], y = pts[i - 1][1];
    const boss = i % PER_WORLD === 0, r = (boss ? 23 : 17) * d;
    const st = safe(() => M.stars(i), 0), open = i <= cur, isCur = i === Math.min(cur, LEVELS) && cur <= LEVELS;
    g.save();
    g.beginPath(); g.arc(x + 1.5 * d, y + 3 * d, r, 0, 7); g.fillStyle = 'rgba(43,36,64,0.35)'; g.fill();
    if (isCur) { const p = 0.5 + 0.5 * Math.sin(U.t * 4); g.beginPath(); g.arc(x, y, r + (4 + 4 * p) * d, 0, 7); g.lineWidth = 3 * d; g.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * p})`; g.stroke(); }
    if (i === sel && open) { g.beginPath(); g.arc(x, y, r + 4 * d, 0, 7); g.lineWidth = 4 * d; g.strokeStyle = GOLD; g.stroke(); }
    g.beginPath(); g.arc(x, y, r, 0, 7);
    g.fillStyle = !open ? GREY : isCur ? TOMATO : CREAM; g.fill();
    g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
    if (boss) shapeIcon(g, (safe(() => LV.getLevel(i), {}) || {}).shape || BOSS_SHAPE[i], x, y, r * 1.45, !open ? 'rgba(43,36,64,0.18)' : isCur ? 'rgba(255,255,255,0.25)' : 'rgba(232,70,58,0.18)');
    if (!open) aIcon(g, 'lock', x, y, r * 1.0, 'rgba(43,36,64,0.75)');
    else txt(g, String(i), x, y + r * 0.06, r * 0.95, { col: isCur ? '#fff' : INK, stroke: isCur ? INK : null, sk: 0.2, maxW: r * 1.55 });
    if (open && i < cur) for (let j = 0; j < 3; j++) aStar(g, x + (j - 1) * 12 * d, y + r + 8 * d - (j === 1 ? 2 * d : 0), 6 * d, j < st, 0);
    g.restore();
    if (open) U.map.nodes.push({ id: i, x, y, r });
    else U.map.nodes.push({ id: i, x, y, r, locked: true });
    if (isCur) {
      const side = Math.sin(i * 0.95) > 0 ? -1 : 1;
      aKitty(g, x + side * (r + 22 * d), y + r * 0.8, 44 * d, 'idle', U.t, wear);
    }
  }
  if (cur > LEVELS && ty > -60 * d && ty < H + 60 * d) aKitty(g, mm.cx + mm.amp * 0.3, ty + 30 * d, 50 * d, 'celebrate', U.t, wear);
  // top bar
  g.fillStyle = CREAM; g.fillRect(0, 0, W, mm.topH);
  g.fillStyle = INK; g.fillRect(0, mm.topH - 3 * d, W, 3 * d);
  g.save(); g.setLineDash([6 * d, 5 * d]); g.strokeStyle = STITCH; g.lineWidth = 1.6 * d; g.beginPath(); g.moveTo(0, mm.topH - 9 * d); g.lineTo(W, mm.topH - 9 * d); g.stroke(); g.restore();
  const bw = Math.min(W, 560 * d), bx = (W - bw) / 2, cy = (mm.topH - 4 * d) / 2, ir = 21 * d;
  iconBtn(g, { id: 'm-home', label: 'Home', x: bx + 8 * d, y: cy - ir, w: 2 * ir, h: 2 * ir, icon: 'home', act: () => api.go('title') });
  const dl = safe(() => M.daily(), { unlocked: false, won: true });
  iconBtn(g, { id: 'm-daily', label: 'Daily', x: bx + bw - 8 * d - 2 * ir, y: cy - ir, w: 2 * ir, h: 2 * ir, icon: 'calendar', dot: dl.unlocked && !dl.won, act: () => api.go('daily') });
  const midL = bx + 8 * d + 2 * ir + 10 * d, midR = bx + bw - 8 * d - 2 * ir - 10 * d, midW = midR - midL;
  // star bar to the next gift
  const ng = safe(() => M.nextGift(), { have: 0, need: 15 });
  const sw = midW * 0.6, sx = midL;
  const lbl = `${ng.have} / ${ng.need}`;
  aStar(g, sx + 11 * d, cy - 6 * d, 10 * d, true, 0);
  txt(g, lbl, sx + 25 * d, cy - 6 * d, 18 * d, { align: 'left', maxW: sw - 28 * d });
  const barY = cy + 9 * d, barW = sw - 6 * d, prev = Math.floor(ng.have / 15) * 15, p = ng.need > prev ? (ng.have - prev) / (ng.need - prev) : 1;
  rr(g, sx + 3 * d, barY, barW, 7 * d, 3.5 * d); g.fillStyle = STITCH; g.fill();
  rr(g, sx + 3 * d, barY, Math.max(7 * d, barW * clamp(p, 0, 1)), 7 * d, 3.5 * d); g.fillStyle = GOLD; g.fill();
  rr(g, sx + 3 * d, barY, barW, 7 * d, 3.5 * d); g.lineWidth = Math.max(1, 1.6 * d); g.strokeStyle = INK; g.stroke();
  // balls (tap → shop)
  const bal = String(safe(() => M.balance(), 0));
  const bx2 = midL + sw + 6 * d, bw2 = midW - sw - 6 * d;
  reg({ id: 'm-balls', label: 'Shop', x: bx2, y: cy - 18 * d, w: bw2, h: 36 * d, act: () => api.go('shop') });
  rr(g, bx2, cy - 15 * d, bw2, 30 * d, 15 * d); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(1, 2 * d); g.strokeStyle = INK; g.stroke();
  aIcon(g, 'ball', bx2 + 15 * d, cy, 20 * d);
  txt(g, bal, bx2 + 28 * d + (bw2 - 34 * d) / 2, cy + 1 * d, 17 * d, { maxW: bw2 - 34 * d });
  // bottom PLAY
  const pw = Math.min(W - 24 * d, 300 * d), py = H - mm.inset - 12 * d - mm.playH;
  pill(g, { id: 'map-play', label: `PLAY L${sel}`, kind: 'primary', x: (W - pw) / 2, y: py, w: pw, h: mm.playH, act: () => api.go('play', { kind: 'level', id: sel }) });
}

// ---------- play HUD, tray, callouts, hand ----------
function drawPlayUI(g, S) {
  const L = layoutOf(S), live = S.screen === 'play' && !U.card;
  const wasReg = U.reg;
  U.reg = live;
  drawHUD(g, S, live);
  drawBoosters(g, S);
  if (S.screen === 'play') {
    drawCallout(g, S, L);
    drawPop(g, S, L);
    drawAttn(g, S);
    drawGhost(g, S, L);
    drawFly(g, S, L);
    drawHand(g, S);
  }
  U.reg = wasReg;
  if (S.screen === 'pause') drawPause(g, S);
}
function drawHUD(g, S, live) {
  const L = layoutOf(S), u = L.u, h = L.hud, sess = S.sess;
  if (!sess) return;
  const dd = Math.min(46 * u, h.h - 6), cy = h.y + h.h / 2;
  const showBtns = S.screen === 'play' || S.screen === 'pause';
  if (showBtns) {
    iconBtn(g, { id: 'hud-pause', label: 'Pause', x: h.x + L.m, y: cy - dd / 2, w: dd, h: dd, icon: 'pause', act: () => api.pause(), d: u });
    iconBtn(g, { id: 'hud-retry', label: 'Retry level', x: h.x + h.w - L.m - dd, y: cy - dd / 2, w: dd, h: dd, icon: 'retry', act: () => api.retry(), d: u });
  }
  const lv = sess.level || {};
  const title = sess.kind === 'level' ? `Level ${sess.id}` : lv.name || (sess.kind === 'daily' ? 'Daily Knot' : 'Bonus Tangle');
  const sub = sess.kind === 'level' ? (WORLDS[worldOf(sess.id)] || {}).name || '' : sess.kind === 'daily' ? 'New board every day' : 'Endless tangles';
  const maxW = h.w - 2 * (L.m + dd + 8);
  const ts = Math.min(22 * u, h.h * 0.44);
  txt(g, title, h.x + h.w / 2, h.y + h.h * 0.38, ts, { col: '#fff', stroke: INK, sk: 0.22, maxW });
  txt(g, sub, h.x + h.w / 2, h.y + h.h * 0.8, Math.min(13 * u, h.h * 0.26), { f: FB, w: '800', col: CREAM, stroke: INK, sk: 0.3, maxW });
}
function drawBoosters(g, S) {
  const L = layoutOf(S), sess = S.sess;
  if (!sess || S.screen === 'win') return;
  const keys = BK.filter(k => safe(() => M.boosterUnlocked(k), false));
  if (!keys.length) return;
  const rs = boosterRects(L, keys);
  for (const k of keys) {
    const r = rs[k];
    if (!r) continue;
    const n = safe(() => M.booster(k), 0);
    const hintOn = k === 'hint' && sess.hint && S.T < sess.hint.until;
    const pulse = k === 'undo' && (sess.doomed || U.t < U.undoPulse);
    const flying = U.fly.some(f => f.k === k && U.t < f.t0 + f.dur);
    iconBtn(g, { id: 'b-' + k, label: BNAME[k], x: r.x, y: r.y, w: r.w, h: r.h, hit: r.hit, icon: k, d: L.u,
      badge: flying ? null : n > 0 ? { n } : { price: BOOSTERS[k].price }, ring: sess.boosterArm === k || hintOn ? GOLD : pulse ? TOMATO : null,
      act: () => tapBooster(k) });
  }
}
function drawCallout(g, S, L) {
  const c = U.callout;
  if (!c || U.pop || U.card) return;
  const b = L.callout, u = L.u;
  const a = Math.min(1, c.t / 0.15, Math.max(0, (c.dur - c.t) / 0.2));
  if (a <= 0) return;
  const padX = 14 * u, maxW = b.w - 2 * padX;
  const wf = wrapFit(g, c.text, maxW, b.h * 0.86, Math.min(18 * u, b.h * 0.62), 13 * u, FB, '800');
  const textW = Math.max(...wf.lines.map(l => tw(g, l, wf.size, FB, '800')));
  const pw = Math.min(b.w, textW + 2 * padX), ph = Math.min(b.h, wf.size * 1.14 * wf.lines.length + 10 * u);
  g.save();
  g.globalAlpha = a;
  const sc = 0.92 + 0.08 * e3(c.t / 0.15), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
  rr(g, cx - pw / 2, cy - ph / 2, pw, ph, Math.min(ph / 2, 16 * u)); g.fillStyle = CREAM; g.fill();
  g.lineWidth = Math.max(1.5, 2.5 * u); g.strokeStyle = INK; g.stroke();
  lines(g, wf, cx, cy + wf.size * 0.04);
  g.restore();
}
function drawPop(g, S, L) {
  const p = U.pop;
  if (!p || U.card) return;
  const rs = safe(() => rackSlots(L), null);
  if (!rs) return;
  const sl = p.slot >= 0 && rs.active[p.slot] ? rs.active[p.slot] : rs.active[0];
  const u = L.u, k = p.t / p.dur;
  const x = clamp(sl.x, L.rack.x + 60 * u, L.rack.x + L.rack.w - 60 * u), y = sl.y - sl.h * 0.55 - 14 * u * e3(k);
  g.save();
  g.globalAlpha = Math.min(1, (1 - k) / 0.25);
  const sc = eBack(p.t / 0.22);
  g.translate(x, y); g.scale(sc, sc);
  txt(g, p.text, 0, 0, 26 * u, { col: GOLD, stroke: INK, sk: 0.24, maxW: Math.min(L.rack.w * 0.7, 220 * u) });
  g.restore();
}
function drawAttn(g) {
  for (const a of U.attn) {
    const t = U.t - a.t0;
    if (t < 0) continue;
    const p = t / a.dur, bounce = Math.abs(Math.sin(p * Math.PI * 2)) * (1 - p);
    g.save();
    g.globalAlpha = Math.min(1, (1 - p) * 2);
    g.beginPath(); g.arc(a.x, a.y - bounce * a.r * 0.25, a.r * (1 + 0.12 * bounce), 0, 7);
    g.lineWidth = Math.max(2.5, a.r * 0.12); g.strokeStyle = GOLD; g.stroke();
    g.lineWidth = Math.max(1, a.r * 0.04); g.strokeStyle = INK; g.stroke();
    g.restore();
  }
}
function drawGhost(g, S, L) {
  const gh = U.ghost, sess = S.sess;
  if (!gh || !sess || !sess.geo || !sess.geo[gh.id]) return;
  const geo = sess.geo[gh.id], t = U.t - gh.t0;
  const slots = safe(() => basketSlots(L, (sess.basket || []).length || 3), []);
  const to = slots[gh.slot] || slots[0];
  if (!to) return;
  // basket pulse
  const b = L.basket, pul = 0.5 + 0.5 * Math.sin(U.t * 8);
  g.save(); rr(g, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 14 * L.u); g.lineWidth = Math.max(2, 4 * L.u); g.strokeStyle = `rgba(255,178,63,${0.45 + 0.5 * pul})`; g.stroke(); g.restore();
  if (t > 1.1) return;
  if (!geo.c0) { let sx = 0, sy = 0; const pts = geo.pts || [[to.x, to.y]]; for (const q of pts) { sx += q[0]; sy += q[1]; } geo.c0 = [sx / pts.length, sy / pts.length]; }
  const p = e3(t / 0.8), [cx, cy] = geo.c0, s = lerp(1, 0.2, p);
  const st = strandOf(S, gh.id) || { c: 0 };
  g.save();
  g.globalAlpha = 0.55 * Math.min(1, t / 0.1) * (t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.3) : 1);
  g.translate(lerp(cx, to.x, p), lerp(cy, to.y, p)); g.scale(s, s); g.translate(-cx, -cy);
  aStrand(g, geo, st.c, (sess.B && sess.B.sw) || 10, { lift: true, glow: true });
  g.restore();
}
function drawFly(g, S, L) {
  if (!U.fly.length) return;
  const keys = BK.filter(k => safe(() => M.boosterUnlocked(k), false));
  const rs = boosterRects(L, keys);
  const from = { x: L.board.x + L.board.w / 2, y: L.board.y + L.board.h * 0.45 };
  for (const f of U.fly) {
    const r = rs[f.k], t = (U.t - f.t0) / f.dur;
    if (!r || t < 0 || t > 1.3) continue;
    const to = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, p = e3(Math.min(1, t));
    const x = lerp(from.x, to.x, p), y = lerp(from.y, to.y, p) - Math.sin(p * Math.PI) * 80 * L.u;
    const s = Math.min(r.w, 46 * L.u) * (t > 1 ? 1 + (t - 1) * 1.5 : lerp(1.4, 0.9, p));
    g.save(); g.globalAlpha = t > 1 ? Math.max(0, 1 - (t - 1) / 0.3) : 1;
    g.beginPath(); g.arc(x, y, s * 0.55, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 2.5 * L.u; g.strokeStyle = INK; g.stroke();
    aIcon(g, f.k, x, y, s * 0.6, INK);
    g.restore();
  }
}
function drawHand(g, S) {
  const sess = S.sess;
  if (!sess || U.card) return;
  let h = U.hand;
  if (sess.hint && sess.hint.id >= 0 && S.T < sess.hint.until) h = { id: sess.hint.id, t0: sess.hint.until - 4 };
  if (!h || U.t < h.t0 && h !== U.hand) return;
  if (h === U.hand && U.t < h.t0) return;
  const pt = tapPoint(h.id);
  if (!pt) return;
  const unit = (sess.B && sess.B.unit) || 40, s = clamp(unit * 0.95, 28, 64);
  const ph = (((U.t - h.t0) % 1.6) + 1.6) % 1.6 / 1.6;
  let off = 0, press = false, al = 1;
  if (ph < 0.35) off = 1 - e3(ph / 0.35);
  else if (ph < 0.6) press = ph > 0.42;
  if (ph < 0.08) al = ph / 0.08;
  if (ph > 0.85) al = 1 - (ph - 0.85) / 0.15;
  g.save(); g.globalAlpha = al;
  aHand(g, pt.x + off * s * 0.8, pt.y + off * s * 0.9, s, press);
  g.restore();
}

// ---------- pause ----------
function drawPause(g, S) {
  dim(g, S, 0.5);
  const d = U.du, W = S.W, H = S.H - (layoutOf(S).inset || 0);
  const pw = Math.min(W - 24 * d, 360 * d), px = (W - pw) / 2, pad = 20 * d, iw = pw - 2 * pad;
  const set = safe(() => M.settings(), { music: 0.7, sfx: 0.9, haptics: true });
  const list = [
    { h: 46, fn: (y, hh, e) => txt(g, 'Paused', W / 2, y + hh / 2, 32 * e, { maxW: iw }) },
    { h: 8 },
    { h: 58, fn: (y, hh, e) => pill(g, { id: 'p-resume', label: 'Resume', kind: 'primary', x: px + pad, y, w: iw, h: 54 * e, act: () => api.resume(), d: e }) },
    { h: 56, fn: (y, hh, e) => {
      const bw = (iw - 10 * e) / 2;
      pill(g, { id: 'p-restart', label: 'Restart', kind: 'secondary', x: px + pad, y, w: bw, h: 48 * e, act: () => api.retry(), d: e });
      pill(g, { id: 'p-map', label: 'Map', kind: 'secondary', x: px + pad + bw + 10 * e, y, w: bw, h: 48 * e, act: () => api.go('map'), d: e });
    } },
    { h: 8 },
    { h: 44, fn: (y, hh, e) => slider(g, { k: 'music', label: 'Music', x: px + pad, y, w: iw, h: hh, v: set.music, d: e }) },
    { h: 44, fn: (y, hh, e) => slider(g, { k: 'sfx', label: 'Sounds', x: px + pad, y, w: iw, h: hh, v: set.sfx, d: e }) },
  ];
  if (hasVibrate()) list.push({ h: 44, fn: (y, hh, e) => toggle(g, { id: 'p-haptics', label: 'Haptics', x: px + pad, y, w: iw, h: hh, on: set.haptics, d: e, act: () => setSet('haptics', !set.haptics) }) });
  const lay = rows(list, d, H - 24 * d - 2 * pad);
  const ph = lay.h + 2 * pad * lay.k, py = (H - ph) / 2;
  panel(g, px, py, pw, ph, d);
  lay.run(py + pad * lay.k);
}
function setSet(k, v) { safe(() => M.setSetting(k, v)); bus.emit('settings', { k, v }); }

// ---------- generic dialog frame ----------
function dialogFrame(g, S, maxW, list, opt = {}) {
  const d = U.du, W = S.W, H = S.H - (layoutOf(S).inset || 0);
  const pw = Math.min(W - 20 * d, maxW * d), px = (W - pw) / 2, pad = 18 * d;
  const lay = rows(list(pw - 2 * pad, px + pad), d, H - 20 * d - 2 * pad);
  const ph = opt.full ? H - 20 * d : lay.h + 2 * pad * lay.k, py = (H - ph) / 2;
  panel(g, px, py, pw, ph, d);
  lay.run(py + pad * lay.k + (opt.full ? (ph - lay.h - 2 * pad * lay.k) / 2 : 0));
  return { px, py, pw, ph, k: lay.k };
}

// ---------- settings ----------
function drawSettings(g, S) {
  const set = safe(() => M.settings(), { music: 0.7, sfx: 0.9, haptics: true });
  const W = S.W, close = () => api.go(U.ret);
  const fr = dialogFrame(g, S, 380, (iw, x0) => {
    const l = [
      { h: 46, fn: (y, hh, e) => txt(g, 'Settings', W / 2, y + hh / 2, 30 * e, { maxW: iw }) },
      { h: 6 },
      { h: 46, fn: (y, hh, e) => slider(g, { k: 'music', label: 'Music', x: x0, y, w: iw, h: hh, v: set.music, d: e }) },
      { h: 46, fn: (y, hh, e) => slider(g, { k: 'sfx', label: 'Sounds', x: x0, y, w: iw, h: hh, v: set.sfx, d: e }) },
    ];
    if (hasVibrate()) l.push({ h: 46, fn: (y, hh, e) => toggle(g, { id: 's-haptics', label: 'Haptics', x: x0, y, w: iw, h: hh, on: set.haptics, d: e, act: () => setSet('haptics', !set.haptics) }) });
    l.push({ h: 10 });
    l.push({ h: 50, fn: (y, hh, e) => {
      const arm = U.reset && U.t < U.reset;
      const label = arm ? 'Tap again to reset' : 'Reset progress';
      const bw = Math.min(iw, 260 * e);
      pill(g, { id: 's-reset', label, kind: 'cream', x: W / 2 - bw / 2, y, w: bw, h: 44 * e, d: e, act: () => {
        if (U.reset && U.t < U.reset) { U.reset = 0; safe(() => M.resetAll()); toast('Progress reset'); }
        else { U.reset = U.t + 3; }
      } });
      if (arm) { rr(g, W / 2 - bw / 2, y, bw, 44 * e, 22 * e); g.lineWidth = 3 * e; g.strokeStyle = TOMATO; g.stroke(); }
    } });
    l.push({ h: 30, fn: (y, hh, e) => txt(g, 'Fonts: Lilita One, Nunito (SIL OFL)', W / 2, y + hh / 2, 12 * e, { f: FB, w: '700', col: '#6E6377', maxW: iw }) });
    l.push({ h: 6 });
    l.push({ h: 56, fn: (y, hh, e) => { const bw = Math.min(iw, 240 * e); pill(g, { id: 's-close', label: 'CLOSE', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, act: close, d: e }); } });
    return l;
  });
  return fr;
}

// ---------- shop ----------
function drawShop(g, S) {
  const d = U.du, W = S.W, H = S.H - (layoutOf(S).inset || 0);
  const pw = Math.min(W - 16 * d, 560 * d), ph = Math.min(H - 16 * d, 760 * d), px = (W - pw) / 2, py = (H - ph) / 2;
  panel(g, px, py, pw, ph, d);
  const pad = 16 * d, ix = px + pad, iw = pw - 2 * pad;
  // header
  const hy = py + pad + 20 * d;
  closeX(g, px + pw - pad - 14 * d, hy, d, () => api.go(U.ret));
  const bal = String(safe(() => M.balance(), 0));
  const chipS = 17 * d, chipW = tw(g, bal, chipS) + 44 * d, chipX = px + pw - pad - 42 * d - chipW;
  rr(g, chipX, hy - 15 * d, chipW, 30 * d, 15 * d); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = INK; g.stroke();
  aIcon(g, 'ball', chipX + 16 * d, hy, 20 * d);
  txt(g, bal, chipX + 30 * d + (chipW - 36 * d) / 2, hy + d, chipS, { maxW: chipW - 34 * d });
  txt(g, 'Shop', ix, hy, 28 * d, { align: 'left', maxW: chipX - ix - 8 * d });
  // tabs
  const ty = hy + 26 * d, th = 40 * d, tw2 = (iw - 8 * d) / 2;
  for (const [i, tab, label] of [[0, 'outfits', 'Outfits'], [1, 'boosters', 'Boosters']]) {
    const on = U.shop.tab === tab, x = ix + i * (tw2 + 8 * d);
    reg({ id: 'tab-' + tab, label, x, y: ty, w: tw2, h: th, act: () => { U.shop.tab = tab; } });
    rr(g, x, ty, tw2, th, th / 2); g.fillStyle = on ? TEAL : '#F6E6CF'; g.fill(); g.lineWidth = 2.5 * d; g.strokeStyle = INK; g.stroke();
    txt(g, label, x + tw2 / 2, ty + th / 2 + d, 18 * d, { col: on ? '#fff' : INK, stroke: on ? INK : null, sk: 0.2, maxW: tw2 - 16 * d });
  }
  const by = ty + th + 12 * d, bh = py + ph - pad - 58 * d - by;
  const footY = py + ph - pad - 54 * d, fw = Math.min(iw, 280 * d);
  if (U.shop.tab === 'outfits') {
    const list = safe(() => M.outfits(), []);
    const cols = clamp(Math.floor(iw / (150 * d)), 2, 4), rowsN = Math.ceil(list.length / cols);
    const gap = 8 * d, cw = (iw - gap * (cols - 1)) / cols, ch = Math.min((bh - gap * (rowsN - 1)) / rowsN, cw * 1.3);
    const y0 = by + (bh - (ch * rowsN + gap * (rowsN - 1))) / 2;
    list.forEach((o, i) => {
      const c = i % cols, r = Math.floor(i / cols), x = ix + c * (cw + gap), y = y0 + r * (ch + gap);
      const sel = U.shop.sel === o.id;
      reg({ id: 'o-' + o.id, label: o.name, x, y, w: cw, h: ch, act: () => { U.shop.sel = o.id; } });
      rr(g, x, y, cw, ch, 12 * d); g.fillStyle = sel ? '#FFF9EC' : '#F6E6CF'; g.fill();
      g.lineWidth = sel ? 4 * d : 2 * d; g.strokeStyle = sel ? GOLD_D : INK; g.stroke();
      const ks = Math.min(ch * 0.52, cw * 0.62);
      aKitty(g, x + cw / 2, y + 6 * d + ks, ks, o.worn ? 'cheer' : 'idle', U.t, o.id);
      const nameY = y + ks + 6 * d + (ch - ks - 6 * d) * 0.33, tagY = y + ks + 6 * d + (ch - ks - 6 * d) * 0.74;
      txt(g, o.name, x + cw / 2, nameY, Math.min(14 * d, (ch - ks) * 0.26), { f: FB, w: '800', maxW: cw - 10 * d });
      const ts = Math.min(14 * d, (ch - ks) * 0.26);
      if (o.worn) txt(g, 'WORN', x + cw / 2, tagY, ts, { col: TEAL_D, maxW: cw - 10 * d });
      else if (o.owned) txt(g, 'OWNED', x + cw / 2, tagY, ts, { col: INK, maxW: cw - 10 * d });
      else { const pw2 = tw(g, String(o.price), ts) + ts * 1.4; aIcon(g, 'ball', x + cw / 2 - pw2 / 2 + ts * 0.5, tagY, ts * 1.1); txt(g, String(o.price), x + cw / 2 + ts * 0.7, tagY, ts, { maxW: cw - ts * 3 }); }
    });
    const o = list.find(q => q.id === U.shop.sel) || list[0];
    if (o) {
      const label = o.worn ? 'WORN' : o.owned ? 'WEAR' : `BUY ${o.price}`;
      pill(g, { id: 'shop-main', label, kind: 'primary', x: px + pw / 2 - fw / 2, y: footY, w: fw, h: 52 * d, disabled: o.worn, act: () => {
        if (o.owned) { safe(() => M.wear(o.id)); bus.emit('buy', { item: o.id }); return; }
        if (safe(() => M.balance(), 0) < o.price) { U.shakes['shop-main'] = U.t; toast(`Need ${o.price - safe(() => M.balance(), 0)} more yarn balls`); return; }
        if (safe(() => M.buyOutfit(o.id), false)) { bus.emit('buy', { item: o.id }); toast(`${o.name}: worn!`); }
      } });
    }
  } else {
    const gap = 8 * d, rh = Math.min((bh - gap * 3) / 4, 96 * d);
    const y0 = by + (bh - (rh * 4 + gap * 3)) / 2;
    BK.forEach((k, i) => {
      const y = y0 + i * (rh + gap), unl = safe(() => M.boosterUnlocked(k), false), n = safe(() => M.booster(k), 0);
      g.save(); if (!unl) g.globalAlpha = 0.55;
      rr(g, ix, y, iw, rh, 12 * d); g.fillStyle = '#F6E6CF'; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = INK; g.stroke();
      const ir = Math.min(rh * 0.36, 23 * d);
      g.beginPath(); g.arc(ix + 10 * d + ir, y + rh / 2, ir, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 2.5 * d; g.stroke();
      aIcon(g, unl ? k : 'lock', ix + 10 * d + ir, y + rh / 2, ir * 1.05);
      const bw = Math.min(110 * d, iw * 0.3), tx = ix + 18 * d + 2 * ir, tW = iw - (tx - ix) - bw - 18 * d;
      txt(g, `${BNAME[k]}${unl ? '  ×' + n : ''}`, tx, y + rh * 0.3, Math.min(18 * d, rh * 0.26), { align: 'left', maxW: tW });
      const wf = wrapFit(g, unl ? BDESC[k] : `Unlocks at level ${BOOSTERS[k].unlock}`, tW, rh * 0.5, Math.min(13 * d, rh * 0.2), 10 * d, FB, '700');
      const lh = wf.size * 1.14;
      wf.lines.forEach((l2, j) => txt(g, l2, tx, y + rh * 0.66 + (j - (wf.lines.length - 1) / 2) * lh, wf.size, { f: FB, w: '700', align: 'left', col: '#5A5066' }));
      g.restore();
      if (unl) {
        const bh2 = Math.min(44 * d, rh * 0.6);
        pill(g, { id: 'l-' + k, label: 'Buy', kind: U.shop.bsel === k ? 'primary' : 'secondary', x: ix + iw - 10 * d - bw, y: y + rh / 2 - bh2 / 2, w: bw, h: bh2, d,
          badge: { price: BOOSTERS[k].price }, act: () => {
            U.shop.bsel = k;
            if (safe(() => M.buyBooster(k), false)) { bus.emit('buy', { item: k }); toast(`+1 ${BNAME[k]}`); }
            else { U.shakes['l-' + k] = U.t; toast('Not enough yarn balls'); }
          } });
      }
    });
    txt(g, 'Boosters help in any level', px + pw / 2, footY + 26 * d, 14 * d, { f: FB, w: '800', col: '#5A5066', maxW: iw });
  }
}

// ---------- kitten corner ----------
function silhouette(breed, coat, s, dpr) {
  const key = breed + '|' + coat + '|' + Math.round(s * dpr);
  let c = U.sil.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  const n = Math.ceil(s * 1.5 * dpr);
  c.width = c.height = Math.max(2, n);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  aKitten(x, s * 0.75, s * 1.38, s, { stage: 4, loops: 0, flinch: 0, freeT: -1, breed, coat, golden: false, t: 0, loopColors: [] });
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#8F8580'; x.fillRect(0, 0, c.width, c.height);
  if (U.sil.size > 80) U.sil.clear();
  U.sil.set(key, c);
  return c;
}
function portrait(g, id, cx, cy, s, st, dpr) {
  rr(g, cx - s / 2, cy - s / 2, s, s, s * 0.2); g.fillStyle = st ? '#FFF9EC' : '#EADCC8'; g.fill();
  g.lineWidth = st === 2 ? Math.max(2, s * 0.07) : Math.max(1, s * 0.03); g.strokeStyle = st === 2 ? GOLD : INK; g.stroke();
  const ks = s * 0.74;
  if (st) aKitten(g, cx, cy + s * 0.42, ks, { stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(id), coat: coatOf(id), golden: st === 2, t: 0, loopColors: [] });
  else {
    const c = silhouette(breedOf(id), coatOf(id), ks, dpr);
    if (c) g.drawImage(c, cx - ks * 0.75, cy + s * 0.42 - ks * 1.38, ks * 1.5, ks * 1.5);
    const pr = s * 0.17;
    g.beginPath(); g.arc(cx, cy + s * 0.18, pr, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = Math.max(1, s * 0.025); g.strokeStyle = INK; g.stroke();
    txt(g, '?', cx, cy + s * 0.19, pr * 1.4, { col: INK });
  }
}
function drawKittens(g, S) {
  const d = U.du, W = S.W, H = S.H - (layoutOf(S).inset || 0), land = isLand(S);
  const ks = safe(() => M.kittens(), Array(LEVELS).fill(0));
  const got = ks.filter(v => v > 0).length;
  const pw = Math.min(W - 16 * d, land ? 900 * d : 520 * d), ph = H - 16 * d, px = (W - pw) / 2, py = 8 * d;
  panel(g, px, py, pw, ph, d);
  const pad = 16 * d, ix = px + pad, iw = pw - 2 * pad;
  const hy = py + pad + 20 * d;
  closeX(g, px + pw - pad - 14 * d, hy, d, () => api.go(U.ret));
  const cnt = `${got} / ${LEVELS}`, cs = 18 * d, cw = tw(g, cnt, cs) + 16 * d;
  txt(g, cnt, px + pw - pad - 42 * d - cw / 2, hy + d, cs, { col: TEAL_D });
  txt(g, 'Kitten Corner', ix, hy, 26 * d, { align: 'left', maxW: iw - 50 * d - cw });
  const gy = hy + 28 * d, gh = py + ph - pad - 60 * d - gy;
  const cols = land ? 10 : 6, rowsN = LEVELS / cols;
  const cell = Math.min(iw / cols, gh / rowsN);
  const gw = cell * cols, gh2 = cell * rowsN, gx = ix + (iw - gw) / 2, gy2 = gy + (gh - gh2) / 2;
  const dpr = S.dpr || 1;
  const key = [Math.round(gw), Math.round(gh2), dpr, cols, ks.join('')].join('|');
  if (U.kc.key !== key && typeof document !== 'undefined') {
    const c = U.kc.cv || document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(gw * dpr)); c.height = Math.max(1, Math.ceil(gh2 * dpr));
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, gw, gh2);
    for (let i = 0; i < LEVELS; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      x.save(); portrait(x, i + 1, (col + 0.5) * cell, (row + 0.5) * cell, cell * 0.9, ks[i], dpr); x.restore();
    }
    U.kc = { key, cv: c };
  }
  if (U.kc.cv) g.drawImage(U.kc.cv, gx, gy2, gw, gh2);
  const fw = Math.min(iw, 240 * d);
  pill(g, { id: 'k-close', label: 'CLOSE', kind: 'primary', x: px + pw / 2 - fw / 2, y: py + ph - pad - 52 * d, w: fw, h: 52 * d, act: () => api.go(U.ret) });
}

// ---------- daily ----------
function addDays(key, n) { const t = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
function drawDaily(g, S) {
  const W = S.W, info = safe(() => M.daily(), { key: '2026-10-16', unlocked: false, won: false, streak: 0, stamps: Array(7).fill(false) });
  const close = () => api.go(U.ret);
  if (!info.unlocked) {
    const fr = dialogFrame(g, S, 360, (iw) => [
      { h: 44, fn: (y, hh, e) => txt(g, 'Daily Knot', W / 2, y + hh / 2, 28 * e, { maxW: iw }) },
      { h: 70, fn: (y, hh, e) => aIcon(g, 'lock', W / 2, y + hh / 2, 50 * e, INK) },
      { h: 52, fn: (y, hh, e) => lines(g, wrapFit(g, 'Beat level 6 to unlock', iw, hh, 18 * e, 13 * e), W / 2, y + hh / 2) },
      { h: 8 },
      { h: 56, fn: (y, hh, e) => { const bw = Math.min(iw, 200 * e); pill(g, { id: 'd-ok', label: 'OK', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, act: close, d: e }); } },
    ]);
    closeX(g, fr.px + fr.pw - 30 * U.du, fr.py + 32 * U.du * fr.k, U.du, close);
    return;
  }
  const key = info.key;
  if (U.dailyLv.key !== key) U.dailyLv = { key, lv: safe(() => LV.getDaily(key), null) };
  const streak = info.streak || 0;
  const istNow = Date.now() + 5.5 * 3600e3, left = 86400000 - (istNow % 86400000);
  const hh2 = Math.floor(left / 3600e3), mm2 = Math.floor((left % 3600e3) / 60e3);
  const reward = 70 + 10 * Math.min(streak + 1, 7);
  const fr = dialogFrame(g, S, 400, (iw, x0) => [
    { h: 44, fn: (y, hh, e) => txt(g, 'Daily Knot', W / 2, y + hh / 2, 28 * e, { maxW: iw - 80 * e }) },
    { h: 58, fn: (y, hh, e) => {
      const r = Math.min(17 * e, iw / 7 / 2 - 3 * e), sp = iw / 7;
      for (let i = 0; i < 7; i++) {
        const k2 = addDays(key, i - 6), wd = 'SMTWTFS'[new Date(k2 + 'T00:00:00Z').getUTCDay()];
        const x = x0 + sp * (i + 0.5), cy = y + hh * 0.62;
        txt(g, wd, x, y + hh * 0.14, 11 * e, { f: FB, w: '900', col: '#6E6377' });
        g.beginPath(); g.arc(x, cy, r, 0, 7); g.fillStyle = info.stamps[i] ? TOMATO : '#F6E6CF'; g.fill();
        g.lineWidth = i === 6 ? 3 * e : 2 * e; g.strokeStyle = i === 6 ? GOLD_D : INK; g.stroke();
        if (info.stamps[i]) aIcon(g, 'paw', x, cy, r * 1.15, '#fff');
      }
    } },
    { h: 32, fn: (y, hh, e) => {
      const label = `${streak} day streak`, s = 18 * e, w2 = tw(g, label, s) + 26 * e;
      flame(g, W / 2 - w2 / 2 + 9 * e, y + hh / 2, 20 * e, streak > 0);
      txt(g, label, W / 2 + 13 * e, y + hh / 2 + e, s, { maxW: iw - 30 * e });
    } },
    { h: 150, fn: (y, hh, e) => {
      const side = hh - 10 * e, rect = { x: W / 2 - side / 2, y: y + 5 * e, w: side, h: side };
      g.save(); g.globalAlpha = 0.9; aMini(g, rect, U.dailyLv.lv || {}, U.t); g.restore();
      g.save(); rr(g, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 10 * e); g.fillStyle = info.won ? 'rgba(255,244,228,0.35)' : 'rgba(255,244,228,0.55)'; g.fill(); g.restore();
      if (info.won) aStar(g, W / 2, y + hh / 2, 28 * e, true, 0);
      else txt(g, '?', W / 2, y + hh / 2, 54 * e, { col: '#fff', stroke: INK, sk: 0.16 });
    } },
    { h: 30, fn: (y, hh, e) => txt(g, info.won ? `New knot in ${hh2}h ${mm2}m` : `Win up to ${reward} yarn balls`, W / 2, y + hh / 2, 16 * e, { f: FB, w: '800', maxW: iw }) },
    { h: 52, fn: (y, hh, e) => {
      const s = 40 * e, label = "Tomorrow's kitten", ts = 14 * e, w2 = s + 10 * e + tw(g, label, ts, FB, '800');
      const x = W / 2 - Math.min(w2, iw) / 2, c = silhouette((dayNum(key) + 1) % 6, 0, s * 0.9, S.dpr || 1);
      if (c) g.drawImage(c, x + s / 2 - s * 0.9 * 0.75, y + hh / 2 + s * 0.45 - s * 0.9 * 1.38, s * 0.9 * 1.5, s * 0.9 * 1.5);
      txt(g, label, x + s + 10 * e, y + hh / 2, ts, { f: FB, w: '800', align: 'left', col: '#5A5066', maxW: iw - s - 10 * e });
    } },
    { h: 6 },
    { h: 56, fn: (y, hh, e) => {
      const bw = Math.min(iw, 300 * e);
      pill(g, { id: 'd-play', label: info.won ? 'Done! See you tomorrow' : "PLAY TODAY'S KNOT", kind: 'primary', disabled: !!info.won, x: W / 2 - bw / 2, y, w: bw, h: 52 * e, d: e,
        act: () => api.go('play', { kind: 'daily', id: key }) });
    } },
  ]);
  closeX(g, fr.px + fr.pw - 30 * U.du, fr.py + 32 * U.du * fr.k, U.du, close);
}
function dayNum(key) { return Math.round((Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) - Date.UTC(2026, 9, 16)) / 86400000); }
function flame(g, x, y, s, on) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.moveTo(0, s * 0.5); g.bezierCurveTo(-s * 0.5, s * 0.45, -s * 0.45, -s * 0.05, -s * 0.1, -s * 0.5);
  g.bezierCurveTo(-s * 0.05, -s * 0.15, s * 0.15, -s * 0.2, s * 0.15, -s * 0.35); g.bezierCurveTo(s * 0.5, -s * 0.05, s * 0.5, s * 0.45, 0, s * 0.5);
  g.fillStyle = on ? AMBER : '#D9CFC4'; g.fill(); g.lineWidth = Math.max(1, s * 0.08); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.ellipse(0, s * 0.22, s * 0.16, s * 0.22, 0, 0, 7); g.fillStyle = on ? TOMATO : '#BDB2A6'; g.fill();
  g.restore();
}

// ---------- all beaten ----------
function drawAllBeaten(g, S) {
  const d = U.du, W = S.W, H = S.H - (layoutOf(S).inset || 0);
  const fixed = 16 + 50 + 30 + 10 + 120 + 16 + 58 + 54 + 16;
  const k = Math.min(1, H / (fixed * d)), e = d * k;
  let y = Math.max(8 * e, (H - fixed * e) / 2) + 16 * e;
  txt(g, 'All 60 kittens rescued!', W / 2, y + 25 * e, 32 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: W - 32 * e });
  y += 50 * e;
  txt(g, 'New tangles soon', W / 2, y + 15 * e, 18 * e, { f: FB, w: '800', col: CREAM, stroke: INK, sk: 0.3, maxW: W - 32 * e });
  y += 40 * e;
  // parade
  const ks = safe(() => M.kittens(), Array(LEVELS).fill(1));
  const sp = 64 * e, loop = LEVELS * sp, base = y + 110 * e, s = 52 * e;
  rr(g, -10, base - 4 * e, W + 20, 12 * e, 6 * e); g.fillStyle = 'rgba(43,36,64,0.25)'; g.fill();
  for (let i = 0; i < LEVELS; i++) {
    const x = ((i * sp + U.t * 46 * e) % loop + loop) % loop - sp;
    if (x < -sp || x > W + sp) continue;
    const hop = Math.abs(Math.sin(U.t * 6 + i * 0.7)) * 7 * e;
    aKitten(g, W - x, base - hop, s, { stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(i + 1), coat: coatOf(i + 1), golden: ks[i] === 2, t: U.t + i, loopColors: [] });
  }
  y += 120 * e + 16 * e;
  const bw = Math.min(W - 32 * e, 300 * e);
  pill(g, { id: 'ab-daily', label: 'DAILY KNOT', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 54 * e, d: e, act: () => api.go('daily') });
  y += 58 * e;
  const hw = (bw - 10 * e) / 2;
  pill(g, { id: 'ab-bonus', label: 'Bonus Tangles', kind: 'secondary', x: W / 2 - bw / 2, y, w: hw, h: 48 * e, d: e, act: () => api.go('play', { kind: 'bonus', id: safe(() => M.bonusNext(), 0) }) });
  pill(g, { id: 'ab-map', label: 'MAP', kind: 'secondary', x: W / 2 - bw / 2 + hw + 10 * e, y, w: hw, h: 48 * e, d: e, act: () => api.go('map') });
}

// ---------- cards ----------
function cardRect(S, type) {
  const L = layoutOf(S), m = L.m, sf = L.safe || { x: 0, y: 0, w: S.W, h: S.H };
  if (L.orient === 'landscape') {
    if (type === 'lose') return { x: L.rack.x, y: L.callout.y, w: L.rack.w, h: L.basket.y - L.callout.y - m * 0.5 };
    return { x: L.rack.x, y: L.rack.y, w: L.rack.w, h: sf.y + sf.h - m - L.rack.y };
  }
  const x = sf.x + m, w = sf.w - 2 * m;
  if (type === 'lose') { const y = L.callout.y; return { x, y, w, h: Math.max(L.callout.h, L.tray.y - m - y) }; }
  const B = S.sess && S.sess.B, y = L.rack.y;
  const bottom = B && B.kitten ? B.kitten.y - B.kitten.s * 1.12 - m : L.tray.y - m;
  return { x, y, w, h: Math.max(bottom - y, Math.min(S.H - y - m, 300 * L.u)) };
}
function drawCard(g, S) {
  const c = U.card;
  if (c.type === 'win') drawWinCard(g, S, c);
  else if (c.type === 'lose') drawLoseCard(g, S, c);
  else drawGiftCard(g, S, c);
}
function cardAnim(g, c, rect) {
  const t = (U.t - c.t0) / 0.28, sc = 0.86 + 0.14 * eBack(t);
  g.globalAlpha = Math.min(1, t * 2);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
}
function drawWinCard(g, S, c) {
  const d = U.du, area = cardRect(S, 'win'), res = c.data || {}, sess = S.sess || {};
  const kind = sess.kind || 'level', st = clamp(res.stars || 0, 0, 3);
  const title = kind === 'daily' ? 'Daily Knot done!' : kind === 'bonus' ? 'Tangle cleared!' : 'Kitten rescued!';
  const kid = res.kittenId || 0;
  const pad = 14 * d, iw0 = area.w - 2 * pad;
  const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
  const list = [
    { h: 44, fn: (y, hh, e) => txt(g, title, area.x + area.w / 2, y + hh / 2, 34 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw0 - (res.newBest ? 40 * e : 0) }) },
    { h: 70, fn: (y, hh, e) => {
      const sr = Math.min(26 * e, iw0 / 8);
      for (let i = 0; i < 3; i++) {
        const t = (U.t - c.t0 - 0.35 - i * 0.25) / 0.3, on = i < st;
        const x = area.x + area.w / 2 + (i - 1) * sr * 2.5, yy = y + hh / 2 + (i === 1 ? -6 * e : 4 * e);
        aStar(g, x, yy, (i === 1 ? 1.15 : 1) * sr, false, (i - 1) * 0.2);
        if (on && t > 0) { const s2 = eBack(t); g.save(); g.translate(x, yy); g.scale(s2, s2); aStar(g, 0, 0, (i === 1 ? 1.15 : 1) * sr, true, (i - 1) * 0.2); g.restore(); }
      }
    } },
    { h: 24, fn: (y, hh, e) => {
      const line = `Basket peak ${res.peak ?? 0} · 3★ at ${res.par ?? 0}`, s = 15 * e;
      const lw = tw(g, line, s, FB, '800'), ic = 18 * e, total = Math.min(iw0, lw + ic + 6 * e);
      const x0 = area.x + area.w / 2 - total / 2;
      aIcon(g, 'slot', x0 + ic / 2, y + hh / 2, ic);
      txt(g, line, x0 + ic + 6 * e, y + hh / 2, s, { f: FB, w: '800', align: 'left', maxW: iw0 - ic - 6 * e });
    } },
    { h: 40, fn: (y, hh, e) => {
      const tB = c.t0 + 0.35 + 0.75 + 0.1, n = Math.round((res.balls || 0) * e3((U.t - tB) / 0.8));
      const label = `+${n}`, s = 26 * e, w2 = tw(g, label, s) + 30 * e, x0 = area.x + area.w / 2 - w2 / 2;
      aIcon(g, 'ball', x0 + 12 * e, y + hh / 2, 24 * e);
      txt(g, label, x0 + 30 * e, y + hh / 2 + e, s, { align: 'left', col: GOLD, stroke: INK, sk: 0.22 });
    } },
    { h: 92, fn: (y, hh, e) => {
      const cx = area.x + area.w / 2, s = Math.min(66 * e, hh - 24 * e);
      if (kid) {
        portrait(g, kid, cx - s * 0.6, y + s / 2 + 2 * e, s, res.golden ? 2 : 1, S.dpr || 1);
        aKitty(g, cx + s * 0.75, y + s + 2 * e, s * 0.95, 'celebrate', U.t, wear);
        txt(g, 'joined your Kitten Corner', cx, y + hh - 9 * e, 14 * e, { f: FB, w: '800', maxW: iw0 });
      } else aKitty(g, cx, y + hh - 6 * e, s * 1.1, 'celebrate', U.t, wear);
    } },
    { h: 6 },
    { h: 58, fn: (y, hh, e) => {
      const ir = 23 * e, icons = [['w-replay', 'retry', 'Replay', () => finishWin(() => api.retry())], ['w-map', 'home', 'Map', () => finishWin(() => api.go('map'))]];
      if (P.canShare) icons.push(['w-share', 'share', 'Share', () => shareWin(sess, res)]);
      const gap = 8 * e, pw = Math.max(80 * e, Math.min(240 * e, iw0 - icons.length * (2 * ir + gap)));
      const total = pw + icons.length * (2 * ir + gap), x0 = area.x + area.w / 2 - total / 2;
      iconBtn(g, { id: icons[0][0], label: icons[0][2], icon: icons[0][1], x: x0, y: y + 2 * e, w: 2 * ir, h: 2 * ir, act: icons[0][3], d: e });
      pill(g, { id: 'win-next', label: 'NEXT', kind: 'primary', x: x0 + 2 * ir + gap, y, w: pw, h: 52 * e, d: e, act: () => finishWin(() => api.next()) });
      for (let i = 1; i < icons.length; i++) iconBtn(g, { id: icons[i][0], label: icons[i][2], icon: icons[i][1], x: x0 + pw + gap + i * (2 * ir + gap), y: y + 2 * e, w: 2 * ir, h: 2 * ir, act: icons[i][3], d: e });
    } },
  ];
  const lay = rows(list, d, area.h - 2 * pad);
  const h = lay.h + 2 * pad * lay.k;
  const rect = { x: area.x, y: area.y, w: area.w, h };
  g.save();
  cardAnim(g, c, rect);
  panel(g, rect.x, rect.y, rect.w, rect.h, d * Math.max(0.7, lay.k));
  lay.run(rect.y + pad * lay.k);
  if (res.newBest) {
    g.save(); g.translate(rect.x + rect.w - 30 * d * lay.k, rect.y + 14 * d * lay.k); g.rotate(0.22);
    const s = 13 * d * lay.k, w2 = tw(g, 'NEW BEST', s) + 14 * d * lay.k;
    rr(g, -w2 / 2, -s, w2, 2 * s, s); g.fillStyle = GOLD; g.fill(); g.lineWidth = 2 * d * lay.k; g.strokeStyle = INK; g.stroke();
    txt(g, 'NEW BEST', 0, s * 0.08, s, { col: INK });
    g.restore();
  }
  g.restore();
}
function shareWin(sess, res) {
  const st = '★'.repeat(clamp(res.stars || 1, 1, 3));
  const text = sess.kind === 'daily' ? `I untangled today's Daily Knot in Knot Kitty ${st}` : sess.kind === 'level' ? `I rescued the kitten on level ${sess.id} of Knot Kitty ${st}` : `I cleared a bonus tangle in Knot Kitty ${st}`;
  safe(() => P.share({ title: 'Knot Kitty', text }));
}
function drawLoseCard(g, S, c) {
  const d = U.du, area = cardRect(S, 'lose'), pad = 12 * d, iw = area.w - 2 * pad;
  const unU = safe(() => M.boosterUnlocked('undo'), false), unS = safe(() => M.boosterUnlocked('slot'), false);
  const nU = safe(() => M.booster('undo'), 0), nS = safe(() => M.booster('slot'), 0), bal = safe(() => M.balance(), 0);
  const undoPrimary = unU && (nU > 0 || bal >= BOOSTERS.undo.price);
  const btns = [];
  if (unU) btns.push({ id: 'l-undo', label: 'Undo', icon: 'undo', badge: nU > 0 ? { n: nU } : { price: BOOSTERS.undo.price }, kind: undoPrimary ? 'primary' : 'secondary', act: () => loseBooster('undo') });
  if (unS) btns.push({ id: 'l-slot', label: '+1 Slot', icon: 'slot', badge: nS > 0 ? { n: nS } : { price: BOOSTERS.slot.price }, kind: 'secondary', act: () => loseBooster('slot') });
  btns.push({ id: 'l-retry', label: 'Retry', icon: 'retry', kind: undoPrimary ? 'secondary' : 'primary', act: () => { U.loseDone = true; U.card = null; api.retry(); } });
  const list = [
    { h: 38, fn: (y, hh, e) => txt(g, 'Out of room!', area.x + area.w / 2, y + hh / 2, 30 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw }) },
    { h: 24, fn: (y, hh, e) => txt(g, 'No strand fits a spool', area.x + area.w / 2, y + hh / 2, 15 * e, { f: FB, w: '800', maxW: iw }) },
    { h: 10 },
    { h: 54, fn: (y, hh, e) => {
      const gap = 8 * e, bw = (iw - gap * (btns.length - 1)) / btns.length;
      btns.forEach((b, i) => pill(g, { ...b, x: area.x + pad + i * (bw + gap), y, w: bw, h: 50 * e, d: e, icon: bw > 120 * e ? b.icon : null }));
    } },
  ];
  const lay = rows(list, d, area.h - 2 * pad);
  const rect = { x: area.x, y: area.y, w: area.w, h: lay.h + 2 * pad * lay.k };
  g.save();
  cardAnim(g, c, rect);
  panel(g, rect.x, rect.y, rect.w, rect.h, d * Math.max(0.7, lay.k));
  lay.run(rect.y + pad * lay.k);
  g.restore();
}
function drawGiftCard(g, S, c) {
  dim(g, S, 0.45);
  const d = U.du, W = S.W, H = S.H, data = c.data || {};
  const pw = Math.min(W - 24 * d, 340 * d), px = (W - pw) / 2, pad = 18 * d, iw = pw - 2 * pad;
  let title, sub, rewards = [];
  if (c.type === 'gift') { title = 'Star gift!'; sub = `You reached ${data.at || 15} ★`; rewards = [['ball', `+${data.balls || 60}`]]; if (data.booster) rewards.push([data.booster, '+1']); }
  else if (c.type === 'chest') { title = 'World chest!'; sub = `${(WORLDS[data.world] || {}).name || 'World'} complete`; rewards = [['ball', `+${data.balls || 150}`]]; for (const k of data.boosters || []) rewards.push([k, '+1']); }
  else { title = 'New booster!'; sub = BDESC[data.k] || ''; rewards = [[data.k || 'undo', `×${data.n || 1} free`]]; }
  const list = [
    { h: 44, fn: (y, hh, e) => txt(g, title, W / 2, y + hh / 2, 30 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw }) },
  ];
  if (c.type === 'unlockBooster') list.push({ h: 34, fn: (y, hh, e) => txt(g, BNAME[data.k] || '', W / 2, y + hh / 2, 24 * e, { col: TEAL_D, maxW: iw }) });
  list.push({ h: 44, fn: (y, hh, e) => lines(g, wrapFit(g, sub, iw, hh, 16 * e, 12 * e), W / 2, y + hh / 2) });
  list.push({ h: 86, fn: (y, hh, e) => {
    const n = rewards.length, cw = Math.min(90 * e, iw / n), x0 = W / 2 - cw * n / 2;
    rewards.forEach(([ic, label], i) => {
      const cx = x0 + cw * (i + 0.5), r = Math.min(26 * e, cw * 0.36), pop = eBack((U.t - c.t0 - 0.2 - i * 0.12) / 0.3);
      g.save(); g.translate(cx, y + r + 4 * e); g.scale(pop, pop);
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = '#FFF9EC'; g.fill(); g.lineWidth = 2.5 * e; g.strokeStyle = INK; g.stroke();
      aIcon(g, ic, 0, 0, r * 1.1);
      g.restore();
      txt(g, label, cx, y + 2 * r + 20 * e, 18 * e, { col: GOLD, stroke: INK, sk: 0.22, maxW: cw - 4 * e });
    });
  } });
  list.push({ h: 8 });
  list.push({ h: 56, fn: (y, hh, e) => { const bw = Math.min(iw, 220 * e); pill(g, { id: 'gift-next', label: 'COLLECT', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, d: e, act: () => nextCard() }); } });
  const lay = rows(list, d, H - 24 * d - 2 * pad);
  const ph = lay.h + 2 * pad * lay.k, py = (H - ph) / 2;
  const rect = { x: px, y: py, w: pw, h: ph };
  g.save();
  cardAnim(g, c, rect);
  panel(g, px, py, pw, ph, d);
  lay.run(py + pad * lay.k);
  g.restore();
}
function drawToast(g, S) {
  const d = U.du, t = U.t - U.toast.t0, a = Math.min(1, t / 0.15, (2 - t) / 0.3);
  if (a <= 0) return;
  const s = 15 * d, maxW = S.W - 40 * d, size = fitSize(g, U.toast.text, maxW - 28 * d, s, FB, '800');
  const w = tw(g, U.toast.text, size, FB, '800') + 28 * d, h = size * 2.2;
  const y = S.H - (layoutOf(S).inset || 0) - 90 * d - h;
  g.save(); g.globalAlpha = a;
  rr(g, S.W / 2 - w / 2, y, w, h, h / 2); g.fillStyle = INK; g.fill();
  txt(g, U.toast.text, S.W / 2, y + h / 2, size, { f: FB, w: '800', col: '#fff' });
  g.restore();
}

// ---------- input ----------
function findBtn(id) { for (let i = U.btns.length - 1; i >= 0; i--) if (U.btns[i].id === id) return U.btns[i]; return null; }
function hitBtn(x, y) { for (let i = U.btns.length - 1; i >= 0; i--) { const b = U.btns[i]; if (inR(hitOf(b), x, y)) return b; } return null; }
function hitSlider(x, y) {
  for (const s of U.sliders) { const cy = s.y + s.h / 2, hh = Math.max(44, s.h); if (x >= s.x && x <= s.x + s.w && y >= cy - hh / 2 && y <= cy + hh / 2) return s; }
  return null;
}
function slideTo(s, x) {
  if (!s.tw) return;
  const v = Math.round(clamp((x - s.tx) / s.tw, 0, 1) * 100) / 100;
  setSet(s.k, v);
}
function press(b) {
  if (!b || b.disabled) return;
  bus.emit('click', {});
  safe(() => b.act && b.act());
}
export function pointer(type, x, y, S) {
  S = S || U.S;
  if (!S) return false;
  const scr = S.screen, modal = !!U.card || scr !== 'play';
  const m = U.map;
  if (type === 'down') {
    if (scr === 'play') { U.idle = 0; clearHand('idle'); if (U.ghost) U.ghost.loops = 0; }
    const b = hitBtn(x, y);
    if (b) { U.press = { id: b.id, x, y, over: true }; if (scr === 'map' && !U.card) m.down = { x, y, s0: m.scroll, t: now(), moved: false, btn: true }; return true; }
    if (!U.card) {
      const sl = hitSlider(x, y);
      if (sl) { U.drag = sl; slideTo(sl, x); return true; }
      if (scr === 'map') { m.down = { x, y, s0: m.scroll, t: now(), moved: false }; m.v = 0; m.target = null; m.lastY = y; m.last = now(); return true; }
    }
    return modal;
  }
  if (type === 'move') {
    if (U.drag) { slideTo(U.drag, x); return true; }
    if (m.down && scr === 'map') {
      const dy = y - m.down.y;
      if (!m.down.moved && Math.abs(dy) > 9) { m.down.moved = true; m.drag = true; U.press = null; m.target = null; }
      if (m.drag) {
        const mm = mapM(S), t = now(), dt = Math.max(1, t - m.last) / 1000;
        m.scroll = clamp(m.down.s0 + dy, -30, mm.maxScroll + 30);
        m.v = lerp(m.v, (y - m.lastY) / dt, 0.5); m.last = t; m.lastY = y;
        return true;
      }
    }
    if (U.press) { const b = findBtn(U.press.id); U.press.over = !!b && inR(hitOf(b), x, y); return true; }
    return modal;
  }
  if (type === 'up' || type === 'cancel') {
    if (U.drag) { U.drag = null; return true; }
    if (m.down && scr === 'map') {
      const wasDrag = m.drag, d0 = m.down;
      m.down = null; m.drag = false;
      if (wasDrag) { if (now() - m.last > 80) m.v = 0; U.press = null; return true; }
      if (!d0.btn && type === 'up') { mapTap(x, y); return true; }
    }
    if (U.press) {
      const p = U.press; U.press = null;
      const b = findBtn(p.id);
      if (type === 'up' && b && inR(hitOf(b), x, y)) press(b);
      return true;
    }
    return modal;
  }
  return modal;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function mapTap(x, y) {
  const d = U.du;
  let best = null, bd = 1e9;
  for (const n of U.map.nodes) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < n.r + 12 * d && dd < bd) { bd = dd; best = n; } }
  if (!best) return;
  if (best.locked) { toast(`Beat level ${best.id - 1} first`); return; }
  bus.emit('click', {});
  if (U.map.sel === best.id) api.go('play', { kind: 'level', id: best.id });
  else mapSelect(best.id);
}
export function key(e, S) {
  S = S || U.S;
  if (!S || !e) return false;
  if (e.type && e.type !== 'keydown') return false;
  const k = e.key, scr = S.screen;
  if (k === 'Escape' || k === 'Esc') {
    if (U.card) return U.card.type === 'win' || U.card.type === 'lose' || U.after ? true : (nextCard(), true);
    if (scr === 'win' || scr === 'lose') return true;
    if (scr === 'pause') { api.resume(); return true; }
    if (DIALOGS.includes(scr)) { if (U.reset) { U.reset = 0; return true; } api.go(U.ret); return true; }
    if (scr === 'play') { api.pause(); return true; }
    return false;
  }
  if ((k === 'Enter' || k === ' ' || k === 'Spacebar') && !e.repeat) {
    if (scr === 'play' && !U.card) return false;
    const b = [...U.btns].reverse().find(q => q.primary && !q.disabled);
    if (b) { press(b); return true; }
    return false;
  }
  if (scr === 'map' && !U.card && (k === 'ArrowUp' || k === 'ArrowDown')) {
    const cur = Math.min(LEVELS, safe(() => M.cur(), 1));
    mapSelect(clamp((U.map.sel || 1) + (k === 'ArrowUp' ? 1 : -1), 1, cur));
    return true;
  }
  return false;
}
