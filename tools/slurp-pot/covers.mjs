#!/usr/bin/env node
// Slurp Pot covers: the kie.ai concepts from tools/slurp-pot/covers.json (raw in studio/art-raw/slurp-pot/covers/)
// become the in-game wide cover plus a review sheet for the pick.
//   node tools/slurp-pot/covers.mjs [pick=a] [--sheet <png>]
// Writes:
//   games/slurp-pot/og.jpg   1200x630 jpeg, same art + wordmark
//   games/slurp-pot/art/cover-wide.webp   1280x720 q72, "Slurp Pot" wordmark top-left in the empty sky
//   studio/art-raw/slurp-pot/media/cover-{wide,tall,square}.png   the picked raws, for tools/portal-media.mjs
//   <sheet> (default studio/<today>/art/covers-sheet.png)   every concept clean + titled at 256 and 128 px wide,
//      with thumbnail contrast numbers (luminance spread, title-area darkness, subject/sky separation)
// The title look follows tools/portal-media.mjs (Lilita One, gold gradient) with the Slurp Pot ink #3A2418.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile, access, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const RAW = join(ROOT, 'studio/art-raw/slurp-pot/covers'), MEDIA = join(ROOT, 'studio/art-raw/slurp-pot/media');
const args = process.argv.slice(2);
const pick = (args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--sheet') || 'a').replace(/^cover-/, '');
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const si = args.indexOf('--sheet');
const SHEET = si >= 0 ? args[si + 1] : join(ROOT, 'studio', today, 'art', 'covers-sheet.png');
const exists = p => access(p).then(() => true, () => false);

// ids: a..e (first round) and <concept>-<take> such as gulp-3 (Friday round)
const IDS = (await readdir(RAW)).map(f => f.match(/^cover-([a-e]|(?:gulp|melon|spiral)-\d+)\.png$/)?.[1]).filter(Boolean).sort();
if (!IDS.includes(pick)) { console.error(`no ${join(RAW, `cover-${pick}.png`)} (have: ${IDS.join(', ') || 'none'})`); process.exit(1); }

const data = async f => `data:image/png;base64,${(await readFile(f)).toString('base64')}`;
const font = `data:font/woff2;base64,${(await readFile(join(ROOT, 'games/shared/fonts/lilita-one-latin.woff2'))).toString('base64')}`;
// One browser at a time, always closed (shared 16 GB machine).
const browser = await chromium.launch();
try {
const page = await browser.newPage();
await page.evaluate(async font => { const f = new FontFace('Lilita One', `url(${font})`); await f.load(); document.fonts.add(f); }, font);

// Draws one cover at w x h (cover-fit, centred) with an optional title; returns { b64, stats }.
async function render(src, w, h, titled, type, q) {
  return page.evaluate(async ({ src, w, h, titled, type, q }) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
    g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    // thumbnail contrast numbers on the clean frame
    const px = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
    let sum = 0, tl = 0, tn = 0;
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b; L[i] = l; sum += l;
      const x = i % w, y = (i / w) | 0;
      if (x < w * 0.45 && y > h * 0.08 && y < h * 0.5) { tl += l; tn++; }
    }
    const mean = sum / (w * h); let v = 0; for (const l of L) v += (l - mean) ** 2;
    const sorted = Array.from(L).sort((a, b) => a - b);
    const stats = { sd: Math.sqrt(v / L.length), titleLum: tl / tn, p10: sorted[(L.length * 0.1) | 0], p90: sorted[(L.length * 0.9) | 0] };
    if (titled) {
      const s = h * 0.19, lines = ['Slurp', 'Pot'], x = w * 0.05, top = h * 0.1;
      g.font = `${s * 1.08}px "Lilita One"`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      lines.forEach((line, i) => {
        const y = top + s * (i * 0.92 + 0.5);
        g.save(); g.shadowColor = 'rgba(20,12,6,0.5)'; g.shadowOffsetY = s * 0.07; g.shadowBlur = s * 0.09;
        g.lineWidth = s * 0.2; g.strokeStyle = '#3A2418'; g.strokeText(line, x, y); g.restore();
        const gr = g.createLinearGradient(0, y - s / 2, 0, y + s / 2);
        gr.addColorStop(0, '#FFF1C9'); gr.addColorStop(0.55, '#FFC25A'); gr.addColorStop(1, '#FF8A3D');
        g.fillStyle = gr; g.fillText(line, x, y);
      });
    }
    return { b64: c.toDataURL(type, q).split(',')[1], stats };
  }, { src, w, h, titled, type, q });
}

// 1) in-game wide cover from the pick
const pickSrc = await data(join(RAW, `cover-${pick}.png`));
const wide = await render(pickSrc, 1280, 720, true, 'image/webp', 0.72);
await writeFile(join(ROOT, 'games/slurp-pot/art/cover-wide.webp'), Buffer.from(wide.b64, 'base64'));
console.log(`✓ games/slurp-pot/art/cover-wide.webp from cover-${pick} (${(Buffer.from(wide.b64, 'base64').length / 1024).toFixed(1)} KB)`);

// 1b) og image: 1200x630 jpeg of the same art with the wordmark (no bands)
const og = await render(pickSrc, 1200, 630, true, 'image/jpeg', 0.82);
await writeFile(join(ROOT, 'games/slurp-pot/og.jpg'), Buffer.from(og.b64, 'base64'));
console.log(`✓ games/slurp-pot/og.jpg 1200x630 (${(Buffer.from(og.b64, 'base64').length / 1024).toFixed(1)} KB)`);

// 2) raws for tools/portal-media.mjs (Sunday ship)
await mkdir(MEDIA, { recursive: true });
await copyFile(join(RAW, `cover-${pick}.png`), join(MEDIA, 'cover-wide.png'));
for (const k of ['tall', 'square']) if (await exists(join(RAW, `cover-${k}.png`))) await copyFile(join(RAW, `cover-${k}.png`), join(MEDIA, `cover-${k}.png`));
console.log(`✓ ${MEDIA}/cover-{wide,tall,square}.png (portal-media also needs icon.png)`);

// 3) review sheet: each concept clean 256, titled 256, titled 128, plus numbers
const rows = [];
for (const id of IDS) {
  const s = await data(join(RAW, `cover-${id}.png`));
  const a = await render(s, 256, 144, false, 'image/png', 1), b = await render(s, 256, 144, true, 'image/png', 1), c = await render(s, 128, 72, true, 'image/png', 1);
  rows.push({ id, a: a.b64, b: b.b64, c: c.b64, st: a.stats });
}
const sheet = await page.evaluate(async ({ rows, pick }) => {
  const W = 256 * 2 + 128 + 360 + 50, RH = 170, c = document.createElement('canvas'); c.width = W; c.height = 30 + RH * rows.length;
  const g = c.getContext('2d'); g.fillStyle = '#1E1A26'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#FFF1C9'; g.font = '15px "Lilita One"'; g.fillText('Slurp Pot cover concepts: clean 256 / titled 256 / titled 128 (GameDistribution 200x120 class)', 10, 20);
  for (let r = 0; r < rows.length; r++) {
    const R = rows[r], y = 30 + r * RH;
    for (const [k, x, w, h] of [['a', 10, 256, 144], ['b', 276, 256, 144], ['c', 542, 128, 72]]) {
      const im = new Image(); im.src = 'data:image/png;base64,' + R[k]; await im.decode(); g.drawImage(im, x, y, w, h);
    }
    const st = R.st, sep = st.p90 - st.p10;
    g.fillStyle = R.id === pick ? '#FFC25A' : '#E8E2F0'; g.font = '18px "Lilita One"';
    g.fillText(`cover-${R.id}${R.id === pick ? '  (PICK)' : ''}`, 690, y + 22);
    g.font = '14px sans-serif'; g.fillStyle = '#E8E2F0';
    g.fillText(`luminance spread sd ${st.sd.toFixed(3)}`, 690, y + 48);
    g.fillText(`p10..p90 separation ${sep.toFixed(3)}`, 690, y + 68);
    g.fillText(`title area mean lum ${st.titleLum.toFixed(3)} (lower = gold pops)`, 690, y + 88);
  }
  return c.toDataURL('image/png').split(',')[1];
}, { rows, pick });
await mkdir(dirname(SHEET), { recursive: true });
await writeFile(SHEET, Buffer.from(sheet, 'base64'));
for (const R of rows) console.log(`  cover-${R.id}: sd ${R.st.sd.toFixed(3)}  p10..p90 ${(R.st.p90 - R.st.p10).toFixed(3)}  title-area lum ${R.st.titleLum.toFixed(3)}`);
console.log(`✓ ${SHEET}`);
} finally { await browser.close(); }
