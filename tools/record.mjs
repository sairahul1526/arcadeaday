// Deterministic gameplay recorder: steps a game's ?record=1 mode frame by frame
// in headless Chromium, pipes frames to ffmpeg, renders the soundtrack offline
// and muxes a 1080x1920 60fps MP4 ready for TikTok / Reels / Shorts.
//
// usage: node tools/record.mjs <game-slug> [--secs 30] [--out videos/x.mp4]
//        [--query "seed=3&crash=22&hook=..."] [--snap 1,5,12]   (snap = save PNGs at those seconds, no video)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const slug = args[0];
const opt = k => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : null;
};
const secs = +(opt('secs') || 30);
const fps = 60;
const out = resolve(opt('out') || `videos/${slug}.mp4`);
const query = opt('query') || '';
const snap = opt('snap');
const tail = +(opt('tail') || 3.5); // seconds to keep after game over appears

const root = resolve('games');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => m.type() === 'error' && console.error('[page]', m.text()));
page.on('pageerror', e => console.error('[page]', e.message));
await page.goto(`http://localhost:${port}/${slug}/?record=1&${query}`);
await page.waitForFunction(() => window.__recReady === true, null, { timeout: 20000 });

if (snap) {
  await mkdir('videos/snaps', { recursive: true });
  let t = 0;
  for (const s of snap.split(',').map(Number)) {
    const n = Math.round((s - t) * fps);
    const st = await page.evaluate(n => window.__rec.step(n), Math.max(1, n));
    t = s;
    const f = `videos/snaps/${slug}-${s}.png`;
    await page.locator('canvas').screenshot({ path: f });
    console.log(f, JSON.stringify(st));
  }
  await browser.close();
  server.close();
  process.exit(0);
}

await mkdir('videos', { recursive: true });
const tmpVideo = out.replace(/\.mp4$/, '.video.mp4');
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', tmpVideo], { stdio: ['pipe', 'inherit', 'inherit'] });

let frames = 0, overAt = null, last;
const max = secs * fps;
while (frames < max) {
  last = await page.evaluate(() => window.__rec.step(1));
  const url = await page.evaluate(() => window.__rec.frame(0.92));
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  frames++;
  if (last.mode === 'over' && overAt == null) overAt = frames;
  if (overAt != null && frames - overAt >= tail * fps) break;
  if (frames % 300 === 0) console.log(`frame ${frames}  t=${last.t.toFixed(1)}s  score=${last.score} streak=${last.streak}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
const dur = frames / fps;
console.log(`video: ${frames} frames (${dur.toFixed(2)}s), final score ${last.score}`);

const b64 = await page.evaluate(d => window.__rec.audio(d), dur);
const wav = out.replace(/\.mp4$/, '.wav');
await writeFile(wav, Buffer.from(b64, 'base64'));
await browser.close();
server.close();

await new Promise((res, rej) => {
  const m = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmpVideo, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  m.on('close', c => (c ? rej(new Error('mux failed')) : res()));
});
console.log('wrote', out);
