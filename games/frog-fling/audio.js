// Procedural audio for Frog Fling: a bouncy swamp-marimba groove plus squishy SFX.
// Everything is synthesized, so the same code runs live (AudioContext) and
// offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// I - vi - IV - V in major: [semitone offset from root, chord intervals]
const PROG = [[0, [0, 4, 7]], [-3, [0, 3, 7]], [5, [0, 4, 7]], [7, [0, 4, 7]]];
const PENTA = [0, 2, 4, 7, 9];
// Kalimba hook, one bar of 16ths (-1 = rest), as pentatonic degrees.
const HOOK = [0, -1, 2, -1, 4, -1, 2, 3, -1, 4, -1, 5, 4, -1, 2, -1];

export const LAYER_AT = [0, 1, 3, 5, 8, 12];
export const LAYER_NAMES = ['BEAT', 'SNAPS', 'BASS', 'MARIMBA', 'KALIMBA', 'FRENZY'];
export const ZONE_ROOTS = [48, 53, 50, 55, 52, 47];
export const layerFor = streak => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (streak >= LAYER_AT[i]) l = i;
  return l;
};
export const gulpNote = (root, n) => {
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

    // Music runs through a lowpass so falling in the pond sounds "underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.8;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.52;
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
    this.dly.delayTime.value = 0.43;
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
  kick(t, v = 0.85) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.28);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.35);
  }
  shaker(t, v = 0.09) {
    this._hit(t, 0.05, v, 'bandpass', 6500, 1.2, this.music, 0.008);
  }
  snap(t) {
    this._hit(t, 0.06, 0.4, 'bandpass', 2200, 3, this.music);
    this._hit(t, 0.1, 0.18, 'bandpass', 1800, 2, this.verbSend);
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
    this._osc('sine', mtof(m + 12), t, 0.004, dur * 0.5, 0.08, this.music);
  }
  marimba(t, m, v = 0.16) {
    this._osc('sine', mtof(m), t, 0.002, 0.32, v, this.music);
    this._osc('sine', mtof(m) * 4, t, 0.001, 0.05, v * 0.35, this.music);
    this._osc('sine', mtof(m), t, 0.002, 0.3, v * 0.4, this.verbSend);
  }
  kalimba(t, m, v = 0.13) {
    this._osc('sine', mtof(m), t, 0.002, 0.6, v, this.music);
    this._osc('sine', mtof(m) * 5.4, t, 0.001, 0.07, v * 0.25, this.music);
    this._osc('triangle', mtof(m + 12), t, 0.002, 0.15, v * 0.25, this.dlySend);
  }
  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.setValueAtTime(0.05, t + Math.max(0.45, dur - 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes) {
      for (const dt of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = dt;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    }
  }

  // ---------- sfx
  thwip(t) {
    const f = this._hit(t, 0.09, 0.32, 'bandpass', 900, 4, this.sfx);
    f.frequency.exponentialRampToValueAtTime(5200, t + 0.08);
    this._osc('sine', 600, t, 0.002, 0.06, 0.08, this.sfx).frequency.exponentialRampToValueAtTime(1500, t + 0.06);
  }
  whiff(t) {
    const f = this._hit(t, 0.16, 0.18, 'bandpass', 3000, 3, this.sfx);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.15);
  }
  gulp(t, m, big) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(m + 7), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m - 5), t + 0.09);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.35, 0.12);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    // sparkle on top, pitched with the streak
    this._osc('sine', mtof(m + 24), t + 0.05, 0.002, 0.45, 0.13, this.sfx);
    this._osc('sine', mtof(m + 24), t + 0.05, 0.002, 0.5, 0.12, this.verbSend);
    if (big) {
      this._osc('triangle', mtof(m + 31), t + 0.11, 0.002, 0.4, 0.08, this.sfx);
      this._osc('sine', mtof(m + 36), t + 0.17, 0.002, 0.5, 0.07, this.verbSend);
    }
  }
  boing(t, big) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(big ? 220 : 180, t);
    o.frequency.exponentialRampToValueAtTime(big ? 760 : 420, t + 0.16);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.16, 0.2);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
  }
  perfect(t, root) {
    [0, 4, 7, 12].forEach((x, i) => {
      this._osc('square', mtof(root + 36 + x), t + i * 0.04, 0.002, 0.1, 0.045, this.sfx);
      this._osc('sine', mtof(root + 36 + x), t + i * 0.04, 0.002, 0.35, 0.09, this.verbSend);
    });
  }
  skim(t) {
    const f = this._hit(t, 0.35, 0.3, 'bandpass', 1800, 1.2, this.sfx, 0.03);
    f.frequency.exponentialRampToValueAtTime(5000, t + 0.3);
    this._hit(t, 0.4, 0.12, 'highpass', 7000, 0.6, this.verbSend, 0.04);
  }
  splash(t) {
    const f = this._hit(t, 0.7, 0.75, 'lowpass', 3200, 0.7, this.sfx);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    this._hit(t + 0.02, 0.5, 0.25, 'bandpass', 900, 1, this.verbSend);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.5, 0.3);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
  }
  chomp(t) {
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.11;
      this._hit(tt, 0.08, 0.6, 'lowpass', 1400, 2, this.sfx);
      this._osc('square', 110 - i * 30, tt, 0.002, 0.09, 0.22, this.sfx);
    }
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.8, 0.45);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }
  bubbles(t) {
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.09 + Math.random() * 0.03;
      const o = this._osc('sine', 300 + Math.random() * 200, tt, 0.002, 0.05, 0.06, this.sfx);
      o.frequency.exponentialRampToValueAtTime(900 + Math.random() * 300, tt + 0.05);
    }
  }
  ribbit(t, p = 1) {
    // two throaty pulses: buzzy saw through a vowel-ish bandpass
    const c = this.ctx;
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.13;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(150 * p, tt);
      o.frequency.linearRampToValueAtTime((i ? 120 : 175) * p, tt + 0.09);
      const am = c.createOscillator();
      am.frequency.value = 38;
      const amg = c.createGain();
      amg.gain.value = 0.5;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700 * p;
      f.Q.value = 3;
      const g = c.createGain();
      this._env(g.gain, tt, 0.01, 0.5, 0.1);
      am.connect(amg);
      amg.connect(g.gain);
      o.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      o.start(tt);
      am.start(tt);
      o.stop(tt + 0.15);
      am.stop(tt + 0.15);
    }
  }
  loop(t, n, root) {
    [0, 7, 12, 16, 19].slice(0, 2 + n).forEach((x, i) => this.kalimba(t + i * 0.05, root + 36 + x, 0.14));
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.06, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.06, this.sfx);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.2, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.6);
    [0, 4, 7, 12].forEach((x, i) => this.kalimba(t + 0.6 + i * 0.08, root + 36 + x, 0.16));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.14, 0.05, this.sfx);
      this._osc('sine', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.3, 0.11, this.verbSend);
    });
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 380 : 18000, t, on ? 0.1 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'thwip': return this.thwip(t);
      case 'whiff': return this.whiff(t);
      case 'gulp': return this.gulp(t, e.m, e.big);
      case 'boing': return this.boing(t, e.big);
      case 'perfect': return this.perfect(t, e.root);
      case 'skim': return this.skim(t);
      case 'splash': this.splash(t); return this.under(t + 0.05, true);
      case 'chomp': this.chomp(t); this.splash(t + 0.5); return this.under(t + 0.1, true);
      case 'bubbles': return this.bubbles(t);
      case 'ribbit': return this.ribbit(t, e.p || 1);
      case 'loop': return this.loop(t, e.n || 1, e.root);
      case 'coin': return this.coin(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'click': return this.click(t);
      case 'revive': return this.under(t, false);
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

  if (pos % 4 === 0 || (L >= 5 && pos === 14)) s.kick(t, L >= 5 ? 0.95 : 0.8);
  if (pos % 2 === 1 || L >= 3) s.shaker(t, pos % 4 === 2 ? 0.11 : 0.06);
  if (L >= 1 && (pos === 4 || pos === 12)) s.snap(t);
  if (L >= 2 && (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 11)) s.bass(t, root - 12 + (pos === 11 ? 7 : 0), sd * 1.6);
  if (L >= 3) {
    if (pos === 0) s.pad(t, tri.map(x => root + 12 + x), sd * 16);
    if (pos % 4 === 2) tri.forEach((x, i) => s.marimba(t + i * 0.012, root + 24 + x, 0.07));
  }
  if (L >= 4) {
    const d = HOOK[pos];
    if (d >= 0) {
      const k = d + (bar % 2 && pos > 8 ? 1 : 0);
      s.kalimba(t, st.root + 36 + PENTA[k % 5] + 12 * Math.floor(k / 5), L >= 5 ? 0.12 : 0.1);
    }
  }
  if (L >= 5 && pos % 2 === 0) s.marimba(t, root + 36 + tri[(pos >> 1) % 3], 0.06);
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
