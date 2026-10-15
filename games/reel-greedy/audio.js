// Procedural audio for Reel Greedy. Every sound is synthesized, so the same
// code runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// i - VI - III - VII in minor, as [semitone offset from root, chord intervals]
const PROG = [[0, [0, 3, 7]], [-4, [0, 4, 7]], [3, [0, 4, 7]], [-2, [0, 4, 7]]];
const PENTA = [0, 3, 5, 7, 10];

// Music layers unlock with the deepest point of the cast (metres).
export const LAYER_AT = [0, 8, 25, 55, 100, 160];
export const LAYER_NAMES = ['MALLETS', 'KICK', 'BASS', 'PADS', 'DRUMS', 'ABYSS'];
export const ZONE_ROOTS = [50, 48, 46, 45, 43, 41];
export const layerFor = d => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (d >= LAYER_AT[i]) l = i;
  return l;
};
export const dingNote = (root, n) => {
  const k = Math.min(n, 14);
  return root + 36 + PENTA[k % 5] + 12 * Math.floor(k / 5);
};
// Deeper water muffles the music.
const cutoffFor = d => 16000 * Math.pow(0.12, Math.min(1, Math.max(0, d) / 260)) + 900;

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

    // Music runs through a lowpass so a snapped line can "go underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.8;
    this.lp.connect(comp);

    // ...and through a second one that closes as the hook sinks.
    this.deep = c.createBiquadFilter();
    this.deep.type = 'lowpass';
    this.deep.frequency.value = 16000;
    this.deep.Q.value = 1.4;
    this.deep.connect(this.lp);

    this.music = c.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.deep);

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.75;
    this.sfx.connect(comp);

    this.noiseBuf = this._noise(2);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(2.6);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.36;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.39;
    const fb = c.createGain();
    fb.gain.value = 0.36;
    this.dly.connect(fb);
    fb.connect(this.dly);
    this.dlySend = c.createGain();
    this.dlySend.gain.value = 0.3;
    this.dlySend.connect(this.dly);
    const dOut = c.createGain();
    dOut.gain.value = 0.55;
    this.dly.connect(dOut);
    dOut.connect(this.deep);
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
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
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
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.36);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.42);
  }
  shaker(t, v = 0.12) {
    this._hit(t, 0.05, v, 'highpass', 6500, 0.9, this.music, 0.012);
  }
  snare(t) {
    this._hit(t, 0.16, 0.3, 'bandpass', 1800, 0.9, this.music);
    this._hit(t, 0.14, 0.18, 'bandpass', 1400, 1.2, this.verbSend);
    this._osc('triangle', 190, t, 0.002, 0.08, 0.18, this.music);
  }
  bass(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(mtof(m), t);
    const g = c.createGain();
    this._env(g.gain, t, 0.006, 0.42, dur);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
    this._osc('sine', mtof(m - 12), t, 0.006, dur, 0.3, this.music);
  }
  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + Math.max(0.6, dur - 0.3));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
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
        o.stop(t + dur + 0.5);
      }
    }
  }
  // Marimba-ish pluck: sine + quick overtone.
  mallet(t, m, v = 0.16) {
    this._osc('sine', mtof(m), t, 0.002, 0.32, v, this.music);
    this._osc('sine', mtof(m) * 4.02, t, 0.001, 0.05, v * 0.35, this.music);
    this._osc('sine', mtof(m), t, 0.002, 0.3, v * 0.5, this.dlySend);
  }
  ping(t, m) {
    this._osc('sine', mtof(m), t, 0.004, 1.1, 0.08, this.music);
    this._osc('sine', mtof(m), t, 0.004, 1.1, 0.1, this.verbSend);
  }

  // ---------- sfx
  ding(t, m, big) {
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.3, this.sfx);
    this._osc('sine', mtof(m + 12), t, 0.003, 0.3, 0.1, this.sfx);
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.18, this.verbSend);
    if (big) {
      this._osc('sine', mtof(m + 19), t + 0.06, 0.003, 0.5, 0.1, this.sfx);
      this._osc('sine', mtof(m + 24), t + 0.12, 0.003, 0.5, 0.08, this.verbSend);
    }
  }
  bloop(t, m) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(m - 12), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m + 7), t + 0.09);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.32, 0.14);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    this.ding(t + 0.05, m, false);
  }
  splash(t, big = true) {
    const f = this._hit(t, big ? 0.7 : 0.35, big ? 0.55 : 0.3, 'lowpass', 5000, 0.6, this.sfx, 0.01);
    f.frequency.exponentialRampToValueAtTime(500, t + (big ? 0.6 : 0.3));
    for (let i = 0; i < (big ? 6 : 3); i++) this.bubble(t + 0.05 + i * 0.045 + Math.random() * 0.03, 500 + Math.random() * 700);
  }
  bubble(t, f0 = 700) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.05);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.08, 0.06);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }
  tick(t) {
    this._hit(t, 0.012, 0.07, 'bandpass', 3800, 3, this.sfx, 0.001);
  }
  chomp(t) {
    for (const dt of [0, 0.11]) {
      const f = this._hit(t + dt, 0.12, 0.7, 'bandpass', 900, 1.2, this.sfx, 0.001);
      f.frequency.exponentialRampToValueAtTime(300, t + dt + 0.1);
      this._osc('square', 90, t + dt, 0.001, 0.08, 0.2, this.sfx);
    }
    this._osc('sine', 70, t, 0.003, 0.4, 0.6, this.sfx);
  }
  snap(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    const g = c.createGain();
    this._env(g.gain, t, 0.001, 0.22, 0.3);
    o.connect(g);
    g.connect(this.sfx);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 0.4);
    this.chomp(t + 0.02);
    const c2 = this.ctx.createOscillator();
    c2.type = 'triangle';
    c2.frequency.setValueAtTime(700, t + 0.15);
    c2.frequency.exponentialRampToValueAtTime(70, t + 1.1);
    const g2 = c.createGain();
    this._env(g2.gain, t + 0.15, 0.02, 0.15, 0.95);
    c2.connect(g2);
    g2.connect(this.sfx);
    g2.connect(this.verbSend);
    c2.start(t + 0.15);
    c2.stop(t + 1.2);
  }
  // Two low notes, the shark's calling card.
  warn(t) {
    this._osc('sawtooth', mtof(28), t, 0.01, 0.22, 0.16, this.sfx);
    this._osc('sine', mtof(28), t, 0.01, 0.25, 0.3, this.sfx);
    this._osc('sawtooth', mtof(29), t + 0.3, 0.01, 0.22, 0.16, this.sfx);
    this._osc('sine', mtof(29), t + 0.3, 0.01, 0.25, 0.3, this.sfx);
  }
  close(t) {
    const f = this._hit(t, 0.28, 0.3, 'bandpass', 600, 2.5, this.sfx, 0.04);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.28);
    this._osc('sine', 1568, t + 0.1, 0.003, 0.25, 0.12, this.sfx);
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.07, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.07, this.sfx);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.18, 'bandpass', 300, 2, this.sfx, 0.5);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
    [0, 7, 12].forEach((x, i) => this.ping(t + 0.4 + i * 0.12, root + 36 + x));
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
  reel(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.25);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = c.createGain();
    this._env(g.gain, t, 0.01, 0.1, 0.28);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.35);
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 380 : 18000, t, on ? 0.12 : 0.05);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'ding': return this.ding(t, e.m, e.big);
      case 'bloop': return this.bloop(t, e.m);
      case 'splash': return this.splash(t, e.big !== false);
      case 'bubble': return this.bubble(t, e.f);
      case 'tick': return this.tick(t);
      case 'chomp': return this.chomp(t);
      case 'snap': this.snap(t); return this.under(t + 0.1, true);
      case 'revive': return this.under(t, false);
      case 'warn': return this.warn(t);
      case 'close': return this.close(t);
      case 'coin': return this.coin(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'click': return this.click(t);
      case 'reel': return this.reel(t);
    }
  }
}

// One 16th-note step of the adaptive soundtrack. st = { layer, root, bpm, depth }
export function stepMusic(s, step, t, st) {
  const pos = step % 16;
  const bar = (step / 16) | 0;
  const [off, tri] = PROG[bar % 4];
  const root = st.root + off;
  const L = st.layer;
  const sd = 60 / st.bpm / 4;
  if (pos === 0) {
    s.dly.delayTime.setValueAtTime(sd * 3, t);
    s.deep.frequency.setTargetAtTime(cutoffFor(st.depth || 0), t, 0.3);
  }
  if (pos % 2 === 0) {
    const arp = [0, 1, 2, 1, 2, 1, 0, 2];
    s.mallet(t, root + 36 + tri[arp[(pos >> 1) % 8]] + (L >= 4 && pos >= 8 ? 12 : 0), L >= 1 ? 0.13 : 0.1);
  }
  if (L >= 1 && pos % 8 === 0) s.kick(t, 0.8);
  if (L >= 2) {
    if (pos % 4 === 2) s.shaker(t, 0.12);
    if (pos === 0 || pos === 6 || pos === 10) s.bass(t, root + (pos === 6 ? 7 : 0), sd * 3);
  }
  if (L >= 3) {
    if (pos === 0) s.pad(t, tri.map(x => root + 24 + x), sd * 16);
    if (pos % 4 === 0) s.kick(t, 0.85);
  }
  if (L >= 4) {
    if (pos === 4 || pos === 12) s.snare(t);
    if (pos % 2 === 1) s.shaker(t, 0.06);
  }
  if (L >= 5 && (pos === 3 || pos === 11)) s.ping(t, root + 48 + tri[2]);
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
