// Tiny procedural beeps. The AudioContext is created on the first user gesture and is
// suspended whenever the game is paused or the host audio flag is off.
let ctx = null, master = null;

export function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);
  return ctx;
}

/** Run (true) or suspend (false) the context. */
export function setRunning(on) {
  if (!ctx) return;
  if (on && ctx.state !== 'running') ctx.resume().catch(() => {});
  if (!on && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function beep(freq = 660, dur = 0.12, type = 'square') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
