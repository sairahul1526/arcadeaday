// Procedural audio for Don't Pop. Every sound is synthesized, so the same code
// runs live (AudioContext) and offline (OfflineAudioContext) for video export.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// I - V - vi - IV in major, as [semitone offset from root, chord intervals]
const PROG = [[0, [0, 4, 7]], [7, [0, 4, 7]], [9, [0, 3, 7]], [5, [0, 4, 7]]];
const PENTA = [0, 2, 4, 7, 9];
// a bouncy whistle hook, as pentatonic degrees (-1 = rest), one per 8th note over two bars
const HOOK = [4, -1, 3, 2, -1, 0, 1, -1, 2, -1, 3, 4, -1, 5, 4, -1];

export const LAYER_AT = [0, 2, 4, 6, 9, 12];
export const LAYER_NAMES = ['BEAT', 'SHAKER', 'BASS', 'CHORDS', 'WHISTLE', 'PARTY'];
export const ZONE_ROOTS = [48, 50, 45, 47, 43];
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

    // Music runs through a lowpass: it closes as the balloon nears the needle
    // (tension) and "goes underwater" when it pops.
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.9;
    this.lp.connect(comp);

    this.music = c.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.lp);

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.75;
    this.sfx.connect(comp);

    this.noiseBuf = this._noise(2);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(2);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.3;
    this.verbSend.connect(this.verb);
    this.verb.connect(comp);

    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = 0.4;
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
  kick(t, v = 0.8) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, v, 0.26);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.32);
  }
  snap(t) {
    this._hit(t, 0.07, 0.36, 'bandpass', 2400, 2.2, this.music);
    this._hit(t + 0.006, 0.1, 0.18, 'bandpass', 1800, 1.4, this.verbSend);
  }
  shaker(t, v = 0.1) {
    this._hit(t, 0.035, v, 'highpass', 7000, 0.7, this.music, 0.008);
  }
  bass(t, m, dur) {
    this._osc('triangle', mtof(m), t, 0.004, dur, 0.36, this.music);
    this._osc('sine', mtof(m - 12), t, 0.004, dur * 0.8, 0.24, this.music);
  }
  marimba(t, m, v = 0.12, dest = null) {
    this._osc('sine', mtof(m), t, 0.002, 0.32, v, this.music);
    this._osc('sine', mtof(m) * 3.99, t, 0.001, 0.05, v * 0.35, this.music);
    if (dest) this._osc('sine', mtof(m), t, 0.002, 0.25, v * 0.6, dest);
  }
  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.3);
    g.gain.setValueAtTime(0.05, t + Math.max(0.35, dur - 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
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
        o.stop(t + dur + 0.35);
      }
    }
  }
  whistle(t, m, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(m - 1), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.04);
    const lfo = c.createOscillator();
    lfo.frequency.value = 6;
    const lg = c.createGain();
    lg.gain.value = mtof(m) * 0.012;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.setValueAtTime(0.09, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.music);
    g.connect(this.dlySend);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // ---------- sfx
  ding(t, m, big) {
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.3, this.sfx);
    this._osc('sine', mtof(m + 12), t, 0.003, 0.3, 0.1, this.sfx);
    this._osc('triangle', mtof(m + 19), t, 0.003, 0.16, 0.05, this.verbSend);
    this._osc('sine', mtof(m), t, 0.003, 0.6, 0.18, this.verbSend);
    if (big) {
      this._osc('sine', mtof(m + 24), t + 0.06, 0.003, 0.5, 0.12, this.sfx);
      this._osc('sine', mtof(m + 28), t + 0.12, 0.003, 0.5, 0.09, this.verbSend);
      this._hit(t, 0.4, 0.1, 'highpass', 9000, 0.5, this.verbSend, 0.05);
    }
  }
  // one pump stroke: a breathy push of air that rises in pitch as the balloon fills
  pump(t, p = 1, dur = 0.25) {
    const f = this._hit(t, dur, 0.22, 'bandpass', 380 * p, 1.6, this.sfx, dur * 0.4);
    f.frequency.exponentialRampToValueAtTime(1100 * p, t + dur);
    this._hit(t, 0.03, 0.12, 'bandpass', 3200, 3, this.sfx);
  }
  tie(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.09);
    const g = c.createGain();
    this._env(g.gain, t, 0.004, 0.22, 0.12);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    // rubbery twang
    this._osc('triangle', 180, t + 0.03, 0.002, 0.18, 0.12, this.sfx);
  }
  coin(t) {
    this._osc('square', 1318, t, 0.002, 0.05, 0.07, this.sfx);
    this._osc('square', 1975, t + 0.055, 0.002, 0.14, 0.07, this.sfx);
  }
  pop(t) {
    // the crack, the body of the bang, the low thump and a big room tail
    this._hit(t, 0.03, 1, 'highpass', 1800, 0.5, this.sfx, 0.001);
    const f = this._hit(t, 0.35, 0.9, 'lowpass', 6000, 0.7, this.sfx, 0.001);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    this._hit(t, 0.5, 0.35, 'lowpass', 3000, 0.5, this.verbSend, 0.001);
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.9, 0.35);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + 0.45);
  }
  fizzle(t) {
    // a deflating raspberry: buzzy pitch that wobbles and sags
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 1.3);
    const lfo = c.createOscillator();
    lfo.frequency.setValueAtTime(14, t);
    lfo.frequency.linearRampToValueAtTime(7, t + 1.3);
    const lg = c.createGain();
    lg.gain.value = 40;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.setValueAtTime(0.16, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.4);
    lfo.stop(t + 1.4);
    this._hit(t, 1.3, 0.14, 'bandpass', 1500, 1.2, this.sfx, 0.02);
  }
  snapOn(t) {
    this._osc('triangle', 520, t, 0.002, 0.06, 0.12, this.sfx);
    this._hit(t, 0.03, 0.12, 'bandpass', 2600, 2, this.sfx);
  }
  needle(t) {
    this._osc('sine', 2637, t, 0.002, 0.25, 0.05, this.sfx);
    this._osc('sine', 3951, t + 0.02, 0.002, 0.2, 0.035, this.verbSend);
    const f = this._hit(t, 0.18, 0.06, 'bandpass', 900, 1.5, this.sfx, 0.05);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.2);
  }
  heart(t) {
    this._osc('sine', 62, t, 0.004, 0.12, 0.5, this.sfx);
    this._osc('sine', 58, t + 0.16, 0.004, 0.14, 0.38, this.sfx);
  }
  zone(t, root) {
    const f = this._hit(t, 0.9, 0.2, 'bandpass', 400, 2, this.sfx, 0.6);
    f.frequency.exponentialRampToValueAtTime(7000, t + 0.6);
    [0, 7, 12, 16].forEach((x, i) => this.ding(t + 0.6 + i * 0.07, root + 24 + x, i === 3));
  }
  best(t, root) {
    [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => {
      this._osc('square', mtof(root + 24 + x), t + i * 0.055, 0.002, 0.16, 0.06, this.sfx);
      this._osc('sine', mtof(root + 24 + x), t + i * 0.055, 0.002, 0.3, 0.12, this.verbSend);
    });
  }
  click(t) {
    this._osc('sine', 880, t, 0.002, 0.05, 0.12, this.sfx);
  }
  start(t) {
    this._osc('triangle', 392, t, 0.004, 0.1, 0.12, this.sfx);
    this._osc('triangle', 587, t + 0.08, 0.004, 0.16, 0.12, this.sfx);
  }
  // Continuous stretchy-rubber squeak while the balloon grows. Returns [gain, osc].
  squeak(t = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 300;
    const lfo = c.createOscillator();
    lfo.frequency.value = 23;
    const lg = c.createGain();
    lg.gain.value = 18;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.value = 900;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    o.start(t);
    lfo.start(t);
    return { g, o, f };
  }
  under(t, on) {
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(on ? 380 : 18000, t, on ? 0.1 : 0.04);
  }
  // 0 = open, 1 = muffled: the music holds its breath near the needle
  tension(t, v) {
    this.lp.frequency.setTargetAtTime(18000 * Math.pow(900 / 18000, Math.min(1, v)), t, 0.06);
  }

  play(type, t, e = {}) {
    switch (type) {
      case 'ding': return this.ding(t, e.m, e.big);
      case 'pump': return this.pump(t, e.p, e.d);
      case 'tie': return this.tie(t);
      case 'coin': return this.coin(t);
      case 'pop': this.pop(t); return this.under(t, true);
      case 'fizzle': this.fizzle(t); return this.under(t + 0.2, true);
      case 'revive': return this.under(t, false);
      case 'snap': return this.snapOn(t);
      case 'needle': return this.needle(t);
      case 'heart': return this.heart(t);
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

  if (pos === 0 || pos === 8 || (L >= 5 && (pos === 4 || pos === 12)) || (L >= 2 && pos === 10)) s.kick(t, 0.75);
  if (pos === 4 || pos === 12) s.snap(t);
  if (L >= 1 && pos % 2 === 0) s.shaker(t, pos % 4 === 2 ? 0.11 : 0.06);
  if (L >= 2 && pos % 4 !== 1 && pos % 4 !== 3) s.bass(t, root - 12 + (pos % 8 === 6 ? 7 : pos % 8 === 4 ? 12 : 0), sd * 1.6);
  if (L >= 3) {
    if (pos === 0) s.pad(t, tri.map(x => root + 12 + x), sd * 16);
    if (pos === 2 || pos === 6 || pos === 10 || pos === 14) tri.forEach(x => s.marimba(t, root + 24 + x, 0.045));
  }
  if (L >= 4 && pos % 2 === 0) {
    const d = HOOK[((bar % 2) * 8 + pos / 2) | 0];
    if (d >= 0) s.whistle(t, st.root + 36 + PENTA[d % 5] + (d >= 5 ? 12 : 0), sd * 1.8);
  }
  if (L >= 5) {
    const arp = [0, 1, 2, 1];
    s.marimba(t, root + 36 + tri[arp[pos % 4]] + (pos >= 8 ? 12 : 0), 0.06, s.dlySend);
    if (pos % 2 === 1) s.shaker(t, 0.05);
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
  for (const [tt, v] of log.tension) if (tt < dur) s.tension(tt, v);
  for (const e of log.events) if (e.t < dur) s.play(e.type, e.t, e);
  const sq = s.squeak(0);
  for (const [tt, v, f] of log.squeak) {
    if (tt >= dur) continue;
    sq.g.gain.setTargetAtTime(v, tt, 0.02);
    sq.o.frequency.setTargetAtTime(f, tt, 0.02);
    sq.f.frequency.setTargetAtTime(f * 3, tt, 0.02);
  }
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
