// Builds the YouTube Playables version of a v2 game.
//
//   node tools/build-playables.mjs <slug>                 source: games/<slug>/
//   node tools/build-playables.mjs --src <dir> [--slug x]  source: any dir (e.g. tools/fixtures/hello-playable)
//
// Output: games/yt/<slug>/ (deployed, so YouTube's test suite can load it over https)
//         dist/playables/<slug>.zip (zip root = index.html, ready to upload)
//
// CONVENTION (also in games/shared/README.md). The game's web index.html is the only input page:
//   - Every <style> block in it is game CSS and is copied verbatim (site.css is never copied).
//   - Exactly one <!-- yt:body --> ... <!-- /yt:body --> block marks the game markup
//     (the canvas plus any overlay DOM such as a shop panel). It is copied as the yt <body>.
//     It must not contain links (<a href>), build markers or SEO/site chrome.
//   - <link rel="stylesheet"> tags pointing at ../shared/*.css or fonts.googleapis.com are kept.
//   - The entry is always game.js (an ES module); everything else is reached by relative imports.
// The generated index.html puts the Playables SDK first, then the CSS, the markup and ./game.js.
// All game files except index.html and og.jpg are copied, plus games/shared/* (platform.js,
// fonts.css, fonts/) at the zip root, and every '../shared/' reference is rewritten to './'.
//
// Fails (exit 1) on: absolute paths (src="/ href="/ url(/ from '/ import('/ fetch('/), a file name
// outside [a-z0-9_.-], a file over 30 MiB, more than 8,000 files, a bundle over 30 MiB, a missing
// yt:body block or game.js, an <a href> in the markup, or leftover site chrome.
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile } from 'node:fs/promises';
import { join, resolve, basename, extname, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const srcArg = opt('src');
const slug = opt('slug') || (srcArg ? basename(resolve(srcArg)) : args.find(a => !a.startsWith('--')));
if (!slug) { console.error('usage: node tools/build-playables.mjs <slug> | --src <dir> [--slug name]'); process.exit(2); }
const SRC = srcArg ? resolve(srcArg) : join(ROOT, 'games', slug);
const SHARED = join(ROOT, 'games', 'shared');
const OUT = join(ROOT, 'games', 'yt', slug);
const ZIP = join(ROOT, 'dist', 'playables', slug + '.zip');

const SDK = 'https://www.youtube.com/game_api/v1';
const MiB = 1024 * 1024;
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const SKIP_GAME = new Set(['index.html', 'og.jpg', '.DS_Store']);
const SKIP_SHARED = new Set(['README.md', '.DS_Store']);
const NAME_OK = /^[a-z0-9_.-]+$/;
const ABS = [
  [/\bsrc\s*=\s*["']\//, 'src="/'],
  [/\bhref\s*=\s*["']\//, 'href="/'],
  [/url\(\s*["']?\//, 'url(/'],
  [/\bfrom\s*["']\//, "from '/"],
  [/\bimport\s*\(\s*["']\//, "import('/"],
  [/\bfetch\s*\(\s*["']\//, "fetch('/"],
];

const fails = [], warns = [];
let written = [], total = 0;
const fail = m => fails.push(m);

async function walk(dir, skip, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name) && dir === base) continue;
    if (e.name === '.DS_Store') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, skip, base)));
    else out.push({ abs: p, rel: relative(base, p) });
  }
  return out;
}

// ------------------------------------------------------------ read the web page
let html;
try { html = await readFile(join(SRC, 'index.html'), 'utf8'); } catch { fail(`${SRC}/index.html not found`); }
try { await stat(join(SRC, 'game.js')); } catch { fail(`${SRC}/game.js not found (the entry must be game.js)`); }
if (fails.length) done();

const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1].trim());
const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
  .filter(l => /rel=["']?stylesheet/i.test(l) && /href=["'](\.\.\/shared\/[^"']+\.css|https:\/\/fonts\.googleapis\.com\/[^"']+)["']/i.test(l));
const bodies = [...html.matchAll(/<!--\s*yt:body\s*-->([\s\S]*?)<!--\s*\/yt:body\s*-->/g)];
if (bodies.length !== 1) fail(`index.html needs exactly one <!-- yt:body --> ... <!-- /yt:body --> block (found ${bodies.length})`);
const body = (bodies[0]?.[1] || '').trim();
if (!/<canvas\b/i.test(body)) warns.push('yt:body has no <canvas>');
if (/<a\b[^>]*\bhref/i.test(body)) fail('yt:body contains an <a href> (no links out of the game on YouTube)');
if (/build:(head|body)|site\.css|class=["'](back|sheet)\b/.test(body)) fail('yt:body contains site chrome (build markers, site.css, .back or .sheet)');
if (styles.some(s => /site\.css/.test(s))) fail('a <style> block imports site.css');
let title = slug;
try {
  const g = JSON.parse(await readFile(join(ROOT, 'games', 'games.json'), 'utf8')).find(x => x.slug === slug);
  if (g) title = g.title;
} catch {}

// ------------------------------------------------------------ collect files
const gameFiles = await walk(SRC, SKIP_GAME);
const sharedFiles = await walk(SHARED, SKIP_SHARED);
const names = new Set(gameFiles.map(f => f.rel));
for (const f of sharedFiles) if (names.has(f.rel)) fail(`${f.rel} exists in the game and in games/shared (name clash at the zip root)`);
const rewrite = s => s.replace(/(\.\.\/)+shared\//g, './');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script src="${SDK}"></script>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${esc(title)}</title>
${links.map(rewrite).join('\n')}
<style>
${styles.map(rewrite).join('\n')}
</style>
<style>html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }</style>
</head>
<body>
${rewrite(body)}
<script type="module" src="./game.js"></script>
</body>
</html>
`;

// ------------------------------------------------------------ write games/yt/<slug>/
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
written = [{ rel: 'index.html', size: Buffer.byteLength(index) }];
await writeFile(join(OUT, 'index.html'), index);
for (const f of [...gameFiles, ...sharedFiles]) {
  const dst = join(OUT, f.rel);
  await mkdir(dirname(dst), { recursive: true });
  if (TEXT.has(extname(f.rel))) {
    const s = rewrite(await readFile(f.abs, 'utf8'));
    await writeFile(dst, s);
    written.push({ rel: f.rel, size: Buffer.byteLength(s) });
  } else {
    await copyFile(f.abs, dst);
    written.push({ rel: f.rel, size: (await stat(dst)).size });
  }
}

// ------------------------------------------------------------ lint the output
for (const f of written) {
  total += f.size;
  for (const seg of f.rel.split('/')) if (!NAME_OK.test(seg)) fail(`bad file name "${f.rel}" (only [a-z0-9_.-])`);
  if (f.size > 30 * MiB) fail(`${f.rel} is ${(f.size / MiB).toFixed(1)} MiB (max 30 MiB)`);
  else if (f.size > 512 * 1024) warns.push(`${f.rel} is ${(f.size / 1024).toFixed(0)} KiB (keep files < 512 KiB where possible)`);
  if (!TEXT.has(extname(f.rel))) continue;
  const s = await readFile(join(OUT, f.rel), 'utf8');
  for (const [re, what] of ABS) if (re.test(s)) fail(`${f.rel}: absolute path (${what}): ${s.match(new RegExp('.{0,40}' + re.source + '.{0,40}'))?.[0]?.trim()}`);
  const esc = s.match(/(\bfrom\s*|\bimport\s*\(\s*|\bsrc\s*=\s*|\bhref\s*=\s*|url\(\s*)["']?\.\.\/[^"')\s]*/);
  if (esc) fail(`${f.rel}: path escapes the bundle (${esc[0]})`);
  if (f.rel !== 'index.html' && /\.js$/.test(f.rel) && /\blocalStorage\b|visibilitychange|navigator\.share/.test(s) && !/platform\.js$/.test(f.rel))
    warns.push(`${f.rel}: uses localStorage / visibilitychange / navigator.share directly (go through P)`);
  if (extname(f.rel) !== '.txt') for (const m of s.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
    const u = m[0];
    if (/^https:\/\/(www\.youtube\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org)/.test(u)) continue;
    warns.push(`${f.rel}: mentions ${u} (other-origin requests are blocked on YouTube)`);
  }
}
if (written.length > 8000) fail(`${written.length} files (max 8,000)`);
if (total > 30 * MiB) fail(`bundle is ${(total / MiB).toFixed(1)} MiB (max 30 MiB)`);
else if (total > 15 * MiB) warns.push(`bundle is ${(total / MiB).toFixed(1)} MiB (target < 15 MiB)`);
const firstScript = index.match(/<script\b[^>]*>/i)[0];
if (!firstScript.includes(SDK)) fail('the SDK is not the first script');

// ------------------------------------------------------------ zip
if (!fails.length) {
  await mkdir(dirname(ZIP), { recursive: true });
  await rm(ZIP, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', ZIP, '.', '-x', '.DS_Store'], { cwd: OUT });
  const list = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!list.includes('index.html')) fail('zip root has no index.html');
}
done();

function done() {
  for (const w of warns) console.warn('warn: ' + w);
  if (fails.length) {
    if (written.length) execFileSync('rm', ['-rf', OUT]); // never leave a failing build where it would deploy
    console.error('\nFAIL:\n- ' + fails.join('\n- '));
    process.exit(1);
  }
  console.log(`built ${relative(ROOT, OUT)}/ (${written.length} files, ${(total / 1024).toFixed(0)} KiB) and ${relative(ROOT, ZIP)}`);
  process.exit(0);
}
