// Slurp Pot fit test (GDD §3.2 QA test, Levels role). Node, no DOM.
// Usage: node tools/slurp-pot/fit-test.mjs [--pairs 10000] [--levels 1-60] [--quiet]
// 1. Meter vs fit: for random (level, r, a) with r and needR(a) inside [r0, rMaxShown], the HUD's
//    meterX(r) >= meterX(needR(a)) iff canFit(r, a). Outside that range the clamped meter is exactly 0 or 1.
// 2. Padlock: playing every level with the greedy bot (L1-10 also expert), the padlock event fires on exactly the
//    step where canFit(pot.r, boss.a) first holds with the ticket done, and the meter fill is at the boss mark then.
// Exits 1 on any failure.
// DECISION: pairs within 1e-9 of the fit edge (canFit's float tolerance) are counted as "edge band" and not failed:
// canFit allows a 1e-9 slack, and at r = needR(a) the two log values can differ by float rounding, so the meter
// can sit a hair under the boss mark while the boss already fits. Every 10th pair is drawn on that exact edge.
import * as L from '../../games/slurp-pot/logic.js';
import * as LV from '../../games/slurp-pot/levels.js';
import * as B from '../../games/slurp-pot/bots.js';
import { pathToFileURL } from 'node:url';

const DT = L.DT;

/** Deterministic PRNG (mulberry32), so the test is the same every run. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Meter range of a level: { r0, rm } exactly as the HUD gets it from a fresh world. */
function rangeOf(n) {
  const w = L.createWorld(LV.getLevel(n));
  return { n, r0: w.pot.r0, rm: L.rMaxShown(w) };
}

/** Test 1: meter vs canFit on random pairs. */
export function meterTest(levels, pairs = 10000, seed = 20261103) {
  const R = prng(seed), ranges = levels.map(rangeOf);
  const out = { pairs: 0, inside: 0, edge: 0, exact: 0, outside: 0, fails: [] };
  const fail = (msg) => { if (out.fails.length < 12) out.fails.push(msg); };
  for (let p = 0; p < pairs; p++) {
    const g = ranges[Math.floor(R() * ranges.length)];
    const lo = Math.log(g.r0), hi = Math.log(g.rm);
    // Every 10th pair is an exact-edge pair (r = needR(a)); every 5th is drawn on a wider range to test the clamp.
    const wide = p % 5 === 4;
    const span = wide ? 0.6 : 0;
    const r = Math.exp(lo - span + R() * (hi - lo + 2 * span));
    const needLog = lo - span + R() * (hi - lo + 2 * span);
    const a = p % 10 === 3 ? L.FIT * r : L.FIT * Math.exp(needLog);
    const need = L.needR(a);
    out.pairs++;
    const mr = L.meterX(r, g.r0, g.rm), mn = L.meterX(need, g.r0, g.rm);
    const inR = r >= g.r0 && r <= g.rm, inN = need >= g.r0 && need <= g.rm;
    if (!inR || !inN) {
      out.outside++;
      if (!inR && !(mr === (r < g.r0 ? 0 : 1))) fail(`L${g.n} r ${r} outside [${g.r0}, ${g.rm}] gives meter ${mr}, want ${r < g.r0 ? 0 : 1}`);
      if (!inN && !(mn === (need < g.r0 ? 0 : 1))) fail(`L${g.n} needR ${need} outside range gives meter ${mn}`);
      continue;
    }
    out.inside++;
    if (p % 10 === 3) out.exact++;
    const fits = L.canFit(r, a), shows = mr >= mn;
    if (fits === shows) continue;
    if (Math.abs(a - L.FIT * r) <= 1e-9) { out.edge++; continue; }
    fail(`L${g.n} r ${r} a ${a}: canFit ${fits} but meter ${mr.toFixed(6)} vs boss mark ${mn.toFixed(6)}`);
  }
  return out;
}

/** Test 2: padlock step on real play. */
export function padlockTest(n, kind = 'greedy', seed = 1) {
  const lv = LV.getLevel(n);
  const w = L.createWorld(lv, { mode: 'level' });
  const bot = B.createBot(kind, seed, {});
  const cap = Math.ceil(((lv.T || 120) * 1.1 + 30) / DT);
  const rm = L.rMaxShown(w);
  const res = { n, kind, padlocks: 0, fails: [], result: null };
  const fail = (m) => { if (res.fails.length < 4) res.fails.push(m); };
  for (let s = 0; s < cap && !w.result; s++) {
    const ti = w.ti, tk = w.tickets[ti];
    const wasOpen = tk ? tk.open : true;
    const inp = B.decide(bot, w, DT);
    L.step(w, { x: inp.x, z: inp.z, m: inp.m }, DT);
    const ev = w.events.filter(e => e.type === 'padlock');
    w.events.length = 0;
    if (!tk || tk.boss < 0) continue;
    const a = w._.a[tk.boss];
    const cond = tk.done && L.canFit(w.pot.r, a);
    if (ev.length) {
      res.padlocks++;
      if (ev.length > 1) fail(`step ${s}: ${ev.length} padlock events`);
      if (ev[0].i !== tk.boss) fail(`step ${s}: padlock on item ${ev[0].i}, ticket boss is ${tk.boss}`);
      if (wasOpen) fail(`step ${s}: padlock fired for an already open ticket ${ti}`);
      if (!cond) fail(`step ${s} t ${w.t.toFixed(2)}: padlock fired but done ${tk.done}, r ${w.pot.r.toFixed(4)} vs needR ${L.needR(a).toFixed(4)}`);
      const mr = L.meterX(w.pot.r, w.pot.r0, rm), mb = L.meterX(L.needR(a), w.pot.r0, rm);
      if (mr + 1e-9 < mb) fail(`step ${s}: padlock fired with the meter ${mr.toFixed(4)} below the boss mark ${mb.toFixed(4)}`);
    } else if (!wasOpen && cond && !tk.open) {
      fail(`step ${s} t ${w.t.toFixed(2)}: ticket ${ti} done and canFit (r ${w.pot.r.toFixed(4)} ≥ ${L.needR(a).toFixed(4)}) but no padlock`);
    } else if (!wasOpen && tk.open) {
      fail(`step ${s}: ticket ${ti} opened without a padlock event`);
    }
  }
  res.result = w.result || 'maxT';
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const pairs = +opt('--pairs', 10000);
  const [a, b] = String(opt('--levels', `1-${LV.LEVEL_COUNT}`)).split('-').map(Number);
  const levels = [];
  for (let n = a; n <= (b || a); n++) levels.push(n);
  const quiet = args.includes('--quiet');
  let bad = 0;

  const m = meterTest(levels, pairs);
  console.log(`meter vs canFit: ${m.pairs} pairs (${m.inside} inside the range, ${m.exact} exact-edge, ${m.outside} clamp checks, ${m.edge} in the 1e-9 edge band) → ${m.fails.length ? 'FAIL' : 'pass'}`);
  for (const f of m.fails) console.log('  ' + f);
  bad += m.fails.length;

  const runs = levels.map(n => padlockTest(n, 'greedy', 1));
  for (const n of levels.filter(q => q <= 10)) runs.push(padlockTest(n, 'expert', 1));
  const pl = runs.reduce((s, r) => s + r.padlocks, 0), pf = runs.filter(r => r.fails.length);
  console.log(`padlock step: ${runs.length} runs, ${pl} padlocks → ${pf.length ? 'FAIL' : 'pass'}`);
  for (const r of runs) if (!quiet || r.fails.length) if (r.fails.length) for (const f of r.fails) console.log(`  L${r.n} ${r.kind}: ${f}`);
  bad += pf.length;
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
