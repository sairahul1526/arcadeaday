// YouTube Playables compliance check for a built game (run tools/build-playables.mjs first).
//
//   node tools/playables-check.mjs <slug> [--browsers chromium,firefox,webkit]
//
// Serves games/yt/<slug>/ on localhost with the exact Playables CSP header, routes the SDK URL to a
// mock SDK (logs every call with timestamps, keeps saveData in memory, can fire pause/resume/audio),
// and drives the game with real touch-only and mouse-only input on Chromium, Firefox and WebKit at
// phone/tablet/desktop sizes in both orientations. Screenshots: studio/<IST date>/qa/playables/.
// Prints a PASS/FAIL table and exits 1 on any MUST failure.
//
// GAME CONTRACT (only under ?qa=1, which this checker always appends; see games/shared/README.md):
//   window.__qa()        -> { t, mode, level, progress, ... }   t = game time in seconds (must freeze
//                           while paused), mode 'play' = mid-level, progress = saved progress integer
//                           (0 on a fresh save, >= 1 once level 1 is beaten)
//   window.__qaInput()   -> [{ type: 'tap'|'down'|'move'|'up'|'wait', x, y, ms }]  CSS-px pointer
//                           actions that move the game forward from the current state (title -> play
//                           -> beat the level). [] = nothing to do yet; the checker polls again.
//   window.__qaOldSave() -> { save: '<old-version JSON string>', progress: <expected progress> }
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, resolve, extname, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const slug = args.find(a => !a.startsWith('--') && a !== opt('browsers'));
if (!slug) { console.error('usage: node tools/playables-check.mjs <slug> [--browsers chromium,firefox,webkit]'); process.exit(2); }
const DIR = join(ROOT, 'games', 'yt', slug);
const ZIP = join(ROOT, 'dist', 'playables', slug + '.zip');
const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const SHOTS = join(ROOT, 'studio', DATE, 'qa', 'playables');
const BROWSERS = (opt('browsers') || 'chromium,firefox,webkit').split(',');
const ENGINES = { chromium, firefox, webkit };
const SDK = 'https://www.youtube.com/game_api/v1';
const CSP = "default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:";
const VIEWPORTS = [
  { name: 'phone-portrait', width: 390, height: 844, dpr: 3, touch: true },
  { name: 'phone-landscape', width: 844, height: 390, dpr: 3, touch: true },
  { name: 'tablet-portrait', width: 820, height: 1180, dpr: 2, touch: true },
  { name: 'tablet-landscape', width: 1180, height: 820, dpr: 2, touch: true },
  { name: 'desktop-landscape', width: 1440, height: 900, dpr: 1, touch: false },
  { name: 'desktop-portrait', width: 900, height: 1440, dpr: 1, touch: false },
];
const LEVEL1_MS = 90000;

try { await stat(join(DIR, 'index.html')); } catch { console.error(`${relative(ROOT, DIR)}/index.html missing: run node tools/build-playables.mjs ${slug} first`); process.exit(2); }
await mkdir(SHOTS, { recursive: true });

// ------------------------------------------------------------ results
const COLS = [...BROWSERS, 'bundle'];
const results = new Map(); // check -> { must, cols: { col: { pass, notes[] } } }
function rec(check, col, pass, note = '', must = true) {
  if (!results.has(check)) results.set(check, { must, cols: {} });
  const r = results.get(check);
  const c = (r.cols[col] ||= { pass: true, notes: [] });
  if (pass === 'skip') { c.skip = true; if (note) c.notes.push(note); return; }
  c.pass = c.pass && !!pass;
  if (note && (!pass || c.notes.length < 1)) c.notes.push(note);
}

// ------------------------------------------------------------ server with the Playables CSP
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(DIR, p);
    if (!file.startsWith(DIR)) throw 0;
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-security-policy': CSP });
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------ in-page instrumentation
// Runs before any page script: tracks Esc preventDefault, window.open, CSP violations and AudioContexts.
function INIT(cfg) {
  window.__mockInit = cfg;
  const R = (window.__qaRec = { escPrevented: 0, open: [], csp: [], acs: [] });
  const pd = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    if (this.type && this.type.startsWith('key') && this.key === 'Escape') R.escPrevented++;
    return pd.call(this);
  };
  window.open = function (u) { R.open.push(String(u)); return null; };
  document.addEventListener('securitypolicyviolation', e => R.csp.push(`${e.violatedDirective} ${e.blockedURI}`), true);
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const A = window[k];
    if (!A) continue;
    const Wrapped = class extends A { constructor(...a) { super(...a); R.acs.push(this); } };
    window[k] = Wrapped;
  }
}
// The mock SDK, served at the real SDK URL.
const MOCK = `(() => {
  const cfg = window.__mockInit || { save: '', audio: true };
  const log = [];
  const L = (fn, arg) => log.push({ fn, t: performance.now(), arg });
  const subs = { pause: [], resume: [], audio: [] };
  let audio = cfg.audio !== false;
  const sub = (k, cb) => { subs[k].push(cb); return () => { subs[k] = subs[k].filter(f => f !== cb); }; };
  window.__mock = {
    log, save: cfg.save || '', loadT: null, scriptsAtLoad: document.scripts.length, sdkT: performance.now(),
    pause() { L('~pause'); subs.pause.forEach(f => f()); },
    resume() { L('~resume'); subs.resume.forEach(f => f()); },
    setAudio(b) { audio = b; L('~audio', b); subs.audio.forEach(f => f(b)); },
  };
  window.ytgame = {
    IN_PLAYABLES_ENV: true, SDK_VERSION: 'mock-1',
    game: {
      firstFrameReady() { L('firstFrameReady'); },
      gameReady() { L('gameReady'); },
      loadData() { L('loadData'); return new Promise(r => setTimeout(() => { window.__mock.loadT = performance.now(); L('loadData:resolved'); r(window.__mock.save); }, 50)); },
      saveData(s) {
        L('saveData', typeof s === 'string' ? s.length : -1);
        if (typeof s !== 'string') return Promise.reject(new Error('saveData needs a string'));
        window.__mock.save = s; return Promise.resolve();
      },
    },
    engagement: {
      sendScore(o) { L('sendScore', o && o.value); return Promise.resolve(); },
      openYTContent(o) { L('openYTContent', o); return Promise.resolve(); },
    },
    system: {
      isAudioEnabled() { return audio; },
      onAudioEnabledChange(cb) { return sub('audio', cb); },
      onPause(cb) { return sub('pause', cb); },
      onResume(cb) { return sub('resume', cb); },
      getLanguage() { return Promise.resolve('en'); },
    },
    health: { logError() { L('logError'); }, logWarning() { L('logWarning'); } },
    ads: { requestInterstitialAd() { L('ads'); return Promise.resolve(); } },
  };
})();`;

// ------------------------------------------------------------ helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLOWED = /^(data:|blob:|about:|https:\/\/fonts\.googleapis\.com\/|https:\/\/fonts\.gstatic\.com\/)/;

async function open(browser, bname, vp, { save = '', audio = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, hasTouch: vp.touch });
  await ctx.addInitScript(INIT, { save, audio });
  await ctx.route(SDK + '**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const s = { ctx, page, errors: [], csp: [], foreign: [], vp, bname };
  page.on('console', m => {
    const tx = m.text();
    if (/content[- ]security[- ]policy/i.test(tx)) s.csp.push(tx.slice(0, 160));
    else if (m.type() === 'error') s.errors.push(tx.slice(0, 200));
  });
  page.on('pageerror', e => s.errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith(ORIGIN) || u.startsWith(SDK) || ALLOWED.test(u)) return;
    s.foreign.push(u);
  });
  if (bname === 'chromium') s.cdp = await ctx.newCDPSession(page).catch(() => null);
  await page.goto(ORIGIN + '/?qa=1');
  s.ready = await page.waitForFunction(() => window.__mock && window.__mock.log.some(e => e.fn === 'gameReady') && typeof window.__qa === 'function', null, { timeout: 20000 }).then(() => true, () => false);
  return s;
}

// Collects the sandbox checks for a session and closes it.
async function close(s, label) {
  const { page } = s;
  const rq = await page.evaluate(() => ({ csp: window.__qaRec?.csp || [], open: window.__qaRec?.open || [], links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')), ads: (window.__mock?.log || []).filter(e => e.fn === 'ads' || e.fn === 'openYTContent').length })).catch(() => ({ csp: [], open: [], links: [], ads: 0 }));
  const b = s.bname;
  rec('no console errors', b, !s.errors.length, s.errors.length ? `${label}: ${s.errors[0]}` : '');
  rec('no CSP violations', b, !rq.csp.length && !s.csp.length, rq.csp[0] || s.csp[0] ? `${label}: ${rq.csp[0] || s.csp[0]}` : '');
  rec('no other-origin requests (Google Fonts ok)', b, !s.foreign.length, s.foreign.length ? `${label}: ${s.foreign[0]}` : '');
  rec('no window.open / <a href> / ads', b, !rq.open.length && !rq.links.length && !rq.ads, rq.open[0] || rq.links[0] || (rq.ads ? 'ads/openYTContent called' : ''));
  await s.ctx.close();
}

const qa = page => page.evaluate(() => window.__qa());
const mock = page => page.evaluate(() => ({ log: window.__mock.log, save: window.__mock.save, loadT: window.__mock.loadT, scripts: window.__mock.scriptsAtLoad }));
const acStates = page => page.evaluate(() => (window.__qaRec?.acs || []).map(a => a.state));

async function act(s, a) {
  const { page, vp } = s;
  if (a.type === 'wait') return sleep(a.ms || 100);
  const x = Math.max(1, Math.min(page.viewportSize().width - 1, a.x));
  const y = Math.max(1, Math.min(page.viewportSize().height - 1, a.y));
  if (vp.touch) {
    if (a.type === 'tap') return page.touchscreen.tap(x, y);
    if (s.cdp) {
      const type = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[a.type];
      return s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: a.type === 'up' ? [] : [{ x, y }] });
    }
    // Firefox/WebKit have no raw touch down/move/up in Playwright: synthesize touch pointer events.
    s.synthetic = true;
    return page.evaluate(([t, x, y]) => {
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(new PointerEvent('pointer' + t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 7, isPrimary: true, buttons: t === 'up' ? 0 : 1 }));
    }, [a.type, x, y]);
  }
  if (a.type === 'tap') return page.mouse.click(x, y);
  await page.mouse.move(x, y, a.type === 'move' ? { steps: 4 } : undefined);
  if (a.type === 'down') return page.mouse.down();
  if (a.type === 'up') return page.mouse.up();
}

// Performs the game's __qaInput() actions until until(state) holds or the time runs out.
async function drive(s, until, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await qa(s.page);
    if (until(st)) return st;
    const acts = (await s.page.evaluate(() => (window.__qaInput ? window.__qaInput() : []))) || [];
    for (const a of acts) await act(s, a);
    await sleep(acts.length ? 50 : 100);
  }
  return null;
}

// ------------------------------------------------------------ bundle checks (browser independent)
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push({ rel: relative(DIR, p), size: (await stat(p)).size });
  }
  return out;
}
{
  const files = await walk(DIR);
  const total = files.reduce((a, f) => a + f.size, 0);
  const bad = files.filter(f => f.rel.split('/').some(seg => !/^[a-z0-9_.-]+$/.test(seg)));
  const big = files.filter(f => f.size > 30 * 1024 * 1024);
  rec('bundle: file names [a-z0-9_.-]', 'bundle', !bad.length, bad[0]?.rel || `${files.length} files ok`);
  rec('bundle: file count <= 8000', 'bundle', files.length <= 8000, `${files.length} files`);
  rec('bundle: each file < 30 MiB', 'bundle', !big.length, big[0]?.rel || `largest ${(Math.max(...files.map(f => f.size)) / 1024).toFixed(0)} KiB`);
  rec('bundle: total < 30 MiB (MUST), < 15 MiB (target)', 'bundle', total < 30 * 1024 * 1024, `${(total / 1024).toFixed(0)} KiB`);
  const html = await readFile(join(DIR, 'index.html'), 'utf8');
  const first = html.match(/<script\b[^>]*>/i)?.[0] || '';
  rec('SDK script is the first script', 'bundle', first.includes(`src="${SDK}"`) && !/\b(async|defer|type=)/.test(first), first);
  rec('index.html has no site chrome', 'bundle', !/site\.css|build:(head|body)|og:|application\/ld\+json|<a\b/i.test(html));
  let zipOk = false, note = 'zip missing';
  try {
    const list = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').filter(Boolean);
    zipOk = list.includes('index.html') && list.filter(f => !f.endsWith('/')).length === files.length;
    note = `${list.filter(f => !f.endsWith('/')).length} files, ${((await stat(ZIP)).size / 1024).toFixed(0)} KiB`;
  } catch {}
  rec('zip: index.html at root, matches build', 'bundle', zipOk, note);
}

// ------------------------------------------------------------ per-browser scenarios
const notes = [];
for (const bname of BROWSERS) {
  let browser;
  try {
    browser = await ENGINES[bname].launch();
  } catch (e) {
    notes.push(`${bname}: SKIP (could not launch: ${e.message.split('\n')[0]})`);
    for (const r of results.values()) (r.cols[bname] ||= { pass: true, notes: [] }).skip = true;
    continue;
  }
  console.log(`\n== ${bname}`);
  let audioWorks = false;

  // 1. Every viewport: boot timing, SDK order, screenshots of the title and mid-level.
  for (const vp of VIEWPORTS) {
    const s = await open(browser, bname, vp);
    const tag = `${bname} ${vp.name}`;
    rec('boots to gameReady with __qa (ready < 20 s)', bname, s.ready, s.ready ? '' : `${vp.name}: no gameReady/__qa`);
    if (!s.ready) { await close(s, vp.name); continue; }
    const m = await mock(s.page);
    const ff = m.log.find(e => e.fn === 'firstFrameReady'), gr = m.log.find(e => e.fn === 'gameReady');
    rec('SDK loads before any game code', bname, m.scripts === 1, `${vp.name}: ${m.scripts} script(s) parsed before the SDK ran`);
    rec('firstFrameReady before gameReady', bname, ff && gr && ff.t <= gr.t, ff ? '' : `${vp.name}: no firstFrameReady`);
    rec('gameReady within 5 s', bname, gr && gr.t < 5000, `${vp.name}: ${gr ? (gr.t / 1000).toFixed(2) + ' s' : 'never'}`);
    rec('P.env is yt', bname, (await s.page.evaluate(() => window.__P?.env ?? window.__qa().env)) === 'yt', vp.name, false);
    await sleep(400);
    await s.page.screenshot({ path: join(SHOTS, `${slug}-${bname}-${vp.name}-1-title.png`) });
    const st = await drive(s, q => q.mode === 'play', 15000);
    rec('reaches play by ' + 'touch/mouse at every size', bname, !!st, st ? '' : `${vp.name}: never reached mode 'play'`);
    await sleep(500);
    await s.page.screenshot({ path: join(SHOTS, `${slug}-${bname}-${vp.name}-2-play.png`) });
    await close(s, vp.name);
    process.stdout.write(`  ${tag} ok\n`);
  }

  // 2. Touch-only functional run on a phone: Esc, live resize, pause, audio flag, level 1, save, score.
  const phone = VIEWPORTS[0];
  let saved = '', progress = 0, oldSave = null;
  {
    const s = await open(browser, bname, phone);
    const { page } = s;
    const st0 = s.ready && (await drive(s, q => q.mode === 'play', 15000));
    if (!st0) rec('touch-only completes level 1', bname, false, 'never reached play');
    else {
      oldSave = await page.evaluate(() => (window.__qaOldSave ? window.__qaOldSave() : null));
      // Esc
      await page.keyboard.press('Escape');
      rec('Esc is not default-prevented', bname, (await page.evaluate(() => window.__qaRec.escPrevented)) === 0);
      // Live resize mid-level
      const a = await qa(page);
      for (const [w, h, n] of [[844, 390, 'landscape'], [640, 640, 'square'], [390, 844, 'portrait']]) {
        await page.setViewportSize({ width: w, height: h });
        await sleep(350);
        if (n !== 'portrait') await page.screenshot({ path: join(SHOTS, `${slug}-${bname}-resize-${n}.png`) });
      }
      const b = await qa(page);
      rec('live resize mid-level keeps state', bname, b.mode === a.mode && b.level === a.level && b.t >= a.t && (a.score === undefined || b.score === a.score), `mode ${a.mode}->${b.mode}, level ${a.level}->${b.level}, t ${a.t.toFixed(2)}->${b.t.toFixed(2)}`);
      // Pause / resume
      await sleep(300);
      const before = await acStates(page);
      audioWorks ||= before.includes('running');
      await page.evaluate(() => window.__mock.pause());
      await sleep(300);
      const t1 = (await qa(page)).t;
      await sleep(700);
      const t2 = (await qa(page)).t;
      const paused = await acStates(page);
      rec('pause freezes game time', bname, t1 === t2, `t ${t1.toFixed(3)} -> ${t2.toFixed(3)}`);
      rec('pause stops audio (no AudioContext running)', bname, !paused.includes('running'), `states: ${paused.join(',') || 'no AudioContext'}`);
      await page.evaluate(() => window.__mock.resume());
      await sleep(700);
      const t3 = (await qa(page)).t;
      const resumed = await acStates(page);
      rec('resume restores game time', bname, t3 > t2, `t ${t2.toFixed(3)} -> ${t3.toFixed(3)}`);
      if (before.includes('running')) rec('resume restores audio', bname, resumed.includes('running'), `states: ${resumed.join(',')}`);
      else rec('resume restores audio', bname, 'skip', `audio never ran in ${bname} headless (states: ${before.join(',') || 'none'})`);
      // Audio flag toggled live
      await page.evaluate(() => window.__mock.setAudio(false));
      await sleep(400);
      const off = await acStates(page);
      rec('audio flag off = silence (live)', bname, !off.includes('running'), `states: ${off.join(',') || 'none'}`);
      await page.evaluate(() => window.__mock.setAudio(true));
      await sleep(400);
      const on = await acStates(page);
      if (before.includes('running')) rec('audio flag back on restores sound', bname, on.includes('running'), `states: ${on.join(',')}`);
      else rec('audio flag back on restores sound', bname, 'skip', 'audio never ran headless');
      // Level 1 by touch only
      const won = await drive(s, q => q.progress >= 1, LEVEL1_MS);
      rec('touch-only completes level 1', bname, !!won, won ? `progress ${won.progress}` : 'timed out');
      if (s.synthetic) rec('touch-only completes level 1', bname, true, 'down/move/up were synthetic pointer events (no raw touch API)');
      await page.screenshot({ path: join(SHOTS, `${slug}-${bname}-phone-level1-won.png`) });
      await sleep(1500); // let the debounced save land
      const m = await mock(page);
      const saves = m.log.filter(e => e.fn === 'saveData');
      const ld = m.log.find(e => e.fn === 'loadData');
      rec('loadData awaited before the first saveData', bname, !!ld && (!saves.length || (m.loadT != null && saves[0].t >= m.loadT)), saves.length ? `first save ${saves[0].t.toFixed(0)} ms, load resolved ${m.loadT?.toFixed(0)} ms` : 'no saves');
      rec('save written after level 1', bname, saves.length > 0 && !!m.save, `${saves.length} saveData calls`);
      rec('save < 500 KiB', bname, Math.max(0, ...saves.map(e => e.arg)) < 500 * 1024, `max ${Math.max(0, ...saves.map(e => e.arg))} chars`);
      const scores = m.log.filter(e => e.fn === 'sendScore').map(e => e.arg);
      let bestSaved = null;
      try { bestSaved = JSON.parse(m.save).best; } catch {}
      rec('sendScore integers; last = saved best', bname, scores.length > 0 && scores.every(Number.isInteger) && scores.at(-1) === bestSaved, `sent [${scores.join(',')}], saved best ${bestSaved}`);
      saved = m.save;
      progress = won ? won.progress : 0;
    }
    await close(s, 'touch run');
  }

  // 3. Reload with the mock save restores progress.
  if (saved) {
    const s = await open(browser, bname, phone, { save: saved });
    const q = s.ready ? await qa(s.page) : null;
    rec('reload with mock save restores progress', bname, !!q && q.progress >= progress && progress >= 1, q ? `progress ${q.progress} (was ${progress})` : 'no gameReady');
    await close(s, 'reload');
  } else rec('reload with mock save restores progress', bname, false, 'nothing was saved');

  // 4. An old-version save migrates.
  if (oldSave) {
    const s = await open(browser, bname, phone, { save: oldSave.save });
    const q = s.ready ? await qa(s.page) : null;
    await sleep(1300);
    const m = await mock(s.page);
    let vNew = null, vOld = null;
    try { vNew = JSON.parse(m.save).v; vOld = JSON.parse(oldSave.save).v; } catch {}
    rec('old-version save migrates', bname, !!q && q.progress === oldSave.progress && vNew > vOld, q ? `progress ${q.progress} (want ${oldSave.progress}), v ${vOld} -> ${vNew}` : 'no gameReady');
    await close(s, 'old save');
  } else rec('old-version save migrates', bname, false, 'game has no window.__qaOldSave()');

  // 5. A corrupt save falls back to defaults without errors.
  {
    const s = await open(browser, bname, phone, { save: '{"v":1,bro' });
    const q = s.ready ? await qa(s.page) : null;
    rec('corrupt save falls back to a fresh game', bname, !!q && q.progress === 0, q ? `progress ${q.progress}` : 'no gameReady');
    await close(s, 'corrupt save');
  }

  // 6. Audio flag off from the start: playing stays silent; turning it on brings sound.
  {
    const s = await open(browser, bname, phone, { audio: false });
    if (s.ready) {
      await drive(s, q => q.mode === 'play', 15000);
      await drive(s, () => false, 1500); // keep tapping a while
      const st = await acStates(s.page);
      rec('audio flag off at load = silence', bname, !st.includes('running'), `states: ${st.join(',') || 'no AudioContext'}`);
      await s.page.evaluate(() => window.__mock.setAudio(true));
      await sleep(500);
      await drive(s, () => false, 600);
      const on = await acStates(s.page);
      if (audioWorks) rec('audio flag back on restores sound', bname, on.includes('running'), `after load with audio off: ${on.join(',') || 'none'}`);
    } else rec('audio flag off at load = silence', bname, false, 'no gameReady');
    await close(s, 'audio off');
  }

  // 7. Mouse-only run on desktop.
  {
    const s = await open(browser, bname, VIEWPORTS[4]);
    const won = s.ready && (await drive(s, q => q.progress >= 1, LEVEL1_MS));
    rec('mouse-only completes level 1', bname, !!won, won ? `progress ${won.progress}` : 'timed out');
    await s.page.screenshot({ path: join(SHOTS, `${slug}-${bname}-desktop-level1-won.png`) });
    await close(s, 'mouse run');
  }
  await browser.close();
}
server.close();

// ------------------------------------------------------------ report
const w = Math.max(...[...results.keys()].map(k => k.length)) + 2;
const cell = c => (!c ? '-' : c.skip && c.pass ? 'SKIP' : c.pass ? 'PASS' : 'FAIL');
console.log(`\nPlayables check: ${slug}   (screenshots: ${relative(ROOT, SHOTS)}/)\n`);
console.log('check'.padEnd(w) + COLS.map(c => c.padEnd(10)).join('') + 'must');
let failed = 0;
for (const [k, r] of results) {
  const line = k.padEnd(w) + COLS.map(c => cell(r.cols[c]).padEnd(10)).join('') + (r.must ? 'MUST' : 'should');
  console.log(line);
  for (const c of COLS) {
    const x = r.cols[c];
    if (!x) continue;
    if (!x.pass && r.must) failed++;
    if (!x.pass || x.skip) for (const n of x.notes.slice(0, 2)) console.log('    ' + c + ': ' + n);
  }
}
for (const n of notes) console.log('note: ' + n);
console.log(failed ? `\n${failed} MUST failure(s)` : '\nALL MUST CHECKS PASS');
process.exit(failed ? 1 : 0);
