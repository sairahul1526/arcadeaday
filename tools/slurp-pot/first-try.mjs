// First-try tension (FIX-LIST-7 A1, 2026-11-09). The average hand (bots.js 'average', the hand __qaSteer('average', 'normal')
// plays for the kid and mobile critics) won L1-L23 on the first try every time, so the panel saw no tension.
// This tool plays the average hand and the slow hand (slow-hand.mjs's model) at an open clock, and reads straight off the
// sorted finish times the first-try cut that makes the average hand lose about `lose` of its first tries:
//   T0 = the average hand's (1 − lose) quantile finish, cut = T − T0 (never below 0, never under FIRST_MIN s of clock).
// The cut is spec.first; mercy.js firstTry() plays it only on a clean first try (no help carried, no calm flag), as negative
// grace, so the 3★ line (the pace) does not move. A retry is the stored level, so every bot gate and slow-hand table holds.
//   node tools/slurp-pot/first-try.mjs 5-39 [--runs 40] [--jobs 3] [--write]
// Spike levels (every 5th) lose `spike` instead. Prints per level: T, pace, cut, avg first-try wins, slow-hand wins at T0 and at T.
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import * as L from '../../games/slurp-pot/logic.js';
import { SPECS } from '../../games/slurp-pot/levels-data.js';

const SLOW = { m: .55, lag: .7, sigma: 35 * Math.PI / 180, every: .5 };
const OPEN = 400, DT = 1 / 60, FIRST_MIN = 30;
const LOSE = .2, SPIKE = .35, isSpike = n => n % 5 === 0;
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const runs = +opt('runs', 40), jobs = +opt('jobs', 3), write = argv.includes('--write');

function finish(lv, kind, sd, P) {
  const open = { ...lv, T: lv.T + OPEN, grace: (lv.grace > 0 ? lv.grace : 0) + OPEN };
  const w = L.createWorld(open, { mode: 'level' }), b = B.createBot(kind, sd, P ? { P } : {});
  for (let k = 0; k < (open.T + 20) * 60 && !w.result; k++) {
    const i = B.decide(b, w, DT); L.step(w, { x: i.x, z: i.z, m: i.m }, DT); w.events.length = 0;
  }
  return w.result === 'win' ? open.T - w.tLeft : null;
}
function measure(n) {
  const lv = LV.getLevel(n), avg = [], slow = [];
  for (let sd = 1; sd <= runs; sd++) { avg.push(finish(lv, 'average', 1000 + sd)); slow.push(finish(lv, 'casual', sd, SLOW)); }
  return { n, avg, slow };
}

if (process.argv.includes('--child')) {
  process.on('message', n => process.send(measure(n)));
} else {
  const ids = [];
  for (const part of String(argv.find(a => /^\d/.test(a)) || '5-39').split(',')) {
    const [a, b] = part.split('-').map(Number); for (let n = a; n <= (b || a); n++) ids.push(n);
  }
  const out = [], q = ids.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, ids.length) }, () => new Promise(res => {
    const c = fork(fileURLToPath(import.meta.url), ['--child', '--runs', String(runs)], { stdio: 'inherit' });
    const next = () => { const n = q.shift(); if (n === undefined) { c.kill(); res(); } else c.send(n); };
    c.on('message', r => { out.push(r); next(); }); next();
  })));
  out.sort((a, b) => a.n - b.n);
  const fin = ts => ts.map(t => t === null ? Infinity : t).sort((a, b) => a - b);
  const wins = (ts, T) => ts.filter(t => t !== null && t <= T + DT).length;
  const cuts = {};
  console.log('  n   T  pace  cut   T0 | avg@T0 avg@T | slow@T0 slow@T');
  for (const r of out) {
    const s = SPECS.find(x => x.n === r.n), g = s.grace > 0 ? s.grace : 0, pace = s.T - g;
    const a = fin(r.avg), lose = isSpike(r.n) ? SPIKE : LOSE;
    let T0 = Math.ceil(a[Math.min(a.length - 1, Math.floor((1 - lose) * a.length))]);
    if (!isFinite(T0)) T0 = s.T;
    T0 = Math.max(FIRST_MIN, Math.min(s.T, T0));
    const cut = s.T - T0; cuts[r.n] = cut;
    console.log(`${String(r.n).padStart(3)} ${String(s.T).padStart(3)} ${String(pace).padStart(5)} ${String(cut).padStart(4)} ${String(T0).padStart(4)} | ${String(wins(r.avg, T0)).padStart(3)}/${runs} ${String(wins(r.avg, s.T)).padStart(3)}/${runs} | ${String(wins(r.slow, T0)).padStart(3)}/${runs} ${String(wins(r.slow, s.T)).padStart(3)}/${runs}`);
  }
  if (write) {
    const path = fileURLToPath(new URL('../../games/slurp-pot/levels-data.js', import.meta.url));
    const src = readFileSync(path, 'utf8').split('\n').map(line => {
      const m = line.match(/^\s*\{"n":(\d+),/); if (!m || !(+m[1] in cuts)) return line;
      const o = JSON.parse(line.trim().replace(/,$/, '')); if (cuts[o.n] > 0) o.first = cuts[o.n]; else delete o.first;
      return '  ' + JSON.stringify(o) + ',';
    });
    writeFileSync(path, src.join('\n'));
    console.log('wrote spec.first for', Object.keys(cuts).length, 'levels');
  }
  process.exit(0);
}
