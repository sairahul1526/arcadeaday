#!/usr/bin/env node
// Final cover check sheet: shipped cover-wide.webp, og.jpg, and the media raws cropped to the portal sizes
// (tall 800x1200 title top-centre, square 800x800 title bottom, 512x384 and 200x120 from wide), titled like tools/portal-media.mjs.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'studio/2026-11-06/fix1/cover/final-sheet.png');
const b64 = async (f, m) => `data:${m};base64,${(await readFile(join(ROOT, f))).toString('base64')}`;
const srcs = { wide: await b64('games/slurp-pot/art/cover-wide.webp', 'image/webp'), og: await b64('games/slurp-pot/og.jpg', 'image/jpeg'),
  rw: await b64('studio/art-raw/slurp-pot/media/cover-wide.png', 'image/png'), rt: await b64('studio/art-raw/slurp-pot/media/cover-tall.png', 'image/png'), rs: await b64('studio/art-raw/slurp-pot/media/cover-square.png', 'image/png') };
const font = await b64('games/shared/fonts/lilita-one-latin.woff2', 'font/woff2');
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); await page.setContent('<canvas id=c></canvas>');
  const out = await page.evaluate(async ({ srcs, font }) => {
    const ff = new FontFace('Lilita One', `url(${font})`); await ff.load(); document.fonts.add(ff);
    const im = {}; for (const k in srcs) { im[k] = new Image(); im[k].src = srcs[k]; await im[k].decode(); }
    const title = (g, x, y, w, h, lines, align, tx, ty, s) => {
      g.font = `${s * h * 1.08}px "Lilita One"`; g.textAlign = align; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const sp = s * h, top = y + ty * h - (lines.length * sp * 0.92) / 2;
      lines.forEach((t, i) => { const yy = top + sp * (i * 0.92 + 0.5), xx = x + tx * w;
        g.save(); g.shadowColor = 'rgba(20,12,6,.5)'; g.shadowOffsetY = sp * .07; g.shadowBlur = sp * .09; g.lineWidth = sp * .2; g.strokeStyle = '#3A2418'; g.strokeText(t, xx, yy); g.restore();
        const gr = g.createLinearGradient(0, yy - sp / 2, 0, yy + sp / 2); gr.addColorStop(0, '#FFF1C9'); gr.addColorStop(.55, '#FFC25A'); gr.addColorStop(1, '#FF8A3D'); g.fillStyle = gr; g.fillText(t, xx, yy); });
    };
    const draw = (g, i, x, y, w, h, t) => { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); const k = Math.max(w / i.width, h / i.height); g.imageSmoothingQuality = 'high';
      g.drawImage(i, x + (w - i.width * k) / 2, y + (h - i.height * k) / 2, i.width * k, i.height * k); if (t) title(g, x, y, w, h, ...t); g.restore(); };
    const two = ['Slurp', 'Pot'], L = (s) => [two, 'left', 0.045, 0.5, s], C = ['Slurp Pot'];
    const c = document.getElementById('c'); c.width = 1700; c.height = 1480; const g = c.getContext('2d'); g.fillStyle = '#1E1A26'; g.fillRect(0, 0, c.width, c.height);
    const lab = (s, x, y) => { g.fillStyle = '#FFF1C9'; g.font = '14px sans-serif'; g.textAlign = 'left'; g.fillText(s, x, y); };
    lab('cover-wide.webp 1280x720 (as shipped)', 10, 16); draw(g, im.wide, 10, 22, 800, 450, null);
    lab('og.jpg 1200x630 (as shipped)', 830, 16); draw(g, im.og, 830, 22, 800, 420, null);
    lab('portal 512x384 / 200x120 / 1200x400 banner (wide, titled)', 10, 496); draw(g, im.rw, 10, 504, 512, 384, L(.16)); draw(g, im.rw, 540, 504, 200, 120, L(.17)); draw(g, im.rw, 540, 640, 400, 133, L(.2));
    lab('tall 800x1200 (title top)', 960, 496); draw(g, im.rt, 960, 504, 400, 600, [C, 'center', .5, .085, .1]);
    lab('square 800x800 (title bottom)', 1380, 496); draw(g, im.rs, 1380, 504, 300, 300, [C, 'center', .5, .885, .12]);
    lab('128px wide wide-cover check', 540, 800); draw(g, im.rw, 540, 806, 128, 72, L(.17)); lab('tall clean', 10, 910); draw(g, im.rt, 10, 918, 320, 480, null); lab('square clean', 350, 910); draw(g, im.rs, 350, 918, 480, 480, null);
    return c.toDataURL('image/png').split(',')[1];
  }, { srcs, font });
  await mkdir(dirname(OUT), { recursive: true }); await writeFile(OUT, Buffer.from(out, 'base64')); console.log('ok ' + OUT);
} finally { await browser.close(); }
