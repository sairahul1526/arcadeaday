// Slow hand: a casual bot held back to a first-time player on a phone (m .55, lag .7 s, 35° aim error, a new look every .5 s).
// It answers one question verify does not ask: does the level a new player meets still end in a win? No gate reads it yet.
//   node tools/slurp-pot/slow-hand.mjs 2-10            table at the stored T and grace, 30 runs each
//   node tools/slurp-pot/slow-hand.mjs 6,7 --need 24   adds the least grace that gives 24 wins of the runs
//   node tools/slurp-pot/slow-hand.mjs 2-60 --table studio/2026-11-06/fix1/mercy-table.txt   mercy clock table, two seed sets
//   options: --runs 30  --from 1 (first bot seed)  --jobs 3  --set 7:28,8:47 (try a grace, pace T kept, nothing written)
//   --times PATH  keeps the --table finish times there and reuses them, so a new MERCY_STEP in mercy.js costs seconds. Delete it when a level
//   or MERCY_GROW changes.
// Grace changes nothing the bot sees until the pace clock runs out: hurry reads tLeft − grace and the sizzle cap reads T − grace.
// So one run at a huge grace gives the finish time for every grace, and --need reads the answer straight off the sorted times.
// --need is a prediction; rerun with --set or after writing levels-data.js for the real count.
// Mercy v2 (mercy.js, round 2): --table plays withMercy(level, step) itself, the copy the game plays, with OPEN added to T and to grace so the
// bot is never cut off. A bigger pot at steps 2 and 3 is a different run, so each pot size gets its own runs; the steps that share a pot share them.
// Mercy's seconds only move the line the finish time has to beat, which is why MERCY_STEP can change without new runs.
// "fails" in the table: a slow hand as slow as its own median run at each step. "fresh": every try a new roll at that step's win rate, the
// fails until half of them have won. Neither counts a player getting better, or a continue. Spoiled or unfinished runs never win.
// Carry: the walk from L2 to L60 in order, as game.js plays it. A time-out raises the step, a spoiled run does not, a win hands
// carryAfterWin(step) to the next level. Each walker rolls from the same seeds, whatever MERCY_STEP is, so two tables compare.
// Daily rows: sample Dailies, same runs, walked from step 0 (a Daily takes save.help, so 0 is the slow hand's worst case).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import * as L from '../../games/slurp-pot/logic.js';
import { SPECS } from '../../games/slurp-pot/levels-data.js';
import { MERCY_MAX, MERCY_STEP, MERCY_GROW, carryAfterWin, mercyGrow, mercySecs, withMercy } from '../../games/slurp-pot/mercy.js';

const SLOW = { m: .55, lag: .7, sigma: 35 * Math.PI / 180, every: .5 };
const OPEN = 400, DT = 1 / 60;
const FLOOR = 15, FRESH_MAX = 20, TRY_MAX = 30;
const DAILIES = ['2026-11-08', '2026-12-25', '2027-02-14'].flatMap(k => [7, 21, 45].map(c => `${k}:${c}`));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const runs = +opt('runs', 30), from = +opt('from', 1), jobs = +opt('jobs', 3), need = +opt('need', 0), table = opt('table', ''), timesPath = opt('times', '');
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

// Clock used by each bot, or null if it spoiled or never finished. lv is whatever the game would play.
function openTimes(lv, first, n) {
  const open = { ...lv, T: lv.T + OPEN, grace: (lv.grace > 0 ? lv.grace : 0) + OPEN }, ts = [];
  for (let sd = first; sd < first + n; sd++) { const r = playOnce(open, sd); ts.push(r.win ? r.t : null); }
  return ts;
}
const steps = [...Array(MERCY_MAX + 1).keys()];
// Finish times by step over both seed sets, and the pot each step starts with.
function mercyTimes(lv) {
  const byPot = new Map();
  return steps.map(k => { const g = mercyGrow(k); if (!byPot.has(g)) byPot.set(g, openTimes(withMercy(lv, k), from, 2 * runs)); return byPot.get(g); });
}
const beats = (t, T) => t !== null && t <= T + DT;   // the bite lands before the timeout check, so a bite on the frame the clock hits 0 still wins
const medOf = ts => { const v = ts.map(t => t === null ? Infinity : t).sort((a, b) => a - b); return v[Math.floor(.5 * (v.length - 1))]; };

function mercySet(r, half) {
  const part = ts => ts.slice(half * runs, (half + 1) * runs);
  const Ts = steps.map(k => withMercy(r.lv, k).T), wins = steps.map(k => part(r.times[k]).filter(t => beats(t, Ts[k])).length);
  const med = steps.map(k => medOf(part(r.times[k])));
  const hit = steps.findIndex(k => med[k] <= Ts[k] + DT);
  let left = 1, fresh = null;
  for (let k = 0; k <= FRESH_MAX && fresh === null; k++) { left *= 1 - wins[Math.min(k, MERCY_MAX)] / runs; if (left <= .5) fresh = k; }
  return { wins, med: med[0], fails: hit < 0 ? null : hit, fresh, never: part(r.times[0]).filter(t => t === null).length };
}
// One try's roll: the same for a walker, a level and a try whatever the mercy constants are.
const roll = (who, n, tryNo, N) => (who + 7 * (tryNo - 1) + 13 * n) % N;
// Play one level from a step. Returns tries, the winning step, and whether the player gave up at TRY_MAX.
function playLevel(r, who, start, N) {
  let k = start;
  for (let tr = 1; tr <= TRY_MAX; tr++) {
    const q = Math.min(k, MERCY_MAX), t = r.times[q][roll(who, r.n, tr, N)];
    if (beats(t, withMercy(r.lv, q).T)) return { tries: tr, step: k };
    if (t !== null) k++;   // a time-out raises the step; a spoiled run is the game's "no mercy" case
  }
  return { tries: TRY_MAX, step: k, stuck: true };
}
function carry(res) {
  const N = 2 * runs, per = new Map(res.map(r => [r.n, { tries: 0, start: 0, stuck: 0 }]));
  const totals = [];
  for (let who = 0; who < N; who++) {
    let step = 0, total = 0;
    for (const r of res) {
      const p = playLevel(r, who, step, N), c = per.get(r.n);
      c.tries += p.tries / N; c.start += step / N; if (p.stuck) c.stuck++;
      total += p.tries;
      step = carryAfterWin(p.step);
    }
    totals.push(total);
  }
  return { per, totals: totals.sort((a, b) => a - b) };
}
function dailyRow(r) {
  const N = 2 * runs, Ts = steps.map(k => withMercy(r.lv, k).T), wins = steps.map(k => r.times[k].filter(t => beats(t, Ts[k])).length);
  const tries = [];
  for (let who = 0; who < N; who++) tries.push(playLevel(r, who, 0, N).tries);
  const by = k => (100 * tries.filter(t => t <= k).length) / N;
  return { wins, mean: tries.reduce((a, b) => a + b, 0) / N, by2: by(2), by3: by(3) };
}

function measure(id) {
  if (String(id).includes(':')) {
    const [key, cur] = id.split(':'), lv = LV.getDaily(key, +cur);
    return { id, n: 0, town: lv.town, T: lv.T, grace: 0, pace: lv.T, step: mercySecs(lv, 1), times: mercyTimes(lv) };
  }
  const n = +id, s = SPECS.find(q => q.n === n), pace = s.T - graceOf(s);
  if (table) { const lv = LV.getLevel(n); return { id, n, T: s.T, grace: graceOf(s), pace, step: mercySecs(lv, 1), times: mercyTimes(lv) }; }
  const g = n in set ? set[n] : graceOf(s);
  const lv = LV.genLevel({ ...s, T: pace + g, grace: g || undefined }, s.seed);
  const st = [0, 0, 0, 0], times = [];
  for (let sd = from; sd < from + runs; sd++) { const r = playOnce(lv, sd); st[r.stars]++; if (r.win) times.push(r.t); }
  const out = { id, n, T: lv.T, grace: g, pace, wins: runs - st[0], stars: st.slice(1) };
  if (need) {
    const ts = openTimes(LV.genLevel(s, s.seed), from, runs).map(t => t === null ? Infinity : t).sort((a, b) => a - b);
    const q = p => ts[Math.floor(p * (runs - 1))];
    out.p50 = q(.5); out.p75 = q(.75); out.p90 = q(.9);
    const at = ts[need - 1];
    out.needGrace = Number.isFinite(at) ? Math.max(0, Math.ceil(at - pace)) : null;
    out.stuck = ts.filter(t => !Number.isFinite(t)).length;
  }
  return out;
}

const parse = a => a.split(',').flatMap(p => { const [x, y] = p.split('-').map(Number); return Array.from({ length: (y || x) - x + 1 }, (_, i) => x + i); });

if (argv[0] === '--one') { console.log(JSON.stringify(measure(argv[1]))); process.exit(0); }

const flags = [], pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) flags.push(argv[i], argv[++i]); else pos.push(argv[i]); }
const levels = parse(pos[0] || '2-20'), self = fileURLToPath(import.meta.url);
const ids = table ? [...levels.map(String), ...DAILIES] : levels.map(String);
let results = [];
if (timesPath && existsSync(timesPath)) results = JSON.parse(readFileSync(timesPath, 'utf8'));
else {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const txt = await new Promise((res, rej) => {
        const c = spawn(process.execPath, [self, '--one', id, ...flags], { stdio: ['ignore', 'pipe', 'inherit'] });
        let o = ''; c.stdout.on('data', d => o += d);
        c.on('close', code => code ? rej(new Error(id + ' exit ' + code)) : res(o));
      });
      results.push(JSON.parse(txt));
    }
  }));
  if (timesPath) writeFileSync(timesPath, JSON.stringify(results));
}
results.sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : 1));
const f = t => t === undefined ? '' : Number.isFinite(t) ? t.toFixed(0) : 'never';
if (table) {
  const pad = (v, w) => String(v).padStart(w);
  for (const r of results) { const [key, cur] = String(r.id).split(':'); r.lv = r.n ? LV.getLevel(r.n) : LV.getDaily(key, +cur); }
  const camp = results.filter(r => r.n), days = results.filter(r => !r.n), { per, totals } = carry(camp);
  const cell = a => `${a.wins.map(v => pad(v, 2)).join(' ')}  ${pad(f(a.med), 5)} ${pad(a.fails ?? '>3', 3)} ${pad(a.fresh ?? `${FRESH_MAX}+`, 3)} ${pad(a.never, 2)}`;
  const lines = [`Slow hand against mercy v2, ${runs} runs a set, bots ${from}-${from + runs - 1} and ${from + runs}-${from + 2 * runs - 1}. MERCY_STEP ${MERCY_STEP}, MERCY_GROW ${MERCY_GROW.join(' ')}, played as withMercy(level, step).`,
    `wins at T / step 1 / 2 / 3, median finish s at T, fails (as slow as its median), fresh (new roll each try), never = spoiled or unfinished. from = mean carried step on arrival, tries = mean tries in the carry walk.`,
    `level   T  gr pace step | set 1: T  1  2  3    med  fl  fr nv | set 2: T  1  2  3    med  fl  fr nv | from tries | under ${FLOOR} at step 3`];
  const under = [], either = [];
  for (const r of camp) {
    const A = mercySet(r, 0), Z = mercySet(r, 1), a = A.wins[3] < FLOOR, b = Z.wins[3] < FLOOR, c = per.get(r.n);
    if (a && b) under.push('L' + r.n); else if (a || b) either.push('L' + r.n);
    lines.push(`L${pad(r.n, 2)}   ${pad(r.T, 3)} ${pad(r.grace, 3)} ${pad(r.pace, 4)} ${pad(mercySecs(r.lv, 1), 4)} |        ${cell(A)} |        ${cell(Z)} | ${c.start.toFixed(1).padStart(4)} ${c.tries.toFixed(2).padStart(5)} | ${a && b ? 'BOTH' : a || b ? 'one set' : ''}${c.stuck ? ` ${c.stuck} walkers stuck` : ''}`);
  }
  const mean = (a, b) => { const v = camp.filter(r => r.n >= a && r.n <= b).map(r => per.get(r.n).tries); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : 0; };
  const worst = camp.map(r => [r.n, per.get(r.n).tries]).sort((p, q) => q[1] - p[1]).slice(0, 5).map(([n, t]) => `L${n} ${t.toFixed(2)}`).join(', ');
  lines.push('', `Under ${FLOOR}/${runs} at step 3 on both sets (${under.length}): ${under.join(' ') || 'none'}`, `Under on one set only (${either.length}): ${either.join(' ') || 'none'}`, '',
    `Carry walk, ${2 * runs} walkers, L${camp[0].n} to L${camp[camp.length - 1].n} in order, a new roll each try:`,
    `mean tries a level: L2-10 ${mean(2, 10).toFixed(2)}, L11-20 ${mean(11, 20).toFixed(2)}, L21-40 ${mean(21, 40).toFixed(2)}, L41-60 ${mean(41, 60).toFixed(2)}, all ${mean(2, 60).toFixed(2)}`,
    `total tries: median ${totals[totals.length >> 1]}, best ${totals[0]}, worst ${totals[totals.length - 1]} (${camp.length} levels)`, `hardest in the walk: ${worst}`, '',
    `Dailies, ${2 * runs} runs each, from step 0 (a Daily takes save.help, so 0 is the worst case):`,
    `day:cur        town     T step | wins at T  1  2  3 | mean tries, won by try 2, by try 3`);
  const dr = days.map(r => ({ r, d: dailyRow(r) }));
  for (const { r, d } of dr) lines.push(`${String(r.id).padEnd(14)} ${String(r.town).padEnd(7)} ${pad(r.T, 3)} ${pad(mercySecs(r.lv, 1), 4)} |    ${d.wins.map(v => pad(v, 3)).join('')} | ${d.mean.toFixed(2)}  ${d.by2.toFixed(0)} %  ${d.by3.toFixed(0)} %`);
  if (dr.length) lines.push(`all sample Dailies: mean ${(dr.reduce((p, q) => p + q.d.mean, 0) / dr.length).toFixed(2)} tries, won by try 2 ${(dr.reduce((p, q) => p + q.d.by2, 0) / dr.length).toFixed(0)} %, by try 3 ${(dr.reduce((p, q) => p + q.d.by3, 0) / dr.length).toFixed(0)} %`);
  const txt = lines.join('\n') + '\n';
  writeFileSync(table, txt);
  process.stdout.write(txt);
  process.exit(0);
}
for (const r of results) {
  console.log(`L${r.n} T ${r.T} grace ${r.grace} pace ${r.pace}  wins ${r.wins}/${runs}  stars 1/2/3 ${r.stars.join('/')}` +
    (need ? `  finish p50/75/90 ${f(r.p50)}/${f(r.p75)}/${f(r.p90)}  need grace ${r.needGrace ?? 'none'}  stuck ${r.stuck}` : ''));
}
