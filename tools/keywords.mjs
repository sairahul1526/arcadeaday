// Keyword research for a new game's page. Uses DataForSEO (real US search volume and
// difficulty) when DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are set in .env or the environment,
// otherwise falls back to Google autocomplete (proves demand exists, no volumes).
// usage: node tools/keywords.mjs "frog game" "swing game online" ...   (max 6 seeds per run)
import { readFile } from 'node:fs/promises';

try {
  for (const line of (await readFile('.env', 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const seeds = process.argv.slice(2).slice(0, 6);
if (!seeds.length) {
  console.error('usage: node tools/keywords.mjs "seed one" "seed two" ...');
  process.exit(1);
}
const { DATAFORSEO_LOGIN: login, DATAFORSEO_PASSWORD: pass } = process.env;

async function dfs(path, body) {
  const res = await fetch('https://api.dataforseo.com/v3/' + path, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${login}:${pass}`).toString('base64'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  const t = j.tasks?.[0];
  if (!res.ok || !t || t.status_code !== 20000) throw new Error(`DataForSEO ${path}: ${t?.status_message || j.status_message || res.status}`);
  return t.result || [];
}

const row = (kw, vol, kd, cpc) => console.log(`${String(vol ?? '-').padStart(8)}  ${String(kd ?? '-').padStart(3)}  ${String(cpc ?? '-').padStart(5)}  ${kw}`);

if (login && pass) {
  console.log('source: DataForSEO (United States, English). columns: monthly volume, difficulty 0-100, CPC $\n');
  const where = { location_code: 2840, language_code: 'en' };
  const [ov] = await dfs('dataforseo_labs/google/keyword_overview/live', [{ keywords: seeds, ...where }]);
  console.log('== seeds');
  for (const it of ov?.items || []) row(it.keyword, it.keyword_info?.search_volume, it.keyword_properties?.keyword_difficulty, it.keyword_info?.cpc);
  for (const seed of seeds) {
    const [r] = await dfs('dataforseo_labs/google/keyword_suggestions/live', [{ keyword: seed, ...where, limit: 25, order_by: ['keyword_info.search_volume,desc'] }]);
    console.log(`\n== suggestions for "${seed}"`);
    for (const it of r?.items || []) row(it.keyword, it.keyword_info?.search_volume, it.keyword_properties?.keyword_difficulty, it.keyword_info?.cpc);
  }
} else {
  console.log('source: Google autocomplete (no DATAFORSEO_* creds, so no volumes). More completions = more demand.\n');
  for (const seed of seeds) {
    const out = new Set();
    for (const q of [seed, seed + ' online', seed + ' free']) {
      const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(q)}`);
      for (const s of (await res.json())[1] || []) out.add(s);
    }
    console.log(`== ${seed} (${out.size})\n  ${[...out].join('\n  ') || '(no completions: little or no demand)'}\n`);
  }
}
