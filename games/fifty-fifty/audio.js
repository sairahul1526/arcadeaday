// Procedural audio for Fifty Fifty. Every sound is synthesized, so the same
// code runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// I - V - vi - IV in major, as [semitone offset from root, chord intervals]
const PROG = [[0, [0, 4, 7]], [-5, [0, 4, 7]], [-3, [0, 3, 7]], [5, [0, 4, 7]]];
const PENTA = [0, 2, 4, 7, 9];

export const LAYER_AT = [0, 2, 4, 7, 11, 16];
export const LAYER_NAMES = ['BEAT', 'CLAPS', 'BASS', 'KEYS', 'MELODY', 'FULL JUICE'];
export const ZONE_ROOTS = [48, 50, 45, 47, 43, 46];
export const layerFor = streak => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (streak >= LAYER_AT[i]) l = i;
  return l;
};
export const dingNote = (root, n) => {
  const k = Math.min(n, 14);
  return root + 24 + PENTA[k % 5] + 12 * Math.floor(k / 5);
};

export class Synth {
  constructor(ctx) {
    const c = (this.ctx = ctx);
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);

    const comp = (this.comp = c.createDynamicsCompressor());
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(this.master);

    // Music runs through a lowpass so a bomb can "go underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.8;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.48;
    this.music.connect(this.lp);

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(comp);

    this.noiseBuf = this._noise(2);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(1.8);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.3;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.33;
    const fb = c.createGain();
    fb.gain.value = 0.3;
    this.dly.connect(fb);
    fb.connect(this.dly);
    this.dlySend = c.createGain();
    this.dlySend.gain.value = 0.25;
    this.dlySend.connect(this.dly);
    const dOut = c.createGain();
    dOut.gain.value = 0.5;
    this.dly.connect(dOut);
    dOut.connect(this.lp);
  }

  _noise(sec) {
    const c = this.ctx;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _impulse(sec) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    return b;
  }

  _env(p, t, a, peak, d) {
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _osc(type, f, t, a, d, peak, dest, detune = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    const g = c.createGain();
    this._env(g.gain, t, a, peak, d);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + a + d + 0.05);
    return o;
  }

  _hit(t, dur, peak, type, freq, q, dest, a = 0.002) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = c.createGain();
    this._env(g.gain, t, a, peak, dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + a + dur + 0.05);
    return f;
  }

  // ---------- instruments
  kick(t, v = 0.9) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.3);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.36);
    this._hit(t, 0.015, 0.2 * v, 'highpass', 3500, 0.7, this.music);
  }
  clap(t) {
    this._hit(t, 0.14, 0.38, 'bandpass', 1700, 1.2, this.music);
    this._hit(t + 0.01, 0.1, 0.22, 'bandpass', 1300, 1.4, this.verbSend);
  }
  shaker(t, v = 0.08) {
    this._hit(t, 0.035, v, 'highpass', 9000, 0.8, this.music, 0.006);
  }
  bass(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(mtof(m), t);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.22, dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
    this._osc('sine', mtof(m), t, 0.004, dur, 0.3, this.music);
  }
  // Wooden marimba: fundamental plus the bright 4th partial, fast decay.
  marimba(t, m, v = 0.16, dest = this.music) {
    this._osc('sine', mtof(m), t, 0.002, 0.42, v, dest);
    this._osc('sine', mtof(m) * 3.93, t, 0.001, 0.07, v * 0.35, dest);
    this._osc('triangle', mtof(m), t, 0.002, 0.12, v * 0.4, this.dlySend);
  }
  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.3);
    g.gain.setValueAtTime(0.04, t + Math.max(0.35, dur - 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes) {
      for (const dt of [-8, 8]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = dt;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    }
  }
  lead(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(mtof(m), t);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2800, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = c.createGain();
    this._env(g.gain, t, 0.005, 0.06, dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.dlySend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- sfx
  swoosh(t, v = 1) {
    const f = this._hit(t, 0.16, 0.22 * v, 'bandpass', 500, 1.6, this.sfx, 0.03);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.15);
  }
  slice(t, m) {
    // blade "shhk" + wet squish + a pitched pop for the grade
    this._hit(t, 0.05, 0.4, 'highpass', 5000, 0.9, this.sfx);
    const f = this._hit(t + 0.01, 0.16, 0.5, 'lowpass', 1800, 2.5, this.sfx);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.16);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(m), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m) * 0.55, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.22, 0.14);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
  }
  ding(t, m, big) {
    this.marimba(t, m, 0.22, this.sfx);
    this._osc('sine', mtof(m + 12), t, 0.003, 0.35, 0.08, this.sfx);
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.14, this.verbSend);
    if (big) {
      this.marimba(t + 0.06, m + 7, 0.16, this.sfx);
      this.marimba(t + 0.12, m + 12, 0.14, this.sfx);
    }
  }
  perfect(t, root) {
    // shimmering chord + rising sparkle
    [0, 4, 7, 12, 16, 19, 24, 28].forEach((x, i) => {
      this._osc('sine', mtof(root + 36 + x), t + i * 0.035, 0.002, 0.5, 0.09, this.sfx);
      this._osc('triangle', mtof(root + 36 + x), t + i * 0.035, 0.002, 0.8, 0.05, this.verbSend);
    });
    this._osc('sine', mtof(root + 12), t, 0.005, 1.2, 0.25, this.sfx);
    this._hit(t, 0.9, 0.12, 'highpass', 8000, 0.5, this.verbSend, 0.1);
  }
  strike(t) {
    this._osc('square', 220, t, 0.004, 0.12, 0.12, this.sfx);
    this._osc('square', 155, t + 0.13, 0.004, 0.22, 0.12, this.sfx);
  }
  miss(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.2);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.5, 0.25);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
    this.strike(t + 0.05);
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.07, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.07, this.sfx);
  }
  boom(t) {
    const f = this._hit(t, 1.1, 1, 'lowpass', 3000, 0.7, this.sfx);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 1, 0.8);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.9);
    this._hit(t, 1.6, 0.3, 'lowpass', 900, 0.5, this.verbSend, 0.01);
  }
  toss(t) {
    const f = this._hit(t, 0.12, 0.08, 'bandpass', 300, 1.2, this.sfx, 0.02);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.12);
  }
  zone(t, root) {
    const f = this._hit(t, 0.8, 0.2, 'bandpass', 400, 2, this.sfx, 0.5);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.55);
    [0, 4, 7, 12].forEach((x, i) => this.ding(t + 0.55 + i * 0.07, root + 24 + x, i === 3));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.16, 0.06, this.sfx);
      this._osc('sine', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.3, 0.12, this.verbSend);
    });
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  start(t) {
    this.swoosh(t, 1.4);
    this.marimba(t + 0.05, 72, 0.18, this.sfx);
    this.marimba(t + 0.13, 79, 0.18, this.sfx);
  }
  fuse(t = 0) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f1 = c.createBiquadFilter();
    f1.type = 'highpass';
    f1.frequency.value = 4200;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(f1);
    f1.connect(g);
    g.connect(this.sfx);
    s.start(t);
    return g;
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 380 : 18000, t, on ? 0.1 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'swoosh': return this.swoosh(t, e.v ?? 1);
      case 'slice': return this.slice(t, e.m ?? 72);
      case 'ding': return this.ding(t, e.m, e.big);
      case 'perfect': return this.perfect(t, e.root);
      case 'strike': return this.strike(t);
      case 'miss': return this.miss(t);
      case 'coin': return this.coin(t);
      case 'boom': this.boom(t); return this.under(t, true);
      case 'revive': return this.under(t, false);
      case 'toss': return this.toss(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'click': return this.click(t);
      case 'start': return this.start(t);
    }
  }
}

// A tiny deterministic hash so each bar's melody is fixed (same live and offline).
const hash = n => {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
};

// One 16th-note step of the adaptive soundtrack. st = { layer, root, bpm }
export function stepMusic(s, step, t, st) {
  const pos = step % 16;
  const bar = (step / 16) | 0;
  const [off, tri] = PROG[bar % 4];
  const root = st.root + off;
  const L = st.layer;
  const sd = 60 / st.bpm / 4;
  if (pos === 0) s.dly.delayTime.setValueAtTime(sd * 3, t);

  if (pos === 0 || pos === 8 || (L >= 2 && pos === 6)) s.kick(t, L >= 5 ? 1 : 0.85);
  if (pos % 2 === 1 || L >= 5) s.shaker(t, pos % 4 === 2 ? 0.1 : 0.06);
  if (L >= 1 && (pos === 4 || pos === 12)) s.clap(t);
  if (L >= 2 && [0, 3, 6, 8, 10, 14].includes(pos)) s.bass(t, root - 12 + (pos === 10 || pos === 14 ? 12 : 0), sd * 1.6);
  if (L >= 3 && [2, 6, 10, 14].includes(pos)) for (const x of tri) s.marimba(t, root + 12 + x, 0.07);
  if (L >= 3 && pos === 0) s.pad(t, tri.map(x => root + 24 + x), sd * 16);
  if (L >= 4 && pos % 2 === 0) {
    const h = hash(bar * 16 + pos + 7);
    if (h < (L >= 5 ? 0.8 : 0.55)) s.marimba(t, st.root + 24 + PENTA[((h * 37) | 0) % 5] + (h > 0.7 ? 12 : 0), 0.1);
  }
  if (L >= 5 && (pos === 0 || pos === 6 || pos === 12)) s.lead(t, root + 36 + tri[(bar + pos) % 3], sd * 3);
}

// Live lookahead scheduler.
export class Music {
  constructor(synth) {
    this.s = synth;
    this.step = 0;
    this.next = 0;
    this.on = false;
    this.beats = [];
  }
  start() {
    this.next = this.s.ctx.currentTime + 0.06;
    this.step = 0;
    this.on = true;
  }
  tick(st) {
    if (!this.on) return;
    const now = this.s.ctx.currentTime;
    if (this.next < now - 0.2) this.next = now + 0.02;
    while (this.next < now + 0.12) {
      stepMusic(this.s, this.step, this.next, st);
      if (this.step % 4 === 0) {
        this.beats.push(this.next);
        if (this.beats.length > 8) this.beats.shift();
      }
      this.next += 60 / st.bpm / 4;
      this.step++;
    }
  }
  phase(bpm) {
    const now = this.s.ctx.currentTime;
    let last = -1;
    for (const b of this.beats) if (b <= now) last = b;
    if (last < 0) return 0;
    return Math.min(1, (now - last) / (60 / bpm));
  }
}

// Offline render of a recorded run, for video export. Returns base64 WAV.
export async function renderOffline(log, dur) {
  const sr = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const s = new Synth(oc);
  const st = log.states;
  let si = 0;
  let t = log.musicStart;
  let step = 0;
  while (t < dur) {
    while (si + 1 < st.length && st[si + 1].t <= t) si++;
    stepMusic(s, step, t, st[si]);
    t += 60 / st[si].bpm / 4;
    step++;
  }
  for (const e of log.events) if (e.t < dur) s.play(e.type, e.t, e);
  const fg = s.fuse(0);
  for (const [tt, v] of log.fuse) if (tt < dur) fg.gain.setTargetAtTime(v, tt, 0.03);
  const buf = await oc.startRendering();
  return wavBase64(buf);
}

function wavBase64(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
