// Procedural audio for Cat Stack. Every sound (lo-fi music, meows, purrs) is synthesized,
// so the same code runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ii7 - V7 - Imaj7 - vi7, as [semitone offset from root, chord intervals]
const PROG = [[2, [0, 3, 7, 10]], [7, [0, 4, 7, 10]], [0, [0, 4, 7, 11]], [9, [0, 3, 7, 10]]];
const MAJ_PENTA = [0, 2, 4, 7, 9];

export const LAYER_AT = [0, 4, 9, 16, 26];
export const LAYER_NAMES = ['KEYS', 'BRUSHES', 'BASS', 'MELODY', 'FULL BAND'];
export const ZONE_ROOTS = [53, 51, 55, 50, 52, 48];
export const layerFor = n => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (n >= LAYER_AT[i]) l = i;
  return l;
};
// The PURRFECT streak sings: each perfect drop meows the next note up the scale.
export const meowNote = (root, k) => {
  k = Math.min(k, 12);
  return root + 24 + MAJ_PENTA[k % 5] + 12 * Math.floor(k / 5);
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
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    comp.connect(this.master);

    // Music runs through a lowpass so a collapse can "go underwater".
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 16000;
    this.lp.Q.value = 0.7;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.lp);

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(comp);

    this.noiseBuf = this._noise(2);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(2.4);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.3;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.49;
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

  // ---------- instruments (cozy lo-fi)
  kick(t, v = 0.7) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, v, 0.3);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.36);
  }
  snap(t) {
    this._hit(t, 0.09, 0.32, 'bandpass', 2100, 1.6, this.music);
    this._hit(t + 0.008, 0.12, 0.16, 'bandpass', 1700, 1.2, this.verbSend);
  }
  brush(t, v = 0.07, long = false) {
    this._hit(t, long ? 0.16 : 0.05, v, 'highpass', 6500, 0.6, this.music, long ? 0.02 : 0.002);
  }
  bass(t, m, dur) {
    this._osc('sine', mtof(m), t, 0.01, dur, 0.34, this.music);
    this._osc('triangle', mtof(m), t, 0.01, dur * 0.5, 0.12, this.music);
  }
  keys(t, notes, dur, v = 0.05) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.verbSend);
    for (const m of notes) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(m);
      o.detune.value = (m % 3) * 3 - 3;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.5);
      const o2 = c.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = mtof(m + 12);
      const g2 = c.createGain();
      this._env(g2.gain, t, 0.004, 0.25, 0.25);
      o2.connect(g2);
      g2.connect(f);
      o2.start(t);
      o2.stop(t + 0.35);
    }
  }
  bell(t, m, v = 0.08) {
    this._osc('sine', mtof(m), t, 0.004, 0.5, v, this.music);
    this._osc('sine', mtof(m + 19), t, 0.002, 0.12, v * 0.25, this.music);
    const o = this._osc('triangle', mtof(m), t, 0.004, 0.3, v * 0.5, this.dlySend);
    void o;
  }

  // ---------- sfx
  // A cartoon meow: a glide through two formant filters ("mee-OW").
  meow(t, m, dur = 0.42, v = 0.34) {
    const c = this.ctx;
    const f0 = mtof(m);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.82, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.06, t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.78, t + dur);
    const vib = c.createOscillator();
    vib.frequency.value = 7;
    const vg = c.createGain();
    vg.gain.value = f0 * 0.02;
    vib.connect(vg);
    vg.connect(o.frequency);
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(v, t + 0.04);
    out.gain.setValueAtTime(v, t + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    const forms = [
      [[650, 1150, 520], 9, 1],
      [[1900, 2500, 1300], 11, 0.55],
      [[3100, 3300, 2700], 12, 0.25],
    ];
    for (const [fr, q, gain] of forms) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(fr[0], t);
      f.frequency.linearRampToValueAtTime(fr[1], t + dur * 0.35);
      f.frequency.linearRampToValueAtTime(fr[2], t + dur);
      const g = c.createGain();
      g.gain.value = gain * 3;
      o.connect(f);
      f.connect(g);
      g.connect(out);
    }
    out.connect(this.sfx);
    const vs = c.createGain();
    vs.gain.value = 0.35;
    out.connect(vs);
    vs.connect(this.verbSend);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }
  purr(t, dur = 0.7, v = 0.2) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const am = c.createGain();
    am.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 24;
    const lg = c.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg);
    lg.connect(am.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.08);
    g.gain.setValueAtTime(v, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(am);
    am.connect(g);
    g.connect(this.sfx);
    s.start(t, Math.random());
    lfo.start(t);
    s.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }
  thump(t, heavy) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(heavy ? 150 : 210, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 45 : 70, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, heavy ? 0.75 : 0.5, heavy ? 0.22 : 0.14);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
    this._hit(t, 0.07, 0.18, 'lowpass', 900, 0.7, this.sfx);
  }
  sparkle(t, root) {
    [0, 4, 7, 12].forEach((x, i) => {
      this._osc('sine', mtof(root + 48 + x), t + i * 0.035, 0.002, 0.25, 0.05, this.sfx);
      this._osc('sine', mtof(root + 48 + x), t + i * 0.035, 0.002, 0.4, 0.05, this.verbSend);
    });
  }
  whoosh(t) {
    const f = this._hit(t, 0.4, 0.22, 'bandpass', 1800, 1.4, this.sfx, 0.08);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.45);
  }
  creak(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(95, t + 0.35);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
  }
  crash(t) {
    const f = this._hit(t, 0.7, 0.7, 'lowpass', 2200, 0.8, this.sfx);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    this.thump(t, true);
    this.thump(t + 0.13, false);
    this.thump(t + 0.27, true);
    [74, 79, 71, 82, 76].forEach((m, i) => this.meow(t + 0.02 + i * 0.09, m, 0.32 + (i % 2) * 0.12, 0.2));
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.06, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.06, this.sfx);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.2, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.6);
    [0, 4, 7, 12].forEach((x, i) => this.bell(t + 0.6 + i * 0.08, root + 36 + x, 0.12));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.16, 0.05, this.sfx);
      this._osc('sine', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.3, 0.1, this.verbSend);
    });
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 420 : 16000, t, on ? 0.12 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'land':
        this.thump(t, e.heavy);
        if (e.m) this.meow(t + 0.03, e.m, e.perfect ? 0.38 : 0.3, e.perfect ? 0.34 : 0.2);
        if (e.perfect) {
          this.purr(t + 0.1, 0.6, 0.16);
          this.sparkle(t + 0.02, e.root);
        }
        return;
      case 'drop': return this.whoosh(t);
      case 'miss': this.meow(t, e.m || 74, 0.65, 0.3); return this.whoosh(t);
      case 'creak': return this.creak(t);
      case 'crash': this.crash(t); return this.under(t, true);
      case 'revive': return this.under(t, false);
      case 'coin': return this.coin(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'click': return this.click(t);
      case 'start': return this.meow(t, 79, 0.36, 0.26);
    }
  }
}

// One 8th-note step of the soundtrack (lazy swing). st = { layer, root, bpm }
export function stepMusic(s, step, t, st) {
  const pos = step % 8;
  const bar = (step / 8) | 0;
  const [off, tri] = PROG[bar % 4];
  const root = st.root + off;
  const L = st.layer;
  const e8 = 60 / st.bpm / 2;
  if (pos === 0) s.dly.delayTime.setValueAtTime(e8 * 1.5, t);

  if (pos === 0 || pos === 5) s.kick(t, L >= 4 ? 0.8 : 0.65);
  if (pos === 2 || pos === 6) s.snap(t);
  if (pos === 0) s.keys(t, tri.map(x => root + 12 + x), e8 * 3);
  if (pos === 3) s.keys(t, tri.map(x => root + 12 + x), e8 * 2, 0.035);
  if (L >= 1) {
    if (pos % 2 === 1) s.brush(t, 0.05);
    if (pos === 6) s.brush(t, 0.06, true);
  }
  if (L >= 2) {
    if (pos === 0) s.bass(t, root - 12, e8 * 2.6);
    if (pos === 4) s.bass(t, root - 12 + 7, e8 * 1.6);
    if (pos === 7) s.bass(t, root - 12 + (bar % 2 ? 10 : 5), e8 * 0.8);
  }
  if (L >= 3) {
    const mel = [[0, 7], [3, 4], [5, 2], [6, 9]];
    for (const [p, iv] of mel) if (pos === p && (bar + p) % 3 !== 2) s.bell(t, st.root + 24 + iv + (bar % 4 === 3 ? 2 : 0), 0.06);
  }
  if (L >= 4) {
    if (pos % 2 === 0) s.brush(t, 0.035);
    if (pos === 4) s.bell(t, root + 36 + tri[2], 0.045);
  }
}

// Live lookahead scheduler.
export class Music {
  constructor(synth) {
    this.s = synth;
    this.step = 0;
    this.next = 0;
    this.on = false;
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
    while (this.next < now + 0.15) {
      stepMusic(this.s, this.step, this.next, st);
      this.next += 60 / st.bpm / 2;
      this.step++;
    }
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
    t += 60 / st[si].bpm / 2;
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
