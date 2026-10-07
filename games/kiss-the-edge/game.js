import { Synth, Music, renderOffline, layerFor, dingNote, LAYER_AT, LAYER_NAMES, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const URL_PLAY = 'arcadeaday.com/kiss-the-edge';
const cvs = document.getElementById('game');
const g = cvs.getContext('2d');

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const left = d => ({ x: d.y, y: -d.x });
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
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('kte_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('kte_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONES = [
  { name: 'SUNSET BLVD', top: '#2a0a4a', bot: '#ff5e7e', road: '#2b1450', road2: '#3a1c66', side: '#1a0833', side2: '#12051f', edge: '#ff3ea5', curb2: '#ff3ea5', glow: '#ffd166' },
  { name: 'MIDNIGHT', top: '#02051a', bot: '#1d3aa0', road: '#0d1845', road2: '#172a6e', side: '#081136', side2: '#040a22', edge: '#3ef0ff', curb2: '#3ef0ff', glow: '#a0ff6b' },
  { name: 'AURORA', top: '#020f14', bot: '#11805f', road: '#0a2a26', road2: '#124238', side: '#05201b', side2: '#02110e', edge: '#6bffb0', curb2: '#6bffb0', glow: '#f5ff6b' },
  { name: 'VAPORWAVE', top: '#24065e', bot: '#f72585', road: '#3a0f6e', road2: '#4f1a8f', side: '#25074a', side2: '#160330', edge: '#4cc9f0', curb2: '#f72585', glow: '#4cc9f0' },
  { name: 'INFERNO', top: '#1a0200', bot: '#ff4d00', road: '#2a0d05', road2: '#45190b', side: '#1c0702', side2: '#100300', edge: '#ffd000', curb2: '#ff3d00', glow: '#ffd000' },
  { name: 'THE VOID', top: '#000000', bot: '#30303a', road: '#16161a', road2: '#24242b', side: '#0b0b0e', side2: '#050507', edge: '#ffffff', curb2: '#ff2d55', glow: '#ff2d55' },
];
const PAL_KEYS = ['top', 'bot', 'road', 'road2', 'side', 'side2', 'edge', 'curb2', 'glow'];
const zonePal = z => Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(ZONES[z % ZONES.length][k])]));

export const CARS = [
  { id: 'rookie', name: 'ROOKIE', body: '#ff3ea5', price: 0 },
  { id: 'mint', name: 'MINT', body: '#3effc1', price: 60 },
  { id: 'lemon', name: 'LEMON', body: '#ffe23e', price: 120 },
  { id: 'ghost', name: 'GHOST', body: '#eef0ff', price: 200 },
  { id: 'cobalt', name: 'COBALT', body: '#3e7bff', price: 320 },
  { id: 'lava', name: 'LAVA', body: '#ff5a1f', price: 480 },
  { id: 'gold', name: 'GOLD', body: '#ffc93c', price: 800 },
  { id: 'prism', name: 'PRISM', body: 'prism', price: 1500 },
];

// ---------------------------------------------------------------- tuning
const ISO = 0.6;
const C45 = Math.SQRT1_2;
const N = { x: 0, y: -1 };
const E = { x: 1, y: 0 };
const R_TURN = 50;
const CAR = { l: 40, w: 22, h: 12 };
const T_PERFECT = 14, T_INSANE = 5, T_GREAT = 28;
const speedAt = c => Math.min(500, 245 + c * 3.4);
const bpmAt = c => Math.min(152, 116 + c * 0.7);
const widthAt = c => Math.max(60, 100 - c * 0.5);

// ---------------------------------------------------------------- track
class Track {
  constructor(seed, off = 0) {
    this.r = rng(seed);
    this.off = off;
    this.p = [{ x: 0, y: 0 }];
    this.d = [];
    this.w = [];
    this.len = [];
    this.coins = [];
    this.queue = [];
  }
  ensure(n) {
    while (this.d.length < n) this.add();
  }
  beats(c) {
    const r = this.r;
    if (this.queue.length) return this.queue.shift();
    if (c >= 14 && r() < 0.1) {
      this.queue.push(1, 1);
      return 1;
    }
    const pick = a => a[(r() * a.length) | 0];
    if (c < 6) return pick([3, 4, 4, 5]);
    if (c < 20) return pick([2, 3, 3, 4]);
    if (c < 40) return pick([1, 2, 2, 3, 3, 4]);
    return pick([1, 1, 2, 2, 3]);
  }
  add() {
    const i = this.d.length;
    const c = i + this.off;
    const dir = i % 2 === 0 ? N : E;
    const w = widthAt(c);
    const b = i === 0 ? (REC ? 3 : 6) : this.beats(c);
    const len = Math.max(1.35 * w, 2.3 * R_TURN, (b * 60) / bpmAt(c) * speedAt(c));
    const p = this.p[i];
    this.d.push(dir);
    this.w.push(w);
    this.len.push(len);
    this.p.push({ x: p.x + dir.x * len, y: p.y + dir.y * len });
    if (i >= 2 && this.r() < 0.45) {
      const side = this.d[i - 1];
      const lat = w / 2 - 15;
      const n = this.r() < 0.35 ? 3 : 1;
      const s0 = len * (0.3 + this.r() * 0.3);
      for (let k = 0; k < n; k++) {
        const s = Math.min(len - 10, s0 + k * 28);
        this.coins.push({ x: p.x + dir.x * s + side.x * lat, y: p.y + dir.y * s + side.y * lat, got: false, seg: i });
      }
    }
  }
  // Outer corner of corner k (joining segment k-1 to k).
  outer(k) {
    const P = this.p[k], din = this.d[k - 1], dout = this.d[k], w = this.w[k];
    return { x: P.x + (din.x - dout.x) * w / 2, y: P.y + (din.y - dout.y) * w / 2 };
  }
  miter(k, side) {
    const P = this.p[k], w = this.w[k];
    const a = left(this.d[k - 1]), b = left(this.d[k]);
    return { x: P.x + side * (a.x + b.x) * w / 2, y: P.y + side * (a.y + b.y) * w / 2 };
  }
}

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, S = 1, U = 1;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let cam = { x: 0, y: 0, z: 1 };
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let screechG = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let bestCorners = store.get('bestc', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['rookie']);
let carId = store.get('car', 'rookie');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let held = false;
let ignoreHold = false;
let rec = null; // record-mode log
let stars = [];
let beatPhase = 0;
let pulse = 0;
const clock = { next: 0, step: 0, last: 0 };

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
  S = Math.min(SW, SH * 0.62) / 255;
  U = Math.min(SW / 420, SH / 640);
  const r = rng(7);
  stars = Array.from({ length: 90 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.4, p: r() * 6 }));
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const off = opts.off ?? 0;
  const tr = new Track(seed, off);
  tr.ensure(30);
  const r = {
    tr,
    off,
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    rnd: rng(seed ^ 0x5bd1e995),
    car: { x: 0, y: 0, h: -Math.PI / 2, b: -Math.PI / 2, slip: 0, v: speedAt(off), hold: false, z: 0, vz: 0, fvx: 0, fvy: 0, spin: 0, behind: false },
    score: 0,
    corners: 0,
    streak: 0,
    maxStreak: 0,
    next: 1,
    cmin: Infinity,
    botK: 1,
    dead: false,
    deadT: 0,
    slow: 1,
    slowT: 0,
    zone: 0,
    layer: 0,
    coinsGot: 0,
    pops: [],
    parts: [],
    trails: [[], []],
    passedBest: false,
    banner: null,
    layerPop: null,
    t: 0,
    scoreBump: 0,
    tutorial: !opts.bot && plays < 2,
  };
  palT = zonePal(0);
  if (!opts.keepPal) pal = zonePal(0);
  cam = { x: 0, y: -60, z: 1 };
  return r;
}

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
  ignoreHold = held;
  plays++;
  store.set('plays', plays);
  sfx('start');
  sfx('revive');
}

function botKiss(k) {
  const r = run;
  if (r.plan) return r.plan(k);
  if (r.attract) {
    if (k >= (r.crashAt ??= 12 + ((r.rnd() * 22) | 0))) return -14;
    const x = r.rnd();
    return x < 0.6 ? 6 + r.rnd() * 7 : x < 0.85 ? 16 + r.rnd() * 10 : 34;
  }
  return 10;
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
      screechG = audio.screech();
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
  const z = run ? run.zone : 0;
  const c = run ? run.corners + run.off : 0;
  let layer = run ? run.layer : 0;
  if (mode === 'title') layer = 3;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(c) };
}
function vibrate(ms) {
  if (!REC && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- update
function update(dt) {
  tReal += dt;
  const r = run;
  if (!r) return;
  {
    const bpm = musicState().bpm;
    if (REC && rec) {
      const st = rec.states[rec.states.length - 1];
      while (clock.next < rec.t) {
        if (clock.step % 4 === 0) clock.last = clock.next;
        clock.next += 60 / st.bpm / 4;
        clock.step++;
      }
      beatPhase = clamp((rec.t - clock.last) / (60 / st.bpm), 0, 1);
    } else beatPhase = music && audio && audio.ctx.state === 'running' ? music.phase(bpm) : (tReal * bpm / 60) % 1;
    pulse = Math.pow(1 - beatPhase, 3);
  }

  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  r.tr.ensure(r.next + 20);

  const car = r.car;
  if (!r.dead) {
    if (r.bot) botControl(r);
    else car.hold = held && !ignoreHold;
    stepCar(r, wdt);
    checkCorner(r);
    checkCoins(r);
    if (!onRoad(r)) die(r);
  } else {
    r.deadT += dt;
    car.x += car.fvx * wdt;
    car.y += car.fvy * wdt;
    car.vz += 900 * wdt;
    car.z += car.vz * wdt;
    car.b += car.spin * wdt;
    car.fvx *= 0.985;
    car.fvy *= 0.985;
    if (r.attract && r.deadT > 1.6) {
      run = newRun({ bot: true, attract: true, keepPal: true });
    } else if (!r.attract && mode === 'play' && r.deadT > 1.05) {
      gameOver(r);
    }
  }

  // camera
  const look = r.dead ? 0 : 70;
  const tx = car.x + Math.cos(car.h) * look;
  const ty = car.y + Math.sin(car.h) * look;
  const k = 1 - Math.exp(-5 * dt);
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);
  const zt = 1 - clamp((car.v - 245) / 1600, 0, 0.14);
  cam.z = lerp(cam.z, zt, 1 - Math.exp(-2 * dt));
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  // palette blend
  const pk = 1 - Math.exp(-1.6 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);

  // particles & pops
  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.z += p.vz * wdt;
    p.vz -= (p.g ?? 300) * wdt;
    if (p.z < 0 && p.bounce) {
      p.z = 0;
      p.vz *= -0.4;
    }
    p.vx *= 0.97;
    p.vy *= 0.97;
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.4) r.banner = null;
  }
  if (r.layerPop) {
    r.layerPop.t += dt;
    if (r.layerPop.t > 1.6) r.layerPop = null;
  }
  if (mode === 'over') overT += dt;

  // audio
  const scr = r.dead ? 0 : clamp((Math.abs(car.slip) - 0.08) / 0.5, 0, 1) * 0.16;
  if (REC && rec) {
    if (rec.frame % 2 === 0) rec.screech.push([rec.t, scr]);
  } else if (audio && soundOn) {
    screechG.gain.setTargetAtTime(mode === 'title' ? 0 : scr, audio.ctx.currentTime, 0.03);
    music.tick(musicState());
  }
}

function stepCar(r, dt) {
  const car = r.car;
  const tgt = car.hold ? 0 : -Math.PI / 2;
  const om = car.v / R_TURN;
  const dh = tgt - car.h;
  car.h += clamp(dh, -om * dt, om * dt);
  const slipT = (tgt - car.h) * 0.85;
  car.slip = lerp(car.slip, slipT, 1 - Math.exp(-16 * dt));
  car.b = car.h + car.slip;
  car.x += Math.cos(car.h) * car.v * dt;
  car.y += Math.sin(car.h) * car.v * dt;
  car.v = lerp(car.v, speedAt(r.corners + r.off), 1 - Math.exp(-2 * dt));

  const fx = Math.cos(car.b), fy = Math.sin(car.b);
  const sx = -fy, sy = fx;
  const a = clamp((Math.abs(car.slip) - 0.06) / 0.4, 0, 1);
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1;
    const tr = r.trails[i];
    tr.push({ x: car.x - fx * CAR.l * 0.32 + sx * CAR.w * 0.42 * sd, y: car.y - fy * CAR.l * 0.32 + sy * CAR.w * 0.42 * sd, a });
    if (tr.length > 70) tr.shift();
  }
  if (a > 0.4 && r.rnd() < 0.5) {
    const sd = r.rnd() < 0.5 ? 1 : -1;
    r.parts.push({ x: car.x - fx * CAR.l * 0.4 + sx * 8 * sd, y: car.y - fy * CAR.l * 0.4 + sy * 8 * sd, z: 2, vx: -fx * 40 + (r.rnd() - 0.5) * 40, vy: -fy * 40 + (r.rnd() - 0.5) * 40, vz: 20, g: -10, life: 0.5, max: 0.5, size: 5 + r.rnd() * 5, kind: 'smoke' });
  }
}

function botControl(r) {
  const tr = r.tr, car = r.car, k = r.botK;
  if (k >= tr.d.length) return;
  const P = tr.p[k], din = tr.d[k - 1], dout = tr.d[k], w = tr.w[k];
  const kiss = botKiss(k);
  if (dot(car, din) >= dot(P, din) + w / 2 - kiss - R_TURN) {
    car.hold = dout === E;
    r.botK++;
  }
}

function onRoad(r) {
  const tr = r.tr, car = r.car;
  for (let i = Math.max(0, r.next - 2); i <= r.next + 1 && i < tr.d.length; i++) {
    const p = tr.p[i], d = tr.d[i], w = tr.w[i];
    const rel = { x: car.x - p.x, y: car.y - p.y };
    const s = dot(rel, d);
    const l = dot(rel, left(d));
    if (s >= -w / 2 && s <= tr.len[i] + w / 2 && Math.abs(l) <= w / 2) return true;
  }
  return false;
}

function checkCorner(r) {
  const tr = r.tr, car = r.car, k = r.next;
  const P = tr.p[k], din = tr.d[k - 1], dout = tr.d[k], w = tr.w[k];
  const cin = dot(car, din), pin = dot(P, din);
  if (cin > pin - w / 2 - R_TURN * 1.3) r.cmin = Math.min(r.cmin, pin + w / 2 - cin);
  if (dot(car, dout) > dot(P, dout) + w * 0.95) {
    scoreCorner(r, k, r.cmin);
    r.next++;
    r.cmin = Infinity;
  }
}

function scoreCorner(r, k, m) {
  const car = r.car;
  let tier, pts, col;
  if (m < T_INSANE) [tier, pts, col] = ['INSANE!', 5, [255, 255, 255]];
  else if (m < T_PERFECT) [tier, pts, col] = ['PERFECT', 3, pal.glow.slice()];
  else if (m < T_GREAT) [tier, pts, col] = ['GREAT', 2, pal.edge.slice()];
  else [tier, pts, col] = [null, 1, null];

  const prevLayer = r.layer;
  if (tier) {
    r.streak++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  } else {
    if (r.streak >= 4) {
      sfx('drop');
      r.pops.push({ text: 'STREAK LOST', sub: '', x: car.x, y: car.y, t: 0, dur: 1.1, col: [255, 80, 100], size: 0.8 });
    }
    r.streak = 0;
  }
  const over = r.streak >= LAYER_AT[5];
  if (over) pts *= 2;
  r.score += pts;
  r.corners++;
  r.scoreBump = 1;
  r.layer = layerFor(r.streak);
  if (r.layer > prevLayer && !r.attract) r.layerPop = { name: LAYER_NAMES[r.layer], t: 0 };
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });

  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  if (tier) {
    sfx('ding', { m: dingNote(root, r.streak - 1), big: tier !== 'GREAT' });
    r.pops.push({ text: tier, sub: '+' + pts + (r.streak > 1 ? '  x' + r.streak : ''), x: car.x, y: car.y, t: 0, dur: 0.95, col, size: tier === 'INSANE!' ? 1.25 : 1 });
    const o = r.tr.outer(k);
    const n = tier === 'GREAT' ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const a = r.rnd() * Math.PI * 2, sp = 60 + r.rnd() * 220;
      r.parts.push({ x: car.x, y: car.y, z: 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 80 + r.rnd() * 200, g: 500, life: 0.7, max: 0.7, size: 2 + r.rnd() * 3, kind: 'spark', col });
    }
    r.parts.push({ x: car.x, y: car.y, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.45, max: 0.45, size: 1, kind: 'ring', col });
    void o;
    if (tier !== 'GREAT') {
      flash = tier === 'INSANE!' ? 0.35 : 0.12;
      cam.z *= 1.02;
      vibrate(tier === 'INSANE!' ? 40 : 15);
    }
    if (tier === 'INSANE!') {
      r.slow = 0.3;
      r.slowT = 0.28;
    }
  } else if (!r.attract) {
    r.pops.push({ text: 'SAFE', sub: '+1', x: car.x, y: car.y, t: 0, dur: 0.7, col: [190, 190, 210], size: 0.7 });
  }

  const z = Math.floor(r.corners / 20);
  if (z !== r.zone) {
    r.zone = z;
    palT = zonePal(z);
    r.banner = { text: 'ZONE ' + (z + 1), sub: ZONES[z % ZONES.length].name, t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep going', t: 0 };
    sfx('best', { root });
    flash = 0.3;
  }
}

function checkCoins(r) {
  const car = r.car;
  for (const c of r.tr.coins) {
    if (c.got || c.seg < r.next - 2 || c.seg > r.next + 1) continue;
    if ((c.x - car.x) ** 2 + (c.y - car.y) ** 2 < 22 * 22) {
      c.got = true;
      r.coinsGot++;
      sfx('coin');
      for (let i = 0; i < 8; i++) {
        const a = r.rnd() * Math.PI * 2;
        r.parts.push({ x: c.x, y: c.y, z: 14, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, vz: 120, g: 500, life: 0.5, max: 0.5, size: 2.5, kind: 'spark', col: [255, 214, 80] });
      }
    }
  }
}

function die(r) {
  const car = r.car;
  r.dead = true;
  r.deadT = 0;
  car.fvx = Math.cos(car.h) * car.v * 0.6;
  car.fvy = Math.sin(car.h) * car.v * 0.6;
  car.vz = -120;
  car.spin = (r.rnd() < 0.5 ? -1 : 1) * (4 + r.rnd() * 4);
  // Fell off a far (up-screen) edge? Then the road should hide the car.
  const tr = r.tr;
  let bestD = Infinity, nx = 0, ny = 0;
  for (let i = Math.max(0, r.next - 2); i <= r.next && i < tr.d.length; i++) {
    const p = tr.p[i], d = tr.d[i], w = tr.w[i], L = left(d);
    const rel = { x: car.x - p.x, y: car.y - p.y };
    const s = clamp(dot(rel, d), -w / 2, tr.len[i] + w / 2);
    const l = clamp(dot(rel, L), -w / 2, w / 2);
    const q = { x: p.x + d.x * s + L.x * l, y: p.y + d.y * s + L.y * l };
    const dd = (car.x - q.x) ** 2 + (car.y - q.y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      nx = car.x - q.x;
      ny = car.y - q.y;
    }
  }
  car.behind = -C45 * nx + C45 * ny < 0;
  r.slow = 0.35;
  r.slowT = 0.55;
  shake = 1;
  flash = 0.25;
  if (!r.attract) {
    sfx('crash');
    vibrate([60, 40, 90]);
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
    bestCorners = r.corners;
    store.set('best', best);
    store.set('bestc', bestCorners);
  }
}

// ---------------------------------------------------------------- render
function P(x, y) {
  const dx = x - cam.x, dy = y - cam.y;
  const s = S * cam.z;
  return [SW * (OG ? 0.68 : 0.5) + (dx + dy) * C45 * s + shakeX, SH * 0.6 + (dy - dx) * C45 * s * ISO + shakeY];
}
let shakeX = 0, shakeY = 0;

function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 18 * U;
  shakeY = (Math.random() - 0.5) * shake * 18 * U;
  drawBackground();
  if (!run) return;
  const r = run;
  const car = r.car;
  if (r.dead && car.behind) drawCar(car, r);
  drawRoad(r);
  drawTrails(r);
  drawCoins(r);
  drawFlag(r);
  if (!(r.dead && car.behind)) drawCar(car, r);
  drawParts(r);
  if (r.streak >= LAYER_AT[5] && !r.dead) drawSpeedLines(r);
  drawPops(r);
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
  // synthwave sun, banded, breathing with the kick
  const lf = run ? run.layer / 5 : 0.6;
  const sr = Math.min(SW, SH * 0.6) * 0.36 * (1 + pulse * 0.025 * lf);
  const sx = SW * 0.5 - (cam.x - cam.y) * 0.004 * S, sy = SH * 0.3;
  const halo = g.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.1);
  halo.addColorStop(0, css(pal.glow, 0.25 + pulse * 0.15 * lf));
  halo.addColorStop(1, css(pal.glow, 0));
  g.fillStyle = halo;
  g.fillRect(sx - sr * 2.2, sy - sr * 2.2, sr * 4.4, sr * 4.4);
  const sun = g.createLinearGradient(0, sy - sr, 0, sy + sr);
  sun.addColorStop(0, css(pal.glow));
  sun.addColorStop(1, css(pal.edge));
  g.fillStyle = sun;
  g.beginPath();
  g.arc(sx, sy, sr, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = gr;
  for (let i = 0; i < 7; i++) {
    const t = i / 7;
    const y = sy + sr * (0.05 + t * 0.95);
    g.fillRect(sx - sr, y, sr * 2, sr * (0.02 + t * 0.07));
  }
  g.restore();
  // stars
  for (const s of stars) {
    const tw = 0.5 + 0.5 * Math.sin(tReal * 2 + s.p);
    const x = ((s.x * SW - cam.x * 0.03 * S) % SW + SW) % SW;
    const y = ((s.y * SH * 0.8 - cam.y * 0.02 * S) % SH + SH) % SH;
    g.fillStyle = `rgba(255,255,255,${0.15 + tw * 0.5 * (1 - y / SH)})`;
    g.fillRect(x, y, s.s * U, s.s * U);
  }
  // parallax floor grid far below the road
  const gs = 140, par = 0.55;
  const cx = cam.x * par, cy = cam.y * par;
  const s = S * cam.z * 0.8;
  const prj = (x, y) => [SW / 2 + (x - cx + y - cy) * C45 * s, SH * 0.72 + (y - cy - (x - cx)) * C45 * s * ISO];
  g.strokeStyle = css(pal.edge, 0.09);
  g.lineWidth = 1.2 * U;
  g.beginPath();
  const span = 1600;
  const x0 = Math.floor((cx - span) / gs) * gs, y0 = Math.floor((cy - span) / gs) * gs;
  for (let x = x0; x < cx + span; x += gs) {
    const a = prj(x, cy - span), b = prj(x, cy + span);
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
  }
  for (let y = y0; y < cy + span; y += gs) {
    const a = prj(cx - span, y), b = prj(cx + span, y);
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
  }
  g.stroke();
  const vg = g.createRadialGradient(SW / 2, SH * 0.55, SH * 0.2, SW / 2, SH * 0.55, SH * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vg;
  g.fillRect(0, 0, SW, SH);
}

function drawRoad(r) {
  const tr = r.tr;
  const a = Math.max(0, r.next - 5);
  const b = Math.min(tr.d.length - 1, r.next + 12);
  const T = 30 * S * cam.z;

  // outline chains (left, right) from segment a to corner b
  const L = [], R = [];
  if (a === 0) {
    const d = tr.d[0], w = tr.w[0], l = left(d), p = tr.p[0];
    L.push({ x: p.x - d.x * w / 2 + l.x * w / 2, y: p.y - d.y * w / 2 + l.y * w / 2 });
    R.push({ x: p.x - d.x * w / 2 - l.x * w / 2, y: p.y - d.y * w / 2 - l.y * w / 2 });
  } else {
    L.push(tr.miter(a, 1));
    R.push(tr.miter(a, -1));
  }
  for (let k = a + 1; k < b; k++) {
    L.push(tr.miter(k, 1));
    R.push(tr.miter(k, -1));
  }
  {
    const d = tr.d[b - 1], w = tr.w[b - 1], l = left(d), p = tr.p[b];
    L.push({ x: p.x + l.x * w / 2, y: p.y + l.y * w / 2 });
    R.push({ x: p.x - l.x * w / 2, y: p.y - l.y * w / 2 });
  }
  const outline = L.concat(R.slice().reverse());

  // side faces (only those facing down-screen), far to near
  const faces = [];
  for (let i = 0; i < outline.length; i++) {
    const p1 = outline[i], p2 = outline[(i + 1) % outline.length];
    const ex = p2.x - p1.x, ey = p2.y - p1.y;
    const len = Math.hypot(ex, ey);
    if (len < 0.01) continue;
    const nx = ey / len, ny = -ex / len; // outward
    const sy = -C45 * nx + C45 * ny;
    if (sy <= 0.01) continue;
    const s1 = P(p1.x, p1.y), s2 = P(p2.x, p2.y);
    faces.push({ s1, s2, west: nx < -0.5, y: (s1[1] + s2[1]) / 2 });
  }
  faces.sort((u, v) => u.y - v.y);
  for (const f of faces) {
    const gr = g.createLinearGradient(0, f.y, 0, f.y + T);
    const c = f.west ? pal.side2 : pal.side;
    gr.addColorStop(0, css(shade(c, 1.5)));
    gr.addColorStop(1, css(c));
    g.fillStyle = gr;
    poly([f.s1, f.s2, [f.s2[0], f.s2[1] + T], [f.s1[0], f.s1[1] + T]]);
    g.fill();
    g.strokeStyle = css(pal.edge, 0.35);
    g.lineWidth = 1.5 * U;
    g.beginPath();
    g.moveTo(f.s1[0], f.s1[1] + T);
    g.lineTo(f.s2[0], f.s2[1] + T);
    g.stroke();
  }

  // top surface
  const top = outline.map(p => P(p.x, p.y));
  poly(top);
  g.fillStyle = css(pal.road);
  g.fill();

  // stripes on straights + corner squares
  g.save();
  poly(top);
  g.clip();
  const band = 34;
  g.fillStyle = css(pal.road2, 0.75);
  for (let i = a; i < b; i++) {
    const p = tr.p[i], d = tr.d[i], w = tr.w[i], l = left(d), len = tr.len[i];
    const base = dot(p, d);
    const s0 = i === 0 ? -w / 2 : w / 2, s1 = len - w / 2;
    let s = Math.ceil((base + s0) / band) * band - base;
    for (; s < s1; s += band * 2) {
      const e = Math.min(s + band, s1);
      const q = [[s, -w / 2], [e, -w / 2], [e, w / 2], [s, w / 2]].map(([u, v]) => P(p.x + d.x * u + l.x * v, p.y + d.y * u + l.y * v));
      poly(q);
      g.fill();
    }
  }
  // corner pads with chevrons pointing the new direction
  for (let k = Math.max(1, a); k < b; k++) {
    const p = tr.p[k], w = tr.w[k], dout = tr.d[k], din = tr.d[k - 1];
    const sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => P(p.x + u * w / 2, p.y + v * w / 2));
    g.fillStyle = css(shade(pal.road, 0.75));
    poly(sq);
    g.fill();
    const c = { x: p.x - din.x * w * 0.08, y: p.y - din.y * w * 0.08 };
    const lw = w * 0.18;
    for (let j = 0; j < 2; j++) {
      const o = (j - 0.5) * w * 0.22;
      const tip = { x: c.x + dout.x * (o + lw), y: c.y + dout.y * (o + lw) };
      const s1 = { x: c.x + dout.x * o + din.x * lw, y: c.y + dout.y * o + din.y * lw };
      const s2 = { x: c.x + dout.x * o - din.x * lw, y: c.y + dout.y * o - din.y * lw };
      g.strokeStyle = css(pal.edge, k < r.next ? 0.15 : 0.55);
      g.lineWidth = 4 * U;
      g.lineJoin = 'round';
      g.beginPath();
      const A = P(s1.x, s1.y), B = P(tip.x, tip.y), C = P(s2.x, s2.y);
      g.moveTo(A[0], A[1]);
      g.lineTo(B[0], B[1]);
      g.lineTo(C[0], C[1]);
      g.stroke();
    }
  }
  // kiss curbs along the outer wall of each corner
  for (let k = Math.max(1, a); k < b; k++) {
    const o = tr.outer(k), din = tr.d[k - 1], dout = tr.d[k], w = tr.w[k];
    const len = w + 50, depth = 9, blk = 14;
    for (let s = 0, j = 0; s < len; s += blk, j++) {
      const e = Math.min(len, s + blk);
      const q = [[s, 0], [e, 0], [e, depth], [s, depth]].map(([u, v]) => P(o.x + dout.x * u - din.x * v, o.y + dout.y * u - din.y * v));
      g.fillStyle = j % 2 ? css(pal.curb2) : '#ffffff';
      poly(q);
      g.fill();
    }
  }
  // start line
  if (a === 0) {
    const p = tr.p[0], w = tr.w[0];
    const n = 8, sz = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 2; j++) {
        const x0 = p.x - w / 2 + i * sz, y0 = p.y - 30 + j * sz;
        g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        poly([[x0, y0], [x0 + sz, y0], [x0 + sz, y0 + sz], [x0, y0 + sz]].map(([x, y]) => P(x, y)));
        g.fill();
      }
  }
  g.restore();

  // neon edges, pumping with the beat as the music builds
  const lf = r.layer / 5;
  for (const chain of [L, R]) {
    const pts = chain.map(p => P(p.x, p.y));
    g.lineJoin = 'round';
    g.strokeStyle = css(pal.edge, 0.22 + pulse * 0.4 * lf);
    g.lineWidth = (9 + pulse * 14 * lf) * U;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    g.strokeStyle = css(shade(pal.edge, 1.2));
    g.lineWidth = 2.6 * U;
    g.stroke();
  }
}

function drawTrails(r) {
  const col = carColor(r);
  for (const tr of r.trails) {
    for (let i = 1; i < tr.length; i++) {
      const p0 = tr[i - 1], p1 = tr[i];
      const al = p1.a * (i / tr.length);
      if (al < 0.03) continue;
      const a = P(p0.x, p0.y), b = P(p1.x, p1.y);
      g.strokeStyle = css(col, al * 0.8);
      g.lineWidth = 3.2 * U;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}

function drawCoins(r) {
  const s = S * cam.z;
  for (const c of r.tr.coins) {
    if (c.got || c.seg < r.next - 3 || c.seg > r.next + 8) continue;
    const [x, y] = P(c.x, c.y);
    const bob = (14 + Math.sin(tReal * 4 + c.x) * 3) * s;
    const sp = Math.abs(Math.cos(tReal * 3 + c.y * 0.1));
    const rr = 7 * s;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y, rr, rr * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    const gl = g.createRadialGradient(x, y - bob, 0, x, y - bob, rr * 3);
    gl.addColorStop(0, 'rgba(255,214,80,0.45)');
    gl.addColorStop(1, 'rgba(255,214,80,0)');
    g.fillStyle = gl;
    g.fillRect(x - rr * 3, y - bob - rr * 3, rr * 6, rr * 6);
    g.fillStyle = '#ffd650';
    poly([[x, y - bob - rr * 1.3], [x + rr * sp, y - bob], [x, y - bob + rr * 1.3], [x - rr * sp, y - bob]]);
    g.fill();
    g.fillStyle = '#fff6c8';
    poly([[x, y - bob - rr * 1.3], [x + rr * sp * 0.4, y - bob], [x, y - bob + rr * 0.3]]);
    g.fill();
  }
}

function drawFlag(r) {
  if (r.bot || bestCorners < 2 || r.passedBest) return;
  const k = bestCorners;
  if (k < r.next - 3 || k > r.next + 10 || k >= r.tr.d.length) return;
  const o = r.tr.outer(k);
  const [x, y] = P(o.x, o.y);
  const h = 70 * S * cam.z;
  g.strokeStyle = '#fff';
  g.lineWidth = 3 * U;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.stroke();
  const wv = Math.sin(tReal * 6) * 4 * U;
  g.fillStyle = css(pal.glow);
  poly([[x, y - h], [x + 64 * U, y - h + 10 * U + wv], [x, y - h + 26 * U]]);
  g.fill();
  text('BEST ' + best, x + 6 * U, y - h + 13 * U, 11 * U, '#111', 'left');
}

function carColor(r) {
  const c = CARS.find(c => c.id === (r.bot && !REC ? 'rookie' : carId)) || CARS[0];
  if (c.body === 'prism') {
    const h = (tReal * 90) % 360;
    return hslRgb(h, 0.9, 0.6);
  }
  return hexRgb(c.body);
}
function hslRgb(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function drawCar(car, r) {
  const col = carColor(r);
  const s = S * cam.z;
  const fx = Math.cos(car.b), fy = Math.sin(car.b), sx = -fy, sy = fx;
  const zoff = car.z * s;
  const fade = r.dead ? clamp(1 - r.deadT / 1.4, 0, 1) : 1;
  if (fade <= 0) return;
  g.globalAlpha = fade;
  const pt = (u, v) => {
    const [x, y] = P(car.x + fx * u + sx * v, car.y + fy * u + sy * v);
    return [x, y + zoff];
  };
  const l = CAR.l / 2, w = CAR.w / 2, H = CAR.h * s;

  if (!r.dead) {
    // headlight cone
    const [hx, hy] = pt(l + 40, 0);
    const [cx, cy] = pt(l, 0);
    const gr = g.createRadialGradient(cx, cy, 0, hx, hy, 70 * s);
    gr.addColorStop(0, 'rgba(255,255,230,0.28)');
    gr.addColorStop(1, 'rgba(255,255,230,0)');
    g.fillStyle = gr;
    poly([pt(l, -w * 0.7), pt(l + 80, -w * 2.2), pt(l + 80, w * 2.2), pt(l, w * 0.7)]);
    g.fill();
    // shadow + underglow
    const sh = [pt(l + 3, -w - 3), pt(l + 3, w + 3), pt(-l - 3, w + 3), pt(-l - 3, -w - 3)];
    g.fillStyle = css(col, 0.35);
    poly(sh);
    g.fill();
  }

  const box = (u0, u1, v0, v1, z0, z1, top, side) => {
    const base = [[u1, v0], [u1, v1], [u0, v1], [u0, v0]];
    const pts = base.map(([u, v]) => pt(u, v));
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const [ua, va] = base[i], [ub, vb] = base[(i + 1) % 4];
      const mu = (ua + ub) / 2 - (u0 + u1) / 2, mv = (va + vb) / 2 - (v0 + v1) / 2;
      const wx = fx * mu + sx * mv, wy = fy * mu + sy * mv;
      const syn = -wx + wy;
      if (syn <= 0) continue;
      const lit = (wx + wy) > 0 ? 0.62 : 0.45;
      g.fillStyle = css(shade(side, lit));
      poly([[a[0], a[1] - z0], [b[0], b[1] - z0], [b[0], b[1] - z1], [a[0], a[1] - z1]]);
      g.fill();
    }
    g.fillStyle = css(top);
    poly(pts.map(([x, y]) => [x, y - z1]));
    g.fill();
    return pts;
  };
  // wheels peeking out under the body
  g.fillStyle = '#0c0c14';
  for (const [u, v] of [[l * 0.6, -w * 1.02], [l * 0.6, w * 1.02], [-l * 0.6, -w * 1.02], [-l * 0.6, w * 1.02]]) {
    const [x, y] = pt(u, v);
    g.beginPath();
    g.ellipse(x, y - H * 0.25, 5.5 * s, 4.2 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  box(-l, l, -w, w, 0, H, col, col);
  const glass = shade(col, 0.32);
  box(-l * 0.5, l * 0.22, -w * 0.8, w * 0.8, H, H * 1.75, shade(col, 1.12), glass);
  // spoiler
  box(-l * 1.02, -l * 0.8, -w, w, H * 1.45, H * 1.75, shade(col, 0.9), shade(col, 0.7));
  // racing stripe
  g.fillStyle = 'rgba(255,255,255,0.55)';
  poly([pt(l, -w * 0.18), pt(l, w * 0.18), pt(l * 0.22, w * 0.18), pt(l * 0.22, -w * 0.18)].map(([x, y]) => [x, y - H]));
  g.fill();
  // lights
  const hl = [pt(l, -w * 0.6), pt(l, w * 0.6)];
  const tl = [pt(-l, -w * 0.6), pt(-l, w * 0.6)];
  g.fillStyle = '#fffbe0';
  for (const [x, y] of hl) {
    g.beginPath();
    g.arc(x, y - H * 0.6, 2.6 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ff2a3d';
  for (const [x, y] of tl) {
    g.beginPath();
    g.arc(x, y - H * 0.6, 2.4 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawParts(r) {
  const s = S * cam.z;
  for (const p of r.parts) {
    const [x, y] = P(p.x, p.y);
    const k = p.life / p.max;
    if (p.kind === 'smoke') {
      g.fillStyle = `rgba(255,255,255,${0.18 * k})`;
      g.beginPath();
      g.arc(x, y - p.z * s, p.size * s * (1.8 - k), 0, Math.PI * 2);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = 4 * U * k;
      g.beginPath();
      g.ellipse(x, y, (1 - k) * 90 * s + 10, ((1 - k) * 90 * s + 10) * ISO, 0, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = css(p.col, Math.min(1, k * 1.5));
      g.fillRect(x - p.size * s / 2, y - p.z * s - p.size * s / 2, p.size * s, p.size * s);
    }
  }
}

function drawSpeedLines(r) {
  const h = r.car.h;
  let dx = (Math.cos(h) + Math.sin(h)) * C45, dy = (Math.sin(h) - Math.cos(h)) * C45 * ISO;
  const m = Math.hypot(dx, dy);
  dx /= m;
  dy /= m;
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = (i * 0.618) % 1, b = (i * 0.383 + 0.2) % 1;
    const len = (80 + b * 160) * U;
    const ph = (tReal * (1.6 + a) + a * 7) % 1;
    const x = a * SW * 1.4 - SW * 0.2 - dx * (ph * SH * 1.4 - SH * 0.2);
    const y = b * SH * 1.4 - SH * 0.2 - dy * (ph * SH * 1.4 - SH * 0.2);
    g.strokeStyle = i % 3 ? css(pal.edge, 0.22 + pulse * 0.2) : 'rgba(255,255,255,0.25)';
    g.lineWidth = (i % 3 ? 2 : 3) * U;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx * len, y + dy * len);
    g.stroke();
  }
  g.lineCap = 'butt';
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || ''} ${size}px ${opts.font || '"Russo One", system-ui, sans-serif'}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(0,0,0,0.85)';
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
    const [px, y] = P(p.x, p.y);
    const x = clamp(px, 130 * U, SW - 130 * U);
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const yy = y - (60 + ease(k) * 50) * U;
    g.globalAlpha = a;
    text(p.text, x, yy, 30 * U * sc, css(p.col), 'center', { stroke: 6 * U, glow: css(p.col, 0.8) });
    if (p.sub) text(p.sub, x, yy + 28 * U * sc, 18 * U * sc, '#fff', 'center', { stroke: 4 * U });
    g.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, rr) {
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  text(String(r.score), SW / 2, top + 30 * U, 58 * U * bump, '#fff', 'center', { stroke: 7 * U, glow: css(pal.edge, 0.9) });
  if (r.streak >= 2) {
    const over = r.streak >= LAYER_AT[5];
    text((over ? 'OVERDRIVE  ' : 'STREAK  ') + 'x' + r.streak, SW / 2, top + 72 * U, 17 * U, css(over ? [255, 255, 255] : pal.glow), 'center', { stroke: 4 * U, glow: css(pal.glow, 0.9) });
  }
  // music layer meter
  const ph = music ? music.phase(bpmAt(r.corners + r.off)) : (r.t * bpmAt(r.corners + r.off) / 60) % 1;
  const n = LAYER_NAMES.length, bw = 30 * U, gap = 7 * U;
  const x0 = SW / 2 - (n * bw + (n - 1) * gap) / 2;
  const yb = top + 104 * U;
  for (let i = 0; i < n; i++) {
    const on = i <= r.layer;
    const pulse = on ? 1 - ph : 0;
    const h = (on ? 10 + 16 * pulse * (0.6 + 0.4 * ((i * 7) % 3) / 2) : 5) * U;
    g.fillStyle = on ? css(i === 5 ? [255, 255, 255] : pal.edge, 0.95) : 'rgba(255,255,255,0.18)';
    roundRect(x0 + i * (bw + gap), yb - h, bw, h, 3 * U);
    g.fill();
  }
  text('MUSIC', SW / 2, yb + 12 * U, 9 * U, 'rgba(255,255,255,0.55)', 'center', { font: 'system-ui, sans-serif', weight: '700' });
  if (r.layerPop) {
    const k = r.layerPop.t / 1.6;
    g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const sc = back(r.layerPop.t / 0.25);
    text(r.layerPop.name === 'OVERDRIVE' ? 'OVERDRIVE!' : '+ ' + r.layerPop.name, SW / 2, yb + 36 * U, 20 * U * sc, css(pal.glow), 'center', { stroke: 5 * U, glow: css(pal.glow) });
    g.globalAlpha = 1;
  }
  // coins
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 16 * U, '#ffd650', 'left', { stroke: 4 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  // zone / best banner
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.44 : 0.36);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 8 * U, 34 * U * back(b.t / 0.3), '#fff', 'center', { glow: css(pal.glow) });
    text(b.sub, SW / 2, y + 24 * U, 14 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  if (r.tutorial && !r.dead && r.next <= 4) {
    const tr = r.tr, k = r.next, car = r.car;
    const P0 = tr.p[k], din = tr.d[k - 1], dout = tr.d[k], w = tr.w[k];
    const trig = dot(P0, din) + w / 2 - 18 - R_TURN;
    const dist = trig - dot(car, din);
    const wantHold = dout === E;
    const correct = car.hold === wantHold;
    if (dist < 160 && !correct) {
      const now = dist < 8;
      const label = wantHold ? (now ? 'HOLD NOW!' : 'get ready to HOLD…') : now ? 'LET GO NOW!' : 'get ready to LET GO…';
      text(label, SW / 2, SH * 0.8, (now ? 34 : 20) * U, now ? '#fff' : 'rgba(255,255,255,0.8)', 'center', { stroke: 6 * U, glow: now ? css(pal.glow) : null });
    }
    if (k === 1 && r.corners === 0 && !car.hold && dist >= 160) text('hold to drift right · let go to drift left', SW / 2, SH * 0.8, 15 * U, 'rgba(255,255,255,0.85)', 'center', { stroke: 4 * U });
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

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.62, 0);
  gr.addColorStop(0, 'rgba(10,3,22,0.82)');
  gr.addColorStop(1, 'rgba(10,3,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.27, y = SH * 0.4;
  g.save();
  g.translate(x, y);
  g.rotate(-0.06);
  text('KISS', 0, -70, 128, '#fff', 'center', { stroke: 16, glow: css(pal.edge), blur: 40 });
  text('THE EDGE', 0, 52, 104, css(pal.glow), 'center', { stroke: 14, glow: css(pal.glow), blur: 34 });
  g.restore();
  text('drift to the beat.', x, y + 170, 34, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 8 });
  text('free · no download · one tap', x, y + 218, 24, 'rgba(255,255,255,0.8)', 'center', { font: 'system-ui, sans-serif', weight: '700', stroke: 6 });
}

function drawTitle() {
  if (OG) return drawOgTitle();
  const gr = g.createLinearGradient(0, SH * 0.45, 0, SH);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const y = SH * 0.2;
  const wob = Math.sin(tReal * 2.2) * 0.03;
  g.save();
  g.translate(SW / 2, y);
  g.rotate(-0.06 + wob * 0.3);
  text('KISS', 0, -34 * U, 62 * U, '#fff', 'center', { stroke: 9 * U, glow: css(pal.edge), blur: 30 * U });
  text('THE EDGE', 0, 28 * U, 52 * U, css(pal.glow), 'center', { stroke: 8 * U, glow: css(pal.glow), blur: 26 * U });
  g.restore();
  text('drift to the beat.', SW / 2, y + 94 * U, 15 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  text('the closer you cut it, the harder the music hits', SW / 2, y + 116 * U, 12.5 * U, 'rgba(255,255,255,0.85)', 'center', { font: 'system-ui, sans-serif', weight: '700', stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  text('TAP TO PLAY', SW / 2, SH * 0.8, (26 + p * 3) * U, '#fff', 'center', { stroke: 6 * U, glow: css(pal.edge) });
  if (best > 0) text('BEST  ' + best, SW / 2, SH * 0.8 + 38 * U, 15 * U, css(pal.glow), 'center', { stroke: 4 * U });
  pill('GARAGE', SW / 2, SH * 0.92, 150 * U, 40 * U, 'rgba(255,255,255,0.14)', '#fff', openGarage, 15);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 16 * U, '#ffd650', 'left', { stroke: 4 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(5,2,15,${0.55 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.47 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  g.fillStyle = 'rgba(20,10,40,0.92)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 22 * U);
  g.fill();
  g.strokeStyle = css(pal.edge, 0.8);
  g.lineWidth = 2 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  if (r.isBest) text('NEW BEST!', SW / 2, t0 + 40 * U, 30 * U * back(overT / 0.4), css(pal.glow), 'center', { glow: css(pal.glow) });
  else text(r.score === 0 ? 'OOPS!' : 'SO CLOSE.', SW / 2, t0 + 40 * U, 26 * U, '#fff');
  text(String(r.score), SW / 2, t0 + 105 * U, 72 * U, '#fff', 'center', { glow: css(pal.edge) });
  let sub;
  if (REC) sub = 'can you beat ' + r.score + '?';
  else if (r.score === 0) sub = 'tip: hold = drift right · let go = drift left';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 5) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = 'best ' + r.prevBest + ' · longest streak x' + r.maxStreak;
  text(sub, SW / 2, t0 + 152 * U, 15 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
  if (REC) {
    text('KISS THE EDGE', SW / 2, t0 - 34 * U, 30 * U, '#fff', 'center', { stroke: 6 * U, glow: css(pal.edge) });
    text('play free, no download →', SW / 2, t0 + 205 * U, 16 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 238 * U, 15 * U, css(pal.edge), 'center', { font: 'system-ui, sans-serif', weight: '800' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 185 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 186 * U, 16 * U, '#ffd650', 'left');
    pill('RETRY', SW / 2, t0 + 240 * U, cw - 60 * U, 54 * U, css(pal.edge), '#120822', startGame, 24);
    pill('SHARE', SW / 2 - 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', share, 14);
    pill('GARAGE', SW / 2 + 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', openGarage, 14);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, SH - 30 * U, 12 * U, 'rgba(255,255,255,0.55)', 'center', { font: 'system-ui, sans-serif', weight: '700' });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 330;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 92, 70, i === hook.length - 1 ? css(pal.glow) : '#fff', 'center', { stroke: 16, glow: 'rgba(0,0,0,0.6)' }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  const plan = rec && rec.crashAt;
  if (cap2 && plan && !r.dead && r.next >= plan - 2 && r.next <= plan) {
    text(cap2, SW / 2, 290, 64, '#fff', 'center', { stroke: 14 });
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
  const txt = `I scored ${r.score} on KISS THE EDGE 🏎️💨 the closer you drift, the harder the music hits. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Kiss the Edge', text: txt, url });
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

function openGarage() {
  const el = document.getElementById('garage');
  const list = el.querySelector('.cars');
  el.querySelector('.coins').textContent = coins;
  list.innerHTML = '';
  for (const c of CARS) {
    const have = owned.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car' + (c.id === carId ? ' sel' : '') + (have ? '' : ' locked');
    const swatch = c.body === 'prism' ? 'linear-gradient(135deg,#ff3ea5,#ffd166,#3effc1,#3e7bff)' : c.body;
    b.innerHTML = `<i style="background:${swatch}"></i><b>${c.name}</b><span>${have ? (c.id === carId ? 'DRIVING' : 'SELECT') : '◆ ' + c.price}</span>`;
    b.onclick = () => {
      if (have) {
        carId = c.id;
        store.set('car', carId);
      } else if (coins >= c.price) {
        coins -= c.price;
        owned.push(c.id);
        carId = c.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('car', carId);
        sfx('best', { root: 45 });
      } else {
        toast(`Need ${c.price - coins} more ◆ — kiss more edges!`);
        return;
      }
      sfx('click');
      openGarage();
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
  held = true;
  ensureAudio();
  if (x != null) {
    const b = hitButton(x, y);
    if (b) {
      ignoreHold = true;
      sfx('click');
      b.act();
      return;
    }
  }
  if (mode === 'title') startGame();
  else if (mode === 'over') {
    if (overT > 0.45) startGame();
  } else ignoreHold = false;
}
function release() {
  held = false;
  ignoreHold = false;
}
if (!REC) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (scrollY > 40) return; // reading the info sheet below the game
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter') {
      e.preventDefault();
      if (document.getElementById('garage').classList.contains('on')) return;
      press(null, null);
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter') release();
  });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.ctx.suspend();
    else if (soundOn) audio.ctx.resume();
  });
  window.addEventListener('resize', resize);
}

// ---------------------------------------------------------------- boot
resize();
if (OG) document.querySelector('.back').style.display = 'none';
if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 22);
  const seed = +(Q.get('seed') || 11);
  const insane = new Set((Q.get('insane') || '').split(',').filter(Boolean).map(Number));
  const great = new Set((Q.get('great') || '').split(',').filter(Boolean).map(Number));
  const ik = +(Q.get('ik') ?? 2.5);
  rec = { t: 0, frame: 0, events: [], screech: [], states: [], musicStart: 0, crashAt };
  document.querySelector('.back').style.display = 'none';
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    off: +(Q.get('off') || 10),
    bot: true,
    plan: k => (k >= crashAt ? -16 : insane.has(k) ? ik : great.has(k) ? 20 : 6 + pr() * 6),
  });
  run.tutorial = false;
  mode = 'play';
  best = 0;
  bestCorners = 0;
  rec.states.push({ t: 0, ...musicState() });
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.corners, streak: run.streak };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('40px "Russo One"').then(() => (window.__recReady = true));
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
  document.fonts.load('40px "Russo One"').finally(() => requestAnimationFrame(loop));
}
