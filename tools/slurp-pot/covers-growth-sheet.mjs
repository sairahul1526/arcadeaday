#!/usr/bin/env node
// Round-2 cover options: growth takes + current cover (gulp-3) with the TITLE-SCREEN wordmark (ui.js drawTitle:
// Lilita One, gold #F5B323, ink #3A2418 stroke 0.16 size, ink drop shadow 0.08 size, single line, tilt -0.04 rad).
//   node tools/slurp-pot/covers-growth-sheet.mjs   -> studio/2026-11-06/fix2/cover/{opt-*.png (1280x720), sheet.png}
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = join(ROOT, 'studio/2026-11-06/fix2/cover');
const A = join(ROOT, 'studio/art-raw/slurp-pot');
const opts = [
  { id: 'growth-1', f: join(A, 'covers-growth/cover-growth-1.png'), pos: [0.04, 0.05] },
  { id: 'growth-2', f: join(A, 'covers-growth/cover-growth-2.png'), pos: [0.04, 0.05] },
  { id: 'current-wordmark', f: join(A, 'covers/cover-gulp-3.png'), pos: [0.04, 0.07] },
];
const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'games/shared/fonts/lilita-one-latin.woff2'))).toString('base64')}`;
for (const o of opts) o.src = `data:image/png;base64,${(await readFile(o.f)).toString('base64')}`;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const res = await page.evaluate(async ({ opts, font }) => {
    const ff = new FontFace('Lilita One', `url(${font})`); await ff.load(); document.fonts.add(ff);
    const draw = (g, im, x, y, w, h) => {
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
      g.imageSmoothingQuality = 'high'; g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      const ls = h * 0.2; g.font = `${ls}px "Lilita One"`; const tw = g.measureText('Slurp Pot').width;
      g.translate(x + w * o_pos[0] + tw / 2, y + h * o_pos[1] + ls * 0.55); g.rotate(-0.04);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.fillStyle = '#3A2418'; g.fillText('Slurp Pot', 0, Math.max(1.5, ls * 0.08));
      g.lineWidth = Math.max(1.5, ls * 0.16); g.strokeStyle = '#3A2418'; g.strokeText('Slurp Pot', 0, 0);
      g.fillStyle = '#F5B323'; g.fillText('Slurp Pot', 0, 0);
      g.restore();
    };
    let o_pos; const full = {};
    const ims = [];
    for (const o of opts) { const im = new Image(); im.src = o.src; await im.decode(); ims.push(im); }
    const BW = 640, BH = 360, RH = BH + 40, W = BW + 20 + 256 + 20 + 128 + 30;
    const c = document.getElementById('c'); c.width = W; c.height = opts.length * RH + 10;
    const g = c.getContext('2d'); g.fillStyle = '#1E1A26'; g.fillRect(0, 0, W, c.height);
    opts.forEach((o, r) => {
      o_pos = o.pos; const y = 10 + r * RH;
      g.fillStyle = '#FFF1C9'; g.font = '16px "Lilita One"'; g.fillText(o.id, 10, y + 14);
      draw(g, ims[r], 10, y + 20, BW, BH);
      draw(g, ims[r], 10 + BW + 20, y + 20, 256, 144);
      draw(g, ims[r], 10 + BW + 20 + 276, y + 20, 128, 72);
      const f = document.createElement('canvas'); f.width = 1280; f.height = 720; draw(f.getContext('2d'), ims[r], 0, 0, 1280, 720);
      full[o.id] = f.toDataURL('image/png').split(',')[1];
    });
    return { sheet: c.toDataURL('image/png').split(',')[1], full };
  }, { opts, font });
  await writeFile(join(OUT, 'sheet.png'), Buffer.from(res.sheet, 'base64'));
  for (const [id, b] of Object.entries(res.full)) await writeFile(join(OUT, `opt-${id}.png`), Buffer.from(b, 'base64'));
  console.log('ok', OUT);
} finally { await browser.close(); }
