// Slurp Pot: R8 floor dressing, as a plain list both renderers draw (render3d into the one static mesh, render2d into the
// baked ground). Pure data: no three.js, no sim, and it never touches createWorld, so Dailies and Feast keep their layouts.
// Everything on the open floor is flat, because the pot rolls over it. The two low props (crate, basket) stay in the edge
// band and clear of every item, so nothing that looks solid ever sits in the pot's way. No living animals.

const rng = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

// [kind, weight, half width, half depth]: footprint before the turn
const TABLE = {
  market: [['rug', 3, 1.5, 1], ['awning', 2, 1.3, 0.7], ['hop', 2, 0.65, 1.6], ['bars', 2, 1.3, 0.8]],
  harbour: [['rope', 3, 0.75, 0.75], ['net', 3, 1.3, 1], ['hatch', 2, 0.85, 0.85], ['bars', 2, 1.3, 0.5], ['ring', 2, 0.6, 0.6]],
};
const RAISED = { market: ['crate'], harbour: ['crate', 'basket'] };
export const RUGS = ['#8A6AA8', '#4E9E94', '#C9685A', '#D9A441'];   // muted, so food stays the loudest thing on them

export function dressLayout(L, town, low) {
  const out = [];
  for (const p of L.piles || []) out.push({ k: 'mat', x: +p.x, z: +p.z, r: +p.r + 0.35, rot: 0, c: 0, town });
  const T = TABLE[town];
  if (!T) return out;
  const W = +L.W || 10, D = +L.D || 10;
  const x0 = L.x0 ?? -W / 2, x1 = L.x1 ?? W / 2, z0 = L.z0 ?? -D / 2, z1 = L.z1 ?? D / 2;
  const R = rng(hash('dress' + (L.n ?? L.id ?? '') + town + (L.seed ?? '')));
  const clearRects = [];
  for (const s of L.surfaces || []) {
    const cr = Math.abs(Math.cos(s.rot || 0)), sr = Math.abs(Math.sin(s.rot || 0));
    clearRects.push([s.x, s.z, ((+s.w || 1) * cr + (+s.d || 1) * sr) / 2, ((+s.w || 1) * sr + (+s.d || 1) * cr) / 2]);
  }
  for (const b of L.belts || []) {
    const c = Math.abs(Math.cos(b.rot || 0)), s = Math.abs(Math.sin(b.rot || 0)), w = +b.w || 4, d = +b.d || 1.4;
    clearRects.push([b.x, b.z, (w * c + d * s) / 2, (w * s + d * c) / 2]);
  }
  const placed = out.map(o => [o.x, o.z, o.r]);
  const free = (x, z, r) => {
    for (const [a, b, hx, hz] of clearRects) if (Math.abs(x - a) < hx + r && Math.abs(z - b) < hz + r) return false;
    for (const [a, b, q] of placed) if (Math.hypot(x - a, z - b) < q + r + 0.7) return false;
    return true;
  };
  const want = Math.round(Math.max(8, Math.min(28, W * D / 34)) * (low ? 0.5 : 1));
  const sum = T.reduce((a, t) => a + t[1], 0);
  let flat = 0;
  for (let tr = 0; tr < want * 30 && flat < want; tr++) {
    let pick = R() * sum, t = T[0];
    for (const e of T) { pick -= e[1]; if (pick <= 0) { t = e; break; } }
    const r = Math.hypot(t[2], t[3]), x = x0 + r + R() * (x1 - x0 - 2 * r), z = z0 + r + R() * (z1 - z0 - 2 * r);
    const rot = t[0] === 'rope' || t[0] === 'ring' ? 0 : (R() < 0.5 ? 0 : Math.PI / 2) + (R() - 0.5) * 0.3, c = (R() * 4) | 0;
    if (!free(x, z, r)) continue;
    placed.push([x, z, r]); flat++;
    out.push({ k: t[0], x, z, r, rot, c, town });
  }
  const items = L.items || [], kinds = RAISED[town];
  const wantR = Math.round(want / 4);
  let raised = 0;
  for (let tr = 0; tr < wantR * 40 && raised < wantR; tr++) {
    const side = (R() * 3) | 0, band = 0.55 + R() * 0.7, along = R();   // far edge and both flanks, never the near edge
    const x = side === 0 ? x0 + band : side === 1 ? x1 - band : x0 + 1 + along * (x1 - x0 - 2);
    const z = side === 2 ? z0 + band : z0 + 1 + along * (z1 - z0 - 2);
    if (!free(x, z, 0.5) || items.some(i => Math.hypot(i.x - x, i.z - z) < (+i.a || 0.3) + 0.8)) continue;
    placed.push([x, z, 0.5]); raised++;
    out.push({ k: kinds[(R() * kinds.length) | 0], x, z, r: 0.5, rot: R() * 6.283, c: (R() * 4) | 0, town });
  }
  return out;
}
