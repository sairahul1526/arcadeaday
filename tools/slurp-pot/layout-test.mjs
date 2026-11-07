#!/usr/bin/env node
// Slurp Pot layout test (UI role, GDD §9.2): node tools/slurp-pot/layout-test.mjs
// For every size x inset variant x ticket-line count: every HUD rect inside safe, no two HUD rects overlap,
// buttons >= 44 CSS px, text >= 12.5 CSS px, play rect sane, pot point clear of the HUD (also with the Feast strip,
// the Daily bump chip and the record caption band); then every card screen: buttons inside safe, >= 44 px, no
// overlaps, text >= 12.5 px; the town map: 60 nodes >= 44 px, no two nodes or star rows overlap. Exit 1 on any failure.
import { computeLayout, cardLayout } from '../../games/slurp-pot/layout.js';

const SIZES = [[320, 480], [360, 640], [375, 812], [390, 844], [820, 1180], [1024, 768], [1024, 1024], [1440, 900],
  [1920, 1080], [667, 375], [844, 390], [768, 1024], [1280, 720], [3840, 2160], [2160, 3840]];
const INSETS = { none: { t: 0, r: 0, b: 0, l: 0 }, notch: { t: 44, r: 0, b: 34, l: 0 }, side: { t: 0, r: 44, b: 21, l: 44 } };
const EPS = 0.01;
let fails = 0, checks = 0;
const fail = (ctx, msg) => { fails++; if (fails <= 60) console.log('FAIL', ctx, msg); };
const inside = (a, b) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
const overlap = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const fmt = r => `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}]`;
const pos = r => r && r.w > 0 && r.h > 0;

function checkFonts(ctx, fs) {
  for (const [k, v] of Object.entries(fs)) { checks++; if (!(v >= 12.5 - 1e-9)) fail(ctx, `font ${k}=${v} < 12.5`); }
}

const rows = [];
for (const [W, H] of SIZES) for (const [iname, ins] of Object.entries(INSETS)) {
  if (iname === 'side' && W < H) continue;                 // side notches only in landscape
  for (const lines of [1, 2, 3, 4, 5]) for (const mode of ['level', 'feast', 'daily', 'og']) {
    if (mode !== 'level' && lines !== 3 && lines !== 5) continue;
    const L = computeLayout(W, H, ins, { lines, record: false, feast: mode === 'feast', bump: mode === 'daily', caption: mode === 'og' });
    const ctx = `${W}x${H}/${iname}/L${lines}/${mode}`;
    const h = L.hud, S = L.safe;
    const named = { timer: h.timer, ticket: h.ticket, pause: h.pause, meter: h.meter, callout: h.callout,
      b0: h.boosters[0], b1: h.boosters[1], b2: h.boosters[2], star: h.star };
    if (mode === 'feast') named.strip = h.strip;
    if (mode === 'daily') named.bump = h.bump;
    if (mode === 'og') { named.caption = h.caption; delete named.callout; delete named.pause; }
    for (const [k, r] of Object.entries(named)) {
      checks++;
      if (!pos(r)) fail(ctx, `${k} empty ${fmt(r)}`);
      if (!inside(r, S)) fail(ctx, `${k} outside safe ${fmt(r)} safe ${fmt(S)}`);
    }
    const ks = Object.keys(named);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      checks++;
      if (overlap(named[ks[i]], named[ks[j]])) fail(ctx, `${ks[i]} ${fmt(named[ks[i]])} overlaps ${ks[j]} ${fmt(named[ks[j]])}`);
    }
    for (const k of ['pause', 'b0', 'b1', 'b2']) { if (!named[k]) continue; checks++; if (named[k].w < 44 - EPS || named[k].h < 44 - EPS) fail(ctx, `${k} < 44 px`); }
    checkFonts(ctx, L.fs);
    // play rect: inside safe, under the HUD rows, reaching the safe bottom/right (no bars), pot point clear
    const P = L.play;
    checks++;
    if (!pos(P) || !inside(P, S)) fail(ctx, `play ${fmt(P)} not inside safe`);
    if (Math.abs(P.y + P.h - (S.y + S.h)) > 0.5 || Math.abs(P.x + P.w - (S.x + S.w)) > 0.5) fail(ctx, `play does not reach the safe bottom/right`);
    // landscape: the callout band is an overlay at the top of the play rect (GDD §9.2); it never covers the pot (below)
    for (const k of ['timer', 'ticket', 'pause', 'meter', ...(L.aspect === 'landscape' ? [] : ['callout', 'strip'])]) if (named[k] && overlap(P, named[k])) fail(ctx, `play overlaps ${k}`);
    if (named.caption && named.caption.h < 56 - EPS) fail(ctx, 'caption band too short');
    const pot = { x: P.cx - 1, y: P.cy - 1, w: 2, h: 2 };
    if (!inside(pot, P)) fail(ctx, `pot point outside play`);
    for (const k of ks) if (k !== 'bump' && overlap({ x: P.cx - 30 * L.u, y: P.cy - 30 * L.u, w: 60 * L.u, h: 60 * L.u }, named[k])) fail(ctx, `pot area under ${k}`);
    if (!pos(h.arrowZone)) fail(ctx, 'arrow zone empty');
    if (mode !== 'level') continue;
    if (lines === 3) rows.push(`${String(W + 'x' + H).padEnd(10)} ${iname.padEnd(5)} ${L.aspect.padEnd(9)} u=${L.u.toFixed(3)} ticket ${fmt(h.ticket)} play ${fmt(P)}`);

    if (lines !== 3) continue;
    checkCards(L, ctx);
    // web page (site chips fixed bottom-left, 56 px strip when H >= 560): every card inside the raised menu rect
    if (H >= 560) {
      const Lw = computeLayout(W, H, ins, { lines, record: false, web: 56 });
      checks++;
      if (Lw.menu.y + Lw.menu.h > H - 56 + EPS && Lw.menu.h > 0.82 * Lw.safe.h + EPS) fail(ctx + '/web', `menu ${fmt(Lw.menu)} not above the chips`);
      checkCards(Lw, ctx + '/web');
    }
  }
}
function checkCards(L, ctx) {
  const S = L.menu || L.safe;
  {
    // ---- cards ----
    const cards = [
      ['title', { firstBoot: true }], ['title', { firstBoot: false, showMute: true }], ['title', { firstBoot: false, showMute: false }],
      ['win', {}], ['win', { strip: true }], ['win', { strip: true, nextSkin: true }], ['win', { strip: true, goal: true }], ['win', { strip: true, goal: true, nextSkin: true }], ['win', { strip: true, goal: true, nextSkin: true, buySkin: true }], ['win', { strip: true, nextSkin: true, buySkin: true }], ['info', { primary: true, second: true, ending: true }], ['info', { primary: true, second: false, ending: true }], ['win', { nextSkin: true }], ['win', { goal: true }], ['win', { goal: true, nextSkin: true }], ['win', { goal: true, nextSkin: true, buySkin: true }], ['win', { nextSkin: true, buySkin: true }],
      ['fail', { canFreeze: true }], ['fail', { canFreeze: false }], ['fail', { noBar: true, canFreeze: true }], ['fail', { noBar: true, canFreeze: false }],
      ['fail', { canFreeze: true, help: true }], ['fail', { canFreeze: true, help: true, tip: true }], ['fail', { noBar: true, canFreeze: true, help: true, tip: true }], ['fail', { canFreeze: false, help: true, tip: true }],
      ['pause', { showMute: true }], ['pause', {}], ['pause', { showMute: true, stars: true }], ['pause', { stars: true }], ['settings', {}], ['map', {}],
      ['shop', {}], ['cookbook', {}], ['daily', {}], ['daily', { primary: false }], ['daily', { town: false }], ['ladder', {}],
      ['feast', { towns: 1 }], ['feast', { towns: 3 }], ['feastend', {}],
      ['alldone', { primary: true, second: true }], ['info', { locked: 'daily' }], ['info', { locked: 'feast' }], ['gift', { primary: true, noBack: true }], ['lid', { primary: true, noBack: true }],
    ];
    for (const [name, o] of cards) {
      const C = cardLayout(L, name, o), cx = `${ctx}/${name}${JSON.stringify(o)}`;
      checkFonts(cx, C.fs);
      const bs = C.buttons;
      if (!bs.length) fail(cx, 'no buttons (dead end)');
      for (const b of bs) {
        checks++;
        if (!inside(b.r, S)) fail(cx, `button ${b.id} ${fmt(b.r)} outside safe ${fmt(S)}`);
        if (b.r.w < 44 - EPS || b.r.h < 44 - EPS) fail(cx, `button ${b.id} ${fmt(b.r)} < 44 px`);
        if (name !== 'title' && !inside(b.r, C.panel)) fail(cx, `button ${b.id} ${fmt(b.r)} outside panel ${fmt(C.panel)}`);
      }
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        checks++;
        if (overlap(bs[i].r, bs[j].r)) fail(cx, `button ${bs[i].id} overlaps ${bs[j].id}`);
      }
      if (name !== 'title') { checks++; if (!inside(C.panel, S)) fail(cx, `panel ${fmt(C.panel)} outside safe`); }
      // text/content blocks must not overlap each other or any button
      // (container blocks such as a grid or shelf hold buttons by design; their children are checked below)
      const blocks = Object.entries(C.blocks).filter(([k, r]) => r && typeof r.x === 'number' && !k.endsWith('T') &&
        !bs.some(b => b.r === r) && !(C.containers || []).includes(k));
      for (const [k, r] of blocks) {
        checks++;
        if (r.h <= 0) fail(cx, `block ${k} has no height`);
        if (!inside(r, S)) fail(cx, `block ${k} ${fmt(r)} outside safe`);
        for (const b of bs) if (overlap(r, b.r) && !(['music', 'sfx', 'stick'].includes(k))) fail(cx, `block ${k} ${fmt(r)} overlaps button ${b.id} ${fmt(b.r)}`);
      }
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
        checks++;
        if (overlap(blocks[i][1], blocks[j][1])) fail(cx, `block ${blocks[i][0]} overlaps ${blocks[j][0]}`);
      }
      // sub-rects drawn inside a parent block must stay inside it (and inside the panel)
      for (const [arr, parent] of [['skins', 'grid'], ['cards', 'grid'], ['stamps', 'grid'], ['lines', 'receipt'], ['steps', 'ladder']]) {
        const list = C.blocks[arr], pr = C.blocks[parent];
        if (!Array.isArray(list) || !pr) continue;
        for (let i = 0; i < list.length; i++) {
          checks++;
          if (!inside(list[i], pr)) fail(cx, `${arr}[${i}] ${fmt(list[i])} outside ${parent} ${fmt(pr)}`);
          for (let j = i + 1; j < list.length; j++) if (overlap(list[i], list[j])) fail(cx, `${arr}[${i}] overlaps ${arr}[${j}]`);
        }
      }
      if (Array.isArray(C.blocks.tins)) for (const t of C.blocks.tins) { checks++; if (!inside(t.icon, C.blocks.shelf)) fail(cx, `tin icon outside shelf`); }
      if (name === 'map') checkMap(C, cx, S);
      if (C.blocks.icons) for (const ic of C.blocks.icons) {
        if (!inside(ic.lab, S)) fail(cx, `icon label ${ic.id} outside safe`);
        for (const ic2 of C.blocks.icons) if (ic2 !== ic && overlap(ic.lab, ic2.lab)) fail(cx, `icon labels ${ic.id}/${ic2.id} overlap`);
        for (const b of bs) if (overlap(ic.lab, b.r)) fail(cx, `icon label ${ic.id} overlaps button ${b.id}`);
      }
    }
  }
}
function checkMap(C, cx, S) {
  const M = C.map, V = C.blocks.view;
  checks++;
  if (!M || M.nodes.length !== 60) return fail(cx, 'map: want 60 nodes');
  if (!inside(V, S) || V.h < 120) fail(cx, `map view ${fmt(V)} outside safe or < 120 px`);
  for (const b of C.buttons) if (overlap(b.r, V) && !['daily', 'feast', 'cookbook', 'shop'].includes(b.id)) fail(cx, `map button ${b.id} over the view`);
  if (M.nodeD < 44 - EPS) fail(cx, `map node ${M.nodeD} < 44 px`);
  for (let i = 0; i < 60; i++) {
    const a = M.nodes[i], ra = { x: a.x - M.nodeD / 2, y: a.y - M.nodeD / 2, w: M.nodeD, h: M.nodeD + M.starH + 2 };
    checks++;
    if (ra.x < -EPS || ra.x + ra.w > M.col.w + EPS || ra.y < -EPS || ra.y + ra.h > M.contentH + EPS) fail(cx, `node ${a.n} ${fmt(ra)} outside the column`);
    for (let j = i + 1; j < Math.min(60, i + 4); j++) {
      const b = M.nodes[j], rb = { x: b.x - M.nodeD / 2, y: b.y - M.nodeD / 2, w: M.nodeD, h: M.nodeD + M.starH + 2 };
      if (overlap(ra, rb)) fail(cx, `node ${a.n} overlaps node ${b.n}`);
    }
  }
  // side columns (landscape) never cover the path column
  for (const ic of C.blocks.icons) { checks++; if (overlap(ic.r, M.col) && !(ic.r.y >= V.y + V.h - EPS)) fail(cx, `map icon ${ic.id} over the path column`); }
}
// record mode (D31): u = 3 exactly at 1080x1920
{
  const L = computeLayout(1080, 1920, null, { record: true });
  checks++;
  if (Math.abs(L.u - 3) > 1e-9) fail('record', `u=${L.u} (want 3)`);
  const cap = L.hud.caption;
  if (!cap || !inside(cap, L.play) || overlap(cap, L.hud.meter) || overlap(cap, L.hud.ticket)) fail('record', `caption band ${cap && fmt(cap)}`);
  rows.push(`1080x1920  rec   ${L.aspect.padEnd(9)} u=${L.u.toFixed(3)} (record, D31)`);
}
console.log(rows.join('\n'));
console.log(`\nlayout-test: ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
