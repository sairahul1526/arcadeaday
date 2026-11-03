// Slurp Pot QA runner (Meta/QA, GDD §13.1 / §13.7). Drives the real game through the ?qa=1 hooks of games/slurp-pot/modes.js.
//
//   node tools/slurp-pot/qa-run.mjs                      default gate: modules, boot, L1, save, pause, screenshots, perf
//   node tools/slurp-pot/qa-run.mjs --sweep              also run a bot over L1..L10 (greedy) via the qa hooks
//   node tools/slurp-pot/qa-run.mjs --only l1,shots      pick sections: modules boot l1 save shots perf sweep
//   node tools/slurp-pot/qa-run.mjs --browsers chromium  chromium,firefox,webkit (default: all three, headless)
//   node tools/slurp-pot/qa-run.mjs --gpu                headed Chromium with GPU flags (the only honest fps, PLAYBOOK lesson)
//   options: --trace (print state every 4 s while playing)  --root <dir> --slug <dir> (serve another web root, used by the stub harness)  --levels 1-10  --kind greedy|planner|casual|average|expert  --l1-secs 60  --port 8735  --out studio/2026-11-03/qa
//
// Sections
//   modules  every module file of the GDD §13.1 map exists under games/slurp-pot (explains most boot failures)
//   boot     page reaches window.__qa within 20 s with no console error, lands on the title screen
//   l1       L1 completes through __qaInput only: phone 390x844 (touch only) and desktop 1440x900 (mouse only), <= 60 s wall
//   pause    KeyP in play: screen 'pause', __qa().t frozen for 0.9 s, then resumes and keeps going
//   save     progress survives a reload; the old-version save migrates to progress 2; a corrupt save gives progress 0
//   shots    PNGs at 390x844, 360x640, 820x1180, 1440x900 into studio/2026-11-03/qa/ (title, map, daily, feast, shop,
//            cookbook, settings, play, pause, win, fail) + a live-resize rotation check. READ the PNGs: the canvas text
//            cannot be linted, so overlap / clipping is judged by eye.
//   perf     ?tier=mid and ?tier=low at 4x CPU throttle on the phone profile; median fps >= 50 is a PASS only with --gpu
//            (headless WebGL is SwiftShader, so without --gpu the row is INFO, "unmeasured")
//   sweep    greedy bot (or --kind) over the levels through __qaBot / __qaLevel / __qaAdvance
//
// Exit code 1 when any row is FAIL. A PASS/FAIL table is printed and written to <out>/qa-run-latest.txt and .json.
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
const argvEarly = process.argv.slice(2);
const optEarly = (k, d) => { const i = argvEarly.indexOf('--' + k); return i >= 0 && argvEarly[i + 1] && !argvEarly[i + 1].startsWith('--') ? argvEarly[i + 1] : d; };
const GAMES = resolve(ROOT, optEarly('root', 'games')); // web root (--root lets the unit harness serve a stub)
const SLUG = optEarly('slug', 'slurp-pot');

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (flag('help') || flag('h')) {
  console.log(process.argv[1], '- see the header of this file for options');
  process.exit(0);
}
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = (opt('browsers', 'chromium,firefox,webkit')).split(',').map(s => s.trim()).filter(b => ENGINES[b]);
const ALL = ['modules', 'boot', 'l1', 'pause', 'save', 'shots', 'perf', 'sweep'];
const DEFAULT = ['modules', 'boot', 'l1', 'pause', 'save', 'shots', 'perf'];
let SECTIONS = opt('only') ? opt('only').split(',').map(s => s.trim()).filter(s => ALL.includes(s)) : DEFAULT.slice();
if (flag('sweep') && !SECTIONS.includes('sweep')) SECTIONS.push('sweep');
const GPU = flag('gpu');
const TRACE = flag('trace');
const PORT = +opt('port', 8735);
const OUT = resolve(ROOT, opt('out', 'studio/2026-11-03/qa'));
const L1_MS = +opt('l1-secs', 60) * 1000;
const KIND = opt('kind', 'greedy');
const [LV_A, LV_B] = (opt('levels', '1-10')).split('-').map(Number);
const LEVELS = Array.from({ length: Math.max(1, (LV_B || LV_A) - LV_A + 1) }, (_, i) => LV_A + i);
const has = s => SECTIONS.includes(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// ------------------------------------------------------------------ profiles
const PHONE = { name: 'phone', width: 390, height: 844, dpr: 2, touch: true };
const DESKTOP = { name: 'desktop', width: 1440, height: 900, dpr: 1, touch: false };
const SHOT_SIZES = [
  PHONE,
  { name: 'phone-small', width: 360, height: 640, dpr: 2, touch: true },
  { name: 'tablet', width: 820, height: 1180, dpr: 2, touch: true },
  DESKTOP,
];
const MODULES = ['index.html', 'game.js', 'consts.js', 'bus.js', 'input.js', 'meta.js', 'modes.js', 'layout.js', 'ui.js', 'logic.js', 'levels.js',
  'levels-data.js', 'dailies-data.js', 'catalog.js', 'render3d.js', 'props.js', 'audio.js', 'bots.js', 'feast.js', 'vendor/three.bundle.js'];

// ------------------------------------------------------------------ static server (games/ is the web root so ../shared/ resolves)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.wasm': 'application/wasm', '.txt': 'text/plain' };
function startServer(port) {
  return new Promise((res, rej) => {
    const srv = createServer(async (req, rsp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const f = normalize(join(GAMES, p));
        if (f !== GAMES && !f.startsWith(GAMES + sep)) { rsp.writeHead(403); return rsp.end(); }
        const body = await readFile(f);
        rsp.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
        rsp.end(body);
      } catch { rsp.writeHead(404); rsp.end(); }
    });
    srv.once('error', e => { if (e.code === 'EADDRINUSE') { srv.listen(0); } else rej(e); });
    srv.once('listening', () => res({ srv, port: srv.address().port }));
    srv.listen(port);
  });
}

// ------------------------------------------------------------------ results
const results = [];
function rec(section, bname, prof, ok, detail = '', status) {
  const st = status || (ok ? 'PASS' : 'FAIL');
  results.push({ section, bname, prof, status: st, detail: String(detail) });
  console.log(`${st.padEnd(4)}  ${section.padEnd(8)} ${bname.padEnd(9)} ${String(prof).padEnd(11)} ${detail}`);
}

// ------------------------------------------------------------------ browser session
let ORIGIN = '';
async function launch(bname) {
  if (bname === 'chromium' && GPU) return chromium.launch({ headless: false, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  return ENGINES[bname].launch();
}
async function open(browser, bname, prof, { query = 'qa=1', save = null, wait = true } = {}) {
  const o = { viewport: { width: prof.width, height: prof.height }, deviceScaleFactor: prof.dpr, hasTouch: prof.touch, isMobile: prof.touch && bname !== 'firefox' };
  let ctx;
  try { ctx = await browser.newContext(o); } catch { delete o.isMobile; ctx = await browser.newContext(o); }
  if (save != null) {
    // the web build keeps its save under sp_save (platform.js store prefix + 'save'); inject once per tab, before any game script
    await ctx.addInitScript(({ v }) => { try { if (!sessionStorage.getItem('__qa_inj')) { sessionStorage.setItem('__qa_inj', '1'); localStorage.setItem('sp_save', v); } } catch {} }, { v: save });
  }
  const page = await ctx.newPage();
  const s = { ctx, page, prof, bname, errors: [], logs: [], px: 0, py: 0, cdp: null, t0: Date.now() };
  page.on('console', m => { s.logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); if (m.type() === 'error') s.errors.push(m.text().slice(0, 240)); });
  page.on('requestfailed', r => s.errors.push(`request failed ${r.url().replace(ORIGIN, '')} ${r.failure() && r.failure().errorText}`));
  page.on('pageerror', e => s.errors.push('pageerror: ' + String(e.message).slice(0, 240)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/i.test(r.url())) s.errors.push(`HTTP ${r.status()} ${r.url().replace(ORIGIN, '')}`); });
  if (bname === 'chromium') s.cdp = await ctx.newCDPSession(page).catch(() => null);
  await page.goto(`${ORIGIN}/${SLUG}/?${query}`);
  if (wait) {
    s.ready = await page.waitForFunction(() => typeof window.__qa === 'function', null, { timeout: 20000 }).then(() => true, () => false);
    s.bootMs = Date.now() - s.t0;
  }
  return s;
}
const qa = page => page.evaluate(() => (window.__qa ? window.__qa() : null)).catch(() => null);

// Same step semantics as tools/playables-check.mjs: touch uses CDP touch events on Chromium and synthetic touch pointer events
// elsewhere (Playwright has no raw touch down/move/up there); mouse uses page.mouse.
async function act(s, a) {
  const { page, prof } = s;
  if (a.type === 'wait') return sleep(a.ms || 100);
  const vp = page.viewportSize();
  if (a.type !== 'up') { s.px = clamp(a.x, 1, vp.width - 1); s.py = clamp(a.y, 1, vp.height - 1); }
  const x = s.px, y = s.py;
  if (prof.touch) {
    if (a.type === 'tap') return page.touchscreen.tap(x, y);
    if (s.cdp) {
      // CDP keeps the touch point alive until touchEnd; a second touchStart on a live point makes no new pointerdown, so close it first
      if (a.type === 'down' && s.touching) await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (a.type === 'move' && !s.touching) { await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); s.touching = true; return; }
      if (a.type === 'up' && !s.touching) return;
      s.touching = a.type !== 'up';
      const type = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[a.type];
      return s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: a.type === 'up' ? [] : [{ x, y }] });
    }
    return page.evaluate(([t, x, y]) => {
      const el = document.getElementById('ui') || document.elementFromPoint(x, y) || document.body;
      const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' }[t];
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: t === 'up' ? 0 : 1 }));
    }, [a.type, x, y]);
  }
  if (a.type === 'tap') return page.mouse.click(x, y);
  if (a.type === 'up') return page.mouse.up();
  await page.mouse.move(x, y, a.type === 'move' ? { steps: 3 } : undefined);
  if (a.type === 'down') return page.mouse.down();
}

/** Performs __qaInput() steps until until(state) holds or ms elapse. Returns { ok, ms, last, path }. */
async function drive(s, until, ms, hook) {
  const t0 = Date.now(), path = [];
  let last = null;
  while (Date.now() - t0 < ms) {
    let steps = [];
    try { steps = (await s.page.evaluate(() => window.__qaInput())) || []; } catch (e) { return { ok: false, ms: Date.now() - t0, last, path, why: 'qaInput threw: ' + e.message }; }
    for (const a of steps) { try { await act(s, a); } catch (e) { return { ok: false, ms: Date.now() - t0, last, path, why: 'act failed: ' + e.message }; } }
    last = await qa(s.page);
    if (!last) return { ok: false, ms: Date.now() - t0, last, path, why: '__qa() returned nothing' };
    if (path[path.length - 1] !== last.screen) path.push(last.screen);
    if (TRACE && Date.now() - (s.lastTrace || 0) > 4000) { s.lastTrace = Date.now(); console.log(`      [trace ${s.bname}/${s.prof.name} ${((Date.now() - t0) / 1000).toFixed(0)}s] screen ${last.screen} t ${last.t.toFixed(1)} items ${last.items} r ${last.r.toFixed(2)}/${last.needR.toFixed(2)} bar ${last.bar.toFixed(2)} tLeft ${last.tLeft.toFixed(1)} fps ${last.fps} steps ${steps.map(a => a.type).join('+') || '-'}`); }
    if (until(last)) return { ok: true, ms: Date.now() - t0, last, path };
    if (hook) { const r = await hook(last); if (r === 'abort') return { ok: false, ms: Date.now() - t0, last, path, why: 'hook aborted' }; }
    await sleep(steps.length ? 50 : 100);
  }
  return { ok: false, ms: Date.now() - t0, last, path, why: 'timeout' };
}
const why = r => {
  const l = r.last;
  if (!l) return r.why || 'no state';
  return `${r.why || 'stuck'}: screen ${l.screen}, path ${r.path.join('>')}, t ${l.t.toFixed(1)}, items ${l.items}, r ${l.r.toFixed(2)}/${l.needR.toFixed(2)}, boss ${l.bossState || '-'}, tLeft ${l.tLeft.toFixed(1)}, result ${l.result}, progress ${l.progress}`;
};
const errs = s => (s.errors.length ? `${s.errors.length} console error(s), first: ${s.errors[0]}` : '');
async function shot(s, name) {
  const f = join(OUT, name);
  await s.page.screenshot({ path: f });
  return f;
}

// ------------------------------------------------------------------ sections
async function secModules() {
  const missing = [];
  for (const m of MODULES) if (!existsSync(join(GAMES, SLUG, m))) missing.push(m);
  rec('modules', '-', '-', !missing.length, missing.length ? `missing ${missing.length}/${MODULES.length}: ${missing.join(', ')}` : `all ${MODULES.length} present`);
  return missing;
}

async function secBoot(browser, bname, prof) {
  const s = await open(browser, bname, prof);
  const q = s.ready ? await qa(s.page) : null;
  const fb = s.ready ? await s.page.evaluate(() => window.__spFallbacks || []).catch(() => []) : [];
  const boot = s.ready ? null : await s.page.evaluate(() => ({ ready: document.readyState, qa: typeof window.__qa, spMode: typeof window.__spMode, canvases: document.querySelectorAll('canvas').length, body: (document.body && document.body.innerText || '').slice(0, 120) })).catch(e => ({ probeFailed: String(e.message).slice(0, 80) }));
  const okBoot = s.ready && !s.errors.length && q && q.screen === 'title';
  rec('boot', bname, prof.name, okBoot, s.ready
    ? `__qa ready in ${s.bootMs} ms, screen ${q && q.screen}, tier ${q && q.tier || '?'}, ${errs(s) || 'no console errors'}${fb.length ? ', fallbacks: ' + fb.join('+') : ''}`
    : `no window.__qa after 20 s (game.js did not reach modes.install). ${errs(s) || 'no console error captured'}${s.logs.length ? ' | page log: ' + s.logs.slice(-6).join(' // ') : ''}${boot ? ' | probe: ' + JSON.stringify(boot) : ''}`);
  await s.ctx.close();
  return s.ready;
}

async function playL1(browser, bname, prof, { alsoPause = false } = {}) {
  const s = await open(browser, bname, prof);
  const tag = `${bname}-${prof.name}`;
  if (!s.ready) {
    rec('l1', bname, prof.name, false, 'no window.__qa; see boot row. ' + errs(s));
    await s.ctx.close();
    return null;
  }
  await s.page.evaluate(() => window.__qaSkip && window.__qaSkip());
  let pausedDone = !alsoPause, pauseInfo = null;
  const hook = async last => {
    if (pausedDone || last.screen !== 'play' || last.t < 1.5 || last.result) return;
    pausedDone = true;
    pauseInfo = await pauseCheck(s);
  };
  const r = await drive(s, q => q.progress >= 1, L1_MS, alsoPause ? hook : null);
  const sec = r.ms / 1000;
  const ok = r.ok && sec <= L1_MS / 1000 && !s.errors.length;
  let detail;
  if (r.ok) detail = `L1 done in ${sec.toFixed(1)} s wall, sim t ${r.last.t.toFixed(1)} s (limit ${L1_MS / 1000}), path ${r.path.join('>')}, stars ${r.last.stars}, score ${r.last.score}, coins ${r.last.coins}${errs(s) ? ', ' + errs(s) : ''}`;
  else detail = why(r) + (errs(s) ? '; ' + errs(s) : '');
  // Headless chromium renders WebGL in software (SwiftShader), often below 10 fps on a loaded machine: a timeout there says
  // nothing about the game (it passes under --gpu and on firefox/webkit), so it is reported as INFO, never hidden.
  const softGl = !ok && !r.ok && bname === 'chromium' && !GPU && !s.errors.length && r.last && r.last.fps > 0 && r.last.fps < 20;
  if (softGl) rec('l1', bname, prof.name, true, `UNMEASURED (software GL ${r.last.fps} fps, run with --gpu): ${detail}`, 'INFO');
  else rec('l1', bname, prof.name, ok, detail);
  if (!r.ok) { try { await shot(s, `l1-stuck-${tag}.png`); } catch {} }
  if (pauseInfo) rec('pause', bname, prof.name, pauseInfo.ok, pauseInfo.detail);
  else if (alsoPause) rec('pause', bname, prof.name, false, 'play never reached t > 1.5 s, pause not exercised');
  return { s, r };
}

/** KeyP in play: 'pause' screen, sim time frozen for 0.9 s, KeyP again resumes. The pointer stays "down"; modes.js re-presses. */
async function pauseCheck(s) {
  const p = s.page;
  await p.keyboard.press('KeyP');
  await sleep(250);
  const a = await qa(p);
  await sleep(900);
  const b = await qa(p);
  await p.keyboard.press('KeyP');
  await sleep(700);
  const c = await qa(p);
  const frozen = a && b && a.t === b.t;
  const shown = a && a.screen === 'pause' && a.paused === true;
  const resumed = c && c.screen === 'play' && c.t > b.t;
  return {
    ok: !!(frozen && shown && resumed),
    detail: `screen ${a && a.screen}/${a && a.paused}, t ${a && a.t.toFixed(3)} -> ${b && b.t.toFixed(3)} (${frozen ? 'frozen' : 'MOVED'}), after resume screen ${c && c.screen}, t ${c && c.t.toFixed(2)}`,
  };
}

async function secL1(browser, bname) {
  const res = [];
  res.push(await playL1(browser, bname, PHONE, { alsoPause: has('pause') }));
  res.push(await playL1(browser, bname, DESKTOP));
  return res;
}

async function secSave(browser, bname, l1res) {
  const ph = l1res && l1res[0];
  // 1. progress survives a reload (the L1 session just won; a debounced save must have been flushed)
  if (ph && ph.r && ph.r.ok) {
    const before = ph.r.last.progress;
    await ph.s.page.reload();
    const ready = await ph.s.page.waitForFunction(() => typeof window.__qa === 'function', null, { timeout: 20000 }).then(() => true, () => false);
    const q = ready ? await qa(ph.s.page) : null;
    rec('save', bname, 'phone', !!q && q.progress >= before && before >= 1, q ? `after reload progress ${q.progress} (was ${before}), score ${q.score}, coins ${q.coins}` : 'no __qa after reload');
  } else rec('save', bname, 'phone', false, 'reload test skipped: L1 did not complete');
  for (const x of l1res || []) if (x && x.s) await x.s.ctx.close().catch(() => {});
  // 2. the old-version save migrates; 3. a corrupt save falls back to a fresh game
  const probe = await open(browser, bname, PHONE);
  const old = probe.ready ? await probe.page.evaluate(() => (window.__qaOldSave ? window.__qaOldSave() : null)) : null;
  await probe.ctx.close();
  if (!old) { rec('save', bname, 'phone', false, 'no window.__qaOldSave()'); return; }
  let s = await open(browser, bname, PHONE, { save: old.save });
  let q = s.ready ? await qa(s.page) : null;
  const stored = s.ready ? await s.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sp_save')); } catch { return null; } }) : null;
  rec('save', bname, 'phone', !!q && q.progress === old.progress && (!stored || stored.v >= 1) && !s.errors.length,
    q ? `old-save migrates: progress ${q.progress} (want ${old.progress}), stored v ${stored ? stored.v : '?'}${errs(s) ? ', ' + errs(s) : ''}` : 'no __qa with the old save');
  await s.ctx.close();
  s = await open(browser, bname, PHONE, { save: '{not json' });
  q = s.ready ? await qa(s.page) : null;
  rec('save', bname, 'phone', !!q && q.progress === 0 && !s.errors.length, q ? `corrupt save: progress ${q.progress} (want 0), screen ${q.screen}${errs(s) ? ', ' + errs(s) : ''}` : 'no __qa with a corrupt save');
  await s.ctx.close();
}

async function secShots(browser, bname) {
  await mkdir(OUT, { recursive: true });
  for (const sz of SHOT_SIZES) {
    const s = await open(browser, bname, sz);
    const tag = `${sz.width}x${sz.height}`;
    if (!s.ready) { rec('shots', bname, tag, false, 'no __qa; ' + errs(s)); await s.ctx.close(); continue; }
    const got = [];
    const snap = async (name, want) => {
      await sleep(550);
      const q = await qa(s.page);
      await shot(s, `${name}-${tag}.png`);
      got.push(`${name}${want && q && q.screen !== want ? '(' + (q && q.screen) + '!)' : ''}`);
      return q;
    };
    await s.page.evaluate(() => window.__qaSkip());
    await snap('title', 'title');
    for (const n of ['map', 'daily', 'feast', 'shop', 'cookbook', 'settings']) {
      await s.page.evaluate(n => window.__qaScreen(n), n);
      await snap(n, n);
    }
    await s.page.evaluate(() => { window.__qaBot(true, 'greedy'); window.__qaLevel(1); });
    await sleep(2500);
    await snap('play', 'play');
    await s.page.keyboard.press('KeyP');
    await snap('pause', 'pause');
    await s.page.keyboard.press('KeyP');
    await s.page.evaluate(() => window.__qaWin());
    await snap('win', 'win');
    await s.page.evaluate(() => window.__qaLevel(1));
    await s.page.evaluate(() => window.__qaFail('timeout'));
    await snap('fail', 'fail');
    // live resize: rotate while playing, then back; the page must not scroll or throw
    await s.page.evaluate(() => { window.__qaBot(true, 'greedy'); window.__qaLevel(1); });
    await sleep(800);
    await s.page.setViewportSize({ width: sz.height, height: sz.width });
    await sleep(700);
    const rot = await qa(s.page);
    await shot(s, `play-rotated-${sz.height}x${sz.width}.png`);
    const scroll = await s.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
    await s.page.setViewportSize({ width: sz.width, height: sz.height });
    await sleep(500);
    const back = await qa(s.page);
    const noScroll = scroll.sw <= scroll.iw + 1 && scroll.sh <= scroll.ih + 1;
    rec('shots', bname, tag, !s.errors.length && !!rot && !!back && ['play', 'win', 'fail'].includes(back.screen) && noScroll,
      `${got.length} screens: ${got.join(' ')}; rotate ${rot && rot.screen}->${back && back.screen}${noScroll ? '' : ', PAGE SCROLLS ' + JSON.stringify(scroll)}${errs(s) ? ', ' + errs(s) : ', no console errors'}`);
    await s.ctx.close();
  }
}

async function secPerf(browser, bname) {
  for (const tier of ['mid', 'low']) {
    const s = await open(browser, bname, PHONE, { query: `qa=1&tier=${tier}` });
    if (!s.ready) { rec('perf', bname, `tier ${tier}`, false, 'no __qa; ' + errs(s)); await s.ctx.close(); continue; }
    if (s.cdp) await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await s.page.evaluate(() => { window.__qaSkip(); window.__qaBot(true, 'greedy'); window.__qaLevel(1); });
    const d = await s.page.evaluate(() => new Promise(res => {
      const a = []; let last = performance.now(); const t0 = last;
      const f = now => { a.push(now - last); last = now; if (now - t0 < 10000) requestAnimationFrame(f); else res(a); };
      requestAnimationFrame(f);
    }));
    const q = await qa(s.page);
    const m = med(d.slice(5)), fps = m > 0 ? 1000 / m : 0;
    const long = d.filter(x => x > 50).length;
    const p95 = d.slice().sort((x, y) => x - y)[Math.floor(d.length * 0.95)] || 0;
    const detail = `4x CPU throttle: median ${fps.toFixed(1)} fps (${m.toFixed(1)} ms), p95 ${p95.toFixed(0)} ms, ${long} frames > 50 ms of ${d.length}; render.stats fps ${q ? q.fps : '?'}, tier ${q ? q.tier : '?'}, dpr ${q ? q.dpr : '?'}, draw calls ${q ? q.drawCalls : '?'}`;
    if (GPU && bname === 'chromium') rec('perf', bname, `tier ${tier}`, fps >= 50 && !s.errors.length, detail + (errs(s) ? '; ' + errs(s) : ''));
    else rec('perf', bname, `tier ${tier}`, true, 'UNMEASURED (software GL, run with --gpu): ' + detail, s.errors.length ? 'FAIL' : 'INFO');
    await s.ctx.close();
  }
}

async function secSweep(browser, bname) {
  const s = await open(browser, bname, PHONE);
  if (!s.ready) { rec('sweep', bname, 'phone', false, 'no __qa; ' + errs(s)); await s.ctx.close(); return; }
  await s.page.evaluate(() => window.__qaSkip());
  const rows = [];
  for (const n of LEVELS) {
    const t0 = Date.now();
    const started = await s.page.evaluate(([n, k]) => { window.__qaBot(true, k); return window.__qaLevel(n); }, [n, KIND]);
    if (!started) { rec('sweep', bname, `L${n} ${KIND}`, false, 'qaLevel refused to start the level'); continue; }
    let q = null, ticks = 0;
    for (let i = 0; i < 40 && Date.now() - t0 < 180000; i++) { // up to 40 x 10 sim-seconds, 3 min wall
      q = await s.page.evaluate(() => window.__qaAdvance(10));
      if (!q) break;
      ticks += q.ticks || 0;
      if (q.screen === 'win' || q.screen === 'fail' || q.result) break;
    }
    const wall = (Date.now() - t0) / 1000;
    const win = !!q && (q.result === 'win' || q.screen === 'win');
    rows.push({ n, win });
    rec('sweep', bname, `L${n} ${KIND}`, win && !s.errors.length,
      q ? `${win ? 'WIN' : 'no win (' + q.result + ', screen ' + q.screen + ')'} stars ${q.stars}, tLeft ${q.tLeft.toFixed(1)}, bar ${q.bar.toFixed(2)}, r ${q.r.toFixed(2)}/${q.needR.toFixed(2)}, chain ${q.chain}, sim ${(ticks / 60).toFixed(0)} s, wall ${wall.toFixed(1)} s${errs(s) ? '; ' + errs(s) : ''}` : 'no state');
  }
  rec('sweep', bname, `summary ${KIND}`, rows.every(r => r.win), `${rows.filter(r => r.win).length}/${rows.length} levels won by the ${KIND} bot`);
  await s.ctx.close();
}

// ------------------------------------------------------------------ main
const t00 = Date.now();
const { srv, port } = await startServer(PORT);
ORIGIN = `http://localhost:${port}`;
console.log(`qa-run: ${ORIGIN}/${SLUG}/  browsers ${BROWSERS.join(',')}  sections ${SECTIONS.join(',')}${GPU ? '  (GPU headed chromium)' : ''}`);
await mkdir(OUT, { recursive: true });

let missing = [];
if (has('modules')) missing = await secModules();
for (const bname of BROWSERS) {
  let browser;
  try { browser = await launch(bname); } catch (e) { rec('launch', bname, '-', false, 'cannot launch: ' + String(e.message).split('\n')[0]); continue; }
  try {
    let l1res = null;
    if (has('boot')) {
      for (const prof of [PHONE, DESKTOP]) await secBoot(browser, bname, prof);
    }
    if (has('l1')) l1res = await secL1(browser, bname);
    if (has('save')) await secSave(browser, bname, l1res);
    else for (const x of l1res || []) if (x && x.s) await x.s.ctx.close().catch(() => {});
    if (bname === 'chromium') {
      if (has('shots')) await secShots(browser, bname);
      if (has('perf')) await secPerf(browser, bname);
    }
    if (has('sweep') && (bname === 'chromium' || BROWSERS.length === 1)) await secSweep(browser, bname);
  } catch (e) {
    rec('crash', bname, '-', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  }
  await browser.close().catch(() => {});
}
srv.close();

// ------------------------------------------------------------------ table
const W = [8, 9, 12, 5];
const line = r => `${r.section.padEnd(W[0])} ${r.bname.padEnd(W[1])} ${String(r.prof).padEnd(W[2])} ${r.status.padEnd(W[3])} ${r.detail}`;
const head = `${'section'.padEnd(W[0])} ${'browser'.padEnd(W[1])} ${'profile'.padEnd(W[2])} ${'state'.padEnd(W[3])} detail`;
const n = s => results.filter(r => r.status === s).length;
const table = [head, '-'.repeat(head.length), ...results.map(line), '', `${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('INFO')} INFO  (${((Date.now() - t00) / 1000).toFixed(0)} s)${missing.length ? '  missing modules: ' + missing.join(', ') : ''}`].join('\n');
console.log('\n' + table);
await writeFile(join(OUT, 'qa-run-latest.txt'), table + '\n');
await writeFile(join(OUT, 'qa-run-latest.json'), JSON.stringify({ at: new Date().toISOString(), sections: SECTIONS, browsers: BROWSERS, gpu: GPU, results }, null, 1));
process.exit(n('FAIL') ? 1 : 0);
