// Slurp Pot event bus (Core, GDD §13.3). Synchronous; a throwing listener never breaks the loop or the other
// listeners: its error goes to P.error (game.js installs it with setReporter) and emit carries on.
// DECISION: no static import of platform.js here, so Node tools can import bus.js too (platform.js needs a
// browser); until game.js calls setReporter(P.error) errors go to console.warn.

const subs = new Map(); // ev -> array of fns (copied on write, so emit can iterate safely while listeners come and go)
let reporter = e => { try { console.warn('[bus]', (e && e.message) || e); } catch {} };

/** Subscribes fn to ev; returns off(). '*' receives every event as fn(data, ev). */
export function on(ev, fn) {
  if (typeof fn !== 'function') return () => {};
  subs.set(ev, [...(subs.get(ev) || []), fn]);
  return () => {
    const a = subs.get(ev);
    if (!a) return;
    const b = a.filter(f => f !== fn);
    if (b.length) subs.set(ev, b); else subs.delete(ev);
  };
}

/** Calls every listener of ev (then the '*' listeners) with (data, ev), synchronously. */
export function emit(ev, data) {
  const a = subs.get(ev), all = subs.get('*');
  if (a) for (const fn of a) { try { fn(data, ev); } catch (e) { report(e, ev); } }
  if (all && ev !== '*') for (const fn of all) { try { fn(data, ev); } catch (e) { report(e, ev); } }
}

/** True if ev has at least one listener. */
export function has(ev) { return !!subs.get(ev); }

/** game.js passes P.error. */
export function setReporter(fn) { if (typeof fn === 'function') reporter = fn; }

let lastMsg = '', lastT = 0;
function report(e, ev) {
  // Dedupe a listener that throws every frame: one report per message per 2 s.
  const msg = `[bus ${ev}] ${(e && e.message) || e}`;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (msg === lastMsg && now - lastT < 2000) return;
  lastMsg = msg; lastT = now;
  try { reporter(new Error(msg)); } catch {}
  if (e && e.stack) try { console.debug(e.stack); } catch {}
}

export default { on, emit, has, setReporter };
