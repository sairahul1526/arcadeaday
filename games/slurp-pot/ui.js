// Slurp Pot: ui.js (UI role). Everything on the 2D `#ui` canvas (D2): HUD, cards, tutorial beats, ghost hand,
// stick visual, edge arrows, callouts. Geometry comes from layout.js; sim facts from logic.js (read only).
//
// API (GDD §13.3):
//   initUI(canvas, { meta, audio, layout, render, bus, input?, onAction? })
//   draw(state, w, dt)            state = game.js state(): { screen, mode, paused, level, daily, boosters, tutStep }
//   pointer(type, x, y) -> bool   type 'down'|'move'|'up'|'cancel', CSS px relative to the canvas
//   key(e) -> bool                Enter/Space = primary button, Esc = back/close/pause, P = pause, 1/2/3 = boosters
//   show(screen, data)            'win' {n, kind, stars, tLeft, chainBest, coins, newStars, gifts, chest, milestone, nextSkin}
//                                 'fail' {n, kind, why, progress, missing:[{kind,n}], canFreeze, freezeCost}
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
import { LOW_TIME, STAR3, BOOST_UNLOCK, PRICES, LEVELS, DAILY_UNLOCK, FEAST_UNLOCK, SKINS, GILD_PRICE, LID_MAX, TOWNS, isMilestone, HOT_SECS } from './consts.js';
import { FIN_BEAT, FIN_BIG } from './camw.js';
import { guide } from './guide.js';

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
  title: 'Slurp Pot', play: 'PLAY', playN: 'PLAY · Level {n}', next: 'NEXT', allDoneBtn: 'FINISH', retry: 'RETRY', retryMore: 'RETRY +{n} s',
  mercyLine: '{n} s extra this try', mercyBoth: '{n} s extra this try. Pot {p}% bigger!', mercyBothShort: '+{n} s. Pot {p}% bigger!',
  mercyRetry: 'Extra time to help you! +{n}s', mercyRetryGrow: 'Extra time and a bigger pot to help you!',
  mercyGift: 'A little gift: +{n}s on the clock!', mercyGiftGrow: 'A little gift: extra time and a bigger pot!',
  tipArrows: 'Follow the arrows to the food you still need.', tipSmall: 'Eat small things first to grow.', tipBig: "Big things have to wait until you're bigger.",
  goal3: 'Finish {n}s faster for 3 stars', goal3Short: '{n}s faster for 3 stars', goal3Left: 'Finish with {n}s left for 3 stars', goal3LeftShort: '{n}s left for 3 stars',
  starFinish: 'Finish', starLeft: '{n}s left',
  bossOrder: 'BOSS ORDER', bossUnlocked: 'BOSS UNLOCKED!', bossEaten: 'BOSS EATEN!',
  canBuy: 'You can buy the {skin}!', canBuyShort: 'You can buy a new pot!', canGild: 'Gild your {skin}!', canGildShort: 'You can gild a pot!', replayBonus: 'Replay bonus',
  hotIntro: 'Hot chili! It burns {n} seconds. Steer around it.', hotIntroShort: 'Hot chili! Steer around it.', hotPop: '-{n}s',
  replay: 'Replay', map: 'Map', resume: 'Resume', restart: 'Restart', settings: 'Settings', paused: 'Paused',
  orderUp: 'ORDER UP!', serveIt: 'Serve it!', recEaten: '{n} eaten', soClose: 'SO CLOSE!', almost: 'Almost!', outOfTime: 'Out of time!',
  spoiled: 'Spoiled!', spoilLeft: 'Not enough {name} left', spoilLeftShort: 'Ran out of food', spoilGrow: 'Not enough food left to grow', spoilGrowShort: 'Ran out of food', nMore: '{n} more', freeze: '+10 s, keep cooking', freezeShort: '+10 s', freezeLeft: '{n} left', timeLeft: '{t} left',
  bestChain: '{n} in a row!', chainShort: '×{n}', coinsPlus: '+{n}', nextSkin: 'Next pot: {skin}, {n} more coins', nextSkinShort: 'Next pot: {n} more coins', nextSkin1: 'Next pot: {skin}, 1 more coin', nextSkinShort1: 'Next pot: 1 more coin',
  backIn: 'Back in {t}', chestIn: 'Win {n} more for a chest', chestIn1: 'Win 1 more for a chest', giftIn: '{n} more stars for a gift', giftIn1: '1 more star for a gift',
  dragToMove: 'Drag to move', growToOpen: 'Grow to open', lidOn: 'Lid on! Go around',
  daily: 'Daily', feast: 'Feast', cookbook: 'Cookbook', cookbookShort: 'Book', shop: 'Shop', back: 'Back', done: 'Done',
  music: 'Music', sound: 'Sound', showStick: 'Show joystick', reset: 'Reset progress', resetSure: 'Tap again to reset',
  credits: 'Slurp Pot · Arcade a Day', on: 'On', off: 'Off', unlocksAt: 'Unlocks at Level {n}', dailyOrder: 'Daily Order', dailyWhat: 'A new order every day. Cook 7 days in a row for the top prize!', dailyWhatShort: 'A new order every day', winMore1: 'Win 1 more level to unlock', winMoreN: 'Win {n} more levels to unlock', winMoreShort: 'Win {n} more',
  cookToday: "Cook today's order", startFeast: 'Start Feast', allDone: 'All 60 orders served!',
  dailyBody: 'A fresh order every day. Cook 7 days in a row to win the Star Ladle pot!', dailyBodyShort: '7 days in a row wins the Star Ladle!', dailyDone: 'Order served! Come back tomorrow.',
  feastBody: 'Serve as many orders as you can!', shopBody: 'New pots are on the way. Save your coins!',
  cookbookBody: 'Every order you serve gets a recipe card.', allDoneBody: 'Harbour is done. You ate the lighthouse!', allDoneStamp: 'HEAD CHEF!', allDoneLeft: 'The Daily Order and the Feast stay open.', allDoneLeft2: 'Feast is open. A new Daily tomorrow.',
  picnic: 'Picnic Park', market: 'Market Street', harbour: 'Harbour', collect: 'Collect', gift: 'A gift!',
  giftBody: 'Tap them during a level.', giftMagnet: 'Tap it during a level to pull food in.', giftFreeze: 'Tap it during a level for more time.',
  giftMega: 'Tap it during a level to eat bigger food.', tooBig: 'Too big! Eat smaller food', chestT: 'Town chest!', chestSmall: 'Bonus chest!', starBonus: 'Star bonus!',
  giftCoins: '+{n} coins', eachBooster: '{n} of each booster', levelLabel: 'L{n} · {name}', levelShort: 'L{n}', dailyLabel: 'Daily',
  feastLabel: 'Feast', mute: 'Sound', newBest: 'NEW BEST!', stars: '{n}', loading: 'Cooking…',
  goAround: 'Go around the {w}', goAroundIt: 'Go around it', growFirst: 'Eat more to grow', starsLive: '3 stars: {t}', beatLeft: '{n} to go!', beatBig: 'Bigger pot!', feastOneMore: '1 more order to beat your best', tip_magnet: 'Magnet pulls food in', tip_freeze: 'Freeze adds 10 seconds', tip_mega: 'Mega eats bigger food', magnet: 'Magnet', freezeB: 'Freeze', mega: 'Mega rim', needCoins: 'Needs {n} coins',
  nice: 'Nice!', phew: 'Phew!', savedLid: 'Saved by a lid!', lidBody: 'Your streak is safe. {n} lid left.',
  lidBody0: 'Your streak is safe!', again: 'Again', titleBtn: 'Title', feastOver: 'Feast over!', opensAt: 'Opens at L{n}',
  later: 'Later', gild: 'Gild', gilded: 'Gilded', wear: 'Wear', wearing: 'Wearing', tapToBuy: 'Tap again to buy', streak7: '7-day streak',
  lidName: 'Streak Lid', full: 'Full', boosters: 'Boosters', pots: 'Pots', buy: 'Buy', locked: 'Locked',
  playFreeA: 'Play free →', playFreeB: 'no download', ogTag: 'Slurp it all. Fill the order.',
  dServe: 'Serve the order', dEat: 'Eat {n} {name}', dChain: 'Chain ×{n}', dBig: '{n} big bites',
  dLeft: 'Finish with {p}% time', dNoBumps: 'No bumps', dNoBoost: 'No boosters', dSizzle: '{n} sizzles',
  stCake: 'Top tier first!', stTruck: 'Chase the truck!', stGulls: 'Beat the gulls!', stTwo: 'Two orders today!',
  stBelt: 'Ride the belts', stStack: 'Easy on stacks!', stRoll: 'Catch the rollers', stSimmer: 'Lid on! Go around',
  stPens: 'Grow to open', bumps: 'Bumps {n}', dayN: 'Day {n}', tomorrow: 'Tomorrow', tmrLine: 'Tomorrow: {r}', tmrLineShort: '{r}', tmrLocked: 'Daily day {d}: {r}', tmrLockedShort: 'Day {d}: {r}', nextOrder: 'Next order in {t}',
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
let lastWallMs = 0;
let screen = 'title', prevScreen = '', cardT = 0, cardData = {}, cardStack = [];
let btns = [], lastBtns = [], press = null, press2 = null, primary = null, kbHi = false;
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
  // Friday fix 2 (U8/U9): the mercy callout tells a retry from a carried step, and the fail tip rotates by card, not by the mercy step (it stops at 3).
  if (name === 'fail' && data) { failAt = data.n | 0; failCards++; } else if (name === 'win') { failAt = -1; shopWin = null; }
}
let settingsFrom = 'title', failAt = -1, failCards = 0, shopWin = null;
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
// DECISION (chaos lane 11-05): while one thumb steers, the other thumb can tap Pause or a booster. A second finger
//   only ever taps (no stick, no map drag) and only on play and pause; other cards stay one-pointer so two fingers
//   can't fire a card button twice. Pause counts because the steering thumb may still be down when Resume is tapped.
export function pointer2(type, x, y, id) {
  if (type === 'down') {
    press2 = null;
    if (screen !== 'play' && screen !== 'pause') return false;
    const b = hit(x, y);
    if (!b) return false;
    press2 = { id: b.id, pid: id, scr: screen };
    if (AU && AU.unlock) { try { AU.unlock(); } catch {} }
    return true;
  }
  if (!press2 || press2.pid !== id) return false;
  if (type === 'move') return true;
  const p = press2; press2 = null;
  if (type !== 'up' || p.scr !== screen) return false;
  const b = lastBtns.find(q => q.id === p.id);
  if (!b || b.disabled || !inR(hitR(b), x, y)) return false;
  sfx('ui');
  b.act && b.act();
  return true;
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
    if (screen === 'shop') shopBack(); else act('back');
    return true;
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
    hud.lastBite = T; hud.bites = (hud.bites || 0) + 1;
    if (d.ing) {
      hud.beatAsk = hud.beatAsk || 'order';
      const li = typeof d.ing === 'number' ? d.ing : lineIndexOf(d.kind);
      if (li >= 0) { if (hud.chipXY[li] && hud.ups.length < 8) hud.ups.push({ t0: T, li }); else hud.chipPop[li] = T; }
    }
  });
  on('sizeUp', d => {
    hud.sizeUps++; hud.beatAsk = 'size';
    if (hud.n === 1 && hud.sizeUps === 1 && !hud.flown) startFly();
  });
  on('line', d => { hud.lineDone[d.li] = T; if (d.ti === hud.ti) hud.chipPop[d.li] = T; });
  on('ticketDone', d => { hud.flip = T; hud.bossPulse = T; });
  on('padlock', d => {
    hud.padPop = T; hud.padIdx = d.i; hud.bossPoint = T; tutSet('padlock');
    if (lastW && lastW.mode !== 'feast' && !REC_M.record) hud.unlock = T;
  });
  on('bossNudge', () => { hud.padRattle = T; hud.chipNudge = T; });
  on('bossBite', d => {
    if (d.final === false) { hud.course = T; return; }
    // DECISION (Friday fix, finisher): render runs a boss finisher on a final bite (not in record, not Feast). The HUD ticket
    //   and band hide for it and ORDER UP stamps at the boom (finB().boom s after the bite) instead of at the bite.
    if (d.final && !d.feast && !REC_M.record) { hud.fin = T; hud.orderUp = T + finB().boom - 0.55; } else hud.orderUp = T;
  });
  // DECISION: two-course: 'course' {k} (logic, after courseDone) starts the second-ticket unfold unless the
  //   bossBite {final:false} just did; 'tier' {k} pops the cake tier mark on the meter.
  on('course', d => { if (T - hud.course > 1) hud.course = T; hud.courseK = d.k != null ? d.k : (hud.courseK || 0) + 1; });
  on('tier', d => { hud.tierPop = T; hud.tierK = d.k | 0; hud.lastBite = T; });
  on('refuse', () => { hud.refuse = T; });
  on('feastTicket', d => {
    hud.fServed = d.n | 0; hud.fPop = T; hud.lastBite = T;
    // U16: the best is only written when the run ends, so this still reads the score to beat
    const best = safe(() => (M && M.feastBest ? M.feastBest() : 0), 0);
    if (!hud.fOne && !REC_M.record && best >= 2 && hud.fServed === best - 1) { hud.fOne = true; callout('gift-feast', 'icon-chefhat', STR.feastOneMore, 3000); }
  });
  on('bump', () => { hud.bumpPop = T; });
  on('chain', d => { hud.chainPop = T; hud.beatAsk = 'chain'; });
  on('chainEnd', d => { hud.chainDrop = T; hud.chainLast = d.n || hud.chainLast; });
  on('sizzle', () => { hud.sizzle = T; });
  on('lowTime', () => { hud.low = T; });
  on('tick', () => { hud.tick = T; });
  on('boost', d => { hud.boostFx[d.kind] = T; if (d.kind === 'freeze') hud.frost = T; });
  // Friday fix 2 (U7): a swallowed chili pops the seconds by the clock and flushes it red.
  on('hot', () => { hud.hotPop = T; });
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
    n, ti: w.ti || 0, t0: T, started: null, lastBite: T, sizeUps: 0, chipPop: [], chipXY: [], ups: [], lineDone: [], flip: -9, bossPulse: -9,
    padPop: -9, padIdx: -1, padRattle: -9, chipNudge: -9, orderUp: -9, course: -9, chainPop: -9, chainDrop: -9, chainLast: 0, fin: null,
    chainShown: 0, sizzle: -9, low: -9, tick: -9, boostFx: {}, frost: -9, result: null, bossPoint: -9,
    reveal: skipReveal ? -9 : T, rDisp: w.pot ? w.pot.r : 0.3, fly: null, flown: false, hintItem: -1, idleCall: false,
    twistCall: false, firstAttempt: !skipReveal, courseK: 0, tierPop: -9, tierK: -1, refuse: -9,
    stuck: false, moved0: w.pot ? [w.pot.x, w.pot.z] : null,
    big: !REC_M.record && n > 0 && (!w.mode || w.mode === 'level') && isMilestone(n), bannerOff: null, unlock: -9, hotPop: -9, hotRing: -9, hotCall: false,
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
function isDown(id) { return (press && press.id === id && press.inside) || (press2 && press2.id === id); }
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
  // DECISION (Friday fix U12): card animations run on wall time (dt above is clamped to 0.1 s, so at 5 fps a 1.2 s card
  //   took 2.4 s and critics saw empty stars and +0). The wall step is capped at 0.5 s so a tab switch does not skip it.
  const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
  const wallDt = lastWallMs ? clamp((nowMs - lastWallMs) / 1000, 0, 0.5) : dt;
  lastWallMs = nowMs;
  T += dt; cardT += Math.max(dt, wallDt);
  const st = state || {};
  const scr = st.screen || screen;
  if (scr !== screen) { if (scr === 'map') MAP.init = ''; screen = scr; cardT = 0; press = null; kbHi = false; resetArm = -9; sfxOnce.clear(); armBuy = null; resetScreenState(); }
  recMode(st);
  if (screen !== prevScreen) { prevScreen = screen; }
  if (w && w !== lastW) {
    lastW = w;
    hud = newHud(w);
    // Friday fix 2 (U4): a toast belongs to the level that raised it. The queue used to outlive the level, so a jump through levels
    //   (and a quit straight after a first booster) played the three booster tips on later levels and read as a repeat.
    calloutQ = []; callNow = null;
    skipReveal = false;
    const t = w.tickets && w.tickets[w.ti || 0];
    curLines = t ? t.lines.length : 3; setTicketLines(curLines);
  } else if (w && w.tickets) {
    const t = w.tickets[w.ti || 0], n = t ? t.lines.length : 3;
    if (n !== curLines) { curLines = n; setTicketLines(n); }
    if (hud && (w.ti || 0) !== hud.ti) { hud.ti = w.ti || 0; hud.chipPop = []; hud.chipXY = []; hud.ups = []; hud.lineDone = []; hud.flip = -9; }
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
      if (playing && w) {
        const fa = finHudA();
        if (fa >= 0.999) drawHud(st, w, dt);
        else if (fa > 0.01) {   // fade: draw the HUD aside, then composite it at fa
          const main = g;
          try {
            if (!hudOff) hudOff = document.createElement('canvas');
            if (hudOff.width !== cv.width || hudOff.height !== cv.height) { hudOff.width = cv.width; hudOff.height = cv.height; }
            g = hudOff.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, hudOff.width, hudOff.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawHud(st, w, dt);
          } finally { g = main; }
          g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = fa; g.drawImage(hudOff, 0, 0); g.restore();
        }
        if (finOn()) drawOrderUp(w);
      }
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
      if (screen === 'play' && !finOn() && w) { if (!unlockOn() && bossBannerOut(w) >= 1) drawCallout(dt); drawBossBanner(w); drawUnlock(w); drawBeat(w); }
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
  applyCompact(compactK(w, t));
  // tutorial timers (real time; only while playing)
  if (playing && !rec) { tutorialTick(st, w); stuckTick(w); guideTick(w, dt); }
  drawMeter(w, dt);
  if (H.strip && w.mode === 'feast') drawFeastStrip(w);
  // DECISION (Friday fix U6): when the pot walks under the ticket (the boss sits near the top of the board) the ticket
  //   goes see-through so the pot is never hidden behind "Serve it!".
  let tka = 1;
  if (playing && !rec && w.pot && H.ticket) {
    const pp = worldToScreen(w.pot.x, w.pot.z), ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * u, pr = ppu * (w.pot.r || 0.3);
    const q = H.ticket;
    if (pp && pp.x + pr > q.x && pp.x - pr < q.x + q.w && pp.y + pr > q.y && pp.y - pr < q.y + q.h + 10) tka = 0.35;
  }
  hud.tka = (hud.tka == null ? 1 : hud.tka) + (tka - (hud.tka == null ? 1 : hud.tka)) * Math.min(1, dt / 0.12);
  if (!finOn()) { g.save(); g.globalAlpha = clamp(hud.tka, 0.35, 1); drawTicket(w, t); g.restore(); }
  if (w.timed !== false && w.T) drawEggTimer(w);
  if (!rec) {
    // pause tag (D33: pause glyph on a paper tag)
    const pb = reg('pause', H.pause, () => act('pause'));
    drawPauseTag(pb);
    drawBoosters(st, w);
    if (H.bump && w.mode === 'daily') drawBumpChip(w);
  }
  if (playing || rec) {
    if (!rec && !finOn()) { drawArrows(w); if (playing) drawHotRing(w); }
    drawChain(w);
    drawUps(w);
    if (!rec) { drawStick(st); drawGhost(w); drawFly(w); }
    if (!finOn()) drawOrderUp(w);
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
// DECISION (11-07 Sat, r4 playables-curator L58, grandparent): a ticket with 4 or more lines shows the full card for the first 3 s
//   (the player reads the order), then folds into a one-row strip (ring + count per line, no header) and the meter row and callout
//   band slide up into the space. The layout and the play rect (camera) are not touched: only the drawn rects move, from a baseline
//   saved on the layout object, so the 3D board never shifts and the sim cannot see it. Portrait and square only (the landscape
//   ticket is a side column with nothing under it); record/og keep the full card.
const COMPACT_AFTER = 3, COMPACT_MIN_LINES = 4;
function compactOn(t) { return !!t && t.lines.length >= COMPACT_MIN_LINES && L.aspect !== 'landscape' && !REC_M.record && !REC_M.og && !!L.hud.ticket; }
function compactK(w, t) {
  if (!compactOn(t) || !hud) return 0;
  const t0 = Math.max(hud.t0, hud.reveal, hud.course > 0 ? hud.course + 1 : -9);
  return ease(clamp((T - t0 - COMPACT_AFTER) / 0.4, 0, 1));
}
function compactBase() {
  const H = L.hud;
  if (!H._cb) H._cb = { th: H.ticket.h, my: H.meter.y, cy: H.callout.y, sy: H.strip ? H.strip.y : 0 };
  return H._cb;
}
/** Folded ticket height and how far everything below it moves up. */
function compactGeo() {
  const H = L.hud, u = L.u, b = compactBase(), railH = H.rail.h;
  const rowC = Math.max(28, H.chip.h * 0.85), thC = railH + Math.max(3, 4 * u) + rowC + Math.max(8, 10 * u);
  const starH = Math.max(22, 24 * u);   // the "3 stars: 0:20" tag hangs under the clock, the meter must stay clear of it
  const rowB = Math.max(b.th, H.tmr, H.btn), rowB2 = Math.max(thC, H.tmr + starH, H.btn);
  return { rowC, thC, dy: Math.max(0, rowB - rowB2), b };
}
function applyCompact(k) {
  const H = L.hud; if (!H.ticket) return;
  const b = compactBase();
  if (k <= 0) { H.ticket.h = b.th; H.meter.y = b.my; H.callout.y = b.cy; if (H.strip) H.strip.y = b.sy; return; }
  const gm = compactGeo();
  H.ticket.h = b.th + (gm.thC - b.th) * k;
  H.meter.y = b.my - gm.dy * k; H.callout.y = b.cy - gm.dy * k; if (H.strip) H.strip.y = b.sy - gm.dy * k;
}
/** The one-row strip: icon ring + "got/need" per line. A line that just ticked pops big for 0.6 s and wears the green count + tick. */
function drawCompactRow(w, t, r, cy) {
  const u = L.u, fs = L.fs, lines = t.lines, n = lines.length, pad = r.pad, inner = r.w - 2 * pad, slot = inner / n;
  const cfs = Math.max(12.5, fs.count * 0.92);
  const nud = T - hud.chipNudge < 0.6 ? 0.5 + 0.5 * Math.sin((T - hud.chipNudge) * 30) : 0;
  let cw = 0; for (const l of lines) cw = Math.max(cw, measure(`${l.need}/${l.need}`, cfs));
  const d = clamp(slot - cw - Math.max(5, 6 * u), 18, L.hud.chip.ring * 0.9);
  lines.forEach((l, i) => {
    const done = l.got >= l.need, frac = l.need ? l.got / l.need : 0;
    const gw = d + Math.max(3, 4 * u) + cw, x0 = r.x + pad + i * slot + (slot - gw) / 2, rx = x0 + d / 2;
    const pk = T - (hud.chipPop[i] ?? -9) < 0.6 ? 1 + 0.4 * Math.sin(clamp((T - hud.chipPop[i]) / 0.6, 0, 1) * Math.PI) : 1;
    chipRing(rx, cy, d, frac, done, 0, !done ? nud : 0);
    hud.chipXY[i] = { x: rx, y: cy, s: d };
    g.save(); g.translate(rx, cy); g.scale(pk, pk); ingIcon(l.kind, 0, 0, d * 0.82); g.restore();
    if (done) tick(rx + d * 0.36, cy + d * 0.3, Math.max(12, d * 0.5));
    g.save(); g.translate(x0 + d + Math.max(3, 4 * u), cy); g.scale(pk, pk); g.translate(-(x0 + d + Math.max(3, 4 * u)), -cy);
    txt(`${Math.min(l.got, l.need)}/${l.need}`, x0 + d + Math.max(3, 4 * u), cy + cfs * 0.05, cfs, { align: 'left', col: done ? '#2E8A45' : C.ink, maxW: cw + 4 });
    g.restore();
  });
}
function drawTicket(w, t) {
  // DECISION: no "2" tab under the ticket: the gap to the meter is ~8 px, so a tab was clipped to a sliver that read as a glitch.
  const H = L.hud, u = L.u, fs = L.fs, r = H.ticket;
  if (!r || !t) return;
  const n = (w.level && w.level.n) || hud.n;
  // goal reveal: ticket swings in from the rail (D15), first attempt only
  // 11-07 (viral r5): a record ticket never swings, unfolds or slides: frame 0 caught it tilted and a course change squashed the count mid-tick.
  const rv = REC_M.record ? -9 : T - hud.reveal, swing = rv >= 0 && rv < 0.9 ? Math.exp(-rv * 4.2) * Math.cos(rv * 13) * 0.32 * (1 - ease(rv / 0.9)) : 0;
  const drop = rv >= 0 && rv < 0.25 ? (1 - ease(rv / 0.25)) * -r.h * 0.9 : 0;
  // order-up: the HUD ticket leaves (the win card takes over); two-course: ticket 1 slides off left
  const ou = T - hud.orderUp, crs = REC_M.record ? -9 : T - hud.course;
  let ox = 0, oy = 0, sc = 1, alpha = 1;
  if (ou >= 0 && ou < 9) {
    const k = ease(ou / 0.5), fo = recOrderFade();
    // U14: in a record the ticket stays on the rail and takes the stamp there; flying to the middle hid the pot at the payoff
    if (REC_M.record) alpha = fo;
    else { ox = (cssW / 2 - (r.x + r.w / 2)) * k; oy = (cssH * 0.4 - (r.y + r.h / 2)) * k - (1 - fo) * cssH * 0.06; sc = 1 + 0.6 * k; alpha = fo; }
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
  tornPaper(r.x, by, r.w, r.h - railR.h * 0.5, u, hud.big ? { fill: '#FFF0C2' } : undefined);
  // Friday fix 2 (U2): a milestone's ticket wears a gold frame, so the order looks like the big one before a single bite.
  if (hud.big) {
    const fi = Math.max(3, 4 * u), th = Math.max(3, 4.5 * u);
    rr(r.x + fi, by + fi, r.w - 2 * fi, r.h - railR.h * 0.5 - 2 * fi - th, Math.max(5, 7 * u));
    g.lineWidth = Math.max(2.5, 3 * u); g.strokeStyle = C.gold; g.stroke();
  }
  // brass clip
  const clipW = Math.max(14, 18 * u), clipH = Math.max(8, 10 * u);
  rr(cx - clipW / 2, r.y - railR.h * 0.1, clipW, clipH, 3); g.fillStyle = C.brass; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
  // header
  const pad = r.pad, hy = r.y + railR.h + Math.max(3, 4 * u) + fs.hdr * 0.6;
  const name = (w.level && w.level.name) || '';
  // DECISION: a record run's ticket is headed with its town ("Picnic Park"), never the course's internal name.
  const head = REC_M.record ? [STR[(w.level && w.level.town) || 'picnic'] || STR.title, STR.title]
    : w.mode === 'daily' ? [name || STR.dailyLabel, STR.dailyLabel]
    : w.mode === 'feast' ? [STR.feastLabel + ' · ' + ((w.ti || 0) + 1), STR.feastLabel]
    : [fmt(STR.levelLabel, { n, name }), fmt(STR.levelShort, { n })];
  const flipT = T - hud.flip, flipping = !REC_M.record && flipT >= 0 && flipT < 0.3;
  const showServe = t.done && !(flipping && flipT < 0.15);
  const fsY = flipping ? Math.abs(Math.cos(flipT / 0.3 * Math.PI)) : 1;
  const bodyY = hy + fs.hdr * 0.6 + Math.max(2, 3 * u), bodyH = by + r.h - railR.h * 0.5 - Math.max(8, 10 * u) - bodyY;
  const ck = compactK(w, t);
  if (ck < 1) {
    g.save();
    if (ck > 0) { g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 4); g.clip(); g.globalAlpha = alpha * Math.max(0, 1 - ck * 2.5); }
    // header and full chips are gone from k 0.4 on: the strip below owns the paper
    // record: the header and the count clear as the stamp lands, so nothing ghosts through it (viral r5)
    const recUp = REC_M.record && ou >= 0 && ou < 9, clr = recUp ? 1 - clamp((ou - 0.15) / 0.12, 0, 1) : 1;
    if (ck < 0.4 && clr > 0) { g.save(); g.globalAlpha *= clr; txtMin(head, r.x + r.w / 2, hy, fs.hdr, { col: C.ink, maxW: r.w - 2 * pad }); g.restore(); }
    g.save(); g.translate(0, bodyY + bodyH / 2); g.scale(1, Math.max(0.05, fsY)); g.translate(0, -(bodyY + bodyH / 2));
    if (ck < 0.4) {
      if (REC_M.record) { if (clr > 0) { g.save(); g.globalAlpha *= clr; drawRecCount(w, r, bodyY, bodyH); g.restore(); } }
      else if (showServe) drawServe(w, t, r, bodyY, bodyH);
      else if (L.aspect === 'landscape') drawLinesList(w, t, r, bodyY);
      else drawChips(w, t, r, bodyY);
    }
    g.restore();
    g.restore();
  }
  if (ck > 0.4) {
    const gm = compactGeo(), ry = r.y + railR.h + Math.max(3, 4 * u);
    g.save(); g.globalAlpha = alpha * clamp((ck - 0.4) / 0.6, 0, 1);
    if (showServe) drawServe(w, t, r, ry, gm.rowC); else drawCompactRow(w, t, r, ry + gm.rowC / 2);
    g.restore();
  }
  g.restore();
}
// DECISION (11-07 Sat, viral r4): the clip's course has no ingredient lines, so its ticket sat as a blank cream box over 15 s of footage. It counts the bites
//   instead: the number climbing is the proof the caption promises, and it is the run's real count, not a script.
function drawRecCount(w, r, y, h) {
  const n = (w.stats && w.stats.bites) | 0; if (!n) return;
  const pk = popK(hud.lastBite ?? -9, 0.14);
  g.save(); g.translate(r.x + r.w / 2, y + h / 2); g.scale(pk, pk);
  txt(fmt(STR.recEaten, { n }), 0, 0, Math.min(h * 0.8, L.fs.serve * 2.1), { col: C.stamp, maxW: r.w - 2 * r.pad });
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
      hud.chipXY[i] = { x: rx, y: cy, s: cm.ring };
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
    hud.chipXY[i] = { x: rx, y: cy, s: Math.min(cm.ring, lh - 2) };
    const pk = popK(hud.chipPop[i] ?? -9);
    g.save(); g.translate(rx, cy); g.scale(pk, pk); ingIcon(l.kind, 0, 0, Math.min(cm.ring, lh - 2) * 0.82); g.restore();
    if (done) tick(rx + cm.ring * 0.36, cy + cm.ring * 0.3, Math.max(14, cm.ring * 0.5));
    const cnt = `${Math.min(l.got, l.need)}/${l.need}`, cw = measure(cnt, fs.count);
    txt(cnt, r.x + r.w - r.pad, cy + fs.count * 0.05, fs.count, { align: 'right', col: done ? '#2E8A45' : C.ink });
    if (nfs >= 12.5) txt(nameFor(l.kind), nx0, cy + 1, nfs, { f: FB, align: 'left', col: C.ink, maxW: r.x + r.w - r.pad - cw - Math.max(4, 6 * u) - nx0 });
  });
}

// ---- egg timer (D33): tomato kitchen timer clipped to the rail's right end ----
// U11: the seconds left to keep 3 stars, live, in a small tag under the clock. It leaves once the third star is gone.
function drawStarChip(w, r) {
  if (REC_M.record || finOn() || w.result || T - hud.hotPop < 1) return;
  const st = pauseStars(w);
  const left = st ? Math.ceil(w.tLeft - st.t3) : 0;
  if (left <= 0) return;
  const u = L.u, fsz = Math.max(12.5, 13.5 * u), label = fmt(STR.starsLive, { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
  const h = Math.max(19, fsz * 1.5), tw2 = measure(label, fsz, FB, '800'), w2 = tw2 + h * 0.9;
  // landscape: the ticket runs beside the clock with its counts on the right edge, so the chip starts clear of it
  const tk = L.aspect === 'landscape' ? L.hud.ticket : null;
  const x = Math.min(Math.max(r.x + r.w / 2 - w2 / 2, tk ? tk.x + tk.w + 4 : -1e9), cssW - 6 - w2), y = r.y + r.w + Math.max(1, 2 * u);
  g.save();
  rr(x, y, w2, h, h / 2); g.fillStyle = left <= 5 ? '#FFE3B0' : C.paper; g.fill(); g.lineWidth = Math.max(1.5, 1.6 * u); g.strokeStyle = C.ink; g.stroke();
  txt(label, x + w2 / 2, y + h / 2 + 0.5, fsz, { f: FB, col: left <= 5 ? C.stamp : C.ink });
  g.restore();
}
// U12: on a long level a beat lands about every 25 s of play, always riding a real moment (a size-up, a chain, an order bite),
//   so it is a cheer for something that just happened and never a timer going off. Under 25 s of play there is none at all.
const BEAT_EVERY = 25;
function drawBeat(w) {
  const ask = hud.beatAsk; hud.beatAsk = null;
  if (REC_M.record || w.mode === 'feast') return;
  const band = L.hud.callout, cx = band.x + band.w / 2, cy = band.y + band.h / 2, u = L.u;
  const rh = Math.max(30, 34 * u), fsz = Math.max(14, 17 * u);
  if (ask && !w.result && w.tStart != null && (w.t || 0) - w.tStart >= (hud.beatDue || BEAT_EVERY) && w.tLeft > LOW_TIME && !callNow && !calloutQ.length && !unlockOn()) {
    const pot = potBox(w), t = w.tickets && w.tickets[w.ti || 0];
    const left = t ? t.lines.reduce((a, l) => a + Math.max(0, l.need - l.got), 0) : 0, chain = w.chain ? w.chain.n : 0;
    const text = chain >= 10 ? fmt(STR.bestChain, { n: chain }) : ask === 'size' ? STR.beatBig : left > 0 && ask === 'order' ? fmt(STR.beatLeft, { n: left }) : null;
    if (text && !(pot && pot.top < cy + rh && pot.bot > cy - rh)) {
      hud.beatT = T; hud.beatTxt = text; hud.beatDue = (w.t || 0) - w.tStart + BEAT_EVERY; sfx('coin');
      if (globalThis.__qa) globalThis.__uiBeat = { text, at: (w.t || 0) - w.tStart };   // QA readout only
    }
  }
  const k = T - (hud.beatT ?? -9);
  if (k < 0 || k > 1.3 || !hud.beatTxt) return;
  const rw = Math.min(band.w - rh * 1.1, measure(hud.beatTxt, fsz) + rh * 2.4), sc = k < 0.18 ? 0.6 + 0.4 * back(k / 0.18) : 1;
  g.save(); g.globalAlpha = k > 1 ? (1.3 - k) / 0.3 : 1;
  for (let i = 0; i < 6 && k < 0.7; i++) {
    const a = -0.4 + (i % 3) * 0.4 + (i < 3 ? 0 : Math.PI), d = (rw * 0.5 + 6) + ease(k / 0.7) * 26 * u;
    g.save(); g.lineJoin = 'round'; g.globalAlpha = 1 - k / 0.7; star(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.5, Math.max(4, 6 * u)); g.fillStyle = C.gold; g.fill(); g.restore();
  }
  g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
  ribbon(cx, cy, rw, rh, hud.beatTxt, fsz, C.gold, C.brass);
  g.restore();
}
function drawEggTimer(w) {
  // DECISION (D33): cream ring on a tomato-dark track, ink ticks; low time = hot red + rattle. Never green or blue.
  const r = L.hud.timer, u = L.u, fs = L.fs;
  const R = r.w / 2, cx = r.x + R, cy = r.y + R;
  const frac = clamp(w.tLeft / w.T, 0, 1);
  const started = w.tStart != null || hud.started != null;
  const low = started && w.tLeft <= LOW_TIME && w.tLeft > 0 && !finOn();
  let sc = 1, rot = 0;
  if (!started) sc = 1 + 0.04 * (0.5 - 0.5 * Math.cos(T * TAU));          // breathe 1 Hz
  if (low) { sc = 1 + 0.06 * Math.max(0, Math.sin(T * TAU * 2)); rot = Math.sin(T * 120) * 0.12 * Math.max(0, 1 - (T - hud.tick) * 3); }
  const sz = T - hud.sizzle; if (sz >= 0 && sz < 0.35) sc *= 1 + 0.15 * Math.sin(sz / 0.35 * Math.PI);
  const hp = T - hud.hotPop; if (hp >= 0 && hp < 0.45) sc *= 1 + 0.16 * Math.sin(hp / 0.45 * Math.PI);
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
  // DECISION (Friday fix U1): whole seconds always show in the dial (the hands hid how much time was left).
  {
    const secs = Math.max(0, Math.ceil(w.tLeft));
    const dig = String(secs).length;
    const fsz = Math.min(Math.max(fs.secs, faceR * 1.05), faceR * (dig >= 3 ? 0.95 : 1.3));
    txt(String(secs), 0, by + fsz * 0.04, fsz, { col: low ? C.stamp : C.ink, maxW: faceR * 1.75 });
  }
  // 3-star notch: small gold star on the ring at the 3-star time (logic.starTimes, fallback STAR3 * T); gone once passed.
  {
    let t3 = STAR3 * w.T;
    try { if (LG && LG.starTimes) { const st3 = LG.starTimes(w); if (st3 && st3.t3 > 0) t3 = st3.t3; } } catch {}
    if (started && w.tLeft > t3 && t3 > 0 && w.T > 0) {
      const a = -Math.PI / 2 + TAU * clamp(t3 / w.T, 0, 1), sx = Math.cos(a) * ringR, sy = by + Math.sin(a) * ringR;
      g.save(); g.lineJoin = 'round'; star(sx, sy, Math.max(5.5, lw * 0.95)); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(1.2, 1.4 * u); g.strokeStyle = C.ink; g.stroke(); g.restore();
    }
  }
  // sizzle: steam puffs rise from the knob (no "+1" text, D33)
  if (sh >= 0 && sh < 0.6) for (let i = 0; i < 3; i++) {
    const k = sh / 0.6, px = (i - 1) * R * 0.28, py = -R * 1.0 - k * R * 0.6 - i * R * 0.08;
    circle(px, py, R * (0.12 + 0.06 * k)); g.fillStyle = `rgba(255,246,227,${(0.9 * (1 - k)).toFixed(2)})`; g.fill();
  }
  // freeze frost 0.6 s
  const fr = T - hud.frost;
  if (fr >= 0 && fr < 0.6) { circle(0, by, bodyR); g.fillStyle = `rgba(255,255,255,${(0.65 * (1 - fr / 0.6)).toFixed(2)})`; g.fill(); }
  // Friday fix 2 (U7): a burn flushes the whole clock red for a moment
  if (hp >= 0 && hp < 0.45) { circle(0, by, bodyR); g.fillStyle = `rgba(226,28,12,${(0.7 * (1 - hp / 0.45)).toFixed(2)})`; g.fill(); }
  g.restore();
  if (hp >= 0 && hp < 1) {
    // the seconds rise out of the clock's lower edge, clear of the digits
    const k = hp, s = Math.max(20, 26 * u) * (k < 0.15 ? 0.6 + 0.4 * back(k / 0.15) : 1);
    g.save(); g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    txt(fmt(STR.hotPop, { n: HOT_SECS }), cx, cy + R + s * 0.7 + k * s * 0.5, s, { col: C.hot, stroke: C.paper, sk: Math.max(3, s * 0.18) });
    g.restore();
  }
  drawStarChip(w, r);
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
    const ps = Math.max(18, 21 * u);
    if (!open) {
      g.save(); g.translate(s * 0.3, s * 0.22);
      if (rat >= 0 && rat < 0.4) g.rotate(Math.sin(rat * 45) * 0.35 * (1 - rat / 0.4));
      if (hud.big) {   // Friday fix 2 (U2): the big boss's padlock breathes, so the bar reads as the way in
        const pu = 0.5 + 0.5 * Math.sin(T * TAU * 1.3);
        circle(0, 0, ps * (0.66 + 0.16 * pu)); g.fillStyle = `rgba(255,211,77,${(0.35 + 0.35 * pu).toFixed(2)})`; g.fill();
        g.scale(1 + 0.12 * pu, 1 + 0.12 * pu);
      }
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
    // DECISION (Friday fix U5/U7): a booster nobody can buy right now (none in stock, too few coins) fades back so the
    //   column stops competing with the board; the first time a slot shows, a one-line tooltip says what it does (once per save).
    const canBuy = cnt > 0 || (sv.coins | 0) >= PRICES[kind];
    if (screen === 'play' && T - hud.t0 > 1.5 && !seenFlag('tip:boost:' + kind)) {
      seenFlag('tip:boost:' + kind, true);
      callout('tut-boost-' + kind, { magnet: 'icon-magnet', freeze: 'icon-freeze', mega: 'icon-megarim' }[kind], STR['tip_' + kind], 3200);
    }
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
    if (used) g.globalAlpha = 0.4; else if (!canBuy) g.globalAlpha = 0.5;
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
      // 11-07 (art-director r5): the price read tiny at 390 px; tag and numerals about 25 % bigger.
      const pw = Math.max(37, 42 * u), ph = Math.max(19, 21 * u);   // ph * 0.45 below the tin stays inside the 10u gap
      const poor = hud.boostPoor && hud.boostPoor.kind === kind && T - hud.boostPoor.t < 0.4 ? Math.sin((T - hud.boostPoor.t) * 60) * 3 : 0;
      g.translate(poor, 0);
      rr(cx - pw / 2, r.y + r.h - ph * 0.55, pw, ph, ph / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.ink; g.stroke();
      coin(cx - pw * 0.24, r.y + r.h - ph * 0.55 + ph / 2, ph * 0.34);
      txt(String(PRICES[kind]), cx + pw * 0.12, r.y + r.h - ph * 0.55 + ph / 2 + 0.5, Math.max(15.5, 15 * u), { col: C.ink });
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
  const arrows = []; let lost = false;
  if (t.boss >= 0 && !isHid(w, t.boss) && (!w.st || w.st[t.boss] === 0 || w.st[t.boss] === 1)) {
    const p = worldToScreen(w.ix[t.boss], w.iz[t.boss]);
    if (p && !onPlay(p)) arrows.push({ p, ic: iconFor(bossKind(w, t)), boss: true });
    else if (p && T - hud.bossPoint < 3) bouncePointer(p.x, p.y - L.hud.arrow * 0.9);
  }
  if (!t.done && w.n) {
    // DECISION (Friday fix U3): one arrow per open order line that has nothing of its kind on screen (before: one arrow, and only
    //   when no open kind at all was on screen). L1-L10 show every open line, later levels at most 2 lines (plus the boss).
    const best = new Map(), seen = new Set();
    const openIds = new Set(t.lines.filter(l => l.got < l.need).map(l => kindId(l.kind)));
    for (let i = 0; i < w.n; i++) {
      const s = w.st ? w.st[i] : 0; if (!(s === 0 || s === 3) || isHid(w, i)) continue;
      const k = itemKind(w, i); if (!openIds.has(k) || seen.has(k)) continue;
      if (onPlay(worldToScreen(w.ix[i], w.iz[i]))) { seen.add(k); best.delete(k); continue; }
      const d = (w.ix[i] - w.pot.x) ** 2 + (w.iz[i] - w.pot.z) ** 2, b = best.get(k);
      if (!b || d < b.d) best.set(k, { d, i });
    }
    const cap = (hud.n || 0) <= 10 ? 3 : 2;
    [...best.values()].sort((x, y) => x.d - y.d).slice(0, cap).forEach(b => {
      const p = worldToScreen(w.ix[b.i], w.iz[b.i]); if (p) arrows.push({ p, ic: iconFor(itemKind(w, b.i)) });
    });
    // 11-07 Sat (r4 grandparent): up to L10, with nothing on the order in view, the arrows are the only guide, so they pulse bigger.
    // DECISION (11-07 Sat, r4): the lost pulse also runs on L21-24 and L41-44, where a new ticket pool arrives and players lose the target again.
    const nn = hud.n || 0;
    if (arrows.length && !seen.size && (nn <= 10 || (nn >= 21 && nn <= 24) || (nn >= 41 && nn <= 44))) lost = true;
  }
  arrowPlaced.length = 0;
  for (const a of arrows.slice(0, 4)) edgeArrow(a.p.x, a.p.y, a.ic, lost ? 1.2 + 0.12 * Math.sin(T * TAU * 1.5) : 1);
}
const arrowPlaced = [];
const isHid = (w, i) => !!(w.hid && w.hid[i] === 1);
function edgeArrow(tx, ty, ic, big = 1) {
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
  // two arrows that land on the same spot slide apart along the edge
  for (let pass = 0; pass < 3; pass++) for (const q of arrowPlaced) if (Math.hypot(ax - q.x, ay - q.y) < s * 1.05) {
    const sx = -dy, sy = dx, sg = (ax - zx) * sx + (ay - zy) * sy >= 0 ? 1 : -1;
    ax += sx * sg * s * 1.1; ay += sy * sg * s * 1.1;
    ax = clamp(ax, Z.x + s / 2, Z.x + Z.w - s / 2); ay = clamp(ay, Z.y + s / 2, Z.y + Z.h - s / 2);
  }
  arrowPlaced.push({ x: ax, y: ay });
  const bob = Math.sin(T * TAU * 2) * 3 * L.u;
  ax += dx * bob; ay += dy * bob;
  const ang = Math.atan2(dy, dx);
  g.save(); g.translate(ax, ay); g.scale(big, big); g.lineJoin = 'round';
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
  // DECISION (Friday fix U4): the hint appears at 1 s and stays until the first move (one 2-minute callout, cleared on move),
  //   so it no longer pops in and out; the hand stands beside the pot, never on it.
  const wantDrag = !moved && n <= 2 && !tutHas('drag') && since > 1.0;
  hud.ghost = wantDrag;
  if (wantDrag && !hud.idleCall) { hud.idleCall = true; callout('tut-drag', 'hand', STR.dragToMove, 120000); }
  // Friday fix 2 (U8): the same help reads two ways. After a loss here it is a hand up; a step carried into a new level is a gift,
  //   so it never looks like an alarm or like a punishment for the win before it.
  if (w.level && w.level.mercy > 0 && !hud.mercyCall) {
    hud.mercyCall = true;
    const again = failAt === n, big = w.level.mercyGrow > 1;
    callout('gift-mercy', 'icon-clock', fmt(again ? (big ? STR.mercyRetryGrow : STR.mercyRetry) : (big ? STR.mercyGiftGrow : STR.mercyGift), { n: w.level.mercy }), 3400);
  }
  hotTick(w);
  if (moved) { calloutQ = calloutQ.filter(c => c.id !== 'tut-drag'); if (callNow && callNow.id === 'tut-drag' && callNow.ms > 1000) callNow.ms = 0; }
  tooBigTick(w, n, moved);
  // twist intros: stuckTick (below) owns the ≤ 4-word "stuck 4 s" callouts for every twist
  // L1: the bouncing gold pointer stays on the flown-to sandwich until it is eaten
  if (hud.hintItem >= 0 && w.st && w.st[hud.hintItem] !== 0) hud.hintItem = -1;
}
// DECISION (11-05, first-time lane): pressing against something too big said nothing, and a slow push never reaches the
//   bump speed, so L1-L3 test contact here: the first touch of an item that doesn't fit names the rule, once per save.
function tooBigTick(w, n, moved) {
  if (n > 3 || !moved || hud.bigTip || w.mode !== 'level' || !w.fits || !w.pot || !w.ia) return;
  if (seenFlag('tip:toobig')) { hud.bigTip = true; return; }
  const r = w.pot.r;
  for (let i = 0; i < (w.n || 0); i++) {
    if (w.fits[i] || (w.st && w.st[i] !== 0) || isHid(w, i)) continue;
    const reach = (r + w.ia[i]) * 1.08, dx = w.ix[i] - w.pot.x, dz = w.iz[i] - w.pot.z;
    if (dx * dx + dz * dz > reach * reach) continue;
    hud.bigTip = true; seenFlag('tip:toobig', true);
    callout('tut-toobig', iconFor(itemKind(w, i)), STR.tooBig, 3000);
    return;
  }
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
// DECISION (U4, U5): one hint, the guide trail, replaces the Friday arrow. Soft gold dots lie on the ground along guide.js's route
//   (it bends round walls; no target or path logic lives here). The dots are anchored from the target end, so they stay put while
//   the pot walks them up, and any dot that would sit on food is dropped. Timers run on sim time, so a pause never counts.
const GUIDE_WAIT = 4, STUCK_WAIT = 6, STUCK_LINE_EVERY = 10, GUIDE_EVERY = 0.34;
const WALL_WORD = { hedge: 'hedge', fence: 'fence', car: 'car', ropepost: 'post' };
function orderCount(w) {
  const t = w.tickets && w.tickets[w.ti || 0];
  let n = (w.ti || 0) * 1000;
  if (t) for (const l of t.lines) n += Math.min(l.got, l.need);
  return n;
}
function guideDots(w, r) {
  const out = [];
  if (!r || !r.pts || r.pts.length < 2) return out;
  const ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u, sp = Math.max(0.3, Math.max(22, 27 * L.u) / ppu);
  const seg = [];
  let len = 0;
  for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z); if (l > 1e-6) { seg.push({ a, b, l, s: len }); len += l; } }
  const stop = (w.ia ? w.ia[r.i] || 0 : 0) + 0.2;
  let k = seg.length - 1;
  for (let d = len - stop; d > 0 && k >= 0; d -= sp) {
    while (k > 0 && seg[k].s > d) k--;
    const q = seg[k], f = (d - q.s) / q.l, x = q.a.x + (q.b.x - q.a.x) * f, z = q.a.z + (q.b.z - q.a.z) * f;
    let onFood = false;
    for (let i = 0; i < (w.n || 0) && !onFood; i++) {
      if ((w.st && w.st[i] !== 0) || isHid(w, i)) continue;
      const rr2 = (w.ia ? w.ia[i] : 0.3) + 0.06, dx = w.ix[i] - x, dz = w.iz[i] - z;
      if (dx * dx + dz * dz < rr2 * rr2) onFood = true;
    }
    if (!onFood) out.push({ x, z, d });
  }
  return out.slice(-44);   // the stretch by the pot is the one that matters
}
function stuckLine(w, G) {
  const r = G.g;
  if (r.blocked) return WALL_WORD[r.by] ? fmt(STR.goAround, { w: WALL_WORD[r.by] }) : STR.goAroundIt;
  if (r.kind === 'food') return STR.growFirst;
  return (w.t || 0) - G.aT >= 2 ? STR.goAroundIt : null;   // shoving at something off the route; a pot that is on its way needs no words
}
function guideTick(w, dt) {
  const moved = hud.started != null || w.tStart != null;
  if (!w.pot || !moved) return;
  const now = w.t || 0;
  const G = hud.gd || (hud.gd = { prog: orderCount(w), progT: now, bites: hud.bites | 0, biteT: now, r: w.pot.r, hold: 0, last: now, stuck: false, callT: -99, ax: w.pot.x, az: w.pot.z, aT: now, g: null, dots: [], next: 0, a: 0 });
  const prog = orderCount(w), step = Math.min(0.25, Math.max(0, now - G.last));
  G.last = now;
  if (prog !== G.prog) { G.prog = prog; G.progT = now; G.stuck = false; }
  if ((hud.bites | 0) !== G.bites) { G.bites = hud.bites | 0; G.biteT = now; G.hold = 0; G.stuck = false; }
  if (w.pot.r > G.r + 1e-3) { G.r = w.pot.r; G.hold = 0; G.stuck = false; }
  if (Math.hypot(w.pot.x - G.ax, w.pot.z - G.az) > 0.45) { G.ax = w.pot.x; G.az = w.pot.z; G.aT = now; }
  if (IN && IN.held) G.hold += step;
  const live = !w.result && w.mode !== 'feast' && !finOn();
  if (live && G.hold >= STUCK_WAIT) G.stuck = true;
  const early = w.mode === 'level' && hud.n <= 20, lost = failAt === hud.n || (w.level && w.level.mercy > 0);
  const quiet = now - G.progT >= GUIDE_WAIT && !(G.g && G.g.kind === 'food' && now - G.biteT < GUIDE_WAIT);
  const show = live && (G.stuck || ((early || lost) && quiet && hud.hintItem < 0));
  if (show && T >= G.next) {
    G.next = T + GUIDE_EVERY;
    G.g = safe(() => guide(w), null);
    G.dots = guideDots(w, G.g);
    if (globalThis.__qa) globalThis.__uiGuide = { kind: G.g && G.g.kind, i: G.g ? G.g.i : -1, blocked: !!(G.g && G.g.blocked), by: G.g && G.g.by, dots: G.dots.length, stuck: G.stuck };   // QA readout only
  }
  if (G.stuck && G.g && now - G.callT >= STUCK_LINE_EVERY) {
    const line = stuckLine(w, G);
    if (line) { G.callT = now; callout('hint-go', 'hand', line, 2600); }
  }
  G.a += ((show && G.g ? 1 : 0) - G.a) * Math.min(1, dt / 0.25);
  if (G.a < 0.02 || !G.dots.length) return;
  const ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u, pot = worldToScreen(w.pot.x, w.pot.z), pr = ppu * (w.pot.r || 0.3) * 1.12;
  const R = Math.max(3.6, 4.8 * L.u);
  g.save();
  G.dots.forEach((d, i) => {
    const p = worldToScreen(d.x, d.z);
    if (!onPlay(p) || (pot && Math.hypot(p.x - pot.x, p.y - pot.y) < pr + R * 2)) return;
    // a slow swell runs from the pot towards the target, so the line reads as "this way" without moving
    const a = G.a * (0.62 + 0.38 * (0.5 + 0.5 * Math.cos(i * 0.7 + T * 4.5)));
    circle(p.x, p.y, R * 2.2); g.fillStyle = `rgba(255,236,170,${(0.42 * a).toFixed(3)})`; g.fill();
    circle(p.x, p.y, R); g.fillStyle = `rgba(255,196,48,${a.toFixed(3)})`; g.fill();
    g.lineWidth = Math.max(1.2, 1.5 * L.u); g.strokeStyle = `rgba(122,74,16,${(0.75 * a).toFixed(3)})`; g.stroke();
  });
  const r = G.g;
  if (r && w.st && w.st[r.i] === 0 && w.ix) {
    const q = worldToScreen(w.ix[r.i], w.iz[r.i]);
    if (onPlay(q)) {
      const k = (T * 0.9) % 1, rad = ppu * (w.ia ? w.ia[r.i] : 0.3) + Math.max(6, 8 * L.u) + k * Math.max(6, 8 * L.u);
      circle(q.x, q.y, rad); g.lineWidth = Math.max(2, 2.6 * L.u); g.strokeStyle = `rgba(255,224,140,${(G.a * 0.75 * (1 - k)).toFixed(3)})`; g.stroke();
    }
  }
  g.restore();
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
  // DECISION (11-05, first-time lane): the pointer waits until the pot can eat the item. Bouncing on a sandwich the pot
  //   can't swallow sent new players into it for a minute; it now pops in as the reward for growing.
  if (hud.hintItem >= 0 && (!hud.fly || T - hud.fly.t0 > 0.6) && (!w.fits || w.fits[hud.hintItem])) {
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
// A goal food flies from the pot to its chip and the chip pops as it lands, so the eye goes from the bite to the count.
function drawUps(w) {
  if (!hud.ups.length) return;
  const t = w.tickets && w.tickets[w.ti || 0], dur = 0.36;
  const p = worldToScreen(w.pot.x, w.pot.z) || { x: L.play.cx, y: L.play.cy };
  hud.ups = hud.ups.filter(f => {
    const k = (T - f.t0) / dur, c = hud.chipXY[f.li], l = t && t.lines[f.li];
    if (k >= 1 || !c || !l) { hud.chipPop[f.li] = T; return false; }
    const e = k * k * (3 - 2 * k), mx = (p.x + c.x) / 2 + 40 * L.u, my = Math.min(p.y, c.y) + 30 * L.u;
    const x = (1 - e) * (1 - e) * p.x + 2 * (1 - e) * e * mx + e * e * c.x, y = (1 - e) * (1 - e) * p.y + 2 * (1 - e) * e * my + e * e * c.y;
    g.save(); g.translate(x, y); const s = 1.5 - 0.6 * e + 0.25 * Math.sin(k * Math.PI); g.scale(s, s);
    ingIcon(l.kind, 0, 0, c.s * 0.82); g.restore();
    return true;
  });
}
function drawGhost(w) {
  // pulsing ring round the pot on L1: first 5 s or until the first bite
  if (hud.n === 1 && !hud.bites && T - hud.t0 < 5 && T - hud.t0 > 0.2 && w.pot) {
    const p0 = worldToScreen(w.pot.x, w.pot.z) || { x: L.play.cx, y: L.play.cy };
    const ppu0 = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u, R0 = Math.max(22 * L.u, ppu0 * w.pot.r * 1.35);
    const k0 = (T * 1.4) % 1, fade = clamp((5 - (T - hud.t0)) / 0.6, 0, 1);
    g.save();
    for (const [ph, wd] of [[0, 3.5], [0.5, 2.5]]) {
      const kk = (k0 + ph) % 1;
      circle(p0.x, p0.y, R0 * (0.9 + 0.5 * kk)); g.lineWidth = Math.max(2, wd * L.u); g.strokeStyle = `rgba(255,211,110,${((1 - kk) * 0.95 * fade).toFixed(2)})`; g.stroke();
    }
    g.restore();
  }
  if (!hud.ghost) return;
  const p = worldToScreen(w.pot.x, w.pot.z) || { x: L.play.cx, y: L.play.cy };
  const u = L.u, cyc = ((T - hud.t0 - 1.0) % 1.8 + 1.8) % 1.8;
  const ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u, R = Math.max(22 * u, ppu * (w.pot.r || 0.3) * 1.2);
  let dy = 0, sc = 1, a = 1;
  if (cyc < 0.25) { sc = 1 - 0.12 * (cyc / 0.25); a = cyc / 0.25; }
  else if (cyc < 1.25) { sc = 0.88; dy = -ease((cyc - 0.25) / 1.0) * 90 * u; }
  else { sc = 0.88 + 0.12 * ((cyc - 1.25) / 0.55); dy = -90 * u; a = 1 - (cyc - 1.25) / 0.55; }
  const x = clamp(p.x + R + 26 * u, L.play.x + 30 * u, L.play.x + L.play.w - 30 * u), y = p.y + 34 * u + dy;
  const hs = sc * u * 1.1;
  if (cyc >= 0.25 && cyc < 1.25) { g.save(); g.globalAlpha = 0.35 * a; circle(x, y - 32 * hs, 16 * u); g.fillStyle = C.paper; g.fill(); g.restore(); }
  g.save(); g.globalAlpha = clamp(a, 0, 1); g.translate(x, y); g.scale(hs, hs);
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

// render3d / render2d finisher clock (real s from the final bite); neither renderer exports it, so these mirror their FIN_* constants.
// Friday fix 2: the beats come from camw.js now, since a milestone's finisher (FIN_BIG) runs 1.2 s longer than the others.
const finB = () => (hud && hud.big ? FIN_BIG : FIN_BEAT);
const finOn = () => !!(hud && hud.fin != null && !REC_M.record);
/** HUD opacity during the finisher: fades out in 0.2 s, stays off through the punch-in, returns after the beat's back time. */
function finHudA() {
  if (!finOn()) return 1;
  const tf = T - hud.fin;
  const back = finB().back;
  return tf < 0 ? 1 : tf < 0.2 ? 1 - tf / 0.2 : tf < back ? 0 : Math.min(1, (tf - back) / 0.35);
}
let hudOff = null;

// ---- order up (boss bite): stamp lands on the ticket in screen centre ----
// DECISION: in a record run the ticket and its stamp fade out over 17.8-18.0 s of record time (__recState.t), so they are gone
//   when the end card lands at 18.0 s (modes.js REC_END_T; 18.6-19.0 s before viral r6, 21.5-21.9 s before the 11-07 tail cut).
function recOrderFade() {
  const rs = REC_M.record ? recState() : null;
  return rs && typeof rs.t === 'number' ? 1 - clamp((rs.t - 17.8) / 0.2, 0, 1) : 1;
}
function drawOrderUp(w) {
  const fo = recOrderFade(), k = T - hud.orderUp + (REC_M.record ? 0.3 : 0);   // record: the stamp lands 0.3 s sooner
  if (k < 0.55 || k > 9 || fo <= 0.01) return;
  const r = L.hud.ticket;
  if (REC_M.record && r) {   // U14: the stamp lands on the served ticket, up on the rail, clear of the pot
    const e = clamp((k - 0.55) / 0.18, 0, 1), s = Math.min(r.w * 0.8, r.h * 2.3);
    stampMark(r.x + r.w / 2, r.y + r.h * 0.55, s, hud.big ? STR.bossEaten : STR.orderUp, 1.5 - 0.5 * back(e), -0.1, e * fo);
    return;
  }
  const s = Math.min(cssW * 0.6, 260 * L.u);
  const fin = finOn(), x = cssW / 2, y = (fin ? cssH * 0.24 : cssH * 0.4) - (1 - fo) * cssH * 0.06;   // finisher: top third, clear of the pot
  const e = clamp((k - 0.55) / 0.18, 0, 1), sc = 2.2 - 1.2 * back(e);
  // DECISION (Friday fix U6): the stamp never covers the HUD ticket or meter, even while it is scaled up at the start:
  //   its centre is pushed below any HUD rect it overlaps horizontally.
  const label = hud.big ? STR.bossEaten : STR.orderUp;
  const fsz = s * 0.2, rw = Math.min(s, measure(label, fsz) + s * 0.2), rh = s * 0.36;
  const hw = (rw * Math.cos(0.18) + rh * Math.sin(0.18)) * sc / 2, hh = (rh * Math.cos(0.18) + rw * Math.sin(0.18)) * sc / 2;
  let yy = y;
  for (const q of fin ? [L.hud.meter, L.hud.timer] : [L.hud.ticket, L.hud.meter, L.hud.timer]) if (q && x + hw > q.x && x - hw < q.x + q.w) yy = Math.max(yy, q.y + q.h + hh + 6);
  stampMark(x, Math.min(yy, cssH - hh - 4), s, label, sc, -0.18, e * fo);
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
//   The end card (18.0-20.5 s) is teal with the gold wordmark, pot-happy, "Play free →" / "no download" and the
//   ?end text (never a hard-coded URL). DECISION (11-07 Sat, viral r6 "ends on an empty dark frame"): in the last 0.5 s
//   the end card opens in a gold-rimmed circle on the restarted frame-0 pot and the hook caption fades back in on top,
//   so the clip's last frame is its first (it used to close to a teal dot, then cut).
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
  const ir = clamp(rs.iris || (sh.iris || 0), 0, 1);
  let hole = null;
  if (ir > 0.001) {
    let c = null;
    if (w && w.pot) { const p = worldToScreen(w.pot.x, w.pot.z); if (p) c = { x: p.x, y: p.y }; }
    if (!c) c = { x: cssW / 2, y: cssH / 2 };
    hole = { x: c.x, y: c.y, r: Math.hypot(Math.max(c.x, cssW - c.x), Math.max(c.y, cssH - c.y)) * ease(ir) };
  }
  if (!hole) cap(rs.hook, sh.hook);
  cap(rs.cap2, sh.cap2);
  const ea = clamp(sh.end || 0, 0, 1);
  if (ea > 0.01) {
    g.save(); g.globalAlpha = ea;
    if (hole) { g.beginPath(); g.rect(0, 0, cssW, cssH); g.arc(hole.x, hole.y, Math.max(0, hole.r), 0, TAU, true); g.clip('evenodd'); }
    g.fillStyle = '#0F4C5C'; g.fillRect(0, 0, cssW, cssH);
    const vg = g.createRadialGradient(cssW / 2, cssH * 0.45, Math.min(cssW, cssH) * 0.2, cssW / 2, cssH * 0.45, Math.max(cssW, cssH) * 0.75);
    vg.addColorStop(0, 'rgba(255,255,255,0.06)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = vg; g.fillRect(0, 0, cssW, cssH);
    const ls = Math.min(cssW * 0.17, 150 * k * 1.2), bob = Math.sin(T * 2.2) * 6 * k;
    g.save(); g.translate(cssW / 2, cssH * 0.27); g.rotate(-0.04);
    txt(STR.title, 0, 0, ls, { col: C.gold, stroke: C.ink, sk: Math.max(5, ls * 0.14), shadow: C.ink, maxW: cssW * 0.9, min: 24 });
    g.restore();
    const ps = Math.min(cssW * 0.6, cssH * 0.3);
    potArt('pot-happy', cssW / 2, cssH * 0.5 + bob, ps);
    // DECISION (11-07 Sat, viral r6 "Play free is small"): the call to action is the biggest text after the wordmark,
    //   "Play free →" at about 10 % of the width, "no download" under it, then the ?end text in gold (the clip passes
    //   "link in bio · arcadeaday.com", matching the caption). Was one 6 %-wide line.
    const f2 = Math.max(18, Math.min(cssW * 0.1, cssH * 0.056)), y2 = cssH * 0.705;
    txt(STR.playFreeA, cssW / 2, y2, f2, { f: FB, wt: '800', col: C.paper, stroke: C.ink, sk: Math.max(3, f2 * 0.14), maxW: cssW * 0.9 });
    txt(STR.playFreeB, cssW / 2, y2 + f2 * 1.02, f2 * 0.55, { f: FB, wt: '800', col: C.paper, maxW: cssW * 0.9 });
    if (rs.end) txt(String(rs.end), cssW / 2, y2 + f2 * 1.95, f2 * 0.62, { f: FB, wt: '800', col: C.goldL, maxW: cssW * 0.9 });
    g.restore();
    if (hole && hole.r > 0.5) {
      g.save(); g.globalAlpha = ea; g.beginPath(); g.arc(hole.x, hole.y, hole.r, 0, TAU);
      g.lineWidth = Math.max(4, 10 * k); g.strokeStyle = C.gold; g.stroke(); g.restore();
    }
  }
  if (hole) cap(rs.hook, sh.hook);
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
  else if (c.icon === 'chili') chiliMark(ix, cy, icS);
  else if (/^(icon|boss|ing|skin)-/.test(c.icon)) icon(c.icon, ix, cy, icS, (x, y, q) => cloche(x, y, q));
  else if (c.icon) glyph(c.icon, ix, cy, icS);
  txt(c.text, ix + icS / 2 + 6 * u, cy + 1, size, { f: FB, align: 'left', col: C.ink });
  g.restore();
}

/** A small drawn chili for the callout (it has no art of its own: render owns the 3D one). */
function chiliMark(x, y, s) {
  g.save(); g.translate(x, y); g.rotate(-0.5); g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, s * 0.07); g.strokeStyle = C.ink;
  g.beginPath(); g.moveTo(-s * 0.08, -s * 0.3); g.quadraticCurveTo(s * 0.34, -s * 0.2, s * 0.14, s * 0.2); g.quadraticCurveTo(s * 0.02, s * 0.42, -s * 0.16, s * 0.46);
  g.quadraticCurveTo(-s * 0.02, s * 0.18, -s * 0.24, -s * 0.16); g.closePath(); g.fillStyle = '#E8321F'; g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-s * 0.16, -s * 0.28); g.quadraticCurveTo(-s * 0.1, -s * 0.46, s * 0.04, -s * 0.46); g.lineWidth = Math.max(2, s * 0.11); g.strokeStyle = '#3F8F3A'; g.lineCap = 'round'; g.stroke();
  g.restore();
}
// Friday fix 2 (U7): the first chili level names the hazard once per save, and only when a chili is on screen to look at, with a ring on the nearest.
// Friday fix 2 (U7): a live chili only: one already bitten or still hidden is not worth a ring. Flag 512 is logic.js's F_HOT.
function nearestHot(w) {
  if (!w.flags || !w.pot) return null;
  let best = null, bd = 1e9;
  for (let i = 0; i < (w.n || 0); i++) {
    if (!(w.flags[i] & 512) || (w.st && w.st[i] !== 0) || isHid(w, i)) continue;
    const q = worldToScreen(w.ix[i], w.iz[i]); if (!onPlay(q)) continue;
    const dd = Math.hypot(w.ix[i] - w.pot.x, w.iz[i] - w.pot.z);
    if (dd < bd) { bd = dd; best = q; }
  }
  return best;
}
// The warning waits until a chili is really on screen and the opening camera has settled, or the first bite if that comes sooner,
//   so it never talks about something the player cannot see. Any chili level can show it: a save already past hotIntro's level
//   still meets chilis, and the seen flag keeps it to once per save.
function hotTick(w) {
  if (hud.hotCall || !w.level || !w.level.hot || !w.level.hot.length || hud.result) return;
  const bitten = hud.hotPop > hud.t0;
  if (!bitten && (T - hud.t0 < 1.5 || !nearestHot(w))) return;
  hud.hotCall = true;
  if (seenFlag('tip:hot')) return;
  seenFlag('tip:hot', true);
  hud.hotRing = T;
  callout('tut-hot', 'chili', fmt(STR.hotIntro, { n: HOT_SECS }), 4600);
}
function drawHotRing(w) {
  const k = T - hud.hotRing; if (k < 0 || k > 4.8) return;
  const q = nearestHot(w); if (!q) return;
  const ppu = RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u, pu = 0.5 + 0.5 * Math.sin(T * TAU * 1.6), R = Math.max(26, ppu * 0.42) * (1 + 0.14 * pu);
  g.save(); g.globalAlpha = k > 4.4 ? (4.8 - k) / 0.4 : 1;
  g.beginPath(); g.arc(q.x, q.y, R, 0, TAU); g.lineWidth = Math.max(5, 6 * L.u); g.strokeStyle = C.ink; g.stroke();
  g.beginPath(); g.arc(q.x, q.y, R, 0, TAU); g.lineWidth = Math.max(3, 3.6 * L.u); g.strokeStyle = '#FF5A36'; g.stroke();
  g.restore();
}

// Friday fix 2 (U2): boss identity. The banner names the milestone's boss while the clock waits for the first drag (it never holds
//   play: it just fades on the first drag or at 2 s), and sits in whichever band is clear of the pot.
function potBox(w) {
  const q = w.pot ? worldToScreen(w.pot.x, w.pot.z) : null;
  if (!q) return null;
  const pr = (RD && RD.pxPerU ? RD.pxPerU() : 40 * L.u) * (w.pot.r || 0.3);
  return { top: q.y - pr, bot: q.y + pr };
}
// DECISION (11-07 Sat, r4 kid13): while the BOSS ORDER banner is up the callout queue waits (tip pills, booster tooltips), so the top third
//   is not stacked with ticket + banner + pill. The pill keeps its place in the queue and shows once the banner is gone.
function bossBannerOut(w) {
  if (!hud.big) return 1;
  const since = T - hud.t0, moved = hud.started != null || w.tStart != null;
  if (hud.bannerOff == null && (moved || since >= 2)) hud.bannerOff = T;
  // U9: the fade runs on the UI clock, and a slow frame or a stepped sim left it hanging faint over play: once the first bite
  //   has landed or the sim is half a second in, it is gone whatever the clock says.
  if ((hud.bites | 0) > 0 || (w.tStart != null && (w.t || 0) - w.tStart > 0.5)) return 1;
  return hud.bannerOff == null ? 0 : (T - hud.bannerOff) / 0.14;
}
function drawBossBanner(w) {
  if (!hud.big) return;
  const since = T - hud.t0;
  const out = bossBannerOut(w);
  if (out >= 1) return;
  const u = L.u, band = L.hud.callout, P0 = L.play, t = w.tickets && w.tickets[w.tickets.length - 1], kind = bossKind(w, t);
  const rh = Math.max(40, 50 * u), fsz = Math.max(20, 27 * u), rw = Math.min(P0.w - rh * 1.4, Math.max(210, 290 * u));
  const ms = Math.max(52, 70 * u), name = nameFor(kind), nfs = Math.max(15, 19 * u);
  const y0 = Math.max(P0.y + 6, band.y + band.h + 6), yMax = P0.y + P0.h - 8, pot = potBox(w);
  const clear = (y, h) => !pot || y + h < pot.top - 6 || y > pot.bot + 6;
  let full = true, h = rh + ms * 0.92, y = y0;
  if (!clear(y, h)) {
    y = pot ? pot.bot + 8 : y0;
    if (y + h > yMax) { full = false; h = rh; y = y0; if (!clear(y, h)) { y = pot ? pot.bot + 8 : y0; if (y + h > yMax) return; } }
  }
  const a = clamp(since / 0.16, 0, 1) * (1 - clamp(out, 0, 1)), cx = P0.cx ?? P0.x + P0.w / 2, sc = 0.82 + 0.18 * back(clamp(since / 0.22, 0, 1));
  g.save(); g.globalAlpha = a; g.translate(cx, y + h / 2); g.scale(sc, sc); g.translate(-cx, -(y + h / 2));
  if (full) {
    // the boss's card hangs under the ribbon: picture left, name right, drawn first so the ribbon overlaps its top edge
    const tw2 = Math.min(measure(name, nfs, FB, '800'), rw - ms - 24), cw = ms + tw2 + 26, cy = y + rh * 0.72, chh = h - rh * 0.72, x = cx - cw / 2;
    rr(x, cy + 3, cw, chh, Math.max(10, 12 * u)); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    rr(x, cy, cw, chh, Math.max(10, 12 * u)); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(2, 2.4 * u); g.strokeStyle = C.ink; g.stroke();
    const yy = cy + chh / 2 + rh * 0.1;
    icon(iconFor(kind), x + 6 + ms / 2, yy, ms * 0.98, (x2, y2, q) => cloche(x2, y2, q));
    txt(name, x + ms + 14, yy + 1, nfs, { f: FB, align: 'left', col: C.ink, maxW: tw2 });
  }
  ribbon(cx, y + rh / 2, rw, rh, STR.bossOrder, fsz, C.gold, C.brass);
  g.restore();
}
const unlockOn = () => !!hud && T >= hud.unlock && T - hud.unlock < 1.7;
function drawUnlock(w) {
  if (!unlockOn()) return;
  const k = T - hud.unlock, u = L.u, band = L.hud.callout, big = hud.big;
  const rh = big ? Math.max(38, 46 * u) : Math.max(30, 34 * u), fsz = big ? Math.max(19, 25 * u) : Math.max(14, 17 * u);
  const rw = Math.min(band.w - rh * 1.1, big ? Math.max(240, 320 * u) : Math.max(170, 220 * u));
  const cx = band.x + band.w / 2, cy = band.y + band.h / 2, sc = k < 0.2 ? 0.6 + 0.4 * back(k / 0.2) : 1;
  const pot = potBox(w), over = pot && pot.top < cy + rh / 2 && pot.bot > cy - rh / 2;
  g.save(); g.globalAlpha = (k > 1.4 ? (1.7 - k) / 0.3 : 1) * (over ? 0.55 : 1); g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
  if (big) ribbon(cx, cy, rw, rh, STR.bossUnlocked, fsz, C.gold, C.brass); else ribbon(cx, cy, rw, rh, STR.bossUnlocked, fsz);
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
      else if (id === 'daily' && dly) { if (!dly.done || !dly.streak) badge(bx, by, br, dly.done ? '0' : '!', dly.done ? C.go : C.stamp); streakFlame(ic.r, dly.streak | 0, u); }
    }
  }
}
/** U15: the Daily streak as a little flame and its count on the Daily button's top-left corner. Nothing at 0. */
function streakFlame(r, n, u) {
  if (n <= 0) return;
  const s = Math.max(22, 26 * u), x = r.x + r.w * 0.14, y = r.y + r.h * 0.14, fl = 1 + 0.05 * Math.sin(T * 7);
  g.save(); g.translate(x, y + s * 0.1); g.scale(fl, 2 - fl); g.lineJoin = 'round';
  const body = k => { g.beginPath(); g.moveTo(0, -s * 0.56 * k); g.bezierCurveTo(s * 0.1 * k, -s * 0.28 * k, s * 0.42 * k, -s * 0.12 * k, s * 0.4 * k, s * 0.14 * k); g.bezierCurveTo(s * 0.38 * k, s * 0.42 * k, s * 0.14 * k, s * 0.5 * k, 0, s * 0.5 * k);
    g.bezierCurveTo(-s * 0.14 * k, s * 0.5 * k, -s * 0.38 * k, s * 0.42 * k, -s * 0.4 * k, s * 0.14 * k); g.bezierCurveTo(-s * 0.42 * k, -s * 0.06 * k, -s * 0.12 * k, -s * 0.2 * k, 0, -s * 0.56 * k); g.closePath(); };
  body(1); g.fillStyle = '#F2612E'; g.fill(); g.lineWidth = Math.max(1.5, 1.8 * u); g.strokeStyle = C.ink; g.stroke();
  g.restore();
  txt(String(n), x, y + s * 0.2, Math.max(12.5, s * 0.56), { col: '#fff', stroke: C.ink, sk: 3 });
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
  const big = d.bigBoss != null ? !!d.bigBoss : (d.kind || 'level') === 'level' && (d.n | 0) > 0 && isMilestone(d.n | 0);
  const goal = starGoal(d, w);
  // Friday fix 2 (U3): read the next pot live, so a card returned to from the Shop never offers the pot just bought.
  const ns = !d.nextSkin ? null : (safe(() => (M.nextSkin ? M.nextSkin(100) || false : d.nextSkin), d.nextSkin) || null);
  const canBuy = !!ns && typeof ns === 'object' && !(ns.need > 0);
  const strip = winStrip(d), next = canBuy ? null : nextUp(d, ns);
  // DECISION (11-07 Sat, r4, G): on L1-5 the hint row also previews tomorrow's Daily reward (what meta.js says the ladder pays next),
  //   alternating with the chest / gift line every 2.5 s. It is the same row, so the card is not taller and NEXT stays where it is pinned.
  const tmr = !canBuy && (d.kind || 'level') === 'level' && (d.n | 0) >= 1 && (d.n | 0) <= 5 ? tomorrowPill() : null;
  const CL = cardLayout(L, 'win', { nextSkin: !!(next || tmr), buySkin: canBuy, goal: !!goal, strip: strip.length > 0 });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu, fill: big ? '#FFF3CC' : undefined });
  if (big) { rr(CL.panel.x + 2, CL.panel.y + 2, CL.panel.w - 4, CL.panel.h - 4, Math.max(13, 21 * cu)); g.lineWidth = Math.max(4, 5 * cu); g.strokeStyle = C.gold; g.stroke(); }
  // heading: the stamp is there from the first frame (U11: at 5 fps a late stamp read as a card with no heading)
  const hs = Math.min(B.head.w * 0.78, B.head.h * 2.1);
  const sk = clamp(cardT / 0.16, 0, 1);
  stampMark(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2, hs, big ? STR.bossEaten : STR.orderUp, 1.8 - 0.8 * back(sk), -0.08, 1);
  // hero: ticket + happy pot
  if (B.hero.h > 40) {
    const hh = B.hero.h;
    if (big) {
      // Friday fix 2 (U2): the boss on a gold medal takes the clipboard's place: this card is about the boss, not the ingredients
      const tkB = w && w.tickets ? w.tickets[w.tickets.length - 1] : null;
      const ms = Math.min(B.hero.w * 0.46, hh * 0.98), mx = B.hero.x + B.hero.w * 0.27, my = B.hero.y + hh / 2;
      circle(mx, my + 3, ms * 0.5); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
      circle(mx, my, ms * 0.5); g.fillStyle = C.gold; g.fill(); g.lineWidth = Math.max(2.5, 3 * cu); g.strokeStyle = C.ink; g.stroke();
      circle(mx, my, ms * 0.41); g.fillStyle = C.paper; g.fill(); g.lineWidth = Math.max(1.5, 2 * cu); g.stroke();
      icon(iconFor(bossKind(w || {}, tkB)), mx, my, ms * 0.82, (x, y, q) => cloche(x, y, q));
      tick(mx + ms * 0.33, my + ms * 0.33, Math.max(20, ms * 0.3), C.stamp);
    } else {
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
    if (cardT >= 0.2) { const k = clamp((cardT - 0.2) / 0.15, 0, 1); g.globalAlpha = k; tick(P.x + P.w - pad - rt / 2, P.y + hH / 2, rt, C.stamp); }
    g.restore();
    }
    const ps = Math.min(B.hero.w * 0.5, hh * 1.05), bob = Math.sin(T * 3) * ps * 0.02;
    potArt('pot-happy', B.hero.x + B.hero.w * 0.73, B.hero.y + hh / 2 + bob, ps);
  }
  // 11-07 Sat (U13): a big run is a brag even on one star, so it gets the ribbon over the pot, the part of the card a screenshot keeps.
  const brag = (d.chainBest | 0) >= BRAG_CHAIN && B.hero.h >= 70;
  if (brag) {
    const bk = back(clamp((cardT - 0.35) / 0.25, 0, 1)), bh = clamp(B.hero.h * 0.3, 32, 46 * cu), bw = Math.min(B.hero.w * 0.5, Math.max(150, 200 * cu));
    if (bk > 0.02) {
      const bx = B.hero.x + B.hero.w * 0.73, by = B.hero.y + B.hero.h - bh * 0.62;
      g.save(); g.translate(bx, by); g.rotate(-0.05); g.scale(bk, bk);
      ribbon(0, 0, bw, bh, fmt(STR.bestChain, { n: d.chainBest }), Math.max(14, bh * 0.5));
      g.restore();
    }
  }
  // stars fill one by one, the first from the first frame (U11)
  const S = B.stars, n = clamp(d.stars | 0, 0, 3), sr = Math.min(S.h * 0.46, S.w / 8);
  for (let i = 0; i < 3; i++) {
    const t0 = i * 0.12, k = clamp((cardT - t0) / 0.2, 0, 1), on = i < n && cardT >= t0;
    const x = S.x + S.w / 2 + (i - 1) * sr * 2.6, y = S.y + S.h / 2 + (i === 1 ? -sr * 0.18 : sr * 0.1);
    const sc = on ? 1 + 0.35 * Math.sin(k * Math.PI) : 1;
    g.save(); g.translate(x, y); g.scale(sc, sc); drawStar(0, 0, (i === 1 ? sr * 1.12 : sr) * (on ? 1 : 0.84), on); g.restore();   // the star art has a margin, so a hollow slot at full r read bigger than a won star
  }
  // Friday fix 2 (U1, kid13's one change): what the third star wants, in words and a small bar, on every win card short of 3 stars.
  if (B.goal && goal) {
    const r = B.goal, gf = Math.max(12.5, Math.min(fs.stat, r.h * 0.42)), bh = clamp(r.h * 0.24, 9, 18 * cu), bw = Math.min(r.w * 0.84, 300 * cu);
    txtMin([goal.text, goal.short], r.x + r.w / 2, r.y + gf * 0.62, gf, { f: FB, col: C.ink, maxW: r.w });
    const by = r.y + r.h - bh / 2 - 2, bx = r.x + (r.w - bw) / 2, fk = goal.fill * ease((cardT - 0.25) / 0.6);
    rr(bx, by - bh / 2, bw, bh, bh / 2); g.fillStyle = C.paperS; g.fill();
    if (fk > 0.01) { g.save(); rr(bx, by - bh / 2, bw, bh, bh / 2); g.clip(); g.fillStyle = C.gold; g.fillRect(bx, by - bh / 2, bw * fk, bh); g.restore(); }
    rr(bx, by - bh / 2, bw, bh, bh / 2); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    drawStar(bx + bw, by, Math.max(9, bh * 0.9), true);
  }
  // stats: time left · best chain
  const st2 = B.stats, cy = st2.y + st2.h / 2;
  {
    const tl = Math.max(0, Math.round(d.tLeft || 0)), tStr = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
    const cells = [];
    if (d.kind !== 'feast' && d.tLeft != null && (d.n | 0) !== 1) cells.push(['clock', fmt(STR.timeLeft, { t: tStr })]);
    if (d.chainBest && !brag) cells.push(['chain', fmt(STR.bestChain, { n: d.chainBest })]);
    const cw = st2.w / Math.max(1, cells.length);
    cells.forEach(([ic, s], i) => {
      const x0 = st2.x + i * cw, is = fs.stat * 1.2, tws = Math.min(measure(s, fs.stat, FB, '800'), cw - is - 10);
      const sx = x0 + (cw - (is + 6 + tws)) / 2;
      glyph(ic, sx + is / 2, cy, is);
      txt(s, sx + is + 6, cy + 1, fs.stat, { f: FB, align: 'left', col: C.ink, maxW: cw - is - 10 });
    });
  }
  // coins count up
  // U11: the count starts on the first frame and never reads +0 on a card that pays
  const co = B.coins, total = d.coins | 0, ck = clamp(cardT / 0.7, 0, 1), shown = total > 0 ? Math.max(1, Math.round(total * ease(ck))) : 0;
  // a replay that earns nothing shows no "+0" row (and no coin tick)
  if (total > 0) {
    if (ck > 0 && ck < 1 && Math.floor(shown / Math.max(1, total / 12)) !== hud?._coinTick) { if (hud) hud._coinTick = Math.floor(shown / Math.max(1, total / 12)); sfx('coin'); }
    // Friday fix 2 (U3): a replay pays a flat +3 on top of new stars. Named, so it reads as a bonus and not as a stingy win.
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = Math.max(measure(cs, cfs), measure(fmt(STR.coinsPlus, { n: total }), cfs));
    const rb = d.first === false && (d.kind || 'level') === 'level', rf = Math.max(12.5, fs.stat), rlw = rb ? measure(STR.replayBonus, rf, FB, '800') + rf * 0.7 : 0;
    const cr = cfs * 0.55, cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8 + rlw) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
    if (rb) txt(STR.replayBonus, cx0 + cr * 2 + 8 + ctw + rf * 0.7, co.y + co.h / 2 + 1, rf, { f: FB, align: 'left', col: C.ink, maxW: co.x + co.w - (cx0 + cr * 2 + 8 + ctw + rf * 0.7) });
  }
  // 11-07 Sat (U6): rewards as chips. They pop in once the coins have counted, and they are already in the save.
  if (B.strip && strip.length) drawStrip(B.strip, strip, cu);
  // Friday fix 2 (U3): never "0 coins". A pot the player can pay for is a button to the Shop; Back from there comes home to this card.
  if (B.hint && !canBuy && (next || tmr)) {
    const both = !!(next && tmr), ph = cardT % 5, showTmr = !!tmr && (!next || ph >= 2.5), tp = ph % 2.5;
    g.save(); if (both) g.globalAlpha = Math.min(1, tp / 0.25, (2.5 - tp) / 0.25);
    if (showTmr) {
      const is = Math.min(B.hint.h * 1.1, 30 * cu + 6), room = B.hint.w - is - 6;
      const s1 = measure(tmr.txt, fs.small, FB, '800') <= room ? tmr.txt : tmr.short, tw = Math.min(room, measure(s1, fs.small, FB, '800'));
      const x0 = B.hint.x + (B.hint.w - (is + 4 + tw)) / 2, cyh = B.hint.y + B.hint.h / 2;
      rewardIcon(tmr.rw, x0 + is / 2, cyh, is);
      txt(s1, x0 + is + 4, cyh + 1, fs.small, { f: FB, align: 'left', col: C.goldS, maxW: room });
    } else txtMin(next, B.hint.x + B.hint.w / 2, B.hint.y + B.hint.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.hint.w });
    g.restore();
  }
  if (B.hint && canBuy) {
    const skin = (typeof ns === 'object' && (STR['sk_' + ns.id] || ns.name || ns.id)) || '';
    // 11-07 (mobile r5): meta.nextSkin names the priciest pot the bank pays for, or a pot to gild once every pot is owned.
    paperBtn(reg('buySkin', B.hint, () => { shopWin = d; act('screen', { screen: 'shop' }); shopSel = ns.id; }), fmt(ns.gild ? STR.canGild : STR.canBuy, { skin }),
      { u: cu, fs: Math.max(fs.small * 1.1, 15 * cu), f: FB, alts: [ns.gild ? STR.canGildShort : STR.canBuyShort], fill: '#FFE9A8', icon: (x, y, q) => coin(x, y, q * 0.42) });
  }
  // NEXT (auto-highlight after 0.9 s) · Replay · Map
  const last = (d.n | 0) >= LEVELS && (d.kind || 'level') === 'level';
  const nb = reg('next', B.next, () => act('next'), { primary: true });
  const hi = cardT > 1.2 ? 0.5 + 0.5 * Math.sin((cardT - 1.2) * 5) : 0;
  goldBtn(nb, last ? STR.allDoneBtn : STR.next, { u: cu, fs: fs.btn, glow: hi });
  paperBtn(reg('replay', B.replay, () => act('retry')), STR.replay, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('map', B.map, () => act('map')), STR.map, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('map', x, y, s) });
  g.restore();
}

const BRAG_CHAIN = 20;
/** U6: what this win paid beyond its own coins, as chips. Only while game.js skips the reward cards (d.strip). */
function winStrip(d) {
  if (!d.strip) return [];
  const boost = k => (x, y, s) => glyph(ICON_BOOST[k] ? k : 'gift', x, y, s), chest = (x, y, s) => glyph('chest', x, y, s);
  const pay = [], rest = [];
  const add = (k, n) => rest.push({ draw: boost(k), text: '+' + n, long: `${STR[BOOST_NAME[k]] || STR.gift} +${n}` });
  for (const c of d.chests || []) {
    pay.push({ draw: chest, n: c.coins | 0, text: '+' + (c.coins | 0), long: `${c.town ? STR.chestT : STR.chestSmall} +${c.coins | 0}` });
    const each = c.boost ? Math.max(...Object.values(c.boost)) | 0 : 0;
    if (each > 0) rest.push({ draw: boost('gift'), text: `+${each} each`, long: fmt(STR.eachBooster, { n: each }) });
  }
  for (const m of d.milestones || []) {
    pay.push({ draw: (x, y, s) => glyph('gift', x, y, s), n: m.coins | 0, text: '+' + (m.coins | 0), long: `${STR.starBonus} +${m.coins | 0}` });
    if (m.boost) add(m.boost, 1);
  }
  for (const q of d.gifts || []) add(q.k, q.n | 0);
  if (pay.length + rest.length <= 3) return [...pay, ...rest];
  // more than fits at 360 wide: the coins fold into one chip, so nothing that was paid goes unshown
  const sum = pay.reduce((a, c) => a + c.n, 0);
  return [...(sum ? [{ draw: chest, text: '+' + sum, long: '+' + sum }] : []), ...rest].slice(0, 3);
}
const ICON_BOOST = { magnet: 1, freeze: 1, mega: 1 };
function drawStrip(r, items, cu) {
  const n = items.length, h = Math.min(r.h, Math.max(36, 42 * cu)), is = h * 0.78, sf = Math.max(13, Math.min(h * 0.42, 17 * cu));
  let gapX = Math.max(6, 8 * cu), endX = 10;
  const wOf = s => is + 10 + measure(s, sf, FB, '800') + endX, sum = list => list.reduce((a, b) => a + b, 0) + gapX * (n - 1);
  const long = items.every(it => wOf(it.long) <= (r.w - gapX * (n - 1)) / n);
  let ws = items.map(it => wOf(long ? it.long : it.text));
  // the narrow left column of a landscape phone: three chips close up rather than run into the right column
  if (sum(ws) > r.w) { gapX = 4; endX = 6; ws = items.map(it => wOf(it.text)); }
  const tot = sum(ws);
  let x = r.x + (r.w - tot) / 2;
  const y = r.y + (r.h - h) / 2;
  if (cardT >= 0.6) sfx1('stripGift', 'gift');
  items.forEach((it, i) => {
    const k = back(clamp((cardT - 0.6 - i * 0.12) / 0.2, 0, 1)), w2 = ws[i], cx = x + w2 / 2, cy = y + h / 2;
    if (k > 0.02) {
      g.save(); g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy);
      rr(x, y + 2, w2, h, h / 2); g.fillStyle = 'rgba(58,36,24,0.25)'; g.fill();
      rr(x, y, w2, h, h / 2); g.fillStyle = '#FFE9A8'; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
      it.draw(x + 6 + is / 2, cy, is);
      txt(long ? it.long : it.text, x + is + 10, cy + 1, sf, { f: FB, align: 'left', col: C.ink, maxW: w2 - is - 10 - endX });
      g.restore();
    }
    x += w2 + gapX;
  });
}
/** U15: the one thing coming next, as [long, short] lines: a chest or a star gift when close, else the next pot, else whichever is left. */
function nextUp(d, ns) {
  if ((d.kind || 'level') !== 'level') return null;
  const c = safe(() => (M.nextChest ? M.nextChest() : null), null), ms = safe(() => M.nextMilestone(), null);
  const left = ms ? ms.need - ms.have : 0;
  const chest = c ? [c.left === 1 ? STR.chestIn1 : fmt(STR.chestIn, { n: c.left })] : null;
  const gift = left > 0 ? [left === 1 ? STR.giftIn1 : fmt(STR.giftIn, { n: left })] : null;
  let skin = null;
  if (ns) {
    const name = (typeof ns === 'object' && (STR['sk_' + ns.id] || ns.name || ns.id)) || '', need = typeof ns === 'object' ? ns.need ?? ns.coins ?? '' : '', one = need === 1;
    skin = typeof ns === 'string' ? [ns] : [fmt(one ? STR.nextSkin1 : STR.nextSkin, { skin: name, n: need }), fmt(one ? STR.nextSkinShort1 : STR.nextSkinShort, { n: need })];
  }
  if (chest && c.left <= 3) return chest;
  if (gift && left <= 5) return gift;
  return skin || chest || gift;
}
/** What the third star wants, or null on a card it does not apply to: L1 always pays 3, Daily stars come from its star lines, Feast has none. */
function starGoal(d, w) {
  if ((d.stars | 0) >= 3 || (d.kind || 'level') !== 'level' || (d.n | 0) === 1) return null;
  const st = w && LG && LG.starTimes ? safe(() => LG.starTimes(w), null) : null, t3 = st ? st.t3 : 0;
  let need = +d.t3Left || 0;
  if (!(need > 0) && d.t3Left == null && t3 > 0 && d.tLeft != null) need = Math.max(0, Math.ceil(t3 - d.tLeft));
  if (need > 0) return { text: fmt(STR.goal3, { n: need }), short: fmt(STR.goal3Short, { n: need }), fill: t3 > 0 ? clamp(1 - need / t3, 0.04, 0.96) : 0.5 };
  // quick enough on time, but a Freeze from the card holds the stars back: name the target instead
  if (t3 > 0) { const n = Math.ceil(t3); return { text: fmt(STR.goal3Left, { n }), short: fmt(STR.goal3LeftShort, { n }), fill: 0.5 }; }
  return null;
}
/** Friday fix 2 (U9): one short line from the second loss in a row, only what is true on this board right now. */
function failTip(d, w) {
  if (!(d.fails >= 2)) return '';
  const tips = [];
  if (failMissing(d) > 0) tips.push(STR.tipArrows);
  let locked = false;
  if (w && w.st && w.fits) for (let i = 0; i < (w.n || 0); i++) if (w.st[i] === 0 && !w.fits[i] && !isHid(w, i)) { locked = true; break; }
  if (locked) tips.push(STR.tipSmall, STR.tipBig);
  else if ((+d.progress || 0) < 1) tips.push(STR.tipSmall);
  return tips.length ? tips[failCards % tips.length] : '';
}

// DECISION (Friday fix U2/U7): the heading is driven by what is missing from the order, not by pot size. A size bar
//   that looked full next to "0/3" contradicted the order, so it only shows when every ingredient line is done.
function failMissing(d) {
  // logic.missing() lines are {kind, n}; forced qa fails pass {kind, need, got}
  return (d.missing || []).reduce((s, l) => s + (l.n != null ? l.n | 0 : Math.max(0, (l.need | 0) - (l.got | 0))), 0);
}
function failHeading(d, w) {
  if (d.why === 'spoiled') return STR.spoiled;
  const size = +d.progress || 0, miss = failMissing(d);
  let need = 0, got = 0;
  const tks = (w && w.tickets) || [];
  for (const t of tks) for (const l of t.lines) { need += l.need | 0; got += Math.min(l.got | 0, l.need | 0); }
  const frac = need ? got / need : size;
  if (miss === 0) return size >= 0.9 ? STR.soClose : STR.almost;       // order done, pot not big enough for the boss
  if (miss <= 1 && frac >= 0.7) return STR.soClose;
  if (miss <= 2 && frac >= 0.5) return STR.almost;
  return STR.outOfTime;
}
// one-line reason for a Spoiled card, from logic.doomed()'s two causes: a line with too few items left, or no food left to grow
function spoiledReason(d, w) {
  try {
    const tks = (w && w.tickets) || [], cnt = {};
    if (w && w.n) for (let i = 0; i < w.n; i++) { const s = w.st ? w.st[i] : 0; if (s === 0 || s === 1 || s === 3 || s === 5) { const k = itemKind(w, i); cnt[k] = (cnt[k] || 0) + 1; } }
    for (let k = w.ti || 0; k < tks.length; k++) for (const l of tks[k].lines) {
      if (l.got < l.need && (cnt[kindId(l.kind)] || 0) < l.need - l.got) return [fmt(STR.spoilLeft, { name: nameFor(l.kind) }), STR.spoilLeftShort];
    }
  } catch {}
  return [STR.spoilGrow, STR.spoilGrowShort];
}
/** The card's level line. A Daily and a Feast have no number (n = 0), so they say their own name. */
function levelLine(w, n, kind) {
  const mode = kind || (w && w.mode) || 'level';
  if (mode === 'daily') return [STR.dailyOrder];
  if (mode === 'feast') return [STR.feastLabel];
  n = n || (w && w.level && w.level.n) || 0;
  const name = (w && w.level && w.level.name) || '';
  return n ? [fmt(STR.levelLabel, { n, name }), fmt(STR.levelShort, { n })] : [name];
}
function drawFail(st, w) {
  // DECISION: the spoiled sub line falls back to the current ticket's open lines to name the missing ingredient.
  const d = cardData.fail || {};
  const canFreeze = d.why !== 'spoiled' && !!d.canFreeze;
  const noBar = failMissing(d) > 0 || (w && w.tickets && w.tickets.some(t => t.lines.some(l => l.got < l.need)));
  const help = d.mercy > 0, tip = failTip(d, w);
  const CL = cardLayout(L, 'fail', { canFreeze, noBar, help, tip: !!tip });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  // heading (§5.4 rule) stamped in
  // U11: the heading rides in with the panel from the first frame. It used to wait 0.2 s at alpha 0, and a 5 fps capture
  //   caught a whole card with no "Out of time!".
  const head = failHeading(d, w), hk = clamp(cardT / 0.2, 0, 1);
  g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.04); const hsc = 1.3 - 0.3 * back(hk); g.scale(hsc, hsc);
  txt(head, 0, 0, fs.head, { col: head === STR.soClose ? C.stamp : C.ink, stroke: C.paper, sk: 4, maxW: B.head.w * 0.95, min: 18 });
  g.restore();
  // sub line
  if (B.sub) {
    const cy = B.sub.y + B.sub.h / 2;
    if (d.why === 'spoiled') {
      txtMin(spoiledReason(d, w), B.sub.x + B.sub.w / 2, cy, fs.body, { f: FB, col: C.ink, maxW: B.sub.w });
    } else {
      txtMin(levelLine(w, d.n, d.kind), B.sub.x + B.sub.w / 2, cy, fs.body, { f: FB, col: C.ink, maxW: B.sub.w });
    }
  }
  if (B.hero.h > 40) potArt('pot-sad', B.hero.x + B.hero.w / 2, B.hero.y + B.hero.h / 2, Math.min(B.hero.w * 0.6, B.hero.h * 1.05));
  // size bar: start rim -> boss silhouette, flag at progress (size only)
  if (B.bar) {
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
    const n = lines.length || 1, cnt = Math.max(12.5, fs.count);
    // DECISION: with 4 lines the ring shrinks so every "got/need" count fits its cell (it was clipped at the card edge).
    const d0 = Math.max(26, Math.min(r.h * 0.9, Math.max(34, 44 * cu), (r.w / n - cnt * 3.4 - 22) / 1.04));
    const cellW = Math.min(r.w / n, d0 * 1.04 + cnt * 3.4 + 22);
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
  // Friday fix 2 (U9): the tip, for a player who has lost here more than once
  if (B.tip && tip) {
    const r = B.tip, tf = Math.max(12.5, Math.min(fs.small * 1.15, r.h * 0.46));
    rr(r.x, r.y, r.w, r.h, Math.min(r.h / 2, 12 * cu)); g.fillStyle = C.paperS; g.fill();
    txt2(tip, r.x + r.w / 2, r.y + r.h / 2 + 1, tf, { f: FB, col: C.ink, maxW: r.w - Math.max(12, 16 * cu) });
  }
  // Friday fix 2 (U8): the kind words for RETRY +18 s, right above the button they explain.
  // 11-07 Sat (U2): the number on the button is the whole extra for this try, not one more step on top of the last, so the line says so.
  if (B.help) {
    const r = B.help, hf = Math.max(12.5, Math.min(fs.body, r.h * 0.74)), o = { n: d.mercy, p: d.growPct || 0 };
    txtMin(d.growPct > 0 ? [fmt(STR.mercyBoth, o), fmt(STR.mercyBothShort, o)] : [fmt(STR.mercyLine, o)], r.x + r.w / 2, r.y + r.h / 2 + 1, hf, { f: FB, col: C.ink, maxW: r.w });
  }
  if (B.freeze) {
    const own = ((M && M.get && M.get().boost) || {}).freeze | 0, cost = own > 0 ? 0 : d.freezeCost ?? PRICES.freeze;
    const fb = reg('freeze', B.freeze, () => act('freeze'));
    // price tag (coin + cost), or how many are left, rides right after the label, so the whole row stays centred. Never blank.
    const pfs = Math.max(13, 15 * cu), cr = Math.max(7, 8.5 * cu), ownS = fmt(STR.freezeLeft, { n: own });
    const tail = cost
      ? { w: cr * 2 + 4 + measure(String(cost), pfs), draw: (x, cy) => { coin(x + cr, cy, cr); txt(String(cost), x + cr * 2 + 4, cy + 1, pfs, { align: 'left', col: C.ink }); } }
      : { w: measure(ownS, pfs, FB, '800'), draw: (x, cy) => txt(ownS, x, cy + 1, pfs, { f: FB, align: 'left', col: C.ink }) };
    paperBtn(fb, STR.freeze, { u: cu, fs: fs.btn2, f: FB, alts: [STR.freezeShort], tail, icon: (x, y, s) => glyph('freeze', x, y, s * 1.15) });
  }
  const rb = reg('retry', B.retry, () => act('retry'), { primary: true });
  goldBtn(rb, d.mercy > 0 ? fmt(STR.retryMore, { n: d.mercy }) : STR.retry, { u: cu, fs: Math.max(fs.btn, 26 * cu), glow: cardT > 0.6 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('map', B.map, () => act('map')), STR.map, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('map', x, y, s) });
  g.restore();
}

/** Seconds on the clock for 2 and 3 stars, on a campaign level only (L1 always pays 3; Daily stars come from its star lines). */
function pauseStars(w) {
  const n = w && w.level && w.level.n;
  if (!(n > 1) || (w.mode && w.mode !== 'level') || w.timed === false || !LG || !LG.starTimes) return null;
  const st = safe(() => LG.starTimes(w), null);
  if (!st || !(st.t3 > 0)) return null;
  const add = w.freezeAdded || 0;     // the clock carries a Freeze's seconds, the star times do not
  return { t3: Math.ceil(st.t3 + add), t2: Math.ceil(st.t2 + add) };
}
function drawPause(st, w) {
  const goal = pauseStars(w);
  const CL = cardLayout(L, 'pause', { showMute: !!P.showMute, stars: !!goal });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  txt(STR.paused, B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  txtMin(levelLine(w, st.level | 0, st.mode), B.level.x + B.level.w / 2, B.level.y + B.level.h / 2, fs.body, { f: FB, col: C.goldS, maxW: B.level.w });
  if (B.stars && goal) {
    // Friday fix 2 (U1): the three targets, as the clock reads them; the row you are on pace for is lit
    const r = B.stars, cw = r.w / 3, sf = Math.max(12.5, fs.small), sr = Math.max(8, Math.min(r.h * 0.2, 12 * cu));
    const pace = w.tLeft >= goal.t3 ? 2 : w.tLeft >= goal.t2 ? 1 : 0;
    [STR.starFinish, fmt(STR.starLeft, { n: goal.t2 }), fmt(STR.starLeft, { n: goal.t3 })].forEach((s, i) => {
      const cx = r.x + cw * (i + 0.5), py = r.y + sr + r.h * 0.08;
      if (i === pace) { rr(r.x + cw * i + 3, r.y, cw - 6, r.h, Math.max(8, 10 * cu)); g.fillStyle = '#FFE9A8'; g.fill(); g.lineWidth = 2; g.strokeStyle = C.brass; g.stroke(); }
      for (let k = 0; k <= i; k++) drawStar(cx + (k - i / 2) * sr * 2.1, py, sr, true);
      txt(s, cx, r.y + r.h - sf * 0.8, sf, { f: FB, col: C.ink, maxW: cw - 10 });
    });
  }
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
    txt(label, r.x + Math.max(6, 8 * cu), r.y + r.h / 2 + 1, fs.row || fs.body, { f: FB, align: 'left', col: C.ink, maxW: tb.x - r.x - 16 });
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
  const r = b, h = r.h * 0.86, y = r.y + (r.h - h) / 2;
  rr(r.x, y, r.w, h, h / 2); g.fillStyle = on ? C.go : C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
  const kx = on ? r.x + r.w - h / 2 : r.x + h / 2;
  circle(kx, y + h / 2, h * 0.4); g.fillStyle = '#fff'; g.fill(); g.stroke();
  txt(on ? STR.on : STR.off, on ? r.x + (r.w - h) / 2 : r.x + h + (r.w - h) / 2, y + h / 2 + 0.5, Math.max(12.5, h * 0.42), { f: FB, col: on ? '#fff' : C.ink, maxW: r.w - h - 4, min: 12.5 });
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
// DECISION (11-07 Sat, r4 grandparent, kid13): a return hook before the Daily opens. One line with the reward icon says what the
//   Daily ladder pays next, from meta's own dailyStatus().tomorrow (no new reward). Once the Daily is open it reads "Tomorrow: ...";
//   before that it says which ladder day it is ("Daily day 2: ...") so it never promises a claim the player cannot make yet.
function tomorrowPill() {
  const ds = dailyStat(); if (!ds || !ds.tomorrow || !ds.tomorrow.reward) return null;
  const rw = ds.tomorrow.reward, r = rewardShort(rw), open = curLv() > DAILY_UNLOCK;
  return open ? { rw, txt: fmt(STR.tmrLine, { r }), short: fmt(STR.tmrLineShort, { r }) }
    : { rw, txt: fmt(STR.tmrLocked, { d: ds.tomorrow.day, r }), short: fmt(STR.tmrLockedShort, { d: ds.tomorrow.day, r }) };
}
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
  else coin(x, y, s * 0.34);
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
// DECISION (11-05, first-time lane): the art past the column is a soft blurred copy. Sharp mirrored art read as a second
//   fountain and a seam; blurred it reads as background. Downscale then upscale in steps (ctx.filter is missing on Safari);
//   built once per town.
const wingCache = {};
function wingArt(name, im) {
  if (wingCache[name]) return wingCache[name];
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const step = (src, k) => {
    const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(iw / k)); c.height = Math.max(2, Math.round(ih / k));
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  return (wingCache[name] = step(step(step(step(im, 8), 32), 16), 6));
}
const MAP_OV = 0.24, fadeCache = {};
/** The town art with its lower MAP_OV faded to nothing, cached once per town (and once for the blurred wing art). */
function fadedArt(key, art) {
  if (fadeCache[key]) return fadeCache[key];
  const w = art.naturalWidth || art.width, h = art.naturalHeight || art.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(art, 0, 0, w, h);
  const gr = x.createLinearGradient(0, h * (1 - MAP_OV), 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  // destination-in clears everything the fill does not cover, so it has to fill the whole canvas: above the gradient's start it clamps to opaque
  x.globalCompositeOperation = 'destination-in'; x.fillStyle = gr; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
  return (fadeCache[key] = c);
}
function drawMap(st, dt) {
  // DECISION: the town map is a full-screen scroller, not a card. Each town is one band of the content (ribbon at
  //   the bottom where you enter, 20 nodes, the town chest at the top); its kie map art is tiled down the band at
  //   column width (each tile fading into the one below, see fadedArt) so the art is never
//   stretched. It opens with the current node at 60 %
  //   of the view height. Locked towns get an ink wash, the town's signature boss as a silhouette and "Opens at L21".
  // DECISION: the current node carries the worn pot skin (pot-hero for Sunny) with its number as a badge; level
  //   nodes register only while fully inside the view, so a node under the bars can never be tapped.
  const sv = (M && M.get && M.get()) || {};
  const cur = Math.max(1, curLv() | 0), here = Math.min(cur, LEVELS), allDone = cur > LEVELS;
  const starsOf = n => safe(() => M.stars(n) | 0, Array.isArray(sv.stars) ? sv.stars[n - 1] | 0 : 0);
  const CL = cardLayout(L, 'map', {});
  const B = CL.blocks, fs = CL.fs, mp = CL.map, u = L.u, col = mp.col;
  // DECISION (11-07 Sat, r4 curator): the "Win 1 more for a chest" pill rode on top of the scrolling map and touched whichever node
  //   passed under it. It now has its own band at the top of the view: the band is painted in the table's wood and the map scrolls
  //   (and taps register) below it, so the pill can never touch a node. The band costs the map one pill height.
  const up = allDone ? null : nextUp({}, null), tmrP = allDone ? null : tomorrowPill();
  // DECISION (11-07 Sat, viral r6 "map pills very small on a phone"): the pill text is 15u with a 14 px floor (was 13.5u, 12.5 floor),
  //   about 15 % bigger; the narrow-phone fallback below (short tomorrow text, then the order pill alone) keeps the row inside the band.
  const pts = Math.max(14, 15 * u), pth = Math.max(22, pts * 1.65), bandH = up || tmrP ? pth + 10 : 0;
  const V = { ...B.view, y: B.view.y + bandH, h: B.view.h - bandH };
  MAP.view = V;
  // DECISION (11-07 Sat, r4 curator): on a desktop-shaped viewport the first town sits at the very bottom of the content, so the old
  //   "node at 60 %" clamp opened on L1-6 with the next node low in the corner. The view may now scroll a little past the bottom
  //   (onto the table's wood) so the next node can open centred; phones keep the 60 % framing.
  const wide = L.aspect === 'landscape', want = wide ? 0.5 : 0.6, cn0 = mp.nodes[here - 1];
  const extra = wide && cn0 ? Math.max(0, cn0.y - V.h * want - Math.max(0, mp.contentH - V.h)) : 0;
  MAP.max = Math.max(0, mp.contentH - V.h) + extra;
  const key = `${Math.round(V.w)}x${Math.round(V.h)}:${here}`;
  if (MAP.init !== key) {
    const cn = mp.nodes[here - 1];
    MAP.s = clamp(cn.y - V.h * want, 0, MAP.max); MAP.v = 0; MAP.glide = null; MAP.drag = null; MAP.init = key;
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
        const px = col.x + c * col.w, art = c ? wingArt(TOWNS[tw.i], im) : im;
        g.save(); g.beginPath(); g.rect(px, vy0, col.w, vy1 - vy0); g.clip();
        if (c % 2) { g.translate(px * 2 + col.w, 0); g.scale(-1, 1); }
        // Friday fix 2 (U5): tiles overlap by MAP_OV and each one above fades into the one below, flipped left to right every other
        //   tile. The old top-to-bottom mirror met edge to edge and left a chevron seam across the board at every tile.
        const faded = fadedArt(TOWNS[tw.i] + (c ? ':w' : ''), art);
        for (let k = 0, ty = y1 - th; ty + th > y0; k++, ty -= th * (1 - MAP_OV)) {
          if (ty > vy1 || ty + th < vy0) continue;
          const a2 = k ? faded : art;
          if (k % 2) { g.save(); g.translate(px * 2 + col.w, 0); g.scale(-1, 1); g.drawImage(a2, px, ty, col.w, th); g.restore(); }
          else g.drawImage(a2, px, ty, col.w, th);
        }
        g.restore();
      }
    } else { g.fillStyle = ['#8CCB72', '#EDBB86', '#8FCADB'][tw.i]; g.fillRect(V.x, vy0, V.w, vy1 - vy0); }
  }
  if (col.w < V.w - 2) {   // wings dim + column edges (landscape / desktop)
    g.fillStyle = 'rgba(58,36,24,0.3)'; g.fillRect(V.x, V.y, col.x - V.x, V.h); g.fillRect(col.x + col.w, V.y, V.x + V.w - col.x - col.w, V.h);
    const sw = Math.min(70, col.x - V.x);   // the column lies on the blurred art: a soft shadow, no hard line
    for (const [x0, x1] of [[col.x, col.x - sw], [col.x + col.w, col.x + col.w + sw]]) {
      const sh = g.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(58,36,24,0.5)'); sh.addColorStop(1, 'rgba(58,36,24,0)');
      g.fillStyle = sh; g.fillRect(Math.min(x0, x1), V.y, sw, V.h);
    }
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
  const wear = sv.wear || 'sunny', gildedWorn = !!(sv.gilded && sv.gilded.includes(wear));
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
    if (locked) {
      // DECISION (U10): a locked node keeps its level number (small lock above, number below) so the path still counts.
      g.save(); g.globalAlpha = 0.6; padlock(x, y + dn - R * 0.38, R * 0.6); g.restore();
      g.save(); g.globalAlpha = 0.9; txt(String(n), x, y + dn + R * 0.4, Math.max(14, fs.node * 0.85), { col: C.ink, maxW: R * 1.5 }); g.restore();
    }
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
    if (gildedWorn) gildMark(x, y - R * 0.45 + bob + dn, ps);
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
    // U15: what the next win is working towards, hung under the star bar
    if (bandH) {
      // the band: table wood over the top of the view (a soft edge below it), then the pill(s) centred in it
      const bx = B.view.x, by0 = B.view.y, bw = B.view.w;
      g.fillStyle = '#B97A45'; g.fillRect(bx, by0, bw, bandH);
      const eg = g.createLinearGradient(0, by0 + bandH, 0, by0 + bandH + Math.max(8, 10 * u)); eg.addColorStop(0, 'rgba(58,36,24,0.35)'); eg.addColorStop(1, 'rgba(58,36,24,0)');
      g.fillStyle = eg; g.fillRect(bx, by0 + bandH, bw, Math.max(8, 10 * u));
      const pills = [];
      if (up) pills.push({ txt: up[0], rw: null });
      if (tmrP) pills.push(tmrP);
      const gap = Math.max(6, 8 * u), ty = by0 + 5;
      const wOf = p => Math.min(measure(p.txt, pts, FB, '800') + pth * (p.rw ? 1.45 : 0.9), bw - 12);
      let ws = pills.map(wOf), tot = ws.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
      // two pills do not fit side by side on a narrow phone: the order pill wins, the tomorrow pill keeps its short text
      if (tot > bw - 12 && pills.length > 1) { pills[1] = { ...pills[1], txt: pills[1].short }; ws = pills.map(wOf); tot = ws.reduce((a, b) => a + b, 0) + gap * (pills.length - 1); }
      if (tot > bw - 12 && pills.length > 1) { pills.length = 1; ws = [ws[0]]; tot = ws[0]; }
      let px = bx + bw / 2 - tot / 2;
      pills.forEach((p, i) => {
        const tw2 = ws[i];
        rr(px, ty + 2, tw2, pth, pth / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
        rr(px, ty, tw2, pth, pth / 2); g.fillStyle = p.rw ? '#FFF3D6' : '#FFE9A8'; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
        if (p.rw) { rewardIcon(p.rw, px + pth * 0.62, ty + pth / 2, pth * 0.85); txt(p.txt, px + pth * 1.18 + (tw2 - pth * 1.45) / 2, ty + pth / 2 + 0.5, pts, { f: FB, col: C.ink, maxW: tw2 - pth * 1.45 }); }
        else txt(p.txt, px + tw2 / 2, ty + pth / 2 + 0.5, pts, { f: FB, col: C.ink, maxW: tw2 - pth * 0.7 });
        px += tw2 + gap;
      });
    }
  }
  pill(B.coins, 'coin', String(safe(() => M.coins(), sv.coins | 0)), fs.pill);
  // Daily / Feast / Cookbook / Shop
  const dly = dailyStat();
  for (const ic of B.icons) {
    const id = ic.id;
    const locked = (id === 'daily' && cur <= DAILY_UNLOCK) || (id === 'feast' && cur <= FEAST_UNLOCK);
    const b = reg(id, ic.r, () => act('screen', { screen: id }));
    roundBtn(b, id, { dim: locked });
    // U15: a Daily already served says when the next one opens
    const back = id === 'daily' && dly && dly.done ? msShort((dly.msToNext || 0) - (T - dsCache.t) * 1000) : null;
    const lab = back ? [fmt(STR.backIn, { t: back }), back] : id === 'cookbook' ? [STR.cookbook, STR.cookbookShort] : [STR[id] || id];
    txtMin(lab, ic.lab.x + ic.lab.w / 2, ic.lab.y + ic.lab.h / 2, fs.label, { f: FB, col: C.ink, maxW: ic.lab.w, stroke: 'rgba(255,246,227,0.95)', sk: 4 });
    const bx = ic.r.x + ic.r.w * 0.86, by = ic.r.y + ic.r.h * 0.14, br = Math.max(10, 11 * u);
    if (locked) badge(bx, by, br, fmt(STR.levelShort, { n: id === 'daily' ? DAILY_UNLOCK : FEAST_UNLOCK }), C.ink);
    else if (id === 'daily' && dly) { if (!dly.done || !dly.streak) badge(bx, by, br, dly.done ? '0' : '!', dly.done ? C.go : C.stamp); streakFlame(ic.r, dly.streak | 0, u); }
  }
}
function msShort(ms) { const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; }

// ---- shop ----
let shopSel = null;
const tinPop = {};
/** Friday fix 2 (U3): a Shop opened from the win card goes back to it, settled. game.js back() skips 'win', which would lose its gift and chest cards. */
function shopBack() {
  const d = shopWin;
  if (!d) { act('back'); return; }
  shopWin = null; act('screen', { ...d, name: 'win', screen: 'win' }); cardT = 2;
}
/** Gild: a gold rim band, studs and a slow glint over a pot art drawn at (x, y, s), so a gilded pot reads gold in the Shop and on the map. */
function gildMark(x, y, s) {
  g.save();
  g.beginPath(); g.ellipse(x, y + s * 0.1, s * 0.4, s * 0.2, 0, 0, TAU);
  g.lineWidth = Math.max(2, s * 0.06); g.strokeStyle = '#E8A81E'; g.stroke();
  g.lineWidth = Math.max(1, s * 0.02); g.strokeStyle = '#FFE88A'; g.stroke();
  const a = T * 1.4 % TAU;
  g.fillStyle = '#FFF6C8'; g.beginPath(); g.arc(x + Math.cos(a) * s * 0.4, y + s * 0.1 + Math.sin(a) * s * 0.2, Math.max(1.5, s * 0.035), 0, TAU); g.fill();
  g.restore();
}
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
    if (sel.gilded) gildMark(cx, cy + bob, s);
    if (sel.worn) tick(cx + s * 0.38, cy - s * 0.34, Math.max(20, s * 0.2));
  }
  if (B.name) txt(skinName(sel.id), B.name.x + B.name.w / 2, B.name.y + B.name.h / 2, fs.body * 1.2, { col: C.ink, maxW: B.name.w });
  // Wear / Buy (an owned pot shares the row with Gild)
  const armed = !!(armBuy && armBuy.id === sel.id && !armBuy.poor && T - armBuy.t < 3);
  const poorK = armBuy && armBuy.poor && armBuy.id === sel.id ? T - armBuy.t : 9;
  // DECISION (11-07 Sat, r4, Gild): an owned pot splits the Wear row in two, Wear / Wearing on the left and Gild on the right
  //   (GILD_PRICE coins, once per pot, two taps like a skin: arm, then buy). The layout keeps its single Buy row, so nothing moves.
  // 11-07 (curator r5): in the two-column landscape shop the split row stays inside the left column (CL.colL), off the shelf.
  const split = !!sel.owned, gp = Math.max(6, 8 * cu), rw = split ? Math.min(CL.panel.w * 0.94, B.buy.w * 1.75, CL.colL ? CL.colL.w : 1e9) : B.buy.w;
  const rowX = B.buy.x + (B.buy.w - rw) / 2, halfW = (rw - gp) / 2;
  const bR = split ? { ...B.buy, x: rowX, w: halfW } : B.buy;
  if (sel.worn) {
    paperBtn(reg('buy', bR, () => {}, { disabled: true }), STR.wearing, { u: cu, fs: fs.btn2, fill: C.paperS, icon: (x, y, s) => tick(x, y, s * 0.8) });
  } else if (sel.owned) {
    goldBtn(reg('buy', bR, () => act('wear', { id: sel.id }), { primary: true }), STR.wear, { u: cu, fs: fs.btn });
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
  if (split) {
    const gR = { ...B.buy, x: rowX + halfW + gp, w: halfW }, gid = 'gild:' + sel.id;
    const gArmed = !!(armBuy && armBuy.id === gid && !armBuy.poor && T - armBuy.t < 3);
    const gPoorK = armBuy && armBuy.poor && armBuy.id === gid ? T - armBuy.t : 9;
    if (sel.gilded) {
      paperBtn(reg('gild', gR, () => {}, { disabled: true }), STR.gilded, { u: cu, fs: fs.btn2, fill: C.paperS, icon: (x, y, s) => tick(x, y, s * 0.8) });
    } else {
      const b = reg('gild', gR, () => {
        if (coins < GILD_PRICE) { sfx('nope'); armBuy = { id: gid, t: T, poor: true }; return; }
        if (gArmed) { armBuy = null; sfx('buy'); act('gild', { id: sel.id }); }
        else armBuy = { id: gid, t: T };
      });
      const shake = gPoorK < 0.4 ? Math.sin(gPoorK * 60) * 4 : 0;
      g.save(); g.translate(shake, 0);
      if (gPoorK < 2) paperBtn(b, fmt(STR.needCoins, { n: GILD_PRICE }), { u: cu, fs: fs.btn2, fill: '#FFD9D4' });
      else goldBtn(b, gArmed ? STR.tapToBuy : `${STR.gild} ${GILD_PRICE}`, { u: cu, fs: fs.btn, glow: gArmed ? 0.5 + 0.5 * Math.sin(T * 8) : 0, icon: gArmed ? null : (x, y, s) => coin(x, y, s * 0.34) });
      g.restore();
    }
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
    if (sk.gilded) gildMark(r.x + r.w / 2, r.y + dn + r.h * 0.5, r.w * 0.84);
    g.restore();
    if (sk.worn) tick(r.x + r.w * 0.82, r.y + r.h * 0.18 + dn, Math.max(14, r.w * 0.3));
    else if (!sk.owned) {
      const ph = Math.max(15, r.h * 0.3), py = r.y + r.h - ph - 2 + dn;
      if (sk.price > 0) {
        const pf = Math.max(12.5, Math.min(ph * 0.66, 14 * cu)), cr = ph * 0.3, tw2 = measure(String(sk.price), pf), pw = Math.min(r.w - 4, cr * 2 + 3 + tw2 + 6);
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
    if (open && full) txt(STR.full, pr.x + pr.w / 2, pc, Math.max(12.5, Math.min(pr.h * 0.62, 15 * cu)), { f: FB, col: C.goldS, maxW: pr.w });
    else {
      const pf = Math.max(12.5, Math.min(pr.h * 0.62, 15 * cu)), cr = pf * 0.42, tw2 = measure(String(price), pf);
      const x0 = pr.x + (pr.w - (cr * 2 + 4 + tw2)) / 2;
      coin(x0 + cr, pc, cr);
      txt(String(price), x0 + cr * 2 + 4, pc + 0.5, pf, { align: 'left', col: open && coins < price ? C.stamp : C.ink, maxW: pr.w - cr * 2 - 4 });
    }
  });
  paperBtn(reg('back', B.back, shopBack), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
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
    // DECISION (U11): every tab uses the same size; a label that would need shrinking falls back to its short word instead.
    const fit = lab.find(t => measure(t, fs.body, FB, '800') <= r.w - 10) || lab[lab.length - 1];
    txtMin([fit], r.x + r.w / 2, r.y + dn + r.h / 2 + 1, fs.body, { f: FB, col: C.ink, maxW: r.w - 10 });
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
      if (!far) txt(String(cd.n), r.x + Math.max(5, r.w * 0.08), r.y + dn + Math.max(9, r.h * 0.13), Math.max(12.5, 13 * cu), { align: 'left', col: C.goldS });
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
    if (i < 6 && st0[i + 1].y === r.y) { const nx = st0[i + 1].x; g.beginPath(); g.moveTo(cx + Rr, cy); g.lineTo(nx, cy); g.lineWidth = Math.max(2, 3 * cu); g.strokeStyle = e.state === 'done' ? C.stamp : 'rgba(58,36,24,0.28)'; g.stroke(); }
    const today = e.state === 'today';
    if (today) { circle(cx, cy, Rr * (1.18 + 0.06 * Math.sin(T * 5))); g.fillStyle = 'rgba(255,211,77,0.5)'; g.fill(); }
    circle(cx, cy, Rr); g.fillStyle = e.state === 'done' ? C.paper : today ? C.goldL : C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const lift = i === bobIdx ? (0.5 + 0.5 * Math.sin(T * 3.4)) * Math.max(4, 7 * cu) + 2 : 0;
    g.save(); if (e.state === 'future') g.globalAlpha = 0.6;
    rewardIcon(e.reward, cx, cy - lift, Rr * 1.72);
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
  //   countdown pill (not a button) and Back is the primary. The once-only intro (data.intro) is NEXT / Cook (11-07).
  const d = cardData.daily || {}, ds = dailyStat();
  if (!ds || !ds.unlocked) { drawInfo(st, 'daily'); return; }
  const intro = !!d.intro, done = !!ds.done && !intro;
  const CL = cardLayout(L, 'daily', { town: curLv() <= 40 });
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
  // DECISION (11-07 Sat, grandparent r5): the once-only intro rides the L6+ win chain, so its gold button is NEXT (the
  //   campaign goes on) and Cook is the paper button under it; a first-timer who taps the big button is never pulled into
  //   a 60 s Daily. The map and title keep the Daily's "!" badge, and the plain Daily card (from the map) still leads with Cook.
  if (intro) goldBtn(reg('primary', B.primary, () => act('later'), { primary: true }), STR.next, { u: cu, fs: fs.btn, glow: 0.5 + 0.5 * Math.sin(T * 4) });
  else if (!done) goldBtn(reg('primary', B.primary, () => act('daily'), { primary: true }), STR.cookToday, { u: cu, fs: fs.btn, glow: 0.5 + 0.5 * Math.sin(T * 4) });
  else {
    const r = B.primary, left = (ds.msToNext || 0) - (T - dsCache.t) * 1000;
    rr(r.x, r.y, r.w, r.h - 4, (r.h - 4) / 2); g.fillStyle = C.paperS; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const s = fmt(STR.nextOrder, { t: hms(left) }), is = Math.min(r.h * 0.5, fs.btn2 * 1.4);
    const tw = Math.min(measure(s, fs.btn2, FB, '800'), r.w - is - 30), x0 = r.x + (r.w - is - 8 - tw) / 2;
    glyph('clock', x0 + is / 2, r.y + (r.h - 4) / 2, is);
    txt(s, x0 + is + 8, r.y + (r.h - 4) / 2 + 1, fs.btn2, { f: FB, align: 'left', col: C.ink, maxW: r.w - is - 30 });
  }
  if (B.back) paperBtn(reg('back', B.back, () => act(intro ? 'daily' : 'back'), { primary: done }), intro ? STR.cookToday : STR.back, { u: cu, fs: fs.btn2, icon: intro ? (x, y, s) => glyph('daily', x, y, s) : (x, y, s) => glyph('back', x, y, s) });
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
  const day = d.day || ds.day || 1, hk = clamp((cardT - 0.1) / 0.16, 0, 1);
  const head = d.paid ? fmt(STR.dayN, { n: day }) + '!' : STR.nice;
  g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.04); const hsc = 1.5 - 0.5 * back(hk); g.scale(hsc, hsc); g.globalAlpha = clamp(hk * 1.5, 0, 1);
  txt(head, 0, 0, fs.head, { col: C.gold, stroke: C.ink, sk: Math.max(4, fs.head * 0.14), shadow: C.ink, maxW: B.head.w * 0.9, min: 18 });
  g.restore();
  if (B.sub) txt(d.replay ? STR.comeBack : STR.dayServed, B.sub.x + B.sub.w / 2, B.sub.y + B.sub.h / 2, fs.small, { f: FB, col: C.goldS, maxW: B.sub.w });
  const key = d.key || ds.key, lines = dailyLines(key, curLv()), mask = d.mask != null ? d.mask : ds.mask;
  drawReceipt(B, fs, cu, lines, mask, `${STR.daily} · ${String(key || '').slice(5).replace('-', '/')}`, clamp((cardT - 0.1) / 0.16, 0, 1));
  ladderTitle(B.ladderT, fs, ds);
  const landIdx = d.paid ? (day - 1) % 7 : -1, landK = clamp((cardT - 0.15) / 0.16, -1, 1);   // Friday fix: step stamps within 0.2 s
  if (d.paid && cardT >= 0.15) sfx1('streak', 'streak', { day });
  const bob = ds.tomorrow ? ds.tomorrow.day - 1 : -1;
  drawSteps(B, fs, cu, ds.ladder, cardT > 1.2 ? bob : -1, landIdx, landIdx >= 0 && cardT < 0.15 ? -1 : landK);
  // coins (+ the day's reward)
  const co = B.coins, total = d.total | 0 || d.coins | 0;
  if (co && total > 0) {
    const ck = clamp((cardT - 0.3) / 0.8, 0, 1), shown = Math.round(total * ease(ck));   // coins 0.3 s to 1.1 s
    const tickN = Math.floor(shown / Math.max(1, total / 10));
    if (ck > 0 && ck < 1 && tickN !== ladTick) { ladTick = tickN; sfx('coin'); }
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = measure(cs, cfs), cr = cfs * 0.55;
    const rw = d.reward && (d.reward.skin || d.reward.chest || d.reward.lid || d.reward.boost) ? cfs * 1.6 : 0;
    const cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8 + rw) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
    if (rw) rewardIcon(d.reward, cx0 + cr * 2 + 8 + ctw + rw * 0.6, co.y + co.h / 2, cfs * 1.5);
  }
  goldBtn(reg('primary', B.primary, () => act('nice'), { primary: true }), STR.nice, { u: cu, fs: fs.btn, glow: cardT > 1.2 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0 });
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
  const hk = clamp((cardT - 0.1) / 0.16, 0, 1);
  if (d.pb) { if (cardT >= 0.65) stampMark(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2, Math.min(B.head.w * 0.8, B.head.h * 2.1), STR.newBest, 1.8 - 0.8 * back(clamp((cardT - 0.65) / 0.16, 0, 1)), -0.08, clamp((cardT - 0.65) / 0.16, 0, 1) * 1.2); }
  else {
    g.save(); g.translate(B.head.x + B.head.w / 2, B.head.y + B.head.h / 2); g.rotate(-0.03); const sc = 1.4 - 0.4 * back(hk); g.scale(sc, sc); g.globalAlpha = clamp(hk * 1.5, 0, 1);
    txt(STR.feastOver, 0, 0, fs.head, { col: C.ink, stroke: C.paper, sk: 4, maxW: B.head.w * 0.95, min: 18 }); g.restore();
  }
  if (B.hero.h > 30) {
    const hero = img('win-feast');
    g.save(); g.globalAlpha = 0.9; if (hero) drawFit(g, hero, B.hero.x, B.hero.y, B.hero.w, B.hero.h); g.restore();
    const n = d.tickets | 0, k = clamp((cardT - 0.15) / 0.5, 0, 1), shown = Math.round(n * ease(k));
    const big = Math.min(B.hero.h * 0.3, 72 * cu), cx = B.hero.x + B.hero.w / 2, cy = B.hero.y + B.hero.h * 0.7; // low, so the pot keeps its face
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
    const ck = clamp((cardT - 0.3) / 0.8, 0, 1), shown = Math.round(total * ease(ck)), tn = Math.floor(shown / Math.max(1, total / 12));
    if (ck > 0 && ck < 1 && tn !== feTick) { feTick = tn; sfx('coin'); }
    const cs = fmt(STR.coinsPlus, { n: shown }), cfs = fs.big, ctw = measure(cs, cfs), cr = cfs * 0.55, cx0 = co.x + co.w / 2 - (ctw + cr * 2 + 8) / 2;
    coin(cx0 + cr, co.y + co.h / 2, cr);
    txt(cs, cx0 + cr * 2 + 8, co.y + co.h / 2 + 1, cfs, { align: 'left', col: C.ink, stroke: C.paper, sk: 3 });
  }
  goldBtn(reg('primary', B.primary, () => act('again'), { primary: true }), STR.again, { u: cu, fs: Math.max(fs.btn, 26 * cu), glow: cardT > 1.2 ? 0.5 + 0.5 * Math.sin(cardT * 5) : 0, icon: (x, y, s) => glyph('restart', x, y, s) });
  paperBtn(reg('back', B.back, () => act('title')), STR.titleBtn, { u: cu, fs: Math.max(fs.btn2, 20 * cu), icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}
function resetScreenState() { shopSel = bookTab = feastSel = null; dsCache.t = -9; ladTick = feTick = -1; }

const BOOST_NAME = { magnet: 'magnet', freeze: 'freezeB', mega: 'mega' };
function giftBody(d) {
  // DECISION: Core's gift data is { kind, count } (unlock gift), { kind, count, coins, milestone } or { chest, coins };
  //   the card names the booster and coins, then says what to do with it (first-time lane, 11-05: "spice tins" meant
  //   nothing on a round button).
  const parts = [];
  if (BOOST_NAME[d.kind]) parts.push(STR[BOOST_NAME[d.kind]] + ' ×' + (d.count || 1));
  if (d.coins) parts.push(fmt(STR.giftCoins, { n: d.coins }));
  if (d.chest && d.chest.boost) parts.push(fmt(STR.eachBooster, { n: 2 }));
  const boosts = BOOST_NAME[d.kind] || (d.chest && d.chest.boost);
  const use = { magnet: STR.giftMagnet, freeze: STR.giftFreeze, mega: STR.giftMega }[d.kind] || STR.giftBody;
  return parts.join(' · ') + (parts.length ? '. ' : '') + (boosts ? use : '');
}
// DECISION (U9): a locked card says how many more wins open it ("Win 3 more levels to unlock"), not just the level number.
function lockedLine(unlockAt) {
  const sv = (M && M.get && M.get()) || {}, n = Math.max(1, unlockAt - (sv.cur || 1) + 1);
  return n === 1 ? STR.winMore1 : fmt(STR.winMoreN, { n });
}
const INFO = {
  shop: { icon: 'shop', title: () => STR.shop, body: () => STR.shopBody },
  cookbook: { icon: 'cookbook', title: () => STR.cookbook, body: () => STR.cookbookBody },
  daily: { icon: 'daily', title: () => STR.daily, body: d => d.locked ? lockedLine(DAILY_UNLOCK) : d.done ? STR.dailyDone : STR.dailyBody, primary: d => (!d.locked && !d.done ? [STR.cookToday, 'startDaily'] : null) },
  feast: { icon: 'feast', title: () => STR.feast, body: d => d.locked ? lockedLine(FEAST_UNLOCK) : STR.feastBody, primary: d => (!d.locked ? [STR.startFeast, 'startFeast'] : null) },
  // DECISION: All-done: the primary is today's Daily while it is open and not done, else the Feast; the second button
  //   is the Feast (or the Cookbook when the Feast is already the primary).
  alldone: { icon: 'star', title: () => STR.allDone, body: () => STR.allDoneBody,
    primary: () => (dailyOpenNow() ? [STR.cookToday, 'daily'] : [STR.feast, 'feast']),
    second: () => (dailyOpenNow() ? [STR.feast, 'feast'] : [STR.cookbook, 'cookbook']) },
  gift: { icon: d => (d.chest ? 'chest' : d.milestone ? 'star' : BOOST_NAME[d.kind] ? d.kind : 'gift'), title: d => (d.chest ? (d.town ? STR.chestT : STR.chestSmall) : d.milestone ? STR.starBonus : STR.gift),
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
// DECISION (U9): the locked Daily card previews the 7-day reward ladder (dimmed) so there is something to want.
function ladderPreview(r, cu) {
  let lad = null; try { const s = M && M.dailyStatus && M.dailyStatus(); if (s && s.ladder && s.ladder.length === 7) lad = s.ladder; } catch {}
  if (!lad) return false;
  // day 7 (the pot) is drawn 1.3x with a gold ring so the top prize stands out; day numbers sit at the 12.5 px floor
  const gap = Math.max(4, 6 * cu), k7 = 1.3, rw = (r.w - 6 * gap) / (12 + 2 * k7), rr_ = Math.max(10, Math.min(rw, (r.h - 18) / 2 / k7, 34 * cu + 6));
  const totW = rr_ * (12 + 2 * k7) + 6 * gap, cy = r.y + r.h / 2 - 7;
  let cx = r.x + (r.w - totW) / 2;
  lad.forEach((e, i) => {
    const Rr = i === 6 ? rr_ * k7 : rr_; cx += Rr;
    if (i === 6) { circle(cx, cy, Rr * 1.12); g.fillStyle = 'rgba(255,211,77,0.55)'; g.fill(); }
    circle(cx, cy, Rr); g.fillStyle = i === 6 ? C.goldL : C.paperS; g.fill(); g.lineWidth = i === 6 ? 3 : 2; g.strokeStyle = C.ink; g.stroke();
    g.save(); g.globalAlpha = i === 6 ? 1 : 0.85; rewardIcon(e.reward, cx, cy, Rr * 1.45); g.restore();
    txt(String(e.day), cx, cy + Rr + 11, Math.max(12.5, 13 * cu), { f: FB, col: i === 6 ? C.ink : C.goldS, maxW: Rr * 2 + gap });
    cx += Rr + gap;
  });
  return true;
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
  const CL = cardLayout(L, 'info', { primary: !!pr, second: !!sc, noBack: name === 'gift', ending: name === 'alldone', locked: d.locked && (name === 'daily' || name === 'feast') ? name : false });
  const B = CL.blocks, fs = CL.fs, cu = CL.cu;
  const oy = cardIn();
  const lockedCard = d.locked && (name === 'daily' || name === 'feast');
  // DECISION (11-07 Sat, r4, E): a locked Daily or Feast dims what is behind it, so the card reads as a door, not a menu.
  if (lockedCard) dimBg(0.7);
  g.save(); g.translate(0, oy);
  panel(CL.panel, { u: cu });
  const hero = (name === 'feast' || name === 'alldone') && img('win-feast');
  // U8: the finale is a payoff: the same warm rays as a chest behind the feast, and the title stamp lands on it
  if (name === 'alldone') {
    const pr0 = CL.panel;
    sfx1('alldone', 'milestone');
    g.save(); rr(pr0.x + 3, pr0.y + 3, pr0.w - 6, pr0.h - 6, 18 * cu); g.clip();
    giftRays(B.icon.x + B.icon.w / 2, B.icon.y + B.icon.h / 2, Math.max(B.icon.h, B.icon.w * 0.6), clamp(cardT / 0.45, 0, 1));
    g.restore();
  }
  if (hero && B.icon.h > 30) { const bob = Math.sin(T * 2.4) * B.icon.h * 0.015; drawFit(g, hero, B.icon.x, B.icon.y + bob, B.icon.w, B.icon.h); }
  else if (B.icon.h > 30 && name === 'gift') {
    // DECISION: a reward card (gift, town chest, star milestone) pops its prize in over slowly turning warm rays, so
    //   the payoff reads as a payoff, not a notice.
    const s = Math.min(B.icon.h * 0.92, B.icon.w * 0.6, 170 * cu), cx = B.icon.x + B.icon.w / 2, cy = B.icon.y + B.icon.h / 2;
    const k = clamp(cardT / 0.45, 0, 1), sc = 0.4 + 0.6 * back(k), bob = Math.sin(T * 2.4) * s * 0.03;
    const pr0 = CL.panel;   // the panel hugs its rows now, so the rays are held inside it
    g.save(); rr(pr0.x + 3, pr0.y + 3, pr0.w - 6, pr0.h - 6, 18 * cu); g.clip();
    giftRays(cx, cy, Math.min(B.icon.h * 0.62, s * 0.95) * (0.6 + 0.4 * k), k);
    g.restore();
    g.save(); g.translate(cx, cy + bob); g.scale(sc, sc); glyph(spec.icon(d), 0, 0, s * 1.3); g.restore();   // the art has a transparent margin
  }
  else if (name === 'daily' && d.locked && B.icon.h > 30 && ladderPreview(B.icon, cu)) { /* reward ladder preview drawn */ }
  else if (B.icon.h > 30) { const s = Math.min(B.icon.h, B.icon.w * 0.5, 140 * cu); const bob = Math.sin(T * 2.4) * s * 0.03; glyph(typeof spec.icon === 'function' ? spec.icon(d) : spec.icon, B.icon.x + B.icon.w / 2, B.icon.y + B.icon.h / 2 + bob, s); }
  if (lockedCard && B.icon.h > 30) {
    // lock badge with a progress pip (wins so far out of the wins that open it), as a tab on the panel's top-right edge
    const need = name === 'daily' ? DAILY_UNLOCK : FEAST_UNLOCK, have = clamp(cur - 1, 0, need), ph = Math.max(26, 28 * cu), pf = Math.max(12.5, 14 * cu);
    const pw = ph + measure(`${have}/${need}`, pf) + 14, px = CL.panel.x + CL.panel.w - pw - 12 * cu, py = CL.panel.y - ph * 0.5;   // straddles the panel's top edge, clear of the ladder
    rr(px, py + 3, pw, ph, ph / 2); g.fillStyle = 'rgba(58,36,24,0.3)'; g.fill();
    rr(px, py, pw, ph, ph / 2); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    padlock(px + ph * 0.56, py + ph / 2, ph * 0.9);
    txt(`${have}/${need}`, px + ph + (pw - ph - 6) / 2, py + ph / 2 + 1, pf, { col: C.ink, maxW: pw - ph - 8 });
  }
  if (B.sub) txtMin([STR.dailyWhat, STR.dailyWhatShort], B.sub.x + B.sub.w / 2, B.sub.y + B.sub.h / 2, fs.body, { f: FB, col: C.goldS, maxW: B.sub.w });
  txt2(d.locked && name === 'daily' ? STR.dailyOrder : spec.title(d), B.title.x + B.title.w / 2, B.title.y + B.title.h / 2, fs.title, { col: C.ink, maxW: B.title.w });
  txt2(spec.body(d), B.body.x + B.body.w / 2, B.body.y + B.body.h / 2, fs.body, { f: FB, col: C.ink, maxW: B.body.w });
  if (name === 'alldone') {
    if (B.left) txt2(dailyOpenNow() ? STR.allDoneLeft : STR.allDoneLeft2, B.left.x + B.left.w / 2, B.left.y + B.left.h / 2, fs.body, { f: FB, col: C.goldS, maxW: B.left.w });
    const e = clamp((cardT - 0.5) / 0.18, 0, 1), s = Math.min(B.icon.w * 0.62, 230 * cu, B.icon.h * 2.4);
    // the stamp's foot stays on the hero's foot, so on a short landscape card it never lands on the headline
    if (e > 0) { sfx1('alldoneStamp', 'gift'); stampMark(B.icon.x + B.icon.w / 2, B.icon.y + B.icon.h - s * 0.22, s, STR.allDoneStamp, 1.7 - 0.7 * back(e), -0.1, e); }
  }
  if (pr && B.primary) goldBtn(reg('primary', B.primary, () => act(pr[1], pr[2] || {}), { primary: true }), pr[0], { u: cu, fs: fs.btn });
  if (sc && B.second) paperBtn(reg('second', B.second, () => act(sc[1], sc[2] || {})), sc[0], { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph(sc[1], x, y, s) });
  if (B.back) paperBtn(reg('back', B.back, () => act('back'), { primary: !pr }), STR.back, { u: cu, fs: fs.btn2, icon: (x, y, s) => glyph('back', x, y, s) });
  g.restore();
}

const api = { initUI, draw, pointer, key, show, callout, rects, primaryButton, STR, setInput, setAction, debug, layoutNow, wheel };
export default api;
