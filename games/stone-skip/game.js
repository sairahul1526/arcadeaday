import { Synth, Music, renderOffline, layerFor, skipNote, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/stone-skip';
const WR = 88; // the real-world stone skipping record (Guinness)
const FONT = '"Baloo 2", system-ui, sans-serif';
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
const hash = (i, j = 0) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(j + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, k) => c.map(v => clamp(v * k, 0, 255));
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('ssk_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('ssk_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
// A new body of water every 15 skips. wave = swell height, the rest are sky effects.
const ZONES = [
  { name: 'MILL POND', sky1: '#6cc4ff', sky2: '#ffe7c4', sun: '#fff4cf', hill1: '#8cc9a8', hill2: '#4e9c79', water1: '#58c3e6', water2: '#155a86', accent: '#ffd166', wave: 0, stars: 0, rain: 0, aurora: 0 },
  { name: 'RIVER BEND', sky1: '#4aa6f0', sky2: '#cdeeff', sun: '#ffffff', hill1: '#79b0d0', hill2: '#3f8a6c', water1: '#43aed6', water2: '#0f4c76', accent: '#9dff8a', wave: 5, stars: 0, rain: 0, aurora: 0 },
  { name: 'GOLDEN HOUR', sky1: '#ff8a65', sky2: '#ffd98a', sun: '#fff1b8', hill1: '#c97563', hill2: '#7e3a52', water1: '#f0a06e', water2: '#4b2350', accent: '#fff1b8', wave: 9, stars: 0, rain: 0, aurora: 0 },
  { name: 'MOONLIT BAY', sky1: '#0a1440', sky2: '#2d4590', sun: '#f2f0ff', hill1: '#21306a', hill2: '#111a42', water1: '#2a4a8a', water2: '#060c26', accent: '#b9c8ff', wave: 13, stars: 1, rain: 0, aurora: 0 },
  { name: 'STORM SEA', sky1: '#28323d', sky2: '#5c6a76', sun: '#cfd8dc', hill1: '#3a4752', hill2: '#202a32', water1: '#3e6070', water2: '#0b171e', accent: '#7fe7ff', wave: 19, stars: 0, rain: 1, aurora: 0 },
  { name: 'AURORA FJORD', sky1: '#030f1f', sky2: '#0e3b4c', sun: '#e8fff6', hill1: '#10303e', hill2: '#061722', water1: '#0f5060', water2: '#020a12', accent: '#6bffc8', wave: 14, stars: 1, rain: 0, aurora: 1 },
  { name: 'BEYOND', sky1: '#12002b', sky2: '#56127a', sun: '#ffd6ff', hill1: '#2e0b52', hill2: '#17052c', water1: '#6a24a0', water2: '#0a0218', accent: '#ff8af0', wave: 21, stars: 1, rain: 0, aurora: 0.6 },
];
const ZONE_LEN = 15;
const COLS = ['sky1', 'sky2', 'sun', 'hill1', 'hill2', 'water1', 'water2', 'accent'];
const NUMS = ['stars', 'rain', 'aurora'];
const zoneOf = s => Math.min(ZONES.length - 1, Math.floor(s / ZONE_LEN));
const zonePal = z => {
  const Z = ZONES[z];
  const p = {};
  for (const k of COLS) p[k] = hexRgb(Z[k]);
  for (const k of NUMS) p[k] = Z[k];
  return p;
};

export const STONES = [
  { id: 'pebble', name: 'PEBBLE', col: '#a7b0b8', price: 0 },
  { id: 'slate', name: 'SLATE', col: '#5f7183', price: 60 },
  { id: 'jade', name: 'JADE', col: '#3fcf92', price: 120 },
  { id: 'rose', name: 'ROSE QUARTZ', col: '#ffa3c8', price: 200 },
  { id: 'obsidian', name: 'OBSIDIAN', col: '#3a3150', price: 320 },
  { id: 'lava', name: 'LAVA', col: '#ff5a1f', price: 480 },
  { id: 'gold', name: 'GOLD', col: '#ffc93c', price: 800 },
  { id: 'comet', name: 'COMET', col: 'comet', price: 1500 },
];

// ---------------------------------------------------------------- tuning
const speedAt = s => Math.min(700, 380 + s * 4);
const bpmAt = s => Math.min(110, 84 + s * 0.35);
const decayAt = s => 0.06 + Math.min(0.09, s * 0.0012);
// Tap windows around the moment the stone touches the water: PERFECT, GREAT, OK (seconds).
const winAt = s => {
  const f = Math.max(0.62, 1 - s * 0.005);
  return [0.045 * f, 0.085 * f, 0.13 * f];
};
const GAIN = { PERFECT: 0.13, GREAT: 0.06, OK: 0 };
// Arcs get shorter (faster rhythm) the further you go.
const flightT = (E, s = 0) => lerp(0.36, Math.max(0.6, 1 - s * 0.005), clamp(E, 0, 1));
const flightH = E => lerp(28, 210, clamp(E, 0, 1));
const STONE = { rx: 18, ry: 7 };
const RING_SPEED = 120; // approach ring shrink rate, world units per second

function waveY(x, t, A) {
  if (A < 0.3) return 0;
  return A * (0.62 * Math.sin(x * 0.0105 - t * 2.1) + 0.38 * Math.sin(x * 0.024 + t * 1.4));
}

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, S = 1, U = 1, Y0 = 0, SX = 0;
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
let coins = store.get('coins', 0);
let owned = store.get('owned', ['pebble']);
let stoneId = store.get('stone', 'pebble');
let plays = store.get('plays', 0);
let overT = 0;
let buttons = [];
let rec = null; // record-mode log
let stars = [];
let clouds = [];
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
  S = SW > SH ? Math.min(SW / 700, SH / 640) : Math.min(SW / 560, SH / 950);
  U = Math.min(SW / 420, SH / 640);
  Y0 = SH * 0.6;
  SX = SW * (SW > SH ? 0.36 : 0.3);
  if (OG) {
    S = 1.9;
    Y0 = SH * 0.74;
    SX = SW * 0.7;
  }
  const r = rng(7);
  stars = Array.from({ length: 110 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.4, p: r() * 6 }));
  clouds = Array.from({ length: 6 }, () => ({ x: r(), y: 0.08 + r() * 0.3, s: 0.6 + r() * 0.8 }));
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const off = opts.off ?? 0;
  const z = zoneOf(off);
  const r = {
    seed,
    rnd: rng(seed),
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    off,
    skips: off,
    E: opts.E ?? 0.9,
    streak: 0,
    maxStreak: 0,
    perfects: 0,
    coinsGot: 0,
    x: 0,
    y: 70,
    vx: speedAt(off),
    t: 0,
    fl: null,
    phase: 'fly',
    tapped: false,
    pending: null,
    doom: null,
    freeze: false,
    dead: false,
    deadT: 0,
    deathBy: null,
    svx: 0,
    svy: 0,
    slow: 1,
    slowT: 0,
    scale: 1,
    zone: z,
    waveA: ZONES[z].wave,
    ripples: [],
    parts: [],
    conf: [],
    pops: [],
    coinList: [],
    nextCoinX: 700,
    banner: null,
    passedBest: false,
    passedWR: off > WR,
    tutorial: !opts.bot && plays < 2,
    trail: [],
    spin: 0,
    lowWarned: false,
    botOff: 0,
    scoreBump: 0,
    dock: off === 0,
  };
  if (off === 0) launchFlight(r, 0, 70, 0, r.E, true);
  else {
    r.y = 0;
    launchFlight(r, 0, 0, 0, r.E, false);
  }
  r.botOff = r.bot ? botOffset(r, r.skips + 1) : null;
  palT = zonePal(z);
  if (!opts.keepPal) pal = zonePal(z);
  cam = { x: r.x, y: 0 };
  return r;
}

function startGame() {
  ensureAudio();
  run = newRun();
  mode = 'play';
  overT = 0;
  plays++;
  store.set('plays', plays);
  sfx('throw');
  sfx('revive');
}

function botOffset(r, k) {
  if (r.plan) return r.plan(k);
  if (r.attract) {
    if (k >= (r.crashAt ??= 14 + ((r.rnd() * 26) | 0))) return null;
    const x = r.rnd();
    return x < 0.6 ? (r.rnd() - 0.5) * 0.05 : x < 0.9 ? (r.rnd() < 0.5 ? -1 : 1) * (0.055 + r.rnd() * 0.035) : 0.11;
  }
  return 0;
}

// ---------------------------------------------------------------- flight
function launchFlight(r, x0, y0, t0, E, isThrow) {
  const T = flightT(E, r.skips), H = flightH(E);
  const gr = (8 * H) / (T * T);
  const vy = isThrow ? gr * T * 0.25 : (gr * T) / 2;
  r.fl = { x0, y0, t0, vy, g: gr, tc: null, xc: 0, yc: 0, apexT: t0 + vy / gr };
  predict(r);
}

// When does this flight touch the water? Waves move, so step forward and bisect.
function predict(r) {
  const f = r.fl;
  const xAt = t => f.x0 + r.vx * (t - f.t0);
  const h = t => f.y0 + f.vy * (t - f.t0) - (f.g * (t - f.t0) ** 2) / 2 - waveY(xAt(t), t, r.waveA);
  const dt = 1 / 240;
  let t = f.t0 + 0.06;
  while (t < f.t0 + 4) {
    if (h(t) > 0 && h(t + dt) <= 0) {
      let a = t, b = t + dt;
      for (let i = 0; i < 24; i++) {
        const m = (a + b) / 2;
        if (h(m) > 0) a = m;
        else b = m;
      }
      f.tc = b;
      break;
    }
    t += dt;
  }
  if (f.tc == null) f.tc = f.t0 + (2 * f.vy) / f.g;
  f.xc = xAt(f.tc);
  f.yc = waveY(f.xc, f.tc, r.waveA);
}

function ensureCoins(r) {
  while (r.nextCoinX < r.x + 2200) {
    const rr = rng((r.seed ^ (r.nextCoinX * 7919)) | 0);
    if (rr() < 0.55) {
      const n = rr() < 0.4 ? 3 : 1;
      const y = 50 + rr() * 140;
      for (let k = 0; k < n; k++) r.coinList.push({ x: r.nextCoinX + k * 36, y: y + Math.sin(k * 1.4) * 8, got: false });
    }
    r.nextCoinX += 380 + rr() * 620;
  }
  if (r.coinList.length > 40) r.coinList = r.coinList.filter(c => c.x > r.x - 900);
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
  const z = run ? run.zone : 0;
  const s = run ? run.skips : 0;
  let layer = run ? layerFor(run.skips) : 0;
  if (mode === 'title') layer = 2;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(s) };
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
  let ts = r.slow;
  if (r.tutorial && !r.dead && r.skips - r.off < 6) ts *= 0.72;
  if (r.freeze) ts = 0;
  r.scale = ts;
  const wdt = dt * ts;
  r.t += wdt;
  ensureCoins(r);

  if (!r.dead) stepStone(r, wdt);
  else stepSink(r, dt, wdt);

  // camera
  cam.x = lerp(cam.x, r.x, 1 - Math.exp(-8 * dt));
  cam.y = lerp(cam.y, r.dead ? Math.max(-60, r.y * 0.5) : 0, 1 - Math.exp(-3 * dt));
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  // palette blend
  const pk = 1 - Math.exp(-1.4 * dt);
  for (const k of COLS) for (let i = 0; i < 3; i++) pal[k][i] = lerp(pal[k][i], palT[k][i], pk);
  for (const k of NUMS) pal[k] = lerp(pal[k], palT[k], pk);

  // effects
  for (const rp of r.ripples) rp.t += wdt;
  r.ripples = r.ripples.filter(rp => rp.t < 2.6);
  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.vy -= (p.g ?? 0) * wdt;
    if (p.kind === 'bubble' && p.y > waveY(p.x, r.t, r.waveA) - 2) p.life = 0;
    if (p.kind === 'drop' && p.vy < 0 && p.y < waveY(p.x, r.t, r.waveA)) p.life = 0;
  }
  r.parts = r.parts.filter(p => p.life > 0);
  for (const c of r.conf) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.vy += 260 * U * dt;
    c.vx *= 0.99;
    c.a += c.va * dt;
    c.life -= dt;
  }
  r.conf = r.conf.filter(c => c.life > 0);
  for (const p of r.pops) p.t += dt;
  r.pops = r.pops.filter(p => p.t < p.dur);
  if (r.banner) {
    r.banner.t += dt;
    if (r.banner.t > 2.4) r.banner = null;
  }
  if (mode === 'over') overT += dt;

  if (!REC && audio && soundOn) music.tick(musicState());
}

function stepStone(r, wdt) {
  const f = r.fl;
  if (r.bot && !r.tapped && !r.doom && r.botOff != null && r.t >= f.tc + r.botOff) tap(r);
  if (r.phase === 'fly') {
    // First run: the stone waits at the water until the player taps, twice.
    if (r.tutorial && r.skips - r.off < 2 && !r.tapped && r.t >= f.tc - 0.015) {
      r.t = f.tc - 0.015;
      r.freeze = true;
    }
    const tt = Math.min(r.t, f.tc) - f.t0;
    r.x = f.x0 + r.vx * tt;
    r.y = f.y0 + f.vy * tt - (f.g * tt * tt) / 2;
    if (r.t >= f.tc) {
      if (r.pending) launch(r, r.pending, f.tc);
      else if (r.doom) sink(r, r.doom);
      else r.phase = 'skim';
    }
  } else if (r.phase === 'skim') {
    r.x += r.vx * 0.5 * wdt;
    r.y = waveY(r.x, r.t, r.waveA) - 2;
    if (r.rnd() < 0.7) r.parts.push({ x: r.x - 10, y: r.y, vx: -60 - r.rnd() * 80, vy: 90 + r.rnd() * 120, g: 900, life: 0.5, max: 0.5, size: 2 + r.rnd() * 2.5, kind: 'drop' });
    if (r.t > f.tc + winAt(r.skips)[2]) sink(r, 'LATE');
  }
  r.spin += wdt * (12 + r.E * 22);
  r.trail.push({ x: r.x, y: r.y });
  if (r.trail.length > 22) r.trail.shift();

  for (const c of r.coinList) {
    if (c.got || Math.abs(c.x - r.x) > 40) continue;
    if ((c.x - r.x) ** 2 + (c.y - r.y) ** 2 < 28 * 28) {
      c.got = true;
      r.coinsGot++;
      sfx('coin');
      for (let i = 0; i < 8; i++) {
        const a = r.rnd() * Math.PI * 2;
        r.parts.push({ x: c.x, y: c.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, g: 300, life: 0.45, max: 0.45, size: 3, kind: 'spark', col: [255, 214, 80] });
      }
    }
  }
}

// One tap per skip, judged against the moment the stone touches the water.
function tap(r) {
  if (!r || r.dead || r.tapped || r.doom) return;
  const f = r.fl;
  const [wp, wg, wo] = winAt(r.skips);
  const d = r.t - f.tc;
  if (r.phase === 'fly' && d < -wo && !r.freeze) {
    if (r.t < f.apexT || r.tutorial) return; // still rising (or still learning): ignore
    r.doom = 'EARLY';
    r.tapped = true;
    r.pops.push({ text: 'TOO EARLY!', sub: '', x: r.x, y: r.y, t: 0, dur: 1, col: [255, 90, 110], size: 0.9 });
    sfx('wobble');
    vibrate(30);
    return;
  }
  const ad = Math.abs(d);
  const q = r.freeze || ad <= wp ? 'PERFECT' : ad <= wg ? 'GREAT' : 'OK';
  r.tapped = true;
  r.freeze = false;
  if (r.phase === 'fly' && r.t < f.tc) r.pending = q;
  else launch(r, q, r.phase === 'fly' ? f.tc : r.t);
}

function launch(r, q, tAt) {
  const f = r.fl;
  const x = r.phase === 'skim' ? r.x : f.xc;
  const nE = Math.min(1, r.E - decayAt(r.skips) + GAIN[q]);
  if (nE < 0) {
    r.x = x;
    sink(r, 'TIRED');
    return;
  }
  r.E = nE;
  r.skips++;
  if (q === 'PERFECT') {
    r.streak++;
    r.perfects++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  } else r.streak = 0;
  r.phase = 'fly';
  r.tapped = false;
  r.pending = null;
  r.doom = null;
  r.vx = speedAt(r.skips);
  r.waveA = lerp(r.waveA, ZONES[zoneOf(r.skips)].wave, 0.35);
  const y0 = waveY(x, tAt, r.waveA);
  r.x = x;
  r.y = y0;
  launchFlight(r, x, y0, tAt, r.E, false);
  r.botOff = r.bot ? botOffset(r, r.skips + 1) : null;
  r.scoreBump = 1;
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });

  // juice
  const big = q === 'PERFECT';
  r.ripples.push({ x, t: 0, big });
  const n = big ? 16 : q === 'GREAT' ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.15 + r.rnd() * 0.7);
    const sp = 120 + r.rnd() * (big ? 260 : 160);
    r.parts.push({ x, y: y0, vx: Math.cos(a) * sp - r.vx * 0.15, vy: Math.sin(a) * sp, g: 900, life: 0.9, max: 0.9, size: 2 + r.rnd() * 3, kind: 'drop' });
  }
  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  sfx('skip', { q, m: skipNote(root, q, r.streak) });
  if (!r.attract) {
    const col = big ? hexRgb('#ffd650') : q === 'GREAT' ? [255, 255, 255] : [180, 200, 215];
    r.pops.push({ text: big ? (r.streak >= 3 ? 'PERFECT!!' : 'PERFECT!') : q, sub: big && r.streak > 1 ? 'x' + r.streak : '', x, y: y0, t: 0, dur: 0.8, col, size: big ? 1 : q === 'GREAT' ? 0.85 : 0.7 });
  }
  if (big) {
    for (let i = 0; i < 10; i++) {
      const a = r.rnd() * Math.PI * 2, sp = 80 + r.rnd() * 160;
      r.parts.push({ x, y: y0 + 6, vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp, g: 200, life: 0.6, max: 0.6, size: 3 + r.rnd() * 2, kind: 'spark', col: [255, 236, 160] });
    }
    flash = Math.max(flash, r.streak >= 5 ? 0.14 : 0.07);
    vibrate(15);
  } else vibrate(8);
  if (r.E < 0.25 && !r.lowWarned) {
    r.lowWarned = true;
    if (!r.attract) sfx('low');
  } else if (r.E > 0.45) r.lowWarned = false;

  const z = zoneOf(r.skips);
  if (z !== r.zone) {
    r.zone = z;
    palT = zonePal(z);
    if (!r.attract) {
      r.banner = { text: ZONES[z].name, sub: r.skips + ' SKIPS', t: 0 };
      sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
    }
  }
  if (!r.bot && !r.passedBest && best > 0 && r.skips > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep skipping', t: 0 };
    sfx('best', { root });
    flash = 0.3;
  }
  if (!r.passedWR && r.skips > WR && !r.attract) {
    r.passedWR = true;
    r.banner = { text: 'WORLD RECORD!', sub: 'you beat ' + WR + ' skips', t: 0 };
    sfx('record', { root });
    flash = 0.5;
    for (let i = 0; i < 140; i++) {
      r.conf.push({ x: SW * (0.1 + r.rnd() * 0.8), y: -20 - r.rnd() * SH * 0.3, vx: (r.rnd() - 0.5) * 200 * U, vy: r.rnd() * 120 * U, a: r.rnd() * 6, va: (r.rnd() - 0.5) * 12, life: 3.5, col: ['#ffd650', '#ff6b9d', '#6bffc8', '#7fd4ff', '#ffffff'][i % 5] });
    }
  }
}

function sink(r, why) {
  r.dead = true;
  r.deadT = 0;
  r.deathBy = why;
  r.phase = 'sink';
  r.svx = r.vx * 0.25;
  r.svy = -70;
  r.y = Math.min(r.y, waveY(r.x, r.t, r.waveA));
  r.ripples.push({ x: r.x, t: 0, big: true, plunk: true });
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * (0.3 + r.rnd() * 0.4);
    const sp = 150 + r.rnd() * 220;
    r.parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, g: 900, life: 1, max: 1, size: 2.5 + r.rnd() * 3.5, kind: 'drop' });
  }
  r.slow = 0.4;
  r.slowT = 0.5;
  shake = 0.6;
  if (!r.attract) {
    sfx('plunk');
    vibrate([60, 40, 90]);
    r.pops.push({ text: 'PLUNK!', sub: why === 'LATE' ? 'too late' : why === 'TIRED' ? 'out of steam' : '', x: r.x, y: r.y + 40, t: 0, dur: 1.2, col: [255, 255, 255], size: 1.2 });
  }
}

function stepSink(r, dt, wdt) {
  r.deadT += dt;
  r.x += r.svx * wdt;
  r.svx *= Math.exp(-2.5 * wdt);
  r.y += r.svy * wdt;
  r.svy = lerp(r.svy, -45, 1 - Math.exp(-2 * wdt));
  r.spin += wdt * 3;
  if (r.rnd() < 0.25) r.parts.push({ x: r.x + (r.rnd() - 0.5) * 14, y: r.y, vx: (r.rnd() - 0.5) * 20, vy: 60 + r.rnd() * 50, g: -40, life: 1.4, max: 1.4, size: 2 + r.rnd() * 3, kind: 'bubble' });
  if (r.attract && r.deadT > 1.8) {
    run = newRun({ bot: true, attract: true, keepPal: true });
  } else if (!r.attract && mode === 'play' && r.deadT > 1.15) {
    gameOver(r);
  }
}

function gameOver(r) {
  mode = 'over';
  overT = 0;
  const n = r.skips;
  const earned = r.coinsGot + r.perfects + Math.floor(n / 5);
  r.earned = earned;
  r.prevBest = best;
  r.isBest = n > best;
  coins += earned;
  store.set('coins', coins);
  if (r.isBest) {
    best = n;
    store.set('best', best);
  }
}

// ---------------------------------------------------------------- render
const PX = x => SX + (x - cam.x) * S + shakeX;
const PY = y => Y0 - (y - cam.y) * S + shakeY;

function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 16 * U;
  shakeY = (Math.random() - 0.5) * shake * 16 * U;
  const r = run;
  drawSky();
  drawHills();
  drawWater(r);
  if (r) {
    if (r.dock) drawDock();
    drawRipples(r);
    drawCoins(r);
    if (!r.dead) {
      drawTarget(r);
      drawShadow(r);
      drawTrail(r);
      drawStone(r);
    }
    drawParts(r);
    if (r.dead) drawStone(r);
  }
  drawRain();
  if (r) drawPops(r);
  if (flash > 0.01) {
    g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, SW, SH);
  }
  buttons = [];
  if (mode === 'title') drawTitle();
  else if (r) {
    if (!(REC && (mode === 'over' || hookOn()))) drawHUD(r);
    if (mode === 'over') drawOver(r);
  }
  if (r) drawConfetti(r);
  if (REC && r) drawCaptions(r);
}

function drawSky() {
  const gr = g.createLinearGradient(0, 0, 0, Y0);
  gr.addColorStop(0, css(pal.sky1));
  gr.addColorStop(1, css(pal.sky2));
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, Y0 + 2);
  // stars
  if (pal.stars > 0.02) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(tReal * 2 + s.p);
      const x = ((s.x * SW - cam.x * S * 0.01) % SW + SW) % SW;
      const y = s.y * Y0 * 0.85;
      g.fillStyle = `rgba(255,255,255,${(0.2 + tw * 0.6) * pal.stars * (1 - y / Y0)})`;
      g.fillRect(x, y, s.s * U, s.s * U);
    }
  }
  // aurora ribbons
  if (pal.aurora > 0.02) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const cols = [[80, 255, 180], [120, 160, 255], [200, 110, 255]];
    for (let k = 0; k < 3; k++) {
      const yb = Y0 * (0.18 + k * 0.1);
      const gr2 = g.createLinearGradient(0, yb - 70 * U, 0, yb + 50 * U);
      gr2.addColorStop(0, css(cols[k], 0));
      gr2.addColorStop(0.6, css(cols[k], 0.22 * pal.aurora));
      gr2.addColorStop(1, css(cols[k], 0));
      g.fillStyle = gr2;
      g.beginPath();
      for (let x = 0; x <= SW + 10; x += 12) {
        const y = yb + Math.sin(x * 0.006 + tReal * 0.5 + k * 2) * 26 * U + Math.sin(x * 0.017 - tReal * 0.8 + k) * 10 * U;
        if (x === 0) g.moveTo(x, y - 70 * U);
        else g.lineTo(x, y - 70 * U);
      }
      for (let x = SW + 10; x >= 0; x -= 12) {
        const y = yb + Math.sin(x * 0.006 + tReal * 0.5 + k * 2) * 26 * U + Math.sin(x * 0.017 - tReal * 0.8 + k) * 10 * U;
        g.lineTo(x, y + 50 * U);
      }
      g.fill();
    }
    g.restore();
  }
  // sun or moon
  const sr = Math.min(SW, SH * 0.6) * 0.11 * (OG ? 1.4 : 1);
  const sx = OG ? SW * 0.86 : SW * 0.76, sy = OG ? Y0 - SH * 0.42 : Y0 - Math.min(SH * 0.19, Y0 * 0.42);
  const halo = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 4);
  halo.addColorStop(0, css(pal.sun, 0.4));
  halo.addColorStop(1, css(pal.sun, 0));
  g.fillStyle = halo;
  g.fillRect(sx - sr * 4, sy - sr * 4, sr * 8, sr * 8);
  g.fillStyle = css(pal.sun);
  g.beginPath();
  g.arc(sx, sy, sr, 0, Math.PI * 2);
  g.fill();
  // clouds (fade out at night)
  const ca = (1 - pal.stars) * 0.55;
  if (ca > 0.02) {
    const cc = mix(pal.sky2, [255, 255, 255], 0.6);
    g.fillStyle = css(cc, ca);
    for (const c of clouds) {
      const span = SW * 1.6;
      const x = ((c.x * span - cam.x * S * 0.03 + tReal * 5 * U) % span + span) % span - SW * 0.3;
      const y = c.y * Y0;
      const w = 60 * U * c.s;
      g.beginPath();
      g.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2);
      g.ellipse(x + w * 0.5, y - w * 0.18, w * 0.55, w * 0.38, 0, 0, Math.PI * 2);
      g.ellipse(x - w * 0.45, y - w * 0.08, w * 0.45, w * 0.28, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

const hillH = (x, s) => 0.5 + 0.25 * Math.sin(x * 0.0021 + s) + 0.15 * Math.sin(x * 0.0057 + s * 2.3) + 0.1 * Math.sin(x * 0.013 + s * 4.1);

function drawHills() {
  const layers = [
    { par: 0.05, amp: SH * 0.11, col: pal.hill1, seed: 1.3, trees: false },
    { par: 0.16, amp: SH * 0.07, col: pal.hill2, seed: 4.7, trees: true },
  ];
  for (const L of layers) {
    const off = cam.x * S * L.par;
    g.fillStyle = css(L.col);
    g.beginPath();
    g.moveTo(0, SH);
    for (let x = 0; x <= SW + 8; x += 8) g.lineTo(x, Y0 - hillH((off + x) / U, L.seed) * L.amp);
    g.lineTo(SW + 8, SH);
    g.fill();
    if (L.trees) {
      const sp = 22 * U;
      const i0 = Math.floor(off / sp);
      for (let i = i0; i < i0 + SW / sp + 2; i++) {
        if (hash(i, 3) > 0.5) continue;
        const x = i * sp - off + hash(i, 5) * sp * 0.6;
        const base = Y0 - hillH((off + x) / U, L.seed) * L.amp + 3 * U;
        const h = (14 + hash(i, 9) * 18) * U;
        g.beginPath();
        g.moveTo(x, base - h);
        g.lineTo(x + h * 0.32, base);
        g.lineTo(x - h * 0.32, base);
        g.fill();
      }
    }
  }
  // haze where hills meet the water
  const hz = g.createLinearGradient(0, Y0 - SH * 0.06, 0, Y0);
  hz.addColorStop(0, css(pal.sky2, 0));
  hz.addColorStop(1, css(pal.sky2, 0.35));
  g.fillStyle = hz;
  g.fillRect(0, Y0 - SH * 0.06, SW, SH * 0.06);
}

function drawWater(r) {
  const t = r ? r.t : tReal;
  const A = r ? r.waveA : 0;
  const top = [];
  for (let sx = -8; sx <= SW + 8; sx += 6) {
    const wx = cam.x + (sx - SX) / S;
    top.push([sx, PY(waveY(wx, t, A))]);
  }
  const gr = g.createLinearGradient(0, Y0, 0, SH);
  gr.addColorStop(0, css(pal.water1));
  gr.addColorStop(1, css(pal.water2));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-8, SH);
  for (const [x, y] of top) g.lineTo(x, y);
  g.lineTo(SW + 8, SH);
  g.fill();

  // sun reflection
  const sx = OG ? SW * 0.86 : SW * 0.76;
  for (let i = 0; i < 18; i++) {
    const d = i / 18;
    const y = Y0 + 6 * U + (SH - Y0) * 0.75 * d * d + d * 8 * U;
    const w = (30 + d * 70) * U * (0.6 + 0.4 * Math.sin(tReal * 3 + i * 1.7));
    g.fillStyle = css(pal.sun, 0.22 * (1 - d));
    g.fillRect(sx - w / 2 + Math.sin(tReal * 2 + i) * 6 * U, y, w, 2.5 * U);
  }
  // shimmer dashes, nearer rows slide past faster
  for (let j = 0; j < 14; j++) {
    const d = (j + 0.5) / 14;
    const y = Y0 + 8 * U + (SH - Y0) * Math.pow(d, 1.5);
    const p = 0.25 + 1.3 * d;
    const sp = (70 + 210 * d) * U;
    const len = (12 + 46 * d) * U;
    const off = cam.x * S * p;
    const i0 = Math.floor(off / sp);
    g.fillStyle = `rgba(255,255,255,${0.07 + 0.11 * d})`;
    for (let i = i0 - 1; i < i0 + SW / sp + 2; i++) {
      const x = i * sp - off + hash(i, j) * sp * 0.7;
      g.fillRect(x, y, len, (1.5 + d * 2) * U);
    }
  }
  // bright surface line
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 2 * U;
  g.beginPath();
  top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

function drawDock() {
  const x0 = PX(-420), x1 = PX(12), y = PY(20), h = 9 * S;
  if (x1 < -20) return;
  g.fillStyle = '#5b3a24';
  for (let x = -400; x <= 0; x += 70) g.fillRect(PX(x) - 4 * S, y, 8 * S, 42 * S);
  g.fillStyle = '#8a5a36';
  g.fillRect(x0, y - h, x1 - x0, h);
  g.fillStyle = '#a8703f';
  g.fillRect(x0, y - h, x1 - x0, 3 * S);
}

function drawRipples(r) {
  for (const rp of r.ripples) {
    const y = PY(waveY(rp.x, r.t, r.waveA));
    const x = PX(rp.x);
    const rings = rp.big ? 3 : 2;
    for (let k = 0; k < rings; k++) {
      const a = rp.t - k * 0.14;
      if (a <= 0) continue;
      const rad = (10 + a * (rp.plunk ? 55 : 75) * (rp.big ? 1.3 : 1)) * S;
      const al = (1 - a / 2.2) * (rp.big ? 0.85 : 0.6);
      if (al <= 0) continue;
      g.strokeStyle = `rgba(255,255,255,${al})`;
      g.lineWidth = (rp.big && k === 0 ? 3 : 2) * U;
      g.beginPath();
      g.ellipse(x, y, rad, rad * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function drawCoins(r) {
  for (const c of r.coinList) {
    if (c.got) continue;
    const x = PX(c.x), y = PY(c.y + Math.sin(tReal * 3 + c.x) * 4);
    if (x < -30 || x > SW + 30) continue;
    const rr = 8 * S;
    const sp = Math.abs(Math.cos(tReal * 3 + c.x * 0.01));
    const gl = g.createRadialGradient(x, y, 0, x, y, rr * 3);
    gl.addColorStop(0, 'rgba(255,214,80,0.45)');
    gl.addColorStop(1, 'rgba(255,214,80,0)');
    g.fillStyle = gl;
    g.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
    gem(x, y, rr, sp);
  }
}

function gem(x, y, rr, sp = 1) {
  g.fillStyle = '#ffd650';
  poly([[x, y - rr * 1.3], [x + rr * sp, y], [x, y + rr * 1.3], [x - rr * sp, y]]);
  g.fill();
  g.fillStyle = '#fff6c8';
  poly([[x, y - rr * 1.3], [x + rr * sp * 0.4, y], [x, y + rr * 0.3]]);
  g.fill();
}

// The approach ring closes on the exact spot and moment the stone meets the water.
function drawTarget(r) {
  const f = r.fl;
  if (r.phase === 'skim') {
    const x = PX(r.x), y = PY(r.y);
    const p = 0.5 + 0.5 * Math.sin(tReal * 30);
    const late = r.t - f.tc > winAt(r.skips)[1];
    g.strokeStyle = late ? `rgba(255,90,110,${0.6 + p * 0.4})` : 'rgba(255,214,80,0.9)';
    g.lineWidth = 3 * U;
    g.beginPath();
    g.ellipse(x, y, 26 * S, 26 * S * 0.3, 0, 0, Math.PI * 2);
    g.stroke();
    return;
  }
  const remain = f.tc - r.t;
  const total = f.tc - f.t0;
  const p = 1 - remain / total;
  const al = clamp((p - 0.2) / 0.3, 0, 1);
  if (al <= 0) return;
  const x = PX(f.xc), y = PY(waveY(f.xc, r.t, r.waveA));
  const [wp] = winAt(r.skips);
  const inPerfect = Math.abs(remain) <= wp;
  const rad = (STONE.rx + 4 + RING_SPEED * Math.max(0, remain)) * S;
  const base = r.doom ? [255, 90, 110] : r.pending ? [255, 255, 255] : inPerfect ? hexRgb('#ffd650') : [255, 255, 255];
  // goal
  g.fillStyle = css(base, 0.16 * al);
  g.beginPath();
  g.ellipse(x, y, (STONE.rx + 4) * S, (STONE.rx + 4) * S * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = css(base, 0.5 * al);
  g.lineWidth = 2 * U;
  g.stroke();
  // closing ring
  g.strokeStyle = css(base, (inPerfect ? 1 : 0.85) * al);
  g.lineWidth = (inPerfect ? 4 : 3) * U;
  g.beginPath();
  g.ellipse(x, y, rad, rad * 0.3, 0, 0, Math.PI * 2);
  g.stroke();
}

function drawShadow(r) {
  const sy = waveY(r.x, r.t, r.waveA);
  const h = Math.max(0, r.y - sy);
  const k = 1 - clamp(h / 240, 0, 1);
  g.fillStyle = `rgba(0,20,40,${0.12 + 0.22 * k})`;
  g.beginPath();
  g.ellipse(PX(r.x), PY(sy), STONE.rx * S * (0.6 + 0.5 * k), STONE.rx * S * 0.2 * (0.6 + 0.5 * k), 0, 0, Math.PI * 2);
  g.fill();
}

function stoneColor(r) {
  const st = STONES.find(s => s.id === (r.bot && !REC ? 'pebble' : stoneId)) || STONES[0];
  if (st.col === 'comet') return hslRgb((tReal * 120) % 360, 0.9, 0.62);
  return hexRgb(st.col);
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
  const col = mix(stoneColor(r), [255, 255, 255], 0.6);
  g.lineCap = 'round';
  for (let i = 1; i < tr.length; i++) {
    const k = i / tr.length;
    g.strokeStyle = css(col, k * (0.25 + 0.45 * r.E));
    g.lineWidth = (2 + k * 5) * S;
    g.beginPath();
    g.moveTo(PX(tr[i - 1].x), PY(tr[i - 1].y));
    g.lineTo(PX(tr[i].x), PY(tr[i].y));
    g.stroke();
  }
  g.lineCap = 'butt';
}

function drawStone(r) {
  const col = stoneColor(r);
  const x = PX(r.x), y = PY(r.y + STONE.ry * 0.6);
  const under = r.dead && r.y < waveY(r.x, r.t, r.waveA) - 4;
  g.save();
  if (under) g.globalAlpha = clamp(1 - r.deadT / 1.2, 0, 1) * 0.6;
  // momentum glow
  if (!r.dead && r.E > 0.3) {
    const gl = g.createRadialGradient(x, y, 0, x, y, 40 * S);
    gl.addColorStop(0, css(mix(col, [255, 255, 255], 0.5), 0.35 * r.E));
    gl.addColorStop(1, css(col, 0));
    g.fillStyle = gl;
    g.fillRect(x - 40 * S, y - 40 * S, 80 * S, 80 * S);
  }
  g.translate(x, y);
  g.rotate(r.dead ? Math.sin(r.spin) * 0.6 : -0.12);
  const rx = STONE.rx * S, ry = STONE.ry * S;
  // body
  g.fillStyle = css(shade(col, 0.55));
  g.beginPath();
  g.ellipse(0, ry * 0.25, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  const gr = g.createLinearGradient(0, -ry, 0, ry);
  gr.addColorStop(0, css(mix(col, [255, 255, 255], 0.35)));
  gr.addColorStop(1, css(shade(col, 0.8)));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(0, 0, rx, ry * 0.85, 0, 0, Math.PI * 2);
  g.fill();
  // spinning fleck shows the spin
  const s = Math.sin(r.spin);
  g.fillStyle = css(shade(col, 0.6), 0.8);
  g.beginPath();
  g.ellipse(s * rx * 0.6, -ry * 0.05, rx * 0.16 * (1 - Math.abs(s) * 0.5), ry * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(-rx * 0.3, -ry * 0.4, rx * 0.35, ry * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawParts(r) {
  for (const p of r.parts) {
    const x = PX(p.x), y = PY(p.y);
    const k = p.life / p.max;
    if (p.kind === 'drop') {
      g.fillStyle = `rgba(230,248,255,${0.9 * Math.min(1, k * 2)})`;
      g.beginPath();
      g.arc(x, y, p.size * S, 0, Math.PI * 2);
      g.fill();
    } else if (p.kind === 'bubble') {
      g.strokeStyle = `rgba(220,245,255,${0.7 * k})`;
      g.lineWidth = 1.5 * U;
      g.beginPath();
      g.arc(x, y, p.size * S, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = css(p.col, Math.min(1, k * 1.5));
      const s = p.size * S;
      poly([[x, y - s * 1.6], [x + s * 0.5, y], [x, y + s * 1.6], [x - s * 0.5, y]]);
      g.fill();
      poly([[x - s * 1.6, y], [x, y - s * 0.5], [x + s * 1.6, y], [x, y + s * 0.5]]);
      g.fill();
    }
  }
}

function drawRain() {
  if (pal.rain < 0.03) return;
  g.strokeStyle = `rgba(210,230,255,${0.32 * pal.rain})`;
  g.lineWidth = 1.4 * U;
  g.beginPath();
  for (let i = 0; i < 90; i++) {
    const sp = 900 + hash(i, 1) * 500;
    const x = ((hash(i, 2) * SW * 1.3 - tReal * sp * 0.25) % (SW * 1.3) + SW * 1.3) % (SW * 1.3);
    const y = ((hash(i, 4) * SH + tReal * sp) % SH);
    g.moveTo(x, y);
    g.lineTo(x - 6 * U, y + 22 * U);
  }
  g.stroke();
}

function drawConfetti(r) {
  for (const c of r.conf) {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.a);
    g.globalAlpha = clamp(c.life, 0, 1);
    g.fillStyle = c.col;
    g.fillRect(-5 * U, -3 * U, 10 * U, 6 * U * Math.abs(Math.cos(c.a * 2)));
    g.restore();
  }
}

function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || '800'} ${size}px ${opts.font || FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(4,20,34,0.85)';
    g.lineJoin = 'round';
    g.strokeText(str, x, y);
  }
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = opts.blur ?? 16 * U;
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.shadowBlur = 0;
}

function drawPops(r) {
  for (const p of r.pops) {
    const x = clamp(PX(p.x), 110 * U, SW - 110 * U);
    const y0 = PY(p.y);
    const k = p.t / p.dur;
    const sc = back(p.t / 0.2) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const yy = y0 - (54 + ease(k) * 46) * U;
    g.globalAlpha = a;
    text(p.text, x, yy, 30 * U * sc, css(p.col), 'center', { stroke: 7 * U });
    if (p.sub) text(p.sub, x, yy + 27 * U * sc, 18 * U * sc, '#fff', 'center', { stroke: 5 * U });
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

// Progress toward the world record, with your best marked on it.
function wrBar(cx, y, w, n, showBest) {
  const max = n > WR ? Math.max(n + 12, 120) : WR;
  const h = 9 * U, x0 = cx - w / 2;
  g.fillStyle = 'rgba(4,20,34,0.45)';
  roundRect(x0 - 2 * U, y - h / 2 - 2 * U, w + 4 * U, h + 4 * U, h);
  g.fill();
  const fw = Math.max(h, (w * Math.min(n, max)) / max);
  g.fillStyle = n > WR ? '#ffd650' : css(pal.accent);
  roundRect(x0, y - h / 2, fw, h, h / 2);
  g.fill();
  if (showBest && best > 0 && best < max) {
    const bx = x0 + (w * best) / max;
    g.fillStyle = '#fff';
    g.fillRect(bx - 1.5 * U, y - h, 3 * U, h * 2);
    text('BEST', bx, y + h + 6 * U, 9 * U, 'rgba(255,255,255,0.85)', 'center', { stroke: 3 * U });
  }
  if (n <= WR) {
    // the record flag
    const fx = x0 + w;
    g.fillStyle = '#fff';
    g.fillRect(fx - 1 * U, y - h * 1.9, 2.5 * U, h * 2.6);
    g.fillStyle = '#ffd650';
    poly([[fx + 1.5 * U, y - h * 1.9], [fx + 16 * U, y - h * 1.45], [fx + 1.5 * U, y - h]]);
    g.fill();
    text('WR ' + WR, fx, y + h + 6 * U, 9 * U, '#ffd650', 'center', { stroke: 3 * U });
  }
}

function drawHUD(r) {
  const top = (REC ? 300 : 0) + Math.max(26 * U, 20);
  const bump = 1 + r.scoreBump * 0.22;
  text(String(r.skips), SW / 2, top + 30 * U, 62 * U * bump, '#fff', 'center', { stroke: 8 * U, glow: css(pal.accent, 0.8) });
  const toGo = WR - r.skips;
  if (toGo > 0 && toGo <= 5 && !r.dead) {
    const p = 0.5 + 0.5 * Math.sin(tReal * 10);
    text(toGo === 1 ? 'ONE MORE TIES THE WORLD RECORD' : toGo + ' MORE TO THE WORLD RECORD', SW / 2, top + 66 * U, (14 + p) * U, '#ffd650', 'center', { stroke: 5 * U });
  } else text('SKIPS', SW / 2, top + 66 * U, 13 * U, 'rgba(255,255,255,0.9)', 'center', { stroke: 4 * U });
  const bw = Math.min(SW * 0.6, 250 * U);
  wrBar(SW / 2, top + 92 * U, bw, r.skips, !r.bot || REC);
  // momentum meter
  const my = top + 122 * U, mw = 110 * U, mh = 6 * U;
  const lowE = r.E < 0.25 && !r.dead;
  const blink = lowE ? 0.5 + 0.5 * Math.sin(tReal * 14) : 1;
  const mc = r.E > 0.5 ? [120, 255, 170] : r.E > 0.25 ? [255, 214, 80] : [255, 90, 100];
  g.fillStyle = 'rgba(4,20,34,0.45)';
  roundRect(SW / 2 - mw / 2, my - mh / 2, mw, mh, mh / 2);
  g.fill();
  g.fillStyle = css(mc, blink);
  roundRect(SW / 2 - mw / 2, my - mh / 2, Math.max(mh, mw * clamp(r.E, 0, 1)), mh, mh / 2);
  g.fill();
  text(lowE ? 'LOW MOMENTUM' : 'MOMENTUM', SW / 2, my + 13 * U, 9 * U, lowE ? css(mc, blink) : 'rgba(255,255,255,0.75)', 'center', { stroke: 3 * U });
  // coins + sound
  if (!REC) {
    gem(26 * U, top + 6 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 7 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
    soundButton(SW - 28 * U, top + 6 * U);
  }
  // zone / best banner
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.4;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = SH * (REC ? 0.42 : 0.33);
    g.fillStyle = 'rgba(4,20,34,0.45)';
    g.fillRect(0, y - 40 * U, SW, 80 * U);
    text(b.text, SW / 2, y - 6 * U, 34 * U * back(b.t / 0.3), '#fff', 'center', { glow: css(pal.accent) });
    text(b.sub, SW / 2, y + 24 * U, 14 * U, css(pal.accent), 'center', { weight: '700' });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  if (r.tutorial && !r.dead && r.skips - r.off < 6) {
    const yb = SH * 0.86;
    if (r.freeze) {
      const p = 0.5 + 0.5 * Math.sin(tReal * 8);
      text('TAP!', SW / 2, yb - 40 * U, (40 + p * 6) * U, '#fff', 'center', { stroke: 8 * U, glow: '#ffd650' });
      text('tap when the stone touches the water', SW / 2, yb, 15 * U, '#fff', 'center', { stroke: 5 * U });
    } else if (r.skips - r.off < 2) {
      text('watch the ring close in…', SW / 2, yb, 16 * U, '#fff', 'center', { stroke: 5 * U });
    } else if (r.phase === 'fly' && r.fl.tc - r.t < winAt(r.skips)[1] && !r.tapped) {
      text('NOW!', SW / 2, yb - 20 * U, 40 * U, '#ffd650', 'center', { stroke: 8 * U });
    } else text('tap each time it touches the water', SW / 2, yb, 15 * U, '#fff', 'center', { stroke: 5 * U });
  }
}

function soundButton(x, y) {
  const r = 16 * U;
  g.fillStyle = 'rgba(4,20,34,0.35)';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  poly([[x - 7 * U, y - 3 * U], [x - 3 * U, y - 3 * U], [x + 3 * U, y - 8 * U], [x + 3 * U, y + 8 * U], [x - 3 * U, y + 3 * U], [x - 7 * U, y + 3 * U]]);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2 * U;
  g.beginPath();
  if (soundOn) {
    g.arc(x + 4 * U, y, 6 * U, -0.8, 0.8);
  } else {
    g.moveTo(x + 6 * U, y - 5 * U);
    g.lineTo(x + 12 * U, y + 5 * U);
    g.moveTo(x + 12 * U, y - 5 * U);
    g.lineTo(x + 6 * U, y + 5 * U);
  }
  g.stroke();
  buttons.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, act: toggleSound });
}

function pill(label, x, y, w, h, bg, fg, act, size = 20) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  g.fillStyle = bg;
  roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  text(label, x, y + 2 * U, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

function logo(x, y, s) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.05 + Math.sin(tReal * 2) * (OG ? 0 : 0.012));
  text('STONE', 0, -34 * s, 64 * s, '#fff', 'center', { stroke: 10 * s, glow: 'rgba(0,30,60,0.6)', blur: 20 * s });
  text('SKIP', 0, 26 * s, 74 * s, css(pal.accent), 'center', { stroke: 11 * s, glow: 'rgba(0,30,60,0.6)', blur: 20 * s });
  g.restore();
}

function drawOgTitle() {
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(10,20,40,0.6)');
  gr.addColorStop(1, 'rgba(10,20,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.25, y = SH * 0.36;
  logo(x, y, 1.75);
  text('how many times can you skip a stone?', x, y + 140, 30, '#fff', 'center', { stroke: 8 });
  pill('WORLD RECORD: 88 SKIPS', x, y + 196, 400, 52, '#ffd650', '#2a1a00', null, 26);
  text('free · no download · one tap', x, y + 252, 22, 'rgba(255,255,255,0.9)', 'center', { weight: '700', stroke: 6 });
}

function drawTitle() {
  if (OG) return drawOgTitle();
  const gr = g.createLinearGradient(0, SH * 0.5, 0, SH);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(2,14,26,0.6)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const y = SH * 0.2;
  logo(SW / 2, y, U);
  text('tap when it touches the water', SW / 2, y + 86 * U, 16 * U, '#fff', 'center', { stroke: 5 * U });
  pill('WORLD RECORD: 88 SKIPS', SW / 2, y + 124 * U, 230 * U, 34 * U, '#ffd650', '#2a1a00', null, 15);
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  text('TAP TO PLAY', SW / 2, SH * 0.79, (28 + p * 3) * U, '#fff', 'center', { stroke: 7 * U, glow: css(pal.accent) });
  if (best > 0) text('BEST  ' + best + ' SKIPS', SW / 2, SH * 0.79 + 36 * U, 15 * U, css(pal.accent), 'center', { stroke: 4 * U });
  pill('ROCK SHOP', SW / 2, SH * 0.915, 160 * U, 40 * U, 'rgba(255,255,255,0.2)', '#fff', openShop, 16);
  gem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 17 * U, '#ffd650', 'left', { stroke: 4 * U });
  soundButton(SW - 28 * U, 34 * U);
}

const DEATH = { EARLY: 'TOO EARLY!', LATE: 'TOO LATE!', TIRED: 'OUT OF STEAM' };
const TIP = {
  EARLY: 'tip: wait for the stone to touch the water',
  LATE: 'tip: tap the moment the ring closes',
  TIRED: 'tip: PERFECT skips refill your momentum',
};

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(2,12,22,${0.5 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.48 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 300 : 370) * U;
  g.fillStyle = 'rgba(8,30,48,0.94)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 22 * U);
  g.fill();
  g.strokeStyle = css(pal.accent, 0.8);
  g.lineWidth = 2 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  const n = r.skips;
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 38 * U, 30 * U * back(overT / 0.4), '#ffd650', 'center', { glow: '#ffd650' });
  else text(DEATH[r.deathBy] || 'PLUNK!', SW / 2, t0 + 38 * U, 26 * U, '#fff');
  text(String(n), SW / 2, t0 + 98 * U, 70 * U, '#fff', 'center', { glow: css(pal.accent) });
  text(n === 1 ? 'SKIP' : 'SKIPS', SW / 2, t0 + 138 * U, 14 * U, 'rgba(255,255,255,0.8)');
  const short = WR - n;
  const sub = n > WR ? 'you beat the world record!' : short === 0 ? 'you TIED the world record!' : short + (short === 1 ? ' skip' : ' skips') + ' short of the world record';
  text(sub, SW / 2, t0 + 166 * U, 15 * U, '#ffd650', 'center', { weight: '800' });
  wrBar(SW / 2, t0 + 192 * U, cw - 90 * U, n, !REC);
  if (REC) {
    text('play free, no download →', SW / 2, t0 + 236 * U, 16 * U, '#fff', 'center', { weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 266 * U, 17 * U, css(pal.accent), 'center');
  } else {
    const tip = n < 10 && TIP[r.deathBy];
    if (tip) text(tip, SW / 2, t0 + 236 * U, 12.5 * U, 'rgba(255,255,255,0.85)', 'center', { weight: '700' });
    else {
      gem(SW / 2 - 40 * U, t0 + 236 * U, 7 * U);
      text('+' + r.earned, SW / 2 - 28 * U, t0 + 237 * U, 17 * U, '#ffd650', 'left');
    }
    pill('RETRY', SW / 2, t0 + 286 * U, cw - 60 * U, 52 * U, css(pal.accent), '#06202f', startGame, 24);
    pill('SHARE', SW / 2 - 76 * U, t0 + 340 * U, 132 * U, 36 * U, 'rgba(255,255,255,0.16)', '#fff', share, 15);
    pill('ROCK SHOP', SW / 2 + 76 * U, t0 + 340 * U, 132 * U, 36 * U, 'rgba(255,255,255,0.16)', '#fff', openShop, 15);
  }
  if (REC) text('STONE SKIP', SW / 2, t0 - 36 * U, 34 * U, '#fff', 'center', { stroke: 7 * U, glow: css(pal.accent) });
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, SH - 26 * U, 12 * U, 'rgba(255,255,255,0.6)', 'center', { weight: '700' });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 360;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 96, 76, i === hook.length - 1 ? '#ffd650' : '#fff', 'center', { stroke: 18 }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  const plan = rec && rec.crashAt;
  if (cap2 && plan && !r.dead && r.skips >= plan - 3) text(cap2, SW / 2, 230, 62, '#fff', 'center', { stroke: 14 });
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
  const n = run ? run.skips : 0;
  const txt = `I skipped a stone ${n} times on STONE SKIP 🪨💦 the world record is ${WR}. beat me →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: 'Stone Skip', text: txt, url });
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
  for (const s of STONES) {
    const have = owned.includes(s.id);
    const b = document.createElement('button');
    b.className = 'car' + (s.id === stoneId ? ' sel' : '') + (have ? '' : ' locked');
    const swatch = s.col === 'comet' ? 'linear-gradient(90deg,#ff6b9d,#ffd650,#6bffc8,#7fa8ff)' : s.col;
    b.innerHTML = `<i style="background:${swatch}"></i><b>${s.name}</b><span>${have ? (s.id === stoneId ? 'IN HAND' : 'SELECT') : '◆ ' + s.price}</span>`;
    b.onclick = () => {
      if (have) {
        stoneId = s.id;
        store.set('stone', stoneId);
      } else if (coins >= s.price) {
        coins -= s.price;
        owned.push(s.id);
        stoneId = s.id;
        store.set('coins', coins);
        store.set('owned', owned);
        store.set('stone', stoneId);
        sfx('best', { root: 48 });
      } else {
        toast(`Need ${s.price - coins} more ◆. Keep skipping!`);
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
  } else tap(run);
}
if (!REC) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'ArrowUp') return;
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
    return { mode, phase: r.phase, t: r.t, tc: r.fl.tc, t0: r.fl.t0, apexT: r.fl.apexT, scale: r.scale, skips: r.skips, E: r.E, streak: r.streak, perfects: r.perfects, dead: r.dead, deathBy: r.deathBy, tapped: r.tapped, freeze: r.freeze, win: winAt(r.skips), best, coins, overT };
  };
}
if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 88);
  const seed = +(Q.get('seed') || 3);
  const great = new Set((Q.get('great') || '').split(',').filter(Boolean).map(Number));
  const ok = new Set((Q.get('ok') || '').split(',').filter(Boolean).map(Number));
  rec = { t: 0, frame: 0, events: [], states: [], musicStart: 0, crashAt };
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    off: +(Q.get('off') ?? 66),
    E: 1,
    bot: true,
    plan: k => (k >= crashAt ? null : ok.has(k) ? -0.13 : great.has(k) ? -0.075 : -pr() * 0.03),
  });
  run.tutorial = false;
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
      return { t: rec.t, mode, score: run.skips, dead: run.dead, corners: run.skips, streak: run.streak };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('800 40px "Baloo 2"').then(() => (window.__recReady = true));
} else if (OG) {
  stoneId = 'pebble';
  run = newRun({ seed: 4, off: 30, E: 1, bot: true });
  run.t = 0.3;
  // a trail of ripples behind a stone in mid-air
  run.x = 0;
  run.y = 70;
  run.fl.xc = 200;
  run.fl.tc = 99;
  run.ripples = [-330, -230, -125].map((x, i) => ({ x, t: 1.3 - i * 0.45, big: i === 2 }));
  run.trail = Array.from({ length: 22 }, (_, i) => {
    const x = -125 + (i / 21) * 125;
    return { x, y: 70 * (1 - (x / 125) ** 2) };
  });
  run.coinList = [];
  pal = zonePal(2);
  palT = zonePal(2);
  cam.x = 0;
  mode = 'title';
  document.fonts.load('800 40px "Baloo 2"').finally(() => {
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
  document.fonts.load('800 40px "Baloo 2"').finally(() => requestAnimationFrame(loop));
}
