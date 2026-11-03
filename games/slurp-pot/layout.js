// Slurp Pot: layout.js (UI role). Pure screen geometry for every aspect, from 320x480 up to 3840x2160.
// No drawing here: ui.js paints into these rects, game.js/render3d use `play` for the camera, input.js
// uses the button rects to block the stick. GDD §9.2 plus orchestrator decision D33 (egg-timer clipped to
// the right end of the ticket rail; boosters are a round side column in every aspect).
//
//   computeLayout(cssW, cssH, insets?, opts?) -> { W, H, u, aspect, record, safe, play:{x,y,w,h,cx,cy},
//        hud:{ timer, ticket, rail, pause, meter, callout, boosters:[r,r,r], arrowZone }, fs:{...}, card:{...} }
//   cardLayout(L, name, opts?) -> { panel, blocks:{name:rect}, buttons:[{id, r, primary}], fs:{...} }
//   insets()     -> { t, r, b, l } CSS px from env(safe-area-inset-*) (hidden probe div, cached per size)
//   webInset(H)  -> CSS px the web-page site chips take at the bottom (0 in iframes, record mode, H < 560)
//   meterRect()  -> the size meter rect of the last computed layout
//   setTicketLines(n) -> the ticket line count the next computeLayout uses (ui.js calls it on level start)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const R = (x, y, w, h) => ({ x, y, w, h });

// Record mode (D31): the HUD reads like the 360x640 design at x3 on the 1080x1920 capture.
const REC = typeof location !== 'undefined' && /[?&]record=1\b/.test(location.search || '');

let last = null;
let ticketLines = 3;
export function setTicketLines(n) { ticketLines = clamp(n | 0 || 3, 1, 8); }
export function meterRect() { return last ? last.hud.meter : R(0, 0, 0, 0); }
export function lastLayout() { return last; }

// ---- safe-area insets (probe div, as Knot Kitty) ----
let probe = null, insCache = { k: '', v: { t: 0, r: 0, b: 0, l: 0 } };
export function insets() {
  if (typeof document === 'undefined' || !document.body) return { t: 0, r: 0, b: 0, l: 0 };
  const W = innerWidth, H = innerHeight, k = W + 'x' + H;
  if (insCache.k === k) return insCache.v;
  try {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe), m = 0.2 * Math.min(W, H);
    const v = { t: clamp(parseFloat(cs.paddingTop) || 0, 0, m), r: clamp(parseFloat(cs.paddingRight) || 0, 0, m),
      b: clamp(parseFloat(cs.paddingBottom) || 0, 0, m), l: clamp(parseFloat(cs.paddingLeft) || 0, 0, m) };
    insCache = { k, v };
    return v;
  } catch { return { t: 0, r: 0, b: 0, l: 0 }; }
}

// ---- web-page site chips (nav.back, fixed bottom-left, hidden while playing) ----
// DECISION: as Knot Kitty, when H >= 560 the menu rect's bottom is raised to the chips' top (measured from the
//   chip top, +2 px) so they never cover the title icon row or a card button. The play HUD keeps the full safe
//   rect because the chips are hidden during play (visibility, so they still measure the same size).
export function webInset(H) {
  if (H < 560 || typeof document === 'undefined') return 0;
  try {
    const nav = document.querySelector('nav.back');
    if (!nav) return 0;
    const r = nav.getBoundingClientRect();
    if (!r.height || getComputedStyle(nav).display === 'none') return 0;
    return clamp(Math.round(innerHeight - r.top + 2), 0, 90);
  } catch { return 0; }
}

function normIns(i) {
  if (!i) return { t: 0, r: 0, b: 0, l: 0 };
  return { t: +(i.t ?? i.top ?? 0) || 0, r: +(i.r ?? i.right ?? 0) || 0, b: +(i.b ?? i.bottom ?? 0) || 0, l: +(i.l ?? i.left ?? 0) || 0 };
}

// Ticket chip geometry shared by layout (height) and ui.js (drawing): one chip = ring+icon, then the "2/3" count.
export function chipMetrics(u, fsCount) {
  const ring = Math.max(24, 30 * u);                     // ring diameter around the 26u icon
  const h = Math.max(28, 34 * u);
  const gap = Math.max(4, 6 * u);
  const countW = fsCount * 1.75;                          // "2/3" in Lilita ~0.58em per glyph
  return { ring, h, gap, countW, w: ring + Math.max(3, 4 * u) + countW };
}

/**
 * DECISION: u is computed from the safe rect (not the raw canvas) so a 44/34 px notch never pushes the HUD
 * off the bottom; record mode uses min(W/360, H/640) uncapped (exactly 3 at 1080x1920, D31). Every size has a
 * CSS-px floor: buttons >= 44 px, text >= 12 px, so tiny screens (u ~ 0.63 at 320x480) stay legal.
 * DECISION (D33): portrait row 1 = ticket (left) + egg-timer hung on the rail's right end + pause tag at the far
 * right; landscape = the same unit at the top of the 220u left column. Boosters are a vertical column on the right
 * edge in every aspect (landscape: bottom-right), never a bottom row.
 */
export function computeLayout(cssW, cssH, ins, opts = {}) {
  const W = Math.max(1, cssW | 0 || cssW || 1), H = Math.max(1, cssH | 0 || cssH || 1);
  const I = normIns(ins);
  const m = 0.2 * Math.min(W, H);
  I.t = clamp(I.t, 0, m); I.r = clamp(I.r, 0, m); I.b = clamp(I.b, 0, m); I.l = clamp(I.l, 0, m);
  const safe = R(I.l, I.t, W - I.l - I.r, H - I.t - I.b);
  const SW = safe.w, SH = safe.h, ar = W / H;
  const aspect = ar < 0.8 ? 'portrait' : ar <= 1.25 ? 'square' : 'landscape';
  const record = opts.record ?? REC;
  let u;
  if (aspect === 'portrait') u = record ? Math.min(SW / 360, SH / 640) : Math.min(SW / 390, SH / 760);
  else if (aspect === 'square') u = Math.min(SW / 560, SH / 700);
  else u = Math.min(SW / 900, SH / 520);
  u = Math.min(u, record ? 3 : 2.2);
  const U = v => v * u;
  const lines = opts.lines ?? ticketLines;
  // menu rect: the safe rect minus the web chips strip (cards and the title use it, the play HUD does not)
  const web = record ? 0 : Math.max(0, +(opts.web ?? webInset(H)) || 0);
  const menu = R(safe.x, safe.y, safe.w, clamp(Math.min(safe.h, H - web - safe.y), 0.82 * safe.h, safe.h));

  // font sizes (CSS px), all floored at 12
  const fs = {
    hdr: Math.max(12, U(16)), count: Math.max(12, U(14)), serve: Math.max(13, U(16)), callout: Math.max(12.5, U(16)),
    secs: Math.max(12, U(18)), chain: Math.max(16, U(22)), badge: Math.max(12, U(12)), label: Math.max(12, U(13)),
  };
  const btn = Math.max(44, U(44)), bst = Math.max(44, U(52)), tmr = Math.max(46, U(64));
  const inset = U(10), top = safe.y + U(8);
  const cm = chipMetrics(u, fs.count);
  const sr = safe.x + SW, sb = safe.y + SH;
  const hud = {};
  let play;

  // ticket body height for n chip rows / list lines
  const railH = Math.max(5, U(7));
  const hdrH = fs.hdr * 1.2;
  if (aspect !== 'landscape') {
    hud.pause = R(sr - inset - btn, top, btn, btn);
    let unitR = hud.pause.x - U(6);                       // right end of the ticket+timer unit
    let unitL = safe.x + inset;
    if (aspect === 'square') {                            // ticket max width 360u, unit centred
      const maxUnit = U(360) + U(4) + tmr;
      if (unitR - unitL > maxUnit) { const c = (unitL + unitR) / 2; unitL = c - maxUnit / 2; unitR = c + maxUnit / 2; }
    }
    hud.timer = R(unitR - tmr, top, tmr, tmr);
    const tx = unitL, tw = hud.timer.x - U(4) - unitL;
    const pad = Math.max(6, U(8));
    const perRow = Math.max(1, Math.floor((tw - 2 * pad + cm.gap) / (cm.w + cm.gap)));
    const rows = Math.max(1, Math.ceil(lines / perRow));
    const th = railH + Math.max(3, U(4)) + hdrH + Math.max(2, U(3)) + rows * cm.h + (rows - 1) * Math.max(2, U(3)) + Math.max(8, U(10));
    hud.ticket = R(tx, top, tw, th);
    hud.ticket.rows = rows; hud.ticket.perRow = perRow; hud.ticket.pad = pad;
    hud.rail = R(tx, top, hud.timer.x + tmr / 2 - tx, railH);
    const rowB = top + Math.max(th, tmr, btn);
    const mh = Math.max(26, U(30));
    hud.meter = R(safe.x + U(10), rowB + U(8), SW - U(20), mh);
    const ch = Math.max(34, U(40));
    hud.callout = R(safe.x + U(10), hud.meter.y + mh + Math.max(4, U(6)), SW - U(20), ch);
    const gap = Math.max(8, U(10)), colH = 3 * bst + 2 * gap;
    let y0 = sb - 0.4 * SH - colH / 2;
    y0 = clamp(y0, hud.callout.y + ch + U(8), sb - U(12) - colH);
    hud.boosters = [0, 1, 2].map(i => R(sr - inset - bst, y0 + i * (bst + gap), bst, bst));
    const py = hud.callout.y + ch;
    play = R(safe.x, py, SW, sb - py);
    play.cx = safe.x + SW / 2; play.cy = safe.y + 0.6 * SH;
  } else {
    const colW = Math.max(U(220), 168), col = R(safe.x + inset, top, colW, 0);
    hud.timer = R(col.x + colW - tmr, top, tmr, tmr);
    const tw = hud.timer.x - U(4) - col.x;
    const lineH = Math.max(28, U(34));
    const th = railH + Math.max(3, U(4)) + hdrH + Math.max(2, U(4)) + lines * lineH + Math.max(8, U(10));
    hud.ticket = R(col.x, top, tw, th);
    hud.ticket.rows = lines; hud.ticket.perRow = 1; hud.ticket.pad = Math.max(6, U(8)); hud.ticket.lineH = lineH;
    hud.rail = R(col.x, top, hud.timer.x + tmr / 2 - col.x, railH);
    hud.pause = R(sr - inset - btn, top, btn, btn);
    const mh = Math.max(24, U(26));
    const mx0 = Math.max(safe.x + U(240), col.x + colW + U(12));
    const mx1 = Math.min(sr - U(70), hud.pause.x - U(10));
    hud.meter = R(mx0, top + (btn - mh) / 2, mx1 - mx0, mh);
    const ch = Math.max(34, U(40));
    const cy = Math.max(hud.meter.y + mh, hud.pause.y + btn) + Math.max(4, U(6));
    hud.callout = R(mx0, cy, mx1 - mx0, ch);
    const gap = Math.max(8, U(10)), colH = 3 * bst + 2 * gap;
    let y0 = sb - U(12) - colH;
    y0 = Math.max(y0, hud.callout.y + ch + U(8));
    hud.boosters = [0, 1, 2].map(i => R(sr - inset - bst, y0 + i * (bst + gap), bst, bst));
    const px = col.x + colW + U(10), py = Math.max(hud.meter.y + mh, hud.pause.y + btn) + Math.max(4, U(6));
    play = R(px, py, sr - px, sb - py);
    play.cx = play.x + play.w / 2; play.cy = play.y + 0.6 * play.h;
  }
  // Edge arrows live inside the play rect (never over the HUD rows), 10u from its edges.
  hud.arrowZone = R(play.x + inset, play.y + inset, play.w - 2 * inset, play.h - 2 * inset);
  hud.arrow = Math.max(30, U(34));
  hud.btn = btn; hud.bst = bst; hud.tmr = tmr; hud.chip = cm;

  // ---- card frame ----
  const cmg = Math.max(10, U(16)), MH = menu.h;
  let card;
  if (aspect === 'landscape') {
    const ch = MH - 2 * Math.max(8, U(12));
    const cw = Math.min(SW - 2 * cmg, Math.max(U(660), Math.min(ch * 1.75, U(780))));
    card = R(safe.x + (SW - cw) / 2, menu.y + (MH - ch) / 2, cw, ch);
    card.wide = true;
    card.cu = clamp(Math.min(cw / 640, ch / 350), 0.5, record ? 3 : 2.2);
  } else {
    const cw = Math.min(SW - 2 * cmg, Math.max(300, U(420)));
    const ch = Math.min(MH - 2 * cmg, Math.max(440, U(680)));
    card = R(safe.x + (SW - cw) / 2, menu.y + (MH - ch) / 2, cw, ch);
    card.wide = false;
    card.cu = clamp(Math.min(cw / 360, ch / 600), 0.5, record ? 3 : 2.2);
  }
  const L = { W, H, u, ar, aspect, record, safe, menu, web, insets: I, play, hud, fs, card };
  last = L;
  return L;
}

// ---- vertical stack helper: rows [{id, h, min, gap}] squeezed to fit `avail` (flex rows shrink first) ----
function stack(x, y, w, avail, rows) {
  let want = 0, minSum = 0;
  for (const r of rows) { want += r.h + (r.gap || 0); minSum += (r.min ?? r.h) + (r.gap || 0); }
  let k = 1;
  if (want > avail) k = want - minSum > 0 ? clamp((avail - minSum) / (want - minSum), 0, 1) : 0;
  const out = {};
  let cy = y;
  for (const r of rows) {
    cy += r.gap || 0;
    const mn = r.min ?? r.h, h = mn + (r.h - mn) * k;
    out[r.id] = R(x, cy, w, h);
    cy += h;
  }
  out._end = cy;
  return out;
}
const centreW = (r, w) => R(r.x + (r.w - w) / 2, r.y, w, r.h);

/**
 * Card geometry for every screen. DECISION: all card geometry lives here (not in ui.js) so layout-test can
 * assert inside-safe / no-overlap / >= 44 px buttons / >= 12 px text for every screen at every size.
 * opts: { firstBoot, canFreeze, nextSkin, iconRows, showMute, items (map count) }
 */
export function cardLayout(L, name, opts = {}) {
  const c = L.card, cu = c.cu, U = v => v * cu, S = L.menu || L.safe;
  const pad = Math.max(10, U(16));
  const fs = {
    title: Math.max(22, U(30)), head: Math.max(26, U(40)), btn: Math.max(16, U(22)), btn2: Math.max(14, U(17)),
    body: Math.max(13, U(16)), small: Math.max(12, U(13)), stat: Math.max(14, U(18)), count: Math.max(12, U(14)),
    big: Math.max(18, U(26)),
  };
  const primH = Math.max(52, U(60)), secH = Math.max(44, U(46)), retryH = Math.max(56, U(64));
  const out = { panel: c, blocks: {}, buttons: [], fs, pad, cu };
  const B = out.blocks, btn = (id, r, primary = false) => out.buttons.push({ id, r, primary });
  const inner = R(c.x + pad, c.y + pad, c.w - 2 * pad, c.h - 2 * pad);
  const gap = Math.max(6, U(10));

  if (name === 'title') {
    // Full-screen title, not a card.
    const u = L.u, P2 = Math.max(10, u * 14);
    const topH = Math.max(44, u * 44);
    const fb = !!opts.firstBoot;
    B.mute = opts.showMute ? R(S.x + P2, S.y + P2, topH, topH) : null;
    if (B.mute) btn('mute', B.mute);
    const pillW = Math.max(84, u * 104);
    B.coins = fb ? null : R(S.x + S.w - P2 - pillW, S.y + P2, pillW, topH);
    B.stars = fb ? null : R(B.coins.x - Math.max(6, u * 8) - pillW, S.y + P2, pillW, topH);
    const iconB = Math.max(48, u * 58), lab = Math.max(12, u * 13), cellW = Math.max(iconB + 8, lab * 5.2);
    const n = 6;
    const ids = ['map', 'daily', 'feast', 'cookbook', 'shop', 'settings'];
    if (L.aspect === 'landscape') {
      const half = S.w / 2;
      const left = R(S.x + P2, S.y + topH + P2, half - 2 * P2, S.h - topH - 2 * P2);
      const right = R(S.x + half + P2 * 0.5, S.y + topH + P2, half - 1.5 * P2, S.h - topH - 2 * P2);
      B.logo = R(left.x, left.y, left.w, Math.min(left.h * 0.34, u * 120));
      B.pot = R(left.x, B.logo.y + B.logo.h, left.w, left.y + left.h - (B.logo.y + B.logo.h));
      const pw = Math.min(right.w, Math.max(220, u * 320)), ph = Math.max(60, u * 74);
      // DECISION: balanced rows: 6 icons that need two rows go 3 + 3, never 5 + 1 or 4 + 2
      const fit = Math.max(1, Math.min(n, Math.floor((right.w + 6) / (cellW + 6))));
      const perRow = Math.ceil(n / Math.ceil(n / fit));
      const rowsN = fb ? 0 : Math.ceil(n / perRow), rowH = iconB + lab * 1.5 + 6;
      const total = ph + (rowsN ? gap * 2 + rowsN * rowH : 0);
      let y = right.y + Math.max(0, (right.h - total) / 2);
      B.play = R(right.x + (right.w - pw) / 2, y, pw, ph); btn('play', B.play, true);
      y += ph + gap * 2;
      if (!fb) iconGrid(ids, right.x, y, right.w, perRow, cellW, iconB, rowH, lab);
    } else {
      const usable = R(S.x + P2, S.y + topH + P2, S.w - 2 * P2, S.h - topH - 2 * P2);
      const perRow = (n * cellW + (n - 1) * 6) <= usable.w ? n : 3;
      const rowsN = fb ? 0 : Math.ceil(n / perRow), rowH = iconB + lab * 1.5 + 6;
      const iconsH = rowsN ? rowsN * rowH : 0;
      const pw = Math.min(usable.w, Math.max(240, L.u * 300)), ph = Math.max(60, L.u * 76);
      const logoH = Math.min(usable.h * 0.2, Math.max(70, L.u * 130));
      const potH = Math.max(0, usable.h - logoH - ph - iconsH - gap * (rowsN ? 4 : 2));
      B.logo = R(usable.x, usable.y, usable.w, logoH);
      B.pot = R(usable.x, B.logo.y + logoH, usable.w, potH);
      B.play = R(usable.x + (usable.w - pw) / 2, B.pot.y + potH + gap, pw, ph); btn('play', B.play, true);
      if (!fb) iconGrid(ids, usable.x, B.play.y + ph + gap * 2, usable.w, perRow, cellW, iconB, rowH, lab);
    }
    fs.logo = Math.max(30, L.u * 54); fs.label = lab; fs.play = Math.max(22, L.u * 30); fs.pill = Math.max(14, L.u * 18);
    return out;
  }
  function iconGrid(ids, x, y, w, perRow, cellW, iconB, rowH, lab) {
    B.icons = [];
    for (let i = 0; i < ids.length; i++) {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, ids.length - row * perRow);
      const gx = (w - inRow * cellW) / (inRow + 1);
      const cx = x + gx + col * (cellW + gx) + cellW / 2;
      const r = R(cx - iconB / 2, y + row * rowH, iconB, iconB);
      const labR = R(cx - cellW / 2, r.y + iconB + 2, cellW, lab * 1.3);
      B.icons.push({ id: ids[i], r, lab: labR });
      btn(ids[i], r);
    }
  }

  if (name === 'win' || name === 'fail') {
    const fail = name === 'fail';
    const twoCol = c.wide;
    const colL = twoCol ? R(inner.x, inner.y, inner.w * 0.46, inner.h) : inner;
    const colR = twoCol ? R(inner.x + inner.w * 0.5, inner.y, inner.w * 0.5, inner.h) : inner;
    const headH = Math.max(fs.head * 1.25, U(64));
    const rowsL = [
      { id: 'head', h: headH, min: fs.head * 1.15 },
      ...(fail ? [{ id: 'sub', h: Math.max(fs.body * 1.6, U(28)), min: fs.body * 1.4 }] : []),
      { id: 'hero', h: U(150), min: 0, gap },
    ];
    const rowsR = fail ? [
      { id: 'bar', h: Math.max(40, U(56)), min: 38, gap },
      { id: 'lines', h: Math.max(42, U(52)), min: 40, gap },
      ...(opts.canFreeze ? [{ id: 'freeze', h: Math.max(48, U(54)), min: 48, gap: gap * 1.4 }] : []),
      { id: 'retry', h: retryH, min: retryH, gap: gap * 1.4 },
      { id: 'sec', h: secH, min: secH, gap },
    ] : [
      { id: 'stars', h: Math.max(44, U(66)), min: 40, gap },
      { id: 'stats', h: Math.max(fs.stat * 1.6, U(34)), min: fs.stat * 1.45, gap },
      { id: 'coins', h: Math.max(fs.stat * 1.7, U(40)), min: fs.stat * 1.5, gap: gap * 0.5 },
      ...(opts.nextSkin ? [{ id: 'hint', h: Math.max(fs.small * 1.6, U(24)), min: fs.small * 1.4 }] : []),
      { id: 'next', h: primH, min: primH, gap: gap * 1.4 },
      { id: 'sec', h: secH, min: secH, gap },
    ];
    let A, Bk;
    if (twoCol) {
      A = stack(colL.x, colL.y, colL.w, colL.h, rowsL);
      const spareL = colL.h - (A._end - colL.y);
      if (spareL > 8) {                                    // DECISION: same hero growth as the single column (see below)
        const hero = rowsL.find(r => r.id === 'hero'); hero.h += Math.min(spareL * 0.7, U(170));
        A = stack(colL.x, colL.y, colL.w, colL.h, rowsL);
      }
      const want = rowsR.reduce((s, r) => s + r.h + (r.gap || 0), 0);
      Bk = stack(colR.x, colR.y + Math.max(0, (colR.h - want) / 2), colR.w, colR.h, rowsR);
      // centre the left column vertically too
      const lh = A._end - colL.y; if (lh < colL.h) { const d = (colL.h - lh) / 2; for (const k in A) if (k !== '_end') A[k].y += d; }
    } else {
      // DECISION: on a tall single-column card the hero (ticket + pot) takes up to 60 % of the spare height (cap +110u)
      //   before the stack is centred, so the card reads full instead of floating in empty paper.
      let all = stack(inner.x, inner.y, inner.w, inner.h, [...rowsL, ...rowsR]);
      const spare = inner.h - (all._end - inner.y);
      if (spare > 8) {
        const hero = rowsL.find(r => r.id === 'hero'); hero.h += Math.min(spare * 0.6, U(110));
        all = stack(inner.x, inner.y, inner.w, inner.h, [...rowsL, ...rowsR]);
      }
      A = all; Bk = all;
      const used = all._end - inner.y;
      if (used < inner.h) { const d = (inner.h - used) / 2; for (const k in all) if (k !== '_end') all[k].y += d; }
    }
    for (const k in A) if (k !== '_end') B[k] = A[k];
    for (const k in Bk) if (k !== '_end') B[k] = Bk[k];
    const bw = Math.min(B.sec.w, Math.max(200, U(280)));
    if (fail) {
      B.retry = centreW(B.retry, bw); btn('retry', B.retry, true);
      if (B.freeze) { B.freeze = centreW(B.freeze, Math.min(B.freeze.w, Math.max(220, U(300)))); btn('freeze', B.freeze); }
      const mw = Math.min(B.sec.w, Math.max(120, U(150)));
      B.map = centreW(B.sec, mw); btn('map', B.map);
    } else {
      B.next = centreW(B.next, bw); btn('next', B.next, true);
      const sw = Math.min((B.sec.w - gap) / 2, Math.max(110, U(140)));
      B.replay = R(B.sec.x + B.sec.w / 2 - gap / 2 - sw, B.sec.y, sw, B.sec.h); btn('replay', B.replay);
      B.map = R(B.sec.x + B.sec.w / 2 + gap / 2, B.sec.y, sw, B.sec.h); btn('map', B.map);
    }
    delete B.sec;
    return out;
  }

  if (name === 'pause') {
    const mb = Math.max(44, U(44));
    const rowSec = !!c.wide;                               // landscape: Restart · Map · Settings in one row
    const rows = [
      { id: 'title', h: Math.max(fs.title * 1.3, opts.showMute ? mb : 0), min: Math.max(fs.title * 1.2, opts.showMute ? mb : 0) },
      { id: 'level', h: fs.body * 1.6, min: fs.body * 1.4 },
      { id: 'resume', h: primH, min: primH, gap: gap * 1.5 },
      ...(rowSec ? [{ id: 'secrow', h: secH, min: secH, gap: gap * 1.2 }] : [
        { id: 'restart', h: secH, min: secH, gap },
        { id: 'map', h: secH, min: secH, gap },
        { id: 'settings', h: secH, min: secH, gap }]),
    ];
    const want = rows.reduce((s, r) => s + r.h + (r.gap || 0), 0) + 2 * pad;
    const ph = Math.min(c.h, want + U(24));
    const pw = Math.min(c.w, c.wide ? Math.max(U(440), 360) : c.w);
    const panel = R(c.x + (c.w - pw) / 2, c.y + (c.h - ph) / 2, pw, ph);
    out.panel = panel;
    const inn = R(panel.x + pad, panel.y + pad, panel.w - 2 * pad, panel.h - 2 * pad);
    const s = stack(inn.x, inn.y, inn.w, inn.h, rows);
    const used = s._end - inn.y, d = Math.max(0, (inn.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
    const bw = Math.min(inn.w, Math.max(220, U(260)));
    if (rowSec) {
      const r = B.secrow, w3 = (r.w - 2 * gap) / 3; delete B.secrow;
      ['restart', 'map', 'settings'].forEach((id, i) => { B[id] = R(r.x + i * (w3 + gap), r.y, w3, r.h); });
    }
    for (const id of ['resume', 'restart', 'map', 'settings']) { if (id === 'resume' || !rowSec) B[id] = centreW(B[id], bw); btn(id, B[id], id === 'resume'); }
    if (opts.showMute) {
      const t = B.title;
      B.mute = R(t.x + t.w - mb, t.y + (t.h - mb) / 2, mb, mb); btn('mute', B.mute);
      B.title = R(t.x + mb + gap, t.y, t.w - 2 * (mb + gap), t.h);
    }
    return out;
  }

  if (name === 'settings') {
    const wide = !!c.wide;                                 // landscape: Reset and Done share the last row
    const rows = [
      { id: 'title', h: fs.title * 1.4, min: fs.title * 1.2 },
      { id: 'music', h: Math.max(48, U(54)), min: 44, gap },
      { id: 'sfx', h: Math.max(48, U(54)), min: 44, gap },
      { id: 'stick', h: Math.max(48, U(54)), min: 44, gap },
      ...(wide ? [] : [{ id: 'reset', h: secH, min: secH, gap: gap * 1.5 }]),
      { id: 'credits', h: fs.small * 1.6, min: fs.small * 1.4, gap },
      { id: 'done', h: primH, min: primH, gap: gap * 1.5 },
    ];
    const iw = wide ? Math.min(inner.w, Math.max(360, U(460))) : inner.w, ix = inner.x + (inner.w - iw) / 2;
    const s = stack(ix, inner.y, iw, inner.h, rows);
    const used = s._end - inner.y, d = Math.max(0, (inner.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
    const tw = Math.max(64, U(76)), th = 44;
    for (const id of ['music', 'sfx', 'stick']) {
      const r = B[id];
      B[id + 'T'] = R(r.x + r.w - tw, r.y + (r.h - th) / 2, tw, th); btn(id, B[id + 'T']);
    }
    if (wide) {
      const r = B.done, w2 = Math.min((r.w - gap) / 2, Math.max(160, U(220)));
      B.reset = R(r.x + r.w / 2 - gap / 2 - w2, r.y + (r.h - secH) / 2, w2, secH); btn('reset', B.reset);
      B.done = R(r.x + r.w / 2 + gap / 2, r.y, w2, r.h); btn('done', B.done, true);
    } else {
      B.reset = centreW(B.reset, Math.min(inner.w, Math.max(200, U(240)))); btn('reset', B.reset);
      B.done = centreW(B.done, Math.min(inner.w, Math.max(200, U(260)))); btn('done', B.done, true);
    }
    return out;
  }

  if (name === 'map') {
    // Simple Wednesday-placeholder map: a grid of level nodes; back top-left.
    const bk = Math.max(44, U(48));
    B.back = R(inner.x, inner.y, bk, bk); btn('back', B.back);
    B.title = R(inner.x + bk + gap, inner.y, inner.w - 2 * (bk + gap), bk);
    const n = opts.items || 20;
    const gy = inner.y + bk + gap * 1.5, gh = inner.y + inner.h - gy, labH = fs.small * 1.4;
    let best = null;
    for (let cols = 2; cols <= n; cols++) {
      const rowsN = Math.ceil(n / cols);
      const nd = Math.min((inner.w - (cols - 1) * gap) / cols, (gh - (rowsN - 1) * gap) / rowsN - labH, U(72));
      if (!best || nd > best.nd + 0.5) best = { cols, nd };
    }
    const cols = best.cols, node = Math.max(44, best.nd);
    const gw = cols * node + (cols - 1) * gap, gx = inner.x + (inner.w - gw) / 2;
    B.nodes = [];
    for (let i = 0; i < n; i++) {
      const r = R(gx + (i % cols) * (node + gap), gy + Math.floor(i / cols) * (node + gap + labH), node, node);
      B.nodes.push(r); btn('lvl' + (i + 1), r);
    }
    return out;
  }

  // Generic placeholder / info card (shop, cookbook, daily, feast, alldone, gift, ...): icon, title, body, primary?, back
  {
    const rows = [
      { id: 'icon', h: U(120), min: 48 },
      { id: 'title', h: fs.title * 1.4, min: fs.title * 1.2, gap },
      { id: 'body', h: fs.body * 3.4, min: fs.body * 2.8, gap },
      ...(opts.primary ? [{ id: 'primary', h: primH, min: primH, gap: gap * 1.5 }] : []),
      ...(opts.noBack ? [] : [{ id: 'back', h: secH, min: secH, gap: gap * 1.2 }]),
    ];
    // DECISION: a card whose primary already closes it (gift: Collect) has no Back button (opts.noBack).
    // DECISION: spare card height goes to the icon/art block first (as the win/fail hero), then the rest is centred.
    let s = stack(inner.x, inner.y, inner.w, inner.h, rows);
    const spare = inner.h - (s._end - inner.y);
    if (spare > 8) { rows[0].h += Math.min(spare * 0.6, U(130)); s = stack(inner.x, inner.y, inner.w, inner.h, rows); }
    const used = s._end - inner.y, d = Math.max(0, (inner.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
    const bw = Math.min(inner.w, Math.max(200, U(260)));
    if (B.primary) { B.primary = centreW(B.primary, bw); btn('primary', B.primary, true); }
    if (B.back) { B.back = centreW(B.back, Math.min(inner.w, Math.max(140, U(170)))); btn('back', B.back, !opts.primary); }
    return out;
  }
}
