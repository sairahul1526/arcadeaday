// Sunday fix 7 screenshots: in-level HUD (3-4 food order) at 4 sizes + Daily win card with a missed star. Run from repo root.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const GAMES = resolve('games'), OUT = resolve('studio/2026-11-08/fix7');
const LEVEL = +(process.env.LV || 12);
setTimeout(() => { console.error('cap 5 min'); process.exit(2); }, 300000).unref();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const srv = createServer(async (q, r) => { try { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = normalize(join(GAMES, p)); if (!f.startsWith(GAMES)) { r.writeHead(403); return r.end(); } const b = await readFile(f); r.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(b); } catch { r.writeHead(404); r.end(); } });
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
const mem = +/free percentage:\s*(\d+)/i.exec(execFileSync('memory_pressure', [], { encoding: 'utf8' }))?.[1];
console.log('mem free', mem); if (mem < 25) { console.error('low mem'); process.exit(3); }
const SAVE = JSON.stringify({ v: 2, stars: Array.from({ length: 60 }, (_, i) => (i < 14 ? 3 : 0)), coins: 900, boost: { magnet: 2, freeze: 1, mega: 1 }, gifted: ['magnet', 'freeze', 'mega'] });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function shot(name, w, h, fn) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  try {
    await ctx.addInitScript(v => { try { localStorage.setItem('sp_save', v); } catch {} }, SAVE);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.goto(`${ORIGIN}/slurp-pot/?qa=1`);
    await page.waitForFunction(() => typeof window.__qa === 'function', null, { timeout: 30000 });
    await fn(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, (process.env.TAG || '') + name + '.png') });
    const info = await page.evaluate(() => { try { return window.__qaLayout ? window.__qaLayout() : null; } catch { return null; } });
    console.log('shot', name, JSON.stringify(info));
  } finally { await ctx.close(); }
}
try {
  for (const [w, h] of [[360, 640], [390, 844], [844, 390], [1440, 900]]) {
    await shot(`hud-${w}x${h}`, w, h, async p => {
      await p.evaluate(n => window.__qaLevel(n), LEVEL);
      await p.evaluate(() => window.__qaBot(true, 'average'));
      await p.evaluate(() => window.__qaAdvance(3));
    });
  }
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await shot(`daily-win-missed-${w}x${h}`, w, h, async p => {
      await p.evaluate(() => window.__qaScreen('win', { kind: 'daily', stars: 2, mask: 5, coins: 30, tLeft: 20, chainBest: 6, n: 0,
        lines: [{ type: 'win' }, { type: 'eat', n: 20, kind: 'cherry' }, { type: 'chain', n: 6 }] }));
      await p.waitForTimeout(2500);
    });
  }
} finally { await browser.close(); srv.close(); }
console.log('console errors:', errors.length ? errors : 'none');
process.exit(errors.length ? 1 : 0);
