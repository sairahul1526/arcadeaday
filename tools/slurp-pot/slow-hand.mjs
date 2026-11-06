// Slow hand: a casual bot held back to a first-time player on a phone (m .55, lag .7 s, 35° aim error, a new look every .5 s).
// It answers one question verify does not ask: does the level a new player meets still end in a win? No gate reads it yet.
//   node tools/slurp-pot/slow-hand.mjs 2-10            table at the stored T and grace, 30 runs each
//   node tools/slurp-pot/slow-hand.mjs 6,7 --need 24   adds the least grace that gives 24 wins of the runs
//   node tools/slurp-pot/slow-hand.mjs 2-60 --table studio/2026-11-06/fix1/mercy-table.txt   mercy clock table, two seed sets
//   options: --runs 30  --from 1 (first bot seed)  --jobs 3  --set 7:28,8:47 (try a grace, pace T kept, nothing written)
// Grace changes nothing the bot sees until the pace clock runs out: hurry reads tLeft − grace and the sizzle cap reads T − grace.
// So one run at a huge grace gives the finish time for every grace, and --need reads the answer straight off the sorted times.
// --need is a prediction; rerun with --set or after writing levels-data.js for the real count.
// Mercy (game.js): each straight fail on a level adds min(fails, 3) · round(.4 · pace) s to T and to grace, so the pace stays. That is
// more grace, so --table reads wins at each step off the same finish times. It plays each seed set once, at no time limit.
// "fails" in the table: a slow hand as slow as its own median run, every try. "fresh": every try a new roll at that step's win rate, the
// fails until half of them have won. Neither counts a player getting better, or a continue. Spoiled or unfinished runs never win.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import * as L from '../../games/slurp-pot/logic.js';
import { SPECS } from '../../games/slurp-pot/levels-data.js';

const SLOW = { m: .55, lag: .7, sigma: 35 * Math.PI / 180, every: .5 };
const OPEN = 400, DT = 1 / 60;
const MERCY_STEPS = 3, MERCY_K = .4, FLOOR = 15, FRESH_MAX = 20;

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const runs = +opt('runs', 30), from = +opt('from', 1), jobs = +opt('jobs', 3), need = +opt('need', 0), table = opt('table', '');
const set = Object.fromEntries(String(opt('set', '')).split(',').filter(Boolean).map(a => a.split(':').map(Number)));
const graceOf = s => +s.grace || 0;

function playOnce(lv, sd) {
  const w = L.createWorld(lv, { mode: 'level' }), b = B.createBot('casual', sd, { P: SLOW });
  for (let k = 0; k < (lv.T + 20) * 60 && !w.result; k++) {
    const i = B.decide(b, w, DT);
    L.step(w, { x: i.x, z: i.z, m: i.m }, DT);
    w.events.length = 0;
  }
  return { win: w.result === 'win', stars: w.result === 'win' ? L.starsFor(w) : 0, t: lv.T - w.tLeft };
}

const mercyOf = (pace, fails) => Math.min(fails, MERCY_STEPS) * Math.round(MERCY_K * pace);

function finishTimes(s, pace, first) {
  const open = LV.genLevel({ ...s, T: pace + OPEN, grace: OPEN }, s.seed), ts = [];
  for (let sd = first; sd < first + runs; sd++) { const r = playOnce(open, sd); ts.push(r.win ? r.t : Infinity); }
  return ts.sort((a, b) => a - b);
}

function mercySet(s, pace, first) {
  const ts = finishTimes(s, pace, first), med = ts[Math.floor(.5 * (runs - 1))];
  const steps = [0, 1, 2, 3].map(k => s.T + mercyOf(pace, k));
  const beats = (t, T) => t <= T + DT;   // the bite lands before the timeout check, so a bite on the frame the clock hits 0 still wins
  const wins = steps.map(T => ts.filter(t => beats(t, T)).length);
  const hit = steps.findIndex(T => beats(med, T));
  let left = 1, fresh = null;
  for (let k = 0; k <= FRESH_MAX && fresh === null; k++) { left *= 1 - wins[Math.min(k, MERCY_STEPS)] / runs; if (left <= .5) fresh = k; }
  return { wins, med, fails: hit < 0 ? null : hit, fresh, never: ts.filter(t => !Number.isFinite(t)).length };
}

function measure(n) {
  const s = SPECS.find(q => q.n === n), pace = s.T - graceOf(s);
  if (table) return { n, T: s.T, grace: graceOf(s), pace, step: mercyOf(pace, 1), sets: [mercySet(s, pace, from), mercySet(s, pace, from + runs)] };
  const g = n in set ? set[n] : graceOf(s);
  const lv = LV.genLevel({ ...s, T: pace + g, grace: g || undefined }, s.seed);
  const st = [0, 0, 0, 0], times = [];
  for (let sd = from; sd < from + runs; sd++) { const r = playOnce(lv, sd); st[r.stars]++; if (r.win) times.push(r.t); }
  const out = { n, T: lv.T, grace: g, pace, wins: runs - st[0], stars: st.slice(1) };
  if (need) {
    const ts = finishTimes(s, pace, from);
    const q = p => ts[Math.floor(p * (runs - 1))];
    out.p50 = q(.5); out.p75 = q(.75); out.p90 = q(.9);
    const at = ts[need - 1];
    out.needGrace = Number.isFinite(at) ? Math.max(0, Math.ceil(at - pace)) : null;
    out.stuck = ts.filter(t => !Number.isFinite(t)).length;
  }
  return out;
}

const parse = a => a.split(',').flatMap(p => { const [x, y] = p.split('-').map(Number); return Array.from({ length: (y || x) - x + 1 }, (_, i) => x + i); });

if (argv[0] === '--one') { console.log(JSON.stringify(measure(+argv[1]))); process.exit(0); }

const flags = [], pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) flags.push(argv[i], argv[++i]); else pos.push(argv[i]); }
const levels = parse(pos[0] || '2-20'), self = fileURLToPath(import.meta.url);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, levels.length) }, async () => {
  while (next < levels.length) {
    const n = levels[next++];
    const txt = await new Promise((res, rej) => {
      const c = spawn(process.execPath, [self, '--one', String(n), ...flags], { stdio: ['ignore', 'pipe', 'inherit'] });
      let o = ''; c.stdout.on('data', d => o += d);
      c.on('close', code => code ? rej(new Error('L' + n + ' exit ' + code)) : res(o));
    });
    results.push(JSON.parse(txt));
  }
}));
results.sort((a, b) => a.n - b.n);
const f = t => t === undefined ? '' : Number.isFinite(t) ? t.toFixed(0) : 'never';
if (table) {
  const pad = (v, w) => String(v).padStart(w);
  const cell = a => `${a.wins.map(v => pad(v, 2)).join(' ')}  ${pad(f(a.med), 5)} ${pad(a.fails ?? '>3', 3)} ${pad(a.fresh ?? `${FRESH_MAX}+`, 3)} ${pad(a.never, 2)}`;
  const lines = [`Slow hand against the mercy clock, ${runs} runs a set, bots ${from}-${from + runs - 1} and ${from + runs}-${from + 2 * runs - 1}. Step k: T + k · round(.4 · pace), T and grace both.`,
    `wins at T / step 1 / 2 / 3, median finish s, fails (as slow as its median), fresh (new roll each try), never = spoiled or unfinished.`,
    `level   T  gr pace step | set 1: T  1  2  3    med  fl  fr nv | set 2: T  1  2  3    med  fl  fr nv | under ${FLOOR} at step 3`];
  const under = [], either = [];
  for (const r of results) {
    const a = r.sets[0].wins[3] < FLOOR, b = r.sets[1].wins[3] < FLOOR;
    if (a && b) under.push('L' + r.n); else if (a || b) either.push('L' + r.n);
    lines.push(`L${pad(r.n, 2)}   ${pad(r.T, 3)} ${pad(r.grace, 3)} ${pad(r.pace, 4)} ${pad(r.step, 4)} |        ${cell(r.sets[0])} |        ${cell(r.sets[1])} | ${a && b ? 'BOTH' : a || b ? 'one set' : ''}`);
  }
  lines.push('', `Under ${FLOOR}/${runs} at step 3 on both sets (${under.length}): ${under.join(' ') || 'none'}`, `Under on one set only (${either.length}): ${either.join(' ') || 'none'}`);
  const txt = lines.join('\n') + '\n';
  writeFileSync(table, txt);
  process.stdout.write(txt);
  process.exit(0);
}
for (const r of results) {
  console.log(`L${r.n} T ${r.T} grace ${r.grace} pace ${r.pace}  wins ${r.wins}/${runs}  stars 1/2/3 ${r.stars.join('/')}` +
    (need ? `  finish p50/75/90 ${f(r.p50)}/${f(r.p75)}/${f(r.p90)}  need grace ${r.needGrace ?? 'none'}  stuck ${r.stuck}` : ''));
}
