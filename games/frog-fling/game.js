import { Synth, Music, renderOffline, layerFor, gulpNote, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const URL_PLAY = 'arcadeaday.com/frog-fling';
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
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, k) => c.map(v => clamp(v * k, 0, 255));
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('ffl_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('ffl_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONES = [
  { name: 'SUNSET POND', top: '#3a2370', mid: '#ff7a6b', hor: '#ffd38a', orb: '#fff1b8', hill: '#6b3f7a', hill2: '#3d2556', water: '#2a4f7a', water2: '#173057', reed: '#16241f', glow: '#ffe66b', stars: 0 },
  { name: 'DUSK', top: '#1b1650', mid: '#a8457f', hor: '#ff9a6b', orb: '#ffd0a0', hill: '#4a2a63', hill2: '#2a1a45', water: '#25335f', water2: '#121b3d', reed: '#100f1f', glow: '#ffd36b', stars: 0.35 },
  { name: 'MOONLIGHT', top: '#050a26', mid: '#16306a', hor: '#3f73b0', orb: '#eaf4ff', hill: '#14244a', hill2: '#0b1533', water: '#0f2347', water2: '#06112a', reed: '#050a17', glow: '#c8ff6b', stars: 1 },
  { name: 'MIDNIGHT BOG', top: '#02060a', mid: '#0a2420', hor: '#1f5a43', orb: '#d6ffe0', hill: '#0a221c', hill2: '#051511', water: '#06201b', water2: '#020e0b', reed: '#010605', glow: '#8dff6b', stars: 1 },
  { name: 'AURORA', top: '#03081a', mid: '#0e3550', hor: '#2bbf9a', orb: '#f0fff8', hill: '#0b2235', hill2: '#061423', water: '#0a2c3e', water2: '#041824', reed: '#020a10', glow: '#6bfff0', stars: 1 },
  { name: 'BLOOD MOON', top: '#0c0208', mid: '#3a0a1c', hor: '#a8263a', orb: '#ff6b5a', hill: '#2a0812', hill2: '#16040a', water: '#2a0a16', water2: '#14040a', reed: '#080104', glow: '#ffb36b', stars: 0.8 },
];
const PAL_KEYS = ['top', 'mid', 'hor', 'orb', 'hill', 'hill2', 'water', 'water2', 'reed', 'glow'];
const zonePal = z => {
  const Z = ZONES[z % ZONES.length];
  const p = Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(Z[k])]));
  p.stars = Z.stars;
  return p;
};

export const SKINS = [
  { id: 'classic', name: 'CLASSIC', body: '#5fd35a', belly: '#e2f9b0', price: 0 },
  { id: 'peach', name: 'PEACH', body: '#ff8fb1', belly: '#ffe3ec', price: 60 },
  { id: 'berry', name: 'BLUEBERRY', body: '#3d7bff', belly: '#a8d4ff', price: 120 },
  { id: 'lemon', name: 'LEMON', body: '#ffd93d', belly: '#fff6c2', price: 200 },
  { id: 'tomato', name: 'TOMATO', body: '#ff4d3d', belly: '#ffd6b8', price: 320 },
  { id: 'ghost', name: 'GHOST', body: '#e4ecff', belly: '#ffffff', price: 480 },
  { id: 'golden', name: 'GOLDEN', body: '#ffb81f', belly: '#fff0a0', price: 800 },
  { id: 'cosmic', name: 'COSMIC', body: 'cosmic', belly: '#ffffff', price: 1500 },
];

// ---------------------------------------------------------------- tuning
const G = 1500; // gravity, world units / s^2
const FR = 17; // frog radius
const RANGE = 330; // tongue reach
const BOOST = 560; // swing pump while latched
const VSWING = 980;
const VMAX = 1450;
const REEL = 45;
const MINL = 95;
const ZONE_EVERY = 12;
const PERF_LO = 24, PERF_HI = 66, PERF_V = 420;

// ---------------------------------------------------------------- level
class Pond {
  constructor(seed) {
    this.r = rng(seed);
    this.flies = [];
    this.pikes = [];
    this.pads = [];
    this.x = 230;
    this.h = 430;
    for (let x = -300; x < 400; x += 120) this.pad(x);
  }
  pad(x) {
    const r = this.r;
    this.pads.push({ x: x + r() * 80, w: 26 + r() * 22, rot: r() * 6, flower: r() < 0.25 });
  }
  ensure(x) {
    while (this.x < x) this.add();
  }
  add() {
    const r = this.r, n = this.flies.length, d = clamp(n / 70, 0, 1);
    let x = this.x, h = this.h;
    if (n > 0) {
      const gap = lerp(215, 320, d) + r() * lerp(60, 120, d);
      x += gap;
      h = clamp(h + (r() - 0.5) * lerp(220, 400, d), lerp(340, 220, d), lerp(520, 600, d));
      if (n > 1 && d > 0.1 && r() < lerp(0.05, 0.45, d)) {
        // a pike lurks in this gap
        this.pikes.push({ x: this.x + (x - this.x) * (0.45 + r() * 0.2), st: 'wait', t: 0, peak: 200 + r() * 90, dir: r() < 0.5 ? -1 : 1 });
      }
    }
    const moving = n > 6 && r() < lerp(0.1, 0.65, d);
    this.flies.push({
      x0: x,
      h0: h,
      x,
      h,
      n,
      gold: n > 2 && r() < 0.09,
      amp: moving ? 18 + r() * lerp(20, 60, d) : 0,
      ampx: moving && r() < 0.5 ? 20 + r() * 30 : 0,
      w: 1.4 + r() * 1.4,
      ph: r() * 6.28,
      eaten: false,
      gone: 0,
    });
    for (let px = this.x + 60; px < x; px += 150 + r() * 120) this.pad(px);
    this.x = x;
    this.h = h;
  }
}

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, S = 1, U = 1, WY = 0;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let cam = { x: 0, h: 0 };
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let bestX = store.get('bestx', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['classic']);
let skinId = store.get('skin', 'classic');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let held = false;
let ignoreHold = false;
let rec = null; // record-mode log
let stars = [];
let hills = [];
let pulse = 0;
const clock = { next: 0, last: 0, step: 0 };

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
  S = OG ? 1.15 : Math.min(SW / 460, SH / 720);
  U = Math.min(SW / 420, SH / 640);
  WY = SH * (OG ? 0.86 : 0.82);
  const r = rng(7);
  stars = Array.from({ length: 110 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.4, p: r() * 6 }));
  hills = Array.from({ length: 3 }, (_, i) => Array.from({ length: 5 }, () => ({ a: 0.3 + r() * 0.7, f: 0.6 + r() * 2.2 + i, p: r() * 6 })));
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const pond = new Pond(seed);
  pond.ensure(1600);
  const r = {
    pond,
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    rnd: rng(seed ^ 0x5bd1e995),
    frog: { x: 0, h: FR + 6, vx: 0, vh: 0, sit: true, latched: null, L: 0, swept: 0, lastAng: 0, loops: 0, tongue: null, face: 0, rot: 0, sq: 0, blink: 0 },
    score: 0,
    gulps: 0,
    latches: 0,
    streak: 0,
    maxStreak: 0,
    skimReady: true,
    skims: 0,
    dead: false,
    deadT: 0,
    deathType: '',
    deathFish: null,
    slow: 1,
    slowT: 0,
    zone: 0,
    layer: 0,
    goldGot: 0,
    pops: [],
    parts: [],
    trail: [],
    passedBest: false,
    banner: null,
    t: 0,
    scoreBump: 0,
    whiffCd: 0,
    grabbedOnce: false,
    tutorial: !opts.bot && plays < 2,
    started: false,
  };
  palT = zonePal(0);
  if (!opts.keepPal) pal = zonePal(0);
  cam = { x: viewW() * 0.16, h: 0 };
  return r;
}
const viewW = () => SW / S;
const lead = () => Math.min(viewW() * 0.16, 240);

function launch(r) {
  const f = r.frog;
  f.sit = false;
  f.vx = 380;
  f.vh = 820;
  r.started = true;
  f.sq = -0.4;
  splashAt(r, f.x, 10, 0.6);
}

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
  ignoreHold = true;
  plays++;
  store.set('plays', plays);
  sfx('ribbit');
  sfx('revive');
  launch(run);
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
function sfx(type, e = {}, delay = 0) {
  if (REC && rec) {
    rec.events.push({ type, t: rec.t + delay, ...e });
    return;
  }
  if (run && run.attract && mode !== 'play' && type !== 'click' && type !== 'best') return;
  if (audio && soundOn && audio.ctx.state === 'running') audio.play(type, audio.ctx.currentTime + 0.005 + delay, e);
}
function musicState() {
  const z = run ? run.zone : 0;
  let layer = run ? Math.max(run.layer, Math.min(2, run.zone)) : 0;
  if (mode === 'title' || (run && run.attract)) layer = 3;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: Math.min(126, 102 + z * 5) };
}
function pushState() {
  if (REC && rec) {
    const s = musicState();
    const l = rec.states[rec.states.length - 1];
    if (!l || l.layer !== s.layer || l.root !== s.root || l.bpm !== s.bpm) rec.states.push({ t: rec.t, ...s });
  }
}
function vibrate(ms) {
  if (!REC && mode === 'play' && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
}

// ---------------------------------------------------------------- update
function flyPos(fl, t) {
  fl.h = fl.h0 + fl.amp * Math.sin(t * fl.w + fl.ph);
  fl.x = fl.x0 + fl.ampx * Math.sin(t * fl.w * 0.7 + fl.ph * 1.3);
}

function update(dt) {
  tReal += dt;
  const r = run;
  if (!r) return;
  {
    const bpm = musicState().bpm;
    let ph;
    if (REC && rec) {
      while (clock.next < rec.t) {
        if (clock.step % 4 === 0) clock.last = clock.next;
        clock.next += 60 / bpm / 4;
        clock.step++;
      }
      ph = clamp((rec.t - clock.last) / (60 / bpm), 0, 1);
    } else ph = music && audio && audio.ctx.state === 'running' ? music.phase(bpm) : (tReal * bpm / 60) % 1;
    pulse = Math.pow(1 - ph, 3);
  }
  if (OG) return;

  if (r.slowT > 0) {
    r.slowT -= dt;
    if (r.slowT <= 0) r.slow = 1;
  }
  const wdt = dt * r.slow;
  r.t += wdt;
  const f = r.frog;
  r.pond.ensure(f.x + 1600);
  for (const fl of r.pond.flies) if (!fl.eaten && fl.x0 > f.x - 900 && fl.x0 < f.x + 1400) flyPos(fl, r.t);
  r.whiffCd -= wdt;

  if (!r.dead) {
    let hold;
    if (r.bot) hold = botControl(r);
    else hold = held && !ignoreHold;
    if (!f.sit) {
      if (hold && !f.latched) tryGrab(r);
      else if (!hold && f.latched) letGo(r);
      const n = 2;
      for (let i = 0; i < n; i++) stepFrog(r, wdt / n);
      checkSkim(r);
      checkPikes(r, wdt);
      if (!r.dead && f.h < FR * 0.3) die(r, 'splash');
    }
  } else {
    r.deadT += dt;
    if (r.deathType === 'chomp') {
      const p = r.deathPike;
      p.t += wdt;
      const u = p.t / p.dur;
      p.fx = p.x0 + p.dir * lerp(-70, 70, u);
      p.fh = -50 + p.peak * Math.sin(Math.PI * u);
      f.x = p.fx + p.dir * 30;
      f.h = p.fh + 6;
    } else {
      f.vh -= G * 0.3 * wdt;
      f.vx *= 0.9;
      f.x += f.vx * wdt;
      f.h = Math.max(-60, f.h + f.vh * wdt);
      if (r.deathFish) r.deathFish.t += wdt;
    }
    if (r.attract && r.deadT > 1.8) {
      run = newRun({ bot: true, attract: true, keepPal: true });
      launch(run);
    } else if (!r.attract && mode === 'play' && r.deadT > 1.45) {
      gameOver(r);
    }
  }
  // tongue animation
  if (f.tongue) {
    f.tongue.t += wdt;
    if (f.tongue.kind !== 'hold' && f.tongue.t > f.tongue.dur) {
      if (f.tongue.kind === 'eat' && f.tongue.fly) f.tongue.fly.gone = 1;
      f.tongue = null;
    }
  }
  for (const fl of r.pond.flies) if (fl.eaten && fl.gone < 1) fl.gone = Math.min(1, fl.gone + wdt * 0.0001);

  // frog visuals
  f.sq *= Math.exp(-8 * dt);
  f.blink -= dt;
  if (f.blink < -3) f.blink = 0.12;
  const sp = Math.hypot(f.vx, f.vh);
  let rotT = 0;
  if (f.latched) rotT = Math.atan2(-(f.latched.h - f.h), f.latched.x - f.x) * 0.35;
  else if (!f.sit) rotT = clamp(-Math.atan2(f.vh, Math.max(60, f.vx)) * 0.6, -0.9, 0.9);
  f.rot = lerp(f.rot, rotT, 1 - Math.exp(-10 * dt));
  if (!f.sit && !r.dead) {
    r.trail.push({ x: f.x, h: f.h, a: clamp((sp - 500) / 700, 0, 1) });
    if (r.trail.length > 26) r.trail.shift();
  } else if (r.trail.length) r.trail.shift();

  // camera
  const viewAbove = WY / S;
  const tx = f.x + lead();
  const th = Math.max(0, f.h - (WY - SH * (REC ? 0.42 : 0.36)) / S);
  const kx = 1 - Math.exp(-6 * dt);
  cam.x = lerp(cam.x, tx, kx);
  cam.h = lerp(cam.h, th, 1 - Math.exp((th > cam.h ? -7 : -4) * dt));
  void viewAbove;
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  // palette blend
  const pk = 1 - Math.exp(-1.4 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);
  pal.stars = lerp(pal.stars, palT.stars, pk);

  // particles & pops
  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.h += p.vh * wdt;
    p.vh -= (p.g ?? 0) * wdt;
    p.vx *= p.drag ?? 0.98;
    if (p.kind === 'drop' && p.h < 0 && p.vh < 0) {
      p.life = 0;
      if (r.rnd() < 0.3) r.parts.push({ kind: 'ring', x: p.x, h: 0, vx: 0, vh: 0, life: 0.5, max: 0.5, size: 10 });
    }
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.4) r.banner = null;
  }
  if (mode === 'over') overT += dt;

  if (audio && soundOn && !REC) music.tick(musicState());
}

function stepFrog(r, dt) {
  const f = r.frog;
  const a = f.latched;
  if (a) {
    const dx = f.x - a.x, dh = f.h - a.h;
    const d = Math.hypot(dx, dh) || 1;
    let tx = -dh / d, th = dx / d;
    let vt = f.vx * tx + f.vh * th;
    if (vt < 0) {
      tx = -tx;
      th = -th;
      vt = -vt;
    }
    if (vt < VSWING) {
      const k = tx > 0 ? 1 : 0.35;
      f.vx += tx * BOOST * k * dt;
      f.vh += th * BOOST * k * dt;
    }
  }
  f.vh -= G * dt;
  const sp = Math.hypot(f.vx, f.vh);
  if (sp > VMAX) {
    f.vx *= VMAX / sp;
    f.vh *= VMAX / sp;
  }
  f.x += f.vx * dt;
  f.h += f.vh * dt;
  if (a) {
    f.L = Math.max(MINL, f.L - REEL * dt);
    const dx = f.x - a.x, dh = f.h - a.h;
    const d = Math.hypot(dx, dh) || 1;
    const nx = dx / d, nh = dh / d;
    if (d > f.L) {
      f.x = a.x + nx * f.L;
      f.h = a.h + nh * f.L;
      const vr = f.vx * nx + f.vh * nh;
      if (vr > 0) {
        f.vx -= nx * vr;
        f.vh -= nh * vr;
      }
    }
    const ang = Math.atan2(dh, dx);
    let da = ang - f.lastAng;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    f.swept += da;
    f.lastAng = ang;
    if (Math.abs(f.swept) >= Math.PI * 2 * (f.loops + 1)) {
      f.loops++;
      if (f.loops <= 3) {
        const pts = 3 * f.loops;
        r.score += pts;
        r.scoreBump = 1;
        const names = ['LOOP!', 'DOUBLE LOOP!', 'TRIPLE LOOP!'];
        r.pops.push({ text: names[f.loops - 1], sub: '+' + pts, x: f.x, h: f.h, t: 0, dur: 1, col: [255, 255, 255], size: 1.1 });
        sfx('loop', { n: f.loops, root: ZONE_ROOTS[r.zone % ZONE_ROOTS.length] });
        flash = 0.15;
        burst(r, f.x, f.h, 16, pal.glow);
        vibrate(20);
        checkBest(r);
      }
    }
  }
}

function findTarget(r) {
  const f = r.frog;
  let bestF = null, bd = Infinity;
  for (const fl of r.pond.flies) {
    if (fl.eaten || fl.x < f.x - 30 || fl.x0 > f.x + RANGE + 80) continue;
    const d = Math.hypot(fl.x - f.x, fl.h - f.h);
    if (d > RANGE) continue;
    const score = d - (fl.x - f.x) * 0.15;
    if (score < bd) {
      bd = score;
      bestF = fl;
    }
  }
  return bestF;
}

function tryGrab(r) {
  const f = r.frog;
  const t = findTarget(r);
  if (!t) {
    if (r.whiffCd <= 0 && !r.bot) {
      r.whiffCd = 0.35;
      f.tongue = { kind: 'whiff', t: 0, dur: 0.22, ang: Math.atan2(Math.max(0.3, f.vh / 900), 1) };
      sfx('whiff');
    }
    return;
  }
  f.latched = t;
  f.L = Math.max(MINL, Math.hypot(t.x - f.x, t.h - f.h));
  f.lastAng = Math.atan2(f.h - t.h, f.x - t.x);
  f.swept = 0;
  f.loops = 0;
  f.tongue = { kind: 'hold', t: 0, dur: 0.06, fly: t };
  f.sq = 0.3;
  r.latches++;
  r.grabbedOnce = true;
  r.latchT = r.t;
  sfx('thwip');
}

function letGo(r) {
  const f = r.frog;
  const fl = f.latched;
  f.latched = null;
  fl.eaten = true;
  f.tongue = { kind: 'eat', t: 0, dur: 0.14, fly: fl, fx: fl.x, fh: fl.h };
  const ang = (Math.atan2(f.vh, f.vx) * 180) / Math.PI;
  const sp = Math.hypot(f.vx, f.vh);
  const perfect = f.vx > 0 && ang >= PERF_LO && ang <= PERF_HI && sp >= PERF_V;
  if (perfect) {
    r.streak++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  } else {
    if (r.streak >= 3) {
      r.pops.push({ text: 'COMBO LOST', sub: '', x: f.x, h: f.h - 40, t: 0, dur: 1, col: [255, 110, 120], size: 0.75 });
    }
    r.streak = 0;
  }
  const pts = 1 + (perfect ? r.streak : 0);
  r.score += pts;
  r.gulps++;
  r.scoreBump = 1;
  r.layer = layerFor(r.streak);
  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  sfx('gulp', { m: gulpNote(root, r.streak), big: perfect }, 0.12);
  sfx('boing', { big: perfect });
  if (fl.gold) {
    r.goldGot++;
    sfx('coin', {}, 0.16);
  }
  if (perfect) {
    sfx('perfect', { root }, 0.02);
    const big = r.streak >= 5;
    r.pops.push({ text: big ? 'PERFECT!!' : 'PERFECT!', sub: '+' + pts + (r.streak > 1 ? '   combo x' + r.streak : ''), x: f.x, h: f.h, t: 0, dur: 0.95, col: big ? [255, 255, 255] : pal.glow.slice(), size: big ? 1.2 : 1 });
    f.vx *= 1.06;
    f.vh *= 1.06;
    flash = big ? 0.22 : 0.1;
    if (big) {
      r.slow = 0.35;
      r.slowT = 0.2;
    }
    vibrate(big ? 30 : 12);
  } else if (!r.attract) {
    r.pops.push({ text: 'GULP', sub: '+1', x: f.x, h: f.h, t: 0, dur: 0.7, col: [220, 235, 220], size: 0.7 });
  }
  f.sq = -0.35;
  burst(r, fl.x, fl.h, fl.gold ? 20 : 10, fl.gold ? [255, 214, 80] : pal.glow);
  pushState();

  const z = Math.floor(r.gulps / ZONE_EVERY);
  if (z !== r.zone) {
    r.zone = z;
    palT = zonePal(z);
    r.banner = { text: 'ZONE ' + (z + 1), sub: ZONES[z % ZONES.length].name, t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
    pushState();
  }
  checkBest(r);
}

function checkBest(r) {
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep flinging', t: 0 };
    sfx('best', { root: ZONE_ROOTS[r.zone % ZONE_ROOTS.length] });
    flash = 0.3;
  }
}

function checkSkim(r) {
  const f = r.frog;
  const low = f.h - FR < 30 && f.h > FR * 0.3;
  if (low && Math.abs(f.vx) > 120) {
    if (r.rnd() < 0.7) r.parts.push({ kind: 'drop', x: f.x - 10, h: 2, vx: -f.vx * 0.2 + (r.rnd() - 0.5) * 120, vh: 180 + r.rnd() * 220, g: 1300, life: 0.8, max: 0.8, size: 2 + r.rnd() * 3 });
    if (r.skimReady && !r.skimming) {
      r.skimming = true;
      sfx('skim');
      splashAt(r, f.x, 0, 0.7);
    }
  }
  // paid out only once you climb back out alive
  if (r.skimming && f.h - FR > 60) {
    r.skimming = false;
    r.skimReady = false;
    r.skims++;
    r.score += 2;
    r.scoreBump = 1;
    r.pops.push({ text: 'SKIM!', sub: '+2', x: f.x, h: f.h + 20, t: 0, dur: 0.9, col: [140, 230, 255], size: 1 });
    sfx('coin');
    shake = Math.max(shake, 0.25);
    vibrate(15);
    checkBest(r);
  }
  if (f.h > 130) r.skimReady = true;
}

function checkPikes(r, dt) {
  const f = r.frog;
  for (const p of r.pond.pikes) {
    if (p.st === 'done') continue;
    if (p.st === 'wait') {
      if (f.x > p.x - (REC ? 470 : 430) && !(REC && rec && rec.noPike)) {
        p.st = 'warn';
        p.t = 0;
        sfx('bubbles');
      }
      continue;
    }
    p.t += dt;
    if (p.st === 'warn') {
      if (r.rnd() < 0.4) r.parts.push({ kind: 'bubble', x: p.x + (r.rnd() - 0.5) * 50, h: 0, vx: 0, vh: 0, life: 0.5, max: 0.5, size: 3 + r.rnd() * 5 });
      if (p.t > 0.8) {
        p.st = 'jump';
        p.t = 0;
        p.dur = 1.15;
        p.x0 = p.x;
        splashAt(r, p.x, 0, 1);
        sfx('splash');
        sfx('revive', {}, 0.08);
      }
    } else if (p.st === 'jump') {
      const u = p.t / p.dur;
      p.fx = p.x0 + p.dir * lerp(-70, 70, u);
      p.fh = -50 + p.peak * Math.sin(Math.PI * u);
      const hx = p.fx + p.dir * 38 * Math.cos(Math.PI * u * 0.9 - 0.2), hh = p.fh + 22 * Math.cos(Math.PI * u);
      if (!r.dead && Math.hypot(f.x - hx, f.h - hh) < FR + 26) {
        p.st = 'chomp';
        r.deathPike = p;
        die(r, 'chomp');
        return;
      }
      if (u >= 1) {
        p.st = 'done';
        splashAt(r, p.fx, 0, 0.8);
      }
    }
  }
}

function botControl(r) {
  const f = r.frog;
  const k = r.latches;
  const plan = r.plan ? r.plan(k) : attractPlan(r, k);
  if (!f.latched) {
    const t = findTarget(r);
    if (!t || t.x < f.x + 10) return false;
    const d = Math.hypot(t.x - f.x, t.h - f.h);
    if (plan.kind === 'greedy') return d >= t.h + 30 || d > RANGE - 4;
    if (plan.kind === 'skim') {
      if (f.vh > 0) return false;
      return d >= t.h - FR - (plan.skim ?? 14) || d > RANGE - 4 || t.x - f.x < 70;
    }
    return f.vh < (plan.vh ?? 120);
  }
  if (plan.kind === 'loop' && f.loops < 1) return true;
  const ang = (Math.atan2(f.vh, f.vx) * 180) / Math.PI;
  if (f.vx > 0 && f.x > f.latched.x && ang >= (plan.rel ?? 40)) return false;
  return true;
}
function attractPlan(r, k) {
  if (k >= (r.crashAt ??= 8 + ((r.rnd() * 18) | 0))) return { kind: 'greedy' };
  r.pl ??= [];
  if (!r.pl[k]) {
    const x = r.rnd();
    r.pl[k] = x < 0.65 ? { kind: 'norm', rel: 34 + r.rnd() * 18 } : x < 0.85 ? { kind: 'skim', rel: 40 } : { kind: 'norm', rel: 10 };
  }
  return r.pl[k];
}

function splashAt(r, x, h, k = 1) {
  const n = Math.round(14 * k);
  for (let i = 0; i < n; i++) {
    r.parts.push({ kind: 'drop', x: x + (r.rnd() - 0.5) * 30, h: h + 2, vx: (r.rnd() - 0.5) * 260 * k, vh: 200 + r.rnd() * 420 * k, g: 1300, life: 1, max: 1, size: 2.5 + r.rnd() * 4 });
  }
  r.parts.push({ kind: 'ring', x, h: 0, vx: 0, vh: 0, life: 0.7, max: 0.7, size: 30 * k });
}
function burst(r, x, h, n, col) {
  for (let i = 0; i < n; i++) {
    const a = r.rnd() * Math.PI * 2, sp = 60 + r.rnd() * 220;
    r.parts.push({ kind: 'spark', x, h, vx: Math.cos(a) * sp, vh: Math.sin(a) * sp, g: 300, drag: 0.95, life: 0.7, max: 0.7, size: 2 + r.rnd() * 3, col });
  }
  r.parts.push({ kind: 'halo', x, h, vx: 0, vh: 0, life: 0.4, max: 0.4, size: 1, col });
}

function die(r, type) {
  const f = r.frog;
  r.dead = true;
  r.deadT = 0;
  r.deathType = type;
  if (f.latched) {
    f.latched = null;
    f.tongue = null;
  }
  if (type === 'splash') {
    splashAt(r, f.x, 0, 1.6);
    r.deathFish = { x: f.x + 10, t: 0 };
    sfx('splash');
    sfx('chomp', {}, 0.3);
    shake = 0.6;
    f.vh = Math.min(f.vh, -100);
  } else {
    sfx('chomp');
    shake = 1;
    flash = 0.3;
  }
  r.slow = 0.4;
  r.slowT = 0.5;
  if (!r.attract) vibrate([60, 40, 90]);
}

function gameOver(r) {
  mode = 'over';
  overT = 0;
  const earned = r.goldGot + Math.floor(r.score / 10);
  r.earned = earned;
  r.prevBest = best;
  r.isBest = r.score > best;
  coins += earned;
  store.set('coins', coins);
  if (r.isBest) {
    best = r.score;
    bestX = r.frog.x;
    store.set('best', best);
    store.set('bestx', bestX);
  }
}

// ---------------------------------------------------------------- render
let shakeX = 0, shakeY = 0;
const X = x => (x - cam.x) * S + SW * (OG ? 0.62 : 0.5) + shakeX;
const Y = h => WY - (h - cam.h) * S + shakeY;

function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 22 * U;
  shakeY = (Math.random() - 0.5) * shake * 22 * U;
  drawSky();
  if (!run) return;
  const r = run;
  drawWater(r);
  drawPads(r);
  drawBestFlag(r);
  drawPikes(r);
  drawFlies(r);
  drawTrail(r);
  drawTongue(r);
  drawFrog(r);
  drawDeathFish(r);
  drawParts(r);
  drawReeds();
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

function drawSky() {
  const yw = Y(0);
  const gr = g.createLinearGradient(0, 0, 0, Math.max(10, yw));
  gr.addColorStop(0, css(pal.top));
  gr.addColorStop(0.62, css(pal.mid));
  gr.addColorStop(1, css(pal.hor));
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  // stars
  if (pal.stars > 0.02) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(tReal * 2 + s.p);
      const x = ((s.x * SW - cam.x * 0.02 * S) % SW + SW) % SW;
      const y = s.y * yw * 0.85;
      g.fillStyle = `rgba(255,255,255,${(0.15 + tw * 0.6) * pal.stars * (1 - y / Math.max(1, yw))})`;
      g.fillRect(x, y, s.s * U, s.s * U);
    }
  }
  // aurora ribbons in aurora zone
  const z = run ? run.zone % ZONES.length : 0;
  if (z === 4) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = css(k === 1 ? [120, 120, 255] : [80, 255, 190], 0.1);
      g.lineWidth = 50 * U;
      g.beginPath();
      for (let x = -20; x <= SW + 20; x += 20) {
        const y = yw * (0.18 + k * 0.08) + Math.sin(x * 0.006 + tReal * 0.5 + k * 2) * 30 * U;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }
  // sun / moon, breathing slightly with the kick
  const or = Math.min(SW, SH * 0.6) * 0.16 * (1 + pulse * 0.02);
  const ox = SW * 0.68 - cam.x * 0.01 * S % 40, oy = yw - Math.min(SW, SH) * 0.42 + cam.h * S * 0.1;
  const halo = g.createRadialGradient(ox, oy, or * 0.5, ox, oy, or * 3.2);
  halo.addColorStop(0, css(pal.orb, 0.35));
  halo.addColorStop(1, css(pal.orb, 0));
  g.fillStyle = halo;
  g.fillRect(ox - or * 3.3, oy - or * 3.3, or * 6.6, or * 6.6);
  g.fillStyle = css(pal.orb);
  g.beginPath();
  g.arc(ox, oy, or, 0, Math.PI * 2);
  g.fill();
  // hills, 3 parallax layers
  for (let i = 0; i < 3; i++) {
    const par = [0.08, 0.18, 0.32][i];
    const base = yw - [150, 95, 45][i] * U * (SH / 812) * 0.9;
    const amp = [70, 55, 40][i] * U;
    const col = i === 0 ? mix(pal.hill, pal.hor, 0.45) : i === 1 ? pal.hill : pal.hill2;
    g.fillStyle = css(col);
    g.beginPath();
    g.moveTo(0, yw + 2);
    for (let x = 0; x <= SW + 8; x += 8) {
      const wx = (x + cam.x * S * par) / (S * 260);
      let y = 0;
      for (const w of hills[i]) y += Math.sin(wx * w.f + w.p) * w.a;
      g.lineTo(x, base - (y / 2.2) * amp - amp * 0.4);
    }
    g.lineTo(SW, yw + 2);
    g.closePath();
    g.fill();
    if (i === 2) {
      // little tree silhouettes on the nearest hill
      for (let k = -1; k < 12; k++) {
        const cell = 170;
        const wx0 = Math.floor((cam.x * par) / cell) + k;
        const rr = rng(wx0 * 977 + 13)();
        if (rr < 0.45) continue;
        const sx = (wx0 * cell - cam.x * par) * S + SW / 2;
        const wx = (sx + cam.x * S * par) / (S * 260);
        let y = 0;
        for (const w of hills[i]) y += Math.sin(wx * w.f + w.p) * w.a;
        const by = base - (y / 2.2) * amp - amp * 0.4 + 4;
        const th = (40 + rr * 50) * U;
        g.beginPath();
        g.moveTo(sx, by - th);
        g.lineTo(sx + th * 0.28, by);
        g.lineTo(sx - th * 0.28, by);
        g.closePath();
        g.fill();
      }
    }
  }
}

function drawWater(r) {
  const yw = Y(0);
  if (yw > SH) return;
  const gr = g.createLinearGradient(0, yw, 0, SH);
  gr.addColorStop(0, css(mix(pal.water, pal.hor, 0.25)));
  gr.addColorStop(0.25, css(pal.water));
  gr.addColorStop(1, css(pal.water2));
  g.fillStyle = gr;
  g.fillRect(0, yw, SW, SH - yw);
  // orb reflection column
  const ox = SW * 0.68 - cam.x * 0.01 * S % 40;
  g.fillStyle = css(pal.orb, 0.18);
  for (let i = 0; i < 9; i++) {
    const y = yw + 6 * U + i * 13 * U;
    const w = (60 - i * 5) * U * (1 + 0.2 * Math.sin(tReal * 3 + i));
    g.fillRect(ox - w / 2, y, w, 3 * U);
  }
  // firefly reflections
  for (const fl of r.pond.flies) {
    if (fl.eaten) continue;
    const x = X(fl.x);
    if (x < -40 || x > SW + 40) continue;
    const y = yw + (fl.h - cam.h) * S * 0.25 + 10 * U;
    if (y > SH) continue;
    const gl = g.createRadialGradient(x, y, 0, x, y, 18 * U);
    gl.addColorStop(0, css(fl.gold ? [255, 214, 80] : pal.glow, 0.3));
    gl.addColorStop(1, css(pal.glow, 0));
    g.fillStyle = gl;
    g.fillRect(x - 18 * U, y - 9 * U, 36 * U, 18 * U);
  }
  // shimmer lines
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 2 * U;
  g.beginPath();
  for (let i = 0; i < 26; i++) {
    const a = (i * 0.618) % 1, b = (i * 0.383) % 1;
    const y = yw + 8 * U + b * (SH - yw);
    const x = ((a * SW * 1.5 - cam.x * S * (0.5 + b * 0.5)) % (SW * 1.5) + SW * 1.5) % (SW * 1.5) - SW * 0.25;
    const w = (20 + b * 50) * U;
    g.moveTo(x, y);
    g.lineTo(x + w, y);
  }
  g.stroke();
  // surface line with gentle waves
  g.strokeStyle = css(mix(pal.hor, [255, 255, 255], 0.4), 0.55);
  g.lineWidth = 2.5 * U;
  g.beginPath();
  for (let x = 0; x <= SW; x += 10) {
    const wx = (x - SW / 2) / S + cam.x;
    const y = yw + Math.sin(wx * 0.03 + tReal * 2.4) * 2 * U;
    x ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
}

function drawPads(r) {
  const yw = Y(0);
  for (const p of r.pond.pads) {
    const x = X(p.x);
    if (x < -80 || x > SW + 80) continue;
    const w = p.w * S, y = yw + 3 * U + Math.sin(tReal * 1.5 + p.rot) * 1.5 * U;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(x, y + 3 * U, w, w * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = css(mix([60, 150, 70], pal.water2, 0.35));
    g.beginPath();
    g.ellipse(x, y, w, w * 0.28, 0, 0.25, Math.PI * 2 - 0.05);
    g.lineTo(x, y);
    g.closePath();
    g.fill();
    g.fillStyle = css(mix([110, 200, 100], pal.water2, 0.3));
    g.beginPath();
    g.ellipse(x - w * 0.1, y - w * 0.04, w * 0.7, w * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    if (p.flower) {
      g.fillStyle = '#ffb3d1';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + w * 0.3 + Math.cos(a) * 5 * S, y - 8 * S + Math.sin(a) * 2.5 * S, 5 * S, 3 * S, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffe66b';
      g.beginPath();
      g.arc(x + w * 0.3, y - 9 * S, 3 * S, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawBestFlag(r) {
  if (r.bot || bestX < 300 || r.passedBest) return;
  const x = X(bestX);
  if (x < -60 || x > SW + 60) return;
  const y = Y(0), h = 120 * S;
  g.strokeStyle = '#fff';
  g.lineWidth = 3 * U;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.stroke();
  const wv = Math.sin(tReal * 6) * 4 * U;
  g.fillStyle = css(pal.glow);
  poly([[x, y - h], [x + 70 * U, y - h + 11 * U + wv], [x, y - h + 26 * U]]);
  g.fill();
  text('BEST ' + best, x + 6 * U, y - h + 13 * U, 12 * U, '#111', 'left');
}

function drawFlies(r) {
  const f = r.frog;
  const tgt = !r.dead && !f.latched && !f.sit && mode !== 'title' ? findTarget(r) : null;
  for (const fl of r.pond.flies) {
    if (fl.eaten) continue;
    const x = X(fl.x), y = Y(fl.h);
    if (x < -60 || x > SW + 60 || y < -60 || y > SH + 60) continue;
    const s = S;
    const gc = fl.gold ? [255, 210, 70] : pal.glow;
    const bl = 0.75 + 0.25 * Math.sin(tReal * 5 + fl.ph * 3) + pulse * 0.15;
    const gr = g.createRadialGradient(x, y, 0, x, y, 46 * s * bl);
    gr.addColorStop(0, css(gc, 0.6));
    gr.addColorStop(0.3, css(gc, 0.22));
    gr.addColorStop(1, css(gc, 0));
    g.fillStyle = gr;
    g.fillRect(x - 50 * s, y - 50 * s, 100 * s, 100 * s);
    // wings
    const fl2 = Math.abs(Math.sin(tReal * 30 + fl.ph));
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(x - 3 * s, y - 7 * s, 6 * s, 3 * s * fl2 + 1, -0.5, 0, Math.PI * 2);
    g.ellipse(x + 3 * s, y - 7 * s, 6 * s, 3 * s * fl2 + 1, 0.5, 0, Math.PI * 2);
    g.fill();
    // body + glowing tail
    g.fillStyle = '#3a2a1a';
    g.beginPath();
    g.ellipse(x - 2 * s, y - 2 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = css(mix(gc, [255, 255, 255], 0.5));
    g.beginPath();
    g.arc(x + 3 * s, y + 2 * s, 5.5 * s, 0, Math.PI * 2);
    g.fill();
    if (fl.gold) {
      const sp = 9 * s * (0.8 + 0.2 * Math.sin(tReal * 8));
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2 * U;
      g.beginPath();
      g.moveTo(x + 3 * s - sp, y + 2 * s);
      g.lineTo(x + 3 * s + sp, y + 2 * s);
      g.moveTo(x + 3 * s, y + 2 * s - sp);
      g.lineTo(x + 3 * s, y + 2 * s + sp);
      g.stroke();
    }
    if (fl === tgt) {
      // "you can lick this one" ring
      const k = 0.5 + 0.5 * Math.sin(tReal * 10);
      g.strokeStyle = css([255, 255, 255], 0.55 + k * 0.4);
      g.lineWidth = 3 * U;
      g.setLineDash([6 * U, 6 * U]);
      g.lineDashOffset = -tReal * 30;
      g.beginPath();
      g.arc(x, y, (22 + k * 4) * s, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }
}

function mouth(f) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  const mx = 14, mh = -2;
  return { x: f.x + mx * c + mh * s, h: f.h - mx * s + mh * c };
}

function drawTongue(r) {
  const f = r.frog;
  const t = f.tongue;
  if (!t) return;
  const m = mouth(f);
  let ex, eh, fly = null;
  if (t.kind === 'hold') {
    const k = clamp(t.t / t.dur, 0, 1);
    ex = lerp(m.x, t.fly.x, k);
    eh = lerp(m.h, t.fly.h, k);
  } else if (t.kind === 'eat') {
    const k = ease(t.t / t.dur);
    ex = lerp(t.fx, m.x, k);
    eh = lerp(t.fh, m.h, k);
    fly = { x: ex, h: eh };
  } else {
    const k = t.t / t.dur;
    const len = Math.sin(Math.PI * k) * 110;
    ex = m.x + Math.cos(t.ang) * len;
    eh = m.h + Math.sin(t.ang) * len;
  }
  const a = [X(m.x), Y(m.h)], b = [X(ex), Y(eh)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const w = clamp(9 - len / (60 * S), 4, 9) * S;
  g.lineCap = 'round';
  g.strokeStyle = '#b8325a';
  g.lineWidth = w + 3 * S;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.strokeStyle = '#ff6f96';
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = w * 0.3;
  g.stroke();
  g.fillStyle = '#ff6f96';
  g.beginPath();
  g.arc(b[0], b[1], w * 0.9, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'butt';
  if (fly) {
    g.fillStyle = css(pal.glow, 0.9);
    g.beginPath();
    g.arc(b[0], b[1], 5 * S, 0, Math.PI * 2);
    g.fill();
  }
}

function skinCol() {
  const sk = SKINS.find(s => s.id === (run && run.bot && !REC ? 'classic' : skinId)) || SKINS[0];
  if (sk.body === 'cosmic') {
    const h = (tReal * 80) % 360;
    return [hslRgb(h, 0.85, 0.6), hslRgb((h + 60) % 360, 0.9, 0.85)];
  }
  return [hexRgb(sk.body), hexRgb(sk.belly), sk.id];
}
function hslRgb(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function drawTrail(r) {
  const tr = r.trail;
  const [col] = skinCol();
  for (let i = 1; i < tr.length; i++) {
    const p = tr[i];
    const al = p.a * (i / tr.length) * 0.5;
    if (al < 0.02) continue;
    g.fillStyle = css(mix(col, [255, 255, 255], 0.5), al);
    g.beginPath();
    g.arc(X(p.x), Y(p.h), (FR * 0.75) * S * (i / tr.length), 0, Math.PI * 2);
    g.fill();
  }
}

function drawFrog(r) {
  const f = r.frog;
  if (r.dead && r.deathType === 'splash' && r.deathFish && r.deathFish.t > 0.42) return;
  if (r.dead && r.deathType === 'splash' && f.h < -FR) return;
  const [body, belly, id] = skinCol();
  const x = X(f.x), y = Y(f.h);
  const s = S;
  const sp = Math.hypot(f.vx, f.vh);
  const flying = !f.sit && !f.latched;
  const stretch = clamp(f.sq + (flying ? clamp((sp - 400) / 2000, 0, 0.18) : 0), -0.4, 0.4);
  g.save();
  g.translate(x, y);
  // shadow on the water
  g.restore();
  const sh = clamp(1 - f.h / 500, 0, 1);
  if (sh > 0 && Y(0) < SH) {
    g.fillStyle = `rgba(0,0,0,${0.25 * sh})`;
    g.beginPath();
    g.ellipse(x, Y(0) + 4 * U, 22 * s * (0.5 + sh * 0.5), 5 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.save();
  g.translate(x, y);
  g.rotate(f.rot);
  if (r.dead && r.deathType === 'splash') g.globalAlpha = clamp(1 + f.h / FR, 0, 1);
  if (id === 'ghost') g.globalAlpha *= 0.82;
  g.scale(1 + stretch, 1 - stretch * 0.8);
  const dark = shade(body, 0.62);
  const BW = 21 * s, BH = 16 * s;
  // back legs
  g.fillStyle = css(dark);
  if (flying || r.dead) {
    const k = clamp((sp - 300) / 600, 0, 1);
    g.save();
    g.rotate(0.3 + k * 0.5);
    g.beginPath();
    g.ellipse(-BW * 0.9 - k * 8 * s, BH * 0.5, 13 * s + k * 6 * s, 5 * s, 0.2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-BW * 1.55 - k * 14 * s, BH * 0.75, 8 * s, 3.5 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else {
    g.beginPath();
    g.ellipse(-BW * 0.55, BH * 0.55, 12 * s, 8 * s, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-BW * 0.2, BH * 0.95, 11 * s, 3.5 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  // body
  g.fillStyle = css(body);
  g.beginPath();
  g.ellipse(0, 0, BW, BH, 0, 0, Math.PI * 2);
  g.fill();
  // belly
  g.fillStyle = css(belly);
  g.beginPath();
  g.ellipse(BW * 0.18, BH * 0.38, BW * 0.68, BH * 0.52, 0, 0, Math.PI * 2);
  g.fill();
  // spots
  g.fillStyle = css(shade(body, 0.78));
  for (const [sx, sy, rr] of [[-0.45, -0.35, 3.2], [-0.05, -0.62, 2.4], [-0.7, 0.1, 2.2]]) {
    g.beginPath();
    g.arc(sx * BW, sy * BH, rr * s, 0, Math.PI * 2);
    g.fill();
  }
  // front arm
  g.fillStyle = css(dark);
  g.beginPath();
  g.ellipse(BW * 0.55, BH * 0.85, 7 * s, 3.5 * s, f.latched ? -0.9 : 0.3, 0, Math.PI * 2);
  g.fill();
  // eyes on top
  const look = f.latched ? Math.atan2(-(f.latched.h - f.h), f.latched.x - f.x) - f.rot : flying ? -0.2 : 0;
  for (const ex of [0.05, 0.55]) {
    const cx = ex * BW, cy = -BH * 0.85;
    g.fillStyle = css(body);
    g.beginPath();
    g.arc(cx, cy, 8 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx + 1 * s, cy - 1 * s, 6.2 * s, 0, Math.PI * 2);
    g.fill();
    if (r.dead) {
      g.strokeStyle = '#111';
      g.lineWidth = 2 * s;
      g.beginPath();
      g.moveTo(cx - 3 * s, cy - 4 * s);
      g.lineTo(cx + 5 * s, cy + 2 * s);
      g.moveTo(cx + 5 * s, cy - 4 * s);
      g.lineTo(cx - 3 * s, cy + 2 * s);
      g.stroke();
    } else if (f.blink > 0) {
      g.fillStyle = css(body);
      g.fillRect(cx - 7 * s, cy - 8 * s, 15 * s, 9 * s);
    } else {
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(cx + 1 * s + Math.cos(look) * 2.6 * s, cy - 1 * s + Math.sin(look) * 2.6 * s, 3.2 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(cx + 2.2 * s + Math.cos(look) * 2.6 * s, cy - 2.4 * s + Math.sin(look) * 2.6 * s, 1.1 * s, 0, Math.PI * 2);
      g.fill();
    }
  }
  // mouth
  g.strokeStyle = css(shade(body, 0.4));
  g.lineWidth = 2 * s;
  g.beginPath();
  if (f.tongue && f.tongue.kind !== 'eat') {
    g.fillStyle = '#7a1a35';
    g.ellipse(BW * 0.75, -BH * 0.05, 5 * s, 4 * s, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.arc(BW * 0.45, -BH * 0.25, BW * 0.45, 0.25, 1.05);
    g.stroke();
  }
  // blush
  g.fillStyle = 'rgba(255,110,140,0.45)';
  g.beginPath();
  g.ellipse(BW * 0.55, BH * 0.1, 4 * s, 2.4 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function fishShape(x, y, s, dir, open, ang = 0) {
  // big comic pike: body, tail, fin, jaw
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(dir, 1);
  const body = [70, 110, 70], dark = [40, 70, 45], bellyC = [215, 225, 170];
  g.fillStyle = css(dark);
  poly([[-52 * s, 0], [-82 * s, -24 * s], [-76 * s, 0], [-82 * s, 24 * s]]);
  g.fill();
  g.fillStyle = css(body);
  g.beginPath();
  g.ellipse(-6 * s, 0, 54 * s, 22 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(bellyC);
  g.beginPath();
  g.ellipse(0, 9 * s, 44 * s, 11 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(dark);
  poly([[-20 * s, -18 * s], [-2 * s, -36 * s], [10 * s, -18 * s]]);
  g.fill();
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(30,50,30,0.35)';
    g.beginPath();
    g.ellipse(-30 * s + i * 14 * s, -4 * s, 4 * s, 8 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  // jaws
  const o = open * 0.6;
  g.fillStyle = css(body);
  g.save();
  g.translate(38 * s, -2 * s);
  g.rotate(-o);
  poly([[0, -12 * s], [30 * s, -4 * s], [0, 2 * s]]);
  g.fill();
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) poly([[6 * s + i * 6 * s, -1 * s], [9 * s + i * 6 * s, 4 * s], [12 * s + i * 6 * s, -1 * s]]), g.fill();
  g.restore();
  g.save();
  g.translate(38 * s, 4 * s);
  g.rotate(o);
  g.fillStyle = css(bellyC);
  poly([[0, -2 * s], [28 * s, 2 * s], [0, 12 * s]]);
  g.fill();
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) poly([[6 * s + i * 6 * s, 0], [9 * s + i * 6 * s, -5 * s], [12 * s + i * 6 * s, 0]]), g.fill();
  g.restore();
  // eye
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(26 * s, -10 * s, 6 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(28 * s, -10 * s, 3 * s, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#111';
  g.lineWidth = 2.5 * s;
  g.beginPath();
  g.moveTo(18 * s, -19 * s);
  g.lineTo(32 * s, -14 * s);
  g.stroke();
  g.restore();
}

function drawPikes(r) {
  for (const p of r.pond.pikes) {
    if (p.st !== 'jump' && p.st !== 'chomp') continue;
    const u = p.t / p.dur;
    const ang = -Math.cos(Math.PI * u) * 0.9 * p.dir;
    const open = p.st === 'chomp' ? clamp(1 - (p.t - (r.deathT0 ?? 0)) * 0, 0, 0) : u < 0.5 ? 1 : 0.4;
    fishShape(X(p.fx), Y(p.fh), S * 0.9, p.dir, open, ang);
  }
}

function drawDeathFish(r) {
  const df = r.deathFish;
  if (!df) return;
  const t = df.t;
  if (t < 0.2 || t > 1.4) return;
  const u = (t - 0.2) / 1.0;
  const h = -70 + 150 * Math.sin(Math.PI * clamp(u, 0, 1));
  const open = t < 0.42 ? 1 : 0;
  fishShape(X(df.x), Y(h), S * 1.15, 1, open, -1.25 + u * 0.6);
  if (t > 0.42 && t < 0.9) text('GULP.', X(df.x) + 40 * U, Y(h) - 90 * U, 26 * U, '#fff', 'center', { stroke: 6 * U });
}

function drawParts(r) {
  const s = S;
  for (const p of r.parts) {
    const x = X(p.x), y = Y(p.h);
    const k = p.life / p.max;
    if (p.kind === 'drop') {
      g.fillStyle = `rgba(210,240,255,${0.85 * k})`;
      g.beginPath();
      g.arc(x, y, p.size * s, 0, Math.PI * 2);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = `rgba(220,245,255,${0.6 * k})`;
      g.lineWidth = 2.5 * U;
      const rr = (p.size + (1 - k) * 50) * s;
      g.beginPath();
      g.ellipse(x, Y(0) + 2 * U, rr, rr * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (p.kind === 'bubble') {
      g.strokeStyle = `rgba(220,245,255,${0.8 * k})`;
      g.lineWidth = 2 * U;
      g.beginPath();
      g.arc(x, Y(0) + 3 * U - (1 - k) * 6 * U, p.size * s * (1.2 - k * 0.4), 0, Math.PI * 2);
      g.stroke();
    } else if (p.kind === 'halo') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = 4 * U * k;
      g.beginPath();
      g.arc(x, y, (1 - k) * 70 * s + 8, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = css(p.col, Math.min(1, k * 1.5));
      g.fillRect(x - p.size * s / 2, y - p.size * s / 2, p.size * s, p.size * s);
    }
  }
}

function drawReeds() {
  const yw = Y(0);
  if (yw > SH + 10) return;
  g.fillStyle = css(pal.reed);
  g.strokeStyle = css(pal.reed);
  const par = 1.25;
  const cell = 70;
  const span = Math.ceil(SW / (cell * S * par)) + 2;
  const c0 = Math.floor((cam.x * par - SW / 2 / S) / cell) - 1;
  for (let c = c0; c < c0 + span + 1; c++) {
    const rr = rng(c * 7919 + 3);
    const a = rr();
    if (a < 0.35) continue;
    const x = (c * cell - cam.x * par) * S + SW / 2;
    const base = SH + 4;
    const n = 2 + ((rr() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const xx = x + (i - n / 2) * 7 * S;
      const hgt = (SH - yw) * (0.35 + rr() * 0.45) + 50 * U * rr();
      const sway = Math.sin(tReal * 1.6 + c + i) * 6 * U;
      g.lineWidth = 3 * U;
      g.beginPath();
      g.moveTo(xx, base);
      g.quadraticCurveTo(xx, base - hgt * 0.6, xx + sway, base - hgt);
      g.stroke();
      if (rr() < 0.45) {
        g.fillStyle = css(shade(pal.reed, 2.2));
        g.beginPath();
        g.ellipse(xx + sway, base - hgt + 10 * U, 4 * U, 13 * U, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = css(pal.reed);
      }
    }
  }
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || ''} ${size}px ${opts.font || '"Lilita One", system-ui, sans-serif'}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(10,20,15,0.9)';
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
    const x = clamp(X(p.x), 120 * U, SW - 120 * U);
    const y = clamp(Y(p.h), 160 * U, SH - 60 * U);
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const yy = y - (60 + ease(k) * 50) * U;
    g.globalAlpha = a;
    text(p.text, x, yy, 32 * U * sc, css(p.col), 'center', { stroke: 7 * U, glow: css(p.col, 0.7) });
    if (p.sub) text(p.sub, x, yy + 29 * U * sc, 18 * U * sc, '#fff', 'center', { stroke: 5 * U });
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
  text(String(r.score), SW / 2, top + 30 * U, 60 * U * bump, '#fff', 'center', { stroke: 8 * U, glow: css(pal.glow, 0.6) });
  if (r.streak >= 2) {
    const hot = r.streak >= 5;
    text((hot ? 'ON FIRE  ' : 'COMBO  ') + 'x' + r.streak, SW / 2, top + 74 * U, 19 * U, css(hot ? [255, 255, 255] : pal.glow), 'center', { stroke: 5 * U, glow: css(pal.glow, 0.9) });
  }
  if (!REC) {
    drawGem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + (mode === 'play' ? r.goldGot : 0)), 40 * U, top + 7 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.42 : 0.34);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 8 * U, 36 * U * back(b.t / 0.3), '#fff', 'center', { glow: css(pal.glow) });
    text(b.sub, SW / 2, y + 24 * U, 14 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  if (r.tutorial && !r.dead && r.gulps < 3) {
    const f = r.frog;
    let label = null, big = false;
    if (!f.latched) {
      const t = findTarget(r);
      if (t && !held) {
        label = 'HOLD to lick it!';
        big = true;
      } else if (!t) label = r.gulps === 0 && !r.grabbedOnce ? 'wait for a firefly…' : null;
    } else {
      const ang = (Math.atan2(f.vh, f.vx) * 180) / Math.PI;
      const ok = f.vx > 0 && ang >= PERF_LO && ang <= PERF_HI && Math.hypot(f.vx, f.vh) >= PERF_V;
      if (ok) {
        label = 'LET GO NOW!';
        big = true;
      } else label = 'swinging… let go on the way UP';
    }
    if (label) text(label, SW / 2, SH * 0.66, (big ? 32 : 18) * U, big ? '#fff' : 'rgba(255,255,255,0.9)', 'center', { stroke: 6 * U, glow: big ? css(pal.glow) : null });
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

function drawLogo(x, y, k, ogMode) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.06 + Math.sin(tReal * 2.2) * 0.012);
  text('FROG', 0, -36 * k, 74 * k, css([125, 255, 107]), 'center', { stroke: 12 * k, glow: 'rgba(125,255,107,0.6)', blur: 26 * k });
  text('FLING', 12 * k, 30 * k, 66 * k, css(pal.glow), 'center', { stroke: 11 * k, glow: css(pal.glow, 0.6), blur: 22 * k });
  g.restore();
  void ogMode;
}

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(8,14,22,0.7)');
  gr.addColorStop(1, 'rgba(8,14,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.25, y = SH * 0.38;
  drawLogo(x, y, 1.7);
  text('lick. swing. fling.', x, y + 150, 36, '#fff', 'center', { stroke: 8 });
  text('free · no download · one tap', x, y + 196, 24, 'rgba(255,255,255,0.85)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 6 });
}

function drawTitle() {
  if (OG) return drawOgTitle();
  const gr = g.createLinearGradient(0, SH * 0.45, 0, SH);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const y = SH * 0.2;
  drawLogo(SW / 2, y, U);
  text('lick. swing. fling.', SW / 2, y + 96 * U, 20 * U, '#fff', 'center', { stroke: 5 * U });
  text('every firefly you swing from gets eaten', SW / 2, y + 122 * U, 13 * U, 'rgba(255,255,255,0.9)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  text('TAP TO PLAY', SW / 2, SH * 0.72, (28 + p * 3) * U, '#fff', 'center', { stroke: 7 * U, glow: 'rgba(125,255,107,0.8)' });
  text('hold = lick · let go = fling', SW / 2, SH * 0.72 + 36 * U, 14 * U, 'rgba(255,255,255,0.85)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  if (best > 0) text('BEST  ' + best, SW / 2, SH * 0.72 + 64 * U, 17 * U, css(pal.glow), 'center', { stroke: 4 * U });
  pill('POND SHOP', SW / 2, SH * 0.88, 160 * U, 42 * U, 'rgba(255,255,255,0.16)', '#fff', openShop, 17);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(4,10,8,${0.5 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.47 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  g.fillStyle = 'rgba(12,28,22,0.93)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 24 * U);
  g.fill();
  g.strokeStyle = css(pal.glow, 0.8);
  g.lineWidth = 2.5 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 40 * U, 32 * U * back(overT / 0.4), css(pal.glow), 'center', { glow: css(pal.glow) });
  else text(r.deathType === 'chomp' ? 'CHOMPED!' : 'SPLASH!', SW / 2, t0 + 40 * U, 30 * U, '#fff');
  text(String(r.score), SW / 2, t0 + 105 * U, 76 * U, '#fff', 'center', { glow: css(pal.glow, 0.7) });
  let sub;
  if (REC) sub = 'can you beat ' + r.score + '?';
  else if (r.gulps === 0) sub = 'tip: hold to lick · let go on the way up';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 5) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = 'best ' + r.prevBest + ' · ' + r.gulps + ' fireflies · combo x' + r.maxStreak;
  text(sub, SW / 2, t0 + 152 * U, 15 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
  if (REC) {
    text('FROG FLING', SW / 2, t0 - 36 * U, 34 * U, '#fff', 'center', { stroke: 7 * U, glow: 'rgba(125,255,107,0.8)' });
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 238 * U, 17 * U, css([125, 255, 107]), 'center', { font: 'system-ui, sans-serif', weight: '800' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 185 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 186 * U, 17 * U, '#ffd650', 'left');
    pill('RETRY', SW / 2, t0 + 240 * U, cw - 60 * U, 54 * U, '#7dff6b', '#0b1a14', startGame, 26);
    pill('SHARE', SW / 2 - 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', share, 15);
    pill('SHOP', SW / 2 + 75 * U, t0 + 296 * U, 130 * U, 36 * U, 'rgba(255,255,255,0.14)', '#fff', openShop, 15);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, SH - 30 * U, 12 * U, 'rgba(255,255,255,0.6)', 'center', { font: 'system-ui, sans-serif', weight: '700' });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 330;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 96, 74, i === hook.length - 1 ? css(pal.glow) : '#fff', 'center', { stroke: 16, glow: 'rgba(0,0,0,0.6)' }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  const plan = rec && rec.crashAt;
  if (cap2 && plan && !r.dead && r.latches >= plan - 1 && r.latches <= plan + 1 && mode === 'play') {
    text(cap2, SW / 2, 300, 66, '#fff', 'center', { stroke: 15 });
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
  const txt = `I scored ${r.score} in FROG FLING 🐸👅 lick a firefly, swing, fling. bet you can't beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Frog Fling', text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Send it to a friend 🐸');
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
  for (const c of SKINS) {
    const have = owned.includes(c.id);
    const b = document.createElement('button');
    b.className = 'car' + (c.id === skinId ? ' sel' : '') + (have ? '' : ' locked');
    const swatch = c.body === 'cosmic' ? 'linear-gradient(135deg,#ff5fd2,#ffd166,#5fffc1,#5f7bff)' : `radial-gradient(circle at 60% 75%, ${c.belly} 0 32%, ${c.body} 34%)`;
    b.innerHTML = `<i style="background:${swatch}"></i><b>${c.name}</b><span>${have ? (c.id === skinId ? 'EQUIPPED' : 'SELECT') : '◆ ' + c.price}</span>`;
    b.onclick = () => {
      if (have) {
        skinId = c.id;
        store.set('skin', skinId);
      } else if (coins >= c.price) {
        coins -= c.price;
        owned.push(c.id);
        skinId = c.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('skin', skinId);
        sfx('best', { root: 48 });
      } else {
        toast(`Need ${c.price - coins} more ◆ — catch golden fireflies!`);
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
}
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
      e.preventDefault();
      if (document.getElementById('garage').classList.contains('on')) return;
      press(null, null);
    }
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
if (Q.has('qa'))
  window.__qa = () => {
    const f = run.frog;
    return { mode, score: run.score, gulps: run.gulps, dead: run.dead, attract: run.attract, h: f.h, vx: f.vx, vh: f.vh, latched: !!f.latched, target: !!findTarget(run), ang: (Math.atan2(f.vh, f.vx) * 180) / Math.PI, overT, best, coins, buttons: buttons.length };
  };
resize();
if (OG) {
  document.querySelector('.back').style.display = 'none';
  // Staged hero shot: frog mid-swing on a firefly, about to fling.
  run = newRun({ seed: 5, bot: true });
  const fl = run.pond.flies[3];
  fl.x = fl.x0;
  fl.h = 380;
  fl.amp = fl.ampx = 0;
  const f = run.frog;
  f.sit = false;
  f.x = fl.x + 110;
  f.h = fl.h - 150;
  f.vx = 600;
  f.vh = 500;
  f.latched = fl;
  f.tongue = { kind: 'hold', t: 1, dur: 0.06, fly: fl };
  f.rot = -0.5;
  cam.x = f.x - 210;
  cam.h = 0;
  mode = 'title';
  let last = performance.now();
  const loop = now => {
    update(Math.min(0.05, (now - last) / 1000));
    last = now;
    render();
    requestAnimationFrame(loop);
  };
  document.fonts.load('40px "Lilita One"').finally(() => requestAnimationFrame(loop));
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 18);
  const seed = +(Q.get('seed') || 11);
  const skim = new Set((Q.get('skim') || '').split(',').filter(Boolean).map(Number));
  const loops = new Set((Q.get('loop') || '').split(',').filter(Boolean).map(Number));
  const lows = new Set((Q.get('low') || '').split(',').filter(Boolean).map(Number));
  const crashKind = Q.get('ck') || 'greedy';
  rec = { t: 0, frame: 0, events: [], states: [], musicStart: 0, crashAt, noPike: Q.has('nopike') };
  if (Q.get('skin')) skinId = Q.get('skin');
  document.querySelector('.back').style.display = 'none';
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    bot: true,
    plan: k => {
      if (k >= crashAt) return crashKind === 'early' ? { kind: 'norm', rel: -40 } : { kind: 'greedy' };
      if (loops.has(k)) return { kind: 'loop', rel: 40 };
      if (skim.has(k)) return { kind: 'skim', rel: 42 };
      if (lows.has(k)) return { kind: 'norm', rel: 12 };
      return { kind: 'norm', rel: 36 + ((k * 7919) % 13) };
    },
  });
  void pr;
  run.tutorial = false;
  mode = 'play';
  best = 0;
  bestX = 0;
  rec.states.push({ t: 0, ...musicState() });
  rec.events.push({ type: 'ribbit', t: 0.05 });
  launch(run);
  window.__rec = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        rec.t += 1 / 60;
        rec.frame++;
      }
      render();
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.gulps, streak: run.streak, latches: run.latches, skims: run.skims };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('40px "Lilita One"').then(() => (window.__recReady = true));
} else {
  run = newRun({ bot: true, attract: true });
  launch(run);
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
