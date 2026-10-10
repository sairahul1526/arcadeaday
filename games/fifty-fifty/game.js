import { Synth, Music, renderOffline, layerFor, dingNote, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/fifty-fifty';
const cvs = document.getElementById('game');
const g = cvs.getContext('2d');
const TAU = Math.PI * 2;
const FONT = '"Lilita One", system-ui, sans-serif';

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
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('ffy_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('ffy_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const FRUITS = {
  apple: { rx: 1, ry: 0.94, skin: '#e8293b', skin2: '#8f0f1f', hi: '#ff9a9a', flesh: '#fff3d4', flesh2: '#f2d993', rind: '#d81e30', juice: '#fff0c0', kind: 'apple' },
  orange: { rx: 1, ry: 1, skin: '#ff9a1f', skin2: '#c85a00', hi: '#ffd690', flesh: '#ffb340', flesh2: '#ff8a12', rind: '#ff8f12', pith: '#fff1d8', juice: '#ffad33', kind: 'citrus' },
  lemon: { rx: 1.12, ry: 0.84, skin: '#ffe03a', skin2: '#c9a400', hi: '#fff8c0', flesh: '#fff27a', flesh2: '#f2d43a', rind: '#f5cf1a', pith: '#fffbe2', juice: '#fff27a', kind: 'citrus', tips: true },
  lime: { rx: 0.92, ry: 0.88, skin: '#6fcf2e', skin2: '#2f7f0c', hi: '#cdf79a', flesh: '#c9f27a', flesh2: '#98d846', rind: '#5cb823', pith: '#f2ffdc', juice: '#b8f060', kind: 'citrus' },
  melon: { rx: 1.32, ry: 1.0, skin: '#38a845', skin2: '#145a1c', hi: '#8ee08a', flesh: '#ff3d5e', flesh2: '#e01f45', rind: '#1c6a26', pith: '#eaffdc', juice: '#ff4d6a', kind: 'melon' },
  kiwi: { rx: 0.98, ry: 0.82, skin: '#9a6633', skin2: '#4e3013', hi: '#d0a070', flesh: '#93d84f', flesh2: '#6cb22c', rind: '#6b4420', juice: '#9be05a', kind: 'kiwi' },
  peach: { rx: 1, ry: 0.98, skin: '#ffa36b', skin2: '#d84a36', hi: '#ffe4c0', flesh: '#ffd07a', flesh2: '#ffad45', rind: '#ff8a5a', juice: '#ffc070', kind: 'stone', pit: '#8a3b1e' },
  plum: { rx: 0.9, ry: 0.92, skin: '#8a36b4', skin2: '#3e0f5a', hi: '#d29aec', flesh: '#ffcf3a', flesh2: '#f5a020', rind: '#7a2fa0', juice: '#ffc23a', kind: 'stone', pit: '#7a3a10' },
  coconut: { rx: 1, ry: 0.96, skin: '#7f4e28', skin2: '#3a200c', hi: '#b8844f', flesh: '#fffaf0', flesh2: '#ebe2d0', rind: '#5a3416', juice: '#ffffff', kind: 'coconut' },
  dragon: { rx: 1.08, ry: 0.92, skin: '#ff3f9c', skin2: '#a80e58', hi: '#ffa6d2', flesh: '#fdfdfd', flesh2: '#ece6ee', rind: '#ff3f9c', juice: '#ff7ab8', kind: 'dragon' },
  gold: { rx: 1, ry: 0.94, skin: '#ffd23e', skin2: '#b07c06', hi: '#fff8d0', flesh: '#fff3b0', flesh2: '#ffd95a', rind: '#ffbf1a', juice: '#ffe680', kind: 'apple', golden: true },
};
const ALL = ['apple', 'orange', 'lemon', 'lime', 'melon', 'kiwi', 'peach', 'plum', 'coconut', 'dragon'];
const ZONES = [
  { name: 'FARMERS MARKET', w1: '#e3ad6b', w2: '#d39b59', grain: '#b07338', light: '#fff2d0', pool: ['apple', 'orange', 'peach', 'melon'] },
  { name: 'CITRUS GROVE', w1: '#eec36e', w2: '#ddab50', grain: '#b8852c', light: '#fffbd0', pool: ['orange', 'lemon', 'lime', 'apple', 'melon'] },
  { name: 'TROPICAL BEACH', w1: '#d7a36e', w2: '#c48d56', grain: '#9f6a38', light: '#d8fff4', pool: ['coconut', 'melon', 'kiwi', 'lime', 'dragon'] },
  { name: 'SUNSET DOJO', w1: '#bb6a40', w2: '#a65732', grain: '#7a361a', light: '#ffc29a', pool: ['peach', 'plum', 'apple', 'orange', 'kiwi', 'melon'] },
  { name: 'NIGHT MARKET', w1: '#62402e', w2: '#523425', grain: '#382015', light: '#ff9ae0', pool: ['dragon', 'plum', 'kiwi', 'lemon', 'coconut', 'melon'] },
  { name: 'MOONLIGHT', w1: '#3e3d5c', w2: '#34324d', grain: '#22203a', light: '#a8c8ff', pool: ALL },
];

export const BLADES = [
  { id: 'classic', name: 'CLASSIC', col: '#ffffff', price: 0 },
  { id: 'mint', name: 'MINT', col: '#3effc1', price: 60 },
  { id: 'flame', name: 'FLAME', col: '#ff7a1a', price: 120, fx: 'ember' },
  { id: 'ice', name: 'ICE', col: '#9ff0ff', price: 200, fx: 'spark' },
  { id: 'toxic', name: 'TOXIC', col: '#a6ff2e', price: 320 },
  { id: 'sakura', name: 'SAKURA', col: '#ff9ad5', price: 480, fx: 'petal' },
  { id: 'gold', name: 'GOLD', col: '#ffd23e', price: 800, fx: 'spark' },
  { id: 'rainbow', name: 'RAINBOW', col: 'rainbow', price: 1500, fx: 'spark' },
];

// ---------------------------------------------------------------- tuning
const tApex = n => lerp(1.2, 0.84, clamp(n / 60, 0, 1)); // seconds from toss to apex
const tossGap = n => lerp(1.7, 0.95, clamp(n / 50, 0, 1));
const radAt = n => lerp(64, 46, clamp(n / 70, 0, 1));
const bombP = n => (n < 9 ? 0 : Math.min(0.42, 0.15 + (n - 9) * 0.007));
const bpmAt = n => Math.min(128, 106 + n * 0.35);
const SNAP = 0.018; // centre assist, in fruit radii
const GRAZE = 6; // slivers smaller than this % don't count as a cut
const BOMB_HIT = 0.78; // bomb hitbox, fraction of its drawn radius
const MAX_STRIKES = 3;

// The smaller piece's share, rounded, decides the grade. 50 means a true 50/50.
function grade(small) {
  if (small >= 50) return { tier: 'PERFECT!', pts: 10, col: [255, 214, 64], streak: true, perfect: true };
  if (small >= 48) return { tier: 'SO CLOSE!', pts: 5, col: [110, 255, 170], streak: true };
  if (small >= 45) return { tier: 'GREAT', pts: 5, col: [110, 255, 170], streak: true };
  if (small >= 40) return { tier: 'GOOD', pts: 3, col: [130, 215, 255], streak: true };
  if (small >= 25) return { tier: 'OK', pts: 1, col: [240, 236, 228], streak: false };
  return { tier: 'LOPSIDED!', pts: 0, col: [255, 76, 90], strike: true };
}
const multFor = s => Math.min(4, 1 + Math.floor(s / 5));

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, U = 1, K = 1;
let mode = 'title';
let run = null;
let shake = 0;
let flash = 0, flashCol = [255, 255, 255];
let tReal = 0;
let audio = null;
let music = null;
let fuseG = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['classic']);
let bladeId = store.get('blade', 'classic');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let rec = null; // record-mode log
let boards = { cur: null, old: null, fade: 1, zone: -1 };
let shakeX = 0, shakeY = 0;
const blade = { down: false, ignore: false, queue: [], trail: [], lastSwoosh: -1, stroke: 0, lx: 0, ly: 0, lt: 0 };
const clock = { next: 0, step: 0, last: 0 };
let beatPhase = 0, pulse = 0;

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
  K = OG ? 1.7 : Math.min(SW / 400, SH / 720);
  boards = { cur: null, old: null, fade: 1, zone: -1 };
}

// ---------------------------------------------------------------- wooden board
function buildBoard(z) {
  const Z = ZONES[z % ZONES.length];
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(SW * DPR));
  c.height = Math.max(1, Math.round(SH * DPR));
  const b = c.getContext('2d');
  b.setTransform(DPR, 0, 0, DPR, 0, 0);
  const r = rng(91 + z * 7);
  const pw = Math.max(70 * U, SW / 6);
  const n = Math.ceil(SW / pw) + 1;
  const x0 = (SW - n * pw) / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pw;
    const base = hexRgb(i % 2 ? Z.w1 : Z.w2).map(v => v * (0.94 + r() * 0.1));
    b.fillStyle = css(base);
    b.fillRect(x, 0, pw, SH);
    // grain
    b.strokeStyle = css(hexRgb(Z.grain), 0.28);
    for (let j = 0; j < 9; j++) {
      const gx = x + pw * (0.08 + r() * 0.84), amp = 3 + r() * 7, fr = 0.004 + r() * 0.01, ph = r() * TAU;
      b.lineWidth = (0.8 + r() * 1.6) * U;
      b.beginPath();
      for (let y = -10; y <= SH + 10; y += 12) {
        const xx = gx + Math.sin(y * fr + ph) * amp;
        y < 0 ? b.moveTo(xx, y) : b.lineTo(xx, y);
      }
      b.stroke();
    }
    // a knot now and then
    if (r() < 0.6) {
      const kx = x + pw * (0.3 + r() * 0.4), ky = SH * r();
      for (let q = 0; q < 4; q++) {
        b.strokeStyle = css(hexRgb(Z.grain), 0.35 - q * 0.06);
        b.lineWidth = 1.4 * U;
        b.beginPath();
        b.ellipse(kx, ky, (5 + q * 5) * U, (12 + q * 9) * U, 0, 0, TAU);
        b.stroke();
      }
    }
    // plank gap + bevel
    b.fillStyle = 'rgba(30,12,4,0.45)';
    b.fillRect(x - 1.5 * U, 0, 3 * U, SH);
    b.fillStyle = 'rgba(255,255,255,0.08)';
    b.fillRect(x + 1.5 * U, 0, 2 * U, SH);
  }
  // warm light from above + vignette
  const lg = b.createRadialGradient(SW / 2, SH * 0.25, 0, SW / 2, SH * 0.25, Math.max(SW, SH) * 0.75);
  lg.addColorStop(0, css(hexRgb(Z.light), 0.28));
  lg.addColorStop(1, css(hexRgb(Z.light), 0));
  b.fillStyle = lg;
  b.fillRect(0, 0, SW, SH);
  const vg = b.createRadialGradient(SW / 2, SH * 0.5, Math.min(SW, SH) * 0.3, SW / 2, SH * 0.5, Math.max(SW, SH) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,3,0,0.55)');
  b.fillStyle = vg;
  b.fillRect(0, 0, SW, SH);
  return c;
}
function setZoneBoard(z) {
  if (boards.zone === z && boards.cur) return;
  boards.old = boards.cur;
  boards.cur = buildBoard(z);
  boards.fade = boards.old ? 0 : 1;
  boards.zone = z;
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const r = {
    seed,
    rnd: rng(seed),
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    off: opts.off ?? 0,
    score: 0,
    cuts: 0,
    strikes: 0,
    streak: 0,
    maxStreak: 0,
    perfects: 0,
    perfectFx: null,
    bestSplit: 0,
    tossN: opts.off ?? 0,
    tossT: opts.first ?? 0.6,
    pending: [],
    fruits: [],
    halves: [],
    parts: [],
    splats: [],
    pops: [],
    booms: [],
    swipe: null,
    botWait: 0,
    dead: false,
    deadT: 0,
    deathBy: null,
    lastReason: '',
    t: 0,
    slow: 1,
    slowT: 0,
    zone: 0,
    layer: 1,
    coinsGot: 0,
    goldens: 0,
    passedBest: false,
    banner: null,
    scoreBump: 0,
    tutorial: !opts.bot && plays < 2,
    tutLeft: !opts.bot && plays < 2 ? 3 : 0,
    tutMsg: null,
    bombTip: !opts.bot && plays < 4,
    strokeCuts: { id: -1, n: 0, t: 0 },
    crashArmed: false,
  };
  setZoneBoard(0);
  return r;
}

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
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
      fuseG = audio.fuse();
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
  const z = r ? r.zone : 0;
  let layer = r ? r.layer : 3;
  if (mode === 'title') layer = 3;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(r ? r.tossN : 0) };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- geometry
// Fruit-local "unit" space: the fruit's ellipse becomes the unit circle, so a cut
// line's distance from the centre gives the exact area split (affine maps keep ratios).
function toLocal(f, x, y) {
  const dx = x - f.x, dy = y - f.y;
  const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
  return { x: (dx * c - dy * s) / f.rx, y: (dx * s + dy * c) / f.ry };
}
function fromLocal(f, p) {
  const lx = p.x * f.rx, ly = p.y * f.ry;
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  return { x: f.x + lx * c - ly * s, y: f.y + lx * s + ly * c };
}
function segCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (a.x * dx + a.y * dy);
  const C = a.x * a.x + a.y * a.y - 1;
  const inA = C < 0, inB = b.x * b.x + b.y * b.y < 1;
  if (A < 1e-9) return { inA, inB, t1: NaN, t2: NaN };
  const disc = B * B - 4 * A * C;
  if (disc < 0) return { inA, inB, t1: NaN, t2: NaN };
  const sq = Math.sqrt(disc);
  return { inA, inB, t1: (-B - sq) / (2 * A), t2: (-B + sq) / (2 * A) };
}
const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
// Share of a unit circle on the small side of a chord at distance d from the centre.
const smallShare = d => {
  d = clamp(d, 0, 1);
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
};

// ---------------------------------------------------------------- spawning
function playCol() {
  const half = Math.min(SW * 0.5 - 70 * K, 250 * K);
  return { cx: SW / 2, half: Math.max(60 * K, half) };
}
function spawnThing(r, opts) {
  const n = r.tossN;
  const { cx, half } = playCol();
  const isBomb = !!opts.bomb;
  const key = isBomb ? null : opts.key || pickFruit(r);
  const def = isBomb ? null : FRUITS[key];
  const R = radAt(n) * K * (isBomb ? 0.82 : key === 'melon' ? 1.08 : 1);
  const rx = isBomb ? R : R * def.rx, ry = isBomb ? R : R * def.ry;
  const x0 = opts.x0 ?? cx + (r.rnd() * 2 - 1) * half * 0.85;
  const x1 = opts.x1 ?? cx + (r.rnd() * 2 - 1) * half * 0.85;
  const T = (opts.T ?? tApex(n)) * (0.92 + r.rnd() * 0.16);
  const topY = (REC ? 0.3 : r.attract ? 0.45 : 0.2) * SH + ry;
  const yA = opts.yA ?? lerp(topY, SH * 0.48, r.rnd());
  const y0 = SH + ry + 10 * K;
  const G = (2 * (y0 - yA)) / (T * T);
  const f = {
    key,
    def,
    bomb: isBomb,
    golden: !!(def && def.golden),
    x: x0,
    y: y0,
    vx: (x1 - x0) / (2 * T),
    vy: -G * T,
    G,
    rot: (r.rnd() - 0.5) * 0.6,
    vr: (r.rnd() - 0.5) * 2.4,
    R,
    rx,
    ry,
    last: null,
    entry: null,
    born: r.t,
    tut: r.tutLeft > 0 && !isBomb,
  };
  r.fruits.push(f);
  if (!isBomb) sfx('toss');
  return f;
}
function pickFruit(r) {
  if (r.tossN > 5 && r.rnd() < 0.045) return 'gold';
  const pool = ZONES[r.zone % ZONES.length].pool;
  return pool[(r.rnd() * pool.length) | 0];
}
function toss(r) {
  const n = r.tossN++;
  const rr = r.rnd();
  let count = n < 6 ? 1 : n < 16 ? (rr < 0.35 ? 2 : 1) : n < 35 ? 1 + ((rr * 2.6) | 0) : 2 + ((rr * 2.2) | 0);
  if (r.tutLeft > 0) count = 1;
  const t0 = r.t;
  if (REC && r.plan && r.cuts >= rec.crashAt && !r.crashArmed) {
    // The planned crash: a fruit with a bomb tucked right behind it.
    r.crashArmed = true;
    const { cx } = playCol();
    const side = r.rnd() < 0.5 ? -1 : 1;
    const yA = SH * 0.42;
    r.pending.push({ t: t0, o: { x0: cx - side * 120 * K, x1: cx - side * 60 * K, yA, T: 1.05, key: 'melon' } });
    r.pending.push({ t: t0, o: { bomb: true, x0: cx + side * 90 * K, x1: cx + side * 150 * K, yA: yA + 10 * K, T: 1.05 } });
    return;
  }
  const { cx, half } = playCol();
  const flip = r.rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    // fruits in one toss get their own lanes so they never stack on each other
    const lane = count === 1 ? (r.rnd() * 2 - 1) * 0.85 : flip * (((i + 0.5) / count) * 2 - 1) * 0.85;
    const x0 = cx + (lane + (r.rnd() - 0.5) * 0.2) * half;
    const x1 = cx + (lane * 0.7 + (r.rnd() - 0.5) * 0.3) * half;
    r.pending.push({ t: t0 + i * 0.22, o: { x0, x1, T: r.tutLeft > 0 ? 1.35 : undefined } });
  }
  if (r.tutLeft <= 0 && r.rnd() < bombP(n) && !(REC && r.plan)) r.pending.push({ t: t0 + r.rnd() * 0.4, o: { bomb: true } });
}

// ---------------------------------------------------------------- update
function update(dt) {
  tReal += dt;
  const r = run;
  if (boards.fade < 1) boards.fade = Math.min(1, boards.fade + dt * 1.2);
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
  // Tutorial: time crawls while the first fruit hangs in the air.
  let tutSlow = 1;
  if (r.tutorial && !r.dead && r.cuts === 0) {
    const f = r.fruits.find(f => !f.bomb);
    if (f && f.vy > -f.G * 0.35 && f.y < SH * 0.7) tutSlow = 0.22;
  }
  const wdt = dt * r.slow * tutSlow;
  r.t += wdt;

  if (!r.dead && (mode === 'play' || r.attract || REC)) {
    r.tossT -= wdt;
    const live = r.fruits.filter(f => !f.bomb).length;
    if (r.tossT <= 0 && live <= (r.tossN < 20 ? 1 : 2) && !(REC && r.crashArmed)) {
      toss(r);
      r.tossT = tossGap(r.tossN);
    }
    for (const p of r.pending) if (p.t <= r.t) spawnThing(r, p.o);
    r.pending = r.pending.filter(p => p.t > r.t);
  }

  // physics
  for (const f of r.fruits) {
    f.vy += f.G * wdt;
    f.x += f.vx * wdt;
    f.y += f.vy * wdt;
    f.rot += f.vr * wdt;
  }
  if (r.bot && !r.dead) botControl(r, wdt);
  if (!r.dead) processBlade(r);
  else blade.queue.length = 0;

  // fell off the bottom
  for (const f of r.fruits) {
    if (f.vy > 0 && f.y - f.ry > SH + 4) {
      f.gone = true;
      if (!f.bomb && !r.dead) strike(r, 'MISSED', f.x, SH - 90 * U, f);
    }
  }
  r.fruits = r.fruits.filter(f => !f.gone);

  for (const h of r.halves) {
    h.vy += h.G * wdt;
    h.x += h.vx * wdt;
    h.y += h.vy * wdt;
    h.rot += h.vr * wdt;
    h.t += wdt;
  }
  r.halves = r.halves.filter(h => h.y - h.R < SH + 40 * K && h.t < 6);
  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.vy += (p.g ?? 900 * K) * wdt;
    p.vx *= p.drag ?? 0.99;
    if (p.spin) p.a += p.spin * wdt;
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const s of r.splats) s.t += dt;
  r.splats = r.splats.filter(s => s.t < 4.5);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.perfectFx && (r.perfectFx.t += dt) > 1.6) r.perfectFx = null;
  for (const b of r.booms) b.t += dt;
  r.booms = r.booms.filter(b => b.t < 1.2);
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.4) r.banner = null;
  }
  if (r.tutMsg) {
    r.tutMsg.t += dt;
    if (r.tutMsg.t > 3) r.tutMsg = null;
  }

  if (r.dead) {
    r.deadT += dt;
    if (r.attract && r.deadT > 1.6) run = newRun({ bot: true, attract: true });
    else if (!r.attract && mode === 'play' && r.deadT > (r.deathBy === 'bomb' ? 1.5 : 1.1)) gameOver(r);
  }
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-5 * dt);
  r.scoreBump *= Math.exp(-9 * dt);
  if (mode === 'over') overT += dt;

  // audio: the fuse hisses while a bomb is in the air
  const bombs = r.dead ? 0 : r.fruits.filter(f => f.bomb && f.y < SH).length;
  const fz = mode === 'title' || r.attract ? 0 : Math.min(1, bombs) * 0.05;
  if (REC && rec) {
    if (rec.frame % 2 === 0) rec.fuse.push([rec.t, fz]);
  } else if (audio && soundOn) {
    fuseG.gain.setTargetAtTime(fz, audio.ctx.currentTime, 0.05);
    music.tick(musicState());
  }
}

// ---------------------------------------------------------------- blade
function bladeSample(x, y, kind) {
  blade.queue.push({ x, y, kind });
  if (kind === 'start') blade.trail.push({ brk: true });
  if (kind !== 'end') blade.trail.push({ x, y, t: tReal });
  else blade.trail.push({ brk: true });
}
function processBlade(r) {
  for (const s of blade.queue) {
    if (s.kind === 'start') {
      blade.stroke++;
      for (const f of r.fruits) f.last = f.entry = null;
      blade.lx = s.x;
      blade.ly = s.y;
      blade.lt = r.t;
    }
    if (s.kind === 'end') {
      for (const f of r.fruits) f.last = f.entry = null;
      continue;
    }
    // swoosh + blade fx
    const dist = Math.hypot(s.x - blade.lx, s.y - blade.ly);
    if (dist > 26 * K && tReal - blade.lastSwoosh > 0.2) {
      blade.lastSwoosh = tReal;
      if (!r.attract) sfx('swoosh', { v: Math.min(1.3, dist / (60 * K)) });
    }
    if (dist > 4 * K) bladeFx(r, s.x, s.y, s.x - blade.lx, s.y - blade.ly);
    blade.lx = s.x;
    blade.ly = s.y;
    for (const f of r.fruits) {
      if (f.cut || r.dead) continue;
      const L = toLocal(f, s.x, s.y);
      if (f.bomb) {
        const sc = { x: L.x / BOMB_HIT, y: L.y / BOMB_HIT };
        if (f.last) {
          const h = segCircle(f.last, sc);
          if (h.inA || h.inB || (h.t1 >= 0 && h.t1 <= 1)) {
            explode(r, f);
            break;
          }
        }
        f.last = sc;
        continue;
      }
      if (f.last) {
        const h = segCircle(f.last, L);
        if (!h.inA && !h.inB) {
          if (h.t1 >= 0 && h.t1 <= 1) cutFruit(r, f, at(f.last, L, h.t1), at(f.last, L, h.t2));
        } else if (!h.inA && h.inB) f.entry = at(f.last, L, h.t1);
        else if (h.inA && !h.inB && f.entry) cutFruit(r, f, f.entry, at(f.last, L, h.t2));
      }
      f.last = L;
    }
    r.fruits = r.fruits.filter(f => !f.cut);
  }
  blade.queue.length = 0;
}
function bladeFx(r, x, y, dx, dy) {
  const b = currentBlade(r);
  if (!b.fx || r.rnd() > 0.6) return;
  const m = Math.hypot(dx, dy) || 1;
  if (b.fx === 'ember') r.parts.push({ kind: 'dot', x, y, vx: (r.rnd() - 0.5) * 120 * K, vy: -(40 + r.rnd() * 90) * K, g: -60 * K, life: 0.5, max: 0.5, size: (2 + r.rnd() * 3) * K, col: r.rnd() < 0.5 ? [255, 140, 30] : [255, 220, 80] });
  else if (b.fx === 'petal') r.parts.push({ kind: 'petal', x, y, vx: (-dy / m) * 60 * K + (r.rnd() - 0.5) * 60 * K, vy: (dx / m) * 60 * K, g: 120 * K, drag: 0.97, life: 1.1, max: 1.1, size: (4 + r.rnd() * 3) * K, a: r.rnd() * TAU, spin: (r.rnd() - 0.5) * 8, col: [255, 170, 215] });
  else r.parts.push({ kind: 'spark', x, y, vx: (r.rnd() - 0.5) * 160 * K, vy: (r.rnd() - 0.5) * 160 * K, g: 0, drag: 0.92, life: 0.35, max: 0.35, size: (2 + r.rnd() * 2) * K, col: b.col === 'rainbow' ? hslRgb((tReal * 300) % 360, 1, 0.65) : hexRgb(b.col) });
}

function cutFruit(r, f, E, X) {
  f.cut = true;
  const len = Math.hypot(X.x - E.x, X.y - E.y) || 1e-6;
  // Centre assist: the cut line slides SNAP toward the middle (about 2px on a phone),
  // so a true 50|50 is a skill shot, not a sub-pixel lottery. The halves use the moved line.
  {
    const nx = -(X.y - E.y) / len, ny = (X.x - E.x) / len;
    const c0 = nx * E.x + ny * E.y;
    const shift = Math.sign(c0) * Math.max(0, Math.abs(c0) - SNAP) - c0;
    E = { x: E.x + nx * shift, y: E.y + ny * shift };
    X = { x: X.x + nx * shift, y: X.y + ny * shift };
  }
  const d = Math.abs(E.x * X.y - E.y * X.x) / len;
  const share = smallShare(d);
  const small = Math.round(share * 100);
  if (small < GRAZE) {
    // a nick, not a cut: the fruit wobbles on
    f.cut = false;
    f.entry = null;
    f.vr += (r.rnd() < 0.5 ? -1 : 1) * 4;
    const jc = hexRgb(f.def.juice);
    for (let i = 0; i < 5; i++) r.parts.push({ kind: 'drop', x: f.x, y: f.y - f.ry * 0.5, vx: (r.rnd() - 0.5) * 200 * K, vy: -r.rnd() * 200 * K, life: 0.5, max: 0.5, size: 3 * K, col: jc });
    return;
  }
  const big = 100 - small;
  const gr = grade(small);

  // the two halves, in the fruit's own (rotated, unscaled) frame
  const e = { x: E.x * f.rx, y: E.y * f.ry }, x = { x: X.x * f.rx, y: X.y * f.ry };
  let dx = x.x - e.x, dy = x.y - e.y;
  const m = Math.hypot(dx, dy) || 1;
  dx /= m;
  dy /= m;
  const n = { x: -dy, y: dx };
  const c = n.x * e.x + n.y * e.y;
  const centerSide = -c >= 0 ? 1 : -1;
  const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
  const nW = { x: n.x * cs - n.y * sn, y: n.x * sn + n.y * cs };
  const sep = (85 + r.rnd() * 30) * K;
  for (const s of [1, -1]) {
    const isBig = s === centerSide;
    r.halves.push({
      def: f.def,
      golden: f.golden,
      x: f.x + nW.x * s * 3 * K,
      y: f.y + nW.y * s * 3 * K,
      vx: f.vx * 0.6 + nW.x * s * sep,
      vy: Math.min(f.vy, 0) * 0.25 + nW.y * s * sep - 260 * K,
      G: 950 * K,
      rot: f.rot,
      vr: f.vr + s * (1.2 + r.rnd() * 1.6),
      n,
      c,
      s,
      rx: f.rx,
      ry: f.ry,
      R: Math.max(f.rx, f.ry),
      pct: isBig ? big : small,
      t: 0,
      col: gr.col,
      perfect: !!gr.perfect,
      bad: !!gr.strike,
    });
  }
  // juice
  const jc = hexRgb(f.def.juice);
  const dir = { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
  for (let i = 0; i < 18; i++) {
    const u = (r.rnd() - 0.5) * 1.6;
    const px = f.x + dir.x * u * f.rx, py = f.y + dir.y * u * f.ry;
    const a = r.rnd() * TAU, sp = (80 + r.rnd() * 300) * K;
    r.parts.push({ kind: 'drop', x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * K, life: 0.7 + r.rnd() * 0.4, max: 1.1, size: (3 + r.rnd() * 5) * K, col: jc });
  }
  r.splats.push({ x: f.x, y: f.y, R: f.R * (0.85 + r.rnd() * 0.3), col: jc, seed: (r.rnd() * 1e6) | 0, t: 0 });
  if (r.splats.length > 10) r.splats.shift();

  r.cuts++;
  r.bestSplit = Math.max(r.bestSplit, small);
  // one swipe through several fruits
  let combo = 0;
  if (r.strokeCuts.id === blade.stroke && r.t - r.strokeCuts.t < 0.35) combo = ++r.strokeCuts.n;
  else r.strokeCuts = { id: blade.stroke, n: 0, t: r.t };
  r.strokeCuts.t = r.t;

  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  // the next cut's callout takes over: let a lingering PERFECT start fading
  if (r.perfectFx && r.perfectFx.t > 0.5) r.perfectFx.t = Math.max(r.perfectFx.t, 1.25);
  if (gr.strike) {
    r.streak = 0;
    sfx('slice', { m: 60 });
    pop(r, gr.tier, small + ' | ' + big, f.x, f.y - f.ry, gr.col, 1, 0, f.y + f.ry + 90 * U);
    strike(r, 'LOPSIDED', f.x, f.y, f, true);
  } else {
    r.streak = gr.streak ? r.streak + 1 : 0;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
    const mult = multFor(r.streak);
    let pts = gr.pts * mult + combo * 2;
    if (f.golden) pts *= 2;
    r.score += pts;
    r.scoreBump = 1;
    sfx('slice', { m: 60 + small * 0.5 });
    if (gr.streak) sfx('ding', { m: dingNote(root, r.streak - 1), big: small >= 48 });
    if (gr.perfect) {
      // the big centre callout carries the points; a second pop would collide with it
      for (const p of r.pops) p.t = Math.max(p.t, p.dur * 0.72);
      r.perfectFx = { t: 0, n: r.perfects + 1, pts: '+' + pts + (mult > 1 ? '  ×' + mult : '') };
    } else pop(r, gr.tier, '+' + pts + (mult > 1 ? '  ×' + mult : ''), f.x, f.y - f.ry, gr.col, small >= 45 ? 1.05 : 0.85, 0, f.y + f.ry + 90 * U);
    if (combo) pop(r, combo === 1 ? 'DOUBLE!' : combo === 2 ? 'TRIPLE!' : 'COMBO ×' + (combo + 1), '+' + combo * 2, f.x, f.y - f.ry - 70 * U, [255, 255, 255], 0.9, 0.12, f.y + f.ry + 160 * U);
    if (gr.perfect) {
      r.perfects++;
      r.slow = 0.2;
      r.slowT = 0.5;
      flash = 0.45;
      flashCol = [255, 230, 140];
      shake = 0.35;
      sfx('perfect', { root });
      vibrate([20, 30, 40]);
      for (let i = 0; i < 40; i++) {
        const a = r.rnd() * TAU, sp = (150 + r.rnd() * 500) * K;
        r.parts.push({ kind: 'conf', x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200 * K, g: 700 * K, drag: 0.97, life: 1.4, max: 1.4, size: (5 + r.rnd() * 5) * K, a: r.rnd() * TAU, spin: (r.rnd() - 0.5) * 14, col: hslRgb(r.rnd() * 360, 0.95, 0.62) });
      }
      r.parts.push({ kind: 'ring', x: f.x, y: f.y, vx: 0, vy: 0, g: 0, life: 0.6, max: 0.6, size: f.R, col: [255, 214, 64] });
    } else if (small >= 48) {
      vibrate(15);
      r.parts.push({ kind: 'ring', x: f.x, y: f.y, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45, size: f.R, col: gr.col });
    } else vibrate(8);
    if (f.golden) {
      r.goldens++;
      r.coinsGot += 5;
      sfx('coin');
      pop(r, '+5 ◆', '', f.x, f.y + f.ry + 60 * U, [255, 214, 80], 0.8, 0.1);
    }
  }
  if (f.tut) r.tutLeft--;
  if (r.tutorial && r.cuts === 1) r.tutMsg = { text: small + ' | ' + big + (small >= 45 ? ' — nice!' : ''), sub: 'the closer to 50 | 50, the more points', t: 0 };
  r.layer = Math.max(Math.min(1 + r.zone, 3), layerFor(r.streak));
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });

  const z = Math.floor(r.cuts / 15);
  if (z !== r.zone) {
    r.zone = z;
    setZoneBoard(z);
    r.banner = { text: 'ZONE ' + (z + 1), sub: ZONES[z % ZONES.length].name, t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep slicing', t: 0 };
    sfx('best', { root });
  }
}

function pop(r, text, sub, x, y, col, size = 1, delay = 0, alt = null) {
  // one callout at a time: older ones get out of the way fast
  for (const p of r.pops) if (p.t > 0.15) p.t = Math.max(p.t, p.dur * 0.72);
  r.pops.push({ text, sub, x, y, col, size, t: -delay, dur: 1.05, alt });
}

function strike(r, reason, x, y, f, fromCut) {
  if (r.attract || r.dead) return;
  if (f && f.tut) {
    if (!fromCut) f.tut = false;
    r.tutLeft = Math.max(0, r.tutLeft - 1);
    if (!fromCut) pop(r, 'MISSED', 'try again: swipe through it', x, y, [255, 255, 255], 0.8);
    return;
  }
  r.strikes++;
  r.streak = 0;
  r.layer = Math.max(Math.min(1 + r.zone, 3), 0);
  r.lastReason = reason;
  if (!fromCut) pop(r, 'MISSED!', '', x, y, [255, 76, 90], 0.9);
  sfx(fromCut ? 'strike' : 'miss');
  shake = Math.max(shake, 0.4);
  flash = 0.18;
  flashCol = [255, 60, 60];
  vibrate(50);
  if (r.strikes >= MAX_STRIKES) die(r, 'strikes');
}

function explode(r, f) {
  f.cut = true;
  if (!r.attract) sfx('boom');
  r.booms.push({ x: f.x, y: f.y, R: f.R, t: 0 });
  for (let i = 0; i < 46; i++) {
    const a = r.rnd() * TAU, sp = (200 + r.rnd() * 900) * K;
    r.parts.push({ kind: i % 3 ? 'spark' : 'dot', x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 400 * K, drag: 0.95, life: 0.6 + r.rnd() * 0.6, max: 1.2, size: (3 + r.rnd() * 6) * K, col: i % 3 ? [255, 200 - (i % 5) * 30, 60] : [40, 30, 30] });
  }
  flash = 1;
  flashCol = [255, 255, 255];
  shake = 1.6;
  vibrate([80, 40, 140]);
  die(r, 'bomb');
}

function die(r, by) {
  r.dead = true;
  r.deadT = 0;
  r.deathBy = by;
  r.slow = 0.35;
  r.slowT = 0.7;
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
}

// ---------------------------------------------------------------- bot (attract + record)
function botControl(r, dt) {
  const sw = r.swipe;
  if (sw) {
    if (sw.started) sw.u += dt / sw.dur; // the first sample sits at the very start, outside the fruit
    const u = Math.min(1, sw.u);
    if (sw.crash) {
      const b = sw.bomb;
      const p = { x: lerp(sw.A.x, sw.B.x, u) + (b.x - sw.bx), y: lerp(sw.A.y, sw.B.y, u) + (b.y - sw.by) };
      bladeSample(p.x, p.y, sw.started ? 'move' : 'start');
    } else {
      const p = fromLocal(sw.f, { x: sw.n.x * sw.d + sw.dir.x * lerp(-1.35, 1.35, u), y: sw.n.y * sw.d + sw.dir.y * lerp(-1.35, 1.35, u) });
      bladeSample(p.x, p.y, sw.started ? 'move' : 'start');
    }
    sw.started = true;
    if (sw.u >= 1) {
      bladeSample(0, 0, 'end');
      r.swipe = null;
      r.botWait = 0.06 + r.rnd() * 0.08;
    }
    return;
  }
  if (r.botWait > 0) {
    r.botWait -= dt;
    return;
  }
  const ready = r.fruits.filter(f => !f.bomb && !f.cut && f.vy > -f.G * 0.16 && f.y < SH * 0.75 && f.y > SH * 0.12);
  if (!ready.length) return;
  ready.sort((a, b) => b.y - a.y);
  const f = ready[0];
  const k = r.cuts;
  let d = 0.04 + r.rnd() * 0.08;
  if (r.plan) {
    const p = r.plan(k);
    if (p === 'bomb') {
      const b = r.fruits.find(q => q.bomb);
      if (b) {
        const vx = b.x - f.x, vy = b.y - f.y, m = Math.hypot(vx, vy) || 1;
        const A = { x: f.x - (vx / m) * f.R * 1.8, y: f.y - (vy / m) * f.R * 1.8 + 30 * K };
        const B = { x: b.x + (vx / m) * b.R * 1.8, y: b.y + (vy / m) * b.R * 1.8 - 30 * K };
        r.swipe = { crash: true, bomb: b, bx: b.x, by: b.y, A, B, u: 0, dur: 0.16, started: false };
        return;
      }
    } else d = p;
  } else if (r.attract) {
    const x = r.rnd();
    d = x < 0.12 ? 0 : x < 0.6 ? 0.02 + r.rnd() * 0.06 : 0.08 + r.rnd() * 0.2;
  }
  // pick a slicing angle that keeps clear of bombs
  let best = null;
  for (let i = 0; i < 12; i++) {
    const ang = -Math.PI / 2 + (r.rnd() - 0.5) * 2.8;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const n = { x: -dir.y, y: dir.x };
    const A = fromLocal(f, { x: n.x * d - dir.x * 1.35, y: n.y * d - dir.y * 1.35 });
    const B = fromLocal(f, { x: n.x * d + dir.x * 1.35, y: n.y * d + dir.y * 1.35 });
    let clear = Infinity;
    for (const b of r.fruits) if (b !== f) clear = Math.min(clear, segDist(b, A, B) - b.R * (b.bomb ? 1.4 : 1.1));
    if (!best || clear > best.clear) best = { dir, n, clear };
    if (clear > 0) break;
  }
  r.swipe = { f, d, dir: best.dir, n: best.n, u: 0, dur: 0.11, started: false };
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

// ---------------------------------------------------------------- render
function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 22 * U;
  shakeY = (Math.random() - 0.5) * shake * 22 * U;
  if (OG) return drawOg();
  drawBoard();
  const r = run;
  if (!r) return;
  g.save();
  g.translate(shakeX, shakeY);
  drawSplats(r);
  for (const h of r.halves) drawHalf(h);
  for (const f of r.fruits) (f.bomb ? drawBomb : drawWholeAt)(f, r);
  drawBooms(r);
  drawParts(r);
  drawTutorialGuide(r);
  g.restore();
  drawBlade(r);
  drawLabels(r);
  drawPops(r);
  drawPerfect(r);
  if (flash > 0.01) {
    g.fillStyle = css(flashCol, flash * 0.8);
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

function drawBoard() {
  if (!boards.cur) setZoneBoard(run ? run.zone : 0);
  g.drawImage(boards.cur, 0, 0, SW, SH);
  if (boards.old && boards.fade < 1) {
    g.globalAlpha = 1 - boards.fade;
    g.drawImage(boards.old, 0, 0, SW, SH);
    g.globalAlpha = 1;
  }
}

function drawSplats(r) {
  for (const s of r.splats) {
    const a = s.t < 3 ? 0.5 : 0.5 * (1 - (s.t - 3) / 1.5);
    if (a <= 0) continue;
    const k = ease(s.t / 0.12);
    const rr = rng(s.seed);
    // every blob goes into one path so the overlaps don't stack into bubbles
    g.beginPath();
    g.arc(s.x, s.y, s.R * 0.5 * k, 0, TAU);
    for (let i = 0; i < 8; i++) {
      const an = rr() * TAU, dd = s.R * (0.45 + rr() * 0.6) * k, sz = s.R * (0.05 + rr() * 0.12);
      const x = s.x + Math.cos(an) * dd, y = s.y + Math.sin(an) * dd;
      g.moveTo(x + sz, y);
      g.arc(x, y, sz, 0, TAU);
    }
    for (let i = 0; i < 2; i++) {
      const dx = (rr() - 0.5) * s.R * 0.6, len = s.R * (0.5 + rr() * 0.7) * clamp(s.t / 2, 0, 1);
      const w = s.R * (0.05 + rr() * 0.04);
      g.rect(s.x + dx - w, s.y, w * 2, len);
      g.moveTo(s.x + dx + w * 1.3, s.y + len);
      g.arc(s.x + dx, s.y + len, w * 1.3, 0, TAU);
    }
    g.fillStyle = css(s.col.map(v => v * 0.85), a);
    g.fill('nonzero');
  }
}

function ell(x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

// deterministic sprinkle positions inside the unit disc
const SPRINKLE = (() => {
  const r = rng(1234);
  return Array.from({ length: 60 }, () => {
    const a = r() * TAU, d = Math.sqrt(r());
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: r() };
  });
})();

function drawSkin(def, rx, ry) {
  const kind = def.kind;
  if (def.tips) {
    g.fillStyle = def.skin2;
    ell(-rx * 0.98, 0, rx * 0.16, ry * 0.2);
    g.fill();
    ell(rx * 0.98, 0, rx * 0.16, ry * 0.2);
    g.fill();
  }
  if (kind === 'dragon') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3;
      const x = Math.cos(a) * rx * 0.95, y = Math.sin(a) * ry * 0.95;
      g.fillStyle = '#7ad04a';
      g.beginPath();
      g.moveTo(x - Math.sin(a) * rx * 0.14, y + Math.cos(a) * ry * 0.14);
      g.lineTo(x + Math.cos(a + 0.4) * rx * 0.32, y + Math.sin(a + 0.4) * ry * 0.32);
      g.lineTo(x + Math.sin(a) * rx * 0.14, y - Math.cos(a) * ry * 0.14);
      g.fill();
    }
  }
  ell(0, 0, rx, ry);
  const gr = g.createRadialGradient(-rx * 0.35, -ry * 0.4, 0, 0, 0, Math.max(rx, ry) * 1.05);
  gr.addColorStop(0, def.hi);
  gr.addColorStop(0.45, def.skin);
  gr.addColorStop(1, def.skin2);
  g.fillStyle = gr;
  g.fill();
  g.save();
  ell(0, 0, rx, ry);
  g.clip();
  if (kind === 'melon') {
    g.fillStyle = css(hexRgb(def.skin2), 0.75);
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      const x0 = i * rx * 0.32;
      for (let j = 0; j <= 12; j++) {
        const y = -ry + (j / 12) * ry * 2;
        const xx = x0 + Math.sin(j * 1.3 + i) * rx * 0.04 + x0 * (1 - Math.abs(y / ry)) * 0.12;
        j ? g.lineTo(xx - rx * 0.06, y) : g.moveTo(xx - rx * 0.06, y);
      }
      for (let j = 12; j >= 0; j--) {
        const y = -ry + (j / 12) * ry * 2;
        const xx = x0 + Math.sin(j * 1.3 + i) * rx * 0.04 + x0 * (1 - Math.abs(y / ry)) * 0.12;
        g.lineTo(xx + rx * 0.06, y);
      }
      g.fill();
    }
  } else if (kind === 'citrus' || kind === 'kiwi') {
    g.fillStyle = kind === 'kiwi' ? 'rgba(255,230,190,0.25)' : css(hexRgb(def.skin2), 0.25);
    for (let i = 0; i < 28; i++) {
      const p = SPRINKLE[i];
      ell(p.x * rx * 0.9, p.y * ry * 0.9, rx * 0.03, ry * 0.03);
      g.fill();
    }
  } else if (kind === 'stone') {
    const bl = g.createRadialGradient(rx * 0.4, ry * 0.2, 0, rx * 0.4, ry * 0.2, rx * 0.9);
    bl.addColorStop(0, css(hexRgb(def.skin2), 0.55));
    bl.addColorStop(1, css(hexRgb(def.skin2), 0));
    g.fillStyle = bl;
    g.fillRect(-rx, -ry, rx * 2, ry * 2);
    g.strokeStyle = css(hexRgb(def.skin2), 0.6);
    g.lineWidth = 2 * K;
    g.beginPath();
    g.moveTo(-rx * 0.05, -ry);
    g.quadraticCurveTo(-rx * 0.3, 0, -rx * 0.05, ry);
    g.stroke();
  } else if (kind === 'coconut') {
    g.strokeStyle = 'rgba(30,15,5,0.4)';
    g.lineWidth = 1.5 * K;
    for (let i = 0; i < 26; i++) {
      const p = SPRINKLE[i];
      g.beginPath();
      g.moveTo(p.x * rx, p.y * ry);
      g.lineTo(p.x * rx + rx * 0.12 * (p.s - 0.5), p.y * ry + ry * 0.14);
      g.stroke();
    }
    g.fillStyle = '#2a1608';
    for (const [x, y] of [[-0.18, -0.42], [0.18, -0.42], [0, -0.22]]) {
      ell(x * rx, y * ry, rx * 0.08, ry * 0.08);
      g.fill();
    }
  } else if (kind === 'dragon') {
    g.fillStyle = '#7ad04a';
    for (let i = 0; i < 7; i++) {
      const p = SPRINKLE[i * 3];
      g.beginPath();
      g.moveTo(p.x * rx * 0.7, p.y * ry * 0.7);
      g.lineTo(p.x * rx * 0.7 + rx * 0.2, p.y * ry * 0.7 - ry * 0.12);
      g.lineTo(p.x * rx * 0.7 + rx * 0.05, p.y * ry * 0.7 + ry * 0.06);
      g.fill();
    }
  }
  g.restore();
  g.lineWidth = 2.5 * K;
  g.strokeStyle = 'rgba(40,15,5,0.5)';
  ell(0, 0, rx, ry);
  g.stroke();
  if (kind === 'apple') {
    g.strokeStyle = '#5a3416';
    g.lineWidth = 4 * K;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -ry * 0.82);
    g.quadraticCurveTo(rx * 0.05, -ry * 1.1, rx * 0.12, -ry * 1.22);
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#58c43a';
    ell(rx * 0.32, -ry * 1.08, rx * 0.24, ry * 0.11, -0.5);
    g.fill();
  }
  // gloss
  g.fillStyle = 'rgba(255,255,255,0.4)';
  ell(-rx * 0.38, -ry * 0.48, rx * 0.26, ry * 0.14, -0.55);
  g.fill();
}

function drawFlesh(def, rx, ry) {
  const kind = def.kind;
  const ring = (k, col) => {
    g.fillStyle = col;
    ell(0, 0, rx * k, ry * k);
    g.fill();
  };
  const fleshGrad = k => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry) * k);
    gr.addColorStop(0, def.flesh);
    gr.addColorStop(1, def.flesh2);
    return gr;
  };
  if (kind === 'melon') {
    ring(1, def.rind);
    ring(0.93, def.pith);
    ring(0.85, fleshGrad(0.85));
    g.fillStyle = '#1a0d08';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.2, dd = i % 2 ? 0.5 : 0.36;
      g.save();
      g.translate(Math.cos(a) * rx * dd, Math.sin(a) * ry * dd);
      g.rotate(a + Math.PI / 2);
      ell(0, 0, rx * 0.035, ry * 0.07);
      g.fill();
      g.restore();
    }
  } else if (kind === 'citrus') {
    ring(1, def.rind);
    ring(0.9, def.pith);
    ring(0.82, fleshGrad(0.82));
    g.strokeStyle = def.pith;
    g.lineWidth = Math.max(1.5, 2.6 * K);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * rx * 0.82, Math.sin(a) * ry * 0.82);
      g.stroke();
    }
    ring(0.1, def.pith);
  } else if (kind === 'kiwi') {
    ring(1, def.rind);
    ring(0.93, fleshGrad(0.93));
    g.strokeStyle = 'rgba(230,255,200,0.4)';
    g.lineWidth = 1.5 * K;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * rx * 0.25, Math.sin(a) * ry * 0.25);
      g.lineTo(Math.cos(a) * rx * 0.85, Math.sin(a) * ry * 0.85);
      g.stroke();
    }
    g.fillStyle = '#16100a';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      ell(Math.cos(a) * rx * 0.36, Math.sin(a) * ry * 0.36, rx * 0.025, ry * 0.045, a);
      g.fill();
    }
    g.fillStyle = '#f4ffe0';
    ell(0, 0, rx * 0.22, ry * 0.14);
    g.fill();
  } else if (kind === 'apple') {
    ring(1, def.rind);
    ring(0.93, fleshGrad(0.93));
    g.strokeStyle = css(hexRgb(def.flesh2), 0.9);
    g.lineWidth = 2 * K;
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * TAU, k = i % 2 ? 0.14 : 0.3;
      const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#4a2410';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.6;
      ell(Math.cos(a) * rx * 0.17, Math.sin(a) * ry * 0.17, rx * 0.04, ry * 0.065, a);
      g.fill();
    }
  } else if (kind === 'stone') {
    ring(1, def.rind);
    ring(0.92, fleshGrad(0.92));
    g.fillStyle = def.pit;
    ell(0, 0, rx * 0.34, ry * 0.4);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.5 * K;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * rx * 0.08, -ry * 0.3);
      g.quadraticCurveTo(i * rx * 0.12, 0, i * rx * 0.08, ry * 0.3);
      g.stroke();
    }
  } else if (kind === 'coconut') {
    ring(1, def.rind);
    ring(0.86, def.flesh);
    ring(0.64, '#dce8ee');
    g.fillStyle = 'rgba(255,255,255,0.6)';
    ell(-rx * 0.15, -ry * 0.18, rx * 0.2, ry * 0.08, -0.4);
    g.fill();
  } else if (kind === 'dragon') {
    ring(1, def.rind);
    ring(0.92, fleshGrad(0.92));
    g.fillStyle = '#141014';
    for (const p of SPRINKLE) {
      ell(p.x * rx * 0.82, p.y * ry * 0.82, rx * 0.022, ry * 0.022);
      g.fill();
    }
  }
}

function drawWholeAt(f) {
  g.save();
  g.translate(f.x, f.y);
  // drop shadow
  g.fillStyle = 'rgba(30,10,0,0.22)';
  ell(10 * K, 14 * K, f.rx, f.ry, f.rot);
  g.fill();
  g.rotate(f.rot);
  if (f.golden) {
    const gl = g.createRadialGradient(0, 0, f.R * 0.6, 0, 0, f.R * 1.8);
    gl.addColorStop(0, 'rgba(255,220,80,0.55)');
    gl.addColorStop(1, 'rgba(255,220,80,0)');
    g.fillStyle = gl;
    g.fillRect(-f.R * 2, -f.R * 2, f.R * 4, f.R * 4);
  }
  drawSkin(f.def, f.rx, f.ry);
  g.restore();
}

function drawHalf(h) {
  const L = h.R * 3;
  g.save();
  g.translate(h.x, h.y);
  g.rotate(h.rot);
  const dir = { x: h.n.y, y: -h.n.x };
  const p0 = { x: h.n.x * h.c + dir.x * L, y: h.n.y * h.c + dir.y * L };
  const p1 = { x: h.n.x * h.c - dir.x * L, y: h.n.y * h.c - dir.y * L };
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.lineTo(p1.x + h.n.x * h.s * L * 2, p1.y + h.n.y * h.s * L * 2);
  g.lineTo(p0.x + h.n.x * h.s * L * 2, p0.y + h.n.y * h.s * L * 2);
  g.closePath();
  g.clip();
  ell(0, 0, h.rx + 2 * K, h.ry + 2 * K);
  g.clip();
  drawFlesh(h.def, h.rx, h.ry);
  // juicy cut edge
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 3 * K;
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.stroke();
  g.lineWidth = 2.5 * K;
  g.strokeStyle = 'rgba(40,15,5,0.5)';
  ell(0, 0, h.rx, h.ry);
  g.stroke();
  g.restore();
}

// The signature: each half carries its share of the fruit for a moment.
function drawLabels(r) {
  for (const h of r.halves) {
    if (h.t > 1.4) continue;
    const k = h.t / 1.4;
    const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
    const off = h.c + h.s * Math.min(h.rx, h.ry) * 0.5;
    const lx = h.n.x * off, ly = h.n.y * off;
    const x = clamp(h.x + lx * cs - ly * sn + shakeX, 50 * U, SW - 50 * U);
    const y = h.y + lx * sn + ly * cs + shakeY;
    const sc = back(h.t / 0.2) * (h.perfect ? 1.25 : 1);
    g.globalAlpha = a;
    const col = h.perfect ? '#ffd640' : h.bad ? '#ff5a64' : '#ffffff';
    text(h.pct + '%', x, y, 40 * U * sc, col, 'center', { stroke: 9 * U, strokeColor: 'rgba(40,12,0,0.9)' });
    g.globalAlpha = 1;
  }
}

function drawBomb(f) {
  const R = f.R;
  g.save();
  g.translate(f.x, f.y);
  g.fillStyle = 'rgba(30,10,0,0.22)';
  ell(10 * K, 14 * K, R, R);
  g.fill();
  // red danger glow pulsing
  const pl = 0.5 + 0.5 * Math.sin(tReal * 12);
  const gl = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R * 1.7);
  gl.addColorStop(0, `rgba(255,40,40,${0.35 + pl * 0.25})`);
  gl.addColorStop(1, 'rgba(255,40,40,0)');
  g.fillStyle = gl;
  g.fillRect(-R * 2, -R * 2, R * 4, R * 4);
  g.rotate(f.rot);
  ell(0, 0, R, R);
  const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, 0, 0, 0, R * 1.05);
  gr.addColorStop(0, '#6a6a7a');
  gr.addColorStop(0.5, '#25252e');
  gr.addColorStop(1, '#0a0a0e');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 3 * K;
  g.strokeStyle = '#ff3b3b';
  g.stroke();
  // skull-ish cross
  g.strokeStyle = 'rgba(255,70,70,0.9)';
  g.lineWidth = 5 * K;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-R * 0.3, -R * 0.3);
  g.lineTo(R * 0.3, R * 0.3);
  g.moveTo(R * 0.3, -R * 0.3);
  g.lineTo(-R * 0.3, R * 0.3);
  g.stroke();
  // cap + fuse
  g.fillStyle = '#8a8a96';
  g.fillRect(-R * 0.22, -R * 1.12, R * 0.44, R * 0.26);
  g.strokeStyle = '#c9a36a';
  g.lineWidth = 3.5 * K;
  g.beginPath();
  g.moveTo(0, -R * 1.1);
  g.quadraticCurveTo(R * 0.3, -R * 1.5, R * 0.55, -R * 1.42);
  g.stroke();
  g.lineCap = 'butt';
  // spark
  const sx = R * 0.55, sy = -R * 1.42;
  for (let i = 0; i < 6; i++) {
    const a = tReal * 20 + i * 1.7, l = R * (0.15 + 0.15 * Math.abs(Math.sin(tReal * 31 + i)));
    g.strokeStyle = i % 2 ? '#fff6a0' : '#ff9a1a';
    g.lineWidth = 2.5 * K;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  ell(-R * 0.38, -R * 0.45, R * 0.24, R * 0.13, -0.6);
  g.fill();
  g.restore();
  if (run && run.bombTip && !run.attract && f.y < SH * 0.8) text("DON'T CUT!", f.x + shakeX * 0, f.y - R * 2.1, 18 * U, '#ff5a5a', 'center', { stroke: 5 * U });
}

function drawBooms(r) {
  for (const b of r.booms) {
    const k = b.t / 1.2;
    const rad = b.R * (1 + ease(k * 2) * 7);
    const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, rad);
    gr.addColorStop(0, `rgba(255,255,220,${0.9 * (1 - k)})`);
    gr.addColorStop(0.4, `rgba(255,150,40,${0.7 * (1 - k)})`);
    gr.addColorStop(1, 'rgba(255,60,20,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(b.x, b.y, rad, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
    g.lineWidth = 8 * K * (1 - k);
    g.beginPath();
    g.arc(b.x, b.y, b.R * (1 + ease(k) * 10), 0, TAU);
    g.stroke();
  }
}

function drawParts(r) {
  for (const p of r.parts) {
    const k = p.life / p.max;
    if (p.kind === 'drop') {
      g.fillStyle = css(p.col, Math.min(1, k * 2));
      g.beginPath();
      g.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, TAU);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = 6 * K * k;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (1 + (1 - k) * 1.8), 0, TAU);
      g.stroke();
    } else if (p.kind === 'conf' || p.kind === 'petal') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.fillStyle = css(p.col, Math.min(1, k * 2));
      if (p.kind === 'petal') {
        ell(0, 0, p.size, p.size * 0.55);
        g.fill();
      } else g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g.restore();
    } else {
      g.fillStyle = css(p.col, Math.min(1, k * 1.6));
      g.beginPath();
      g.arc(p.x, p.y, p.size * (p.kind === 'spark' ? k : 1), 0, TAU);
      g.fill();
    }
  }
}

function currentBlade(r) {
  return BLADES.find(b => b.id === (r && r.attract && !REC ? 'classic' : bladeId)) || BLADES[0];
}
function hslRgb(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function drawBlade(r) {
  const life = 0.16;
  blade.trail = blade.trail.filter(p => p.brk || tReal - p.t < life);
  while (blade.trail.length && blade.trail[0].brk) blade.trail.shift();
  if (blade.trail.length > 80) blade.trail.splice(0, blade.trail.length - 80);
  const pts = blade.trail;
  if (pts.length < 2) return;
  const b = currentBlade(r);
  g.lineCap = 'round';
  for (const pass of [0, 1]) {
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      if (p0.brk || p1.brk) continue;
      const fade = 1 - (tReal - p1.t) / life;
      if (fade <= 0) continue;
      const col = b.col === 'rainbow' ? hslRgb((i * 18 + tReal * 400) % 360, 1, 0.62) : hexRgb(b.col);
      g.strokeStyle = pass ? `rgba(255,255,255,${fade})` : css(col, 0.55 * fade);
      g.lineWidth = (pass ? 4.5 : 16) * U * (0.3 + 0.7 * fade);
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
  }
  g.lineCap = 'butt';
}

function drawTutorialGuide(r) {
  if (!r.tutorial || r.dead || r.cuts > 0) return;
  const f = r.fruits.find(f => !f.bomb);
  if (!f || f.y > SH * 0.85) return;
  const ang = -1.1;
  const L = Math.max(f.rx, f.ry) * 1.9;
  const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
  g.setLineDash([10 * U, 10 * U]);
  g.lineDashOffset = -tReal * 60 * U;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4 * U;
  g.beginPath();
  g.moveTo(f.x - dx, f.y - dy);
  g.lineTo(f.x + dx, f.y + dy);
  g.stroke();
  g.setLineDash([]);
  // ghost finger sweeping along the line
  const u = (tReal * 1.2) % 1.4;
  if (u < 1) {
    const x = f.x - dx + dx * 2 * u, y = f.y - dy + dy * 2 * u;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(x, y, 12 * U, 0, TAU);
    g.fill();
  }
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || ''} ${size}px ${opts.font || FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(40,12,0,0.85)';
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
    if (p.t < 0) continue;
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const x = clamp(p.x, 110 * U, SW - 110 * U);
    const top = (REC ? 300 : 0) + Math.max(28 * U, 20) + 150 * U;
    const rise = (40 + ease(k) * 40) * U;
    // fruit cut right under the HUD: show the callout below it instead of on top of the % labels
    const yy = p.y - 40 * U >= top || p.alt == null ? Math.max(top, p.y - rise) : p.alt - rise + 80 * U;
    g.globalAlpha = a;
    text(p.text, x, yy, 32 * U * sc, css(p.col), 'center', { stroke: 7 * U });
    if (p.sub) text(p.sub, x, yy + 30 * U * sc, 19 * U * Math.max(0.8, sc), '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
}

function drawPerfect(r) {
  const p = r.perfectFx;
  if (!p) return;
  const k = p.t / 1.6;
  const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
  const y = SH * (REC ? 0.72 : 0.7);
  const sc = back(p.t / 0.25);
  g.globalAlpha = a;
  g.save();
  g.translate(SW / 2, y);
  g.rotate(-0.05);
  // gold rays behind
  g.fillStyle = 'rgba(255,214,64,0.18)';
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * TAU + tReal * 0.8;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 210 * U * sc, an, an + 0.18);
    g.fill();
  }
  text('PERFECT!', 0, -52 * U * sc, 30 * U * sc, '#fff', 'center', { stroke: 7 * U });
  text('50 | 50', 0, 6 * U * sc, 74 * U * sc, '#ffd640', 'center', { stroke: 11 * U, glow: 'rgba(255,200,40,0.9)', blur: 30 * U });
  text(p.pts + (p.n > 1 ? '  ·  ' + p.n + ' this run' : ''), 0, 62 * U * sc, 19 * U, '#fff', 'center', { stroke: 5 * U });
  g.restore();
  g.globalAlpha = 1;
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

function drawX(x, y, s, on) {
  g.lineCap = 'round';
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? (on ? '#ff3b4a' : 'rgba(255,255,255,0.35)') : 'rgba(40,12,0,0.7)';
    g.lineWidth = (pass ? 5 : 10) * U;
    g.beginPath();
    g.moveTo(x - s, y - s);
    g.lineTo(x + s, y + s);
    g.moveTo(x + s, y - s);
    g.lineTo(x - s, y + s);
    g.stroke();
  }
  g.lineCap = 'butt';
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  if (mode === 'over') g.globalAlpha = Math.max(0, 1 - overT * 4);
  text(String(r.score), SW / 2, top + 28 * U, 56 * U * bump, '#fff', 'center', { stroke: 8 * U });
  for (let i = 0; i < MAX_STRIKES; i++) drawX(SW / 2 + (i - 1) * 30 * U, top + 70 * U, 8 * U, i < r.strikes);
  if (r.streak >= 2) {
    const m = multFor(r.streak);
    text('STREAK ' + r.streak + (m > 1 ? '  ·  ×' + m + ' POINTS' : ''), SW / 2, top + 100 * U, 17 * U, m > 1 ? '#ffd640' : '#b4ffcf', 'center', { stroke: 5 * U });
  }
  g.globalAlpha = 1;
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
    soundButton(SW - 28 * U, top + 6 * U);
    if (best > 0) text('BEST ' + best, SW - 50 * U, top + 7 * U, 14 * U, '#fff', 'right', { stroke: 4 * U });
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * 0.5;
    g.fillStyle = 'rgba(30,10,0,0.45)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 8 * U, 36 * U * back(b.t / 0.3), '#fff', 'center', { stroke: 6 * U });
    text(b.sub, SW / 2, y + 24 * U, 15 * U, '#ffd640', 'center', { stroke: 4 * U });
    g.globalAlpha = 1;
  }
  if (r.tutorial && !r.dead) {
    if (r.cuts === 0 && r.fruits.some(f => !f.bomb)) text('SWIPE THROUGH THE MIDDLE', SW / 2, SH * 0.84, 24 * U, '#fff', 'center', { stroke: 7 * U });
    else if (r.cuts === 0) text('cut every fruit exactly in half', SW / 2, SH * 0.84, 18 * U, '#fff', 'center', { stroke: 5 * U });
    if (r.tutMsg) {
      const k = r.tutMsg.t / 3;
      g.globalAlpha = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      text(r.tutMsg.sub, SW / 2, SH * 0.84, 18 * U, '#fff', 'center', { stroke: 5 * U });
      g.globalAlpha = 1;
    }
  }
}

function drawGem(x, y, r) {
  g.fillStyle = 'rgba(40,12,0,0.7)';
  poly([[x, y - r * 1.25 - 2 * U], [x + r + 2 * U, y], [x, y + r * 1.25 + 2 * U], [x - r - 2 * U, y]]);
  g.fill();
  g.fillStyle = '#ffd650';
  poly([[x, y - r * 1.25], [x + r, y], [x, y + r * 1.25], [x - r, y]]);
  g.fill();
  g.fillStyle = '#fff6c8';
  poly([[x, y - r * 1.25], [x + r * 0.4, y], [x, y + r * 0.3]]);
  g.fill();
}
function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function soundButton(x, y) {
  const r = 16 * U;
  g.fillStyle = 'rgba(40,12,0,0.45)';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
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
  g.fillStyle = 'rgba(40,12,0,0.35)';
  roundRect(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  g.fillStyle = bg;
  roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  text(label, x, y + 1, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

// Big split title: FIFTY | FIFTY with a slash between the halves.
function drawLogo(x, y, s, tilt = -0.06) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  text('FIFTY', -6 * s, -30 * s, 64 * s, '#fff', 'center', { stroke: 11 * s });
  text('FIFTY', 6 * s, 34 * s, 64 * s, '#ff4d5e', 'center', { stroke: 11 * s });
  g.strokeStyle = '#fff';
  g.lineWidth = 5 * s;
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = 14 * s;
  g.beginPath();
  g.moveTo(-120 * s, 8 * s);
  g.lineTo(120 * s, -6 * s);
  g.stroke();
  g.shadowBlur = 0;
  g.lineCap = 'butt';
  g.restore();
}

function drawTitle() {
  const gr = g.createLinearGradient(0, SH * 0.5, 0, SH);
  gr.addColorStop(0, 'rgba(30,10,0,0)');
  gr.addColorStop(1, 'rgba(30,10,0,0.55)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const y = SH * 0.22;
  drawLogo(SW / 2, y, U * (1 + Math.sin(tReal * 2.2) * 0.015));
  text('cut every fruit exactly in half', SW / 2, y + 96 * U, 17 * U, '#fff', 'center', { stroke: 5 * U });
  text('the closer to 50 | 50, the juicier the points', SW / 2, y + 120 * U, 13 * U, '#ffe7b0', 'center', { stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  text('TAP TO PLAY', SW / 2, SH * 0.8, (28 + p * 3) * U, '#fff', 'center', { stroke: 8 * U });
  if (best > 0) text('BEST  ' + best, SW / 2, SH * 0.8 + 38 * U, 17 * U, '#ffd640', 'center', { stroke: 5 * U });
  pill('BLADES', SW / 2, SH * 0.91, 150 * U, 42 * U, 'rgba(40,12,0,0.55)', '#fff', openGarage, 18);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 18 * U, '#ffd650', 'left', { stroke: 5 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(25,8,0,${0.5 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.48 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 300 : 350) * U;
  g.fillStyle = 'rgba(48,20,6,0.94)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 22 * U);
  g.fill();
  g.strokeStyle = '#ff4d5e';
  g.lineWidth = 3 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  const head = r.deathBy === 'bomb' ? 'BOOM!' : '3 STRIKES';
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 40 * U, 32 * U * back(overT / 0.4), '#ffd640', 'center', { stroke: 6 * U });
  else text(head, SW / 2, t0 + 40 * U, 30 * U, r.deathBy === 'bomb' ? '#ff6a4a' : '#fff', 'center', { stroke: 6 * U });
  text(String(r.score), SW / 2, t0 + 102 * U, 74 * U, '#fff', 'center', { stroke: 8 * U });
  const stats = (r.perfects > 0 ? 'PERFECT 50|50s: ' + r.perfects : 'CLOSEST ' + (r.bestSplit || 0) + '|' + (100 - (r.bestSplit || 0))) + '   ·   BEST STREAK ' + r.maxStreak;
  text(stats, SW / 2, t0 + 150 * U, 14 * U, '#ffe7b0', 'center');
  let sub;
  if (REC) sub = 'can you cut it 50 | 50?';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 8 && r.prevBest > 0) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else if (r.deathBy === 'bomb') sub = "watch out for the bombs!";
  else sub = r.lastReason === 'LOPSIDED' ? 'aim for the middle of each fruit' : 'best ' + r.prevBest + ' · longest streak ' + r.maxStreak;
  text(sub, SW / 2, t0 + 178 * U, 15 * U, '#ffd640', 'center');
  if (REC) {
    text('FIFTY FIFTY', SW / 2, t0 - 36 * U, 34 * U, '#fff', 'center', { stroke: 7 * U });
    text('play free, no download →', SW / 2, t0 + 222 * U, 17 * U, '#fff', 'center');
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 254 * U, 17 * U, '#ff8a96', 'center');
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 210 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 211 * U, 17 * U, '#ffd650', 'left');
    pill('RETRY', SW / 2, t0 + 262 * U, cw - 60 * U, 54 * U, '#ff4d5e', '#fff', startGame, 26);
    pill('SHARE', SW / 2 - 75 * U, t0 + 318 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', share, 16);
    pill('BLADES', SW / 2 + 75 * U, t0 + 318 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', openGarage, 16);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, cy + ch / 2 + 24 * U, 13 * U, 'rgba(255,255,255,0.75)', 'center', { stroke: 3 * U });
}

// ---------------------------------------------------------------- share image (?og=1)
function drawOg() {
  setZoneBoard(0);
  g.drawImage(boards.cur, 0, 0, SW, SH);
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(40,12,0,0.6)');
  gr.addColorStop(1, 'rgba(40,12,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  // a watermelon split dead centre, halves drifting apart
  const cx = SW * 0.72, cy = SH * 0.5;
  const def = FRUITS.melon, rx = 130 * 1.32, ry = 130;
  const th = -0.5, cd = { x: Math.cos(th), y: Math.sin(th) }, n = { x: -cd.y, y: cd.x };
  const fake = s => ({ def, x: cx + n.x * s * 34, y: cy + n.y * s * 34, rot: 0, n, c: 0, s, rx, ry, R: rx, pct: 50, t: 0.5, perfect: true });
  const splat = { x: cx, y: cy, R: 190, col: hexRgb(def.juice), seed: 7, t: 2 };
  drawSplats({ splats: [splat] });
  for (const s of [1, -1]) drawHalf(fake(s));
  // blade streak right down the cut
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 26;
  g.beginPath();
  g.moveTo(cx - cd.x * 300, cy - cd.y * 300);
  g.lineTo(cx + cd.x * 300, cy + cd.y * 300);
  g.stroke();
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.stroke();
  g.lineCap = 'butt';
  const r0 = rng(5);
  for (let i = 0; i < 26; i++) {
    const a = r0() * TAU, d = 60 + r0() * 220;
    g.fillStyle = css(hexRgb(def.juice), 0.9);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 4 + r0() * 9, 0, TAU);
    g.fill();
  }
  text('50%', cx - n.x * 95, cy - n.y * 95, 74, '#ffd640', 'center', { stroke: 14 });
  text('50%', cx + n.x * 95, cy + n.y * 95, 74, '#ffd640', 'center', { stroke: 14 });
  // small whole fruits for colour
  for (const [k, x, y, s, rot] of [['orange', 0.47, 0.18, 46, 0.2], ['lime', 0.95, 0.12, 40, -0.4], ['apple', 0.93, 0.86, 48, 0.3]]) {
    const d = FRUITS[k];
    drawWholeAt({ def: d, x: SW * x, y: SH * y, rx: s * d.rx, ry: s * d.ry, rot, R: s });
  }
  drawLogo(SW * 0.25, SH * 0.4, 1.9, -0.06);
  text('cut every fruit exactly in half', SW * 0.25, SH * 0.4 + 175, 32, '#fff', 'center', { stroke: 8 });
  text('free · no download · works on phone', SW * 0.25, SH * 0.4 + 220, 24, '#ffe7b0', 'center', { stroke: 6 });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 340;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 96, 76, i === hook.length - 1 ? '#ffd640' : '#fff', 'center', { stroke: 18 }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  if (cap2 && rec && !r.dead && r.cuts >= rec.crashAt - 3 && r.cuts < rec.crashAt + 1 && mode === 'play') {
    text(cap2, SW / 2, 1660, 66, '#fff', 'center', { stroke: 16 });
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
  const txt = r.perfects > 0 ? `I cut ${r.perfects} fruit${r.perfects > 1 ? 's' : ''} EXACTLY 50/50 and scored ${r.score} on FIFTY FIFTY 🍉🔪 can you split one perfectly? →` : `I scored ${r.score} on FIFTY FIFTY 🍉🔪 my closest cut was ${r.bestSplit}/${100 - r.bestSplit}. can you hit a perfect 50/50? →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Fifty Fifty', text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Paste it to a friend 🍉');
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
  for (const c of BLADES) {
    const have = owned.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car' + (c.id === bladeId ? ' sel' : '') + (have ? '' : ' locked');
    const sw = c.col === 'rainbow' ? 'linear-gradient(90deg,#ff3e6c,#ffd23e,#3effc1,#3e9bff,#c13eff)' : `linear-gradient(90deg,transparent,${c.col} 30%,#fff 50%,${c.col} 70%,transparent)`;
    b.innerHTML = `<i style="background:${sw}"></i><b>${c.name}</b><span>${have ? (c.id === bladeId ? 'EQUIPPED' : 'SELECT') : '◆ ' + c.price}</span>`;
    b.onclick = () => {
      if (have) {
        bladeId = c.id;
        store.set('blade', bladeId);
      } else if (coins >= c.price) {
        coins -= c.price;
        owned.push(c.id);
        bladeId = c.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('blade', bladeId);
        sfx('best', { root: 48 });
      } else {
        toast(`Need ${c.price - coins} more ◆. Keep slicing!`);
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
  ensureAudio();
  if (x != null) {
    const b = hitButton(x, y);
    if (b) {
      blade.ignore = true;
      sfx('click');
      b.act();
      return;
    }
  }
  if (mode === 'title') {
    startGame();
    blade.ignore = true;
  } else if (mode === 'over') {
    if (overT > 0.45) startGame();
    blade.ignore = true;
  } else if (x != null) {
    blade.down = true;
    blade.ignore = false;
    bladeSample(x, y, 'start');
  }
}
function release() {
  if (blade.down) bladeSample(0, 0, 'end');
  blade.down = false;
  blade.ignore = false;
}
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cvs.setPointerCapture(e.pointerId); } catch {}
    press(e.clientX, e.clientY);
  });
  cvs.addEventListener('pointermove', e => {
    if (!blade.down || blade.ignore || mode !== 'play') return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) bladeSample(ev.clientX, ev.clientY, 'move');
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    if (mode !== 'play') press(null, null);
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
if (OG || REC) document.querySelector('.back')?.style.setProperty('display', 'none');
if (OG) {
  document.fonts.load('40px "Lilita One"').finally(() => {
    render();
    window.__ogReady = true;
  });
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 20);
  const seed = +(Q.get('seed') || 5);
  const perfect = new Set((Q.get('perfect') || '6,14').split(',').filter(Boolean).map(Number));
  const ok = new Set((Q.get('ok') || '').split(',').filter(Boolean).map(Number));
  rec = { t: 0, frame: 0, events: [], fuse: [], states: [], musicStart: 0, crashAt };
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    off: +(Q.get('off') || 8),
    first: 0.15,
    bot: true,
    plan: k => (k >= crashAt ? 'bomb' : perfect.has(k) ? 0 : ok.has(k) ? 0.3 : 0.038 + pr() * 0.07),
  });
  run.tutorial = false;
  run.layer = 2;
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
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.cuts, streak: run.streak };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('40px "Lilita One"').then(() => (window.__recReady = true));
} else {
  run = newRun({ bot: true, attract: true });
  if (QA) {
    window.__qa = () => ({
      mode,
      t: run.t,
      score: run.score,
      cuts: run.cuts,
      strikes: run.strikes,
      dead: run.dead,
      perfects: run.perfects,
      streak: run.streak,
      best,
      coins,
      tossN: run.tossN,
      fruits: run.fruits.map(f => ({ x: f.x, y: f.y, vx: f.vx, vy: f.vy, G: f.G, R: f.R, rx: f.rx, ry: f.ry, rot: f.rot, vr: f.vr, bomb: f.bomb })),
    });
  }
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  };
  document.fonts.load('40px "Lilita One"').finally(() => requestAnimationFrame(loop));
}
