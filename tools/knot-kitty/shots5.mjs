// Knot Kitty readability shots (fix5). Serve games/ on 8812 first: npx http-server games -p 8812 -c-1
//   node tools/knot-kitty/shots5.mjs 45,50,55,60 [outdir]
// For each level and viewport (360x640 touch, 1440x900) opens /knot-kitty/?qa=1&lv=N, screenshots the board and reports
// the strand stroke width and the tap room per strand at the start: for every strand, the best point along it of
// min(clearance to every other strand, pick reach), doubled = the effective hit width in CSS px.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ids = (process.argv[2] || '45,50,55,60').split(',').map(Number);
const out = process.argv[3] || 'studio/2026-10-31/levels/shots';
const VP = [{ tag: 'm360', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { tag: 'd1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }];
const browser = await chromium.launch();
const errs = [];
for (const v of VP) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  for (const id of ids) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${v.tag} L${id} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${v.tag} L${id} console ${m.text()}`); });
    await page.goto(`http://localhost:8812/knot-kitty/?qa=1&lv=${id}`);
    await page.waitForFunction(() => window.__S && window.__S.sess && window.__S.sess.geo && window.__S.sess.geo.length, null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const s = window.__S.sess, B = s.B, geo = s.geo, n = s.puz.n;
      const reach = Math.max(18, 2.4 * B.sw);
      const dpp = (px, py, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return d; };
      const room = [];
      for (let i = 0; i < n; i++) {
        if (!geo[i]) continue;
        const pts = geo[i].pts; let best = 0;
        for (let k = Math.floor(pts.length * 0.1); k < Math.ceil(pts.length * 0.9); k++) {
          let c = Infinity; for (let j = 0; j < n; j++) if (j !== i && geo[j]) c = Math.min(c, dpp(pts[k][0], pts[k][1], geo[j].pts));
          best = Math.max(best, Math.min(c, reach));
        }
        room.push(2 * best);
      }
      room.sort((a, b) => a - b);
      return { n, sw: +B.sw.toFixed(1), reach: +reach.toFixed(1), minHit: +room[0].toFixed(1), p10Hit: +room[Math.floor(room.length * 0.1)].toFixed(1), medHit: +room[room.length >> 1].toFixed(1) };
    });
    await page.screenshot({ path: `${out}/L${id}-${v.tag}.png` });
    console.log(`L${id} ${v.tag}: strands ${m.n} stroke ${m.sw}px reach ${m.reach}px | effective hit min ${m.minHit} p10 ${m.p10Hit} median ${m.medHit} px`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(errs.length ? errs.join('\n') : 'no console/page errors');
