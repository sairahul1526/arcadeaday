import { Synth, Music, renderOffline, layerFor, dingNote, LAYER_AT, LAYER_NAMES, ZONE_ROOTS } from './audio.js';

const Q = new URLSearchParams(location.search);
const REC = Q.has('record');
const OG = Q.has('og'); // share-image layout (tools/og.mjs)
const QA = Q.has('qa');
const URL_PLAY = 'arcadeaday.com/dont-pop';
const FONT = '"Luckiest Guy", system-ui, sans-serif';
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
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('dpp_' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('dpp_' + k, JSON.stringify(v));
    } catch {}
  },
};

// ---------------------------------------------------------------- content
const ZONES = [
  { name: 'PLAYGROUND', top: '#3aa8f5', bot: '#c6efff', hill: '#7fd86f', hill2: '#5dbf58', ground: '#4ea64f', sun: '#fff1a0', cloud: '#ffffff', night: 0, accent: '#ff4f7b', glow: '#ffd23f' },
  { name: 'FUNFAIR', top: '#ff6fae', bot: '#ffe1c4', hill: '#b585ff', hill2: '#9567ee', ground: '#7d52d6', sun: '#fff4f9', cloud: '#fff7fb', night: 0, accent: '#ff3d7f', glow: '#ffe14d' },
  { name: 'SUNSET', top: '#5d3aa6', bot: '#ffb067', hill: '#e2627f', hill2: '#b94b70', ground: '#8f3a62', sun: '#ffe08a', cloud: '#ffd0c0', night: 0.3, accent: '#ffcf4d', glow: '#ffcf4d' },
  { name: 'STARRY NIGHT', top: '#0a1135', bot: '#34428f', hill: '#2a3976', hill2: '#1e2b5c', ground: '#16214b', sun: '#f4f1d0', cloud: '#56629f', night: 1, accent: '#7fe3ff', glow: '#ffe680' },
  { name: 'OUTER SPACE', top: '#05020f', bot: '#2b1250', hill: '#54427e', hill2: '#3d2e63', ground: '#2c2148', sun: '#c9b8ff', cloud: '#3a2a66', night: 1, accent: '#ff6bd6', glow: '#8affd1' },
];
const PAL_KEYS = ['top', 'bot', 'hill', 'hill2', 'ground', 'sun', 'cloud', 'accent', 'glow'];
const zonePal = z => {
  const Z = ZONES[z % ZONES.length];
  const p = Object.fromEntries(PAL_KEYS.map(k => [k, hexRgb(Z[k])]));
  p.night = Z.night;
  return p;
};

const SKINS = [
  { id: 'classic', name: 'CLASSIC', col: '#ff3b5c', price: 0 },
  { id: 'sky', name: 'SKY', col: '#3fa4ff', price: 60 },
  { id: 'lime', name: 'LIME', col: '#79dc45', price: 120 },
  { id: 'grape', name: 'GRAPE', col: '#9d5cff', price: 200 },
  { id: 'polka', name: 'POLKA', col: '#ff8a2e', pattern: 'dots', price: 320 },
  { id: 'melon', name: 'MELON', col: '#4fd36b', pattern: 'stripes', price: 480 },
  { id: 'disco', name: 'DISCO', col: '#b9c3d6', pattern: 'disco', price: 800 },
  { id: 'rainbow', name: 'RAINBOW', col: 'rainbow', price: 1500 },
];
const BG_COLS = ['#ff4f7b', '#ffd23f', '#3fa4ff', '#79dc45', '#9d5cff', '#ff8a2e', '#ff6bd6', '#4fe0d0'];

// ---------------------------------------------------------------- tuning
const KY = 545; // the knot sits on the nozzle here
const GROUND = 575;
const R0 = 24; // a fresh, floppy balloon
const PUMP_X = -152;
const SHAPES = [
  { asp: 1.15, lo: 80, hi: 136 }, // classic
  { asp: 1.0, lo: 84, hi: 134 }, // round
  { asp: 1.42, lo: 66, hi: 108 }, // long
];
const G_KISS = 1.5, G_PERFECT = 5, G_GREAT = 12; // gap at release, mm
const ZONE_GAP = 40; // slow-mo kicks in this close to the needle
const PER_ZONE = 10;
const lvl = L => ({
  D: 20 + Math.min(L, 30) * 0.3, // radius added per pump stroke
  T: Math.max(0.3, 0.44 - L * 0.006), // stroke period, s
  W: Math.max(14, 62 - L * 2.4), // window between the float line and the needle
  V: L < 3 ? 45 + L * 8 : 70 + Math.min(L, 40) * 3.5, // peak closing speed near the pin, mm per real second (gentle first three)
});
const bpmAt = L => Math.min(140, 108 + L * 0.8);

// ---------------------------------------------------------------- geometry
// A balloon of radius r is an ellipse (r wide, asp*r tall) sitting on the knot.
const centerY = (asp, r) => KY - asp * r;
// distance from the knot to the edge of a unit balloon, along direction (dx, dy)
const rho = (asp, dx, dy) => {
  const m = Math.hypot(dx, dy) || 1;
  dx /= m;
  dy /= m;
  return Math.max(1e-3, (-2 * dy) / asp / (dx * dx + (dy * dy) / (asp * asp)));
};
// the radius at which the balloon first touches point (x, y)
const touchR = (asp, x, y) => Math.hypot(x, y - KY) / rho(asp, x, y - KY);
function inside(asp, r, x, y) {
  const cy = centerY(asp, r);
  const u = x / r, v = (y - cy) / (asp * r);
  return u * u + v * v <= 1;
}
function ellDist(asp, r, x, y) {
  const cy = centerY(asp, r), b = asp * r;
  const d = t => Math.hypot(x - r * Math.sin(t), y - cy + b * Math.cos(t));
  let best = Infinity, bt = 0;
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * TAU, v = d(t);
    if (v < best) [best, bt] = [v, t];
  }
  let st = TAU / 36;
  for (let k = 0; k < 12; k++) {
    st *= 0.5;
    for (const t of [bt - st, bt + st]) {
      const v = d(t);
      if (v < best) [best, bt] = [v, t];
    }
  }
  return best;
}

// ---------------------------------------------------------------- state
let SW = 0, SH = 0, DPR = 1, K = 1, U = 1;
let mode = 'title';
let run = null;
let pal = zonePal(0);
let palT = zonePal(0);
let cam = { x: 0, y: 360, z: 1 };
let shake = 0;
let flash = 0;
let tReal = 0;
let audio = null;
let music = null;
let squeakN = null;
let soundOn = store.get('sound', true);
let best = store.get('best', 0);
let coins = store.get('coins', 0);
let owned = store.get('owned', ['classic']);
let skinId = store.get('skin', 'classic');
let plays = store.get('plays', 0);
let closestEver = store.get('closest', null);
let overT = 0;
let buttons = [];
let held = false;
let pressId = 0;
let rec = null; // record-mode log
let clouds = [];
let stars = [];
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
  K = Math.min(SW / 400, SH / 720);
  U = Math.min(SW / 420, SH / 640);
  const r = rng(7);
  clouds = Array.from({ length: 7 }, (_, i) => ({ x: r() * 1.4 - 0.2, y: 60 + r() * 260, s: 0.6 + r() * 0.8, sp: 4 + r() * 8, i }));
  stars = Array.from({ length: 80 }, () => ({ x: r(), y: r(), s: r() * 1.6 + 0.4, p: r() * 6 }));
}

// ---------------------------------------------------------------- runs
function newRun(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
  const r = {
    off: opts.off ?? 0,
    bot: !!opts.bot,
    attract: !!opts.attract,
    plan: opts.plan || null,
    rnd: rng(seed),
    score: 0,
    n: 0, // balloons tied
    streak: 0,
    maxStreak: 0,
    kisses: 0,
    closest: Infinity,
    zone: 0,
    layer: opts.layer ?? 0,
    coinsGot: 0,
    b: null,
    floaters: [],
    bg: [],
    pops: [],
    parts: [],
    dead: false,
    deadT: 0,
    cause: null,
    ts: 1, // world time scale (slow-mo)
    t: 0,
    usedPress: pressId,
    passedBest: false,
    banner: null,
    layerPop: null,
    scoreBump: 0,
    heartT: 0,
    tutorial: !opts.bot && plays < 2,
  };
  palT = zonePal(0);
  if (!opts.keepPal) pal = zonePal(0);
  r.b = newBalloon(r, 0.1);
  return r;
}

function newBalloon(r, delay) {
  const L = r.n + r.off;
  const P = lvl(L);
  const rnd = r.rnd;
  let shape = SHAPES[0];
  if (L >= 5 && rnd() < 0.3) shape = SHAPES[1];
  else if (L >= 9 && rnd() < 0.3) shape = SHAPES[2];
  const asp = shape.asp;
  const b = {
    asp,
    r: R0,
    P,
    gold: L >= 2 && rnd() < 0.13,
    state: 'in',
    t: -delay,
    st: 0, // stroke clock
    strokes: 0,
    growing: false,
    gap: Infinity,
    tension: 0,
    near: null,
    passedMin: false,
    x: 0,
    y: 0,
    rot: 0,
    needles: [],
  };
  const mk = (rt, phi) => {
    const cy = centerY(asp, rt);
    const tip = { x: rt * Math.sin(phi), y: cy - asp * rt * Math.cos(phi) };
    let ux = Math.sin(phi), uy = -Math.cos(phi) / asp;
    const m = Math.hypot(ux, uy);
    ux /= m;
    uy /= m;
    const len = uy < -0.05 ? clamp((tip.y - 170) / -uy, 62, 150) : 150;
    return { x0: tip.x, y0: tip.y, ux, uy, len, amp: 0, w: 0, ph: 0, x: tip.x, y: tip.y, out: 0, head: BG_COLS[(rnd() * BG_COLS.length) | 0] };
  };
  let phi;
  if (L < 3) phi = (rnd() - 0.5) * 0.3;
  else if (L < 8) phi = (rnd() * 2 - 1) * 0.9;
  else phi = (rnd() * 2 - 1) * 1.45;
  const rt = lerp(shape.lo, shape.hi, rnd());
  b.needles.push(mk(rt, phi));
  b.phi = phi;
  if (L >= 10 && rnd() < 0.6) {
    const s = phi > 0 ? -1 : 1;
    const phi2 = s * (0.35 + rnd() * 1.05);
    const rt2 = clamp(rt + (rnd() * 2 - 1) * 26, shape.lo, shape.hi + 14);
    b.needles.push(mk(rt2, phi2));
  }
  if (L >= 14) {
    for (const n of b.needles) {
      if (rnd() < 0.45) {
        n.amp = 6 + rnd() * 10;
        n.w = 1.8 + rnd() * 1.6;
        n.ph = rnd() * TAU;
      }
    }
  }
  // the float line: big enough to float, a fair window short of the closest needle position
  let rIn = Infinity;
  for (const n of b.needles) rIn = Math.min(rIn, touchR(asp, n.x0 - n.ux * n.amp, n.y0 - n.uy * n.amp));
  b.rTouch = rIn;
  // slow-mo near the pin: scale time so the gap closes at a fair, level-set speed
  let f = 1;
  for (const n of b.needles) f = Math.max(f, Math.hypot(n.x0, n.y0 - KY) / touchR(asp, n.x0, n.y0));
  const push = 0.55 * P.T;
  b.slow = clamp(P.V / (f * P.D * Math.PI / (2 * push)), 0.06, 1);
  b.rMin = Math.max(R0 + 14, rIn - P.W);
  return b;
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
      squeakN = audio.squeak();
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
  if (run && run.attract) return;
  if (audio && soundOn && audio.ctx.state === 'running') audio.play(type, audio.ctx.currentTime + 0.005, e);
}
function musicState() {
  const z = run ? run.zone : 0;
  let layer = run ? run.layer : 0;
  if (mode === 'title') layer = 3;
  return { layer, root: ZONE_ROOTS[z % ZONE_ROOTS.length], bpm: bpmAt(run ? run.n + run.off : 0) };
}
function vibrate(ms) {
  if (!REC && run && !run.bot && navigator.vibrate) try { navigator.vibrate(ms); } catch {}
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

  const b = r.b;
  // slow-mo near the needle
  const tsT = !r.dead && b.state === 'pump' && b.gap < ZONE_GAP ? lerp(b.slow, 1, clamp((b.gap - 12) / (ZONE_GAP - 12), 0, 1) ** 2) : 1;
  r.ts = lerp(r.ts, tsT, 1 - Math.exp(-(tsT < r.ts ? 30 : 6) * dt));
  if (r.dead && r.deadT < 0.35) r.ts = 0.4;
  const wdt = dt * r.ts;
  r.t += wdt;

  if (!r.dead) stepBalloon(r, b, wdt);
  else {
    r.deadT += dt;
    if (r.cause === 'fizzle') stepFizzle(b, wdt);
    if (r.attract && r.deadT > 1.8) run = newRun({ bot: true, attract: true, keepPal: true });
    else if (!r.attract && mode === 'play' && r.deadT > 1.25) gameOver(r);
  }

  for (const f of r.floaters) {
    f.t += wdt;
    for (const n of f.needles) n.out = Math.min(1, n.out + wdt / 0.24);
    if (f.t > 0.12) {
      f.vy -= 620 * wdt;
      f.y += f.vy * wdt;
      f.x += Math.sin(f.t * 3 + f.seed) * 22 * wdt;
      f.rot = Math.sin(f.t * 2.4 + f.seed) * 0.12;
    }
  }
  for (const f of r.floaters) {
    if (centerY(f.asp, f.r) + f.y + f.asp * f.r < -40 && !f.gone) {
      f.gone = true;
      if (r.bg.length < 26) r.bg.push({ x: (r.rnd() * 2 - 1) * 260, y: 760 + r.rnd() * 60, s: 0.16 + r.rnd() * 0.12, sp: 18 + r.rnd() * 18, col: hexRgb(f.gold ? '#ffcf3a' : BG_COLS[r.bg.length % BG_COLS.length]), ph: r.rnd() * TAU });
    }
  }
  r.floaters = r.floaters.filter(f => !f.gone);
  for (const o of r.bg) {
    o.y -= o.sp * dt;
    if (o.y < -60) o.y = 780;
  }

  // camera: lean in toward the needle as it gets close
  const ten = r.dead ? 0 : b.tension;
  let fx = 0, fy = 360;
  if (mode === 'title') [fx, fy] = wide() ? [-SW / K * 0.2, 360] : [0, 325];
  if (b.near && ten > 0) {
    fx = lerp(0, b.near.x, 0.3 * ten);
    fy = lerp(360, b.near.y, 0.3 * ten);
  }
  const kc = 1 - Math.exp(-4 * dt);
  cam.x = lerp(cam.x, fx, kc);
  cam.y = lerp(cam.y, fy, kc);
  cam.z = lerp(cam.z, 1 + 0.12 * ten, kc);
  shake *= Math.exp(-7 * dt);
  flash *= Math.exp(-6 * dt);
  r.scoreBump *= Math.exp(-9 * dt);

  const pk = 1 - Math.exp(-1.6 * dt);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], palT[key][i], pk);
  pal.night = lerp(pal.night, palT.night, pk);

  for (const p of r.parts) {
    p.life -= wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.vy += (p.g ?? 500) * wdt;
    p.vx *= p.drag ?? 0.985;
    p.rot = (p.rot || 0) + (p.vr || 0) * wdt;
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
    if (r.layerPop.t > 1.6) r.layerPop = null;
  }
  if (mode === 'over') overT += dt;

  // continuous audio: rubber squeak + the music holding its breath
  const alive = !r.dead && b.state === 'pump';
  const sqG = alive && b.growing ? 0.035 + 0.07 * b.tension : 0;
  const sqF = 240 + b.r * 2.4 + b.tension * 220;
  const tv = alive ? b.tension : 0;
  if (REC && rec) {
    if (rec.frame % 2 === 0) {
      rec.squeak.push([rec.t, sqG, sqF]);
      if (!r.dead) rec.tension.push([rec.t, tv]);
    }
  } else if (audio && soundOn && mode !== 'title' && !r.attract) {
    const now = audio.ctx.currentTime;
    squeakN.g.gain.setTargetAtTime(sqG, now, 0.02);
    squeakN.o.frequency.setTargetAtTime(sqF, now, 0.02);
    squeakN.f.frequency.setTargetAtTime(sqF * 3, now, 0.02);
    if (!r.dead) audio.tension(now, tv);
  } else if (audio && squeakN) squeakN.g.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.02);
  if (audio && soundOn && !REC) music.tick(musicState());
}

function needlePos(n, t) {
  const o = n.amp ? n.amp * Math.sin(n.w * t + n.ph) : 0;
  n.x = n.x0 + n.ux * o;
  n.y = n.y0 + n.uy * o;
}

function measure(b) {
  let gap = Infinity, near = null, hit = false;
  for (const n of b.needles) {
    if (inside(b.asp, b.r, n.x, n.y)) {
      hit = true;
      gap = 0;
      near = n;
      continue;
    }
    const d = ellDist(b.asp, b.r, n.x, n.y);
    if (d < gap) {
      gap = d;
      near = n;
    }
  }
  b.gap = gap;
  b.near = near;
  b.tension = b.state === 'pump' ? clamp(1 - gap / 42, 0, 1) : 0;
  return hit;
}

function stepBalloon(r, b, dt) {
  b.t += dt;
  for (const n of b.needles) needlePos(n, r.t);
  if (b.state === 'in') {
    if (b.t >= 0 && !b.snapped) {
      b.snapped = true;
      sfx('snap');
      sfx('needle');
    }
    if (b.t >= 0.42) b.state = 'ready';
  }
  let hold;
  if (r.bot) hold = botHold(r, b);
  else hold = held;

  if (b.state === 'ready') {
    if (r.bot ? hold : held && pressId > r.usedPress) {
      r.usedPress = pressId;
      b.state = 'pump';
      b.st = 0;
      b.strokes = 0;
    }
  } else if (b.state === 'pump') {
    if (!hold) return tieOff(r, b);
    // growth follows a smooth push in the first 55% of each stroke, then a short pause
    const T = b.P.T, push = 0.55 * T;
    const G = s => b.P.D * (Math.floor(s / T) + (1 - Math.cos(Math.PI * Math.min(1, (s % T) / push))) / 2);
    const k = Math.floor(b.st / T) + 1;
    if (k > b.strokes) {
      b.strokes = k;
      sfx('pump', { p: 0.8 + (b.r / 140) * 0.7, d: push });
      puff(r, b);
    }
    const dr = G(b.st + dt) - G(b.st);
    b.st += dt;
    b.growing = dr > 0;
    b.r += dr;
    if (!b.passedMin && b.r >= b.rMin) {
      b.passedMin = true;
      if (!r.attract) sfx('click');
    }
    if (b.tension > 0.5 && !r.attract) {
      r.heartT -= dt;
      if (r.heartT <= 0) {
        sfx('heart');
        r.heartT = 0.62;
      }
    }
  }
  if (measure(b)) popBalloon(r, b);
}

function puff(r, b) {
  for (let i = 0; i < 4; i++) {
    r.parts.push({ x: PUMP_X + 8 + r.rnd() * 10, y: GROUND - 6, vx: 30 + r.rnd() * 50, vy: -20 - r.rnd() * 30, g: -20, life: 0.45, max: 0.45, size: 4 + r.rnd() * 4, kind: 'puff' });
  }
}

function botHold(r, b) {
  if (b.state === 'ready') return b.t > 0.6 + (r.attract ? r.rnd() * 0.3 : 0);
  if (b.state !== 'pump') return false;
  let target = b.target;
  if (target == null) {
    if (r.plan) target = r.plan(r.n);
    else if (r.attract) {
      if (r.n >= (r.crashAt ??= 4 + ((r.rnd() * 8) | 0))) target = 'pop';
      else {
        const x = r.rnd();
        target = x < 0.25 ? 0.4 + r.rnd() * 1.4 : x < 0.7 ? 2 + r.rnd() * 6 : 8 + r.rnd() * 12;
      }
    } else target = 3;
    b.target = target;
  }
  if (target === 'pop') return true;
  if (target === 'fizzle') return b.r < b.rMin - 8;
  // let go now if the next frame would overshoot the target (or the pin)
  const next = b.prevGap != null ? b.gap - Math.max(0, b.prevGap - b.gap) : b.gap;
  b.prevGap = b.gap;
  return !(b.r >= b.rMin && (b.gap <= target || next < Math.min(target, 0.4)));
}

function tieOff(r, b) {
  b.growing = false;
  if (b.r < b.rMin) return fizzle(r, b);
  const gap = b.gap;
  let tier, pts, col;
  if (gap <= G_KISS) [tier, pts, col] = ['KISS!', 5, [255, 255, 255]];
  else if (gap <= G_PERFECT) [tier, pts, col] = ['PERFECT', 3, pal.glow.slice()];
  else if (gap <= G_GREAT) [tier, pts, col] = ['GREAT', 2, [120, 255, 170]];
  else [tier, pts, col] = ['OK', 1, [235, 240, 255]];
  const prevLayer = r.layer;
  if (gap <= G_GREAT) {
    r.streak++;
    r.maxStreak = Math.max(r.maxStreak, r.streak);
  } else {
    if (r.streak >= 4) pushPop(r, { text: 'STREAK LOST', sub: '', x: 0, y: centerY(b.asp, b.r) + 40, dur: 1.1, col: [255, 110, 120], size: 0.7 });
    r.streak = 0;
  }
  const party = r.streak >= LAYER_AT[5];
  if (party) pts *= 2;
  r.score += pts;
  r.n++;
  r.scoreBump = 1;
  if (tier === 'KISS!') r.kisses++;
  r.closest = Math.min(r.closest, gap);
  r.layer = layerFor(r.streak);
  if (r.layer > prevLayer && !r.attract) r.layerPop = { name: LAYER_NAMES[r.layer], t: 0 };
  if (REC && rec) rec.states.push({ t: rec.t, ...musicState() });

  const root = ZONE_ROOTS[r.zone % ZONE_ROOTS.length];
  sfx('tie');
  if (gap <= G_GREAT) sfx('ding', { m: dingNote(root, r.streak - 1), big: tier !== 'GREAT' });
  const n = b.near || b.needles[0];
  const mm = gap < 10 ? gap.toFixed(1) : String(Math.round(gap));
  pushPop(r, { text: tier, sub: '+' + pts + '   ' + mm + ' mm', x: clamp(n.x, -110, 110), y: Math.max(200, Math.min(n.y, centerY(b.asp, b.r) - b.asp * b.r) - 30), dur: 1.0, col, size: tier === 'KISS!' ? 1.3 : tier === 'OK' ? 0.75 : 1 });
  if (gap <= G_PERFECT) {
    const cnt = tier === 'KISS!' ? 46 : 24;
    for (let i = 0; i < cnt; i++) {
      const a = r.rnd() * TAU, sp = 120 + r.rnd() * 320;
      r.parts.push({ x: n.x, y: n.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 520, life: 1.1, max: 1.1, size: 4 + r.rnd() * 5, kind: 'confetti', col: hexRgb(BG_COLS[(r.rnd() * BG_COLS.length) | 0]), rot: r.rnd() * TAU, vr: (r.rnd() - 0.5) * 18 });
    }
    r.parts.push({ x: n.x, y: n.y, vx: 0, vy: 0, g: 0, life: 0.5, max: 0.5, size: 1, kind: 'ring', col });
    flash = tier === 'KISS!' ? 0.4 : 0.14;
    vibrate(tier === 'KISS!' ? 40 : 15);
  }
  if (b.gold) {
    r.coinsGot += 3;
    sfx('coin');
    pushPop(r, { text: '+3 ◆', sub: '', x: 0, y: KY - 40, dur: 0.9, col: [255, 214, 80], size: 0.7, keep: true });
  }
  // let it go
  r.floaters.push({ ...b, vy: -40, t: 0, seed: r.rnd() * 6, happy: true, needles: b.needles.map(n => ({ ...n, out: 0 })) });

  const z = Math.floor((r.n + (r.off ? 0 : 0)) / PER_ZONE);
  if (z !== r.zone) {
    r.zone = z;
    palT = zonePal(z);
    r.banner = { text: 'ZONE ' + (z + 1), sub: ZONES[z % ZONES.length].name, t: 0 };
    sfx('zone', { root: ZONE_ROOTS[z % ZONE_ROOTS.length] });
  }
  if (!r.bot && !r.passedBest && best > 0 && r.score > best) {
    r.passedBest = true;
    r.banner = { text: 'NEW BEST!', sub: 'keep pumping', t: 0 };
    sfx('best', { root });
    flash = 0.3;
  }
  r.b = newBalloon(r, 0.4);
}

function pushPop(r, p) {
  // one callout at a time: a new one fades the older ones (but not a combo pushed with it)
  if (!p.keep) for (const o of r.pops) if (o.t > 0.15) o.dur = Math.min(o.dur, o.t + 0.15);
  r.pops.push({ t: 0, ...p });
}

function popBalloon(r, b) {
  r.dead = true;
  r.deadT = 0;
  r.cause = 'pop';
  b.state = 'popped';
  const n = b.near || b.needles[0];
  const cy = centerY(b.asp, b.r), rb = b.asp * b.r;
  const col = skinRgb(b);
  for (let i = 0; i < 26; i++) {
    const a = r.rnd() * TAU;
    const px = Math.sin(a) * b.r, py = cy - Math.cos(a) * rb;
    const sp = 260 + r.rnd() * 420;
    r.parts.push({ x: px, y: py, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp - 100, g: 900, life: 1.4, max: 1.4, size: 10 + r.rnd() * 16, kind: 'shred', col, rot: r.rnd() * TAU, vr: (r.rnd() - 0.5) * 20, drag: 0.96 });
  }
  for (let i = 0; i < 18; i++) {
    const a = r.rnd() * TAU, sp = 200 + r.rnd() * 300;
    r.parts.push({ x: n.x, y: n.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, life: 0.35, max: 0.35, size: 3, kind: 'spark', col: [255, 255, 255], drag: 0.9 });
  }
  r.parts.push({ x: n.x, y: n.y, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45, size: 2.2, kind: 'ring', col: [255, 255, 255] });
  r.parts.push({ x: 0, y: KY, vx: 0, vy: -120, g: 900, life: 1.2, max: 1.2, size: 8, kind: 'knot', col });
  r.pops = [];
  r.boom = { x: n.x, y: n.y, t: tReal };
  shake = 1.2;
  flash = 0.55;
  sfx('pop');
  vibrate([80, 40, 120]);
}

function fizzle(r, b) {
  r.dead = true;
  r.deadT = 0;
  r.cause = 'fizzle';
  b.state = 'fizzle';
  b.t = 0;
  b.vx = (r.rnd() < 0.5 ? -1 : 1) * 240;
  b.vy = -420;
  b.r0 = b.r;
  pushPop(r, { text: 'TOO SMALL!', sub: 'fill it past the dotted line', x: 0, y: 330, dur: 1.5, col: [255, 255, 255], size: 0.9 });
  sfx('fizzle');
  vibrate([30, 30, 30, 30, 60]);
}

function stepFizzle(b, dt) {
  if (b.state !== 'fizzle') return;
  b.t += dt;
  const k = clamp(b.t / 1.25, 0, 1);
  if (k < 1) {
    const a = Math.sin(b.t * 13) * 3.2 + b.t * 5;
    b.vx += Math.cos(a) * 2600 * dt;
    b.vy += Math.sin(a) * 2600 * dt - 300 * dt;
    b.vx *= Math.exp(-3 * dt);
    b.vy *= Math.exp(-3 * dt);
    b.rot = Math.atan2(b.vy, b.vx) + Math.PI / 2;
  } else {
    b.vy += 900 * dt;
    b.vx *= Math.exp(-2 * dt);
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.x = clamp(b.x, -180, 180);
  const top = centerY(b.asp, b.r) + b.y;
  if (top < 140) {
    b.y += 140 - top;
    b.vy = Math.abs(b.vy) * 0.5;
  }
  if (centerY(b.asp, b.r) + b.y > GROUND - b.r * b.asp * 0.6) {
    b.y = GROUND - b.r * b.asp * 0.6 - centerY(b.asp, b.r);
    b.vy = -Math.abs(b.vy) * 0.25;
  }
  b.r = Math.max(b.r0 * 0.32, b.r0 * (1 - 0.68 * k));
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
  if (r.closest < Infinity && (closestEver == null || r.closest < closestEver)) {
    closestEver = r.closest;
    store.set('closest', closestEver);
  }
}

// ---------------------------------------------------------------- render
let shakeX = 0, shakeY = 0;
const X = x => SW / 2 + (x - cam.x) * K * cam.z + shakeX;
const Y = y => SH / 2 + (y - cam.y) * K * cam.z + shakeY;
const Sz = v => v * K * cam.z;

function poly(pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
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

function render() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  shakeX = (Math.random() - 0.5) * shake * 22 * U;
  shakeY = (Math.random() - 0.5) * shake * 22 * U;
  drawSky();
  if (!run) return;
  const r = run;
  drawGround();
  drawPump(r);
  const b = r.b;
  // the next pins slide in behind the balloon that's floating away
  if (!r.dead || r.cause === 'fizzle') drawNeedles(b.needles, b);
  for (const f of r.floaters) drawNeedles(f.needles, f);
  for (const f of r.floaters) drawBalloon(f, { happy: true });
  if (!r.dead || r.cause === 'fizzle') {
    if (b.state !== 'fizzle') drawFloatLine(r, b);
    if (b.state !== 'in' || b.t >= 0) drawBalloon(b, {});
    if (!r.dead) drawGapReadout(r, b);
  } else {
    drawNeedles(b.needles, b);
  }
  drawParts(r);
  if (r.dead && r.cause === 'pop') drawBoom(r);
  drawPops(r);
  if (flash > 0.01) {
    g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, SW, SH);
  }
  buttons = [];
  if (mode === 'title') drawTitle();
  else {
    if (!(REC && (mode === 'over' || hookOn() || cap2On(r)))) drawHUD(r);
    if (mode === 'over') drawOver(r);
  }
  if (REC) drawCaptions(r);
}

function drawSky() {
  const gr = g.createLinearGradient(0, 0, 0, SH);
  gr.addColorStop(0, css(pal.top));
  gr.addColorStop(1, css(pal.bot));
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  // stars at night
  if (pal.night > 0.05) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(tReal * 2 + s.p);
      g.fillStyle = `rgba(255,255,255,${(0.2 + tw * 0.6) * pal.night * (1 - s.y * 0.7)})`;
      g.fillRect(s.x * SW, s.y * SH * 0.75, s.s * U, s.s * U);
    }
  }
  // sun / moon, breathing with the beat
  const lf = run ? 0.3 + run.layer / 7 : 0.6;
  const sx = X(120) * 0.6 + SW * 0.4 * 0.75, sy = Y(150);
  const sr = Sz(46) * (1 + pulse * 0.03 * lf);
  const halo = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 3);
  halo.addColorStop(0, css(pal.sun, 0.45 + pulse * 0.15 * lf));
  halo.addColorStop(1, css(pal.sun, 0));
  g.fillStyle = halo;
  g.fillRect(sx - sr * 3, sy - sr * 3, sr * 6, sr * 6);
  g.fillStyle = css(pal.sun);
  g.beginPath();
  g.arc(sx, sy, sr, 0, TAU);
  g.fill();
  if (pal.night > 0.5) {
    g.fillStyle = css(mix(pal.top, pal.bot, 0.2), clamp((pal.night - 0.5) * 2, 0, 1));
    g.beginPath();
    g.arc(sx + sr * 0.42, sy - sr * 0.22, sr * 0.86, 0, TAU);
    g.fill();
  }
  // background balloons: one for every balloon you've saved this run
  if (run) {
    for (const o of run.bg) {
      const x = X(o.x * 0.7 + Math.sin(tReal * 0.8 + o.ph) * 10), y = Y(o.y);
      const s = Sz(o.s * 60);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = Math.max(1, Sz(1.2));
      g.beginPath();
      g.moveTo(x, y + s * 1.15);
      g.quadraticCurveTo(x + s * 0.3, y + s * 1.8, x, y + s * 2.5);
      g.stroke();
      g.fillStyle = css(mix(o.col, pal.bot, 0.35));
      g.beginPath();
      g.ellipse(x, y, s, s * 1.15, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(x - s * 0.35, y - s * 0.45, s * 0.22, s * 0.35, -0.5, 0, TAU);
      g.fill();
    }
  }
  // clouds
  for (const c of clouds) {
    const w = SW + 400 * U;
    const x = ((c.x * w + tReal * c.sp * U) % w + w) % w - 200 * U;
    const y = Y(c.y);
    const s = Sz(30 * c.s);
    g.fillStyle = css(pal.cloud, 0.85 - pal.night * 0.45);
    g.beginPath();
    g.ellipse(x, y, s * 2.2, s * 0.8, 0, 0, TAU);
    g.ellipse(x - s * 0.9, y - s * 0.3, s * 0.9, s * 0.8, 0, 0, TAU);
    g.ellipse(x + s * 0.5, y - s * 0.55, s * 1.1, s * 1.0, 0, 0, TAU);
    g.fill();
  }
}

function drawGround() {
  // far hills
  const yh = Y(GROUND - 40);
  g.fillStyle = css(pal.hill2);
  g.beginPath();
  g.moveTo(0, SH);
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * SW;
    g.lineTo(x, yh + Math.sin(i * 0.9 + 1) * Sz(16) - Math.sin(i * 0.37) * Sz(22));
  }
  g.lineTo(SW, SH);
  g.fill();
  g.fillStyle = css(pal.hill);
  g.beginPath();
  g.moveTo(0, SH);
  const yg = Y(GROUND);
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * SW;
    g.lineTo(x, yg + Math.sin(i * 0.7) * Sz(5));
  }
  g.lineTo(SW, SH);
  g.fill();
  const gr = g.createLinearGradient(0, yg, 0, SH);
  gr.addColorStop(0, css(pal.ground, 0));
  gr.addColorStop(1, css(shade(pal.ground, 0.7)));
  g.fillStyle = gr;
  g.fillRect(0, yg, SW, SH - yg);
}

function drawPump(r) {
  const b = r.b;
  const T = b.P.T;
  let push = 0;
  if (b.state === 'pump' && !r.dead) {
    const ph = (b.st % T) / T;
    push = ph < 0.55 ? Math.sin((ph / 0.55) * Math.PI * 0.5) : 1 - (ph - 0.55) / 0.45;
  }
  const L = 1.2;
  // hose from the pump to the nozzle
  g.strokeStyle = '#2d2d3a';
  g.lineWidth = Sz(6);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(X(PUMP_X + 10), Y(GROUND - 8));
  g.bezierCurveTo(X(PUMP_X + 60), Y(GROUND + 12), X(-60), Y(GROUND + 14), X(-10), Y(GROUND - 6));
  g.stroke();
  g.lineCap = 'butt';
  // foot plate
  g.fillStyle = '#3a3a4a';
  roundRect(X(PUMP_X - 26), Y(GROUND - 6), Sz(52), Sz(10), Sz(4));
  g.fill();
  // barrel
  const bt = GROUND - 100;
  const bgd = g.createLinearGradient(X(PUMP_X - 12), 0, X(PUMP_X + 12), 0);
  bgd.addColorStop(0, '#d8344f');
  bgd.addColorStop(0.45, '#ff6b81');
  bgd.addColorStop(1, '#a8203a');
  g.fillStyle = bgd;
  roundRect(X(PUMP_X - 12), Y(bt), Sz(24), Sz(96), Sz(6));
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `${Sz(9)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(X(PUMP_X), Y(bt + 50));
  g.rotate(-Math.PI / 2);
  g.fillText('PUMP', 0, Sz(1));
  g.restore();
  // rod + handle
  const hy = bt - 46 + push * 36 * L;
  g.fillStyle = '#c9ced8';
  g.fillRect(X(PUMP_X - 2.5), Y(hy), Sz(5), Y(bt) - Y(hy));
  g.fillStyle = '#2d2d3a';
  roundRect(X(PUMP_X - 24), Y(hy - 6), Sz(48), Sz(12), Sz(6));
  g.fill();
  // nozzle stand
  g.fillStyle = '#3a3a4a';
  poly([[X(-15), Y(GROUND)], [X(-5), Y(KY + 8)], [X(5), Y(KY + 8)], [X(15), Y(GROUND)]]);
  g.fill();
  g.fillStyle = '#5a5a6e';
  g.fillRect(X(-4), Y(KY + 2), Sz(8), Sz(8));
}

function drawFloatLine(r, b) {
  if (b.state !== 'ready' && b.state !== 'pump') return;
  const k = clamp((b.t - 0.1) / 0.3, 0, 1);
  if (k <= 0) return;
  const rr = b.rMin, cy = centerY(b.asp, rr);
  const ok = b.r >= b.rMin;
  g.save();
  g.globalAlpha = k * (ok ? 0.35 : 0.85);
  g.setLineDash([Sz(7), Sz(7)]);
  g.lineDashOffset = -tReal * Sz(20);
  g.strokeStyle = ok ? 'rgba(140,255,170,1)' : '#ffffff';
  g.lineWidth = Sz(3);
  g.beginPath();
  g.ellipse(X(0), Y(cy), Sz(rr), Sz(rr * b.asp), 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  g.restore();
}

function drawNeedles(needles, b) {
  for (const n of needles) {
    let off = 0;
    if (b.state === 'in') off = (1 - ease((b.t + 0.05) / 0.4)) * 320;
    off += ease(n.out || 0) * 340;
    const tx = n.x + n.ux * off, ty = n.y + n.uy * off;
    const hx = tx + n.ux * n.len, hy = ty + n.uy * n.len;
    const near = b === run.b && b.near === n && !run.dead ? b.tension : 0;
    // shadow
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = Sz(4);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(X(tx + 3), Y(ty + 5));
    g.lineTo(X(hx + 3), Y(hy + 5));
    g.stroke();
    // shaft, tapering to the point
    const px = -n.uy, py = n.ux;
    const w0 = 0.4, w1 = 2.2;
    const sg = g.createLinearGradient(X(tx + px * 3), Y(ty + py * 3), X(tx - px * 3), Y(ty - py * 3));
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.5, '#b8c0cc');
    sg.addColorStop(1, '#6b7380');
    g.fillStyle = sg;
    poly([
      [X(tx + px * w0), Y(ty + py * w0)],
      [X(tx + n.ux * 14 + px * w1), Y(ty + n.uy * 14 + py * w1)],
      [X(hx + px * w1), Y(hy + py * w1)],
      [X(hx - px * w1), Y(hy - py * w1)],
      [X(tx + n.ux * 14 - px * w1), Y(ty + n.uy * 14 - py * w1)],
      [X(tx - px * w0), Y(ty - py * w0)],
    ]);
    g.fill();
    g.lineCap = 'butt';
    // pin head
    const hr = Sz(11);
    const hg = g.createRadialGradient(X(hx) - hr * 0.35, Y(hy) - hr * 0.35, hr * 0.1, X(hx), Y(hy), hr);
    const hc = hexRgb(n.head);
    hg.addColorStop(0, css(mix(hc, [255, 255, 255], 0.6)));
    hg.addColorStop(1, css(shade(hc, 0.8)));
    g.fillStyle = hg;
    g.beginPath();
    g.arc(X(hx), Y(hy), hr, 0, TAU);
    g.fill();
    // the tip glints red as the balloon gets close
    if (near > 0.05) {
      const gl = Sz(6 + near * 14) * (0.8 + 0.2 * Math.sin(tReal * 30));
      const tg = g.createRadialGradient(X(tx), Y(ty), 0, X(tx), Y(ty), gl);
      tg.addColorStop(0, `rgba(255,80,80,${0.8 * near})`);
      tg.addColorStop(1, 'rgba(255,80,80,0)');
      g.fillStyle = tg;
      g.fillRect(X(tx) - gl, Y(ty) - gl, gl * 2, gl * 2);
    }
  }
}

function skinOf() {
  return SKINS.find(s => s.id === skinId) || SKINS[0];
}
function skinRgb(b) {
  if (b.gold) return [255, 200, 40];
  const s = run && run.bot && !REC && !OG ? SKINS[0] : skinOf();
  if (s.col === 'rainbow') return hslRgb((tReal * 90) % 360, 0.85, 0.58);
  return hexRgb(s.col);
}
function hslRgb(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function drawBalloon(b, o) {
  let rr = b.r;
  if (b.state === 'in') rr = R0 * back(b.t / 0.28);
  if (rr <= 0.5) return;
  const asp = b.asp, rb = rr * asp;
  const cx = b.x, cy = centerY(asp, rr) + b.y;
  const col = skinRgb(b);
  const skin = b.gold || (run && run.bot && !REC && !OG) ? null : skinOf();
  const pat = skin && skin.pattern;
  g.save();
  // rotate around the knot (or the centre while fizzling)
  const pivX = X(cx), pivY = Y(b.state === 'fizzle' ? cy : KY + b.y);
  g.translate(pivX, pivY);
  g.rotate(b.rot || 0);
  g.translate(-pivX, -pivY);
  const ex = X(cx), ey = Y(cy), ea = Sz(rr), eb = Sz(rb);
  // string on floaters
  if (o.happy) {
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = Sz(1.5);
    g.beginPath();
    g.moveTo(ex, ey + eb + Sz(8));
    g.bezierCurveTo(ex + Sz(12), ey + eb + Sz(40), ex - Sz(12), ey + eb + Sz(70), ex + Sz(4), ey + eb + Sz(100));
    g.stroke();
  }
  // knot
  g.fillStyle = css(shade(col, 0.75));
  poly([[ex, ey + eb - Sz(2)], [ex + Sz(7), ey + eb + Sz(9)], [ex - Sz(7), ey + eb + Sz(9)]]);
  g.fill();
  // body
  const stretch = clamp((rr - 40) / 110, 0, 1); // big balloons go thin and glossy
  const bg = g.createRadialGradient(ex - ea * 0.35, ey - eb * 0.4, ea * 0.05, ex, ey, Math.max(ea, eb) * 1.05);
  bg.addColorStop(0, css(mix(col, [255, 255, 255], 0.35 + stretch * 0.15)));
  bg.addColorStop(0.55, css(col));
  bg.addColorStop(1, css(shade(col, 0.62)));
  g.fillStyle = bg;
  g.beginPath();
  g.ellipse(ex, ey, ea, eb, 0, 0, TAU);
  g.fill();
  if (pat || skin?.col === 'rainbow') {
    g.save();
    g.beginPath();
    g.ellipse(ex, ey, ea, eb, 0, 0, TAU);
    g.clip();
    if (pat === 'dots') {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      const s = ea * 0.42;
      for (let i = -3; i <= 3; i++)
        for (let j = -4; j <= 4; j++) {
          const x = ex + i * s + (j % 2 ? s / 2 : 0), y = ey + j * s * 0.85;
          g.beginPath();
          g.arc(x, y, s * 0.16, 0, TAU);
          g.fill();
        }
    } else if (pat === 'stripes') {
      g.strokeStyle = 'rgba(20,90,40,0.55)';
      g.lineWidth = ea * 0.12;
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.ellipse(ex, ey, Math.abs(i) * ea * 0.3 + 0.01, eb, 0, 0, TAU);
        g.stroke();
      }
    } else if (pat === 'disco') {
      const s = ea * 0.2;
      for (let i = -6; i <= 6; i++)
        for (let j = -7; j <= 7; j++) {
          const v = 0.5 + 0.5 * Math.sin(i * 1.7 + j * 2.3 + tReal * 4);
          g.fillStyle = `rgba(255,255,255,${0.1 + v * 0.45})`;
          g.fillRect(ex + i * s + 1, ey + j * s + 1, s - 2, s - 2);
        }
    } else if (skin?.col === 'rainbow') {
      const rg = g.createLinearGradient(ex - ea, ey - eb, ex + ea, ey + eb);
      ['#ff3b5c', '#ffb02e', '#ffe53b', '#4fd36b', '#3fa4ff', '#9d5cff'].forEach((c, i) => rg.addColorStop(i / 5, c));
      g.globalAlpha = 0.85;
      g.fillStyle = rg;
      g.fillRect(ex - ea, ey - eb, ea * 2, eb * 2);
      g.globalAlpha = 1;
    }
    // re-shade over the pattern
    const sh = g.createRadialGradient(ex - ea * 0.35, ey - eb * 0.4, ea * 0.2, ex, ey, Math.max(ea, eb) * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.15)');
    sh.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = sh;
    g.fillRect(ex - ea, ey - eb, ea * 2, eb * 2);
    g.restore();
  }
  // glossy highlights
  g.fillStyle = `rgba(255,255,255,${0.45 + stretch * 0.25})`;
  g.beginPath();
  g.ellipse(ex - ea * 0.42, ey - eb * 0.42, ea * 0.13, eb * 0.24, -0.55, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(ex - ea * 0.28, ey - eb * 0.7, ea * 0.05, 0, TAU);
  g.fill();
  g.strokeStyle = css(shade(col, 0.5), 0.6);
  g.lineWidth = Sz(1.6);
  g.beginPath();
  g.ellipse(ex, ey, ea, eb, 0, 0, TAU);
  g.stroke();
  drawFace(b, ex, ey, ea, eb, o);
  g.restore();
}

function drawFace(b, ex, ey, ea, eb, o) {
  const f = o.happy ? 0 : b.tension;
  const dead = b.state === 'fizzle';
  const s = Math.min(ea, eb / b.asp);
  const fy = ey + eb * 0.05;
  const es = s * 0.13 * (1 + f * 0.35);
  // look toward the needle
  let lx = 0, ly = -0.3;
  if (b.near && !o.happy) {
    const dx = X(b.near.x) - ex, dy = Y(b.near.y) - fy;
    const m = Math.hypot(dx, dy) || 1;
    lx = dx / m;
    ly = dy / m;
  }
  const ink = 'rgba(30,20,40,0.92)';
  g.lineCap = 'round';
  for (const sd of [-1, 1]) {
    const x = ex + sd * s * 0.3, y = fy - s * 0.05;
    if (o.happy || b.state === 'ready' || b.state === 'in') {
      // ^ ^ happy eyes
      g.strokeStyle = ink;
      g.lineWidth = Math.max(1.5, s * 0.05);
      g.beginPath();
      g.arc(x, y + es * 0.4, es * 0.75, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    } else if (dead) {
      g.strokeStyle = ink;
      g.lineWidth = Math.max(1.5, s * 0.045);
      g.beginPath();
      g.moveTo(x - es * 0.7, y - es * 0.7);
      g.lineTo(x + es * 0.7, y + es * 0.7);
      g.moveTo(x + es * 0.7, y - es * 0.7);
      g.lineTo(x - es * 0.7, y + es * 0.7);
      g.stroke();
    } else {
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(x, y, es, es * 1.12, 0, 0, TAU);
      g.fill();
      const pr = es * (0.55 - f * 0.25);
      const jit = f > 0.7 ? (Math.random() - 0.5) * es * 0.12 : 0;
      g.fillStyle = ink;
      g.beginPath();
      g.arc(x + lx * es * 0.4 + jit, y + ly * es * 0.4, pr, 0, TAU);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x + lx * es * 0.4 - pr * 0.3, y + ly * es * 0.4 - pr * 0.35, pr * 0.3, 0, TAU);
      g.fill();
      if (f > 0.3) {
        // worried brows
        g.strokeStyle = ink;
        g.lineWidth = Math.max(1.5, s * 0.04);
        g.beginPath();
        g.moveTo(x - sd * es * 0.9, y - es * (1.35 + 0.5 * f));
        g.lineTo(x + sd * es * 0.7, y - es * 1.3);
        g.stroke();
      }
    }
  }
  // mouth
  const my = fy + s * 0.3;
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1.5, s * 0.045);
  if (o.happy || b.state === 'ready' || b.state === 'in') {
    g.beginPath();
    g.arc(ex, my - s * 0.08, s * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    if (o.happy) {
      g.fillStyle = 'rgba(255,120,150,0.45)';
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.ellipse(ex + sd * s * 0.48, fy + s * 0.12, s * 0.09, s * 0.055, 0, 0, TAU);
        g.fill();
      }
    }
  } else if (dead) {
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(ex, my, s * 0.08, s * 0.1, 0, 0, TAU);
    g.fill();
  } else if (f < 0.35) {
    g.beginPath();
    g.arc(ex, my - s * 0.12, s * 0.12, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  } else if (f < 0.7) {
    g.beginPath();
    const w = s * 0.14;
    for (let i = 0; i <= 8; i++) {
      const x = ex - w + (i / 8) * w * 2, y = my + Math.sin(i * 1.6 + tReal * 20) * s * 0.018;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  } else {
    // screaming
    const w = s * 0.11 * (1 + 0.1 * Math.sin(tReal * 40)), h = s * 0.15 * f;
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(ex, my + h * 0.3, w, h, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#ff6b8a';
    g.beginPath();
    g.ellipse(ex, my + h * 0.75, w * 0.6, h * 0.35, 0, 0, TAU);
    g.fill();
  }
  // sweat drop
  if (!o.happy && !dead && f > 0.45) {
    const k = (tReal * 1.4) % 1;
    const x = ex + s * 0.55, y = fy - s * 0.35 + k * s * 0.3;
    g.globalAlpha = 1 - k * 0.6;
    g.fillStyle = '#bfe9ff';
    g.beginPath();
    g.moveTo(x, y - s * 0.09);
    g.quadraticCurveTo(x + s * 0.06, y, x, y + s * 0.04);
    g.quadraticCurveTo(x - s * 0.06, y, x, y - s * 0.09);
    g.fill();
    g.globalAlpha = 1;
  }
  g.lineCap = 'butt';
}

function drawGapReadout(r, b) {
  if (b.state !== 'pump' || !b.near || b.gap > 45 || mode === 'title') return;
  const n = b.near;
  const k = clamp(1 - b.gap / 45, 0, 1);
  const x = clamp(X(n.x + n.ux * 26), 70 * U, SW - 70 * U);
  const y = Y(n.y + n.uy * 26) - 26 * U;
  const v = b.gap < 10 ? b.gap.toFixed(1) : String(Math.round(b.gap));
  const col = css(mix([255, 255, 255], [255, 70, 90], k));
  text(v + ' mm', x, y, (16 + k * 12) * U, col, 'center', { stroke: 5 * U });
}

function drawParts(r) {
  for (const p of r.parts) {
    const x = X(p.x), y = Y(p.y);
    const k = p.life / p.max;
    if (p.kind === 'puff') {
      g.fillStyle = `rgba(255,255,255,${0.5 * k})`;
      g.beginPath();
      g.arc(x, y, Sz(p.size * (1.6 - k)), 0, TAU);
      g.fill();
    } else if (p.kind === 'ring') {
      g.strokeStyle = css(p.col, k);
      g.lineWidth = Sz(5) * k;
      g.beginPath();
      g.arc(x, y, Sz((1 - k) * 110 * p.size + 8), 0, TAU);
      g.stroke();
    } else if (p.kind === 'shred') {
      g.save();
      g.translate(x, y);
      g.rotate(p.rot);
      g.globalAlpha = Math.min(1, k * 2);
      g.fillStyle = css(p.col);
      const s = Sz(p.size);
      g.beginPath();
      g.moveTo(-s, -s * 0.2);
      g.quadraticCurveTo(0, -s * 0.8, s, -s * 0.1);
      g.lineTo(s * 0.7, s * 0.35);
      g.quadraticCurveTo(0, -s * 0.2, -s * 0.8, s * 0.3);
      g.closePath();
      g.fill();
      g.restore();
      g.globalAlpha = 1;
    } else if (p.kind === 'knot') {
      g.fillStyle = css(shade(p.col, 0.75));
      const s = Sz(p.size);
      poly([[x, y - s], [x + s * 0.8, y + s * 0.6], [x - s * 0.8, y + s * 0.6]]);
      g.fill();
    } else if (p.kind === 'confetti') {
      g.save();
      g.translate(x, y);
      g.rotate(p.rot);
      g.globalAlpha = Math.min(1, k * 2);
      g.fillStyle = css(p.col);
      const s = Sz(p.size);
      g.fillRect(-s / 2, -s * 0.3 * Math.abs(Math.cos(p.rot * 2)), s, s * 0.6 * Math.abs(Math.cos(p.rot * 2)) + 1);
      g.restore();
      g.globalAlpha = 1;
    } else {
      g.fillStyle = css(p.col, Math.min(1, k * 1.5));
      const s = Sz(p.size);
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

// the comic POP! burst
function drawBoom(r) {
  const bm = r.boom;
  if (!bm) return;
  const t = r.deadT;
  if (t > 1.2) return;
  const x = clamp(X(bm.x), 120 * U, SW - 120 * U), y = clamp(Y(bm.y), 160 * U, SH - 200 * U);
  const sc = back(t / 0.18) * U;
  const a = t > 0.9 ? 1 - (t - 0.9) / 0.3 : 1;
  g.globalAlpha = a;
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const rr = (i % 2 ? 58 : 100) * sc * (1 + 0.06 * Math.sin(i * 3.1));
    const an = (i / 24) * TAU;
    pts.push([Math.cos(an) * rr * 1.25, Math.sin(an) * rr]);
  }
  poly(pts);
  g.fillStyle = '#ffe14d';
  g.fill();
  g.lineWidth = 6 * U;
  g.strokeStyle = '#1d1030';
  g.stroke();
  text('POP!', 0, 4 * sc, 64 * sc, '#ff3b5c', 'center', { stroke: 10 * U, strokeColor: '#1d1030' });
  g.restore();
  g.globalAlpha = 1;
}

function text(str, x, y, size, color, align = 'center', opts = {}) {
  g.font = `${opts.weight || ''} ${size}px ${opts.font || FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  const yy = opts.font ? y : y + size * 0.08; // Luckiest Guy sits a touch high
  if (opts.stroke) {
    g.lineWidth = opts.stroke;
    g.strokeStyle = opts.strokeColor || 'rgba(25,12,40,0.9)';
    g.lineJoin = 'round';
    g.strokeText(str, x, yy);
  }
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = opts.blur ?? 18 * U;
  }
  g.fillStyle = color;
  g.fillText(str, x, yy);
  g.shadowBlur = 0;
}

function drawPops(r) {
  for (const p of r.pops) {
    const x = clamp(X(p.x), 120 * U, SW - 120 * U);
    const k = p.t / p.dur;
    const sc = back(p.t / 0.22) * p.size;
    const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const yy = clamp(Y(p.y) - ease(k) * 40 * U, (REC ? 470 : 150) + 30 * U, SH - 120 * U);
    g.globalAlpha = a;
    text(p.text, x, yy, 40 * U * sc, css(p.col), 'center', { stroke: 8 * U, glow: css(p.col, 0.6) });
    if (p.sub) text(p.sub, x, yy + 36 * U * sc, 19 * U * Math.min(1, sc), '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
}

function drawHUD(r) {
  const top = (REC ? 200 : 0) + Math.max(24 * U, 18);
  const bump = 1 + r.scoreBump * 0.25;
  text(String(r.score), SW / 2, top + 32 * U, 60 * U * bump, '#fff', 'center', { stroke: 9 * U });
  if (r.streak >= 2) {
    const party = r.streak >= LAYER_AT[5];
    text((party ? 'PARTY x2  ' : 'STREAK  ') + 'x' + r.streak, SW / 2, top + 74 * U, 18 * U, css(party ? [255, 255, 255] : pal.glow), 'center', { stroke: 5 * U });
  }
  if (r.layerPop) {
    const k = r.layerPop.t / 1.6;
    g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const sc = back(r.layerPop.t / 0.25);
    text(r.layerPop.name === 'PARTY' ? 'PARTY MODE! x2' : '+ ' + r.layerPop.name, SW / 2, top + 100 * U, 17 * U * sc, '#fff', 'center', { stroke: 5 * U });
    g.globalAlpha = 1;
  }
  if (!REC) {
    drawGem(26 * U, top + 8 * U, 8 * U);
    text(String(coins + r.coinsGot), 40 * U, top + 9 * U, 17 * U, '#ffd650', 'left', { stroke: 5 * U });
    soundButton(SW - 28 * U, top + 8 * U);
  }
  if (r.banner) {
    const b = r.banner;
    const k = b.t / 2.2;
    const a = k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    g.globalAlpha = a;
    const y = REC ? 560 : top + 150 * U;
    g.fillStyle = 'rgba(20,10,40,0.4)';
    g.fillRect(0, y - 38 * U, SW, 76 * U);
    text(b.text, SW / 2, y - 8 * U, 34 * U * back(b.t / 0.3), '#fff', 'center', { stroke: 7 * U });
    text(b.sub, SW / 2, y + 23 * U, 14 * U, css(pal.glow), 'center', { font: 'system-ui, sans-serif', weight: '800' });
    g.globalAlpha = 1;
  }
  // tutorial prompts
  const b = r.b;
  if (r.tutorial && !r.dead && r.n < 3) {
    const y = Y(GROUND) + 42 * U;
    const p = 0.5 + 0.5 * Math.sin(tReal * 6);
    if (b.state === 'ready') text(r.n === 0 ? 'HOLD to pump' : 'HOLD again', SW / 2, y, (26 + p * 3) * U, '#fff', 'center', { stroke: 7 * U });
    else if (b.state === 'pump') {
      if (b.r < b.rMin) text('keep pumping… past the dotted line', SW / 2, y, 17 * U, '#fff', 'center', { stroke: 5 * U });
      else text('LET GO before it hits the pin!', SW / 2, y, (21 + p * 2) * U, css(pal.glow), 'center', { stroke: 6 * U });
    }
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
  g.fillStyle = 'rgba(20,10,40,0.35)';
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
  g.fillStyle = 'rgba(20,10,40,0.3)';
  roundRect(x - w / 2, y - h / 2 + 5 * U, w, h, h / 2);
  g.fill();
  g.fillStyle = bg;
  roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  text(label, x, y + 1, size * U, fg);
  if (act) buttons.push({ x: x - w / 2, y: y - h / 2, w, h, act });
}

function drawTitleWords(x, y, s, wob) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.05 + wob);
  text("DON'T", 0, -36 * s, 52 * s, '#fff', 'center', { stroke: 10 * s });
  text('POP!', 0, 26 * s, 84 * s, '#ff3b5c', 'center', { stroke: 12 * s, strokeColor: '#1d1030' });
  g.restore();
}

const wide = () => SW / K > 560; // landscape: title on the left, scene on the right

function drawTitle() {
  const wd = wide();
  const cx = wd ? SW * 0.28 : SW / 2;
  const y = wd ? SH * 0.3 : Math.max(SH * 0.12, 80 * U);
  drawTitleWords(cx, y, U * (wd ? 1.3 : 1.1), Math.sin(tReal * 2.2) * 0.02);
  text('pump it as close to the pin as you dare', cx, y + (wd ? 96 : 80) * U, 14 * U, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
  const p = 0.5 + 0.5 * Math.sin(tReal * 5);
  const yb = wd ? SH * 0.6 : Math.min(SH - 120 * U, Y(GROUND) + 50 * U);
  text('TAP TO PLAY', cx, yb, (28 + p * 3) * U, '#fff', 'center', { stroke: 7 * U });
  if (best > 0) text('BEST ' + best + (closestEver != null ? '  ·  CLOSEST ' + closestEver.toFixed(1) + ' mm' : ''), cx, yb + 34 * U, 14 * U, css(pal.glow), 'center', { stroke: 4 * U });
  pill('BALLOONS', cx, yb + 74 * U, 150 * U, 38 * U, 'rgba(20,10,40,0.35)', '#fff', openShop, 16);
  drawGem(26 * U, 34 * U, 8 * U);
  text(String(coins), 40 * U, 35 * U, 17 * U, '#ffd650', 'left', { stroke: 5 * U });
  soundButton(SW - 28 * U, 34 * U);
}

function drawOver(r) {
  const k = ease(overT / 0.35);
  g.fillStyle = `rgba(20,8,35,${0.5 * k})`;
  g.fillRect(0, 0, SW, SH);
  const cy = SH * 0.46 + (1 - k) * 60 * U;
  g.globalAlpha = k;
  const cw = Math.min(SW - 32 * U, 340 * U), ch = (REC ? 290 : 330) * U;
  g.fillStyle = 'rgba(255,255,255,0.97)';
  roundRect(SW / 2 - cw / 2, cy - ch / 2, cw, ch, 24 * U);
  g.fill();
  g.strokeStyle = '#1d1030';
  g.lineWidth = 4 * U;
  g.stroke();
  const t0 = cy - ch / 2;
  const ink = '#1d1030';
  if (r.isBest && !REC) text('NEW BEST!', SW / 2, t0 + 42 * U, 34 * U * back(overT / 0.4), '#ff3b5c', 'center', { stroke: 6 * U, strokeColor: '#ffe14d' });
  else text(r.cause === 'fizzle' ? 'TOO SMALL!' : 'POPPED!', SW / 2, t0 + 42 * U, 34 * U, '#ff3b5c');
  text(String(r.score), SW / 2, t0 + 106 * U, 76 * U, ink);
  let sub;
  if (REC) sub = r.closest < Infinity ? 'closest shave: ' + r.closest.toFixed(1) + ' mm' : 'can you beat ' + r.score + '?';
  else if (r.n === 0) sub = r.cause === 'fizzle' ? 'pump past the dotted line, then let go' : 'let go BEFORE it touches the pin';
  else if (r.isBest) sub = r.prevBest > 0 ? 'previous best ' + r.prevBest : 'now beat it.';
  else if (r.prevBest - r.score <= 5) sub = 'just ' + (r.prevBest - r.score + 1) + ' more to beat your best!';
  else sub = 'best ' + r.prevBest + '  ·  closest ' + (r.closest < Infinity ? r.closest.toFixed(1) + ' mm' : '–');
  text(sub, SW / 2, t0 + 156 * U, 15 * U, '#7a4fd6', 'center', { font: 'system-ui, sans-serif', weight: '800' });
  if (REC) {
    text("DON'T POP!", SW / 2, t0 - 40 * U, 40 * U, '#fff', 'center', { stroke: 9 * U });
    text('play free, no download →', SW / 2, t0 + 205 * U, 17 * U, ink, 'center', { font: 'system-ui, sans-serif', weight: '700' });
    text(Q.get('cta') || URL_PLAY, SW / 2, t0 + 240 * U, 17 * U, '#ff3b5c', 'center', { font: 'system-ui, sans-serif', weight: '900' });
  } else {
    drawGem(SW / 2 - 40 * U, t0 + 188 * U, 7 * U);
    text('+' + r.earned, SW / 2 - 28 * U, t0 + 189 * U, 17 * U, '#e0a800', 'left');
    pill('RETRY', SW / 2, t0 + 242 * U, cw - 60 * U, 54 * U, '#ff3b5c', '#fff', startGame, 26);
    pill('SHARE', SW / 2 - 75 * U, t0 + 298 * U, 130 * U, 36 * U, '#efe8ff', ink, share, 15);
    pill('BALLOONS', SW / 2 + 75 * U, t0 + 298 * U, 130 * U, 36 * U, '#efe8ff', ink, openShop, 15);
  }
  g.globalAlpha = 1;
  if (!REC) text('tap anywhere to retry', SW / 2, cy + ch / 2 + 26 * U, 13 * U, 'rgba(255,255,255,0.85)', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 4 * U });
}

const hookOn = () => REC && rec && rec.t < 3.6 && !!Q.get('hook');
const cap2On = r => REC && rec && !!Q.get('cap2') && rec.crashAt != null && !r.dead && r.n === rec.crashAt && r.b.state === 'pump';

function drawCaptions(r) {
  const t = rec ? rec.t : 0;
  const hook = (Q.get('hook') || '').split('|').filter(Boolean);
  if (hook.length && t < 3.6) {
    const a = t > 3.2 ? 1 - (t - 3.2) / 0.4 : 1;
    g.globalAlpha = a;
    const y0 = 300;
    hook.forEach((ln, i) => text(ln, SW / 2, y0 + i * 96, 76, i === hook.length - 1 ? '#ffe14d' : '#fff', 'center', { stroke: 18 }));
    g.globalAlpha = 1;
  }
  const cap2 = Q.get('cap2');
  if (cap2On(r)) {
    text(cap2, SW / 2, 330, 70, '#fff', 'center', { stroke: 16 });
  }
}

// ---------------------------------------------------------------- og image
function drawOg() {
  // a balloon one hair from the pin, title on the left
  cam = { x: -175, y: 345, z: 1.18 };
  pal = zonePal(0);
  drawSky();
  drawGround();
  drawPump(run);
  const b = run.b;
  drawNeedles(b.needles, b);
  drawBalloon(b, {});
  drawGapReadout(run, b);
  const gr = g.createLinearGradient(0, 0, SW * 0.6, 0);
  gr.addColorStop(0, 'rgba(20,8,40,0.55)');
  gr.addColorStop(1, 'rgba(20,8,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, SW, SH);
  const x = SW * 0.26, y = SH * 0.36;
  g.save();
  g.translate(x, y);
  g.rotate(-0.06);
  text("DON'T", 0, -62, 92, '#fff', 'center', { stroke: 16 });
  text('POP!', 0, 50, 150, '#ff3b5c', 'center', { stroke: 18, strokeColor: '#1d1030' });
  g.restore();
  text('pump it as close to the pin as you dare', x, y + 175, 27, '#fff', 'center', { font: 'system-ui, sans-serif', weight: '800', stroke: 7 });
  text('free · no download · one finger', x, y + 216, 22, 'rgba(255,255,255,0.9)', 'center', { font: 'system-ui, sans-serif', weight: '700', stroke: 6 });
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
  const close = r.closest < Infinity ? ` and got ${r.closest.toFixed(1)} mm from the pin` : '';
  const txt = `I scored ${r.score} on DON'T POP! 🎈📌${close}. how close can you pump it? →`;
  const url = 'https://' + URL_PLAY + '/';
  try {
    if (navigator.share) await navigator.share({ title: "Don't Pop!", text: txt, url });
    else {
      await navigator.clipboard.writeText(txt + ' ' + url);
      toast('Copied! Send it to a friend 🎈');
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
  for (const s of SKINS) {
    const have = owned.includes(s.id);
    const b = document.createElement('button');
    b.className = 'car' + (s.id === skinId ? ' sel' : '') + (have ? '' : ' locked');
    let bg = s.col;
    if (s.col === 'rainbow') bg = 'linear-gradient(135deg,#ff3b5c,#ffb02e,#ffe53b,#4fd36b,#3fa4ff,#9d5cff)';
    else if (s.pattern === 'dots') bg = `radial-gradient(circle at 30% 30%, #fff 0 4px, transparent 5px) 0 0/16px 16px, ${s.col}`;
    else if (s.pattern === 'stripes') bg = `repeating-linear-gradient(90deg, ${s.col} 0 8px, #1f7a3a 8px 12px)`;
    else if (s.pattern === 'disco') bg = `repeating-conic-gradient(#e9eef8 0 25%, #8f99ad 0 50%) 0 0/10px 10px`;
    b.innerHTML = `<i style="background:${bg}"></i><b>${s.name}</b><span>${have ? (s.id === skinId ? 'PUMPING' : 'SELECT') : '◆ ' + s.price}</span>`;
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
        toast(`Need ${s.price - coins} more ◆. Pump closer!`);
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
  pressId++;
  ensureAudio();
  if (x != null) {
    const b = hitButton(x, y);
    if (b) {
      if (run) run.usedPress = pressId;
      sfx('click');
      b.act();
      return;
    }
  }
  if (mode === 'title') startGame();
  else if (mode === 'over') {
    if (overT > 0.45) startGame();
  }
}
function release() {
  held = false;
}
if (!REC && !OG) {
  cvs.addEventListener('pointerdown', e => {
    e.preventDefault();
    press(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'ArrowUp') return;
    if (mode !== 'play' && scrollY > 40) return; // reading the info sheet below the game
    e.preventDefault(); // auto-repeats too, or a held Space scrolls the page mid-run
    if (e.repeat || document.getElementById('garage').classList.contains('on')) return;
    press(null, null);
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') release();
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
  run = newRun({ seed: 3, bot: true });
  const b = run.b;
  b.state = 'pump';
  b.t = 1;
  b.r = 128;
  b.needles = [];
  const phi = 0.55, rt = 128.2;
  const cy = centerY(b.asp, rt);
  let ux = Math.sin(phi), uy = -Math.cos(phi) / b.asp;
  const m = Math.hypot(ux, uy);
  b.needles.push({ x: rt * Math.sin(phi), y: cy - b.asp * rt * Math.cos(phi), x0: 0, y0: 0, ux: ux / m, uy: uy / m, len: 150, amp: 0, out: 0, head: '#3fa4ff' });
  measure(b);
  b.tension = 1;
  document.fonts.load('40px "Luckiest Guy"').finally(() => {
    tReal = 0.3;
    drawOg();
    window.__ogReady = true;
  });
} else if (REC) {
  // Deterministic recording: the harness steps frames and grabs the canvas.
  const crashAt = +(Q.get('crash') || 11);
  const seed = +(Q.get('seed') || 4);
  const kiss = new Set((Q.get('kiss') || '').split(',').filter(Boolean).map(Number));
  const ok = new Set((Q.get('ok') || '').split(',').filter(Boolean).map(Number));
  rec = { t: 0, frame: 0, events: [], squeak: [], tension: [], states: [], musicStart: 0, crashAt };
  const pr = rng(seed * 31);
  run = newRun({
    seed,
    off: +(Q.get('off') || 6),
    bot: true,
    layer: 2,
    plan: k => (k >= crashAt ? 'pop' : kiss.has(k) ? 0.6 + pr() * 0.6 : ok.has(k) ? 16 : 2.2 + pr() * 6),
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
      return { t: rec.t, mode, score: run.score, dead: run.dead, corners: run.n, streak: run.streak, phi: run.b.phi, pins: run.b.needles.length };
    },
    frame: (q = 0.9) => cvs.toDataURL('image/jpeg', q),
    audio: dur => renderOffline(rec, dur),
  };
  document.fonts.load('40px "Luckiest Guy"').then(() => (window.__recReady = true));
} else {
  run = newRun({ bot: true, attract: true });
  if (QA) {
    window.__qa = () => {
      const b = run.b;
      return { mode, t: run.t, tr: tReal, ts: run.ts, score: run.score, n: run.n, streak: run.streak, dead: run.dead, cause: run.cause, closest: run.closest, kisses: run.kisses, best, coins, state: b.state, r: b.r, rMin: b.rMin, gap: b.gap, D: b.P.D, T: b.P.T, slow: b.slow, st: b.st, attract: run.attract };
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
  document.fonts.load('40px "Luckiest Guy"').finally(() => requestAnimationFrame(loop));
}
