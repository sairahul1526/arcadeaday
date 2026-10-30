// Arcade a Day platform layer (P). Every v2 game talks to the host only through this file:
// saves, the audio flag, pause/resume, ready signals, score and share/link permissions.
// Same code on the web (arcadeaday.com/<slug>/) and on YouTube Playables (games/yt/<slug>/).
//
//   import P from '../shared/platform.js';
//   await P.init({ store: 'abc_', version: 2, defaults: { best: 0, ... }, migrate: old => upgraded });
//   P.data.coins += 5; P.save();          // debounced, at most once a second
//   P.best(totalStars);                   // integer; raises data.best and reports it
//   P.onPause(stopLoop); P.onResume(startLoop); P.onAudio(on => ...);
//   P.firstFrame();  ...  P.ready();      // loading frame drawn, then interactable
//
// See games/shared/README.md for the full contract. No dependencies; plain ES module.

const Y = typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV ? ytgame : null; // eslint-disable-line no-undef
const QA = /[?&]qa=1\b/.test(location.search);
const SAVE_GAP = 1000; // ms between real writes
const MAX_SAVE = 500 * 1024; // Playables limit on saveData size (bytes, roughly chars)

// Analytics endpoint (same-origin path, e.g. '/api/ev'). Empty = P.event is a no-op. Web only.
const ANALYTICS_URL = '';
// Portal (web builds only): ?portal=crazygames|gamedistribution|gamepix|coolmath|poki or window.__PORTAL set by the portal build.
const PORTALS = ['crazygames', 'gamedistribution', 'gamepix', 'coolmath', 'poki'];
const portalName = (() => {
  if (Y) return '';
  let n = '';
  try { n = (new URLSearchParams(location.search).get('portal') || window.__PORTAL || '') + ''; } catch {}
  n = n.toLowerCase();
  return PORTALS.includes(n) ? n : '';
})();
const sdkCall = fn => { try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch {} };
let portalInited = false, gameplayOn = false;

const pauseCbs = [], resumeCbs = [], audioCbs = [];
let opts = null; // init() options
let saveTimer = 0, lastWrite = 0, dirty = false, paused = false;
let firstDone = false, readyDone = false;

// localStorage can throw (private mode, sandboxed iframes, quota). Never let it break the game.
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const clone = o => JSON.parse(JSON.stringify(o));
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const call = (list, ...a) => list.slice().forEach(cb => { try { cb(...a); } catch (e) { P.error(e); } });

const P = {
  /** 'yt' inside YouTube Playables, otherwise 'web'. */
  env: Y ? 'yt' : 'web',
  /** '' on the web and YouTube; 'crazygames' | 'gamedistribution' | 'gamepix' | 'coolmath' | 'poki' when running inside a portal build. */
  portal: portalName,
  /** true when the page was opened with ?qa=1 (QA hooks may be exposed). */
  qa: QA,
  /** The save object. Mutate it, then call P.save(). null until init() resolves. */
  data: null,
  /** Host audio flag. yt: system.isAudioEnabled(). web: always true (the game has its own mute). */
  audioOn: true,
  /** Web-only extras. All false on YouTube. */
  canShare: !Y && !portalName, // portals forbid share prompts and outbound links
  canLink: !Y && !portalName,
  showMute: !Y,
  /** Player language, e.g. 'en' or 'en-US'. */
  lang: (typeof navigator !== 'undefined' && navigator.language) || 'en',
  /** true while the host has paused the game. */
  get paused() { return paused; },

  /**
   * Loads the save (awaiting ytgame.game.loadData() on YouTube), migrates and fills defaults,
   * and wires pause/resume/audio. Call once, before anything else.
   */
  async init(o) {
    opts = { store: 'game_', version: 1, defaults: {}, migrate: x => x, ...o };
    let raw = '';
    if (Y) {
      try { raw = await Y.game.loadData(); } catch (e) { P.error(e); raw = ''; }
      try { P.lang = (await Y.system.getLanguage()) || P.lang; } catch {}
    } else {
      raw = ls.get(opts.store + 'save') || '';
    }
    let d = null, migrated = false;
    if (typeof raw === 'string' && raw !== '') {
      try { d = JSON.parse(raw); } catch (e) { console.warn('[P] corrupt save ignored', e); }
    }
    if (!isObj(d)) d = null;
    if (d && (d.v | 0) < opts.version) {
      try { d = opts.migrate(clone(d)); migrated = true; } catch (e) { P.error(e); d = null; }
      if (!isObj(d)) d = null;
    }
    // Fill in any missing top-level keys from the defaults (new fields added without a version bump).
    const base = clone(opts.defaults);
    d = d ? { ...base, ...d } : base;
    if (!d.v || d.v < opts.version) d.v = opts.version;
    d.best = Math.max(0, Math.floor(+d.best || 0));
    P.data = d;
    if (migrated) { dirty = true; P.flush(); } // persist the upgraded shape right away

    if (Y) {
      try { P.audioOn = !!Y.system.isAudioEnabled(); } catch {}
      try { Y.system.onAudioEnabledChange(on => { P.audioOn = !!on; call(audioCbs, P.audioOn); }); } catch (e) { P.error(e); }
      try { Y.system.onPause(() => setPaused(true)); } catch (e) { P.error(e); }
      try { Y.system.onResume(() => setPaused(false)); } catch (e) { P.error(e); }
    } else {
      // The ONLY place a game may listen to visibility/pagehide, and only on the web.
      document.addEventListener('visibilitychange', () => setPaused(document.hidden));
      addEventListener('pagehide', () => { P.flush(); setPaused(true); });
      addEventListener('pageshow', e => { if (e.persisted) setPaused(false); });
      // Keep the hub's "your best" readable even for saves made before best() existed.
      if (d.best > 0 && !ls.get(opts.store + 'best')) ls.set(opts.store + 'best', String(d.best));
    }
    initPortal();
    if (QA) window.__P = P;
    return d;
  },

  /** Debounced save: the first call writes almost at once, later ones at most once a second. */
  save() {
    if (!P.data) return; // never save before loadData() finished
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(P.flush, Math.max(0, SAVE_GAP - (Date.now() - lastWrite)));
  },

  /** Writes now if anything is pending. Called automatically on pause and pagehide. */
  flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!P.data || !dirty) return;
    dirty = false;
    lastWrite = Date.now();
    let json;
    try { json = JSON.stringify(P.data); } catch (e) { P.error(e); return; }
    if (json.length > MAX_SAVE) console.warn('[P] save is ' + json.length + ' chars, over the 500 KiB limit');
    if (Y) {
      try { Promise.resolve(Y.game.saveData(json)).catch(e => P.error(e)); } catch (e) { P.error(e); }
    } else {
      ls.set(opts.store + 'save', json);
      ls.set(opts.store + 'best', String(P.data.best | 0));
    }
  },

  /** Web only: the raw stored save string (null on yt or when storage is blocked), for multi-tab merges. */
  readStored() { return Y ? null : ls.get(opts.store + 'save'); },

  /** Web only: cb(raw) whenever another tab writes this game's save (raw is null when it was removed). */
  onStoredChange(cb) {
    if (Y || typeof addEventListener !== 'function') return;
    try { addEventListener('storage', e => { if (e.key === opts.store + 'save') cb(e.newValue); }); } catch {}
  },

  /** Report a score. Raises data.best when n is higher, saves, and on yt sends it (integer). */
  best(n) {
    n = Math.max(0, Math.floor(+n || 0));
    if (!P.data || n <= (P.data.best | 0)) return false;
    P.data.best = n;
    P.save();
    if (Y) {
      try { Promise.resolve(Y.engagement.sendScore({ value: n })).catch(e => P.error(e)); } catch (e) { P.error(e); }
    }
    return true;
  },

  /** cb(on) whenever the host audio flag changes. */
  onAudio(cb) { audioCbs.push(cb); },
  /** cb() when the host pauses the game: stop the loop, timers and audio (suspend the AudioContext). */
  onPause(cb) { pauseCbs.push(cb); },
  /** cb() when the host resumes the game: restart what onPause stopped. */
  onResume(cb) { resumeCbs.push(cb); },

  /** Call once the loading screen's first frame is on screen. */
  firstFrame() {
    if (firstDone) return;
    firstDone = true;
    if (Y) try { Y.game.firstFrameReady(); } catch (e) { P.error(e); }
    portalLoading();
  },
  /** Call once the game is interactable. Always comes after firstFrame() (called for you if needed). */
  ready() {
    if (readyDone) return;
    P.firstFrame();
    readyDone = true;
    if (Y) try { Y.game.gameReady(); } catch (e) { P.error(e); }
    P.loadingDone();
  },

  /** Analytics. No-op unless ANALYTICS_URL is set and env is 'web'. Never throws, never blocks. */
  event(name, data) {
    if (P.env !== 'web' || !ANALYTICS_URL) return;
    try {
      const body = JSON.stringify({ e: name, d: data || {}, t: Date.now(), p: portalName });
      if (navigator.sendBeacon) navigator.sendBeacon(ANALYTICS_URL, body);
    } catch {}
  },

  /** Portal lifecycle hooks. All no-ops on web and YouTube; never gate gameplay on them. */
  loadingDone() { portalLoaded(); },
  /** A level/round is now being played (call again after every pause/resume or retry). */
  gameplayStart() { if (gameplayOn) return; gameplayOn = true; if (portalName === 'crazygames') cg(g => g.gameplayStart()); },
  /** Gameplay stopped (menu, pause, win/lose card). */
  gameplayStop() { if (!gameplayOn) return; gameplayOn = false; if (portalName === 'crazygames') cg(g => g.gameplayStop()); },
  /** A celebratory moment (e.g. a 3-star win). */
  happyTime() {
    if (portalName === 'crazygames') cg(g => g.happytime());
    else if (portalName === 'gamepix') sdkCall(() => window.GamePix.happyMoment());
  },
  /** A natural break between levels. Does nothing: the game makes no ad calls. Reserved for a portal that requires it. */
  breakpoint() {},

  /** Report an error without throwing. Uses console.warn so it never counts as a console error. */
  error(e) {
    try { console.warn('[P]', (e && e.message) || e); } catch {}
    if (Y) try { Y.health.logError(); } catch {}
  },

  /** Web Share with a clipboard fallback. Resolves true if something was shared or copied. No-op on yt. */
  async share({ title = document.title, text = '', url = location.href } = {}) {
    if (!P.canShare) return false;
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return true; }
      if (navigator.clipboard) { await navigator.clipboard.writeText((text ? text + ' ' : '') + url); return true; }
    } catch {}
    return false;
  },
  /** Navigate to a URL (e.g. '../' for "more games"). No-op on yt. */
  link(url) {
    if (!P.canLink) return false;
    location.assign(url);
    return true;
  },
};

// ---- portal adapter (thin; every call guarded, absent SDKs are ignored)
// CrazyGames SDK v3: game.* calls are only valid once init() has resolved, so every call waits on it (order kept).
let cgReady = Promise.resolve();
const cg = fn => {
  initPortal(); // firstFrame() can come before loadData(): init first so loadingStart waits for sdk.init() (QA 10-30)
  const sdk = window.CrazyGames && window.CrazyGames.SDK;
  if (sdk) cgReady.then(() => { if (sdk.game) sdkCall(() => fn(sdk.game)); });
};
function initPortal() {
  if (!portalName || portalInited) return;
  portalInited = true;
  if (portalName === 'crazygames') {
    const sdk = window.CrazyGames && window.CrazyGames.SDK;
    if (sdk && sdk.init) try { cgReady = Promise.resolve(sdk.init()).catch(() => {}); } catch {}
  } else if (portalName === 'gamedistribution') {
    // GD pause/resume arrive through GD_OPTIONS.onEvent, which the portal build (tools/build-portal.mjs) queues in
    // window.__gdEvents and forwards to window.__gdOnEvent. The SDK may hold its own reference to onEvent, so it is
    // not replaced here; events that arrived before init are replayed.
    const on = ev => { if (ev && ev.name === 'SDK_GAME_PAUSE') setPaused(true); else if (ev && ev.name === 'SDK_GAME_START') setPaused(false); };
    window.__gdOnEvent = ev => { try { on(ev); } catch {} };
    (window.__gdEvents || []).forEach(window.__gdOnEvent);
  }
}
function portalLoading() {
  if (portalName === 'crazygames') cg(g => g.loadingStart());
  else if (portalName === 'gamepix') sdkCall(() => window.GamePix.loading(0));
}
function portalLoaded() {
  if (portalName === 'crazygames') cg(g => g.loadingStop());
  else if (portalName === 'gamepix') sdkCall(() => window.GamePix.loaded());
}

function setPaused(p) {
  if (p === paused) return;
  paused = p;
  if (p) { P.flush(); call(pauseCbs); } else call(resumeCbs);
}

export default P;
