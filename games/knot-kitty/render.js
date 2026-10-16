// Knot Kitty: render.js (Art role). Board, yarn, spools, basket, kitten, Kitty, particles, icons.
// Everything is code-drawn (Canvas 2D paths + gradients, never shadowBlur). GDD §7, §13.5.
//
// DECISION: positions in S.sess that the GDD leaves open are read as follows:
//   - sess.rings[].x/y are CSS px (screen space); t0 is S.T when the ring started.
//   - sess.wiggles: Map id -> S.T start; slots[].leaveT / enterT are S.T start times.
//   - sess.parts[].t is age in seconds, life the total; colour p.c is a yarn index or a CSS colour.
//   - a 'ball' flight reads its source basket slot from f.b (falls back to f.from, then f.id);
//     its p (0..1) is progress like strand flights.
//   - Kitty's outfit is S.outfit (Core copies meta's worn outfit there), default 'tabby'.
//   - kitten.flinch: 0..1 intensity set by Core; render also listens to bus 'blocked' and flinches itself.
//   - B.kitten = { x, y, s }: x centre, y = the kitten's feet (ledge top), s = kitten height in px.
//     If layout leaves it out we place it ourselves on the frame's bottom ledge.
//   - Transient visuals the rule state can't express (basket "full" flash, padlock drop, paw lift,
//     ice shatter, kitten loop drop) are tracked here from bus events and state diffs, keyed per session.
// DECISION: the board frame (0.28 unit walnut) is drawn INSIDE layout's B rect (pegs ± 0.6 unit), so the
//   felt shows 0.32 unit around the pegs and nothing leaves the screen at 320 px wide. The kitten sits on a
//   small walnut plank hung under the frame at B.kitten. Strands bake to an offscreen canvas the size of
//   the board only; free (pullable) strands are drawn live on top.
// DECISION: a snipped strand shows a scissors icon at its middle that pops and fades over 0.6 s (snipFx).

import { DUR, RAINBOW, bus } from './consts.js';
import { rackSlots, basketSlots } from './layout.js';

// ------------------------------------------------------------------ palette (§7.2)
export const INK = '#2B2440', CREAM = '#FFF4E4', CREAM_SH = '#E9D3B5';
export const WALNUT = '#6B4329', WALNUT_L = '#9A6A45', WALNUT_D = '#4A2C1A';
export const FELT = '#E8D5BC', FELT_DOT = '#D9C2A3';
export const BRASS = '#E0A93B', BRASS_HI = '#FFE3A1', BRASS_SH = '#9C6B1E';
export const TOMATO = '#E8463A', TOMATO_D = '#B8322A', TEAL = '#1FB0A0', TEAL_D = '#167C71';
export const AMBER = '#FFB23F', GOLD = '#FFC93C', GOLD_D = '#B9811A';
export const FONT_T = '"Lilita One", system-ui, sans-serif', FONT_B = 'Nunito, system-ui, sans-serif';

export const YARN = [
  { base: '#E8463A', name: 'Tomato', glyph: 'dot' },
  { base: '#1FB0A0', name: 'Teal', glyph: 'chevron' },
  { base: '#F5B82E', name: 'Mustard', glyph: 'bars' },
  { base: '#3D86EE', name: 'Sky', glyph: 'rail' },
  { base: '#8C55D3', name: 'Plum', glyph: 'ring' },
  { base: '#86C440', name: 'Lime', glyph: 'cross' },
  { base: '#F5B82E', name: 'Rainbow', glyph: 'sparkle' },
];
const RAIN = [0, 2, 5, 1, 3, 4].map(i => YARN[i].base); // stripe order reads as a rainbow
const MYST = '#B9B2AE';

// ------------------------------------------------------------------ small helpers
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = p => p * p * (3 - 2 * p);
const easeOut = p => 1 - (1 - p) * (1 - p);
const easeOutBack = p => { const c = 1.7; const q = p - 1; return 1 + q * q * ((c + 1) * q + c); };
const hexA = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixCache = new Map();
/** Mix two #rrggbb colours (t = share of h2) with optional alpha. */
export function mix(h1, h2, t, al = 1) {
  const k = h1 + h2 + t + '|' + al;
  let v = mixCache.get(k);
  if (v) return v;
  const a = hexA(h1), b = hexA(h2);
  const r = [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  v = al >= 1 ? '#' + r.map(x => x.toString(16).padStart(2, '0')).join('') : `rgba(${r[0]},${r[1]},${r[2]},${al})`;
  if (mixCache.size > 4000) mixCache.clear();
  mixCache.set(k, v);
  return v;
}
export const alpha = (h, a) => mix(h, h, 0, a);
export function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
export function mkCanvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
/** Deterministic hash noise in [0,1). */
export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function text(g, s, x, y, size, o = {}) {
  g.font = `${o.weight || ''} ${size}px ${o.font || FONT_T}`;
  g.textAlign = o.align || 'center';
  g.textBaseline = o.base || 'middle';
  if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.strokeW || size * 0.2; g.strokeStyle = o.stroke; g.strokeText(s, x, y); }
  g.fillStyle = o.color || CREAM;
  g.fillText(s, x, y);
}

// ------------------------------------------------------------------ colours
const colCache = new Map();
/** Colours for yarn c. dim = covered (22 % toward grey, glyph kept at full contrast). */
export function yarnColor(c, dim) {
  const k = c * 2 + (dim ? 1 : 0);
  let o = colCache.get(k);
  if (o) return o;
  const base = c === RAINBOW ? YARN[RAINBOW].base : c < 0 ? MYST : YARN[c].base;
  const body = dim ? mix(base, '#8F8580', 0.22) : base;
  o = {
    body,
    ply: mix(body, INK, dim ? 0.2 : 0.17),
    hi: dim ? 'rgba(255,255,255,0)' : mix(base, '#FFFFFF', 0.72, 0.9),
    casing: INK,
    glyph: mix(base, INK, 0.45),
    base,
  };
  colCache.set(k, o);
  return o;
}

// ------------------------------------------------------------------ geometry
function arcLen(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}
function pointAt(pts, at, s) {
  const L = at[at.length - 1];
  if (s <= 0) { const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], l = Math.hypot(dx, dy) || 1; return { x: pts[0][0], y: pts[0][1], tx: dx / l, ty: dy / l }; }
  if (s >= L) { const n = pts.length - 1, dx = pts[n][0] - pts[n - 1][0], dy = pts[n][1] - pts[n - 1][1], l = Math.hypot(dx, dy) || 1; return { x: pts[n][0], y: pts[n][1], tx: dx / l, ty: dy / l }; }
  let lo = 0, hi = at.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at[m] <= s) lo = m; else hi = m; }
  const f = (s - at[lo]) / (at[hi] - at[lo] || 1);
  const dx = pts[hi][0] - pts[lo][0], dy = pts[hi][1] - pts[lo][1], l = Math.hypot(dx, dy) || 1;
  return { x: pts[lo][0] + dx * f, y: pts[lo][1] + dy * f, tx: dx / l, ty: dy / l };
}
/** Local copy of the proto strandCurve (render must not import rules.js). */
function curve(pegs, bow = 0) {
  const pts = [], SPU = 9;
  if (pegs.length === 2) {
    const [a, b] = pegs, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const cx = (a[0] + b[0]) / 2 - (dy / len) * bow * len, cy = (a[1] + b[1]) / 2 + (dx / len) * bow * len;
    const n = Math.max(8, Math.ceil(len * SPU));
    for (let k = 0; k <= n; k++) { const t = k / n, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]); }
    return pts;
  }
  const P = pegs.map(p => [p[0], p[1]]);
  const Q = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]]];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const n = Math.max(6, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * SPU));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      pts.push(L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2));
    }
  }
  return pts;
}
function segX(a0, a1, b0, b1) {
  const rx = a1[0] - a0[0], ry = a1[1] - a0[1], qx = b1[0] - b0[0], qy = b1[1] - b0[1];
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-12) return null;
  const wx = b0[0] - a0[0], wy = b0[1] - a0[1];
  const t = (wx * qy - wy * qx) / den, u = (wx * ry - wy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a0[0] + rx * t, a0[1] + ry * t];
}
function crossPts(A, B) {
  const out = [];
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
    const p = segX(A[i], A[i + 1], B[j], B[j + 1]);
    if (p && !out.some(o => Math.hypot(o[0] - p[0], o[1] - p[1]) < 0.15)) out.push(p);
  }
  return out;
}
const polyPath = pts => { const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); return p; };

/** Offset a polyline by d along its left normal. */
function offsetPoly(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    out.push([pts[i][0] - (dy / l) * d, pts[i][1] + (dx / l) * d]);
  }
  return out;
}

/** Glyph shapes appended to Path2Ds. kind per §7.2. (x,y) centre, (tx,ty) unit tangent, s glyph size. */
function glyphInto(kind, fill, stroke, x, y, tx, ty, s) {
  const nx = -ty, ny = tx;
  switch (kind) {
    case 'dot': fill.moveTo(x + s * 0.5, y); fill.arc(x, y, s * 0.5, 0, TAU); break;
    case 'chevron':
      stroke.moveTo(x - tx * s * 0.28 + nx * s * 0.45, y - ty * s * 0.28 + ny * s * 0.45);
      stroke.lineTo(x + tx * s * 0.3, y + ty * s * 0.3);
      stroke.lineTo(x - tx * s * 0.28 - nx * s * 0.45, y - ty * s * 0.28 - ny * s * 0.45); break;
    case 'bars':
      for (const o of [-0.26, 0.26]) {
        stroke.moveTo(x + tx * s * o + nx * s * 0.55, y + ty * s * o + ny * s * 0.55);
        stroke.lineTo(x + tx * s * o - nx * s * 0.55, y + ty * s * o - ny * s * 0.55);
      } break;
    case 'ring': stroke.moveTo(x + s * 0.42, y); stroke.arc(x, y, s * 0.42, 0, TAU); break;
    case 'cross': {
      const a = 0.42;
      stroke.moveTo(x + (tx + nx) * s * a, y + (ty + ny) * s * a); stroke.lineTo(x - (tx + nx) * s * a, y - (ty + ny) * s * a);
      stroke.moveTo(x + (tx - nx) * s * a, y + (ty - ny) * s * a); stroke.lineTo(x - (tx - nx) * s * a, y - (ty - ny) * s * a); break;
    }
    case 'sparkle': {
      const r = s * 0.62, q = s * 0.17;
      fill.moveTo(x, y - r); fill.lineTo(x + q, y - q); fill.lineTo(x + r, y); fill.lineTo(x + q, y + q);
      fill.lineTo(x, y + r); fill.lineTo(x - q, y + q); fill.lineTo(x - r, y); fill.lineTo(x - q, y - q); fill.closePath(); break;
    }
  }
}

/** Screen-space Path2Ds for a polyline strand of width sw and colour c. unitPx = peg spacing. */
function strandPaths(pts, sw, c, unitPx) {
  const at = arcLen(pts), len = at[at.length - 1];
  const path = polyPath(pts);
  // ply: diagonal twist dashes, dash period 0.9 sw
  const ply = new Path2D();
  const step = Math.max(2.5, sw * 0.9), half = sw * 0.5, slant = sw * 0.32;
  for (let s = step * 0.5; s < len; s += step) {
    const p = pointAt(pts, at, s), nx = -p.ty, ny = p.tx;
    ply.moveTo(p.x + nx * half - p.tx * slant, p.y + ny * half - p.ty * slant);
    ply.lineTo(p.x - nx * half + p.tx * slant, p.y - ny * half + p.ty * slant);
  }
  // highlight toward the lamp (upper left)
  const hiPts = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    if (nx * -0.6 + ny * -0.8 < 0) { nx = -nx; ny = -ny; }
    hiPts.push([pts[i][0] + nx * sw * 0.22, pts[i][1] + ny * sw * 0.22]);
  }
  const hi = polyPath(hiPts.slice(1, -1).length > 1 ? hiPts.slice(1, -1) : hiPts);
  // glyphs every 1.1 units, centred on the strand
  const gf = new Path2D(), gs = new Path2D();
  const kind = c === RAINBOW ? 'sparkle' : c >= 0 ? YARN[c].glyph : null;
  const gsz = sw * 0.62;
  const marks = [];
  if (kind && kind !== 'rail') {
    const gap = unitPx * (kind === 'sparkle' ? 2 : 1.1);
    const n = Math.max(1, Math.floor((len - unitPx * 0.5) / gap) + 1);
    const s0 = (len - (n - 1) * gap) / 2;
    for (let k = 0; k < n; k++) { const p = pointAt(pts, at, s0 + k * gap); glyphInto(kind, gf, gs, p.x, p.y, p.tx, p.ty, gsz); }
  }
  // '?' stitch marks for mystery yarn
  { const gap = unitPx * 1.1, n = Math.max(1, Math.floor((len - unitPx * 0.5) / gap) + 1), s0 = (len - (n - 1) * gap) / 2;
    for (let k = 0; k < n; k++) { const p = pointAt(pts, at, s0 + k * gap); marks.push([p.x, p.y]); } }
  let rail = null;
  if (kind === 'rail' && len > sw) {
    rail = new Path2D();
    const s0 = Math.min(len * 0.2, sw * 0.9), s1 = len - s0;
    const sub = [];
    for (let s = s0; s < s1; s += Math.max(2, sw * 0.5)) { const p = pointAt(pts, at, s); sub.push([p.x, p.y]); }
    if (sub.length > 1) for (const o of [-0.24, 0.24]) {
      const op = offsetPoly(sub, sw * o);
      rail.moveTo(op[0][0], op[0][1]);
      for (let i = 1; i < op.length; i++) rail.lineTo(op[i][0], op[i][1]);
    }
  }
  return { pts, at, len, path, ply, hi, gf, gs, rail, marks };
}

/**
 * buildGeo(puz, B) → geo[] in CSS px. Each item: { pts, at, len, path, ply, hi, gf, gs, rail, marks,
 * pegs:[[x,y]], gaps:[[x,y]] (crossings where this strand is on top), c, d }.
 */
export function buildGeo(puz, B) {
  const u = B.unit, sw = B.sw || clamp(0.27 * u, 6.5, 22);
  const geo = puz.strands.map(s => {
    const src = s.pts || curve(s.pegs, s.bow || 0);
    const pts = src.map(p => [B.ox + p[0] * u, B.oy + p[1] * u]);
    const o = strandPaths(pts, sw, s.c, u);
    o.pegs = s.pegs.map(p => [B.ox + p[0] * u, B.oy + p[1] * u]);
    o.c = s.c; o.d = s.d; o.gaps = []; o.sw = sw;
    return o;
  });
  if (puz.crossings) for (const x of puz.crossings) geo[x.top] && geo[x.top].gaps.push([B.ox + x.x * u, B.oy + x.y * u]);
  geo.B = B;
  return geo;
}

// ------------------------------------------------------------------ glyph + strand
/** A glyph stamp (spool labels, basket balls, legend). size = overall glyph height. */
export function drawGlyph(g, c, x, y, size, ang = 0) {
  const kind = c === RAINBOW ? 'sparkle' : c >= 0 && YARN[c] ? YARN[c].glyph : null;
  if (!kind) return;
  const col = c === RAINBOW ? CREAM : mix(YARN[c].base, INK, 0.45);
  const tx = Math.cos(ang), ty = Math.sin(ang);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'rail') {
    g.strokeStyle = col; g.lineWidth = Math.max(1.2, size * 0.16);
    g.beginPath();
    for (const o of [-0.22, 0.22]) { g.moveTo(x - tx * size * 0.5 - ty * size * o, y - ty * size * 0.5 + tx * size * o); g.lineTo(x + tx * size * 0.5 - ty * size * o, y + ty * size * 0.5 + tx * size * o); }
    g.stroke();
    return;
  }
  const f = new Path2D(), s = new Path2D();
  glyphInto(kind, f, s, x, y, tx, ty, size);
  g.fillStyle = col; g.fill(f);
  if (kind === 'sparkle') { g.strokeStyle = INK; g.lineWidth = Math.max(1, size * 0.08); g.stroke(f); }
  g.strokeStyle = col; g.lineWidth = Math.max(1.2, size * 0.17); g.stroke(s);
}

let feltPattern = null; // pattern of the board bake: the felt gap at under-crossings shows real felt

/**
 * drawStrand(g, geoItem, c, sw, opt) opt { dim, lift (0..2), wiggleT (s since wiggle start), mystery,
 * rainbow, glow (0..1 cream glow, free strands), hint (gold rim 0..1), reveal (0..1), gap (default true),
 * dx, dy, noShadow }.
 */
export function drawStrand(g, gi, c, sw, opt = {}) {
  const lift = opt.lift || 0;
  let dx = opt.dx || 0, dy = opt.dy || 0;
  if (opt.wiggleT != null && opt.wiggleT < DUR.wiggle) {
    const a = opt.wiggleT, p0 = gi.pts[0], p1 = gi.pts[gi.pts.length - 1];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const amp = Math.sin(a * 55) * sw * 0.45 * (1 - a / DUR.wiggle);
    dx += (-(p1[1] - p0[1]) / l) * amp; dy += ((p1[0] - p0[0]) / l) * amp;
  }
  const myst = !!opt.mystery;
  const rainbow = c === RAINBOW && !myst;
  const col = yarnColor(myst ? -1 : rainbow ? RAINBOW : c, !!opt.dim);
  g.save();
  if (dx || dy) g.translate(dx, dy);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // (0) felt gap where this strand passes over another one: cuts the lower strand visibly
  if (opt.gap !== false && gi.gaps && gi.gaps.length) {
    const R = (gi.B ? gi.B.unit : sw / 0.27) * 0.45;
    g.save();
    g.beginPath();
    for (const p of gi.gaps) { g.moveTo(p[0] + R, p[1]); g.arc(p[0], p[1], R, 0, TAU); }
    g.clip();
    g.strokeStyle = feltPattern && !opt.noPattern ? feltPattern : FELT;
    g.lineWidth = sw + 6.5;
    g.stroke(gi.path);
    g.restore();
  }
  // (1) contact shadow, doubled when lifted
  if (!opt.noShadow) {
    const k = 1 + lift;
    g.save();
    g.translate(1.5 * k, 2.5 * k);
    g.strokeStyle = `rgba(43,36,64,${0.3 - lift * 0.04})`;
    g.lineWidth = sw + 3 + lift;
    g.stroke(gi.path);
    g.restore();
  }
  if (opt.hint) {
    g.strokeStyle = alpha(GOLD, 0.55 + 0.45 * opt.hint);
    g.lineWidth = sw + 10;
    g.stroke(gi.path);
  }
  if (opt.flash) {
    g.strokeStyle = `rgba(255,255,255,${opt.flash})`;
    g.lineWidth = sw + 10;
    g.stroke(gi.path);
  }
  if (opt.glow) {
    g.strokeStyle = `rgba(255,244,228,${0.5 * opt.glow})`;
    g.lineWidth = sw + 6;
    g.stroke(gi.path);
  }
  // (2) casing
  g.strokeStyle = col.casing;
  g.lineWidth = sw + 2.5;
  g.stroke(gi.path);
  // (3) body
  if (rainbow) {
    const seg = gi.B ? gi.B.unit : sw * 3.7;
    g.lineCap = 'butt';
    g.lineWidth = sw;
    for (let k = 0; k < 6; k++) {
      g.strokeStyle = opt.dim ? mix(RAIN[k], '#8F8580', 0.22) : RAIN[k];
      g.setLineDash([seg, seg * 5]);
      g.lineDashOffset = -k * seg;
      g.stroke(gi.path);
    }
    g.setLineDash([]);
    g.lineCap = 'round';
  } else {
    g.strokeStyle = col.body;
    g.lineWidth = sw;
    g.stroke(gi.path);
  }
  if (opt.reveal != null && opt.reveal < 1 && myst === false) {
    // colour fills in from the middle (mystery reveal): grey wool sliding off both ends
    const m = yarnColor(-1, false), half = gi.len * 0.5 * (1 - ease(opt.reveal));
    g.strokeStyle = m.body; g.lineWidth = sw;
    g.lineCap = 'butt';
    g.setLineDash([half, gi.len - 2 * half + 0.01, half + 1]);
    g.stroke(gi.path);
    g.setLineDash([]);
    g.lineCap = 'round';
  }
  // (4) ply twist
  g.strokeStyle = rainbow ? 'rgba(43,36,64,0.16)' : col.ply;
  g.lineWidth = Math.max(0.8, sw * 0.32);
  g.lineCap = 'butt';
  g.save();
  g.globalAlpha = 0.55;
  g.stroke(gi.ply);
  g.restore();
  g.lineCap = 'round';
  // (5) glyphs, (5b) mystery marks
  if (myst) {
    g.fillStyle = mix(MYST, INK, 0.5);
    g.font = `900 ${Math.round(sw * 0.95)}px ${FONT_B}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of gi.marks) g.fillText('?', p[0], p[1] + sw * 0.04);
  } else if (rainbow) {
    g.fillStyle = CREAM; g.fill(gi.gf);
    g.strokeStyle = INK; g.lineWidth = Math.max(0.8, sw * 0.08); g.stroke(gi.gf);
  } else {
    g.fillStyle = col.glyph; g.fill(gi.gf);
    g.strokeStyle = col.glyph; g.lineWidth = Math.max(1.1, sw * 0.13);
    g.stroke(gi.gs);
    if (gi.rail) { g.lineWidth = Math.max(1, sw * 0.12); g.stroke(gi.rail); }
  }
  // (6) highlight on the light side (free strands only)
  if (!opt.dim) {
    g.strokeStyle = col.hi;
    g.lineWidth = Math.max(0.8, sw * 0.18);
    g.stroke(gi.hi);
  }
  g.restore();
}

// ------------------------------------------------------------------ pegs + board
export function drawPeg(g, x, y, r) {
  g.fillStyle = 'rgba(43,36,64,0.32)';
  g.beginPath(); g.arc(x + r * 0.22, y + r * 0.38, r, 0, TAU); g.fill();
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  gr.addColorStop(0, BRASS_HI); gr.addColorStop(0.45, BRASS); gr.addColorStop(1, BRASS_SH);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.38, r * 0.24, 0, TAU); g.fill();
}
/** Pegs + end loops of one strand (loop = small ring in the strand colour around end pegs). */
function drawStrandPegs(g, gi, c, sw, r, dim, dx = 0, dy = 0, myst = false) {
  const col = yarnColor(myst ? -1 : c === RAINBOW ? RAINBOW : c, dim);
  const n = gi.pegs.length;
  for (let k = 0; k < n; k++) {
    const p = gi.pegs[k], x = p[0] + dx, y = p[1] + dy;
    if (k === 0 || k === n - 1) {
      const lr = r + sw * 0.32;
      g.lineWidth = sw * 0.42 + 2.5; g.strokeStyle = INK;
      g.beginPath(); g.arc(x, y, lr, 0, TAU); g.stroke();
      g.lineWidth = sw * 0.42; g.strokeStyle = c === RAINBOW && !myst ? RAIN[k % 6] : col.body;
      g.stroke();
    }
    drawPeg(g, x, y, r);
  }
}

/** Shape templates for boss boards in peg space (§4.4): returns a Path2D in screen px. */
function shapePath(shape, B, cols, rows) {
  const u = B.unit, cx = B.ox + (cols - 1) * u / 2, cy = B.oy + (rows - 1) * u / 2;
  const rx = (cols - 1 + 0.7) * u / 2, ry = (rows - 1 + 0.7) * u / 2;
  const p = new Path2D();
  switch (shape) {
    case 'pumpkin': {
      const ex = rx * 0.98, ey = ry * 0.84, oy = cy + ry * 0.1;
      p.ellipse(cx, oy, ex, ey, 0, 0, TAU);
      p.moveTo(cx - u * 0.35, oy - ey + u * 0.1); p.lineTo(cx - u * 0.25, cy - ry); p.lineTo(cx + u * 0.3, cy - ry - u * 0.1); p.lineTo(cx + u * 0.35, oy - ey + u * 0.1); p.closePath();
      break;
    }
    case 'cathead': {
      const r = Math.min(rx, ry * 0.85), oy = cy + ry - r;
      p.arc(cx, oy, r, 0, TAU);
      p.moveTo(cx - r * 0.95, oy - r * 0.2); p.lineTo(cx - r * 0.8, cy - ry); p.lineTo(cx - r * 0.2, oy - r * 0.92); p.closePath();
      p.moveTo(cx + r * 0.95, oy - r * 0.2); p.lineTo(cx + r * 0.8, cy - ry); p.lineTo(cx + r * 0.2, oy - r * 0.92); p.closePath();
      break;
    }
    case 'heart': {
      const s = Math.min(rx, ry);
      p.moveTo(cx, cy + ry);
      p.bezierCurveTo(cx - rx * 1.25, cy + ry * 0.1, cx - rx * 1.05, cy - ry * 1.15, cx, cy - ry * 0.45);
      p.bezierCurveTo(cx + rx * 1.05, cy - ry * 1.15, cx + rx * 1.25, cy + ry * 0.1, cx, cy + ry);
      p.closePath();
      void s;
      break;
    }
    case 'moon': {
      const r = Math.min(rx, ry);
      p.arc(cx, cy, r, Math.PI * 0.32, Math.PI * 1.68);
      p.arc(cx + r * 0.55, cy - r * 0.05, r * 0.72, Math.PI * 1.5, Math.PI * 0.5, true);
      p.closePath();
      break;
    }
    case 'star': {
      const r = Math.min(rx, ry) * 1.05;
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.5 : r; p[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * q, cy + 0.08 * r + Math.sin(a) * q); }
      p.closePath();
      break;
    }
    case 'kitten': {
      const hr = Math.min(rx * 0.7, ry * 0.42), hy = cy - ry + hr * 1.35;
      p.arc(cx, hy, hr, 0, TAU);
      p.moveTo(cx - hr * 0.95, hy - hr * 0.2); p.lineTo(cx - hr * 0.8, hy - hr * 1.3); p.lineTo(cx - hr * 0.2, hy - hr * 0.92); p.closePath();
      p.moveTo(cx + hr * 0.95, hy - hr * 0.2); p.lineTo(cx + hr * 0.8, hy - hr * 1.3); p.lineTo(cx + hr * 0.2, hy - hr * 0.92); p.closePath();
      p.ellipse(cx, cy + ry * 0.35, rx * 0.9, ry * 0.62, 0, 0, TAU);
      break;
    }
    default: return null;
  }
  return p;
}

/** Board geometry derived from B (layout's frame rect B.x/y/w/h = pegs ± 0.6 unit; frame drawn inside it). */
function boardBox(B, cols, rows) {
  const u = B.unit;
  const ox = B.x != null ? B.x : B.ox - 0.6 * u, oy = B.y != null ? B.y : B.oy - 0.6 * u;
  const ow = B.w != null ? B.w : (cols - 1 + 1.2) * u, oh = B.h != null ? B.h : (rows - 1 + 1.2) * u;
  const fr = Math.max(4, u * 0.28);
  const kit = B.kitten && B.kitten.s ? B.kitten : { x: ox + ow / 2, y: oy + oh + 1.25 * u, s: u * 1.6 };
  return { ox, oy, ow, oh, fx: ox + fr, fy: oy + fr, fw: ow - 2 * fr, fh: oh - 2 * fr, fr, u, kit, ledgeH: Math.max(5, u * 0.2) };
}

function drawBoardStatic(g, B, cols, rows, shape) {
  const bb = boardBox(B, cols, rows), { fx, fy, fw, fh, fr, u, ox, oy, ow, oh } = bb;
  const rad = fr * 1.5;
  // soft drop shadow (stacked offset fills, no blur)
  for (let i = 3; i >= 1; i--) {
    g.fillStyle = `rgba(30,14,20,${0.09})`;
    rr(g, ox + i * 2.2, oy + i * 3.2, ow, oh, rad + i * 2);
    g.fill();
  }
  // walnut frame with grain
  const wg = g.createLinearGradient(ox, oy, ox + ow * 0.3, oy + oh);
  wg.addColorStop(0, WALNUT_L); wg.addColorStop(0.45, WALNUT); wg.addColorStop(1, WALNUT_D);
  g.fillStyle = wg;
  rr(g, ox, oy, ow, oh, rad); g.fill();
  g.save();
  rr(g, ox, oy, ow, oh, rad); g.clip();
  g.strokeStyle = 'rgba(40,20,10,0.22)';
  g.lineWidth = Math.max(0.8, fr * 0.06);
  for (let i = 0; i < 26; i++) {
    const y0 = oy + (i + 0.5) * oh / 26 + (hash(i, 7) - 0.5) * fr * 0.4;
    g.beginPath(); g.moveTo(ox, y0);
    for (let x = ox; x <= ox + ow; x += fr * 1.2) g.lineTo(x, y0 + Math.sin(x * 0.03 + i) * fr * 0.18);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,220,170,0.12)';
  for (let i = 0; i < 12; i++) { const x0 = ox + hash(i, 3) * ow; g.beginPath(); g.moveTo(x0, oy); g.lineTo(x0 + fr * 0.4, oy + fr); g.stroke(); }
  g.restore();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.5, u * 0.05);
  rr(g, ox, oy, ow, oh, rad); g.stroke();
  // bevel highlight
  g.strokeStyle = 'rgba(255,226,180,0.4)'; g.lineWidth = Math.max(1, fr * 0.12);
  rr(g, ox + fr * 0.18, oy + fr * 0.18, ow - fr * 0.36, oh - fr * 0.36, rad * 0.85); g.stroke();
  // felt
  const fg = g.createRadialGradient(fx + fw * 0.35, fy + fh * 0.25, 0, fx + fw * 0.5, fy + fh * 0.5, Math.max(fw, fh) * 0.8);
  fg.addColorStop(0, '#F3E4CF'); fg.addColorStop(0.6, FELT); fg.addColorStop(1, '#DCC5A6');
  g.fillStyle = fg;
  rr(g, fx, fy, fw, fh, fr * 0.6); g.fill();
  g.save();
  rr(g, fx, fy, fw, fh, fr * 0.6); g.clip();
  // felt noise specks
  for (let i = 0; i < (fw * fh) / 90; i++) {
    const x = fx + hash(i, 11) * fw, y = fy + hash(i, 12) * fh;
    g.fillStyle = hash(i, 13) > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(120,80,40,0.08)';
    g.fillRect(x, y, 1.2, 1.2);
  }
  // boss silhouette patch
  const sp = shape ? shapePath(shape, B, cols, rows) : null;
  if (sp) {
    g.fillStyle = '#F1E2CB'; g.fill(sp);
    g.setLineDash([u * 0.16, u * 0.12]);
    g.strokeStyle = mix('#C9A57E', INK, 0.1); g.lineWidth = Math.max(1.2, u * 0.05);
    g.stroke(sp);
    g.setLineDash([]);
  }
  // felt dots every 0.5 unit
  g.fillStyle = FELT_DOT;
  const r = Math.max(1, u * 0.03);
  for (let i = 0; i <= (cols - 1) * 2; i++) for (let j = 0; j <= (rows - 1) * 2; j++) {
    g.beginPath(); g.arc(B.ox + i * u / 2, B.oy + j * u / 2, i % 2 || j % 2 ? r : r * 1.6, 0, TAU); g.fill();
  }
  // inner shadow under the frame's top lip
  const ig = g.createLinearGradient(0, fy, 0, fy + fr * 1.4);
  ig.addColorStop(0, 'rgba(70,35,15,0.25)'); ig.addColorStop(1, 'rgba(70,35,15,0)');
  g.fillStyle = ig; g.fillRect(fx, fy, fw, fr * 1.4);
  g.restore();
  // stitched border inside the felt
  g.setLineDash([u * 0.14, u * 0.1]);
  g.strokeStyle = 'rgba(160,120,80,0.45)'; g.lineWidth = Math.max(1, u * 0.035);
  rr(g, fx + u * 0.16, fy + u * 0.16, fw - u * 0.32, fh - u * 0.32, fr * 0.4); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(43,36,64,0.5)'; g.lineWidth = 1;
  rr(g, fx, fy, fw, fh, fr * 0.6); g.stroke();
  // kitten ledge: a little wooden shelf on two brackets hanging under the frame
  const lw = Math.min(ow * 0.7, Math.max(u * 3, bb.kit.s * 2.3)), lx = bb.kit.x - lw / 2, lh = bb.ledgeH;
  const ly = bb.kit.y - lh * 0.25, top = oy + oh - fr * 0.4;
  g.lineWidth = Math.max(1.5, u * 0.05);
  for (const sd of [-1, 1]) {
    const bx = bb.kit.x + sd * lw * 0.36, bw2 = Math.max(3, u * 0.12);
    g.fillStyle = 'rgba(30,14,20,0.25)'; g.fillRect(bx - bw2 / 2 + 2, top, bw2, ly - top + 3);
    g.fillStyle = WALNUT_D; g.fillRect(bx - bw2 / 2, top, bw2, ly - top + 1);
    g.strokeStyle = INK; g.strokeRect(bx - bw2 / 2, top, bw2, ly - top + 1);
    g.fillStyle = BRASS; g.beginPath(); g.arc(bx, top + Math.max(3, u * 0.12), Math.max(1.5, u * 0.045), 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(30,14,20,0.28)';
  rr(g, lx + 3, ly + 5, lw, lh, lh * 0.45); g.fill();
  const lg = g.createLinearGradient(0, ly, 0, ly + lh);
  lg.addColorStop(0, '#B07A4E'); lg.addColorStop(0.5, WALNUT); lg.addColorStop(1, WALNUT_D);
  g.fillStyle = lg;
  rr(g, lx, ly, lw, lh, lh * 0.45); g.fill();
  g.strokeStyle = INK; g.stroke();
  g.fillStyle = 'rgba(255,226,180,0.4)';
  rr(g, lx + lh * 0.4, ly + lh * 0.16, lw - lh * 0.8, lh * 0.18, lh * 0.09); g.fill();
}

// ------------------------------------------------------------------ twist props
function drawKnotBead(g, x, y, r) {
  g.fillStyle = 'rgba(43,36,64,0.3)';
  g.beginPath(); g.arc(x + r * 0.15, y + r * 0.25, r, 0, TAU); g.fill();
  g.fillStyle = CREAM; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.save(); g.clip();
  g.strokeStyle = CREAM_SH; g.lineWidth = Math.max(1, r * 0.2);
  for (let k = -1; k <= 1; k++) { g.beginPath(); g.ellipse(x + k * r * 0.45, y, r * 0.28, r * 1.2, 0.6, 0, TAU); g.stroke(); }
  g.restore();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.4, r * 0.16);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.38, r * 0.2, 0, TAU); g.fill();
}
function lockShape(g, k, x, y, s) {
  g.beginPath();
  if (k % 3 === 0) g.arc(x, y, s, 0, TAU);
  else if (k % 3 === 1) { g.moveTo(x, y - s * 1.1); g.lineTo(x + s * 1.05, y + s * 0.8); g.lineTo(x - s * 1.05, y + s * 0.8); g.closePath(); }
  else g.rect(x - s * 0.9, y - s * 0.9, s * 1.8, s * 1.8);
}
export function drawPadlock(g, x, y, s, k = 0, open = 0) {
  // s = body width
  const bw = s, bh = s * 0.8, sh = s * 0.36;
  g.save(); g.translate(x, y);
  g.lineCap = 'round';
  // shackle
  g.strokeStyle = INK; g.lineWidth = s * 0.26;
  g.beginPath(); g.arc(0, -bh * 0.35 - open * s * 0.35, bw * 0.3, Math.PI, open ? Math.PI * 1.75 : TAU); g.stroke();
  g.strokeStyle = '#B8C0C8'; g.lineWidth = s * 0.14; g.stroke();
  g.fillStyle = 'rgba(43,36,64,0.3)'; rr(g, -bw / 2 + s * 0.06, -bh * 0.35 + s * 0.1, bw, bh, s * 0.16); g.fill();
  const gr = g.createLinearGradient(0, -bh * 0.35, 0, bh * 0.65);
  gr.addColorStop(0, BRASS_HI); gr.addColorStop(0.5, BRASS); gr.addColorStop(1, BRASS_SH);
  g.fillStyle = gr; rr(g, -bw / 2, -bh * 0.35, bw, bh, s * 0.16); g.fill();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.2, s * 0.08); g.stroke();
  g.fillStyle = INK; lockShape(g, k, 0, bh * 0.12, s * 0.17); g.fill();
  void sh;
  g.restore();
}
export function drawKeyCharm(g, x, y, s, k = 0, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot - 0.5);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const bow = s * 0.34;
  g.fillStyle = 'rgba(43,36,64,0.3)'; g.beginPath(); g.arc(s * 0.06, s * 0.08, bow, 0, TAU); g.fill();
  // blade
  g.strokeStyle = INK; g.lineWidth = s * 0.24;
  g.beginPath(); g.moveTo(bow * 0.6, 0); g.lineTo(s * 1.0, 0); g.moveTo(s * 0.82, 0); g.lineTo(s * 0.82, s * 0.2); g.moveTo(s * 0.98, 0); g.lineTo(s * 0.98, s * 0.24); g.stroke();
  g.strokeStyle = BRASS; g.lineWidth = s * 0.12; g.stroke();
  // bow (ring) with shape stamp
  g.fillStyle = BRASS; g.beginPath(); g.arc(0, 0, bow, 0, TAU); g.fill();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.2, s * 0.08); g.stroke();
  g.fillStyle = INK; lockShape(g, k, 0, 0, bow * 0.42); g.fill();
  g.restore();
}
function drawPaw(g, x, y, s, n, t, lift = 0, twitch = 0) {
  g.save();
  g.translate(x, y - lift * s * 1.2);
  g.globalAlpha = 1 - lift;
  g.rotate(-0.5 + Math.sin(twitch * 40) * 0.12 * (twitch > 0 ? 1 : 0));
  const breathe = 1 + Math.sin(t * 1.6) * 0.03;
  g.scale(breathe, breathe);
  // fluffy forearm coming in from the side
  g.fillStyle = '#F29B4B'; g.strokeStyle = INK; g.lineWidth = Math.max(1.4, s * 0.08);
  g.beginPath(); g.ellipse(-s * 0.7, -s * 0.05, s * 0.75, s * 0.42, 0, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(0, 0, s * 0.5, s * 0.42, 0, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = '#C96B26'; g.lineWidth = s * 0.07;
  for (const k of [-1.0, -0.7]) { g.beginPath(); g.moveTo(k * s, -s * 0.35); g.lineTo(k * s + s * 0.1, s * 0.3); g.stroke(); }
  g.fillStyle = '#F7A9A0';
  for (const k of [-1, 0, 1]) { g.beginPath(); g.ellipse(s * 0.24, k * s * 0.2, s * 0.09, s * 0.07, 0, 0, TAU); g.fill(); }
  g.restore();
  if (lift < 1 && n > 0) {
    // number bubble
    const bx = x + s * 0.55, by = y - s * 0.75, br = s * 0.38 * (1 + Math.max(0, twitch > 0 ? Math.sin(twitch * 25) * 0.25 : 0));
    g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = Math.max(1.4, s * 0.08);
    g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill(); g.stroke();
    text(g, String(n), bx, by + br * 0.06, br * 1.25, { color: INK });
    // zz
    const z = (t * 0.6) % 1;
    g.globalAlpha = 1 - z;
    text(g, 'z', x - s * 0.2 + z * s * 0.4, y - s * 0.6 - z * s * 0.6, s * 0.38, { color: CREAM, stroke: INK, strokeW: s * 0.08 });
    g.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ spool + ball
/**
 * drawSpool(g, x, y, h, c, shown, n, opt) — (x,y) centre, h height. Fill is exactly proportional:
 * round(16·shown/n) yarn bands (§7.3). opt { spin, bounce, alpha, scale, rot, pips (default true),
 * label (default true), want (0..1 soft halo), ghost }.
 */
export function drawSpool(g, x, y, h, c, shown, n = 3, opt = {}) {
  const jumbo = n > 3;
  // A jumbo is drawn 1.4× taller (layout.js), standing on the same shelf line (bottom edge fixed).
  const H = jumbo ? h * 1.4 : h;
  const w = h * (jumbo ? 0.78 : 0.68), fl = H * (jumbo ? 0.1 : 0.12), core = w * 0.5, coreH = H - fl * 2;
  const col = c >= 0 && YARN[c] ? YARN[c].base : '#BBB';
  g.save();
  g.translate(x, y - (H - h) / 2 * (opt.scale || 1));
  if (opt.rot) g.rotate(opt.rot);
  if (opt.scale && opt.scale !== 1) g.scale(opt.scale, opt.scale);
  if (opt.alpha != null) g.globalAlpha *= opt.alpha;
  const b = opt.bounce || 0;
  g.scale(1 + b * 0.08, 1 - b * 0.06);
  if (opt.want) {
    g.fillStyle = `rgba(255,244,228,${0.3 * opt.want})`;
    g.beginPath(); g.ellipse(0, 0, w * 0.85, H * 0.65, 0, 0, TAU); g.fill();
  }
  // floor shadow
  g.fillStyle = 'rgba(30,14,20,0.28)';
  g.beginPath(); g.ellipse(w * 0.06, H * 0.5 + fl * 0.15, w * 0.56, fl * 0.5, 0, 0, TAU); g.fill();
  // wooden core
  const cg = g.createLinearGradient(-core / 2, 0, core / 2, 0);
  cg.addColorStop(0, '#C79A6B'); cg.addColorStop(0.35, '#EBCB9D'); cg.addColorStop(1, '#A87C50');
  g.fillStyle = cg;
  g.fillRect(-core / 2, -H / 2 + fl * 0.5, core, H - fl);
  // the empty core is tinted with its colour so even an empty spool says what it wants
  g.fillStyle = mix(col, '#FFFFFF', 0.5, 0.55);
  g.fillRect(-core / 2, -H / 2 + fl, core, coreH);
  g.strokeStyle = mix(col, INK, 0.25); g.lineWidth = 1; g.setLineDash([2.5, 2.5]);
  g.strokeRect(-core / 2 + 1.5, -H / 2 + fl + 1.5, core - 3, coreH - 3);
  g.setLineDash([]);
  // wound bands from the bottom up
  const total = 16, bands = Math.round(total * clamp(shown, 0, n) / n);
  if (bands > 0) {
    const bh = coreH / total, top = H / 2 - fl - bands * bh;
    const bulge = (w - core) * 0.42;
    const ww = core + bulge * Math.min(1, 0.35 + bands / total);
    g.save();
    g.beginPath(); g.rect(-ww / 2 - 2, top, ww + 4, bands * bh); g.clip();
    rr(g, -ww / 2, top, ww, bands * bh, Math.min(bh * 1.2, ww * 0.2));
    g.fillStyle = col; g.fill();
    g.strokeStyle = mix(col, INK, 0.35); g.lineWidth = Math.max(0.8, bh * 0.32);
    const off = ((opt.spin || 0) * bh * 4) % (bh * 2);
    for (let yy = top - bh * 2 + off; yy < H / 2; yy += bh) {
      g.beginPath(); g.moveTo(-ww / 2, yy); g.quadraticCurveTo(0, yy + bh * 0.7, ww / 2, yy + bh * 0.15); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(-ww / 2 + ww * 0.14, top, ww * 0.12, bands * bh);
    g.fillStyle = 'rgba(43,36,64,0.18)'; g.fillRect(ww / 2 - ww * 0.2, top, ww * 0.2, bands * bh);
    g.restore();
    g.strokeStyle = INK; g.lineWidth = 1.4;
    rr(g, -ww / 2, top, ww, bands * bh, Math.min(bh * 1.2, ww * 0.2)); g.stroke();
  }
  // flanges
  for (const fy of [-H / 2, H / 2 - fl]) {
    const fg = g.createLinearGradient(0, fy, 0, fy + fl);
    if (jumbo) { fg.addColorStop(0, BRASS_HI); fg.addColorStop(0.5, BRASS); fg.addColorStop(1, BRASS_SH); }
    else { fg.addColorStop(0, WALNUT_L); fg.addColorStop(1, WALNUT_D); }
    g.fillStyle = fg;
    rr(g, -w / 2, fy, w, fl, fl * 0.45); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = 'rgba(255,240,210,0.35)';
    rr(g, -w / 2 + fl * 0.4, fy + fl * 0.16, w - fl * 0.8, fl * 0.2, fl * 0.1); g.fill();
  }
  // label disc with glyph on the top flange
  if (opt.label !== false) {
    const lr = Math.max(5, w * 0.24), ly = -H / 2 - lr * 0.15;
    g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 1.4;
    g.beginPath(); g.arc(0, ly, lr, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = col; g.lineWidth = lr * 0.26;
    g.beginPath(); g.arc(0, ly, lr * 0.74, 0, TAU); g.stroke();
    drawGlyph(g, c, 0, ly, lr * 0.95, 0);
  }
  g.restore();
  // fill pips under the spool
  if (opt.pips !== false) {
    const s = (opt.scale || 1);
    const pr = Math.max(2.2, h * 0.05) * s, gap = pr * 2.7;
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * gap, py = y + (H / 2) * s + pr * 2.4;
      g.beginPath(); g.arc(px, py, pr, 0, TAU);
      g.fillStyle = i < shown ? col : 'rgba(255,244,228,0.6)';
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
    }
  }
}

/** Yarn ball with wrap lines + glyph. opt { bounce, alpha, dim, glyph (default true) }. */
export function drawBall(g, x, y, r, c, opt = {}) {
  const rainbow = c === RAINBOW;
  const col = rainbow ? '#F5B82E' : c >= 0 ? YARN[c].base : MYST;
  g.save();
  g.translate(x, y);
  if (opt.alpha != null) g.globalAlpha *= opt.alpha;
  const b = opt.bounce || 0;
  g.scale(1 + b * 0.15, 1 - b * 0.15);
  g.fillStyle = 'rgba(30,14,20,0.28)';
  g.beginPath(); g.ellipse(r * 0.12, r * 0.92, r * 0.88, r * 0.26, 0, 0, TAU); g.fill();
  g.fillStyle = col;
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
  if (rainbow) for (let k = 0; k < 6; k++) { g.fillStyle = RAIN[k]; g.fillRect(-r + k * r / 3, -r, r / 3 + 0.5, r * 2); }
  g.strokeStyle = rainbow ? 'rgba(43,36,64,0.3)' : mix(col, INK, 0.3);
  g.lineWidth = Math.max(1, r * 0.11);
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(k * r * 0.34, 0, r * 0.26, r * 1.15, 0.55, 0, TAU); g.stroke(); }
  g.strokeStyle = rainbow ? 'rgba(255,255,255,0.35)' : mix(col, '#FFFFFF', 0.3, 0.6);
  g.beginPath(); g.ellipse(0, 0, r * 1.0, r * 0.35, -0.5, 0, TAU); g.stroke();
  const sh = g.createRadialGradient(-r * 0.35, -r * 0.4, 0, 0, 0, r * 1.05);
  sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(43,36,64,0.3)');
  g.fillStyle = sh; g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.3, r * 0.09);
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  // loose tail
  g.strokeStyle = INK; g.lineWidth = Math.max(2, r * 0.22); g.lineCap = 'round';
  g.beginPath(); g.moveTo(r * 0.7, r * 0.6); g.quadraticCurveTo(r * 1.2, r * 0.9, r * 1.35, r * 0.6); g.stroke();
  g.strokeStyle = col; g.lineWidth = Math.max(1, r * 0.12); g.stroke();
  if (opt.glyph !== false) {
    g.fillStyle = 'rgba(255,244,228,0.88)';
    g.beginPath(); g.arc(0, 0, r * 0.42, 0, TAU); g.fill();
    drawGlyph(g, c, 0, 0, r * 0.52, 0);
  }
  g.restore();
}

// ------------------------------------------------------------------ cats (shared by kitten, Kitty, scene cats)
const BREEDS = ['tabby', 'tuxedo', 'calico', 'siamese', 'black', 'ginger'];
const EYES = ['#7BC043', '#F2B134', '#5AA9E6', '#E07B39', '#9BD27A'];
const COLLARS = ['#E8463A', '#1FB0A0', '#3D86EE', '#8C55D3', '#F5B82E', '#86C440', '#F07AAE', '#2B2440', '#FF8A3D', '#4FC3D9'];
/** Coat palette for breed/coat variant (60 kittens). */
export function coatOf(breed, coat = 0, golden = false) {
  const v = (coat % 10) / 10, sh = (coat % 3) * 0.06;
  let o;
  switch (BREEDS[breed % 6]) {
    case 'tabby': o = { fur: mix('#B9A48C', '#9C8B7A', sh * 2), stripe: '#6F5D4C', belly: '#F2E7D8', pattern: 'tabby' }; break;
    case 'tuxedo': o = { fur: mix('#3E3949', '#2E2A38', sh * 2), stripe: '#2B2440', belly: '#FBF6EE', pattern: 'tux', line: '#17131F' }; break;
    case 'calico': o = { fur: '#FBF4EA', patch: mix('#F0A050', '#E58A3A', sh * 2), patch2: '#3E3949', belly: '#FFFFFF', pattern: 'calico' }; break;
    case 'siamese': o = { fur: mix('#F3E6D2', '#EADBC4', sh * 2), point: mix('#6E5242', '#5A4033', sh * 2), belly: '#FBF3E6', pattern: 'siamese' }; break;
    case 'black': o = { fur: mix('#35303F', '#2A2533', sh * 2), stripe: '#221E2A', belly: '#46404F', pattern: 'solid', line: '#14111A' }; break;
    default: o = { fur: mix('#F0A04B', '#E8913E', sh * 2), stripe: '#C8702C', belly: '#FCE9D2', pattern: 'tabby' };
  }
  o.eye = BREEDS[breed % 6] === 'siamese' ? '#5AA9E6' : BREEDS[breed % 6] === 'black' ? '#F2C534' : EYES[coat % 5];
  o.collar = COLLARS[coat % 10];
  o.sock = coat % 4 === 1;
  o.v = v;
  if (golden) Object.assign(o, { fur: '#F7C948', stripe: '#D99A1E', belly: '#FFF1BF', pattern: 'tabby', patch: null, point: null, golden: true, line: '#7A4E10' });
  return o;
}
const desat = (h, k) => (k ? mix(h, '#B9AFA8', k) : h);

/**
 * Generic chibi cat. (x,y) = feet centre; s = height in px. o: coat fields + pose:
 * ears 'up'|'down'|'back', eyes 'open'|'sad'|'happy'|'closed'|'shut'|'wide', mouth 'smile'|'sad'|'open'|'w'|'flat',
 * arms 'down'|'swat'|'up', swat 0..1, tail (radians sway), blink 0..1, desat 0..1, look [dx,dy], tear, blush,
 * under(g) hook (after body, before head), over(g) hook (after face), rot, sx, sy.
 */
export function drawCat(g, x, y, s, o) {
  const k = s / 100;
  const D = o.desat || 0;
  const fur = desat(o.fur, D), belly = desat(o.belly || o.fur, D), stripe = o.stripe ? desat(o.stripe, D) : null;
  const line = o.line || INK;
  const lw = Math.max(1.1 / k, 3.1);
  g.save();
  g.translate(x, y);
  if (o.rot) { g.translate(0, -s * 0.45); g.rotate(o.rot); g.translate(0, s * 0.45); }
  g.scale(k * (o.sx || 1), k * (o.sy || 1));
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = line; g.lineWidth = lw;
  // ground shadow
  if (!o.noShadow) { g.fillStyle = 'rgba(30,14,20,0.25)'; g.beginPath(); g.ellipse(2, 1, 34, 6, 0, 0, TAU); g.fill(); }
  // tail
  const tw = o.tail || 0;
  const tail = new Path2D();
  tail.moveTo(16, -6);
  tail.bezierCurveTo(44, -2, 48 + tw * 6, -26, 36 + tw * 14, -44 - Math.abs(tw) * 2);
  g.lineWidth = 12 + lw * 2 * 0.5; g.strokeStyle = line; g.stroke(tail);
  g.lineWidth = 12 - lw * 0.6; g.strokeStyle = o.pattern === 'siamese' ? desat(o.point, D) : fur; g.stroke(tail);
  if (stripe && o.pattern === 'tabby') {
    g.save(); g.setLineDash([3.2, 6]); g.lineDashOffset = -2; g.strokeStyle = stripe; g.lineWidth = 12 - lw * 0.6; g.stroke(tail); g.restore();
  }
  g.lineWidth = lw; g.strokeStyle = line;
  // body
  const body = new Path2D();
  body.ellipse(0, -24, 25, 24, 0, 0, TAU);
  const haunch = new Path2D();
  haunch.ellipse(-18, -9, 12, 10, 0, 0, TAU); haunch.ellipse(18, -9, 12, 10, 0, 0, TAU);
  g.fillStyle = fur;
  g.fill(body); g.stroke(body); g.fill(haunch); g.stroke(haunch); g.fill(body);
  g.save(); g.clip(body);
  g.fillStyle = belly; g.beginPath(); g.ellipse(0, -18, 13, 20, 0, 0, TAU); g.fill();
  if (o.pattern === 'tabby' && stripe) {
    g.strokeStyle = stripe; g.lineWidth = 3.4;
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(sx * 25, -38 + i * 9); g.quadraticCurveTo(sx * 17, -34 + i * 9, sx * 14, -30 + i * 9); g.stroke(); }
  } else if (o.pattern === 'calico') {
    g.fillStyle = desat(o.patch, D); g.beginPath(); g.ellipse(-16, -30, 13, 11, 0.4, 0, TAU); g.fill();
    g.fillStyle = desat(o.patch2, D); g.beginPath(); g.ellipse(17, -14, 11, 9, -0.3, 0, TAU); g.fill();
  } else if (o.pattern === 'tux') {
    g.fillStyle = belly; g.beginPath(); g.ellipse(0, -22, 12, 22, 0, 0, TAU); g.fill();
  }
  g.restore();
  // front legs
  const legs = (side, raise) => {
    g.save();
    g.translate(side * 8, -26);
    g.rotate(raise);
    const leg = new Path2D();
    leg.moveTo(-5, 0); leg.lineTo(-5, 20); leg.ellipse(0, 22, 6.5, 4.8, 0, Math.PI, 0, true); leg.lineTo(5, 0);
    g.fillStyle = fur; g.fill(leg);
    g.strokeStyle = line; g.lineWidth = lw; g.stroke(leg);
    const sock = o.pattern === 'tux' || o.sock;
    if (sock || o.pattern === 'siamese') { g.fillStyle = o.pattern === 'siamese' ? desat(o.point, D) : belly; g.beginPath(); g.ellipse(0, 22, 6, 4.4, 0, 0, TAU); g.fill(); g.stroke(); }
    g.strokeStyle = mix(line, fur, 0.5); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-1.8, 24.5); g.lineTo(-1.8, 22.5); g.moveTo(1.8, 24.5); g.lineTo(1.8, 22.5); g.stroke();
    g.restore();
  };
  const arms = o.arms || 'down', sw = o.swat || 0;
  // resting legs go under the outfit; raised paws are drawn over it so a swat / cheer reads in every outfit
  if (arms === 'swat') legs(-1, 0);
  else if (arms !== 'up') { legs(-1, 0); legs(1, 0); }
  if (o.under) o.under(g, { fur, line, lw });
  if (arms === 'up') { legs(-1, 2.6); legs(1, -2.6); }
  else if (arms === 'swat') legs(1, -0.4 - sw * 2.0);
  // ears
  const ear = (side) => {
    g.save();
    g.translate(side * 21, -78);
    const e = o.ears || 'up';
    g.rotate(side * (e === 'down' ? 0.85 : e === 'back' ? 0.45 : 0));
    if (e === 'down') g.translate(side * 2, 6);
    const p = new Path2D();
    p.moveTo(-side * 11, 6); p.lineTo(side * 4, -20); p.lineTo(side * 12, 4); p.closePath();
    g.fillStyle = o.pattern === 'siamese' ? desat(o.point, D) : o.pattern === 'calico' && side < 0 ? desat(o.patch, D) : fur;
    g.fill(p); g.strokeStyle = line; g.lineWidth = lw; g.stroke(p);
    g.fillStyle = desat('#F4A3A0', D);
    g.beginPath(); g.moveTo(-side * 5, 3); g.lineTo(side * 3.5, -12); g.lineTo(side * 7.5, 3); g.closePath(); g.fill();
    g.restore();
  };
  ear(-1); ear(1);
  // head
  const head = new Path2D();
  head.ellipse(0, -60, 33, 28, 0, 0, TAU);
  g.fillStyle = fur; g.fill(head);
  g.save(); g.clip(head);
  if (o.pattern === 'tabby' && stripe) {
    g.strokeStyle = stripe; g.lineWidth = 3.6;
    for (const dx of [-7, 0, 7]) { g.beginPath(); g.moveTo(dx, -87); g.lineTo(dx * 0.8, -76 + Math.abs(dx) * 0.3); g.stroke(); }
    for (const sx of [-1, 1]) for (const dy of [0, 6]) { g.beginPath(); g.moveTo(sx * 34, -60 + dy); g.lineTo(sx * 25, -58 + dy); g.stroke(); }
  } else if (o.pattern === 'tux') {
    g.fillStyle = belly;
    g.beginPath(); g.moveTo(0, -70); g.quadraticCurveTo(-10, -58, -20, -44); g.lineTo(20, -44); g.quadraticCurveTo(10, -58, 0, -70); g.fill();
    g.beginPath(); g.ellipse(0, -46, 18, 9, 0, 0, TAU); g.fill();
  } else if (o.pattern === 'calico') {
    g.fillStyle = desat(o.patch, D); g.beginPath(); g.ellipse(-20, -72, 17, 14, 0.3, 0, TAU); g.fill();
    g.fillStyle = desat(o.patch2, D); g.beginPath(); g.ellipse(24, -68, 14, 12, -0.4, 0, TAU); g.fill();
  } else if (o.pattern === 'siamese') {
    const mg = g.createRadialGradient(0, -52, 2, 0, -54, 22);
    mg.addColorStop(0, desat(o.point, D)); mg.addColorStop(0.55, alpha(desat(o.point, D), 0.75)); mg.addColorStop(1, alpha(desat(o.point, D), 0));
    g.fillStyle = mg; g.fillRect(-33, -88, 66, 56);
  }
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.ellipse(-12, -76, 14, 7, -0.3, 0, TAU); g.fill();
  g.restore();
  g.strokeStyle = line; g.lineWidth = lw; g.stroke(head);
  // face
  const [lx, ly] = o.look || [0, 0];
  const ex = 12.5, ey = -59 + ly;
  const eyes = o.eyes || 'open';
  const blink = o.blink || 0;
  for (const sd of [-1, 1]) {
    const cx = sd * ex + lx;
    if (eyes === 'happy') { g.strokeStyle = line; g.lineWidth = 3.4; g.beginPath(); g.arc(cx, ey + 3, 5.5, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); continue; }
    if (eyes === 'closed' || blink > 0.6) { g.strokeStyle = line; g.lineWidth = 3; g.beginPath(); g.arc(cx, ey - 1, 5.5, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); continue; }
    if (eyes === 'shut') { g.strokeStyle = line; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - sd * 5, ey - 4); g.lineTo(cx + sd * 3, ey); g.lineTo(cx - sd * 5, ey + 4); g.stroke(); continue; }
    const big = eyes === 'wide' ? 1.15 : 1;
    const ry = 7.2 * big * (1 - blink);
    g.fillStyle = line; g.beginPath(); g.ellipse(cx, ey, 6 * big, ry, 0, 0, TAU); g.fill();
    if (o.eye) { g.fillStyle = desat(o.eye, D * 0.6); g.beginPath(); g.ellipse(cx, ey + 1.2 * big, 4.4 * big, ry * 0.62, 0, 0, TAU); g.fill(); g.fillStyle = line; g.beginPath(); g.ellipse(cx, ey + 1.4, 2.6 * big, ry * 0.42, 0, 0, TAU); g.fill(); }
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.arc(cx - 2, ey - 3 * big, 2.3 * big, 0, TAU); g.fill();
    g.beginPath(); g.arc(cx + 2.2, ey + 2.6, 1.1, 0, TAU); g.fill();
    if (eyes === 'sad') {
      g.strokeStyle = line; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(cx - sd * 6, ey - 12); g.lineTo(cx + sd * 4, ey - 9.5); g.stroke();
    }
  }
  if (o.tear) {
    g.fillStyle = '#8FD3F5'; g.strokeStyle = line; g.lineWidth = 1.2;
    const ty = ey + 6 + (o.tear % 1) * 10;
    g.beginPath(); g.moveTo(ex + 3 + lx, ty - 4); g.quadraticCurveTo(ex + 7 + lx, ty + 2, ex + 3 + lx, ty + 3); g.quadraticCurveTo(ex - 1 + lx, ty + 2, ex + 3 + lx, ty - 4); g.fill(); g.stroke();
  }
  if (o.blush !== false) {
    g.fillStyle = desat('#FF8FA3', D) + '';
    g.globalAlpha = 0.45;
    for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(sd * 21 + lx * 0.5, -49 + ly, 5.5, 3.2, 0, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  }
  // nose + mouth
  const ny = -51 + ly;
  g.fillStyle = desat('#E9748A', D);
  g.beginPath(); g.moveTo(-3 + lx, ny - 1.5); g.lineTo(3 + lx, ny - 1.5); g.lineTo(lx, ny + 1.8); g.closePath(); g.fill();
  g.strokeStyle = line; g.lineWidth = 2.1;
  const m = o.mouth || 'w';
  g.beginPath();
  if (m === 'sad') { g.moveTo(-5 + lx, ny + 7); g.quadraticCurveTo(lx, ny + 3, 5 + lx, ny + 7); }
  else if (m === 'flat') { g.moveTo(-3.5 + lx, ny + 5); g.lineTo(3.5 + lx, ny + 5); }
  else if (m === 'open') {
    g.moveTo(-5 + lx, ny + 3); g.quadraticCurveTo(lx, ny + 13, 5 + lx, ny + 3); g.closePath();
    g.fillStyle = '#B83A4B'; g.fill(); g.stroke();
    g.fillStyle = '#FF8FA3'; g.beginPath(); g.ellipse(lx, ny + 8.5, 2.6, 1.6, 0, 0, TAU); g.fill();
    g.beginPath();
  } else if (m === 'smile') { g.moveTo(lx, ny + 1.8); g.quadraticCurveTo(-3 + lx, ny + 7, -7 + lx, ny + 4); g.moveTo(lx, ny + 1.8); g.quadraticCurveTo(3 + lx, ny + 7, 7 + lx, ny + 4); }
  else { g.moveTo(lx, ny + 1.8); g.quadraticCurveTo(-2.5 + lx, ny + 5.5, -5 + lx, ny + 3.5); g.moveTo(lx, ny + 1.8); g.quadraticCurveTo(2.5 + lx, ny + 5.5, 5 + lx, ny + 3.5); }
  g.stroke();
  // whiskers
  g.strokeStyle = alpha(o.pattern === 'solid' || o.pattern === 'tux' ? '#D8D0E0' : INK, 0.55); g.lineWidth = 1.2;
  g.beginPath();
  for (const sd of [-1, 1]) for (const d of [-2, 2.5]) { g.moveTo(sd * 22, -50 + d + ly); g.lineTo(sd * 38, -52 + d * 2 + ly); }
  g.stroke();
  if (o.collar && !o.noCollar) {
    g.strokeStyle = line; g.lineWidth = 6.5; g.beginPath(); g.arc(0, -66, 30, Math.PI * 0.3, Math.PI * 0.7); g.stroke();
    g.strokeStyle = desat(o.collar, D); g.lineWidth = 4; g.stroke();
    g.fillStyle = desat(BRASS, D); g.beginPath(); g.arc(0, -35, 3.6, 0, TAU); g.fill(); g.strokeStyle = line; g.lineWidth = 1.4; g.stroke();
  }
  if (o.over) o.over(g, { fur, line, lw });
  if (o.golden) {
    g.fillStyle = '#FFF6C8';
    const t = o.t || 0;
    for (let i = 0; i < 4; i++) {
      const a = (t * 0.7 + i * 0.25) % 1, sx = Math.cos(i * 2.1) * 34, sy = -50 + Math.sin(i * 1.7) * 36;
      const r = 4 * Math.sin(a * Math.PI);
      g.beginPath(); g.moveTo(sx, sy - r * 2); g.lineTo(sx + r * 0.5, sy - r * 0.5); g.lineTo(sx + r * 2, sy); g.lineTo(sx + r * 0.5, sy + r * 0.5); g.lineTo(sx, sy + r * 2); g.lineTo(sx - r * 0.5, sy + r * 0.5); g.lineTo(sx - r * 2, sy); g.lineTo(sx - r * 0.5, sy - r * 0.5); g.closePath(); g.fill();
    }
  }
  g.restore();
}

/** A curled-up sleeping cat (loaf), used by scenes. (x,y) bottom centre, s = width. */
export function drawSleepCat(g, x, y, s, coat, t = 0, flick = 0) {
  const k = s / 100;
  g.save(); g.translate(x, y); g.scale(k, k);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const line = coat.line || INK, lw = Math.max(1 / k, 3);
  g.fillStyle = 'rgba(30,14,20,0.22)'; g.beginPath(); g.ellipse(0, 1, 52, 7, 0, 0, TAU); g.fill();
  const br = 1 + Math.sin(t * 1.4) * 0.025;
  // tail wrapping the front, tip flicks
  const tail = new Path2D();
  tail.moveTo(40, -12); tail.bezierCurveTo(52, 2, 10, 6, -24 + flick * 4, -2 - flick * 8);
  g.strokeStyle = line; g.lineWidth = 13; g.stroke(tail);
  // body
  g.save(); g.scale(1, br);
  g.fillStyle = coat.fur; g.strokeStyle = line; g.lineWidth = lw;
  g.beginPath(); g.ellipse(6, -22, 44, 23, 0, 0, TAU); g.fill(); g.stroke();
  if (coat.stripe && coat.pattern === 'tabby') { g.strokeStyle = coat.stripe; g.lineWidth = 4; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-6 + i * 12, -44); g.quadraticCurveTo(-2 + i * 12, -34, -6 + i * 12, -26); g.stroke(); } }
  if (coat.pattern === 'calico') { g.fillStyle = coat.patch; g.beginPath(); g.ellipse(20, -30, 14, 10, 0, 0, TAU); g.fill(); }
  g.restore();
  g.strokeStyle = coat.fur; g.lineWidth = 8.5; g.stroke(tail);
  // head resting on paws
  g.fillStyle = coat.fur; g.strokeStyle = line; g.lineWidth = lw;
  for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(-30 + sd * 12, -36); g.lineTo(-30 + sd * 8, -52); g.lineTo(-30 + sd * 1, -40); g.closePath(); g.fill(); g.stroke(); }
  g.beginPath(); g.ellipse(-30, -24, 22, 18, 0, 0, TAU); g.fill(); g.stroke();
  if (coat.pattern === 'tux') { g.fillStyle = coat.belly; g.beginPath(); g.ellipse(-30, -16, 12, 8, 0, 0, TAU); g.fill(); }
  g.strokeStyle = line; g.lineWidth = 2.6;
  for (const sd of [-1, 1]) { g.beginPath(); g.arc(-30 + sd * 9, -26, 4.5, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
  g.fillStyle = '#E9748A'; g.beginPath(); g.moveTo(-32.5, -19); g.lineTo(-27.5, -19); g.lineTo(-30, -16.5); g.fill();
  // paws
  g.fillStyle = coat.belly || coat.fur; g.strokeStyle = line; g.lineWidth = lw;
  for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(-30 + sd * 10, -6, 8, 5, 0, 0, TAU); g.fill(); g.stroke(); }
  g.restore();
}

// ------------------------------------------------------------------ the kitten (on the board)
const LOOP_DEF = [ // order = which loop stays longest (index 0 drops last)
  { cx: 0, cy: -14, rx: 28, ry: 8, rot: 0.08 },
  { cx: 0, cy: -32, rx: 27, ry: 9, rot: -0.22 },
  { cx: 22, cy: -14, rx: 14, ry: 13, rot: 0.6 },
  { cx: -4, cy: -66, rx: 36, ry: 11, rot: -0.55 },
];
function drawLoop(g, L, c, k, half) {
  const col = c === RAINBOW ? '#F5B82E' : YARN[c] ? YARN[c].base : MYST;
  g.save(); g.translate(L.cx, L.cy); g.rotate(L.rot);
  g.lineCap = 'round';
  const a0 = half ? 0 : -Math.PI, a1 = Math.PI;
  g.strokeStyle = INK; g.lineWidth = 7.5;
  g.beginPath(); g.ellipse(0, 0, L.rx, L.ry, 0, a0 + 0.08, a1 - 0.08); g.stroke();
  g.strokeStyle = col; g.lineWidth = 5;
  g.stroke();
  g.strokeStyle = mix(col, INK, 0.3); g.lineWidth = 1.6; g.setLineDash([2, 3.2]);
  g.stroke(); g.setLineDash([]);
  g.restore();
  void k;
}
const kitMem = new WeakMap();
/**
 * drawKitten(g, x, y, s, { stage, loops, flinch, freeT, breed, coat, golden, t, loopColors })
 * (x,y) = feet centre, s = height. stage 0..4 (§7.4). freeT = t when freed (−1 = not yet).
 */
export function drawKitten(g, x, y, s, o) {
  const t = o.t || 0;
  const coat = coatOf(o.breed || 0, o.coat || 0, o.golden);
  const stage = o.freeT >= 0 && t >= o.freeT ? 4 : (o.stage || 0);
  const loops = stage >= 4 ? 0 : o.loops != null ? o.loops : 4 - stage;
  const cols = o.loopColors && o.loopColors.length ? o.loopColors : [0, 1, 2, 3];
  // remember loops to animate drops
  const key = o.memKey || drawKitten;
  let mem = kitMem.get(key);
  if (!mem) { mem = { loops, drops: [], t }; kitMem.set(key, mem); }
  if (t < mem.t - 0.5) { mem.loops = loops; mem.drops = []; }
  if (loops < mem.loops) for (let i = loops; i < mem.loops; i++) mem.drops.push({ i, t0: t, c: cols[i % cols.length] });
  mem.loops = loops; mem.t = t;
  mem.drops = mem.drops.filter(d => t - d.t0 < 0.9);
  const k = s / 100;
  let dy = 0, rot = 0, sx = 1, sy = 1;
  let ears = 'down', eyes = 'sad', mouth = 'sad', arms = 'down', look = [0, 0], tail = Math.sin(t * 1.2) * 0.4, D = 0, blink = 0;
  const flinch = o.flinch || 0;
  if (stage === 0) { D = 0.28; rot = Math.sin(t * 1.3) * 0.04; }
  else if (stage === 1) { D = 0.18; ears = 'back'; eyes = 'wide'; mouth = 'flat'; look = [Math.sin(t * 0.7) * 3, -2]; rot = Math.sin(t * 1.6) * 0.03; }
  else if (stage === 2) { D = 0.08; ears = 'up'; eyes = 'open'; mouth = 'w'; tail = Math.sin(t * 6) * 0.9; }
  else if (stage === 3) { ears = 'up'; eyes = 'open'; mouth = 'open'; tail = Math.sin(t * 8) * 1; dy = -Math.abs(Math.sin(t * 5)) * 6; rot = Math.sin(t * 10) * 0.05; }
  else {
    ears = 'up'; eyes = 'happy'; mouth = 'smile'; tail = Math.sin(t * 2.5) * 1.1;
    const a = o.freeT >= 0 ? t - o.freeT : 99;
    if (a < 0.15) { sy = 1 - a * 1.2; sx = 1 + a; }
    else if (a < 0.75) { const p = (a - 0.15) / 0.6; dy = -4 * p * (1 - p) * 80; rot = ease(p) * TAU; arms = 'up'; mouth = 'open'; }
    else if (a < 0.95) { const p = (a - 0.75) / 0.2; sy = 1 - Math.sin(p * Math.PI) * 0.22; sx = 1 + Math.sin(p * Math.PI) * 0.18; }
    else if (a < 1.35) { rot = Math.sin((a - 0.95) * 50) * 0.12 * (1 - (a - 0.95) / 0.4); eyes = 'closed'; }
    else { dy = -Math.max(0, Math.sin(t * 2.2)) * 2; }
  }
  if (flinch > 0) { sy *= 1 - flinch * 0.12; sx *= 1 + flinch * 0.1; eyes = 'shut'; rot += Math.sin(t * 60) * 0.05 * flinch; }
  if (eyes === 'open' || eyes === 'wide') { const ph = (t + (o.breed || 0) * 0.7) % 3.7; if (ph < 0.12) blink = 1; }
  const cat = { ...coat, ears, eyes, mouth, arms, look, tail, desat: D, blink, rot, sx, sy, blush: stage >= 2 || coat.blush, t };
  cat.under = (gg) => { for (let i = 0; i < Math.min(loops, 3); i++) drawLoop(gg, LOOP_DEF[i], cols[i % cols.length], k, false); };
  cat.over = (gg) => {
    if (loops >= 4) drawLoop(gg, LOOP_DEF[3], cols[3 % cols.length], k, false);
    if (o.golden) { /* sparkle handled by drawCat */ }
  };
  drawCat(g, x, y + dy * k, s, cat);
  // dropping loops: fall, bounce on the ledge, fade
  for (const d of mem.drops) {
    const a = (t - d.t0) / 0.9, L = LOOP_DEF[d.i];
    g.save(); g.translate(x, y); g.scale(k, k);
    const fall = a < 0.5 ? (a / 0.5) ** 2 : 1, bounce = a >= 0.5 ? Math.sin(((a - 0.5) / 0.5) * Math.PI) * 0.25 * (1 - a) : 0;
    g.globalAlpha = 1 - Math.max(0, (a - 0.6) / 0.4);
    g.translate((d.i % 2 ? 1 : -1) * a * 26, (-L.cy) * fall - bounce * 40);
    drawLoop(g, { ...L, cy: L.cy, rot: L.rot + a * 1.5 }, d.c, k, false);
    g.restore();
  }
  // freed: purr hearts burst + gentle hearts after
  if (stage >= 4 && o.freeT >= 0) {
    const a = t - o.freeT;
    for (let i = 0; i < 12; i++) {
      const h0 = 0.75 + i * 0.07, p = (a - h0) / 1.3;
      if (p <= 0 || p >= 1) continue;
      const ang = -Math.PI / 2 + (hash(i, 5) - 0.5) * 2.4;
      const dist = s * (0.4 + 0.9 * easeOut(p));
      drawHeart(g, x + Math.cos(ang) * dist, y - s * 0.6 + Math.sin(ang) * dist - p * s * 0.3, s * 0.11 * (1 - p * 0.3), 1 - p * p);
    }
    if (a > 2.2) { const p = ((a - 2.2) % 2.6) / 2.6; if (p < 0.8) drawHeart(g, x + s * 0.32, y - s * 0.95 - p * s * 0.35, s * 0.08, Math.sin(p / 0.8 * Math.PI)); }
  }
}
export function drawHeart(g, x, y, r, a = 1) {
  if (a <= 0) return;
  g.save(); g.translate(x, y); g.globalAlpha *= a;
  g.fillStyle = '#F2627E'; g.strokeStyle = INK; g.lineWidth = Math.max(1.2, r * 0.18);
  g.beginPath(); g.moveTo(0, r * 0.8);
  g.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.7, -r * 1.25, 0, -r * 0.45);
  g.bezierCurveTo(r * 0.7, -r * 1.25, r * 1.5, -r * 0.1, 0, r * 0.8);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(-r * 0.45, -r * 0.35, r * 0.2, 0, TAU); g.fill();
  g.restore();
}

// ------------------------------------------------------------------ Kitty (hero) + outfits
const KITTY = { fur: '#F29B4B', stripe: '#C96B26', belly: '#FCE9D2', pattern: 'tabby', eye: '#7BC043', collar: null };
function knit(g, path, base, dark) {
  g.fillStyle = base; g.fill(path);
  g.save(); g.clip(path);
  g.strokeStyle = dark; g.lineWidth = 1.6;
  for (let x = -40; x <= 40; x += 6) for (let y = -60; y <= 4; y += 6) { g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x, y + 3); g.lineTo(x + 2, y); g.stroke(); }
  g.restore();
}
const OUTFIT = {
  scarf: {
    under(g, c) {
      const p = new Path2D(); p.ellipse(0, -38, 25, 8, 0, 0, TAU);
      knit(g, p, '#E8463A', '#B8322A'); g.strokeStyle = c.line; g.lineWidth = c.lw; g.stroke(p);
      const t = new Path2D(); t.moveTo(10, -36); t.lineTo(18, -10); t.lineTo(9, -9); t.lineTo(4, -33); t.closePath();
      knit(g, t, '#E8463A', '#B8322A'); g.stroke(t);
      g.strokeStyle = CREAM; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-22, -40); g.lineTo(22, -40); g.moveTo(16.5, -16); g.lineTo(8, -15); g.stroke();
      g.strokeStyle = '#E8463A'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 4; i++) { g.moveTo(10 + i * 2.6, -9); g.lineTo(10 + i * 2.8, -4); } g.stroke();
    },
  },
  pumpkin: {
    under(g, c) {
      const p = new Path2D(); p.ellipse(0, -24, 26.5, 22, 0, 0, TAU);
      knit(g, p, '#F07F22', '#C85F12'); g.strokeStyle = c.line; g.lineWidth = c.lw; g.stroke(p);
      g.save(); g.clip(p);
      g.strokeStyle = '#C85F12'; g.lineWidth = 2.4;
      for (const x of [-12, 0, 12]) { g.beginPath(); g.moveTo(x, -46); g.quadraticCurveTo(x * 1.5, -24, x, -2); g.stroke(); }
      // jack-o face
      g.fillStyle = '#3B1F12';
      g.beginPath(); g.moveTo(-9, -28); g.lineTo(-4, -28); g.lineTo(-6.5, -33); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(4, -28); g.lineTo(9, -28); g.lineTo(6.5, -33); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-10, -22); g.lineTo(10, -22); g.lineTo(7, -17); g.lineTo(3, -20); g.lineTo(0, -16); g.lineTo(-3, -20); g.lineTo(-7, -17); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = '#5E8C2E'; g.strokeStyle = c.line; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, -40, 22, 5, 0, 0, TAU); g.fill(); g.stroke();
    },
  },
  snow: {
    under(g, c) {
      const p = new Path2D(); p.ellipse(0, -24, 26.5, 22, 0, 0, TAU);
      knit(g, p, '#3D86EE', '#2A63B8'); g.strokeStyle = c.line; g.lineWidth = c.lw; g.stroke(p);
      g.save(); g.clip(p);
      g.fillStyle = CREAM; for (let x = -24; x <= 24; x += 6) { g.beginPath(); g.moveTo(x, -10); g.lineTo(x + 3, -6); g.lineTo(x, -2); g.lineTo(x - 3, -6); g.closePath(); g.fill(); }
      g.strokeStyle = CREAM; g.lineWidth = 2.2;
      for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(Math.cos(a) * 9, -26 + Math.sin(a) * 9); g.lineTo(-Math.cos(a) * 9, -26 - Math.sin(a) * 9); g.stroke(); }
      g.restore();
      g.fillStyle = CREAM; g.strokeStyle = c.line; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -40, 22, 5, 0, 0, TAU); g.fill(); g.stroke();
    },
  },
  bow: {
    over(g, c) {
      g.fillStyle = '#E8463A'; g.strokeStyle = c.line; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(0, -33); g.lineTo(-13, -40); g.lineTo(-13, -26); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(0, -33); g.lineTo(13, -40); g.lineTo(13, -26); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#B8322A'; g.beginPath(); g.ellipse(0, -33, 4, 4.5, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = CREAM; for (const [x, y] of [[-8, -36], [-9, -30], [8, -36], [9, -30]]) { g.beginPath(); g.arc(x, y, 1.3, 0, TAU); g.fill(); }
    },
  },
  witch: {
    over(g, c) {
      g.save(); g.translate(2, -84); g.rotate(0.12);
      g.fillStyle = '#4B2E73'; g.strokeStyle = c.line; g.lineWidth = c.lw;
      g.beginPath(); g.ellipse(0, 0, 34, 8, 0, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-18, -2); g.quadraticCurveTo(-8, -26, 2, -44); g.quadraticCurveTo(10, -50, 18, -44); g.quadraticCurveTo(8, -38, 12, -22); g.lineTo(18, -2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#F07F22'; g.beginPath(); g.rect(-17, -10, 35, 6); g.fill(); g.stroke();
      g.fillStyle = GOLD; g.beginPath(); g.rect(-3, -11, 7, 8); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(-10, -12); g.quadraticCurveTo(-4, -28, 2, -40); g.lineTo(0, -26); g.closePath(); g.fill();
      g.restore();
    },
  },
  crown: {
    over(g, c) {
      g.save(); g.translate(0, -88);
      const p = new Path2D(); p.moveTo(-20, 4); p.lineTo(-22, -14); p.lineTo(-11, -5); p.lineTo(0, -18); p.lineTo(11, -5); p.lineTo(22, -14); p.lineTo(20, 4); p.closePath();
      g.fillStyle = '#F5B82E'; g.fill(p);
      g.save(); g.clip(p); g.strokeStyle = '#C98A12'; g.lineWidth = 2; for (let y = -18; y < 6; y += 4) { g.beginPath(); g.moveTo(-24, y); g.lineTo(24, y + 3); g.stroke(); } g.restore();
      g.strokeStyle = c.line; g.lineWidth = c.lw; g.stroke(p);
      for (const [x, y, col] of [[-22, -15, '#E8463A'], [0, -19, '#3D86EE'], [22, -15, '#1FB0A0']]) { g.fillStyle = col; g.beginPath(); g.arc(x, y, 4.2, 0, TAU); g.fill(); g.lineWidth = 2; g.stroke(); }
      g.restore();
    },
  },
  astro: {
    over(g, c) {
      g.fillStyle = 'rgba(190,230,255,0.22)'; g.strokeStyle = c.line; g.lineWidth = c.lw;
      g.beginPath(); g.ellipse(0, -63, 44, 42, 0, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 4; g.beginPath(); g.arc(0, -63, 36, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
      g.fillStyle = '#C9D3DE'; g.strokeStyle = c.line; g.lineWidth = c.lw * 0.8;
      rr(g, -30, -28, 60, 9, 4.5); g.fill(); g.stroke();
      g.strokeStyle = c.line; g.lineWidth = 2.5; g.beginPath(); g.moveTo(26, -96); g.lineTo(34, -112); g.stroke();
      drawStarPath(g, 35, -115, 7); g.fillStyle = GOLD; g.fill(); g.lineWidth = 1.8; g.stroke();
    },
  },
};
function drawStarPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.48 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
  g.closePath();
}
/**
 * drawKitty(g, x, y, s, anim, t, outfit) — the hero: orange tabby. (x,y) feet, s height.
 * anim: 'idle'|'swat'|'cheer'|'worried'|'celebrate'|'sad'|'sleep'; t = seconds since the anim started.
 */
export function drawKitty(g, x, y, s, anim = 'idle', t = 0, outfit = 'tabby') {
  const o = { ...KITTY, ears: 'up', eyes: 'open', mouth: 'w', arms: 'down', tail: Math.sin(t * Math.PI) * 0.8, t };
  let dy = 0;
  const ph = t % 4.1;
  if (ph > 3.95) o.blink = 1;
  switch (anim) {
    case 'swat': { const p = clamp(t / 0.25, 0, 1); o.arms = 'swat'; o.swat = Math.sin(p * Math.PI); o.look = [3, 0]; o.mouth = 'open'; break; }
    case 'cheer': { o.arms = 'up'; o.eyes = 'happy'; o.mouth = 'open'; dy = -Math.abs(Math.sin(t * 9)) * 8 * Math.max(0, 1 - t / 1.2); o.tail = Math.sin(t * 10); break; }
    case 'worried': { o.ears = 'back'; o.eyes = 'wide'; o.mouth = 'flat'; o.look = [Math.sin(t * 2) * 2, 2]; o.tail = Math.sin(t * 5) * 0.4; break; }
    case 'celebrate': {
      const p = clamp(t / 0.8, 0, 1);
      dy = -Math.sin(p * Math.PI) * 30; o.rot = p < 1 ? ease(p) * TAU : 0; o.arms = 'up'; o.eyes = 'happy'; o.mouth = 'open'; o.tail = Math.sin(t * 9);
      if (t > 0.8) { dy = -Math.abs(Math.sin(t * 6)) * 6; }
      break;
    }
    case 'sad': { o.ears = 'down'; o.eyes = 'sad'; o.mouth = 'sad'; o.tear = t * 0.8; o.sy = 0.96; o.tail = Math.sin(t) * 0.15; break; }
    case 'sleep': { o.eyes = 'closed'; o.mouth = 'w'; o.ears = 'back'; o.sy = 0.95 + Math.sin(t * 1.5) * 0.015; o.tail = Math.sin(t * 0.6) * 0.3; break; }
  }
  const of = OUTFIT[outfit];
  if (of) { o.under = of.under; o.over = of.over; }
  drawCat(g, x, y + dy * s / 100, s, o);
  if (anim === 'sleep') {
    for (let i = 0; i < 3; i++) {
      const p = ((t * 0.45 + i / 3) % 1);
      g.globalAlpha = Math.sin(p * Math.PI);
      text(g, 'z', x + s * (0.25 + p * 0.25), y - s * (0.95 + p * 0.45), s * (0.12 + p * 0.1), { color: CREAM, stroke: INK, strokeW: s * 0.03 });
    }
    g.globalAlpha = 1;
  }
  if (anim === 'worried') {
    g.fillStyle = '#8FD3F5'; g.strokeStyle = INK; g.lineWidth = Math.max(1, s * 0.012);
    const sx = x + s * 0.3, sy = y - s * 0.86 + ((t * 0.7) % 1) * s * 0.05;
    g.beginPath(); g.moveTo(sx, sy - s * 0.06); g.quadraticCurveTo(sx + s * 0.04, sy + s * 0.02, sx, sy + s * 0.03); g.quadraticCurveTo(sx - s * 0.04, sy + s * 0.02, sx, sy - s * 0.06); g.fill(); g.stroke();
  }
}

// ------------------------------------------------------------------ star, hand, icons
export function drawStar(g, x, y, r, on, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot);
  drawStarPath(g, 0, 0, r);
  g.lineJoin = 'round';
  if (on) {
    g.fillStyle = 'rgba(43,36,64,0.3)'; g.save(); g.translate(r * 0.06, r * 0.12); g.fill(); g.restore();
    const gr = g.createLinearGradient(0, -r, 0, r);
    gr.addColorStop(0, '#FFE58A'); gr.addColorStop(0.6, GOLD); gr.addColorStop(1, '#F0A92A');
    g.fillStyle = gr;
  } else g.fillStyle = 'rgba(43,36,64,0.28)';
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.16);
  g.strokeStyle = on ? GOLD_D : 'rgba(43,36,64,0.55)';
  g.stroke();
  if (on) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.25, r * 0.16, r * 0.1, -0.6, 0, TAU); g.fill(); }
  g.restore();
}

/** Pointing hand; fingertip at (x,y). s ≈ hand height. press = true squashes + ripple. */
export function drawHand(g, x, y, s, press) {
  g.save();
  g.translate(x, y);
  if (press) {
    g.strokeStyle = 'rgba(255,244,228,0.9)'; g.lineWidth = Math.max(2, s * 0.05);
    g.beginPath(); g.arc(0, 0, s * 0.3, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,244,228,0.45)';
    g.beginPath(); g.arc(0, 0, s * 0.46, 0, TAU); g.stroke();
  }
  g.rotate(-0.42);
  const k = (press ? 0.9 : 1) * s / 100;
  g.scale(k, k);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const hand = new Path2D();
  hand.moveTo(-8, 4);
  hand.lineTo(-8, 52);
  hand.quadraticCurveTo(-22, 40, -30, 46); hand.quadraticCurveTo(-36, 52, -28, 62);
  hand.quadraticCurveTo(-18, 82, -2, 98);
  hand.lineTo(34, 98);
  hand.quadraticCurveTo(44, 80, 42, 60);
  hand.lineTo(42, 48); hand.quadraticCurveTo(41, 38, 32, 39); hand.quadraticCurveTo(30, 31, 21, 32); hand.quadraticCurveTo(18, 25, 9, 27);
  hand.lineTo(9, 4);
  hand.quadraticCurveTo(0.5, -6, -8, 4); hand.closePath();
  g.fillStyle = 'rgba(30,14,20,0.3)'; g.save(); g.translate(4, 6); g.fill(hand); g.restore();
  g.fillStyle = '#FFFFFF'; g.fill(hand);
  g.strokeStyle = INK; g.lineWidth = 5; g.stroke(hand);
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(9, 34); g.lineTo(9, 46); g.moveTo(21, 36); g.lineTo(21, 47); g.moveTo(32, 42); g.lineTo(32, 50); g.stroke();
  // cuff
  g.fillStyle = TOMATO; rr(g, -6, 92, 44, 16, 6); g.fill(); g.lineWidth = 4.5; g.stroke();
  g.restore();
}

/** Icons for UI buttons. s = icon box size; col = fill colour (default cream). */
export function drawIcon(g, name, x, y, s, col = CREAM) {
  g.save();
  g.translate(x, y);
  const k = s / 100;
  g.scale(k, k);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const L = 7;
  const fs = (p) => { g.fillStyle = col; g.fill(p); g.strokeStyle = INK; g.lineWidth = L; g.stroke(p); };
  const thick = (p, w = 18) => { g.strokeStyle = INK; g.lineWidth = w + L * 2; g.stroke(p); g.strokeStyle = col; g.lineWidth = w; g.stroke(p); };
  const P = () => new Path2D();
  switch (name) {
    case 'pause': { const p = P(); p.rect(-26, -32, 18, 64); p.rect(8, -32, 18, 64); fs(p); break; }
    case 'retry': case 'undo': {
      const p = P();
      if (name === 'retry') { p.arc(0, 4, 28, -Math.PI * 0.35, Math.PI * 1.25); thick(p, 14); const a = P(); a.moveTo(12, -46); a.lineTo(34, -26); a.lineTo(6, -16); a.closePath(); fs(a); }
      else { p.moveTo(-20, -14); p.lineTo(14, -14); p.quadraticCurveTo(40, -14, 40, 12); p.quadraticCurveTo(40, 36, 14, 36); p.lineTo(-6, 36); thick(p, 14); const a = P(); a.moveTo(-40, -14); a.lineTo(-14, -38); a.lineTo(-14, 10); a.closePath(); fs(a); }
      break;
    }
    case 'hint': {
      const p = P(); p.moveTo(-14, 14); p.quadraticCurveTo(-30, 0, -30, -14); p.arc(0, -14, 30, Math.PI, 0); p.quadraticCurveTo(30, 0, 14, 14); p.closePath();
      g.fillStyle = col === CREAM ? '#FFE27A' : col; g.fill(p); g.strokeStyle = INK; g.lineWidth = L; g.stroke(p);
      const b = P(); rrP(b, -15, 16, 30, 22, 6); fs(b);
      g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(-14, 26); g.lineTo(14, 26); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6; g.beginPath(); g.arc(0, -14, 18, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
      break;
    }
    case 'slot': {
      const p = P(); p.moveTo(-40, -6); p.lineTo(40, -6); p.lineTo(30, 34); p.lineTo(-30, 34); p.closePath();
      g.fillStyle = '#C98B4E'; g.fill(p); g.save(); g.clip(p); g.strokeStyle = '#A86A34'; g.lineWidth = 5; for (let yy = 2; yy < 34; yy += 9) { g.beginPath(); g.moveTo(-40, yy); g.lineTo(40, yy); g.stroke(); } g.restore();
      g.strokeStyle = INK; g.lineWidth = L; g.stroke(p);
      const pl = P(); pl.moveTo(0, -46); pl.lineTo(0, -14); pl.moveTo(-16, -30); pl.lineTo(16, -30); thick(pl, 10);
      break;
    }
    case 'snip': {
      g.save(); g.rotate(-0.5);
      for (const sd of [-1, 1]) { const r = P(); r.arc(-24, sd * 14, 13, 0, TAU); g.strokeStyle = INK; g.lineWidth = 9 + L * 2; g.stroke(r); g.strokeStyle = col === CREAM ? TOMATO : col; g.lineWidth = 9; g.stroke(r); }
      for (const sd of [-1, 1]) { const b = P(); b.moveTo(-12, sd * 10); b.lineTo(42, -sd * 8); b.lineTo(36, -sd * 2); b.closePath(); g.fillStyle = '#DDE3EA'; g.fill(b); g.strokeStyle = INK; g.lineWidth = L * 0.8; g.stroke(b); }
      g.fillStyle = INK; g.beginPath(); g.arc(4, 0, 5, 0, TAU); g.fill();
      g.restore();
      break;
    }
    case 'star': { g.scale(1 / k, 1 / k); drawStar(g, 0, 0, 40 * k, true); break; }
    case 'ball': { g.scale(1 / k, 1 / k); drawBall(g, 0, 0, 34 * k, 0, { glyph: false }); break; }
    case 'gear': {
      const p = P();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? 30 : 42; const a0 = a - Math.PI / 16, a1 = a + Math.PI / 16; p.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); p.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); }
      p.closePath(); p.moveTo(14, 0); p.arc(0, 0, 14, 0, TAU, true);
      g.fillStyle = col; g.fill(p, 'evenodd'); g.strokeStyle = INK; g.lineWidth = L; g.stroke(p);
      break;
    }
    case 'cart': {
      const p = P(); p.moveTo(-44, -30); p.lineTo(-30, -30); p.lineTo(-20, 16); p.lineTo(30, 16); p.lineTo(40, -18); p.lineTo(-26, -18);
      g.strokeStyle = INK; g.lineWidth = 10 + L * 2; g.stroke(p); g.strokeStyle = col; g.lineWidth = 10; g.stroke(p);
      const b = P(); b.moveTo(-22, -14); b.lineTo(36, -14); b.lineTo(28, 12); b.lineTo(-17, 12); b.closePath(); fs(b);
      for (const wx of [-14, 24]) { const w = P(); w.arc(wx, 32, 8, 0, TAU); fs(w); }
      break;
    }
    case 'paw': {
      const p = P(); p.ellipse(0, 14, 24, 20, 0, 0, TAU); fs(p);
      for (const [px, py, r] of [[-30, -10, 10], [-12, -30, 11], [12, -30, 11], [30, -10, 10]]) { const q = P(); q.ellipse(px, py, r, r * 1.2, px * 0.01, 0, TAU); fs(q); }
      break;
    }
    case 'calendar': {
      const p = P(); rrP(p, -38, -30, 76, 68, 10); fs(p);
      const t = P(); rrP(t, -38, -30, 76, 20, 8); g.fillStyle = TOMATO; g.fill(t); g.strokeStyle = INK; g.lineWidth = L; g.stroke(t);
      for (const rx of [-20, 20]) { const r = P(); rrP(r, rx - 5, -44, 10, 22, 5); fs(r); }
      g.fillStyle = INK; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc(-20 + i * 20, 4 + j * 18, 5, 0, TAU); g.fill(); }
      break;
    }
    case 'share': {
      const p = P(); p.moveTo(-22, 0); p.lineTo(22, -24); p.moveTo(-22, 0); p.lineTo(22, 24); thick(p, 8);
      for (const [cx, cy] of [[-24, 0], [24, -26], [24, 26]]) { const q = P(); q.arc(cx, cy, 13, 0, TAU); fs(q); }
      break;
    }
    case 'lock': { g.scale(1 / k, 1 / k); drawPadlock(g, 0, 6 * k, 64 * k, 0); break; }
    case 'close': { const p = P(); p.moveTo(-26, -26); p.lineTo(26, 26); p.moveTo(26, -26); p.lineTo(-26, 26); thick(p, 14); break; }
    case 'home': {
      const p = P(); p.moveTo(0, -42); p.lineTo(42, -4); p.lineTo(30, -4); p.lineTo(30, 36); p.lineTo(-30, 36); p.lineTo(-30, -4); p.lineTo(-42, -4); p.closePath(); fs(p);
      const d = P(); rrP(d, -10, 10, 20, 26, 4); g.fillStyle = INK; g.fill(d);
      break;
    }
    case 'music': { const p = P(); p.moveTo(-8, 22); p.lineTo(-8, -32); p.lineTo(30, -40); p.lineTo(30, 14); thick(p, 9); for (const [cx, cy] of [[-18, 24], [20, 16]]) { const q = P(); q.ellipse(cx, cy, 13, 10, -0.3, 0, TAU); fs(q); } break; }
    case 'sfx': { const p = P(); p.moveTo(-36, -12); p.lineTo(-20, -12); p.lineTo(4, -32); p.lineTo(4, 32); p.lineTo(-20, 12); p.lineTo(-36, 12); p.closePath(); fs(p); const w = P(); w.arc(6, 0, 20, -0.8, 0.8); w.moveTo(6 + Math.cos(-0.8) * 34, Math.sin(-0.8) * 34); w.arc(6, 0, 34, -0.8, 0.8); g.strokeStyle = INK; g.lineWidth = 7; g.stroke(w); break; }
    case 'map': { const p = P(); p.moveTo(-40, -28); p.lineTo(-14, -36); p.lineTo(14, -28); p.lineTo(40, -36); p.lineTo(40, 28); p.lineTo(14, 36); p.lineTo(-14, 28); p.lineTo(-40, 36); p.closePath(); fs(p); g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(-14, -36); g.lineTo(-14, 28); g.moveTo(14, -28); g.lineTo(14, 36); g.stroke(); break; }
  }
  g.restore();
}
function rrP(p, x, y, w, h, r) { p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath(); }

// ------------------------------------------------------------------ particles
function partCol(c, k = 0) { return typeof c === 'number' ? (c === RAINBOW ? RAIN[k % 6] : YARN[c] ? YARN[c].base : k % 2 ? GOLD : CREAM) : c || CREAM; }
export function drawParticles(g, parts, scale = 1) {
  for (const p of parts) {
    const a = clamp(1 - p.t / (p.life || 1), 0, 1);
    if (a <= 0) continue;
    const r = (p.r || 4) * scale;
    if (p.kind === 'fluff') {
      g.fillStyle = mix(typeof p.c === 'number' && YARN[p.c] ? YARN[p.c].base : '#FFF4E4', '#FFFFFF', 0.25, a * 0.9);
      g.beginPath(); g.arc(p.x, p.y, r * (0.6 + 0.4 * a), 0, TAU); g.arc(p.x + r * 0.6, p.y - r * 0.3, r * 0.6 * (0.6 + 0.4 * a), 0, TAU); g.fill();
    } else if (p.kind === 'conf') {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0);
      g.globalAlpha = Math.min(1, a * 2);
      g.fillStyle = partCol(p.c, ((p.vr || 0) * 100) | 0); g.fillRect(-r, -r * 0.45, r * 2, r * 0.9);
      g.fillStyle = 'rgba(43,36,64,0.25)'; g.fillRect(-r, r * 0.2, r * 2, r * 0.25);
      g.restore();
    } else if (p.kind === 'heart') drawHeart(g, p.x, p.y, r, Math.min(1, a * 2));
    else if (p.kind === 'spark') {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0); g.globalAlpha = a;
      g.fillStyle = p.c ? partCol(p.c) : '#FFF3B0';
      const q = r * 0.3;
      g.beginPath(); g.moveTo(0, -r); g.lineTo(q, -q); g.lineTo(r, 0); g.lineTo(q, q); g.lineTo(0, r); g.lineTo(-q, q); g.lineTo(-r, 0); g.lineTo(-q, -q); g.closePath(); g.fill();
      g.restore();
    } else if (p.kind === 'coin' || p.kind === 'text') {
      g.globalAlpha = Math.min(1, a * 2);
      text(g, p.txt || '+1', p.x, p.y, r * 3, { color: GOLD, stroke: INK, strokeW: r * 0.7 });
      g.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------ the play view
let lastT = 0, fullT = -9, blockedT = -9, pawTw = new Map();
const fx = new WeakMap(); // per session transient memory
bus.on('full', () => { fullT = lastT; });
bus.on('blocked', d => { blockedT = lastT; if (d && d.why === 'paw') pawTw.set(d.id, lastT); });
bus.on('levelStart', () => { fullT = -9; blockedT = -9; pawTw = new Map(); });

let bake = { cv: null, board: null, key: '', bkey: '', geo: null, box: null };
export function invalidate() { bake.key = ''; bake.bkey = ''; }

function flightTarget(dest, rs, bs) {
  if (dest && dest.kind === 'spool' && rs.active[dest.slot]) { const a = rs.active[dest.slot]; return { x: a.x, y: a.y, h: a.h }; }
  if (dest && dest.kind === 'basket' && bs[dest.b]) return bs[dest.b];
  return bs[0] || { x: 0, y: 0 };
}
function subPoly(pts, at, s0, s1) {
  const out = [];
  const pa = pointAt(pts, at, s0); out.push([pa.x, pa.y]);
  for (let i = 0; i < pts.length; i++) if (at[i] > s0 && at[i] < s1) out.push(pts[i]);
  const pb = pointAt(pts, at, s1); out.push([pb.x, pb.y]);
  return out;
}
function flightPath(f, gi, tgt, u) {
  const key = tgt.x.toFixed(1) + ',' + tgt.y.toFixed(1) + ',' + gi.pts.length;
  if (f._fp && f._fpk === key && f._fpg === gi) return f._fp;
  const pts = f.rev ? gi.pts.slice().reverse() : gi.pts.slice();
  const h = pts[pts.length - 1];
  const dist = Math.hypot(tgt.x - h[0], tgt.y - h[1]);
  const cx = (h[0] + tgt.x) / 2 + (tgt.x > h[0] ? -1 : 1) * dist * 0.08, cy = Math.min(h[1], tgt.y) - dist * 0.25 - 20 * u;
  for (let k = 1; k <= 24; k++) { const t = k / 24, q = 1 - t; pts.push([q * q * h[0] + 2 * q * t * cx + t * t * tgt.x, q * q * h[1] + 2 * q * t * cy + t * t * tgt.y]); }
  const at = arcLen(pts);
  const fp = { pts, at, Ls: gi.len, Ltot: at[at.length - 1] };
  f._fp = fp; f._fpk = key; f._fpg = gi;
  return fp;
}

function strandState(sess) {
  const st = sess.st, puz = sess.puz;
  const removed = st.removed >>> 0;
  const lifted = sess.lifted || new Set();
  const on = [], free = [], cov = [];
  for (let i = 0; i < puz.n; i++) {
    if ((removed >>> i) & 1) continue;
    on.push(i);
    (lifted.has(i) ? free : cov).push(i);
  }
  const byD = (a, b) => puz.strands[a].d - puz.strands[b].d;
  return { on: on.sort(byD), free: free.sort(byD), cov: cov.sort(byD), removed };
}
function isMyst(sess, i) {
  const s = sess.puz.strands[i];
  return !!(s.m && !(sess.revealT && sess.revealT.has(i)));
}

/** Everything inside a level session (§13.5). Called after scene.drawScene. */
export function drawPlay(g, S) {
  const sess = S.sess;
  if (!sess || !sess.geo || !sess.B) return;
  const T = S.T; lastT = T;
  const puz = sess.puz, st = sess.st, B = sess.B, geo = sess.geo, sw = B.sw || geo[0]?.sw || 8;
  const u = B.unit;
  const L = S.L;
  const ui = L ? L.u : 1;
  const ss = strandState(sess);
  let mem = fx.get(sess);
  if (!mem) { mem = { keys: new Map(), paws: new Map(), ice: null, lockOpen: new Map() }; fx.set(sess, mem); }
  for (const gi of geo) gi.B = B;
  g.save();
  if (sess.shake) { const k = sess.shake; g.translate((hash((T * 60) | 0, 1) - 0.5) * k * 2, (hash((T * 60) | 0, 2) - 0.5) * k * 2); }

  // ---- static board + covered strands (baked)
  const box = boardBox(B, puz.cols, puz.rows);
  const pad = Math.max(10, u * 0.5);
  const bx = Math.floor(box.ox - pad), by = Math.floor(box.oy - pad);
  const bw = Math.ceil(box.ow + pad * 2), bh = Math.ceil(box.kit.y + box.ledgeH * 2 - box.oy + pad * 2);
  const dpr = S.dpr || 1;
  const bkey = [bx, by, bw, bh, dpr, u.toFixed(3), puz.cols, puz.rows, sess.level && sess.level.shape, sess.id].join('|');
  if (bake.bkey !== bkey || !bake.board) {
    bake.board = mkCanvas(bw * dpr, bh * dpr);
    const bg = bake.board.getContext('2d');
    bg.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
    drawBoardStatic(bg, B, puz.cols, puz.rows, sess.level && sess.level.shape);
    bake.bkey = bkey; bake.key = '';
    try {
      feltPattern = bg.createPattern(bake.board, 'no-repeat');
      if (feltPattern && feltPattern.setTransform) feltPattern.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, bx, by]));
      else feltPattern = null;
    } catch (e) { feltPattern = null; }
  }
  const wiggling = sess.wiggles && sess.wiggles.size > 0 && [...sess.wiggles.values()].some(t0 => T - t0 < DUR.wiggle);
  const pegR = Math.max(3.5, u * 0.16);
  const drawCovered = (gg, i, dx = 0, dy = 0, wt = null) => {
    const gi = geo[i], c = puz.strands[i].c, my = isMyst(sess, i);
    drawStrand(gg, gi, c, sw, { dim: true, mystery: my, wiggleT: wt, dx, dy });
    drawStrandPegs(gg, gi, c, sw, pegR, true, 0, 0, my);
  };
  const key = [sess.bakeKey || '', ss.removed, ss.cov.join(','), sess.revealT ? sess.revealT.size : 0, bkey, geo.length, geo[0] && geo[0].pts[0][0].toFixed(1)].join('#');
  if (!wiggling) {
    if (bake.key !== key || bake.geo !== geo || !bake.cv) {
      if (!bake.cv || bake.cv.width !== bake.board.width || bake.cv.height !== bake.board.height) bake.cv = mkCanvas(bake.board.width, bake.board.height);
      const cg = bake.cv.getContext('2d');
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.clearRect(0, 0, bake.cv.width, bake.cv.height);
      cg.drawImage(bake.board, 0, 0);
      cg.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
      for (let i = 0; i < puz.n; i++) if ((ss.removed >>> i) & 1 && geo[i]) for (const q of geo[i].pegs) drawPeg(cg, q[0], q[1], pegR * 0.9);
      for (const i of ss.cov) drawCovered(cg, i);
      bake.key = key; bake.geo = geo;
    }
    g.drawImage(bake.cv, bx, by, bw, bh);
  } else {
    g.drawImage(bake.board, bx, by, bw, bh);
    for (let i = 0; i < puz.n; i++) if ((ss.removed >>> i) & 1 && geo[i]) for (const q of geo[i].pegs) drawPeg(g, q[0], q[1], pegR * 0.9);
    for (const i of ss.cov) {
      const w0 = sess.wiggles.get(i);
      drawCovered(g, i, 0, 0, w0 != null && T - w0 < DUR.wiggle ? T - w0 : null);
    }
  }

  // ---- free strands live: lifted, glow, bob, hint rim, press lift
  const press = sess.press;
  for (const i of ss.free) {
    const gi = geo[i], c = puz.strands[i].c;
    const bob = (Math.sin(T * 2.2 * TAU + i * 1.7) * 0.5 + 0.5) * 1.5;
    const pressed = press && press.id === i && press.ok;
    const hint = sess.hint && sess.hint.id === i && T < sess.hint.until ? 0.5 + 0.5 * Math.sin(T * 8) : 0;
    const rv = sess.revealT && sess.revealT.has(i) ? clamp((T - sess.revealT.get(i)) / 0.35, 0, 1) : null;
    const my = isMyst(sess, i);
    const w0 = sess.wiggles && sess.wiggles.get(i);
    const dy = -bob - (pressed ? 3 : 0);
    const f0 = sess.flash && sess.flash.get(i);
    const flash = f0 != null && T - f0 < 0.3 ? 1 - (T - f0) / 0.3 : 0;
    drawStrand(g, gi, c, sw, { lift: pressed ? 2 : 1, glow: 1, hint, flash, mystery: my, reveal: rv, dy, wiggleT: w0 != null && T - w0 < DUR.wiggle ? T - w0 : null });
    drawStrandPegs(g, gi, c, sw, pegR, false, 0, 0, my);
    if (rv != null && rv < 1) {
      const m = pointAt(gi.pts, gi.at, gi.len / 2);
      g.strokeStyle = `rgba(255,255,255,${1 - rv})`; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x, m.y + dy, sw * (1 + rv * 3), 0, TAU); g.stroke();
    }
  }

  // ---- twist props
  drawTwists(g, S, sess, ss, mem, u, sw);

  // ---- kitten on the ledge
  const kit = sess.kitten || { stage: 0, loops: 4 };
  const id = sess.id || 0;
  const lc = [];
  for (const s of puz.strands) if (s.c >= 0 && s.c < 6 && !lc.includes(s.c)) lc.push(s.c);
  const flinch = Math.max(kit.flinch && kit.flinch <= 1 ? kit.flinch : 0, T - blockedT < 0.25 ? 1 - (T - blockedT) / 0.25 : 0);
  drawKitten(g, box.kit.x, box.kit.y, box.kit.s, {
    stage: kit.stage, loops: kit.loops, flinch, freeT: kit.freeT, golden: kit.golden, t: T,
    breed: id > 0 ? (id - 1) % 6 : 0, coat: id > 0 ? Math.floor((id - 1) / 6) : 0, loopColors: lc.slice(0, 4), memKey: sess,
  });

  // ---- blocker rings
  if (sess.rings) for (const r of sess.rings) {
    const a = (T - r.t0) / DUR.ring;
    if (a < 0 || a >= 1) continue;
    const R = u * 0.45 * (1 + 0.25 * easeOut(Math.min(1, a * 3)));
    g.globalAlpha = 1 - a * a;
    g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.arc(r.x, r.y, R, 0, TAU); g.stroke();
    g.strokeStyle = TOMATO; g.lineWidth = 3; g.stroke();
    g.globalAlpha = 1;
  }
  // ---- snip booster: scissors pop at the strand's middle, then fade (0.6 s)
  if (sess.snipFx) for (const f of sess.snipFx) {
    const a = (T - f.t0) / 0.6, gi = geo[f.id];
    if (a < 0 || a >= 1 || !gi) continue;
    const m = pointAt(gi.pts, gi.at, gi.len / 2);
    const sc = u * 0.9 * (a < 0.25 ? easeOutBack(a / 0.25) : 1);
    g.save(); g.globalAlpha = 1 - Math.max(0, (a - 0.5) / 0.5);
    g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 2.5;
    g.beginPath(); g.arc(m.x, m.y - a * u * 0.6, sc * 0.62, 0, TAU); g.fill(); g.stroke();
    drawIcon(g, 'snip', m.x, m.y - a * u * 0.6, sc * 0.8, TOMATO);
    g.restore();
  }
  g.restore();

  // ---- rack + Kitty
  const rs = L ? rackSlots(L) : null;
  const cap = st.basket ? st.basket.length : puz.cap;
  const bs = L ? basketSlots(L, cap) : [];
  if (rs) drawRack(g, S, sess, rs, ui, T);
  if (bs.length) drawBasket(g, S, sess, bs, ui, T, mem);

  // ---- press preview ghost arc
  if (press && press.ok && press.dest && rs) {
    const d = Array.isArray(press.dest) ? press.dest.find(e => e.id === press.id) || press.dest[0] : press.dest;
    const gi = geo[press.id];
    if (d && gi) {
      const tgt = flightTarget(d, rs, bs);
      const a = gi.pts[0], b = gi.pts[gi.pts.length - 1];
      const h = Math.hypot(a[0] - tgt.x, a[1] - tgt.y) < Math.hypot(b[0] - tgt.x, b[1] - tgt.y) ? a : b;
      const dist = Math.hypot(tgt.x - h[0], tgt.y - h[1]);
      const cx = (h[0] + tgt.x) / 2, cy = Math.min(h[1], tgt.y) - dist * 0.25 - 20 * ui;
      g.save();
      g.setLineDash([6, 6]); g.lineDashOffset = -T * 30;
      g.strokeStyle = 'rgba(255,244,228,0.4)'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(h[0], h[1]); g.quadraticCurveTo(cx, cy, tgt.x, tgt.y); g.stroke();
      g.setLineDash([]);
      const pr = (tgt.r || (tgt.h ? tgt.h * 0.45 : 16)) * (1.1 + 0.12 * Math.sin(T * 10));
      g.strokeStyle = 'rgba(255,244,228,0.75)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(tgt.x, tgt.y, pr, 0, TAU); g.stroke();
      g.restore();
    }
  }

  // ---- flights (strands then balls), on top of everything
  if (sess.flights) for (const f of sess.flights) {
    if (f.kind === 'ball') {
      if (f.wait || T < f.t0) continue; // still sitting in the basket
      const p = clamp(f.p || 0, 0, 1);
      const bi = f.b != null ? f.b : 0;
      const slot = f.dest && f.dest.slot != null ? f.dest.slot : 0;
      const from = f.from && f.from.x != null ? f.from : bs[bi] || bs[0];
      const to = rs ? rs.active[slot] || rs.active[0] : null;
      if (!from || !to) continue;
      const r0 = (bs[bi] || bs[0] || { r: 12 }).r;
      const e = ease(p);
      const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e - Math.sin(p * Math.PI) * 60 * ui;
      drawBall(g, x, y, r0 * 0.92 * (1 - 0.4 * p), f.c, { glyph: p < 0.6 });
      continue;
    }
    const gi = geo[f.id];
    if (!gi) continue;
    let fp = f.path;
    if (!fp) { if (!rs) continue; fp = flightPath(f, gi, flightTarget(f.dest, rs, bs), ui); }
    const p = clamp(f.p || 0, 0, 1);
    const pe = p <= 0 ? 0 : p >= 1 ? 1 : p * p * (1.6 - 0.6 * p);
    const s0 = pe * fp.Ltot, s1 = Math.min(fp.Ltot, s0 + fp.Ls);
    if (s1 - s0 < 1) continue;
    const lift = Math.min(1, (T - (f.t0 || 0)) / (f.lift || DUR.lift)) * sw * 0.5;
    const pts = subPoly(fp.pts, fp.at, s0, s1).map(q => [q[0], q[1] - lift]);
    if (pts.length < 2) continue;
    const sp = strandPaths(pts, sw, f.c, u);
    drawStrand(g, sp, f.c, sw, { lift: 2, gap: false });
  }

  // ---- particles (p.r is already in CSS px)
  if (sess.parts && sess.parts.length) drawParticles(g, sess.parts, 1);
}

function drawTwists(g, S, sess, ss, mem, u, sw) {
  const puz = sess.puz, st = sess.st, T = S.T, geo = sess.geo;
  const removed = ss.removed;
  const gone = i => ((removed >>> i) & 1) === 1;
  // knot beads on the crossing of each knot pair
  const knots = (sess.level && sess.level.knots) || [];
  for (const [a, b] of knots) {
    if (gone(a) || gone(b)) continue;
    const x = puz.crossings && puz.crossings.find(c => (c.top === a && c.under === b) || (c.top === b && c.under === a));
    let px, py;
    if (x) { px = sess.B.ox + x.x * u; py = sess.B.oy + x.y * u; }
    else { const m = crossPts(geo[a].pts, geo[b].pts)[0]; if (!m) continue; [px, py] = m; }
    const lift = sess.lifted && (sess.lifted.has(a) || sess.lifted.has(b));
    drawKnotBead(g, px, py - (lift ? 1.5 : 0), Math.max(5, u * 0.32 * 0.75));
  }
  // locks + keys
  puz.strands.forEach((s, i) => {
    if (s.key != null && s.key >= 0) {
      if (!gone(i)) {
        const gi = geo[i], m = pointAt(gi.pts, gi.at, gi.len / 2);
        const free = sess.lifted && sess.lifted.has(i);
        const pulse = free ? 1 + 0.1 * Math.sin(T * 6) : 1;
        drawKeyCharm(g, m.x, m.y - (free ? 1.5 : 0), u * 0.42 * pulse, s.key, Math.sin(T * 2 + i) * 0.15);
        mem.keys.set(s.key, { x: m.x, y: m.y });
      }
    }
  });
  puz.strands.forEach((s, i) => {
    if (s.lock == null || s.lock < 0 || gone(i)) return;
    const keyId = puz.strands.findIndex(o => o.key === s.lock);
    const p = geo[i].pegs[0];
    const open = keyId < 0 || gone(keyId);
    let lo = mem.lockOpen.get(i);
    if (open && lo == null) { lo = T; mem.lockOpen.set(i, T); }
    if (!open) mem.lockOpen.delete(i);
    const sz = Math.max(10, u * 0.42);
    if (!open) {
      const fx0 = sess.unlockFx && sess.unlockFx.find(f => f.id === i && f.kind === 'jiggle');
      const ja = fx0 ? T - fx0.t0 : 9;
      const jig = ja < 0.4 ? Math.sin(ja * 50) * (1 - ja / 0.4) * 0.35 : 0;
      g.save(); g.translate(p[0], p[1]); g.rotate(jig); g.translate(-p[0], -p[1]);
      drawPadlock(g, p[0], p[1] - sz * 0.15, sz, s.lock, 0);
      g.restore();
    } else {
      const a = (T - lo);
      if (a < 0.4) { // key flies in
        const k = mem.keys.get(s.lock) || { x: p[0], y: p[1] }, e = ease(a / 0.4);
        drawPadlock(g, p[0], p[1] - sz * 0.15, sz, s.lock, 0);
        drawKeyCharm(g, k.x + (p[0] - k.x) * e, k.y + (p[1] - k.y) * e - Math.sin(e * Math.PI) * u, u * 0.42, s.lock, e * 3);
      } else if (a < 1.0) { // pops open and drops
        const q = (a - 0.4) / 0.6;
        g.save(); g.globalAlpha = 1 - q;
        drawPadlock(g, p[0] + q * u * 0.3, p[1] - sz * 0.15 + q * q * u * 1.5, sz, s.lock, 1);
        g.restore();
      }
    }
  });
  // sleepy paws
  puz.strands.forEach((s, i) => {
    if (!s.paw || gone(i)) return;
    const left = Math.max(0, s.paw - (st.count || 0));
    const gi = geo[i];
    const cx = sess.B.ox + (puz.cols - 1) * u / 2, cy = sess.B.oy + (puz.rows - 1) * u / 2;
    let best = gi.pegs[0], bd = Infinity;
    for (const p of gi.pegs) { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d < bd) { bd = d; best = p; } }
    let lt = mem.paws.get(i);
    if (left === 0 && lt == null) { lt = T; mem.paws.set(i, T); }
    if (left > 0) mem.paws.delete(i);
    const lift = left === 0 ? clamp((T - lt) / 0.5, 0, 1) : 0;
    if (lift >= 1) return;
    const pf = sess.pawFx && sess.pawFx.filter(f => f.id === i && f.kind === 'twitch').pop();
    const tw = pf ? T - pf.t0 : pawTw.has(i) ? T - pawTw.get(i) : -1;
    drawPaw(g, best[0], best[1], u * 0.55, left, T + i, lift, tw >= 0 && tw < 0.4 ? tw : 0);
  });
}

function drawRack(g, S, sess, rs, ui, T) {
  const st = sess.st, puz = sess.puz;
  const act = rs.active.slice(0, Math.max(1, Math.min(2, (sess.slots || []).length || 2)));
  const nActive = (sess.slots || []).filter(s => s && (s.cur || s.leaving)).length || (st.sc ? st.sc.filter(c => c >= 0).length : 2);
  const use = nActive <= 1 && (puz.spools ? puz.spools.length : (sess.level?.queue?.length || 2)) <= 1 ? act.slice(0, 1) : act;
  // shelf plank under active + next spools
  const all = [...use, ...rs.next];
  let x0 = Infinity, x1 = -Infinity, py = -Infinity;
  for (const p of use) { x0 = Math.min(x0, p.x - p.h * 0.62); x1 = Math.max(x1, p.x + p.h * 0.62); py = Math.max(py, p.y + p.h * 0.5); }
  const hasNext = sess.nextQ && sess.nextQ.length;
  if (hasNext) for (const p of rs.next) { x0 = Math.min(x0, p.x - p.h * 0.6); x1 = Math.max(x1, p.x + p.h * 0.6); }
  void all;
  if (isFinite(x0)) {
    const th = Math.max(6, 9 * ui);
    g.fillStyle = 'rgba(30,14,20,0.3)'; rr(g, x0 + 3, py + 4, x1 - x0, th, th * 0.45); g.fill();
    const pg = g.createLinearGradient(0, py, 0, py + th);
    pg.addColorStop(0, WALNUT_L); pg.addColorStop(1, WALNUT_D);
    g.fillStyle = pg; rr(g, x0, py, x1 - x0, th, th * 0.45); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke();
    // brackets
    for (const bx of [x0 + th * 1.5, x1 - th * 1.5]) {
      g.fillStyle = WALNUT_D; g.beginPath(); g.moveTo(bx - th * 0.5, py + th); g.lineTo(bx + th * 0.5, py + th); g.lineTo(bx, py + th * 2.6); g.closePath(); g.fill(); g.stroke();
    }
  }
  // next queue (NEXT larger, next-next smaller), with label + "+N" chip
  if (hasNext) {
    const n0 = rs.next[0];
    text(g, 'NEXT', n0.x, n0.y - n0.h * 0.5 - n0.h * 0.16 - Math.max(8, 10 * ui), Math.max(10, 11 * ui), { font: FONT_B, weight: 900, color: CREAM, stroke: INK, strokeW: Math.max(3, 3.5 * ui) });
    sess.nextQ.slice(0, 2).forEach((q, i) => {
      const p = rs.next[i];
      if (!p || !q) return;
      drawSpool(g, p.x, p.y, p.h, q.c, 0, q.n || 3, { pips: false, alpha: i === 0 ? 1 : 0.85 });
    });
    const total = puz.spools ? puz.spools.length : (sess.level && sess.level.queue ? sess.level.queue.length : 0);
    const more = sess.moreN != null ? sess.moreN : total - (st.next || 0) - Math.min(2, sess.nextQ.length);
    if (more > 0 && rs.more) {
      const r = Math.max(10, 12 * ui);
      g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 2;
      rr(g, rs.more.x - r * 1.1, rs.more.y - r * 0.75, r * 2.2, r * 1.5, r * 0.75); g.fill(); g.stroke();
      text(g, '+' + more, rs.more.x, rs.more.y + 1, r * 1.05, { color: INK });
    }
  }
  // active slots: leaving spool rolls off right; current rolls in from the NEXT shelf
  (sess.slots || []).forEach((s, k) => {
    const p = rs.active[k];
    if (!p || !s) return;
    if (s.leaving) {
      const a = clamp((T - s.leaveT) / DUR.spoolLeave, 0, 1);
      const hop = Math.sin(Math.min(1, a * 2.2) * Math.PI) * p.h * 0.35;
      const dx = a * a * p.h * 2.6;
      g.save(); g.globalAlpha = 1 - Math.max(0, (a - 0.6) / 0.4);
      drawSpool(g, p.x + dx, p.y - hop, p.h, s.leaving.c, s.leaving.n || 3, s.leaving.n || 3, { rot: a * 5, pips: false, spin: T * 6 });
      g.restore();
    }
    if (s.cur) {
      const e = s.enterT != null ? clamp((T - s.enterT) / DUR.spoolEnter, 0, 1) : 1;
      const from = rs.next[0] || p;
      const ee = easeOutBack(e);
      const x = from.x + (p.x - from.x) * ee, y = from.y + (p.y - from.y) * ee - Math.sin(e * Math.PI) * p.h * 0.25;
      const sc = (from.h + (p.h - from.h) * ease(e)) / p.h;
      const want = sess.lifted ? [...sess.lifted].some(i => sess.puz.strands[i].c === s.cur.c) : false;
      drawSpool(g, x, y, p.h, s.cur.c, s.cur.shown || 0, s.cur.n || 3, { scale: sc, bounce: s.cur.bounce || 0, spin: s.cur.spin || 0, pips: e >= 1, want: want ? 0.6 + 0.4 * Math.sin(T * 4) : 0 });
    }
  });
  // Kitty
  if (rs.kitty) {
    const ky = sess.kitty || { anim: 'idle', t0: 0 };
    drawKitty(g, rs.kitty.x, rs.kitty.y, rs.kitty.s, ky.anim || 'idle', T - (ky.t0 || 0), S.outfit || 'tabby');
  }
}

const basketCache = { key: '', cv: null, box: null };
function drawBasket(g, S, sess, bs, ui, T, mem) {
  const st = sess.st, puz = sess.puz;
  const cap = bs.length;
  const r = bs[0].r;
  const x0 = bs[0].x - r * 1.55, x1 = bs[cap - 1].x + r * 1.55, cy = bs[0].y;
  const top = cy - r * 1.25, hh = r * 2.75;
  const dpr = S.dpr || 1;
  const key = [x0, x1, cy, r, cap, dpr].map(v => (+v).toFixed(1)).join('|');
  const m = r * 0.6;
  if (basketCache.key !== key) {
    const W = x1 - x0 + m * 2, H = hh + m * 2 + r * 0.4;
    basketCache.cv = mkCanvas(W * dpr, H * dpr);
    const bg = basketCache.cv.getContext('2d');
    bg.setTransform(dpr, 0, 0, dpr, (-x0 + m) * dpr, (-top + m) * dpr);
    // shadow
    bg.fillStyle = 'rgba(30,14,20,0.3)'; rr(bg, x0 + 3, top + 6, x1 - x0, hh, r * 0.8); bg.fill();
    // weave
    rr(bg, x0, top, x1 - x0, hh, r * 0.8);
    bg.fillStyle = '#C98B4E'; bg.fill();
    bg.save(); bg.clip();
    const rowH = r * 0.42;
    for (let y = top, row = 0; y < top + hh; y += rowH, row++) {
      bg.fillStyle = row % 2 ? '#A86A34' : '#C98B4E'; bg.fillRect(x0, y, x1 - x0, rowH);
      for (let x = x0 + (row % 2) * r * 0.45; x < x1; x += r * 0.9) {
        bg.fillStyle = row % 2 ? '#C98B4E' : '#B7783E';
        rr(bg, x, y + 1, r * 0.45, rowH - 2, rowH * 0.4); bg.fill();
      }
    }
    bg.strokeStyle = 'rgba(70,35,15,0.35)'; bg.lineWidth = 1;
    for (let y = top; y < top + hh; y += rowH) { bg.beginPath(); bg.moveTo(x0, y); bg.lineTo(x1, y); bg.stroke(); }
    const sh = bg.createLinearGradient(0, top, 0, top + hh);
    sh.addColorStop(0, 'rgba(255,230,190,0.25)'); sh.addColorStop(0.4, 'rgba(255,230,190,0)'); sh.addColorStop(1, 'rgba(60,25,10,0.35)');
    bg.fillStyle = sh; bg.fillRect(x0, top, x1 - x0, hh);
    bg.restore();
    // rim
    bg.lineWidth = r * 0.28; bg.strokeStyle = '#8A5228';
    rr(bg, x0, top, x1 - x0, hh, r * 0.8); bg.stroke();
    bg.lineWidth = 1.8; bg.strokeStyle = INK;
    rr(bg, x0 - r * 0.14, top - r * 0.14, x1 - x0 + r * 0.28, hh + r * 0.28, r * 0.9); bg.stroke();
    // wells
    for (const p of bs) {
      const wg = bg.createRadialGradient(p.x, p.y - p.r * 0.3, 0, p.x, p.y, p.r * 1.05);
      wg.addColorStop(0, 'rgba(60,28,12,0.65)'); wg.addColorStop(1, 'rgba(60,28,12,0.25)');
      bg.fillStyle = wg; bg.beginPath(); bg.ellipse(p.x, p.y + p.r * 0.05, p.r * 1.05, p.r * 0.98, 0, 0, TAU); bg.fill();
      bg.strokeStyle = 'rgba(255,220,170,0.35)'; bg.lineWidth = 1.2; bg.beginPath(); bg.arc(p.x, p.y + p.r * 0.05, p.r * 1.05, 0.2, Math.PI - 0.2); bg.stroke();
    }
    basketCache.key = key;
    basketCache.box = { x: x0 - m, y: top - m, w: W, h: H };
  }
  const bx = basketCache.box;
  const shT = sess.basketShake != null && sess.basketShake >= 0 ? T - sess.basketShake : T - fullT;
  const shake = shT >= 0 && shT < 0.5 ? Math.sin(shT * 60) * r * 0.18 * (1 - shT / 0.5) : 0;
  g.save();
  if (shake) g.translate(shake, 0);
  g.drawImage(basketCache.cv, bx.x, bx.y, bx.w, bx.h);
  // state glows: amber at cap−1, red when full / refused / stuck
  const thaw = puz.ice || 0;
  const left = sess.iceLeft != null ? sess.iceLeft : Math.max(0, thaw - (st.done || 0));
  const iced = thaw > 0 && left > 0;
  const effCap = cap - (iced ? 1 : 0);
  const bt = st.bt || 0;
  const flash = shT >= 0 && shT < 0.7 ? 1 - shT / 0.7 : 0;
  const red = sess.stuck || flash > 0;
  if (red || bt === effCap - 1 && effCap > 1) {
    const pulse = 0.55 + 0.45 * Math.sin(T * (red ? 12 : 5));
    g.strokeStyle = red ? alpha(TOMATO, Math.max(flash, sess.stuck ? 1 : 0) * pulse) : alpha(AMBER, 0.85 * pulse);
    g.lineWidth = 4 * Math.max(1, ui * 0.8);
    rr(g, x0 - r * 0.25, top - r * 0.25, x1 - x0 + r * 0.5, hh + r * 0.5, r); g.stroke();
  }
  // 3★ line after slot `par` (from L4, or daily/bonus)
  const par = sess.level ? sess.level.par : puz.par;
  const id = sess.id || 0;
  if (par != null && par < effCap && (id === 0 || id >= 4)) {
    const xm = par === 0 ? bs[0].x - r * 1.3 : (bs[par - 1].x + bs[par].x) / 2;
    g.save();
    g.setLineDash([4, 3]); g.strokeStyle = GOLD; g.lineWidth = 3;
    g.beginPath(); g.moveTo(xm, top - r * 0.1); g.lineTo(xm, top + hh + r * 0.1); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(xm - 1.6, top); g.lineTo(xm - 1.6, top + hh); g.moveTo(xm + 1.6, top); g.lineTo(xm + 1.6, top + hh); g.stroke();
    drawStar(g, xm, top - r * 0.35, r * 0.42, true);
    g.restore();
  }
  // balls
  const vis = sess.basket || [];
  for (let b = 0; b < cap; b++) {
    const p = bs[b], v = vis[b];
    if (v && v.arrived !== false) drawBall(g, p.x, p.y, p.r * 0.92, v.c, { bounce: v.bounce || 0 });
  }
  // ice slot (last) with crack stages; shatter when thawed
  if (thaw) {
    const p = bs[Math.min(cap, puz.cap || cap) - 1];
    if (iced) { mem.ice = null; drawIce(g, p.x, p.y, p.r, 1 - left / thaw, T); }
    else {
      if (mem.ice == null) mem.ice = T;
      const a = (T - mem.ice) / 0.5;
      if (a < 1) {
        for (let i = 0; i < 7; i++) {
          const ang = i * 0.9 + 0.3, d = p.r * (0.3 + a * 1.6);
          g.save(); g.translate(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d - Math.sin(a * Math.PI) * p.r * 0.5); g.rotate(a * 4 + i);
          g.globalAlpha = 1 - a; g.fillStyle = '#BFE6F5'; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.moveTo(0, -p.r * 0.25); g.lineTo(p.r * 0.2, p.r * 0.15); g.lineTo(-p.r * 0.2, p.r * 0.12); g.closePath(); g.fill(); g.stroke();
          g.restore();
        }
      }
    }
  }
  g.restore();
}
function drawIce(g, x, y, r, crack, T) {
  const s = r * 1.9;
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(43,36,64,0.25)'; rr(g, -s / 2 + 2, -s / 2 + 3, s, s, r * 0.3); g.fill();
  const ig = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
  ig.addColorStop(0, '#E9F8FF'); ig.addColorStop(0.5, '#BFE6F5'); ig.addColorStop(1, '#8CCBE6');
  g.fillStyle = ig; rr(g, -s / 2, -s / 2, s, s, r * 0.3); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-s * 0.32, -s * 0.15); g.lineTo(-s * 0.32, -s * 0.32); g.lineTo(-s * 0.12, -s * 0.32); g.stroke();
  g.strokeStyle = 'rgba(43,36,64,0.7)'; g.lineWidth = 1.3;
  if (crack > 0) { g.beginPath(); g.moveTo(-s * 0.1, -s * 0.5); g.lineTo(0, -s * 0.1); g.lineTo(-s * 0.2, s * 0.15); g.lineTo(-s * 0.05, s * 0.5); g.stroke(); }
  if (crack >= 0.5) { g.beginPath(); g.moveTo(s * 0.5, -s * 0.05); g.lineTo(0, -s * 0.1); g.lineTo(s * 0.2, s * 0.3); g.lineTo(s * 0.35, s * 0.5); g.moveTo(0, -s * 0.1); g.lineTo(-s * 0.5, -s * 0.2); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(s * 0.22, -s * 0.22, s * 0.06 * (1 + 0.3 * Math.sin(T * 3)), 0, TAU); g.fill();
  g.restore();
}

// ------------------------------------------------------------------ mini board (title / daily / map)
const miniCache = new Map();
const miniId = l => [l.id, l.name, l.date || '', l.bonus ?? '', l.strands.length, l.cols, l.rows].join('|');
/** Static preview of a level in rect (fits the board + a tangled kitten on the ledge). */
/** A free-standing yarn run (OG flight, title flourishes): pts in CSS px, drawn lifted with glyphs. */
export function drawYarnRun(g, pts, c, sw, unit, opt = {}) {
  if (!pts || pts.length < 2) return;
  const sp = strandPaths(pts, sw, c, unit || sw / 0.27);
  drawStrand(g, sp, c, sw, { lift: 2, gap: false, glow: opt.glow || 0, noPattern: true });
}

/**
 * Static board preview (title / daily / map / OG). opt { cleared (0..1, deepest-first), removed (strand
 * indices, overrides cleared), kitten (default true), stage, loops, freeT, breed, coat }.
 * Returns { B, box } so callers can place props relative to the board.
 */
export function drawMiniBoard(g, rect, level, t = 0, opt = {}) {
  if (!level || !level.strands) return;
  const dpr = Math.min(2.5, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
  const rmKey = opt.removed ? [...opt.removed].join(',') : '';
  const key = [rect.w, rect.h, dpr, opt.cleared || 0].map(v => (+v).toFixed(1)).join('|') + '|' + rmKey;
  const mid = miniId(level);
  let ent = miniCache.get(mid);
  const cols = level.cols, rows = level.rows;
  const unit = Math.min(90, rect.w / (cols - 1 + 1.2), rect.h / (rows - 1 + 1.2 + 1.4));
  const bwid = (cols - 1 + 1.2) * unit, bhei = (rows - 1 + 1.2) * unit;
  const x0 = rect.x + (rect.w - bwid) / 2, y0 = rect.y + (rect.h - bhei - 1.4 * unit) / 2;
  const B = { ox: x0 + 0.6 * unit, oy: y0 + 0.6 * unit, unit, sw: clamp(0.27 * unit, 2.5, 22), x: x0, y: y0, w: bwid, h: bhei,
    kitten: { x: x0 + bwid / 2, y: y0 + bhei + 1.25 * unit, s: 1.6 * unit } };
  const bb = boardBox(B, cols, rows);
  const ox = B.ox, oy = B.oy;
  if (!ent || ent.key !== key) {
    const strands = level.strands.map((s, i) => ({ ...s, i, pts: curve(s.pegs, s.bow || 0) }));
    const n = strands.length;
    const removed = new Set(opt.removed || []);
    if (opt.cleared && !opt.removed) { const ord = strands.slice().sort((a, b) => b.d - a.d); for (let k = 0; k < Math.round(n * opt.cleared); k++) removed.add(ord[k].i); }
    const live = strands.filter(s => !removed.has(s.i));
    const covered = new Set(), gaps = new Map();
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      const X = crossPts(live[a].pts, live[b].pts);
      if (!X.length) continue;
      const top = live[a].d > live[b].d ? live[a] : live[b], under = top === live[a] ? live[b] : live[a];
      covered.add(under.i);
      if (!gaps.has(top.i)) gaps.set(top.i, []);
      for (const p of X) gaps.get(top.i).push([ox + p[0] * unit, oy + p[1] * unit]);
    }
    const lx = bb.ox - unit * 0.5, ly = bb.oy - unit * 0.5;
    const W = bb.ow + unit, H = bb.kit.y + bb.ledgeH * 2 + unit * 0.5 - ly;
    const cv = mkCanvas(W * dpr, H * dpr), cg = cv.getContext('2d');
    cg.setTransform(dpr, 0, 0, dpr, -lx * dpr, -ly * dpr);
    drawBoardStatic(cg, B, cols, rows, level.shape);
    const prevPat = feltPattern; feltPattern = null;
    for (const s of live.sort((a, b) => a.d - b.d)) {
      const pts = s.pts.map(p => [ox + p[0] * unit, oy + p[1] * unit]);
      const gi = strandPaths(pts, B.sw, s.c, unit);
      gi.gaps = gaps.get(s.i) || []; gi.B = B;
      gi.pegs = s.pegs.map(p => [ox + p[0] * unit, oy + p[1] * unit]);
      const dim = covered.has(s.i);
      drawStrand(cg, gi, s.c, B.sw, { dim, lift: dim ? 0 : 1, glow: dim ? 0 : 1, noPattern: true });
      drawStrandPegs(cg, gi, s.c, B.sw, Math.max(2, unit * 0.16), dim);
    }
    feltPattern = prevPat;
    ent = { key, cv, dx: lx - x0, dy: ly - y0, w: W, h: H, colors: [...new Set(level.strands.map(s => s.c))].filter(c => c < 6).slice(0, 4) };
    if (miniCache.size > 16) miniCache.delete(miniCache.keys().next().value);
    miniCache.set(mid, ent);
  }
  g.drawImage(ent.cv, x0 + ent.dx, y0 + ent.dy, ent.w, ent.h);
  if (opt.kitten !== false) drawKitten(g, bb.kit.x, bb.kit.y, bb.kit.s, { stage: opt.stage || 0, loops: opt.loops, freeT: opt.freeT != null ? opt.freeT : -1, t, breed: opt.breed || 0, coat: opt.coat || 0, loopColors: ent.colors, memKey: ent });
  return { B, box: bb };
}
