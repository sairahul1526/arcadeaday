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

// Fix 1 (UI): reference board for sizing decisions = the biggest shipped board, 8×10 (frame 9.2 × 10.2 units,
//   plus 1.4 units for the kitten ledge → 11.6). GATE = §7.6 floor for its unit at 320×480.
const REF_W = 9.2, REF_H = 11.6, GATE = 24.4;

/** GDD §9.1. Returns { W, H, u, orient, m, safe, hud, rack, callout, board, tray, basket, boosters, boostDir }. */
export function computeLayout(W, H) {
  W = Math.max(1, W); H = Math.max(1, H);
  const orient = H / W >= 1.15 ? 'portrait' : W / H >= 1.15 ? 'landscape' : 'square';
  let u = orient === 'portrait' ? Math.min(W / 390, H / 700)
    : orient === 'square' ? Math.min(W / 520, H / 700)
      : Math.min(W / 900, H / 520);
  // Fix 1: the old 2.6 ceiling left 4K with phone-sized UI and a capped board; scale on up to 4.4 (≈ 4K).
  u = clamp(u, 0.3, 4.4);
  const m = Math.min(8 * u, 0.035 * Math.min(W, H));
  const inset = webBottomInset(H);

  // safe rect
  let sw, sh;
  if (orient === 'landscape') { sw = Math.min(W, 2.1 * H, 1100 * u); sh = Math.min(H - inset, 700 * u); }
  else { sw = Math.min(W, 520 * u); sh = Math.min(H - inset, 2.3 * W); }
  const safe = R(Math.round((W - sw) / 2), Math.round((H - inset - sh) / 2), sw, sh);
  const sx = safe.x, sy = safe.y, sr = safe.x + safe.w, sb = safe.y + safe.h;

  const L = { W, H, u, orient, m, safe, inset, boostDir: 'tray' };
  const hudH = 52 * u;
  const gap = Math.max(3, 4 * u);

  if (orient !== 'landscape') {
    L.hud = R(sx, sy, safe.w, hudH);
    // DECISION (fix 1): portrait has three candidate splits and keeps the one that gives 8×10 the biggest unit
    //   while every booster stays ≥ 40 px (phone M1: 26 px boosters with overlapping hits at 320×480):
    //   'col'  — boosters stacked in a column right of the board, in the board's spare width (height-limited
    //            boards: 320×480, 360×640); the tray then holds only the basket, at full width.
    //   'tray' — basket + 2×2/row booster block in the bottom tray (width-limited boards: 390×844 and taller).
    //   'row'  — fallback: tray with a one-row booster strip forced to ≥ 40 px cells.
    //   Leftover height (board width-limited) grows the rack (bigger spools), then the tray.
    const callH = Math.max(34 * u, Math.min(28, 40 * u + 6));
    const bw = safe.w - 2 * m, bottom = sb - m * 0.5;
    const rack0 = 108 * u, rackMax = 140 * u, rackMin = 92 * u;
    const btnCap = Math.max(44, 60 * u);
    const boardH = (rackH, trayH) => bottom - trayH - m * 0.25 - (sy + hudH + rackH + callH + m * 0.5);
    const unitOf = (w, h) => Math.min(w / REF_W, h / REF_H);
    const trayBtn = (trayH, frac) => {
      const bwid = bw * frac - m * 0.5, n = 4;
      const row = Math.min((bwid - gap * 3) / n, trayH);
      const grid = Math.min((bwid - gap) / 2, (trayH - gap) / 2);
      return Math.min(btnCap, Math.max(row, grid));
    };
    const cands = [];
    { // 'tray'
      let trayH = 76 * u;
      const h = boardH(rack0, trayH), need = REF_H * (bw / REF_W);
      if (h - need > 0) trayH += Math.min(h - need, Math.max(0, 96 - trayH));
      cands.push({ mode: 'tray', trayH, frac: 0.38, colW: 0, btn: trayBtn(trayH, 0.38) });
    }
    { // 'col'
      const trayH = Math.max(40, 54 * u);
      const h = boardH(rack0, trayH);
      const spare = bw - REF_W * Math.min(h / REF_H, bw / REF_W);
      const colW = clamp(spare - m * 0.5, 44, Math.max(48, 64 * u));
      const btn = Math.min(colW, (h - 3 * gap) / 4, btnCap);
      cands.push({ mode: 'col', trayH, frac: 0, colW, btn });
    }
    { // 'row'
      const trayH = Math.max(76 * u, 44);
      const frac = clamp((4 * 44 + 3 * gap + m * 0.5) / bw, 0.38, 0.62);
      cands.push({ mode: 'row', trayH, frac, colW: 0, btn: trayBtn(trayH, frac) });
    }
    for (const c of cands) {
      const h = boardH(rack0, c.trayH);
      c.unit = unitOf(bw - (c.colW ? c.colW + m * 0.5 : 0), h);
      c.score = c.unit * (c.btn >= 40 ? 1 : 0.5) * (c.mode === 'row' ? 0.97 : 1); // row squeezes the basket: last resort
    }
    cands.sort((a, b) => b.score - a.score);
    const C = cands[0];
    let rackH = rack0, trayH = C.trayH;
    // leftover height → rack (spools), clamp so 8×10 never drops under the §7.6 gate
    const bwB = bw - (C.colW ? C.colW + m * 0.5 : 0);
    const spareH = boardH(rack0, trayH) - REF_H * (bwB / REF_W);
    if (spareH > 0) rackH = Math.min(rackMax, rack0 + spareH);
    const needGate = REF_H * GATE;
    if (boardH(rackH, trayH) < needGate) rackH = Math.max(rackMin, rackH - (needGate - boardH(rackH, trayH)));
    L.rack = R(sx, sy + hudH, safe.w, rackH);
    L.callout = R(sx + m, L.rack.y + rackH, safe.w - 2 * m, callH);
    L.tray = R(sx, bottom - trayH, safe.w, trayH);
    const top = L.callout.y + callH + m * 0.5;
    const bh = L.tray.y - top - m * 0.25;
    if (C.mode === 'col') {
      L.boostDir = 'col';
      L.basket = R(sx + m, L.tray.y, bw, trayH);
      L.board = R(sx + m, top, bwB, bh);
      L.boosters = R(sx + m + bwB + m * 0.5, top, C.colW, bh);
    } else {
      const bkW = bw * (1 - C.frac) - m * 0.5;
      L.basket = R(sx + m, L.tray.y, bkW, trayH);
      L.boosters = R(sx + m + bkW + m, L.tray.y, bw - bkW - m, trayH);
      L.board = R(sx + m, top, bw, bh);
    }
  } else {
    // DECISION (fix 1, phone m4 / desktop M1): the HUD moves into the right column so the board gets the full
    //   safe height; leftover column height grows the boosters (≥ 46), then the rack (bigger spools), then the
    //   basket. On desktop-sized screens (H ≥ 640) the board area is held to 75 % of the safe height so an
    //   8×10 frame is ≈ 65 % of it (brief: 55–65 %), centred, instead of touching top and bottom.
    const colW = Math.min(0.38 * safe.w, 400 * u);
    const cx = sr - colW;
    const cw = colW - m;
    const callH = Math.max(40 * u, 30);
    L.hud = R(cx, sy, cw, hudH);
    let rackH = 120 * u, basketH = 70 * u, boostH = 56 * u;
    let free = sb - m - (sy + hudH) - rackH - callH - basketH - boostH;
    const grow = (v, to) => { const d = Math.max(0, Math.min(free, to - v)); free -= d; return v + d; };
    boostH = grow(boostH, Math.max(46, Math.min(64 * u, (cw - gap * 3) / 4)));
    rackH = grow(rackH, 170 * u);
    basketH = grow(basketH, 84 * u);
    L.rack = R(cx, sy + hudH, cw, rackH);
    L.callout = R(cx, L.rack.y + rackH, cw, callH);
    // whatever is still free sits between callout and tray (tray stays docked at the bottom, near the thumb)
    L.tray = R(cx, sb - m - basketH - boostH, cw, basketH + boostH);
    L.basket = R(cx, L.tray.y, cw, basketH);
    L.boosters = R(cx, L.tray.y + basketH, cw, boostH);
    let top = sy + m * 0.5, bh = sb - m - top;
    if (H >= 640) { const k = Math.min(bh, Math.max(0.75 * safe.h, 560)); top += (bh - k) / 2; bh = k; }
    L.board = R(sx + m, top, cx - m - (sx + m), bh);
  }
  return L;
}

/** GDD §9.1 fitBoard. level needs { cols, rows }. Fix 1 (contract 5): no px cap, the board scales with the viewport. */
export function fitBoard(level, rect) {
  const cols = level.cols || 4, rows = level.rows || 4;
  const gw = cols - 1 + 1.2, gh = rows - 1 + 1.2;
  let unit = Math.min(rect.w / gw, rect.h / (gh + 1.4));
  unit = Math.max(1, unit);
  const w = gw * unit, h = gh * unit, tot = h + 1.4 * unit;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - tot) / 2;
  const sw = Math.max(6.5, Math.min(0.27 * unit, Math.max(22, 0.25 * unit)));
  return {
    ox: x + 0.6 * unit, oy: y + 0.6 * unit, unit, sw, x, y, w, h, cols, rows,
    kitten: { x: x + w / 2, y: y + h + 1.25 * unit, s: 1.6 * unit },
  };
}

/**
 * Rack anchors (see conventions at the top). Fix 1 (FIX-LIST "spools 2× bigger"): the rack is taller (108–140u
 * portrait, up to 170u landscape) and each spool's h is sized to fill it (0.6 × rack height, a jumbo's 1.4× still
 * fits) unless the row's width runs out; every slot also carries `w`, the body width it may use.
 */
export function rackSlots(L) {
  const r = L.rack, u = L.u, land = L.orient === 'landscape';
  const ks = Math.min(r.h * (land ? 0.8 : 0.84), r.w * (land ? 0.2 : 0.19));
  const kitty = land ? { x: r.x + ks * 0.5, y: r.y + r.h * 0.92, s: ks } : { x: r.x + L.m + ks * 0.42, y: r.y + r.h * 0.94, s: ks };
  const left = land ? r.x + ks : kitty.x + ks * 0.5;
  const right = r.x + r.w - (land ? 4 * u : L.m);
  const span = Math.max(10, right - left);
  // cells: active 1 · active 1 · NEXT 0.78 · next-next 0.6, gaps 0.1 (0.25 before NEXT); sum ≈ 3.83 cells
  const cw = span / 3.83, gp = cw * 0.1;
  const h = Math.max(8, Math.min(r.h * 0.6, cw / 0.92));
  const shelf = r.y + r.h * (land ? 0.86 : 0.88);
  const a0 = left + cw / 2, a1 = a0 + cw + gp;
  const n0 = a1 + cw / 2 + gp * 2.5 + cw * 0.39, n1 = n0 + cw * 0.39 + gp + cw * 0.3;
  const at = (x, k, w) => ({ x, y: shelf - h * k / 2, h: h * k, w: w * 0.96 });
  return {
    active: [at(a0, 1, cw), at(a1, 1, cw)],
    next: [at(n0, 0.78, cw * 0.78), at(n1, 0.6, cw * 0.6)],
    more: { x: Math.min(right - 12 * u, n1 + h * 0.35), y: r.y + r.h * 0.16 },
    kitty,
  };
}

/** Basket slot centres + ball radius for `cap` slots, centred in L.basket. [] while L.hideBasket (GDD §10: no basket on L1). */
export function basketSlots(L, cap) {
  if (L.hideBasket) return [];
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
 * grid/row; without it all four get fixed cells (undo, hint, slot, snip). Every rect has `.hit`: hit cells tile
 * the booster area without overlapping (fix 1, phone M1), and ui.js resolves taps by nearest centre.
 */
export function boosterRects(L, keys = null) {
  const all = ['undo', 'hint', 'slot', 'snip'];
  const list = keys || all;
  const b = L.boosters;
  const n = Math.max(1, list.length);
  const gap = Math.max(3, 4 * L.u);
  const out = {};
  const cap = Math.max(44, 60 * L.u);
  if (L.boostDir === 'col') {
    // column right of the board: fixed 4-cell pitch, bottom-aligned (near the thumb), so cells never jump as
    // boosters unlock; a lone Undo sits at the bottom.
    const pitch = Math.min((b.h + gap) / 4, cap + gap * 2.5);
    const sz = Math.min(b.w, pitch - gap, cap);
    const y0 = b.y + b.h - 4 * pitch + gap;
    list.forEach((k, i) => {
      const j = 4 - list.length + i, y = y0 + j * pitch;
      out[k] = R(b.x + (b.w - sz) / 2, y + (pitch - gap - sz) / 2, sz, sz);
      out[k].hit = R(b.x - gap, y - gap / 2, b.w + 2 * gap, pitch);
    });
    return out;
  }
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
      out[k].hit = R(cx - gap / 2, b.y, cw + gap, b.h);
    });
  } else {
    // the grid fills from the BOTTOM row up, so the newest booster (last in the list) lands on top and its
    // gift fly-in arrives from above without crossing the older ones (phone m6)
    list.forEach((k, i) => {
      const c = i % 2, rw = gr - 1 - ((i / 2) | 0);
      const x = b.x + c * (gcw + gap), y = b.y + rw * (gch + gap);
      const sz = Math.min(gridSz, cap);
      out[k] = R(x + (gcw - sz) / 2, y + (gch - sz) / 2, sz, sz);
      out[k].hit = R(x - gap / 2, y - gap / 2, gcw + gap, gch + gap);
    });
  }
  return out;
}
