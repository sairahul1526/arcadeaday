#!/usr/bin/env node
// Final growth cover (cool teal street since 11-07, the curator's warm-on-tan note, wordmark 25 % bigger): games/slurp-pot/art/cover-wide.webp (1280x720 q72), games/slurp-pot/og.jpg (1200x630 q82),
// media raws for tools/portal-media.mjs, alt cake cover. Wordmark = title screen's (ui.js drawTitle), composited, not generated.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const A = join(ROOT, 'studio/art-raw/slurp-pot'), MEDIA = join(A, 'media');
const src = f => readFile(f).then(b => `data:image/png;base64,${b.toString('base64')}`);
const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'games/shared/fonts/lilita-one-latin.woff2'))).toString('base64')}`;
const growth = await src(join(A, 'covers-growth/cover-cool-1.png'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); await page.setContent('<canvas></canvas>');
  const out = await page.evaluate(async ({ growth, font }) => {
    const ff = new FontFace('Lilita One', `url(${font})`); await ff.load(); document.fonts.add(ff);
    const im = new Image(); im.src = growth; await im.decode();
    const mk = (w, h, type, q) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
      g.imageSmoothingQuality = 'high'; g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
      const ls = h * 0.21; g.font = `${ls}px "Lilita One"`; const tw = g.measureText('Slurp Pot').width;
      g.translate(w * 0.02 + tw / 2, h * 0.03 + ls * 0.55); g.rotate(-0.04);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.fillStyle = '#3A2418'; g.fillText('Slurp Pot', 0, Math.max(1.5, ls * 0.08));
      g.lineWidth = Math.max(1.5, ls * 0.16); g.strokeStyle = '#3A2418'; g.strokeText('Slurp Pot', 0, 0);
      g.fillStyle = '#F5B323'; g.fillText('Slurp Pot', 0, 0);
      return c.toDataURL(type, q).split(',')[1];
    };
    return { wide: mk(1280, 720, 'image/webp', 0.72), og: mk(1200, 630, 'image/jpeg', 0.82) };
  }, { growth, font });
  await writeFile(join(ROOT, 'games/slurp-pot/art/cover-wide.webp'), Buffer.from(out.wide, 'base64'));
  await writeFile(join(ROOT, 'games/slurp-pot/og.jpg'), Buffer.from(out.og, 'base64'));
  console.log('wide KB', (out.wide.length * 0.75 / 1024).toFixed(1), 'og KB', (out.og.length * 0.75 / 1024).toFixed(1));
} finally { await browser.close(); }
await copyFile(join(A, 'covers-growth/cover-cool-1.png'), join(MEDIA, 'cover-wide.png'));
await copyFile(join(A, 'covers-growth/cover-cool-tall.png'), join(MEDIA, 'cover-tall.png'));
await copyFile(join(A, 'covers-growth/cover-cool-square.png'), join(MEDIA, 'cover-square.png'));
await copyFile(join(ROOT, 'studio/2026-11-06/fix2/cover/opt-current-wordmark.png'), join(MEDIA, 'alt-cover-cake.png'));
console.log('media raws updated');
