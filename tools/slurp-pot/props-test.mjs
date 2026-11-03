// Slurp Pot props test (Art role): every catalog kind and decor id builds, footprint within ±5 % of catalog `a`,
// tri caps per tier (GDD §13.7), the shared four-attribute set, bottom on y = 0, no NaN. Also builds the pot skins,
// board, surfaces, padlock, gull and wedding-cake tiers. Node only (no DOM): groundTexture is skipped.
// Run: node tools/slurp-pot/props-test.mjs [--list]
import { KINDS } from '../../games/slurp-pot/catalog.js';
import * as PR from '../../games/slurp-pot/props.js';

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
  if (PR.hasBuilder(k.id)) built++; else fb++;
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

const rng = (a) => (a && a.length ? `${Math.min(...a)}–${Math.max(...a)}` : '-');
console.log('tris by tier: ' + Object.keys(byTier).sort().map((t) => `${t} ${rng(byTier[t])}`).join(' · '));
console.log(`${KINDS.length} kinds (${built} built, ${fb} fallback) + ${PR.DECOR_KINDS.length} decor + ${PR.POT_SKINS.length} skins`);
console.log(fail ? `props-test: ${fail} FAIL` : 'props-test: PASS');
process.exit(fail ? 1 : 0);
