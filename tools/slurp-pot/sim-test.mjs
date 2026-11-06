// Slurp Pot sim tests (Sim role). Run: node tools/slurp-pot/sim-test.mjs
// Hand-built levels in the §13.3 expanded shape; no other role's files needed (levels.js is used when present).
import * as C from '../../games/slurp-pot/consts.js';
import * as L from '../../games/slurp-pot/logic.js';
import * as B from '../../games/slurp-pot/bots.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DT = C.DT;
let pass = 0, failN = 0;
const ok = (cond, name, info = '') => {
  if (cond) { pass++; console.log('  ok   ' + name + (info ? '  ' + info : '')); }
  else { failN++; console.log('  FAIL ' + name + (info ? '  ' + info : '')); }
};
const F = L.F;

// ------------------------------------------------------------------ level builders
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const item = (kind, x, z, a, extra = {}) => ({ kind, x, z, a, h: a * 0.8, k: 1, flags: 0, rot: 0, ...extra });
const boss = (kind, x, z, a) => item(kind, x, z, a, { k: 0, flags: F.BOSS });
const ing = (kind, x, z, a) => item(kind, x, z, a, { flags: F.ING });
const wall = (kind, x, z, a) => item(kind, x, z, a, { k: C.K_WALL, flags: F.GATE | F.WALL });
function level(o) {
  const W = o.W || 12, D = o.D || 18;
  return {
    n: o.n || 5, name: o.name || 'test', town: 'picnic', W, D, x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2,
    spawn: o.spawn || { x: 0, z: D / 2 - 2 }, r0: o.r0 || C.R0, T: o.T == null ? 60 : o.T, timed: o.timed !== false,
    cap: o.cap || C.R_MAX, items: o.items, surfaces: [], decor: [], lanes: o.lanes || [], belts: [], roost: null, gullEvery: 0,
    truckPath: null, tickets: o.tickets, seed: o.seed || 1,
  };
}

// Straight-line script level: cheese ×6 (sizeUp), corn ×2 (line, ticketDone), bigger junk to needR(0.6) (padlock), boss (win).
function scriptLevel(extra = {}) {
  const items = [];
  let z = 4.4;
  const put = (mk, kind, a) => { items.push(mk(kind, 0, z, a)); z -= 0.62; };
  for (let k = 0; k < 6; k++) put(item, 'cheese', 0.2);
  for (let k = 0; k < 2; k++) put(ing, 'corn', 0.24);
  for (let k = 0; k < 4; k++) put(item, 'watermelon', 0.32);
  for (let k = 0; k < 5; k++) put(item, 'pie', 0.42);
  items.push(boss('boss-table', 0, z - 0.6, 0.6));
  const bi = items.length - 1;
  for (let k = 0; k < 6; k++) items.push(item('pea', -4 + k * 1.6, -8, 0.07));   // spare (never on the path)
  return level({ items, tickets: [{ lines: [{ kind: 'corn', need: 2 }], boss: bi }], ...extra });
}
const goDown = () => ({ x: 0, z: -1, m: 1 });

function runScript(lvl, inputFn, maxSteps = 60 * 60) {
  const w = L.createWorld(lvl, { mode: 'level' });
  const evs = [];
  for (let s = 0; s < maxSteps && !w.result; s++) {
    L.step(w, inputFn(w, s), DT);
    for (const e of w.events.splice(0)) evs.push({ t: w.t, ...e });
  }
  return { w, evs };
}

// FNV-1a over the whole sim state that matters
function hashWorld(w) {
  let h = 0x811c9dc5;
  const mix = v => { h ^= v; h = Math.imul(h, 0x01000193) >>> 0; };
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const num = x => { f[0] = x; mix(u[0]); mix(u[1]); };
  const P = w.pot;
  for (const k of ['x', 'z', 'vx', 'vz', 'r', 'mass', 'rEff', 'megaT', 'magnetT', 'step', 'boilT']) num(P[k]);
  num(w.t); num(w.tLeft); num(w.tStart == null ? -1 : w.tStart); num(w.ti); num(w.chain.n); num(w.chain.best); num(w.sizzle);
  for (const arr of [w.ix, w.iz, w.ia, w.tp, w.st, w.fits, w.flags]) {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < b.length; i++) mix(b[i]);
  }
  for (const tk of w.tickets) for (const l of tk.lines) { mix(l.got); }
  for (const c of String(w.result)) mix(c.charCodeAt(0));
  return h.toString(16);
}

// Dense 240-item board for perf (+ walls, rollers, a boss).
function denseLevel(seed = 7) {
  const R = rng(seed), items = [], W = 30, D = 40;
  const kinds = [['pea', 0.07], ['strawberry', 0.11], ['tomato', 0.15], ['cheese', 0.2], ['corn', 0.24], ['sandwich', 0.28],
    ['watermelon', 0.32], ['lamp', 0.5], ['bench', 0.9], ['tree', 1.05]];
  const lanes = [{ ax: -12, az: -6, bx: 12, bz: -6, v: 2 }, { ax: 12, az: 6, bx: -12, bz: 6, v: 1.6 }];
  for (let k = 0; k < 4; k++) items.push(item('apple', -12 + k * 6, -6, 0.17, { flags: F.ROLL, lane: 0 }));
  for (let k = 0; k < 4; k++) items.push(item('orange', 12 - k * 6, 6, 0.17, { flags: F.ROLL, lane: 1 }));
  for (let k = 0; k < 16; k++) items.push(wall('fence', -6 + (k % 8) * 1.0, k < 8 ? -14 : -10, 0.5));
  items.push(boss('boss-table', 0, -12, 1.2));
  const bi = items.length - 1;
  while (items.length < C.ITEM_MAX) {
    const [kind, a] = kinds[(R() * R() * kinds.length) | 0];
    items.push((kind === 'corn' ? ing : item)(kind, (R() - 0.5) * (W - 2), (R() - 0.5) * (D - 2), a));
  }
  return level({ W, D, items, T: 300, tickets: [{ lines: [{ kind: 'corn', need: 6 }], boss: bi }], spawn: { x: 0, z: 17 } });
}

// ------------------------------------------------------------------ tests
console.log('Slurp Pot sim-test');

console.log('fit rule');
{
  ok(L.FIT === 0.9 && L.canFit(1, 0.9) && !L.canFit(1, 0.9001) && Math.abs(L.needR(0.9) - 1) < 1e-12, 'canFit/needR edges');
  ok(L.speedOf(0) === 2.5 && L.speedOf(10) === 6 && Math.abs(L.speedOf(1) - 3.7) < 1e-12, 'speedOf');
  // In the world: r0 0.30 → 0.27 fits, 0.28 blocks (pot stops at a + 0.5r and bumps).
  const lv = level({ items: [item('a', 0, 4, 0.27), item('b', 3, 4, 0.28), item('zz', -5, -8, 0.05)], tickets: [{ lines: [{ kind: 'zz', need: 1 }], boss: -1 }],
    timed: false, T: 0, spawn: { x: 0, z: 6 } });
  let w = L.createWorld(lv);
  for (let s = 0; s < 90 && w.st[0] === 0; s++) L.step(w, goDown(), DT);
  ok(w.st[0] !== 0, '0.27 swallowed at r0 0.30');
  w = L.createWorld({ ...lv, spawn: { x: 3, z: 6 } });
  let bumps = 0;
  for (let s = 0; s < 120; s++) { L.step(w, goDown(), DT); bumps += w.events.splice(0).filter(e => e.type === 'bump').length; }
  const d = Math.hypot(w.pot.x - 3, w.pot.z - 4);
  ok(w.st[1] === 0 && d >= 0.28 + 0.5 * w.pot.r - 1e-6, '0.28 blocks at a + 0.5r', 'd=' + d.toFixed(4));
  ok(bumps === 1, 'one bump on contact', 'bumps=' + bumps);
  ok(w.pot.x > 2.5 && w.pot.x < 3.5, 'slides, no tunnelling');
}

console.log('timer starts on first input');
{
  const w = L.createWorld(scriptLevel());
  for (let s = 0; s < 120; s++) L.step(w, { x: 0, z: -1, m: 0 }, DT);
  const ev0 = w.events.splice(0);
  ok(w.tStart === null && w.tLeft === w.T && !ev0.some(e => e.type === 'start'), 'no time used while idle (2 s)');
  ok(!L.doomed(w), 'doomed() false at t=0');
  L.step(w, goDown(), DT);
  const ev1 = w.events.splice(0);
  ok(ev1[0] && ev1[0].type === 'start' && w.tStart !== null && Math.abs(w.tLeft - (w.T - DT)) < 1e-9, 'start event, clock runs');
}

console.log('scripted event order');
{
  const { w, evs } = runScript(scriptLevel(), goDown);
  const want = ['start', 'bite', 'sizeUp', 'line', 'ticketDone', 'padlock', 'bossBite', 'win'];
  const first = want.map(ty => evs.findIndex(e => e.type === ty));
  const inOrder = first.every((v, k) => v >= 0 && (k === 0 || v > first[k - 1]));
  ok(inOrder, 'start < bite < sizeUp < line < ticketDone < padlock < bossBite < win', first.join(','));
  const win = evs.find(e => e.type === 'win');
  ok(w.result === 'win' && win && win.stars >= 1 && win.stars <= 3, 'win event', win ? `stars=${win.stars} tLeft=${win.tLeft.toFixed(2)} t=${w.t.toFixed(2)}` : '');
  ok(evs.filter(e => e.type === 'bossBite').length === 1 && evs.find(e => e.type === 'bossBite').final === true, 'one final bossBite');
  const pad = evs.find(e => e.type === 'padlock'), bb = evs.find(e => e.type === 'bossBite');
  ok(pad && bb && bb.t - pad.t > 0, 'padlock before bite');
  const bites = evs.filter(e => e.type === 'bite');
  ok(bites.length === 18 && w.stats.bites === 18, 'bites counted', 'n=' + bites.length);
  const ingB = bites.filter(e => e.ing).length;
  ok(ingB === 2, 'two ingredient bites');
  ok(evs.some(e => e.type === 'chain' && e.n === 5), 'chain 5 beat');
  const tEnd = evs.find(e => e.type === 'win').t;
  ok(!evs.some(e => e.t > tEnd), 'nothing after win');
  // growth rule: r = sqrt(r0² + G·mass) with K_ING for counted corn
  let mass = 6 * 0.04 + 2 * C.K_ING * 0.0576 + 4 * 0.1024 + 5 * 0.1764;
  ok(Math.abs(w.pot.mass - mass) < 1e-6 && Math.abs(w.pot.r - Math.sqrt(0.09 + C.G * mass)) < 1e-6, 'growth = sqrt(r0²+G·Σk·a²)', 'r=' + w.pot.r.toFixed(4));
  ok(w.pot.sizeUpR.length > 5 && Math.abs(w.pot.sizeUpR[1] - 0.375) < 1e-12, 'sizeUpR ladder');
}

console.log('determinism');
{
  const noisy = seed => { const R = rng(seed); return () => ({ x: Math.sin(R() * 6.283), z: -0.6 - R(), m: 0.5 + 0.5 * R() }); };
  const lv = denseLevel(11);
  const a = runScript(lv, noisy(5), 1800), b = runScript(lv, noisy(5), 1800);
  ok(hashWorld(a.w) === hashWorld(b.w) && a.evs.length === b.evs.length, 'same inputs → same hash', hashWorld(a.w));
  const c = runScript(lv, noisy(6), 1800);
  ok(hashWorld(a.w) !== hashWorld(c.w), 'different inputs → different hash');
  // greedy record → replay reproduces the finish time
  const lv2 = scriptLevel();
  const r1 = B.runLevel(lv2, 'greedy', 3, { maxT: 120, record: true });
  const w2 = L.createWorld(lv2);
  let k = 0;
  while (!w2.result && k < r1.inputs.length) { L.step(w2, r1.inputs[k++], DT); w2.events.length = 0; }
  ok(r1.win && w2.result === 'win' && Math.abs(w2.t - r1.tEnd) < 1e-3, 'greedy replay reproduces finish time (1 ms)', `t=${w2.t.toFixed(4)} bot=${r1.tEnd.toFixed(4)}`);
}

console.log('fail, doom, freezeContinue');
{
  // spoiled: needs 3 corn, only 2 exist
  const lv = scriptLevel();
  lv.tickets = [{ lines: [{ kind: 'corn', need: 3 }], boss: lv.tickets[0].boss }];
  const { w, evs } = runScript(lv, goDown, 600);
  const f = evs.find(e => e.type === 'fail');
  ok(w.result === 'spoiled' && f && f.why === 'spoiled' && f.missing[0].kind === 'corn', 'spoiled when a line can no longer be met', f ? `t=${f.t.toFixed(2)} missing=${JSON.stringify(f.missing)}` : '');
  // timeout + freezeContinue
  const w2 = L.createWorld(scriptLevel({ T: 3 }));
  const ev2 = [];
  for (let s = 0; s < 600 && !w2.result; s++) { L.step(w2, { x: 1, z: 0, m: 1 }, DT); ev2.push(...w2.events.splice(0)); }
  ok(w2.result === 'timeout' && ev2.some(e => e.type === 'fail' && e.why === 'timeout'), 'timeout');
  ok(ev2.filter(e => e.type === 'tick').map(e => e.s).join() === '3,2,1' && ev2.some(e => e.type === 'lowTime'), 'lowTime + ticks 3,2,1');
  ok(L.freezeContinue(w2) && w2.result === null && Math.abs(w2.tLeft - 10) < 0.02, 'freezeContinue resumes +10 s');
  ok(!L.freezeContinue(w2), 'freezeContinue once');
  const gb = B.createBot('greedy', 4);
  for (let s = 0; s < 1200 && !w2.result; s++) L.step(w2, B.decide(gb, w2, DT), DT);
  ok(w2.result === 'win' && w2.stars === 1, 'win after freezeContinue is 1★', 'res=' + w2.result + ' stars=' + w2.stars);
  // untimed L1 cannot fail, always 3★
  const w3 = L.createWorld(scriptLevel({ n: 1, timed: false, T: 0 }));
  for (let k = 0; k < 600; k++) L.step(w3, { x: 1, z: 0, m: 1 }, DT);
  ok(w3.result === null && w3.tLeft === 0, 'untimed level never fails');
  const w4 = runScript(scriptLevel({ n: 1, timed: false, T: 0 }), goDown).w;
  ok(w4.result === 'win' && w4.stars === 3, 'L1 win is 3★');
}

console.log('boosters');
{
  const w = L.createWorld(scriptLevel());
  L.step(w, goDown(), DT);
  ok(L.useBooster(w, 'freeze') && w.tLeft > w.T + 9 && w.freezeAdded === 10, 'freeze +10 s');
  ok(!L.useBooster(w, 'freeze'), 'freeze once');
  ok(L.useBooster(w, 'mega') && Math.abs(w.pot.rEff - w.pot.r * 1.25) < 1e-9, 'mega rEff ×1.25');
  ok(L.useBooster(w, 'magnet') && w.pot.magnetT === 3, 'magnet 3 s');
  const mk = () => L.createWorld(level({ items: [item('pea', 0, 5.4, 0.07), item('zz', -5, -8, 0.05)], tickets: [{ lines: [{ kind: 'zz', need: 1 }], boss: -1 }],
    timed: false, T: 0, spawn: { x: 0, z: 6 } }));
  const wm = mk(), wn = mk();
  L.useBooster(wm, 'magnet');
  for (let k = 0; k < 30; k++) { L.step(wm, null, DT); L.step(wn, null, DT); }
  ok(wm.st[0] !== 0 && wn.st[0] === 0, 'magnet pulls a fitting item within 2.5·r into the pot');
  // stars ignore the Freeze time
  const w5 = L.createWorld(scriptLevel({ T: 22 }));
  L.useBooster(w5, 'freeze');
  for (let k = 0; k < 3000 && !w5.result; k++) L.step(w5, goDown(), DT);
  ok(w5.result === 'win' && w5.stars === L.starsFor(w5), 'stars from (tLeft − freezeAdded)/T', `stars=${w5.stars}`);
}

console.log('pens, rollers, simmer');
{
  // pen: corn behind a fence row; fence a 0.5 is solid until r >= 0.556, then eaten (k 0.6)
  const items = [];
  for (let k = 0; k < 7; k++) items.push(wall('fence', -1.5 + k * 0.5, 0, 0.5));
  items.push(ing('corn', 0, -1.5, 0.24));
  const lv = level({ items, tickets: [{ lines: [{ kind: 'corn', need: 1 }], boss: -1 }], spawn: { x: 0, z: 3 } });
  let w = L.createWorld(lv);
  for (let s = 0; s < 120; s++) L.step(w, goDown(), DT);
  ok(w.pot.z > 0.4 && !w.result, 'fence blocks a small pot', 'z=' + w.pot.z.toFixed(3));
  w = L.createWorld({ ...lv, r0: 0.6 });
  const evs = [];
  for (let s = 0; s < 240 && !w.result; s++) { L.step(w, goDown(), DT); evs.push(...w.events.splice(0)); }
  ok(w.result === 'win' && evs.some(e => e.type === 'line'), 'big pot eats the gate and the corn (boss-less ticket wins)');
  // roller: moves A→B, hides 0.6 s, repeats; deterministic from level time
  const lv2 = level({ items: [item('apple', -4, 0, 0.17, { flags: F.ROLL, lane: 0 }), item('zz', -5, -8, 0.05)], lanes: [{ ax: -4, az: 0, bx: 4, bz: 0, v: 2 }],
    tickets: [{ lines: [{ kind: 'zz', need: 1 }], boss: -1 }], timed: false, T: 0, spawn: { x: 0, z: 6 } });
  w = L.createWorld(lv2);
  const xs = [];
  for (let s = 0; s < 300; s++) { L.step(w, null, DT); if (s % 30 === 29) xs.push(w.hid[0] ? 'h' : w.ix[0].toFixed(1)); }
  ok(xs.join(' ') === '-3.0 -2.0 -1.0 0.0 1.0 2.0 3.0 4.0 h -3.6' || (xs[0] === '-3.0' && xs.includes('h')), 'roller travels A→B, hides 0.6 s, respawns at A', xs.join(' '));
  // simmer: cap 0.40 → junk that would overshoot is refused; small junk is shoved; ingredient still eaten
  const items3 = [item('cheese', 0, 4, 0.2), item('cheese', 0, 3.4, 0.2), item('cheese', 0, 2.8, 0.2), item('cheese', 0, 2.2, 0.2),
    item('cheese', 0, 1.6, 0.2), item('cheese', 0, 1.0, 0.2), item('tomato', 0, 0.4, 0.15), item('tomato', 0, -0.2, 0.15), item('tomato', 0, -0.8, 0.15),
    ing('corn', 0, -1.6, 0.24), boss('boss-s', 0, -3.5, 0.33)];
  const lv3 = level({ items: items3, cap: 0.4, tickets: [{ lines: [{ kind: 'corn', need: 1 }], boss: 10 }], spawn: { x: 0, z: 5.5 } });
  w = L.createWorld(lv3);
  const ev3 = [];
  for (let s = 0; s < 600 && !w.result; s++) { L.step(w, goDown(), DT); ev3.push(...w.events.splice(0)); }
  ok(w.pot.r <= 0.4 + 1e-9 && ev3.some(e => e.type === 'refuse') && ev3.some(e => e.type === 'shove') && ev3.some(e => e.type === 'boil'),
    'simmer cap holds; refuse + shove + boil', `r=${w.pot.r.toFixed(4)} third tomato st=${w.st[8]}`);
  ok(w.st[8] === 0 && w.st[9] === 2, 'refused junk stays, ingredient still eaten');
  ok(w.result === 'win', 'simmer level still winnable', 'res=' + w.result);
}

console.log('boss nudge, sizzle, two courses');
{
  // locked boss: a bump on it says why (recipe first, then size)
  const lv = level({ items: [boss('boss-table', 0, 3, 1.2), ing('corn', 4, 6, 0.24)], tickets: [{ lines: [{ kind: 'corn', need: 1 }], boss: 0 }],
    timed: false, T: 0, spawn: { x: 0, z: 6 } });
  let w = L.createWorld(lv);
  const ev = [];
  for (let s = 0; s < 90; s++) { L.step(w, goDown(), DT); ev.push(...w.events.splice(0)); }
  const nz = ev.find(e => e.type === 'bossNudge');
  ok(nz && nz.why === 'recipe' && L.bossState(w, 0) === 'recipe' && w.stats.bossNudges === 1, 'bossNudge on a locked boss (recipe)');
  // sizzle: 10 bites inside the chain window → +1 s, capped at 10 % of T
  const items = [];
  for (let k = 0; k < 40; k++) items.push(item('pea', 0, 5 - k * 0.12, 0.07));
  items.push(item('zz', -5, -8, 0.05));
  const lv2 = level({ items, tickets: [{ lines: [{ kind: 'zz', need: 1 }], boss: -1 }], T: 12, spawn: { x: 0, z: 5.6 } });
  w = L.createWorld(lv2);
  const ev2 = [];
  for (let s = 0; s < 150 && !w.result; s++) { L.step(w, goDown(), DT); ev2.push(...w.events.splice(0)); }
  const sz = ev2.filter(e => e.type === 'sizzle');
  ok(sz.length >= 1 && Math.abs(w.sizzle - 1.2) < 1e-9 && sz[sz.length - 1].add < 1, 'sizzle +1 s at chain 10, capped at 0.10·T', `adds=${sz.map(e => e.add.toFixed(2)).join(',')} chainBest=${w.chain.best}`);
  ok(ev2.some(e => e.type === 'chain' && e.n === 10), 'chain 10 beat');
  // two courses: course 1 boss → courseDone, ticket 2 → win; a course-2 ingredient eaten early is banked
  const its = [ing('corn', 0, 4.6, 0.24), ing('tomato', 0, 4.0, 0.15), boss('boss-a', 0, 2.8, 0.25), item('cheese', 0, 1.8, 0.2), item('cheese', 0, 1.2, 0.2),
    boss('boss-b', 0, -3.0, 0.33), item('cheese', 0, 0.6, 0.2), item('cheese', 0, 0, 0.2), item('cheese', 0, -0.6, 0.2)];
  const lv3 = level({ items: its, tickets: [{ lines: [{ kind: 'corn', need: 1 }], boss: 2 }, { lines: [{ kind: 'tomato', need: 1 }], boss: 5 }], spawn: { x: 0, z: 5.4 } });
  const r = runScript(lv3, goDown, 600);
  const ty = r.evs.map(e => e.type).filter(t => ['line', 'ticketDone', 'padlock', 'bossBite', 'courseDone', 'win'].includes(t)).join(' ');
  ok(r.w.result === 'win' && ty === 'line ticketDone padlock line bossBite courseDone ticketDone padlock bossBite win', 'two-course order (banked line)', ty);
  ok(r.evs.filter(e => e.type === 'bossBite').map(e => e.final).join() === 'false,true', 'bossBite final only on the last course');
}

console.log('bots');
{
  for (const kind of ['greedy', 'casual', 'planner', 'average', 'expert']) {
    const r = B.runLevel(scriptLevel(), kind, 9, { maxT: 120 });
    ok(r.win, kind + ' wins the script level', `t=${r.tUsed.toFixed(2)} stars=${r.stars}`);
  }
  const r2 = B.runLevel(denseLevel(3), 'greedy', 1, { maxT: 300 });
  console.log(`  info dense 240-item board, greedy: ${r2.win ? 'win' : r2.why} t=${r2.tUsed.toFixed(1)} progress=${r2.progress.toFixed(2)}`);
  const bot = B.createBot('greedy', 1), w = L.createWorld(scriptLevel());
  const d = B.decide(bot, w, DT), sd = B.screenDir(bot);
  ok(d && typeof d.x === 'number' && typeof d.m === 'number' && (sd === null || typeof sd.dx === 'number'), 'decide/screenDir shape');
}

console.log('perf');
{
  const lv = denseLevel(5);
  const R = rng(99);
  const inputs = [];
  for (let k = 0; k < 4000; k++) inputs.push({ x: Math.sin(k * 0.013) + (R() - 0.5) * 0.2, z: Math.cos(k * 0.017), m: 1 });
  let best = 1e9, aliveEnd = 0;
  for (let rep = 0; rep < 5; rep++) {
    const w = L.createWorld({ ...lv, T: 1e6 });
    for (let k = 0; k < 600; k++) { L.step(w, inputs[k], DT); w.events.length = 0; }   // warm-up
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 4000; k++) { L.step(w, inputs[k], DT); w.events.length = 0; }
    const us = Number(process.hrtime.bigint() - t0) / 1e3 / 4000;
    if (us < best) best = us;
    aliveEnd = L.snapshot(w).alive;
  }
  ok(best <= 15, 'logic.step at 240 items ≤ 15 µs', `${best.toFixed(2)} µs/step (alive at end ${aliveEnd})`);
  const w0 = L.createWorld({ ...lv, T: 1e6 });
  for (let k = 0; k < 200; k++) L.step(w0, { x: 0, z: 0, m: 0 }, DT);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 4000; k++) L.step(w0, { x: 0, z: 0, m: 0 }, DT);
  console.log(`  info idle step at 240 items: ${(Number(process.hrtime.bigint() - t0) / 1e3 / 4000).toFixed(2)} µs`);
}

// ------------------------------------------------------------------ real levels (when Levels has shipped them)
const lvPath = join(ROOT, 'games/slurp-pot/levels.js');
if (existsSync(lvPath) && existsSync(join(ROOT, 'games/slurp-pot/levels-data.js'))) {
  console.log('real levels L1–L10');
  try {
    const LV = await import(lvPath);
    const get = n => LV.getLevel(n);
    for (let n = 1; n <= 10; n++) {
      const lvl = get(n);
      const w = L.createWorld(lvl);
      ok(!L.doomed(w), `L${n} doomed() false at t=0`);
      const row = [];
      for (const kind of ['greedy', 'casual', 'planner']) {
        let wins = 0, t = 0;
        const N = kind === 'casual' ? 10 : 4;
        for (let s = 0; s < N; s++) { const r = B.runLevel(lvl, kind, 100 + s, { maxT: (lvl.T || 120) + 30 }); if (r.win) { wins++; t += r.tUsed; } }
        row.push(`${kind} ${wins}/${N}${wins ? ' ' + (t / wins).toFixed(1) + 's' : ''}`);
      }
      console.log(`  info L${n} T=${lvl.T} items=${lvl.items.length}: ${row.join(' | ')}`);
    }
  } catch (e) { ok(false, 'real levels load', String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
} else console.log('real levels: games/slurp-pot/levels.js not there yet (skipped)');

// ------------------------------------------------------------------ Feast (§3.12) and pen routing (Wed)
if (existsSync(lvPath) && existsSync(join(ROOT, 'games/slurp-pot/feast.js'))) {
  console.log('feast');
  try {
    const FE = await import(join(ROOT, 'games/slurp-pot/feast.js'));
    ok([1, 4, 5, 8, 12, 30].map(FE.addOf).join() === '12,12,11,8,6,6', 'addOf: 12 for c ≤ 4, then max(6, 12 − (c − 4))', [1, 4, 5, 8, 12, 30].map(FE.addOf).join());
    // one casual run, game time capped at 600 s: tickets bank time, slots respawn, the run ends with fail 'timeout'
    const run = () => {
      const fs = FE.createFeast('picnic', 3, { cur: 30 }), w = L.createWorld(FE.feastLevel(fs), { mode: 'feast' });
      const bot = B.createBot('casual', 3), n = {}, adds = [];
      let failEv = null;
      for (let s = 0; s < 600 / DT && !w.result; s++) {
        L.step(w, B.decide(bot, w, DT), DT);
        FE.feastStep(fs, w, DT);
        for (const e of w.events) { n[e.type] = (n[e.type] || 0) + 1; if (e.type === 'feastTicket') adds.push(e.add); if (e.type === 'fail') failEv = e; }
        w.events.length = 0;
      }
      return { fs, w, n, adds, failEv, h: hashWorld(w) };
    };
    const a = run(), b = run();
    ok(a.h === b.h && a.fs.served === b.fs.served, 'feast run deterministic (same seed → same world hash)', `tickets ${a.fs.served} t ${a.w.t.toFixed(1)}`);
    ok(a.fs.served >= 1 && a.n.feastTicket === a.fs.served, 'feastTicket per served ticket', `n=${a.n.feastTicket}`);
    ok(a.adds.every((v, k) => Math.abs(v - FE.addOf(1 + (k >> 2))) < 1e-9), 'feastTicket add = addOf(course)', a.adds.slice(0, 9).join(','));
    ok((a.n.spawn || 0) >= 1, 'spawner reuses gone slots (spawn events)', `spawn=${a.n.spawn || 0}`);
    ok(a.fs.served < 4 || (a.n.feastCourse || 0) >= 1, 'course rolls over after 4 tickets', `courses=${a.n.feastCourse || 0}`);
    ok(a.w.result === 'timeout' && a.failEv && a.failEv.why === 'timeout', 'feast ends with fail {why: timeout}', String(a.w.result));
    const r = FE.runFeast('picnic', 'casual', 3, { maxT: 600 });
    ok(r.tickets === a.fs.served && r.why === 'timeout', 'runFeast matches the manual loop', `tickets ${r.tickets} tEnd ${r.tEnd.toFixed(1)} s`);
  } catch (e) { ok(false, 'feast load', String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }

  console.log('pen routing');
  try {
    // L34's pen (gate car, eggplant line inside): the planner (no pen knowledge before Wed) timed out at r 1.43
    const LV = await import(lvPath), lv = LV.getLevel(34);
    const r = B.runLevel(lv, 'planner', 1, { maxT: (lv.T || 120) + 30 });
    ok(r.win, 'planner enters the L34 pen and wins', `t=${r.tUsed.toFixed(1)} of T ${lv.T} stars=${r.stars}`);
  } catch (e) { ok(false, 'pen routing (L34)', String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
}

// ------------------------------------------------------------------ hot chili (round 2)
console.log('hot chili');
{
  const chili = (x, z) => item('chili', x, z, 0.26, { k: 0, h: 0.2, flags: F.HOT });
  const hotLevel = (extra = {}, z = 5.4) => { const lv = scriptLevel(extra); lv.items.push(chili(0, z)); lv.hot = [{ x: 0, z }]; return lv; };
  const untilHot = (lv, input = goDown, cap = 600) => {
    const w = L.createWorld(lv, { mode: 'level' });
    let e = null, before = 0, r0 = 0;
    for (let s = 0; s < cap && !w.result && !e; s++) { before = w.tLeft; r0 = w.pot.r; L.step(w, input(w, s), DT); e = w.events.find(q => q.type === 'hot') || null; if (!e) w.events.length = 0; }
    return { w, e, before, r0 };
  };
  const a = untilHot(hotLevel());
  ok(a.e && a.e.add === -C.HOT_SECS && a.e.i === a.w.level.items.length - 1 && Math.abs(a.e.z - 5.4) < 1e-5, "swallowing a chili emits 'hot' with i, x, z and add = -HOT_SECS", JSON.stringify(a.e));
  ok(a.e && Math.abs(a.before - DT - C.HOT_SECS - a.w.tLeft) < 1e-9, 'it takes HOT_SECS off the clock', `${a.before.toFixed(2)} -> ${a.w.tLeft.toFixed(2)}`);
  const f = untilHot(hotLevel({ T: 2 }));
  ok(f.e && Math.abs(f.w.tLeft - 0.1) < 1e-9 && !f.w.result, 'the clock floors at 0.1 s, the chili itself never ends the run', `tLeft ${f.w.tLeft}`);
  // let the tip animation finish: no growth, no bite count, no ticket progress
  const w = a.w, bites = w.stats.bites, mass = w.pot.mass, ticket = JSON.stringify(w.tickets);
  w.events.length = 0;
  for (let s = 0; s < 90; s++) { L.step(w, { x: 0, z: 0, m: 0 }, DT); w.events.length = 0; }
  ok(w.st[a.e.i] === 2 && w.stats.hot === 1 && w.stats.bites === bites && w.pot.mass === mass && JSON.stringify(w.tickets) === ticket, 'a chili goes without growth, bite, ticket or bar', `st ${w.st[a.e.i]} bites ${bites} mass ${mass}`);
  // chain: bites straight into a chili
  const chain = (() => {
    const lv = scriptLevel({ T: 60 });
    lv.items.push(chili(0, 3.6));   // between the cheeses on the straight path
    const q = L.createWorld(lv, { mode: 'level' });
    let n = 0, ended = false, hit = false;
    for (let s = 0; s < 600 && !hit; s++) { L.step(q, goDown(), DT); for (const e of q.events) { if (e.type === 'chainEnd') ended = true; if (e.type === 'hot') { hit = true; n = q.chain.n; } } q.events.length = 0; }
    return { hit, n, ended };
  })();
  ok(chain.hit && chain.n === 0 && chain.ended, 'a chili breaks the chain', JSON.stringify(chain));
  // always swallowable: never refused, even for a pot far under its size and at the cap
  const small = hotLevel({ r0: 0.3 }), big = hotLevel({ r0: 1, cap: 1 });
  const refused = lv => { const q = L.createWorld(lv, { mode: 'level' }); let n = 0, h = false; for (let s = 0; s < 400 && !h; s++) { L.step(q, goDown(), DT); for (const e of q.events) { if (e.type === 'refuse' && e.i === q.level.items.length - 1) n++; if (e.type === 'hot') h = true; } q.events.length = 0; } return { n, h }; };
  ok(refused(small).h && !refused(small).n && refused(big).h && !refused(big).n, 'always swallowable, never refused');
  // a magnet leaves it where it is
  const wm = L.createWorld(hotLevel({}, 6.2), { mode: 'level' });
  wm.pot.z = 7; L.useBooster(wm, 'magnet');
  const z0 = wm.iz[wm.level.items.length - 1];
  for (let s = 0; s < 30; s++) { L.step(wm, { x: 0, z: 0, m: 0 }, DT); wm.events.length = 0; }
  ok(wm.iz[wm.level.items.length - 1] === z0, 'the magnet does not pull a chili');
  // after the final bite the clock is safe
  const wf = L.createWorld(hotLevel(), { mode: 'level' });
  wf._.finalBite = true; wf.tStart = 0;
  let late = 0;
  for (let s = 0; s < 120; s++) { L.step(wf, goDown(), DT); late += wf.events.filter(e => e.type === 'hot').length; wf.events.length = 0; }
  ok(late === 0, 'no chili bite after the final bite');
  // determinism with a chili
  const h1 = hashWorld(untilHot(hotLevel()).w), h2 = hashWorld(untilHot(hotLevel()).w);
  ok(h1 === h2, 'chili run deterministic');
  // bots: a careful bot goes round, the casual one sometimes does not
  const lane = () => { const lv = scriptLevel({ T: 60 }); const hot = []; for (let k = 0; k < 4; k++) { const z = 3.4 - k * 2.4; lv.items.push(chili(k % 2 ? 0.5 : -0.5, z)); hot.push({ x: k % 2 ? 0.5 : -0.5, z }); } lv.hot = hot; return lv; };
  const hits = kind => { let n = 0; for (let s = 1; s <= 8; s++) n += B.runLevel(lane(), kind, s).hot; return n / 8; };
  ok(hits('average') <= 1.5, 'the average bot steers round chilis', `mean hits ${hits('average')}`);
  try {
    const LV = await import(lvPath);
    const list = [];
    for (let n = 1; n <= C.LEVELS; n++) { const lv = LV.getLevel(n); if (lv.hot) list.push(lv); }
    const ns = list.map(l => l.n);
    ok(ns.length >= 10 && ns.length <= 14 && ns.every(n => n >= 31 && n <= 59 && !C.isMilestone(n)), 'chilis on about 12 levels in L31 to L59, none on a milestone', ns.join(' '));
    ok(list.filter(l => l.hotIntro).length === 1 && list[0].hotIntro === true, 'hotIntro only on the first chili level', `L${list[0].n}`);
    let spawnOK = true, kindOK = true, gapOK = true, cnt = [];
    for (const l of list) {
      cnt.push(l.hot.length);
      const its = l.items.filter(o => o.kind === 'chili');
      if (its.length !== l.hot.length || its.some(o => !(o.flags & F.HOT))) kindOK = false;
      for (const h of l.hot) if (Math.hypot(h.x - l.spawn.x, h.z - l.spawn.z) < 6) spawnOK = false;
      for (let i = 0; i < l.hot.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(l.hot[i].x - l.hot[j].x, l.hot[i].z - l.hot[j].z) < 4 - 1e-9) gapOK = false;
    }
    ok(kindOK, 'level.hot matches the chili items, all flagged HOT');
    ok(spawnOK, 'no chili within 6 u of the spawn');
    ok(gapOK, 'chilis stay at least 4 u apart, so they cannot chain', cnt.join(' '));
    ok(cnt.every(c => c >= 8 && c <= 14), '8 to 14 chilis a level', cnt.join(' '));
    const CAT = await import(join(ROOT, 'games/slurp-pot/catalog.js'));
    ok(CAT.KINDS[CAT.KINDS.length - 1].id === 'chili', 'chili is the last row of the kind table');
    let plain = true;
    for (const key of ['2026-11-06', '2026-12-25', '2027-03-01']) for (const cur of [7, 30, 45]) { const d = LV.getDaily(key, cur); if (d.hot || d.items.some(o => o.kind === 'chili')) plain = false; }
    for (const town of ['picnic', 'market', 'harbour']) for (const cc of [1, 3, 6]) { const d = LV.feastCourse(cc, town, 3, { cur: 60 }); if (d.hot || d.items.some(o => o.kind === 'chili')) plain = false; }
    ok(plain, 'no chili on a Daily or a Feast course');
  } catch (e) { ok(false, 'chili levels', String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
}

console.log(`\n${failN ? 'RED' : 'GREEN'}: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
