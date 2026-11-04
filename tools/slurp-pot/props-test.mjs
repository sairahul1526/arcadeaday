// Slurp Pot props test (Art role): every catalog kind and decor id builds with a real builder (no fallback blobs),
// footprint within ±5 % of catalog `a`, tri caps per tier (GDD §13.7), the shared four-attribute set, bottom on
// y = 0, no NaN, an icon file in games/slurp-pot/art for every ingredient and boss. Also builds the pot skins, board,
// surfaces, padlock, gull, wedding-cake tiers, spin parts, belts, hoods, nest, splats and checks stack top/slots.
// Node only (no DOM): groundTexture and beltArrowTexture are skipped.
// Run: node tools/slurp-pot/props-test.mjs [--list]
import { KINDS } from '../../games/slurp-pot/catalog.js';
import * as PR from '../../games/slurp-pot/props.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ART = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'games/slurp-pot/art');

const list = process.argv.includes('--list');
let fail = 0, built = 0, fb = 0;
const err = (m) => { fail++; console.log('  FAIL ' + m); };
const ATTR = ['position', 'normal', 'color', 'uv'];

function checkGeo(name, g, cap) {
  const keys = Object.keys(g.attributes).sort();
  if (keys.join() !== [...ATTR].sort().join()) err(`${name}: attributes ${keys.join()}`);
  if (g.index) err(`${name}: indexed`);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { err(`${name}: non-finite position`); break; }
  const c = g.attributes.color.array;
  for (let i = 0; i < c.length; i++) if (!(c[i] >= 0 && c[i] <= 1.0001)) { err(`${name}: colour out of range ${c[i]}`); break; }
  const tris = g.attributes.position.count / 3;
  if (cap && tris > cap) err(`${name}: ${tris} tris > cap ${cap}`);
  return tris;
}

const byTier = {};
for (const k of KINDS) {
  const g = PR.geometryFor(k.id);
  const cap = PR.triCap(k.id);
  const tris = checkGeo(k.id, g, cap);
  const fp = g.userData.fp;
  // measure the footprint independently of userData
  const p = g.attributes.position.array;
  let r = 0, minY = Infinity;
  for (let i = 0; i < p.length; i += 3) { r = Math.max(r, Math.hypot(p[i], p[i + 2])); minY = Math.min(minY, p[i + 1]); }
  if (Math.abs(r - k.a) > 0.05 * k.a) err(`${k.id}: footprint ${r.toFixed(3)} vs a ${k.a} (fp ${fp})`);
  if (Math.abs(minY) > 1e-4) err(`${k.id}: min y ${minY}`);
  if (PR.geometryFor(k.id) !== g) err(`${k.id}: not cached`);
  const t = k.boss ? 'boss' : 'T' + k.tier;
  (byTier[t] = byTier[t] || []).push(tris);
  if (PR.hasBuilder(k.id)) built++; else { fb++; err(`${k.id}: no builder (fallback blob)`); }
  if ((k.ing || k.boss) && !['webp', 'png'].some((e) => existsSync(join(ART, `${k.icon || k.id}.${e}`)))) err(`${k.id}: no icon art/${k.icon || k.id}.webp`);
  if (list) console.log(`${k.id.padEnd(20)} ${t.padEnd(5)} a ${String(k.a).padEnd(5)} fp ${r.toFixed(3)} h ${g.userData.h.toFixed(2).padStart(5)} tris ${String(tris).padStart(5)} / ${cap}${PR.hasBuilder(k.id) ? '' : '  (fallback)'}`);
}
for (const d of PR.DECOR_KINDS) {
  const g = PR.geometryFor(d);
  const tris = checkGeo(d, g, 300);
  (byTier.decor = byTier.decor || []).push(tris);
  if (list) console.log(`${d.padEnd(20)} decor fp ${g.userData.fp.toFixed(3)} tris ${tris} / 300`);
}

// pot skins: ≤ 3 meshes, unit rim radius
for (const s of PR.POT_SKINS) {
  const grp = PR.potGroup(s);
  if (grp.children.length > 3) err(`pot ${s}: ${grp.children.length} meshes`);
  let tris = 0;
  for (const m of grp.children) tris += checkGeo('pot ' + s + '/' + m.name, m.geometry, 0);
  if (tris > 2500) err(`pot ${s}: ${tris} tris`);
  if (list) console.log(`pot ${s.padEnd(16)} meshes ${grp.children.length} tris ${tris}`);
}
// board, surfaces, markers, gull, tiers
const board = PR.boardGeometry(9, 14, 'picnic');
checkGeo('board', board, 0);
board.computeBoundingBox();
if (Math.abs(board.boundingBox.max.y) > 1e-4 || Math.abs(board.boundingBox.min.y + 0.5) > 1e-4) err('board: top/bottom not 0/-0.5');
for (const t of ['blanket', 'path', 'rug', 'deck', 'water']) {
  const g = PR.surfaceGeometry(t, 2.4, 1.6);
  checkGeo('surface ' + t, g, 0);
  g.computeBoundingBox();
  if (g.boundingBox.max.y > 0.04) err(`surface ${t}: top ${g.boundingBox.max.y}`);
}
checkGeo('padlock', PR.padlockGeometry(), 600);
const gull = PR.gullGeometry();
checkGeo('gull', gull, 600);
checkGeo('gull wingL', gull.userData.wingL, 0);
if (PR.gullGroup().children.length !== 3) err('gullGroup: children');
let tierTris = 0;
for (let t = 0; t < 3; t++) {
  const g = PR.bossTierGeometry('boss-weddingcake', t);
  tierTris += checkGeo('weddingcake tier ' + t, g, 0);
  if (Math.abs(g.userData.fp - 1) > 1e-3) err('tier fp');
}
if (tierTris > 2500) err(`weddingcake tiers: ${tierTris} tris together > 2500`);
if (list) console.log(`weddingcake tiers   ${tierTris} tris together`);

// spin parts: base + blade in the geometryFor frame, blade origin at the pivot, unit axis
const geoTris = (g) => g.attributes.position.count / 3;
for (const id of PR.SPIN_KINDS) {
  const sp = PR.spinParts(id), full = PR.geometryFor(id);
  if (!sp) { err(`spinParts ${id}: null`); continue; }
  checkGeo(`spin ${id} base`, sp.base, 0); checkGeo(`spin ${id} blade`, sp.blade, 0);
  if (geoTris(sp.base) + geoTris(sp.blade) !== geoTris(full)) err(`spin ${id}: base+blade tris ${geoTris(sp.base) + geoTris(sp.blade)} != ${geoTris(full)}`);
  if (Math.abs(Math.hypot(...sp.axis) - 1) > 1e-3) err(`spin ${id}: axis not unit`);
  if (!(sp.rate > 0) || sp.pivot.length !== 3 || !sp.pivot.every(Number.isFinite)) err(`spin ${id}: pivot/rate`);
  if (!full.userData.spin) err(`spin ${id}: geometryFor userData.spin`);
  if (PR.spinParts(id) !== sp) err(`spin ${id}: not cached`);
  if (list) console.log(`spin ${id.padEnd(15)} base ${geoTris(sp.base)} blade ${geoTris(sp.blade)} pivot ${sp.pivot.map((v) => v.toFixed(2)).join(',')} axis ${sp.axis.map((v) => v.toFixed(2)).join(',')} rate ${sp.rate}`);
}
if (PR.spinParts('apple') !== null) err('spinParts(apple) should be null');
// fragile stacks: top (y of the top surface) and 1-3 slots inside the footprint
for (const id of ['teacups', 'platepile', 'jarstack', 'eggcrate', 'wafflestack']) {
  const g = PR.geometryFor(id), u = g.userData, a = PR.geometryFor(id).userData.fp;
  if (!(u.top > 0 && u.top <= u.h + 1e-6)) err(`${id}: userData.top ${u.top} (h ${u.h})`);
  if (!Array.isArray(u.slots) || u.slots.length < 1 || u.slots.length > 3) err(`${id}: slots`);
  else for (const [x, z] of u.slots) if (!(Math.hypot(x, z) < a)) err(`${id}: slot outside footprint`);
  if (list) console.log(`stack ${id.padEnd(14)} top ${u.top.toFixed(3)} / h ${u.h.toFixed(3)} slots ${u.slots.map(([x, z]) => `(${x.toFixed(2)},${z.toFixed(2)})`).join(' ')}`);
}
// belts (fresh), hoods (fresh), nest (cached), splats (cached)
for (const town of ['picnic', 'market', 'harbour']) {
  const b = PR.beltGeometry(1.4, 4, town);
  if (!b.fresh) err('belt: fresh flag');
  checkGeo('belt frame ' + town, b.frame, 1200); checkGeo('belt surface ' + town, b.surface, 0);
  const sp = b.surface.attributes.position.array, uv = b.surface.attributes.uv.array;
  for (let i = 0; i < sp.length / 3; i++) {
    if (Math.abs(sp[i * 3 + 1] - PR.BELT_TOP) > 1e-6) { err('belt surface: y != BELT_TOP'); break; }
    if (Math.abs(uv[i * 2 + 1] - sp[i * 3 + 2] / PR.BELT_PERIOD) > 1e-5 || uv[i * 2] < -1e-6 || uv[i * 2] > 1 + 1e-6) { err('belt surface: uv'); break; }
  }
  if (PR.beltGeometry(1.4, 4, town).frame === b.frame) err('belt: not fresh');
  const h = PR.hoodGeometry(1.4, town);
  checkGeo('hood ' + town, h, 600);
  h.computeBoundingBox();
  const hb = h.boundingBox;
  if (hb.min.z < -0.261 || hb.max.z > 0.261 || Math.abs(hb.min.y) > 1e-4 || hb.max.x - hb.min.x < 1.4 + 0.2) err(`hood ${town}: bounds z ${hb.min.z.toFixed(3)}..${hb.max.z.toFixed(3)} x ${(hb.max.x - hb.min.x).toFixed(2)}`);
  if (list) console.log(`belt ${town.padEnd(8)} frame ${geoTris(b.frame)} tris · hood ${geoTris(h)} tris h ${hb.max.y.toFixed(2)}`);
}
const nest = PR.nestGeometry();
checkGeo('nest', nest, 600);
if (PR.nestGeometry() !== nest) err('nest: not cached');
if (Math.abs(nest.userData.fp - 0.45) > 1e-3 || nest.userData.h > 0.22 || nest.userData.h < 0.1) err(`nest: fp ${nest.userData.fp} h ${nest.userData.h}`);
for (const id of ['jarstack', 'eggcrate', 'teacups', 'wafflestack', 'platepile', 'unknown']) {
  const g = PR.splatGeometry(id);
  checkGeo('splat ' + id, g, 600);
  if (PR.splatGeometry(id) !== g) err(`splat ${id}: not cached`);
  g.computeBoundingBox();
  const bb = g.boundingBox, r = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
  if (bb.min.y < 0.003 || bb.max.y > 0.031 || r < 0.8 || r > 1.6) err(`splat ${id}: y ${bb.min.y.toFixed(3)}..${bb.max.y.toFixed(3)} r ${r.toFixed(2)}`);
  if (list) console.log(`splat ${id.padEnd(12)} ${geoTris(g)} tris r ${r.toFixed(2)}`);
}
if (list) console.log(`nest               ${geoTris(nest)} tris h ${nest.userData.h.toFixed(2)}`);

const rng = (a) => (a && a.length ? `${Math.min(...a)}–${Math.max(...a)}` : '-');
console.log('tris by tier: ' + Object.keys(byTier).sort().map((t) => `${t} ${rng(byTier[t])}`).join(' · '));
console.log(`${KINDS.length} kinds (${built} built, ${fb} fallback) + ${PR.DECOR_KINDS.length} decor + ${PR.POT_SKINS.length} skins`);
console.log(fail ? `props-test: ${fail} FAIL` : 'props-test: PASS');
process.exit(fail ? 1 : 0);
