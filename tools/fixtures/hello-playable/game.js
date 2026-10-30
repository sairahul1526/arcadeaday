// Hello Playable: the infra fixture. Tap the bouncing blobs to clear a level (2 levels).
// Small, but it uses the platform layer the way every v2 game must:
//   P.init (versioned save + migrate), P.save, P.best, P.onPause/onResume (loop + AudioContext),
//   P.audioOn/onAudio, P.firstFrame then P.ready, and the playables-check QA contract under ?qa=1.
import P from '../shared/platform.js';
import { ensure as ensureAudio, setRunning, beep } from './audio.js';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const LEVELS = [
  { n: 5, speed: 0.16 },
  { n: 8, speed: 0.24 },
];
const FONT = '"Lilita One", system-ui, sans-serif';

let W = 0, H = 0, DPR = 1;
let mode = 'title'; // title | play | win
let level = 0, score = 0, t = 0, targets = [], pops = [], btn = null;
let raf = 0, last = 0, booted = false;

// ------------------------------------------------------------ layout (keeps all state on resize)
function resize() {
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  W = innerWidth;
  H = innerHeight;
  cvs.width = Math.round(W * DPR);
  cvs.height = Math.round(H * DPR);
  if (booted && !raf) draw(); // repaint even while paused
}
const R = () => Math.max(26, Math.min(W, H) * 0.075); // blob radius in CSS px
const toPx = b => ({ x: b.x * W, y: b.y * H });

// ------------------------------------------------------------ game flow
function startLevel(i) {
  level = i;
  mode = 'play';
  const L = LEVELS[i];
  let seed = 7 + i * 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  targets = Array.from({ length: L.n }, () => {
    const a = rnd() * Math.PI * 2;
    return { x: 0.2 + rnd() * 0.6, y: 0.3 + rnd() * 0.5, vx: Math.cos(a) * L.speed, vy: Math.sin(a) * L.speed, alive: true, hue: (rnd() * 360) | 0 };
  });
  beep(440, 0.1, 'triangle');
}
function winLevel() {
  mode = 'win';
  P.data.beaten = Math.max(P.data.beaten | 0, level + 1);
  P.best(score);
  P.save();
  beep(880, 0.25, 'triangle');
}
function tapAt(x, y) {
  ensureAudio();
  setRunning(P.audioOn && !P.paused);
  if (mode !== 'play') {
    if (btn && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) pressButton();
    return;
  }
  const r = R();
  for (const b of targets) {
    if (!b.alive) continue;
    const p = toPx(b);
    if (Math.hypot(p.x - x, p.y - y) <= r * 1.15) {
      b.alive = false;
      score += 10;
      pops.push({ x: p.x, y: p.y, age: 0, hue: b.hue });
      beep(520 + 60 * targets.filter(o => !o.alive).length, 0.1);
      if (targets.every(o => !o.alive)) winLevel();
      return;
    }
  }
}
function pressButton() {
  if (mode === 'title') { score = 0; startLevel(Math.min(P.data.beaten | 0, LEVELS.length - 1)); }
  else if (mode === 'win') {
    if (level + 1 < LEVELS.length) startLevel(level + 1);
    else { score = 0; startLevel(0); }
  }
}

// ------------------------------------------------------------ loop
function update(dt) {
  t += dt;
  if (mode === 'play') {
    for (const b of targets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt * (W / H); // same visual speed on both axes
      if (b.x < 0.08 || b.x > 0.92) { b.vx = -b.vx; b.x = Math.min(0.92, Math.max(0.08, b.x)); }
      if (b.y < 0.18 || b.y > 0.92) { b.vy = -b.vy; b.y = Math.min(0.92, Math.max(0.18, b.y)); }
    }
  }
  for (const p of pops) p.age += dt;
  pops = pops.filter(p => p.age < 0.5);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  raf = requestAnimationFrame(frame);
}
function startLoop() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

// ------------------------------------------------------------ drawing
function text(s, x, y, size, color = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillText(s, x, y + size * 0.08);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
function draw(loading = false) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b1a6b');
  g.addColorStop(1, '#ff7a9c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * Math.abs(Math.sin(t * 0.8 + i))})`;
    ctx.fillRect(((i * 97) % 100) / 100 * W, ((i * 61) % 60) / 100 * H, 2, 2);
  }
  const u = Math.min(W, H);
  btn = null;
  if (loading) { text('LOADING…', W / 2, H / 2, u * 0.06); return; }
  if (mode === 'play' || mode === 'win') {
    const r = R();
    for (const b of targets) {
      if (!b.alive) continue;
      const p = toPx(b);
      ctx.fillStyle = `hsl(${b.hue} 85% 62%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d1240';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.3, p.y - r * 0.1, r * 0.12, 0, Math.PI * 2);
      ctx.arc(p.x + r * 0.3, p.y - r * 0.1, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of pops) {
      ctx.strokeStyle = `hsla(${p.hue} 90% 70% / ${1 - p.age * 2})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R() * (1 + p.age * 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    const left = targets.filter(b => b.alive).length;
    text(`LEVEL ${level + 1}`, u * 0.05, H * 0.07, u * 0.055, '#fff', 'left');
    text(`${score}`, W - u * 0.05, H * 0.07, u * 0.055, '#ffd650', 'right');
    if (mode === 'play') text(`${left} LEFT`, W / 2, H * 0.07, u * 0.045, '#fff');
  }
  if (mode === 'title' || mode === 'win') {
    ctx.fillStyle = mode === 'win' ? 'rgba(20,10,50,.55)' : 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, W, H);
    const title = mode === 'title' ? 'HELLO PLAYABLE' : `LEVEL ${level + 1} CLEAR!`;
    text(title, W / 2, H * 0.36, Math.min(u * 0.11, (W * 0.9) / (title.length * 0.6)));
    text(`BEST ${P.data.best | 0}`, W / 2, H * 0.36 + u * 0.1, u * 0.05, '#ffd650');
    const label = mode === 'title' ? 'PLAY' : level + 1 < LEVELS.length ? 'NEXT' : 'AGAIN';
    const bw = u * 0.42, bh = u * 0.14;
    btn = { x: W / 2 - bw / 2, y: H * 0.6, w: bw, h: bh };
    ctx.fillStyle = '#ffd650';
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, bw, bh, bh / 2);
    ctx.fill();
    text(label, W / 2, btn.y + bh / 2, bh * 0.5, '#1d1240');
  }
}

// ------------------------------------------------------------ input (pointer = touch + mouse)
cvs.addEventListener('pointerdown', e => {
  e.preventDefault();
  tapAt(e.clientX, e.clientY);
});
addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.code !== 'Enter') return; // never touch Esc
  e.preventDefault();
  if (e.repeat) return;
  ensureAudio();
  setRunning(P.audioOn && !P.paused);
  if (mode !== 'play') pressButton();
});
addEventListener('resize', resize);

// ------------------------------------------------------------ boot
resize();
draw(true);
P.firstFrame();
await P.init({
  store: 'hello_',
  version: 2,
  defaults: { v: 2, beaten: 0, best: 0 },
  // v1 saves were { v: 1, lvl, hi }
  migrate: old => ({ v: 2, beaten: old.lvl | 0, best: old.hi | 0 }),
});
P.onPause(() => { stopLoop(); setRunning(false); });
P.onResume(() => { startLoop(); setRunning(P.audioOn); });
P.onAudio(on => setRunning(on && !P.paused));
try { await document.fonts.load(`40px ${FONT}`); } catch {}
booted = true;
if (!P.paused) startLoop();
draw();
P.ready();

// ------------------------------------------------------------ QA contract (see games/shared/README.md)
if (P.qa) {
  window.__qa = () => ({ t, mode, level: level + 1, progress: P.data.beaten | 0, score, best: P.data.best | 0, env: P.env });
  window.__qaInput = () => {
    if (mode !== 'play') return btn ? [{ type: 'tap', x: btn.x + btn.w / 2, y: btn.y + btn.h / 2 }] : [];
    const b = targets.find(o => o.alive);
    if (!b) return [];
    const ahead = 0.06; // aim where the blob will be when the tap lands
    return [{ type: 'tap', x: (b.x + b.vx * ahead) * W, y: (b.y + b.vy * ahead * (W / H)) * H }];
  };
  window.__qaOldSave = () => ({ save: JSON.stringify({ v: 1, lvl: 2, hi: 130 }), progress: 2 });
}
