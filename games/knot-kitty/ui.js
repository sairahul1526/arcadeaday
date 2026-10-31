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
// DECISION: map: the yarn-ball count opens the shop; ↑/↓ keys move the selection; ui.wheel returns true (Core then
//   calls preventDefault) only while the map can still scroll that way. Locked nodes say "Beat level N first".
// DECISION: settings sliders/toggle emit bus 'settings' {k, v} (meta.setSetting has no event) so Audio can apply them
//   live; win-card stars emit bus 'star' {i} as each one pops.
// DECISION: the locked Daily dialog shows "Beat level 13 to unlock" with an OK primary. Reset progress = two taps within 3 s.
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
import { canPull } from './rules.js';
import * as AU from './audio.js';
import * as PL from './play.js';
import { img, WINS, BOSSES, bgArt } from './art.js';

// ---------- style ----------
const INK = '#2B2440', CREAM = '#FFF4E4', STITCH = '#E9D3B5', SHADE = '#D9BF9C', TOMATO = '#E8463A', TOMATO_D = '#B8322A';
const TEAL = '#1FB0A0', TEAL_D = '#167C71', GOLD = '#FFC93C', GOLD_D = '#B9811A', AMBER = '#FFB23F', GREY = '#B9B2AE';
const FT = '"Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
const FB = 'Nunito, system-ui, sans-serif';
// yarn colours follow render.js YARN (single source); the literal list is only a fallback if YARN is missing
const YCOL = Array.isArray(R.YARN) && R.YARN.length >= 7 ? R.YARN.map(y => y.base) : ['#E8463A', '#169C92', '#F5B82E', '#4790F2', '#A145C9', '#93CD3E', '#E8463A'];
const BK = ['undo', 'hint', 'slot', 'snip'];
const ICOL = { pause: TEAL, retry: TEAL, undo: TEAL, hint: GOLD, slot: CREAM, snip: TOMATO, gear: TEAL, cart: TEAL, paw: TOMATO,
  calendar: CREAM, share: TEAL, close: TOMATO, home: TOMATO, lock: CREAM };
const BNAME = { undo: 'Undo', hint: 'Hint', slot: '+1 Slot', snip: 'Snip' };
// fix 2 (grandparent: "(max 2★)" is jargon): plain words, read at ≥ 16 px in the shop
const BDESC = { undo: 'Takes back your last pull', hint: 'Shows a good next move', slot: 'One more basket space. Using it means 2 stars at most',
  snip: 'Pull any strand, even a covered one. 2 stars at most' };
// fix 2: the one-line meaning of each mechanic, re-shown by tapping the HUD "?" (the first-time banner fades in ~2 s)
const MECH_LINE = { knot: 'Tied strands go together as one pull', lock: 'A padlock opens when you pull its key strand',
  mystery: 'Grey yarn shows its colour once nothing is on top', paw: 'A sleepy paw waits until you pull the number on its bubble',
  rainbow: 'Rainbow yarn fits any spool', jumbo: 'The big spool takes 6 strands', ice: 'The ice slot thaws after spools fill' };
const BTEACH = { undo: 'Undo takes back a pull', hint: 'Hint shows a good move', slot: '+1 Slot adds a basket space',
  snip: 'Snip cuts any one strand free' };
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
const eOut = t => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); };
const eBack = t => { t = clamp(t, 0, 1) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };
const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
const TAU2 = Math.PI * 2;
// record / og showreels keep their scripted look: no first-encounter tags or explainers there
const SHOWREEL = typeof location !== 'undefined' && /[?&](record|og)(=|&|$)/.test(location.search || '');
const sfx = (name, ...a) => { try { if (typeof AU.sfx === 'function') AU.sfx(name, ...a); } catch (e) {} };
/** 'mini' | 'boss' | '' — levels may carry knot: 'mini'|'boss' (guarded). */
const toughOf = sess => { const k = sess && sess.level && sess.level?.knot; return k === 'mini' || k === 'boss' ? k : ''; };
const breedOf = id => (id - 1) % 6, coatOf = id => Math.floor((id - 1) / 6);
// fix 1 (desktop m4): the haptics toggle needs a vibrate API AND a touch screen (desktop Chrome has navigator.vibrate)
const hasVibrate = () => P.env === 'web' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  && ((typeof window !== 'undefined' && 'ontouchstart' in window) || navigator.maxTouchPoints > 0);

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
// fix 2: instructional copy never drops below `min` css px. Greedy word wrap at `size`, stepping the size down to
//   `min` only while it needs more than `maxL` lines; at `min` it keeps every line (callers budget for wf.lines.length).
function wrapMin(g, s, maxW, size, min, maxL = 2, f = FB, w = '800') {
  const words = String(s).split(' ');
  const wrap = (z) => {
    const out = []; let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (cur && tw(g, t, z, f, w) > maxW) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur);
    return out;
  };
  let z = Math.max(size, min), ls = wrap(z);
  while (z > min && (ls.length > maxL || ls.some(l => tw(g, l, z, f, w) > maxW))) { z = Math.max(min, z - 1); ls = wrap(z); }
  // a single word wider than maxW is the only case that may shrink under min (never happens with our copy)
  const wide = Math.max(...ls.map(l => tw(g, l, z, f, w)));
  if (wide > maxW) z = Math.max(10, z * maxW / wide);
  return { lines: ls, size: z };
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
  if (col === CREAM) col = INK;
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
function fbMiniBoard(g, rect, level, t, opt = {}) {
  const cols = (level && level.cols) || 5, rows = (level && level.rows) || 5;
  const un = Math.min(rect.w / (cols - 1 + 1.2), rect.h / (rows - 1 + 1.2 + 1.4));
  const w = (cols - 1 + 1.2) * un, h = (rows - 1 + 1.2) * un, x = rect.x + (rect.w - w) / 2, y = rect.y + (rect.h - h - 1.4 * un) / 2;
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
  if (opt.kitten !== false) fbKitten(g, x + w / 2, y + h + 1.25 * un, 1.6 * un, { loops: opt.loops || 0, stage: 0 });
  return { B: { x, y, w, h, unit: un } };
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
  callout: null, queue: [], pop: null, popQ: [],
  card: null, cards: [], extra: [], after: null, giftKeys: new Set(), winDone: false, loseDone: false, winAt: 0, loseAt: 0,
  sessRef: null, tut: null, tutOn: false, idle: 0, hand: null, ghost: null, attn: [], fly: [], intro: null,
  rate: {}, undoPulse: 0, shakes: {}, losses: {}, freeHintUsed: {},
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
// DECISION (ui2 U7): the site's "how to play / more games" chips (index.html nav.back) only show on the title, the map
//   and the all-beaten screen with no card up; play, cards and every dialog hide them (body.kk-play, see index.html),
//   so a stray tap can't leave the game mid-level. They are hidden with visibility (not display), so layout.js still
//   measures the same inset and S.L never goes stale; screens that hide the chips simply use the full height.
const navShown = S => !!S && (S.screen === 'title' || S.screen === 'map' || S.screen === 'allbeaten') && !U.card && !U.how;
const dlgInset = S => (navShown(S) ? layoutOf(S).inset || 0 : 0);
function syncNav(S) {
  const show = navShown(S);
  if (U.navShow === show) return;
  U.navShow = show;
  try { if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('kk-play', !show); } catch (e) { /* no DOM */ }
}

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
  const hv = hov(b), x = b.x + shakeX(b.id, d), y = b.y + push - (hv ? 2 : 0), lv = lip - push + (hv ? 2 : 0);
  const [top, bot, fg] = b.kind === 'primary' ? [TOMATO, TOMATO_D, '#fff'] : b.kind === 'secondary' ? [TEAL, TEAL_D, '#fff'] : [CREAM, SHADE, INK];
  g.save();
  if (b.disabled) g.globalAlpha *= 0.45;
  if (down) { const cx = x + b.w / 2, cy = y + h / 2; g.translate(cx, cy); g.scale(1.03, 0.95); g.translate(-cx, -cy); }
  const r = h / 2;
  rr(g, x, y, b.w, h + lv, r); g.fillStyle = bot; g.fill();
  rr(g, x, y, b.w, h, r); g.fillStyle = top; g.fill();
  rr(g, x, y, b.w, h + lv, r); g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
  rr(g, x + r * 0.6, y + h * 0.12, Math.max(0, b.w - r * 1.2), h * 0.28, h * 0.14); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill();
  if (hv) { rr(g, x, y, b.w, h, r); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill(); }
  const cy = y + h / 2;
  let ix = 0, iw = 0;
  const pad = r * 0.7;
  if (b.icon) iw = h * 0.5;
  const avail = b.w - 2 * pad - (iw ? iw + h * 0.12 : 0) - (b.badge ? h * 0.3 : 0);
  const stroke = fg === '#fff' ? INK : null;
  if (b.sub) {
    const s1 = fitSize(g, b.label, avail, h * 0.46, FT, '', 0.2), s2 = Math.max(12, fitSize(g, b.sub, avail, Math.max(12, h * 0.2), FB, '900'));
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
  if (b.badge) badge(g, b.x + b.w - h * 0.12, b.y + h * 0.05, Math.max(10.6, h * 0.3), b.badge, d);
}
/** Count badge (ink circle) or price chip (gold, with a yarn ball). */
function badge(g, x, y, r, bd, d, maxR = Infinity) {
  g.save();
  if (bd.n != null) {
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = INK; g.fill(); g.lineWidth = Math.max(1, r * 0.16); g.strokeStyle = CREAM; g.stroke();
    txt(g, String(bd.n), x, y + r * 0.06, r * 1.15, { col: '#fff', maxW: r * 1.6 });
  } else if (bd.price != null) {
    const s = r * 1.05, label = String(bd.price);
    const w = tw(g, label, s, FT) + s * 1.5;
    if (x + w / 2 > maxR) x = maxR - w / 2;
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
  const hv = hov(b), lip = Math.max(1.5, R0 * 0.1), cy = cy0 - lip / 2 + (down ? lip * 0.8 : 0) - (hv ? 2 : 0);
  g.save();
  if (b.disabled) g.globalAlpha *= 0.45;
  if (b.ring) {
    const p = 0.5 + 0.5 * Math.sin(U.t * 7);
    g.beginPath(); g.arc(cx, cy0, R0 + (2 + 3 * p) * d, 0, 7); g.lineWidth = Math.max(2, 3.5 * d); g.strokeStyle = b.ring; g.globalAlpha *= 0.6 + 0.4 * p; g.stroke();
    g.globalAlpha = b.disabled ? 0.45 : 1;
  }
  g.beginPath(); g.arc(cx, cy0 + lip / 2, R0 - lip / 2, 0, 7); g.fillStyle = SHADE; g.fill();
  g.beginPath(); g.arc(cx, cy, R0 - lip / 2, 0, 7); g.fillStyle = b.fill || CREAM; g.fill();
  if (hv) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(); }
  g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
  aIcon(g, b.icon, cx, cy, R0 * 1.05, b.iconCol || ICOL[b.icon] || CREAM);
  g.restore();
  if (b.dot) { g.beginPath(); g.arc(cx + R0 * 0.72, cy0 - R0 * 0.72, Math.max(4, R0 * 0.24), 0, 7); g.fillStyle = TOMATO; g.fill(); g.lineWidth = Math.max(1, 2 * d); g.strokeStyle = '#fff'; g.stroke(); }
  // ui2: badge digits ≥ 11 px (r ≥ 10); a price chip slides left so it never pokes past the button's box
  // meta v2: b.badgeTop puts it at the top-right (HUD boosters: their label sits under the icon) with digits ≥ 13 px
  if (b.badge) {
    const br = b.badgeTop ? Math.max(11.6, R0 * 0.4) : Math.max(10.6, R0 * 0.36);
    badge(g, cx + R0 * 0.72, b.badgeTop ? cy0 - R0 * 0.6 : cy0 + R0 * 0.62, br, b.badge, d, b.x + b.w + (b.badgeTop ? br * 0.4 : 0));
  }
  if (b.cap) iconCap(g, b.cap, cx, b.capY != null ? b.capY : b.y + b.h + 3 * d, b.capW || b.w * 1.6, b.capFs || Math.max(12, 12 * d));
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
  // ui2 U8: right edge lines up with the slider track end above (slider(): s.x + s.w - kr + 4d), not the knob's reach
  const kr = Math.min(b.h * 0.42, 13 * d), re = b.x + b.w - Math.max(0, kr - 4 * d);
  const sw = Math.min(56 * d, b.w * 0.3), sh = Math.min(30 * d, b.h * 0.8), sx = re - sw, sy = b.y + (b.h - sh) / 2;
  rr(g, sx, sy, sw, sh, sh / 2); g.fillStyle = on ? TEAL : STITCH; g.fill(); g.lineWidth = Math.max(1.5, 2.2 * d); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(on ? sx + sw - sh / 2 : sx + sh / 2, sy + sh / 2, sh * 0.36, 0, 7); g.fillStyle = '#fff'; g.fill(); g.stroke();
}
// meta v2: the Close X is 44 css px or more (was 42)
function closeX(g, x, y, d, act) { const r = Math.max(22, 22 * d); iconBtn(g, { id: 'close', label: 'Close', x: x - r, y: y - r, w: 2 * r, h: 2 * r, icon: 'close', act }); }
/** meta v2: a small caption chip centred at (cx, top y): ink text ≥ 12 px on a cream pill (readable on any scene). */
function iconCap(g, label, cx, y, maxW, fs) {
  fs = Math.max(12, fitSize(g, label, maxW - fs * 0.8, fs, FB, '900'));
  const w = Math.min(maxW, tw(g, label, fs, FB, '900') + fs * 0.8), h = Math.ceil(fs * 1.22);
  g.save();
  rr(g, cx - w / 2, y, w, h, h / 2); g.fillStyle = 'rgba(255,249,236,0.94)'; g.fill();
  g.lineWidth = Math.max(1, fs * 0.08); g.strokeStyle = 'rgba(43,36,64,0.55)'; g.stroke();
  txt(g, label, cx, y + h / 2 + fs * 0.04, fs, { f: FB, w: '900', col: INK, maxW: w - fs * 0.4 });
  g.restore();
  return { x: cx - w / 2, y, w, h };
}

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
function clearCallouts() { U.callout = null; U.queue = []; U.pop = null; U.popQ = []; }
/** Celebratory pop at a spool. o: { col, size (u px), big (beats a "+1"), ball (yarn-ball icon) }. */
// DECISION (fix 2): pops QUEUE instead of overwriting (CHAIN ×3 then COMBO ×2 used to land in one frame and the
//   second erased the first). A big pop arriving while another big one shows waits; the showing one is cut to a
//   0.1 s fade once it has had POP_GAP − 0.1 s, so queued pops start ≈ 0.45 s apart and only one is ever on screen.
//   Small pops (+1, coins) never queue: they show only when nothing big is up or waiting. Queue holds ≤ 2.
const POP_GAP = 0.45;
function popAt(text, slot, o = {}) {
  const dur = o.big ? 1.05 : 0.8;
  const p = { text, slot: slot == null ? -1 : slot, t: 0, dur, d0: dur, fade: dur * 0.25, col: o.col || GOLD, size: o.size || 26,
    big: !!o.big, ball: !!o.ball, sub: 0, burst: !!o.burst };
  const cur = U.pop;
  if (!cur || (!cur.big && !U.popQ.length)) { U.pop = p; return; }
  if (!p.big) return;
  U.popQ.push(p);
  if (U.popQ.length > 2) U.popQ.shift();
}
/** The pop a coin sub-line should ride on: the newest queued pop, else the showing one while it is fresh. */
function popForSub() { return U.popQ.length ? U.popQ[U.popQ.length - 1] : U.pop && U.pop.t < 0.6 ? U.pop : null; }
const chainN = d => (d ? (d.n != null ? d.n : d.m) | 0 : 0);
// DECISION (fix 1): pops escalate: +1 cream 22u → CHAIN ×2 gold 28u → ×3 amber 32u → ×4+ tomato 36u with a burst;
//   COMBO is teal-on-gold, 32u + 3u per step (max 44u). All scale in with a 1.35× overshoot.
const chainStyle = n => ({ col: n >= 4 ? TOMATO : n >= 3 ? AMBER : GOLD, size: Math.min(36, 24 + 4 * n), big: true, burst: n >= 3 });
const comboStyle = c => ({ col: TEAL, size: Math.min(44, 26 + 3 * c), big: true, burst: true });
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
  U.attn.push({ x: n.x, y: n.y, h: n.h, r: n.h * 0.75, t0: U.t + delay, dur: 1.4 });
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
      if (type === 'chain' && !chained) { chained = true; if (!(d && chainN(d) >= 2)) popAt('CHAIN!', d && d.slot, { col: GOLD, size: 30 }); }
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
  // polish round 3: the "Watch the NEXT spool" callout used to land with the Undo fly-in, the basket tag and the ★
  //   flag in the same second. L4's one new idea (the ★ flag) is now the teach overlay (TEACH_PLAN[4]).
  return { start() {}, on() {}, tick() {} };
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
    done: () => off || pulls >= 1,
  };
}
// polish round 3: a Daily Knot (or bonus tangle) can show a mechanic the player has never met (dailies mix all of
//   them). Each unseen one present on the board gets the same first-sight teach as its level, one at a time.
const MECH = {
  knot: pz => (pz.group || []).some(x => x >= 0), lock: pz => !!pz.hasLock, mystery: pz => (pz.strands || []).some(q => q && q.m),
  paw: pz => !!pz.hasPaw, rainbow: pz => (pz.rainbowMask || 0) > 0, jumbo: pz => (pz.spools || []).some(q => q && q.n > 3),
  ice: pz => (pz.ice || 0) > 0,
};
function dirMechanics(s) {
  const pz = (s && s.puz) || {};
  const keys = Object.keys(MECH).filter(k => safe(() => MECH[k](pz), false) && !safe(() => M.tutSeen(k), true));
  if (!keys.length) return null;
  let i = 0, cur = null, gap = 0;
  const next = S => { cur = dirTeach(keys[i++]); cur.start(S); };
  return {
    start(S) { next(S); },
    on(type, d, S) { if (cur) cur.on(type, d, S); },
    tick(dt, S) {
      if (!cur) return;
      cur.tick(dt, S);
      if (i < keys.length && cur.done()) { gap += dt; if (gap > 1.2 && !U.callout) { gap = 0; next(S); } }
    },
  };
}

// ---------- teach-by-play overlay (polish round 3) ----------
// DECISION (designer/grandparent: "L3/L4 rule overload"): the first time a new idea is on the board, gold rings
//   pulse on it with at most ONE short label; the first tap anywhere dismisses it (the tap still plays). While it
//   is up no callout, first-sight tag or booster fly-in competes with it. Once shown, the tags it replaces are
//   marked seen. If the player pulls before it could show, it is dropped unmarked and the tags still cover it.
const TEACH_PLAN = {
  3: { key: 'teach3', rings: ['basket', 'next'], arrow: true, label: { text: 'Spare yarn waits here', at: 'basket' }, marks: ['f_basket', 'f_next'] },
  // fix 2 (critics r1): plain words, and L4 teaches the plan (watch NEXT, keep the basket empty), ≥ 16 px
  4: { key: 'teach4', rings: ['par', 'next'], label: { text: 'Watch NEXT and keep the basket nearly empty for 3 stars', at: 'next' }, marks: ['x_par'] },
};
function teachFor(s) {
  if (!s || s.kind !== 'level' || SHOWREEL) return null;
  const p = TEACH_PLAN[s.id];
  return p && !safe(() => M.tutSeen(p.key), true) ? p : null;
}
function teachTick(S) {
  const s = S.sess, p = U.teachPend;
  if (p && !U.teach) {
    if (s.result || s.stuck || U.t > (U.tutStart || 0) + 8) { U.teachPend = null; return; }
    const busy = U.t < (U.tutStart || 0) + 0.6 || U.callout || U.pop || U.fly.length || U.ghost || U.banner || (s.flights && s.flights.length);
    if (busy) return;
    const L = layoutOf(S);
    const rings = p.rings.filter(r => (r === 'par' ? parShown(s) >= 0 : r === 'next' ? (s.nextQ || []).length > 0 : r === 'basket' ? !L.hideBasket && (s.basket || []).length > 0 : true));
    U.teachPend = null;
    if (!rings.length) return;
    U.teach = { ...p, rings, label: p.label && rings.includes(p.label.at) ? p.label : null, t0: U.t, dur: 9, out: 0 };
    safe(() => M.markTut(p.key));
    for (const k of p.marks || []) firstDone(k);
    clearHand('idle');
  }
  const t = U.teach;
  if (t && !t.out && (U.t - t.t0 > t.dur || s.result || s.stuck)) t.out = U.t;
  if (t && t.out && U.t - t.out > 0.3) U.teach = null;
}
function teachDismiss() { if (U.teach && !U.teach.out && U.t - U.teach.t0 > 0.15) U.teach.out = U.t; }
function drawTeach(g, S, L) {
  const t = U.teach, s = S.sess;
  if (!t || !s || U.card) return;
  const u = L.u, age = U.t - t.t0;
  const a = clamp(Math.min(age / 0.25, t.out ? 1 - (U.t - t.out) / 0.3 : 1), 0, 1);
  if (a <= 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(age * 5);
  const ring = (fn) => {
    g.save(); g.globalAlpha = a;
    fn(); g.lineWidth = Math.max(3, 5 * u) * (1 + 0.25 * pulse); g.strokeStyle = GOLD; g.stroke();
    g.lineWidth = Math.max(1.2, 1.6 * u); g.strokeStyle = INK; g.stroke();
    g.restore();
  };
  const sl = safe(() => basketSlots(L, (s.basket || []).length), []);
  const rs = safe(() => rackSlots(L), null);
  for (const r of t.rings) {
    if (r === 'basket' && sl.length) {
      const rad = sl[0].r, x0 = sl[0].x - rad * 1.35, x1 = sl[sl.length - 1].x + rad * 1.35, g2 = rad * 0.12 * pulse;
      ring(() => rr(g, x0 - g2, sl[0].y - rad * 1.3 - g2, x1 - x0 + 2 * g2, rad * 2.6 + 2 * g2, rad * 0.6));
    }
    if (r === 'next' && rs && rs.next && rs.next[0]) {
      const n = rs.next[0], h = n.h, grow = h * 0.06 * pulse, top = n.y - h * 0.56, bot = n.y + h * 0.66 + grow, hw = h * 0.6 + grow;
      ring(() => rr(g, n.x - hw, top - grow, hw * 2, bot - top + grow, Math.min(hw, h * 0.3)));
    }
    if (r === 'par' && sl.length) {
      const par = parShown(s), rad = sl[0].r;
      if (par < 0) continue;
      const xm = par === 0 ? sl[0].x - rad * 1.3 : (sl[par - 1].x + sl[par].x) / 2, w = rad * 0.55 + rad * 0.1 * pulse;
      ring(() => rr(g, xm - w, sl[0].y - rad * 2.0, 2 * w, rad * 3.2, w));
    }
  }
  if (t.arrow && rs && rs.next && rs.next[0] && rs.active && rs.active.length) {
    // the NEXT spool slides into the rack when one fills: a dashed arc from it to the nearest active spool
    const n = rs.next[0], to = rs.active[rs.active.length - 1];
    // it leaves from the side of the NEXT ring (never over the render's "NEXT" label above the spool)
    const sd = n.x > to.x ? -1 : 1;
    const x0 = n.x + sd * n.h * 0.66, y0 = n.y - n.h * 0.15, x1 = to.x - sd * to.h * 0.62, y1 = to.y - to.h * 0.3;
    const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.abs(x0 - x1) * 0.45;
    g.save(); g.globalAlpha = a; g.lineCap = 'round';
    g.setLineDash([7 * u, 6 * u]); g.lineDashOffset = -age * 30 * u;
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1);
    g.lineWidth = Math.max(4, 6 * u); g.strokeStyle = INK; g.stroke();
    g.lineWidth = Math.max(2.5, 3.6 * u); g.strokeStyle = GOLD; g.stroke();
    g.setLineDash([]);
    const ang = Math.atan2(y1 - cy, x1 - cx), hs = Math.max(8, 11 * u);
    g.beginPath(); g.moveTo(x1 + Math.cos(ang) * hs * 0.6, y1 + Math.sin(ang) * hs * 0.6);
    g.lineTo(x1 + Math.cos(ang + 2.5) * hs, y1 + Math.sin(ang + 2.5) * hs); g.lineTo(x1 + Math.cos(ang - 2.5) * hs, y1 + Math.sin(ang - 2.5) * hs); g.closePath();
    g.fillStyle = GOLD; g.fill(); g.lineWidth = Math.max(1.5, 2 * u); g.strokeStyle = INK; g.stroke();
    g.restore();
  }
  if (t.label) {
    const ck = [t.label.at, t.label.text, S.W, S.H, S.sess && S.sess.B ? Math.round(S.sess.B.y) : 0].join('|');
    if (t.lk !== ck) { const an = firstAnchor(S, L, t.label.at); t.lk = ck; t.lp = an ? safe(() => placeTag(g, S, L, t.label.text, an, t.label.at, u), null) : null; }
    drawTag(g, S, t.label.text, t.lp, u, a);
  }
}

// ---------- bus wiring ----------
function onBus(type, d) {
  const S = U.S;
  if (!S) return;
  if (type === 'win') {
    U.winAt = U.t + DUR.kittenFree; clearHand(); U.ghost = null; U.first = null; U.banner = null;
    if (toughOf(S.sess)) setTimeoutUI(() => { sfx('reveal'); sfx('gift'); }, DUR.kittenFree + 0.2); // tough-knot fanfare
  }
  if (type === 'stuck') { U.loseAt = U.t + DUR.stuckCard; U.loseDone = false; clearHand(); U.ghost = null; }
  if (type === 'kittenFree') { clearHand(); clearSay(); }
  if (type === 'pull' || type === 'press') { U.idle = 0; teachDismiss(); }
  if (type === 'pull') U.teachPend = null;
  if (!S.sess || S.screen !== 'play') return;
  if (U.tut && U.tutOn) safe(() => U.tut.on(type, d, S));
  if (type === 'pull') clearHand('idle');
  // first-encounter hints: each one is done the first time the thing it explains is used
  if (type === 'basket' || (type === 'pull' && d && d.dest && d.dest.kind === 'basket')) firstDone('f_basket');
  if (type === 'spoolEnter') firstDone('f_next');
  if (type === 'pull') { firstDone('f_c4'); if (U.first && U.first.key === 'x_more' && U.t - U.first.t0 > 2) firstDone('x_more'); }
  switch (type) {
    case 'chain': { // contract 1: {n, combo} (old shape {m}); "+1" for one ball, "CHAIN ×n!" from two
      const n = chainN(d);
      if (n >= 2) popAt(`CHAIN ×${n}!`, d.slot, chainStyle(n));
      else if (n === 1) popAt('+1', d.slot, { col: CREAM, size: 26 }); // dropped by popAt while a big pop is up
      break;
    }
    case 'spoolDone': { const c = d ? d.combo | 0 : 0; if (c >= 2) popAt(`COMBO ×${c}!`, d.slot != null ? d.slot : -1, comboStyle(c)); break; }
    case 'coins': // yarn-ball reward rides under the current pop as a sub-line; alone only when nothing is popping
      if (d && d.n > 0) { const p = popForSub(); if (p) p.sub = (p.sub || 0) + d.n; else popAt(`+${d.n}`, -1, { col: GOLD, size: 24, ball: true }); }
      break;
    case 'bonus': { // contract (polish): play.js 'bonus' {amt, combo}; rides on the COMBO pop as "+amt 🧶"
      const amt = d ? d.amt | 0 : 0, c = d ? d.combo | 0 : 0;
      if (amt <= 0) break;
      const p = popForSub();
      if (p && /^COMBO/.test(p.text)) p.sub = (p.sub || 0) + amt;
      else { popAt(c >= 2 ? `COMBO ×${c}!` : 'COMBO!', d.slot != null ? d.slot : -1, comboStyle(Math.max(2, c))); const q = popForSub(); if (q) q.sub = (q.sub || 0) + amt; }
      break;
    }
    case 'boosterRefused': if (d && d.reason) refuse(d.kind, d.reason); break;
    case 'full': if (rateOk('full', 3)) say('Basket full: pick yarn that fits a spool', { pri: 1, dur: 2 }); break;
    case 'basketWarn': if (rateOk('warn', 4)) say('Basket almost full!', { pri: 1, dur: 1.6 }); break;
    case 'blocked':
      if (!d) break;
      if (d.why === 'locked' && rateOk('lock', 4)) say('Locked: pull its key strand first', { pri: 1, dur: 2 });
      // polish (grandparent): from L3 a covered tap rings the strands on top and, the first 3 times, says so in words
      if (d.why === 'covered' && !(S.sess.kind === 'level' && S.sess.id < 3)) {
        U.blk = { ids: (d.blockers || []).slice(0, 4), t0: U.t };
        if (!safe(() => M.tutSeen('blk3'), true) && rateOk('blk', 1.2)) {
          U.blkN = (U.blkN || 0) + 1;
          say("That one's underneath — tap the one on top!", { pri: 2, dur: 2.4 });
          if (U.blkN >= 3) safe(() => M.markTut('blk3'));
        }
      }
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
    case 'hint': if (d && d.id != null && d.id < 0) { U.undoPulse = U.t + 4; if (U.t - (U.rate.refuse || -9) > 1.5) say('Undo a pull first', { pri: 2, dur: 2.2 }); } break;
    case 'doomed':
      if (safe(() => M.boosterUnlocked('undo'), false) && rateOk('doomed', 8)) say('This is getting tight. Try Undo.', { pri: 2, dur: 2.4 });
      break;
  }
}
const BUS = ['press', 'pull', 'blocked', 'full', 'basketWarn', 'chain', 'spoolDone', 'boosterRefused', 'coins', 'spoolEnter', 'basket', 'reveal', 'unlock',
  'paw', 'thaw', 'kittenFree', 'win', 'stuck', 'doomed', 'undo', 'booster', 'hint', 'bonus'];

// ---------- init ----------
export function init(a) {
  api = a;
  U.S = a && a.S;
  for (const t of BUS) bus.on(t, d => onBus(t, d));
}

/** Core calls this for wheel events off the play screen; true → Core calls preventDefault. */
export function wheel(dy, x, y, S) {
  S = S || U.S;
  if (!S || S.screen !== 'map' || U.card) return false;
  const mm = mapM(S);
  const can = dy > 0 ? U.map.scroll > 0.5 : U.map.scroll < mm.maxScroll - 0.5;
  if (!can) return false;
  U.map.target = null; U.map.v = 0;
  U.map.scroll = clamp(U.map.scroll - dy, 0, mm.maxScroll);
  return true;
}

// ---------- update ----------
export function update(dt, S) {
  if (!S) return;
  U.S = S;
  U.t += dt;
  U.du = clamp(isLand(S) ? Math.min(S.W / 700, S.H / 520) : Math.min(S.W / 390, S.H / 700), 0.55, 4.4); // fix 1: 4K scales
  if (S.screen !== U.scr) onScreen(U.scr, S.screen, S);
  if (S.sess !== U.sessRef) onSession(S);
  // GDD §10 (fix 1, phone m3): no basket on L1. Only while it is empty and nothing is flying to it (L1 can't use it).
  if (S.L) {
    const s = S.sess;
    S.L.hideBasket = !!(s && s.kind === 'level' && s.id === 1 && s.st && s.st.basket && s.st.basket.every(c => c < 0)
      && !(s.flights || []).some(f => f && f.dest && f.dest.kind === 'basket'));
    // ui2 L3: an empty tray (no basket, no booster unlocked) lends its height to the board + kitten group
    const free = !!(S.L.hideBasket && S.L.board && !BK.some(k => safe(() => M.boosterUnlocked(k), false)));
    if (S.L.board && !!S.L.board.trayFree !== free) { S.L.board.trayFree = free; if (s) safe(() => PL.onResize(S, s)); }
  }
  const playing = S.screen === 'play' && !U.card;

  // director starts once the level is on screen
  if (S.sess && playing && !U.tutOn) {
    U.tutOn = true; U.tutStart = U.t;
    if (U.tut) safe(() => U.tut.start(S));
    scheduleIntro(S);
    const tk = toughOf(S.sess);
    if (tk && !SHOWREEL) { U.banner = { kind: tk, t0: U.t + 0.25 }; setTimeoutUI(() => { sfx('gift'); sfx('unlock'); }, 0.25); }
  }
  if (playing && S.sess) {
    U.idle += dt;
    if (U.tut) safe(() => U.tut.tick(dt, S));
    const sess = S.sess;
    const idleOk = sess.kind === 'bonus' || (sess.kind === 'level' && sess.id >= 4);
    if (idleOk && !U.hand && U.idle >= IDLE_HINT && !sess.stuck && !sess.result) setHand(pickMove(S), 'idle');
    if (U.hand && (sess.result || sess.stuck)) U.hand = null;
    teachTick(S);
    if (U.intro && (U.teach || U.teachPend)) U.intro.at = Math.max(U.intro.at, U.t + 1.2);
    if (U.intro && U.t >= U.intro.at) runIntro(S);
  }
  // callouts
  if (U.pop) {
    const p = U.pop;
    p.t += dt;
    if (U.popQ.length && p.dur > p.t + 0.1 && p.t >= POP_GAP - 0.1) { p.dur = p.t + 0.1; p.fade = 0.1; }
    if (p.t >= p.dur) U.pop = null;
  }
  if (!U.pop && U.popQ.length) U.pop = U.popQ.shift();
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
  U.toast = null; // a toast belongs to the screen that raised it
  U.hover = null; setCursor('default');
  if (DIALOGS.includes(next) && !DIALOGS.includes(prev)) U.ret = HOMES.includes(prev) ? prev : (safe(() => M.cur(), 1) > LEVELS ? 'allbeaten' : 'title');
  if (next === 'map' && !DIALOGS.includes(prev)) mapFocus(S, true);
  if ((prev === 'win' || prev === 'lose') && next !== 'win' && next !== 'lose') {
    if (U.card && (U.card.type === 'win' || U.card.type === 'lose' || U.after)) U.card = null;
    if (U.after) { U.after = null; U.cards = []; }
    U.winDone = U.loseDone = false;
  }
  if (next !== 'play') { clearCallouts(); U.hand = null; U.ghost = null; }
  if (next === 'shop') { U.shop.confirm = null; U.shop.msg = null; U.shop.tab = 'outfits'; U.shop.sel = (safe(() => M.outfits(), []).find(o => o.worn) || { id: 'tabby' }).id; U.shop.bsel = BK.find(k => safe(() => M.boosterUnlocked(k), false)) || 'undo'; }
  U.reset = 0;
  U.press = null; U.drag = null;
}
function onSession(S) {
  U.sessRef = S.sess;
  clearCallouts();
  U.hand = null; U.ghost = null; U.attn = []; U.idle = 0; U.tutOn = false; U.intro = null; U.fly = [];
  U.winAt = U.loseAt = 0; U.winDone = U.loseDone = false; U.rArm = null; U.bArm = null; U.blk = null; U.first = null; U.banner = null;
  if (U.card && (U.card.type === 'win' || U.card.type === 'lose')) U.card = null;
  const s = S.sess;
  U.tut = s && s.kind === 'level' ? safe(() => tutorialFor(s.id), null) : s && (s.kind === 'daily' || s.kind === 'bonus') ? safe(() => dirMechanics(s), null) : null;
  U.teach = null; U.teachPend = safe(() => teachFor(s), null);
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
  if (!['gift', 'chest', 'unlockBooster', 'shield', 'ladder', 'bonusGift', 'setReady', 'set'].includes(type)) return null;
  const key = type + '|' + (data.k || '') + '|' + (data.at || '') + '|' + (data.world || '') + '|' + (data.w || '') + '|' + (data.gold ? 'g' : '') + '|' + (data.day || '');
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
  // fix 6 (was ui2 U6, which only folded a star gift into a booster unlock): after a win there is at most ONE extra
  //   card. Every gift / chest / unlock of this win folds into a single Rewards card with one COLLECT.
  const cards = list.length > 1 ? [{ type: 'rewards', key: 'rewards|' + list.map(x => x.key).join(','), data: { parts: list.map(x => ({ type: x.type, data: x.data || {} })) }, t0: U.t, emitted: [] }] : list;
  U.card = null;
  if (!cards.length) { fn(); return; }
  U.cards = cards; U.after = fn;
  nextCard();
}
function nextCard() {
  U.card = null;
  if (U.cards.length) { U.card = U.cards.shift(); U.card.t0 = U.t; return; }
  const fn = U.after; U.after = null;
  if (fn) fn();
}
/** fix r2: lose-card Hint. Buys one first when stock is 0 (yarn allowing), then api.rescueHint rewinds to the last
 *  spot with a way out and shows the move. `free` = the one free Hint after 2 losses (no stock, no yarn). */
function loseHint(free, lkey) {
  if (!free && safe(() => M.booster('hint'), 0) <= 0) {
    if (safe(() => M.balance(), 0) < BOOSTERS.hint.price) {
      U.shakes['l-hint'] = U.t; toast('Not enough yarn balls');
      return;
    }
    if (!safe(() => M.buyBooster('hint'), false)) return;
    bus.emit('buy', { item: 'hint' });
  }
  const ok = !!(api && typeof api.rescueHint === 'function' && safe(() => api.rescueHint(free), false));
  if (!ok) { U.shakes['l-hint'] = U.t; toast('No way out from here. Try Retry'); return; }
  if (free) U.freeHintUsed[lkey] = true;
  const S = U.S;
  if (S && S.sess && !S.sess.stuck) U.card = null;
}
function loseBooster(k) {
  if (!tapBooster(k)) return;
  const S = U.S;
  if (S && S.screen === 'lose') safe(() => api.resume());
  if (S && S.sess && !S.sess.stuck) U.card = null;
}

// ---------- boosters ----------
/** Contract 3: api.canUseBooster(key) → {ok, reason}; local fallback while the api lacks it. */
function canUse(k) {
  if (api && typeof api.canUseBooster === 'function') return safe(() => api.canUseBooster(k), { ok: true, reason: '' }) || { ok: true, reason: '' };
  const s = U.S && U.S.sess;
  if (!s) return { ok: false, reason: '' };
  if (k === 'undo' && !(s.hist && s.hist.length)) return { ok: false, reason: 'Nothing to undo yet' };
  if (k === 'slot' && s.slotUsed) return { ok: false, reason: '+1 Slot already used this level' };
  if ((k === 'hint' || k === 'snip') && s.stuck && s.boosterArm !== k) return { ok: false, reason: 'No moves left. Try Undo' };
  return { ok: true, reason: '' };
}
function refuse(k, reason) {
  if (!reason || U.t - (U.rate['r:' + reason] || -9) < 1) return;
  U.rate['r:' + reason] = U.rate.refuse = U.t;
  U.shakes['b-' + k] = U.t; U.shakes['l-' + k] = U.t;
  if (U.card) toast(reason); else say(reason, { pri: 2, dur: 1.8 });
}
function tapBooster(k) {
  if (!safe(() => M.boosterUnlocked(k), false)) return false;
  // contract 3: ask first; a refusal charges nothing (no buy, no stock) and says why
  const can = canUse(k);
  if (!can.ok) {
    refuse(k, can.reason || 'Not right now');
    if (can.doomed) safe(() => api.useBooster(k)); // refuses again, but flags doomed + pulses Undo (no charge)
    return false;
  }
  if (safe(() => M.booster(k), 0) <= 0) {
    if (safe(() => M.balance(), 0) < BOOSTERS[k].price) {
      U.shakes['b-' + k] = U.t; U.shakes['l-' + k] = U.t;
      say('Not enough yarn balls', { pri: 2, dur: 1.6 });
      if (U.card) toast('Not enough yarn balls');
      return false;
    }
    // polish round 3 (spend confirmation): in a level a 0-stock booster costs yarn balls, so the first tap only
    //   arms the buy (gold ring + "Tap again: Hint for 40", 3 s), the second spends. Lose-card buttons are already
    //   an explicit priced choice and buy at once.
    if (!U.card && !(U.bArm && U.bArm.k === k && U.t < U.bArm.until)) {
      U.bArm = { k, until: U.t + 3 };
      forceSay(`Tap again: ${BNAME[k]} for ${BOOSTERS[k].price} yarn`, 3, 2.8);
      return false;
    }
    U.bArm = null;
    clearSay(`Tap again: ${BNAME[k]} for ${BOOSTERS[k].price} yarn`); // the ask is answered; don't linger over the result
    if (!safe(() => M.buyBooster(k), false)) return false;
    bus.emit('buy', { item: k });
  }
  const ok = safe(() => api.useBooster(k), false);
  if (!ok) {
    const S = U.S, msg = k === 'slot' ? 'Only one +1 Slot per try' : k === 'undo' ? 'Nothing to undo yet' : k === 'hint' && S && S.sess && S.sess.hint ? 'Hint is showing' : '';
    if (msg) refuse(k, msg);
  }
  return !!ok;
}
function toast(text) { U.toast = { text, t0: U.t }; }
/** meta.kittenName(i) is 0-based (i = kittenId - 1); '' when meta lacks it. */
const kName = i => (typeof M.kittenName === 'function' ? safe(() => M.kittenName(i), '') : '') || '';

// ---------- draw ----------
export function draw(g, S) {
  if (!S) return;
  U.S = S;
  U.btns = []; U.sliders = []; U.reg = true; U.dlg = null;
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
    if (U.how) drawHow(g, S);
    if (U.toast) drawToast(g, S);
  } finally { g.restore(); }
  syncNav(S);
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
  const W1 = tw(g, 'Knot', s1) + s1 * 0.105, x1 = cx - W1 / 2;
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
  // polish round 3 (RENDER: the logo read "Knct"): letters are drawn one by one with a little tracking, all ink
  //   outlines first and all fills after, and a slimmer outline, so one letter's outline never eats into the next
  //   letter or closes the o's counter (Lilita's n-o pair is tight).
  const word = (s, x, y, size) => {
    const tr = size * 0.035, ws = [...s].map(ch => tw(g, ch, size)), tot = ws.reduce((a, b) => a + b, 0) + tr * (s.length - 1);
    const xs = []; let xx = x - tot / 2;
    for (const w of ws) { xs.push(xx + w / 2); xx += w + tr; }
    [...s].forEach((ch, i) => txt(g, ch, xs[i] + size * 0.03, y + size * 0.06, size, { col: 'rgba(43,36,64,0.45)' }));
    setFont(g, size, FT, ''); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = size * 0.13; g.strokeStyle = INK;
    [...s].forEach((ch, i) => g.strokeText(ch, xs[i], y));
    g.fillStyle = CREAM;
    [...s].forEach((ch, i) => g.fillText(ch, xs[i], y));
    return tot;
  };
  word('Knot', cx, y1, s1);
  // polish: the yarn stays BEHIND the word (it shows through the o's hole). Drawn in front of the o's right half it
  //   cut the ring and "Knot" read "Knct".
  void ox; void ow;
  // ear notch on the K of Kitty
  const W2 = tw(g, 'Kitty', s2) + s2 * 0.14, kx = cx - W2 / 2 + s2 * 0.13, top = y2 - s2 * 0.36;
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
// DECISION (meta v2): after all 60 levels the home screens' primary button is the reason to come back: "DAILY KNOT"
//   while today's daily is open, else "BONUS TANGLE N". The map (and L60 replays) become secondary. Bonus Tangles get
//   their own entry (title icon, map strip) as soon as the campaign opens them (World 3 boss, see meta.bonusState).
function goBonus() {
  const bs = safe(() => M.bonusState(), { open: false, need: 0, next: 0 });
  if (bs.open) { api.go('play', { kind: 'bonus', id: bs.next }); return true; }
  if (bs.next > 0 && !bs.open) toast(bs.need ? `Beat level ${bs.need} to open the next Bonus Tangle` : 'More Bonus Tangles soon');
  else toast(`Beat level ${Math.max(30, bs.need || 30)} to open Bonus Tangles`);
  return false;
}
function homeCta() {
  if (safe(() => M.cur(), 1) <= LEVELS) return null;
  const dl = safe(() => M.daily(), { unlocked: false, won: true });
  if (dl.unlocked && !dl.won) return { id: 'daily', label: 'DAILY KNOT', sub: dl.streak > 0 ? `DAY ${dl.day} OF 7` : 'NEW TODAY', act: () => api.go('daily') };
  const bs = safe(() => M.bonusState(), { next: 0 });
  return { id: 'bonus', label: `BONUS TANGLE ${bs.next + 1}`, sub: 'A NEW PUZZLE', act: goBonus };
}
function drawTitle(g, S) {
  const d = U.du, W = S.W, inset = layoutOf(S).inset || 0, H = S.H - inset;
  // fix 1 (desktop m6): the web page's fixed nav.back chips already link to more games; no duplicate in the canvas
  const land = isLand(S), canLink = !!P.canLink && !safe(() => !!document.querySelector('nav.back'), false);
  const cur = safe(() => M.cur(), 1), prog = safe(() => M.progress(), 0);
  const dl = safe(() => M.daily(), { unlocked: false, won: true });
  const lv2 = safe(() => LV.getLevel(2), null);
  const playSub = prog > 0 ? (cur > LEVELS ? 'ALL 60 BEATEN' : `LEVEL ${cur}`) : '';
  const playAct = () => { if (prog === 0) api.go('play', { kind: 'level', id: 1 }); else api.go('map'); };
  const cta = homeCta(), bs = safe(() => M.bonusState(), { any: false, open: false });
  const setDot = safe(() => M.setsClaimable().length > 0, false);
  const iconsRow = (cx, y, e, maxW) => {
    const items = [['daily', 'calendar', 'Daily', () => api.go('daily'), dl.unlocked && !dl.won && !(cta && cta.id === 'daily')]];
    // meta v2: Bonus Tangles get a title icon once the campaign opens them (dot: a new one is ready)
    if (bs.any) items.push(['bonus', 'star', 'Bonus', goBonus, bs.open && !(cta && cta.id === 'bonus')]);
    items.push(['kittens', 'paw', 'Kittens', () => api.go('kittens'), setDot],
      ['shop', 'cart', 'Shop', () => api.go('shop')], ['settings', 'gear', 'Settings', () => api.go('settings')]);
    const n = items.length;
    const r = Math.max(Math.min(22, (maxW - (n - 1) * 4) / (2 * n)), Math.min(23 * e, (maxW - (n - 1) * 8 * e) / (2 * n))), gapX = Math.min(28 * e, (maxW - 2 * n * r) / (n - 1)), total = 2 * n * r + (n - 1) * gapX;
    items.forEach(([id, ic, label, act, dot], i) => {
      const x = cx - total / 2 + i * (2 * r + gapX);
      // fix r2: labels sit on a cream felt pill (ink text) so they read over the baked pumpkins at 360x640, and the
      //   label is part of the button's hit area (critics: "only the circles are tappable")
      const mw = 2 * r + gapX - 4, fs = Math.max(12, fitSize(g, label, mw - 8, Math.max(12, 13 * e), FB, '800')), lw = Math.min(mw, tw(g, label, fs, FB, '800') + fs * 0.9);
      const ly = y + 2 * r + 10 * e, hw = Math.max(2 * r, lw);
      iconBtn(g, { id: 't-' + id, label, x, y, w: 2 * r, h: 2 * r, icon: ic, act, dot, d: e,
        hit: { x: x + r - hw / 2, y, w: hw, h: ly + fs * 0.72 - y } });
      rr(g, x + r - lw / 2, ly - fs * 0.72, lw, fs * 1.44, fs * 0.72); g.fillStyle = CREAM; g.fill();
      g.lineWidth = Math.max(1, 1.6 * e); g.strokeStyle = INK; g.stroke();
      txt(g, label, x + r, ly, fs, { f: FB, w: '800', col: INK, maxW: lw - 4 });
    });
  };
  const playBtn = (cx, y, w, e) => {
    if (!cta) { pill(g, { id: 'title-play', label: 'PLAY', sub: playSub || null, kind: 'primary', x: cx - w / 2, y, w, h: 72 * e, act: playAct, d: e }); return; }
    // after L60: [ DAILY KNOT / BONUS TANGLE N ] [map]; the round Map button opens the level map (replays)
    const r = Math.max(22, 26 * e), gap = 10 * e, pw = w - 2 * r - gap, x0 = cx - w / 2;
    pill(g, { id: 'title-play', label: cta.label, sub: cta.sub, kind: 'primary', x: x0, y, w: pw, h: 72 * e, act: cta.act, d: e });
    iconBtn(g, { id: 'title-map', label: 'Level map', icon: 'map', x: x0 + pw + gap, y: y + 36 * e - r - 3 * e, w: 2 * r, h: 2 * r, act: () => api.go('map'), d: e });
  };
  const link = (y, e) => {
    if (!canLink) return;
    const s = 13 * e, x = Math.max(12 * e, 10), label = 'more games', w = tw(g, label, s, FB, '800');
    reg({ id: 'more', label: 'more games', x: x - 4, y: y - 11 * e, w: w + 8, h: 22 * e, act: () => P.link('../') });
    txt(g, label, x, y, s, { f: FB, w: '800', align: 'left', col: '#fff', stroke: INK, sk: 0.3 });
    g.fillStyle = '#fff'; g.fillRect(x, y + s * 0.62, w, Math.max(1, s * 0.08));
  };
  const boardBlock = (bx, by, bw, bh) => {
    if (bw < 20 || bh < 20) return;
    const ks = Math.min(bh * 0.42, bw * 0.28);
    const bwid = Math.min(bw - ks * 0.9, bh * 0.92);
    const x0 = bx + (bw - bwid - ks * 0.9) / 2;
    const r = aMini(g, { x: x0, y: by, w: bwid, h: bh }, lv2, U.t, { loops: 4 });
    const fr = r && r.B ? r.B : { x: x0, y: by, w: bwid, h: bh * 0.8 };
    const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
    aKitty(g, Math.min(bx + bw - ks * 0.45, fr.x + fr.w + ks * 0.5), fr.y + fr.h + ks * 0.1, ks, 'idle', U.t, wear);
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
// DECISION (fix 2, critics "desktop map squeezed into the lower right"): on landscape screens the path's vertical
//   pitch uses s = min(du, H/640) instead of du, so ~6-7 levels (a full left-right swing of the path) show at once,
//   and the swing widens to 30 % of the width (≤ 230 s) so the path is balanced around the centre. Phones, tablets
//   and square screens keep s = du (unchanged). mm.s is also the resize anchor unit (mapKeep).
function mapM(S) {
  const d = U.du, W = S.W, H = S.H, inset = layoutOf(S).inset || 0, land = isLand(S);
  const s = land ? Math.min(d, H / 640) : d;
  const topH = 60 * d, playH = 52 * d, botH = playH + 24 * d + inset;
  const dy = 66 * s, gap = 90 * s;
  const yc = i => (i - 1) * dy + (worldOf(Math.min(LEVELS, i)) - 1) * gap;
  const baseY = H - botH - 56 * s;
  const topY = yc(LEVELS) + 150 * s;
  // fix 2: the trophy (and node 60) stop clear of the header at full scroll (it used to sit half under it)
  const maxScroll = Math.max(0, topY - (baseY - topH - 54 * d));
  const amp = land ? Math.min(W * 0.3, 230 * s) : Math.min(W * 0.27, 120 * d);
  return { d, s, W, H, topH, playH, botH, dy, gap, yc, baseY, maxScroll, amp, cx: W / 2, inset };
}
// fix 2 (kid13 "top lock node half under the header"): 0..1 opacity for a map item spanning [y0, y1] so nothing is
//   ever drawn half under the header or the PLAY strip: fully shown once clear, gone by the time its centre reaches
//   the edge. The path itself still runs under both bars.
function mapClear(mm, y0, y1, stripY) {
  const c = (y0 + y1) / 2, top = mm.topH + 2 * mm.d, bot = stripY - 2 * mm.d;
  const a = y0 >= top ? 1 : c <= top ? 0 : (c - top) / Math.max(1, c - y0);
  const b = y1 <= bot ? 1 : c >= bot ? 0 : (bot - c) / Math.max(1, y1 - c);
  return clamp(Math.min(a, b), 0, 1);
}
const nY = (mm, Y) => mm.baseY - Y + U.map.scroll;
const nX = (mm, i) => mm.cx + Math.sin(i * 0.95) * mm.amp;
function mapFocus(S, snap) {
  const mm = mapM(S), cur = Math.min(LEVELS, safe(() => M.cur(), 1));
  U.map.sel = cur;
  const s = clamp(mm.yc(cur) - mm.baseY + mm.topH + (mm.H - mm.topH - mm.botH) * 0.55, 0, mm.maxScroll);
  if (snap) { U.map.scroll = s; U.map.v = 0; U.map.target = null; U.map.key = null; } else U.map.target = s;
}
// fix 1 (desktop m2): the map keeps the content point at the view's centre, in du units, across a resize
function mapKeep(mm) {
  const m = U.map, key = mm.W + 'x' + mm.H, mid = mm.topH + (mm.H - mm.topH - mm.botH) / 2;
  if (m.key && m.key !== key && m.anchor != null) {
    const s = m.anchor * mm.s - mm.baseY + mid;
    m.scroll = clamp(s, 0, mm.maxScroll);
    if (m.target != null) m.target = clamp(m.tAnchor * mm.s - mm.baseY + mid, 0, mm.maxScroll);
  }
  m.key = key;
  m.anchor = (m.scroll + mm.baseY - mid) / mm.s;
  m.tAnchor = m.target != null ? (m.target + mm.baseY - mid) / mm.s : null;
}
function mapUpdate(dt, S) {
  const mm = mapM(S), m = U.map;
  mapKeep(mm);
  if (m.target != null) { m.scroll = lerp(m.scroll, m.target, 1 - Math.exp(-8 * dt)); if (Math.abs(m.scroll - m.target) < 0.5) m.target = null; }
  else if (!m.drag && Math.abs(m.v) > 1) { m.scroll += m.v * dt; m.v *= Math.exp(-3.5 * dt); }
  if (m.scroll < 0 || m.scroll > mm.maxScroll) { m.scroll = clamp(m.scroll, 0, mm.maxScroll); m.v = 0; }
  mapKeep(mm);
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
  const mm = mapM(S), d = mm.d, sd = mm.s, W = mm.W, H = mm.H;
  mapKeep(mm);
  const cur = safe(() => M.cur(), 1), sel = clamp(U.map.sel || 1, 1, Math.min(cur, LEVELS));
  U.map.sel = sel;
  const span = mm.dy + mm.gap;
  const playY = H - mm.inset - 12 * d - mm.playH, stripY = playY - 10 * d; // bottom PLAY strip (drawn last)
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
    const cy = nY(mm, mm.yc(10 * w) + (w < 6 ? 0.3 * span : 70 * sd));
    const cx = w < 6 ? lerp(nX(mm, 10 * w), nX(mm, 10 * w + 1), 0.42) : mm.cx + mm.amp * 0.65;
    const ca = mapClear(mm, cy - 22 * d, cy + 12 * d, stripY);
    if (ca > 0 && cy > -40 * d && cy < H + 40 * d) { g.save(); g.globalAlpha *= ca; chestIcon(g, cx, cy, 34 * d, safe(() => M.chestClaimed(w), false)); g.restore(); }
    const ly = w === 1 ? nY(mm, mm.yc(1) - 50 * sd) : nY(mm, mm.yc(10 * (w - 1)) + 0.64 * span);
    // fix 2: under a modal (settings / shop / kittens / daily over the map) the labels are hidden: at 1440×900 the
    //   settings card's bottom edge cut the "World 1" strip in half.
    // meta v2: the label fades under the header / PLAY strip like the nodes (the W1 pill used to be clipped by the
    //   strip), and an open world shows its Kitten Corner set progress on a chip: [paw 7/10], gold when all 10 are
    //   3★, a red dot when a set reward waits. Tapping the label opens that world's Kitten Corner page.
    const la = mapClear(mm, ly - 15 * d, ly + 15 * d, stripY);
    if (S.screen === 'map' && la > 0 && ly > -30 * d && ly < H + 30 * d) {
      const locked = cur < (w - 1) * PER_WORLD + 1;
      const label = `World ${w} · ${WORLDS[w].name}`;
      const si = locked ? null : safe(() => M.setInfo(w), null);
      const chip = si ? (si.golden ? `★ ${si.gold3}/10` : `${si.got}/10`) : '';
      const maxW = Math.min(W - 24 * d, 340 * d);
      let s = Math.max(12, 15 * d), cs = s, cw = 0;
      const fit = () => { cw = chip ? tw(g, chip, cs, FB, '900') + cs * 1.9 + 8 * d : 0; return tw(g, label, s) + 28 * d + cw; };
      while (fit() > maxW && s > 12) { s = Math.max(12, s - 0.5); cs = s; }
      const lw = Math.min(maxW, fit()), lh = s * 1.7, x0 = mm.cx - lw / 2;
      g.save(); g.globalAlpha *= la;
      rr(g, x0, ly - lh / 2, lw, lh, lh / 2); g.fillStyle = locked ? '#8F8580' : TEAL; g.fill(); g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
      txt(g, label, x0 + (lw - cw) / 2, ly + s * 0.04, s, { col: '#fff', stroke: INK, sk: 0.22, maxW: lw - cw - 20 * d });
      if (chip) {
        const ch = lh - 8 * d, cx0 = x0 + lw - cw - 4 * d + 4 * d, cy0 = ly - ch / 2;
        rr(g, cx0, cy0, cw - 4 * d, ch, ch / 2); g.fillStyle = si.golden ? GOLD : CREAM; g.fill(); g.lineWidth = Math.max(1, 1.6 * d); g.strokeStyle = INK; g.stroke();
        aIcon(g, si.golden ? 'star' : 'paw', cx0 + cs * 0.85, ly, cs * 1.1, si.golden ? GOLD : INK);
        txt(g, si.golden ? chip.slice(2) : chip, cx0 + cs * 1.6 + (cw - 4 * d - cs * 1.6) / 2 - 2 * d, ly + cs * 0.04, cs, { f: FB, w: '900', col: INK, maxW: cw - cs * 1.9 });
        if (si.claimable || si.goldClaimable) { g.beginPath(); g.arc(cx0 + cw - 6 * d, cy0 + 2 * d, Math.max(5, 5 * d), 0, 7); g.fillStyle = TOMATO; g.fill(); g.lineWidth = Math.max(1, 2 * d); g.strokeStyle = '#fff'; g.stroke(); }
      }
      g.restore();
      if (la > 0.6 && !locked) reg({ id: 'm-world' + w, label: `World ${w} kittens`, x: x0, y: ly - Math.max(22, lh / 2), w: lw, h: Math.max(44, lh),
        act: () => { U.kPage = w - 1; api.go('kittens'); } });
    }
  }
  // trophy
  // fix 1 (state M2): the trophy is a button: All Beaten / Bonus Tangles once every level is beaten
  const ty = nY(mm, mm.yc(LEVELS) + 130 * sd);
  const tsz = 54 * d, ta = mapClear(mm, ty - tsz * 0.62, ty + tsz * 0.46, stripY);
  if (ta > 0 && ty > -60 * d && ty < H + 60 * d) {
    const tx = mm.cx - mm.amp * 0.3, done = cur > LEVELS, ts = tsz;
    g.save(); g.globalAlpha *= ta;
    if (done) { const p = 0.5 + 0.5 * Math.sin(U.t * 3); g.save(); g.globalAlpha = 0.35 + 0.3 * p; g.beginPath(); g.arc(tx, ty - ts * 0.1, ts * (0.62 + 0.06 * p), 0, 7); g.fillStyle = GOLD; g.fill(); g.restore(); }
    const tb = reg({ id: 'm-trophy', label: done ? 'All beaten' : 'Trophy', x: tx - ts * 0.5, y: ty - ts * 0.6, w: ts, h: ts * 1.1,
      act: () => { if (done) api.go('allbeaten'); else toast(`Beat all ${LEVELS} levels to win the trophy`); } });
    if (hov(tb)) { g.save(); g.translate(0, -2); trophy(g, tx, ty, ts); g.restore(); } else trophy(g, tx, ty, ts);
    g.restore();
  }
  // nodes
  U.map.nodes = [];
  const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
  for (let i = f; i <= l; i++) {
    const x = pts[i - 1][0], y = pts[i - 1][1];
    const boss = i % PER_WORLD === 0, r = (boss ? 23 : 17) * d;
    const st = safe(() => M.stars(i), 0), open = i <= cur, isCur = i === Math.min(cur, LEVELS) && cur <= LEVELS;
    const na = mapClear(mm, y - r - 8 * d, y + r + (open && i < cur ? 15 * d : 8 * d), stripY);
    if (na <= 0) continue;
    g.save();
    g.globalAlpha *= na;
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
    if (isCur) {
      const side = Math.sin(i * 0.95) > 0 ? -1 : 1;
      aKitty(g, x + side * (r + 22 * d), y + r * 0.8, 44 * d, 'idle', U.t, wear);
    }
    g.restore();
    if (na < 0.4) continue; // mostly hidden under a bar: not tappable
    if (open) U.map.nodes.push({ id: i, x, y, r });
    else U.map.nodes.push({ id: i, x, y, r, locked: true });
  }
  if (cur > LEVELS && ty > -60 * d && ty < H + 60 * d) aKitty(g, mm.cx + mm.amp * 0.3, ty + 30 * d, 50 * d, 'celebrate', U.t, wear);
  // top bar
  g.fillStyle = CREAM; g.fillRect(0, 0, W, mm.topH);
  g.fillStyle = INK; g.fillRect(0, mm.topH - 3 * d, W, 3 * d);
  g.save(); g.setLineDash([6 * d, 5 * d]); g.strokeStyle = STITCH; g.lineWidth = 1.6 * d; g.beginPath(); g.moveTo(0, mm.topH - 9 * d); g.lineTo(W, mm.topH - 9 * d); g.stroke(); g.restore();
  const bw = Math.min(W, 560 * d), bx = (W - bw) / 2, cy = (mm.topH - 4 * d) / 2, ir = Math.max(22, 22 * d); // ≥ 44 px
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
  // fix 2 (art director): the fill matches its "have / need" label (it used to show progress inside the current
  //   15-star segment, so "62 / 75" drew a nearly empty bar)
  const barY = cy + 9 * d, barW = sw - 6 * d, p = ng.need > 0 ? ng.have / ng.need : 1;
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
  // bottom PLAY on a backing strip (fix 1, desktop m1): nodes and world banners scroll under the strip, not the button
  const pw = Math.min(W - 24 * d, 300 * d), py = playY;
  g.fillStyle = CREAM; g.fillRect(0, stripY, W, H - stripY);
  g.fillStyle = INK; g.fillRect(0, stripY, W, 3 * d);
  g.save(); g.setLineDash([6 * d, 5 * d]); g.strokeStyle = STITCH; g.lineWidth = 1.6 * d; g.beginPath(); g.moveTo(0, stripY + 9 * d); g.lineTo(W, stripY + 9 * d); g.stroke(); g.restore();
  // meta v2: after L60 the primary is the daily / next bonus tangle and the selected level is a secondary replay; once
  //   the campaign opens Bonus Tangles (World 3 boss) a secondary BONUS button sits beside PLAY.
  const cta = homeCta(), bs = safe(() => M.bonusState(), { any: false, open: false });
  const playLv = () => api.go('play', { kind: 'level', id: sel });
  if (cta || bs.any) {
    const tw2 = Math.min(W - 24 * d, 440 * d), gap = 10 * d, x0 = (W - tw2) / 2;
    const w1 = Math.round((tw2 - gap) * 0.6), w2 = tw2 - gap - w1;
    if (cta) {
      pill(g, { id: 'map-play', label: cta.label, kind: 'primary', x: x0, y: py, w: w1, h: mm.playH, act: cta.act });
      pill(g, { id: 'map-replay', label: `REPLAY L${sel}`, kind: 'secondary', x: x0 + w1 + gap, y: py, w: w2, h: mm.playH, act: playLv });
    } else {
      pill(g, { id: 'map-play', label: `PLAY L${sel}`, kind: 'primary', x: x0, y: py, w: w1, h: mm.playH, act: playLv });
      pill(g, { id: 'map-bonus', label: 'BONUS', sub: bs.open ? `TANGLE ${bs.next + 1}` : `AT LEVEL ${bs.need}`, kind: bs.open ? 'secondary' : 'ghost',
        x: x0 + w1 + gap, y: py, w: w2, h: mm.playH, act: goBonus, badge: bs.open ? { n: '!' } : null });
    }
  } else pill(g, { id: 'map-play', label: `PLAY L${sel}`, kind: 'primary', x: (W - pw) / 2, y: py, w: pw, h: mm.playH, act: playLv });
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
    drawBlk(g, S);
    drawFirst(g, S, L);
    drawTeach(g, S, L);
    drawFly(g, S, L);
    drawHand(g, S);
  }
  U.reg = wasReg;
  if (S.screen === 'pause') drawPause(g, S);
}
function drawHUD(g, S, live) {
  const L = layoutOf(S), u = L.u, h = L.hud, sess = S.sess;
  if (!sess) return;
  const dd = Math.max(Math.min(46 * u, h.h - 6), Math.min(44, h.h)), cy = h.y + h.h / 2; // meta r3: ≥ 44 px
  const showBtns = S.screen === 'play' || S.screen === 'pause';
  // polish round 3 (desktop critics: "header floats, pause sits on the curtain rod"): in landscape the HUD row is
  //   one cream plaque (pause | title | retry) so it reads as a single group over any scene art.
  const plaque = L.orient === 'landscape';
  if (plaque) {
    g.save();
    g.shadowColor = 'rgba(43,36,64,0.25)'; g.shadowBlur = 8 * u; g.shadowOffsetY = 3 * u;
    rr(g, h.x, h.y + 1, h.w, h.h - 2, (h.h - 2) / 2); g.fillStyle = 'rgba(255,249,236,0.94)'; g.fill();
    g.restore();
    rr(g, h.x, h.y + 1, h.w, h.h - 2, (h.h - 2) / 2); g.lineWidth = Math.max(1.5, 2.2 * u); g.strokeStyle = INK; g.stroke();
  }
  if (showBtns) {
    iconBtn(g, { id: 'hud-pause', label: 'Pause', x: h.x + L.m, y: cy - dd / 2, w: dd, h: dd, icon: 'pause', act: () => api.pause(), d: u });
    iconBtn(g, { id: 'hud-retry', label: 'Retry level', x: h.x + h.w - L.m - dd, y: cy - dd / 2, w: dd, h: dd, icon: 'retry', act: () => askRestart(S, 'hud-retry'), d: u,
      ring: armed('hud-retry') ? TOMATO : null });
  }
  const lv = sess.level || {};
  const title = sess.kind === 'level' ? `Level ${sess.id}` : lv.name || (sess.kind === 'daily' ? 'Daily Knot' : 'Bonus Tangle');
  const sub = sess.kind === 'level' ? (WORLDS[worldOf(sess.id)] || {}).name || '' : sess.kind === 'daily' ? 'New board every day' : `Bonus tangle ${(sess.id | 0) + 1}`;
  const maxW = h.w - 2 * (L.m + dd + 8);
  const ts = Math.min(22 * u, h.h * 0.44);
  if (plaque) {
    txt(g, title, h.x + h.w / 2, h.y + h.h * 0.4, ts, { col: INK, maxW });
    txt(g, sub, h.x + h.w / 2, h.y + h.h * 0.76, Math.max(11, Math.min(13 * u, h.h * 0.26)), { f: FB, w: '800', col: TEAL_D, maxW });
  } else {
    txt(g, title, h.x + h.w / 2, h.y + h.h * 0.38, ts, { col: '#fff', stroke: INK, sk: 0.22, maxW });
    txt(g, sub, h.x + h.w / 2, h.y + h.h * 0.8, Math.max(11, Math.min(13 * u, h.h * 0.26)), { f: FB, w: '800', col: CREAM, stroke: INK, sk: 0.3, maxW });
  }
  // fix 10: the first-time mechanic line fades in ~3 s; a small "?" next to the level title (and the title itself)
  //   re-shows it in plain words, one mechanic per tap
  const mechs = showBtns ? Object.keys(MECH).filter(k => MECH_LINE[k] && safe(() => MECH[k](sess.puz || {}), false)) : [];
  if (mechs.length) {
    // fix3 (critic r2, grandparent 2): the "?" read as ~20 px; now ~28 px across (the tap area was already the whole title)
    const tW = Math.min(tw(g, title, ts), maxW), rq = Math.max(13, ts * 0.62);
    const qx = h.x + h.w / 2 + tW / 2 + rq + 5, qy = h.y + h.h * (plaque ? 0.4 : 0.38);
    const room = qx + rq <= h.x + h.w - (L.m + dd + 4);
    if (room) {
      g.save(); g.beginPath(); g.arc(qx, qy, rq, 0, 7); g.fillStyle = CREAM; g.fill();
      g.lineWidth = Math.max(1.5, 2 * u); g.strokeStyle = INK; g.stroke(); g.restore();
      txt(g, '?', qx, qy + rq * 0.04, rq * 1.3, { col: INK });
    }
    const x0 = h.x + h.w / 2 - tW / 2 - 4, x1 = room ? qx + rq + 4 : h.x + h.w / 2 + tW / 2 + 4;
    reg({ id: 'hud-help', label: 'What does this do?', x: x0, y: h.y, w: x1 - x0, h: h.h, act: () => {
      const i = (U.mechI | 0) % mechs.length;
      U.mechI = i + 1; forceSay(MECH_LINE[mechs[i]], 3, 4);
    } });
  }
}
/** meta v2: the boxes the HUD boosters cover on screen: icon + top-right badge + the name label under it. One owner
 *  for drawing (boosterRects) and every coach-mark / callout placer that must keep off the booster band. */
function boosterBoxes(L) {
  const keys = BK.filter(k => safe(() => M.boosterUnlocked(k), false));
  if (!keys.length) return [];
  const rs = safe(() => boosterRects(L, keys), {}) || {}, out = [];
  for (const k of keys) {
    const r = rs[k];
    if (!r) continue;
    const R0 = r.w / 2, br = Math.max(11.6, R0 * 0.4), bx = r.x + R0 + R0 * 0.72, by = r.y + R0 - R0 * 0.6;
    const q = { k, x0: Math.min(r.x, bx - br * 1.8), y0: Math.min(r.y, by - br), x1: Math.max(r.x + r.w, bx + br * 1.8), y1: r.y + r.h };
    if (r.lab) { q.x0 = Math.min(q.x0, r.lab.x); q.x1 = Math.max(q.x1, r.lab.x + r.lab.w); q.y1 = Math.max(q.y1, r.lab.y + r.lab.h); }
    out.push(q);
  }
  return out;
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
    // meta v2: the name sits under every booster on a cream chip (r.lab from boosterRects, ≥ 13 px), badge top-right
    iconBtn(g, { id: 'b-' + k, label: BNAME[k], x: r.x, y: r.y, w: r.w, h: r.h, hit: r.hit, icon: k, d: L.u, badgeTop: true,
      cap: r.lab ? BNAME[k] : null, capY: r.lab && r.lab.y, capW: r.lab && r.lab.w, capFs: L.labFs,
      badge: flying ? null : n > 0 ? { n } : { price: BOOSTERS[k].price }, ring: sess.boosterArm === k || hintOn || (U.bArm && U.bArm.k === k && U.t < U.bArm.until) ? GOLD : pulse ? TOMATO : null,
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
  // fix 2: coaching lines read at ≥ 16 css px; they wrap (2 lines, 3 on a very narrow band) and the bubble grows to
  //   hold them rather than the text shrinking to 12 px to fit the band height
  const wf = wrapMin(g, c.text, maxW, Math.max(16, Math.min(19 * u, b.h * 0.62)), 16, 2, FB, '800');
  const textW = Math.max(...wf.lines.map(l => tw(g, l, wf.size, FB, '800')));
  const pw = Math.min(b.w, textW + 2 * padX), ph = wf.size * 1.14 * wf.lines.length + 12 * u;
  let cx = b.x + b.w / 2, cy = b.y + b.h / 2, tail = null;
  const side = calloutSide(g, S, L, pw, ph);
  if (side) { cx = side.cx; cy = side.cy; tail = side.tail; }
  g.save();
  g.globalAlpha = a;
  const sc = 0.92 + 0.08 * e3(c.t / 0.15);
  g.translate(tail ? tail.x : cx, tail ? tail.y : cy); g.scale(sc, sc); g.translate(-(tail ? tail.x : cx), -(tail ? tail.y : cy));
  g.beginPath(); rr(g, cx - pw / 2, cy - ph / 2, pw, ph, Math.min(ph / 2, 16 * u)); g.fillStyle = CREAM; g.fill();
  g.lineWidth = Math.max(1.5, 2.5 * u); g.strokeStyle = INK; g.stroke();
  if (tail) {
    const bx = cx - pw / 2 + 1, tp = Math.min(ph * 0.28, 10 * u);
    g.beginPath(); g.moveTo(bx, tail.ty - tp); g.lineTo(tail.x, tail.y); g.lineTo(bx, tail.ty + tp);
    g.fill(); g.stroke(); g.fillRect(bx - 3, tail.ty - tp + 2, 4, 2 * tp - 4);
  }
  lines(g, wf, cx, cy + wf.size * 0.04);
  g.restore();
}
// DECISION (ui2 U1): on the split (desktop / square) layout a tutorial line that goes with the on-board hand docks
//   right beside the board frame at the hand's height, with a tail pointing at it, instead of floating in the right
//   column far from the hand. It slides up/down to dodge the rack, basket and boosters; if no clean spot exists it
//   stays in the column band as before. Portrait keeps the band (it already sits right above the board).
function calloutSide(g, S, L, pw, ph) {
  const sess = S.sess, h = U.hand;
  if (L.orient !== 'landscape' || !sess || !sess.B || !h || h.src !== 'tut' || U.t < h.t0 - 0.3) return null;
  const pt = tapPoint(h.id);
  if (!pt) return null;
  const B = sess.B, u = L.u, fx = B.x + B.w + B.unit * 0.5, tl = Math.max(10, 14 * u), x0 = fx + tl;
  if (x0 + pw > S.W - L.m * 0.5) return null;
  const key = [h.id, S.W, S.H, Math.round(pw), Math.round(ph)].join('|');
  if (U.cside && U.cside.key === key) return U.cside.v;
  const ob = tagObstacles(S, L, 'callout');
  let best = null;
  for (let i = 0; i <= 12; i++) {
    const dy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * ph * 0.5;
    const y = clamp(pt.y + dy - ph / 2, L.safe.y + 4, L.safe.y + L.safe.h - ph - 4);
    let sc = 0;
    for (const q of ob) { const w = Math.min(x0 + pw, q.x1) - Math.max(x0, q.x0), hh = Math.min(y + ph, q.y1) - Math.max(y, q.y0); if (w > 0 && hh > 0) sc += q.wt * w * hh; }
    sc = sc / (pw * ph) + Math.abs(y + ph / 2 - pt.y) / Math.max(1, B.h) * 0.6;
    if (!best || sc < best.sc) best = { sc, y };
  }
  let v = null;
  if (best && best.sc < 0.35) {
    const cy = best.y + ph / 2, ty = clamp(pt.y, best.y + ph * 0.3, best.y + ph * 0.7);
    v = { cx: x0 + pw / 2, cy, tail: { x: fx, y: ty, ty } };
  }
  U.cside = { key, v };
  return v;
}
// DECISION (fix 2): pops live in the CALLOUT BAND (the strip between the spool rack and the board; in landscape the
//   band in the right column), never at the spool: the old spool anchor pushed big pops up over the HUD subtitle.
//   The band is free while a pop shows (pops hide the callout). Text is sized to the band, the overshoot is capped so
//   the scaled text stays inside it, and everything (burst included) is clipped to the band ± half a margin, so a
//   pop can never touch the HUD text or the board. The coin sub-line rides to the RIGHT of the text, not below it.
function popBand(L) {
  const c = L.callout, m = L.m;
  const top = Math.max(L.rack.y + L.rack.h * 0.55, c.y - m * 0.5);
  const bot = Math.min(L.board && L.orient !== 'landscape' ? L.board.y : c.y + c.h + m * 0.5, c.y + c.h + m * 0.5);
  return { x: c.x, y: top, w: c.w, h: Math.max(8, bot - top), cx: c.x + c.w / 2, cy: c.y + c.h / 2 };
}
function drawPop(g, S, L) {
  const p = U.pop;
  if (!p || U.card || !L.callout) return;
  const u = L.u, band = popBand(L);
  const k = Math.min(1, p.t / (p.d0 || p.dur));
  const hasSub = !!p.sub, ss0 = hasSub ? 0.62 : 0;
  // text box: height ≤ band (minus a hair for the stroke), width ≤ 92 % of the band less the sub-line
  let size = Math.min((p.size || 26) * u, L.callout.h * 1.02, 46 * u);
  setFont(g, size, FT);
  const subW = hasSub ? tw(g, '+' + p.sub, size * ss0, FT) + size * ss0 * 1.1 + 6 * u : 0;
  const maxW = band.w * 0.92 - subW;
  size = fitSize(g, p.text, maxW, size, FT, '', 0.26);
  const textW = tw(g, p.text, size, FT) + (p.ball ? size * 1.1 : 0);
  const totW = textW + subW;
  const x = band.cx, y = band.cy - 3 * u * e3(k);
  // punchy scale-in 0.3 → 1.35 in 0.1 s, settle to 1 by 0.28 s; the peak is capped so the box stays in the band
  const t = p.t;
  let sc = t < 0.1 ? lerp(0.3, 1.35, t / 0.1) : t < 0.28 ? lerp(1.35, 1, e3((t - 0.1) / 0.18)) : 1;
  const capH = Math.min(band.cy - band.y, band.y + band.h - band.cy) / (size * 0.56);
  const capW = (band.w * 0.98) / Math.max(1, totW);
  sc = Math.min(sc, Math.max(1, Math.min(capH, capW)));
  g.save();
  rr(g, band.x, band.y, band.w, band.h, 0); g.clip();
  g.globalAlpha = Math.min(1, Math.max(0, (p.dur - p.t) / Math.max(0.05, p.fade || 0.25)));
  g.translate(x, y); g.rotate(p.big ? -0.035 : 0); g.scale(sc, sc);
  if (p.burst) { // sunburst behind the big ones, flattened to the band
    const rx = Math.min(totW * 0.75, band.w * 0.5), ry = band.h * 0.6, n = 10;
    g.save(); g.globalAlpha *= 0.5 * (1 - k);
    g.fillStyle = p.col === TEAL ? GOLD : CREAM;
    g.beginPath();
    const rot = U.t * 1.5;
    for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, q = i % 2 ? 0.45 : 1; g.lineTo(Math.cos(a) * q * rx, Math.sin(a) * q * ry); }
    g.closePath(); g.fill(); g.restore();
  }
  const tx = -subW / 2 + (p.ball ? size * 0.55 : 0);
  const sz = txt(g, p.text, tx, 0, size, { col: p.col || GOLD, stroke: INK, sk: 0.26 });
  if (p.ball) aIcon(g, 'ball', tx - tw(g, p.text, sz, FT) / 2 - sz * 0.55, 0, sz * 0.8);
  if (hasSub) {
    const ss = sz * ss0, label = '+' + p.sub, lw = tw(g, label, ss, FT);
    const x0 = tx + tw(g, p.text, sz, FT) / 2 + 6 * u;
    aIcon(g, 'ball', x0 + ss * 0.5, sz * 0.06, ss * 0.95);
    txt(g, label, x0 + ss * 1.1 + lw / 2, sz * 0.06, ss, { col: GOLD, stroke: INK, sk: 0.26 });
  }
  g.restore();
}
function drawAttn(g) {
  for (const a of U.attn) {
    const t = U.t - a.t0;
    if (t < 0) continue;
    const p = t / a.dur, bounce = Math.abs(Math.sin(p * Math.PI * 2)) * (1 - p);
    g.save();
    g.globalAlpha = Math.min(1, (1 - p) * 2);
    // Integration fix: a rounded frame around the spool that never rises above its top, so it clears the
    // "NEXT" label drawn just above the spool (the old circle crossed the label at small sizes).
    const h = a.h || a.r / 0.75, grow = h * 0.08 * bounce;
    const top = a.y - h * 0.56, bot = a.y + h * 0.66 + grow, hw = h * 0.6 + grow;
    rr(g, a.x - hw, top, hw * 2, bot - top, Math.min(hw, h * 0.3));
    g.lineWidth = Math.max(2.5, h * 0.09); g.strokeStyle = GOLD; g.stroke();
    g.lineWidth = Math.max(1, a.r * 0.04); g.strokeStyle = INK; g.stroke();
    g.restore();
  }
}
// ---------- first-encounter hints + one-time explainers (polish) ----------
// DECISION (polish, grandparent/curator): one idea at a time, keyed off what is ON the board (not level numbers):
//   f_basket (basket on screen) until a ball first lands in it; f_next (a NEXT spool) until a spool first rolls in;
//   f_c4 (4+ colours) until the next pull; then two explainers that time out: x_more ("+N" chip) and x_par (the ★
//   flag on the basket). Each is a small tag with a pointer; it never shows over a card, a pop or a tutorial hand.
function firstDone(key) { safe(() => M.markTut(key)); if (U.first && U.first.key === key) U.first = null; }
function colourCount(s) { const set = new Set(); for (const q of (s.puz && s.puz.strands) || []) if (q && q.c >= 0 && q.c < 6 && !q.m) set.add(q.c); return set.size; }
/** The "+N more" pill box, as render.js draws it. */
function moreBox(S, L, rs) { const s = S.sess; return safe(() => R.moreChip(null, rs, (s.nextQ || [])[1], moreOf(s), L.u, L.W || S.W), null); }
function moreOf(s) {
  const total = s.puz && s.puz.spools ? s.puz.spools.length : (s.level && s.level.queue ? s.level.queue.length : 0);
  return s.moreN != null ? s.moreN : total - ((s.st && s.st.next) || 0) - Math.min(2, (s.nextQ || []).length);
}
function parShown(s) {
  const par = s.level ? s.level.par : s.puz && s.puz.par, cap = (s.basket || []).length;
  return par != null && par < cap && (s.kind !== 'level' || s.id >= 4) ? par : -1;
}
const FIRST = [
  { key: 'f_basket', ok: (s, L) => !L.hideBasket && (s.basket || []).length > 0, text: 'Basket: extra yarn waits here', at: 'basket' },
  { key: 'f_next', ok: s => (s.nextQ || []).length > 0, text: 'This spool comes next', at: 'next' },
  { key: 'f_c4', ok: s => colourCount(s) >= 4, text: '4 colours now! Match each to its spool', at: 'rack' },
  { key: 'x_more', ok: s => moreOf(s) > 0, text: s => (moreOf(s) === 1 ? '+1 = one more spool after these' : `+${moreOf(s)} = ${moreOf(s)} more spools after these`), at: 'more', dur: 6 },
  { key: 'x_par', ok: s => parShown(s) >= 0, text: 'Keep the basket nearly empty to earn 3 stars', at: 'par', dur: 7 },
];
// DECISION (ui2 L1): a first-time tag knows its TARGET box (t) and a preferred side; placeTag tries every side
//   (above / below / left / right), slides along the target and may shrink one step, scoring each spot by how much
//   it covers the kitten, the rack badges, the HUD, boosters and the board. Result is cached per tag + layout so it
//   never jitters. Nothing it covers is interactive for long (tags fade after their duration or the first tap).
function firstAnchor(S, L, at) {
  const s = S.sess;
  if (at === 'basket' || at === 'par') {
    const sl = safe(() => basketSlots(L, (s.basket || []).length), []);
    if (!sl.length) return null;
    const r = sl[0].r;
    if (at === 'basket') return { pref: 'above', t: { x0: sl[0].x - r * 1.1, y0: sl[0].y - r * 1.15, x1: sl[sl.length - 1].x + r * 1.1, y1: sl[0].y + r * 1.1 } };
    const par = parShown(s);
    const xm = par === 0 ? sl[0].x - r * 1.3 : (sl[par - 1].x + sl[par].x) / 2;
    return { pref: 'above', t: { x0: xm - 2, y0: sl[0].y - r * 1.9, x1: xm + 2, y1: sl[0].y + r } };
  }
  const rs = safe(() => rackSlots(L), null);
  if (!rs) return null;
  const box = p => ({ x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 });
  if (at === 'next' && rs.next[0]) return { pref: 'below', t: box(rs.next[0]) };
  // fix4 (critic r3, art 1 / grandparent: on phone the L7 "+1" bubble sat on the active spools' badges for ~3 s): in
  //   the target reaches down to the shelf, so the bubble hangs under the rack (portrait: over the board's top edge;
  //   landscape: it used to sit on the HUD world name)
  if (at === 'more') {
    const mc = moreBox(S, L, rs);
    if (!mc) return null;
    const rk = L.rack, shelf = rk && rk.h > 0 ? rk.y + rk.h : 0;
    return { pref: 'below', t: shelf > mc.y1 ? { x0: mc.x0, y0: mc.y0, x1: mc.x1, y1: shelf } : mc };
  }
  if (at === 'rack') { const a = box(rs.active[0]), b = box(rs.active[1]); return { pref: 'below', t: { x0: a.x0, y0: a.y0, x1: b.x1, y1: a.y1 } }; }
  return null;
}
/** Boxes a tag should not cover, with weights (kitten worst). The tag's own target is left out. */
function tagObstacles(S, L, at) {
  const s = S.sess, o = [], add = (x0, y0, x1, y1, wt) => o.push({ x0, y0, x1, y1, wt });
  // fix3 (critic r2: the L7 "+1" tag half-covered the world name): the HUD's level/world text weighs more than the
  //   board top, so a tag drops onto the board edge instead
  if (L.hud) add(L.hud.x, L.hud.y, L.hud.x + L.hud.w, L.hud.y + L.hud.h, 5);
  const B = s && s.B;
  if (B) {
    add(B.x, B.y, B.x + B.w, B.y + B.h, 1.2);
    const k = B.kitten;
    if (k && k.s) { const ks = k.s * (s.kind === 'level' && s.id % 10 === 0 ? 1.4 : 1); add(k.x - ks * 0.55, k.y - ks * 1.02, k.x + ks * 0.55, k.y + k.s * 0.08, 5); }
  }
  const rs = safe(() => rackSlots(L), null);
  if (rs) {
    for (const p of rs.active) add(p.x - p.w / 2, p.y - p.h * 0.95, p.x + p.w / 2, p.y + p.h / 2, 2.5);
    // fix r2 (critic: the L6/L7 "+1" tag covered the NEXT spool): the NEXT spool and its "NEXT" label above it are
    //   a heavy obstacle, so a tag never sits on what the player must look at next
    rs.next.forEach((p, i) => add(p.x - p.w / 2 - 4, p.y - p.h * (i ? 0.9 : 1.3), p.x + p.w / 2 + 4, p.y + p.h / 2, i ? 2.5 : 7));
    if (rs.kitty) add(rs.kitty.x - rs.kitty.s * 0.45, rs.kitty.y - rs.kitty.s, rs.kitty.x + rs.kitty.s * 0.45, rs.kitty.y, 1.5);
    const mc = at !== 'more' ? moreBox(S, L, rs) : null;
    if (mc) add(mc.x0, mc.y0, mc.x1, mc.y1, 2.5);
  }
  if (L.basket && !L.hideBasket && at !== 'basket' && at !== 'par') add(L.basket.x, L.basket.y, L.basket.x + L.basket.w, L.basket.y + L.basket.h, 1.5);
  // fix r2 (critic: the L20 tag sat on the boosters): boosters and the HUD buttons are things the player taps, so
  //   they weigh more than the kitten; a tag over the board or the HUD title is the cheaper spot.
  // meta v2: each booster's box (boosterBoxes, the owner shared with drawBoosters) covers its badge and its label too
  for (const q of boosterBoxes(L)) add(q.x0 - 4, q.y0 - 4, q.x1 + 4, q.y1 + 4, 7);
  for (const id of ['hud-pause', 'hud-retry']) { const b = findBtn(id); if (b) add(b.x, b.y, b.x + b.w, b.y + b.h, 4); }
  return o;
}
function placeTag(g, S, L, text, an, at, u) {
  // fix 2 (grandparent): instructional tags read at ≥ 16 css px; a long line wraps to 2 lines instead of shrinking
  const t = an.t, W = S.W, H = S.H, ob = tagObstacles(S, L, at), base = clamp(17 * u, 16, 30);
  const ov = (x0, y0, x1, y1) => { let sc = 0; for (const q of ob) { const w = Math.min(x1, q.x1) - Math.max(x0, q.x0), h = Math.min(y1, q.y1) - Math.max(y0, q.y0); if (w > 0 && h > 0) sc += q.wt * w * h; } return sc; };
  let best = null;
  for (const [si, size] of [base, Math.max(16, base * 0.9)].entries()) {
    const mw = Math.min(W - 24, 340 * Math.max(1, u)) - 1.4 * size;
    const wf = wrapMin(g, text, mw, size, 16, 2, FB, '900');
    const fs = wf.size, lw = Math.max(...wf.lines.map(l => tw(g, l, fs, FB, '900')));
    const w = lw + 1.4 * fs, h = fs * (1.14 * wf.lines.length + (wf.lines.length > 1 ? 0.96 : 0.78)), tip = fs * 0.6, gap = 2;
    const tryAt = (side, x, y, tx, ty, pen) => {
      if (x < 6 || y < 4 || x + w > W - 6 || y + h > H - 4) return;
      const sc = ov(x, y, x + w, y + h) / (w * h) + pen + si * 0.12;
      if (!best || sc < best.sc) best = { sc, side, x, y, w, h, tip, fs, tx, ty, lines: wf.lines };
    };
    const N = 8;
    for (const side of ['above', 'below']) {
      const pen = side === an.pref ? 0 : 0.18;
      const y = side === 'above' ? t.y0 - tip - gap - h : t.y1 + tip + gap;
      const ty = side === 'above' ? t.y0 - gap : t.y1 + gap;
      const lo = Math.max(t.x0 + 4, t.x0), hi = Math.max(lo, t.x1 - 4), cx = (t.x0 + t.x1) / 2;
      for (let i = 0; i <= N; i++) {
        const tx = lo + (hi - lo) * i / N;                    // tip position along the target
        for (const f of [0.5, 0.15, 0.85]) {                  // where the tip sits along the tag
          const x = clamp(tx - w * f, 6, W - 6 - w), txc = clamp(tx, x + h / 2, x + w - h / 2);
          if (txc < t.x0 - 1 || txc > t.x1 + 1) continue;
          tryAt(side, x, y, txc, ty, pen + 0.04 * Math.abs(tx - cx) / Math.max(1, t.x1 - t.x0));
        }
      }
    }
    for (const side of ['left', 'right']) {
      const x = side === 'left' ? t.x0 - tip - gap - w : t.x1 + tip + gap, tx = side === 'left' ? t.x0 - gap : t.x1 + gap;
      for (let i = 0; i <= 4; i++) {
        const ty = t.y0 + (t.y1 - t.y0) * (0.2 + 0.6 * i / 4);
        for (const f of [0.5, 0.25, 0.75]) {
          const y = clamp(ty - h * f, 4, H - 4 - h), tyc = clamp(ty, y + h * 0.3, y + h * 0.7);
          if (tyc < t.y0 - 1 || tyc > t.y1 + 1) continue;
          tryAt(side, x, y, tx, tyc, 0.3);
        }
      }
    }
  }
  return best;
}
function drawTag(g, S, text, p, u, a) {
  if (!p) return;
  const { x, y, w, h, tip, fs, side, tx, ty } = p, vert = side === 'above' || side === 'below';
  const dir = side === 'above' || side === 'left' ? -1 : 1;
  const bob = Math.sin(U.t * 4) * 2 * -dir;
  g.save(); g.globalAlpha = a; if (vert) g.translate(0, bob); else g.translate(bob, 0);
  const rad = p.lines && p.lines.length > 1 ? fs * 0.9 : h / 2; // a 2-line tag gets softer corners so no text is cut
  g.fillStyle = 'rgba(43,36,64,0.25)'; rr(g, x + 2, y + 3, w, h, rad); g.fill();
  g.beginPath(); rr(g, x, y, w, h, rad);
  g.fillStyle = CREAM; g.fill(); g.lineWidth = Math.max(2, 2.4 * u); g.strokeStyle = INK; g.stroke();
  g.beginPath();
  if (vert) {
    const by = side === 'above' ? y + h : y;
    g.moveTo(tx - tip, by); g.lineTo(tx, ty); g.lineTo(tx + tip, by);
    g.fillStyle = CREAM; g.fill(); g.stroke();
    g.fillRect(tx - tip + 2, side === 'above' ? by - 3 : by, 2 * tip - 4, 3);
  } else {
    const bx = side === 'left' ? x + w - 1 : x + 1;
    g.moveTo(bx, ty - tip); g.lineTo(tx, ty); g.lineTo(bx, ty + tip);
    g.fillStyle = CREAM; g.fill(); g.stroke();
    g.fillRect(side === 'left' ? bx - 3 : bx, ty - tip + 2, 3, 2 * tip - 4);
  }
  const ls = p.lines || [text], lh = fs * 1.14, y0 = y + h / 2 + 1 - (ls.length - 1) * lh / 2;
  ls.forEach((l, i) => txt(g, l, x + w / 2, y0 + i * lh, fs, { f: FB, w: '900', col: INK }));
  g.restore();
}
function drawFirst(g, S, L) {
  const s = S.sess;
  if (!s || U.card || SHOWREEL) return;
  drawBanner(g, S, L);
  if (s.result || s.stuck || (s.kind === 'level' && s.id < 2) || U.teach || U.teachPend) return;
  if (U.first && U.first.dur && U.t - U.first.t0 > U.first.dur) firstDone(U.first.key);
  // One idea at a time: a spoken callout or a booster gift flight owns the screen; the tag waits (it is re-armed after).
  if ((U.callout && !U.pop) || U.intro || U.fly.length) { if (U.first) U.first.t0 = U.t; return; }
  if (!U.first) {
    if (U.t < (U.tutStart || 0) + 2.2 || (U.banner && U.t < U.banner.t0 + 2.4)) return;
    const f = FIRST.find(q => !safe(() => M.tutSeen(q.key), true) && safe(() => q.ok(s, L), false));
    if (!f) return;
    U.first = { key: f.key, t0: U.t, dur: f.dur || 0, f };
  }
  const f = U.first.f;
  if (!safe(() => f.ok(s, L), false)) { U.first = null; return; }
  if (U.pop || (U.hand && U.hand.src === 'tut')) return;
  const text = typeof f.text === 'function' ? f.text(s) : f.text;
  const ck = [f.key, text, S.W, S.H, s.B ? Math.round(s.B.y) : 0].join('|');
  if (U.first.ck !== ck) {
    const an = firstAnchor(S, L, f.at);
    U.first.ck = ck; U.first.pl = an ? safe(() => placeTag(g, S, L, text, an, f.at, L.u), null) : null;
  }
  if (!U.first.pl) return;
  const a = Math.min(1, (U.t - U.first.t0) / 0.25, U.first.dur ? (U.first.dur - (U.t - U.first.t0)) / 0.3 : 1);
  drawTag(g, S, text, U.first.pl, L.u, clamp(a, 0, 1));
}
/** TOUGH KNOT banner at the start of a mini/boss knot level. */
// DECISION (ui2 U4): the banner sits on the board's TOP edge (it may cover the first row, never the middle, and it is
//   gone in 2.3 s). A boss level shows the sad, tangled boss in a round portrait plus "<name> is tangled!" so the
//   stakes are personal; a mini knot keeps "TOUGH KNOT!".
function drawBanner(g, S, L) {
  const b = U.banner;
  if (!b) return;
  const t = U.t - b.t0;
  if (t < 0) return;
  // fix 11: 1.6 s in all (pop 0.28 s, hold, 0.35 s fade that ends at exactly 0 and then the banner is dropped, so no
  //   faint ghost lingers), and it sits over the HUD header / top margin instead of the top third of the board
  // fix3 (critic r2, kid 1 / grandparent): it sat on the HUD, so "Level N" and the world name showed through it and
  //   the portrait covered Pause. It now fills the spool rack under the HUD (no text or buttons there but NEXT), and
  //   it leaves by shrinking at full opacity instead of fading, so no text ever shows through it.
  const DUR_B = 1.6, FADE = 0.3;
  if (t >= DUR_B) { U.banner = null; return; }
  const sess = S.sess, u = L.u, bd = sess && sess.B ? sess.B : L.board, hb = L.hud && L.hud.w > 0 ? L.hud : null;
  const rk = L.rack && L.rack.w > 0 && L.rack.h > 0 ? L.rack : null;
  const boss = b.kind === 'boss' && sess && sess.kind === 'level';
  const h0 = Math.max(54, Math.min((boss ? 88 : 76) * u, hb ? Math.max(54, hb.h * 1.5) : bd.h * 0.26));
  // the boss portrait (radius 0.66 h) stays inside the rack
  const h = rk ? Math.max(54, Math.min(h0, rk.h / (boss ? 1.4 : 1.1))) : h0, n0 = h * 0.32 + 8;
  const ref = rk || hb || bd;
  // the ribbon may run past a narrow rack's sides (never off screen) so its text stays ≥ 12 px
  const w = Math.min(S.W - 2 * n0, Math.max(ref.w * 0.96 - 2 * n0, Math.min(S.W - 2 * n0, boss ? 330 : 280)), (boss ? 440 : 380) * Math.max(u, 0.8));
  const cx = clamp(ref.x + ref.w / 2, w / 2 + n0, S.W - w / 2 - n0);
  const cy = rk ? rk.y + rk.h / 2 : hb ? Math.max(hb.y + hb.h / 2, h * (boss ? 0.72 : 0.56) + 4) : Math.max(bd.y + h * 0.62, h * (boss ? 0.72 : 0.56) + 4);
  const fo = clamp((t - (DUR_B - FADE)) / FADE, 0, 1), sc = (t < 0.28 ? eBack(t / 0.28) : 1) * (1 - fo * fo);
  if (sc <= 0.02) return;
  g.save(); g.translate(cx, cy); g.rotate(-0.03); g.scale(sc, sc);
  const n = h * 0.32;
  g.beginPath(); g.moveTo(-w / 2 - n, -h * 0.3); g.lineTo(-w / 2, -h * 0.3); g.lineTo(-w / 2, h * 0.42); g.lineTo(-w / 2 - n, h * 0.42); g.lineTo(-w / 2 - n * 0.5, h * 0.06); g.closePath();
  g.moveTo(w / 2 + n, -h * 0.3); g.lineTo(w / 2, -h * 0.3); g.lineTo(w / 2, h * 0.42); g.lineTo(w / 2 + n, h * 0.42); g.lineTo(w / 2 + n * 0.5, h * 0.06); g.closePath();
  g.fillStyle = TOMATO_D; g.fill(); g.lineWidth = Math.max(2, 3 * u); g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
  g.beginPath(); rr(g, -w / 2, -h / 2, w, h, h * 0.18); g.fillStyle = TOMATO; g.fill(); g.stroke();
  g.setLineDash([6 * u, 5 * u]); g.lineWidth = Math.max(1, 1.6 * u); g.strokeStyle = 'rgba(255,244,228,0.7)';
  g.beginPath(); rr(g, -w / 2 + 6 * u, -h / 2 + 6 * u, w - 12 * u, h - 12 * u, h * 0.12); g.stroke(); g.setLineDash([]);
  if (boss) {
    const id = sess.id | 0, nm = kName(id - 1) || 'The boss', r = h * 0.66, px = -w / 2 + r * 0.82, py = -h * 0.04;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fillStyle = CREAM; g.fill(); g.lineWidth = Math.max(2, 3 * u); g.strokeStyle = INK; g.stroke();
    g.save(); g.beginPath(); g.arc(px, py, r - Math.max(1.5, 2 * u), 0, Math.PI * 2); g.clip();
    safe(() => aKitten(g, px, py + r * 1.02, r * 1.75, { id, stage: 0, loops: 3, flinch: 0, freeT: -1, breed: breedOf(id), coat: coatOf(id), golden: false, bossScale: false, t: U.t, loopColors: [0, 1, 3] }));
    g.restore();
    const tx0 = px + r + 8 * u, tw0 = w / 2 - 10 * u - tx0, tcx = tx0 + tw0 / 2;
    const title = `${nm} is tangled!`;
    let ts = fitSize(g, title, tw0, h * 0.34, FT, '', 0.2);
    let tt = title;
    if (ts < h * 0.24) { const last = nm.split(' ').pop(); tt = `${last} is tangled!`; ts = fitSize(g, tt, tw0, h * 0.34, FT, '', 0.2); }
    txt(g, tt, tcx, -h * 0.1, ts, { col: '#fff', stroke: INK, sk: 0.2, maxW: tw0 });
    txt(g, 'Boss level: take your time', tcx, h * 0.27, Math.max(12, h * 0.19), { f: FB, w: '900', col: CREAM, maxW: tw0 });
  } else {
    txt(g, 'TOUGH KNOT!', 0, -h * 0.1, h * 0.46, { col: '#fff', stroke: INK, sk: 0.2, maxW: w - 24 * u });
    txt(g, 'Take your time', 0, h * 0.3, Math.max(12, h * 0.2), { f: FB, w: '900', col: CREAM, maxW: w - 24 * u });
  }
  g.restore();
}
/** Gold double ring on the strands that cover a tapped one ("tap the one on top"), 0.9 s. */
function drawBlk(g, S) {
  const b = U.blk, sess = S.sess;
  if (!b || !sess || U.card) return;
  const t = (U.t - b.t0) / 0.9;
  if (t >= 1) { U.blk = null; return; }
  const unit = (sess.B && sess.B.unit) || 40, r0 = clamp(unit * 0.55, 16, 46);
  g.save();
  for (const id of b.ids) {
    const p = tapPoint(id);
    if (!p) continue;
    for (let k = 0; k < 2; k++) {
      const q = clamp(t * 1.6 - k * 0.35, 0, 1);
      if (q <= 0 || q >= 1) continue;
      g.globalAlpha = (1 - q) * 0.95;
      g.beginPath(); g.arc(p.x, p.y, r0 * (0.7 + 0.8 * e3(q)), 0, 7);
      g.lineWidth = Math.max(3, unit * 0.12); g.strokeStyle = GOLD; g.stroke();
      g.lineWidth = Math.max(1.2, unit * 0.035); g.strokeStyle = INK; g.stroke();
    }
  }
  g.restore();
}
function drawGhost(g, S, L) {
  const gh = U.ghost, sess = S.sess;
  if (!gh || !sess || !sess.geo || !sess.geo[gh.id]) return;
  const geo = sess.geo[gh.id], t = U.t - gh.t0;
  const slots = safe(() => basketSlots(L, (sess.basket || []).length || 3), []);
  const to = slots[gh.slot] || slots[0];
  if (!to) return;
  // basket pulse
  // polish (band): pulse the drawn basket (slot extents), not the whole basket rect, which is full-width in the band
  const s0 = slots[0], s1 = slots[slots.length - 1], sr = s0.r || 12, pul = 0.5 + 0.5 * Math.sin(U.t * 8);
  const b = { x: s0.x - sr * 1.85, y: s0.y - sr * 1.55, w: s1.x - s0.x + sr * 3.7, h: sr * 3.35 };
  g.save(); rr(g, b.x, b.y, b.w, b.h, sr * 1.1); g.lineWidth = Math.max(2, 4 * L.u); g.strokeStyle = `rgba(255,178,63,${0.45 + 0.5 * pul})`; g.stroke(); g.restore();
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
  // DECISION (fix 1, phone m6): the gift flies on a quadratic curve whose last leg comes in from OUTSIDE the booster
  //   cluster (away from its centre, biased upward; from the board side in the column layout), so it never
  //   crosses another booster button on the way in.
  const cl = keys.map(k => rs[k]).filter(Boolean);
  const ccx = cl.reduce((a, r) => a + r.x + r.w / 2, 0) / Math.max(1, cl.length);
  const ccy = cl.reduce((a, r) => a + r.y + r.h / 2, 0) / Math.max(1, cl.length);
  for (const f of U.fly) {
    const r = rs[f.k], t = (U.t - f.t0) / f.dur;
    if (!r || t < 0 || t > 1.3) continue;
    const to = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, p = e3(Math.min(1, t));
    let dx, dy;
    if (L.boostDir === 'col') { dx = -1; dy = 0; } else { dx = Math.abs(to.x - ccx) < 2 ? 0 : Math.sign(to.x - ccx) * 0.6; dy = -1; }
    const dl = Math.hypot(dx, dy) || 1, K = Math.max(r.w, 40 * L.u) * 2.2;
    const c = { x: clamp(to.x + dx / dl * K, 0, S.W), y: clamp(to.y + dy / dl * K, 0, S.H) };
    const x = (1 - p) * (1 - p) * from.x + 2 * (1 - p) * p * c.x + p * p * to.x;
    const y = (1 - p) * (1 - p) * from.y + 2 * (1 - p) * p * c.y + p * p * to.y;
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
  const d = U.du, W = S.W, H = S.H - dlgInset(S);
  const pw = Math.min(W - 24 * d, 360 * d), px = (W - pw) / 2, pad = 20 * d, iw = pw - 2 * pad;
  const set = safe(() => M.settings(), { music: 0.7, sfx: 0.9, haptics: true });
  const list = [
    { h: 46, fn: (y, hh, e) => txt(g, 'Paused', W / 2, y + hh / 2, 32 * e, { maxW: iw }) },
    { h: 8 },
    { h: 58, fn: (y, hh, e) => pill(g, { id: 'p-resume', label: 'Resume', kind: 'primary', x: px + pad, y, w: iw, h: 54 * e, act: () => api.resume(), d: e }) },
    { h: 56, fn: (y, hh, e) => {
      const bw = (iw - 10 * e) / 2;
      const arm = armed('p-restart');
      pill(g, { id: 'p-restart', label: arm ? 'Tap again' : 'Restart', kind: arm ? 'primary' : 'secondary', x: px + pad, y, w: bw, h: 48 * e, act: () => askRestart(S, 'p-restart'), d: e });
      pill(g, { id: 'p-map', label: 'Map', kind: 'secondary', x: px + pad + bw + 10 * e, y, w: bw, h: 48 * e, act: () => api.go('map'), d: e });
    } },
    { h: 52, fn: (y, hh, e) => pill(g, { id: 'p-how', label: 'How to play', icon: 'hint', kind: 'cream', x: px + pad, y, w: iw, h: 46 * e, act: () => openHow(), d: e }) },
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
// polish (grandparent): restarting mid-level throws away progress, so the first tap only arms it ("Tap again to
//   restart", 3 s); with no pulls made yet it restarts straight away.
function hasProgress(S) { const s = S && S.sess; return !!(s && !s.result && !s.stuck && ((s.hist && s.hist.length) || (s.st && s.st.moves > 0))); }
function askRestart(S, from) {
  if (!hasProgress(S) || (U.rArm && U.t < U.rArm.until && U.rArm.from === from)) { U.rArm = null; api.retry(); return; }
  U.rArm = { from, until: U.t + 3 };
  U.shakes[from] = U.t;
  if (from === 'hud-retry') forceSay('Tap again to restart', 3, 2.6);
}
const armed = from => !!(U.rArm && U.rArm.from === from && U.t < U.rArm.until);
function setSet(k, v) { safe(() => M.setSetting(k, v)); bus.emit('settings', { k, v }); }

// ---------- generic dialog frame ----------
function dialogFrame(g, S, maxW, list, opt = {}) {
  const d = U.du, W = S.W, H = S.H - dlgInset(S);
  // fix2 (critic panel r1: modals ≤ ~900 css px on desktop/TV; they already scale with U.du, ≥ 16 px body at d ≥ 1.33)
  const pw = Math.min(W - 20 * d, maxW * d, Math.max(900, maxW)), px = (W - pw) / 2, pad = 18 * d;
  const lay = rows(list(pw - 2 * pad, px + pad), d, H - 20 * d - 2 * pad);
  const ph = opt.full ? H - 20 * d : lay.h + 2 * pad * lay.k, py = (H - ph) / 2;
  panel(g, px, py, pw, ph, d);
  if (U.reg) U.dlg = { x: px, y: py, w: pw, h: ph };
  lay.run(py + pad * lay.k + (opt.full ? (ph - lay.h - 2 * pad * lay.k) / 2 : 0));
  return { px, py, pw, ph, k: lay.k };
}

// ---------- settings ----------
function drawSettings(g, S) {
  const set = safe(() => M.settings(), { music: 0.7, sfx: 0.9, haptics: true });
  const W = S.W, close = () => { U.resetAsk = null; api.go(U.ret); };
  // fix 5: Reset sits in its own group under CLOSE (a dashed rule and a ≥ 24 px gap between them) and opens a
  //   confirm card (Keep / Erase) instead of the old two-taps-in-3-s arm, which a double-tap on CLOSE could hit.
  const wasReg = U.reg;
  if (U.resetAsk) U.reg = false;
  const fr = dialogFrame(g, S, 380, (iw, x0) => {
    const l = [
      { h: 46, fn: (y, hh, e) => txt(g, 'Settings', W / 2, y + hh / 2, 30 * e, { maxW: iw }) },
      { h: 6 },
      { h: 46, fn: (y, hh, e) => slider(g, { k: 'music', label: 'Music', x: x0, y, w: iw, h: hh, v: set.music, d: e }) },
      { h: 46, fn: (y, hh, e) => slider(g, { k: 'sfx', label: 'Sounds', x: x0, y, w: iw, h: hh, v: set.sfx, d: e }) },
    ];
    if (hasVibrate()) l.push({ h: 46, fn: (y, hh, e) => toggle(g, { id: 's-haptics', label: 'Haptics', x: x0, y, w: iw, h: hh, on: set.haptics, d: e, act: () => setSet('haptics', !set.haptics) }) });
    l.push({ h: 10 });
    l.push({ h: 56, fn: (y, hh, e) => { const bw = Math.min(iw, 240 * e); pill(g, { id: 's-close', label: 'CLOSE', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, act: close, d: e }); } });
    l.push({ h: 30, fn: (y, hh, e) => {
      g.save(); g.setLineDash([5 * e, 5 * e]); g.lineWidth = Math.max(1, 1.5 * e); g.strokeStyle = 'rgba(43,36,64,0.3)';
      g.beginPath(); g.moveTo(x0 + iw * 0.12, y + hh / 2); g.lineTo(x0 + iw * 0.88, y + hh / 2); g.stroke(); g.restore();
    } });
    l.push({ h: 48, fn: (y, hh, e) => {
      const bw = Math.min(iw, 230 * e);
      pill(g, { id: 's-reset', label: 'Reset progress', kind: 'cream', x: W / 2 - bw / 2, y, w: bw, h: 42 * e, d: e, act: () => { U.resetAsk = { t0: U.t }; } });
    } });
    l.push({ h: 28, fn: (y, hh, e) => txt(g, 'Fonts: Lilita One, Nunito (SIL OFL)', W / 2, y + hh / 2, Math.max(12, 12 * e), { f: FB, w: '700', col: '#6E6377', maxW: iw }) });
    return l;
  });
  U.reg = wasReg;
  if (U.resetAsk) drawResetAsk(g, S);
  return fr;
}
function drawResetAsk(g, S) {
  dim(g, S, 0.45);
  const d = U.du, W = S.W, H = S.H - dlgInset(S), c = U.resetAsk;
  const pw = Math.min(W - 32 * d, 340 * d), pad = 18 * d, iw = pw - 2 * pad;
  const body = wrapMin(g, 'This erases all your stars, yarn, outfits and kittens.', iw, Math.max(17, 17 * Math.min(d, 1.2)), 16, 3, FB, '800');
  const bodyH = body.lines.length * body.size * 1.14;
  const btnH = 50 * d, ph = pad + 40 * d + 8 * d + bodyH + 18 * d + btnH + pad, px = (W - pw) / 2, py = (H - ph) / 2;
  const t = U.t - c.t0, sc = t < 0.22 ? 0.88 + 0.12 * eBack(t / 0.22) : 1;
  g.save(); g.translate(W / 2, py + ph / 2); g.scale(sc, sc); g.translate(-W / 2, -(py + ph / 2));
  panel(g, px, py, pw, ph, d);
  txt(g, 'Erase progress?', W / 2, py + pad + 20 * d, 26 * d, { maxW: iw });
  lines(g, body, W / 2, py + pad + 48 * d + bodyH / 2, { col: INK });
  const by = py + ph - pad - btnH, bw = (iw - 12 * d) / 2;
  pill(g, { id: 'r-keep', label: 'Keep', kind: 'secondary', x: px + pad, y: by, w: bw, h: btnH, d, act: () => { U.resetAsk = null; } });
  pill(g, { id: 'r-erase', label: 'Erase', kind: 'primary', x: px + pad + bw + 12 * d, y: by, w: bw, h: btnH, d, act: () => {
    U.resetAsk = null; safe(() => M.resetAll()); toast('Progress erased');
  } });
  // Enter / Space picks the safe choice
  const kb = findBtn('r-keep'), eb = findBtn('r-erase');
  if (kb) kb.primary = true;
  if (eb) eb.primary = false;
  g.restore();
}

// ---------- how to play (fix r2) ----------
// DECISION (critic panel r1, grandparent 4): the site's "how to play" chip used to scroll away to the SEO sheet and
//   leave the game. It now opens this in-game card (game.js intercepts the chip's click), as does Pause. Three small
//   painted pictures, one plain line each at ≥ 16 px. It draws over the title / pause screen and owns the input while
//   open (the screen under it registers no buttons).
/** QA / test drivers: the buttons drawn last frame (id, rect, label). */
export const qaBtns = () => U.btns.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.label, disabled: !!b.disabled }));
export function openHow() { if (U.S && (U.S.screen === 'title' || U.S.screen === 'pause')) U.how = { t0: U.t }; }
const HOW = [
  ['pull', 'Tap the top strand. It winds onto its spool.'],
  ['wait', 'Other colours wait in the basket.'],
  ['stars', 'Keep the basket nearly empty for 3 stars.'],
];
function howPic(g, k, x, y, w, h, e) {
  g.save();
  rr(g, x, y, w, h, 12 * e); g.fillStyle = '#F6E3C6'; g.fill(); g.lineWidth = Math.max(1, 2 * e); g.strokeStyle = STITCH; g.stroke();
  rr(g, x, y, w, h, 12 * e); g.clip();
  const tray = (cx, cy, n, balls) => {
    const sr = Math.min(h * 0.16, w / (n * 2.6)), tw2 = n * sr * 2.5;
    rr(g, cx - tw2 / 2, cy - sr * 1.35, tw2, sr * 2.7, sr * 1.35); g.fillStyle = '#B98A5E'; g.fill(); g.lineWidth = Math.max(1, 2 * e); g.strokeStyle = INK; g.stroke();
    for (let i = 0; i < n; i++) {
      const bx = cx - tw2 / 2 + sr * 1.25 + i * sr * 2.5;
      g.beginPath(); g.arc(bx, cy, sr, 0, 7); g.fillStyle = '#8A6242'; g.fill();
      if (balls[i] != null) safe(() => R.drawBall(g, bx, cy, sr * 0.95, balls[i]));
    }
  };
  if (k === 'pull') {
    const sw = Math.max(5, h * 0.13), u = sw / 0.27;
    safe(() => R.drawYarnRun(g, [[x + w * 0.08, y + h * 0.62], [x + w * 0.3, y + h * 0.7], [x + w * 0.62, y + h * 0.72]], 2, sw, u));
    safe(() => R.drawYarnRun(g, [[x + w * 0.12, y + h * 0.86], [x + w * 0.3, y + h * 0.66], [x + w * 0.48, y + h * 0.44]], 0, sw, u, { glow: 0.6 }));
    // arrow from the strand to its spool
    g.strokeStyle = INK; g.lineWidth = Math.max(1.5, 2.4 * e); g.lineCap = 'round';
    const ax0 = x + w * 0.52, ay0 = y + h * 0.36, ax1 = x + w * 0.68, ay1 = y + h * 0.3;
    g.beginPath(); g.moveTo(ax0, ay0); g.lineTo(ax1, ay1); g.stroke();
    g.beginPath(); g.moveTo(ax1 - 7 * e, ay1 - 4 * e); g.lineTo(ax1, ay1); g.lineTo(ax1 - 5 * e, ay1 + 6 * e); g.stroke();
    safe(() => R.drawSpool(g, x + w * 0.82, y + h * 0.42, h * 0.62, 0, 1, 3, { w: h * 0.46 }));
    safe(() => R.drawHand(g, x + w * 0.3, y + h * 0.7, h * 0.42, true));
  } else if (k === 'wait') {
    safe(() => R.drawSpool(g, x + w * 0.22, y + h * 0.3, h * 0.42, 1, 1, 3, { w: h * 0.32 }));
    safe(() => R.drawSpool(g, x + w * 0.5, y + h * 0.3, h * 0.42, 3, 1, 3, { w: h * 0.32 }));
    tray(x + w / 2, y + h * 0.74, 3, [2, 4, null]);
  } else {
    for (let i = 0; i < 3; i++) safe(() => R.drawStar(g, x + w * (0.28 + i * 0.22), y + h * (i === 1 ? 0.26 : 0.32), h * 0.16, true));
    tray(x + w / 2, y + h * 0.74, 3, [null, null, null]);
  }
  g.restore();
}
function drawHow(g, S) {
  if (S.screen !== 'title' && S.screen !== 'pause') { U.how = null; return; }
  U.btns = []; U.sliders = []; U.reg = true; // the card owns the input: nothing under it can be hit
  dim(g, S, 0.5);
  const c = U.how, d = U.du, W = S.W, H = S.H - dlgInset(S);
  const t = U.t - c.t0, sc = t < 0.22 ? 0.88 + 0.12 * eBack(t / 0.22) : 1;
  g.save(); g.translate(W / 2, H / 2); g.scale(sc, sc); g.translate(-W / 2, -H / 2);
  dialogFrame(g, S, 380, (iw, x0) => {
    const picW = Math.min(112 * d, iw * 0.36), picH = picW * 0.72, gap = 12 * d, tW = iw - picW - gap;
    const sz = Math.max(16, 17 * Math.min(d, 1.25));
    const l = [{ h: 46, fn: (y, hh, e) => txt(g, 'How to play', W / 2, y + hh / 2, 30 * e, { maxW: iw }) }];
    HOW.forEach(([k, s]) => {
      const wf = wrapMin(g, s, tW, sz, 16, 3, FB, '800');
      const rh = Math.max(picH, wf.lines.length * wf.size * 1.14) + 10 * d;
      l.push({ h: rh / d, fn: (y, hh, e) => {
        const k2 = e / d, pw = picW * k2, ph = picH * k2;
        howPic(g, k, x0, y + (hh - ph) / 2, pw, ph, e);
        const tx = x0 + pw + gap * k2;
        const lh = wf.size * 1.14, y0 = y + hh / 2 - (wf.lines.length - 1) * lh / 2;
        wf.lines.forEach((ln, i) => txt(g, ln, tx, y0 + i * lh, wf.size, { f: FB, w: '800', col: INK, align: 'left' }));
      } });
    });
    l.push({ h: 10 });
    l.push({ h: 56, fn: (y, hh, e) => { const bw = Math.min(iw, 220 * e); pill(g, { id: 'how-ok', label: 'GOT IT', kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, d: e, act: () => { U.how = null; } }); } });
    return l;
  });
  g.restore();
}

// ---------- shop ----------
// DECISION (polish round 3, critics: "toast overlaps the yarn counter and the Shop header", "no confirmation",
//   "can't see the outfit I bought"): every spend opens a confirm card INSIDE the shop panel (big preview, price,
//   balance after, Cancel / Buy); a successful buy turns the same card into a "worn!" showcase of the kitty in the
//   outfit. Short feedback ("Need 30 more yarn balls") is written into the footer itself, so nothing ever floats
//   over the header, the counter or the cards. While the card is up the shop under it registers no buttons.
function shopMsg(text) { U.shop.msg = { text, t0: U.t }; }
const shopMsgOn = () => U.shop.msg && U.t - U.shop.msg.t0 < 1.8 ? U.shop.msg.text : '';
function shopAsk(kind, id) { U.shop.confirm = { kind, id, t0: U.t, done: 0 }; bus.emit('click', {}); }
function shopBuy() {
  const c = U.shop.confirm;
  if (!c || c.done) return;
  const bal = safe(() => M.balance(), 0);
  if (c.kind === 'outfit') {
    const o = safe(() => M.outfits(), []).find(q => q.id === c.id);
    if (!o) { U.shop.confirm = null; return; }
    if (bal < o.price) { U.shop.confirm = null; U.shakes['shop-main'] = U.t; shopMsg(`Need ${o.price - bal} more`); return; }
    if (safe(() => M.buyOutfit(o.id), false)) { bus.emit('buy', { item: o.id }); c.done = U.t; sfx('gift'); }
    else U.shop.confirm = null;
  } else if (c.kind === 'shield') {
    const price = M.SHIELD_PRICE || 150;
    if (bal < price) { U.shop.confirm = null; U.shakes['l-shield'] = U.t; shopMsg('Not enough yarn balls'); return; }
    if (safe(() => M.buyShield(), false)) { bus.emit('buy', { item: 'shield' }); c.done = U.t; }
    else { U.shop.confirm = null; shopMsg("Can't hold more shields"); }
  } else {
    const k = c.id, price = BOOSTERS[k].price;
    if (bal < price) { U.shop.confirm = null; U.shakes['l-' + k] = U.t; shopMsg('Not enough yarn balls'); return; }
    if (safe(() => M.buyBooster(k), false)) { bus.emit('buy', { item: k }); c.done = U.t; }
    else { U.shop.confirm = null; shopMsg(`Can't buy ${BNAME[k]} right now`); }
  }
}
const BSHORT = { undo: 'Takes back your last pull', hint: 'Shows a good next move', slot: 'One more basket space', snip: 'Pull a covered strand' };
function drawShop(g, S) {
  const d = U.du, W = S.W, H = S.H - dlgInset(S);
  const pw = Math.min(W - 16 * d, 560 * d), ph = Math.min(H - 16 * d, 760 * d), px = (W - pw) / 2, py = (H - ph) / 2;
  const wasReg = U.reg;
  if (U.shop.confirm) U.reg = false;
  panel(g, px, py, pw, ph, d);
  U.dlg = { x: px, y: py, w: pw, h: ph };
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
    reg({ id: 'tab-' + tab, label, x, y: ty, w: tw2, h: th, act: () => { U.shop.tab = tab; U.shop.msg = null; } });
    rr(g, x, ty, tw2, th, th / 2); g.fillStyle = on ? TEAL : '#F6E6CF'; g.fill(); g.lineWidth = 2.5 * d; g.strokeStyle = INK; g.stroke();
    txt(g, label, x + tw2 / 2, ty + th / 2 + d, 18 * d, { col: on ? '#fff' : INK, stroke: on ? INK : null, sk: 0.2, maxW: tw2 - 16 * d });
  }
  const by = ty + th + 12 * d, bh = py + ph - pad - 58 * d - by;
  const footY = py + ph - pad - 54 * d, fw = Math.min(iw, 280 * d);
  U.dlg.toastY = footY - 6 * d; U.dlg.toastMin = ty + th + 4 * d;
  const msg = shopMsgOn();
  if (U.shop.tab === 'outfits') {
    const list = safe(() => M.outfits(), []);
    const cols = clamp(Math.floor(iw / (150 * d)), 2, 4), rowsN = Math.ceil(list.length / cols);
    const gap = 8 * d, cw = (iw - gap * (cols - 1)) / cols, ch = Math.min((bh - gap * (rowsN - 1)) / rowsN, cw * 1.3);
    const y0 = by + (bh - (ch * rowsN + gap * (rowsN - 1))) / 2;
    list.forEach((o, i) => {
      const c = i % cols, r = Math.floor(i / cols), x = ix + c * (cw + gap), y = y0 + r * (ch + gap);
      const sel = U.shop.sel === o.id;
      reg({ id: 'o-' + o.id, label: o.name, x, y, w: cw, h: ch, act: () => { U.shop.sel = o.id; U.shop.msg = null; } });
      rr(g, x, y, cw, ch, 12 * d); g.fillStyle = o.worn ? '#E3F5EF' : sel ? '#FFF9EC' : '#F6E6CF'; g.fill();
      g.lineWidth = sel ? 4 * d : 2 * d; g.strokeStyle = sel ? GOLD_D : o.worn ? TEAL_D : INK; g.stroke();
      // fix 1 (BLOCKER): the head layers reach ~1.36 kitty-heights above the feet (witch hat brim at -84 units plus
      //   the 50-unit cone, crown and helmet star at about -120), so a preview sized to 0.52 card heights put the hat
      //   through the card's top border and over the card above. Every preview now reserves that headroom (same
      //   size and baseline for all outfits, so they compare fairly) and is clipped to its own card.
      const ks = Math.min(ch * 0.62 / 1.36, cw * 0.56), feetY = y + 4 * d + ks * 1.36, rem = y + ch - feetY;
      g.save(); rr(g, x + 1, y + 1, cw - 2, ch - 2, 11 * d); g.clip();
      // polish: always the idle pose — the raised 'cheer' paws hid the scarf/outfit being shown
      aKitty(g, x + cw / 2, feetY, ks, 'idle', U.t, o.id);
      g.restore();
      const nameY = feetY + rem * 0.3, tagY = feetY + rem * 0.74;
      const ts = Math.max(12, Math.min(14 * d, rem * 0.34));
      txt(g, o.name, x + cw / 2, nameY, ts, { f: FB, w: '800', maxW: cw - 10 * d });
      if (o.worn) txt(g, 'WEARING', x + cw / 2, tagY, ts, { col: TEAL_D, maxW: cw - 10 * d });
      else if (o.owned) txt(g, 'OWNED', x + cw / 2, tagY, ts, { col: INK, maxW: cw - 10 * d });
      else { const pw2 = tw(g, String(o.price), ts) + ts * 1.4; aIcon(g, 'ball', x + cw / 2 - pw2 / 2 + ts * 0.5, tagY, ts * 1.1); txt(g, String(o.price), x + cw / 2 + ts * 0.7, tagY, ts, { maxW: cw - ts * 3 }); }
    });
    const o = list.find(q => q.id === U.shop.sel) || list[0];
    if (o) {
      const label = msg || (o.worn ? 'WEARING' : o.owned ? 'WEAR' : `BUY ${o.price}`);
      // a worn outfit's footer is a calm teal "WEARING" (it used to be a washed-out disabled pink pill)
      pill(g, { id: 'shop-main', label, kind: o.worn && !msg ? 'secondary' : 'primary', x: px + pw / 2 - fw / 2, y: footY, w: fw, h: 52 * d, act: () => {
        if (o.worn) return;
        if (o.owned) { safe(() => M.wear(o.id)); bus.emit('buy', { item: o.id }); shopMsg(`Wearing ${o.name}!`); return; }
        const b0 = safe(() => M.balance(), 0);
        if (b0 < o.price) { U.shakes['shop-main'] = U.t; shopMsg(`Need ${o.price - b0} more`); return; }
        shopAsk('outfit', o.id);
      } });
      if (o.worn) { const b2 = findBtn('shop-main'); if (b2) b2.primary = false; }
    }
  } else {
    // fix 1: rows start right under the tabs (they were centred in the body, which left a ~90 px dead band under
    //   the tabs on tall phones). Each row is a top band (icon, name, Buy) and the plain-words description at
    //   ≥ 16 css px across the full row width below it, so it reads in 2 lines instead of 4 squeezed beside Buy.
    // meta r3: a compact Streak Shield strip sits under the four booster rows (150 yarn, hold max 2)
    const shH = Math.min(62 * d, Math.max(50, bh * 0.14));
    const gap = 8 * d, rh = Math.min((bh - gap * 4 - shH) / 4, 124 * d), top = Math.min(48 * d, rh * 0.45);
    const y0 = by;
    BK.forEach((k, i) => {
      const y = y0 + i * (rh + gap), unl = safe(() => M.boosterUnlocked(k), false), n = safe(() => M.booster(k), 0);
      g.save(); if (!unl) g.globalAlpha = 0.55;
      rr(g, ix, y, iw, rh, 12 * d); g.fillStyle = '#F6E6CF'; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = INK; g.stroke();
      const ir = Math.min(top * 0.42, 20 * d), cyT = y + 6 * d + top / 2;
      g.beginPath(); g.arc(ix + 10 * d + ir, cyT, ir, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 2.5 * d; g.stroke();
      aIcon(g, unl ? k : 'lock', ix + 10 * d + ir, cyT, ir * 1.05);
      const bw = Math.min(110 * d, iw * 0.3), tx = ix + 18 * d + 2 * ir, tW = iw - (tx - ix) - bw - 18 * d;
      txt(g, `${BNAME[k]}${unl ? '  ×' + n : ''}`, tx, cyT + d, Math.max(14, Math.min(19 * d, top * 0.42)), { align: 'left', maxW: tW });
      const dTop = y + 6 * d + top + 2 * d, dH = y + rh - 6 * d - dTop, ds = Math.max(16, 16 * Math.min(d, 1.25));
      if (dH < 18) { // meta r3: short screens (e.g. 844x390) — one band per row: name over a short line, Buy at the right
        const ir2 = Math.min(rh * 0.36, 20 * d), cy2 = y + rh / 2, bw2 = Math.min(110 * d, iw * 0.3), tx2 = ix + 18 * d + 2 * ir2, tW2 = iw - (tx2 - ix) - bw2 - 18 * d;
        g.restore(); g.save(); if (!unl) g.globalAlpha = 0.55;
        rr(g, ix, y, iw, rh, 12 * d); g.fillStyle = '#F6E6CF'; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = INK; g.stroke();
        g.beginPath(); g.arc(ix + 10 * d + ir2, cy2, ir2, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 2.5 * d; g.stroke();
        aIcon(g, unl ? k : 'lock', ix + 10 * d + ir2, cy2, ir2 * 1.05);
        const ns = Math.max(14, Math.min(18 * d, rh * 0.3)), ds2 = Math.max(12, Math.min(13.5 * d, rh * 0.24));
        txt(g, `${BNAME[k]}${unl ? '  ×' + n : ''}`, tx2, cy2 - ns * 0.5, ns, { align: 'left', maxW: tW2 });
        txt(g, unl ? BSHORT[k] : `Unlocks at level ${BOOSTERS[k].unlock}`, tx2, cy2 + ds2 * 0.85, ds2, { f: FB, w: '800', align: 'left', col: '#4A4056', maxW: tW2 });
        g.restore();
        if (unl) pill(g, { id: 'l-' + k, label: 'Buy', kind: 'secondary', x: ix + iw - 10 * d - bw2, y: cy2 - Math.min(42 * d, rh - 10 * d) / 2, w: bw2, h: Math.min(42 * d, rh - 10 * d), d,
          badge: { price: BOOSTERS[k].price }, act: () => {
            U.shop.bsel = k;
            if (safe(() => M.balance(), 0) < BOOSTERS[k].price) { U.shakes['l-' + k] = U.t; shopMsg('Not enough yarn balls'); return; }
            shopAsk('booster', k);
          } });
        return;
      }
      const wf = wrapMin(g, unl ? BDESC[k] : `Unlocks at level ${BOOSTERS[k].unlock}`, iw - 26 * d, ds, 16, Math.max(1, Math.floor(dH / (16 * 1.14))), FB, '700');
      const lh = wf.size * 1.14;
      wf.lines.forEach((l2, j) => txt(g, l2, ix + 13 * d, dTop + dH / 2 + (j - (wf.lines.length - 1) / 2) * lh, wf.size, { f: FB, w: '700', align: 'left', col: '#4A4056' }));
      g.restore();
      if (unl) {
        const bh2 = Math.min(42 * d, top * 0.92);
        // fix 1: every Buy is the same teal (the last-tapped one used to turn tomato red, so Undo's looked different)
        pill(g, { id: 'l-' + k, label: 'Buy', kind: 'secondary', x: ix + iw - 10 * d - bw, y: cyT - bh2 / 2, w: bw, h: bh2, d,
          badge: { price: BOOSTERS[k].price }, act: () => {
            U.shop.bsel = k;
            if (safe(() => M.balance(), 0) < BOOSTERS[k].price) { U.shakes['l-' + k] = U.t; shopMsg('Not enough yarn balls'); return; }
            shopAsk('booster', k);
          } });
      }
    });
    { // Streak Shield strip
      const y = y0 + 4 * (rh + gap), dl = safe(() => M.daily(), { unlocked: false }), unl = !!dl.unlocked, n = safe(() => M.shields(), 0);
      const max = M.SHIELD_MAX || 2, price = M.SHIELD_PRICE || 150, full = n >= max;
      g.save(); if (!unl) g.globalAlpha = 0.55;
      rr(g, ix, y, iw, shH, 12 * d); g.fillStyle = '#E3F5EF'; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = TEAL_D; g.stroke();
      const ir = Math.min(shH * 0.36, 20 * d), cyT = y + shH / 2;
      g.beginPath(); g.arc(ix + 10 * d + ir, cyT, ir, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 2.5 * d; g.strokeStyle = INK; g.stroke();
      if (unl) shieldIcon(g, ix + 10 * d + ir, cyT, ir * 1.35); else aIcon(g, 'lock', ix + 10 * d + ir, cyT, ir * 1.05);
      const bw = Math.min(110 * d, iw * 0.3), tx = ix + 18 * d + 2 * ir, tW = iw - (tx - ix) - bw - 18 * d;
      const ns = Math.max(14, Math.min(18 * d, shH * 0.3)), ds2 = Math.max(12, Math.min(13.5 * d, shH * 0.24));
      txt(g, `Streak Shield${unl ? `  ${n}/${max}` : ''}`, tx, cyT - ns * 0.5, ns, { align: 'left', maxW: tW });
      txt(g, unl ? 'Saves your daily streak on a missed day' : 'Unlocks with the Daily Knot', tx, cyT + ds2 * 0.85, ds2, { f: FB, w: '800', align: 'left', col: '#4A4056', maxW: tW });
      g.restore();
      if (unl) {
        const bh2 = Math.min(42 * d, shH - 10 * d);
        pill(g, { id: 'l-shield', label: full ? 'Full' : 'Buy', kind: full ? 'cream' : 'secondary', x: ix + iw - 10 * d - bw, y: cyT - bh2 / 2, w: bw, h: bh2, d,
          badge: full ? null : { price }, disabled: full, act: () => {
            if (full) { shopMsg(`You can hold ${max} shields`); return; }
            if (safe(() => M.balance(), 0) < price) { U.shakes['l-shield'] = U.t; shopMsg('Not enough yarn balls'); return; }
            shopAsk('shield', 'shield');
          } });
      }
    }
    txt(g, msg || 'Boosters help in any level', px + pw / 2, footY + 26 * d, Math.max(16, 16 * d), { f: FB, w: '800', col: msg ? TOMATO_D : '#5A5066', maxW: iw });
  }
  U.reg = wasReg;
  if (U.shop.confirm) drawShopConfirm(g, S, px, py, pw, ph, d);
}
function drawShopConfirm(g, S, px, py, pw, ph, d) {
  const c = U.shop.confirm, done = !!c.done;
  const o = c.kind === 'outfit' ? safe(() => M.outfits(), []).find(q => q.id === c.id) : null;
  if (c.kind === 'outfit' && !o) { U.shop.confirm = null; return; }
  const sh = c.kind === 'shield', name = o ? o.name : sh ? 'Streak Shield' : BNAME[c.id], price = o ? o.price : sh ? (M.SHIELD_PRICE || 150) : BOOSTERS[c.id].price;
  const bal = safe(() => M.balance(), 0);
  // veil over the shop panel only (the header chip under it stays readable through it)
  rr(g, px, py, pw, ph, 18 * d); g.fillStyle = 'rgba(43,36,64,0.45)'; g.fill();
  const cw = Math.min(pw - 24 * d, 380 * d), chh = Math.min(ph - 24 * d, 470 * d), cx = px + pw / 2 - cw / 2, cy = py + ph / 2 - chh / 2;
  const t = U.t - (done ? c.done : c.t0), sc = t < 0.22 ? eBack(t / 0.22) * 0.12 + 0.88 : 1;
  g.save(); g.translate(px + pw / 2, py + ph / 2); g.scale(sc, sc); g.translate(-(px + pw / 2), -(py + ph / 2));
  panel(g, cx, cy, cw, chh, d);
  const pad = 18 * d, iw = cw - 2 * pad, mx = cx + cw / 2;
  const btnH = 52 * d, btnY = cy + chh - pad - btnH;
  const title = done ? (o ? `${name}: worn!` : `+1 ${name}!`) : `Buy ${name}?`;
  txt(g, title, mx, cy + pad + 18 * d, 26 * d, { maxW: iw });
  // preview: the kitty WEARING it, big, idle pose (paws down so a scarf/collar shows); a booster shows its icon
  const pTop = cy + pad + 44 * d, pBot = btnY - (done ? 40 : 64) * d, pH = Math.max(40 * d, pBot - pTop);
  g.save();
  const gl = g.createRadialGradient(mx, pTop + pH * 0.55, 0, mx, pTop + pH * 0.55, pH * 0.6);
  gl.addColorStop(0, done ? 'rgba(255,201,60,0.55)' : 'rgba(255,201,60,0.25)'); gl.addColorStop(1, 'rgba(255,201,60,0)');
  g.fillStyle = gl; g.fillRect(cx, pTop, cw, pH);
  g.restore();
  if (o) {
    const ks = Math.min(pH * 0.86, iw * 0.62), hop = done ? Math.abs(Math.sin(t * 5)) * ks * 0.05 * Math.max(0, 1 - t / 1.4) : 0;
    aKitty(g, mx, pTop + pH * 0.5 + ks * 0.46 - hop, ks, 'idle', U.t, o.id);
  } else {
    const r = Math.min(pH * 0.36, 56 * d);
    g.beginPath(); g.arc(mx, pTop + pH / 2, r, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = 3 * d; g.strokeStyle = INK; g.stroke();
    rIcon(g, c.id, mx, pTop + pH / 2, r * 1.1);
  }
  if (done && t < 1.2) { // a little burst of sparkles round the preview
    for (let i = 0; i < 8; i++) {
      const an = i / 8 * TAU2 + 0.3, q = e3(Math.min(1, t / 0.7)), rr2 = pH * (0.25 + 0.3 * q);
      g.save(); g.globalAlpha = Math.max(0, 1 - t / 1.2);
      aStar(g, mx + Math.cos(an) * rr2 * 1.2, pTop + pH * 0.5 + Math.sin(an) * rr2, 7 * d, true, 0); g.restore();
    }
  }
  if (!done) {
    const ly = btnY - 40 * d, s1 = 17 * d, lbl = `${price}`, after = `You have ${bal}  ·  ${bal - price} after`;
    const w1 = tw(g, lbl, s1 * 1.2) + s1 * 1.6;
    aIcon(g, 'ball', mx - w1 / 2 + s1 * 0.6, ly - 6 * d, s1 * 1.2);
    txt(g, lbl, mx + s1 * 0.75, ly - 6 * d, s1 * 1.2, { maxW: iw });
    txt(g, after, mx, ly + 18 * d, 14 * d, { f: FB, w: '800', col: '#5A5066', maxW: iw });
    const bw = (iw - 10 * d) / 2;
    pill(g, { id: 'sc-cancel', label: 'Cancel', kind: 'cream', x: cx + pad, y: btnY, w: bw, h: btnH, d, act: () => { U.shop.confirm = null; } });
    pill(g, { id: 'sc-buy', label: 'Buy', kind: 'primary', x: cx + pad + bw + 10 * d, y: btnY, w: bw, h: btnH, d, act: shopBuy });
  } else {
    const n = o ? 0 : sh ? safe(() => M.shields(), 0) : safe(() => M.booster(c.id), 0);
    txt(g, o ? 'Your kitty is wearing it now' : `You have ${n} now`, mx, btnY - 20 * d, 15 * d, { f: FB, w: '800', col: TEAL_D, maxW: iw });
    const bw = Math.min(iw, 220 * d);
    pill(g, { id: 'sc-ok', label: 'Nice!', kind: 'primary', x: mx - bw / 2, y: btnY, w: bw, h: btnH, d, act: () => { U.shop.confirm = null; } });
  }
  g.restore();
}

// ---------- kitten corner ----------
function silhouette(breed, coat, s, dpr) {
  // polish round 3: keyed on whether the illustrated sprite is decoded, so a silhouette cached while art was loading
  //   is redrawn from the sprite once it arrives (bosses at portrait scale, never the 1.4× board scale)
  const id = coat * 6 + breed + 1, spr = R.kittenSprite && R.kittenSprite(id, true) ? 1 : 0;
  const key = breed + '|' + coat + '|' + Math.round(s * dpr) + '|' + spr;
  let c = U.sil.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  const n = Math.ceil(s * 1.5 * dpr);
  c.width = c.height = Math.max(2, n);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  aKitten(x, s * 0.75, s * 1.38, s, { id, stage: 4, loops: 0, flinch: 0, freeT: -1, breed, coat, golden: false, bossScale: false, t: 0, loopColors: [] });
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#8F8580'; x.fillRect(0, 0, c.width, c.height);
  if (U.sil.size > 80) U.sil.clear();
  U.sil.set(key, c);
  return c;
}
/** Small gold crown (boss portraits), centred at (x, y), w wide. */
function crown(g, x, y, w) {
  const h = w * 0.62;
  g.beginPath(); g.moveTo(x - w / 2, y + h / 2); g.lineTo(x - w / 2, y - h * 0.2); g.lineTo(x - w / 4, y + h * 0.08); g.lineTo(x, y - h / 2);
  g.lineTo(x + w / 4, y + h * 0.08); g.lineTo(x + w / 2, y - h * 0.2); g.lineTo(x + w / 2, y + h / 2); g.closePath();
  g.fillStyle = GOLD; g.fill(); g.lineJoin = 'round'; g.lineWidth = Math.max(1, w * 0.09); g.strokeStyle = INK; g.stroke();
}
function portrait(g, id, cx, cy, s, st, dpr) {
  // polish round 3: illustrated sprites (art.js via render.drawKitten id) with the code cat as fallback; bosses
  //   get a warm card, a thick gold frame and a crown so the six grand cats stand out in the grid
  const boss = !!BOSSES[id];
  rr(g, cx - s / 2, cy - s / 2, s, s, s * 0.2); g.fillStyle = st ? (boss ? '#FFF0CF' : '#FFF9EC') : (boss ? '#E9D3AE' : '#EADCC8'); g.fill();
  g.lineWidth = st === 2 || boss ? Math.max(2, s * 0.07) : Math.max(1, s * 0.03); g.strokeStyle = st === 2 ? GOLD : boss ? GOLD_D : INK; g.stroke();
  const ks = s * (boss ? 0.8 : 0.74);
  if (st) aKitten(g, cx, cy + s * 0.42, ks, { id, stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(id), coat: coatOf(id), golden: st === 2, bossScale: false, t: 0, loopColors: [], memKey: portrait });
  else {
    const c = silhouette(breedOf(id), coatOf(id), ks, dpr);
    if (c) g.drawImage(c, cx - ks * 0.75, cy + s * 0.42 - ks * 1.38, ks * 1.5, ks * 1.5);
    const pr = s * 0.17;
    g.beginPath(); g.arc(cx, cy + s * 0.18, pr, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = Math.max(1, s * 0.025); g.strokeStyle = INK; g.stroke();
    txt(g, '?', cx, cy + s * 0.19, pr * 1.4, { col: INK });
  }
  if (boss) crown(g, cx - s * 0.33, cy - s * 0.35, s * 0.24);
}
// DECISION (ui2 U3 + B1): Kitten Corner is a six-page album, one page per world (9 kittens + the world's boss).
//   The old 60-tile grid had no room for names (tiles were ~50 px on phones) and its tap bubble had nowhere to go on
//   the top row except over the header (blocker B1). Pages give big tiles with a name caption under each one, so the
//   bubble is gone entirely (nothing floats over the header any more); a tap still hops, purrs and floats hearts.
//   Page = the world of the newest rescue on open; ‹ › buttons, page dots, swipe and ←/→ keys turn pages.
function kitLayout(iw, gh, d) {
  const capOf = c => clamp(c * 0.2, 17, Math.max(36, 20 * d));
  let best = null;
  for (const mode of ['below', 'right']) {
    let c = 60;
    for (let k = 0; k < 3; k++) {
      const ch = capOf(c);
      c = mode === 'below' ? Math.min(iw / 3, (gh - 4 * ch) / 4.3) : Math.min(iw / 4.5, (gh - 3 * ch) / 3);
    }
    c = Math.max(10, Math.min(c, 170 * d));
    if (!best || c > best.c) best = { mode, c, ch: capOf(c) };
  }
  const { c, ch, mode } = best, bc = c * 1.3;
  const w = mode === 'below' ? 3 * c : 3 * c + 1.5 * c, h = mode === 'below' ? 3 * (c + ch) + bc + ch : 3 * (c + ch);
  return { ...best, bc, w, h };
}
function kitPageOf(ks) {
  let last = -1;
  ks.forEach((v, i) => { if (v > 0) last = i; });
  return clamp(worldOf(Math.min(LEVELS, last + 2)), 1, 6);
}
function arrowBtn(g, b, dir) {
  reg(b);
  const d = U.du, R0 = Math.min(b.w, b.h) / 2, cx = b.x + b.w / 2, cy0 = b.y + b.h / 2;
  const down = isDown(b) && !b.disabled, hv = hov(b), lip = Math.max(1.5, R0 * 0.1), cy = cy0 - lip / 2 + (down ? lip * 0.8 : 0) - (hv ? 2 : 0);
  g.save();
  if (b.disabled) g.globalAlpha *= 0.35;
  g.beginPath(); g.arc(cx, cy0 + lip / 2, R0 - lip / 2, 0, 7); g.fillStyle = SHADE; g.fill();
  g.beginPath(); g.arc(cx, cy, R0 - lip / 2, 0, 7); g.fillStyle = CREAM; g.fill();
  if (hv) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(); }
  g.lineWidth = Math.max(1.5, 2.5 * d); g.strokeStyle = INK; g.stroke();
  const k = R0 * 0.32;
  g.beginPath(); g.moveTo(cx - dir * k * 0.55, cy - k); g.lineTo(cx + dir * k * 0.6, cy); g.lineTo(cx - dir * k * 0.55, cy + k);
  g.lineWidth = Math.max(2, R0 * 0.2); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = TEAL_D; g.stroke();
  g.restore();
}
function kitTurn(dir, click) {
  const p = clamp((U.kPage || 1) + dir, 1, 6);
  if (p === U.kPage) return false;
  U.kPage = p; U.kTurn = { t0: U.t, dir }; U.kHop = null;
  if (click) bus.emit('click', {});
  return true;
}
function drawKittens(g, S) {
  const d = U.du, W = S.W, H = S.H - dlgInset(S), land = isLand(S);
  const ks = safe(() => M.kittens(), Array(LEVELS).fill(0));
  const got = ks.filter(v => v > 0).length;
  if (!U.kPage || U.t - (U.kSeen || -9) > 0.6) U.kPage = kitPageOf(ks);
  U.kSeen = U.t;
  const wd = U.kPage, base = (wd - 1) * PER_WORLD;
  // fix3 (critic r2, art 4): capped like the shop on desktop (was 900 du ≈ the full 1440 width, title and X ~1300 px apart)
  const pw = Math.min(W - 16 * d, land ? Math.min(900 * d, Math.max(1000, 640 * d)) : 520 * d), ph = H - 16 * d, px = (W - pw) / 2, py = 8 * d;
  panel(g, px, py, pw, ph, d);
  const pad = 16 * d, ix = px + pad, iw = pw - 2 * pad;
  const hy = py + pad + 20 * d;
  closeX(g, px + pw - pad - 14 * d, hy, d, () => api.go(U.ret));
  const cnt = `${got} / ${LEVELS}`, cs = 18 * d, cw = tw(g, cnt, cs) + 16 * d;
  txt(g, cnt, px + pw - pad - 42 * d - cw / 2, hy + d, cs, { col: TEAL_D });
  txt(g, 'Kitten Corner', ix, hy, 26 * d, { align: 'left', maxW: iw - 50 * d - cw });
  // pager: ‹ World n · name (rescued k/10) ›
  // fix r2 (UI-LAYOUT: "tiles tiny at 1920x1080, the panel is full width but the grid stays small"): the grid is
  //   height-bound, so on a wide panel the pager moves up onto the title row and the tiles get that height back
  const pr = Math.max(22, 21 * d), titleW = tw(g, 'Kitten Corner', 26 * d);
  const upW = iw - 2 * Math.max(titleW + 16 * d, cw + 64 * d), pagerUp = land && upW >= 300 * d;
  const pgW = pagerUp ? Math.min(460 * d, upW) : Math.min(iw, 460 * d), pgX = ix + (iw - pgW) / 2; // arrows hug the title
  const pyc = pagerUp ? hy + 4 * d : hy + 26 * d + pr;
  arrowBtn(g, { id: 'k-prev', label: 'Previous world', x: pgX, y: pyc - pr, w: 2 * pr, h: 2 * pr, disabled: wd <= 1, act: () => kitTurn(-1) }, -1);
  arrowBtn(g, { id: 'k-next', label: 'Next world', x: pgX + pgW - 2 * pr, y: pyc - pr, w: 2 * pr, h: 2 * pr, disabled: wd >= 6, act: () => kitTurn(1) }, 1);
  const wGot = ks.slice(base, base + PER_WORLD).filter(v => v > 0).length;
  const tW = pgW - 4 * pr - 16 * d;
  txt(g, (WORLDS[wd] || {}).name || `World ${wd}`, ix + iw / 2, pyc - 7 * d, 20 * d, { col: INK, maxW: tW });
  { // page dots + this world's count
    const dr = 3.6 * d, gap = 12 * d, lab = `${wGot} / ${PER_WORLD}`, ls = clamp(14 * d, 13, 40);
    const lw = tw(g, lab, ls, FB, '900'), total = 6 * gap + 8 * d + lw, x0 = ix + iw / 2 - total / 2, dy = pyc + 13 * d;
    for (let i = 1; i <= 6; i++) {
      g.beginPath(); g.arc(x0 + (i - 0.5) * gap, dy, i === wd ? dr * 1.35 : dr, 0, 7);
      g.fillStyle = i === wd ? TOMATO : STITCH; g.fill(); g.lineWidth = Math.max(1, 1.2 * d); g.strokeStyle = INK; g.stroke();
    }
    txt(g, lab, x0 + 6 * gap + 8 * d, dy + 0.5 * d, ls, { f: FB, w: '900', col: TEAL_D, align: 'left' });
  }
  const fh = 52 * d, fy = py + ph - pad - fh;
  // meta r3: this world's Kitten Set (10 kittens → set reward; all 3★ → Golden set) in a strip above the footer
  const si = safe(() => M.setInfo(wd), { got: wGot, gold3: 0, claimable: false, goldClaimable: false, claimed: false, goldClaimed: false, golden: false });
  const stH = 34 * d, stY = fy - 8 * d - stH;
  const gy = pyc + pr + 10 * d, gh = stY - 8 * d - gy;
  const K = kitLayout(iw, gh, d);
  const turn = U.kTurn && U.t - U.kTurn.t0 < 0.22 ? U.kTurn : null;
  const slide = turn ? (1 - eOut((U.t - turn.t0) / 0.22)) * 40 * d * turn.dir : 0;
  const gx = ix + (iw - K.w) / 2 + slide, gy2 = gy + Math.max(0, (gh - K.h) / 2);
  const dpr = S.dpr || 1;
  const cellOf = j => { // j = 0..8 regular, 9 = boss → { cx, cy (tile centre), s (cell), capY }
    if (j < 9) { const col = j % 3, row = Math.floor(j / 3); return { cx: gx + (col + 0.5) * K.c, cy: gy2 + row * (K.c + K.ch) + K.c / 2, s: K.c, capY: gy2 + row * (K.c + K.ch) + K.c + K.ch * 0.42 }; }
    if (K.mode === 'below') return { cx: gx + K.w / 2, cy: gy2 + 3 * (K.c + K.ch) + K.bc / 2, s: K.bc, capY: gy2 + 3 * (K.c + K.ch) + K.bc + K.ch * 0.42 };
    const by = gy2 + (K.h - K.bc - K.ch) / 2;
    return { cx: gx + 3 * K.c + 0.2 * K.c + K.bc / 2, cy: by + K.bc / 2, s: K.bc, capY: by + K.bc + K.ch * 0.42 };
  };
  { // polish: a warm hearth glow behind the kittens
    const wg = g.createRadialGradient(gx + K.w / 2, gy2 + K.h * 0.55, 0, gx + K.w / 2, gy2 + K.h * 0.55, Math.max(K.w, K.h) * 0.7);
    wg.addColorStop(0, 'rgba(255,190,90,0.32)'); wg.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = wg; g.fillRect(Math.max(ix, gx - K.c * 0.3), gy2 - K.c * 0.2, Math.min(iw, K.w + K.c * 0.6), K.h + K.c * 0.4);
  }
  const hop = U.kHop && U.t - U.kHop.t0 < 1.6 && U.kHop.i >= base && U.kHop.i < base + PER_WORLD ? U.kHop : null;
  g.save();
  if (turn) g.globalAlpha *= 0.4 + 0.6 * eOut((U.t - turn.t0) / 0.22);
  for (let j = 0; j < PER_WORLD; j++) {
    const i = base + j, c = cellOf(j), st = ks[i] | 0;
    if (!(hop && hop.i === i)) { g.save(); portrait(g, i + 1, c.cx, c.cy, c.s * 0.9, st, dpr); g.restore(); }
    // caption: the kitten's name once rescued, the level that frees it while locked
    const boss = j === 9, nm = st ? (kName(i) || `Kitten ${i + 1}`) : `Level ${i + 1}`;
    const maxW = c.s * (boss ? 1.25 : 0.98), f0 = clamp(K.ch * 0.62, 12, Math.max(24, 13 * d));
    let label = st === 2 ? '★ ' + nm : nm, fs = fitSize(g, label, maxW, f0, FB, '900');
    if (fs < 11.5 && label.includes(' ')) { label = (st === 2 ? '★ ' : '') + nm.split(' ').pop(); fs = fitSize(g, label, maxW, f0, FB, '900'); }
    txt(g, label, c.cx, c.capY, Math.max(11, fs), { f: FB, w: '900', col: st === 2 ? GOLD_D : st ? INK : '#8A7F7A' });
  }
  g.restore();
  // polish (kid): tapping a rescued kitten makes it hop, float hearts and purr (its name is already captioned)
  if (hop) {
    const i = hop.i, c = cellOf(i - base), cell = c.s, t = U.t - hop.t0;
    const cx = c.cx, cy = c.cy;
    const jump = t < 0.5 ? Math.sin(t / 0.5 * Math.PI) * cell * 0.22 : t < 0.8 ? Math.sin((t - 0.5) / 0.3 * Math.PI) * cell * 0.06 : 0;
    g.save(); g.globalAlpha = 0.25; g.fillStyle = INK; g.beginPath(); g.ellipse(cx, cy + cell * 0.4, cell * 0.3 * (1 - jump / cell), cell * 0.05, 0, 0, TAU2); g.fill(); g.restore();
    g.save(); portrait(g, i + 1, cx, cy - jump, cell * 0.9 * (1 + 0.06 * Math.sin(t * 12) * Math.max(0, 1 - t)), ks[i], dpr); g.restore();
    for (let k = 0; k < 5; k++) { // hearts, kept inside the tile's own column and below the pager
      const q = (t - k * 0.12) / 1.1;
      if (q <= 0 || q >= 1) continue;
      const hx = cx + Math.sin(k * 2.1 + q * 5) * cell * 0.3, hy = Math.max(gy + cell * 0.1, cy - cell * 0.3 - q * cell * 0.7), hs = cell * (0.1 + 0.03 * (k % 2));
      g.save(); g.globalAlpha = 1 - q; g.translate(hx, hy); g.fillStyle = k % 2 ? TOMATO : '#FF8FA3'; g.strokeStyle = INK; g.lineWidth = Math.max(1, hs * 0.12);
      g.beginPath(); g.moveTo(0, hs * 0.35); g.bezierCurveTo(-hs, -hs * 0.3, -hs * 0.45, -hs, 0, -hs * 0.45); g.bezierCurveTo(hs * 0.45, -hs, hs, -hs * 0.3, 0, hs * 0.35); g.fill(); g.stroke();
      g.restore();
    }
  }
  // tap a portrait → hop (or how to meet it); invisible buttons over the tiles
  for (let j = 0; j < PER_WORLD; j++) {
    const i = base + j, c = cellOf(j), s = c.s * 0.9;
    const r = { x: c.cx - s / 2, y: c.cy - s / 2, w: s, h: s };
    reg({ id: 'k-cell' + i, label: st0(ks[i]) ? kName(i) : `Level ${i + 1}`, ...r, hit: r,
      act: () => {
        if (!(ks[i] > 0)) { toast(`Beat level ${i + 1} to meet this kitten`); return; }
        U.kHop = { i, t0: U.t };
        sfx('purr', 1.1); setTimeoutUI(() => sfx('mew'), 0.15);
      } });
  }
  { // set strip: two progress bars (Set n/10, Golden n/10)
    const fs = Math.max(13, Math.min(15 * d, stH * 0.44)), sw = Math.min(iw, 460 * d), sx = ix + (iw - sw) / 2, half = (sw - 10 * d) / 2;
    const bar = (x, w, label, n, done, col, icon) => {
      rr(g, x, stY, w, stH, stH / 2); g.fillStyle = done ? '#FFF1C4' : '#F6E6CF'; g.fill(); g.lineWidth = Math.max(1.5, 2 * d); g.strokeStyle = done ? GOLD_D : INK; g.stroke();
      const f = Math.min(1, n / PER_WORLD);
      if (f > 0) { g.save(); rr(g, x, stY, w, stH, stH / 2); g.clip(); g.fillStyle = col; g.globalAlpha *= 0.4; g.fillRect(x, stY, w * f, stH); g.restore(); }
      const ic = stH * 0.62;
      g.save(); if (icon === 'star') aStar(g, x + stH / 2 + 2 * d, stY + stH / 2, ic * 0.48, n > 0); else aIcon(g, icon, x + stH / 2 + 2 * d, stY + stH / 2, ic); g.restore();
      txt(g, `${label} ${n}/${PER_WORLD}${done ? ' ✓' : ''}`, x + stH + 4 * d + (w - stH - 10 * d) / 2, stY + stH / 2 + d, fs, { f: FB, w: '900', col: done ? GOLD_D : INK, maxW: w - stH - 10 * d });
    };
    bar(sx, half, 'Set', si.got, si.claimed, TEAL, 'paw');
    bar(sx + half + 10 * d, half, 'Golden', si.gold3, si.goldClaimed, GOLD, 'star');
  }
  if (si.goldClaimed || si.golden) goldFrame(g, px, py, pw, ph, d);
  const claim = si.claimable ? false : si.goldClaimable ? true : null; // null: nothing to claim on this page
  if (claim !== null) {
    const r = safe(() => M.setReward(claim), { balls: claim ? 200 : 80, boosters: [] });
    const cw = Math.min(iw * 0.62, 280 * d), xw = Math.min(iw - cw - 10 * d, 150 * d), x0 = px + pw / 2 - (cw + 10 * d + xw) / 2;
    pill(g, { id: 'k-claim', label: claim ? 'CLAIM GOLDEN SET' : 'CLAIM SET', sub: `+${r.balls} yarn + ${r.boosters.length > 1 ? r.boosters.length + ' boosters' : 'booster'}`,
      kind: 'primary', x: x0, y: fy, w: cw, h: fh, act: () => {
        const got = safe(() => M.claimSet(wd, claim), null);
        if (!got) return;
        sfx('gift');
        showCard('set', { w: wd, gold: claim, balls: got.balls, boosters: got.boosters });
      } });
    pill(g, { id: 'k-close', label: 'CLOSE', kind: 'cream', x: x0 + cw + 10 * d, y: fy, w: xw, h: fh, act: () => api.go(U.ret) });
  } else {
    const fw = Math.min(iw, 240 * d);
    pill(g, { id: 'k-close', label: 'CLOSE', kind: 'primary', x: px + pw / 2 - fw / 2, y: fy, w: fw, h: fh, act: () => api.go(U.ret) });
  }
}
const st0 = v => (v | 0) > 0;

// ---------- daily ----------
function addDays(key, n) { const t = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
function drawDaily(g, S) {
  const W = S.W, info = safe(() => M.daily(), { key: '2026-10-16', unlocked: false, won: false, streak: 0, stamps: Array(7).fill(false) });
  const close = () => api.go(U.ret);
  if (!info.unlocked) {
    const fr = dialogFrame(g, S, 360, (iw) => [
      { h: 44, fn: (y, hh, e) => txt(g, 'Daily Knot', W / 2, y + hh / 2, 28 * e, { maxW: iw }) },
      { h: 70, fn: (y, hh, e) => aIcon(g, 'lock', W / 2, y + hh / 2, 50 * e, INK) },
      { h: 52, fn: (y, hh, e) => lines(g, wrapFit(g, 'Beat level 13 to unlock', iw, hh, 18 * e, 13 * e), W / 2, y + hh / 2) },
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
  const reward = info.reward || 0, today = info.day || 1, shields = info.shields | 0, need = info.shieldNeed | 0;
  const doneUpTo = info.won ? today : today - 1; // ladder days already paid in this 7-day cycle
  const fr = dialogFrame(g, S, 400, (iw, x0) => [
    { h: 44, fn: (y, hh, e) => txt(g, 'Daily Knot', W / 2, y + hh / 2, 28 * e, { maxW: iw - 80 * e }) },
    { h: 86, fn: (y, hh, e) => {
      // meta r3: the 7-day streak ladder. Each day pays more; day 7 adds a booster bundle, then the ladder loops.
      const sp = iw / 7, r = Math.min(18 * e, sp / 2 - 3 * e), cy = y + 18 * e + Math.max(12, 12 * e) + r;
      g.save(); g.lineWidth = Math.max(2, 4 * e); g.strokeStyle = STITCH; g.beginPath(); g.moveTo(x0 + sp / 2, cy); g.lineTo(x0 + sp * 6.5, cy); g.stroke();
      if (doneUpTo > 0) { g.strokeStyle = TOMATO; g.beginPath(); g.moveTo(x0 + sp / 2, cy); g.lineTo(x0 + sp * (Math.min(doneUpTo, 7) - 0.5), cy); g.stroke(); }
      g.restore();
      const fs = Math.max(12, 12.5 * e);
      for (let i = 1; i <= 7; i++) {
        const x = x0 + sp * (i - 0.5), done = i <= doneUpTo, now = i === today && !info.won, big = i === 7, rr0 = big ? r * 1.18 : r;
        txt(g, big ? 'DAY 7' : `Day ${i}`, x, y + 9 * e, fs, { f: FB, w: '900', col: now ? TOMATO_D : big ? GOLD_D : '#6E6377', maxW: sp - 2 });
        const pulse = now ? 1 + 0.06 * Math.sin(U.t * 5) : 1;
        g.save(); g.translate(x, cy); g.scale(pulse, pulse);
        if (now) { g.beginPath(); g.arc(0, 0, rr0 + 4 * e, 0, 7); g.fillStyle = 'rgba(255,201,60,0.45)'; g.fill(); }
        g.beginPath(); g.arc(0, 0, rr0, 0, 7); g.fillStyle = done ? TOMATO : big ? GOLD : '#F6E6CF'; g.fill();
        g.lineWidth = now || big ? 3 * e : 2 * e; g.strokeStyle = now ? TOMATO_D : big ? GOLD_D : INK; g.stroke();
        if (done) aIcon(g, 'paw', 0, 0, rr0 * 1.15, '#fff');
        else if (big) giftBox(g, 0, 0, rr0 * 1.15);
        else { g.globalAlpha *= now ? 1 : 0.75; aIcon(g, 'ball', 0, 0, rr0 * 1.1); }
        g.restore();
        const pay = M.dailyPay ? M.dailyPay(i, 3) : 0;
        txt(g, `+${pay}`, x, cy + rr0 + 4 * e + fs * 0.6, fs, { f: FB, w: '900', col: done ? '#8A7F7A' : big ? GOLD_D : TEAL_D, maxW: sp - 2 });
      }
    } },
    { h: 32, fn: (y, hh, e) => {
      // streak + the Streak Shields held (they auto-save missed days)
      const label = `${streak} day streak`, s = 18 * e, w2 = tw(g, label, s) + 26 * e;
      const sl = `×${shields}`, sw = shields || need ? 22 * e + tw(g, sl, s) + 12 * e : 0;
      const x = W / 2 - (w2 + sw) / 2;
      flame(g, x + 9 * e, y + hh / 2, 20 * e, streak > 0);
      txt(g, label, x + 26 * e, y + hh / 2 + e, s, { maxW: iw - 30 * e - sw, align: 'left' });
      if (sw) { shieldIcon(g, x + w2 + 12 * e + 10 * e, y + hh / 2, 22 * e); txt(g, sl, x + w2 + 34 * e, y + hh / 2 + e, s, { align: 'left', col: TEAL_D }); }
    } },
    ...(need || (!streak && !shields) ? [{ h: 24, fn: (y, hh, e) => txt(g, need ? (need <= shields ? `Win today: ${need} Streak Shield${need > 1 ? 's' : ''} saves your streak` : 'You missed a day: the streak starts again')
      : 'Win daily to climb the 7-day ladder', W / 2, y + hh / 2, Math.max(13, 14 * e), { f: FB, w: '800', col: need && need <= shields ? TEAL_D : '#5A5066', maxW: iw }) }] : []),
    { h: 150, fn: (y, hh, e) => {
      const side = hh - 10 * e, rect = { x: W / 2 - side / 2, y: y + 5 * e, w: side, h: side };
      g.save(); g.globalAlpha = 0.9; aMini(g, rect, U.dailyLv.lv || {}, U.t); g.restore();
      g.save(); rr(g, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 10 * e); g.fillStyle = info.won ? 'rgba(255,244,228,0.35)' : 'rgba(255,244,228,0.55)'; g.fill(); g.restore();
      if (info.won) aStar(g, W / 2, y + hh / 2, 28 * e, true, 0);
      else txt(g, '?', W / 2, y + hh / 2, 54 * e, { col: '#fff', stroke: INK, sk: 0.16 });
    } },
    { h: 30, fn: (y, hh, e) => txt(g, info.won ? `New knot in ${hh2}h ${mm2}m` : `Win up to ${reward} yarn balls${today === 7 ? ' + boosters' : ''}`, W / 2, y + hh / 2, 16 * e, { f: FB, w: '800', maxW: iw }) },
    { h: 52, fn: (y, hh, e) => {
      const s = 40 * e, label = "Tomorrow's kitten", ts = Math.max(12, 14 * e), w2 = s + 10 * e + tw(g, label, ts, FB, '800');
      const x = W / 2 - Math.min(w2, iw) / 2, c = silhouette((dayNum(key) + 1) % 6, 0, s * 0.9, S.dpr || 1);
      if (c) g.drawImage(c, x + s / 2 - s * 0.9 * 0.75, y + hh / 2 + s * 0.45 - s * 0.9 * 1.38, s * 0.9 * 1.5, s * 0.9 * 1.5);
      txt(g, label, x + s + 10 * e, y + hh / 2, ts, { f: FB, w: '800', align: 'left', col: '#5A5066', maxW: iw - s - 10 * e });
    } },
    { h: 6 },
    { h: 56, fn: (y, hh, e) => {
      const bw = Math.min(iw, 300 * e);
      // fix 1 (GDD: "Replays allowed, reward once"): a won daily can be replayed; meta pays only once
      pill(g, { id: 'd-play', label: info.won ? 'PLAY AGAIN' : "PLAY TODAY'S KNOT", sub: info.won ? 'Just for fun: reward already won' : null,
        kind: info.won ? 'secondary' : 'primary', x: W / 2 - bw / 2, y, w: bw, h: 52 * e, d: e,
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
  const d = U.du, W = S.W, H = S.H - dlgInset(S);
  const fixed = 16 + 50 + 30 + 10 + 120 + 16 + 58 + 54 + 16;
  const k = Math.min(1, H / (fixed * d)), e = d * k;
  let y = Math.max(8 * e, (H - fixed * e) / 2) + 16 * e;
  txt(g, 'All 60 kittens rescued!', W / 2, y + 25 * e, 32 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: W - 32 * e });
  y += 50 * e;
  txt(g, 'Play on: Bonus Tangles + the Daily Knot', W / 2, y + 15 * e, 18 * e, { f: FB, w: '800', col: CREAM, stroke: INK, sk: 0.3, maxW: W - 32 * e });
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
  // meta r3: the primary is whatever is new today (an unplayed Daily Knot, else the next Bonus Tangle)
  const cta = homeCta() || { id: 'bonus', label: 'BONUS TANGLES', act: goBonus }, bsN = safe(() => M.bonusNext(), 0);
  pill(g, { id: 'ab-' + cta.id, label: cta.label, sub: cta.sub, kind: 'primary', x: W / 2 - bw / 2, y, w: bw, h: 54 * e, d: e, act: cta.act });
  y += 58 * e;
  const hw = (bw - 10 * e) / 2;
  if (cta.id === 'daily') pill(g, { id: 'ab-bonus', label: `Bonus ${bsN + 1}`, kind: 'secondary', x: W / 2 - bw / 2, y, w: hw, h: 48 * e, d: e, act: goBonus });
  else pill(g, { id: 'ab-daily', label: 'Daily Knot', kind: 'secondary', x: W / 2 - bw / 2, y, w: hw, h: 48 * e, d: e, act: () => api.go('daily') });
  pill(g, { id: 'ab-map', label: 'MAP', kind: 'secondary', x: W / 2 - bw / 2 + hw + 10 * e, y, w: hw, h: 48 * e, d: e, act: () => api.go('map') });
}

// ---------- cards ----------
function cardRect(S, type) {
  const L = layoutOf(S), m = L.m, sf = L.safe || { x: 0, y: 0, w: S.W, h: S.H };
  if (L.orient === 'landscape') {
    // the lose card takes ALL the column space between the rack and the basket (polish round 3 centres the callout
    //   in that space on big screens, so anchoring at callout.y would squeeze the card into the lower half)
    // fix2: cards dock in the column but stay ≤ 900 css px wide (2560+ screens), centred in it
    const cw = Math.min(L.rack.w, 900), cx = L.rack.x + (L.rack.w - cw) / 2;
    if (type === 'lose') {
      // meta r3: on short landscape screens (the labelled booster column is taller) the card may also cover the
      //   basket and booster column when the gap above the basket is under ~90% of the card's natural height; the
      //   card carries its own Undo / Hint / +1 Slot, so nothing is lost
      const y0 = Math.min(L.callout.y, L.rack.y + L.rack.h), h0 = L.basket.y - y0 - m * 0.5;
      return { x: cx, y: y0, w: cw, h: h0 >= 225 * U.du ? h0 : Math.max(h0, sf.y + sf.h - m * 0.5 - y0) };
    }
    return { x: cx, y: L.rack.y, w: cw, h: sf.y + sf.h - m - L.rack.y };
  }
  const x = sf.x + m, w = sf.w - 2 * m;
  // polish (band): the portrait lose card docks ABOVE the basket (never over it, like desktop) — the basket, the
  //   rack and the HUD stay visible; drawLoseCard may flip it to the top of the board when that hides fewer ✕ marks.
  if (type === 'lose') {
    const y = L.callout.y, bot = L.hideBasket ? sf.y + sf.h - m * 0.5 : Math.min(sf.y + sf.h - m * 0.5, L.basket.y - m * 0.5);
    return { x, y, w, h: Math.max(L.callout.h, bot - y) };
  }
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
/** Draws an illustration (art.js) with its visible body h tall, feet centred at (x, y); bbox cached per image. */
const artBox = new WeakMap();
function drawArtFit(g, im, x, y, h) {
  let bb = artBox.get(im);
  if (!bb) {
    const w = im.naturalWidth || im.width, hh = im.naturalHeight || im.height;
    bb = { x: 0, y: 0, w, h: hh };
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const cg = c.getContext('2d', { willReadFrequently: true }); cg.drawImage(im, 0, 0);
      const px = cg.getImageData(0, 0, w, hh).data;
      let x0 = w, y0 = hh, x1 = -1, y1 = -1;
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) if (px[(j * w + i) * 4 + 3] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      if (x1 > x0 && y1 > y0) bb = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch (err) { /* no 2D context: draw the whole image */ }
    artBox.set(im, bb);
  }
  const k = h / bb.h, dw = bb.w * k, bob = Math.sin(U.t * 2.4) * h * 0.012;
  g.save(); g.globalAlpha *= 0.25; g.fillStyle = INK; g.beginPath(); g.ellipse(x, y + 1, dw * 0.34, Math.max(2, h * 0.045), 0, 0, TAU2); g.fill(); g.restore();
  g.drawImage(im, bb.x, bb.y, bb.w, bb.h, x - dw / 2, y - h + bob, dw, h);
}
function drawWinCard(g, S, c) {
  const d = U.du, area = cardRect(S, 'win'), res = c.data || {}, sess = S.sess || {};
  const kind = sess.kind || 'level', st = clamp(res.stars || 0, 0, 3);
  // polish (kid): varied headlines, picked once per card; tough (mini/boss) knots get their own; plain-words stat line
  const tough = kind === 'level' && toughOf(sess);
  // polish round 3: boss wins get their own card (the grand boss illustration + its name); headlines rotate per card
  const bossId = kind === 'level' && BOSSES[sess.id] ? sess.id | 0 : 0;
  if (!c.title) {
    U.winN = (U.winN || 0) + 1;
    const pool = kind === 'daily' ? ['Daily Knot untied!', 'Today\'s knot: done!', 'Daily Knot cracked!']
      : kind === 'bonus' ? (st >= 3 ? ['Purr-fect tangle!', 'Tangle tamed!', 'Spotless tangle!'] : ['Tangle cleared!', 'Untangled!', 'Tangle undone!'])
        : bossId ? ['Boss beaten!', 'Grand rescue!', 'Royal rescue!', 'The big knot is undone!']
          : tough ? ['Tough knot untied!', 'You cracked it!', 'Mighty pulling!']
            : st >= 3 ? ['Purr-fect rescue!', 'Meow-velous!', 'Paws-itively perfect!', 'Clean as a whisker!', 'Flawless pulling!', 'Top cat!']
              : st === 2 ? ['Kitten rescued!', 'Nicely untied!', 'Free kitty!', 'Great pulling!', 'Knot undone!', 'Yarn-tastic!']
                : ['Kitten rescued!', 'Phew, all free!', 'Untangled!', 'You did it!'];
    c.title = pool[((sess.id | 0) * 7 + U.winN) % pool.length];
    c.hype = Math.min(3, (st >= 3 ? 2 : st === 2 ? 1 : 0) + (tough ? 1 : 0) + ((sess.bonusYarn | 0) > 0 ? 1 : 0));
  }
  // celebration illustration (art.js WINS), varied per level: level id picks a start; the first loaded one from there
  if (!c.winId) {
    // ui2 U5: L1-L4 walk 0,1,2,3 and L5-L8 walk 1,2,3,0 (every 4 levels shift by one), so each run of four levels
    //   shows all four illustrations before one repeats
    const lid = Math.max(0, (sess.id | 0) - 1), n = WINS.length, b0 = (lid + Math.floor(lid / 4) + (kind === 'level' ? 0 : U.winN)) % n;
    for (let i = 0; i < n && !c.winId; i++) if (img(WINS[(b0 + i) % n])) c.winId = WINS[(b0 + i) % n];
  }
  const winIm = c.winId ? img(c.winId) : null;
  const title = c.title;
  // NEW BEST only when this win truly beats an earlier best on this level (not a first win, not an equal replay)
  const showBest = kind === 'level' && !res.firstWin && (res.newStars | 0) > 0;
  const bonusN = (res.bonus | 0) || (sess.bonusYarn | 0);
  const peak = res.peak ?? 0, par = res.par ?? 0;
  // fix 2: the coaching line is plain words (no ★ shorthand) and reads at ≥ 16 css px, wrapping to 2 lines
  const statLine = sess.capped && st < 3 ? 'You used Snip or +1 Slot, so 2 stars is the most'
    : st >= 3 ? (peak ? `Tidy! Never more than ${peak} in the basket` : 'Spotless! The basket stayed empty')
      : par > 0 ? `The basket held ${peak}. Hold ${par} or fewer to earn 3 stars` : `The basket held ${peak}. Keep it empty to earn 3 stars`;
  const kid = res.kittenId || 0;
  const pad = 14 * d, iw0 = area.w - 2 * pad;
  const wear = safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby');
  const sIc = 18 * d, sGp = 6 * d, combo = bonusN > 0 ? `+${bonusN} combo` : '';
  // fix r2 (UI-LAYOUT: "stat line looks small at 2560x1440"): it scales with the card like the title does
  const swf = wrapMin(g, statLine, iw0 - sIc - sGp, Math.max(16, 16 * d), 16, 2, FB, '800');
  const sLH = swf.size * 1.14, comboW = combo ? tw(g, combo, swf.size, FB, '900') + sIc + sGp : 0;
  const sLW = Math.max(...swf.lines.map(l => tw(g, l, swf.size, FB, '800')));
  const comboInline = combo && swf.lines.length === 1 && sLW + sIc + sGp + 14 * d + comboW <= iw0;
  const statH = swf.lines.length * sLH + (combo && !comboInline ? sLH + 4 : 0) + 8;
  const list = [
    { h: 44, fn: (y, hh, e) => txt(g, title, area.x + area.w / 2, y + hh / 2, 34 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw0 }) },
    { h: 70, fn: (y, hh, e) => {
      const sr = Math.min(26 * e, iw0 / 8);
      if (c.hype > 0) { // celebration scales with stars / tough knot / combo: a turning sunburst behind the stars
        // squashed to the row's height, faded at the rim and clipped to the row: it never reaches the title above (QA 10-30)
        const k = clamp((U.t - c.t0 - 0.3) / 0.4, 0, 1), cx = area.x + area.w / 2, cy = y + hh / 2, n = 8 + 4 * c.hype;
        const R2 = Math.min(iw0 * 0.5, sr * (2.6 + 0.5 * c.hype)) * e3(k);
        if (R2 > 1) {
          const col = c.hype >= 3 ? '255,170,60' : '255,210,90', gr = g.createRadialGradient(0, 0, 0, 0, 0, R2);
          gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.55, `rgba(${col},0.7)`); gr.addColorStop(1, `rgba(${col},0)`);
          g.save(); g.beginPath(); g.rect(area.x, y, area.w, hh); g.clip();
          g.translate(cx, cy); g.scale(1, Math.min(1, (hh * 0.5) / R2));
          g.globalAlpha = 0.22 + 0.1 * c.hype; g.fillStyle = gr; g.beginPath();
          for (let i = 0; i < n; i++) { const a = U.t * 0.6 + i * TAU2 / n; g.moveTo(0, 0); g.arc(0, 0, R2, a, a + Math.PI / n); g.closePath(); }
          g.fill(); g.restore();
        }
      }
      for (let i = 0; i < 3; i++) {
        const t = (U.t - c.t0 - 0.35 - i * 0.25) / 0.3, on = i < st;
        const x = area.x + area.w / 2 + (i - 1) * sr * 2.5, yy = y + hh / 2 + (i === 1 ? -6 * e : 4 * e);
        aStar(g, x, yy, (i === 1 ? 1.15 : 1) * sr, false, (i - 1) * 0.2);
        if (on && t > 0) { const s2 = eBack(t); g.save(); g.translate(x, yy); g.scale(s2, s2); aStar(g, 0, 0, (i === 1 ? 1.15 : 1) * sr, true, (i - 1) * 0.2); g.restore(); }
      }
    } },
    ...(showBest ? [{ h: 30, fn: (y, hh, e) => { // centred gold pill under the stars (never against the panel edge)
      const k = clamp((U.t - c.t0 - 1.2) / 0.25, 0, 1);
      if (k <= 0) return;
      const s = 14 * e, label = `NEW BEST: ${st} ${st === 1 ? 'STAR' : 'STARS'}`, w2 = Math.min(iw0, tw(g, label, s) + 26 * e), h2 = Math.min(hh - 4 * e, 24 * e);
      const cx = area.x + area.w / 2, cy = y + hh / 2, sc = eBack(k);
      g.save(); g.translate(cx, cy); g.scale(sc, sc);
      rr(g, -w2 / 2, -h2 / 2, w2, h2, h2 / 2); g.fillStyle = GOLD; g.fill(); g.lineWidth = Math.max(1.5, 2 * e); g.strokeStyle = INK; g.stroke();
      txt(g, label, 0, e, s, { col: INK, maxW: w2 - 14 * e });
      g.restore();
    } }] : []),
    // ui2 U2: the basket stat and the combo bonus share ONE row ([basket] stat · [ball] +N combo). If both don't fit
    //   on one line at ≥ 12 px the combo chip drops under the stat inside the same (taller) row.
    // ui2 U2 + fix 2: [basket] coaching line (1-2 lines at ≥ 16 px, sized before layout so the row is tall enough),
    //   then the combo chip on the same line when it fits, else on its own line under it.
    { h: statH / d, fn: (y, hh, e) => {
      const fs = swf.size, x0 = area.x + area.w / 2 - (sLW + sIc + sGp + (comboInline ? 14 * d + comboW : 0)) / 2;
      const ly0 = y + 4 + sLH / 2;
      aIcon(g, 'slot', x0 + sIc / 2, ly0, sIc);
      swf.lines.forEach((l, i) => txt(g, l, x0 + sIc + sGp, ly0 + i * sLH, fs, { f: FB, w: '800', align: 'left' }));
      const chip = (cx0, cy) => {
        aIcon(g, 'ball', cx0 + sIc / 2, cy, sIc);
        txt(g, combo, cx0 + sIc + sGp, cy + 0.5, fs, { f: FB, w: '900', align: 'left', col: TEAL_D });
      };
      if (combo && comboInline) {
        const xe = x0 + sIc + sGp + sLW;
        g.fillStyle = 'rgba(43,36,64,0.35)'; g.beginPath(); g.arc(xe + 7 * d, ly0, 2 * d, 0, TAU2); g.fill();
        chip(xe + 14 * d, ly0);
      } else if (combo) chip(area.x + area.w / 2 - comboW / 2, ly0 + swf.lines.length * sLH + 4);
    } },
    // fix 7: a replay that earns no yarn shows no "+0" row
    ...((res.balls | 0) > 0 ? [{ h: 40, fn: (y, hh, e) => {
      const tB = c.t0 + 0.35 + 0.75 + 0.1, n = Math.round((res.balls || 0) * e3((U.t - tB) / 0.8));
      const label = `+${n}`, s = 26 * e, w2 = tw(g, label, s) + 30 * e, x0 = area.x + area.w / 2 - w2 / 2;
      aIcon(g, 'ball', x0 + 12 * e, y + hh / 2, 24 * e);
      txt(g, label, x0 + 30 * e, y + hh / 2 + e, s, { align: 'left', col: GOLD, stroke: INK, sk: 0.22 });
    } }] : []),
    bossId ? { h: 150, fn: (y, hh, e) => { // boss: the grand illustrated boss over a turning gold burst, with its grand name
      const cx = area.x + area.w / 2, capH = Math.max(40 * e, 36), s = Math.max(20 * e, hh - capH - 6 * e), feet = y + s + 2 * e;
      const k = e3(clamp((U.t - c.t0 - 0.2) / 0.5, 0, 1)), R2 = Math.min(iw0 * 0.5, s * 0.72) * k, cy = feet - s * 0.5;
      g.save(); g.globalAlpha = 0.3; g.fillStyle = GOLD; g.beginPath();
      for (let i = 0; i < 14; i++) { const a = -U.t * 0.4 + i * TAU2 / 14; g.moveTo(cx, cy); g.arc(cx, cy, R2, a, a + Math.PI / 14); g.closePath(); }
      g.fill(); g.restore();
      const gl = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, R2));
      gl.addColorStop(0, 'rgba(255,236,170,0.75)'); gl.addColorStop(1, 'rgba(255,236,170,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, Math.max(1, R2), 0, TAU2); g.fill();
      R.drawKitten(g, cx, feet, s * (0.85 + 0.15 * k), { id: bossId, stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(bossId), coat: coatOf(bossId), golden: false, bossScale: false, t: U.t, loopColors: [], memKey: c });
      const nm = kName(bossId - 1) || 'The boss kitten';
      // ui2 U5: "Golden" is a gold sticker on the burst, the caption stays "<name> is free!"
      if (res.golden) {
        const k2 = clamp((U.t - c.t0 - 0.7) / 0.25, 0, 1);
        if (k2 > 0) {
          const ls = Math.max(12, 13 * e), lw = tw(g, '★ GOLDEN', ls) + 20 * e, lh = 22 * e, bx = Math.min(cx + s * 0.42, area.x + area.w - pad - lw / 2), by = y + lh * 0.8;
          g.save(); g.translate(bx, by); g.rotate(0.12); g.scale(eBack(k2), eBack(k2));
          g.beginPath(); rr(g, -lw / 2, -lh / 2, lw, lh, lh / 2); g.fillStyle = GOLD; g.fill(); g.lineWidth = Math.max(1.5, 2 * e); g.strokeStyle = INK; g.stroke();
          txt(g, '★ GOLDEN', 0, e * 0.5, ls, { col: INK, maxW: lw - 8 * e });
          g.restore();
        }
      }
      txt(g, `${nm} is free!`, cx, y + hh - capH * 0.66, Math.max(15, 19 * e), { col: '#fff', stroke: INK, sk: 0.22, maxW: iw0 });
      const sub2 = kid ? 'Off to your Kitten Corner' : 'Boss knot beaten again';
      txt(g, sub2, cx, y + hh - capH * 0.16, Math.max(12, fitSize(g, sub2, iw0, 13 * e, FB, '800')), { f: FB, w: '800', col: '#5A5066', maxW: iw0 });
    } } : { h: 130, fn: (y, hh, e) => { // rescued kitten (illustrated) + a celebration illustration; code-drawn fallbacks
      // ui2 U2: the hero row is ~130 px (was 104) so the rescued kitten reads as the reward, not a thumbnail
      const cx = area.x + area.w / 2, capH = kid ? 22 * e : 0, s = Math.min(100 * e, hh - capH - 6 * e, iw0 / 2.6), feet = y + s + 3 * e;
      const art2 = (x, sz) => { if (winIm) drawArtFit(g, winIm, x, feet, sz); else aKitty(g, x, feet - 1 * e, sz * 0.85, 'celebrate', U.t, wear); };
      if (kid) {
        if (R.kittenSprite && R.kittenSprite(kid, true)) R.drawKitten(g, cx - s * 0.62, feet, s * 0.9, { id: kid, stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(kid), coat: coatOf(kid), golden: !!res.golden, t: U.t, loopColors: [], memKey: c });
        else portrait(g, kid, cx - s * 0.62, feet - s * 0.45, s * 0.86, res.golden ? 2 : 1, S.dpr || 1);
        art2(cx + s * 0.66, s * 1.05);
        const nm = kName(kid - 1);
        txt(g, nm ? (res.golden ? `Golden ${nm} joins your Kitten Corner!` : `${nm} is safe in your Kitten Corner`) : (res.golden ? 'A golden kitten! Off to your Kitten Corner' : 'Safe and sound in your Kitten Corner'), cx, y + hh - 9 * e, 14 * e, { f: FB, w: '800', maxW: iw0 });
      } else art2(cx, s * 1.15);
    } },
    { h: 6 },
    { h: 78, fn: (y, hh, e) => {
      const ir = Math.max(22, 23 * e), icons = [['w-replay', 'retry', 'Replay', () => finishWin(() => api.retry())], ['w-map', 'home', 'Map', () => finishWin(() => api.go('map'))]];
      if (P.canShare) { icons.push(['w-share', 'share', 'Share', () => shareWin(sess, res, c)]); if (U.t - c.t0 > 1) prepShare(c, sess, res); }
      const gap = 8 * e, pw = Math.max(80 * e, Math.min(240 * e, iw0 - icons.length * (2 * ir + gap)));
      const total = pw + icons.length * (2 * ir + gap), x0 = area.x + area.w / 2 - total / 2;
      // meta r3: every icon carries a word caption (≥ 12 px) under it, so Replay / Map / Share read at a glance
      const iy = y + Math.max(0, 26 * e - ir), cap = { capY: iy + 2 * ir + 3 * e, capW: 2 * ir + gap, capFs: Math.max(12, 12.5 * e) };
      iconBtn(g, { id: icons[0][0], label: icons[0][2], icon: icons[0][1], x: x0, y: iy, w: 2 * ir, h: 2 * ir, act: icons[0][3], d: e, cap: icons[0][2], ...cap });
      { const nh = Math.max(44, 52 * e); pill(g, { id: 'win-next', label: 'NEXT', kind: 'primary', x: x0 + 2 * ir + gap, y: iy + ir - nh / 2, w: pw, h: nh, d: e, act: () => finishWin(() => api.next()) }); }
      for (let i = 1; i < icons.length; i++) iconBtn(g, { id: icons[i][0], label: icons[i][2], icon: icons[i][1], x: x0 + pw + gap + i * (2 * ir + gap), y: iy, w: 2 * ir, h: 2 * ir, act: icons[i][3], d: e, cap: icons[i][2], ...cap });
    } },
  ];
  const lay = rows(list, d, area.h - 2 * pad);
  const h = lay.h + 2 * pad * lay.k;
  const rect = { x: area.x, y: area.y, w: area.w, h };
  g.save();
  cardAnim(g, c, rect);
  panel(g, rect.x, rect.y, rect.w, rect.h, d * Math.max(0.7, lay.k));
  lay.run(rect.y + pad * lay.k);
  g.restore();
}
/** Free (pullable) strands while stuck: each gets a ✕ at its tap point. Cached per rule state. */
function stuckMarks(S) {
  const sess = S.sess;
  if (!sess || !sess.stuck || !sess.puz || !sess.st || !api || typeof api.tapPointFor !== 'function') return [];
  const st = sess.st, key = String(st.removed) + ':' + st.moves + ':' + S.W + 'x' + S.H;
  if (U.marks && U.marks.key === key && U.marks.sess === sess) return U.marks.pts;
  const pts = [];
  for (let i = 0; i < (sess.puz.n | 0); i++) {
    if (isRemoved(st, i)) continue;
    const cp = safe(() => canPull(sess.puz, st, i), null); // free = not covered / locked / paw-gated; 'full' is why we're stuck
    if (!cp || !(cp.ok || cp.why === 'full')) continue;
    const p = safe(() => api.tapPointFor(i), null);
    if (p) pts.push({ x: p.x, y: p.y });
  }
  U.marks = { key, sess, pts };
  return pts;
}
function drawMarks(g, S, pts) {
  if (!pts.length) return;
  const B = S.sess && S.sess.B, r = Math.max(10, Math.min(26, ((B && B.unit) || 40) * 0.3));
  const t = U.t - ((U.card && U.card.t0) || 0), a = clamp(t / 0.25, 0, 1), pulse = 1 + 0.08 * Math.sin(U.t * 6);
  g.save();
  for (const p of pts) {
    const s = r * eBack(a) * pulse;
    g.beginPath(); g.arc(p.x, p.y, s, 0, 7); g.fillStyle = CREAM; g.fill(); g.lineWidth = Math.max(2, s * 0.16); g.strokeStyle = INK; g.stroke();
    g.lineCap = 'round'; g.lineWidth = Math.max(2.5, s * 0.26); g.strokeStyle = TOMATO;
    g.beginPath(); g.moveTo(p.x - s * 0.42, p.y - s * 0.42); g.lineTo(p.x + s * 0.42, p.y + s * 0.42);
    g.moveTo(p.x + s * 0.42, p.y - s * 0.42); g.lineTo(p.x - s * 0.42, p.y + s * 0.42); g.stroke();
  }
  g.restore();
}
// fix 8: Share sends a 1080x1350 picture (world backdrop, the rescued kitten, stars, "Level N", the game title and
//   the URL). DECISION: the image is baked ahead (once, ~1 s after the win card opens) and kept on the card, so the
//   tap calls the Web Share API synchronously inside the user gesture (Safari drops the activation across an awaited
//   toBlob). Order: share({files,text,url}) when canShare({files}); else share({text,url}); else copy + "Copied!".
// The page's own address (arcadeaday.com/knot-kitty/ on the web); share is off on yt and portals (P.canShare).
const SHARE_URL = typeof location !== 'undefined' ? location.origin + location.pathname : '';
// fix3 (critic r2, viral 2): the share carries a stat and a dare (basket peak, best chain), the numbers the video's
//   pinned comment asks people to post
function shareStats(sess, res) {
  const cap = (sess.basket || []).length || 0, chain = Math.max(0, ...((sess.chainLog || []).map(x => x.m | 0)));
  return { peak: res.peak | 0, cap, chain };
}
function shareText(sess, res) {
  const st = '★'.repeat(clamp(res.stars || 1, 1, 3)), k = shareStats(sess, res);
  const nm = sess.kind === 'level' && res.kittenId ? kName(res.kittenId - 1) : '';
  const what = sess.kind === 'daily' ? `I untangled today's Daily Knot in Knot Kitty ${st}` : sess.kind === 'level' ? `I rescued ${nm || 'the kitten'} on level ${sess.id} of Knot Kitty ${st}` : `I cleared a bonus tangle in Knot Kitty ${st}`;
  return `${what} with a basket peak of ${k.peak}${k.chain > 1 ? ` and a CHAIN x${k.chain}` : ''}. Can you beat it?`;
}
function shareImage(sess, res) {
  const Wc = 1080, Hc = 1350, cv = document.createElement('canvas');
  cv.width = Wc; cv.height = Hc;
  const g = cv.getContext('2d');
  if (!g) return null;
  const world = sess.kind === 'level' ? clamp(worldOf(Math.min(LEVELS, sess.id | 0 || 1)), 1, 6) : 1;
  const bg = img(bgArt(world));
  g.fillStyle = '#F7E9D2'; g.fillRect(0, 0, Wc, Hc);
  if (bg && bg.width) { const s = Math.max(Wc / bg.width, Hc / bg.height); g.drawImage(bg, (Wc - bg.width * s) / 2, (Hc - bg.height * s) / 2, bg.width * s, bg.height * s); }
  const vg = g.createLinearGradient(0, 0, 0, Hc);
  vg.addColorStop(0, 'rgba(43,30,40,0.42)'); vg.addColorStop(0.3, 'rgba(43,30,40,0.05)'); vg.addColorStop(0.7, 'rgba(43,30,40,0.05)'); vg.addColorStop(1, 'rgba(43,30,40,0.5)');
  g.fillStyle = vg; g.fillRect(0, 0, Wc, Hc);
  // fix3 (critic r2, viral 1): the kitten is drawn first and capped (no boss 1.4x) so its top stays under "Level N",
  //   and every line of text is drawn over it
  const kid = res.kittenId || 0, feet = 890, s = 480;
  const glow = g.createRadialGradient(Wc / 2, feet - s * 0.45, 0, Wc / 2, feet - s * 0.45, s * 0.75);
  glow.addColorStop(0, 'rgba(255,236,170,0.85)'); glow.addColorStop(1, 'rgba(255,236,170,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(Wc / 2, feet - s * 0.45, s * 0.75, 0, TAU2); g.fill();
  const okKid = kid && R.kittenSprite && safe(() => R.kittenSprite(kid, true), null);
  if (okKid) safe(() => R.drawKitten(g, Wc / 2, feet, s, { id: kid, stage: 4, loops: 0, flinch: 0, freeT: -1, breed: breedOf(kid), coat: coatOf(kid), golden: !!res.golden, t: 0, loopColors: [], memKey: cv, bossScale: false, maxH: 520 }));
  else aKitty(g, Wc / 2, feet, s * 0.8, 'idle', 0, safe(() => (M.outfits().find(o => o.worn) || {}).id, 'tabby'));
  txt(g, 'Knot Kitty', Wc / 2, 150, 124, { col: '#fff', stroke: INK, sk: 0.16, maxW: Wc - 120 });
  const sub = sess.kind === 'level' ? `Level ${sess.id}` : sess.kind === 'daily' ? 'Daily Knot' : 'Bonus tangle';
  txt(g, sub, Wc / 2, 268, 78, { col: GOLD, stroke: INK, sk: 0.18, maxW: Wc - 160 });
  const nm = okKid ? kName(kid - 1) : '';
  if (nm) txt(g, `${nm} is free!`, Wc / 2, 940, 56, { col: '#fff', stroke: INK, sk: 0.18, maxW: Wc - 140 });
  const st = clamp(res.stars || 0, 0, 3);
  for (let i = 0; i < 3; i++) aStar(g, Wc / 2 + (i - 1) * 170, 1062 + (i === 1 ? -14 : 0), i === 1 ? 74 : 64, i < st, (i - 1) * 0.2);
  const k = shareStats(sess, res);
  const line = `Basket peak ${k.peak}${k.cap ? '/' + k.cap : ''}${k.chain > 1 ? ` · CHAIN x${k.chain}` : ''} · Beat me!`;
  txt(g, line, Wc / 2, 1180, 44, { f: FB, w: '900', col: CREAM, stroke: INK, sk: 0.16, maxW: Wc - 120 });
  const u = 'arcadeaday.com/knot-kitty', us = 46, uw = tw(g, u, us, FB, '900') + 70;
  rr(g, Wc / 2 - uw / 2, 1230, uw, 76, 38); g.fillStyle = CREAM; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
  txt(g, u, Wc / 2, 1269, us, { f: FB, w: '900', col: INK });
  return cv;
}
function prepShare(c, sess, res) {
  if (c.shareReq || !P.canShare || typeof document === 'undefined') return;
  c.shareReq = true;
  safe(() => {
    const cv = shareImage(sess, res);
    if (cv && cv.toBlob) cv.toBlob(b => { if (b && typeof File === 'function') c.shareFile = new File([b], 'knot-kitty.png', { type: 'image/png' }); }, 'image/png');
  });
}
function shareWin(sess, res, c) {
  if (!P.canShare) return;
  const text = shareText(sess, res), url = SHARE_URL, nav = typeof navigator !== 'undefined' ? navigator : {};
  const f = c && c.shareFile;
  // fix4 (critic r3, viral 1: desktop Share was text-only): with no Web Share the picture goes on the clipboard with
  //   the text beside it (an image paster gets the card, a text box gets the dare + link); text-only copy if that fails
  const copyText = () => {
    try { if (nav.clipboard && nav.clipboard.writeText) { nav.clipboard.writeText(text + ' ' + url).then(() => toast('Copied!'), () => toast('arcadeaday.com/knot-kitty')); return; } } catch {}
    toast('arcadeaday.com/knot-kitty');
  };
  const copy = () => {
    try {
      if (f && nav.clipboard && nav.clipboard.write && typeof ClipboardItem === 'function') {
        const item = new ClipboardItem({ 'image/png': f, 'text/plain': new Blob([text + ' ' + url], { type: 'text/plain' }) });
        nav.clipboard.write([item]).then(() => toast('Picture copied!'), copyText);
        return;
      }
    } catch {}
    copyText();
  };
  try {
    if (f && nav.share && nav.canShare && nav.canShare({ files: [f] })) {
      // a failed file share (not a user cancel) falls back to the text share, then the copy
      nav.share({ files: [f], text, url }).catch(e => { if (!e || e.name !== 'AbortError') safe(() => nav.share({ text, url }).catch(() => {})); });
      return;
    }
    if (nav.share) { nav.share({ text, url }).catch(e => { if (!e || e.name !== 'AbortError') copy(); }); return; }
  } catch {}
  copy();
}
function drawLoseCard(g, S, c) {
  const d = U.du, area = cardRect(S, 'lose'), pad = 12 * d, iw = area.w - 2 * pad;
  const unU = safe(() => M.boosterUnlocked('undo'), false), unS = safe(() => M.boosterUnlocked('slot'), false);
  const nU = safe(() => M.booster('undo'), 0), nS = safe(() => M.booster('slot'), 0), bal = safe(() => M.balance(), 0);
  const unH = safe(() => M.boosterUnlocked('hint'), false), nH = safe(() => M.booster('hint'), 0);
  const undoPrimary = unU && (nU > 0 || bal >= BOOSTERS.undo.price);
  // fix r2 (lose card): Hint sits between Undo and +1 Slot. It rewinds to the last spot with a way out and shows
  //   the move there (api.rescueHint). A booster at 0 stock says its price in plain words ("Hint · 40 yarn") and
  //   buys-and-uses on tap. After 2 losses on this level with no hints and too little yarn, one Hint is free.
  const sess0 = S.sess || {}, lkey = sess0.kind + ':' + sess0.id;
  if (!c.counted) { c.counted = true; U.losses[lkey] = (U.losses[lkey] || 0) + 1; }
  const freeHint = unH && nH <= 0 && bal < BOOSTERS.hint.price && (U.losses[lkey] || 0) >= 2 && !U.freeHintUsed[lkey];
  const boost = (k, id, name, icon, n, act) => {
    const b = { id, label: name, icon, kind: 'secondary', act };
    if (n > 0) b.badge = { n };
    else { b.buy = `${name} · ${BOOSTERS[k].price} yarn`; b.sub = `${BOOSTERS[k].price} yarn`; }
    return b;
  };
  const btns = [];
  if (unU) btns.push({ ...boost('undo', 'l-undo', 'Undo', 'undo', nU, () => loseBooster('undo')), kind: undoPrimary ? 'primary' : 'secondary' });
  if (unH) btns.push(freeHint ? { id: 'l-hint', label: 'Free Hint', icon: 'hint', kind: 'secondary', act: () => loseHint(true, lkey) }
    : boost('hint', 'l-hint', 'Hint', 'hint', nH, () => loseHint(false, lkey)));
  if (unS) btns.push(boost('slot', 'l-slot', '+1 Slot', 'slot', nS, () => loseBooster('slot')));
  const retry = { id: 'l-retry', label: 'Retry', icon: 'retry', kind: undoPrimary ? 'secondary' : 'primary', act: () => { U.loseDone = true; U.card = null; api.retry(); } };
  // fix 1: free strands that have nowhere to go get a ✕ (drawn under the card, which is docked low so the board
  //   top stays visible), and the copy is warm: "So close!" + how few strands were left.
  const marks = stuckMarks(S);
  drawMarks(g, S, marks);
  const sess = S.sess || {}, left = sess.puz && sess.st ? Math.max(0, (sess.puz.n | 0) - (sess.st.count | 0)) : 0;
  const close = left > 0 && left <= Math.max(6, ((sess.puz && sess.puz.n) | 0) * 0.4);
  const warm = close ? `So close! Only ${left} strand${left === 1 ? '' : 's'} to go` : 'Out of room! Undo a pull or try again';
  // polish (grandparent): plain words, big high-contrast ink text (no small grey line)
  const why = marks.length ? 'The ✕ yarn has nowhere to go' : 'No yarn fits a spool or the basket';
  const list = [
    { h: 46, fn: (y, hh, e) => {
      // ui2 U8: a round Map button sits at the title's left so the lose card is never a retry-only dead end. It lives
      //   in the title row (not the button row) so the three pills keep their width in narrow side columns.
      const ir = Math.max(22, Math.min(22 * e, hh / 2)), bx = area.x + pad * 0.7, mr = Math.max(0, 24 - ir); // meta r3: ≥ 44 px drawn
      iconBtn(g, { id: 'l-map', label: 'Map', icon: 'home', x: bx, y: y + hh / 2 - ir, w: 2 * ir, h: 2 * ir, d: e,
        hit: { x: bx - mr, y: y + hh / 2 - ir - mr, w: 2 * (ir + mr), h: 2 * (ir + mr) },
        act: () => { U.loseDone = true; U.card = null; api.go('map'); } });
      txt(g, warm.split('!')[0] + '!', area.x + area.w / 2, y + hh / 2, 32 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw - 4 * (ir + 4 * e) });
    } },
    { h: 26, fn: (y, hh, e) => txt(g, warm.slice(warm.indexOf('!') + 2), area.x + area.w / 2, y + hh / 2, 19 * e, { f: FB, w: '900', col: TOMATO_D, maxW: iw }) },
    { h: 25, fn: (y, hh, e) => txt(g, why, area.x + area.w / 2, y + hh / 2, Math.max(16, 17 * e), { f: FB, w: '900', col: INK, maxW: iw }) },
    { h: 8 },
  ];
  if (btns.length) list.push({ h: 58, fn: (y, hh, e) => {
    // fix r2: boosters get their own row (Retry sits under them) so each pill keeps room for "Hint · 40 yarn";
    //   a pill too narrow for that one line says the price on a second line instead
    const gap = 8 * e, bw = (iw - gap * (btns.length - 1)) / btns.length, bh = Math.min(54 * e, Math.max(44, bw * 0.55));
    btns.forEach((b, i) => {
      const p = { ...b, x: area.x + pad + i * (bw + gap), y: y + (hh - bh) / 2, w: bw, h: bh, d: e };
      if (b.buy) {
        const one = tw(g, b.buy, Math.max(16, bh * 0.36), FT) + bh * 0.9 <= bw;
        if (one) { p.label = b.buy; p.sub = null; p.icon = null; } else p.icon = null;
      } else if (bw < 120 * e) p.icon = null;
      pill(g, p);
    });
  } });
  list.push({ h: 54, fn: (y, hh, e) => {
    const bw = Math.min(iw, 230 * e), bh = Math.min(50 * e, hh);
    pill(g, { ...retry, x: area.x + area.w / 2 - bw / 2, y: y + (hh - bh) / 2, w: bw, h: bh, d: e });
  } });
  let lay = rows(list, d, area.h - 2 * pad);
  // ui2: on short columns (compact landscape) drop the "why" line before the copy shrinks under ~12px; the ✕ marks
  //   on the board still say it
  if (lay.k < 0.9) { list.splice(2, 1); lay = rows(list, d, area.h - 2 * pad); }
  const rh = lay.h + 2 * pad * lay.k;
  const rect = { x: area.x, y: area.y + Math.max(0, area.h - rh), w: area.w, h: rh }; // docked to the bottom of its area
  const L = layoutOf(S);
  if (L.orient !== 'landscape' && marks.length && area.h - rh > 4) {
    // polish round 3: slide the card up its area (bottom first) to the lowest spot that hides NO ✕ mark; when every
    //   spot hides one, the spot hiding the fewest. The area never reaches the basket, so the basket always shows.
    const mr = 20 * d, inR = (y0) => marks.filter(p => p.y > y0 - mr && p.y < y0 + rh + mr).length;
    let bestY = rect.y, bestN = inR(rect.y);
    for (let y0 = rect.y; bestN > 0 && y0 >= area.y - 0.5; y0 -= 6 * d) { const n = inR(y0); if (n < bestN) { bestN = n; bestY = y0; } }
    if (bestN > 0 && inR(area.y) < bestN) bestY = area.y;
    rect.y = bestY;
  }
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
  // fix 6: one card per win. A 'rewards' card carries every gift / chest / unlock of the win (data.parts); the
  //   yarn is summed and each booster shows once with its total count. Reasons are plain words at ≥ 16 px.
  const parts = c.type === 'rewards' ? (data.parts || []) : [{ type: c.type, data }];
  let balls = 0, unlockK = null, shieldN = 0, setW = 0, gold = false;
  const bcount = {}, why = [];
  const addB = (k, n) => { if (k) bcount[k] = (bcount[k] || 0) + n; };
  for (const p of parts) {
    const q = p.data || {};
    if (p.type === 'gift') { balls += q.balls || 60; addB(q.booster, 1); why.push(`You reached ${q.at || 15} stars`); }
    else if (p.type === 'chest') { balls += q.balls || 150; for (const k of q.boosters || []) addB(k, 1); why.push(`${(WORLDS[q.world] || {}).name || 'The world'} is complete`); }
    else if (p.type === 'unlockBooster') { unlockK = q.k || 'undo'; addB(unlockK, q.n || 1); }
    else if (p.type === 'shield') { shieldN += q.n | 0 || 1; why.push(q.n > 1 ? `${q.n} Streak Shields kept your streak alive` : 'A Streak Shield kept your streak alive'); }
    else if (p.type === 'ladder') { for (const k of q.boosters || []) addB(k, 1); why.push('Day 7 of your streak: booster bundle!'); }
    else if (p.type === 'bonusGift') { addB(q.k, 1); why.push(`${q.at || 5} Bonus Tangles won`); }
    else if (p.type === 'setReady') { setW = q.w; why.push(`${(WORLDS[q.w] || {}).name || 'World ' + q.w} kitten set ${q.gold ? 'is all 3★' : 'is complete'}. Claim it in Kitten Corner`); }
    else if (p.type === 'set') { gold = !!q.gold; balls += q.balls | 0; for (const k of q.boosters || []) addB(k, 1); why.push(`All 10 kittens of ${(WORLDS[q.w] || {}).name || 'World ' + q.w}${gold ? ' at 3★' : ''}`); }
  }
  const one = parts.length === 1 && parts[0].type;
  const title = parts.length > 1 ? 'Rewards!' : unlockK ? 'New booster!' : one === 'chest' ? 'World chest!' : one === 'shield' ? 'Streak saved!'
    : one === 'ladder' ? 'Day 7 bonus!' : one === 'bonusGift' ? 'Bonus gift!' : one === 'setReady' ? 'Set complete!' : one === 'set' ? (gold ? 'Golden set!' : 'Kitten set!') : 'Star gift!';
  const rewards = [];
  if (unlockK) rewards.push([unlockK, `×${bcount[unlockK]} free`]);
  if (balls > 0) rewards.push(['ball', `+${balls}`]);
  for (const k of BK) if (k !== unlockK && bcount[k]) rewards.push([k, `+${bcount[k]}`]);
  if (shieldN) rewards.push(['shield', shieldN > 1 ? `${shieldN} used` : 'used']);
  if (setW && !rewards.length) rewards.push(['paw', 'claim']);
  const subs = [];
  if (unlockK) subs.push(BDESC[unlockK] || '');
  subs.push(...why);
  const sz = Math.max(16, 16 * Math.min(d, 1.25));
  const subW = subs.map(s => wrapMin(g, s, iw, sz, 16, 2, FB, '800'));
  const list = [
    { h: 44, fn: (y, hh, e) => txt(g, title, W / 2, y + hh / 2, 30 * e, { col: '#fff', stroke: INK, sk: 0.2, maxW: iw }) },
  ];
  if (unlockK) list.push({ h: 34, fn: (y, hh, e) => txt(g, `New: ${BNAME[unlockK] || ''}`, W / 2, y + hh / 2, 24 * e, { col: TEAL_D, maxW: iw }) });
  subW.forEach((wf, i) => list.push({ h: (wf.lines.length * wf.size * 1.14 + 8) / d, fn: (y, hh) => lines(g, wf, W / 2, y + hh / 2, { col: i === 0 && unlockK ? INK : '#4A4056' }) }));
  list.push({ h: 86, fn: (y, hh, e) => {
    const n = rewards.length, cw = Math.min(90 * e, iw / n), x0 = W / 2 - cw * n / 2;
    rewards.forEach(([ic, label], i) => {
      const cx = x0 + cw * (i + 0.5), r = Math.min(26 * e, cw * 0.36), pop = eBack((U.t - c.t0 - 0.2 - i * 0.12) / 0.3);
      g.save(); g.translate(cx, y + r + 4 * e); g.scale(pop, pop);
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = '#FFF9EC'; g.fill(); g.lineWidth = 2.5 * e; g.strokeStyle = gold ? GOLD_D : INK; g.stroke();
      rIcon(g, ic, 0, 0, r * 1.1);
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
  if (one === 'set') { // a set claim: a warm halo of rays behind the card (gold-trimmed for the Golden set)
    const t = U.t - c.t0, cx = W / 2, cy = py + ph * 0.32, R0 = Math.max(pw, ph) * 0.75;
    g.save(); g.translate(cx, cy); g.rotate(t * 0.25); g.globalAlpha *= gold ? 0.35 : 0.22;
    for (let k = 0; k < 12; k++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(R0, -R0 * 0.12); g.lineTo(R0, R0 * 0.12); g.closePath(); g.fillStyle = GOLD; g.fill(); }
    g.restore();
  }
  panel(g, px, py, pw, ph, d, gold ? { line: GOLD_D, stitch: GOLD, fill: '#FFF6D8' } : {});
  if (gold) goldFrame(g, px, py, pw, ph, d);
  lay.run(py + pad * lay.k);
  g.restore();
}
/** A gilded double frame (Golden set card, golden Kitten Corner page). */
function goldFrame(g, x, y, w, h, d) {
  const r = Math.min(18 * d, w / 2, h / 2);
  g.save();
  rr(g, x - 3 * d, y - 3 * d, w + 6 * d, h + 6 * d, r + 3 * d); g.lineWidth = Math.max(2, 4 * d); g.strokeStyle = GOLD; g.stroke();
  rr(g, x - 6 * d, y - 6 * d, w + 12 * d, h + 12 * d, r + 6 * d); g.lineWidth = Math.max(1, 1.6 * d); g.strokeStyle = GOLD_D; g.stroke();
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { g.save(); aStar(g, cx, cy, 11 * d, true); g.restore(); }
  g.restore();
}
/** Streak Shield emblem (no art for it): a teal crest with a gold paw-star. */
function shieldIcon(g, cx, cy, s) {
  const w = s * 0.8, h = s * 0.92;
  g.save(); g.translate(cx, cy);
  g.beginPath(); g.moveTo(0, -h / 2); g.quadraticCurveTo(w * 0.32, -h * 0.36, w / 2, -h * 0.4); g.quadraticCurveTo(w / 2, h * 0.18, 0, h / 2);
  g.quadraticCurveTo(-w / 2, h * 0.18, -w / 2, -h * 0.4); g.quadraticCurveTo(-w * 0.32, -h * 0.36, 0, -h / 2); g.closePath();
  g.fillStyle = TEAL; g.fill(); g.lineWidth = Math.max(1.2, s * 0.07); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(0, -h * 0.34); g.quadraticCurveTo(w * 0.24, -h * 0.26, w * 0.34, -h * 0.28); g.quadraticCurveTo(w * 0.32, h * 0.1, 0, h * 0.34); g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
  aStar(g, 0, -h * 0.02, s * 0.22, true);
  g.restore();
}
/** A small wrapped present (day 7 of the streak ladder: the booster bundle). */
function giftBox(g, x, y, s) {
  const w = s * 0.8, h = s * 0.56, lw = Math.max(1.2, s * 0.06);
  g.save(); g.translate(x, y + s * 0.08); g.lineWidth = lw; g.strokeStyle = INK;
  g.fillStyle = TOMATO; g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = TOMATO_D; g.fillRect(-w * 0.56, -h / 2 - s * 0.14, w * 1.12, s * 0.16); g.strokeRect(-w * 0.56, -h / 2 - s * 0.14, w * 1.12, s * 0.16);
  g.fillStyle = CREAM; g.fillRect(-s * 0.07, -h / 2 - s * 0.14, s * 0.14, h + s * 0.14); g.strokeRect(-s * 0.07, -h / 2 - s * 0.14, s * 0.14, h + s * 0.14);
  for (const k of [-1, 1]) { g.beginPath(); g.ellipse(k * s * 0.13, -h / 2 - s * 0.22, s * 0.13, s * 0.08, k * 0.5, 0, 7); g.fillStyle = CREAM; g.fill(); g.stroke(); }
  g.restore();
}
const rIcon = (g, ic, x, y, s) => (ic === 'shield' ? shieldIcon(g, x, y, s) : ic === 'gift' ? giftBox(g, x, y, s) : aIcon(g, ic, x, y, s));
function drawToast(g, S) {
  const d = U.du, t = U.t - U.toast.t0, a = Math.min(1, t / 0.15, (2 - t) / 0.3);
  if (a <= 0) return;
  const s = 15 * d, maxW = S.W - 40 * d, size = fitSize(g, U.toast.text, maxW - 28 * d, s, FB, '800');
  const w = tw(g, U.toast.text, size, FB, '800') + 28 * d, h = size * 2.2;
  let y = S.H - dlgInset(S) - 90 * d - h;
  const dl = U.dlg;
  if (dl) { // over a dialog: sit in the gap above (or below) the panel, never over its text or buttons
    const sb = S.H - dlgInset(S);
    if (dl.y - h - 4 * d >= 2 * d) y = Math.max(2 * d, dl.y - h - 8 * d);
    else if (dl.y + dl.h + h + 4 * d <= sb) y = dl.y + dl.h + 6 * d;
    else if (dl.toastY != null) y = Math.max(dl.toastMin || dl.y + 60 * d, dl.toastY - h); // inside, above the footer
    else y = Math.max(dl.y + 70 * d, dl.y + dl.h - 70 * d - h); // inside, low: never over a dialog's header
  }
  g.save(); g.globalAlpha = a;
  rr(g, S.W / 2 - w / 2, y, w, h, h / 2); g.fillStyle = INK; g.fill();
  txt(g, U.toast.text, S.W / 2, y + h / 2, size, { f: FB, w: '800', col: '#fff' });
  g.restore();
}

// ---------- input ----------
function findBtn(id) { for (let i = U.btns.length - 1; i >= 0; i--) if (U.btns[i].id === id) return U.btns[i]; return null; }
// DECISION (fix 1, phone M1): hits resolve by z-order only when the point is inside a button's drawn shape; in the
//   ≥ 44 px expanded margins the nearest centre wins, so neighbouring small buttons never steal each other's taps.
function hitBtn(x, y) {
  let best = null, bd = Infinity;
  for (let i = U.btns.length - 1; i >= 0; i--) {
    const b = U.btns[i];
    if (!inR(hitOf(b), x, y)) continue;
    if (inR(b, x, y)) return b;
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
// ---------- desktop hover + cursor (fix 1, desktop M2) ----------
let cvsEl = null, curCursor = '';
function setCursor(c) {
  if (c === curCursor) return;
  curCursor = c;
  try {
    if (!cvsEl && typeof document !== 'undefined') cvsEl = document.getElementById('c');
    if (cvsEl) cvsEl.style.cursor = c;
  } catch (e) { /* no DOM */ }
}
function hoverAt(x, y, S) {
  const b = hitBtn(x, y);
  U.hover = b && !b.disabled ? b.id : null;
  let c = U.hover ? 'pointer' : '';
  if (!c && S.screen === 'map' && !U.card) {
    for (const n of U.map.nodes) if (Math.hypot(n.x - x, n.y - y) < n.r + 12 * U.du) { c = n.locked ? 'not-allowed' : 'pointer'; break; }
  }
  if (!c && S.screen === 'play' && !U.card && S.sess && !S.sess.result && api && typeof api.pickStrand === 'function') {
    const id = safe(() => api.pickStrand(x, y), -1);
    if (id >= 0) {
      const sess = S.sess;
      const ok = sess.boosterArm === 'snip' || safe(() => canPull(sess.puz, sess.st, id).ok, false);
      c = ok ? 'pointer' : 'not-allowed';
    }
  }
  setCursor(c || 'default');
}
const hov = b => U.hover === b.id && !b.disabled && !(U.press && U.press.id === b.id);
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
    U.kSw = scr === 'kittens' && !U.card ? { x, y } : null;
    if (scr === 'play') { U.idle = 0; clearHand('idle'); if (U.ghost) U.ghost.loops = 0; teachDismiss(); }
    const b = hitBtn(x, y);
    U.hover = null;
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
    if (U.press) { const b = findBtn(U.press.id), h = hitBtn(x, y); U.press.over = !!b && !!h && h.id === b.id; return true; }
    if (!m.down) hoverAt(x, y, S); // no gesture: mouse hover (desktop)
    return modal;
  }
  if (type === 'up' || type === 'cancel') {
    if (U.drag) { U.drag = null; return true; }
    if (U.kSw && scr === 'kittens') { // ui2: swipe the Kitten Corner album sideways to turn pages
      const dx = x - U.kSw.x, dy = y - U.kSw.y; U.kSw = null;
      if (type === 'up' && Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) { U.press = null; kitTurn(dx < 0 ? 1 : -1, true); return true; }
    }
    if (m.down && scr === 'map') {
      const wasDrag = m.drag, d0 = m.down;
      m.down = null; m.drag = false;
      if (wasDrag) { if (now() - m.last > 80) m.v = 0; U.press = null; return true; }
      if (!d0.btn && type === 'up') { mapTap(x, y); return true; }
    }
    if (U.press) {
      const p = U.press; U.press = null;
      const b = findBtn(p.id), h = hitBtn(x, y);
      if (type === 'up' && b && h && h.id === b.id) press(b);
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
  if (U.how && !(k === 'Escape' || k === 'Esc' || k === 'Enter' || k === ' ' || k === 'Spacebar')) return true; // the card owns the keys
  if (k === 'Escape' || k === 'Esc') {
    if (U.how) { U.how = null; return true; }
    if (U.card) return U.card.type === 'win' || U.card.type === 'lose' || U.after ? true : (nextCard(), true);
    if (scr === 'win' || scr === 'lose') return true;
    if (scr === 'pause') { api.resume(); return true; }
    if (DIALOGS.includes(scr)) { if (U.resetAsk) { U.resetAsk = null; return true; } if (U.reset) { U.reset = 0; return true; } if (scr === 'shop' && U.shop.confirm) { U.shop.confirm = null; return true; } api.go(U.ret); return true; }
    if (scr === 'play') { api.pause(); return true; }
    if (scr === 'map') { api.go('title'); return true; } // fix 1 (desktop m5): Esc on the map goes back to the title
    return false;
  }
  if ((k === 'Enter' || k === ' ' || k === 'Spacebar') && !e.repeat) {
    if (scr === 'play' && !U.card) return false;
    const b = [...U.btns].reverse().find(q => q.primary && !q.disabled);
    if (b) { press(b); return true; }
    return false;
  }
  if (scr === 'kittens' && !U.card && (k === 'ArrowLeft' || k === 'ArrowRight')) { kitTurn(k === 'ArrowRight' ? 1 : -1, true); return true; }
  if (scr === 'map' && !U.card && (k === 'ArrowUp' || k === 'ArrowDown')) {
    const cur = Math.min(LEVELS, safe(() => M.cur(), 1));
    mapSelect(clamp((U.map.sel || 1) + (k === 'ArrowUp' ? 1 : -1), 1, cur));
    return true;
  }
  return false;
}
