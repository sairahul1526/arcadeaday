// Procedural audio for Kiss the Edge. Every sound is synthesized, so the same
// code runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// i - VI - III - VII in minor, as [semitone offset from root, chord intervals]
const PROG = [[0, [0, 3, 7]], [-4, [0, 4, 7]], [3, [0, 4, 7]], [-2, [0, 4, 7]]];
const PENTA = [0, 3, 5, 7, 10];

export const LAYER_AT = [0, 2, 4, 7, 11, 16];
export const LAYER_NAMES = ['BEAT', 'HATS', 'BASS', 'CHORDS', 'MELODY', 'OVERDRIVE'];
export const ZONE_ROOTS = [45, 50, 43, 48, 46, 41];
export const layerFor = streak => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (streak >= LAYER_AT[i]) l = i;
  return l;
};
export const dingNote = (root, n) => {
  const k = Math.min(n, 14);
  return root + 36 + PENTA[k % 5] + 12 * Math.floor(k / 5);
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

    // Music runs through a lowpass so death can "go underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.8;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.lp);

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.75;
    this.sfx.connect(comp);

    this.noiseBuf = this._noise(2);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(2.2);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.32;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.39;
    const fb = c.createGain();
    fb.gain.value = 0.33;
    this.dly.connect(fb);
    fb.connect(this.dly);
    this.dlySend = c.createGain();
    this.dlySend.gain.value = 0.28;
    this.dlySend.connect(this.dly);
    const dOut = c.createGain();
    dOut.gain.value = 0.55;
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
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
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
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.34);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
    this._hit(t, 0.02, 0.25 * v, 'highpass', 3000, 0.7, this.music);
  }
  clap(t) {
    this._hit(t, 0.17, 0.42, 'bandpass', 1500, 1.1, this.music);
    this._hit(t + 0.012, 0.12, 0.25, 'bandpass', 1200, 1.4, this.verbSend);
  }
  hat(t, v = 0.16, open = false) {
    this._hit(t, open ? 0.2 : 0.045, v, 'highpass', 8200, 0.8, this.music);
  }
  bass(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(m), t);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.3, dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
    this._osc('sine', mtof(m - 12), t, 0.004, dur, 0.28, this.music);
  }
  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.35);
    g.gain.setValueAtTime(0.055, t + Math.max(0.4, dur - 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes) {
      for (const dt of [-9, 9]) {
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
  pluck(t, m, v = 0.12) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(m);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3600, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, v, 0.22);
    o.connect(f);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.dlySend);
    o.start(t);
    o.stop(t + 0.3);
  }
  stab(t, notes) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.07, 0.2);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes) {
      for (const dt of [-14, 0, 14]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = dt;
        o.connect(f);
        o.start(t);
        o.stop(t + 0.3);
      }
    }
  }

  // ---------- sfx
  ding(t, m, big) {
    this._osc('sine', mtof(m), t, 0.003, 0.7, 0.32, this.sfx);
    this._osc('sine', mtof(m + 12), t, 0.003, 0.35, 0.1, this.sfx);
    this._osc('triangle', mtof(m + 19), t, 0.003, 0.18, 0.05, this.verbSend);
    this._osc('sine', mtof(m), t, 0.003, 0.7, 0.2, this.verbSend);
    if (big) {
      this._osc('sine', mtof(m + 24), t + 0.06, 0.003, 0.5, 0.12, this.sfx);
      this._osc('sine', mtof(m + 31), t + 0.12, 0.003, 0.5, 0.09, this.verbSend);
      this._hit(t, 0.4, 0.12, 'highpass', 9000, 0.5, this.verbSend, 0.05);
    }
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.07, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.07, this.sfx);
  }
  crash(t) {
    const f = this._hit(t, 0.6, 0.85, 'lowpass', 2600, 0.8, this.sfx);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.9, 0.5);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.6);
  }
  fall(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.9);
    const g = c.createGain();
    this._env(g.gain, t, 0.02, 0.16, 0.9);
    o.connect(g);
    g.connect(this.sfx);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 1);
  }
  drop(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.4);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    const g = c.createGain();
    this._env(g.gain, t, 0.005, 0.2, 0.4);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.22, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(7000, t + 0.6);
    [0, 7, 12, 19].forEach((x, i) => this.ding(t + 0.6 + i * 0.07, root + 36 + x, i === 3));
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
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.35);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = c.createGain();
    this._env(g.gain, t, 0.01, 0.14, 0.4);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }
  screech(t = 0) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 1900;
    f1.Q.value = 2.2;
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
    this.lp.frequency.setTargetAtTime(on ? 420 : 18000, t, on ? 0.12 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'ding': return this.ding(t, e.m, e.big);
      case 'coin': return this.coin(t);
      case 'crash': this.crash(t); this.fall(t + 0.05); return this.under(t, true);
      case 'revive': return this.under(t, false);
      case 'drop': return this.drop(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'click': return this.click(t);
      case 'start': return this.start(t);
    }
  }
}

// One 16th-note step of the adaptive soundtrack. st = { layer, root, bpm }
export function stepMusic(s, step, t, st) {
  const pos = step % 16;
  const bar = (step / 16) | 0;
  const [off, tri] = PROG[bar % 4];
  const root = st.root + off;
  const L = st.layer;
  const sd = 60 / st.bpm / 4;
  if (pos === 0) s.dly.delayTime.setValueAtTime(sd * 3, t);

  if (pos % 4 === 0) s.kick(t, L >= 5 ? 1 : 0.85);
  if (L >= 1) {
    if (pos % 4 === 2) s.hat(t, 0.16, L >= 3);
    if (pos === 4 || pos === 12) s.clap(t);
  }
  if (L >= 2 && pos % 4 !== 0) s.bass(t, root + (pos % 4 === 3 ? 12 : 0), sd * 0.9);
  if (L >= 3 && pos === 0) s.pad(t, tri.map(x => root + 24 + x), sd * 16);
  if (L >= 4) {
    const arp = [0, 1, 2, 1, 2, 0, 1, 2];
    if (L >= 5 || pos % 2 === 0) {
      const i = arp[(pos >> (L >= 5 ? 0 : 1)) % 8];
      s.pluck(t, root + 36 + tri[i] + (L >= 5 && pos >= 8 ? 12 : 0), L >= 5 ? 0.09 : 0.11);
    }
  }
  if (L >= 5) {
    if (pos % 2 === 1) s.hat(t, 0.07);
    if (pos === 0 || pos === 3 || pos === 6 || pos === 10) s.stab(t, tri.map(x => root + 36 + x));
  }
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
  const sg = s.screech(0);
  for (const [tt, v] of log.screech) if (tt < dur) sg.gain.setTargetAtTime(v, tt, 0.03);
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
