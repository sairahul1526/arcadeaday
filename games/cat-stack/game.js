import { Synth, Music, renderOffline, layerFor, meowNote, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/cat-stack';
const FONT = '"Fredoka", system-ui, sans-serif';
const cvs = document.getElementById('game');
const g = cvs.getContext('2d');

// ---------------------------------------------------------------- utils
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
  n = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  n ^= n >>> 15;
  return ((Math.imul(n, 0x2c1b3c6d) ^ (n >>> 12)) >>> 0) / 4294967296;
};
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('cst_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('cst_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONE_EVERY = 10;
const ZONES = [
  { name: 'ROOFTOPS', top: '#3d1f6e', bot: '#ff9a62', glow: '#ffd166', edge: '#ffb347', city: '#2b1546', win: '#ffcf6b', stars: 0 },
  { name: 'CHIMNEY SMOKE', top: '#1e1450', bot: '#c4577e', glow: '#ffc2e0', edge: '#ff8fc4', city: '#1d0f3a', win: '#ffb3d9', stars: 0.4 },
  { name: 'CLOUD NINE', top: '#0b1a4a', bot: '#4a6fd1', glow: '#d6ecff', edge: '#7cc8ff', city: '#0d1a44', win: '#9fd4ff', stars: 0.7 },
  { name: 'BAT COUNTRY', top: '#14062a', bot: '#62235f', glow: '#ffae4d', edge: '#ff9a3c', city: '#140725', win: '#ff9a3c', stars: 0.9 },
  { name: 'THE MOON', top: '#04071a', bot: '#1f2d5e', glow: '#fff3c4', edge: '#ffe48a', city: '#060a20', win: '#fff3c4', stars: 1 },
  { name: 'DEEP SPACE', top: '#000004', bot: '#1c0b38', glow: '#cbb0ff', edge: '#b993ff', city: '#05020d', win: '#cbb0ff', stars: 1 },
];
const PAL_KEYS = ['top', 'bot', 'glow', 'edge', 'city', 'win'];
const zonePal = z => {
  const Z = ZONES[z % ZONES.length];
  const p = Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(Z[k])]));
  p.stars = Z.stars;
  p.moon = Math.min(z, 4) / 4;
  return p;
};

// Coats: base, dark (stripes/points), light (muzzle/belly), pattern
const C = (base, dark, light, pat, eye = '#7be07b') => ({ base, dark, light, pat, eye });
export const LITTERS = [
  { id: 'street', name: 'STREET', price: 0, coats: [C('#f5a04a', '#c96a1e', '#ffe2bd', 'tabby'), C('#9aa3b5', '#5f6678', '#e8ebf2', 'tabby', '#ffd34d'), C('#f1dcc0', '#d4b48c', '#fff7ea', 'solid', '#6fc3ff'), C('#8a6a4f', '#4e3826', '#e9d6c0', 'tabby', '#a8e05f')], swatch: 'linear-gradient(135deg,#f5a04a,#9aa3b5,#8a6a4f)' },
  { id: 'tux', name: 'TUXEDO', price: 60, coats: [C('#24242c', '#000000', '#ffffff', 'tux', '#ffd34d')], swatch: 'linear-gradient(135deg,#24242c 55%,#fff 55%)' },
  { id: 'siamese', name: 'SIAMESE', price: 120, coats: [C('#f3e6cf', '#5a3c2b', '#fff8ec', 'points', '#5cc8ff')], swatch: 'linear-gradient(135deg,#5a3c2b,#f3e6cf 60%)' },
  { id: 'calico', name: 'CALICO', price: 200, coats: [C('#fbf6ee', '#2a2420', '#f29a3c', 'calico', '#8fd16a')], swatch: 'radial-gradient(circle at 30% 30%,#f29a3c 20%,transparent 21%),radial-gradient(circle at 70% 65%,#2a2420 18%,#fbf6ee 19%)' },
  { id: 'midnight', name: 'MIDNIGHT', price: 320, coats: [C('#1b1726', '#0b0910', '#3a3350', 'solid', '#ffcf3a')], swatch: 'radial-gradient(circle at 35% 45%,#ffcf3a 9%,transparent 10%),radial-gradient(circle at 65% 45%,#ffcf3a 9%,#1b1726 10%)' },
  { id: 'ghost', name: 'GHOST', price: 480, coats: [C('#eef3ff', '#b8c6ff', '#ffffff', 'ghost', '#7fd8ff')], swatch: 'linear-gradient(135deg,#eef3ff,#b8c6ff)' },
  { id: 'golden', name: 'GOLDEN', price: 800, coats: [C('#ffcc3d', '#d68f00', '#fff1b0', 'gold', '#ff6b3d')], swatch: 'linear-gradient(135deg,#fff1b0,#ffcc3d,#d68f00)' },
  { id: 'cosmic', name: 'COSMIC', price: 1500, coats: [C('#5b2bb5', '#2a0f66', '#ff8ae2', 'cosmic', '#7dffea')], swatch: 'radial-gradient(circle at 30% 30%,#fff 4%,transparent 5%),linear-gradient(135deg,#ff8ae2,#5b2bb5,#2a0f66)' },
];
const TYPES = {
  cat: { w: 100, h: 56 },
  loaf: { w: 112, h: 46 },
  chonk: { w: 132, h: 66 },
  kitten: { w: 76, h: 44 },
};

// ---------------------------------------------------------------- tuning
const PLAT = { x: 0, w: 176, y: 0 };
const L_ROPE = 520;
const HG = 185; // gap between the tower top and the dangling cat's paws
const GRAV = 2900;
const T_PERFECT = 8, T_NICE = 18;
const ampAt = n => Math.min(155, 88 + n * 1.7);
const periodAt = n => Math.max(1.55, 2.5 - n * 0.02);
const driftAt = n => (n < 14 ? 0 : Math.min(55, (n - 14) * 2.5));
const bpmAt = n => Math.min(100, 84 + n * 0.4);

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, U = 1, K = 1;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let cam = { x: 0, y: 0 };
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let bestN = store.get('bestn', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['street']);
let litterId = store.get('litter', 'street');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let rec = null; // record-mode log
let stars = [];
let shakeX = 0, shakeY = 0;

function resize() {
  if (REC) {
    SW = 1080;
    SH = 1920;
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
  K = Math.min(SW / 430, SH / 800);
  if (OG) K = 1.25;
  const r = rng(7);
  stars = Array.from({ length: 110 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.4, p: r() * 6 }));
}

// ---------------------------------------------------------------- runs
function litterOf(r) {
  const id = r && r.bot && !REC && !OG ? 'street' : litterId;
  return LITTERS.find(l => l.id === id) || LITTERS[0];
}
function makeCat(r, n) {
  const x = r.rnd();
  let type = 'cat';
  if (n >= 3) {
    if (n >= 8 && x < 0.16) type = 'kitten';
    else if (n >= 6 && x < 0.32) type = 'chonk';
    else if (x < 0.5) type = 'loaf';
  } else if (x < 0.4) type = 'loaf';
  const T = TYPES[type];
  const lit = litterOf(r);
  const coat = lit.coats[(r.coatI++) % lit.coats.length];
  return { type, w: T.w, h: T.h, m: (T.w * T.h) / 5600, coat, dir: r.rnd() < 0.5 ? -1 : 1, seed: (r.rnd() * 1e9) | 0, x: 0, y: 0, sq: 0, blink: r.rnd() * 4 };
}

function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const r = {
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    rnd: rng(seed ^ 0x5bd1e995),
    coatI: 0,
    cats: [],
    hang: null,
    hangIn: 0,
    hangAge: 0,
    respawn: 0.2,
    falling: null,
    falls: [],
    phase: 0,
    pivotX: 0,
    hy: HG,
    sway: 0,
    swayV: 0,
    lean: 0,
    alarm: false,
    lives: 3,
    score: 0,
    streak: 0,
    maxStreak: 0,
    perfects: 0,
    coinsGot: 0,
    dead: false,
    deadT: 0,
    deathBy: '',
    slow: 1,
    slowT: 0,
    zone: 0,
    pops: [],
    parts: [],
    passedBest: false,
    banner: null,
    hint: null,
    hinted: {},
    t: 0,
    scoreBump: 0,
    zT: 0,
    botPrev: null,
    tutorial: !opts.bot && plays < 2,
  };
  r.phase = r.rnd() * Math.PI * 2;
  const pre = opts.pre || 0;
  for (let i = 0; i < pre; i++) {
    const c = makeCat(r, i);
    const below = r.cats[i - 1] || PLAT;
    c.x = below.x + (i % 3 === 1 ? 7 : i % 3 === 2 ? -5 : 0);
    c.y = topY(r);
    r.cats.push(c);
    r.score += 2;
  }
  r.hy = topY(r) + HG;
  r.pivotX = topX(r);
  palT = zonePal(Math.floor(r.cats.length / ZONE_EVERY));
  r.zone = Math.floor(r.cats.length / ZONE_EVERY);
  if (!opts.keepPal) pal = zonePal(r.zone);
  cam = { x: topX(r) * 0.6, y: topY(r) };
  return r;
}

const topCat = r => r.cats[r.cats.length - 1] || PLAT;
const topY = r => {
  const c = r.cats[r.cats.length - 1];
  return c ? c.y + c.h : PLAT.y;
};
const topX = r => topCat(r).x;
// Horizontal sway of the tower at height y (visual + where the top really is).
const swayAt = (r, y) => {
  const ty = topY(r);
  if (ty <= 0) return 0;
  return r.sway * Math.pow(clamp(y / ty, 0, 1), 1.6);
};
const topDispX = r => topX(r) + swayAt(r, topY(r));
const hangPos = r => {
  const dx = ampAt(r.cats.length) * Math.sin(r.phase);
  return { x: r.pivotX + dx, y: r.hy + L_ROPE - Math.sqrt(L_ROPE * L_ROPE - dx * dx), rot: Math.asin(dx / L_ROPE) };
};
const canDrop = r => !r.dead && r.hang && !r.falling && r.hangIn > 0.55;

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
  plays++;
  store.set('plays', plays);
  pal = zonePal(0);
  sfx('start');
  sfx('revive');
}

// ---------------------------------------------------------------- audio
function ensureAudio() {
  if (REC || !soundOn) return;
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
  const n = run ? run.cats.length : 0;
  const z = run ? run.zone : 0;
  let layer = layerFor(n);
  if (mode === 'title') layer = 2;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(n) };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- update
function update(dt) {
  tReal += dt;
  const r = run;
  if (!r) return;
  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  const n = r.cats.length;

  // the claw swings; a fresh cat drops in after each landing
  r.phase += (wdt * Math.PI * 2) / periodAt(n);
  const pxT = topX(r) + driftAt(n) * Math.sin(r.t * 0.55);
  r.pivotX = lerp(r.pivotX, pxT, 1 - Math.exp(-3 * wdt));
  r.hy = lerp(r.hy, topY(r) + HG, 1 - Math.exp(-6 * wdt));
  if (!r.hang && !r.dead) {
    r.respawn -= wdt;
    if (r.respawn <= 0) {
      r.hang = makeCat(r, n);
      r.hangIn = 0;
      r.hangAge = 0;
    }
  }
  if (r.hang) {
    r.hangIn = Math.min(1, r.hangIn + wdt / 0.28);
    r.hangAge += wdt;
  }
  if (!r.dead && r.bot) botControl(r);

  // tower sway: a damped spring, driven harder the taller it gets
  {
    const w0 = (Math.PI * 2) / 2.6;
    const drive = n < 6 ? 0 : Math.min(26, (n - 6) * 0.9);
    const acc = -w0 * w0 * r.sway - 1.6 * r.swayV + drive * w0 * w0 * 0.35 * Math.sin(r.t * w0);
    r.swayV += acc * wdt;
    r.sway += r.swayV * wdt;
    r.sway = clamp(r.sway, -60, 60);
  }

  // falling cat
  const f = r.falling;
  if (f) {
    f.vy -= GRAV * wdt;
    f.y += f.vy * wdt;
    f.rot *= Math.exp(-14 * wdt);
    if (f.y <= topY(r)) land(r, f);
  }

  // tumbling cats (misses, collapse)
  for (const c of r.falls) {
    c.vy -= 1800 * wdt;
    c.x += c.vx * wdt;
    c.y += c.vy * wdt;
    c.rot += c.vr * wdt;
    c.t += wdt;
  }
  r.falls = r.falls.filter(c => c.t < 4);

  for (const c of r.cats) c.sq *= Math.exp(-9 * dt);

  if (r.dead) {
    r.deadT += dt;
    if (r.attract && r.deadT > 1.8) run = newRun({ bot: true, attract: true, keepPal: true });
    else if (!r.attract && mode === 'play' && r.deadT > (r.deathBy === 'topple' ? 1.5 : 1.1)) gameOver(r);
  }

  // camera
  const look = r.dead && r.deathBy === 'topple' ? 0.4 : 1;
  const k = 1 - Math.exp(-4 * dt * look);
  cam.x = lerp(cam.x, topX(r) * 0.6, k);
  cam.y = lerp(cam.y, topY(r), k);
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  // palette blend
  const pk = 1 - Math.exp(-1.4 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);
  pal.stars = lerp(pal.stars, palT.stars, pk);
  pal.moon = lerp(pal.moon, palT.moon, pk);

  // particles & pops
  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.vy -= (p.g ?? 0) * wdt;
    p.vx *= 0.97;
    p.rot = (p.rot || 0) + (p.vr || 0) * wdt;
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.banner && (r.banner.t += dt) > 2.4) r.banner = null;
  if (r.hint && (r.hint.t += dt) > r.hint.dur) r.hint = null;
  if (mode === 'over') overT += dt;

  // sleepy z's float off the tower
  r.zT -= dt;
  if (r.zT <= 0 && r.cats.length && !r.alarm && !r.dead) {
    r.zT = 0.9 + r.rnd() * 0.8;
    const i = Math.max(0, r.cats.length - 1 - ((r.rnd() * 5) | 0));
    const c = r.cats[i];
    r.parts.push({ kind: 'z', x: c.x + swayAt(r, c.y) + c.dir * c.w * 0.3, y: c.y + c.h, vx: c.dir * 14, vy: 34, life: 1.6, max: 1.6, size: 11 + r.rnd() * 5 });
  }

  if (REC && rec) {
    const last = rec.states[rec.states.length - 1];
    const st = musicState();
    if (st.layer !== last.layer || st.root !== last.root || Math.abs(st.bpm - last.bpm) > 0.5) rec.states.push({ t: rec.t, ...st });
  } else if (audio && soundOn && music) music.tick(musicState());
}

function botControl(r) {
  if (!canDrop(r)) return;
  const k = r.cats.length;
  let off;
  if (r.plan) off = r.plan(k);
  else {
    // attract mode: mostly tidy, sometimes sloppy, then a doomed lean
    r.crashAt ??= 7 + ((r.rnd() * 9) | 0);
    if (k >= r.crashAt) off = 0.62;
    else off = r.rnd() < 0.5 ? 0 : (r.rnd() - 0.5) * 0.7;
    r.plan = null;
  }
  if (r.botOff == null) r.botOff = off;
  const top = topCat(r);
  const target = topDispX(r) + r.botOff * top.w / 2;
  const d = hangPos(r).x - target;
  const prev = r.botPrev;
  r.botPrev = d;
  if (r.hangAge < 0.45) return;
  if (prev != null && Math.sign(prev) !== Math.sign(d)) {
    drop(r, r.botOff === 0 ? target : null);
    r.botOff = null;
  }
}

function drop(r, forceX = null) {
  if (!canDrop(r)) return;
  const h = hangPos(r);
  r.falling = { cat: r.hang, x: forceX ?? h.x, y: h.y, vy: -60, rot: h.rot };
  r.hang = null;
  r.respawn = 0.32;
  r.botPrev = null;
  sfx('drop');
  if (r.tutorial && !r.hinted.drop) r.hinted.drop = true;
}

function land(r, f) {
  const top = topCat(r);
  const c = f.cat;
  const ty = topY(r);
  let rel = f.x - topDispX(r);
  r.falling = null;
  const half = top.w / 2;
  const n0 = r.cats.length;
  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  if (Math.abs(rel) > half + 2) {
    // MISS: it slides off the edge
    const s = Math.sign(rel) || 1;
    r.falls.push({ cat: c, x: f.x, y: ty, vx: s * 140, vy: 120, rot: 0, vr: s * 5, t: 0 });
    r.lives--;
    r.streak = 0;
    shake = 0.5;
    vibrate(50);
    sfx('miss', { m: 70 + ((r.rnd() * 5) | 0) });
    r.pops.push({ text: 'MISS!', sub: r.lives > 0 ? r.lives + (r.lives === 1 ? ' life left' : ' lives left') : '', x: f.x, y: ty + 40, t: 0, dur: 1.1, col: [255, 90, 110], size: 1 });
    r.swayV += rel * 0.6;
    if (r.lives <= 0) die(r, 'miss');
    return;
  }
  let tier, pts, col;
  if (Math.abs(rel) <= T_PERFECT) {
    rel = 0;
    r.streak++;
    r.perfects++;
    r.coinsGot++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
    pts = r.streak >= 3 ? 3 : 2;
    tier = r.streak >= 3 ? 'PURRFECT!' : 'PERFECT';
    col = r.streak >= 3 ? [255, 255, 255] : pal.glow.slice();
  } else {
    r.streak = 0;
    pts = 1;
    rel *= 0.85; // a little cat-magnet: near misses settle a touch inward
    const edgy = Math.abs(rel) > half * 0.72;
    tier = edgy ? 'WHOA!' : Math.abs(rel) <= T_NICE ? 'NICE' : null;
    col = edgy ? [255, 120, 140] : pal.edge.slice();
  }
  c.x = top.x + rel; // rel is measured against the swaying top
  c.y = ty;
  c.sq = 1;
  r.cats.push(c);
  r.maxN = Math.max(r.maxN || 0, r.cats.length);
  // the landing squishes down through the tower
  for (let i = 1; i <= 5 && n0 - i >= 0; i++) r.cats[n0 - i].sq = Math.max(r.cats[n0 - i].sq, 0.55 * Math.pow(0.6, i - 1));
  r.score += pts;
  r.scoreBump = 1;
  if (rel === 0) {
    r.sway *= 0.6;
    r.swayV *= 0.5;
  } else r.swayV += rel * 1.4;

  sfx('land', { heavy: c.type === 'chonk', perfect: tier === 'PERFECT' || tier === 'PURRFECT!', m: tier === 'PERFECT' || tier === 'PURRFECT!' ? meowNote(root, r.streak - 1) : 0, root });
  const px = c.x + swayAt(r, c.y);
  for (let i = 0; i < 10; i++) {
    const s = i % 2 ? 1 : -1;
    r.parts.push({ kind: 'dust', x: px + s * c.w * 0.45, y: ty + 4, vx: s * (60 + r.rnd() * 90), vy: 20 + r.rnd() * 50, g: 60, life: 0.55, max: 0.55, size: 7 + r.rnd() * 7 });
  }
  if (tier === 'PERFECT' || tier === 'PURRFECT!') {
    const big = tier === 'PURRFECT!';
    for (let i = 0; i < (big ? 18 : 10); i++) {
      const a = r.rnd() * Math.PI * 2, sp = 120 + r.rnd() * 220;
      r.parts.push({ kind: big && i % 3 === 0 ? 'heart' : 'star', x: px, y: ty + c.h * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 80, g: 300, life: 0.8, max: 0.8, size: 6 + r.rnd() * 6, col, vr: (r.rnd() - 0.5) * 8 });
    }
    r.parts.push({ kind: 'ring', x: px, y: ty + c.h * 0.5, vx: 0, vy: 0, life: 0.45, max: 0.45, size: 1, col });
    flash = big ? 0.18 : 0.08;
    vibrate(big ? 30 : 15);
  } else if (c.type === 'chonk') shake = 0.35;
  r.pops.push({ text: tier || '', sub: '+' + pts + (r.streak >= 2 ? '  x' + r.streak : ''), x: px, y: ty + c.h, t: 0, dur: tier ? 0.95 : 0.6, col: col || [255, 255, 255], size: tier === 'PURRFECT!' ? 1.15 : tier ? 1 : 0.7 });

  // hints for first-timers
  if (r.tutorial && !tier?.startsWith('P') && !r.hinted.center) {
    r.hinted.center = true;
    r.hint = { text: 'land it dead center for PERFECT', t: 0, dur: 2.6 };
  }

  checkBalance(r);
  if (r.dead) return;

  const n = r.cats.length;
  const z = Math.floor(n / ZONE_EVERY);
  if (z !== r.zone) {
    r.zone = z;
    palT = zonePal(z);
    if (!r.attract) {
      r.banner = { text: ZONES[z % ZONES.length].name, sub: n + ' cats tall!', t: 0 };
      sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
    }
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep stacking', t: 0 };
    sfx('best', { root });
    flash = 0.25;
  }
}

// Real balance: the cats above any cat must keep their centre of mass over it.
function checkBalance(r) {
  const cats = r.cats;
  let m = 0, mx = 0, worst = 0, at = -1;
  for (let k = cats.length - 1; k >= 0; k--) {
    m += cats[k].m;
    mx += cats[k].m * cats[k].x;
    const s = cats[k - 1] || PLAT;
    const ratio = Math.abs(mx / m - s.x) / (s.w / 2);
    if (ratio > worst) {
      worst = ratio;
      at = k;
      r.leanDir = Math.sign(mx / m - s.x);
    }
  }
  r.lean = worst;
  const was = r.alarm;
  r.alarm = worst > 0.7;
  if (worst > 1) {
    topple(r, at, Math.sign(cats[cats.length - 1].x - (cats[at - 1] || PLAT).x) || 1);
    return;
  }
  if (r.alarm && !was) {
    sfx('creak');
    if (!r.attract) r.pops.push({ text: 'WOBBLY!', sub: '', x: topDispX(r), y: topY(r) + 30, t: 0, dur: 1.1, col: [255, 120, 140], size: 0.9 });
    if (r.tutorial && !r.hinted.lean) {
      r.hinted.lean = true;
      r.hint = { text: "it's leaning! drop on the other side", t: 0, dur: 3 };
    }
  }
}

function topple(r, k, s) {
  // the whole top of the tower goes, not just the cat that tipped it
  const fall = r.cats.splice(Math.max(1, Math.min(k, r.cats.length - 6)));
  fall.forEach((c, i) => {
    const h = i / Math.max(1, fall.length - 1);
    r.falls.push({ cat: c, x: c.x + swayAt(r, c.y), y: c.y, vx: s * (60 + h * 260 + r.rnd() * 60), vy: 80 + r.rnd() * 160, rot: 0, vr: s * (1.5 + h * 4 + r.rnd() * 2), t: -i * 0.02 });
  });
  r.alarm = true;
  die(r, 'topple');
}

function die(r, by) {
  r.dead = true;
  r.deadT = 0;
  r.deathBy = by;
  r.hang = null;
  r.slow = 0.4;
  r.slowT = 0.6;
  shake = 1;
  flash = 0.2;
  if (!r.attract) {
    sfx('crash');
    vibrate([60, 40, 90]);
    r.pops.push({ text: by === 'topple' ? 'TIMBERRR!' : 'OUT OF LIVES', sub: '', x: cam.x, y: cam.y + 120, t: 0, dur: 1.4, col: [255, 120, 140], size: 1.2 });
  }
}

function gameOver(r) {
  mode = 'over';
  overT = 0;
  const earned = r.coinsGot + Math.floor(r.score / 10);
  r.earned = earned;
  r.prevBest = best;
  r.isBest = r.score > best;
  coins += earned;
  store.set('coins', coins);
  if (r.isBest) {
    best = r.score;
    store.set('best', best);
  }
  const tall = r.maxN || 0;
  if (tall > bestN) {
    bestN = tall;
    store.set('bestn', bestN);
  }
}

// ---------------------------------------------------------------- render
const sx = x => SW * (OG ? 0.72 : 0.5) + (x - cam.x) * K + shakeX;
const sy = y => SH * (REC ? 0.66 : 0.64) - (y - cam.y) * K + shakeY;

function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}
function roundRect(x, y, w, h, rr) {
  rr = Math.min(rr, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 20 * U;
  shakeY = (Math.random() - 0.5) * shake * 20 * U;
  if (REC) {
    const rr = rng((rec.frame * 7919) | 0);
    shakeX = (rr() - 0.5) * shake * 20 * U;
    shakeY = (rr() - 0.5) * shake * 20 * U;
  }
  drawBackground();
  if (!run) return;
  const r = run;
  drawBuilding();
  drawBestLine(r);
  drawTower(r);
  if (r.falling) {
    const f = r.falling;
    drawCat(f.cat, sx(f.x), sy(f.y), K, { rot: f.rot, face: 'awake', paws: 'tuck' });
  }
  drawHang(r);
  for (const c of r.falls) if (c.t >= 0) drawCat(c.cat, sx(c.x), sy(c.y), K, { rot: c.rot, face: 'alarm', paws: 'hang' });
  drawParts(r);
  drawPops(r);
  if (r.alarm && !r.dead) {
    const a = 0.12 + 0.1 * Math.sin(tReal * 12);
    const vg = g.createRadialGradient(SW / 2, SH / 2, SH * 0.3, SW / 2, SH / 2, SH * 0.75);
    vg.addColorStop(0, 'rgba(255,40,80,0)');
    vg.addColorStop(1, `rgba(255,40,80,${a})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, SW, SH);
  }
  if (flash > 0.01) {
    g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, SW, SH);
  }
  buttons = [];
  if (mode === 'title') drawTitle();
  else {
    if (!(REC && (mode === 'over' || hookOn()))) drawHUD(r);
    if (mode === 'over') drawOver(r);
  }
  if (REC) drawCaptions(r);
}

function drawBackground() {
  const gr = g.createLinearGradient(0, 0, 0, SH);
  gr.addColorStop(0, css(pal.top));
  gr.addColorStop(1, css(pal.bot));
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  // stars
  if (pal.stars > 0.02) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(tReal * 2 + s.p);
      const y = ((s.y * SH + cam.y * 0.04 * K) % SH + SH) % SH;
      g.fillStyle = `rgba(255,255,255,${pal.stars * (0.2 + tw * 0.6) * (1 - 0.6 * y / SH)})`;
      g.fillRect(s.x * SW, y, s.s * U, s.s * U);
    }
  }
  // the moon: the goal. It grows as you climb.
  const mr = Math.min(SW, SH * 0.6) * (0.1 + 0.2 * pal.moon) * (OG ? 1.1 : 1);
  const mx = OG ? SW * 0.86 : SW * 0.76, my = SH * (OG ? 0.28 : 0.2) + (1 - pal.moon) * SH * 0.05;
  const halo = g.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 2.6);
  halo.addColorStop(0, css(pal.glow, 0.28));
  halo.addColorStop(1, css(pal.glow, 0));
  g.fillStyle = halo;
  g.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
  const mg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
  mg.addColorStop(0, '#fffdf0');
  mg.addColorStop(1, css(pal.glow));
  g.fillStyle = mg;
  g.beginPath();
  g.arc(mx, my, mr, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (const [u, v, s] of [[-0.35, -0.1, 0.22], [0.25, 0.3, 0.16], [0.3, -0.35, 0.12], [-0.1, 0.45, 0.1]]) {
    g.beginPath();
    g.arc(mx + u * mr, my + v * mr, s * mr, 0, Math.PI * 2);
    g.fill();
  }
  // far city, sinking away as the tower climbs
  for (let layer = 0; layer < 2; layer++) {
    const par = layer ? 0.5 : 0.25;
    const base = SH * 0.98 + cam.y * par * K;
    if (base - 300 * U > SH) continue;
    const col = layer ? pal.city : pal.city.map((v, i) => lerp(v, pal.bot[i], 0.45));
    const bw = (layer ? 70 : 52) * U;
    const off = (cam.x * par * 0.3 * K) % bw;
    for (let i = -2; i < SW / bw + 3; i++) {
      const id = i + Math.floor((cam.x * par * 0.3 * K) / bw);
      const h = (layer ? 90 : 150) * U * (0.5 + hash(id * 31 + layer * 7) * 0.9);
      const x = i * bw - off;
      g.fillStyle = css(col);
      g.fillRect(x, base - h, bw - 2 * U, h + SH);
      if (layer) {
        g.fillStyle = css(pal.win, 0.75);
        for (let wy = 0; wy < 4; wy++)
          for (let wx = 0; wx < 3; wx++)
            if (hash(id * 97 + wy * 13 + wx) < 0.35) g.fillRect(x + (8 + wx * 19) * U, base - h + (12 + wy * 20) * U, 8 * U, 10 * U);
      }
    }
  }
  // clouds drifting past at height
  if (cam.y > 200) {
    const band = 420;
    const b0 = Math.floor((cam.y - 900) / band);
    for (let b = b0; b < b0 + 7; b++) {
      if (b < 2) continue;
      for (let j = 0; j < 2; j++) {
        const hv = hash(b * 17 + j * 5);
        const wy = b * band + hv * band;
        const y = SH * 0.64 - (wy - cam.y) * K * 0.7;
        if (y < -100 * U || y > SH + 100 * U) continue;
        const x = ((hv * 7.3 + tReal * 0.012 * (j ? 1 : -1)) % 1) * (SW + 300 * U) - 150 * U;
        drawCloud(x, y, (50 + hv * 40) * U, Math.min(0.85, 0.35 + pal.stars * 0.1 + (b - 1) * 0.08));
      }
    }
  }
  // bats in bat country
  if (run && run.zone % ZONES.length === 3) {
    for (let i = 0; i < 4; i++) {
      const t = (tReal * 0.08 + i * 0.27) % 1;
      const x = t * (SW + 120 * U) - 60 * U;
      const y = SH * (0.15 + 0.1 * i) + Math.sin(tReal * 2 + i) * 20 * U;
      const fl = Math.sin(tReal * 18 + i) * 0.6;
      g.fillStyle = 'rgba(10,4,20,0.85)';
      const s = (12 + i * 2) * U;
      poly([[x, y], [x - s, y - s * (0.3 + fl)], [x - s * 0.5, y + s * 0.1], [x, y + s * 0.3], [x + s * 0.5, y + s * 0.1], [x + s, y - s * (0.3 + fl)]]);
      g.fill();
    }
  }
  const vg = g.createRadialGradient(SW / 2, SH * 0.5, SH * 0.25, SW / 2, SH * 0.5, SH * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg;
  g.fillRect(0, 0, SW, SH);
}

function drawCloud(x, y, s, a) {
  g.fillStyle = `rgba(255,255,255,${a * 0.5})`;
  g.beginPath();
  g.ellipse(x, y, s * 1.6, s * 0.45, 0, 0, Math.PI * 2);
  g.ellipse(x - s * 0.5, y - s * 0.25, s * 0.6, s * 0.45, 0, 0, Math.PI * 2);
  g.ellipse(x + s * 0.35, y - s * 0.35, s * 0.7, s * 0.55, 0, 0, Math.PI * 2);
  g.fill();
}

// The rooftop and the cat bed the tower starts on.
function drawBuilding() {
  const top = sy(0);
  if (top - 40 * K > SH) return;
  const x0 = sx(-170), x1 = sx(170);
  g.fillStyle = css(pal.city.map(v => v * 0.8));
  g.fillRect(x0, sy(-26), x1 - x0, SH);
  g.fillStyle = css(pal.city.map(v => v * 1.6 + 10));
  g.fillRect(x0 - 10 * K, sy(-26) - 2, x1 - x0 + 20 * K, 14 * K);
  g.fillStyle = css(pal.win, 0.8);
  for (let wy = 0; wy < 8; wy++)
    for (let wx = 0; wx < 4; wx++)
      if (hash(wy * 11 + wx * 3 + 5) < 0.55) g.fillRect(sx(-140 + wx * 76), sy(-70 - wy * 90), 34 * K, 46 * K);
  // the cat bed: its top is y = 0, where the first cat sleeps
  const cx = sx(PLAT.x), cw = PLAT.w * K;
  g.fillStyle = '#7a2340';
  roundRect(cx - cw / 2 - 8 * K, sy(0) - 4 * K, cw + 16 * K, 30 * K, 13 * K);
  g.fill();
  g.fillStyle = '#d6456b';
  roundRect(cx - cw / 2, sy(0) - 4 * K, cw, 16 * K, 8 * K);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(cx - cw / 2 + 10 * K, sy(0) - 1 * K, cw - 20 * K, 4 * K, 2 * K);
  g.fill();
}

function drawBestLine(r) {
  if (r.bot || bestN < 3 || r.cats.length >= bestN) return;
  let y = 0;
  // estimate the height of the best tower from average cat height
  y = bestN * 54;
  const py = sy(y);
  if (py < -20 || py > SH + 20) return;
  g.strokeStyle = css(pal.glow, 0.7);
  g.lineWidth = 2 * U;
  g.setLineDash([10 * U, 8 * U]);
  g.beginPath();
  g.moveTo(0, py);
  g.lineTo(SW, py);
  g.stroke();
  g.setLineDash([]);
  text('BEST ' + bestN + ' CATS', 12 * U, py - 12 * U, 12 * U, css(pal.glow), 'left', { stroke: 4 * U });
}

function drawTower(r) {
  const alarm = r.alarm || r.dead;
  const jit = r.alarm && !r.dead ? Math.sin(tReal * 40) * 1.5 * U : 0;
  for (let i = 0; i < r.cats.length; i++) {
    const c = r.cats[i];
    const y = sy(c.y);
    if (y - c.h * K * 1.6 > SH || y < -60 * K) continue;
    const x = sx(c.x + swayAt(r, c.y)) + (i > r.cats.length - 6 ? jit : 0);
    let face = 'sleep';
    if (alarm) face = 'alarm';
    else if (i === r.cats.length - 1 && c.sq > 0.4) face = 'happy';
    else if (((tReal + c.blink) % 7) < 0.25 && i > r.cats.length - 4) face = 'awake';
    drawCat(c, x, y, K, { sq: c.sq, face, paws: 'sit' });
  }
}

function drawHang(r) {
  const h = r.hang;
  const hp = hangPos(r);
  const cx = sx(hp.x), by = sy(hp.y);
  // rope from off-screen pivot
  const px = sx(r.pivotX), py = sy(r.hy + L_ROPE + 60);
  const ch = (h ? h.h : 56) * K;
  const sc = h ? back(r.hangIn) : 1;
  const tx = cx, ty = by - ch; // the cat hangs from its top centre
  if (r.dead && !h) return;
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2.4 * K;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(tx - Math.sin(hp.rot) * 16 * K, ty - Math.cos(hp.rot) * 16 * K);
  g.stroke();
  // guide line for first-timers
  if (h && r.tutorial && r.cats.length < 3 && canDrop(r)) {
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.setLineDash([6 * K, 8 * K]);
    g.lineWidth = 2 * K;
    g.beginPath();
    g.moveTo(cx, by + 4 * K);
    g.lineTo(cx, sy(topY(r)));
    g.stroke();
    g.setLineDash([]);
  }
  // the claw
  g.save();
  g.translate(tx, ty);
  g.rotate(hp.rot);
  const open = h ? 1 - ease(r.hangIn) : 1;
  g.strokeStyle = '#d9dde8';
  g.lineWidth = 5 * K;
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    const a = s * (0.35 + open * 0.6);
    g.beginPath();
    g.moveTo(0, -14 * K);
    g.quadraticCurveTo(s * 22 * K * Math.cos(a), 0, s * (10 + open * 14) * K, 12 * K);
    g.stroke();
  }
  g.lineCap = 'butt';
  g.fillStyle = '#8f96aa';
  roundRect(-13 * K, -24 * K, 26 * K, 14 * K, 5 * K);
  g.fill();
  g.fillStyle = css(pal.edge);
  g.beginPath();
  g.arc(0, -17 * K, 4 * K, 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (!h) return;
  drawCat(h, cx, ty + ch * sc, K * sc, { rot: hp.rot, face: 'hang', paws: 'hang', pivotTop: true });
}

// Side-view cat loaf. (cx, by) = bottom centre in px.
function drawCat(c, cx, by, k, o = {}) {
  const w = c.w * k, h = c.h * k;
  const co = c.coat, d = c.dir;
  const pat = co.pat;
  const lw = Math.max(1.5, h * 0.055);
  const line = pat === 'ghost' ? 'rgba(80,100,170,0.55)' : 'rgba(25,12,30,0.92)';
  g.save();
  g.translate(cx, by);
  if (o.rot) {
    if (o.pivotTop) {
      g.translate(0, -h);
      g.rotate(o.rot);
      g.translate(0, h);
    } else {
      g.translate(0, -h / 2);
      g.rotate(o.rot);
      g.translate(0, h / 2);
    }
  }
  const sq = o.sq || 0;
  g.scale(1 + sq * 0.16, 1 - sq * 0.2);
  if (pat === 'ghost') g.globalAlpha *= 0.85;
  if (pat === 'ghost' || pat === 'cosmic' || pat === 'gold') {
    g.shadowColor = pat === 'gold' ? 'rgba(255,200,60,0.7)' : pat === 'ghost' ? 'rgba(140,200,255,0.8)' : 'rgba(255,130,230,0.7)';
    g.shadowBlur = 14 * k;
  }
  const hr = h * 0.47;
  const hx = d * (w / 2 - hr * 0.95), hy = -h * 0.56;
  const darkPts = pat === 'points';
  const baseCol = co.base;
  // tail, curling up the back
  const tailCol = darkPts || pat === 'tux' ? co.dark : baseCol;
  const tail = () => {
    g.beginPath();
    g.moveTo(-d * w * 0.4, -h * 0.28);
    g.bezierCurveTo(-d * w * 0.72, -h * 0.25, -d * w * 0.7, -h * 0.95, -d * w * 0.5, -h * 1.02);
  };
  g.lineCap = 'round';
  tail();
  g.strokeStyle = line;
  g.lineWidth = h * 0.2 + lw * 2;
  g.stroke();
  tail();
  g.strokeStyle = tailCol;
  g.lineWidth = h * 0.2;
  g.stroke();
  if (pat === 'tabby') {
    g.strokeStyle = co.dark;
    g.lineWidth = h * 0.2;
    g.setLineDash([h * 0.09, h * 0.14]);
    tail();
    g.stroke();
    g.setLineDash([]);
  }
  // ears
  const earCol = darkPts ? co.dark : baseCol;
  for (const s of [-1, 1]) {
    const ex = hx + s * hr * 0.52 + d * hr * 0.08;
    const ey = hy - hr * 0.62;
    const tip = [ex + s * hr * 0.12, hy - hr * 1.45];
    poly([[ex - hr * 0.36, ey + hr * 0.2], tip, [ex + hr * 0.36, ey + hr * 0.2]]);
    g.strokeStyle = line;
    g.lineWidth = lw * 2;
    g.lineJoin = 'round';
    g.stroke();
    g.fillStyle = earCol;
    g.fill();
    poly([[ex - hr * 0.17, ey + hr * 0.05], [tip[0], tip[1] + hr * 0.3], [ex + hr * 0.17, ey + hr * 0.05]]);
    g.fillStyle = '#ff9fb4';
    g.fill();
  }
  // body + head outline (union), then fill
  const shape = () => {
    roundRect(-w / 2, -h, w, h, h * 0.46);
    g.moveTo(hx + hr, hy);
    g.arc(hx, hy, hr, 0, Math.PI * 2);
  };
  shape();
  g.strokeStyle = line;
  g.lineWidth = lw * 2;
  g.stroke();
  g.shadowBlur = 0;
  let fill = baseCol;
  if (pat === 'gold') {
    const gr = g.createLinearGradient(-w / 2, -h, w / 2, 0);
    gr.addColorStop(0, co.light);
    gr.addColorStop(0.5, co.base);
    gr.addColorStop(1, co.dark);
    fill = gr;
  } else if (pat === 'cosmic') {
    const gr = g.createLinearGradient(-w / 2, -h, w / 2, 0);
    gr.addColorStop(0, '#ff8ae2');
    gr.addColorStop(0.45, co.base);
    gr.addColorStop(1, co.dark);
    fill = gr;
  }
  roundRect(-w / 2, -h, w, h, h * 0.46);
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  g.arc(hx, hy, hr, 0, Math.PI * 2);
  g.fill();

  // markings, clipped to the body + head
  g.save();
  shape();
  g.clip();
  const R = rng(c.seed);
  if (pat === 'tabby') {
    g.fillStyle = co.dark;
    for (let i = 0; i < 4; i++) {
      const x = -d * w * 0.38 + d * i * w * 0.17;
      g.beginPath();
      g.ellipse(x, -h, w * 0.045, h * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (const s of [-1, 0, 1]) {
      g.beginPath();
      g.ellipse(hx + d * hr * 0.15 + s * hr * 0.28, hy - hr, hr * 0.07, hr * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pat === 'calico') {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? co.dark : co.light;
      g.beginPath();
      g.arc((R() - 0.5) * w * 0.9, -h * (0.4 + R() * 0.7), h * (0.28 + R() * 0.2), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = co.light;
    g.beginPath();
    g.arc(hx - d * hr * 0.5, hy - hr * 0.6, hr * 0.55, 0, Math.PI * 2);
    g.fill();
  } else if (pat === 'tux') {
    g.fillStyle = co.light;
    g.beginPath();
    g.ellipse(hx - d * hr * 0.1, 0, hr * 1.1, h * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(hx + d * hr * 0.25, hy + hr * 0.45, hr * 0.55, hr * 0.45, 0, 0, Math.PI * 2);
    g.fill();
  } else if (pat === 'points') {
    const gr = g.createRadialGradient(hx + d * hr * 0.3, hy + hr * 0.25, hr * 0.1, hx + d * hr * 0.3, hy + hr * 0.25, hr * 0.85);
    gr.addColorStop(0, co.dark);
    gr.addColorStop(1, 'rgba(90,60,43,0)');
    g.fillStyle = gr;
    g.fillRect(hx - hr * 1.5, hy - hr * 1.5, hr * 3, hr * 3);
  } else if (pat === 'cosmic') {
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 9; i++) {
      const s = (0.6 + R() * 1.4) * k;
      g.globalAlpha = 0.5 + 0.5 * Math.sin(tReal * 3 + i);
      g.fillRect((R() - 0.5) * w, -R() * h, s * 2, s * 2);
    }
    g.globalAlpha = 1;
  } else if (pat === 'gold') {
    g.fillStyle = 'rgba(255,255,255,0.45)';
    const t = ((tReal * 0.5 + c.seed * 1e-9) % 1.6) - 0.3;
    poly([[-w / 2 + t * w, -h], [-w / 2 + t * w + w * 0.12, -h], [-w / 2 + t * w - w * 0.1, 0], [-w / 2 + t * w - w * 0.22, 0]]);
    g.fill();
  } else if (pat === 'solid') {
    g.fillStyle = co.light;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.ellipse(0, 0, w * 0.4, h * 0.25, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  // top-light sheen
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.beginPath();
  g.ellipse(-d * w * 0.08, -h * 0.82, w * 0.34, h * 0.13, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // paws
  const pawCol = pat === 'tux' ? co.light : darkPts ? co.dark : pat === 'calico' ? co.base : baseCol;
  const paw = (x, y, rw, rh) => {
    g.beginPath();
    g.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
    g.strokeStyle = line;
    g.lineWidth = lw * 1.6;
    g.stroke();
    g.fillStyle = pawCol;
    g.fill();
  };
  if (o.paws === 'hang') {
    const sw = Math.sin(tReal * 9 + c.seed) * h * 0.04;
    for (const u of [-0.32, -0.16, 0.16, 0.32]) paw(u * w + sw * (u > 0 ? 1 : -1), h * 0.12, h * 0.1, h * 0.17);
  } else if (o.paws === 'sit') {
    paw(hx + d * hr * 0.1 - d * hr * 0.42, -h * 0.07, h * 0.15, h * 0.09);
    paw(hx + d * hr * 0.1 + d * hr * 0.12, -h * 0.07, h * 0.15, h * 0.09);
  }

  // face
  const fx = hx + d * hr * 0.2, fy = hy + hr * 0.05;
  const ex = hr * 0.36;
  const face = o.face || 'sleep';
  const darkHead = pat === 'tux' || pat === 'points' || co.base === '#1b1726';
  const ink = darkHead ? '#fff3c9' : '#2a1626';
  const mouthInk = pat === 'tux' ? '#2a1626' : ink; // tuxedos have a white muzzle
  g.lineCap = 'round';
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1.3, hr * 0.1);
  if (face === 'sleep' || face === 'happy') {
    for (const s of [-1, 1]) {
      g.beginPath();
      if (face === 'sleep') g.arc(fx + s * ex, fy - hr * 0.1, hr * 0.15, 0.15 * Math.PI, 0.85 * Math.PI);
      else g.arc(fx + s * ex, fy - hr * 0.02, hr * 0.15, 1.15 * Math.PI, 1.85 * Math.PI);
      g.stroke();
    }
  } else if (face === 'alarm') {
    for (const s of [-1, 1]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(fx + s * ex, fy - hr * 0.12, hr * 0.26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = line;
      g.lineWidth = lw;
      g.stroke();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(fx + s * ex + d * hr * 0.05, fy - hr * 0.1, hr * 0.09, 0, Math.PI * 2);
      g.fill();
    }
    // sweat drop
    g.fillStyle = '#9fe0ff';
    g.beginPath();
    g.ellipse(hx - d * hr * 0.75, hy - hr * 0.55, hr * 0.12, hr * 0.2, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    for (const s of [-1, 1]) {
      g.fillStyle = co.eye;
      g.beginPath();
      g.ellipse(fx + s * ex, fy - hr * 0.1, hr * 0.17, hr * 0.21, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.ellipse(fx + s * ex + d * hr * 0.03, fy - hr * (face === 'hang' ? 0.02 : 0.1), hr * 0.07, hr * 0.17, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(fx + s * ex - hr * 0.05, fy - hr * 0.2, hr * 0.05, 0, Math.PI * 2);
      g.fill();
    }
  }
  // blush
  g.fillStyle = 'rgba(255,110,150,0.35)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(fx + s * ex * 1.45, fy + hr * 0.22, hr * 0.16, hr * 0.09, 0, 0, Math.PI * 2);
    g.fill();
  }
  // nose + mouth
  g.fillStyle = '#ff7fa0';
  poly([[fx - hr * 0.08, fy + hr * 0.12], [fx + hr * 0.08, fy + hr * 0.12], [fx, fy + hr * 0.22]]);
  g.fill();
  g.strokeStyle = mouthInk;
  g.lineWidth = Math.max(1.1, hr * 0.07);
  g.beginPath();
  if (face === 'alarm') {
    g.ellipse(fx, fy + hr * 0.38, hr * 0.1, hr * 0.12, 0, 0, Math.PI * 2);
  } else {
    g.arc(fx - hr * 0.08, fy + hr * 0.25, hr * 0.08, 0, Math.PI);
    g.moveTo(fx + hr * 0.16, fy + hr * 0.25);
    g.arc(fx + hr * 0.08, fy + hr * 0.25, hr * 0.08, 0, Math.PI);
  }
  g.stroke();
  // whiskers
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = Math.max(0.8, hr * 0.04);
  g.beginPath();
  for (const s of [-1, 1])
    for (const v of [-0.04, 0.1]) {
      g.moveTo(fx + s * hr * 0.3, fy + hr * (0.2 + v));
      g.lineTo(fx + s * hr * 0.95, fy + hr * (0.12 + v * 2));
    }
  g.stroke();
  g.lineCap = 'butt';
  g.restore();
}

function drawParts(r) {
  for (const p of r.parts) {
    const x = sx(p.x), y = sy(p.y);
    const k = p.life / p.max;
    if (p.kind === 'dust') {
      g.fillStyle = `rgba(255,255,255,${0.35 * k})`;
      g.beginPath();
      g.arc(x, y, p.size * K * (1.6 - k), 0, Math.PI * 2);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = 4 * U * k;
      g.beginPath();
      g.arc(x, y, (1 - k) * 110 * K + 10, 0, Math.PI * 2);
      g.stroke();
    } else if (p.kind === 'z') {
      g.globalAlpha = Math.min(1, k * 2) * 0.8;
      text('z', x + Math.sin(p.life * 4) * 6 * K, y, p.size * K * (1.6 - k * 0.6), '#ffffff', 'center', { weight: '700' });
      g.globalAlpha = 1;
    } else if (p.kind === 'heart') {
      g.fillStyle = `rgba(255,110,160,${Math.min(1, k * 1.5)})`;
      const s = p.size * K;
      g.beginPath();
      g.moveTo(x, y + s * 0.6);
      g.bezierCurveTo(x - s * 1.4, y - s * 0.4, x - s * 0.5, y - s * 1.3, x, y - s * 0.5);
      g.bezierCurveTo(x + s * 0.5, y - s * 1.3, x + s * 1.4, y - s * 0.4, x, y + s * 0.6);
      g.fill();
    } else {
      g.save();
      g.translate(x, y);
      g.rotate(p.rot || 0);
      g.fillStyle = css(p.col, Math.min(1, k * 1.5));
      const s = p.size * K;
      poly([[0, -s], [s * 0.3, -s * 0.3], [s, 0], [s * 0.3, s * 0.3], [0, s], [-s * 0.3, s * 0.3], [-s, 0], [-s * 0.3, -s * 0.3]]);
      g.fill();
      g.restore();
    }
  }
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || '700'} ${size}px ${opts.font || FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(20,8,30,0.9)';
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
    const x = clamp(sx(p.x), 120 * U, SW - 120 * U);
    const y = sy(p.y);
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const yy = y - (30 + ease(k) * 50) * U;
    g.globalAlpha = a;
    if (p.text) text(p.text, x, yy, 32 * U * sc, css(p.col), 'center', { stroke: 7 * U, glow: css(p.col, 0.7) });
    if (p.sub) text(p.sub, x, yy + (p.text ? 30 : 0) * U * sc, 19 * U * sc, '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  text(String(r.score), SW / 2, top + 30 * U, 60 * U * bump, '#fff', 'center', { stroke: 8 * U, glow: css(pal.edge, 0.9) });
  const n = r.cats.length;
  text(n + (n === 1 ? ' cat' : ' cats') + ' tall', SW / 2, top + 70 * U, 14 * U, 'rgba(255,255,255,0.8)', 'center', { stroke: 4 * U });
  if (r.streak >= 2) text('PURRFECT x' + r.streak, SW / 2, top + 94 * U, 17 * U, r.streak >= 3 ? '#fff' : css(pal.glow), 'center', { stroke: 5 * U, glow: css(pal.glow, 0.9) });
  // lives
  for (let i = 0; i < 3; i++) drawPaw(SW / 2 + (i - 1) * 24 * U, top + (r.streak >= 2 ? 120 : 98) * U, 8 * U, i < r.lives);
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.4 : 0.33);
    g.fillStyle = 'rgba(10,4,25,0.5)';
    g.fillRect(0, y - 42 * U, SW, 84 * U);
    text(b.text, SW / 2, y - 8 * U, 36 * U * back(b.t / 0.3), '#fff', 'center', { glow: css(pal.glow), stroke: 6 * U });
    text(b.sub, SW / 2, y + 25 * U, 15 * U, css(pal.glow), 'center', { stroke: 4 * U });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  if (r.tutorial && !r.dead) {
    let msg = null, big = false;
    if (!r.hinted.drop && r.hang && canDrop(r)) {
      msg = 'TAP to drop the cat';
      big = true;
    } else if (r.hint) msg = r.hint.text;
    if (msg) {
      const p = 0.5 + 0.5 * Math.sin(tReal * 6);
      text(msg, SW / 2, SH * 0.88, (big ? 26 + p * 2 : 17) * U, '#fff', 'center', { stroke: 6 * U, glow: big ? css(pal.glow) : null });
    }
  }
}

function drawPaw(x, y, s, on) {
  g.fillStyle = on ? '#ff8fb1' : 'rgba(255,255,255,0.18)';
  g.strokeStyle = 'rgba(20,8,30,0.8)';
  g.lineWidth = 2 * U;
  g.beginPath();
  g.ellipse(x, y + s * 0.3, s * 0.75, s * 0.6, 0, 0, Math.PI * 2);
  g.stroke();
  g.fill();
  for (const [u, v] of [[-0.75, -0.45], [-0.25, -0.85], [0.25, -0.85], [0.75, -0.45]]) {
    g.beginPath();
    g.arc(x + u * s, y + v * s, s * 0.27, 0, Math.PI * 2);
    g.stroke();
    g.fill();
  }
}

function drawGem(x, y, r) {
  g.fillStyle = '#ffd650';
  poly([[x, y - r * 1.25], [x + r, y], [x, y + r * 1.25], [x - r, y]]);
  g.fill();
  g.fillStyle = '#fff6c8';
  poly([[x, y - r * 1.25], [x + r * 0.4, y], [x, y + r * 0.3]]);
  g.fill();
}

function soundButton(x, y) {
  const r = 16 * U;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  poly([[x - 7 * U, y - 3 * U], [x - 3 * U, y - 3 * U], [x + 3 * U, y - 8 * U], [x + 3 * U, y + 8 * U], [x - 3 * U, y + 3 * U], [x - 7 * U, y + 3 * U]]);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2 * U;
  if (soundOn) {
    g.beginPath();
    g.arc(x + 4 * U, y, 6 * U, -0.8, 0.8);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(x + 6 * U, y - 5 * U);
    g.lineTo(x + 12 * U, y + 5 * U);
    g.moveTo(x + 12 * U, y - 5 * U);
    g.lineTo(x + 6 * U, y + 5 * U);
    g.stroke();
  }
  buttons.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, act: toggleSound });
}

function pill(label, x, y, w, h, bg, fg, act, size = 20) {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  g.fillStyle = bg;
  roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  text(label, x, y + 1, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

function drawLogo(x, y, s) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.05 + Math.sin(tReal * 2.2) * 0.012);
  text('CAT', 0, -36 * s, 70 * s, '#fff', 'center', { stroke: 11 * s, glow: css(pal.edge), blur: 30 * s });
  text('STACK', 0, 30 * s, 64 * s, css(pal.glow), 'center', { stroke: 11 * s, glow: css(pal.glow), blur: 26 * s });
  g.restore();
}

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(10,4,25,0.8)');
  gr.addColorStop(1, 'rgba(10,4,25,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.27, y = SH * 0.4;
  drawLogo(x, y, 1.75);
  text('stack cats to the moon.', x, y + 160, 34, '#fff', 'center', { stroke: 8 });
  text('free · no download · one tap', x, y + 206, 24, 'rgba(255,255,255,0.85)', 'center', { stroke: 6, weight: '600' });
}

function drawTitle() {
  if (OG) return drawOgTitle();
  const gr = g.createLinearGradient(0, SH * 0.5, 0, SH);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const y = SH * 0.17;
  drawLogo(SW / 2, y, U);
  text('stack cats to the moon.', SW / 2, y + 84 * U, 17 * U, '#fff', 'center', { stroke: 5 * U });
  text("don't wake the tower.", SW / 2, y + 108 * U, 14 * U, 'rgba(255,255,255,0.85)', 'center', { stroke: 4 * U, weight: '600' });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  text('TAP TO PLAY', SW / 2, SH * 0.8, (28 + p * 3) * U, '#fff', 'center', { stroke: 7 * U, glow: css(pal.edge) });
  if (best > 0) text('BEST  ' + best, SW / 2, SH * 0.8 + 38 * U, 16 * U, css(pal.glow), 'center', { stroke: 4 * U });
  pill('CAT CAFÉ', SW / 2, SH * 0.92, 160 * U, 42 * U, 'rgba(255,255,255,0.16)', '#fff', openShop, 17);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(8,3,20,${0.55 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.47 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  g.fillStyle = 'rgba(28,14,52,0.94)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 24 * U);
  g.fill();
  g.strokeStyle = css(pal.edge, 0.85);
  g.lineWidth = 2.5 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  if (r.isBest) text('NEW BEST!', SW / 2, t0 + 40 * U, 32 * U * back(overT / 0.4), css(pal.glow), 'center', { glow: css(pal.glow) });
  else text(r.deathBy === 'topple' ? 'TIMBERRR!' : 'SO CLOSE.', SW / 2, t0 + 40 * U, 28 * U, '#fff');
  text(String(r.score), SW / 2, t0 + 102 * U, 74 * U, '#fff', 'center', { glow: css(pal.edge) });
  let sub;
  const tall = r.maxN || 0;
  if (REC) sub = tall + ' cats tall. can you beat it?';
  else if (r.score === 0) sub = 'tip: tap when the cat is right above the tower';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 5) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = tall + ' cats tall · best ' + r.prevBest;
  text(sub, SW / 2, t0 + 150 * U, 15 * U, css(pal.glow), 'center', { weight: '600' });
  if (REC) {
    text('CAT STACK', SW / 2, t0 - 36 * U, 34 * U, '#fff', 'center', { stroke: 7 * U, glow: css(pal.edge) });
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, '#fff', 'center', { weight: '600' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 238 * U, 17 * U, css(pal.edge), 'center', { weight: '700' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 185 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 186 * U, 17 * U, '#ffd650', 'left');
    pill('RETRY', SW / 2, t0 + 240 * U, cw - 60 * U, 54 * U, css(pal.edge), '#1c0b2e', startGame, 26);
    pill('SHARE', SW / 2 - 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', share, 15);
    pill('CAT CAFÉ', SW / 2 + 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', openShop, 15);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, SH - 30 * U, 12 * U, 'rgba(255,255,255,0.55)', 'center', { weight: '600' });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 330;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 92, 74, i === hook.length - 1 ? css(pal.glow) : '#fff', 'center', { stroke: 16, glow: 'rgba(0,0,0,0.6)' }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  const plan = rec && rec.crashAt;
  if (cap2 && plan && !r.dead && r.cats.length >= plan - 2 && r.cats.length <= plan) {
    text(cap2, SW / 2, 260, 66, '#fff', 'center', { stroke: 14 });
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
  const txt = `I stacked ${r.maxN || 0} cats (${r.score} pts) on CAT STACK 🐱🐱🐱 don't wake the tower. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Cat Stack', text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Paste it to a friend 😼');
    }
  } catch {}
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1800);
}

function openShop() {
  const el = document.getElementById('garage');
  const list = el.querySelector('.cars');
  el.querySelector('.coins').textContent = coins;
  list.innerHTML = '';
  for (const c of LITTERS) {
    const have = owned.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car' + (c.id === litterId ? ' sel' : '') + (have ? '' : ' locked');
    b.innerHTML = `<i style="background:${c.swatch}"></i><b>${c.name}</b><span>${have ? (c.id === litterId ? 'STACKING' : 'SELECT') : '◆ ' + c.price}</span>`;
    b.onclick = () => {
      if (have) {
        litterId = c.id;
        store.set('litter', litterId);
      } else if (coins >= c.price) {
        coins -= c.price;
        owned.push(c.id);
        litterId = c.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('litter', litterId);
        sfx('best', { root: 53 });
      } else {
        toast(`Need ${c.price - coins} more ◆. Land more PERFECTs!`);
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
function press(x, y) {
  ensureAudio();
  if (x != null) {
    const b = hitButton(x, y);
    if (b) {
      sfx('click');
      b.act();
      return;
    }
  }
  if (mode === 'title') startGame();
  else if (mode === 'over') {
    if (overT > 0.45) startGame();
  } else if (run && !run.bot) drop(run);
}
if (!REC) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'ArrowDown' && e.code !== 'Enter') return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page mid-run
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    press(null, null);
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
if (OG || REC) document.querySelector('.back')?.style.setProperty('display', 'none');
if (QA) {
  window.__qa = () => {
    const r = run;
    if (!r) return { mode };
    const h = hangPos(r);
    return { mode, phase: r.phase, pivotX: r.pivotX, score: r.score, n: r.cats.length, lives: r.lives, ready: canDrop(r), hangX: h.x, target: topDispX(r), halfW: topCat(r).w / 2, period: periodAt(r.cats.length), amp: ampAt(r.cats.length), lean: r.lean, leanDir: r.leanDir || 0, dead: r.dead, deathBy: r.deathBy, t: r.t, streak: r.streak, perfects: r.perfects, best, coins, maxN: r.maxN || 0 };
  };
}
if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 26);
  const seed = +(Q.get('seed') || 5);
  const pre = +(Q.get('pre') || 6);
  const nice = new Set((Q.get('nice') || '').split(',').filter(Boolean).map(Number));
  rec = { t: 0, frame: 0, events: [], states: [], musicStart: 0, crashAt };
  run = newRun({
    seed,
    pre,
    bot: true,
    // perfect streaks, a few sloppy ones, then lean it until the tower goes
    plan: k => (k >= crashAt - 2 ? 0.66 : nice.has(k) ? (k % 2 ? 0.3 : -0.3) : 0),
  });
  run.tutorial = false;
  mode = 'play';
  best = 0;
  bestN = 0;
  rec.states.push({ t: 0, ...musicState() });
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.cats.length, streak: run.streak };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('700 40px "Fredoka"').then(() => (window.__recReady = true));
} else if (OG) {
  litterId = 'street';
  run = newRun({ seed: 12, pre: 9, bot: true });
  run.hang = makeCat(run, 9);
  run.hangIn = 1;
  run.phase = 0.5;
  run.hy -= 45;
  pal = zonePal(4);
  palT = zonePal(4);
  pal.stars = 1;
  cam.y = topY(run) - 60;
  cam.x = 0;
  mode = 'title';
  document.fonts.load('700 40px "Fredoka"').finally(() => {
    tReal = 1;
    render();
  });
} else {
  run = newRun({ bot: true, attract: true });
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  };
  document.fonts.load('700 40px "Fredoka"').finally(() => requestAnimationFrame(loop));
}
