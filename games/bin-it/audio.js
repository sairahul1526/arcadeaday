// Procedural audio for Bin It. Every sound is synthesized, so the same code
// runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ii7 - V7 - Imaj7 - vi7, a lazy office lo-fi loop: [bass offset from root, chord root, chord intervals]
const PROG = [[2, 2, [0, 3, 7, 10]], [-5, 7, [0, 4, 7, 10]], [0, 0, [0, 4, 7, 11]], [-3, 9, [0, 3, 7, 10]]];
const PENTA = [0, 2, 4, 7, 9];

// Music layers follow the SWISH streak. The last one is ON FIRE (double points).
export const LAYER_AT = [0, 1, 2, 3, 4, 6];
export const LAYER_NAMES = ['BEAT', 'HATS', 'BASS', 'KEYS', 'VIBES', 'ON FIRE'];
export const ZONE_ROOTS = [48, 50, 46, 53, 45];
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

    // Music runs through a lowpass so a spill can "go underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.8;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.5;
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
    this.dly.delayTime.value = 0.45;
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
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.32);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
    this._hit(t, 0.015, 0.2 * v, 'highpass', 3500, 0.7, this.music);
  }
  snare(t, v = 0.38) {
    this._hit(t, 0.16, v, 'bandpass', 1900, 0.9, this.music);
    this._osc('triangle', 210, t, 0.002, 0.08, v * 0.6, this.music);
    this._hit(t + 0.01, 0.12, v * 0.5, 'bandpass', 1500, 1.2, this.verbSend);
  }
  hat(t, v = 0.13, open = false) {
    this._hit(t, open ? 0.18 : 0.04, v, 'highpass', 8500, 0.8, this.music);
  }
  bass808(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(m + 12), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.05);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.42, dur);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
    this._osc('triangle', mtof(m + 12), t, 0.004, dur * 0.5, 0.06, this.music);
  }
  keys(t, notes, dur) {
    for (const m of notes) {
      this._osc('sine', mtof(m), t, 0.004, dur, 0.06, this.music);
      this._osc('triangle', mtof(m), t, 0.004, dur * 0.4, 0.025, this.music, 6);
      this._osc('sine', mtof(m + 12), t, 0.003, dur * 0.25, 0.015, this.verbSend);
    }
  }
  marimba(t, m, v = 0.16) {
    this._osc('sine', mtof(m), t, 0.002, 0.32, v, this.music);
    this._osc('sine', mtof(m) * 4, t, 0.001, 0.05, v * 0.25, this.music);
    this._osc('sine', mtof(m), t, 0.002, 0.3, v * 0.4, this.dlySend);
  }
  brass(t, notes) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(800, t);
    f.frequency.linearRampToValueAtTime(3200, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.22);
    const g = c.createGain();
    this._env(g.gain, t, 0.01, 0.06, 0.2);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes)
      for (const dt of [-10, 10]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = dt;
        o.connect(f);
        o.start(t);
        o.stop(t + 0.3);
      }
  }

  // ---------- sfx
  ding(t, m, big) {
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.3, this.sfx);
    this._osc('sine', mtof(m + 12), t, 0.003, 0.3, 0.1, this.sfx);
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.18, this.verbSend);
    if (big) {
      this._osc('sine', mtof(m + 19), t + 0.06, 0.003, 0.45, 0.12, this.sfx);
      this._osc('sine', mtof(m + 24), t + 0.12, 0.003, 0.45, 0.09, this.verbSend);
      this._hit(t, 0.35, 0.1, 'highpass', 9000, 0.5, this.verbSend, 0.04);
    }
  }
  // Paper being scrunched: a burst of tiny bandpassed crackles.
  crumple(t, v = 1) {
    for (let i = 0; i < 9; i++) {
      const t0 = t + i * 0.016 + Math.random() * 0.012;
      this._hit(t0, 0.018 + Math.random() * 0.02, (0.1 + Math.random() * 0.12) * v, 'bandpass', 2500 + Math.random() * 3500, 2.5, this.sfx, 0.001);
    }
  }
  // Wire-mesh office bin: a bright, inharmonic clang.
  rim(t, v = 1) {
    for (const [hz, d, a] of [[523, 0.32, 0.16], [1307, 0.2, 0.1], [2153, 0.14, 0.07], [3389, 0.09, 0.05]]) this._osc('sine', hz * (0.98 + Math.random() * 0.04), t, 0.001, d, a * v, this.sfx);
    this._osc('sine', 523, t, 0.001, 0.3, 0.06 * v, this.verbSend);
    this._hit(t, 0.02, 0.2 * v, 'highpass', 4000, 0.8, this.sfx);
  }
  // Paper ball landing on the bin floor: soft papery thud.
  thud(t, v = 1) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.42 * v, 0.12);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    this._hit(t, 0.05, 0.22 * v, 'bandpass', 1400, 1.2, this.sfx);
    this.crumple(t + 0.01, 0.35 * v);
  }
  // Clean swish through the opening.
  swish(t) {
    const f = this._hit(t, 0.22, 0.2, 'bandpass', 3000, 0.8, this.sfx, 0.03);
    f.frequency.exponentialRampToValueAtTime(6500, t + 0.2);
  }
  floor(t) {
    const f = this._hit(t, 0.12, 0.4, 'lowpass', 900, 0.8, this.sfx);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.1);
    this.crumple(t + 0.02, 0.4);
  }
  // Sad trombone: wah, wah, wah, waaaah.
  aww(t) {
    const c = this.ctx;
    const notes = [[0, 0.26, 62], [0.3, 0.26, 61], [0.6, 0.26, 60], [0.9, 0.9, 59]];
    for (const [o0, d, m] of notes) {
      const t0 = t + o0;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(mtof(m), t0);
      if (d > 0.5) {
        const lfo = c.createOscillator();
        lfo.frequency.value = 6;
        const lg = c.createGain();
        lg.gain.value = 9;
        lfo.connect(lg);
        lg.connect(o.frequency);
        lfo.start(t0 + 0.15);
        lfo.stop(t0 + d + 0.05);
        o.frequency.linearRampToValueAtTime(mtof(m - 0.6), t0 + d);
      }
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(500, t0);
      f.frequency.linearRampToValueAtTime(1500, t0 + 0.08);
      f.frequency.linearRampToValueAtTime(700, t0 + d);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.13, t0 + 0.04);
      g.gain.setValueAtTime(0.13, t0 + d - 0.06);
      g.gain.linearRampToValueAtTime(0.0001, t0 + d);
      o.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      g.connect(this.verbSend);
      o.start(t0);
      o.stop(t0 + d + 0.05);
    }
  }
  fire(t) {
    const f = this._hit(t, 0.7, 0.3, 'lowpass', 500, 0.8, this.sfx, 0.08);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
    for (let i = 0; i < 8; i++) this._hit(t + 0.1 + i * 0.06 + Math.random() * 0.04, 0.02, 0.12, 'highpass', 5000, 1, this.sfx, 0.001);
  }
  tock(t, v = 0.5) {
    this._osc('triangle', 680 + Math.random() * 80, t, 0.001, 0.03, 0.12 * v, this.sfx);
    this._hit(t, 0.025, 0.12 * v, 'bandpass', 1200, 2, this.sfx);
  }
  whoosh(t, v = 1) {
    const f = this._hit(t, 0.3, 0.2 * v, 'bandpass', 450, 1.4, this.sfx, 0.04);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.32);
  }
  // The meme air horn: three blasts of a detuned saw chord.
  airhorn(t) {
    const c = this.ctx;
    const blasts = [[0, 0.32], [0.38, 0.12], [0.55, 0.6]];
    for (const [o0, d] of blasts) {
      const t0 = t + o0;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 3800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.11, t0 + 0.02);
      g.gain.setValueAtTime(0.11, t0 + d - 0.04);
      g.gain.linearRampToValueAtTime(0.0001, t0 + d);
      f.connect(g);
      g.connect(this.sfx);
      g.connect(this.verbSend);
      for (const [hz, dt] of [[466, -8], [466, 9], [587, 0], [698, -5]]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(hz, t0);
        o.frequency.linearRampToValueAtTime(hz * 0.985, t0 + d);
        o.detune.value = dt;
        o.connect(f);
        o.start(t0);
        o.stop(t0 + d + 0.05);
      }
    }
  }
  crowd(t, v = 0.22) {
    const f = this._hit(t, 1.6, v, 'bandpass', 1100, 0.6, this.sfx, 0.18);
    f.frequency.linearRampToValueAtTime(1700, t + 0.5);
    this._hit(t + 0.05, 1.3, v * 0.6, 'bandpass', 2600, 1.2, this.verbSend, 0.2);
  }
  gasp(t) {
    const f = this._hit(t, 0.6, 0.12, 'bandpass', 700, 1.2, this.sfx, 0.35);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.8);
  }
  pop(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.06);
    const g = c.createGain();
    this._env(g.gain, t, 0.001, 0.25, 0.07);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.06, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.06, this.sfx);
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
    this._env(g.gain, t, 0.005, 0.18, 0.4);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.2, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(7000, t + 0.6);
    [0, 7, 12, 16].forEach((x, i) => this.ding(t + 0.6 + i * 0.07, root + 24 + x, i === 3));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 24 + x), t + i * 0.055, 0.002, 0.16, 0.05, this.sfx);
      this._osc('sine', mtof(root + 24 + x), t + i * 0.055, 0.002, 0.3, 0.12, this.verbSend);
    });
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  start(t) {
    this.crumple(t, 0.8);
    this._osc('sine', 523, t + 0.05, 0.003, 0.15, 0.12, this.sfx);
    this._osc('sine', 784, t + 0.12, 0.003, 0.25, 0.12, this.sfx);
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 420 : 18000, t, on ? 0.12 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'ding': return this.ding(t, e.m, e.big);
      case 'throw': this.whoosh(t, e.v ?? 1); return this.crumple(t, 0.25);
      case 'crumple': return this.crumple(t, e.v ?? 1);
      case 'rim': return this.rim(t, e.v ?? 1);
      case 'thud': return this.thud(t, e.v ?? 1);
      case 'swish': return this.swish(t);
      case 'tock': return this.tock(t, e.v ?? 0.5);
      case 'fire': this.airhorn(t); this.fire(t); return this.crowd(t + 0.05);
      case 'cheer': return this.crowd(t, e.v ?? 0.14);
      case 'gasp': return this.gasp(t);
      case 'miss': this.floor(t); this.aww(t + 0.15); return this.under(t, true);
      case 'floor': return this.floor(t);
      case 'revive': return this.under(t, false);
      case 'coin': return this.coin(t);
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
  const [boff, coff, tri] = PROG[bar % 4];
  const root = st.root;
  const L = st.layer;
  const sd = 60 / st.bpm / 4;
  if (pos === 0) s.dly.delayTime.setValueAtTime(sd * 3, t);

  const sw = pos % 2 === 1 ? sd * 0.18 : 0; // lazy swing on the off 16ths
  const ch = tri.map(x => root + 12 + coff + x - (coff > 6 ? 12 : 0));

  // boom-bap: kick on 1 and the "a" of 2, snare on 2 and 4
  if (pos === 0 || pos === 7 || pos === 10 || (L >= 5 && pos === 14)) s.kick(t + sw, L >= 5 ? 1 : 0.85);
  if (pos === 4 || pos === 12) s.snare(t, L >= 5 ? 0.42 : 0.34);
  if (L >= 1) {
    if (pos % 2 === 0 || L >= 4) s.hat(t + sw, pos % 4 === 2 ? 0.11 : 0.06);
    if (L >= 5 && pos === 14) s.hat(t, 0.1, true);
  }
  if (L >= 2 && (pos === 0 || pos === 7 || pos === 10)) s.bass808(t + sw, root - 12 + boff, sd * (pos === 0 ? 6.5 : 3));
  if (L >= 3 && (pos === 0 || pos === 6 || (L >= 5 && pos === 11))) s.keys(t + sw, ch, sd * (pos === 0 ? 5 : 3));
  if (L >= 4) {
    const mel = [0, -1, -1, 2, -1, -1, 1, -1, 3, -1, 2, -1, -1, 4, -1, 2];
    const i = mel[pos];
    if (i >= 0) {
      const scale = [0, 2, 4, 7, 9, 12];
      s.marimba(t + sw, root + 24 + coff - (coff > 6 ? 12 : 0) + scale[(i + bar) % scale.length], L >= 5 ? 0.13 : 0.15);
    }
  }
  if (L >= 5 && (pos === 0 || pos === 3 || pos === 6) && bar % 2 === 0) s.brass(t, ch.slice(0, 3));
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
