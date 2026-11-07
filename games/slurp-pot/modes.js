// Slurp Pot modes (Meta/QA, GDD §11.4 qa contract, §12 record/og/cover, §13.3 modes.js).
//
//   parseModes(search) -> { qa, record, og, cover, level, tier, hook, cap2, end }
//   install(api)       -> installs, depending on the query:
//        ?qa=1       the __qa* hooks of §11.4 (+ __qaAdvance, __qaScreen for tools/slurp-pot/qa-run.mjs)
//        ?record=1   window.__rec = { step(n), frame(q), audio(dur) } and __recReady (record.mjs)
//        ?og=1       runs 1,020 REC steps (17.0 s, cake tip) at boot, renders once, sets __ogReady
//        ?cover=...  same hero run as og, sets __coverReady (backplates for covers.mjs)
//
// Nothing here may throw into game.js: every hook is wrapped, errors go to api.P.error. No storage access of any
// kind (the save is meta.js through P). Plain ES module, no DOM at import time, so Node can import parseModes.
//
// Everything that the UI needs from record mode is published on api.rec and window.__recState:
//   { t, frames, over, hook, cap2, end, still, ready }   t = video seconds (frames / 60), over = t >= REC_OVER_T.
//   show: { hook, cap2, end, iris }  caption / end-card alphas 0..1 for this frame (recShow(t)); iris = loop wipe 0..1.
//   step (pot SIZE UP step now), beats [{ t, step }] (the planned big beats), looped (true after the restart at REC_OVER_T).
//
// DECISION: flags are on only for the exact value "1" (the platform layer's qa test is /[?&]qa=1\b/, record.mjs and
//   og.mjs also send 1), so ?qa=true is not qa. ?level=n is honoured only together with ?qa=1 (GDD §11.4).
// DECISION: hook / cap2 / end are trimmed, stripped of control characters and cut to 120 characters. An empty
//   value falls back to the GDD default; end has no default and no URL is ever hard-coded here (Playables text scan).
// DECISION: if a module asks for something the API does not offer yet (api.startRecord, api.advance, bots.screenDir),
//   modes.js falls back (recHook path / L1 + greedy, api.tick, a naive chaser) and reports it in window.__spFallbacks,
//   so qa-run can print which pieces are still missing instead of silently passing.
// DECISION (Wednesday): the REC showcase lives here. recPlan(base) lays the REC food ladder along a serpentine route
//   timed to the §12.2 beat sheet, and the director bot follows it on schedule. Core's api.startRecord({ level,
//   decide }) runs them; logic.js decides every bite and growth, so the video is real play on a scripted course.
import * as Lg from './logic.js';
import { KINDS } from './catalog.js';
import { kindMax as KIND_MAX } from './levels-data.js';
import { G, K_ING, SIZEUP_MUL } from './consts.js';

export const HOOK_DEFAULT = 'Can a pea-sized pot eat the WHOLE park?';
export const CAP2_DEFAULT = '…even the giant cake?';
export const LEVELS = 60;
const DT = 1 / 60;
// DECISION (11-07 Sat, viral r4): the cake is gone by 17.6 s and the old beat sheet then sat on an idle pot until 23.5 s, seven seconds of dead air in a clip
//   that has to hold a thumb. ORDER UP now gets 1.4 s, the end card comes in at 19.0 s and the loop closes at 20.5 s (was 25.0 s). Everything before 17.6 s stands.
// DECISION (11-07 Sat, viral r6 "3 s of static ORDER UP, CTA only 1.4 s"): the end card comes in at 18.0 s (ORDER UP keeps
//   about 0.8 s after the cake drops), so the call to action holds 2.0 s solid plus the 0.5 s loop iris, which now opens
//   on the restarted frame-0 scene instead of closing to a teal dot (ui.js drawRecord): the last frame matches the first.
const REC_OVER_T = 20.0;      // mode 'over' and the loop restart, after the end card has shown 2.0 s (GDD §12.1)
export const REC_END_T = 18.0, REC_LOOP_T = 20.5;
// DECISION (11-04, og at the tip): GDD §12.3 says 1,092 steps (18.2 s), but on today's REC course that frame is past
//   the gulp (win heart showing). Measured in record.mjs snaps: final boss bite 16.63 s, cake whole on the rim 16.8 s,
//   half sunk 17.2 s, a sliver + ORDER UP 17.6 s, heart 18.0 s. 1,020 steps (17.0 s) = the cake tipping into the pot.
export const OG_STEPS = 1020; // 17.0 s of REC
const STILL_GUARD_MS = 25000; // og/cover: stop stepping after this much wall time (SwiftShader safety), see __ogSteps
const TIERS = ['low', 'mid', 'high'];
const COVERS = ['wide', 'tall', 'square'];
const BOT_POLL_KINDS = ['greedy', 'planner', 'casual', 'average', 'expert', 'director'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isFn = f => typeof f === 'function';
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// ------------------------------------------------------------------ parseModes
/**
 * Pure: query string -> modes. { qa, record, og: boolean; cover: ''|'wide'|'tall'|'square'; level: 0|1..60 (qa only);
 * tier: ''|'low'|'mid'|'high'; hook, cap2: string (GDD defaults); end: string ('' when absent) }.
 */
export function parseModes(search) {
  let q;
  try {
    const s = typeof search === 'string' ? search : (typeof location !== 'undefined' ? location.search : '');
    q = new URLSearchParams(s);
  } catch { q = new URLSearchParams(''); }
  const flag = k => q.get(k) === '1';
  const text = (k, d) => {
    const v = q.get(k);
    if (v == null) return d;
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return s || d;
  };
  const qa = flag('qa');
  const cover = (q.get('cover') || '').toLowerCase();
  const tier = (q.get('tier') || '').toLowerCase();
  let level = 0;
  if (qa) {
    const n = parseInt(q.get('level'), 10);
    if (n >= 1 && n <= LEVELS) level = n;
  }
  return {
    qa, record: flag('record'), og: flag('og'),
    cover: COVERS.includes(cover) ? cover : '',
    level,
    tier: TIERS.includes(tier) ? tier : '',
    hook: text('hook', HOOK_DEFAULT),
    cap2: text('cap2', CAP2_DEFAULT),
    end: text('end', ''),
  };
}

// ------------------------------------------------------------------ small helpers
function report(api, e, where) {
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    if (where) err.message = `[modes ${where}] ${err.message}`;
    if (api && api.P && isFn(api.P.error)) api.P.error(err); else console.error(err);
  } catch {}
}
/** Runs fn and swallows (but reports) anything it throws. */
function safe(api, where, fn, dflt) {
  try { return fn(); } catch (e) { report(api, e, where); return dflt; }
}
const fallbacks = new Set();
function fallback(name) {
  fallbacks.add(name);
  try { window.__spFallbacks = [...fallbacks]; } catch {}
}

async function fontsReady() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load('64px "Lilita One"'), document.fonts.load('800 40px Nunito')]).then(() => document.fonts.ready),
        sleep(1500),
      ]);
    }
  } catch {}
}

function b64Of(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Silent 22.05 kHz mono 16-bit WAV, base64 (the fallback when audio.js cannot render offline). */
export function silentWav(dur) {
  const rate = 22050, n = Math.max(1, Math.round(num(dur, 1) * rate)), bytes = 44 + n * 2;
  const u = new Uint8Array(bytes), v = new DataView(u.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) u[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, bytes - 8, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
  return b64Of(u);
}

function uiRect() {
  try {
    const el = document.getElementById('ui') || document.getElementById('stage');
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height, x: r.left, y: r.top };
  } catch {}
  return { w: innerWidth || 390, h: innerHeight || 844, x: 0, y: 0 };
}
/** The stick radius input.js uses (GDD §2.1): clamp(0.10 x min(W, H), 34, 64). */
function stickRad(api) {
  let W = 0, H = 0;
  try {
    const L = api.L;
    if (L) { W = L.cssW || L.W || L.w || 0; H = L.cssH || L.H || L.h || 0; }
  } catch {}
  if (!(W > 0 && H > 0)) { const r = uiRect(); W = r.w; H = r.h; }
  return clamp(0.10 * Math.min(W, H), 34, 64);
}
function playCentre(api) {
  try {
    const p = api.L && api.L.play;
    if (p && isFinite(p.cx) && isFinite(p.cy)) return { cx: p.cx, cy: p.cy };
  } catch {}
  const r = uiRect();
  return { cx: r.w / 2, cy: r.h / 2 };
}
function itemKindId(w, i) { // string kind id of item i from the expanded level (best effort)
  try { const it = w.level && w.level.items && w.level.items[i]; return it ? it.kind : undefined; } catch { return undefined; }
}
function aliveItems(w) {
  let n = 0;
  if (!w || !w.st) return 0;
  const m = w.n | 0;
  for (let i = 0; i < m; i++) { const s = w.st[i]; if (s !== 2 && s !== 4) n++; }
  return n;
}
function currentTicket(w) {
  try { return w && w.tickets ? w.tickets[w.ti | 0] || null : null; } catch { return null; }
}
function missingOf(w) {
  const tk = currentTicket(w), out = [];
  if (tk && tk.lines) for (const l of tk.lines) if ((l.got | 0) < (l.need | 0)) out.push({ kind: l.kind, need: l.need | 0, got: l.got | 0 });
  return out;
}

// ------------------------------------------------------------------ naive chaser (only used while bots.js has no screenDir)
/**
 * DECISION: until bots.js exposes screenDir(bot), __qaInput chases with this tiny policy so qa-run can already play the
 * real game: boss when bossState is 'open', else the nearest fitting item the ticket still needs, else the nearest fitting
 * item (growth). It reads only the world and render.worldToScreen. Reported in window.__spFallbacks as 'chaser'.
 */
function chaserDir(api, w) {
  const R = api.render;
  if (!w || !w.pot || !R || !isFn(R.worldToScreen) || !w.ix) return null;
  const tk = currentTicket(w);
  const boss = tk && tk.boss != null ? tk.boss | 0 : -1;
  let open = false;
  if (boss >= 0) { try { open = api.logic.bossState(w, boss) === 'open'; } catch {} }
  const want = new Set();
  if (tk && tk.lines) for (const l of tk.lines) if ((l.got | 0) < (l.need | 0)) want.add(l.kind);
  const px = w.pot.x, pz = w.pot.z;
  let tI = -1, tD = 1e18, aI = -1, aD = 1e18;
  const n = w.n | 0;
  for (let i = 0; i < n; i++) {
    const s = w.st[i];
    if (s !== 0 && s !== 3) continue;
    const d = (w.ix[i] - px) ** 2 + (w.iz[i] - pz) ** 2;
    if (i === boss) { if (open) { tI = i; tD = -1; } continue; }
    if (!w.fits[i] || tD < 0) continue;
    if (want.has(w.kind[i]) || want.has(itemKindId(w, i))) { if (d < tD) { tD = d; tI = i; } } else if (d < aD) { aD = d; aI = i; }
  }
  const pick = tI >= 0 ? tI : aI;
  if (pick < 0) return null;
  const a = R.worldToScreen(px, pz), b = R.worldToScreen(w.ix[pick], w.iz[pick]);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
  return l > 1e-6 ? { dx: dx / l, dy: dy / l } : null;
}
function botDirection(api, w) {
  const hasBots = api.bots && isFn(api.bots.screenDir);
  let d = null;
  try { d = api.botDir(); } catch {}
  if (!d && !hasBots) { fallback('chaser'); d = chaserDir(api, w); }
  if (!d) return null;
  const dx = num(d.dx), dy = num(d.dy), l = Math.hypot(dx, dy);
  return l > 1e-6 ? { dx: dx / l, dy: dy / l } : null;
}

// ------------------------------------------------------------------ ?qa=1
/**
 * __qa(): { t, mode, level, progress, bar, score, fps, drawCalls, tier, dpr, items, r, needR, bossState, tLeft, result,
 * stars, coins, chain, screen, paused, state } (GDD §11.4) plus kind (level|daily|feast) and streak (= chain, record.mjs).
 * DECISION: mode and screen are both the screen name; t is the sim time w.t, which only advances inside steps, so it is
 * frozen while paused. progress is meta.get().cur - 1 (levels beaten). Every field degrades to 0 / '' / null if a module
 * is missing, so the hook works from the first day of the build.
 */
function qaState(api) {
  let st = {};
  try { st = api.state() || {}; } catch {}
  let w = null;
  try { w = api.world(); } catch {}
  const meta = api.meta, logic = api.logic;
  let stats = {};
  try { stats = (api.render && isFn(api.render.stats) && api.render.stats()) || {}; } catch {}
  const o = {
    t: num(w && w.t), mode: st.screen || '', level: st.level | 0, progress: 0, bar: 0, score: 0,
    fps: num(stats.fps), drawCalls: num(stats.drawCalls), tier: stats.tier || '', dpr: num(stats.dpr),
    items: aliveItems(w), r: num(w && w.pot && w.pot.r), needR: 0, bossState: '', tLeft: num(w && w.tLeft),
    result: (w && w.result) || null, stars: num(w && w.stars), coins: 0, chain: num(w && w.chain && w.chain.n),
    chainBest: num(w && w.chain && w.chain.best),
    screen: st.screen || '', paused: !!st.paused, state: st, kind: st.mode || 'level',
  };
  o.streak = o.chain;
  safe(api, 'qa.meta', () => {
    const d = meta.get();
    o.progress = Math.max(0, (d.cur | 0) - 1);
    o.score = meta.score() | 0;
    o.coins = meta.coins() | 0;
  });
  if (w && logic) {
    safe(api, 'qa.bar', () => { o.bar = num(logic.progress(w)); });
    const tk = currentTicket(w);
    if (tk && tk.boss != null && tk.boss >= 0) {
      safe(api, 'qa.needR', () => { o.needR = num(logic.needR(w.ia[tk.boss])); });
      safe(api, 'qa.bossState', () => { o.bossState = String(logic.bossState(w, tk.boss | 0)); });
    }
  }
  return o;
}

/**
 * DECISION: every action carries x/y, 'up' included (at the last pointer position): the Playables checker clamps
 * a.x/a.y and synthesizes touch pointer events at elementFromPoint(x, y) in Firefox/WebKit, so a bare up is NaN there.
 */
/** How far __qaInput leans on the stick: 0.8 (greedy, the old fixed push), or the steering bot's own speed under __qaSteer. */
let qaSteerKind = 'greedy';
function steerPush(api) {
  if (qaSteerKind === 'greedy' || !isFn(api.botPush)) return 0.8;
  return clamp(num(api.botPush(), 0.55), 0, 1);
}

let qaPendingMove = null; // the last 'move' __qaInput handed out; __qaAdvance applies it before stepping (input.qaMove)
function makeQaInput(api) {
  let down = false; // is the (virtual) pointer we asked the checker to press still down?
  let lx = 0, ly = 0; // last pointer position we sent
  const at = (type, x, y) => { lx = x; ly = y; qaPendingMove = type === 'move' ? { x, y } : null; return { type, x, y }; };
  const up = () => ({ type: 'up', x: lx, y: ly });
  return function qaInput() {
    let st;
    try { st = api.state(); } catch { return []; }
    let w = null;
    try { w = api.world(); } catch {}
    if (st.screen === 'play' && !st.paused) {
      if (!w || w.result) { // level over (the card follows after a short delay): lift
        if (down) { down = false; return [up()]; }
        return [];
      }
      const c = playCentre(api);
      if (!down) { down = true; return [at('down', c.cx, c.cy)]; }
      // DECISION: if the game dropped the pointer (pause/resume, level reset, a lost touch), press again.
      if (api.input && api.input.held === false) return [up(), at('down', c.cx, c.cy)];
      const d = botDirection(api, w), rad = stickRad(api), push = steerPush(api);
      if (d) return [at('move', c.cx + d.dx * push * rad, c.cy + d.dy * push * rad)];
      return [at('move', c.cx, c.cy)]; // null = hold still
    }
    if (down) { down = false; return [up()]; } // a card/pause is up: release before tapping
    let b = null;
    try { b = api.ui && isFn(api.ui.primaryButton) ? api.ui.primaryButton() : null; } catch {}
    return b && isFinite(b.x) && isFinite(b.y) ? [at('tap', b.x, b.y)] : [];
  };
}

function installQa(api, M) {
  const W = window;
  W.__qa = () => safe(api, '__qa', () => qaState(api), { t: 0, mode: '', progress: 0 });
  W.__qaInput = makeQaInput(api);
  W.__qaOldSave = () => (api.meta && isFn(api.meta.qaOldSave) ? api.meta.qaOldSave() : { save: '{"v":0,"best":120,"lv":3}', progress: 2 });
  /** DECISION: n out of 1..60 returns false (never throws); 'daily' / 'feast' start the Picnic Feast. */
  W.__qaLevel = n => safe(api, '__qaLevel', () => {
    if (n === 'daily') return !!api.startDaily();
    if (n === 'feast') return !!api.startFeast('picnic');
    n = n | 0;
    return n >= 1 && n <= LEVELS ? !!api.startLevel(n) : false;
  }, false);
  W.__qaBot = (on, kind = 'greedy') => safe(api, '__qaBot', () => {
    kind = BOT_POLL_KINDS.includes(kind) ? kind : 'greedy';
    const ok = api.setBot(!!on, kind);
    return { on: !!on, kind, ok: !!on ? !!ok : true };
  }, { on: false, kind: '', ok: false });
  /**
   * U17: __qaSteer(kind) picks who steers __qaInput: 'greedy' (default) or any other bot kind on the SLOW hand model, so a run
   * plays like a slow casual person. Holds across levels. Only exists under ?qa=1.
   */
  // DECISION (11-07 Sat r7c): every non-greedy steer played on the slow hand, so the kid and the designer critics played as the
  //   grandparent does (lag 0.7 s, 35 deg aim, 55 % push) and read 2 stars everywhere while the same bot on its own hand 3-stars
  //   L4-L10 87-100 % of the time. hand 'normal' keeps the bot's own hand; 'slow' (the default, as before) is the first-timer model.
  W.__qaSteer = (kind = 'greedy', hand = 'slow') => safe(api, '__qaSteer', () => {
    kind = BOT_POLL_KINDS.includes(kind) ? kind : 'greedy';
    hand = hand === 'normal' ? 'normal' : 'slow';
    qaSteerKind = kind;
    return { kind, hand, ok: isFn(api.setQaSteer) ? !!api.setQaSteer(kind, hand) : false };
  }, { kind: '', hand: '', ok: false });
  W.__qaTime = s => safe(api, '__qaTime', () => !!api.setTime(+s), false);
  W.__qaWin = () => safe(api, '__qaWin', () => !!api.forceResult('win', { stars: 3, tLeft: 21.4, chainBest: 12 }), false);
  /** DECISION: __qaFail(why) -> plausible card data: progress 0.62, the ticket's open lines, canFreeze true. */
  W.__qaFail = (why = 'timeout') => safe(api, '__qaFail', () => {
    const w = api.world();
    let missing = missingOf(w);
    if (!missing.length) missing = [{ kind: 'tomato', need: 3, got: 1 }];
    return !!api.forceResult('fail', { why: why === 'spoiled' ? 'spoiled' : 'timeout', progress: 0.62, missing, canFreeze: true });
  }, false);
  /** QA only: marks every tutorial flag seen (the beats stay out of screenshots and bot runs). */
  W.__qaSkip = () => safe(api, '__qaSkip', () => { api.meta.tutAll(); return true; }, false);
  /**
   * Extra (qa-run): __qaAdvance(seconds) runs the sim + render up to `seconds` of sim time faster than real time, stopping
   * once a win/fail card is up. Uses api.advance (sim only) when Core provides it, else api.tick (sim + paint).
   */
  W.__qaAdvance = (seconds = 1) => safe(api, '__qaAdvance', () => {
    const useAdvance = isFn(api.advance);
    if (!useAdvance) fallback('advance');
    // r7: the move the driver just dispatched reaches the page a frame later; apply it now so the stick is not a loop behind.
    const pm = qaPendingMove; qaPendingMove = null;
    if (pm && api.input && api.input.held && isFn(api.input.qaMove)) { try { api.input.qaMove(pm.x, pm.y); } catch {} }
    const t0 = performance.now();
    const max = Math.max(1, Math.round(num(+seconds, 1) * 60));
    let k = 0, after = 0;
    for (; k < max; k++) {
      if (useAdvance) api.advance(DT); else api.tick(DT);
      const w = api.world();
      if (w && w.result) after++;
      if ((k & 7) === 0 || after) {
        const sc = api.state().screen;
        if (sc !== 'play' && sc !== 'pause') break;
      }
      if (after > 240) break; // result without a card for 4 s: stop and let the caller see it
      if (performance.now() - t0 > 90000) break;
    }
    return Object.assign(qaState(api), { ticks: k, ms: Math.round(performance.now() - t0) });
  }, null);
  /** Extra (qa-run screenshots): jump to a screen by name ('title', 'map', 'daily', 'feast', 'shop', 'cookbook', 'settings', 'alldone'). */
  W.__qaScreen = (name, data) => safe(api, '__qaScreen', () => {
    api.toScreen(String(name), data);
    return api.state().screen;
  }, '');
  W.__spMode = M;
  if (M.level) safe(api, 'qa.level', () => { api.startLevel(M.level); });
}

// ------------------------------------------------------------------ REC showcase: course + director (§12.1, §12.2)
export const REC_PRE = 0.4;                         // preroll seconds: Core runs 24 steps before frame 0
// [video t, SIZE UP step] knots of the growth schedule: the big beats of D31 land exactly on these times.
export const REC_KNOTS = [[-REC_PRE, 0], [2.5, 2], [7.5, 5], [11.5, 8], [14.5, 11]];
export const REC_OPEN_T = 15.5, REC_RUSH_T = 16.0;  // padlock pops; the pot rushes the cake
const REC_FIRST = [-0.30, -0.17, -0.04];            // three peas in the preroll: chain x3 on frame 0, the third tipping
const REC_BERRY_T = [3.3, 4.8, 6.3];                // strawberry ticket 1/3, 2/3, 3/3 (tick before SIZE UP 5)
// Target bites per second over video time (the montage gets denser early, chunkier late).
const REC_RATE = [[-REC_PRE, 12], [7.5, 9], [11.5, 6], [14.5, 4], [REC_OPEN_T, 4]];
const REC_Q = 0.92;                                 // every course item fits with 8 % to spare when it is reached
const REC_V = 0.86;                                 // planned cruise = 86 % of top speed (the director has headroom)
const REC_GAP = 0.06, REC_GAP_MAX = 0.5;            // bite spacing (s); 0.5 keeps the chain alive (CHAIN_WIN 0.7)
const REC_HOLD_D = 4.0;                             // pot centre to cake centre at the padlock (0.5 s rush)
const REC_FLANK = 100, REC_FLANK_T = 12;             // crowd items beside the route, and until when (340 cap: 237 + 100)
export const REC_BACK = 20;                         // food either side of the pot's wake on frame 0 (not in the plan, never eaten)
const REC_ITEMS = 236;                              // course items (+ the cake), well under ITEM_MAX; the clip is tuned at this count
// The course's kind ladder (16 kinds + strawberry + cake = KINDS_MAX 18): colourful tiny food, picnic snacks, then
// the props a hole game is remembered for (cooler, bench, parasol, tree, swing set, gazebo) before the cake.
const REC_KINDS = ['pea', 'blueberry', 'cherry', 'juicebox', 'cupcake', 'pinwheel', 'sandwich', 'watermelon', 'beachball',
  'bin', 'cooler', 'bench', 'parasol', 'tree', 'swingset', 'gazebo'];
// DECISION (11-07 Sat): no cap let the planner take 9 swing sets in the last 0.7 s, one red pile in front of the cake.
//   Gazebos share the job. No level uses one, so kindMax has no entry and its pool falls back to render3d capFor's 48.
const REC_CAP = { swingset: 4, gazebo: 3 };
const r3 = v => Math.round(v * 1000) / 1000;
const frac = v => v - Math.floor(v);
const knotAt = (K, t) => {
  if (t <= K[0][0]) return K[0][1];
  for (let j = 1; j < K.length; j++) if (t <= K[j][0]) return K[j - 1][1] + (K[j][1] - K[j - 1][1]) * (t - K[j - 1][0]) / (K[j][0] - K[j - 1][0]);
  return K[K.length - 1][1];
};

/** Growth schedule r(t) (log-linear between the knots, ending at the padlock radius) and its inverse t(r). */
function recSchedule(r0, rOpen) {
  const R = [r0];
  for (let k = 1; k <= 16; k++) R.push(R[k - 1] * SIZEUP_MUL);   // same repeated product as logic's sizeUpR
  const K = REC_KNOTS.map(([t, s]) => [t, Math.log(R[s])]).concat([[REC_OPEN_T, Math.log(rOpen)]]);
  const seg = (y, a, b) => (a === b ? 0 : (y - a) / (b - a));
  const rAt = t => Math.exp(knotAt(K, t));
  const tAt = r => {
    const y = Math.log(r);
    if (y <= K[0][1]) return K[0][0];
    for (let j = 1; j < K.length; j++) if (y <= K[j][1]) return K[j - 1][0] + (K[j][0] - K[j - 1][0]) * seg(y, K[j - 1][1], K[j][1]);
    return REC_OPEN_T;
  };
  return { rAt, tAt, beats: REC_KNOTS.slice(1).map(([t, s]) => ({ t, s, r: R[s] })) };
}

/**
 * Boustrophedon route from the spawn down to the hold spot in front of the cake; w = half-width of the rows.
 * DECISION: row spacing widens down the board (1.8 → 4.8 m) because the pot is bigger there, and the route never
 *   folds back: a big prop that does not fit yet must stay clear of every earlier stretch of the route.
 */
function recRoute(w, spawn, cake) {
  const hz = cake.z + REC_HOLD_D, span = spawn.z - hz;
  const z = f => spawn.z - span * f;
  return [[spawn.x, spawn.z], [0, z(0.093)], [w, z(0.093)], [w, z(0.207)], [-w, z(0.207)], [-w, z(0.352)], [w, z(0.352)],
    [w, z(0.549)], [-w, z(0.549)], [-w, z(0.798)], [cake.x, hz]];
}
function routeLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; }
/** Point at arc length s on polyline p, pushed `off` to the left of the travel direction. */
function routeAt(p, s, off = 0) {
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1], l = Math.hypot(dx, dz) || 1e-9;
    if (s <= l || i === p.length - 1) {
      const u = Math.min(s, l) / l;
      return [p[i - 1][0] + dx * u - (dz / l) * off, p[i - 1][1] + dz * u + (dx / l) * off];
    }
    s -= l;
  }
  return [p[0][0], p[0][1]];
}

/**
 * Pure: the REC showcase course from the expanded REC level (levels.getRecord()). Keeps the board, surfaces, decor
 * and the cake; replaces the food with a size ladder laid along a serpentine route so that, eaten in order on
 * schedule, the pot crosses SIZE UP 2 / 5 / 8 / 11 at 2.5 / 7.5 / 11.5 / 14.5 s and pops the padlock at 15.5 s.
 * Returns { level, plan: [{ i, t }], route, beats, rOpen } (plan = item index + video time the director aims for).
 * DECISION: growth is path-independent (r² = r0² + G·Σk·a²), so the radius after each planned bite is exact; only
 *   arrival times can drift, and the director's speed control holds them. Each bite takes the course kind (that
 *   fits with 8 % to spare, within levels-data kindMax so the render pools fit) whose growth keeps the bite rate
 *   nearest REC_RATE, rotating among near-ties for variety; strawberry ×3 is the ticket (3.3 / 4.8 / 6.3 s).
 *   The kinds come from the curated REC_KINDS ladder (whatever of it the catalogue has in this town).
 */
export function recPlan(base) {
  const r0 = num(base && base.r0, 0.14);
  const bi = Math.max(0, base.items.findIndex(it => it.flags & Lg.F.BOSS));
  const boss = base.items[bi];
  const rOpen = Lg.needR(boss.a) + 1e-6;
  const S = recSchedule(r0, rOpen);
  const town = base.town || 'picnic';
  const inTown = k => (k.towns || [k.town]).some(t => t === town || t === 'all');
  const plain = k => !k.boss && !k.wall && !k.gate && !k.fragile && !k.surface && !k.roll && k.id !== 'strawberry' && inTown(k);
  let pool = REC_KINDS.map(id => KINDS.find(k => k.id === id)).filter(k => k && plain(k));
  if (pool.length < 8) pool = KINDS.filter(plain);
  pool.sort((a, b) => b.a - a.a || (a.id < b.id ? -1 : 1));
  const byId = id => KINDS.find(k => k.id === id);
  const pea = byId('pea') || pool[pool.length - 1], berry = byId('strawberry');
  const used = {}, bites = [];
  let r2 = r0 * r0, t = -REC_PRE, rot = 0, bk = 0;
  const R = () => Math.sqrt(r2);
  const gain = (k, ing) => G * (ing ? K_ING : num(k.k, 1)) * k.a * k.a;
  const add = (k, tt, ing) => { bites.push({ k, t: tt, r: R(), ing: !!ing }); used[k.id] = (used[k.id] | 0) + 1; r2 += gain(k, ing); t = tt; };
  const rawT = k => {
    const r = R(), rn = Math.sqrt(r2 + gain(k, false));
    let tt = S.tAt(rn);
    for (const b of S.beats) if (r < b.r && rn >= b.r) tt = b.t;
    if (rn >= rOpen) tt = REC_OPEN_T;
    return tt;
  };
  for (const tf of REC_FIRST) add(pea, tf, false);
  while (R() < rOpen && bites.length < REC_ITEMS) {
    const lim = REC_Q * Lg.FIT * R();
    const c = pool.filter(k => k.a <= lim && (used[k.id] | 0) < num(REC_CAP[k.id], num(KIND_MAX[k.id], 0)));
    if (!c.length) break;
    const want = 1 / knotAt(REC_RATE, t);
    const sc = c.map(k => { const g = rawT(k) - t; return { k, g, s: Math.abs(Math.log(Math.max(g, 0.005) / want)) + (g > REC_GAP_MAX ? 9 : 0) }; });
    const best = Math.min(...sc.map(o => o.s));
    const near = sc.filter(o => o.s <= best + 0.35);
    const o = near[rot++ % near.length];
    const tn = Math.max(t + REC_GAP, o.g + t);
    if (berry && bk < REC_BERRY_T.length && REC_BERRY_T[bk] < tn) { add(berry, Math.max(REC_BERRY_T[bk++], t + REC_GAP), true); continue; }
    add(o.k, tn, false);
  }
  // arc length the pot covers by time t at the planned cruise speed
  const sTab = [];
  for (let s = 0, tt = -REC_PRE; tt <= REC_OPEN_T + 1; tt += DT) { sTab.push(s); s += REC_V * Lg.speedOf(S.rAt(tt)) * DT; }
  const sAt = tt => { const f = (tt + REC_PRE) / DT, j = clamp(Math.floor(f), 0, sTab.length - 2); return sTab[j] + (sTab[j + 1] - sTab[j]) * clamp(f - j, 0, 1); };
  const arcs = bites.map(b => sAt(b.t) + 0.9 * Math.max(0, b.r - 0.25 * b.k.a));
  const need = Math.max(sAt(REC_OPEN_T), arcs.length ? arcs[arcs.length - 1] : 0) + 0.3;
  const spawn = base.spawn || { x: 0, z: 13 }, cake = { x: boss.x, z: boss.z };
  let lo = 0.5, hi = 7.5;
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (routeLen(recRoute(mid, spawn, cake)) < need) lo = mid; else hi = mid; }
  const route = recRoute(hi, spawn, cake);
  const x0 = num(base.x0, -9) + 0.3, x1 = num(base.x1, 9) - 0.3, z0 = num(base.z0, -15) + 0.3, z1 = num(base.z1, 15) - 0.3;
  const items = [Object.assign({}, boss, { zone: 0 })], plan = [];
  let flank = 0;
  bites.forEach((b, j) => {
    // lateral spread inside the swallow band, so the straight route collects every item
    const reach = Math.max(0, b.r - 0.25 * b.k.a);
    const off = j < REC_FIRST.length ? 0 : (frac(j * 0.618034) - 0.5) * 1.5 * reach;
    const [x, z] = routeAt(route, arcs[j], off);
    items.push({ kind: b.k.id, ki: b.k.i, x: r3(clamp(x, x0, x1)), z: r3(clamp(z, z0, z1)), a: b.k.a, h: b.k.h, k: num(b.k.k, 1),
      flags: b.ing ? Lg.F.ING : 0, rot: r3(frac(j * 0.381966) * 2 * Math.PI - Math.PI), lane: -1, lu: 0, belt: -1, stack: null, zone: 0 });
    plan.push({ i: items.length - 1, t: b.t });
    // DECISION (11-07 Sat, viral r4): one bite-wide line of food on a bare blanket read as a thin trail. Up to REC_FLANK more items sit just outside the swallow
    // band on alternating sides while the pot is small, so the frame is crowded. They are not in the plan and the pot passes them; same kind as the bite, so they fit.
    if (j >= REC_FIRST.length && !b.ing && b.t < REC_FLANK_T && flank < REC_FLANK && (used[b.k.id] | 0) < num(KIND_MAX[b.k.id], 0)) {
      const [fx, fz] = routeAt(route, arcs[j], (j & 1 ? 1 : -1) * (reach + b.k.a + 0.3 + frac(j * 0.754877) * 0.9));
      items.push({ kind: b.k.id, ki: b.k.i, x: r3(clamp(fx, x0, x1)), z: r3(clamp(fz, z0, z1)), a: b.k.a, h: b.k.h, k: num(b.k.k, 1),
        flags: 0, rot: r3(frac(j * 0.569840) * 2 * Math.PI - Math.PI), lane: -1, lu: 0, belt: -1, stack: null, zone: 0 });
      used[b.k.id] = (used[b.k.id] | 0) + 1; flank++;
    }
  });
  // DECISION (11-07 Sat, viral r6 "frame 0: tiny pot on an empty blanket, lower half of the frame blank"): the course runs
  //   away from the camera and the preroll has already carried the pot about 1.6 up the first leg, so everything below
  //   it on frame 0 was bare blanket. REC_BACK small foods sit in two columns either side of the wake the pot has just
  //   cut (0.44-0.96 out, 0.2-1.2 behind its frame-0 point: the close camera sees about 0.8 either side), at least 0.38 off
  //   the first leg (the frame-0 pot is r 0.16); the pot never comes back, so they stay uneaten (modes-test checks) and off the plan.
  {
    const back = ['blueberry', 'cherry', 'pea'].map(byId).filter(Boolean);
    const cnt = {}; for (const it of items) cnt[it.kind] = (cnt[it.kind] | 0) + 1;
    const [px, pz] = routeAt(route, sAt(0));
    const spots = [];
    for (const dz of [0.22, 0.5, 0.78, 1.06]) for (const dx of [0.44, 0.7, 0.96]) { spots.push([-dx, dz + (dx === 0.7 ? 0.14 : 0)]); spots.push([dx, dz + (dx === 0.7 ? 0 : 0.14)]); }
    let n = 0;
    spots.forEach(([dx, dz], j) => {
      if (n >= REC_BACK || !back.length) return;
      const k = back[j % back.length];
      if ((cnt[k.id] | 0) >= num(KIND_MAX[k.id], 0)) return;
      const jx = (frac(j * 0.618034) - 0.5) * 0.1, jz = (frac(j * 0.754877) - 0.5) * 0.12;
      items.push({ kind: k.id, ki: k.i, x: r3(clamp(px + dx + jx, x0, x1)), z: r3(clamp(pz + dz + jz, z0, z1)), a: k.a, h: k.h, k: num(k.k, 1),
        flags: 0, rot: r3(frac(j * 0.381966) * 2 * Math.PI - Math.PI), lane: -1, lu: 0, belt: -1, stack: null, zone: 0 });
      cnt[k.id] = (cnt[k.id] | 0) + 1; n++;
    });
  }
  const tickets = [{ lines: [{ kind: 'strawberry', need: Math.min(3, bites.filter(b => b.ing).length) || 1, place: 'open' }], boss: 0 }];
  const level = Object.assign({}, base, {
    items, tickets, path: route.map(([x, z]) => ({ x: r3(x), z: r3(z) })),
    zones: [{ id: 0, x: 0, z: 0, parent: -1, gate: -1, r: 0 }],
    zoneGraph: { nodes: [{ id: 0, x: 0, z: 0, items: items.map((_, i) => i) }], edges: [] },
  });
  return { level, plan, route, beats: S.beats, rOpen };
}

/** The scripted showcase bot: plan from recPlan. Pure and deterministic like bots.js (reads w, never writes it). */
export function createDirector(plan) { return { plan: plan || [], j: 0, n: 0, out: { x: 0, z: -1, m: 0 } }; }
/**
 * One decision per sim step -> { x, z, m }. Video time = steps so far − the 0.4 s preroll.
 * DECISION: target = the first planned item still on the board that fits (looking ≤ 6 ahead, so a missed one never
 *   stalls the run); speed m = distance to its swallow point / time left to its planned bite, over top speed
 *   (0.08..1, full when late). Props that do not fit yet and sit ahead within reach bend the heading onto their
 *   tangent (no bump stalls). After the plan: face the cake, creep (m 0.1) while the padlock pops, rush at 16.0 s.
 */
export function directorDecide(d, w, dt = DT) {
  const vt = d.n * dt - REC_PRE;
  d.n++;
  const o = d.out;
  if (!w || w.result) { o.m = 0; return o; }
  const P = w.pot, pl = d.plan, st = w.st;
  while (d.j < pl.length && st[pl[d.j].i] !== 0) d.j++;
  let tx, tz, m = 1;
  const tk = w.tickets[w.ti], b = Lg.curBoss(w);
  if (d.j >= pl.length || (tk && tk.open)) {
    if (b < 0) { o.m = 0; return o; }
    tx = w.ix[b]; tz = w.iz[b];
    m = tk && tk.open ? (vt < REC_RUSH_T ? 0.1 : 1) : 0.15;
  } else {
    let q = d.j;
    for (let k = d.j; k < pl.length && k < d.j + 6; k++) if (Lg.edible(w, pl[k].i)) { q = k; break; }
    const it = pl[q], i = it.i;
    tx = w.ix[i]; tz = w.iz[i];
    const dist = Math.max(0, Math.hypot(tx - P.x, tz - P.z) - (P.r - 0.25 * w.ia[i])), tau = it.t - vt;
    m = tau > dt ? clamp(dist / tau / Lg.speedOf(P.r), 0.08, 1) : 1;
  }
  const dx = tx - P.x, dz = tz - P.z, l = Math.hypot(dx, dz);
  if (l < 1e-6) { o.m = 0; return o; }
  let ux = dx / l, uz = dz / l, vx = ux, vz = uz;
  for (let i = 0; i < w.n; i++) {
    if (st[i] !== 0 || i === b || Lg.canFit(P.rEff, w.ia[i])) continue;
    const ox = w.ix[i] - P.x, oz = w.iz[i] - P.z, od = Math.hypot(ox, oz), R = w.ia[i] + 0.5 * P.r + 0.3;
    if (od > R + 1.2 || od < 1e-6 || od > l + R) continue;
    const ahead = (ox * ux + oz * uz) / od;
    if (ahead <= 0) continue;
    const s = ox * uz - oz * ux >= 0 ? 1 : -1;             // obstacle right of the heading → pass it on the left
    const k = clamp(1 - (od - R) / 1.2, 0, 1) * ahead;
    vx += k * (s * oz / od - 0.3 * ox / od); vz += k * (-s * ox / od - 0.3 * oz / od);
  }
  const vl = Math.hypot(vx, vz) || 1;
  o.x = vx / vl; o.z = vz / vl; o.m = m;
  return o;
}

// ------------------------------------------------------------------ ?record=1 / ?og=1 / ?cover=
let recCourse = null;    // the REC course, planned once per page from the pristine levels.getRecord()
/** Plans the REC showcase course once (recPlan on a copy of levels.getRecord()); null when levels is missing. */
function courseFor(api) {
  if (recCourse) return recCourse;
  const base = api.levels && isFn(api.levels.getRecord) ? api.levels.getRecord() : null;
  if (!base || !Array.isArray(base.items)) return null;
  recCourse = recPlan(Object.assign({}, base, { items: base.items.slice() }));
  return recCourse;
}

/**
 * Starts (or restarts, for the loop) the REC showcase: the recPlan course, a fresh director, the 0.4 s preroll.
 * DECISION: asks Core for api.startRecord({ level, decide }) (course level + director decide(w, dt) driving the
 *   sim, preroll inside). Until Core takes the options (seen as: decide never called), modes falls back in three
 *   steps, all inside this capture page: the course is copied onto the cached levels.getRecord() object, the
 *   director drives through api.input.sample with the bot off, and api.retry() + 24 api.advance(DT) steps redo
 *   the REC start and preroll. window.__spFallbacks gets 'recHook'. With no startRecord at all: L1 + greedy bot.
 */
function startRecordLevel(api, rec) {
  let P = null;
  try { P = courseFor(api); } catch (e) { report(api, e, 'recPlan'); }
  if (isFn(api.startRecord) && P) {
    const d = createDirector(P.plan);
    const decide = (w, dt) => directorDecide(d, w, dt);
    const ok = safe(api, 'startRecord', () => api.startRecord({ level: P.level, decide }), false);
    if (ok !== false && d.n > 0) { if (rec) rec.director = d; return true; }
    fallback('recHook');
    const d2 = createDirector(P.plan);
    const ok2 = safe(api, 'record.fallback', () => {
      const lv = api.levels.getRecord();
      if (lv !== P.level) Object.assign(lv, P.level);
      if (ok === false && api.startRecord() === false) return false;
      api.setBot(false);
      if (api.input) api.input.sample = () => directorDecide(d2, api.world(), DT);
      if (api.retry() === false) return false;
      for (let i = 0; i < Math.round(REC_PRE / DT); i++) api.advance(DT);
      return true;
    }, false);
    if (ok2) { if (rec) rec.director = d2; return true; }
  } else if (isFn(api.startRecord)) {
    const ok = safe(api, 'startRecord', () => api.startRecord(), false);
    if (ok !== false) return true;
  }
  fallback('startRecord');
  safe(api, 'record.bot', () => { api.setBot(true, 'greedy'); });
  return !!safe(api, 'record.level', () => api.startLevel(1), false);
}

/**
 * Caption alphas and the loop iris for ui.js, from video time t (s). DECISION: hook on from frame 0, fading out
 * 2.75–3.0 s and back in over the last 0.5 s (so the last frame matches frame 0); cap2 12.8–15.6 s with 0.2 s fades;
 * end card in over 0.2 s from REC_END_T and held until the loop frame; iris 0→1 over the last 0.5 s (the end card opens in
 * a circle on the restarted frame-0 pot, so the loop frame is frame 0).
 */
export function recShow(t) {
  const up = (a, b) => clamp((t - a) / (b - a), 0, 1);
  return {
    hook: t < REC_OVER_T ? 1 - up(2.75, 3.0) : up(REC_OVER_T, REC_LOOP_T),
    cap2: up(12.8, 13.0) * (1 - up(15.4, 15.6)),
    end: t < REC_LOOP_T ? up(REC_END_T, REC_END_T + 0.2) : 0,
    iris: up(REC_OVER_T, REC_LOOP_T),
  };
}

const SLIM_KEYS = ['i', 'kind', 'tier', 'n', 'ing', 'step', 'r', 'ti', 'li', 'final', 'add', 'g', 'why', 'stars', 'on', 'v', 's'];
function slim(d) {
  const o = {};
  if (d && typeof d === 'object') for (const k of SLIM_KEYS) if (k in d && (typeof d[k] === 'number' || typeof d[k] === 'boolean' || typeof d[k] === 'string')) o[k] = d[k];
  return o;
}

function makeCapture(api) {
  let cv = null;
  /** DECISION: re-calls render.draw() first so the WebGL buffer is valid in this same task, then draws #c and #ui into one canvas at the stage's CSS size. */
  return function frame(q = 0.92) {
    return safe(api, '__rec.frame', () => {
      try { if (api.render && isFn(api.render.draw)) api.render.draw(); } catch (e) { report(api, e, 'frame.draw'); }
      const c = document.getElementById('c'), u = document.getElementById('ui'), s = document.getElementById('stage') || c;
      const r = s.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width || c.width)), H = Math.max(1, Math.round(r.height || c.height));
      if (!cv) cv = document.createElement('canvas');
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const x = cv.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.drawImage(c, 0, 0, W, H);
      if (u) x.drawImage(u, 0, 0, W, H);
      return cv.toDataURL('image/jpeg', clamp(num(+q, 0.92), 0.1, 1));
    }, '');
  };
}

/**
 * ?record=1 / ?og=1 / ?cover=: the __rec contract (§12.1), window.__recState for ui.js captions, the loop at REC_LOOP_T.
 * DECISION (loop): at REC_OVER_T (mode 'over') the REC restarts with a fresh director and preroll, and the last 30
 *   frames only repaint (tick 0) under the iris, so the loop frame shows the same pose as frame 0. Bus events after
 *   the restart and before frame 0 are not sent to the soundtrack.
 */
function installRecord(api, M, still) {
  const rec = { t: 0, frames: 0, over: false, hook: M.hook, cap2: M.cap2, end: M.end, still: !!still, ready: false, steps: 0,
    show: recShow(0), iris: 0, step: 0, beats: [], looped: false, director: null };
  api.rec = rec;
  window.__recState = rec;
  window.__spMode = M;

  // Bus events for the soundtrack (audio.renderWav takes [{ t, ev, data }]).
  const events = [];
  const names = new Set((api.audio && api.audio.BUS_EVENTS) || ['start', 'bite', 'sizeUp', 'line', 'ticketDone', 'padlock', 'bossBite', 'chain', 'sizzle', 'win']);
  safe(api, 'record.bus', () => { api.bus.on('*', (d, ev) => { if (!rec.looped && names.has(ev) && events.length < 6000) events.push({ t: rec.frames / 60, ev, data: slim(d) }); }); });

  const snap = () => {
    let w = null;
    try { w = api.world(); } catch {}
    const chain = num(w && w.chain && w.chain.n), score = num(w && w.stats && w.stats.bites);
    return { t: rec.t, mode: rec.over ? 'over' : 'play', score, chain, streak: chain };
  };
  const stepOne = (useAdvance) => {
    rec.frames++; rec.t = rec.frames / 60; rec.over = rec.t >= REC_OVER_T;
    const sh = recShow(rec.t);
    rec.show = sh; rec.iris = sh.iris;
    if (!still && !rec.looped && rec.frames >= Math.round(REC_OVER_T * 60)) {
      rec.looped = true;
      startRecordLevel(api, rec);
      api.tick(0);
    } else if (rec.looped) api.tick(0);
    else if (useAdvance && isFn(api.advance)) api.advance(DT); else api.tick(DT);
    try { const w = api.world(); rec.step = w && w.pot ? w.pot.step | 0 : 0; } catch {}
  };
  window.__rec = {
    /**
     * n x DT of sim through the same accumulator path as play (no rAF); paints each frame (ui reads api.rec.t).
     * DECISION: a long jump (n > 30, --snap) runs sim-only api.advance for all but the last 30 frames, which are
     *   painted so the camera and particles settle; record.mjs video mode steps 1 at a time and paints every frame.
     */
    step(n = 1) {
      return safe(api, '__rec.step', () => {
        n = Math.max(1, Math.floor(num(+n, 1)));
        for (let i = 0; i < n; i++) stepOne(n > 30 && i < n - 30);
        return snap();
      }, snap());
    },
    frame: makeCapture(api),
    /** base64 WAV of `dur` seconds: the real mix from audio.renderWav when available, else silence. */
    async audio(dur) {
      dur = clamp(num(+dur, 25), 0.1, 120);
      try {
        if (api.audio && isFn(api.audio.renderWav)) {
          const town = (api.state().level && api.world() && api.world().level && api.world().level.town) || 'picnic';
          const b64 = await api.audio.renderWav(dur, events, { town, mode: 'play', music: true });
          if (typeof b64 === 'string' && b64.length > 100) return b64;
        }
      } catch (e) { report(api, e, '__rec.audio'); }
      fallback('audio');
      return silentWav(dur);
    },
  };

  (async () => {
    try {
      safe(api, 'record.tut', () => { api.meta.tutAll(); });
      startRecordLevel(api, rec);
      if (recCourse) rec.beats = recCourse.beats.map(b => ({ t: b.t, step: b.s }));
      // the preroll's bites happen before frame 0: the soundtrack starts clean at t = 0
      for (let i = events.length - 1; i >= 0; i--) if (!/^(start|levelStart)$/.test(events[i].ev)) events.splice(i, 1);
      await fontsReady();
      if (still) {
        // og / cover: run the REC beats synchronously (sim only when Core offers advance), render the last stretch fully.
        const t0 = performance.now();
        const fast = isFn(api.advance);
        if (!fast) fallback('advance');
        const tail = Math.min(30, OG_STEPS);
        let i = 0;
        for (; i < OG_STEPS; i++) {
          stepOne(fast && i < OG_STEPS - tail);
          if (performance.now() - t0 > STILL_GUARD_MS) break;
        }
        rec.steps = i;
        window.__ogSteps = i;
        api.tick(0);
        window.__ogReady = true;
        if (M.cover) { window.__cover = M.cover; window.__coverReady = true; }
      } else {
        for (let i = 0; i < 3; i++) api.tick(0); // warm paint: shaders, fonts, first ui frame
        rec.ready = true;
        window.__recReady = true;
      }
    } catch (e) {
      report(api, e, 'record');
      if (still) { window.__ogReady = true; if (M.cover) window.__coverReady = true; } else window.__recReady = true;
    }
  })();
}

// ------------------------------------------------------------------ install
/** Installs the modes for the current URL. Never throws. */
export function install(api) {
  try {
    if (typeof window === 'undefined' || !api) return;
    const M = parseModes(typeof location !== 'undefined' ? location.search : '');
    api.mode = M;
    window.__spMode = M;
    if (M.qa || (api.P && api.P.qa)) safe(api, 'installQa', () => installQa(api, M));
    if (M.record || M.og || M.cover) safe(api, 'installRecord', () => installRecord(api, M, !M.record));
  } catch (e) { report(api, e, 'install'); }
}

export default { parseModes, install, silentWav, HOOK_DEFAULT, CAP2_DEFAULT };
