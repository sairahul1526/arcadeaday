// Unit checks for FIX-LIST-7 A1 (first-try cut) and B1 (clock holds once the final order is done). node tools/slurp-pot/first-try-test.mjs
import * as LV from '../../games/slurp-pot/levels.js';
import * as L from '../../games/slurp-pot/logic.js';
import { firstTry, withMercy } from '../../games/slurp-pot/mercy.js';
import { DONE_HOLD } from '../../games/slurp-pot/consts.js';
let ok = 0, bad = 0;
const t = (name, c) => { if (c) { ok++; console.log('  ok  ', name); } else { bad++; console.log('  FAIL', name); } };
const base = LV.getLevel(12), cut = firstTry(base), pace = l => l.T - l.grace;
t('L12 carries spec.first', base.first > 0);
t('first try is shorter by spec.first', cut.T === base.T - base.first && cut.cut === base.first);
t('first try keeps the pace (3-star line)', pace(cut) === pace(base));
t('L1-L4 have no cut', [1, 2, 3, 4].every(n => !(LV.getLevel(n).first > 0)));
t('a retry (step 1) is longer than the stored clock', withMercy(base, 1).T > base.T);
// stars at the same finish time on the cut and the stored clock
const starsAt = (lv, used) => { const w = L.createWorld(lv, { mode: 'level' }); w._.finalBite = true; w._.biteTLeft = lv.T - used; return L.starsFor(w); };
for (const used of [10, 20, 30, 40]) t(`3-star line unchanged at ${used} s used`, (starsAt(cut, used) === 3) === (starsAt(base, used) === 3));
// B1: every final line done, clock under the hold -> holds, no time-out
const w = L.createWorld(cut, { mode: 'level' });
L.step(w, { x: 0, z: 1, m: 1 }, 1 / 60);
w.ti = w.tickets.length - 1; for (const ln of w.tickets[w.ti].lines) ln.got = ln.need;
w.tLeft = 1; let held = false;
for (let k = 0; k < 600 && !w.result; k++) { L.step(w, { x: 0, z: 0, m: 0 }, 1 / 60); if (w.events.some(e => e.type === 'clockHold')) held = true; w.events.length = 0; }
t('clockHold fires', held);
t('no time-out with every final line done', w.result !== 'lose' && w.result !== 'fail' && !w.result);
t('clock sits at DONE_HOLD', Math.abs(w.tLeft - DONE_HOLD) < 1e-6);
// lines not done -> still times out
const w2 = L.createWorld(cut, { mode: 'level' }); L.step(w2, { x: 0, z: 1, m: 1 }, 1 / 60); w2.tLeft = 0.5;
for (let k = 0; k < 120 && !w2.result; k++) { L.step(w2, { x: 0, z: 0, m: 0 }, 1 / 60); w2.events.length = 0; }
t('open lines still time out', !!w2.result && w2.result !== 'win');
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
