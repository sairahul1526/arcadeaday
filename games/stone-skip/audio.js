// Procedural audio for Stone Skip. Every sound is synthesized, so the same
// code runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ii7 - V7 - Imaj7 - vi7, the lo-fi staple. [semitone offset from root, chord intervals]
const PROG = [[2, [0, 3, 7, 10]], [7, [0, 4, 7, 10]], [0, [0, 4, 7, 11]], [9, [0, 3, 7, 10]]];
const PENTA = [0, 2, 4, 7, 9];

// The soundtrack adds a layer as the skip count climbs.
export const LAYER_AT = [0, 3, 8, 15, 25, 45];
export const ZONE_ROOTS = [48, 50, 45, 47, 43, 46, 52];
export const layerFor = skips => {
  let l = 0;
  for (let i = 0; i < LAYER_AT.length; i++) if (skips >= LAYER_AT[i]) l = i;
  return l;
};
// Kalimba note for a skip: PERFECT streaks climb the scale.
export const skipNote = (root, q, streak) => {
  const k = q === 'PERFECT' ? Math.min(streak - 1, 12) : q === 'GREAT' ? 0 : -3;
  const kk = Math.max(0, k);
  return root + 36 + PENTA[kk % 5] + 12 * Math.floor(kk / 5) + (k < 0 ? -5 : 0);
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

    // Music runs through a lowpass so the plunk can "go underwater".
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
    this.verb.buffer = this._impulse(2.6);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.34;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.36;
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
    dOut.connect(comp);
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
  kick(t, v = 0.7) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, v, 0.3);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }
  snap(t) {
    this._hit(t, 0.09, 0.32, 'bandpass', 1900, 1.4, this.music);
    this._hit(t, 0.2, 0.16, 'bandpass', 1500, 1, this.verbSend);
  }
  hat(t, v = 0.1) {
    this._hit(t, 0.035, v, 'highpass', 7800, 0.8, this.music);
  }
  shaker(t, v = 0.05) {
    this._hit(t, 0.06, v, 'bandpass', 6000, 1.5, this.music, 0.02);
  }
  bass(t, m, dur) {
    this._osc('triangle', mtof(m), t, 0.01, dur, 0.32, this.music);
    this._osc('sine', mtof(m - 12), t, 0.01, dur, 0.3, this.music);
  }
  // Soft electric piano: sine body plus a quick bell tine, slow tremolo through the verb.
  keys(t, notes, dur, v = 0.05) {
    for (const m of notes) {
      this._osc('sine', mtof(m), t, 0.01, dur, v, this.music);
      this._osc('sine', mtof(m), t, 0.01, dur, v * 0.6, this.verbSend, 6);
      this._osc('sine', mtof(m + 24), t, 0.002, 0.25, v * 0.25, this.music);
    }
  }
  kalimba(t, m, v = 0.16) {
    this._osc('sine', mtof(m), t, 0.002, 0.9, v, this.sfx);
    this._osc('sine', mtof(m) * 5.4, t, 0.001, 0.07, v * 0.25, this.sfx);
    this._osc('triangle', mtof(m + 12), t, 0.002, 0.25, v * 0.2, this.sfx);
    this._osc('sine', mtof(m), t, 0.002, 0.8, v * 0.6, this.dlySend);
    this._osc('sine', mtof(m), t, 0.002, 0.9, v * 0.5, this.verbSend);
  }
  melody(t, m) {
    this._osc('sine', mtof(m), t, 0.004, 0.35, 0.06, this.music);
    this._osc('sine', mtof(m), t, 0.004, 0.35, 0.05, this.dlySend);
  }

  // ---------- sfx
  // The water "plip" of a skip: a pitch-dropping blip plus a short bandpassed splash.
  plip(t, big) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 1300 : 1000, t);
    o.frequency.exponentialRampToValueAtTime(big ? 380 : 320, t + 0.07);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.28, 0.09);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
    const f = this._hit(t, big ? 0.22 : 0.14, big ? 0.3 : 0.2, 'bandpass', 3200, 1.1, this.sfx);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
  }
  skip(t, q, m) {
    this.plip(t, q === 'PERFECT');
    if (q === 'OK') this._osc('triangle', mtof(m), t, 0.003, 0.2, 0.08, this.sfx);
    else this.kalimba(t, m, q === 'PERFECT' ? 0.17 : 0.11);
    if (q === 'PERFECT') this._hit(t, 0.35, 0.06, 'highpass', 9000, 0.5, this.verbSend, 0.03);
  }
  coin(t) {
    this._osc('square', 1568, t, 0.002, 0.05, 0.06, this.sfx);
    this._osc('square', 2093, t + 0.05, 0.002, 0.14, 0.06, this.sfx);
  }
  plunk(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.9, 0.35);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
    const f = this._hit(t, 0.45, 0.5, 'lowpass', 1800, 1, this.sfx);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    // bubbles
    for (let i = 0; i < 7; i++) {
      const tt = t + 0.18 + i * 0.09 + Math.random() * 0.04;
      const b = c.createOscillator();
      b.type = 'sine';
      const f0 = 300 + Math.random() * 500;
      b.frequency.setValueAtTime(f0, tt);
      b.frequency.exponentialRampToValueAtTime(f0 * 2.2, tt + 0.05);
      const bg = c.createGain();
      this._env(bg.gain, tt, 0.002, 0.08, 0.05);
      b.connect(bg);
      bg.connect(this.sfx);
      b.start(tt);
      b.stop(tt + 0.1);
    }
  }
  wobble(t) {
    this._osc('square', 220, t, 0.002, 0.12, 0.08, this.sfx);
    this._osc('square', 165, t + 0.09, 0.002, 0.18, 0.08, this.sfx);
  }
  throwIt(t) {
    const f = this._hit(t, 0.3, 0.22, 'bandpass', 600, 1.2, this.sfx, 0.06);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.3);
  }
  low(t) {
    this._osc('sine', 660, t, 0.002, 0.08, 0.07, this.sfx);
    this._osc('sine', 660, t + 0.12, 0.002, 0.08, 0.07, this.sfx);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.18, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.6);
    [0, 4, 7, 12].forEach((x, i) => this.kalimba(t + 0.6 + i * 0.08, root + 36 + x, 0.12));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.16, 0.05, this.sfx);
      this._osc('sine', mtof(root + 36 + x), t + i * 0.055, 0.002, 0.3, 0.1, this.verbSend);
    });
  }
  record(t, root) {
    this.best(t, root);
    [[0, 4, 7], [5, 9, 12], [7, 11, 14], [12, 16, 19]].forEach((ch, i) => {
      for (const x of ch) {
        this._osc('sawtooth', mtof(root + 24 + x), t + 0.4 + i * 0.18, 0.01, i === 3 ? 1.2 : 0.18, 0.035, this.sfx);
        this._osc('sine', mtof(root + 24 + x), t + 0.4 + i * 0.18, 0.01, i === 3 ? 1.4 : 0.2, 0.06, this.verbSend);
      }
    });
    this._hit(t + 0.94, 1.2, 0.15, 'highpass', 8000, 0.5, this.verbSend, 0.05);
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 380 : 16000, t, on ? 0.1 : 0.04);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'skip': return this.skip(t, e.q, e.m);
      case 'coin': return this.coin(t);
      case 'plunk': this.plunk(t); return this.under(t, true);
      case 'revive': return this.under(t, false);
      case 'wobble': return this.wobble(t);
      case 'throw': return this.throwIt(t);
      case 'low': return this.low(t);
      case 'zone': return this.zone(t, e.root);
      case 'best': return this.best(t, e.root);
      case 'record': return this.record(t, e.root);
      case 'click': return this.click(t);
    }
  }
}

// One 16th-note step of the adaptive soundtrack. st = { layer, root, bpm }
export function stepMusic(s, step, t, st) {
  const pos = step % 16;
  const bar = (step / 16) | 0;
  const [off, ch] = PROG[bar % 4];
  const root = st.root + off;
  const L = st.layer;
  const sd = 60 / st.bpm / 4;
  // lazy swing on the off 16ths
  const tt = pos % 2 ? t + sd * 0.16 : t;
  if (pos === 0) s.dly.delayTime.setValueAtTime(sd * 3, t);

  if (pos === 0) s.keys(t, ch.map(x => root + 12 + x), sd * 15, L >= 4 ? 0.04 : 0.05);
  if (L >= 1) {
    if (pos === 0 || pos === 10) s.kick(t, 0.7);
    if (pos === 4 || pos === 12) s.snap(t);
  }
  if (L >= 2 && pos % 2 === 0) s.hat(tt, pos % 4 === 2 ? 0.1 : 0.05);
  if (L >= 3) {
    if (pos === 0) s.bass(t, root - 12, sd * 5);
    if (pos === 6) s.bass(t, root - 12 + ch[2], sd * 2);
    if (pos === 10) s.bass(t, root - 12, sd * 4);
  }
  if (L >= 4) {
    const arp = [0, 2, 1, 3, 2, 1, 3, 2];
    if (pos % 2 === 0) s.melody(tt, root + 24 + ch[arp[(pos >> 1) % 8]] + (bar % 2 && pos >= 8 ? 12 : 0));
  }
  if (L >= 5) {
    s.shaker(tt, pos % 4 === 2 ? 0.06 : 0.03);
    if (pos === 14) s.kick(t, 0.5);
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
    while (this.next < now + 0.12) {
      stepMusic(this.s, this.step, this.next, st);
      this.next += 60 / st.bpm / 4;
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
