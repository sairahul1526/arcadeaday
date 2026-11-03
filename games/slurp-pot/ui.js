// Slurp Pot: ui.js (UI role). Everything on the 2D `#ui` canvas (D2): HUD, cards, tutorial beats, ghost hand,
// stick visual, edge arrows, callouts. Geometry comes from layout.js; sim facts from logic.js (read only).
//
// API (GDD §13.3):
//   initUI(canvas, { meta, audio, layout, render, bus, input?, onAction? })
//   draw(state, w, dt)            state = game.js state(): { screen, mode, paused, level, daily, boosters, tutStep }
//   pointer(type, x, y) -> bool   type 'down'|'move'|'up'|'cancel', CSS px relative to the canvas
//   key(e) -> bool                Enter/Space = primary button, Esc = back/close/pause, P = pause, 1/2/3 = boosters
//   show(screen, data)            'win' {n, kind, stars, tLeft, chainBest, coins, newStars, gifts, chest, milestone, nextSkin}
//                                 'fail' {n, kind, why, progress, missing:[{kind,need,got}], canFreeze, freezeCost}
//                                 any other screen name: data optional
//   callout(id, icon, text, ms)   one at a time, queued by priority (id prefix tut > twist > gift > other)
//   rects() -> [{id, x, y, w, h, soft}]   live button rects (input.setBlockRects; soft = booster: a drag >= 8 px steers)
//   primaryButton() -> {x, y} | null
//   STR                           every player-facing string
//
// UI -> game actions (the GDD leaves this open): onAction(act, data) if given to initUI, else
// bus.emit('ui', { act, ...data }). Acts: play next retry replay map level{n} resume restart pause settings
// freeze booster{kind} daily feast screen{name} back mute{on} reset collect.

import P from '../shared/platform.js';
import { computeLayout, cardLayout, insets as safeInsets, setTicketLines } from './layout.js';
import { LOW_TIME, BOOST_UNLOCK, PRICES, LEVELS, DAILY_UNLOCK, FEAST_UNLOCK } from './consts.js';

// Optional sibling modules: the UI keeps drawing with local fallbacks until they load.
let LG = null, CAT = null;
import('./logic.js').then(m => { LG = m; }, () => {});
import('./catalog.js').then(m => { CAT = m; catIndex = null; }, () => {});

const C = {
  gold: '#F5B323', goldL: '#FFD86B', goldS: '#B9770E', stew: '#FF8A2A', stewHot: '#FFD36E', stewDeep: '#C4501A',
  ink: '#3A2418', paper: '#FFF6E3', paperS: '#EBD9B8', stamp: '#E5483B', go: '#4CC26A', glow: '#FFD34D',
  tomato: '#E8463A', tomatoD: '#B3322A', hot: '#FF2E1F', brass: '#D4A43F', brassL: '#F6DC8C', brassD: '#8C6420',
  dim: 'rgba(58,36,24,0.6)',
};
const FT = '"Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
const FB = 'Nunito, system-ui, sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const back = t => { t = clamp(t, 0, 1); const s = 1.7; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };

export const STR = {
  title: 'Slurp Pot', play: 'PLAY', playN: 'PLAY · Level {n}', next: 'NEXT', allDoneBtn: 'All done!', retry: 'RETRY',
  replay: 'Replay', map: 'Map', resume: 'Resume', restart: 'Restart', settings: 'Settings', paused: 'Paused',
  orderUp: 'ORDER UP!', serveIt: 'Serve it!', soClose: 'SO CLOSE!', almost: 'Almost!', outOfTime: 'Out of time!',
  spoiled: 'Spoiled!', nMore: '{n} more', freeze: '+10 s, keep cooking', freezeShort: '+10 s', timeLeft: '{t} left',
  bestChain: 'Best chain ×{n}', chainShort: '×{n}', coinsPlus: '+{n}', nextSkin: '{skin} in {n} coins',
  dragToMove: 'Drag to move', growToOpen: 'Grow to open', lidOn: 'Lid on! Go around', fasterStars: 'Faster = more',
  daily: 'Daily', feast: 'Feast', cookbook: 'Cookbook', cookbookShort: 'Book', shop: 'Shop', back: 'Back', done: 'Done',
  music: 'Music', sound: 'Sound', showStick: 'Show stick', reset: 'Reset progress', resetSure: 'Tap again to reset',
  credits: 'Slurp Pot · Arcade a Day', on: 'On', off: 'Off', unlocksAt: 'Unlocks at Level {n}',
  cookToday: "Cook today's order", startFeast: 'Start Feast', allDone: 'All 60 orders served!',
  dailyBody: 'A fresh order every day. Keep your streak!', dailyDone: 'Order served! Come back tomorrow.',
  feastBody: 'Serve as many orders as you can!', shopBody: 'New pots are on the way. Save your coins!',
  cookbookBody: 'Every order you serve gets a recipe card.', allDoneBody: 'Head chef! Try the Daily Order and the Feast.',
  picnic: 'Picnic Park', market: 'Market Street', harbour: 'Harbour', collect: 'Collect', gift: 'A gift!',
  giftBody: 'Find it in the spice tins on the side.', chestT: 'Town chest!', starBonus: 'Star bonus!',
  giftCoins: '+{n} coins', eachBooster: '{n} of each booster', levelLabel: 'L{n} · {name}', levelShort: 'L{n}', dailyLabel: 'Daily',
  feastLabel: 'Feast', mute: 'Sound', newBest: 'NEW BEST!', stars: '{n}', loading: 'Cooking…',
  magnet: 'Magnet', freezeB: 'Freeze', mega: 'Mega rim', needCoins: 'Needs {n} coins',
};
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o && o[k] != null ? o[k] : ''));
try { if (P && P.lang) console.info('[ui] lang', P.lang); } catch {}

// ---------- art (kie webp, drawn fallbacks) ----------
// DECISION: only ids whose webp is on disk are requested (a 404 is a console error, a shipping blocker). The UI role
//   re-syncs this list with games/slurp-pot/art/ when new art lands; anything missing uses the drawn fallback.
const ART = new Set(('boss-bakerycart boss-bakeryvan boss-bigsandwich boss-birthdaycake boss-cheesetower boss-foodtruck ' +
  'boss-fruitstall boss-hamper boss-icecreamkiosk boss-lighthouse boss-pizza boss-pizzaoven boss-popcorncart ' +
  'boss-snackboat boss-table boss-watermelon boss-weddingcake icon-chefhat icon-chest icon-clock icon-coin ' +
  'icon-cookbook icon-freeze icon-gift icon-ladle icon-lid icon-magnet icon-megarim icon-padlock icon-settings ' +
  'icon-star ing-apple ing-baguette ing-banana ing-broccoli ing-burger ing-cheese ing-cheesewheel ing-coconut ' +
  'ing-corn ing-cottoncandy ing-croissant ing-cupcake ing-donut ing-eggplant ing-fries ing-hotdog ing-icecream ' +
  'ing-jamjar ing-lemon ing-lollipop ing-orange ing-pineapple ing-pizzaslice ing-popcorn ing-pretzel ing-pumpkin ' +
  'ing-sandwich ing-strawberry ing-taco ing-tomato ing-waffle ing-watermelon map-harbour map-market map-picnic ' +
  'pot-happy pot-hero pot-sad pot-wide skin-cauldron skin-dutch skin-ricecooker skin-royal skin-starladle ' +
  'skin-steamer skin-teapot skin-ufo skin-wok ui-stamp ui-ticket win-feast').split(' '));
const IMGS = new Map();
function img(id) {
  if (!id || !ART.has(id)) return null;
  let e = IMGS.get(id);
  if (!e) {
    const im = new Image();
    e = { im, ok: false };
    im.onload = () => { const ok = () => { e.ok = true; }; im.decode ? im.decode().then(ok, ok) : ok(); };
    im.onerror = () => { e.bad = true; };
    im.src = new URL(`./art/${id}.webp`, import.meta.url).href;
    IMGS.set(id, e);
  }
  return e.ok ? e.im : null;
}
const tintCache = new Map();
function tinted(id, size, col) {
  const im = img(id);
  if (!im) return null;
  const s = Math.max(8, Math.round(size * dpr)), k = id + '|' + s + '|' + col;
  let c = tintCache.get(k);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d');
    drawFit(x, im, 0, 0, s, s);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, s, s);
    if (tintCache.size > 64) tintCache.clear();
    tintCache.set(k, c);
  }
  return c;
}
function drawFit(x, im, dx, dy, dw, dh) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, k = Math.min(dw / iw, dh / ih);
  x.drawImage(im, dx + (dw - iw * k) / 2, dy + (dh - ih * k) / 2, iw * k, ih * k);
}

// ---------- catalogue helpers ----------
let catIndex = null;
function cat() {
  if (!CAT || !CAT.KINDS) return null;
  if (!catIndex) { catIndex = new Map(); for (const k of CAT.KINDS) catIndex.set(k.id, k); }
  return catIndex;
}
function kindId(k) {
  if (typeof k === 'string') return k;
  const K = CAT && CAT.KINDS;
  if (K) { const e = K.find ? K.find(x => x.i === k) || K[k] : K[k]; if (e) return e.id; }
  return String(k);
}
const kindInfo = k => { const m = cat(); return m ? m.get(kindId(k)) : null; };
// logic.js stores w.kind[i] as a per-world index into w.kindNames (catalog ids)
const wKind = (w, i) => (w.kindNames && w.kind ? w.kindNames[w.kind[i]] : w.kind ? kindId(w.kind[i]) : '') || '';
function iconFor(k) {
  const info = kindInfo(k); if (info && info.icon) return info.icon;
  const id = kindId(k);
  if (id.startsWith('boss-')) return id === 'boss-picnictable' ? 'boss-table' : id;
  return 'ing-' + id;
}
const FALLBACK_COL = { strawberry: '#E8463A', tomato: '#E8463A', lemon: '#FFE14D', apple: '#D93A3A', cupcake: '#FF9EC4', cheese: '#FFC93C',
  banana: '#FFD84A', corn: '#FFCF3D', sandwich: '#F2C27B', watermelon: '#4CB050' };
const colorFor = k => { const i = kindInfo(k); return (i && i.color) || FALLBACK_COL[kindId(k)] || '#E8A24E'; };
function nameFor(k) {
  const i = kindInfo(k); if (i && i.name) return i.name;
  const s = kindId(k).replace(/^boss-/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- logic fallbacks (identical formulas, GDD §3.2/§9.3) ----------
const needR = a => (LG && LG.needR ? LG.needR(a) : a / 0.9);
function meterX(r, r0, rMax) {
  if (LG && LG.meterX) return LG.meterX(r, r0, rMax);
  return clamp((Math.log(r) - Math.log(r0)) / (Math.log(rMax) - Math.log(r0)), 0, 1);
}
function bossState(w, i) {
  if (LG && LG.bossState) { try { return LG.bossState(w, i); } catch {} }
  const t = w.tickets && w.tickets.find(t => t.boss === i);
  if (t && !t.done) return 'recipe';
  return w.pot.r * 0.9 >= w.ia[i] - 1e-9 ? 'open' : 'size';
}
const GATE_BIT = 16;
function isGate(w, i) {
  if (LG && LG.F && LG.F.GATE) return (w.flags[i] & LG.F.GATE) !== 0;
  const info = w.level && w.level.items && w.level.items[i];
  if (info && typeof info.gate === 'boolean') return info.gate;
  const ki = kindInfo(info ? info.kind : wKind(w, i));
  if (ki) return !!ki.gate;
  return !!(w.flags && (w.flags[i] & GATE_BIT));
}
function itemKind(w, i) {
  // DECISION (Sim, logic final): w.kindNames[w.kind[i]] is the authority; level.items is only a fallback for old worlds.
  if (w.kindNames && w.kind) { const k = wKind(w, i); if (k) return k; }
  const it = w.level && w.level.items && w.level.items[i];
  if (it && it.kind != null && !(w.mode === 'feast')) return kindId(it.kind);
  return wKind(w, i);
}

// ---------- module state ----------
let cv = null, g = null, dpr = 1, M = null, AU = null, RD = null, BUS = null, IN = null, onAct = null;
let L = null, Lkey = '', cssW = 0, cssH = 0;
let T = 0;                                  // ui clock (real s)
let screen = 'title', prevScreen = '', cardT = 0, cardData = {}, cardStack = [];
let btns = [], lastBtns = [], press = null, primary = null, kbHi = false;
const DBG = { on: false, texts: [], over: [] };
let hud = null;                             // per-world HUD animation state
let lastW = null, skipReveal = false;
let calloutQ = [], callNow = null;
let resetArm = -9;

// DECISION: every button goes through Core's single entry point: api.cmd(name, data) when initUI got `api`
//   (game.js passes it), else bus 'cmd' {cmd, ...data}; an explicit opts.onAction wins (harness).
let API = null;
const act = (a, d = {}) => {
  try {
    if (onAct) onAct(a, d);
    else if (API && API.cmd) API.cmd(a, d);
    else if (BUS && BUS.emit) BUS.emit('cmd', { cmd: a, ...d });
  } catch (e) { try { P.error(e); } catch {} }
};

export function initUI(canvas, opts = {}) {
  cv = canvas; g = canvas.getContext('2d');
  M = opts.meta || null; AU = opts.audio || null; RD = opts.render || null; BUS = opts.bus || null;
  IN = opts.input || null; onAct = opts.onAction || null; API = opts.api || null;
  if (BUS && BUS.on) bindBus(BUS);
  for (const id of ['pot-hero', 'icon-coin', 'icon-star', 'icon-padlock', 'icon-clock', 'icon-settings']) img(id);
  return api;
}
export function setInput(input) { IN = input; }
export function setAction(fn) { onAct = fn; }
export function debug(on) { if (on != null) DBG.on = !!on; return { texts: DBG.texts.slice(), over: DBG.over.slice(), buttons: lastBtns.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })), layout: L }; }
export function layoutNow() { return L; }

export function show(name, data) {
  // DECISION: Settings remembers where it was opened from, so Done on a Settings opened from Pause returns to Pause.
  if (name === 'settings') settingsFrom = screen === 'pause' ? 'pause' : 'title';
  if (name === 'play' && data && data.retry && !data.resumed && !data.freeze) skipReveal = true;
  if (name !== screen) { cardT = 0; kbHi = false; press = null; resetArm = -9; }
  screen = name; cardData[name] = data || {};
  if (name === 'win' && data && data.stars < 3 && hud) hud.starHint = !tutHas('stars') && (data.n || 0) >= 2 && data.kind !== 'feast';
}
let settingsFrom = 'title';
/** Core calls this on every resize (optional in §13.3); the layout is rebuilt on the next draw. */
export function resize() { Lkey = ''; }

export function callout(id, icon, text, ms = 2500) {
  if (!text) return;
  if ((callNow && callNow.id === id) || calloutQ.some(c => c.id === id)) return;
  const pri = /^tut/.test(id) ? 3 : /^twist/.test(id) ? 2 : /^gift/.test(id) ? 1 : 0;
  calloutQ.push({ id, icon, text, ms, pri, t: 0 });
  calloutQ.sort((a, b) => b.pri - a.pri);
}

export function rects() { return lastBtns.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, soft: !!b.soft })); }
export function primaryButton() {
  const b = lastBtns.find(b => b.primary);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}

// ---------- input ----------
const hitR = b => {
  const w = Math.max(44, b.w), h = Math.max(44, b.h);
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
};
const inR = (r, x, y) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
function hit(x, y) {
  for (let i = lastBtns.length - 1; i >= 0; i--) { const b = lastBtns[i]; if (!b.disabled && inR(hitR(b), x, y)) return b; }
  return null;
}
export function pointer(type, x, y) {
  if (type === 'down') {
    const b = hit(x, y);
    if (!b) { press = null; return false; }
    press = { id: b.id, x0: x, y0: y, t0: T, inside: true, soft: b.soft, travel: 0 };
    if (AU && AU.unlock) { try { AU.unlock(); } catch {} }
    return !b.soft;                         // a booster press may still become the stick
  }
  if (!press) return false;
  if (type === 'move') {
    press.travel = Math.max(press.travel, Math.hypot(x - press.x0, y - press.y0));
    const b = lastBtns.find(b => b.id === press.id);
    press.inside = !!b && inR(hitR(b), x, y);
    if (press.soft && press.travel >= 8) { press = null; return false; }
    return !press || !press.soft;
  }
  if (type === 'up') {
    const p = press; press = null;
    const b = lastBtns.find(b => b.id === p.id);
    if (!b || !inR(hitR(b), x, y)) return !p.soft;
    if (p.soft && (p.travel >= 8 || T - p.t0 >= 0.45)) return false;
    sfx('ui');
    b.act && b.act();
    return true;
  }
  press = null;
  return false;
}
export function key(e) {
  const k = e.key;
  if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
    if (screen === 'play') return false;
    const b = lastBtns.find(b => b.primary && !b.disabled);
    if (b) { if (e.repeat) return true; sfx('ui'); b.act && b.act(); return true; }
    return false;
  }
  if (k === 'Escape' || k === 'Esc') {
    // DECISION: on YouTube the host owns Esc during play (it leaves fullscreen); P pauses there. Esc still closes cards.
    if (screen === 'play') { if (P.env === 'yt') return false; act('pause'); return true; }
    if (screen === 'pause') { act('resume'); return true; }
    if (screen === 'title') return false;
    if (screen === 'win' || screen === 'fail') { act('map'); return true; }
    act('back'); return true;
  }
  if (k === 'p' || k === 'P') {
    if (screen === 'play') { act('pause'); return true; }
    if (screen === 'pause') { act('resume'); return true; }
    return false;
  }
  if (screen === 'play' && (k === '1' || k === '2' || k === '3')) {
    const kind = ['magnet', 'freeze', 'mega'][+k - 1];
    const b = lastBtns.find(b => b.id === 'b-' + kind);
    if (b && !b.disabled) { b.act && b.act(); return true; }
    return false;
  }
  return false;
}

// ---------- bus ----------
function tutHas(f) { try { return M && M.tut ? !!M.tut(f) : false; } catch { return false; } }
function tutSet(f) { try { if (M && M.tut) M.tut(f, true); } catch {} }
function sfx(id) { try { if (AU && AU.sfx) AU.sfx(id); } catch {} }

function bindBus(bus) {
  const on = (ev, fn) => bus.on(ev, d => { try { if (hud) fn(d || {}); } catch (e) { try { P.error(e); } catch {} } });
  on('start', () => { hud.started = T; hud.lastBite = T; if (hud.n === 1 || hud.n === 2) tutSet('drag'); });
  on('bite', d => {
    hud.lastBite = T;
    if (d.ing) { const li = typeof d.ing === 'number' ? d.ing : lineIndexOf(d.kind); if (li >= 0) hud.chipPop[li] = T; }
  });
  on('sizeUp', d => {
    hud.sizeUps++;
    if (hud.n === 1 && hud.sizeUps === 1 && !hud.flown) startFly();
  });
  on('line', d => { hud.lineDone[d.li] = T; if (d.ti === hud.ti) hud.chipPop[d.li] = T; });
  on('ticketDone', d => { hud.flip = T; hud.bossPulse = T; });
  on('padlock', d => { hud.padPop = T; hud.padIdx = d.i; hud.bossPoint = T; tutSet('padlock'); });
  on('bossNudge', () => { hud.padRattle = T; hud.chipNudge = T; });
  on('bossBite', d => { if (d.final !== false) hud.orderUp = T; else { hud.course = T; } });
  on('chain', d => { hud.chainPop = T; });
  on('chainEnd', d => { hud.chainDrop = T; hud.chainLast = d.n || hud.chainLast; });
  on('sizzle', () => { hud.sizzle = T; });
  on('lowTime', () => { hud.low = T; });
  on('tick', () => { hud.tick = T; });
  on('boost', d => { hud.boostFx[d.kind] = T; if (d.kind === 'freeze') hud.frost = T; });
  on('win', () => { hud.result = 'win'; });
  on('fail', () => { hud.result = 'fail'; });
}
function lineIndexOf(kind) {
  const w = lastW; if (!w || !w.tickets) return -1;
  const t = w.tickets[w.ti]; if (!t) return -1;
  const id = kindId(kind);
  return t.lines.findIndex(l => kindId(l.kind) === id && l.got <= l.need);
}

function newHud(w) {
  const n = (w.level && w.level.n) || 0;
  return {
    n, ti: w.ti || 0, t0: T, started: null, lastBite: T, sizeUps: 0, chipPop: [], lineDone: [], flip: -9, bossPulse: -9,
    padPop: -9, padIdx: -1, padRattle: -9, chipNudge: -9, orderUp: -9, course: -9, chainPop: -9, chainDrop: -9, chainLast: 0,
    chainShown: 0, sizzle: -9, low: -9, tick: -9, boostFx: {}, frost: -9, result: null, bossPoint: -9,
    reveal: skipReveal ? -9 : T, rDisp: w.pot ? w.pot.r : 0.3, fly: null, flown: false, hintItem: -1, idleCall: false,
    twistCall: false, starHint: false, firstAttempt: !skipReveal,
  };
}

// ---------- text ----------
function font(size, f = FT, wt = '') { return (wt ? wt + ' ' : '') + size.toFixed(2) + 'px ' + f; }
function measure(s, size, f = FT, wt = '') { g.font = font(size, f, wt); return g.measureText(s).width; }
/** Draw text; o: {f, wt, col, stroke, sk, align, base, maxW, min, shadow}. Shrinks to fit maxW down to `min` (>= 12). */
function txt(s, x, y, size, o = {}) {
  const f = o.f || FT, wt = o.wt || (f === FB ? '800' : ''), min = Math.max(12, o.min || 12);
  let sz = size, w = measure(s, sz, f, wt);
  if (o.maxW && w > o.maxW) { sz = Math.max(min, size * o.maxW / w); w = measure(s, sz, f, wt); }
  g.textAlign = o.align || 'center'; g.textBaseline = o.base || 'middle';
  if (o.shadow) { g.fillStyle = o.shadow; g.fillText(s, x, y + Math.max(1.5, sz * 0.08)); }
  if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.sk || Math.max(2, sz * 0.16); g.strokeStyle = o.stroke; g.strokeText(s, x, y); }
  g.fillStyle = o.col || C.ink; g.fillText(s, x, y);
  if (DBG.on) {
    const al = g.textAlign, bx = al === 'center' ? x - w / 2 : al === 'right' || al === 'end' ? x - w : x;
    const by = g.textBaseline === 'middle' ? y - sz * 0.5 : g.textBaseline === 'top' ? y : y - sz * 0.8;
    // map the local text box through the current transform to CSS px (text drawn inside translate/scale/rotate)
    const m = g.getTransform(), xs = [], ys = [];
    for (const [px, py] of [[bx, by], [bx + w, by], [bx, by + sz], [bx + w, by + sz]]) { xs.push((m.a * px + m.c * py + m.e) / dpr); ys.push((m.b * px + m.d * py + m.f) / dpr); }
    const X0 = Math.min(...xs), Y0 = Math.min(...ys), sc = Math.hypot(m.a, m.b) / dpr;
    DBG.texts.push({ s, x: X0, y: Y0, w: Math.max(...xs) - X0, h: Math.max(...ys) - Y0, size: sz * sc, layer: DBG.layer || 0 });
    if (o.maxW && w > o.maxW + 0.5) DBG.over.push({ s, w, maxW: o.maxW, size: sz });
  }
  return { w, size: sz };
}
/** Try each string in list; the first that fits maxW at >= 12.5 px wins (PLAYBOOK txtMin). */
function txtMin(list, x, y, size, o = {}) {
  const f = o.f || FT, wt = o.wt || (f === FB ? '800' : ''), min = Math.max(12.5, o.min || 12.5);
  for (const s of list) {
    if (!s) continue;
    const w = measure(s, size, f, wt);
    if (!o.maxW || w <= o.maxW || size * o.maxW / w >= min) return txt(s, x, y, size, { ...o, min });
  }
  return txt(list[list.length - 1] || '', x, y, size, { ...o, min });
}
/** Wrap into at most 2 lines inside maxW (shrinking to >= 12.5), centred on y. */
function txt2(s, x, y, size, o = {}) {
  // DECISION: two-line text takes the most balanced split that fits (never a lone first word like "Head / chef! ...").
  const f = o.f || FT, wt = o.wt || (f === FB ? '800' : '');
  if (measure(s, size, f, wt) <= o.maxW) return txt(s, x, y, size, o);
  const words = s.split(' ');
  let best = null;
  for (let sz = size; sz >= 12.5; sz -= 0.5) {
    let bw = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const wa = measure(a, sz, f, wt), wb = measure(b, sz, f, wt), m = Math.max(wa, wb);
      if (wa <= o.maxW && wb <= o.maxW && m < bw) { bw = m; best = { a, b, sz }; }
    }
    if (best) break;
  }
  if (!best) return txt(s, x, y, size, { ...o, min: 12.5 });
  const lh = best.sz * 1.15;
  txt(best.a, x, y - lh / 2, best.sz, o); txt(best.b, x, y + lh / 2, best.sz, o);
  return { w: o.maxW, size: best.sz };
}

// ---------- primitives ----------
function rr(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function circle(x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); }
function star(x, y, r, inner = 0.48) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * inner : r; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
  g.closePath();
}
function drawStar(x, y, r, on, o = {}) {
  // DECISION: an earned star is the kie icon-star (glossy 3D); an empty slot stays a flat paper star so the pair reads as on/off.
  const sa = on && img('icon-star');
  if (sa) { drawFit(g, sa, x - r * 1.18, y - r * 1.14, r * 2.36, r * 2.36); return; }
  g.save(); g.lineJoin = 'round';
  star(x, y + r * 0.08, r); g.fillStyle = 'rgba(58,36,24,0.25)'; g.fill();
  star(x, y, r);
  if (on) { const gr = g.createLinearGradient(0, y - r, 0, y + r); gr.addColorStop(0, C.goldL); gr.addColorStop(0.55, C.gold); gr.addColorStop(1, C.goldS); g.fillStyle = gr; }
  else g.fillStyle = C.paperS;
  g.fill(); g.lineWidth = Math.max(2, r * 0.12); g.strokeStyle = C.ink; g.stroke();
  if (on) { star(x - r * 0.1, y - r * 0.12, r * 0.42); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); }
  g.restore();
}
function coin(x, y, r) {
  const im = img('icon-coin');
  if (im) { drawFit(g, im, x - r * 1.15, y - r * 1.15, r * 2.3, r * 2.3); return; }
  circle(x, y, r); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(1.5, r * 0.14); g.strokeStyle = C.ink; g.stroke();
  circle(x, y, r * 0.62); g.strokeStyle = C.goldS; g.lineWidth = Math.max(1, r * 0.1); g.stroke();
}
function icon(id, x, y, s, fb) {
  const im = img(id);
  if (im) { drawFit(g, im, x - s / 2, y - s / 2, s, s); return true; }
  if (fb) fb(x, y, s); else blob(x, y, s, '#E8A24E');
  return false;
}
function blob(x, y, s, col) {
  circle(x, y + s * 0.04, s * 0.38); g.fillStyle = col; g.fill(); g.lineWidth = Math.max(1.5, s * 0.06); g.strokeStyle = C.ink; g.stroke();
  circle(x - s * 0.12, y - s * 0.12, s * 0.1); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill();
}
const ingIcon = (k, x, y, s) => icon(iconFor(k), x, y, s, (x, y, s) => blob(x, y, s, colorFor(k)));
function padlock(x, y, s, open = 0) {
  const im = img('icon-padlock');
  if (im && !open) { drawFit(g, im, x - s / 2, y - s / 2, s, s); return; }
  g.save(); g.lineJoin = 'round';
  const bw = s * 0.7, bh = s * 0.52, by = y - s * 0.02;
  g.beginPath(); g.lineWidth = s * 0.13; g.strokeStyle = C.ink;
  g.arc(x + (open ? s * 0.22 : 0), by - s * 0.02, s * 0.22, Math.PI, 0); g.stroke();
  rr(x - bw / 2, by, bw, bh, s * 0.1); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(1.5, s * 0.08); g.stroke();
  circle(x, by + bh * 0.45, s * 0.07); g.fillStyle = C.ink; g.fill();
  g.restore();
}
function tick(x, y, s, col = C.go) {
  circle(x, y, s / 2); g.fillStyle = col; g.fill(); g.lineWidth = Math.max(1.5, s * 0.1); g.strokeStyle = C.ink; g.stroke();
  g.beginPath(); g.moveTo(x - s * 0.22, y + s * 0.02); g.lineTo(x - s * 0.05, y + s * 0.18); g.lineTo(x + s * 0.24, y - s * 0.17);
  g.lineWidth = Math.max(2, s * 0.13); g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); g.lineCap = 'butt';
}
function panel(r, o = {}) {
  const u = o.u || 1, rad = o.rad ?? Math.max(14, 22 * u);
  g.save();
  rr(r.x, r.y + Math.max(4, 7 * u), r.w, r.h, rad); g.fillStyle = 'rgba(58,36,24,0.35)'; g.fill();
  rr(r.x, r.y, r.w, r.h, rad); g.fillStyle = o.fill || C.paper; g.fill();
  g.lineWidth = Math.max(2.5, 3 * u); g.strokeStyle = C.ink; g.stroke();
  // inner stitched border, recipe-card feel
  rr(r.x + Math.max(5, 8 * u), r.y + Math.max(5, 8 * u), r.w - 2 * Math.max(5, 8 * u), r.h - 2 * Math.max(5, 8 * u), rad * 0.7);
  g.setLineDash([Math.max(4, 7 * u), Math.max(3, 5 * u)]); g.lineWidth = Math.max(1, 1.5 * u); g.strokeStyle = 'rgba(185,119,14,0.45)'; g.stroke();
  g.setLineDash([]);
  g.restore();
}
function dimBg(a) { g.fillStyle = `rgba(58,36,24,${(0.6 * a).toFixed(3)})`; g.fillRect(0, 0, cssW, cssH); }

/** Gold primary pill (§7.8): radius 14u, 4u lip #B9770E, ink label; pressed = lip 1u, y + 3u. */
function goldBtn(b, label, o = {}) {
  const u = o.u || L.u, down = isDown(b.id), lip = Math.max(3, (down ? 1 : 4) * u), dy = down ? Math.max(2, 3 * u) : 0;
  const x = b.x, y = b.y + dy, w = b.w, h = b.h - lip - (down ? 0 : 0), rad = Math.max(12, Math.min(h / 2, 16 * u));
  g.save();
  if (o.glow) { g.shadowColor = 'rgba(255,211,77,0.95)'; g.shadowBlur = (12 + 10 * o.glow) * Math.max(1, u * 0.8); }
  rr(x, y + lip, w, h - dy, rad); g.fillStyle = C.goldS; g.fill(); g.shadowBlur = 0;
  rr(x, y, w, h - dy, rad);
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, C.goldL); gr.addColorStop(0.5, C.gold); gr.addColorStop(1, '#E9A01A');
  g.fillStyle = o.fill || gr; g.fill();
  g.lineWidth = Math.max(2, 2.5 * u); g.strokeStyle = C.ink; g.stroke();
  rr(x + rad * 0.5, y + Math.max(2, 3 * u), w - rad, Math.max(3, (h - dy) * 0.22), rad * 0.4); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
  g.restore();
  const fs = o.fs || Math.max(16, 22 * u);
  let lx = x + w / 2;
  if (o.icon) { const s = fs * 1.3; lx += s * 0.4; o.icon(x + w / 2 - measure(label, fs) / 2 - s * 0.35, y + (h - dy) / 2, s); }
  txtMin(o.alts ? [label, ...o.alts] : [label], lx, y + (h - dy) / 2 + fs * 0.04, fs, { col: C.ink, maxW: w - Math.max(16, 24 * u) - (o.icon ? fs * 1.3 : 0) });
}
/** Paper secondary pill: paper fill, paperShade lip, ink label. */
function paperBtn(b, label, o = {}) {
  // DECISION: o.tail {w, draw(x, cy)} draws a trailing item (the Freeze coin + price) inside the button so the row stays centred.
  const u = o.u || L.u, down = isDown(b.id), lip = Math.max(3, (down ? 1 : 3.5) * u), dy = down ? Math.max(2, 2.5 * u) : 0;
  const x = b.x, y = b.y + dy, w = b.w, h = b.h - lip, rad = Math.max(12, Math.min(h / 2, 14 * u));
  g.save();
  rr(x, y + lip, w, h - dy, rad); g.fillStyle = '#C9AE82'; g.fill();
  rr(x, y, w, h - dy, rad); g.fillStyle = o.fill || C.paper; g.fill();
  g.lineWidth = Math.max(2, 2.2 * u); g.strokeStyle = C.ink; g.stroke();
  g.restore();
  const fs = o.fs || Math.max(14, 17 * u);
  const cy = y + (h - dy) / 2;
  if (o.icon) {
    // o.tail = { w, draw(x, cy) }: a price tag etc. centred with the icon + label as one group
    const s = Math.min(h * 0.62, fs * 1.45), gap = Math.max(4, 6 * u), tw = o.tail ? o.tail.w + gap * 2 : 0;
    const lw = measure(label, fs, o.f || FT), total = s + gap + lw + tw;
    const x0 = x + Math.max(w / 2 - total / 2, Math.max(8, 10 * u));
    o.icon(x0 + s / 2, cy, s);
    const r = txtMin([label, ...(o.alts || [])], x0 + s + gap, cy + fs * 0.04, fs, { align: 'left', col: C.ink, f: o.f, maxW: x + w - (x0 + s + gap) - Math.max(6, 8 * u) - tw });
    if (o.tail) o.tail.draw(x0 + s + gap + ((r && r.w) || lw) + gap * 2, cy);
  } else {
    txtMin([label, ...(o.alts || [])], x + w / 2, cy + fs * 0.04, fs, { col: C.ink, f: o.f, maxW: w - Math.max(12, 18 * u) });
  }
}
function isDown(id) { return press && press.id === id && press.inside; }
function reg(id, r, fn, o = {}) {
  const b = { id, x: r.x, y: r.y, w: r.w, h: r.h, act: fn, primary: !!o.primary, soft: !!o.soft, disabled: !!o.disabled };
  btns.push(b); return b;
}

// ---------- glyphs (kie art when loaded, else drawn; never emoji) ----------
// DECISION (D33 + art drop): a glyph id that has kie art draws the art; the drawn version is only the fallback.
//   settings/ladle = icon-settings (crossed wooden spoons, never a cog), clock = icon-clock, star = icon-star,
//   shop = skin-royal (the crowned pot reads as "Pot Shop"). daily/feast/map/pause/play/restart/back stay drawn (no art).
const GLYPH_ART = { chest: 'icon-chest', ladle: 'icon-settings', settings: 'icon-settings', clock: 'icon-clock', star: 'icon-star', shop: 'skin-royal' };
function glyph(id, x, y, s) {
  const ga = GLYPH_ART[id] && img(GLYPH_ART[id]);
  if (ga) { const k = id === 'shop' ? 1.12 : 1.05; drawFit(g, ga, x - s * k / 2, y - s * k / 2, s * k, s * k); return; }
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.ink; g.fillStyle = C.ink;
  const lw = Math.max(2, s * 0.11); g.lineWidth = lw;
  if (id === 'pause') { const bw = s * 0.17, bh = s * 0.52; rr(x - s * 0.2 - bw / 2, y - bh / 2, bw, bh, bw * 0.4); g.fill(); rr(x + s * 0.2 - bw / 2, y - bh / 2, bw, bh, bw * 0.4); g.fill(); }
  else if (id === 'ladle' || id === 'settings') {
    // DECISION (D33): settings fallback = a drawn wooden spoon + ladle, never a cog (art: icon-settings, above).
    g.save(); g.translate(x, y); g.rotate(-0.6);
    g.fillStyle = '#C98B4E'; rr(-s * 0.06, -s * 0.46, s * 0.12, s * 0.62, s * 0.06); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, s * 0.27, s * 0.2, s * 0.2, 0, 0, TAU); g.fillStyle = C.gold; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, s * 0.24, s * 0.11, s * 0.08, 0, 0, TAU); g.fillStyle = C.goldS; g.fill();
    g.restore();
  } else if (id === 'map') {
    g.beginPath(); g.moveTo(x - s * 0.38, y - s * 0.26); g.lineTo(x - s * 0.13, y - s * 0.36); g.lineTo(x + s * 0.13, y - s * 0.26); g.lineTo(x + s * 0.38, y - s * 0.36);
    g.lineTo(x + s * 0.38, y + s * 0.26); g.lineTo(x + s * 0.13, y + s * 0.36); g.lineTo(x - s * 0.13, y + s * 0.26); g.lineTo(x - s * 0.38, y + s * 0.36); g.closePath();
    g.fillStyle = '#FFE7B0'; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.13, y - s * 0.36); g.lineTo(x - s * 0.13, y + s * 0.26); g.moveTo(x + s * 0.13, y - s * 0.26); g.lineTo(x + s * 0.13, y + s * 0.36); g.lineWidth = lw * 0.7; g.stroke();
    circle(x + s * 0.24, y - s * 0.05, s * 0.07); g.fillStyle = C.stamp; g.fill();
  } else if (id === 'restart') {
    g.beginPath(); g.arc(x, y, s * 0.3, -Math.PI * 0.35, Math.PI * 1.35); g.lineWidth = lw * 1.2; g.stroke();
    const a = -Math.PI * 0.35, ax = x + Math.cos(a) * s * 0.3, ay = y + Math.sin(a) * s * 0.3;
    g.beginPath(); g.moveTo(ax + s * 0.16, ay - s * 0.02); g.lineTo(ax - s * 0.02, ay - s * 0.16); g.lineTo(ax - s * 0.04, ay + s * 0.1); g.closePath(); g.fill();
  } else if (id === 'back') {
    g.beginPath(); g.moveTo(x + s * 0.24, y); g.lineTo(x - s * 0.22, y); g.lineWidth = lw * 1.3; g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.02, y - s * 0.22); g.lineTo(x - s * 0.24, y); g.lineTo(x - s * 0.02, y + s * 0.22); g.stroke();
  } else if (id === 'play') {
    g.beginPath(); g.moveTo(x - s * 0.16, y - s * 0.26); g.lineTo(x + s * 0.26, y); g.lineTo(x - s * 0.16, y + s * 0.26); g.closePath(); g.fill();
  } else if (id === 'sound' || id === 'mute') {
    g.beginPath(); g.moveTo(x - s * 0.34, y - s * 0.11); g.lineTo(x - s * 0.18, y - s * 0.11); g.lineTo(x + s * 0.02, y - s * 0.3);
    g.lineTo(x + s * 0.02, y + s * 0.3); g.lineTo(x - s * 0.18, y + s * 0.11); g.lineTo(x - s * 0.34, y + s * 0.11); g.closePath(); g.fill();
    if (id === 'sound') { g.beginPath(); g.arc(x + s * 0.06, y, s * 0.18, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(x + s * 0.06, y, s * 0.32, -0.9, 0.9); g.stroke(); }
    else { g.beginPath(); g.moveTo(x + s * 0.14, y - s * 0.14); g.lineTo(x + s * 0.38, y + s * 0.14); g.moveTo(x + s * 0.38, y - s * 0.14); g.lineTo(x + s * 0.14, y + s * 0.14); g.stroke(); }
  } else if (id === 'daily') {
    rr(x - s * 0.34, y - s * 0.28, s * 0.68, s * 0.62, s * 0.08); g.fillStyle = C.paper; g.fill(); g.stroke();
    rr(x - s * 0.34, y - s * 0.28, s * 0.68, s * 0.18, s * 0.06); g.fillStyle = C.stamp; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.17, y - s * 0.38); g.lineTo(x - s * 0.17, y - s * 0.2); g.moveTo(x + s * 0.17, y - s * 0.38); g.lineTo(x + s * 0.17, y - s * 0.2); g.stroke();
    star(x, y + s * 0.1, s * 0.15); g.fillStyle = C.gold; g.fill(); g.lineWidth = lw * 0.6; g.stroke();
  } else if (id === 'feast') {
    g.beginPath(); g.ellipse(x, y + s * 0.12, s * 0.38, s * 0.12, 0, 0, TAU); g.fillStyle = C.paper; g.fill(); g.stroke();
    g.beginPath(); g.arc(x, y + s * 0.1, s * 0.3, Math.PI, 0); g.closePath(); g.fillStyle = '#E0E0E0'; g.fill(); g.stroke();
    circle(x, y - s * 0.23, s * 0.06); g.fillStyle = C.ink; g.fill();
  } else if (id === 'cookbook') {
    const im = img('icon-cookbook'); if (im) { drawFit(g, im, x - s / 2, y - s / 2, s, s); g.restore(); return; }
    rr(x - s * 0.3, y - s * 0.36, s * 0.6, s * 0.72, s * 0.06); g.fillStyle = C.stamp; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - s * 0.18, y - s * 0.36); g.lineTo(x - s * 0.18, y + s * 0.36); g.stroke();
  } else if (id === 'shop') {
    rr(x - s * 0.32, y - s * 0.12, s * 0.64, s * 0.46, s * 0.08); g.fillStyle = C.gold; g.fill(); g.stroke();
    g.beginPath(); g.arc(x, y - s * 0.12, s * 0.18, Math.PI, 0); g.stroke();
    coin(x, y + s * 0.11, s * 0.12);
  } else if (id === 'freeze' || id === 'magnet' || id === 'mega') {
    const art = { magnet: 'icon-magnet', freeze: 'icon-freeze', mega: 'icon-megarim' }[id];
    const im = img(art); if (im) { drawFit(g, im, x - s / 2, y - s / 2, s, s); g.restore(); return; }
    if (id === 'magnet') {
      g.beginPath(); g.arc(x, y - s * 0.02, s * 0.24, Math.PI, 0, true); g.lineWidth = s * 0.17; g.strokeStyle = C.stamp; g.stroke();
      g.fillStyle = '#E6E6E6'; g.fillRect(x - s * 0.33, y - s * 0.02, s * 0.17, s * 0.14); g.fillRect(x + s * 0.16, y - s * 0.02, s * 0.17, s * 0.14);
    } else if (id === 'freeze') {
      rr(x - s * 0.3, y - s * 0.3, s * 0.6, s * 0.6, s * 0.12); g.fillStyle = '#F3FBFF'; g.fill(); g.stroke();
      g.beginPath(); for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.moveTo(x + Math.cos(a) * s * 0.2, y + Math.sin(a) * s * 0.2); g.lineTo(x - Math.cos(a) * s * 0.2, y - Math.sin(a) * s * 0.2); } g.lineWidth = lw * 0.8; g.stroke();
    } else {
      circle(x, y, s * 0.2); g.lineWidth = s * 0.1; g.strokeStyle = C.gold; g.stroke(); g.lineWidth = lw * 0.7; g.strokeStyle = C.ink; circle(x, y, s * 0.26); g.stroke();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3); g.lineTo(x + Math.cos(a) * s * 0.44, y + Math.sin(a) * s * 0.44); g.stroke(); }
    }
  } else if (id === 'star') { g.restore(); drawStar(x, y, s * 0.42, true); return; }
  else if (id === 'coin') { g.restore(); coin(x, y, s * 0.38); return; }
  else if (id === 'clock') {
    circle(x, y, s * 0.36); g.fillStyle = C.paper; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.22); g.moveTo(x, y); g.lineTo(x + s * 0.14, y + s * 0.06); g.stroke();
  } else if (id === 'chain') {
    txt('×', x, y, s * 0.8, { col: C.gold, stroke: C.ink, sk: Math.max(2, s * 0.12) });
  } else if (id === 'gift' || id === 'chest') {
    const im = img('icon-gift'); if (im) { drawFit(g, im, x - s / 2, y - s / 2, s, s); g.restore(); return; }
    rr(x - s * 0.32, y - s * 0.12, s * 0.64, s * 0.46, s * 0.06); g.fillStyle = C.stamp; g.fill(); g.stroke();
    rr(x - s * 0.36, y - s * 0.26, s * 0.72, s * 0.16, s * 0.05); g.fillStyle = C.tomato; g.fill(); g.stroke();
    g.fillStyle = C.gold; g.fillRect(x - s * 0.06, y - s * 0.26, s * 0.12, s * 0.6);
  }
  g.restore();
}

// ---------- the pot (title/cards) ----------
function potArt(id, x, y, s) {
  const im = img(id) || img('pot-hero');
  if (im) { drawFit(g, im, x - s / 2, y - s / 2, s, s); return; }
  // drawn fallback: gold pot with stew and eyes
  g.save(); g.lineJoin = 'round';
  const r = s * 0.36;
  g.beginPath(); g.ellipse(x, y + r * 0.35, r, r * 0.8, 0, 0, Math.PI); g.lineTo(x - r, y); g.closePath();
  g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(2, s * 0.02); g.strokeStyle = C.ink; g.stroke();
  g.beginPath(); g.ellipse(x, y, r, r * 0.38, 0, 0, TAU); g.fillStyle = C.goldL; g.fill(); g.stroke();
  g.beginPath(); g.ellipse(x, y + r * 0.02, r * 0.84, r * 0.28, 0, 0, TAU); g.fillStyle = C.stew; g.fill();
  const sad = id === 'pot-sad', ey = y + r * 0.62;
  for (const sx of [-1, 1]) {
    circle(x + sx * r * 0.32, ey, r * 0.16); g.fillStyle = '#fff'; g.fill(); g.stroke();
    if (id === 'pot-happy') { g.beginPath(); g.arc(x + sx * r * 0.32, ey + r * 0.04, r * 0.09, Math.PI * 1.1, Math.PI * 1.9); g.lineWidth = Math.max(2, r * 0.05); g.stroke(); }
    else { circle(x + sx * r * 0.32, ey + (sad ? r * 0.05 : 0), r * 0.08); g.fillStyle = C.ink; g.fill(); }
  }
  g.restore();
}

// ---------- layout / frame ----------
// DECISION: the canvas backing size follows Core's own numbers (view().W/H/dpr) when given, so the two never fight
//   over #ui's width/height; standalone (harness) it measures the canvas itself.
function ensureSize(st) {
  const w = st && st.W > 0 ? st.W : (cv.clientWidth || (typeof innerWidth !== 'undefined' ? innerWidth : 390));
  const h = st && st.H > 0 ? st.H : (cv.clientHeight || (typeof innerHeight !== 'undefined' ? innerHeight : 844));
  const d = st && st.dpr > 0 ? st.dpr : Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio || 1 : 1, 3);
  const pw = Math.round(w * d), ph = Math.round(h * d);
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  cssW = w; cssH = h; dpr = d;
  const ins = safeInsets();
  const k = w + 'x' + h + '|' + ins.t + ',' + ins.r + ',' + ins.b + ',' + ins.l + '|' + curLines;
  if (k !== Lkey) { Lkey = k; L = computeLayout(w, h, ins, { lines: curLines }); }
}
let curLines = 3;

export function draw(state, w, dt) {
  if (!g) return;
  dt = clamp(+dt || 0, 0, 0.1);
  T += dt; cardT += dt;
  const st = state || {};
  const scr = st.screen || screen;
  if (scr !== screen) { screen = scr; cardT = 0; press = null; kbHi = false; resetArm = -9; }
  if (screen !== prevScreen) { prevScreen = screen; }
  if (w && w !== lastW) {
    lastW = w;
    hud = newHud(w);
    skipReveal = false;
    const t = w.tickets && w.tickets[w.ti || 0];
    curLines = t ? t.lines.length : 3; setTicketLines(curLines);
  } else if (w && w.tickets) {
    const t = w.tickets[w.ti || 0], n = t ? t.lines.length : 3;
    if (n !== curLines) { curLines = n; setTicketLines(n); }
    if (hud && (w.ti || 0) !== hud.ti) { hud.ti = w.ti || 0; hud.chipPop = []; hud.lineDone = []; hud.flip = -9; }
  }
  ensureSize(st);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  btns = [];
  DBG.texts = []; DBG.over = [];
  try {
    const playing = screen === 'play' || screen === 'pause';
    if (playing && w) drawHud(st, w, dt);
    if (screen === 'pause') drawPause(st, w);
    else if (screen === 'win') drawWin(st, w);
    else if (screen === 'fail') drawFail(st, w);
    else if (screen === 'title') drawTitle(st);
    else if (screen === 'settings') drawSettings(st);
    else if (screen === 'map') drawMap(st);
    else if (screen !== 'play') drawInfo(st, screen);
    if (screen === 'play') drawCallout(dt);
  } catch (e) { try { P.error(e); } catch {} }
  lastBtns = btns;
}

// =====================================================================================
// HUD
// =====================================================================================
function drawHud(st, w, dt) {
  const H = L.hud, u = L.u;
  const t = w.tickets && w.tickets[w.ti || 0];
  const playing = screen === 'play';
  // tutorial timers (real time; only while playing)
  if (playing) tutorialTick(st, w);
  drawMeter(w, dt);
  drawTicket(w, t);
  if (w.timed !== false && w.T) drawEggTimer(w);
  // pause tag (D33: pause glyph on a paper tag)
  const pb = reg('pause', H.pause, () => act('pause'));
  drawPauseTag(pb);
  drawBoosters(st, w);
  if (playing) {
    drawArrows(w);
    drawChain(w);
    drawStick(st);
    drawGhost(w);
    drawFly(w);
    drawOrderUp(w);
  }
}

function drawPauseTag(b) {
  const u = L.u, down = isDown('pause'), dy = down ? 2 : 0;
  const x = b.x, y = b.y + dy, w = b.w, h = b.h;
  g.save(); g.lineJoin = 'round';
  // tag body with a clipped corner and a string hole
  const cut = w * 0.22;
  const path = () => { g.beginPath(); g.moveTo(x + cut, y); g.lineTo(x + w - 6, y); g.quadraticCurveTo(x + w, y, x + w, y + 6); g.lineTo(x + w, y + h - 6);
    g.quadraticCurveTo(x + w, y + h, x + w - 6, y + h); g.lineTo(x + cut, y + h); g.lineTo(x, y + h - cut); g.lineTo(x, y + cut); g.closePath(); };
  g.translate(0, down ? 0 : 0);
  path(); g.save(); g.translate(0, Math.max(2, 3 * u) - dy); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill(); g.restore();
  path(); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(2, 2.2 * u); g.strokeStyle = C.ink; g.stroke();
  circle(x + cut * 0.75, y + h / 2, Math.max(2.2, 3 * u)); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 1.5; g.stroke();
  g.restore();
  glyph('pause', x + w * 0.58, y + h / 2, Math.min(w, h) * 0.78);
}

// ---- brass rail + paper ticket ----
function drawRail(r) {
  const u = L.u;
  g.save();
  rr(r.x, r.y, r.w, r.h, r.h / 2);
  const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h); gr.addColorStop(0, C.brassL); gr.addColorStop(0.5, C.brass); gr.addColorStop(1, C.brassD);
  g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.strokeStyle = C.ink; g.stroke();
  for (const fx of [0.06, 0.94]) { circle(r.x + r.w * fx, r.y + r.h / 2, Math.max(1.3, r.h * 0.22)); g.fillStyle = C.brassD; g.fill(); }
  g.restore();
}
function tornPaper(x, y, w, h, u, o = {}) {
  const tooth = Math.max(5, 8 * u), n = Math.max(4, Math.round(w / tooth)), tw2 = w / n, th = Math.max(3, 4.5 * u);
  const path = () => {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - th);
    for (let i = n; i > 0; i--) { g.lineTo(x + (i - 0.5) * tw2, y + h); g.lineTo(x + (i - 1) * tw2, y + h - th); }
    g.closePath();
  };
  g.save();
  g.translate(0, Math.max(2, 3 * u)); path(); g.fillStyle = 'rgba(58,36,24,0.28)'; g.fill(); g.translate(0, -Math.max(2, 3 * u));
  path(); g.fillStyle = o.fill || C.paper; g.fill();
  g.lineWidth = Math.max(1.5, 2 * u); g.strokeStyle = C.ink; g.stroke();
  // faint ruled lines
  g.restore();
}
function drawTicket(w, t) {
  // DECISION: no "2" tab under the ticket: the gap to the meter is ~8 px, so a tab was clipped to a sliver that read as a glitch.
  const H = L.hud, u = L.u, fs = L.fs, r = H.ticket;
  if (!r || !t) return;
  const n = (w.level && w.level.n) || hud.n;
  // goal reveal: ticket swings in from the rail (D15), first attempt only
  const rv = T - hud.reveal, swing = rv >= 0 && rv < 0.9 ? Math.exp(-rv * 4.2) * Math.cos(rv * 13) * 0.32 * (1 - ease(rv / 0.9)) : 0;
  const drop = rv >= 0 && rv < 0.25 ? (1 - ease(rv / 0.25)) * -r.h * 0.9 : 0;
  // order-up: the HUD ticket leaves (the win card takes over); two-course: ticket 1 slides off left
  const ou = T - hud.orderUp, crs = T - hud.course;
  let ox = 0, oy = 0, sc = 1, alpha = 1;
  if (ou >= 0 && ou < 9) { const k = ease(ou / 0.5); ox = (cssW / 2 - (r.x + r.w / 2)) * k; oy = (cssH * 0.4 - (r.y + r.h / 2)) * k; sc = 1 + 0.6 * k; }
  if (crs >= 0 && crs < 0.5) { ox = -cssW * ease(crs / 0.5); }
  if (crs >= 0.5 && crs < 0.8) { oy = -r.h * (1 - ease((crs - 0.5) / 0.3)); }
  const railR = H.rail;
  drawRail(w.timed !== false && w.T ? railR : { x: railR.x, y: railR.y, w: r.w, h: railR.h });
  g.save();
  const cx = r.x + r.w / 2, cy = r.y + railR.h / 2;
  g.translate(cx + ox, cy + oy + drop); g.rotate(swing); g.scale(sc, sc); g.translate(-cx, -cy);
  g.globalAlpha = alpha;
  const by = r.y + railR.h * 0.5;
  // two-course: ticket 2 sits behind as a second, slightly skewed sheet (the meter's second boss names it).
  if (w.tickets.length > 1 && (w.ti || 0) < w.tickets.length - 1) {
    const ox2 = Math.max(4, 6 * u), oy2 = Math.max(2, 3 * u);
    g.save(); g.translate(r.x + r.w, by); g.rotate(0.035); g.translate(-(r.x + r.w), -by);
    tornPaper(r.x + ox2, by + oy2, r.w, r.h - railR.h * 0.5, u, { fill: C.paperS });
    g.restore();
  }
  tornPaper(r.x, by, r.w, r.h - railR.h * 0.5, u);
  // brass clip
  const clipW = Math.max(14, 18 * u), clipH = Math.max(8, 10 * u);
  rr(cx - clipW / 2, r.y - railR.h * 0.1, clipW, clipH, 3); g.fillStyle = C.brass; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
  // header
  const pad = r.pad, hy = r.y + railR.h + Math.max(3, 4 * u) + fs.hdr * 0.6;
  const name = (w.level && w.level.name) || '';
  const head = w.mode === 'daily' ? [STR.dailyLabel + (name ? ' · ' + name : ''), STR.dailyLabel]
    : w.mode === 'feast' ? [STR.feastLabel + ' · ' + ((w.ti || 0) + 1), STR.feastLabel]
    : [fmt(STR.levelLabel, { n, name }), fmt(STR.levelShort, { n })];
  const flipT = T - hud.flip, flipping = flipT >= 0 && flipT < 0.3;
  const showServe = t.done && !(flipping && flipT < 0.15);
  const fsY = flipping ? Math.abs(Math.cos(flipT / 0.3 * Math.PI)) : 1;
  txtMin(head, r.x + r.w / 2, hy, fs.hdr, { col: C.ink, maxW: r.w - 2 * pad });
  const bodyY = hy + fs.hdr * 0.6 + Math.max(2, 3 * u), bodyH = by + r.h - railR.h * 0.5 - Math.max(8, 10 * u) - bodyY;
  g.save(); g.translate(0, bodyY + bodyH / 2); g.scale(1, Math.max(0.05, fsY)); g.translate(0, -(bodyY + bodyH / 2));
  if (showServe) drawServe(w, t, r, bodyY, bodyH);
  else if (L.aspect === 'landscape') drawLinesList(w, t, r, bodyY);
  else drawChips(w, t, r, bodyY);
  g.restore();
  g.restore();
}
function drawServe(w, t, r, y, h) {
  const u = L.u, fs = L.fs, s = Math.min(h, Math.max(26, 30 * u));
  const label = STR.serveIt, tw = measure(label, fs.serve);
  const total = s + Math.max(4, 6 * u) + tw, x0 = r.x + (r.w - total) / 2, cy = y + h / 2;
  const bi = t.boss, open = bi >= 0 && w.ia ? bossState(w, bi) === 'open' : false;
  const pul = 1 + 0.08 * Math.sin(T * TAU * 1.6);
  g.save(); g.translate(x0 + s / 2, cy); g.scale(pul, pul);
  icon(iconFor(bossKind(w, t)), 0, 0, s, (x, y, s) => cloche(x, y, s));
  if (!open) padlock(s * 0.32, s * 0.28, s * 0.5);
  g.restore();
  txt(label, x0 + s + Math.max(4, 6 * u), cy + fs.serve * 0.04, fs.serve, { align: 'left', col: C.stamp, maxW: r.x + r.w - (x0 + s + 6 * u) - r.pad });
}
function bossKind(w, t) {
  if (!t) return 'boss';
  if (t.bossKind) return t.bossKind;
  if (w.level && w.level.items && w.level.items[t.boss]) return kindId(w.level.items[t.boss].kind);
  if (w.kind && t.boss >= 0) return wKind(w, t.boss);
  return 'boss';
}
function cloche(x, y, s) {
  g.save(); g.lineJoin = 'round';
  g.beginPath(); g.arc(x, y + s * 0.18, s * 0.36, Math.PI, 0); g.closePath(); g.fillStyle = '#D9D2C3'; g.fill(); g.lineWidth = Math.max(1.5, s * 0.06); g.strokeStyle = C.ink; g.stroke();
  rr(x - s * 0.44, y + s * 0.16, s * 0.88, s * 0.1, s * 0.04); g.fill(); g.stroke();
  circle(x, y - s * 0.2, s * 0.06); g.fillStyle = C.ink; g.fill();
  g.restore();
}
function chipRing(x, y, d, frac, done, pop, nudge) {
  const u = L.u, lw = Math.max(2.5, 3 * u), rad = d / 2 - lw / 2;
  circle(x, y, d / 2); g.fillStyle = '#FFFDF6'; g.fill();
  g.beginPath(); g.arc(x, y, rad, 0, TAU); g.lineWidth = lw; g.strokeStyle = C.paperS; g.stroke();
  if (frac > 0) { g.beginPath(); g.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1)); g.strokeStyle = C.go; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt'; }
  if (nudge) { g.beginPath(); g.arc(x, y, rad + lw, 0, TAU); g.lineWidth = Math.max(2, 2 * u); g.strokeStyle = `rgba(229,72,59,${nudge.toFixed(2)})`; g.stroke(); }
}
function popK(t0, dur = 0.18) { const k = (T - t0) / dur; return k >= 0 && k < 1 ? 1 + 0.3 * Math.sin(k * Math.PI) : 1; }
function drawChips(w, t, r, y) {
  const u = L.u, fs = L.fs, cm = L.hud.chip, lines = t.lines, n = lines.length;
  const perRow = Math.max(1, r.perRow), rows = Math.ceil(n / perRow);
  const nud = T - hud.chipNudge < 0.6 ? 0.5 + 0.5 * Math.sin((T - hud.chipNudge) * 30) : 0;
  for (let row = 0; row < rows; row++) {
    const k0 = row * perRow, k1 = Math.min(n, k0 + perRow), cnt = k1 - k0;
    const inner = r.w - 2 * r.pad;
    const slot = inner / cnt;
    const cy = y + row * (cm.h + Math.max(2, 3 * u)) + cm.h / 2;
    for (let i = k0; i < k1; i++) {
      const l = lines[i], sx = r.x + r.pad + (i - k0) * slot + slot / 2;
      const x0 = sx - cm.w / 2, rx = x0 + cm.ring / 2;
      const done = l.got >= l.need, frac = l.need ? l.got / l.need : 0;
      chipRing(rx, cy, cm.ring, frac, done, 0, !done ? nud : 0);
      const pk = popK(hud.chipPop[i] ?? -9);
      g.save(); g.translate(rx, cy); g.scale(pk, pk); ingIcon(l.kind, 0, 0, cm.ring * 0.82); g.restore();
      if (done) tick(rx + cm.ring * 0.36, cy + cm.ring * 0.3, Math.max(14, cm.ring * 0.5));
      txt(`${Math.min(l.got, l.need)}/${l.need}`, x0 + cm.ring + Math.max(3, 4 * u), cy + fs.count * 0.05, fs.count,
        { align: 'left', col: done ? '#2E8A45' : C.ink, maxW: cm.countW + 4 });
    }
  }
}
function drawLinesList(w, t, r, y) {
  const u = L.u, fs = L.fs, lh = r.lineH, cm = L.hud.chip;
  const nud = T - hud.chipNudge < 0.6 ? 0.5 + 0.5 * Math.sin((T - hud.chipNudge) * 30) : 0;
  // DECISION: ingredient names share one font size; if any name cannot fit at 12 px, no line shows a name
  //   (a list where only some rows are named reads as broken).
  const nfs0 = Math.max(12, 13 * u), rx0 = r.x + r.pad + cm.ring / 2, nx0 = rx0 + cm.ring / 2 + Math.max(4, 6 * u);
  let nfs = nfs0;
  for (const l of t.lines) {
    const room = r.x + r.w - r.pad - measure(`${l.need}/${l.need}`, fs.count) - Math.max(4, 6 * u) - nx0, mw = measure(nameFor(l.kind), nfs0, FB, '800');
    nfs = Math.min(nfs, room < 34 ? 0 : mw > room ? nfs0 * room / mw : nfs0);
  }
  t.lines.forEach((l, i) => {
    const cy = y + i * lh + lh / 2, rx = r.x + r.pad + cm.ring / 2;
    const done = l.got >= l.need;
    chipRing(rx, cy, Math.min(cm.ring, lh - 2), l.need ? l.got / l.need : 0, done, 0, !done ? nud : 0);
    const pk = popK(hud.chipPop[i] ?? -9);
    g.save(); g.translate(rx, cy); g.scale(pk, pk); ingIcon(l.kind, 0, 0, Math.min(cm.ring, lh - 2) * 0.82); g.restore();
    if (done) tick(rx + cm.ring * 0.36, cy + cm.ring * 0.3, Math.max(14, cm.ring * 0.5));
    const cnt = `${Math.min(l.got, l.need)}/${l.need}`, cw = measure(cnt, fs.count);
    txt(cnt, r.x + r.w - r.pad, cy + fs.count * 0.05, fs.count, { align: 'right', col: done ? '#2E8A45' : C.ink });
    if (nfs >= 12) txt(nameFor(l.kind), nx0, cy + 1, nfs, { f: FB, align: 'left', col: C.ink, maxW: r.x + r.w - r.pad - cw - Math.max(4, 6 * u) - nx0 });
  });
}

// ---- egg timer (D33): tomato kitchen timer clipped to the rail's right end ----
function drawEggTimer(w) {
  // DECISION (D33): cream ring on a tomato-dark track, ink ticks; low time = hot red + rattle. Never green or blue.
  const r = L.hud.timer, u = L.u, fs = L.fs;
  const R = r.w / 2, cx = r.x + R, cy = r.y + R;
  const frac = clamp(w.tLeft / w.T, 0, 1);
  const started = w.tStart != null || hud.started != null;
  const low = started && w.tLeft <= LOW_TIME && w.tLeft > 0;
  let sc = 1, rot = 0;
  if (!started) sc = 1 + 0.04 * (0.5 - 0.5 * Math.cos(T * TAU));          // breathe 1 Hz
  if (low) { sc = 1 + 0.06 * Math.max(0, Math.sin(T * TAU * 2)); rot = Math.sin(T * 120) * 0.12 * Math.max(0, 1 - (T - hud.tick) * 3); }
  const sz = T - hud.sizzle; if (sz >= 0 && sz < 0.35) sc *= 1 + 0.15 * Math.sin(sz / 0.35 * Math.PI);
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(sc, sc); g.lineJoin = 'round';
  const bodyR = R * 0.86, by = R * 0.1;
  // hook to the rail
  g.fillStyle = C.brassD; g.fillRect(-R * 0.05, -R, R * 0.1, R * 0.2);
  // body (tomato) + shadow
  circle(0, by + Math.max(2, 3 * u), bodyR); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  circle(0, by, bodyR);
  const gr = g.createRadialGradient(-bodyR * 0.35, by - bodyR * 0.4, bodyR * 0.1, 0, by, bodyR);
  gr.addColorStop(0, '#FF7A66'); gr.addColorStop(0.6, C.tomato); gr.addColorStop(1, C.tomatoD);
  g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(2, 2.2 * u); g.strokeStyle = C.ink; g.stroke();
  // wind-up knob (cream)
  rr(-R * 0.17, -R * 0.98, R * 0.34, R * 0.26, R * 0.08); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.stroke();
  // ring that drains: cream on a dark-tomato track; hot red at low time (D33: cream, tomato, ink only)
  const ringR = bodyR * 0.76, lw = Math.max(4, 7 * u * (r.w / Math.max(1, 64 * u)));
  g.beginPath(); g.arc(0, by, ringR, 0, TAU); g.lineWidth = lw; g.strokeStyle = C.tomatoD; g.stroke();
  const ringCol = low ? (Math.sin(T * TAU * 2) > 0 ? C.hot : '#FF6A3D') : C.paper;
  if (frac > 0) { g.beginPath(); g.arc(0, by, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * frac); g.lineWidth = lw; g.strokeStyle = ringCol; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt'; }
  // dial face
  const faceR = ringR - lw * 0.5 - Math.max(1, 1.5 * u);
  circle(0, by, faceR); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.2, 1.5 * u); g.strokeStyle = C.ink; g.stroke();
  const sh = T - hud.sizzle;
  if (sh >= 0 && sh < 0.4) { circle(0, by, faceR); g.fillStyle = `rgba(255,211,110,${(0.8 * (1 - sh / 0.4)).toFixed(2)})`; g.fill(); }
  if (low) {
    txt(String(Math.ceil(w.tLeft)), 0, by + fs.secs * 0.06, Math.min(fs.secs, faceR * 1.25), { col: C.stamp, maxW: faceR * 1.7 });
  } else {
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.beginPath(); g.moveTo(Math.sin(a) * faceR * 0.72, by - Math.cos(a) * faceR * 0.72); g.lineTo(Math.sin(a) * faceR * 0.86, by - Math.cos(a) * faceR * 0.86); g.lineWidth = Math.max(1, 1.2 * u); g.strokeStyle = C.ink; g.stroke(); }
    const a = TAU * frac;
    g.beginPath(); g.moveTo(0, by); g.lineTo(Math.sin(a) * faceR * 0.62, by - Math.cos(a) * faceR * 0.62); g.lineWidth = Math.max(2, 2.4 * u); g.lineCap = 'round'; g.strokeStyle = C.ink; g.stroke(); g.lineCap = 'butt';
    circle(0, by, Math.max(2, 2.5 * u)); g.fillStyle = C.ink; g.fill();
  }
  // sizzle: steam puffs rise from the knob (no "+1" text, D33)
  if (sh >= 0 && sh < 0.6) for (let i = 0; i < 3; i++) {
    const k = sh / 0.6, px = (i - 1) * R * 0.28, py = -R * 1.0 - k * R * 0.6 - i * R * 0.08;
    circle(px, py, R * (0.12 + 0.06 * k)); g.fillStyle = `rgba(255,246,227,${(0.9 * (1 - k)).toFixed(2)})`; g.fill();
  }
  // freeze frost 0.6 s
  const fr = T - hud.frost;
  if (fr >= 0 && fr < 0.6) { circle(0, by, bodyR); g.fillStyle = `rgba(255,255,255,${(0.65 * (1 - fr / 0.6)).toFixed(2)})`; g.fill(); }
  g.restore();
}

// ---- size meter ----
function drawMeter(w, dt) {
  // DECISION: the meter scale is logic's meterX/rMaxShown, the boss silhouette sits exactly at needR(boss.a) (GDD §7.8, D33).
  const m = L.hud.meter, u = L.u;
  if (!m || !w.pot) return;
  const tks = w.tickets || [];
  const finalT = tks[tks.length - 1], bi = finalT ? finalT.boss : -1;
  const bossA = bi >= 0 && w.ia ? w.ia[bi] : (finalT && finalT.bossA) || 1.2;
  const r0 = w.pot.r0 || 0.3;
  let rMax = needR(bossA) * 1.15;
  if (LG && LG.rMaxShown) { try { const v = LG.rMaxShown(w); if (v > r0) rMax = v; } catch {} }
  // eased display radius; snaps when crossing a mark
  const target = w.pot.r;
  const marks = [];
  for (const t of tks) if (t.boss >= 0 && w.ia) marks.push(needR(w.ia[t.boss]));
  const prev = hud.rDisp;
  hud.rDisp += (target - hud.rDisp) * (1 - Math.exp(-dt / 0.1));
  for (const mk of marks) if ((prev < mk) !== (target < mk)) { hud.rDisp = target; break; }
  const iconS = Math.max(24, 30 * u), pad = Math.max(4, 6 * u);
  const x0 = m.x + pad + Math.max(8, 10 * u), x1 = m.x + m.w - iconS / 2 - pad, tw = x1 - x0;
  const th = Math.max(12, m.h * 0.48), ty = m.y + (m.h - th) / 2;
  const X = r => x0 + tw * meterX(Math.max(r0, r), r0, rMax);
  g.save(); g.lineJoin = 'round';
  // track
  rr(x0 - Math.max(8, 10 * u), ty, tw + Math.max(8, 10 * u), th, th / 2); g.fillStyle = C.paperS; g.fill();
  g.lineWidth = Math.max(2, 2 * u); g.strokeStyle = C.ink; g.stroke();
  // fill
  const fx = X(hud.rDisp);
  if (fx > x0 - Math.max(8, 10 * u) + th * 0.5) {
    g.save(); rr(x0 - Math.max(8, 10 * u), ty, tw + Math.max(8, 10 * u), th, th / 2); g.clip();
    const gr = g.createLinearGradient(0, ty, 0, ty + th); gr.addColorStop(0, C.goldL); gr.addColorStop(0.6, C.gold); gr.addColorStop(1, C.goldS);
    rr(x0 - Math.max(8, 10 * u) - th, ty, fx - x0 + Math.max(8, 10 * u) + th, th, th / 2); g.fillStyle = gr; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x0 - 12 * u, ty + th * 0.18, fx - x0 + 12 * u, th * 0.2);
    g.restore();
    rr(x0 - Math.max(8, 10 * u), ty, tw + Math.max(8, 10 * u), th, th / 2); g.lineWidth = Math.max(2, 2 * u); g.strokeStyle = C.ink; g.stroke();
  }
  // start rim (tiny pot ring at the left end)
  circle(x0 - Math.max(8, 10 * u), m.y + m.h / 2, th * 0.62); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.strokeStyle = C.ink; g.stroke();
  circle(x0 - Math.max(8, 10 * u), m.y + m.h / 2, th * 0.32); g.fillStyle = C.stew; g.fill();
  // gate ticks (hinge marks)
  if (w.n && w.ia) for (let i = 0; i < w.n; i++) {
    if (w.st && w.st[i] !== 0) continue;
    if (!isGate(w, i)) continue;
    const gx = X(needR(w.ia[i]));
    g.beginPath(); g.moveTo(gx, ty - Math.max(2, 3 * u)); g.lineTo(gx, ty + th + Math.max(2, 3 * u)); g.lineWidth = Math.max(2, 2.4 * u); g.strokeStyle = C.ink; g.stroke();
    circle(gx, ty - Math.max(2, 3 * u), Math.max(2, 2.6 * u)); g.fillStyle = C.gold; g.fill(); g.lineWidth = 1.2; g.stroke();
  }
  // simmer lid line
  if (w.pot.cap && w.pot.cap < 4.1 && w.pot.cap > r0) {
    const lx = X(w.pot.cap);
    g.beginPath(); g.moveTo(lx, ty - Math.max(3, 4 * u)); g.lineTo(lx, ty + th + Math.max(3, 4 * u)); g.lineWidth = Math.max(2.5, 3 * u); g.strokeStyle = C.ink; g.stroke();
    rr(lx - Math.max(5, 6 * u), ty - Math.max(6, 8 * u), Math.max(10, 12 * u), Math.max(4, 4 * u), 2); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 1.5; g.stroke();
  }
  // boss silhouettes (+ padlock while locked)
  tks.forEach((t, k) => {
    if (!(t.boss >= 0) || !w.ia) return;
    const bx = Math.min(X(needR(w.ia[t.boss])), x1), byc = m.y + m.h / 2;
    const state = bossState(w, t.boss), open = state === 'open';
    const reveal = T - hud.reveal < 0.7 ? 1 + 0.12 * Math.sin((T - hud.reveal) * 18) : 1;
    const pulse = T - hud.bossPulse < 0.6 ? 1 + 0.25 * Math.sin((T - hud.bossPulse) / 0.6 * Math.PI) : 1;
    const s = iconS * reveal * pulse * (k < (w.ti || 0) ? 0.8 : 1);
    g.save(); g.translate(bx, byc);
    if (open) {
      const gl = 0.5 + 0.5 * Math.sin(T * TAU * 1.6);
      circle(0, 0, s * 0.62); g.fillStyle = `rgba(255,211,77,${(0.35 + 0.35 * gl).toFixed(2)})`; g.fill();
      icon(iconFor(bossKind(w, t)), 0, 0, s, (x, y, s) => cloche(x, y, s));
    } else {
      circle(0, 0, s * 0.55); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.strokeStyle = C.ink; g.stroke();
      const sil = tinted(iconFor(bossKind(w, t)), s * 0.9, C.ink);
      if (sil) g.drawImage(sil, -s * 0.45, -s * 0.45, s * 0.9, s * 0.9); else cloche(0, 0, s * 0.85);
    }
    if (k < (w.ti || 0)) tick(s * 0.32, -s * 0.28, Math.max(12, s * 0.42), C.stamp);
    // padlock: rattles on bossNudge, pops on 'padlock'
    const pp = T - hud.padPop, rat = T - hud.padRattle;
    const ps = Math.max(14, 16 * u);
    if (!open) {
      g.save(); g.translate(s * 0.3, s * 0.22);
      if (rat >= 0 && rat < 0.4) g.rotate(Math.sin(rat * 45) * 0.35 * (1 - rat / 0.4));
      padlock(0, 0, ps); g.restore();
    } else if (pp >= 0 && pp < 0.5) {
      const k2 = pp / 0.5;
      g.save(); g.translate(s * 0.3, s * 0.22 - k2 * s * 0.8); g.scale(1 + k2, 1 + k2); g.globalAlpha = 1 - k2;
      padlock(0, 0, ps, 1); g.restore();
      for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; circle(Math.cos(a) * s * (0.4 + k2 * 0.6), Math.sin(a) * s * (0.4 + k2 * 0.6), Math.max(1.5, 2.5 * u * (1 - k2))); g.fillStyle = C.glow; g.fill(); }
    }
    g.restore();
  });
  g.restore();
}

// ---- boosters (D33: round spice-tin slots stacked on the side) ----
function drawBoosters(st, w) {
  if (w.mode === 'feast') return;
  const n = (w.level && w.level.n) || hud.n || 0;
  const kinds = ['magnet', 'freeze', 'mega'];
  const stock = (st.boosters) || (M && M.get && M.get().boost) || {};
  const u = L.u;
  // DECISION: a slot shows once the player has reached its unlock level (max of this level and save.cur) or was gifted it;
  //   owned stock alone does not reveal it ("hidden until unlocked", §3.10). Shown slots pack from the top, no gaps.
  let sv = {}; try { sv = (M && M.get && M.get()) || {}; } catch {}
  const reach = Math.max(w.mode === 'level' || !w.mode ? n : 0, sv.cur | 0), gifted = Array.isArray(sv.gifted) ? sv.gifted : [];
  let slot = 0;
  kinds.forEach((kind, i) => {
    const unlocked = reach >= BOOST_UNLOCK[kind] || gifted.includes(kind);
    if (!unlocked) return;
    const r = L.hud.boosters[slot++];
    const used = !!(w.boost && w.boost[kind]);
    const cnt = stock[kind] | 0;
    // DECISION: an empty slot shows its coin price; tapping it buys one (meta.buyBooster) and uses it at once.
    //   Too few coins: the price tag shakes and a short callout says how many coins it needs.
    const b = reg('b-' + kind, r, () => {
      if (used) return;
      if (cnt <= 0) {
        let ok = false; try { ok = !!(M && M.buyBooster && M.buyBooster(kind)); } catch {}
        if (!ok) { hud.boostPoor = { kind, t: T }; callout('boost-poor', 'coin', fmt(STR.needCoins, { n: PRICES[kind] }), 1600); return; }
      }
      act('booster', { kind });
    }, { soft: true, disabled: used || screen !== 'play' });
    const down = isDown(b.id), R = r.w / 2, cx = r.x + R, cy = r.y + R + (down ? 2 : 0);
    g.save(); g.lineJoin = 'round';
    if (used) g.globalAlpha = 0.4;
    // tin: shadow, gold rim band, cream lid, icon
    circle(cx, cy + Math.max(2, 3.5 * u), R); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    circle(cx, cy, R);
    const gr = g.createLinearGradient(0, cy - R, 0, cy + R); gr.addColorStop(0, C.brassL); gr.addColorStop(1, C.brassD);
    g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(2, 2.2 * u); g.strokeStyle = C.ink; g.stroke();
    circle(cx, cy, R * 0.8); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.2, 1.4 * u); g.stroke();
    const fx = T - (hud.boostFx[kind] ?? -9), pk = fx >= 0 && fx < 0.3 ? 1 + 0.3 * Math.sin(fx / 0.3 * Math.PI) : 1;
    g.save(); g.translate(cx, cy); g.scale(pk, pk); glyph(kind, 0, 0, R * 1.25); g.restore();
    // count badge (stamp red, Lilita 12u) or price tag
    const bs = Math.max(18, 20 * u), bx = cx + R * 0.72, byy = cy - R * 0.72;
    if (cnt > 0) {
      circle(bx, byy, bs / 2); g.fillStyle = C.stamp; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
      txt(String(cnt), bx, byy + 0.5, Math.max(12, L.fs.badge), { col: '#fff' });
    } else if (!used) {
      const pw = Math.max(30, 34 * u), ph = Math.max(16, 18 * u);
      const poor = hud.boostPoor && hud.boostPoor.kind === kind && T - hud.boostPoor.t < 0.4 ? Math.sin((T - hud.boostPoor.t) * 60) * 3 : 0;
      g.translate(poor, 0);
      rr(cx - pw / 2, r.y + r.h - ph * 0.55, pw, ph, ph / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
      coin(cx - pw * 0.24, r.y + r.h - ph * 0.55 + ph / 2, ph * 0.34);
      txt(String(PRICES[kind]), cx + pw * 0.12, r.y + r.h - ph * 0.55 + ph / 2 + 0.5, Math.max(12, 12 * u), { col: C.ink });
    }
    g.restore();
  });
}

// ---- edge arrows (§7.6) ----
function worldToScreen(x, z) { try { return RD && RD.worldToScreen ? RD.worldToScreen(x, z) : null; } catch { return null; } }
const onPlay = p => p && p.on !== false && p.x >= L.play.x + 8 && p.x <= L.play.x + L.play.w - 8 && p.y >= L.play.y + 8 && p.y <= L.play.y + L.play.h - 8;
function drawArrows(w) {
  // DECISION (Sim, logic final): an item with w.hid[i] === 1 is hidden (not yet on the board); edge arrows and the
  //   L1 fly-in never point at it, so the arrow always leads to something the player can see and reach.
  if (!RD || !w.tickets || T - hud.reveal < 1.3) return;
  if (hud.result) return;
  const t = w.tickets[w.ti || 0]; if (!t) return;
  const arrows = [];
  if (t.boss >= 0 && !isHid(w, t.boss) && (!w.st || w.st[t.boss] === 0 || w.st[t.boss] === 1)) {
    const p = worldToScreen(w.ix[t.boss], w.iz[t.boss]);
    if (p && !onPlay(p)) arrows.push({ p, ic: iconFor(bossKind(w, t)), boss: true });
    else if (p && T - hud.bossPoint < 3) bouncePointer(p.x, p.y - L.hud.arrow * 0.9);
  }
  if (!t.done && w.n) {
    const open = new Set(t.lines.filter(l => l.got < l.need).map(l => kindId(l.kind)));
    let anyOn = false, best = -1, bd = 1e9;
    for (let i = 0; i < w.n; i++) {
      const s = w.st ? w.st[i] : 0; if (!(s === 0 || s === 3) || isHid(w, i)) continue;
      if (!open.has(itemKind(w, i))) continue;
      const d = (w.ix[i] - w.pot.x) ** 2 + (w.iz[i] - w.pot.z) ** 2;
      if (d < bd) { bd = d; best = i; }
      if (!anyOn) { const p = worldToScreen(w.ix[i], w.iz[i]); if (onPlay(p)) anyOn = true; }
    }
    if (!anyOn && best >= 0) { const p = worldToScreen(w.ix[best], w.iz[best]); if (p) arrows.push({ p, ic: iconFor(itemKind(w, best)) }); }
  }
  for (const a of arrows.slice(0, 2)) edgeArrow(a.p.x, a.p.y, a.ic);
}
const isHid = (w, i) => !!(w.hid && w.hid[i] === 1);
function edgeArrow(tx, ty, ic) {
  // DECISION: an arrow that would overlap the callout bubble moves below it.
  const Z = L.hud.arrowZone, s = L.hud.arrow, cx = L.play.cx, cy = L.play.cy;
  let dx = tx - cx, dy = ty - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  const hx = Z.w / 2 - s / 2, hy = Z.h / 2 - s / 2, zx = Z.x + Z.w / 2, zy = Z.y + Z.h / 2;
  const k = Math.min(Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? hy / Math.abs(dy) : 1e9);
  let ax = zx + dx * k, ay = zy + dy * k;
  // keep clear of a showing callout pill (L1 "Drag to move" sits right where a top arrow lands)
  const cb = L.hud.callout;
  if (callNow && cb && ax + s / 2 > cb.x && ax - s / 2 < cb.x + cb.w && ay + s / 2 > cb.y - 6 && ay - s / 2 < cb.y + cb.h + 6) ay = cb.y + cb.h + 8 + s / 2;
  // keep clear of the booster column
  for (const b of lastBtns) if (b.id.startsWith('b-')) {
    if (ax + s / 2 > b.x - 4 && ax - s / 2 < b.x + b.w + 4 && ay + s / 2 > b.y - 4 && ay - s / 2 < b.y + b.h + 4) ax = b.x - 6 - s / 2;
  }
  const bob = Math.sin(T * TAU * 2) * 3 * L.u;
  ax += dx * bob; ay += dy * bob;
  const ang = Math.atan2(dy, dx);
  g.save(); g.translate(ax, ay); g.lineJoin = 'round';
  g.save(); g.rotate(ang);
  g.beginPath(); g.moveTo(s * 0.72, 0); g.lineTo(s * 0.34, -s * 0.3); g.lineTo(s * 0.34, s * 0.3); g.closePath();
  g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(2, 2 * L.u); g.strokeStyle = C.ink; g.stroke();
  g.restore();
  circle(0, 0, s / 2); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(2, 2 * L.u); g.strokeStyle = C.ink; g.stroke();
  circle(0, 0, s * 0.4); g.fillStyle = C.paper; g.fill();
  icon(ic, 0, 0, s * 0.68, (x, y, s2) => (ic.startsWith('boss') ? cloche(x, y, s2) : blob(x, y, s2, C.stew)));
  g.restore();
}
function bouncePointer(x, y) {
  const s = L.hud.arrow * 0.8, b = Math.abs(Math.sin(T * TAU * 1.5)) * 8 * L.u;
  x = clamp(x, L.play.x + s, L.play.x + L.play.w - s); y = clamp(y - b, L.play.y + s, L.play.y + L.play.h - s);
  g.save(); g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x, y + s * 0.5); g.lineTo(x - s * 0.45, y - s * 0.05); g.lineTo(x - s * 0.18, y - s * 0.05); g.lineTo(x - s * 0.18, y - s * 0.5);
  g.lineTo(x + s * 0.18, y - s * 0.5); g.lineTo(x + s * 0.18, y - s * 0.05); g.lineTo(x + s * 0.45, y - s * 0.05); g.closePath();
  g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(2, 2 * L.u); g.strokeStyle = C.ink; g.stroke();
  g.restore();
}

// ---- chain badge ----
function drawChain(w) {
  const n = w.chain ? w.chain.n : 0, drop = T - hud.chainDrop;
  let show = n >= 3 ? n : (drop >= 0 && drop < 0.35 ? hud.chainShown : 0);
  if (n >= 3) hud.chainShown = n;
  if (!show) return;
  if (n >= 3 && n !== hud.chainSeen) { hud.chainSeen = n; hud.chainInc = T; }
  const p = worldToScreen(w.pot.x, w.pot.z);
  const ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u;
  let x = (p ? p.x : L.play.cx) + ppu * w.pot.r * 1.0, y = (p ? p.y : L.play.cy) - ppu * w.pot.r * 1.1 - 16 * L.u;
  const fs = L.fs.chain, label = fmt(STR.chainShort, { n: show }), tw2 = measure(label, fs);
  x = clamp(x, L.play.x + tw2 / 2 + 8, L.play.x + L.play.w - tw2 / 2 - 8 - (lastBtns.some(b => b.id.startsWith('b-')) ? L.hud.bst + 10 : 0));
  y = clamp(y, L.play.y + fs, L.play.y + L.play.h - fs);
  const inc = T - (hud.chainInc ?? -9), sc = inc >= 0 && inc < 0.18 ? 1 + 0.25 * Math.sin(inc / 0.18 * Math.PI) : 1;
  g.save(); g.translate(x, y + (n < 3 ? drop * 60 : 0)); g.scale(sc, sc);
  if (n < 3) g.globalAlpha = clamp(1 - drop / 0.35, 0, 1);
  txt(label, 0, 0, fs, { col: C.gold, stroke: C.ink, sk: Math.max(3, 3 * L.u) * 2, shadow: 'rgba(58,36,24,0.5)' });
  g.restore();
}

// ---- stick (§2.1) ----
function drawStick(st) {
  if (L.record || /[?&]og=1\b/.test(typeof location !== 'undefined' ? location.search : '')) return;
  let s = null;
  try { s = st.stick || (IN && IN.stick ? IN.stick() : null); } catch {}
  if (!s || !s.show) return;
  const n = hud.n || 0;
  let pref = null; try { pref = M && M.setting ? M.setting('stick') : null; } catch {}
  const on = typeof pref === 'boolean' ? pref : !!s.touch;
  if (!(n <= 6 || on)) return;
  const RAD = s.rad > 0 ? s.rad : clamp(0.1 * Math.min(cssW, cssH), 34, 64);
  g.save();
  circle(s.ax, s.ay, RAD); g.lineWidth = Math.max(2, 2 * L.u); g.strokeStyle = 'rgba(255,246,227,0.22)'; g.stroke();
  g.fillStyle = 'rgba(255,246,227,0.08)'; g.fill();
  circle(s.kx, s.ky, RAD * 0.32); g.fillStyle = 'rgba(255,246,227,0.55)'; g.fill();
  g.restore();
}

// ---- tutorial (§10) ----
function tutorialTick(st, w) {
  const n = hud.n, since = T - hud.t0;
  const moved = hud.started != null || w.tStart != null;
  // L1–L2: ghost hand after 1.2 s of no input; "Drag to move" only after 4 s (tut bit 1)
  hud.ghost = !moved && n <= 2 && !tutHas('drag') && since > 1.2;
  if (!moved && n <= 2 && !tutHas('drag') && since > 4 && !hud.idleCall) { hud.idleCall = true; callout('tut-drag', 'hand', STR.dragToMove, 2500); }
  // twist intros: one ≤ 4-word callout if the player stalls 4 s (no bites)
  const tw = { 4: ['pens', STR.growToOpen], 34: ['simmer', STR.lidOn] }[n];
  if (tw && moved && !hud.twistCall && T - hud.lastBite > 4 && !tutHas(tw[0])) { hud.twistCall = true; tutSet(tw[0]); callout('twist-' + n, 'padlock', tw[1], 2500); }
  // L1: the bouncing gold pointer stays on the flown-to sandwich until it is eaten
  if (hud.hintItem >= 0 && w.st && w.st[hud.hintItem] !== 0) hud.hintItem = -1;
}
function startFly() {
  // DECISION: the L1 fly-in skips hidden items (w.hid[i] === 1), as the edge arrows do.
  const w = lastW; if (!w || !w.tickets) return;
  const t = w.tickets[w.ti || 0]; if (!t || !t.lines.length) return;
  const kid = kindId(t.lines[0].kind);
  let best = -1, bd = 1e9;
  for (let i = 0; i < (w.n || 0); i++) {
    if ((w.st && w.st[i] !== 0) || isHid(w, i)) continue;
    if (itemKind(w, i) !== kid) continue;
    const d = (w.ix[i] - w.pot.x) ** 2 + (w.iz[i] - w.pot.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  hud.flown = true; tutSet('recipe');
  hud.fly = { t0: T, i: best, kind: kid };
  hud.hintItem = best;
}
function drawFly(w) {
  if (hud.hintItem >= 0 && (!hud.fly || T - hud.fly.t0 > 0.6)) {
    const p = worldToScreen(w.ix[hud.hintItem], w.iz[hud.hintItem]);
    if (p && onPlay(p)) bouncePointer(p.x, p.y - L.hud.arrow);
  }
  const f = hud.fly; if (!f) return;
  const k = (T - f.t0) / 0.6; if (k >= 1) return;
  const r = L.hud.ticket, cm = L.hud.chip;
  const sx = L.aspect === 'landscape' ? r.x + r.pad + cm.ring / 2 : r.x + r.pad + (r.w - 2 * r.pad) / Math.max(1, Math.min(r.perRow, curLines)) / 2 - cm.w / 2 + cm.ring / 2;
  const sy = r.y + r.h * 0.65;
  const p = worldToScreen(w.ix[f.i], w.iz[f.i]) || { x: L.play.cx, y: L.play.cy };
  const e = ease(k), mx = (sx + p.x) / 2, my = Math.min(sy, p.y) - 80 * L.u;
  const x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * p.x, y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * p.y;
  g.save(); g.translate(x, y); const s = 1 + 0.6 * Math.sin(k * Math.PI); g.scale(s, s);
  ingIcon(f.kind, 0, 0, cm.ring); g.restore();
}
function drawGhost(w) {
  if (!hud.ghost) return;
  const p = worldToScreen(w.pot.x, w.pot.z) || { x: L.play.cx, y: L.play.cy };
  const u = L.u, cyc = ((T - hud.t0 - 1.2) % 1.8 + 1.8) % 1.8;
  let dy = 0, sc = 1, a = 1;
  if (cyc < 0.25) { sc = 1 - 0.12 * (cyc / 0.25); a = cyc / 0.25; }
  else if (cyc < 1.25) { sc = 0.88; dy = -ease((cyc - 0.25) / 1.0) * 90 * u; }
  else { sc = 0.88 + 0.12 * ((cyc - 1.25) / 0.55); dy = -90 * u; a = 1 - (cyc - 1.25) / 0.55; }
  const x = p.x + 6 * u, y = p.y + 30 * u + dy;
  if (cyc >= 0.25 && cyc < 1.25) { g.save(); g.globalAlpha = 0.35 * a; circle(p.x, p.y + 6 * u, 18 * u); g.fillStyle = C.paper; g.fill(); g.restore(); }
  g.save(); g.globalAlpha = clamp(a, 0, 1); g.translate(x, y); g.scale(sc * u * 1.1, sc * u * 1.1);
  hand();
  g.restore();
}
function hand() {
  // canvas-drawn pointing hand, paper fill + ink stroke (no art file)
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 2.6; g.strokeStyle = C.ink; g.fillStyle = C.paper;
  rr(-6, -34, 13, 40, 6.5); g.fill(); g.stroke();                     // index finger
  rr(-16, -2, 36, 34, 12); g.fill(); g.stroke();                      // palm
  for (let i = 0; i < 3; i++) { rr(7 + i * 0 - 1 + i * 0, -10 + i * 0, 0, 0, 0); }
  rr(6, -12, 11, 20, 5.5); g.fill(); g.stroke();                       // middle knuckle
  rr(15, -8, 10, 18, 5); g.fill(); g.stroke();
  rr(-22, 2, 14, 11, 5.5); g.fill(); g.stroke();                       // thumb
  rr(-15, 20, 34, 13, 6); g.fill(); g.stroke();                        // cuff
  g.beginPath(); g.arc(0.5, -27, 3, Math.PI * 1.1, Math.PI * 1.9); g.lineWidth = 1.6; g.stroke();
}

// ---- order up (boss bite): stamp lands on the ticket in screen centre ----
function drawOrderUp(w) {
  const k = T - hud.orderUp;
  if (k < 0.55 || k > 9) return;
  const r = L.hud.ticket, s = Math.min(cssW * 0.6, 260 * L.u);
  const x = cssW / 2, y = cssH * 0.4;
  const e = clamp((k - 0.55) / 0.18, 0, 1), sc = 2.2 - 1.2 * back(e);
  stampMark(x, y, s, STR.orderUp, sc, -0.18, e);
}
function stampMark(x, y, s, label, sc = 1, rot = -0.15, a = 1) {
  // DECISION: word stamps are a drawn rectangular rubber stamp (double red border, cream wash), not the round
  //   ui-stamp seal: a ring art crosses the letters and "ORDER UP!" stops reading at a glance (D33 ink-stamp style).
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = clamp(a, 0, 1);
  const fsz = s * 0.2, tw0 = measure(label, fsz), rw = Math.min(s, tw0 + s * 0.2), rh = s * 0.36;
  rr(-rw / 2, -rh / 2, rw, rh, rh * 0.18); g.fillStyle = 'rgba(255,246,227,0.85)'; g.fill();
  g.lineWidth = Math.max(3, s * 0.03); g.strokeStyle = C.stamp; g.stroke();
  rr(-rw / 2 + s * 0.028, -rh / 2 + s * 0.028, rw - s * 0.056, rh - s * 0.056, rh * 0.12); g.lineWidth = Math.max(1.5, s * 0.011); g.stroke();
  txt(label, 0, s * 0.012, fsz, { col: C.stamp, maxW: rw - s * 0.12, min: 12 });
  g.restore();
}

// ---- callout ----
function drawCallout(dt) {
  if (!callNow && calloutQ.length) { callNow = calloutQ.shift(); callNow.t = 0; }
  if (!callNow) return;
  callNow.t += dt;
  const c = callNow, dur = c.ms / 1000;
  if (c.t > dur + 0.15) { callNow = null; return; }
  const band = L.hud.callout, u = L.u, fs = L.fs.callout;
  const icS = Math.max(20, 24 * u), padX = Math.max(10, 14 * u);
  const maxW = band.w - 2 * padX - icS - 6;
  let size = fs; let tw2 = measure(c.text, size, FB, '800');
  if (tw2 > maxW) { size = Math.max(12.5, size * maxW / tw2); tw2 = measure(c.text, size, FB, '800'); }
  const h = Math.min(band.h, Math.max(icS + 8, size * 2)), w = Math.min(band.w, tw2 + icS + 2 * padX + 6 * u);
  const x = band.x + (band.w - w) / 2, y = band.y + (band.h - h) / 2;
  const sc = c.t < 0.18 ? back(c.t / 0.18) * 0.4 + 0.6 : c.t > dur ? 1 - (c.t - dur) / 0.15 : 1;
  g.save(); g.translate(x + w / 2, y + h / 2); g.scale(sc, sc); g.translate(-(x + w / 2), -(y + h / 2));
  rr(x, y + 3, w, h, h / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  rr(x, y, w, h, h / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(2, 2 * u); g.strokeStyle = C.ink; g.stroke();
  const ix = x + padX + icS / 2, cy = y + h / 2;
  if (c.icon === 'hand') { g.save(); g.translate(ix, cy + 2); g.scale(icS / 70, icS / 70); hand(); g.restore(); }
  else if (c.icon === 'padlock') padlock(ix, cy, icS);
  else if (c.icon) glyph(c.icon, ix, cy, icS);
  txt(c.text, ix + icS / 2 + 6 * u, cy + 1, size, { f: FB, align: 'left', col: C.ink });
  g.restore();
}

// =====================================================================================
// Cards
// =====================================================================================
function cardIn() {
  const a = clamp(cardT / 0.15, 0, 1), k = ease(cardT / 0.22);
  dimBg(a);
  return (1 - k) * (cssH * 0.5);
}

function drawTitle(st) {
  const sv = (M && M.get && M.get()) || {};
  const cur = sv.cur || 1, starsTot = Array.isArray(sv.stars) ? sv.stars.reduce((a, b) => a + (b | 0), 0) : (sv.starsTotal | 0);
  const firstBoot = cur <= 1 && !starsTot;
  const showMute = !!P.showMute;
  const CL = cardLayout(L, 'title', { firstBoot, showMute });
  const B = CL.blocks, fs = CL.fs, u = L.u;
  // soft vignette so the logo/buttons read over the live 3D title scene
  const gr = g.createLinearGradient(0, 0, 0, cssH);
  gr.addColorStop(0, 'rgba(255,246,227,0.55)'); gr.addColorStop(0.35, 'rgba(255,246,227,0)'); gr.addColorStop(0.75, 'rgba(58,36,24,0)'); gr.addColorStop(1, 'rgba(58,36,24,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, cssW, cssH);
  // logo wordmark: Lilita, gold fill, ink 6u stroke, 3u drop
  const lb = B.logo, ls = Math.min(fs.logo, lb.h * 0.62);
  const wob = Math.sin(T * 1.6) * 0.02;
  g.save(); g.translate(lb.x + lb.w / 2, lb.y + lb.h * 0.55); g.rotate(-0.04 + wob);
  txt(STR.title, 0, 0, ls, { col: C.gold, stroke: C.ink, sk: Math.max(5, ls * 0.16), shadow: C.ink, maxW: lb.w * 0.96, min: 24 });
  g.restore();
  // pot hero bobbing
  if (B.pot.h > 40) {
    const s = Math.min(B.pot.w * 0.8, B.pot.h * 0.98), bob = Math.sin(T * 2.2) * s * 0.025;
    g.save(); g.beginPath(); g.ellipse(B.pot.x + B.pot.w / 2, B.pot.y + B.pot.h / 2 + s * 0.42, s * 0.34, s * 0.06, 0, 0, TAU); g.fillStyle = 'rgba(58,36,24,0.22)'; g.fill(); g.restore();
    potArt('pot-hero', B.pot.x + B.pot.w / 2, B.pot.y + B.pot.h / 2 + bob, s);
  }
  // PLAY
  const label = firstBoot ? STR.play : fmt(STR.playN, { n: Math.min(cur, LEVELS) });
  const pb = reg('play', B.play, () => act('play'), { primary: true });
  const pulse = 0.5 + 0.5 * Math.sin(T * 4);
  g.save(); const s = isDown('play') ? 1 : 1 + 0.025 * pulse; g.translate(B.play.x + B.play.w / 2, B.play.y + B.play.h / 2); g.scale(s, s); g.translate(-(B.play.x + B.play.w / 2), -(B.play.y + B.play.h / 2));
  goldBtn(pb, label, { fs: fs.play, glow: pulse, alts: [STR.play] });
  g.restore();
  // coins / stars pills
  if (B.coins) { pill(B.coins, 'coin', String(sv.coins | 0), fs.pill); pill(B.stars, 'star', String(starsTot), fs.pill); }
  if (B.mute) {
    const mb = reg('mute', B.mute, () => toggleMute(st));
    roundBtn(mb, st.muted ? 'mute' : 'sound');
  }
  if (B.icons) {
    const dly = (() => { try { return M && M.dailyStatus ? M.dailyStatus() : null; } catch { return null; } })();
    for (const ic of B.icons) {
      const id = ic.id;
      const locked = (id === 'daily' && cur <= DAILY_UNLOCK) || (id === 'feast' && cur <= FEAST_UNLOCK);
      const b = reg(id, ic.r, () => act('screen', { screen: id }));
      roundBtn(b, id === 'settings' ? 'ladle' : id, { dim: locked });
      const lab = id === 'cookbook' ? [STR.cookbook, STR.cookbookShort] : [STR[id] || id];
      txtMin(lab, ic.lab.x + ic.lab.w / 2, ic.lab.y + ic.lab.h / 2, fs.label, { f: FB, col: C.ink, maxW: ic.lab.w, stroke: 'rgba(255,246,227,0.9)', sk: 4 });
      const bx = ic.r.x + ic.r.w * 0.86, by = ic.r.y + ic.r.h * 0.14, br = Math.max(10, 11 * u);
      if (locked) { badge(bx, by, br, fmt(STR.levelShort, { n: id === 'daily' ? DAILY_UNLOCK : FEAST_UNLOCK }), C.ink); }
      else if (id === 'daily' && dly) badge(bx, by, br, dly.done ? String(dly.streak || 0) : '!', dly.done ? C.go : C.stamp);
    }
  }
}
function badge(x, y, r, s, col) {
  const fs2 = Math.max(12, r * 1.1), w2 = Math.max(r * 2, measure(s, fs2) + r);
  rr(x - w2 / 2, y - r, w2, r * 2, r); g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
  txt(s, x, y + 0.5, fs2, { col: '#fff' });
}
function pill(r, ic, s, fs2) {
  rr(r.x, r.y + 3, r.w, r.h, r.h / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  rr(r.x, r.y, r.w, r.h, r.h / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
  const is = r.h * 0.72;
  if (ic === 'coin') coin(r.x + r.h / 2, r.y + r.h / 2, is * 0.42); else drawStar(r.x + r.h / 2, r.y + r.h / 2, is * 0.46, true);
  txt(s, r.x + r.h + (r.w - r.h - 8) / 2, r.y + r.h / 2 + 1, fs2, { col: C.ink, maxW: r.w - r.h - 10 });
}
function roundBtn(b, gl, o = {}) {
  const down = isDown(b.id), R = Math.min(b.w, b.h) / 2, cx = b.x + b.w / 2, cy = b.y + b.h / 2 + (down ? 2 : 0);
  g.save(); if (o.dim) g.globalAlpha = 0.55;
  circle(cx, cy + Math.max(2, 3 * L.u) - (down ? 2 : 0), R); g.fillStyle = 'rgba(58,36,24,0.35)'; g.fill();
  circle(cx, cy, R); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(2, 2.2 * L.u); g.strokeStyle = C.ink; g.stroke();
  glyph(gl, cx, cy, R * 1.3);
  g.restore();
}
// DECISION: mute is Core's session flag (view().userMuted); the UI only asks for the flip.
function toggleMute(st) { act('mute', { on: !(st && st.userMuted) }); }

// ui-ticket.webp (382x512): alpha bbox 88,87 205x321; cream paper below the clip and above the torn edge is
// x 105..277, y 160..352, kept as fractions of the bbox in p = [x0, y0, x1, y1].
const TICKET_ART = { W: 382, H: 512, bx: 88, by: 87, bw: 205, bh: 321, ar: 205 / 321, p: [0.083, 0.227, 0.922, 0.826] };
function drawWin(st, w) {
  // DECISION: ticket ingredient art is drawn at 1.45x (the kie ing-* art carries ~30 % padding).
  // DECISION (Core report): the clipboard art is drawn cropped to its alpha bbox (it fills the hero slot), and every
  //   ticket row (No. N + red tick, ingredient + "×n" + green tick, boss) is placed inside the art's measured paper box
  //   (TICKET_ART.p), never at fixed fractions of the card, so nothing sits on the clip or the board edge.
  // DECISION: coins 0 (a replay with no new stars) hides the coin row instead of showing "+0".
  const d = cardData.win || {};
  const CL = cardLayout(L, 'win', { nextSkin: !!d.nextSkin });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  // heading: red ORDER UP! stamp lands at +0.35 s
  const hs = Math.min(B.head.w * 0.78, B.head.h * 2.1);
  const sk = clamp((cardT - 0.35) / 0.16, 0, 1);
  if (cardT >= 0.35) stampMark(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2, hs, STR.orderUp, 1.8 - 0.8 * back(sk), -0.08, sk * 1.2);
  // hero: ticket + happy pot
  if (B.hero.h > 40) {
    const hh = B.hero.h;
    const th = Math.min(hh * 0.98, (B.hero.w * 0.46) / TICKET_ART.ar), tw2 = th * TICKET_ART.ar;
    const tx = B.hero.x + B.hero.w * 0.27 - tw2 / 2, ty = B.hero.y + (hh - th) / 2;
    const im = img('ui-ticket');
    g.save(); g.translate(tx + tw2 / 2, ty + th / 2); g.rotate(-0.06); g.translate(-(tx + tw2 / 2), -(ty + th / 2));
    let P;
    if (im) {
      const A = TICKET_ART, sx = (im.naturalWidth || im.width) / A.W, sy = (im.naturalHeight || im.height) / A.H;
      g.drawImage(im, A.bx * sx, A.by * sy, A.bw * sx, A.bh * sy, tx, ty, tw2, th);
      P = { x: tx + tw2 * A.p[0], y: ty + th * A.p[1], w: tw2 * (A.p[2] - A.p[0]), h: th * (A.p[3] - A.p[1]) };
    } else {
      tornPaper(tx, ty, tw2, th, cu);
      P = { x: tx + tw2 * 0.07, y: ty + th * 0.06, w: tw2 * 0.86, h: th * 0.8 };
    }
    // header row: "No. N" on the left, the red order tick on the right, a rule under both
    const pad = P.w * 0.07, hH = Math.max(16, Math.min(P.h * 0.2, P.w * 0.24));
    const ln = (d.n | 0) || (w && w.level && w.level.n) || 0;
    const rt = Math.min(hH * 0.86, P.w * 0.22);
    if (ln) txt('No. ' + ln, P.x + pad, P.y + hH / 2 + 1, Math.max(12, Math.min(hH * 0.52, 18 * cu)), { align: 'left', col: C.ink, maxW: P.w - pad * 3 - rt });
    g.beginPath(); g.moveTo(P.x + pad * 0.6, P.y + hH); g.lineTo(P.x + P.w - pad * 0.6, P.y + hH); g.lineWidth = 1.5; g.strokeStyle = 'rgba(58,36,24,0.35)'; g.stroke();
    const tk = w && w.tickets ? w.tickets[w.tickets.length - 1] : null;
    if (tk) {
      // rows: ingredient icon, "×need", green tick; the served boss closes the list under a dashed rule
      const rows = tk.lines.map(l => ({ kind: l.kind, n: l.need }));
      if (tk.boss >= 0 || tk.bossKind) rows.push({ boss: true });
      const y0 = P.y + hH + P.h * 0.03, avail = P.y + P.h - P.h * 0.02 - y0;
      const rowH = Math.min(avail / Math.max(1, rows.length), P.w * 0.32);
      const is = Math.min(rowH * 0.9, P.w * 0.3), ts = Math.min(rowH * 0.66, P.w * 0.19);
      const ix = P.x + pad + is / 2, tkx = P.x + P.w - pad - ts / 2, txl = P.x + pad + is + Math.max(3, P.w * 0.04);
      const fsz = Math.max(12, Math.min(rowH * 0.5, 24 * cu));
      rows.forEach((r, i) => {
        const y = y0 + i * rowH + rowH / 2;
        if (r.boss) {
          g.beginPath(); g.moveTo(P.x + pad * 0.6, y - rowH / 2); g.lineTo(P.x + P.w - pad * 0.6, y - rowH / 2); g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(58,36,24,0.45)'; g.stroke(); g.setLineDash([]);
          icon(iconFor(bossKind(w, tk)), ix, y, is * 1.45, (x, y2) => cloche(x, y2, is * 1.05));   // boss art has the same padding
        } else {
          ingIcon(r.kind, ix, y, is * 1.45);                                  // ing art carries ~30 % padding
          txt('×' + r.n, txl, y + 1, fsz, { align: 'left', col: C.ink, maxW: Math.max(8, tkx - ts / 2 - txl - 2) });
        }
        tick(tkx, y, ts);
      });
    }
    if (cardT >= 0.45) { const k = clamp((cardT - 0.45) / 0.15, 0, 1); g.globalAlpha = k; tick(P.x + P.w - pad - rt / 2, P.y + hH / 2, rt, C.stamp); }
    g.restore();
    const ps = Math.min(B.hero.w * 0.5, hh * 1.05), bob = Math.sin(T * 3) * ps * 0.02;
    potArt('pot-happy', B.hero.x + B.hero.w * 0.73, B.hero.y + hh / 2 + bob, ps);
  }
  // stars fill one by one (0.25 s each) from +0.6 s
  const S = B.stars, n = clamp(d.stars | 0, 0, 3), sr = Math.min(S.h * 0.46, S.w / 8);
  for (let i = 0; i < 3; i++) {
    const t0 = 0.6 + i * 0.25, k = clamp((cardT - t0) / 0.2, 0, 1), on = i < n && cardT >= t0;
    const x = S.x + S.w / 2 + (i - 1) * sr * 2.6, y = S.y + S.h / 2 + (i === 1 ? -sr * 0.18 : sr * 0.1);
    let sc = on ? 1 + 0.35 * Math.sin(k * Math.PI) : 1;
    if (!on && hud && hud.starHint && cardT > 1.4 && cardT < 4) sc = 1 + 0.06 * Math.sin(cardT * 30);
    g.save(); g.translate(x, y); g.scale(sc, sc); drawStar(0, 0, i === 1 ? sr * 1.12 : sr, on); g.restore();
  }
  // stats: time left · best chain (or the first-time "Faster = more" hint)
  const st2 = B.stats, cy = st2.y + st2.h / 2;
  if (hud && hud.starHint && cardT > 1.4 && cardT < 4.4) {
    const tw3 = measure(STR.fasterStars, fs.stat, FB, '800') + fs.stat * 1.4;
    txt(STR.fasterStars, st2.x + st2.w / 2 - fs.stat * 0.7, cy, fs.stat, { f: FB, col: C.ink, maxW: st2.w - fs.stat * 2 });
    drawStar(st2.x + st2.w / 2 + tw3 / 2 - fs.stat * 0.55, cy, fs.stat * 0.55, true);
    if (cardT > 4.3) tutSet('stars');
  } else {
    const tl = Math.max(0, Math.round(d.tLeft || 0)), tStr = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
    const cells = [];
    if (d.kind !== 'feast' && d.tLeft != null && (d.n | 0) !== 1) cells.push(['clock', fmt(STR.timeLeft, { t: tStr })]);
    if (d.chainBest) cells.push(['chain', fmt(STR.bestChain, { n: d.chainBest })]);
    const cw = st2.w / Math.max(1, cells.length);
    cells.forEach(([ic, s], i) => {
      const x0 = st2.x + i * cw, is = fs.stat * 1.2, tws = Math.min(measure(s, fs.stat, FB, '800'), cw - is - 10);
      const sx = x0 + (cw - (is + 6 + tws)) / 2;
      glyph(ic, sx + is / 2, cy, is);
      txt(s, sx + is + 6, cy + 1, fs.stat, { f: FB, align: 'left', col: C.ink, maxW: cw - is - 10 });
    });
  }
  // coins count up
  const co = B.coins, total = d.coins | 0, ck = clamp((cardT - 1.0) / 0.8, 0, 1), shown = Math.round(total * ease(ck));
  // a replay that earns nothing shows no "+0" row (and no coin tick)
  if (total > 0) {
    if (ck > 0 && ck < 1 && Math.floor(shown / Math.max(1, total / 12)) !== hud?._coinTick) { if (hud) hud._coinTick = Math.floor(shown / Math.max(1, total / 12)); sfx('coin'); }
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = measure(cs, cfs);
    const cr = cfs * 0.55, cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
  }
  if (B.hint && d.nextSkin) {
    const ns = typeof d.nextSkin === 'string' ? d.nextSkin : fmt(STR.nextSkin, { skin: d.nextSkin.name || d.nextSkin.id || '', n: d.nextSkin.need ?? d.nextSkin.coins ?? '' });
    txt(ns, B.hint.x + B.hint.w / 2, B.hint.y + B.hint.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.hint.w });
  }
  // NEXT (auto-highlight after 0.9 s) · Replay · Map
  const last = (d.n | 0) >= LEVELS && (d.kind || 'level') === 'level';
  const nb = reg('next', B.next, () => act('next'), { primary: true });
  const hi = cardT > 0.9 ? 0.5 + 0.5 * Math.sin((cardT - 0.9) * 5) : 0;
  goldBtn(nb, last ? STR.allDoneBtn : STR.next, { u: cu, fs: fs.btn, glow: hi });
  paperBtn(reg('replay', B.replay, () => act('retry')), STR.replay, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('map', B.map, () => act('map')), STR.map, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('map', x, y, s) });
  g.restore();
}

function failHeading(d) {
  if (d.why === 'spoiled') return STR.spoiled;
  const size = +d.progress || 0;
  const miss = (d.missing || []).reduce((s, l) => s + Math.max(0, (l.need | 0) - (l.got | 0)), 0);
  if (size >= 0.9 && miss <= 1) return STR.soClose;
  if (size >= 0.7 || miss <= 2) return STR.almost;
  return STR.outOfTime;
}
function drawFail(st, w) {
  // DECISION: the spoiled sub line falls back to the current ticket's open lines to name the missing ingredient.
  const d = cardData.fail || {};
  const canFreeze = d.why !== 'spoiled' && !!d.canFreeze;
  const CL = cardLayout(L, 'fail', { canFreeze });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  // heading (§5.4 rule) stamped in
  const head = failHeading(d), hk = clamp((cardT - 0.2) / 0.16, 0, 1);
  g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.04); const hsc = 1.5 - 0.5 * back(hk); g.scale(hsc, hsc); g.globalAlpha = clamp(hk * 1.5, 0, 1);
  txt(head, 0, 0, fs.head, { col: head === STR.soClose ? C.stamp : C.ink, stroke: C.paper, sk: 4, maxW: B.head.w * 0.95, min: 18 });
  g.restore();
  // sub line
  if (B.sub) {
    const cy = B.sub.y + B.sub.h / 2;
    if (d.why === 'spoiled') {
      const tl = w && w.tickets && w.tickets[w.ti || 0] ? w.tickets[w.ti || 0].lines : [];
      const miss = [...(d.missing || []), ...tl].find(l => (l.need | 0) > (l.got | 0));
      const nMore = miss ? Math.max(1, (miss.need | 0) - (miss.got | 0)) : 1;
      const s = fmt(STR.nMore, { n: nMore }), is = fs.body * 1.6, tws = measure(s, fs.body, FB, '800');
      const x0 = B.sub.x + (B.sub.w - is - 6 - tws) / 2;
      if (miss) ingIcon(miss.kind, x0 + is / 2, cy, is); else glyph('clock', x0 + is / 2, cy, is);
      txt(s, x0 + is + 6, cy + 1, fs.body, { f: FB, align: 'left', col: C.ink });
    } else {
      const n = d.n || (w && w.level && w.level.n) || 0, name = (w && w.level && w.level.name) || '';
      txtMin([fmt(STR.levelLabel, { n, name }), fmt(STR.levelShort, { n })], B.sub.x + B.sub.w / 2, cy, fs.body, { f: FB, col: C.ink, maxW: B.sub.w });
    }
  }
  if (B.hero.h > 40) potArt('pot-sad', B.hero.x + B.hero.w / 2, B.hero.y + B.hero.h / 2, Math.min(B.hero.w * 0.6, B.hero.h * 1.05));
  // size bar: start rim -> boss silhouette, flag at progress (size only)
  {
    const r = B.bar, p = clamp(+d.progress || 0, 0, 1), th = Math.max(14, Math.min(r.h * 0.34, 18 * cu));
    const bS = Math.min(r.h * 0.95, Math.max(30, 40 * cu)), x0 = r.x + th, x1 = r.x + r.w - bS * 0.6, y = r.y + r.h * 0.58;
    rr(x0 - th / 2, y - th / 2, x1 - x0 + th / 2, th, th / 2); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const fk = ease(clamp((cardT - 0.3) / 0.6, 0, 1)), fx = x0 + (x1 - x0) * p * fk;
    g.save(); rr(x0 - th / 2, y - th / 2, x1 - x0 + th / 2, th, th / 2); g.clip();
    rr(x0 - th, y - th / 2, fx - x0 + th, th, th / 2); g.fillStyle = C.gold; g.fill(); g.restore();
    rr(x0 - th / 2, y - th / 2, x1 - x0 + th / 2, th, th / 2); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    circle(x0 - th * 0.4, y, th * 0.62); g.fillStyle = C.gold; g.fill(); g.stroke(); circle(x0 - th * 0.4, y, th * 0.3); g.fillStyle = C.stew; g.fill();
    const tk = w && w.tickets ? w.tickets[w.ti || 0] : null;
    const bx = x1 + bS * 0.1;
    circle(bx, y, bS * 0.5); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const sil = tinted(iconFor(bossKind(w || {}, tk)), bS * 0.8, C.ink);
    if (sil) g.drawImage(sil, bx - bS * 0.4, y - bS * 0.4, bS * 0.8, bS * 0.8); else cloche(bx, y, bS * 0.8);
    // flag at the reached point
    const fh = Math.min(r.h * 0.55, 22 * cu + 8);
    g.beginPath(); g.moveTo(fx, y - th / 2); g.lineTo(fx, y - th / 2 - fh); g.lineWidth = 2.2; g.strokeStyle = C.ink; g.stroke();
    g.beginPath(); g.moveTo(fx, y - th / 2 - fh); g.lineTo(fx + fh * 0.7, y - th / 2 - fh * 0.75); g.lineTo(fx, y - th / 2 - fh * 0.5); g.closePath();
    g.fillStyle = C.stamp; g.fill(); g.lineWidth = 1.5; g.stroke();
  }
  // ticket lines with rings (missing ones pulse)
  {
    const r = B.lines, lines = (w && w.tickets && w.tickets[w.ti || 0] ? w.tickets[w.ti || 0].lines : null) || d.missing || [];
    const n = lines.length || 1, d0 = Math.min(r.h * 0.9, Math.max(34, 44 * cu)), cnt = Math.max(12, fs.count);
    const cellW = Math.min(r.w / n, d0 * 1.04 + cnt * 2.4 + 18);
    const x0 = r.x + (r.w - cellW * n) / 2;
    lines.forEach((l, i) => {
      const cx = x0 + i * cellW + d0 / 2 + 4, cy = r.y + r.h / 2, done = l.got >= l.need;
      const pl = done ? 1 : 1 + 0.08 * Math.sin(T * TAU * 1.5);
      g.save(); g.translate(cx, cy); g.scale(pl, pl);
      const sv = L.u; L.u = cu; chipRing(0, 0, d0, l.need ? l.got / l.need : 0, done, 0, done ? 0 : 0.6 + 0.4 * Math.sin(T * TAU * 1.5)); L.u = sv;
      ingIcon(l.kind, 0, 0, d0 * 0.78); if (done) tick(d0 * 0.34, d0 * 0.3, Math.max(12, d0 * 0.42));
      g.restore();
      txt(`${Math.min(l.got, l.need)}/${l.need}`, cx + d0 * 0.54 + 6, cy + 1, cnt, { align: 'left', col: done ? '#2E8A45' : C.stamp, maxW: cellW - d0 * 1.04 - 10 });
    });
  }
  if (B.freeze) {
    const cost = d.freezeCost ?? (((M && M.get && M.get().boost) || {}).freeze > 0 ? 0 : PRICES.freeze);
    const fb = reg('freeze', B.freeze, () => act('freeze'));
    // price tag (coin + cost) rides right after the label, so the whole row stays centred
    const pfs = Math.max(13, 15 * cu), cr = Math.max(7, 8.5 * cu), pw = cr * 2 + 4 + measure(String(cost), pfs);
    const tail = cost ? { w: pw, draw: (x, cy) => { coin(x + cr, cy, cr); txt(String(cost), x + cr * 2 + 4, cy + 1, pfs, { align: 'left', col: C.ink }); } } : null;
    paperBtn(fb, STR.freeze, { u: cu, fs: fs.btn2, f: FB, alts: [STR.freezeShort], tail, icon: (x, y, s) => glyph('freeze', x, y, s * 1.15) });
  }
  const rb = reg('retry', B.retry, () => act('retry'), { primary: true });
  goldBtn(rb, STR.retry, { u: cu, fs: Math.max(fs.btn, 26 * cu), glow: cardT > 0.6 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('map', B.map, () => act('map')), STR.map, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('map', x, y, s) });
  g.restore();
}

function drawPause(st, w) {
  const CL = cardLayout(L, 'pause', { showMute: !!P.showMute });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(STR.paused, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  const n = (w && w.level && w.level.n) || (st.level | 0), name = (w && w.level && w.level.name) || '';
  txtMin([fmt(STR.levelLabel, { n, name }), fmt(STR.levelShort, { n })], B.level.x + B.level.w / 2, B.level.y + B.level.h / 2, fs.body, { f: FB, col: C.goldS, maxW: B.level.w });
  goldBtn(reg('resume', B.resume, () => act('resume'), { primary: true }), STR.resume, { u: cu, fs: fs.btn, icon: (x, y, s) => glyph('play', x, y, s) });
  paperBtn(reg('restart', B.restart, () => act('restart')), STR.restart, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('map', B.map, () => act('map')), STR.map, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('map', x, y, s) });
  paperBtn(reg('settings', B.settings, () => act('screen', { screen: 'settings' })), STR.settings, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('ladle', x, y, s) });
  if (B.mute) roundBtn(reg('mute', B.mute, () => toggleMute(st)), st.muted ? 'mute' : 'sound');
  g.restore();
}

const lastVol = {};
function setting(k, v) { try { return M && M.setting ? (arguments.length > 1 ? M.setting(k, v) : M.setting(k)) : undefined; } catch { return undefined; } }
function drawSettings(st) {
  const CL = cardLayout(L, 'settings', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(STR.settings, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  const rows = [['music', STR.music], ['sfx', STR.sound], ['stick', STR.showStick]];
  for (const [id, label] of rows) {
    const r = B[id], tb = B[id + 'T'];
    const v = setting(id);
    const on = typeof v === 'number' ? v > 0 : typeof v === 'boolean' ? v : id === 'stick' ? st.pointer === 'touch' : true;
    txt(label, r.x + Math.max(6, 8 * cu), r.y + r.h / 2 + 1, fs.body, { f: FB, align: 'left', col: C.ink, maxW: tb.x - r.x - 16 });
    // DECISION: Wednesday placeholder: music/sfx are on/off toggles over meta's 0..1 volumes (off = 0, on = the
    //   last non-zero value, default 0.7 / 0.9); the GDD §7.9 sliders come with the real settings card.
    const b = reg(id, tb, () => {
      if (id === 'stick') { setting('stick', !on); return; }
      if (on) { lastVol[id] = v; setting(id, 0); } else setting(id, lastVol[id] || (id === 'music' ? 0.7 : 0.9));
      const mv = +setting('music') || 0, sv2 = +setting('sfx') || 0;
      try { AU && AU.setVolumes && AU.setVolumes(mv, sv2); } catch {}
    });
    toggle(b, on);
  }
  const armed = T - resetArm < 3;
  paperBtn(reg('reset', B.reset, () => { if (armed) { resetArm = -9; try { M && M.reset && M.reset(); } catch {} act('title'); } else resetArm = T; }),
    armed ? STR.resetSure : STR.reset, { u: cu, fs: fs.btn2, f: FB, fill: armed ? '#FFD9D4' : C.paper });
  txt(STR.credits, B.credits.x + B.credits.w / 2, B.credits.y + B.credits.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.credits.w });
  goldBtn(reg('done', B.done, () => act('back', { to: settingsFrom }), { primary: true }), STR.done, { u: cu, fs: fs.btn });
  g.restore();
}
function toggle(b, on) {
  const r = b, h = r.h * 0.7, y = r.y + (r.h - h) / 2;
  rr(r.x, y, r.w, h, h / 2); g.fillStyle = on ? C.go : C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
  const kx = on ? r.x + r.w - h / 2 : r.x + h / 2;
  circle(kx, y + h / 2, h * 0.4); g.fillStyle = '#fff'; g.fill(); g.stroke();
  txt(on ? STR.on : STR.off, on ? r.x + (r.w - h) / 2 : r.x + h + (r.w - h) / 2, y + h / 2 + 0.5, Math.max(12, h * 0.42), { f: FB, col: on ? '#fff' : C.ink, maxW: r.w - h - 4 });
}

function drawMap(st) {
  const sv = (M && M.get && M.get()) || {};
  const cur = Math.max(1, sv.cur || 1), stars = sv.stars || [];
  const town = Math.min(2, Math.floor((cur - 1) / 20)), first = town * 20;
  const CL = cardLayout(L, 'map', { items: 20 });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  roundBtn(reg('back', B.back, () => act('back')), 'back');
  txt(STR[['picnic', 'market', 'harbour'][town]], B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  B.nodes.forEach((r, i) => {
    const n = first + i + 1, s = stars[n] ?? stars[n - 1 + (stars.length > 60 ? 1 : 0)] ?? 0;
    const beaten = n < cur, current = n === cur, locked = n > cur;
    const b = reg('lvl' + n, r, () => { if (!locked) act('level', { n }); }, { disabled: locked, primary: current });
    const R = r.w / 2, cx = r.x + R, cy = r.y + R + (isDown(b.id) ? 2 : 0), pul = current ? 1 + 0.05 * Math.sin(T * 5) : 1;
    g.save(); g.translate(cx, cy); g.scale(pul, pul);
    circle(0, 3, R); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    circle(0, 0, R); g.fillStyle = locked ? C.paperS : current ? C.gold : C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    if (locked) padlock(0, 0, R * 0.9);
    else txt(String(n), 0, 1, Math.max(14, R * 0.8), { col: C.ink });
    g.restore();
    if (beaten || s) for (let k = 0; k < 3; k++) drawStar(cx + (k - 1) * fs.small * 1.05, r.y + r.h + fs.small * 0.7, fs.small * 0.5, k < s);
  });
  g.restore();
}

const BOOST_NAME = { magnet: 'magnet', freeze: 'freezeB', mega: 'mega' };
function giftBody(d) {
  // DECISION: Core's gift data is { kind, count } (unlock gift), { kind, count, coins, milestone } or { chest, coins };
  //   the card names the booster and coins, and points at the spice tins (D33), never a jar.
  const parts = [];
  if (BOOST_NAME[d.kind]) parts.push(STR[BOOST_NAME[d.kind]] + ' ×' + (d.count || 1));
  if (d.coins) parts.push(fmt(STR.giftCoins, { n: d.coins }));
  if (d.chest && d.chest.boost) parts.push(fmt(STR.eachBooster, { n: 2 }));
  const boosts = BOOST_NAME[d.kind] || (d.chest && d.chest.boost);
  return parts.join(' · ') + (parts.length ? '. ' : '') + (boosts ? STR.giftBody : '');
}
const INFO = {
  shop: { icon: 'shop', title: () => STR.shop, body: () => STR.shopBody },
  cookbook: { icon: 'cookbook', title: () => STR.cookbook, body: () => STR.cookbookBody },
  daily: { icon: 'daily', title: () => STR.daily, body: d => d.locked ? fmt(STR.unlocksAt, { n: DAILY_UNLOCK }) : d.done ? STR.dailyDone : STR.dailyBody, primary: d => (!d.locked && !d.done ? [STR.cookToday, 'startDaily'] : null) },
  feast: { icon: 'feast', title: () => STR.feast, body: d => d.locked ? fmt(STR.unlocksAt, { n: FEAST_UNLOCK }) : STR.feastBody, primary: d => (!d.locked ? [STR.startFeast, 'startFeast'] : null) },
  alldone: { icon: 'star', title: () => STR.allDone, body: () => STR.allDoneBody, primary: () => [STR.daily, 'startDaily'] },
  gift: { icon: d => (d.chest ? 'chest' : BOOST_NAME[d.kind] ? d.kind : 'gift'), title: d => (d.chest ? STR.chestT : d.milestone ? STR.starBonus : STR.gift), body: giftBody, primary: () => [STR.collect, 'back'] },
};
function drawInfo(st, name) {
  // DECISION: Feast and All-done show the kie win-feast scene (GDD §9 All-done card) in the icon block; the others a glyph.
  const sv = (M && M.get && M.get()) || {}, cur = sv.cur || 1;
  const d = { ...(cardData[name] || {}) };
  if (name === 'daily') { d.locked = cur <= DAILY_UNLOCK; try { const s = M && M.dailyStatus && M.dailyStatus(); if (s) d.done = s.done; } catch {} }
  if (name === 'feast') d.locked = cur <= FEAST_UNLOCK;
  const spec = INFO[name] || { icon: 'ladle', title: () => name.charAt(0).toUpperCase() + name.slice(1), body: () => '' };
  const pr = spec.primary ? spec.primary(d) : null;
  const CL = cardLayout(L, 'info', { primary: !!pr, noBack: name === 'gift' });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  const hero = (name === 'feast' || name === 'alldone') && img('win-feast');
  if (hero && B.icon.h > 30) { const bob = Math.sin(T * 2.4) * B.icon.h * 0.015; drawFit(g, hero, B.icon.x, B.icon.y + bob, B.icon.w, B.icon.h); }
  else if (B.icon.h > 30) { const s = Math.min(B.icon.h, B.icon.w * 0.5, 140 * cu); const bob = Math.sin(T * 2.4) * s * 0.03; glyph(typeof spec.icon === 'function' ? spec.icon(d) : spec.icon, B.icon.x + B.icon.w / 2, B.icon.y + B.icon.h / 2 + bob, s); }
  txt2(spec.title(d), B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  txt2(spec.body(d), B.body.x + B.body.w / 2, B.body.y + B.body.h / 2, fs.body, { f: FB, col: C.ink, maxW: B.body.w });
  if (pr && B.primary) goldBtn(reg('primary', B.primary, () => act(pr[1], { town: 'picnic' }), { primary: true }), pr[0], { u: cu, fs: fs.btn });
  if (B.back) paperBtn(reg('back', B.back, () => act('back'), { primary: !pr }), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}

const api = { initUI, draw, pointer, key, show, callout, rects, primaryButton, STR, setInput, setAction, debug, layoutNow };
export default api;
