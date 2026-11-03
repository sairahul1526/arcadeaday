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

const PI = Math.PI, TAU = PI * 2;

// ---------------------------------------------------------------- ground constants
export const GROUND_TILE = 4.0;                               // world units per texture repeat (gingham period 0.5 u)
const TEX = 512, WHITE_PX = 32.5;                              // texel that is white in every town's ground
// White at canvas (32.5, 32.5) and at its flipY mirror row 479.5, so it holds whatever flipY render uses.
export const WHITE_UV = [WHITE_PX / TEX, WHITE_PX / TEX];
export const GROUND_BASE = { picnic: '#FFF1DC', market: '#D9C6A5', harbour: '#C99A63' };
// Gingham tones (sRGB) and relative luminance, for the Levels contrast rule (§4.2).
export const GINGHAM = { cream: '#FFF1DC', stripe: '#F4A493', cross: '#E8574A', lum: { cream: 0.893, stripe: 0.478, cross: 0.245 } };

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
/** Recentre on the footprint, sit on y = 0, normalise footprint to `a`, bake AO, add uv, record stats. */
function finish(g, a, ao = 0.2) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const p = g.attributes.position.array;
  let fp = 0;
  for (let i = 0; i < p.length; i += 3) fp = Math.max(fp, Math.hypot(p[i], p[i + 2]));
  if (a) { const s = a / fp; g.scale(s, s, s); fp = a; }
  g.computeBoundingBox();
  const H = g.boundingBox.max.y;
  if (ao > 0) {
    const c = g.attributes.color.array, range = Math.min(0.45, Math.max(0.03, 0.35 * H));
    for (let i = 0; i < p.length; i += 3) {
      const t = 1 - sat(p[i + 1] / range), f = 1 - ao * t * t;
      c[i] *= f; c[i + 1] *= f; c[i + 2] *= f;
    }
  }
  setWhiteUV(g);
  g.computeBoundingSphere();
  g.userData = { tris: p.length / 9, fp, h: H };
  return g;
}

// ---------------------------------------------------------------- shared little pieces
const HL = (r, pos) => P(ico(r), '#FFFFFF', pos, null, [1, 0.6, 1]);          // painted gloss dot (toy sheen)
const leaf = (r, pos, rot, hex = '#5FB54A') => P(ico(r), hex, pos, rot, [1.5, 0.32, 0.75]);
const stemP = (h, pos, rot, hex = '#6B4A2B', r = 0.009) => P(cyl(r * 0.8, r, h, 4), hex, pos, rot);
const starCap = (ro, ri, d, pos, hex = '#3FA34D') => P(slab(starShape(5, ro, ri), d), hex, pos);

// ---------------------------------------------------------------- builders: shared T0 crumbs
const B = {};
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
B.pinwheel = () => {
  const parts = [P(cyl(0.016, 0.02, 0.4, 6), (x, y) => (Math.floor((y + 0.2) / 0.08) % 2 ? '#FFFFFF' : '#2FB5A5'), [0, 0.2, 0])];
  parts.push(P(cyl(0.06, 0.09, 0.05, 8), '#FFF1DC', [0, 0.025, 0]));
  const blade = ['#2FB5A5', '#FFC93C', '#FF7A59', '#FFFFFF'];
  const wheel = [];
  for (let i = 0; i < 4; i++) {
    const g = slab(polyShape([[0, 0], [0.24, 0.02], [0.05, 0.22]], 0.015), 0.012);
    wheel.push(P(g, blade[i], null, [0, 0, 0]).rotateY(i * PI / 2));
  }
  wheel.push(P(ico(0.035), '#FFD23F', [0, 0.015, 0]));
  // wheel lies in the xz plane: tilt it up 50° to face the sky and the camera
  xf(wheel, [0.9, 0, 0], [0, 0.42, 0.02]);
  return parts.concat(wheel);
};
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
  // round teal tray with three coloured teacups of tea (reads from above: coloured rims, brown tea)
  const parts = [P(lathe([[0, 0], [0.4, 0], [0.46, 0.05], [0.44, 0.06], [0, 0.03]], 10), (x, y) => (y > 0.035 ? '#3CC4B3' : '#23968A'))];
  [['#FF7FB0', 0.4], ['#FFC93C', 2.5], ['#FFFFFF', 4.6]].forEach(([c, a]) => {
    const x = Math.cos(a) * 0.22, z = Math.sin(a) * 0.22;
    parts.push(P(lathe([[0, 0], [0.07, 0], [0.11, 0.1], [0.125, 0.12], [0.105, 0.12], [0, 0.085]], 7),
      (px, py, pz, t, nx, ny, nz) => (nx * px + nz * pz < 0 || ny > 0.6 ? '#FFF6E3' : c), [x, 0.03, z]));
    parts.push(P(flat(new T.CircleGeometry(0.1, 8)), '#9A5A2B', [x, 0.135, z]));
    const h = tor(0.04, 0.014, 3, 4, PI);
    h.rotateZ(-PI / 2); h.rotateY(-a);
    parts.push(P(h, c, [x + Math.cos(a) * 0.12, 0.1, z + Math.sin(a) * 0.12]));
  });
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
B.parasol = () => [
  P(lathe([[0.04, 1.6], [0.6, 1.46], [0.9, 1.36], [0.95, 1.38], [0.7, 1.53], [0.35, 1.69], [0, 1.76]], 16),
    (x, y, z, t, nx, ny) => {
      const s = Math.floor(az(x, z) / (TAU / 8)) % 2;
      return ny < 0 ? (s ? '#D9D2C8' : '#D95050') : (s ? '#FFFFFF' : '#FF6B6B');
    }),
  P(cyl(0.025, 0.025, 1.7, 6), '#F4F4F4', [0, 0.88, 0]),
  P(ico(0.045), '#FF6B6B', [0, 1.79, 0]),
  P(cyl(0.18, 0.22, 0.08, 10), '#4A4F63', [0, 0.04, 0]),
];
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
      parts.push(P(cyl(0.04, 0.04, 1.7, 6), red, [x, 0.8, s * 0.24], [s * 0.3, 0, 0]));
      parts.push(P(ico(0.06), '#FFC93C', [x, 0.03, s * 0.48]));
    });
  });
  parts.push(P(cyl(0.045, 0.045, 2.3, 8), red, [0, 1.62, 0], [0, 0, PI / 2]));
  [-0.48, 0.48].forEach((x) => {
    parts.push(P(rbox(0.32, 0.045, 0.16, 0.018, 1), '#FFC93C', [x, 0.42, 0]));
    [-0.13, 0.13].forEach((dx) => parts.push(P(cyl(0.009, 0.009, 1.18, 4), '#9AA3B5', [x + dx, 1.02, 0])));
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
  g = finish(merge(build ? build() : fallback(k || { a: a || 0.3, h: 0.3, color: '#C9D3E0' })), a);
  g.userData.kind = kindId;
  g.userData.built = !!build;
  _geo.set(kindId, g);
  return g;
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
  market: { blanket: '#2FB5A5', path: '#C2AC88', rug: '#7A4C9E', deck: '#C99A63', water: '#2AA7C9' },
  harbour: { blanket: '#F6ECD6', path: '#A87A47', rug: '#F6ECD6', deck: '#E8FBFF', water: '#2AA7C9' },
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
    parts.push(P(slab(rrShape(w, d, Math.min(w, d) / 2), 0.016, 0, 6), col));
    const n = Math.max(2, Math.round((w * d) / 0.9));
    for (let i = 0; i < n; i++) {
      const x = (hsh(i * 3 + 1) - 0.5) * (w - 0.3), z = (hsh(i * 3 + 2) - 0.5) * (d - 0.3), r = 0.05 + 0.05 * hsh(i * 3 + 3);
      parts.push(P(cyl(r, r, 0.006, 7), shade(col, i % 2 ? 0.18 : -0.1), [x, 0.018, z], null, [1.3, 1, 1]));
    }
  } else if (type === 'water') {
    parts.push(P(slab(rrShape(w, d, Math.min(0.4, Math.min(w, d) / 3)), 0.006, 0, 6), col));
    frame(0.06, 0.07, '#E8FBFF', 0.009);
  } else if (type === 'deck') {
    const pw = 0.28, n = Math.max(1, Math.round(d / pw));
    for (let i = 0; i < n; i++) parts.push(P(rbox(w, 0.03, d / n - 0.02, 0.012, 1), shade(col, i % 2 ? -0.08 : 0), [0, 0.006, -d / 2 + (i + 0.5) * d / n]));
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
    x.fillStyle = tone('#A8916E');
    x.fillRect(0, 0, TEX, TEX);
    const widths = [[96, 112, 80, 128, 96], [112, 96, 128, 80, 96]];
    for (let r = 0; r < 8; r++) {
      const y0 = r * 64, row = widths[r % 2], off = (r % 2) * 48;
      let xx = -off;
      for (let k = 0; xx < TEX; k++) {
        const wdt = row[k % row.length], id = r * 31 + k;
        const forced = (r === 0 || r === 7) && xx + 4 <= WHITE_PX - 4 && xx + wdt - 4 >= WHITE_PX + 4;
        const pick = hsh(id);
        x.fillStyle = forced || pick < 0.5 ? '#FFFFFF' : pick < 0.8 ? tone('#C2AC88') : tone('#CDB896');
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
    x.fillStyle = tone('#7A5230');
    x.fillRect(0, 0, TEX, TEX);
    for (let r = 0; r < 8; r++) {
      const y0 = r * 64, off = (r * 173) % 300, rr = r;
      for (let xx = -off; xx < TEX; xx += 300) {
        const id = rr * 17 + Math.round(xx / 300);
        const forced = (rr === 0 || rr === 7) && xx + 2 <= WHITE_PX && xx + 298 > WHITE_PX;
        for (const dx of [0, TEX]) {
          const X = xx + dx;
          x.fillStyle = forced || hsh(id) < 0.55 ? '#FFFFFF' : tone('#A87A47');
          x.fillRect(X + 2, y0 + 2, 296, 60);
          x.fillStyle = tone('#B88A55');
          x.fillRect(X + 2, y0 + 16, 296, 2);
          x.fillRect(X + 2, y0 + 47, 296, 2);
          x.fillStyle = tone('#6B4628');
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
function potGeoFor(id) {
  let e = _potGeo.get(id);
  if (e) return e;
  const { body, extra } = potParts(id);
  const done = (g) => { setWhiteUV(g); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData = { tris: g.attributes.position.count / 3 }; return g; };
  e = { body: done(merge(body)), extra: {} };
  for (const k of Object.keys(extra)) e.extra[k] = done(merge(extra[k]));
  _potGeo.set(id, e);
  return e;
}
/**
 * Pot rim group for a skin (§3.11, §7.3): unit radius (rim torus radius 1, tube ~0.11), sits on y = 0, eyes go
 * on the front (+z) rim, so decorations stay at the back and sides. ≤ 3 meshes: 'body' plus optional animated
 * children: 'lights' (ricecooker, blink), 'lightsA'/'lightsB' (ufo, alternate blink), 'sparkle' (royal, twinkle).
 * Geometries and materials are shared/cached; render scales the group by rVis.
 */
export function potGroup(skinId = 'sunny') {
  const id = POT_SKINS.indexOf(skinId) >= 0 ? skinId : 'sunny';
  const e = potGeoFor(id), g = new T.Group();
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
  return g;
}
