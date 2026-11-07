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

  // DECISION (Friday fix 2, U10): from 820 wide on anything taller than a landscape phone, the ticket's level name, counters
  //   and goal icons run 1.3x (hu). Phones never meet the test (a landscape phone is 820+ wide but under 600 tall).
  // DECISION (11-07 Sat, curator r5 "landscape HUD tiny"): a landscape phone (u about 0.75 at 844x390) left the ticket text on
  //   the 12.5 px floor, a quarter smaller than portrait. Its ticket runs 1.25x (hu about 0.94): the ticket owns its own left
  //   column (the play rect starts right of it), so the bigger text costs about 30 px of width and no play space.
  const lphone = aspect === 'landscape' && Math.min(W, H) < 600 && !record;
  const hs = W >= 820 && Math.min(W, H) >= 600 && !record ? 1.3 : lphone ? 1.25 : 1, hu = u * hs;
  // font sizes (CSS px), all floored at 12.5 (Wednesday brief: 12.5 px text floor)
  const fs = {
    hdr: Math.max(12.5, hu * 16), count: Math.max(12.5, hu * 14), serve: Math.max(13, U(16)), callout: Math.max(12.5, U(16)),
    secs: Math.max(12.5, U(18)), chain: Math.max(16, U(22)), badge: Math.max(12.5, U(12)), label: Math.max(12.5, U(13)),
    caption: Math.max(20, U(27)), bump: Math.max(13, U(15)),
  };
  const btn = Math.max(44, U(44)), bst = Math.max(44, U(52)), tmr = Math.max(46, U(64));
  const bstTag = Math.max(19, U(21)) * 0.45;   // the coin tag's overhang below a booster tin (ui.js drawBoosters: ph = max(19, 21u), 0.45 below)
  const inset = U(10), top = safe.y + U(8);
  const cm = chipMetrics(hu, fs.count);
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
    let below = hud.meter.y + mh;
    if (opts.feast) { const sh = Math.max(22, U(24)); hud.strip = R(hud.meter.x, below + Math.max(3, U(4)), hud.meter.w, sh); below = hud.strip.y + sh; }
    hud.callout = R(safe.x + U(10), below + Math.max(4, U(6)), SW - U(20), ch);
    const gap = Math.max(8, U(10)), colH = 3 * bst + 2 * gap;
    // DECISION (Friday fix U5): the booster column used to sit at 40 % of the screen height, on live play space; it now
    //   rides the lowest right corner just above the safe area (thumb reach, off the pot's usual line), like landscape.
    // DECISION (11-07 Sat, viral r6 "lowest booster label cut by the screen edge"): the coin tag hangs 0.45 of its height
    //   below each tin (ui.js drawBoosters), so the column also clears that overhang (bstTag); the last tag sat 1 px off the edge.
    let y0 = sb - U(12) - bstTag - colH;
    y0 = Math.max(y0, hud.callout.y + ch + U(8));
    hud.boosters = [0, 1, 2].map(i => R(sr - inset - bst, y0 + i * (bst + gap), bst, bst));
    const py = hud.callout.y + ch;
    play = R(safe.x, py, SW, sb - py);
    play.cx = safe.x + SW / 2; play.cy = safe.y + 0.6 * SH;
  } else {
    const colW = Math.max(U(220) * (1 + (hs - 1) * 0.8), 168), col = R(safe.x + inset, top, colW, 0);
    hud.timer = R(col.x + colW - tmr, top, tmr, tmr);
    const tw = hud.timer.x - U(4) - col.x;
    const lineH = Math.max(28, hu * 34);
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
    let below = Math.max(hud.meter.y + mh, hud.pause.y + btn);
    if (opts.feast) { const sh = Math.max(22, U(24)); hud.strip = R(mx0, below + Math.max(3, U(4)), mx1 - mx0, sh); below = hud.strip.y + sh; }
    const cy = below + Math.max(4, U(6));
    hud.callout = R(mx0, cy, mx1 - mx0, ch);
    const gap = Math.max(8, U(10)), colH = 3 * bst + 2 * gap;
    let y0 = sb - U(12) - bstTag - colH;
    y0 = Math.max(y0, hud.callout.y + ch + U(8));
    hud.boosters = [0, 1, 2].map(i => R(sr - inset - bst, y0 + i * (bst + gap), bst, bst));
    const px = col.x + colW + U(10), py = below + Math.max(4, U(6));
    play = R(px, py, sr - px, sb - py);
    play.cx = play.x + play.w / 2; play.cy = play.y + 0.6 * play.h;
  }
  // DECISION: the Daily bump-counter chip (a daily with a "No bumps" line) sits at the bottom-left of the safe rect:
  //   the boosters own the right edge, the landscape ticket column is empty below the ticket, and the pot is centred.
  if (opts.bump) { const bh = Math.max(34, U(38)), bw = Math.max(84, U(96)); hud.bump = R(safe.x + inset, sb - U(12) - bh, bw, bh); }
  // DECISION: record/og caption band (hook / cap2 / end from the recorder state) at the top of the play rect, full
  //   width minus 16u, clear of the ticket/meter rows; the callout band is never shown in those modes.
  if (record || opts.caption) {
    const chh = Math.max(56, U(78)), cy = play.y + U(10), cx0 = play.x + (aspect === 'landscape' ? U(4) : U(16));
    let cr = sr - U(16);
    const b0 = hud.boosters[0];
    if (b0.y < cy + chh && b0.y + 3 * bst + 2 * Math.max(8, U(10)) > cy) cr = Math.min(cr, b0.x - U(8));
    hud.caption = R(cx0, cy, cr - cx0, chh);
  }
  // Edge arrows live inside the play rect (never over the HUD rows), 10u from its edges.
  hud.arrowZone = R(play.x + inset, play.y + inset, play.w - 2 * inset, play.h - 2 * inset);
  hud.arrow = Math.max(30, U(34));
  hud.btn = btn; hud.bst = bst; hud.tmr = tmr; hud.chip = cm;

  // ---- card frame ----
  const cmg = Math.max(10, U(16)), MH = menu.h;
  let card;
  if (aspect === 'landscape') {
    // DECISION (U11, Friday fix 2 U5): the card hugs its content height instead of filling the screen, and past 1440 wide it
    //   keeps growing at 0.85 of u: a fixed 1.35x cap left a small card on a 1920 screen (critics asked for about 1.3x).
    const uc = cardScale(u), Uc = v => v * uc;
    const ch = Math.min(MH - 2 * Math.max(8, U(12)), Math.max(Uc(560), 350));
    const cw = Math.min(SW - 2 * cmg, Math.max(Uc(660), Math.min(ch * 1.75, Uc(780))));
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

const cardScale = u => Math.min(u, Math.max(1.35, u * 0.85));
// DECISION (Friday fix 2, U5): win, fail and every other short stack on a landscape screen with room are one centred column: the
//   same stack a phone gets, scaled up. Two columns left a dead middle (headline left, buttons right). Short landscape phones keep
//   two columns. Shop and Cookbook stay two columns: their grids really use the width.
const COLUMN_CARDS = new Set(['win', 'fail', 'settings', 'feast', 'feastend', 'daily', 'ladder', 'info']);
function columnCard(L, S) {
  const u = L.u, ch = Math.min(S.h - 2 * Math.max(8, u * 12), 640 * cardScale(u));
  const cu = clamp(ch / 620, 0.5, 2.2), cw = Math.min(S.w - 2 * Math.max(10, u * 16), cu * 430);
  return Object.assign(R(S.x + (S.w - cw) / 2, S.y + (S.h - ch) / 2, cw, ch), { wide: false, cu });
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
  const S = L.menu || L.safe;
  const c = COLUMN_CARDS.has(name) && L.card.wide && S.h >= 620 ? columnCard(L, S) : L.card;
  const cu = c.cu, U = v => v * cu;
  const pad = Math.max(10, U(16));
  const fs = {
    title: Math.max(22, U(30)), head: Math.max(26, U(40)), btn: Math.max(16, U(22)), btn2: Math.max(14, U(17)),
    body: Math.max(13, U(16)), small: Math.max(12.5, U(13)), stat: Math.max(14, U(18)), count: Math.max(12.5, U(14)),
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
    const iconB = Math.max(48, u * 58), lab = Math.max(12.5, u * 13), cellW = Math.max(iconB + 8, lab * 5.2);
    const n = 6;
    const ids = ['map', 'daily', 'feast', 'cookbook', 'shop', 'settings'];
    // DECISION (Friday fix): a landscape screen with room (>= 600 px tall, a desktop) uses the phone's centred column (wordmark,
    //   pot, PLAY) scaled up; only short landscape phones keep the two-column group, with the wordmark centred over it.
    if (L.aspect === 'landscape' && S.h < 600) {
      // DECISION (U11): on a wide desktop the logo/pot and PLAY form one centred group (max ~ 780u wide), not two ends of the screen.
      const gw = Math.min(S.w, Math.max(900, u * 780)), gx = S.x + (S.w - gw) / 2, half = gw / 2;
      const left = R(gx + P2, S.y + topH + P2, half - 2 * P2, S.h - topH - 2 * P2);
      const logoH2 = Math.min(left.h * 0.34, u * 120);
      const right = R(gx + half + P2 * 0.5, left.y, half - 1.5 * P2, left.h);
      B.pot = R(left.x, left.y + logoH2, left.w, left.h - logoH2);
      const pw = Math.min(right.w, Math.max(220, u * 320)), ph = Math.max(60, u * 74);
      // DECISION: balanced rows: 6 icons that need two rows go 3 + 3, never 5 + 1 or 4 + 2
      const fit = Math.max(1, Math.min(n, Math.floor((right.w + 6) / (cellW + 6))));
      const perRow = Math.ceil(n / Math.ceil(n / fit));
      const rowsN = fb ? 0 : Math.ceil(n / perRow), rowH = iconB + lab * 1.5 + 6;
      const total = ph + (rowsN ? gap * 2 + rowsN * rowH : 0);
      // wordmark centred over the whole group when the right stack fits under it, else over the left column only
      const wideLogo = total + logoH2 <= left.h;
      B.logo = wideLogo ? R(gx + P2, left.y, gw - 2 * P2, logoH2) : R(left.x, left.y, left.w, logoH2);
      let y = right.y + Math.max(wideLogo ? logoH2 : 0, (right.h - total) / 2);
      B.play = R(right.x + (right.w - pw) / 2, y, pw, ph); btn('play', B.play, true);
      y += ph + gap * 2;
      if (!fb) iconGrid(ids, right.x, y, right.w, perRow, cellW, iconB, rowH, lab);
    } else {
      const usable = R(S.x + P2, S.y + topH + P2, S.w - 2 * P2, S.h - topH - 2 * P2);
      const perRow = (n * cellW + (n - 1) * 6) <= usable.w ? n : 3;
      const rowsN = fb ? 0 : Math.ceil(n / perRow), rowH = iconB + lab * 1.5 + 6;
      const iconsH = rowsN ? rowsN * rowH : 0;
      // DECISION (Friday fix 2, U5): on a desktop PLAY stops near 300 px, the wordmark runs 1.5x, and wordmark, pot, PLAY and
      //   icons close up into one group centred on the screen. A phone-style stretch left a 480 px button under a small logo.
      const dk = L.aspect === 'landscape';
      const pw = dk ? Math.min(usable.w, clamp(L.u * 190, 260, 340)) : Math.min(usable.w, Math.max(240, L.u * 300));
      const ph = dk ? clamp(L.u * 50, 60, 92) : Math.max(60, L.u * 76);
      const logoH = dk ? Math.min(usable.h * 0.26, Math.max(105, L.u * 130)) : Math.min(usable.h * 0.2, Math.max(70, L.u * 130));
      const room = usable.h - logoH - ph - iconsH - gap * (rowsN ? 4 : 2);
      const potH = Math.max(0, dk ? Math.min(room, L.u * 250) : room);
      if (dk) usable.y += Math.max(0, (room - potH) / 2);
      B.logo = R(usable.x, usable.y, usable.w, logoH);
      B.pot = R(usable.x, B.logo.y + logoH, usable.w, potH);
      B.play = R(usable.x + (usable.w - pw) / 2, B.pot.y + potH + gap, pw, ph); btn('play', B.play, true);
      if (!fb) iconGrid(ids, usable.x, B.play.y + ph + gap * 2, usable.w, perRow, cellW, iconB, rowH, lab);
    }
    const dkT = L.aspect === 'landscape' && S.h >= 600;
    fs.logo = Math.max(30, L.u * (dkT ? 81 : 54)); fs.label = lab; fs.play = dkT ? clamp(L.u * 21, 24, 36) : Math.max(22, L.u * 30); fs.pill = Math.max(14, L.u * 18);
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
    const tipRow = { id: 'tip', h: Math.max(fs.body * 1.7, U(30)), min: fs.small * 1.5, gap: gap * 0.6 };
    const helpRow = { id: 'help', h: Math.max(fs.body * 1.5, U(26)), min: fs.small * 1.4, gap: gap * 0.8 };
    const buyRow = { id: 'hint', h: Math.max(44, U(46)), min: 44, gap: gap * 0.5 };
    // 11-07 Sat, U6: what this win paid beyond its coins (gift, chest, star bonus), so NEXT can go straight on.
    const stripRow = { id: 'strip', h: Math.max(40, U(46)), min: 36, gap: gap * 0.5 };
    const rowsL = [
      { id: 'head', h: headH, min: fs.head * 1.15 },
      ...(fail ? [{ id: 'sub', h: Math.max(fs.body * 1.6, U(28)), min: fs.body * 1.4 }] : []),
      { id: 'hero', h: U(150), min: 0, gap },
      // Friday fix 2: on two columns (short landscape phones only) the right column is full, so the extra lines ride under the hero.
      ...(fail && opts.help && twoCol ? [helpRow] : []),
      ...(fail && opts.tip && twoCol ? [tipRow] : []),
      ...(!fail && opts.strip && twoCol ? [stripRow] : []),
      ...(!fail && opts.buySkin && twoCol ? [buyRow] : []),
    ];
    const rowsR = fail ? [
      // DECISION (Friday fix U2): with an ingredient line missing the size bar is hidden and its room goes to the order row.
      ...(opts.noBar ? [] : [{ id: 'bar', h: Math.max(40, U(56)), min: 38, gap }]),
      { id: 'lines', h: opts.noBar ? Math.max(70, U(96)) : Math.max(42, U(52)), min: opts.noBar ? 56 : 40, gap },
      ...(opts.tip && !twoCol ? [tipRow] : []),
      // Friday fix 2, U8: the mercy line sits right on top of the button it explains.
      ...(opts.help && !twoCol ? [helpRow] : []),
      { id: 'retry', h: retryH, min: retryH, gap: opts.help && !twoCol ? gap * 0.5 : gap * 1.4 },
      // 11-07 Sat, U2: RETRY is the first thing the thumb lands on; paying to go on sits under it.
      ...(opts.canFreeze ? [{ id: 'freeze', h: Math.max(48, U(54)), min: 48, gap: gap * 0.8 }] : []),
      { id: 'sec', h: secH, min: secH, gap },
    ] : [
      { id: 'stars', h: Math.max(44, U(66)), min: 40, gap },
      // Friday fix 2, U1: what the third star wants, in words, with a small bar.
      ...(opts.goal ? [{ id: 'goal', h: Math.max(fs.small * 2.9, U(46)), min: fs.small * 2.5, gap: gap * 0.5 }] : []),
      { id: 'stats', h: Math.max(fs.stat * 1.6, U(34)), min: fs.stat * 1.45, gap },
      { id: 'coins', h: Math.max(fs.stat * 1.7, U(40)), min: fs.stat * 1.5, gap: gap * 0.5 },
      ...(opts.strip && !twoCol ? [stripRow] : []),
      // Friday fix 2, U3: an affordable pot is a real button (44 px), a pot still out of reach is one line of text.
      ...(opts.buySkin ? (twoCol ? [] : [buyRow])
        : opts.nextSkin ? [{ id: 'hint', h: Math.max(fs.small * 1.6, U(24)), min: fs.small * 1.4 }] : []),
      { id: 'next', h: primH, min: primH, gap: gap * 1.4 },
      { id: 'sec', h: secH, min: secH, gap },
    ];
    // 11-07 Sat, U6: a very short single column with the strip too: the third-star line goes, the buttons stay on the card.
    if (!fail && !twoCol && [...rowsL, ...rowsR].reduce((s, r) => s + (r.min ?? r.h) + (r.gap || 0), 0) > inner.h) {
      const gi = rowsR.findIndex(r => r.id === 'goal');
      if (gi >= 0) rowsR.splice(gi, 1);
    }
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
      // DECISION (11-07 Sat, r4 mobile-designer): a win card sits on the bottom of the column instead of its centre, so NEXT is at the same
      //   height on every win card and a thumb that learned it on L1 still lands on it when a goal, strip or Buy row makes the card taller.
      if (used < inner.h) { const d = (inner.h - used) / (fail ? 2 : 1); for (const k in all) if (k !== '_end') all[k].y += d; }
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
      if (opts.buySkin && B.hint) { B.hint = centreW(B.hint, Math.min(B.hint.w, Math.max(240, U(320)))); btn('buySkin', B.hint); }
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
      // Friday fix 2, U1: the three star targets, three small cells.
      ...(opts.stars ? [{ id: 'stars', h: Math.max(fs.small * 3.6, U(58)), min: fs.small * 3.2, gap: gap * 0.6 }] : []),
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
      { id: 'music', h: Math.max(48, U(58)), min: 44, gap },
      { id: 'sfx', h: Math.max(48, U(58)), min: 44, gap },
      { id: 'stick', h: Math.max(48, U(58)), min: 44, gap },
      ...(wide ? [] : [{ id: 'reset', h: secH, min: secH, gap: gap * 1.5 }]),
      { id: 'credits', h: fs.small * 1.6, min: fs.small * 1.4, gap },
      { id: 'done', h: primH, min: primH, gap: gap * 1.5 },
    ];
    const iw = wide ? Math.min(inner.w, Math.max(360, U(500))) : inner.w, ix = inner.x + (inner.w - iw) / 2;
    const s = stack(ix, inner.y, iw, inner.h, rows);
    const used = s._end - inner.y, d = Math.max(0, (inner.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
    // DECISION (11-05, art lane): the panel hugs its rows, as the pause card does; at 390 it stood half empty.
    if (d > 0) out.panel = R(c.x, inner.y + d - pad, c.w, used + 2 * pad);
    // DECISION (Friday fix 2, U5): a toggle grows with the card (it was stuck at 44 px tall on a desktop) and a row's label reads
    //   fs.row, a step above body text, floored where it always was on a phone.
    const tw = Math.max(64, U(84)), th = Math.max(44, U(46));
    fs.row = Math.max(fs.body, U(19));
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

  if (name === 'map') return mapLayout(L, out, opts);

  // DECISION: two-column cards (landscape) put the art/preview on the left and the list/buttons on the right;
  //   portrait stacks them. Spare height always goes to the flex art block first, then the stack is centred.
  const wide = !!c.wide;
  const colL = wide ? R(inner.x, inner.y, inner.w * 0.44 - gap / 2, inner.h) : inner;
  const colR = wide ? R(inner.x + inner.w * 0.44 + gap / 2, inner.y, inner.w * 0.56 - gap / 2, inner.h) : inner;
  // DECISION: rows marked opt (a name line, a section label, the cookbook title) are dropped, last first, when the
  //   card is too short for every row's minimum (320x480), instead of squeezing buttons under 44 px.
  const place = (col, rows0, flex, share = 0.8, cap = 220) => {
    const rows = rows0.filter(Boolean);
    const minSum = () => rows.reduce((a, r) => a + (r.min ?? r.h) + (r.gap || 0), 0);
    while (minSum() > col.h + 0.5 && rows.some(r => r.opt)) rows.splice(rows.map(r => !!r.opt).lastIndexOf(true), 1);
    let s = stack(col.x, col.y, col.w, col.h, rows);
    const spare = col.h - (s._end - col.y);
    const fr = flex && rows.find(r => r.id === flex);
    if (fr && spare > 4) { fr.h += Math.min(spare * share, U(cap)); s = stack(col.x, col.y, col.w, col.h, rows); }
    const used = s._end - col.y, d = Math.max(0, (col.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
  };
  const bwP = w => Math.min(w, Math.max(200, U(260))), bwS = w => Math.min(w, Math.max(140, U(170)));
  const heroCap = (base = 150) => Math.min(300, Math.max(0, colL.w * 0.75 - U(base)) / cu);   // flex cap, in U units
  // DECISION (Friday fix 2, U6): the feast art is 4:3, so a hero taller than that is a hole above and below it. The hero stops at the
  //   art's own height and the panel then hugs the rows, as Settings does, instead of leaving spare card on show.
  const artCap = base => Math.max(0, inner.w * 0.74 / cu - base);
  const hug = () => {
    let t = Infinity, b = -Infinity;
    for (const k in B) { const r = B[k]; if (r && r.h != null) { t = Math.min(t, r.y); b = Math.max(b, r.y + r.h); } }
    if (t - inner.y > 2) out.panel = R(c.x, t - pad, c.w, b - t + 2 * pad);
  };
  const titleRow = { id: 'title', h: fs.title * 1.4, min: fs.title * 1.2 };
  const pillW = Math.max(84, U(96)), pillH = Math.max(34, U(38));
  const coinPill = () => {                                 // coin pill at the right end of the title row
    const t = B.title; B.coins = R(t.x + t.w - pillW, t.y + (t.h - pillH) / 2, pillW, pillH);
    B.title = R(t.x, t.y, t.w - pillW - gap, t.h);
  };

  if (name === 'shop') {
    // Pot skins: preview + name + Wear/Buy (tap twice to buy), a 5 x 2 skin grid, then the booster shelf
    // (magnet, freeze, mega, lid: tin + count, coin-price button under each).
    const cg = w => Math.max(2, Math.min(gap, (w - 5 * 44) / 4));
    const cellOf = w => Math.max(44, Math.min((w - 4 * cg(w)) / 5, U(68)));
    const gridH = w => 2 * cellOf(w) + cg(w);
    // DECISION: a booster tile is the round tin itself (the buy button, >= 44 px) with its coin price under it;
    //   one tap buys one (coins permitting), no confirm: boosters are cheap and stack (skins confirm, see ui.js).
    const tileW = w => (w - 3 * gap) / 4, iconD = w => Math.max(44, Math.min(tileW(w) * 0.8, U(56)));
    const priceH = Math.max(fs.small * 1.5, U(22));
    const shelfH = w => iconD(w) + Math.max(2, U(3)) + priceH;
    const rowsA = [titleRow,
      { id: 'preview', h: U(150), min: 64, gap },
      { id: 'name', h: fs.body * 1.5, min: fs.body * 1.3, gap: gap * 0.5, opt: true },
      { id: 'buy', h: Math.max(48, U(54)), min: 48, gap: gap * 0.6 }];
    const rowsB = [
      { id: 'grid', h: gridH(colR.w), min: gridH(colR.w), gap: wide ? 0 : gap },
      { id: 'shelfT', h: fs.small * 1.6, min: fs.small * 1.4, gap, opt: true },
      { id: 'shelf', h: shelfH(colR.w), min: shelfH(colR.w), gap: gap * 0.4 }];
    const back = { id: 'back', h: secH, min: secH, gap: gap * 1.2 };
    if (wide) { rowsA.push(back); place(colL, rowsA, 'preview', 0.9, 260); place(colR, rowsB); }
    else { place(inner, [...rowsA, ...rowsB, back], 'preview', 0.85, 200); }
    coinPill();
    B.buy = centreW(B.buy, bwP(B.buy.w)); btn('buy', B.buy, true);
    B.back = centreW(B.back, bwS(B.back.w)); btn('back', B.back);
    const g = B.grid, cell = cellOf(g.w), g2 = cg(g.w), gx = g.x + (g.w - (5 * cell + 4 * g2)) / 2;
    B.skins = [];
    for (let i = 0; i < 10; i++) {
      const r = R(gx + (i % 5) * (cell + g2), g.y + Math.floor(i / 5) * (cell + g2), cell, cell);
      B.skins.push(r); btn('skin' + i, r);
    }
    const sh = B.shelf, tw = tileW(sh.w), id = iconD(sh.w);
    B.tins = [];
    for (let i = 0; i < 4; i++) {
      const x = sh.x + i * (tw + gap);
      const icon = R(x + (tw - id) / 2, sh.y, id, id), price = R(x, sh.y + id + Math.max(2, U(3)), tw, priceH);
      B.tins.push({ icon, price }); btn('tin' + i, icon);
    }
    out.containers = ['grid', 'shelf'];
    // 11-07 (curator r5, 844x390): ui.js splits the Buy row into Wear + Gild at up to 1.75x its width; in two columns that ran
    // into the booster shelf. The left column is the row's limit there.
    if (wide) out.colL = colL;
    return out;
  }

  if (name === 'cookbook') {
    // Chapter tabs (Picnic, Market, Harbour, Stamps), a chapter ribbon, a 4 x 5 recipe-card grid (5 x 4 wide).
    const tabH = Math.max(44, U(46)), ribH = Math.max(40, U(46));
    const tabs = ['picnic', 'market', 'harbour', 'stamps'];
    // DECISION: 4 x 5 cards in portrait, 5 x 4 in landscape and on short portrait cards (320x480) so no card is < 44 px.
    const tall = inner.h >= tabH + Math.max(34, fs.body * 2) + 5 * 44 + 4 * gap + secH + 4 * gap;
    const cols = wide || !tall ? 5 : 4, rowsN = wide || !tall ? 4 : 5;
    const gridMin = rowsN * 44 + (rowsN - 1) * gap;
    if (wide) {
      const lw = clamp(inner.w * 0.24, 120, U(190));
      const left = R(inner.x, inner.y, lw, inner.h), right = R(inner.x + lw + gap * 1.5, inner.y, inner.w - lw - gap * 1.5, inner.h);
      place(left, [{ ...titleRow, opt: true }, { id: 'tabs', h: 4 * tabH + 3 * gap, min: 4 * tabH + 3 * gap, gap }, { id: 'back', h: secH, min: secH, gap: gap * 1.5 }]);
      place(right, [{ id: 'ribbon', h: ribH, min: ribH }, { id: 'grid', h: U(400), min: gridMin, gap }], 'grid', 1, 600);
      B.tabs = tabs.map((t, i) => { const r = R(B.tabs.x, B.tabs.y + i * (tabH + gap), B.tabs.w, tabH); btn('tab-' + t, r); return { id: t, r }; });
    } else {
      place(inner, [{ ...titleRow, opt: true }, { id: 'tabs', h: tabH, min: tabH, gap }, { id: 'ribbon', h: ribH, min: Math.max(34, fs.body * 2), gap },
        { id: 'grid', h: U(330), min: gridMin, gap }, { id: 'back', h: secH, min: secH, gap: gap * 1.2 }], 'grid', 1, 300);
      const tw = (B.tabs.w - 3 * gap) / 4;
      B.tabs = tabs.map((t, i) => { const r = R(B.tabs.x + i * (tw + gap), B.tabs.y, tw, tabH); btn('tab-' + t, r); return { id: t, r }; });
    }
    B.back = centreW(B.back, bwS(B.back.w)); btn('back', B.back);
    const g = B.grid;
    const cw = Math.min((g.w - (cols - 1) * gap) / cols, U(120)), chh = Math.min((g.h - (rowsN - 1) * gap) / rowsN, U(130));
    const gx = g.x + (g.w - (cols * cw + (cols - 1) * gap)) / 2, gy = g.y + (g.h - (rowsN * chh + (rowsN - 1) * gap)) / 2;
    B.cards = [];
    for (let i = 0; i < 20; i++) {
      const r = R(gx + (i % cols) * (cw + gap), gy + Math.floor(i / cols) * (chh + gap), cw, chh);
      B.cards.push(r); btn('card' + i, r);
    }
    // stamps page: 14 stamps in 7 x 2 (portrait 4 x 4 minus 2) inside the same grid rect
    const sc = wide ? 7 : 4, sr = Math.ceil(14 / sc);
    const sd = Math.min((g.w - (sc - 1) * gap) / sc, (g.h - (sr - 1) * gap) / sr, U(96));
    const sx = g.x + (g.w - (sc * sd + (sc - 1) * gap)) / 2, sy = g.y + (g.h - (sr * sd + (sr - 1) * gap)) / 2;
    B.stamps = [];
    for (let i = 0; i < 14; i++) B.stamps.push(R(sx + (i % sc) * (sd + gap), sy + Math.floor(i / sc) * (sd + gap), sd, sd));
    out.containers = ['grid', 'tabs'];
    return out;
  }

  if (name === 'daily' || name === 'ladder') {
    // Daily: receipt (3 star lines), 7-stamp ladder with tomorrow's reward bobbing, the next locked town's silhouette,
    // Cook / countdown, Back. Ladder (daily end): stamped receipt, ladder with today's stamp landing, coins, Done.
    const end = name === 'ladder';
    const lineH = Math.max(30, U(36)), rHead = Math.max(34, U(44));
    const receiptH = rHead + 3 * lineH + Math.max(8, U(14));
    const sgap = Math.max(4, U(6));
    const stampD = w => Math.max(24, Math.min((w - 6 * sgap) / 7, U(54)));
    const lift = Math.max(16, U(22)), numH = fs.small * 1.5;
    const ladderH = w => stampD(w) + lift + numH;
    // DECISION (Friday fix 2, U6): seven in a row are 40 px on a phone, too small to tell a chest from a pot. A tall card with the
    //   room lays them out four over three at about 66 px. A short phone keeps the single row.
    const stampD2 = w => Math.min((w - 3 * sgap) / 4, U(66)), rowStep = w => stampD2(w) + numH + sgap;
    const ladderH2 = w => lift + rowStep(w) + stampD2(w) + numH;
    const head = end ? { id: 'head', h: fs.head * 1.25, min: fs.head * 1.15 } : titleRow;
    const sub = { id: 'sub', h: fs.small * 1.6, min: fs.small * 1.4, opt: true };
    const receipt = { id: 'receipt', h: receiptH, min: receiptH, gap };
    const ladderT = { id: 'ladderT', h: fs.small * 1.6, min: fs.small * 1.4, gap, opt: true };
    const hasTown = !end && opts.town !== false;          // past the last town there is nothing to tease, so no empty row for it
    const extra = end ? { id: 'coins', h: Math.max(fs.stat * 1.7, U(40)), min: fs.stat * 1.5, gap } : hasTown ? { id: 'town', h: U(90), min: 0, gap, opt: true } : null;
    const prim = opts.primary === false ? null : { id: 'primary', h: primH, min: primH, gap: gap * 1.4 };
    const back = end ? null : { id: 'back', h: secH, min: secH, gap: gap * 1.1 };
    const lw = wide ? colR.w : inner.w;
    const others = [head, sub, receipt, ladderT, end ? extra : null, prim, back].filter(Boolean).reduce((a, r) => a + r.h + (r.gap || 0), 0);
    const twoRows = !wide && others + ladderH2(lw) + (hasTown ? U(64) + gap : 0) <= inner.h;
    const ladH = twoRows ? ladderH2(lw) : ladderH(lw);
    const ladder = { id: 'ladder', h: ladH, min: ladH };
    if (wide) {
      place(colL, [head, sub, receipt, ...(prim ? [prim] : [])]);
      place(colR, [ladderT, ladder, ...(extra ? [extra] : []), ...(back ? [back] : [])], end ? null : 'town', 1, 240);
    } else {
      place(inner, [head, sub, receipt, ladderT, ladder, ...(extra ? [extra] : []), ...(prim ? [prim] : []), ...(back ? [back] : [])], end ? null : 'town', 1, 200);
      hug();
    }
    if (B.primary) { B.primary = centreW(B.primary, bwP(B.primary.w)); btn('primary', B.primary, true); }
    if (B.back) { B.back = centreW(B.back, bwS(B.back.w)); btn('back', B.back, !B.primary); }
    if (B.town && B.town.h < 30) delete B.town;
    const r = B.receipt, rw = Math.min(r.w, Math.max(260, U(340)));
    B.receipt = centreW(r, rw);
    B.lines = [0, 1, 2].map(i => R(B.receipt.x, B.receipt.y + rHead + i * lineH, rw, lineH));
    const ld = B.ladder, sd = twoRows ? stampD2(ld.w) : stampD(ld.w);
    const rowX = n => ld.x + (ld.w - (n * sd + (n - 1) * sgap)) / 2;
    B.steps = [];
    for (let i = 0; i < 7; i++) {
      if (!twoRows) B.steps.push(R(rowX(7) + i * (sd + sgap), ld.y + lift, sd, sd));
      else if (i < 4) B.steps.push(R(rowX(4) + i * (sd + sgap), ld.y + lift, sd, sd));
      else B.steps.push(R(rowX(3) + (i - 4) * (sd + sgap), ld.y + lift + rowStep(ld.w), sd, sd));
    }
    return out;
  }

  if (name === 'feast') {
    // Feast start: win-feast art, personal best, a town picker (unlocked towns), Start, Back.
    const nT = clamp(opts.towns | 0 || 1, 1, 3);
    const rowsA = [titleRow, { id: 'hero', h: U(150), min: 56, gap }];
    const rowsB = [
      { id: 'best', h: Math.max(fs.stat * 1.7, U(38)), min: fs.stat * 1.5, gap },
      ...(nT > 1 ? [{ id: 'towns', h: Math.max(44, U(48)), min: 44, gap }] : []),
      { id: 'primary', h: primH, min: primH, gap: gap * 1.4 },
      { id: 'back', h: secH, min: secH, gap: gap * 1.1 }];
    // DECISION: a wide card's hero grows only to the art's own height (about 0.75 x its width), so the title stays
    //   right above the art instead of floating at the top of a tall empty column.
    if (wide) { place(colL, rowsA, 'hero', 1, heroCap()); place(colR, rowsB); }
    else { place(inner, [...rowsA, ...rowsB], 'hero', 0.9, artCap(150)); hug(); }
    B.primary = centreW(B.primary, bwP(B.primary.w)); btn('primary', B.primary, true);
    B.back = centreW(B.back, bwS(B.back.w)); btn('back', B.back);
    if (B.towns) {
      const t = B.towns, tw = Math.min((t.w - (nT - 1) * gap) / nT, U(130)), tx = t.x + (t.w - (nT * tw + (nT - 1) * gap)) / 2;
      B.towns = []; for (let i = 0; i < nT; i++) { const r = R(tx + i * (tw + gap), t.y, tw, t.h); B.towns.push(r); btn('town' + i, r); }
    }
    out.containers = ['towns'];
    return out;
  }

  if (name === 'feastend') {
    // Feast end card: "Feast over!" (or NEW BEST! ribbon), the big served-tickets count over the feast art,
    // best + coins, Again, Done.
    const rowsA = [{ id: 'head', h: fs.head * 1.25, min: fs.head * 1.15 }, { id: 'hero', h: U(160), min: 70, gap }];
    const rowsB = [
      { id: 'stats', h: Math.max(fs.stat * 1.7, U(40)), min: fs.stat * 1.5, gap },
      { id: 'coins', h: Math.max(fs.stat * 1.7, U(40)), min: fs.stat * 1.5, gap: gap * 0.5 },
      { id: 'primary', h: retryH, min: retryH, gap: gap * 1.4 },
      { id: 'back', h: Math.max(secH, U(54)), min: secH, gap: gap * 1.1 }];
    if (wide) { place(colL, rowsA, 'hero', 1, heroCap(160)); place(colR, rowsB); }
    else { place(inner, [...rowsA, ...rowsB], 'hero', 0.8, artCap(160)); hug(); }
    B.primary = centreW(B.primary, bwP(B.primary.w)); btn('primary', B.primary, true);
    // Friday fix 2 (U6): Title is how you leave a Feast, so it is as wide as Again, not a small afterthought under it
    B.back = centreW(B.back, bwP(B.back.w)); btn('back', B.back);
    return out;
  }

  // Generic placeholder / info card (shop, cookbook, daily, feast, alldone, gift, ...): icon, title, body, primary?, back
  {
    // DECISION (Friday fix): a locked Daily/Feast card reads top-down as one column: title, (what it is), art, line, Back.
    const rows = opts.locked ? [
      { id: 'title', h: fs.title * 1.4, min: fs.title * 1.2 },
      ...(opts.locked === 'daily' ? [{ id: 'sub', h: fs.body * 2.6, min: fs.body * 1.5, gap: gap * 0.4 }] : []),
      { id: 'icon', h: U(opts.locked === 'daily' ? 84 : 150), min: 48, gap },
      { id: 'body', h: fs.body * 2.4, min: fs.body * 1.5, gap },
      { id: 'back', h: secH, min: secH, gap: gap * 1.4 },
    ] : [
      { id: 'icon', h: U(120), min: 48 },
      { id: 'title', h: fs.title * 1.4, min: fs.title * 1.2, gap },
      { id: 'body', h: fs.body * (opts.ending ? 2.6 : 3.4), min: fs.body * (opts.ending ? 1.5 : 2.8), gap: opts.ending ? gap * 0.5 : gap },
      ...(opts.ending ? [{ id: 'left', h: fs.body * 2.6, min: fs.body * 1.5, gap: gap * 0.4 }] : []),
      ...(opts.primary ? [{ id: 'primary', h: primH, min: primH, gap: gap * 1.5 }] : []),
      ...(opts.second && !wide ? [{ id: 'second', h: secH + 4, min: secH, gap: gap * 1.1 }] : []),
      ...(opts.noBack ? [] : [{ id: 'back', h: secH, min: secH, gap: gap * 1.2 }]),
    ];
    const ri = rows.findIndex(r => r.id === 'icon');
    // DECISION: a card whose primary already closes it (gift: Collect) has no Back button (opts.noBack).
    // DECISION: spare card height goes to the icon/art block first (as the win/fail hero), then the rest is centred.
    let s = stack(inner.x, inner.y, inner.w, inner.h, rows);
    const spare = inner.h - (s._end - inner.y);
    // U10: the 7-day ladder is a fixed-height strip: extra height only opened a gap above and below it
    if (spare > 8 && opts.locked !== 'daily') { rows[ri].h += Math.min(spare * 0.6, U(opts.locked ? 70 : 130)); s = stack(inner.x, inner.y, inner.w, inner.h, rows); }
    const used = s._end - inner.y, d = Math.max(0, (inner.h - used) / 2);
    for (const k in s) if (k !== '_end') { s[k].y += d; B[k] = s[k]; }
    hug();   // Friday fix 2 (U6): the chest card stood with its lower third blank
    const bw = Math.min(inner.w, Math.max(200, U(260)));
    // DECISION: a wide card with two actions (All-done: Daily + Feast) puts them side by side in the primary row.
    if (B.primary && opts.second && wide) {
      const r = B.primary, w2 = Math.min((r.w - gap) / 2, Math.max(180, U(240)));
      B.primary = R(r.x + r.w / 2 - gap / 2 - w2, r.y, w2, r.h); btn('primary', B.primary, true);
      B.second = R(r.x + r.w / 2 + gap / 2, r.y, w2, r.h); btn('second', B.second);
    } else if (B.primary) { B.primary = centreW(B.primary, bw); btn('primary', B.primary, true); }
    if (B.second && !wide) { B.second = centreW(B.second, Math.min(inner.w, Math.max(180, U(230)))); btn('second', B.second); }
    if (B.back) { B.back = centreW(B.back, Math.min(inner.w, Math.max(140, U(170)))); btn('back', B.back, !opts.primary); }
    return out;
  }
}

/**
 * Town map geometry (full screen, not a card).
 * DECISION: top bar = Back (left), the milestone pill "★ have / need" (centre), coins (right). Portrait/square: the
 *   Daily / Feast / Cookbook / Shop buttons sit in a bottom bar; landscape: two side columns (Daily + Feast left,
 *   Cookbook + Shop right) so the scroll viewport keeps the full height. The path lives in a centred content column
 *   (full width on phones, capped on desktop so the map art is never stretched past ~1.6x).
 * Node positions are in CONTENT space: x from the column's left edge, y from the top of the content (Harbour's top);
 *   L1 is at the bottom. Each town = ribbon (bottom, where you enter it) + 20 nodes + the town chest (top).
 */
function mapLayout(L, out, opts) {
  const S = L.menu || L.safe, B = out.blocks, u = L.u;
  const btn = (id, r, primary = false) => out.buttons.push({ id, r, primary });
  out.panel = S;
  const P2 = Math.max(8, u * 12), topH = Math.max(44, u * 46);
  const side = L.aspect === 'landscape';
  B.back = R(S.x + P2, S.y + P2, topH, topH); btn('back', B.back);
  const pillW = Math.max(98, u * 104);   // fits "9999" at the pill font
  B.coins = R(S.x + S.w - P2 - pillW, S.y + P2, pillW, topH);
  const midL = B.back.x + topH + P2, midR = B.coins.x - P2;
  const msW = Math.min(Math.max(150, u * 220), midR - midL);
  B.milestone = R(clamp(S.x + (S.w - msW) / 2, midL, midR - msW), S.y + P2, msW, topH);
  const iconB = Math.max(48, u * 54), lab = Math.max(12.5, u * 13), rowH = iconB + lab * 1.45 + 4;
  const ids = ['daily', 'feast', 'cookbook', 'shop'];
  // DECISION (Friday fix 2, U5): a desktop map is a wide framing, not a phone strip: about 960 px at 1440, capped at 1040 so the
  //   571 px art is not stretched past ~1.8x. Smaller nodes on a shorter step show about 7 levels of trail instead of 5.
  const colWide = room => Math.min(room, Math.max(340, Math.min(u * 600, 1040)));
  const top = S.y + P2 + topH + Math.max(4, u * 6);
  B.icons = [];
  let view, sideW = 0;
  if (!side) {
    const barH = rowH + P2;
    view = R(S.x, top, S.w, S.y + S.h - barH - top);
    const bar = R(S.x, view.y + view.h, S.w, barH);
    const cw = Math.min(Math.max(iconB + 12, lab * 6.2), (S.w - 2 * P2) / 4), x0 = S.x + (S.w - 4 * cw) / 2;
    ids.forEach((id, i) => {
      const cx = x0 + cw * (i + 0.5), r = R(cx - iconB / 2, bar.y + Math.max(2, u * 3), iconB, iconB);
      B.icons.push({ id, r, lab: R(cx - cw / 2, r.y + iconB + 2, cw, lab * 1.3) }); btn(id, r);
    });
  } else {
    view = R(S.x, top, S.w, S.y + S.h - top);
    const cw = Math.max(iconB + 12, lab * 6.2);
    sideW = cw + 2 * P2;
    const colH = 2 * rowH + P2, y0 = view.y + Math.max(0, (view.h - colH) / 2);
    ids.forEach((id, i) => {
      // DECISION (U11): the side buttons sit just outside the map column, not out at the far screen edges.
      const cw0 = colWide(view.w - 2 * sideW), colL = view.x + (view.w - cw0) / 2, colR = colL + cw0;
      const left = i < 2, cx = left ? Math.max(S.x + P2 + cw / 2, colL - P2 * 1.5 - cw / 2) : Math.min(S.x + S.w - P2 - cw / 2, colR + P2 * 1.5 + cw / 2);
      const r = R(cx - iconB / 2, y0 + (i % 2) * (rowH + P2), iconB, iconB);
      B.icons.push({ id, r, lab: R(cx - cw / 2, r.y + iconB + 2, cw, lab * 1.3) }); btn(id, r);
    });
  }
  B.view = view;
  const colW = side ? colWide(view.w - 2 * sideW) : L.aspect === 'square' ? Math.min(view.w, Math.max(340, u * 700)) : view.w;
  const col = R(view.x + (view.w - colW) / 2, view.y, colW, view.h);
  const nodeD = Math.max(46, u * (side ? 44 : 52)), starH = Math.max(14, u * (side ? 13 : 15));
  const step = Math.max(nodeD + starH + 12, u * (side ? 62 : 78));
  const hdrH = Math.max(58, u * 68), chestH = Math.max(64, u * 74);
  const townH = hdrH + 20 * step + chestH;
  const amp = Math.max(0, Math.min(colW / 2 - nodeD / 2 - P2 - 4, Math.max(60, u * (side ? 170 : 112))));
  const nodes = [];
  for (let n = 1; n <= 60; n++) {
    const ti = ((n - 1) / 20) | 0, k = (n - 1) % 20;
    const bottom = (3 - ti) * townH;
    nodes.push({ n, town: ti, x: colW / 2 + amp * Math.sin((n - 1) * 0.78 + 0.4), y: bottom - hdrH - step * (k + 0.5) - chestH * 0.08 });
  }
  const towns = [0, 1, 2].map(ti => ({ i: ti, y: (2 - ti) * townH, h: townH, ribbon: (3 - ti) * townH - hdrH, chest: (2 - ti) * townH }));
  out.containers = ['view'];
  out.map = { col, nodeD, starH, step, hdrH, chestH, townH, contentH: 3 * townH, amp, nodes, towns, sideW };
  out.fs = Object.assign(out.fs, { label: lab, pill: Math.max(14, u * 17), node: Math.max(14, u * 19), town: Math.max(18, u * 24),
    lock: Math.max(16, u * 20) });
  return out;
}
