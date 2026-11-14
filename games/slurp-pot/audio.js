// Slurp Pot: procedural Web Audio (GDD §8, interface §13.3). No audio files. The same engine (makeEngine) runs live
// on an AudioContext and offline on an OfflineAudioContext, so record mode can render a WAV of the real mix.
//
// Graph: sfx/bite -> sfxBus; loops -> modeG -> duck -> musicBus; both -> master -> compressor -> LIFT -> soft-clip
//   limiter -> run gate -> destination. Short seeded convolver reverb on post-fader sends. The run gate is a gain at the
//   very end: 0 whenever audio must be silent (muted, held/paused, P.audioOn false, not yet unlocked), so silence is
//   immediate (25 ms fade) even before the AudioContext finishes suspending; the context is then suspended for true silence.
//
// DECISION: audio.js reads P.audioOn (read only, GDD §11.1 master mute) as a safety net: sound plays only while
//   unlocked && !held && !muted && P.audioOn !== false. game.js still wires P.onAudio -> setMuted and P.onPause/onResume
//   (and the Pause card) -> suspend()/resume(); a 250 ms poll catches any flag change nobody forwarded. audio.js does not
//   subscribe to P callbacks itself and never reads P.paused.
// DECISION: initAudio() builds the whole graph with the context suspended and the gate closed. unlock() (first gesture,
//   safe on every gesture) is the only thing that starts the clock; an audio flag that is off at load keeps it suspended.
// DECISION: suspend() fades the gate 25 ms, then suspends the context ~70 ms later (resume() cancels a pending suspend).
//   sfx()/bus events are dropped while not allowed, so nothing piles up for the resume.
// DECISION: the bite is a pre-synthesised AudioBuffer per (tier, ladder step, ingredient) made on first use and cached:
//   2 nodes per bite, so a 50-bites-in-2-s storm stays cheap. Pitch ladder, +1 dB per completed 8-cycle (max +3 dB),
//   45 ms rate limit (a bite arriving inside the window is rolled to the next 45 ms slot if that is <= 90 ms away,
//   otherwise coalesced into the next played bite at +2 dB, cap +4 dB), bite voice pool 10, global SFX voice cap 28.
// DECISION: an ingredient bite (bus bite.ing) adds a faint glock shimmer (2f) baked into its buffer, so "right food" is
//   audible without extra nodes. Tiers >= 3 add glug (the bus bite has no radius, so a >= 0.5 r is approximated by tier).
// DECISION: win on the bus plays the whole payoff: orderUp bell x2 at 0, stamp at +0.5 s, win jingle at +0.62 s with the
//   star bells inside it. The UI must not also play orderUp/stamp/star on the win card. ticketDone plays ticket + stamp.
//   courseDone plays orderUp. bossBite plays the big glug + drum + choir.
// DECISION: music modes (setMode): 'play' full loop, 'card' loop at -6 dB (win/fail/pause cards), 'title' Picnic loop
//   with melody only (plus a quiet pad so it is not empty) whatever the town, 'map' same as play. bus start -> play,
//   win/fail -> card. Tension (last 10 s: shaker doubles, melody drops): setTension(on) is exact; as a fallback bus
//   lowTime holds it 11 s and every tick refreshes it 1.8 s. Feast (setFeast): +6 % tempo.
// DECISION (Wed): all three town loops are hand-written and share one family: the same AABA form over 8-bar variants,
//   the same I–vi–IV–V chord rhythm, the same bass rhythm (root on 1, fifth/root on 3, pickup in bar 4), the same
//   "pot motif" (scale degrees 3-5-6-5) opening every A section, a soft 16th/8th shaker grid, and the same glock sting
//   (key fifth -> octave) at the end of the B section. The instruments (GDD §8.1) make each town distinct.
// DECISION (Wed): Feast variant = the town loop at +6 % tempo, form ABAB (brighter B more often) plus a "kitchen rush"
//   layer: hat 8ths, a pot-lid rim on 2 and 4, a soft tom on 1 and 3 and a bass octave bounce. Same family, more drive.
// DECISION: P import path is ../shared/platform.js (build rewrites to ./). renderOffline(durSec, events, opts) -> AudioBuffer,
//   renderWav() -> base64 WAV; default music OFF (record mode adds music in the edit, GDD §8.4), opts.music true includes it.
// DECISION (Wed, fixes the Tuesday first-sound dip): the Chromium/WebKit DynamicsCompressor starts with its gain envelope
//   at full reduction and releases it over the first ~100-150 ms of *running* context time (input level does not matter,
//   which is why a warm-up signal never helped: the clock does not run while suspended). So the compressor's release
//   starts at 0 (instant recovery) and is set to the spec'd 0.15 s at context time 0.05 s (WARM_S). Measured in a fresh
//   context: first bite in the unlocking gesture 0.695 vs 0.675 later in Chromium and WebKit (was 0.227, -9.4 dB), with no
//   added latency. The same applies to every OfflineAudioContext render (record mode).
// DECISION (Wed listen pass): MUSIC_K 0.75 -> 0.6 and the loop bass x BASS_K 0.65. The loop's crest came from the bass
//   (square-ish root notes on every downbeat), so the busiest 400 ms of music sat only 12.3 dB under the median SFX peak.
//   Now 15.6 dB under it (loudest loop peak -6.7 dBFS vs SFX peaks -1.7..-5 dBFS). Town lvl (1 / 1.2 / 1.04) puts the
//   three loops within 0.4 dB RMS. Numbers in studio/2026-11-04/audio/listen.txt.
import P from '../shared/platform.js';

const WARM_S = 0.05, OPEN_S = 0.012, LOOK = 0.2, TICK_MS = 25, POLL_MS = 250, SUSPEND_MS = 70, KICK_GAP_MS = 2000;
const MUSIC_K = 0.6, BASS_K = 0.65, SFX_K = 0.85, MASTER = 0.8, LIFT = 1.5, FF_GAIN = 1.5;
const MAX_VOICES = 28, BITE_VOICES = 10, BITE_GAP = 0.045, BITE_MAX_LAG = 0.09;
const FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '');
const CLIP_CURVE = (() => { // y = x up to 0.6, then 0.6 + 0.25·tanh((x − 0.6)/0.25): ceiling 0.85 (−1.4 dBFS); the input is pre-scaled by 0.5
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.25 * Math.tanh((a - 0.6) / 0.25));
  }
  return c;
})();
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const cents = c => Math.pow(2, c / 1200);
const dbLin = db => Math.pow(10, db / 20);
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, (v | 0)));
const clamp01 = v => Math.max(0, Math.min(1, +v || 0));

function rng(seed) { // mulberry32
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ bite ladder (GDD §8.2)
const BASE_HZ = [660, 550, 440, 330, 220];                 // T0..T4
const LADDER = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2]; // pentatonic steps, index (n − 1) mod 8
/** Frequency of the bite at tier and chain index n (n = 1 for the first bite of a chain). */
export function biteHz(tier, n) { return BASE_HZ[clampI(tier, 0, 4)] * LADDER[(Math.max(1, n | 0) - 1) & 7]; }

// ------------------------------------------------------------------ towns (GDD §8.1)
// mel: per bar [[step 0..15, MIDI], ...]; 8 bars per variant; form AABA over 32 bars (Feast: ABAB). Every A section opens
// with the "pot motif" (scale degrees 3-5-6-5); the B section ends on the glock sting (key fifth -> octave, steps 12/14).
const PICNIC_MEL = {
  A: [[[0, 76], [8, 79]], [[0, 81], [10, 79]], [[0, 81], [8, 84]], [[0, 79], [6, 74]],
      [[0, 79], [8, 76]], [[0, 81], [8, 79]], [[0, 76], [10, 81]], [[0, 74], [8, 79]]],
  B: [[[0, 84], [8, 81]], [[0, 79], [6, 81]], [[0, 84], [8, 81]], [[0, 79], [8, 74]],
      [[0, 76], [6, 79]], [[0, 81], [8, 84]], [[0, 81], [6, 79]], [[0, 74], [8, 76]]],
};
// Market Street, F major pentatonic (F G A C D) over F - Dm - Bb - C: busier pizzicato line, 8th-note pickups
const MARKET_MEL = {
  A: [[[0, 69], [4, 72], [6, 74], [8, 72]], [[0, 77], [6, 74], [8, 69]], [[0, 74], [4, 77], [8, 79], [12, 77]], [[0, 79], [6, 77], [8, 72]],
      [[0, 69], [4, 72], [6, 74], [8, 77]], [[0, 81], [8, 77], [12, 74]], [[0, 74], [6, 77], [8, 74], [12, 72]], [[0, 72], [8, 67], [12, 72]]],
  B: [[[0, 84], [8, 81], [12, 77]], [[0, 81], [4, 77], [8, 74]], [[0, 77], [8, 74], [12, 77]], [[0, 79], [4, 84], [8, 79]],
      [[0, 81], [6, 84], [8, 81], [12, 77]], [[0, 74], [8, 77], [12, 81]], [[0, 79], [6, 77], [8, 74]], [[0, 72], [8, 79]]],
};
// Harbour Pier, G major pentatonic (G A B D E) over G - Em - C - D: lazier steel-pan line with longer notes
const HARBOUR_MEL = {
  A: [[[0, 71], [6, 74], [8, 76], [12, 74]], [[0, 79], [8, 76]], [[0, 76], [6, 79], [10, 81]], [[0, 81], [8, 74]],
      [[0, 71], [6, 74], [8, 76], [12, 79]], [[0, 83], [8, 79], [12, 76]], [[0, 76], [8, 79]], [[0, 74], [8, 69]]],
  B: [[[0, 86], [8, 83]], [[0, 79], [6, 83], [8, 79]], [[0, 76], [8, 79], [12, 81]], [[0, 81], [8, 86]],
      [[0, 83], [8, 79], [12, 74]], [[0, 76], [6, 79], [10, 83]], [[0, 81], [8, 79], [12, 76]], [[0, 74], [8, 81]]],
};
// chords are voice-led triads (common tones held between bars); roots are the bass notes
// lvl: per-town loop gain, calibrated in the listen pass so the three loops sit within 1.5 dB RMS of each other
const TOWN_DEF = {
  picnic: { name: 'Picnic Park', style: 'picnic', bpm: 104, swing: 0.5, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], roots: [48, 45, 41, 43], mel: PICNIC_MEL, order: 'AABA', sting: [79, 84], lvl: 1 },
  market: { name: 'Market Street', style: 'market', bpm: 112, swing: 0.56, chords: [[53, 57, 60], [53, 57, 62], [53, 58, 62], [52, 55, 60]], roots: [41, 38, 46, 48], mel: MARKET_MEL, order: 'AABA', sting: [84, 89], lvl: 1.2 },
  harbour: { name: 'Harbour Pier', style: 'harbour', bpm: 96, swing: 0.54, chords: [[55, 59, 62], [55, 59, 64], [55, 60, 64], [54, 57, 62]], roots: [43, 40, 48, 50], mel: HARBOUR_MEL, order: 'AABA', sting: [86, 91], lvl: 1.04 },
};
export const TOWN_IDS = Object.keys(TOWN_DEF);
function normTown(t) {
  if (typeof t === 'number') return TOWN_IDS[clampI(t, 0, 2)];
  const s = String(t == null ? '' : t).toLowerCase();
  if (TOWN_DEF[s]) return s;
  if (s.startsWith('pic')) return 'picnic';
  if (s.startsWith('mar')) return 'market';
  if (s.startsWith('har')) return 'harbour';
  return null;
}
const MODES = ['play', 'card', 'title', 'map'];

// ------------------------------------------------------------------ bus events audio reacts to (GDD §13.3 + the Wednesday Sim contract)
// BUS_EVENTS are the sound-making logic events (modes.js records exactly these for the record-mode WAV). Where Sim sends
// both the brief's name and the GDD's name for one moment (gull + gullWarn, tier + cakeTier, course + courseDone), both
// are mapped and de-duplicated here, so either name alone also works.
export const BUS_EVENTS = ['start', 'bite', 'sizeUp', 'line', 'ticketDone', 'courseDone', 'course', 'padlock', 'bossNudge', 'bump', 'bossBite',
  'chain', 'sizzle', 'hot', 'lowTime', 'tick', 'gull', 'gullWarn', 'gullMiss', 'steal', 'nest', 'wobble', 'crack', 'refuse', 'shove', 'boil',
  'belt', 'truck', 'truckHorn', 'tier', 'cakeTier', 'spawn', 'feastWipe', 'feastCourse', 'feastTicket', 'boost', 'win', 'fail'];
// control events from game.js (subscribed by bindBus, not recorded: levelStart carries the whole level and world)
export const CTRL_EVENTS = ['levelStart', 'freezeContinue', 'boostEmpty'];
// sfx() also accepts the bus-event names and the GDD's loose names for the recipes below
const SFX_ALIAS = { refuse: 'lid', shove: 'lid', nest: 'plop', truck: 'horn', truckHorn: 'horn', cake: 'tier', cakeTier: 'tier', ticketDone: 'ticket',
  courseDone: 'orderUp', feastWipe: 'course', gull: 'gullSquawk', gullWarn: 'gullSquawk', tap: 'ui', click: 'ui', lose: 'fail', victory: 'win',
  levelUp: 'sizeUp', boostEmpty: 'nope', denied: 'nope', purchase: 'buy', shop: 'buy', streakStamp: 'streak', townChest: 'chest' };
// minimum seconds between two plays of the same id (rate limits from §8.3 plus anti-spam)
const MIN_GAP = { coin: 1 / 12, glug: 0.12, wobble: 0.2, sizzle: 0.08, ui: 0.03, bump: 0.07, lid: 0.22, tick: 0.2, crack: 0.05, horn: 0.4,
  gullSquawk: 0.3, plop: 0.1, boil: 0.2, nope: 0.25, buy: 0.3, course: 0.6, tier: 0.25, chest: 1, milestone: 1, streak: 0.4 };

// ------------------------------------------------------------------ bite buffer synthesis (JS, per context)
function synthBite(ctx, tier, idx, ing) {
  const sr = ctx.sampleRate, f = BASE_HZ[tier] * LADDER[idx], len = Math.floor(sr * 0.22);
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), rr = rng(7000 + tier * 31 + idx * 3 + (ing ? 1 : 0));
  const tau1 = 0.020 + tier * 0.004, tau2 = 0.011, w1 = 2 * Math.PI * f / sr, w2 = 2 * Math.PI * f * 2.76 / sr;
  // click: one-pole highpass (4 kHz) of white noise, 8 ms; crunch: RBJ bandpass 1.2 kHz Q2 of white noise, 50 ms
  const a = Math.exp(-2 * Math.PI * 4000 / sr);
  let hpY = 0, hpX = 0;
  const w0 = 2 * Math.PI * 1200 / sr, al = Math.sin(w0) / 4, a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const ws = 2 * Math.PI * f * 2 / sr, ws2 = ws * 2.76;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let v = 0.55 * Math.sin(w1 * i) * Math.exp(-t / tau1) + 0.19 * Math.sin(w2 * i) * Math.exp(-t / tau2);
    const nz = rr() * 2 - 1;
    const hp = a * (hpY + nz - hpX); hpY = hp; hpX = nz;
    v += 0.30 * hp * Math.exp(-t / 0.0028);
    const bp = b0 * nz + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = nz; y2 = y1; y1 = bp;
    v += 0.4 * 2.2 * bp * Math.exp(-t / 0.016);
    if (ing) v += 0.2 * Math.sin(ws * i) * Math.exp(-t / 0.05) + 0.05 * Math.sin(ws2 * i) * Math.exp(-t / 0.02);
    d[i] = v; const av = Math.abs(v); if (av > peak) peak = av;
  }
  const k = peak > 0 ? 0.85 / peak : 1, fade = Math.floor(sr * 0.012);
  for (let i = 0; i < len; i++) { let s = d[i] * k; if (i > len - fade) s *= (len - i) / fade; d[i] = s; }
  return buf;
}

// ------------------------------------------------------------------ engine (one per context)
function makeEngine(ctx, offline) {
  const r = rng(4242);
  const E = {
    ctx, offline: !!offline, base: 0, loop: null, musicOn: false, town: 'picnic', mode: 'play', tension: false, tensionUntil: 0,
    feast: false, musicV: 0.7, sfxV: 0.9, lastT: {}, biteNext: -1, coalesce: 0, bv: [], biteBufs: {}, beltOn: false, beltNext: 0,
    belt: null, beltWant: false, duckEnd: 0, wobbleAt: {}, onceAt: {}, servedAt: -1e9, gateTarget: offline ? 1 : 0, openAt: 0,
    st: { bites: 0, bitesPlayed: 0, bitesDropped: 0, bitesStolen: 0, voicesStolen: 0, peakVoices: 0, sfxPlayed: 0, ids: {} },
  };
  const now = () => E.base;
  E.clock = () => (offline ? E.base : ctx.currentTime);
  E.lead = () => Math.max(ctx.currentTime + 0.003, E.openAt);

  // shared 1 s white-noise buffer + short reverb impulse (both seeded: offline renders are deterministic)
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.1), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch), n = d.length;
    let y = 0;
    for (let i = 0; i < n; i++) { const x = i / n; y += ((r() * 2 - 1) - y) * 0.45; d[i] = y * Math.pow(1 - x, 3) * (i < 160 ? i / 160 : 1); }
  }

  // graph
  const G = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const gate = G(offline ? 1 : 0); gate.connect(ctx.destination);
  const clip = ctx.createWaveShaper(); clip.curve = CLIP_CURVE; clip.oversample = '2x'; clip.connect(gate);
  const pre = G(0.5); pre.connect(clip);
  const lift = G(LIFT); lift.connect(pre);
  let comp;
  if (FIREFOX) comp = G(FF_GAIN); // Firefox's compressor squashes short blips; a fixed gain stands in there
  else {
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003;
    comp.release.value = 0; comp.release.setValueAtTime(0.15, WARM_S); // start-up envelope recovers instantly (see DECISION at the top)
  }
  comp.connect(lift);
  const master = G(MASTER); master.connect(comp);
  const verb = ctx.createConvolver(); verb.buffer = ir;
  const verbOut = G(0.8); verb.connect(verbOut); verbOut.connect(master);
  const musicBus = G(E.musicV * MUSIC_K); musicBus.connect(master);
  const mSend = G(0.18); musicBus.connect(mSend); mSend.connect(verb);
  const duck = G(1); duck.connect(musicBus);
  const modeG = G(1); modeG.connect(duck);
  const mIn = G(1); mIn.connect(modeG);
  const sfxBus = G(E.sfxV * SFX_K); sfxBus.connect(master);
  const sSend = G(0.1); sfxBus.connect(sSend); sSend.connect(verb);
  const sfxIn = G(1); sfxIn.connect(sfxBus);
  const biteBus = G(0.55); biteBus.connect(sfxIn);
  E.gate = gate; E.master = master; E.duck = duck;
  E.analyser = () => { if (!E.an) { E.an = ctx.createAnalyser(); E.an.fftSize = 2048; E.an.smoothingTimeConstant = 0; gate.connect(E.an); } return E.an; };

  // Volume changes: a short setTargetAtTime while the clock runs; a plain value set otherwise. (setTargetAtTime issued on a context that
  // has not started yet made the bus fade in from 0 over ~100 ms, eating the first sounds after the first tap: measured in test.mjs.)
  const setBus = (p, x) => {
    if (offline || ctx.state !== 'running') { p.cancelScheduledValues(0); p.value = x; }
    else { p.cancelScheduledValues(ctx.currentTime); p.setTargetAtTime(x, ctx.currentTime, 0.03); }
  };
  E.setMusic = v => { E.musicV = v; setBus(musicBus.gain, Math.max(0, v) * MUSIC_K); };
  E.setSfx = v => { E.sfxV = v; setBus(sfxBus.gain, Math.max(0, v) * SFX_K); };
  E.setGate = on => {
    const target = on ? 1 : 0;
    if (offline || E.gateTarget === target) return;
    E.gateTarget = target;
    const p = gate.gain, t = ctx.currentTime;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + (on ? OPEN_S : 0.025));
    if (on) E.openAt = t + OPEN_S + 0.001; // live sfx are scheduled no earlier than this, so the first sound after an open is not eaten by the ramp
  };

  // ---------------------------------------------------------------- helpers
  let voices = [];
  function track(srcs, out, end) { // global SFX voice cap: drop the oldest voice
    const t = now();
    voices = voices.filter(v => v.end > t);
    voices.push({ srcs, out, end });
    if (voices.length > E.st.peakVoices) E.st.peakVoices = voices.length;
    while (voices.length > MAX_VOICES) {
      const v = voices.shift();
      E.st.voicesStolen++;
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
  function osc(type, f, c) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (c) o.detune.value = c; return o; }
  // o: a attack, lp, bp [f, q], vib [Hz, cents], am [Hz, depth 0..1], glide s, dest
  function tone(type, f0, f1, dur, vol, delay = 0, o = {}) {
    const t = now() + delay, a = o.a || 0.004;
    const s = ctx.createOscillator(), g = ctx.createGain(), srcs = [s];
    s.type = type;
    s.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) s.frequency.exponentialRampToValueAtTime(f1, t + (o.glide || dur));
    env(g.gain, t, a, vol, dur);
    let n = s;
    if (o.lp) { const f = filt('lowpass', o.lp); n.connect(f); n = f; }
    if (o.bp) { const f = filt('bandpass', o.bp[0], o.bp[1]); n.connect(f); n = f; }
    if (o.vib) { const l = osc('sine', o.vib[0]), lg = G(o.vib[1]); l.connect(lg).connect(s.detune); l.start(t); l.stop(t + a + dur + 0.05); srcs.push(l); }
    if (o.am) { const am = G(1 - o.am[1] / 2), l = osc('sine', o.am[0]), lg = G(o.am[1] / 2); l.connect(lg).connect(am.gain); n.connect(am); n = am; l.start(t); l.stop(t + a + dur + 0.05); srcs.push(l); }
    n.connect(g); g.connect(o.dest || sfxIn);
    s.start(t); s.stop(t + a + dur + 0.05);
    track(srcs, g, t + a + dur + 0.05);
  }
  function noise(dur, f0, f1, q, vol, delay = 0, type = 'bandpass', o = {}) {
    const t = now() + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = filt(type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(), a = o.a != null ? o.a : dur * 0.25, srcs = [s];
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.max(0.002, a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
    let n = f;
    s.connect(f);
    if (o.am) { const am = G(1 - o.am[1] / 2), l = osc('sine', o.am[0]), lg = G(o.am[1] / 2); l.connect(lg).connect(am.gain); n.connect(am); n = am; l.start(t); l.stop(t + dur + 0.05); srcs.push(l); }
    n.connect(g); g.connect(o.dest || sfxIn);
    s.start(t, r() * 0.6); s.stop(t + dur + 0.05);
    track(srcs, g, t + dur + 0.05);
  }
  function bell(f, dur, vol, delay = 0, o = {}) { // sine f + partial (default 2.76 f at 0.3)
    const t = now() + delay, out = G(1), ratio = o.ratio || 2.76, pv = o.pv != null ? o.pv : 0.3;
    out.connect(o.dest || sfxIn);
    const o1 = osc('sine', f), o2 = osc('sine', f * ratio), g1 = ctx.createGain(), g2 = ctx.createGain();
    env(g1.gain, t, 0.004, vol, dur); env(g2.gain, t, 0.002, vol * pv, dur * (o.pd || 0.45));
    o1.connect(g1).connect(out); o2.connect(g2).connect(out);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.06); o2.stop(t + dur + 0.06);
    track([o1, o2], out, t + dur + 0.06);
  }
  function duckMusic(len) { // music to 45 % (attack 50 ms), release 600 ms after len
    const p = duck.gain, t = now(), end = Math.max(E.duckEnd, t + len);
    E.duckEnd = end;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.45, t, 0.05 / 3);
    p.setTargetAtTime(1, end, 0.6 / 3);
  }
  E.later = (d, f) => { const b = E.base; E.base = b + d; try { f(); } finally { E.base = b; } };
  const later = E.later;

  // ---------------------------------------------------------------- music instruments (absolute time t, destination d)
  const I = {
    uke(t, m, v, d, dec = 0.18) { // triangle + 2 kHz lowpass, A 2 ms / D 180 ms
      const o = osc('triangle', mtof(m)), lp = filt('lowpass', 2000), g = ctx.createGain();
      env(g.gain, t, 0.002, v, dec); o.connect(lp).connect(g).connect(d); o.start(t); o.stop(t + dec + 0.06);
    },
    glock(t, m, v, d, dec = 0.6) { // sine f + sine 2.76f (0.3)
      const f = mtof(m), o1 = osc('sine', f), o2 = osc('sine', f * 2.76), g1 = ctx.createGain(), g2 = ctx.createGain();
      env(g1.gain, t, 0.003, v, dec); env(g2.gain, t, 0.002, v * 0.3, dec * 0.4);
      o1.connect(g1).connect(d); o2.connect(g2).connect(d);
      o1.start(t); o2.start(t); o1.stop(t + dec + 0.06); o2.stop(t + dec + 0.06);
    },
    bass(t, m, v, d, dec = 0.34, sq = 0.1) { // sine + 10 % square
      const f = mtof(m), o1 = osc('sine', f), o2 = osc('square', f), g = ctx.createGain(), sg = G(sq), lp = filt('lowpass', 600);
      env(g.gain, t, 0.006, v * BASS_K, dec);
      o1.connect(g); o2.connect(sg).connect(lp).connect(g); g.connect(d);
      o1.start(t); o2.start(t); o1.stop(t + dec + 0.06); o2.stop(t + dec + 0.06);
    },
    noiseHit(t, len, type, f, q, v, d, a = 0.002) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const fl = filt(type, f, q), g = ctx.createGain();
      env(g.gain, t, a, v, len);
      s.connect(fl).connect(g).connect(d); s.start(t, r() * 0.8); s.stop(t + len + a + 0.03);
    },
    shaker(t, v, d) { I.noiseHit(t, 0.04, 'bandpass', 6000, 1, v, d, 0.004); }, // bandpassed noise 6 kHz Q1
    pad(t, ms, dur, v, d) { // soft sustained chord (title only)
      const g = ctx.createGain(), lp = filt('lowpass', 900), end = t + dur + 0.8;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.5); g.gain.setValueAtTime(v, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, end);
      lp.connect(g); g.connect(d);
      for (const m of ms) for (const c of [-6, 6]) { const o = osc('triangle', mtof(m), c), og = G(0.5); o.connect(og).connect(lp); o.start(t); o.stop(end + 0.05); }
    },
    accordion(t, ms, dur, v, d) { // 2 detuned saws (±7 cents) per note, lowpass 1.8 kHz, 5 Hz tremolo
      const lp = filt('lowpass', 1800, 0.6), g = ctx.createGain(), am = G(0.78), lfo = osc('sine', 5), lg = G(0.22), end = t + dur, os = [lfo];
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.03); g.gain.setValueAtTime(v, Math.max(t + 0.04, end - 0.06)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
      lfo.connect(lg).connect(am.gain);
      lp.connect(am).connect(g).connect(d);
      for (const m of ms) for (const c of [-7, 7]) { const o = osc('sawtooth', mtof(m), c), og = G(0.3); o.connect(og).connect(lp); os.push(o); }
      for (const o of os) { o.start(t); o.stop(end + 0.1); }
    },
    pizz(t, m, v, d) { // square through 1.2 kHz lowpass, D 120 ms
      const o = osc('square', mtof(m)), lp = filt('lowpass', 1200), g = ctx.createGain();
      env(g.gain, t, 0.002, v, 0.12); o.connect(lp).connect(g).connect(d); o.start(t); o.stop(t + 0.18);
    },
    tuba(t, m, v, d, dec = 0.3) { // sine + 2nd harmonic
      const f = mtof(m), o1 = osc('sine', f), o2 = osc('sine', f * 2), g = ctx.createGain(), g2 = G(0.4);
      env(g.gain, t, 0.01, v * BASS_K, dec); o1.connect(g); o2.connect(g2).connect(g); g.connect(d);
      o1.start(t); o2.start(t); o1.stop(t + dec + 0.06); o2.stop(t + dec + 0.06);
    },
    clap(t, v, d) { I.noiseHit(t, 0.09, 'bandpass', 1500, 1.2, v, d, 0.003); },
    steel(t, m, v, d) { // sine f + 2f (0.4) + 3.01f (0.15), A 3 ms / D 450 ms
      const f = mtof(m), g = ctx.createGain(), os = [[1, 1], [2, 0.4], [3.01, 0.15]];
      env(g.gain, t, 0.003, v, 0.45); g.connect(d);
      for (const [k, a] of os) { const o = osc('sine', f * k), og = G(a); o.connect(og).connect(g); o.start(t); o.stop(t + 0.52); }
    },
    marimba(t, m, v, d) { // sine + sine 4f (0.12), D 250 ms
      const f = mtof(m), o1 = osc('sine', f), o2 = osc('sine', f * 4), g = ctx.createGain(), g2 = G(0.12);
      env(g.gain, t, 0.002, v, 0.25); o1.connect(g); o2.connect(g2).connect(g); g.connect(d);
      o1.start(t); o2.start(t); o1.stop(t + 0.32); o2.stop(t + 0.32);
    },
  };

  // ---------------------------------------------------------------- SFX recipes (GDD §8.3)
  const S = E.sfx = {
    bite(o = {}) {
      const tier = clampI(o.tier, 0, 4), n = Math.max(1, (o.n | 0) || 1), ing = !!o.ing;
      E.st.bites++;
      const t0 = now();
      let t = t0;
      if (t0 < E.biteNext) {
        if (E.biteNext - t0 <= BITE_MAX_LAG) t = E.biteNext;       // roll into the next 45 ms slot
        else { E.coalesce = Math.min(4, E.coalesce + 2); E.st.bitesDropped++; return; } // coalesce into the next played bite
      }
      E.biteNext = t + BITE_GAP;
      const db = Math.min(3, Math.floor((n - 1) / 8)) + E.coalesce;
      E.coalesce = 0;
      E.bv = E.bv.filter(v => v.end > t);
      while (E.bv.length >= BITE_VOICES) {
        const v = E.bv.shift();
        E.st.bitesStolen++;
        try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.004); v.src.stop(t + 0.03); } catch {}
      }
      const idx = (n - 1) & 7, key = tier * 16 + idx * 2 + (ing ? 1 : 0);
      const buf = E.biteBufs[key] || (E.biteBufs[key] = synthBite(ctx, tier, idx, ing));
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = 1 + (r() - 0.5) * 0.012;
      g.gain.value = dbLin(db);
      src.connect(g); g.connect(biteBus);
      src.start(t);
      src.onended = () => { try { src.disconnect(); g.disconnect(); } catch {} };
      E.bv.push({ src, g, end: t + buf.duration });
      if (E.bv.length > E.st.peakVoices) E.st.peakVoices = E.bv.length;
      E.st.bitesPlayed++;
    },
    glug(o = {}) { // sine 140→70 over 0.25 s + 3 lowpassed noise bubbles 60 ms apart
      const k = o.k || 1, v = o.vol != null ? o.vol : 1;
      tone('sine', 140, 70, 0.25 * k, 0.55 * v, 0, { a: 0.01 });
      for (let i = 0; i < 3; i++) noise(0.07 * k, 520 - i * 70, 260, 1.4, 0.26 * v, i * 0.06 * k, 'lowpass', { a: 0.012 });
    },
    sizeUp() {
      [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.16, 0.22, i * 0.05, { lp: 3400 }));
      noise(0.3, 800, 3000, 1.2, 0.2, 0, 'bandpass', { a: 0.1 });
    },
    line() { noise(0.015, 3000, 3000, 1.5, 0.16, 0, 'bandpass', { a: 0.002 }); bell(784, 0.55, 0.15, 0.02); bell(1046, 0.7, 0.15, 0.11); },
    ticket() { [1046, 1318, 1568].forEach((f, i) => bell(f, 0.6, 0.14, i * 0.075)); noise(0.15, 2000, 2000, 1, 0.12, 0.04, 'bandpass', { a: 0.04 }); },
    padlock() {
      tone('square', 2400, 2400, 0.01, 0.12, 0, { a: 0.001 }); noise(0.02, 6000, 6000, 1, 0.2, 0, 'highpass', { a: 0.001 });
      tone('sine', 1568, 1568, 0.4, 0.12, 0.05, { a: 0.01 }); tone('sine', 2093, 2093, 0.4, 0.09, 0.07, { a: 0.01 });
      // DECISION (11-14, C1): boss-open stinger on top of the click: low thump, bright rising triad, short duck so it lands.
      tone('sine', 110, 52, 0.28, 0.5, 0.02, { a: 0.004 });
      [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.17, 0.12 + i * 0.06, { lp: 3600 }));
      noise(0.22, 700, 4200, 1.1, 0.14, 0.1, 'bandpass', { a: 0.08 });
      duckMusic(0.9);
    },
    bossNudge() { for (let i = 0; i < 3; i++) { tone('square', 1800, 1800, 0.012, 0.11, i * 0.05, { a: 0.001 }); noise(0.012, 5000, 5000, 1, 0.07, i * 0.05, 'highpass', { a: 0.001 }); } },
    bump() { tone('sine', 180, 110, 0.07, 0.45, 0, { a: 0.002 }); noise(0.03, 600, 600, 1, 0.22, 0, 'bandpass', { a: 0.002 }); },
    bossBite() { // big glug (x1.8), low drum, rising choir pad
      S.glug({ k: 1.8, vol: 1.15 });
      tone('sine', 70, 42, 0.4, 0.55, 0.03, { a: 0.008 });
      [196, 247, 294].forEach((f, i) => tone('sawtooth', f * 0.75, f, 0.8, 0.05, 0.1 + i * 0.02, { a: 0.25, lp: 900 }));
      duckMusic(1.6);
    },
    orderUp() { // service bell: sine 2093 + 5.4f (0.25), 1.2 s decay, struck twice 0.18 s apart
      bell(2093, 1.2, 0.28, 0, { ratio: 5.4, pv: 0.25, pd: 0.6 }); bell(2093, 1.2, 0.28, 0.18, { ratio: 5.4, pv: 0.25, pd: 0.6 });
      duckMusic(1.2);
    },
    stamp() { tone('sine', 90, 55, 0.09, 0.6, 0, { a: 0.002 }); noise(0.045, 1000, 1000, 0.8, 0.24, 0.01, 'bandpass', { a: 0.002 }); },
    chain(o = {}) { // ding x2 at the current ladder pitch
      const n = Math.max(1, (o.n | 0) || 5), f = 660 * LADDER[(n - 1) & 7];
      tone('sine', f, f, 0.15, 0.16, 0, { a: 0.003 }); tone('sine', f, f, 0.15, 0.13, 0.09, { a: 0.003 });
    },
    sizzle() { // frying noise through a 40 Hz random gate + "+1" pop
      // DECISION: band 1.8-4 kHz (24 dB/oct above 4 kHz) instead of a bare 3 kHz highpass: the listen pass measured 81 % of
      // the old sizzle's energy above 4 kHz (hissy, the one shrill sound in the set); this keeps the frying texture, soft.
      const t = now(), s = ctx.createBufferSource(), hp = filt('highpass', 1800, 0.7), lp = filt('lowpass', 4000, 0.7), lp2 = filt('lowpass', 4000, 0.7), g = ctx.createGain();
      s.buffer = noiseBuf; g.gain.setValueAtTime(0, t);
      for (let k = 0; k < 14; k++) g.gain.setValueAtTime(r() < 0.65 ? (0.07 + r() * 0.1) * (1 - k / 18) : 0, t + k * 0.025);
      g.gain.setValueAtTime(0, t + 0.35);
      s.connect(hp).connect(lp).connect(lp2).connect(g).connect(sfxIn); s.start(t, r() * 0.6); s.stop(t + 0.37);
      track([s], g, t + 0.37);
      tone('sine', 1320, 1320, 0.04, 0.16, 0, { a: 0.002 });
    },
    gullSquawk() { for (let i = 0; i < 2; i++) tone('sawtooth', 900, 650, 0.12, 0.3, i * 0.16, { a: 0.01, bp: [1500, 1.2], vib: [18, 150] }); },
    gullMiss() { // rising whistle 800 -> 1600 + sparkle C6 E6 G6 + the +1 coin tick
      tone('sine', 800, 1600, 0.2, 0.13, 0, { a: 0.01 });
      [1046, 1318, 1568].forEach((f, i) => bell(f, 0.45, 0.085, 0.16 + i * 0.05));
      tone('sine', 1568, 1568, 0.05, 0.09, 0.34, { a: 0.002 }); tone('sine', 2093, 2093, 0.07, 0.08, 0.375, { a: 0.002 });
    },
    steal() { for (let i = 0; i < 3; i++) noise(0.05, 400, 400, 1.2, 0.2, i * 0.06, 'bandpass', { a: 0.01 }); tone('sine', 700, 300, 0.3, 0.12, 0.05, { a: 0.02 }); },
    plop() { // nest drop: soft plop + a smaller bounce + twig rustle
      tone('sine', 300, 190, 0.05, 0.3, 0, { a: 0.002 });
      tone('sine', 330, 230, 0.035, 0.15, 0.11, { a: 0.002 });
      noise(0.12, 2600, 1800, 1.4, 0.06, 0.02, 'bandpass', { a: 0.01 }); noise(0.08, 3200, 2200, 1.4, 0.04, 0.13, 'bandpass', { a: 0.01 });
    },
    crack() { // porcelain: body clunk + 4 soft pings 2.5-3.8 kHz 15 ms apart + noise 5 kHz 60 ms + shards settling
      tone('sine', 520, 300, 0.07, 0.2, 0, { a: 0.001 }); noise(0.05, 1800, 900, 1.2, 0.15, 0, 'bandpass', { a: 0.001 });
      for (let i = 0; i < 4; i++) { const f = 2500 + r() * 1300; tone('sine', f, f * 0.995, 0.14, 0.07, 0.01 + i * 0.015, { a: 0.001 }); }
      noise(0.06, 5000, 5000, 1, 0.09, 0, 'highpass', { a: 0.001 });
      for (let i = 0; i < 3; i++) { const f = 2600 + r() * 1000; tone('sine', f, f, 0.06, 0.03, 0.13 + i * 0.05 + r() * 0.03, { a: 0.001 }); }
    },
    wobble(o = {}) { // teacup rattle: sine 1.2 kHz + a 1.51x partial, both with 22 Hz AM, 0.3 s; contact = a little louder
      const v = o.contact ? 1.25 : 1;
      tone('sine', 1200, 1180, 0.3, 0.15 * v, 0, { a: 0.01, am: [22, 1] });
      tone('sine', 1810, 1790, 0.22, 0.05 * v, 0.01, { a: 0.01, am: [22, 1] });
    },
    lid() { // pot-lid clink (sine 1100 + 2.4f) that rattles to rest: 3 clinks, each softer
      [[0, 1, 1], [0.075, 0.6, 1.012], [0.125, 0.38, 0.992]].forEach(([d, k, m]) => {
        const f = 1100 * m;
        tone('sine', f, f, 0.12, 0.15 * k, d, { a: 0.002 }); tone('sine', f * 2.4, f * 2.4, 0.07, 0.065 * k, d, { a: 0.002 });
      });
      noise(0.02, 3000, 3000, 1.2, 0.05, 0, 'bandpass', { a: 0.001 });
    },
    boil() { // bubbling burst: lowpass noise 600 Hz with 12 Hz AM + 5 bubble blips
      noise(0.32, 600, 600, 0.8, 0.9, 0, 'lowpass', { a: 0.04, am: [12, 1] });
      for (let i = 0; i < 5; i++) { const f = 220 + r() * 260; tone('sine', f, f * 1.8, 0.035, 0.09, 0.03 + i * 0.06 + r() * 0.02, { a: 0.003 }); }
    },
    tick(o = {}) { // wood block; the last two seconds a little higher
      const f = (o.s | 0) > 0 && (o.s | 0) <= 2 ? 1250 : 1000;
      tone('sine', f, f * 0.9, 0.028, 0.22, 0, { a: 0.001 }); noise(0.01, 2400, 2400, 1.5, 0.08, 0, 'bandpass', { a: 0.001 });
    },
    lowTime() { for (let i = 0; i < 2; i++) { tone('sine', 1250, 1130, 0.03, 0.2, i * 0.11, { a: 0.001 }); noise(0.01, 2400, 2400, 1.5, 0.08, i * 0.11, 'bandpass', { a: 0.001 }); } },
    belt(o = {}) { E.beltWant = o.on !== false; E.applyBelt(); },
    horn() { // toy food truck "meep meep" (A4 + C#5 dyad through a lowpass) + wind-up ratchet
      for (let b = 0; b < 2; b++) {
        const d = b * 0.17;
        tone('square', 440, 440, 0.11, 0.05, d, { a: 0.008, lp: 1400 }); tone('square', 554, 554, 0.11, 0.045, d, { a: 0.008, lp: 1400 });
        tone('sine', 440, 440, 0.11, 0.06, d, { a: 0.008 });
      }
      for (let i = 0; i < 4; i++) noise(0.012, 2500, 2500, 2, 0.05, 0.36 + i * 0.035, 'bandpass', { a: 0.001 });
    },
    tier(o = {}) { // a cake tier eaten: medium glug + drum + frosting squish + rising sparkle (higher each tier)
      const k = clampI(o.k != null ? o.k : o.tier, 0, 3), f = [784, 880, 988, 1046][k];
      S.glug({ k: 1.25, vol: 0.9 });
      tone('sine', 95, 58, 0.26, 0.42, 0.02, { a: 0.005 });
      noise(0.16, 1100, 380, 1.1, 0.14, 0.04, 'lowpass', { a: 0.02 });
      [1, 5 / 4, 3 / 2].forEach((m, i) => bell(f * m, 0.55, 0.11, 0.12 + i * 0.06));
      duckMusic(0.9);
    },
    course() { // course swap: steam whoosh + paper unfold + rising bell G5 -> C6
      noise(0.5, 700, 2400, 0.9, 0.13, 0, 'bandpass', { a: 0.18 });
      noise(0.06, 2200, 2200, 1, 0.08, 0.14, 'bandpass', { a: 0.01 }); noise(0.08, 1800, 1800, 1, 0.07, 0.22, 'bandpass', { a: 0.01 });
      bell(784, 0.5, 0.13, 0.28); bell(1046, 0.7, 0.14, 0.4);
    },
    boost(o = {}) {
      const k = o.kind;
      if (k === 'freeze') { [2349, 3136, 3951].forEach((f, i) => bell(f, 0.7, 0.09, i * 0.06)); noise(0.3, 6000, 6000, 1, 0.05, 0, 'highpass', { a: 0.05 }); }
      else if (k === 'mega') { S.sizeUp(); tone('sine', 110, 55, 0.4, 0.3, 0, { a: 0.02 }); }
      else { tone('sine', 400, 900, 0.3, 0.16, 0, { a: 0.02 }); noise(0.3, 500, 2200, 1.2, 0.14, 0, 'bandpass', { a: 0.08 }); } // magnet (default)
    },
    win(o = {}) { // ukulele strum C-G-C6 + glock sparkle; town-flavoured top note; star bells
      const stars = o.stars != null ? clampI(o.stars, 0, 3) : 3, town = normTown(o.town) || E.town, t = now();
      [523, 784, 1046].forEach((f, i) => { tone('triangle', f, f, 0.45, 0.2, i * 0.045, { a: 0.002, lp: 2600 }); tone('sine', f * 2, f * 2, 0.15, 0.04, i * 0.045); });
      [1318, 1568, 2093].forEach((f, i) => bell(f, 0.8, 0.11, 0.26 + i * 0.08));
      if (town === 'market') I.accordion(t + 0.14, [72, 76, 79], 0.9, 0.07, sfxIn);
      else if (town === 'harbour') { I.steel(t + 0.14, 84, 0.13, sfxIn); I.steel(t + 0.3, 91, 0.1, sfxIn); }
      for (let i = 0; i < stars; i++) S.star({ i, delay: 0.95 + 0.28 * i });
      duckMusic(2.6);
    },
    star(o = {}) {
      const i = clampI(o.i, 0, 2), d = o.delay || 0;
      bell([784, 988, 1175][i], 0.9, 0.16, d); bell([1568, 1976, 2349][i], 0.35, 0.04, d + 0.02);
      if (i === 2) [2637, 3136, 3951].forEach((f, k) => bell(f, 0.3, 0.03, d + 0.08 + k * 0.04));
    },
    fail() { // gentle descending trombone-lite G4 F#4 F4 E4
      [392, 370, 349, 330].forEach((f, i) => tone('triangle', f, f * 0.965, i === 3 ? 0.5 : 0.22, 0.2, i * 0.2, { a: 0.015, lp: 1700 }));
      duckMusic(1.6);
    },
    coin() { tone('sine', 1568, 1568, 0.05, 0.13, 0, { a: 0.002 }); tone('sine', 2093, 2093, 0.07, 0.13, 0.035, { a: 0.002 }); },
    ui() { tone('sine', 600, 560, 0.022, 0.16, 0, { a: 0.001 }); noise(0.008, 3000, 3000, 1, 0.05, 0, 'bandpass', { a: 0.001 }); },
    gift() { [1046, 1318, 1568, 2093].forEach((f, i) => bell(f, 0.8, 0.12, i * 0.08)); noise(0.5, 8000, 8000, 1, 0.04, 0.2, 'highpass', { a: 0.15 }); duckMusic(1.4); },
    chest() { // town chest: creak + lid thunk + coin shower + shimmer bells
      tone('sawtooth', 170, 250, 0.34, 0.035, 0, { a: 0.06, bp: [900, 4], vib: [11, 40] });
      tone('sine', 120, 68, 0.1, 0.42, 0.38, { a: 0.002 }); noise(0.04, 700, 700, 1, 0.16, 0.38, 'bandpass', { a: 0.002 });
      for (let i = 0; i < 8; i++) { const f = 1568 * (1 + r() * 0.34), d = 0.46 + i * 0.06 + r() * 0.02; tone('sine', f, f, 0.05, 0.07, d, { a: 0.002 }); tone('sine', f * 1.335, f * 1.335, 0.06, 0.045, d + 0.03, { a: 0.002 }); }
      [1046, 1318, 1568, 2093].forEach((f, i) => bell(f, 0.8, 0.09, 0.5 + i * 0.07));
      noise(0.6, 8000, 8000, 1, 0.035, 0.5, 'highpass', { a: 0.2 });
      duckMusic(1.8);
    },
    milestone() { // every 15 stars: glock arpeggio C5..E6 + warm triangle chord + shimmer
      [523, 659, 784, 1046, 1318].forEach((f, i) => bell(f, 0.7, 0.11, i * 0.07));
      [262, 330, 392].forEach(f => tone('triangle', f, f, 0.9, 0.07, 0.3, { a: 0.06, lp: 1500 }));
      noise(0.6, 8000, 8000, 1, 0.03, 0.3, 'highpass', { a: 0.2 });
      duckMusic(1.6);
    },
    streak(o = {}) { // streak ladder stamp: thunk + ink squish + a ding that rises with the day (1..7); day 7 adds a fanfare
      const day = clampI(o.day || 1, 1, 7), f = [784, 880, 988, 1046, 1175, 1318, 1568][day - 1];
      tone('sine', 95, 55, 0.1, 0.6, 0, { a: 0.002 }); noise(0.05, 1000, 1000, 0.8, 0.22, 0.008, 'bandpass', { a: 0.002 });
      noise(0.13, 800, 300, 1.2, 0.1, 0.04, 'lowpass', { a: 0.02 });
      bell(f, 0.8, 0.14, 0.16); bell(f * 2, 0.35, 0.035, 0.18);
      if (day === 7) [1046, 1318, 1568, 2093].forEach((g, i) => bell(g, 0.8, 0.09, 0.42 + i * 0.08));
      duckMusic(day === 7 ? 1.6 : 1);
    },
    buy() { // shop buy: drawer slide + thunk + ka-ching (E6 -> A6) + coin clinks
      noise(0.18, 420, 950, 1.3, 0.12, 0, 'bandpass', { a: 0.05 });
      tone('sine', 115, 70, 0.07, 0.4, 0.17, { a: 0.002 }); noise(0.03, 800, 800, 1, 0.12, 0.17, 'bandpass', { a: 0.002 });
      bell(1318, 0.35, 0.12, 0.22); bell(1760, 0.9, 0.13, 0.3);
      for (let i = 0; i < 3; i++) { tone('sine', 1568, 1568, 0.04, 0.06, 0.45 + i * 0.07, { a: 0.002 }); tone('sine', 2093, 2093, 0.05, 0.05, 0.48 + i * 0.07, { a: 0.002 }); }
    },
    nope() { // soft "can't": two low notes E4 -> C4, never a buzzer
      tone('triangle', 330, 322, 0.1, 0.15, 0, { a: 0.006, lp: 1200 }); tone('triangle', 262, 255, 0.16, 0.15, 0.12, { a: 0.006, lp: 1200 });
    },
  };
  E.play = (id, o) => {
    id = SFX_ALIAS[id] || id;
    const f = S[id];
    if (!f) return false;
    const gap = MIN_GAP[id];
    if (gap) { const t = now(); if (t - (E.lastT[id] != null ? E.lastT[id] : -1e9) < gap) return false; E.lastT[id] = t; }
    E.st.sfxPlayed++; E.st.ids[id] = (E.st.ids[id] || 0) + 1;
    f(o || {});
    return true;
  };

  // ambient belt hum (loop) with 0.25 s ticks driven by the pump.
  // DECISION (Wed): the belt hums only while the pot is on a belt (bus belt {on}) AND the mode is 'play': a card, the map
  //   or the title silence it, and it comes back by itself when play resumes on the belt. levelStart / win / fail clear
  //   the wish. 55 Hz alone is inaudible on phone speakers, so the hum adds 110 / 165 Hz harmonics (same 0.08 gain).
  E.applyBelt = () => {
    const on = !!E.beltWant && E.mode === 'play', t = now();
    if (on && !E.beltOn) {
      const g = ctx.createGain(), lp = filt('lowpass', 400, 0.6), os = [];
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.08, t + 0.15);
      for (const [f, a] of [[55, 1], [110, 0.55], [165, 0.25]]) { const o = osc('sine', f), og = G(a); o.connect(og).connect(lp); o.start(t); os.push(o); }
      lp.connect(g).connect(sfxIn);
      E.belt = { os, g }; E.beltOn = true; E.beltNext = t;
    } else if (!on && E.beltOn) {
      const b = E.belt; E.belt = null; E.beltOn = false;
      b.g.gain.cancelScheduledValues(t); b.g.gain.setTargetAtTime(0, t, 0.05);
      for (const o of b.os) try { o.stop(t + 0.4); } catch {}
    }
  };
  E.setBelt = on => { E.beltWant = !!on; E.applyBelt(); };

  // ---------------------------------------------------------------- music loop + scheduler
  function startLoop(town, t, fade) {
    const def = TOWN_DEF[town], out = ctx.createGain(), beds = [];
    out.gain.setValueAtTime(0.0001, t);
    out.gain.setTargetAtTime(def.lvl || 1, t, fade / 3);
    out.connect(mIn);
    if (def.style === 'harbour') { // waves: looped lowpassed noise, LFO 0.12 Hz on the gain (0.02–0.06)
      const s = ctx.createBufferSource(), lp = filt('lowpass', 500, 0.5), wg = G(0.04), lfo = osc('sine', 0.12), lg = G(0.02);
      s.buffer = noiseBuf; s.loop = true; lfo.connect(lg).connect(wg.gain);
      s.connect(lp).connect(wg).connect(out); s.start(t, r() * 0.5); lfo.start(t); beds.push(s, lfo);
    }
    return { town, def, out, beds, step: 0, nextT: t + 0.03 };
  }
  function stopLoop(L, t, fade) {
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setTargetAtTime(0, t, fade / 4);
    for (const b of L.beds) try { b.stop(t + fade + 0.1); } catch {}
    if (!offline) setTimeout(() => { try { L.out.disconnect(); } catch {} }, (fade + 2.5) * 1000);
  }
  function stepDur(d) { return 60 / (d.bpm * (E.feast ? 1.06 : 1)) / 4; }
  const PAT_A = [0, 1, 2, 3, 2, 1, 2, 1], PAT_B = [0, 2, 1, 2, 3, 2, 1, 2];
  function tom(t, v, d) { // soft floor tom for the Feast layer: sine 150 -> 90 Hz, 0.18 s
    const o = osc('sine', 150), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.16);
    env(g.gain, t, 0.003, v, 0.18); o.connect(g).connect(d); o.start(t); o.stop(t + 0.25);
  }
  function schedStep(L, s, t) {
    const d = L.def, out = L.out, bar = (s >> 4) & 7, sub = s & 15, sd = stepDur(d), beat = sd * 4;
    const tens = E.tension || t < E.tensionUntil, title = E.mode === 'title', feast = E.feast && !title;
    const tt = d.swing > 0.5 && (sub & 3) === 2 ? t + (d.swing - 0.5) * beat : t;
    const ci = bar & 3, ch = d.chords[ci], root = d.roots[ci];
    const vari = (feast ? 'ABAB' : d.order)[(s >> 7) & 3], mel = d.mel[vari][bar];
    const lead = d.style === 'picnic' ? (t2, m) => I.glock(t2, m, 0.2, out, 0.6)
      : d.style === 'market' ? (t2, m) => I.pizz(t2, m, 0.17, out)
        : (t2, m) => I.steel(t2, m, 0.17, out);
    if (!tens) {
      for (const [st, m] of mel) if (st === sub) lead(tt, m);
      if (vari === 'B' && bar === 7 && (sub === 12 || sub === 14)) I.glock(tt, d.sting[sub === 12 ? 0 : 1], 0.13, out, 0.7); // family sting
    }
    if (title) { if (sub === 0 && (bar & 1) === 0) I.pad(t, ch, beat * 8 - 0.1, 0.05, out); return; }
    const pickup = sub === 14 && (bar & 3) === 3; // family bass pickup into the next phrase
    if (d.style === 'picnic') {
      if ((sub & 1) === 0) { const j = sub >> 1, pat = (bar & 1) ? PAT_B : PAT_A; I.uke(t, [ch[0], ch[1], ch[2], ch[0] + 12][pat[j]], (j & 1) ? 0.085 : 0.11, out); }
      if (sub === 0 || sub === 8) I.bass(t, root, sub === 0 ? 0.3 : 0.24, out);
      else if (pickup) I.bass(t, root + 7, 0.14, out, 0.2);
      I.shaker(t, tens ? 0.09 : (sub & 3) === 2 ? 0.065 : (sub & 1) ? 0.035 : 0.05, out);
      if (tens) I.shaker(t + sd / 2, 0.05, out);
    } else if (d.style === 'market') { // oom-pah: tuba on 1 and 3, accordion chords on 2 and 4, clap on 4
      if (sub === 0) I.tuba(t, root, 0.3, out); else if (sub === 8) I.tuba(t, root + 7, 0.24, out);
      else if (pickup) I.tuba(t, root + 7, 0.14, out, 0.18);
      if (sub === 4 || sub === 12) I.accordion(t, ch, beat * 0.55, 0.075, out);
      if (sub === 12) I.clap(t, 0.07, out);
      if ((sub & 3) === 2) I.pizz(tt, ch[(sub >> 2) % 3] + 12, 0.055, out);
      if ((sub & 1) === 0) I.shaker((sub & 3) === 2 ? tt : t, tens ? 0.08 : (sub & 3) === 2 ? 0.045 : 0.03, out);
      if (tens) I.shaker(t + sd / 2, 0.05, out);
    } else { // harbour: marimba arps, round sine bass, waves bed
      if ((sub & 1) === 0) { const j = sub >> 1; I.marimba((sub & 3) === 2 ? tt : t, [ch[0], ch[1], ch[2], ch[1]][j & 3] + 12, (j & 1) ? 0.07 : 0.095, out); }
      if (sub === 0 || sub === 8) I.bass(t, root, sub === 0 ? 0.28 : 0.2, out, 0.4, 0);
      else if (pickup) I.bass(t, root + 7, 0.13, out, 0.22, 0);
      if ((sub & 1) === 0) I.shaker((sub & 3) === 2 ? tt : t, tens ? 0.08 : (sub & 3) === 2 ? 0.04 : 0.026, out);
      if (tens) I.shaker(t + sd / 2, 0.05, out);
    }
    if (feast) { // "kitchen rush": hat 8ths, pot-lid rim on 2 and 4, soft tom on 1 and 3, bass octave bounce
      if ((sub & 1) === 0) I.noiseHit((sub & 3) === 2 ? tt : t, 0.025, 'highpass', 7000, 0.7, (sub & 3) === 2 ? 0.045 : 0.028, out, 0.002);
      if (sub === 4 || sub === 12) I.noiseHit(t, 0.04, 'bandpass', 2200, 3, 0.07, out, 0.001);
      if (sub === 0 || sub === 8) tom(t, 0.14, out);
      if (sub === 6 || sub === 14) I.bass(tt, root + 12, 0.1, out, 0.12, 0);
    }
  }
  E.pump = (until, from = -Infinity) => {
    const L = E.loop;
    if (L) {
      while (L.nextT < until) {
        if (L.nextT >= from && E.musicV > 0.001) schedStep(L, L.step, L.nextT);
        L.nextT += stepDur(L.def); L.step = (L.step + 1) % 512;
      }
    }
    if (E.beltOn) {
      while (E.beltNext < until) {
        if (E.beltNext >= from) { const t = E.beltNext, o = osc('sine', 900), g = ctx.createGain(); env(g.gain, t, 0.001, 0.035, 0.015); o.connect(g).connect(sfxIn); o.start(t); o.stop(t + 0.035); }
        E.beltNext += 0.25;
      }
    }
  };
  E.effTown = () => (E.mode === 'title' ? 'picnic' : E.town);
  E.syncLoop = t => {
    if (!E.musicOn) { if (E.loop) { stopLoop(E.loop, t, 0.5); E.loop = null; } return; }
    const w = E.effTown();
    if (E.loop && E.loop.town === w) return;
    if (E.loop) stopLoop(E.loop, t, 0.8);
    E.loop = startLoop(w, t, E.loop ? 0.8 : 0.4);
  };
  E.setMode = (mode, t) => {
    if (!MODES.includes(mode)) return;
    const was = E.mode;
    E.mode = mode;
    const tt = t != null ? t : E.clock();
    const target = mode === 'card' ? 0.5 : 1;
    if (offline) modeG.gain.setValueAtTime(target, tt);
    else if (ctx.state !== 'running') { modeG.gain.cancelScheduledValues(0); modeG.gain.value = target; }
    else modeG.gain.setTargetAtTime(target, tt, 0.15);
    if (was !== mode) { E.syncLoop(tt); const b = E.base; E.base = tt; try { E.applyBelt(); } finally { E.base = b; } }
  };
  E.setTension = on => { E.tension = !!on; if (!on) E.tensionUntil = 0; };

  // ---------------------------------------------------------------- bus events -> sounds (GDD §8.3 / §13.3, Sim contract Wed)
  // DECISION (Wed): one moment, one sound. once(key, win) drops a repeat of the same key inside win seconds, so Sim's
  //   paired names (gull + gullWarn per swoop, tier + cakeTier per tier, truck + truckHorn) and courseDone next to win
  //   play once. The served fanfare (orderUp) is shared by courseDone and win; course swap (course / feastWipe) waits
  //   0.45 s when it lands right on the served bell so the two do not smear.
  // DECISION (Wed): spawn (Feast slot reuse) is silent by design: spawns happen off-screen up to several times a second
  //   and a sound would teach nothing. feastCourse is silent too (its feastWipe already played the course swap), and
  //   feastTicket only plays the ticket ding when ticketDone did not just play it.
  const p = (id, o) => E.play(id, o);
  const once = (key, win, f) => { const t = now(), l = E.onceAt[key]; if (l != null && t >= l && t - l < win) return false; E.onceAt[key] = t; f(); return true; };
  const served = () => once('served', 0.4, () => { p('orderUp'); E.servedAt = now(); });
  const gull = d => once('gull:' + (d.g != null ? d.g : '') + ':' + (d.i != null ? d.i : ''), 1, () => p('gullSquawk'));
  const tier = d => once('tier:' + (d.k != null ? d.k : d.tier != null ? d.tier : ''), 0.5, () => p('tier', d));
  const course = () => once('course', 1, () => later(now() - E.servedAt < 0.6 ? 0.45 : 0, () => p('course')));
  const horn = () => once('horn', 0.4, () => p('horn'));
  const ticket = () => once('ticket', 0.5, () => { p('ticket'); later(0.2, () => p('stamp')); });
  const endBelt = () => { E.beltWant = false; E.applyBelt(); };
  E.bus = {
    start: () => { E.setTension(false); if (E.mode === 'card') E.setMode('play'); },
    bite: d => { p('bite', d); if ((d.tier | 0) >= 3 || d.big) p('glug'); },
    sizeUp: () => p('sizeUp'),
    line: () => p('line'),
    ticketDone: ticket,
    courseDone: served,
    course,
    padlock: () => p('padlock'),
    bossNudge: () => p('bossNudge'),
    bump: () => p('bump'),
    bossBite: () => p('bossBite'),
    chain: d => p('chain', d),
    sizzle: () => p('sizzle'),
    hot: () => { p('sizzle'); p('nope'); },
    lowTime: () => { E.tensionUntil = Math.max(E.tensionUntil, E.base + 11); p('lowTime'); },
    tick: d => { E.tensionUntil = Math.max(E.tensionUntil, E.base + 1.8); p('tick', d); },
    gull,
    gullWarn: gull,
    gullMiss: () => p('gullMiss'),
    steal: () => p('steal'),
    nest: () => p('plop'),
    wobble: d => { // max 1 per stack per 0.5 s; a contact wobble also gets the bounce thonk
      const k = d.i != null ? d.i : -1, t = now();
      if (t - (E.wobbleAt[k] != null ? E.wobbleAt[k] : -1e9) < 0.5) return;
      E.wobbleAt[k] = t; p('wobble', { contact: !!d.contact }); if (d.contact) p('bump');
    },
    crack: () => p('crack'),
    refuse: () => p('lid'),
    shove: () => p('lid'),
    boil: () => p('boil'),
    belt: d => p('belt', d),
    truck: horn,
    truckHorn: horn,
    tier,
    cakeTier: tier,
    spawn: () => {},
    feastWipe: course,
    feastCourse: () => {},
    feastTicket: () => { if (now() - (E.onceAt.ticket != null ? E.onceAt.ticket : -1e9) >= 0.5) ticket(); },
    boost: d => p('boost', d),
    win: d => {
      E.setTension(false); endBelt();
      served();
      later(0.5, () => p('stamp'));
      later(0.62, () => p('win', { stars: d.stars }));
      E.setMode('card');
    },
    fail: () => { E.setTension(false); endBelt(); p('fail'); E.setMode('card'); },
    // control events (CTRL_EVENTS)
    levelStart: () => { E.setTension(false); endBelt(); E.onceAt = {}; E.wobbleAt = {}; E.servedAt = -1e9; },
    freezeContinue: () => { E.setTension(false); p('boost', { kind: 'freeze' }); },
    boostEmpty: () => p('nope'),
  };
  return E;
}
export const SFX_IDS = ['bite', 'glug', 'sizeUp', 'line', 'ticket', 'padlock', 'bossNudge', 'bump', 'bossBite', 'orderUp', 'stamp', 'chain', 'sizzle',
  'gullSquawk', 'gullMiss', 'steal', 'plop', 'crack', 'wobble', 'lid', 'boil', 'tick', 'lowTime', 'belt', 'horn', 'tier', 'course', 'boost', 'win',
  'star', 'fail', 'coin', 'ui', 'gift', 'chest', 'milestone', 'streak', 'buy', 'nope']; // names of the recipes, without building an engine

// ------------------------------------------------------------------ live module state
let ctx = null, E = null, boundOff = null, unlocked = false, held = false, muted = false;
let busy = false, busySince = 0, dirty = false, timer = 0, poll = 0, lastDesired = false, lastKick = 0;
let musicV = 0.7, sfxV = 0.9, wantTown = 'picnic', wantMusic = false, wantMode = 'play', wantFeast = false;

const desired = () => !!ctx && unlocked && !held && !muted && P.audioOn !== false;
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
function tick() {
  if (!ctx || ctx.state !== 'running' || !desired()) { stopTimer(); return; }
  E.pump(ctx.currentTime + LOOK, ctx.currentTime - 0.03);
  if (!E.loop && !E.beltOn) stopTimer();
}
function startTimer() {
  if (timer || !E || (!E.loop && !E.beltOn) || !ctx || ctx.state !== 'running' || !desired()) return;
  timer = setInterval(tick, TICK_MS);
  tick();
}
function run(fn) { // one resume/suspend operation at a time; re-reconcile if the wish changed meanwhile
  busy = true; busySince = performance.now(); dirty = false;
  let pr;
  try { pr = Promise.resolve(fn()); } catch { pr = Promise.resolve(); }
  pr.catch(() => {}).then(() => { busy = false; if (dirty) reconcile(); else if (ctx && ctx.state === 'running' && desired()) startTimer(); });
}
function reconcile(force) {
  if (!ctx || ctx.state === 'closed') return;
  const want = desired();
  E.setGate(want);
  if (want && !lastDesired) { E.base = E.lead(); try { E.applyBelt(); } catch {} } // a belt change that came while silent
  lastDesired = want;
  if (busy && !force && performance.now() - busySince < 1500) { dirty = true; return; }
  if (want) {
    if (ctx.state === 'running') startTimer();
    else { lastKick = performance.now(); run(() => ctx.resume()); }
  } else {
    stopTimer();
    if (ctx.state === 'running') run(() => new Promise(res => setTimeout(res, SUSPEND_MS)).then(() => (desired() ? 0 : ctx.suspend())));
  }
}
function pollTick() { // safety net: flag flips nobody forwarded, interrupted contexts, a resume that never took
  if (!ctx) return;
  const want = desired();
  if (want !== lastDesired) reconcile();
  else if (!busy && want !== (ctx.state === 'running') && performance.now() - lastKick > KICK_GAP_MS) reconcile();
}

/** Builds the graph with the context suspended and the gate closed (boot step 5). Safe to call twice. */
export function initAudio() {
  if (ctx) return true;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { ctx = null; return false; } }
  try {
    E = makeEngine(ctx, false);
  } catch (e) { try { ctx.close(); } catch {} ctx = null; E = null; try { console.warn('[audio]', e && e.message); } catch {} return false; }
  E.setMusic(musicV); E.setSfx(sfxV);
  E.town = wantTown; E.feast = wantFeast; E.musicOn = wantMusic; E.setMode(wantMode, ctx.currentTime);
  ctx.onstatechange = () => { if (busy) dirty = true; else reconcile(); };
  if (!poll) poll = setInterval(pollTick, POLL_MS);
  if (E.musicOn) E.syncLoop(ctx.currentTime);
  reconcile();
  return true;
}
/** First user gesture (safe on every gesture): starts the audio clock if sound is allowed. */
export function unlock() {
  if (!ctx && !initAudio()) return;
  const first = !unlocked;
  unlocked = true;
  if (first) { // iOS: a silent one-sample buffer inside the gesture
    try { const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0); } catch {}
  }
  if (first || ctx.state !== 'running') reconcile(true);
}
/** town: 'picnic' | 'market' | 'harbour' (or 0..2). Crossfades the loop if music is on. */
export function setTown(town) {
  const t = normTown(town);
  if (!t) return;
  wantTown = t;
  if (E) { E.town = t; E.syncLoop(ctx.currentTime); startTimer(); }
}
export function music(on) {
  wantMusic = !!on;
  if (E) { E.musicOn = wantMusic; E.syncLoop(ctx.currentTime); if (wantMusic) startTimer(); }
}
/** 'play' | 'card' (loop at -6 dB under cards) | 'title' (Picnic loop, melody only) | 'map'. */
export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  wantMode = mode;
  if (E) { E.setMode(mode, ctx.currentTime); startTimer(); }
}
/** Last 10 s of a timer: shaker doubles, melody drops out. Call with false when time is added. */
export function setTension(on) { if (E) E.setTension(on); }
/** Feast: the town loop at +6 % tempo. */
export function setFeast(on) { wantFeast = !!on; if (E) E.feast = wantFeast; }
/** Slider values 0..1 (defaults 0.7 music, 0.9 sfx). */
export function setVolumes(m, s) {
  if (m != null) musicV = clamp01(m);
  if (s != null) sfxV = clamp01(s);
  if (E) { E.setMusic(musicV); E.setSfx(sfxV); }
}
export function setMuted(b) { muted = !!b; if (ctx) reconcile(); }
export function suspend() { held = true; if (ctx) reconcile(); }
export function resume() { held = false; if (ctx) reconcile(); }
export function isRunning() { return !!ctx && ctx.state === 'running'; }
/** Plays a §8.3 recipe now (ids in SFX_IDS). opts depend on the id: bite {tier,n,ing}, chain {n}, win {stars,town}, star {i}, tick {s}, tier {k},
 *  boost {kind}, belt {on}, wobble {contact}, streak {day 1..7}. UI ids: ui, coin, gift, chest, milestone, streak, buy, nope. Dropped while not allowed. */
export function sfx(id, opts) {
  if (!E || !desired()) return false;
  E.base = E.lead();
  try { return E.play(id, opts); } catch (e) { try { console.warn('[audio]', id, e && e.message); } catch {} return false; }
}
/** Subscribes to the game bus (bus.on(ev, fn)); returns off(). Calling again replaces the previous binding. */
export function bindBus(bus) {
  // DECISION (Wed): bindBus listens to BUS_EVENTS + CTRL_EVENTS (levelStart, freezeContinue, boostEmpty; not recorded).
  //   While sound is not allowed (paused, muted, audio flag off) nothing plays and no node is made, but the belt wish is
  //   still tracked (belt {on}, levelStart / win / fail clear it), so resuming on a belt brings the hum back and resuming
  //   after the belt ended does not.
  if (boundOff) { boundOff(); boundOff = null; }
  if (!bus || typeof bus.on !== 'function') return () => {};
  const offs = [];
  for (const ev of BUS_EVENTS.concat(CTRL_EVENTS)) {
    offs.push(bus.on(ev, d => {
      if (!E) return;
      if (!desired()) { if (ev === 'levelStart' || ev === 'win' || ev === 'fail' || ev === 'belt') E.beltWant = ev === 'belt' && !!(d && d.on !== false); return; }
      E.base = E.lead();
      try { E.bus[ev](d || {}); } catch (e) { try { console.warn('[audio]', ev, e && e.message); } catch {} }
      startTimer();
    }));
  }
  boundOff = () => { for (const f of offs) try { if (f) f(); } catch {} };
  return boundOff;
}
/** Test/diagnostic: a post-everything AnalyserNode (live context only). */
export function analyser() { return E ? E.analyser() : null; }
export function stats() {
  return Object.assign({ state: ctx ? ctx.state : 'none', time: ctx ? ctx.currentTime : 0, desired: desired(), unlocked, held, muted, flagOn: P.audioOn !== false,
    gate: E ? E.gateTarget : 0, gateVal: E ? +E.gate.gain.value.toFixed(3) : 0, music: !!(E && E.loop), town: E ? E.town : wantTown, mode: E ? E.mode : wantMode, tension: !!(E && (E.tension || E.tensionUntil > E.base)), duck: E ? +E.duck.gain.value.toFixed(3) : 1,
    voices: E ? E.bv.filter(v => v.end > ctx.currentTime).length : 0, timer: !!timer, busy, belt: !!(E && E.beltOn), beltWant: !!(E && E.beltWant) }, E ? E.st : {});
}

// ------------------------------------------------------------------ offline render (record mode, tests)
/**
 * Renders events with the same engine on an OfflineAudioContext. events: [{ t, ev, data }] (bus event), [{ t, sfx, opts }],
 * { t, music: bool }, { t, town }, { t, mode }, { t, tension: bool }, { t, feast: bool }. opts: { town, mode, music (default false),
 * feast, sr (44100), musicVolume, sfxVolume }. Resolves to a stereo AudioBuffer of durSec seconds.
 */
export async function renderOffline(durSec = 5, events = [], opts = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const sr = opts.sr || 44100, dur = Math.max(0.1, Math.min(120, +durSec || 5));
  const oc = new OAC(2, Math.ceil(sr * dur), sr);
  const X = makeEngine(oc, true);
  X.setMusic(opts.musicVolume != null ? opts.musicVolume : musicV); X.setSfx(opts.sfxVolume != null ? opts.sfxVolume : sfxV);
  X.town = normTown(opts.town) || 'picnic'; X.feast = !!opts.feast; X.musicOn = !!opts.music;
  X.setMode(MODES.includes(opts.mode) ? opts.mode : 'play', 0); X.syncLoop(0);
  const evs = (Array.isArray(events) ? events : []).filter(e => e && isFinite(e.t)).slice().sort((a, b) => a.t - b.t);
  for (const e of evs) {
    const t = Math.max(0, Math.min(dur, +e.t));
    X.pump(t);
    X.base = t;
    try {
      if (e.ev) { const h = X.bus[e.ev]; if (h) h(e.data || {}); }
      else if (e.sfx) X.play(e.sfx, e.opts);
      else if ('music' in e) { X.musicOn = !!e.music; X.syncLoop(t); }
      else if ('town' in e) { const tw = normTown(e.town); if (tw) { X.town = tw; X.syncLoop(t); } }
      else if ('mode' in e) X.setMode(e.mode, t);
      else if ('tension' in e) X.setTension(e.tension);
      else if ('feast' in e) X.feast = !!e.feast;
    } catch (err) { try { console.warn('[audio]', err && err.message); } catch {} }
  }
  X.pump(dur);
  return oc.startRendering();
}
/** Same as renderOffline but returns a base64 PCM16 stereo WAV (what __rec.audio(dur) returns). */
export async function renderWav(durSec, events, opts) { return wavBase64(await renderOffline(durSec, events, opts)); }
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

export default { initAudio, unlock, setTown, music, setMode, setTension, setFeast, sfx, setVolumes, setMuted, suspend, resume, bindBus,
  isRunning, analyser, stats, renderOffline, renderWav, biteHz, SFX_IDS, BUS_EVENTS, CTRL_EVENTS, TOWN_IDS };
