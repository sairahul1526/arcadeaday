import { Synth, Music, renderOffline, layerFor, dingNote, LAYER_NAMES, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/bin-it';
const FONT = '"Luckiest Guy", system-ui, sans-serif';
const INK = '#1d2340';
const ORANGE = '#ff8a3d';
const cvs = document.getElementById('game');
const g = cvs.getContext('2d');

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
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, k) => c.map(v => clamp(v * k, 0, 255));
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('bni_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('bni_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONES = [
  { name: 'OFFICE', wall: '#d5e4f2', ceil: '#eef3f8', floor: '#56658a', floor2: '#4b5a7d', desk: '#f0dcb8', ped: '#c3ccdb', accent: '#ff8a3d', glow: '#ffd23f', light: '#fffbe8', sky: '#9fd8ff', board: 'white', win: 'day', fl: 'tiles' },
  { name: 'CLASSROOM', wall: '#f3dca4', ceil: '#fbf3dc', floor: '#b98552', floor2: '#a3713f', desk: '#d9a066', ped: '#7d8fb0', accent: '#3b82f6', glow: '#ffef5a', light: '#fffbe8', sky: '#a7dcff', board: 'chalk', win: 'day', fl: 'planks' },
  { name: 'BOSS OFFICE', wall: '#83503e', ceil: '#efe2cf', floor: '#9b2335', floor2: '#83202f', desk: '#6b3a22', ped: '#5a301c', accent: '#ffd23f', glow: '#ffe08a', light: '#fff1cc', sky: '#ffb36b', board: 'paint', win: 'dusk', fl: 'rug' },
  { name: 'NIGHT SHIFT', wall: '#2e3864', ceil: '#343e6c', floor: '#283056', floor2: '#222a4b', desk: '#4a5486', ped: '#3a4373', accent: '#7cf3ff', glow: '#ff5df0', light: '#a9bbff', sky: '#0f1638', board: 'white', win: 'night', fl: 'tiles', dark: 1 },
  { name: 'ROOFTOP', wall: '#8a8fa8', ceil: '#ff9a6b', floor: '#6d7290', floor2: '#626782', desk: '#b8bdd0', ped: '#9aa0b8', accent: '#ff5d8f', glow: '#ffd23f', light: '#ffffff', sky: '#ff9a6b', board: 'none', win: 'none', fl: 'roof', roof: 1 },
];
const PAL_KEYS = ['wall', 'ceil', 'floor', 'floor2', 'desk', 'ped', 'accent', 'glow', 'light', 'sky'];
const zonePal = z => Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(ZONES[z % ZONES.length][k])]));
const PER_ZONE = 10;

export const PAPERS = [
  { id: 'printer', name: 'PRINTER', base: '#ffffff', line: '#c7d0e0', price: 0 },
  { id: 'notebook', name: 'NOTEBOOK', base: '#f6faff', line: '#6fa8ff', lines: 'ruled', price: 60 },
  { id: 'sticky', name: 'STICKY', base: '#ffe45c', line: '#d6b52a', price: 120 },
  { id: 'news', name: 'NEWSPAPER', base: '#e6e2d6', line: '#59595f', lines: 'print', price: 200 },
  { id: 'map', name: 'MAP', base: '#f3e2b8', line: '#4fa36b', lines: 'map', price: 320 },
  { id: 'cash', name: 'CASH', base: '#a6dba6', line: '#2f7a4a', lines: 'print', price: 480 },
  { id: 'gold', name: 'GOLD', base: '#ffd23f', line: '#c8961a', glow: '#ffe98a', price: 800 },
  { id: 'cosmic', name: 'COSMIC', base: '#5b2dbf', line: '#7cf3ff', lines: 'stars', glow: '#c08bff', price: 1500 },
];

// ---------------------------------------------------------------- tuning
// World is in metres: x right, y up, z away from you. You stand at z = 0.
const R = 0.24, RB = 0.18, H = 0.5; // bin: rim radius, bottom radius, rim height
const BR = 0.06; // paper ball radius
const W_IN = R - BR; // clean in: the ball clears the rim
const W_PERF = W_IN * 0.3; // dead centre
const W_RIM = R + BR; // touches the rim
const RIM_IN = 0.05; // rim rolls closer than this to clean drop in, further roll out
const BY = 1.0; // ball in hand
const GRAV = 9.8;
const WK = 0.012; // wind drift: metres sideways per wind unit per metre thrown
const FIRE_AT = 6; // swish streak for ON FIRE (double points)
const RW = 2.4, RD = 11, RH = 2.7; // room half width, depth, height
const CAMY = 1.5, CAMZ = -1.0, PITCH = 0.15;
const sP = Math.sin(PITCH), cP = Math.cos(PITCH);
const flightT = z => 0.55 + 0.045 * z;
const bpmAt = n => Math.min(96, 82 + n * 0.5);

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, U = 1, F = 1, CX = 0, CY = 0;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let zoneNow = 0;
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['printer']);
let skinId = store.get('skin', 'printer');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let rec = null; // record-mode log
let pulse = 0;
let zoom = { k: 1, fx: 0, fy: 0 };
let swipe = null; // the finger on screen
let trail = []; // swipe trail, screen space
let kbAim = 0, kbUsed = false, keyL = false, keyR = false;
const clock = { next: 0, step: 0, last: 0 };

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
  F = OG ? 900 : Math.min(SH * (SW > SH ? 1.45 : 1.25), SW * 2.3);
  CX = OG ? SW * 0.68 : SW / 2;
  const v = vw([0, BY, 0]);
  CY = SH * (OG ? 1.02 : REC ? 0.84 : 0.86) + (F * v[1]) / v[2];
}
const wide = () => SW > SH * 1.15;

// ---------------------------------------------------------------- 3D
const NEAR = 0.08;
function vw(p) {
  const dy = p[1] - CAMY, dz = p[2] - CAMZ;
  return [p[0], dy * cP + dz * sP, -dy * sP + dz * cP];
}
const prj = v => [CX + (F * v[0]) / v[2], CY - (F * v[1]) / v[2], v[2]];
const P = (x, y, z) => prj(vw([x, y, z]));
function clipPoly(pts) {
  const V = pts.map(vw);
  const out = [];
  for (let i = 0; i < V.length; i++) {
    const a = V[i], b = V[(i + 1) % V.length];
    const ai = a[2] >= NEAR, bi = b[2] >= NEAR;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return out.map(prj);
}
function path3(pts) {
  const s = clipPoly(pts);
  if (s.length < 3) return false;
  g.beginPath();
  s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  return true;
}
function poly3(pts, fill, stroke, lw = 1.5) {
  if (!path3(pts)) return;
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.stroke();
  }
}
function line3(a, b, col, lw) {
  let A = vw(a), B = vw(b);
  if (A[2] < NEAR && B[2] < NEAR) return;
  if (A[2] < NEAR || B[2] < NEAR) {
    const t = (NEAR - A[2]) / (B[2] - A[2]);
    const C = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, NEAR];
    if (A[2] < NEAR) A = C;
    else B = C;
  }
  const p = prj(A), q = prj(B);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(p[0], p[1]);
  g.lineTo(q[0], q[1]);
  g.stroke();
}
const lwAt = z => clamp((F * 0.0042) / Math.max(0.5, vw([0, 0.5, z])[2]), 0.7, 3.2 * U);

// axis-aligned box, only the faces you can see
function box(x0, x1, y0, y1, z0, z1, col, opt = {}) {
  const lw = opt.lw ?? lwAt((z0 + z1) / 2);
  const ol = opt.ol ?? 'rgba(29,35,64,0.55)';
  const front = opt.front || css(col);
  const side = opt.side || css(shade(col, 0.8));
  const top = opt.top || css(shade(col, 1.12));
  if (x0 > 0) poly3([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], opt.left || side, ol, lw);
  if (x1 < 0) poly3([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], opt.right || side, ol, lw);
  if (y1 < CAMY) poly3([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top, ol, lw);
  poly3([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], front, ol, lw);
}
// a disc in a vertical plane x = xc (faces sideways), as screen points
function discX(xc, yc, zc, r, n = 20) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push([xc, yc + Math.sin(a) * r, zc + Math.cos(a) * r]);
  }
  return pts;
}
function discY(xc, y, zc, r, n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push([xc + Math.cos(a) * r, y, zc + Math.sin(a) * r]);
  }
  return pts;
}
function discZ(xc, yc, z, r, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push([xc + Math.cos(a) * r, yc + Math.sin(a) * r, z]);
  }
  return pts;
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const r = {
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    off: opts.off || 0,
    rnd: rng(seed ^ 0x5bd1e995),
    state: 'next',
    bin: { x: 0, z: 3.4, fx: 0, fz: 3.4, k: 1, mover: null, t0: 0 },
    wind: { W: 0, gust: null },
    ball: { x: 0, y: BY, z: 0, rot: 0, vr: 0, s: 0, vx: 0, vy: 0, vz: 0, ox: 0, oz: 0 },
    gold: false,
    fl: null,
    rim: null,
    pile: [],
    score: 0,
    n: 0,
    streak: 0,
    maxStreak: 0,
    perfects: 0,
    rims: 0,
    dead: false,
    deadT: 0,
    floorHit: false,
    slow: 1,
    slowT: 0,
    layer: 0,
    coinsGot: 0,
    pops: [],
    parts: [],
    wisps: [],
    passedBest: false,
    banner: null,
    layerPop: null,
    t: 0,
    stT: 0,
    scoreBump: 0,
    lastKind: null,
    tutorial: !opts.bot && plays < 2,
    windTip: !opts.bot && plays < 4,
    windTipOn: false,
    tapHint: 0,
    queued: null,
    botSw: null,
    fanRot: [0, 0],
  };
  setupThrow(r, true);
  palT = zonePal(0);
  if (!opts.keepPal) {
    pal = zonePal(0);
    zoneNow = 0;
  }
  return r;
}

function binX(r, t) {
  const b = r.bin;
  const x = lerp(b.fx, b.x, ease(b.k));
  if (!b.mover) return x;
  const m = b.mover;
  return x + m.A * Math.sin((TAU * (t - m.t0)) / m.P);
}
const binZ = r => lerp(r.bin.fz, r.bin.z, ease(r.bin.k));
function windNow(r) {
  const w = r.wind;
  if (!w.gust) return w.W;
  return w.W * (0.55 + 0.45 * Math.sin(w.gust.w * r.t + w.gust.ph));
}

// Where the next bin goes, and how hard the wind blows. Gets harder with every make.
function setupThrow(r, first) {
  const n = r.n + r.off;
  const rnd = r.rnd;
  let bz, bx, W = 0;
  if (n < 2) {
    bz = 3.4;
    bx = n === 0 ? 0 : (rnd() < 0.5 ? -1 : 1) * 0.16;
  } else {
    bz = clamp(3.4 + Math.min(4.6, n * 0.22) + lerp(-0.3, 0.5, rnd()), 3.2, 8);
    const amp = Math.min(0.75, 0.15 + n * 0.03);
    bx = (rnd() * 2 - 1) * amp;
    const mag = n < 5 ? lerp(0.6, 2.2, rnd()) : lerp(1.5, Math.min(10, 3 + n * 0.25), rnd());
    W = (Math.round(mag * 100) / 100) * (rnd() < 0.5 ? -1 : 1);
  }
  let mover = null;
  if (n >= 14 && rnd() < 0.3) mover = { A: lerp(0.25, 0.45, rnd()), P: lerp(2.4, 3.2, rnd()), t0: 0 };
  // keep the bin on screen on a narrow phone
  const zv = vw([0, H, bz])[2];
  const lim = Math.max(0.05, Math.min(1.4, (SW * 0.4 * zv) / F) - R - (mover ? mover.A : 0));
  bx = clamp(bx, -lim, lim);
  const gust = n >= 22 && W !== 0 && rnd() < 0.3 ? { w: TAU / lerp(1.6, 2.4, rnd()), ph: rnd() * TAU } : null;
  const b = r.bin;
  b.fx = first ? bx : lerp(b.fx, b.x, ease(b.k)) + (b.mover ? b.mover.A * Math.sin((TAU * (r.t - b.mover.t0)) / b.mover.P) : 0);
  b.fz = first ? bz : binZ(r);
  b.x = bx;
  b.z = bz;
  b.k = first ? 1 : 0;
  b.mover = mover;
  if (mover) mover.t0 = r.t + 0.45;
  r.wind = { W, gust };
  r.gold = n >= 3 && rnd() < 0.12;
  r.state = 'next';
  r.stT = 0;
  r.fl = null;
  r.rim = null;
  const ball = r.ball;
  Object.assign(ball, { x: 0, y: BY, z: 0, rot: rnd() * TAU, vr: 0, s: 0 });
  if (W !== 0 && r.windTip) {
    r.windTip = false;
    r.windTipOn = true;
  }
}

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
  swipe = null;
  trail = [];
  plays++;
  store.set('plays', plays);
  sfx('start');
  sfx('revive');
}

// ---------------------------------------------------------------- audio
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
  if (run && run.attract && mode !== 'title') return;
  if (audio && soundOn && audio.ctx.state === 'running') audio.play(type, audio.ctx.currentTime + 0.005, e);
}
function musicState() {
  let layer = run ? run.layer : 0;
  if (mode === 'title') layer = 3;
  return { layer, root: ZONE_ROOTS[zoneNow % ZONE_ROOTS.length], bpm: bpmAt(run ? run.n : 0) };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- throwing
// Screen geometry of the throw: the ball in your hand and the row of the bin's rim.
function aimRows(r) {
  const pb = P(0, BY, 0), pr = P(0, H, r.bin.z);
  return { bx: pb[0], by: pb[1], ry: pr[1], rz: pr[2] };
}
// Swipe angle (0 = straight up the screen) to the x it crosses the rim plane at, with no wind.
// It's visually honest: flick straight at the bin and, without wind, it goes in.
function xaFor(r, ang) {
  const a = aimRows(r);
  return ((a.bx + (a.by - a.ry) * Math.tan(ang) - CX) * a.rz) / F;
}
function angFor(r, xa) {
  const a = aimRows(r);
  return Math.atan2(CX + (F * xa) / a.rz - a.bx, a.by - a.ry);
}
// The angle that lands the ball e metres from the bin centre, wind and moving bin included.
function idealAng(r, e = 0) {
  const T = flightT(r.bin.z);
  return angFor(r, binX(r, r.t + T) + e - windNow(r) * WK * r.bin.z);
}

function throwBall(r, ang) {
  ang = clamp(ang, -1.1, 1.1);
  const z = r.bin.z;
  const T = flightT(z);
  const xa = xaFor(r, ang);
  const W = windNow(r);
  r.fl = { t: 0, t0: r.t, T, vx: xa / T, vy: (H - BY + (GRAV * T * T) / 2) / T, vz: z / T, ax: (2 * W * WK * z) / (T * T), ang, W };
  r.state = 'fly';
  r.stT = 0;
  r.ball.vr = (8 + r.rnd() * 4) * (ang >= 0 ? 1 : -1);
  r.windTipOn = false;
  if (r.tutorial && r.n === 0) r.tutorial = r.n < 1;
  sfx('throw', { v: 1 });
  vibrate(8);
}

function botWant(r) {
  // desired landing error in metres from the bin centre
  const k = r.n;
  if (r.plan) return r.plan(k, r);
  const s = r.rnd() < 0.5 ? -1 : 1;
  const x = r.rnd();
  if (r.attract) {
    if (k >= (r.crashAt ??= 5 + ((r.rnd() * 9) | 0))) return s * (W_IN + 0.06 + r.rnd() * 0.2);
    if (x < 0.25) return s * r.rnd() * 0.03;
    if (x < 0.85) return s * (0.05 + r.rnd() * 0.08);
    return s * (W_IN + 0.012 + r.rnd() * 0.03);
  }
  return 0;
}

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
  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  r.stT += wdt;
  const b = r.ball;
  const bin = r.bin;
  if (bin.k < 1) bin.k = Math.min(1, bin.k + wdt / 0.42);

  if (r.state === 'next') {
    b.s = back(r.stT / 0.32);
    if (bin.k >= 1 && r.stT > 0.3) {
      r.state = 'ready';
      r.stT = 0;
      r.botSw = null;
    }
  }
  if (r.state === 'ready') {
    b.s = 1;
    b.y = BY + Math.sin(r.t * 3) * 0.006;
    if (r.bot) botStep(r, wdt);
    else if (r.queued != null && mode === 'play') {
      const a = r.queued;
      r.queued = null;
      throwBall(r, a);
    }
    if (kbUsed && !r.bot) kbAim = clamp(kbAim + ((keyR ? 1 : 0) - (keyL ? 1 : 0)) * 0.55 * dt, -0.9, 0.9);
  }
  if (r.state === 'fly') {
    const f = r.fl;
    f.t += wdt;
    const t = Math.min(f.t, f.T);
    b.x = f.vx * t + 0.5 * f.ax * t * t;
    b.y = BY + f.vy * t - 0.5 * GRAV * t * t;
    b.z = f.vz * t;
    b.rot += b.vr * wdt;
    if (r.streak >= FIRE_AT) flame(r, b, 2);
    if (f.t >= f.T) resolve(r);
  } else if (r.state === 'rim') stepRim(r, wdt);
  else if (r.state === 'in') {
    b.vy -= GRAV * wdt;
    b.y += b.vy * wdt;
    b.ox *= Math.exp(-3 * wdt);
    b.oz *= Math.exp(-3 * wdt);
    b.rot += b.vr * wdt;
    const floorY = 0.04 + BR + Math.min(6, r.pile.length) * 0.012;
    if (b.y < floorY) {
      if (b.vy < -1) sfx('crumple', { v: 0.5 });
      b.y = floorY;
      b.vy = 0;
      b.vr = 0;
    }
    if (r.stT > (REC ? 0.42 : 0.55)) {
      r.pile.push({ ox: b.ox, oz: b.oz, rot: b.rot, gold: r.gold });
      if (r.pile.length > 7) r.pile.shift();
      setupThrow(r, false);
    }
  } else if (r.state === 'miss') stepMiss(r, wdt);

  if (r.dead) {
    r.deadT += dt;
    if (r.attract && r.deadT > 1.8) {
      run = newRun({ bot: true, attract: true, keepPal: true });
      zoneNow = 0;
      palT = zonePal(0);
    } else if (!r.attract && mode === 'play' && r.deadT > 1.55) gameOver(r);
  }

  // zoom: lean in on rim rattles
  let zt = 1, fx = CX, fy = SH * 0.6;
  if (r.state === 'rim' && r.rim.c > 0.3) {
    const p = P(binX(r, r.t), H, binZ(r));
    zt = 1 + 0.5 * Math.min(1, r.rim.c * 1.2);
    fx = p[0];
    fy = p[1];
  }
  const zk = 1 - Math.exp(-(zt > zoom.k ? 5 : 3) * dt);
  zoom.k = lerp(zoom.k, zt, zk);
  zoom.fx = lerp(zoom.fx || CX, fx, zk);
  zoom.fy = lerp(zoom.fy || SH * 0.6, fy, zk);

  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);
  if (r.tapHint > 0) r.tapHint -= dt;

  // zone palette
  const pk = 1 - Math.exp(-2.5 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);

  // fans and wind wisps
  const W = windNow(r);
  const side = W > 0 ? 0 : 1; // fan on the left blows right
  for (let i = 0; i < 2; i++) r.fanRot[i] += (i === side && W !== 0 ? 6 + Math.abs(W) * 3 : r.fanRot[i] % 1 ? 0 : 0) * wdt;
  if (W !== 0 && r.wisps.length < 10 + Math.abs(W) * 4 && r.rnd() < wdt * (6 + Math.abs(W) * 5)) {
    const s = Math.sign(W);
    r.wisps.push({ x: -s * (RW - 0.3), y: lerp(0.5, 2.0, r.rnd()), z: lerp(1.2, Math.min(RD - 1, binZ(r) + 1.5), r.rnd()), life: 0, s, sp: 1.6 + Math.abs(W) * 0.45 });
  }
  for (const w of r.wisps) {
    w.life += wdt;
    w.x += w.s * w.sp * wdt;
  }
  r.wisps = r.wisps.filter(w => Math.abs(w.x) < RW - 0.2 && w.life < 4 && Math.sign(windNow(r) || w.s) === w.s);

  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.z += p.vz * wdt;
    p.vy -= (p.g ?? 9) * wdt;
    if (p.rot != null) p.rot += p.vr * wdt;
    if (p.kind === 'paper') {
      p.vx *= Math.exp(-1.8 * wdt);
      p.vz *= Math.exp(-1.8 * wdt);
      p.vy = Math.max(p.vy, -1.2);
    }
    if (p.y < 0.005 && p.kind !== 'flame') {
      p.y = 0.005;
      p.vy = 0;
      p.vx *= 0.8;
      p.vz *= 0.8;
    }
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.2) r.banner = null;
  }
  if (r.layerPop) {
    r.layerPop.t += dt;
    if (r.layerPop.t > 1.5) r.layerPop = null;
  }
  for (const p of trail) p.a += dt;
  while (trail.length && trail[0].a > 0.28) trail.shift();
  if (mode === 'over') overT += dt;

  if (!REC && audio && soundOn) music.tick(musicState());
}

function botStep(r, dt) {
  const think = r.attract ? 0.6 : REC ? 0.3 : 0.45;
  if (!r.botSw) {
    if (r.stT < think) return;
    const e = botWant(r);
    const a0 = aimRows(r);
    r.botSw = { t: 0, e, ang: idealAng(r, e), x0: a0.bx, y0: a0.by + 70 * U };
  }
  const s = r.botSw;
  s.t += dt;
  const k = ease(s.t / 0.15);
  const len = 150 * U;
  const x = s.x0 + Math.sin(s.ang) * len * k, y = s.y0 - Math.cos(s.ang) * len * k;
  if (!r.attract || mode === 'title') trail.push({ x, y, a: 0 });
  if (s.t >= 0.15) {
    // aim at the moment of release, so a moving bin is led correctly
    throwBall(r, idealAng(r, s.e));
    r.botSw = null;
  }
}

function resolve(r) {
  const f = r.fl, b = r.ball;
  const T = f.T;
  b.x = f.vx * T + 0.5 * f.ax * T * T;
  b.y = H;
  b.z = f.vz * T;
  const bx = binX(r, f.t0 + T);
  const e = b.x - bx, ae = Math.abs(e);
  r.lastE = e;
  b.vx = f.vx + f.ax * T;
  b.vy = f.vy - GRAV * T;
  b.vz = f.vz;
  if (ae < W_PERF) dropIn(r, 'perfect', e, 0);
  else if (ae < W_IN) dropIn(r, 'swish', e, 0);
  else if (ae < W_RIM) startRim(r, e);
  else miss(r, 'miss');
}

function dropIn(r, kind, ox, oz) {
  const b = r.ball;
  r.state = 'in';
  r.stT = 0;
  b.ox = ox;
  b.oz = oz;
  b.vy = Math.min(b.vy, -1.5);
  b.vr *= 0.5;
  make(r, kind);
}

function startRim(r, e) {
  const d = Math.abs(e) - W_IN;
  const inn = d < RIM_IN;
  const c = 1 - clamp(Math.abs(d - RIM_IN) / 0.06, 0, 1); // 1 = right on the edge
  const dir = e > 0 ? 1 : -1;
  const ex = clamp(e, -R * 0.97, R * 0.97);
  const psi0 = Math.atan2(-Math.sqrt(R * R - ex * ex), ex);
  const dur = 0.32 + 0.95 * c;
  r.rim = { t: 0, dur, inn, c, dir, psi0, travel: 0.5 + 2.4 * c, hops: 2 + Math.round(4 * c), tick: 0, psi: psi0 };
  r.state = 'rim';
  r.stT = 0;
  r.ball.vr = dir * 6;
  sfx('rim', { v: 1 });
  vibrate(10);
  shake = Math.max(shake, 0.2);
  if (c > 0.3) {
    r.slow = 0.5;
    r.slowT = 9; // until the rim decides
    sfx('gasp');
    if (!r.attract) r.pops.push({ text: 'ooo…', sub: '', w: [binX(r, r.t), H + 0.3, binZ(r)], t: 0, dur: dur / 0.5, col: [255, 255, 255], size: 0.8, small: true });
  }
}

function stepRim(r, dt) {
  const R0 = r.rim, b = r.ball;
  R0.t += dt;
  const u = clamp(R0.t / R0.dur, 0, 1);
  R0.psi = R0.psi0 + R0.dir * R0.travel * (1 - (1 - u) * (1 - u));
  const hp = u * R0.hops;
  const hop = Math.abs(Math.sin(Math.PI * hp)) * 0.07 * (1 - u) * (1 - u);
  if (Math.floor(hp) > R0.tick) {
    R0.tick = Math.floor(hp);
    sfx('rim', { v: 0.75 * (1 - u) + 0.2 });
  }
  const bx = binX(r, r.t), bz = binZ(r);
  b.x = bx + Math.cos(R0.psi) * R;
  b.z = bz + Math.sin(R0.psi) * R;
  b.y = H + BR * 0.55 + hop;
  b.rot += b.vr * dt;
  if (u >= 1) {
    r.slow = 1;
    r.slowT = 0;
    if (R0.inn) {
      r.ball.vy = -0.5;
      dropIn(r, 'rim', Math.cos(R0.psi) * R * 0.6, Math.sin(R0.psi) * R * 0.6);
      sfx('cheer', { v: 0.18 });
    } else {
      b.vx = Math.cos(R0.psi) * 0.9 + (r.rnd() - 0.5) * 0.2;
      b.vz = Math.sin(R0.psi) * 0.9;
      b.vy = 0.9;
      miss(r, 'out');
    }
  }
}

function miss(r, kind) {
  r.state = 'miss';
  r.stT = 0;
  r.floorHit = false;
  r.lastKind = kind;
  r.dead = true;
  r.deadT = 0;
  const wasStreak = r.streak;
  r.streak = 0;
  r.layer = 0;
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });
  if (!r.attract) {
    if (wasStreak >= 4) sfx('drop');
    r.pops.push({ text: kind === 'out' ? 'RIM OUT!' : 'MISSED!', sub: '', w: [binX(r, r.t), H + 0.45, binZ(r)], t: 0, dur: 1.5, col: [255, 93, 110], size: 1.15 });
  }
}

function stepMiss(r, dt) {
  const b = r.ball;
  b.vy -= GRAV * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y < BR) {
    b.y = BR;
    if (!r.floorHit) {
      r.floorHit = true;
      if (!r.attract) {
        sfx('miss');
        shake = 0.6;
        flash = 0.12;
        vibrate([40, 30, 80]);
      } else sfx('floor');
    } else if (b.vy < -0.8) sfx('floor');
    b.vy = b.vy < -0.6 ? -b.vy * 0.4 : 0;
    b.vx *= 0.7;
    b.vz *= 0.6;
    b.vr = (Math.hypot(b.vx, b.vz) / BR) * (b.vr >= 0 ? 1 : -1);
  }
  if (b.y <= BR + 0.001) {
    const k = Math.exp(-1.6 * dt);
    b.vx *= k;
    b.vz *= k;
  }
  if (b.z > RD - BR) {
    b.z = RD - BR;
    b.vz = -Math.abs(b.vz) * 0.4;
  }
  if (Math.abs(b.x) > RW - BR) {
    b.x = Math.sign(b.x) * (RW - BR);
    b.vx = -b.vx * 0.4;
  }
  // don't roll through the bin
  const dx = b.x - binX(r, r.t), dz = b.z - binZ(r);
  const d = Math.hypot(dx, dz), md = R + BR;
  if (b.y < H + BR && d < md && d > 1e-4) {
    b.x += (dx / d) * (md - d);
    b.z += (dz / d) * (md - d);
    const vn = (b.vx * dx + b.vz * dz) / d;
    if (vn < 0) {
      b.vx -= 1.6 * vn * (dx / d);
      b.vz -= 1.6 * vn * (dz / d);
    }
  }
  b.rot += b.vr * dt;
}

function make(r, kind) {
  const prevLayer = r.layer;
  const wasFire = r.streak >= FIRE_AT;
  let pts = kind === 'perfect' ? 3 : kind === 'swish' ? 2 : 1;
  if (kind === 'rim') {
    if (r.streak >= 4 && !r.attract) sfx('drop');
    r.streak = 0;
    r.rims++;
  } else {
    r.streak++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  }
  const fire = r.streak >= FIRE_AT;
  if (fire) pts *= 2;
  r.layer = layerFor(r.streak);
  if (r.layer > prevLayer && !r.attract && r.layer < 5) r.layerPop = { name: LAYER_NAMES[r.layer], t: 0 };
  r.score += pts;
  r.n++;
  r.scoreBump = 1;
  r.lastKind = kind;
  if (kind === 'perfect') r.perfects++;
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });
  const root = ZONE_ROOTS[zoneNow % ZONE_ROOTS.length];
  const bx = binX(r, r.t), bz = binZ(r);
  sfx(kind === 'rim' ? 'thud' : 'swish');
  sfx('ding', { m: dingNote(root, kind === 'rim' ? 0 : r.streak - 1), big: kind === 'perfect' || fire });
  vibrate(kind === 'perfect' ? 22 : 12);
  const label = kind === 'perfect' ? 'PERFECT!' : kind === 'swish' ? 'SWISH!' : 'RIM IN!';
  const col = kind === 'perfect' ? [255, 210, 63] : kind === 'swish' ? [255, 255, 255] : [124, 243, 255];
  const sub = '+' + pts + (fire ? '  ×2' : r.streak > 1 ? '   x' + r.streak : kind === 'rim' ? '  lucky' : '');
  if (!r.attract || kind === 'perfect') {
    for (const p of r.pops) if (p.t > 0.15) p.t = Math.max(p.t, p.dur * 0.75);
    r.pops.push({ text: label, sub, w: [bx, H + 0.42, bz], t: 0, dur: 1.0, col, size: kind === 'perfect' ? 1.15 : 0.95 });
  }
  let gem = kind === 'perfect' ? 1 : 0;
  if (r.gold) gem += 3;
  if (gem && !r.attract) {
    r.coinsGot += gem;
    sfx('coin');
    for (let i = 0; i < gem; i++) r.parts.push({ x: bx + (i - (gem - 1) / 2) * 0.09, y: H + 0.1, z: bz, vx: (i - (gem - 1) / 2) * 0.3, vy: 2.6, vz: 0, g: 6, life: 0.8, max: 0.8, kind: 'gem' });
  }
  if (kind === 'perfect') {
    flash = Math.max(flash, 0.12);
    r.slow = 0.3;
    r.slowT = 0.07;
    ring(r, bx, bz, [255, 210, 63]);
    paper(r, bx, H, bz, 14);
  } else if (kind === 'swish') ring(r, bx, bz, [255, 255, 255]);
  else shake = Math.max(shake, 0.25);
  if (fire && !wasFire) {
    sfx('fire');
    flash = 0.35;
    shake = 0.5;
    vibrate([30, 40, 60]);
    if (!r.attract) r.banner = { text: 'ON FIRE!', sub: 'every bin is worth double', t: 0 };
    paper(r, bx, H, bz, 30);
  } else if (fire) flame(r, { x: bx, y: H, z: bz }, 10);
  if (wasFire && !fire && !r.attract) r.pops.push({ text: '', sub: 'fire’s out…', w: [bx, H + 0.1, bz], t: 0, dur: 1.2, col: [255, 255, 255], size: 0.8 });
  // zone change
  const z = Math.floor(r.n / PER_ZONE) % ZONES.length;
  const zPrev = Math.floor((r.n - 1) / PER_ZONE) % ZONES.length;
  if (z !== zPrev) {
    zoneNow = z;
    palT = zonePal(z);
    flash = Math.max(flash, 0.3);
    if (!r.attract) r.banner = { text: ZONES[z].name, sub: 'floor ' + (Math.floor(r.n / PER_ZONE) + 1), t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep tossing', t: 0 };
    sfx('best', { root });
    flash = Math.max(flash, 0.3);
  }
}

function ring(r, x, z, col) {
  r.parts.push({ x, y: H, z, vx: 0, vy: 0, vz: 0, g: 0, life: 0.45, max: 0.45, kind: 'ring', col });
}
function paper(r, x, y, z, n) {
  const cols = [[255, 255, 255], [255, 228, 92], [124, 243, 255], [255, 138, 61], [255, 93, 143]];
  for (let i = 0; i < n; i++) {
    const a = r.rnd() * TAU;
    const sp = 0.6 + r.rnd() * 1.4;
    r.parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: 2 + r.rnd() * 2.5, vz: Math.sin(a) * sp * 0.6, g: 6, life: 1.1 + r.rnd() * 0.6, max: 1.7, kind: 'paper', col: cols[i % cols.length], rot: r.rnd() * 6, vr: (r.rnd() - 0.5) * 16 });
  }
}
function flame(r, b, n) {
  for (let i = 0; i < n; i++) r.parts.push({ x: b.x + (r.rnd() - 0.5) * BR, y: b.y + (r.rnd() - 0.5) * BR, z: b.z + (r.rnd() - 0.5) * BR, vx: (r.rnd() - 0.5) * 0.3, vy: 0.6 + r.rnd() * 0.5, vz: -0.2, g: -0.5, life: 0.3 + r.rnd() * 0.15, max: 0.45, kind: 'flame' });
}

function gameOver(r) {
  mode = 'over';
  overT = 0;
  const earned = r.coinsGot + Math.floor(r.score / 5);
  r.earned = earned;
  r.prevBest = best;
  r.isBest = r.score > best;
  coins += earned;
  store.set('coins', coins);
  if (r.isBest) {
    best = r.score;
    store.set('best', best);
  }
}

// ---------------------------------------------------------------- render
let shakeX = 0, shakeY = 0;
function worldT() {
  const k = zoom.k;
  g.setTransform(DPR * k, 0, 0, DPR * k, DPR * (zoom.fx * (1 - k) + shakeX), DPR * (zoom.fy * (1 - k) + shakeY));
}
function screenT() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
}
const toScreen = p => [zoom.fx + (p[0] - zoom.fx) * zoom.k + shakeX, zoom.fy + (p[1] - zoom.fy) * zoom.k + shakeY];

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
  g.fillStyle = INK;
  g.fillRect(0, 0, SW, SH);
  shakeX = (Math.random() - 0.5) * shake * 14 * U;
  shakeY = (Math.random() - 0.5) * shake * 14 * U;
  const r = run;
  worldT();
  drawRoom(r);
  if (r) drawScene(r);
  screenT();
  drawVignette(r);
  if (r) drawTrail(r);
  if (r) drawPops(r);
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
  // the paper flies over the HUD, it's closer to you than the wall the HUD sits on
  if (r && r.state === 'fly' && mode !== 'title') {
    worldT();
    const b = r.ball;
    drawBall(b.x, b.y, b.z, b.rot, skin(r), 1, { fire: r.streak >= FIRE_AT, gold: r.gold });
    screenT();
  }
  if (REC) drawCaptions(r);
}

// ---------- room
function drawRoom(r) {
  const Z = ZONES[zoneNow];
  const N = CAMZ + 0.05;
  const ink = 'rgba(29,35,64,0.35)';
  if (Z.roof) {
    // sunset sky behind everything
    screenT();
    const hz = P(0, 0, 400)[1];
    const gr = g.createLinearGradient(0, 0, 0, hz);
    gr.addColorStop(0, '#3b2a6b');
    gr.addColorStop(0.55, '#ff6f91');
    gr.addColorStop(1, '#ffc46b');
    g.fillStyle = gr;
    g.fillRect(0, 0, SW, SH);
    worldT();
    // sun
    const sp = P(1.5, 1.6, 60);
    g.fillStyle = 'rgba(255,240,180,0.95)';
    g.beginPath();
    g.arc(sp[0], sp[1], F * 0.06, 0, TAU);
    g.fill();
    // skyline
    for (let i = -14; i < 14; i++) {
      const w = 1.2 + hash(i * 3.3) * 1.6, h = 2 + hash(i * 1.7) * 7;
      const x = i * 2.2 + hash(i) * 0.6;
      poly3([[x, -2, 28], [x + w, -2, 28], [x + w, h, 28], [x, h, 28]], i % 2 ? '#4a3a78' : '#3d3168');
      for (let wy = 0.2; wy < h - 0.4; wy += 0.9)
        for (let wx = 0.2; wx < w - 0.3; wx += 0.5) if (hash(i * 31 + wy * 7 + wx * 13) < 0.35) poly3([[x + wx, wy, 27.9], [x + wx + 0.22, wy, 27.9], [x + wx + 0.22, wy + 0.4, 27.9], [x + wx, wy + 0.4, 27.9]], 'rgba(255,214,120,0.8)');
    }
  } else {
    poly3([[-RW, RH, N], [RW, RH, N], [RW, RH, RD], [-RW, RH, RD]], css(pal.ceil));
    // ceiling lights
    for (const z of [0.8, 3.6, 6.4, 9.2]) {
      poly3([[-0.55, RH - 0.002, z], [0.55, RH - 0.002, z], [0.55, RH - 0.002, z + 1], [-0.55, RH - 0.002, z + 1]], css(pal.light), 'rgba(29,35,64,0.25)', 1);
    }
    const sw = css(shade(pal.wall, 0.88));
    poly3([[-RW, 0, N], [-RW, 0, RD], [-RW, RH, RD], [-RW, RH, N]], sw);
    poly3([[RW, 0, N], [RW, 0, RD], [RW, RH, RD], [RW, RH, N]], sw);
    poly3([[-RW, 0, RD], [RW, 0, RD], [RW, RH, RD], [-RW, RH, RD]], css(pal.wall));
    for (const s of [-1, 1]) {
      line3([s * RW, 0, RD], [s * RW, RH, RD], ink, 1.5);
      line3([s * RW, RH, N + 0.5], [s * RW, RH, RD], ink, 1.5);
    }
    line3([-RW, RH, RD], [RW, RH, RD], ink, 1.5);
    drawBackWall(Z);
    drawSideWalls(Z);
  }
  // floor
  poly3([[-RW - 0.01, 0, N], [RW + 0.01, 0, N], [RW + 0.01, 0, RD], [-RW - 0.01, 0, RD]], css(pal.floor));
  const fl2 = css(pal.floor2);
  if (Z.fl === 'tiles') {
    for (let x = -RW + 0.6; x < RW; x += 0.6) line3([x, 0, N], [x, 0, RD], fl2, 1.4);
    for (let z = 0; z < RD; z += 0.6) line3([-RW, 0, z], [RW, 0, z], fl2, 1.4);
  } else if (Z.fl === 'planks') {
    for (let x = -RW + 0.25; x < RW; x += 0.25) line3([x, 0, N], [x, 0, RD], fl2, 1.2);
    for (let z = 0; z < RD; z += 1.2) for (let x = -RW, j = 0; x < RW; x += 0.25, j++) line3([x, 0, z + (j % 3) * 0.4], [x + 0.25, 0, z + (j % 3) * 0.4], fl2, 1);
  } else if (Z.fl === 'rug') {
    poly3([[-1.6, 0.002, 0.2], [1.6, 0.002, 0.2], [1.6, 0.002, RD - 1], [-1.6, 0.002, RD - 1]], null, css(pal.glow, 0.7), 2.5);
    poly3([[-1.45, 0.002, 0.35], [1.45, 0.002, 0.35], [1.45, 0.002, RD - 1.15], [-1.45, 0.002, RD - 1.15]], null, css(pal.glow, 0.45), 1.5);
  } else if (Z.fl === 'roof') {
    for (let z = 0; z < RD; z += 1.5) line3([-RW, 0, z], [RW, 0, z], fl2, 2);
    for (let x = -RW + 1.2; x < RW; x += 1.2) line3([x, 0, N], [x, 0, RD], fl2, 1.2);
  }
  if (!Z.roof) {
    // skirting
    for (const s of [-1, 1]) poly3([[s * RW, 0, N], [s * RW, 0, RD], [s * RW, 0.08, RD], [s * RW, 0.08, N]], css(shade(pal.wall, 0.7)));
    poly3([[-RW, 0, RD], [RW, 0, RD], [RW, 0.08, RD], [-RW, 0.08, RD]], css(shade(pal.wall, 0.75)));
  } else {
    // parapets
    box(-RW, RW, 0, 0.55, RD, RD + 0.25, hexRgb('#9aa0b8'));
    box(-RW - 0.25, -RW, 0, 0.55, N, RD + 0.25, hexRgb('#9aa0b8'));
    box(RW, RW + 0.25, 0, 0.55, N, RD + 0.25, hexRgb('#9aa0b8'));
  }
}

function drawBackWall(Z) {
  const z = RD - 0.002;
  const lw = lwAt(RD);
  // window
  if (Z.win !== 'none') {
    const x0 = 1.05, x1 = 2.05, y0 = 0.95, y1 = 2.05;
    poly3([[x0 - 0.06, y0 - 0.06, z], [x1 + 0.06, y0 - 0.06, z], [x1 + 0.06, y1 + 0.06, z], [x0 - 0.06, y1 + 0.06, z]], '#ffffff', INK, lw);
    if (path3([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]])) {
      const a = P(0, y1, z)[1], b = P(0, y0, z)[1];
      const gr = g.createLinearGradient(0, a, 0, b);
      const top = Z.win === 'day' ? '#6cc4ff' : Z.win === 'dusk' ? '#ff7e6b' : '#0b1030';
      const bot = Z.win === 'day' ? '#d8f1ff' : Z.win === 'dusk' ? '#ffd27a' : '#2a2f6a';
      gr.addColorStop(0, top);
      gr.addColorStop(1, bot);
      g.fillStyle = gr;
      g.fill();
      g.save();
      g.clip();
      if (Z.win === 'day') {
        const cx = x0 + ((tReal * 0.05) % 1.4) - 0.2;
        g.fillStyle = 'rgba(255,255,255,0.9)';
        for (const [dx, dy, rr2] of [[0, 1.75, 0.09], [0.1, 1.78, 0.12], [0.22, 1.74, 0.08]]) {
          const p = P(cx + dx, dy, z), q = P(cx + dx + rr2, dy, z);
          g.beginPath();
          g.arc(p[0], p[1], Math.abs(q[0] - p[0]), 0, TAU);
          g.fill();
        }
      }
      for (let i = 0; i < 6; i++) {
        const bx = x0 + i * 0.17 + hash(i) * 0.05, bh = 0.25 + hash(i * 3.1) * 0.45;
        poly3([[bx, y0, z], [bx + 0.15, y0, z], [bx + 0.15, y0 + bh, z], [bx, y0 + bh, z]], Z.win === 'day' ? 'rgba(120,150,190,0.55)' : 'rgba(30,25,70,0.85)');
        if (Z.win !== 'day') for (let k = 0; k < 4; k++) if (hash(i * 9 + k) < 0.5) poly3([[bx + 0.03, y0 + 0.05 + k * 0.08, z], [bx + 0.07, y0 + 0.05 + k * 0.08, z], [bx + 0.07, y0 + 0.09 + k * 0.08, z], [bx + 0.03, y0 + 0.09 + k * 0.08, z]], 'rgba(255,220,130,0.9)');
      }
      if (Z.win === 'night') {
        const p = P(x0 + 0.75, 1.82, z);
        g.fillStyle = '#fff6cf';
        g.beginPath();
        g.arc(p[0], p[1], (F * 0.07) / p[2], 0, TAU);
        g.fill();
      }
      g.restore();
    }
    line3([(x0 + x1) / 2, y0, z], [(x0 + x1) / 2, y1, z], '#ffffff', Math.max(1.5, lw * 1.6));
    line3([x0, (y0 + y1) / 2, z], [x1, (y0 + y1) / 2, z], '#ffffff', Math.max(1.5, lw * 1.6));
  }
  // board
  if (Z.board === 'white' || Z.board === 'chalk') {
    const chalk = Z.board === 'chalk';
    poly3([[-0.95, 0.9, z], [0.75, 0.9, z], [0.75, 1.9, z], [-0.95, 1.9, z]], chalk ? '#8a5a34' : '#b7c0d4', INK, lw);
    poly3([[-0.9, 0.95, z], [0.7, 0.95, z], [0.7, 1.85, z], [-0.9, 1.85, z]], chalk ? '#2f6b4a' : '#ffffff');
    const ink2 = chalk ? 'rgba(255,255,255,0.85)' : Z.dark ? '#3b82f6' : '#3b82f6';
    // doodle: a bin, an arc and an arrow
    const bl = Math.max(1.2, lw * 1.1);
    line3([0.25, 1.05, z], [0.33, 1.3, z], ink2, bl);
    line3([0.5, 1.05, z], [0.42, 1.3, z], ink2, bl);
    line3([0.25, 1.05, z], [0.5, 1.05, z], ink2, bl);
    line3([0.3, 1.3, z], [0.45, 1.3, z], ink2, bl);
    let prev = null;
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const p = [lerp(-0.7, 0.37, u), 1.25 + Math.sin(u * Math.PI) * 0.45 + (1 - u) * 0.05, z];
      if (prev && i % 2 === 1) line3(prev, p, chalk ? 'rgba(255,255,255,0.8)' : '#ff5d5d', bl);
      prev = p;
    }
    for (let k = 0; k < 3; k++) line3([-0.8, 1.72 - k * 0.1, z], [-0.8 + 0.28 + hash(k) * 0.25, 1.72 - k * 0.1, z], chalk ? 'rgba(255,255,255,0.6)' : 'rgba(29,35,64,0.5)', bl);
  } else if (Z.board === 'paint') {
    poly3([[-1.0, 0.95, z], [0.7, 0.95, z], [0.7, 1.95, z], [-1.0, 1.95, z]], '#d6b06a', INK, lw);
    poly3([[-0.92, 1.03, z], [0.62, 1.03, z], [0.62, 1.87, z], [-0.92, 1.87, z]], '#7fb6d9');
    poly3([[-0.92, 1.03, z], [-0.4, 1.5, z], [-0.05, 1.2, z], [0.3, 1.6, z], [0.62, 1.25, z], [0.62, 1.03, z]], '#4f7a4a');
    const p = P(0.3, 1.72, z);
    g.fillStyle = '#ffe08a';
    g.beginPath();
    g.arc(p[0], p[1], (F * 0.06) / p[2], 0, TAU);
    g.fill();
  }
  // clock
  {
    const p = P(-1.6, 1.95, z);
    const rad = (F * 0.17) / p[2];
    g.fillStyle = '#ffffff';
    g.strokeStyle = INK;
    g.lineWidth = lw * 1.2;
    g.beginPath();
    g.arc(p[0], p[1], rad, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.cos(tReal * 0.4 - 1.2) * rad * 0.5, p[1] + Math.sin(tReal * 0.4 - 1.2) * rad * 0.5);
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.cos(tReal * 4) * rad * 0.8, p[1] + Math.sin(tReal * 4) * rad * 0.8);
    g.stroke();
  }
  // door
  poly3([[-2.25, 0, z], [-1.6, 0, z], [-1.6, 1.55, z], [-2.25, 1.55, z]], css(shade(pal.wall, 0.7)), INK, lw);
  const dk = P(-1.7, 0.8, z);
  g.fillStyle = css(pal.glow);
  g.beginPath();
  g.arc(dk[0], dk[1], Math.max(1.5, (F * 0.03) / dk[2]), 0, TAU);
  g.fill();
}

function drawSideWalls(Z) {
  for (const s of [-1, 1]) {
    const x = s * (RW - 0.002);
    for (const z0 of [2.7, 5.4, 8.0]) {
      if (s > 0) {
        // windows on the right wall
        const z1 = z0 + 1.2;
        poly3([[x, 1.0, z0], [x, 1.0, z1], [x, 2.05, z1], [x, 2.05, z0]], '#ffffff', 'rgba(29,35,64,0.55)', lwAt(z0));
        const top = Z.win === 'day' ? '#8fd2ff' : Z.win === 'dusk' ? '#ffa06b' : '#151c48';
        poly3([[x, 1.06, z0 + 0.06], [x, 1.06, z1 - 0.06], [x, 1.99, z1 - 0.06], [x, 1.99, z0 + 0.06]], top);
        line3([x, 1.06, (z0 + z1) / 2], [x, 1.99, (z0 + z1) / 2], '#ffffff', lwAt(z0) * 1.5);
      } else {
        // posters on the left wall
        const z1 = z0 + 0.7;
        const c = hexRgb(['#ff5d8f', '#3b82f6', '#ffd23f'][Math.round(z0) % 3]);
        poly3([[x, 1.05, z0], [x, 1.05, z1], [x, 1.85, z1], [x, 1.85, z0]], css(c), 'rgba(29,35,64,0.55)', lwAt(z0));
        poly3([[x, 1.3, z0 + 0.2], [x, 1.3, z1 - 0.2], [x, 1.6, z1 - 0.2], [x, 1.6, z0 + 0.2]], 'rgba(255,255,255,0.75)');
      }
    }
  }
}

// ---------- furniture, fans, bin, ball
function furniture(r) {
  const Z = ZONES[zoneNow];
  const list = [];
  const desk = pal.desk, ped = pal.ped;
  for (const s of [-1, 1]) {
    for (const zc of [1.0, 3.9, 6.6, 9.3]) {
      if (Z.roof) {
        // rooftop: AC units and crates
        list.push({
          z: zc,
          draw: () => {
            const xi = s * (RW - 0.75), xo = s * (RW - 0.05);
            box(Math.min(xi, xo), Math.max(xi, xo), 0, 0.7, zc - 0.4, zc + 0.4, hexRgb('#c3c8da'));
            const p = P(s * (RW - 0.4), 0.38, zc - 0.4);
            g.strokeStyle = 'rgba(29,35,64,0.6)';
            g.lineWidth = lwAt(zc);
            g.beginPath();
            g.arc(p[0], p[1], (F * 0.22) / p[2], 0, TAU);
            g.stroke();
          },
        });
        continue;
      }
      list.push({ z: zc, draw: () => drawDesk(s, zc, desk, ped, Z) });
    }
    // fan (indoors) or flag (roof)
    list.push({ z: FANZ, draw: () => (Z.roof ? drawFlag(r, s) : drawFan(r, s)) });
  }
  // plants in the far corners
  if (!Z.roof)
    for (const s of [-1, 1])
      list.push({
        z: RD - 0.35,
        draw: () => {
          const x = s * (RW - 0.35);
          box(x - 0.18, x + 0.18, 0, 0.4, RD - 0.53, RD - 0.17, hexRgb('#c96f4a'));
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            const p = P(x + Math.cos(a) * 0.16, 0.6 + Math.sin(i * 2.1) * 0.12 + 0.1, RD - 0.35);
            g.fillStyle = i % 2 ? '#3fae6a' : '#2f8f57';
            g.beginPath();
            g.arc(p[0], p[1], (F * 0.15) / p[2], 0, TAU);
            g.fill();
          }
        },
      });
  return list;
}

function drawDesk(s, zc, desk, ped, Z) {
  const xo = s * RW, xi = s * (RW - 0.8);
  const x0 = Math.min(xo, xi), x1 = Math.max(xo, xi);
  const z0 = zc - 0.42, z1 = zc + 0.42;
  // pedestal against the wall, a leg at the aisle
  const px0 = s > 0 ? RW - 0.42 : -RW, px1 = s > 0 ? RW : -RW + 0.42;
  box(px0, px1, 0, 0.72, z0 + 0.03, z1 - 0.03, ped);
  const lx = s > 0 ? x0 + 0.04 : x1 - 0.09;
  box(lx, lx + 0.05, 0, 0.72, z0 + 0.05, z0 + 0.1, shade(desk, 0.75));
  box(lx, lx + 0.05, 0, 0.72, z1 - 0.1, z1 - 0.05, shade(desk, 0.75));
  // drawer lines
  const dpx = s > 0 ? px0 : px1;
  for (const y of [0.24, 0.48]) line3([dpx, y, z0 + 0.05], [dpx, y, z1 - 0.05], 'rgba(29,35,64,0.35)', lwAt(zc));
  box(x0, x1, 0.72, 0.78, z0, z1, desk);
  // monitor facing the aisle
  const mx = s * (RW - 0.42);
  const screen = Z.dark ? css(pal.accent) : '#2b3150';
  box(mx - 0.03, mx + 0.03, 0.78, 0.86, zc - 0.06, zc + 0.06, hexRgb('#2b3150'));
  box(mx - 0.025, mx + 0.025, 0.86, 1.22, zc - 0.3, zc + 0.3, hexRgb('#2b3150'), s > 0 ? { left: screen } : { right: screen });
  if (Z.dark) {
    // screen glow
    const p = P(mx, 1.04, zc);
    const rad = (F * 0.6) / p[2];
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad);
    gr.addColorStop(0, css(pal.accent, 0.22));
    gr.addColorStop(1, css(pal.accent, 0));
    g.fillStyle = gr;
    g.fillRect(p[0] - rad, p[1] - rad, rad * 2, rad * 2);
  } else {
    const fx = s > 0 ? mx - 0.026 : mx + 0.026;
    poly3([[fx, 0.92, zc - 0.24], [fx, 0.92, zc + 0.24], [fx, 1.16, zc + 0.24], [fx, 1.16, zc - 0.24]], css(shade(pal.wall, 1.0), 0.35));
  }
  // mug
  const ux = s * (RW - 0.66);
  box(ux - 0.04, ux + 0.04, 0.78, 0.88, zc + 0.15, zc + 0.23, pal.accent);
}

const FANX = 1.3, FANZ = 6.4;
// a disc facing direction (fx, 0, fz) on the floor plane
function discF(c, r, fx, fz, n = 22, a0 = 0, a1 = TAU) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([c[0] + Math.cos(a) * r * fz, c[1] + Math.sin(a) * r, c[2] - Math.cos(a) * r * fx]);
  }
  return pts;
}
// A pedestal fan at the side of the room, turned toward you, blowing across the throw
function drawFan(r, s) {
  const W = windNow(r);
  const on = W !== 0 && (W > 0 ? s < 0 : s > 0);
  const x = s * FANX, z = FANZ, yc = 1.05, rad = 0.3;
  const fx = -s * 0.74, fz = -0.67; // facing the aisle and a little toward you
  const lw = lwAt(z);
  poly3(discY(x, 0.004, z, 0.22, 16), '#2b3150', INK, lw);
  line3([x, 0, z], [x, yc, z], '#2b3150', Math.max(2, lw * 3.2));
  const back = [x - fx * 0.08, yc, z - fz * 0.08];
  poly3(discF(back, rad * 0.5, fx, fz, 14), '#3d4570', INK, lw);
  const c = [x + fx * 0.02, yc, z + fz * 0.02];
  poly3(discF(c, rad + 0.03, fx, fz), '#e9edf6', INK, lw * 1.2);
  poly3(discF(c, rad, fx, fz), on ? 'rgba(124,243,255,0.35)' : 'rgba(43,49,80,0.25)');
  const rot = r.fanRot[s < 0 ? 0 : 1];
  for (let k = 0; k < 3; k++) {
    const a = rot * s + (k * TAU) / 3;
    const pts = discF(c, rad * 0.88, fx, fz, 8, a - 0.4, a + 0.4);
    pts.push(c);
    poly3(pts, css(pal.accent), 'rgba(29,35,64,0.6)', lw * 0.8);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    line3(c, [c[0] + Math.cos(a) * rad * fz, c[1] + Math.sin(a) * rad, c[2] - Math.cos(a) * rad * fx], 'rgba(29,35,64,0.35)', lw * 0.6);
  }
  poly3(discF(c, 0.05, fx, fz, 10), '#2b3150');
}

function drawFlag(r, s) {
  if (s > 0) return; // one pole on the roof
  const W = windNow(r);
  const x = -1.9, z = 2.45;
  line3([x, 0, z], [x, 2.3, z], '#e6e9f2', lwAt(z) * 2.2);
  const len = 0.55, k = clamp(Math.abs(W) / 5, 0.1, 1);
  const dir = W >= 0 ? 1 : -1;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const wave = Math.sin(tReal * (6 + Math.abs(W)) - u * 5) * 0.05 * u;
    const ang = lerp(-1.45, 0, k);
    pts.push([x + dir * Math.cos(ang) * len * u, 2.25 + Math.sin(ang) * len * u + wave, z + wave]);
  }
  for (let i = 8; i >= 0; i--) {
    const u = i / 8;
    const wave = Math.sin(tReal * (6 + Math.abs(W)) - u * 5) * 0.05 * u;
    const ang = lerp(-1.45, 0, k);
    pts.push([x + dir * Math.cos(ang) * len * u + Math.sin(ang) * 0.3 * 0, 2.25 - 0.3 + Math.sin(ang) * len * u + wave, z + wave]);
  }
  poly3(pts, css(pal.accent), INK, lwAt(z));
}

function skin(r) {
  return PAPERS.find(s => s.id === skinId) || PAPERS[0];
}
const JAG = Array.from({ length: 13 }, (_, i) => 0.86 + hash(i * 3.7) * 0.14);
function drawBall(x, y, z, rot, sk, sc = 1, opts = {}) {
  const p = P(x, y, z);
  if (p[2] < NEAR * 2) return;
  const rad = ((BR * F) / p[2]) * sc;
  if (rad < 0.5) return;
  const n = JAG.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    pts.push([p[0] + Math.cos(a) * rad * JAG[i], p[1] + Math.sin(a) * rad * JAG[i]]);
  }
  if (sk.glow || opts.fire) {
    g.shadowColor = opts.fire ? '#ff8a3d' : sk.glow;
    g.shadowBlur = rad * 0.9;
  }
  const blob = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (i === 0) blob.moveTo(m[0], m[1]);
    else blob.quadraticCurveTo(a[0], a[1], m[0], m[1]);
  }
  blob.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  blob.closePath();
  if (sk.id === 'cosmic') {
    const gr = g.createLinearGradient(p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad);
    gr.addColorStop(0, '#ff5df0');
    gr.addColorStop(0.5, '#5b2dbf');
    gr.addColorStop(1, '#1b8cff');
    g.fillStyle = gr;
  } else g.fillStyle = sk.base;
  g.fill(blob);
  g.shadowBlur = 0;
  g.save();
  g.clip(blob);
  // print on the paper
  g.strokeStyle = sk.line;
  g.lineWidth = Math.max(0.8, rad * 0.09);
  g.translate(p[0], p[1]);
  g.rotate(rot * 0.7 + 0.4);
  if (sk.lines === 'ruled') {
    for (let k = -3; k <= 3; k++) {
      g.beginPath();
      g.moveTo(-rad, k * rad * 0.3 + Math.sin(k) * rad * 0.1);
      g.lineTo(rad, k * rad * 0.3 - Math.sin(k) * rad * 0.1);
      g.stroke();
    }
    g.strokeStyle = '#ff7b7b';
    g.beginPath();
    g.moveTo(-rad * 0.4, -rad);
    g.lineTo(-rad * 0.3, rad);
    g.stroke();
  } else if (sk.lines === 'print') {
    g.fillStyle = sk.line;
    for (let k = -3; k <= 3; k++) for (let j = -2; j <= 2; j++) if (hash(k * 5 + j) > 0.35) g.fillRect(j * rad * 0.42 - rad * 0.15, k * rad * 0.26, rad * 0.3, rad * 0.08);
  } else if (sk.lines === 'map') {
    g.fillStyle = 'rgba(79,163,107,0.6)';
    g.beginPath();
    g.arc(-rad * 0.3, -rad * 0.2, rad * 0.45, 0, TAU);
    g.fill();
    g.strokeStyle = '#4f8fd6';
    g.beginPath();
    g.moveTo(-rad, rad * 0.5);
    g.quadraticCurveTo(0, -rad * 0.1, rad, rad * 0.4);
    g.stroke();
    g.strokeStyle = '#e04a4a';
    g.setLineDash([rad * 0.12, rad * 0.1]);
    g.beginPath();
    g.moveTo(-rad * 0.6, -rad * 0.7);
    g.lineTo(rad * 0.5, rad * 0.1);
    g.stroke();
    g.setLineDash([]);
  } else if (sk.lines === 'stars') {
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 7; k++) {
      const sx = (hash(k * 2.3) - 0.5) * rad * 1.8, sy = (hash(k * 7.1) - 0.5) * rad * 1.8;
      g.beginPath();
      g.arc(sx, sy, rad * (0.04 + hash(k) * 0.05), 0, TAU);
      g.fill();
    }
  }
  // creases
  g.strokeStyle = sk.id === 'cosmic' ? 'rgba(255,255,255,0.35)' : 'rgba(29,35,64,0.28)';
  g.lineWidth = Math.max(0.7, rad * 0.07);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.9 + 0.3;
    g.beginPath();
    g.moveTo(Math.cos(a) * rad * 0.15, Math.sin(a) * rad * 0.15);
    g.lineTo(Math.cos(a + 0.3) * rad * 0.55, Math.sin(a + 0.3) * rad * 0.55);
    g.lineTo(Math.cos(a - 0.1) * rad * 0.9, Math.sin(a - 0.1) * rad * 0.9);
    g.stroke();
  }
  g.restore();
  // light from the ceiling
  const hl = g.createRadialGradient(p[0] - rad * 0.35, p[1] - rad * 0.4, 0, p[0], p[1], rad * 1.05);
  hl.addColorStop(0, 'rgba(255,255,255,0.35)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0)');
  hl.addColorStop(1, 'rgba(29,35,64,0.28)');
  g.fillStyle = hl;
  g.fill(blob);
  g.lineWidth = Math.max(1, rad * 0.1);
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke(blob);
  if (opts.gold) {
    // bonus ball: a coin sticker and sparkles
    g.fillStyle = '#ffd650';
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1, rad * 0.08);
    g.beginPath();
    g.moveTo(p[0], p[1] - rad * 0.42);
    g.lineTo(p[0] + rad * 0.32, p[1]);
    g.lineTo(p[0], p[1] + rad * 0.42);
    g.lineTo(p[0] - rad * 0.32, p[1]);
    g.closePath();
    g.fill();
    g.stroke();
    for (let k = 0; k < 3; k++) {
      const a = tReal * 2 + (k * TAU) / 3;
      const sx = p[0] + Math.cos(a) * rad * 1.35, sy = p[1] + Math.sin(a) * rad * 1.35;
      const s2 = rad * 0.18 * (0.6 + 0.4 * Math.sin(tReal * 9 + k));
      g.fillStyle = '#fff3a8';
      g.beginPath();
      g.moveTo(sx, sy - s2 * 2);
      g.lineTo(sx + s2 * 0.6, sy);
      g.lineTo(sx, sy + s2 * 2);
      g.lineTo(sx - s2 * 0.6, sy);
      g.closePath();
      g.fill();
    }
  }
}

function drawBallShadow(b) {
  if (b.y > 2.6) return;
  const k = clamp(1 - (b.y - BR) / 2.2, 0.15, 1);
  const pts = discY(b.x, 0.003, b.z, BR * (1.1 + (1 - k) * 0.6), 14);
  poly3(pts, `rgba(0,0,0,${0.28 * k})`);
}

function drawBin(r, bx, bz, inside) {
  const N = 32;
  const base = r.bin.mover ? 0.05 : 0;
  const lw = lwAt(bz);
  // shadow
  poly3(discY(bx + 0.03, 0.002, bz + 0.03, R * 1.18, 20), 'rgba(0,0,0,0.25)');
  if (r.bin.mover) {
    // robot vacuum under the bin
    poly3(discY(bx, 0.002, bz, R * 1.45, 24), '#2b3150', INK, lw);
    poly3(discY(bx, base, bz, R * 1.45, 24), '#3d4570', INK, lw);
    const lp = P(bx, base, bz - R * 1.3);
    g.fillStyle = (tReal * 2) % 1 < 0.5 ? '#7dff9b' : '#2a8f4a';
    g.beginPath();
    g.arc(lp[0], lp[1], Math.max(1.5, (F * 0.02) / lp[2]), 0, TAU);
    g.fill();
  }
  const rim = [], bot = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    rim.push([bx + Math.cos(a) * R, H, bz + Math.sin(a) * R]);
    bot.push([bx + Math.cos(a) * RB, base, bz + Math.sin(a) * RB]);
  }
  // inside: back wall and floor of the bin
  poly3(rim, '#141a33');
  const backW = [...rim.slice(0, N / 2 + 1), ...bot.slice(0, N / 2 + 1).reverse()];
  poly3(backW, '#2b3356');
  for (let i = 1; i < N / 2; i += 2) line3(rim[i], bot[i], 'rgba(160,175,215,0.35)', lw * 0.7);
  poly3(discY(bx, base + 0.004, bz, RB * 0.98, 20), '#1d2445');
  // paper already in there
  const sk = skin(r);
  r.pile.forEach((p, i) => drawBall(bx + p.ox * 0.7, base + BR + Math.floor(i / 3) * 0.012, bz + p.oz * 0.7, p.rot, sk, 0.95, { gold: false }));
  if (inside) inside();
  // front of the bin: wire mesh
  const front = [...rim.slice(N / 2), rim[0], bot[0], ...bot.slice(N / 2).reverse()];
  poly3(front, 'rgba(58,66,102,0.93)');
  for (let i = N / 2 + 1; i < N; i += 1) line3(rim[i], bot[i], 'rgba(170,185,225,0.55)', lw * 0.7);
  for (const f of [0.33, 0.66]) {
    for (let i = N / 2; i < N; i++) {
      const a = (i / N) * TAU, b2 = ((i + 1) / N) * TAU;
      const rr2 = lerp(RB, R, f), yy = lerp(base, H, f);
      line3([bx + Math.cos(a) * rr2, yy, bz + Math.sin(a) * rr2], [bx + Math.cos(b2) * rr2, yy, bz + Math.sin(b2) * rr2], 'rgba(170,185,225,0.55)', lw * 0.7);
    }
  }
  poly3(front, null, INK, lw);
  // rim
  const fire = r.streak >= FIRE_AT;
  const s = clipPoly(rim);
  g.beginPath();
  s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  const rw = Math.max(2, (F * 0.022) / vw([bx, H, bz])[2]);
  g.lineWidth = rw + lw * 2;
  g.strokeStyle = INK;
  g.stroke();
  if (fire) {
    g.shadowColor = '#ff8a3d';
    g.shadowBlur = 12 * U * (0.6 + pulse * 0.6);
  }
  g.lineWidth = rw;
  g.strokeStyle = fire ? '#ffb347' : '#e7ecf6';
  g.stroke();
  g.shadowBlur = 0;
}

function ballInBin(r) {
  return r.state === 'in' || (r.state === 'rim' && Math.sin(r.rim.psi) > 0);
}

function drawScene(r) {
  const b = r.ball;
  const sk = skin(r);
  const bx = binX(r, r.t), bz = binZ(r);
  const items = furniture(r);
  const fire = r.streak >= FIRE_AT;
  const showBall = r.state !== 'next' || b.s > 0.01;
  const ballDraw = () => drawBall(r.state === 'in' ? bx + b.ox : b.x, b.y, r.state === 'in' ? bz + b.oz : b.z, b.rot, sk, b.s || 1, { fire: fire && r.state !== 'in', gold: r.gold });
  const inBin = ballInBin(r);
  items.push({ z: bz, draw: () => drawBin(r, bx, bz, inBin ? ballDraw : null) });
  if (showBall && !inBin && (r.state === 'fly' || r.state === 'miss' || r.state === 'rim')) items.push({ z: b.z - 0.001, draw: ballDraw });
  // wind wisps
  drawWisps(r);
  if (showBall && r.state !== 'in' && r.state !== 'ready' && r.state !== 'next') drawBallShadow(b);
  items.sort((a, c) => c.z - a.z);
  for (const it of items) it.draw();
  drawParts(r);
  // the ball in your hand
  if (showBall && (r.state === 'ready' || r.state === 'next')) {
    if (r.state === 'ready' && kbUsed && !r.bot && mode === 'play') drawAimNeedle(r);
    ballDraw();
    if (fire) flame(r, { x: b.x, y: b.y + BR * 0.6, z: b.z }, 1);
  }
}

function drawWisps(r) {
  for (const w of r.wisps) {
    const a = Math.min(1, w.life * 3) * Math.min(1, (RW - 0.2 - Math.abs(w.x)) * 2);
    const len = 0.22 + Math.abs(windNow(r)) * 0.05;
    line3([w.x, w.y, w.z], [w.x - w.s * len, w.y, w.z], `rgba(255,255,255,${0.45 * a})`, Math.max(1, lwAt(w.z) * 1.2));
  }
}

function drawAimNeedle(r) {
  const a = aimRows(r);
  const len = 70 * U;
  g.save();
  g.setLineDash([6 * U, 6 * U]);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 4 * U;
  g.beginPath();
  g.moveTo(a.bx, a.by - 40 * U);
  g.lineTo(a.bx + Math.sin(kbAim) * len, a.by - 40 * U - Math.cos(kbAim) * len);
  g.stroke();
  g.restore();
}

function drawParts(r) {
  for (const p of r.parts) {
    const k = p.life / p.max;
    if (p.kind === 'ring') {
      const pts = discY(p.x, H, p.z, R * (1 + (1 - k) * 1.3), 24);
      poly3(pts, null, css(p.col, k), 4 * k * U);
      continue;
    }
    const s = P(p.x, p.y, p.z);
    if (s[2] < NEAR * 2) continue;
    if (p.kind === 'paper') {
      const sz = (F * 0.035) / s[2];
      g.save();
      g.translate(s[0], s[1]);
      g.rotate(p.rot);
      g.fillStyle = css(p.col, Math.min(1, k * 2));
      g.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6 * Math.abs(Math.cos(p.rot * 1.3)) + 1);
      g.restore();
    } else if (p.kind === 'flame') {
      const sz = ((F * 0.05) / s[2]) * (0.4 + k);
      g.fillStyle = k > 0.6 ? `rgba(255,236,140,${k})` : `rgba(255,${(120 + k * 160) | 0},40,${k})`;
      g.beginPath();
      g.arc(s[0], s[1], sz, 0, TAU);
      g.fill();
    } else if (p.kind === 'gem') {
      const sz = Math.max(4 * U, (F * 0.035) / s[2]);
      g.globalAlpha = Math.min(1, k * 2);
      drawGem(s[0], s[1], sz);
      g.globalAlpha = 1;
    }
  }
}

function drawTrail(r) {
  if (trail.length < 2) return;
  g.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const k = 1 - b.a / 0.28;
    g.strokeStyle = `rgba(255,255,255,${0.75 * k})`;
    g.lineWidth = (4 + 10 * (i / trail.length)) * U * k;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  g.lineCap = 'butt';
  // the bot's fingertip
  if (r.botSw && (!r.attract || mode === 'title')) {
    const t = trail[trail.length - 1];
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.strokeStyle = INK;
    g.lineWidth = 3 * U;
    g.beginPath();
    g.arc(t.x, t.y, 13 * U, 0, TAU);
    g.fill();
    g.stroke();
  }
}

function drawVignette(r) {
  const fire = r && r.streak >= FIRE_AT && mode !== 'title';
  const gr = g.createRadialGradient(SW / 2, SH * 0.55, Math.min(SW, SH) * 0.35, SW / 2, SH * 0.55, Math.max(SW, SH) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, fire ? `rgba(255,110,30,${0.35 + pulse * 0.15})` : ZONES[zoneNow].dark ? 'rgba(5,8,25,0.55)' : 'rgba(10,14,40,0.32)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
}

// ---------- UI text
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
  const top = (REC ? 300 : 0) + 150 * U;
  for (const p of r.pops) {
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const s = toScreen(P(p.w[0], p.w[1], p.w[2]));
    const x = clamp(s[0], 110 * U, SW - 110 * U);
    const y = Math.max(top, s[1] - (p.small ? 0 : 10 + ease(k) * 34) * U);
    g.globalAlpha = a;
    if (p.text) text(p.text, x, y, (p.small ? 24 : 34) * U * sc, css(p.col), 'center', { stroke: 8 * U * Math.max(0.6, sc) });
    if (p.sub) text(p.sub, x, y + (p.text ? 32 : 0) * U * sc, 20 * U * Math.min(1.2, sc), '#ffd650', 'center', { stroke: 6 * U });
    g.globalAlpha = 1;
  }
}

function drawWind(r, x, y) {
  const W = windNow(r);
  const w = 168 * U, h = 40 * U;
  g.fillStyle = 'rgba(29,35,64,0.62)';
  rr(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  if (W === 0) {
    text('NO WIND', x, y + 1, 18 * U, 'rgba(255,255,255,0.8)');
    return;
  }
  const s = Math.sign(W);
  const strong = Math.abs(W) >= 4;
  text('WIND', x - 48 * U, y + 1, 15 * U, 'rgba(255,255,255,0.75)');
  text(Math.abs(W).toFixed(2), x + 34 * U, y + 1, 24 * U, strong ? '#ff9b7a' : '#ffffff', 'center', { stroke: 4 * U });
  // arrow
  const ax = x - 8 * U, al = 22 * U;
  g.strokeStyle = css(pal.glow);
  g.fillStyle = css(pal.glow);
  g.lineWidth = 4 * U;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(ax - (s * al) / 2, y);
  g.lineTo(ax + (s * al) / 2, y);
  g.stroke();
  g.beginPath();
  g.moveTo(ax + (s * al) / 2 + s * 4 * U, y);
  g.lineTo(ax + (s * al) / 2 - s * 6 * U, y - 7 * U);
  g.lineTo(ax + (s * al) / 2 - s * 6 * U, y + 7 * U);
  g.closePath();
  g.fill();
  g.lineCap = 'butt';
  if (r.wind.gust) text('GUSTY', x, y + 30 * U, 12 * U, '#ff9b7a', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 4 * U });
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  const fire = r.streak >= FIRE_AT;
  text(String(r.score), SW / 2, top + 30 * U, 58 * U * bump, '#fff', 'center', { stroke: 9 * U, glow: fire ? '#ff8a3d' : null });
  let y2 = top + 70 * U;
  if (r.streak >= 2) text(fire ? 'ON FIRE ×2  ·  ' + r.streak : 'SWISH STREAK x' + r.streak, SW / 2, y2, 17 * U, fire ? '#ffb347' : css(pal.glow), 'center', { stroke: 5 * U });
  else if (best > 0 && !REC && r.score <= best) text('BEST ' + best, SW / 2, y2, 15 * U, 'rgba(255,255,255,0.8)', 'center', { stroke: 4 * U });
  if (r.layerPop) {
    const k = r.layerPop.t / 1.5;
    g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const sc = back(r.layerPop.t / 0.25);
    text('♪ + ' + r.layerPop.name, SW / 2, y2 + 22 * U, 14 * U * sc, '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
  if (r.state !== 'rim' && !r.dead) drawWind(r, SW / 2, top + 116 * U);
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.2;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.47 : 0.36);
    g.fillStyle = 'rgba(29,35,64,0.6)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 6 * U, 38 * U * back(b.t / 0.3), b.text === 'ON FIRE!' ? '#ffb347' : '#fff', 'center', { stroke: 7 * U });
    text(b.sub, SW / 2, y + 26 * U, 13 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
    g.globalAlpha = 1;
  }
  if (r.dead) return;
  // tutorial
  const a = aimRows(r);
  const ty = SH * 0.46;
  if (r.tutorial && r.n < 2 && (r.state === 'ready' || r.state === 'next')) {
    const p = 0.5 + 0.5 * Math.sin(tReal * 6);
    text(r.n === 0 ? 'FLICK UP AT THE BIN' : 'AGAIN! FLICK IT IN', SW / 2, ty, (26 + p * 2) * U, '#fff', 'center', { stroke: 8 * U });
    if (wide() && !REC) text('mouse: drag up  ·  keys: ← → aim, SPACE toss', SW / 2, ty + 32 * U, 13 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
    if (r.state === 'ready' && r.n === 0) {
      // a finger showing the move
      const u = (tReal % 1.3) / 0.8;
      if (u <= 1) {
        const k = ease(u);
        const fx = a.bx + 4 * U, fy = a.by + 60 * U - k * 170 * U;
        g.globalAlpha = Math.min(1, (1 - u) * 3);
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 10 * U;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(fx, a.by + 60 * U);
        g.lineTo(fx, fy);
        g.stroke();
        g.lineCap = 'butt';
        g.fillStyle = '#fff';
        g.strokeStyle = INK;
        g.lineWidth = 3 * U;
        g.beginPath();
        g.arc(fx, fy, 15 * U, 0, TAU);
        g.fill();
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  } else if (r.windTipOn && r.state === 'ready') {
    const W = windNow(r);
    text('WIND!', SW / 2, ty - 20 * U, 30 * U, css(pal.glow), 'center', { stroke: 8 * U });
    text('it blows the paper ' + (W > 0 ? 'right →' : '← left') + '  so aim ' + (W > 0 ? 'left' : 'right'), SW / 2, ty + 12 * U, 14 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  }
  if (r.tapHint > 0) text('flick it UP ↑ don’t just tap', SW / 2, ty + 44 * U, 15 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 5 * U });
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
  g.fillStyle = 'rgba(29,35,64,0.45)';
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
  g.fillStyle = 'rgba(29,35,64,0.35)';
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
  g.rotate(-0.05 + wob);
  text('BIN', -44 * s, 0, 84 * s, '#fff', 'center', { stroke: 13 * s });
  text('IT!', 70 * s, 6 * s, 92 * s, ORANGE, 'center', { stroke: 13 * s });
  g.restore();
}

function drawTitle() {
  const wd = wide();
  const cx = wd ? SW * 0.24 : SW / 2;
  const y = wd ? SH * 0.3 : Math.max(SH * 0.14, 96 * U);
  drawTitleWords(cx, y, U * (wd ? 1.2 : 1.15), Math.sin(tReal * 2.2) * 0.02);
  text('the paper toss game', cx, y + 74 * U, 18 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 5 * U });
  text('…but the wind hates you', cx, y + 98 * U, 15 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  const yb = wd ? SH * 0.6 : SH * 0.42;
  text('TAP TO PLAY', cx, yb, (30 + p * 3) * U, '#fff', 'center', { stroke: 8 * U });
  if (best > 0) text('BEST ' + best, cx, yb + 34 * U, 16 * U, css(pal.glow), 'center', { stroke: 5 * U });
  pill('PAPER', cx, yb + 76 * U, 150 * U, 40 * U, '#ffffff', INK, openShop, 18);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOgTitle() {
  worldT();
  const b = run.ball;
  drawBall(b.x, b.y, b.z, b.rot, skin(run), 1);
  screenT();
  const gr = g.createLinearGradient(0, 0, SW * 0.62, 0);
  gr.addColorStop(0, 'rgba(29,35,64,0.82)');
  gr.addColorStop(1, 'rgba(29,35,64,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.25, y = SH * 0.38;
  drawTitleWords(x, y, 1.9, 0);
  text('the paper toss game', x, y + 128, 36, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 9 });
  text('…but the wind hates you · free, no download', x, y + 172, 22, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 6 });
  const u0 = U;
  U = 1.7;
  drawWind(run, SW * 0.68, 60);
  U = u0;
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(29,35,64,${0.55 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.46 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  rr(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 24 * U);
  g.fillStyle = 'rgba(255,255,255,0.97)';
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 4 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  const missWord = r.lastKind === 'out' ? 'RIM OUT!' : 'MISSED!';
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 44 * U, 38 * U * back(overT / 0.4), ORANGE, 'center', { stroke: 6 * U });
  else text(missWord, SW / 2, t0 + 44 * U, 38 * U, ORANGE, 'center', { stroke: 6 * U });
  text(String(r.score), SW / 2, t0 + 110 * U, 80 * U, INK);
  let sub;
  if (REC) sub = 'can you beat ' + r.score + '?';
  else if (r.n === 0) sub = 'flick up toward the bin, mind the wind';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 6) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = r.n + ' binned · ' + r.perfects + ' perfect · best streak ' + r.maxStreak;
  text(sub, SW / 2, t0 + 160 * U, 15 * U, '#5a62a0', 'center', { font: 'system-ui, sans-serif', weight: '800' });
  if (REC) {
    text('BIN IT', SW / 2, t0 - 44 * U, 48 * U, '#fff', 'center', { stroke: 10 * U });
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, INK, 'center', { font: 'system-ui, sans-serif', weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 240 * U, 18 * U, ORANGE, 'center', { font: 'system-ui, sans-serif', weight: '900' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 192 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 194 * U, 19 * U, '#e0a800', 'left');
    pill('RETRY', SW / 2, t0 + 246 * U, cw - 60 * U, 54 * U, ORANGE, '#fff', startGame, 30);
    pill('SHARE', SW / 2 - 75 * U, t0 + 302 * U, 130 * U, 36 * U, '#fff1e6', INK, share, 18);
    pill('PAPER', SW / 2 + 75 * U, t0 + 302 * U, 130 * U, 36 * U, '#fff1e6', INK, openShop, 18);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, cy + ch / 2 + 28 * U, 13 * U, 'rgba(255,255,255,0.9)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');
const cap2On = r => REC && rec && !!Q.get('cap2') && rec.crashAt != null && r.n === rec.crashAt && (r.state === 'fly' || r.state === 'rim' || (r.state === 'ready' && r.botSw));

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
  if (cap2 && cap2On(r)) text(cap2, SW / 2, 360, 76, '#fff', 'center', { stroke: 18 });
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
  const txt = `I scored ${r.score} on BIN IT 🗑️ paper toss, but the wind hates you. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Bin It', text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Paste it to a friend 😈');
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
  for (const s of PAPERS) {
    const have = owned.includes(s.id);
    const b = document.createElement('button');
    b.className = 'car' + (s.id === skinId ? ' sel' : '') + (have ? '' : ' locked');
    const bg = s.id === 'cosmic' ? 'linear-gradient(135deg,#ff5df0,#5b2dbf,#1b8cff)' : s.lines === 'ruled' ? `repeating-linear-gradient(180deg, ${s.base} 0 7px, ${s.line} 7px 9px)` : s.base;
    b.innerHTML = `<i style="background:${bg}"></i><b>${s.name}</b><span>${have ? (s.id === skinId ? 'TOSSING' : 'SELECT') : '◆ ' + s.price}</span>`;
    b.onclick = () => {
      if (have) {
        skinId = s.id;
        store.set('skin', skinId);
      } else if (coins >= s.price) {
        coins -= s.price;
        owned.push(s.id);
        skinId = s.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('skin', skinId);
        sfx('best', { root: 48 });
      } else {
        toast(`Need ${s.price - coins} more ◆ — sink more perfects!`);
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
function tryThrow(ang) {
  const r = run;
  if (!r || r.bot || mode !== 'play' || r.dead) return;
  if (r.state === 'ready') throwBall(r, ang);
  else if (r.state === 'next' || r.state === 'in') r.queued = ang; // a quick flick while the bin is still moving
}
function down(x, y, id) {
  ensureAudio();
  const b = hitButton(x, y);
  if (b) {
    sfx('click');
    b.act();
    return;
  }
  if (mode === 'title') return startGame();
  if (mode === 'over') {
    if (overT > 0.45) startGame();
    return;
  }
  if (mode === 'play') {
    swipe = { x0: x, y0: y, x, y, id, done: false };
    trail = [{ x, y, a: 0 }];
  }
}
function move(x, y, id) {
  const s = swipe;
  if (!s || s.id !== id || s.done) return;
  s.x = x;
  s.y = y;
  trail.push({ x, y, a: 0 });
  const dx = x - s.x0, dy = y - s.y0;
  if (-dy > 0.16 * SH || (Math.hypot(dx, dy) > 0.2 * SH && dy < 0)) {
    s.done = true;
    tryThrow(Math.atan2(dx, -dy));
  }
}
function up(id) {
  const s = swipe;
  if (!s || s.id !== id) return;
  swipe = null;
  if (s.done) return;
  const dx = s.x - s.x0, dy = s.y - s.y0;
  if (-dy > 24 && -dy > Math.abs(dx) * 0.35) tryThrow(Math.atan2(dx, -dy));
  else if (run && mode === 'play' && Math.hypot(dx, dy) < 12) run.tapHint = 1.6;
}
function keyThrow() {
  if (mode === 'title') return startGame();
  if (mode === 'over') {
    if (overT > 0.45) startGame();
    return;
  }
  kbUsed = true;
  tryThrow(kbAim);
}
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    down(e.clientX, e.clientY, e.pointerId);
  });
  window.addEventListener('pointermove', e => move(e.clientX, e.clientY, e.pointerId));
  window.addEventListener('pointerup', e => up(e.pointerId));
  window.addEventListener('pointercancel', () => (swipe = null));
  window.addEventListener('keydown', e => {
    if (!['Space', 'ArrowUp', 'Enter', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page mid-run
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') return (keyL = kbUsed = true);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') return (keyR = kbUsed = true);
    ensureAudio();
    keyThrow();
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyL = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keyR = false;
  });
  window.addEventListener('blur', () => {
    keyL = keyR = false;
    swipe = null;
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
  document.querySelector('.back') && (document.querySelector('.back').style.display = 'none');
  document.body.style.overflow = 'hidden';
  run = newRun({ seed: 7, bot: true, off: 0 });
  mode = 'og';
  // hand-placed: the paper ball curving in on the wind toward the bin
  run.bin.x = run.bin.fx = 0.22;
  run.bin.z = run.bin.fz = 3.6;
  run.wind = { W: -3.45, gust: null };
  run.streak = 0;
  const ang = idealAng(run, 0);
  throwBall(run, ang);
  run.fl.t = run.fl.T * 0.4;
  const f = run.fl, t = f.t;
  Object.assign(run.ball, { x: f.vx * t + 0.5 * f.ax * t * t, y: BY + f.vy * t - 0.5 * GRAV * t * t, z: f.vz * t, rot: 0.6, s: 1 });
  run.state = 'fly';
  for (let i = 0; i < 16; i++) run.wisps.push({ x: 1.9 - hash(i) * 3.4, y: lerp(0.7, 2.1, hash(i * 2.7)), z: lerp(0.8, 5, hash(i * 5.3)), life: 1, s: -1, sp: 0 });
  run.pile = [{ ox: 0.03, oz: 0.02, rot: 1 }, { ox: -0.05, oz: -0.03, rot: 2 }];
  zoom = { k: 1, fx: CX, fy: SH * 0.6 };
  document.fonts.load(`40px ${FONT}`).finally(() => {
    tReal = 0.3;
    render();
    window.__ogReady = true;
  });
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  // plan: perf=<k,..> perfect · rim=<k,..> rim-in · crash=<k> last throw (rim out, or crashkind=miss)
  const crashAt = +(Q.get('crash') || 10);
  const seed = +(Q.get('seed') || 3);
  const set = k => new Set((Q.get(k) || '').split(',').filter(Boolean).map(Number));
  const perf = set('perf'), rimS = set('rim');
  rec = { t: 0, frame: 0, events: [], states: [], musicStart: 0, crashAt };
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    bot: true,
    off: +(Q.get('off') || 4),
    plan: k => {
      const s = pr() < 0.5 ? -1 : 1;
      if (k >= crashAt) return Q.get('crashkind') === 'miss' ? s * (W_RIM + 0.12) : s * (W_IN + RIM_IN + 0.006);
      if (rimS.has(k)) return s * (W_IN + RIM_IN - 0.012);
      if (perf.has(k)) return s * pr() * 0.02;
      return s * (0.05 + pr() * 0.07);
    },
  });
  run.tutorial = false;
  run.windTip = run.windTipOn = false;
  mode = 'play';
  best = 0;
  rec.states.push({ t: 0, ...musicState() });
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.n, streak: run.streak, state: run.state, kind: run.lastKind, wind: windNow(run), bz: run.bin.z };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load(`40px ${FONT}`).then(() => (window.__recReady = true));
} else {
  run = newRun({ bot: true, attract: true });
  if (QA) {
    window.__qa = () => {
      const r = run, b = r.ball;
      const a = aimRows(r);
      const bp = P(binX(r, r.t), H, binZ(r));
      return { mode, state: r.state, t: r.t, tr: tReal, score: r.score, n: r.n, streak: r.streak, dead: r.dead, kind: r.lastKind, perfects: r.perfects, best, coins, attract: r.attract, wind: windNow(r), bz: r.bin.z, bx: binX(r, r.t), mover: !!r.bin.mover, gust: !!r.wind.gust, ideal: idealAng(r, 0), wIn: W_IN, ball: [a.bx, a.by], bin: [bp[0], bp[1]], lastE: r.lastE, tutorial: r.tutorial, overT, SW, SH };
    };
    // angle that lands e metres off centre (for test bots)
    window.__qaAng = e => idealAng(run, e);
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
