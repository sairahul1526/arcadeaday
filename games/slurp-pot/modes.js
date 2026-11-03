// Slurp Pot modes (Meta/QA, GDD §11.4 qa contract, §12 record/og/cover, §13.3 modes.js).
//
//   parseModes(search) -> { qa, record, og, cover, level, tier, hook, cap2, end }
//   install(api)       -> installs, depending on the query:
//        ?qa=1       the __qa* hooks of §11.4 (+ __qaAdvance, __qaScreen for tools/slurp-pot/qa-run.mjs)
//        ?record=1   window.__rec = { step(n), frame(q), audio(dur) } and __recReady (record.mjs)
//        ?og=1       runs 1,092 REC steps at boot, renders once, sets __ogReady
//        ?cover=...  same hero run as og, sets __coverReady (backplates for covers.mjs)
//
// Nothing here may throw into game.js: every hook is wrapped, errors go to api.P.error. No storage access of any
// kind (the save is meta.js through P). Plain ES module, no DOM at import time, so Node can import parseModes.
//
// Everything that the UI needs from record mode is published on api.rec and window.__recState:
//   { t, frames, over, hook, cap2, end, still, ready }   t = video seconds (frames / 60), over = t >= 24.5.
//
// DECISION: flags are on only for the exact value "1" (the platform layer's qa test is /[?&]qa=1\b/, record.mjs and
//   og.mjs also send 1), so ?qa=true is not qa. ?level=n is honoured only together with ?qa=1 (GDD §11.4).
// DECISION: hook / cap2 / end are trimmed, stripped of control characters and cut to 120 characters. An empty
//   value falls back to the GDD default; end has no default and no URL is ever hard-coded here (Playables text scan).
// DECISION: if a module asks for something the API does not offer yet (api.startRecord, api.advance, bots.screenDir),
//   modes.js falls back (L1 + director bot, api.tick, a naive chaser) and reports the fallback in window.__spFallbacks,
//   so qa-run can print which pieces are still missing instead of silently passing.

export const HOOK_DEFAULT = 'Can a pea-sized pot eat the WHOLE park?';
export const CAP2_DEFAULT = '…even the giant cake?';
export const LEVELS = 60;
const DT = 1 / 60;
const REC_OVER_T = 24.5;      // mode 'over' once the end card has shown 1.0 s (GDD §12.1)
const OG_STEPS = 1092;        // 18.2 s of REC (GDD §12.3)
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
function makeQaInput(api) {
  let down = false; // is the (virtual) pointer we asked the checker to press still down?
  let lx = 0, ly = 0; // last pointer position we sent
  const at = (type, x, y) => { lx = x; ly = y; return { type, x, y }; };
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
      // DECISION: if the game dropped the pointer (pause/resume, level reset, the 2 s lost-pointerup guard), press again.
      if (api.input && api.input.held === false) return [up(), at('down', c.cx, c.cy)];
      const d = botDirection(api, w), rad = stickRad(api);
      if (d) return [at('move', c.cx + d.dx * 0.8 * rad, c.cy + d.dy * 0.8 * rad)];
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

// ------------------------------------------------------------------ ?record=1 / ?og=1 / ?cover=
/**
 * Starts the REC level. DECISION: asks Core for api.startRecord() (REC via levels.getRecord(), director bot, no boosters,
 * recordPath); until that exists it falls back to L1 with the director bot (or greedy), which is a stand-in, not the REC
 * beat sheet. window.__spFallbacks gets 'startRecord'.
 */
function startRecordLevel(api) {
  if (isFn(api.startRecord)) {
    const ok = safe(api, 'startRecord', () => api.startRecord(), false);
    if (ok !== false) return true;
  }
  fallback('startRecord');
  safe(api, 'record.bot', () => { api.setBot(true, 'director'); });
  let ok = safe(api, 'record.level', () => api.startLevel(1), false);
  if (!ok) { safe(api, 'record.bot2', () => api.setBot(true, 'greedy')); ok = safe(api, 'record.level2', () => api.startLevel(1), false); }
  return !!ok;
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

function installRecord(api, M, still) {
  const rec = { t: 0, frames: 0, over: false, hook: M.hook, cap2: M.cap2, end: M.end, still: !!still, ready: false, steps: 0 };
  api.rec = rec;
  window.__recState = rec;
  window.__spMode = M;

  // Bus events for the soundtrack (audio.renderWav takes [{ t, ev, data }]).
  const events = [];
  const names = new Set((api.audio && api.audio.BUS_EVENTS) || ['start', 'bite', 'sizeUp', 'line', 'ticketDone', 'padlock', 'bossBite', 'chain', 'sizzle', 'win']);
  safe(api, 'record.bus', () => { api.bus.on('*', (d, ev) => { if (names.has(ev) && events.length < 6000) events.push({ t: rec.frames / 60, ev, data: slim(d) }); }); });

  const snap = () => {
    let w = null;
    try { w = api.world(); } catch {}
    const chain = num(w && w.chain && w.chain.n), score = num(w && w.stats && w.stats.bites);
    return { t: rec.t, mode: rec.over ? 'over' : 'play', score, chain, streak: chain };
  };
  const stepOne = (useAdvance) => {
    rec.frames++; rec.t = rec.frames / 60; rec.over = rec.t >= REC_OVER_T;
    if (useAdvance && isFn(api.advance)) api.advance(DT); else api.tick(DT);
  };
  window.__rec = {
    /** n x DT of sim through the same accumulator path as play (no rAF); also paints each frame (ui reads api.rec.t). */
    step(n = 1) {
      return safe(api, '__rec.step', () => {
        n = Math.max(1, Math.floor(num(+n, 1)));
        for (let i = 0; i < n; i++) stepOne(false);
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
      startRecordLevel(api);
      safe(api, 'record.tut', () => { api.meta.tutAll(); });
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
