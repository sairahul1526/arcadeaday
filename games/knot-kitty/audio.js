// Knot Kitty: procedural Web Audio (GDD §8, interface §13.7). Every sound is synthesized, so the same
// engine runs live (AudioContext) and offline (OfflineAudioContext) for the record-mode WAV.
//
// DECISION: audio.js also listens to P.onPause / P.onResume / P.onAudio itself (idempotent with game.js).
//   The context runs only while !held && P.audioOn && !P.paused, where suspend()/resume() set `held`.
//   The 25 ms scheduler interval exists only while the context is 'running' and a loop is playing.
// DECISION: music is driven by playWorld(); as a fallback the bus also drives it: levelStart → that
//   level's world (daily/bonus keep the current world), screen title → seasonal world's title variant,
//   map/shop/kittens/settings/daily/allbeaten → current world's title variant. Repeated calls are no-ops.
// DECISION: playWorld(0, base?) takes an optional base world for the title/map variant (default: current,
//   or the seasonal world before any level has been played).
// DECISION: `pull` plays zip(0.45) (the bus event has no duration); `kittenFree` plays the kitten meow
//   (synced with the leap) and `win` plays arpeggio + purr + one star bell per star at 0.6 + 0.25·i s.
//   `kittenStage` plays a short "mew", `spoolEnter` a soft roll, `paw` with left>0 a soft pat,
//   `booster` snip → snip, slot → unlock clack; undo/hint boosters use their own events.
// DECISION: master = §8.3 DynamicsCompressor (−10 dB, 4:1) → soft-clip ceiling (WaveShaper: linear up to
//   −4.4 dBFS, tanh knee, never above −0.5 dBFS) so nothing can clip. Firefox's DynamicsCompressor squashes
//   short blips by ~20 dB, so on Firefox a fixed +1.6 dB gain (≈ Chrome's makeup gain) replaces it.
//   Gain staging puts the loudest stinger near −6 dBFS. One shared convolver reverb
//   (post-fader sends from music and SFX) gives the cosy room.
// DECISION: renderOffline(timeline, durSec, world?) — the music world can come from the 3rd argument,
//   `timeline.world`, a `{t, name:'music'|'playWorld', args:[w]}` entry, or `screen`/`levelStart` entries.
//   Entries whose args is an array call sfx(name, ...args); object args are treated as bus event data.
//   Also exported: renderBuffer() (same, returns the AudioBuffer) and BUS_EVENTS (names audio reacts to).
import P from '../shared/platform.js';
import { bus, SEASON_END } from './consts.js';

const LOOK = 0.1, TICK_MS = 25, MAX_VOICES = 24, MUSIC_K = 0.35, MASTER = 0.8;
const FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '');
const CLIP_CURVE = (() => { // y = x up to 0.6, then 0.6 + 0.35·tanh((x − 0.6)/0.35); input pre-scaled by 0.5
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.35 * Math.tanh((a - 0.6) / 0.35));
  }
  return c;
})();
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const cents = c => Math.pow(2, c / 1200);

function rng(seed) { // proto logic.js rng (mulberry32)
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ worlds (§8.1)
// chords: pad voicings (MIDI), 2 bars each; roots: bass roots; pcs: scale pitch classes; lo/hi: melody range.
const WD = [null,
  { name: 'Autumn Den', bpm: 84, pcs: [5, 7, 9, 0, 2], lo: 65, hi: 84, lead: 'pluck', arp: 8, perc: 'brush', bass: 'half', pad: 0.07,
    chords: [[53, 57, 60], [50, 53, 57], [50, 53, 58], [48, 52, 55]], roots: [41, 38, 46, 48] },
  { name: 'Pumpkin Night', bpm: 96, pcs: [2, 4, 5, 7, 9, 10, 1], lo: 74, hi: 88, lead: 'celesta', arp: 4, perc: 'wood', bass: 'half', pad: 0.055,
    chords: [[50, 53, 57], [50, 53, 58], [50, 55, 58], [49, 52, 57]], roots: [38, 46, 43, 45] },
  { name: 'Snowy Cabin', bpm: 76, pcs: [7, 9, 11, 0, 2, 4, 6], lo: 79, hi: 93, lead: 'musicbox', arp: 4, perc: 'shaker', bass: 'half', pad: 0.065,
    chords: [[55, 59, 62], [52, 55, 59], [52, 55, 60], [50, 54, 57]], roots: [43, 40, 48, 50] },
  { name: 'Cat Café', bpm: 100, swing: 0.58, pcs: [10, 0, 2, 3, 5, 7, 9], lo: 70, hi: 84, lead: 'pluck', arp: 0, perc: 'brush', bass: 'walk', pad: 0.06, trem: 5,
    chords: [[50, 53, 57, 58], [50, 53, 55, 58], [51, 55, 58, 60], [51, 53, 57, 60]], roots: [46, 43, 48, 41], stabs: true },
  { name: 'Moonlit Attic', bpm: 70, pcs: [9, 11, 0, 2, 4, 6, 7], lo: 69, hi: 84, lead: 'harp', arp: 16, perc: null, bass: 'long', pad: 0.1,
    chords: [[52, 57, 60], [50, 54, 57], [52, 57, 60], [50, 55, 59]], roots: [45, 38, 45, 43] },
  { name: 'Starry Rooftop', bpm: 90, pcs: [0, 2, 4, 6, 7, 9, 11], lo: 72, hi: 88, lead: 'bell', arp: 8, perc: 'tick', bass: 'half', pad: 0.065, delay: true,
    chords: [[52, 55, 60], [50, 54, 57], [52, 55, 59], [50, 54, 57]], roots: [48, 50, 40, 50] },
];

const MEL = [];
function melody(w) { // §8.1: 8 bars, one note per beat, chord tones 60 % / scale steps 40 %, rests 20 %
  if (MEL[w]) return MEL[w];
  const d = WD[w], r = rng(w * 977), out = [];
  const inRange = pcs => { const a = []; for (let m = d.lo; m <= d.hi; m++) if (pcs.includes(m % 12)) a.push(m); return a; };
  const scale = inRange(d.pcs), mid = (d.lo + d.hi) / 2;
  const near = (arr, x) => arr.slice().sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
  let prev = near(inRange(d.chords[0].map(m => m % 12)), mid)[0];
  for (let b = 0; b < 32; b++) {
    const ct = inRange(d.chords[b >> 3].map(m => m % 12));
    const rest = r() < 0.2, useChord = r() < 0.6, rr = r(), down = b % 8 === 0;
    if ((rest && !down) || b === 31) { out.push(null); continue; }
    let n;
    if (useChord || down) { // a nearby chord tone (≤ a fifth away), no third repeat in a row
      let c = near(ct, prev).filter(x => Math.abs(x - prev) <= 7);
      if (out.length && out[out.length - 1] === prev && c.length > 1) c = c.filter(x => x !== prev);
      c = c.length ? c.slice(0, 3) : near(ct, prev).slice(0, 1);
      n = c[Math.floor(rr * c.length)];
    }
    else {
      let i = scale.indexOf(near(scale, prev)[0]);
      const up = prev > mid + 3 ? rr < 0.3 : prev < mid - 3 ? rr < 0.7 : rr < 0.5;
      i = Math.max(0, Math.min(scale.length - 1, i + (up ? 1 : -1)));
      n = scale[i];
    }
    out.push(n); prev = n;
  }
  return (MEL[w] = out);
}

const seasonWorld = () => (new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) < SEASON_END ? 2 : 1);

// ------------------------------------------------------------------ engine (one per context)
function makeEngine(ctx) {
  const r = rng(4242);
  const E = { ctx, base: 0, loop: null, cur: 0, musicV: 0.7, sfxV: 0.9 };
  const now = () => E.base;

  // noise + reverb impulse (seeded, so offline renders are deterministic)
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2.0), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch), n = d.length;
    for (let i = 0; i < n; i++) { const x = i / n; d[i] = (r() * 2 - 1) * Math.pow(1 - x, 2.6) * (i < 200 ? i / 200 : 1); }
  }

  // graph: mIn → variant LP → variant gain → musicBus → duck → master; sfxIn → sfxBus → master;
  // post-fader sends → verb → master; master → comp → limiter → trim → destination
  const G = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const clip = ctx.createWaveShaper(); clip.curve = CLIP_CURVE; clip.oversample = '2x';
  clip.connect(ctx.destination);
  const pre = G(0.5); pre.connect(clip); // the curve's input u ∈ [−1, 1] stands for x = 2u
  let comp;
  const lift = G(1.2); lift.connect(pre); // post-compressor make-up so the loudest stinger sits near −6 dBFS
  if (FIREFOX) comp = G(1.2);
  else {
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  }
  comp.connect(lift);
  const master = G(MASTER); master.connect(comp);
  const verb = ctx.createConvolver(); verb.buffer = ir;
  const verbOut = G(0.9); verb.connect(verbOut); verbOut.connect(master);
  const duck = G(1); duck.connect(master);
  const musicBus = G(E.musicV * MUSIC_K); musicBus.connect(duck);
  const mSend = G(0.32); duck.connect(mSend); mSend.connect(verb);
  const vg = G(1); vg.connect(musicBus);
  const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 18000; vf.Q.value = 0.5; vf.connect(vg);
  const mIn = G(1.4); mIn.connect(vf); // voice trim: GDD voice gains sit ~3 dB under the SFX otherwise
  const sfxBus = G(E.sfxV); sfxBus.connect(master);
  const sSend = G(0.14); sfxBus.connect(sSend); sSend.connect(verb);
  const sfxIn = G(1); sfxIn.connect(sfxBus);
  Object.assign(E, { master, musicBus, sfxBus, duckG: duck });

  E.setMusic = v => { E.musicV = v; musicBus.gain.setTargetAtTime(Math.max(0, v) * MUSIC_K, ctx.currentTime, 0.03); };
  E.setSfx = v => { E.sfxV = v; sfxBus.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.03); };

  // ---------------------------------------------------------------- SFX voices (max 24, drop oldest)
  let voices = [];
  function track(srcs, out, end) {
    const t = now();
    voices = voices.filter(v => v.end > t);
    voices.push({ srcs, out, end });
    while (voices.length > MAX_VOICES) {
      const v = voices.shift();
      try { v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(0, t, 0.008); } catch {}
      for (const s of v.srcs) try { s.stop(t + 0.05); } catch {}
    }
  }
  function env(p, t, a, peak, d) {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function filt(type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function tone(type, f0, f1, dur, vol, delay = 0, o = {}) {
    const t = now() + delay, a = o.a || 0.005;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g.gain, t, a, vol, dur);
    let n = osc;
    if (o.lp) { const f = filt('lowpass', o.lp); osc.connect(f); n = f; }
    n.connect(g); g.connect(o.dest || sfxIn);
    osc.start(t); osc.stop(t + a + dur + 0.05);
    track([osc], g, t + a + dur + 0.05);
    return osc;
  }
  function noise(dur, f0, f1, q, vol, delay = 0, type = 'bandpass', o = {}) {
    const t = now() + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = filt(type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    const a = o.a != null ? o.a : dur * 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.max(0.002, a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
    s.connect(f).connect(g).connect(o.dest || sfxIn);
    s.start(t, r() * 1.2); s.stop(t + dur + 0.05);
    track([s], g, t + dur + 0.05);
  }
  function bell(f, dur, vol, delay = 0, dest = sfxIn) { // sine + sine×2.76 at 0.3
    const t = now() + delay, out = G(1); out.connect(dest);
    const o1 = ctx.createOscillator(), g1 = ctx.createGain(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o1.frequency.value = f; o2.frequency.value = f * 2.76;
    env(g1.gain, t, 0.004, vol, dur); env(g2.gain, t, 0.002, vol * 0.3, dur * 0.45);
    o1.connect(g1).connect(out); o2.connect(g2).connect(out);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.06); o2.stop(t + dur + 0.06);
    track([o1, o2], out, t + dur + 0.06);
  }
  function meow(kind = 'cat') {
    const k = { cat: [1, 1, 0.3], kitten: [1.38, 0.72, 0.24], mew: [1.5, 0.45, 0.13], sad: [0.92, 1.35, 0.22] }[kind] || [1, 1, 0.3];
    const [p, L, vol] = k, t = now();
    const o = ctx.createOscillator(), f = filt('bandpass', 900 * p, 4), lp = filt('lowpass', 3200), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520 * p, t);
    if (kind === 'sad') {
      o.frequency.linearRampToValueAtTime(600 * p, t + 0.14 * L);
      o.frequency.linearRampToValueAtTime(360 * p, t + 0.5 * L);
    } else {
      o.frequency.linearRampToValueAtTime(820 * p, t + 0.16 * L);
      o.frequency.linearRampToValueAtTime(560 * p, t + 0.5 * L);
    }
    f.frequency.setValueAtTime(900 * p, t);
    f.frequency.linearRampToValueAtTime(1700 * p, t + 0.2 * L);
    f.frequency.linearRampToValueAtTime(1000 * p, t + 0.5 * L);
    env(g.gain, t, 0.04, vol, 0.5 * L);
    o.connect(f).connect(lp).connect(g).connect(sfxIn);
    o.start(t); o.stop(t + 0.6 * L + 0.05);
    track([o], g, t + 0.6 * L + 0.05);
  }
  function purr(dur = 1.2, vol = 0.5, delay = 0) { // lowpass 400 Hz noise with 24 Hz AM
    const t = now() + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const lp = filt('lowpass', 400, 0.9), am = G(0.55), lfo = ctx.createOscillator(), lg = G(0.45), g = ctx.createGain();
    lfo.frequency.value = 24; lfo.connect(lg).connect(am.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.18);
    g.gain.setValueAtTime(vol, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(am).connect(g).connect(sfxIn);
    s.start(t, r()); s.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
    track([s, lfo], g, t + dur + 0.05);
  }
  function duckMusic(len) { // to 40 % over 0.08 s, back over 0.6 s
    const p = duck.gain, t = now();
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.4, t, 0.08 / 3);
    p.setTargetAtTime(1, t + len, 0.6 / 3);
  }
  const later = (d, f) => { const b = E.base; E.base = b + d; try { f(); } finally { E.base = b; } };

  const S = E.sfx = {
    pluck(i = 0) { const f = 420 * Math.pow(2, (3 * Math.min(12, Math.max(0, i))) / 12); tone('triangle', f, f * 0.98, 0.12, 0.22); tone('sine', f * 2, f * 2, 0.06, 0.06); },
    zip(dur = 0.45) { dur = Math.max(0.08, Math.min(1.5, +dur || 0.45)); noise(dur, 700, 3200, 2.2, 0.32); noise(dur * 0.8, 2400, 5200, 6, 0.08, 0.03); },
    wind(k = 1, n = 3) {
      const steps = n >= 6 ? [72, 74, 76, 79, 81, 84] : n === 3 ? [72, 76, 79] : [72, 74, 76, 79, 81, 84].slice(0, Math.max(1, n));
      const f = mtof(steps[Math.max(0, Math.min(steps.length - 1, (k | 0) - 1))]);
      tone('sine', f, f, 0.22, 0.25); tone('sine', f * 2.01, f * 2, 0.15, 0.08);
    },
    spoolDone() { tone('sine', 180, 70, 0.22, 0.36); noise(0.12, 300, 120, 1, 0.25); bell(1046, 0.3, 0.12, 0.06); bell(1318, 0.3, 0.1, 0.12); },
    chain(m = 1) { const f = 660 * Math.pow(2, (2 * Math.min(12, Math.max(0, m))) / 12); tone('triangle', f, f * 0.99, 0.16, 0.22, 0, { lp: 3000 }); tone('sine', f * 2, f * 2, 0.08, 0.06); bell(f * 2, 0.25, 0.05, 0.03); },
    basket() { tone('sine', 260, 180, 0.14, 0.3); noise(0.08, 900, 400, 1, 0.1); },
    blocked() { tone('square', 140, 110, 0.09, 0.08, 0, { lp: 700 }); noise(0.1, 500, 300, 2, 0.12); },
    full() { tone('triangle', 660, 660, 0.09, 0.15); tone('triangle', 660, 660, 0.09, 0.15, 0.14); },
    warn() { tone('triangle', 880, 880, 0.08, 0.14); },
    fail() { tone('triangle', 392, 196, 0.5, 0.25); tone('triangle', 311, 155, 0.6, 0.18, 0.12); },
    stuck() { S.fail(); later(0.55, () => meow('sad')); duckMusic(1.8); },
    meow(kind = 'cat') { meow(kind); },
    mew() { meow('mew'); },
    purr(dur = 1.2) { purr(dur); },
    win(stars = 3) {
      [523, 659, 784, 1046].forEach((f, i) => tone('sine', f, f, 0.35, 0.18, 0.1 + i * 0.09));
      purr(1.2, 0.42, 0.5);
      for (let i = 0; i < Math.max(0, Math.min(3, stars | 0)); i++) later(0.6 + 0.25 * i, () => S.star(i));
      duckMusic(2.4);
    },
    star(i = 0) { bell([784, 988, 1175][Math.max(0, Math.min(2, i | 0))], 0.9, 0.16); },
    coin() { tone('sine', 1318, 1318, 0.06, 0.12); tone('sine', 1760, 1760, 0.08, 0.12, 0.06); },
    unlock() { noise(0.02, 2000, 2000, 1.5, 0.3, 0, 'bandpass', { a: 0.002 }); bell(1046, 0.6, 0.14, 0.03); },
    reveal() { for (let i = 0; i < 4; i++) bell(1500 + r() * 1500, 0.35, 0.07, i * 0.04); },
    pawYawn() {
      const t = now(), o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg2 = G(8);
      o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.4);
      v.frequency.value = 6; v.connect(vg2).connect(o.frequency);
      env(g.gain, t, 0.06, 0.2, 0.4);
      const lp = filt('lowpass', 1200); o.connect(lp).connect(g).connect(sfxIn);
      o.start(t); v.start(t); o.stop(t + 0.52); v.stop(t + 0.52);
      track([o, v], g, t + 0.52);
    },
    pat() { noise(0.06, 600, 300, 1, 0.12, 0, 'lowpass', { a: 0.004 }); },
    iceCrack() { noise(0.06, 4000, 4000, 0.8, 0.22, 0, 'highpass', { a: 0.002 }); },
    thaw() { [2093, 2637, 3136].forEach((f, i) => bell(f, 0.5, 0.07, i * 0.06)); },
    undo() { noise(0.25, 3200, 700, 2.2, 0.26); },
    hint() { bell(1568, 0.8, 0.1); },
    snip() { noise(0.015, 5000, 5000, 2, 0.25, 0, 'bandpass', { a: 0.002 }); noise(0.015, 5000, 5000, 2, 0.25, 0.04, 'bandpass', { a: 0.002 }); },
    click() { tone('sine', 880, 660, 0.06, 0.12); },
    buy() { S.coin(); later(0.09, S.coin); later(0.18, S.coin); },
    gift() { [1046, 1318, 1568, 2093].forEach((f, i) => bell(f, 0.7, 0.11, i * 0.08)); duckMusic(1.4); },
    roll() { noise(0.28, 300, 900, 0.8, 0.07, 0, 'lowpass'); tone('sine', 220, 330, 0.12, 0.05, 0.12); },
  };

  // ---------------------------------------------------------------- music voices
  function mPluck(t, m, vol, dest, dec = 0.35, lp = 2400) {
    const f = mtof(m), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = G(0.12), fl = filt('lowpass', lp), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f * 2;
    o.connect(fl); o2.connect(g2).connect(fl); fl.connect(g).connect(dest);
    env(g.gain, t, 0.005, vol, dec);
    o.start(t); o2.start(t); o.stop(t + dec + 0.06); o2.stop(t + dec + 0.06);
  }
  function mBell(t, m, vol, dest, dec = 1.2) {
    const f = mtof(m), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g1 = ctx.createGain(), g2 = ctx.createGain();
    o1.frequency.value = f; o2.frequency.value = f * 2.76;
    env(g1.gain, t, 0.004, vol, dec); env(g2.gain, t, 0.002, vol * 0.3, dec * 0.4);
    o1.connect(g1).connect(dest); o2.connect(g2).connect(dest);
    o1.start(t); o2.start(t); o1.stop(t + dec + 0.06); o2.stop(t + dec + 0.06);
  }
  function mPad(t, ms, dur, vol, dest, trem = 0) {
    const g = ctx.createGain(), lp = filt('lowpass', 900), end = t + dur + 0.8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.4);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let tail = g;
    const srcs = [];
    if (trem) {
      const tg = G(0.72), lfo = ctx.createOscillator(), lg = G(0.28);
      lfo.frequency.value = trem; lfo.connect(lg).connect(tg.gain); srcs.push(lfo);
      g.connect(tg); tail = tg;
    }
    lp.connect(g); tail.connect(dest);
    for (const m of ms) for (const c of [-6, 6]) {
      const o = ctx.createOscillator(); o.frequency.value = mtof(m) * cents(c);
      const og = G(0.5); o.connect(og).connect(lp); srcs.push(o);
    }
    for (const s of srcs) { s.start(t); s.stop(end + 0.05); }
  }
  function mBass(t, m, vol, dest, dec = 0.3) {
    const o = ctx.createOscillator(), lp = filt('lowpass', 700), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(m);
    env(g.gain, t, 0.008, vol, dec);
    o.connect(lp).connect(g).connect(dest);
    o.start(t); o.stop(t + dec + 0.06);
  }
  function mNoise(t, len, type, f, q, vol, dest, a = 0.002) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = filt(type, f, q), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(fl).connect(g).connect(dest);
    s.start(t, r() * 1.5); s.stop(t + len + 0.03);
  }
  const mTick = (t, dest, vol = 0.04) => mNoise(t, 0.03, 'bandpass', 6000, 1.5, vol, dest);
  const mBrush = (t, dest, vol = 0.03) => mNoise(t, 0.08, 'highpass', 3000, 0.7, vol, dest, 0.012);
  const mWood = (t, dest) => { mPluck(t, 88, 0.05, dest, 0.05, 3000); mNoise(t, 0.025, 'bandpass', 2400, 3, 0.03, dest); };

  // ---------------------------------------------------------------- music loop + scheduler
  function startLoop(w, t, fade) {
    const def = WD[w], out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.setTargetAtTime(1, t, fade / 3);
    out.connect(mIn);
    let fx = null;
    if (def.delay) { // bell + delay 0.33 s, feedback 0.3
      const dl = ctx.createDelay(1), fb = G(0.3), dlp = filt('lowpass', 2800), wet = G(0.45);
      dl.delayTime.value = 0.33;
      dl.connect(dlp).connect(fb).connect(dl); dlp.connect(wet).connect(out);
      fx = G(1); fx.connect(out); fx.connect(dl);
    }
    return { w, def, mel: melody(w), out, fx, step: 0, nextT: t + 0.03 };
  }
  function stopLoop(L, t, fade) {
    L.out.gain.setTargetAtTime(0, t, fade / 4);
    const k = ctx.createConstantSource ? ctx.createConstantSource() : null;
    if (k) { // disconnect after the fade, without timers
      const g = G(0); k.connect(g); g.connect(ctx.destination);
      k.onended = () => { try { L.out.disconnect(); g.disconnect(); } catch {} };
      k.start(t); k.stop(t + fade + 2.5);
    }
  }
  function schedStep(L, s, t) {
    const d = L.def, beat = 60 / d.bpm, out = L.out;
    const bar = s >> 4, sub = s & 3, gb = s >> 2, bi = gb & 3, ci = bar >> 1;
    if (d.swing && (sub & 1)) { if (d.arp !== 16) return; }
    const tt = d.swing && sub === 2 ? t + (d.swing - 0.5) * beat : t;
    const ch = d.chords[ci], root = d.roots[ci];
    // pad: one chord per 2 bars
    if ((s & 31) === 0) mPad(t, ch, beat * 8 - 0.05, d.pad, out, d.trem || 0);
    // bass
    if (sub === 0) {
      if (d.bass === 'half' && (bi === 0 || bi === 2)) mBass(t, bi === 0 ? root : (root + 7 > 52 ? root - 5 : root + 7), bi === 0 ? 0.18 : 0.13, out, 0.32);
      else if (d.bass === 'long' && bi === 0) mBass(t, root, 0.17, out, 0.9);
      else if (d.bass === 'walk') {
        const k = gb & 7, nr = d.roots[(ci + 1) & 3], third = ch.some(m => (m - root) % 12 === 3) ? 3 : 4;
        const walk = [0, third, 7, 9, 12, 7, third, null];
        const m = walk[k] == null ? nr - 1 : root + walk[k];
        mBass(t, m, k === 0 ? 0.18 : 0.14, out, 0.26);
      }
    }
    // lead melody: one note per beat
    if (sub === 0) {
      const m = L.mel[gb];
      if (m != null) {
        if (d.lead === 'pluck') mPluck(t, m, 0.26, out, 0.45);
        else if (d.lead === 'harp') mPluck(t, m, 0.24, out, 0.7, 2600);
        else if (d.lead === 'celesta') mBell(t, m, 0.16, out, 0.5);
        else if (d.lead === 'musicbox') mBell(t, m, 0.14, out, 1.0);
        else if (d.lead === 'bell') mBell(t, m, 0.15, L.fx || out, 1.2);
      }
    }
    // arps
    const c = ch.slice(0, 3);
    if (d.arp === 8 && !(sub & 1)) {
      const tones = [c[0], c[1], c[2], c[0] + 12].map(x => x + 12), pat = [0, 1, 2, 3, 2, 1, 2, 1];
      mPluck(tt, tones[pat[(s >> 1) & 7]], 0.1, out, 0.3, 1800);
    } else if (d.arp === 4 && sub === 0) {
      const tones = [c[0], c[1], c[2], c[1]].map(x => x + (d.lead === 'musicbox' ? 24 : 12));
      if (d.lead === 'musicbox') mBell(t, tones[bi], 0.05, out, 0.8);
      else mPluck(t, tones[bi], 0.09, out, 0.25, 1600);
    } else if (d.arp === 16) {
      const tones = [c[0], c[1], c[2], c[0] + 12, c[1] + 12].map(x => x + 12), pat = [0, 1, 2, 3, 4, 3, 2, 1];
      mPluck(t, tones[pat[s & 7]], 0.075, out, 0.5, 2000);
    }
    if (d.stabs && sub === 2 && (bi === 1 || bi === 3)) for (const m of ch) mPluck(tt, m + 12, 0.05, out, 0.22, 1500);
    // percussion
    if (d.perc === 'brush' && sub === 0 && (bi === 1 || bi === 3)) mBrush(t, out);
    else if (d.perc === 'wood' && sub === 2) mWood(tt, out);
    else if (d.perc === 'shaker' && !(sub & 1)) mTick(tt, out, sub === 2 ? 0.022 : 0.016);
    else if (d.perc === 'tick' && !(sub & 1)) mTick(tt, out, sub === 2 ? 0.04 : 0.028);
  }
  E.pump = (until, from = -Infinity) => {
    const L = E.loop;
    if (!L) return;
    const st = 60 / L.def.bpm / 4;
    while (L.nextT < until) {
      if (L.nextT >= from && E.musicV > 0.001) schedStep(L, L.step, L.nextT);
      L.nextT += st; L.step = (L.step + 1) & 127;
    }
  };
  E.setVariant = (on, t) => {
    vf.frequency.setTargetAtTime(on ? 1200 : 18000, t, 0.25);
    vg.gain.setTargetAtTime(on ? 0.708 : 1, t, 0.25);
  };
  E.playWorld = (w, t, base) => {
    const title = !w;
    const target = title ? (base || E.cur || seasonWorld()) : Math.max(1, Math.min(6, w | 0));
    E.cur = target;
    E.setVariant(title, t);
    if (E.loop && E.loop.w === target) return;
    const fade = E.loop ? 1 : 1.5;
    if (E.loop) stopLoop(E.loop, t, 1);
    E.loop = startLoop(target, t, fade);
  };
  E.play = (name, ...a) => { const f = S[name]; if (f) f(...a); };
  return E;
}

// ------------------------------------------------------------------ bus → sound
const SCREEN_TITLE_VARIANT = ['map', 'shop', 'kittens', 'settings', 'daily', 'allbeaten'];
function busHandlers(E, music) {
  return {
    pluck: d => E.play('pluck', (d && d.i) | 0),
    pull: d => E.play('zip', (d && d.dur) || 0.45),
    wind: d => E.play('wind', d.k, d.n),
    spoolDone: () => E.play('spoolDone'),
    spoolEnter: () => E.play('roll'),
    chain: d => E.play('chain', (d && d.m) | 0),
    basket: () => E.play('basket'),
    blocked: () => E.play('blocked'),
    full: () => E.play('full'),
    basketWarn: () => E.play('warn'),
    unlock: () => E.play('unlock'),
    reveal: () => E.play('reveal'),
    paw: d => E.play(d && d.left === 0 ? 'pawYawn' : 'pat'),
    thaw: d => E.play(d && d.left === 0 ? 'thaw' : 'iceCrack'),
    kittenStage: () => E.play('mew'),
    kittenFree: () => E.play('meow', 'kitten'),
    win: d => E.play('win', d && d.result && d.result.stars != null ? d.result.stars : 3),
    stuck: () => E.play('stuck'),
    undo: () => E.play('undo'),
    booster: d => { if (d && d.kind === 'snip') E.play('snip'); else if (d && d.kind === 'slot') E.play('unlock'); },
    hint: () => E.play('hint'),
    click: () => E.play('click'),
    buy: () => E.play('buy'),
    gift: () => E.play('gift'),
    coins: () => E.play('coin'),
    screen: d => {
      const n = d && d.name;
      if (n === 'title') music(0, seasonWorld());
      else if (SCREEN_TITLE_VARIANT.includes(n)) music(0);
    },
    levelStart: d => {
      const id = d && d.id | 0;
      music(id > 0 ? Math.min(6, Math.floor((id - 1) / 10) + 1) : (E.cur || seasonWorld()));
    },
  };
}
export const BUS_EVENTS = Object.keys(busHandlers({ play() {} }, () => {}));

// ------------------------------------------------------------------ live module state
let ctx = null, E = null, H = null, held = false, timer = 0, hooked = false;
let musicV = 0.7, sfxV = 0.9, want = null; // want = { w, base } last requested music

const allowed = () => !!ctx && !held && P.audioOn !== false && !P.paused;
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
function tick() {
  if (!ctx || ctx.state !== 'running' || !allowed()) { stopTimer(); return; }
  E.pump(ctx.currentTime + LOOK, ctx.currentTime - 0.03);
}
function startTimer() {
  if (timer || !E || !E.loop || !ctx || ctx.state !== 'running' || !allowed()) return;
  timer = setInterval(tick, TICK_MS);
  tick();
}
function sync() {
  if (!ctx || ctx.state === 'closed') return;
  if (allowed()) {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    else startTimer();
  } else {
    stopTimer();
    if (ctx.state !== 'suspended') ctx.suspend().catch(() => {});
  }
}
function onState() {
  if (!ctx) return;
  if (ctx.state === 'running') { if (allowed()) startTimer(); else { stopTimer(); ctx.suspend().catch(() => {}); } }
  else stopTimer();
}
function liveMusic(w, base) {
  want = { w, base };
  if (!E) return;
  E.playWorld(w, ctx.currentTime, base);
  startTimer();
}

/** Creates the AudioContext (call from the first pointerdown/keydown); safe to call again on later gestures. */
export function init() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    try { ctx = new AC(); } catch { ctx = null; return; }
    E = makeEngine(ctx);
    E.setMusic(musicV); E.setSfx(sfxV);
    ctx.onstatechange = onState;
    try { // iOS unlock: a silent one-sample buffer inside the gesture
      const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0);
    } catch {}
    H = busHandlers(E, liveMusic);
    if (!hooked) {
      hooked = true;
      for (const k of Object.keys(H)) bus.on(k, d => { if (k === 'screen' || k === 'levelStart') H[k](d); else if (allowed()) { E.base = ctx.currentTime; H[k](d || {}); } });
      P.onPause(sync); P.onResume(sync); P.onAudio(sync);
    }
    if (want) E.playWorld(want.w, ctx.currentTime, want.base);
  }
  sync();
}
export function setMusic(v) { musicV = Math.max(0, Math.min(1, +v || 0)); if (E) E.setMusic(musicV); }
export function setSfx(v) { sfxV = Math.max(0, Math.min(1, +v || 0)); if (E) E.setSfx(sfxV); }
/** 0 = title/map variant (lowpass 1.2 kHz, −3 dB) of the current world (or `base`), 1..6 = world loop. */
export function playWorld(w, base) { liveMusic(w | 0, base); }
/** Plays a §8.2 recipe now. Dropped while suspended, so nothing piles up for the resume. */
export function sfx(name, ...args) {
  if (!E || !allowed()) return;
  E.base = ctx.currentTime;
  try { E.play(name, ...args); } catch (e) { console.warn(e); }
}
export function suspend() { held = true; sync(); }
export function resume() { held = false; sync(); }
export function isRunning() { return !!ctx && ctx.state === 'running'; }

// ------------------------------------------------------------------ offline render
const MUSIC_NAMES = ['music', 'playWorld'];
/** Renders timeline [{t, name, args}] (+ music world) to an AudioBuffer with an OfflineAudioContext. */
export async function renderBuffer(timeline = [], durSec = 25, world = null, sr = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const dur = Math.max(0.1, +durSec || 25);
  const oc = new OAC(2, Math.ceil(sr * dur), sr);
  const X = makeEngine(oc);
  X.setMusic(musicV); X.setSfx(sfxV);
  const h = busHandlers(X, (w, base) => X.playWorld(w, X.base, base));
  const evs = (Array.isArray(timeline) ? timeline : []).filter(e => e && isFinite(e.t)).slice().sort((a, b) => a.t - b.t);
  const w0 = world != null ? world : timeline && timeline.world != null ? timeline.world : null;
  if (w0 != null && !evs.some(e => e.t <= 0.001 && (MUSIC_NAMES.includes(e.name) || e.name === 'levelStart'))) { X.base = 0; X.playWorld(w0 | 0, 0); }
  for (const e of evs) {
    const t = Math.max(0, Math.min(dur, e.t));
    X.pump(t);
    X.base = t;
    try {
      if (MUSIC_NAMES.includes(e.name)) { const a = Array.isArray(e.args) ? e.args : [e.args]; X.playWorld(a[0] | 0, t, a[1]); }
      else if (Array.isArray(e.args)) X.play(e.name, ...e.args);
      else if (h[e.name]) h[e.name](e.args || {});
      else X.play(e.name, e.args);
    } catch (err) { console.warn(err); }
  }
  X.pump(dur);
  return oc.startRendering();
}
export async function renderOffline(timeline = [], durSec = 25, world = null) {
  return wavBase64(await renderBuffer(timeline, durSec, world));
}
function wavBase64(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bytes = 44 + n * ch * 2;
  const dv = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    let v = data[c][i]; v = v !== v ? 0 : Math.max(-1, Math.min(1, v));
    dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  const u8 = new Uint8Array(dv.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
