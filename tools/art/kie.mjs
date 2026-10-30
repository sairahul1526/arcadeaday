#!/usr/bin/env node
// kie.ai art pipeline: generate game art, cut out backgrounds, optimize for the web.
// Key: KIE_API_KEY from the environment or ~/.config/arcadeaday.env (never printed, never committed).
//
//   node tools/art/kie.mjs credits
//   node tools/art/kie.mjs gen --prompt "..." --out games/x/art/cat.png [--aspect 1:1] [--res 1K]
//                              [--model nano-banana-2] [--ref a.png,b.png] [--cutout] [--max 512]
//   node tools/art/kie.mjs cutout in.png out.png
//   node tools/art/kie.mjs batch games/x/art/art.json [--force] [--only id1,id2]
//   node tools/art/kie.mjs optimize in.png out.webp [--max 512] [--q 82]
//
// batch spec (art.json):
//   { "style": "prefix added to every prompt", "refs": ["shared/style-ref.png"], "outDir": "games/x/art",
//     "defaults": { "aspect": "1:1", "res": "1K", "cutout": true, "max": 512 },
//     "items": [ { "id": "cat-orange", "prompt": "...", "aspect": "1:1", "cutout": true, "max": 256, "refs": [] } ] }
// Outputs <outDir>/<id>.webp (shipped) and a raw 1K+ PNG in studio/art-raw/ (gitignored, never shipped), plus
// <spec>.manifest.json with prompt, model and task ids. Existing outputs are skipped unless --force.
// Run from the repo root. Cost: ~9 credits per image with cutout (nano-banana-2 1K + recraft).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co';

function key() {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY.trim();
  const f = path.join(os.homedir(), '.config/arcadeaday.env');
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/^\s*KIE_API_KEY\s*=\s*["']?([^"'\s]+)/m);
    if (m) return m[1];
  }
  throw new Error('KIE_API_KEY missing: add it to ~/.config/arcadeaday.env');
}
const H = () => ({ Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(url, opts = {}) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500 || j.code === 429) && i < 5) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok || (j.code && j.code !== 200)) throw new Error(`${url} → ${r.status} ${j.code ?? ''} ${j.msg ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data ?? j;
  }
}

export async function credits() {
  const d = await api(`${API}/api/v1/chat/credit`);
  return typeof d === 'number' ? d : (d.credits ?? d);
}

export async function upload(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  const d = await api(`${UPLOAD}/api/file-base64-upload`, {
    method: 'POST',
    body: JSON.stringify({ base64Data: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`, uploadPath: 'arcadeaday' }),
  });
  return d.downloadUrl;
}

async function runTask(model, input, label = model) {
  const { taskId } = await api(`${API}/api/v1/jobs/createTask`, { method: 'POST', body: JSON.stringify({ model, input }) });
  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    const d = await api(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    if (d.state === 'success') {
      const res = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
      return { taskId, urls: res.resultUrls || [] };
    }
    if (d.state === 'fail') throw new Error(`${label} failed: ${d.failMsg || d.failCode || 'unknown'} (task ${taskId})`);
    if (Date.now() - t0 > 6 * 60e3) throw new Error(`${label} timed out (task ${taskId})`);
  }
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// Square-fit resize with sips, then cwebp (keeps alpha). Long side capped at `max`.
export function optimize(src, out, { max = 512, q = 82 } = {}) {
  const tmp = path.join(os.tmpdir(), `kie-${process.pid}-${Date.now()}.png`);
  fs.copyFileSync(src, tmp);
  execFileSync('sips', ['-s', 'format', 'png', '-Z', String(max), tmp, '--out', tmp], { stdio: 'ignore' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '90', '-m', '6', tmp, '-o', out]);
  fs.unlinkSync(tmp);
  return fs.statSync(out).size;
}

export async function generate({ prompt, aspect = '1:1', res = '1K', model = 'nano-banana-2', refs = [], cutout = false }) {
  const input = { prompt, aspect_ratio: aspect, resolution: res, output_format: 'png' };
  if (refs.length) input.image_input = await Promise.all(refs.map(upload));
  const g = await runTask(model, input, 'generate');
  let url = g.urls[0];
  const tasks = [g.taskId];
  if (cutout) {
    const c = await runTask('recraft/remove-background', { image: url }, 'cutout');
    url = c.urls[0]; tasks.push(c.taskId);
  }
  return { url, tasks };
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
    } else o._.push(a);
  }
  return o;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(e => ({ error: e.message })); }
  }));
  return out;
}

async function batch(specFile, { force = false, only = null } = {}) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const base = path.dirname(specFile);
  const outDir = spec.outDir ? path.resolve(spec.outDir) : base;
  // raw PNGs stay out of games/ (they would ship): studio/art-raw/<outDir name>/
  const rawDir = spec.rawDir ? path.resolve(spec.rawDir) : path.resolve('studio/art-raw', path.basename(path.dirname(outDir)), path.basename(outDir));
  const D = { aspect: '1:1', res: '1K', cutout: false, max: 512, q: 82, model: 'nano-banana-2', ...(spec.defaults || {}) };
  const manifestFile = specFile.replace(/\.json$/, '') + '.manifest.json';
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const items = spec.items.filter(it => !only || only.includes(it.id));
  const before = await credits().catch(() => null);
  const results = await pool(items, 4, async it => {
    const o = { ...D, ...it };
    const raw = path.join(rawDir, `${it.id}.png`), web = path.join(outDir, `${it.id}.webp`);
    if (!force && fs.existsSync(web)) return { id: it.id, skipped: true };
    const prompt = [spec.style, o.prompt].filter(Boolean).join('\n\n');
    const refs = [...(spec.refs || []), ...(it.refs || [])].map(r => path.resolve(base, r));
    const g = await generate({ prompt, aspect: o.aspect, res: o.res, model: o.model, refs, cutout: o.cutout });
    await download(g.url, raw);
    const bytes = optimize(raw, web, { max: o.max, q: o.q });
    manifest[it.id] = { prompt: o.prompt, aspect: o.aspect, model: o.model, cutout: o.cutout, max: o.max, tasks: g.tasks, bytes, at: new Date().toISOString() };
    console.log(`✓ ${it.id}  ${(bytes / 1024).toFixed(1)} KB`);
    return { id: it.id, bytes };
  });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const after = await credits().catch(() => null);
  const failed = results.filter(r => r.error);
  results.forEach((r, k) => r.error && console.error(`✗ ${items[k].id}: ${r.error}`));
  console.log(`done: ${results.filter(r => r.bytes).length} made, ${results.filter(r => r.skipped).length} skipped, ${failed.length} failed` +
    (before != null && after != null ? `; credits ${before} → ${after} (used ${(before - after).toFixed(1)})` : ''));
  if (failed.length) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest);
try {
  if (cmd === 'credits') console.log(`credits: ${await credits()}`);
  else if (cmd === 'gen') {
    if (!a.prompt || !a.out) throw new Error('gen needs --prompt and --out');
    const g = await generate({ prompt: a.prompt, aspect: a.aspect, res: a.res, model: a.model, cutout: !!a.cutout,
      refs: a.ref ? String(a.ref).split(',') : [] });
    const out = path.resolve(a.out);
    if (out.endsWith('.webp')) { const raw = path.resolve('studio/art-raw/adhoc', path.basename(out).replace(/\.webp$/, '.png')); await download(g.url, raw); optimize(raw, out, { max: +a.max || 512, q: +a.q || 82 }); }
    else await download(g.url, out);
    console.log(`✓ ${out}  (tasks ${g.tasks.join(', ')})`);
  } else if (cmd === 'cutout') {
    const [src, out] = a._;
    const c = await runTask('recraft/remove-background', { image: await upload(src) }, 'cutout');
    await download(c.urls[0], out); console.log(`✓ ${out}`);
  } else if (cmd === 'batch') await batch(a._[0], { force: !!a.force, only: a.only ? String(a.only).split(',') : null });
  else if (cmd === 'optimize') { const b = optimize(a._[0], a._[1], { max: +a.max || 512, q: +a.q || 82 }); console.log(`✓ ${a._[1]} ${(b / 1024).toFixed(1)} KB`); }
  else { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n')); }
} catch (e) { console.error(`kie: ${e.message}`); process.exitCode = 1; }
