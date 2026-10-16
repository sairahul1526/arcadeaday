// Knot Kitty: scene.js (Art role). The six world scenes, the seasonal title scene, map vignettes and the
// ?og=1 composition. GDD §7.5, §12.2, §13.5. Everything is code-drawn (Canvas 2D, never shadowBlur).
//
// DECISION: each world bakes ONE full-screen offscreen canvas (wall, window + sky, furniture, props, the warm
//   light pool and the vignette) keyed by world|W|H|dpr|variant. Per frame we blit it once, then draw the
//   live ambient: things behind the glass (leaves, snow, bats, shooting star) are clipped to the window
//   panes, then room ambient (steam, flames, flicker glow, fan, swinging bulb, motes, twinkles, cats).
//   Two layers (sky / room) were merged into one bake because the sky is static and one blit is cheaper.
// DECISION: drawScene(g, S) draws the title scene when S.screen === 'title' (season from S.world: 2 →
//   'pumpkin', otherwise 'den'); every other screen draws the world scene for S.world (1..6).
// DECISION: drawTitleScene is background only (scene + seasonal foreground props + a soft spotlight
//   behind where the logo goes); the logo, mini board and Kitty belong to the UI / end card on top.
// DECISION: the device-pixel ratio for bakes is read from g's current transform, so every entry point
//   (game, record end card, map vignettes) bakes crisp without extra arguments.
// DECISION: drawOG draws the whole §12.2 composition itself in a 1200×630 design space scaled to S.W×S.H
//   (scene fills any extra). It uses the live L20 session's cleared strands when present, else L20 at 40 %.
// DECISION: ambient cats are drawn with render.js's cat painters at ~0.6 of Kitty's size, desaturated 25 %.

import {
  INK, CREAM, WALNUT, WALNUT_L, WALNUT_D, TOMATO, TOMATO_D, GOLD, GOLD_D, FONT_T, FONT_B, YARN,
  mix, rr, mkCanvas, hash, text, coatOf, drawCat, drawSleepCat, drawKitty, drawSpool, drawHeart,
  drawMiniBoard, drawYarnRun,
} from './render.js';
import { getLevel } from './levels.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = p => p * p * (3 - 2 * p);
const SOL = '#2F2540'; // scene outline: a touch softer than INK so the board's ink casing wins
const SH = 'rgba(30,14,24,0.28)';

// ------------------------------------------------------------------ small helpers
function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => (Array.isArray(s) ? gr.addColorStop(s[0], s[1]) : gr.addColorStop(i / Math.max(1, stops.length - 1), s)));
  return gr;
}
function rad(g, x, y, r0, r1, stops) {
  const gr = g.createRadialGradient(x, y, r0, x, y, Math.max(r0 + 0.01, r1));
  stops.forEach((s, i) => (Array.isArray(s) ? gr.addColorStop(s[0], s[1]) : gr.addColorStop(i / Math.max(1, stops.length - 1), s)));
  return gr;
}
/** Draw in local prop units: origin (x, y) = bottom centre, 1 unit = s px. */
function P(g, x, y, s, fn) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = SOL; g.lineWidth = 2.6;
  fn(g);
  g.restore();
}
const fs = (g, fill) => { g.fillStyle = fill; g.fill(); g.stroke(); };
function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.01, r), 0, TAU); }
function dprOf(g) {
  try { const m = g.getTransform(); return clamp(Math.hypot(m.a, m.b) || 1, 1, 2.5); } catch (e) { return 1; }
}
/** Tile pattern drawn at device resolution; fn(cg, w, h) draws one tile in CSS px. */
function tile(g, w, h, dpr, fn) {
  const tw = Math.max(2, Math.round(w * dpr)), th = Math.max(2, Math.round(h * dpr));
  const c = mkCanvas(tw, th), cg = c.getContext('2d');
  cg.setTransform(tw / w, 0, 0, th / h, 0, 0);
  fn(cg, w, h);
  const p = g.createPattern(c, 'repeat');
  if (p && p.setTransform) p.setTransform(new DOMMatrix([w / tw / dpr * dpr, 0, 0, h / th / dpr * dpr, 0, 0]).scale(1 / dpr * dpr));
  return p;
}
function mapleLeaf(g, x, y, s, rot, col, vein) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.beginPath();
  const pts = [[0, -10], [2.2, -5], [6, -7], [5, -3], [10, -3.5], [7, 0.5], [8.5, 3], [3, 2.5], [1, 5], [0, 4.5], [-1, 5], [-3, 2.5], [-8.5, 3], [-7, 0.5], [-10, -3.5], [-5, -3], [-6, -7], [-2.2, -5]];
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillStyle = col; g.fill();
  if (vein) { g.strokeStyle = vein; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -7); g.moveTo(0, 1); g.lineTo(6, -4); g.moveTo(0, 1); g.lineTo(-6, -4); g.stroke(); }
  g.restore();
}
function yarnBall(g, x, y, r, col) {
  g.save();
  g.fillStyle = SH; ell(g, x + r * 0.15, y + r * 0.9, r * 0.9, r * 0.24); g.fill();
  g.fillStyle = col; g.strokeStyle = SOL; g.lineWidth = Math.max(1, r * 0.12);
  circ(g, x, y, r); g.fill();
  g.save(); circ(g, x, y, r); g.clip();
  g.strokeStyle = mix(col, '#2F2540', 0.32); g.lineWidth = Math.max(0.8, r * 0.1);
  for (let k = -2; k <= 2; k++) { ell(g, x + k * r * 0.36, y, r * 0.24, r * 1.2, 0.55); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.22)'; ell(g, x - r * 0.35, y - r * 0.4, r * 0.4, r * 0.28, -0.5); g.fill();
  g.restore();
  g.lineWidth = Math.max(1, r * 0.12); g.strokeStyle = SOL; circ(g, x, y, r); g.stroke();
  g.restore();
}
// muted yarn colours for scene props (never compete with the board)
const MUTE = YARN.slice(0, 6).map(y => mix(y.base, '#9C8C84', 0.28));

// ------------------------------------------------------------------ geometry shared by all worlds
function geom(W, H) {
  const ar = W / H, por = ar < 0.87, land = ar > 1.15;
  const k = clamp(Math.min(W / (por ? 420 : 700), H / 560), 0.36, 4.2);
  const fy = Math.round(H * (por ? 0.85 : 0.8));
  return { W, H, ar, por, land, k, fy };
}
/** Window rect for walled rooms. */
function winRect(G, wide = 1) {
  const { W, H, por } = G;
  let ww, wh;
  if (por) { ww = W * 0.56 * wide; wh = ww * (wide > 1 ? 0.75 : 1.1); }
  else { wh = H * 0.46; ww = Math.min(W * 0.36 * wide, wh * 0.92 * wide); }
  const wx = (W - ww) / 2, wy = por ? H * 0.065 : H * 0.09;
  return { x: wx, y: wy, w: ww, h: wh };
}

// ------------------------------------------------------------------ shared props
function floorPlanks(g, G, base, dark, light) {
  const { W, H, fy, k } = G;
  g.fillStyle = lin(g, 0, fy, 0, H, [light, base, dark]);
  g.fillRect(0, fy, W, H - fy);
  // perspective planks: lines converge to a vanishing point above the centre
  const vx = W / 2, vy = fy - H * 0.9;
  g.strokeStyle = 'rgba(40,20,20,0.22)'; g.lineWidth = Math.max(1, 1.4 * k);
  const n = Math.ceil(W / (46 * k)) + 6;
  for (let i = -n; i <= n; i++) {
    const xb = vx + i * 70 * k;
    const tt = (fy - vy) / (H - vy);
    g.beginPath(); g.moveTo(vx + (xb - vx) * tt, fy); g.lineTo(xb, H); g.stroke();
  }
  // board seams
  for (let r = 0; r < 4; r++) {
    const y = fy + (H - fy) * (0.18 + r * 0.24) ** 1.1;
    for (let i = -n; i <= n; i++) {
      if (hash(i, r * 7) < 0.55) continue;
      const tt = (y - vy) / (H - vy);
      const x0 = vx + (i * 70 * k) * tt;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 70 * k * tt, y); g.stroke();
    }
  }
  // skirting board
  g.fillStyle = mix(dark, '#000000', 0.15); g.fillRect(0, fy - 7 * k, W, 7 * k);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, fy - 7 * k, W, 1.5 * k);
  g.fillStyle = 'rgba(20,10,20,0.25)'; g.fillRect(0, fy, W, 4 * k);
}
function windowFrame(G, g, R, o = {}) {
  const { k } = G;
  const f = (o.frame || 12) * k;
  const wood = o.wood || WALNUT, woodL = o.woodL || WALNUT_L, woodD = o.woodD || WALNUT_D;
  // outer frame (draw as a thick ring so the glass stays clear)
  g.save();
  g.strokeStyle = SOL; g.lineWidth = 2.4 * k;
  g.beginPath(); g.rect(R.x - f, R.y - f, R.w + 2 * f, R.h + 2 * f); g.rect(R.x, R.y, R.w, R.h);
  g.fillStyle = lin(g, R.x - f, 0, R.x + R.w + f, 0, [woodL, wood, woodD]);
  g.fill('evenodd'); g.stroke();
  // inner bevel
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5 * k; g.strokeRect(R.x - f + 2 * k, R.y - f + 2 * k, R.w + 2 * f - 4 * k, R.h + 2 * f - 4 * k);
  // muntins
  const m = (o.mun || 6) * k;
  const cols = o.cols || 2, rows = o.rows || 2;
  g.fillStyle = wood; g.strokeStyle = SOL; g.lineWidth = 1.8 * k;
  for (let i = 1; i < cols; i++) { const x = R.x + (R.w * i) / cols - m / 2; g.fillRect(x, R.y, m, R.h); g.strokeRect(x, R.y, m, R.h); }
  for (let j = 1; j < rows; j++) { const y = R.y + (R.h * j) / rows - m / 2; g.fillRect(R.x, y, R.w, m); g.strokeRect(R.x, y, R.w, m); }
  // glass sheen
  g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.beginPath(); g.moveTo(R.x + R.w * 0.1, R.y); g.lineTo(R.x + R.w * 0.32, R.y); g.lineTo(R.x + R.w * 0.02, R.y + R.h * 0.7); g.lineTo(R.x - R.w * 0.2, R.y + R.h * 0.7); g.fill();
  g.restore();
  // sill
  const sh = 9 * k;
  g.fillStyle = SH; g.fillRect(R.x - f * 1.6, R.y + R.h + f + sh, R.w + f * 3.2, 5 * k);
  g.fillStyle = lin(g, 0, R.y + R.h + f, 0, R.y + R.h + f + sh, [woodL, woodD]);
  rr(g, R.x - f * 1.6, R.y + R.h + f - 2 * k, R.w + f * 3.2, sh, 2 * k); g.fill(); g.stroke();
  g.restore();
  const panes = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x0 = R.x + (R.w * i) / cols + (i ? m / 2 : 0), x1 = R.x + (R.w * (i + 1)) / cols - (i < cols - 1 ? m / 2 : 0);
    const y0 = R.y + (R.h * j) / rows + (j ? m / 2 : 0), y1 = R.y + (R.h * (j + 1)) / rows - (j < rows - 1 ? m / 2 : 0);
    panes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { panes, sillY: R.y + R.h + f - 2 * k };
}
function curtains(G, g, R, col, colD, tie) {
  const { k } = G;
  const f = 12 * k, top = R.y - f - 14 * k, bot = R.y + R.h + f + 26 * k;
  // rod
  g.save();
  g.strokeStyle = SOL; g.lineWidth = 2 * k;
  g.fillStyle = GOLD_D; rr(g, R.x - f - 40 * k, top - 4 * k, R.w + 2 * f + 80 * k, 7 * k, 3 * k); g.fill(); g.stroke();
  for (const sd of [-1, 1]) { circ(g, R.x + R.w / 2 + sd * (R.w / 2 + f + 42 * k), top - 0.5 * k, 6 * k); g.fillStyle = GOLD; g.fill(); g.stroke(); }
  for (const sd of [-1, 1]) {
    const x0 = sd < 0 ? R.x - f - 34 * k : R.x + R.w + f + 34 * k;
    const x1 = sd < 0 ? R.x - f + 10 * k : R.x + R.w + f - 10 * k; // inner edge (pulled back)
    const ty = R.y + R.h * 0.62;
    g.beginPath();
    g.moveTo(x0, top);
    g.lineTo(x1 + sd * -6 * k, top);
    g.quadraticCurveTo(x1 - sd * 4 * k, R.y + R.h * 0.3, x1 + sd * 16 * k, ty);
    g.quadraticCurveTo(x1 + sd * 4 * k, ty + 30 * k, x1 - sd * 4 * k, bot);
    g.lineTo(x0 - sd * 6 * k, bot);
    g.quadraticCurveTo(x0 + sd * 4 * k, (top + bot) / 2, x0, top);
    g.closePath();
    g.fillStyle = lin(g, Math.min(x0, x1), 0, Math.max(x0, x1), 0, sd < 0 ? [colD, col, colD] : [colD, col, colD]);
    g.fill(); g.stroke();
    // folds
    g.strokeStyle = 'rgba(30,14,24,0.25)'; g.lineWidth = 2 * k;
    for (let i = 1; i < 4; i++) {
      const fx = x0 + (x1 - x0) * (i / 4);
      g.beginPath(); g.moveTo(fx, top + 4 * k); g.quadraticCurveTo(fx + sd * 8 * k, ty, fx - sd * 2 * k, bot - 4 * k); g.stroke();
    }
    g.strokeStyle = SOL; g.lineWidth = 2 * k;
    // tie-back
    g.fillStyle = tie; rr(g, Math.min(x0, x1 + sd * 16 * k) - 2 * k, ty - 4 * k, Math.abs(x1 + sd * 16 * k - x0) + 4 * k, 8 * k, 4 * k); g.fill(); g.stroke();
  }
  g.restore();
}
function pumpkin(g, x, y, s, col = '#E28431', stem = '#6B7A3A') {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 26, 5); g.fill();
    const d = mix(col, '#5A2A10', 0.35);
    for (const [cx, rx, cc] of [[-12, 13, d], [12, 13, d], [-6, 13, col], [6, 13, col], [0, 12, mix(col, '#FFD9A0', 0.15)]]) {
      ell(g, cx, -15, rx, 15); fs(g, cc);
    }
    g.fillStyle = 'rgba(255,255,255,0.18)'; ell(g, -4, -22, 3, 6, 0.2); g.fill();
    g.fillStyle = stem; g.beginPath(); g.moveTo(-2, -28); g.quadraticCurveTo(-1, -38, 4, -40); g.lineTo(5, -37); g.quadraticCurveTo(2, -34, 2.5, -28); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = stem; g.lineWidth = 1.6; g.beginPath(); g.moveTo(2, -31); g.bezierCurveTo(10, -36, 12, -28, 8, -27); g.stroke();
  });
}
function jackO(g, x, y, s, glow = 1) {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 30, 6); g.fill();
    const col = '#E8782A', d = '#B04E1A';
    for (const [cx, rx, cc] of [[-14, 15, d], [14, 15, d], [-7, 15, col], [7, 15, col], [0, 14, '#F08A36']]) { ell(g, cx, -18, rx, 18); fs(g, cc); }
    // carved face: glowing interior
    const gl = rad(g, 0, -18, 2, 22, ['#FFF6B0', '#FFC23A', '#E0661C']);
    g.fillStyle = glow ? gl : '#3A1A10'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-13, -24); g.lineTo(-5, -24); g.lineTo(-9, -31); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(13, -24); g.lineTo(5, -24); g.lineTo(9, -31); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-2, -20); g.lineTo(2, -20); g.lineTo(0, -23); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-15, -15); g.lineTo(-10, -12); g.lineTo(-7, -15); g.lineTo(-3, -9); g.lineTo(0, -13); g.lineTo(3, -9); g.lineTo(7, -15); g.lineTo(10, -12); g.lineTo(15, -15);
    g.quadraticCurveTo(0, 0, -15, -15); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 2.6;
    g.fillStyle = '#5E6A2E'; g.beginPath(); g.moveTo(-2, -34); g.quadraticCurveTo(0, -44, 5, -45); g.lineTo(6, -41); g.quadraticCurveTo(3, -39, 3, -34); g.closePath(); g.fill(); g.stroke();
  });
}
function candle(g, x, y, s, h = 30, col = '#F3E6CF') {
  P(g, x, y, s, g => {
    g.fillStyle = '#9C7A3A'; ell(g, 0, -2, 10, 3.5); fs(g, '#B88A3C');
    rr(g, -5, -h, 10, h - 2, 2); g.fillStyle = lin(g, -5, 0, 5, 0, [mix(col, '#FFFFFF', 0.4), col, mix(col, '#7A5A40', 0.25)]); g.fill(); g.stroke();
    g.fillStyle = col; g.beginPath(); g.moveTo(-5, -h + 2); g.quadraticCurveTo(-6, -h + 9, -3.5, -h + 10); g.quadraticCurveTo(-2, -h + 6, -1, -h + 2); g.fill();
    g.strokeStyle = '#3A2A20'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -h); g.lineTo(0.5, -h - 4); g.stroke();
  });
}
function flame(g, x, y, s, t, seed = 0) {
  const fl = 0.85 + 0.15 * Math.sin(t * 13 + seed * 3) + 0.08 * Math.sin(t * 29 + seed);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = rad(g, x, y - 4 * s, 0, 26 * s * fl, ['rgba(255,190,90,0.35)', 'rgba(255,140,40,0.12)', 'rgba(255,120,30,0)']);
  circ(g, x, y - 4 * s, 26 * s * fl); g.fill();
  g.restore();
  g.save(); g.translate(x, y); g.scale(s, s * fl);
  const sw = Math.sin(t * 7 + seed) * 1.2;
  g.fillStyle = '#FFB13B'; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-4.5, -3, -3, -9, sw, -14); g.bezierCurveTo(3, -9, 4.5, -3, 0, 0); g.fill();
  g.fillStyle = '#FFF4C2'; g.beginPath(); g.moveTo(0, -1); g.bezierCurveTo(-2, -3, -1.5, -6, sw * 0.6, -9); g.bezierCurveTo(1.5, -6, 2, -3, 0, -1); g.fill();
  g.restore();
}
function plant(g, x, y, s, potCol = '#C8683E', leaf = '#5E8A4E') {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 22, 4); g.fill();
    const lf = (ang, len, w, col) => {
      g.save(); g.translate(0, -34); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w, -len * 0.5, 0, -len); g.quadraticCurveTo(-w, -len * 0.5, 0, 0);
      fs(g, col);
      g.strokeStyle = 'rgba(30,40,20,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -len + 4); g.stroke();
      g.restore();
    };
    const ld = mix(leaf, '#1E2E1A', 0.25), ll = mix(leaf, '#DDE8A0', 0.18);
    lf(-1.1, 38, 9, ld); lf(1.05, 40, 9, ld); lf(-0.6, 50, 10, leaf); lf(0.55, 48, 10, leaf); lf(-0.15, 56, 11, ll); lf(0.2, 44, 9, leaf);
    g.beginPath(); g.moveTo(-17, -36); g.lineTo(17, -36); g.lineTo(13, 0); g.lineTo(-13, 0); g.closePath();
    g.fillStyle = lin(g, -17, 0, 17, 0, [mix(potCol, '#FFFFFF', 0.15), potCol, mix(potCol, '#330000', 0.3)]); g.fill(); g.stroke();
    rr(g, -19, -40, 38, 8, 2); fs(g, mix(potCol, '#FFFFFF', 0.1));
  });
}
function bookshelf(g, x, y, s, seed = 1) {
  const cols = ['#A9503F', '#3F7A73', '#C4923A', '#4A6AA0', '#755896', '#7A9448', '#D8C3A0', '#8A4B3A', '#5E4A6E'];
  P(g, x, y, s, g => {
    g.fillStyle = SH; g.fillRect(-58, -236, 130, 236);
    rr(g, -64, -240, 128, 240, 4); g.fillStyle = lin(g, -64, 0, 64, 0, [WALNUT_L, WALNUT, WALNUT_D]); g.fill(); g.stroke();
    g.fillStyle = '#4C2E1C'; g.fillRect(-55, -230, 110, 222); g.strokeRect(-55, -230, 110, 222);
    for (let r = 0; r < 4; r++) {
      const sy = -230 + (r + 1) * 55.5;
      // books
      let bx = -53;
      let i = 0;
      while (bx < 50) {
        const h = hash(seed * 31 + r, i) , bw = 7 + Math.round(h * 7);
        if (bx + bw > 53) break;
        const bh = 30 + hash(i, r + seed * 5) * 16;
        const lean = r === 1 && i === 5 ? 0.25 : 0;
        if (r === 2 && i > 3 && i < 6) { bx += bw; i++; continue; }
        g.save(); g.translate(bx, sy - 3); g.rotate(lean);
        rr(g, 0, -bh, bw, bh, 1.2); fs(g, cols[Math.floor(hash(i * 3, r + seed) * cols.length)]);
        g.fillStyle = 'rgba(255,240,210,0.45)'; g.fillRect(1.5, -bh + 5, bw - 3, 2); g.fillRect(1.5, -10, bw - 3, 2);
        g.restore();
        bx += bw + (lean ? 6 : 0.5); i++;
      }
      // shelf plank
      g.fillStyle = lin(g, 0, sy - 3, 0, sy + 4, [WALNUT_L, WALNUT_D]); g.fillRect(-58, sy - 3, 116, 7); g.strokeRect(-58, sy - 3, 116, 7);
    }
    yarnBall(g, 8, -128, 9, MUTE[0]); yarnBall(g, 26, -125, 7, MUTE[4]);
  });
}
function armchair(g, x, y, s, col = '#B5543E', colD = '#8A3A2C') {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 4, 0, 92, 9); g.fill();
    // legs
    g.fillStyle = WALNUT_D;
    for (const lx of [-66, 62]) { rr(g, lx, -14, 8, 14, 2); g.fill(); g.stroke(); }
    // back
    g.beginPath(); g.moveTo(-62, -60); g.bezierCurveTo(-70, -150, 70, -150, 62, -60); g.closePath();
    g.fillStyle = lin(g, 0, -150, 0, -60, [mix(col, '#FFFFFF', 0.08), col]); g.fill(); g.stroke();
    // tufting
    g.fillStyle = 'rgba(30,10,10,0.25)';
    for (const [bx, by] of [[-30, -110], [0, -118], [30, -110], [-15, -88], [15, -88]]) { circ(g, bx, by, 2.2); g.fill(); }
    // seat
    rr(g, -60, -62, 120, 30, 10); fs(g, mix(col, '#FFFFFF', 0.1));
    rr(g, -66, -36, 132, 26, 8); fs(g, colD);
    // arms
    for (const sd of [-1, 1]) {
      g.beginPath(); g.moveTo(sd * 60, -16); g.lineTo(sd * 60, -70); g.quadraticCurveTo(sd * 60, -88, sd * 76, -86); g.quadraticCurveTo(sd * 92, -84, sd * 88, -66); g.lineTo(sd * 82, -16); g.closePath();
      g.fillStyle = lin(g, sd * 60, 0, sd * 90, 0, [col, colD]); g.fill(); g.stroke();
    }
    // knitted throw over the arm
    g.beginPath(); g.moveTo(30, -64); g.lineTo(84, -86); g.quadraticCurveTo(96, -60, 88, -30); g.lineTo(60, -24); g.quadraticCurveTo(52, -48, 30, -64); g.closePath();
    fs(g, '#E9D6A8');
    g.strokeStyle = 'rgba(150,110,60,0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(38 + i * 10, -62 - i * 4); g.lineTo(62 + i * 6, -28 - i * 1); g.stroke(); }
    g.strokeStyle = '#C9A866'; g.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(62 + i * 5, -26); g.lineTo(62 + i * 5, -18); g.stroke(); }
  });
}
function knitBasket(g, x, y, s) {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 36, 6); g.fill();
    yarnBall(g, -14, -34, 13, MUTE[1]); yarnBall(g, 10, -36, 14, MUTE[2]); yarnBall(g, -2, -42, 11, MUTE[0]);
    // needles
    g.strokeStyle = SOL; g.lineWidth = 4.4; g.beginPath(); g.moveTo(4, -40); g.lineTo(22, -72); g.moveTo(-6, -38); g.lineTo(8, -74); g.stroke();
    g.strokeStyle = '#D9C9A8'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(4, -40); g.lineTo(22, -72); g.moveTo(-6, -38); g.lineTo(8, -74); g.stroke();
    g.fillStyle = TOMATO; circ(g, 22.5, -73, 3); g.fill(); circ(g, 8.3, -75, 3); g.fill();
    g.strokeStyle = SOL; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(-34, -32); g.lineTo(34, -32); g.lineTo(27, 0); g.lineTo(-27, 0); g.closePath();
    g.fillStyle = lin(g, -34, 0, 34, 0, ['#B98049', '#C98B4E', '#A86A34']); g.fill(); g.stroke();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(110,60,25,0.55)'; g.lineWidth = 1.6;
    for (let r = 0; r < 4; r++) for (let i = -5; i < 6; i++) { const yy = -28 + r * 8; ell(g, i * 7 + (r % 2) * 3.5, yy, 3.5, 3); g.stroke(); }
    g.restore();
    rr(g, -36, -36, 72, 7, 3); fs(g, '#A86A34');
  });
}
function mug(g, x, y, s, col = '#E9D6B8') {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 2, 0, 12, 2.5); g.fill();
    g.beginPath(); g.arc(9, -9, 5.5, -1.3, 1.3); g.lineWidth = 3.4; g.stroke(); g.lineWidth = 2.2;
    rr(g, -9, -19, 18, 19, 3); fs(g, col);
    g.fillStyle = '#6B3A22'; ell(g, 0, -18, 8, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-6, -15, 3, 11);
  });
}
function steam(g, x, y, s, t, seed = 0) {
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const p = ((t * 0.45 + i / 3 + seed * 0.13) % 1);
    g.strokeStyle = `rgba(255,248,236,${0.45 * Math.sin(p * Math.PI)})`;
    g.lineWidth = (3.2 - p * 1.6) * s;
    const bx = x + (i - 1) * 4 * s, by = y - p * 26 * s;
    g.beginPath(); g.moveTo(bx, by);
    g.bezierCurveTo(bx + 5 * s * Math.sin(t * 2 + i), by - 5 * s, bx - 5 * s, by - 9 * s, bx + 2 * s * Math.sin(t * 3 + i), by - 14 * s);
    g.stroke();
  }
  g.restore();
}
function sideTable(g, x, y, s) {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 24, 4); g.fill();
    g.fillStyle = WALNUT_D; for (const lx of [-16, 14]) { rr(g, lx, -44, 4, 44, 1); g.fill(); g.stroke(); }
    rr(g, -24, -48, 48, 7, 2.5); fs(g, WALNUT_L);
    rr(g, -18, -22, 36, 4, 1.5); fs(g, WALNUT);
  });
}
function frame(g, x, y, w, h, s, inner) {
  g.save();
  g.fillStyle = SH; g.fillRect(x + 3 * s, y + 4 * s, w, h);
  g.strokeStyle = SOL; g.lineWidth = 2 * s;
  g.fillStyle = lin(g, x, y, x + w, y + h, [GOLD, GOLD_D]); g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
  const m = Math.min(w, h) * 0.12;
  g.save(); g.beginPath(); g.rect(x + m, y + m, w - 2 * m, h - 2 * m); g.clip();
  inner(g, x + m, y + m, w - 2 * m, h - 2 * m);
  g.restore();
  g.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
  g.restore();
}
function catPortrait(g, x, y, w, h, bg, fur) {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.6, r = Math.min(w, h) * 0.3;
  g.fillStyle = fur;
  g.beginPath(); g.moveTo(cx - r * 0.9, cy - r * 0.4); g.lineTo(cx - r * 0.7, cy - r * 1.35); g.lineTo(cx - r * 0.15, cy - r * 0.85); g.fill();
  g.beginPath(); g.moveTo(cx + r * 0.9, cy - r * 0.4); g.lineTo(cx + r * 0.7, cy - r * 1.35); g.lineTo(cx + r * 0.15, cy - r * 0.85); g.fill();
  ell(g, cx, cy, r, r * 0.85); g.fill();
  ell(g, cx, cy + r * 1.6, r * 1.3, r * 0.9); g.fill();
  g.fillStyle = '#2F2540'; circ(g, cx - r * 0.38, cy - r * 0.05, r * 0.11); g.fill(); circ(g, cx + r * 0.38, cy - r * 0.05, r * 0.11); g.fill();
  g.fillStyle = '#E9748A'; circ(g, cx, cy + r * 0.2, r * 0.08); g.fill();
}
function garland(g, x0, x1, y, sag, k, fn, n) {
  g.save(); g.strokeStyle = 'rgba(60,40,30,0.7)'; g.lineWidth = 1.4 * k;
  g.beginPath(); g.moveTo(x0, y); g.quadraticCurveTo((x0 + x1) / 2, y + sag * 2, x1, y); g.stroke();
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n, xx = x0 + (x1 - x0) * p, yy = y + sag * 4 * p * (1 - p);
    fn(g, xx, yy, i);
  }
  g.restore();
}
function bulbsAlong(x0, x1, y, sag, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const p = (i + 0.5) / n; out.push({ x: x0 + (x1 - x0) * p, y: y + sag * 4 * p * (1 - p) + 4, i }); }
  return out;
}
function drawBulbs(g, bulbs, k, cols, lit = 1) {
  for (const b of bulbs) {
    const c = cols[b.i % cols.length];
    g.fillStyle = 'rgba(40,30,30,0.8)'; g.fillRect(b.x - 1.6 * k, b.y - 5 * k, 3.2 * k, 3 * k);
    g.fillStyle = mix(c, '#FFFFFF', 0.25 * lit); ell(g, b.x, b.y + 1 * k, 3.3 * k, 4.6 * k); g.fill();
    g.strokeStyle = 'rgba(40,30,30,0.55)'; g.lineWidth = 0.8 * k; g.stroke();
  }
}
function glowAt(g, x, y, r, col, a) {
  if (a <= 0 || r <= 0) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a;
  g.fillStyle = rad(g, x, y, 0, r, [col, col.replace(/[\d.]+\)$/, '0)')]);
  circ(g, x, y, r); g.fill();
  g.restore();
}
function lightPool(g, x, y, r, col) {
  g.save(); g.globalCompositeOperation = 'screen';
  g.fillStyle = rad(g, x, y, 0, r, [col, col.replace(/[\d.]+\)$/, '0)')]);
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}
function vignette(g, W, H, a = 0.5, col = '25,12,30') {
  const r = Math.hypot(W, H) * 0.62;
  g.fillStyle = rad(g, W / 2, H * 0.46, Math.min(W, H) * 0.32, r, [`rgba(${col},0)`, `rgba(${col},${a * 0.55})`, `rgba(${col},${a})`]);
  g.fillRect(0, 0, W, H);
}
function stars(g, R, n, seed, k) {
  for (let i = 0; i < n; i++) {
    const x = R.x + hash(i, seed) * R.w, y = R.y + hash(seed, i * 3 + 1) ** 1.3 * R.h, r = (0.5 + hash(i * 7, seed) * 1.1) * Math.max(0.7, k);
    g.fillStyle = `rgba(255,248,220,${0.45 + hash(i, seed * 2) * 0.5})`;
    circ(g, x, y, r); g.fill();
  }
}
function moon(g, x, y, r, col = '#FFF1C2') {
  g.fillStyle = rad(g, x, y, r * 0.8, r * 3.4, ['rgba(255,241,194,0.4)', 'rgba(255,241,194,0.1)', 'rgba(255,241,194,0)']);
  circ(g, x, y, r * 3.4); g.fill();
  g.fillStyle = rad(g, x - r * 0.3, y - r * 0.3, r * 0.1, r, [mix(col, '#FFFFFF', 0.4), col]);
  circ(g, x, y, r); g.fill();
  g.fillStyle = 'rgba(200,170,110,0.25)';
  for (const [cx, cy, cr] of [[-0.3, 0.2, 0.18], [0.25, -0.25, 0.13], [0.35, 0.35, 0.1], [-0.1, -0.45, 0.08]]) { circ(g, x + cx * r, y + cy * r, cr * r); g.fill(); }
}
function bat(g, x, y, s, t, col = '#1E1628') {
  const f = Math.sin(t * 18);
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = col;
  g.beginPath(); g.moveTo(0, 0);
  for (const sd of [-1, 1]) {
    g.moveTo(0, -1);
    g.quadraticCurveTo(sd * 6, -6 - f * 6, sd * 14, -4 - f * 8);
    g.quadraticCurveTo(sd * 11, -1 - f * 3, sd * 12, 2 - f * 2);
    g.quadraticCurveTo(sd * 8, 0, sd * 7, 3);
    g.quadraticCurveTo(sd * 4, 1, 0, 3);
  }
  g.fill();
  ell(g, 0, 0, 2.6, 3.4); g.fill();
  g.beginPath(); g.moveTo(-2, -2); g.lineTo(-2.4, -5); g.lineTo(-0.6, -3); g.moveTo(2, -2); g.lineTo(2.4, -5); g.lineTo(0.6, -3); g.fill();
  g.restore();
}
function pineTree(g, x, y, s, col, snow) {
  P(g, x, y, s, g => {
    g.lineWidth = 0;
    g.fillStyle = '#3A2A22'; g.fillRect(-3, -10, 6, 10);
    for (let i = 0; i < 4; i++) {
      const w = 26 - i * 5, yb = -8 - i * 16;
      g.fillStyle = col; g.beginPath(); g.moveTo(-w, yb); g.lineTo(0, yb - 28); g.lineTo(w, yb); g.closePath(); g.fill();
      if (snow) { g.fillStyle = snow; g.beginPath(); g.moveTo(-w * 0.55, yb - 13); g.lineTo(0, yb - 28); g.lineTo(w * 0.55, yb - 13); g.quadraticCurveTo(w * 0.2, yb - 9, 0, yb - 12); g.quadraticCurveTo(-w * 0.2, yb - 9, -w * 0.55, yb - 13); g.fill(); }
    }
  });
}
function cobweb(g, x, y, s, flip) {
  g.save(); g.translate(x, y); g.scale(flip ? -s : s, s);
  g.strokeStyle = 'rgba(235,225,245,0.45)'; g.lineWidth = 1.1;
  const R = 60, spokes = 6;
  for (let i = 0; i <= spokes; i++) { const a = (i / spokes) * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke(); }
  for (let r = 1; r <= 4; r++) {
    const rr0 = r * 14;
    g.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * Math.PI / 2, a1 = ((i + 1) / spokes) * Math.PI / 2, am = (a0 + a1) / 2;
      const p0 = [Math.cos(a0) * rr0, Math.sin(a0) * rr0], p1 = [Math.cos(a1) * rr0, Math.sin(a1) * rr0];
      if (i === 0) g.moveTo(p0[0], p0[1]);
      g.quadraticCurveTo(Math.cos(am) * rr0 * 0.82, Math.sin(am) * rr0 * 0.82, p1[0], p1[1]);
    }
    g.stroke();
  }
  // tiny spider on a thread
  g.beginPath(); g.moveTo(36, 30); g.lineTo(36, 66); g.stroke();
  g.fillStyle = '#1E1628'; circ(g, 36, 68, 3.4); g.fill();
  g.strokeStyle = '#1E1628'; g.lineWidth = 0.9;
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(36, 68); g.lineTo(36 + sd * 6, 64 + i * 3); g.stroke(); }
  g.restore();
}
function rugOval(g, cx, cy, rx, ry, cols) {
  g.save();
  g.fillStyle = SH; ell(g, cx + rx * 0.02, cy + ry * 0.12, rx, ry); g.fill();
  for (let i = 0; i < cols.length; i++) { const f = 1 - i / cols.length; ell(g, cx, cy, rx * f, ry * f); g.fillStyle = cols[i]; g.fill(); }
  g.strokeStyle = 'rgba(40,20,20,0.3)'; g.lineWidth = Math.max(1, ry * 0.02);
  for (let i = 0; i < cols.length; i++) { const f = 1 - i / cols.length; ell(g, cx, cy, rx * f, ry * f); g.stroke(); }
  g.restore();
}
function catCoat(kind) {
  switch (kind) {
    case 'black': return { fur: '#2A2433', belly: '#3A3344', stripe: null, pattern: 'solid', eye: '#F2C534', line: '#120E18' };
    case 'grey': return { ...coatOf(0, 2), desat: 0.25 };
    case 'tux': return { ...coatOf(1, 1), desat: 0.2 };
    case 'calico': return { ...coatOf(2, 0), desat: 0.25 };
    case 'siam': return { ...coatOf(3, 4), desat: 0.2 };
    default: return { ...coatOf(5, 3), desat: 0.25 };
  }
}
function muteCoat(c, k = 0.25) {
  const m = h => (h ? mix(h, '#A69C98', k) : h);
  return { ...c, fur: m(c.fur), belly: m(c.belly), stripe: m(c.stripe), patch: m(c.patch), patch2: m(c.patch2), point: m(c.point) };
}
/** Ambient sitting cat (live): tail sway, blink, optional swat. */
function sitCat(g, x, y, s, coat, t, o = {}) {
  const ph = (t + (o.seed || 0)) % 4.6;
  const cat = { ...coat, ears: 'up', eyes: o.eyes || 'open', mouth: 'w', arms: o.swat ? 'swat' : 'down', swat: o.swat || 0, tail: Math.sin(t * 1.4 + (o.seed || 0)) * 0.6, look: o.look || [0, -1], blink: ph > 4.45 ? 1 : 0, t, noShadow: o.noShadow };
  drawCat(g, x, y, s, cat);
}

// ------------------------------------------------------------------ worlds
// Each world: bake(g, G) → anchors A (fills the full canvas); winLive(g, G, A, t) (clipped to panes);
// live(g, G, A, t). Anchors are CSS px in the scene's own frame.
const WORLDS = {};

// 1 · Autumn Den ---------------------------------------------------------------------------------
WORLDS[1] = {
  bake(g, G, dpr) {
    const { W, H, k, fy, por } = G;
    // wallpaper with leaf print
    g.fillStyle = '#F3D9B8'; g.fillRect(0, 0, W, fy);
    const ts = 64 * k;
    const pat = tile(g, ts, ts, dpr, (cg, w) => {
      cg.fillStyle = '#F3D9B8'; cg.fillRect(0, 0, w, w);
      mapleLeaf(cg, w * 0.25, w * 0.3, w / 64 * 1.05, 0.4, '#EBC79E', null);
      mapleLeaf(cg, w * 0.75, w * 0.78, w / 64 * 0.9, -0.6, '#EDCDA8', null);
      cg.fillStyle = '#E6BF96'; cg.beginPath(); cg.arc(w * 0.78, w * 0.2, w * 0.03, 0, TAU); cg.arc(w * 0.2, w * 0.82, w * 0.025, 0, TAU); cg.fill();
    });
    if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, fy); }
    // wainscot
    const wy = fy - Math.min(H * 0.2, 120 * k);
    g.fillStyle = lin(g, 0, wy, 0, fy, ['#C99A6E', '#B5855C']); g.fillRect(0, wy, W, fy - wy);
    g.strokeStyle = 'rgba(70,40,25,0.35)'; g.lineWidth = 1.5 * k;
    const pw = 90 * k;
    for (let x = ((W / 2) % pw) - pw; x < W; x += pw) { rr(g, x + 8 * k, wy + 12 * k, pw - 16 * k, fy - wy - 26 * k, 3 * k); g.stroke(); }
    g.fillStyle = WALNUT_L; g.fillRect(0, wy - 6 * k, W, 8 * k); g.strokeStyle = SOL; g.lineWidth = 1.6 * k; g.strokeRect(-2, wy - 6 * k, W + 4, 8 * k);
    floorPlanks(g, G, '#9A6440', '#6E4229', '#B37A50');

    // window: dusk sky, hills, maple tree
    const R = winRect(G);
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    g.fillStyle = lin(g, 0, R.y, 0, R.y + R.h, ['#7C4E7A', '#C2687A', '#F6A86B']); g.fillRect(R.x, R.y, R.w, R.h);
    g.fillStyle = rad(g, R.x + R.w * 0.62, R.y + R.h * 0.8, 0, R.w * 0.5, ['rgba(255,214,140,0.9)', 'rgba(255,190,120,0.3)', 'rgba(255,190,120,0)']); g.fillRect(R.x, R.y, R.w, R.h);
    g.fillStyle = '#FFE3A6'; circ(g, R.x + R.w * 0.62, R.y + R.h * 0.8, R.w * 0.09); g.fill();
    stars(g, { x: R.x, y: R.y, w: R.w, h: R.h * 0.3 }, 10, 3, k);
    g.fillStyle = '#9A5A6E'; g.beginPath(); g.moveTo(R.x, R.y + R.h * 0.82);
    for (let i = 0; i <= 8; i++) g.lineTo(R.x + R.w * i / 8, R.y + R.h * (0.8 + 0.05 * Math.sin(i * 1.7)));
    g.lineTo(R.x + R.w, R.y + R.h); g.lineTo(R.x, R.y + R.h); g.fill();
    g.fillStyle = '#6E3F57'; g.beginPath(); g.moveTo(R.x, R.y + R.h * 0.9);
    for (let i = 0; i <= 6; i++) g.lineTo(R.x + R.w * i / 6, R.y + R.h * (0.88 + 0.04 * Math.cos(i * 2.1)));
    g.lineTo(R.x + R.w, R.y + R.h); g.lineTo(R.x, R.y + R.h); g.fill();
    // maple tree on the left
    const tx = R.x + R.w * 0.2, ty = R.y + R.h * 0.95, ts2 = R.w / 200;
    g.fillStyle = '#4A2A30'; g.beginPath(); g.moveTo(tx - 5 * ts2, ty); g.lineTo(tx - 2 * ts2, ty - 70 * ts2); g.lineTo(tx + 3 * ts2, ty - 70 * ts2); g.lineTo(tx + 6 * ts2, ty); g.fill();
    g.strokeStyle = '#4A2A30'; g.lineWidth = 3 * ts2; g.beginPath(); g.moveTo(tx, ty - 50 * ts2); g.lineTo(tx + 26 * ts2, ty - 80 * ts2); g.moveTo(tx, ty - 45 * ts2); g.lineTo(tx - 22 * ts2, ty - 74 * ts2); g.stroke();
    for (let i = 0; i < 26; i++) {
      const a = hash(i, 11) * TAU, d = hash(i, 12) ** 0.6 * 52 * ts2;
      g.fillStyle = ['#D9572F', '#E7783A', '#C2432C', '#F09A3E'][i % 4];
      circ(g, tx + Math.cos(a) * d * 1.2, ty - 92 * ts2 + Math.sin(a) * d * 0.8, (16 + hash(i, 13) * 12) * ts2); g.fill();
    }
    g.restore();
    const { panes, sillY } = windowFrame(G, g, R, { cols: 2, rows: 2 });
    curtains(G, g, R, '#C77F3A', '#9C5C26', '#7A4520');
    // sill props
    pumpkin(g, R.x + R.w * 0.78, sillY, 0.62 * k, '#E89040');
    plant(g, R.x + R.w * 0.2, sillY, 0.48 * k, '#B9705A', '#6E8F4E');

    // leaf garland across the top (visible above the board on phones)
    const gy = Math.max(6 * k, R.y - 30 * k);
    garland(g, -10, W + 10, gy * 0.5, Math.min(26 * k, H * 0.03), k, (gg, x, y, i) => mapleLeaf(gg, x, y + 6 * k, 1.05 * k, (hash(i, 4) - 0.5) * 1.2, ['#D9572F', '#E89A3E', '#C24A2E', '#F2B04A'][i % 4], 'rgba(90,30,10,0.35)'), Math.max(7, Math.round(W / (34 * k))));

    // pictures on the wall
    const picS = k * (por ? 0.9 : 1);
    const lpX = por ? W * 0.14 : R.x - 150 * k, rpX = por ? W * 0.66 : R.x + R.w + 100 * k;
    const lpY = por ? R.y + R.h + 70 * k : R.y + 20 * k, rpY = por ? R.y + R.h + 90 * k : R.y + 50 * k;
    frame(g, lpX, lpY, 62 * picS, 76 * picS, k, (gg, x, y, w, h) => catPortrait(gg, x, y, w, h, '#9FC3B5', '#E39A55'));
    frame(g, rpX, rpY, 70 * picS, 56 * picS, k, (gg, x, y, w, h) => { gg.fillStyle = '#F2E1C4'; gg.fillRect(x, y, w, h); yarnBall(gg, x + w * 0.38, y + h * 0.56, h * 0.26, MUTE[0]); yarnBall(gg, x + w * 0.66, y + h * 0.62, h * 0.18, MUTE[3]); });

    // furniture
    const leftX = por ? W * 0.27 : Math.min(W * 0.14, R.x - 70 * k), rightX = por ? W * 0.8 : Math.max(W * 0.83, R.x + R.w + 120 * k);
    rugOval(g, W / 2, fy + (H - fy) * 0.5, Math.min(W * 0.42, 320 * k), (H - fy) * 0.34, ['#B4553F', '#E2A64E', '#5E8F86', '#E9D6A8', '#B4553F']);
    const bs = por ? Math.min(k, (fy - (R.y + R.h + 40 * k)) / 240) : k;
    bookshelf(g, leftX, fy + 4 * k, bs, 2);
    pumpkin(g, leftX + 82 * k, fy + 8 * k, 0.9 * k, '#E2843A');
    pumpkin(g, leftX + 112 * k, fy + 10 * k, 0.62 * k, '#EFA64A', '#7A6A3A');
    armchair(g, rightX, fy + 6 * k, 0.95 * k, '#B5543E', '#8A3A2C');
    knitBasket(g, por ? W * 0.56 : rightX - 120 * k, fy + 12 * k, 0.95 * k);
    sideTable(g, rightX + 112 * k, fy + 4 * k, k);
    mug(g, rightX + 112 * k, fy - 44 * k, k);
    plant(g, W - 22 * k, fy + 6 * k, 1.1 * k, '#5E8F86', '#628A48');
    // floor lamp upper-left of the armchair? The lamp lives at the left: tall lamp behind the bookshelf side
    const lx = por ? W * 0.06 : leftX - 74 * k;
    P(g, lx, fy + 4 * k, k, g => {
      g.fillStyle = SH; ell(g, 3, 0, 20, 4); g.fill();
      ell(g, 0, -3, 18, 5); fs(g, BRASS_D2);
      g.lineWidth = 2.4; g.strokeStyle = SOL; g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -196); g.stroke();
      g.strokeStyle = GOLD_D; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -196); g.stroke();
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(-34, -186); g.lineTo(34, -186); g.lineTo(22, -236); g.lineTo(-22, -236); g.closePath();
      g.fillStyle = lin(g, 0, -236, 0, -186, ['#F6D9A6', '#F0BE72']); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,240,200,0.9)'; ell(g, 0, -186, 33, 4); g.fill();
    });
    const lamp = { x: lx, y: fy - 186 * k };
    // the sleeping cat on the armchair seat
    const cat = { x: rightX + 2 * k, y: fy - 56 * k, s: 70 * k, coat: muteCoat(coatOf(0, 1), 0.2) };
    const mugA = { x: rightX + 112 * k, y: fy - 66 * k };
    // light: lamp pool upper-left
    lightPool(g, lamp.x + 60 * k, lamp.y + 40 * k, Math.max(W, H) * 0.55, 'rgba(255,214,150,0.35)');
    lightPool(g, lamp.x, lamp.y, 120 * k, 'rgba(255,226,170,0.5)');
    vignette(g, W, H, 0.42, '60,25,30');
    return { R, panes, lamp, cat, mug: mugA };
  },
  winLive(g, G, A, t) {
    const { R } = A, k = G.k;
    for (let i = 0; i < 7; i++) {
      const sp = 0.07 + hash(i, 21) * 0.05, p = (t * sp + hash(i, 22)) % 1;
      const x = R.x + R.w * (hash(i, 23) * 0.9 + 0.05) + Math.sin(t * 1.3 + i) * 14 * k;
      const y = R.y - 10 * k + p * (R.h + 20 * k);
      mapleLeaf(g, x, y, 0.75 * k, t * 1.5 + i, ['#E0602F', '#F0A040', '#C9452E'][i % 3], null);
    }
  },
  live(g, G, A, t) {
    const k = G.k;
    steam(g, A.mug.x, A.mug.y, k, t, 1);
    const fl = (t % 4) < 0.5 ? Math.sin((t % 4) / 0.5 * Math.PI) : 0;
    drawSleepCat(g, A.cat.x, A.cat.y, A.cat.s, A.cat.coat, t, fl);
    glowAt(g, A.lamp.x, A.lamp.y + 6 * k, 70 * k, 'rgba(255,220,160,0.35)', 0.8 + 0.05 * Math.sin(t * 3));
  },
};
const BRASS_D2 = '#B8862E';

// 2 · Pumpkin Night ------------------------------------------------------------------------------
WORLDS[2] = {
  bake(g, G, dpr, variant) {
    const { W, H, k, fy, por } = G;
    g.fillStyle = '#3B2A4A'; g.fillRect(0, 0, W, fy);
    const ts = 46 * k;
    const pat = tile(g, ts, ts * 2, dpr, (cg, w, h) => {
      cg.fillStyle = '#3B2A4A'; cg.fillRect(0, 0, w, h);
      cg.fillStyle = '#42304F'; cg.fillRect(0, 0, w * 0.5, h);
      cg.fillStyle = '#4C3859';
      // tiny crescent + star motif
      cg.beginPath(); cg.arc(w * 0.25, h * 0.25, w * 0.08, 0, TAU); cg.fill();
      cg.fillStyle = '#42304F'; cg.beginPath(); cg.arc(w * 0.28, h * 0.235, w * 0.07, 0, TAU); cg.fill();
      cg.fillStyle = '#4C3859'; cg.save(); cg.translate(w * 0.75, h * 0.72); cg.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? w * 0.03 : w * 0.075; cg.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      cg.fill(); cg.restore();
    });
    if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, fy); }
    const wy = fy - Math.min(H * 0.18, 110 * k);
    g.fillStyle = lin(g, 0, wy, 0, fy, ['#2C1F38', '#241A2E']); g.fillRect(0, wy, W, fy - wy);
    g.strokeStyle = 'rgba(120,90,150,0.18)'; g.lineWidth = 1.5 * k;
    const pw = 90 * k;
    for (let x = ((W / 2) % pw) - pw; x < W; x += pw) { rr(g, x + 8 * k, wy + 12 * k, pw - 16 * k, fy - wy - 26 * k, 3 * k); g.stroke(); }
    g.fillStyle = '#4A3358'; g.fillRect(0, wy - 6 * k, W, 8 * k);
    floorPlanks(g, G, '#4A3245', '#2E1E2E', '#5A3E52');

    const R = winRect(G);
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    g.fillStyle = lin(g, 0, R.y, 0, R.y + R.h, ['#2A1F45', '#5B3A6E']); g.fillRect(R.x, R.y, R.w, R.h);
    stars(g, R, 28, 7, k);
    const mR = R.w * 0.16;
    moon(g, R.x + R.w * 0.66, R.y + R.h * 0.3, mR);
    // spooky tree + rooftops silhouettes
    g.fillStyle = '#1E1530';
    g.beginPath(); g.moveTo(R.x, R.y + R.h * 0.86);
    const roofs = [[0, 0.82], [0.12, 0.82], [0.16, 0.74], [0.2, 0.82], [0.42, 0.82], [0.42, 0.76], [0.56, 0.76], [0.56, 0.83], [0.7, 0.83], [0.76, 0.72], [0.82, 0.83], [1, 0.83]];
    for (const [px, py] of roofs) g.lineTo(R.x + R.w * px, R.y + R.h * py);
    g.lineTo(R.x + R.w, R.y + R.h); g.lineTo(R.x, R.y + R.h); g.fill();
    g.fillStyle = 'rgba(255,190,90,0.85)';
    for (const [px, py] of [[0.47, 0.785], [0.51, 0.785], [0.78, 0.78]]) g.fillRect(R.x + R.w * px, R.y + R.h * py, R.w * 0.025, R.h * 0.03);
    const tx = R.x + R.w * 0.14, ty = R.y + R.h;
    g.strokeStyle = '#1E1530'; g.lineCap = 'round';
    const branch = (x, y, a, len, w, d) => {
      if (d > 4 || len < 4) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + Math.sin(d * 3) * len * 0.15, (y + y2) / 2, x2, y2); g.stroke();
      branch(x2, y2, a - 0.45 - hash(d, len | 0) * 0.3, len * 0.7, w * 0.62, d + 1);
      branch(x2, y2, a + 0.4 + hash(len | 0, d) * 0.3, len * 0.66, w * 0.6, d + 1);
    };
    branch(tx, ty, -Math.PI / 2 + 0.12, R.h * 0.3, 7 * k, 0);
    g.restore();
    const { panes, sillY } = windowFrame(G, g, R, { cols: 2, rows: 2, wood: '#4A3040', woodL: '#6A4A5C', woodD: '#2E1C28' });
    curtains(G, g, R, '#5E3A72', '#3E2450', '#E8782A');
    candle(g, R.x + R.w * 0.86, sillY, 0.85 * k, 26);
    candle(g, R.x + R.w * 0.93, sillY, 0.7 * k, 18);
    // cobwebs
    cobweb(g, 0, 0, 1.1 * k, false);
    cobweb(g, W, 0, 1.1 * k, true);
    // pennant garland of bats / triangles
    const gy = Math.max(10 * k, R.y * 0.45);
    garland(g, -10, W + 10, gy, Math.min(24 * k, H * 0.03), k, (gg, x, y, i) => {
      gg.fillStyle = i % 2 ? '#E8782A' : '#7A4A9A'; gg.strokeStyle = SOL; gg.lineWidth = 1.4 * k;
      gg.beginPath(); gg.moveTo(x - 9 * k, y); gg.lineTo(x + 9 * k, y); gg.lineTo(x, y + 18 * k); gg.closePath(); gg.fill(); gg.stroke();
      if (i % 2) { gg.fillStyle = '#3A1A10'; gg.beginPath(); gg.moveTo(x - 3.5 * k, y + 4 * k); gg.lineTo(x - 1 * k, y + 4 * k); gg.lineTo(x - 2.2 * k, y + 7 * k); gg.fill(); gg.beginPath(); gg.moveTo(x + 3.5 * k, y + 4 * k); gg.lineTo(x + 1 * k, y + 4 * k); gg.lineTo(x + 2.2 * k, y + 7 * k); gg.fill(); }
    }, Math.max(8, Math.round(W / (30 * k))));
    // witch hat on a hook
    const hx = por ? W * 0.8 : R.x + R.w + 70 * k, hy = por ? R.y + R.h + 60 * k : R.y + 30 * k;
    P(g, hx, hy, k, g => {
      g.fillStyle = BRASS_D2; circ(g, 0, 0, 3.5); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-40, 62); g.quadraticCurveTo(0, 52, 40, 62); g.quadraticCurveTo(0, 74, -40, 62); fs(g, '#2A1E3A');
      g.beginPath(); g.moveTo(-22, 60); g.quadraticCurveTo(-8, 30, 2, 2); g.quadraticCurveTo(10, -6, 18, 6); g.quadraticCurveTo(10, 10, 8, 18); g.quadraticCurveTo(14, 40, 22, 60); g.closePath();
      fs(g, '#33264A');
      g.beginPath(); g.moveTo(-21, 56); g.quadraticCurveTo(0, 50, 21, 56); g.lineTo(22, 48); g.quadraticCurveTo(0, 42, -19, 48); g.closePath(); fs(g, '#E8782A');
      g.fillStyle = GOLD; rr(g, -4, 44, 8, 10, 1.5); g.fill(); g.stroke();
    });
    // furniture: side table with jack-o'-lantern + candles (left), cauldron of yarn (right)
    const leftX = por ? W * 0.17 : Math.min(W * 0.16, R.x - 60 * k), rightX = por ? W * 0.8 : Math.max(W * 0.8, R.x + R.w + 90 * k);
    rugOval(g, W / 2, fy + (H - fy) * 0.5, Math.min(W * 0.42, 320 * k), (H - fy) * 0.34, ['#4E2E5E', '#E8782A', '#3A2448', '#7A4A9A', '#4E2E5E']);
    P(g, leftX, fy + 4 * k, k, g => {
      g.fillStyle = SH; ell(g, 4, 0, 60, 7); g.fill();
      g.fillStyle = '#2E1C28'; for (const lx of [-50, 44]) { rr(g, lx, -78, 7, 78, 2); g.fill(); g.stroke(); }
      rr(g, -60, -86, 120, 12, 3); fs(g, '#5A3A4A');
      rr(g, -54, -76, 108, 18, 2); fs(g, '#4A2E3E');
      g.fillStyle = GOLD_D; circ(g, 0, -67, 3); g.fill();
    });
    const jl = [{ x: leftX - 18 * k, y: fy - 82 * k, s: 1.25 * k }, { x: leftX + 34 * k, y: fy - 82 * k, s: 0.85 * k }, { x: rightX - 120 * k, y: fy + 10 * k, s: 1.2 * k }, { x: W * 0.5 - Math.min(W * 0.3, 230 * k), y: fy + 18 * k, s: 0.9 * k }];
    for (const j of jl) jackO(g, j.x, j.y, j.s);
    pumpkin(g, rightX - 75 * k, fy + 14 * k, 0.75 * k, '#C9622A');
    candle(g, leftX + 6 * k, fy - 82 * k, 0.9 * k, 34);
    // cauldron of yarn
    P(g, rightX + 20 * k, fy + 8 * k, k, g => {
      g.fillStyle = SH; ell(g, 4, 0, 62, 8); g.fill();
      g.fillStyle = '#1E1628'; for (const lx of [-40, 34]) { g.beginPath(); g.moveTo(lx, -10); g.lineTo(lx - 4, 0); g.lineTo(lx + 10, 0); g.closePath(); g.fill(); g.stroke(); }
      // yarn bulging out the top
      yarnBall(g, -24, -82, 18, MUTE[4]); yarnBall(g, 12, -88, 20, MUTE[1]); yarnBall(g, 34, -78, 14, MUTE[5]); yarnBall(g, -4, -96, 15, MUTE[0]);
      ell(g, 0, -50, 58, 46); g.fillStyle = rad(g, -18, -64, 6, 60, ['#4A3E5A', '#241C30', '#14101C']); g.fill(); g.stroke();
      ell(g, 0, -84, 50, 9); fs(g, '#2E2640');
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3; g.beginPath(); g.arc(-10, -50, 40, Math.PI * 1.05, Math.PI * 1.35); g.stroke();
      // trailing strand
      g.strokeStyle = SOL; g.lineWidth = 6; g.beginPath(); g.moveTo(34, -78); g.bezierCurveTo(70, -70, 60, -20, 84, -6); g.stroke();
      g.strokeStyle = MUTE[5]; g.lineWidth = 3.6; g.stroke();
    });
    // moon beam from window
    g.save(); g.globalCompositeOperation = 'screen';
    g.fillStyle = lin(g, 0, R.y + R.h * 0.6, 0, H, ['rgba(190,180,255,0.11)', 'rgba(190,180,255,0.05)', 'rgba(190,180,255,0)']);
    g.beginPath(); g.moveTo(R.x + R.w * 0.45, R.y + R.h * 0.6); g.lineTo(R.x + R.w * 0.95, R.y + R.h * 0.6); g.lineTo(R.x + R.w * 1.35, H); g.lineTo(R.x + R.w * 0.25, H); g.closePath(); g.fill();
    g.restore();
    // warm jack-o'-lantern glow
    lightPool(g, leftX, fy - 120 * k, Math.max(W, H) * 0.45, 'rgba(255,140,40,0.3)');
    vignette(g, W, H, 0.55, '18,8,30');
    const cat = { x: R.x + R.w * 0.3, y: sillY, s: 64 * k, coat: catCoat('black') };
    const flames = [
      { x: R.x + R.w * 0.86 + 0.5 * 0.85 * k, y: sillY - 30 * 0.85 * k, s: 0.85 * k }, { x: R.x + R.w * 0.93 + 0.5 * 0.7 * k, y: sillY - 22 * 0.7 * k, s: 0.7 * k },
      { x: leftX + 6 * k + 0.5 * 0.9 * k, y: fy - 82 * k - 38 * 0.9 * k, s: 0.9 * k },
    ];
    return { R, panes, cat, flames, jl: jl.map(j => ({ x: j.x, y: j.y - 18 * j.s, s: j.s })) };
  },
  winLive(g, G, A, t) {
    const { R } = A, k = G.k;
    // bats cross every 8 s
    const c = t % 8;
    if (c < 3.2) {
      const p = c / 3.2;
      for (let i = 0; i < 3; i++) {
        const q = p - i * 0.07;
        const x = R.x - 30 * k + (R.w + 60 * k) * q, y = R.y + R.h * (0.5 - 0.25 * Math.sin(q * Math.PI)) + i * 10 * k + Math.sin(t * 7 + i) * 4 * k;
        bat(g, x, y, (1.1 - i * 0.2) * k, t + i * 0.3);
      }
    }
  },
  live(g, G, A, t) {
    const k = G.k;
    for (let i = 0; i < A.flames.length; i++) flame(g, A.flames[i].x, A.flames[i].y, A.flames[i].s, t, i);
    for (let i = 0; i < A.jl.length; i++) {
      const j = A.jl[i], f = 0.75 + 0.18 * Math.sin(t * 9 + i * 2) + 0.07 * Math.sin(t * 23 + i);
      glowAt(g, j.x, j.y, 46 * j.s, 'rgba(255,150,50,0.35)', f);
    }
    // black cat on the sill, glowing eyes
    const a = A.cat;
    sitCat(g, a.x, a.y, a.s, a.coat, t, { seed: 2, look: [2, -1] });
    const ey = a.y - a.s * 0.62, ex = a.s * 0.1;
    const bl = (t % 5) > 4.85 ? 0.2 : 1;
    glowAt(g, a.x - ex + a.s * 0.01, ey, a.s * 0.12, 'rgba(255,220,80,0.6)', bl);
    glowAt(g, a.x + ex + a.s * 0.03, ey, a.s * 0.12, 'rgba(255,220,80,0.6)', bl);
    void k;
  },
};

// 3 · Snowy Cabin --------------------------------------------------------------------------------
WORLDS[3] = {
  bake(g, G) {
    const { W, H, k, fy, por } = G;
    // log wall
    const lh = 30 * k;
    for (let y = -lh * 0.3, i = 0; y < fy; y += lh, i++) {
      const c0 = i % 2 ? '#8A5A3C' : '#83553A';
      g.fillStyle = lin(g, 0, y, 0, y + lh, [mix(c0, '#C08A5E', 0.35), c0, mix(c0, '#3A2014', 0.45)]);
      g.fillRect(0, y, W, lh);
      g.strokeStyle = 'rgba(40,20,10,0.45)'; g.lineWidth = 1.6 * k; g.beginPath(); g.moveTo(0, y + lh); g.lineTo(W, y + lh); g.stroke();
      g.strokeStyle = 'rgba(60,30,15,0.25)'; g.lineWidth = 1 * k;
      for (let j = 0; j < W / (60 * k); j++) {
        const gx = hash(i, j) * W, gl = (30 + hash(j, i) * 60) * k;
        g.beginPath(); g.moveTo(gx, y + lh * (0.35 + hash(i * 3, j) * 0.3)); g.lineTo(gx + gl, y + lh * (0.35 + hash(i * 3, j) * 0.3)); g.stroke();
      }
      // knots
      if (hash(i, 99) > 0.4) { const kx = hash(i, 98) * W; g.fillStyle = 'rgba(60,30,15,0.35)'; ell(g, kx, y + lh * 0.5, 5 * k, 3.5 * k); g.fill(); }
    }
    floorPlanks(g, G, '#7A4A30', '#4E2E1C', '#8E5A3C');
    const R = winRect(G);
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    g.fillStyle = lin(g, 0, R.y, 0, R.y + R.h, ['#1A2648', '#24345C', '#3A4E7E']); g.fillRect(R.x, R.y, R.w, R.h);
    stars(g, R, 18, 13, k);
    moon(g, R.x + R.w * 0.78, R.y + R.h * 0.2, R.w * 0.07, '#F4F1FF');
    // far pines, snow ground, near pines
    for (let i = 0; i < 9; i++) pineTree(g, R.x + R.w * (i / 8), R.y + R.h * 0.84, R.w / 190 * (0.7 + hash(i, 1) * 0.3), '#2C3E5E', '#B9C8E4');
    g.fillStyle = lin(g, 0, R.y + R.h * 0.8, 0, R.y + R.h, ['#DDE6F5', '#B6C4E0']);
    g.beginPath(); g.moveTo(R.x, R.y + R.h * 0.84); g.quadraticCurveTo(R.x + R.w * 0.5, R.y + R.h * 0.76, R.x + R.w, R.y + R.h * 0.86); g.lineTo(R.x + R.w, R.y + R.h); g.lineTo(R.x, R.y + R.h); g.fill();
    pineTree(g, R.x + R.w * 0.16, R.y + R.h * 0.98, R.w / 120, '#1F3A3A', '#EEF3FB');
    pineTree(g, R.x + R.w * 0.86, R.y + R.h * 0.99, R.w / 140, '#1F3A3A', '#EEF3FB');
    g.restore();
    const { panes, sillY } = windowFrame(G, g, R, { cols: 2, rows: 3, wood: '#5A3A28', woodL: '#7A5238', woodD: '#3A2418' });
    // snow piled on the sill
    g.fillStyle = '#F2F6FF'; g.strokeStyle = SOL; g.lineWidth = 1.5 * k;
    for (const p of panes) if (p.y + p.h > R.y + R.h - 2) { g.beginPath(); g.moveTo(p.x, p.y + p.h); g.quadraticCurveTo(p.x + p.w * 0.5, p.y + p.h - 12 * k, p.x + p.w, p.y + p.h); g.fill(); }
    curtains(G, g, R, '#A23A34', '#741F22', '#E9D6A8');
    mug(g, R.x + R.w * 0.2, sillY, 1.1 * k, '#D8E3EA');
    // pine garland with warm bulbs across the top
    const gy = Math.max(10 * k, R.y * 0.42), sag = Math.min(26 * k, H * 0.03), n = Math.max(8, Math.round(W / (34 * k)));
    garland(g, -10, W + 10, gy, sag, k, (gg, x, y) => {
      for (let j = 0; j < 5; j++) { gg.fillStyle = j % 2 ? '#2E5A3E' : '#3E7050'; gg.beginPath(); gg.ellipse(x + (j - 2) * 5 * k, y + Math.abs(j - 2) * -1.5 * k, 9 * k, 5 * k, (j - 2) * 0.5, 0, TAU); gg.fill(); }
      gg.fillStyle = '#B8322A'; circ(gg, x + 4 * k, y + 3 * k, 3 * k); gg.fill();
    }, n);
    const bulbs = bulbsAlong(-10, W + 10, gy, sag, n).map(b => ({ ...b, x: b.x - 10 * k, y: b.y + 4 * k }));
    drawBulbs(g, bulbs, k, ['#FFD27A', '#FF9E6E', '#FFE9B0']);
    // fireplace lower-right
    const fx = por ? W * 0.78 : Math.max(W * 0.8, R.x + R.w + 110 * k), fyy = fy + 6 * k;
    P(g, fx, fyy, k, g => {
      g.fillStyle = SH; g.fillRect(-100, -190, 210, 190);
      // stones
      g.fillStyle = '#8E8A94'; rr(g, -104, -196, 208, 196, 6); g.fill(); g.stroke();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
        const sx = -100 + c * 34 + (r % 2) * 17 + hash(r, c) * 4, sy = -192 + r * 24;
        g.fillStyle = ['#A29EA8', '#8C8792', '#B3AEB8', '#7E7A86'][(r + c * 3) % 4];
        rr(g, sx, sy, 30, 20, 7); g.fill(); g.strokeStyle = 'rgba(40,30,40,0.5)'; g.lineWidth = 1.4; g.stroke();
      }
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      // firebox
      g.beginPath(); g.moveTo(-60, 0); g.lineTo(-60, -80); g.quadraticCurveTo(0, -122, 60, -80); g.lineTo(60, 0); g.closePath();
      g.fillStyle = rad(g, 0, -20, 4, 90, ['#4A2418', '#1E1012', '#140A0C']); g.fill(); g.stroke();
      // logs
      g.fillStyle = '#5A3420'; rr(g, -40, -18, 80, 13, 6); g.fill(); g.stroke(); rr(g, -30, -28, 64, 12, 6); g.fill(); g.stroke();
      g.fillStyle = '#C8A07A'; ell(g, 40, -11.5, 4, 6); g.fill(); g.stroke();
      // mantel
      rr(g, -118, -212, 236, 18, 3); g.fillStyle = lin(g, 0, -212, 0, -194, ['#8A5A3C', '#5A3420']); g.fill(); g.stroke();
      // candles + clock on the mantel
      ell(g, -70, -228, 12, 14); fs(g, GOLD); ell(g, -70, -228, 8, 10); fs(g, '#FFF4E4');
      g.beginPath(); g.moveTo(-70, -228); g.lineTo(-70, -235); g.moveTo(-70, -228); g.lineTo(-65, -228); g.stroke();
      pineSprig(g, 40, -214);
    });
    const stockings = [-80, -10, 60].map((dx, i) => ({ x: fx + dx * k, y: fyy - 194 * k, c: [MUTE[0], MUTE[1], MUTE[5]][i] }));
    for (const s of stockings) stocking(g, s.x, s.y, k, s.c);
    // plaid rug + cocoa stool
    P(g, W / 2, fy + (H - fy) * 0.55, 1, g => {
      const rw = Math.min(W * 0.4, 300 * k), rh = (H - fy) * 0.3;
      g.save(); g.transform(1, 0, -0.0, 1, 0, 0);
      g.fillStyle = SH; rr(g, -rw + 4 * k, -rh + 4 * k, rw * 2, rh * 2, 8 * k); g.fill();
      rr(g, -rw, -rh, rw * 2, rh * 2, 8 * k); g.fillStyle = '#A8322E'; g.fill();
      g.save(); g.clip();
      g.fillStyle = 'rgba(30,20,40,0.28)';
      for (let x = -rw; x < rw; x += 36 * k) g.fillRect(x, -rh, 12 * k, rh * 2);
      for (let y = -rh; y < rh; y += 30 * k) g.fillRect(-rw, y, rw * 2, 10 * k);
      g.fillStyle = 'rgba(255,230,180,0.25)';
      for (let x = -rw + 20 * k; x < rw; x += 36 * k) g.fillRect(x, -rh, 2 * k, rh * 2);
      g.restore();
      g.strokeStyle = SOL; g.lineWidth = 2 * k; g.stroke();
      g.restore();
    });
    const sx = por ? W * 0.14 : Math.min(W * 0.18, R.x - 70 * k);
    // armchair (green) on the left, cocoa on a stool
    armchair(g, sx, fy + 6 * k, 0.95 * k, '#3E6A58', '#2A4A3E');
    sideTable(g, sx + 110 * k, fy + 6 * k, k);
    mug(g, sx + 110 * k, fy - 42 * k, k, '#E8463A');
    // stack of logs + axe-less basket
    if (!por) P(g, sx - 110 * k > 10 ? sx - 110 * k : sx + 190 * k, fy + 10 * k, k, g => {
      for (const [lx, ly] of [[-20, -10], [6, -10], [32, -10], [-7, -32], [19, -32], [6, -54]]) { circ(g, lx, ly, 12); fs(g, '#7A4A2E'); g.fillStyle = '#D8B080'; circ(g, lx, ly, 8); g.fill(); g.strokeStyle = 'rgba(120,80,40,0.6)'; g.lineWidth = 1.2; circ(g, lx, ly, 4.5); g.stroke(); g.strokeStyle = SOL; g.lineWidth = 2.6; }
    });
    const cat = { x: fx - 150 * k, y: fy + 14 * k, s: 80 * k, coat: muteCoat(coatOf(3, 4), 0.2) };
    lightPool(g, fx, fyy - 50 * k, Math.max(W, H) * 0.5, 'rgba(255,150,70,0.32)');
    vignette(g, W, H, 0.5, '20,12,30');
    return { R, panes, fire: { x: fx, y: fyy - 26 * k }, mugs: [{ x: sx + 110 * k, y: fy - 62 * k }, { x: R.x + R.w * 0.2, y: sillY - 22 * k }], cat, bulbs };
  },
  winLive(g, G, A, t) {
    const { R } = A, k = G.k;
    g.fillStyle = 'rgba(245,248,255,0.9)';
    for (let i = 0; i < 46; i++) {
      const sp = 0.06 + hash(i, 31) * 0.06, p = (t * sp + hash(i, 32)) % 1;
      const x = R.x + ((hash(i, 33) * R.w + Math.sin(t * 0.8 + i) * 10 * k) % R.w + R.w) % R.w;
      const y = R.y + p * R.h;
      circ(g, x, y, (0.8 + hash(i, 34) * 1.6) * k); g.fill();
    }
  },
  live(g, G, A, t) {
    const k = G.k, f = A.fire;
    // fire: layered flames
    for (let i = 0; i < 5; i++) {
      const ox = (i - 2) * 13 * k, h = (36 + 14 * Math.sin(t * 7 + i * 1.7) + 6 * Math.sin(t * 17 + i)) * k;
      g.fillStyle = i % 2 ? '#F27B2A' : '#FFB13B';
      g.beginPath(); g.moveTo(f.x + ox - 12 * k, f.y); g.quadraticCurveTo(f.x + ox - 10 * k, f.y - h * 0.6, f.x + ox + Math.sin(t * 5 + i) * 5 * k, f.y - h); g.quadraticCurveTo(f.x + ox + 10 * k, f.y - h * 0.6, f.x + ox + 12 * k, f.y); g.fill();
    }
    g.fillStyle = '#FFF0B0';
    for (let i = 0; i < 3; i++) { const ox = (i - 1) * 12 * k, h = (18 + 6 * Math.sin(t * 11 + i)) * k; g.beginPath(); g.moveTo(f.x + ox - 6 * k, f.y); g.quadraticCurveTo(f.x + ox, f.y - h * 1.4, f.x + ox + 6 * k, f.y); g.fill(); }
    glowAt(g, f.x, f.y - 20 * k, 150 * k, 'rgba(255,150,60,0.4)', 0.75 + 0.15 * Math.sin(t * 8) + 0.08 * Math.sin(t * 19));
    // embers
    g.fillStyle = '#FFC860';
    for (let i = 0; i < 6; i++) { const p = (t * 0.6 + i / 6) % 1; circ(g, f.x + Math.sin(t * 2 + i * 2) * 20 * k, f.y - 20 * k - p * 70 * k, 1.6 * k * (1 - p)); g.fill(); }
    for (let i = 0; i < A.mugs.length; i++) steam(g, A.mugs[i].x, A.mugs[i].y, k, t, i);
    const fl = ((t + 1.5) % 4) < 0.5 ? Math.sin(((t + 1.5) % 4) / 0.5 * Math.PI) : 0;
    drawSleepCat(g, A.cat.x, A.cat.y, A.cat.s, A.cat.coat, t, fl);
    for (const b of A.bulbs) glowAt(g, b.x, b.y, 12 * k, 'rgba(255,210,120,0.5)', 0.6 + 0.4 * Math.sin(t * 2 + b.i * 1.3));
  },
};
function pineSprig(g, x, y) {
  g.fillStyle = '#3E7050';
  for (let i = 0; i < 6; i++) { ell(g, x + i * 9 - 22, y - 4 - (i % 2) * 2, 9, 4, (i - 3) * 0.2); g.fill(); }
  g.fillStyle = '#B8322A'; circ(g, x - 4, y - 7, 3); g.fill(); circ(g, x + 4, y - 5, 3); g.fill();
}
function stocking(g, x, y, k, col) {
  P(g, x, y, k, g => {
    g.strokeStyle = SOL; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-10, 8); g.lineTo(-10, 46); g.quadraticCurveTo(-10, 60, 4, 60); g.lineTo(18, 60); g.quadraticCurveTo(26, 60, 26, 52); g.quadraticCurveTo(26, 46, 18, 44); g.lineTo(10, 42); g.lineTo(10, 8); g.closePath();
    fs(g, col);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-8, 20 + i * 8); g.lineTo(8, 20 + i * 8); g.stroke(); }
    g.strokeStyle = SOL; g.lineWidth = 2.2;
    rr(g, -13, 0, 26, 12, 4); fs(g, '#F2EBDD');
  });
}

// 4 · Cat Café ----------------------------------------------------------------------------------
WORLDS[4] = {
  bake(g, G, dpr) {
    const { W, H, k, fy } = G;
    g.fillStyle = '#CDEBDD'; g.fillRect(0, 0, W, fy);
    // subway tiles on the lower wall
    const ty = fy - Math.min(H * 0.32, 190 * k);
    const tw = 28 * k, th = 14 * k;
    const pat = tile(g, tw * 2, th * 2, dpr, (cg, w, h) => {
      cg.fillStyle = '#B9DDCB'; cg.fillRect(0, 0, w, h);
      cg.fillStyle = '#E4F4EC';
      const gw = w / 2, gh = h / 2, m = Math.max(0.6, gw * 0.05);
      for (const [x, y] of [[0, 0], [gw, 0], [-gw / 2, gh], [gw / 2, gh], [gw * 1.5, gh]]) { cg.fillRect(x + m, y + m, gw - 2 * m, gh - 2 * m); }
      cg.fillStyle = 'rgba(255,255,255,0.5)';
      for (const [x, y] of [[0, 0], [gw, 0], [-gw / 2, gh], [gw / 2, gh], [gw * 1.5, gh]]) { cg.fillRect(x + m, y + m, gw - 2 * m, m * 1.2); }
    });
    if (pat) { g.fillStyle = pat; g.fillRect(0, ty, W, fy - ty); }
    g.fillStyle = '#7FB8A0'; g.fillRect(0, ty - 5 * k, W, 6 * k);
    // checker floor
    g.save(); g.beginPath(); g.rect(0, fy, W, H - fy); g.clip();
    g.fillStyle = '#EFE2CC'; g.fillRect(0, fy, W, H - fy);
    const vx = W / 2, vy = fy - H * 0.9, sz = 46 * k;
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y0 = fy + (H - fy) * (r / rows) ** 1.25, y1 = fy + (H - fy) * ((r + 1) / rows) ** 1.25;
      const t0 = (y0 - vy) / (H - vy), t1 = (y1 - vy) / (H - vy);
      const n = Math.ceil(W / (sz * t0)) + 4;
      for (let c = -n; c <= n; c++) {
        if ((c + r) % 2 === 0) continue;
        const xa = vx + c * sz;
        g.fillStyle = '#C9725A';
        g.beginPath(); g.moveTo(vx + (xa - vx) * t0 / t0 * t0, y0);
        g.moveTo(vx + (c * sz) * t0 / 1, y0); g.lineTo(vx + ((c + 1) * sz) * t0, y0); g.lineTo(vx + ((c + 1) * sz) * t1, y1); g.lineTo(vx + (c * sz) * t1, y1); g.closePath(); g.fill();
      }
    }
    g.restore();
    g.fillStyle = '#5E9A82'; g.fillRect(0, fy - 7 * k, W, 7 * k);
    g.fillStyle = 'rgba(20,40,30,0.18)'; g.fillRect(0, fy, W, 4 * k);
    // big shop window (wide)
    const R = winRect(G, 1.45);
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
    g.fillStyle = lin(g, 0, R.y, 0, R.y + R.h, ['#9FD3EE', '#CBE8F2', '#F3EEDD']); g.fillRect(R.x, R.y, R.w, R.h);
    // clouds
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [cx, cy, s] of [[0.2, 0.15, 1], [0.7, 0.1, 0.8]]) { for (const [dx, dy, r] of [[0, 0, 14], [14, 4, 11], [-14, 4, 10], [26, 6, 8]]) { circ(g, R.x + R.w * cx + dx * s * k, R.y + R.h * cy + dy * s * k, r * s * k); g.fill(); } }
    // buildings across the street
    const bcols = ['#E8B4A0', '#F2D49B', '#B6CBE0', '#D9B8D6', '#F0C29C'];
    let bx = R.x - 10 * k, bi = 0;
    while (bx < R.x + R.w) {
      const bw = (60 + hash(bi, 41) * 50) * k, bh = R.h * (0.45 + hash(bi, 42) * 0.25);
      const by = R.y + R.h * 0.78 - bh;
      g.fillStyle = bcols[bi % bcols.length]; g.fillRect(bx, by, bw, bh + R.h);
      g.fillStyle = 'rgba(60,40,60,0.25)'; g.fillRect(bx, by, bw, 5 * k);
      g.fillStyle = 'rgba(80,110,150,0.55)';
      for (let wy2 = by + 14 * k; wy2 < R.y + R.h * 0.7; wy2 += 24 * k) for (let wx = bx + 10 * k; wx < bx + bw - 14 * k; wx += 22 * k) g.fillRect(wx, wy2, 10 * k, 13 * k);
      bx += bw + 2 * k; bi++;
    }
    // street + pavement + lamppost
    g.fillStyle = '#9C9AA6'; g.fillRect(R.x, R.y + R.h * 0.78, R.w, R.h * 0.08);
    g.fillStyle = '#6E6C7A'; g.fillRect(R.x, R.y + R.h * 0.86, R.w, R.h * 0.14);
    g.fillStyle = '#F2EEDD'; for (let x = R.x; x < R.x + R.w; x += 40 * k) g.fillRect(x, R.y + R.h * 0.93, 22 * k, 3 * k);
    g.fillStyle = '#3E4A5A'; g.fillRect(R.x + R.w * 0.82, R.y + R.h * 0.35, 4 * k, R.h * 0.5);
    ell(g, R.x + R.w * 0.82 + 2 * k, R.y + R.h * 0.34, 9 * k, 6 * k); g.fill();
    g.restore();
    const { panes } = windowFrame(G, g, R, { cols: 3, rows: 1, wood: '#3E7A64', woodL: '#5E9A82', woodD: '#2A5A48', frame: 10 });
    // striped awning valance above the window (inside)
    const ay = R.y - 10 * k - 26 * k, aw = R.w + 40 * k, ax = R.x - 20 * k;
    const ns = Math.max(6, Math.round(aw / (26 * k)));
    for (let i = 0; i < ns; i++) {
      const x0 = ax + aw * i / ns, x1 = ax + aw * (i + 1) / ns;
      g.fillStyle = i % 2 ? '#F4EFE2' : '#E86A5A'; g.strokeStyle = SOL; g.lineWidth = 1.6 * k;
      g.beginPath(); g.moveTo(x0, ay); g.lineTo(x1, ay); g.lineTo(x1, ay + 22 * k); g.arc((x0 + x1) / 2, ay + 22 * k, (x1 - x0) / 2, 0, Math.PI); g.closePath(); g.fill(); g.stroke();
    }
    // chalkboard (doodles only)
    const { por } = G;
    const cbx = por ? W * 0.24 : Math.min(W * 0.14, R.x - 80 * k), cby = por ? R.y + R.h + 46 * k : R.y + 10 * k;
    const ctop0 = fy - 92 * k;
    const cbs = por ? Math.min(k, (ctop0 - cby - 14 * k) / 150) : k;
    if (cbs > 0.72 * k) P(g, cbx, cby, cbs, g => {
      rr(g, -60, 0, 120, 150, 4); fs(g, WALNUT);
      g.fillStyle = '#2E3A36'; g.fillRect(-52, 8, 104, 134);
      g.strokeStyle = 'rgba(245,245,235,0.85)'; g.lineWidth = 2;
      // cat face
      g.beginPath(); g.moveTo(-34, 40); g.lineTo(-30, 22); g.lineTo(-22, 32); g.moveTo(-10, 32); g.lineTo(-2, 22); g.lineTo(2, 40); g.stroke();
      ell(g, -16, 44, 18, 14); g.stroke();
      circ(g, -22, 42, 1.5); g.stroke(); circ(g, -10, 42, 1.5); g.stroke();
      g.beginPath(); g.moveTo(-30, 47); g.lineTo(-40, 45); g.moveTo(-2, 47); g.lineTo(8, 45); g.stroke();
      // cup with steam
      rr(g, 16, 30, 24, 22, 3); g.stroke(); g.beginPath(); g.arc(42, 40, 5, -1.3, 1.3); g.stroke();
      g.beginPath(); g.moveTo(22, 26); g.quadraticCurveTo(18, 20, 22, 14); g.moveTo(32, 26); g.quadraticCurveTo(28, 20, 32, 14); g.stroke();
      // cake slice
      g.strokeStyle = 'rgba(255,190,200,0.9)';
      g.beginPath(); g.moveTo(-36, 110); g.lineTo(-4, 110); g.lineTo(-4, 92); g.lineTo(-36, 100); g.closePath(); g.stroke();
      circ(g, -10, 88, 3); g.stroke();
      // heart + stars + yarn ball
      g.strokeStyle = 'rgba(255,220,120,0.9)';
      g.beginPath(); g.moveTo(26, 112); g.bezierCurveTo(10, 100, 18, 86, 26, 96); g.bezierCurveTo(34, 86, 42, 100, 26, 112); g.stroke();
      g.strokeStyle = 'rgba(160,220,240,0.9)'; circ(g, -26, 74, 1); g.stroke();
      circ(g, 30, 74, 9); g.stroke(); g.beginPath(); g.moveTo(22, 70); g.quadraticCurveTo(30, 76, 37, 70); g.moveTo(24, 79); g.quadraticCurveTo(30, 74, 38, 79); g.stroke();
      // dotted border
      g.strokeStyle = 'rgba(245,245,235,0.5)'; g.setLineDash([3, 5]); g.strokeRect(-46, 14, 92, 122); g.setLineDash([]);
      g.fillStyle = '#E9E2D2'; g.fillRect(-30, 142, 22, 4); g.fillStyle = '#F0B8C0'; g.fillRect(4, 142, 12, 4);
    });
    // shelf with cups and plants on the right wall
    const shx = por ? W * 0.72 : Math.max(W * 0.86, R.x + R.w + 90 * k), shy = por ? R.y + R.h + 110 * k : R.y + 70 * k;
    const shOk = !por || shy + 30 * k < ctop0 - 10 * k;
    if (shOk) P(g, shx, shy, k, g => {
      rr(g, -70, 0, 140, 8, 2); fs(g, WALNUT_L);
      g.fillStyle = WALNUT_D; for (const bx2 of [-50, 50]) { g.beginPath(); g.moveTo(bx2 - 6, 8); g.lineTo(bx2 + 6, 8); g.lineTo(bx2, 22); g.closePath(); g.fill(); g.stroke(); }
      for (let i = 0; i < 3; i++) { rr(g, -60 + i * 22, -18, 16, 18, 3); fs(g, ['#F4EFE2', '#E8A0A0', '#9FD3C8'][i]); }
    });
    if (shOk) plant(g, shx + 40 * k, shy, 0.62 * k, '#F4EFE2', '#5E9A62');
    // counter
    const cx = W * 0.5, cw = Math.min(W * 0.9, 520 * k);
    const ctop = fy - 92 * k;
    P(g, 0, 0, 1, g => {
      g.fillStyle = SH; g.fillRect(cx - cw / 2 + 6 * k, ctop + 8 * k, cw, fy - ctop);
      g.lineWidth = 2.4 * k;
      g.fillStyle = lin(g, 0, ctop, 0, fy, ['#B8875E', '#9A6A45']); g.fillRect(cx - cw / 2, ctop + 10 * k, cw, fy - ctop - 6 * k); g.strokeRect(cx - cw / 2, ctop + 10 * k, cw, fy - ctop - 6 * k);
      g.strokeStyle = 'rgba(60,30,20,0.35)'; g.lineWidth = 1.5 * k;
      const np = Math.max(3, Math.round(cw / (80 * k)));
      for (let i = 0; i < np; i++) { const px = cx - cw / 2 + cw * i / np; rr(g, px + 8 * k, ctop + 22 * k, cw / np - 16 * k, fy - ctop - 36 * k, 4 * k); g.stroke(); }
      g.strokeStyle = SOL; g.lineWidth = 2.4 * k;
      rr(g, cx - cw / 2 - 10 * k, ctop, cw + 20 * k, 12 * k, 3 * k); g.fillStyle = '#F4EFE2'; g.fill(); g.stroke();
    });
    // cake stand with dome (left part of the counter), cups (right part), espresso machine
    const cakeX = cx - cw * 0.3, cupX = cx + cw * 0.28;
    P(g, cakeX, ctop, k, g => {
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.lineTo(3, -20); g.lineTo(-3, -20); g.closePath(); fs(g, '#F4EFE2');
      ell(g, 0, -21, 30, 5); fs(g, '#F4EFE2');
      rr(g, -22, -50, 44, 28, 6); fs(g, '#F3B9C4');
      g.fillStyle = '#FFF4E4'; g.beginPath(); g.moveTo(-22, -40);
      for (let i = 0; i <= 8; i++) g.lineTo(-22 + i * 5.5, -40 + (i % 2 ? 6 : 0));
      g.lineTo(22, -50); g.lineTo(-22, -50); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = TOMATO; circ(g, 0, -55, 5); g.fill(); g.stroke();
      // dome
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-28, -21); g.bezierCurveTo(-30, -78, 30, -78, 28, -21); g.stroke();
      g.fillStyle = 'rgba(220,240,255,0.18)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-18, -40); g.quadraticCurveTo(-18, -58, -8, -63); g.stroke();
      g.strokeStyle = SOL; g.lineWidth = 2; circ(g, 0, -71, 4); g.fillStyle = '#F4EFE2'; g.fill(); g.stroke();
    });
    const cups = [];
    for (let i = 0; i < 2; i++) { mug(g, cupX + (i * 26 - 13) * k, ctop, 0.9 * k, ['#F4EFE2', '#9FD3C8'][i]); cups.push({ x: cupX + (i * 26 - 13) * k, y: ctop - 20 * k }); }
    P(g, cupX + 64 * k, ctop, k, g => {
      rr(g, -22, -58, 44, 58, 5); fs(g, '#C9CDD6');
      rr(g, -18, -54, 36, 14, 3); fs(g, '#8E95A4');
      g.fillStyle = TOMATO; circ(g, -8, -47, 3); g.fill(); g.fillStyle = TEAL2; circ(g, 4, -47, 3); g.fill();
      rr(g, -6, -36, 12, 8, 2); fs(g, '#5E6474');
      rr(g, -9, -14, 18, 14, 2); fs(g, '#F4EFE2');
    });
    // cat tree on the right side
    const ctx = por ? W * 0.84 : Math.max(W * 0.86, R.x + R.w + 70 * k);
    P(g, ctx, fy + 8 * k, k, g => {
      g.fillStyle = SH; ell(g, 4, 0, 60, 8); g.fill();
      const post = (x, y0, y1) => { g.fillStyle = '#D8B98A'; g.fillRect(x - 7, y1, 14, y0 - y1); g.strokeRect(x - 7, y1, 14, y0 - y1); g.strokeStyle = 'rgba(120,80,40,0.5)'; g.lineWidth = 1.2; for (let y = y1 + 4; y < y0; y += 5) { g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y + 2); g.stroke(); } g.strokeStyle = SOL; g.lineWidth = 2.6; };
      rr(g, -56, -14, 112, 14, 5); fs(g, '#B9A48C');
      post(-30, -14, -110); post(30, -14, -190);
      rr(g, -66, -122, 76, 14, 6); fs(g, '#E2CFB0');
      rr(g, -6, -202, 76, 14, 6); fs(g, '#E2CFB0');
      // cosy cube
      rr(g, -50, -100, 44, 0.1, 1);
    });
    const tree = { top: { x: ctx + 32 * k, y: fy + 8 * k - 202 * k }, mid: { x: ctx - 28 * k, y: fy + 8 * k - 122 * k }, toy: { x: ctx + 4 * k, y: fy + 8 * k - 186 * k } };
    // daylight pool from the window
    lightPool(g, R.x + R.w / 2, R.y + R.h, Math.max(W, H) * 0.55, 'rgba(255,248,220,0.35)');
    vignette(g, W, H, 0.28, '30,50,45');
    return { R, panes, cups, tree, fan: { x: W / 2, y: 0 }, ctop };
  },
  winLive(g, G, A, t) {
    // a little car crossing every 9 s + a bird
    const { R } = A, k = G.k, c = t % 9;
    if (c < 4) {
      const x = R.x - 60 * k + (R.w + 120 * k) * (c / 4), y = R.y + R.h * 0.86;
      P(g, x, y, k, g => {
        rr(g, -30, -18, 60, 14, 5); fs(g, '#E8463A');
        rr(g, -16, -28, 30, 12, 5); fs(g, '#F4EFE2');
        g.fillStyle = '#2F2540'; circ(g, -18, -3, 5); g.fill(); circ(g, 18, -3, 5); g.fill();
      });
    }
    const bp = (t * 0.07) % 1;
    g.strokeStyle = 'rgba(60,60,80,0.7)'; g.lineWidth = 1.6 * k;
    const bx = R.x + R.w * bp, by = R.y + R.h * 0.25 + Math.sin(t) * 8 * k, w = Math.sin(t * 10) * 3 * k;
    g.beginPath(); g.moveTo(bx - 6 * k, by - w); g.quadraticCurveTo(bx - 3 * k, by - 3 * k, bx, by); g.quadraticCurveTo(bx + 3 * k, by - 3 * k, bx + 6 * k, by - w); g.stroke();
  },
  live(g, G, A, t) {
    const k = G.k;
    for (let i = 0; i < A.cups.length; i++) steam(g, A.cups[i].x, A.cups[i].y, 0.9 * k, t, i);
    // ceiling fan (top centre)
    const fx = A.fan.x, fy0 = 0, drop = 38 * k;
    g.save();
    g.strokeStyle = SOL; g.lineWidth = 3 * k; g.beginPath(); g.moveTo(fx, fy0); g.lineTo(fx, fy0 + drop); g.stroke();
    const a = t * 2.4;
    for (let i = 0; i < 4; i++) {
      const ang = a + i * Math.PI / 2, cx = Math.cos(ang), sy = Math.sin(ang) * 0.22;
      const bx = fx + cx * 70 * k, by = fy0 + drop + 4 * k + sy * 70 * k;
      g.fillStyle = sy > 0 ? '#9A6A45' : '#7A5238'; g.strokeStyle = SOL; g.lineWidth = 1.8 * k;
      g.beginPath(); g.moveTo(fx, fy0 + drop + 4 * k); g.lineTo(bx - sy * 30 * k, by - Math.abs(cx) * 4 * k); g.lineTo(bx + sy * 30 * k, by + Math.abs(cx) * 4 * k); g.closePath();
      ell(g, (fx + bx) / 2 + cx * 10 * k, (fy0 + drop + by) / 2, 40 * k * Math.abs(cx) + 6 * k, 7 * k + Math.abs(sy) * 20 * k, ang * 0); g.fill(); g.stroke();
    }
    ell(g, fx, fy0 + drop + 4 * k, 14 * k, 8 * k); g.fillStyle = '#C9CDD6'; g.fill(); g.stroke();
    ell(g, fx, fy0 + drop + 14 * k, 9 * k, 7 * k); g.fillStyle = '#FFF0C8'; g.fill(); g.stroke();
    g.restore();
    // two cats on the cat tree: one sleeps on top, one bats the hanging toy
    const T0 = A.tree;
    const fl = (t % 4) < 0.5 ? Math.sin((t % 4) / 0.5 * Math.PI) : 0;
    drawSleepCat(g, T0.top.x, T0.top.y, 64 * k, muteCoat(coatOf(2, 0), 0.22), t, fl);
    const swing = Math.sin(t * 2.6) * 0.35;
    const tx = T0.toy.x + Math.sin(swing) * 46 * k, ty = T0.toy.y + Math.cos(swing) * 46 * k;
    g.strokeStyle = 'rgba(60,40,40,0.8)'; g.lineWidth = 1.2 * k; g.beginPath(); g.moveTo(T0.toy.x, T0.toy.y); g.lineTo(tx, ty); g.stroke();
    g.fillStyle = '#E86A9A'; g.strokeStyle = SOL; g.lineWidth = 1.4 * k; circ(g, tx, ty, 5 * k); g.fill(); g.stroke();
    const sw = Math.max(0, Math.sin(t * 2.6 + 0.6)) ** 6;
    sitCat(g, T0.mid.x, T0.mid.y, 58 * k, muteCoat(coatOf(1, 2), 0.2), t, { seed: 1, swat: sw, look: [3, -3] });
  },
};
const TEAL2 = '#1FB0A0';

// 5 · Moonlit Attic -----------------------------------------------------------------------------
WORLDS[5] = {
  bake(g, G) {
    const { W, H, k, fy, por } = G;
    // back wall (lighter planks) + sloped roof planks on both sides
    g.fillStyle = '#6E5644'; g.fillRect(0, 0, W, fy);
    g.strokeStyle = 'rgba(30,18,12,0.35)'; g.lineWidth = 1.5 * k;
    for (let x = 0; x < W; x += 34 * k) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, fy); g.stroke(); }
    const apexY = -H * 0.25, eave = fy - (por ? H * 0.32 : H * 0.42);
    const slope = (side) => {
      g.beginPath();
      if (side < 0) { g.moveTo(0, apexY); g.lineTo(W * 0.26, apexY); g.lineTo(0, eave); }
      else { g.moveTo(W, apexY); g.lineTo(W * 0.74, apexY); g.lineTo(W, eave); }
      g.closePath();
    };
    for (const sd of [-1, 1]) {
      g.save(); slope(sd); g.clip();
      g.fillStyle = '#5A4636'; g.fillRect(0, apexY, W, eave - apexY + 10);
      g.strokeStyle = 'rgba(25,15,10,0.45)'; g.lineWidth = 1.6 * k;
      for (let i = -20; i < 40; i++) {
        const off = i * 26 * k;
        g.beginPath();
        if (sd < 0) { g.moveTo(off, apexY); g.lineTo(off - W * 0.26 * 1.2, eave + 40 * k); }
        else { g.moveTo(W - off, apexY); g.lineTo(W - off + W * 0.26 * 1.2, eave + 40 * k); }
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, apexY, W, eave - apexY + 10);
      g.restore();
      // beam along the slope edge
      g.strokeStyle = SOL; g.lineWidth = 2.4 * k;
      g.fillStyle = '#4A3428';
      g.beginPath();
      if (sd < 0) { g.moveTo(W * 0.26, apexY); g.lineTo(W * 0.26 + 16 * k, apexY); g.lineTo(16 * k, eave + 8 * k); g.lineTo(0, eave + 8 * k); g.lineTo(0, eave); }
      else { g.moveTo(W * 0.74, apexY); g.lineTo(W * 0.74 - 16 * k, apexY); g.lineTo(W - 16 * k, eave + 8 * k); g.lineTo(W, eave + 8 * k); g.lineTo(W, eave); }
      g.closePath(); g.fill(); g.stroke();
    }
    // horizontal tie beam
    const tby = Math.max(16 * k, H * 0.05);
    g.fillStyle = lin(g, 0, tby, 0, tby + 16 * k, ['#6A4C38', '#3E2A1E']); g.fillRect(0, tby, W, 16 * k); g.strokeStyle = SOL; g.strokeRect(-2, tby, W + 4, 16 * k);
    floorPlanks(g, G, '#6A4E3A', '#46301F', '#7E5E46');
    // round window
    const r = por ? W * 0.24 : Math.min(H * 0.2, W * 0.14);
    const cx = W / 2, cy = (por ? H * 0.07 : H * 0.1) + r + 6 * k;
    g.save(); circ(g, cx, cy, r); g.clip();
    g.fillStyle = lin(g, 0, cy - r, 0, cy + r, ['#141C3F', '#2A2E62', '#4A3E7A']); g.fillRect(cx - r, cy - r, r * 2, r * 2);
    stars(g, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, 30, 17, k);
    moon(g, cx + r * 0.35, cy - r * 0.3, r * 0.22, '#F4F1FF');
    g.fillStyle = '#1C1838';
    g.beginPath(); g.moveTo(cx - r, cy + r * 0.55);
    for (let i = 0; i <= 10; i++) g.lineTo(cx - r + r * 2 * i / 10, cy + r * (0.5 + (hash(i, 51) * 0.25)));
    g.lineTo(cx + r, cy + r); g.lineTo(cx - r, cy + r); g.fill();
    g.restore();
    // round frame + cross
    g.strokeStyle = SOL; g.lineWidth = 2.4 * k;
    g.beginPath(); g.arc(cx, cy, r + 12 * k, 0, TAU); g.arc(cx, cy, r, 0, TAU, true); g.fillStyle = lin(g, cx - r, 0, cx + r, 0, [WALNUT_L, WALNUT, WALNUT_D]); g.fill('evenodd'); g.stroke();
    g.fillStyle = WALNUT; g.fillRect(cx - 3.5 * k, cy - r, 7 * k, r * 2); g.strokeRect(cx - 3.5 * k, cy - r, 7 * k, r * 2);
    g.fillRect(cx - r, cy - 3.5 * k, r * 2, 7 * k); g.strokeRect(cx - r, cy - 3.5 * k, r * 2, 7 * k);
    const panes = [{ circle: true, x: cx, y: cy, r }];
    // moon beam down to the floor (cool)
    g.save(); g.globalCompositeOperation = 'screen';
    g.fillStyle = lin(g, cx, cy, cx + r * 0.6, H, ['rgba(170,190,255,0.2)', 'rgba(170,190,255,0.07)', 'rgba(170,190,255,0)']);
    g.beginPath(); g.moveTo(cx - r * 0.7, cy + r * 0.3); g.lineTo(cx + r * 0.7, cy + r * 0.3); g.lineTo(cx + r * 1.9, H); g.lineTo(cx + r * 0.1, H); g.closePath(); g.fill();
    g.restore();
    // fairy lights draped along the tie beam
    const n = Math.max(10, Math.round(W / (26 * k)));
    const bulbs = [];
    for (let seg = 0; seg < 3; seg++) {
      const x0 = W * seg / 3, x1 = W * (seg + 1) / 3, sag = 22 * k;
      g.strokeStyle = 'rgba(30,20,20,0.7)'; g.lineWidth = 1.2 * k;
      g.beginPath(); g.moveTo(x0, tby + 14 * k); g.quadraticCurveTo((x0 + x1) / 2, tby + 14 * k + sag * 2, x1, tby + 14 * k); g.stroke();
      for (const b of bulbsAlong(x0, x1, tby + 14 * k, sag, Math.round(n / 3))) bulbs.push({ ...b, i: b.i + seg * 7 });
    }
    drawBulbs(g, bulbs, k, ['#FFE08A', '#FFC07A', '#FFEFC0']);
    // trunks (left), dress form (right), boxes
    const leftX = por ? W * 0.17 : Math.min(W * 0.16, cx - r - 90 * k), rightX = por ? W * 0.84 : Math.max(W * 0.82, cx + r + 110 * k);
    trunk(g, leftX, fy + 8 * k, 1.1 * k, '#7A4A3A', '#B8862E');
    trunk(g, leftX + 10 * k, fy + 8 * k - 66 * 1.1 * k, 0.8 * k, '#3E5A6E', '#C9A050');
    P(g, leftX + 120 * k, fy + 10 * k, k, g => {
      g.fillStyle = SH; ell(g, 3, 0, 34, 5); g.fill();
      rr(g, -30, -46, 60, 46, 2); fs(g, '#C9A87A');
      g.strokeStyle = 'rgba(90,60,30,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-30, -36); g.lineTo(30, -36); g.stroke();
      g.fillStyle = '#B88F5E'; g.beginPath(); g.moveTo(-30, -46); g.lineTo(-38, -58); g.lineTo(0, -52); g.lineTo(-4, -46); g.fill(); g.strokeStyle = SOL; g.lineWidth = 2.2; g.stroke();
      yarnBall(g, 14, -56, 10, MUTE[2]);
    });
    // dress form with sweater
    P(g, rightX, fy + 6 * k, k, g => {
      g.fillStyle = SH; ell(g, 3, 0, 30, 5); g.fill();
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      for (const sd of [-1, 0, 1]) { g.beginPath(); g.moveTo(0, -40); g.lineTo(sd * 24, 0); g.stroke(); }
      g.fillStyle = '#3A2A20'; g.fillRect(-3, -110, 6, 72); g.strokeRect(-3, -110, 6, 72);
      g.beginPath(); g.moveTo(-30, -200); g.quadraticCurveTo(-40, -150, -26, -110); g.lineTo(26, -110); g.quadraticCurveTo(40, -150, 30, -200); g.quadraticCurveTo(0, -214, -30, -200); g.closePath(); fs(g, '#D8C6A8');
      // knitted sweater (tomato with stripes)
      g.save(); g.clip();
      g.fillStyle = MUTE[0]; g.fillRect(-50, -206, 100, 86);
      g.fillStyle = 'rgba(255,240,210,0.6)'; for (let y = -170; y < -120; y += 16) g.fillRect(-50, y, 100, 5);
      g.strokeStyle = 'rgba(60,20,20,0.35)'; g.lineWidth = 1.2;
      for (let x = -40; x < 40; x += 6) for (let y = -200; y < -122; y += 7) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y + 4); g.lineTo(x + 6, y); g.stroke(); }
      g.restore();
      g.strokeStyle = SOL; g.lineWidth = 2.6; g.stroke();
      g.beginPath(); g.moveTo(-30, -200); g.quadraticCurveTo(-46, -180, -44, -148); g.lineTo(-34, -146); g.quadraticCurveTo(-34, -176, -26, -192); fs(g, MUTE[0]);
      g.beginPath(); g.moveTo(30, -200); g.quadraticCurveTo(46, -180, 44, -148); g.lineTo(34, -146); g.quadraticCurveTo(34, -176, 26, -192); fs(g, MUTE[0]);
      rr(g, -8, -222, 16, 14, 4); fs(g, '#3A2A20');
    });
    // old lamp on a crate near the dress form
    trunk(g, rightX - 100 * k, fy + 8 * k, 0.75 * k, '#5A6E4A', '#B8862E');
    const cat = { x: leftX + 10 * k, y: fy + 8 * k - 66 * 1.1 * k - 56 * 0.8 * k, s: 62 * k, coat: muteCoat(coatOf(4, 2), 0.15) };
    // warm fairy-light pool + vignette
    lightPool(g, W / 2, tby + 40 * k, Math.max(W, H) * 0.5, 'rgba(255,200,130,0.22)');
    vignette(g, W, H, 0.58, '14,10,28');
    return { R: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, panes, bulbs, beam: { cx, cy, r }, cat, bulb: { x: W * (por ? 0.22 : 0.3), y: tby + 16 * k } };
  },
  winLive(g, G, A, t) {
    // twinkle a few stars inside the round window
    const { R } = A, k = G.k;
    for (let i = 0; i < 8; i++) {
      const x = R.x + hash(i, 61) * R.w, y = R.y + hash(i, 62) * R.h * 0.6, a = 0.5 + 0.5 * Math.sin(t * (1.5 + hash(i, 63) * 2) + i);
      g.fillStyle = `rgba(255,250,230,${a})`;
      g.beginPath(); g.moveTo(x, y - 3 * k); g.lineTo(x + 0.8 * k, y); g.lineTo(x, y + 3 * k); g.lineTo(x - 0.8 * k, y); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x - 3 * k, y); g.lineTo(x, y + 0.8 * k); g.lineTo(x + 3 * k, y); g.lineTo(x, y - 0.8 * k); g.closePath(); g.fill();
    }
  },
  live(g, G, A, t) {
    const { k, H } = G;
    // dust motes in the moon beam
    const { cx, cy, r } = A.beam;
    for (let i = 0; i < 24; i++) {
      const p = (t * (0.02 + hash(i, 71) * 0.03) + hash(i, 72)) % 1;
      const y = cy + r * 0.4 + p * (H - cy - r * 0.4);
      const span = (r * 0.7) + (r * 1.2) * p;
      const x = cx - r * 0.3 + (r * 0.9) * p + (hash(i, 73) - 0.5) * span + Math.sin(t * 0.8 + i) * 6 * k;
      const a = Math.sin(p * Math.PI) * (0.4 + 0.4 * Math.sin(t * 2 + i));
      g.fillStyle = `rgba(230,236,255,${a.toFixed(3)})`; circ(g, x, y, (0.8 + hash(i, 74) * 1.4) * k); g.fill();
    }
    for (const b of A.bulbs) glowAt(g, b.x, b.y, 11 * k, 'rgba(255,214,130,0.55)', 0.55 + 0.45 * Math.sin(t * 2.4 + b.i * 1.7));
    // swinging bulb
    const L = 70 * k, sw = Math.sin(t * 1.6) * 0.22;
    const bx = A.bulb.x + Math.sin(sw) * L, by = A.bulb.y + Math.cos(sw) * L;
    g.strokeStyle = 'rgba(30,20,20,0.85)'; g.lineWidth = 1.4 * k; g.beginPath(); g.moveTo(A.bulb.x, A.bulb.y); g.lineTo(bx, by); g.stroke();
    glowAt(g, bx, by + 6 * k, 70 * k, 'rgba(255,214,140,0.45)', 0.9);
    g.save(); g.translate(bx, by); g.rotate(-sw);
    g.fillStyle = '#3A3036'; g.fillRect(-3.5 * k, -2 * k, 7 * k, 7 * k);
    g.fillStyle = '#FFF0C0'; g.strokeStyle = SOL; g.lineWidth = 1.2 * k; ell(g, 0, 11 * k, 7 * k, 8 * k); g.fill(); g.stroke();
    g.restore();
    const fl = ((t + 0.8) % 4) < 0.5 ? Math.sin(((t + 0.8) % 4) / 0.5 * Math.PI) : 0;
    drawSleepCat(g, A.cat.x, A.cat.y, A.cat.s, A.cat.coat, t, fl);
  },
};
function trunk(g, x, y, s, col, metal) {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 4, 0, 58, 6); g.fill();
    rr(g, -54, -48, 108, 48, 4); g.fillStyle = lin(g, 0, -48, 0, 0, [mix(col, '#FFFFFF', 0.12), col, mix(col, '#000000', 0.25)]); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-54, -48); g.quadraticCurveTo(0, -78, 54, -48); g.closePath(); g.fillStyle = mix(col, '#FFFFFF', 0.08); g.fill(); g.stroke();
    g.fillStyle = metal;
    for (const sx of [-34, 30]) { g.fillRect(sx, -64, 6, 64); g.strokeRect(sx, -64, 6, 64); }
    rr(g, -7, -52, 14, 14, 2); fs(g, metal);
    g.fillStyle = SOL; circ(g, 0, -45, 1.8); g.fill();
  });
}

// 6 · Starry Rooftop -----------------------------------------------------------------------------
WORLDS[6] = {
  bake(g, G) {
    const { W, H, k, fy, por } = G;
    g.fillStyle = lin(g, 0, 0, 0, H, ['#141C3F', '#232456', '#3A2B6B']); g.fillRect(0, 0, W, H);
    // milky band
    g.save(); g.globalCompositeOperation = 'screen';
    g.fillStyle = lin(g, 0, 0, W, H * 0.6, ['rgba(120,110,200,0)', 'rgba(150,140,230,0.16)', 'rgba(120,110,200,0)']);
    g.beginPath(); g.moveTo(0, H * 0.3); g.lineTo(W * 0.4, 0); g.lineTo(W * 0.75, 0); g.lineTo(0, H * 0.62); g.closePath(); g.fill();
    g.restore();
    stars(g, { x: 0, y: 0, w: W, h: fy * 0.8 }, Math.round(W * H / (2600 * Math.max(0.6, k * k * 0.6))), 23, k);
    moon(g, W * (por ? 0.82 : 0.86), H * 0.13, 26 * k, '#FFF1C2');
    // city silhouettes: far + near with lit windows
    const sky = fy - Math.min(H * 0.32, 220 * k);
    const city = (base, col, hMin, hMax, seed, lit) => {
      let x = -20 * k, i = 0;
      while (x < W + 20 * k) {
        const bw = (40 + hash(i, seed) * 70) * k, bh = (hMin + hash(seed, i) * (hMax - hMin)) * k;
        g.fillStyle = col; g.fillRect(x, base - bh, bw, bh + 4 * k);
        if (hash(i, seed + 1) > 0.65) { g.fillRect(x + bw * 0.4, base - bh - 14 * k, 4 * k, 14 * k); }
        if (hash(i, seed + 2) > 0.7) { g.beginPath(); g.moveTo(x, base - bh); g.lineTo(x + bw / 2, base - bh - 20 * k); g.lineTo(x + bw, base - bh); g.fill(); }
        if (lit) {
          for (let wy = base - bh + 10 * k; wy < base - 8 * k; wy += 16 * k) for (let wx = x + 8 * k; wx < x + bw - 10 * k; wx += 14 * k) {
            if (hash((wx / k) | 0, (wy / k) | 0) > 0.62) { g.fillStyle = hash((wy / k) | 0, (wx / k) | 0) > 0.5 ? 'rgba(255,214,130,0.85)' : 'rgba(255,240,190,0.6)'; g.fillRect(wx, wy, 6 * k, 8 * k); }
          }
          g.fillStyle = col;
        }
        x += bw + (2 + hash(i, seed + 3) * 8) * k; i++;
      }
    };
    city(sky + 40 * k, '#2A2558', 60, 150, 81, false);
    city(sky + 90 * k, '#1C1A40', 50, 130, 91, true);
    // parapet + roof deck
    g.fillStyle = lin(g, 0, sky + 80 * k, 0, H, ['#4A3A5E', '#3A2C4C', '#2A2038']); g.fillRect(0, sky + 86 * k, W, H);
    // roof tiles (deck)
    g.strokeStyle = 'rgba(15,10,25,0.35)'; g.lineWidth = 1.4 * k;
    for (let y = fy; y < H; y += 18 * k) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = ((y / k) % 2) * 15 * k; x < W; x += 30 * k) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 18 * k); g.stroke(); } }
    // parapet wall
    const py = sky + 86 * k;
    g.fillStyle = '#5A4870'; g.fillRect(0, py, W, fy - py);
    g.strokeStyle = 'rgba(20,14,30,0.45)'; g.lineWidth = 1.4 * k;
    for (let y = py; y < fy; y += 14 * k) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = (((y - py) / (14 * k)) % 2) * 16 * k; x < W; x += 32 * k) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 14 * k); g.stroke(); } }
    g.fillStyle = '#6E5A86'; g.fillRect(0, py - 8 * k, W, 10 * k); g.strokeStyle = SOL; g.lineWidth = 2 * k; g.strokeRect(-2, py - 8 * k, W + 4, 10 * k);
    g.fillStyle = 'rgba(10,6,20,0.3)'; g.fillRect(0, fy, W, 5 * k);
    // chimney (left) with the cat
    const chx = Math.min(W * 0.12, 80 * k + 10), chTop = py - 120 * k;
    P(g, chx, py, k, g => {
      rr(g, -32, -120, 64, 120, 2); fs(g, '#8A4A3E');
      g.strokeStyle = 'rgba(40,15,15,0.5)'; g.lineWidth = 1.2;
      for (let y = -112; y < 0; y += 10) { g.beginPath(); g.moveTo(-32, y); g.lineTo(32, y); g.stroke(); for (let x = -32 + ((y / 10) % 2 ? 0 : 8); x < 32; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 10); g.stroke(); } }
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      rr(g, -38, -130, 76, 14, 2); fs(g, '#6E3A30');
    });
    // string lights zig-zag across the top
    const runs = [[-10, py * 0.25 + 20 * k, W * 0.5, py * 0.12 + 12 * k], [W * 0.5, py * 0.12 + 12 * k, W + 10, py * 0.25 + 20 * k]];
    const bulbs = [];
    for (const [x0, y0, x1, y1] of runs) {
      const n = Math.max(6, Math.round((x1 - x0) / (30 * k)));
      g.strokeStyle = 'rgba(10,8,20,0.85)'; g.lineWidth = 1.4 * k;
      const sag = 26 * k;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1); g.stroke();
      for (let i = 0; i < n; i++) { const p = (i + 0.5) / n; const x = x0 + (x1 - x0) * p, y = y0 + (y1 - y0) * p + sag * 4 * p * (1 - p) + 4 * k; bulbs.push({ x, y, i: bulbs.length }); }
    }
    drawBulbs(g, bulbs, k, ['#FFD27A', '#FF9E8E', '#9FE0D0', '#FFE9B0']);
    // telescope (right), planters (left/right), blanket fort (centre-right)
    const rightX = Math.max(W * 0.84, W - 90 * k);
    P(g, rightX, fy + 4 * k, k, g => {
      g.fillStyle = SH; ell(g, 3, 0, 36, 5); g.fill();
      g.strokeStyle = SOL; g.lineWidth = 3.4;
      for (const sd of [-1, 0.2, 1]) { g.beginPath(); g.moveTo(0, -74); g.lineTo(sd * 30, 0); g.stroke(); }
      g.strokeStyle = '#C9CDD6'; g.lineWidth = 1.8;
      for (const sd of [-1, 0.2, 1]) { g.beginPath(); g.moveTo(0, -74); g.lineTo(sd * 30, 0); g.stroke(); }
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      g.save(); g.translate(0, -78); g.rotate(-0.6);
      rr(g, -40, -9, 92, 18, 5); g.fillStyle = lin(g, 0, -9, 0, 9, ['#E8B04A', '#B8822E']); g.fill(); g.stroke();
      rr(g, 46, -12, 14, 24, 3); fs(g, '#7A4A9A');
      rr(g, -52, -6, 14, 12, 2); fs(g, '#3A2C4C');
      g.restore();
      circ(g, 0, -76, 5); fs(g, '#3A2C4C');
    });
    planter(g, rightX - 110 * k, fy + 6 * k, k, ['#E86A6A', '#F2C24A', '#E89ACA']);
    planter(g, Math.max(chx + 90 * k, W * 0.2), fy + 6 * k, k, ['#F2C24A', '#9FD3E8', '#E86A6A']);
    // blanket fort in the middle-left
    const bfx = W * 0.5 - Math.min(W * 0.26, 200 * k);
    P(g, bfx, fy + 10 * k, k, g => {
      g.fillStyle = SH; ell(g, 4, 0, 80, 8); g.fill();
      // poles
      g.strokeStyle = WALNUT_D; g.lineWidth = 4; g.beginPath(); g.moveTo(-66, 0); g.lineTo(0, -120); g.lineTo(66, 0); g.stroke();
      g.strokeStyle = SOL; g.lineWidth = 2.6;
      // quilt
      g.beginPath(); g.moveTo(-72, 0); g.lineTo(-4, -116); g.lineTo(4, -116); g.lineTo(72, 0); g.closePath();
      g.save(); g.clip();
      const qc = ['#B5543E', '#E2A64E', '#5E8F86', '#7A5A9C', '#E9D6A8', '#4E6FA8'];
      for (let r = 0; r < 8; r++) for (let c = -5; c < 5; c++) { g.fillStyle = qc[(r * 3 + c + 10) % qc.length]; g.fillRect(c * 16, -120 + r * 16, 16, 16); }
      g.strokeStyle = 'rgba(255,240,210,0.35)'; g.lineWidth = 1; g.setLineDash([3, 3]);
      for (let r = 0; r < 8; r++) { g.beginPath(); g.moveTo(-80, -120 + r * 16); g.lineTo(80, -120 + r * 16); g.stroke(); }
      g.setLineDash([]);
      g.restore();
      g.stroke();
      // opening with warm glow
      g.beginPath(); g.moveTo(-26, 0); g.quadraticCurveTo(0, -78, 26, 0); g.closePath();
      g.fillStyle = rad(g, 0, -20, 2, 50, ['#FFE7A8', '#E8A04A', '#6A3A2A']); g.fill(); g.stroke();
      // lantern + pillows
      rr(g, -7, -26, 14, 20, 3); fs(g, '#FFE9A0');
      ell(g, -46, -8, 18, 9); fs(g, '#E9D6A8'); ell(g, 48, -8, 16, 8); fs(g, '#9FD3C8');
    });
    const fort = { x: bfx, y: fy + 10 * k - 16 * k };
    // fireflies anchor near the planters; warm pools under the string lights
    for (const b of bulbs) if (b.i % 3 === 0) lightPool(g, b.x, b.y + 30 * k, 90 * k, 'rgba(255,200,120,0.12)');
    lightPool(g, fort.x, fort.y, 220 * k, 'rgba(255,200,120,0.3)');
    vignette(g, W, H, 0.45, '8,8,26');
    const cat = { x: chx, y: chTop - 10 * k + 0 * k, s: 60 * k, coat: catCoat('black') };
    return { R: { x: 0, y: 0, w: W, h: py - 8 * k }, panes: [{ x: 0, y: 0, w: W, h: py - 8 * k }], bulbs, cat, fort };
  },
  winLive(g, G, A, t) {
    const { R } = A, k = G.k;
    // twinkles
    for (let i = 0; i < 26; i++) {
      const x = R.x + hash(i, 101) * R.w, y = R.y + hash(i, 102) ** 1.4 * R.h * 0.8;
      const a = Math.max(0, Math.sin(t * (1.2 + hash(i, 103) * 2.5) + i * 1.9));
      if (a < 0.2) continue;
      g.fillStyle = `rgba(255,250,230,${(a * 0.9).toFixed(3)})`;
      const s = (2 + hash(i, 104) * 2.5) * k * a;
      g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.25, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.25, y); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x - s, y); g.lineTo(x, y + s * 0.25); g.lineTo(x + s, y); g.lineTo(x, y - s * 0.25); g.closePath(); g.fill();
    }
    // shooting star every 10 s
    const c = t % 10;
    if (c < 0.9) {
      const p = c / 0.9, x0 = R.x + R.w * 0.15, y0 = R.y + R.h * 0.12;
      const x = x0 + p * R.w * 0.5, y = y0 + p * R.h * 0.25;
      g.strokeStyle = lin(g, x - R.w * 0.12, y - R.h * 0.06, x, y, ['rgba(255,255,255,0)', `rgba(255,250,220,${(1 - p).toFixed(3)})`]);
      g.lineWidth = 2.4 * k; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - R.w * 0.12, y - R.h * 0.06); g.lineTo(x, y); g.stroke();
      g.fillStyle = `rgba(255,255,240,${(1 - p).toFixed(3)})`; circ(g, x, y, 2.4 * k); g.fill();
    }
  },
  live(g, G, A, t) {
    const k = G.k;
    for (const b of A.bulbs) glowAt(g, b.x, b.y, 14 * k, 'rgba(255,214,140,0.5)', 0.6 + 0.4 * Math.sin(t * 1.8 + b.i * 2.1));
    glowAt(g, A.fort.x, A.fort.y - 8 * k, 46 * k, 'rgba(255,210,120,0.4)', 0.8 + 0.12 * Math.sin(t * 6));
    // cat on the chimney looking at the stars
    sitCat(g, A.cat.x, A.cat.y, A.cat.s, A.cat.coat, t, { seed: 3, look: [1, -3] });
    const ey = A.cat.y - A.cat.s * 0.62;
    glowAt(g, A.cat.x - A.cat.s * 0.09, ey, A.cat.s * 0.1, 'rgba(255,220,80,0.5)', 0.8);
    glowAt(g, A.cat.x + A.cat.s * 0.13, ey, A.cat.s * 0.1, 'rgba(255,220,80,0.5)', 0.8);
    // fireflies over the planters
    for (let i = 0; i < 8; i++) {
      const x = A.fort.x + Math.sin(t * 0.5 + i * 2.3) * 160 * k + i * 30 * k, y = A.fort.y - 60 * k + Math.cos(t * 0.7 + i) * 30 * k;
      glowAt(g, x, y, 7 * k, 'rgba(220,255,140,0.7)', 0.5 + 0.5 * Math.sin(t * 3 + i * 1.1));
    }
  },
};
function planter(g, x, y, s, flowers) {
  P(g, x, y, s, g => {
    g.fillStyle = SH; ell(g, 3, 0, 46, 5); g.fill();
    // stems + leaves
    for (let i = 0; i < 7; i++) {
      const fx = -34 + i * 11, fh = 30 + hash(i, (x | 0)) * 26;
      g.strokeStyle = '#4E7A44'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(fx, -26); g.quadraticCurveTo(fx + 4, -26 - fh * 0.5, fx, -26 - fh); g.stroke();
      g.fillStyle = '#5E8A4E'; ell(g, fx + 5, -26 - fh * 0.45, 6, 3, -0.6); g.fill();
      g.fillStyle = flowers[i % flowers.length]; g.strokeStyle = SOL; g.lineWidth = 1.4;
      for (let p = 0; p < 5; p++) { const a = p * TAU / 5; circ(g, fx + Math.cos(a) * 4, -26 - fh + Math.sin(a) * 4, 3.4); g.fill(); }
      g.fillStyle = '#FFE9A0'; circ(g, fx, -26 - fh, 2.4); g.fill();
    }
    g.strokeStyle = SOL; g.lineWidth = 2.6;
    rr(g, -44, -30, 88, 30, 3); g.fillStyle = lin(g, 0, -30, 0, 0, ['#9A6A45', '#6B4329']); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(40,20,10,0.4)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-44, -15); g.lineTo(44, -15); g.stroke();
  });
}

// ------------------------------------------------------------------ title extras (seasonal foreground)
function titleExtras(g, G, world) {
  const { W, H, k, fy } = G;
  // soft spotlight behind the logo area
  lightPool(g, W / 2, H * 0.16, Math.max(W, H) * 0.42, world === 2 ? 'rgba(255,170,90,0.2)' : 'rgba(255,230,180,0.28)');
  const s = k * 1.05;
  if (world === 2) {
    // pumpkin piles + candles + yarn spilling in both bottom corners
    for (const sd of [-1, 1]) {
      const bx = sd < 0 ? 40 * s : W - 40 * s;
      jackO(g, bx + sd * -40 * s, fy + 34 * s, 1.5 * s);
      pumpkin(g, bx + sd * 30 * s, fy + 46 * s, 1.1 * s, '#D9702E');
      pumpkin(g, bx + sd * -100 * s, fy + 52 * s, 0.8 * s, '#EFA64A', '#7A6A3A');
      yarnBall(g, bx + sd * -150 * s, fy + 40 * s, 13 * s, MUTE[sd < 0 ? 4 : 1]);
    }
  } else {
    for (const sd of [-1, 1]) {
      const bx = sd < 0 ? 50 * s : W - 50 * s;
      for (let i = 0; i < 14; i++) mapleLeaf(g, bx + sd * (hash(i, 5) * 120 - 20) * s, fy + (30 + hash(i, 6) * 30) * s, 1.1 * s, hash(i, 7) * 6, ['#D9572F', '#E89A3E', '#C24A2E', '#F2B04A'][i % 4], 'rgba(90,30,10,0.3)');
      pumpkin(g, bx + sd * -20 * s, fy + 50 * s, 1.1 * s, '#E2843A');
      yarnBall(g, bx + sd * -90 * s, fy + 50 * s, 14 * s, MUTE[sd < 0 ? 0 : 2]);
    }
  }
}

// ------------------------------------------------------------------ bake cache + public API
const cache = new Map(); // key → { cv, A, G }
function getBake(W, H, world, dpr, variant) {
  const key = [world, Math.round(W), Math.round(H), dpr.toFixed(2), variant || ''].join('|');
  let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); return e; } // LRU touch
  const G = geom(W, H);
  const cv = mkCanvas(Math.ceil(W * dpr), Math.ceil(H * dpr)), cg = cv.getContext('2d');
  cg.setTransform(dpr, 0, 0, dpr, 0, 0);
  const Wd = WORLDS[world] || WORLDS[1];
  const A = Wd.bake(cg, G, dpr, variant);
  if (variant === 'title') titleExtras(cg, G, world);
  e = { cv, A, G, Wd };
  cache.set(key, e);
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  return e;
}
function clipPanes(g, panes) {
  g.beginPath();
  for (const p of panes) { if (p.circle) { g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, TAU); } else g.rect(p.x, p.y, p.w, p.h); }
  g.clip();
}
function drawWorld(g, W, H, world, t, variant) {
  if (!(W > 0 && H > 0)) return null;
  const dpr = dprOf(g);
  const e = getBake(W, H, world, dpr, variant);
  g.drawImage(e.cv, 0, 0, W, H);
  g.save(); clipPanes(g, e.A.panes); e.Wd.winLive(g, e.G, e.A, t); g.restore();
  g.save(); e.Wd.live(g, e.G, e.A, t); g.restore();
  return e;
}

/** Full-screen layered scene for S.world (or the seasonal title scene on the title screen). */
export function drawScene(g, S) {
  if (!S || !(S.W > 0)) return;
  if (S.screen === 'title') { drawTitleScene(g, S.W, S.H, S.T || 0, S.world === 2 ? 'pumpkin' : 'den'); return; }
  drawWorld(g, S.W, S.H, clamp(S.world | 0 || 1, 1, 6), S.T || 0, '');
}

/** Seasonal title backdrop: 'pumpkin' (Pumpkin Night) | 'den' (Autumn Den). Background only. */
export function drawTitleScene(g, W, H, t, season) {
  drawWorld(g, W, H, season === 'pumpkin' ? 2 : 1, t || 0, 'title');
}

/** Map strip: a mini version of a world scene filling rect (clipped). */
export function drawRoomVignette(g, rect, world, t) {
  if (!rect || !(rect.w > 2 && rect.h > 2)) return;
  g.save();
  g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip();
  g.translate(rect.x, rect.y);
  drawWorld(g, rect.w, rect.h, clamp(world | 0 || 1, 1, 6), t || 0, 'map');
  g.restore();
}

// ------------------------------------------------------------------ OG (§12.2), 1200×630 design space
export function drawOG(g, S) {
  const W = S.W, H = S.H, t = S.T || 0;
  drawWorld(g, W, H, 2, t, 'og');
  const sc = Math.min(W / 1200, H / 630), ox = (W - 1200 * sc) / 2, oy = (H - 630 * sc) / 2;
  g.save(); g.translate(ox, oy); g.scale(sc, sc);
  // legibility scrim on the left
  g.fillStyle = lin(g, 0, 0, 640, 0, [[0, 'rgba(22,14,36,0.62)'], [0.75, 'rgba(22,14,36,0.3)'], [1, 'rgba(22,14,36,0)']]);
  g.fillRect(-ox / sc - 2, -oy / sc - 2, 640 + ox / sc + 2, 630 + 2 * oy / sc + 4);

  // ---- right: the L20 board tilted −4°, ~40 % cleared
  const sess = S.sess;
  let level = sess && sess.level && sess.level.strands ? sess.level : null;
  let removed = null;
  if (level && sess.st && sess.st.removed != null) { removed = []; for (let i = 0; i < level.strands.length; i++) if ((sess.st.removed >>> i) & 1) removed.push(i); }
  if (!level) { try { level = getLevel(20); } catch (e) { level = null; } }
  let mb = null;
  const bc = { x: 905, y: 392 };
  g.save();
  g.translate(bc.x, bc.y); g.rotate(-4 * Math.PI / 180);
  if (level) mb = drawMiniBoard(g, { x: -255, y: -200, w: 510, h: 430 }, level, t, removed && removed.length ? { removed, kitten: false } : { cleared: 0.4, kitten: false });
  // the kitten mid-leap with 3 hearts
  if (mb) {
    const kit = mb.box.kit, s = kit.s * 1.45;
    const coat = coatOf(1, 3);
    drawCat(g, kit.x, kit.y - s * 0.42, s, { ...coat, ears: 'up', eyes: 'happy', mouth: 'open', arms: 'up', tail: 0.9, rot: -0.12, sx: 0.94, sy: 1.08, blush: true, t });
    g.fillStyle = 'rgba(255,244,228,0.7)';
    for (const [dx, dy, r] of [[-0.55, -0.15, 0.05], [0.6, -0.05, 0.04], [-0.42, 0.05, 0.03]]) { circ(g, kit.x + dx * s, kit.y + dy * s, r * s); g.fill(); }
    drawHeart(g, kit.x - s * 0.62, kit.y - s * 1.28, s * 0.15, 1);
    drawHeart(g, kit.x + s * 0.6, kit.y - s * 1.42, s * 0.18, 1);
    drawHeart(g, kit.x + s * 0.05, kit.y - s * 1.78, s * 0.13, 1);
  }
  g.restore();

  // ---- rack above the board: shelf, tomato spool (winding), teal spool, Kitty mid-swat
  const shelfY = 168, sx0 = 640, sx1 = 1150;
  g.fillStyle = 'rgba(20,10,20,0.35)'; rr(g, sx0 + 5, shelfY + 6, sx1 - sx0, 16, 7); g.fill();
  g.fillStyle = lin(g, 0, shelfY, 0, shelfY + 16, [WALNUT_L, WALNUT_D]); rr(g, sx0, shelfY, sx1 - sx0, 16, 7); g.fill();
  g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
  const sp = [{ x: 860, c: 0, shown: 2, h: 112 }, { x: 990, c: 1, shown: 1, h: 112 }, { x: 1100, c: 2, shown: 0, h: 78 }];
  for (const p of sp) drawSpool(g, p.x, shelfY - p.h / 2 - 2, p.h, p.c, p.shown, 3, { pips: p.h > 100, spin: t * 4, want: p.c === 0 ? 0.8 : 0 });
  drawKitty(g, 704, shelfY, 146, 'swat', 0.125, 'pumpkin');
  // ---- a tomato strand mid-flight from the board up to the tomato spool
  const sw = mb ? Math.max(9, mb.B.sw) : 12, u = mb ? mb.B.unit : 44;
  const fx0 = 800, fy0 = 300, fx1 = 858, fy1 = shelfY - 70;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const p = i / 24;
    const x = fx0 + (fx1 - fx0) * p + Math.sin(p * Math.PI) * -46, y = fy0 + (fy1 - fy0) * p - Math.sin(p * Math.PI) * 30;
    pts.push([x, y]);
  }
  drawYarnRun(g, pts, 0, sw, u, { glow: 1 });
  g.fillStyle = 'rgba(255,244,228,0.85)';
  for (let i = 0; i < 5; i++) { const a = i * 1.3; circ(g, fx1 + Math.cos(a) * 26, fy1 + 6 + Math.sin(a) * 18, 3.5 - i * 0.4); g.fill(); }

  // ---- left: logo, tagline, PLAY FREE pill
  const lx = 276;
  g.save();
  g.lineJoin = 'round';
  const logo = (s, y, col, rot) => {
    g.save(); g.translate(lx, y); g.rotate(rot);
    g.font = `120px ${FONT_T}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 26; g.strokeStyle = INK; g.strokeText(s, 4, 8);
    g.fillStyle = INK; g.fillText(s, 4, 8);
    g.lineWidth = 18; g.strokeText(s, 0, 0);
    g.fillStyle = col; g.fillText(s, 0, 0);
    g.restore();
  };
  logo('Knot', 132, CREAM, -0.04);
  logo('Kitty', 250, '#FFB23F', -0.04);
  // yarn swoosh under the logo
  const sw2 = [[110, 325], [200, 336], [300, 316], [420, 330]];
  g.strokeStyle = INK; g.lineWidth = 18; g.lineCap = 'round';
  g.beginPath(); g.moveTo(sw2[0][0], sw2[0][1]); g.bezierCurveTo(sw2[1][0], sw2[1][1], sw2[2][0], sw2[2][1], sw2[3][0], sw2[3][1]); g.stroke();
  g.strokeStyle = TOMATO; g.lineWidth = 10; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.setLineDash([8, 10]); g.stroke(); g.setLineDash([]);
  yarnBall(g, 442, 326, 20, TOMATO);
  text(g, 'Pull the yarn.', lx, 392, 36, { font: FONT_B, weight: 800, color: CREAM, stroke: INK, strokeW: 9 });
  text(g, 'Free the kitten.', lx, 438, 36, { font: FONT_B, weight: 800, color: CREAM, stroke: INK, strokeW: 9 });
  // pill
  const pw = 250, ph = 70, px = lx - pw / 2, py = 486;
  g.fillStyle = TOMATO_D; rr(g, px, py + 7, pw, ph, ph / 2); g.fill();
  g.fillStyle = lin(g, 0, py, 0, py + ph, ['#F25A4C', TOMATO]); rr(g, px, py, pw, ph, ph / 2); g.fill();
  g.strokeStyle = INK; g.lineWidth = 5; rr(g, px, py, pw, ph + 7, ph / 2); g.stroke();
  text(g, 'PLAY FREE', lx, py + ph / 2 + 2, 40, { color: CREAM, stroke: INK, strokeW: 8 });
  g.restore();
  g.restore();
}
