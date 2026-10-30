#!/usr/bin/env node
// Portal packages from the clean Playables build (run `node tools/build-playables.mjs <slug>` first).
//   node tools/build-portal.mjs <slug> [crazygames,gamedistribution,gamepix,coolmath]
// Writes dist/portals/<portal>/<slug>/ and dist/portals/<portal>/<slug>.zip. The YouTube SDK tag is replaced by
// `window.__PORTAL = '<portal>'` (platform.js turns off share/links and drives the portal adapter) plus the
// portal's own SDK script where the portal requires one. The game itself makes no ad calls.
// DECISION: GameDistribution needs a gameId that only exists after the user creates the game on their
//   dashboard, so GD_OPTIONS.gameId is a placeholder unless GD_GAME_ID is set:
//   GD_GAME_ID=<id> node tools/build-portal.mjs <slug> gamedistribution
import { readFile, writeFile, rm, mkdir, cp, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const [slug, list] = process.argv.slice(2);
if (!slug) { console.error('usage: build-portal.mjs <slug> [portals]'); process.exit(1); }
const SRC = join(ROOT, 'games', 'yt', slug);
const YT = '<script src="https://www.youtube.com/game_api/v1"></script>';

const PORTALS = {
  crazygames: `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>`,
  gamedistribution: `<script>window.GD_OPTIONS = { gameId: '${(process.env.GD_GAME_ID || 'REPLACE_WITH_GD_GAME_ID').replace(/[^\w-]/g, '')}', onEvent: function (e) {` +
    ` (window.__gdEvents = window.__gdEvents || []).push(e); if (window.__gdOnEvent) window.__gdOnEvent(e); } };</script>\n` +
    `<script src="https://html5.api.gamedistribution.com/main.min.js"></script>`,
  gamepix: `<script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js"></script>`,
  coolmath: '', // Coolmath adds its own wrapper on licence; the build only strips links and share
};

const want = (list || Object.keys(PORTALS).join(',')).split(',').map(s => s.trim()).filter(Boolean);
const html0 = await readFile(join(SRC, 'index.html'), 'utf8').catch(() => null);
if (!html0 || !html0.includes(YT)) { console.error(`${SRC}/index.html missing or has no Playables SDK tag: run build-playables first`); process.exit(1); }

for (const p of want) {
  if (!(p in PORTALS)) { console.error(`unknown portal ${p}`); process.exit(1); }
  const dir = join(ROOT, 'dist', 'portals', p, slug), zip = join(ROOT, 'dist', 'portals', p, slug + '.zip');
  await rm(dir, { recursive: true, force: true }); await rm(zip, { force: true });
  await mkdir(dirname(dir), { recursive: true });
  await cp(SRC, dir, { recursive: true });
  const tag = `<script>window.__PORTAL = '${p}';</script>` + (PORTALS[p] ? '\n' + PORTALS[p] : '');
  await writeFile(join(dir, 'index.html'), html0.replace(YT, tag));
  execFileSync('zip', ['-qr', '-X', zip, '.', '-x', '.DS_Store'], { cwd: dir });
  console.log(`✓ ${p}: ${zip} (${((await stat(zip)).size / 1024).toFixed(0)} KB)`);
}
