import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const items = [['wide', 'games/slurp-pot/art/cover-wide.webp', 'image/webp'], ['og', 'games/slurp-pot/og.jpg', 'image/jpeg'],
  ['tall (portal title)', 'dist/portals/slurp-pot/media/cover-800x1200-title.jpg', 'image/jpeg'], ['square (portal title)', 'dist/portals/slurp-pot/media/cover-800x800-title.jpg', 'image/jpeg']];
const imgs = [];
for (const [n, f, m] of items) imgs.push({ n, s: `data:${m};base64,${(await readFile(join(ROOT, f))).toString('base64')}` });
const b = await chromium.launch();
try {
  const p = await b.newPage(); await p.setContent('<canvas id=c></canvas>');
  const r = await p.evaluate(async imgs => {
    const ims = []; for (const o of imgs) { const i = new Image(); i.src = o.s; await i.decode(); ims.push(i); }
    const c = document.getElementById('c'); c.width = 1700; c.height = 1500; const g = c.getContext('2d');
    g.fillStyle = '#1E1A26'; g.fillRect(0, 0, 1700, 1500); g.fillStyle = '#fff'; g.font = '14px sans-serif';
    const fit = (i, h) => [i.width * h / i.height, h];
    let y = 20; g.fillText('wide + og full', 10, 14);
    let x = 10; for (let k = 0; k < 2; k++) { const [w, h] = fit(ims[k], 420); g.drawImage(ims[k], x, y, w, h); x += w + 20; }
    y += 440; g.fillText('tall + square (portal outputs) full, then every cover at 128 px wide', 10, y); y += 10;
    x = 10; for (let k = 2; k < 4; k++) { const [w, h] = fit(ims[k], 560); g.drawImage(ims[k], x, y, w, h); x += w + 20; }
    x += 20; for (let k = 0; k < 4; k++) { const w = 128, h = w * ims[k].height / ims[k].width; g.drawImage(ims[k], x, y + (k % 2) * 0 + [0, 90, 190, 410][k], w, h); }
    return c.toDataURL('image/png').split(',')[1];
  }, imgs);
  await writeFile(join(ROOT, 'studio/2026-11-06/fix2/cover/final-sheet.png'), Buffer.from(r, 'base64'));
} finally { await b.close(); }
