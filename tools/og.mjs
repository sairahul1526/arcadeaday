// Captures a 1200x630 share image (og.jpg) of a game's title screen.
// usage: node tools/og.mjs <game-slug | hub> [--wait 2500] [--query "..."] [--ready-timeout 60000]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const slug = args[0];
const dir = slug === 'hub' ? '' : slug + '/';
const opt = k => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : null;
};
const wait = +(opt('wait') || 2500);
const query = opt('query') || '';

const root = resolve('games');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[page]', e.message));
await page.goto(`http://localhost:${server.address().port}/${dir}?og=1&${query}`);
await page.evaluate(() => document.fonts.ready);
// v2 games set window.__ogReady when the og frame is drawn; wait for it (a slow boot would shoot the loading screen),
// then --wait as settle time. Older games without it fall back to --wait alone.
const usesReady = slug !== 'hub' && (await readdir(join(root, slug)).catch(() => []))
  .filter(f => f.endsWith('.js'))
  .some(f => readFileSync(join(root, slug, f), 'utf8').includes('__ogReady'));
if (usesReady) await page.waitForFunction(() => window.__ogReady === true, null, { timeout: +(opt('ready-timeout') || 60000) });
await page.waitForTimeout(wait);
const out = `games/${dir}og.jpg`;
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
console.log('wrote', out);
await browser.close();
server.close();
