import { Synth, Music, renderOffline, layerFor, dingNote, LAYER_NAMES, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/reel-greedy';
const FONT = '"Lilita One", system-ui, sans-serif';
const SANS = 'system-ui, -apple-system, sans-serif';
const INK = '#0b2c52';
const CORAL = '#ff5a36';
const GOLD = '#ffc83d';
const cvs = document.getElementById('game');
let g = cvs.getContext('2d'); // swapped for the shop icons

// ---------------------------------------------------------------- utils
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const back = t => {
  t = clamp(t, 0, 1);
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
function rng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, k) => c.map(v => clamp(v * k, 0, 255));
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], clamp(t, 0, 1)));
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('rgr_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('rgr_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
// The sea gets darker and the fish get rarer (and worth more) the deeper you go.
const ZONES = [
  { name: 'SUNLIT SHALLOWS', at: 0, water: '#33b8e8', rock: '#1d6b8c' },
  { name: 'CORAL DROP', at: 40, water: '#1784c0', rock: '#174c78' },
  { name: 'TWILIGHT', at: 90, water: '#0d4c8e', rock: '#10305c' },
  { name: 'MIDNIGHT', at: 150, water: '#0a2554', rock: '#0a1a3c' },
  { name: 'THE ABYSS', at: 220, water: '#070f2c', rock: '#050a20' },
  { name: 'THE TRENCH', at: 300, water: '#03050f', rock: '#020309' },
];
const ZW = ZONES.map(z => hexRgb(z.water));
const ZR = ZONES.map(z => hexRgb(z.rock));
const zoneAt = d => {
  let z = 0;
  for (let i = 0; i < ZONES.length; i++) if (d >= ZONES[i].at) z = i;
  return z;
};
function zoneCol(arr, d) {
  if (d <= 0) return arr[0];
  for (let i = 0; i < ZONES.length - 1; i++) if (d < ZONES[i + 1].at) return mix(arr[i], arr[i + 1], (d - ZONES[i].at) / (ZONES[i + 1].at - ZONES[i].at));
  return arr[arr.length - 1];
}

const SPECIES = {
  sardine: { name: 'SARDINE', L: 26, H: 10, pts: 1, back: '#5a8fc0', belly: '#e6f0f8', fin: '#3f6f9c', spd: [70, 110] },
  clown: { name: 'CLOWNFISH', L: 24, H: 14, pts: 2, back: '#ff7a1a', belly: '#ffb066', fin: '#ff7a1a', spd: [40, 70] },
  mackerel: { name: 'MACKEREL', L: 34, H: 12, pts: 2, back: '#2e8a80', belly: '#e9f2ec', fin: '#24605a', spd: [80, 120] },
  snapper: { name: 'SNAPPER', L: 36, H: 18, pts: 3, back: '#ec4a3c', belly: '#ffb4a2', fin: '#c23026', spd: [50, 80] },
  tuna: { name: 'TUNA', L: 50, H: 20, pts: 5, back: '#27488a', belly: '#d3dfec', fin: '#ffd23f', spd: [100, 150] },
  lantern: { name: 'LANTERNFISH', L: 28, H: 12, pts: 8, back: '#46568c', belly: '#8796c4', fin: '#33406e', glow: '#7cf3ff', spd: [50, 80] },
  hatchet: { name: 'HATCHETFISH', L: 26, H: 22, pts: 10, back: '#b4c3d4', belly: '#f2f7fc', fin: '#8a9bb0', glow: '#b8f0ff', spd: [40, 70] },
  angler: { name: 'ANGLERFISH', L: 40, H: 28, pts: 15, back: '#5a4664', belly: '#7e6888', fin: '#3e2e48', glow: '#ffe66b', spd: [30, 50] },
  ghost: { name: 'GHOST FISH', L: 46, H: 16, pts: 25, back: '#9fe6ff', belly: '#e6faff', fin: '#74d2ff', glow: '#a8ecff', spd: [60, 90] },
  gold: { name: 'GOLDEN FISH', L: 30, H: 14, pts: 20, back: '#ffc21a', belly: '#fff0a0', fin: '#e89a00', spd: [90, 130] },
};
const POOLS = [
  ['sardine', 'sardine', 'clown', 'mackerel'],
  ['mackerel', 'snapper', 'clown', 'snapper', 'tuna'],
  ['snapper', 'tuna', 'lantern', 'lantern'],
  ['lantern', 'hatchet', 'hatchet', 'angler'],
  ['hatchet', 'angler', 'ghost'],
  ['angler', 'ghost', 'ghost'],
];

export const LURES = [
  { id: 'worm', name: 'WORM', price: 0 },
  { id: 'spoon', name: 'SPOON', price: 60 },
  { id: 'fly', name: 'FLY', price: 120 },
  { id: 'ducky', name: 'DUCKY', price: 200 },
  { id: 'neon', name: 'NEON', price: 320 },
  { id: 'skull', name: 'SKULL', price: 480 },
  { id: 'gold', name: 'GOLD', price: 800 },
  { id: 'diamond', name: 'DIAMOND', price: 1500 },
];

// ---------------------------------------------------------------- tuning
// World units: x across the playfield (0..W), y down from the surface. 20 units = 1 m.
const W = 400, M = 20, BAND = 100;
const LURE_R = 6; // the hook vs fish (on the way down) and vs sharks and jellies
const CATCH_R = 16; // the hook vs fish on the way up: generous on purpose
const READY_Y = 40;
const HOVER_Y = 80; // letting go above 4 m just leaves the hook hanging
const BOAT_X = 140;
const ROD = { x: 232, y: -86 };
const downV = d => (9 + 0.06 * d) * M;
const upV = d => (12 + 0.05 * d) * M;
const bpmAt = d => Math.min(134, 100 + d * 0.2);

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, U = 1, S = 1, SC = 1, OX = 0;
let mode = 'title';
let run = null;
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let bestD = store.get('bestd', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['worm']);
let lureId = store.get('lure', 'worm');
let plays = store.get('plays', 0);
let sharkTip = store.get('stip', false);
let overT = 0;
let buttons = [];
let rec = null; // record-mode log
let pulse = 0;
let held = false, ptr = null, aimX = null;
let keyHeld = false, keyL = false, keyR = false;
const cam = { y: -300, z: 1 };
const clock = { next: 0, step: 0, last: 0 };
const snow = Array.from({ length: 70 }, (_, i) => ({ x: hash(i * 3.1), y: hash(i * 7.7), r: 0.6 + hash(i * 1.3) * 1.6, s: 0.4 + hash(i * 5.9) * 0.8 }));

function resize() {
  if (REC) {
    SW = 1080;
    SH = 1920;
    DPR = 1;
  } else if (OG) {
    SW = 1200;
    SH = 630;
    DPR = 1;
  } else {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    SW = window.innerWidth;
    SH = window.innerHeight;
  }
  cvs.width = Math.round(SW * DPR);
  cvs.height = Math.round(SH * DPR);
  cvs.style.width = SW + 'px';
  cvs.style.height = SH + 'px';
  U = Math.min(SW / 420, SH / 640);
  S = OG ? 1.05 : Math.min(SW / 420, SH / 760);
  placeCam();
}
const wide = () => SW > SH * 1.15;
function placeCam() {
  SC = S * cam.z;
  OX = (OG ? SW * 0.73 : SW / 2) - (W / 2) * SC;
}
const sx = x => OX + x * SC;
const sy = y => (y - cam.y) * SC;

// ---------------------------------------------------------------- world
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const r = {
    seed,
    rnd: rng(seed),
    bot: !!opts.bot,
    dive: opts.dive || 0,
    t: 0,
    phase: 'ready',
    phT: 0,
    lure: { x: W / 2, y: READY_Y, vx: 0, tx: W / 2, ang: 0 },
    cr: [],
    bands: 0,
    chain: [],
    flying: [],
    parts: [],
    pops: [],
    bubT: 0,
    maxD: 0,
    haul: 0,
    bonus: 0,
    score: 0,
    landedN: 0,
    goldLanded: 0,
    caught: 0,
    bites: 0,
    zone: 0,
    layer: layerFor(0),
    layerPop: null,
    banner: null,
    slow: 1,
    slowT: 0,
    scoreBump: 0,
    tutorial: !opts.bot && plays < 2,
    deepPassed: false,
    lost: 0,
    lostPts: 0,
    snapD: 0,
    landNext: 0,
    landDone: 0,
    hookedOne: false,
    pileSp: [],
  };
  ensureWorld(r, 1500);
  return r;
}

function ensureWorld(r, yTo) {
  while (r.bands * BAND < yTo) genBand(r, r.bands++);
}

function genBand(r, b) {
  const R = r.rnd, y0 = b * BAND, d = y0 / M;
  if (b < 1) return;
  const z = zoneAt(d);
  const dens = 0.8 + 1.3 * clamp(d / 160, 0, 1);
  let n = Math.floor(dens) + (R() < dens % 1 ? 1 : 0);
  if (z <= 1 && b > 1 && R() < 0.16) {
    // a school: a wall to dodge on the way down, a jackpot on the way up
    const sp = z === 0 ? 'sardine' : R() < 0.5 ? 'mackerel' : 'sardine';
    const k = 4 + ((R() * 4) | 0);
    const v = lerp(SPECIES[sp].spd[0], SPECIES[sp].spd[1], R()) * (R() < 0.5 ? -1 : 1);
    const x0 = 60 + R() * (W - 160), yy = y0 + 20 + R() * 50;
    for (let i = 0; i < k; i++) addFish(r, sp, x0 + (i % 3) * 30 + (R() - 0.5) * 8, yy + Math.floor(i / 3) * 16 + (i % 2) * 7, { vx: v });
    n = Math.max(0, n - 1);
  }
  for (let i = 0; i < n; i++) {
    const sp = d > 20 && R() < 0.03 ? 'gold' : POOLS[z][(R() * POOLS[z].length) | 0];
    addFish(r, sp, 30 + R() * (W - 60), y0 + 10 + R() * (BAND - 20));
  }
  if (d >= 12 && R() < 0.12 + 0.5 * clamp((d - 12) / 150, 0, 1)) addShark(r, y0 + 20 + R() * (BAND - 40), d);
  if (d >= 50 && R() < 0.24 * clamp((d - 50) / 140, 0, 1)) addJelly(r, 50 + R() * (W - 100), y0 + R() * BAND);
}

function addFish(r, sp, x, y, o = {}) {
  const s = SPECIES[sp], R = r.rnd;
  const k = 0.9 + R() * 0.2;
  const spd = lerp(s.spd[0], s.spd[1], R());
  const c = { k: 'fish', sp, x, y, y0: y, vy: 0, vx: o.vx ?? spd * (R() < 0.5 ? -1 : 1), spd, L: s.L * k, H: s.H * k, ph: R() * TAU, flee: o.flee || 0, gold: sp === 'gold' };
  r.cr.push(c);
  return c;
}
function addShark(r, y, d, o = {}) {
  const R = r.rnd;
  const dir = o.dir ?? (R() < 0.5 ? -1 : 1);
  const sp = o.speed ?? Math.min(190, 95 + d * 0.55) * (0.85 + R() * 0.3);
  const c = { k: 'shark', x: o.x ?? -200 + R() * 800, y, y0: y, vx: sp * dir, L: o.L ?? 100 + Math.min(40, d * 0.15) + R() * 20, ph: R() * TAU, full: 0, chomp: 0, wait: 0, warned: false, near: false };
  r.cr.push(c);
  return c;
}
function addJelly(r, x, y) {
  const R = r.rnd;
  r.cr.push({ k: 'jelly', x, y, x0: x, y0: y, vx: 0, r: 16 + R() * 7, ph: R() * TAU, full: 0, chomp: 0, near: false });
}

// distance from a point to the edge of a creature's body (negative = inside)
function fishDist(c, px, py) {
  const dx = Math.max(0, Math.abs(px - c.x) - c.L * 0.36);
  return Math.hypot(dx, py - c.y) - c.H * 0.42;
}
function hazDist(c, px, py) {
  if (c.k === 'shark') {
    const dx = Math.max(0, Math.abs(px - c.x) - c.L * 0.4);
    return Math.hypot(dx, py - c.y) - c.L * 0.11;
  }
  const d1 = Math.hypot(px - c.x, (py - c.y) * 1.2) - c.r * 0.95;
  const ty = clamp(py, c.y, c.y + c.r * 2.1);
  const d2 = Math.hypot(px - c.x, py - ty) - c.r * 0.45;
  return Math.min(d1, d2);
}
const nodeR = n => n.H * 0.4;

// ---------------------------------------------------------------- run flow
function startGame() {
  if (mode !== 'title' || !run || run.bot) {
    run = newRun();
    cam.z = 1;
    placeCam();
    cam.y = camTarget(run);
  }
  run.tutorial = plays < 2;
  plays++;
  store.set('plays', plays);
  mode = 'play';
  overT = 0;
  sfx('revive');
}

function ensureAudio() {
  if (REC || OG || !soundOn) return;
  try {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      audio = new Synth(ctx);
      music = new Music(audio);
      music.start();
    }
    if (audio.ctx.state !== 'running') audio.ctx.resume();
  } catch (e) {
    audio = null;
  }
}
function sfx(type, e = {}) {
  if (REC && rec) {
    rec.events.push({ type, t: rec.t, ...e });
    return;
  }
  if (audio && soundOn && audio.ctx.state === 'running') audio.play(type, audio.ctx.currentTime + 0.005, e);
}
function musicState() {
  const r = run;
  const d = r ? Math.max(0, r.lure.y / M) : 0;
  let layer = r ? r.layer : 0;
  if (mode === 'title') layer = 1;
  return { layer, root: ZONE_ROOTS[zoneAt(d)], bpm: bpmAt(r ? r.maxD : 0), depth: d };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}
const holding = r => (r.bot ? r.lure.y < r.dive * M && !r.botLetGo : held || keyHeld);

// ---------------------------------------------------------------- update
function update(dt) {
  tReal += dt;
  const r = run;
  if (!r) return;
  {
    const bpm = musicState().bpm;
    let ph;
    if (REC && rec) {
      const st = rec.states[rec.states.length - 1];
      while (clock.next < rec.t) {
        if (clock.step % 4 === 0) clock.last = clock.next;
        clock.next += 60 / st.bpm / 4;
        clock.step++;
      }
      ph = clamp((rec.t - clock.last) / (60 / st.bpm), 0, 1);
    } else ph = music && audio && audio.ctx.state === 'running' ? music.phase(bpm) : ((tReal * bpm) / 60) % 1;
    pulse = Math.pow(1 - ph, 3);
  }
  if (music && soundOn && !REC) music.tick(musicState());
  if (REC && rec) {
    const st = musicState(), l = rec.states[rec.states.length - 1];
    if (st.layer !== l.layer || st.root !== l.root || Math.abs(st.bpm - l.bpm) > 0.5 || Math.abs(st.depth - l.depth) > 4) rec.states.push({ t: rec.t, ...st });
  }
  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  r.phT += wdt;
  stepCreatures(r, wdt);
  if (mode === 'play') stepPlayer(r, wdt);
  else {
    const L = r.lure;
    if (mode === 'title' || r.phase === 'ready') {
      L.y = READY_Y + Math.sin(r.t * 2) * 3;
      L.x = lerp(L.x, W / 2, 1 - Math.exp(-2 * dt));
    }
    if (r.phase === 'snap') L.y += 30 * wdt;
    if (mode === 'over') overT += dt;
  }
  stepChain(r, wdt);
  stepFlying(r, wdt);
  stepParts(r, wdt);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < (p.life || 1.1));
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.4) r.banner = null;
  }
  if (r.layerPop) {
    r.layerPop.t += dt;
    if (r.layerPop.t > 1.5) r.layerPop = null;
  }
  r.scoreBump = Math.max(0, r.scoreBump - dt * 4);
  // camera
  const zt = r.phase === 'up' || r.phase === 'land' || r.phase === 'turn' ? clamp(1 - r.chain.length * 0.007, 0.74, 1) : 1;
  cam.z = lerp(cam.z, zt, 1 - Math.exp(-2 * dt));
  placeCam();
  const ct = camTarget(r);
  cam.y = lerp(cam.y, ct, 1 - Math.exp(-(r.phase === 'down' ? 7 : 4.5) * dt));
  shake = Math.max(0, shake - dt * 2.5);
  flash = Math.max(0, flash - dt * 2.2);
}

function camTarget(r) {
  const vh = SH / SC;
  const L = r.lure;
  if (OG) return L.y - 0.3 * vh;
  switch (mode === 'play' ? r.phase : mode === 'over' ? r.phase : 'ready') {
    case 'down':
      return L.y - (REC ? 0.36 : 0.34) * vh;
    case 'turn':
      return L.y - 0.36 * vh;
    case 'up':
      return L.y - 0.4 * vh;
    case 'land':
      return -0.42 * vh + 40;
    case 'snap':
      return r.snapY - 0.4 * vh;
    default:
      return READY_Y - 0.42 * vh;
  }
}

function stepCreatures(r, dt) {
  const L = r.lure;
  for (const c of r.cr) {
    if (c.dead) continue;
    if (c.k === 'fish') {
      if (c.flee > 0) {
        c.flee -= dt;
        const s = Math.sign(c.vx) || 1;
        c.vx = s * lerp(c.spd, Math.abs(c.vx), Math.exp(-1.5 * dt));
        c.y0 += c.vy * dt;
        c.vy *= Math.exp(-2 * dt);
      }
      c.x += c.vx * dt;
      const lo = c.L / 2 + 4, hi = W - lo;
      if (c.x < lo && c.vx < 0) c.vx = -c.vx;
      if (c.x > hi && c.vx > 0) c.vx = -c.vx;
      c.y = c.y0 + Math.sin(r.t * 1.4 + c.ph) * 5;
    } else if (c.k === 'shark') {
      if (c.wait > 0) {
        c.wait -= dt;
        if (c.wait <= 0) {
          c.vx = -c.vx;
          c.warned = false;
        }
      } else {
        // a lunge: it speeds up when your catch is right in front of its nose
        let lunge = 1;
        if (c.full <= 0 && (r.phase === 'up' || r.phase === 'down') && c !== r.crashShark) {
          const dir = Math.sign(c.vx);
          for (let i = -1; i < r.chain.length; i++) {
            const n = i < 0 ? L : r.chain[i];
            const ahead = (n.x - c.x) * dir;
            if (ahead > 0 && ahead < 190 && Math.abs(n.y - c.y) < 50) {
              lunge = 1.9;
              break;
            }
          }
        }
        c.lunge = lerp(c.lunge || 1, lunge, 1 - Math.exp(-6 * dt));
        c.x += c.vx * c.lunge * dt;
        if ((c.x < -230 && c.vx < 0) || (c.x > W + 230 && c.vx > 0)) c.wait = 0.4 + hash(c.ph * 99 + r.t) * 2.2;
      }
      // hungry sharks smell the catch: they drift toward the nearest fish on your line
      if (c.full <= 0 && r.phase === 'up' && r.chain.length && c.x > -60 && c.x < W + 60) {
        let ty = null, bd = 260;
        for (const n of r.chain) {
          const dd = Math.abs(n.y - c.y0);
          if (dd < bd) {
            bd = dd;
            ty = n.y;
          }
        }
        if (ty != null) c.y0 += clamp(ty - c.y0, -1, 1) * Math.min(Math.abs(ty - c.y0), 70 * dt);
      }
      c.y = c.y0 + Math.sin(r.t * 0.9 + c.ph) * 10;
      c.full = Math.max(0, c.full - dt);
      c.chomp = Math.max(0, c.chomp - dt);
      // the warning: two low notes when a shark heads in near your hook
      const off = c.x < 0 ? c.vx > 0 : c.x > W ? c.vx < 0 : false;
      if (mode === 'play' && !c.warned && off && c.wait <= 0 && Math.abs(c.y - L.y) < 320 && (r.phase === 'down' || r.phase === 'up') && Math.abs(c.x - W / 2) < W / 2 + 160) {
        c.warned = true;
        sfx('warn');
      }
      if (mode === 'play' && !sharkTip && !r.bot && Math.abs(c.y - L.y) < 260 && c.x > -40 && c.x < W + 40 && (r.phase === 'down' || r.phase === 'up')) {
        sharkTip = true;
        store.set('stip', true);
        r.banner = { text: 'SHARK!', sub: 'it eats the fish off your line · never let it touch the hook', t: 0, col: CORAL };
      }
    } else {
      c.x = c.x0 + Math.sin(r.t * 0.5 + c.ph) * 22;
      c.y = c.y0 + Math.sin(r.t * 0.9 + c.ph) * 16;
      c.full = Math.max(0, c.full - dt);
    }
  }
}

function stepPlayer(r, dt) {
  const L = r.lure;
  const d = Math.max(0, L.y / M);
  // steering: the hook slides toward your finger (or the mouse, or the arrow keys)
  if (r.bot) {
    // ?lag= makes the bot think like a human: a fresh decision only every lag seconds
    r.botT = (r.botT || 0) - dt;
    if (!r.botLag || r.botT <= 0) {
      L.tx = botTarget(r) + (r.botLag ? (Math.random() - 0.5) * 30 : 0);
      r.botT = r.botLag;
    }
  }
  else if (keyL || keyR) {
    aimX = null;
    L.tx = clamp(L.x + ((keyR ? 1 : 0) - (keyL ? 1 : 0)) * 32, 14, W - 14);
  } else if (aimX != null) L.tx = clamp((aimX - OX) / SC, 14, W - 14);
  if (r.phase === 'ready' || r.phase === 'down' || r.phase === 'up') {
    const want = clamp(L.tx, 14, W - 14);
    const mv = clamp((want - L.x) * (1 - Math.exp(-14 * dt)), -900 * dt, 900 * dt);
    L.x += mv;
    L.vx = dt > 0 ? mv / dt : 0;
  } else L.vx *= Math.exp(-6 * dt);
  L.ang = lerp(L.ang, clamp(L.vx / 700, -0.5, 0.5), 1 - Math.exp(-10 * dt));

  if (r.phase === 'ready') {
    L.y = lerp(L.y, READY_Y + Math.sin(r.t * 2) * 3, 1 - Math.exp(-6 * dt));
    if (holding(r)) {
      r.phase = 'down';
      r.phT = 0;
      sfx('splash', { big: false });
    }
    return;
  }
  if (r.phase === 'down') {
    if (holding(r)) L.y += downV(d) * dt;
    else if (L.y < HOVER_Y) L.y = lerp(L.y, Math.max(READY_Y, L.y - 10), 1 - Math.exp(-2 * dt));
    else return startReel(r, 'REEL IN!');
    if (L.y > r.maxD * M) trackDepth(r, L.y / M);
    ensureWorld(r, L.y + 1500);
    bubbles(r, dt);
    for (const c of r.cr) {
      if (c.dead || Math.abs(c.y - L.y) > 90) continue;
      if (c.k === 'fish') {
        if (c.flee <= 0 && fishDist(c, L.x, L.y) < LURE_R) {
          hookFish(r, c);
          return startReel(r, 'HOOKED!');
        }
      } else if (hazard(r, c)) return;
    }
    return;
  }
  if (r.phase === 'turn') {
    L.y -= Math.sin(clamp(r.phT / 0.45, 0, 1) * Math.PI) * 30 * dt;
    if (r.phT > 0.45) {
      r.phase = 'up';
      r.phT = 0;
    }
    return;
  }
  if (r.phase === 'up') {
    L.y -= upV(d) * dt;
    bubbles(r, dt);
    if (REC && rec) recCrash(r);
    for (const c of r.cr) {
      if (c.dead || Math.abs(c.y - L.y) > 120 + r.chain.length * 16) continue;
      if (c.k === 'fish') {
        if (c.flee <= 0 && Math.abs(c.y - L.y) < 40 && fishDist(c, L.x, L.y) < CATCH_R) hookFish(r, c);
        continue;
      }
      if (hazard(r, c)) return;
      if (c.full > 0) continue;
      for (let i = 0; i < r.chain.length; i++) {
        const n = r.chain[i];
        if (hazDist(c, n.x, n.y) < nodeR(n)) {
          bite(r, c, i);
          break;
        }
      }
    }
    if (L.y <= 0) land(r);
    return;
  }
  if (r.phase === 'land') return stepLand(r, dt);
  if (r.phase === 'snap') {
    L.y += 30 * dt;
    if (r.phT > 1.8) gameOver(r);
  }
}

// a shark or jelly against the hook: snap on contact, a CLOSE! bonus for a near miss
function hazard(r, c) {
  const L = r.lure;
  const dd = hazDist(c, L.x, L.y);
  if (c.full > 0) return false;
  if (dd < LURE_R) {
    snap(r, c);
    return true;
  }
  if (dd < LURE_R + 16) c.near = true;
  else if (c.near && dd > LURE_R + 40) {
    c.near = false;
    r.bonus += 2;
    r.scoreBump = 1;
    pop(r, L.x + (c.x < L.x ? 30 : -30), L.y - 10, 'CLOSE! +2', '#7cf3ff', 22);
    sfx('close');
  }
  return false;
}

function trackDepth(r, d) {
  r.maxD = d;
  const z = zoneAt(d);
  if (z > r.zone) {
    r.zone = z;
    r.banner = { text: ZONES[z].name, sub: ZONES[z].at + ' m down · fish here are worth more', t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z] });
  }
  const l = layerFor(d);
  if (l > r.layer) {
    r.layer = l;
    r.layerPop = { name: LAYER_NAMES[l], t: 0 };
  }
  if (!r.deepPassed && bestD >= 5 && d > bestD && !REC) {
    r.deepPassed = true;
    pop(r, r.lure.x, r.lure.y + 30, 'NEW DEEPEST!', GOLD, 26);
    sfx('ding', { m: ZONE_ROOTS[z] + 31, big: true });
  }
}

function startReel(r, label) {
  r.phase = 'turn';
  r.phT = 0;
  r.reelLabel = label;
  pop(r, r.lure.x, r.lure.y - 30, label, label === 'HOOKED!' ? GOLD : '#fff', 30, 1.2);
  sfx('reel');
  vibrate(15);
}

function hookFish(r, c) {
  c.dead = true;
  const s = SPECIES[c.sp];
  const L = r.lure;
  r.chain.unshift({ sp: c.sp, x: L.x, y: L.y + 8, px: L.x, py: L.y + 8, L: c.L, H: c.H, ph: c.ph, gold: c.gold, ang: -Math.PI / 2 });
  r.haul += s.pts;
  r.caught++;
  r.scoreBump = 1;
  const root = ZONE_ROOTS[zoneAt(L.y / M)];
  sfx('bloop', { m: dingNote(root, Math.min(r.chain.length, 14)) });
  pop(r, L.x + 22, L.y - 8, '+' + s.pts, c.gold ? GOLD : s.pts >= 8 ? '#7cf3ff' : '#fff', s.pts >= 8 ? 26 : 20);
  if (c.gold) {
    pop(r, L.x, L.y - 40, 'GOLDEN FISH!', GOLD, 26);
    sfx('coin');
  }
  for (let i = 0; i < 6; i++) r.parts.push({ x: L.x, y: L.y, vx: (Math.random() - 0.5) * 140, vy: -Math.random() * 120, life: 0.6, max: 0.6, type: 'bub', s: 2 + Math.random() * 3 });
  if (!r.hookedOne) r.hookedOne = true;
  vibrate(8);
}

function freeFish(r, n, flee) {
  const f = addFish(r, n.sp, n.x, n.y, { flee, vx: (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 120) });
  f.vy = (Math.random() - 0.5) * 120;
  f.gold = n.gold;
  f.L = n.L;
  f.H = n.H;
}

function bite(r, c, i) {
  const lost = r.chain.splice(i);
  const pts = lost.reduce((a, n) => a + SPECIES[n.sp].pts, 0);
  const at = lost[0];
  lost.slice(1).forEach(n => freeFish(r, n, 1.0)); // the rest swim off: catch them again!
  r.haul -= pts;
  r.bites++;
  c.full = 1.6;
  c.chomp = 0.35;
  c.near = false;
  pop(r, at.x, at.y, 'CHOMP! −' + lost.length, CORAL, 30, 1.3);
  for (let k = 0; k < 10; k++) r.parts.push({ x: at.x, y: at.y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, life: 0.5, max: 0.5, type: 'bub', s: 2 + Math.random() * 4 });
  sfx('chomp');
  vibrate(60);
  shake = Math.max(shake, 0.5);
}

function snap(r, c) {
  const L = r.lure;
  r.lost = r.chain.length;
  r.lostPts = r.haul + r.bonus;
  r.snapD = Math.max(0, Math.round(L.y / M));
  r.snapBy = c.k;
  r.snapY = L.y;
  r.chain.forEach(n => freeFish(r, n, 99));
  r.chain = [];
  r.haul = 0;
  r.bonus = 0;
  r.phase = 'snap';
  r.phT = 0;
  r.slow = 0.3;
  r.slowT = 0.55;
  c.full = 3;
  c.chomp = 0.5;
  if (c.k === 'shark') c.vx *= 0.3; // it hangs around, chewing
  shake = 1;
  flash = 0.5;
  r.banner = { text: 'SNAPPED!', sub: r.lost ? `${r.lost} fish gone, ${r.snapD} m from the boat` : c.k === 'jelly' ? 'zapped by a jellyfish' : 'a shark bit through your line', t: 0, col: CORAL };
  for (let k = 0; k < 16; k++) r.parts.push({ x: L.x, y: L.y, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, life: 0.7, max: 0.7, type: 'bub', s: 2 + Math.random() * 5 });
  sfx('snap');
  vibrate([90, 40, 140]);
}

function land(r) {
  r.phase = 'land';
  r.phT = 0;
  r.score = 0;
  r.landQ = r.chain.length;
  r.landNext = 0.3;
  sfx('splash');
  for (let k = 0; k < 14; k++) r.parts.push({ x: r.lure.x, y: 0, vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 220, life: 0.8, max: 0.8, type: 'drop', s: 2 + Math.random() * 3 });
}

function stepLand(r, dt) {
  const L = r.lure, tip = rodTip();
  L.x = lerp(L.x, tip.x, 1 - Math.exp(-6 * dt));
  L.y = lerp(L.y, tip.y + 46, 1 - Math.exp(-6 * dt));
  r.landNext -= dt;
  if (r.chain.length && r.landNext <= 0) {
    const n = r.chain.shift();
    const k = r.flying.length + r.landedN;
    r.flying.push({ ...n, t: 0, T: 0.55, x0: n.x, y0: n.y, x1: BOAT_X - 34 + hash(k * 3.7) * 60, y1: -20 - hash(k * 1.9) * 6, spin: (hash(k) - 0.5) * 14 });
    r.landNext = clamp(1.8 / Math.max(1, r.landQ), 0.05, 0.12);
  }
  if (!r.chain.length && !r.flying.length) {
    if (!r.landDone) {
      r.landDone = r.phT;
      if (r.bonus > 0) {
        r.score += r.bonus;
        r.scoreBump = 1;
        pop(r, BOAT_X, -110, 'CLOSE CALLS +' + r.bonus, '#7cf3ff', 24, 1.4);
        sfx('coin');
        bestCheck(r);
      }
    } else if (r.phT - r.landDone > (r.landedN ? 0.9 : 0.5)) gameOver(r);
  }
}

function stepFlying(r, dt) {
  for (const f of r.flying) {
    f.t += dt;
    if (f.t >= f.T) {
      f.done = true;
      const s = SPECIES[f.sp];
      r.score += s.pts;
      r.landedN++;
      r.pileSp.push(f.sp);
      if (f.gold) r.goldLanded++;
      r.scoreBump = 1;
      sfx('ding', { m: dingNote(ZONE_ROOTS[0], Math.min(r.landedN, 14)), big: s.pts >= 10 });
      if (f.gold) sfx('coin');
      vibrate(5);
      bestCheck(r);
    }
  }
  r.flying = r.flying.filter(f => !f.done);
}
function flyPos(f) {
  const u = clamp(f.t / f.T, 0, 1);
  return { x: lerp(f.x0, f.x1, u), y: lerp(f.y0, f.y1, u) - Math.sin(u * Math.PI) * 150, a: f.spin * u };
}

function bestCheck(r) {
  if (!r.bestShown && best > 0 && r.score > best && !REC && !r.bot) {
    r.bestShown = true;
    r.banner = { text: 'NEW BEST!', sub: 'previous best ' + best, t: 0, col: GOLD };
    sfx('best', { root: ZONE_ROOTS[0] });
    flash = 0.3;
  }
}

function gameOver(r) {
  mode = 'over';
  overT = 0;
  r.snapped = r.phase === 'snap';
  const earned = r.snapped ? Math.floor(r.maxD / 10) : Math.floor(r.score / 4) + r.goldLanded * 3;
  r.earned = earned;
  if (r.bot) return;
  coins += earned;
  store.set('coins', coins);
  r.prevBest = best;
  r.isBest = !r.snapped && r.score > best;
  if (r.isBest) {
    best = r.score;
    store.set('best', best);
  }
  r.prevDeep = bestD;
  if (Math.floor(r.maxD) > bestD) {
    bestD = Math.floor(r.maxD);
    store.set('bestd', bestD);
  }
}

// The stringer: a rope of hooked fish hanging under the hook (follow-the-leader verlet).
function stepChain(r, dt) {
  const L = r.lure;
  let px = L.x, py = L.y + 8;
  for (const n of r.chain) {
    const vx = (n.x - n.px) * 0.9, vy = (n.y - n.py) * 0.9;
    n.px = n.x;
    n.py = n.y;
    n.x += vx;
    n.y += vy + 900 * dt * dt;
    const sp = 4 + n.L * 0.5;
    const dx = n.x - px, dy = n.y - py;
    const dl = Math.hypot(dx, dy) || 1;
    if (dl > sp) {
      n.x = px + (dx / dl) * sp;
      n.y = py + (dy / dl) * sp;
    }
    n.x = clamp(n.x, 4, W - 4);
    n.ang = Math.atan2(py - n.y, px - n.x);
    px = n.x;
    py = n.y;
  }
}

function bubbles(r, dt) {
  r.bubT -= dt;
  if (r.bubT > 0) return;
  r.bubT = 0.07;
  const L = r.lure;
  r.parts.push({ x: L.x + (Math.random() - 0.5) * 6, y: L.y - 4, vx: (Math.random() - 0.5) * 20, vy: -50 - Math.random() * 40, life: 1.2, max: 1.2, type: 'bub', s: 1.5 + Math.random() * 2.5 });
}
function stepParts(r, dt) {
  for (const p of r.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.type === 'drop') p.vy += 700 * dt;
    else {
      p.vx *= Math.exp(-3 * dt);
      p.vy = lerp(p.vy, -70, 1 - Math.exp(-2 * dt));
    }
  }
  r.parts = r.parts.filter(p => p.life > 0 && (p.type !== 'bub' || p.y > 2));
  if (r.parts.length > 300) r.parts.splice(0, r.parts.length - 300);
}
function pop(r, x, y, text, col, size = 22, life = 1.1) {
  r.pops.push({ x, y, text, col, size, t: 0, life });
}

// ---------------------------------------------------------------- bots
// Picks the column with the least danger (and, on the way up, the most fish) ahead.
function botTarget(r) {
  const L = r.lure;
  if (r.botFreeze) return L.x;
  const up = r.phase === 'up';
  if (!up && r.phase !== 'down') return L.x;
  const v = up ? upV(L.y / M) : downV(L.y / M);
  const look = up ? 440 : 380;
  const near = r.cr.filter(k => !k.dead && Math.abs(k.y - L.y) < look + 60 && k !== r.crashShark);
  let bestX = L.x, bestC = Infinity;
  for (let x = 16; x <= W - 16; x += 8) {
    let c = Math.abs(x - L.x) * (up ? 0.003 : 0.006);
    for (const k of near) {
      const ahead = up ? L.y - k.y : k.y - L.y;
      if (ahead < -40 || ahead > look) continue;
      const t = Math.max(0, ahead) / v;
      let px = k.x + k.vx * t;
      if (k.k === 'fish') {
        const lo = k.L / 2 + 4, hi = W - lo;
        for (let i = 0; i < 2; i++) {
          if (px < lo) px = 2 * lo - px;
          else if (px > hi) px = 2 * hi - px;
        }
      }
      const dx = Math.abs(x - px);
      if (k.k === 'fish') {
        if (!up) {
          const half = k.L * 0.5 + 10;
          if (dx < half) c += (3 * (1.2 - dx / half)) / (t + 0.3);
        } else if (!(k.flee > 0.3)) {
          const half = k.L * 0.5 + 14;
          if (dx < half) c -= (0.5 * (r.botGreed || 1) * (1 + SPECIES[k.sp].pts * 0.25) * (1 - dx / half)) / (t + 0.5);
        }
      } else {
        const half = k.k === 'shark' ? k.L * 0.5 + 34 : k.r + 26;
        if (dx < half) c += (12 * (1.3 - dx / half)) / (t + 0.2);
      }
    }
    if (c < bestC) {
      bestC = c;
      bestX = x;
    }
  }
  return bestX;
}

// Record mode: a shark arrives right on time to snap the line at ?crash= metres.
function recCrash(r) {
  if (rec.crash == null || r.crashShark) return;
  const L = r.lure;
  const yc = rec.crash * M;
  const tArr = (L.y - yc) / upV(L.y / M);
  if (tArr > 1.6) return;
  const dir = L.x < W / 2 ? -1 : 1;
  const sp = 330;
  r.crashShark = addShark(r, yc, rec.crash, { dir, speed: sp, x: L.x - dir * sp * (tArr + 0.05), L: 140 });
  r.crashShark.warned = true;
  r.botFreeze = true;
  sfx('warn');
}

// ---------------------------------------------------------------- render
let shakeX = 0, shakeY = 0;
function worldT() {
  g.setTransform(DPR * SC, 0, 0, DPR * SC, DPR * (OX + shakeX), DPR * (-cam.y * SC + shakeY));
}
function screenT() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function render() {
  screenT();
  shakeX = (Math.random() - 0.5) * shake * 16 * U;
  shakeY = (Math.random() - 0.5) * shake * 16 * U;
  const r = run;
  drawBackdrop();
  worldT();
  drawRays();
  drawRocks();
  if (r) {
    drawDeepest(r);
    drawCreatures(r);
    drawLine(r);
    drawChain(r);
    if (r.phase !== 'snap' || mode !== 'over' || overT < 0.6) drawLure(r.lure.x, r.lure.y, r.lure.ang, lureId, r.t);
    drawParts(r);
  }
  drawBoat(r);
  drawSurface();
  screenT();
  drawDark(r);
  worldT();
  if (r) drawGlow(r);
  screenT();
  drawSnow();
  if (r) {
    drawWarnings(r);
    drawPops(r);
  }
  if (flash > 0.01) {
    g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, SW, SH);
  }
  buttons = [];
  if (OG) return drawOgTitle();
  if (mode === 'title') drawTitle();
  else {
    if (!(REC && (mode === 'over' || hookOn() || cap2On(r)))) drawHUD(r);
    if (mode === 'over') drawOver(r);
  }
  // fish flying into the boat arc up over the HUD
  if (r && r.flying.length && mode !== 'over') {
    worldT();
    for (const f of r.flying) {
      const p = flyPos(f);
      drawFish(p.x, p.y, -Math.PI / 2 + p.a, false, f.sp, 1, r.t * 14 + f.ph, f.gold);
    }
    screenT();
  }
  if (REC) drawCaptions(r);
}

const worldY = py => cam.y + py / SC;

function drawBackdrop() {
  const s0 = sy(0);
  if (s0 > 0) {
    const gr = g.createLinearGradient(0, 0, 0, s0);
    gr.addColorStop(0, '#5ec8ff');
    gr.addColorStop(1, '#d9f4ff');
    g.fillStyle = gr;
    g.fillRect(0, 0, SW, Math.min(SH, s0 + 2));
    // sun and clouds
    const sunX = SW * 0.8, sunY = s0 - 230 * SC;
    if (sunY > -60 * SC) {
      g.fillStyle = 'rgba(255,240,170,0.45)';
      g.beginPath();
      g.arc(sunX, sunY, 46 * SC, 0, TAU);
      g.fill();
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.arc(sunX, sunY, 30 * SC, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 4; i++) {
      const cx = ((hash(i * 4.1) * SW + tReal * (6 + i * 3) * U) % (SW + 200 * U)) - 100 * U;
      const cy = s0 - (150 + hash(i * 9.3) * 170) * SC;
      if (cy < -40 * SC) continue;
      const k = (0.7 + hash(i * 2.2) * 0.6) * SC;
      g.beginPath();
      g.ellipse(cx, cy, 34 * k, 12 * k, 0, 0, TAU);
      g.ellipse(cx + 18 * k, cy - 8 * k, 20 * k, 13 * k, 0, 0, TAU);
      g.ellipse(cx - 16 * k, cy - 5 * k, 15 * k, 10 * k, 0, 0, TAU);
      g.fill();
    }
  }
  const top = Math.max(0, s0);
  if (top < SH) {
    const gr = g.createLinearGradient(0, top, 0, SH);
    for (let i = 0; i <= 4; i++) {
      const p = lerp(top, SH, i / 4);
      gr.addColorStop(i / 4, css(zoneCol(ZW, worldY(p) / M)));
    }
    g.fillStyle = gr;
    g.fillRect(0, top, SW, SH - top);
  }
}

function drawRays() {
  const y1 = 700;
  if (cam.y > y1) return;
  for (let i = 0; i < 6; i++) {
    const x = -40 + i * 92 + Math.sin(tReal * 0.35 + i * 1.7) * 24;
    const w = 14 + hash(i) * 22;
    const gr = g.createLinearGradient(0, 0, 0, y1);
    gr.addColorStop(0, `rgba(255,255,255,${0.1 + 0.05 * Math.sin(tReal * 0.8 + i)})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w, 0);
    g.lineTo(x + w, 0);
    g.lineTo(x + w + 150, y1);
    g.lineTo(x + 50, y1);
    g.closePath();
    g.fill();
  }
}

const edgeAt = y => 6 + 7 * Math.sin(y * 0.0123 + 1.3) * Math.sin(y * 0.0047 + 0.4) + 4 * Math.sin(y * 0.041);
function drawRocks() {
  const top = Math.max(6, worldY(0) - 40), bot = worldY(SH) + 40;
  if (bot < 0) return;
  const mid = (top + bot) / 2 / M;
  const col = zoneCol(ZR, mid);
  const far = 3000;
  for (const side of [-1, 1]) {
    const ex = y => (side < 0 ? edgeAt(y) : W - edgeAt(y + 777));
    g.beginPath();
    g.moveTo(side < 0 ? -far : W + far, top);
    for (let y = top; y <= bot; y += 14) g.lineTo(ex(y), y);
    g.lineTo(ex(bot), bot);
    g.lineTo(side < 0 ? -far : W + far, bot);
    g.closePath();
    g.fillStyle = css(col);
    g.fill();
    // texture: darker boulders
    const k0 = Math.floor(top / 70), k1 = Math.ceil(bot / 70);
    g.fillStyle = css(shade(col, 0.72));
    for (let k = k0; k <= k1; k++) {
      for (let j = 0; j < 3; j++) {
        const h = hash(k * 13.1 + j * 3.7 + side * 0.5);
        const x = side < 0 ? -30 - h * 260 - j * 120 : W + 30 + h * 260 + j * 120;
        const y = k * 70 + hash(k * 5.3 + j) * 70;
        if (y < 34) continue; // nothing pokes out above the waterline
        g.beginPath();
        g.ellipse(x, y, 16 + h * 30, 10 + h * 16, h * 3, 0, TAU);
        g.fill();
      }
    }
    // a lit rim along the edge
    g.beginPath();
    for (let y = top; y <= bot; y += 14) (y === top ? g.moveTo : g.lineTo).call(g, ex(y), y);
    g.strokeStyle = css(shade(col, 1.6), 0.8);
    g.lineWidth = 3;
    g.stroke();
    // kelp in the shallows, coral further down
    const c0 = Math.floor(top / 110), c1 = Math.ceil(bot / 110);
    for (let k = Math.max(1, c0); k <= c1; k++) {
      const h = hash(k * 7.9 + side * 3.3);
      const y = k * 110 + h * 60;
      const d = y / M;
      const x = ex(y) - side * 2;
      if (d < 70 && h < 0.6) {
        const len = 70 + h * 90;
        const sw = Math.sin(tReal * 1.3 + k) * 14;
        g.strokeStyle = d < 35 ? '#2f9e5a' : '#3a7f52';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x - side * 26 + sw * 0.5, y - len * 0.5, x - side * 10 + sw, y - len);
        g.stroke();
        g.lineCap = 'butt';
      } else if (d >= 20 && d < 140 && h > 0.45) {
        const cc = ['#ff6f91', '#ff9f43', '#c56cf0', '#ff5e57'][(h * 40) % 4 | 0];
        g.fillStyle = cc;
        g.strokeStyle = INK;
        g.lineWidth = 1.5;
        for (let j = 0; j < 4; j++) {
          g.beginPath();
          g.arc(x - side * (6 + j * 6), y - j * 9 - hash(k + j) * 6, 7 - j, 0, TAU);
          g.fill();
          g.stroke();
        }
      }
    }
  }
}

function drawDeepest(r) {
  if (bestD < 5 || REC) return;
  const y = bestD * M;
  if (sy(y) < -20 || sy(y) > SH + 20) return;
  g.strokeStyle = 'rgba(255,214,80,0.8)';
  g.lineWidth = 2.5;
  g.setLineDash([10, 8]);
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(W, y);
  g.stroke();
  g.setLineDash([]);
  screenT();
  text('DEEPEST ' + bestD + ' m', sx(W) - 8 * U, sy(y) - 12 * U, 13 * U, '#ffd650', 'right', { stroke: 4 * U });
  worldT();
}

function drawCreatures(r) {
  const top = worldY(0) - 80, bot = worldY(SH) + 80;
  g.save();
  g.beginPath();
  g.rect(-4, top, W + 8, bot - top);
  g.clip();
  for (const c of r.cr) {
    if (c.dead || c.y < top || c.y > bot) continue;
    if (c.k === 'jelly') drawJelly(c, r.t);
  }
  for (const c of r.cr) {
    if (c.dead || c.k !== 'fish' || c.y < top || c.y > bot) continue;
    g.globalAlpha = c.flee > 0 && c.flee < 50 ? 0.55 + 0.45 * Math.sin(r.t * 30) ** 2 : 1;
    drawFish(c.x, c.y, 0, c.vx < 0, c.sp, c.L / SPECIES[c.sp].L, r.t * (6 + Math.abs(c.vx) * 0.06) + c.ph, c.gold);
    g.globalAlpha = 1;
  }
  for (const c of r.cr) {
    if (c.dead || c.k !== 'shark' || c.y < top || c.y > bot) continue;
    drawShark(c.x, c.y, c.vx < 0 ? -1 : 1, c.L, r.t + c.ph, c.chomp > 0, c.full > 0);
  }
  g.restore();
}

function rodTip() {
  const bob = Math.sin(tReal * 1.6) * 2.2, tilt = Math.sin(tReal * 1.3) * 0.03;
  const dx = ROD.x - BOAT_X, dy = ROD.y;
  return { x: BOAT_X + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: bob + dx * Math.sin(tilt) + dy * Math.cos(tilt) };
}

function drawLine(r) {
  const t = rodTip(), L = r.lure;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(t.x, t.y);
  if (r.phase === 'snap') {
    // the broken end drifts in the current
    const k = Math.min(1, r.phT / 0.8);
    const ex = lerp(L.x, t.x + 30, k * 0.4), ey = lerp(r.snapY, Math.max(30, r.snapY * 0.6), k);
    g.quadraticCurveTo(t.x + 20, 20, ex + Math.sin(r.t * 3) * 10, ey);
  } else {
    const sag = r.phase === 'land' ? 0 : 14;
    g.quadraticCurveTo((t.x + L.x) / 2, (t.y + L.y) / 2 + sag, L.x, L.y - 9);
  }
  g.stroke();
}

function drawChain(r) {
  if (!r.chain.length) return;
  const L = r.lure;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(L.x, L.y + 6);
  for (const n of r.chain) g.lineTo(n.x, n.y);
  g.stroke();
  for (let i = r.chain.length - 1; i >= 0; i--) {
    const n = r.chain[i];
    drawFish(n.x, n.y, n.ang, false, n.sp, (n.L / SPECIES[n.sp].L) * 0.92, r.t * 11 + n.ph, n.gold);
  }
}

function drawParts(r) {
  for (const p of r.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.type === 'drop') {
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc(p.x, p.y, p.s, 0, TAU);
      g.fill();
    } else {
      g.strokeStyle = `rgba(255,255,255,${0.7 * a})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(p.x + Math.sin(p.y * 0.08) * 2, p.y, p.s, 0, TAU);
      g.stroke();
    }
  }
}

function drawSurface() {
  const s0 = sy(0);
  if (s0 < -30 || s0 > SH + 30) return;
  const x0 = worldXAt(0) - 20, x1 = worldXAt(SW) + 20;
  const wave = x => Math.sin(x * 0.03 + tReal * 2) * 2.5 + Math.sin(x * 0.011 - tReal * 1.2) * 2;
  g.beginPath();
  g.moveTo(x0, 16);
  for (let x = x0; x <= x1; x += 10) g.lineTo(x, wave(x));
  g.lineTo(x1, 16);
  g.closePath();
  g.fillStyle = 'rgba(120,220,255,0.55)';
  g.fill();
  g.beginPath();
  for (let x = x0; x <= x1; x += 10) (x === x0 ? g.moveTo : g.lineTo).call(g, x, wave(x));
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.stroke();
}
const worldXAt = px => (px - OX) / SC;

function drawDark(r) {
  const d = worldY(SH * 0.5) / M;
  const a = clamp((d - 50) / 170, 0, 0.66);
  if (a <= 0.01 || !r) return;
  const L = r.lure;
  const lx = sx(L.x), ly = sy(L.y);
  const rad = (lureId === 'neon' || lureId === 'diamond' ? 210 : 180) * SC;
  const gr = g.createRadialGradient(lx, ly, 20 * SC, lx, ly, rad);
  gr.addColorStop(0, 'rgba(2,4,16,0)');
  gr.addColorStop(1, `rgba(2,4,16,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
}

// Bioluminescence: drawn over the darkness so the deep stays readable.
function drawGlow(r) {
  const d = worldY(SH * 0.5) / M;
  const a = clamp((d - 40) / 80, 0, 1);
  const top = worldY(0) - 80, bot = worldY(SH) + 80;
  const L = r.lure;
  if (a > 0) {
    g.save();
    g.beginPath();
    g.rect(-4, top, W + 8, bot - top);
    g.clip();
    for (const c of r.cr) {
      if (c.dead || c.y < top || c.y > bot) continue;
      if (c.k === 'jelly') {
        g.globalAlpha = a * 0.8;
        drawJelly(c, r.t);
      } else if (c.k === 'shark') {
        const dir = c.vx < 0 ? -1 : 1;
        g.globalAlpha = a;
        g.fillStyle = '#ffe66b';
        g.shadowColor = '#ffe66b';
        g.shadowBlur = 10;
        g.beginPath();
        g.arc(c.x + dir * c.L * 0.33, c.y - c.L * 0.035, 3, 0, TAU);
        g.fill();
        g.shadowBlur = 0;
      } else {
        const s = SPECIES[c.sp];
        if (!s.glow && !c.gold) continue;
        g.globalAlpha = a * (c.flee > 0 ? 0.6 : 1);
        if (c.sp === 'ghost' || c.gold) drawFish(c.x, c.y, 0, c.vx < 0, c.sp, c.L / s.L, r.t * 7 + c.ph, c.gold);
        glowBits(c.x, c.y, c.vx < 0 ? -1 : 1, c.sp, c.L / s.L, r.t);
      }
    }
    g.globalAlpha = 1;
    g.restore();
    // decorations on the cliffs: glowing polyps in the deep
    const k0 = Math.floor(top / 90), k1 = Math.ceil(bot / 90);
    for (let k = Math.max(1, k0); k <= k1; k++) {
      const yy = k * 90 + hash(k * 2.1) * 50;
      if (yy / M < 110) continue;
      for (const side of [-1, 1]) {
        const h = hash(k * 4.4 + side);
        if (h < 0.4) continue;
        const ex = side < 0 ? edgeAt(yy) : W - edgeAt(yy + 777);
        g.fillStyle = h > 0.7 ? 'rgba(124,243,255,0.8)' : 'rgba(255,93,240,0.7)';
        for (let j = 0; j < 3; j++) {
          g.beginPath();
          g.arc(ex - side * (4 + j * 7), yy - j * 8, 2.5 + 2 * Math.sin(tReal * 2 + k + j) ** 2, 0, TAU);
          g.fill();
        }
      }
    }
  }
  // the chain and hook are always lit
  if (a > 0.2) {
    g.globalAlpha = a * 0.9;
    for (const n of r.chain) if (SPECIES[n.sp].glow) glowBits(n.x, n.y, 1, n.sp, 0.92, r.t, n.ang);
    g.globalAlpha = 1;
    if (mode !== 'over' || r.phase !== 'snap') {
      g.fillStyle = 'rgba(255,240,180,0.25)';
      g.beginPath();
      g.arc(L.x, L.y, 16 + pulse * 4, 0, TAU);
      g.fill();
    }
  }
}
function glowBits(x, y, dir, sp, sc, t, ang = 0) {
  const s = SPECIES[sp];
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  if (dir < 0) g.scale(-1, 1);
  const L = s.L * sc, H = s.H * sc;
  g.fillStyle = s.glow || GOLD;
  g.shadowColor = s.glow || GOLD;
  g.shadowBlur = 8;
  if (sp === 'lantern') {
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(L * (0.25 - i * 0.16), H * 0.26, 1.6, 0, TAU);
      g.fill();
    }
  } else if (sp === 'angler') {
    g.beginPath();
    g.arc(L * 0.62, -H * 0.85, 3.5 + Math.sin(t * 5) * 0.8, 0, TAU);
    g.fill();
  } else if (sp === 'hatchet') {
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(L * (0.2 - i * 0.12), H * 0.36, 1.4, 0, TAU);
      g.fill();
    }
  }
  g.shadowBlur = 0;
  g.restore();
}

function drawSnow() {
  const d = worldY(SH * 0.5) / M;
  const a = clamp((d - 15) / 40, 0, 0.6);
  if (a <= 0) return;
  const span = SH * 1.2;
  for (const p of snow) {
    let y = (p.y * span - cam.y * SC * p.s * 0.6 + tReal * 10 * U * p.s) % span;
    if (y < 0) y += span;
    y -= SH * 0.1;
    g.fillStyle = `rgba(220,240,255,${a * p.s})`;
    g.beginPath();
    g.arc(p.x * SW + Math.sin(tReal * 0.6 + p.y * 20) * 6 * U, y, p.r * U, 0, TAU);
    g.fill();
  }
}

// "!" at the edge of the reef where a shark is about to come out
function drawWarnings(r) {
  if (mode === 'title') return;
  for (const c of r.cr) {
    if (c.dead || c.k !== 'shark') continue;
    const inbound = (c.x < -10 && c.vx > 0) || (c.x > W + 10 && c.vx < 0);
    if (!inbound || c.wait > 0) continue;
    const dist = c.x < 0 ? -c.x : c.x - W;
    if (dist > 230) continue;
    const y = sy(c.y);
    if (y < 40 * U || y > SH - 30 * U) continue;
    const x = c.x < 0 ? sx(0) + 20 * U : sx(W) - 20 * U;
    const k = 1 - dist / 230;
    const p = 0.5 + 0.5 * Math.sin(tReal * 14);
    g.globalAlpha = 0.5 + 0.5 * k;
    g.fillStyle = CORAL;
    g.beginPath();
    g.arc(x, y, (12 + p * 3 * k) * U, 0, TAU);
    g.fill();
    g.lineWidth = 2.5 * U;
    g.strokeStyle = '#fff';
    g.stroke();
    text('!', x, y + 1 * U, 18 * U, '#fff');
    g.globalAlpha = 1;
  }
}

// ---------- creatures
function drawFish(x, y, ang, flip, sp, sc, t, gold) {
  const s = SPECIES[sp];
  const L = s.L * sc, H = s.H * sc;
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  if (flip) g.scale(-1, 1);
  const wig = Math.sin(t) * 0.22;
  g.lineWidth = 1.6;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  // tail
  g.fillStyle = s.fin;
  g.beginPath();
  g.moveTo(-L * 0.36, 0);
  g.lineTo(-L * 0.6, -H * 0.5 + wig * H);
  g.quadraticCurveTo(-L * 0.5, wig * H * 0.5, -L * 0.6, H * 0.5 + wig * H);
  g.closePath();
  g.fill();
  g.stroke();
  // fins
  g.beginPath();
  if (sp === 'hatchet') {
    g.moveTo(-L * 0.2, -H * 0.4);
    g.lineTo(-L * 0.05, -H * 0.62);
    g.lineTo(L * 0.08, -H * 0.42);
  } else {
    g.moveTo(-L * 0.16, -H * 0.4);
    g.quadraticCurveTo(-L * 0.04, -H * (sp === 'tuna' ? 0.95 : 0.82), L * 0.12, -H * 0.4);
  }
  g.fill();
  g.stroke();
  // body
  g.fillStyle = gold ? '#ffc21a' : s.back;
  const body = new Path2D();
  if (sp === 'hatchet') {
    body.moveTo(L * 0.45, -H * 0.1);
    body.quadraticCurveTo(L * 0.3, -H * 0.5, -L * 0.1, -H * 0.42);
    body.lineTo(-L * 0.4, -H * 0.05);
    body.quadraticCurveTo(-L * 0.1, H * 0.55, L * 0.25, H * 0.45);
    body.quadraticCurveTo(L * 0.45, H * 0.2, L * 0.45, -H * 0.1);
  } else {
    const nose = sp === 'angler' ? 0.46 : 0.5;
    body.moveTo(L * nose, 0);
    body.bezierCurveTo(L * 0.42, -H * 0.66, -L * 0.28, -H * 0.62, -L * 0.42, 0);
    body.bezierCurveTo(-L * 0.28, H * 0.62, L * 0.42, H * 0.66, L * nose, 0);
  }
  body.closePath();
  g.fill(body);
  g.save();
  g.clip(body);
  // belly
  g.fillStyle = gold ? '#fff0a0' : s.belly;
  g.beginPath();
  g.ellipse(L * 0.04, H * 0.42, L * 0.5, H * 0.3, 0, 0, TAU);
  g.fill();
  if (sp === 'clown') {
    g.fillStyle = '#fff';
    for (const xx of [0.24, -0.04, -0.3]) {
      g.beginPath();
      g.ellipse(L * xx, 0, L * 0.05, H * 0.6, 0, 0, TAU);
      g.fill();
    }
  } else if (sp === 'mackerel') {
    g.strokeStyle = '#163f3c';
    g.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(L * (0.2 - i * 0.11), -H * 0.5);
      g.quadraticCurveTo(L * (0.16 - i * 0.11), -H * 0.25, L * (0.22 - i * 0.11), -H * 0.05);
      g.stroke();
    }
  } else if (sp === 'tuna') {
    g.fillStyle = 'rgba(255,210,63,0.9)';
    g.fillRect(-L * 0.3, -H * 0.02, L * 0.6, H * 0.08);
  } else if (sp === 'ghost') {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(L * 0.05, -H * 0.18, L * 0.3, H * 0.12, 0, 0, TAU);
    g.fill();
  }
  if (gold) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(L * 0.1, -H * 0.22, L * 0.2, H * 0.08, -0.2, 0, TAU);
    g.fill();
  }
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.stroke(body);
  // angler's lure stalk and teeth
  if (sp === 'angler') {
    g.beginPath();
    g.moveTo(L * 0.3, -H * 0.42);
    g.quadraticCurveTo(L * 0.5, -H * 1.0, L * 0.62, -H * 0.8);
    g.stroke();
    g.fillStyle = s.glow;
    g.beginPath();
    g.arc(L * 0.62, -H * 0.85, 3.2, 0, TAU);
    g.fill();
    g.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(L * (0.44 - i * 0.05), H * 0.08);
      g.lineTo(L * (0.42 - i * 0.05), H * 0.2);
      g.lineTo(L * (0.4 - i * 0.05), H * 0.08);
      g.fill();
    }
  }
  // eye
  const er = Math.max(2.2, H * (sp === 'hatchet' || sp === 'angler' ? 0.2 : 0.16));
  const ex = L * (sp === 'angler' ? 0.24 : 0.3), ey = -H * (sp === 'hatchet' ? 0.15 : 0.1);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(ex, ey, er, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(ex + er * 0.25, ey, er * 0.55, 0, TAU);
  g.fill();
  g.restore();
  if (gold) {
    const k = (Math.sin(t * 0.7) + 1) / 2;
    g.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * k})`;
    const sx2 = x + Math.cos(t * 0.3) * L * 0.4, sy2 = y - H * 0.7;
    g.beginPath();
    g.moveTo(sx2, sy2 - 5);
    g.lineTo(sx2 + 1.4, sy2 - 1.4);
    g.lineTo(sx2 + 5, sy2);
    g.lineTo(sx2 + 1.4, sy2 + 1.4);
    g.lineTo(sx2, sy2 + 5);
    g.lineTo(sx2 - 1.4, sy2 + 1.4);
    g.lineTo(sx2 - 5, sy2);
    g.lineTo(sx2 - 1.4, sy2 - 1.4);
    g.fill();
  }
}

function drawShark(x, y, dir, L, t, open, full) {
  const H = L * 0.3;
  g.save();
  g.translate(x, y);
  if (dir < 0) g.scale(-1, 1);
  const wig = Math.sin(t * 7) * 0.14;
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.fillStyle = '#5d788c';
  // tail
  g.beginPath();
  g.moveTo(-L * 0.36, -H * 0.05);
  g.lineTo(-L * 0.58, -H * 0.8 + wig * H);
  g.quadraticCurveTo(-L * 0.48, -H * 0.05, -L * 0.55, H * 0.55 + wig * H);
  g.closePath();
  g.fill();
  g.stroke();
  // dorsal fin
  g.beginPath();
  g.moveTo(-L * 0.1, -H * 0.42);
  g.quadraticCurveTo(-L * 0.06, -H * 0.9, -L * 0.02, -H * 1.08);
  g.quadraticCurveTo(L * 0.05, -H * 0.6, L * 0.12, -H * 0.4);
  g.fill();
  g.stroke();
  // body
  g.fillStyle = '#7d97ab';
  const body = new Path2D();
  body.moveTo(L * 0.5, H * 0.04);
  body.bezierCurveTo(L * 0.46, -H * 0.56, -L * 0.18, -H * 0.62, -L * 0.4, -H * 0.06);
  body.bezierCurveTo(-L * 0.2, H * 0.46, L * 0.38, H * 0.5, L * 0.5, H * 0.04);
  body.closePath();
  g.fill(body);
  g.save();
  g.clip(body);
  g.fillStyle = '#eef3f6';
  g.beginPath();
  g.ellipse(L * 0.06, H * 0.45, L * 0.5, H * 0.3, 0, 0, TAU);
  g.fill();
  g.restore();
  g.stroke(body);
  // pectoral fin
  g.fillStyle = '#5d788c';
  g.beginPath();
  g.moveTo(L * 0.1, H * 0.2);
  g.lineTo(-L * 0.02, H * 0.72);
  g.lineTo(L * 0.2, H * 0.28);
  g.closePath();
  g.fill();
  g.stroke();
  // gills
  g.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(L * (0.2 - i * 0.04), -H * 0.18);
    g.quadraticCurveTo(L * (0.17 - i * 0.04), 0, L * (0.2 - i * 0.04), H * 0.16);
    g.stroke();
  }
  // mouth
  if (open) {
    g.fillStyle = '#7a1f2b';
    g.beginPath();
    g.moveTo(L * 0.5, H * 0.04);
    g.lineTo(L * 0.26, H * 0.2);
    g.lineTo(L * 0.5, H * 0.42);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const u = 0.3 + i * 0.065;
      g.beginPath();
      g.moveTo(L * u, H * (0.1 + (u - 0.26) * 0.3));
      g.lineTo(L * (u + 0.03), H * 0.2);
      g.lineTo(L * (u + 0.05), H * (0.08 + (u - 0.26) * 0.3));
      g.fill();
    }
  } else {
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(L * 0.44, H * 0.2);
    g.quadraticCurveTo(L * 0.34, H * 0.28, L * 0.28, H * 0.18);
    g.stroke();
    g.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(L * (0.31 + i * 0.04), H * 0.22);
      g.lineTo(L * (0.325 + i * 0.04), H * 0.3);
      g.lineTo(L * (0.34 + i * 0.04), H * 0.22);
      g.fill();
    }
  }
  // eye: angry when hungry, smug when full
  g.fillStyle = INK;
  g.beginPath();
  g.arc(L * 0.33, -H * 0.12, H * 0.08, 0, TAU);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(L * 0.34, -H * 0.14, H * 0.03, 0, TAU);
  g.fill();
  g.lineWidth = 2.2;
  g.beginPath();
  if (full) {
    g.moveTo(L * 0.27, -H * 0.24);
    g.quadraticCurveTo(L * 0.33, -H * 0.3, L * 0.39, -H * 0.24);
  } else {
    g.moveTo(L * 0.27, -H * 0.3);
    g.lineTo(L * 0.4, -H * 0.2);
  }
  g.stroke();
  g.restore();
}

function drawJelly(c, t) {
  const r = c.r * (1 + Math.sin(t * 3 + c.ph) * 0.06);
  g.save();
  g.translate(c.x, c.y);
  g.strokeStyle = 'rgba(255,140,230,0.75)';
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const x0 = (i / 4 - 0.5) * r * 1.3;
    g.beginPath();
    g.moveTo(x0, r * 0.2);
    for (let k = 1; k <= 6; k++) g.lineTo(x0 + Math.sin(t * 3 + i + k * 0.9) * 4, r * 0.2 + k * r * 0.33);
    g.stroke();
  }
  g.lineCap = 'butt';
  g.fillStyle = 'rgba(255,122,217,0.82)';
  g.strokeStyle = INK;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(-r, r * 0.2);
  g.bezierCurveTo(-r, -r * 1.05, r, -r * 1.05, r, r * 0.2);
  for (let i = 0; i < 5; i++) {
    const xa = r - (i * 2 * r) / 5, xb = r - ((i + 1) * 2 * r) / 5;
    g.quadraticCurveTo((xa + xb) / 2, r * 0.45, xb, r * 0.2);
  }
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.ellipse(-r * 0.35, -r * 0.4, r * 0.25, r * 0.14, -0.5, 0, TAU);
  g.fill();
  g.restore();
}

// ---------- the hook and its bait
function drawLure(x, y, ang, id, t, k = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(k, k);
  g.lineJoin = 'round';
  // the hook
  g.strokeStyle = id === 'gold' ? '#ffcf3a' : '#d9e2ea';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(0, 4);
  g.arc(-5, 4, 5, 0, Math.PI * 0.95);
  g.lineTo(-11, 0);
  g.stroke();
  g.fillStyle = '#d9e2ea';
  g.beginPath();
  g.arc(0, -13, 2, 0, TAU);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  const w = Math.sin(t * 6);
  switch (id) {
    case 'worm': {
      g.strokeStyle = '#ff8fa8';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-6, -6);
      g.quadraticCurveTo(6, -2, -2, 3);
      g.quadraticCurveTo(-10, 8, -4 + w * 3, 13);
      g.stroke();
      g.strokeStyle = '#e0647f';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -4);
      g.lineTo(2, -1);
      g.stroke();
      g.lineCap = 'butt';
      break;
    }
    case 'spoon':
    case 'gold': {
      g.fillStyle = id === 'gold' ? '#ffc21a' : '#c8d6e3';
      g.beginPath();
      g.ellipse(0, -2, 6, 10, w * 0.15, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.ellipse(-2, -5, 2, 4, 0, 0, TAU);
      g.fill();
      if (id === 'gold') {
        g.fillStyle = '#fff';
        const sp = (t * 2) % 1;
        g.globalAlpha = 1 - sp;
        g.beginPath();
        g.arc(5, -10, 1.5 + sp * 2, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
      break;
    }
    case 'fly': {
      g.fillStyle = '#ff4d4d';
      g.beginPath();
      g.ellipse(-5, -4, 6, 3, -0.6 + w * 0.2, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.ellipse(5, -4, 6, 3, 0.6 - w * 0.2, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(0, -2, 2.5, 5, 0, 0, TAU);
      g.fill();
      break;
    }
    case 'ducky': {
      g.fillStyle = '#ffd93b';
      g.beginPath();
      g.ellipse(0, 0, 8, 6, 0, 0, TAU);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(4, -6, 4.5, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = '#ff8a1f';
      g.beginPath();
      g.moveTo(8, -6);
      g.lineTo(12, -5);
      g.lineTo(8, -4);
      g.fill();
      g.fillStyle = INK;
      g.beginPath();
      g.arc(5, -7, 1, 0, TAU);
      g.fill();
      break;
    }
    case 'neon': {
      g.shadowColor = '#3ef0ff';
      g.shadowBlur = 12;
      g.fillStyle = '#3ef0ff';
      g.beginPath();
      g.moveTo(0, -12);
      g.quadraticCurveTo(8, -2, 0, 8);
      g.quadraticCurveTo(-8, -2, 0, -12);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#ff5df0';
      g.beginPath();
      g.arc(0, -4, 2, 0, TAU);
      g.fill();
      break;
    }
    case 'skull': {
      g.fillStyle = '#f4f1e8';
      g.beginPath();
      g.arc(0, -4, 7, 0, TAU);
      g.fill();
      g.stroke();
      g.fillRect(-4, 1, 8, 5);
      g.strokeRect(-4, 1, 8, 5);
      g.fillStyle = INK;
      g.beginPath();
      g.arc(-2.6, -4, 2, 0, TAU);
      g.arc(2.6, -4, 2, 0, TAU);
      g.fill();
      break;
    }
    case 'diamond': {
      g.shadowColor = '#9ff3ff';
      g.shadowBlur = 14;
      g.fillStyle = '#7fe8ff';
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(8, -4);
      g.lineTo(0, 8);
      g.lineTo(-8, -4);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(3, -4);
      g.lineTo(-3, -4);
      g.closePath();
      g.fill();
      break;
    }
  }
  g.restore();
}

// ---------- the boat (and the cat who owns it)
function drawBoat(r) {
  const s0 = sy(0);
  if (s0 < -40 || s0 > SH + 200) return;
  const bob = Math.sin(tReal * 1.6) * 2.2, tilt = Math.sin(tReal * 1.3) * 0.03;
  const happy = r && (r.phase === 'land' || (mode === 'over' && !r.snapped && r.landedN > 0));
  const sad = r && (r.phase === 'snap' || (mode === 'over' && r.snapped));
  g.save();
  g.translate(BOAT_X, bob);
  g.rotate(tilt);
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.lineWidth = 2;
  // inside of the hull
  g.fillStyle = '#7a3a22';
  g.beginPath();
  g.ellipse(0, -14, 60, 7, 0, 0, TAU);
  g.fill();
  // the catch, piling up
  const n = r ? Math.min(r.landedN, 16) : 0;
  for (let i = 0; i < n; i++) {
    const h = hash(i * 5.1);
    const sp = r.pileSp ? r.pileSp[i] : 'sardine';
    drawFish(-40 + h * 70, -16 - Math.floor(i / 5) * 6, (h - 0.5) * 0.6, h > 0.5, sp || 'sardine', 0.8, i, false);
  }
  // cat
  g.fillStyle = '#ff9f43';
  g.beginPath();
  g.ellipse(14, -30, 15, 17, 0, 0, TAU);
  g.fill();
  g.stroke();
  // tail
  g.lineWidth = 5;
  g.strokeStyle = '#ff9f43';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(2, -20);
  g.quadraticCurveTo(-22, -26 + Math.sin(tReal * 3) * 4, -16, -44);
  g.stroke();
  g.lineCap = 'butt';
  g.lineWidth = 2;
  g.strokeStyle = INK;
  // rod
  g.strokeStyle = '#4a2a14';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(20, -26);
  g.lineTo(ROD.x - BOAT_X, ROD.y);
  g.stroke();
  g.fillStyle = '#d9e2ea';
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(26, -30, 4, 0, TAU);
  g.fill();
  g.stroke();
  // head
  const hy = -56 + (happy ? Math.abs(Math.sin(tReal * 9)) * -3 : 0);
  g.lineWidth = 2;
  g.fillStyle = '#ff9f43';
  g.beginPath();
  g.moveTo(4, hy - 8);
  g.lineTo(6, hy - 22);
  g.lineTo(14, hy - 12);
  g.moveTo(22, hy - 12);
  g.lineTo(30, hy - 22);
  g.lineTo(32, hy - 8);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(18, hy, 15, 0, TAU);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd7a8';
  g.beginPath();
  g.ellipse(20, hy + 6, 7, 5, 0, 0, TAU);
  g.fill();
  g.fillStyle = INK;
  g.strokeStyle = INK;
  if (happy) {
    g.lineWidth = 2;
    g.beginPath();
    g.arc(13, hy - 1, 3, Math.PI, 0);
    g.moveTo(28, hy - 1);
    g.arc(25, hy - 1, 3, 0, Math.PI, true);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(13, hy - 2, 2.4, 0, TAU);
    g.arc(25, hy - 2, 2.4, 0, TAU);
    g.fill();
  }
  if (sad) {
    g.fillStyle = '#7cd6ff';
    g.beginPath();
    g.ellipse(11, hy + 5 + ((tReal * 30) % 10), 1.8, 3, 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#ff6f91';
  g.beginPath();
  g.arc(20, hy + 4, 1.8, 0, TAU);
  g.fill();
  // hull front
  g.fillStyle = '#c8653c';
  g.strokeStyle = INK;
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-66, -16);
  g.lineTo(66, -16);
  g.quadraticCurveTo(58, 12, 40, 14);
  g.lineTo(-44, 14);
  g.quadraticCurveTo(-60, 10, -66, -16);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = '#9a4524';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-60, -4);
  g.lineTo(60, -4);
  g.moveTo(-52, 6);
  g.lineTo(52, 6);
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `16px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GREEDY', 0, -9);
  g.restore();
}

// ---------- text, HUD, menus
function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || ''} ${size}px ${opts.font || FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || INK;
    g.lineJoin = 'round';
    g.strokeText(str, x, y);
  }
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = opts.blur ?? 18 * U;
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.shadowBlur = 0;
}

function drawPops(r) {
  for (const p of r.pops) {
    const k = p.t / (p.life || 1.1);
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    g.globalAlpha = clamp(a, 0, 1);
    const s = back(p.t / 0.2);
    text(p.text, clamp(sx(p.x), 70 * U, SW - 70 * U), sy(p.y) - p.t * 40 * U, p.size * U * s, p.col, 'center', { stroke: 6 * U });
  }
  g.globalAlpha = 1;
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  const ph = r.phase;
  const d = Math.max(0, Math.round(r.lure.y / M));
  const y2 = top + 70 * U;
  if (ph === 'land' || mode === 'over') {
    text(String(r.score), SW / 2, top + 30 * U, 58 * U * bump, '#fff', 'center', { stroke: 9 * U });
    text('LANDED · ' + r.landedN + ' fish', SW / 2, y2, 16 * U, '#ffd650', 'center', { stroke: 5 * U });
  } else if (ph === 'snap') {
    text('0', SW / 2, top + 30 * U, 58 * U, '#fff', 'center', { stroke: 9 * U });
  } else if (r.chain.length || r.bonus) {
    text(String(r.haul + r.bonus), SW / 2, top + 30 * U, 58 * U * bump, '#ffd650', 'center', { stroke: 9 * U });
    text(r.chain.length + ' fish on the line · ' + d + ' m', SW / 2, y2, 15 * U, '#fff', 'center', { stroke: 5 * U });
  } else {
    text(d + ' m', SW / 2, top + 30 * U, 54 * U, '#fff', 'center', { stroke: 9 * U });
    if (bestD > 0 && !REC) text('DEEPEST ' + bestD + ' m', SW / 2, y2, 15 * U, 'rgba(255,255,255,0.85)', 'center', { stroke: 4 * U });
    else if (best > 0 && !REC) text('BEST ' + best, SW / 2, y2, 15 * U, 'rgba(255,255,255,0.85)', 'center', { stroke: 4 * U });
  }
  if (r.layerPop) {
    const k = r.layerPop.t / 1.5;
    g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    text('♪ + ' + r.layerPop.name, SW / 2, y2 + 24 * U, 14 * U * back(r.layerPop.t / 0.25), '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins), 40 * U, top + 7 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.1 ? k / 0.1 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.5 : 0.56);
    g.fillStyle = 'rgba(4,18,40,0.55)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 6 * U, 38 * U * back(b.t / 0.3), b.col || '#fff', 'center', { stroke: 7 * U });
    text(b.sub, SW / 2, y + 26 * U, 13 * U, '#d6f3ff', 'center', { font: SANS, weight: '800' });
    g.globalAlpha = 1;
  }
  if (mode !== 'play' || (r.banner && r.phase !== 'ready')) return; // one callout at a time
  // tutorial and hints
  const ty = ph === 'down' ? Math.max(150 * U, Math.min(SH * 0.24, sy(r.lure.y) - 90 * U)) : SH * 0.66;
  const p = 0.5 + 0.5 * Math.sin(tReal * 6);
  const hint = (s, sub) => {
    text(s, SW / 2, ty, (25 + p * 2) * U, '#fff', 'center', { stroke: 8 * U });
    if (sub) text(sub, SW / 2, ty + 30 * U, 14 * U, '#fff', 'center', { font: SANS, weight: '800', stroke: 4 * U });
  };
  const holdKeys = wide() && !REC ? 'or hold SPACE · ← → to steer' : null;
  if (ph === 'ready') {
    hint('HOLD TO DROP THE HOOK', holdKeys);
    drawFinger(SW / 2, ty + 70 * U, (tReal % 1.4) / 1.4);
  } else if (ph === 'down' && !holding(r) && r.lure.y < HOVER_Y) hint('HOLD TO SINK', 'let go deeper down to reel up');
  else if (r.tutorial && ph === 'down') {
    if (r.phT < 3) hint('SLIDE TO DODGE THE FISH', 'touching one hooks it and you reel up early');
    else if (r.lure.y > 12 * M) hint('LET GO TO REEL UP', 'deeper fish are worth more…');
  } else if (r.tutorial && ph === 'up' && r.phT < 2.4) hint('NOW CATCH THEM ALL!', 'steer into fish on the way up · dodge sharks');
}

function drawFinger(x, y, u) {
  const down = u > 0.2 && u < 0.85;
  g.globalAlpha = 0.9;
  if (down) {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 3 * U;
    g.beginPath();
    g.arc(x, y, (18 + (u - 0.2) * 30) * U, 0, TAU);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.strokeStyle = INK;
  g.lineWidth = 3 * U;
  g.beginPath();
  g.arc(x, y, (down ? 13 : 16) * U, 0, TAU);
  g.fill();
  g.stroke();
  g.globalAlpha = 1;
}

function drawGem(x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s * 1.25);
  g.lineTo(x + s, y);
  g.lineTo(x, y + s * 1.25);
  g.lineTo(x - s, y);
  g.closePath();
  g.fillStyle = '#ffd650';
  g.fill();
  g.lineWidth = 2 * U;
  g.strokeStyle = INK;
  g.stroke();
}

function soundButton(x, y) {
  const r = 16 * U;
  g.fillStyle = 'rgba(4,18,40,0.45)';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  const pts = [[x - 7 * U, y - 3 * U], [x - 3 * U, y - 3 * U], [x + 3 * U, y - 8 * U], [x + 3 * U, y + 8 * U], [x - 3 * U, y + 3 * U], [x - 7 * U, y + 3 * U]];
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.closePath();
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2 * U;
  g.beginPath();
  if (soundOn) g.arc(x + 4 * U, y, 6 * U, -0.8, 0.8);
  else {
    g.moveTo(x + 6 * U, y - 5 * U);
    g.lineTo(x + 12 * U, y + 5 * U);
    g.moveTo(x + 12 * U, y - 5 * U);
    g.lineTo(x + 6 * U, y + 5 * U);
  }
  g.stroke();
  buttons.push({ x: x - r - 6 * U, y: y - r - 6 * U, w: r * 2 + 12 * U, h: r * 2 + 12 * U, act: toggleSound });
}

function pill(label, x, y, w, h, bg, fg, act, size = 20) {
  g.fillStyle = 'rgba(4,18,40,0.35)';
  rr(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  rr(x - w / 2, y - h / 2, w, h, h / 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 3 * U;
  g.strokeStyle = INK;
  g.stroke();
  text(label, x, y + 2 * U, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

function drawTitleWords(x, y, s, wob) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.04 + wob);
  text('REEL', -6 * s, -40 * s, 64 * s, '#fff', 'center', { stroke: 12 * s });
  text('GREEDY', 4 * s, 22 * s, 84 * s, GOLD, 'center', { stroke: 13 * s });
  g.restore();
}

function drawTitle() {
  const wd = wide();
  const cx = wd ? Math.max(SW * 0.2, OX * 0.5) : SW / 2;
  const y = wd ? SH * 0.3 : Math.max(SH * 0.13, 92 * U);
  const ts = wd ? Math.min(U * 1.2, (OX * 0.9) / 300) : U * Math.min(1.05, SW / (360 * U));
  drawTitleWords(cx, y, ts, Math.sin(tReal * 2.2) * 0.02);
  text('the fishing game where', cx, y + 82 * ts, 16 * U, '#fff', 'center', { font: SANS, weight: '900', stroke: 5 * U });
  text('sharks eat your catch', cx, y + 104 * ts, 16 * U, '#fff', 'center', { font: SANS, weight: '900', stroke: 5 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  const yb = wd ? SH * 0.62 : SH * 0.66;
  text('HOLD TO DROP THE HOOK', cx, yb, (25 + p * 3) * U, '#fff', 'center', { stroke: 8 * U });
  if (wd) {
    text('mouse: hold & move to steer', cx, yb + 28 * U, 13 * U, '#fff', 'center', { font: SANS, weight: '800', stroke: 4 * U });
    text('keys: hold SPACE · ← → to steer', cx, yb + 46 * U, 13 * U, '#fff', 'center', { font: SANS, weight: '800', stroke: 4 * U });
  }
  const bits = [];
  if (best > 0) bits.push('BEST ' + best);
  if (bestD > 0) bits.push('DEEPEST ' + bestD + ' m');
  if (bits.length) text(bits.join('  ·  '), cx, yb + (wd ? 72 : 34) * U, 15 * U, '#ffd650', 'center', { stroke: 5 * U });
  pill('TACKLE BOX', cx, yb + (wd ? 116 : 82) * U, 170 * U, 40 * U, '#ffffff', INK, openShop, 18);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(4,18,40,0.85)');
  gr.addColorStop(1, 'rgba(4,18,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.24, y = SH * 0.36;
  drawTitleWords(x, y, 1.75, 0);
  text('the fishing game where', x, y + 140, 32, '#fff', 'center', { font: SANS, weight: '900', stroke: 8 });
  text('sharks eat your catch', x, y + 180, 32, '#fff', 'center', { font: SANS, weight: '900', stroke: 8 });
  text('free · no download', x, y + 222, 22, '#ffd650', 'center', { font: SANS, weight: '800', stroke: 6 });
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(4,18,40,${0.55 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.47 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  rr(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 24 * U);
  g.fillStyle = 'rgba(255,255,255,0.97)';
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 4 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  let head;
  if (r.snapped) head = 'SNAPPED!';
  else if (r.isBest && !REC) head = 'NEW BEST!';
  else if (r.landedN === 0) head = 'EMPTY HOOK';
  else if (best > 0 && r.score >= best * 0.8) head = 'SO CLOSE!';
  else head = 'NICE HAUL!';
  text(head, SW / 2, t0 + 44 * U, 38 * U * (r.isBest ? back(overT / 0.4) : 1), r.snapped ? CORAL : r.isBest ? '#ff9f1a' : INK, 'center', { stroke: 0 });
  if (r.snapped && r.lostPts > 0) {
    text(String(r.lostPts), SW / 2, t0 + 108 * U, 76 * U, '#9fb0c4');
    g.font = `${76 * U}px ${FONT}`;
    const tw = g.measureText(String(r.lostPts)).width;
    g.strokeStyle = CORAL;
    g.lineWidth = 7 * U;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(SW / 2 - tw / 2 - 10 * U, t0 + 118 * U);
    g.lineTo(SW / 2 + tw / 2 + 10 * U, t0 + 96 * U);
    g.stroke();
    g.lineCap = 'butt';
  } else text(String(r.score), SW / 2, t0 + 108 * U, 80 * U, INK);
  let sub;
  if (r.snapped) sub = r.lost ? `${r.lost} fish lost ${r.snapD} m from the boat` : `snapped at ${r.snapD} m with nothing on the line`;
  else if (r.landedN === 0) sub = 'hold to sink, let go to reel, catch on the way up';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : r.landedN + ' fish from ' + Math.floor(r.maxD) + ' m deep';
  else if (best - r.score > 0 && best - r.score <= Math.max(6, best * 0.15)) sub = 'just ' + (best - r.score + 1) + ' more to beat your best!';
  else sub = r.landedN + ' fish landed from ' + Math.floor(r.maxD) + ' m deep';
  if (REC) sub = r.snapped ? `${r.snapD} m from the boat. can you land it?` : 'can you beat ' + r.score + '?';
  text(sub, SW / 2, t0 + 158 * U, 15 * U, '#4f6d96', 'center', { font: SANS, weight: '800' });
  if (REC) {
    drawTitleWords(SW / 2, t0 - 92 * U, U * 0.75, 0);
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, INK, 'center', { font: SANS, weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 240 * U, 18 * U, CORAL, 'center', { font: SANS, weight: '900' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 192 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 194 * U, 19 * U, '#e0a800', 'left');
    if (!r.snapped && r.prevDeep != null && Math.floor(r.maxD) > r.prevDeep && r.prevDeep > 0) text('new deepest ' + Math.floor(r.maxD) + ' m', SW / 2 + 70 * U, t0 + 194 * U, 13 * U, '#4f6d96', 'center', { font: SANS, weight: '800' });
    pill('RETRY', SW / 2, t0 + 246 * U, cw - 60 * U, 54 * U, CORAL, '#fff', startGame, 30);
    pill('SHARE', SW / 2 - 75 * U, t0 + 302 * U, 130 * U, 36 * U, '#e6f4ff', INK, share, 18);
    pill('TACKLE', SW / 2 + 75 * U, t0 + 302 * U, 130 * U, 36 * U, '#e6f4ff', INK, openShop, 18);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, cy + ch / 2 + 28 * U, 13 * U, 'rgba(255,255,255,0.9)', 'center', { font: SANS, weight: '800', stroke: 4 * U });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');
const cap2On = r => REC && rec && !!Q.get('cap2') && !!r.crashShark && r.phase === 'up';

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    hook.forEach((ln, i) => text(ln, SW / 2, 360 + i * 104, 84, i === hook.length - 1 ? '#ffd23f' : '#fff', 'center', { stroke: 20 }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  if (cap2 && cap2On(r)) {
    cap2
      .replace('{n}', r.chain.length)
      .replace('{pts}', r.haul + r.bonus)
      .split('|')
      .forEach((ln, i) => text(ln, SW / 2, 360 + i * 96, 76, i ? '#ffd23f' : '#fff', 'center', { stroke: 18 }));
  }
}

// ---------------------------------------------------------------- UI actions
function toggleSound() {
  soundOn = !soundOn;
  store.set('sound', soundOn);
  if (audio) {
    if (soundOn) audio.ctx.resume();
    else audio.ctx.suspend();
  }
  if (soundOn) ensureAudio();
}

async function share() {
  const r = run;
  const txt = r.snapped
    ? r.lost
      ? `a shark snapped my line ${r.snapD} m from the boat and took ${r.lost} fish 😭 REEL GREEDY 🎣 bet you can't land more →`
      : `I got snapped on REEL GREEDY 🎣 the fishing game where sharks eat your catch →`
    : `I landed ${r.score} on REEL GREEDY 🎣 (${r.landedN} fish from ${Math.floor(r.maxD)} m) before the sharks got them. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Reel Greedy', text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Paste it to a friend 🎣');
    }
  } catch {}
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1800);
}

function lureIcon(id) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g0 = g;
  g = c.getContext('2d');
  g.fillStyle = '#123e6e';
  g.beginPath();
  g.arc(64, 64, 60, 0, TAU);
  g.fill();
  drawLure(68, 62, 0, id, 0.4, 3.6);
  g = g0;
  return c;
}

function openShop() {
  const el = document.getElementById('garage');
  const list = el.querySelector('.cars');
  el.querySelector('.coins').textContent = coins;
  list.innerHTML = '';
  for (const s of LURES) {
    const have = owned.includes(s.id);
    const b = document.createElement('button');
    b.className = 'car' + (s.id === lureId ? ' sel' : '') + (have ? '' : ' locked');
    b.appendChild(lureIcon(s.id));
    b.insertAdjacentHTML('beforeend', `<b>${s.name}</b><span>${have ? (s.id === lureId ? 'ON THE HOOK' : 'SELECT') : '◆ ' + s.price}</span>`);
    b.onclick = () => {
      if (have) {
        lureId = s.id;
        store.set('lure', lureId);
      } else if (coins >= s.price) {
        coins -= s.price;
        owned.push(s.id);
        lureId = s.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('lure', lureId);
        sfx('best', { root: 48 });
      } else {
        toast(`Need ${s.price - coins} more ◆. Land bigger hauls!`);
        return;
      }
      sfx('click');
      openShop();
    };
    list.appendChild(b);
  }
  el.classList.add('on');
}
document.querySelector('#garage .close').onclick = () => document.getElementById('garage').classList.remove('on');

// ---------------------------------------------------------------- input
function hitButton(x, y) {
  for (const b of buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  return null;
}
function begin() {
  if (mode === 'title') {
    startGame();
    return true;
  }
  if (mode === 'over') {
    if (overT > 0.45) startGame();
    return mode === 'play';
  }
  return mode === 'play';
}
function down(x, y, id) {
  ensureAudio();
  const b = hitButton(x, y);
  if (b) {
    sfx('click');
    b.act();
    return;
  }
  ptr = id;
  aimX = x;
  if (begin()) held = true;
}
function move(x, id, mouse) {
  if (id === ptr || (mouse && ptr == null)) aimX = x;
}
function up(id) {
  if (id !== ptr) return;
  ptr = null;
  held = false;
}
const HOLD_KEYS = ['Space', 'ArrowDown', 'KeyS', 'Enter'];
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    down(e.clientX, e.clientY, e.pointerId);
  });
  window.addEventListener('pointermove', e => move(e.clientX, e.pointerId, e.pointerType === 'mouse'));
  window.addEventListener('pointerup', e => up(e.pointerId));
  window.addEventListener('pointercancel', e => up(e.pointerId));
  window.addEventListener('keydown', e => {
    if (![...HOLD_KEYS, 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page mid-run
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') return (keyL = true);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') return (keyR = true);
    ensureAudio();
    if (begin()) keyHeld = true;
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyL = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keyR = false;
    if (HOLD_KEYS.includes(e.code)) keyHeld = false;
  });
  window.addEventListener('blur', () => {
    keyL = keyR = keyHeld = held = false;
    ptr = null;
  });
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.ctx.suspend();
    else if (soundOn) audio.ctx.resume();
  });
  window.addEventListener('resize', resize);
}

// ---------------------------------------------------------------- boot
resize();
if (OG) {
  const back = document.querySelector('.back');
  if (back) back.style.display = 'none';
  document.body.style.overflow = 'hidden';
  mode = 'og';
  run = newRun({ seed: 21, bot: true });
  const r = run;
  r.cr = [];
  // hand-placed: a heavy stringer of fish, and a shark coming for it
  r.lure.x = 205;
  r.lure.y = 86 * M;
  r.phase = 'up';
  const sps = ['tuna', 'snapper', 'lantern', 'gold', 'mackerel', 'snapper', 'clown', 'tuna', 'sardine', 'mackerel', 'snapper'];
  let px = r.lure.x, py = r.lure.y + 8;
  sps.forEach((sp, i) => {
    const s = SPECIES[sp];
    const a = Math.PI / 2 + Math.sin(i * 0.6) * 0.25 - 0.12;
    const step = 4 + s.L * 0.5;
    const x = px + Math.cos(a) * step, y = py + Math.sin(a) * step;
    r.chain.push({ sp, x, y, px: x, py: y, L: s.L, H: s.H, ph: i * 1.3, gold: sp === 'gold', ang: Math.atan2(py - y, px - x) });
    px = x;
    py = y;
  });
  r.haul = 64;
  addShark(r, r.lure.y + 150, 86, { x: 345, dir: -1, L: 150 }).chomp = 9;
  addJelly(r, 70, r.lure.y - 150);
  r.cr[r.cr.length - 1].r = 20;
  addFish(r, 'lantern', 90, r.lure.y + 60, { vx: 50 });
  addFish(r, 'tuna', 310, r.lure.y - 110, { vx: -90 });
  addFish(r, 'snapper', 120, r.lure.y + 250, { vx: 60 });
  addFish(r, 'angler', 300, r.lure.y + 300, { vx: -40 });
  cam.y = camTarget(r);
  tReal = 0.6;
  r.t = 0.6;
  document.fonts.load(`40px ${FONT}`).finally(() => {
    render();
    window.__ogReady = true;
  });
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  // plan: dive=<m> reel-up depth · crash=<m> a shark snaps the line on the way up (omit to land)
  const seed = +(Q.get('seed') || 5);
  rec = { t: 0, frame: 0, events: [], states: [], musicStart: 0, crash: Q.has('crash') ? +Q.get('crash') : null };
  sharkTip = true;
  plays = 99;
  best = 0;
  bestD = 0;
  lureId = Q.get('lure') || 'worm';
  run = newRun({ seed, bot: true, dive: +(Q.get('dive') || 90) });
  run.tutorial = false;
  run.botLag = +(Q.get('lag') || 0);
  run.botGreed = +(Q.get('greed') || 1);
  mode = 'play';
  cam.y = camTarget(run);
  rec.states.push({ t: 0, ...musicState() });
  const hold = +(Q.get('hold') || 0.5);
  run.botLetGo = true;
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        if (rec.t >= hold) run.botLetGo = false;
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      const r = run;
      return { t: +rec.t.toFixed(2), mode, phase: r.phase, dead: r.phase === 'snap' || mode === 'over', score: r.score, haul: r.haul, fish: r.chain.length, depth: Math.round(r.lure.y / M), maxD: Math.round(r.maxD), bites: r.bites, caught: r.caught, corners: r.chain.length, streak: 0 };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load(`40px ${FONT}`).then(() => (window.__recReady = true));
} else {
  run = newRun();
  cam.y = camTarget(run);
  if (QA) {
    window.__qa = () => {
      const r = run, L = r.lure;
      const near = r.cr.filter(c => !c.dead && Math.abs(c.y - L.y) < 700).map(c => ({ k: c.k, sp: c.sp, x: c.x, y: c.y, vx: c.vx, L: c.L || c.r * 2, H: c.H || c.r * 2, flee: c.flee || 0, full: c.full || 0 }));
      return { mode, phase: r.phase, t: r.t, tr: tReal, lure: { x: L.x, y: L.y }, lureScreen: [sx(L.x), sy(L.y)], depth: L.y / M, maxD: r.maxD, chain: r.chain.length, haul: r.haul, bonus: r.bonus, score: r.score, bites: r.bites, caught: r.caught, landed: r.landedN, snapped: !!r.snapped, best, bestD, coins, overT, tutorial: r.tutorial, OX, SC, SW, SH, near };
    };
  }
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  };
  document.fonts.load(`40px ${FONT}`).finally(() => requestAnimationFrame(loop));
}
