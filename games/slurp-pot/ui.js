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
import { LOW_TIME, BOOST_UNLOCK, PRICES, LEVELS, DAILY_UNLOCK, FEAST_UNLOCK, SKINS, LID_MAX, TOWNS } from './consts.js';

// Optional sibling modules: the UI keeps drawing with local fallbacks until they load.
let LG = null, CAT = null, LV = null;
import('./logic.js').then(m => { LG = m; }, () => {});
import('./levels.js').then(m => { LV = m; specCache.clear(); }, () => {});
const specCache = new Map();
function specOf(n) {
  if (!LV || !LV.getSpec) return null;
  let s = specCache.get(n);
  if (s === undefined) { try { s = LV.getSpec(n) || null; } catch { s = null; } specCache.set(n, s); }
  return s;
}
const dailyCache = new Map();
function dailyLines(key, cur) {
  if (!LV || !LV.getDaily || !key) return null;
  const k = key + '|' + cur;
  let d = dailyCache.get(k);
  if (d === undefined) {
    try { const lv = LV.getDaily(key, cur); d = (lv && lv.daily && lv.daily.lines) || null; } catch { d = null; }
    if (dailyCache.size > 8) dailyCache.clear();
    dailyCache.set(k, d);
  }
  return d;
}
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
  dailyBody: 'A fresh order every day. Keep your streak!', dailyBodyShort: 'A fresh order every day!', dailyDone: 'Order served! Come back tomorrow.',
  feastBody: 'Serve as many orders as you can!', shopBody: 'New pots are on the way. Save your coins!',
  cookbookBody: 'Every order you serve gets a recipe card.', allDoneBody: 'Head chef! Try the Daily Order and the Feast.',
  picnic: 'Picnic Park', market: 'Market Street', harbour: 'Harbour', collect: 'Collect', gift: 'A gift!',
  giftBody: 'Find it in the spice tins on the side.', chestT: 'Town chest!', starBonus: 'Star bonus!',
  giftCoins: '+{n} coins', eachBooster: '{n} of each booster', levelLabel: 'L{n} · {name}', levelShort: 'L{n}', dailyLabel: 'Daily',
  feastLabel: 'Feast', mute: 'Sound', newBest: 'NEW BEST!', stars: '{n}', loading: 'Cooking…',
  magnet: 'Magnet', freezeB: 'Freeze', mega: 'Mega rim', needCoins: 'Needs {n} coins',
  nice: 'Nice!', phew: 'Phew!', savedLid: 'Saved by a lid!', lidBody: 'Your streak is safe. {n} lid left.',
  lidBody0: 'Your streak is safe!', again: 'Again', titleBtn: 'Title', feastOver: 'Feast over!', opensAt: 'Opens at L{n}',
  later: 'Later', wear: 'Wear', wearing: 'Wearing', tapToBuy: 'Tap again to buy', streak7: '7-day streak',
  lidName: 'Streak Lid', full: 'Full', boosters: 'Boosters', pots: 'Pots', buy: 'Buy', locked: 'Locked',
  playFree: 'Play free, no download →', ogTag: 'Slurp it all. Fill the order.',
  dServe: 'Serve the order', dEat: 'Eat {n} {name}', dChain: 'Chain ×{n}', dBig: '{n} big bites',
  dLeft: 'Finish with {p}% time', dNoBumps: 'No bumps', dNoBoost: 'No boosters', dSizzle: '{n} sizzles',
  stCake: 'Top tier first!', stTruck: 'Chase the truck!', stGulls: 'Beat the gulls!', stTwo: 'Two orders today!',
  stBelt: 'Ride the belts', stStack: 'Easy on stacks!', stRoll: 'Catch the rollers', stSimmer: 'Lid on! Go around',
  stPens: 'Grow to open', bumps: 'Bumps {n}', dayN: 'Day {n}', tomorrow: 'Tomorrow', nextOrder: 'Next order in {t}',
  bestN: 'Best: {n}', servedN: '{n} served', stamps: 'Stamps', streakN: 'Streak {n}', todayOrder: "Today's order",
  nextTown: 'Next town', feastPick: 'Pick a town', chestOpen: 'Chest!', milestoneT: 'Star milestone!', ticketsN: 'Orders {n}',
  secsN: '{n} s', ghostBest: 'Best', starsTo: '★ {have} / {need}', bookChapter: '{town} · {n} / 20', comeBack: 'Come back tomorrow',
  sealed: 'Coming up', allStars: 'Every star!', served: 'orders served', served1: 'order served', dailyNew: 'Daily Order!', dayServed: "Today's order is served!",
  sk_sunny: 'Sunny Pot', sk_cauldron: 'Cauldron', sk_wok: 'Wok', sk_teapot: 'Teapot', sk_ricecooker: 'Rice Cooker',
  sk_dutch: 'Dutch Oven', sk_steamer: 'Steamer', sk_royal: 'Royal Pot', sk_ufo: 'UFO Pot', sk_starladle: 'Star Ladle',
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
let resetArm = -9, armBuy = null;

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
  if (name !== screen) { cardT = 0; kbHi = false; press = null; resetArm = -9; sfxOnce.clear(); armBuy = null; resetScreenState(); }
  if (name === 'map' && screen !== 'map') MAP.init = '';
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
// DECISION (map): the map view scrolls by drag (touch and mouse), wheel and keys with inertia; a drag of >= 8 px
//   cancels the node press it started on, so a scroll never starts a level by accident.
const MAP = { s: 0, v: 0, drag: null, glide: null, max: 0, view: null, init: '', last: 0 };
const nowS = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
function mapPointer(type, x, y) {
  if (screen !== 'map' || !MAP.view) { MAP.drag = null; return false; }
  if (type === 'down') {
    MAP.drag = inR(MAP.view, x, y) ? { y0: y, s0: MAP.s, ly: y, lt: nowS(), travel: 0, v: 0 } : null;
    if (MAP.drag) { MAP.v = 0; MAP.glide = null; }
    return !!MAP.drag;
  }
  const d = MAP.drag;
  if (!d) return false;
  if (type === 'move') {
    d.travel = Math.max(d.travel, Math.abs(y - d.y0));
    if (d.travel >= 8 && press) press = null;
    const t = nowS(), dt = t - d.lt;
    if (dt > 1e-4) { const v = -(y - d.ly) / dt; d.v = dt > 0.1 ? v : d.v * 0.6 + v * 0.4; d.ly = y; d.lt = t; }
    MAP.s = mapClamp(d.s0 - (y - d.y0), true);
    return true;
  }
  MAP.drag = null;
  if (type === 'up' && d.travel >= 8 && nowS() - d.lt < 0.12) MAP.v = clamp(d.v, -5000, 5000);
  return d.travel >= 8;
}
function mapClamp(s, soft) {
  if (!soft) return clamp(s, 0, MAP.max);
  if (s < 0) return -Math.min(60, Math.sqrt(-s) * 4);
  if (s > MAP.max) return MAP.max + Math.min(60, Math.sqrt(s - MAP.max) * 4);
  return s;
}
/** Mouse wheel / trackpad: dy in CSS px. True when the map scrolled (Core then prevents the page scroll). */
export function wheel(dy) {
  if (screen !== 'map' || !MAP.view || !dy) return false;
  const base = MAP.glide != null ? MAP.glide : MAP.s;
  const nx = clamp(base + clamp(dy, -400, 400), 0, MAP.max);
  if (nx === base && MAP.glide == null) return false;
  MAP.glide = nx; MAP.v = 0;
  return true;
}
export function pointer(type, x, y) {
  const mapped = mapPointer(type, x, y);
  return pointerBtn(type, x, y) || mapped;
}
function pointerBtn(type, x, y) {
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
  if (screen === 'map' && MAP.view) {
    const vh = MAP.view.h, base = MAP.glide != null ? MAP.glide : MAP.s;
    const to = { ArrowUp: base - 120, ArrowDown: base + 120, PageUp: base - vh * 0.8, PageDown: base + vh * 0.8,
      Home: 0, End: MAP.max }[k];
    if (to != null) { MAP.glide = clamp(to, 0, MAP.max); MAP.v = 0; return true; }
  }
  return false;
}

// ---------- bus ----------
function tutHas(f) { try { return M && M.tut ? !!M.tut(f) : false; } catch { return false; } }
function tutSet(f) { try { if (M && M.tut) M.tut(f, true); } catch {} }
// DECISION (Audio relay): UI plays only its own non-bus sounds: ui, buy, nope, coin (win count-up), gift, chest,
//   milestone, streak {day}. The win card never adds orderUp / stamp / star (the bus win event plays the payoff) and
//   gullMiss gets no coin here. sfx1 plays a card's sound once per card (the guard clears on every screen change).
function sfx(id, o) { try { if (AU && AU.sfx) AU.sfx(id, o); } catch {} }
const sfxOnce = new Set();
function sfx1(key, id, o) { if (sfxOnce.has(key)) return; sfxOnce.add(key); sfx(id, o); }

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
  // DECISION: two-course: 'course' {k} (logic, after courseDone) starts the second-ticket unfold unless the
  //   bossBite {final:false} just did; 'tier' {k} pops the cake tier mark on the meter.
  on('course', d => { if (T - hud.course > 1) hud.course = T; hud.courseK = d.k != null ? d.k : (hud.courseK || 0) + 1; });
  on('tier', d => { hud.tierPop = T; hud.tierK = d.k | 0; hud.lastBite = T; });
  on('refuse', () => { hud.refuse = T; });
  on('feastTicket', d => { hud.fServed = d.n | 0; hud.fPop = T; hud.lastBite = T; });
  on('bump', () => { hud.bumpPop = T; });
  on('chain', d => { hud.chainPop = T; });
  on('chainEnd', d => { hud.chainDrop = T; hud.chainLast = d.n || hud.chainLast; });
  on('sizzle', () => { hud.sizzle = T; });
  on('lowTime', () => { hud.low = T; });
  on('tick', () => { hud.tick = T; });
  on('boost', d => { hud.boostFx[d.kind] = T; if (d.kind === 'freeze') hud.frost = T; });
  // DECISION: a win also lands the ORDER UP stamp when no final bossBite did (the record course ends on the cake's
  //   last tier, which is a tier bite), so the 20 s record beat always shows it.
  on('win', () => { hud.result = 'win'; if (T - hud.orderUp > 3) hud.orderUp = T - 0.4; });
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
    twistCall: false, starHint: false, firstAttempt: !skipReveal, courseK: 0, tierPop: -9, tierK: -1, refuse: -9,
    stuck: false, moved0: w.pot ? [w.pot.x, w.pot.z] : null,
  };
}

// ---------- text ----------
function font(size, f = FT, wt = '') { return (wt ? wt + ' ' : '') + size.toFixed(2) + 'px ' + f; }
function measure(s, size, f = FT, wt = '') { g.font = font(size, f, wt); return g.measureText(s).width; }
/** Draw text; o: {f, wt, col, stroke, sk, align, base, maxW, min, shadow}. Shrinks to fit maxW down to `min` (>= 12). */
function txt(s, x, y, size, o = {}) {
  const f = o.f || FT, wt = o.wt || (f === FB ? '800' : ''), min = Math.max(12.5, o.min || 12.5);
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
  // DECISION: the HUD layout gets the mode flags it needs: Feast (ticket strip under the meter), a Daily with a
  //   "No bumps" line (bump chip), record (u = 3 portrait + caption band). Every flag is part of the cache key.
  const playing = screen === 'play' || screen === 'pause';
  const fe = playing && !!lastW && lastW.mode === 'feast';
  const bu = playing && !!lastW && lastW.mode === 'daily' && hasNoBumps(lastW);
  const rec = REC_M.record;
  const k = w + 'x' + h + '|' + ins.t + ',' + ins.r + ',' + ins.b + ',' + ins.l + '|' + curLines + '|' + fe + bu + rec;
  if (k !== Lkey) { Lkey = k; L = computeLayout(w, h, ins, { lines: curLines, feast: fe, bump: bu, record: rec, caption: rec }); }
}
let curLines = 3;
function hasNoBumps(w) {
  const ls = (w.level && w.level.daily && w.level.daily.lines) || (w.daily && w.daily.lines) || null;
  return !!(ls && ls.some(l => l && l.type === 'noBumps'));
}
// DECISION: record / og / cover come from Core's view() (record, og) or modes' window.__spMode (cover and as a
//   fallback); the URL is the last resort for the standalone harness. cover = clean backplates (no UI at all).
const REC_M = { record: false, og: false, cover: false };
function recMode(st) {
  const W = typeof window !== 'undefined' ? window : null;
  const sp = (W && W.__spMode) || {};
  const q = typeof location !== 'undefined' ? location.search || '' : '';
  REC_M.cover = !!sp.cover || /[?&]cover=(wide|tall|square)\b/.test(q);
  REC_M.og = !REC_M.cover && !!(st.og || sp.og || /[?&]og=1\b/.test(q));
  REC_M.record = !REC_M.cover && !REC_M.og && !!(st.record || sp.record || /[?&]record=1\b/.test(q));
  return REC_M;
}
const recState = () => (typeof window !== 'undefined' && window.__recState) || null;

export function draw(state, w, dt) {
  if (!g) return;
  dt = clamp(+dt || 0, 0, 0.1);
  T += dt; cardT += dt;
  const st = state || {};
  const scr = st.screen || screen;
  if (scr !== screen) { if (scr === 'map') MAP.init = ''; screen = scr; cardT = 0; press = null; kbHi = false; resetArm = -9; sfxOnce.clear(); armBuy = null; resetScreenState(); }
  recMode(st);
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
    if (REC_M.cover) { /* clean backplate */ }
    else if (REC_M.og) drawOg(st, w);
    else if (REC_M.record) { if (w) drawHud(st, w, dt); drawRecord(st, w); }
    else {
      if (playing && w) drawHud(st, w, dt);
      if (screen === 'pause') drawPause(st, w);
      else if (screen === 'win') drawWin(st, w);
      else if (screen === 'fail') drawFail(st, w);
      else if (screen === 'title') drawTitle(st);
      else if (screen === 'settings') drawSettings(st);
      else if (screen === 'map') drawMap(st, dt);
      else if (screen === 'shop') drawShop(st);
      else if (screen === 'cookbook') drawCookbook(st);
      else if (screen === 'daily') drawDaily(st);
      else if (screen === 'ladder') drawLadder(st);
      else if (screen === 'lid') drawLid(st);
      else if (screen === 'feast') drawFeast(st);
      else if (screen === 'feastend') drawFeastEnd(st);
      else if (screen !== 'play') drawInfo(st, screen);
      if (screen === 'play') drawCallout(dt);
    }
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
  // DECISION (§12.1): record keeps the ticket, meter, timer, chain and ORDER UP; it hides the pause tag, boosters,
  //   coins, edge arrows, the stick, the ghost hand, tutorials and callouts.
  const rec = REC_M.record;
  // tutorial timers (real time; only while playing)
  if (playing && !rec) { tutorialTick(st, w); stuckTick(w); }
  drawMeter(w, dt);
  if (H.strip && w.mode === 'feast') drawFeastStrip(w);
  drawTicket(w, t);
  if (w.timed !== false && w.T) drawEggTimer(w);
  if (!rec) {
    // pause tag (D33: pause glyph on a paper tag)
    const pb = reg('pause', H.pause, () => act('pause'));
    drawPauseTag(pb);
    drawBoosters(st, w);
    if (H.bump && w.mode === 'daily') drawBumpChip(w);
  }
  if (playing || rec) {
    if (!rec) drawArrows(w);
    drawChain(w);
    if (!rec) { drawStick(st); drawGhost(w); drawFly(w); }
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
  if (ou >= 0 && ou < 9) {
    const k = ease(ou / 0.5), fo = recOrderFade();
    ox = (cssW / 2 - (r.x + r.w / 2)) * k; oy = (cssH * 0.4 - (r.y + r.h / 2)) * k - (1 - fo) * cssH * 0.06; sc = 1 + 0.6 * k; alpha = fo;
  }
  if (crs >= 0 && crs < 0.5) { ox = -cssW * ease(crs / 0.5); }
  // DECISION (two-course): ticket 2 unfolds down from the rail (scaleY with a little overshoot) after ticket 1 left.
  const unf = crs >= 0.5 && crs < 0.95 ? Math.max(0.04, back((crs - 0.5) / 0.45)) : 1;
  const railR = H.rail;
  drawRail(w.timed !== false && w.T ? railR : { x: railR.x, y: railR.y, w: r.w, h: railR.h });
  if (alpha <= 0.01) return;
  g.save();
  const cx = r.x + r.w / 2, cy = r.y + railR.h / 2;
  g.translate(cx + ox, cy + oy + drop); g.rotate(swing); g.scale(sc, sc * unf); g.translate(-cx, -cy);
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
  // DECISION: a record run's ticket is headed with its town ("Picnic Park"), never the course's internal name.
  const head = REC_M.record ? [STR[(w.level && w.level.town) || 'picnic'] || STR.title, STR.title]
    : w.mode === 'daily' ? [STR.dailyLabel + (name ? ' · ' + name : ''), STR.dailyLabel]
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
  const nfs0 = Math.max(12.5, 13 * u), rx0 = r.x + r.pad + cm.ring / 2, nx0 = rx0 + cm.ring / 2 + Math.max(4, 6 * u);
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
    if (nfs >= 12.5) txt(nameFor(l.kind), nx0, cy + 1, nfs, { f: FB, align: 'left', col: C.ink, maxW: r.x + r.w - r.pad - cw - Math.max(4, 6 * u) - nx0 });
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
  // DECISION (meter snap): the fill agrees with logic's padlock: while canFit(pot.r, boss.a) holds for the current
  //   boss (cake: the current tier) the fill sits at or past its mark, and never reaches the mark while it does not.
  const curT = tks[w.ti || 0];
  if (curT && curT.boss >= 0 && w.ia && LG && LG.canFit) {
    const a = w.ia[curT.boss], mk = needR(a);
    try { if (LG.canFit(w.pot.r, a)) hud.rDisp = Math.max(hud.rDisp, mk); else hud.rDisp = Math.min(hud.rDisp, mk * 0.985); } catch {}
  }
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
  // simmer lid line (w.cap: logic's read-only getter, 0 when the level has no simmer)
  const cap = w.cap !== undefined ? w.cap : w.pot.cap;
  if (cap && cap < 4.1 && cap > r0) {
    const lx = X(cap);
    g.beginPath(); g.moveTo(lx, ty - Math.max(3, 4 * u)); g.lineTo(lx, ty + th + Math.max(3, 4 * u)); g.lineWidth = Math.max(2.5, 3 * u); g.strokeStyle = C.ink; g.stroke();
    const ls = Math.max(16, 20 * u), boil = w.boil > 0 ? Math.sin(T * 40) * 0.12 : 0;
    g.save(); g.translate(lx, ty - ls * 0.45); g.rotate(boil);
    icon('icon-lid', 0, 0, ls, (x, y, q) => { rr(x - q * 0.4, y - q * 0.12, q * 0.8, q * 0.24, 3); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke(); });
    g.restore();
  }
  // DECISION (cake, L53): every tier but the current one gets a small cake silhouette at its own mark (eaten
  //   tiers dim with a tick); the big boss icon (with its padlock) sits on the tier to eat now.
  const CK = w.cake;
  if (CK && CK.i >= 0 && CK.n > 1 && CK.tiers && w.ia) {
    const cid = iconFor(w.kindNames && w.kind ? wKind(w, CK.i) : 'boss-birthdaycake');
    const ss = iconS * 0.62;
    for (let k = 0; k < CK.n; k++) {
      if (k === CK.tier) continue;
      const tx = Math.min(X(needR(CK.tiers[k])), x1), tyc = m.y + m.h / 2;
      const eaten = k < CK.tier, pop = eaten && k === CK.tier - 1 && T - hud.tierPop < 0.5 ? 1 + 0.4 * Math.sin((T - hud.tierPop) / 0.5 * Math.PI) : 1;
      g.save(); g.translate(tx, tyc); g.scale(pop, pop); g.globalAlpha = eaten ? 0.55 : 1;
      circle(0, 0, ss * 0.52); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.2, 1.5 * u); g.strokeStyle = C.ink; g.stroke();
      const sil = tinted(cid, ss * 0.8, C.ink);
      if (sil) g.drawImage(sil, -ss * 0.4, -ss * 0.4, ss * 0.8, ss * 0.8); else cloche(0, 0, ss * 0.75);
      g.globalAlpha = 1;
      if (eaten) tick(ss * 0.3, -ss * 0.26, Math.max(10, ss * 0.42), C.stamp);
      g.restore();
    }
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
        if (!ok) { sfx('nope'); hud.boostPoor = { kind, t: T }; callout('boost-poor', 'coin', fmt(STR.needCoins, { n: PRICES[kind] }), 1600); return; }
        sfx('buy');
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
      txt(String(cnt), bx, byy + 0.5, Math.max(12.5, L.fs.badge), { col: '#fff' });
    } else if (!used) {
      const pw = Math.max(30, 34 * u), ph = Math.max(16, 18 * u);
      const poor = hud.boostPoor && hud.boostPoor.kind === kind && T - hud.boostPoor.t < 0.4 ? Math.sin((T - hud.boostPoor.t) * 60) * 3 : 0;
      g.translate(poor, 0);
      rr(cx - pw / 2, r.y + r.h - ph * 0.55, pw, ph, ph / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
      coin(cx - pw * 0.24, r.y + r.h - ph * 0.55 + ph / 2, ph * 0.34);
      txt(String(PRICES[kind]), cx + pw * 0.12, r.y + r.h - ph * 0.55 + ph / 2 + 0.5, Math.max(12.5, 12 * u), { col: C.ink });
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
  if (L.record || REC_M.record || REC_M.og || REC_M.cover) return;
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
  // twist intros: stuckTick (below) owns the ≤ 4-word "stuck 4 s" callouts for every twist
  // L1: the bouncing gold pointer stays on the flown-to sandwich until it is eaten
  if (hud.hintItem >= 0 && w.st && w.st[hud.hintItem] !== 0) hud.hintItem = -1;
}
// DECISION (stuck callouts): a twist level gets ONE ≤ 4-word callout once the player has moved and then 4 s pass
//   without a bite: once per world and once per save per twist (meta.seen('stuck:<id>'); pens/simmer also keep
//   their Tuesday tut bits). Priority when a level mixes twists: cake, truck, gulls, simmer, two-course, belts,
//   stacks/fragile, rollers, pens. Gull telegraphs are Render's (3D), not a callout.
function seenFlag(name, set) { try { return M && M.seen ? !!M.seen(name, set) : false; } catch { return false; } }
function twistOf(w) {
  const F = (LG && LG.F) || { ROLL: 4, FRAGILE: 8, GATE: 16, STACK: 64, BELT: 128 };
  const anyFlag = bit => { if (!w.flags) return false; for (let i = 0; i < (w.n || 0); i++) if ((w.flags[i] & bit) && (!w.st || w.st[i] === 0)) return true; return false; };
  if (w.cake && w.cake.i >= 0 && w.cake.n > 1) return ['cake', iconFor(itemKind(w, w.cake.i)), STR.stCake];
  if (w.truck && w.truck.i >= 0) return ['truck', iconFor(itemKind(w, w.truck.i)), STR.stTruck];
  if (w.gulls && w.gulls.length) return ['gulls', 'clock', STR.stGulls];
  if ((w.cap !== undefined ? w.cap : 0) > 0) return ['simmer', 'icon-lid', STR.stSimmer];
  if (w.tickets && w.tickets.length > 1 && (w.ti || 0) === 0) return ['twocourse', 'icon-chefhat', STR.stTwo];
  if ((w.belts && w.belts.length) || anyFlag(F.BELT)) return ['belt', 'hand', STR.stBelt];
  if (anyFlag(F.STACK) || anyFlag(F.FRAGILE)) return ['stack', 'hand', STR.stStack];
  if ((w.lanes && w.lanes.length) || anyFlag(F.ROLL)) return ['roll', 'hand', STR.stRoll];
  if (anyFlag(F.GATE)) return ['pens', 'padlock', STR.stPens];
  return null;
}
function stuckTick(w) {
  if (hud.stuck || w.result || w.mode === 'feast') return;
  const moved = hud.started != null || w.tStart != null;
  if (!moved || T - hud.lastBite <= 4) return;
  hud.stuck = true;
  const tw = twistOf(w);
  if (!tw) return;
  const key = 'stuck:' + tw[0];
  if (seenFlag(key) || ((tw[0] === 'pens' || tw[0] === 'simmer') && tutHas(tw[0]))) return;
  seenFlag(key, true);
  if (tw[0] === 'pens' || tw[0] === 'simmer') tutSet(tw[0]);
  callout('twist-' + tw[0], tw[1], tw[2], 2600);
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
// DECISION: in a record run the centred ORDER UP ticket and its stamp drift up and fade out over 21.5-21.9 s of
//   record time (__recState.t), so the camera pull-up reads before the end card (Render request, 11-04).
function recOrderFade() {
  const rs = REC_M.record ? recState() : null;
  return rs && typeof rs.t === 'number' ? 1 - clamp((rs.t - 21.5) / 0.4, 0, 1) : 1;
}
function drawOrderUp(w) {
  const fo = recOrderFade(), k = T - hud.orderUp + (REC_M.record ? 0.3 : 0);   // record: the stamp lands 0.3 s sooner
  if (k < 0.55 || k > 9 || fo <= 0.01) return;
  const r = L.hud.ticket, s = Math.min(cssW * 0.6, 260 * L.u);
  const x = cssW / 2, y = cssH * 0.4 - (1 - fo) * cssH * 0.06;
  const e = clamp((k - 0.55) / 0.18, 0, 1), sc = 2.2 - 1.2 * back(e);
  stampMark(x, y, s, STR.orderUp, sc, -0.18, e * fo);
}
function stampMark(x, y, s, label, sc = 1, rot = -0.15, a = 1) {
  // DECISION: word stamps are a drawn rectangular rubber stamp (double red border, cream wash), not the round
  //   ui-stamp seal: a ring art crosses the letters and "ORDER UP!" stops reading at a glance (D33 ink-stamp style).
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = clamp(a, 0, 1);
  const fsz = s * 0.2, tw0 = measure(label, fsz), rw = Math.min(s, tw0 + s * 0.2), rh = s * 0.36;
  rr(-rw / 2, -rh / 2, rw, rh, rh * 0.18); g.fillStyle = 'rgba(255,246,227,0.85)'; g.fill();
  g.lineWidth = Math.max(3, s * 0.03); g.strokeStyle = C.stamp; g.stroke();
  rr(-rw / 2 + s * 0.028, -rh / 2 + s * 0.028, rw - s * 0.056, rh - s * 0.056, rh * 0.12); g.lineWidth = Math.max(1.5, s * 0.011); g.stroke();
  txt(label, 0, s * 0.012, fsz, { col: C.stamp, maxW: rw - s * 0.12, min: 12.5 });
  g.restore();
}

// ---- Feast strip (under the meter): served-ticket notches + the best run's ghost marker ----
// DECISION: the ghost is meta.feastGhost() (cumulative serve times of the best run) read once per run; its marker
//   sits at the best run's served count for the same elapsed time (linear between its serve times). The strip
//   shows a window of notches that slides so the leader of the two always has 2 notches of room ahead.
function drawFeastStrip(w) {
  const r = L.hud.strip, u = L.u;
  if (!r) return;
  if (!hud.fGhost) { let gh = []; try { gh = (M && M.feastGhost && M.feastGhost()) || []; } catch {} hud.fGhost = gh; }
  const served = hud.fServed | 0, el = w.tStart != null ? Math.max(0, (w.t || 0) - w.tStart) : 0;
  const gh = hud.fGhost;
  let gN = 0;
  if (gh.length) {
    let k = 0; while (k < gh.length && gh[k] <= el) k++;
    const t0 = k > 0 ? gh[k - 1] : 0, t1 = k < gh.length ? gh[k] : null;
    gN = t1 == null ? k : k + clamp((el - t0) / Math.max(0.01, t1 - t0), 0, 0.999);
  }
  g.save(); g.lineJoin = 'round';
  rr(r.x, r.y + 2, r.w, r.h, r.h / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  rr(r.x, r.y, r.w, r.h, r.h / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.strokeStyle = C.ink; g.stroke();
  // left: ticket icon + served count
  const is = r.h * 0.86, lx = r.x + r.h * 0.55;
  icon('ui-ticket', lx, r.y + r.h / 2, is, (x, y, q) => { rr(x - q * 0.3, y - q * 0.4, q * 0.6, q * 0.8, 3); g.fillStyle = C.paperS; g.fill(); g.stroke(); });
  const pop = T - (hud.fPop || -9) < 0.35 ? 1 + 0.35 * Math.sin((T - hud.fPop) / 0.35 * Math.PI) : 1;
  const nfs = Math.max(13, r.h * 0.62);
  g.save(); g.translate(lx + is * 0.42 + nfs * 0.5, r.y + r.h / 2); g.scale(pop, pop);
  txt(String(served), 0, 1, nfs, { col: C.ink }); g.restore();
  const n0x = lx + is * 0.42 + nfs * 1.25, n1x = r.x + r.w - r.h * 0.4;
  const step = Math.max(14, 17 * u), vis = Math.max(3, Math.floor((n1x - n0x) / step));
  const lead = Math.max(served, Math.ceil(gN));
  const start = Math.max(0, lead + 2 - vis);
  const cy = r.y + r.h / 2, nh = r.h * 0.5, nw = Math.max(6, step * 0.55);
  for (let i = 0; i < vis; i++) {
    const k = start + i, x = n0x + i * step + step / 2;
    rr(x - nw / 2, cy - nh / 2, nw, nh, Math.min(3, nw / 3));
    g.fillStyle = k < served ? C.gold : 'rgba(58,36,24,0.12)'; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = k < served ? C.ink : 'rgba(58,36,24,0.35)'; g.stroke();
  }
  // ghost: translucent best-run chef hat riding the notches
  if (gh.length && gN >= start) {
    const gx = clamp(n0x + (gN - start) * step, n0x, n1x);
    g.globalAlpha = 0.6 + 0.15 * Math.sin(T * 5);
    icon('icon-chefhat', gx, r.y - r.h * 0.05, r.h * 1.1, (x, y, q) => { circle(x, y, q * 0.3); g.fillStyle = '#fff'; g.fill(); g.stroke(); });
    g.globalAlpha = 1;
  }
  g.restore();
}
// ---- Daily bump counter (a Daily with a "No bumps" line) ----
function drawBumpChip(w) {
  const r = L.hud.bump, u = L.u;
  if (!r) return;
  const n = (w.stats && w.stats.bumps) | 0, bad = n > 0;
  const pop = T - (hud.bumpPop || -9) < 0.4 ? 1 + 0.25 * Math.sin((T - hud.bumpPop) / 0.4 * Math.PI) : 1;
  g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2); g.scale(pop, pop); g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  rr(r.x, r.y + 3, r.w, r.h, r.h / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  rr(r.x, r.y, r.w, r.h, r.h / 2); g.fillStyle = bad ? C.tomato : C.paper; g.fill(); g.lineWidth = Math.max(2, 2 * u); g.strokeStyle = C.ink; g.stroke();
  const fz = Math.max(13, L.fs.bump || 15);
  txt(fmt(STR.bumps, { n }), r.x + r.w / 2, r.y + r.h / 2 + 1, fz, { f: FB, col: bad ? '#fff' : C.ink, maxW: r.w - 12 });
  g.restore();
}

// ---- record (§12.1): captions, end card and the loop iris from window.__recState ----
// DECISION: captions are Lilita at 64/3 u (64 px at the 1080x1920 u = 3 record) on a paper pill at 92 % with an
//   8/3 u ink rim and an ink drop shadow (a sticker), max 2 lines, centred on L.hud.caption (22 % height); the text is ink with a thin paper
//   halo, because white on the paper pill read as "white on a clear box" (Meta QA 11:16). Readable over any scene.
//   Alphas come from recState.show (modes' beat sheet).
//   The end card (23.5-25.0 s) is teal with the gold wordmark, pot-happy, "Play free, no download →" and the
//   ?end text (never a hard-coded URL); the iris closes on the end card's pot from 24.5 to 25.0 s.
function drawRecord(st, w) {
  const rs = recState(); if (!rs) return;
  const sh = rs.show || {}, u = L.u, k = u / 3;
  const capR = L.hud.caption || { x: 16 * u, y: cssH * 0.22 - 39 * u, w: cssW - 32 * u, h: 78 * u };
  const cap = (text, a) => {
    if (!text || !(a > 0.01)) return;
    const size = Math.max(20, 64 * k), maxW = capR.w - 2 * Math.max(12, 28 * k);
    g.save(); g.globalAlpha = clamp(a, 0, 1);
    const sc = 0.9 + 0.1 * ease(a);
    const cx = capR.x + capR.w / 2, cy = capR.y + capR.h / 2;
    g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
    const w1 = measure(text, size), two = w1 > maxW;
    const ph = two ? Math.max(capR.h, size * 2.55) : Math.max(capR.h, size * 1.45), pw = Math.min(capR.w, (two ? maxW : w1) + 2 * Math.max(12, 28 * k));
    const prad = Math.min(ph / 2, 40 * k), off = Math.max(3, 8 * k);
    rr(cx - pw / 2, cy - ph / 2 + off, pw, ph, prad); g.fillStyle = 'rgba(42,26,18,0.55)'; g.fill();
    rr(cx - pw / 2, cy - ph / 2, pw, ph, prad); g.fillStyle = 'rgba(255,246,227,0.92)'; g.fill();
    g.lineWidth = Math.max(3, 8 * k); g.strokeStyle = C.ink; g.stroke();
    txt2(text, cx, cy, size, { col: C.ink, stroke: C.paper, sk: Math.max(2, 4 * k), maxW });
    g.restore();
  };
  cap(rs.hook, sh.hook);
  cap(rs.cap2, sh.cap2);
  const ea = clamp(sh.end || 0, 0, 1);
  let potC = null;
  if (ea > 0.01) {
    g.save(); g.globalAlpha = ea;
    g.fillStyle = '#0F4C5C'; g.fillRect(0, 0, cssW, cssH);
    const vg = g.createRadialGradient(cssW / 2, cssH * 0.45, Math.min(cssW, cssH) * 0.2, cssW / 2, cssH * 0.45, Math.max(cssW, cssH) * 0.75);
    vg.addColorStop(0, 'rgba(255,255,255,0.06)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = vg; g.fillRect(0, 0, cssW, cssH);
    const ls = Math.min(cssW * 0.17, 150 * k * 1.2), bob = Math.sin(T * 2.2) * 6 * k;
    g.save(); g.translate(cssW / 2, cssH * 0.27); g.rotate(-0.04);
    txt(STR.title, 0, 0, ls, { col: C.gold, stroke: C.ink, sk: Math.max(5, ls * 0.14), shadow: C.ink, maxW: cssW * 0.9, min: 24 });
    g.restore();
    const ps = Math.min(cssW * 0.6, cssH * 0.3);
    potC = { x: cssW / 2, y: cssH * 0.5 + bob, r: ps * 0.4 };
    potArt('pot-happy', potC.x, potC.y, ps);
    // DECISION: the end-card call to action scales with the frame (about 6 % of the width on a phone), so it reads
    //   as the payoff line of the video, not a footnote.
    const f2 = Math.max(16, 40 * k, Math.min(cssW * 0.062, cssH * 0.04));
    txt(STR.playFree, cssW / 2, cssH * 0.72, f2, { f: FB, wt: '800', col: C.paper, stroke: C.ink, sk: Math.max(2, 5 * k), maxW: cssW * 0.9 });
    if (rs.end) txt(String(rs.end), cssW / 2, cssH * 0.72 + f2 * 1.5, f2 * 0.9, { f: FB, wt: '800', col: C.goldL, maxW: cssW * 0.9 });
    g.restore();
  }
  const ir = clamp(rs.iris || (sh.iris || 0), 0, 1);
  if (ir > 0.001) {
    let c = potC;
    if (!c && w && w.pot) { const p = worldToScreen(w.pot.x, w.pot.z); if (p) c = { x: p.x, y: p.y }; }
    if (!c) c = { x: cssW / 2, y: cssH / 2 };
    const R = Math.hypot(Math.max(c.x, cssW - c.x), Math.max(c.y, cssH - c.y)) * (1 - ease(ir));
    g.save(); g.beginPath(); g.rect(0, 0, cssW, cssH); g.arc(c.x, c.y, Math.max(0, R), 0, TAU, true);
    g.fillStyle = C.ink; g.fill('evenodd'); g.restore();
  }
}
// ---- og 1200x630 (§12.3): teal left 46 % panel, wordmark + tagline; the right 54 % is the live render ----
function drawOg(st, w) {
  const pw = Math.round(cssW * 0.46), H = cssH;
  g.save();
  g.fillStyle = '#0F4C5C'; g.fillRect(0, 0, pw, H);
  const vg = g.createRadialGradient(pw * 0.45, H * 0.45, Math.min(pw, H) * 0.15, pw * 0.45, H * 0.45, Math.max(pw, H) * 0.8);
  vg.addColorStop(0, 'rgba(255,255,255,0.07)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)'); g.fillStyle = vg; g.fillRect(0, 0, pw, H);
  const eg = g.createLinearGradient(pw - 18, 0, pw + 18, 0); eg.addColorStop(0, 'rgba(15,76,92,0)'); eg.addColorStop(0.5, 'rgba(15,76,92,0.55)'); eg.addColorStop(1, 'rgba(15,76,92,0)');
  g.fillStyle = eg; g.fillRect(pw - 18, 0, 36, H);
  const ls = Math.min(pw * 0.2, H * 0.19);
  g.save(); g.translate(pw / 2, H * 0.42); g.rotate(-0.04);
  txt(STR.title, 0, 0, ls, { col: C.gold, stroke: C.ink, sk: Math.max(5, ls * 0.14), shadow: C.ink, maxW: pw * 0.86, min: 24 });
  g.restore();
  const ts = Math.max(14, Math.min(30, H * 0.048));
  txt(STR.ogTag, pw / 2, H * 0.42 + ls * 0.95, ts, { f: FB, wt: '800', col: C.paper, maxW: pw * 0.86 });
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
  else if (c.icon === 'coin') coin(ix, cy, icS * 0.42);
  else if (/^(icon|boss|ing|skin)-/.test(c.icon)) icon(c.icon, ix, cy, icS, (x, y, q) => cloche(x, y, q));
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
  const fs2 = Math.max(12.5, r * 1.1), w2 = Math.max(r * 2, measure(s, fs2) + r);
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
    if (ln) txt('No. ' + ln, P.x + pad, P.y + hH / 2 + 1, Math.max(12.5, Math.min(hH * 0.52, 18 * cu)), { align: 'left', col: C.ink, maxW: P.w - pad * 3 - rt });
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
      const fsz = Math.max(12.5, Math.min(rowH * 0.5, 24 * cu));
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
    const n = lines.length || 1, d0 = Math.min(r.h * 0.9, Math.max(34, 44 * cu)), cnt = Math.max(12.5, fs.count);
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
  txt(on ? STR.on : STR.off, on ? r.x + (r.w - h) / 2 : r.x + h + (r.w - h) / 2, y + h / 2 + 0.5, Math.max(12.5, h * 0.42), { f: FB, col: on ? '#fff' : C.ink, maxW: r.w - h - 4 });
}

// =====================================================================================
// Meta screens: town map, shop, cookbook, daily, ladder, lid, feast, feast end
// =====================================================================================
const safe = (f, d) => { try { const v = f(); return v === undefined || v === null ? d : v; } catch { return d; } };
const TOWN_SIL = ['boss-hamper', 'boss-fruitstall', 'boss-lighthouse'];
const TOWN_SHORT = { picnic: 'Picnic', market: 'Market', harbour: 'Harbour' };
const skinArt = id => (id && id !== 'sunny' && ART.has('skin-' + id) ? 'skin-' + id : 'pot-hero');
const skinName = id => STR['sk_' + id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
const curLv = () => safe(() => M.cur(), ((M && M.get && M.get()) || {}).cur || 1);
let dsCache = { t: -9, v: null };
function dailyStat() {
  if (!dsCache.v || T - dsCache.t > 0.5 || T < dsCache.t) dsCache = { t: T, v: safe(() => M.dailyStatus(), null) };
  return dsCache.v;
}
function hms(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}
function lidIcon(x, y, s) {
  icon('icon-lid', x, y, s, (x2, y2, s2) => {
    rr(x2 - s2 * 0.4, y2 - s2 * 0.05, s2 * 0.8, s2 * 0.2, s2 * 0.08); g.fillStyle = C.brass; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    circle(x2, y2 - s2 * 0.12, s2 * 0.1); g.fillStyle = C.brassD; g.fill(); g.stroke();
  });
}
function rewardIcon(rw, x, y, s) {
  if (!rw) return;
  if (rw.icon === 'skin') potArt(skinArt(rw.skin), x, y, s);
  else if (rw.icon === 'chest') glyph('chest', x, y, s * 0.92);
  else if (rw.icon === 'lid') lidIcon(x, y, s * 0.92);
  else if (rw.icon === 'boosters') glyph('magnet', x, y, s * 0.85);
  else coin(x, y, s * 0.32);
}
function rewardShort(rw) {
  if (!rw) return '';
  if (rw.skin) return skinName(rw.skin);
  if (rw.chest) return STR.chestOpen;
  if (rw.lid) return STR.lidName;
  if (rw.coins) return '+' + rw.coins;
  return STR.boosters;
}
function plural(name, n) {
  const s = String(name || '').toLowerCase();
  if (n === 1 || /s$/.test(s)) return s;
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + 'ies';
  if (/(ch|sh|x)$/.test(s)) return s + 'es';
  return s + 's';
}
function lineText(l) {
  if (!l) return '';
  switch (l.type) {
    case 'win': return STR.dServe;
    case 'eat': return fmt(STR.dEat, { n: l.n, name: plural(nameFor(l.kind), l.n) });
    case 'chain': return fmt(STR.dChain, { n: l.n });
    case 'big': return fmt(STR.dBig, { n: l.n });
    case 'left': return fmt(STR.dLeft, { p: Math.round((+l.share || 0) * 100) });
    case 'noBumps': return STR.dNoBumps;
    case 'noBoost': return STR.dNoBoost;
    case 'sizzle': return fmt(STR.dSizzle, { n: l.n });
    default: return '';
  }
}
/** A banner ribbon with notched tails; w is the body width (tails add 0.5 h each side). */
function ribbon(cx, cy, w, h, label, fsz, col = C.tomato, colD = C.tomatoD) {
  const t = h * 0.5;
  g.save(); g.lineJoin = 'round';
  for (const sd of [-1, 1]) {
    const x0 = cx + sd * (w / 2 - t * 0.3), x1 = cx + sd * (w / 2 + t);
    g.beginPath(); g.moveTo(x0, cy - h * 0.22); g.lineTo(x1, cy - h * 0.22); g.lineTo(x1 - sd * t * 0.55, cy + h * 0.16); g.lineTo(x1, cy + h * 0.52); g.lineTo(x0, cy + h * 0.52); g.closePath();
    g.fillStyle = colD; g.fill(); g.lineWidth = Math.max(2, h * 0.05); g.strokeStyle = C.ink; g.stroke();
  }
  rr(cx - w / 2, cy - h / 2 + 3, w, h * 0.86, h * 0.2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
  rr(cx - w / 2, cy - h / 2, w, h * 0.86, h * 0.2); g.fillStyle = col; g.fill(); g.lineWidth = Math.max(2, h * 0.06); g.strokeStyle = C.ink; g.stroke();
  txt(label, cx, cy - h * 0.06, fsz, { col: C.paper, stroke: C.ink, sk: Math.max(3, fsz * 0.2), maxW: w - h * 0.5, min: 12.5 });
  g.restore();
}
/** Ink silhouette of a town's signature boss on a paper medallion, with a padlock. */
function townMedal(ti, x, y, s, a = 1) {
  g.save(); g.globalAlpha = a;
  circle(x, y + Math.max(3, s * 0.03), s / 2); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill();
  circle(x, y, s / 2); g.fillStyle = C.paperS; g.fill(); g.lineWidth = Math.max(2.5, s * 0.03); g.strokeStyle = C.ink; g.stroke();
  const sil = tinted(TOWN_SIL[ti], s * 0.86, C.ink);
  if (sil) { g.globalAlpha = a * 0.85; g.drawImage(sil, x - s * 0.43, y - s * 0.43, s * 0.86, s * 0.86); g.globalAlpha = a; }
  else cloche(x, y, s * 0.7);
  padlock(x + s * 0.32, y + s * 0.3, Math.max(22, s * 0.32));
  g.restore();
}

// ---- town map ----
function mapPhysics(dt) {
  if (MAP.drag) return;
  if (MAP.glide != null) {
    MAP.s += (MAP.glide - MAP.s) * (1 - Math.exp(-14 * dt));
    if (Math.abs(MAP.glide - MAP.s) < 0.5) { MAP.s = MAP.glide; MAP.glide = null; }
    return;
  }
  if (MAP.v) {
    MAP.s += MAP.v * dt; MAP.v *= Math.exp(-4 * dt);
    if (MAP.s < 0 || MAP.s > MAP.max) { MAP.v *= Math.exp(-18 * dt); MAP.s = clamp(MAP.s, -60, MAP.max + 60); }
    if (Math.abs(MAP.v) < 10) MAP.v = 0;
  }
  if (MAP.s < 0) { MAP.s *= Math.exp(-12 * dt); if (MAP.s > -0.5) MAP.s = 0; }
  else if (MAP.s > MAP.max) { MAP.s = MAP.max + (MAP.s - MAP.max) * Math.exp(-12 * dt); if (MAP.s - MAP.max < 0.5) MAP.s = MAP.max; }
}
function drawMap(st, dt) {
  // DECISION: the town map is a full-screen scroller, not a card. Each town is one band of the content (ribbon at
  //   the bottom where you enter, 20 nodes, the town chest at the top); its kie map art is tiled down the band at
  //   column width (every other tile mirrored top-to-bottom, so the seams meet edge to edge) so the art is never
//   stretched. It opens with the current node at 60 %
  //   of the view height. Locked towns get an ink wash, the town's signature boss as a silhouette and "Opens at L21".
  // DECISION: the current node carries the worn pot skin (pot-hero for Sunny) with its number as a badge; level
  //   nodes register only while fully inside the view, so a node under the bars can never be tapped.
  const sv = (M && M.get && M.get()) || {};
  const cur = Math.max(1, curLv() | 0), here = Math.min(cur, LEVELS), allDone = cur > LEVELS;
  const starsOf = n => safe(() => M.stars(n) | 0, Array.isArray(sv.stars) ? sv.stars[n - 1] | 0 : 0);
  const CL = cardLayout(L, 'map', {});
  const B = CL.blocks, fs = CL.fs, mp = CL.map, V = B.view, u = L.u, col = mp.col;
  MAP.view = V; MAP.max = Math.max(0, mp.contentH - V.h);
  const key = `${Math.round(V.w)}x${Math.round(V.h)}:${here}`;
  if (MAP.init !== key) {
    const cn = mp.nodes[here - 1];
    MAP.s = clamp(cn.y - V.h * 0.6, 0, MAP.max); MAP.v = 0; MAP.glide = null; MAP.drag = null; MAP.init = key;
  }
  mapPhysics(dt);
  const s0 = MAP.s, sy = cy => V.y + cy - s0, X = x => col.x + x;
  const R = mp.nodeD / 2;
  // backdrop (bars + outside the column) = the picnic table's wood
  g.fillStyle = '#B97A45'; g.fillRect(0, 0, cssW, cssH);
  g.save(); g.beginPath(); g.rect(V.x, V.y, V.w, V.h); g.clip();
  // town art bands
  for (const tw of mp.towns) {
    const y0 = sy(tw.y), y1 = y0 + tw.h;
    if (y1 < V.y || y0 > V.y + V.h) continue;
    const im = img('map-' + TOWNS[tw.i]);
    const vy0 = Math.max(V.y, y0), vy1 = Math.min(V.y + V.h, y1);
    if (im) {
      // DECISION (11-05, art lane): on wide screens the town art carries on past the column (mirrored at each seam, dimmed
      // so the trail stays the subject) instead of flat brown bands; locked towns wash the full width below.
      const th = col.w * (im.naturalHeight || im.height) / (im.naturalWidth || im.width);
      const wings = col.w < V.w - 2 ? Math.ceil((col.x - V.x) / col.w) : 0;
      for (let c = -wings; c <= wings; c++) {
        const px = col.x + c * col.w;
        g.save(); g.beginPath(); g.rect(px, vy0, col.w, vy1 - vy0); g.clip();
        if (c % 2) { g.translate(px * 2 + col.w, 0); g.scale(-1, 1); }
        for (let k = 0, ty = y1 - th; ty + th > y0; k++, ty -= th) {
          if (ty > vy1 || ty + th < vy0) continue;
          if (k % 2) { g.save(); g.translate(0, ty * 2 + th); g.scale(1, -1); g.drawImage(im, px, ty, col.w, th); g.restore(); }
          else g.drawImage(im, px, ty, col.w, th);
        }
        g.restore();
      }
    } else { g.fillStyle = ['#8CCB72', '#EDBB86', '#8FCADB'][tw.i]; g.fillRect(V.x, vy0, V.w, vy1 - vy0); }
  }
  if (col.w < V.w - 2) {   // wings dim + column edges (landscape / desktop)
    g.fillStyle = 'rgba(58,36,24,0.3)'; g.fillRect(V.x, V.y, col.x - V.x, V.h); g.fillRect(col.x + col.w, V.y, V.x + V.w - col.x - col.w, V.h);
    g.fillStyle = 'rgba(58,36,24,0.35)'; g.fillRect(col.x - 6, V.y, 6, V.h); g.fillRect(col.x + col.w, V.y, 6, V.h);
  }
  // path
  const vis = mp.nodes.filter(nd => { const y = sy(nd.y); return y > V.y - mp.step * 2 && y < V.y + V.h + mp.step * 2; });
  const trail = list => {
    g.beginPath();
    list.forEach((nd, i) => {
      const x = X(nd.x), y = sy(nd.y);
      if (!i) { g.moveTo(x, y); return; }
      const p = list[i - 1], px = X(p.x), py = sy(p.y);
      g.bezierCurveTo(px, (py + y) / 2, x, (py + y) / 2, x, y);
    });
  };
  if (vis.length > 1) {
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    trail(vis); g.lineWidth = mp.nodeD * 0.44; g.strokeStyle = 'rgba(58,36,24,0.4)'; g.stroke();
    trail(vis); g.lineWidth = mp.nodeD * 0.32; g.strokeStyle = C.paper; g.stroke();
    const doneL = vis.filter(nd => nd.n <= here), todo = vis.filter(nd => nd.n >= here);
    g.setLineDash([mp.nodeD * 0.14, mp.nodeD * 0.18]); g.lineWidth = Math.max(2.5, mp.nodeD * 0.08);
    if (doneL.length > 1) { trail(doneL); g.strokeStyle = C.gold; g.stroke(); }
    if (todo.length > 1) { trail(todo); g.strokeStyle = 'rgba(58,36,24,0.28)'; g.stroke(); }
    g.setLineDash([]); g.restore();
  }
  // town chests (top of each band)
  const chests = Array.isArray(sv.chests) ? sv.chests : [];
  for (const tw of mp.towns) {
    const cy = sy(tw.chest) + mp.chestH * 0.5;
    if (cy < V.y - mp.chestH || cy > V.y + V.h + mp.chestH) continue;
    // the chest sits beside the trail, on the side away from where the trail crosses the chest's height
    const ccy = tw.chest + mp.chestH * 0.5;
    let tx = mp.nodes.reduce((m, nd) => Math.abs(nd.y - ccy) < Math.abs(m.y - ccy) ? nd : m, mp.nodes[0]).x;
    for (let k = 1; k < mp.nodes.length; k++) {
      const a = mp.nodes[k - 1], b2 = mp.nodes[k];
      if ((a.y - ccy) * (b2.y - ccy) <= 0) { const f = (ccy - a.y) / ((b2.y - a.y) || 1); tx = a.x + (b2.x - a.x) * f; break; }
    }
    const got = chests.includes(TOWNS[tw.i]), cs = mp.chestH * 0.86, cx = X(tx < col.w / 2 ? col.w * 0.74 : col.w * 0.26);
    g.save(); if (got) g.globalAlpha = 0.75;
    g.beginPath(); g.ellipse(cx, cy + cs * 0.36, cs * 0.42, cs * 0.1, 0, 0, TAU); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    glyph('chest', cx, cy + (got ? 0 : Math.sin(T * 2.4 + tw.i) * cs * 0.03), cs);
    g.restore();
    if (got) tick(cx + cs * 0.34, cy - cs * 0.2, Math.max(18, cs * 0.3));
  }
  // nodes (the current one last, on top)
  const wear = sv.wear || 'sunny';
  let curNode = null;
  for (const nd of vis) {
    const n = nd.n, x = X(nd.x), y = sy(nd.y);
    const current = n === here && !allDone, locked = n > cur;
    if (current) { curNode = nd; continue; }
    if (y + R + mp.starH < V.y || y - R > V.y + V.h) continue;   // wholly under a bar: nothing to draw
    const inView = y - R >= V.y && y + R <= V.y + V.h;
    const b = inView && !locked ? reg('lvl' + n, { x: x - R, y: y - R, w: R * 2, h: R * 2 }, () => act('level', { n })) : null;
    const dn = b && isDown(b.id) ? 2 : 0;
    circle(x, y + Math.max(3, 4 * u), R); g.fillStyle = 'rgba(58,36,24,0.35)'; g.fill();
    circle(x, y + dn, R); g.fillStyle = locked ? C.paperS : C.paper; g.fill(); g.lineWidth = Math.max(2.5, 3 * u); g.strokeStyle = C.ink; g.stroke();
    if (locked) { g.save(); g.globalAlpha = 0.7; padlock(x, y + dn, R * 0.9); g.restore(); }
    else {
      circle(x, y + dn, R * 0.78); g.lineWidth = Math.max(1.5, 2 * u); g.strokeStyle = C.gold; g.stroke();
      txt(String(n), x, y + dn + 1, fs.node, { col: C.ink, maxW: R * 1.5 });
      const sN = starsOf(n), sr = Math.min(mp.starH * 0.62, mp.nodeD * 0.16), sy0 = y + R + mp.starH * 0.45;
      for (let k = 0; k < 3; k++) drawStar(x + (k - 1) * sr * 2.3, sy0 + (k === 1 ? sr * 0.25 : 0), sr, k < sN);
    }
  }
  // locked towns: wash, silhouette, "Opens at L21"
  for (const tw of mp.towns) {
    if (cur > tw.i * 20) continue;
    const y0 = sy(tw.y), y1 = y0 + tw.h;
    if (y1 < V.y || y0 > V.y + V.h) continue;
    g.fillStyle = 'rgba(38,24,16,0.62)'; g.fillRect(V.x, y0, V.w, tw.h);
    const vy0 = Math.max(y0, V.y), vy1 = Math.min(y1, V.y + V.h);
    if (vy1 - vy0 < 120) continue;
    const ms = Math.min(col.w * 0.5, (vy1 - vy0) * 0.42, 200 * u);
    const cy = clamp((vy0 + vy1) / 2 - ms * 0.25, y0 + mp.chestH + ms * 0.6, y1 - mp.hdrH - ms * 1.2);
    townMedal(tw.i, X(col.w / 2), cy, ms);
    const lab = fmt(STR.opensAt, { n: tw.i * 20 + 1 }), lf = fs.lock, lw = Math.min(col.w - 24, measure(lab, lf) + lf * 2.4);
    rr(X(col.w / 2) - lw / 2, cy + ms * 0.58, lw, lf * 1.9, lf * 0.95); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    txt(lab, X(col.w / 2), cy + ms * 0.58 + lf * 0.97, lf, { col: C.ink, maxW: lw - lf });
  }
  // town ribbons (where each town starts)
  for (const tw of mp.towns) {
    const ry = sy(tw.ribbon) + mp.hdrH * 0.5;
    if (ry < V.y - mp.hdrH || ry > V.y + V.h + mp.hdrH) continue;
    const rh = Math.min(mp.hdrH * 0.72, Math.max(40, 46 * u)), rw = Math.min(col.w - rh * 1.3 - 16, Math.max(200, 280 * u));
    const lockedT = cur <= tw.i * 20;
    ribbon(X(col.w / 2), ry, rw, rh, STR[TOWNS[tw.i]], fs.town, lockedT ? '#8E7A66' : C.tomato, lockedT ? '#6B5A49' : C.tomatoD);
  }
  // the current node + the worn pot
  if (curNode && sy(curNode.y) + R * 1.4 > V.y && sy(curNode.y) - R * 1.4 - mp.nodeD * 0.6 < V.y + V.h) {
    const x = X(curNode.x), y = sy(curNode.y), inView = y - R >= V.y && y + R <= V.y + V.h;
    const b = inView ? reg('lvl' + here, { x: x - R, y: y - R, w: R * 2, h: R * 2 }, () => act('level', { n: here }), { primary: true }) : null;
    const dn = b && isDown(b.id) ? 2 : 0, pul = 1 + 0.05 * Math.sin(T * 5);
    g.save(); g.translate(x, y + dn); g.scale(pul, pul);
    circle(0, 0, R * 1.32); g.fillStyle = 'rgba(255,211,77,0.45)'; g.fill();
    circle(0, Math.max(3, 4 * u) - dn, R); g.fillStyle = 'rgba(58,36,24,0.35)'; g.fill();
    circle(0, 0, R); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(3, 3.5 * u); g.strokeStyle = C.ink; g.stroke();
    g.restore();
    const ps = mp.nodeD * 1.2, bob = Math.sin(T * 3) * ps * 0.04;
    potArt(skinArt(wear), x, y - R * 0.45 + bob + dn, ps);
    badge(x, y + R * 0.78 + dn, Math.max(11, 12 * u), String(here), C.ink);
  }
  // soft edges where the map scrolls under the bars
  const eh = Math.max(10, 14 * u);
  let gr = g.createLinearGradient(0, V.y, 0, V.y + eh); gr.addColorStop(0, 'rgba(58,36,24,0.35)'); gr.addColorStop(1, 'rgba(58,36,24,0)');
  g.fillStyle = gr; g.fillRect(V.x, V.y, V.w, eh);
  gr = g.createLinearGradient(0, V.y + V.h - eh, 0, V.y + V.h); gr.addColorStop(0, 'rgba(58,36,24,0)'); gr.addColorStop(1, 'rgba(58,36,24,0.35)');
  g.fillStyle = gr; g.fillRect(V.x, V.y + V.h - eh, V.w, eh);
  g.restore();
  // top bar: Back · milestone bar · coins
  roundBtn(reg('back', B.back, () => act('back')), 'back');
  {
    const ms = safe(() => M.nextMilestone(), { have: 0, need: 15 }), r = B.milestone;
    const prevM = ms.need - 15, frac = ms.have >= ms.need ? 1 : clamp((ms.have - prevM) / Math.max(1, ms.need - prevM), 0, 1);
    const h = r.h * 0.82, y = r.y + (r.h - h) / 2, rad = h / 2;
    rr(r.x, y + 3, r.w, h, rad); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    rr(r.x, y, r.w, h, rad); g.fillStyle = C.paper; g.fill();
    g.save(); rr(r.x, y, r.w, h, rad); g.clip();
    g.fillStyle = C.goldL; g.fillRect(r.x + h * 0.5, y, (r.w - h) * frac, h);
    g.restore();
    rr(r.x, y, r.w, h, rad); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    drawStar(r.x + h * 0.55, y + h / 2, h * 0.36, true);
    glyph('gift', r.x + r.w - h * 0.55, y + h / 2, h * 0.86);
    txt(`${ms.have} / ${ms.need}`, r.x + r.w / 2, y + h / 2 + 1, fs.pill, { col: C.ink, maxW: r.w - h * 2.3 });
  }
  pill(B.coins, 'coin', String(safe(() => M.coins(), sv.coins | 0)), fs.pill);
  // Daily / Feast / Cookbook / Shop
  const dly = dailyStat();
  for (const ic of B.icons) {
    const id = ic.id;
    const locked = (id === 'daily' && cur <= DAILY_UNLOCK) || (id === 'feast' && cur <= FEAST_UNLOCK);
    const b = reg(id, ic.r, () => act('screen', { screen: id }));
    roundBtn(b, id, { dim: locked });
    const lab = id === 'cookbook' ? [STR.cookbook, STR.cookbookShort] : [STR[id] || id];
    txtMin(lab, ic.lab.x + ic.lab.w / 2, ic.lab.y + ic.lab.h / 2, fs.label, { f: FB, col: C.ink, maxW: ic.lab.w, stroke: 'rgba(255,246,227,0.95)', sk: 4 });
    const bx = ic.r.x + ic.r.w * 0.86, by = ic.r.y + ic.r.h * 0.14, br = Math.max(10, 11 * u);
    if (locked) badge(bx, by, br, fmt(STR.levelShort, { n: id === 'daily' ? DAILY_UNLOCK : FEAST_UNLOCK }), C.ink);
    else if (id === 'daily' && dly) badge(bx, by, br, dly.done ? String(dly.streak || 0) : '!', dly.done ? C.go : C.stamp);
  }
}

// ---- shop ----
let shopSel = null;
const tinPop = {};
function drawShop(st) {
  // DECISION: a skin is bought with two taps: Buy arms the button for 3 s ("Tap again to buy"), the second tap buys
  //   (buySkin, which also wears it). Too few coins: the button shakes and reads "Needs N coins" (sfx nope). The Star
  //   Ladle is streak-only ("7-day streak", never for coins). Boosters and the Streak Lid buy in one tap (cheap, stack).
  const sv = (M && M.get && M.get()) || {};
  const coins = safe(() => M.coins(), sv.coins | 0);
  const list = safe(() => M.skins(), null) || SKINS.map(([id, price]) => ({ id, price, owned: id === 'sunny', worn: id === 'sunny', buyable: price > 0 }));
  if (!shopSel || !list.some(s => s.id === shopSel)) shopSel = (list.find(s => s.worn) || list[0]).id;
  const sel = list.find(s => s.id === shopSel);
  const CL = cardLayout(L, 'shop', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(STR.shop, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  pill(B.coins, 'coin', String(coins), Math.max(14, 17 * cu));
  // preview
  const pv = B.preview;
  if (pv.h > 30) {
    const s = Math.min(pv.w * 0.6, pv.h * 1.02), cx = pv.x + pv.w / 2, cy = pv.y + pv.h / 2, bob = Math.sin(T * 2.4) * s * 0.02;
    const gl = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.6); gl.addColorStop(0, 'rgba(255,216,107,0.7)'); gl.addColorStop(1, 'rgba(255,216,107,0)');
    g.fillStyle = gl; g.fillRect(cx - s * 0.6, cy - s * 0.6, s * 1.2, s * 1.2);
    g.beginPath(); g.ellipse(cx, cy + s * 0.4, s * 0.32, s * 0.06, 0, 0, TAU); g.fillStyle = 'rgba(58,36,24,0.22)'; g.fill();
    potArt(skinArt(sel.id), cx, cy + bob, s);
    if (sel.worn) tick(cx + s * 0.38, cy - s * 0.34, Math.max(20, s * 0.2));
  }
  if (B.name) txt(skinName(sel.id), B.name.x + B.name.w / 2, B.name.y + B.name.h / 2, fs.body * 1.2, { col: C.ink, maxW: B.name.w });
  // Wear / Buy
  const armed = !!(armBuy && armBuy.id === sel.id && !armBuy.poor && T - armBuy.t < 3);
  const poorK = armBuy && armBuy.poor && armBuy.id === sel.id ? T - armBuy.t : 9;
  if (sel.worn) {
    paperBtn(reg('buy', B.buy, () => {}, { disabled: true }), STR.wearing, { u: cu, fs: fs.btn2, fill: C.paperS, icon: (x, y, s) => tick(x, y, s * 0.8) });
  } else if (sel.owned) {
    goldBtn(reg('buy', B.buy, () => act('wear', { id: sel.id }), { primary: true }), STR.wear, { u: cu, fs: fs.btn });
  } else if (!(sel.price > 0)) {
    paperBtn(reg('buy', B.buy, () => sfx('nope'), {}), STR.streak7, { u: cu, fs: fs.btn2, fill: C.paperS, icon: (x, y, s) => glyph('daily', x, y, s) });
  } else {
    const id = sel.id, price = sel.price;
    const b = reg('buy', B.buy, () => {
      if (coins < price) { sfx('nope'); armBuy = { id, t: T, poor: true }; return; }
      if (armed) { armBuy = null; sfx('buy'); act('buySkin', { id }); }
      else armBuy = { id, t: T };
    }, { primary: true });
    const shake = poorK < 0.4 ? Math.sin(poorK * 60) * 4 : 0;
    g.save(); g.translate(shake, 0);
    if (poorK < 2) paperBtn(b, fmt(STR.needCoins, { n: price }), { u: cu, fs: fs.btn2, fill: '#FFD9D4' });
    else goldBtn(b, armed ? STR.tapToBuy : `${STR.buy} ${price}`, { u: cu, fs: fs.btn, glow: armed ? 0.5 + 0.5 * Math.sin(T * 8) : 0, icon: armed ? null : (x, y, s) => coin(x, y, s * 0.34) });
    g.restore();
  }
  // skin grid
  list.slice(0, 10).forEach((sk, i) => {
    const r = B.skins[i]; if (!r) return;
    const on = sk.id === shopSel;
    const b = reg('skin' + i, r, () => { if (shopSel !== sk.id) { shopSel = sk.id; armBuy = null; } });
    const dn = isDown(b.id) ? 2 : 0, rad = Math.max(8, r.w * 0.2);
    rr(r.x, r.y + 3, r.w, r.h, rad); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    rr(r.x, r.y + dn, r.w, r.h, rad); g.fillStyle = on ? C.goldL : sk.owned ? C.paper : C.paperS; g.fill();
    g.lineWidth = on ? Math.max(3, 3.5 * cu) : 2; g.strokeStyle = C.ink; g.stroke();
    g.save(); if (!sk.owned) g.globalAlpha = 0.6;
    potArt(skinArt(sk.id), r.x + r.w / 2, r.y + dn + r.h * (sk.owned ? 0.5 : 0.42), r.w * (sk.owned ? 0.84 : 0.72));
    g.restore();
    if (sk.worn) tick(r.x + r.w * 0.82, r.y + r.h * 0.18 + dn, Math.max(14, r.w * 0.3));
    else if (!sk.owned) {
      const ph = Math.max(15, r.h * 0.3), py = r.y + r.h - ph - 2 + dn;
      if (sk.price > 0) {
        const pf = 12.5, cr = ph * 0.3, tw2 = measure(String(sk.price), pf), pw = Math.min(r.w - 4, cr * 2 + 3 + tw2 + 6);
        rr(r.x + (r.w - pw) / 2, py, pw, ph, ph / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
        coin(r.x + (r.w - pw) / 2 + 3 + cr, py + ph / 2, cr);
        txt(String(sk.price), r.x + (r.w - pw) / 2 + 3 + cr * 2 + 2, py + ph / 2 + 0.5, pf, { align: 'left', col: coins >= sk.price ? C.ink : C.stamp, maxW: pw - cr * 2 - 6 });
      } else padlock(r.x + r.w / 2, py + ph / 2, ph * 1.05);
    }
  });
  // booster shelf
  if (B.shelfT) txt(STR.boosters, B.shelfT.x + 2, B.shelfT.y + B.shelfT.h / 2, fs.small * 1.1, { f: FB, align: 'left', col: C.goldS, maxW: B.shelfT.w });
  const stock = (sv && sv.boost) || {}, lids = safe(() => M.lids(), 0), dOpen = safe(() => M.dailyUnlocked(), curLv() > DAILY_UNLOCK);
  ['magnet', 'freeze', 'mega', 'lid'].forEach((kind, i) => {
    const t = B.tins[i]; if (!t) return;
    const isLid = kind === 'lid', price = PRICES[kind];
    const open = isLid ? dOpen : safe(() => M.boosterUnlocked(kind), curLv() >= BOOST_UNLOCK[kind]);
    const have = isLid ? lids : stock[kind] | 0, full = isLid ? have >= LID_MAX : have >= 99;
    const b = reg('tin' + i, t.icon, () => {
      if (!open || full || coins < price) { sfx('nope'); tinPop[kind] = { t: T, bad: true }; return; }
      sfx('buy'); tinPop[kind] = { t: T }; act('buyBooster', { kind });
    });
    const r = t.icon, Rr = r.w / 2, cx = r.x + Rr, dn = isDown(b.id) ? 2 : 0, cy = r.y + Rr + dn;
    const pp = tinPop[kind], pk = pp && T - pp.t < 0.3 && !pp.bad ? 1 + 0.2 * Math.sin((T - pp.t) / 0.3 * Math.PI) : 1;
    const shake = pp && pp.bad && T - pp.t < 0.4 ? Math.sin((T - pp.t) * 60) * 3 : 0;
    g.save(); g.translate(cx + shake, cy); g.scale(pk, pk); if (!open) g.globalAlpha = 0.55;
    circle(0, Math.max(2, 3 * cu) - dn, Rr); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    circle(0, 0, Rr);
    const gr = g.createLinearGradient(0, -Rr, 0, Rr); gr.addColorStop(0, C.brassL); gr.addColorStop(1, C.brassD);
    g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(2, 2.2 * cu); g.strokeStyle = C.ink; g.stroke();
    circle(0, 0, Rr * 0.8); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.stroke();
    if (isLid) lidIcon(0, 0, Rr * 1.3); else glyph(kind, 0, 0, Rr * 1.25);
    g.restore();
    const bx = cx + Rr * 0.78, by = r.y + Rr * 0.22;
    if (!open) badge(bx, by, Math.max(10, 10 * cu), fmt(STR.levelShort, { n: isLid ? DAILY_UNLOCK : BOOST_UNLOCK[kind] }), C.ink);
    else if (isLid) badge(bx, by, Math.max(10, 10 * cu), `${have}/${LID_MAX}`, have ? C.stamp : C.goldS);
    else if (have > 0) badge(bx, by, Math.max(10, 10 * cu), String(have), C.stamp);
    const pr = t.price, pc = pr.y + pr.h / 2;
    if (open && full) txt(STR.full, pr.x + pr.w / 2, pc, 12.5, { f: FB, col: C.goldS, maxW: pr.w });
    else {
      const pf = Math.max(12.5, Math.min(pr.h * 0.62, 15 * cu)), cr = pf * 0.42, tw2 = measure(String(price), pf);
      const x0 = pr.x + (pr.w - (cr * 2 + 4 + tw2)) / 2;
      coin(x0 + cr, pc, cr);
      txt(String(price), x0 + cr * 2 + 4, pc + 0.5, pf, { align: 'left', col: open && coins < price ? C.stamp : C.ink, maxW: pr.w - cr * 2 - 4 });
    }
  });
  paperBtn(reg('back', B.back, () => act('back')), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}

// ---- cookbook ----
let bookTab = null;
function drawCookbook(st) {
  // DECISION: the Cookbook opens on the chapter of the town the player is in. A beaten level's card shows its boss
  //   (the last ticket's) with stars; the next level's card is a gold silhouette (tap to play it); the rest are faint
  //   silhouettes with "?". The next town's chapter is a tease (silhouettes + "Opens at L21"), later ones "Coming up".
  const cur = curLv();
  const cb = safe(() => M.cookbook(), null) || { chapters: TOWNS.map((town, index) => ({ town, index, mode: index ? 'sealed' : 'current',
    cards: Array.from({ length: 20 }, (_, i) => ({ n: index * 20 + i + 1, stars: 0, state: 'locked' })), beaten: 0, complete: false, chest: false })), stamps: [] };
  if (!bookTab) bookTab = (cb.chapters.find(c => c.mode === 'current') || cb.chapters[0]).town;
  const CL = cardLayout(L, 'cookbook', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  if (B.title) txt(STR.cookbook, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  for (const tb of B.tabs) {
    const id = tb.id, r = tb.r, on = id === bookTab;
    const ch = cb.chapters.find(c => c.town === id), far = ch && (ch.mode === 'sealed' || ch.mode === 'tease');
    const b = reg('tab-' + id, r, () => { bookTab = id; });
    const dn = isDown(b.id) ? 2 : 0, rad = Math.max(10, r.h * 0.3);
    rr(r.x, r.y + 3, r.w, r.h, rad); g.fillStyle = 'rgba(58,36,24,0.28)'; g.fill();
    rr(r.x, r.y + dn, r.w, r.h, rad); g.fillStyle = on ? C.gold : far ? C.paperS : C.paper; g.fill();
    g.lineWidth = on ? Math.max(2.5, 3 * cu) : 2; g.strokeStyle = C.ink; g.stroke();
    const lab = id === 'stamps' ? [STR.stamps] : [STR[id], TOWN_SHORT[id]];
    g.save(); if (far && !on) g.globalAlpha = 0.65;
    txtMin(lab, r.x + r.w / 2, r.y + dn + r.h / 2 + 1, fs.body, { f: FB, col: C.ink, maxW: r.w - 10 });
    g.restore();
  }
  const rb = B.ribbon, rh = Math.min(rb.h, Math.max(36, 42 * cu));
  let hasOpen = false;
  if (bookTab === 'stamps') {
    const ds = dailyStat();
    ribbon(rb.x + rb.w / 2, rb.y + rb.h / 2, rb.w - rh * 1.2, rh, `${STR.stamps} · ${fmt(STR.streakN, { n: (ds && ds.streak) || 0 })}`, fs.body * 1.05);
    const got = cb.stamps || [];
    B.stamps.forEach((r, i) => {
      const sp = got[i], cx = r.x + r.w / 2, cy = r.y + r.h / 2, Rs = r.w / 2;
      if (!sp) {
        circle(cx, cy, Rs * 0.86); g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeStyle = 'rgba(58,36,24,0.3)'; g.stroke(); g.setLineDash([]);
        return;
      }
      g.save(); g.translate(cx, cy); g.rotate(((i * 37) % 11 - 5) * 0.03);
      circle(0, 0, Rs * 0.9); g.fillStyle = 'rgba(255,246,227,0.9)'; g.fill(); g.lineWidth = Math.max(2.5, Rs * 0.08); g.strokeStyle = C.stamp; g.stroke();
      circle(0, 0, Rs * 0.74); g.lineWidth = Math.max(1, Rs * 0.03); g.stroke();
      const lab = String(sp.key || '').slice(5).replace('-', '/');
      txt(lab, 0, -Rs * 0.14, Math.max(12.5, Rs * 0.36), { col: C.stamp, maxW: Rs * 1.35 });
      const sr = Math.max(4, Rs * 0.15);
      for (let k = 0; k < 3; k++) drawStar((k - 1) * sr * 2.2, Rs * 0.36, sr, k < (sp.stars | 0));
      g.restore();
    });
    if (!got.length) {
      const gR = B.grid, msg = cur <= DAILY_UNLOCK ? fmt(STR.unlocksAt, { n: DAILY_UNLOCK }) : STR.dailyBody;
      const pw = Math.min(gR.w, Math.max(220, 300 * cu)), ph = Math.max(54, fs.body * 3.4);
      rr(gR.x + (gR.w - pw) / 2, gR.y + (gR.h - ph) / 2, pw, ph, 14); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
      txt2(msg, gR.x + gR.w / 2, gR.y + gR.h / 2, fs.body, { f: FB, col: C.ink, maxW: pw - 20 });
    }
  } else {
    const ch = cb.chapters.find(c => c.town === bookTab) || cb.chapters[0], ti = ch.index;
    const far = ch.mode === 'tease' || ch.mode === 'sealed';
    const rw = rb.w - rh * 1.2 - rh * 1.1;
    ribbon(rb.x + rb.w / 2 - rh * 0.55, rb.y + rb.h / 2, rw, rh, fmt(STR.bookChapter, { town: STR[ch.town], n: ch.beaten | 0 }), fs.body * 1.05,
      far ? '#8E7A66' : C.tomato, far ? '#6B5A49' : C.tomatoD);
    const chx = rb.x + rb.w - rh * 0.55, chy = rb.y + rb.h / 2;
    g.save(); if (!ch.chest && !ch.complete) g.globalAlpha = 0.6; glyph('chest', chx, chy, rh * 1.05); g.restore();
    if (ch.chest) tick(chx + rh * 0.32, chy - rh * 0.26, Math.max(14, rh * 0.36));
    ch.cards.forEach((cd, i) => {
      const r = B.cards[i]; if (!r) return;
      const spec = specOf(cd.n), tk = spec && spec.tickets && spec.tickets[spec.tickets.length - 1];
      const ic = tk && tk.boss && tk.boss.kind ? iconFor(tk.boss.kind) : null;
      const done = cd.state === 'done' && !far, open = cd.state === 'open' && !far;
      const b = done || open ? reg('card' + i, r, () => act('level', { n: cd.n }), { primary: open }) : null;
      if (open) hasOpen = true;
      const dn = b && isDown(b.id) ? 2 : 0, rad = Math.max(8, Math.min(r.w, r.h) * 0.14);
      rr(r.x, r.y + 3, r.w, r.h, rad); g.fillStyle = 'rgba(58,36,24,0.25)'; g.fill();
      rr(r.x, r.y + dn, r.w, r.h, rad); g.fillStyle = done ? C.paper : open ? C.goldL : C.paperS; g.fill();
      const pul = open ? 0.5 + 0.5 * Math.sin(T * 4) : 0;
      g.lineWidth = open ? Math.max(2.5, 3 * cu) + pul : 2; g.strokeStyle = C.ink; g.stroke();
      const starRow = done ? Math.max(10, r.h * 0.2) : 0;
      const as = Math.min(r.w * 0.86, (r.h - starRow) * 0.86), ax = r.x + r.w / 2, ay = r.y + dn + (r.h - starRow) / 2 + r.h * 0.03;
      if (done && ic) icon(ic, ax, ay, as, (x, y, s2) => cloche(x, y, s2 * 0.8));
      else {
        const sil = ic && tinted(ic, as, C.ink);
        g.save(); g.globalAlpha = open ? 0.55 : 0.16;
        if (sil) g.drawImage(sil, ax - as / 2, ay - as / 2, as, as); else cloche(ax, ay, as * 0.7);
        g.restore();
        if (!far) txt('?', ax, ay, Math.max(14, as * 0.42), { col: open ? C.ink : 'rgba(58,36,24,0.55)', stroke: open ? C.paper : null, sk: 3 });
      }
      if (!far) txt(String(cd.n), r.x + Math.max(5, r.w * 0.08), r.y + dn + Math.max(9, r.h * 0.13), 12.5, { align: 'left', col: C.goldS });
      if (done) { const sr = Math.min(starRow * 0.42, r.w * 0.1); for (let k = 0; k < 3; k++) drawStar(ax + (k - 1) * sr * 2.3, r.y + r.h - starRow * 0.6 + dn, sr, k < cd.stars); }
    });
    if (far) {
      const gR = B.grid, ms = Math.min(gR.w * 0.42, gR.h * 0.4, 150 * cu);
      const cy = gR.y + gR.h * 0.42;
      townMedal(ti, gR.x + gR.w / 2, cy, ms);
      const lab = ch.mode === 'tease' ? fmt(STR.opensAt, { n: ti * 20 + 1 }) : STR.sealed, lf = fs.body * 1.15;
      const lw = Math.min(gR.w, measure(lab, lf) + lf * 2.4), ly = cy + ms * 0.58;
      rr(gR.x + (gR.w - lw) / 2, ly, lw, lf * 2, lf); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
      txt(lab, gR.x + gR.w / 2, ly + lf, lf, { col: C.ink, maxW: lw - lf });
      // DECISION: "Next town" sits on a small gold tag above the medal, so it never reads as part of a card behind it.
      if (ch.mode === 'tease') {
        const nf = Math.max(12.5, fs.small * 1.1), nw = Math.min(gR.w, measure(STR.nextTown, nf, FB, '800') + nf * 1.6), ny = cy - ms * 0.5 - nf * 1.7;
        rr(gR.x + (gR.w - nw) / 2, ny, nw, nf * 1.6, nf * 0.8); g.fillStyle = C.gold; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
        txt(STR.nextTown, gR.x + gR.w / 2, ny + nf * 0.8, nf, { f: FB, wt: '800', col: C.ink, maxW: nw - nf * 0.6 });
      }
    }
  }
  paperBtn(reg('back', B.back, () => act('back'), { primary: !hasOpen }), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}

// ---- daily (order receipt + 7-stamp ladder) ----
function drawReceipt(B, fs, cu, lines, mask, head, stampK) {
  // DECISION: a receipt that gets the ORDER UP stamp (stampK != null) keeps its right side free for it: the stamp
  //   lands beside the star lines, never over them (and the ingredient icon is left out there).
  const r = B.receipt, rHead = B.lines[0].y - r.y, pad = Math.max(10, 14 * cu);
  // the reserve shrinks (down to a 76 px stamp) when the longest line would not fit at the 12.5 floor
  let ss0 = 0, resv = 0;
  if (stampK != null) {
    const lr0 = B.lines[0], ssr = Math.min(lr0.h * 0.34, 12 * cu + 3), avail = lr0.w - pad * 2 - ssr * 2 - 8;
    const need = Math.max(0, ...B.lines.map((lr, i) => measure(lineText(lines && lines[i]) || '—', 12.5, FB, '800')));
    ss0 = clamp(Math.min(r.w * 0.34, 150 * cu, (avail - need - 4) / 1.08), 76, 150 * cu);
    resv = Math.max(0, Math.min(ss0 * 1.08 + 4, avail - need));
  }
  tornPaper(r.x, r.y, r.w, r.h, cu);
  txt(head, r.x + r.w / 2, r.y + rHead * 0.55, Math.max(16, fs.body * 1.2), { col: C.ink, maxW: r.w - pad * 2 });
  g.beginPath(); g.moveTo(r.x + pad * 0.6, r.y + rHead - 2); g.lineTo(r.x + r.w - pad * 0.6, r.y + rHead - 2); g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(58,36,24,0.45)'; g.stroke(); g.setLineDash([]);
  // DECISION: all star lines share one size (the largest that fits the longest line), so a long line never
  //   reads smaller than its neighbours.
  const lineW = (lr, l) => lr.w - pad * 2 - Math.min(lr.h * 0.34, 12 * cu + 3) * 2 - 8 - (l && l.type === 'eat' && !resv ? lr.h * 0.86 : 0) - resv;
  const lfs = Math.max(12.5, Math.min(fs.body, ...B.lines.map((lr, i) => {
    const l = lines && lines[i], w0 = measure(lineText(l) || '—', fs.body, FB, '800');
    return w0 > 0 ? fs.body * lineW(lr, l) / w0 : fs.body;
  })));
  B.lines.forEach((lr, i) => {
    const l = lines && lines[i], met = mask != null && ((mask >> i) & 1) === 1;
    const cy = lr.y + lr.h / 2, ss = Math.min(lr.h * 0.34, 12 * cu + 3);
    drawStar(lr.x + pad + ss, cy, ss, met);
    const is = lr.h * 0.86, hasIc = l && l.type === 'eat' && !resv;
    txt(lineText(l) || '—', lr.x + pad + ss * 2 + 8, cy + 1, lfs, { f: FB, align: 'left', col: met ? '#2E8A45' : C.ink, maxW: lineW(lr, l), min: 12.5 });
    if (hasIc) ingIcon(l.kind, lr.x + lr.w - pad - is * 0.4, cy, is * 1.2);
  });
  if (stampK > 0) {
    const l1 = B.lines[Math.min(1, B.lines.length - 1)];
    stampMark(r.x + r.w - pad * 0.4 - ss0 * 0.54, l1.y + l1.h / 2, ss0, STR.orderUp, 1.8 - 0.8 * back(stampK), -0.26, Math.min(1, stampK * 1.2) * 0.92);
  }
}
function drawSteps(B, fs, cu, ladder, bobIdx, landIdx, landK) {
  const st0 = B.steps;
  st0.forEach((r, i) => {
    const e = (ladder && ladder[i]) || { day: i + 1, reward: null, state: 'future' };
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, Rr = r.w / 2;
    if (i < 6) { const nx = st0[i + 1].x; g.beginPath(); g.moveTo(cx + Rr, cy); g.lineTo(nx, cy); g.lineWidth = Math.max(2, 3 * cu); g.strokeStyle = e.state === 'done' ? C.stamp : 'rgba(58,36,24,0.28)'; g.stroke(); }
    const today = e.state === 'today';
    if (today) { circle(cx, cy, Rr * (1.18 + 0.06 * Math.sin(T * 5))); g.fillStyle = 'rgba(255,211,77,0.5)'; g.fill(); }
    circle(cx, cy, Rr); g.fillStyle = e.state === 'done' ? C.paper : today ? C.goldL : C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const lift = i === bobIdx ? (0.5 + 0.5 * Math.sin(T * 3.4)) * Math.max(4, 7 * cu) + 2 : 0;
    g.save(); if (e.state === 'future') g.globalAlpha = 0.6;
    rewardIcon(e.reward, cx, cy - lift, Rr * 1.45);
    g.restore();
    const showStamp = e.state === 'done' && (i !== landIdx || landK >= 0);
    if (showStamp) {
      const k = i === landIdx ? clamp(landK, 0, 1) : 1, sc = i === landIdx ? 1.8 - 0.8 * back(k) : 1;
      g.save(); g.translate(cx, cy); g.rotate(-0.2); g.scale(sc, sc); g.globalAlpha = i === landIdx ? Math.min(1, k * 1.3) * 0.9 : 0.85;
      circle(0, 0, Rr * 0.9); g.lineWidth = Math.max(2, Rr * 0.14); g.strokeStyle = C.stamp; g.stroke();
      g.beginPath(); g.moveTo(-Rr * 0.38, 0); g.lineTo(-Rr * 0.08, Rr * 0.32); g.lineTo(Rr * 0.42, -Rr * 0.34); g.lineWidth = Math.max(2.5, Rr * 0.2); g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt';
      g.restore();
    }
    txt(String(e.day), cx, r.y + r.h + fs.small * 0.78, fs.small, { f: FB, col: today ? C.ink : C.goldS, maxW: r.w + 6 });
  });
}
function drawNextTown(r, fs, cu) {
  const cur = curLv(), ti = [1, 2].find(t => cur <= t * 20);
  if (ti == null || !r || r.h < 30) return;
  const ms = Math.min(r.h * 0.94, 96 * cu + 10), x = r.x + r.w / 2 - Math.min(r.w * 0.3, ms * 1.3);
  townMedal(ti, x, r.y + r.h / 2, ms);
  const tx = x + ms * 0.62, tw = r.x + r.w - tx;
  txt(STR.nextTown, tx, r.y + r.h / 2 - fs.body * 1.05, fs.small, { f: FB, align: 'left', col: C.goldS, maxW: tw });
  txt(STR[TOWNS[ti]], tx, r.y + r.h / 2 + 1, fs.body * 1.15, { align: 'left', col: C.ink, maxW: tw });
  txt(fmt(STR.opensAt, { n: ti * 20 + 1 }), tx, r.y + r.h / 2 + fs.body * 1.15, fs.small, { f: FB, align: 'left', col: C.ink, maxW: tw });
}
function ladderTitle(r, fs, ds) {
  if (!r || !ds) return;
  txt(fmt(STR.streakN, { n: ds.streak || 0 }), r.x + 2, r.y + r.h / 2, fs.small * 1.1, { f: FB, align: 'left', col: C.ink, maxW: r.w * 0.45 });
  if (ds.tomorrow) txt(`${STR.tomorrow}: ${rewardShort(ds.tomorrow.reward)}`, r.x + r.w - 2, r.y + r.h / 2, fs.small * 1.1, { f: FB, align: 'right', col: C.goldS, maxW: r.w * 0.52 });
}
function drawDaily(st) {
  // DECISION: the Daily screen is a receipt (the 3 star lines, ticked from today's mask), the 7-stamp ladder with
  //   tomorrow's reward bobbing, and the next locked town as a silhouette. Done today: the Cook button becomes a
  //   countdown pill (not a button) and Back is the primary. The once-only intro (data.intro) is Cook / Later.
  const d = cardData.daily || {}, ds = dailyStat();
  if (!ds || !ds.unlocked) { drawInfo(st, 'daily'); return; }
  const intro = !!d.intro, done = !!ds.done && !intro;
  const CL = cardLayout(L, 'daily', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(intro ? STR.dailyNew : STR.todayOrder, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  if (B.sub) txtMin(intro ? [STR.dailyBody, STR.dailyBodyShort] : [`${fmt(STR.dayN, { n: ds.day })} · ${fmt(STR.streakN, { n: ds.streak || 0 })}`], B.sub.x + B.sub.w / 2, B.sub.y + B.sub.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.sub.w });
  const lines = dailyLines(ds.key, curLv());
  drawReceipt(B, fs, cu, lines, ds.mask, `${STR.daily} · ${String(ds.key || '').slice(5).replace('-', '/')}`, ds.done ? 1 : null);
  ladderTitle(B.ladderT, fs, ds);
  drawSteps(B, fs, cu, ds.ladder, ds.tomorrow ? ds.tomorrow.day - 1 : -1, -1, 1);
  if (B.town) drawNextTown(B.town, fs, cu);
  if (!done) goldBtn(reg('primary', B.primary, () => act('daily'), { primary: true }), STR.cookToday, { u: cu, fs: fs.btn, glow: 0.5 + 0.5 * Math.sin(T * 4) });
  else {
    const r = B.primary, left = (ds.msToNext || 0) - (T - dsCache.t) * 1000;
    rr(r.x, r.y, r.w, r.h - 4, (r.h - 4) / 2); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const s = fmt(STR.nextOrder, { t: hms(left) }), is = Math.min(r.h * 0.5, fs.btn2 * 1.4);
    const tw = Math.min(measure(s, fs.btn2, FB, '800'), r.w - is - 30), x0 = r.x + (r.w - is - 8 - tw) / 2;
    glyph('clock', x0 + is / 2, r.y + (r.h - 4) / 2, is);
    txt(s, x0 + is + 8, r.y + (r.h - 4) / 2 + 1, fs.btn2, { f: FB, align: 'left', col: C.ink, maxW: r.w - is - 30 });
  }
  if (B.back) paperBtn(reg('back', B.back, () => act(intro ? 'later' : 'back'), { primary: done }), intro ? STR.later : STR.back, { u: cu, fs: fs.btn2, icon: intro ? null : (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}
function drawLadder(st) {
  // DECISION: the Daily end card: the receipt gets its ORDER UP stamp (+0.3 s), today's ladder step is stamped at
  //   +0.8 s (sfx streak {day}, once), then the day's coins count up. A replay (no pay) shows the ladder as it is.
  const d = cardData.ladder || {}, ds = d.status || dailyStat() || {};
  const CL = cardLayout(L, 'ladder', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  const day = d.day || ds.day || 1, hk = clamp((cardT - 0.15) / 0.16, 0, 1);
  const head = d.paid ? fmt(STR.dayN, { n: day }) + '!' : STR.nice;
  g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.04); const hsc = 1.5 - 0.5 * back(hk); g.scale(hsc, hsc); g.globalAlpha = clamp(hk * 1.5, 0, 1);
  txt(head, 0, 0, fs.head, { col: C.gold, stroke: C.ink, sk: Math.max(4, fs.head * 0.14), shadow: C.ink, maxW: B.head.w * 0.9, min: 18 });
  g.restore();
  if (B.sub) txt(d.replay ? STR.comeBack : STR.dayServed, B.sub.x + B.sub.w / 2, B.sub.y + B.sub.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.sub.w });
  const key = d.key || ds.key, lines = dailyLines(key, curLv()), mask = d.mask != null ? d.mask : ds.mask;
  drawReceipt(B, fs, cu, lines, mask, `${STR.daily} · ${String(key || '').slice(5).replace('-', '/')}`, clamp((cardT - 0.3) / 0.16, 0, 1));
  ladderTitle(B.ladderT, fs, ds);
  const landIdx = d.paid ? (day - 1) % 7 : -1, landK = clamp((cardT - 0.8) / 0.16, -1, 1);
  if (d.paid && cardT >= 0.8) sfx1('streak', 'streak', { day });
  const bob = ds.tomorrow ? ds.tomorrow.day - 1 : -1;
  drawSteps(B, fs, cu, ds.ladder, cardT > 1.1 ? bob : -1, landIdx, landIdx >= 0 && cardT < 0.8 ? -1 : landK);
  // coins (+ the day's reward)
  const co = B.coins, total = d.total | 0 || d.coins | 0;
  if (co && total > 0) {
    const ck = clamp((cardT - 1.1) / 0.7, 0, 1), shown = Math.round(total * ease(ck));
    const tickN = Math.floor(shown / Math.max(1, total / 10));
    if (ck > 0 && ck < 1 && tickN !== ladTick) { ladTick = tickN; sfx('coin'); }
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = measure(cs, cfs), cr = cfs * 0.55;
    const rw = d.reward && (d.reward.skin || d.reward.chest || d.reward.lid || d.reward.boost) ? cfs * 1.6 : 0;
    const cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8 + rw) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
    if (rw) rewardIcon(d.reward, cx0 + cr * 2 + 8 + ctw + rw * 0.6, co.y + co.h / 2, cfs * 1.5);
  }
  goldBtn(reg('primary', B.primary, () => act('nice'), { primary: true }), STR.nice, { u: cu, fs: fs.btn, glow: cardT > 1.6 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0 });
  g.restore();
}
let ladTick = -1;
function drawLid(st) {
  // DECISION: "Saved by a lid!" reuses the info card geometry (icon, title, body, Phew!) with the lid wobbling over
  //   the streak count; it plays the gift sound once.
  const ds = (cardData.lid && cardData.lid.key ? cardData.lid : dailyStat()) || {};
  const CL = cardLayout(L, 'info', { primary: true, noBack: true });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  sfx1('lid', 'gift');
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  if (B.icon.h > 30) {
    const s = Math.min(B.icon.h, B.icon.w * 0.5, 150 * cu), cx = B.icon.x + B.icon.w / 2, cy = B.icon.y + B.icon.h / 2;
    const k = clamp(cardT / 0.5, 0, 1), drop = (1 - back(k)) * -s * 0.6;
    g.save(); g.translate(cx, cy + drop); g.rotate(Math.sin(T * 6) * 0.06 * (1 - clamp((cardT - 0.5) / 1.5, 0, 1)) + 0.02);
    lidIcon(0, 0, s); g.restore();
    badge(cx + s * 0.42, cy + s * 0.32, Math.max(13, 15 * cu), fmt(STR.streakN, { n: ds.streak || 0 }), C.stamp);
  }
  txt2(STR.savedLid, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  txt2((ds.lids | 0) > 0 ? fmt(STR.lidBody, { n: ds.lids }) : STR.lidBody0, B.body.x + B.body.w / 2, B.body.y + B.body.h / 2, fs.body, { f: FB, col: C.ink, maxW: B.body.w });
  goldBtn(reg('primary', B.primary, () => act('phew'), { primary: true }), STR.phew, { u: cu, fs: fs.btn });
  g.restore();
}

// ---- feast start / end ----
let feastSel = null;
function drawFeast(st) {
  // DECISION: the Feast card shows the kie feast art, the best run, and (once Market is open) a town picker; the
  //   default town is meta.feastTown(). Start sends feast {town}.
  const cur = curLv();
  if (cur <= FEAST_UNLOCK) { drawInfo(st, 'feast'); return; }
  const open = TOWNS.filter((t, i) => cur > i * 20);
  if (!feastSel || !open.includes(feastSel)) { const ft = safe(() => M.feastTown(), open[0]); feastSel = open.includes(ft) ? ft : open[0]; }
  const CL = cardLayout(L, 'feast', { towns: open.length });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(STR.feast, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  const hero = img('win-feast');
  if (B.hero.h > 30) {
    const bob = Math.sin(T * 2.4) * B.hero.h * 0.015;
    if (hero) drawFit(g, hero, B.hero.x, B.hero.y + bob, B.hero.w, B.hero.h); else glyph('feast', B.hero.x + B.hero.w / 2, B.hero.y + B.hero.h / 2, Math.min(B.hero.w, B.hero.h) * 0.8);
  }
  const best = safe(() => M.feastBest(), 0) | 0, br = B.best, bc = br.y + br.h / 2;
  if (best > 0) {
    const s = fmt(STR.bestN, { n: best }), is = fs.stat * 1.5, tw = measure(s, fs.stat * 1.1);
    const x0 = br.x + (br.w - is - 8 - tw) / 2;
    icon('ui-ticket', x0 + is / 2, bc, is, (x, y, s2) => tornPaper(x - s2 * 0.3, y - s2 * 0.4, s2 * 0.6, s2 * 0.8, cu));
    txt(s, x0 + is + 8, bc + 1, fs.stat * 1.1, { align: 'left', col: C.ink, maxW: br.w - is - 10 });
  } else txt2(STR.feastBody, br.x + br.w / 2, bc, fs.body, { f: FB, col: C.ink, maxW: br.w });
  if (Array.isArray(B.towns)) B.towns.forEach((r, i) => {
    const t = open[i]; if (!t) return;
    const on = t === feastSel;
    const b = reg('town' + i, r, () => { feastSel = t; });
    paperBtn(b, STR[t], { u: cu, fs: fs.btn2, alts: [TOWN_SHORT[t]], fill: on ? C.goldL : C.paper });
    if (on) tick(r.x + r.w - 6, r.y + 6, Math.max(16, 18 * cu));
  });
  goldBtn(reg('primary', B.primary, () => act('feast', { town: feastSel }), { primary: true }), STR.startFeast, { u: cu, fs: fs.btn, glow: 0.5 + 0.5 * Math.sin(T * 4) });
  paperBtn(reg('back', B.back, () => act('back')), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}
let feTick = -1;
function drawFeastEnd(st) {
  // DECISION: the Feast end card counts the served orders up over the feast art (NEW BEST! stamp when pb), then the
  //   best + best chain, then the coins (coin ticks). Again = a fresh Feast in the same town; Title goes home.
  const d = cardData.feastend || {};
  const CL = cardLayout(L, 'feastend', {});
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  const hk = clamp((cardT - 0.2) / 0.16, 0, 1);
  if (d.pb) { if (cardT >= 0.9) stampMark(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2, Math.min(B.head.w * 0.8, B.head.h * 2.1), STR.newBest, 1.8 - 0.8 * back(clamp((cardT - 0.9) / 0.16, 0, 1)), -0.08, clamp((cardT - 0.9) / 0.16, 0, 1) * 1.2); }
  else {
    g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.03); const sc = 1.4 - 0.4 * back(hk); g.scale(sc, sc); g.globalAlpha = clamp(hk * 1.5, 0, 1);
    txt(STR.feastOver, 0, 0, fs.head, { col: C.ink, stroke: C.paper, sk: 4, maxW: B.head.w * 0.95, min: 18 }); g.restore();
  }
  if (B.hero.h > 30) {
    const hero = img('win-feast');
    g.save(); g.globalAlpha = 0.9; if (hero) drawFit(g, hero, B.hero.x, B.hero.y, B.hero.w, B.hero.h); g.restore();
    const n = d.tickets | 0, k = clamp((cardT - 0.3) / 0.6, 0, 1), shown = Math.round(n * ease(k));
    const big = Math.min(B.hero.h * 0.42, 96 * cu), cx = B.hero.x + B.hero.w / 2, cy = B.hero.y + B.hero.h * 0.44;
    txt(String(shown), cx, cy, big, { col: C.gold, stroke: C.ink, sk: Math.max(5, big * 0.12), shadow: C.ink, maxW: B.hero.w * 0.8 });
    const lab = n === 1 ? STR.served1 : STR.served;
    const lf = Math.max(14, fs.stat * 1.1), lw = measure(lab, lf, FB, '800') + lf * 1.6;
    rr(cx - lw / 2, cy + big * 0.55, lw, lf * 1.7, lf * 0.85); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    txt(lab, cx, cy + big * 0.55 + lf * 0.87, lf, { f: FB, col: C.ink, maxW: lw - 8 });
  }
  const s2 = B.stats, cyS = s2.y + s2.h / 2, cells = [];
  cells.push(['star', fmt(STR.bestN, { n: Math.max(d.best | 0, d.tickets | 0) })]);
  if (d.chainBest) cells.push(['chain', fmt(STR.bestChain, { n: d.chainBest })]);
  const cw = s2.w / cells.length;
  cells.forEach(([ic, s], i) => {
    const x0 = s2.x + i * cw, is = fs.stat * 1.2, tws = Math.min(measure(s, fs.stat, FB, '800'), cw - is - 10), sx = x0 + (cw - (is + 6 + tws)) / 2;
    glyph(ic, sx + is / 2, cyS, is);
    txt(s, sx + is + 6, cyS + 1, fs.stat, { f: FB, align: 'left', col: C.ink, maxW: cw - is - 10 });
  });
  const co = B.coins, total = d.coins | 0;
  if (total > 0) {
    const ck = clamp((cardT - 1.0) / 0.8, 0, 1), shown = Math.round(total * ease(ck)), tn = Math.floor(shown / Math.max(1, total / 12));
    if (ck > 0 && ck < 1 && tn !== feTick) { feTick = tn; sfx('coin'); }
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = measure(cs, cfs), cr = cfs * 0.55, cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
  }
  goldBtn(reg('primary', B.primary, () => act('again'), { primary: true }), STR.again, { u: cu, fs: Math.max(fs.btn, 26 * cu), glow: cardT > 1.2 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('back', B.back, () => act('title')), STR.titleBtn, { u: cu, fs: fs.btn2 });
  g.restore();
}
function resetScreenState() { shopSel = bookTab = feastSel = null; dsCache.t = -9; ladTick = feTick = -1; }

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
  // DECISION: All-done: the primary is today's Daily while it is open and not done, else the Feast; the second button
  //   is the Feast (or the Cookbook when the Feast is already the primary).
  alldone: { icon: 'star', title: () => STR.allDone, body: () => STR.allDoneBody,
    primary: () => (dailyOpenNow() ? [STR.cookToday, 'daily'] : [STR.feast, 'feast']),
    second: () => (dailyOpenNow() ? [STR.feast, 'feast'] : [STR.cookbook, 'cookbook']) },
  gift: { icon: d => (d.chest ? 'chest' : d.milestone ? 'star' : BOOST_NAME[d.kind] ? d.kind : 'gift'), title: d => (d.chest ? STR.chestT : d.milestone ? STR.starBonus : STR.gift),
    body: d => (d.chest && d.town && STR[d.town] ? STR[d.town] + ': ' : '') + giftBody(d), primary: () => [STR.collect, 'collect'] },
};
function giftRays(cx, cy, R, a) {
  g.save(); g.translate(cx, cy); g.globalAlpha = 0.55 * a;
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, R); gl.addColorStop(0, 'rgba(255,216,107,0.95)'); gl.addColorStop(1, 'rgba(255,216,107,0)');
  circle(0, 0, R); g.fillStyle = gl; g.fill();
  g.rotate(T * 0.35); g.fillStyle = 'rgba(245,179,35,0.35)';
  for (let i = 0; i < 12; i++) { g.rotate(TAU / 12); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, -0.11, 0.11); g.closePath(); g.fill(); }
  g.restore();
}
function dailyOpenNow() { const ds = dailyStat(); return !!(ds && ds.unlocked && !ds.done); }
function drawInfo(st, name) {
  // DECISION: Feast and All-done show the kie win-feast scene (GDD §9 All-done card) in the icon block; the others a glyph.
  const sv = (M && M.get && M.get()) || {}, cur = sv.cur || 1;
  const d = { ...(cardData[name] || {}) };
  if (name === 'daily') { d.locked = cur <= DAILY_UNLOCK; try { const s = M && M.dailyStatus && M.dailyStatus(); if (s) d.done = s.done; } catch {} }
  if (name === 'feast') d.locked = cur <= FEAST_UNLOCK;
  const spec = INFO[name] || { icon: 'ladle', title: () => name.charAt(0).toUpperCase() + name.slice(1), body: () => '' };
  const pr = spec.primary ? spec.primary(d) : null;
  const sc = spec.second ? spec.second(d) : null;
  if (name === 'gift') sfx1('gift', d.chest ? 'chest' : d.milestone ? 'milestone' : 'gift');
  const CL = cardLayout(L, 'info', { primary: !!pr, second: !!sc, noBack: name === 'gift' });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  const hero = (name === 'feast' || name === 'alldone') && img('win-feast');
  if (hero && B.icon.h > 30) { const bob = Math.sin(T * 2.4) * B.icon.h * 0.015; drawFit(g, hero, B.icon.x, B.icon.y + bob, B.icon.w, B.icon.h); }
  else if (B.icon.h > 30 && name === 'gift') {
    // DECISION: a reward card (gift, town chest, star milestone) pops its prize in over slowly turning warm rays, so
    //   the payoff reads as a payoff, not a notice.
    const s = Math.min(B.icon.h * 0.92, B.icon.w * 0.6, 170 * cu), cx = B.icon.x + B.icon.w / 2, cy = B.icon.y + B.icon.h / 2;
    const k = clamp(cardT / 0.45, 0, 1), sc = 0.4 + 0.6 * back(k), bob = Math.sin(T * 2.4) * s * 0.03;
    giftRays(cx, cy, Math.min(B.icon.h * 0.62, s * 0.95) * (0.6 + 0.4 * k), k);
    g.save(); g.translate(cx, cy + bob); g.scale(sc, sc); glyph(spec.icon(d), 0, 0, s * 1.3); g.restore();   // the art has a transparent margin
  }
  else if (B.icon.h > 30) { const s = Math.min(B.icon.h, B.icon.w * 0.5, 140 * cu); const bob = Math.sin(T * 2.4) * s * 0.03; glyph(typeof spec.icon === 'function' ? spec.icon(d) : spec.icon, B.icon.x + B.icon.w / 2, B.icon.y + B.icon.h / 2 + bob, s); }
  txt2(spec.title(d), B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  txt2(spec.body(d), B.body.x + B.body.w / 2, B.body.y + B.body.h / 2, fs.body, { f: FB, col: C.ink, maxW: B.body.w });
  if (pr && B.primary) goldBtn(reg('primary', B.primary, () => act(pr[1], pr[2] || {}), { primary: true }), pr[0], { u: cu, fs: fs.btn });
  if (sc && B.second) paperBtn(reg('second', B.second, () => act(sc[1], sc[2] || {})), sc[0], { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph(sc[1], x, y, s) });
  if (B.back) paperBtn(reg('back', B.back, () => act('back'), { primary: !pr }), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}

const api = { initUI, draw, pointer, key, show, callout, rects, primaryButton, STR, setInput, setAction, debug, layoutNow, wheel };
export default api;
