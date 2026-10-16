// layout.js: Knot Kitty layout rects (GDD §9.1, §13.6). Owner: UI role.
// All values are CSS px. Pure functions, no DOM access except an optional probe of the web shell's
// fixed bottom-left `.back` nav (absent on YouTube and in Node harnesses).
//
// DECISION: every rect is laid out inside a centred SAFE rect (L.safe) so very wide / very tall screens
//   don't stretch the UI: portrait/square safe width ≤ 520u, portrait safe height ≤ 2.3 × width,
//   landscape safe width ≤ min(2.1 × height, 1100u), height ≤ 700u. Everything outside L.safe is scene (scene.js fills the canvas).
// DECISION: landscape right column = min(38 % of safe width, 400u).
// DECISION: margins m = 8u but never more than 3.5 % of the short side, so 320×480 keeps the §7.6 gate
//   (8×10 board → unit ≥ 24 px).
// DECISION: when the board is width-limited (spare height), the portrait tray grows up to 2×44 px + gap so
//   the 2×2 booster grid reaches 44 px touch targets; landscape booster row is ≥ 46 px when it fits.
// DECISION: on the web page (the `.back` "how to play / more games" chips are fixed bottom-left), the
//   safe rect's bottom is raised by the chips' height when H ≥ 560, so they never cover the tray/board.
// DECISION: callout band height ≥ 28 px (portrait) / 30 px (landscape) so its text stays ≥ 11 px.
//
// Anchor conventions (shared with render.js):
//   spools  {x, y, h}: (x, y) = centre of the spool at rest, h = spool body height (jumbo draws 1.4 × h,
//                      the rack leaves room for it); NEXT is 0.8 × and next-next 0.6 × the active height.
//   kitty   {x, y, s}: (x, y) = bottom centre where Kitty sits, s = her height.
//   kitten  {x, y, s}: (x, y) = bottom centre (sits on the frame's bottom ledge), s = height (1.6 units).
//   basket  [{x, y, r}]: slot centres and ball radius.
//   B.ox/oy: screen position of peg (0,0); peg (i,j) → (ox + i·unit, oy + j·unit).
//   B.x/y/w/h: the pegboard frame rect (frame drawn inside it, 0.6 unit around the outer pegs).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = (x, y, w, h) => ({ x, y, w: Math.max(0, w), h: Math.max(0, h) });

function webBottomInset(H) {
  if (H < 560 || typeof document === 'undefined') return 0;
  try {
    const nav = document.querySelector('nav.back');
    if (!nav) return 0;
    const r = nav.getBoundingClientRect();
    if (!r.height || getComputedStyle(nav).display === 'none') return 0;
    return Math.min(56, Math.round(r.height + 14));
  } catch (e) { return 0; }
}

/** GDD §9.1. Returns { W, H, u, orient, m, safe, hud, rack, callout, board, tray, basket, boosters }. */
export function computeLayout(W, H) {
  W = Math.max(1, W); H = Math.max(1, H);
  const orient = H / W >= 1.15 ? 'portrait' : W / H >= 1.15 ? 'landscape' : 'square';
  let u = orient === 'portrait' ? Math.min(W / 390, H / 700)
    : orient === 'square' ? Math.min(W / 520, H / 700)
      : Math.min(W / 900, H / 520);
  u = clamp(u, 0.3, 2.6);
  const m = Math.min(8 * u, 0.035 * Math.min(W, H));
  const inset = webBottomInset(H);

  // safe rect
  let sw, sh;
  if (orient === 'landscape') { sw = Math.min(W, 2.1 * H, 1100 * u); sh = Math.min(H - inset, 700 * u); }
  else { sw = Math.min(W, 520 * u); sh = Math.min(H - inset, 2.3 * W); }
  const safe = R(Math.round((W - sw) / 2), Math.round((H - inset - sh) / 2), sw, sh);
  const sx = safe.x, sy = safe.y, sr = safe.x + safe.w, sb = safe.y + safe.h;

  const L = { W, H, u, orient, m, safe, inset };
  const hudH = 52 * u;
  L.hud = R(sx, sy, safe.w, hudH);

  if (orient !== 'landscape') {
    const rackH = 96 * u, callH = Math.max(34 * u, Math.min(28, 40 * u + 6));
    L.rack = R(sx, sy + hudH, safe.w, rackH);
    L.callout = R(sx + m, L.rack.y + rackH, safe.w - 2 * m, callH);
    let trayH = 76 * u;
    const top = L.callout.y + callH + m * 0.5;
    const bw = safe.w - 2 * m;
    // spare height when an 8×10 board is width-limited → grow the tray for 44 px booster cells
    const needH = (bw / 8.2) * 11.6;
    const spare = (sb - m * 0.5 - trayH) - top - needH;
    if (spare > 0) trayH += Math.min(spare, Math.max(0, 96 - trayH));
    L.tray = R(sx, sb - trayH - m * 0.5, safe.w, trayH);
    const inner = safe.w - 2 * m;
    const bkW = inner * 0.62 - m * 0.5;
    L.basket = R(sx + m, L.tray.y, bkW, trayH);
    L.boosters = R(sx + m + bkW + m, L.tray.y, inner - bkW - m, trayH);
    L.board = R(sx + m, top, bw, L.tray.y - top - m * 0.25);
  } else {
    const colW = Math.min(0.38 * safe.w, 400 * u);
    const cx = sr - colW;
    const cw = colW - m;
    const rackH = 120 * u, callH = Math.max(40 * u, 30);
    L.rack = R(cx, sy + hudH, cw, rackH);
    L.callout = R(cx, L.rack.y + rackH, cw, callH);
    const basketH = 70 * u;
    let boostH = 56 * u;
    const free = sb - m - (L.callout.y + callH) - basketH - boostH;
    if (boostH < 46 && free > 0) boostH += Math.min(free, 46 - boostH);
    L.tray = R(cx, sb - m - basketH - boostH, cw, basketH + boostH);
    L.basket = R(cx, L.tray.y, cw, basketH);
    L.boosters = R(cx, L.tray.y + basketH, cw, boostH);
    const top = sy + hudH + m * 0.5;
    L.board = R(sx + m, top, cx - m - (sx + m), sb - m - top);
  }
  return L;
}

/** GDD §9.1 fitBoard. level needs { cols, rows }. */
export function fitBoard(level, rect) {
  const cols = level.cols || 4, rows = level.rows || 4;
  const gw = cols - 1 + 1.2, gh = rows - 1 + 1.2;
  let unit = Math.min(rect.w / gw, rect.h / (gh + 1.4));
  unit = Math.max(1, Math.min(90, unit));
  const w = gw * unit, h = gh * unit, tot = h + 1.4 * unit;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - tot) / 2;
  const sw = clamp(0.27 * unit, 6.5, 22);
  return {
    ox: x + 0.6 * unit, oy: y + 0.6 * unit, unit, sw, x, y, w, h, cols, rows,
    kitten: { x: x + w / 2, y: y + h + 1.25 * unit, s: 1.6 * unit },
  };
}

/** Rack anchors (see conventions at the top). */
export function rackSlots(L) {
  const r = L.rack, u = L.u;
  if (L.orient !== 'landscape') {
    // portrait: Kitty | active A | active B | NEXT | next-next (+N chip above-right)
    const h = Math.min(r.h * 0.56, r.w * 0.13 / 0.62 * 1.0);
    const cy = r.y + r.h * 0.5 + h * 0.08;
    const ks = Math.min(r.h * 0.86, r.w * 0.2);
    const kitty = { x: r.x + L.m + ks * 0.42, y: r.y + r.h * 0.94, s: ks };
    const left = kitty.x + ks * 0.5;
    const right = r.x + r.w - L.m;
    const span = right - left;
    const a0 = left + span * 0.2, a1 = left + span * 0.46;
    const n0 = left + span * 0.72, n1 = left + span * 0.9;
    return {
      active: [{ x: a0, y: cy, h }, { x: a1, y: cy, h }],
      next: [{ x: n0, y: cy + h * 0.1, h: h * 0.8 }, { x: n1, y: cy + h * 0.2, h: h * 0.6 }],
      more: { x: Math.min(right - 12 * u, n1 + h * 0.35), y: r.y + r.h * 0.18 },
      kitty,
    };
  }
  // landscape: Kitty sits on top of the rack panel (left), spools in a row
  const h = Math.min(r.h * 0.5, r.w * 0.12 / 0.62);
  const cy = r.y + r.h * 0.56;
  const ks = Math.min(r.h * 0.8, r.w * 0.2);
  const kitty = { x: r.x + ks * 0.5, y: r.y + r.h * 0.92, s: ks };
  const left = r.x + ks, right = r.x + r.w - 4 * u;
  const span = right - left;
  return {
    active: [{ x: left + span * 0.18, y: cy, h }, { x: left + span * 0.44, y: cy, h }],
    next: [{ x: left + span * 0.7, y: cy + h * 0.1, h: h * 0.8 }, { x: left + span * 0.89, y: cy + h * 0.2, h: h * 0.6 }],
    more: { x: Math.min(right - 10 * u, left + span * 0.89 + h * 0.35), y: r.y + r.h * 0.16 },
    kitty,
  };
}

/** Basket slot centres + ball radius for `cap` slots, centred in L.basket. */
export function basketSlots(L, cap) {
  const b = L.basket;
  cap = Math.max(1, cap | 0);
  const r = Math.max(4, Math.min(b.h * 0.3, (b.w * 0.86) / (cap * 2.5), 26 * L.u));
  const gap = r * 2.5;
  const cx = b.x + b.w / 2, cy = b.y + b.h * 0.52;
  const out = [];
  for (let i = 0; i < cap; i++) out.push({ x: cx + (i - (cap - 1) / 2) * gap, y: cy, r });
  return out;
}

/**
 * Booster button rects. With `keys` (the visible boosters, in order) the visible ones re-flow to fill the
 * grid/row; without it all four get fixed cells (undo, hint, slot, snip).
 */
export function boosterRects(L, keys = null) {
  const all = ['undo', 'hint', 'slot', 'snip'];
  const list = keys || all;
  const b = L.boosters;
  const n = Math.max(1, list.length);
  const gap = Math.max(3, 4 * L.u);
  const out = {};
  const cap = Math.max(44, 60 * L.u);
  // DECISION: pick whichever of "one row" / "2-column grid" gives the bigger buttons for the boosters shown
  //   (a lone Undo on L4 gets the whole tray height instead of a quarter cell); landscape is always one row.
  const rowCw = (b.w - gap * (n - 1)) / n, rowSz = Math.min(rowCw, b.h);
  const gr = Math.ceil(n / 2), gcw = n === 1 ? b.w : (b.w - gap) / 2, gch = (b.h - gap * (gr - 1)) / gr;
  const gridSz = Math.min(gcw, gch);
  if (L.orient === 'landscape' || rowSz >= gridSz) {
    // landscape keeps the fixed 4-cell pitch so buttons don't jump size as boosters unlock
    const cw = L.orient === 'landscape' ? (b.w - gap * 3) / 4 : rowCw;
    const sz = Math.min(cw, b.h, cap);
    const total = list.length * cw + (list.length - 1) * gap;
    const x0 = b.x + (b.w - total) / 2;
    list.forEach((k, i) => {
      const cx = x0 + i * (cw + gap);
      out[k] = R(cx + (cw - sz) / 2, b.y + (b.h - sz) / 2, sz, sz);
      out[k].hit = R(cx, b.y, cw, b.h);
    });
  } else {
    list.forEach((k, i) => {
      const c = i % 2, rw = (i / 2) | 0;
      const x = b.x + c * (gcw + gap), y = b.y + rw * (gch + gap);
      const sz = Math.min(gridSz, cap);
      out[k] = R(x + (gcw - sz) / 2, y + (gch - sz) / 2, sz, sz);
      out[k].hit = R(x, y, gcw, gch);
    });
  }
  return out;
}
