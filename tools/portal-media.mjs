#!/usr/bin/env node
// Portal store media from the kie.ai covers (tools/<slug>/art-media.json): exact sizes, clean and with the title.
//   node tools/portal-media.mjs <slug> "<Game Title>"
// Reads studio/art-raw/<slug>/media/{cover-wide,cover-tall,cover-square,icon}.png and writes dist/portals/<slug>/media/.
// Sizes: CrazyGames 1920x1080 / 800x1200 / 800x800, GameDistribution 512x512 / 512x384 / 200x120, icon 512/256.
// The title is drawn in Lilita One (games/shared/fonts) with a plum outline, in Chromium via Playwright.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const [slug, title] = process.argv.slice(2);
if (!slug || !title) { console.error('usage: portal-media.mjs <slug> "<Game Title>"'); process.exit(1); }
const RAW = join(ROOT, 'studio', 'art-raw', slug, 'media'), OUT = join(ROOT, 'dist', 'portals', slug, 'media');

// src: raw image; fx: horizontal focus when cropping (0..1); t: title layout in output fractions
// (lines, align, x, y = centre of the block, s = line height as a fraction of output height); null = clean
const words = title.split(' '), two = [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
const L = { lines: two, align: 'left', x: 0.045, y: 0.5, s: 0.15 };
const JOBS = [
  ['cover-1920x1080', 'cover-wide', 1920, 1080, 0.5, L],
  ['cover-800x1200', 'cover-tall', 800, 1200, 0.5, { lines: [title], align: 'center', x: 0.5, y: 0.085, s: 0.1 }],
  ['cover-800x800', 'cover-square', 800, 800, 0.5, { lines: [title], align: 'center', x: 0.5, y: 0.885, s: 0.12, band: true }],
  ['thumb-512x512', 'cover-square', 512, 512, 0.5, { lines: [title], align: 'center', x: 0.5, y: 0.885, s: 0.12, band: true }],
  ['thumb-512x384', 'cover-wide', 512, 384, 0.42, { ...L, s: 0.16 }],
  ['thumb-200x120', 'cover-wide', 200, 120, 0.45, { ...L, s: 0.17 }],
];

const data = async f => `data:image/png;base64,${(await readFile(join(RAW, f + '.png'))).toString('base64')}`;
const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'games/shared/fonts/lilita-one-latin.woff2'))).toString('base64')}`;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.evaluate(async font => { const f = new FontFace('Lilita One', `url(${font})`); await f.load(); document.fonts.add(f); }, font);

async function render(src, w, h, fx, t, type) {
  return page.evaluate(async ({ src, w, h, fx, t, type }) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
    g.drawImage(im, (w - dw) * fx, (h - dh) / 2, dw, dh);
    if (t) {
      const s = t.s * h, n = t.lines.length, top = t.y * h - (n * s) / 2;
      if (t.band) { const gr = g.createLinearGradient(0, top - s * 0.6, 0, h); gr.addColorStop(0, 'rgba(43,36,64,0)'); gr.addColorStop(1, 'rgba(43,36,64,0.55)'); g.fillStyle = gr; g.fillRect(0, top - s * 0.6, w, h); }
      g.font = `${s * 1.08}px "Lilita One"`; g.textAlign = t.align; g.textBaseline = 'middle'; g.lineJoin = 'round';
      t.lines.forEach((line, i) => {
        const x = t.x * w, y = top + s * (i + 0.5);
        g.save(); g.shadowColor = 'rgba(20,14,36,0.45)'; g.shadowOffsetY = s * 0.07; g.shadowBlur = s * 0.08;
        g.lineWidth = s * 0.2; g.strokeStyle = '#2B2440'; g.strokeText(line, x, y); g.restore();
        const gr = g.createLinearGradient(0, y - s / 2, 0, y + s / 2);
        gr.addColorStop(0, '#FFF1C9'); gr.addColorStop(0.55, '#FFC25A'); gr.addColorStop(1, '#FF8A3D');
        g.fillStyle = gr; g.fillText(line, x, y);
      });
    }
    return c.toDataURL(type, 0.9).split(',')[1];
  }, { src, w, h, fx, t, type });
}

const save = async (name, b64) => { await writeFile(join(OUT, name), Buffer.from(b64, 'base64')); console.log(`✓ ${name}`); };
for (const [name, src, w, h, fx, t] of JOBS) {
  const s = await data(src);
  await save(`${name}-title.jpg`, await render(s, w, h, fx, t, 'image/jpeg'));
  if (w >= 800) await save(`${name}.jpg`, await render(s, w, h, fx, null, 'image/jpeg'));
}
const icon = await data('icon');
for (const n of [512, 256]) await save(`icon-${n}.png`, await render(icon, n, n, 0.5, null, 'image/png'));
await browser.close();
