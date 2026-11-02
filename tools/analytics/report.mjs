#!/usr/bin/env node
// Arcade a Day analytics report: reads the D1 events table (tools/analytics/schema.sql, filled by functions/api/ev.js)
// and prints a markdown summary per game: sessions, session length, returning players, referrers, and the level
// funnel with the biggest drop-off (PLAYBOOK §11 pillar 4).
//
//   node tools/analytics/report.mjs                  # last 7 IST days, every game, arcadeaday.com only
//   node tools/analytics/report.mjs --days 30 --game knot-kitty
//   node tools/analytics/report.mjs --previews       # *.pages.dev previews only (phone tests)
//   node tools/analytics/report.mjs --local          # the wrangler pages dev database

import { execFileSync } from 'node:child_process';

const DB = 'arcadeaday-events';
const IST = 5.5 * 3600e3;
const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const days = Math.max(1, parseInt(opt('--days', '7'), 10) || 7);
const game = opt('--game', '');
const local = args.includes('--local');
const previews = args.includes('--previews');
if (game && !/^[a-z0-9-]{1,40}$/.test(game)) { console.error('bad --game'); process.exit(1); }

const istDay = ms => new Date(ms + IST).toISOString().slice(0, 10);
const since = istDay(Date.now() - (days - 1) * 864e5);
const where = [
  `day >= '${since}'`,
  local ? '1' : previews ? `host LIKE '%.pages.dev'` : `host IN ('arcadeaday.com', 'www.arcadeaday.com')`,
  game ? `game = '${game}'` : '1',
].join(' AND ');

function q(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out)[0].results;
}

const sessions = q(`SELECT game, s, MIN(day) AS day, MIN(age) AS age, MAX(mob) AS mob,
  MAX(CASE WHEN e = 'session_end' THEN CAST(json_extract(d, '$.secs') AS INTEGER) END) AS secs,
  MAX(CASE WHEN e = 'session_start' THEN json_extract(d, '$.ref') END) AS ref
  FROM ev WHERE ${where} AND s IS NOT NULL GROUP BY game, s LIMIT 500000`);
const levels = q(`SELECT game, lvl, e, COUNT(*) AS n, COUNT(DISTINCT s) AS u FROM ev
  WHERE ${where} AND lvl IS NOT NULL AND e IN ('level_start', 'level_complete', 'level_fail', 'quit_level')
  GROUP BY game, lvl, e`);

const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
const dur = s => (s == null ? '–' : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
const median = xs => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };
const byLevel = (a, b) => { const x = Number(a), y = Number(b); return isNaN(x) || isNaN(y) ? String(a).localeCompare(String(b)) : x - y; };

const games = [...new Set([...sessions.map(r => r.game), ...levels.map(r => r.game)])].sort();
const scope = local ? 'local' : previews ? '*.pages.dev previews' : 'arcadeaday.com';
const lines = [`# Arcade a Day analytics · last ${days} days (${since} → ${istDay(Date.now())}, IST) · ${scope}`, ''];
if (!games.length) lines.push('No events yet.');

for (const g of games) {
  const ss = sessions.filter(r => r.game === g);
  const secs = ss.map(r => r.secs).filter(v => v != null);
  const ret = ss.filter(r => r.age >= 1).length;
  const refs = {};
  ss.forEach(r => { if (r.ref) refs[r.ref] = (refs[r.ref] || 0) + 1; });
  const topRefs = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => `${h} ${n}`).join(', ') || 'none';
  lines.push(`## ${g}`, '');
  lines.push(`- sessions ${ss.length} · median length ${dur(median(secs))} · returning (day 1+) ${pct(ret, ss.length)} · touch ${pct(ss.filter(r => r.mob).length, ss.length)}`);
  lines.push(`- top referrers: ${topRefs}`);
  const perDay = {};
  ss.forEach(r => { perDay[r.day] = (perDay[r.day] || 0) + 1; });
  lines.push(`- sessions per day: ${Object.keys(perDay).sort().map(d => `${d.slice(5)} ${perDay[d]}`).join(' · ') || '–'}`);
  const ages = { 'day 0': 0, 'day 1': 0, 'days 2–6': 0, 'day 7+': 0 };
  ss.forEach(r => { const a = r.age ?? 0; ages[a === 0 ? 'day 0' : a === 1 ? 'day 1' : a < 7 ? 'days 2–6' : 'day 7+']++; });
  lines.push(`- sessions by player age: ${Object.entries(ages).map(([k, n]) => `${k} ${n}`).join(' · ')}`, '');

  const lv = {};
  levels.filter(r => r.game === g).forEach(r => { (lv[r.lvl] ||= {})[r.e] = r; });
  const ids = Object.keys(lv).sort(byLevel);
  if (ids.length) {
    lines.push('| level | players | starts | wins | fails | quits | win rate | players reaching next |', '|---|---|---|---|---|---|---|---|');
    let worst = null;
    const last = Math.max(...ids.map(Number).filter(n => !isNaN(n)));
    ids.forEach(id => {
      const r = lv[id], u = r.level_start?.u || 0, st = r.level_start?.n || 0, w = r.level_complete?.n || 0;
      const n1 = String(Number(id) + 1);
      const next = !isNaN(Number(id)) && Number(id) < last ? lv[n1]?.level_start?.u || 0 : null;
      if (next != null && u >= 10) { const drop = 1 - next / u; if (!worst || drop > worst.drop) worst = { id, next: n1, drop }; }
      lines.push(`| ${id} | ${u} | ${st} | ${w} | ${r.level_fail?.n || 0} | ${r.quit_level?.n || 0} | ${pct(w, st)} | ${next == null ? '–' : pct(next, u)} |`);
    });
    lines.push('');
    if (worst) lines.push(`Biggest drop: level ${worst.id} → ${worst.next} (${Math.round(worst.drop * 100)}% of players stop).`, '');
  }
}
console.log(lines.join('\n'));
