#!/usr/bin/env node
// Review sheet for the Friday concept covers (cover-gulp/melon/spiral-N raws in studio/art-raw/slurp-pot/covers/).
//   node tools/slurp-pot/covers-sheet.mjs [out.png] [prefix-filter e.g. cover-gulp]
// Per take: large (640 wide, titled), titled 256, titled 128, plus clean 256. Wordmark matches covers.mjs.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const RAW = join(ROOT, 'studio/art-raw/slurp-pot/covers');
const OUT = process.argv[2] || join(ROOT, 'studio/2026-11-06/fix1/cover/covers-sheet.png');
const filt = process.argv[3] || 'cover-';
const files = (await readdir(RAW)).filter(f => /^cover-(gulp|melon|spiral)-\d+\.png$/.test(f) && f.startsWith(filt)).sort();
const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'games/shared/fonts/lilita-one-latin.woff2'))).toString('base64')}`;
const rows = [];
for (const f of files) rows.push({ id: f.replace('.png', ''), src: `data:image/png;base64,${(await readFile(join(RAW, f))).toString('base64')}` });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const b64 = await page.evaluate(async ({ rows, font }) => {
    const ff = new FontFace('Lilita One', `url(${font})`); await ff.load(); document.fonts.add(ff);
    const draw = (g, im, x, y, w, h, titled) => {
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
      g.imageSmoothingQuality = 'high'; g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      if (titled) {
        const s = h * 0.19, lines = ['Slurp', 'Pot'], tx = x + w * 0.05, top = y + h * 0.1;
        g.font = `${s * 1.08}px "Lilita One"`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        lines.forEach((line, i) => {
          const ty = top + s * (i * 0.92 + 0.5);
          g.save(); g.shadowColor = 'rgba(20,12,6,0.5)'; g.shadowOffsetY = s * 0.07; g.shadowBlur = s * 0.09;
          g.lineWidth = s * 0.2; g.strokeStyle = '#3A2418'; g.strokeText(line, tx, ty); g.restore();
          const gr = g.createLinearGradient(0, ty - s / 2, 0, ty + s / 2);
          gr.addColorStop(0, '#FFF1C9'); gr.addColorStop(0.55, '#FFC25A'); gr.addColorStop(1, '#FF8A3D');
          g.fillStyle = gr; g.fillText(line, tx, ty);
        });
      }
      g.restore();
    };
    const BW = 640, BH = 360, RH = BH + 30, W = BW + 20 + 256 + 128 + 256 + 60;
    const c = document.getElementById('c'); c.width = W; c.height = rows.length * RH + 10;
    const g = c.getContext('2d'); g.fillStyle = '#1E1A26'; g.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < rows.length; r++) {
      const R = rows[r], y = 10 + r * RH, im = new Image(); im.src = R.src; await im.decode();
      g.fillStyle = '#FFF1C9'; g.font = '16px "Lilita One"'; g.fillText(R.id, 10, y + 14);
      draw(g, im, 10, y + 20, BW, BH - 10, true);
      const x2 = 10 + BW + 20;
      draw(g, im, x2, y + 20, 256, 144, true);
      draw(g, im, x2 + 256 + 20, y + 20, 128, 72, true);
      draw(g, im, x2 + 256 + 20 + 128 + 20, y + 20, 256, 144, false);
      g.fillStyle = '#B9B2C8'; g.font = '11px sans-serif';
      g.fillText('titled 256', x2, y + 178); g.fillText('titled 128', x2 + 276, y + 178); g.fillText('clean 256', x2 + 424, y + 178);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { rows, font });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, Buffer.from(b64, 'base64'));
  console.log(`ok ${OUT} (${files.length} takes)`);
} finally { await browser.close(); }
