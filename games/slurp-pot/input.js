// Slurp Pot input (Core, GDD §2.1 / §13.3): one floating relative-drag stick for touch and mouse, WASD/arrows,
// a lost-pointerup guard for touch, and pointer capture wrapped in try/catch (synthetic pointerIds throw).
// Logic gets inp = { x, z, m }: unit direction on the ground, screen up = world -z, magnitude m in [0, 1].
//
// createInput(uiCanvas, getLayout) -> { sample(), held, stick(), reset(), setBlockRects(rects), enable(on), type }
//   - Listens to pointer events on uiCanvas (the top canvas) and key events on window. It never calls
//     preventDefault on keys (game.js owns the PLAYBOOK keydown rule).
//   - setBlockRects(rects): UI button rects ({x, y, w, h} or {x, y, r}; CSS px) where a press does not start the
//     stick. A press there that travels >= 8 px becomes the stick with anchor = the press point (§2.1 boosters),
//     unless the rect has drag: false.
//   - enable(on): game.js turns the stick on only in play; off also releases everything.

const DZ = 4;            // dead-zone, CSS px
const PREC = 0.55;       // inner precision zone, fraction of RAD
const SLOP = 8;          // a press on a UI button that travels this far becomes the stick
const GUARD_MS = 2000;   // lost-pointerup guard (touch only): a press after this long of silence takes the stick over
const KEYS = {
  KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function inRect(p, r) {
  if (!r) return false;
  const q = r.rect || r;
  if (q.r != null && q.w == null) return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= q.r * q.r;
  return p.x >= q.x && p.y >= q.y && p.x <= q.x + (q.w || 0) && p.y <= q.y + (q.h || 0);
}

export function createInput(uiCanvas, getLayout) {
  let enabled = true;
  let blocks = [];
  // pointer state
  let pid = null;          // the one steering pointer (null = none)
  let ptype = '';          // its pointerType
  let lastType = '';       // last pointerType seen (for "show stick" defaults)
  let steering = false;    // false while a press on a UI button has not travelled SLOP yet
  let pend = null;         // { x, y, drag } press point on a UI button
  let ax = 0, ay = 0;      // anchor
  let px = 0, py = 0;      // pointer
  let dx = 0, dy = -1;     // unit direction (screen)
  let m = 0, moved = false;
  let rad = 48;
  let lastEvt = 0;
  let origin = { x: 0, y: 0 };
  const keys = new Set();  // 'u' | 'd' | 'l' | 'r' (by code, so both W and ArrowUp can be held)
  const held = new Map();  // code -> dir letter

  function computeRad() {
    let W = 0, H = 0;
    try {
      const L = getLayout && getLayout();
      if (L) { W = L.cssW || L.W || L.w || 0; H = L.cssH || L.H || L.h || 0; }
    } catch {}
    if (!(W > 0 && H > 0)) {
      const r = uiCanvas.getBoundingClientRect();
      W = r.width || innerWidth || 390; H = r.height || innerHeight || 844;
    }
    return clamp(0.10 * Math.min(W, H), 34, 64);
  }

  function pos(e) { return { x: e.clientX - origin.x, y: e.clientY - origin.y }; }

  function startStick(x, y) {
    steering = true; pend = null;
    ax = px = x; ay = py = y;
    m = 0; moved = false;
  }

  function update(x, y) {
    px = x; py = y;
    let ox = x - ax, oy = y - ay, d = Math.hypot(ox, oy);
    if (d > rad) { // re-anchor: drag the anchor along so reversing is instant
      const k = 1 - rad / d;
      ax += ox * k; ay += oy * k;
      ox = x - ax; oy = y - ay; d = rad;
    }
    if (d >= DZ) moved = true;
    if (d > 1e-6) { dx = ox / d; dy = oy / d; }
    m = clamp((d - DZ) / (PREC * rad - DZ), 0, 1);
  }

  function release() {
    if (pid !== null) { try { uiCanvas.releasePointerCapture(pid); } catch {} }
    pid = null; steering = false; pend = null; m = 0; moved = false;
  }

  // DECISION (11-05): a finger held dead still sends no events, so silence alone can't mean the pointerup was lost: the
  // stick stays live through it. Only a new press ends a silent touch, which is the one case a lost pointerup needs.
  const lostTouch = () => pid !== null && ptype === 'touch' && now() - lastEvt > GUARD_MS;

  function onDown(e) {
    lastType = e.pointerType || 'mouse';
    if (lostTouch()) release();
    if (!enabled || pid !== null) return;          // only the first pointer steers
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = uiCanvas.getBoundingClientRect();
    origin = { x: r.left, y: r.top };
    rad = computeRad();
    const p = pos(e);
    pid = e.pointerId; ptype = e.pointerType || 'mouse'; lastEvt = now();
    try { uiCanvas.setPointerCapture(pid); } catch {}
    const b = blocks.find(q => inRect(p, q));
    if (b) { steering = false; pend = { x: p.x, y: p.y, drag: b.drag !== false }; m = 0; }
    else startStick(p.x, p.y);
  }

  function onMove(e) {
    if (pid === null || e.pointerId !== pid) return;
    lastEvt = now();
    const p = pos(e);
    if (!steering) {
      if (!pend || !pend.drag || Math.hypot(p.x - pend.x, p.y - pend.y) < SLOP) return;
      startStick(pend.x, pend.y);
    }
    update(p.x, p.y);
  }

  function onUp(e) {
    if (pid === null || e.pointerId !== pid) return;
    release();
  }

  function onKey(e) {
    const k = KEYS[e.code];
    if (!k) return;
    if (e.type === 'keydown') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      held.set(e.code, k);
    } else held.delete(e.code);
    keys.clear();
    for (const v of held.values()) keys.add(v);
  }

  function clearKeys() { held.clear(); keys.clear(); }

  uiCanvas.addEventListener('pointerdown', onDown);
  uiCanvas.addEventListener('pointermove', onMove);
  uiCanvas.addEventListener('pointerup', onUp);
  uiCanvas.addEventListener('pointercancel', onUp);
  uiCanvas.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  addEventListener('blur', () => { release(); clearKeys(); });

  const api = {
    /** One input for this fixed step: { x, z, m }. Keys win over the stick. */
    sample() {
      if (!enabled) return { x: 0, z: 0, m: 0 };
      const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
      const kz = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
      if (kx || kz) { const l = Math.hypot(kx, kz); return { x: kx / l, z: kz / l, m: 1 }; }
      if (steering && m > 0) return { x: dx, z: dy, m };
      return { x: 0, z: 0, m: 0 };
    },
    /** true while a steering pointer is down or a direction key is held. */
    get held() { return (pid !== null && steering) || keys.size > 0; },
    /** Last pointerType seen ('touch' | 'mouse' | 'pen' | ''), for the "Show stick" default. */
    get type() { return lastType; },
    /** Stick visual for ui.js: anchor (ax, ay), knob (kx, ky) in CSS px, show once moved >= the dead-zone. */
    stick() {
      if (pid === null || !steering) return null;
      return { ax, ay, kx: px, ky: py, show: moved, rad, kr: 0.32 * rad, m, touch: ptype === 'touch' };
    },
    /** Drops the pointer and keys (level start, retry, pause, host pause). */
    reset() { release(); clearKeys(); },
    setBlockRects(rects) { blocks = Array.isArray(rects) ? rects.filter(Boolean) : []; },
    enable(on) {
      on = !!on;
      if (on === enabled) return;
      enabled = on;
      if (!on) release();
    },
    get enabled() { return enabled; },
    /**
     * QA only (modes.js __qaAdvance under ?qa=1): applies the page-px point the QA driver just dispatched as a touch move.
     * DECISION (11-07 Sat r7): Chrome hands touchmove/pointermove to the page at the next animation frame, and a headless
     *   frame is ~0.2 s, so a scripted run steered one loop late (greedy L3 37 s of clock in the browser vs 19 s in node).
     *   The real event still arrives and lands on the same point, so this only removes the frame of delivery lag.
     */
    qaMove(x, y) {
      if (pid === null || !isFinite(x) || !isFinite(y)) return false;
      onMove({ pointerId: pid, clientX: +x, clientY: +y });
      return true;
    },
  };
  return api;
}

export default createInput;
