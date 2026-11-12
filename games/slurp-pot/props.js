// Slurp Pot props (Art role; GDD §4.6, §7.3, §13.3). Every world prop is merged three.js primitives with baked
// vertex colours (linear, from sRGB hex via THREE.Color). No image files: the only texture is the board ground,
// drawn on a canvas by groundTexture(town). Imported by render3d.js (render3d → props → catalog).
//
// Geometry contract (all builders):
// - Non-indexed BufferGeometry with exactly four attributes: position, normal, color, uv. Same attribute set
//   everywhere, so the static layer can mergeGeometries(board + surfaces + decor) into one mesh.
// - geometryFor(kind): cached (do not dispose), origin at the footprint centre, bottom on y = 0, footprint
//   radius (max xz distance from the origin) normalised to catalog `a` exactly; userData = { tris, fp, h }.
//   Bosses are built at their catalog base `a`; render scales them uniformly to the level's `a`.
// - uv: every vertex that is not board top samples WHITE_UV, a texel of the ground texture that is pure white,
//   so one map can sit on the merged static-layer material and only the board top shows the pattern.
//   The ground texture is a *ratio* image: its base tone is white and darker tones are tone / base per channel
//   (linear). The board top's vertex colour is GROUND_BASE[town], so vertex colour × texture = the true colours.
//   Board-top uv = (x, z) / GROUND_TILE (RepeatWrapping is set by groundTexture).
// - boardGeometry, surfaceGeometry return fresh geometries (render owns and disposes them on a town change).
//
// DECISION: smooth primitive normals (not faceted) + a baked vertical AO ramp (bottom 20 % darker). Reads as
// glossy painted toys under the single Lambert material; faceted low-poly looked like crumpled paper at
// phone size.
// DECISION: Picnic Park's ground is a red-and-cream gingham (D33 differentiation: never a flat lime floor).
// Lawn green appears only on hedges, trees, grass strips under fences and decor tufts.
import * as T from './vendor/three.bundle.js';
import { KIND } from './catalog.js';
import { RUGS } from './dress.js';

const PI = Math.PI, TAU = PI * 2;

// ---------------------------------------------------------------- ground constants
export const GROUND_TILE = 4.0;                               // world units per texture repeat (gingham period 0.5 u)
const TEX = 512, WHITE_PX = 32.5;                              // texel that is white in every town's ground
// White at canvas (32.5, 32.5) and at its flipY mirror row 479.5, so it holds whatever flipY render uses.
export const WHITE_UV = [WHITE_PX / TEX, WHITE_PX / TEX];
// R2 (11-06 Fri, round 2, art director): Market and Harbour floors, about 15 % less saturated and darker, and the Harbour planks
// moved from orange to weathered teak, so tan food has a gap to read against. Display only: catalog.js SURF keeps the old
// colours because level generation reads them and Dailies may not move.
// FIX-LIST-3 R2 (L45, L58): the teak still swallowed brown and tan food, same hue and same value. The deck is now sea-bleached grey,
// cooler and lighter: warm food has a hue gap, white food still has a value gap. Display only, as above.
// DECISION (11-10, D2, art-director r8 "Harbour is washed out"): the grey deck sat at the same value as the food (waffle, mint,
// candy, cotton candy, peas all 1.0-1.3 contrast on it). The planks are now a warm, saturated toy-boat wood a clear step DARKER
// than the harbour food set, so pastel, white, yellow and tan food read by value (2-5x) and the dark few (coconut, burger,
// berries) keep the harbour-only bright edge band in the prop shader. Teak failed (11-06) because it sat at tan food's value; this
// sits well under it. Display only, as above.
// DECISION (11-12, FIX-LIST-8 A1, art-director r9 7.6 "food vs ground in Market and Harbour"): two more steps on the same line.
//   Harbour: the orange wood still shared tan food's hue, so fries, waffles, tacos and hot dogs sank (L50, L60). The planks are now
//   a walnut a further ~28 % darker and less saturated (#A8693F -> #80604A; every plank tone, the deck piece and the boardwalk path
//   scale by the same per-channel ratio), so tan food reads by value (3-4x) and by saturation. Not grey (r8 washed out) and not teak
//   (11-06, tan's value). Market: the tan cobble was the pretzel and chestnut colour (L25, L30), so the stones are a cool
//   grey-blue at the same value: brown, orange, yellow and green food all get a hue gap. Both towns now run the shader's ink edge
//   (U.edge, render3d.js). Display only, as above; render2d.js mirrors it.
export const GROUND_BASE = { picnic: '#F7E9D4', market: '#A9B0B8', harbour: '#80604A' };
// Gingham tones (sRGB) and relative luminance, for the Levels contrast rule (§4.2).
// R4 (11-06): a step darker and less saturated than the 11-04 cloth, so red food and white food both read on it. Display only:
// catalog.js SURF keeps the old tones because level generation reads them and Dailies may not move.
export const GINGHAM = { cream: '#F7E9D4', stripe: '#E4AC9D', cross: '#C9685A', lum: { cream: 0.828, stripe: 0.484, cross: 0.231 } };

// ---------------------------------------------------------------- colour helpers
const _lin = new Map();
function lin(hex) {
  let c = _lin.get(hex);
  if (!c) { c = new T.Color(hex); _lin.set(hex, c); }
  return c;
}
const toC = (x) => (x && x.isColor ? x : lin(x));
const sat = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
function mixC(a, b, t) { return toC(a).clone().lerp(toC(b), sat(t)); }
/** vertical gradient colour spec (local y). */
const grad = (a, b, y0, y1) => ({ v: (x, y) => mixC(a, b, (y - y0) / (y1 - y0)) });
/** gradient by normal.y: bottom-facing a, side mid, top-facing b. */
const ngrad = (a, mid, b) => ({ v: (x, y, z, nx, ny) => (ny > 0 ? mixC(mid, b, ny * ny) : mixC(mid, a, -ny)) });
const hsh = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const az = (x, z) => Math.atan2(z, x) + PI;                    // 0..2π
function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

// ---------------------------------------------------------------- primitive shorthands
const box = (w, h, d, a = 1, b = 1, c = 1) => new T.BoxGeometry(w, h, d, a, b, c);
const cyl = (rt, rb, h, seg = 8, hs = 1, open = false) => new T.CylinderGeometry(rt, rb, h, seg, hs, open);
const sph = (r, ws = 10, hs = 8) => new T.SphereGeometry(r, ws, hs);
const ico = (r, d = 0) => new T.IcosahedronGeometry(r, d);
const tor = (R, t, rs = 6, ts = 12, arc = TAU) => new T.TorusGeometry(R, t, rs, ts, arc);
const cone = (r, h, seg = 8) => new T.ConeGeometry(r, h, seg);
const lathe = (pts, seg = 12) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), seg);
const flat = (g) => g.rotateX(-PI / 2);

/** Rounded box (three's RoundedBoxGeometry method): seg bevel steps → (2·seg+1)² quads per face. */
function rbox(w, h, d, r, seg = 1) {
  const n = seg * 2 + 1;
  const g0 = new T.BoxGeometry(1, 1, 1, n, n, n);
  const g = g0.toNonIndexed(); g0.dispose();
  g.deleteAttribute('uv');
  r = Math.min(r, w / 2, h / 2, d / 2);
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r, half = 0.5 / n;
  const p = g.attributes.position.array, nr = g.attributes.normal.array, v = new T.Vector3();
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    v.set(x - Math.sign(x) * half, y - Math.sign(y) * half, z - Math.sign(z) * half).normalize();
    p[i] = bx * Math.sign(x) + v.x * r; p[i + 1] = by * Math.sign(y) + v.y * r; p[i + 2] = bz * Math.sign(z) + v.z * r;
    nr[i] = v.x; nr[i + 1] = v.y; nr[i + 2] = v.z;
  }
  return g;
}

/** Shapes (xy plane) and flat extrusions (lying on y = 0, extruded up to `depth`). */
function rrShape(w, d, r) {
  const s = new T.Shape(), x0 = -w / 2, y0 = -d / 2, x1 = w / 2, y1 = d / 2;
  r = Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4);
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -PI / 2, 0, false);
  s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, PI / 2, false);
  s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, PI / 2, PI, false);
  s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, PI, PI * 1.5, false);
  return s;
}
function polyShape(pts, r = 0) {
  const s = new T.Shape(), n = pts.length;
  if (!r) { pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i + n - 1) % n], [cx, cy] = pts[i], [nx, ny] = pts[(i + 1) % n];
    const l0 = Math.hypot(px - cx, py - cy), l1 = Math.hypot(nx - cx, ny - cy);
    const ax = cx + (px - cx) / l0 * r, ay = cy + (py - cy) / l0 * r, bx = cx + (nx - cx) / l1 * r, by = cy + (ny - cy) / l1 * r;
    if (i) s.lineTo(ax, ay); else s.moveTo(ax, ay);
    s.quadraticCurveTo(cx, cy, bx, by);
  }
  s.closePath();
  return s;
}
function starShape(n, ro, ri) {
  const s = new T.Shape();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = i * PI / n + PI / 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}
function sectorShape(R, half) {
  const s = new T.Shape();
  s.moveTo(0, 0); s.lineTo(Math.cos(-half) * R, Math.sin(-half) * R); s.absarc(0, 0, R, -half, half, false); s.lineTo(0, 0);
  return s;
}
function slab(shape, depth, bevel = 0, curveSegments = 4) {
  const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments });
  g.rotateX(-PI / 2);
  if (bevel) g.translate(0, bevel, 0);
  return g;
}
/** Warp an (indexed) geometry's vertices, then recompute smooth normals. */
function warp(g, fn) {
  const p = g.attributes.position, v = new T.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
/** Tapered tube along a curve. */
function ttube(curve, ts, r, rs, taper) {
  const g = new T.TubeGeometry(curve, ts, r, rs, false), p = g.attributes.position, P = new T.Vector3();
  for (let i = 0; i <= ts; i++) {
    curve.getPointAt(i / ts, P);
    const f = taper(i / ts);
    for (let j = 0; j <= rs; j++) {
      const k = i * (rs + 1) + j;
      p.setXYZ(k, P.x + (p.getX(k) - P.x) * f, P.y + (p.getY(k) - P.y) * f, P.z + (p.getZ(k) - P.z) * f);
    }
  }
  g.computeVertexNormals();
  return g;
}
const V3 = (x, y, z) => new T.Vector3(x, y, z);

/**
 * One coloured part. col: hex | THREE.Color | (cx,cy,cz,tri,nx,ny,nz)→hex per triangle | {v:(x,y,z,nx,ny,nz)→hex}
 * per vertex (local coords, before the transform). Transform order: scale, rotate X, Y, Z (world axes), move.
 */
function P(geo, col, pos, rot, scl) {
  let g = geo;
  if (g.index) { g = geo.toNonIndexed(); geo.dispose(); }
  g.clearGroups();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position.array, nr = g.attributes.normal.array, cnt = p.length / 3;
  const c = new Float32Array(cnt * 3);
  if (typeof col === 'function') {
    for (let v = 0; v < cnt; v += 3) {
      const i = v * 3;
      const k = toC(col((p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3, v / 3,
        (nr[i] + nr[i + 3] + nr[i + 6]) / 3, (nr[i + 1] + nr[i + 4] + nr[i + 7]) / 3, (nr[i + 2] + nr[i + 5] + nr[i + 8]) / 3));
      for (let j = 0; j < 9; j += 3) { c[i + j] = k.r; c[i + j + 1] = k.g; c[i + j + 2] = k.b; }
    }
  } else if (col && col.v) {
    for (let i = 0; i < p.length; i += 3) {
      const k = toC(col.v(p[i], p[i + 1], p[i + 2], nr[i], nr[i + 1], nr[i + 2]));
      c[i] = k.r; c[i + 1] = k.g; c[i + 2] = k.b;
    }
  } else {
    const k = toC(col);
    for (let i = 0; i < p.length; i += 3) { c[i] = k.r; c[i + 1] = k.g; c[i + 2] = k.b; }
  }
  g.setAttribute('color', new T.BufferAttribute(c, 3));
  if (scl != null) { if (typeof scl === 'number') g.scale(scl, scl, scl); else g.scale(scl[0], scl[1], scl[2]); }
  if (rot) { if (rot[0]) g.rotateX(rot[0]); if (rot[1]) g.rotateY(rot[1]); if (rot[2]) g.rotateZ(rot[2]); }
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return g;
}
/** Transform a list of parts as one group (rotate X, Y, Z then move). */
function xf(parts, rot, pos, scl) {
  for (const g of parts) {
    if (scl != null) { if (typeof scl === 'number') g.scale(scl, scl, scl); else g.scale(scl[0], scl[1], scl[2]); }
    if (rot) { if (rot[0]) g.rotateX(rot[0]); if (rot[1]) g.rotateY(rot[1]); if (rot[2]) g.rotateZ(rot[2]); }
    if (pos) g.translate(pos[0], pos[1], pos[2]);
  }
  return parts;
}
function merge(parts) {
  const list = parts.flat(4).filter(Boolean);
  const g = T.mergeGeometries(list, false);
  for (const q of list) q.dispose();
  if (!g) throw new Error('props: merge failed');
  return g;
}
function setWhiteUV(g) {
  const n = g.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i += 2) { uv[i] = WHITE_UV[0]; uv[i + 1] = WHITE_UV[1]; }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}
/** Darken the bottom of a part (vertical AO ramp over min(0.45, 0.35·H)). */
function bakeAO(g, H, ao) {
  if (!(ao > 0)) return;
  const p = g.attributes.position.array, c = g.attributes.color.array, range = Math.min(0.45, Math.max(0.03, 0.35 * H));
  for (let i = 0; i < p.length; i += 3) {
    const t = 1 - sat(p[i + 1] / range), f = 1 - ao * t * t;
    c[i] *= f; c[i + 1] *= f; c[i + 2] *= f;
  }
}
/**
 * Recentre on the footprint, sit on y = 0, normalise footprint to `a`, bake AO, add uv, record stats.
 * userData.tr = [tx, ty, tz, s]: the applied transform (p' = (p + t)·s), so stack tops/slots and spin parts
 * built in the builder's own units land in the same frame.
 */
function finish(g, a, ao = 0.2) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const tx = -(b.min.x + b.max.x) / 2, ty = -b.min.y, tz = -(b.min.z + b.max.z) / 2;
  g.translate(tx, ty, tz);
  const p = g.attributes.position.array;
  let fp = 0, s = 1;
  for (let i = 0; i < p.length; i += 3) fp = Math.max(fp, Math.hypot(p[i], p[i + 2]));
  if (a) { s = a / fp; g.scale(s, s, s); fp = a; }
  g.computeBoundingBox();
  const H = g.boundingBox.max.y;
  bakeAO(g, H, ao);
  setWhiteUV(g);
  g.computeBoundingSphere();
  g.userData = { tris: p.length / 9, fp, h: H, tr: [tx, ty, tz, s] };
  return g;
}
/** Put a sub-part (built in the same builder units) into the frame of a finished geometry with userData tr/h. */
function refit(g, tr, H, ao = 0.2) {
  g.translate(tr[0], tr[1], tr[2]);
  g.scale(tr[3], tr[3], tr[3]);
  bakeAO(g, H, ao);
  setWhiteUV(g);
  g.computeBoundingSphere();
  g.userData = { tris: g.attributes.position.count / 3, h: H };
  return g;
}
const trPt = (tr, x, y, z) => [(x + tr[0]) * tr[3], (y + tr[1]) * tr[3], (z + tr[2]) * tr[3]];

// ---------------------------------------------------------------- shared little pieces
const HL = (r, pos) => P(ico(r), '#FFFFFF', pos, null, [1, 0.6, 1]);          // painted gloss dot (toy sheen)
const leaf = (r, pos, rot, hex = '#5FB54A') => P(ico(r), hex, pos, rot, [1.5, 0.32, 0.75]);
const stemP = (h, pos, rot, hex = '#6B4A2B', r = 0.009) => P(cyl(r * 0.8, r, h, 4), hex, pos, rot);
const starCap = (ro, ri, d, pos, hex = '#3FA34D') => P(slab(starShape(5, ro, ri), d), hex, pos);

// D29 toy vehicles: painted opaque windows (no seats, no figures), chunky tyres with pale hubs.
const WIN = '#BFE6F2', TYRE = '#3A3F52', HUB = '#E8EDF2';
/** Tyre + hub, axle along x, centred at pos (seg 8: 56 tris). */
const wheel = (r, w, pos, seg = 8, hs = 6) => [
  P(cyl(r, r, w, seg), TYRE, pos, [0, 0, PI / 2]),
  P(cyl(r * 0.55, r * 0.55, w * 1.1, hs), HUB, pos, [0, 0, PI / 2]),
];
/** Painted window: thin opaque pane facing +z (rotY turns it), with a white gloss stripe (24 tris). */
const pane = (w, h, pos, rotY = 0) => xf([
  P(box(w, h, 0.012), WIN),
  P(box(w * 0.16, h * 0.7, 0.014), '#F4FBFE', [-w * 0.22, 0, 0.002], [0, 0, 0.5]),
], [0, rotY, 0], pos);
/**
 * Striped toy awning: flat panel w (x) by d (z), n stripes, front (+z) edge scalloped, then tilted (front edge
 * down by `tilt` rad), turned by rotY and moved to pos (the panel centre). 4 + 8n + 16n tris.
 */
function awning(w, d, n, ca, cb, pos, tilt = 0.35, rotY = 0) {
  const sw = w / n, parts = [P(box(w, 0.035, d, n, 1, 1), (x) => (Math.floor((x + w / 2) / sw - 1e-3) % 2 ? cb : ca))];
  for (let i = 0; i < n; i++) {
    const g = new T.CylinderGeometry(sw / 2, sw / 2, 0.035, 4, 1, false, PI / 2, PI);
    parts.push(P(g, i % 2 ? cb : ca, [-w / 2 + sw * (i + 0.5), 0, d / 2], [-PI / 2, 0, 0]));
  }
  return xf(parts, [tilt, rotY, 0], pos);
}
/** Little fruit heap (round fruit on a mound) for crates and stalls. */
const heap = (r, n, hex, pos, seed = 0, ws = 6, hs = 4) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + seed, rr = i ? r * (0.55 + 0.3 * hsh(i + seed)) : 0, y = i ? 0 : r * 0.55;
    const c = Array.isArray(hex) ? hex[i % hex.length] : hex;
    out.push(P(sph(r * 0.5, ws, hs), grad(mixC(c, '#3A2418', 0.18), mixC(c, '#FFFFFF', 0.2), -r * 0.5, r * 0.5),
      [pos[0] + Math.cos(a) * rr, pos[1] + r * 0.45 + y, pos[2] + Math.sin(a) * rr]));
  }
  return out;
};

// ---------------------------------------------------------------- builders: shared T0 crumbs
const B = {};
// Spinning kinds (D29 twist visuals): S[id]() -> { base: parts, blade: parts, pivot: [x,y,z], axis: [x,y,z], rate }
// in builder units; B[id] = spinAll(id) keeps geometryFor complete; spinParts(id) splits them in the final frame.
const S = {};
const spinAll = (id) => { const s = S[id](); return [...s.base, ...s.blade]; };
B.pea = () => [
  P(sph(0.07, 10, 7), grad('#5FAE40', '#A8E07E', -0.07, 0.07), [0, 0.064, 0], null, [1, 0.92, 1]),
  HL(0.016, [-0.028, 0.104, 0.03]),
];
B.blueberry = () => [
  P(sph(0.075, 10, 7), grad('#3442A8', '#7181EA', -0.075, 0.075), [0, 0.064, 0], null, [1, 0.85, 1]),
  P(cyl(0.03, 0.02, 0.018, 5), '#262E78', [0, 0.128, 0]),
  HL(0.015, [-0.03, 0.11, 0.032]),
];
B.grape = () => [
  P(sph(0.065, 10, 7), grad('#6538A8', '#B07EEA', -0.07, 0.07), [0, 0.065, 0], null, [1.2, 1, 1]),
  stemP(0.04, [-0.07, 0.1, 0], [0, 0, 0.9], '#6B8E23'),
  HL(0.014, [-0.035, 0.112, 0.03]),
];
B.cherry = () => [
  P(sph(0.07, 10, 7), grad('#A8172A', '#F0485E', -0.07, 0.07), [0, 0.07, 0]),
  stemP(0.1, [0.02, 0.17, 0], [0, 0, -0.35], '#5A7D2A', 0.008),
  leaf(0.03, [0.06, 0.215, 0.012], [0, 0.4, -0.3], '#5FB54A'),
  HL(0.016, [-0.03, 0.115, 0.035]),
];
B.candy = () => [
  P(sph(0.055, 10, 6), (x, y, z) => (Math.abs(x) < 0.017 ? '#FFFFFF' : Math.abs(x) > 0.04 ? '#FF5C99' : '#FF7FB0'), [0, 0.05, 0], null, [1.25, 0.85, 1]),
  P(cone(0.042, 0.055, 6), '#FFC1DA', [0.088, 0.05, 0], [0, 0, PI / 2]),
  P(cone(0.042, 0.055, 6), '#FFC1DA', [-0.088, 0.05, 0], [0, 0, -PI / 2]),
];

// ---------------------------------------------------------------- builders: Picnic T1/T2 food
B.strawberry = () => {
  const body = lathe([[0, 0], [0.035, 0.02], [0.065, 0.06], [0.08, 0.1], [0.075, 0.13], [0.05, 0.15], [0, 0.155]], 10);
  return xf([
    P(body, grad('#C92A2A', '#FF6A55', 0, 0.155)),
    ...[[0.07, 0.07, 0.02], [0.03, 0.1, 0.06], [0.05, 0.045, -0.045]].map(([x, y, z]) => P(new T.OctahedronGeometry(0.008), '#FFE680', [x, y, z])),
    starCap(0.065, 0.028, 0.012, [0, 0.148, 0]),
    stemP(0.04, [0, 0.175, 0], null, '#3F8A3A', 0.009),
  ], [0, 0, 1.2], [0, 0.08, 0]);
};
// R7 (11-06 Fri, round 2): a hot chili. A fat glossy crescent lying flat, because the camera looks down and a chili standing in the
// air reads as a stick. The bend, the green cap and the flame at the tip are what make it no fruit at 390 wide. Flame vertices
// keep a full-red vertex colour, which is what propMat's flicker and self-light key on (linear r > 0.95); the shine stays under
// that, so the whole thing is still one instanced draw.
B.chili = () => {
  const curve = new T.QuadraticBezierCurve3(V3(-0.235, 0.095, -0.03), V3(0.0, 0.095, 0.2), V3(0.235, 0.115, -0.07));
  const taper = t => (t < 0.12 ? 0.6 + 0.4 * Math.sin(t / 0.12 * PI / 2) : 1 - 0.84 * ((t - 0.12) / 0.88) ** 2);
  const shine = (t, s) => { const q = curve.getPoint(t); return P(ico(0.024), '#F9C9C2', [q.x, q.y + 0.076 * taper(t), q.z], [0, 0.45 - t * 1.1, 0], s); };
  const flame = (r, hgt, seg) => warp(sph(r, seg, seg - 1), (v) => { const t = (v.y + r) / (2 * r), k = 1 - 0.9 * t * t; v.x *= k; v.z *= k; v.y *= hgt / (2 * r); });
  return [
    P(ttube(curve, 12, 0.09, 7, taper), { v: (x, y) => mixC('#B01A12', '#EE2A1C', (y - 0.02) / 0.15) }),
    P(sph(0.066, 6, 5), '#3F8A3A', [-0.238, 0.1, -0.035], null, [1, 0.72, 1]),
    stemP(0.06, [-0.25, 0.15, -0.045], [0.4, 0, 0.5], '#4E9A44', 0.02),
    shine(0.3, [2.4, 0.5, 1]), shine(0.48, [1.5, 0.5, 0.9]),
    P(flame(0.075, 0.28, 6), grad('#FF6A14', '#FF9A1F', -0.1, 0.15), [0.238, 0.21, -0.07]),
    P(flame(0.045, 0.16, 5), '#FFD23F', [0.238, 0.19, -0.048]),
  ];
};
B.tomato = () => {
  const s = warp(sph(0.15, 10, 7), (v) => { const k = 1 + 0.045 * Math.cos(5 * Math.atan2(v.z, v.x)) * Math.sqrt(Math.max(0, 1 - (v.y / 0.15) ** 2)); v.x *= k; v.z *= k; });
  return [
    P(s, grad('#B82820', '#F5654F', -0.15, 0.15), [0, 0.1, 0], null, [1, 0.66, 1]),
    starCap(0.075, 0.03, 0.014, [0, 0.192, 0]),
    stemP(0.04, [0, 0.215, 0], null, '#3F8A3A', 0.011),
    HL(0.024, [-0.07, 0.165, 0.06]),
  ];
};
B.lemon = () => [
  P(sph(0.1, 10, 8), grad('#F2CC2A', '#FFF08A', -0.1, 0.1), [0, 0.088, 0], null, [1.45, 0.88, 1]),
  P(cone(0.026, 0.035, 6), '#E8C82A', [0.155, 0.088, 0], [0, 0, -PI / 2]),
  P(cone(0.022, 0.03, 6), '#E8C82A', [-0.152, 0.088, 0], [0, 0, PI / 2]),
  HL(0.022, [-0.05, 0.155, 0.04]),
];
B.apple = () => [
  P(lathe([[0, 0.012], [0.07, 0], [0.13, 0.03], [0.165, 0.09], [0.16, 0.15], [0.12, 0.2], [0.05, 0.212], [0, 0.19]], 10),
    grad('#B02626', '#F06048', 0, 0.21)),
  stemP(0.06, [0.005, 0.215, 0], [0, 0, -0.25], '#6B4A2B', 0.01),
  leaf(0.04, [0.045, 0.235, 0], [0, 0.3, -0.35]),
];
B.cupcake = () => [
  P(cyl(0.15, 0.115, 0.11, 10), (x, y, z) => (Math.floor(az(x, z) / (TAU / 10)) % 2 ? '#5BB8DA' : '#9FD8EC'), [0, 0.055, 0]),
  P(lathe([[0, 0.11], [0.165, 0.11], [0.15, 0.155], [0.12, 0.18], [0.1, 0.215], [0.05, 0.255], [0, 0.27]], 9), grad('#FF86B4', '#FFC2DA', 0.11, 0.27)),
  P(ico(0.035, 0), '#D8263B', [0, 0.29, 0]),
  ...[[0.1, 0.19, 0.04, '#FFFFFF'], [-0.06, 0.22, 0.07, '#FFD23F'], [0.02, 0.2, -0.11, '#5BC0EB']].map(([x, y, z, c]) => P(new T.OctahedronGeometry(0.014), c, [x, y, z], [0, 0, 0.6], [1, 2, 1])),
];
B.cheese = () => {
  const sh = sectorShape(0.4, 0.42);
  const holes = [[0.15, 0.03, 0.03], [0.26, -0.06, 0.035], [0.3, 0.08, 0.025], [0.2, -0.015, 0.02]];
  return [
    P(slab(sh, 0.15, 0.012, 4), (x, y, z, t, nx, ny, nz) => (ny > 0.7 ? '#FFD95A' : ny < -0.7 ? '#E8B030' : Math.hypot(x, z) > 0.36 ? '#F0B83A' : '#FFC93C')),
    ...holes.map(([x, z, r]) => P(cyl(r, r, 0.006, 6), '#E39E22', [x, 0.172, -z])),
  ];
};
B.banana = () => {
  const c = new T.QuadraticBezierCurve3(V3(-0.22, 0.05, 0.06), V3(0, 0.05, -0.12), V3(0.22, 0.05, 0.06));
  return [
    P(ttube(c, 10, 0.055, 6, (t) => 0.3 + 0.7 * Math.sin(PI * t) ** 0.6), grad('#F2C230', '#FFE680', 0, 0.1)),
    P(cyl(0.012, 0.016, 0.05, 4), '#7A5A2B', [0.24, 0.06, 0.07], [0, 0, -1.0]),
    P(ico(0.016), '#5A3E22', [-0.225, 0.05, 0.062]),
  ];
};
B.corn = () => {
  const s = sph(0.08, 10, 8);
  return [
    P(s, (x, y, z) => ((Math.floor(az(x, z) / (TAU / 10)) + Math.floor(Math.acos(Math.max(-1, Math.min(1, y / 0.08))) / (PI / 8))) % 2 ? '#F5B623' : '#FFD54A'),
      [0.03, 0.075, 0], [0, 0, PI / 2], [1, 2.1, 1]),
    P(cone(0.075, 0.22, 6), '#9CCC65', [-0.1, 0.09, 0.03], [0, 0.3, -PI / 2 + 0.25], [1, 1, 0.45]),
    P(cone(0.07, 0.2, 6), '#7CB342', [-0.1, 0.06, -0.035], [0, -0.35, -PI / 2 - 0.15], [1, 1, 0.45]),
    P(cone(0.07, 0.19, 6), '#8BC34A', [-0.11, 0.11, -0.01], [0.6, 0, -PI / 2 + 0.05], [1, 1, 0.45]),
  ];
};
B.sandwich = () => {
  const tri = [[-0.25, -0.22], [0.27, -0.22], [-0.25, 0.28]];
  const sh = (k) => polyShape(tri.map(([x, y]) => [x * k, y * k]), 0.045 * k);
  const bread = (y) => P(slab(sh(1), 0.05, 0.014, 2), (x, yy, z, t, nx, ny) => (Math.abs(ny) > 0.6 ? '#F7DDA8' : '#C98B4E'), [0, y, 0]);
  return [
    bread(0),
    P(slab(sh(1.07), 0.022, 0, 2), '#7CC95A', [0, 0.075, 0]),
    P(slab(sh(0.98), 0.02, 0, 2), '#E8463A', [0, 0.097, 0]),
    P(slab(sh(1.04), 0.018, 0, 2), '#FFD54A', [0, 0.117, 0], [0, 0.08, 0]),
    bread(0.135),
  ];
};
B.watermelon = () => {
  const half = 0.5;
  return [
    P(slab(sectorShape(0.62, half), 0.09, 0.01, 6), (x, y, z, t, nx, ny) => (Math.abs(ny) > 0.7 ? '#3E9A44' : (Math.floor(az(x, z) * 9) % 2 ? '#2F7D35' : '#56B85A'))),
    P(slab(sectorShape(0.575, half - 0.012), 0.104, 0, 6), '#EAF5D0'),
    P(slab(sectorShape(0.54, half - 0.02), 0.112, 0, 6), (x, y, z, t, nx, ny) => (ny > 0.7 ? mixC('#FF4A60', '#FF7A88', 1 - Math.hypot(x, z) / 0.54) : '#F2475C')),
    ...[[0.2, 0.03], [0.3, -0.07], [0.33, 0.09], [0.42, -0.02], [0.4, 0.16], [0.42, -0.17]].map(([x, z]) =>
      P(ico(0.022), '#3A2418', [x, 0.115, z], [0, Math.atan2(z, x), 0], [1.4, 0.35, 0.8])),
  ];
};

// ---------------------------------------------------------------- builders: Picnic props
B.juicebox = () => [
  P(rbox(0.16, 0.24, 0.11, 0.02, 1), grad('#3FA9DA', '#7FD3F5', 0, 0.24), [0, 0.12, 0]),
  P(cyl(0.045, 0.045, 0.01, 6), '#FF9A1F', [0, 0.12, 0.056], [PI / 2, 0, 0]),
  P(cyl(0.045, 0.045, 0.01, 6), '#FF9A1F', [0, 0.12, -0.056], [PI / 2, 0, 0]),
  P(cyl(0.009, 0.009, 0.08, 4), '#FFFFFF', [0.04, 0.28, 0]),
  P(cyl(0.009, 0.009, 0.06, 4), '#FF6FA0', [0.06, 0.335, 0], [0, 0, -0.9]),
];
B.cup = () => [
  P(lathe([[0, 0], [0.085, 0], [0.12, 0.16], [0.126, 0.168], [0.114, 0.168], [0.08, 0.014], [0, 0.014]], 12),
    (x, y, z, t, nx, ny, nz) => {
      const out = nx * x + nz * z > 0;
      if (!out) return '#E2E6EA';
      return y > 0.06 && y < 0.11 ? '#E8574A' : '#FFFFFF';
    }),
  P(cyl(0.008, 0.008, 0.16, 4), '#FF6FA0', [0.03, 0.15, 0], [0, 0, -0.25]),
];
B.plate = () => [
  P(lathe([[0, 0], [0.19, 0], [0.22, 0.012], [0.235, 0.024], [0.3, 0.046], [0.3, 0.054], [0.28, 0.054], [0.2, 0.026], [0, 0.026]], 16),
    (x, y, z) => (Math.hypot(x, z) > 0.262 && y > 0.04 ? '#7EC8E3' : '#FFF6E3')),
];
B.bread = () => {
  const s = warp(sph(0.1, 12, 8), (v) => { if (v.y < 0) v.y *= 0.2; });
  return [
    P(s, grad('#B87835', '#E8B068', 0, 0.1), [0, 0.02, 0], null, [2.1, 1.25, 1.25]),
    ...[-0.1, 0, 0.1].map((x) => P(box(0.03, 0.012, 0.12), '#F5D190', [x, 0.141, 0], [0, 0.5, 0])),
  ];
};
B.pie = () => [
  P(lathe([[0, 0], [0.27, 0], [0.32, 0.06], [0.345, 0.08], [0.33, 0.1], [0.29, 0.095], [0.26, 0.078], [0, 0.084]], 14),
    (x, y, z, t) => {
      const r = Math.hypot(x, z);
      if (y < 0.062 && r > 0.2) return t % 2 ? '#B5BFCC' : '#D2DAE4';
      if (r > 0.255) return y > 0.09 ? '#F2C27B' : '#E0A050';
      return '#B83A5A';
    }),
  ...[-0.13, 0, 0.13].map((o) => P(box(0.045, 0.022, 0.5), '#F0C078', [o, 0.09, 0])),
  ...[-0.13, 0, 0.13].map((o) => P(box(0.5, 0.022, 0.045), '#E8B060', [0, 0.098, o])),
];
B.beachball = () => {
  const G = ['#FF5C5C', '#FFFFFF', '#FFD23F', '#2FB5A5', '#FFFFFF', '#4D8DF0'];
  return [
    P(sph(0.35, 12, 10), (x, y, z) => (Math.abs(y) > 0.32 ? '#FFFFFF' : G[Math.floor(az(x, z) / (PI / 3)) % 6]), [0, 0.35, 0]),
  ];
};
S.pinwheel = () => {
  const base = [P(cyl(0.016, 0.02, 0.4, 6), (x, y) => (Math.floor((y + 0.2) / 0.08) % 2 ? '#FFFFFF' : '#2FB5A5'), [0, 0.2, 0])];
  base.push(P(cyl(0.06, 0.09, 0.05, 8), '#FFF1DC', [0, 0.025, 0]));
  const blade = ['#2FB5A5', '#FFC93C', '#FF7A59', '#FFFFFF'];
  const wheel = [];
  for (let i = 0; i < 4; i++) {
    const g = slab(polyShape([[0, 0], [0.24, 0.02], [0.05, 0.22]], 0.015), 0.012);
    wheel.push(P(g, blade[i], null, [0, 0, 0]).rotateY(i * PI / 2));
  }
  wheel.push(P(ico(0.035), '#FFD23F', [0, 0.015, 0]));
  // wheel lies in the xz plane: tilt it up 50° to face the sky and the camera; it spins about its own normal
  xf(wheel, [0.9, 0, 0], [0, 0.42, 0.02]);
  return { base, blade: wheel, pivot: [0, 0.42, 0.02], axis: [0, Math.cos(0.9), Math.sin(0.9)], rate: 4 };
};
B.pinwheel = () => spinAll('pinwheel');
B.flowerpot = () => {
  const parts = [
    P(lathe([[0, 0], [0.19, 0], [0.24, 0.25], [0.29, 0.26], [0.29, 0.33], [0.25, 0.33]], 12), (x, y) => (y > 0.255 ? '#EB9068' : '#E07A4F')),
    P(flat(new T.CircleGeometry(0.255, 12)), '#6B4A2B', [0, 0.31, 0]),
    P(sph(0.21, 8, 6), grad('#3E9443', '#6CC163', 0, 0.2), [0, 0.37, 0], null, [1, 0.62, 1]),
  ];
  [[0, 0.07, 0.58], [0.12, -0.08, 0.5], [-0.13, -0.06, 0.52]].forEach(([x, z, y]) => {
    parts.push(P(cyl(0.075, 0.075, 0.022, 8), '#FFC93C', [x, y, z], [0.35, 0, 0]));
    parts.push(P(ico(0.035), '#7A4E2D', [x, y + 0.02, z + 0.006], null, [1, 0.6, 1]));
  });
  return parts;
};
B.basket = () => {
  const parts = [
    P(lathe([[0, 0], [0.3, 0], [0.36, 0.22], [0.385, 0.24], [0.345, 0.245], [0.31, 0.05], [0, 0.05]], 14),
      (x, y, z, t, nx, ny, nz) => {
        if (y > 0.215) return '#D9A066';
        if (nx * x + nz * z < 0) return '#8E5C2C';
        return (Math.floor(az(x, z) / (TAU / 14)) + Math.floor(y / 0.055)) % 2 ? '#B07338' : '#C98B4E';
      }),
    P(sph(0.3, 8, 5), (x, y, z) => ((Math.floor((x + 1) / 0.1) + Math.floor((z + 1) / 0.1)) % 2 ? '#E8574A' : '#FFF1DC'), [0, 0.21, 0], null, [1, 0.3, 1]),
    P(cyl(0.045, 0.045, 0.42, 6), '#D9A05B', [0.1, 0.3, -0.06], [0, 0.5, 0.9]),
    P(sph(0.07, 6, 5), '#D93A3A', [-0.12, 0.27, 0.08]),
  ];
  parts.push(P(tor(0.33, 0.028, 4, 10, PI), '#B07338', [0, 0.24, -0.02], null, [1, 1.2, 1]));
  return parts;
};
B.bin = () => [
  P(lathe([[0, 0], [0.36, 0], [0.4, 0.6], [0.43, 0.62], [0.43, 0.66], [0.38, 0.66], [0.35, 0.1], [0, 0.1]], 14),
    (x, y, z, t, nx, ny, nz) => {
      if (y > 0.595) return '#3F6E3A';
      if (nx * x + nz * z < 0) return '#2F4F2C';
      return Math.floor(az(x, z) / (TAU / 14)) % 2 ? '#4E8A48' : '#5E9E57';
    }),
  P(ico(0.11, 0), '#F4F4F4', [0.05, 0.6, -0.04]),
  P(ico(0.08, 0), '#FFD84A', [-0.12, 0.6, 0.06], null, [1.6, 0.5, 0.7]),
];
B.teacups = () => {
  // DECISION: wobbly toy tower of three saucer + teacup layers, each layer nudged a little. (11-04 review) the
  // tower ends in a CUP, not a saucer: a top saucer hid every cup from the 55° camera and read as a white blob,
  // now the top view is a teal cup of brown tea on coloured-rim china. userData.top = just under the top cup's
  // rim; the slots sit inside the cup (treats float on the tea). Rims are picked by height, not by normal (lathe
  // normals are smoothed across the short rim segment).
  const saucer = (r) => lathe([[r * 0.3, 0], [r, 0.035], [r * 0.7, 0.033], [0, 0.03]], 9);
  const cup = (r, h) => lathe([[r * 0.55, 0], [r, h], [r * 0.88, h], [0, h * 0.78]], 9);
  const S = [[0.44, '#7FB3E8'], [0.36, '#7FD6C2'], [0.31, '#FF9FB8']];
  const C = [[0.2, 0.16, '#FF7FB0'], [0.17, 0.15, '#FFC93C'], [0.22, 0.16, '#3CC4B3']];
  const parts = [];
  let y = 0, dx = 0, dz = 0;
  for (let i = 0; i < 3; i++) {
    const [sr, rc] = S[i];
    parts.push(P(saucer(sr), (x, py, z) => (py < 0.029 || Math.hypot(x, z) > sr * 0.66 ? rc : '#FFF6E3'), [dx, y, dz]));
    y += 0.03;
    const [r, h, c] = C[i];
    parts.push(P(cup(r, h), (x, py, z, t, nx, ny, nz) => (py > h * 0.97 && ny > 0.5 ? '#FFFFFF' : nx * x + nz * z > 0 ? c : '#9A5A2B'), [dx, y, dz]));
    const hd = tor(0.045, 0.014, 3, 4, PI);
    hd.rotateZ(-PI / 2); hd.rotateY(-i * 2.1);
    parts.push(P(hd, c, [dx + Math.cos(i * 2.1) * (r * 0.85 + 0.035), y + h * 0.55, dz + Math.sin(i * 2.1) * (r * 0.85 + 0.035)]));
    if (i === 2) { parts.top = y + h * 0.9; break; }
    y += h;
    dx += (hsh(i * 3.7) - 0.5) * 0.05; dz += (hsh(i * 5.1) - 0.5) * 0.05;
  }
  parts.slots = [[dx - 0.07, dz - 0.04], [dx + 0.07, dz - 0.04], [dx, dz + 0.08]];
  return parts;
};
B.platepile = () => {
  // DECISION: wobbly pile of seven cream china plates with coloured rims (blue, pink, mint), each nudged and turned;
  // userData.top = the top plate's well, slots on it.
  const prof = [[0.26, 0], [0.42, 0.055], [0.34, 0.06], [0, 0.04]], rims = ['#7FB3E8', '#FF9FB8', '#7FD6C2'];
  const parts = [];
  let dx = 0, dz = 0;
  for (let i = 0; i < 7; i++) {
    dx = (hsh(i * 3.1) - 0.5) * 0.05; dz = (hsh(i * 7.3) - 0.5) * 0.05;
    // (11-04 review) rims picked by height: rim top y > .055, the outer underside shows the rim colour too
    const rc = rims[i % 3];
    parts.push(P(lathe(prof, 9), (x, py, z) => {
      const rr = Math.hypot(x, z);
      if (py > 0.055 && rr > 0.33) return rc;
      if (py < 0.04) return rr > 0.33 ? shade(rc, -0.06) : '#EFE3CB';
      return '#FFF6E3';
    }, [dx, i * 0.058, dz], [0, i * 0.7, 0]));
  }
  parts.top = 6 * 0.058 + 0.045;
  parts.slots = [[dx - 0.12, dz - 0.07], [dx + 0.12, dz - 0.07], [dx, dz + 0.14]];
  return parts;
};
B.fence = () => {
  const parts = [P(rbox(1.0, 0.06, 0.3, 0.03, 1), grad('#4FA048', '#7ACB62', 0, 0.06), [0, 0.03, 0])];
  for (let i = 0; i < 5; i++) {
    const x = -0.4 + i * 0.2;
    parts.push(P(box(0.11, 0.42, 0.035), '#FFF1DC', [x, 0.27, 0]));
    parts.push(P(cyl(0, 0.078, 0.07, 4), '#FFF1DC', [x, 0.515, 0], [0, PI / 4, 0], [1, 1, 0.32]));
  }
  parts.push(P(box(1.0, 0.05, 0.03), '#EAD9BF', [0, 0.2, -0.03]));
  parts.push(P(box(1.0, 0.05, 0.03), '#EAD9BF', [0, 0.38, -0.03]));
  return parts;
};
B.hedge = () => {
  const g = grad('#2F7F3A', '#5ABD62', 0, 0.8);
  const parts = [P(rbox(1.1, 0.5, 0.48, 0.14, 1), g, [0, 0.25, 0])];
  [[-0.4, 0.5, 0.02, 0.22], [-0.13, 0.56, -0.03, 0.24], [0.14, 0.53, 0.03, 0.23], [0.41, 0.49, -0.02, 0.21]].forEach(([x, y, z, r]) =>
    parts.push(P(sph(r, 8, 6), { v: (vx, vy) => mixC('#3F9B4B', '#62C46A', (vy + r) / (2 * r)) }, [x, y, z], null, [1, 0.85, 1])));
  [[-0.3, 0.62, 0.18, '#FFFFFF'], [0.05, 0.7, 0.16, '#FF9EC4'], [0.33, 0.6, 0.19, '#FFFFFF'], [-0.48, 0.42, 0.22, '#FFD23F'], [0.2, 0.38, 0.25, '#FF9EC4']].forEach(([x, y, z, c]) =>
    parts.push(P(ico(0.035), c, [x, y, z])));
  return parts;
};
B.lamp = () => [
  P(lathe([[0, 0], [0.48, 0], [0.5, 0.04], [0.5, 0.16], [0.46, 0.185], [0.44, 0.15], [0, 0.15]], 16),
    (x, y, z) => (Math.hypot(x, z) < 0.43 && y > 0.12 ? '#6BBF59' : y > 0.15 ? '#EFE3CC' : '#D9C6A5')),
  ...[0, 1, 2, 3, 4, 5].map((i) => P(ico(0.045), ['#FF9EC4', '#FFC93C', '#FFFFFF'][i % 3], [Math.cos(i * TAU / 6) * 0.3, 0.18, Math.sin(i * TAU / 6) * 0.3])),
  P(cyl(0.07, 0.1, 0.2, 8), '#4A4F63', [0, 0.25, 0]),
  P(cyl(0.035, 0.045, 1.6, 8), '#4A4F63', [0, 1.15, 0]),
  P(cyl(0.08, 0.08, 0.05, 6), '#3A3F52', [0, 1.95, 0]),
  P(cyl(0.12, 0.085, 0.22, 6), '#FFE9A8', [0, 2.08, 0]),
  P(cone(0.17, 0.13, 6), '#4A4F63', [0, 2.255, 0]),
  P(ico(0.035), '#FFC93C', [0, 2.34, 0]),
];
B.bench = () => {
  const parts = [];
  [-0.13, 0, 0.13].forEach((z, i) => parts.push(P(rbox(1.6, 0.05, 0.12, 0.02, 1), i % 2 ? '#C27A48' : '#B06A3B', [0, 0.38, z])));
  [0.52, 0.68].forEach((y, i) => parts.push(P(rbox(1.6, 0.12, 0.04, 0.02, 1), i ? '#B06A3B' : '#C27A48', [0, y, -0.24 - (y - 0.5) * 0.18], [-0.18, 0, 0])));
  [-0.68, 0.68].forEach((x) => {
    parts.push(P(box(0.06, 0.38, 0.06), '#4A4F63', [x, 0.19, 0.16]));
    parts.push(P(box(0.06, 0.8, 0.06), '#4A4F63', [x, 0.4, -0.2], [-0.1, 0, 0]));
    parts.push(P(box(0.06, 0.05, 0.42), '#4A4F63', [x, 0.5, 0.0]));
  });
  return parts;
};
S.parasol = () => ({
  base: [
    P(cyl(0.025, 0.025, 1.7, 6), '#F4F4F4', [0, 0.88, 0]),
    P(cyl(0.18, 0.22, 0.08, 10), '#4A4F63', [0, 0.04, 0]),
  ],
  blade: [
    P(lathe([[0.04, 1.6], [0.6, 1.46], [0.9, 1.36], [0.95, 1.38], [0.7, 1.53], [0.35, 1.69], [0, 1.76]], 16),
      (x, y, z, t, nx, ny) => {
        const s = Math.floor(az(x, z) / (TAU / 8)) % 2;
        return ny < 0 ? (s ? '#D9D2C8' : '#D95050') : (s ? '#FFFFFF' : '#FF6B6B');
      }),
    P(ico(0.045), '#FF6B6B', [0, 1.79, 0]),
  ],
  pivot: [0, 1.6, 0], axis: [0, 1, 0], rate: 0.8,
});
B.parasol = () => spinAll('parasol');
B.tree = () => {
  const g = (y0, y1) => ({ v: (x, y) => mixC('#2E8A3E', '#66C26A', (y - y0) / (y1 - y0)) });
  return [
    P(cyl(0.12, 0.17, 1.0, 7), '#8B5A2B', [0, 0.5, 0]),
    P(ico(0.7, 1), g(-0.7, 0.7), [0, 1.62, 0]),
    P(ico(0.48, 1), g(-0.48, 0.48), [0.46, 1.25, 0.22]),
    P(ico(0.46, 1), g(-0.46, 0.46), [-0.42, 1.3, -0.2]),
  ];
};
B.cooler = () => [
  P(rbox(0.8, 0.36, 0.5, 0.06, 1), grad('#23968A', '#3CC4B3', 0, 0.36), [0, 0.18, 0]),
  P(rbox(0.84, 0.12, 0.54, 0.05, 1), '#FFFFFF', [0, 0.41, 0]),
  P(box(0.46, 0.04, 0.06), '#FFFFFF', [0, 0.55, 0]),
  P(box(0.04, 0.09, 0.04), '#F0F0F0', [-0.22, 0.5, 0]),
  P(box(0.04, 0.09, 0.04), '#F0F0F0', [0.22, 0.5, 0]),
  P(box(0.12, 0.08, 0.03), '#FFFFFF', [0, 0.33, 0.26]),
];
B.swingset = () => {
  const parts = [], red = '#E8574A', L = 1.1;
  [-L, L].forEach((x) => {
    [-1, 1].forEach((s) => {
      parts.push(P(cyl(0.085, 0.085, 1.7, 6), red, [x, 0.8, s * 0.24], [s * 0.3, 0, 0]));
      parts.push(P(ico(0.11), '#FFC93C', [x, 0.05, s * 0.48]));
    });
  });
  // DECISION (11-05): chunky toy tubes. Real swing-set proportions read as a red wire scribble from the game camera.
  parts.push(P(cyl(0.095, 0.095, 2.42, 8), red, [0, 1.62, 0], [0, 0, PI / 2]));
  [-0.48, 0.48].forEach((x) => {
    parts.push(P(rbox(0.4, 0.08, 0.22, 0.03, 1), '#FFC93C', [x, 0.42, 0]));
    [-0.16, 0.16].forEach((dx) => parts.push(P(cyl(0.022, 0.022, 1.18, 4), '#9AA3B5', [x + dx, 1.02, 0])));
  });
  return parts;
};
B.gazebo = () => {
  const parts = [P(cyl(1.5, 1.6, 0.15, 6), '#EAD9BF', [0, 0.075, 0])];
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6;
    parts.push(P(cyl(0.065, 0.065, 1.5, 6), '#FFF1DC', [Math.cos(a) * 1.35, 0.9, Math.sin(a) * 1.35]));
    if (i !== 1) {
      const b = a + TAU / 12;
      parts.push(P(box(1.3, 0.06, 0.06), '#FFF1DC', [Math.cos(b) * 1.17, 0.55, Math.sin(b) * 1.17], [0, -b + PI / 2, 0]));
    }
  }
  parts.push(P(cyl(1.78, 1.78, 0.1, 12), '#E8574A', [0, 1.68, 0]));
  parts.push(P(cone(1.75, 0.75, 12), (x, y, z) => (Math.floor(az(x, z) / (TAU / 12)) % 2 ? '#FFF1DC' : '#E8574A'), [0, 2.1, 0]));
  parts.push(P(ico(0.1), '#FFC93C', [0, 2.52, 0]));
  return parts;
};

// ---------------------------------------------------------------- builders: Picnic bosses (≤ 2,500 tris)
const gingham = (cell, a = '#E8574A', b = '#FFF1DC', c = '#F4A493') => (x, y, z) => {
  const i = Math.floor((x + 50) / cell) % 2, j = Math.floor((z + 50) / cell) % 2;
  return i && j ? a : i || j ? c : b;
};
B['boss-table'] = () => {
  const parts = [];
  [-0.33, -0.11, 0.11, 0.33].forEach((z, i) => parts.push(P(rbox(1.8, 0.07, 0.21, 0.03, 1), i % 2 ? '#B86E3B' : '#C67B45', [0, 0.76, z])));
  parts.push(P(box(1.2, 0.012, 0.92, 8, 1, 6), gingham(0.15), [0, 0.802, 0]));
  [-0.7, 0.7].forEach((x) => [-1, 1].forEach((s) => parts.push(P(box(0.08, 0.86, 0.08), '#A9653A', [x, 0.38, s * 0.3], [s * 0.42, 0, 0]))));
  [-0.68, 0.68].forEach((z) => {
    parts.push(P(rbox(1.8, 0.06, 0.24, 0.025, 1), '#C67B45', [0, 0.44, z]));
    [-0.7, 0.7].forEach((x) => parts.push(P(box(0.07, 0.42, 0.07), '#A9653A', [x, 0.21, z])));
  });
  // food on the cloth
  const plate = (x, z) => parts.push(P(lathe([[0, 0], [0.13, 0], [0.18, 0.025], [0, 0.015]], 12), '#FFF6E3', [x, 0.81, z]));
  plate(-0.48, 0.2); plate(0.45, -0.22); plate(0.42, 0.24);
  parts.push(P(cyl(0.17, 0.17, 0.16, 14), '#FFB3C7', [-0.05, 0.89, -0.12]));
  parts.push(P(cyl(0.18, 0.18, 0.04, 14), '#FFFFFF', [-0.05, 0.98, -0.12]));
  parts.push(P(ico(0.04), '#D8263B', [-0.05, 1.02, -0.12]));
  parts.push(P(slab(polyShape([[-0.1, -0.08], [0.12, -0.08], [-0.1, 0.12]], 0.02), 0.07, 0.008, 2), (x, y, z, t, nx, ny) => (ny > 0.6 ? '#F7DDA8' : '#C98B4E'), [-0.48, 0.83, 0.2]));
  parts.push(P(ico(0.08, 1), '#D93A3A', [0.42, 0.89, -0.22]));
  parts.push(P(ico(0.07, 1), '#FFE14D', [0.5, 0.88, -0.14], null, [1.3, 0.9, 1]));
  parts.push(P(lathe([[0, 0], [0.09, 0], [0.1, 0.18], [0.07, 0.24], [0.075, 0.27], [0, 0.27]], 10), (x, y) => (y > 0.2 ? '#FFFFFF' : '#FF9A1F'), [0.42, 0.81, 0.24]));
  parts.push(P(sph(0.06, 6, 5), '#8C55D3', [0.62, 0.86, 0.02]));
  parts.push(P(sph(0.06, 6, 5), '#7A48C2', [0.66, 0.86, 0.1]));
  return parts;
};
B['boss-hamper'] = () => {
  const weave = (x, y, z, t) => ((Math.floor((x + 5) / 0.27) + Math.floor((y + 5) / 0.25) + Math.floor((z + 5) / 0.25)) % 2 ? '#B07338' : '#C98B4E');
  const parts = [P(box(1.6, 0.75, 1.0, 6, 3, 4), weave, [0, 0.375, 0])];
  parts.push(P(rbox(1.66, 0.08, 1.06, 0.03, 1), '#D9A066', [0, 0.75, 0]));
  // two lids, hinged on the long edges, open like wings
  parts.push(P(box(1.6, 0.06, 0.5, 6, 1, 2), weave, [0, 0.96, -0.62], [-1.15, 0, 0]));
  parts.push(P(box(1.6, 0.06, 0.5, 6, 1, 2), weave, [0, 0.96, 0.62], [1.15, 0, 0]));
  // straps + buckles
  [-0.45, 0.45].forEach((x) => {
    parts.push(P(box(0.1, 0.78, 1.04), '#7A4E2D', [x, 0.385, 0]));
    parts.push(P(box(0.14, 0.12, 0.03), '#FFC93C', [x, 0.5, 0.53]));
  });
  // cloth + food
  parts.push(P(sph(0.72, 10, 6), gingham(0.16), [0, 0.74, 0], null, [1.05, 0.22, 0.65]));
  parts.push(P(cyl(0.07, 0.07, 0.8, 8), '#D9A05B', [-0.3, 1.0, -0.12], [0, 0.3, 1.05]));
  parts.push(P(cyl(0.065, 0.065, 0.7, 8), '#E0AA68', [-0.1, 1.02, 0.08], [0, -0.4, 1.2]));
  parts.push(P(lathe([[0, 0], [0.1, 0], [0.11, 0.3], [0.05, 0.4], [0.045, 0.48], [0, 0.48]], 10), (x, y) => (y > 0.38 ? '#FFFFFF' : '#5BC0EB'), [0.35, 0.78, -0.1], [0, 0, -0.15]));
  [[0.15, 0.86, 0.18, '#D93A3A'], [0.32, 0.85, 0.24, '#E8463A'], [0.55, 0.84, 0.1, '#D93A3A']].forEach(([x, y, z, c]) => parts.push(P(sph(0.11, 8, 6), c, [x, y, z])));
  parts.push(P(cyl(0.17, 0.17, 0.11, 12), '#FFCF3D', [-0.52, 0.83, 0.2], [0.2, 0, 0.1]));
  [[0.6, -0.2], [0.66, -0.12], [0.56, -0.1], [0.62, -0.28], [0.7, -0.22]].forEach(([x, z], i) => parts.push(P(ico(0.06, 1), i % 2 ? '#8C55D3' : '#7A48C2', [x, 0.84 + (i % 3) * 0.03, z])));
  return parts;
};
B['boss-bigsandwich'] = () => {
  const parts = [], h = 0.95;
  const halves = [[[-h, -h], [h, -h], [-h, h]], [[h, h], [-h, h], [h, -h]]];
  halves.forEach((tri, k) => {
    const off = k ? 0.07 : -0.07;
    const sh = (s) => polyShape(tri.map(([x, y]) => [x * s, y * s]), 0.12 * s);
    let y = 0;
    const layer = (s, d, col, bev = 0) => { parts.push(P(slab(sh(s), d, bev, 3), col, [off, y, -off])); y += d + bev * 2; };
    const bread = (col) => layer(1, 0.11, (x, yy, z, t, nx, ny) => (ny > 0.6 ? col : ny < -0.6 ? '#E8C07A' : '#B5733A'), 0.025);
    bread('#F5D59A');
    layer(1.05, 0.04, '#7CC95A');
    layer(0.99, 0.05, '#E8463A');
    layer(1.04, 0.035, '#FFD54A');
    layer(1.0, 0.06, '#FF9EAE');
    bread('#F2D49A');
    layer(1.05, 0.04, '#6DBB4E');
    layer(1.03, 0.035, '#FFD54A');
    bread('#EDBF6E');
  });
  [[-0.38, 0.38], [0.38, -0.38]].forEach(([x, z]) => {
    parts.push(P(cyl(0.018, 0.018, 0.55, 6), '#E8D3A0', [x, 1.05, z]));
    parts.push(P(ico(0.09, 1), '#D8263B', [x, 1.3, z]));
    parts.push(P(cone(0.07, 0.12, 6), '#2FB5A5', [x, 1.44, z], [PI, 0, 0]));
  });
  return parts;
};
B['boss-watermelon'] = () => {
  const parts = [
    P(sph(1, 24, 16), (x, y, z) => (Math.floor(az(x, z) / (TAU / 24)) % 2 ? '#2F7D35' : '#5CBF5F'), [0, 0.78, 0], [0, 0, PI / 2], [0.82, 1.3, 1]),
    P(cyl(0.05, 0.08, 0.14, 6), '#6B8E23', [-1.33, 0.82, 0], [0, 0, PI / 2]),
  ];
  // two slices leaning on the front
  [[-0.45, 0.3], [0.5, -0.25]].forEach(([x, ry], k) => {
    const sl = [
      P(slab(sectorShape(0.75, 0.42), 0.14, 0.012, 6), (xx, y, z, t, nx, ny) => (Math.abs(ny) > 0.7 ? '#3E9A44' : '#2F7D35')),
      P(slab(sectorShape(0.7, 0.4), 0.16, 0, 6), '#EAF5D0'),
      P(slab(sectorShape(0.66, 0.39), 0.17, 0, 6), (xx, y, z, t, nx, ny) => (ny > 0.7 ? '#FF5A6E' : '#F2475C')),
      ...[[0.25, 0.04], [0.38, -0.1], [0.42, 0.12], [0.52, 0]].map(([sx, sz]) => P(ico(0.03), '#3A2418', [sx, 0.175, sz], null, [1.4, 0.35, 0.8])),
    ];
    // stand the slice up (flesh facing the camera), tip up, rind on the ground
    xf(sl, [PI / 2 - 0.25, 0, PI / 2], [x, 0.0, 0.9 + k * 0.08]);
    xf(sl, [0, ry, 0]);
    parts.push(...sl);
  });
  return parts;
};
B['boss-birthdaycake'] = () => {
  const parts = [];
  const tier = (R, H, y0, body, icing) => {
    parts.push(P(cyl(R, R, H, 28), body, [0, y0 + H / 2, 0]));
    const ic = warp(cyl(R + 0.035, R + 0.035, 0.16, 28, 1, true), (v) => {
      if (v.y < 0) { const k = Math.floor((Math.atan2(v.z, v.x) + PI) / (TAU / 28)); v.y -= (k % 2 ? 0.1 : 0.0); }
    });
    parts.push(P(ic, icing, [0, y0 + H - 0.08, 0]));
    parts.push(P(cyl(R + 0.035, R + 0.035, 0.02, 28), icing, [0, y0 + H + 0.0, 0]));
  };
  tier(2.15, 0.8, 0, '#FFB3C7', '#FFFFFF');
  tier(1.55, 0.7, 0.82, '#FFF1DC', '#FF9EC4');
  tier(1.0, 0.6, 1.54, '#FFB3C7', '#FFFFFF');
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10 + 0.2;
    parts.push(P(ico(0.12, 1), '#D8263B', [Math.cos(a) * 1.85, 0.86, Math.sin(a) * 1.85]));
  }
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    parts.push(P(ico(0.08, 0), ['#FFD23F', '#5BC0EB', '#4CC26A', '#FFFFFF'][i % 4], [Math.cos(a) * 1.28, 1.56, Math.sin(a) * 1.28]));
  }
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 + 0.3, r = i === 4 ? 0 : 0.55, x = Math.cos(a) * r, z = Math.sin(a) * r;
    parts.push(P(cyl(0.055, 0.055, 0.42, 6), (cx, cy) => (Math.floor((cy + 0.3) / 0.1) % 2 ? '#FFFFFF' : '#5BC0EB'), [x, 2.37, z]));
    parts.push(P(ico(0.07, 0), '#FFD23F', [x, 2.66, z], null, [1, 1.6, 1]));
  }
  return parts;
};

// ---------------------------------------------------------------- builders: Market (T0-T4 + bosses)
// Market T0 crumbs
B.olive = () => [
  // green olive lying on its side, red pimento in the +x end
  P(sph(0.05, 10, 7), grad('#4F6420', '#97A845', -0.05, 0.05), [0, 0.05, 0], null, [1.4, 1, 1]),
  P(cyl(0.02, 0.02, 0.012, 7), '#E8463A', [0.068, 0.05, 0], [0, 0, PI / 2]),
  HL(0.012, [-0.02, 0.088, 0.02]),
];
B.cherrytomato = () => [
  P(sph(0.08, 9, 7), grad('#B8261F', '#FF6A4D', -0.08, 0.08), [0, 0.058, 0], null, [1, 0.72, 1]),
  starCap(0.042, 0.016, 0.01, [0, 0.112, 0]),
  stemP(0.03, [0, 0.13, 0], null, '#3F8A3A', 0.008),
  HL(0.016, [-0.03, 0.1, 0.03]),
];
B.nut = () => [
  // hazelnut: pale flat scar at the foot, striped brown shell, little point on top
  P(lathe([[0, 0], [0.05, 0.003], [0.068, 0.025], [0.07, 0.045], [0.06, 0.07], [0.035, 0.09], [0, 0.102]], 9),
    (x, y, z) => (y < 0.022 ? '#E2C394' : Math.floor(az(x, z) / (TAU / 9)) % 2 ? '#9A6234' : '#B57E48')),
  P(cone(0.012, 0.022, 5), '#7A4A24', [0, 0.11, 0]),
  HL(0.012, [-0.03, 0.07, 0.03]),
];

// Market T1
B.orange = () => [
  // DECISION: round orange (h ≈ 2a, catalog h 0.2): it rolls, and a squashed orange reads as a tangerine.
  P(sph(0.15, 10, 7), { v: (x, y, z) => mixC('#E8780F', '#FFB347', (y + 0.15) / 0.3 + 0.08 * hsh(Math.round(x * 400 + z * 900))) }, [0, 0.15, 0]),
  P(cyl(0.012, 0.016, 0.025, 5), '#6B8A3A', [0, 0.305, 0]),
  leaf(0.045, [0.035, 0.305, 0], [0, 0.3, 0.35], '#4FAE45'),
  HL(0.03, [-0.06, 0.25, 0.07]),
];
B.pretzel = () => {
  const S2 = [[-0.5, -0.42], [-0.12, 0.3], [0.18, 0.58], [0.5, 0.62], [0.8, 0.38], [0.86, -0.05], [0.58, -0.45], [0, -0.62],
    [-0.58, -0.45], [-0.86, -0.05], [-0.8, 0.38], [-0.5, 0.62], [-0.18, 0.58], [0.12, 0.3], [0.5, -0.42]];
  // the first strand rides over the second at the knot
  const pts = S2.map(([x, y], i) => V3(x * 0.2, i === 1 || i === 2 ? 0.055 : 0.03, -y * 0.2));
  const c = new T.CatmullRomCurve3(pts, false, 'centripetal');
  const parts = [P(ttube(c, 21, 0.03, 4, (t) => 0.75 + 0.45 * Math.sin(PI * t)), grad('#7E3814', '#C96F33', 0, 0.075))];
  [[0.1, -0.1], [-0.1, -0.1], [0.0, 0.11]].forEach(([x, z], i) => parts.push(P(new T.OctahedronGeometry(0.012), '#FFFFFF', [x, 0.064, z + 0.02 * i], [0.5, i, 0])));
  return parts;
};
B.jamjar = () => {
  const chk = (x, y, z, t, nx, ny) => (ny > 0.5 ? ((Math.floor((x + 1) / 0.045) + Math.floor((z + 1) / 0.045)) % 2 ? '#E8463A' : '#FFFFFF') : (t % 4 < 2 ? '#E8463A' : '#FFFFFF'));
  return [
    P(lathe([[0, 0], [0.1, 0], [0.12, 0.02], [0.13, 0.12], [0.12, 0.165], [0.1, 0.18], [0.1, 0.19], [0, 0.19]], 9),
      (x, y, z, t, nx, ny, nz) => (y > 0.168 ? '#E0457F' : nx * -0.6 + nz * 0.8 > 0.6 ? '#D93A77' : '#B0164F')),
    P(cyl(0.118, 0.118, 0.04, 10), chk, [0, 0.21, 0]),
    HL(0.022, [-0.06, 0.12, 0.1]),
  ];
};
B.donut = () => {
  // icing above a wavy line (5 drips), dough below
  const parts = [P(flat(tor(0.12, 0.06, 6, 12)), (x, y, z) => (y > -0.004 + 0.014 * Math.sin(az(x, z) * 5) ? '#FF8FB8' : '#E8A24E'), [0, 0.06, 0])];
  const sp = ['#FFFFFF', '#FFD23F', '#2FB5A5', '#7A5236', '#FFFFFF'];
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 + 0.3, r = 0.12 + (i % 2 ? 0.02 : -0.02);
    parts.push(P(new T.OctahedronGeometry(0.012), sp[i], [Math.cos(a) * r, 0.118, Math.sin(a) * r], [0, a, 0], [2, 0.6, 0.7]));
  }
  return parts;
};
B.croissant = () => {
  const c = new T.QuadraticBezierCurve3(V3(-0.17, 0.05, 0.05), V3(0, 0.07, -0.17), V3(0.17, 0.05, 0.05));
  const g = ttube(c, 12, 0.075, 6, (t) => (0.3 + 0.7 * Math.pow(Math.sin(PI * t), 0.7)) * (1 + 0.08 * Math.cos(t * 12 * PI)));
  return [
    // flaky bands: alternate the tube rows, darker underneath
    P(g, (x, y, z, t, nx, ny) => (ny < -0.35 ? '#B5702C' : Math.floor(t / 12) % 2 ? '#D98A3A' : '#F2B865')),
    HL(0.018, [-0.02, 0.135, -0.09]),
  ];
};
B.broccoli = () => {
  const bump = (t) => (hsh(t) > 0.55 ? '#3E9B3E' : hsh(t + 7) > 0.5 ? '#2F7D32' : '#4FAE45');
  return [
    P(cyl(0.04, 0.055, 0.1, 6), '#A6D47A', [0, 0.05, 0]),
    P(sph(0.11, 7, 6), (x, y, z, t) => bump(t), [0, 0.15, 0], null, [1, 0.8, 1]),
    P(sph(0.085, 6, 5), (x, y, z, t) => bump(t + 50), [0.1, 0.12, 0.03], null, [1, 0.8, 1]),
    P(sph(0.085, 6, 5), (x, y, z, t) => bump(t + 90), [-0.09, 0.12, -0.04], null, [1, 0.8, 1]),
  ];
};
B.eggplant = () => {
  // DECISION: eggplant lies on its side (the icon stands it up): a long purple shape reads better from the camera.
  const rot = [0, 0, -PI / 2 + 0.12], pos = [0, 0.075, 0];
  return [
    P(lathe([[0, 0], [0.05, 0.015], [0.075, 0.07], [0.068, 0.14], [0.05, 0.2], [0.036, 0.25], [0.02, 0.27]], 10),
      { v: (x, y) => mixC('#3B1C63', '#9A66D0', 0.5 - x / 0.15 + 0.1 * (y - 0.1) / 0.17) }, pos, rot),
    P(slab(starShape(5, 0.055, 0.025), 0.014).translate(0, 0.245, 0), '#3FA34D', pos, rot),
    P(cyl(0.012, 0.016, 0.05, 4).translate(0, 0.285, 0), '#4E8A3A', pos, rot),
    HL(0.018, [0.12, 0.14, 0.03]),
  ];
};
B.pizzaslice = () => {
  const half = 0.36, R = 0.44;
  const parts = [P(slab(sectorShape(R, half), 0.03), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#FFC93C' : '#E8A24E'))];
  parts.push(P(flat(tor(R - 0.015, 0.032, 4, 6, 2 * half)).rotateY(-half), grad('#C97A2E', '#F2B865', -0.03, 0.03), [0, 0.03, 0]));
  [[0.17, 0], [0.28, -0.06], [0.3, 0.07]].forEach(([x, z]) => parts.push(P(cyl(0.045, 0.045, 0.012, 7), '#D33A2C', [x, 0.036, z])));
  parts.push(leaf(0.03, [0.22, 0.04, 0.03], [0, 0.6, 0], '#3FA34D'));
  return parts;
};

// Market T2 food
B.baguette = () => [
  // scores: diagonal light slashes on top (pre-scale coords), paper sleeve + red band at one end
  P(sph(0.1, 16, 8), (x, y, z, t, nx, ny) => {
    if (ny < 0.2) return ny < -0.4 ? '#B8783A' : '#D09050';
    return ((x + 0.45 * z) / 0.045 + 10) % 1 < 0.28 ? '#F6D9A0' : '#D9A05B';
  }, [0, 0.07, 0], null, [3.1, 0.7, 0.85]),
  P(cyl(1, 1, 1, 10, 1, true), '#FFF1DC', [-0.17, 0.068, 0], [0, 0, PI / 2], [0.066, 0.1, 0.078]),
  P(cyl(1, 1, 1, 10, 1, true), '#E8463A', [-0.17, 0.068, 0], [0, 0, PI / 2], [0.068, 0.03, 0.08]),
];
B.pineapple = () => {
  // DECISION: upright pineapple with a leafy crown (h ≈ 0.75, catalog 0.5): a round body + crown cannot be
  // under 2a tall and the crown is what makes it read as a pineapple at phone size.
  const parts = [P(sph(0.2, 12, 9), (x, y, z) => {
    const c = Math.floor(az(x, z) / (TAU / 12) + (y + 0.2) / 0.05 * 0.5), r = Math.floor((y + 0.2) / 0.05);
    if (y < -0.17) return '#B07A2A';
    return (c + r) % 2 ? '#E8A92A' : '#F7CF45';
  }, [0, 0.2, 0], null, [1.1, 1, 1.1])];
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 7, tilt = i === 7 ? 0 : 0.6 + 0.15 * (i % 2), len = i === 7 ? 0.17 : 0.15;
    parts.push(P(cone(0.045, len, 4).translate(0, len / 2, 0), grad('#2F8A3E', '#7ACB62', 0, len), [0, 0.39, 0], [tilt, PI / 2 - a, 0], [1, 1, 0.35]));
  }
  parts.push(HL(0.03, [-0.1, 0.32, 0.12]));
  return parts;
};
B.pumpkin = () => {
  const body = warp(sph(0.3, 16, 8), (v) => {
    const th = Math.atan2(v.z, v.x), k = 0.9 + 0.1 * Math.abs(Math.cos(4 * th));
    v.x *= k; v.z *= k; v.y *= 0.56;
    if (Math.abs(v.y) > 0.15) v.y -= Math.sign(v.y) * 0.03 * (1 - Math.hypot(v.x, v.z) / 0.3);
  });
  const vine = new T.CatmullRomCurve3([V3(0.02, 0.2, 0), V3(0.07, 0.22, 0.02), V3(0.09, 0.2, 0.07), V3(0.05, 0.19, 0.08)]);
  return [
    P(body, (x, y, z) => {
      const th = Math.atan2(z, x), g = Math.abs(Math.cos(4 * th));
      return g < 0.35 ? '#D9600E' : y > 0.05 ? '#FFA040' : '#F5821F';
    }, [0, 0.17, 0]),
    P(cyl(0.025, 0.04, 0.08, 6), '#6B7A35', [0, 0.36, 0], [0.15, 0, 0.1]),
    leaf(0.06, [-0.07, 0.33, 0.03], [0, 0.4, 0.2], '#4FAE45'),
    P(new T.TubeGeometry(vine, 6, 0.009, 3, false), '#5E9E3A', [0, 0.14, 0]),
    HL(0.04, [-0.12, 0.28, 0.12]),
  ];
};
B.cheesewheel = () => {
  // DECISION: the cheese wheel stands on its edge, axle along x, so its roll (about local x) reads as a wheel
  // rolling; h ≈ 2a (0.72) vs catalog 0.22 (render: yaw it to the roll heading).
  const prof = [[0, -0.08], [0.17, -0.08], [0.185, -0.066], [0.19, 0], [0.185, 0.066], [0.17, 0.08], [0, 0.08]];
  const rot = [0, 0, PI / 2], pos = [0, 0.19, 0];
  return [
    P(lathe(prof, 14), (x, y, z, t, nx, ny) => (Math.abs(ny) > 0.7 ? '#FFD95A' : Math.abs(y) > 0.06 ? '#F7C23A' : '#E8A92A'), pos, rot),
    P(cyl(0.085, 0.085, 0.006, 10).translate(0, 0.081, 0), '#FFF6E3', pos, rot),
    P(cyl(0.085, 0.085, 0.006, 10).translate(0, -0.081, 0), '#FFF6E3', pos, rot),
    P(cyl(0.04, 0.04, 0.004, 8).translate(0, 0.086, 0), '#E8463A', pos, rot),
    HL(0.025, [0.06, 0.32, 0.09]),
  ];
};

// Market T2 stacks + props
const M_lid = (x, y, z, t, nx, ny) => (ny > 0.5 ? ((Math.floor((x + 1) / 0.05) + Math.floor((z + 1) / 0.05)) % 2 ? '#E8463A' : '#FFFFFF') : (t % 4 < 2 ? '#E8463A' : '#FFFFFF'));
const M_jar = (x, y, z) => [
  P(cyl(0.085, 0.085, 0.16, 7), (px, py, pz, t, nx, ny, nzz) => (py > 0.05 ? '#E0457F' : -0.6 * nx + 0.8 * nzz > 0.5 ? '#D93A77' : '#B0164F'), [x, y + 0.08, z]),
  P(cyl(0.09, 0.09, 0.035, 7), M_lid, [x, y + 0.1775, z]),
];
B.jarstack = () => {
  // DECISION: fragile stack of jam jars. (11-04 review) the old two round trays hid every jar from the 55° camera
  // (it read as a tan pancake stack): now 3 big jars, ONE thin board, 3 small jars, so the top view is three
  // red-and-white gingham lids on magenta glass with blank cream labels. Contents sit on the top lids
  // (slots = lid centres, top = lid top).
  const parts = [];
  const jar = (x, y, z, r, h) => {
    parts.push(P(cyl(r, r, h, 7), (px, py, pz, t, nx, ny, nzz) => {
      if (ny > 0.5) return '#E0457F';
      if (py > -h * 0.16 && py < h * 0.2) return '#FFF1DC';
      return -0.6 * nx + 0.8 * nzz > 0.5 ? '#D93A77' : '#B0164F';
    }, [x, y + h / 2, z]));
    parts.push(P(cyl(r * 1.08, r * 1.08, 0.035, 7), M_lid, [x, y + h + 0.0175, z]));
  };
  const B0 = 0.19, BY = B0 + 0.035, BT = BY + 0.03, H1 = 0.15;
  for (let k = 0; k < 3; k++) { const a = PI / 2 + k * TAU / 3; jar(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, 0.11, B0); }
  parts.push(P(cyl(0.28, 0.28, 0.03, 10), (x, yy, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#B07338'), [0, BY + 0.015, 0]));
  const tops = [];
  for (let k = 0; k < 3; k++) { const a = -PI / 2 + k * TAU / 3; tops.push([Math.cos(a) * 0.13, Math.sin(a) * 0.13]); jar(tops[k][0], BT, tops[k][1], 0.085, H1); }
  parts.top = BT + H1 + 0.035;
  parts.slots = tops;
  return parts;
};
B.eggcrate = () => {
  // fragile stack: slatted wooden crate holding a cardboard tray of 6 eggs; contents ride on the eggs
  const slat = (x, y, z, t) => (Math.floor((y + 0.08) / 0.0534) === 1 ? '#8E5C2C' : t % 4 < 2 ? '#C98B4E' : '#D9A066');
  const parts = [
    P(box(0.56, 0.16, 0.02, 1, 3, 1), slat, [0, 0.08, 0.2]), P(box(0.56, 0.16, 0.02, 1, 3, 1), slat, [0, 0.08, -0.2]),
    P(box(0.02, 0.16, 0.38, 1, 3, 1), slat, [0.27, 0.08, 0]), P(box(0.02, 0.16, 0.38, 1, 3, 1), slat, [-0.27, 0.08, 0]),
    P(box(0.52, 0.03, 0.38), '#C9B48E', [0, 0.14, 0]),
  ];
  [[-0.27, -0.2], [0.27, -0.2], [-0.27, 0.2], [0.27, 0.2]].forEach(([x, z]) => parts.push(P(box(0.05, 0.18, 0.05), '#A8743E', [x, 0.09, z])));
  const eggs = [];
  for (let i = 0; i < 6; i++) {
    const x = -0.16 + (i % 3) * 0.16, z = i < 3 ? -0.085 : 0.085;
    eggs.push([x, z]);
    parts.push(P(sph(0.065, 6, 4), grad(i % 3 === 1 ? '#D9B48A' : '#E8DCC8', i % 3 === 1 ? '#F2D5B0' : '#FFFBF2', -0.065, 0.065), [x, 0.2, z], null, [1, 1.25, 1]));
  }
  parts.top = 0.28;
  parts.slots = [eggs[1], eggs[3], eggs[5]];
  return parts;
};
B.flowerbucket = () => {
  const parts = [
    P(lathe([[0, 0], [0.15, 0], [0.19, 0.18], [0.205, 0.19], [0.205, 0.205], [0, 0.19]], 10), (x, y, z, t, nx, ny, nz2) => (y > 0.175 ? '#7EE0D2' : nx * x + nz2 * z < 0 ? '#1D7F75' : '#2FB5A5')),
    P(sph(0.17, 8, 4), grad('#2F8A3E', '#5FB54A', -0.17, 0.17), [0, 0.2, 0], null, [1, 0.5, 1]),
  ];
  const fl = [['#FF7FB0', 0.4, 0.13], ['#FFC93C', 2.0, 0.12], ['#FFFFFF', 3.6, 0.13], ['#FF7A59', 5.1, 0.1]];
  fl.forEach(([c, a, r], i) => {
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0.27 + 0.03 * (i % 2);
    parts.push(P(cyl(0.07, 0.07, 0.02, 7), (px, py, pz, t) => (t % 2 ? c : mixC(c, '#FFFFFF', 0.25)), [x, y, z], [0.45, PI / 2 - a, 0]));
    parts.push(P(ico(0.03), i === 2 ? '#FFC93C' : '#7A4E2D', [x * 1.08, y + 0.02, z * 1.08], null, [1, 0.6, 1]));
  });
  parts.push(leaf(0.07, [0.02, 0.3, -0.03], [0, 1.2, -0.6], '#4FAE45'), leaf(0.07, [-0.05, 0.3, 0.06], [0, -2, -0.6], '#3E9443'));
  return parts;
};
B.aboard = () => {
  // A-frame chalk board: slate panels in wood frames, chalk star + two chalk lines (no lettering)
  const panel = (back) => {
    const g = [
      P(box(0.56, 0.68, 0.025), '#B07338'),
      P(box(0.48, 0.6, 0.03), '#3A3F4A', [0, 0, 0.003]),
      P(slab(starShape(5, 0.08, 0.035), 0.004), '#F4F4F4', [0, 0.1, 0.019], [PI / 2, 0, 0]),
      P(box(0.3, 0.02, 0.004), '#E8E8E8', [0, -0.07, 0.019]),
      P(box(0.22, 0.02, 0.004), '#FFD23F', [0, -0.15, 0.019]),
    ];
    return xf(g, [back ? 0.25 : -0.25, back ? PI : 0, 0], [0, 0.33, back ? -0.085 : 0.085]);
  };
  return [...panel(false), ...panel(true), P(cyl(0.025, 0.025, 0.58, 6), '#8E5C2C', [0, 0.66, 0], [0, 0, PI / 2]), P(box(0.5, 0.02, 0.2), '#8E5C2C', [0, 0.2, 0])];
};
B.bollard = () => [
  P(lathe([[0, 0], [0.15, 0], [0.15, 0.035], [0.12, 0.055], [0.105, 0.21], [0.115, 0.23], [0.07, 0.27], [0, 0.28]], 12),
    (x, y) => (y < 0.05 ? '#3A3F52' : y > 0.12 && y < 0.15 ? '#3A3F52' : y > 0.165 && y < 0.185 ? '#FFFFFF' : '#FFCF3D')),
  HL(0.02, [-0.05, 0.25, 0.05]),
];
B.crate = () => {
  const slat = (x, y, z, t) => (Math.floor((y + 0.15) / 0.1) === 1 ? '#8E5C2C' : t % 4 < 2 ? '#C98B4E' : '#D9A066');
  const parts = [
    P(box(0.6, 0.3, 0.02, 1, 3, 1), slat, [0, 0.15, 0.24]), P(box(0.6, 0.3, 0.02, 1, 3, 1), slat, [0, 0.15, -0.24]),
    P(box(0.02, 0.3, 0.46, 1, 3, 1), slat, [0.29, 0.15, 0]), P(box(0.02, 0.3, 0.46, 1, 3, 1), slat, [-0.29, 0.15, 0]),
    P(box(0.56, 0.02, 0.46), '#5A3A1E', [0, 0.22, 0]),
  ];
  [[-0.29, -0.24], [0.29, -0.24], [-0.29, 0.24], [0.29, 0.24]].forEach(([x, z]) => parts.push(P(box(0.05, 0.32, 0.05), '#A8743E', [x, 0.16, z])));
  parts.push(...heap(0.2, 5, ['#FF9A1F', '#E8463A', '#FF9A1F', '#FFB347', '#D93A3A'], [0, 0.17, 0], 1));
  return parts;
};

// Market T3
B.barrel = () => {
  const prof = [[0, 0], [0.37, 0], [0.42, 0.16], [0.445, 0.36], [0.42, 0.56], [0.37, 0.72], [0.33, 0.72], [0.33, 0.7], [0, 0.7]];
  const parts = [P(lathe(prof, 16), (x, y, z, t, nx, ny) => {
    if (ny > 0.6 && y > 0.69) return Math.hypot(x, z) > 0.3 ? '#7A4A24' : Math.floor((x + 1) / 0.11) % 2 ? '#B5824E' : '#C9965E';
    return Math.floor(az(x, z) / (TAU / 16)) % 2 ? '#9A6A45' : '#B07A50';
  })];
  [[0.08, 0.395], [0.36, 0.447], [0.64, 0.395]].forEach(([y, R]) => parts.push(P(flat(tor(R, 0.018, 4, 16)), '#4A4F63', [0, y, 0])));
  parts.push(P(box(0.16, 0.03, 0.04), '#7A4A24', [0, 0.72, 0]));
  return parts;
};
B.scooter = () => {
  // DECISION: D29 toy scooter, front toward +z: smooth body hump instead of a seat, no rider, basket with a baguette.
  const c = '#FF7A59', cd = '#E0603F';
  const parts = [
    P(sph(0.2, 12, 8), grad(cd, '#FF9A7A', -0.2, 0.2), [0, 0.28, -0.2], null, [0.72, 0.62, 1.25]),
    P(box(0.22, 0.05, 0.4), '#4A4F63', [0, 0.17, 0.04]),
    P(rbox(0.26, 0.36, 0.06, 0.03, 1), grad(cd, c, -0.18, 0.18), [0, 0.34, 0.24], [-0.2, 0, 0]),
    P(cyl(0.022, 0.022, 0.18, 6), '#E8EDF2', [0, 0.5, 0.28], [-0.2, 0, 0]),
    P(cyl(0.02, 0.02, 0.4, 6), '#E8EDF2', [0, 0.57, 0.3], [0, 0, PI / 2]),
    P(cyl(0.05, 0.05, 0.03, 8), '#FFF6C2', [0, 0.5, 0.345], [PI / 2, 0, 0]),
    P(tor(0.11, 0.03, 4, 6, PI), c, [0, 0.1, 0.3], [0, PI / 2, 0]),
    P(box(0.2, 0.1, 0.14), (x, y, z, t) => (t % 4 < 2 ? '#C98B4E' : '#B07338'), [0, 0.46, 0.43]),
    P(sph(0.04, 8, 4), '#D9A05B', [0.02, 0.52, 0.43], [0, 0.4, 0.5], [1, 3.2, 1]),
  ];
  parts.push(...wheel(0.1, 0.07, [0, 0.1, 0.3]), ...wheel(0.1, 0.08, [0, 0.1, -0.25]));
  return parts;
};

// Market T4 (≤ 600 tris). D29 toy vehicles: front toward +z, painted opaque windows, no seats or figures.
B.car = () => {
  const body = '#2FB5A5', dark = '#23968A';
  const parts = [
    P(rbox(0.9, 0.36, 1.9, 0.12, 1), grad(dark, body, 0.18, 0.54), [0, 0.36, 0]),
    P(rbox(0.78, 0.36, 1.0, 0.08, 1), grad(body, '#5FD3C4', 0.54, 0.9), [0, 0.72, -0.1]),
    pane(0.62, 0.24, [0, 0.72, 0.405]), pane(0.62, 0.24, [0, 0.72, -0.605], PI),
    pane(0.8, 0.22, [0.395, 0.72, -0.1], PI / 2), pane(0.8, 0.22, [-0.395, 0.72, -0.1], -PI / 2),
    P(box(0.14, 0.08, 0.02), '#FFF6C2', [0.3, 0.42, 0.955]), P(box(0.14, 0.08, 0.02), '#FFF6C2', [-0.3, 0.42, 0.955]),
    P(box(0.14, 0.08, 0.02), '#E8463A', [0.3, 0.42, -0.955]), P(box(0.14, 0.08, 0.02), '#E8463A', [-0.3, 0.42, -0.955]),
    P(box(0.92, 0.08, 0.06), HUB, [0, 0.24, 0.96]), P(box(0.92, 0.08, 0.06), HUB, [0, 0.24, -0.96]),
  ];
  for (const x of [-0.42, 0.42]) for (const z of [-0.6, 0.6]) parts.push(...wheel(0.17, 0.14, [x, 0.17, z], 8, 5));
  return parts;
};
B.van = () => {
  const y0 = '#F2B21F', y1 = '#FFD84A';
  const band = (x, y) => (y > 0.0 && y < 0.14 ? '#FFFFFF' : y > -0.08 && y < 0.0 ? '#E8574A' : null);
  const parts = [
    P(rbox(1.1, 1.25, 2.4, 0.12, 1), (x, y, z, t, nx, ny) => band(x, y) || (ny > 0.5 ? y1 : y0), [0, 0.825, 0]),
    P(rbox(1.06, 0.55, 0.42, 0.1, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? y1 : y0), [0, 0.475, 1.38]),
    pane(0.86, 0.36, [0, 1.12, 1.205]),
    pane(0.4, 0.32, [0.555, 1.12, 0.92], PI / 2), pane(0.4, 0.32, [-0.555, 1.12, 0.92], -PI / 2),
    P(box(0.14, 0.09, 0.02), '#FFF6C2', [0.36, 0.55, 1.595]), P(box(0.14, 0.09, 0.02), '#FFF6C2', [-0.36, 0.55, 1.595]),
    P(box(1.1, 0.1, 0.06), HUB, [0, 0.3, 1.6]),
  ];
  for (const x of [-0.5, 0.5]) for (const z of [-0.8, 1.15]) parts.push(...wheel(0.22, 0.16, [x, 0.22, z], 8, 5));
  return parts;
};
B.stall = () => {
  // market stall: striped counter, four posts, scalloped awning, three crates heaped with fruit
  const pile = (cols, seed) => (x, y, z, t) => cols[Math.floor(hsh(t + seed) * cols.length)];
  const parts = [
    P(box(1.8, 0.8, 0.8, 6, 1, 1), (x, y, z, t, nx, ny, nzz) => (nzz > 0.5 ? (Math.floor((x + 0.9) / 0.3 - 1e-3) % 2 ? '#FFF1DC' : '#FF7A59') : ny > 0.5 ? '#D9A066' : '#B07338'), [0, 0.4, 0]),
  ];
  for (const x of [-0.88, 0.88]) for (const z of [-0.36, 0.36]) parts.push(P(cyl(0.04, 0.04, 1.62, 5), '#FFF1DC', [x, 0.81, z]));
  parts.push(...awning(2.0, 1.1, 6, '#FF7A59', '#FFF1DC', [0, 1.6, 0.12], 0.3));
  [[-0.58, ['#FF9A1F', '#FFB347', '#E8780F'], '#FF9A1F'], [0, ['#E8463A', '#D33A2C', '#FF6A4D'], '#E8463A'], [0.58, ['#9BCF4A', '#7CB83A', '#FFD23F'], '#9BCF4A']].forEach(([x, cols, top], i) => {
    parts.push(P(box(0.52, 0.16, 0.6), (px, py, pz, t) => (t % 4 < 2 ? '#C98B4E' : '#A8743E'), [x, 0.88, 0]));
    parts.push(P(sph(0.26, 8, 4), pile(cols, i * 31), [x, 0.96, 0], null, [1, 0.42, 1.12]));
    parts.push(P(sph(0.08, 6, 4), grad(mixC(top, '#3A2418', 0.2), mixC(top, '#FFFFFF', 0.2), -0.08, 0.08), [x + 0.05, 1.08, 0.08]));
  });
  return parts;
};
B.kiosk = () => {
  // octagonal sweet kiosk: purple body, serving hatch with three sweet jars, striped cone roof, pennants
  const parts = [
    P(cyl(0.95, 0.95, 0.1, 8), '#5A3A7E', [0, 0.05, 0], [0, PI / 8, 0]),
    P(cyl(0.9, 0.9, 0.8, 8), (x, y, z, t) => (Math.floor(t / 2) % 2 ? '#7A4C9E' : '#8C5DB0'), [0, 0.5, 0], [0, PI / 8, 0]),
    P(flat(tor(0.92, 0.03, 3, 8)), '#FFD23F', [0, 0.82, 0], [0, PI / 8, 0]),
    P(box(0.62, 0.4, 0.02), '#3A2A4E', [0, 0.58, 0.835]),
    P(box(0.72, 0.04, 0.2), '#FFF1DC', [0, 0.36, 0.9]),
    P(cyl(1.08, 1.08, 0.08, 8), '#FFF1DC', [0, 0.94, 0], [0, PI / 8, 0]),
    P(cone(1.12, 0.55, 8), (x, y, z) => (Math.floor(az(x, z) / (TAU / 8) + 0.5) % 2 ? '#FFF1DC' : '#FF7FB0'), [0, 1.255, 0], [0, PI / 8, 0]),
    P(ico(0.09), '#FFD23F', [0, 1.6, 0]),
    pane(0.36, 0.3, [0.593, 0.55, -0.593], PI * 0.75), pane(0.36, 0.3, [-0.593, 0.55, -0.593], -PI * 0.75),
  ];
  [['#FF7FB0', -0.22], ['#FFC93C', 0], ['#2FB5A5', 0.22]].forEach(([c, x]) => {
    parts.push(P(cyl(0.07, 0.07, 0.14, 7), (px, py) => (py > 0.03 ? '#E8F6FA' : c), [x, 0.45, 0.9]));
    parts.push(P(cyl(0.075, 0.075, 0.03, 7), '#E8574A', [x, 0.535, 0.9]));
  });
  const pc = ['#FFD23F', '#2FB5A5', '#FF7A59', '#FFFFFF'];
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + PI / 8, r = 1.06;
    parts.push(P(slab(polyShape([[-0.08, 0], [0.08, 0], [0, -0.16]]), 0.01), pc[i % 4], [Math.cos(a) * r, 0.9, Math.sin(a) * r], [PI / 2, PI / 2 - a, 0]));
  }
  return parts;
};

// Market bosses (≤ 2500 tris).
const M_wood = (x, y, z, t) => (t % 4 < 2 ? '#C98B4E' : '#B07338');
const M_brick = (x, y, z, t) => { const k = hsh(Math.floor(t / 2) * 0.37 + 3); return k > 0.75 ? '#D27350' : k > 0.35 ? '#C4643F' : '#B0553A'; };
/** Cart wheel, axle along z: wooden rim, gold hub, six spokes (~180 tris). */
const M_spoked = (r, pos, rim = '#7A4A24', spoke = '#E8A24E') => {
  const out = [P(tor(r, 0.045, 4, 14), rim, pos), P(cyl(0.07, 0.07, 0.12, 8), '#FFD23F', pos, [PI / 2, 0, 0])];
  for (let k = 0; k < 3; k++) out.push(P(box(0.035, r * 2, 0.035), spoke, pos, [0, 0, k * PI / 3]));
  return out;
};
/** Door/oven arch in the xy plane: w wide, h tall, round top. */
const M_arch = (w, h) => { const s = new T.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, PI, false); s.lineTo(-w / 2, 0); return s; };
/** Small pizza lying flat, bottom at y = 0 (radius r). */
const M_pizza = (r, pos, nPep = 4, rot = 0) => {
  const out = [
    P(cyl(r, r, 0.04, 12), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#FFD45A' : '#E8A24E'), [0, 0.02, 0]),
    P(flat(tor(r, r * 0.17, 4, 14)), ngrad('#E8A24E', '#F2BE6A', '#D98A3E'), [0, 0.04, 0]),
  ];
  for (let i = 0; i < nPep; i++) { const a = i * TAU / nPep + 0.5, rr = r * 0.5; out.push(P(cyl(r * 0.2, r * 0.2, 0.015, 7), '#C8372D', [Math.cos(a) * rr, 0.045, Math.sin(a) * rr])); }
  return xf(out, [0, rot, 0], pos);
};

B['boss-fruitstall'] = () => {
  // DECISION: grand fruit stall: plank counter with a striped skirt, three stepped crate tiers heaped with fruit,
  // blank price tags (no text), a hanging banana bunch, a scalloped coral awning on four posts.
  const parts = [
    P(box(2.8, 0.7, 1.3, 8, 1, 1), (x, y, z, t, nx, ny, nzz) => (nzz > 0.5 ? (Math.floor((x + 1.4) / 0.35 - 1e-3) % 2 ? '#FFF1DC' : '#FF7A59') : ny > 0.5 ? '#D9A066' : '#B07338'), [0, 0.35, 0]),
    P(box(2.9, 0.06, 1.4), '#8A5A32', [0, 0.73, 0]),
  ];
  const fruit = [
    [['#FF9A1F', '#FFB347'], ['#E8463A', '#D33A2C'], ['#FFD23F', '#FFE066']],
    [['#9BCF4A', '#7CB83A'], ['#FFB38A', '#FF9A7A'], ['#8C4A9E', '#A35DB5']],
    [['#E8463A', '#FF6A4D'], ['#FF9A1F', '#FFB347'], ['#C9D44A', '#B5C23A']],
  ];
  for (let i = 0; i < 3; i++) {
    const hgt = 0.14 + 0.2 * i, z = 0.4 - 0.42 * i, top = 0.76 + hgt;
    parts.push(P(box(2.6, hgt, 0.42, 3, 1, 1), M_wood, [0, 0.76 + hgt / 2, z]));
    for (let j = 0; j < 3; j++) parts.push(...heap(0.24, i ? 4 : 5, fruit[i][j], [-0.86 + 0.86 * j, top - 0.02, z], i * 3 + j));
  }
  for (let j = 0; j < 3; j++) {
    const x = -0.56 + 0.86 * j;
    parts.push(P(box(0.016, 0.16, 0.016), '#8A5A32', [x, 0.98, 0.64]));
    parts.push(P(box(0.17, 0.1, 0.014), '#FFFFFF', [x, 1.08, 0.645], [-0.3, 0, 0]));
  }
  for (const x of [-1.36, 1.36]) {
    parts.push(P(cyl(0.05, 0.05, 0.95, 6), '#FFF1DC', [x, 0.76 + 0.475, 0.6]));
    parts.push(P(cyl(0.05, 0.05, 1.3, 6), '#FFF1DC', [x, 0.76 + 0.65, -0.62]));
  }
  parts.push(...awning(3.0, 1.45, 8, '#FF7A59', '#FFF1DC', [0, 1.85, 0.1], 0.28));
  // banana bunch hanging under the front edge
  const S0 = [0.95, 1.5, 0.5];
  parts.push(P(cyl(0.014, 0.014, 0.2, 4), '#6B4A2B', [S0[0], S0[1] + 0.1, S0[2]]));
  for (let k = 0; k < 4; k++) {
    parts.push(...xf([P(tor(0.13, 0.034, 4, 6, PI * 0.5), grad('#E8B820', '#FFE066', -0.1, 0.1), [0.13, 0, 0], [0, 0, PI])], [0, k * PI / 2 + 0.4, 0], S0));
  }
  return parts;
};

B['boss-bakerycart'] = () => {
  // DECISION: toy bakery hand-cart: wooden bread case on two big spoked wheels, push handle at +x, a striped
  // caramel gable canopy on four poles, loaves, baguettes and croissants on show (no figures, no text).
  const parts = [
    P(rbox(2.0, 0.42, 1.0, 0.06, 1), (x, y, z, t, nx, ny, nzz) => (ny > 0.5 ? '#D9A066' : Math.abs(nzz) > 0.5 ? (y > 0.08 ? '#FFF1DC' : '#E8A24E') : '#C98B4E'), [0, 0.51, 0]),
    P(box(2.06, 0.05, 1.06), '#8A5A32', [0, 0.735, 0]),
    ...M_spoked(0.32, [0.3, 0.32, 0.58]), ...M_spoked(0.32, [0.3, 0.32, -0.58]),
    P(cyl(0.03, 0.03, 1.24, 6), '#8A5A32', [0.3, 0.32, 0], [PI / 2, 0, 0]),
    P(cyl(0.04, 0.04, 0.84, 6), '#FFD23F', [1.43, 0.7, 0], [PI / 2, 0, 0]),
  ];
  for (const z of [-0.35, 0.35]) {
    parts.push(P(box(0.06, 0.32, 0.06), '#8A5A32', [-0.82, 0.16, z]));
    parts.push(P(cyl(0.03, 0.03, 0.46, 6), '#8A5A32', [1.2, 0.7, z], [0, 0, PI / 2]));
  }
  for (const x of [-0.94, 0.94]) for (const z of [-0.44, 0.44]) parts.push(P(cyl(0.028, 0.028, 0.36, 5), '#FFF1DC', [x, 0.94, z]));
  parts.push(...awning(2.2, 0.62, 6, '#E8A24E', '#FFF1DC', [0, 1.12, 0.27], 0.22));
  parts.push(...awning(2.2, 0.62, 6, '#E8A24E', '#FFF1DC', [0, 1.12, -0.27], 0.22, PI));
  for (const x of [-1.1, 1.1]) parts.push(P(ico(0.06), '#FFD23F', [x, 1.22, 0]));
  // bread: boules at the back, croissants at the front, baguettes on the right
  const boule = (x, y, z) => (y > 0.08 && (Math.abs(x) < 0.03 || Math.abs(z) < 0.03) ? '#FFE3B0' : y > 0 ? '#D98A3E' : '#B86A2A');
  for (const x of [-0.65, -0.3, 0.05]) parts.push(P(sph(0.17, 9, 6), boule, [x, 0.8, -0.22], [0, x, 0], [1, 0.6, 1]));
  const crois = (x, y, z) => (Math.floor(Math.atan2(-z, x) / (PI * 1.15 / 5) + 10) % 2 ? '#E8A24E' : '#F6C77A');
  [-0.65, -0.3, 0.05].forEach((x, i) => parts.push(P(flat(tor(0.1, 0.05, 5, 7, PI * 1.15)), crois, [x, 0.8, 0.22], [0, 1.0 + i * 0.7, 0])));
  const bag = (x, y, z) => (y > 0.03 && Math.floor((z + 0.075) / 0.025) % 2 ? '#F2C27A' : '#D98A3E');
  [0.5, 0.68, 0.86].forEach((x, i) => parts.push(P(sph(0.075, 8, 5), bag, [x, 0.82, 0.02 * i], [0, 0.12 - i * 0.12, 0], [1, 0.9, 4.2])));
  return parts;
};

B['boss-bakeryvan'] = () => {
  // DECISION: D29 toy bakery van, front toward +z: cream and strawberry two-tone body, painted opaque windows,
  // no seats or figures; a serving hatch on the +x side with a scalloped awning and four cupcakes on the counter;
  // a giant croissant on the roof.
  const tone = (x, y, z, t, nx, ny) => (ny > 0.5 ? '#FFF6E8' : y < -0.12 ? '#F48FB1' : y < -0.06 ? '#FFFFFF' : '#FFF1DC');
  const parts = [
    P(rbox(1.3, 1.15, 2.5, 0.14, 1), tone, [0, 0.825, -0.1]),
    P(rbox(1.26, 0.62, 0.56, 0.12, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#FFF1DC' : '#F48FB1'), [0, 0.56, 1.38]),
    pane(1.0, 0.4, [0, 1.12, 1.157]),
    pane(0.4, 0.34, [0.657, 1.12, 0.9], PI / 2), pane(0.4, 0.34, [-0.657, 1.12, 0.9], -PI / 2),
    pane(0.6, 0.3, [-0.657, 1.12, -0.45], -PI / 2),
    pane(0.36, 0.3, [0.3, 1.12, -1.357], PI), pane(0.36, 0.3, [-0.3, 1.12, -1.357], PI),
    P(box(0.16, 0.1, 0.02), '#FFF6C2', [0.38, 0.62, 1.663]), P(box(0.16, 0.1, 0.02), '#FFF6C2', [-0.38, 0.62, 1.663]),
    P(box(1.32, 0.1, 0.08), HUB, [0, 0.33, 1.68]), P(box(1.32, 0.1, 0.08), HUB, [0, 0.33, -1.37]),
    P(box(0.02, 0.48, 1.1), '#5A3A2E', [0.657, 1.02, -0.35]),
    P(box(0.24, 0.05, 1.2), '#FFFFFF', [0.77, 0.78, -0.35]),
  ];
  for (const x of [-0.6, 0.6]) for (const z of [-0.85, 1.15]) parts.push(...wheel(0.25, 0.18, [x, 0.25, z], 8, 5));
  ['#FF9FB8', '#FFF1DC', '#8A5A3C', '#BDE7F0'].forEach((c, k) => {
    const z = -0.35 + (k - 1.5) * 0.27;
    parts.push(P(cyl(0.065, 0.05, 0.09, 7), (x, y, zz, t) => (t % 4 < 2 ? '#FFFFFF' : '#FF9FB8'), [0.78, 0.85, z]));
    parts.push(P(sph(0.075, 7, 4), c, [0.78, 0.92, z], null, [1, 0.85, 1]));
    parts.push(P(ico(0.025), '#E8463A', [0.78, 0.985, z]));
  });
  parts.push(...awning(1.3, 0.5, 5, '#F48FB1', '#FFFFFF', [0.9, 1.36, -0.35], 0.45, PI / 2));
  for (const [r, i] of [[0.13, -2], [0.18, -1], [0.22, 0], [0.18, 1], [0.13, 2]]) {
    parts.push(P(sph(r, 9, 6), grad(i % 2 ? '#D98A3E' : '#E8A24E', i % 2 ? '#F2B860' : '#F6C77A', -r, r), [0.06 * i * i - 0.1, 1.4 + r * 0.72, -0.1 + i * 0.27], null, [1, 0.8, 1.15]));
  }
  return parts;
};

B['boss-pizza'] = () => {
  // DECISION: giant whole pizza on a round wooden serving board on a short pedestal: cheese with a sauce ring,
  // puffy toasted crust, pepperoni, olive rings, basil, cheese bubbles and eight cut lines.
  const Y = 0.41;
  const parts = [
    P(cyl(0.42, 0.62, 0.32, 12), '#B07338', [0, 0.16, 0]),
    P(cyl(1.7, 1.7, 0.09, 24), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#A8743E'), [0, Y - 0.045, 0]),
    P(lathe([[1.45, 0], [1.45, 0.05], [1.3, 0.06], [1.15, 0.065], [0, 0.07]], 24), (x, y, z, t) => { const r = Math.hypot(x, z); return r > 1.42 ? '#E8A24E' : r > 1.15 ? '#D8452F' : hsh(t) > 0.85 ? '#FFE58A' : '#FFD45A'; }, [0, Y, 0]),
    P(flat(tor(1.45, 0.12, 6, 28)), ngrad('#E8A24E', '#F2BE6A', '#D98A3E'), [0, Y + 0.07, 0]),
  ];
  for (let k = 0; k < 4; k++) parts.push(P(box(2.3, 0.006, 0.025), '#E0A83A', [0, Y + 0.072, 0], [0, k * PI / 4, 0]));
  for (let i = 0; i < 11; i++) {
    const r = 1.05 * Math.sqrt((i + 0.5) / 11), a = i * 2.4;
    parts.push(P(cyl(0.15, 0.15, 0.03, 10), (x, y, z, t) => (hsh(t + i) > 0.8 ? '#A82A22' : '#C8372D'), [Math.cos(a) * r, Y + 0.085, Math.sin(a) * r]));
  }
  for (let i = 0; i < 6; i++) {
    const r = 0.95 * Math.sqrt((i + 0.5) / 6), a = i * 2.4 + 1.2;
    parts.push(P(flat(tor(0.05, 0.02, 3, 7)), '#2E2A33', [Math.cos(a) * r, Y + 0.08, Math.sin(a) * r]));
  }
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.5; parts.push(leaf(0.07, [Math.cos(a) * 0.55, Y + 0.09, Math.sin(a) * 0.55], [0, a, 0], '#3FA34D')); }
  for (let i = 0; i < 5; i++) { const a = i * 1.9 + 2.2, r = 0.3 + 0.15 * i; parts.push(P(sph(0.09, 6, 3), '#FFE58A', [Math.cos(a) * r, Y + 0.07, Math.sin(a) * r], null, [1, 0.35, 1])); }
  return parts;
};

const M_wheelPts = (r, h) => [[0, 0], [r * 0.92, 0], [r, h * 0.18], [r * 1.03, h * 0.5], [r, h * 0.82], [r * 0.92, h], [0, h]];
B['boss-cheesetower'] = () => {
  // DECISION: three stacked cheese wheels plus a top wheel on a round wooden board, each smaller and turned; the top
  // wheel has a wedge cut toward the front (pale paste with holes on the cut faces), the cut slice lies on the board;
  // a blank red flag pick (no text); grapes at the foot.
  const parts = [P(cyl(2.0, 2.0, 0.12, 24), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#A8743E'), [0, 0.06, 0])];
  const W = [[1.55, 0.48, '#F5A623', '#FFC94A'], [1.3, 0.44, '#FFCF3D', '#FFE07A'], [1.05, 0.4, '#FFB938', '#FFD86A']];
  let y = 0.12;
  W.forEach(([r, h, rind, top], i) => {
    parts.push(P(lathe(M_wheelPts(r, h), 20), (x, py, z, t, nx, ny) => (ny > 0.6 ? top : rind), [0, y, 0], [0, i * 0.4, 0]));
    const rn = i < 2 ? W[i + 1][0] : 0.85;
    for (let k = 0; k < 3; k++) {
      const a = i * 1.1 + k * 2.1 + 0.4, rr = (r + rn) / 2;
      parts.push(P(cyl(0.065, 0.065, 0.012, 7), mixC(top, '#C07A10', 0.3), [Math.cos(a) * rr, y + h + 0.002, Math.sin(a) * rr]));
    }
    for (let k = 0; k < 4; k++) {
      const a = i * 0.7 + k * TAU / 4 + 0.3;
      parts.push(P(sph(0.075, 6, 4), mixC(rind, '#A86A10', 0.3), [Math.cos(a) * r * 1.01, y + h * (0.35 + 0.3 * (k % 2)), Math.sin(a) * r * 1.01], [0, PI / 2 - a, 0], [1, 1, 0.35]));
    }
    y += h;
  });
  // top wheel with the wedge cut out (missing wedge around local -x, turned toward the front)
  const rT = 0.85, hT = 0.38, half = PI * 0.8, psi = PI / 2 + 0.3, paste = '#FFE9A0', hole = '#E8B84A';
  const cheese = (x, py, z, t, nx, ny, nzz) => {
    if (Math.abs(ny) > 0.5) return '#FFE07A';
    const rr = Math.hypot(x, z) || 1;
    return (nx * x + nzz * z) / rr > 0.5 ? '#F2B83A' : paste;
  };
  const topW = [P(slab(sectorShape(rT, half), hT, 0, 18), cheese)];
  for (const th of [half, -half]) {
    const n = th > 0 ? [-Math.sin(th), 0, -Math.cos(th)] : [Math.sin(th), 0, Math.cos(th)], phi = Math.atan2(n[0], n[2]);
    for (const [rho, yy] of [[0.3, 0.12], [0.58, 0.25], [0.62, 0.09]]) {
      parts.push(...xf([P(cyl(0.055, 0.055, 0.012, 7), hole, [rho * Math.cos(th) + n[0] * 0.004, yy, -rho * Math.sin(th) + n[2] * 0.004], [PI / 2, phi, 0])], [0, psi, 0], [0, y, 0]));
    }
  }
  parts.push(...xf(topW, [0, psi, 0], [0, y, 0]));
  // the cut slice lying on the board ring, front-left
  parts.push(P(slab(sectorShape(0.42, PI * 0.2), 0.19, 0, 4), cheese, [-1.15, 0.12, 1.25], [0, -2.2, 0]));
  // blank flag pick
  const fx = -0.3, fz = -0.25, ft = y + hT + 0.5;
  parts.push(P(cyl(0.018, 0.018, 0.5, 4), '#FFF1DC', [fx, y + hT + 0.25, fz]));
  parts.push(P(slab(polyShape([[0, 0], [0.28, 0.08], [0, 0.16]]), 0.012), '#E8463A', [fx + 0.018, ft - 0.17, fz], [PI / 2, 0, 0]));
  // grapes at the foot
  const G = [1.78 * Math.cos(0.7), 0.12, 1.78 * Math.sin(0.7)];
  [[0, 0, 0], [0.15, 0, 0.05], [-0.12, 0, 0.08], [0.03, 0, -0.13], [0.07, 0.13, 0], [-0.06, 0.13, -0.03], [0, 0.24, 0]].forEach(([dx, dy, dz], k) => {
    parts.push(P(sph(0.085, 6, 3), grad('#6E3A82', '#A35DB5', -0.085, 0.085), [G[0] + dx, G[1] + 0.08 + dy, G[2] + dz]));
  });
  parts.push(P(cyl(0.012, 0.012, 0.14, 4), '#6B4A2B', [G[0], G[1] + 0.4, G[2]], [0.4, 0, 0]));
  return parts;
};

B['boss-pizzaoven'] = () => {
  // DECISION: wood-fired toy pizza oven, mouth toward +z: brick counter with a stone top, brick dome with a pale
  // arch portal and a dark mouth with a warm ember glow at its floor (NO flames), a short chimney, a peel with a
  // pizza on the counter, a pizza on a stand, logs stacked on the left.
  const parts = [
    P(box(4.0, 1.1, 2.9, 9, 3, 6), M_brick, [0, 0.55, 0]),
    P(rbox(4.2, 0.14, 3.1, 0.05, 1), '#E8DCC8', [0, 1.17, 0]),
  ];
  const Y = 1.24, cx = -0.4, cz = -0.3, R = 1.3;
  parts.push(P(new T.SphereGeometry(R, 16, 7, 0, TAU, 0, PI / 2), M_brick, [cx, Y, cz]));
  parts.push(P(flat(tor(R, 0.07, 3, 16)), '#FFF1DC', [cx, Y + 0.03, cz]));
  const zf = cz + 0.52, zm = zf + 0.9;
  parts.push(P(slab(M_arch(1.25, 1.05), 0.9, 0, 8), '#D9825A', [cx, Y, zf], [PI / 2, 0, 0]));
  parts.push(P(slab(M_arch(0.85, 0.75), 0.02, 0, 8), '#24160F', [cx, Y + 0.02, zm], [PI / 2, 0, 0]));
  parts.push(P(slab(M_arch(0.72, 0.42), 0.02, 0, 8), { v: (x, y, z) => mixC('#FFB347', '#3A1A10', sat(-z / 0.42)) }, [cx, Y + 0.02, zm + 0.012], [PI / 2, 0, 0]));
  for (const dx of [-0.16, 0, 0.16]) parts.push(P(sph(0.07, 6, 3), '#FF7A2F', [cx + dx, Y + 0.05, zm + 0.02], null, [1, 0.6, 1]));
  // chimney back-left on the dome
  const chx = cx - 0.55, chz = cz - 0.55;
  parts.push(P(cyl(0.2, 0.24, 0.55, 8), M_brick, [chx, Y + 0.95 + 0.275, chz]));
  parts.push(P(cyl(0.28, 0.28, 0.07, 8), '#4A4F63', [chx, Y + 1.535, chz]));
  // peel with a pizza on the counter, right; a pizza on a stand, front-left
  parts.push(P(slab(rrShape(0.75, 0.7, 0.25), 0.03), '#D9A066', [1.3, Y, 0.35]));
  parts.push(P(cyl(0.035, 0.035, 1.25, 6), '#B07338', [1.675 + 0.62, Y + 0.035, 0.35], [0, 0, PI / 2]));
  parts.push(...M_pizza(0.3, [1.3, Y + 0.03, 0.35], 4, 0.3));
  parts.push(P(cyl(0.06, 0.1, 0.2, 8), '#E8DCC8', [-1.5, Y + 0.1, 0.85]));
  parts.push(P(cyl(0.38, 0.38, 0.03, 14), '#FFFFFF', [-1.5, Y + 0.215, 0.85]));
  parts.push(...M_pizza(0.32, [-1.5, Y + 0.23, 0.85], 5, 1.1));
  // logs stacked on the ground, left
  const log = (x, y, z, t, nx, ny) => (Math.abs(ny) > 0.9 ? '#E8C08A' : '#8A5A32');
  [[-2.25, 0.12], [-2.49, 0.12], [-2.73, 0.12], [-2.37, 0.33], [-2.61, 0.33], [-2.49, 0.54]].forEach(([x, yy]) => parts.push(P(cyl(0.12, 0.12, 0.9, 7), log, [x, yy, 0.1], [PI / 2, 0, 0])));
  return parts;
};

// ---------------------------------------------------------------- builders: Harbour (T0-T4 + bosses)
// ---------------------------------------------------------------- builders: Harbour (Wednesday, Art)
// Toy harbour: teal water, red-and-white stripes, cream rope, gold fittings; food is glossy painted toys.
const H_UP = new T.Vector3(0, 1, 0);
/** Bar from point a to point b: square box w thick, or a seg-sided cylinder of diameter w. */
function H_beam(a, b, w, hex, seg = 0, wz = 0) {
  const D = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = D.length();
  const g = seg ? cyl(w / 2, w / 2, len, seg) : box(w, len, wz || w);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(H_UP, D.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return P(g, hex);
}
/** Reverse a finished part's winding and normals so it shows from the inside (hull interiors, sling backs). */
function H_flip(g) {
  for (const k of ['position', 'normal', 'color']) {
    const a = g.attributes[k].array;
    for (let i = 0; i < a.length; i += 9) for (let j = 0; j < 3; j++) { const t = a[i + 3 + j]; a[i + 3 + j] = a[i + 6 + j]; a[i + 6 + j] = t; }
  }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}
/** Twisted-rope colour for a flat torus around the y axis (ring radius R, centre height y0). */
const H_ropeCol = (R, y0 = 0, k = 9, a = '#F6ECD6', b = '#D2BC8E') => (x, y, z) => {
  const s = Math.floor((az(x, z) * k + Math.atan2(y - y0, Math.hypot(x, z) - R)) / (PI / 2));
  return ((s % 2) + 2) % 2 ? b : a;
};
/** Twisted-rope colour for a TubeGeometry with rs radial segments (by triangle index). */
const H_tubeRope = (rs, a = '#F6ECD6', b = '#D2BC8E') => (x, y, z, t) => ((Math.floor(t / (2 * rs)) + Math.floor((t % (2 * rs)) / 2)) % 2 ? b : a);
const H_oct = (r, hex, pos, scl) => P(new T.OctahedronGeometry(r), hex, pos, null, scl);
const H_RED = '#E04F4F', H_WHITE = '#FFF6E3', H_TEAL = '#2AA7C9', H_NAVY = '#2D3E63';
const H_gold = (r) => grad('#D9962E', '#FFE07A', -r, r);
/** Round painted window facing outward at azimuth phi (atan2 z, x) on a round wall. */
const H_round = (r, R, y, phi, frame = H_WHITE) => {
  const psi = PI / 2 - phi, x = Math.cos(phi) * R, z = Math.sin(phi) * R;
  return [
    P(cyl(r * 1.25, r * 1.25, 0.04, 10), frame, [x, y, z], [PI / 2, psi, 0]),
    P(cyl(r, r, 0.06, 10), WIN, [Math.cos(phi) * (R + 0.012), y, Math.sin(phi) * (R + 0.012)], [PI / 2, psi, 0]),
  ];
};
/** Rowboat-style hull: lower half sphere, bow pinched toward +ax ('x' or 'z'), flat keel and transom. */
function H_hull(ws, ax, s, col, flip) {
  const g = warp(new T.SphereGeometry(1, ws, ax === 'z' ? 6 : 5, 0, TAU, PI / 2, PI / 2), (v) => {
    const L = ax === 'z' ? v.z : v.x;
    if (L > 0) { if (ax === 'z') v.x *= 1 - 0.62 * L * L; else v.z *= 1 - 0.55 * L * L; }
    if (ax === 'z') v.z = Math.max(v.z, -0.86); else v.x = Math.max(v.x, -0.88);
    v.y = Math.max(v.y, -0.86);
  });
  const q = P(g, col, null, null, s);
  return flip ? H_flip(q) : q;
}
/** Closed rim curve of an H_hull (same pinch/transom), scaled like the hull. */
function H_rimCurve(ax, s, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = i * TAU / n;
    let x = Math.cos(th), z = Math.sin(th);
    const L = ax === 'z' ? z : x;
    if (L > 0) { if (ax === 'z') x *= 1 - 0.62 * L * L; else z *= 1 - 0.55 * L * L; }
    if (ax === 'z') z = Math.max(z, -0.86); else x = Math.max(x, -0.88);
    pts.push(V3(x * s[0], 0, z * s[2]));
  }
  return new T.CatmullRomCurve3(pts, true);
}
// hull paint: teal topsides, cream stripe, red bottom (rows of the 6-row unit hemisphere)
const H_hullPaint = (top = H_TEAL, stripe = H_WHITE, bottom = H_RED) => (x, y) => (y > -0.25 ? top : y > -0.5 ? stripe : y > -0.72 ? top : bottom);

// ---- Harbour T0 sweets
B.kernel = () => {
  const c = grad('#F0D98E', '#FFFDF2', -0.045, 0.045);
  return [
    P(sph(0.045, 6, 5), c, [0, 0.042, 0], null, [1, 0.9, 1]),
    P(sph(0.034, 6, 5), c, [0.038, 0.034, 0.012]),
    P(sph(0.032, 6, 5), c, [-0.02, 0.03, 0.036]),
    P(ico(0.017, 0), '#E8A93C', [-0.012, 0.012, -0.036], null, [1, 0.7, 1.2]),
    HL(0.012, [-0.012, 0.078, 0.012]),
  ];
};
// (11-04, orchestrator) was a plain pink drop: now a gummy bear lying on its back, so the top-down camera sees the
// bear silhouette (head + ears, paws, feet); same footprint radius as the drop.
B.gummy = () => {
  const c = grad('#D93A50', '#FF8A98', 0, 0.06);
  return [
    P(sph(0.042, 6, 4), c, [0, 0.03, 0.012], null, [1, 0.7, 1.25]),
    P(sph(0.031, 6, 4), c, [0, 0.032, -0.044], null, [1, 0.8, 1]),
    ...[-1, 1].flatMap((s) => [
      P(sph(0.013, 4, 3), c, [s * 0.025, 0.04, -0.066]),
      P(sph(0.016, 4, 3), c, [s * 0.043, 0.024, -0.006], null, [1.3, 0.8, 1]),
      P(sph(0.019, 4, 3), c, [s * 0.03, 0.02, 0.056], null, [1, 0.8, 1.1]),
    ]),
    H_oct(0.007, '#FFFFFF', [0.016, 0.052, 0.02]),
    HL(0.012, [-0.012, 0.055, 0.0]),
  ];
};
B.mint = () => {
  const sw = (x, y, z) => ((Math.floor((az(x, z) + Math.hypot(x, z) * 38) / (TAU / 12)) % 2) ? '#FFFFFF' : '#3FC496');
  return [
    P(flat(new T.RingGeometry(0.004, 0.064, 12, 3)), sw, [0, 0.05, 0]),
    P(flat(tor(0.064, 0.02, 3, 12)), sw, [0, 0.026, 0], null, [1, 1.25, 1]),
    P(new T.CircleGeometry(0.064, 12).rotateX(PI / 2), '#DDF5EC', [0, 0.0, 0]),
    HL(0.01, [-0.025, 0.054, 0.02]),
  ];
};

// ---- Harbour T1 snacks
B.lollipop = () => {
  // DECISION: upright lollipop on a little sugar foot (matches the icon); real proportions give h ≈ 0.4 vs catalog 0.3.
  const R = 0.12, Y = 0.21;
  const sw = (x, y) => ((Math.floor((Math.atan2(y, x) + PI + Math.hypot(x, y) * 26) / (TAU / 8)) % 2) ? '#FFFFFF' : '#FF4F93');
  return [
    P(new T.RingGeometry(0.004, R, 14, 3), sw, [0, Y, 0.02]),
    P(new T.CircleGeometry(R, 14).rotateY(PI), '#FF6FB5', [0, Y, -0.02]),
    P(cyl(R, R, 0.04, 14, 1, true), (x, y, z, t) => (Math.floor(t / 2) % 2 ? '#FFFFFF' : '#FF4F93'), [0, Y, 0], [PI / 2, 0, 0]),
    P(cyl(0.011, 0.011, 0.19, 6), '#FFFFFF', [0, 0.11, 0]),
    P(cyl(0.05, 0.058, 0.024, 6), '#FF6FB5', [0, 0.012, 0]),
    HL(0.014, [-0.05, Y + 0.05, 0.026]),
  ];
};
B.icecream = () => {
  // DECISION: cone (matches the icon: cream scoop under a strawberry scoop) with a 0.3 rad toy lean. (11-04
  // review) upright, the cream scoop (r 0.1) hid the whole cone from the 55° camera and it read as a pink-on-white
  // blob; now the scoop is narrower than the cone rim, the cone a bit longer, and the lean shows the waffle cone
  // from any yaw. h ≈ 0.5 vs catalog 0.3 (Sim never reads ih; Levels may raise catalog h).
  const cone = (x, y, z) => ((Math.floor(az(x, z) / (TAU / 8)) + Math.floor((y + 0.095) / 0.095)) % 2 ? '#E8A24E' : '#F5C277');
  const parts = [
    P(cyl(0.092, 0.012, 0.19, 8, 2, true), cone, [0, 0.095, 0]),
    P(cyl(0.094, 0.094, 0.018, 8, 1, true), '#E0954A', [0, 0.19, 0]),
    P(sph(0.084, 8, 5), grad('#F5CFC0', '#FFF3EA', -0.084, 0.084), [0, 0.225, 0], null, [1, 0.85, 1]),
    P(sph(0.064, 7, 5), grad('#D93A50', '#FF7A88', -0.064, 0.064), [0.004, 0.292, 0], null, [1, 0.85, 1]),
    HL(0.014, [-0.026, 0.325, 0.03]),
  ];
  return xf(parts, [-0.3, 0, 0]);
};
B.hotdog = () => {
  const m = [];
  for (let i = 0; i <= 8; i++) m.push(V3(-0.13 + i * 0.0325, 0.1, i % 2 ? 0.017 : -0.017));
  return [
    P(sph(0.08, 8, 5), grad('#C9782E', '#F5C277', -0.08, 0.08), [0, 0.04, 0], null, [2.2, 0.62, 1.2]),
    P(sph(0.034, 8, 5), grad('#A8332B', '#E0574A', -0.034, 0.034), [0, 0.068, 0], null, [4.5, 1, 1]),
    P(new T.TubeGeometry(new T.CatmullRomCurve3(m), 10, 0.0075, 3, false), '#FFD23F'),
  ];
};
B.taco = () => {
  const R = 0.11, s = new T.Shape();
  s.moveTo(-R, 0); s.absarc(0, 0, R, PI, TAU, false); s.lineTo(-R, 0);
  const half = () => new T.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false, curveSegments: 4 }).translate(0, R, -0.007);
  const shell = grad('#E8A93C', '#FFD45A', 0, R);
  return [
    P(half(), shell, [0, 0, 0.03], [0.24, 0, 0], [1, 0.78, 1]),
    P(half(), shell, [0, 0, -0.03], [-0.24, 0, 0], [1, 0.78, 1]),
    P(sph(0.05, 6, 4), '#8A4B2A', [0, 0.068, 0], null, [1.7, 0.55, 0.7]),
    P(ico(0.045, 0), '#5FB54A', [-0.05, 0.082, 0], null, [1.5, 0.5, 1]),
    P(ico(0.045, 0), '#7ACB62', [0.05, 0.084, 0.004], null, [1.5, 0.5, 1]),
    H_oct(0.014, '#E8463A', [-0.02, 0.092, 0.012]), H_oct(0.014, '#E8463A', [0.04, 0.094, -0.01]),
    H_oct(0.012, '#FFE26A', [0.0, 0.096, 0.0]), H_oct(0.012, '#FFE26A', [-0.065, 0.09, 0.006]),
  ];
};
B.fries = () => {
  const W = 0.2, D = 0.13, Hc = 0.1;
  // carton: 6 red/white columns on the front and back faces (box triangle order: px nx py ny pz nz)
  const g = P(box(W, Hc, D, 6, 1, 1), (x, y, z, t) => {
    if (t < 4) return H_RED;
    if (t < 28) return '#7A2A22';
    return Math.floor((t - 28) % 12 / 2) % 2 ? '#FFFFFF' : H_RED;
  }, [0, Hc / 2, 0]);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) { const k = 0.8 + 0.2 * p[i + 1] / Hc; p[i] *= k; p[i + 2] *= k; }
  const parts = [g], fry = grad('#E8A62A', '#FFE07A', -0.055, 0.055);
  for (let i = 0; i < 10; i++) {
    const x = -0.068 + (i % 5) * 0.034, z = i < 5 ? -0.024 : 0.024;
    parts.push(P(box(0.024, 0.085, 0.024), fry, [x, 0.1 + 0.02 * hsh(i), z], [0.14 * (hsh(i + 3) - 0.5) * 2, 0, 0.16 * (hsh(i + 9) - 0.5) * 2]));
  }
  return parts;
};
B.waffle = () => {
  const S = 0.3, col = grad('#D98E3C', '#F2B866', -0.011, 0.011);
  const parts = [P(box(S, 0.03, S), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#B86E28' : '#D98E3C'), [0, 0.015, 0])];
  [-0.1375, -0.07, 0, 0.07, 0.1375].forEach((o, i) => {
    const w = i === 0 || i === 4 ? 0.025 : 0.02;
    parts.push(P(box(w, 0.022, S), col, [o, 0.041, 0]));
    parts.push(P(box(S, 0.022, w), col, [0, 0.041, o]));
  });
  parts.push(P(box(0.07, 0.028, 0.07), '#FFF1A8', [0.03, 0.066, -0.02], [0, 0.35, 0]));
  parts.push(P(sph(0.07, 8, 3), '#C8702A', [-0.035, 0.053, 0.035], null, [1, 0.14, 0.9]));
  parts.push(HL(0.012, [0.015, 0.081, -0.025]));
  return parts;
};
B.burger = () => [
  P(cyl(0.105, 0.098, 0.04, 8), grad('#C9782E', '#E8A24E', -0.02, 0.02), [0, 0.02, 0]),
  P(cyl(0.112, 0.112, 0.036, 8), grad('#5A2E1A', '#7A4426', -0.018, 0.018), [0, 0.058, 0]),
  P(box(0.19, 0.008, 0.19), '#FFC93C', [0, 0.08, 0], [0, PI / 4, 0]),
  P(warp(flat(new T.CircleGeometry(0.125, 12)), (v) => { if (Math.hypot(v.x, v.z) > 0.1) v.y += 0.006 * Math.sin(Math.atan2(v.z, v.x) * 7); }), '#5FB54A', [0, 0.086, 0]),
  P(flat(new T.CircleGeometry(0.1, 10)), '#E8463A', [0, 0.091, 0]),
  P(new T.SphereGeometry(0.112, 8, 4, 0, TAU, 0, PI / 2), grad('#C9782E', '#F5C277', 0, 0.112), [0, 0.093, 0], null, [1, 0.55, 1]),
  H_oct(0.009, '#FFF6E3', [0.04, 0.15, 0], [1, 0.6, 1.6]), H_oct(0.009, '#FFF6E3', [-0.03, 0.148, 0.045], [1.6, 0.6, 1]),
  H_oct(0.009, '#FFF6E3', [-0.01, 0.149, -0.05], [1.4, 0.6, 1]),
  HL(0.014, [-0.04, 0.147, 0.03]),
];

// ---- Harbour T2
B.cottoncandy = () => {
  const fluff = (r, ws, hs, seed) => warp(sph(r, ws, hs), (v) => v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 41 + seed) * Math.sin(v.y * 37 + seed * 2) * Math.sin(v.z * 43 + seed)));
  const pink = grad('#FF8CC6', '#FFD9EE', -0.13, 0.13);
  return [
    P(fluff(0.13, 10, 7, 1), pink, [0, 0.27, 0], null, [1.2, 1, 1.2]),
    P(fluff(0.08, 7, 5, 2), pink, [0.12, 0.26, 0.05]),
    P(fluff(0.08, 7, 5, 3), pink, [-0.1, 0.29, 0.07]),
    P(fluff(0.08, 7, 5, 4), pink, [-0.02, 0.335, -0.06]),
    P(cyl(0.032, 0.008, 0.16, 8), (x, y) => (Math.floor((y + 0.08) / 0.04) % 2 ? '#FFFFFF' : '#FFE3F0'), [0, 0.1, 0]),
    P(cyl(0.04, 0.045, 0.02, 8), '#FFFFFF', [0, 0.01, 0]),
  ];
};
B.coconut = () => {
  // DECISION: whole round coconut with a sliced top showing white flesh (icon), so it rolls cleanly about its
  // centre; fibrous per-triangle browns, no pores. Round gives h ≈ 1.9 a = 0.53 vs catalog 0.3.
  const R = 0.14, th = 0.6, yc = R * Math.cos(th), rc = R * Math.sin(th);
  return [
    P(new T.SphereGeometry(R, 14, 9, 0, TAU, th, PI - th), (x, y, z, t) => mixC('#5A3820', '#93623C', hsh(t * 1.7) * 0.8 + (y + R) / (4 * R)), [0, R, 0]),
    P(flat(new T.RingGeometry(rc * 0.55, rc, 14, 1)), '#FFFDF6', [0, R + yc, 0]),
    P(flat(new T.CircleGeometry(rc * 0.56, 14)), '#EDE5D6', [0, R + yc - 0.008, 0]),
    P(flat(tor(rc, 0.011, 3, 14)), '#4A2C18', [0, R + yc, 0]),
    HL(0.02, [-0.07, R + 0.09, 0.09]),
  ];
};
B.popcorn = () => {
  const parts = [
    P(cyl(0.19, 0.15, 0.16, 16, 1, true), (x, y, z) => (Math.floor(az(x, z) / (TAU / 16)) % 2 ? '#FFFFFF' : H_RED), [0, 0.08, 0]),
    P(new T.CircleGeometry(0.15, 16).rotateX(PI / 2), '#C8403F', [0, 0.001, 0]),
    P(cyl(0.198, 0.198, 0.026, 16, 1, true), '#FFFFFF', [0, 0.152, 0]),
    P(flat(new T.CircleGeometry(0.185, 10)), '#FFE9A8', [0, 0.15, 0]),
  ];
  const C = ['#FFF4C2', '#FFFFFF', '#FFE08A', '#FFF8DC'];
  parts.push(P(ico(0.056, 0), C[0], [0, 0.24, 0]));
  for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.3; parts.push(P(ico(0.05, 0), C[(i + 1) % 4], [Math.cos(a) * 0.085, 0.215, Math.sin(a) * 0.085])); }
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; parts.push(P(ico(0.047, 0), C[(i + 2) % 4], [Math.cos(a) * 0.15, 0.178, Math.sin(a) * 0.15])); }
  return parts;
};
B.wafflestack = () => {
  // DECISION: fragile china cake stand (teal rim) with five slightly skewed square waffles; contents sit on the
  // top waffle (parts.top / parts.slots).
  const parts = [P(lathe([[0, 0], [0.17, 0], [0.05, 0.05], [0.045, 0.25], [0.36, 0.272], [0.44, 0.312], [0.425, 0.324], [0.3, 0.29], [0, 0.29]], 10),
    (x, y) => (y > 0.3 ? H_TEAL : y > 0.06 && y < 0.24 ? '#E8F1F4' : H_WHITE))];
  const y0 = 0.29, wh = 0.044;
  const chk = (x, y, z) => ((Math.floor((x + 0.145) / 0.0725) + Math.floor((z + 0.145) / 0.0725)) % 2 ? '#C97C2C' : '#F0B45E');
  for (let i = 0; i < 5; i++) {
    const r = (hsh(i) - 0.5) * 0.5, ox = (hsh(i + 7) - 0.5) * 0.03, oz = (hsh(i + 13) - 0.5) * 0.03;
    parts.push(P(box(0.3, wh - 0.002, 0.3), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#E8A24E' : '#D08636'), [ox, y0 + wh * i + wh / 2, oz], [0, r, 0]));
    parts.push(P(flat(new T.PlaneGeometry(0.29, 0.29, 4, 4)), chk, [ox, y0 + wh * (i + 1) + 0.0005, oz], [0, r, 0]));
  }
  parts.top = y0 + wh * 5;
  parts.slots = [[-0.075, -0.05], [0.08, -0.04], [0, 0.085]];
  return parts;
};
B.buoy = () => {
  const parts = [P(lathe([[0, 0], [0.2, 0], [0.29, 0.05], [0.315, 0.1], [0.32, 0.16], [0.29, 0.21], [0.18, 0.25], [0, 0.26]], 14),
    grad('#E8B52E', '#FFD84A', 0, 0.26))];
  // red band as its own ring so its edges stay crisp
  parts.push(P(lathe([[0.318, 0.1], [0.323, 0.16]], 14), H_RED));
  parts.push(P(lathe([[0.323, 0.16], [0.318, 0.1]], 14), H_RED));
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + 0.5;
    parts.push(H_beam([Math.cos(a) * 0.13, 0.24, Math.sin(a) * 0.13], [Math.cos(a) * 0.06, 0.42, Math.sin(a) * 0.06], 0.024, H_NAVY, 4));
  }
  parts.push(P(flat(tor(0.065, 0.013, 3, 8)), H_NAVY, [0, 0.415, 0]));
  parts.push(P(sph(0.045, 6, 3), '#FF7A6E', [0, 0.45, 0]));
  parts.push(P(cyl(0.03, 0.045, 0.02, 6), H_NAVY, [0, 0.49, 0]));
  return parts;
};
B.ropecoil = () => {
  const tail = new T.CatmullRomCurve3([V3(0.185, 0.13, 0), V3(0.26, 0.14, 0.05), V3(0.3, 0.07, 0.12), V3(0.3, 0.03, 0.17)]);
  return [
    P(flat(tor(0.25, 0.045, 5, 16)), H_ropeCol(0.25), [0, 0.045, 0]),
    P(flat(tor(0.185, 0.043, 5, 16)), H_ropeCol(0.185), [0, 0.125, 0]),
    P(new T.TubeGeometry(tail, 8, 0.04, 4, false), H_tubeRope(4)),
  ];
};
B.lifering = () => [
  P(flat(tor(0.34, 0.1, 6, 24)), (x, y, z) => (Math.floor(az(x, z) / (TAU / 8)) % 2 ? '#FFFFFF' : H_RED), [0, 0.1, 0], null, [1, 0.62, 1]),
  P(flat(tor(0.44, 0.013, 3, 16)), H_ropeCol(0.44, 0, 12), [0, 0.1, 0], null, [1, 0.62, 1]),
];
B.ropepost = () => {
  // DECISION: each rope half ends level at x = ±a at the low point of its sag, so posts placed 2a apart along a
  // wall line join into one continuous sagging rope.
  const parts = [
    P(cyl(0.15, 0.17, 0.06, 10), H_NAVY, [0, 0.03, 0]),
    P(cyl(0.055, 0.065, 0.56, 8), grad('#8A5A35', '#B07A45', -0.28, 0.28), [0, 0.34, 0]),
    P(sph(0.075, 8, 6), H_gold(0.075), [0, 0.66, 0]),
    P(flat(tor(0.062, 0.016, 3, 8)), '#FFCF3D', [0, 0.5, 0]),
    HL(0.018, [-0.025, 0.71, 0.03]),
  ];
  [-1, 1].forEach((s) => {
    const c = new T.QuadraticBezierCurve3(V3(0, 0.52, 0), V3(s * 0.28, 0.31, 0), V3(s * 0.47, 0.31, 0));
    parts.push(P(new T.TubeGeometry(c, 10, 0.022, 4, false), H_tubeRope(4)));
  });
  return parts;
};

// ---- Harbour T3
B.anchor = () => {
  // DECISION: standing toy anchor wrapped in rope, its foot in a rope coil (the coil sets the footprint, so the
  // anchor keeps a readable upright height ≈ 0.8 vs catalog 0.7).
  const navy = grad('#2A3146', '#56607C', -0.35, 0.35);
  const parts = [
    P(tor(0.3, 0.05, 5, 14, PI), navy, [0, 0.36, 0], [0, 0, PI]),
    P(sph(0.07, 6, 5), navy, [0, 0.06, 0]),
    P(cyl(0.05, 0.05, 0.49, 8), navy, [0, 0.305, 0]),
    P(cyl(0.035, 0.035, 0.46, 8), navy, [0, 0.46, 0], [0, 0, PI / 2]),
    P(sph(0.05, 6, 4), H_gold(0.05), [0.23, 0.46, 0]), P(sph(0.05, 6, 4), H_gold(0.05), [-0.23, 0.46, 0]),
    P(tor(0.085, 0.025, 5, 12), H_gold(0.1), [0, 0.62, 0]),
    P(flat(tor(0.5, 0.045, 4, 16)), H_ropeCol(0.5), [0, 0.045, 0]),
  ];
  const fl = new T.Shape(); fl.moveTo(-0.07, 0); fl.lineTo(0.07, 0); fl.lineTo(0, 0.13); fl.closePath();
  [-1, 1].forEach((s) => parts.push(P(new T.ExtrudeGeometry(fl, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03), navy, [s * 0.3, 0.33, 0], [0, 0, -s * 0.35])));
  const hel = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20, a = t * 3.5 * TAU; hel.push(V3(Math.cos(a) * 0.068, 0.1 + 0.36 * t, Math.sin(a) * 0.068)); }
  parts.push(P(new T.TubeGeometry(new T.CatmullRomCurve3(hel), 20, 0.02, 4, false), H_tubeRope(4)));
  return parts;
};
B.deckchair = () => {
  const wood = '#E8C48A', parts = [];
  const rail = (s) => [0.02 + 0.6 * s, 0.45 - 0.95 * s];
  [-0.27, 0.27].forEach((x) => {
    const A = rail(0), Bp = rail(1), K = rail(0.8);
    parts.push(H_beam([x, A[0], A[1]], [x, Bp[0], Bp[1]], 0.045, wood));
    parts.push(H_beam([x, 0, K[1] - 0.01], [x, K[0], K[1]], 0.045, wood));
  });
  const bar = (y, z, hex = wood) => H_beam([-0.3, y, z], [0.3, y, z], 0.04, hex, 6);
  parts.push(bar(0.62, -0.5), bar(0.2, 0.165), bar(0.03, -0.32), bar(0.5, -0.31));
  // sagging striped canvas sling from the top bar to the front bar (both faces)
  const sling = (back) => {
    const g = new T.PlaneGeometry(0.5, 1, 6, 10), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = 0.5 - p.getY(i), u = 1 - t;
      p.setXYZ(i, p.getX(i), u * u * 0.6 + 2 * u * t * 0.06 + t * t * 0.215, u * u * -0.49 + 2 * u * t * -0.15 + t * t * 0.165);
    }
    g.computeVertexNormals();
    const q = P(g, (x) => (Math.floor((x + 0.25) / (0.5 / 6)) % 2 ? '#FFFFFF' : H_TEAL));
    return back ? H_flip(q) : q;
  };
  parts.push(sling(false), sling(true));
  parts.push(P(cyl(0.045, 0.045, 0.46, 8), (x, y) => (Math.floor((y + 0.23) / 0.0767) % 2 ? '#FFFFFF' : H_RED), [0, 0.64, -0.47], [0, 0, PI / 2]));
  return parts;
};
S.sunshade = () => {
  const panel = (x, z) => Math.floor(az(x, z) / (TAU / 8)) % 2;
  const blade = [P(lathe([[0.04, 1.62], [0.5, 1.53], [0.84, 1.4], [0.95, 1.37], [0.92, 1.42], [0.62, 1.57], [0.3, 1.7], [0, 1.77]], 16),
    (x, y, z, t, nx, ny) => { const s = panel(x, z); return ny < 0 ? (s ? '#D9E4EA' : '#1E86A3') : (s ? '#FFFFFF' : H_TEAL); })];
  for (let k = 0; k < 8; k++) {
    const phi = (k + 0.5) * TAU / 8 - PI;
    const g = new T.CylinderGeometry(0.33, 0.33, 0.02, 4, 1, false, PI / 2, PI);
    blade.push(P(g, k % 2 ? '#FFFFFF' : H_TEAL, [Math.cos(phi) * 0.93, 1.385, Math.sin(phi) * 0.93], [-PI / 2, -phi - PI / 2, 0], [1, 1, 0.45]));
  }
  blade.push(P(ico(0.05, 0), H_TEAL, [0, 1.8, 0]));
  const base = [
    P(cyl(0.028, 0.028, 1.66, 6), '#F4F4F4', [0, 0.87, 0]),
    P(cyl(0.2, 0.24, 0.08, 12), H_NAVY, [0, 0.04, 0]),
    P(cyl(0.09, 0.11, 0.06, 8), '#3E527D', [0, 0.11, 0]),
  ];
  return { base, blade, pivot: [0, 1.5, 0], axis: [0, 1, 0], rate: 0.8 };
};
B.sunshade = () => spinAll('sunshade');

// ---- Harbour T4
B.rowboat = () => {
  // DECISION: D29 toy boat with no thwarts (no seats); two oars stowed inside instead.
  const s = [0.56, 0.5, 1.25];
  const parts = [
    H_hull(14, 'z', s, H_hullPaint(), false),
    H_hull(14, 'z', [s[0] * 0.94, s[1] * 0.94, s[2] * 0.94], (x) => (Math.floor((x + 1) / 0.25) % 2 ? '#C98B4E' : '#B57A40'), true),
    P(new T.TubeGeometry(H_rimCurve('z', [s[0] * 0.97, 0, s[2] * 0.97]), 20, 0.045, 4, true), H_WHITE),
  ];
  [-1, 1].forEach((k) => {
    const x = k * 0.16, r = k * 0.08;
    parts.push(H_beam([x - Math.sin(r) * 0.5, -0.2, -0.5], [x + Math.sin(r) * 0.45, -0.2, 0.45], 0.044, '#E8C48A', 6));
    parts.push(P(box(0.09, 0.014, 0.26), (q, y, z) => (z > 0.07 ? H_RED : '#E8C48A'), [x + Math.sin(r) * 0.55, -0.2, 0.58], [0, r, 0]));
  });
  return parts;
};
B.shed = () => {
  const wall = (x, y, z, t, nx, ny, nz) => (Math.abs(nz) > 0.5 ? (Math.floor((x + 0.7) / 0.175) % 2 ? '#C8403F' : H_RED) : ny > 0.5 ? '#B83A3A' : '#D04545');
  const th = Math.atan2(0.4, 0.72);
  const gable = new T.Shape(); gable.moveTo(-0.72, 0); gable.lineTo(0.72, 0); gable.lineTo(0, 0.4); gable.closePath();
  const roof = (x, y, z, t, nx, ny) => (ny < 0 ? '#1E6F8A' : H_TEAL);
  const parts = [
    P(box(1.9, 0.08, 1.5, 6, 1, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? (Math.floor((x + 0.95) / (1.9 / 6)) % 2 ? '#C99A63' : '#B5854F') : '#8E6538'), [0, 0.04, 0]),
    P(box(1.4, 0.65, 1.0, 8, 1, 1), wall, [0, 0.405, 0]),
    P(new T.ExtrudeGeometry(gable, { depth: 1.0, bevelEnabled: false }).translate(0, 0, -0.5), '#E8574A', [0, 0.73, 0]),
    P(box(0.94, 0.06, 1.16), roof, [-0.39, 0.955, 0], [0, 0, th]),
    P(box(0.94, 0.06, 1.16), roof, [0.39, 0.955, 0], [0, 0, -th]),
    P(box(0.1, 0.05, 1.18), '#FFFFFF', [0, 1.16, 0]),
    P(box(0.36, 0.46, 0.04), H_WHITE, [0, 0.31, 0.51]),
    P(ico(0.025, 0), '#FFCF3D', [0.12, 0.31, 0.535]),
    P(tor(0.1, 0.022, 4, 10), '#FFCF3D', [0, 0.88, 0.505]),
    P(cyl(0.09, 0.09, 0.03, 10), WIN, [0, 0.88, 0.505], [PI / 2, 0, 0]),
    P(tor(0.13, 0.045, 4, 12), (x, y) => (Math.floor((Math.atan2(y, x) + PI) / (PI / 2)) % 2 ? '#FFFFFF' : H_RED), [0.47, 0.44, 0.53]),
    P(box(0.34, 0.28, 0.34), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#B07338'), [-0.74, 0.22, 0.52], [0, 0.2, 0]),
    P(box(0.24, 0.2, 0.24), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#B07338'), [-0.72, 0.46, 0.5], [0, -0.25, 0]),
    P(flat(tor(0.12, 0.035, 4, 10)), H_ropeCol(0.12, 0, 6), [0.68, 0.115, 0.56]),
  ];
  [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]].forEach(([x, z]) => parts.push(P(box(0.07, 0.65, 0.07), '#FFFFFF', [x, 0.405, z])));
  return parts;
};
B.crane = () => {
  const Y = '#FFCF3D', N = H_NAVY;
  const parts = [
    P(box(1.4, 0.08, 0.3), N, [0, 0.04, 0.45]), P(box(1.4, 0.08, 0.3), N, [0, 0.04, -0.45]),
    P(box(1.2, 0.22, 1.2), (x, y, z, t, nx, ny) => (ny > 0.5 ? Y : '#E8B52E'), [0, 0.19, 0]),
    P(box(0.7, 0.5, 0.6), grad('#E8B52E', Y, -0.25, 0.25), [-0.15, 0.55, 0]),
    P(box(0.76, 0.05, 0.66), N, [-0.15, 0.825, 0]),
    pane(0.42, 0.24, [-0.08, 0.6, 0.306]), pane(0.34, 0.24, [0.206, 0.6, 0], PI / 2),
    P(box(0.28, 1.0, 0.28, 1, 6, 1), (x, y, z, t, nx, ny) => (Math.abs(ny) > 0.5 ? Y : Math.floor((y + 0.5) / (1 / 6)) % 2 ? N : Y), [-0.25, 1.35, 0]),
    P(box(2.3, 0.16, 0.2), Y, [0.3, 1.93, 0]),
    P(box(0.08, 0.3, 0.08), N, [-0.25, 2.16, 0]),
    H_beam([-0.25, 2.29, 0], [1.4, 2.0, 0], 0.035, N), H_beam([-0.25, 2.29, 0], [-0.8, 2.0, 0], 0.035, N),
    P(box(0.42, 0.34, 0.34), '#5A6380', [-0.72, 1.68, 0]),
    P(box(0.16, 0.08, 0.22), N, [1.25, 1.81, 0]),
    P(cyl(0.012, 0.012, 0.74, 4), N, [1.25, 1.4, 0]),
    P(box(0.12, 0.1, 0.1), N, [1.25, 1.0, 0]),
    P(tor(0.06, 0.018, 4, 8, 4.5), H_gold(0.08), [1.25, 0.9, 0], [0, 0, 2.4]),
    P(box(0.42, 0.32, 0.42, 1, 3, 1), (x, y, z, t, nx, ny) => (Math.abs(ny) > 0.5 ? '#D9A066' : Math.floor((y + 0.16) / (0.32 / 3)) % 2 ? '#B07338' : '#C98B4E'), [1.25, 0.46, 0]),
    P(ico(0.08, 0), '#FF9A1F', [1.18, 0.66, -0.06]), P(ico(0.07, 0), '#E8463A', [1.33, 0.66, 0.07]),
  ];
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => parts.push(H_beam([1.25, 0.86, 0], [1.25 + a * 0.17, 0.62, b * 0.17], 0.014, N)));
  return parts;
};

// ---- Harbour bosses
B['boss-icecreamkiosk'] = () => {
  // DECISION: squat kiosk with a giant tilted cone on the roof; h ≈ 2.8 at catalog a (vs 2.4) so the cone still
  // reads as the silhouette.
  const pink = grad('#FF9EB5', '#FFC6D4', -0.45, 0.45);
  const parts = [
    P(box(2.5, 0.1, 1.9, 8, 1, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? (Math.floor((x + 1.25) / (2.5 / 8)) % 2 ? '#C99A63' : '#B5854F') : '#8E6538'), [0, 0.05, 0]),
    P(rbox(2.1, 0.9, 1.5, 0.12, 1), pink, [0, 0.55, 0]),
    P(rbox(2.3, 0.16, 1.7, 0.06, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#A8EBD6' : '#FFF1DC'), [0, 1.08, 0]),   // (11-04 review) mint roof top: a plain cream slab dominated the top view
    ...awning(2.0, 0.5, 8, '#E8574A', '#FFD23F', [0, 0.93, 0.95], 0.35),
    P(box(1.1, 0.42, 0.03), '#6B2E45', [-0.1, 0.62, 0.755]),
    P(box(1.2, 0.05, 0.22), '#FFF1DC', [-0.1, 0.42, 0.84]),
    P(box(0.03, 0.6, 0.42), '#FFD23F', [-1.065, 0.42, 0.2]),
    pane(0.2, 0.16, [-1.082, 0.58, 0.2], -PI / 2),
    P(ico(0.03, 0), '#FFFFFF', [-1.085, 0.4, 0.06]),
    P(box(0.36, 0.44, 0.03), H_TEAL, [0.78, 0.62, 0.76]),
  ];
  [['#8FE3C8', -0.5], ['#FF9EC4', -0.15], ['#FFE08A', 0.2]].forEach(([c, x]) => {
    parts.push(P(cyl(0.09, 0.075, 0.1, 8), '#FFFFFF', [x, 0.495, 0.84]));
    parts.push(P(sph(0.08, 6, 4), c, [x, 0.56, 0.84], null, [1, 0.7, 1]));
  });
  for (let i = 0; i < 8; i++) parts.push(P(ico(0.06, 0), ['#FFD23F', H_TEAL, '#FF9EC4', '#FFFFFF'][i % 4], [-1.0 + i * (2.0 / 7), 1.2, 0.83]));
  const cone = (x, y, z) => ((Math.floor(az(x, z) / (TAU / 10)) + Math.floor((y + 0.275) / 0.184)) % 2 ? '#E8A24E' : '#F5C277');
  const top = [
    P(cyl(0.28, 0.035, 0.55, 10, 3, true), cone, [0, 0.275, 0]),
    P(sph(0.27, 10, 7), grad('#F2DCC8', '#FFF8EE', -0.27, 0.27), [0, 0.6, 0], null, [1, 0.85, 1]),
    P(sph(0.21, 9, 6), grad('#FF7FB0', '#FFC2DA', -0.21, 0.21), [0.02, 0.82, 0], null, [1, 0.85, 1]),
    P(sph(0.12, 8, 5), grad('#FFB3C7', '#FFE3EC', -0.12, 0.12), [0, 0.97, 0]),
    P(ico(0.07, 1), H_RED, [0.02, 1.1, 0]),
  ];
  xf(top, [0, 0, -0.32], [0.35, 1.16, -0.15]);
  return parts.concat(top);
};
B['boss-popcorncart'] = () => {
  const parts = [
    P(box(2.0, 0.42, 0.9, 10, 1, 1), (x, y, z, t, nx, ny, nz) => (Math.abs(nz) > 0.5 ? (Math.floor((x + 1) / 0.2) % 2 ? '#FFFFFF' : H_RED) : H_RED), [0, 0.62, 0]),
    P(box(2.1, 0.06, 1.0), '#FFFFFF', [0, 0.86, 0]),
    P(box(1.3, 0.04, 0.7), '#FFFFFF', [-0.15, 0.22, 0]),
    P(box(0.06, 0.43, 0.06), H_RED, [-0.85, 0.2, 0.38]), P(box(0.06, 0.43, 0.06), H_RED, [-0.85, 0.2, -0.38]),
    P(box(0.06, 0.06, 0.82), H_RED, [-0.85, 0.03, 0]),
    H_beam([-0.95, 0.75, 0.3], [-1.28, 0.82, 0.3], 0.05, H_RED, 6), H_beam([-0.95, 0.75, -0.3], [-1.28, 0.82, -0.3], 0.05, H_RED, 6),
    P(cyl(0.035, 0.035, 0.66, 6), '#FFFFFF', [-1.28, 0.82, 0], [PI / 2, 0, 0]),
    P(cyl(0.035, 0.035, 1.24, 6), '#9AA3B5', [0.7, 0.4, 0], [PI / 2, 0, 0]),
  ];
  [0.62, -0.62].forEach((z) => {
    parts.push(P(tor(0.38, 0.035, 4, 20), H_RED, [0.7, 0.4, z]));
    parts.push(P(cyl(0.07, 0.07, 0.1, 8), '#FFFFFF', [0.7, 0.4, z], [PI / 2, 0, 0]));
    for (let k = 0; k < 3; k++) parts.push(P(box(0.03, 0.72, 0.02), H_RED, [0.7, 0.4, z], [0, 0, k * PI / 3]));
  });
  [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]].forEach(([x, z]) => parts.push(P(box(0.05, 0.36, 0.05), '#FFCF3D', [x, 1.07, z])));
  // (11-04, orchestrator) the case read as an open gold frame: pale glass panels on the back and both ends, with
  // white glare streaks; the front stays open so the top-down camera still sees the popcorn.
  const glass = grad('#A9DCEF', '#E8F8FF', 0.89, 1.25);
  parts.push(P(box(1.86, 0.34, 0.02), glass, [0, 1.06, -0.4]));
  [-0.95, 0.95].forEach((x) => parts.push(P(box(0.02, 0.34, 0.76), glass, [x, 1.06, 0])));
  [[-0.55, -0.385], [0.45, -0.385]].forEach(([x, z]) => parts.push(P(box(0.05, 0.28, 0.008), '#FFFFFF', [x, 1.06, z], [0, 0, 0.5])));
  parts.push(P(box(0.008, 0.26, 0.05), '#FFFFFF', [-0.935, 1.06, 0.15], [0.5, 0, 0]), P(box(0.008, 0.26, 0.05), '#FFFFFF', [0.935, 1.06, -0.15], [0.5, 0, 0]));
  parts.push(P(box(1.9, 0.03, 0.03), '#FFCF3D', [0, 0.89, 0.4]));
  const C = ['#FFF4C2', '#FFFFFF', '#FFE08A', '#FFF8DC'];
  for (let i = 0; i < 22; i++) {
    const x = -0.8 + 1.6 * hsh(i + 1), z = -0.3 + 0.6 * hsh(i + 31), d = Math.hypot(x / 0.9, z / 0.36);
    parts.push(P(ico(0.075 + 0.02 * hsh(i + 5), 0), C[i % 4], [x, 0.95 + 0.22 * Math.max(0, 1 - d * d) + 0.04 * hsh(i + 11), z]));
  }
  parts.push(P(sph(0.13, 8, 5), H_RED, [0.25, 1.1, 0], null, [1, 0.8, 1]));
  parts.push(P(cyl(0.06, 0.09, 0.05, 8), H_gold(0.05), [0.25, 1.2, 0]));
  const dome = (x, y, z, t) => (Math.floor(t / 2) % 2 ? '#FFFFFF' : H_RED);
  parts.push(P(new T.CylinderGeometry(0.46, 0.46, 2.1, 8, 1, true, PI, PI), dome, [0, 1.25, 0], [0, 0, -PI / 2], [0.7, 1, 1]));
  parts.push(P(new T.CircleGeometry(0.46, 8, 0, PI), H_RED, [1.05, 1.25, 0], [0, PI / 2, 0], [1, 0.7, 1]));
  parts.push(P(new T.CircleGeometry(0.46, 8, 0, PI), H_RED, [-1.05, 1.25, 0], [0, -PI / 2, 0], [1, 0.7, 1]));
  parts.push(...awning(2.0, 0.3, 8, H_RED, '#FFFFFF', [0, 1.25, 0.55], 0.5));
  parts.push(P(ico(0.07, 1), H_gold(0.07), [0, 1.62, 0]));
  parts.push(P(cyl(0.1, 0.07, 0.07, 8), '#5FB54A', [-0.5, 0.275, 0.2]), P(cyl(0.1, 0.07, 0.07, 8), '#7ACB62', [-0.2, 0.275, 0.25]));
  return parts;
};
B['boss-snackboat'] = () => {
  const hs = [1.5, 0.55, 0.75];
  const deck = new T.Shape(H_rimCurve('x', [hs[0] * 0.97, 0, hs[2] * 0.97], 18).getPoints(18).map((p) => new T.Vector2(p.x, -p.z)));
  const parts = [
    // (11-04 review, Art) the square water slab read as a blue tile: now an elliptical puddle with a foam ring,
    // radius 2.23 on x like the old corner, so the footprint scale (and h) stay the same.
    P(cyl(1, 1, 0.12, 24), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#5ACBE3' : '#2A9FC0'), [0, 0.06, 0], null, [2.1, 1, 1.33]),
    H_hull(16, 'x', hs, H_hullPaint(H_TEAL, H_WHITE, H_RED), false),
    P(slab(deck, 0.02), '#E2BC84', [0, -0.03, 0]),
    P(new T.TubeGeometry(H_rimCurve('x', [hs[0] * 0.97, 0, hs[2] * 0.97]), 24, 0.05, 4, true), H_WHITE),
  ];
  xf(parts.slice(1), null, [0, 0.52, 0]);
  parts.push(P(cyl(1, 1, 0.1, 24), '#E8FBFF', [0, 0.05, 0], null, [2.23, 1, 1.45]));
  parts.push(
    P(rbox(0.75, 0.62, 1.0, 0.1, 1), H_WHITE, [-0.85, 0.81, 0]),
    P(rbox(0.9, 0.1, 1.15, 0.04, 1), '#17607A', [-0.85, 1.17, 0]),
    pane(0.3, 0.2, [-0.99, 0.9, 0.506]), pane(0.5, 0.22, [-0.47, 0.9, 0], PI / 2),
    P(cyl(0.1, 0.12, 0.4, 10), (x, y) => (y > 0.05 && y < 0.13 ? '#FFFFFF' : H_RED), [-1.0, 1.4, -0.2]),
    P(box(0.9, 0.3, 0.55), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#D9A066' : '#B07338'), [0.5, 0.67, 0]),
    P(tor(0.15, 0.045, 4, 12), (x, y) => (Math.floor((Math.atan2(y, x) + PI) / (PI / 2)) % 2 ? '#FFFFFF' : H_RED), [-0.66, 0.78, 0.53]),
  );
  [[0.0, 0.45], [1.0, 0.45], [0.0, -0.45], [1.0, -0.45]].forEach(([x, z]) => parts.push(P(cyl(0.03, 0.03, 0.75, 4), '#FFFFFF', [x, 0.89, z])));
  parts.push(...awning(1.3, 1.1, 6, '#FF7A59', '#FFCF3D', [0.5, 1.28, 0], 0.12));
  parts.push(P(cyl(0.022, 0.022, 0.5, 4), '#FFFFFF', [1.0, 1.55, -0.45]), P(box(0.26, 0.16, 0.012), H_RED, [1.13, 1.71, -0.45]));
  [[0.2, '#FF9A1F'], [0.5, '#FFF4C2'], [0.8, '#E8A24E']].forEach(([x, c], j) => {
    parts.push(P(cyl(0.13, 0.1, 0.1, 8), '#C98B4E', [x, 0.87, 0]));
    for (let i = 0; i < 4; i++) parts.push(P(ico(0.055, 0), c, [x + Math.cos(i * 1.9 + j) * (i ? 0.06 : 0), 0.94 + (i ? 0 : 0.04), Math.sin(i * 1.9 + j) * (i ? 0.06 : 0)]));
  });
  // portholes on the near (+z) side of the hull
  [-0.5, 0.0, 0.5].forEach((x) => {
    const u = x / hs[0], z = hs[2] * Math.sqrt(Math.max(0, 0.95 - u * u)) * (x > 0 ? 1 - 0.55 * u * u : 1);
    parts.push(P(cyl(0.065, 0.065, 0.03, 8), WIN, [x, 0.4, z + 0.005], [PI / 2, 0, 0]));
  });
  // boarding ladder hung from the rim between the portholes
  [0.18, 0.36].forEach((x) => parts.push(H_beam([x, 0.58, 0.75], [x, 0.12, 0.86], 0.03, '#FFCF3D')));
  [0.22, 0.36, 0.5].forEach((y) => parts.push(P(box(0.2, 0.025, 0.025), '#FFCF3D', [0.27, y, 0.75 + (0.58 - y) * 0.11 / 0.46 + 0.01])));
  return parts;
};
S['boss-foodtruck'] = () => {
  // DECISION: (D29) toy truck, painted opaque cab windows, no seats or figures, no flames; the gold wind-up key on
  // the back wall is the spinning blade (shaft along z).
  const Y = grad('#F2B92E', '#FFD84A', -0.6, 0.6);
  const base = [
    P(rbox(1.6, 0.26, 2.9, 0.08, 1), '#5FB54A', [0, 0.4, 0]),
    P(rbox(1.5, 1.25, 1.9, 0.14, 2), Y, [0, 1.12, -0.45]),
    P(rbox(1.46, 0.95, 0.95, 0.2, 2), Y, [0, 0.98, 0.95]),
    pane(1.05, 0.42, [0, 1.17, 1.429]), pane(0.55, 0.36, [0.736, 1.17, 0.95], PI / 2), pane(0.55, 0.36, [-0.736, 1.17, 0.95], -PI / 2),
    P(cyl(0.08, 0.08, 0.04, 8), '#FFF6C8', [0.5, 0.75, 1.43], [PI / 2, 0, 0]), P(cyl(0.08, 0.08, 0.04, 8), '#FFF6C8', [-0.5, 0.75, 1.43], [PI / 2, 0, 0]),
    P(box(1.55, 0.12, 0.1), '#9AA3B5', [0, 0.48, 1.46]), P(box(1.55, 0.12, 0.1), '#9AA3B5', [0, 0.48, -1.46]),
    P(box(0.14, 0.1, 0.03), H_RED, [0.6, 0.72, -1.415]), P(box(0.14, 0.1, 0.03), H_RED, [-0.6, 0.72, -1.415]),
    P(box(0.03, 0.55, 1.25), '#5A3A2A', [0.755, 1.18, -0.45]),
    P(box(0.26, 0.05, 1.3), H_WHITE, [0.83, 0.93, -0.45]),
    ...awning(1.35, 0.48, 6, H_RED, '#FFFFFF', [0.99, 1.5, -0.45], 0.35, PI / 2),
  ];
  [[0.72, 0.85], [-0.72, 0.85], [0.72, -0.95], [-0.72, -0.95]].forEach(([x, z]) => base.push(...wheel(0.32, 0.24, [x, 0.32, z], 10)));
  // food on the counter: burger, fries, a cone, a drink
  const cx = 0.85, cy = 0.955;
  base.push(
    P(cyl(0.07, 0.065, 0.03, 8), '#E8A24E', [cx, cy + 0.015, -0.95]), P(cyl(0.074, 0.074, 0.025, 8), '#6B3A22', [cx, cy + 0.042, -0.95]),
    P(sph(0.07, 6, 4), grad('#D08636', '#F5C277', -0.07, 0.07), [cx, cy + 0.055, -0.95], null, [1, 0.6, 1]),
    P(box(0.1, 0.08, 0.07), H_RED, [cx, cy + 0.04, -0.62]),
    ...[-0.03, -0.01, 0.01, 0.03].map((dz, i) => P(box(0.016, 0.07, 0.016), '#FFD23F', [cx + (i % 2 ? 0.01 : -0.01), cy + 0.1, -0.62 + dz])),
    P(cyl(0.05, 0.01, 0.12, 6, 1, true), '#F5C277', [cx, cy + 0.06, -0.3]), P(sph(0.055, 6, 4), '#FF9EC4', [cx, cy + 0.13, -0.3]),
    P(cyl(0.045, 0.038, 0.12, 8), H_TEAL, [cx, cy + 0.06, 0.0]), P(cyl(0.008, 0.008, 0.08, 4), '#FFFFFF', [cx, cy + 0.15, 0.01], [0.3, 0, 0]),
  );
  const gold = H_gold(0.2);
  const blade = [
    P(cyl(0.045, 0.045, 0.3, 8), gold, [0, 1.3, -1.55], [PI / 2, 0, 0]),
    P(sph(0.07, 6, 4), gold, [0, 1.3, -1.72]),
    P(tor(0.14, 0.045, 4, 12), gold, [0, 1.49, -1.74], [0, PI / 2, 0]),
    P(tor(0.14, 0.045, 4, 12), gold, [0, 1.11, -1.74], [0, PI / 2, 0]),
  ];
  return { base, blade, pivot: [0, 1.3, -1.55], axis: [0, 0, 1], rate: 2.5 };
};
B['boss-foodtruck'] = () => spinAll('boss-foodtruck');
B['boss-lighthouse'] = () => {
  // DECISION: jam-jar lighthouse (red/white bands, magenta jar foot and neck, gingham-lid gallery) on a mossy rock
  // island with a little railing; warm painted lantern (no flames), gold dome.
  const tower = (x, y) => (y < 0.42 ? '#C2185B' : y > 2.5 ? '#C2185B' : y > 2.34 ? H_WHITE : Math.floor((y - 0.42) / 0.4) % 2 ? H_WHITE : H_RED);
  const parts = [
    P(cyl(2.85, 3.0, 0.32, 20), (x, y, z, t, nx, ny) => (ny > 0.5 ? '#CFC3A8' : '#9C8F78'), [0, 0.16, 0]),
    P(lathe([[0, 0.32], [1.34, 0.32], [1.43, 0.42], [1.45, 0.82], [1.43, 1.22], [1.4, 1.62], [1.34, 2.02], [1.24, 2.34], [1.06, 2.5], [0.98, 2.56]], 24), tower),
    P(cyl(1.4, 1.4, 0.24, 24), gingham(0.28, '#C2185B', '#FFF6E3', '#E98AAE'), [0, 2.68, 0]),
    P(flat(tor(1.3, 0.03, 3, 24)), '#FFFFFF', [0, 3.1, 0]),
    P(cyl(0.78, 0.78, 0.62, 16), (x, y, z) => (Math.floor(az(x, z) / (TAU / 16)) % 4 === 0 ? H_RED : '#FFE9A8'), [0, 3.11, 0]),
    P(cyl(0.9, 0.9, 0.12, 16), H_RED, [0, 3.48, 0]),
    P(new T.SphereGeometry(0.84, 16, 6, 0, TAU, 0, PI / 2), grad('#E8A93C', '#FFE07A', 0, 0.84), [0, 3.54, 0]),
    P(ico(0.12, 1), H_RED, [0, 4.46, 0]),
    P(cyl(0.025, 0.025, 0.2, 4), '#FFCF3D', [0, 4.6, 0]),
    P(flat(tor(2.45, 0.035, 3, 28)), '#FFFFFF', [0, 0.72, 0]),
    P(box(0.6, 0.78, 0.1), '#8A5A35', [0, 0.71, 1.46]),
    P(new T.CylinderGeometry(0.3, 0.3, 0.1, 8, 1, false, PI / 2, PI), '#8A5A35', [0, 1.1, 1.46], [PI / 2, 0, 0]),
    P(box(0.9, 0.08, 0.35), '#B7AC97', [0, 0.36, 1.6]),
    P(ico(0.04, 0), '#FFCF3D', [0.18, 0.72, 1.52]),
  ];
  for (let i = 0; i < 14; i++) { const a = i * TAU / 14 + 0.1; parts.push(P(box(0.06, 0.4, 0.06), '#FFFFFF', [Math.cos(a) * 2.45, 0.52, Math.sin(a) * 2.45])); }
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + 0.2; parts.push(P(box(0.05, 0.3, 0.05), '#FFFFFF', [Math.cos(a) * 1.3, 2.95, Math.sin(a) * 1.3])); }
  const M = ['#4F9C88', '#6DB59C', '#8E9AA6', '#5E8C7A'];
  for (let i = 0; i < 11; i++) {
    const a = i * TAU / 11 + 0.3 * hsh(i), r = 0.38 + 0.22 * hsh(i + 3), R = 2.72 + 0.2 * hsh(i + 7);
    parts.push(P(ico(r, 0), M[i % 4], [Math.cos(a) * R, 0.2 + 0.1 * hsh(i + 2), Math.sin(a) * R], [0, a, 0], [1, 0.7, 1]));
  }
  parts.push(...H_round(0.17, 1.42, 1.42, PI / 2 + 0.75), ...H_round(0.17, 1.37, 1.85, PI / 2 - 0.55), ...H_round(0.15, 1.29, 2.18, PI / 2 + 0.2));
  return parts;
};

// ---------------------------------------------------------------- decor (static layer only; ≤ 300 tris)
export const DECOR_KINDS = ['sunflower', 'bush', 'grasstuft', 'flowerbed', 'bunting'];
const DECOR_A = { sunflower: 0.35, bush: 0.5, grasstuft: 0.22, flowerbed: 0.6, bunting: 1.6 };
B.sunflower = () => {
  const parts = [P(cyl(0.025, 0.03, 1.1, 6), '#4E9A3E', [0, 0.55, 0])];
  parts.push(leaf(0.1, [0.08, 0.45, 0], [0, 0, -0.5], '#5FB54A'));
  parts.push(leaf(0.09, [-0.07, 0.7, 0], [0, PI, -0.5], '#5FB54A'));
  const head = [P(cyl(0.22, 0.22, 0.03, 12), (x, y, z, t) => (t % 2 ? '#FFC93C' : '#FFB01F')), P(cyl(0.1, 0.1, 0.05, 10), '#7A4E2D', [0, 0.02, 0])];
  xf(head, [0.9, 0, 0], [0, 1.15, 0.05]);
  return parts.concat(head);
};
B.bush = () => [
  P(ico(0.4, 1), grad('#2F8A3E', '#5ABD62', -0.4, 0.4), [0, 0.3, 0], null, [1, 0.8, 1]),
  P(ico(0.28, 1), grad('#2F8A3E', '#66C26A', -0.28, 0.28), [0.28, 0.22, 0.12]),
  P(ico(0.04), '#FF9EC4', [0.1, 0.6, 0.2]), P(ico(0.04), '#FFFFFF', [-0.2, 0.5, 0.25]),
];
B.grasstuft = () => [0, 1, 2, 3, 4].map((i) => P(cone(0.04, 0.22 + 0.06 * hsh(i), 4), i % 2 ? '#5FB54A' : '#7ACB62',
  [Math.cos(i * 1.3) * 0.08, 0.11, Math.sin(i * 1.3) * 0.08], [0.25 * Math.sin(i * 2.1), 0, 0.25 * Math.cos(i * 2.1)]));
B.flowerbed = () => {
  const parts = [P(sph(0.6, 10, 4), grad('#3E9443', '#6CC163', -0.6, 0.6), [0, 0, 0], null, [1, 0.25, 0.7])];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.15 + 0.3 * hsh(i + 3);
    parts.push(P(ico(0.05), ['#FF9EC4', '#FFC93C', '#FFFFFF', '#FF7A59'][i % 4], [Math.cos(a) * r, 0.14, Math.sin(a) * r * 0.7]));
  }
  return parts;
};
B.bunting = () => {
  const parts = [], L = 1.5;
  [-L, L].forEach((x) => parts.push(P(cyl(0.03, 0.035, 1.6, 6), '#FFF1DC', [x, 0.8, 0])));
  const c = new T.QuadraticBezierCurve3(V3(-L, 1.55, 0), V3(0, 1.1, 0), V3(L, 1.55, 0));
  parts.push(P(new T.TubeGeometry(c, 10, 0.01, 3, false), '#7A5236'));
  const cols = ['#E8574A', '#FFC93C', '#2FB5A5', '#FFF1DC', '#FF7A59'];
  for (let i = 1; i < 10; i++) {
    const p = c.getPointAt(i / 10);
    parts.push(P(slab(polyShape([[-0.1, 0], [0.1, 0], [0, -0.2]]), 0.012), cols[i % 5], [p.x, p.y, 0.006], [PI / 2, 0, 0]));
  }
  return parts;
};

// ---------------------------------------------------------------- fallback (kinds not built yet)
function fallback(k) {
  const col = k.color || '#C9D3E0', h = Math.max(0.06, Math.min(k.h || k.a, 2.5 * k.a));
  if (k.food) return [P(sph(1, 10, 8), grad(mixC(col, '#3A2418', 0.25), mixC(col, '#FFFFFF', 0.25), -1, 1), [0, 1, 0], null, [1, 1, 1]), HL(0.12, [-0.4, 1.75, 0.4])].map((g) => g.scale(k.a, h / 2, k.a));
  return [P(rbox(1.4 * k.a, h, 1.4 * k.a, Math.min(0.3 * k.a, h / 3), 1), grad(mixC(col, '#3A2418', 0.2), col, 0, h), [0, h / 2, 0])];
}

// ---------------------------------------------------------------- public: props
const _geo = new Map();
/** Cached geometry for a catalog kind or a DECOR_KINDS id (never dispose the result). */
export function geometryFor(kindId) {
  let g = _geo.get(kindId);
  if (g) return g;
  const k = KIND[kindId];
  const a = k ? k.a : DECOR_A[kindId] || null;
  const build = B[kindId];
  const raw = build ? build() : fallback(k || { a: a || 0.3, h: 0.3, color: '#C9D3E0' });
  const top = raw.top, slots = raw.slots;
  g = finish(merge(raw), a);
  g.userData.kind = kindId;
  g.userData.built = !!build;
  // fragile stacks: top = y of the surface the 1-3 contents sit on, slots = their [x, z] (final frame)
  if (top != null) {
    const tr = g.userData.tr;
    g.userData.top = (top + tr[1]) * tr[3];
    g.userData.slots = (slots || [[0, 0]]).map(([x, z]) => [(x + tr[0]) * tr[3], (z + tr[2]) * tr[3]]);
  }
  if (S[kindId]) g.userData.spin = true;
  _geo.set(kindId, g);
  return g;
}
export const SPIN_KINDS = ['pinwheel', 'parasol', 'sunshade', 'boss-foodtruck'];
const _spin = new Map();
/**
 * Spinning kinds split for render: { base, blade, pivot, axis, rate } in the same frame/scale as geometryFor(id)
 * (bosses: scale base, blade and pivot by level a / catalog a). blade's origin is the pivot: put the blade mesh
 * at pivot and setRotationFromAxisAngle(axis, t·rate). Cached; null for kinds that do not spin.
 */
export function spinParts(kindId) {
  let r = _spin.get(kindId);
  if (r) return r;
  if (!S[kindId]) return null;
  const full = geometryFor(kindId), { tr, h } = full.userData, sp = S[kindId]();
  const base = refit(merge(sp.base), tr, h), blade = refit(merge(sp.blade), tr, h);
  const pivot = trPt(tr, sp.pivot[0], sp.pivot[1], sp.pivot[2]);
  blade.translate(-pivot[0], -pivot[1], -pivot[2]);
  blade.computeBoundingSphere();
  const ax = new T.Vector3(sp.axis[0], sp.axis[1], sp.axis[2]).normalize();
  base.userData.kind = blade.userData.kind = kindId;
  r = { base, blade, pivot, axis: [ax.x, ax.y, ax.z], rate: sp.rate };
  _spin.set(kindId, r);
  return r;
}
/** Tri budget for a kind (GDD §13.7): T0/T1 200 · T2 400 · T3 800 · T4 600 · boss 2,500 · decor 300. */
export function triCap(kindId) {
  const k = KIND[kindId];
  if (!k) return 300;
  if (k.boss) return 2500;
  return [200, 200, 400, 800, 600][k.tier] || 600;
}
export function hasBuilder(kindId) { return !!B[kindId]; }

// ---------------------------------------------------------------- layered boss (wedding cake, §4.5 #53)
// DECISION: tier 0 = the TOP (smallest, eaten first), 1 = middle, 2 = bottom. Each tier geometry has a unit
// footprint (fp = 1, scale it by that tier's `a`), origin at its bottom centre; userData.h = height per unit a,
// so render stacks: bottom at y 0, middle at h2·a2, top at h2·a2 + h1·a1.
const _tier = new Map();
export function bossTierGeometry(id, tier) {
  const key = id + '#' + tier;
  let g = _tier.get(key);
  if (g) return g;
  const t = Math.max(0, Math.min(2, tier | 0));
  const body = ['#FFF6E3', '#FFF1DC', '#FFF6E3'][t];
  const parts = [P(cyl(1, 1, 0.62, 24), body, [0, 0.31, 0])];
  // piped bead borders: lumpy tori (cheaper than separate beads), white on top, blush at the foot
  const bead = (R, tube, y, hex, n) => P(warp(flat(tor(R, tube, 3, n * 2)), (v) => {
    const a = Math.atan2(v.z, v.x), k = 1 + 0.35 * Math.abs(Math.sin(a * n / 2 * 2));
    const r = Math.hypot(v.x, v.z), d = r - R; v.x = Math.cos(a) * (R + d * k); v.z = Math.sin(a) * (R + d * k); v.y *= k;
  }), hex, [0, y, 0]);
  parts.push(bead(1.0, 0.07, 0.62, '#FFFFFF', 18), bead(1.0, 0.06, 0.05, '#FFE3EC', 14));
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + t + PI / 4;
    parts.push(P(ico(0.12, 0), '#FF9EC4', [Math.cos(a) * 0.98, 0.36, Math.sin(a) * 0.98], null, [0.6, 1, 1]));
    parts.push(leaf(0.07, [Math.cos(a + 0.18) * 1.0, 0.28, Math.sin(a + 0.18) * 1.0], [0, -a, 0], '#7CC95A'));
  }
  if (t === 0) {
    parts.push(P(ico(0.22, 1), '#FF9EC4', [0, 0.78, 0]));
    parts.push(P(ico(0.15, 1), '#FFB3C7', [0.22, 0.72, 0.1]));
    parts.push(P(ico(0.15, 1), '#FFB3C7', [-0.2, 0.72, -0.12]));
  }
  g = finish(merge(parts), 1);
  _tier.set(key, g);
  return g;
}
B['boss-weddingcake'] = () => {
  const out = [];
  const sizes = [[1.0, 0.62, 2.9 / 2.9], [0.83, 0.62, 2.4 / 2.9], [0.62, 0.62, 1.8 / 2.9]];
  let y = 0;
  sizes.forEach(([r, h], i) => {
    out.push(P(cyl(r, r, h * r, 28), i === 1 ? '#FFF1DC' : '#FFF6E3', [0, y + h * r / 2, 0]));
    for (let k = 0; k < 14; k++) { const a = k * TAU / 14; out.push(P(ico(0.06 * r + 0.02, 0), '#FFFFFF', [Math.cos(a) * r, y + h * r, Math.sin(a) * r])); }
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + i; out.push(P(ico(0.1 * r + 0.02, 1), '#FF9EC4', [Math.cos(a) * r, y + h * r * 0.55, Math.sin(a) * r], null, [0.6, 1, 1])); }
    y += h * r;
  });
  out.push(P(ico(0.16, 1), '#FF9EC4', [0, y + 0.1, 0]));
  return out;
};

// ---------------------------------------------------------------- board, surfaces, ground
/** Bevelled board W × 0.5 × D (0.18 bevel, 3 segments), top at y = 0. Top = GROUND_BASE[town] with ground uv. */
export function boardGeometry(W, D, town = 'picnic') {
  const g = rbox(W, 0.5, D, 0.18, 3);
  g.translate(0, -0.25, 0);
  const p = g.attributes.position.array, n = g.attributes.normal.array, cnt = p.length / 3;
  const c = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
  const top = lin(GROUND_BASE[town] || GROUND_BASE.picnic), e0 = lin('#7E5636'), e1 = lin('#9A6A45'), tmp = new T.Color();
  for (let v = 0; v < cnt; v += 3) {
    const isTop = n[v * 3 + 1] > 0.999 && n[v * 3 + 4] > 0.999 && n[v * 3 + 7] > 0.999;
    for (let j = 0; j < 3; j++) {
      const i = (v + j) * 3, u = (v + j) * 2;
      if (isTop) {
        c[i] = top.r; c[i + 1] = top.g; c[i + 2] = top.b;
        uv[u] = p[i] / GROUND_TILE; uv[u + 1] = p[i + 2] / GROUND_TILE;
      } else {
        tmp.copy(e0).lerp(e1, sat((p[i + 1] + 0.5) / 0.5));
        c[i] = tmp.r; c[i + 1] = tmp.g; c[i + 2] = tmp.b;
        uv[u] = WHITE_UV[0]; uv[u + 1] = WHITE_UV[1];
      }
    }
  }
  g.setAttribute('color', new T.BufferAttribute(c, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData = { tris: cnt / 3 };
  return g;
}

const SURF_DEFAULT = {
  picnic: { blanket: '#FFF1DC', path: '#EBD3A0', rug: '#FFF1DC', deck: '#C99A63', water: '#2AA7C9' },
  market: { blanket: '#2FB5A5', path: '#B7BDC4', rug: '#7A4C9E', deck: '#C99A63', water: '#2AA7C9' },
  harbour: { blanket: '#F6ECD6', path: '#9C8868', rug: '#F6ECD6', deck: '#E8FBFF', water: '#2AA7C9' },
};
function shade(hex, t) { return mixC(hex, t > 0 ? '#FFFFFF' : '#3A2418', Math.abs(t)); }
function lum(hex) { const c = lin(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
const HEM = { picnic: '#2FB5A5', market: '#FF7A59', harbour: '#2AA7C9' };
/**
 * Flat rounded-rectangle surface, centred on the origin, spanning x ±w/2, z ±d/2, top 0.02 u above y = 0.
 * type: blanket | path | rug | deck | water. color: optional hex (the level's surface colour); town picks
 * defaults. Fresh geometry each call (render disposes it).
 */
export function surfaceGeometry(type, w, d, color, town = 'picnic') {
  const col = color || (SURF_DEFAULT[town] || SURF_DEFAULT.picnic)[type] || '#FFF1DC';
  const parts = [];
  const frame = (inset, bw, hex, y) => {
    const iw = w - 2 * inset, id = d - 2 * inset;
    if (iw < 2 * bw || id < 2 * bw) return;
    parts.push(P(box(iw, 0.004, bw), hex, [0, y, id / 2 - bw / 2]), P(box(iw, 0.004, bw), hex, [0, y, -id / 2 + bw / 2]),
      P(box(bw, 0.004, id - 2 * bw), hex, [iw / 2 - bw / 2, y, 0]), P(box(bw, 0.004, id - 2 * bw), hex, [-iw / 2 + bw / 2, y, 0]));
  };
  if (type === 'path') {
    // R6 (11-06): a square path renders as a disc: the spiral's stepping stones and the boss pad. In dark slate or brown they
    // read as stains on the floor (the "eaten marks" of the 11-06 critics: nothing is left by eating, these are level
    // surfaces from the first frame). So a disc is a pale paving stone with a darker kerb. Roads keep the level's colour.
    const stone = Math.abs(w - d) < 0.01, rad = Math.min(w, d) / 2;
    if (town === 'harbour' && !stone) {
      // DECISION (11-11, harbour path): the level's path colour (#A87A47 from catalog.js, #8F7355 here) pebbled to a grey-brown strip that read
      //   as a darker stain on the warm deck. On the pier a road is a boardwalk: lighter, warmer planks laid across it, a dark seam
      //   between each, close in value to the deck (#A8693F ground) so the path reads as a laid path, not a mark. render2d.js mirrors it.
      const long = Math.max(w, d), wide = w >= d, pn = Math.max(1, Math.round(long / 0.42)), pl = long / pn, br = Math.min(0.1, Math.min(w, d) / 4);
      parts.push(P(slab(rrShape(w, d, br), 0.016, 0, 6), '#5F4939'));   // 11-12 A1: scaled with the deck
      for (let i = 0; i < pn; i++) {
        const o = -long / 2 + (i + 0.5) * pl, hex = mixC(i % 2 ? '#9C8868' : '#A49379', '#5F4939', i % 3 === 1 ? 0.06 : 0);
        parts.push(P(rbox(wide ? pl - 0.05 : w - 0.12, 0.02, wide ? d - 0.12 : pl - 0.05, 0.01, 1), hex, [wide ? o : 0, 0.012, wide ? 0 : o]));
      }
      const hg = merge(parts); setWhiteUV(hg); hg.computeBoundingBox(); hg.computeBoundingSphere();
      return hg;
    }
    const top = stone ? mixC(col, '#FFF1DC', 0.74) : null, fleck = (t) => (stone ? mixC(col, '#FFF1DC', t) : shade(col, t > 0.5 ? 0.18 : -0.1));
    parts.push(P(slab(rrShape(w, d, rad), 0.016, 0, 6), stone ? mixC(col, '#FFF1DC', 0.3) : col));
    if (stone) parts.push(P(slab(rrShape(w - 0.2, d - 0.2, rad - 0.1), 0.016, 0, 6), top, [0, 0.004, 0]));
    const n = Math.max(2, Math.round((w * d) / 0.9));
    for (let i = 0; i < n; i++) {
      const x = (hsh(i * 3 + 1) - 0.5) * (w - 0.3) * (stone ? 0.7 : 1), z = (hsh(i * 3 + 2) - 0.5) * (d - 0.3) * (stone ? 0.7 : 1), r = 0.05 + 0.05 * hsh(i * 3 + 3);
      parts.push(P(cyl(r, r, 0.006, 7), fleck(i % 2 ? 0.86 : 0.5), [x, 0.022, z], null, [1.3, 1, 1]));
    }
  } else if (type === 'water') {
    parts.push(P(slab(rrShape(w, d, Math.min(0.4, Math.min(w, d) / 3)), 0.006, 0, 6), col));
    frame(0.06, 0.07, '#E8FBFF', 0.009);
  } else if (type === 'deck') {
    // R4 (11-06): levels hand the harbour's near-white #E8FBFF here; a step down so white food reads on the planks.
    // 11-07 (art-director r5, L50/L55): one step was not enough, the deck still rendered near white and mint sweets, ice cream and
    // cotton candy sank into it. A near-white deck is now a sea-weathered blue-grey (half way to slate in linear light, about
    // #B0C5CB), so white and pastel food read by value and brown food by hue. Display only, like GROUND_BASE.
    // D2 (11-10): the blue-grey was the washed-out deck; a near-white deck is now the same warm toy wood as the pier, a shade
    // more orange so the platform still reads as its own piece.
    const pw = 0.28, n = Math.max(1, Math.round(d / pw)), base = lum(col) > 0.75 ? '#8A694A' : col;   // 11-12 A1: was #B5733F, scaled with the ground
    for (let i = 0; i < n; i++) parts.push(P(rbox(w, 0.03, d / n - 0.02, 0.012, 1), mixC(base, '#3A2418', i % 2 ? 0.08 : 0), [0, 0.006, -d / 2 + (i + 0.5) * d / n]));
  } else {
    // blanket / rug: body + hem frame + inner line; blanket gets tassels on the short ends
    // DECISION: the hem is a contrasting accent (light cloth → town accent, dark cloth → cream), so a cream
    // blanket still reads as its own shape on the cream-and-red gingham ground.
    const hem = lum(col) > 0.6 ? HEM[town] || HEM.picnic : '#FFF1DC';
    parts.push(P(slab(rrShape(w, d, 0.1), 0.02, 0, 4), col));
    frame(0.0, 0.09, hem, 0.022);
    frame(0.2, 0.03, shade(col, -0.12), 0.022);
    if (type === 'blanket') {
      const long = w >= d, L = long ? d : w, n = Math.max(3, Math.round(L / 0.25));
      for (let i = 0; i < n; i++) {
        const o = -L / 2 + (i + 0.5) * L / n;
        for (const s of [-1, 1]) parts.push(P(box(0.05, 0.012, 0.09), hem, long ? [s * (w / 2 + 0.035), 0.006, o] : [o, 0.006, s * (d / 2 + 0.035)], long ? [0, PI / 2, 0] : null));
      }
    }
  }
  const g = merge(parts);
  setWhiteUV(g);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** R8 floor dressing, one piece from dress.js (origin on the floor, y up). Flat prints are 0.02 u or less, under the blob decals. */
export function dressGeometry(d) {
  const parts = [], c = d.c | 0, k = d.k, mat = (w, dd, r, h, col, y = 0) => P(slab(rrShape(w, dd, r), h, 0, 4), col, [0, y, 0]);
  if (k === 'mat') {
    // R3 (11-06 Fri, round 2, art director: "flat beige discs read unfinished"): what a snack pile sits on. A plate with a
    // raised rim, a market's round chequered mat (every other pile in Market), a harbour's rope-edged canvas. The rim stops at y 0.08, the same
    // height as the rope prop the pot already rolls over, and the inner floor stays under the blob decals at y 0.042.
    const R = d.r, Y = 0.03, dsk = (r, hex, i, n = 32) => P(cyl(r, r, 0.006, n), hex, [0, Y + 0.003 * i, 0]);
    const rim = (r, tube, hex, n = 26) => P(new T.TorusGeometry(r, tube, 5, n).rotateX(PI / 2), hex, [0, Y + 0.012, 0], null, [1, 0.62, 1]);
    if (d.town === 'market' && c % 2 === 0) {
      const col = RUGS[(c + 1) % 4], cream = '#F4E6CC', rows = 3, cols = 12, r0 = R * 0.2, r1 = R * 0.9, dr = (r1 - r0) / rows;
      parts.push(dsk(R, shade(col, -0.2), 0), dsk(r1, cream, 1), dsk(r0, col, 2, 12));
      for (let a = 0; a < rows; a++) for (let b = a % 2; b < cols; b += 2) {
        const ring = new T.RingGeometry(r0 + a * dr, r0 + (a + 1) * dr, 3, 1, b * TAU / cols, TAU / cols).rotateX(-PI / 2);
        parts.push(P(ring, col, [0, Y + 0.0095, 0]));
      }
    } else if (d.town === 'harbour') {
      parts.push(dsk(R, '#2F5F70', 0), dsk(R * 0.8, '#3E7486', 1), dsk(R * 0.5, '#477F90', 2), rim(R * 0.97, 0.075, '#C9A869'), rim(R * 0.97 - 0.1, 0.03, '#9B7B49'));
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; parts.push(P(box(0.05, 0.03, 0.2), '#9B7B49', [Math.cos(a) * R * 0.97, Y + 0.05, Math.sin(a) * R * 0.97], [0, -a, 0])); }
    } else {
      const band = ['#E5574A', '#3E9BD6', '#5DB04E', '#F2B23A'][c % 4];
      parts.push(dsk(R, '#EADFCB', 0), dsk(R * 0.93, '#FFFDF7', 1), dsk(R * 0.8, band, 2), dsk(R * 0.74, '#FFFDF7', 3), dsk(R * 0.66, '#F4ECDD', 4), rim(R * 0.97, 0.07, '#FFFFFF'));
    }
  } else if (k === 'rug') {   // a market rug: body, two stripes, fringe on the short ends
    const col = RUGS[c % 4], w = 3, dd = 2;
    parts.push(mat(w, dd, 0.06, 0.012, col), P(box(w - 0.5, 0.004, 0.16), '#F4E6CC', [0, 0.014, 0.5]), P(box(w - 0.5, 0.004, 0.16), '#F4E6CC', [0, 0.014, -0.5]),
      P(box(w - 0.5, 0.004, 0.42), shade(col, -0.16), [0, 0.014, 0]));
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) parts.push(P(box(0.1, 0.006, 0.08), '#F4E6CC', [s * (w / 2 + 0.03), 0.006, -dd / 2 + (i + 0.5) * dd / 8]));
  } else if (k === 'awning') { // striped canvas laid out to dry, scalloped along one edge
    const n = 6, sw = 2.6 / n, col = RUGS[(c + 1) % 4];
    for (let i = 0; i < n; i++) {
      const x = -1.3 + (i + 0.5) * sw, hex = i % 2 ? '#F4E6CC' : col;
      parts.push(P(box(sw, 0.01, 1.2), hex, [x, 0.008, -0.08]), P(cyl(sw / 2, sw / 2, 0.01, 10), hex, [x, 0.008, 0.52]));
    }
  } else if (k === 'hop') {    // chalk hopscotch
    const line = '#F4E6CC', sq = (x, z) => [P(box(0.56, 0.004, 0.05), line, [x, 0.006, z - 0.28]), P(box(0.56, 0.004, 0.05), line, [x, 0.006, z + 0.28]),
      P(box(0.05, 0.004, 0.56), line, [x - 0.28, 0.006, z]), P(box(0.05, 0.004, 0.56), line, [x + 0.28, 0.006, z])];
    parts.push(sq(0, 1.25), sq(0, 0.7), sq(-0.3, 0.14), sq(0.3, 0.14), sq(0, -0.42), sq(-0.3, -0.98), sq(0.3, -0.98));
  } else if (k === 'bars') {   // painted lines: a crossing in Market, a dock's yellow loading bars in the Harbour
    const hb = d.town === 'harbour', n = hb ? 5 : 6, hex = hb ? '#E8B83A' : '#F4E6CC', dd = hb ? 0.9 : 1.5;
    for (let i = 0; i < n; i++) parts.push(P(box(0.24, 0.004, dd), hex, [-1.2 + (i + 0.5) * 2.4 / n, 0.006, 0]));
  } else if (k === 'rope') {   // a flat coil: rings with a tail
    for (let i = 0; i < 4; i++) parts.push(P(new T.TorusGeometry(0.18 + i * 0.15, 0.075, 5, 16).rotateX(PI / 2), i % 2 ? '#C9A869' : '#B6935A', [0, 0.05, 0], null, [1, 0.5, 1]));
    parts.push(P(box(0.62, 0.04, 0.12), '#B6935A', [0.86, 0.02, 0.2], [0, 0.4, 0]));
  } else if (k === 'net') {    // a fishing net spread to dry: diagonal cords, a float at two corners
    const hex = '#3E7F87';
    for (let i = -4; i <= 4; i++) for (const s of [-1, 1]) parts.push(P(box(2.6, 0.006, 0.04), hex, [i * 0.34 * s * 0.2, 0.008, i * 0.26], [0, s * 0.62, 0], [0.8, 1, 1]));
    parts.push(P(cyl(0.15, 0.15, 0.05, 9), '#E8824A', [-1.05, 0.03, -0.8]), P(cyl(0.15, 0.15, 0.05, 9), '#E8824A', [1.05, 0.03, 0.8]));
  } else if (k === 'hatch') {  // a deck hatch: frame, slats, a rope ring
    parts.push(mat(1.7, 1.7, 0.06, 0.012, '#7A5230'));
    for (let i = 0; i < 5; i++) parts.push(P(box(1.42, 0.006, 0.23), i % 2 ? '#B08552' : '#C09560', [0, 0.014, -0.58 + i * 0.29]));
    parts.push(P(new T.TorusGeometry(0.14, 0.03, 4, 12).rotateX(PI / 2), '#E9D9B8', [0, 0.028, 0], null, [1, 0.4, 1]));
  } else if (k === 'ring') {   // a life ring, red and cream quarters
    parts.push(P(new T.TorusGeometry(0.42, 0.15, 6, 20).rotateX(PI / 2), '#F4E6CC', [0, 0.05, 0], null, [1, 0.4, 1]));
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; parts.push(P(box(0.32, 0.03, 0.3), '#D6523F', [Math.cos(a) * 0.42, 0.075, Math.sin(a) * 0.42], [0, -a, 0])); }
  } else if (k === 'crate') {  // low slatted crate
    parts.push(P(rbox(0.8, 0.34, 0.8, 0.03, 1), '#C98B4E', [0, 0.17, 0]));
    for (const y of [0.09, 0.26]) parts.push(P(box(0.84, 0.05, 0.84), '#8E5C2C', [0, y, 0]));
    parts.push(P(box(0.66, 0.012, 0.66), '#D9A066', [0, 0.345, 0]));
  } else if (k === 'basket') { // a fish basket with its lid on: wicker bands, nothing alive in it
    parts.push(P(cyl(0.42, 0.34, 0.34, 12), '#C49A5C', [0, 0.17, 0]), P(cyl(0.44, 0.44, 0.05, 12), '#8E6A36', [0, 0.33, 0]), P(cyl(0.4, 0.4, 0.05, 12), '#3E7F87', [0, 0.37, 0]));
    parts.push(P(cyl(0.385, 0.385, 0.04, 12), '#8E6A36', [0, 0.13, 0]));
  } else throw new Error('props: no dressing ' + k);
  const g = merge(parts);
  setWhiteUV(g);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function tonesFor(base) {
  const b = lin(base);
  return (hex) => {
    const c = new T.Color(hex);       // linear
    const ch = (v, bv) => Math.round(255 * linToSrgb(Math.min(1, v / Math.max(1e-4, bv))));
    return 'rgb(' + ch(c.r, b.r) + ',' + ch(c.g, b.g) + ',' + ch(c.b, b.b) + ')';
  };
}
/**
 * 512² ground CanvasTexture for the board top (ratio image: base tone is white, see header). RepeatWrapping,
 * sRGB, flipY true (texel 32.5,32.5 and its flipped row 479.5 are white in every town). Browser only.
 */
export function groundTexture(town = 'picnic') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const x = cv.getContext('2d');
  const tone = tonesFor(GROUND_BASE[town] || GROUND_BASE.picnic);
  x.fillStyle = '#FFFFFF';
  x.fillRect(0, 0, TEX, TEX);
  if (town === 'market') {
    x.fillStyle = tone('#7D848D');   // 11-12 A1: cool grey-blue stone (was tan #8F7E65 / #A5957B / #AE9F87)
    x.fillRect(0, 0, TEX, TEX);
    const widths = [[96, 112, 80, 128, 96], [112, 96, 128, 80, 96]];
    for (let r = 0; r < 8; r++) {
      const y0 = r * 64, row = widths[r % 2], off = (r % 2) * 48;
      let xx = -off;
      for (let k = 0; xx < TEX; k++) {
        const wdt = row[k % row.length], id = r * 31 + k;
        const forced = (r === 0 || r === 7) && xx + 4 <= WHITE_PX - 4 && xx + wdt - 4 >= WHITE_PX + 4;
        const pick = hsh(id);
        x.fillStyle = forced || pick < 0.5 ? '#FFFFFF' : pick < 0.8 ? tone('#99A1AA') : tone('#A2A9B1');
        for (const dx of [0, TEX]) {
          x.beginPath();
          if (x.roundRect) x.roundRect(xx + 4 - dx, y0 + 4, wdt - 8, 56, 14); else x.rect(xx + 4 - dx, y0 + 4, wdt - 8, 56);
          x.fill();
        }
        if (!forced) {
          x.fillStyle = 'rgba(255,255,255,0.35)';
          x.beginPath(); x.ellipse(xx + wdt * 0.35, y0 + 18, wdt * 0.18, 6, 0, 0, TAU); x.fill();
        }
        xx += wdt;
      }
    }
  } else if (town === 'harbour') {
    x.fillStyle = tone('#5F4737');   // D2 (11-10): warm gaps, alternate planks, grain and nails (every tone sits under the base)
    x.fillRect(0, 0, TEX, TEX);
    for (let r = 0; r < 8; r++) {
      const y0 = r * 64, off = (r * 173) % 300, rr = r;
      for (let xx = -off; xx < TEX; xx += 300) {
        const id = rr * 17 + Math.round(xx / 300);
        const forced = (rr === 0 || rr === 7) && xx + 2 <= WHITE_PX && xx + 298 > WHITE_PX;
        for (const dx of [0, TEX]) {
          const X = xx + dx;
          x.fillStyle = forced || hsh(id) < 0.55 ? '#FFFFFF' : tone('#735844');
          x.fillRect(X + 2, y0 + 2, 296, 60);
          x.fillStyle = tone('#775742');
          x.fillRect(X + 2, y0 + 16, 296, 2);
          x.fillRect(X + 2, y0 + 47, 296, 2);
          x.fillStyle = tone('#432F27');
          for (const ny of [y0 + 12, y0 + 52]) for (const nx of [X + 12, X + 288]) { x.beginPath(); x.arc(nx, ny, 3, 0, TAU); x.fill(); }
        }
      }
    }
  } else {
    // Picnic gingham: 8 periods of 64 px (0.5 u), stripes 26 px (0.2 u) starting at 0; cream cells span 26..63
    // of each period, so (32.5, 32.5) and (32.5, 479.5) are cream (white in the ratio image).
    const per = 64, st = 26, n = TEX / per;
    x.fillStyle = tone(GINGHAM.stripe);
    for (let k = 0; k < n; k++) { x.fillRect(k * per, 0, st, TEX); x.fillRect(0, k * per, TEX, st); }
    x.fillStyle = tone(GINGHAM.cross);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) x.fillRect(i * per, j * per, st, st);
    // faint woven threads inside the stripes (never in the cream cells)
    x.fillStyle = 'rgba(120,40,30,0.07)';
    for (let k = 0; k < n; k++) for (let t = 3; t < st; t += 5) { x.fillRect(k * per + t, 0, 1, TEX); x.fillRect(0, k * per + t, TEX, 1); }
    x.fillStyle = '#FFFFFF';
  }
  // guarantee the white texels (both flipY rows)
  x.fillStyle = '#FFFFFF';
  x.fillRect(WHITE_PX - 2.5, WHITE_PX - 2.5, 5, 5);
  x.fillRect(WHITE_PX - 2.5, TEX - WHITE_PX - 2.5, 5, 5);
  const tx = new T.CanvasTexture(cv);
  tx.colorSpace = T.SRGBColorSpace;
  tx.wrapS = tx.wrapT = T.RepeatWrapping;
  tx.anisotropy = 4;
  tx.flipY = true;
  tx.needsUpdate = true;
  return tx;
}

// ---------------------------------------------------------------- markers + gull
let _pad = null;
/** Chunky gold padlock, ~0.85 u tall, facing +z, origin at its bottom centre. */
export function padlockGeometry() {
  if (_pad) return _pad;
  _pad = finish(merge([
    P(rbox(0.7, 0.55, 0.3, 0.09, 1), ngrad('#C98712', '#F5B323', '#FFD86B'), [0, 0.275, 0]),
    P(tor(0.21, 0.065, 6, 14, PI), '#B8C2D0', [0, 0.55, 0]),
    P(cyl(0.065, 0.065, 0.03, 10), '#3A2418', [0, 0.32, 0.15], [PI / 2, 0, 0]),
    P(box(0.05, 0.13, 0.03), '#3A2418', [0, 0.24, 0.15]),
  ]), null, 0);
  return _pad;
}
let _gull = null;
function buildGull() {
  const body = merge([
    P(sph(0.3, 10, 8), { v: (x, y) => (y > 0.14 ? mixC('#FFFFFF', '#C9D3E0', (y - 0.14) / 0.16) : '#FFFFFF') }, [0, 0.3, 0], null, [1, 0.85, 1.25]),
    P(cone(0.075, 0.2, 6), '#FFB13B', [0, 0.32, 0.44], [PI / 2, 0, 0]),
    P(cone(0.12, 0.22, 5), '#E8EDF2', [0, 0.36, -0.42], [-PI / 2 - 0.4, 0, 0], [1, 1, 0.35]),
    P(cyl(0.02, 0.02, 0.1, 4), '#FF9A1F', [0.09, 0.03, 0.02]),
    P(cyl(0.02, 0.02, 0.1, 4), '#FF9A1F', [-0.09, 0.03, 0.02]),
  ]);
  const wing = (s) => merge([P(sph(0.22, 8, 5), { v: (x) => mixC('#E8EDF2', '#4A5160', sat((s * x - 0.1) / 0.12)) }, [s * 0.22, 0, 0], [0, 0, s * 0.25], [1.0, 0.16, 0.55])]);
  const f = (g) => { setWhiteUV(g); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
  return { body: f(body), wingL: f(wing(1)), wingR: f(wing(-1)), pivotL: [0.2, 0.38, 0], pivotR: [-0.2, 0.38, 0] };
}
/**
 * Round toy gull (no eyes: faces only on the pot, D33), ~0.6 u long, beak toward +z. Returns the body geometry;
 * userData = { wingL, wingR, pivotL, pivotR }: wing geometries hinge at their origin (place them at the pivots
 * as child meshes and rotate about z to flap). gullGroup() builds that group.
 */
export function gullGeometry() {
  if (!_gull) _gull = buildGull();
  _gull.body.userData = { wingL: _gull.wingL, wingR: _gull.wingR, pivotL: _gull.pivotL, pivotR: _gull.pivotR, tris: _gull.body.attributes.position.count / 3 };
  return _gull.body;
}
export function gullGroup(material) {
  const body = gullGeometry(), u = body.userData, m = material || potMaterial();
  const grp = new T.Group();
  grp.add(new T.Mesh(body, m));
  const L = new T.Mesh(u.wingL, m), R = new T.Mesh(u.wingR, m);
  L.position.set(...u.pivotL); R.position.set(...u.pivotR);
  L.name = 'wingL'; R.name = 'wingR';
  grp.add(L, R);
  return grp;
}

// ---------------------------------------------------------------- twist pieces: belts, hoods, nest, splats
export const BELT_TOP = 0.06, BELT_PERIOD = 0.5;
const HOOD_HEX = { picnic: '#F5B323', market: '#2FB5A5', harbour: '#E04F4F' };
/**
 * Conveyor belt, FRESH (the caller disposes, like surfaceGeometry): runs along local +z (length d), w wide across
 * x, centred on the origin. frame: pale steel side rails with a gold top edge, end rollers, dark under-skirt and
 * feet (WHITE_UV, static layer). surface: flat strip at y = BELT_TOP, vertex colour white, uv u 0..1 across and
 * v = z / BELT_PERIOD, so beltArrowTexture() repeats along it. Returns { frame, surface, fresh: true }.
 */
export function beltGeometry(w, d, town = 'picnic') {
  // DECISION: rails are pale steel '#C9D3E0' with a gold top edge in every town (the hood carries the town colour).
  const parts = [P(box(w, 0.045, d), '#3B3646', [0, 0.0225, 0])];
  for (const s of [-1, 1]) {
    parts.push(P(rbox(0.09, 0.1, d + 0.08, 0.025, 1), grad('#9AA6B8', '#C9D3E0', 0, 0.1), [s * (w / 2 + 0.045), 0.05, 0]));
    parts.push(P(box(0.1, 0.02, d + 0.1), '#FFCF3D', [s * (w / 2 + 0.045), 0.105, 0]));
    const n = Math.max(2, Math.round(d / 0.9) + 1);
    for (let i = 0; i < n; i++) parts.push(P(box(0.15, 0.03, 0.14), '#4A4F63', [s * (w / 2 + 0.045), 0.015, -d / 2 + 0.1 + (d - 0.2) * i / (n - 1)]));
  }
  for (const e of [-1, 1]) parts.push(P(cyl(0.035, 0.035, w + 0.02, 10), '#7C8696', [0, 0.03, e * (d / 2 - 0.035)], [0, 0, PI / 2]));
  const frame = setWhiteUV(merge(parts));
  frame.computeBoundingSphere();
  frame.userData = { tris: frame.attributes.position.count / 3, h: 0.115 };
  const s0 = new T.PlaneGeometry(w, d, 1, 1); s0.rotateX(-PI / 2);
  const surface = s0.toNonIndexed(); s0.dispose();
  surface.deleteAttribute('uv');
  const p = surface.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2), c = new Float32Array(n * 3).fill(1);
  for (let i = 0; i < n; i++) { uv[i * 2] = p[i * 3] / w + 0.5; uv[i * 2 + 1] = p[i * 3 + 2] / BELT_PERIOD; p[i * 3 + 1] = BELT_TOP; }
  surface.setAttribute('color', new T.BufferAttribute(c, 3));
  surface.setAttribute('uv', new T.BufferAttribute(uv, 2));
  surface.computeBoundingSphere();
  surface.userData = { tris: 2 };
  return { frame, surface, fresh: true };
}
/** Belt arrows (browser only): 64² dark rubber with a gold chevron pointing to the canvas top (+v = travel). */
export function beltArrowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#3B3646'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#463F55'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 32, 64, 2);
  g.fillStyle = '#2E2A38'; g.fillRect(0, 0, 5, 64); g.fillRect(59, 0, 5, 64);
  g.strokeStyle = '#F5B323'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(17, 43); g.lineTo(32, 25); g.lineTo(47, 43); g.stroke();
  g.strokeStyle = 'rgba(255,240,190,0.55)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(19, 39); g.lineTo(32, 23.5); g.stroke();
  const tx = new T.CanvasTexture(cv);
  tx.colorSpace = T.SRGBColorSpace;
  tx.wrapS = tx.wrapT = T.RepeatWrapping;
  tx.anisotropy = 4;
  return tx;
}
/**
 * Belt-end hood, FRESH: a chunky toy tunnel arch over a belt of width w, opening toward -z, closed at +z, centred
 * on the origin, footprint z in [-0.22, 0.22]. Town colour outside, dark inside, cream cap and a gold lamp.
 */
export function hoodGeometry(w, town = 'picnic') {
  const hex = HOOD_HEX[town] || HOOD_HEX.picnic, W = w + 0.5, H = 0.72, wi = w + 0.26, hi = 0.52, R = 0.24, r = 0.16;
  const s = new T.Shape();
  s.moveTo(W / 2, 0); s.lineTo(W / 2, H - R); s.absarc(W / 2 - R, H - R, R, 0, PI / 2, false);
  s.lineTo(-W / 2 + R, H); s.absarc(-W / 2 + R, H - R, R, PI / 2, PI, false); s.lineTo(-W / 2, 0);
  s.lineTo(-wi / 2, 0); s.lineTo(-wi / 2, hi - r); s.absarc(-wi / 2 + r, hi - r, r, PI, PI / 2, true);
  s.lineTo(wi / 2 - r, hi); s.absarc(wi / 2 - r, hi - r, r, PI / 2, 0, true); s.lineTo(wi / 2, 0); s.lineTo(W / 2, 0);
  const inner = '#3A2F45', light = mixC(hex, '#FFFFFF', 0.25);
  const frameCol = (x, y, z, t, nx, ny, nz) => {
    if (Math.abs(ny) < 0.5 && Math.abs(nx) < 0.5) return hex;               // front and back faces (extrusion caps)
    return Math.abs(x) < wi / 2 + 1e-3 && y < hi + 1e-3 ? inner : light;   // tunnel inside vs outer shell
  };
  const parts = [
    P(slab(s, 0.44, 0, 5), frameCol, [0, 0, -0.22], [PI / 2, 0, 0]),
    P(box(wi, hi, 0.03), (x, y, z, t, nx, ny, nz) => (nz > 0.5 ? hex : inner), [0, hi / 2, 0.205]),
    // (11-04 review) the cap is the town colour with two cream trim stripes; a cream cap read as a white box from
    // the game camera. The lamp is red on Picnic's gold, gold elsewhere.
    P(rbox(W + 0.06, 0.06, 0.5, 0.025, 1), (x, y, z, t, nx, ny) => (ny > 0.5 ? hex : shade(hex, -0.12)), [0, H + 0.02, 0]),
    P(box(W + 0.07, 0.012, 0.05), '#FFF1DC', [0, H + 0.052, 0.17]), P(box(W + 0.07, 0.012, 0.05), '#FFF1DC', [0, H + 0.052, -0.17]),
    P(sph(0.07, 8, 4), town === 'picnic' ? '#E8463A' : '#FFD23F', [0, H + 0.1, 0], null, [1, 0.8, 1]),
  ];
  const g = setWhiteUV(merge(parts));
  bakeAO(g, H, 0.15);
  g.computeBoundingSphere();
  g.userData = { tris: g.attributes.position.count / 3, h: H + 0.16 };
  return g;
}
let _nest = null;
/** Gull nest (cached): a straw ring of twigs, radius 0.45, about 0.16 high, bottom at y = 0, empty (nothing living). */
export function nestGeometry() {
  if (_nest) return _nest;
  const straw = ['#C9A15E', '#B88B48', '#D9B872', '#A8793E'];
  const parts = [
    P(flat(tor(0.33, 0.1, 6, 16)), (x, y, z, t) => straw[Math.floor(hsh(t * 0.73) * 4)], [0, 0.075, 0], null, [1, 0.75, 1]),
    P(flat(new T.CircleGeometry(0.3, 12)), '#7A5230', [0, 0.03, 0]),
  ];
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12 + hsh(i) * 0.3, rr = 0.36 + 0.05 * hsh(i + 7), y = 0.08 + 0.05 * hsh(i + 3);
    parts.push(P(cyl(0.012, 0.012, 0.3, 3), i % 3 ? '#8A5A33' : '#B0814A', [Math.cos(a) * rr, y, Math.sin(a) * rr], [PI / 2 + (hsh(i + 1) - 0.5) * 0.5, -a, 0]));
  }
  _nest = finish(merge(parts), 0.45, 0.15);
  return _nest;
}
// Crack splats (cached per stack kind): unit radius, flat (y 0.004-0.03), Render scales x/z by its radius.
const SPLAT_STYLE = {
  jarstack: { pool: '#C2185B', drop: '#D81B60', shards: ['#DDF3F8', '#C9E8F0', '#E8463A'] },
  eggcrate: { pool: '#FFF8EC', yolk: '#FFB300', shards: ['#F3E3C8', '#E8D2B0', '#FFFFFF'] },
  teacups: { pool: '#9A5A2B', drop: '#8A4E24', shards: ['#FFF6E3', '#FF7FB0', '#FFC93C', '#3CC4B3'] },
  wafflestack: { pool: '#C77A1E', drop: '#B86A14', shards: ['#E8A24E', '#F2BE6A', '#D98A3E'] },
  platepile: { pool: null, shards: ['#FFF6E3', '#FFF6E3', '#7FB3E8', '#FF9FB8', '#7FD6C2'] },
};
const _splat = {};
/** Flat crack splat for a fragile stack: liquid pool + droplets + shards (china, glass, shell or waffle crumbs). */
export function splatGeometry(kindId) {
  if (_splat[kindId]) return _splat[kindId];
  const st = SPLAT_STYLE[kindId] || { pool: '#FFF6E3', shards: ['#FFF6E3'] };
  const seed = [...String(kindId)].reduce((s, ch) => s + ch.charCodeAt(0), 0), ph = hsh(seed) * TAU, parts = [];
  const blob = (r, n, y, hex, k1 = 0.16, k2 = 0.08) => {
    const g = new T.CircleGeometry(r, n), p = g.attributes.position;
    for (let i = 1; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), a = Math.atan2(yy, x), k = 0.86 + k1 * Math.sin(a * 5 + ph) + k2 * Math.sin(a * 11 + ph * 2);
      p.setXY(i, x * k, yy * k);
    }
    return P(flat(g), hex, [0, y, 0]);
  };
  if (st.pool) {
    parts.push(blob(1, 18, 0.004, st.pool));
    for (let k = 0; k < 4; k++) {
      const a = ph + k * 1.7, r = 1.08 + 0.22 * hsh(seed + k);
      parts.push(P(flat(new T.CircleGeometry(0.09 + 0.07 * hsh(seed + k * 3), 7)), st.drop || st.pool, [Math.cos(a) * r, 0.004, Math.sin(a) * r]));
    }
  } else parts.push(blob(0.9, 14, 0.004, '#EDE4D3', 0.1, 0.05));
  if (st.yolk) parts.push(blob(0.36, 12, 0.011, st.yolk, 0.06, 0.03));
  const nS = st.pool ? 7 : 11;
  for (let k = 0; k < nS; k++) {
    const a = ph * 0.7 + k * 2.39, r = 0.3 + 0.85 * hsh(seed + k * 5), sz = 0.12 + 0.12 * hsh(seed + k * 7);
    const sh = polyShape([[0, 0], [sz, sz * 0.25], [sz * 0.35, sz * (0.8 + 0.3 * hsh(k))]]);
    parts.push(P(slab(sh, 0.014), st.shards[k % st.shards.length], [Math.cos(a) * r, 0.007, Math.sin(a) * r], [0, a * 3.1, 0]));
  }
  const g = setWhiteUV(merge(parts));
  g.computeBoundingSphere();
  g.userData = { tris: g.attributes.position.count / 3, h: 0.021 };
  return (_splat[kindId] = g);
}

// ---------------------------------------------------------------- pot skins (§3.11)
export const POT_SKINS = ['sunny', 'cauldron', 'wok', 'teapot', 'ricecooker', 'dutch', 'steamer', 'royal', 'ufo', 'starladle'];
let _potMat = null, _glowMat = null;
/** Shared pot material (Lambert, vertex colours). Created once; render may replace mesh.material. */
export function potMaterial() { return _potMat || (_potMat = new T.MeshLambertMaterial({ vertexColors: true })); }
export function potGlowMaterial() { return _glowMat || (_glowMat = new T.MeshBasicMaterial({ vertexColors: true })); }

const RIM_Y = 0.03;
function rim(base, light, dark, tube = 0.11, sy = 1) {
  return P(flat(tor(1, tube, 10, 40)), ngrad(dark, base, light), [0, RIM_Y, 0], null, [1, sy, 1]);
}
function gloss(tube = 0.11, from = 1.75, len = 1.2) {
  return P(flat(tor(1, 0.028, 3, 14, len)).rotateY(from), '#FFF3C4', [0, RIM_Y + tube * 0.88, 0]);
}
/** Horizontal loop handle at side s (+1 = +x), tilted up. */
function loopHandle(s, col, R = 0.2, t = 0.06, x = 1.06, y = 0.07, tilt = 0.35) {
  const g = flat(tor(R, t, 6, 12, PI));
  g.rotateY(-s * PI / 2); g.rotateZ(s * tilt);
  return P(g, col, [s * x, y, 0]);
}
const _potGeo = new Map();
function potParts(id) {
  const body = [], extra = {};
  switch (id) {
    case 'cauldron':
      body.push(rim('#C8743A', '#E89A62', '#8A4A20', 0.15), gloss(0.15));
      [PI / 2, PI / 2 + TAU / 3, PI / 2 + 2 * TAU / 3].forEach((a) => body.push(P(sph(0.15, 8, 6), '#8A4A20', [Math.cos(a) * 1.22, 0.04, -Math.sin(a) * 1.22], null, [1.1, 0.55, 1.1])));
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; body.push(P(ico(0.03), '#8A4A20', [Math.cos(a) * 1.0, RIM_Y + 0.15, Math.sin(a) * 1.0])); }
      body.push(loopHandle(1, '#A85E2C', 0.18, 0.05), loopHandle(-1, '#A85E2C', 0.18, 0.05));
      break;
    case 'wok':
      body.push(rim('#D9412F', '#F07060', '#9A2A1E', 0.1, 0.7), gloss(0.07));
      body.push(P(lathe([[1.04, -0.02], [1.22, 0.03], [1.26, 0.07], [1.04, 0.08]], 40), ngrad('#9A2A1E', '#D9412F', '#F07060')));
      body.push(P(cyl(0.065, 0.075, 1.1, 8), grad('#7A5236', '#B07A50', -0.07, 0.07), [1.75, 0.16, 0], [0, 0, PI / 2 - 0.18]));
      body.push(P(cyl(0.085, 0.085, 0.14, 8), '#5A5A66', [1.24, 0.09, 0], [0, 0, PI / 2 - 0.18]));
      body.push(loopHandle(-1, '#9A2A1E', 0.13, 0.035, 1.18, 0.06, 0.2));
      break;
    case 'teapot': {
      body.push(rim('#2FB5A5', '#6FD8CA', '#1E7F74', 0.12), gloss(0.12));
      for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + 0.1; body.push(P(ico(0.04), '#FFF1DC', [Math.cos(a) * 1.0, RIM_Y + 0.105, Math.sin(a) * 1.0], null, [1, 0.5, 1])); }
      const sp = new T.QuadraticBezierCurve3(V3(1.02, 0.06, -0.35), V3(1.5, 0.1, -0.5), V3(1.62, 0.5, -0.62));
      body.push(P(ttube(sp, 8, 0.14, 8, (t) => 1 - 0.55 * t), '#2FB5A5'));
      body.push(P(tor(0.32, 0.065, 6, 14, PI * 1.15), '#2FB5A5', [-1.18, 0.22, 0.3], [0, PI / 2, PI * 0.45]));
      const lid = [P(lathe([[0, 0], [0.42, 0], [0.4, 0.04], [0.26, 0.1], [0, 0.12]], 14), ngrad('#1E7F74', '#2FB5A5', '#6FD8CA')), P(ico(0.08, 1), '#FFF1DC', [0, 0.15, 0])];
      xf(lid, [0.5, 0, 0], [0.35, 0.2, -1.32]);
      body.push(...lid);
      break;
    }
    case 'ricecooker': {
      body.push(rim('#FFF1DC', '#FFFFFF', '#CDBFA8', 0.13), gloss(0.13));
      const lid = [P(lathe([[0, 0], [0.62, 0], [0.6, 0.05], [0.4, 0.13], [0, 0.15]], 18), ngrad('#CDBFA8', '#FFF1DC', '#FFFFFF')), P(cyl(0.63, 0.63, 0.04, 18), '#9AA3B5', [0, 0.02, 0])];
      xf(lid, [0.55, 0, 0], [0, 0.26, -1.55]);
      body.push(P(rbox(0.5, 0.12, 0.16, 0.04, 1), '#9AA3B5', [0, 0.04, -1.08]));
      body.push(...lid);
      body.push(P(rbox(0.36, 0.14, 0.18, 0.04, 1), '#C9D3E0', [1.12, 0.08, 0.28], [0, -0.3, 0]));
      extra.lights = [P(ico(0.045), '#4CC26A', [1.1, 0.16, 0.32]), P(ico(0.045), '#E5483B', [1.2, 0.16, 0.24])];
      break;
    }
    case 'dutch': {
      body.push(rim('#8FE3C8', '#C8F5E6', '#4FA88C', 0.12), gloss(0.12));
      const lid = [P(lathe([[0, 0], [0.62, 0], [0.6, 0.05], [0.35, 0.11], [0, 0.12]], 18), ngrad('#4FA88C', '#8FE3C8', '#C8F5E6')), P(cyl(0.1, 0.13, 0.09, 8), '#3A2418', [0, 0.16, 0])];
      xf(lid, [0.45, 0, 0], [0, 0.24, -1.6]);
      body.push(...lid);
      [-1, 1].forEach((s) => body.push(P(rbox(0.28, 0.1, 0.36, 0.05, 1), '#4FA88C', [s * 1.16, 0.06, 0])));
      break;
    }
    case 'steamer': {
      body.push(rim('#D9B36B', '#F0D59A', '#9A7A3E', 0.14), gloss(0.14));
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + TAU / 16;
        const g = tor(0.155, 0.022, 4, 12);
        g.rotateY(PI / 2 - a);
        body.push(P(g, '#9A6A45', [Math.cos(a) * 1.0, RIM_Y, -Math.sin(a) * 1.0]));
      }
      // second bamboo band just outside the rim (a stacked steamer tier), no lid: stays low
      body.push(P(flat(tor(1.13, 0.06, 4, 32)), (x, y, z, t) => (Math.floor(t / 8) % 2 ? '#C9A35B' : '#E2C27E'), [0, 0.0, 0]));
      break;
    }
    case 'royal': {
      body.push(rim('#FFD23F', '#FFF0A0', '#C99A12', 0.12), gloss(0.12));
      const gems = ['#E5483B', '#4E5FD1', '#4CC26A'];
      const spark = [];
      for (let i = 0; i < 10; i++) {
        const a = PI / 2 + (i - 4.5) * 0.52;          // skip the front (+z) arc where the eyes sit
        if (Math.abs(Math.sin(a) - 1) < 1e-6) continue;
        const x = Math.cos(a), z = -Math.sin(a);
        if (z > 0.5) continue;
        body.push(P(cone(0.09, 0.26, 6), '#FFD23F', [x * 1.0, RIM_Y + 0.22, z * 1.0]));
        body.push(P(ico(0.045), gems[i % 3], [x * 1.06, RIM_Y + 0.12, z * 1.06]));
        spark.push(P(new T.OctahedronGeometry(0.05), '#FFFFFF', [x, RIM_Y + 0.39, z], null, [0.6, 1.4, 0.6]));
      }
      extra.sparkle = spark;
      body.push(loopHandle(1, '#E8B820'), loopHandle(-1, '#E8B820'));
      break;
    }
    case 'ufo': {
      body.push(rim('#C9D3E0', '#F2F6FA', '#7C8696', 0.1), gloss(0.1));
      body.push(P(lathe([[1.05, -0.02], [1.6, -0.04], [1.66, 0.0], [1.62, 0.05], [1.35, 0.08], [1.02, 0.02]], 40), ngrad('#7C8696', '#C9D3E0', '#F2F6FA')));
      const A = [], Bl = [];
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + TAU / 16;
        (i % 2 ? Bl : A).push(P(ico(0.065, 1), i % 2 ? '#5BC0EB' : '#FFD23F', [Math.cos(a) * 1.42, 0.1, Math.sin(a) * 1.42]));
      }
      extra.lightsA = A; extra.lightsB = Bl;
      break;
    }
    case 'starladle': {
      body.push(rim('#2B3A8C', '#5566C2', '#17205A', 0.12), gloss(0.12));
      for (let i = 0; i < 7; i++) {
        const a = PI / 2 + (i - 3) * 0.62, x = Math.cos(a), z = -Math.sin(a);
        body.push(P(slab(starShape(5, 0.11, 0.05), 0.035), '#FFC93C', [x * 1.04, RIM_Y + 0.17, z * 1.04], [PI / 2 - 0.5, 0, 0]).rotateY(0));
      }
      const ladle = [P(cyl(0.035, 0.035, 1.3, 6), '#FFC93C', [0, 0.65, 0]), P(sph(0.22, 10, 6), '#FFC93C', [0, 0.0, 0], null, [1, 0.6, 1]), P(slab(starShape(5, 0.16, 0.07), 0.04), '#FFE08A', [0, 1.36, 0.0], [PI / 2, 0, 0])];
      xf(ladle, [0.45, 0, -0.35], [0.75, 0.25, -0.85]);
      body.push(...ladle);
      break;
    }
    default: // sunny
      body.push(rim('#F5B323', '#FFD86B', '#C98712'), gloss());
      body.push(loopHandle(1, '#F0AA1C'), loopHandle(-1, '#F0AA1C'));
      [1, -1].forEach((s) => [-1, 1].forEach((t) => body.push(P(ico(0.04), '#B9770E', [s * 1.07, 0.08, t * 0.2]))));
  }
  return { body, extra };
}
// DECISION (11-07 Sat, r4, Gild): a gilded pot gets a fat gold rim, eight gold studs round it and every body colour pulled 30 % toward gold.
// It is its own cached geometry (key id + '+g'), so a plain pot costs nothing extra and no skin's parts change.
const GILD_COL = [1, 0.79, 0.29];
function gildTint(g) {
  const c = g.attributes.color; if (!c) return g;
  const a = c.array;
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) a[i + k] += (GILD_COL[k] - a[i + k]) * 0.3;
  c.needsUpdate = true;
  return g;
}
function potGeoFor(id, gilded = false) {
  const key = gilded ? id + '+g' : id;
  let e = _potGeo.get(key);
  if (e) return e;
  const { body, extra } = potParts(id);
  const done = (g) => { setWhiteUV(g); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData = { tris: g.attributes.position.count / 3 }; return g; };
  if (gilded) {
    body.push(rim('#FFC93C', '#FFE88A', '#B8800F', 0.17));
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; body.push(P(sph(0.06, 6, 4), '#FFE88A', [Math.cos(a) * 1.0, RIM_Y + 0.17, Math.sin(a) * 1.0])); }
  }
  const bg = merge(body);
  e = { body: done(gilded ? gildTint(bg) : bg), extra: {} };
  for (const k of Object.keys(extra)) e.extra[k] = done(merge(extra[k]));
  _potGeo.set(key, e);
  return e;
}
/**
 * Pot rim group for a skin (§3.11, §7.3): unit radius (rim torus radius 1, tube ~0.11), sits on y = 0, eyes go
 * on the front (+z) rim, so decorations stay at the back and sides. ≤ 3 meshes: 'body' plus optional animated
 * children: 'lights' (ricecooker, blink), 'lightsA'/'lightsB' (ufo, alternate blink), 'sparkle' (royal, twinkle).
 * Geometries and materials are shared/cached; render scales the group by rVis.
 */
export function potGroup(skinId = 'sunny', gilded = false) {
  const id = POT_SKINS.indexOf(skinId) >= 0 ? skinId : 'sunny';
  const e = potGeoFor(id, !!gilded), g = new T.Group();
  const body = new T.Mesh(e.body, potMaterial());
  body.name = 'body';
  g.add(body);
  for (const k of Object.keys(e.extra)) {
    const m = new T.Mesh(e.extra[k], potGlowMaterial());
    m.name = k;
    g.add(m);
  }
  g.name = 'pot-' + id;
  g.userData.skin = id;
  g.userData.gilded = !!gilded;
  return g;
}
