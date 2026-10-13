import { Synth, Music, renderOffline, layerFor, dingNote, LAYER_NAMES, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/cap-flip';
const FONT = '"Bungee", system-ui, sans-serif';
const INK = '#1b1433';
const cvs = document.getElementById('game');
const g = cvs.getContext('2d');

// ---------------------------------------------------------------- utils
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const back = t => {
  t = clamp(t, 0, 1);
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const wrap = a => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
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
      const v = localStorage.getItem('cfl_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('cfl_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONES = [
  { name: 'BEDROOM', wall: '#b7a4f5', wall2: '#a08be9', deco: '#ffffff', floor: '#c98a5a', floor2: '#b47548', skirt: '#fff3e2', accent: '#ff5d8f', glow: '#ffd23f', sky: '#8fd8ff', night: 0, pattern: 'dots', types: ['books', 'stool', 'desk', 'box', 'shelf', 'bed', 'speaker'], cols: ['#ff8fab', '#6cc8ff', '#ffd166', '#7fdc9c', '#c3a6ff'] },
  { name: 'KITCHEN', wall: '#8fdcc1', wall2: '#79cdb0', deco: '#ffffff', floor: '#efe6d4', floor2: '#dccfb6', skirt: '#ffffff', accent: '#ff7a59', glow: '#ffe14d', sky: '#bfeaff', night: 0, pattern: 'tiles', types: ['counter', 'fridge', 'stool', 'washer', 'bin', 'box'], cols: ['#ffffff', '#ffd6a5', '#a0e7e5', '#ff9b85', '#fff1a8'] },
  { name: 'CLASSROOM', wall: '#f4cf8a', wall2: '#e9bd6f', deco: '#ffffff', floor: '#9b6a3a', floor2: '#875a2e', skirt: '#5a3a22', accent: '#3b82f6', glow: '#ffef5a', sky: '#9ad8ff', night: 0, pattern: 'stripes', types: ['desk', 'books', 'shelf', 'bin', 'stool', 'box'], cols: ['#5aa9ff', '#ff6b6b', '#ffd23f', '#6fd08c', '#ff9f43'] },
  { name: 'ROOFTOP', wall: '#1a1d4d', wall2: '#2d2f78', deco: '#ffe9a8', floor: '#5b5f86', floor2: '#4a4e73', skirt: '#7c80a8', accent: '#ff4fd8', glow: '#7cf3ff', sky: '#0d0f33', night: 1, pattern: 'city', types: ['crate', 'ac', 'tank', 'box', 'speaker'], cols: ['#8a95c8', '#ff6fb1', '#62d6ff', '#ffd166', '#a98bff'] },
];
const PAL_KEYS = ['wall', 'wall2', 'floor', 'floor2', 'skirt', 'accent', 'glow', 'sky'];
const zonePal = z => Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(ZONES[z % ZONES.length][k])]));
const PER_ZONE = 12;

export const BOTTLES = [
  { id: 'classic', name: 'CLASSIC', glass: '#bfe9ff', ga: 0.5, liquid: '#2fb8ff', cap: '#1f6fff', label: '#ffffff', stripe: '#2fb8ff', price: 0 },
  { id: 'soda', name: 'SODA', glass: '#7ee08a', ga: 0.6, liquid: '#c9f59a', cap: '#ff3b3b', label: '#ff3b3b', stripe: '#ffffff', price: 60 },
  { id: 'milk', name: 'MILK', glass: '#ffffff', ga: 0.85, liquid: '#fffdf5', cap: '#2f7bff', label: '#2f7bff', stripe: '#ffffff', price: 120 },
  { id: 'ketchup', name: 'KETCHUP', glass: '#ff4436', ga: 0.9, liquid: '#c41d10', cap: '#ffffff', label: '#ffffff', stripe: '#24a148', price: 200 },
  { id: 'honey', name: 'HONEY', glass: '#ffd36a', ga: 0.55, liquid: '#f0a020', cap: '#7a4a12', label: '#fff3c4', stripe: '#7a4a12', price: 320 },
  { id: 'potion', name: 'POTION', glass: '#d9c2ff', ga: 0.45, liquid: '#b13cff', cap: '#3a1a66', label: '#ffd23f', stripe: '#3a1a66', price: 480, glow: true },
  { id: 'gold', name: 'GOLD', glass: '#ffd23f', ga: 0.95, liquid: '#fff1a0', cap: '#b8860b', label: '#fff8dc', stripe: '#b8860b', price: 800 },
  { id: 'galaxy', name: 'GALAXY', glass: 'galaxy', ga: 0.6, liquid: '#ff5df0', cap: '#120a2e', label: '#120a2e', stripe: '#7cf3ff', price: 1500, glow: true },
];

// ---------------------------------------------------------------- tuning
const HALF = 30; // bottle half length (base to center, cap to center)
const GRAV = 820; // flight gravity, world units / s^2 (sim time)
const ACCEL_T = 0.08; // seconds to reach full spin from rest
const DECAY = 42; // spin bleeds off this fast after you let go
const WIND = 0.7, WIND_T = 0.6; // keep holding past this long and the spin winds up (double flips)
const WIND_K = 0.75; // up to this much faster
const SETTLE = 2.0; // after you let go, the water pulls the bottle toward upright
const SETTLE_CAP = 1.1; // and a little toward the cap when it's upside down, so a cap landing is a skill shot, not a lottery
// Landing windows in degrees, measured from upright (or from the cap).
const W_PERFECT = 7, W_STAND = 28, W_CLUTCH = 36, W_TEETER = 44;
const W_CAP = 12, W_CAPTEETER = 17;
const spinAt = c => TAU * (1.2 + Math.min(0.6, c * 0.02)); // rad/s at full spin
const paceAt = c => 1 + Math.min(0.4, c * 0.012); // whole flight runs this much faster
const tolAt = c => (c < 3 ? 1.25 : 1); // the first flips of a run are gentler
const bpmAt = c => Math.min(124, 98 + c * 0.6);

// ---------------------------------------------------------------- room
const TYPE = {
  books: { fw: 70, h: [34, 104] },
  stool: { fw: 64, h: [72, 100] },
  desk: { fw: 130, h: [96, 112] },
  box: { fw: 84, h: [46, 130] },
  shelf: { fw: 90, h: [160, 224] },
  bed: { fw: 176, h: [56, 70] },
  speaker: { fw: 64, h: [92, 150] },
  counter: { fw: 140, h: [100, 112] },
  fridge: { fw: 100, h: [186, 230] },
  washer: { fw: 92, h: [92, 100] },
  bin: { fw: 54, h: [58, 80] },
  crate: { fw: 74, h: [56, 132] },
  ac: { fw: 104, h: [70, 92] },
  tank: { fw: 96, h: [150, 200] },
};

class Room {
  constructor(seed) {
    this.r = rng(seed);
    this.items = [];
  }
  ensure(n) {
    while (this.items.length < n) this.add();
  }
  add() {
    const i = this.items.length;
    const r = this.r;
    const z = Math.floor(i / PER_ZONE) % ZONES.length;
    const Z = ZONES[z];
    let type;
    if (i === 0) type = z === 3 ? 'crate' : 'desk';
    else {
      const prev = this.items[i - 1].type;
      do type = Z.types[(r() * Z.types.length) | 0];
      while (type === prev && r() < 0.8);
    }
    const T = TYPE[type];
    let h = T.h[0] + r() * (T.h[1] - T.h[0]);
    const prev = this.items[i - 1];
    // Every so often, force a big drop (room for a double flip) or a climb.
    if (prev && i > 3 && r() < 0.22 && prev.h > 140 && !['shelf', 'fridge', 'tank'].includes(type)) h = T.h[0];
    const it = { i, type, z, h, fw: T.fw, w: T.fw, lx: 0, x: 0, c1: hexRgb(Z.cols[(r() * Z.cols.length) | 0]), c2: hexRgb(Z.cols[(r() * Z.cols.length) | 0]), seed: (r() * 1e6) | 0 };
    if (type === 'books') {
      const n = Math.max(2, Math.round(h / 17));
      it.books = [];
      let y = 0;
      for (let k = 0; k < n; k++) {
        const bh = 14 + r() * 7;
        const bw = 52 + r() * 22;
        it.books.push({ y, h: bh, w: bw, dx: (r() - 0.5) * 10, c: hexRgb(Z.cols[(r() * Z.cols.length) | 0]) });
        y += bh;
      }
      it.h = y;
      const top = it.books[n - 1];
      it.w = top.w;
      it.lx = top.dx;
    }
    if (type === 'box' || type === 'crate') it.stack = h > (type === 'box' ? 92 : 90) ? 2 : 1;
    if (type === 'stool') it.w = 58;
    if (type === 'bed') it.w = 120;
    if (type === 'tank') it.w = 84;
    if (i === 0) it.x = 0;
    else {
      const gap = 40 + r() * 70 + Math.min(30, i * 1.0);
      it.x = prev.x + prev.fw / 2 + gap + it.fw / 2;
    }
    this.items.push(it);
  }
}

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, K = 1, U = 1;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let bgZone = 0, bgFrom = 0, bgK = 1;
let cam = { x: 0, y: -120, z: 1 };
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let spinG = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let bestN = store.get('bestn', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['classic']);
let skinId = store.get('skin', 'classic');
let plays = store.get('plays', 0);
let capsEver = store.get('caps', 0);
let overT = 0;
let buttons = [];
let held = false;
let ignoreHold = false;
let rec = null; // record-mode log
let pulse = 0;
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
  K = OG ? 2.1 : REC ? 2.95 : SW > SH ? SH / 600 : Math.min(SW / 380, SH / 720);
  U = Math.min(SW / 420, SH / 640);
}
const wide = () => SW / K > 620; // landscape: title on the left, scene on the right
const VY = () => (REC ? 0.62 : 0.56);
const LIFT = () => (REC ? 70 : 40); // camera sits this far above the furniture tops

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const room = new Room(seed);
  room.ensure(8);
  const it = room.items[0];
  const r = {
    room,
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    rnd: rng(seed ^ 0x5bd1e995),
    b: { x: it.x + it.lx, y: -it.h - HALF, th: 0, th0: 0, w: 0, slosh: 0, sloshV: 0, sq: 0, sqV: 0, held: false },
    state: 'ready',
    cur: 0,
    fl: null, // current flight
    land: null, // landing animation
    fall: null, // spill animation
    score: 0,
    n: 0, // successful landings
    streak: 0,
    maxStreak: 0,
    perfects: 0,
    caps: 0,
    doubles: 0,
    dead: false,
    deadT: 0,
    slow: 1,
    slowT: 0,
    layer: 0,
    coinsGot: 0,
    pops: [],
    parts: [],
    trail: [],
    puddle: null,
    passedBest: false,
    banner: null,
    layerPop: null,
    t: 0,
    readyT: 0,
    scoreBump: 0,
    lastKind: null,
    tutorial: !opts.bot && plays < 2,
    tipCap: !opts.bot && plays >= 1 && plays < 5 && capsEver === 0,
    needRelease: false,
    flipsShown: 0,
  };
  palT = zonePal(0);
  if (!opts.keepPal) {
    pal = zonePal(0);
    bgZone = bgFrom = 0;
    bgK = 1;
  }
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
  snapCam();
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
      spinG = audio.spinLoop();
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
  const z = run ? run.room.items[run.cur].z : 0;
  let layer = run ? run.layer : 0;
  if (mode === 'title') layer = 3;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(run ? run.n : 0) };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- flight
function makeFlight(r) {
  const room = r.room;
  room.ensure(r.cur + 8);
  const a = room.items[r.cur], b = room.items[r.cur + 1];
  const x0 = r.b.x, y0 = -a.h - HALF;
  const x1 = b.x + b.lx, y1 = -b.h - HALF;
  const clr = 150 + hash(b.seed) * 60;
  const ay = Math.min(y0, y1) - clr;
  const tu = Math.sqrt((2 * (y0 - ay)) / GRAV);
  const td = Math.sqrt((2 * (y1 - ay)) / GRAV);
  const T = tu + td;
  return { x0, y0, x1, y1, T, vx: (x1 - x0) / T, vy: -GRAV * tu, tau: 0, pace: paceAt(r.n), spin: spinAt(r.n), tol: tolAt(r.n) };
}
// Most rotation you can still fit into this flight if you hold from launch.
function maxTurns(f) {
  if (f.maxT == null) {
    const s = { th: 0, w: 0, h: 0 };
    for (let t = 0; t < f.T; t += 1 / 120) spinStep(s, true, 1 / 120, f.spin);
    f.maxT = s.th / TAU;
  }
  return f.maxT;
}

function launch(r) {
  r.fl = makeFlight(r);
  r.state = 'air';
  r.b.th0 = r.b.th;
  r.b.w = 0;
  r.b.h = 0;
  r.flipsShown = 0;
  r.b.sqV = -6;
  sfx('whoosh');
  const it = r.room.items[r.cur];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (r.rnd() - 0.5) * 1.2;
    r.parts.push({ x: r.b.x + (r.rnd() - 0.5) * 20, y: -it.h - 2, vx: Math.cos(a) * 60 * (r.rnd() < 0.5 ? -1 : 1), vy: -20 - r.rnd() * 30, g: -10, life: 0.4, max: 0.4, size: 5 + r.rnd() * 4, kind: 'dust' });
  }
}

// Advance spin by dt (sim seconds). Pure, so the bot can look ahead with it.
function spinStep(s, hold, dt, spin) {
  if (hold) {
    s.h = (s.h || 0) + dt;
    const top = spin * (1 + WIND_K * clamp((s.h - WIND) / WIND_T, 0, 1));
    s.w = Math.min(top, s.w + (spin / ACCEL_T) * dt);
  } else {
    s.h = 0;
    s.w *= Math.exp(-DECAY * dt);
  }
  s.th += s.w * dt;
  if (!hold) {
    const k = dt * (1 - Math.min(1, s.w / 3));
    if (Math.cos(s.th) > 0) s.th -= SETTLE * Math.sin(s.th) * k;
    else s.th += SETTLE_CAP * Math.sin(s.th) * k;
  }
}
// Where the bottle ends up if it's let go right now (or after holding `more` sim seconds).
function predictFinal(r, more = 0) {
  const f = r.fl, b = r.b;
  const s = { th: b.th, w: b.w, h: b.h };
  let rem = f.T - f.tau;
  const dt = 1 / 240;
  while (rem > 0) {
    const d = Math.min(dt, rem);
    spinStep(s, more > 0, d, f.spin);
    more -= d;
    rem -= d;
  }
  return s.th;
}

function botWant(r) {
  // returns { flips, cap, err }: flips this jump, land on the cap?, landing error in degrees
  const k = r.n;
  if (r.plan) return r.plan(k, r);
  const x = r.rnd();
  if (r.attract) {
    if (k >= (r.crashAt ??= 6 + ((r.rnd() * 9) | 0))) return { flips: 1, err: 44 };
    const can2 = maxTurns(r.fl) > 2.15;
    if (x < 0.18) return { flips: 1, cap: true, err: (r.rnd() - 0.5) * 8 };
    if (can2 && x < 0.45) return { flips: 2, err: (r.rnd() - 0.5) * 20 };
    return { flips: 1, err: x < 0.55 ? (r.rnd() - 0.5) * 8 : (r.rnd() - 0.5) * 36 };
  }
  return { flips: 1, err: 0 };
}
// Absolute angle the bot aims for: n flips, ending upright or on the cap.
function botTarget(r, w) {
  const base = Math.round(r.b.th0 / Math.PI) * Math.PI;
  const p = Math.round(r.b.th0 / Math.PI) & 1; // 1 = starting on the cap
  const half = 2 * w.flips - (p ^ (w.cap ? 1 : 0));
  return base + half * Math.PI + w.err * DEG;
}

function botControl(r) {
  const f = r.fl, b = r.b;
  if (!r.want) r.want = botWant(r);
  const target = botTarget(r, r.want);
  if (b.held) {
    // let go when the predicted landing angle reaches the target
    if (predictFinal(r) >= target - b.w * (1 / 60) * f.pace * 0.5) b.held = false;
  } else if (!r.botGo) {
    r.botGo = true;
    b.held = true;
  }
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
    } else ph = music && audio && audio.ctx.state === 'running' ? music.phase(bpm) : (tReal * bpm / 60) % 1;
    pulse = Math.pow(1 - ph, 3);
  }
  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  const b = r.b;

  if (r.state === 'ready') {
    r.readyT += wdt;
    if (r.bot) {
      if (r.readyT > (r.attract ? 0.55 : REC ? 0.32 : 0.4)) {
        r.want = null;
        r.botGo = true;
        b.held = true;
        launch(r);
      }
    } else if (held && !ignoreHold && !r.needRelease && mode === 'play') {
      b.held = true;
      launch(r);
    }
  }
  if (r.state === 'air') {
    const f = r.fl;
    if (r.bot) botControl(r);
    else b.held = held && !ignoreHold;
    // tutorial: slow the world right before upright so a first-timer can read it
    let tut = 1;
    if (r.tutorial && r.n < 3 && b.held) {
      const d = b.th - b.th0;
      if (d > TAU * 0.6 && d < TAU * 1.08) tut = 0.32;
    }
    const sdt = wdt * f.pace * tut;
    f.tau += sdt;
    spinStep(b, b.held, sdt, f.spin);
    const tau = Math.min(f.tau, f.T);
    b.x = f.x0 + f.vx * tau;
    b.y = f.y0 + f.vy * tau + 0.5 * GRAV * tau * tau;
    // flip counter pops while holding
    const turns = Math.floor((b.th - b.th0 + 0.35) / TAU);
    if (turns > r.flipsShown && b.held) {
      r.flipsShown = turns;
      if (turns >= 1 && !r.attract) r.pops.push({ text: turns === 1 ? '1 FLIP' : turns + ' FLIPS!', sub: '', x: b.x, y: b.y - 40, t: 0, dur: 0.6, col: [255, 255, 255], size: turns > 1 ? 0.9 : 0.6, small: true });
    }
    r.trail.push({ x: b.x, y: b.y, th: b.th });
    if (r.trail.length > 9) r.trail.shift();
    if (f.tau >= f.T) touchDown(r);
  } else if (r.trail.length) r.trail.shift();

  if (r.state === 'land') stepLand(r, wdt);
  if (r.state === 'fall') stepFall(r, wdt);
  if (r.dead) {
    r.deadT += dt;
    if (r.attract && r.deadT > 1.8) {
      run = newRun({ bot: true, attract: true, keepPal: true });
      snapCam();
    } else if (!r.attract && mode === 'play' && r.deadT > 1.6) gameOver(r);
  }

  // water slosh: lags behind spin, rings on impacts
  const tgt = clamp(-b.w * 0.05, -0.7, 0.7);
  b.sloshV += ((tgt - b.slosh) * 140 - b.sloshV * 9) * wdt;
  b.slosh += b.sloshV * wdt;
  b.sqV += (-b.sq * 320 - b.sqV * 16) * wdt;
  b.sq += b.sqV * wdt;

  updateCam(r, dt);
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  // zone palette follows the item the bottle stands on
  const z = r.room.items[r.cur].z;
  if (z !== bgZone) {
    bgFrom = bgZone;
    bgZone = z;
    bgK = 0;
    palT = zonePal(z);
  }
  bgK = Math.min(1, bgK + dt / 1.2);
  const pk = 1 - Math.exp(-2 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);

  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.vy += (p.g ?? 900) * wdt;
    if (p.rot != null) p.rot += p.vr * wdt;
    if (p.kind === 'confetti') {
      p.vx *= Math.exp(-1.6 * wdt);
      p.vy = Math.min(p.vy, 160);
    }
    if (p.floor != null && p.y > p.floor) {
      p.y = p.floor;
      p.vy *= -0.3;
      p.vx *= 0.6;
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
  if (r.puddle) r.puddle.r = lerp(r.puddle.r, r.puddle.max, 1 - Math.exp(-4 * dt));
  if (mode === 'over') overT += dt;

  // audio
  const sp = r.state === 'air' ? clamp(b.w / (r.fl.spin * 0.9), 0, 1) * 0.13 : 0;
  if (REC && rec) {
    if (rec.frame % 2 === 0) rec.spin.push([rec.t, sp]);
  } else if (audio && soundOn) {
    spinG.gain.setTargetAtTime(mode === 'title' ? 0 : sp, audio.ctx.currentTime, 0.03);
    music.tick(musicState());
  }
}

function touchDown(r) {
  const f = r.fl, b = r.b;
  const it = r.room.items[r.cur + 1];
  b.x = f.x1;
  b.y = f.y1;
  b.held = false;
  r.state = 'land';
  if (held) r.needRelease = true;
  const d = b.th - b.th0; // how far it turned on this flip
  const eUp = wrap(b.th);
  const eCap = wrap(b.th - Math.PI);
  const tol = f.tol;
  let kind, e, cap = false;
  if (Math.abs(eUp) <= Math.abs(eCap)) {
    e = eUp / DEG;
    const a = Math.abs(e);
    kind = a < W_PERFECT * tol ? 'perfect' : a < W_STAND * tol ? 'good' : a < W_CLUTCH * tol ? 'clutch' : a < W_TEETER * tol ? 'teeter' : 'topple';
  } else {
    cap = true;
    e = eCap / DEG;
    const a = Math.abs(e);
    kind = a < W_CAP * tol ? 'cap' : a < W_CAPTEETER * tol ? 'capteeter' : 'topple';
  }
  // flips completed this jump: half turns, rounded up (a cap landing from upright is 1 flip)
  const flips = Math.max(0, Math.ceil(Math.round(d / Math.PI) / 2));
  r.land = { t: 0, kind, e, cap, flips, d, it, side: e >= 0 ? 1 : -1, done: false, ticks: 0 };
  r.lastE = e;
  b.th = (cap ? Math.PI : 0) + e * DEG + Math.round((b.th - (cap ? Math.PI : 0) - e * DEG) / TAU) * TAU;
  b.sqV = 7;
  b.sloshV += (r.rnd() - 0.5) * 8 + 6;
  const hard = kind !== 'topple';
  sfx('thunk', { v: hard ? 1 : 0.8 });
  vibrate(12);
  const top = -it.h;
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? 1 : -1;
    r.parts.push({ x: b.x + s * (8 + r.rnd() * 10), y: top - 2, vx: s * (40 + r.rnd() * 80), vy: -30 - r.rnd() * 50, g: 200, life: 0.45, max: 0.45, size: 4 + r.rnd() * 4, kind: 'dust' });
  }
  if (kind === 'teeter' || kind === 'clutch' || kind === 'capteeter') {
    r.slow = 0.6;
    r.slowT = 1.0;
    sfx('gasp');
  }
  if (kind === 'topple') beginFall(r, r.land.side, 0);
  else if (kind === 'perfect' || kind === 'good' || kind === 'cap') score(r);
}

function stepLand(r, dt) {
  const L = r.land, b = r.b;
  L.t += dt;
  const base = L.cap ? Math.PI : 0;
  const k = Math.round((b.th - base) / TAU) * TAU + base;
  let tilt = 0;
  if (L.kind === 'perfect' || L.kind === 'cap') tilt = L.e * DEG * Math.exp(-14 * L.t) * Math.cos(20 * L.t);
  else if (L.kind === 'good') {
    tilt = L.e * DEG * Math.exp(-5 * L.t) * Math.cos(16 * L.t);
    const tk = Math.floor(L.t * 16 / Math.PI);
    if (tk > L.ticks && L.t < 0.5) {
      L.ticks = tk;
      sfx('tock', { v: 0.35 * Math.exp(-4 * L.t) });
    }
  } else {
    // teeter on the base edge, rocking near the tipping point
    const A = Math.abs(L.e) * DEG;
    const T1 = 0.95;
    if (L.t < T1) {
      const rock = Math.sin(L.t * 11) * (1 - L.t / T1) * 0.16 + Math.sin(L.t * 23) * 0.03;
      tilt = L.side * (A * 0.85 + rock * A);
      const tk = Math.floor(L.t * 11 / Math.PI);
      if (tk > L.ticks) {
        L.ticks = tk;
        sfx('tock', { v: 0.45 });
      }
    } else if (L.kind === 'clutch') {
      const tt = L.t - T1;
      tilt = L.side * A * 0.85 * Math.exp(-7 * tt) * Math.cos(12 * tt);
      if (!L.done) {
        L.done = true;
        score(r);
        b.sqV = 4;
      }
    } else {
      if (!L.done) {
        L.done = true;
        beginFall(r, L.side, A * 0.85);
      }
      return;
    }
  }
  b.tilt = tilt;
  b.th = k + tilt;
  const dur = L.kind === 'perfect' ? 0.32 : L.kind === 'cap' ? 0.7 : L.kind === 'good' ? 0.42 : 1.35;
  if (L.t > dur && r.state === 'land') arrive(r);
}

// The bottle is now standing on the next item.
function arrive(r) {
  const b = r.b;
  r.cur++;
  r.state = 'ready';
  r.readyT = 0;
  const cap = r.land && r.land.cap;
  r.land = null;
  r.want = null;
  r.botGo = false;
  b.th = cap ? Math.round((b.th - Math.PI) / TAU) * TAU + Math.PI : Math.round(b.th / TAU) * TAU;
  b.tilt = 0;
  if (!held) r.needRelease = false;
  r.room.ensure(r.cur + 8);
}

function score(r) {
  const L = r.land, b = r.b;
  const kind = L.kind;
  let pts, label, col, sub = '';
  if (kind === 'cap' || kind === 'capteeter') {
    pts = 5 * Math.max(1, L.flips);
    label = 'CAP FLIP!';
    col = [255, 210, 63];
  } else if (L.flips <= 0) {
    pts = 0;
    label = 'NO FLIP';
    col = [220, 220, 235];
  } else {
    const base = [0, 1, 3, 6, 10, 15][Math.min(5, L.flips)];
    pts = base;
    if (kind === 'perfect') pts *= 2;
    if (kind === 'clutch') pts += 1;
    label = kind === 'perfect' ? 'PERFECT' : kind === 'clutch' ? 'CLUTCH!' : L.flips >= 2 ? '' : 'NICE';
    if (L.flips >= 2) label = (L.flips === 2 ? 'DOUBLE' : L.flips === 3 ? 'TRIPLE' : L.flips + 'x') + (kind === 'perfect' ? ' PERFECT' : ' FLIP');
    col = kind === 'perfect' ? [255, 255, 255] : kind === 'clutch' ? [124, 243, 255] : [255, 255, 255];
  }
  const prevLayer = r.layer;
  if (pts > 0) {
    r.streak++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  } else {
    if (r.streak >= 4) sfx('drop');
    r.streak = 0;
  }
  const hype = r.streak >= 13;
  if (hype && pts > 0) pts *= 2;
  r.layer = layerFor(r.streak);
  if (r.layer > prevLayer && !r.attract) r.layerPop = { name: LAYER_NAMES[r.layer], t: 0 };
  r.score += pts;
  r.n++;
  r.scoreBump = 1;
  r.lastKind = kind;
  if (kind === 'perfect') r.perfects++;
  if (L.flips >= 2 && !L.cap) r.doubles++;
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });
  const root = ZONE_ROOTS[r.room.items[r.cur].z % ZONE_ROOTS.length];
  const px = b.x, py = b.y - 50;
  if (pts > 0) {
    sub = '+' + pts + (r.streak > 1 ? '   x' + r.streak : '');
    sfx('ding', { m: dingNote(root, r.streak - 1), big: kind === 'perfect' || L.cap || L.flips >= 2 });
  }
  const big = L.cap ? 1.5 : kind === 'perfect' || L.flips >= 2 ? 1.1 : kind === 'clutch' ? 1.05 : 0.8;
  if (!r.attract || L.cap) {
    for (const p of r.pops) if (p.t > 0.15) p.t = Math.max(p.t, p.dur * 0.75);
    r.pops.push({ text: label, sub, x: px, y: py, t: 0, dur: L.cap ? 1.5 : 1.0, col, size: big });
  }
  // coins
  let gem = 0;
  if (kind === 'perfect') gem = 1;
  if (kind === 'clutch') gem = 1;
  if (L.cap) gem = 3;
  if (gem && !r.attract) {
    r.coinsGot += gem;
    sfx('coin');
    for (let i = 0; i < gem; i++) r.parts.push({ x: px + (i - (gem - 1) / 2) * 16, y: b.y - 20, vx: (i - (gem - 1) / 2) * 30, vy: -260, g: 500, life: 0.8, max: 0.8, size: 7, kind: 'gem' });
  }
  if (L.cap) {
    r.caps++;
    if (!r.bot) {
      capsEver++;
      store.set('caps', capsEver);
    }
    sfx('cap');
    flash = 0.45;
    shake = 0.6;
    r.slow = 0.35;
    r.slowT = 0.55;
    vibrate([30, 40, 60]);
    confetti(r, b.x, b.y - 30, 70);
  } else if (kind === 'perfect') {
    flash = 0.14;
    r.slow = 0.25;
    r.slowT = 0.08;
    vibrate(20);
    ring(r, b.x, -L.it.h, [255, 255, 255]);
  } else if (kind === 'clutch') {
    sfx('cheer');
    flash = 0.12;
    ring(r, b.x, -L.it.h, [124, 243, 255]);
  }
  if (L.flips >= 2 && !L.cap) {
    sfx('cheer');
    confetti(r, b.x, b.y - 30, 30);
    shake = 0.35;
  }
  // zone change
  const z = Math.floor(r.n / PER_ZONE) % ZONES.length;
  const zPrev = Math.floor((r.n - 1) / PER_ZONE) % ZONES.length;
  if (z !== zPrev) {
    r.banner = { text: ZONES[z].name, sub: 'room ' + (Math.floor(r.n / PER_ZONE) + 1), t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep flipping', t: 0 };
    sfx('best', { root });
    flash = Math.max(flash, 0.3);
  }
}

function ring(r, x, y, col) {
  r.parts.push({ x, y, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45, size: 1, kind: 'ring', col });
}
function confetti(r, x, y, n) {
  const cols = [[255, 93, 143], [255, 210, 63], [47, 184, 255], [124, 243, 255], [127, 220, 156], [195, 166, 255]];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (r.rnd() - 0.5) * 2.4;
    const sp = 260 + r.rnd() * 420;
    r.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 520, life: 1.4 + r.rnd() * 0.6, max: 2, size: 5 + r.rnd() * 5, kind: 'confetti', col: cols[i % cols.length], rot: r.rnd() * 6, vr: (r.rnd() - 0.5) * 18 });
  }
}

// ---------------------------------------------------------------- spill
function beginFall(r, side, tilt0) {
  const b = r.b, L = r.land;
  r.state = 'fall';
  const it = L ? L.it : r.room.items[r.cur + 1];
  r.fall = { t: 0, side, tilt: tilt0 || Math.abs(L ? L.e * DEG : 0.8), tv: 1.5, base: Math.round((b.th - (L && L.cap ? Math.PI : 0)) / TAU) * TAU + (L && L.cap ? Math.PI : 0), free: false, top: -it.h, hit: false, cap: L && L.cap };
  r.dead = true;
  r.deadT = 0;
  r.streak = 0;
  r.layer = 0;
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });
  if (!r.attract) {
    sfx('drop');
    vibrate([40, 30, 80]);
  }
}

function stepFall(r, dt) {
  const F = r.fall, b = r.b;
  F.t += dt;
  if (!F.free) {
    // tip over the base edge like a hinge
    F.tv += 9 * Math.sin(F.tilt) * dt + 4 * dt;
    F.tilt += F.tv * dt;
    b.th = F.base + F.side * F.tilt;
    // pivot is the base corner on the surface; recompute the center from it
    const hw = F.cap ? 7.5 : 12;
    const px = F.px ?? (F.px = b.x + F.side * hw);
    const py = F.top;
    const a = F.side * F.tilt;
    // center relative to pivot when tilted by a: rotate (-side*hw, -HALF)
    const lx = -F.side * hw, ly = -HALF;
    b.x = px + lx * Math.cos(a) - ly * Math.sin(a);
    b.y = py + lx * Math.sin(a) + ly * Math.cos(a);
    if (F.tilt > 1.25) {
      F.free = true;
      F.vx = F.side * (110 + F.tv * 20);
      F.vy = -60;
      F.w = F.side * (5 + F.tv);
      sfx('tock', { v: 0.8 });
    }
  } else {
    F.vy += 1500 * dt;
    b.x += F.vx * dt;
    b.y += F.vy * dt;
    b.th += F.w * dt;
    const it = r.room.items[r.cur + 1];
    const onTop = Math.abs(b.x - it.x) < it.w / 2 + 4 && b.y < F.top;
    const floorY = onTop ? F.top - 12 : -12;
    if (onTop && b.y > floorY) {
      b.y = floorY;
      F.vy = 0;
    } else if (b.y > floorY && !F.hit) {
      F.hit = true;
      b.y = floorY;
      F.vy = -F.vy * 0.25;
      F.vx *= 0.5;
      F.w *= 0.4;
      spill(r);
    } else if (F.hit && b.y > floorY) {
      b.y = floorY;
      F.vy = 0;
      F.vx *= Math.exp(-6 * dt);
      F.w = 0;
      // settle lying on its side
      const target = Math.round((b.th - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      b.th = lerp(b.th, target, 1 - Math.exp(-12 * dt));
    }
  }
}

function spill(r) {
  const b = r.b;
  if (!r.attract) {
    sfx('spill');
    shake = 0.9;
    flash = 0.2;
  }
  const col = hexRgb(skin(r).liquid);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (r.rnd() - 0.5) * 2.6;
    const sp = 120 + r.rnd() * 340;
    r.parts.push({ x: b.x, y: -6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1100, life: 0.9, max: 0.9, size: 3 + r.rnd() * 4, kind: 'drop', col, floor: -2 });
  }
  // the cap pops off
  const s = r.fall.side;
  r.parts.push({ x: b.x + s * 30, y: -14, vx: s * (160 + r.rnd() * 60), vy: -320, g: 1100, life: 1.6, max: 1.6, size: 7, kind: 'cap', col: hexRgb(skin(r).cap), rot: 0, vr: s * 16, floor: -5 });
  r.puddle = { x: b.x + s * 10, r: 0, max: 70, col };
}

function updateCam(r, dt) {
  const items = r.room.items;
  const a = items[r.cur], b = items[Math.min(items.length - 1, r.cur + 1)];
  let tx = (a.x + b.x) / 2;
  let ty = (-a.h - b.h) / 2 - LIFT();
  if (r.state === 'air') {
    const k = clamp(r.fl.tau / r.fl.T, 0, 1);
    const c = items[r.cur + 2] || b;
    tx = lerp(tx, (b.x + c.x) / 2, ease(k) * 0.35);
  }
  if (r.state === 'fall' || r.dead) {
    tx = r.b.x;
    ty = Math.max(-140, (r.b.y - 60) * 0.5);
  }
  if (mode === 'title' && wide()) tx -= (SW / K) * 0.2;
  if (OG) tx -= (SW / K) * 0.22;
  // never show more floor than room above: keep the floor in the lower part of the screen
  const ky = 1 - Math.exp(-3.2 * dt);
  const kx = 1 - Math.exp(-3.6 * dt);
  cam.x = lerp(cam.x, tx, kx);
  cam.y = lerp(cam.y, ty, ky);
  let zt = 1;
  if (r.state === 'land' && r.land && ['teeter', 'clutch', 'capteeter'].includes(r.land.kind) && r.land.t < 1.0) zt = 1.18;
  cam.z = lerp(cam.z, zt, 1 - Math.exp(-4 * dt));
}
function snapCam() {
  const r = run;
  const items = r.room.items;
  cam.x = (items[0].x + items[1].x) / 2 - (mode === 'title' && wide() ? (SW / K) * 0.2 : 0) - (OG ? (SW / K) * 0.22 : 0);
  cam.y = (-items[0].h - items[1].h) / 2 - LIFT();
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
    bestN = r.n;
    store.set('best', best);
    store.set('bestn', bestN);
  }
}

// ---------------------------------------------------------------- render
let shakeX = 0, shakeY = 0;
const KZ = () => K * cam.z;
const SX = x => SW / 2 + (x - cam.x) * KZ() + shakeX;
const SY = y => SH * VY() + (y - cam.y) * KZ() + shakeY;
function worldT(par = 1) {
  const k = KZ();
  g.setTransform(DPR * k, 0, 0, DPR * k, DPR * (SW / 2 - cam.x * par * k + shakeX), DPR * (SH * VY() - cam.y * k + shakeY));
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
function fillStroke(fill, lw = 2.5) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
}

function render() {
  screenT();
  shakeX = (Math.random() - 0.5) * shake * 16 * U;
  shakeY = (Math.random() - 0.5) * shake * 16 * U;
  const r = run;
  drawRoom();
  if (!r) return;
  worldT();
  const items = r.room.items;
  const vx0 = cam.x - SW / KZ() / 2 - 120, vx1 = cam.x + SW / KZ() / 2 + 120;
  for (const it of items) if (it.x + it.fw / 2 > vx0 && it.x - it.fw / 2 < vx1) drawItem(it);
  if (r.puddle) drawPuddle(r.puddle);
  drawFlag(r);
  drawHint(r);
  drawTrail(r);
  drawBottle(r.b, skin(r), 1, r);
  drawParts(r);
  screenT();
  drawPops(r);
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
  if (REC) drawCaptions(r);
}

// ---------- room background
function drawRoom() {
  if (bgK < 1) drawRoomLayer(bgFrom, 1);
  drawRoomLayer(bgZone, bgK < 1 ? ease(bgK) : 1);
}
function drawRoomLayer(z, alpha) {
  const Z = ZONES[z % ZONES.length];
  const wall = hexRgb(Z.wall), wall2 = hexRgb(Z.wall2);
  g.globalAlpha = alpha;
  screenT();
  const floorS = SY(0);
  const gr = g.createLinearGradient(0, 0, 0, floorS);
  gr.addColorStop(0, css(Z.night ? hexRgb(Z.sky) : shade(wall, 1.06)));
  gr.addColorStop(1, css(Z.night ? wall2 : wall));
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, Math.max(0, floorS) + 2);
  const PAR = 0.55;
  const k = KZ();
  const toW = sx => cam.x * PAR + (sx - SW / 2) / k; // parallax world x at screen x
  const x0 = toW(-40), x1 = toW(SW + 40);
  worldT(PAR);
  const yTop = cam.y - (SH * VY()) / k - 40;
  if (Z.pattern === 'dots') {
    g.fillStyle = css(shade(wall, 1.12));
    for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44)
      for (let y = -24, j = 0; y > yTop; y -= 44, j++) {
        g.beginPath();
        g.arc(x + (j % 2) * 22, y, 4, 0, TAU);
        g.fill();
      }
  } else if (Z.pattern === 'tiles') {
    g.strokeStyle = css(shade(wall, 1.15), 0.8);
    g.lineWidth = 2;
    g.beginPath();
    for (let x = Math.floor(x0 / 36) * 36; x < x1; x += 36) {
      g.moveTo(x, -14);
      g.lineTo(x, yTop);
    }
    for (let y = -14; y > yTop; y -= 36) {
      g.moveTo(x0, y);
      g.lineTo(x1, y);
    }
    g.stroke();
  } else if (Z.pattern === 'stripes') {
    g.fillStyle = css(shade(wall, 1.08));
    for (let x = Math.floor(x0 / 60) * 60; x < x1; x += 60) g.fillRect(x, yTop, 30, -yTop);
    g.fillStyle = css(shade(wall, 0.9));
    g.fillRect(x0, -120, x1 - x0, 8);
  } else if (Z.pattern === 'city') {
    // stars
    for (let i = Math.floor(x0 / 30); i < x1 / 30; i++) {
      const sy = -140 - hash(i) * 520;
      if (sy < yTop) continue;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(tReal * 1.5 + i));
      g.fillStyle = `rgba(255,255,255,${0.5 * tw})`;
      g.fillRect(i * 30 + hash(i * 3) * 30, sy, 2.2, 2.2);
    }
    // moon
    const mx = Math.floor(x0 / 1400) * 1400 + 700;
    g.fillStyle = '#fff6cf';
    g.beginPath();
    g.arc(mx, -420, 34, 0, TAU);
    g.fill();
    g.fillStyle = css(hexRgb(Z.sky));
    g.beginPath();
    g.arc(mx + 14, -428, 30, 0, TAU);
    g.fill();
  }
  // decor: windows, frames, posters
  for (let i = Math.floor(x0 / 300) - 1; i < x1 / 300 + 1; i++) drawDecor(Z, i, z);
  // floor and skirting (no parallax)
  worldT();
  const fx0 = cam.x - SW / k / 2 - 50, fx1 = cam.x + SW / k / 2 + 50;
  const floorH = Math.max(40, (SH - floorS) / k + 60);
  g.fillStyle = Z.floor;
  g.fillRect(fx0, 0, fx1 - fx0, floorH);
  g.fillStyle = Z.floor2;
  if (Z.pattern === 'tiles') {
    for (let x = Math.floor(fx0 / 60) * 60; x < fx1; x += 60)
      for (let y = 0, j = 0; y < floorH; y += 30, j++) if ((x / 60 + j) % 2 === 0) g.fillRect(x, y, 60, 30);
  } else if (Z.pattern === 'city') {
    g.fillRect(fx0, 0, fx1 - fx0, 6);
    for (let x = Math.floor(fx0 / 90) * 90; x < fx1; x += 90) g.fillRect(x, 6, 3, floorH);
  } else {
    for (let y = 18, j = 0; y < floorH; y += 18, j++) {
      g.fillRect(fx0, y, fx1 - fx0, 2.5);
      for (let x = Math.floor(fx0 / 120) * 120 + (j % 2) * 60; x < fx1; x += 120) g.fillRect(x, y - 18, 2.5, 18);
    }
  }
  if (Z.pattern === 'city') {
    // parapet
    g.fillStyle = Z.skirt;
    g.fillRect(fx0, -34, fx1 - fx0, 34);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = Math.floor(fx0 / 50) * 50; x < fx1; x += 50) g.fillRect(x, -34, 2, 34);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(fx0, -34, fx1 - fx0, 4);
  } else {
    g.fillStyle = Z.skirt;
    g.fillRect(fx0, -14, fx1 - fx0, 14);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(fx0, -2, fx1 - fx0, 2);
  }
  // soft shadow where floor meets wall
  const sg = g.createLinearGradient(0, 0, 0, 26);
  sg.addColorStop(0, 'rgba(0,0,0,0.16)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sg;
  g.fillRect(fx0, 0, fx1 - fx0, 26);
  g.globalAlpha = 1;
  screenT();
}

function drawDecor(Z, i, z) {
  const h = hash(i * 7.3 + z * 13.1);
  const x = i * 300 + 40 + hash(i * 3.1) * 120;
  let kind = Z.pattern === 'city' ? 'city' : h < 0.36 ? 'window' : h < 0.64 ? 'frame' : h < 0.9 ? 'poster' : 'clock';
  if (OG && kind === 'poster') kind = 'window'; // a bottle poster next to the real bottle reads as clutter at thumbnail size
  g.lineJoin = 'round';
  if (kind === 'city') {
    // skyline block behind the parapet
    const bw = 90 + hash(i * 1.7) * 120, bh = 140 + hash(i * 2.9) * 260;
    g.fillStyle = css(mix(hexRgb(Z.wall2), [10, 10, 40], 0.35));
    g.fillRect(x - bw / 2, -bh, bw, bh);
    for (let wy = -bh + 16; wy < -40; wy += 22)
      for (let wx = x - bw / 2 + 12; wx < x + bw / 2 - 10; wx += 20) {
        const on = hash(wx * 0.37 + wy * 1.13) < 0.42;
        if (!on) continue;
        g.fillStyle = hash(wx + wy) < 0.5 ? 'rgba(255,233,168,0.85)' : 'rgba(124,243,255,0.7)';
        g.fillRect(wx, wy, 9, 11);
      }
    return;
  }
  const y = -210 - hash(i * 5.7) * 60;
  if (kind === 'window') {
    rr(x - 58, y - 70, 116, 130, 10);
    fillStroke('#ffffff', 3);
    const sky = g.createLinearGradient(0, y - 62, 0, y + 52);
    sky.addColorStop(0, Z.sky);
    sky.addColorStop(1, '#ffffff');
    g.fillStyle = sky;
    g.fillRect(x - 50, y - 62, 100, 114);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    const cx = x - 30 + ((tReal * 6 + i * 40) % 100);
    g.beginPath();
    g.arc(cx, y - 25, 10, 0, TAU);
    g.arc(cx + 12, y - 28, 13, 0, TAU);
    g.arc(cx + 24, y - 24, 9, 0, TAU);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(x - 3, y - 62, 6, 114);
    g.fillRect(x - 50, y - 8, 100, 6);
    // curtains
    g.fillStyle = Z.accent;
    rr(x - 72, y - 78, 22, 150, 8);
    fillStroke(Z.accent, 2.5);
    rr(x + 50, y - 78, 22, 150, 8);
    fillStroke(Z.accent, 2.5);
  } else if (kind === 'frame') {
    rr(x - 40, y - 34, 80, 64, 4);
    fillStroke('#f6e7c8', 3);
    g.fillStyle = Z.cols[(i * 7 + 99) % Z.cols.length];
    g.fillRect(x - 30, y - 24, 60, 44);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.moveTo(x - 30, y + 20);
    g.lineTo(x - 8, y - 6);
    g.lineTo(x + 8, y + 8);
    g.lineTo(x + 18, y - 2);
    g.lineTo(x + 30, y + 20);
    g.fill();
  } else if (kind === 'poster') {
    g.save();
    g.translate(x, y);
    g.rotate((hash(i) - 0.5) * 0.12);
    rr(-34, -46, 68, 92, 3);
    fillStroke(Z.cols[(i * 3 + 5) % Z.cols.length], 2.5);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    // a little bottle silhouette mid-flip
    g.rotate(0.6);
    rr(-6, -18, 12, 30, 3);
    g.fill();
    g.fillRect(-4, -24, 8, 6);
    g.restore();
  } else {
    g.beginPath();
    g.arc(x, y, 26, 0, TAU);
    fillStroke('#ffffff', 3);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(tReal * 0.5) * 16, y + Math.sin(tReal * 0.5) * 16);
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(tReal * 6) * 20, y + Math.sin(tReal * 6) * 20);
    g.stroke();
  }
}

// ---------- furniture
function drawItem(it) {
  const { w, h, fw } = it;
  const c1 = css(it.c1), c2 = css(it.c2);
  const wood = ZONES[it.z].floor2;
  g.save();
  g.translate(it.x, 0);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.beginPath();
  g.ellipse(0, 1, fw / 2 + 6, 5, 0, 0, TAU);
  g.fill();
  g.lineJoin = 'round';
  switch (it.type) {
    case 'books':
      for (const bk of it.books) {
        rr(-bk.w / 2 + bk.dx, -bk.y - bk.h, bk.w, bk.h, 3);
        fillStroke(css(bk.c));
        g.fillStyle = '#fffaf0';
        g.fillRect(bk.w / 2 + bk.dx - 9, -bk.y - bk.h + 3, 6, bk.h - 6);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.fillRect(-bk.w / 2 + bk.dx + 8, -bk.y - bk.h + 2, 4, bk.h - 4);
      }
      break;
    case 'stool': {
      g.strokeStyle = INK;
      g.lineWidth = 9;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-w / 2 + 10, -h + 8);
      g.lineTo(-w / 2 + 2, -2);
      g.moveTo(w / 2 - 10, -h + 8);
      g.lineTo(w / 2 - 2, -2);
      g.moveTo(-w / 2 + 6, -h * 0.38);
      g.lineTo(w / 2 - 6, -h * 0.38);
      g.stroke();
      g.strokeStyle = wood;
      g.lineWidth = 5;
      g.stroke();
      g.lineCap = 'butt';
      rr(-w / 2, -h, w, 11, 5);
      fillStroke(c1);
      break;
    }
    case 'desk':
    case 'counter': {
      const top = it.type === 'counter' ? '#f4f1ea' : wood;
      if (it.type === 'counter') {
        rr(-w / 2 + 4, -h + 9, w - 8, h - 9, 4);
        fillStroke(c1);
        g.strokeStyle = INK;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, -h + 14);
        g.lineTo(0, -10);
        g.stroke();
        g.fillStyle = INK;
        g.fillRect(-12, -h * 0.6, 4, 16);
        g.fillRect(8, -h * 0.6, 4, 16);
        g.fillRect(-w / 2 + 4, -10, w - 8, 10);
      } else {
        rr(-w / 2 + 6, -h + 8, 9, h - 8, 2);
        fillStroke(wood);
        rr(w / 2 - 15, -h + 8, 9, h - 8, 2);
        fillStroke(wood);
        rr(w / 2 - 58, -h + 10, 42, h * 0.42, 3);
        fillStroke(c1);
        g.fillStyle = INK;
        g.fillRect(w / 2 - 42, -h + 10 + h * 0.2, 10, 3);
      }
      rr(-w / 2 - 2, -h, w + 4, 11, 3);
      fillStroke(top);
      break;
    }
    case 'box':
    case 'crate': {
      const n = it.stack || 1;
      const bh = h / n;
      for (let k = 0; k < n; k++) {
        const bw = (k === n - 1 ? w - 8 : w) - 4;
        const y = -bh * (k + 1);
        if (it.type === 'box') {
          rr(-bw / 2, y, bw, bh, 3);
          fillStroke('#d9a066');
          g.fillStyle = '#e9c48a';
          g.fillRect(-7, y + 1, 14, bh * 0.45);
          g.strokeStyle = 'rgba(80,40,10,0.35)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(-bw / 2 + 4, y + 10);
          g.lineTo(bw / 2 - 4, y + 10);
          g.stroke();
          if (k === 0 && bh > 40) {
            g.fillStyle = '#c0392b';
            g.font = '700 9px system-ui, sans-serif';
            g.textAlign = 'center';
            g.fillText('FRAGILE', 0, y + bh * 0.7);
          }
        } else {
          rr(-bw / 2, y, bw, bh, 2);
          fillStroke('#b98a52');
          g.strokeStyle = '#7a5530';
          g.lineWidth = 3;
          g.beginPath();
          for (let p = 1; p < 3; p++) {
            g.moveTo(-bw / 2 + 3, y + (bh * p) / 3);
            g.lineTo(bw / 2 - 3, y + (bh * p) / 3);
          }
          g.moveTo(-bw / 2 + 4, y + 4);
          g.lineTo(bw / 2 - 4, y + bh - 4);
          g.stroke();
        }
      }
      break;
    }
    case 'shelf': {
      rr(-w / 2, -h, w, h, 4);
      fillStroke(wood);
      const rows = 3;
      const ih = (h - 20) / rows;
      for (let k = 0; k < rows; k++) {
        const y = -h + 10 + k * ih;
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(-w / 2 + 7, y, w - 14, ih - 6);
        let bx = -w / 2 + 10;
        let j = 0;
        while (bx < w / 2 - 16) {
          const bw = 7 + hash(it.seed + k * 31 + j) * 7;
          const bh = ih * (0.55 + hash(it.seed + j * 7 + k) * 0.35);
          g.fillStyle = ZONES[it.z].cols[(j + k) % ZONES[it.z].cols.length];
          g.fillRect(bx, y + ih - 6 - bh, bw, bh);
          bx += bw + 2;
          j++;
        }
      }
      break;
    }
    case 'bed': {
      rr(-fw / 2 - 4, -h - 34, 14, h + 34, 5);
      fillStroke(wood);
      rr(-fw / 2 + 4, -h + 16, fw - 6, h - 22, 4);
      fillStroke(wood);
      rr(-fw / 2 + 6, -h, fw - 10, 20, 8);
      fillStroke('#ffffff');
      rr(-fw / 2 + 12, -h - 10, 40, 16, 7);
      fillStroke('#ffffff');
      rr(-fw / 2 + 60, -h + 1, fw - 66, 18, 7);
      fillStroke(c1);
      break;
    }
    case 'speaker': {
      rr(-w / 2, -h, w, h, 6);
      fillStroke('#2a2540');
      const p = 1 + pulse * 0.08;
      for (const [cy, rad] of [[-h * 0.72, 12], [-h * 0.32, 20]]) {
        g.beginPath();
        g.arc(0, cy, rad * p, 0, TAU);
        fillStroke('#4a4366', 2);
        g.fillStyle = '#15121f';
        g.beginPath();
        g.arc(0, cy, rad * 0.45 * p, 0, TAU);
        g.fill();
      }
      g.fillStyle = ZONES[it.z].accent;
      g.fillRect(-w / 2 + 6, -h + 6, 6, 4);
      break;
    }
    case 'fridge': {
      rr(-w / 2, -h, w, h, 10);
      fillStroke(c1 === 'rgba(255,255,255,1)' ? '#f4fbff' : c1);
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-w / 2, -h * 0.64);
      g.lineTo(w / 2, -h * 0.64);
      g.stroke();
      g.fillStyle = INK;
      rr(w / 2 - 14, -h * 0.64 - 40, 5, 30, 2);
      g.fill();
      rr(w / 2 - 14, -h * 0.64 + 12, 5, 40, 2);
      g.fill();
      for (let k = 0; k < 4; k++) {
        g.fillStyle = ZONES[it.z].cols[(k + 2) % 5] === '#ffffff' ? '#ff9b85' : ZONES[it.z].cols[(k + 2) % 5];
        g.beginPath();
        g.arc(-w / 2 + 18 + hash(it.seed + k) * (w - 40), -h * 0.45 + hash(it.seed * 3 + k) * h * 0.3, 5, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'washer': {
      rr(-w / 2, -h, w, h, 8);
      fillStroke('#fbfdff');
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(-w / 2 + 3, -h + 3, w - 6, 16);
      g.beginPath();
      g.arc(0, -h * 0.45, w * 0.3, 0, TAU);
      fillStroke('#cfd8e6', 3);
      g.save();
      g.beginPath();
      g.arc(0, -h * 0.45, w * 0.24, 0, TAU);
      g.clip();
      g.fillStyle = '#7cc8ff';
      g.fillRect(-w * 0.3, -h * 0.45 - w * 0.06 + Math.sin(tReal * 3) * 3, w * 0.6, w * 0.4);
      g.fillStyle = css(it.c1);
      g.beginPath();
      g.arc(Math.cos(tReal * 4) * 9, -h * 0.45 + Math.sin(tReal * 4) * 9, 6, 0, TAU);
      g.fill();
      g.restore();
      break;
    }
    case 'bin': {
      g.beginPath();
      g.moveTo(-w / 2 + 4, -h + 8);
      g.lineTo(w / 2 - 4, -h + 8);
      g.lineTo(w / 2 - 9, 0);
      g.lineTo(-w / 2 + 9, 0);
      g.closePath();
      fillStroke(c1 === 'rgba(255,255,255,1)' ? '#9aa5b8' : c1);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(-4, -h + 14, 8, h - 20);
      rr(-w / 2, -h, w, 10, 4);
      fillStroke(css(shade(it.c1, 0.8)));
      break;
    }
    case 'ac': {
      rr(-w / 2, -h, w, h, 6);
      fillStroke('#c9cfe6');
      g.beginPath();
      g.arc(w * 0.18, -h * 0.5, h * 0.36, 0, TAU);
      fillStroke('#8d95b8', 2);
      g.save();
      g.translate(w * 0.18, -h * 0.5);
      g.rotate(tReal * 9);
      g.fillStyle = '#5b5f86';
      for (let k = 0; k < 3; k++) {
        g.rotate(TAU / 3);
        g.beginPath();
        g.ellipse(0, -h * 0.17, h * 0.07, h * 0.16, 0, 0, TAU);
        g.fill();
      }
      g.restore();
      g.strokeStyle = 'rgba(27,20,51,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      for (let y = -h + 12; y < -8; y += 9) {
        g.moveTo(-w / 2 + 8, y);
        g.lineTo(-w * 0.12, y);
      }
      g.stroke();
      break;
    }
    case 'tank': {
      g.strokeStyle = INK;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(-w / 2 + 12, -h * 0.25);
      g.lineTo(-w / 2 + 6, 0);
      g.moveTo(w / 2 - 12, -h * 0.25);
      g.lineTo(w / 2 - 6, 0);
      g.stroke();
      rr(-w / 2, -h, w, h * 0.78, 14);
      fillStroke(c1);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(-w / 2 + 10, -h + 12, 8, h * 0.6);
      g.strokeStyle = 'rgba(27,20,51,0.4)';
      g.lineWidth = 2;
      g.beginPath();
      for (const yy of [0.35, 0.6]) {
        g.moveTo(-w / 2 + 2, -h + h * yy);
        g.lineTo(w / 2 - 2, -h + h * yy);
      }
      g.stroke();
      break;
    }
  }
  g.restore();
}

function drawPuddle(p) {
  g.fillStyle = css(p.col, 0.55);
  g.beginPath();
  g.ellipse(p.x, 2, p.r, p.r * 0.12, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.ellipse(p.x - p.r * 0.3, 1, p.r * 0.25, p.r * 0.03, 0, 0, TAU);
  g.fill();
}

function drawFlag(r) {
  if (r.bot || bestN < 2 || r.passedBest) return;
  const it = r.room.items[bestN];
  if (!it) return;
  const x = it.x + it.fw / 2 - 6, y = -it.h;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 62);
  g.stroke();
  const wv = Math.sin(tReal * 6) * 3;
  g.beginPath();
  g.moveTo(x, y - 62);
  g.lineTo(x + 50, y - 54 + wv);
  g.lineTo(x, y - 40);
  g.closePath();
  fillStroke(css(pal.glow), 2.5);
  g.fillStyle = INK;
  g.font = `11px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('BEST', x + 4, y - 52 + wv * 0.4);
}

// "2x?" bubble over the target when this jump has room for a double flip
function drawHint(r) {
  if (r.state !== 'ready' && r.state !== 'air') return;
  if (r.attract || (REC && !Q.has('hint'))) return;
  const f = r.state === 'air' ? r.fl : makeFlightPeek(r);
  if (!f || maxTurns(f) < 2.12) return;
  const it = r.room.items[r.cur + 1];
  const x = it.x + it.lx, y = -it.h - 92 + Math.sin(tReal * 4) * 4;
  rr(x - 30, y - 16, 60, 30, 15);
  fillStroke(css(pal.glow), 2.5);
  g.fillStyle = INK;
  g.font = `15px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('2X?', x, y + 1);
  g.beginPath();
  g.moveTo(x - 6, y + 14);
  g.lineTo(x, y + 22);
  g.lineTo(x + 6, y + 14);
  g.fillStyle = css(pal.glow);
  g.fill();
}
function makeFlightPeek(r) {
  if (r.room.items.length < r.cur + 2) return null;
  if (!r.peek || r.peek.cur !== r.cur) r.peek = { cur: r.cur, f: makeFlight(r) };
  return r.peek.f;
}

// ---------- bottle
const BODY = [[-12, -8], [-12, 30], [12, 30], [12, -8], [6, -18], [6, -23], [-6, -23], [-6, -18]];
const polyArea = P => {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
const BODY_A = polyArea(BODY);
// keep the part of polygon P where n.p >= d
function clipHalf(P, nx, ny, d) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = a[0] * nx + a[1] * ny - d, db = b[0] * nx + b[1] * ny - d;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
function waterLevel(nx, ny, frac) {
  let lo = -40, hi = 40;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const a = polyArea(clipHalf(BODY, nx, ny, mid));
    if (a > frac * BODY_A) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function bodyPath() {
  g.beginPath();
  g.moveTo(-12, -8);
  g.lineTo(-12, 26);
  g.quadraticCurveTo(-12, 30, -8, 30);
  g.lineTo(8, 30);
  g.quadraticCurveTo(12, 30, 12, 26);
  g.lineTo(12, -8);
  g.quadraticCurveTo(12, -15, 6, -18);
  g.lineTo(6, -23);
  g.lineTo(-6, -23);
  g.lineTo(-6, -18);
  g.quadraticCurveTo(-12, -15, -12, -8);
  g.closePath();
}
function skin(r) {
  const id = skinId;
  return BOTTLES.find(s => s.id === id) || BOTTLES[0];
}
function hslRgb(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function drawBottle(b, sk, alpha = 1, r = null, scale = 1) {
  const sq = clamp(b.sq * 0.02, -0.12, 0.12);
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.th);
  g.scale(scale * (1 + sq), scale * (1 - sq));
  g.globalAlpha = alpha;
  const galaxy = sk.glass === 'galaxy';
  const glass = galaxy ? hslRgb((tReal * 80) % 360, 0.8, 0.6) : hexRgb(sk.glass);
  // glow for special bottles
  if (sk.glow && alpha === 1) {
    g.shadowColor = sk.liquid;
    g.shadowBlur = 18 * K;
  }
  bodyPath();
  g.fillStyle = css(glass, sk.ga);
  g.fill();
  g.shadowBlur = 0;
  // water stays level with the world (gravity is +y on screen)
  g.save();
  bodyPath();
  g.clip();
  // gravity in local space is (sin th, cos th); slosh tilts it a little
  const gx = Math.sin(b.th - (b.slosh || 0)), gy = Math.cos(b.th - (b.slosh || 0));
  const d = waterLevel(gx, gy, 0.42);
  const tx = -gy, ty = gx;
  const px = gx * d, py = gy * d;
  g.beginPath();
  g.moveTo(px + tx * 80, py + ty * 80);
  g.lineTo(px - tx * 80, py - ty * 80);
  g.lineTo(px - tx * 80 + gx * 90, py - ty * 80 + gy * 90);
  g.lineTo(px + tx * 80 + gx * 90, py + ty * 80 + gy * 90);
  g.closePath();
  g.fillStyle = sk.liquid;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(px + tx * 80, py + ty * 80);
  g.lineTo(px - tx * 80, py - ty * 80);
  g.stroke();
  // label
  g.fillStyle = sk.label;
  g.fillRect(-13, -1, 26, 15);
  g.fillStyle = sk.stripe;
  g.fillRect(-13, 4, 26, 4);
  // ribs
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(-13, 18, 26, 2);
  g.fillRect(-13, 23, 26, 2);
  // highlight
  g.fillStyle = 'rgba(255,255,255,0.55)';
  rr(-8, -10, 4, 34, 2);
  g.fill();
  g.restore();
  bodyPath();
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
  // cap
  rr(-7.5, -30, 15, 8, 2);
  fillStroke(sk.cap, 2.4);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let x = -4.5; x <= 4.5; x += 3) {
    g.moveTo(x, -28.5);
    g.lineTo(x, -23.5);
  }
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
  void r;
}

function drawTrail(r) {
  if (r.state !== 'air') return;
  const sk = skin(r);
  for (let i = 0; i < r.trail.length - 1; i += 2) {
    const p = r.trail[i];
    const a = (i / r.trail.length) * 0.22 * clamp(r.b.w / 6, 0, 1);
    if (a < 0.02) continue;
    drawBottle({ x: p.x, y: p.y, th: p.th, slosh: 0, sq: 0 }, sk, a);
  }
}

function drawParts(r) {
  for (const p of r.parts) {
    const k = p.life / p.max;
    if (p.kind === 'dust') {
      g.fillStyle = `rgba(255,255,255,${0.5 * k})`;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, TAU);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = 4 * k;
      g.beginPath();
      g.ellipse(p.x, p.y, (1 - k) * 80 + 10, ((1 - k) * 80 + 10) * 0.25, 0, 0, TAU);
      g.stroke();
    } else if (p.kind === 'confetti') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = css(p.col, Math.min(1, k * 2));
      g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6 * Math.abs(Math.cos(p.rot * 1.3)) + 1);
      g.restore();
    } else if (p.kind === 'drop') {
      g.fillStyle = css(p.col, Math.min(1, k * 2));
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, TAU);
      g.fill();
    } else if (p.kind === 'gem') {
      drawGemW(p.x, p.y, p.size, Math.min(1, k * 2));
    } else if (p.kind === 'cap') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      rr(-7.5, -4, 15, 8, 2);
      fillStroke(css(p.col), 2.2);
      g.restore();
    }
  }
}
function drawGemW(x, y, s, a = 1) {
  g.globalAlpha = a;
  g.beginPath();
  g.moveTo(x, y - s * 1.25);
  g.lineTo(x + s, y);
  g.lineTo(x, y + s * 1.25);
  g.lineTo(x - s, y);
  g.closePath();
  fillStroke('#ffd650', 2);
  g.globalAlpha = 1;
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
  const top = (REC ? 300 : 0) + 130 * U;
  for (const p of r.pops) {
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const x = clamp(SX(p.x), 120 * U, SW - 120 * U);
    const y = Math.max(top, SY(p.y) - (p.small ? 0 : 20 + ease(k) * 40) * U);
    g.globalAlpha = a;
    if (p.text) text(p.text, x, y, (p.small ? 20 : 30) * U * sc, css(p.col), 'center', { stroke: 7 * U * Math.max(0.6, sc) });
    if (p.sub) text(p.sub, x, y + 30 * U * sc, 20 * U * Math.min(1.2, sc), '#ffd650', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(28 * U, 20);
  const bump = 1 + r.scoreBump * 0.25;
  text(String(r.score), SW / 2, top + 30 * U, 56 * U * bump, '#fff', 'center', { stroke: 9 * U });
  if (r.streak >= 2) {
    const hype = r.streak >= 13;
    text((hype ? 'HYPE x2  ·  ' : 'STREAK ') + 'x' + r.streak, SW / 2, top + 72 * U, 16 * U, hype ? '#fff' : css(pal.glow), 'center', { stroke: 5 * U });
  }
  if (r.layerPop) {
    const k = r.layerPop.t / 1.5;
    g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const sc = back(r.layerPop.t / 0.25);
    text(r.layerPop.name === 'HYPE' ? 'HYPE MODE!' : '♪ + ' + (r.layerPop.name === '808' ? 'BASS' : r.layerPop.name), SW / 2, top + 98 * U, 15 * U * sc, '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 16 * U, '#ffd650', 'left', { stroke: 5 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.2;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.36 : 0.3);
    g.fillStyle = 'rgba(27,20,51,0.55)';
    g.fillRect(0, y - 38 * U, SW, 76 * U);
    text(b.text, SW / 2, y - 7 * U, 32 * U * back(b.t / 0.3), '#fff', 'center', { stroke: 6 * U });
    text(b.sub, SW / 2, y + 24 * U, 13 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  const ty = REC ? SH * 0.86 : Math.min(SH - 70 * U, SH * 0.84);
  if (r.tutorial && !r.dead && r.n < 3) {
    const b = r.b;
    if (r.state === 'ready' && r.readyT > 0.25) {
      const p = 0.5 + 0.5 * Math.sin(tReal * 6);
      text(r.n === 0 ? 'HOLD TO FLIP' : 'HOLD AGAIN', SW / 2, ty, (24 + p * 2) * U, '#fff', 'center', { stroke: 7 * U });
      text('let go when it’s upright to land it', SW / 2, ty + 30 * U, 13 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
    } else if (r.state === 'air') {
      const d = b.th - b.th0;
      if (b.held && d > TAU * 0.6 && d < TAU * 1.08) text('LET GO!', SW / 2, ty, 38 * U, css(pal.glow), 'center', { stroke: 8 * U });
      else if (b.held && d < TAU * 0.6) text('keep holding…', SW / 2, ty, 18 * U, '#fff', 'center', { stroke: 5 * U });
    }
  } else if (r.tipCap && !r.dead && r.n >= 2 && r.n < 6 && r.state !== 'air') {
    text('pro tip: land it on the CAP for +5', SW / 2, ty, 14 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  }
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
  g.fillStyle = 'rgba(27,20,51,0.4)';
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
  buttons.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, act: toggleSound });
}

function pill(label, x, y, w, h, bg, fg, act, size = 20) {
  g.fillStyle = 'rgba(27,20,51,0.35)';
  rr(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  rr(x - w / 2, y - h / 2, w, h, h / 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 3 * U;
  g.strokeStyle = INK;
  g.stroke();
  text(label, x, y + 1, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

function drawTitleWords(x, y, s, wob) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.06 + wob);
  text('CAP', 0, -40 * s, 66 * s, '#fff', 'center', { stroke: 12 * s });
  text('FLIP', 0, 26 * s, 74 * s, '#2fb8ff', 'center', { stroke: 12 * s });
  g.restore();
}

function drawTitle() {
  const wd = wide();
  const cx = wd ? SW * 0.27 : SW / 2;
  const y = wd ? SH * 0.3 : Math.max(SH * 0.15, 104 * U);
  drawTitleWords(cx, y, U * (wd ? 1.25 : 1.3), Math.sin(tReal * 2.2) * 0.02);
  text('the bottle flip game', cx, y + (wd ? 92 : 100) * U, 17 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 5 * U });
  text('land it on the cap for 5x', cx, y + (wd ? 114 : 124) * U, 15 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  const yb = wd ? SH * 0.62 : SH - 150 * U;
  text('TAP TO PLAY', cx, yb, (27 + p * 3) * U, '#fff', 'center', { stroke: 8 * U });
  if (best > 0) text('BEST ' + best, cx, yb + 34 * U, 15 * U, css(pal.glow), 'center', { stroke: 5 * U });
  pill('BOTTLES', cx, yb + 76 * U, 150 * U, 38 * U, '#ffffff', INK, openShop, 15);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 16 * U, '#ffd650', 'left', { stroke: 5 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(27,20,51,0.78)');
  gr.addColorStop(1, 'rgba(27,20,51,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.25, y = SH * 0.38;
  drawTitleWords(x, y, 2.05, 0);
  text('the bottle flip game', x, y + 170, 34, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '900', stroke: 9 });
  text('land it on the cap for 5x · free, no download', x, y + 214, 22, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 6 });
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(27,20,51,${0.5 * k})`;
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
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 42 * U, 32 * U * back(overT / 0.4), '#2fb8ff', 'center', { stroke: 6 * U, strokeColor: INK });
  else text('SPLASH!', SW / 2, t0 + 42 * U, 32 * U, '#2fb8ff', 'center', { stroke: 6 * U });
  text(String(r.score), SW / 2, t0 + 106 * U, 74 * U, INK);
  let sub;
  if (REC) sub = r.caps ? r.caps + ' cap flip' + (r.caps > 1 ? 's' : '') + ' · can you beat ' + r.score + '?' : 'can you beat ' + r.score + '?';
  else if (r.n === 0) sub = 'hold to spin, let go when it’s upright';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 5) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = r.n + ' landed · ' + r.perfects + ' perfect · ' + r.caps + ' cap';
  text(sub, SW / 2, t0 + 156 * U, 15 * U, '#7a4fd6', 'center', { font: 'system-ui, sans-serif', weight: '800' });
  if (REC) {
    text('CAP FLIP', SW / 2, t0 - 40 * U, 40 * U, '#fff', 'center', { stroke: 9 * U });
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, INK, 'center', { font: 'system-ui, sans-serif', weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 240 * U, 17 * U, '#2fb8ff', 'center', { font: 'system-ui, sans-serif', weight: '900' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 188 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 189 * U, 17 * U, '#e0a800', 'left');
    pill('RETRY', SW / 2, t0 + 242 * U, cw - 60 * U, 54 * U, '#2fb8ff', '#fff', startGame, 26);
    pill('SHARE', SW / 2 - 75 * U, t0 + 298 * U, 130 * U, 36 * U, '#e9f6ff', INK, share, 15);
    pill('BOTTLES', SW / 2 + 75 * U, t0 + 298 * U, 130 * U, 36 * U, '#e9f6ff', INK, openShop, 15);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, cy + ch / 2 + 26 * U, 13 * U, 'rgba(255,255,255,0.9)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');
const cap2On = r => REC && rec && !!Q.get('cap2') && rec.crashAt != null && !r.dead && r.n === rec.crashAt && r.state === 'air';

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    hook.forEach((ln, i) => text(ln, SW / 2, 340 + i * 96, 72, i === hook.length - 1 ? '#ffd23f' : '#fff', 'center', { stroke: 18 }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  if (cap2 && cap2On(r)) text(cap2, SW / 2, 330, 66, '#fff', 'center', { stroke: 16 });
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
  const txt = `I scored ${r.score} on CAP FLIP 🧴 (${r.caps} cap landing${r.caps === 1 ? '' : 's'}). bottle flip, but you can land it on the cap. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Cap Flip', text: txt, url });
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
  for (const s of BOTTLES) {
    const have = owned.includes(s.id);
    const b = document.createElement('button');
    b.className = 'car' + (s.id === skinId ? ' sel' : '') + (have ? '' : ' locked');
    const bg = s.glass === 'galaxy' ? 'linear-gradient(180deg,#ff5df0,#7cf3ff,#2fb8ff)' : `linear-gradient(180deg, ${s.glass} 0 45%, ${s.liquid} 45%)`;
    b.innerHTML = `<i style="background:${bg};--cap:${s.cap}"></i><b>${s.name}</b><span>${have ? (s.id === skinId ? 'FLIPPING' : 'SELECT') : '◆ ' + s.price}</span>`;
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
        toast(`Need ${s.price - coins} more ◆ — land more perfects!`);
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
  if (run && !run.bot) run.needRelease = false;
}
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'Enter') return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page mid-run
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    press(null, null);
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') release();
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
if (OG) {
  document.querySelector('.back') && (document.querySelector('.back').style.display = 'none');
  document.body.style.overflow = 'hidden';
  run = newRun({ seed: 5, bot: true });
  run.room.ensure(10);
  mode = 'og';
  // freeze the bottle mid-flip between two items
  run.fl = makeFlight(run);
  run.state = 'air';
  run.fl.tau = run.fl.T * 0.6;
  const f = run.fl;
  run.b.x = f.x0 + f.vx * f.tau;
  run.b.y = f.y0 + f.vy * f.tau + 0.5 * GRAV * f.tau * f.tau;
  run.b.th = 2.35;
  run.b.w = 8;
  for (let i = 0; i < 9; i++) {
    const tt = f.tau - (9 - i) * 0.025;
    run.trail.push({ x: f.x0 + f.vx * tt, y: f.y0 + f.vy * tt + 0.5 * GRAV * tt * tt, th: 2.35 - (9 - i) * 0.2 });
  }
  snapCam();
  // hand-placed: bottle mid-flip, high over the gap, both pieces of furniture in frame
  const i0 = run.room.items[0], i1 = run.room.items[1];
  const top = Math.max(-i0.h, -i1.h);
  run.b.x = (i0.x + i1.x) / 2;
  run.b.y = Math.min(-i0.h, -i1.h) - 120;
  run.trail = [];
  for (let i = 0; i < 9; i++) run.trail.push({ x: run.b.x - (9 - i) * 7, y: run.b.y + (9 - i) * 2.5, th: 2.35 - (9 - i) * 0.2 });
  cam.x = run.b.x - 80;
  cam.y = top - (600 - SH * VY()) / K;
  document.fonts.load(`40px ${FONT}`).finally(() => {
    tReal = 0.3;
    render();
    window.__ogReady = true;
  });
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  // plan: dbl=<k,..> double flips · cap=<k,..> cap landings · ok=<k,..> wobbly landings · clutch=<k,..>
  const crashAt = +(Q.get('crash') || 12);
  const seed = +(Q.get('seed') || 3);
  const set = k => new Set((Q.get(k) || '').split(',').filter(Boolean).map(Number));
  const dbl = set('dbl'), capS = set('cap'), ok = set('ok'), clutch = set('clutch');
  rec = { t: 0, frame: 0, events: [], spin: [], states: [], musicStart: 0, crashAt };
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    bot: true,
    plan: (k, r) => {
      const flips = dbl.has(k) ? 2 : 1;
      if (k >= crashAt) return { flips, err: +(Q.get('crasherr') || 37) };
      if (capS.has(k)) return { flips, cap: true, err: (pr() - 0.5) * 6 };
      if (clutch.has(k)) return { flips, err: 29 };
      if (ok.has(k)) return { flips, err: 12 + pr() * 8 };
      return { flips, err: (pr() - 0.5) * 9 };
    },
  });
  run.tutorial = false;
  run.tipCap = false;
  mode = 'play';
  best = 0;
  bestN = 0;
  snapCam();
  rec.states.push({ t: 0, ...musicState() });
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.n, streak: run.streak, state: run.state, kind: run.lastKind, caps: run.caps, turns: run.fl ? +maxTurns(run.fl).toFixed(2) : 0 };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load(`40px ${FONT}`).then(() => (window.__recReady = true));
} else {
  run = newRun({ bot: true, attract: true });
  snapCam();
  if (QA) {
    window.__qaAhead = sec => (run.state === 'air' ? predictFinal(run, sec * run.fl.pace * run.slow) : 0);
    window.__qa = () => {
      const r = run, b = r.b, f = r.fl;
      return { mode, state: r.state, t: r.t, tr: tReal, score: r.score, n: r.n, streak: r.streak, dead: r.dead, kind: r.lastKind, landKind: r.land ? r.land.kind : null, perfects: r.perfects, caps: r.caps, best, coins, attract: r.attract, th: b.th, th0: b.th0, w: b.w, held: b.held, tau: f ? f.tau : 0, T: f ? f.T : 0, pace: f ? f.pace : 1, spin: f ? f.spin : 0, pred: r.state === 'air' ? predictFinal(r) : 0, lastE: r.lastE, flipsLast: r.land ? r.land.flips : null, maxTurns: f ? maxTurns(f) : 0, slow: r.slow };
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
